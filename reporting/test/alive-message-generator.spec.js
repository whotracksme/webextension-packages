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

import AliveMessageGenerator from '../src/alive-message-generator.js';

describe('#AliveMessageGenerator', function () {
  const someHour = '2024030803';
  const anotherHour = '2024030804';

  const storageKey = 'some-storage-key';
  let browserInfoProvider;
  let navigatorApi;
  let quorumChecker;
  let storage;
  let uut;

  let _browserInfo;
  let _shouldPassQuorum;

  function newAliveMessageGenerator() {
    return new AliveMessageGenerator({
      browserInfoProvider,
      navigatorApi,
      quorumChecker,
      storage,
      storageKey,
    });
  }

  // Helper that simulate an event like a restart of the service worker/background script:
  // it keeps the storage but purges everything that was in memory.
  async function simulateRestart() {
    uut = newAliveMessageGenerator();
  }

  function assumeQuorumReached(value = true) {
    _shouldPassQuorum = value;
  }

  function assumeQuorumNotReached() {
    assumeQuorumReached(false);
  }

  beforeEach(() => {
    _browserInfo = {
      browser: 'Firefox',
      version: '122',
      os: 'Linux',
      language: 'en-US',
    };
    navigatorApi = {
      language: 'en-US',
    };
    browserInfoProvider = async () => _browserInfo;

    quorumChecker = {
      _incCalls: 0,
      _getCalls: 0,

      async sendQuorumIncrement({ text }) {
        this._incCalls += 1;
        expect(text).to.be.a('string');
      },
      async checkQuorumConsent({ text }) {
        this._getCalls += 1;
        expect(text).to.be.a('string');
        return _shouldPassQuorum;
      },
    };
    assumeQuorumReached();

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
    uut = newAliveMessageGenerator();
  });

  function runGenericTests() {
    it('should only check once for quorum if the config is the same', async function () {
      expect(quorumChecker._incCalls).to.eql(0);
      expect(quorumChecker._getCalls).to.eql(0);
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);
    });

    it('should only check again for quorum if the config changed', async function () {
      expect(quorumChecker._incCalls).to.eql(0);
      expect(quorumChecker._getCalls).to.eql(0);
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);
      await uut.generateMessage('us', someHour);
      expect(quorumChecker._incCalls).to.eql(2);
      expect(quorumChecker._getCalls).to.eql(2);
      await uut.generateMessage('fr', someHour);
      expect(quorumChecker._incCalls).to.eql(3);
      expect(quorumChecker._getCalls).to.eql(3);
    });

    it('should only check again for quorum if the config changed', async function () {
      expect(quorumChecker._incCalls).to.eql(0);
      expect(quorumChecker._getCalls).to.eql(0);
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);
      await uut.generateMessage('de', anotherHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);
    });

    it('should not check quorum again after an extension restart', async function () {
      expect(quorumChecker._incCalls).to.eql(0);
      expect(quorumChecker._getCalls).to.eql(0);
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);

      simulateRestart();
      await uut.generateMessage('de', someHour);
      expect(quorumChecker._incCalls).to.eql(1);
      expect(quorumChecker._getCalls).to.eql(1);

      // unless the config changes
      simulateRestart();
      await uut.generateMessage('us', someHour);
      expect(quorumChecker._incCalls).to.eql(2);
      expect(quorumChecker._getCalls).to.eql(2);
    });
  }

  describe('if quorum is reached', function () {
    beforeEach(assumeQuorumReached);
    runGenericTests();

    it('should share the config', async function () {
      _browserInfo = {
        browser: 'Firefox',
        version: '122.1',
        os: 'Linux',
        language: 'en-US',
      };
      navigatorApi.language = 'de-DE';

      const message = await uut.generateMessage('de', '2024010203');
      expect(message).to.eql({
        browser: 'Firefox',
        version: '122', // only major version
        os: 'Linux',
        language: 'de-DE', // from window.navigator
        ctry: 'de',
        t: '2024010203',
      });
    });
  });

  describe('if quorum is not reached', function () {
    beforeEach(assumeQuorumNotReached);
    runGenericTests();

    it('should not share the config', async function () {
      const message = await uut.generateMessage('de', '2024010203');
      expect(message).to.eql({
        browser: '',
        version: '',
        os: '',
        language: '',
        ctry: '--',
        t: '2024010203',
      });
    });
  });
});
