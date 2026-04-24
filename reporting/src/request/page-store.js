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

import logger from '../logger.js';
import ChromeStorageMap from './utils/chrome-storage-map.js';

const PAGE_TTL = 1000 * 60 * 60; // 1 hour

const PAGE_LOADING_STATE = {
  COMMITTED: 'committed',
  COMPLETE: 'complete',
};

function makePageActive(page, active) {
  if (active && page.activeFrom === 0) {
    page.activeFrom = Date.now();
  } else if (!active && page.activeFrom > 0) {
    page.activeTime += Date.now() - page.activeFrom;
    page.activeFrom = 0;
  }
}

function createPage({ tabId, documentId, url, isPrivate, active }) {
  return {
    id: tabId,
    documentId,
    documentIds: [documentId],
    url: url || '',
    isPrivate: !!isPrivate,
    isPrivateServer: false,
    created: Date.now(),
    destroyed: null,
    state: PAGE_LOADING_STATE.COMMITTED,
    activeTime: 0,
    activeFrom: active ? Date.now() : 0,
    requestStats: {},
    annotations: {},
    counter: 0,
  };
}

export default class PageStore {
  #notifyPageStageListeners;
  // rootDocumentId -> page; persisted across SW restarts.
  #pages;
  // Any documentId (root or sub-frame) -> owning page. Rebuilt on init.
  #documentIndex;
  // tabId -> { isPrivate, active }; used at commit time so a new page
  // inherits the current tab's flags.
  #tabContext;

