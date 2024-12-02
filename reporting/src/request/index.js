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

/* eslint-disable no-param-reassign */
import { isLocalIP } from '../network.js';
import Config from './config.js';
import Database from './database.js';

import { truncatedHash } from '../md5.js';
import logger from '../logger.js';

import { parse } from '../utils/url.js';
import { BlockingResponse, WebRequestContext } from './utils/webrequest.js';
import * as datetime from './utils/time.js';
import QSWhitelist2 from './qs-whitelist2.js';
import TempSet from './utils/temp-set.js';
import { HashProb, shouldCheckToken } from './hash/index.js';
import { COOKIE_MODE, VERSION } from './config.js';
import random from '../random.js';

import CookieContext from './steps/cookie-context.js';
import PageLogger from './steps/page-logger.js';
import TokenChecker from './steps/token-checker/index.js';
import TokenExaminer from './steps/token-examiner.js';
import TokenTelemetry from './steps/token-telemetry/index.js';
import OAuthDetector from './steps/oauth-detector.js';
import {
  checkSameGeneralDomain,
  checkValidContext,
} from './steps/check-context.js';
import PageStore from './page-store.js';

const DAY_CHANGE_INTERVAL = 20 * 1000;
const RECENTLY_MODIFIED_TTL = 30 * 1000;

export default class RequestReporter {
  constructor(
    settings,
    {
      trustedClock,
      countryProvider,
      communication,
      getBrowserInfo,
      onTrackerInteraction = (event, state) => {
        logger.info('Tracker', event, 'with url:', state.url);
      },
      isRequestAllowed = () => false,
      dryRunMode = false,
    },
  ) {
    this.settings = settings;
    this.communication = communication;
    this.trustedClock = trustedClock;
    this.countryProvider = countryProvider;
    this.onTrackerInteraction = onTrackerInteraction;
    this.getBrowserInfo = getBrowserInfo;
    this.isRequestAllowed = isRequestAllowed;
    if (dryRunMode) {
      logger.warn(
        '[DRY_RUN] dry-run mode is enabled. Fingerprinting removal is disabled.',
      );
    } else {
      logger.debug('Fingerprinting removal is enabled');
    }
    this.dryRunMode = dryRunMode;
    this.VERSION = VERSION;
    this.LOG_KEY = 'attrack';
    this.debug = false;
    this.recentlyModified = new TempSet();
    this.whitelistedRequestCache = new Set();
    this.pageStore = new PageStore({
      notifyPageStageListeners: this.onPageStaged.bind(this),
    });

    this.ready = false;
    const urls = ['http://*/*', 'https://*/*'];
    // TODO: find a way to detect if blocking webRequest is available on Brave and Opera
    const blockingWebRequest = chrome.runtime
      .getManifest()
      .permissions.includes('webRequestBlocking');

    chrome.webRequest.onBeforeRequest.addListener(
      this.onBeforeRequest,
      { urls },
      blockingWebRequest
        ? Object.values(chrome.webRequest.OnBeforeRequestOptions)
        : undefined,
    );
    chrome.webRequest.onBeforeSendHeaders.addListener(
      this.onBeforeSendHeaders,
      { urls },
      blockingWebRequest
        ? Object.values(chrome.webRequest.OnBeforeSendHeadersOptions)
        : undefined,
    );
    chrome.webRequest.onHeadersReceived.addListener(
      this.onHeadersReceived,
      { urls },
      blockingWebRequest
        ? Object.values(chrome.webRequest.OnHeadersReceivedOptions)
        : undefined,
    );
    chrome.webRequest.onCompleted.addListener(this.onCompleted, { urls });
    chrome.webRequest.onErrorOccurred.addListener(this.onErrorOccurred, {
      urls,
    });
  }

