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

import { findSafeCookies } from '../src/doublefetch-unbreak.js';

const URL_ = 'https://www.example.test/search?q=foo';

describe('#findSafeCookies', function () {
  let lookups;
  let jar;
  let originalCookies;

  beforeEach(function () {
    lookups = [];
    jar = {};
    originalCookies = chrome.cookies;
    chrome.cookies = {
      getAll: async (details) => {
        lookups.push(details);
        const value = jar[details.name];
        return value === undefined ? [] : [{ name: details.name, value }];
      },
    };
  });

  afterEach(function () {
    chrome.cookies = originalCookies;
  });

  const collect = (template) =>
    findSafeCookies(URL_, {
      steps: [{ headers: { Cookie: template } }],
    });

  it('should not touch the cookie jar unless asked to', async function () {
    const found = await collect('SOCS=fixed;X={{cookie:foo}}');
    expect(found.size).to.eql(0);
    expect(lookups).to.eql([]);
  });

  it('should look up only what was asked for', async function () {
    jar = { 'aws-waf-token': 'AWS', cf_clearance: 'CF' };
    const found = await collect('t={{safecookie:aws-waf-token}}');
    expect(lookups.map((x) => x.name)).to.eql(['aws-waf-token']);
    expect(found.get('aws-waf-token')).to.eql('AWS');
    expect(found.has('cf_clearance')).to.eql(false);
  });

  it('should refuse cookies that are not on the unbreaking list', async function () {
    jar = { SID: 'secret', sessionid: 'secret' };
    const found = await collect(
      'a={{safecookie:SID}};b={{safecookie:sessionid}}',
    );
    expect(lookups).to.eql([]);
    expect(found.size).to.eql(0);
  });

  it('should scope the lookup to the URL and to its own cookie store', async function () {
    jar = { 'aws-waf-token': 'AWS' };
    await collect('t={{safecookie:aws-waf-token}}');
    expect(lookups).to.have.length(1);
    expect(lookups[0].url).to.eql(URL_);
    // no "storeId" means the extension's own store: not incognito, no container
    expect(lookups[0]).to.not.have.property('storeId');
  });

  it('should skip a cookie that is not set, or that cannot be read', async function () {
    const ask = () => collect('t={{safecookie:aws-waf-token}}');
    expect((await ask()).size).to.eql(0);

    chrome.cookies.getAll = async () => {
      throw new Error('no permission');
    };
    expect((await ask()).size).to.eql(0);
  });

  it('should collect from the shared headers, every step and the rescue config', async function () {
    jar = { 'aws-waf-token': 'AWS', cf_clearance: 'CF', __cf_bm: 'BM' };
    const found = await findSafeCookies(URL_, {
      headers: { Cookie: 'a={{safecookie:aws-waf-token}}' },
      steps: [{}, { headers: { Cookie: 'b={{safecookie:cf_clearance}}' } }],
      onError: { headers: { Cookie: 'c={{safecookie:__cf_bm}}' } },
    });
    expect([...found.keys()].sort()).to.eql([
      '__cf_bm',
      'aws-waf-token',
      'cf_clearance',
    ]);
  });

  it('should collect a cookie that a step only "requires"', async function () {
    jar = { 'aws-waf-token': 'AWS' };
    const found = await findSafeCookies(URL_, {
      steps: [{ requires: ['{{safecookie:aws-waf-token}}'] }],
    });
    expect(found.get('aws-waf-token')).to.eql('AWS');
  });

  it('should refuse untrusted cookies in "requires" entries', async function () {
    jar = { sessionid: 'secret' };
    const found = await findSafeCookies(URL_, {
      steps: [{ requires: ['{{safecookie:sessionid}}'] }],
    });
    expect(lookups).to.eql([]);
    expect(found.size).to.eql(0);
  });

  it('should collect from "requires" inside the rescue config', async function () {
    jar = { cf_clearance: 'CF' };
    const found = await findSafeCookies(URL_, {
      onError: { steps: [{ requires: ['{{safecookie:cf_clearance}}'] }] },
    });
    expect(found.get('cf_clearance')).to.eql('CF');
  });

  it('should support alternatives ("||")', async function () {
    jar = { cf_clearance: 'CF' };
    const found = await collect(
      'x={{cookie:missing||safecookie:cf_clearance}}',
    );
    expect(found.get('cf_clearance')).to.eql('CF');
  });
});
