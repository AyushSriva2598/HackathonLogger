/**
 * Platform Adapter: DoraHacks
 * Key: 'dorahacks'
 *
 * Handles hackathon detail pages, Apollo/Next.js state extraction,
 * registration detection, and DOM scraping for DoraHacks.
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  var NON_HACKATHON_SLUGS = [
    'all', 'filter', 'explore', 'buidl', 'grant', 'idea',
    'about', 'contact', 'privacy', 'terms', 'bounties'
  ];

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://dorahacks.io');
      return {
        url: parsed.href,
        hostname: (hostname || parsed.hostname).toLowerCase(),
        pathname: parsed.pathname,
        search: parsed.search
      };
    } catch (e) {
      return {
        url: url || '',
        hostname: (hostname || '').toLowerCase(),
        pathname: '',
        search: ''
      };
    }
  }

  /**
   * Extract slug from DoraHacks URL
   */
  function extractSlug(url, hostname) {
    var parsed = safeParseUrl(url, hostname);
    if (!parsed.hostname.endsWith('dorahacks.io')) return '';

    // Matches /hackathon/:slug or /hackathon/:slug/*
    var match = parsed.pathname.match(/^\/hackathon\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      var candidate = match[1].toLowerCase();
      if (NON_HACKATHON_SLUGS.indexOf(candidate) === -1) {
        return match[1];
      }
    }
    return '';
  }

  /**
   * Safe parser for JSON-LD Event objects
   */
  function findJsonLdEvent(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      try {
        var content = scripts[i].textContent;
        if (!content) continue;
        var data = JSON.parse(content);
        var items = Array.isArray(data) ? data : (data['@graph'] || [data]);
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          var type = item['@type'];
          if (type === 'Event' || (Array.isArray(type) && type.indexOf('Event') !== -1) || (typeof type === 'string' && type.indexOf('Event') !== -1)) {
            return item;
          }
        }
      } catch (err) {
        // Skip malformed JSON
      }
    }
    return null;
  }

  /**
   * Safely retrieve meta content
   */
  function getMetaContent(doc, attr, val) {
    if (!doc || !doc.querySelector) return null;
    var el = doc.querySelector('meta[' + attr + '="' + val + '"]');
    if (el) {
      var content = el.getAttribute('content');
      return content ? content.trim() : null;
    }
    return null;
  }

  /**
   * Recursively search for hackathon object in Apollo cache or Next.js state
   */
  function findHackathonInState(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;

    if (obj.hackathon && typeof obj.hackathon === 'object' && (obj.hackathon.name || obj.hackathon.title)) {
      return obj.hackathon;
    }
    if ((obj.title || obj.name) && (obj.applyEndTime || obj.submitEndTime || obj.tracks || obj.buidlCount !== undefined)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var foundArr = findHackathonInState(obj[i], (depth || 0) + 1);
        if (foundArr) return foundArr;
      }
    } else {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var foundKey = findHackathonInState(obj[keys[k]], (depth || 0) + 1);
        if (foundKey) return foundKey;
      }
    }
    return null;
  }

  /**
   * Extract embedded Apollo / Next state
   */
  function getEmbeddedState(doc) {
    if (!doc) return null;
    try {
      var nextTag = doc.getElementById('__NEXT_DATA__') || doc.querySelector('script#__NEXT_DATA__');
      if (nextTag && nextTag.textContent) {
        var parsed = JSON.parse(nextTag.textContent);
        if (parsed && parsed.props) {
          var found = findHackathonInState(parsed.props, 0);
          if (found) return found;
        }
      }
    } catch (e) {
      // Ignore
    }

    var scripts = doc.querySelectorAll('script:not([src])');
    for (var s = 0; s < scripts.length; s++) {
      var text = scripts[s].textContent || '';
      if (text.indexOf('__APOLLO_STATE__') !== -1 || text.indexOf('__INITIAL_STATE__') !== -1) {
        var match = text.match(/(?:window\.__APOLLO_STATE__\s*=\s*|window\.__INITIAL_STATE__\s*=\s*)({.*?});/s);
        if (match && match[1]) {
          try {
            var stateParsed = JSON.parse(match[1]);
            var item = findHackathonInState(stateParsed, 0);
            if (item) return item;
          } catch (err) {
            // Ignore parse errors
          }
        }
      }
    }
    return null;
  }

  HackathonLogger.adapters['dorahacks'] = {
    platform: 'dorahacks',
    platformName: 'DoraHacks',

    isDetailPage: function(url, hostname) {
      var slug = extractSlug(url, hostname);
      return slug.length > 0;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!this.isDetailPage(url, hostname)) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/apply|\/register|\/buidl/i.test(path)) {
        return true;
      }
      return true;
    },

    getMainPageUrl: function(url, hostname) {
      var slug = extractSlug(url, hostname);
      if (slug) {
        return 'https://dorahacks.io/hackathon/' + slug;
      }
      return null;
    },

    getSlug: function(url, hostname) {
      return extractSlug(url, hostname);
    },

    scrapeDetails: function(doc) {
      if (!doc) {
        return {
          name: null,
          themes: [],
          applicationDeadline: null,
          submissionDeadline: null,
          mode: null,
          location: null,
          canonicalUrl: null
        };
      }

      var name = null;
      var themes = [];
      var applicationDeadline = null;
      var submissionDeadline = null;
      var mode = null;
      var location = null;
      var canonicalUrl = null;

      // 1. Structured Data: Apollo / Next state
      var state = getEmbeddedState(doc);
      if (state) {
        if (state.name && typeof state.name === 'string') {
          name = state.name.trim();
        } else if (state.title && typeof state.title === 'string') {
          name = state.title.trim();
        }

        // Deadlines
        if (state.applyEndTime || state.apply_end_time || state.registrationDeadline) {
          applicationDeadline = String(state.applyEndTime || state.apply_end_time || state.registrationDeadline).trim();
        }
        if (state.submitEndTime || state.submit_end_time || state.submissionDeadline || state.endTime || state.end_time) {
          submissionDeadline = String(state.submitEndTime || state.submit_end_time || state.submissionDeadline || state.endTime || state.end_time).trim();
        }

        // Themes
        var rawTracks = state.tracks || state.trackList || state.tags || [];
        if (Array.isArray(rawTracks)) {
          for (var r = 0; r < rawTracks.length; r++) {
            var item = rawTracks[r];
            var trName = typeof item === 'string' ? item : (item && (item.name || item.title) ? (item.name || item.title) : null);
            if (trName && typeof trName === 'string') {
              var trClean = trName.trim();
              if (trClean && themes.indexOf(trClean) === -1) {
                themes.push(trClean);
              }
            }
          }
        }

        // Mode & Location
        if (state.mode || state.type) {
          var sm = String(state.mode || state.type).toLowerCase();
          if (sm.indexOf('online') !== -1 || sm.indexOf('virtual') !== -1) mode = 'Online';
          else if (sm.indexOf('offline') !== -1 || sm.indexOf('in-person') !== -1) mode = 'In-Person';
          else if (sm.indexOf('hybrid') !== -1) mode = 'Hybrid';
        }
        if (state.location || state.venue || state.city) {
          location = String(state.location || state.venue || state.city).trim();
        }
      }

      // 2. Structured Data: JSON-LD
      var jsonLd = findJsonLdEvent(doc);
      if (jsonLd) {
        if (!name && jsonLd.name && typeof jsonLd.name === 'string') {
          name = jsonLd.name.trim();
        }
        if (!submissionDeadline && jsonLd.endDate && typeof jsonLd.endDate === 'string') {
          submissionDeadline = jsonLd.endDate.trim();
        }
        if (!canonicalUrl && jsonLd.url && typeof jsonLd.url === 'string') {
          canonicalUrl = jsonLd.url.trim();
        }
        if (!location && jsonLd.location) {
          if (typeof jsonLd.location === 'string') {
            location = jsonLd.location.trim();
          } else if (jsonLd.location.name) {
            location = String(jsonLd.location.name).trim();
          } else if (jsonLd.location.address) {
            var addr = jsonLd.location.address;
            if (typeof addr === 'string') {
              location = addr.trim();
            } else if (addr.addressLocality) {
              location = (addr.addressLocality + (addr.addressRegion ? ', ' + addr.addressRegion : '')).trim();
            }
          }
        }
      }

      // 3. OpenGraph meta tags
      if (!name) {
        var ogTitle = getMetaContent(doc, 'property', 'og:title') || getMetaContent(doc, 'name', 'twitter:title');
        if (ogTitle) {
          name = ogTitle.replace(/\s*\|\s*DoraHacks$/i, '').replace(/\s*-\s*DoraHacks$/i, '').trim();
        }
      }
      if (!canonicalUrl) {
        var ogUrl = getMetaContent(doc, 'property', 'og:url');
        if (ogUrl) canonicalUrl = ogUrl.trim();
      }

      // 4. Visible DOM text and CSS selectors
      if (!name) {
        var nameSelectors = [
          'h1',
          'h2.hackathon-title',
          'h1.title',
          '[class*="HackathonDetail_title"]',
          '[class*="hackathon_title"]'
        ];
        for (var n = 0; n < nameSelectors.length; n++) {
          var nameEl = doc.querySelector(nameSelectors[n]);
          if (nameEl && nameEl.textContent) {
            var nVal = nameEl.textContent.trim();
            if (nVal && nVal.length > 1) {
              name = nVal;
              break;
            }
          }
        }
      }
      if (!name && doc.title) {
        name = doc.title.replace(/\s*\|\s*DoraHacks$/i, '').replace(/\s*-\s*DoraHacks$/i, '').trim();
      }

      // Themes from page elements
      if (themes.length === 0) {
        var tagEls = doc.querySelectorAll('[class*="track"], [class*="tag"], [class*="chip"], .track-item, .tag, .badge');
        var tagSet = {};
        for (var tg = 0; tg < tagEls.length; tg++) {
          var tgTxt = tagEls[tg].textContent ? tagEls[tg].textContent.trim() : '';
          if (tgTxt && tgTxt.length > 1 && tgTxt.length < 35 && !tagSet[tgTxt.toLowerCase()]) {
            tagSet[tgTxt.toLowerCase()] = true;
            themes.push(tgTxt);
          }
        }
      }

      // Visible deadlines extraction
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (pageText) {
        if (!applicationDeadline) {
          var appMatch = pageText.match(/(?:application\s+period|apply\s+by|registration\s+(?:ends|closes)|register\s+before)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (appMatch) {
            applicationDeadline = appMatch[1].trim();
          }
        }
        if (!submissionDeadline) {
          var subMatch = pageText.match(/(?:submission\s+(?:period|deadline|closes)|buidl\s+submission\s+ends|submit\s+by)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (subMatch) {
            submissionDeadline = subMatch[1].trim();
          }
        }
      }

      // Mode detection
      if (!mode) {
        var lowerText = pageText ? pageText.toLowerCase() : '';
        var hasOnline = /online|virtual|global/i.test(lowerText) || (location && /online|virtual/i.test(location));
        var hasInPerson = /in-person|in person|offline|physical/i.test(lowerText) || (location && !/online|virtual/i.test(location) && location.length > 2);
        if (hasOnline && hasInPerson) {
          mode = 'Hybrid';
        } else if (hasInPerson) {
          mode = 'In-Person';
        } else {
          // DoraHacks web3 hackathons are predominantly virtual/online by default
          mode = 'Online';
        }
      }

      // Location fallback
      if (!location) {
        var locEl = doc.querySelector('[class*="location"], [class*="venue"]');
        if (locEl && locEl.textContent) {
          var lVal = locEl.textContent.trim();
          if (lVal && lVal.length > 1 && !/online|virtual/i.test(lVal)) {
            location = lVal;
          }
        }
      }

      // Canonical URL fallback
      if (!canonicalUrl) {
        var canEl = doc.querySelector('link[rel="canonical"]');
        if (canEl && canEl.getAttribute('href')) {
          canonicalUrl = canEl.getAttribute('href').trim();
        } else if (doc.location && doc.location.href) {
          var derivedUrl = this.getMainPageUrl(doc.location.href, doc.location.hostname);
          if (derivedUrl) canonicalUrl = derivedUrl;
        }
      }

      return {
        name: name || null,
        themes: themes,
        applicationDeadline: applicationDeadline || null,
        submissionDeadline: submissionDeadline || null,
        mode: mode || null,
        location: location || null,
        canonicalUrl: canonicalUrl || null
      };
    },

    registerButtonSelectors: [
      'button[class*="apply" i]',
      'button[class*="register" i]',
      '.apply-btn',
      'a[href*="/apply"]',
      'a[href*="/register"]',
      'button[data-testid*="apply"]',
      'button[id*="apply"]',
      'button[aria-label*="apply" i]',
      'button.buidl-btn'
    ],

    registrationApiPatterns: [
      /\/api\/.*\/apply/i,
      /\/api\/.*\/register/i,
      /graphql/i,
      /\/api\/.*\/buidl/i
    ],

    successTextPatterns: [
      /successfully\s+applied/i,
      /application\s+submitted/i,
      /registered/i,
      /registration\s+confirmed/i,
      /buidl\s+submitted/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/my-hackathons/i,
      /\/buidl/i,
      /\/applied/i
    ]
  };
})();
