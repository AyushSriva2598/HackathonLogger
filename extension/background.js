/**
 * Hackathon Logger - Background Service Worker (Manifest V3)
 * 
 * Handles:
 * 1. Listening to extension messages (HACKATHON_REGISTERED, FETCH_AND_PARSE, FLUSH_RETRY_QUEUE).
 * 2. Processing hackathon records, 60s deduplication, and sending POST requests to Google Apps Script.
 * 3. Managing a persistent retry queue in chrome.storage.local with exponential backoff.
 * 4. Maintaining an activity log of the last 50 registration operations.
 * 5. Periodic retry processing via chrome.alarms (every 5 minutes).
 * 6. Lightweight HTML extraction (JSON-LD, meta tags, titles, headings) for registration pages.
 */

try {
  importScripts('config.js');
} catch (e) {
  // config.js will be loaded if available in extension package
}

var RETRY_BASE_DELAY_MS = 30000; // 30 seconds
var RETRY_MAX_DELAY_MS = 3600000; // 1 hour
var RETRY_MAX_ATTEMPTS = 5;

// Read config overrides if provided in config.js
if (self.HackathonLogger && self.HackathonLogger.config) {
  var cfg = self.HackathonLogger.config;
  if (cfg.RETRY_BASE_DELAY_MS) RETRY_BASE_DELAY_MS = cfg.RETRY_BASE_DELAY_MS;
  if (cfg.RETRY_MAX_DELAY_MS) RETRY_MAX_DELAY_MS = cfg.RETRY_MAX_DELAY_MS;
  if (cfg.RETRY_MAX_ATTEMPTS) RETRY_MAX_ATTEMPTS = cfg.RETRY_MAX_ATTEMPTS;
}

// --- Logger Helpers ---
function log() {
  var args = Array.prototype.slice.call(arguments);
  if (self.HackathonLogger && typeof self.HackathonLogger.log === 'function') {
    self.HackathonLogger.log.apply(self.HackathonLogger, args);
  } else {
    console.log.apply(console, ['[HackathonLogger:bg]'].concat(args));
  }
}

function warn() {
  var args = Array.prototype.slice.call(arguments);
  if (self.HackathonLogger && typeof self.HackathonLogger.warn === 'function') {
    self.HackathonLogger.warn.apply(self.HackathonLogger, args);
  } else {
    console.warn.apply(console, ['[HackathonLogger:bg]'].concat(args));
  }
}

/**
 * Retrieves the Apps Script configuration from chrome.storage.sync with fallback to config.js.
 */
function getEffectiveConfig(callback) {
  chrome.storage.sync.get(['appsScriptUrl', 'appsScriptToken', 'debugMode', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN', 'DEBUG'], function(items) {
    var fallbackUrl = (self.HackathonLogger && self.HackathonLogger.config && self.HackathonLogger.config.APPS_SCRIPT_URL) || '';
    var fallbackToken = (self.HackathonLogger && self.HackathonLogger.config && self.HackathonLogger.config.APPS_SCRIPT_TOKEN) || '';

    var url = (items && (items.appsScriptUrl || items.APPS_SCRIPT_URL)) || fallbackUrl;
    var token = (items && (items.appsScriptToken || items.APPS_SCRIPT_TOKEN)) || fallbackToken;
    var debug = (items && (items.debugMode !== undefined ? items.debugMode : items.DEBUG)) || false;

    callback({
      appsScriptUrl: (url || '').trim(),
      appsScriptToken: (token || '').trim(),
      debug: debug
    });
  });
}

/**
 * Formats payload with maximum compatibility for Apps Script (supports hackathon, data, and root properties).
 */
function formatPayload(token, record) {
  var p = {
    token: token,
    hackathon: record,
    data: record
  };
  if (record && typeof record === 'object') {
    var keys = Object.keys(record);
    for (var i = 0; i < keys.length; i++) {
      p[keys[i]] = record[keys[i]];
    }
  }
  return p;
}

/**
 * Appends an entry to the rolling activity log (max 50 items).
 */
