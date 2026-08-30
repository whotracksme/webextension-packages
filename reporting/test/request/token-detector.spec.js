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
  isMostlyNumeric,
  shouldCheckToken,
} from '../../src/request/token-detector.js';

describe('#isMostlyNumeric', function () {
  for (const nonNumeric of ['', 'ithinkthereis1numberhere', '1240abcd']) {
    it(`returns false for "${nonNumeric}"`, function () {
      chai.expect(isMostlyNumeric(nonNumeric)).to.be.false;
    });
  }

  for (const mostlyNumeric of ['4902', '1024x768']) {
    it(`returns true for "${mostlyNumeric}"`, function () {
      chai.expect(isMostlyNumeric(mostlyNumeric)).to.be.true;
    });
  }
});

describe('#shouldCheckToken', function () {
  it('returns false for short tokens', () => {
    chai.expect(shouldCheckToken('1234')).to.be.false;
  });

  it('returns false for timestamps', () => {
    chai.expect(shouldCheckToken(`${Date.now()}`)).to.be.false;
  });

  it('returns false for IP addresses', () => {
    chai.expect(shouldCheckToken('192.168.3.4')).to.be.false;
  });

  for (const hash of [
    '04C2EAD03B',
    '54f5095c96e',
    'B62a15974a93',
    '22163a4ff903',
    '468x742',
    '1021x952',
    '1024x768',
    '1440x900',
  ]) {
    it(`should check '${hash}'`, function () {
      chai.expect(shouldCheckToken(hash)).to.be.true;
    });
  }

  for (const notHash of [
    '',
    'Firefox',
    'cliqz.com', // a url
    'anti-tracking',
    'front/ng',
    'javascript',
    'callback',
    'compress-format-enhance',
    'compress%2Cformat%2Cenhance',
  ]) {
    it(`should not check '${notHash}'`, function () {
      chai.expect(shouldCheckToken(notHash)).to.be.false;
    });
  }
});
