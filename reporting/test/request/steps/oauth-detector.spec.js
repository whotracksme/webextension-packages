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

import * as chai from 'chai';

import OAuthDetector from '../../../src/request/steps/oauth-detector.js';
import { parse } from '../../../src/utils/url.js';
// import FakeSessionApi from '../../helpers/fake-session-storage.js'; // TODO: see comments below

function mockSender(tab, url) {
  return {
    tab: {
      id: tab,
      url: url,
    },
  };
}

function delayedTest(test, done, delay) {
  setTimeout(() => {
    try {
      test();
      done();
    } catch (e) {
      done(e);
    }
  }, delay);
}

describe('request/steps/oauth-detector', function () {
  let monkeyPatchedChromeStorage;
  let oldChromeStorageSession;
  let oldChromeStorage;

  beforeEach(() => {
    if (!chrome?.storage?.session) {
      monkeyPatchedChromeStorage = true;
      oldChromeStorage = chrome?.storage;
      oldChromeStorageSession = chrome?.storage?.session;
      chrome.storage = chrome.storage || {};

      // Note: monkey patching with a real implementation fails.
      // Thus, leaving the old way to monkey patch, even though it may
      // indicate that there are bugs in the implementation or in the tests.
      chrome.storage.session = chrome.storage.local;
      chrome.storage.session.get.yields({});

      // to test against a real (promised-based) in-memory implementation:
      // chrome.storage.session = new FakeSessionApi();
    }
  });

  afterEach(() => {
    if (monkeyPatchedChromeStorage) {
      chrome.storage.session = oldChromeStorageSession;
      chrome.storage = oldChromeStorage;
    }
  });

  describe('click tracking', () => {
    let detectorInstance;
    const CLICK_TIMEOUT = 20;

    beforeEach(async function () {
      detectorInstance = new OAuthDetector({ CLICK_TIMEOUT });
      await detectorInstance.init();
    });

    afterEach(function () {
      detectorInstance.unload();
    });

    it('registers clicks on tabs', (done) => {
      const tab = 5;
      const url = 'https://cliqz.com';
      const sender = mockSender(tab, url);
      detectorInstance.recordClick(null, '', '', sender);
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({
              [tab]: url,
            });
        },
        done,
        1,
      );
    });

    it('clicks in same tab overwrite', (done) => {
      const tab = 5;
      const url1 = 'https://cliqz.com';
      const url2 = 'https://ghostery.com';
      detectorInstance.recordClick(null, '', '', mockSender(tab, url1));
      detectorInstance.recordClick(null, '', '', mockSender(tab, url2));
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({
              [tab]: url2,
            });
        },
        done,
        5,
      );
    });

    it('clicks different tabs', (done) => {
      const tab1 = 5;
      const tab2 = 6;
      const url1 = 'https://cliqz.com';
      const url2 = 'https://ghostery.com';
      detectorInstance.recordClick(null, '', '', mockSender(tab1, url1));
      detectorInstance.recordClick(null, '', '', mockSender(tab2, url2));
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({
              [tab1]: url1,
              [tab2]: url2,
            });
        },
        done,
        5,
      );
    });

    it('clicks timeout', (done) => {
      const tab = 5;
      const url = 'https://cliqz.com';
      const sender = mockSender(tab, url);
      detectorInstance.recordClick(null, '', '', sender);
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({});
        },
        done,
        CLICK_TIMEOUT + 5,
      );
    });

    it('click timeout does not remove others', (done) => {
      const tab1 = 5;
      const tab2 = 6;
      const url1 = 'https://cliqz.com';
      const url2 = 'https://ghostery.com';
      detectorInstance.recordClick(null, '', '', mockSender(tab1, url1));
      setTimeout(
        () =>
          detectorInstance.recordClick(null, '', '', mockSender(tab2, url2)),
        10,
      );
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({
              [tab2]: url2,
            });
        },
        done,
        CLICK_TIMEOUT + 5,
      );
    });

    it('subsequent click refreshes timeout', (done) => {
      const tab1 = 5;
      const tab2 = 6;
      const url1 = 'https://cliqz.com';
      const url2 = 'https://ghostery.com';
      detectorInstance.recordClick(null, '', '', mockSender(tab1, url1));
      detectorInstance.recordClick(null, '', '', mockSender(tab2, url2));
      setTimeout(
        () =>
          detectorInstance.recordClick(null, '', '', mockSender(tab1, url1)),
        10,
      );
      delayedTest(
        () => {
          chai
            .expect(
              Object.fromEntries(detectorInstance.clickActivity.entries()),
            )
            .to.eql({
              [tab1]: url1,
            });
        },
        done,
        CLICK_TIMEOUT + 5,
      );
    });
  });

  describe('checkIsOAuth', () => {
    let detectorInstance;

    function mockState(tabId, url, tabUrl, fullPage = false) {
      return {
        tabId,
        url,
        urlParts: parse(url),
        tabUrlParts: parse(tabUrl),
        isMainFrame: fullPage,
        incrementStat: () => null,
      };
    }

    beforeEach(async function () {
      detectorInstance = new OAuthDetector({
        CLICK_TIMEOUT: 10,
        VISIT_TIMEOUT: 8,
      });
      await detectorInstance.init();
    });

    afterEach(function () {
      detectorInstance.unload();
    });

    it('returns true when there has been no activity and the URL contains "/oauth"', () => {
      const state = mockState(
        5,
        'https://auth.ghostery.com/oauth',
        'https://cliqz.com/',
      );
      chai.expect(detectorInstance.checkIsOAuth(state)).to.be.true;
    });

    it('returns true when there has been no activity and the URL contains "/authorize"', () => {
      const state = mockState(
        5,
        'https://auth.ghostery.com/authorize',
        'https://cliqz.com/',
      );
      chai.expect(detectorInstance.checkIsOAuth(state)).to.be.true;
    });

    it('returns true when there is only a click', (done) => {
      const tab = 5;
      const tabUrl = 'https://cliqz.com/';
      detectorInstance.recordClick(null, '', '', mockSender(tab, tabUrl));
      const state = mockState(tab, 'https://auth.ghostery.com/oauth', tabUrl);
      delayedTest(
        () => {
          chai.expect(detectorInstance.checkIsOAuth(state)).to.be.true;
        },
        done,
        5,
      );
    });

    it('returns false with click and page', (done) => {
      const tab = 5;
      const tabUrl = 'https://cliqz.com/';
      detectorInstance.recordClick(null, '', '', mockSender(tab, tabUrl));
      const fullPageState = mockState(
        tab + 1,
        'https://auth.ghostery.com/',
        '',
        true,
      );
      const state = mockState(tab, 'https://auth.ghostery.com/oauth', tabUrl);
      setTimeout(() => detectorInstance.checkMainFrames(fullPageState), 2);
      delayedTest(
        () => {
          chai.expect(detectorInstance.checkIsOAuth(state)).to.be.false;
        },
        done,
        5,
      );
    });

    it('returns true if page domain does not match', (done) => {
      const tab = 5;
      const tabUrl = 'https://cliqz.com/';
      detectorInstance.recordClick(null, '', '', mockSender(tab, tabUrl));
      const fullPageState = mockState(
        tab + 1,
        'https://www.ghostery.com/',
        '',
        true,
      );
      const state = mockState(tab, 'https://auth.ghostery.com/oauth', tabUrl);
      setTimeout(() => detectorInstance.checkMainFrames(fullPageState), 2);
      delayedTest(
        () => {
          chai.expect(detectorInstance.checkIsOAuth(state)).to.be.true;
        },
        done,
        5,
      );
    });

    it('returns true if click domain does not match', (done) => {
      const tab = 5;
      const tabUrl = 'https://cliqz.com/';
      const tabUrl2 = 'https://www.cliqz.com/';
      detectorInstance.recordClick(null, '', '', mockSender(tab, tabUrl));
      const fullPageState = mockState(
        tab + 1,
        'https://www.ghostery.com/',
        '',
        true,
      );
      const state = mockState(tab, 'https://auth.ghostery.com/oauth', tabUrl2);
      setTimeout(() => detectorInstance.checkMainFrames(fullPageState), 2);
      delayedTest(
        () => {
          chai.expect(detectorInstance.checkIsOAuth(state)).to.be.true;
        },
        done,
        5,
      );
    });
  });
});
