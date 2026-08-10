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

import * as fc from 'fast-check';
import * as tldts from 'tldts-experimental';

/**
 * Not every URL that fast-check generates can exist in the real world.
 * For instance, "https://a.pg" looks fine, but "a.pg" is itself a public
 * suffix (the rule in the public suffix list is "*.pg"), so it cannot be
 * registered.
 */
export const arbitraryUrlWithDomain = fc
  .webUrl()
  .filter((url) => tldts.getDomain(url) !== null);

/**
 * fast-check will find edge cases for keys like "__proto__".
 * Yet in most use cases, the keys will be simple enough to work
 * for both normal objects and for ES6 maps.
 */
export function isSafeKeyForAnyMap(key) {
  // fast-check will find edge cases for keys like "__proto__".
  // In our context, we assume that only keys will be used
  // that will work for both normal objects and for ES6 maps.
  const m1 = {};
  const m2 = new Map();
  m1[key] = key;
  m2.set(key, key);
  return (
    Object.keys(m1).length === 1 && m2.size === 1 && m1[key] === m2.get(key)
  );
}
