/**
 * WhoTracks.Me
 * https://whotracks.me/
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import logger from './logger';
import {
  TemporarilyUnableToFetchUrlError,
  PermanentlyUnableToFetchUrlError,
  RateLimitedByServerError,
  UnableToOverrideHeadersError,
  MultiStepDoublefetchNotSupportedError,
  DynamicDoublefetchNotSupportedError,
} from './errors';
import { requireString, split0 } from './utils';
import SeqExecutor from './seq-executor';
import { randomBetween } from './random';

const SECOND = 1000;

// This ID must not be used by other parts of the extension.
const RESERVED_DNR_RULE_ID_HEADER_OVERRIDE = 1333;
const RESERVED_DNR_RULE_ID_OFFSCREEN = 1334;

/**
 * Depending on the context, there are different ways how requests are being
 * triggered. For instance, the normal one is to use the fetch API; but
 * with dynamic rendering using offscreen, it will be technically triggered
 * from an iframe. That impacts how APIs should be later interpreted.
 */
const REQUEST_TYPE = {
  FETCH_API: Symbol('FETCH_API'),
  IFRAME: Symbol('IFRAME'),
};

// maps our REQUEST_TYPE to the type used in the webRequestAPI
function matchesWebRequestApiType(requestType, webRequestApiType) {
  if (requestType === REQUEST_TYPE.FETCH_API) {
    return webRequestApiType === 'xmlhttprequest';
  }
  if (requestType === REQUEST_TYPE.IFRAME) {
    return webRequestApiType === 'sub_frame';
  }
  throw new Error(`Unexpected requestType: ${requestType}`);
}

// maps our REQUEST_TYPE to the resource Type array used by the DNR API
function requestTypeToDNRResourceTypes(requestType) {
  if (requestType === REQUEST_TYPE.FETCH_API) {
    return ['xmlhttprequest'];
  }
  if (requestType === REQUEST_TYPE.IFRAME) {
    return ['sub_frame'];
  }
  throw new Error(`Unexpected requestType: ${requestType}`);
}

function getExtensionDomain() {
  getExtensionDomain.cached =
    getExtensionDomain.cached || new URL(chrome.runtime.getURL('')).host;
  return getExtensionDomain.cached;
}

function identicalExceptForSearchParams(url1, url2) {
  if (url1 === url2) {
    return true;
  }
  const x = new URL(url1);
  const y = new URL(url2);
  x.search = '';
  y.search = '';
  return x.toString() === y.toString();
}

// A list of safe URL parameter modifier operations.
// Rule of thumb:
// * builtins to remove or randomize should be safe.
// * replacing by arbitrary values could lead to unintended effects
//   (e.g. for sites that can be redirected via URL parameters)
const BUILTIN_PARAM_MODIFIERS = {
  /**
   * Replaced the old value with a random one (10-20 alpha-numeric characters).
   */
  random1: (oldValue) => {
    requireString(oldValue);

    const length = Math.round(randomBetween(6, 14));
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    let result = '';
    const characters =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.- ';
    for (let i = 0; i < length; i++) {
      result += characters[array[i] % characters.length];
    }
    return result.trim();
  },
};

function createLocalUrl(url, params) {
  const paramEntries = Object.entries(params);
  if (paramEntries.length === 0) {
    return url;
  }

  const modifiedUrl = new URL(url);
  for (const [operation, queryKeyNames] of paramEntries) {
    const func = BUILTIN_PARAM_MODIFIERS[operation];
    if (!func) {
      throw new Error(`Unsupported operation: <<${operation}>>`);
    }
    const { searchParams } = modifiedUrl;
    for (const key of queryKeyNames) {
      const val = searchParams.get(key);
      if (val !== null) {
        searchParams.set(key, func(val));
      }
    }
  }
  return modifiedUrl.toString();
}

/**
 * Note: 429 (too many requests) is intentionally not included in the list.
 * Even though it is by definition a temporary error, it depends on the context
 * whether it should be retried. To reflect that, it is a special case
 * with its own exception class (RateLimitedByServerError) and a flag
 * to "anonymousHttpGet" to override whether it should be retried or not
 * ("treat429AsPermanentError").
 */
