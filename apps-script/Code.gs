/**
 * ==============================================================================
 * Hackathon Logger - Google Apps Script Web App
 * ==============================================================================
 * This script is bound to a Google Sheet named 'Hackathon Logger'.
 * It receives POST requests from the Hackathon Logger Chrome Extension
 * whenever a user registers for or applies to a hackathon on platforms
 * like Devpost, Devfolio, Unstop, MLH, etc.
 *
 * Expected Sheet Layout:
 * - Top rows: Summary KPI block (TOTAL CONTESTS, OPEN APPLICATIONS, etc.)
 * - Blank row
 * - Table header row:
 *     Hackathon Name | Category | Application Deadline | PPT Submission Deadline | Status | Platform / Format | Event Link
 * - Data rows
 * ==============================================================================
 */

// Shared secret token configured in the Chrome extension options
var SHARED_TOKEN = 'CHANGE_ME_TO_A_STRONG_SECRET';

/**
 * HTTP POST entry point for the Apps Script Web App.
 * Handles incoming registration payloads from the Chrome Extension.
 *
 * @param {Object} e HTTP POST event object
 * @return {TextOutput} JSON response object with status and row details
 */
function doPost(e) {
  try {
    // 1. Parse request body (sent as text/plain to avoid CORS preflight options check)
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({
        status: 'error',
        message: 'Empty or invalid request payload.'
      });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({
        status: 'error',
        message: 'JSON parse error: ' + parseErr.message
      });
    }

    // 2. Verify shared authentication token
    if (!payload.token || payload.token !== SHARED_TOKEN) {
      return createJsonResponse({
        status: 'error',
        message: 'Unauthorized: Invalid or missing token.'
      });
    }

    // Ping / Test connection check
    if (payload.test === true || payload.action === 'ping') {
      return createJsonResponse({
        status: 'ok',
        message: 'Connection and authentication successful! Sheet is ready.'
      });
    }

    // Extract hackathon data from payload
    var data = payload.hackathon || payload.data || payload;
    if (!data.name && !data.eventLink) {
      return createJsonResponse({
        status: 'error',
        message: 'Missing required fields: hackathon name or eventLink.'
      });
    }

    // Get spreadsheet and target sheet
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      return createJsonResponse({
        status: 'error',
        message: 'Active spreadsheet not found. Ensure script is bound to the sheet.'
      });
    }

    // Locate the 'Hackathon Logger' tab, fallback to active sheet
    var sheet = ss.getSheetByName('Hackathon Logger') || ss.getActiveSheet();

    // 3. Find table header row dynamically
    var headerInfo = findHeaderRow(sheet);
    if (!headerInfo) {
      return createJsonResponse({
        status: 'error',
        message: "Header row containing 'Hackathon Name' could not be found."
      });
    }

    var headerRow = headerInfo.row;
    var columns = headerInfo.columns;

    // Validate essential columns
    if (!columns.name || !columns.eventLink) {
      return createJsonResponse({
        status: 'error',
        message: "Required columns ('Hackathon Name' and 'Event Link') not found in header row."
      });
    }

    // 4. Find data range: determine last row containing data in any of the 7 columns
    var colList = [
      columns.name,
      columns.category,
      columns.applicationDeadline,
      columns.pptSubmissionDeadline,
      columns.status,
      columns.platformFormat,
      columns.eventLink
    ].filter(function(c) { return typeof c === 'number' && c > 0; });

    var minCol = Math.min.apply(null, colList);
    var maxCol = Math.max.apply(null, colList);
    var numCols = maxCol - minCol + 1;

    var sheetLastRow = sheet.getLastRow();
    var lastDataRow = headerRow;

    if (sheetLastRow > headerRow) {
      var numRowsToCheck = sheetLastRow - headerRow;
      var dataValues = sheet.getRange(headerRow + 1, minCol, numRowsToCheck, numCols).getValues();

      for (var r = 0; r < dataValues.length; r++) {
        var rowData = dataValues[r];
        var hasContent = false;
        for (var c = 0; c < colList.length; c++) {
          var val = rowData[colList[c] - minCol];
          if (val !== '' && val !== null && val !== undefined) {
            hasContent = true;
            break;
          }
        }
        if (hasContent) {
          lastDataRow = headerRow + 1 + r;
        }
      }
    }

    // 5. Deduplicate: check existing rows for matching link or high fuzzy name similarity
    var incomingLinkNorm = normalizeLink(data.eventLink);
    var incomingName = data.name || '';
    var duplicateRow = -1;

    if (lastDataRow > headerRow) {
      var existingRangeValues = sheet.getRange(headerRow + 1, minCol, lastDataRow - headerRow, numCols).getValues();

      for (var i = 0; i < existingRangeValues.length; i++) {
        var currentRowNum = headerRow + 1 + i;
        var existingRowValues = existingRangeValues[i];

        // Check Event Link match
        var existingLink = columns.eventLink ? existingRowValues[columns.eventLink - minCol] : '';
        var existingLinkNorm = normalizeLink(existingLink);

        if (incomingLinkNorm && existingLinkNorm && incomingLinkNorm === existingLinkNorm) {
          duplicateRow = currentRowNum;
          break;
        }

        // Check fuzzy match on Hackathon Name
        var existingName = columns.name ? String(existingRowValues[columns.name - minCol] || '') : '';
        if (incomingName && existingName) {
          var similarity = fuzzyMatch(incomingName, existingName);
          if (similarity > 0.85) {
            duplicateRow = currentRowNum;
            break;
          }
        }
      }
    }

    // 6. If DUPLICATE found: update empty cells only
    if (duplicateRow !== -1) {
      var updatedAny = false;
      var fields = [
        'name',
        'category',
        'applicationDeadline',
        'pptSubmissionDeadline',
        'status',
        'platformFormat',
        'eventLink'
      ];

      for (var f = 0; f < fields.length; f++) {
        var fieldKey = fields[f];
        var colIdx = columns[fieldKey];
        if (!colIdx) continue;

        var cell = sheet.getRange(duplicateRow, colIdx);
        var currentCellVal = cell.getValue();

        // Check if existing cell is blank and incoming payload provides a value
        if ((currentCellVal === '' || currentCellVal === null || currentCellVal === undefined) &&
            data[fieldKey] !== undefined && data[fieldKey] !== null && String(data[fieldKey]).trim() !== '') {
          
          var formattedVal = formatValueForColumn(fieldKey, data[fieldKey], cell.getNumberFormat());
          cell.setValue(formattedVal);
          updatedAny = true;
        }
      }

      if (updatedAny) {
        return createJsonResponse({ status: 'updated', row: duplicateRow });
      } else {
        return createJsonResponse({ status: 'duplicate', row: duplicateRow });
      }
    }

    // 7. If NEW: insert new row and copy formatting
    var newRowNumber = lastDataRow + 1;
    sheet.insertRowAfter(lastDataRow);

    // Determine formatting source row (last data row if available, otherwise header row)
    var sourceRow = (lastDataRow > headerRow) ? lastDataRow : headerRow;
    var sourceRange = sheet.getRange(sourceRow, minCol, 1, numCols);
    var targetRange = sheet.getRange(newRowNumber, minCol, 1, numCols);

    // Copy core range formats (fonts, borders, backgrounds, alignments)
    sourceRange.copyFormatToRange(sheet, minCol, maxCol, newRowNumber, newRowNumber);

    // Explicitly mirror number formats, validations, and alignments
    try {
      targetRange.setNumberFormats(sourceRange.getNumberFormats());
      targetRange.setBackgrounds(sourceRange.getBackgrounds());
      targetRange.setFontColors(sourceRange.getFontColors());
      targetRange.setFontSizes(sourceRange.getFontSizes());
      targetRange.setFontWeights(sourceRange.getFontWeights());
      targetRange.setFontFamilies(sourceRange.getFontFamilies());
      targetRange.setFontStyles(sourceRange.getFontStyles());
      targetRange.setHorizontalAlignments(sourceRange.getHorizontalAlignments());
      targetRange.setVerticalAlignments(sourceRange.getVerticalAlignments());
      targetRange.setWraps(sourceRange.getWraps());
      targetRange.setDataValidations(sourceRange.getDataValidations());
    } catch (fmtErr) {
      Logger.log('Non-critical formatting copy warning: ' + fmtErr.message);
    }

    // Check for formulas in the source row to preserve automated columns (e.g. Status formula)
    var formulaCols = {};
    if (sourceRow > headerRow) {
      var sourceFormulasR1C1 = sourceRange.getFormulasR1C1()[0];
      for (var fc = 0; fc < sourceFormulasR1C1.length; fc++) {
        if (sourceFormulasR1C1[fc] && sourceFormulasR1C1[fc].trim() !== '') {
          var targetFormulaCol = minCol + fc;
          sheet.getRange(newRowNumber, targetFormulaCol).setFormulaR1C1(sourceFormulasR1C1[fc]);
          formulaCols[targetFormulaCol] = true;
        }
      }
    }

    // Compute status if status column does not use a formula
    var statusVal = data.status;
    if (!statusVal) {
      statusVal = isPastDeadline(data.applicationDeadline) ? 'Closed' : 'Open';
    }

    var rowFieldValues = {
      name: data.name || '',
      category: data.category || '',
      applicationDeadline: data.applicationDeadline || '',
      pptSubmissionDeadline: data.pptSubmissionDeadline || '',
      status: statusVal,
      platformFormat: data.platformFormat || '',
      eventLink: data.eventLink || ''
    };

    // Write incoming values to the newly created row
    for (var k in rowFieldValues) {
      var targetCol = columns[k];
      if (targetCol && !formulaCols[targetCol]) {
        var rawVal = rowFieldValues[k];
        if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
          var cellFormat = sheet.getRange(sourceRow, targetCol).getNumberFormat();
          var valToWrite = formatValueForColumn(k, rawVal, cellFormat);
          sheet.getRange(newRowNumber, targetCol).setValue(valToWrite);
        }
      }
    }

    return createJsonResponse({ status: 'added', row: newRowNumber });

  } catch (err) {
    Logger.log('Error in doPost: ' + err.toString());
    return createJsonResponse({
      status: 'error',
      message: err.message || String(err)
    });
  }
}

