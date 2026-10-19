/**
 * Platform Adapter: Hack2skill
 * Key: 'hack2skill'
 *
 * Handles hackathon detail pages, registration detection, and DOM scraping for Hack2skill.
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  var NON_DETAIL_SLUGS = [
    'all', 'filter', 'explore', 'about', 'contact', 'privacy',
    'terms', 'faq', 'leaderboard', 'login', 'signup'
  ];

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://hack2skill.com');
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
   * Extract section and slug from Hack2skill URL
   */
  function extractHackathonInfo(url, hostname) {
    var parsed = safeParseUrl(url, hostname);
    if (!parsed.hostname.endsWith('hack2skill.com')) return null;

    var match = parsed.pathname.match(/^\/(hackathons|hack)\/([^\/?#]+)/i);
    if (match && match[1] && match[2]) {
      var section = match[1].toLowerCase();
      var slug = match[2];
      if (NON_DETAIL_SLUGS.indexOf(slug.toLowerCase()) === -1) {
        return {
          section: section,
          slug: slug
        };
      }
    }
    return null;
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
   * Recursively extract hackathon data from embedded JSON / Next.js
   */
  function findHackathonInObject(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;

    if (obj.hackathon && typeof obj.hackathon === 'object' && (obj.hackathon.title || obj.hackathon.name)) {
      return obj.hackathon;
    }
    if ((obj.title || obj.name) && (obj.registrationEndDate || obj.submissionEndDate || obj.hackathon_id || obj.slug)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var foundArr = findHackathonInObject(obj[i], (depth || 0) + 1);
        if (foundArr) return foundArr;
      }
    } else {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var foundKey = findHackathonInObject(obj[keys[k]], (depth || 0) + 1);
        if (foundKey) return foundKey;
      }
    }
    return null;
  }

  /**
   * Extract embedded state / Next data
   */
  function getEmbeddedData(doc) {
    if (!doc) return null;
    try {
      var nextTag = doc.getElementById('__NEXT_DATA__') || doc.querySelector('script#__NEXT_DATA__');
      if (nextTag && nextTag.textContent) {
        var nextParsed = JSON.parse(nextTag.textContent);
        if (nextParsed && nextParsed.props) {
          var hData = findHackathonInObject(nextParsed.props, 0);
          if (hData) return hData;
        }
      }
    } catch (e) {
      // Ignore
    }

    var scripts = doc.querySelectorAll('script:not([src])');
    for (var s = 0; s < scripts.length; s++) {
      var text = scripts[s].textContent || '';
      if (text.indexOf('__INITIAL_STATE__') !== -1 || text.indexOf('"hackathon"') !== -1) {
        var jsonMatch = text.match(/({.*"hackathon".*})/s);
        if (jsonMatch && jsonMatch[1]) {
          try {
            var parsed = JSON.parse(jsonMatch[1]);
            var item = findHackathonInObject(parsed, 0);
            if (item) return item;
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
    return null;
  }

  HackathonLogger.adapters['hack2skill'] = {
    platform: 'hack2skill',
    platformName: 'Hack2skill',

    isDetailPage: function(url, hostname) {
      var info = extractHackathonInfo(url, hostname);
      return info !== null;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!this.isDetailPage(url, hostname)) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/register|\/apply/i.test(path)) {
        return true;
      }
      // Registration is available directly on the hackathon detail page
      return true;
    },

    getMainPageUrl: function(url, hostname) {
      var info = extractHackathonInfo(url, hostname);
      if (info) {
        return 'https://hack2skill.com/' + info.section + '/' + info.slug;
      }
      return null;
    },

    getSlug: function(url, hostname) {
      var info = extractHackathonInfo(url, hostname);
      return info ? info.slug : '';
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

      // 1. Structured Data: Embedded JSON / Next.js
      var embedded = getEmbeddedData(doc);
      if (embedded) {
        if (embedded.title && typeof embedded.title === 'string') {
          name = embedded.title.trim();
        } else if (embedded.name && typeof embedded.name === 'string') {
          name = embedded.name.trim();
        }

        // Deadlines
        if (embedded.registrationEndDate || embedded.registration_end_date || embedded.apply_by) {
          applicationDeadline = String(embedded.registrationEndDate || embedded.registration_end_date || embedded.apply_by).trim();
        }
        if (embedded.submissionEndDate || embedded.submission_end_date || embedded.endDate || embedded.end_date) {
          submissionDeadline = String(embedded.submissionEndDate || embedded.submission_end_date || embedded.endDate || embedded.end_date).trim();
        }

        // Themes
        var rawThemes = embedded.themes || embedded.tracks || embedded.tags || [];
        if (Array.isArray(rawThemes)) {
          for (var t = 0; t < rawThemes.length; t++) {
            var tVal = typeof rawThemes[t] === 'string' ? rawThemes[t] : (rawThemes[t] && rawThemes[t].name ? rawThemes[t].name : null);
            if (tVal && typeof tVal === 'string') {
              var trTheme = tVal.trim();
              if (trTheme && themes.indexOf(trTheme) === -1) {
                themes.push(trTheme);
              }
            }
          }
        }

        // Mode & Location
        if (embedded.mode || embedded.eventType || embedded.event_type) {
          var rawMode = String(embedded.mode || embedded.eventType || embedded.event_type).toLowerCase();
          if (rawMode.indexOf('online') !== -1 || rawMode.indexOf('virtual') !== -1) mode = 'Online';
          else if (rawMode.indexOf('offline') !== -1 || rawMode.indexOf('in-person') !== -1) mode = 'In-Person';
          else if (rawMode.indexOf('hybrid') !== -1) mode = 'Hybrid';
        }
        if (embedded.location || embedded.venue || embedded.city) {
          location = String(embedded.location || embedded.venue || embedded.city).trim();
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
          name = ogTitle.replace(/\s*\|\s*Hack2skill$/i, '').replace(/\s*-\s*Hack2skill$/i, '').trim();
        }
      }
      if (!canonicalUrl) {
        var ogUrl = getMetaContent(doc, 'property', 'og:url');
        if (ogUrl) canonicalUrl = ogUrl.trim();
      }

      // 4. Visible DOM text and CSS selectors
      if (!name) {
        var nameSelectors = [
          'h1.hackathon-title',
          '.hero-title',
          'h1.title',
          '.hackathon-header h1',
          'h1'
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
        name = doc.title.replace(/\s*\|\s*Hack2skill$/i, '').replace(/\s*-\s*Hack2skill$/i, '').trim();
      }

      // Themes from chips/tags
      if (themes.length === 0) {
        var tagEls = doc.querySelectorAll('.theme-card, .theme-tag, .track-name, .badge, .tags span, .category-pill');
        var tagSet = {};
        for (var tg = 0; tg < tagEls.length; tg++) {
          var tgTxt = tagEls[tg].textContent ? tagEls[tg].textContent.trim() : '';
          if (tgTxt && tgTxt.length > 1 && tgTxt.length < 35 && !tagSet[tgTxt.toLowerCase()]) {
            tagSet[tgTxt.toLowerCase()] = true;
            themes.push(tgTxt);
          }
        }
      }

      // Deadlines from visible text
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (pageText) {
        if (!applicationDeadline) {
          var regMatch = pageText.match(/(?:registration\s+deadline|register\s+before|last\s+date\s+to\s+apply|apply\s+by)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (regMatch) {
            applicationDeadline = regMatch[1].trim();
          }
        }
        if (!submissionDeadline) {
          var subMatch = pageText.match(/(?:submission\s+deadline|hackathon\s+ends|ends\s+on|submission\s+closes)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (subMatch) {
            submissionDeadline = subMatch[1].trim();
          }
        }
      }

      // Mode detection
      if (!mode) {
        var lowerText = pageText ? pageText.toLowerCase() : '';
        var hasOnline = /online|virtual/i.test(lowerText) || (location && /online|virtual/i.test(location));
        var hasInPerson = /in-person|in person|offline|physical/i.test(lowerText) || (location && !/online/i.test(location) && location.length > 2);
        if (hasOnline && hasInPerson) {
          mode = 'Hybrid';
        } else if (hasInPerson) {
          mode = 'In-Person';
        } else if (hasOnline) {
          mode = 'Online';
        }
      }

      // Location fallback
      if (!location) {
        var locEl = doc.querySelector('.location-text, .venue, .venue-name, .city');
        if (locEl && locEl.textContent) {
          var lVal = locEl.textContent.trim();
          if (lVal && lVal.length > 1) {
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
      'button[class*="register" i]',
      '.register-btn',
      'a[href*="/register"]',
      'button[class*="apply" i]',
      '.apply-btn',
      'a[href*="/apply"]',
      'button[id*="register"]',
      'button[aria-label*="register" i]',
      'button.register-button'
    ],

    registrationApiPatterns: [
      /\/api\/.*\/register/i,
      /\/api\/.*\/apply/i,
      /\/api\/.*\/participate/i,
      /\/api\/.*\/hackathons\/.*\/register/i
    ],

    successTextPatterns: [
      /successfully\s+registered/i,
      /registration\s+(successful|confirmed)/i,
      /you.*registered/i,
      /welcome\s+to.*hackathon/i,
      /application\s+submitted/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/my-hackathons/i,
      /\/registered/i,
      /\/registration-success/i
    ]
  };
})();
