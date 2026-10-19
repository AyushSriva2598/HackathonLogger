/**
 * Platform Adapter: Unstop
 * Key: 'unstop'
 *
 * Handles hackathon and competition detail pages, embedded state scraping,
 * registration detection, and DOM extraction for Unstop (formerly Dare2Compete).
 */
var HackathonLogger = HackathonLogger || {};
HackathonLogger.adapters = HackathonLogger.adapters || {};

(function() {
  'use strict';

  var NON_OPPORTUNITY_SLUGS = [
    'all', 'filter', 'browse', 'explore', 'search', 'category',
    'faq', 'about-us', 'contact-us', 'privacy-policy', 'terms'
  ];

  /**
   * Safely parses a URL string
   */
  function safeParseUrl(url, hostname) {
    try {
      var parsed = new URL(url, 'https://unstop.com');
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
   * Extract section and slug from Unstop URL
   */
  function extractOpportunityInfo(url, hostname) {
    var parsed = safeParseUrl(url, hostname);
    if (!parsed.hostname.endsWith('unstop.com')) return null;

    var match = parsed.pathname.match(/^\/(hackathons|competitions|o|events|opportunity)\/([^\/?#]+)/i);
    if (match && match[1] && match[2]) {
      var section = match[1].toLowerCase();
      var slug = match[2];
      if (NON_OPPORTUNITY_SLUGS.indexOf(slug.toLowerCase()) === -1) {
        return {
          section: section,
          slug: slug
        };
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
          if (type === 'Event' || type === 'EducationEvent' || (Array.isArray(type) && type.indexOf('Event') !== -1) || (typeof type === 'string' && type.indexOf('Event') !== -1)) {
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
   * Recursive helper to locate opportunity data in embedded script state
   */
  function findOpportunityInState(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 6) return null;

    if (obj.opportunity && typeof obj.opportunity === 'object' && (obj.opportunity.title || obj.opportunity.name)) {
      return obj.opportunity;
    }
    if ((obj.title || obj.name) && (obj.regnRequirements || obj.registration_end_date || obj.rounds || obj.opportunity_id)) {
      return obj;
    }

    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var foundArr = findOpportunityInState(obj[i], (depth || 0) + 1);
        if (foundArr) return foundArr;
      }
    } else {
      var keys = Object.keys(obj);
      for (var k = 0; k < keys.length; k++) {
        var foundKey = findOpportunityInState(obj[keys[k]], (depth || 0) + 1);
        if (foundKey) return foundKey;
      }
    }
    return null;
  }

  /**
   * Extract embedded state data from window objects or script tags
   */
  function getEmbeddedState(doc) {
    if (!doc) return null;

    // Check script tags with embedded JSON
    var scripts = doc.querySelectorAll('script:not([src])');
    for (var s = 0; s < scripts.length; s++) {
      var text = scripts[s].textContent || '';
      if (text.indexOf('__INITIAL_STATE__') !== -1 || text.indexOf('__NUXT__') !== -1 || text.indexOf('"opportunity"') !== -1) {
        var jsonMatch = text.match(/(?:window\.__INITIAL_STATE__\s*=\s*|window\.__NUXT__\s*=\s*)({.*?});/s) ||
                        text.match(/({.*"opportunity".*})/s);
        if (jsonMatch && jsonMatch[1]) {
          try {
            var parsed = JSON.parse(jsonMatch[1]);
            var opp = findOpportunityInState(parsed, 0);
            if (opp) return opp;
          } catch (e) {
            // Ignore parse failures on script blocks
          }
        }
      }
    }

    // Check Next.js tag if present
    try {
      var nextTag = doc.getElementById('__NEXT_DATA__') || doc.querySelector('script#__NEXT_DATA__');
      if (nextTag && nextTag.textContent) {
        var nextParsed = JSON.parse(nextTag.textContent);
        if (nextParsed && nextParsed.props) {
          var oppNext = findOpportunityInState(nextParsed.props, 0);
          if (oppNext) return oppNext;
        }
      }
    } catch (e) {
      // Ignore
    }

    return null;
  }

  HackathonLogger.adapters['unstop'] = {
    platform: 'unstop',
    platformName: 'Unstop',

    isDetailPage: function(url, hostname) {
      var opp = extractOpportunityInfo(url, hostname);
      return opp !== null;
    },

    isRegistrationPage: function(url, hostname) {
      var parsed = safeParseUrl(url, hostname);
      if (!this.isDetailPage(url, hostname)) return false;

      var path = parsed.pathname.toLowerCase();
      if (/\/register|\/apply|\/participate|\/enrollment/i.test(path)) {
        return true;
      }
      // On Unstop, registration is accessed via a primary modal/drawer on the detail page
      return true;
    },

    getMainPageUrl: function(url, hostname) {
      var opp = extractOpportunityInfo(url, hostname);
      if (opp) {
        return 'https://unstop.com/' + opp.section + '/' + opp.slug;
      }
      return null;
    },

    getSlug: function(url, hostname) {
      var opp = extractOpportunityInfo(url, hostname);
      return opp ? opp.slug : '';
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

      // 1. Structured Data: Embedded State
      var oppState = getEmbeddedState(doc);
      if (oppState) {
        if (oppState.title && typeof oppState.title === 'string') {
          name = oppState.title.trim();
        } else if (oppState.name && typeof oppState.name === 'string') {
          name = oppState.name.trim();
        }

        // Registration / Application deadline
        if (oppState.regnRequirements && oppState.regnRequirements.end_regn_date) {
          applicationDeadline = String(oppState.regnRequirements.end_regn_date).trim();
        } else if (oppState.registration_end_date) {
          applicationDeadline = String(oppState.registration_end_date).trim();
        }

        // Submission / Rounds deadline
        if (Array.isArray(oppState.rounds) && oppState.rounds.length > 0) {
          var lastRound = oppState.rounds[oppState.rounds.length - 1];
          if (lastRound && lastRound.end_date) {
            submissionDeadline = String(lastRound.end_date).trim();
          }
        }
        if (!submissionDeadline && oppState.end_date) {
          submissionDeadline = String(oppState.end_date).trim();
        }

        // Themes & Tags
        var rawTags = oppState.tags || oppState.categories || oppState.skills || [];
        if (Array.isArray(rawTags)) {
          for (var t = 0; t < rawTags.length; t++) {
            var tagVal = typeof rawTags[t] === 'string' ? rawTags[t] : (rawTags[t] && rawTags[t].name ? rawTags[t].name : null);
            if (tagVal && typeof tagVal === 'string') {
              var trTag = tagVal.trim();
              if (trTag && themes.indexOf(trTag) === -1) {
                themes.push(trTag);
              }
            }
          }
        }

        // Mode & Location
        if (oppState.mode) {
          var rawMode = String(oppState.mode).toLowerCase();
          if (rawMode.indexOf('online') !== -1) mode = 'Online';
          else if (rawMode.indexOf('offline') !== -1) mode = 'In-Person';
          else if (rawMode.indexOf('hybrid') !== -1) mode = 'Hybrid';
        } else if (oppState.is_online !== undefined) {
          mode = oppState.is_online ? 'Online' : 'In-Person';
        }

        if (oppState.organisation && oppState.organisation.name) {
          location = String(oppState.organisation.name).trim();
        } else if (oppState.college_name) {
          location = String(oppState.college_name).trim();
        } else if (oppState.city) {
          location = String(oppState.city).trim();
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
          name = ogTitle.replace(/\s*\|\s*Unstop$/i, '').replace(/\s*-\s*Unstop$/i, '').trim();
        }
      }
      if (!canonicalUrl) {
        var ogUrl = getMetaContent(doc, 'property', 'og:url');
        if (ogUrl) canonicalUrl = ogUrl.trim();
      }

      // 4. Visible DOM text and CSS selectors
      if (!name) {
        var nameSelectors = [
          'h1.opp-title',
          '.banner-title',
          'h1.hero-title',
          'h1.title',
          '.details-section h1',
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
        name = doc.title.replace(/\s*\|\s*Unstop$/i, '').replace(/\s*-\s*Unstop$/i, '').trim();
      }

      // Themes from chips/tags
      if (themes.length === 0) {
        var chipEls = doc.querySelectorAll('.tag-list .tag, .chip, .tag, .skills-section .chip, .category-pill, .tags-container .badge');
        var chipSet = {};
        for (var c = 0; c < chipEls.length; c++) {
          var cTxt = chipEls[c].textContent ? chipEls[c].textContent.trim() : '';
          if (cTxt && cTxt.length > 1 && cTxt.length < 35 && !chipSet[cTxt.toLowerCase()]) {
            chipSet[cTxt.toLowerCase()] = true;
            themes.push(cTxt);
          }
        }
      }

      // Visible deadlines extraction
      var pageText = (doc.body && doc.body.innerText) ? doc.body.innerText : (doc.body ? doc.body.textContent : '');
      if (pageText) {
        if (!applicationDeadline) {
          var regMatch = pageText.match(/(?:registration\s+deadline|last\s+date\s+to\s+apply|apply\s+by|register\s+before)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (regMatch) {
            applicationDeadline = regMatch[1].trim();
          }
        }
        if (!submissionDeadline) {
          var subMatch = pageText.match(/(?:submission\s+deadline|submissions?\s+close|ends\s+on)\s*:?\s*([A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?:\s*@?\s*\d{1,2}:\d{2}\s*(?:am|pm)?(?:\s*[A-Z]{2,4})?)?)/i);
          if (subMatch) {
            submissionDeadline = subMatch[1].trim();
          }
        }
      }

      // Mode detection
      if (!mode) {
        var lowerText = pageText ? pageText.toLowerCase() : '';
        var hasOnline = /online/i.test(lowerText) || (location && /online/i.test(location));
        var hasInPerson = /offline|in-person|in person|on-campus/i.test(lowerText) || (location && !/online/i.test(location) && location.length > 2);
        if (hasOnline && hasInPerson) {
          mode = 'Hybrid';
        } else if (hasInPerson) {
          mode = 'In-Person';
        } else if (hasOnline) {
          mode = 'Online';
        }
      }

      // Location detection fallback
      if (!location) {
        var orgEl = doc.querySelector('.org-name, .institute-name, .college-name, .venue, .location-info, .organisation-name');
        if (orgEl && orgEl.textContent) {
          var oTxt = orgEl.textContent.trim();
          if (oTxt && oTxt.length > 1) {
            location = oTxt;
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
      '#registerBtn',
      'button.apply-btn',
      '.cta-register',
      'a[href*="/register"]',
      'button[class*="apply" i]',
      '[data-action*="register"]',
      'button[aria-label*="register" i]',
      'button.reg-btn',
      'a[class*="register-btn"]'
    ],

    registrationApiPatterns: [
      /\/api\/.*\/register/i,
      /\/api\/.*\/apply/i,
      /\/api\/.*\/participate/i,
      /\/api\/.*\/enrollment/i,
      /\/api\/public\/opportunity\/.*\/register/i
    ],

    successTextPatterns: [
      /successfully\s+registered/i,
      /registration\s+successful/i,
      /you('re|\s+are)\s+registered/i,
      /registration\s+confirmed/i,
      /team.*registered/i,
      /registered\s+as\s+individual/i,
      /registration\s+complete/i
    ],

    successUrlPatterns: [
      /\/dashboard/i,
      /\/my-hackathons/i,
      /\/my-competitions/i,
      /\/registered/i,
      /\/registration-success/i
    ]
  };
})();
