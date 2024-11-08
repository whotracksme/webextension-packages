/* eslint-disable prettier/prettier */
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
import sinon from 'sinon';
import { expect } from 'chai';
import EventEmitter, { once } from 'node:events';
import { IDBFactory } from 'fake-indexeddb';

import {
  playScenario,
  playSnapshotScenario,
  recordSnapshot,
  readSnapshot,
} from '../helpers/scenarios.js';
import { base64ToArrayBuffer } from '../helpers/fetch-mock.js';

import { setLogLevel } from '../../src/logger.js';
import RequestReporter from '../../src/request/index.js';

const config = {
  configUrl: 'config',
  remoteWhitelistUrl: 'whitelist',
  localWhitelistUrl: 'local',
};

describe('RequestReporter', function () {
  before(function () {
    setLogLevel('error');
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
    const oldFetch = globalThis.fetch;
    sinon.stub(globalThis, 'fetch').callsFake((...args) => {
      const url = args[0];
      if (url.startsWith(config.configUrl)) {
        return Promise.resolve({
          ok: true,
          async json() {
            return {};
          },
        });
      }

      if (url.startsWith(config.remoteWhitelistUrl)) {
        return Promise.resolve({
          ok: true,
          async json() {
            return {
              version: '2018-10-11',
              useDiff: false,
            };
          },
          async arrayBuffer() {
            // empty bloom filter
            return base64ToArrayBuffer('AAAAAgrdwUcnN1113w==');
          },
        });
      }

      return oldFetch(...args);
    });
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
    chrome.tabs.query.returns([]);
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
    globalThis.fetch.restore();
    setLogLevel('info');
  });

  context('with pre-recorded events', function () {
    let reporter;
    let clock;
    const communicationEmiter = new EventEmitter();

    beforeEach(async function () {
      globalThis.indexedDB = new IDBFactory();
      clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
      const trustedClock = {
        getTimeAsYYYYMMDD() {
          return '';
        },
        getTimeAsYYYYMMDDHH() {
          return '';
        },
      };
      communicationEmiter.removeAllListeners();
      const communication = {
        send(msg) {
          communicationEmiter.emit('send', msg);
        },
        sendInstant(msg) {
          communicationEmiter.emit('sendInstant', msg);
        },
        trustedClock,
      };
      reporter = new RequestReporter(config, {
        communication,
        trustedClock,
        getBrowserInfo: () => ({ name: 'xx' }),
        countryProvider: { getSafeCountryCode: () => 'en' },
      });
      await reporter.init();
      await reporter.qs_whitelist.initPromise;
    });

    afterEach(function () {
      reporter.unload();
      reporter = undefined;
      clock.restore();
      delete globalThis.indexedDB;
    });

    context('synthetic events', function () {
      it('records stats from redirects', async function () {
        const events = once(communicationEmiter, 'send');

        const tab = { id: 1, url: 'https://www.onet.pl/' };
        // creates a page
        chrome.tabs.onCreated.dispatch(tab)
        // changes state to 'completed'
        chrome.webNavigation.onCompleted.dispatch({ tabId: tab.id, frameId: 0, });

        // prepare iframe
        chrome.webNavigation.onCommitted.dispatch({ tabId: tab.id, parentFrameId: 0, frameId:15032385542, url: "https://pulsembed.eu/p2em/3VgyZUiWT/"});
        chrome.webNavigation.onCommitted.dispatch({ tabId: tab.id, parentFrameId: 15032385542, frameId: 17179869195, url: "https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1"});

        // Fragment of 0002 snapshot
        chrome.webRequest.onBeforeRequest.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760357996,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onBeforeSendHeaders.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760357997,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onSendHeaders.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760357997,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onHeadersReceived.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358179,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","fromCache":false,"responseHeaders":[{"name":"p3p","value":"policyref=\"https://googleads.g.doubleclick.net/pagead/gcn_p3p_.xml\", CP=\"CURa ADMa DEVa TAIo PSAo PSDo OUR IND UNI PUR INT DEM STA PRE COM NAV OTC NOI DSP COR\""},{"name":"timing-allow-origin","value":"*"},{"name":"cross-origin-resource-policy","value":"cross-origin"},{"name":"location","value":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1"},{"name":"access-control-allow-credentials","value":"true"},{"name":"access-control-allow-origin","value":"https://www.youtube.com"},{"name":"date","value":"Thu, 24 Oct 2024 08:59:18 GMT"},{"name":"pragma","value":"no-cache"},{"name":"expires","value":"Fri, 01 Jan 1990 00:00:00 GMT"},{"name":"cache-control","value":"no-cache, no-store, must-revalidate"},{"name":"content-type","value":"text/html; charset=UTF-8"},{"name":"x-content-type-options","value":"nosniff"},{"name":"server","value":"cafe"},{"name":"content-length","value":"0"},{"name":"x-xss-protection","value":"0"},{"name":"alt-svc","value":"h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000"},{"name":"X-Firefox-Spdy","value":"h2"}],"statusCode":302,"statusLine":"HTTP/2.0 302 ","proxyInfo":null,"ip":"172.217.16.162","frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onBeforeRedirect.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358180,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","fromCache":false,"responseHeaders":[{"name":"p3p","value":"policyref=\"https://googleads.g.doubleclick.net/pagead/gcn_p3p_.xml\", CP=\"CURa ADMa DEVa TAIo PSAo PSDo OUR IND UNI PUR INT DEM STA PRE COM NAV OTC NOI DSP COR\""},{"name":"timing-allow-origin","value":"*"},{"name":"cross-origin-resource-policy","value":"cross-origin"},{"name":"location","value":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1"},{"name":"access-control-allow-credentials","value":"true"},{"name":"access-control-allow-origin","value":"https://www.youtube.com"},{"name":"date","value":"Thu, 24 Oct 2024 08:59:18 GMT"},{"name":"pragma","value":"no-cache"},{"name":"expires","value":"Fri, 01 Jan 1990 00:00:00 GMT"},{"name":"cache-control","value":"no-cache, no-store, must-revalidate"},{"name":"content-type","value":"text/html; charset=UTF-8"},{"name":"x-content-type-options","value":"nosniff"},{"name":"server","value":"cafe"},{"name":"content-length","value":"0"},{"name":"x-xss-protection","value":"0"},{"name":"alt-svc","value":"h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000"},{"name":"X-Firefox-Spdy","value":"h2"}],"statusCode":302,"statusLine":"HTTP/2.0 302 ","redirectUrl":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","proxyInfo":null,"ip":"172.217.16.162","frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onBeforeRequest.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358181,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onBeforeSendHeaders.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358182,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onSendHeaders.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358182,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","proxyInfo":null,"ip":null,"frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onHeadersReceived.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358221,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","fromCache":false,"responseHeaders":[{"name":"p3p","value":"policyref=\"https://googleads.g.doubleclick.net/pagead/gcn_p3p_.xml\", CP=\"CURa ADMa DEVa TAIo PSAo PSDo OUR IND UNI PUR INT DEM STA PRE COM NAV OTC NOI DSP COR\""},{"name":"timing-allow-origin","value":"*"},{"name":"cross-origin-resource-policy","value":"cross-origin"},{"name":"access-control-allow-credentials","value":"true"},{"name":"access-control-allow-origin","value":"https://www.youtube.com"},{"name":"content-type","value":"application/json; charset=UTF-8"},{"name":"date","value":"Thu, 24 Oct 2024 08:59:18 GMT"},{"name":"pragma","value":"no-cache"},{"name":"expires","value":"Fri, 01 Jan 1990 00:00:00 GMT"},{"name":"cache-control","value":"no-cache, no-store, must-revalidate"},{"name":"x-content-type-options","value":"nosniff"},{"name":"content-disposition","value":"attachment; filename=\"f.txt\""},{"name":"content-encoding","value":"gzip"},{"name":"server","value":"cafe"},{"name":"content-length","value":"120"},{"name":"x-xss-protection","value":"0"},{"name":"alt-svc","value":"h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000"},{"name":"X-Firefox-Http3","value":"h3"}],"statusCode":200,"statusLine":"HTTP/3.0 200 ","proxyInfo":null,"ip":"172.217.16.162","frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onResponseStarted.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358221,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","fromCache":false,"responseHeaders":[{"name":"p3p","value":"policyref=\"https://googleads.g.doubleclick.net/pagead/gcn_p3p_.xml\", CP=\"CURa ADMa DEVa TAIo PSAo PSDo OUR IND UNI PUR INT DEM STA PRE COM NAV OTC NOI DSP COR\""},{"name":"timing-allow-origin","value":"*"},{"name":"cross-origin-resource-policy","value":"cross-origin"},{"name":"access-control-allow-credentials","value":"true"},{"name":"access-control-allow-origin","value":"https://www.youtube.com"},{"name":"content-type","value":"application/json; charset=UTF-8"},{"name":"date","value":"Thu, 24 Oct 2024 08:59:18 GMT"},{"name":"pragma","value":"no-cache"},{"name":"expires","value":"Fri, 01 Jan 1990 00:00:00 GMT"},{"name":"cache-control","value":"no-cache, no-store, must-revalidate"},{"name":"x-content-type-options","value":"nosniff"},{"name":"content-disposition","value":"attachment; filename=\"f.txt\""},{"name":"content-encoding","value":"gzip"},{"name":"server","value":"cafe"},{"name":"content-length","value":"120"},{"name":"x-xss-protection","value":"0"},{"name":"alt-svc","value":"h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000"},{"name":"X-Firefox-Http3","value":"h3"}],"statusCode":200,"statusLine":"HTTP/3.0 200 ","proxyInfo":null,"ip":"172.217.16.162","frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});
        chrome.webRequest.onCompleted.dispatch({"requestId":"294","url":"https://googleads.g.doubleclick.net/pagead/id?slf_rd=1","originUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","documentUrl":"https://www.youtube.com/embed/sQpzRs4j1NQ?mute=1&widget_referrer=https%3A%2F%2Fwww.onet.pl%2F&enablejsapi=1&origin=https%3A%2F%2Fpulsembed.eu&widgetid=1","method":"GET","type":"xmlhttprequest","timeStamp":1729760358221,"tabId":tab.id,"frameId":17179869195,"parentFrameId":15032385542,"incognito":false,"thirdParty":true,"cookieStoreId":"firefox-default","fromCache":false,"responseHeaders":[{"name":"p3p","value":"policyref=\"https://googleads.g.doubleclick.net/pagead/gcn_p3p_.xml\", CP=\"CURa ADMa DEVa TAIo PSAo PSDo OUR IND UNI PUR INT DEM STA PRE COM NAV OTC NOI DSP COR\""},{"name":"timing-allow-origin","value":"*"},{"name":"cross-origin-resource-policy","value":"cross-origin"},{"name":"access-control-allow-credentials","value":"true"},{"name":"access-control-allow-origin","value":"https://www.youtube.com"},{"name":"content-type","value":"application/json; charset=UTF-8"},{"name":"date","value":"Thu, 24 Oct 2024 08:59:18 GMT"},{"name":"pragma","value":"no-cache"},{"name":"expires","value":"Fri, 01 Jan 1990 00:00:00 GMT"},{"name":"cache-control","value":"no-cache, no-store, must-revalidate"},{"name":"x-content-type-options","value":"nosniff"},{"name":"content-disposition","value":"attachment; filename=\"f.txt\""},{"name":"content-encoding","value":"gzip"},{"name":"server","value":"cafe"},{"name":"content-length","value":"120"},{"name":"x-xss-protection","value":"0"},{"name":"alt-svc","value":"h3=\":443\"; ma=2592000,h3-29=\":443\"; ma=2592000"},{"name":"X-Firefox-Http3","value":"h3"}],"statusCode":200,"statusLine":"HTTP/3.0 200 ","proxyInfo":null,"ip":"172.217.16.162","frameAncestors":[{"frameId":15032385542,"url":"https://pulsembed.eu/p2em/3VgyZUiWT/"},{"frameId":0,"url":"https://www.onet.pl/"}],"urlClassification":{"firstParty":[],"thirdParty":["tracking_ad","any_basic_tracking","any_strict_tracking"]},"requestSize":0,"responseSize":0});

        // stages the page for sendout
        chrome.tabs.onRemoved.dispatch(tab.id);
        await clock.runToLast();

        const [event] = await events;
        expect(event).to.include({ action: 'wtm.attrack.tp_events' });
        expect(
          event.payload.data[0].tps['googleads.g.doubleclick.net'],
        ).to.deep.equal({
          c: 2,
          type_11: 2,
          scheme_https: 2,
          resp_ob: 2,
          content_length: 121,
          status_302: 1,
          has_qs: 1,
          status_200: 1,
        });
      });
    });

    context('0001-empty-page', function () {
      it('detects no 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        expect(
          reporter.pageStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.getPageForRequest({
          tabId,
          frameId: 0,
        });
        expect(tab.requestStats).to.be.empty;
      });
    });

    context('0002-3rd-party', function () {
      it('detects 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        expect(
          reporter.pageStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.getPageForRequest({
          tabId,
          frameId: 0,
        });
        expect(tab.requestStats).to.have.keys(['script.localhost']);
      });

      it('reports 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmiter.once('send', resolve),
        );
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys(['script.localhost']);
      });
    });

    context('0004-ping', function () {
      it('reports pings', async function () {
        const eventPromise = new Promise((resolve) =>
          communicationEmiter.once('send', resolve),
        );
        await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02-1',
        });
        await clock.runToLast();
        // first tp_event from the page that sent ping
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys(['ping.localhost']);
      });
    });

    context('0005-preload', function () {
      it('reports 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmiter.once('send', resolve),
        );
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys(['preload.localhost']);
      });
    });

    context('0008-navigation', function () {
      it('reports 3rd parties', async function () {
        const eventPromise1 = new Promise((resolve) =>
          communicationEmiter.once('send', resolve),
        );
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02-2',
        });
        await clock.runToLast();
        const event1 = await eventPromise1;
        expect(event1).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event1.payload.data[0].tps).to.have.keys(['script1.localhost']);
        const eventPromise2 = new Promise((resolve) =>
          communicationEmiter.once('send', resolve),
        );
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event2 = await eventPromise2;
        expect(event2).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event2.payload.data[0].tps).to.have.keys(['script2.localhost']);
        // reports should belong to different pages
        expect(event1.payload.data[0].hostname).to.not.be.equal(
          event2.payload.data[0].hostname,
        );
      });
    });

    context('snapshots', function () {
      this.timeout(10000);

      function cleanupMessage(message) {
        delete message['anti-duplicates'];
        return message;
      }

      async function processRunloopUntil(timeout) {
        const start = Date.now();
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const now = await clock.runToLast();
          if (now - start > timeout) {
            break;
          }
        }
      }

      for (const snapshotName of ['0001', '0002', '0003', '0004']) {
        it(snapshotName, async function () {
          const messages = [];
          communicationEmiter.addListener('send', (message) =>
            messages.push(cleanupMessage(message)),
          );
          playSnapshotScenario(chrome, snapshotName);

          // run twice to allow token telemetry to trigger
          playSnapshotScenario(chrome, snapshotName, {
            rewriteUrls: { 'onet.pl': 'wp.pl', 'soundcloud.com': 'google.com' },
          });
          await processRunloopUntil(
            reporter.tokenTelemetry
              .NEW_ENTRY_MIN_AGE,
          );

          // eslint-disable-next-line no-undef
          if (process.argv.includes('--record-snapshot')) {
            recordSnapshot(snapshotName, messages);
          }

          const snapshot = await readSnapshot(snapshotName);
          expect(messages).to.have.lengthOf(snapshot.length);
          messages.forEach((message, index) => {
            expect(message).to.deep.equal(snapshot[index]);
          });
        });
      }
    });
  });
});
