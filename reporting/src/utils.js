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

import logger from './logger';
import cyrb53 from './cyrb53';
import SeqExecutor from './seq-executor';

export function isNil(x) {
  return x === undefined || x === null;
}

export function requireParam(x, name) {
  if (isNil(x)) {
    throw new Error(
      name
        ? `Required parameter "${name}" is missing`
        : 'Required parameter is missing',
    );
  }
  return x;
}

export function requireInt(value, name) {
  if (!Number.isInteger(value)) {
    throw new Error(
      name
        ? `${name} should be integer, but got: <${value}>`
        : `Parameter should be integer, but got: <${value}>`,
    );
  }
  return value;
}

export function requireIntOrNull(value, name) {
  if (value !== null && !Number.isInteger(value)) {
    throw new Error(
      name
        ? `${name} should be integer or null, but got: <${value}>`
        : `Parameter should be integer or null, but got: <${value}>`,
    );
  }
  return value;
}

export function requireString(value, name) {
  if (typeof value !== 'string') {
    throw new Error(
      name
        ? `${name} should be string, but got: <${value}>`
        : `Parameter should be string, but got: <${value}>`,
    );
  }
  return value;
}

export function requireStringOrNull(value, name) {
  if (value !== null && typeof value !== 'string') {
    throw new Error(
      name
        ? `${name} should be string or null, but got: <${value}>`
        : `Parameter should be string or null, but got: <${value}>`,
    );
  }
  return value;
}

export function requireArrayOfStrings(value, name) {
  if (!Array.isArray(value)) {
    throw new Error(
      name
        ? `${name} should be an array of strings, but got: ${value}`
        : `Parameter should be an array of strings, but got: ${value}`,
    );
  }
  value.forEach((x, idx) => {
    if (typeof x !== 'string') {
      throw new Error(
        name
          ? `${name} should be an array of string, but got: ${value} (stopped at pos #${idx}: ${x})`
          : `Parameter should be an array of string, but got: ${value} (stopped at pos #${idx}: ${x})`,
      );
    }
  });
  return value;
}

export function requireBoolean(value, name) {
  if (value !== true && value !== false) {
    throw new Error(
      name
        ? `${name} should be boolean, but got: ${value}`
        : `Parameter should be boolean, but got: ${value}`,
    );
  }
  return value;
}

/**
 * This is a narrow definition of object (i.e. something like {}).
 */
export function requireObject(value, name) {
  if (isNil(value) || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(
      name
        ? `${name} should be an object, but got: <${value}>`
        : `Parameter should be an object, but got: <${value}>`,
    );
  }
  return value;
}

// https://graphics.stanford.edu/~seander/bithacks.html#RoundUpPowerOf2
export function nextPow2(_v) {
  let v = _v | 0;
  v -= 1;
  v |= v >> 1;
  v |= v >> 2;
  v |= v >> 4;
  v |= v >> 8;
  v |= v >> 16;
  v += 1;
  return v;
}

/**
 * If you need cryptographically safe randomness, consider using
 * randomBetween from './random.js'.
 */
export function randBetween(min, max) {
  return min + Math.random() * (max - min);
}

export function clamp({ min, max, value }) {
  return Math.min(Math.max(min, value), max);
}

export function intersectMapKeys(map1, map2) {
  const small = map1.size <= map2.size ? map1 : map2;
  const big = map1.size <= map2.size ? map2 : map1;
  return [...small.keys()].filter((x) => big.has(x));
}

// Hint: enable for better local debugging
//
// Normally, we store only hashes (often intentionally weakened) to give users
// limited protection if an attacker gets access to their profile (on their
// local machine). Yet for local development, preserving the original values
// as keys can be beneficial, since it makes inspecting the local state easier.
const USE_CLEARTEXT_HASHES_IF_POSSIBLE = false;
if (USE_CLEARTEXT_HASHES_IF_POSSIBLE) {
  logger.error(
    'cleartext hashes enabled (should never be shown in a production profile!)',
  );
}

/**
 * A non-cryptographic hash function for strings.
 *
 * Limitations:
 * - Expect the output space to be (at most) 53 bits.
 * - Expect the implementation to change at any point, and use it only
 *   for hashes that are stored locally on the profile.
 *
 * Options:
 * - seed: overwrites the seed (may be ignored)
 * - truncate: weakens the hash to 32 bits to make collisions more likely
 * - output: 'string', 'number', but by default unspecified
 *
 * If you require the output to string or number, you should set the
 * output parameter. Otherwise, leave it empty, so that the implementation
 * can chose (see USE_CLEARTEXT_HASHES_IF_POSSIBLE).
 */
export function fastHash(str, { seed = 0, truncate = false, output } = {}) {
  let hash = cyrb53(str, seed);
  if (truncate) {
    // converts to unsigned 32-bit
    hash = (hash & 0xffffffff) >>> 0;
  }
  if (USE_CLEARTEXT_HASHES_IF_POSSIBLE) {
    if (output !== 'number') {
      return str;
    }
    // If the caller requires an integer, the trick to keep the original string
    // does not work. Logging is the best that we can do to help debugging.
    logger.debug('fastHash:', str, '->', hash);
  }
  if (output === 'string') {
    // No particular reason to use base36 encoding. It makes the strings
    // a bit smaller, but you can anything here (e.g. hash.toString()).
    return hash.toString(36);
  }
  return hash;
}

