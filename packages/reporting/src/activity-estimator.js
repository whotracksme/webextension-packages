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
import {
  requireParam,
  requireInt,
  requireIntOrNull,
  requireString,
  requireStringOrNull,
} from './utils';
import SelfCheck from './self-check';

const SECOND = 1000;
const MINUTE = 60 * SECOND;

const BUCKET_SIZE_IN_MS = 524288; // === nextPow2(5 * MINUTE);
const MAX_ACTIVE_BUCKETS = 7; // roughly one hour

const MAX_UNCONFIRMED_ACTIVITY = 1 * MINUTE;
const LOAD_BOOST = 5 * SECOND;
const MAX_SCORE = 20 * MINUTE;

const MAX_ACCEPTED_DRIFT = 2 * MINUTE;

/**
 * Estimate the activity of a page. Given a URL, it will return
 * a number between 0 (no activity) and 1 (maximum threshold).
 *
 * The score be understood as an estimation of the site's activity;
 * it should correlate with relevance. In contrast to the "Pages" class,
 * which provides the input events, the ActivityEstimator operates on URLs,
 * instead of tabs.
 *
 * For active pages, the score increases when the tab activates, or when the
 * page dynamically loads content. Inactive pages are excluded. The score is
 * intentionally imprecise; but given enough clients, it is intended to serve
 * as another metric to rank page popularity.
 *
 * The data in this class is hold in memory only (with the option to serialize
 * to in-memory session store). Thus, even though the "Pages" class should
 * already performed some URL filtering before (e.g. incognito tabs), it is
 * not strictly required. From the perspective of the ActivityEstimator,
 * sites that the "Pages" class filters will be consisted always inactive.
 */
export default class ActivityEstimator {
  constructor({ onActivityUpdated, onInternalStateChanged }) {
    this._onActivityUpdated = requireParam(onActivityUpdated);
    this._updateSet = new Set();
    this._pendingUpdate = null;

    this._onInternalStateChanged = requireParam(onInternalStateChanged);
    this._pendingFlush = null;

    this.reset();
  }

  reset() {
    this._state = {
      lastUpdated: 0, // Unix epoch
      activeUrl: null,

      // Entries look like this:
      // {
      //   idx: 1627243,
      //   start: 1706288157869,
      //   urls: {
      //     'https://example.com/': {
      //       loads: 1,
      //       accum: 0,
      //       since: 1706288157869
      //     }
      //   }
      // }
      buckets: [],
    };
  }

  updateActiveUrl(url, now = Date.now()) {
    this._internalUpdateActiveUrl(requireStringOrNull(url), now);
  }

  dynamicLoadDetected(url, now = Date.now()) {
    if (!url) {
      throw new Error('Illegal state: URL is required');
    }
    const bucket = this._activateBucket(now);
    this._internalUpdateActiveUrl(url, now);
    bucket.urls[url].loads += 1;
  }

  _internalUpdateActiveUrl(url, now) {
    const bucket = this._activateBucket(now);
    const lastUrl = this._state.activeUrl;
    if (bucket.urls[lastUrl] && bucket.urls[lastUrl].since !== null) {
      bucket.urls[lastUrl].accum += now - bucket.urls[lastUrl].since;
      bucket.urls[lastUrl].since = null;
    }

    if (url) {
      if (bucket.urls[url]) {
        bucket.urls[url].loads += 1;
        if (bucket.urls[url].since === null) {
          bucket.urls[url].since = now;
        }
      } else {
        let accum = 0;
        if (url === lastUrl) {
          const diff = now - Math.max(this._state.lastUpdated, bucket.start);
          accum += Math.min(Math.max(diff, 0), MAX_UNCONFIRMED_ACTIVITY);
        }
        bucket.urls[url] = {
          loads: 1,
          accum,
          since: now,
        };
      }
    }
    this._state.activeUrl = url;
    this._state.lastUpdated = now;
    this._markDirty();

    this._addPendingUpdate(lastUrl);
    this._addPendingUpdate(url);
  }

  _addPendingUpdate(url) {
    if (url) {
      this._updateSet.add(url);
      if (this._pendingUpdate === null) {
        this._pendingUpdate = setTimeout(() => {
          this._pendingUpdate = null;
          const urls = [...this._updateSet];
          if (urls.length > 0) {
            this._updateSet.clear();
            this._onActivityUpdated(urls);
          }
        }, 0);
      }
    }
  }

