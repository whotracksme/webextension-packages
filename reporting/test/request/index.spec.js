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
import sinon from 'sinon';

// import FakeSessionApi from '../helpers/fake-session-storage.js'; // TODO: see comments below

import testPages from './test-pages.js';
import { createFetchMock } from '../helpers/fetch-mock';

/* eslint no-param-reassign : off */

import { truncatedHash, default as md5 } from '../../src/md5.js';

import Config from '../../src/request/config.js';
import Database from '../../src/request/database.js';
import RequestMonitor from '../../src/request/index.js';
import WebrequestPipeline from '../../src/webrequest-pipeline/index.js';

const THIRD_PARTY_HOST1 = '127.0.0.1:60508';
const THIRD_PARTY_HOST2 = 'cliqztest2.de:60508';

const mockRequestHeaders = [
  { name: 'Cookie', value: 'uid=234239gjvbadsfdsaf' },
  { name: 'Referer', value: '' },
];

const mockResponseHeaders = [{ name: 'Content-Length', value: '0' }];

function isThirdParty(url) {
  return (
    url.indexOf(THIRD_PARTY_HOST1) > -1 || url.indexOf(THIRD_PARTY_HOST2) > -1
  );
}

function expectNoModification(resp) {
  if (resp.response) {
    chai.expect(resp.response).not.have.property('cancel');
    chai.expect(resp.response).not.have.property('redirectUrl');
    chai.expect(resp.response).not.have.property('requestHeaders');
  } else {
    chai.expect(resp.response).to.be.undefined;
  }
}

