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

const BFCACHE_TTL_MS = 10 * 60 * 1000;
// Min gap between sweeps driven by webNavigation.onCompleted, so a
// burst of navigations doesn't trigger N tabs.query/getAllFrames
// roundtrips back-to-back.
const FLUSH_THROTTLE_MS = 30 * 1000;

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
    url,
    isPrivate: !!isPrivate,
    isPrivateServer: false,
    created: Date.now(),
    destroyed: null,
    // Wall-clock instant at which the next sweep should stage this
    // page. null while the page is live; set to `now + BFCACHE_TTL_MS`
    // when a sweep first finds no live doc; 0 when the tab is
    // closed/discarded; cleared on bfcache restore.
    stageAfter: null,
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
  #lastFlush = 0;

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
    // Seed tabContext before subscribing so a concurrent onCommitted
    // can't create a page with default isPrivate/active flags.
    for (const tab of await chrome.tabs.query({})) {
      this.#onTabCreated(tab);
    }
    chrome.tabs.onCreated.addListener(this.#onTabCreated);
    chrome.tabs.onUpdated.addListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.addListener(this.#onTabRemoved);
    chrome.tabs.onActivated.addListener(this.#onTabActivated);
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);
    chrome.webNavigation.onCompleted.addListener(this.#onNavigationCompleted);
    // Not available on Firefox Android.
    chrome.windows?.onFocusChanged?.addListener(this.#onWindowFocusChanged);
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

  // Stage pages whose tab is gone or whose docs have been absent
  // from the live set for BFCACHE_TTL_MS.
  async flush() {
    const live = await this.#collectLiveDocumentIds();
    const now = Date.now();
    for (const page of [...this.#pages.values()]) {
      if (page.documentIds.some((d) => live.has(d))) {
        if (page.stageAfter !== null) {
          page.stageAfter = null;
          this.#pages.set(page.documentId, page);
        }
      } else if (page.stageAfter === null) {
        page.stageAfter = now + BFCACHE_TTL_MS;
        this.#pages.set(page.documentId, page);
      } else if (now >= page.stageAfter) {
        this.#stagePage(page);
      }
    }
  }

  async #collectLiveDocumentIds() {
    const live = new Set();
    for (const tab of await chrome.tabs.query({})) {
      let frames;
      try {
        frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
      } catch (e) {
        // Tab can disappear between tabs.query and getAllFrames.
        // Skip it — its docs will look gone, which is fine.
        logger.debug('PageStore: getAllFrames failed for tab', tab.id, e);
        continue;
      }
      for (const frame of frames || []) {
        if (frame.documentId) live.add(frame.documentId);
      }
    }
    return live;
  }

  #stagePage(page) {
    for (const docId of page.documentIds) {
      if (this.#documentIndex.get(docId) === page) {
        this.#documentIndex.delete(docId);
      }
    }
    this.#pages.delete(page.documentId);
    const snapshot = structuredClone(page);
    makePageActive(snapshot, false);
    snapshot.destroyed = Date.now();
    this.#notifyPageStageListeners(snapshot);
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

  #onTabUpdated = (tabId, info, tab) => {
    if (info.discarded) {
      // Memory-discarded tab: docs are gone but onRemoved won't fire
      // until the user closes the tab.
      this.#markTabGone(tabId);
      return;
    }
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
    this.#markTabGone(tabId);
  };

  #markTabGone(tabId) {
    for (const page of this.#pages.values()) {
      if (page.id === tabId) {
        page.stageAfter = 0;
        this.#pages.set(page.documentId, page);
      }
    }
    this.#lastFlush = Date.now();
    this.flush().catch((e) =>
      logger.debug('PageStore: flush after tab gone failed', e),
    );
  }

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
      if (this.#documentIndex.has(documentId)) return;
      const owner =
        parentDocumentId && this.#documentIndex.get(parentDocumentId);
      if (!owner) return;
      this.#indexDocument(owner, documentId);
      this.#pages.set(owner.documentId, owner);
      return;
    }
    // Main-frame. Reuse an existing record for a bfcache re-commit
    // so accumulated stats survive forward/back navigation; preserve
    // its state, since onCompleted is not guaranteed to re-fire on
    // restore and we'd otherwise downgrade a complete page back to
    // committed and silently drop it at staging.
    let page = this.#pages.get(documentId);
    if (!page) {
      const ctx = this.#tabContext.get(tabId) || {};
      page = createPage({ tabId, documentId, url, ...ctx });
    }
    page.url = url;
    page.stageAfter = null;
    this.#indexDocument(page, documentId);
    this.#pages.set(documentId, page);
  };

  #onNavigationCompleted = ({ frameId, documentId }) => {
    if (frameId !== 0) return;
    const page = this.#pages.get(documentId);
    if (page) {
      page.state = PAGE_LOADING_STATE.COMPLETE;
      this.#pages.set(documentId, page);
    }
    const now = Date.now();
    if (now - this.#lastFlush < FLUSH_THROTTLE_MS) return;
    this.#lastFlush = now;
    this.flush().catch((e) => logger.debug('PageStore: flush failed', e));
  };

  getPageForRequest({ documentId, parentDocumentId, documentLifecycle }) {
    // Prerender docs were never seen by the user.
    if (documentLifecycle === 'prerender') return null;
    if (documentId) {
      const direct = this.#documentIndex.get(documentId);
      if (direct) return direct;
    }
    // Sub-frame request can fire before its own onCommitted, or
    // without a documentId (iframe HTML fetch). Fall back to parent.
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
