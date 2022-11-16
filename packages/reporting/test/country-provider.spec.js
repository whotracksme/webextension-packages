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

import CountryProvider from '../src/country-provider.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Some big value which should be large enough to
// make sure all cooldowns have expired.
const SKIP_ALL_COOLDOWNS = WEEK;

describe('#CountryProvider', function () {
  const storageKey = 'some-storage-key';
  const apiEndpoint = 'https://some-endpoint.test';
  let uut;
  let config;
  let storage;
  let fetchMock;

  function mockApi() {
    const mock = async (url) => {
      expect(url).to.eql(apiEndpoint);
      mock.numRequests += 1;
      return fetchMock.response();
    };
    mock.response = () => new Error('Not configured');
    mock.numRequests = 0;
    return mock;
  }

  function assumeApiReturns(ctry) {
    fetchMock.response = async () => ({
      ok: true,
      async json() {
        return {
          location: ctry,
          'location.city': '--',
          ts: '20221108',
        };
      },
    });
  }

  function assumeApiIsDown() {
    mockApi(async () => ({
      ok: false,
      statusText: 'Stub server has been configured to fail (this is expected).',
    }));
  }

  function newCountryProvider() {
    return new CountryProvider({
      config,
      storage,
      storageKey,
    });
  }

  // Helper that simulate an event like a restart of the service worker/background script:
  // it keeps the storage but purges everything that was in memory.
  async function simulateRestart() {
    uut = newCountryProvider();
  }

  function expectCountryToBe(expectedCountry) {
    expect(uut.getSafeCountryCode({ skipUpdate: true })).to.eql(
      expectedCountry,
    );
  }

  beforeEach(() => {
    config = {
      CONFIG_URL: apiEndpoint,
      ALLOWED_COUNTRY_CODES: ['us', 'de', 'fr'],
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
    fetchMock = mockApi();
    sinon.stub(window, 'fetch').callsFake(fetchMock);
    uut = newCountryProvider();
  });

  afterEach(() => {
    window.fetch.restore();
    config = null;
    storage = null;
    fetchMock = null;
    uut = null;
  });

  describe('on a fresh extension installation', function () {
    it('should ask the API for the country', async function () {
      assumeApiReturns('de');
      expect(fetchMock.numRequests).to.eql(0);
      await uut.init();
      expect(fetchMock.numRequests).to.eql(1);
      expectCountryToBe('de');
    });

    it('should fallback to "--" if the API is down', async function () {
      assumeApiIsDown();
      await uut.init();
      expect(fetchMock.numRequests).to.be.greaterThan(0);
      expectCountryToBe('--');
    });

    it('should fallback to "--" if the country is not in the client allow-list', async function () {
      expect(config.ALLOWED_COUNTRY_CODES).to.not.include('aq');
      assumeApiReturns('aq');
      await uut.init();
      expectCountryToBe('--');
    });

    for (const invalidInput of [
      'ÄÄ',
      '',
      '1234567890',
      {},
      '{}',
      ['foo', 'bar'],
    ]) {
      const str = JSON.stringify(invalidInput);

      describe(`when the API returns the invalid country=<<${str}>>`, function () {
        it('should fallback to "--" if the API returns an unexpected country', async function () {
          assumeApiReturns(invalidInput);
          await uut.init();
          expectCountryToBe('--');
        });
      });
    }

    describe('if the network is initially down', function () {
      it('should be able to update successfully when the network is back', async function () {
        assumeApiIsDown();
        await uut.init();
        expectCountryToBe('--');

        let failed = false;
        await uut.update({ force: true }).catch(() => (failed = true));
        expect(failed).to.eql(true);
        expectCountryToBe('--');

        assumeApiReturns('de');
        await uut.update({ force: true });
        expectCountryToBe('de');
      });

      it('should later automatically update when network is back', async function () {
        let now = Date.now();
        assumeApiIsDown();
        await uut.init({ now });
        expectCountryToBe('--');

        // try unsuccessfully for one hour
        for (let i = 0; i < 60; i += 1) {
          now += 1 * MINUTE;
          expect(uut._pendingUpdate).to.not.exist;
          expect(uut.getSafeCountryCode({ now })).to.eql('--');
          if (uut._pendingUpdate) {
            await uut._pendingUpdate.catch(() => {});
            expect(uut._pendingUpdate).to.not.exist;
          }
        }
        expect(fetchMock.numRequests)
          .to.be.greaterThan(3)
          .and.to.be.lessThan(20);

        // network is back
        assumeApiReturns('de');
        fetchMock.numRequests = 0;

        // try for the rest of the day
        for (let i = 0; i < 23 * 60; i += 1) {
          now += 1 * MINUTE;
          expect(uut._pendingUpdate).to.not.exist;
          const ctry = uut.getSafeCountryCode({ now });
          if (ctry === 'de') {
            expect(fetchMock.numRequests).to.eql(1);
            return; // PASSED
          }

          expect(ctry).to.eql('--');
          if (uut._pendingUpdate) {
            await uut._pendingUpdate.catch(() => {});
            expect(uut._pendingUpdate).to.not.exist;
          }
        }
        expect.fail(
          'Failed to update within one day, even though it would have worked after one hour',
        );
      });
    });
  });

  describe('when restarting the extension', function () {
    const oldValue = 'us';
    const newValue = 'de';
    let lastStart;

    beforeEach(async () => {
      assumeApiReturns(oldValue);
      lastStart = Date.now();

      expect(fetchMock.numRequests).to.eql(0);
      await uut.init({ now: lastStart });
      expect(fetchMock.numRequests).to.eql(1);
      expectCountryToBe(oldValue);

      fetchMock.numRequests = 0;
      await simulateRestart();
      assumeApiReturns(newValue);
    });

    it('should not immediately fetch the country information', async function () {
      expect(fetchMock.numRequests).to.eql(0);
      expect(uut._pendingUpdate).to.not.exist;
      await uut.init({ now: lastStart + 2 * SECOND });

      expect(uut._pendingUpdate).to.not.exist;
      expect(fetchMock.numRequests).to.eql(0);
      expect(uut.getSafeCountryCode({ skipUpdate: true })).to.eql(oldValue);
    });

    it('should trigger a background update if the country information is too old', async function () {
      expect(fetchMock.numRequests).to.eql(0);
      expect(uut._pendingUpdate).to.not.exist;
      await uut.init({ now: lastStart + SKIP_ALL_COOLDOWNS });

      // wait for the background update to finish
      const pending = uut._pendingUpdate;
      expect(pending).to.exist;
      await pending;

      expect(uut._pendingUpdate).to.not.exist;
      expect(fetchMock.numRequests).to.eql(1);
      expectCountryToBe(newValue);
    });
  });
});
