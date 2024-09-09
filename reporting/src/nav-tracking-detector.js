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
import { requireParam, requireString, requireObject, fastHash } from './utils';
import random from './random';
import { timezoneAgnosticDailyExpireAt } from './cooldowns';

const SECOND = 1000;

function tryParseHostname(url) {
  try {
    return new URL(url).host;
  } catch (e) {
    return null;
  }
}

function hasQueryParams(url, params) {
  try {
    const { searchParams } = new URL(url);
    return params.every((key) => searchParams.has(key));
  } catch (e) {
    return false;
  }
}

const searchAdRedirectByCategory = {
  go: (url) =>
    url.startsWith('https://www.googleadservices.com/') ||
    url.startsWith('https://www.google.com/aclk?'),
  bi: (url) => url.startsWith('https://www.bing.com/aclk?'),
  dd: (url) =>
    url.startsWith('https://www.bing.com/aclick?') ||
    (url.startsWith('https://duckduckgo.com/y.js?') &&
      hasQueryParams(url, ['ad_domain', 'ad_provider', 'ad_type'])),
  gh: (url) => url.startsWith('https://tatrck.com/h/'),
  br: (url) =>
    url.startsWith('https://search.brave.com/a/redirect?') &&
    hasQueryParams(url, ['click_url', 'placement_id']),
  ec: (url) =>
    url.startsWith('https://syndicatedsearch.goog/aclk?') ||
    url.startsWith('https://ad.doubleclick.net/searchads/link/click?'),
};

// exported only for tests
export function isAdUrlByCategory(url, category) {
  requireString(url);
  requireString(category);

  const check = searchAdRedirectByCategory[category];
  return !!(check && check(url));
}

function isTracking(url) {
  requireString(url);

  // Note: For bootstrapping, start with the tracking ads. We could integrate
  // with the adblocker engine or TrackerDB eventually here to improve coverage.
  return Object.values(searchAdRedirectByCategory).some((check) => check(url));
}

function isSearchAdRedirect(category, redirects) {
  const trackingUrls = redirects.map((x) => x.from).filter(isTracking);
  const isAd =
    (redirects.length > 0 && isAdUrlByCategory(redirects[0].from, category)) ||
    (trackingUrls.length > 0 && isAdUrlByCategory(trackingUrls[0], category));
  return { isAd, trackingUrls };
}

function toSendMessageJob(action, payload, deduplicateBy) {
  const body = {
    action,
    payload,
    ver: 3, // Note: no need to keep this number in sync among messages
    'anti-duplicates': Math.floor(random() * 10000000),
  };
  return { type: 'send-message', args: { body, deduplicateBy } };
}

/**
 * Responsible for detecting navigational tracking
 * (https://privacycg.github.io/nav-tracking-mitigations/#navigational-tracking).
 *
 * It observes events emitted by the "Page", so some events will
 * have been filtered already (e.g. "incognito" tabs are filtered out).
 */
export default class NavTrackingDetector {
  constructor({ sanitizer, persistedHashes, quorumChecker, jobScheduler }) {
    this.active = false;
    this.sanitizer = requireParam(sanitizer);
    this.persistedHashes = requireParam(persistedHashes);
    this.quorumChecker = requireParam(quorumChecker);
    this.jobScheduler = requireParam(jobScheduler);

    this.jobScheduler.registerHandler(
      'nav-track-detect:quorum-isAdCheck',
      async (job) => {
        const { action, payload, deduplicateBy, quorumCheck } = job.args;
        requireString(action);
        requireObject(payload);
        requireString(quorumCheck);

        // Rate limit the quorum check to once per day.
        //
        // Note: there is another, independent check based on "deduplicateBy"
        // before sending the message. This check here only protects
        // rate-limits the quorum check.)
        const expireAt = timezoneAgnosticDailyExpireAt();
        const dedupHash = fastHash(`nav-track:quorum:${quorumCheck}`, {
          truncate: true,
        });
        const wasAdded = await this.persistedHashes.add(dedupHash, expireAt);
        if (!wasAdded) {
          logger.debug(
            'Dropping before quorum check (already seen):',
            action,
            payload,
          );
          return [];
        }
        try {
          if (await this._passesQuorum(quorumCheck)) {
            return [toSendMessageJob(action, payload, deduplicateBy)];
          } else {
            logger.debug(
              'Dropping message (failed to reach quorum):',
              action,
              payload,
            );
            return [];
          }
        } catch (e) {
          // unblock the hash to allow retries later
          // (at this point, the error could be caused by a network error,
          // so it is still possible that a retry later could work.)
          await this.persistedHashes.delete(dedupHash).catch(() => {});
          throw e;
        }
      },
      {
        priority: -1000,
        cooldownInMs: 3 * SECOND,
        maxJobsTotal: 200,
      },
    );
  }

