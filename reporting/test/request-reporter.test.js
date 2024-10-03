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

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import chrome from 'sinon-chrome';
import sinon from 'sinon';
import { expect } from 'chai';
import EventEmitter from 'node:events';

import { playScenario } from './helpers/scenarios.js';
import { base64ToArrayBuffer } from './helpers/fetch-mock.js';

import { setLogLevel } from '../src/logger.js';
import RequestReporter from '../src/request-reporter.js';
import WebRequestPipeline from '../src/webrequest-pipeline/index.js';

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
          }
        });
      }

      return oldFetch(...args);
    });
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
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
          communicationEmiter.emit('send', msg)
        },
        sendInstant(msg) {
          communicationEmiter.emit('sendInstant', msg)
        },
        trustedClock,
      };
      const webRequestPipeline = new WebRequestPipeline();
      await webRequestPipeline.init();
      reporter = new RequestReporter(config, {
        communication,
        webRequestPipeline,
        trustedClock,
        getBrowserInfo: () => ({ name: 'xx' }),
        countryProvider: { getSafeCountryCode: () => 'en' },
      });
      await reporter.init();
      await reporter.requestMonitor.qs_whitelist.initPromise;
    });

    afterEach(function () {
      reporter.unload();
      reporter.webRequestPipeline.unload();
      reporter = undefined;
      clock.restore();
      delete globalThis.indexedDB;
    });

    context('0001-empty-page', function () {
      it('detects no 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        expect(
          reporter.webRequestPipeline.pageStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.webRequestPipeline.pageStore.getPageForRequest({ tabId, frameId: 0 });
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
          reporter.webRequestPipeline.pageStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.webRequestPipeline.pageStore.getPageForRequest({ tabId, frameId: 0 });
        expect(tab.requestStats).to.have.keys([
          'script.localhost',
        ]);
      });

      it('reports 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) => communicationEmiter.once('send', resolve));
        // force stage all pages
        seenTabIds.forEach(tabId => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys([
          'script.localhost',
        ])
      });
    });

    context('0004-ping', function () {
      it('reports pings', async function () {
        const eventPromise = new Promise((resolve) => communicationEmiter.once('send', resolve));
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
        expect(event.payload.data[0].tps).to.have.keys([
          'ping.localhost',
        ])
      });
    });

    context('0005-preload', function () {
      it('reports 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) => communicationEmiter.once('send', resolve));
        // force stage all pages
        seenTabIds.forEach(tabId => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys([
          'preload.localhost',
        ]);
      });
    });

    context('0008-navigation', function () {
      it('reports 3rd parties', async function () {
        const eventPromise1 = new Promise((resolve) => communicationEmiter.once('send', resolve));
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-08-02-2',
        });
        await clock.runToLast();
        const event1 = await eventPromise1;
        expect(event1).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event1.payload.data[0].tps).to.have.keys([
          'script1.localhost',
        ]);
        const eventPromise2 = new Promise((resolve) => communicationEmiter.once('send', resolve));
        // force stage all pages
        seenTabIds.forEach(tabId => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event2 = await eventPromise2;
        expect(event2).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event2.payload.data[0].tps).to.have.keys([
          'script2.localhost',
        ]);
        // reports should belong to different pages
        expect(event1.payload.data[0].hostname).to.not.be.equal(event2.payload.data[0].hostname);
      });
    });
  });
});
