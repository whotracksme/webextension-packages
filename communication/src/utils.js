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

/**
 * Use case: when running object through JSON.stringify, it
 * should not be distinguishable in which order the object keys
 * where added.
 */
export function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  const sortByKeys = (x, y) => {
    if (x[0] === y[0]) return 0;
    return x[0] < y[0] ? -1 : 1;
  };
  return Object.fromEntries(
    Object.entries(obj)
      .sort(sortByKeys)
      .map(([k, v]) => [k, sortObjectKeys(v)]),
  );
}