/**
 * Example: chunk([1, 2, 3, 4, 5], 3) ==> [[1, 2, 3], [4, 5]]
 */
export function chunk(array, size) {
  if (size <= 0) {
    throw new Error(`Batch size must be strictly positive, but got ${size}`);
  }
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + Math.min(array.length - i, size)));
  }
  return result;
}

/**
 * Example: flattenObject({ x: 1, y: { z: 2 } }) ==> [{ path: ['x'], value: 1 }, { path: ['y', 'z'], value: 2 }]
 */
export function flattenObject(obj, parentPath = []) {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    const path = [...parentPath, key];
    if (typeof value === 'object' && value !== null) {
      acc.push(...flattenObject(value, path));
    } else {
      acc.push({ path, value });
    }
    return acc;
  }, []);
}

function sortedObjectEntries(x) {
  return Object.entries(x).sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });
}

/**
 * This is not a full deepEqual implementation. But it should be
 * able to detect common data objects with primitive types.
 *
 * If it returns true, you may assume that both inputs represent
 * the same data.

 * WARN: This implemenation will not detect identity in all situations;
 * you may still get false for identical objects.
 * If you need stronger guarantees, use a real deepEqual implementation.
 *
 * Note: the implementation assumes that objects are free of cycles
 */
export function equalityCanBeProven(x, y) {
  if (
    x === true ||
    x === false ||
    x === null ||
    x === undefined ||
    typeof x === 'string' ||
    Number.isFinite(x)
  ) {
    return x === y;
  }
  if (x.constructor === Date) {
    return y?.constructor === Date && +x === +y;
  }

  if (Array.isArray(x)) {
    if (!Array.isArray(y) || x.length !== y.length) {
      return false;
    }
    for (let i = 0; i < x.length; i += 1) {
      if (!equalityCanBeProven(x[i], y[i])) {
        return false;
      }
    }
    return true;
  }

  if (x.constructor === Object) {
    if (y?.constructor !== Object) {
      return false;
    }
    return (
      y.constructor === Object &&
      equalityCanBeProven(sortedObjectEntries(x), sortedObjectEntries(y))
    );
  }

  // we failed to prove identity, but we did not prove inequality either
  return false;
}

export function roundUpToNextUTCMidnight(unixEpoch) {
  const date = new Date(unixEpoch);
  date.setUTCHours(24, 0, 0, 0);
  return date.getTime();
}

/**
 * split0(str, on) === str.split(on)[0]
 */
export function split0(str, on) {
  const pos = str.indexOf(on);
  return pos < 0 ? str : str.slice(0, pos);
}

/**
 * Drop-in replacement for JSON.parse if you need to handle untrusted data.
 *
 * Warning: this implementation will not be able to magically solve all
 * possible attacks. Depending on the specific use case, additional
 * verifications may be needed (e.g. allowing only specific known fields).
 */
export function parseUntrustedJSON(
  untrustedJson,
  { sanitizeSilently = false, maxSize } = {},
) {
  if (typeof untrustedJson !== 'string') {
    throw new Error(
      'Untrusted JSON detected: unexpected input to be of type "string"',
    );
  }
  if (!isNil(maxSize) && untrustedJson.length > maxSize) {
    throw new Error(
      `Untrusted JSON detected: input exceeded maximum size of ${maxSize}`,
    );
  }

  if (sanitizeSilently) {
    const filterBadKeys = (key, value) =>
      key === '__proto__' ? undefined : value;
    return JSON.parse(untrustedJson, filterBadKeys);
  }

  const failOnBadKeys = (key, value) => {
    if (key === '__proto__') {
      throw new Error('Untrusted JSON detected: unexpected __proto__');
    }
    return value;
  };
  return JSON.parse(untrustedJson, failOnBadKeys);
}

/**
 * Lazy initialized variables:
 * - evaluated once at the first request
 * - never evaluated more than once
 * - never evaluated unless requested
 *
 * Usage:
 * const fooProvider = lazyInitAsync(async () => 1 + 1);
 * const foo = await fooProvider(); // foo === 2
 *
 * Warning: avoid cyclic dependencies in the initialization; otherwise,
 * you risk deadlocks. The implementation will not attempt to detect it.
 */
export function lazyInitAsync(func) {
  const criticalSection = new SeqExecutor();
  let isFirstCall = true;
  let initFailed = false;
  let value;
  let error;

  return () => {
    return criticalSection.run(async () => {
      if (isFirstCall) {
        try {
          value = await func();
        } catch (e) {
          initFailed = true;
          error = e;
        }
        isFirstCall = false;
      }
      if (initFailed) {
        throw error;
      }
      return value;
    });
  };
}