/**
 * HTTP GET handler for easy health checks and verification in browser.
 */
function doGet(e) {
  return createJsonResponse({
    status: 'ok',
    message: 'Hackathon Logger Webhook endpoint is active and listening.'
  });
}

/**
 * Locates the header row and column mappings by scanning rows for 'Hackathon Name'.
 * Employs fuzzy matching on header names to tolerate minor user edits.
 *
 * @param {Sheet} sheet Target Google Sheet
 * @return {Object|null} Object containing header row index and column map, or null if not found
 */
function findHeaderRow(sheet) {
  var maxScanRows = Math.min(sheet.getLastRow() || 30, 50);
  var maxScanCols = Math.max(sheet.getLastColumn() || 10, 10);
  var values = sheet.getRange(1, 1, maxScanRows, maxScanCols).getValues();

  var standardHeaders = {
    'hackathon name': 'name',
    'category': 'category',
    'application deadline': 'applicationDeadline',
    'ppt submission deadline': 'pptSubmissionDeadline',
    'status': 'status',
    'platform / format': 'platformFormat',
    'platform/format': 'platformFormat',
    'platform': 'platformFormat',
    'event link': 'eventLink'
  };

  for (var r = 0; r < values.length; r++) {
    var rowValues = values[r];
    var isHeaderRow = false;

    // Check if this row contains the anchor header 'Hackathon Name'
    for (var c = 0; c < rowValues.length; c++) {
      var valNorm = normalizeHeaderString(rowValues[c]);
      if (valNorm === 'hackathon name') {
        isHeaderRow = true;
        break;
      }
    }

    if (isHeaderRow) {
      var headerRowIndex = r + 1; // 1-indexed
      var columns = {};

      for (var colIdx = 0; colIdx < rowValues.length; colIdx++) {
        var rawHeader = normalizeHeaderString(rowValues[colIdx]);
        if (!rawHeader) continue;

        // Exact match against mapped standard headers
        if (standardHeaders[rawHeader]) {
          columns[standardHeaders[rawHeader]] = colIdx + 1;
        } else {
          // Fuzzy/substring match for header variations
          if (rawHeader.indexOf('hackathon') !== -1 && rawHeader.indexOf('name') !== -1) {
            columns['name'] = colIdx + 1;
          } else if (rawHeader.indexOf('category') !== -1) {
            columns['category'] = colIdx + 1;
          } else if (rawHeader.indexOf('ppt') !== -1 && (rawHeader.indexOf('deadline') !== -1 || rawHeader.indexOf('submission') !== -1)) {
            columns['pptSubmissionDeadline'] = colIdx + 1;
          } else if (rawHeader.indexOf('application') !== -1 && rawHeader.indexOf('deadline') !== -1) {
            columns['applicationDeadline'] = colIdx + 1;
          } else if (rawHeader === 'deadline' && !columns['applicationDeadline']) {
            columns['applicationDeadline'] = colIdx + 1;
          } else if (rawHeader.indexOf('status') !== -1) {
            columns['status'] = colIdx + 1;
          } else if (rawHeader.indexOf('platform') !== -1) {
            columns['platformFormat'] = colIdx + 1;
          } else if (rawHeader.indexOf('link') !== -1 || rawHeader.indexOf('url') !== -1) {
            columns['eventLink'] = colIdx + 1;
          }
        }
      }

      return {
        row: headerRowIndex,
        columns: columns
      };
    }
  }

  return null;
}

