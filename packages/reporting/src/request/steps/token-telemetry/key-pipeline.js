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
import SerializableMap from '../../utils/serializable-map';

function getSiteTokensMap(siteTokens, key) {
  let siteTokensMap = siteTokens.get(key);
  if (!siteTokensMap) {
    siteTokensMap = new SerializableMap();
    siteTokens.set(siteTokensMap);
  }
  return siteTokensMap;
}

export default class KeyPipeline extends CachedEntryPipeline {
  constructor({ db, trustedClock, name, options }) {
    super({ db, trustedClock, name, options, primaryKey: 'hash' });
  }

  newEntry() {
    return {
      created: Date.now(),
      dirty: true,
      sitesTokens: new SerializableMap(),
      count: 0,
    };
  }

  updateCache({ hash, lastSent, key, tracker, created, sitesTokens, count }) {
    const stats = this.getFromCache(hash);
    if (stats.lastSent === undefined || lastSent > stats.lastSent) {
      stats.lastSent = lastSent;
    }
    stats.key = key;
    stats.tracker = tracker;
    stats.created = Math.min(stats.created, created);
    Object.keys(sitesTokens).forEach((site) => {
      const tokenMap = sitesTokens[site];
      const st = getSiteTokensMap(stats.sitesTokens, site);
      tokenMap.forEach((safe, token) => {
        st.set(token, safe);
      });
    });
    stats.count = Math.max(stats.count, count);
  }

  serialiseEntry(hash, stats) {
    const { created, lastSent, key, tracker, sitesTokens, count } = stats;
    return {
      hash,
      key,
      tracker,
      created,
      lastSent: lastSent || '',
      sitesTokens,
      count,
    };
  }

  createMessagePayloads(toBeSent, batchLimit) {
    // grouping of key messages per site, up to batchLimit
    const groupedMessages = new Map();
    const overflow = [];
    toBeSent.forEach((tuple) => {
      const [, stats] = tuple;
      if (groupedMessages.size >= batchLimit) {
        overflow.push(tuple);
      } else {
        stats.sitesTokens.forEach((tokens, site) => {
          // if there are unsafe tokens in the group, make sure this entry is not grouped
          const unsafe = [...tokens.values()].some((t) => t === false);
          const extraKey = unsafe ? `${stats.tracker}:${stats.key}` : '';
          let entry = groupedMessages.get(`${site}${extraKey}`);
          if (!entry) {
            entry = [];
            groupedMessages.set(`${site}${extraKey}`, entry);
          }
          entry.push({
            ts: this.trustedClock.getTimeAsYYYYMMDD(),
            tracker: stats.tracker,
            key: stats.key,
            site,
            tokens: [...tokens],
          });
        });
        stats.sitesTokens.clear();
        stats.count = 0;
      }
    });
    return {
      messages: [...groupedMessages.values()],
      overflow,
    };
  }

  hasData(entry) {
    return Object.keys(entry.sitesTokens).length > 0;
  }
}
