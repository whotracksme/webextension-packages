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
import { isNil, lazyInitAsync } from './utils';
import { BadJobError } from './errors';
import { anonymousHttpGet } from './http';
import parseHtml from './html-parser';
import { analyzePageStructure } from './page-structure';
import { sanitizeUrl } from './sanitizer';

const SECOND = 1000;

const ALLOW_HTML_AND_TEXT = [
  'text/html',
  'text/plain',
  'application/xhtml+xml', // legacy format
];

/**
 * This checks if the extracted title of a website is safe to share.
 * To decide, it compares it with the title on the doublefetch HTML.
 *
 * Note that this function is not symmetric: swapping the order of
 * the parameters can change the results. Why? It should be valid
 * assumption that the title *after* doublefetch is public information,
 * while the opposite cannot not be said for the title *before*
 * doublefetch.
 */
export function titlesMatchAfterDoublefetch({
  before: originalBefore,
  after: originalAfter,
}) {
  if (!originalBefore) {
    logger.warn(
      'Pages without "before-doublefetch" title should have been dropped already',
    );
    return false;
  }
  if (!originalAfter) {
    logger.warn(
      'Pages without "after-doublefetch" title should have been dropped already',
    );
    return false;
  }

  if (originalBefore === originalAfter) {
    return true;
  }

  const normalize = (x) => x.toLowerCase().replace(/\s/g, '');
  const before = normalize(originalBefore);
  const after = normalize(originalAfter);
  if (before === after) {
    return true;
  }

  if (before.length >= 6 && after.includes(before)) {
    return true;
  }

  return false;
}

class PageCache {
  constructor() {
    this.pages = new Map();
  }

  async doublefetchUrl(url) {
    const docProvider = this.pages.get(url);
    if (docProvider) {
      return docProvider();
    }

    const newDocProvider = lazyInitAsync(() => this._doublefetchUrl(url));
    this.pages.set(url, newDocProvider);
    return newDocProvider();
  }

  async _doublefetchUrl(url) {
    const shouldFollowRedirect = (targetUrl) => {
      const from = new URL(url);
      const to = new URL(targetUrl);
      return from.origin === to.origin && from.pathname === to.pathname;
    };

    let html;
    try {
      html = await anonymousHttpGet(url, {
        redirect: 'follow',
        shouldFollowRedirect,
        treat429AsPermanentError: true,
        downloadLimit: this.downloadLimit,
        allowedContentTypes: ALLOW_HTML_AND_TEXT,
      });
    } catch (e) {
      if (e.isPermanentError) {
        return { rejectReason: e };
      }
      logger.debug(
        'Failed to double-fetch',
        url,
        '(potentially it will work after a retry). Error message:',
        e.message,
      );
      throw e;
    }
    if (html.length === 0) {
      return { rejectReason: 'got an empty document' };
    }

    const doc = await parseHtml(html);
    const pageStructure = await analyzePageStructure(doc);
    return { pageStructure };
  }
}

export default class DoublefetchPageHandler {
  constructor({ jobScheduler, sanitizer, newPageApprover }) {
    this.sanitizer = sanitizer;
    this.newPageApprover = newPageApprover;
    this.downloadLimit = 2 * 1024 * 1024; // 2 MB

    const config = {
      priority: -1000,
      cooldownInMs: 3 * SECOND,
      maxJobsTotal: 200,
    };
    jobScheduler.registerHandler(
      'doublefetch-page',
      async (job) => {
        const { page } = job.args;
        const { ok, safePage, details } = await this.runJob(page);
        if (!ok) {
          logger.debug('Page has been rejected during doublefetch:', {
            page,
            details,
          });
          return [];
        }
        return [{ type: 'page-quorum-check', args: { safePage } }];
      },
      config,
    );
  }