const httpStatusCodesThatShouldBeRetried = [
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  599, // Network Connect Timeout Error
];

// Overwrites the headers of the request to the given URL.
// It automatically selects the mechanism (e.g. webRequestAPI, DNR)
// based on the available APIs.
//
// Returns a cleanup callback to undo the changes.
async function headerOverride(params) {
  const { headers } = params;
  if (!headers || Object.keys(headers).length === 0) {
    return () => {};
  }

  if (
    chrome?.webRequest?.onBeforeSendHeaders &&
    chrome.runtime.getManifest().permissions.includes('webRequestBlocking')
  ) {
    return headerOverrideViaWebRequestAPI(params);
  } else if (chrome?.declarativeNetRequest?.updateSessionRules) {
    return await headerOverrideViaDNR(params);
  } else {
    throw new UnableToOverrideHeadersError();
  }
}

// The following code overwrite the headers of the request.
// Note that "fetch" allows to overwrite headers in a simple declarative way,
// but unfortunately it is limited. For example, it is not possible to
// overwrite the cookie headers. The following code will work for all
// type of headers.
//
// The matching logic is not perfect, but should be fairly accurate.
// Ideally, we would want to run the handler only for the request that we
// are about to trigger, but not for any other requests to avoid unintended
// side-effects. To mitigate the risk, uninstall the handler at the first
// opportunity: either if it is called or if the request finished
// (and we know the handle will never be called).
function headerOverrideViaWebRequestAPI({ url, headers, requestType }) {
  let uninstallHandler;
  let webRequestHandler = (details) => {
    if (
      details.url !== url ||
      details.method !== 'GET' ||
      !matchesWebRequestApiType(requestType, details.type)
    ) {
      // does that match the request that we intended to trigger
      return {};
    }

    // match: now we can already deregister the listener
    // (it should not be executed multiple times)
    uninstallHandler();
    const headerNames = Object.keys(headers);
    const normalizedHeaders = headerNames.map((x) => x.toLowerCase());

    /* eslint-disable no-param-reassign */
    details.requestHeaders = details.requestHeaders.filter(
      (header) => !normalizedHeaders.includes(header.name.toLowerCase()),
    );

    headerNames.forEach((name) => {
      details.requestHeaders.push({
        name,
        value: headers[name],
      });
    });

    return {
      requestHeaders: details.requestHeaders,
    };
  };

  logger.debug('Installing temporary webrequest handler for URL:', url);
  chrome.webRequest.onBeforeSendHeaders.addListener(
    webRequestHandler,
    {
      urls: [url],
    },
    ['blocking', 'requestHeaders'],
  );

  uninstallHandler = () => {
    if (webRequestHandler) {
      logger.debug('Removing temporary webrequest handler for URL:', url);
      chrome.webRequest.onBeforeSendHeaders.removeListener(webRequestHandler);
      webRequestHandler = null;
    }
  };
  return uninstallHandler;
}

// Like headerOverrideViaWebRequestAPI, but using the DNR API.
async function headerOverrideViaDNR({ url, headers, requestType }) {
  const requestHeaders = Object.entries(headers).map(([header, value]) => ({
    header,
    operation: 'set',
    value,
  }));
  const rule = {
    id: RESERVED_DNR_RULE_ID_HEADER_OVERRIDE,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders,
    },
    condition: {
      urlFilter: url,
      resourceTypes: requestTypeToDNRResourceTypes(requestType),
      initiatorDomains: [getExtensionDomain()],
    },
  };

  logger.debug('Installing temporary DNR rule for URL:', url);
  const cleanup = await addDNRSessionRule(rule);

  return () => {
    logger.debug('Removing temporary DNR rule for URL:', url);
    return cleanup();
  };
}

async function addDNRSessionRule(rule) {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] });
  } catch (e) {
    try {
      logger.warn(
        'Unable to install DNR rule. Trying to delete rule first:',
        rule,
        e,
      );
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [rule.id],
      });
    } catch (e2) {
      logger.warn('Retry not possible (unable to remove DNR rule):', rule, e2);
      throw e;
    }

    logger.debug('Second attempt to install DNR rule:', rule);
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [rule],
    });
    logger.debug('Succeed in install DNR rule on the second attempt:', rule);
  }

  return () => {
    return chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [rule.id],
      })
      .catch((e) => {
        logger.error('cleanup failed: unable to remove DNR rule:', rule, e);
      });
  };
}

