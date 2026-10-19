/**
 * Hackathon Logger - Date Parser Utility
 * 
 * Converts diverse date formats into standardized ISO 'YYYY-MM-DD' strings.
 * Defaults to Indian Standard Time (IST, UTC+5:30) when timezone is not specified.
 */

var HackathonLogger = HackathonLogger || {};
HackathonLogger.utils = HackathonLogger.utils || {};

(function() {
  'use strict';

  var MONTH_MAP = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  /**
   * Format a Date object into 'YYYY-MM-DD' in Asia/Kolkata (IST).
   * @param {Date} dateObj
   * @returns {string|null}
   */
  function formatDateInIST(dateObj) {
    if (!dateObj || isNaN(dateObj.getTime())) {
      return null;
    }
    try {
      var formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return formatter.format(dateObj);
    } catch (e) {
      var utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
      var ist = new Date(utc + (5.5 * 3600000));
      var y = ist.getFullYear();
      var m = String(ist.getMonth() + 1).padStart(2, '0');
      var d = String(ist.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + d;
    }
  }

  /**
   * Validate year, month (1-12), and day (1-31).
   * @param {number} year 
   * @param {number} month 
   * @param {number} day 
   * @returns {boolean}
   */
  function isValidDate(year, month, day) {
    if (typeof year !== 'number' || typeof month !== 'number' || typeof day !== 'number') {
      return false;
    }
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return false;
    }
    if (month < 1 || month > 12) {
      return false;
    }
    if (day < 1 || day > 31) {
      return false;
    }
    if (year < 1970 || year > 2100) {
      return false;
    }
    var daysInMonth = new Date(year, month, 0).getDate();
    return day <= daysInMonth;
  }

  /**
   * Format year, month, day to 'YYYY-MM-DD' with validation.
   * @param {number} year 
   * @param {number} month 
   * @param {number} day 
   * @returns {string|null}
   */
  function formatISO(year, month, day) {
    if (!isValidDate(year, month, day)) {
      return null;
    }
    var m = month < 10 ? '0' + month : String(month);
    var d = day < 10 ? '0' + day : String(day);
    return year + '-' + m + '-' + d;
  }

  /**
   * Returns today's date in IST formatted as 'YYYY-MM-DD'.
   * @returns {string}
   */
  HackathonLogger.utils.todayISO = function() {
    return formatDateInIST(new Date());
  };

  /**
   * Check if an ISO date string ('YYYY-MM-DD') has already passed in IST.
   * @param {string} isoDateStr 
   * @returns {boolean}
   */
  HackathonLogger.utils.isDatePassed = function(isoDateStr) {
    if (!isoDateStr || typeof isoDateStr !== 'string') {
      return false;
    }
    var today = HackathonLogger.utils.todayISO();
    var datePart = isoDateStr.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      return false;
    }
    return datePart < today;
  };

  /**
   * Adds specified number of days to today's date in IST.
   * @param {number} days 
   * @returns {string}
   */
  function addDaysToTodayIST(days) {
    var today = HackathonLogger.utils.todayISO();
    var parts = today.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days, 12, 0, 0));
    var y = d.getUTCFullYear();
    var m = d.getUTCMonth() + 1;
    var day = d.getUTCDate();
    return formatISO(y, m, day);
  }

  /**
   * Resolve a month and day with missing year to the next upcoming occurrence.
   * @param {number} month 1-12
   * @param {number} day 1-31
   * @returns {string|null}
   */
  function resolveUpcomingOccurrence(month, day) {
    var todayStr = HackathonLogger.utils.todayISO();
    var curYear = parseInt(todayStr.slice(0, 4), 10);
    var candidate = formatISO(curYear, month, day);
    if (candidate && candidate >= todayStr) {
      return candidate;
    }
    return formatISO(curYear + 1, month, day);
  }

  /**
   * Parses diverse date formats and converts to 'YYYY-MM-DD'.
   * 
   * Handles:
   * - ISO format: '2026-10-25', '2026-10-25T00:00:00Z'
   * - US format: '10/25/2026', 'Oct 25, 2026', 'October 25th, 2026'
   * - Short: '25 Oct', 'Oct 25th' (no year -> next upcoming occurrence)
   * - Ordinal suffixes: '25th', '1st', '2nd', '3rd'
   * - Full month names and abbreviations
   * - Unix timestamps in seconds (10 digits) or milliseconds (13 digits)
   * - Relative: 'in 3 days', 'ends in 5 days', 'tomorrow', 'today'
   * - Surrounding text: 'Registration closes on Oct 25, 2026'
   * - Timezone: assumes IST if none specified, converts to IST if specified
   * 
   * @param {string|number} dateStr 
   * @returns {string|null} 'YYYY-MM-DD' or null if unparseable
   */
  HackathonLogger.utils.parseDate = function(dateStr) {
    if (dateStr === null || dateStr === undefined) {
      return null;
    }

    // Handle number inputs (Unix timestamp)
    if (typeof dateStr === 'number') {
      if (isNaN(dateStr) || dateStr <= 0) return null;
      // 10 digits (seconds) vs 13 digits (milliseconds)
      var tsMs = dateStr < 1e11 ? dateStr * 1000 : dateStr;
      var d = new Date(tsMs);
      return formatDateInIST(d);
    }

    if (typeof dateStr !== 'string') {
      return null;
    }

    var str = dateStr.trim();
    if (!str) {
      return null;
    }

    // 1. Unix timestamp as string (10 digits seconds or 13 digits ms)
    if (/^\d{10}$/.test(str)) {
      return formatDateInIST(new Date(parseInt(str, 10) * 1000));
    }
    if (/^\d{13}$/.test(str)) {
      return formatDateInIST(new Date(parseInt(str, 10)));
    }

    // 2. Relative dates: 'in 3 days', 'ends in 5 days', 'closes in 2 days', '3 days left', 'today', 'tomorrow'
    if (/\btoday\b/i.test(str)) {
      return addDaysToTodayIST(0);
    }
    if (/\btomorrow\b/i.test(str)) {
      return addDaysToTodayIST(1);
    }
    var relDaysMatch = str.match(/(?:ends\s+in|closes\s+in|starts\s+in|closing\s+in|due\s+in|in)\s+(\d+)\s+day[s]?/i) ||
                       str.match(/\b(\d+)\s+day[s]?\s*(?:left|remaining)\b/i);
    if (relDaysMatch) {
      return addDaysToTodayIST(parseInt(relDaysMatch[1], 10));
    }
    var relWeeksMatch = str.match(/(?:ends\s+in|closes\s+in|starts\s+in|in)\s+(\d+)\s+week[s]?/i) ||
                        str.match(/\b(\d+)\s+week[s]?\s*(?:left|remaining)\b/i);
    if (relWeeksMatch) {
      return addDaysToTodayIST(parseInt(relWeeksMatch[1], 10) * 7);
    }

    // 3. ISO format with explicit timezone (e.g., '2026-10-25T00:00:00Z', '2026-10-25T18:00:00+05:30')
    var isoTzMatch = str.match(/\b(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})\b/i);
    if (isoTzMatch) {
      var isoParsed = new Date(isoTzMatch[0]);
      if (!isNaN(isoParsed.getTime())) {
        return formatDateInIST(isoParsed);
      }
    }

    // 4. ISO Date format without timezone: '2026-10-25' or '2026-10-25T14:00:00'
    // By requirement: assume IST if no timezone stated
    var isoNoTzMatch = str.match(/\b(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?\b/);
    if (isoNoTzMatch) {
      var isoYear = parseInt(isoNoTzMatch[1], 10);
      var isoMonth = parseInt(isoNoTzMatch[2], 10);
      var isoDay = parseInt(isoNoTzMatch[3], 10);
      var validIso = formatISO(isoYear, isoMonth, isoDay);
      if (validIso) {
        return validIso;
      }
    }

    // 5. Month name first: 'Oct 25, 2026', 'October 25th, 2026', 'Oct 25th', 'October 25'
    var monthFirstMatch = str.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i);
    if (monthFirstMatch) {
      var m1 = MONTH_MAP[monthFirstMatch[1].toLowerCase()];
      var d1 = parseInt(monthFirstMatch[2], 10);
      if (monthFirstMatch[3]) {
        return formatISO(parseInt(monthFirstMatch[3], 10), m1, d1);
      } else {
        return resolveUpcomingOccurrence(m1, d1);
      }
    }

    // 6. Day first with Month name: '25 Oct 2026', '25th October, 2026', '25 Oct', '25th October'
    var dayFirstMatch = str.match(/\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/]+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:[\s\-\/,]+(\d{4}))?\b/i);
    if (dayFirstMatch) {
      var d2 = parseInt(dayFirstMatch[1], 10);
      var m2 = MONTH_MAP[dayFirstMatch[2].toLowerCase()];
      if (dayFirstMatch[3]) {
        return formatISO(parseInt(dayFirstMatch[3], 10), m2, d2);
      } else {
        return resolveUpcomingOccurrence(m2, d2);
      }
    }

    // 7. Numeric YYYY/MM/DD
    var numYmdMatch = str.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
    if (numYmdMatch) {
      var y3 = parseInt(numYmdMatch[1], 10);
      var m3 = parseInt(numYmdMatch[2], 10);
      var d3 = parseInt(numYmdMatch[3], 10);
      var formattedYmd = formatISO(y3, m3, d3);
      if (formattedYmd) return formattedYmd;
    }

    // 8. Numeric US format MM/DD/YYYY or international DD/MM/YYYY
    var numMdyMatch = str.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (numMdyMatch) {
      var partA = parseInt(numMdyMatch[1], 10);
      var partB = parseInt(numMdyMatch[2], 10);
      var y4 = parseInt(numMdyMatch[3], 10);

      var monthVal = partA;
      var dayVal = partB;

      // If partA > 12 and partB <= 12, it must be DD/MM/YYYY
      if (partA > 12 && partB <= 12) {
        dayVal = partA;
        monthVal = partB;
      }

      var formattedMdy = formatISO(y4, monthVal, dayVal);
      if (formattedMdy) return formattedMdy;
    }

    // 9. Generic Date fallback with timezone check
    try {
      var parsedDate = new Date(str);
      if (!isNaN(parsedDate.getTime())) {
        // If string contains timezone indicators (GMT, UTC, Z, etc.)
        if (/(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})/i.test(str)) {
          return formatDateInIST(parsedDate);
        }
        // No timezone stated -> assume IST local date
        var fy = parsedDate.getFullYear();
        var fm = parsedDate.getMonth() + 1;
        var fd = parsedDate.getDate();
        return formatISO(fy, fm, fd);
      }
    } catch (e) {}

    return null;
  };
})();
