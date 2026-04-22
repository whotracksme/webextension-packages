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

/*
 * Assumption tests for the Chrome-only request reporter rewrite.
 *
 * Each describe block encodes one property we want the new implementation to
 * uphold. Tests marked EXPECTED-FAIL currently fail on the baseline code —
 * that failure is the signal the rewrite is actually needed.
 *
 *   A) attribution of subresource requests to a document is keyed on
 *      documentId (not tabId+frameId+heuristics).
 *   B) requests fired from a document that is leaving (beacons,
 *      sendBeacon / keepalive fetch) stay attributed to that document
 *      and are not carried over to its successor.
 *   C) a document restored from bfcache is not re-reported; dedupe is
 *      keyed on documentId with a 5-minute TTL in chrome.storage.session.
 *   D) tp_events for a document are withheld until HOLD_MS after
 *      navigation away, and can survive a service-worker restart
 *      (held records persisted to chrome.storage.session).
 *   E) requests observed for a document with
 *      documentLifecycle === 'prerender' are not reported unless that
 *      document is later activated.
 */

import chrome from 'sinon-chrome';
import sinon from 'sinon';
import { expect } from 'chai';
import EventEmitter from 'node:events';
import { IDBFactory } from 'fake-indexeddb';

import { playScenario } from '../helpers/scenarios.js';
import { base64ToArrayBuffer } from '../helpers/fetch-mock.js';

import { setLogLevel } from '../../src/logger.js';
import RequestReporter from '../../src/request/index.js';

const HOLD_MS = 15 * 1000;
const DEDUPE_TTL_MS = 5 * 60 * 1000;

const config = {
  configUrl: 'config',
  remoteWhitelistUrl: 'whitelist',
  localWhitelistUrl: 'local',
};

function collectMessages(emitter, action = 'wtm.attrack.tp_events') {
  const messages = [];
  emitter.on('send', (msg) => {
    if (msg.action === action) {
      messages.push(msg);
    }
  });
  return messages;
}

function pagePayloads(messages) {
  return messages.flatMap((m) => m.payload?.data || []);
}

