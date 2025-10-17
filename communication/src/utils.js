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
 *
 * Note: The current implement only operates on the first level.
 * In our context, that should be suffient, since
 * anonymous-communication will not add nested structures.
 * The only nested structure is the payload, which means the
 * message creator will be responsible for the ordering.
 *
 * Should that become a burden, we could extend this function
 * to recursively sort the object keys.
 */
export function sortObjectKeys(obj) {
  const sortByKeys = (x, y) => {
    if (x[0] === y[0]) return 0;
    return x[0] < y[0] ? -1 : 1;
  };
  return Object.fromEntries(Object.entries(obj).sort(sortByKeys));
}
