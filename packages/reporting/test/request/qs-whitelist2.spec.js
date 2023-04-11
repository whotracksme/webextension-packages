/*!
 * Copyright (c) 2014-present Cliqz GmbH. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import * as chai from 'chai';
import sinon from 'sinon';
import { sub } from 'date-fns';

import QSWhitelist from '../../src/request/qs-whitelist2';

function testWhitelist(whitelist) {
  chai.expect(whitelist.isTrackerDomain('example.com')).to.be.true;
  chai.expect(whitelist.isTrackerDomain('cliqz.com')).to.be.false;
  chai.expect(whitelist.shouldCheckDomainTokens('facebook.com')).to.be.true;
  chai.expect(whitelist.shouldCheckDomainTokens('cliqz.com')).to.be.false;

  chai.expect(whitelist.isSafeToken('', 'api-key')).to.be.true;
  chai.expect(whitelist.isSafeToken('', '1928x234')).to.be.false;

  chai.expect(whitelist.isSafeKey('facebook.com', ':vp')).to.be.true;
  chai.expect(whitelist.isSafeKey('facebook.com', 'uid')).to.be.false;
}

// source https://stackoverflow.com/a/21797381
function base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

const createFetchMock =
  ({ version, useDiff = false, local = true, cdn = true }) =>
  async (url) => {
    const fail = {
      ok: false,
    };
    if (url.includes('local') && !local) {
      return fail;
    }
    if (url.includes('cdn') && !cdn) {
      return fail;
    }
    return {
      ok: true,
      // for config
      async json() {
        return {
          version,
          useDiff,
        };
      },
      // for bloom filter
      async arrayBuffer() {
        if (url.includes('diff')) {
          return base64ToArrayBuffer('AAAAAgp4yhHUIy5ERA==');
        }
        return base64ToArrayBuffer('AAAAAgrdwUcnN1113w==');
      },
    };
  };

describe('request/qs-whitelist2', function () {
  let whitelist;
  let fetchMock = async () => {};

  beforeEach(async function () {
    sinon.stub(window, 'fetch').callsFake((url) => fetchMock(url));
    whitelist = new QSWhitelist({
      storage: new Map(),
      CDN_BASE_URL: 'https://cdn/',
      LOCAL_BASE_URL: '/local',
    });
  });

  afterEach(() => {
    window.fetch.restore();
    fetchMock = async () => {};
  });

  context('loading', () => {
    afterEach(() => whitelist.destroy());

    it('no local or remote bf', async () => {
      await whitelist.init();
      // bloom filter is an empty one
      chai.expect(whitelist.bloomFilter).to.be.not.null;
      chai.expect(whitelist.isTrackerDomain('example.com')).to.be.false;
    });

    it('local only', async () => {
      const version = '2018-10-08';
      whitelist.networkFetchEnabled = false;
      fetchMock = createFetchMock({ version, cdn: false });
      await whitelist.init();
      chai.expect(whitelist.bloomFilter).to.not.be.null;
      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      testWhitelist(whitelist);
    });

    it('local fallback when CDN fails', async () => {
      const version = '2018-10-08';
      fetchMock = createFetchMock({ version, cdn: false });
      await whitelist.init();
      chai.expect(whitelist.bloomFilter).to.not.be.null;
      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      testWhitelist(whitelist);
    });

    it('full load from remote', async () => {
      const version = '2018-10-08';
      fetchMock = createFetchMock({ version });
      await whitelist.init();
      chai.expect(whitelist.bloomFilter).to.not.be.null;
      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      testWhitelist(whitelist);
    });

    it('persists state for subsequent loads', async () => {
      const version = '2018-10-08';
      fetchMock = createFetchMock({ version });
      await whitelist.init();
      await whitelist.destroy();
      whitelist.bloomFilter = null;
      await whitelist.init();
      chai.expect(whitelist.bloomFilter).to.not.be.null;
      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      testWhitelist(whitelist);
    });

    it('loads diff when available', async () => {
      // do first load
      let version = '2018-10-08';
      fetchMock = createFetchMock({ version });
      await whitelist.init();
      await whitelist.destroy();

      // mock next day with a diff file
      version = '2018-10-09';
      fetchMock = createFetchMock({ version, useDiff: true });

      await whitelist.init();

      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      // all previous entries should be there
      testWhitelist(whitelist);
      // also new ones
      chai.expect(whitelist.isTrackerDomain('example.org')).to.be.true;
      chai.expect(whitelist.shouldCheckDomainTokens('example.org')).to.be.true;
      chai.expect(whitelist.isSafeToken('', '1234567879')).to.be.true;
    });

    it('does not load diff when useDiff is false', async () => {
      // do first load
      let version = '2018-10-08';
      fetchMock = createFetchMock({ version });
      await whitelist.init();
      await whitelist.destroy();

      // mock next day with a diff file
      version = '2018-10-09';
      fetchMock = createFetchMock({ version });
      await whitelist.init();

      chai.expect(whitelist.getVersion()).to.eql({ day: version });
      // all previous entries should be there
      testWhitelist(whitelist);
      // no new ones (because we loaded a fresh version)
      chai.expect(whitelist.isTrackerDomain('example.org')).to.be.false;
      chai.expect(whitelist.shouldCheckDomainTokens('example.org')).to.be.false;
      chai.expect(whitelist.isSafeToken('', '1234567879')).to.be.false;
    });
  });

  context('local safekey', () => {
    beforeEach(async () => {
      const version = '2018-10-08';
      fetchMock = createFetchMock({ version });
      await whitelist.init();
    });

    afterEach(() => {
      return whitelist.destroy();
    });

    it('#addSafeKey adds a safekey for a domain', () => {
      const d = 'example.com';
      const k = 'test';
      chai.expect(whitelist.isSafeKey(d, k)).to.be.false;
      whitelist.addSafeKey(d, k);
      chai.expect(whitelist.isSafeKey(d, k)).to.be.true;
    });

    it('#cleanLocalSafekey removes safekeys after 7 days', () => {
      const d = 'example.com';
      const k = 'test';

      const clock = sinon.useFakeTimers(sub(new Date(), { days: 8 }));

      whitelist.addSafeKey(d, k);
      whitelist._cleanLocalSafekey();

      clock.restore();

      chai.expect(whitelist.isSafeKey(d, k)).to.be.true;
      whitelist._cleanLocalSafekey();
      chai.expect(whitelist.isSafeKey(d, k)).to.be.false;
    });

    it('localSafekeys are persisted', async () => {
      const d = 'example.com';
      const k = 'test';
      whitelist.addSafeKey(d, k);
      await whitelist.destroy();
      whitelist.localSafeKey = {};
      await whitelist.init();
      chai.expect(whitelist.isSafeKey(d, k)).to.be.true;
    });
  });
});