  #reportTrackerInteraction(kind, state) {
    try {
      this.onTrackerInteraction(kind, state);
    } catch (e) {
      console.error(e);
    }
  }

  checkIsWhitelisted(state) {
    if (this.whitelistedRequestCache.has(state.requestId)) {
      return true;
    }
    if (this.isRequestAllowed(state)) {
      this.whitelistedRequestCache.add(state.requestId);
      return true;
    }
    return false;
  }

  isCookieEnabled() {
    return this.config.cookieEnabled;
  }

  isQSEnabled() {
    return this.config.qsEnabled;
  }

  isFingerprintingEnabled() {
    return this.config.fingerprintEnabled;
  }

  isReferrerEnabled() {
    return this.config.referrerEnabled;
  }

  telemetry(message) {
    if (!this.communication) {
      logger.error('No provider provider loaded');
      return;
    }

    message.type = 'wtm.request';
    message.userAgent = this.userAgent;
    message.ts = this.trustedClock.getTimeAsYYYYMMDD();
    message['anti-duplicates'] = Math.floor(random() * 10000000);

    const data = message.payload;
    message.payload = { data };
    message.payload.ver = VERSION;
    message.payload.day = this.qs_whitelist.getVersion().day;
    message.payload.ts = this.trustedClock.getTimeAsYYYYMMDDHH();
    message.payload.ctry = this.countryProvider.getSafeCountryCode();

    logger.debug('report', message);

    this.communication.send(message);
  }

  /** Global module initialisation.
   */
  async init() {
    this.db = new Database();
    await this.db.init();
    this.config = new Config(this.settings, {
      db: this.db,
      trustedClock: this.trustedClock,
    });
    await this.config.init();

    this.hashProb = new HashProb();

    // load all caches:
    // Large dynamic caches are loaded via the persist module, which will
    // lazily propegate changes back to the browser's sqlite database.
    // Large static caches (e.g. token whitelist) are loaded from sqlite
    // Smaller caches (e.g. update timestamps) are kept in prefs
    this.qs_whitelist = new QSWhitelist2({
      storage: this.db,
      CDN_BASE_URL: this.config.remoteWhitelistUrl,
      LOCAL_BASE_URL: this.config.localWhitelistUrl,
    });

    // load the whitelist async - qs protection will start once it is ready
    (async () => {
      try {
        logger.debug('qs_whitelist loading...');
        await this.qs_whitelist.init();
        logger.info(
          'qs_whitelist fully successfully loaded (qs protection ready)',
        );
      } catch (e) {
        logger.warn('Failed to load qs_whitelist (qs protection disabled)', e);
      }
    })();

    this.dayChangedInterval = setInterval(
      this.dayChanged.bind(this),
      DAY_CHANGE_INTERVAL,
    );

    await this.pageStore.init();

    this.userAgent = (await this.getBrowserInfo()).name;

    this.pageLogger = new PageLogger(this.config.placeHolder);
    this.cookieContext = new CookieContext(this.config, this.qs_whitelist);
    await this.cookieContext.init();

    this.oAuthDetector = new OAuthDetector();
    await this.oAuthDetector.init();

    this.tokenTelemetry = new TokenTelemetry(
      this.telemetry.bind(this),
      this.qs_whitelist,
      this.config,
      this.db,
      this.shouldCheckToken.bind(this),
      this.config.tokenTelemetry,
      this.trustedClock,
    );
    await this.tokenTelemetry.init();

    this.tokenExaminer = new TokenExaminer(
      this.qs_whitelist,
      this.config,
      this.shouldCheckToken.bind(this),
    );
    await this.tokenExaminer.init();

    this.tokenChecker = new TokenChecker(
      this.qs_whitelist,
      {},
      this.shouldCheckToken.bind(this),
      this.config,
      this.db,
    );
    await this.tokenChecker.init();

    this.ready = true;
  }

  unload() {
    this.ready = false;
    if (this.qs_whitelist) {
      this.qs_whitelist.destroy();
    }
    if (this.cookieContext) {
      this.cookieContext.unload();
    }
    if (this.tokenExaminer) {
      this.tokenExaminer.unload();
    }
    if (this.tokenChecker) {
      this.tokenChecker.unload();
    }

    chrome.webRequest.onBeforeRequest.removeListener(this.onBeforeRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(
      this.onBeforeSendHeaders,
    );
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeadersReceived);
    chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(this.onErrorOccurred);

    if (this.db) {
      this.db.unload();
    }
    clearInterval(this.dayChangedInterval);
    this.dayChangedInterval = null;
  }

  onBeforeRequest = (details) => {
    if (!this.ready) {
      logger.warn('onBeforeRequest skipped (not ready)');
      return;
    }
    const state = WebRequestContext.fromDetails(details, this.pageStore);
    const response = new BlockingResponse(details, 'onBeforeRequest');
    // checkState
    if (checkValidContext(state) === false) {
      return response.toWebRequestResponse();
    }
    // oAuthDetector.checkMainFrames
    if (this.oAuthDetector.checkMainFrames(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkIsMainDocument
    if (!state.isMainFrame === false) {
      return response.toWebRequestResponse();
    }
    // checkSameGeneralDomain
    if (checkSameGeneralDomain(state) === false) {
      return response.toWebRequestResponse();
    }
    // cancelRecentlyModified
    if (this.cancelRecentlyModified(state, response) === false) {
      return response.toWebRequestResponse();
    }

    this.pageLogger.onBeforeRequest(state);

    // logIsTracker
    if (
      this.qs_whitelist.isTrackerDomain(
        truncatedHash(state.urlParts.generalDomain),
      )
    ) {
      this.#reportTrackerInteraction('observed', state);
    }
    // checkExternalBlocking
    if (response.cancel === true || response.redirectUrl) {
      state.incrementStat('blocked_external');
      state.page.counter += 1;
      return response.toWebRequestResponse();
    }
    // tokenExaminer.examineTokens
    if (this.tokenExaminer.examineTokens(state) === false) {
      return response.toWebRequestResponse();
    }

    this.tokenTelemetry.extractKeyTokens(state);

    // tokenChecker.findBadTokens
    if (this.tokenChecker.findBadTokens(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkSourceWhitelisted
    if (this.checkIsWhitelisted(state)) {
      state.incrementStat('source_whitelisted');
      return response.toWebRequestResponse();
    }
    // checkShouldBlock
    if (
      (state.badTokens.length > 0 && this.qs_whitelist.isUpToDate()) === false
    ) {
      return response.toWebRequestResponse();
    }
    // oAuthDetector.checkIsOAuth
    if (this.oAuthDetector.checkIsOAuth(state, 'token') === false) {
      return response.toWebRequestResponse();
    }
    // isQSEnabled
    if (this.isQSEnabled() === false) {
      return response.toWebRequestResponse();
    }
    if (this.checkCompatibilityList(state) === false) {
      return response.toWebRequestResponse();
    }
    if (this.dryRunMode) {
      logger.warn(
        '[DRY_RUN]: Skipping fingerprint removal for URL:',
        details.url,
      );
      logger.info('[DRY_RUN]: Skipped fingerprint removal. Details:', {
        details,
        badTokens: state.badTokens,
      });
      this.#reportTrackerInteraction('fingerprint-detected', state);
      return response.toWebRequestResponse();
    }

    this.applyBlock(state, response);

    return response.toWebRequestResponse();
  };

  onBeforeSendHeaders = (details) => {
    if (!this.ready) {
      logger.warn('onBeforeSendHeaders skipped (not ready)');
      return;
    }
    const state = WebRequestContext.fromDetails(details, this.pageStore);
    const response = new BlockingResponse(details, 'onBeforeSendHeaders');
    // checkState
    if (checkValidContext(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.assignCookieTrust
    this.cookieContext.assignCookieTrust(state);

    // checkIsMainDocument
    if (!state.isMainFrame === false) {
      return response.toWebRequestResponse();
    }
    // checkSameGeneralDomain
    if (checkSameGeneralDomain(state) === false) {
      return response.toWebRequestResponse();
    }

    this.pageLogger.onBeforeSendHeaders(state);

    // checkHasCookie
    // hasCookie flag is set by pageLogger.onBeforeSendHeaders
    if ((state.hasCookie === true) === false) {
      return response.toWebRequestResponse();
    }
    // checkIsCookieWhitelisted
    if (this.checkIsCookieWhitelisted(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkCompatibilityList
    if (this.checkCompatibilityList(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkCookieBlockingMode
    if (this.checkCookieBlockingMode(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkCookieTrust
    if (this.cookieContext.checkCookieTrust(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkVisitCache
    if (this.cookieContext.checkVisitCache(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkContextFromEvent
    if (this.cookieContext.checkContextFromEvent(state) === false) {
      return response.toWebRequestResponse();
    }
    // oAuthDetector.checkIsOAuth
    if (this.oAuthDetector.checkIsOAuth(state, 'cookie') === false) {
      return response.toWebRequestResponse();
    }
    // shouldBlockCookie
    if (
      (!this.checkIsWhitelisted(state) && this.isCookieEnabled(state)) === false
    ) {
      state.incrementStat('bad_cookie_sent');
      return response.toWebRequestResponse();
    }

    if (this.dryRunMode) {
      logger.warn('[DRY_RUN]: Skipping cookie removal for URL:', details.url);
      logger.info('[DRY_RUN]: Skipped fingerprint removal. Details:', {
        details,
        cookie: state.getCookieData(),
      });
      this.#reportTrackerInteraction('cookie-detected', state);
    } else {
      // blockCookie
      state.incrementStat('cookie_blocked');
      state.incrementStat('cookie_block_tp1');
      response.modifyHeader('Cookie', '');
      if (this.config.sendAntiTrackingHeader) {
        response.modifyHeader(this.config.cliqzHeader, ' ');
      }
      state.page.counter += 1;
      this.#reportTrackerInteraction('cookie-removed', state);
    }
    return response.toWebRequestResponse();
  };

  onHeadersReceived = (details) => {
    if (!this.ready) {
      logger.warn('onHeadersReceived skipped (not ready)');
      return;
    }
    const state = WebRequestContext.fromDetails(details, this.pageStore);
    const response = new BlockingResponse(details, 'onHeadersReceived');
    // checkState
    if (checkValidContext(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkIsMainDocument
    if (!state.isMainFrame === false) {
      return response.toWebRequestResponse();
    }
    // checkSameGeneralDomain
    if (checkSameGeneralDomain(state) === false) {
      return response.toWebRequestResponse();
    }

    // pageLogger.onHeadersReceived
    this.pageLogger.onHeadersReceived(state);

    // checkSetCookie
    if ((state.hasSetCookie === true) === false) {
      return response.toWebRequestResponse();
    }
    // shouldBlockCookie
    if (
      (!this.checkIsWhitelisted(state) && this.isCookieEnabled(state)) === false
    ) {
      return response.toWebRequestResponse();
    }
    // checkIsCookieWhitelisted
    if (this.checkIsCookieWhitelisted(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkCompatibilityList
    if (this.checkCompatibilityList(state) === false) {
      return response.toWebRequestResponse();
    }
    // checkCookieBlockingMode
    if (this.checkCookieBlockingMode(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkCookieTrust
    if (this.cookieContext.checkCookieTrust(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkVisitCache
    if (this.cookieContext.checkVisitCache(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.checkContextFromEvent
    if (this.cookieContext.checkContextFromEvent(state) === false) {
      return response.toWebRequestResponse();
    }

    if (this.dryRunMode) {
      logger.warn('[DRY_RUN]: Skipping cookie removal for URL:', details.url);
      logger.info('[DRY_RUN]: Skipped cookie removal. Details:', {
        details,
        cookie: state.getResponseHeader('Set-Cookie'),
      });
      this.#reportTrackerInteraction('cookie-detected', state);
    } else {
      // blockSetCookie
      response.modifyResponseHeader('Set-Cookie', '');
      state.incrementStat('set_cookie_blocked');
      state.page.counter += 1;
      this.#reportTrackerInteraction('cookie-removed', state);
    }

    return response.toWebRequestResponse();
  };

  onCompleted = (details) => {
    if (!this.ready) {
      logger.warn('onCompleted skipped (not ready)');
      return;
    }
    this.whitelistedRequestCache.delete(details.requestId);
    const state = WebRequestContext.fromDetails(details, this.pageStore);
    // checkState
    if (checkValidContext(state) === false) {
      return false;
    }
    // logPrivateDocument
    if (state.isMainFrame && state.ip) {
      if (isLocalIP(state.ip)) {
        state.page.isPrivateServer = true;
      }
    }
  };

  onErrorOccurred = (details) => {
    if (!this.ready) {
      logger.warn('onErrorOccurred skipped (not ready)');
      return;
    }
    this.whitelistedRequestCache.delete(details.requestId);
  };

  async dayChanged() {
    const dayTimestamp = datetime.getTime().slice(0, 8);
    const lastDay = (await this.db.get('dayChangedlastRun')) || dayTimestamp;
    await this.db.set('dayChangedlastRun', dayTimestamp);

    if (dayTimestamp !== lastDay) {
      if (this.tokenChecker) {
        this.tokenChecker.tokenDomain.clean();
      }
    }
  }

  isInWhitelist(domain) {
    if (!this.config.cookieWhitelist) return false;
    const keys = this.config.cookieWhitelist;
    for (let i = 0; i < keys.length; i += 1) {
      const ind = domain.indexOf(keys[i]);
      if (ind >= 0) {
        if (ind + keys[i].length === domain.length) return true;
      }
    }
    return false;
  }

  cancelRecentlyModified(state, response) {
    const sourceTab = state.tabId;
    const url = state.url;
    if (this.recentlyModified.has(sourceTab + url)) {
      this.recentlyModified.delete(sourceTab + url);
      response.block();
      return false;
    }
    return true;
  }

  applyBlock(state, response) {
    const badTokens = state.badTokens;

    if (this.debug) {
      console.log(
        'ATTRACK',
        'URL:',
        state.urlParts.hostname,
        state.urlParts.pathname,
        'TOKENS:',
        badTokens,
      );
    }

    let path =
      state.urlParts.pathname + state.urlParts.search + state.urlParts.hash;
    const prefix = state.url.split(path)[0];

    for (const token of badTokens) {
      path = path.replace(token, this.config.placeHolder);
    }

    state.incrementStat(`token_blocked_placeholder`);

    this.recentlyModified.add(state.tabId + state.url, RECENTLY_MODIFIED_TTL);

    response.redirectTo(`${prefix}${path}`);

    if (this.config.sendAntiTrackingHeader) {
      response.modifyHeader(this.config.cliqzHeader, ' ');
    }

    state.page.counter += 1;
    this.#reportTrackerInteraction('fingerprint-removed', state);
    return true;
  }

  checkIsCookieWhitelisted(state) {
    if (this.isInWhitelist(state.urlParts.hostname)) {
      const stage = state.statusCode !== undefined ? 'set_cookie' : 'cookie';
      state.incrementStat(`${stage}_allow_whitelisted`);
      return false;
    }
    return true;
  }

  checkCompatibilityList(state) {
    const tpGd = state.urlParts.generalDomain;
    const fpGd = state.tabUrlParts.generalDomain;
    if (
      this.config.compatibilityList &&
      this.config.compatibilityList[tpGd] &&
      this.config.compatibilityList[tpGd].indexOf(fpGd) !== -1
    ) {
      return false;
    }
    return true;
  }

  checkCookieBlockingMode(state) {
    const mode = this.config.cookieMode;
    if (
      mode === COOKIE_MODE.TRACKERS &&
      !this.qs_whitelist.isTrackerDomain(
        truncatedHash(state.urlParts.generalDomain),
      )
    ) {
      state.incrementStat('cookie_allow_nottracker');
      return false;
    }
    return true;
  }

  clearCache() {
    if (this.tokenExaminer) {
      this.tokenExaminer.clearCache();
    }
    if (this.tokenChecker) {
      this.tokenChecker.tokenDomain.clear();
    }
  }

  shouldCheckToken(tok) {
    return shouldCheckToken(this.hashProb, this.config.shortTokenLength, tok);
  }

  onPageStaged(page) {
    if (page.state === 'complete' && !page.isPrivate && !page.isPrivateServer) {
      const payload = buildPageLoadObject(page);
      if (
        payload.scheme.startsWith('http') &&
        Object.keys(payload.tps).length > 0
      ) {
        this.telemetry({
          action: 'wtm.attrack.tp_events',
          payload: [payload],
        });
      }
    }
  }

  recordClick(event, context, href, sender) {
    if (!this.ready) {
      logger.warn('recordClick skipped (not ready)');
      return;
    }
    this.cookieContext.setContextFromEvent(event, context, href, sender);
    this.oAuthDetector.recordClick(sender);
  }
}

function truncatePath(path) {
  // extract the first part of the page path
  const [prefix] = path.substring(1).split('/');
  return `/${prefix}`;
}

function buildPageLoadObject(page) {
  const urlParts = parse(page.url);
  const tps = { ...page.requestStats };
  return {
    hostname: truncatedHash(urlParts.hostname),
    path: truncatedHash(truncatePath(urlParts.path)),
    scheme: urlParts.scheme,
    c: 1,
    t: Math.round(page.destroyed - page.created),
    active: page.activeTime,
    counter: page.counter,
    ra: 0,
    tps,
    placeHolder: false,
    redirects: [],
    redirectsPlaceHolder: [],
    triggeringTree: {},
    tsv: '',
    tsv_id: false,
    frames: {},
  };
}