  async runJob(page) {
    const { url, preDoublefetch } = page;
    if (!url) {
      throw new BadJobError('url missing');
    }
    if (!preDoublefetch) {
      throw new BadJobError('preDoublefetch missing');
    }
    const canonicalUrl = preDoublefetch?.meta?.canonicalUrl;
    const canonicalUrlDiffers = canonicalUrl && canonicalUrl !== url;

    // TODO: perhaps share this cache
    const pageCache = new PageCache();

    const log = logger.debug.bind(logger.debug, `[doublefetch=${url}]`);
    const logWarn = logger.warn.bind(logger.warn, `[doublefetch=${url}]`);

    try {
      const checkUrl = async (urlToTest, { isCanonicalUrl }) => {
        if (await this.newPageApprover.mightBeMarkedAsPrivate(urlToTest)) {
          return { ok: false, details: 'marked as private in bloom filter' };
        }

        const { pageStructure, rejectReason } = await pageCache.doublefetchUrl(
          urlToTest,
        );
        if (!pageStructure) {
          return { ok: false, details: rejectReason };
        }
        if (urlToTest === url) {
          const canonicalUrl2 = pageStructure?.meta?.canonicalUrl;
          const canonicalUrl2Differs =
            canonicalUrl2 &&
            canonicalUrl2 !== canonicalUrl &&
            canonicalUrl2 !== url;
          if (canonicalUrl2Differs) {
            log(
              'Updated canonical URL from',
              canonicalUrl,
              'to',
              canonicalUrl2,
            );
            try {
              const result = checkUrl(canonicalUrl2, { isCanonicalUrl: true });
              if (result.ok) {
                return result;
              }
            } catch (e) {
              if (e.isPermanentError) {
                logWarn(
                  'Failed to process (corrected) canonical URL',
                  canonicalUrl2,
                  '(falling back to original URL now)',
                  e,
                );
                await this._tryMarkAsPrivate(canonicalUrl2);
              } else {
                throw e;
              }
            }
          }
        }

        const { accept, details } = this._structureMatches({
          before: preDoublefetch,
          after: pageStructure,
          page,
        });
        if (!accept) {
          return { ok: false, details };
        }

        const safePage = this._sanitizePage({
          page,
          doublefetchUrl: urlToTest,
          isCanonicalUrl,
          log,
          logWarn,
        });
        if (!safePage) {
          return { ok: false, details: 'rejected by page sanitizer' };
        }
        return { ok: true, safePage };
      };

      let safePage;
      if (canonicalUrlDiffers) {
        try {
          const result = await checkUrl(canonicalUrl, { isCanonicalUrl: true });
          if (result.ok) {
            safePage = result.safePage;
          }
        } catch (e) {
          if (e.isPermanentError) {
            logWarn(
              'Failed to process canonical URL',
              canonicalUrl,
              '(falling back to original URL now)',
              e,
            );
            await this._tryMarkAsPrivate(canonicalUrl);
          } else {
            throw e;
          }
        }
      }

      if (!safePage) {
        const isCanonicalUrl = url === canonicalUrl;
        const result = await checkUrl(url, { isCanonicalUrl });
        if (result.ok) {
          safePage = result.safePage;
        } else {
          await this._tryMarkAsPrivate(url);
          return { ok: false, details: result.details };
        }
      }

      return { ok: true, safePage };
    } catch (e) {
      log('Exception', e);
      throw e;
    }
  }

  /**
   * This comparables the structure the page before and after doublefetch:
   * - before: the real page that the user saw (including dynamic content)
   * - after: parsing the HTML from doublefetch
   *
   * For dynamic pages, it is expected that the structure will not be
   * identical. In some sense, we are comparing apples and oranges; still,
   * it is a useful heuristic to filter out pages that leak private
   * information (mostly, pages that require a login).
   *
   * To get an the intuition, suppose an email websites uses the page title
   * to display the email subject. The doublefetch HTTP request should not
   * include credentials or session tokens (required to access the email).
   * Thus, the title should no longer match, and the message will be dropped.
   */
  _structureMatches({ before, after, page }) {
    const accept = () => ({ accept: true });
    const discard = (reason) => ({ accept: false, details: reason });

    if (before.noindex !== false) {
      logger.warn(
        'noindex pages should have been filtered out already:',
        before,
      );
      return discard('noindex must be false (before)');
    }
    if (after.noindex !== false) {
      return discard('noindex must be false (after)');
    }

    if (isNil(page.title)) {
      return discard('page title missing');
    }
    if (isNil(before.title)) {
      return discard('title missing (before)');
    }
    if (isNil(after.title)) {
      return discard('title missing (after)');
    }

    if (page.url !== before.url) {
      return discard(
        `inconsistency detected: page url does not match url (before): page.url=<<${page.url}>> !== before.url=<<${before.url}>>`,
      );
    }

    if (
      !titlesMatchAfterDoublefetch({
        before: page.title,
        after: after.title,
      })
    ) {
      return discard(
        `titles do not match the page title: <<${before.title}>> ==> <<${after.title}>>`,
      );
    }
    if (
      page.pageLoadMethod !== 'history-navigation' &&
      !titlesMatchAfterDoublefetch({
        before: before.title,
        after: after.title,
      })
    ) {
      return discard(
        `titles do not match the meta title: <<${before.title}>> ==> <<${after.title}>>`,
      );
    }

    return accept();
  }

