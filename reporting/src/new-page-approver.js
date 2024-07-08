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
import { fastHash, roundUpToNextUTCMidnight } from './utils';
import SelfCheck from './self-check';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * Key to be stored in the bloom filter.
 */
function privatePageKey(url) {
  return `[private-url]${url}`;
}

/**
 * Before we look at a page again, we should wait at least until the next day
 * in UTC time. Since this may be in the middle of a day (e.g. in the US), the
 * cooldown should make it likely that the aggregation of new page starts with
 * a new day.
 */
export function determineEndOfPageCooldown(createdAt = Date.now()) {
  const utcMidnight = roundUpToNextUTCMidnight(createdAt);
  const diff = utcMidnight - createdAt;
  const minCooldown = Math.max(diff, 14 * HOUR);
  const randomNoise = Math.random() * 2 * HOUR;
  return Math.ceil(createdAt + minCooldown + randomNoise);
}

export default class NewPageApprover {
  constructor(persistedHashes, privatePageBloomFilter) {
    this.persistedHashes = persistedHashes;
    this.privatePageBloomFilter = privatePageBloomFilter;

    this.privatePagesWriteBuffer = new Set();
    this.privatePagesWriteBufferLimit = 1000;
  }

  async allowCreation(url, now = Date.now()) {
    function reject(reason) {
      return { ok: false, reason };
    }

    const hash = fastHash(url, { truncate: true });
    if (await this.persistedHashes.has(hash)) {
      return reject('end of cooldown not reached yet');
    }
    if (await this.privatePageBloomFilter.mightContain(url)) {
      return reject('page has been (possibly) marked as private before');
    }

    // Note: we do not need to use trustedClock here, since the timeout
    // is randomized and should not be exploitable.
    const expireAt = determineEndOfPageCooldown(now);
    await this.persistedHashes.add(hash, expireAt);
    return { ok: true };
  }

  async mightBeMarkedAsPrivate(url) {
    return (
      this.privatePagesWriteBuffer.has(url) ||
      (await this.privatePageBloomFilter.mightContain(privatePageKey(url)))
    );
  }

  async markAsPrivate(url) {
    if (
      this.privatePagesWriteBuffer.size >= this.privatePagesWriteBufferLimit
    ) {
      // Practically, this should be hard to reach. This code exists only to
      // have a guarantee that the write buffer cannot grow infinitely.
      logger.error(
        'Overrun detected in the private pages cache (limit=${this.privatePagesWriteBufferLimit}).',
        'Clear cache and continue...',
      );
      this.privatePagesWriteBuffer.clear();
    }

    this.privatePagesWriteBuffer.add(url);
    try {
      await this.privatePageBloomFilter.add(privatePageKey(url));
      this.privatePagesWriteBuffer.delete(url);
    } catch (e) {
      logger.warn(
        'Failed to mark page as private on disk (only in memory):',
        url,
      );
      throw e;
    }
  }

  async selfChecks(check = new SelfCheck()) {
    const numUrls = this.privatePagesWriteBuffer;
    if (numUrls > this.privatePagesWriteBufferLimit) {
      check.fail(
        'Overrun detected in write buffer (is there a problem with the bloom filter?):',
        { numUrls: this.privatePagesWriteBuffer.size },
      );
    } else if (numUrls >= 2) {
      const urls = [...this.privatePagesWriteBuffer];
      check.warn(
        'Unflushed private pages detected (is there a problem with the bloom filter?):',
        { numUrls, urls },
      );
    }
    return check;
  }
}
