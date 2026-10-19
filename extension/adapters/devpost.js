/**
 * Platform Adapter: Devpost
 * Key: 'devpost'
 *
 * Handles hackathon detail pages, registration detection, and DOM scraping for Devpost.
 * Devpost hackathons reside on subdomains: <slug>.devpost.com
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  // System subdomains on devpost.com that are not hackathon details
  var RESERVED_SUBDOMAINS = [
    'www', 'help', 'info', 'blog', 'support', 'assets',
    'api', 'secure', 'status', 'mail', 'cdn'
  ];

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://devpost.com');
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
   * Extracts hackathon subdomain slug if valid
   */
  function extractSubdomain(hostname) {
    if (!hostname) return null;
    var host = hostname.toLowerCase();
    if (!host.endsWith('.devpost.com')) return null;
    var subdomain = host.slice(0, -'.devpost.com'.length);
    if (!subdomain || subdomain.indexOf('.') !== -1) return null;
    if (RESERVED_SUBDOMAINS.indexOf(subdomain) !== -1) return null;
    return subdomain;
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
        // Skip malformed JSON-LD scripts
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

  HackathonLogger.adapters['devpost'] = {
    platform: 'devpost',
    platformName: 'Devpost',

    isDetailPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      if (!sub) return false;

      var path = parsed.pathname.toLowerCase();
      // Exclude generic account/system endpoints
      if (path.indexOf('/auth') === 0 || path.indexOf('/login') === 0 || path.indexOf('/settings') === 0) {
        return false;
      }
      return true;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      if (!sub) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/register|\/registrations/i.test(path)) {
        return true;
      }
      // On Devpost, registration CTA & modal/form are typically present directly on the detail page
      return this.isDetailPage(url, hostname);
    },

    getMainPageUrl: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      if (sub) {
        return 'https://' + sub + '.devpost.com/';
      }
      return null;
    },

    getSlug: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      return sub || '';
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

      // 2. Name Extraction
      if (!name) {
        var nameSelectors = [
          '#702-hackathon-title',
          '.hackathon-header h1',
          '#hackathon-title',
          'h1.header-title',
          'header h1',
          'h1'
        ];
        for (var i = 0; i < nameSelectors.length; i++) {
          var el = doc.querySelector(nameSelectors[i]);
          if (el && el.textContent) {
            var txt = el.textContent.trim();
            if (txt && txt.length > 1) {
              name = txt;
              break;
            }
          }
        }
      }
      if (!name) {
        var ogTitle = getMetaContent(doc, 'property', 'og:title') || getMetaContent(doc, 'name', 'twitter:title');
        if (ogTitle) {
          name = ogTitle.replace(/\s*\|\s*Devpost$/i, '').replace(/\s*-\s*Devpost$/i, '').trim();
        }
      }
      if (!name && doc.title) {
        name = doc.title.replace(/\s*\|\s*Devpost$/i, '').replace(/\s*-\s*Devpost$/i, '').trim();
      }

      // 3. Deadlines Extraction
      // Devpost displays: "Submission period: Oct 25, 2026 - Oct 28, 2026"
      var dateContainers = doc.querySelectorAll('#submission-period, .submission-period, .time-frame, .dates, [data-role="submission-period"]');
      for (var d = 0; d < dateContainers.length; d++) {
        var dText = dateContainers[d].textContent || '';
        dText = dText.replace(/\s+/g, ' ').trim();
        if (dText) {
          var matchRange = dText.match(/(?:submission\s+period\s*:?\s*)?([A-Za-z0-9,.\s]+)\s*[-–—]\s*([A-Za-z0-9,.\s@:]+)/i);
          if (matchRange) {
            if (!submissionDeadline) {
              submissionDeadline = matchRange[2].trim();
            }
          } else if (!submissionDeadline && /deadline|period|ends/i.test(dText)) {
            submissionDeadline = dText.replace(/^.*?(?:deadline|closes|period)\s*:?\s*/i, '').trim();
          }
        }
      }

      // Visible text fallback for submission deadline
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (!submissionDeadline && pageText) {
        var subMatch = pageText.match(/(?:submission\s+period|submissions\s+close|deadline|submit\s+by)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
        if (subMatch) {
          submissionDeadline = subMatch[1].trim();
        }
      }

      // Registration deadline search
      if (pageText) {
        var regMatch = pageText.match(/(?:registration\s+(?:deadline|closes|ends)|register\s+by)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
        if (regMatch) {
          applicationDeadline = regMatch[1].trim();
        }
      }

      // 4. Themes Scraping
      var themeEls = doc.querySelectorAll('.software-tag a, .challenge-category, .tag, .hackathon-themes a, .theme-tag, [data-role="theme"]');
      var themeSet = {};
      for (var t = 0; t < themeEls.length; t++) {
        var tTxt = themeEls[t].textContent ? themeEls[t].textContent.trim() : '';
        if (tTxt && tTxt.length > 1 && !themeSet[tTxt.toLowerCase()]) {
          themeSet[tTxt.toLowerCase()] = true;
          themes.push(tTxt);
        }
      }
      if (themes.length === 0) {
        var keywords = getMetaContent(doc, 'name', 'keywords');
        if (keywords) {
          var kwParts = keywords.split(',');
          for (var k = 0; k < kwParts.length; k++) {
            var kw = kwParts[k].trim();
            if (kw && kw.toLowerCase() !== 'devpost' && kw.toLowerCase() !== 'hackathon' && !themeSet[kw.toLowerCase()]) {
              themeSet[kw.toLowerCase()] = true;
              themes.push(kw);
            }
          }
        }
      }

      // 5. Mode & Location Scraping
      var locationEl = doc.querySelector('.info-with-icon i.fa-map-marker + *, .location, .venue, [data-qa="location"], .hackathon-location');
      var locText = locationEl ? locationEl.textContent.trim() : null;
      if (locText && !location) {
        location = locText;
      }

      var fullTextLower = pageText ? pageText.toLowerCase() : '';
      var hasOnline = /online|virtual/i.test(fullTextLower) || (location && /online|virtual/i.test(location));
      var hasInPerson = /in-person|in person|physical venue/i.test(fullTextLower) || (location && !/online|virtual/i.test(location) && location.length > 2);

      if (hasOnline && hasInPerson) {
        mode = 'Hybrid';
      } else if (hasInPerson) {
        mode = 'In-Person';
      } else {
        mode = 'Online';
      }

      // 6. Canonical URL
      var canEl = doc.querySelector('link[rel="canonical"]');
      if (canEl && canEl.getAttribute('href')) {
        canonicalUrl = canEl.getAttribute('href').trim();
      } else if (!canonicalUrl && doc.location && doc.location.hostname) {
        var subSlug = extractSubdomain(doc.location.hostname);
        if (subSlug) {
          canonicalUrl = 'https://' + subSlug + '.devpost.com/';
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
      'a[data-method="post"][href*="/registrations"]',
      'a.register-link',
      'button[data-action*="register"]',
      '#702-register-button',
      '.register-button',
      'a[href*="/register"]',
      'a[href*="/registrations"]',
      'input[value*="Register"]',
      'a[href*="/registrations/new"]',
      'a[data-role="register-button"]',
      'button.register-button'
    ],

    registrationApiPatterns: [
      /\/registrations$/i,
      /\/registrations\/new/i,
      /\/register$/i,
      /\/participants$/i,
      /\/join$/i
    ],

    successTextPatterns: [
      /successfully registered/i,
      /you('re|\s+are)\s+registered/i,
      /registration\s+confirmed/i,
      /welcome.*hackathon/i,
      /you('re|\s+are)\s+in/i,
      /thanks for registering/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/submissions\/new/i,
      /\/project-gallery/i,
      /manage\/hackathon/i,
      /\/registered/i
    ]
  };
})();
