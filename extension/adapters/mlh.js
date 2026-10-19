/**
 * Platform Adapter: MLH (Major League Hacking)
 * Key: 'mlh'
 *
 * Handles hackathon detail pages, season event listings,
 * registration detection, and DOM scraping for Major League Hacking.
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://mlh.io');
      return {
        url: parsed.href,
        hostname: (hostname || parsed.hostname).toLowerCase(),
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash
      };
    } catch (e) {
      return {
        url: url || '',
        hostname: (hostname || '').toLowerCase(),
        pathname: '',
        search: '',
        hash: ''
      };
    }
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

  HackathonLogger.adapters['mlh'] = {
    platform: 'mlh',
    platformName: 'Major League Hacking',

    isDetailPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!parsed.hostname.endsWith('mlh.io')) return false;

      // Event detail page
      if (/^\/events\/([a-zA-Z0-9_-]+)/i.test(parsed.pathname)) {
        return true;
      }
      // Season events listing (where hackathons are showcased)
      if (/^\/seasons\/[0-9]{4}\/events/i.test(parsed.pathname)) {
        return true;
      }
      return false;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!this.isDetailPage(url, hostname)) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/register|\/rsvp/i.test(path)) {
        return true;
      }
      // MLH displays registration buttons directly on event detail or cards
      return true;
    },

    getMainPageUrl: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var match = parsed.pathname.match(/^\/events\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        return 'https://mlh.io/events/' + match[1];
      }
      return parsed.url;
    },

    getSlug: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var match = parsed.pathname.match(/^\/events\/([a-zA-Z0-9_-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
      if (parsed.hash && parsed.hash.length > 1) {
        return parsed.hash.replace(/^#/, '');
      }
      var seasonMatch = parsed.pathname.match(/^\/seasons\/([0-9]{4})\/events/i);
      if (seasonMatch && seasonMatch[1]) {
        return 'mlh-' + seasonMatch[1];
      }
      return '';
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

      // 1. Check JSON-LD
      var jsonLd = findJsonLdEvent(doc);
      if (jsonLd) {
        if (jsonLd.name && typeof jsonLd.name === 'string') {
          name = jsonLd.name.trim();
        }
        if (jsonLd.endDate && typeof jsonLd.endDate === 'string') {
          submissionDeadline = jsonLd.endDate.trim();
        }
        if (jsonLd.startDate && typeof jsonLd.startDate === 'string') {
          // If startDate is present and no application deadline, startDate often marks the hackathon start
          applicationDeadline = jsonLd.startDate.trim();
        }
        if (jsonLd.url && typeof jsonLd.url === 'string') {
          canonicalUrl = jsonLd.url.trim();
        }
        if (jsonLd.location) {
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

      // 2. OpenGraph meta tags
      if (!name) {
        var ogTitle = getMetaContent(doc, 'property', 'og:title') || getMetaContent(doc, 'name', 'twitter:title');
        if (ogTitle) {
          name = ogTitle.replace(/\s*\|\s*Major League Hacking$/i, '').replace(/\s*\|\s*MLH$/i, '').trim();
        }
      }
      if (!canonicalUrl) {
        var ogUrl = getMetaContent(doc, 'property', 'og:url');
        if (ogUrl) canonicalUrl = ogUrl.trim();
      }

      // 3. Visible text / CSS Selectors
      if (!name) {
        var nameSelectors = [
          'h1.event-title',
          '.event-name',
          'h3[itemprop="name"]',
          'h1',
          'h2.title'
        ];
        for (var n = 0; n < nameSelectors.length; n++) {
          var el = doc.querySelector(nameSelectors[n]);
          if (el && el.textContent) {
            var txt = el.textContent.trim();
            if (txt && txt.length > 1) {
              name = txt;
              break;
            }
          }
        }
      }
      if (!name && doc.title) {
        name = doc.title.replace(/\s*\|\s*Major League Hacking$/i, '').replace(/\s*\|\s*MLH$/i, '').trim();
      }

      // Dates: Event date / Submission date
      if (!submissionDeadline) {
        var dateEl = doc.querySelector('p[itemprop="startDate"], span[itemprop="endDate"], .event-date, [data-role="event-date"]');
        if (dateEl && dateEl.textContent) {
          submissionDeadline = dateEl.textContent.trim();
        }
      }

      // Visible text scanning for deadlines
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (pageText) {
        if (!applicationDeadline) {
          var appMatch = pageText.match(/(?:rsvp\s+by|register\s+by|registration\s+closes|deadline)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (appMatch) {
            applicationDeadline = appMatch[1].trim();
          }
        }
        if (!submissionDeadline) {
          var subMatch = pageText.match(/(?:event\s+dates?|date)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?\s*[-–—]\s*(?:[A-Za-z]{3,9}\s+)?\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/i);
          if (subMatch) {
            submissionDeadline = subMatch[1].trim();
          }
        }
      }

      // Location detection
      if (!location) {
        var locEl = doc.querySelector('.event-location, [itemprop="address"], span[itemprop="city"], .location');
        if (locEl && locEl.textContent) {
          var lVal = locEl.textContent.trim();
          if (lVal && lVal.length > 1) {
            location = lVal;
          }
        }
      }

      // Mode detection (MLH explicitly uses Digital, In-Person, Hybrid)
      var modeBadge = doc.querySelector('.ribbon, .event-hybrid-notes, .badge-mode, [class*="badge"]');
      var badgeText = modeBadge && modeBadge.textContent ? modeBadge.textContent.toLowerCase() : '';
      var lowerText = pageText ? pageText.toLowerCase() : '';

      if (badgeText.indexOf('hybrid') !== -1 || lowerText.indexOf('hybrid') !== -1) {
        mode = 'Hybrid';
      } else if (badgeText.indexOf('digital') !== -1 || badgeText.indexOf('online') !== -1 || (location && /digital|online|virtual/i.test(location))) {
        mode = 'Online';
      } else if (badgeText.indexOf('in-person') !== -1 || badgeText.indexOf('in person') !== -1 || (location && !/digital|online|virtual/i.test(location) && location.length > 2)) {
        mode = 'In-Person';
      } else {
        mode = 'In-Person';
      }

      // Themes / Tags
      var themeEls = doc.querySelectorAll('.event-category, .tag, .ribbon, [class*="tag"]');
      var themeSet = {};
      for (var t = 0; t < themeEls.length; t++) {
        var tTxt = themeEls[t].textContent ? themeEls[t].textContent.trim() : '';
        if (tTxt && tTxt.length > 1 && tTxt.length < 30 && !themeSet[tTxt.toLowerCase()]) {
          themeSet[tTxt.toLowerCase()] = true;
          themes.push(tTxt);
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
        mode: mode,
        location: location || null,
        canonicalUrl: canonicalUrl || null
      };
    },

    registerButtonSelectors: [
      'a[class*="register" i]',
      '.event-register-link',
      'a[href*="/register"]',
      'a[class*="apply" i]',
      'a.btn-primary',
      'a.btn[href*="http"]',
      'button[class*="register" i]',
      'a[href*="/rsvp"]',
      'a[data-action*="register"]'
    ],

    registrationApiPatterns: [
      /\/api\/.*\/register/i,
      /\/api\/.*\/rsvp/i,
      /\/rsvp/i
    ],

    successTextPatterns: [
      /successfully\s+registered/i,
      /you.*registered/i,
      /rsvp.*confirmed/i,
      /see\s+you\s+there/i,
      /registration\s+confirmed/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/my-events/i,
      /\/registered/i,
      /\/rsvp\/confirmation/i
    ]
  };
})();
