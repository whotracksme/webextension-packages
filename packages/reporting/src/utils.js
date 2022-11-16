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

export function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function clamp({ min, max, value }) {
  return Math.min(Math.max(min, value), max);
}