function addActivityLog(entry, callback) {
  chrome.storage.local.get(['activityLog'], function(res) {
    var logs = res.activityLog || [];
    var logItem = {
      timestamp: entry.timestamp || Date.now(),
      hackathonName: entry.hackathonName || 'Unknown Hackathon',
      eventLink: entry.eventLink || '',
      status: entry.status || 'unknown',
      row: entry.row !== undefined && entry.row !== null ? entry.row : '',
      error: entry.error || ''
    };

    logs.unshift(logItem);
    if (logs.length > 50) {
      logs = logs.slice(0, 50);
    }

    chrome.storage.local.set({ activityLog: logs }, function() {
      if (typeof callback === 'function') callback();
    });
  });
}

/**
 * Adds or updates a record in the retry queue.
 */
function addToRetryQueue(record, lastError, callback) {
  chrome.storage.local.get(['retryQueue'], function(res) {
    var queue = res.retryQueue || [];
    var existingIndex = -1;

    for (var i = 0; i < queue.length; i++) {
      if (queue[i].record && queue[i].record.eventLink && queue[i].record.eventLink === record.eventLink) {
        existingIndex = i;
        break;
      }
    }

    var delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, 0), RETRY_MAX_DELAY_MS);
    var item = {
      record: record,
      attempts: 0,
      nextRetry: Date.now() + delay,
      lastError: lastError || ''
    };

    if (existingIndex >= 0) {
      queue[existingIndex] = item;
    } else {
      queue.push(item);
    }

    chrome.storage.local.set({ retryQueue: queue }, function() {
      log('Item added to retry queue. Current queue length:', queue.length);
      if (typeof callback === 'function') callback();
    });
  });
}

/**
 * Processes items in the retry queue.
 * @param {boolean} forceAll - If true, ignores nextRetry and attempts all items immediately.
 * @param {function} callback - Optional completion callback.
 */
function flushRetryQueue(forceAll, callback) {
  getEffectiveConfig(function(config) {
    if (!config.appsScriptUrl) {
      log('Retry queue flush skipped: APPS_SCRIPT_URL not configured.');
      if (typeof callback === 'function') callback({ status: 'skipped', reason: 'No Apps Script URL' });
      return;
    }

    chrome.storage.local.get(['retryQueue'], function(res) {
      var queue = res.retryQueue || [];
      if (queue.length === 0) {
        if (typeof callback === 'function') callback({ status: 'empty', count: 0 });
        return;
      }

      var now = Date.now();
      var toProcess = [];
      var remaining = [];

      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        if (forceAll || !item.nextRetry || item.nextRetry <= now) {
          toProcess.push(item);
        } else {
          remaining.push(item);
        }
      }

      if (toProcess.length === 0) {
        if (typeof callback === 'function') callback({ status: 'no_ready_items', count: queue.length });
        return;
      }

      log('Processing ' + toProcess.length + ' retry queue items...');
      processQueueList(toProcess, remaining, config, function() {
        if (typeof callback === 'function') {
          callback({ status: 'flushed', processed: toProcess.length, remaining: remaining.length });
        }
      });
    });
  });
}

function processQueueList(toProcess, remaining, config, doneCallback) {
  if (toProcess.length === 0) {
    chrome.storage.local.set({ retryQueue: remaining }, function() {
      doneCallback();
    });
    return;
  }

  var item = toProcess.shift();

  fetch(config.appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(formatPayload(config.appsScriptToken, item.record))
  })
  .then(function(res) {
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ': ' + res.statusText);
    }
    return res.json().catch(function() {
      return { status: 'added', message: 'Logged successfully' };
    });
  })
  .then(function(result) {
    if (result.status === 'error') {
      throw new Error(result.message || 'Apps Script reported error');
    }

    log('Successfully flushed retry item:', item.record.name);
    addActivityLog({
      timestamp: Date.now(),
      hackathonName: item.record.name,
      eventLink: item.record.eventLink,
      status: result.status || 'added',
      row: result.row || '',
      error: 'Delivered via retry queue'
    });

    processQueueList(toProcess, remaining, config, doneCallback);
  })
  .catch(function(err) {
    item.attempts = (item.attempts || 0) + 1;
    item.lastError = err.message || 'Network error';

    if (item.attempts >= RETRY_MAX_ATTEMPTS) {
      warn('Retry item exceeded max attempts (' + RETRY_MAX_ATTEMPTS + '):', item.record.name);
      addActivityLog({
        timestamp: Date.now(),
        hackathonName: item.record.name,
        eventLink: item.record.eventLink,
        status: 'error',
        row: '',
        error: 'Max retry attempts exceeded: ' + item.lastError
      });
    } else {
      var delay = Math.min(RETRY_BASE_DELAY_MS * Math.pow(2, item.attempts), RETRY_MAX_DELAY_MS);
      item.nextRetry = Date.now() + delay;
      remaining.push(item);
    }

    processQueueList(toProcess, remaining, config, doneCallback);
  });
}