async function tryCloseOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    if (e.message === 'No current offscreen document.') {
      logger.debug('offscreen document already closed.');
    } else {
      throw e;
    }
  }
}
const OFFSCREEN_DOCUMENT_PREFIX = 'offscreen/doublefetch';
const OFFSCREEN_DOCUMENT_PATH = `${OFFSCREEN_DOCUMENT_PREFIX}/index.html`;

async function withOffscreenDocumentReady(url, headers, asyncCallback) {
  const cleanups = [];
  try {
    const domain = new URL(url).hostname;
    const rule = {
      id: RESERVED_DNR_RULE_ID_OFFSCREEN,
      condition: {
        initiatorDomains: [chrome.runtime.id],
        requestDomains: [domain],
        resourceTypes: ['sub_frame'],
      },
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'X-Frame-Options', operation: 'remove' },
          { header: 'Frame-Options', operation: 'remove' },
        ],
      },
    };

    const undoDNRChange = await addDNRSessionRule(rule);
    cleanups.push(undoDNRChange);

    await chrome.scripting.registerContentScripts([
      {
        id: 'offscreen-fix',
        matches: [`https://*.${domain}/*`, `https://${domain}/*`],
        js: [`${OFFSCREEN_DOCUMENT_PREFIX}/offscreen-fix.js`],
        runAt: 'document_start',
        allFrames: true,
        world: 'MAIN',
      },
    ]);
    cleanups.push(() => {
      chrome.scripting
        .unregisterContentScripts({
          ids: ['offscreen-fix'],
        })
        .catch((e) => {
          logger.error(
            'cleanup failed: unable to remove offscreen content script:',
            e,
          );
        });
    });

    const undoHeaderOverride = await headerOverride({
      headers,
      url,
      requestType: REQUEST_TYPE.IFRAME,
    });
    cleanups.push(undoHeaderOverride);

    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    if (existingContexts.length > 0) {
      // TODO: what do do here? Normally, it should not happen in our setup.
      // Maybe close the document and continue?
      logger.warn('Existing context found:', existingContexts);
      throw new Error('Unexpected: existing context found');
    }

    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['IFRAME_SCRIPTING'],
      justification: 'credentialless iframe',
    });
    cleanups.push(() => tryCloseOffscreenDocument());

    return await asyncCallback();
  } finally {
    await Promise.all(
      cleanups.map(async (x) => {
        try {
          await x();
        } catch (e) {
          logger.warn('Unexpected error while cleaning up resources:', e);
        }
      }),
    );
  }
}

