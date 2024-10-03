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
import {
  setActive,
  create as makeTabContext,
  PAGE_LOADING_STATE,
} from './page.js';
import ChromeStorageMap from '../request/utils/chrome-storage-map.js';

const PAGE_TTL = 1000 * 60 * 60; // 1 hour

export default class PageStore {
  #notifyPageStageListeners;
  #tabs;

  constructor({ notifyPageStageListeners }) {
    this.#tabs = new ChromeStorageMap({
      storageKey: 'wtm-url-reporting:page-store:tabs',
      ttlInMs: PAGE_TTL,
    });
    this.#notifyPageStageListeners = notifyPageStageListeners;
  }

  async init() {
    await this.#tabs.isReady;
    chrome.tabs.onCreated.addListener(this.#onTabCreated);
    chrome.tabs.onUpdated.addListener(this.#onTabUpdated);
    chrome.tabs.onRemoved.addListener(this.#onTabRemoved);
    chrome.tabs.onActivated.addListener(this.#onTabActivated);
    chrome.webNavigation.onBeforeNavigate.addListener(this.#onBeforeNavigate);
    chrome.webNavigation.onCommitted.addListener(this.#onNavigationCommitted);
    chrome.webNavigation.onCompleted.addListener(this.#onNavigationComplete);
    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(this.#onWindowFocusChanged);
    }
    // popupate initially open tabs
    (await chrome.tabs.query({})).forEach((tab) => this.#onTabCreated(tab));
  }

  unload() {
    this.#tabs.forEach((page) => this.#stagePage(page));
    this.#tabs.clear();

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
    chrome.webNavigation.onCompleted.removeListener(this.#onNavigationComplete);
    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.removeListener(this.#onWindowFocusChanged);
    }
  }

  checkIfEmpty() {
    // this operations can potentially be expensive
    return this.#tabs.countNonExpiredKeys() === 0;
  }

  #stagePage(page) {
    setActive(page, false);
    page.destroyed = Date.now();
    // unset previous (to prevent history chain memory leak)
    page.previous = undefined;
    this.#notifyPageStageListeners(page);
  }

  /**
   * Create a new `tabContext` for the new tab
   */
  #onTabCreated = (tab) => {
    this.#tabs.set(tab.id, makeTabContext(tab));
  };

  /**
   * Update an existing tab or create it if we do not have a context yet.
   */
  #onTabUpdated = (tabId, info, tab) => {
    let tabContext = this.#tabs.get(tabId);
    if (!tabContext) {
      tabContext = makeTabContext(tab);
      this.#tabs.set(tabId, tabContext);
    }

    // Update `isPrivate` and `url` if available
    tabContext.isPrivate = tab.incognito;
    setActive(tabContext, tab.active);
    if (info.url !== undefined) {
      tabContext.url = info.url;
    }
  };

  /**
   * Remove tab context for `tabId`.
   */
  #onTabRemoved = (tabId) => {
    const tabContext = this.#tabs.get(tabId);
    if (tabContext && tabContext.state === PAGE_LOADING_STATE.COMPLETE) {
      this.#stagePage(tabContext);
    }
    this.#tabs.delete(tabId);
  };

  #onTabActivated = ({ previousTabId, tabId }) => {
    // if previousTabId is not set (e.g. on chrome), set all tabs to inactive
    // otherwise, we only have to mark the previous tab as inactive
    if (!previousTabId) {
      for (const tab of this.#tabs.values()) {
        setActive(tab, false);
      }
    } else if (this.#tabs.has(previousTabId)) {
      setActive(this.#tabs.get(previousTabId), false);
    }
    if (this.#tabs.has(tabId)) {
      setActive(this.#tabs.get(tabId), true);
    }
  };

  #onWindowFocusChanged = (focusedWindow) => {
    chrome.tabs.query({ active: true }, (activeTabs) => {
      activeTabs.forEach(({ id, windowId }) => {
        const tabContext = this.#tabs.get(id);
        if (!tabContext) {
          return;
        }
        if (windowId === focusedWindow) {
          setActive(tabContext, true);
        } else {
          setActive(tabContext, false);
        }
      });
    });
  };

  #onBeforeNavigate = (details) => {
    const { frameId, tabId, url, timeStamp } = details;
    const tabContext = this.#tabs.get(tabId);
    if (frameId === 0) {
      // ignore duplicated #onBeforeNavigate https://bugzilla.mozilla.org/show_bug.cgi?id=1732564
      if (
        tabContext &&
        tabContext.id === tabId &&
        tabContext.url === url &&
        tabContext.created + 200 > timeStamp
      ) {
        return;
      }
      // We are starting a navigation to a new page - if the previous page is complete (i.e. fully
      // loaded), stage it before we create the new page info.
      if (tabContext && tabContext.state === PAGE_LOADING_STATE.COMPLETE) {
        this.#stagePage(tabContext);
      }
      // create a new page for the navigation
      this.#tabs.delete(tabId);
      const nextContext = makeTabContext({
        id: tabId,
        active: false,
        url,
        incognito: tabContext ? tabContext.isPrivate : false,
        created: timeStamp,
      });
      nextContext.previous = tabContext;
      this.#tabs.set(tabId, nextContext);
      nextContext.state = PAGE_LOADING_STATE.NAVIGATING;
    }
  };

  #onNavigationCommitted = (details) => {
    const { frameId, tabId } = details;
    const tabContext = this.#tabs.get(tabId);
    if (frameId === 0 && tabContext) {
      tabContext.state = PAGE_LOADING_STATE.COMMITTED;
    } else if (tabContext && !tabContext.frames[frameId]) {
      // frame created without request
      this.onSubFrame(details);
    }
  };

  #onNavigationComplete = ({ frameId, tabId }) => {
    const tabContext = this.#tabs.get(tabId);
    if (frameId === 0 && tabContext) {
      tabContext.state = PAGE_LOADING_STATE.COMPLETE;
    }
  };

  onMainFrame = ({ tabId, url, requestId }, event) => {
    // main frame from tabId -1 is from service worker and should not be saved
    if (tabId === -1) {
      return;
    }
    // Update last request id from the tab
    let tabContext = this.#tabs.get(tabId);
    if (!tabContext) {
      tabContext = makeTabContext({ url, incognito: false });
      this.#tabs.set(tabId, tabContext);
    }

    if (event === 'onBeforeRequest') {
      tabContext.frames = {};
      // Detect redirect: if the last request on this tab had the same id and
      // this was from the same `onBeforeRequest` hook, we can assume this is a
      // redirection.
      if (tabContext.lastRequestId === requestId) {
        tabContext.isRedirect = true;
      }

      // Only keep track of `lastRequestId` with `onBeforeRequest` listener
      // since we need this information for redirect detection only and this can
      // be detected with this hook.
      tabContext.lastRequestId = requestId;
    }

    // Update context of tab with `url` and main frame information
    tabContext.url = url;
    tabContext.frames[0] = {
      parentFrameId: -1,
      url,
    };
  };

  onSubFrame = (details) => {
    const { tabId, frameId, parentFrameId, url } = details;
    const tab = this.#tabs.get(tabId);
    if (!tab) {
      logger.log('Could not find tab for sub_frame request', details);
      return;
    }

    // Keep track of frameUrl as well as parent frame
    tab.frames[frameId] = {
      parentFrameId,
      url,
    };
  };

  getPageForRequest(context) {
    const { tabId, frameId, originUrl, type, initiator } = context;
    const tab = this.#tabs.get(tabId);
    if (!tab) {
      return null;
    }
    // check if the current page has the given frame id, otherwise check if it belongs to the
    // previous page
    if (!tab.frames[frameId]) {
      if (tab.previous && tab.previous.frames[frameId]) {
        return tab.previous;
      }
      return null;
    }

    const couldBePreviousPage =
      frameId === 0 && type !== 'main_frame' && tab.previous;

    // for main frame requests: check if the origin url is from the previous page (Firefox)
    if (
      couldBePreviousPage &&
      tab.url !== originUrl &&
      tab.previous.url === originUrl
    ) {
      return tab.previous;
    }
    // on Chrome we have `initiator` which only contains the origin. In this case, check for a
    // different origin
    if (
      couldBePreviousPage &&
      initiator &&
      !tab.url.startsWith(initiator) &&
      tab.previous.url.startsWith(initiator)
    ) {
      return tab.previous;
    }
    return tab;
  }
}
