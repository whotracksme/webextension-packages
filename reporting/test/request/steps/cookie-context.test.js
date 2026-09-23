/**
 * WhoTracks.Me
 * https://ghostery.com/whotracksme
 *
 * Copyright 2017-present Ghostery GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0
 */

import chrome from 'sinon-chrome';
import { expect } from 'chai';

import CookieContext from '../../../src/request/steps/cookie-context.js';
import { parse } from '../../../src/utils/url.js';

function mockState({
  tabId = 1,
  url = 'https://tracker.test/pixel.gif',
  tabUrl = 'https://source.test/page',
  isMainFrame = false,
  statusCode,
  referrer,
} = {}) {
  const stats = {};
  return {
    tabId,
    url,
    urlParts: parse(url),
    tabUrl,
    tabUrlParts: parse(tabUrl),
    isMainFrame,
    statusCode,
    stats,
    incrementStat(key) {
      stats[key] = (stats[key] || 0) + 1;
    },
    getReferrer() {
      return referrer;
    },
  };
}

describe('CookieContext', function () {
  let cookieContext;
  let qsWhitelist;

  before(function () {
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(async function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
    qsWhitelist = {
      isTrackerDomain: () => false,
    };
    cookieContext = new CookieContext({}, qsWhitelist);
    await cookieContext.init();
  });

  afterEach(function () {
    cookieContext.unload();
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
  });

  describe('checkVisitCache', function () {
    it('returns true when the visit cache is empty', function () {
      const state = mockState();
      expect(cookieContext.checkVisitCache(state)).to.equal(true);
    });

    it('returns false when the third-party domain has a recent visit-cache entry for this tab', function () {
      const state = mockState({
        tabId: 7,
        url: 'https://tracker.test/pixel.gif',
        tabUrl: 'https://source.test/page',
      });
      cookieContext.visitCache.set(
        `${state.tabId}:${state.urlParts.generalDomain}`,
        Date.now(),
      );
      expect(cookieContext.checkVisitCache(state)).to.equal(false);
      expect(state.stats.cookie_allow_visitcache).to.equal(1);
    });

    it('uses the set_cookie stat prefix when statusCode is set', function () {
      const state = mockState({
        tabId: 7,
        statusCode: 200,
      });
      cookieContext.visitCache.set(
        `${state.tabId}:${state.urlParts.generalDomain}`,
        Date.now(),
      );
      expect(cookieContext.checkVisitCache(state)).to.equal(false);
      expect(state.stats.set_cookie_allow_visitcache).to.equal(1);
    });

    it('returns true when the cached entry is older than TIME_ACTIVE (20s)', function () {
      const state = mockState({ tabId: 7 });
      cookieContext.visitCache.set(
        `${state.tabId}:${state.urlParts.generalDomain}`,
        Date.now() - 21 * 1000,
      );
      expect(cookieContext.checkVisitCache(state)).to.equal(true);
    });

    it('returns true when the cache entry belongs to a different tab', function () {
      const state = mockState({ tabId: 7 });
      cookieContext.visitCache.set(
        `99:${state.urlParts.generalDomain}`,
        Date.now(),
      );
      expect(cookieContext.checkVisitCache(state)).to.equal(true);
    });
  });

  describe('checkCookieTrust', function () {
    it('returns true when the trust map is empty', function () {
      const state = mockState();
      expect(cookieContext.checkCookieTrust(state)).to.equal(true);
    });

    it('returns false when the (sourceHost:requestHost) pair is in the trust map', function () {
      const state = mockState({
        url: 'https://tracker.test/x',
        tabUrl: 'https://source.test/page',
      });
      const key = `${state.tabUrlParts.hostname}:${state.urlParts.hostname}`;
      cookieContext.trustedThirdParties.set(key, { c: 0, ts: Date.now() });

      expect(cookieContext.checkCookieTrust(state)).to.equal(false);
      expect(state.stats.cookie_allow_trust).to.equal(1);
    });

    it('uses the set_cookie stat prefix when statusCode is set', function () {
      const state = mockState({ statusCode: 200 });
      const key = `${state.tabUrlParts.hostname}:${state.urlParts.hostname}`;
      cookieContext.trustedThirdParties.set(key, { c: 0, ts: Date.now() });

      expect(cookieContext.checkCookieTrust(state)).to.equal(false);
      expect(state.stats.set_cookie_allow_trust).to.equal(1);
    });

    it('increments the trust counter and refreshes the timestamp on each match', function () {
      const state = mockState();
      const key = `${state.tabUrlParts.hostname}:${state.urlParts.hostname}`;
      const before = Date.now() - 10_000;
      cookieContext.trustedThirdParties.set(key, { c: 0, ts: before });

      cookieContext.checkCookieTrust(state);
      cookieContext.checkCookieTrust(state);

      const counter = cookieContext.trustedThirdParties.get(key);
      expect(counter.c).to.equal(2);
      expect(counter.ts).to.be.greaterThan(before);
    });
  });

  describe('assignCookieTrust → checkCookieTrust integration', function () {
    it('a referrer-driven main-frame request makes subsequent third-party requests trusted', function () {
      qsWhitelist.isTrackerDomain = () => false;
      const mainFrameState = mockState({
        tabId: 7,
        url: 'https://tracker.test/landing',
        tabUrl: 'https://source.test/page',
        isMainFrame: true,
        referrer: 'https://source.test/page',
      });

      cookieContext.assignCookieTrust(mainFrameState);

      const subRequestState = mockState({
        tabId: 7,
        url: 'https://tracker.test/cookie-pixel',
        tabUrl: 'https://source.test/page',
      });
      expect(cookieContext.checkCookieTrust(subRequestState)).to.equal(false);
      expect(subRequestState.stats.cookie_allow_trust).to.equal(1);
    });
  });
});