// Note: the parameters are almost identical to "anonymousHttpGet"
// with the exception that "step" is not defined. The implementation
// here is only a single request, not a chain of requests.
async function singleHttpGetStep(url, params = {}) {
  const {
    headers = null,
    redirect = 'manual',
    shouldFollowRedirect = () => true,
    timeout = 15 * SECOND,
    treat429AsPermanentError = false,
    downloadLimit = 10 * 1024 * 1024, // 10 MB
    allowedContentTypes = null,
  } = params;

  if (redirect !== 'follow' && params.shouldFollowRedirect) {
    logger.warn(
      'shouldFollowRedirect ignored because redirects will be automatically resolved',
    );
  }

  const controller = new AbortController();
  const options = {
    credentials: 'omit',
    mode: 'no-cors',
    redirect,
    signal: controller.signal,
  };

  let timeoutTimer;
  let timeoutTriggered = false;
  if (timeout && timeout > 0) {
    timeoutTimer = setTimeout(() => {
      const msg = `Request to ${url} timed out (limit: ${timeout} ms)`;
      controller.abort(new TemporarilyUnableToFetchUrlError(msg));
      logger.warn(msg);
      timeoutTimer = null;
      timeoutTriggered = true;
    }, timeout);
  }

  try {
    let response;
    const undoHeaderOverride = await headerOverride({
      headers,
      url,
      requestType: REQUEST_TYPE.FETCH_API,
    });
    try {
      response = await fetch(url, options);
    } catch (e) {
      throw new TemporarilyUnableToFetchUrlError(`Failed to fetch url ${url}`, {
        cause: e,
      });
    } finally {
      await undoHeaderOverride();
    }

    if (
      response.status === 0 &&
      (response.type == 'opaqueredirect' || response.type == 'opaque')
    ) {
      throw new PermanentlyUnableToFetchUrlError(
        `Failed to fetch url ${url}: not allowed to follow redirects (response.type=${response.type})`,
      );
    }
    if (response.url !== url && !shouldFollowRedirect(response.url)) {
      throw new PermanentlyUnableToFetchUrlError(
        `Failed to fetch url ${url}: detected forbidden redirect to ${response.url}`,
      );
    }

    if (!response.ok) {
      const msg = `Failed to fetch url ${url}: ${response.statusText}`;
      if (response.status === 429) {
        if (treat429AsPermanentError) {
          throw new PermanentlyUnableToFetchUrlError(msg);
        }
        throw new RateLimitedByServerError(msg);
      }
      if (httpStatusCodesThatShouldBeRetried.includes(response.status)) {
        throw new TemporarilyUnableToFetchUrlError(msg);
      }
      throw new PermanentlyUnableToFetchUrlError(msg);
    }

    if (downloadLimit && downloadLimit > 0) {
      const contentLength = response.headers.get('content-length');
      if (contentLength && contentLength > downloadLimit) {
        const err = new PermanentlyUnableToFetchUrlError(
          `Exceeded size limit when fetching url ${url} (${contentLength} > ${downloadLimit})`,
        );
        controller.abort(err);
        throw err;
      }
    }

    if (allowedContentTypes) {
      const value = response.headers.get('content-type');
      if (value) {
        const contentType = split0(value, ';').trim().toLowerCase();
        if (!allowedContentTypes.includes(contentType)) {
          const err = new PermanentlyUnableToFetchUrlError(
            `Unexpected "Content-Type" <${contentType}> (<${value}> not in {${allowedContentTypes}})`,
          );
          controller.abort(err);
          throw err;
        }
      } else {
        logger.warn(
          'The URL',
          url,
          'did not return a "Content-Type" HTTP header.',
          'Continue and assume the types are matching...',
        );
      }
    }

    try {
      return await response.text();
    } catch (e) {
      if (timeoutTriggered) {
        throw new TemporarilyUnableToFetchUrlError(
          `Failed to fetch url ${url} because the request timed out.`,
        );
      }
      throw new TemporarilyUnableToFetchUrlError(
        `Failed to fetch url ${url} (${e.message})`,
        { cause: e },
      );
    }
  } finally {
    clearTimeout(timeoutTimer);
  }
}

// Enforces only one active double-fetch request at a time.
const LOCK = new SeqExecutor();

/**
 * Performs a HTTP Get. Given the constraints, it tries to include
 * as few information as possible (e.g. credentials from cookies will
 * be omitted).
 *
 * Optional:
 * - headers: allows to overwrite headers
 * - redirect: 'follow' (or by default, it will fail with a permanent error)
 * - shouldFollowRedirect:
 *     If redirect is set 'follow', this callback decides whether the final
 *     redirect location should be followed. By default, all redirects are
 *     accepted. Expects a function of type (finalUrl) => true|false
 * - treat429AsPermanentError:
 *     By default, HTTP 429 (too many requests) will result in a
 *     recoverable error (RateLimitedByServerError). For many use cases,
 *     that is reasonable; but for double-fetch requests, repeating may
 *     degrade user experience. Setting this flag will instead raise a
 *     PermanentlyUnableToFetchUrlError instead.
 * - downloadLimit:
 *     A best-effort attempt to define an upper bound for the number of
 *     bytes downloaded. Note that there are no guarantees that it will
 *     be able to stop bigger downloads. Also, it is based on the data
 *     that comes over the wire; in other words, *after* compression.
 * - allowedContentTypes (optional):
 *     An optional list of supported Content-Types (e.g. "text/html").
 *     If given and the HTTP "Content-Type" header does not match, the
 *     function will fail with a permanent error.
 * - steps (optional):
 *     To configure multi-step double-fetch. That means, multiple requests
 *     to the same URL can be performed; values seen in earlier request
 *     can be used in later requests. Still, the chain of requests always
 *     starts from a clean state. In other words, the temporary context is
 *     fully isolated and will be discarded once all steps have completed.
 *
 * TODO: For pages like YouTube, double-fetch fails because of consent
 * pages. In the YouTube example, the following cookie could be set:
 * "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg"
 * (Maybe there is a way to generalize?)
 */
