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
import EventEmitter from 'node:events';
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
    chrome.runtime.getManifest.returns({ permissions: [] });
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
    const communicationEmitter = new EventEmitter();

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
      communicationEmitter.removeAllListeners();
      reporter = new RequestReporter(config, {
        onMessageReady: (msg) => {
          communicationEmitter.emit('send', msg);
        },
        trustedClock,
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

    context('0001-empty-page', function () {
      it('detects no 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        expect(
          reporter.documentStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.documentStore.getDocumentForRequest({
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
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        expect(
          reporter.documentStore.checkIfEmpty(),
        ).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.documentStore.getDocumentForRequest({
          tabId,
          frameId: 0,
        });
        expect(tab.requestStats).to.have.keys(['script.localhost']);
      });

      it('reports 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
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

    context('0003-prefetch', function () {
      it('reports prefetched 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
        );
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const event = await eventPromise;
        expect(event).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event.payload.data[0].tps).to.have.keys(['subdomain.localhost']);
      });
    });

    context('0004-ping', function () {
      it('reports pings', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
        );
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
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
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        const eventPromise = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
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

    context('0006-preconnect', function () {
      it('does not attribute preconnect hints as 3rd parties', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        expect(reporter.pageStore.checkIfEmpty()).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.getPageForRequest({ tabId, frameId: 0 });
        // preconnect opens a socket but fires no webRequest, so no
        // third-party counters should accumulate.
        expect(tab.requestStats).to.be.empty;
      });
    });

    context('0007-prerender', function () {
      it('keeps prerender stats off the visible page', async function () {
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        expect(reporter.pageStore.checkIfEmpty()).to.be.false;
        // The visible localhost:8080 page has no third parties; the
        // prerendered document lives on a separate tab and is not
        // counted against the one the user is looking at.
        const visibleTabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.getPageForRequest({
          tabId: visibleTabId,
          frameId: 0,
        });
        expect(tab.requestStats).to.be.empty;
      });
    });

    context('0008-navigation', function () {
      it('reports 3rd parties', async function () {
        const eventPromise1 = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
        );
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        const event1 = await eventPromise1;
        expect(event1).to.deep.include({
          action: 'wtm.attrack.tp_events',
        });
        expect(event1.payload.data[0].tps).to.have.keys(['script1.localhost']);
        const eventPromise2 = new Promise((resolve) =>
          communicationEmitter.once('send', resolve),
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

    context('0009-beacon', function () {
      // SKIP: passes only on the documentId-centric attribution
      // branch. User searches on search.localhost, clicks through to
      // landing.localhost, and the search document fires two beacons
      // to beacon.localhost (click handler + pagehide). Each beacon
      // webRequest carries the search document's documentId, so
      // correct attribution keeps beacon.localhost on search's
      // tp_events. Main's tabId+previous-chain logic misattributes
      // the beacons to a staged-and-dead page, silently dropping
      // them.
      it.skip('attributes late beacon to the source document', async function () {
        const events = [];
        communicationEmitter.on('send', (msg) => {
          if (msg.action === 'wtm.attrack.tp_events') {
            events.push(msg);
          }
        });
        const { seenTabIds } = await playScenario(chrome, {
          scenarioName: this.test.parent.title,
          scenarioRelease: '2026-04-23',
        });
        await clock.runToLast();
        // Force-stage remaining pages so any held documents flush.
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await clock.runToLast();
        const emittedBeacon = events.some((e) =>
          Object.keys(e.payload.data[0].tps).includes('beacon.localhost'),
        );
        expect(emittedBeacon, 'beacon.localhost must land in some tp_events')
          .to.be.true;
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

      for (const snapshotName of ['0001', '0002', '0003', '0004', '0005', '0006']) {
        it(snapshotName, async function () {
          const messages = [];
          communicationEmitter.addListener('send', (message) =>
            messages.push(cleanupMessage(message)),
          );
          playSnapshotScenario(chrome, snapshotName);

          // run twice to allow token telemetry to trigger; documentIdPrefix
          // makes the replay look like a distinct browsing session so that
          // the new documentId-dedupe doesn't suppress its reports.
          playSnapshotScenario(chrome, snapshotName, {
            rewriteUrls: { 'onet.pl': 'wp.pl', 'soundcloud.com': 'google.com', 'nike.com': 'adidas.com' },
            documentIdPrefix: 'replay2-',
          });
          await processRunloopUntil(
            reporter.tokenTelemetry
              .NEW_ENTRY_MIN_AGE,
          );

          /* eslint-disable no-undef */
          if (
            process.argv.includes('--record-snapshot') ||
            process.env.RECORD_SNAPSHOT
          ) {
            recordSnapshot(snapshotName, messages);
          }
          /* eslint-enable no-undef */

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
