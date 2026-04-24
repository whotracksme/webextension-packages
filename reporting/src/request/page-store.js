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
  NAVIGATING: 'navigating',
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
    state: PAGE_LOADING_STATE.NAVIGATING,
    activeTime: 0,
    activeFrom: active ? Date.now() : 0,
    requestStats: {},
    annotations: {},
    counter: 0,
  };
}

export default class PageStore {
  #notifyPageStageListeners;
  // rootDocumentId -> page. Persisted across SW restarts.
  #pages;
  // documentId -> page. In-memory index rebuilt from #pages on init.
  // Both root main-frame and sub-frame documentIds point at the same
  // owning page.
  #documentIndex;
  // tabId -> { isPrivate, active, url }. Buffers tab-lifecycle state
  // so a page born in onNavigationCommitted inherits correct flags
  // even when tabs.onCreated / onActivated fired before the commit.
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

    // Note: not available on Firefox Android
    chrome.windows?.onFocusChanged?.addListener(this.#onWindowFocusChanged);

    // Populate tab context for already-open tabs.
    for (const tab of await chrome.tabs.query({})) {
      this.#onTabCreated(tab);
    }
    // Startup sweep: any page in storage whose documents the browser
    // no longer has is emitted and dropped.
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

  // Test / diagnostics helper. Returns the most recent page still
  // held in storage for a given tabId, or undefined if none.
  findPageForTab(tabId) {
    for (const page of this.#pages.values()) {
      if (page.id === tabId) return page;
    }
    return undefined;
  }

  /**
   * Emit every stored page whose documents are not currently live
   * in the browser. Called on SW startup and on tab removal.
   */
  async flush() {
    const live = await this.#collectLiveDocumentIds();
    for (const rootDocumentId of Array.from(this.#pages.keys())) {
      const page = this.#pages.get(rootDocumentId);
      if (!page) continue;
      const stillLive = page.documentIds.some((d) => live.has(d));
      if (!stillLive) {
        this.#stagePage(page);
      }
    }
  }

  async #collectLiveDocumentIds() {
    const live = new Set();
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      logger.debug('PageStore: tabs.query failed during flush', e);
      return live;
    }
    await Promise.all(
      tabs.map(async (tab) => {
        try {
          const frames = await chrome.webNavigation.getAllFrames({
            tabId: tab.id,
          });
          for (const frame of frames || []) {
            if (frame.documentId) {
              live.add(frame.documentId);
            }
          }
        } catch (e) {
          // Tab may have closed between query and getAllFrames.
        }
      }),
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

  #onTabCreated = (tab) => {
    this.#tabContext.set(tab.id, {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
      url: tab.url || '',
    });
  };

  #onTabUpdated = (tabId, info, tab) => {
    const prev = this.#tabContext.get(tabId) || {};
    const ctx = {
      isPrivate: !!tab.incognito,
      active: !!tab.active,
      url: info.url !== undefined ? info.url : prev.url || '',
    };
    this.#tabContext.set(tabId, ctx);
    // Mirror isPrivate/active onto any live pages on this tab.
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
    // Firing flush here is a coarse but deterministic way to get the
    // tab's pages emitted without a wall-clock timer: the tab is
    // gone from tabs.query / webNavigation.getAllFrames, so none of
    // its documentIds appear in the live set.
    this.flush();
  };

  #onTabActivated = ({ previousTabId, tabId }) => {
    if (!previousTabId) {
      for (const [otherTabId, ctx] of this.#tabContext) {
        if (otherTabId !== tabId) {
          this.#tabContext.set(otherTabId, { ...ctx, active: false });
        }
      }
      for (const page of this.#pages.values()) {
        if (page.id !== tabId) {
          makePageActive(page, false);
          this.#pages.set(page.documentId, page);
        }
      }
    } else {
      const prevCtx = this.#tabContext.get(previousTabId);
      if (prevCtx) {
        this.#tabContext.set(previousTabId, { ...prevCtx, active: false });
      }
      for (const page of this.#pages.values()) {
        if (page.id === previousTabId) {
          makePageActive(page, false);
          this.#pages.set(page.documentId, page);
        }
      }
    }
    const newCtx = this.#tabContext.get(tabId);
    if (newCtx) {
      this.#tabContext.set(tabId, { ...newCtx, active: true });
    }
    for (const page of this.#pages.values()) {
      if (page.id === tabId) {
        makePageActive(page, true);
        this.#pages.set(page.documentId, page);
      }
    }
  };

  #onWindowFocusChanged = async (focusedWindowId) => {
    const activeTabs = await chrome.tabs.query({ active: true });
    for (const { id, windowId } of activeTabs) {
      const active = windowId === focusedWindowId;
      const ctx = this.#tabContext.get(id);
      if (ctx) this.#tabContext.set(id, { ...ctx, active });
      for (const page of this.#pages.values()) {
        if (page.id === id) {
          makePageActive(page, active);
          this.#pages.set(page.documentId, page);
        }
      }
    }
  };

  #onNavigationCommitted = (details) => {
    const { frameId, tabId, documentId, parentDocumentId, url } = details;

    if (frameId !== 0) {
      // Sub-frame commit: attach the sub-frame's documentId to the
      // parent's owning page.
      if (this.#documentIndex.has(documentId)) return;
      const owner = parentDocumentId
        ? this.#documentIndex.get(parentDocumentId)
        : null;
      if (!owner) return;
      this.#indexDocument(owner, documentId);
      this.#pages.set(owner.documentId, owner);
      return;
    }

    // Main-frame commit. If the documentId already exists (bfcache
    // restore), keep the existing record and its accumulated stats.
    let page = this.#pages.get(documentId);
    if (!page) {
      const ctx = this.#tabContext.get(tabId) || {};
      page = createPage({
        tabId,
        documentId,
        url,
        isPrivate: ctx.isPrivate,
        active: ctx.active,
      });
    }
    page.state = PAGE_LOADING_STATE.COMMITTED;
    if (url) page.url = url;
    this.#indexDocument(page, documentId);
    this.#pages.set(documentId, page);
  };

  #onNavigationCompleted = (details) => {
    const { frameId, documentId } = details;
    if (frameId !== 0) return;
    const page = this.#pages.get(documentId);
    if (!page) return;
    page.state = PAGE_LOADING_STATE.COMPLETE;
    this.#pages.set(documentId, page);
  };

  getPageForRequest(context) {
    const { documentId, parentDocumentId, documentLifecycle } = context;
    // Prerendered documents: don't attribute. They represent pages
    // the user never activated — counting trackers on them would
    // leak third parties the user never actually saw.
    // `pending_deletion` (late beacons / pagehide unload fetches)
    // and `cached` (bfcache pagehide) are legitimate — they stay.
    if (documentLifecycle === 'prerender') {
      return null;
    }
    if (documentId) {
      const direct = this.#documentIndex.get(documentId);
      if (direct) return direct;
    }
    // Sub-frame webRequests fire before onCommitted indexes the
    // sub-frame's documentId — and the iframe's own HTML fetch
    // often has no documentId at all (Chrome hasn't minted one yet).
    // Walk the parent chain: any nested frame finds the root page
    // via the parent that was already indexed by an earlier event.
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
