/**
 * Hackathon Logger - Injected Page Script
 * 
 * Intercepts window.fetch and XMLHttpRequest POST requests directly within
 * the page execution context and communicates network responses back to the
 * content script via window.postMessage.
 */

(function() {
  'use strict';

  // Guard against multiple injections into the same execution context
  if (window.__hackathonLoggerInjected) {
    return;
  }
  window.__hackathonLoggerInjected = true;

  var SOURCE_ID = 'hackathon-logger-injected';
  var MESSAGE_TYPE = 'NETWORK_RESPONSE';

  /**
   * Posts network response payload to content script.
   * @param {string} url 
   * @param {string} method 
   * @param {number} status 
   * @param {string} bodySnippet 
   */
  function postNetworkResponse(url, method, status, bodySnippet) {
    try {
      window.postMessage({
        source: SOURCE_ID,
        type: MESSAGE_TYPE,
        data: {
          url: url || '',
          method: (method || 'POST').toUpperCase(),
          status: typeof status === 'number' ? status : 0,
          bodySnippet: typeof bodySnippet === 'string' ? bodySnippet : ''
        }
      }, '*');
    } catch (e) {
      // Fail silently to avoid breaking page functionality
    }
  }

  // ==========================================
  // 1. Intercept window.fetch
  // ==========================================
  if (typeof window.fetch === 'function') {
    var originalFetch = window.fetch;

    window.fetch = function(resource, init) {
      var method = 'GET';
      var url = '';

      try {
        if (init && init.method) {
          method = String(init.method).toUpperCase();
        } else if (typeof Request !== 'undefined' && resource instanceof Request && resource.method) {
          method = String(resource.method).toUpperCase();
        }

        if (typeof resource === 'string') {
          url = resource;
        } else if (typeof Request !== 'undefined' && resource instanceof Request && resource.url) {
          url = resource.url;
        } else if (typeof URL !== 'undefined' && resource instanceof URL) {
          url = resource.href;
        } else if (resource && resource.href) {
          url = resource.href;
        } else if (resource) {
          url = String(resource);
        }
      } catch (err) {
        // Safe extraction fallback
      }

      var promise = originalFetch.apply(this, arguments);

      // Only inspect POST requests
      if (method === 'POST') {
        promise.then(function(response) {
          try {
            var status = response.status;
            // Only capture bodySnippet for 2xx responses
            if (status >= 200 && status < 300) {
              response.clone().text().then(function(text) {
                var snippet = (text || '').slice(0, 2000);
                postNetworkResponse(url, method, status, snippet);
              }).catch(function() {
                postNetworkResponse(url, method, status, '');
              });
            } else {
              postNetworkResponse(url, method, status, '');
            }
          } catch (e) {
            // Fail silently
          }
        }).catch(function() {
          // Promise rejection (network failure, aborted request, etc.)
        });
      }

      return promise;
    };
  }

  // ==========================================
  // 2. Intercept XMLHttpRequest
  // ==========================================
  if (typeof window.XMLHttpRequest === 'function') {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        this.__hlMethod = (method || '').toUpperCase();
        this.__hlUrl = (typeof url === 'string') ? url : String(url);
      } catch (e) {
        // Ignore errors
      }
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      try {
        if (this.__hlMethod === 'POST') {
          var xhr = this;
          xhr.addEventListener('load', function() {
            try {
              var status = xhr.status;
              var snippet = '';

              // Only capture bodySnippet for 2xx responses
              if (status >= 200 && status < 300) {
                var respType = xhr.responseType;
                if (!respType || respType === 'text') {
                  snippet = (xhr.responseText || '').slice(0, 2000);
                } else if (respType === 'json' && xhr.response) {
                  try {
                    var jsonStr = typeof xhr.response === 'string'
                      ? xhr.response
                      : JSON.stringify(xhr.response);
                    snippet = (jsonStr || '').slice(0, 2000);
                  } catch (je) {
                    snippet = '';
                  }
                }
              }

              postNetworkResponse(xhr.__hlUrl, xhr.__hlMethod, status, snippet);
            } catch (le) {
              // Ignore errors
            }
          });
        }
      } catch (se) {
        // Ignore errors
      }

      return originalSend.apply(this, arguments);
    };
  }

  // ==========================================
  // 3. Listen for Content Script Messages
  // ==========================================
  window.addEventListener('message', function(event) {
    if (event.source !== window || !event.data) {
      return;
    }
    if (event.data.source === 'hackathon-logger-cs') {
      // Configuration or ping from content script (reserved for future extensions)
    }
  });

})();
