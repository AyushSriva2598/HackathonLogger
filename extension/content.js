/**
 * Hackathon Logger - Main Content Script
 * 
 * Injected into supported hackathon platform pages to:
 * 1. Detect platform and instantiate corresponding adapter.
 * 2. Inject network interceptor (injected.js) into the page context.
 * 3. Passively scrape and cache hackathon details on detail pages.
 * 4. Monitor registration actions (button clicks, dynamic forms).
 * 5. Detect registration success via network responses, DOM updates, or URL shifts.
 * 6. Aggregate scraped/cached metadata and dispatch HACKATHON_REGISTERED messages.
 * 7. Present toast notifications for user feedback.
 * 8. Handle Single Page Application (SPA) navigations seamlessly.
 */

var HackathonLogger = window.HackathonLogger || {};

(function() {
  'use strict';

  // --- Logger Helpers ---
  var log = function() {
    if (HackathonLogger.log && typeof HackathonLogger.log === 'function') {
      HackathonLogger.log.apply(HackathonLogger, arguments);
    } else {
      var isDebug = (HackathonLogger.config && HackathonLogger.config.DEBUG);
      if (isDebug) {
        console.log.apply(console, ['[HackathonLogger:content]'].concat(Array.prototype.slice.call(arguments)));
      }
    }
  };

  var warn = function() {
    if (HackathonLogger.warn && typeof HackathonLogger.warn === 'function') {
      HackathonLogger.warn.apply(HackathonLogger, arguments);
    } else {
      console.warn.apply(console, ['[HackathonLogger:content]'].concat(Array.prototype.slice.call(arguments)));
    }
  };

  var error = function() {
    if (HackathonLogger.error && typeof HackathonLogger.error === 'function') {
      HackathonLogger.error.apply(HackathonLogger, arguments);
    } else {
      console.error.apply(console, ['[HackathonLogger:content]'].concat(Array.prototype.slice.call(arguments)));
    }
  };

  // --- Constants & State ---
  var REGISTER_TEXT_REGEX = /(?:register|apply|submit|join|participate|rsvp|sign\s*up|confirm)/i;
  var currentAdapter = null;
  var registrationPending = false;
  var registrationTimer = null;
  var lastUrl = window.location.href;
  var lastSlug = '';
  var domObserver = null;
  var isLoggingInProgress = false;

  /**
   * 1. PLATFORM DETECTION
   * Matches current hostname against HackathonLogger.config.platforms[*].hostPatterns.
   * Resolves the matching adapter from HackathonLogger.adapters.
   */
  function detectPlatformAdapter() {
    var hostname = window.location.hostname.toLowerCase();
    var href = window.location.href;
    var config = HackathonLogger.config || {};
    var adapters = HackathonLogger.adapters || {};

    // 1. Check configured platforms
    if (config.platforms) {
      var platformKeys = Object.keys(config.platforms);
      for (var i = 0; i < platformKeys.length; i++) {
        var key = platformKeys[i];
        var item = config.platforms[key];
        var patterns = item.hostPatterns || [];

        for (var j = 0; j < patterns.length; j++) {
          var pat = patterns[j];
          var isMatch = false;

          if (pat instanceof RegExp) {
            isMatch = pat.test(hostname);
          } else if (typeof pat === 'string') {
            if (pat.indexOf('*.') === 0) {
              var domainSuffix = pat.substring(2).toLowerCase();
              isMatch = (hostname === domainSuffix || hostname.endsWith('.' + domainSuffix));
            } else {
              isMatch = (hostname === pat.toLowerCase() || hostname.indexOf(pat.toLowerCase()) !== -1);
            }
          }

          if (isMatch) {
            var adapterKey = item.adapter || item.id || item.platform || key;
            if (adapters[adapterKey]) {
              return adapters[adapterKey];
            }
            if (adapters[key]) {
              return adapters[key];
            }
          }
        }
      }
    }

    // 2. Direct adapter fallback
    var adapterNames = Object.keys(adapters);
    for (var k = 0; k < adapterNames.length; k++) {
      var ad = adapters[adapterNames[k]];
      if (!ad) continue;

      if (ad.platform && hostname.indexOf(ad.platform.toLowerCase()) !== -1) {
        return ad;
      }
      try {
        if ((typeof ad.isDetailPage === 'function' && ad.isDetailPage(href, hostname)) ||
            (typeof ad.isRegistrationPage === 'function' && ad.isRegistrationPage(href, hostname))) {
          return ad;
        }
      } catch (err) {
        // ignore matching error
      }
    }

    return null;
  }

  /**
   * 2. INJECT INTERCEPTOR
   * Appends <script src="injected.js"> into the page context to intercept XHR/Fetch.
   */
  function injectInterceptor() {
    var scriptId = 'hackathon-logger-injected-script';
    if (document.getElementById(scriptId)) {
      return;
    }

    try {
      var script = document.createElement('script');
      script.id = scriptId;
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = function() {
        log('Network interceptor injected successfully.');
        this.remove();
      };
      (document.head || document.documentElement).appendChild(script);
    } catch (err) {
      warn('Failed to inject network interceptor script:', err);
    }
  }

  /**
   * 3. PASSIVE SCRAPING
   * If on a hackathon detail page, scrapes metadata and caches in chrome.storage.local.
   */
  function passiveScrape(adapter) {
    if (!adapter) return;
    var url = window.location.href;
    var hostname = window.location.hostname;

    try {
      if (typeof adapter.isDetailPage === 'function' && adapter.isDetailPage(url, hostname)) {
        var slug = typeof adapter.getSlug === 'function' ? adapter.getSlug(url, hostname) : '';
        if (!slug) return;

        var details = typeof adapter.scrapeDetails === 'function' ? adapter.scrapeDetails(document) : null;
        if (details && (details.name || details.canonicalUrl)) {
          var cacheKey = 'cache_' + adapter.platform + '_' + slug;
          var cacheEntry = {
            data: details,
            timestamp: Date.now()
          };
          var toStore = {};
          toStore[cacheKey] = cacheEntry;

          chrome.storage.local.set(toStore, function() {
            log('Passive scrape details stored for ' + cacheKey, details);
          });
        }
      }
    } catch (err) {
      warn('Error during passive scraping:', err);
    }
  }

  /**
   * 4. REGISTRATION MONITORING
   * Detects register/apply buttons, marks them, and sets registrationPending on click.
   */
  function isRegisterButtonElement(el, adapter) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    // 1. Text pattern match
    var text = (el.textContent || el.value || '').trim();
    if (REGISTER_TEXT_REGEX.test(text)) {
      return true;
    }

    // 2. Adapter-specific selectors
    if (adapter && Array.isArray(adapter.registerButtonSelectors)) {
      for (var i = 0; i < adapter.registerButtonSelectors.length; i++) {
        var sel = adapter.registerButtonSelectors[i];
        try {
          if (el.matches && el.matches(sel)) {
            return true;
          }
        } catch (e) {
          // invalid selector safety
        }
      }
    }

    return false;
  }

  function onRegisterClick(event) {
    var timeoutMs = (HackathonLogger.config && HackathonLogger.config.REGISTRATION_TIMEOUT_MS) || 15000;
    var targetDesc = event && event.target ? (event.target.tagName + (event.target.className ? '.' + event.target.className : '')) : 'form/direct';
    log('Registration action detected on:', targetDesc);

    registrationPending = true;

    // Persist pending registration to sessionStorage across page reloads & redirects
    var slug = (currentAdapter && typeof currentAdapter.getSlug === 'function')
      ? currentAdapter.getSlug(window.location.href, window.location.hostname)
      : '';
    if (slug) {
      try {
        sessionStorage.setItem('hl_pending_' + slug, JSON.stringify({
          timestamp: Date.now(),
          url: window.location.href
        }));
      } catch (e) {}
    }

    if (registrationTimer) {
      clearTimeout(registrationTimer);
    }

    registrationTimer = setTimeout(function() {
      if (registrationPending) {
        log('Registration window expired after ' + timeoutMs + 'ms without success signal.');
        registrationPending = false;
        registrationTimer = null;
      }
    }, timeoutMs);
  }

  function bindRegisterElement(el) {
    if (!el || el.getAttribute('data-hl-monitored') === 'true') {
      return;
    }
    el.setAttribute('data-hl-monitored', 'true');
    el.addEventListener('click', onRegisterClick, false);
  }

  function scanForRegisterButtons(rootNode, adapter) {
    if (!rootNode || !rootNode.querySelectorAll) return;

    // Adapter selectors
    if (adapter && Array.isArray(adapter.registerButtonSelectors)) {
      for (var i = 0; i < adapter.registerButtonSelectors.length; i++) {
        var sel = adapter.registerButtonSelectors[i];
        try {
          var matched = rootNode.querySelectorAll(sel);
          for (var m = 0; m < matched.length; m++) {
            bindRegisterElement(matched[m]);
          }
        } catch (err) {
          // ignore selector errors
        }
      }
    }

    // Generic button & link candidates
    var candidates = rootNode.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (var c = 0; c < candidates.length; c++) {
      var candidate = candidates[c];
      var text = (candidate.textContent || candidate.value || '').trim();
      if (REGISTER_TEXT_REGEX.test(text)) {
        bindRegisterElement(candidate);
      }
    }
  }

  /**
   * 5. SUCCESS DETECTION
   * Dispatches success when:
   * - Intercepted API POST returns 2xx with matching URL or success body.
   * - DOM updates contain text matching successTextPatterns.
   * - URL changes to a pattern matching successUrlPatterns.
   */
  function handleRegistrationSuccess(sourceInfo) {
    if (!registrationPending) {
      return;
    }
    log('Registration success detected via: ' + sourceInfo);
    registrationPending = false;

    // Clean up persisted pending state
    var slug = (currentAdapter && typeof currentAdapter.getSlug === 'function')
      ? currentAdapter.getSlug(window.location.href, window.location.hostname)
      : '';
    if (slug) {
      try {
        sessionStorage.removeItem('hl_pending_' + slug);
      } catch (e) {}
    }

    if (registrationTimer) {
      clearTimeout(registrationTimer);
      registrationTimer = null;
    }

    triggerLogging();
  }

  // 5a. Network response listener
  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data) return;
    if (event.data.source !== 'hackathon-logger-injected') return;

    if (event.data.type === 'NETWORK_RESPONSE') {
      checkNetworkResponse(event.data.data);
    }
  });

  function checkNetworkResponse(networkData) {
    if (!networkData) return;
    var adapter = currentAdapter;
    if (!adapter) return;

    var method = (networkData.method || '').toUpperCase();
    var status = networkData.status || 0;
    var is2xx = (status >= 200 && status < 300);
    var url = networkData.url || '';
    var body = networkData.bodySnippet || '';

    if (method === 'POST' && is2xx) {
      // 1. Check registrationApiPatterns
      var apiMatched = false;
      if (Array.isArray(adapter.registrationApiPatterns)) {
        for (var i = 0; i < adapter.registrationApiPatterns.length; i++) {
          var pattern = adapter.registrationApiPatterns[i];
          if (pattern instanceof RegExp && pattern.test(url)) {
            apiMatched = true;
            break;
          } else if (typeof pattern === 'string' && url.indexOf(pattern) !== -1) {
            apiMatched = true;
            break;
          }
        }
      }

      // 2. Check bodySnippet for success text patterns
      var bodyMatched = false;
      if (body) {
        if (Array.isArray(adapter.successTextPatterns)) {
          for (var j = 0; j < adapter.successTextPatterns.length; j++) {
            var textPat = adapter.successTextPatterns[j];
            if (textPat instanceof RegExp && textPat.test(body)) {
              bodyMatched = true;
              break;
            } else if (typeof textPat === 'string' && body.indexOf(textPat) !== -1) {
              bodyMatched = true;
              break;
            }
          }
        }
        if (!bodyMatched && /("success"\s*:\s*true|"registered"\s*:\s*true|registered\s+successfully|application\s+submitted)/i.test(body)) {
          bodyMatched = true;
        }
      }

      if (apiMatched || bodyMatched) {
        var onRegPage = adapter.isRegistrationPage && adapter.isRegistrationPage(window.location.href, window.location.hostname);
        if (registrationPending || onRegPage) {
          registrationPending = true;
          handleRegistrationSuccess('Network Response [' + (apiMatched ? 'API URL' : 'Body Snippet') + ']');
        }
      }
    }
  }

  // 5b. DOM Text pattern check
  function checkTextMatchesSuccess(text, adapter) {
    if (!registrationPending || !text || !adapter) return false;
    if (Array.isArray(adapter.successTextPatterns)) {
      for (var i = 0; i < adapter.successTextPatterns.length; i++) {
        var pat = adapter.successTextPatterns[i];
        if (pat instanceof RegExp && pat.test(text)) {
          return true;
        } else if (typeof pat === 'string' && text.indexOf(pat) !== -1) {
          return true;
        }
      }
    }
    return false;
  }

  function checkElementForSuccess(node, adapter) {
    if (!registrationPending || !node || !adapter) return;

    var text = (node.textContent || '').trim();
    if (text.length > 0 && text.length < 500) {
      if (checkTextMatchesSuccess(text, adapter)) {
        handleRegistrationSuccess('DOM Element Text');
        return;
      }
    }

    if (node.querySelectorAll) {
      var alertNodes = node.querySelectorAll('.alert, .toast, .notification, [role="alert"], h1, h2, h3, h4, p');
      for (var k = 0; k < alertNodes.length; k++) {
        var alertText = (alertNodes[k].textContent || '').trim();
        if (checkTextMatchesSuccess(alertText, adapter)) {
          handleRegistrationSuccess('DOM Alert Node Text');
          return;
        }
      }
    }
  }

  // 5c. URL change pattern check
  function checkUrlMatchesSuccess(url, adapter) {
    if (!registrationPending || !url || !adapter) return;
    if (Array.isArray(adapter.successUrlPatterns)) {
      for (var i = 0; i < adapter.successUrlPatterns.length; i++) {
        var pat = adapter.successUrlPatterns[i];
        if ((pat instanceof RegExp && pat.test(url)) ||
            (typeof pat === 'string' && url.indexOf(pat) !== -1)) {
          handleRegistrationSuccess('Success URL Navigation');
          return;
        }
      }
    }
  }

  /**
   * DOM Observer for dynamic registration buttons & success DOM elements
   */
  function setupDomObserver(adapter) {
    if (domObserver) {
      domObserver.disconnect();
    }

    var target = document.body || document.documentElement;
    scanForRegisterButtons(target, adapter);

    domObserver = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var added = m.addedNodes[j];
            if (added.nodeType === Node.ELEMENT_NODE) {
              scanForRegisterButtons(added, adapter);
              if (registrationPending) {
                checkElementForSuccess(added, adapter);
              }
            }
          }
        } else if (m.type === 'characterData' && registrationPending) {
          if (checkTextMatchesSuccess(m.target.nodeValue, adapter)) {
            handleRegistrationSuccess('DOM CharacterData');
          }
        }
      }
    });

    domObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  // Global capture-phase listener to catch button clicks instantly
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target) return;
    var clickable = target.closest ? target.closest('button, a, input[type="button"], input[type="submit"], [role="button"]') : null;
    if (!clickable) return;

    if (isRegisterButtonElement(clickable, currentAdapter)) {
      onRegisterClick(e);
    }
  }, true);

  // Global submit listener to catch registration form submissions
  document.addEventListener('submit', function(e) {
    if (currentAdapter) {
      log('Form submission detected on:', e.target);
      onRegisterClick(e);
    }
  }, true);

  /**
   * 6. TRIGGER LOGGING
   * Aggregates scraped, cached, and background-fetched data, forms the record,
   * and sends it to background.js.
   */
  function pickFirstNonEmpty() {
    for (var i = 0; i < arguments.length; i++) {
      var val = arguments[i];
      if (val !== undefined && val !== null && val !== '') {
        return val;
      }
    }
    return '';
  }

  function pickFirstThemes() {
    for (var i = 0; i < arguments.length; i++) {
      var arr = arguments[i];
      if (Array.isArray(arr) && arr.length > 0) {
        return arr;
      }
    }
    return [];
  }

  function buildRecord(adapter, freshScraped, cachedDetails, bgDetails) {
    var utils = HackathonLogger.utils || {};

    var name = pickFirstNonEmpty(freshScraped.name, cachedDetails.name, bgDetails.name, document.title || 'Unknown Hackathon');
    var rawThemes = pickFirstThemes(freshScraped.themes, cachedDetails.themes, bgDetails.themes);
    var rawAppDeadline = pickFirstNonEmpty(freshScraped.applicationDeadline, cachedDetails.applicationDeadline, bgDetails.applicationDeadline);
    var rawSubDeadline = pickFirstNonEmpty(freshScraped.submissionDeadline, cachedDetails.submissionDeadline, bgDetails.submissionDeadline);
    var mode = pickFirstNonEmpty(freshScraped.mode, cachedDetails.mode, bgDetails.mode);
    var location = pickFirstNonEmpty(freshScraped.location, cachedDetails.location, bgDetails.location);
    var canonicalUrl = pickFirstNonEmpty(freshScraped.canonicalUrl, cachedDetails.canonicalUrl, bgDetails.canonicalUrl, window.location.href);

    // Category
    var category = (utils.deriveCategory && typeof utils.deriveCategory === 'function')
      ? utils.deriveCategory(rawThemes)
      : (rawThemes.length > 0 ? rawThemes[0] : 'General');

    // Deadlines
    var applicationDeadline = '';
    if (utils.parseDate && typeof utils.parseDate === 'function') {
      applicationDeadline = utils.parseDate(rawAppDeadline) || '';
    } else {
      applicationDeadline = rawAppDeadline || '';
    }

    var pptSubmissionDeadline = '';
    if (utils.parseDate && typeof utils.parseDate === 'function') {
      pptSubmissionDeadline = utils.parseDate(rawSubDeadline) || applicationDeadline;
    } else {
      pptSubmissionDeadline = rawSubDeadline || applicationDeadline;
    }

    // Status: if applicationDeadline and isDatePassed(applicationDeadline) then 'Closed' else 'Open'
    var status = 'Open';
    if (applicationDeadline) {
      if (utils.isDatePassed && typeof utils.isDatePassed === 'function') {
        status = utils.isDatePassed(applicationDeadline) ? 'Closed' : 'Open';
      } else {
        try {
          var deadlineDate = new Date(applicationDeadline);
          status = deadlineDate < new Date() ? 'Closed' : 'Open';
        } catch (e) {
          status = 'Open';
        }
      }
    }

    // Platform format: `${adapter.platformName} (${mode || 'Online'})`
    var pName = (adapter && (adapter.platformName || adapter.platform)) || 'Platform';
    var modeDisplay = mode || 'Online';
    if (location) {
      if (mode && mode.toLowerCase().indexOf(location.toLowerCase()) === -1) {
        modeDisplay = mode + ' / ' + location;
      } else if (!mode) {
        modeDisplay = 'In-Person / ' + location;
      }
    }
    var platformFormat = pName + ' (' + modeDisplay + ')';

    // Event link
    var eventLink = (utils.cleanEventLink && typeof utils.cleanEventLink === 'function')
      ? utils.cleanEventLink(canonicalUrl || window.location.href)
      : (canonicalUrl || window.location.href).replace(/^https?:\/\//i, '').replace(/[\?#].*$/, '');

    return {
      name: name,
      category: category,
      applicationDeadline: applicationDeadline,
      pptSubmissionDeadline: pptSubmissionDeadline,
      status: status,
      platformFormat: platformFormat,
      eventLink: eventLink
    };
  }

  // Listen for queries from the action popup
  chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request && request.type === 'GET_CURRENT_HACKATHON') {
      var adapter = currentAdapter || detectPlatformAdapter();
      var fresh = {};
      if (adapter && typeof adapter.scrapeDetails === 'function') {
        try {
          fresh = adapter.scrapeDetails(document) || {};
        } catch (e) {}
      }
      var slug = adapter && typeof adapter.getSlug === 'function' ? adapter.getSlug(window.location.href, window.location.hostname) : '';
      var cacheKey = adapter ? ('cache_' + adapter.platform + '_' + slug) : '';

      chrome.storage.local.get([cacheKey], function(res) {
        var cached = (cacheKey && res && res[cacheKey] && res[cacheKey].data) || {};
        var rec = buildRecord(adapter, fresh, cached, {});
        sendResponse({ success: true, record: rec });
      });
      return true; // Keep message channel open for async response
    }
  });

  function assembleAndSendRecord(adapter, freshScraped, cachedDetails, bgDetails) {
    var record = buildRecord(adapter, freshScraped, cachedDetails, bgDetails);
    log('Dispatching HACKATHON_REGISTERED record:', record);

    chrome.runtime.sendMessage({
      type: 'HACKATHON_REGISTERED',
      data: record
    }, function(response) {
      isLoggingInProgress = false;

      if (chrome.runtime.lastError) {
        warn('Message error when registering hackathon:', chrome.runtime.lastError);
        showToast('⏳ Queued, will retry', 'queued');
        return;
      }

      log('Response from background for registration:', response);
      if (response && (response.status === 'added' || response.status === 'updated')) {
        showToast('✓ Logged to sheet', 'success');
      } else if (response && response.status === 'duplicate') {
        showToast('✓ Already logged to sheet', 'success');
      } else if (response && response.status === 'unconfigured') {
        showToast('⚠️ Apps Script URL not set. Open extension options.', 'error');
      } else if (response && response.status === 'error') {
        showToast('⚠️ ' + (response.message || 'Error logging to sheet'), 'error');
      } else {
        showToast('⏳ Queued, will retry', 'queued');
      }
    });
  }

  function triggerLogging() {
    if (isLoggingInProgress) {
      log('Logging already in progress, skipping duplicate trigger.');
      return;
    }
    isLoggingInProgress = true;

    var adapter = currentAdapter;
    if (!adapter) {
      warn('Trigger logging aborted: no active adapter detected.');
      isLoggingInProgress = false;
      return;
    }

    var url = window.location.href;
    var hostname = window.location.hostname;
    var isDetail = (typeof adapter.isDetailPage === 'function') && adapter.isDetailPage(url, hostname);
    var slug = (typeof adapter.getSlug === 'function') ? adapter.getSlug(url, hostname) : '';
    var cacheKey = 'cache_' + adapter.platform + '_' + slug;

    // 1. Fresh scrape if on detail page
    var freshScraped = {};
    if (isDetail && typeof adapter.scrapeDetails === 'function') {
      try {
        freshScraped = adapter.scrapeDetails(document) || {};
      } catch (err) {
        warn('Failed to scrape current detail page:', err);
      }
    }

    // 2. Fetch cached details
    chrome.storage.local.get([cacheKey], function(res) {
      var cachedDetails = (res && res[cacheKey] && res[cacheKey].data) || {};

      // 3. Fallback request to background if registration page lacks main page info
      var mainUrl = (!isDetail && typeof adapter.getMainPageUrl === 'function')
        ? adapter.getMainPageUrl(url, hostname)
        : null;

      if (mainUrl && (!freshScraped.name && !cachedDetails.name)) {
        log('Requesting background to fetch and parse main hackathon page:', mainUrl);
        chrome.runtime.sendMessage({
          type: 'FETCH_AND_PARSE',
          url: mainUrl
        }, function(bgParsed) {
          if (chrome.runtime.lastError) {
            warn('Background FETCH_AND_PARSE error:', chrome.runtime.lastError);
          }
          assembleAndSendRecord(adapter, freshScraped, cachedDetails, bgParsed || {});
        });
      } else {
        assembleAndSendRecord(adapter, freshScraped, cachedDetails, {});
      }
    });
  }

  /**
   * 7. TOAST NOTIFICATIONS
   * Injects toast.css link and renders an animated toast notification.
   */
  function ensureToastCss() {
    var toastCssId = 'hackathon-logger-toast-css';
    if (document.getElementById(toastCssId)) return;

    try {
      var link = document.createElement('link');
      link.id = toastCssId;
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = chrome.runtime.getURL('toast.css');
      (document.head || document.documentElement).appendChild(link);
    } catch (e) {
      warn('Unable to inject toast.css:', e);
    }
  }

  function showToast(message, type) {
    ensureToastCss();

    var existing = document.getElementById('hackathon-logger-toast');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    var toast = document.createElement('div');
    toast.id = 'hackathon-logger-toast';
    toast.className = 'hl-toast hl-toast-' + (type || 'info');
    toast.textContent = message;

    // Direct styling fallback
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.zIndex = '2147483647';
    toast.style.padding = '12px 22px';
    toast.style.borderRadius = '8px';
    toast.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    toast.style.fontSize = '14px';
    toast.style.fontWeight = '600';
    toast.style.color = '#ffffff';
    toast.style.backgroundColor = (type === 'success') ? '#10b981' : '#f59e0b';
    toast.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.2)';
    toast.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(12px)';
    toast.style.pointerEvents = 'none';

    document.body.appendChild(toast);

    // Fade in
    setTimeout(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 20);

    // Auto-dismiss
    var duration = (HackathonLogger.config && HackathonLogger.config.TOAST_DURATION_MS) || 4000;
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(function() {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }

  /**
   * 8 & 9. SPA NAVIGATION & RE-INJECTION
   * Detects pushState/replaceState/popstate and updates scraping and monitoring accordingly.
   */
  function handleUrlChange() {
    var newUrl = window.location.href;
    var newHostname = window.location.hostname;

    var adapter = detectPlatformAdapter();
    currentAdapter = adapter;
    if (!adapter) return;

    var newSlug = (typeof adapter.getSlug === 'function') ? adapter.getSlug(newUrl, newHostname) : '';

    if (newUrl !== lastUrl || newSlug !== lastSlug) {
      log('SPA Navigation detected -> URL: ' + newUrl + ' | Slug: ' + newSlug);
      lastUrl = newUrl;

      // Check URL for success pattern if registration was pending
      if (registrationPending) {
        checkUrlMatchesSuccess(newUrl, adapter);
      }

      // Re-scrape if navigated to a new hackathon slug
      if (newSlug !== lastSlug) {
        lastSlug = newSlug;
        passiveScrape(adapter);
      }

      // Re-scan buttons for current page DOM
      scanForRegisterButtons(document.body || document.documentElement, adapter);

      // Check if arriving with pending registration
      checkInitialSuccessState(adapter);
    }
  }

  // Intercept browser back/forward and hash changes
  window.addEventListener('popstate', handleUrlChange);
  window.addEventListener('hashchange', handleUrlChange);

  // Interval polling to reliably detect client-side framework transitions (pushState/replaceState)
  setInterval(handleUrlChange, 500);

  /**
   * Checks if arriving from a form submission or registration redirect with a pending registration
   */
  function checkInitialSuccessState(adapter) {
    if (!adapter) return;
    var slug = (typeof adapter.getSlug === 'function') ? adapter.getSlug(window.location.href, window.location.hostname) : '';
    var hasPending = false;
    if (slug) {
      try {
        var rawPending = sessionStorage.getItem('hl_pending_' + slug);
        if (rawPending) {
          var pData = JSON.parse(rawPending);
          if (Date.now() - pData.timestamp < 60000) {
            hasPending = true;
            registrationPending = true;
            log('Detected pending registration from previous navigation for slug:', slug);
          } else {
            sessionStorage.removeItem('hl_pending_' + slug);
          }
        }
      } catch (e) {}
    }

    if (!hasPending) return;

    // Check if the current page displays confirmation signals
    var bodyText = document.body ? (document.body.innerText || document.body.textContent || '') : '';
    var isSuccess = false;
    var successReason = '';

    if (Array.isArray(adapter.successTextPatterns)) {
      for (var i = 0; i < adapter.successTextPatterns.length; i++) {
        var pat = adapter.successTextPatterns[i];
        if (pat instanceof RegExp ? pat.test(bodyText) : (typeof pat === 'string' && bodyText.indexOf(pat) !== -1)) {
          isSuccess = true;
          successReason = 'Page Alert/Text Pattern';
          break;
        }
      }
    }

    if (!isSuccess && Array.isArray(adapter.successUrlPatterns)) {
      for (var u = 0; u < adapter.successUrlPatterns.length; u++) {
        var upat = adapter.successUrlPatterns[u];
        if (upat instanceof RegExp ? upat.test(window.location.href) : window.location.href.indexOf(upat) !== -1) {
          isSuccess = true;
          successReason = 'Confirmation URL';
          break;
        }
      }
    }

    if (isSuccess) {
      handleRegistrationSuccess(successReason);
    }
  }

  /**
   * INITIALIZATION
   */
  function init() {
    injectInterceptor();

    currentAdapter = detectPlatformAdapter();
    if (currentAdapter) {
      log('Initialized Hackathon Logger for platform:', currentAdapter.platformName || currentAdapter.platform);
      lastSlug = (typeof currentAdapter.getSlug === 'function')
        ? currentAdapter.getSlug(window.location.href, window.location.hostname)
        : '';

      passiveScrape(currentAdapter);
      setupDomObserver(currentAdapter);
      checkInitialSuccessState(currentAdapter);
    } else {
      log('No matching hackathon adapter for:', window.location.hostname);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