export async function anonymousHttpGet(originalUrl, params = {}) {
  return LOCK.run(async () => {
    const { steps = [], ...sharedParams } = params;
    if (steps.length === 0) {
      return singleHttpGetStep(originalUrl, sharedParams);
    }
    if (!chrome?.webRequest?.onHeadersReceived) {
      throw new MultiStepDoublefetchNotSupportedError();
    }
    const hasDynamicSteps = steps.some((x) => x.dynamic);
    if (hasDynamicSteps && !chrome?.offscreen?.createDocument) {
      throw new DynamicDoublefetchNotSupportedError();
    }

    // The context that can be queried with the placeholder syntax (e.g.
    // "foo={{cookie:bar}}"). The context is built from the requests from
    // earlier steps. For instance, a use case is to bypass consent dialogs
    // by modifying cookies.
    const observer = {
      // to be overwritten later to mark dependencies for the next step:
      // e.g. "ctx.cookie.set('foo', '42')" will trigger onChange('cookie', 'foo', '42')
      onChange: null,
    };
    const ctx = withContextObserver(
      {
        cookie: new Map(), // default ('set-cookies' in response)
        cookie0: new Map(), // fallback ('cookies' in request)
        param: new Map(), // URL params
      },
      observer,
    );

    let content;
    for (
      let unsafeStepIdx = 0;
      unsafeStepIdx < steps.length;
      unsafeStepIdx += 1
    ) {
      const stepIdx = unsafeStepIdx; // eliminate pitfalls due to mutability
      const currentStep = steps[stepIdx];
      const nextStep = steps[stepIdx + 1];
      const localParams = {
        ...sharedParams,
        ...currentStep,
      };

      const readyForNextStep = new Promise((resolve, reject) => {
        observer.onChange = null;
        if (!currentStep.dynamic) {
          resolve();
          return;
        }

        try {
          const graph = buildDependencyGraph(nextStep);
          if (graph.allReady) {
            resolve();
            return;
          }
          observer.onChange = graph.onChange;
          graph.onReady = resolve;
        } catch (e) {
          reject(e);
        }
      });

      if (localParams.headers) {
        localParams.headers = replacePlaceholders(localParams.headers, ctx);
      }

      const localUrl = createLocalUrl(originalUrl, localParams.params || {});
      if (!identicalExceptForSearchParams(originalUrl, localUrl)) {
        // By design, this should be impossible to reach. But by enforcing it, we
        // eliminate the risk of ending up with unintended requests to different hosts.
        throw new PermanentlyUnableToFetchUrlError(
          `Rejected: local URL should only change params, but got: ${originalUrl} -> ${localUrl}`,
        );
      }

      const { origin } = new URL(localUrl);
      const matchedUrls = [`${origin}/*`];

      const onBeforeSendHeaders = (details) => {
        if (
          details.tabId !== -1 ||
          (details.type !== 'xmlhttprequest' && details.type !== 'sub_frame')
        ) {
          logger.debug('onBeforeSendHeaders[ignored]:', details);
          return;
        }

        logger.debug('onBeforeSendHeaders[match]', details);
        for (const header of details.requestHeaders) {
          if (header.name.toLowerCase() === 'cookie') {
            for (const line of header.value.split('\n')) {
              const start = line.indexOf('=');
              if (start > 0) {
                const key = line.slice(0, start);
                const value = split0(line.slice(start + 1), ';');
                ctx.cookie0.set(key, value);
              }
            }
          }
        }
        const { searchParams } = new URL(details.url);
        for (const [key, value] of [...searchParams]) {
          ctx.param.set(key, value);
        }
      };
      try {
        chrome.webRequest.onBeforeSendHeaders.addListener(
          onBeforeSendHeaders,
          { urls: matchedUrls },
          [
            'requestHeaders',
            'extraHeaders', // Note: needed for Chromium, but will be rejected by Firefox
          ],
        );
      } catch (e) {
        chrome.webRequest.onBeforeSendHeaders.addListener(
          onBeforeSendHeaders,
          { urls: matchedUrls },
          ['requestHeaders'],
        );
      }

      const onHeadersReceived = (details) => {
        if (
          details.tabId !== -1 ||
          (details.type !== 'xmlhttprequest' && details.type !== 'sub_frame')
        ) {
          logger.debug('onHeaderReceived[ignored]:', details);
          return { responseHeaders: details.responseHeaders };
        }

        logger.debug('onHeaderReceived[match]:', details);
        for (const header of details.responseHeaders) {
          if (header.name.toLowerCase() === 'set-cookie') {
            for (const line of header.value.split('\n')) {
              const start = line.indexOf('=');
              if (start > 0) {
                const key = line.slice(0, start);
                const value = split0(line.slice(start + 1), ';');
                ctx.cookie.set(key, value);
              }
            }
          }
        }
        return { responseHeaders: details.responseHeaders };
      };
      try {
        chrome.webRequest.onHeadersReceived.addListener(
          onHeadersReceived,
          { urls: matchedUrls },
          [
            'responseHeaders',
            'extraHeaders', // Note: needed for Chromium, but will be rejected by Firefox
          ],
        );
      } catch (e) {
        chrome.webRequest.onHeadersReceived.addListener(
          onHeadersReceived,
          { urls: matchedUrls },
          ['responseHeaders'],
        );
      }
      try {
        if (currentStep.dynamic) {
          // TODO: getting content of the last step is currently not implemented.
          // If needed, one idea is to use content scripts in the offscreen document.
          content = '';

          await withOffscreenDocumentReady(
            localUrl,
            localParams.headers,
            async () => {
              const { ok, error } = await chrome.runtime.sendMessage({
                target: 'offscreen:urlReporting',
                type: 'request',
                data: { url: localUrl },
              });
              if (!ok) {
                throw new Error(
                  `Unexpected error (details: ${error || '<unavailable>'})`,
                );
              }

              let timeout = null;
              const timedOut = new Promise((resolve, reject) => {
                const maxTime = params.timeout || 15 * SECOND;
                timeout = setTimeout(() => {
                  timeout = null;
                  logger.warn(
                    'Dynamic fetch of URL',
                    localUrl,
                    'exceeded the timeout of',
                    maxTime,
                    'ms. Details:',
                    {
                      localUrl,
                      currentStep,
                      nextStep,
                      ctx,
                    },
                  );
                  reject(`Timeout when dynamically fetching ${localUrl}`);
                }, maxTime);
              });
              try {
                await Promise.race([readyForNextStep, timedOut]);
              } finally {
                clearTimeout(timeout);
              }
            },
          );
        } else {
          content = await singleHttpGetStep(localUrl, localParams);
        }
      } finally {
        chrome.webRequest.onBeforeSendHeaders.removeListener(
          onBeforeSendHeaders,
        );
        chrome.webRequest.onHeadersReceived.removeListener(onHeadersReceived);
      }
    }
    return content;
  });
}

