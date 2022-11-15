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

import { ClockOutOfSync } from './errors.js';

/**
 * Contains functions to generate timestamps used in WhoTracksMe messages.
 * As a general rule, all timestamps in the context of WhoTracksMe will be in UTC.
 *
 * To mitigate the risk of fingerprinting based on clock drift, messages
 * should not include high resolution timestamps, but instead should be truncated.
 */
export class TrustedClock {
  checkTime() {
    // TODO: Trust that the local system time is correct. On most systems,
    // that assumption should hold. it is a non-trivial problem to improve
    // it under Manifest V3 constraints (ideas like running a parallel
    // clock with setTimeout/setInterval is not a solution because of the
    // lack of persistent background page; the alarm API is too imprecise;
    // maybe a reliable clock could be built by observing server time-stamps).
    return {
      inSync: true,
      unixEpoche: Date.now(),
    };
  }

  now() {
    const { inSync, unixEpoche } = this.checkTime();
    if (!inSync) {
      throw new ClockOutOfSync();
    }
    return unixEpoche;
  }

  getTimeAsYYYYMMDD(now) {
    const ts = now ?? this.now();
    return new Date(ts)
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 8);
  }

  getTimeAsYYYYMMDDHH(now) {
    const ts = now ?? this.now();
    return new Date(ts)
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 10);
  }
}
