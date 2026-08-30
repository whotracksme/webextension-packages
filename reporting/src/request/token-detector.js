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

import { isIpv4Address } from './utils/utils.js';
import { isHash } from '../hash-detector-v2.js';

// (visible for testing)
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

function isTimestamp(str) {
  const BEGIN_DATE = 1264978800000; // new Date(2010, 1, 1).getTime()
  const END_DATE = Date.now() + 1000 * 60 * 60 * 24 * 365 * 5; // now + 5 YEARS

  const intVal = parseInt(str, 10);
  return !isNaN(intVal) && intVal > BEGIN_DATE && intVal < END_DATE;
}

/**
 * Check if this value should be considered as a potential identifier and subject to token checks
 *
 * (visible for testing)
 */
export function shouldCheckToken(str) {
  if (str.length < 6) {
    return false;
  }
  if (str.length > 6 && str.length < 16 && isIpv4Address(str)) {
    return false;
  }
  if (str.length < 13 && isMostlyNumeric(str)) {
    return true;
  }
  if (str.length === 13 && isTimestamp(str)) {
    return false;
  }
  return isHash(str);
}
