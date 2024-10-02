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
import Pipeline from '../webrequest-pipeline/pipeline.js';
import { isLocalIP } from '../network.js';
import pacemaker from '../utils/pacemaker.js';

import { truncatedHash } from '../md5.js';
import logger from '../logger.js';

import * as datetime from './time.js';
import QSWhitelist2 from './qs-whitelist2.js';
import TempSet from './utils/temp-set.js';
import { HashProb, shouldCheckToken } from './hash.js';
import { VERSION, COOKIE_MODE } from './config.js';
import { shuffle } from './utils.js';
import buildPageLoadObject from './page-telemetry.js';
import getTrackingStatus from './dnt.js';
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

const DAY_CHANGE_INTERVAL = 20 * 1000;
const RECENTLY_MODIFIED_TTL = 30 * 1000;

export default class RequestMonitor {
  constructor(
    settings,
    {
      db,
      webRequestPipeline,
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
    this.webRequestPipeline = webRequestPipeline;
    this.countryProvider = countryProvider;
    this.onTrackerInteraction = onTrackerInteraction;
    this.getBrowserInfo = getBrowserInfo;
    this.isRequestAllowed = isRequestAllowed;
    this.db = db;
    this.VERSION = VERSION;
    this.LOG_KEY = 'attrack';
    this.debug = false;
    this.recentlyModified = new TempSet();
    this.whitelistedRequestCache = new Set();

    // Intervals
    this.dayChangedInterval = null;

    // Web request pipelines
    this.pipelineSteps = {};
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

  async telemetry(message) {
    if (!this.communication) {
      logger.error('No provider provider loaded');
      return;
    }

    message.type = 'wtm.request';
    message.userAgent = (await this.getBrowserInfo()).name;
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
  async init(config) {
    this.config = config;
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

    this.webRequestPipeline.addOnPageStageListener((page) => {
      this.onPageStaged(page);
    });

    await this.initPipeline();
  }

  async initPipeline() {
    this.unloadPipeline();

    // Initialise classes which are used as steps in listeners
    const steps = {
      pageLogger: new PageLogger(this.config),
      blockRules: new BlockRules(this.config),
      cookieContext: new CookieContext(this.config, this.qs_whitelist),
      redirectTagger: new RedirectTagger(),
      oAuthDetector: new OAuthDetector(),
    };
    steps.tokenTelemetry = new TokenTelemetry(
      this.telemetry.bind(this),
      this.qs_whitelist,
      this.config,
      this.db,
      this.shouldCheckToken.bind(this),
      this.config.tokenTelemetry,
      this.trustedClock,
    );

    steps.tokenExaminer = new TokenExaminer(
      this.qs_whitelist,
      this.config,
      this.shouldCheckToken.bind(this),
    );
    steps.tokenChecker = new TokenChecker(
      this.qs_whitelist,
      {},
      this.shouldCheckToken.bind(this),
      this.config,
      this.db,
    );

    this.pipelineSteps = steps;

    // initialise step objects
    for (const key of Object.keys(steps)) {
      const step = steps[key];
      if (step.init) {
        await step.init();
      }
    }

    // ----------------------------------- \\
    // create pipeline for onBeforeRequest \\
    // ----------------------------------- \\
    this.pipelines.onBeforeRequest = new Pipeline(
      'antitracking.onBeforeRequest',
      [
        {
          name: 'checkState',
          spec: 'break',
          fn: checkValidContext,
        },
        {
          name: 'oAuthDetector.checkMainFrames',
          spec: 'break',
          fn: (state) => steps.oAuthDetector.checkMainFrames(state),
        },
        {
          name: 'redirectTagger.checkRedirect',
          spec: 'break',
          fn: (state) => steps.redirectTagger.checkRedirect(state),
        },
        {
          name: 'checkSameGeneralDomain',
          spec: 'break',
          fn: checkSameGeneralDomain,
        },
        {
          name: 'cancelRecentlyModified',
          spec: 'blocking',
          fn: (state, response) => this.cancelRecentlyModified(state, response),
        },
        {
          name: 'pageLogger.onBeforeRequest',
          spec: 'annotate',
          fn: (state) => steps.pageLogger.onBeforeRequest(state),
        },
        {
          name: 'logIsTracker',
          spec: 'collect',
          fn: (state) => {
            if (
              this.qs_whitelist.isTrackerDomain(
                truncatedHash(state.urlParts.generalDomain),
              )
            ) {
              this.onTrackerInteraction('observed', state);
            }
          },
        },
        {
          name: 'checkExternalBlocking',
          spec: 'blocking',
          fn: (state, response) => {
            if (response.cancel === true || response.redirectUrl) {
              state.incrementStat('blocked_external');
              response.shouldIncrementCounter = true;
              return false;
            }
            return true;
          },
        },
        {
          name: 'tokenExaminer.examineTokens',
          spec: 'collect', // TODO - global state
          fn: (state) => steps.tokenExaminer.examineTokens(state),
        },
        {
          name: 'tokenTelemetry.extractKeyTokens',
          spec: 'collect', // TODO - global state
          fn: (state) =>
            !steps.tokenTelemetry ||
            steps.tokenTelemetry.extractKeyTokens(state),
        },
        {
          name: 'tokenChecker.findBadTokens',
          spec: 'annotate',
          fn: (state) => steps.tokenChecker.findBadTokens(state),
        },
        {
          name: 'checkSourceWhitelisted',
          spec: 'break',
          fn: (state) => {
            if (this.checkIsWhitelisted(state)) {
              state.incrementStat('source_whitelisted');
              return false;
            }
            return true;
          },
        },
        {
          name: 'checkShouldBlock',
          spec: 'break',
          fn: (state) =>
            state.badTokens.length > 0 &&
            this.qs_whitelist.isUpToDate() &&
            !this.config.paused,
        },
        {
          name: 'oAuthDetector.checkIsOAuth',
          spec: 'break',
          fn: (state) => steps.oAuthDetector.checkIsOAuth(state, 'token'),
        },
        {
          name: 'isQSEnabled',
          spec: 'break',
          fn: () => this.isQSEnabled(),
        },
        {
          name: 'blockRules.applyBlockRules',
          spec: 'blocking',
          fn: (state, response) =>
            steps.blockRules.applyBlockRules(state, response),
        },
        {
          name: 'logBlockedToken',
          spec: 'collect',
          fn: (state) => {
            this.onTrackerInteraction('fingerprint-removed', state);
          },
        },
        {
          name: 'applyBlock',
          spec: 'blocking',
          fn: (state, response) => this.applyBlock(state, response),
        },
      ],
    );

    // --------------------------------------- \\
    // create pipeline for onBeforeSendHeaders \\
    // --------------------------------------- \\
    this.pipelines.onBeforeSendHeaders = new Pipeline(
      'antitracking.onBeforeSendHeaders',
      [
        {
          name: 'checkState',
          spec: 'break',
          fn: checkValidContext,
        },
        {
          name: 'cookieContext.assignCookieTrust',
          spec: 'collect', // TODO - global state
          fn: (state) => steps.cookieContext.assignCookieTrust(state),
        },
        {
          name: 'redirectTagger.confirmRedirect',
          spec: 'break',
          fn: (state) => steps.redirectTagger.confirmRedirect(state),
        },
        {
          name: 'checkIsMainDocument',
          spec: 'break',
          fn: (state) => !state.isMainFrame,
        },
        {
          name: 'checkSameGeneralDomain',
          spec: 'break',
          fn: checkSameGeneralDomain,
        },
        {
          name: 'pageLogger.onBeforeSendHeaders',
          spec: 'annotate',
          fn: (state) => steps.pageLogger.onBeforeSendHeaders(state),
        },
        {
          name: 'catchMissedOpenListener',
          spec: 'blocking',
          fn: (state, response) => {
            if (
              (state.reqLog && state.reqLog.c === 0) ||
              steps.redirectTagger.isFromRedirect(state.url)
            ) {
              // take output from 'open' pipeline and copy into our response object
              this.pipelines.onBeforeRequest.execute(state, response);
            }
          },
        },
        {
          name: 'overrideUserAgent',
          spec: 'blocking',
          fn: (state, response) => {
            if (this.config.overrideUserAgent === true) {
              const domainHash = truncatedHash(state.urlParts.generalDomain);
              if (this.qs_whitelist.isTrackerDomain(domainHash)) {
                response.modifyHeader('User-Agent', 'CLIQZ');
                state.incrementStat('override_user_agent');
              }
            }
          },
        },
        {
          name: 'checkHasCookie',
          spec: 'break',
          // hasCookie flag is set by pageLogger.onBeforeSendHeaders
          fn: (state) => state.hasCookie === true,
        },
        {
          name: 'checkIsCookieWhitelisted',
          spec: 'break',
          fn: (state) => this.checkIsCookieWhitelisted(state),
        },
        {
          name: 'checkCompatibilityList',
          spec: 'break',
          fn: (state) => this.checkCompatibilityList(state),
        },
        {
          name: 'checkCookieBlockingMode',
          spec: 'break',
          fn: (state) => this.checkCookieBlockingMode(state),
        },
        {
          name: 'cookieContext.checkCookieTrust',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkCookieTrust(state),
        },
        {
          name: 'cookieContext.checkVisitCache',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkVisitCache(state),
        },
        {
          name: 'cookieContext.checkContextFromEvent',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkContextFromEvent(state),
        },
        {
          name: 'oAuthDetector.checkIsOAuth',
          spec: 'break',
          fn: (state) => steps.oAuthDetector.checkIsOAuth(state, 'cookie'),
        },
        {
          name: 'shouldBlockCookie',
          spec: 'break',
          fn: (state) => {
            const shouldBlock =
              !this.checkIsWhitelisted(state) &&
              this.isCookieEnabled(state) &&
              !this.config.paused;
            if (!shouldBlock) {
              state.incrementStat('bad_cookie_sent');
            }
            return shouldBlock;
          },
        },
        {
          name: 'logBlockedCookie',
          spec: 'collect',
          fn: (state) => {
            this.onTrackerInteraction('cookie-removed', state);
          },
        },
        {
          name: 'blockCookie',
          spec: 'blocking',
          fn: (state, response) => {
            state.incrementStat('cookie_blocked');
            state.incrementStat('cookie_block_tp1');
            response.modifyHeader('Cookie', '');
            if (this.config.sendAntiTrackingHeader) {
              response.modifyHeader(this.config.cliqzHeader, ' ');
            }
            state.page.counter += 1;
          },
        },
      ],
    );

    // ------------------------------------- \\
    // create pipeline for onHeadersReceived \\
    // ------------------------------------- \\
    this.pipelines.onHeadersReceived = new Pipeline(
      'antitracking.onHeadersReceived',
      [
        {
          name: 'checkState',
          spec: 'break',
          fn: checkValidContext,
        },
        {
          name: 'checkMainDocumentRedirects',
          spec: 'break',
          fn: (state) => {
            if (state.isMainFrame) {
              // check for tracking status headers for first party
              const trackingStatus = getTrackingStatus(state);
              if (trackingStatus) {
                state.page.tsv = trackingStatus.value;
                state.page.tsvId = trackingStatus.statusId;
              }
              return false;
            }
            return true;
          },
        },
        {
          name: 'checkSameGeneralDomain',
          spec: 'break',
          fn: checkSameGeneralDomain,
        },
        {
          name: 'redirectTagger.checkRedirectStatus',
          spec: 'break',
          fn: (state) => steps.redirectTagger.checkRedirectStatus(state),
        },
        {
          name: 'pageLogger.onHeadersReceived',
          spec: 'annotate',
          fn: (state) => steps.pageLogger.onHeadersReceived(state),
        },
        {
          name: 'logResponseStats',
          spec: 'collect',
          fn: (state) => {
            if (state.incrementStat) {
              // TSV stats
              if (
                this.qs_whitelist.isTrackerDomain(
                  truncatedHash(state.urlParts.generalDomain),
                )
              ) {
                const trackingStatus = getTrackingStatus(state);
                if (trackingStatus) {
                  state.incrementStat(`tsv_${trackingStatus.value}`);
                  if (trackingStatus.statusId) {
                    state.incrementStat('tsv_status');
                  }
                }
              }
            }
          },
        },
        {
          name: 'checkSetCookie',
          spec: 'break',
          fn: (state) => state.hasSetCookie === true,
        },
        {
          name: 'shouldBlockCookie',
          spec: 'break',
          fn: (state) =>
            !this.checkIsWhitelisted(state) && this.isCookieEnabled(state),
        },
        {
          name: 'checkIsCookieWhitelisted',
          spec: 'break',
          fn: (state) => this.checkIsCookieWhitelisted(state),
        },
        {
          name: 'checkCompatibilityList',
          spec: 'break',
          fn: (state) => this.checkCompatibilityList(state),
        },
        {
          name: 'checkCookieBlockingMode',
          spec: 'break',
          fn: (state) => this.checkCookieBlockingMode(state),
        },
        {
          name: 'cookieContext.checkCookieTrust',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkCookieTrust(state),
        },
        {
          name: 'cookieContext.checkVisitCache',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkVisitCache(state),
        },
        {
          name: 'cookieContext.checkContextFromEvent',
          spec: 'break',
          fn: (state) => steps.cookieContext.checkContextFromEvent(state),
        },
        {
          name: 'logSetBlockedCookie',
          spec: 'collect',
          fn: (state) => {
            this.onTrackerInteraction('cookie-removed', state);
          },
        },
        {
          name: 'blockSetCookie',
          spec: 'blocking',
          fn: (state, response) => {
            response.modifyResponseHeader('Set-Cookie', '');
            state.incrementStat('set_cookie_blocked');
            state.page.counter += 1;
          },
        },
      ],
    );

    this.pipelines.onCompleted = new Pipeline('antitracking.onCompleted', [
      {
        name: 'checkState',
        spec: 'break',
        fn: checkValidContext,
      },
      {
        name: 'logPrivateDocument',
        spec: 'break',
        fn: (state) => {
          if (state.isMainFrame && state.ip) {
            if (isLocalIP(state.ip)) {
              state.page.isPrivateServer = true;
            }
            return false;
          }
          return true;
        },
      },
      {
        name: 'pageLogger.reattachStatCounter',
        spec: 'annotate',
        fn: (state) => steps.pageLogger.reattachStatCounter(state),
      },
      {
        name: 'logIsCached',
        spec: 'collect',
        fn: (state) => {
          this.whitelistedRequestCache.delete(state.requestId);
          state.incrementStat(state.fromCache ? 'cached' : 'not_cached');
        },
      },
    ]);

    this.pipelines.onErrorOccurred = new Pipeline('antitracking.onError', [
      {
        name: 'checkState',
        spec: 'break',
        fn: checkValidContext,
      },
      {
        name: 'pageLogger.reattachStatCounter',
        spec: 'annotate',
        fn: (state) => steps.pageLogger.reattachStatCounter(state),
      },
      {
        name: 'logError',
        spec: 'collect',
        fn: (state) => {
          this.whitelistedRequestCache.delete(state.requestId);
          if (state.error && state.error.indexOf('ABORT')) {
            state.incrementStat('error_abort');
          }
        },
      },
    ]);

    Object.keys(this.pipelines).map((stage) =>
      this.webRequestPipeline.addPipelineStep(stage, {
        name: `antitracking.${stage}`,
        spec: 'blocking',
        fn: (...args) => this.pipelines[stage].execute(...args),
      }),
    );
  }

  unloadPipeline() {
    Object.keys(this.pipelineSteps || {}).forEach((key) => {
      const step = this.pipelineSteps[key];
      if (step.unload) {
        step.unload();
      }
    });

    Object.keys(this.pipelines).forEach((stage) => {
      this.pipelines[stage].unload();
    });

    Object.keys(this.pipelines).map((stage) =>
      this.webRequestPipeline.removePipelineStep(
        stage,
        `antitracking.${stage}`,
      ),
    );
    this.pipelines = {};
  }

  unload() {
    // Check is active usage, was sent
    this.qs_whitelist.destroy();
    this.unloadPipeline();
    this.db.unload();
    this.dayChangedInterval = this.dayChangedInterval.stop();
  }

  async dayChanged() {
    const dayTimestamp = datetime.getTime().slice(0, 8);
    const lastDay = (await this.db.get('dayChangedlastRun')) || dayTimestamp;
    await this.db.set('dayChangedlastRun', dayTimestamp);

    if (dayTimestamp !== lastDay) {
      if (this.pipelineSteps.tokenChecker) {
        this.pipelineSteps.tokenChecker.tokenDomain.clean();
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

    // TODO: do this nicer
    // if (this.pipelineSteps.trackerProxy && this.pipelineSteps.trackerProxy.shouldProxy(tmpUrl)) {
    //     state.incrementStat('proxy');
    // }
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
    if (this.pipelineSteps.tokenExaminer) {
      this.pipelineSteps.tokenExaminer.clearCache();
    }
    if (this.pipelineSteps.tokenChecker) {
      this.pipelineSteps.tokenChecker.tokenDomain.clear();
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
}
