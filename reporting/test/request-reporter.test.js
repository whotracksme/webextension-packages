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

import { playScenario } from './helpers/scenariors.js';

import { setLogLevel } from '../src/logger.js';
import RequestReporter from '../src/request-reporter.js';
import WebRequestPipeline from '../src/webrequest-pipeline/index.js';

describe('RequestReporter', function () {
  before(function () {
    setLogLevel('error');
    chrome.storage.session = chrome.storage.local;
    globalThis.chrome = chrome;
  });

  beforeEach(function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
    setLogLevel('info');
  });

  context('with pre-recorded events', function () {
    let reporter;
    let clock;

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
      const communication = {
        trustedClock,
      };
      const config = {
        configUrl: 'https://cdn.ghostery.com/antitracking/config.json',
        remoteWhitelistUrl:
          'https://cdn.ghostery.com/antitracking/whitelist/2',
        localWhitelistUrl: '/base/assets/request',
      };
      const webRequestPipeline = new WebRequestPipeline();
      await webRequestPipeline.init();
      reporter = new RequestReporter(config, {
        communication,
        webRequestPipeline,
        trustedClock,
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

    context('0001-quick-close', function () {
      it('detects 3rd parties', async function () {
        await playScenario(chrome, {
          scenariorName: '0001-quick-close',
          scenariorRelease: '2024-09-27',
        });
        await clock.runToLast();
        expect(
          reporter.webRequestPipeline.pageStore.tabs.countNonExpiredKeys(),
        ).to.be.equal(1);
        const [tabId] = reporter.webRequestPipeline.pageStore.tabs
          .keys()
          .toArray();
        const tab = reporter.webRequestPipeline.pageStore.tabs.get(tabId);
        expect(tab.requestStats).to.have.keys([
          'cdn.jsdelivr.net',
          'cdn.ghostery.com',
        ]);
      });
    });

    context('0002-quick-navigation', function () {
      it('?????', async function () {
        await playScenario(chrome, {
          scenariorName: '0002-quick-navigation',
          scenariorRelease: '2024-09-27',
        });
        await clock.runToLast();
        expect(
          reporter.webRequestPipeline.pageStore.tabs.countNonExpiredKeys(),
        ).to.be.equal(1);
        const tab = reporter.webRequestPipeline.pageStore.tabs.values()[0]
        console.log(tab);
      });
    });
  });
});
