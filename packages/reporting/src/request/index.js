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
import Pipeline from './webrequest-pipeline/pipeline';
import { isPrivateIP, getName } from './utils/url';
import pacemaker from './utils/pacemaker';
import TrackerCounter from './utils/tracker-counter';

import { truncatedHash } from '../md5';
import logger from '../logger';

import * as datetime from './time';
import QSWhitelist2 from './qs-whitelist2';
import TempSet from './temp-set';
import { HashProb, shouldCheckToken } from './hash';
import { VERSION, COOKIE_MODE } from './config';
import { shuffle } from './utils';
import buildPageLoadObject from './page-telemetry';
import getTrackingStatus from './dnt';
import random from '../random';

import BlockRules from './steps/block-rules';
import CookieContext from './steps/cookie-context';
import PageLogger from './steps/page-logger';
import RedirectTagger from './steps/redirect-tagger';
import TokenChecker from './steps/token-checker';
import TokenExaminer from './steps/token-examiner';
import TokenTelemetry from './steps/token-telemetry';
import OAuthDetector from './steps/oauth-detector';

import {
  checkValidContext,
  checkSameGeneralDomain,
} from './steps/check-context';

export default class RequestMonitor {
  constructor(
    settings,
    { db, webRequestPipeline, trustedClock, countryProvider, communication },
  ) {
    this.settings = settings;
    this.communication = communication;
    this.trustedClock = trustedClock;
    this.webRequestPipeline = webRequestPipeline;
    this.countryProvider = countryProvider;
    this.db = db;
    this.VERSION = VERSION;
    this.LOG_KEY = 'attrack';
    this.debug = false;
    this.msgType = 'attrack';
    this.recentlyModified = new TempSet();

    // Intervals
    this.dayChangedInterval = null;

    // Web request pipelines
    this.pipelineSteps = {};
    this.pipelines = {};

    this.ghosteryDomains = {};
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
    message.platform = this.settings.platform;
    message.userAgent = this.settings.userAgent;
    message.ts = this.trustedClock.getTimeAsYYYYMMDD();
    message['anti-duplicates'] = Math.floor(random() * 10000000);

    message.payload.ver = VERSION;
    message.payload.day = this.qs_whitelist.getVersion().day;
    message.payload.ts = this.trustedClock.getTimeAsYYYYMMDDHH();
    message.payload.ctry = this.countryProvider.getSafeCountryCode();

    this.communication.send(message);
  }

  /** Global module initialisation.
   */
  async init(config) {
    this.config = config;

    this.hashProb = new HashProb();
    this.hashProb.init();

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
      timeout: 20 * 1000,
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
      oauthDetector: new OAuthDetector(),
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
          name: 'oauthDetector.checkMainFrames',
          spec: 'break',
          fn: (state) => steps.oauthDetector.checkMainFrames(state),
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
              const annotations = state.getPageAnnotations();
              annotations.counter = annotations.counter || new TrackerCounter();
              annotations.counter.addTrackerSeen(
                state.ghosteryBug,
                state.urlParts.hostname,
              );
            }
            if (
              state.ghosteryBug &&
              this.config.cookieMode === COOKIE_MODE.GHOSTERY
            ) {
              // track domains used by ghostery rules so that we only block cookies for these
              // domains
              this.ghosteryDomains[state.urlParts.generalDomain] =
                state.ghosteryBug;
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
          name: 'oauthDetector.checkIsOAuth',
          spec: 'break',
          fn: (state) => steps.oauthDetector.checkIsOAuth(state, 'token'),
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
            const annotations = state.getPageAnnotations();
            annotations.counter = annotations.counter || new TrackerCounter();
            annotations.counter.addTokenRemoved(
              state.ghosteryBug,
              state.urlParts.hostname,
            );
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
          name: 'oauthDetector.checkIsOAuth',
          spec: 'break',
          fn: (state) => steps.oauthDetector.checkIsOAuth(state, 'cookie'),
        },
        {
          name: 'shouldBlockCookie',
          spec: 'break',
          fn: (state) => {
            const shouldBlock =
              this.isCookieEnabled(state) && !this.config.paused;
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
            const annotations = state.getPageAnnotations();
            annotations.counter = annotations.counter || new TrackerCounter();
            annotations.counter.addCookieBlocked(
              state.ghosteryBug,
              state.urlParts.hostname,
            );
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
                state.page.setTrackingStatus(trackingStatus);
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
          fn: (state) => this.isCookieEnabled(state),
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
            const annotations = state.getPageAnnotations();
            annotations.counter = annotations.counter || new TrackerCounter();
            annotations.counter.addCookieBlocked(
              state.ghosteryBug,
              state.urlParts.hostname,
            );
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
            if (isPrivateIP(state.ip)) {
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
    this.hashProb.unload();
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
    if (this.recentlyModified.contains(sourceTab + url)) {
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
    this.recentlyModified.add(state.tabId + state.url, 30000);

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
      this.config.compabilityList &&
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
    if (
      mode === COOKIE_MODE.GHOSTERY &&
      !this.ghosteryDomains[state.urlParts.generalDomain] &&
      getName(state.urlParts) !== 'google'
    ) {
      // in Ghostery mode: if the domain did not match a ghostery bug we allow it. One exception
      // are third-party google.tld cookies, which we do not allow with this mechanism.
      state.incrementStat('cookie_allow_ghostery');
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
          action: 'attrack.tp_events',
          payload,
        });
      }
    }
  }
}
