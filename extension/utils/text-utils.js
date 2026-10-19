/**
 * Hackathon Logger - Text & URL Utilities
 * 
 * Provides URL normalization, fuzzy string matching (Dice coefficient),
 * theme/category derivation, event link cleaning, and title casing.
 */

var HackathonLogger = HackathonLogger || {};
HackathonLogger.utils = HackathonLogger.utils || {};

(function() {
  'use strict';

  var TRACKING_PARAM_REGEX = /^(?:utm_[a-z0-9_]*|ref|ref_[a-z0-9_]*|source|referrer|fbclid|gclid|gclsrc|dclid|msclkid|twclid|igshid|mc_eid|_ga|_gl)$/i;

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Capitalizes the first letter of each word in a string.
   * @param {string} str 
   * @returns {string}
   */
  HackathonLogger.utils.titleCase = function(str) {
    if (!str || typeof str !== 'string') {
      return '';
    }
    return str.replace(/\b([a-zA-Z])/g, function(letter) {
      return letter.toUpperCase();
    });
  };

  /**
   * Normalizes a URL:
   * - Strips protocol (http://, https://)
   * - Strips 'www.'
   * - Strips fragment (#...)
   * - Strips tracking query params (utm_*, ref, source, fbclid, etc.)
   * - Strips trailing slash
   * - Returns lowercase host + path (+ remaining non-tracking query params if any)
   * 
   * @param {string} url 
   * @returns {string}
   */
  HackathonLogger.utils.normalizeUrl = function(url) {
    if (!url || typeof url !== 'string') {
      return '';
    }

    var cleaned = url.trim();
    if (!cleaned) {
      return '';
    }

    // Strip fragment (#...)
    var hashIndex = cleaned.indexOf('#');
    if (hashIndex !== -1) {
      cleaned = cleaned.substring(0, hashIndex);
    }

    // Separate path and query string
    var queryIndex = cleaned.indexOf('?');
    var basePart = queryIndex !== -1 ? cleaned.substring(0, queryIndex) : cleaned;
    var queryPart = queryIndex !== -1 ? cleaned.substring(queryIndex + 1) : '';

    // Strip protocol (http://, https://, or any protocol)
    basePart = basePart.replace(/^[a-zA-Z]+:\/\//, '');

    // Strip leading 'www.'
    basePart = basePart.replace(/^www\./i, '');

    // Strip trailing slashes
    basePart = basePart.replace(/\/+$/, '');

    // Filter query parameters: strip tracking params
    var cleanQuery = '';
    if (queryPart) {
      var pairs = queryPart.split('&');
      var retainedPairs = [];

      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        if (!pair) continue;
        var eqIndex = pair.indexOf('=');
        var key = eqIndex !== -1 ? pair.substring(0, eqIndex) : pair;
        key = decodeURIComponent(key).trim();

        if (!TRACKING_PARAM_REGEX.test(key)) {
          retainedPairs.push(pair);
        }
      }

      if (retainedPairs.length > 0) {
        cleanQuery = '?' + retainedPairs.join('&');
      }
    }

    var result = (basePart + cleanQuery).toLowerCase();
    // Ensure trailing slash removed if query was empty
    return result.replace(/\/+$/, '');
  };

  /**
   * Cleans an event link into host+path with no protocol, no trailing slash,
   * and no tracking params.
   * E.g. 'https://amazonappdev2026.devpost.com/?ref=foo' -> 'amazonappdev2026.devpost.com'
   * 
   * @param {string} url 
   * @returns {string}
   */
  HackathonLogger.utils.cleanEventLink = function(url) {
    return HackathonLogger.utils.normalizeUrl(url);
  };

  /**
   * Computes normalized string similarity (0-1) using the Sørensen-Dice coefficient on bigrams.
   * Lowercases, strips punctuation, and normalizes spaces before calculation.
   * Returns 1 for exact match, 0 for complete dissimilarity.
   * 
   * @param {string} a 
   * @param {string} b 
   * @returns {number} 0 to 1
   */
  HackathonLogger.utils.fuzzyMatch = function(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return 0;
    }

    // Lowercase, remove punctuation, collapse whitespace, trim
    var s1 = a.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    var s2 = b.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Exact match after normalization
    if (s1 === s2) {
      return 1;
    }

    // If either string is too short for bigrams (< 2 characters)
    if (s1.length < 2 || s2.length < 2) {
      return s1 === s2 ? 1 : 0;
    }

    // Generate bigrams and frequencies for s1
    var s1Bigrams = {};
    var s1Count = s1.length - 1;
    for (var i = 0; i < s1Count; i++) {
      var bg1 = s1.slice(i, i + 2);
      s1Bigrams[bg1] = (s1Bigrams[bg1] || 0) + 1;
    }

    // Count bigram intersections with s2
    var intersectionCount = 0;
    var s2Count = s2.length - 1;
    for (var j = 0; j < s2Count; j++) {
      var bg2 = s2.slice(j, j + 2);
      if (s1Bigrams[bg2] && s1Bigrams[bg2] > 0) {
        s1Bigrams[bg2]--;
        intersectionCount++;
      }
    }

    // Dice coefficient: (2 * |X ∩ Y|) / (|X| + |Y|)
    var totalBigrams = s1Count + s2Count;
    if (totalBigrams === 0) {
      return 1;
    }

    return (2 * intersectionCount) / totalBigrams;
  };

  /**
   * Derives standardized category from theme/tag strings.
   * 
   * - Lowercases each theme and looks up in HackathonLogger.config.categoryMap
   * - If multiple categories match, picks the top 2 and combines as 'X & Y'
   * - If only one matches, returns it
   * - If none match but themes exist, combines first two themes into 'X & Y' format (title-cased)
   * - If empty, returns ''
   * 
   * @param {string[]} themes 
   * @returns {string}
   */
  HackathonLogger.utils.deriveCategory = function(themes) {
    if (!Array.isArray(themes) || themes.length === 0) {
      return '';
    }

    // Filter and sanitize raw themes
    var cleanThemes = [];
    for (var i = 0; i < themes.length; i++) {
      var item = String(themes[i] || '').trim();
      if (item) {
        cleanThemes.push(item);
      }
    }

    if (cleanThemes.length === 0) {
      return '';
    }

    var catMap = (HackathonLogger.config && HackathonLogger.config.categoryMap) || {};
    var matchedCategories = [];
    var seenCategories = {};

    // Sort categoryMap keys by length descending to match most specific tags first
    var sortedKeys = Object.keys(catMap).sort(function(x, y) {
      return y.length - x.length;
    });

    for (var j = 0; j < cleanThemes.length; j++) {
      var raw = cleanThemes[j].toLowerCase();
      var mapped = null;

      // 1. Direct key match
      if (catMap[raw]) {
        mapped = catMap[raw];
      } else {
        // 2. Word-boundary keyword search
        for (var k = 0; k < sortedKeys.length; k++) {
          var key = sortedKeys[k];
          var pattern = new RegExp('(?:^|[^a-z0-9])' + escapeRegex(key) + '(?:$|[^a-z0-9])', 'i');
          if (pattern.test(raw)) {
            mapped = catMap[key];
            break;
          }
        }
      }

      if (mapped && !seenCategories[mapped]) {
        seenCategories[mapped] = true;
        matchedCategories.push(mapped);
      }
    }

    // Multiple categories matched: combine best 2 into 'X & Y' format
    if (matchedCategories.length >= 2) {
      var cat1 = matchedCategories[0];
      var cat2 = matchedCategories[1];

      // Extract primary label if category already has ' & '
      var part1 = cat1.indexOf(' & ') !== -1 ? cat1.split(' & ')[0] : cat1;
      var part2 = cat2.indexOf(' & ') !== -1 ? cat2.split(' & ')[0] : cat2;

      if (part1.toLowerCase() === part2.toLowerCase()) {
        return cat1;
      }

      return part1 + ' & ' + part2;
    }

    // Exactly one category matched
    if (matchedCategories.length === 1) {
      return matchedCategories[0];
    }

    // No categories matched in categoryMap: fallback to first two themes in 'X & Y' format
    if (cleanThemes.length === 1) {
      return HackathonLogger.utils.titleCase(cleanThemes[0]);
    } else {
      var firstTheme = HackathonLogger.utils.titleCase(cleanThemes[0]);
      var secondTheme = HackathonLogger.utils.titleCase(cleanThemes[1]);
      return firstTheme + ' & ' + secondTheme;
    }
  };
})();
