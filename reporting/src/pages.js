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
  equalityCanBeProven,
  flattenObject,
  isNil,
  requireInt,
  requireParam,
  split0,
} from './utils';
import { DnsResolver } from './network';
import ActivityEstimator from './activity-estimator';
import { analyzePageStructure } from './page-structure';
import EventListenerQueue from './event-listener-queue';
import SelfCheck from './self-check';

/**
 * Marker for lazy variables where the initialization was aborted.
 *
 * (exported for tests only)
 */
export const CANCEL_LAZY_VAR = { _tag: 'CANCEL_LAZY_VAR' };

/**
 * An ID that represents the absence of a browser tab.
 */
export const TAB_ID_NONE = -1;

/**
 * The windowId value that represents the absence of a browser window.
 */
export const WINDOW_ID_NONE = -1;

/**
 * The windowId value that represents the current window.
 */
export const WINDOW_ID_CURRENT = -2;

/**
 * Recursively traverses the given object and performs two operations:
 * - pending or cancelled lazy vars will removed
 * - resolved lazy vars will be inlined
 *
 * For more details on lazy variables, see Pages#_setLazyVar.
 *
 * Note: the implementation assumes that objects are free of cycles
 *
 * (exported for tests only)
 */
export function stripLazyVars(obj) {
  if (isNil(obj)) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripLazyVars);
  }
  if (obj === CANCEL_LAZY_VAR) {
    return undefined;
  }
  if (Object(obj) !== obj || obj.constructor === Date) {
    return obj;
  }
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val?._pending) {
      if (val.result && val.result !== CANCEL_LAZY_VAR) {
        result[key] = stripLazyVars(val.result);
      }
    } else {
      result[key] = stripLazyVars(val);
    }
  }
  return result;
}