/**
 * Normalizes a header label for resilient comparison.
 *
 * @param {string} str Raw header string
 * @return {string} Lowercased, single-spaced string
 */
function normalizeHeaderString(str) {
  if (!str) return '';
  return String(str).toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalizes an event URL for deduplication comparison:
 * - strips protocol (http://, https://)
 * - strips www.
 * - strips query parameters (?ref=...) and hashes (#...)
 * - strips trailing slashes
 * - lowercases
 *
 * @param {string} link Raw link
 * @return {string} Canonical URL identifier
 */
function normalizeLink(link) {
  if (!link) return '';
  var s = String(link).trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/+$/, '');
  return s;
}

/**
 * Calculates Dice's bigram coefficient for fuzzy string similarity.
 * Returns a score between 0.0 (no similarity) and 1.0 (identical).
 *
 * @param {string} a First string
 * @param {string} b Second string
 * @return {number} Similarity score [0, 1]
 */
function fuzzyMatch(a, b) {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;

  var cleanA = String(a).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  var cleanB = String(b).toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();

  if (cleanA === cleanB) return 1.0;
  if (cleanA.length < 2 || cleanB.length < 2) return 0.0;

  var bigramsA = {};
  for (var i = 0; i < cleanA.length - 1; i++) {
    var gramA = cleanA.substring(i, i + 2);
    bigramsA[gramA] = (bigramsA[gramA] || 0) + 1;
  }

  var bigramsB = {};
  for (var j = 0; j < cleanB.length - 1; j++) {
    var gramB = cleanB.substring(j, j + 2);
    bigramsB[gramB] = (bigramsB[gramB] || 0) + 1;
  }

  var intersection = 0;
  for (var key in bigramsA) {
    if (bigramsB[key]) {
      intersection += Math.min(bigramsA[key], bigramsB[key]);
    }
  }

  var totalBigrams = (cleanA.length - 1) + (cleanB.length - 1);
  return (2.0 * intersection) / totalBigrams;
}

/**
 * Checks whether a given deadline has already elapsed.
 *
 * @param {string} deadlineStr Date string in ISO, YYYY-MM-DD, or RFC format
 * @return {boolean} True if deadline is in the past, false otherwise
 */
function isPastDeadline(deadlineStr) {
  if (!deadlineStr) return false;
  try {
    var parsed = parseDateString(deadlineStr);
    if (!parsed || isNaN(parsed.getTime())) return false;
    return parsed.getTime() < new Date().getTime();
  } catch (e) {
    return false;
  }
}

/**
 * Parses a date string into a Date object safely handling YYYY-MM-DD local time.
 *
 * @param {string} dateStr Raw date string
 * @return {Date|null}
 */
function parseDateString(dateStr) {
  if (!dateStr) return null;
  var s = String(dateStr).trim();

  // If format is YYYY-MM-DD
  var isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    var year = parseInt(isoMatch[1], 10);
    var month = parseInt(isoMatch[2], 10) - 1;
    var day = parseInt(isoMatch[3], 10);
    return new Date(year, month, day, 23, 59, 59);
  }

  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Determines whether a Google Sheets number format represents a Date format.
 *
 * @param {string} format Format pattern string
 * @return {boolean}
 */
function isDateFormatPattern(format) {
  if (!format || typeof format !== 'string') return false;
  if (format === '@') return false; // Plain text
  var f = format.toLowerCase();
  return (f.indexOf('y') !== -1 && f.indexOf('d') !== -1) ||
         (f.indexOf('m') !== -1 && f.indexOf('d') !== -1) ||
         (f.indexOf('yyyy') !== -1);
}

/**
 * Formats a value according to the column type and target sheet number format.
 *
 * @param {string} fieldKey Field identifier
 * @param {*} value Raw value
 * @param {string} numberFormat Existing cell number format
 * @return {*} Formatted value suitable for setValue()
 */
function formatValueForColumn(fieldKey, value, numberFormat) {
  if (value === undefined || value === null) return '';

  if (fieldKey === 'applicationDeadline' || fieldKey === 'pptSubmissionDeadline') {
    var dateObj = parseDateString(value);
    if (dateObj && !isNaN(dateObj.getTime())) {
      // If the cell has an explicit date format, write as Date object
      if (isDateFormatPattern(numberFormat)) {
        return dateObj;
      }
      // If cell format is text or default, format as YYYY-MM-DD text
      var y = dateObj.getFullYear();
      var m = String(dateObj.getMonth() + 1).padStart(2, '0');
      var d = String(dateObj.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
  }

  return value;
}

/**
 * Creates a standardized JSON response output.
 *
 * @param {Object} result Response object
 * @return {TextOutput}
 */
function createJsonResponse(result) {
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