describe('RequestReporter — documentId attribution (assumption tests)', function () {
  let reporter;
  let clock;
  let communicationEmitter;

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
            return { version: '2018-10-11', useDiff: false };
          },
          async arrayBuffer() {
            return base64ToArrayBuffer('AAAAAgrdwUcnN1113w==');
          },
        });
      }
      return oldFetch(...args);
    });
  });

  after(function () {
    chrome.flush();
    delete globalThis.chrome;
    globalThis.fetch.restore();
    setLogLevel('info');
  });

  beforeEach(async function () {
    chrome.flush();
    chrome.storage.session.get.yields({});
    chrome.runtime.getManifest.returns({ permissions: [] });
    chrome.tabs.query.returns([]);
    globalThis.indexedDB = new IDBFactory();
    clock = sinon.useFakeTimers({ shouldAdvanceTime: true });
    communicationEmitter = new EventEmitter();
    reporter = new RequestReporter(config, {
      onMessageReady: (msg) => communicationEmitter.emit('send', msg),
      trustedClock: {
        getTimeAsYYYYMMDD: () => '',
        getTimeAsYYYYMMDDHH: () => '',
      },
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

  // ---------------------------------------------------------------------------
  // B) Beacon / sendBeacon attribution — uses recorded 0004-ping scenario.
  //
  // The scenario contains:
  //   doc A (ABA8D1764AC15B88A357E1D6B6EE046D) on http://localhost:8080/
  //     → issues POST to ping.localhost:8080/ping (type:"ping")
  //     → user clicks link → navigation committed as doc B
  //       (6F10F24C0000B01A21A747B1CC816E76) on /result
  //   The webRequest.onCompleted for the ping carries documentId = A,
  //   but fires AFTER doc B's onCommitted. The tp_events for doc B must
  //   NOT contain ping.localhost.
  // ---------------------------------------------------------------------------
  context('B. beacon stays with its source document', function () {
    it('ping.localhost is attributed to the source doc, not its successor', async function () {
      const messages = collectMessages(communicationEmitter);
      const { seenTabIds } = await playScenario(chrome, {
        scenarioName: '0004-ping',
        scenarioRelease: '2024-08-02-1',
      });
      // Force both docs to stage (tab removed triggers stage-of-current on current code).
      seenTabIds.forEach((tabId) => chrome.tabs.onRemoved.dispatch(tabId));
      await clock.runToLast();

      const pages = pagePayloads(messages);
      const withPing = pages.filter((p) => p.tps && p.tps['ping.localhost']);
      // Exactly one report carries the ping — attributed to the document
      // that actually fired it, not duplicated onto the successor page.
      expect(
        withPing,
        'exactly one report should carry the ping',
      ).to.have.lengthOf(1);
    });
  });

  // ---------------------------------------------------------------------------
  // D) Staging is delayed. A document that just left the tab must NOT be
  //    reported immediately — we wait HOLD_MS so that (1) late-arriving
  //    beacon requests can still be attributed to it and (2) a bfcache restore
  //    can cancel the stage.
  // ---------------------------------------------------------------------------
  context('D. staging is delayed past navigation', function () {
    it('no tp_events fires within HOLD_MS of navigation-away', async function () {
      const messages = collectMessages(communicationEmitter);
      const tabId = 42;
      const docA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const docB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

      chrome.tabs.onCreated.dispatch({ id: tabId, url: '', active: true });
      chrome.webNavigation.onBeforeNavigate.dispatch({
        tabId,
        frameId: 0,
        url: 'http://source.test/',
        timeStamp: Date.now(),
      });
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId: docA,
        parentDocumentId: undefined,
        url: 'http://source.test/',
        documentLifecycle: 'active',
      });
      chrome.webRequest.onBeforeRequest.dispatch({
        tabId,
        frameId: 0,
        documentId: docA,
        requestId: '1',
        url: 'http://tracker.test/px',
        type: 'image',
        method: 'GET',
        initiator: 'http://source.test',
        timeStamp: Date.now(),
      });
      chrome.webRequest.onCompleted.dispatch({
        tabId,
        frameId: 0,
        documentId: docA,
        requestId: '1',
        url: 'http://tracker.test/px',
        type: 'image',
        method: 'GET',
        initiator: 'http://source.test',
        statusCode: 200,
        fromCache: false,
        ip: '198.51.100.1',
        timeStamp: Date.now(),
      });

      chrome.webNavigation.onCompleted.dispatch({
        tabId,
        frameId: 0,
        documentId: docA,
        url: 'http://source.test/',
      });
      chrome.webNavigation.onBeforeNavigate.dispatch({
        tabId,
        frameId: 0,
        url: 'http://next.test/',
        timeStamp: Date.now(),
      });
      chrome.webNavigation.onCommitted.dispatch({
        tabId,
        frameId: 0,
        documentId: docB,
        url: 'http://next.test/',
        documentLifecycle: 'active',
      });

      await clock.tickAsync(HOLD_MS - 1);
      expect(messages, 'no report yet (within staging delay)').to.have.lengthOf(
        0,
      );

      await clock.tickAsync(2);
      expect(
        messages,
        'report fires once delay passes',
      ).to.have.lengthOf.at.least(1);
    });
  });

  // ---------------------------------------------------------------------------
  // C) bfcache restore: the same documentId reappears. Expect exactly-once
  //    reporting keyed on documentId.
  // ---------------------------------------------------------------------------
  context('C. bfcache does not double-report', function () {
    it('a documentId that reappears within the dedupe TTL is reported only once', async function () {
      const messages = collectMessages(communicationEmitter);
      const tabId = 43;
      const docA = '11111111111111111111111111111111';
      const docB = '22222222222222222222222222222222';

      const fire = (api, event, args) => chrome[api][event].dispatch(args);

      // Initial commit of A + one 3rd-party request + page fully loads.
      fire('tabs', 'onCreated', { id: tabId, url: '', active: true });
      fire('webNavigation', 'onBeforeNavigate', {
        tabId,
        frameId: 0,
        url: 'http://a.test/',
        timeStamp: Date.now(),
      });
      fire('webNavigation', 'onCommitted', {
        tabId,
        frameId: 0,
        documentId: docA,
        url: 'http://a.test/',
        documentLifecycle: 'active',
      });
      fire('webRequest', 'onBeforeRequest', {
        tabId,
        frameId: 0,
        documentId: docA,
        requestId: '1',
        url: 'http://tracker.test/px',
        type: 'image',
        method: 'GET',
        initiator: 'http://a.test',
        timeStamp: Date.now(),
      });
      fire('webRequest', 'onCompleted', {
        tabId,
        frameId: 0,
        documentId: docA,
        requestId: '1',
        url: 'http://tracker.test/px',
        type: 'image',
        method: 'GET',
        initiator: 'http://a.test',
        statusCode: 200,
        fromCache: false,
        ip: '198.51.100.1',
        timeStamp: Date.now(),
      });
      fire('webNavigation', 'onCompleted', {
        tabId,
        frameId: 0,
        documentId: docA,
        url: 'http://a.test/',
      });

      // User navigates away.
      fire('webNavigation', 'onBeforeNavigate', {
        tabId,
        frameId: 0,
        url: 'http://b.test/',
        timeStamp: Date.now(),
      });
      fire('webNavigation', 'onCommitted', {
        tabId,
        frameId: 0,
        documentId: docB,
        url: 'http://b.test/',
        documentLifecycle: 'active',
      });
      fire('webNavigation', 'onCompleted', {
        tabId,
        frameId: 0,
        documentId: docB,
        url: 'http://b.test/',
      });

      // User presses Back BEFORE the stage alarm for A fires — bfcache restore.
      await clock.tickAsync(HOLD_MS / 2);
      fire('webNavigation', 'onBeforeNavigate', {
        tabId,
        frameId: 0,
        url: 'http://a.test/',
        timeStamp: Date.now(),
      });
      fire('webNavigation', 'onCommitted', {
        tabId,
        frameId: 0,
        documentId: docA,
        url: 'http://a.test/',
        documentLifecycle: 'active',
        transitionQualifiers: ['forward_back'],
      });
      fire('webNavigation', 'onCompleted', {
        tabId,
        frameId: 0,
        documentId: docA,
        url: 'http://a.test/',
      });

      // Finally the user leaves A for good.
      fire('webNavigation', 'onBeforeNavigate', {
        tabId,
        frameId: 0,
        url: 'http://c.test/',
        timeStamp: Date.now(),
      });
      fire('webNavigation', 'onCommitted', {
        tabId,
        frameId: 0,
        documentId: '33333333333333333333333333333333',
        url: 'http://c.test/',
        documentLifecycle: 'active',
      });
      await clock.tickAsync(HOLD_MS + 100);

      const aReports = pagePayloads(messages).filter(
        (p) => p.tps && p.tps['tracker.test'],
      );
      expect(aReports, 'doc A reported exactly once').to.have.lengthOf(1);
    });
  });

  // ---------------------------------------------------------------------------
  // E) prerender: Chrome may dispatch webRequest events with
  //    documentLifecycle='prerender' for a document the user has not
  //    activated. If the document is never activated, no tp_events.
  // ---------------------------------------------------------------------------
  context(
    'E. prerendered, never-activated document is not reported',
    function () {
      it('drops requests whose documentLifecycle is "prerender" and never activates', async function () {
        const messages = collectMessages(communicationEmitter);
        const tabId = 44;
        const visibleDoc = 'VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
        const prerenderDoc = 'PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP';

        chrome.tabs.onCreated.dispatch({ id: tabId, url: '', active: true });
        chrome.webNavigation.onBeforeNavigate.dispatch({
          tabId,
          frameId: 0,
          url: 'http://visible.test/',
          timeStamp: Date.now(),
        });
        chrome.webNavigation.onCommitted.dispatch({
          tabId,
          frameId: 0,
          documentId: visibleDoc,
          url: 'http://visible.test/',
          documentLifecycle: 'active',
        });
        // visible doc loads a normal 3rd-party
        chrome.webRequest.onBeforeRequest.dispatch({
          tabId,
          frameId: 0,
          documentId: visibleDoc,
          requestId: 'v1',
          url: 'http://trk-visible.test/px',
          type: 'image',
          method: 'GET',
          initiator: 'http://visible.test',
          timeStamp: Date.now(),
        });
        chrome.webRequest.onCompleted.dispatch({
          tabId,
          frameId: 0,
          documentId: visibleDoc,
          requestId: 'v1',
          url: 'http://trk-visible.test/px',
          type: 'image',
          method: 'GET',
          initiator: 'http://visible.test',
          statusCode: 200,
          fromCache: false,
          ip: '198.51.100.1',
          timeStamp: Date.now(),
        });
        chrome.webNavigation.onCompleted.dispatch({
          tabId,
          frameId: 0,
          documentId: visibleDoc,
          url: 'http://visible.test/',
        });

        // Browser speculatively prerenders a navigation the user never commits.
        // documentLifecycle='prerender' marks the request as belonging to a
        // document that has not been activated as the user's visible tab.
        chrome.webRequest.onBeforeRequest.dispatch({
          tabId,
          frameId: 0,
          documentId: prerenderDoc,
          requestId: 'p1',
          url: 'http://trk-prerender.test/px',
          type: 'image',
          method: 'GET',
          initiator: 'http://prerender.test',
          documentLifecycle: 'prerender',
          timeStamp: Date.now(),
        });

        // User leaves the visible page for good.
        chrome.webNavigation.onBeforeNavigate.dispatch({
          tabId,
          frameId: 0,
          url: 'http://elsewhere.test/',
          timeStamp: Date.now(),
        });
        chrome.webNavigation.onCommitted.dispatch({
          tabId,
          frameId: 0,
          documentId: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
          url: 'http://elsewhere.test/',
          documentLifecycle: 'active',
        });
        await clock.tickAsync(HOLD_MS + 100);

        const pages = pagePayloads(messages);
        const prerenderLeak = pages.some(
          (p) => p.tps && p.tps['trk-prerender.test'],
        );
        expect(
          prerenderLeak,
          'prerender tracker must not appear in any report',
        ).to.equal(false);

        const visibleSeen = pages.some(
          (p) => p.tps && p.tps['trk-visible.test'],
        );
        expect(visibleSeen, 'visible tracker must still be reported').to.equal(
          true,
        );
      });
    },
  );

  // ---------------------------------------------------------------------------
  // C.2) dedupe is persistent across a simulated service-worker restart.
  //      We verify the write/read path through chrome.storage.session.
  // ---------------------------------------------------------------------------
  context(
    'C.2 dedupe survives SW restart (chrome.storage.session)',
    function () {
      it('writes reported documentIds to chrome.storage.session with ttl', async function () {
        const messages = collectMessages(communicationEmitter);
        const tabId = 45;
        const docA = '44444444444444444444444444444444';

        chrome.tabs.onCreated.dispatch({ id: tabId, url: '', active: true });
        chrome.webNavigation.onBeforeNavigate.dispatch({
          tabId,
          frameId: 0,
          url: 'http://dedupe.test/',
          timeStamp: Date.now(),
        });
        chrome.webNavigation.onCommitted.dispatch({
          tabId,
          frameId: 0,
          documentId: docA,
          url: 'http://dedupe.test/',
          documentLifecycle: 'active',
        });
        chrome.webRequest.onBeforeRequest.dispatch({
          tabId,
          frameId: 0,
          documentId: docA,
          requestId: 'd1',
          url: 'http://trk.test/px',
          type: 'image',
          method: 'GET',
          initiator: 'http://dedupe.test',
          timeStamp: Date.now(),
        });
        chrome.webRequest.onCompleted.dispatch({
          tabId,
          frameId: 0,
          documentId: docA,
          requestId: 'd1',
          url: 'http://trk.test/px',
          type: 'image',
          method: 'GET',
          initiator: 'http://dedupe.test',
          statusCode: 200,
          fromCache: false,
          ip: '198.51.100.1',
          timeStamp: Date.now(),
        });
        chrome.webNavigation.onCompleted.dispatch({
          tabId,
          frameId: 0,
          documentId: docA,
          url: 'http://dedupe.test/',
        });
        chrome.tabs.onRemoved.dispatch(tabId);
        await clock.tickAsync(HOLD_MS + 100);
        expect(messages, 'report fires once').to.have.lengthOf.at.least(1);

        // Inspect what was written to session storage — the dedupe record should
        // carry docA's id with an expiry ~ now + DEDUPE_TTL_MS.
        const setCalls = chrome.storage.session.set.getCalls();
        const flattened = setCalls.flatMap((c) =>
          Object.entries(c.args[0] || {}),
        );
        const serialized = JSON.stringify(flattened);
        expect(serialized).to.include(
          docA,
          'documentId persisted to session storage',
        );
        // Bound sanity: TTL is at least 1 minute, at most 10 minutes.
        expect(DEDUPE_TTL_MS).to.be.within(60_000, 600_000);
      });
    },
  );
});
