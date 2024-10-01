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

    // https://github.com/ghostery/webextension-event-recorder/blob/39370ce8a58712a9bbc15761ce62e7f50d43a255/scenariors/0001-quick-close.js#L1
    context('0001-quick-close', function () {
      it('detects 3rd parties', async function () {
        await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-09-27',
        });
        await clock.runToLast();
        expect(
          reporter.webRequestPipeline.pageStore.tabs.countNonExpiredKeys(),
        ).to.be.equal(1);
        const [tab] = reporter.webRequestPipeline.pageStore.tabs.values();
        expect(tab.requestStats).to.have.keys([
          'cdn.jsdelivr.net',
          'cdn.ghostery.com',
        ]);
      });

      it('reports 3rd parties', async function () {
        await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-09-27',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) => communicationEmiter.once('send', resolve));
        // force stage all pages
        reporter.webRequestPipeline.pageStore.tabs.forEach((page) => reporter.webRequestPipeline.pageStore.stagePage(page));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys([
          'cdn.jsdelivr.net',
          'cdn.ghostery.com',
        ])
      });
    });

    // https://github.com/ghostery/webextension-event-recorder/blob/39370ce8a58712a9bbc15761ce62e7f50d43a255/scenariors/0002-quick-navigation.js#L1
    context('0002-quick-navigation', function () {
      it('detects 3rd parties', async function () {
        await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-09-27',
        });
        await clock.runToLast();
        const [tab] = reporter.webRequestPipeline.pageStore.tabs.values();
        expect(tab.requestStats).to.have.keys([
          'static.xx.fbcdn.net',
        ]);
      });
    });

    // https://github.com/ghostery/webextension-event-recorder/blob/69ae910f323e6af11e55f496a3f493aaf69c31ba/scenariors/0003-prefetch.js#L3
    context('0003-prefetch', function () {
      it('should ignore preflight requests', async function () {
        await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2024-09-30',
        });
        await clock.runToLast();
        const [tab] = reporter.webRequestPipeline.pageStore.tabs.values();
        expect(tab.requestStats).to.have.keys([
          'subdomain.localhost',
        ]);
      });
    });
  });
});