  async init() {
    this.active = true;
  }

  unload() {
    this.active = false;
  }

  onPageEvent(event) {
    if (!this.active) {
      return;
    }

    if (event.type === 'safe-page-navigation') {
      this._analyzeNavigation(event);
    } else if (event.type === 'safe-search-landing') {
      this._analyzeLanding(event.details);
    }
  }

  // general case: page navigation
  _analyzeNavigation(event) {
    // TODO:
    // A difference is that publically indexed 'search -> host' navigations
    // less sensitive than arbitrary 'host -> host' navigations. Thus,
    // it is likely that additional checks will be needed to support them.
    // For now, start start without it.
    console.debug('[STUB]: general navigation are not yet covered', event);
  }

  // special case: public search engine landings
  _analyzeLanding({ from, to, redirects }) {
    // Open questions:
    // * Is it sufficient to look only at the first hop? For instance, what
    //   about permanent a redirect that is still controlled by the original
    //   site owner, before it hands control over to the tracker?
    // * Currently, we look only at the first hop, even though there are chains
    //   of tracker redirects? Potentially, these could be useful. The message
    //   thus puts the results in an array; but for now, it will only have a
    //   single entry.
    // * Should we use the statusCode? For instance, treat permanent redirects
    //   differently? - Currently, we do not.
    const { category, query: unsafeQuery } = from;
    const { isAd, trackingUrls } = isSearchAdRedirect(category, redirects);
    if (!isAd) {
      return;
    }

    // Since the context is a search engine landing, it is likely
    // that it is a public hostname. Also, hostname are normally safe
    // to share (e.g. they will be sent as cleartext even in https).
    const hostname = tryParseHostname(to.targetUrl);
    if (!hostname) {
      return;
    }
    const trackingHosts = trackingUrls.map(tryParseHostname);

    // null out the query if there is the risk of leaking information
    const { accept } = this.sanitizer.checkSuspiciousQuery(unsafeQuery);
    const query = accept ? unsafeQuery : null;

    const action = 'wtm.nav-track-detect.search-ad';
    this._registerJob({
      type: 'nav-track-detect:quorum-isAdCheck',
      args: {
        action,
        payload: {
          from: {
            search: {
              category,
              query,
            },
          },
          to: {
            hostname,
          },
          via: {
            redirects: trackingHosts,
          },
        },
        quorumCheck: JSON.stringify([
          action,
          category,
          hostname,
          trackingHosts,
        ]),
      },
    });
  }

  async _passesQuorum(quorumCheck) {
    requireString(quorumCheck);

    // TODO: maybe break this also in two independent jobs
    // (not strictly required, but could improve error recovery).
    await this.quorumChecker.sendQuorumIncrement({ text: quorumCheck });
    return this.quorumChecker.checkQuorumConsent({ text: quorumCheck });
  }

  _registerJob(job) {
    this.jobScheduler.registerJob(job).catch((e) => {
      logger.error('Failed to register job', job, e);
    });
  }
}