  estimate(url, now = Date.now()) {
    let totalAccum = 0;
    let totalLoadBoosts = 0;
    const expiredStart = now - (MAX_ACTIVE_BUCKETS + 1) * BUCKET_SIZE_IN_MS;
    for (let i = 0; i < this._state.buckets.length; i += 1) {
      const { start, urls } = this._state.buckets[i];
      if (start < expiredStart) {
        break;
      }
      if (urls[url]) {
        const { accum, loads, since } = urls[url];
        totalAccum += accum;
        if (since !== null && now > since) {
          const tillEndOfBucket = BUCKET_SIZE_IN_MS - (since - start);
          totalAccum += Math.min(
            now - since,
            tillEndOfBucket,
            MAX_UNCONFIRMED_ACTIVITY,
          );
        }
        if (loads > 0) {
          totalLoadBoosts += LOAD_BOOST;
        }
      }
    }

    const score = totalAccum + totalLoadBoosts;
    return Math.min(score / MAX_SCORE, 1.0);
  }

  _markDirty() {
    if (this._pendingFlush === null) {
      this._pendingFlush = setTimeout(() => {
        this.flush();
      }, 0);
    }
  }

  flush() {
    if (this._pendingFlush !== null) {
      this._pendingFlush = null;
      this._onInternalStateChanged();
    }
  }

  serialize() {
    return this._state;
  }

  restore(state) {
    this._state = ActivityEstimator.ensureValidState(state);
  }

  _activateBucket(ts) {
    if (this._state.buckets.length > 0) {
      if (
        ts >= this._state.buckets[0].start &&
        ts < this._state.buckets[0].start + BUCKET_SIZE_IN_MS
      ) {
        return this._state.buckets[0];
      }

      if (ts < this._state.buckets[0].start) {
        const drift = this._state.buckets[0].start - ts;
        if (drift < MAX_ACCEPTED_DRIFT) {
          logger.warn(
            'Clock jumped backwards: continue since the drift is below the threshold:',
            { driftInMs: drift, thresholdInMs: MAX_ACCEPTED_DRIFT },
          );
          return this._state.buckets[0];
        }

        logger.warn(
          'Clock jumped backwards: purging data structure and starting fresh',
        );
        this.reset();
        this._markDirty();
      }
    }

    const idx = Math.floor(ts / BUCKET_SIZE_IN_MS);
    const start = idx * BUCKET_SIZE_IN_MS;
    this._expireBuckets(idx);

    logger.debug('[estimator] new bucket:', idx);
    this._state.buckets.unshift({ idx, start, urls: {} });
    this._markDirty();
    return this._state.buckets[0];
  }

  _toBucket(ts) {
    const idx = Math.floor(ts / BUCKET_SIZE_IN_MS);
    const start = idx * BUCKET_SIZE_IN_MS;
    const end = start + BUCKET_SIZE_IN_MS;
    return { idx, start, end };
  }

  _expireBuckets(idx) {
    while (this._state.buckets.length > 0) {
      const last = this._state.buckets[this._state.buckets.length - 1];
      if (last.idx < idx - MAX_ACTIVE_BUCKETS) {
        logger.debug('[estimator] expired bucket:', last.idx);
        this._state.buckets.pop();
        this._markDirty();
      } else {
        break;
      }
    }
  }

  static ensureValidState(state) {
    const { lastUpdated, activeUrl, buckets } = state || {};
    requireInt(lastUpdated, 'lastUpdated');
    requireStringOrNull(activeUrl, 'activeUrl');

    for (const { idx, start, urls } of buckets) {
      requireInt(idx, 'bucket[].idx');
      requireInt(start, 'bucket[].start');
      for (const [url, { loads, accum, since }] of Object.entries(urls)) {
        requireString(url, 'bucket[].urls[key]');
        requireInt(loads, 'bucket[].urls->loads');
        requireInt(accum, 'bucket[].urls->accum');
        requireIntOrNull(since, 'bucket[].urls->since');
      }
    }
    return state;
  }

  selfChecks(check = new SelfCheck()) {
    try {
      ActivityEstimator.ensureValidState(this._state);
    } catch (e) {
      check.fail('Invalid state', {
        state: this._state,
        reason: e.message,
      });
      return check;
    }

    if (this._state.buckets.length > MAX_ACTIVE_BUCKETS) {
      check.fail('bucket overrun', {
        buckets: [...this._state.buckets],
        threshold: MAX_ACTIVE_BUCKETS,
      });
    }
    return check;
  }
}
