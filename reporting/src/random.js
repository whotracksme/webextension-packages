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

// Random float in the interval [0, 1]
export default function random() {
  return random53Bit() / 2 ** 53;
}

// Random unsigned integer in the interval { 0, .., Number.MAX_SAFE_INTEGER }.
// In other words, a random unsigned 53-bit integer.
function random53Bit() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  return 2 ** 32 * (values[0] & 0x1fffff) + values[1]; // 0x1fffff masks 21 bits (21 + 32 == 53)
}

// Random unsigned integer in the interval { 0, .., 2 ** 32 - 1 }
export function random32Bit() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// Random unsigned integer in the interval { -Number.MAX_SAFE_INTEGER, .., Number.MAX_SAFE_INTEGER }
function randomSafeInteger() {
  const values = crypto.getRandomValues(new Uint32Array(2));
  const x = 2 ** 32 * (values[0] & 0x1fffff) + values[1]; // 0x1fffff masks 21 bits (21 + 32 == 53)
  const positive = values[0] & (2 ** 22); // use bit 22 for the sign
  if (x === 0 && !positive) {
    // re-roll to avoid bias towards 0 (otherwise, we count it twice)
    return randomSafeInteger();
  }
  return positive ? x : -x;
}

/**
 * Returns a floating point (not integer!) that lies between the boundaries.
 *
 * Hint: if you need an unbiased integer, use "randomSafeIntBetween".
 */
export function randomBetween(minInclusive, maxInclusive) {
  if (!Number.isFinite(minInclusive)) {
    throw new Error(`minInclusive=${minInclusive} must be a finite number`);
  }
  if (!Number.isFinite(maxInclusive)) {
    throw new Error(`maxInclusive=${maxInclusive} must be a finite number`);
  }
  if (maxInclusive < minInclusive) {
    throw new Error(
      `maxInclusive=${maxInclusive} must be at least minInclusive=${minInclusive}`,
    );
  }
  const diff = maxInclusive - minInclusive;
  if (diff === 0) {
    return minInclusive;
  }
  return minInclusive + random() * diff;
}

/**
 * Return an unbiased random integer that lies between the boundaries (both inclusive).
 */
export function randomSafeIntBetween(minInclusive, maxInclusive) {
  if (!Number.isSafeInteger(minInclusive)) {
    throw new Error(`minInclusive=${minInclusive} must be a safe integer`);
  }
  if (!Number.isSafeInteger(maxInclusive)) {
    throw new Error(`maxInclusive=${maxInclusive} must be a safe integer`);
  }
  if (maxInclusive < minInclusive) {
    throw new Error(
      `maxInclusive=${maxInclusive} must be at least minInclusive=${minInclusive}`,
    );
  }

  const diff = maxInclusive - minInclusive;
  if (diff === 0) {
    return minInclusive;
  }

  if (Number.isSafeInteger(diff)) {
    const fitsIn32Bit = diff < 2 ** 32;
    const randGen = fitsIn32Bit ? random32Bit : random53Bit;

    let nextPow2 = 1;
    while (diff >= nextPow2) {
      nextPow2 *= 2;
    }

    for (let attempts = 0; attempts < 1000; attempts += 1) {
      const x = randGen() % nextPow2;
      if (x <= diff) {
        return minInclusive + x;
      }
    }
  } else {
    for (let attempts = 0; attempts < 1000; attempts += 1) {
      const x = randomSafeInteger();
      if (x >= minInclusive && x <= maxInclusive) {
        return x;
      }
    }
  }

  // Since each pick had a chance of over 50 %, reaching this point should be
  // practically impossible (less likely than losing 1000 coin flips in a row).
  // Reaching it indicates that it is either a bug or the underlying random number
  // generator (provided by the environment) is broken.
  throw new Error(
    `Internal error: unable to pick a random number between ${minInclusive} and ${maxInclusive}`,
  );
}

// Fisher-Yates shuffle algorithm
export function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randomSafeIntBetween(0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
