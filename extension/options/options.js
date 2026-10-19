/**
 * Hackathon Logger - Options Page Script
 * 
 * Manages:
 * 1. Reading and saving configuration to chrome.storage.sync.
 * 2. Displaying the rolling activity log (last 20 entries).
 * 3. Displaying and flushing the retry queue.
 * 4. Periodic 10-second auto-refresh of log and queue status.
 */

(function() {
  'use strict';

  // DOM Elements
  var appsScriptUrlInput = document.getElementById('appsScriptUrl');
  var appsScriptTokenInput = document.getElementById('appsScriptToken');
  var debugModeCheckbox = document.getElementById('debugMode');
  var saveBtn = document.getElementById('saveBtn');
  var saveStatus = document.getElementById('saveStatus');
  var queueBadge = document.getElementById('queueBadge');
  var queueList = document.getElementById('queueList');
  var flushBtn = document.getElementById('flushBtn');
  var refreshBtn = document.getElementById('refreshBtn');
  var logTableBody = document.getElementById('logTableBody');

  /**
   * Helper: Escape HTML to avoid injection in table/lists
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Format timestamp to readable local date-time string
   */
  function formatTimestamp(ts) {
    if (!ts) return '-';
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return String(ts);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return String(ts);
    }
  }

  /**
   * 1. Load configuration from chrome.storage.sync
   */
  function loadConfig() {
    chrome.storage.sync.get(['appsScriptUrl', 'appsScriptToken', 'debugMode', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN', 'DEBUG'], function(items) {
      var url = (items && (items.appsScriptUrl || items.APPS_SCRIPT_URL)) || '';
      var token = (items && (items.appsScriptToken || items.APPS_SCRIPT_TOKEN)) || '';
      var debug = (items && (items.debugMode !== undefined ? items.debugMode : items.DEBUG)) || false;

      appsScriptUrlInput.value = url;
      appsScriptTokenInput.value = token;
      debugModeCheckbox.checked = !!debug;
    });
  }

  /**
   * 2. Save configuration to chrome.storage.sync
   */
  function saveConfig() {
    var url = appsScriptUrlInput.value.trim();
    var token = appsScriptTokenInput.value.trim();
    var debug = debugModeCheckbox.checked;

    saveBtn.disabled = true;

    chrome.storage.sync.set({
      appsScriptUrl: url,
      appsScriptToken: token,
      debugMode: debug,
      APPS_SCRIPT_URL: url,
      APPS_SCRIPT_TOKEN: token,
      DEBUG: debug
    }, function() {
      saveBtn.disabled = false;
      saveStatus.textContent = '✓ Settings saved successfully!';
      saveStatus.style.opacity = '1';

      setTimeout(function() {
        saveStatus.style.opacity = '0';
      }, 3000);
    });
  }

  /**
   * 3. Load activity log from chrome.storage.local (last 20 entries)
   */
  function loadActivityLog() {
    chrome.storage.local.get(['activityLog'], function(res) {
      var rawLogs = res.activityLog || [];
      var logs = rawLogs.slice(0, 20);

      if (logs.length === 0) {
        logTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No activity logged yet.</td></tr>';
        return;
      }

      var html = '';
      for (var i = 0; i < logs.length; i++) {
        var item = logs[i];
        var status = (item.status || 'unknown').toLowerCase();
        var badgeClass = 'badge-' + status;
        if (status === 'success') badgeClass = 'badge-added';

        var nameHtml = escapeHtml(item.hackathonName || 'Unknown');
        if (item.eventLink) {
          var cleanHref = item.eventLink.startsWith('http') ? item.eventLink : ('https://' + item.eventLink);
          nameHtml = '<a href="' + escapeHtml(cleanHref) + '" target="_blank" rel="noopener noreferrer" class="hackathon-link">' + nameHtml + '</a>';
        }

        html += '<tr>' +
          '<td>' + escapeHtml(formatTimestamp(item.timestamp)) + '</td>' +
          '<td>' + nameHtml + '</td>' +
          '<td><span class="badge ' + escapeHtml(badgeClass) + '">' + escapeHtml(item.status || 'unknown') + '</span></td>' +
          '<td>' + escapeHtml(item.row || '-') + '</td>' +
          '<td>' + escapeHtml(item.error || item.message || '-') + '</td>' +
        '</tr>';
      }

      logTableBody.innerHTML = html;
    });
  }

  /**
   * 4. Load retry queue from chrome.storage.local
   */
  function loadRetryQueue() {
    chrome.storage.local.get(['retryQueue'], function(res) {
      var queue = res.retryQueue || [];
      var count = queue.length;

      queueBadge.textContent = count + (count === 1 ? ' item' : ' items');

      if (count === 0) {
        queueList.innerHTML = '<div class="empty-state">Queue is currently empty.</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < queue.length; i++) {
        var item = queue[i];
        var record = item.record || {};
        var nextTime = item.nextRetry ? formatTimestamp(item.nextRetry) : 'Pending';

        html += '<div class="retry-item">' +
          '<div class="retry-item-details">' +
            '<span class="retry-item-title">' + escapeHtml(record.name || record.eventLink || 'Unnamed Hackathon') + '</span>' +
            '<span class="retry-item-sub">Attempts: ' + escapeHtml(item.attempts || 0) + ' &bull; Next retry: ' + escapeHtml(nextTime) + '</span>' +
            (item.lastError ? '<span class="retry-item-error">Error: ' + escapeHtml(item.lastError) + '</span>' : '') +
          '</div>' +
          '<div>' +
            '<span class="badge badge-queued">Queued</span>' +
          '</div>' +
        '</div>';
      }

      queueList.innerHTML = html;
    });
  }

  /**
   * 5. Flush button: sends message to background service worker
   */
  function flushRetryQueue() {
    flushBtn.disabled = true;
    var originalText = flushBtn.textContent;
    flushBtn.textContent = 'Flushing...';

    chrome.runtime.sendMessage({ type: 'FLUSH_RETRY_QUEUE' }, function(response) {
      if (chrome.runtime.lastError) {
        console.warn('Flush error:', chrome.runtime.lastError);
      }

      setTimeout(function() {
        flushBtn.disabled = false;
        flushBtn.textContent = originalText;
        loadRetryQueue();
        loadActivityLog();
      }, 800);
    });
  }

  var testBtn = document.getElementById('testBtn');

  function testConnection() {
    var url = appsScriptUrlInput.value.trim();
    var token = appsScriptTokenInput.value.trim();

    if (!url) {
      saveStatus.textContent = '❌ Please enter an Apps Script URL first.';
      saveStatus.style.opacity = '1';
      saveStatus.style.color = '#ef4444';
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    saveStatus.textContent = 'Connecting to Google Apps Script...';
    saveStatus.style.opacity = '1';
    saveStatus.style.color = '#94a3b8';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({
        token: token,
        test: true
      })
    })
    .then(function(resp) {
      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status + ': ' + resp.statusText);
      }
      return resp.json();
    })
    .then(function(data) {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
      if (data.status === 'ok') {
        saveStatus.textContent = '✓ ' + (data.message || 'Connection successful!');
        saveStatus.style.color = '#10b981';
      } else if (data.status === 'error') {
        saveStatus.textContent = '❌ ' + (data.message || 'Authentication error');
        saveStatus.style.color = '#ef4444';
      } else {
        saveStatus.textContent = '✓ Response received: ' + JSON.stringify(data);
        saveStatus.style.color = '#10b981';
      }
    })
    .catch(function(err) {
      testBtn.disabled = false;
      testBtn.textContent = 'Test Connection';
      saveStatus.textContent = '❌ Connection failed: ' + err.message + ' (Check deployment permissions: "Anyone")';
      saveStatus.style.color = '#ef4444';
    });
  }

  // Event Listeners
  saveBtn.addEventListener('click', saveConfig);
  if (testBtn) testBtn.addEventListener('click', testConnection);
  flushBtn.addEventListener('click', flushRetryQueue);
  refreshBtn.addEventListener('click', function() {
    loadActivityLog();
    loadRetryQueue();
  });

  // Initial Load
  loadConfig();
  loadActivityLog();
  loadRetryQueue();

  // 6. Auto-refresh log and queue every 10 seconds
  setInterval(function() {
    loadActivityLog();
    loadRetryQueue();
  }, 10000);

})();