/**
 * Processes a newly received hackathon registration.
 */
function processHackathonRecord(record, sendResponse) {
  if (!record || (!record.name && !record.eventLink)) {
    sendResponse({ status: 'error', message: 'Invalid hackathon record' });
    return;
  }

  // 1. Normalize link for dedup key
  var rawKeySource = record.eventLink || record.name || '';
  var dedupKey = 'dedup_' + rawKeySource.replace(/[^a-zA-Z0-9]/g, '_');

  chrome.storage.local.get([dedupKey], function(res) {
    var lastLoggedAt = res[dedupKey];
    var now = Date.now();

    // 2. Check 60-second duplicate suppression
    if (lastLoggedAt && (now - lastLoggedAt < 60000)) {
      log('Duplicate registration suppressed for ' + record.name + ' within 60s window.');
      sendResponse({ status: 'duplicate', message: 'Registration already processed in the last 60 seconds.' });
      return;
    }

    // 3. Load config and dispatch POST
    getEffectiveConfig(function(config) {
      var isConfigured = config.appsScriptUrl &&
                         config.appsScriptUrl.indexOf('YOUR_APPS_SCRIPT') === -1 &&
                         config.appsScriptUrl.startsWith('https://');

      if (!isConfigured) {
        var unconfMsg = 'Apps Script URL is not configured. Please set your Web App URL in extension options.';
        warn(unconfMsg);
        addToRetryQueue(record, unconfMsg);
        addActivityLog({
          timestamp: Date.now(),
          hackathonName: record.name,
          eventLink: record.eventLink,
          status: 'queued',
          row: '',
          error: 'Apps Script URL missing or placeholder'
        });
        sendResponse({ status: 'unconfigured', message: unconfMsg });
        return;
      }

      log('Sending registration to Apps Script:', config.appsScriptUrl);

      fetch(config.appsScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify(formatPayload(config.appsScriptToken, record))
      })
      .then(function(resp) {
        if (!resp.ok) {
          throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
        }
        return resp.json().catch(function() {
          return { status: 'added', message: 'Logged' };
        });
      })
      .then(function(data) {
        if (data.status === 'error') {
          throw new Error(data.message || 'Apps script reported an error');
        }

        // Store dedup timestamp
        var dedupStore = {};
        dedupStore[dedupKey] = Date.now();
        chrome.storage.local.set(dedupStore);

        // Store in activity log
        addActivityLog({
          timestamp: Date.now(),
          hackathonName: record.name,
          eventLink: record.eventLink,
          status: data.status || 'added',
          row: data.row !== undefined && data.row !== null ? data.row : '',
          error: data.message || ''
        });

        sendResponse(data);
      })
      .catch(function(err) {
        warn('Failed to send hackathon record, adding to retry queue:', err);
        addToRetryQueue(record, err.message);
        addActivityLog({
          timestamp: Date.now(),
          hackathonName: record.name,
          eventLink: record.eventLink,
          status: 'queued',
          row: '',
          error: err.message
        });
        sendResponse({ status: 'queued', message: err.message });
      });
    });
  });
}

/**
 * 6. Lightweight HTML parser for FETCH_AND_PARSE handler.
 * Runs in Service Worker without DOM/window access.
 */
