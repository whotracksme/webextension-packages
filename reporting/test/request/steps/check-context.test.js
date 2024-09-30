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

import * as chai from 'chai';

import {
  checkSameGeneralDomain,
  checkValidContext,
} from '../../../src/request/steps/check-context.js';

describe('request/steps/check-context', function () {
  describe('checkSameGeneralDomain', function () {
    function mockState(requestDomain, sourceDomain) {
      return {
        urlParts: {
          generalDomain: requestDomain,
        },
        tabUrlParts: {
          generalDomain: sourceDomain,
        },
      };
    }

    [
      ['cliqz.com', 'cliqz.com'],
      ['with.co.uk', 'with.co.uk'],
      ['registered.co.uk', 'registered.com'],
    ].forEach((pair) => {
      const [a, b] = pair;
      it(`stops pipeline with '${a}' and '${b}'`, () => {
        chai.expect(checkSameGeneralDomain(mockState(a, b))).to.be.false;
      });
    });

    [
      ['', 'example.com'],
      ['localhost', '127.0.0.1'],
      ['cliqz.com', 'kliqz.com'],
    ].forEach((pair) => {
      const [a, b] = pair;
      it(`does not stop pipeline with '${a}' and '${b}'`, () => {
        chai.expect(checkSameGeneralDomain(mockState(a, b))).to.be.true;
      });
    });
  });

  describe('checkValidContext', function () {
    it('rejects requests of type other', function () {
      chai.expect(checkValidContext({ type: 'other' })).to.be.false;
    });
  });
});
