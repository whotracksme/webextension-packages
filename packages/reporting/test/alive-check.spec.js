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

import AliveCheck from '../src/alive-check.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('#AliveCheck', function () {
  const storageKey = 'some-storage-key';
  let trustedClock;
  let communication;
  let countryProvider;
  let storage;
  let uut;

  function newAliveCheck() {
    return new AliveCheck({
      communication,
      countryProvider,
      trustedClock,
      storage,
      storageKey,
    });
  }

  // Helper that simulate an event like a restart of the service worker/background script:
  // it keeps the storage but purges everything that was in memory.
  async function simulateRestart() {
    uut = newAliveCheck();
  }

  function expectNoMessageSent() {
    expect(communication._message).to.be.an('array').that.is.empty;
    communication._message.length = 0;
  }

  function expectOneMessageSent() {
    expect(communication._message).to.be.an('array').that.has.lengthOf(1);
    communication._message.length = 0;
  }

  function numMessagesSent() {
    const count = communication._message.length;
    communication._message.length = 0;
    return count;
  }

  beforeEach(() => {
    trustedClock = {
      getTimeAsYYYYMMDDHH: () => '<some timestamp>',
    };
    communication = {
      _message: [],
      async send(msg) {
        this._message.push(msg);
      },
    };
    countryProvider = {
      getSafeCountryCode: () => 'de',
    };
    storage = {
      async get(key) {
        expect(key).to.equal(storageKey);
        return this._content;
      },
      async set(key, obj) {
        expect(key).to.equal(storageKey);
        this._content = obj;
      },
    };
    uut = newAliveCheck();
  });

  describe('on a fresh extension installation', function () {
    it('should not immediately send a message', async () => {
      await uut._check();
      expectNoMessageSent();
    });

    it('should eventually send a message (after more then one hour of activity)', async () => {
      let now = Date.now();
      for (let i = 0; i < 90; i += 1) {
        await uut._check(now);
        now += 1 * MINUTE;
      }
      expectOneMessageSent();
    });

    it('should not send more then one message per hour', async () => {
      let now = Date.now();
      for (let i = 0; i < DAY; i += MINUTE) {
        if (i % 7 === 0) {
          await simulateRestart();
        }
        await uut._check(now);
        now += 1 * MINUTE;
      }
      // underspecify what should happen on the first day
      expect(numMessagesSent()).to.be.within(22, 24);

      // if we repeat (now the effect of the initial installation is gone),
      // the semantic is clear: one message per hour over one day -> 24 messages
      for (let i = 0; i < DAY; i += MINUTE) {
        if (i % 7 === 0) {
          await simulateRestart();
        }
        await uut._check(now);
        now += 1 * MINUTE;
      }
      expect(numMessagesSent()).to.eql(24);
    });
  });

  describe('when multiple check happens at the same time', function () {
    it('should not result in multiple messages', async () => {
      let now = Date.now();
      for (let i = 0; i < DAY; i += MINUTE) {
        await Promise.all([
          uut._check(now),
          uut._check(now),
          uut._check(now),
          uut._check(now),
        ]);
        expect(numMessagesSent()).to.be.at.most(1);
        now += MINUTE;
      }
    });
  });
});