function parseHtmlMetadata(html, requestUrl) {
  var result = {
    name: '',
    themes: [],
    applicationDeadline: '',
    submissionDeadline: '',
    mode: '',
    location: '',
    canonicalUrl: requestUrl,
    meta: {}
  };

  if (!html || typeof html !== 'string') {
    return result;
  }

  // 1. Extract <title>
  var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    var rawTitle = titleMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    result.name = rawTitle;
  }

  // 2. Extract <h1>
  var h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    var rawH1 = h1Match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (rawH1) {
      result.name = rawH1;
    }
  }

  // 3. Extract Meta tags
  var metaTagRegex = /<meta\s+([^>]+)>/gi;
  var metaAttrMatch;
  while ((metaAttrMatch = metaTagRegex.exec(html)) !== null) {
    var tagContent = metaAttrMatch[1];
    var nameMatch = tagContent.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
    var contentMatch = tagContent.match(/content\s*=\s*["']([^"']*)["']/i);

    if (nameMatch && contentMatch) {
      var key = nameMatch[1].toLowerCase().trim();
      var val = contentMatch[1].trim();
      result.meta[key] = val;

      if (key === 'og:title' || key === 'twitter:title') {
        if (!result.name || result.name === rawTitle) {
          result.name = val;
        }
      } else if (key === 'og:url') {
        result.canonicalUrl = val;
      } else if (key === 'keywords') {
        var kwList = val.split(',').map(function(k) { return k.trim(); }).filter(Boolean);
        result.themes = result.themes.concat(kwList);
      }
    }
  }

  // 4. Extract JSON-LD script blocks
  var jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  var scriptMatch;
  while ((scriptMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      var parsed = JSON.parse(scriptMatch[1].trim());
      var candidates = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);

      for (var i = 0; i < candidates.length; i++) {
        var item = candidates[i];
        if (!item || typeof item !== 'object') continue;

        if (item.name && typeof item.name === 'string') {
          result.name = item.name;
        }
        if (item.url && typeof item.url === 'string') {
          result.canonicalUrl = item.url;
        }
        if (item.endDate) {
          result.submissionDeadline = item.endDate;
        }
        if (item.startDate) {
          result.applicationDeadline = item.startDate;
        }
        if (item.location) {
          if (typeof item.location === 'string') {
            result.location = item.location;
          } else if (item.location.name) {
            result.location = item.location.name;
          }
        }
        if (item.eventAttendanceMode) {
          if (String(item.eventAttendanceMode).indexOf('Online') !== -1) {
            result.mode = 'Online';
          } else {
            result.mode = 'In-Person';
          }
        }
      }
    } catch (e) {
      // JSON parse error ignored
    }
  }

  return result;
}

function fetchAndParseUrl(url, sendResponse) {
  if (!url) {
    sendResponse({ error: 'Missing URL' });
    return;
  }

  log('FETCH_AND_PARSE initiated for:', url);

  fetch(url, {
    method: 'GET',
    credentials: 'omit'
  })
  .then(function(response) {
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ': ' + response.statusText);
    }
    return response.text();
  })
  .then(function(html) {
    var parsedData = parseHtmlMetadata(html, url);
    sendResponse(parsedData);
  })
  .catch(function(err) {
    warn('FETCH_AND_PARSE failed:', err);
    sendResponse({ error: err.message, canonicalUrl: url });
  });
}

/**
 * 1. Extension Message Router
 */
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (!message || !message.type) return false;

  if (message.type === 'HACKATHON_REGISTERED') {
    processHackathonRecord(message.data, sendResponse);
    return true; // asynchronous sendResponse
  }

  if (message.type === 'FETCH_AND_PARSE') {
    fetchAndParseUrl(message.url, sendResponse);
    return true; // asynchronous sendResponse
  }

  if (message.type === 'FLUSH_RETRY_QUEUE') {
    flushRetryQueue(true, function(result) {
      sendResponse(result);
    });
    return true; // asynchronous sendResponse
  }

  return false;
});

/**
 * 5. Periodic Alarms and Lifecycle Triggers
 */
chrome.alarms.create('retryFlush', { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'retryFlush') {
    log('Alarm fired: retryFlush. Initiating background retry check.');
    flushRetryQueue(false);
  }
});

chrome.runtime.onInstalled.addListener(function(details) {
  log('Hackathon Logger extension installed/updated:', details.reason);
  chrome.alarms.create('retryFlush', { periodInMinutes: 5 });
  flushRetryQueue(true);
});

chrome.runtime.onStartup.addListener(function() {
  log('Browser launched: flushing retry queue.');
  flushRetryQueue(true);
});
