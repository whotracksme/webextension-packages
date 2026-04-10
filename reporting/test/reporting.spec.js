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

import { expect } from 'chai';
import sinon from 'sinon';

import Reporting from '../src/reporting.js';
import PausedDomainsReporter from '../src/paused-domains-reporter.js';

import InMemoryDatabase from './helpers/in-memory-database.js';

function waitForPromisesToFinish() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('#Reporting', function () {
  let uut;

  function buildReporting({ pauseState } = {}) {
    const config = {
      ALLOWED_COUNTRY_CODES: ['us', 'de'],
      PATTERNS_URL: 'https://some-patterns-endpoint.test',
      CONFIG_URL: 'https://some-config-endpoint.test',
    };
    const storage = {
      get: async () => undefined, // assume nothing was stored yet
    };
    const communication = {
      async send() {},
      trustedClock: {},
    };
    const connectDatabase = (/*prefix*/) => new InMemoryDatabase();
    sinon.stub(window, 'fetch').callsFake(async (url) => ({
      ok: false,
      statusText: `Stub server has been configured to fail (this is expected): request to ${url}`,
    }));
    return new Reporting({
      config,
      storage,
      communication,
      connectDatabase,
      pauseState,
    });
  }

  for (const withPauseState of [true, false]) {
    describe(
      withPauseState
        ? '"pauseState" config present'
        : '"pauseState" config absent',

      function () {
        beforeEach(async function () {
          const pauseState = withPauseState
            ? {
                getFilteringMode: () => 'default',
                isHostnamePaused: (/*hostname*/) => false,
                connectHostnamePausingEvents: (/*notify*/) => {},
              }
            : undefined;
          uut = buildReporting({ pauseState });
        });

        afterEach(function () {
          try {
            uut.unload();
            uut = null;
          } finally {
            window.fetch.restore();
          }
        });

        describe('should load and unload correctly', function () {
          it('happy path', async () => {
            expect(uut.isActive).to.be.false;
            await uut.init();
            expect(uut.isActive).to.be.true;
            uut.unload();
            expect(uut.isActive).to.be.false;
          });

          it('multiple inits should be OK', async () => {
            await Promise.all([uut.init(), uut.init(), uut.init()]);
            expect(uut.isActive).to.be.true;
          });

          it('multiple unloads should be OK', async () => {
            uut.unload();
            uut.unload();
            uut.unload();
            expect(uut.isActive).to.be.false;
          });

          it('multiple mixed init/unloads should be OK', async () => {
            const pending = [];
            pending.push(uut.init());
            pending.push(uut.init());
            pending.push(uut.init());

            uut.unload();
            expect(uut.isActive).to.be.false;

            pending.push(uut.init());
            uut.unload();
            expect(uut.isActive).to.be.false;

            uut.unload();
            expect(uut.isActive).to.be.false;

            await Promise.all(pending);
            uut.unload();
            expect(uut.isActive).to.be.false;

            await uut.init();
            expect(uut.isActive).to.be.true;

            uut.unload();
            expect(uut.isActive).to.be.false;
          });

          describe('should make ensure that "unload" at the end always wins', () => {
            it('when calling init once', async () => {
              const pending = uut.init();
              uut.unload();
              expect(uut.isActive).to.be.false;

              await pending;
              await waitForPromisesToFinish();
              expect(uut.isActive).to.be.false;
            });

            it('when calling init multiple times', async () => {
              const pending = [];
              pending.push(uut.init());
              pending.push(uut.init());
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;

              await Promise.all(pending);
              await waitForPromisesToFinish();
              expect(uut.isActive).to.be.false;

              // and addition unload operations should not change anything
              uut.unload();
              expect(uut.isActive).to.be.false;
              uut.unload();
              uut.unload();
              expect(uut.isActive).to.be.false;
            });

            it('when calling unload multiple times', async () => {
              const pending = [];
              pending.push(uut.init());
              pending.push(uut.init());
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;
              uut.unload();
              expect(uut.isActive).to.be.false;

              await Promise.all(pending);
              await waitForPromisesToFinish();
              expect(uut.isActive).to.be.false;

              // and addition unload operations should not change anything
              uut.unload();
              expect(uut.isActive).to.be.false;
              uut.unload();
              uut.unload();
              expect(uut.isActive).to.be.false;
            });
          });

          describe('should make ensure that "init" at the end always wins', () => {
            it('in a simple example', async () => {
              const pending = [];
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;
              pending.push(uut.init());

              await Promise.all([pending]);
              await waitForPromisesToFinish();
              expect(uut.isActive).to.be.true;
            });

            it('in a complex example', async () => {
              const pending = [];
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;
              pending.push(uut.init());
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;
              pending.push(uut.init());
              pending.push(uut.init());
              uut.unload();
              expect(uut.isActive).to.be.false;
              uut.unload();
              expect(uut.isActive).to.be.false;
              pending.push(uut.init());

              await Promise.all([pending]);
              await waitForPromisesToFinish();
              expect(uut.isActive).to.be.true;

              await uut.init();
              expect(uut.isActive).to.be.true;

              await uut.init();
              expect(uut.isActive).to.be.true;
            });
          });
        });
      },
    );
  }

  describe('hostname pause events', function () {
    let pauseNotify;
    let onPauseEvent;

    beforeEach(function () {
      // Reporting binds onPauseEvent at construction time, so the spy must
      // be installed on the prototype *before* the instance is built.
      onPauseEvent = sinon.spy(PausedDomainsReporter.prototype, 'onPauseEvent');

      pauseNotify = null;
      const pauseState = {
        getFilteringMode: () => 'default',
        isHostnamePaused: () => false,
        connectHostnamePausingEvents: (notify) => {
          pauseNotify = notify;
        },
      };
      uut = buildReporting({ pauseState });
    });

    afterEach(function () {
      try {
        uut.unload();
        uut = null;
      } finally {
        onPauseEvent.restore();
        window.fetch.restore();
      }
    });

    it('forwards incoming pause events to PausedDomainsReporter', async () => {
      await uut.init();
      expect(
        pauseNotify,
        'pauseState.connectHostnamePausingEvents was never called',
      ).to.be.a('function');

      pauseNotify({ hostname: 'example.com', paused: true });

      expect(onPauseEvent.calledOnce).to.be.true;
      expect(onPauseEvent.firstCall.args[0]).to.deep.include({
        hostname: 'example.com',
        paused: true,
      });
    });

    it('does not forward pause events before init or after unload', async () => {
      // Before init: notify is wired up at construction, but the
      // observer body is gated on isActive.
      pauseNotify({ hostname: 'example.com', paused: true });
      expect(
        onPauseEvent.called,
        'pause event leaked through before init',
      ).to.be.false;

      await uut.init();
      uut.unload();

      pauseNotify({ hostname: 'example.com', paused: false });
      expect(
        onPauseEvent.called,
        'pause event leaked through after unload',
      ).to.be.false;
    });

    it('rejects malformed pause events', async () => {
      await uut.init();

      expect(() =>
        pauseNotify({ hostname: 123, paused: true }),
      ).to.throw(/hostname/);
      expect(() =>
        pauseNotify({ hostname: 'example.com', paused: 'yes' }),
      ).to.throw(/paused/);
      expect(() => pauseNotify({})).to.throw();

      expect(onPauseEvent.called).to.be.false;
    });
  });
});
