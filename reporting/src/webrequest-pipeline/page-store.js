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

import logger from './logger.js';
import ChromeStorageMap from '../request/utils/chrome-storage-map.js';

const PAGE_TTL = 1000 * 60 * 60; // 1 hour

const PAGE_LOADING_STATE = {
  CREATED: 'created',
  NAVIGATING: 'navigating',
  COMMITTED: 'committed',
  COMPLETE: 'complete',
};

class Page {
  constructor(page) {
    this.id = page.id;
    this.url = page.url;
    this.isRedirect = page.isRedirect || false;
    this.isPrivate = page.incognito || false;
    this.isPrivateServer = page.isPrivateServer || false;
    this.created = page.created || Date.now();
    this.destroyed = page.destroyed || null;
    this.lastRequestId = page.lastRequestId || null;
    this.frames = page.frames || {
      0: {
        parentFrameId: -1,
        url: page.url,
      },
    };
    this.state = page.state || PAGE_LOADING_STATE.CREATED;

    this.activeTime = page.activeTime || 0;
    this.activeFrom = page.active ? Date.now() : 0;

    this.requestStats = page.requestStats || {};
    this.annotations = page.annotations || {};
    this.counter = page.counter || 0;
    this.previous = page.previous;

    this.tsv = page.tsv || '';
    this.tsvId = page.tsvId || undefined;
  }

  setActive(active) {
    if (active && this.activeFrom === 0) {
      this.activeFrom = Date.now();
    } else if (!active && this.activeFrom > 0) {
      this.activeTime += Date.now() - this.activeFrom;
      this.activeFrom = 0;
    }
  }

  getStatsForDomain(domain) {
    return (this.requestStats[domain] ||= {});
  }

  /**
   * Return the URL of the frame.
   */
  getFrameUrl(context) {
    const { frameId } = context;

    const frame = this.frames[frameId];

    // In some cases, frame creation does not trigger a webRequest event (e.g.:
    // if the iframe is specified in the HTML of the page directly). In this
    // case we try to fall-back to something else: documentUrl, originUrl,
    // initiator.
    if (frame === undefined) {
      return context.documentUrl || context.originUrl || context.initiator;
    }

    return frame.url;
  }
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
    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(this.#onWindowFocusChanged);
    }
    // popupate initially open tabs
    (await chrome.tabs.query({})).forEach((tab) => this.#onTabCreated(tab));
  }

  unload() {
    this.#pages.forEach((serializedPage) => {
      const page = new Page(serializedPage);
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
    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.removeListener(this.#onWindowFocusChanged);
    }
  }

  checkIfEmpty() {
    // this operations can potentially be expensive
    return this.#pages.countNonExpiredKeys() === 0;
  }

