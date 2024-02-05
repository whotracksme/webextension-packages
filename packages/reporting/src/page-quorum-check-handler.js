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
import { BadJobError } from './errors';
import random from './random';

function createPageMessage(safePage, ctry) {
  const { url, title, ref = null, red = null, search, lang } = safePage;
  const { activity } = safePage.aggregator;

  const payload = {
    url,
    t: title,
    ref,
    red,
    lang,
    ctry,
    activity,
  };
  if (search) {
    // note: if the query failed the sanitizer checks, it will be omitted here
    payload.qr = {
      q: search.query,
      t: search.category,
      d: search.depth,
    };
  }

  // consider page messages as duplicates if "payload.url" is identical
  const deduplicateBy = 'url';

  const body = {
    action: 'wtm.page',
    payload,
    ver: '2.9', // TODO: eliminate code duplication (especially, the magic constant '2.9')
    'anti-duplicates': Math.floor(random() * 10000000),
  };
  return { body, deduplicateBy };
}

// Abstraction layer to avoid making multiple quorum checks for the same URL
// (mostly because of redirects). Not intended as a permanent cache, but it is
// limited to the processing of one message.
class CachedQuorumChecker {
  constructor(quorumChecker) {
    this.quorumChecker = quorumChecker;
    this.cached = new Map();
  }

  async isQuorumReached(url) {
    const cacheHit = this.cached.get(url);
    if (cacheHit) {
      return cacheHit;
    }

    const pending = this.quorumChecker.checkQuorumConsent({ text: url });
    this.cached.set(url, pending);
    pending.catch((e) => {
      logger.warn('Quorum check for URL', url, 'failed', e);
    });
    return pending;
  }
}

export default class PageQuorumCheckHandler {
  constructor({ jobScheduler, quorumChecker, countryProvider }) {
    this.quorumChecker = quorumChecker;
    this.countryProvider = countryProvider;

    jobScheduler.registerHandler('page-quorum-check', async (job) => {
      const message = await this.runJob(job.args.safePage);
      if (!message) {
        return [];
      }
      logger.debug('Page message ready:', message);
      return [{ type: 'send-message', args: message }];
    });
  }

  async runJob(safePage) {
    if (!safePage) {
      throw new BadJobError('page information missing');
    }
    const { url } = safePage;
    if (!url) {
      throw new BadJobError('url missing');
    }

    // Phase 1: Quorum voting
    //
    // Try to vote for all URLs (only the ones that have been already voted for will be skipped).
    // Note that we will not necessarily do a quorum check all URLs in phase 2. If the original URL
    // fails, we can exit early because the whole message will be dropped anyway. But voting is still
    // useful, since it helps the system to learn about safe URLs. That is why we also vote even
    // for pages that came from a search engine (and thus are public). Why? Because voting will help
    // other clients that reach the identical page but not directly from a search engine.
    const uniqueUrlsToInc = new Set([url]);
    if (safePage.ref) {
      uniqueUrlsToInc.add(safePage.ref);
    }
    if (safePage.redirects) {
      for (const { from, to } of safePage.redirects) {
        uniqueUrlsToInc.add(from);

        // ignore the magic '...' marker
        // (used to break long redirect chains from misconfigured servers)
        if (to !== '...') {
          uniqueUrlsToInc.add(to);
        }
      }
    }
    const urlsToInc = [...uniqueUrlsToInc];
    const parsedUrls = new Map(
      urlsToInc.map((url) => {
        const postfix = ' (PROTECTED)';
        const normalizedUrl = url.endsWith(postfix)
          ? url.slice(0, -postfix.length)
          : url;
        try {
          return [url, new URL(normalizedUrl)];
        } catch (e) {
          throw new BadJobError(
            `Failed to parse URL (url=${url}, normalizedUrl=${normalizedUrl})`,
          );
        }
      }),
    );
    const isPureDomain = (url) => {
      const { pathname, search, hash } = parsedUrls.get(url);
      return pathname === '/' && !search && !hash;
    };
    for (const urlToInc of urlsToInc) {
      if (!isPureDomain(urlToInc)) {
        await this.quorumChecker.sendQuorumIncrement({ text: urlToInc });
      }
    }

    // Phase 2: Now run quorum checks to find out which URLs are popular even to be shared.
    // First, setup a locally cached quorum checker to eliminate multiple calls for the
    // same URLs (e.g., if there are redirects).
    const cachedQuorumChecker = new CachedQuorumChecker(this.quorumChecker);

    // If the main URL does not meet quorum, we drop the whole message.
    // An exception are pages that have been indexed by a public search engine;
    // those are already public, so they should be safe to share.
    const isIndexed = safePage.search && safePage.search.depth === 1;
    if (
      !isIndexed &&
      !isPureDomain(url) &&
      !(await cachedQuorumChecker.isQuorumReached(url))
    ) {
      logger.info('Dropping page', url, 'since it failed to reach quorum');
      return null;
    }

    const protectUrlIfNeeded = async (url) => {
      if (isPureDomain(url) || url === '...') {
        return url;
      }
      if (await cachedQuorumChecker.isQuorumReached(url)) {
        return url;
      }
      const parsedUrl = parsedUrls.get(url);
      return `${parsedUrl.protocol}//${parsedUrl.hostname}/ (PROTECTED)`;
    };

    if (safePage.ref) {
      safePage = { ...safePage };
      safePage.ref = await protectUrlIfNeeded(safePage.ref);
    }

    const { redirects } = safePage;
    if (redirects) {
      safePage = { ...safePage };
      safePage.redirects = await Promise.all(
        redirects.map(async (redirect) => {
          const from = await protectUrlIfNeeded(redirect.from);
          const to = await protectUrlIfNeeded(redirect.to);
          return {
            from,
            to,
            statusCode: redirect.statusCode,
          };
        }),
      );
    }

    const ctry = this.countryProvider.getSafeCountryCode();
    return createPageMessage(safePage, ctry);
  }
}