  constructor({ notifyPageStageListeners }) {
    this.#pages = new ChromeStorageMap({
      storageKey: 'wtm-request-reporting:page-store:pages',
      ttlInMs: PAGE_TTL,
    });
    this.#documentIndex = new Map();
    this.#tabContext = new Map();
    this.#notifyPageStageListeners = notifyPageStageListeners;
  }

  async init() {
    await this.#pages.isReady;
    for (const page of this.#pages.values()) {
      for (const docId of page.documentIds) {
        this.#documentIndex.set(docId, page);
      }
    }
    chrome.tabs.onCreated.addListener(this.#onTabCreated);
    chrome.tabs.onUpdated.addListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.addListener(this.#onTabRemoved);
    chrome.tabs.onActivated.addListener(this.#onTabActivated);
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);
    chrome.webNavigation.onCompleted.addListener(this.#onNavigationCompleted);
    // Not available on Firefox Android.
    chrome.windows?.onFocusChanged?.addListener(this.#onWindowFocusChanged);

    for (const tab of await chrome.tabs.query({})) {
      this.#onTabCreated(tab);
    }
    // Emit any stored page whose documents the browser no longer has.
    await this.flush();
  }

  unload() {
    this.#documentIndex.clear();
    this.#tabContext.clear();
    chrome.tabs.onCreated.removeListener(this.#onTabCreated);
    chrome.tabs.onUpdated.removeListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.removeListener(this.#onTabRemoved);
    chrome.tabs.onActivated.removeListener(this.#onTabActivated);
    chrome.webNavigation.onCommitted.removeListener(
      this.#onNavigationCommitted,
    );
    chrome.webNavigation.onCompleted.removeListener(
      this.#onNavigationCompleted,
    );
    chrome.windows?.onFocusChanged?.removeListener(this.#onWindowFocusChanged);
  }

  checkIfEmpty() {
    return this.#pages.countNonExpiredKeys() === 0;
  }

  // Test helper: returns the first stored page for `tabId`.
  findPageForTab(tabId) {
    for (const page of this.#pages.values()) {
      if (page.id === tabId) return page;
    }
    return undefined;
  }

  // Emit every stored page whose documents are no longer live. Called
  // on SW startup and on tab removal.
  async flush() {
    const live = await this.#collectLiveDocumentIds();
    for (const rootDocumentId of Array.from(this.#pages.keys())) {
      const page = this.#pages.get(rootDocumentId);
      if (!page) continue;
      if (!page.documentIds.some((d) => live.has(d))) {
        this.#stagePage(page);
      }
    }
  }

  async #collectLiveDocumentIds() {
    const live = new Set();
    let tabs;
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      logger.debug('PageStore: tabs.query failed during flush', e);
      return live;
    }
    await Promise.all(
      tabs.map((tab) =>
        chrome.webNavigation
          .getAllFrames({ tabId: tab.id })
          .then((frames) => {
            for (const frame of frames || []) {
              if (frame.documentId) live.add(frame.documentId);
            }
          })
          .catch(() => {}),
      ),
    );
    return live;
  }

  #stagePage(page) {
    makePageActive(page, false);
    page.destroyed = Date.now();
    for (const docId of page.documentIds) {
      if (this.#documentIndex.get(docId) === page) {
        this.#documentIndex.delete(docId);
      }
    }
    this.#pages.delete(page.documentId);
    this.#notifyPageStageListeners(page);
  }

  #indexDocument(page, documentId) {
    if (!page.documentIds.includes(documentId)) {
      page.documentIds.push(documentId);
    }
    this.#documentIndex.set(documentId, page);
  }

  #setTabActive(tabId, active) {
    const ctx = this.#tabContext.get(tabId);
    if (ctx) ctx.active = active;
    for (const page of this.#pages.values()) {
      if (page.id === tabId) {
        makePageActive(page, active);
        this.#pages.set(page.documentId, page);
      }
    }
  }

  #onTabCreated = (tab) => {
    this.#tabContext.set(tab.id, {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
    });
  };

  #onTabUpdated = (tabId, _info, tab) => {
    const ctx = {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
    };
    this.#tabContext.set(tabId, ctx);
    for (const page of this.#pages.values()) {
      if (page.id === tabId) {
        page.isPrivate = ctx.isPrivate;
        makePageActive(page, ctx.active);
        this.#pages.set(page.documentId, page);
      }
    }
  };

  #onTabRemoved = (tabId) => {
    this.#tabContext.delete(tabId);
    // Tab is gone from tabs.query + webNavigation.getAllFrames, so its
    // pages won't be in the live set and flush will emit them.
    this.flush().catch((e) =>
      logger.debug('PageStore: flush after onRemoved failed', e),
    );
  };

  #onTabActivated = ({ previousTabId, tabId }) => {
    if (previousTabId) {
      this.#setTabActive(previousTabId, false);
    } else {
      for (const otherTabId of this.#tabContext.keys()) {
        if (otherTabId !== tabId) this.#setTabActive(otherTabId, false);
      }
    }
    this.#setTabActive(tabId, true);
  };

  #onWindowFocusChanged = async (focusedWindowId) => {
    for (const { id, windowId } of await chrome.tabs.query({ active: true })) {
      this.#setTabActive(id, windowId === focusedWindowId);
    }
  };

  #onNavigationCommitted = ({
    frameId,
    tabId,
    documentId,
    parentDocumentId,
    url,
  }) => {
    if (frameId !== 0) {
      // Sub-frame: attach its documentId to the parent's owning page.
      if (this.#documentIndex.has(documentId)) return;
      const owner = parentDocumentId
        ? this.#documentIndex.get(parentDocumentId)
        : null;
      if (!owner) return;
      this.#indexDocument(owner, documentId);
      this.#pages.set(owner.documentId, owner);
      return;
    }
    // Main-frame. For a bfcache restore the documentId still exists
    // in storage — keep that record and its accumulated stats.
    let page = this.#pages.get(documentId);
    if (!page) {
      const ctx = this.#tabContext.get(tabId) || {};
      page = createPage({ tabId, documentId, url, ...ctx });
    }
    page.state = PAGE_LOADING_STATE.COMMITTED;
    page.url = url;
    this.#indexDocument(page, documentId);
    this.#pages.set(documentId, page);
  };

  #onNavigationCompleted = ({ frameId, documentId }) => {
    if (frameId !== 0) return;
    const page = this.#pages.get(documentId);
    if (!page) return;
    page.state = PAGE_LOADING_STATE.COMPLETE;
    this.#pages.set(documentId, page);
  };

  getPageForRequest({ documentId, parentDocumentId, documentLifecycle }) {
    // Prerendered documents were never activated by the user;
    // attributing trackers to them would report pages the user never
    // saw. `pending_deletion` (beforeunload/pagehide late beacons) and
    // `cached` (bfcache pagehide) are legitimate.
    if (documentLifecycle === 'prerender') return null;
    if (documentId) {
      const direct = this.#documentIndex.get(documentId);
      if (direct) return direct;
    }
    // A sub-frame's webRequest can fire before its onCommitted is
    // processed, and the iframe's own HTML fetch may have no
    // documentId at all. Resolve via parentDocumentId and remember
    // the sub-frame's documentId for the next event.
    if (parentDocumentId) {
      const owner = this.#documentIndex.get(parentDocumentId);
      if (owner) {
        if (documentId) {
          this.#indexDocument(owner, documentId);
          this.#pages.set(owner.documentId, owner);
        }
        return owner;
      }
    }
    return null;
  }
}
