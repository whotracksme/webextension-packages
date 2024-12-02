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

import ChromeStorageMap from './utils/chrome-storage-map.js';

const PAGE_TTL = 1000 * 60 * 60; // 1 hour

const PAGE_LOADING_STATE = {
  CREATED: 'created',
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

function createPageFromTab(tab) {
  const { id, active, url, incognito, created } = tab;
  const page = {};
  page.id = id;
  page.url = url;
  page.isPrivate = incognito || false;
  page.isPrivateServer = false;
  page.created = created || Date.now();
  page.destroyed = null;
  page.frames = {
    0: {
      parentFrameId: -1,
      url,
    },
  };
  page.state = PAGE_LOADING_STATE.CREATED;

  page.activeTime = 0;
  page.activeFrom = active ? Date.now() : 0;

  page.requestStats = {};
  page.annotations = {};
  page.counter = 0;
  page.previous = null;
  return page;
}

export default class PageStore {
  #notifyPageStageListeners;
  #pages;

  constructor({ notifyPageStageListeners }) {
    this.#pages = new ChromeStorageMap({
      storageKey: 'wtm-url-reporting:page-store:tabs',
      ttlInMs: PAGE_TTL,
    });
    this.#notifyPageStageListeners = notifyPageStageListeners;
  }

  async init() {
    await this.#pages.isReady;
    chrome.tabs.onCreated.addListener(this.#onTabCreated);
    chrome.tabs.onUpdated.addListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.addListener(this.#onTabRemoved);
    chrome.tabs.onActivated.addListener(this.#onTabActivated);
    chrome.webNavigation.onBeforeNavigate.addListener(this.#onBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);
    chrome.webNavigation.onCompleted.addListener(this.#onNavigationCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(
      this.#onNavigationErrorOccured,
    );
    chrome.windows.onFocusChanged?.addListener(this.#onWindowFocusChanged);

    // popupate initially open tabs
    (await chrome.tabs.query({})).forEach((tab) => this.#onTabCreated(tab));
  }

  unload() {
    this.#pages.forEach((serializedPage) => {
      const page = createPageFromTab(serializedPage);
      this.#stagePage(page);
    });
    this.#pages.clear();

    chrome.tabs.onCreated.removeListener(this.#onTabCreated);
    chrome.tabs.onUpdated.removeListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.removeListener(this.#onTabRemoved);
    chrome.tabs.onActivated.removeListener(this.#onTabActivated);
    chrome.webNavigation.onBeforeNavigate.removeListener(
      this.#onBeforeNavigate,
    );
    chrome.webNavigation.onCommitted.removeListener(
      this.#onNavigationCommitted,
    );
    chrome.webNavigation.onCompleted.removeListener(
      this.#onNavigationCompleted,
    );
    chrome.webNavigation.onErrorOccurred.removeListener(
      this.#onNavigationErrorOccured,
    );
    chrome.windows.onFocusChanged?.removeListener(this.#onWindowFocusChanged);
  }

  checkIfEmpty() {
    // this operations can potentially be expensive
    return this.#pages.countNonExpiredKeys() === 0;
  }

  #stagePage(page) {
    makePageActive(page, false);
    page.destroyed = Date.now();
    // unset previous (to prevent history chain memory leak)
    page.previous = undefined;
    this.#pages.set(page.id, page);
    this.#notifyPageStageListeners(page);
  }

  /**
   * Create a new `tabContext` for the new tab
   */
  #onTabCreated = (tab) => {
    this.#pages.set(tab.id, createPageFromTab(tab));
  };

  /**
   * Update an existing tab or create it if we do not have a context yet.
   */
  #onTabUpdated = (tabId, info, tab) => {
    let page = this.#pages.get(tabId);
    if (!page) {
      page = createPageFromTab(tab);
    }

    // Update `isPrivate` and `url` if available
    page.isPrivate = tab.incognito;
    makePageActive(page, tab.active);
    if (info.url !== undefined) {
      page.url = info.url;
    }

    this.#pages.set(tabId, page);
  };

  /**
   * Remove tab context for `tabId`.
   */
  #onTabRemoved = (tabId) => {
    const page = this.#pages.get(tabId);
    if (!page) {
      return;
    }
    if (page.state === PAGE_LOADING_STATE.COMPLETE) {
      this.#stagePage(page);
    }
    this.#pages.delete(tabId);
  };

  #onTabActivated = (details) => {
    const { previousTabId, tabId } = details;
    // if previousTabId is not set (e.g. on chrome), set all tabs to inactive
    // otherwise, we only have to mark the previous tab as inactive
    if (!previousTabId) {
      for (const page of this.#pages.values()) {
        makePageActive(page, false);
        this.#pages.set(page.id, page);
      }
    } else if (this.#pages.has(previousTabId)) {
      const previousPage = this.#pages.get(previousTabId);
      makePageActive(previousPage, false);
      this.#pages.set(previousPage.id, previousPage);
    }

    if (this.#pages.has(tabId)) {
      const page = this.#pages.get(tabId);
      makePageActive(page, true);
      this.#pages.set(page.id, page);
    }
  };

  #onWindowFocusChanged = async (focusedWindowId) => {
    const activeTabs = await chrome.tabs.query({ active: true });
    for (const { id, windowId } of activeTabs) {
      const page = this.#pages.get(id);
      if (!page) {
        continue;
      }
      makePageActive(page, windowId === focusedWindowId);
      this.#pages.set(id, page);
    }
  };

  #onBeforeNavigate = (details) => {
    const { frameId, tabId, url, timeStamp } = details;

    if (frameId !== 0) {
      return;
    }

    const page = this.#pages.get(tabId);

    if (page) {
      // ignore duplicated #onBeforeNavigate https://bugzilla.mozilla.org/show_bug.cgi?id=1732564
      if (
        page.id === tabId &&
        page.url === url &&
        page.created + 200 > timeStamp
      ) {
        return;
      }
      // We are starting a navigation to a new page - if the previous page is complete (i.e. fully
      // loaded), stage it before we create the new page info.
      if (page.state === PAGE_LOADING_STATE.COMPLETE && !page.destroyed) {
        this.#stagePage(page);
      }
    }

    // create a new page for the navigation
    this.#pages.delete(tabId);

    const nextPage = createPageFromTab({
      id: tabId,
      active: false,
      url,
      incognito: page ? page.isPrivate : false,
      created: timeStamp,
    });
    nextPage.previous = page;
    nextPage.state = PAGE_LOADING_STATE.NAVIGATING;
    this.#pages.set(tabId, nextPage);
  };

  #onNavigationErrorOccured = (details) => {
    const { frameId, tabId, url, error } = details;

    if (frameId !== 0 || !url.startsWith('http')) {
      return;
    }

    /**
     *
        On Firefox some navigation can trigger following event sequence:

        * onBeforeNavigate
        * onErrorOccurred with "error":"Error code 2152398850"
        * onBeforeNavigate
        * onCommitted

        That was causing an extra page object to be created which was messing up the previous page logic.
     */
    // 2152398850 stands for NS_BINDING_ABORTED https://searchfox.org/mozilla-central/rev/6597dd03bad82c891d084eed25cafd0c85fb333e/tools/ts/config/error_list.json#48
    if (error === 'Error code 2152398850') {
      const page = this.#pages.get(tabId);

      if (page && page.url === url) {
        this.#pages.set(tabId, page.previous);
      }
    }
  };

  #onNavigationCommitted = (details) => {
    const { frameId, tabId } = details;
    const page = this.#pages.get(tabId);

    if (!page) {
      return;
    }

    if (frameId === 0) {
      page.state = PAGE_LOADING_STATE.COMMITTED;
      this.#pages.set(tabId, page);
    } else if (!page.frames[frameId]) {
      // frame created without request
      this.onSubFrame(details);
    }
  };

  #onNavigationCompleted = (details) => {
    const { frameId, tabId } = details;
    const page = this.#pages.get(tabId);
    if (!page) {
      return;
    }
    if (frameId === 0) {
      page.state = PAGE_LOADING_STATE.COMPLETE;
    }
    this.#pages.set(tabId, page);
  };

  onSubFrame = (details) => {
    const { tabId, frameId, parentFrameId, url } = details;
    const page = this.#pages.get(tabId);
    if (!page) {
      return;
    }
    // Keep track of frameUrl as well as parent frame
    page.frames[frameId] = {
      parentFrameId,
      url,
    };
    this.#pages.set(tabId, page);
  };

  getPageForRequest(context) {
    const { tabId, frameId, originUrl, type, initiator } = context;
    const page = this.#pages.get(tabId);
    if (!page) {
      return null;
    }

    // check if the current page has the given frame id, otherwise check if it belongs to the
    // previous page
    if (!page.frames[frameId]) {
      if (page.previous && page.previous.frames[frameId]) {
        return page.previous;
      }
      return null;
    }

    const couldBePreviousPage =
      frameId === 0 && type !== 'main_frame' && page.previous;

    // for main frame requests: check if the origin url is from the previous page (Firefox)
    if (
      couldBePreviousPage &&
      page.url !== originUrl &&
      page.previous.url === originUrl
    ) {
      return page.previous;
    }
    // on Chrome we have `initiator` which only contains the origin. In this case, check for a
    // different origin
    if (
      couldBePreviousPage &&
      initiator &&
      !page.url.startsWith(initiator) &&
      page.previous.url.startsWith(initiator)
    ) {
      return page.previous;
    }
    return page;
  }
}
