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

import CachedEntryPipeline from './cached-entry-pipeline';

export default class TokenPipeline extends CachedEntryPipeline {
  constructor(db, trustedClock, options) {
    super(db, trustedClock, 'token', options);
    this.name = 'tokens';
  }

  newEntry() {
    return {
      created: Date.now(),
      sites: new Set(),
      trackers: new Set(),
      safe: true,
      dirty: true,
      count: 0,
    };
  }

  updateCache({ token, lastSent, safe, created, sites, trackers, count }) {
    const stats = this.cache.get(token);
    if (stats.lastSent === undefined || lastSent > stats.lastSent) {
      stats.lastSent = lastSent;
    }
    stats.safe = safe;
    stats.created = Math.min(stats.created, created);
    sites.forEach((site) => {
      stats.sites.add(site);
    });
    trackers.forEach((tracker) => {
      stats.trackers.add(tracker);
    });
    stats.count = Math.max(stats.count, count);
  }

  serialiseEntry(key, tok) {
    const { created, safe, lastSent, sites, trackers, count } = tok;
    return {
      token: key,
      created,
      safe,
      lastSent: lastSent || '',
      sites: [...sites],
      trackers: [...trackers],
      count,
    };
  }

  createMessagePayloads(toBeSent, batchLimit) {
    const overflow = batchLimit
      ? toBeSent.splice(batchLimit * this.options.TOKEN_MESSAGE_SIZE)
      : [];
    // group into batchs of size TOKEN_MESSAGE_SIZE
    const nMessages = Math.ceil(
      toBeSent.length / this.options.TOKEN_MESSAGE_SIZE,
    );
    const messages = [...new Array(nMessages)]
      .map((_, i) => {
        const baseIndex = i * this.options.TOKEN_MESSAGE_SIZE;
        return toBeSent.slice(
          baseIndex,
          baseIndex + this.options.TOKEN_MESSAGE_SIZE,
        );
      })
      .map((batch) => batch.map(this.createMessagePayload.bind(this)));
    return {
      messages,
      overflow,
    };
  }

  createMessagePayload([token, stats]) {
    const msg = {
      ts: this.trustedClock.getTimeAsYYYYMMDD(),
      token,
      safe: stats.safe,
      sites: stats.sites.size,
      trackers: stats.trackers.size,
    };
    // clear
    stats.sites.clear();
    stats.trackers.clear();
    /* eslint no-param-reassign: 'off' */
    stats.count = 0;
    return msg;
  }

  hasData(entry) {
    return entry.sites.length > 0 && entry.trackers.length > 0;
  }
}
