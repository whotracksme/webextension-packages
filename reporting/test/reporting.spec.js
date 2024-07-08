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

function waitForPromisesToFinish() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('#Reporting', function () {
  let uut;

  beforeEach(async function () {
    const config = {
      ALLOWED_COUNTRY_CODES: ['us', 'de'],
      PATTERNS_URL: 'https://some-patterns-endpoint.test',
      CONFIG_URL: 'https://some-config-endpoint.test',
    };
    const storage = {
      get: () => undefined, // assume nothing was stored yet
      flush: () => {},
    };
    const communication = {
      async send() {},
      trustedClock: {},
    };
    const connectDatabase = () => {};
    sinon.stub(window, 'fetch').callsFake(async (url) => ({
      ok: false,
      statusText: `Stub server has been configured to fail (this is expected): request to ${url}`,
    }));
    uut = new Reporting({
      config,
      storage,
      communication,
      connectDatabase,
      browserInfoProvider: async () => ({ browser: 'test' }),
    });
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
});
