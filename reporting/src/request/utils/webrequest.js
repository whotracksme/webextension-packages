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

import { parse } from '../../utils/url.js';
import { truncateDomain } from './utils.js';

const VALID_RESPONSE_PROPERTIES = {
  onBeforeRequest: ['cancel', 'redirectUrl'],
  onBeforeSendHeaders: ['cancel', 'requestHeaders'],
  onSendHeaders: [],
  onHeadersReceived: ['cancel', 'redirectUrl', 'responseHeaders'],
  onAuthRequired: ['cancel'],
  onResponseStarted: [],
  onBeforeRedirect: [],
  onCompleted: [],
  onErrorOccurred: [],
};

function modifyHeaderByType(headers, name, value) {
  const lowerCaseName = name.toLowerCase();
  const filteredHeaders = headers.filter(
    (h) => h.name.toLowerCase() !== lowerCaseName,
  );
  if (value) {
    filteredHeaders.push({ name, value });
  }
  return filteredHeaders;
}

/**
 * Small abstraction on top of blocking responses expected by WebRequest API. It
 * provides a few helpers to block, redirect or modify headers. It is also able
 * to create a valid blocking response taking into account platform-specific
 * allowed capabilities.
 */
export class BlockingResponse {
  constructor(details, event) {
    this.details = details;

    // Blocking response
    this.redirectUrl = undefined;
    this.cancel = undefined;
    this.responseHeaders = undefined;
    this.requestHeaders = undefined;
    this.event = event;
  }

  redirectTo(url) {
    this.redirectUrl = url;
  }

  block() {
    this.cancel = true;
  }

  modifyHeader(name, value) {
    this.requestHeaders = modifyHeaderByType(
      this.requestHeaders || this.details.requestHeaders || [],
      name,
      value,
    );
  }

  modifyResponseHeader(name, value) {
    this.responseHeaders = modifyHeaderByType(
      this.responseHeaders || this.details.responseHeaders || [],
      name,
      value,
    );
  }

  toWebRequestResponse() {
    const allowedProperties = VALID_RESPONSE_PROPERTIES[this.event];
    const response = {};

    for (let i = 0; i < allowedProperties.length; i += 1) {
      const prop = allowedProperties[i];
      const value = this[prop];
      if (value !== undefined) {
        response[prop] = value;
      }
    }

    return response;
  }
}

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
export class WebRequestContext {
  /**
   * Chrome-only: populate Ghostery-side fields on a webRequest details
   * object and resolve the owning page by documentId.
   */
  static fromDetails(details, documentStore) {
    const context = details;

    if (!context.url) {
      return null;
    }

    const isMainFrame = context.type === 'main_frame';
    const page = documentStore.getDocumentForRequest(context);

    context.page = page;
    // For main-frame requests the first-party URL is the request URL
    // itself. For everything else it's the owning document's URL.
    context.tabUrl = isMainFrame ? context.url : page?.url || '';
    context.isPrivate = page ? page.isPrivate : null;
    context.isMainFrame = isMainFrame;

    return new WebRequestContext(context);
  }

  constructor(details) {
    Object.assign(this, details);

    // Lazy attributes
    this._requestHeadersMap = null;
    this._responseHeadersMap = null;

    this.urlParts = parse(this.url);
    this.tabUrlParts = parse(this.tabUrl);
    this.truncatedDomain = truncateDomain(this.urlParts.domainInfo, 2);
  }

  incrementStat(statName, c) {
    const stats = (this.page.requestStats[this.truncatedDomain] ||= {});
    stats[statName] = (stats[statName] || 0) + (c || 1);
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
