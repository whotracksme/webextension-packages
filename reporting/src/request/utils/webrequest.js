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
    this.shouldIncrementCounter = undefined;
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
   * "Smart" constructor for `WebRequestContext`. It will make sure that the same
   * information is provided for different browsers (e.g.: Chrome and Firefox) as
   * well as provide convenient helpers for parsed URLs, etc. It will also not
   * return a wrapper for background requests.
   */
  static fromDetails(details, pageStore, webRequestStore) {
    const context = details;

    // Check if we have a URL
    if (!context.url) {
      return null;
    }

    // Sub frames book keeping
    if (context.type === 'sub_frame') {
      pageStore.onSubFrame(context);
    }

    // Get context on this page
    const page = pageStore.getPageForRequest(context);

    // Ghostery-specific extensions to webRequest details
    context.page = page;
    context.tabUrl = context.tabUrl || (page && page.url);
    context.isPrivate = page ? page.isPrivate : null;
    context.isMainFrame = context.type === 'main_frame';

    if (!context.tabUrl) {
      context.tabUrl =
        context.originUrl || context.initiator || context.documentUrl;
    }

    const metadata = webRequestStore.updateMetadata(details);
    return new WebRequestContext(context, metadata);
  }

  constructor(details, metadata) {
    Object.assign(this, details);

    // Lazy attributes
    this._requestHeadersMap = null;
    this._responseHeadersMap = null;

    this.urlParts = parse(this.url);
    this.tabUrlParts = parse(this.tabUrl);
    this.truncatedDomain = truncateDomain(this.urlParts.domainInfo, 2);
    this.metadata = metadata;
  }

  incrementStat(statName, c) {
    const stats = (this.page.requestStats[this.truncatedDomain] ||= {});
    stats[statName] = (stats[statName] || 0) + (c || 1);

    this.metadata.stats[this.truncatedDomain] ||= {};
    this.metadata.stats[this.truncatedDomain][statName] =
      (this.metadata.stats[this.truncatedDomain][statName] || 0) + (c || 1);
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

export class WebRequestStore {
  constructor() {
    this.requests = new Map();
    this.tabs = new Map();
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);
    chrome.tabs.onRemoved.addListener(this.#onTabsRemoved);
  }

  #onTabsRemoved = (tabId) => {
    const tab = this.tabs.get(tabId);
    if (!tab) {
      console.error('XXXX must have tab', tabId, this.tabs);
    }
    for (const document of tab.documents) {
      if (document.requestIds.size !== 0) {
        this.#stageDocument(document);
      }
    }
    this.tabs.delete(tabId);
  };

  #onNavigationCommitted = (details) => {
    const { documentId, parentDocumentId, tabId, frameType } = details;

    if (frameType === 'outermost_frame') {
      const tab = this.tabs.get(tabId) || {
        documents: [],
      };
      this.tabs.set(tabId, tab);

      for (const document of tab.documents) {
        if (document.requestIds.size !== 0) {
          this.#stageDocument(document);
        }
      }

      tab.documents.push({
        documentId,
        subDocumentIds: new Set(),
        requestIds: new Set(),
      });
    } else if (frameType === 'sub_frame') {
      const tab = this.tabs.get(tabId);
      const document = tab.documents.find(
        (d) =>
          d.documentId === parentDocumentId ||
          d.subDocumentIds.has(parentDocumentId),
      );
      document.subDocumentIds.add(documentId);
    }
  };

  updateMetadata(details) {
    const { requestId, documentId, parentDocumentId, tabId, type } = details;

    if (tabId === -1 || type === 'main_frame') {
      return;
    }

    const request = this.requests.get(requestId) || {
      stats: {},
      parentDocumentId,
      documentId,
      requestId,
    };
    this.requests.set(requestId, request);

    const tab = this.tabs.get(tabId);

    if (!tab) {
      console.warn('dropping stats for requestId', requestId);
      return;
    }

    const document = tab.documents.find(
      (d) =>
        d.documentId === documentId ||
        d.documentId === parentDocumentId ||
        d.subDocumentIds.has(documentId) ||
        d.subDocumentIds.has(parentDocumentId),
    );

    document.requestIds.add(requestId);

    return request;
  }

  #stageDocument(document) {
    const stats = {};
    for (const requestId of document.requestIds) {
      const request = this.requests.get(requestId);
      this.requests.delete(requestId);
      document.requestIds.delete(requestId);

      for (const domain of Object.keys(request.stats)) {
        stats[domain] ||= {};
        for (const key of Object.keys(request.stats[domain])) {
          stats[domain][key] =
            (stats[domain][key] || 0) + request.stats[domain][key];
        }
      }
    }
    console.warn(stats);
  }
}
