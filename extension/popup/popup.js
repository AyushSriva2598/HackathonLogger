/**
 * Hackathon Logger - Action Popup Script
 * 
 * Allows 1-click manual verification and logging of any hackathon page.
 */

document.addEventListener('DOMContentLoaded', function() {
  var nameInput = document.getElementById('hackathonName');
  var categoryInput = document.getElementById('category');
  var statusSelect = document.getElementById('status');
  var appDeadlineInput = document.getElementById('appDeadline');
  var pptDeadlineInput = document.getElementById('pptDeadline');
  var platformFormatInput = document.getElementById('platformFormat');
  var eventLinkInput = document.getElementById('eventLink');
  var logBtn = document.getElementById('logNowBtn');
  var statusBox = document.getElementById('statusBox');
  var openOptionsLink = document.getElementById('openOptions');

  // Open options page
  openOptionsLink.addEventListener('click', function(e) {
    e.preventDefault();
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options/options.html'));
    }
  });

  function showStatus(message, isSuccess) {
    statusBox.textContent = message;
    statusBox.className = 'status-box ' + (isSuccess ? 'status-success' : 'status-error');
  }

  // 1. Query active tab and request scraped data from content script
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || tabs.length === 0) return;
    var currentTab = tabs[0];
    var tabUrl = currentTab.url || '';

    // Default fallback values from tab
    var defaultCleanLink = tabUrl.replace(/^https?:\/\//i, '').replace(/[\?#].*$/, '').replace(/\/$/, '');
    eventLinkInput.value = defaultCleanLink;
    nameInput.value = currentTab.title || '';

    // Detect platform from URL for quick fallback
    if (/devpost\.com/i.test(tabUrl)) platformFormatInput.value = 'Devpost (Online)';
    else if (/devfolio\.co/i.test(tabUrl)) platformFormatInput.value = 'Devfolio (Online)';
    else if (/unstop\.com/i.test(tabUrl)) platformFormatInput.value = 'Unstop (Online)';
    else if (/hack2skill\.com/i.test(tabUrl)) platformFormatInput.value = 'Hack2skill (Online)';
    else if (/dorahacks\.io/i.test(tabUrl)) platformFormatInput.value = 'DoraHacks (Online)';
    else if (/mlh\.io/i.test(tabUrl)) platformFormatInput.value = 'MLH (Online)';

    // Ask content script for precise parsed details
    chrome.tabs.sendMessage(currentTab.id, { type: 'GET_CURRENT_HACKATHON' }, function(response) {
      if (chrome.runtime.lastError || !response || !response.record) {
        // Content script might not be injected (e.g. non-hackathon page or freshly opened tab)
        return;
      }

      var rec = response.record;
      if (rec.name) nameInput.value = rec.name;
      if (rec.category) categoryInput.value = rec.category;
      if (rec.status) statusSelect.value = rec.status;
      if (rec.applicationDeadline) appDeadlineInput.value = rec.applicationDeadline;
      if (rec.pptSubmissionDeadline) pptDeadlineInput.value = rec.pptSubmissionDeadline;
      if (rec.platformFormat) platformFormatInput.value = rec.platformFormat;
      if (rec.eventLink) eventLinkInput.value = rec.eventLink;
    });
  });

  // 2. Handle manual log button click
  logBtn.addEventListener('click', function() {
    var record = {
      name: nameInput.value.trim(),
      category: categoryInput.value.trim(),
      applicationDeadline: appDeadlineInput.value.trim(),
      pptSubmissionDeadline: pptDeadlineInput.value.trim() || appDeadlineInput.value.trim(),
      status: statusSelect.value,
      platformFormat: platformFormatInput.value.trim(),
      eventLink: eventLinkInput.value.trim()
    };

    if (!record.name && !record.eventLink) {
      showStatus('Please enter at least Hackathon Name or Event Link.', false);
      return;
    }

    logBtn.disabled = true;
    logBtn.innerHTML = '<span>Logging to Google Sheet...</span>';
    statusBox.style.display = 'none';

    chrome.runtime.sendMessage({
      type: 'HACKATHON_REGISTERED',
      data: record
    }, function(response) {
      logBtn.disabled = false;
      logBtn.innerHTML = '<span>⚡ Log This Hackathon to Sheet</span>';

      if (chrome.runtime.lastError) {
        showStatus('Error communicating with background worker: ' + chrome.runtime.lastError.message, false);
        return;
      }

      if (!response) {
        showStatus('No response received from background service.', false);
        return;
      }

      if (response.status === 'added') {
        showStatus('✓ Success! Added to Google Sheet' + (response.row ? ' at Row ' + response.row : '') + '.', true);
      } else if (response.status === 'updated') {
        showStatus('✓ Success! Backfilled empty cells in existing Row ' + (response.row || '') + '.', true);
      } else if (response.status === 'duplicate') {
        showStatus('✓ Hackathon is already recorded in Sheet' + (response.row ? ' (Row ' + response.row + ')' : '') + '.', true);
      } else if (response.status === 'unconfigured') {
        showStatus('⚠️ ' + (response.message || 'Please configure Apps Script URL in Options.'), false);
      } else if (response.status === 'queued') {
        showStatus('⏳ Queued for retry: ' + (response.message || 'Waiting for network/backend.'), false);
      } else {
        showStatus('❌ ' + (response.message || 'Failed to log to sheet. Check Apps Script logs.'), false);
      }
    });
  });
});