describe('request/index', function () {
  let monkeyPatchedChromeStorage;
  let oldChromeStorageSession;
  let oldChromeStorage;

  let pipeline;

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

      // to test against a real in-memory implementation:
      // chrome.storage.session = new FakeSessionApi();
    }

    pipeline = new WebrequestPipeline();
    pipeline.init();
  });

  afterEach(() => {
    pipeline?.unload();
    pipeline = null;
    if (monkeyPatchedChromeStorage) {
      chrome.storage.session = oldChromeStorageSession;
      chrome.storage = oldChromeStorage;
    }
  });

  let attrack;
  let config;
  let fetchMock = createFetchMock();

  beforeEach(async function () {
    sinon.stub(window, 'fetch').callsFake((url) => fetchMock(url));

    const trustedClock = {
      getTimeAsYYYYMMDD() {
        return '';
      },
    };
    const db = new Database();
    await db.init();
    config = new Config(
      {
        configUrl: 'http://cdn',
        remoteWhitelistUrl: 'http://cdn',
        localWhitelistUrl: '/base/assets/request',
      },
      {
        db,
        trustedClock,
      },
    );
    await config.init();
    attrack = new RequestMonitor(
      {},
      {
        db,
        webRequestPipeline: pipeline,
        countryProvider: {},
        trustedClock,
        communication: {},
        getBrowserInfo: () => ({ name: 'xx' }),
      },
    );
    await attrack.init(config);
    await attrack.qs_whitelist.initPromise;
    config.cookieEnabled = false;
    config.qsEnabled = false;
    config.placeHolder = '<removed>';
  });

  afterEach(() => {
    attrack.unload();
    window.fetch.restore();
    fetchMock = async () => {};
  });

  function simulatePageLoad(pageSpec) {
    chrome.tabs.onCreated.dispatch(pageSpec.tab);
    return {
      onBeforeRequest: pageSpec.onBeforeRequest.map(function (reqData) {
        const response = pipeline.onBeforeRequest(reqData);
        return { url: reqData.url, response };
      }),
      onBeforeSendHeaders: pageSpec.onBeforeSendHeaders.map(function (reqData) {
        reqData.requestHeaders = mockRequestHeaders;
        const response = pipeline.onBeforeSendHeaders(reqData);
        return { url: reqData.url, response };
      }),
      onHeadersReceived: pageSpec.onHeadersReceived.map(function (reqData) {
        reqData.requestHeaders = mockRequestHeaders;
        reqData.responseHeaders = mockResponseHeaders;
        const response = pipeline.onHeadersReceived(reqData);
        return { url: reqData.url, response };
      }),
    };
  }

  Object.keys(testPages).forEach(function (testPage) {
    const reqs = testPages[testPage];

    describe(testPage, function () {
      describe('cookie blocking', function () {
        describe('cookie blocking disabled', function () {
          beforeEach(function () {
            config.cookieEnabled = false;
          });

          it('allows all cookies', function () {
            const responses = simulatePageLoad(reqs);
            responses.onBeforeRequest.forEach(expectNoModification);
            responses.onBeforeSendHeaders.forEach(expectNoModification);
          });
        });

        describe('cookie blocking enabled', function () {
          beforeEach(function () {
            config.cookieEnabled = true;
          });

          it('blocks third party cookies', function () {
            const responses = simulatePageLoad(reqs);
            responses.onBeforeRequest.forEach(expectNoModification);
            responses.onBeforeSendHeaders.forEach(function (resp) {
              if (isThirdParty(resp.url)) {
                chai.expect(resp.response).to.not.be.undefined;
                chai.expect(resp.response).to.have.property('requestHeaders');
              } else {
                expectNoModification(resp);
              }
            });
          });
        });
      });

      context('QS blocking', function () {
        beforeEach(function () {
          config.qsEnabled = true;
        });

        it('allows query strings on domains not in the tracker list', function () {
          const responses = simulatePageLoad(reqs);
          responses.onBeforeRequest.forEach(expectNoModification);
          responses.onBeforeRequest.forEach(expectNoModification);
          responses.onBeforeSendHeaders.forEach(expectNoModification);
        });

        describe('when third party on tracker list', function () {
          let key;
          let trackerHash;

          beforeEach(function () {
            key = md5('uid');
            trackerHash = truncatedHash('127.0.0.1');
            attrack.qs_whitelist.addSafeToken(trackerHash, '');
            config.tokenDomainCountThreshold = 2;
            attrack.pipelineSteps.tokenChecker.tokenDomain.clear();
          });

          it('allows QS first time on tracker', function () {
            const responses = simulatePageLoad(reqs);
            responses.onBeforeRequest.forEach(expectNoModification);
            responses.onBeforeSendHeaders.forEach(expectNoModification);
          });

          context('when domain count exceeded', function () {
            const uid = '04C2EAD03BAB7F5E-2E85855CF4C75134';

            function expectThirdPartyBlock(req) {
              if (isThirdParty(req.url) && req.url.indexOf(uid) > -1) {
                // request was already redirected
              } else {
                expectNoModification(req);
              }
            }

            beforeEach(function () {
              config.tokenDomainCountThreshold = 0;
            });

            it('blocks long tokens on tracker domain', function () {
              const responses = simulatePageLoad(reqs);
              responses.onBeforeRequest.forEach(expectThirdPartyBlock);
              responses.onBeforeSendHeaders.forEach(function (req) {
                if (isThirdParty(req.url) && req.url.indexOf(uid) > -1) {
                  // request was already redirected
                } else {
                  expectNoModification(req);
                }
              });
            });

            it('does not block if safekey', function () {
              attrack.qs_whitelist.addSafeKey(trackerHash, key);

              const responses = simulatePageLoad(reqs);
              responses.onBeforeRequest.forEach(expectNoModification);
              responses.onBeforeSendHeaders.forEach(expectNoModification);
            });

            it('does not block if whitelisted token', function () {
              const tok = md5(uid);
              attrack.qs_whitelist.addSafeToken(trackerHash, tok);

              const responses = simulatePageLoad(reqs);
              responses.onBeforeRequest.forEach(expectNoModification);
              responses.onBeforeSendHeaders.forEach(expectNoModification);
            });
          });
        });
      });
    });
  });

  describe('onBeforeRequest', function () {
    const uid = '04C2EAD03BAB7F5E-2E85855CF4C75134';

    beforeEach(function () {
      config.qsEnabled = true;
      attrack.qs_whitelist.addSafeToken(truncatedHash('tracker.com'), '');
      config.tokenDomainCountThreshold = 0; // block first time
      return attrack.initPipeline();
    });

    it('removes all occurances of uid in the request', function () {
      const mainDoc = pipeline.onBeforeRequest({
        tabId: 34,
        frameId: 0,
        parentFrameId: -1,
        method: 'GET',
        type: 'main_frame',
        url: 'http://cliqztest.com/',
        requestHeaders: mockRequestHeaders,
      });
      chai.expect(mainDoc).to.not.have.property('cancel');
      chai.expect(mainDoc).to.not.have.property('redirectUrl');
      chai.expect(mainDoc).to.not.have.property('requestHeaders');
      const response = pipeline.onBeforeRequest({
        tabId: 34,
        frameId: 0,
        parentFrameId: -1,
        method: 'GET',
        type: 'xmlhttprequest',
        url: `http://tracker.com/track;uid=${uid}?uid2=${uid}&encuid=${encodeURIComponent(
          uid,
        )}`,
        requestHeaders: mockRequestHeaders,
        initiator: 'http://cliqztest.com',
        isPrivate: false,
      });
      chai.expect(response).to.have.property('redirectUrl');
      chai.expect(response.redirectUrl).to.not.contain(uid);
      chai.expect(response.redirectUrl).to.not.contain(encodeURIComponent(uid));
    });

    it('removes also after subsequent redirect with same uid', function () {
      const mainDoc = pipeline.onBeforeRequest({
        tabId: 34,
        frameId: 0,
        parentFrameId: -1,
        method: 'GET',
        type: 'main_frame',
        url: 'http://cliqztest.com/',
        requestHeaders: mockRequestHeaders,
        originUrl: '',
        tabUrl: '',
      });
      chai.expect(mainDoc).to.not.have.property('cancel');
      chai.expect(mainDoc).to.not.have.property('redirectUrl');
      chai.expect(mainDoc).to.not.have.property('requestHeaders');
      let response = pipeline.onBeforeRequest({
        tabId: 34,
        frameId: 0,
        parentFrameId: -1,
        method: 'GET',
        type: 'xmlhttprequest',
        url: `http://tracker.com/track;uid=${uid}?uid2=${uid}&encuid=${encodeURIComponent(
          uid,
        )}`,
        requestHeaders: mockRequestHeaders,
        originUrl: 'http://cliqztest.com',
        tabUrl: 'http://cliqztest.com',
        isPrivate: false,
      });
      chai.expect(response).to.have.property('redirectUrl');
      chai.expect(response.redirectUrl).to.not.contain(uid);
      chai.expect(response.redirectUrl).to.not.contain(encodeURIComponent(uid));

      response = pipeline.onBeforeRequest({
        tabId: 34,
        frameId: 0,
        parentFrameId: -1,
        method: 'GET',
        type: 'xmlhttprequest',
        url: `http://tracker.com/track;uid=cliqz.com/tracking&uid2=cliqz.com/tracking&uid=${uid}?uid2=${uid}&encuid=${encodeURIComponent(
          uid,
        )}`,
        requestHeaders: mockRequestHeaders,
        originUrl: 'http://cliqztest.com',
        tabUrl: 'http://cliqztest.com',
        isPrivate: false,
      });
      chai.expect(response).to.have.property('redirectUrl');
      chai.expect(response.redirectUrl).to.not.contain(uid);
      chai.expect(response.redirectUrl).to.not.contain(encodeURIComponent(uid));
    });
  });
});
