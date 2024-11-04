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

/* eslint no-param-reassign: 'off' */

import { isIpv4Address } from './utils.js';
import { isHash } from '../../utils/hash-detector.js';

export function isMostlyNumeric(str) {
  let numbers = 0;
  const length = str.length;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code >= 48 && code < 58) {
      numbers += 1;
    }
  }
  return numbers / length > 0.8;
}

const BEGIN_DATE = new Date(2010, 1, 1).getTime();
const END_DATE = Date.now() + 1000 * 60 * 60 * 24 * 365 * 5; // now + 5 YEARS;

function isTimestamp(str) {
  const intVal = parseInt(str, 10);
  return !isNaN(intVal) && intVal > BEGIN_DATE && intVal < END_DATE;
}

/**
 * Check if this value should be considered as a potential identifier and subject to token checks
 * @param str
 */
export function shouldCheckToken(minLength, str) {
  if (str.length < minLength) {
    return false;
  }
  // exclude IPv4 addresses
  if (str.length > 6 && str.length < 16 && isIpv4Address(str)) {
    return false;
  }
  // numeric short (< 13 digits)
  if (str.length < 13 && isMostlyNumeric(str)) {
    return true;
  }
  // is a timestamp?
  if (str.length === 13 && isTimestamp(str)) {
    return false;
  }
  return isHash(str);
}
