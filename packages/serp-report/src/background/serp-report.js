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

import {
  WTM_PRIVACY_SCORE_CATEGORIES,
  WTM_PRIVACY_SCORE_COMPRESSED_STATS,
} from './data.js';

// For now, we assume that "tldts" library is already loaded and exists on the global scope
const { parse } = globalThis.tldts;

/**
 * Takes a site (e.g. "economist.com") and returns a map of categories
 * to trackers found. If no stats are found, "null" is returned instead.
 *
 * Note that {} is not the same as null. null means, no information
 * is available, while {} means that the site is free of trackers
 * according to the last WhoTracks.me stats.
 *
 * The shipped database covers the top 10,000 sites.
 */
function lookupWtmPrivacyScoreForSite(domain) {
  const response = {
    domain,
    stats: [],
  };
  const data = WTM_PRIVACY_SCORE_COMPRESSED_STATS[domain];

  if (!data) {
    return response;
  }

  const results = {};
  WTM_PRIVACY_SCORE_CATEGORIES.forEach(function (c, i) {
    if (data[i] > 0) {
      results[c] = data[i];
    }
  });

  response.stats = Object.keys(results).reduce(
    (all, current) => [...all, ...Array(results[current]).fill(current)],
    [],
  );

  return response;
}

function getWTMReportFromUrl(url) {
  const { domain } = tldts.parse(url);
  return lookupWtmPrivacyScoreForSite(domain);
}

export function tryWTMReportOnMessageHandler(msg, sender, sendResponse) {
  if (msg.action === 'getWTMReport') {
    const wtmStats = msg.links.map(getWTMReportFromUrl);
    sendResponse({
      wtmStats,
    });
    return true; // done
  }

  return false; // continue
}

export function isDisableWTMReportMessage(msg) {
  return msg.action === 'disableWTMReport';
}
