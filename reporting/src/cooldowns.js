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

import random from './random';

const HOUR = 60 * 60 * 1000;

/**
 * Minimum delay before repeating an action that should not
 * be repeat untiled the next day (e.g. for doublefetch attempts
 * for queries). Waiting for next start of day (in UTC time) is
 * recommended, as trying to send messages earlier is a waste of
 * resources. Not that only successful attempts should be counted,
 * and failed ones should be rolled back.
 *
 * In addition, enforce a minimum cooldown, intended for people
 * living in timezones like US west coast where UTC midnight
 * happens during the day. Without a minimum cooldown, there is
 * the risk of introducing bias in the collected data, as we
 * would include repeated searches with higher likelihood than
 * in other parts of the world (e.g. Europe).
 */
export function timezoneAgnosticDailyExpireAt() {
  const minCooldown = 8 * HOUR;
  const tillNextUtcDay = new Date().setUTCHours(23, 59, 59, 999) + 1;
  const tillCooldown = Date.now() + minCooldown;
  const randomNoise = Math.ceil(random() * 2 * HOUR);

  return Math.max(tillCooldown, tillNextUtcDay) + randomNoise;
}
