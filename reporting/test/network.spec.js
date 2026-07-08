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

import { isLocalIP, DnsResolver } from '../src/network.js';

describe('#isLocalIP', function () {
  describe('it should recognize local IPv6 addresses', async function () {
    for (const ip of [
      '::1',
      'fe80::200:5aee:feaa:20a2',
      'fdf8:f53b:82e4::53',
      'fe80::ab37:fad8:ba64:1df8',
    ]) {
      it(`private IPv6 address: ${ip}`, async function () {
        expect(isLocalIP(ip)).to.be.true;
      });
    }
  });

  describe('it should recognize public IPv6 addresses', async function () {
    for (const ip of [
      '2a00:1450:4001:831::200e',
      '2a03:2880:f177:83:face:b00c:0:25de',
      '2a02:2e0:3fe:1001:302::',
      '2620:0:862:ed1a::1',
      '2001:16b8:2a90:1900:7642:7fff:fecc:b8d8',
    ]) {
      it(`public IPv6 address: ${ip}`, async function () {
        expect(isLocalIP(ip)).to.be.false;
      });
    }
  });

  describe('it should recognize local IPv4 addresses', async function () {
    for (const ip of [
      '127.0.0.1',
      '192.168.2.1',
      '192.168.178.1',
      '10.0.0.0',
      '10.201.29.221',
    ]) {
      it(`private IPv4 address: ${ip}`, async function () {
        expect(isLocalIP(ip)).to.be.true;
      });
    }
  });

  describe('it should recognize public IPv4 addresses', async function () {
    for (const ip of [
      '172.217.23.110',
      '157.240.210.35',
      '13.107.21.200',
      '54.239.28.85',
      '110.242.68.66',
      '91.198.174.192',
    ]) {
      it(`public IPv4 address: ${ip}`, async function () {
        expect(isLocalIP(ip)).to.be.false;
      });
    }
  });
});

describe('DnsResolver', function () {
  let uut;

  beforeEach(function () {
    uut = new DnsResolver();
  });

  describe('#isPrivateHostname', function () {
    describe('must be always detected as private', function () {
      for (const hostname of [
        '127.0.0.1',
        'localhost',
        'homeassistant.local',
        'raspberrypi.local',
        'abc.internal',
        'permanently-removed.invalid',
        'www.nytimesn7cgmftshazwhfgzm37qxb44r64ytbb2dj3x62d2lljsciiyd.onion',
        'foo.test',
        'abc.def.corp',
        'my.foo.lan',
      ]) {
        it(`- ${hostname}`, function () {
          expect(uut.isPrivateHostname(hostname)).to.be.true;
        });
      }
    });

    describe('must be always detected as public', function () {
      for (const hostname of [
        'en.wikipedia.org',
        'www.google.com',
        'www.youtube.com',
      ]) {
        it(`- ${hostname}`, function () {
          expect(uut.isPrivateHostname(hostname)).to.be.false;
        });
      }
    });
  });

  describe('#isPrivateURL', function () {
    it('should classify URLs with non-public suffixes as private', function () {
      expect(uut.isPrivateURL('https://printer.local/status')).to.be.true;
      expect(uut.isPrivateURL('http://db.internal:8080/')).to.be.true;
    });

    it('should not classify ordinary public URLs as private', function () {
      expect(uut.isPrivateURL('https://en.wikipedia.org/')).to.be.false;
    });

    it('should classify unparseable URLs as private', function () {
      expect(uut.isPrivateURL('not-a-url')).to.be.true;
    });
  });
});