// Resolves placeholder expressions ("{{ }}"} with values provided by the
// the context. See unit test for examples.
//
// Note: exported for tests only
export function replacePlaceholders(headers, ctx) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const parts = [];
      let pos = 0;
      while (pos < value.length) {
        const start = value.indexOf('{{', pos);
        if (start < 0) {
          parts.push(value.slice(pos));
          break;
        }
        parts.push(value.slice(pos, start));
        pos = start + 2;
        const end = value.indexOf('}}', pos);
        if (end < 0) {
          throw new Error(`Corrupted placeholder expression: ${value}`);
        }

        const fullExpression = value.slice(pos, end);
        let resolved;
        for (const expr of fullExpression.split('||')) {
          if (expr.startsWith('cookie:')) {
            const key = expr.slice('cookie:'.length);
            resolved = ctx.cookie.get(key);
          } else if (expr.startsWith('cookie0:')) {
            const key = expr.slice('cookie0:'.length);
            resolved = ctx.cookie0.get(key);
          } else if (expr.startsWith('param:')) {
            const key = expr.slice('param:'.length);
            resolved = ctx.param.get(key);
          } else {
            throw new Error(
              `Unsupported expression: stopped at <<${expr}>> (full expression: ${fullExpression})`,
            );
          }
          if (resolved) {
            break;
          }
        }
        parts.push(resolved || '');
        pos = end + 2;
      }
      const newValue = parts.join('');
      return [key, newValue];
    }),
  );
}