  #stagePage(page) {
    page.setActive(false);
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
    this.#pages.set(tab.id, new Page(tab));
  };

  /**
   * Update an existing tab or create it if we do not have a context yet.
   */
  #onTabUpdated = (tabId, info, tab) => {
    const page = new Page(this.#pages.get(tabId) || tab);

    // Update `isPrivate` and `url` if available
    page.isPrivate = tab.incognito;
    page.setActive(tab.active);
    if (info.url !== undefined) {
      page.url = info.url;
    }

    this.#pages.set(tabId, page);
  };

  /**
   * Remove tab context for `tabId`.
   */
  #onTabRemoved = (tabId) => {
    const serializedPage = this.#pages.get(tabId);
    if (!serializedPage) {
      return;
    }
    const page = new Page(serializedPage);
    if (page.state === PAGE_LOADING_STATE.COMPLETE) {
      this.#stagePage(page);
    }
    this.#pages.delete(tabId);
  };

  #onTabActivated = ({ previousTabId, tabId }) => {
    // if previousTabId is not set (e.g. on chrome), set all tabs to inactive
    // otherwise, we only have to mark the previous tab as inactive
    if (!previousTabId) {
      for (const serializedPage of this.#pages.values()) {
        const page = new Page(serializedPage);
        page.setActive(false);
        this.#pages.set(page.id, page);
      }
    } else if (this.#pages.has(previousTabId)) {
      const page = new Page(previousTabId);
      page.setActive(false);
      this.#pages.set(page.id, page);
    }

    if (this.#pages.has(tabId)) {
      const page = new Page(this.#pages.get(tabId));
      page.setActive(true);
      this.#pages.set(page.id, page);
    }
  };

  #onWindowFocusChanged = async (focusedWindowId) => {
    const activeTabs = await chrome.tabs.query({ active: true });
    for (const { id, windowId } of activeTabs) {
      const serializedPage = this.#pages.get(id);
      if (!serializedPage) {
        continue;
      }
      const page = new Page(serializedPage);
      page.setActive(windowId === focusedWindowId);
      this.#pages.set(id, page);
    }
  };

  #onBeforeNavigate = (details) => {
    const { frameId, tabId, url, timeStamp } = details;

    if (frameId !== 0) {
      return;
    }

    const page = this.#pages.has(tabId)
      ? new Page(this.#pages.get(tabId))
      : null;

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
      if (page.state === PAGE_LOADING_STATE.COMPLETE) {
        this.#stagePage(page);
      }
    }

    // create a new page for the navigation
    this.#pages.delete(tabId);

    const nextPage = new Page({
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

  #onNavigationCommitted = (details) => {
    const { frameId, tabId } = details;
    const serializedPage = this.#pages.get(tabId);

    if (!serializedPage) {
      return;
    }

    const page = new Page(serializedPage);

    if (frameId === 0) {
      page.state = PAGE_LOADING_STATE.COMMITTED;
      this.#pages.set(tabId, page);
    } else if (!page.frames[frameId]) {
      // frame created without request
      this.onSubFrame(details);
    }
  };

  #onNavigationCompleted = ({ frameId, tabId }) => {
    const serializedPage = this.#pages.get(tabId);
    if (!serializedPage) {
      return;
    }
    const page = new Page(serializedPage);
    if (frameId === 0) {
      page.state = PAGE_LOADING_STATE.COMPLETE;
    }
    this.#pages.set(tabId, page);
  };

  onMainFrame = ({ tabId, url, requestId }, event) => {
    // main frame from tabId -1 is from service worker and should not be saved
    if (tabId === -1) {
      return;
    }

    // Update last request id from the tab
    const page = new Page(
      this.#pages.get(tabId) || { url, incognito: false, id: tabId },
    );

    if (event === 'onBeforeRequest') {
      page.frames = {};
      // Detect redirect: if the last request on this tab had the same id and
      // this was from the same `onBeforeRequest` hook, we can assume this is a
      // redirection.
      if (page.lastRequestId === requestId) {
        page.isRedirect = true;
      }

      // Only keep track of `lastRequestId` with `onBeforeRequest` listener
      // since we need this information for redirect detection only and this can
      // be detected with this hook.
      page.lastRequestId = requestId;
    }

    // Update context of tab with `url` and main frame information
    page.url = url;
    page.frames[0] = {
      parentFrameId: -1,
      url,
    };

    this.#pages.set(tabId, page);
  };

  onSubFrame = (details) => {
    const { tabId, frameId, parentFrameId, url } = details;
    const serializedPage = this.#pages.get(tabId);
    if (!serializedPage) {
      logger.log('Could not find tab for sub_frame request', details);
      return;
    }
    const page = new Page(serializedPage);
    // Keep track of frameUrl as well as parent frame
    page.frames[frameId] = {
      parentFrameId,
      url,
    };
    this.#pages.set(tabId, page);
  };

  getPageForRequest(context) {
    const { tabId, frameId, originUrl, type, initiator } = context;
    const serializedPage = this.#pages.get(tabId);
    if (!serializedPage) {
      return null;
    }
    const page = new Page(serializedPage);
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