function isRealPage(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

function sameHostname(url1, url2) {
  try {
    return new URL(url1).hostname === new URL(url2).hostname;
  } catch (e) {
    return false;
  }
}

/**
 * The API should match an ES6 map.
 */
class OpenTabs {
  constructor(pages) {
    this._map = new Map();
    this._pages = pages;
  }

  has(tabId) {
    return this._map.has(tabId);
  }

  get(tabId) {
    return this._map.get(tabId);
  }

  keys() {
    return this._map.keys();
  }

  values() {
    return this._map.values();
  }

  entries() {
    return this._map.entries();
  }

  set(tabId, value) {
    const result = this._map.set(tabId, value);
    this._pages._onTabChanged(tabId);
    return result;
  }

  delete(tabId) {
    const wasDeleted = this._map.delete(tabId);
    if (wasDeleted) {
      this._pages._onTabChanged(tabId);
    }
    return wasDeleted;
  }

  // spread operator: [...openTabs]
  *[Symbol.iterator]() {
    for (const entry of this._map) {
      yield entry;
    }
  }

  /**
   * This will not trigger tab change events.
   */
  restoreTabsFromMap(openTabs) {
    this._map = openTabs;
  }
}

/**
 * An abstraction of the active tab. Note that we assume that there is a single
 * active tab, which already different from what the browser sees: the browser
 * sees multiple windows, and generally one active tab per window.
 *
 * The definition of the active tab used in this class is closer to what you
 * would get by executing:
 * ```
 * chrome.tabs.query({ active: true, currentWindow: true })
 * ```
 */
class ActiveTab {
  constructor(pages) {
    this._pages = pages;
    this._state = {
      tabId: TAB_ID_NONE,
      windowId: WINDOW_ID_NONE,
      activeTabInWindow: new Map(),
      lastUpdated: 0, // Unix epoch
    };
    this._pendingFlush = null;
  }

  get tabId() {
    return this._state.tabId;
  }

  get activeWindowId() {
    return this._state.windowId;
  }

  updateActiveTab({ tabId, windowId, now = Date.now() }) {
    const previousTabId = this._state.tabId;
    this._state.tabId = tabId;
    this._state.windowId = windowId;
    this._state.lastUpdated = now;
    this.saveActiveTabInWindow({ tabId, windowId, now });
    this._markDirty();

    if (tabId !== previousTabId) {
      this._pages._activeTab_onActiveTabChanged({ tabId, previousTabId, now });
    }
  }

  saveActiveTabInWindow({ tabId, windowId, now = Date.now() }) {
    if (windowId !== WINDOW_ID_NONE) {
      this._state.activeTabInWindow.set(windowId, tabId);
      this._state.lastUpdated = now;
      this._markDirty();
    }
  }

  focusWindow(windowId, now = Date.now()) {
    const tabId = this._state.activeTabInWindow.get(windowId) ?? TAB_ID_NONE;
    this.updateActiveTab({ tabId, windowId, now });
  }

  removeWindow(windowId, now = Date.now()) {
    if (this._state.windowId === windowId) {
      this._state.tabId = TAB_ID_NONE;
      this._state.windowId = WINDOW_ID_NONE;
    }
    this._state.activeTabInWindow.delete(windowId);
    this._state.lastUpdated = now;
    this._markDirty();
  }

  _markDirty() {
    if (this._pendingFlush === null) {
      this._pendingFlush = setTimeout(() => {
        this.flush();
      }, 0);
    }
  }

  flush() {
    if (this._pendingFlush !== null) {
      this._pendingFlush = null;
      this._pages._activeTab_onInternalStateChanged();
    }
  }

  serialize() {
    return {
      tabId: this._state.tabId,
      windowId: this._state.windowId,
      activeTabInWindow__serialized__: [...this._state.activeTabInWindow],
      lastUpdated: this._state.lastUpdated,
    };
  }

  restore(state) {
    this._state = ActiveTab.ensureValidState({
      tabId: state.tabId,
      windowId: state.windowId,
      activeTabInWindow: new Map(state.activeTabInWindow__serialized__),
      lastUpdated: state.lastUpdated || 0,
    });
  }

  static ensureValidState(state) {
    const { tabId, windowId, activeTabInWindow, lastUpdated } = state || {};
    requireInt(tabId, 'tabId');
    requireInt(windowId, 'windowId');
    requireInt(lastUpdated, 'lastUpdated');

    for (const [key, value] of [...activeTabInWindow]) {
      requireInt(key, 'activeTabInWindow[key]');
      requireInt(value, 'activeTabInWindow[value]');
    }
    return state;
  }

  selfChecks(check = new SelfCheck()) {
    try {
      ActiveTab.ensureValidState(this._state);
    } catch (e) {
      check.fail('Invalid state', {
        state: this._state,
        reason: e.message,
      });
      return check;
    }

    const { tabId, windowId, activeTabInWindow } = this._state;
    if (tabId !== TAB_ID_NONE && activeTabInWindow.get(windowId) !== tabId) {
      check.warn('tabId and activeTabInWindow out of sync');
    }
    return check;
  }
}

/**
 * Responsible for aggregating information about open pages.
 *
 * It works by aggregating information from available extension APIs.
 * The implementation needs to be fault-tolerant to recover from inconsistent
 * states, loss of the state (if the service worker gets killed), lack of APIs
 * (e.g. on Safari), and fail gracefully in situations where the listener is
 *
 * For error recovery, it may sacrifice precision by deleting information
 * that is most likely outdated or even wrong. The overall goal of this class
 * is to provide information that are reliable and match or exceed what the
 * chrome.tabs.query IP would get.
 * not called and events have been skipped.
 *
 * List of Safari quirks:
 * https://developer.apple.com/documentation/safariservices/safari_web_extensions/assessing_your_safari_web_extension_s_browser_compatibility
 *
 * TODO: how to deal with speculative requests? Is it a problem?
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest#speculative_requests
 */
export default class Pages {
  constructor({
    config,
    urlAnalyzer,
    newPageApprover,
    pageSessionStore,
    dnsResolver = new DnsResolver(),
  }) {
    this.isActive = false;
    this.urlAnalyzer = requireParam(urlAnalyzer);
    this.newPageApprover = requireParam(newPageApprover);
    this.observers = [];

    this.openTabs = new OpenTabs(this);
    this.activeTab = new ActiveTab(this);
    this.activityEstimator = new ActivityEstimator({
      onActivityUpdated: this._activityEstimator_onActivityUpdated.bind(this),
      onInternalStateChanged:
        this._activityEstimator_onInternalStateChanged.bind(this),
    });

    this.dnsResolver = requireParam(dnsResolver);
    this.sessionStore = requireParam(pageSessionStore);

    // Browsers have the concept of tab id that must be unique per browser
    // session. To detect navigations in the same tab, the additional "page id"
    // is introduced. It will be updated on navigation events.
    this._pageIdGenerator = 1 + Math.floor(Math.random() * 0x100000000);

    // Inject chrome APIs (e.g. chrome.tabs, chrome.webNavigation). Since the
    // availability of APIs differs among plattforms, the implementation should
    // not to make any assumptions.
    this.chrome = config.pages?.chrome || globalThis.chrome || {};
    if (!this.chrome?.tabs?.query) {
      logger.warn('chrome.tabs.query API missing');
    }

    // Protection against misconfigured servers that create long redirect chains.
    // If the end is reached, the magic value "..." will be added.
    this.maxRedirects = 8;

    // counts the original languages seen (intended for debugging only)
    this.langStats = {};
    this.verboseLogging = config.pages?.verbose ?? false;

    // quirks: some fields are not available on all platforms (e.g. Safari)
    this.isPageLoadMethodReliable =
      this.chrome.webNavigation?.onHistoryStateUpdated?.addListener &&
      this.chrome.webNavigation?.onHistoryStateUpdated?.removeListener;
  }

  addObserver(onPageEventCallback) {
    this.observers.push(onPageEventCallback);
  }

  async init() {
    this.isActive = true;

    // The rest can be done asynchronously, so that the module doesn't get
    // slowed down. Loading data from session storage and getting the open tabs
    // can be triggered in parallel. Only the initial restore will first initialize
    // with the information from session storage before it can sync with the
    // currently open tabs. That ordering is enforced to preserve information
    // that is missing in the "chrome.tabs.query" result.
    if (!this._ready) {
      this._ready = new Promise((done) => {
        (async () => {
          try {
            const pendingInit = this.sessionStore.init();
            const pendingTabSyncParams =
              this._prepareSyncWithOpenTabsFromTabsAPI();
            try {
              await pendingInit;
              this._restoreSession(this.sessionStore.getEntries());
            } catch (e) {
              logger.warn(
                'Failed to restore previous state from in-memory session (if there was any)',
                e,
              );
              this.sessionStore.clear();
            }

            try {
              this._syncWithOpenTabsFromTabsAPI(await pendingTabSyncParams);
            } catch (e) {
              logger.warn('Failed to sync with open tabs', e);
            }

            if (this.isActive) {
              eventListenerQueue.replayEvents();
              this._setupListener();
            }
            this._updateSession();

            logger.debug(
              'Successfully initialized. Forcing full page aggregator sync...',
            );
            this.notifyObservers({
              type: 'full-sync',
            });
          } finally {
            eventListenerQueue.close();
            done();
          }
        })();
      });
    }
  }

  async blockUntilFullInit() {
    if (!this.isActive) {
      throw new Error('Not active (try to call "init" first)');
    }
    await this._ready;
  }

  async syncWithBrowser() {
    await this.blockUntilFullInit();
    this._syncWithOpenTabsFromTabsAPI(
      await this._prepareSyncWithOpenTabsFromTabsAPI(),
    );
  }

  _restoreSession(session) {
    if (!session || Object.keys(session).length === 0) {
      logger.debug('Found no previous state about pages to restore');
      return;
    }

    const { dnsResolver, activeTab, activityEstimator, ...openTabs } = session;
    this.activeTab.restore(activeTab);
    this.dnsResolver.restore(dnsResolver);
    this.activityEstimator.restore(activityEstimator);
    this._restoreTabs(openTabs);
  }

  _serializeFullSession() {
    return {
      dnsResolver: this.dnsResolver.serialize(),
      activeTab: this.activeTab.serialize(),
      activityEstimator: this.activityEstimator.serialize(),
      ...this._serializeTabs(),
    };
  }

  _updateSession() {
    if (this.sessionStore.isReady()) {
      this.sessionStore.replaceItems(this._serializeFullSession());
    }
  }

  _onTabChanged(tabId) {
    if (this.verboseLogging) {
      console.trace('tabChanged:', tabId, ':', this.openTabs.get(tabId));
    }

    const content = this.openTabs.get(tabId);
    if (tabId === this.activeTab.tabId) {
      this.activityEstimator.updateActiveUrl(content?.url || null);
    }

    if (this.sessionStore.isReady()) {
      if (content) {
        this.sessionStore.set(tabId, this._serializeTabContent(content));
      } else {
        this.sessionStore.remove(tabId);
      }
    }
  }

  _activeTab_onActiveTabChanged({ tabId, previousTabId, now = Date.now() }) {
    if (this.verboseLogging) {
      const url = this.openTabs.get(tabId)?.url;
      console.trace('activeTabChanged:', {
        url,
        from: {
          tabId: previousTabId,
          url: this.openTabs.get(previousTabId)?.url,
        },
        to: {
          tabId,
          url,
        },
      });
    }

    const url = this.openTabs.get(tabId)?.url;
    this.activityEstimator.updateActiveUrl(url || null, now);
  }

  _activeTab_onInternalStateChanged() {
    if (this.sessionStore.isReady()) {
      this.sessionStore.set('activeTab', this.activeTab.serialize());
    }
  }

  _activityEstimator_onActivityUpdated(urls) {
    if (this.isActive && urls.length > 0) {
      this.notifyObservers({
        type: 'activity-updated',
        urls,
        activityEstimator: this.activityEstimator,
      });
    }
  }

  _activityEstimator_onInternalStateChanged() {
    if (this.sessionStore.isReady()) {
      this.sessionStore.set(
        'activityEstimator',
        this.activityEstimator.serialize(),
      );
    }
  }

  _serializeTabContent(tabContent) {
    return stripLazyVars(tabContent);
  }

  _deserializeTabContent(tabContent) {
    const result = {};
    Object.entries(tabContent).forEach(([key, val]) => {
      if (val._pending) {
        logger.warn(
          'Lazy variable should not have been serialized (since they are promises):',
          key,
          '->',
          val,
          '(drop and continue...)',
        );
      } else {
        result[key] = val;
      }
    });
    return result;
  }

  _serializeTabs() {
    const result = {};
    for (const [tabId, tabContent] of this.openTabs) {
      result[tabId] = this._serializeTabContent(tabContent);
    }
    return result;
  }

  _restoreTabs(openTabs) {
    if (openTabs) {
      // TODO: maybe merge together?
      const deserializedTabs = Object.entries(openTabs).map(
        ([tabId, tabContent]) => [
          tabId,
          this._deserializeTabContent(tabContent),
        ],
      );
      this.openTabs.restoreTabsFromMap(new Map(deserializedTabs));
    }
  }

  async _tryChromeTabsQuery(...args) {
    if (this.chrome?.tabs?.query) {
      return this.chrome.tabs.query(...args);
    }

    if (!this._warnedAboutChromeTabsQueryApi) {
      this._warnedAboutChromeTabsQueryApi = true;
      logger.warn('chrome.tabs.query not available on this platform');
    }
    return undefined;
  }

  // Note: Unavailable on Firefox for Android
  async _tryChromeWindowsGetLastFocused(...args) {
    if (this.chrome?.windows?.getLastFocused) {
      return this.chrome.windows.getLastFocused(...args);
    }

    if (!this._warnedAboutChromeWindowsGetLastFocusedApi) {
      this._warnedAboutChromeWindowsGetLastFocusedApi = true;
      logger.warn(
        'chrome.windows.getLastFocused not available on this platform',
      );
    }
    return undefined;
  }

  async _prepareSyncWithOpenTabsFromTabsAPI() {
    const [tabs, lastFocusedWindow] = await Promise.all([
      this._tryChromeTabsQuery({}),
      this._tryChromeWindowsGetLastFocused(),
    ]);
    return {
      tabs: tabs || [],
      lastActiveWindowId: lastFocusedWindow?.id || null,
    };
  }

  _syncWithOpenTabsFromTabsAPI({
    tabs, // Note: may be [] if the API is not available
    lastActiveWindowId, // Note: may be null if the API is not available
    now = Date.now(),
  }) {
    const activeTabCandidates = [];
    const unmatchedTabIds = new Set(this.openTabs.keys());
    for (const tab of tabs) {
      if (tab.incognito || !isRealPage(tab.url)) {
        continue;
      }

      let oldEntry = null;
      if (unmatchedTabIds.delete(tab.id)) {
        oldEntry = this.openTabs.get(tab.id);
        if (oldEntry.url !== tab.url) {
          // TODO: Can this happen? If so, when?
          logger.warn('Ignoring tab after a URL mismatch:', {
            oldEntry,
            newEntry: tab,
          });
          oldEntry = null;
        }
      }

      const { id: tabId, windowId, status, title, url } = tab;
      const entry = {
        ...oldEntry,
        status,
        title,
        url,
        windowId,
        lastUpdatedAt: now,
        pageId: ++this._pageIdGenerator,
      };
      this._initVisibility(tabId, entry, now);

      if (tab.active && isRealPage(tab.url)) {
        this.activeTab.saveActiveTabInWindow({
          tabId,
          windowId,
          now,
        });
        if (windowId === lastActiveWindowId || isNil(lastActiveWindowId)) {
          activeTabCandidates.push({ tabId, windowId });
          if (tab.status === 'complete') {
            this._initAllOptionalFields(tabId, entry, now);
          }
        }
      }
      this.openTabs.set(tabId, entry);
    }

    if (
      activeTabCandidates.length > 1 &&
      this.chrome?.windows?.getLastFocused
    ) {
      logger.warn(
        'Multiple tabs are being detected as active',
        '(since the chrome.windows API is available, this is unexpected)',
        activeTabCandidates,
      );
    }

    if (activeTabCandidates.length === 1) {
      const { tabId, windowId } = activeTabCandidates[0];
      this.activeTab.updateActiveTab({ tabId, windowId, now });
    } else {
      this.activeTab.updateActiveTab({
        tabId: TAB_ID_NONE,
        windowId: WINDOW_ID_NONE,
        now,
      });
    }

    if (unmatchedTabIds.size > 0) {
      unmatchedTabIds.forEach((tabId) => this.openTabs.delete(tabId));
    }
  }

  unload() {
    this.isActive = false;
    if (this._removeListeners) {
      this._removeListeners();
      this._removeListeners = null;
    }
    this.activeTab.flush();
    this.activityEstimator.flush();
    eventListenerQueue.close();
  }

  notifyObservers(event) {
    this.observers.forEach((observer) => {
      try {
        observer(event);
      } catch (e) {
        logger.error('Unexpected error in observer', e);
      }
    });
  }

  describe(now = Date.now()) {
    const openTabs = {};
    for (const [tabId, pageInfo] of this.openTabs) {
      if (isRealPage(pageInfo.url)) {
        const isActive = tabId === this.activeTab.tabId;
        openTabs[tabId] = this._describePage(pageInfo, isActive, now);
      }
    }

    let activeTab;
    if (
      this.activeTab.tabId !== TAB_ID_NONE &&
      openTabs[this.activeTab.tabId]
    ) {
      activeTab = {
        tabId: this.activeTab.tabId,
        tab: openTabs[this.activeTab.tabId],
      };
    }

    return {
      activeTab,
      openTabs,
    };
  }

  describeTab(tabId, now = Date.now()) {
    const pageInfo = this.openTabs.get(tabId);
    if (!pageInfo || !isRealPage(pageInfo.url)) {
      return null;
    }
    const isActive = tabId === this.activeTab.tabId;
    return this._describePage(pageInfo, isActive, now);
  }

  /**
   * Either the (non-negative) id of the tab that is assumed to be active,
   * or TAB_ID_NONE, which is guaranteed to be -1.
   */
  getActiveTabId() {
    return this.activeTab.tabId;
  }

  _describePage(pageInfo, isActive, now = Date.now()) {
    const result = {
      status: pageInfo.status,
      title: pageInfo.title,
      url: pageInfo.url,
      visibility: pageInfo.visibility,
      windowId: pageInfo.windowId,
      lastUpdatedAt: pageInfo.lastUpdatedAt,
      isActive,
    };

    if (pageInfo.previousUrl) {
      result.ref = pageInfo.previousUrl;
    }
    if (this.isPageLoadMethodReliable && pageInfo.pageLoadMethod) {
      result.pageLoadMethod = pageInfo.pageLoadMethod;
    }

    this._tryUnwrapLazyVar(pageInfo.language, (value) => {
      result.lang = value;
    });
    this._tryUnwrapLazyVar(pageInfo.pageStructure, (value) => {
      result.preDoublefetch = value;
      if (value.noindex) {
        result.visibility = 'private';
      }
    });

    if (pageInfo.redirects) {
      result.redirects = pageInfo.redirects;
    }
    if (pageInfo.search) {
      result.search = {
        category: pageInfo.search.category,
        query: pageInfo.search.query,
        depth: pageInfo.search.depth,
      };
    }

    if (isActive && pageInfo.url) {
      result.activity = this.activityEstimator.estimate(pageInfo.url, now);
    }

    return result;
  }

  _setupListener() {
    if (this._removeListeners) {
      // listeners have been already installed
      return;
    }
    const cleanup = [];

    const wrapHandler = (handler) => {
      handler = handler.bind(this);
      return (...args) => {
        if (this.isActive) {
          handler(...args);
        }
      };
    };

    // listeners for chrome.tabs API:
    if (this.chrome.tabs) {
      for (const type of [
        'onCreated',
        'onUpdated',
        'onRemoved',
        'onActivated',
      ]) {
        const handler = wrapHandler(this[`chrome_tabs_${type}`]);
        if (
          this.chrome.tabs[type]?.addListener &&
          this.chrome.tabs[type]?.removeListener
        ) {
          this.chrome.tabs[type].addListener(handler);
          cleanup.push(() => this.chrome.tabs[type].removeListener(handler));
        }
      }
    }

    // listeners for chrome.webRequest API:
    if (this.chrome.webRequest) {
      for (const type of [
        'onBeforeRedirect', // note: unavailable on Safari
        'onResponseStarted', // note: unavailable on Safari
        'onCompleted', // note: unavailable on Safari
        'onAuthRequired', // note: unavailable on Safari
      ]) {
        const handler = wrapHandler(this[`chrome_webRequest_${type}`]);
        if (
          this.chrome.webRequest[type]?.addListener &&
          this.chrome.webRequest[type]?.removeListener
        ) {
          try {
            this.chrome.webRequest[type].addListener(
              handler,
              { urls: ['<all_urls>'] },
              ['responseHeaders'],
            );
          } catch (e) {
            this.chrome.webRequest[type].addListener(handler, {
              urls: ['<all_urls>'],
            });
          }
          cleanup.push(() =>
            this.chrome.webRequest[type].removeListener(handler),
          );
        } else {
          logger.info(`chrome.webRequest.${type} API is unavailable`);
        }
      }
    }

    // listeners for chrome.webNavigation API:
    if (this.chrome.webNavigation) {
      for (const type of [
        'onCreatedNavigationTarget', // note: unavailable on Safari
        'onBeforeNavigate',
        'onCommitted',
        'onHistoryStateUpdated', // note: unavailable on Safari
      ]) {
        const handler = wrapHandler(this[`chrome_webNavigation_${type}`]);
        if (
          this.chrome.webNavigation[type]?.addListener &&
          this.chrome.webNavigation[type]?.removeListener
        ) {
          this.chrome.webNavigation[type].addListener(handler);
          cleanup.push(() =>
            this.chrome.webNavigation[type].removeListener(handler),
          );
        } else {
          logger.info(`chrome.webNavigation.${type} API is unavailable`);
        }
      }
    }

    // listeners for chrome.windows API:
    if (this.chrome.windows) {
      for (const type of [
        'onRemoved', // note: unavailable on Firefox Android and Safari iOS
        'onFocusChanged', // note: unavailable on Firefox Android
      ]) {
        const handler = wrapHandler(this[`chrome_windows_${type}`]);
        if (
          this.chrome.windows[type]?.addListener &&
          this.chrome.windows[type]?.removeListener
        ) {
          this.chrome.windows[type].addListener(handler);
          cleanup.push(() => this.chrome.windows[type].removeListener(handler));
        } else {
          logger.info(`chrome.windows.${type} API is unavailable`);
        }
      }
    }

    this._removeListeners = () => {
      cleanup.forEach((f) => f());
    };
  }

  chrome_tabs_onCreated(tab) {
    if (tab.incognito) {
      this.openTabs.delete(tab.id);
      return;
    }

    if (
      tab.openerTabId === undefined ||
      (tab.pendingUrl && !isRealPage(tab.pendingUrl))
    ) {
      return;
    }

    const openerTab = this.openTabs.get(tab.openerTabId);
    if (openerTab) {
      const oldEntry = this.openTabs.get(tab.id);
      const entry = {
        status: 'created',
        ...oldEntry,
        windowId: tab.windowId,
        lastUpdatedAt: Date.now(),
        pageId: ++this._pageIdGenerator,
        openerTab: { ...openerTab },
      };
      this.openTabs.set(tab.id, entry);
    }
  }

  chrome_tabs_onUpdated(tabId, changeInfo, tab) {
    if (tab.incognito) {
      return;
    }

    const now = Date.now();
    const { windowId } = tab;
    if (tab.active) {
      if (this.activeTab.activeWindowId === windowId) {
        this.activeTab.updateActiveTab({ tabId, windowId, now });
      } else {
        this.activeTab.saveActiveTabInWindow({ tabId, windowId, now });
      }
    }

    let oldTabEntry = this.openTabs.get(tabId);
    if (changeInfo.status === 'complete') {
      const entry = {
        ...oldTabEntry,
        status: 'complete',
        title: tab.title,
        url: tab.url,
        windowId,
        lastUpdatedAt: now,
      };
      this._initAllOptionalFields(tabId, entry, now);
      this.openTabs.set(tabId, entry);
      return;
    }

    if (tab.status === 'loading') {
      let entry;
      if (
        oldTabEntry &&
        (oldTabEntry.url === tab.url ||
          (oldTabEntry.url === 'about:blank' &&
            oldTabEntry.status === 'loading'))
      ) {
        // still loading the same page
        entry = {
          ...oldTabEntry,
          title: tab.title,
          url: tab.url,
          windowId,
          lastUpdatedAt: now,
        };

        const red = entry._unverifiedRedirects;
        if (red && tab.url !== 'about:blank') {
          if (red[red.length - 1].to === tab.url) {
            entry.redirects = [...red];
            logger.debug('confirmed redirect:', red, '->', tab.url);
          } else {
            logger.warn('rejected redirects:', { ...entry });
          }
          delete entry._unverifiedRedirects;
        }
      } else {
        entry = {
          status: 'loading',
          pageLoadMethod: 'full-page-load',
          title: tab.title,
          url: tab.url,
          windowId,
          lastUpdatedAt: now,
          pageId: ++this._pageIdGenerator,
        };
        if (oldTabEntry) {
          if (oldTabEntry.status !== 'created') {
            entry.openedFrom = { ...oldTabEntry };
          } else if (oldTabEntry.openerTab) {
            entry.openedFrom = { ...oldTabEntry.openerTab };
          }

          const redirects = entry.openedFrom?.pendingRedirects || [];
          if (redirects.length > 0) {
            const target = redirects[redirects.length - 1].to;
            if (target === tab.url) {
              entry.redirects = [...redirects];
            } else if (tab.url === 'about:blank') {
              logger.debug('delaying redirect matching:', redirects);
              entry._unverifiedRedirects = [...redirects];
            }
          }

          const previousUrl = entry.openedFrom?.url;
          if (isRealPage(previousUrl)) {
            entry.previousUrl = previousUrl;
          }
        }
      }

      if (!entry.search && entry.openedFrom?.search && entry.previousUrl) {
        // depth 0:   the SERP
        // depth 1:   the landing page
        // depth 2:   one click within the landing page (but on within the same hostname)
        // depth >=3: drop (because the query could become a session ID)
        if (
          entry.openedFrom.search.depth === 0 ||
          (entry.openedFrom.search.depth === 1 &&
            sameHostname(entry.url, entry.previousUrl))
        ) {
          entry.search = {
            ...entry.openedFrom.search,
            depth: entry.openedFrom.search.depth + 1,
            lastUpdatedAt: now,
          };
        }
      }

      this.openTabs.set(tabId, entry);
      return;
    }

    if (oldTabEntry) {
      const entry = {
        ...oldTabEntry,
        lastUpdatedAt: now,
      };

      let updated = false;
      if (tab.title && tab.title !== entry.title) {
        entry.title = tab.title;
        entry.pageId = ++this._pageIdGenerator; // TODO: is this too conservative?
        updated = true;
      }
      if (tab.url && tab.url !== entry.url) {
        entry.url = tab.url;
        entry.pageId = ++this._pageIdGenerator;
        updated = true;
      }

      this.openTabs.set(tabId, entry);
      if (updated) {
        this.notifyObservers({
          type: 'page-updated',
          tabId,
        });
      }
      return;
    }

    logger.warn('Unexpected status:', changeInfo.status);
  }

  chrome_tabs_onRemoved(tabId) {
    if (!this.openTabs.delete(tabId)) {
      logger.debug('Trying to remove unknown tab:', tabId);
    }
    if (this.activeTab.tabId === tabId) {
      this.activeTab.updateActiveTab({
        tabId: TAB_ID_NONE,
        windowId: WINDOW_ID_NONE,
      });
    }
  }

  chrome_tabs_onActivated(activeInfo) {
    const now = Date.now();
    const { tabId, windowId } = activeInfo;
    this.activeTab.updateActiveTab({ tabId, windowId, now });

    const entry = this.openTabs.get(tabId);
    if (entry?.status === 'complete') {
      this._initAllOptionalFields(tabId, entry, now);
    }
  }

  // Safari quirks:
  // * This API is not available
  chrome_webRequest_onBeforeRedirect(details) {
    if (details.initiator && details.initiator !== 'null' && details.ip) {
      this._cacheDnsResolution(details.initiator, details.ip);
    }
    if (details.type !== 'main_frame') {
      return;
    }
    if (details.statusCode === 0) {
      // Ignore mysterious even from Firefox with statusCode=0 and url=redirectUrl.
      // Perhaps it has to do with single-page applications, but the documentation
      // does not give any insights about this behavior.
      return;
    }
    const { tabId, statusCode, url: from, redirectUrl: to } = details;
    logger.debug('Detected redirect:', from, '->', to, 'with tabId', tabId);

    const entry = {
      ...this.openTabs.get(tabId),
      status: 'redirecting',
      lastUpdatedAt: Date.now(),
    };
    const thisRedirect = {
      from,
      to,
      statusCode,
    };
    if (!entry.pendingRedirects) {
      entry.pendingRedirects = [thisRedirect];
    } else if (entry.pendingRedirects.length < this.maxRedirects) {
      entry.pendingRedirects = [...entry.pendingRedirects, thisRedirect];
    } else if (
      entry.pendingRedirects[entry.pendingRedirects.length - 1].to !== '...'
    ) {
      logger.warn(
        'Break exceptionally long redirect chain (redirect loop?):',
        entry.pendingRedirects,
        '-->',
        thisRedirect,
        '(destination will be replaced by "...")',
      );
      thisRedirect.to = '...';
      entry.pendingRedirects = [...entry.pendingRedirects, thisRedirect];
    } else {
      entry.pendingRedirects = [...entry.pendingRedirects];
    }
    this.openTabs.set(tabId, entry);
  }

  // Safari quirks:
  // * This API is not available
  chrome_webRequest_onResponseStarted(details) {
    if (details.initiator && details.initiator !== 'null' && details.ip) {
      this._cacheDnsResolution(details.initiator, details.ip);
    }
  }

  // Safari quirks:
  // * This API is not available
  chrome_webRequest_onCompleted(details) {
    if (this.activeTab.tabId === details.tabId) {
      const entry = this.openTabs.get(details.tabId);
      if (entry && isRealPage(entry.url)) {
        let contentLength = 0;
        for (const { name, value } of details.responseHeaders) {
          if (name.toLowerCase() === 'content-length') {
            contentLength = Number(value) || 0;
            break;
          }
        }
        if (contentLength > 1024) {
          this.activityEstimator.dynamicLoadDetected(entry.url);
        }
      }
    }
  }

  // Test page: https://jigsaw.w3.org/HTTP/Basic/
  //
  // Safari quirks:
  // * This API is not available
  chrome_webRequest_onAuthRequired(details) {
    const { tabId, url } = details;
    const entry = this.openTabs.get(tabId);
    if (entry?.url === url) {
      this.openTabs.set(tabId, {
        entry,
        visibility: 'private',
        pageId: ++this._pageIdGenerator,
        lastUpdatedAt: Date.now(),
      });
    }

    this.newPageApprover.markAsPrivate(url).catch((e) => {
      logger.warn('Failed to mark page as private:', url, e);
    });
  }

  // Safari quirks:
  // * This API is not available
  chrome_webNavigation_onCreatedNavigationTarget(details) {
    if (details.sourceFrameId !== 0) {
      return;
    }
    const { tabId, sourceTabId, windowId } = details;
    const openerTab = this.openTabs.get(sourceTabId);
    if (!openerTab) {
      return;
    }

    const oldEntry = this.openTabs.get(tabId);
    const entry = {
      status: 'created',
      ...oldEntry,
      windowId,
      lastUpdatedAt: Date.now(),
      openerTab: { ...openerTab },
    };
    this.openTabs.set(tabId, entry);
  }

  chrome_webNavigation_onBeforeNavigate(details) {
    if (details.frameId !== 0) {
      return;
    }
    const { tabId, url } = details;
    const oldEntry = this.openTabs.get(tabId);
    if (oldEntry && oldEntry.url !== url) {
      // Invalidate the page id since there will be a navigation in the near future.
      // The tab API should handle the update, but all pending operations that
      // inspect the content of the page should be aborted.
      this.openTabs.set(tabId, {
        ...oldEntry,
        pageId: ++this._pageIdGenerator,
        lastUpdatedAt: Date.now(),
      });
    }
  }

  // has two interesting fields in details:
  // - transitionQualifiers: ['forward_back']
  // - transitionType: "link"
  //
  // Safari quirks:
  // * The API exists, but "transitionType" is not supported
  chrome_webNavigation_onCommitted(details) {
    if (details.frameId !== 0) {
      return;
    }
    const isBackOrForward =
      details.transitionQualifiers?.includes('forward_back');

    // TODO for Safari: according to their docs, transitionType is not supported
    let forgetOpenedFrom = details.transitionType !== 'link';
    if (isBackOrForward) {
      // Maybe we could be smarter here; unfortunately the API gives no clues
      // whether it was a back or a forward navigation. As a workaround, forget
      // all information that may be wrong. In some situation it may be possible
      // to prove that it was a forward navigation (in that case, we should
      // not clear the information).
      // See also https://stackoverflow.com/q/25542015/783510
      forgetOpenedFrom = true;
    }
    if (forgetOpenedFrom) {
      const { tabId } = details;
      const oldEntry = this.openTabs.get(tabId);
      if (oldEntry?.previousUrl || oldEntry?.openedFrom) {
        // this creates a copy, but omits the fields related to "opened from"
        // eslint-disable-next-line no-unused-vars
        const { previousUrl, openedFrom, search, ...entry } = { ...oldEntry };
        this.openTabs.set(tabId, entry);
      }
    }
  }

  // TODO: this needs to be thought through (the timing between chrome.tab and webNavigation might be subtle)
  //
  // Safari quirks:
  // * This API is not available
  chrome_webNavigation_onHistoryStateUpdated(details) {
    const { tabId } = details;
    const entry = this.openTabs.get(tabId);
    if (!entry) {
      logger.warn('Navigation event in a non-existing tab detected!');
      return;
    }
    this.openTabs.set(tabId, {
      ...entry,
      pageLoadMethod: 'history-navigation',
      status: 'after-history-state-update',
      lastUpdatedAt: Date.now(),
      pageId: ++this._pageIdGenerator,
    });
  }

  chrome_windows_onRemoved(windowId) {
    if (windowId !== WINDOW_ID_NONE) {
      this.activeTab.removeWindow(windowId);
    }
  }

  /**
   * This API makes more sense on Desktop than on Mobile:
   * - Unavailabe on Firefox for Android.
   * - Safari on iOS (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/windows/onFocusChanged):
   *   > Fires when toggling in or out of private browsing mode, leaving Safari
   *   > to the home screen, and returning to Safari from the home screen.
   */
  chrome_windows_onFocusChanged(windowId) {
    if (windowId !== WINDOW_ID_NONE) {
      this.activeTab.focusWindow(windowId);
    }
  }

  /**
   * Tabs can be closed at any point. This function detects such cases
   * and warns as a side-effect. Thus, it should be used only in situations
   * where it is possible, but unexpected that the tab is gone.
   */
  _tabVanished(tabId, pageId, ...details) {
    const entry = this.openTabs.get(tabId);
    if (!entry) {
      logger.debug('Tab', tabId, 'closed:', ...details);
      return true;
    }
    if (entry.pageId !== pageId) {
      logger.debug('Tab', tabId, 'changed pageId:', ...details);
      return true;
    }
    return false;
  }

  _cacheDnsResolution(url, ip) {
    if (
      this.dnsResolver.cacheDnsResolution({ url, ip }) &&
      this.sessionStore.isReady()
    ) {
      this.sessionStore.set('dnsResolver', this.dnsResolver.serialize());
    }
  }

  _initVisibility(tabId, entry) {
    if (!entry.visibility) {
      const { visibility, search } = this._checkPageVisibility(entry.url);
      entry.visibility = visibility;
      if (visibility !== 'private') {
        if (search) {
          entry.search = {
            category: search.category,
            query: search.query,
            depth: 0,
            lastUpdatedAt: Date.now(),
          };
        }
      }
    }
  }

  _initAllOptionalFields(tabId, entry) {
    const now = Date.now();
    const { pageId } = entry;
    this._initVisibility(tabId, entry, now);
    this._tryAnalyzePageStructure(tabId, entry, now);

    // Note: this benefits from running after the page structure.
    // Unless there is a reason, do not move it up.
    this._tryLanguageDetection(tabId, pageId, entry);
  }

  _tryLanguageDetection(tabId, pageId, entry) {
    this._setLazyVar('language', entry, tabId, {
      precond: () => entry.visibility !== 'private' && isRealPage(entry.url),
      init: () => this._detectLanguage(tabId, pageId, entry),
    });
  }

  /**
   * There are three types of results:
   *
   * 1) If it was successful in detecting a language, it returns something
   *    'en', 'de', 'fr'.
   * 2) If the language could not be detected by the API or belonged to a
   *    group that is considered too small to be safe, '--' will be returned.
   * 3) If the language detection was skipped, it returns an empty string ('')
   */
  async _detectLanguage(tabId, pageId, entry) {
    if (!this.chrome?.tabs?.detectLanguage) {
      return ''; // the API is not available on all platforms (e.g. Firefox for Android)
    }

    // If the website does not want to be indexed, there is
    // no point in running a costly language detection.
    if (entry.pageStructure) {
      try {
        const structure = await this._awaitLazyVar(entry.pageStructure);
        if (structure?.noindex) {
          logger.debug(
            'No need to detect the language, since the page is private',
          );
          return '';
        }
      } catch (e) {
        logger.warn(
          'Unexpected error while waiting for the page structure:',
          e,
        );
        return '';
      }
    }

    if (this._tabVanished(tabId, pageId, 'before detectLanguage')) {
      return CANCEL_LAZY_VAR;
    }
    try {
      const lang = await this.chrome.tabs.detectLanguage(tabId);
      const normalizedLang = this._normalizeDetectedLanguage(lang);
      logger.debug(
        'detected language for tabID',
        tabId,
        ':',
        lang,
        '->',
        normalizedLang,
      );
      return normalizedLang;
    } catch (e) {
      if (this._tabVanished(tabId, pageId, 'during detectLanguage')) {
        return CANCEL_LAZY_VAR;
      }
      if (e.message === 'Cannot determine language') {
        logger.debug('API to detect language is not available', e);
        return '';
      }

      logger.warn('Unexpected error', e);
      return '';
    }
  }

  /**
   * Takes the output of chrome.tabs.detectLanguage and maps it to well-known values.
   * If possible, avoid browser-specific differences (e.g. "de" on Firefox/Chrome vs
   * "de-DE" on Safari). Also, hide languages that we did not expect, or that are
   * expected to be relatively rare.
   */
  _normalizeDetectedLanguage(lang) {
    this.langStats[lang] = (this.langStats[lang] || 0) + 1;

    const cleanedLang = split0(lang, '-');
    switch (cleanedLang) {
      // Note: the following list was taken from Chrome and checked on Wikipedia
      // homepages. Smaller languages that were not consistently detected by Firefox
      // where removed.
      case 'af': // Africaans
      case 'ar': // Arabic
      case 'ca': // Catalan
      case 'cs': // Czech
      case 'da': // Danish
      case 'de': // German
      case 'el': // Greek
      case 'en': // English
      case 'es': // Spanish
      case 'fa': // Persian
      case 'fi': // Finish
      case 'fr': // French
      case 'hi': // Hindi
      case 'hr': // Croatian
      case 'hu': // Hungarian
      case 'id': // Indonesian
      case 'it': // Italian
      case 'ja': // Japanese
      case 'ko': // Korean
      case 'nl': // Dutch
      case 'no': // Norwegian
      case 'pl': // Polish
      case 'pt': // Portuguese
      case 'ro': // Romanian
      case 'ru': // Russian
      case 'sk': // Slovak
      case 'sl': // Slovenian
      case 'sq': // Albanian
      case 'sr': // Serbian
      case 'sv': // Swedish
      case 'th': // Thai
      case 'tr': // Turkish
      case 'uk': // Ukrainian
      case 'vi': // Vietnamese
      case 'zh': // Chinese
        return cleanedLang;

      case 'und':
        // Firefox and Chrome return 'und' for unknown languages
        return '--';

      // An incomplete list of languages where the number of speakers is low.
      // You can put them here if you want to suppress a warning.
      case 'la': // Latin
      case 'fy': // Frisian
      case 'yi': // Yiddish
      case 'iw': // Hebrew (Chrome)
      case 'he': // Hebrew (Firefox)
        return '--';
    }

    if (this.langStats[lang] === 1) {
      logger.info('Unexpected language:', lang);
    }
    return '--';
  }

  _tryAnalyzePageStructure(tabId, entry) {
    const { pageId } = entry;
    this._setLazyVar('pageStructure', entry, tabId, {
      precond: () =>
        entry.status === 'complete' &&
        entry.visibility !== 'private' &&
        isRealPage(entry.url),
      init: () => this._analyzePageStructure(tabId, pageId),
    });
  }

  async _analyzePageStructure(tabId, pageId) {
    if (this._tabVanished(tabId, pageId, 'before analyzePageStructure')) {
      return CANCEL_LAZY_VAR;
    }
    try {
      const wrappedResult = await chrome.scripting.executeScript({
        target: {
          tabId,
        },
        func: analyzePageStructure,
      });
      const { result } = wrappedResult[0];
      if (this._tabVanished(tabId, pageId, 'after analyzePageStructure')) {
        logger.warn(
          'analyzePageStructure completed but the page has changed. Ignoring results:',
          result,
        );
        return CANCEL_LAZY_VAR;
      }
      logger.debug('Page structure:', result);
      return {
        ...result,
        lastUpdatedAt: Date.now(),
      };
    } catch (e) {
      // On Chrome, it is expected to fail on the extension store
      // (e.g. https://chrome.google.com/webstore/category/recommended_extensions?hl=en)
      const msg = e.message;
      if (msg === 'The extensions gallery cannot be scripted.') {
        return {
          noindex: true,
          details: msg,
        };
      }
      if (this._tabVanished(tabId, pageId, 'during analyzePageStructure')) {
        return CANCEL_LAZY_VAR;
      }

      // On Chrome: if the page did not load
      if (
        msg.startsWith('Frame with ID') &&
        msg.endsWith('is showing error page')
      ) {
        return {
          noindex: true,
          details: 'Page failed to load',
        };
      }

      logger.error('Unable to extract structural information', e);
      return {
        error: true,
        details: `Unable to run analyzePageStructure script (reason: ${e})`,
        noindex: true,
      };
    }
  }

  // TODO:
  // Maybe extract this functionality.
  // Caching old values could also help. Not primarily for performance
  // (though it could make help for that as well), but to put "unknown"
  // into the right visibility category if possible.
  _checkPageVisibility(url) {
    if (!isRealPage(url)) {
      return {
        visibility: 'private',
        reason: 'not an HTTP page',
      };
    }

    const { category, query } = this.urlAnalyzer.parseSearchLinks(url);
    if (category && query) {
      const normalizedCategory = category.startsWith('search-')
        ? category.slice('search-'.length)
        : category;
      return {
        visibility: 'public',
        reason: 'indexed by search engine',
        search: {
          category: normalizedCategory,
          query,
        },
      };
    }

    if (this.dnsResolver.isPrivateURL(url)) {
      return {
        visibility: 'private',
        reason: 'private network',
      };
    }

    return {
      visibility: 'unknown',
      reason: 'further checks are needed',
    };
  }

  // This provides a low-level mechanism to safely deal with values
  // that need asynchronous initialization.
  // Other classes should not be aware of it, since they should only
  // operate on snapshots (which don't export myChecks operations).
  // Neither should it be needed to understand it while accessing values
  // during debugging; once the operations are finished, they only
  // the actual results will be preserved.
  //
  // Notes:
  // - "asyncInit" is not expected not throw. If it may fail, define an
  //   explicit error state (e.g. CANCEL_LAZY_VAR) and resolve with that.
  // - To safely read the value, you can use the "_tryUnwrapLazyVar" helper.
  //   Note that "CANCEL_LAZY_VAR" will be interpreted as error cases
  //   and results in missing values (i.e. the callback does not trigger).
  // - There is limited support for lazy vars to depend on each other
  //   (see _awaitLazyVar), but be careful when using it since you get
  //   only weak guarantees (e.g. the lazy var might not be present yet).
  //   If you have important dependencies, consider merging them together
  //   in one big lazy var (within the async init, dependencies are
  //   easier to manage).
  _setLazyVar(field, entry, tabId, { init: asyncInit, precond = () => true }) {
    if (!entry[field] && precond()) {
      entry[field] = {
        _pending: asyncInit(),
      };
      entry[field]._pending
        .then((result) => {
          const now = Date.now();
          entry[field].result = result;
          entry[field].resolvedAt = now;
          entry.lastUpdatedAt = now;

          if (this.openTabs.get(tabId)?.[field] === entry[field]) {
            const entry_ = this.openTabs.get(tabId);
            entry_[field] = result;
            entry_.lastUpdatedAt = now;
          }
          entry[field] = result;

          this._onTabChanged(tabId);
          this.notifyObservers({
            type: 'lazy-init',
            field,
            tabId,
          });
        })
        .catch((e) => {
          logger.error(
            `Internal error while initializing field: "${field}" (it is a bug in the code)`,
            e,
          );
        });
    }
  }

  _tryUnwrapLazyVar(value, callbackIfPresent) {
    if (!isNil(value) && value !== CANCEL_LAZY_VAR) {
      if (!value._pending) {
        callbackIfPresent(value);
      } else if (!isNil(value.result) && value.result !== CANCEL_LAZY_VAR) {
        callbackIfPresent(value.result);
      }
    }
  }

  async _awaitLazyVar(value) {
    if (!value) {
      throw new Error(
        'Lazy var not found (cannot await a lazy var before it has been initialized)',
      );
    }
    await value._pending;
    return value._pending ? value.result : value;
  }

  /**
   * Listeners defined in this class follow a naming convention, for instance:
   * - "chrome_tabs_onCreated" (listener for chrome.tabs.onCreated)
   * - "chrome_webNavigation_onCommitted" (chrome.webNavigation.onCommitted)
   *
   * Example output:
   * [
   *   { method: 'chrome_tabs_onCreated', api: 'tabs', type: 'onCreated' },
   *   { method: 'chrome_webNavigation_onCommitted', api: 'webNavigation', type: 'onCommitted' },
   * ]
   */
  static describeListeners() {
    const listeners = Object.getOwnPropertyNames(Pages);
    return ['webRequest', 'webNavigation', 'tabs', 'windows'].flatMap((api) => {
      const prefix = `chrome_${api}_`;
      return listeners
        .filter((method) => method.startsWith(prefix))
        .map((method) => ({
          method,
          api,
          type: method.slice(prefix.length),
        }));
    });
  }

  async selfChecks(check = new SelfCheck()) {
    const myChecks = (async () => {
      if (this.isActive) {
        if (this.sessionStore.isReady()) {
          const expectedSession = this._serializeFullSession();
          const detectedPromises = flattenObject(expectedSession).filter(
            ({ path }) =>
              path.includes('_pending') || path.includes(CANCEL_LAZY_VAR._tag),
          );
          if (detectedPromises.length > 0) {
            check.fail('Promises must not be serialized', { detectedPromises });
          } else {
            const realSession = this.sessionStore.getEntries();
            if (equalityCanBeProven(expectedSession, realSession)) {
              check.pass('Session in sync', {
                expectedSession,
                realSession,
              });
            } else {
              check.warn('Session may be out to sync', {
                expectedSession,
                realSession,
              });
            }
          }
        } else {
          check.warn('initialization of sessionStore not finished');
        }
      }

      // check page ids:
      // - all entry *must* have page ids
      // - page ids *should* be unique
      const tabsWithMissingPageIds = [];
      const pageIds = new Set();
      const pageIdClashes = [];
      for (const [tabId, entry] of this.openTabs.entries()) {
        if (!entry.pageId) {
          tabsWithMissingPageIds.push([tabId, entry]);
        }
        if (pageIds.has(tabId)) {
          // not an error, but by construction, it should be extremely
          // unlikely that this happens
          pageIdClashes.push([tabId, entry]);
        } else {
          pageIds.add(tabId);
        }
      }
      if (tabsWithMissingPageIds.length > 0) {
        check.fail(
          'Found entry without page ids',
          Object.fromEntries(tabsWithMissingPageIds),
        );
      }
      if (pageIdClashes.length > 0) {
        check.warn('Found a pageId clash', Object.fromEntries(pageIdClashes));
      }
    })();
    await Promise.all([
      myChecks,
      eventListenerQueue.selfChecks(check.for('eventListenerQueue')),
      this.activeTab.selfChecks(check.for('activeTab')),
      this.activityEstimator.selfChecks(check.for('activityEstimator')),
    ]);
    return check;
  }
}

export const eventListenerQueue = new EventListenerQueue({
  connectTimeoutInMs: 1000,
  maxBufferLength: 1024,
  listeners: Pages.describeListeners(),
});
