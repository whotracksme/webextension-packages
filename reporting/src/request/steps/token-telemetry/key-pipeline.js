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

import CachedEntryPipeline from './cached-entry-pipeline.js';
import logger from '../../../logger.js';

export function getSiteTokensMap(siteTokens, key) {
  let siteTokensMap = siteTokens[key];
  if (!siteTokensMap) {
    siteTokensMap = {};
    siteTokens[key] = siteTokensMap;
  }
  return siteTokensMap;
}

export default class KeyPipeline extends CachedEntryPipeline {
  constructor(options) {
    super(options);
    this.primaryKey = 'hash';
  }

  newEntry() {
    return {
      created: Date.now(),
      dirty: true,
      sitesTokens: {},
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
      Object.entries(tokenMap).forEach(([token, safe]) => {
        st[token] = safe;
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
        Object.entries(stats.sitesTokens).forEach(([site, tokens]) => {
          // if there are unsafe tokens in the group, make sure this entry is not grouped
          const unsafe = Object.values(tokens).some((t) => t === false);
          const extraKey = unsafe ? `${stats.tracker}:${stats.key}` : '';
          let entry = groupedMessages.get(`${site}${extraKey}`);
          if (!entry) {
            entry = [];
            groupedMessages.set(`${site}${extraKey}`, entry);
          }
          let tokensToSend = Object.entries(tokens);

          // In rare cases, the number of tokens may exceed the message size limit (currently 32K),
          // such as when a website sends high-frequency requests with randomized IDs. To handle
          // this scenario, two approaches were considered:
          //
          // 1. Chunking: Splitting the message into multiple smaller messages.
          // 2. Sampling: Sending a random subset of token hashes.
          //
          // We implemented the second approach because the server-side aggregation aims to identify
          // common tokens seen by enough clients. If a website sends many different values rapidly,
          // they are likely random and unlikely to reach a quorum. Therefore, sending a random sample
          // of token hashes should not impair the server's ability to identify common values and may
          // even reduce noise.
          //
          // Exceeding the limit should be rare, and this measure serves as protection against edge cases.
          // Currently, we are aware of only one page that triggered this issue:
          // https://github.com/ghostery/broken-page-reports/issues/873#issuecomment-2450496021.
          if (tokensToSend.length > this.options.KEY_TOKENS_LIMIT) {
            logger.warn(
              '[Request keys-pipeline]',
              `too many tokens for site="${site}" key="${stats.key}" tracker=${stats.tracker}`,
              `picking a random sample ${this.options.KEY_TOKENS_LIMIT} of ${tokensToSend.length}`,
            );
            tokensToSend = takeRandomSample(
              Object.entries(tokens),
              this.options.KEY_TOKENS_LIMIT,
            );
          }

          entry.push({
            ts: this.trustedClock.getTimeAsYYYYMMDD(),
            tracker: stats.tracker,
            key: stats.key,
            site,
            tokens: tokensToSend,
          });
        });
        Object.keys(stats.sitesTokens).forEach(
          (key) => delete stats.sitesTokens[key],
        );
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

function takeRandomSample(array, size) {
  const shuffled = [...array];
  let currentIndex = shuffled.length;

  // Fisher-Yates Shuffle Algorithm
  while (currentIndex !== 0) {
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    const temporaryValue = shuffled[currentIndex];
    shuffled[currentIndex] = shuffled[randomIndex];
    shuffled[randomIndex] = temporaryValue;
  }

  return shuffled.slice(0, size);
}
