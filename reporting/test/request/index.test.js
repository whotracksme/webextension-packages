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
import { truncatedHash } from '../../src/md5.js';
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
        expect(reporter.pageStore.checkIfEmpty()).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.findPageForTab(tabId);
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
        expect(reporter.pageStore.checkIfEmpty()).to.be.false;
        expect(seenTabIds).to.have.property('size', 1);
        const tabId = seenTabIds.values().next().value;
        const tab = reporter.pageStore.findPageForTab(tabId);
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
        await reporter.pageStore.flush();
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
        await reporter.pageStore.flush();
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
        // The ping fires from the first document (path "/") during
        // navigation to the second (path "/result"), so correct
        // documentId attribution puts ping.localhost on the source
        // page's tp_events. The `next` page, if it emits at all,
        // must not carry the ping. We collect tp_events across the
        // whole run because the source page is held at nav time and
        // its timer fires inside the first runToLast — earlier than
        // a `.once('send')` listener set up after it would catch.
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
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await reporter.pageStore.flush();
        await clock.runToLast();
        const sourcePathHash = truncatedHash('/');
        const successorPathHash = truncatedHash('/result');
        const sourceEvent = events.find(
          (e) => e.payload.data[0].path === sourcePathHash,
        );
        const successorEvent = events.find(
          (e) => e.payload.data[0].path === successorPathHash,
        );
        expect(sourceEvent, 'source page tp_events must fire').to.exist;
        expect(Object.keys(sourceEvent.payload.data[0].tps)).to.include(
          'ping.localhost',
        );
        // The /result page has no third parties of its own; if it
        // emits at all, it must not carry the source's ping.
        if (successorEvent) {
          expect(
            Object.keys(successorEvent.payload.data[0].tps),
          ).to.not.include('ping.localhost');
        }
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
        await reporter.pageStore.flush();
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
        const tab = reporter.pageStore.findPageForTab(tabId);
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
        const tab = reporter.pageStore.findPageForTab(visibleTabId);
        expect(tab.requestStats).to.be.empty;
      });
    });

    context('0008-navigation', function () {
      it('reports 3rd parties', async function () {
        // Two main-frame navigations on the same tab; each page's
        // trackers should attribute to its own document. With
        // event-driven emission (flush on SW startup / tab close),
        // both pages are emitted together once we flush; we then
        // look them up by their own hostname.
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
        // force stage all pages
        seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
        await reporter.pageStore.flush();
        await clock.runToLast();
        const page1Event = events.find((e) =>
          Object.keys(e.payload.data[0].tps).includes('script1.localhost'),
        );
        const page2Event = events.find((e) =>
          Object.keys(e.payload.data[0].tps).includes('script2.localhost'),
        );
        expect(page1Event, 'page1 tp_events must fire').to.exist;
        expect(page2Event, 'page2 tp_events must fire').to.exist;
        // reports should belong to different pages
        expect(page1Event.payload.data[0].hostname).to.not.be.equal(
          page2Event.payload.data[0].hostname,
        );
      });
    });

    context('0009-beacon', function () {
      // Passes only with document-centric attribution. User searches
      // on search.localhost, clicks through to landing.localhost, and
      // the search document fires two beacons to beacon.localhost
      // (click handler + pagehide). Each beacon webRequest carries
      // the search document's documentId, so correct attribution
      // keeps beacon.localhost on search's tp_events. On main the
      // tabId+previous-chain logic misattributes the beacons to a
      // staged-and-dead page and silently drops them.
      it('attributes late beacon to the source document', async function () {
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
        await reporter.pageStore.flush();
        await clock.runToLast();
        const searchHostnameHash = truncatedHash('search.localhost');
        const landingHostnameHash = truncatedHash('landing.localhost');
        const searchEvent = events.find(
          (e) => e.payload.data[0].hostname === searchHostnameHash,
        );
        const landingEvent = events.find(
          (e) => e.payload.data[0].hostname === landingHostnameHash,
        );
        // The beacon originates in the search document; it must land
        // on that document's tp_events, not on the successor.
        expect(searchEvent, 'search page tp_events must fire').to.exist;
        expect(Object.keys(searchEvent.payload.data[0].tps)).to.include(
          'beacon.localhost',
        );
        if (landingEvent) {
          expect(Object.keys(landingEvent.payload.data[0].tps)).to.not.include(
            'beacon.localhost',
          );
        }
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

      for (const snapshotName of ['0001', '0003', '0005']) {
        it(snapshotName, async function () {
          const messages = [];
          communicationEmitter.addListener('send', (message) =>
            messages.push(cleanupMessage(message)),
          );
          playSnapshotScenario(chrome, snapshotName);

          // run twice to allow token telemetry to trigger. The
          // documentIdPrefix makes the replay look like a fresh
          // session so that documentId-keyed tp_events dedupe
          // doesn't suppress its reports.
          playSnapshotScenario(chrome, snapshotName, {
            rewriteUrls: {
              'onet.pl': 'wp.pl',
              'soundcloud.com': 'google.com',
              'nike.com': 'adidas.com',
            },
            documentIdPrefix: 'replay2-',
          });
          await processRunloopUntil(reporter.tokenTelemetry.NEW_ENTRY_MIN_AGE);

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