  _sanitizePage({ page, doublefetchUrl, isCanonicalUrl, log, logWarn }) {
    const safePage = {
      url: doublefetchUrl,
      title: page.title,
      requestedIndex: page.preDoublefetch.requestedIndex,
      lang: {
        html: page.preDoublefetch?.meta?.language || null,
        detect: page.lang || null,
      },
      aggregator: {
        activity: page.aggregator.activity,
      },
    };
    if (safePage.url !== page.url) {
      log('url changed:', page.url, '->', safePage.url);
    }

    if (page.search) {
      const { query, category, depth } = page.search;
      safePage.search = {
        query,
        category,
        depth,
      };

      const { accept, reason } = this.sanitizer.checkSuspiciousQuery(query);
      if (!accept) {
        log('Omitting search query from page:', { query, reason });
        safePage.search.query = null;
      }
    }

    // Run static checks on the URL. Depending on the context, it is more likely
    // that the URL is safe if it has a canonical URL, has been indexed by a search
    // engine, or contains meta information that signal that the page wants to be
    // indexed. Depending on how confident these indicators are, we can either skip
    // the checks or fallback to a more conservative version - even if the latter
    // will lead to safe URLs being dropped.
    const isIndexed = safePage.search && safePage.search.depth === 1;
    if (isCanonicalUrl && isIndexed && safePage.requestedIndex) {
      log(
        'There are strong indicators that the page is public. Skipping static checks for the URL:',
        safePage.url,
      );
    } else if (
      (isCanonicalUrl && (safePage.requestedIndex || isIndexed)) ||
      (safePage.requestedIndex && isIndexed)
    ) {
      const { result, reason } = sanitizeUrl(safePage.url);
      if (result !== 'safe') {
        logWarn(
          'The page appears to be public, but it will be dropped, since it failed standard static checks for the URL',
          safePage.url,
          ':',
          reason,
        );
        return null;
      }
    } else {
      const { result, reason } = sanitizeUrl(safePage.url, { strict: true });
      if (result !== 'safe') {
        log(
          'Failed strict static checks for the URL',
          safePage.url,
          ':',
          reason,
        );
        return null;
      }
    }

    // At this point, we should no longer trust the canonical URL in "meta".
    // The canonical URL that we got after doublefetch is more reliable
    // since it has logic to deal with single-page applications where the
    // meta attributes become outdated.
    safePage.canonicalUrl = isCanonicalUrl ? doublefetchUrl : null;

    const cache = new Map();
    const maskUrl = (url) => {
      let entry = cache.get(url);
      if (!entry) {
        entry = sanitizeUrl(url, { strict: true });
        cache.set(url, entry);
      }
      return entry.safeUrl || null;
    };

    if (page.redirects && page.redirects.length > 0) {
      safePage.redirects = page.redirects.map(({ from, to, statusCode }) => ({
        from: maskUrl(from),
        to: to === '...' ? to : maskUrl(to),
        statusCode,
      }));
    }
    if (page.ref) {
      safePage.ref = maskUrl(page.ref);
    }
    return safePage;
  }

  async _tryMarkAsPrivate(url) {
    try {
      await this.newPageApprover.markAsPrivate(url);
    } catch (e) {
      logger.error('Failed to mark url', url, 'as private', e);
    }
  }
}