// Note: exported for tests only
export function findPlaceholders(text) {
  const found = [];
  let pos = 0;
  for (;;) {
    const startPos = text.indexOf('{{', pos);
    if (startPos === -1) break;
    const endPos = text.indexOf('}}', startPos + 2);
    if (endPos === -1) break;

    found.push(text.slice(startPos + 2, endPos));
    pos = endPos + 2;
  }
  return found;
}

// Note: exported for tests only
export function buildDependencyGraph(nextStep) {
  const graph = {
    allReady: true,
    onChange: null,
    onReady: () => {}, // can be overwritten by the caller
  };

  // 1) find all dependencies
  // (if there are none, we can exit early without entering "observe-mode")
  if (nextStep?.headers) {
    const allTemplates = Object.values(nextStep.headers);
    if (allTemplates.length > 0) {
      // Keep track of which placeholders expression exist and by what
      // (atomic) placeholders they get resolved. For instance, in the
      // text "X={{cookie:A||cookie:B}}", there is one placeholder
      // expression ("cookie:A||cookie:B"); it resolves once either
      // "cookie:A" or "cookie:B" becomes available.
      //
      // The pending set would thus be { "cookie:A||cookie:B" }
      // and the resolvedBy mapping would be: {
      //   "cookie:A" => ["cookie:A||cookie:B"],
      //   "cookie:B" => ["cookie:A||cookie:B"]
      // }
      const pendingExpressions = new Set();
      const expressionResolvedByPlaceholder = new Map();

      for (const template of allTemplates) {
        for (const expression of findPlaceholders(template)) {
          pendingExpressions.add(expression);

          for (const placeholder of expression.split('||')) {
            const unlocks =
              expressionResolvedByPlaceholder.get(placeholder) || [];
            if (!unlocks.includes(expression)) {
              unlocks.push(expression);
            }
            expressionResolvedByPlaceholder.set(placeholder, unlocks);
          }
        }
      }

      // 2) if there are unresolved dependencies, switch to "observe-mode"
      // The caller is expected to setup the "onReady" and "onChange" hooks.
      // "onChange" should connect to the context observer.
      if (pendingExpressions.size > 0) {
        logger.debug('[observe-mode] waiting for:', pendingExpressions);
        graph.allReady = false;
        graph.onChange = (type, key, value) => {
          if (!graph.allReady && value) {
            const placeholder = `${type}:${key}`;
            const resolvedExpressions =
              expressionResolvedByPlaceholder.get(placeholder) || [];
            for (const resolved of resolvedExpressions) {
              if (pendingExpressions.delete(resolved)) {
                logger.debug(
                  '[observe-mode]',
                  placeholder,
                  '->',
                  value,
                  'resolved expression',
                  resolved,
                );
                if (pendingExpressions.size === 0) {
                  logger.debug('[observe-mode] all dependencies resolved');
                  graph.allReady = true;
                  graph.onReady();
                  return;
                }
              }
            }
          }
        };
      }
    }
  }
  return graph;
}

function withContextObserver(ctx, observer) {
  const mapTypes = Object.keys(ctx);
  mapTypes.forEach((type) => {
    ctx[type] = new Proxy(ctx[type], {
      get(target, property, receiver) {
        if (property === 'set') {
          return function (key, value) {
            // the only interesting part (the rest of the function
            // is boilerplate to delegate to the underlying map)
            if (observer.onChange) {
              observer.onChange(type, key, value);
            }
            return target.set(key, value);
          };
        }
        if (property === 'size') {
          return target.size;
        }
        const value = Reflect.get(target, property, receiver);
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      },
    });
  });
  return ctx;
}
