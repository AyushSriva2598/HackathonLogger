/**
 * Platform Adapter: Devfolio
 * Key: 'devfolio'
 *
 * Handles hackathon detail pages, Next.js hydration data extraction,
 * registration detection, and DOM scraping for Devfolio.
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  var RESERVED_SUBDOMAINS = [
    'www', 'api', 'blog', 'help', 'admin', 'dashboard',
    'assets', 'cdn', 'status', 'mail', 'auth'
  ];

  var NON_HACKATHON_PATHS = [
    'explore', 'search', 'all', 'filter', 'about', 'contact',
    'privacy', 'terms', 'guidelines'
  ];

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://devfolio.co');
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
   * Extract subdomain if on custom Devfolio domain
   */
  function extractSubdomain(hostname) {
    if (!hostname) return null;
    var host = hostname.toLowerCase();
    if (!host.endsWith('.devfolio.co')) return null;
    var subdomain = host.slice(0, -'.devfolio.co'.length);
    if (!subdomain || subdomain.indexOf('.') !== -1) return null;
    if (RESERVED_SUBDOMAINS.indexOf(subdomain) !== -1) return null;
    return subdomain;
  }

  /**
   * Extract slug from pathname or subdomain
   */
  function extractSlug(url, hostname) {
    var parsed = safeParseUrl(url, hostname);
    var sub = extractSubdomain(parsed.hostname);
    if (sub) {
      return sub;
    }
    var match = parsed.pathname.match(/^\/hackathons\/([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      var candidate = match[1].toLowerCase();
      if (NON_HACKATHON_PATHS.indexOf(candidate) === -1) {
        return match[1];
      }
    }
    return '';
  }

  /**
   * Search Next.js data recursively for hackathon object
   */
  function findHackathonInNextData(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 7) return null;

    // Check if current object represents a Devfolio hackathon
    if (obj.name && (obj.slug || obj.starts_at || obj.application_ends || obj.is_online !== undefined)) {
      return obj;
    }
    if (obj.hackathon && typeof obj.hackathon === 'object' && obj.hackathon.name) {
      return obj.hackathon;
    }

    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var foundArr = findHackathonInNextData(obj[i], (depth || 0) + 1);
        if (foundArr) return foundArr;
      }
    } else {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        // Skip common large React internal trees or huge arrays
        if (key === 'children' || key === 'reactRoot') continue;
        var foundKey = findHackathonInNextData(obj[key], (depth || 0) + 1);
        if (foundKey) return foundKey;
      }
    }
    return null;
  }

  /**
   * Extract Devfolio Next.js structured state
   */
  function getNextData(doc) {
    if (!doc || !doc.querySelector) return null;
    try {
      var script = doc.getElementById('__NEXT_DATA__') || doc.querySelector('script#__NEXT_DATA__');
      if (script && script.textContent) {
        var parsed = JSON.parse(script.textContent);
        if (parsed && parsed.props) {
          return findHackathonInNextData(parsed.props, 0);
        }
      }
    } catch (e) {
      // Fallback if parsing fails
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

  HackathonLogger.adapters['devfolio'] = {
    platform: 'devfolio',
    platformName: 'Devfolio',

    isDetailPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      if (sub) {
        // Subdomain is a hackathon instance (e.g. ethindia.devfolio.co)
        var subPath = parsed.pathname.toLowerCase();
        if (subPath.indexOf('/auth') === 0 || subPath.indexOf('/login') === 0) {
          return false;
        }
        return true;
      }

      if (parsed.hostname === 'devfolio.co' || parsed.hostname === 'www.devfolio.co') {
        var match = parsed.pathname.match(/^\/hackathons\/([a-zA-Z0-9_-]+)/i);
        if (match && match[1]) {
          var slug = match[1].toLowerCase();
          return NON_HACKATHON_PATHS.indexOf(slug) === -1;
        }
      }
      return false;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!this.isDetailPage(url, hostname)) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/apply|\/applications|\/register/i.test(path)) {
        return true;
      }
      // Devfolio opens application modal directly from detail page
      return true;
    },

    getMainPageUrl: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      var sub = extractSubdomain(parsed.hostname);
      if (sub) {
        return 'https://' + sub + '.devfolio.co/';
      }
      var slug = extractSlug(url, hostname);
      if (slug) {
        return 'https://devfolio.co/hackathons/' + slug;
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

      // 1. Structured Data: Next.js __NEXT_DATA__
      var nextData = getNextData(doc);
      if (nextData) {
        if (nextData.name && typeof nextData.name === 'string') {
          name = nextData.name.trim();
        }
        if (nextData.slug) {
          canonicalUrl = 'https://devfolio.co/hackathons/' + nextData.slug;
        }
        // Application deadline
        if (nextData.application_ends) {
          applicationDeadline = String(nextData.application_ends).trim();
        } else if (nextData.registrations_close_at) {
          applicationDeadline = String(nextData.registrations_close_at).trim();
        } else if (nextData.application_deadline) {
          applicationDeadline = String(nextData.application_deadline).trim();
        }
        // Submission deadline
        if (nextData.ends_at) {
          submissionDeadline = String(nextData.ends_at).trim();
        } else if (nextData.submissions_close_at) {
          submissionDeadline = String(nextData.submissions_close_at).trim();
        }
        // Themes
        if (Array.isArray(nextData.themes)) {
          for (var th = 0; th < nextData.themes.length; th++) {
            var item = nextData.themes[th];
            var thName = typeof item === 'string' ? item : (item && item.name ? item.name : null);
            if (thName && typeof thName === 'string') {
              var trimmed = thName.trim();
              if (trimmed && themes.indexOf(trimmed) === -1) {
                themes.push(trimmed);
              }
            }
          }
        }
        // Mode & Location
        if (nextData.is_online === true) {
          mode = 'Online';
        } else if (nextData.is_online === false) {
          mode = 'In-Person';
        }
        if (nextData.hackathon_setting) {
          var setting = String(nextData.hackathon_setting).toUpperCase();
          if (setting === 'ONLINE') mode = 'Online';
          else if (setting === 'IN_PERSON') mode = 'In-Person';
          else if (setting === 'HYBRID') mode = 'Hybrid';
        }
        if (nextData.location && typeof nextData.location === 'string') {
          location = nextData.location.trim();
        } else if (nextData.city) {
          location = (nextData.city + (nextData.country ? ', ' + nextData.country : '')).trim();
        } else if (nextData.venue_address && typeof nextData.venue_address === 'string') {
          location = nextData.venue_address.trim();
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
          name = ogTitle.replace(/\s*\|\s*Devfolio$/i, '').replace(/\s*-\s*Devfolio$/i, '').trim();
        }
      }
      if (!canonicalUrl) {
        var ogUrl = getMetaContent(doc, 'property', 'og:url');
        if (ogUrl) canonicalUrl = ogUrl.trim();
      }

      // 4. Visible DOM text and CSS Selectors
      if (!name) {
        var nameSelectors = [
          'h1[data-testid="hackathon-name"]',
          '.hackathon-name',
          'h1',
          '[class*="HeroTitle"]',
          '[class*="hackathonTitle"]'
        ];
        for (var s = 0; s < nameSelectors.length; s++) {
          var nameEl = doc.querySelector(nameSelectors[s]);
          if (nameEl && nameEl.textContent) {
            var nTxt = nameEl.textContent.trim();
            if (nTxt && nTxt.length > 1) {
              name = nTxt;
              break;
            }
          }
        }
      }
      if (!name && doc.title) {
        name = doc.title.replace(/\s*\|\s*Devfolio$/i, '').replace(/\s*-\s*Devfolio$/i, '').trim();
      }

      // Themes from page elements
      if (themes.length === 0) {
        var tagElements = doc.querySelectorAll('[data-testid*="tag"], [class*="Tag"], .tag, [class*="chip"], [class*="badge"]');
        var tagSet = {};
        for (var t = 0; t < tagElements.length; t++) {
          var tagTxt = tagElements[t].textContent ? tagElements[t].textContent.trim() : '';
          if (tagTxt && tagTxt.length > 1 && tagTxt.length < 35 && !tagSet[tagTxt.toLowerCase()]) {
            tagSet[tagTxt.toLowerCase()] = true;
            themes.push(tagTxt);
          }
        }
      }

      // Deadlines from visible text if not already populated
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (pageText) {
        if (!applicationDeadline) {
          var appMatch = pageText.match(/(?:applications?\s+(?:close|ends?|deadline)|apply\s+by)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (appMatch) {
            applicationDeadline = appMatch[1].trim();
          }
        }
        if (!submissionDeadline) {
          var subMatch = pageText.match(/(?:submissions?\s+(?:close|ends?|deadline)|submit\s+by|hackathon\s+ends)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (subMatch) {
            submissionDeadline = subMatch[1].trim();
          }
        }
      }

      // Mode & Location fallback
      if (!mode) {
        var lowerText = pageText ? pageText.toLowerCase() : '';
        var hasOnline = /online|virtual/i.test(lowerText) || (location && /online|virtual/i.test(location));
        var hasInPerson = /in-person|in person|offline/i.test(lowerText) || (location && !/online|virtual/i.test(location) && location.length > 2);
        if (hasOnline && hasInPerson) {
          mode = 'Hybrid';
        } else if (hasInPerson) {
          mode = 'In-Person';
        } else if (hasOnline) {
          mode = 'Online';
        }
      }

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
      'a[href*="/apply"]',
      '[data-testid*="apply"]',
      '[data-testid*="register"]',
      '.apply-button',
      'button.MuiButton-root',
      'button[id*="apply"]',
      'button[aria-label*="apply" i]',
      'a[class*="apply-button"]'
    ],

    registrationApiPatterns: [
      /api\.devfolio\.co\/api\/hackathons\/.*\/applications/i,
      /\/apply$/i,
      /\/applications$/i,
      /\/registrations$/i,
      /devfolio\.co\/api\/.*\/apply/i
    ],

    successTextPatterns: [
      /application\s+submitted/i,
      /successfully\s+applied/i,
      /you('re|\s+are)\s+in/i,
      /application\s+received/i,
      /registered\s+successfully/i,
      /application\s+under\s+review/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/submissions/i,
      /\/applications/i,
      /\/applied/i
    ]
  };
})();
