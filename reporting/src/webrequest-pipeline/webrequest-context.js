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

import { parse } from '../utils/url.js';
import logger from './logger.js';

/**
 * Transform an array of headers (i.e.: `{ name, value }`) into a `Map`.
 */
function createHeadersGetter(headers) {
  const headersMap = new Map();

  for (let i = 0; i < headers.length; i += 1) {
    const { name, value } = headers[i];
    headersMap.set(name.toLowerCase(), value);
  }

  return headersMap;
}

/**
 * Wrap webRequest's details to provide convenient helpers.
 */
export default class WebRequestContext {
  /**
   * "Smart" constructor for `WebRequestContext`. It will make sure that the same
   * information is provided for different browsers (e.g.: Chrome and Firefox) as
   * well as provide convenient helpers for parsed URLs, etc. It will also not
   * return a wrapper for background requests.
   */
  static fromDetails(details, pageStore, event) {
    const context = details;

    // Check if we have a URL
    if (!context.url) {
      logger.log('Ignoring request with empty url', context);
      return null;
    }

    // Main frames book keeping
    if (context.type === 'main_frame') {
      pageStore.onMainFrame(context, event);
    }

    // Get context on this page
    const page = pageStore.getPageForRequest(context);

    // Ghostery-specific extensions to webRequest details
    context.page = page;
    context.tabUrl = context.tabUrl || (page && page.url);
    context.isPrivate = page ? page.isPrivate : null;
    context.isMainFrame = context.type === 'main_frame';
    context.isRedirect = page && context.isMainFrame && page.isRedirect;

    if (!context.tabUrl) {
      context.tabUrl =
        context.originUrl || context.initiator || context.documentUrl;
    }

    return new WebRequestContext(context);
  }

  constructor(details) {
    Object.assign(this, details);

    // Lazy attributes
    this._requestHeadersMap = null;
    this._responseHeadersMap = null;

    this.urlParts = parse(this.url);
    this.tabUrlParts = parse(this.tabUrl);
  }

  /**
   * Optionally, a CNAME record can be requested from DNS for `this.url`. If
   * available, it will be communicated by calling this method. We then set two
   * new attributes on the WebRequestContext object so that users of the
   * pipeline can access this information.
   */
  setCNAME(cname) {
    this.cnameUrl = this.url.replace(this.urlParts.hostname, cname);
    this.cnameUrlParts = parse(this.cnameUrl);
  }

  getRequestHeader(name) {
    if (this._requestHeadersMap === null) {
      this._requestHeadersMap = createHeadersGetter(this.requestHeaders || []);
    }

    return this._requestHeadersMap.get(name.toLowerCase());
  }

  getResponseHeader(name) {
    if (this._responseHeadersMap === null) {
      this._responseHeadersMap = createHeadersGetter(
        this.responseHeaders || [],
      );
    }

    return this._responseHeadersMap.get(name.toLowerCase());
  }

  getCookieData() {
    return this.getRequestHeader('Cookie');
  }

  getReferrer() {
    return this.getRequestHeader('Referer');
  }
}
