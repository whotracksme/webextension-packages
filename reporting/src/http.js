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
} from './errors';
import { split0 } from './utils';
import SeqExecutor from './seq-executor';

const SECOND = 1000;

// This ID must not be used by other parts of the extension.
const RESERVED_DNR_RULE_ID = 1333;

function getExtensionDomain() {
  getExtensionDomain.cached =
    getExtensionDomain.cached || new URL(chrome.runtime.getURL('')).host;
  return getExtensionDomain.cached;
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
function headerOverrideViaWebRequestAPI(url, headers) {
  let uninstallHandler;
  let webRequestHandler = (details) => {
    if (
      details.url !== url ||
      details.type !== 'xmlhttprequest' ||
      details.method !== 'GET'
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
async function headerOverrideViaDNR(url, headers) {
  const requestHeaders = Object.entries(headers).map(([header, value]) => ({
    header,
    operation: 'set',
    value,
  }));
  const rule = {
    id: RESERVED_DNR_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders,
    },
    condition: {
      urlFilter: url,
      resourceTypes: ['xmlhttprequest'],
      initiatorDomains: [getExtensionDomain()],
    },
  };
  logger.debug('Installing temporary DNR rule for URL:', url);
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [rule],
  });
  return () => {
    logger.debug('Removing temporary DNR rule for URL:', url);
    chrome.declarativeNetRequest
      .updateSessionRules({
        removeRuleIds: [rule.id],
      })
      .catch((e) => {
        logger.warn('Failed to remove DNR rule', e);
      });
  };
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
    // optional cleanup operation that will be run after the request is completed
    let cleanup = () => {};
    if (headers && Object.keys(headers).length > 0) {
      if (
        chrome?.webRequest?.onBeforeSendHeaders &&
        chrome.runtime.getManifest().permissions.includes('webRequestBlocking')
      ) {
        cleanup = headerOverrideViaWebRequestAPI(url, headers);
      } else if (chrome?.declarativeNetRequest?.updateSessionRules) {
        cleanup = await headerOverrideViaDNR(url, headers);
      } else {
        throw new UnableToOverrideHeadersError();
      }
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (e) {
      throw new TemporarilyUnableToFetchUrlError(`Failed to fetch url ${url}`, {
        cause: e,
      });
    } finally {
      cleanup();
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
export async function anonymousHttpGet(url, params = {}) {
  return LOCK.run(async () => {
    const { steps = [], ...sharedParams } = params;
    if (steps.length === 0) {
      return singleHttpGetStep(url, sharedParams);
    }
    if (!chrome?.webRequest?.onHeadersReceived) {
      throw new MultiStepDoublefetchNotSupportedError();
    }

    // The context that can be queried with the placeholder syntax (e.g.
    // "foo={{cookies:bar}"). The context is built from the requests from
    // earlier steps. Currently, only cookies are provided, because this
    // is a common use case to bypass consent dialogs; if needed we can
    // extend it to other values (e.g. HTTP headers).
    const ctx = {
      cookie: new Map(),
    };
    const handler = (details) => {
      for (let header of details.responseHeaders) {
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
        handler,
        { urls: [url] },
        [
          'responseHeaders',
          'extraHeaders', // Note: needed for Chromium, but will be rejected by Firefox
        ],
      );
    } catch (e) {
      chrome.webRequest.onHeadersReceived.addListener(
        handler,
        { urls: [url] },
        ['responseHeaders'],
      );
    }
    try {
      let content;
      for (const step of steps) {
        const localParams = {
          ...sharedParams,
          ...step,
        };
        if (localParams.headers) {
          localParams.headers = replacePlaceholders(localParams.headers, ctx);
        }
        content = await singleHttpGetStep(url, localParams);
      }
      return content;
    } finally {
      chrome.webRequest.onHeadersReceived.removeListener(handler);
    }
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
        const expression = value.slice(pos, end);
        if (expression.startsWith('cookie:')) {
          const cookieKey = expression.slice('cookie:'.length);
          parts.push(ctx.cookie.get(cookieKey) || '');
        } else {
          throw new Error('currently only cookies are support');
        }
        pos = end + 2;
      }
      const newValue = parts.join('');
      return [key, newValue];
    }),
  );
}
