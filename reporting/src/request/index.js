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
import pacemaker from '../utils/pacemaker.js';
import Config from './config.js';
import Database from './database.js';

import { truncatedHash } from '../md5.js';
import logger from '../logger.js';

import { BlockingResponse, WebRequestContext } from './utils/webrequest.js';
import * as datetime from './time.js';
import QSWhitelist2 from './qs-whitelist2.js';
import TempSet from './utils/temp-set.js';
import { HashProb, shouldCheckToken } from './hash.js';
import { VERSION, COOKIE_MODE } from './config.js';
import { shuffle } from './utils.js';
import buildPageLoadObject from './page-telemetry.js';
import random from '../random.js';

import BlockRules from './steps/block-rules.js';
import CookieContext from './steps/cookie-context.js';
import PageLogger from './steps/page-logger.js';
import RedirectTagger from './steps/redirect-tagger.js';
import TokenChecker from './steps/token-checker/index.js';
import TokenExaminer from './steps/token-examiner.js';
import TokenTelemetry from './steps/token-telemetry/index.js';
import OAuthDetector from './steps/oauth-detector.js';
import {
  checkValidContext,
  checkSameGeneralDomain,
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
    },
  ) {
    this.settings = settings;
    this.communication = communication;
    this.trustedClock = trustedClock;
    this.countryProvider = countryProvider;
    this.onTrackerInteraction = onTrackerInteraction;
    this.getBrowserInfo = getBrowserInfo;
    this.isRequestAllowed = isRequestAllowed;
    this.VERSION = VERSION;
    this.LOG_KEY = 'attrack';
    this.debug = false;
    this.recentlyModified = new TempSet();
    this.whitelistedRequestCache = new Set();
    this.pageStore = new PageStore({
      notifyPageStageListeners: this.onPageStaged.bind(this),
    });

    // Intervals
    this.dayChangedInterval = null;

    // Web request pipelines
    this.pipelines = {};
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

  obfuscate(s, method) {
    // used when action != 'block'
    // default is a placeholder
    switch (method) {
      case 'empty':
        return '';
      case 'replace':
        return shuffle(s);
      case 'same':
        return s;
      case 'placeholder':
        return this.config.placeHolder;
      default:
        return this.config.placeHolder;
    }
  }

  getDefaultRule() {
    if (this.isForceBlockEnabled()) {
      return 'block';
    }

    return 'placeholder';
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

  isForceBlockEnabled() {
    return this.config.forceBlockEnabled;
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
    this.qs_whitelist.init();

    this.dayChangedInterval = pacemaker.register(this.dayChanged.bind(this), {
      timeout: DAY_CHANGE_INTERVAL,
    });

    await this.pageStore.init();

    this.userAgent = (await this.getBrowserInfo()).name;

    this.pageLogger = new PageLogger(this.config);
    this.blockRules = new BlockRules(this.config);
    this.redirectTagger = new RedirectTagger();
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

    const urls = ['http://*/*', 'https://*/*'];
    const blockingWebRequest = await chrome.permissions.contains({
      permissions: ['webRequestBlocking'],
    });

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

  unload() {
    // Check is active usage, was sent
    this.qs_whitelist.destroy();
    this.cookieContext.unload();
    this.oAuthDetector.unload();
    this.tokenTelemetry.unload();
    this.tokenExaminer.unload();
    this.tokenChecker.unload();

    chrome.webRequest.onBeforeRequest.removeListener(this.onBeforeRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(
      this.onBeforeSendHeaders,
    );
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeadersReceived);
    chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(this.onErrorOccurred);

    this.db.unload();
    this.dayChangedInterval = this.dayChangedInterval.stop();
  }

  onBeforeRequest = (details) => {
    const state = WebRequestContext.fromDetails(
      details,
      this.pageStore,
      'onBeforeRequest',
    );
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
    // pageLogger.onBeforeRequest
    if (this.pageLogger.onBeforeRequest(state) === false) {
      return response.toWebRequestResponse();
    }
    // logIsTracker
    setTimeout(() => {
      if (
        this.qs_whitelist.isTrackerDomain(
          truncatedHash(state.urlParts.generalDomain),
        )
      ) {
        this.onTrackerInteraction('observed', state);
      }
    }, 1);
    // checkExternalBlocking
    if (response.cancel === true || response.redirectUrl) {
      state.incrementStat('blocked_external');
      response.shouldIncrementCounter = true;
      return response.toWebRequestResponse();
    }
    // tokenExaminer.examineTokens
    if (this.tokenExaminer.examineTokens(state) === false) {
      return response.toWebRequestResponse();
    }
    // tokenTelemetry.extractKeyTokens
    setTimeout(() => {
      this.tokenTelemetry.extractKeyTokens(state);
    }, 1);
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
      (state.badTokens.length > 0 &&
        this.qs_whitelist.isUpToDate() &&
        !this.config.paused) === false
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
    // blockRules.applyBlockRules
    if (this.blockRules.applyBlockRules(state, response) === false) {
      return response.toWebRequestResponse();
    }
    // logBlockedToken
    setTimeout(() => {
      this.onTrackerInteraction('fingerprint-removed', state);
    }, 1);
    // applyBlock
    if (this.applyBlock(state, response) === false) {
      return response.toWebRequestResponse();
    }
    return response.toWebRequestResponse();
  };

  onBeforeSendHeaders = (details) => {
    const state = WebRequestContext.fromDetails(
      details,
      this.pageStore,
      'onBeforeSendHeaders',
    );
    const response = new BlockingResponse(details, 'onBeforeSendHeaders');
    // checkState
    if (checkValidContext(state) === false) {
      return response.toWebRequestResponse();
    }
    // cookieContext.assignCookieTrust
    setTimeout(() => {
      this.cookieContext.assignCookieTrust(state);
    }, 1);
    // checkIsMainDocument
    if (!state.isMainFrame === false) {
      return response.toWebRequestResponse();
    }
    // checkSameGeneralDomain
    if (checkSameGeneralDomain(state) === false) {
      return response.toWebRequestResponse();
    }
    // pageLogger.onBeforeSendHeaders
    if (this.pageLogger.onBeforeSendHeaders(state) === false) {
      return response.toWebRequestResponse();
    }
    // catchMissedOpenListener
    if (
      (state.reqLog && state.reqLog.c === 0) ||
      this.redirectTagger.isFromRedirect(state.url)
    ) {
      // take output from 'open' pipeline and copy into our response object
      this.onBeforeRequest(state, response);
    }
    // overrideUserAgent
    if (this.config.overrideUserAgent === true) {
      const domainHash = truncatedHash(state.urlParts.generalDomain);
      if (this.qs_whitelist.isTrackerDomain(domainHash)) {
        response.modifyHeader('User-Agent', 'CLIQZ');
        state.incrementStat('override_user_agent');
      }
    }
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
      (!this.checkIsWhitelisted(state) &&
        this.isCookieEnabled(state) &&
        !this.config.paused) === false
    ) {
      state.incrementStat('bad_cookie_sent');
      return response.toWebRequestResponse();
    }
    // logBlockedCookie
    setTimeout(() => {
      this.onTrackerInteraction('cookie-removed', state);
    }, 1);
    // blockCookie
    state.incrementStat('cookie_blocked');
    state.incrementStat('cookie_block_tp1');
    response.modifyHeader('Cookie', '');
    if (this.config.sendAntiTrackingHeader) {
      response.modifyHeader(this.config.cliqzHeader, ' ');
    }
    state.page.counter += 1;
    return response.toWebRequestResponse();
  };

  onHeadersReceived = (details) => {
    const state = WebRequestContext.fromDetails(
      details,
      this.pageStore,
      'onHeadersReceived',
    );
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
    // redirectTagger.checkRedirectStatus
    if (this.redirectTagger.checkRedirectStatus(state) === false) {
      return response.toWebRequestResponse();
    }
    // pageLogger.onHeadersReceived
    if (this.pageLogger.onHeadersReceived(state) === false) {
      return response.toWebRequestResponse();
    }
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
    // logSetBlockedCookie
    setTimeout(() => {
      this.onTrackerInteraction('cookie-removed', state);
    }, 1);
    // blockSetCookie
    response.modifyResponseHeader('Set-Cookie', '');
    state.incrementStat('set_cookie_blocked');
    state.page.counter += 1;
    return response.toWebRequestResponse();
  };

  onCompleted = (details) => {
    const state = WebRequestContext.fromDetails(
      details,
      this.pageStore,
      'onCompleted',
    );
    // checkState
    if (checkValidContext(state) === false) {
      return false;
    }
    // logPrivateDocument
    if (state.isMainFrame && state.ip) {
      if (isLocalIP(state.ip)) {
        state.page.isPrivateServer = true;
      }
      return false;
    }
    // pageLogger.reattachStatCounter
    if (this.pageLogger.reattachStatCounter(state) === false) {
      return false;
    }
    // logIsCached
    setTimeout(() => {
      this.whitelistedRequestCache.delete(state.requestId);
      state.incrementStat(state.fromCache ? 'cached' : 'not_cached');
    }, 1);
  };

  onErrorOccurred = (details) => {
    const state = WebRequestContext.fromDetails(
      details,
      this.pageStore,
      'onErrorOccurred',
    );
    // checkState
    if (checkValidContext(state) === false) {
      return false;
    }
    // pageLogger.reattachStatCounte
    if (this.pageLogger.reattachStatCounter(state) === false) {
      return false;
    }
    // logError
    setTimeout(() => {
      this.whitelistedRequestCache.delete(state.requestId);
      if (state.error && state.error.indexOf('ABORT')) {
        state.incrementStat('error_abort');
      }
    }, 1);
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

  applyBlock(state, _response) {
    const response = _response;
    const badTokens = state.badTokens;
    const rule = this.getDefaultRule();

    if (this.debug) {
      console.log(
        'ATTRACK',
        rule,
        'URL:',
        state.urlParts.hostname,
        state.urlParts.pathname,
        'TOKENS:',
        badTokens,
      );
    }

    if (rule === 'block') {
      state.incrementStat(`token_blocked_${rule}`);
      response.block();
      response.shouldIncrementCounter = true;
      return false;
    }

    let tmpUrl = state.url;
    for (let i = 0; i < badTokens.length; i += 1) {
      tmpUrl = tmpUrl.replace(badTokens[i], this.obfuscate(badTokens[i], rule));
    }
    // In case unsafe tokens were in the hostname, the URI is not valid
    // anymore and we can cancel the request.
    if (!tmpUrl.startsWith(state.urlParts.origin)) {
      response.block();
      return false;
    }

    state.incrementStat(`token_blocked_${rule}`);

    this.recentlyModified.add(state.tabId + state.url, RECENTLY_MODIFIED_TTL);

    response.redirectTo(tmpUrl);
    response.modifyHeader(this.config.cliqzHeader, ' ');

    state.page.counter += 1;
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
    this.cookieContext.setContextFromEvent(event, context, href, sender);
    this.oAuthDetector.recordClick(event, context, href, sender);
  }
}
