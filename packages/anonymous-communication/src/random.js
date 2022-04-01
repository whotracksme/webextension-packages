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

/* eslint-disable no-bitwise */

export default function random() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return (2 ** 32 * (values[0] & 0x1fffff) + values[1]) / 2 ** 53;
}

export function randomInt() {
  return Math.floor(random() * Number.MAX_SAFE_INTEGER);
}
