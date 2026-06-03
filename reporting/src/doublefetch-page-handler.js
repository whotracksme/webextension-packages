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
import { requireParam, requireInt, lazyInitAsync } from './utils';
import { randomBetween } from './random';
import { BadJobError } from './errors';
import { anonymousHttpGet } from './http';
import parseHtml from './html-parser';
import { analyzePageStructure } from './page-structure';
import { sanitizeUrl } from './sanitizer';
import { removeSearchHash } from './url-cleaner';

const SECOND = 1000;

const ALLOW_HTML_AND_TEXT = [
  'text/html',
  'text/plain',
  'application/xhtml+xml', // legacy format
];

/**
 * Checks if one string (subsequence) can be derived from another string (sequence)
 * by only removing characters. This means that the subsequence appears in the
 * sequence in the same relative order but not necessarily consecutively.
 *
 * Example: "anana" is a subsequence of "banana", but "ab" is not.
 */
function isSubSequence({ sequence, subsequence }) {
  let i = 0;
  let j = 0;
  while (i < subsequence.length && j < sequence.length) {
    if (subsequence[i] === sequence[j]) {
      i++;
    }
    j++;
  }
  return i === subsequence.length;
}

export function toTrustedUrl(url, { baseUrl, log, logWarn }) {
  if (!url) {
    return null;
  }

  if (!baseUrl.startsWith('https://')) {
    logWarn('baseUrl must be an absolute URL (and https only):', baseUrl);
    return null;
  }
  if (!url.startsWith('https://') && !url.startsWith('/')) {
    // note: relative URL without a leading '/' are technically possible,
    // but uncommon enough that we can ignore. If we handle them, it is
    // opening more possibilities of false-positives.
    log('URL must either absolute or relative with a leading /', url);
    return null;
  }

  let from;
  try {
    from = new URL(baseUrl);
  } catch (e) {
    logWarn('Invalid baseUrl (possible but unexpected):', baseUrl);
    return null;
  }

  let to;
  try {
    to = new URL(url, baseUrl);
  } catch (e) {
    log('Ignore invalid url:', url);
    return null;
  }

  if (from.origin !== to.origin) {
    log('origin mismatch found:', baseUrl, '->', url);
    return null;
  }

  // Normalization (https://example.test/foo#123 => https://example.test/foo).
  // We are looking for the most simple version of the URL
  to.hash = '';
  return to.toString();
}

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

  // sometimes encodings are broken after doublefetch (e.g. "Sánchez" -> "S�nchez")
  if (after.includes('�')) {
    const nonPrintableAscii = /[^\x20-\x7f]/g;
    const brokenBefore = before.replace(nonPrintableAscii, '�');
    const brokenAfter = after.replace(nonPrintableAscii, '�');
    const start = brokenAfter.indexOf(brokenBefore);
    if (start >= 0) {
      let brokenChars = 0;
      for (let i = 0; i < before.length; i += 1) {
        const beforeChar = before.codePointAt(i);
        const afterChar = after.codePointAt(start + i);
        if (beforeChar === afterChar) {
          continue;
        }

        // Tolerate it if a non-printable ASCII character has been replaced by '�'.
        if ((beforeChar < 0x20 || beforeChar > 0x7f) && afterChar === 65533) {
          brokenChars += 1;
        } else {
          return false;
        }
      }

      // Note: this is a bit abitrary, but the idea is to detect
      // if significant parts of the string got replaced
      if (brokenChars < 0.2 * after.length && !after.includes('���')) {
        return true;
      }
    }
  }

  // Removing small parts of text should be generally safe. Note that
  // this is still quite strict; edits like swapping characters or
  // adding a single char will make this heuristic fail.
  if (
    before.length > after.length &&
    after.length > 12 &&
    after.length > 0.75 * before.length &&
    isSubSequence({ sequence: before, subsequence: after })
  ) {
    return true;
  }

  return false;
}

// Conservative list of "@type" fields that related only to the current website.
// In other words, types that are purely navigational should not be listed.
// Same with types that related to other entities like the organization or
// information about the author.
//
// Note: Schema.org is not forced, but it is the most common vocabulary by far.
// Thus a good starting point to extend coverage, is its documentation:
// https://schema.org/docs/full.html
const URL_RELATED_JSONLD_TYPES = new Set([
  // Schema.org
  'article', // covers a relatively common typo (should be "Article")
  'Article',
  'BackgroundNewsArticle',
  'NewsArticle',
  'BlogPosting',
  'PodcastEpisode',
  'ReportageNewsArticle',
  'ScholarlyArticle',
  'TechArticle',
  'VideoObject',
  'WebPage',
]);

export function findAlternativeUrlInJsonLD(jsonld) {
  const { '@type': type, '@id': url } = jsonld;
  if (!url || !type || !url.startsWith('https://')) return null;
  return URL_RELATED_JSONLD_TYPES.has(type) ? url : null;
}

export function aggregateMetaDataInJsonLD(jsonldArray) {
  const matches = [];

  for (const jsonld of jsonldArray) {
    const { '@type': type, '@context': context } = jsonld;
    if (context !== 'http://schema.org' && context !== 'https://schema.org') {
      continue;
    }
    if (!URL_RELATED_JSONLD_TYPES.has(type)) {
      continue;
    }

    const content = {};
    for (const key of [
      'dateCreated',
      'dateModified',
      'datePublished',
      'uploadDate',
      'duration',
    ]) {
      if (jsonld[key]) {
        content[key] = jsonld[key];
      }
    }
    if (Object.keys(content).length > 0) {
      content.type = type;
    }
    matches.push(content);
  }
  if (matches.length === 0) {
    return {};
  }

  // The first always wins, but we can try to merge information
  // from other entries as long as they are not conflicting.
  // It is rare, a use case are entries that are duplicated, but
  // the second entry has extra fields.
  let result = matches.shift();
  for (const other of matches) {
    if (
      Object.entries(result).every(
        ([key, value]) => (other[key] || value) === value,
      )
    ) {
      for (const [key, value] of Object.entries(other)) {
        result[key] ||= value;
      }
    }
  }
  return result;
}

/**
 * Heuristic to reject text that is clearly not a timestamp.
 * It does not have to be extremely precise.
 */
export function looksLikeSafeTimestamp(str) {
  if (typeof str !== 'string') return false;
  if (str.length < 4 || str.length > 40) return false;
  return !isNaN(new Date(str));
}

export function looksLikeSafeDuration(str) {
  if (typeof str !== 'string') return false;
  if (str.length > 20) return false;

  // ISO 8601 durations (https://en.wikipedia.org/wiki/ISO_8601#Durations)
  return /^P(?!$)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/.test(
    str,
  );
}

/**
 * The activity should be number between 0 and 1. To avoid suprises like
 * leaking details such as clock resolution or floating point rounding,
 * apply a bit of noise, truncate after a few digits, and represent it
 * as a string.
 */
export function sanitizeActivity(activity) {
  if (!Number.isFinite(activity) || activity < 0) {
    logger.warn(
      'Corrupted "activity" value detected:',
      activity,
      'Replacing by 0',
    );
    return '0';
  }
  if (activity >= 1) {
    return '1';
  }
  if (activity <= 0) {
    return '0';
  }

  const noisyActivity = activity * randomBetween(0.9, 1.1);
  if (noisyActivity >= 1) {
    return '1';
  }
  if (noisyActivity <= 0) {
    return '0';
  }
  return noisyActivity.toFixed(4);
}

class CachedPageFetcher {
  constructor() {
    this.urlToAsyncPageStructure = new Map();
  }

  async doublefetchUrl(url) {
    let psProvider = this.urlToAsyncPageStructure.get(url);
    if (!psProvider) {
      psProvider = lazyInitAsync(() => this._doublefetchUrl(url));
      this.urlToAsyncPageStructure.set(url, psProvider);
    }
    return psProvider();
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
        return { rejectReason: `unable to fetch page (${e})` };
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
  constructor({
    jobScheduler,
    sanitizer,
    newPageApprover,

    // by default, use a separate fetcher cache per job
    pageFetcherProvider = () => new CachedPageFetcher(),
  }) {
    this.sanitizer = requireParam(sanitizer);
    this.newPageApprover = requireParam(newPageApprover);
    this.pageFetcherProvider = requireParam(pageFetcherProvider);
    this.downloadLimit = 2 * 1024 * 1024; // 2 MB

    const config = {
      priority: -1000,
      maxJobsTotal: 200,
      cooldownInMs: 3 * SECOND,
      maxAutoRetriesAfterError: 1,
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

    const pageFetcher = this.pageFetcherProvider();
    const log = logger.debug.bind(logger.debug, `[doublefetch=${url}]`);
    const logWarn = logger.warn.bind(logger.warn, `[doublefetch=${url}]`);
    const withBaseUrl = (baseUrl) => ({ baseUrl, log, logWarn });
    const canonicalUrl = toTrustedUrl(
      preDoublefetch?.meta?.canonicalUrl,
      withBaseUrl(url),
    );
    const canonicalUrlDiffers = canonicalUrl && canonicalUrl !== url;

    try {
      // shared error handling when testing alternative URLs (e.g. canonical URLs)
      const markAsPrivateOrRethrowToRetry = async (failedUrl, e) => {
        if (e.isPermanentError) {
          logWarn(
            'Alternative URL failed permanently, so mark it as private:',
            failedUrl,
            e,
          );
          await this._tryMarkAsPrivate(failedUrl);
        } else {
          throw e;
        }
      };

      const checkUrl = async (urlToTest, { isCanonicalUrl, level = 0 }) => {
        if (requireInt(level) >= 3) {
          // By design, there should be at most two recursion steps:
          // - level: 0 (initial call) [may recurse]
          // - level: 1 (test discovered candidates) [only new JSON-LD candidates may recurse]
          // - level: 2 (reachable by deep JSON-LD candidate) [may NOT recurse]
          // - level: 3 (unreachable and indicates a bug)
          throw new Error('exceeded maximum recursion level');
        }

        if (await this.newPageApprover.mightBeMarkedAsPrivate(urlToTest)) {
          return { ok: false, details: 'marked as private in bloom filter' };
        }

        const { pageStructure, rejectReason } =
          await pageFetcher.doublefetchUrl(urlToTest);
        if (!pageStructure) {
          return { ok: false, details: rejectReason };
        }

        // Also consider alternative URLs that we just discovered.
        // If we found a canonical URL, we want to try it immediately,
        // even before the actual URL that we want to test (urlToTest).
        //
        // Note: There are more canidates (e.g. JSON-LD), but these
        // will be delayed and only tested with the actual URL fails.
        const canonicalUrlCandidate = toTrustedUrl(
          pageStructure.meta?.canonicalUrl,
          withBaseUrl(urlToTest),
        );
        if (canonicalUrlCandidate) {
          if (!isCanonicalUrl && urlToTest === canonicalUrlCandidate) {
            log(
              'Found a matching canonical URL in doublefetch result for URL:',
              urlToTest,
            );
            isCanonicalUrl = true;
          } else if (
            urlToTest === url &&
            canonicalUrlCandidate !== canonicalUrl
          ) {
            // We detected a potential canonical URL, but since it does not
            // match our original URL, we cannot confirm yet. If it does not
            // work, ignore it and continue.
            log(
              'Updated canonical URL from',
              canonicalUrl,
              'to the candidate',
              canonicalUrlCandidate,
            );
            try {
              const result = await checkUrl(canonicalUrlCandidate, {
                isCanonicalUrl: true,
                level: level + 1,
              });
              if (result.ok) {
                log('Confirmed candidate:', canonicalUrlCandidate);
                return result;
              }
            } catch (e) {
              await markAsPrivateOrRethrowToRetry(canonicalUrlCandidate, e);
            }
            log('Candidate did not work:', canonicalUrlCandidate);
          }
        }

        const { accept, details } = this._structureMatches({
          before: preDoublefetch,
          after: pageStructure,
          page,
          log,
        });
        if (!accept) {
          // Now that the actual URL failed, try other alternative URLs.
          // JSON-LD may include candidates, but they are less trustworthy.
          const mayUseJsonLD = !isCanonicalUrl || level <= 1;
          if (mayUseJsonLD && pageStructure?.meta?.jsonld?.length > 0) {
            for (const jsonld of pageStructure.meta.jsonld) {
              const bestMatch = findAlternativeUrlInJsonLD(jsonld);
              const jsonldCandidateUrl = toTrustedUrl(
                bestMatch,
                withBaseUrl(urlToTest),
              );
              if (
                jsonldCandidateUrl &&
                jsonldCandidateUrl !== canonicalUrl &&
                jsonldCandidateUrl !== urlToTest
              ) {
                log(
                  'Structure did not match, but try a candidate from JSON-LD instead:',
                  jsonldCandidateUrl,
                );
                try {
                  const result = await checkUrl(jsonldCandidateUrl, {
                    isCanonicalUrl: true,
                    level: level + 1,
                  });
                  if (result.ok) {
                    log('Confirmed candidate:', jsonldCandidateUrl);
                    return result;
                  }
                } catch (e) {
                  await markAsPrivateOrRethrowToRetry(jsonldCandidateUrl, e);
                }
                log('JSON-LD candidate did not work:', jsonldCandidateUrl);
                break; // stop after checking one candidate
              }
            }
          }

          // No luck with the alternative URLs either. Give up.
          return { ok: false, details };
        }

        const safePage = this._sanitizePage({
          page,
          doublefetchUrl: urlToTest,
          isCanonicalUrl,
          doublefetchPageStructure: pageStructure,
          log,
          logWarn,
        });
        if (!safePage) {
          return { ok: false, details: 'rejected by page sanitizer' };
        }
        return { ok: true, safePage };
      };

      // Test URLs in this order:
      // 1. Canonical URL (if it exists and differs from the original URL)
      // 2. Original URL
      // 3. Discovered alternative URLs (will trigger recursive calls)
      let safePage;
      if (canonicalUrlDiffers) {
        try {
          // step 1: canonical URL
          const result = await checkUrl(canonicalUrl, { isCanonicalUrl: true });
          if (result.ok) {
            safePage = result.safePage;
          }
        } catch (e) {
          await markAsPrivateOrRethrowToRetry(canonicalUrl, e);
        }
      }

      if (!safePage) {
        // step 2: original URL
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
  _structureMatches({ before, after, page, log }) {
    const accept = () => ({ accept: true });
    const discard = (reason) => ({ accept: false, details: reason });

    if (before.noindex !== false && page.pageLoadMethod === 'full-page-load') {
      logger.warn(
        'noindex pages should have been filtered out already (it was a full-page-load):',
        before,
      );
      return discard('noindex must be false (before)');
    }
    if (after.noindex !== false) {
      return discard('noindex must be false (after)');
    }

    if (!page.title) {
      return discard('page title missing');
    }
    if (!before.title) {
      return discard('title missing (before)');
    }
    if (!after.title) {
      return discard('title missing (after)');
    }

    if (page.url !== before.url) {
      // Before giving up, try a relaxed match where the URL hash of the original URL
      // is ignored. Note that for the page itself, the hash should have been already
      // removed in a previous step.
      // Note: this is relevant to handle URLs like "https://pytorch.org/docs/stable/torch.html#tensors"
      const safeToIgnoreHash =
        page.pageLoadMethod === 'full-page-load' ||
        (page.title === before.title && before.title === after.title);
      if (safeToIgnoreHash && page.url === removeSearchHash(before.url)) {
        log(
          'The page url',
          page.url,
          'does not exactly match the original URL',
          before.url,
          'However, it is identical when ignoring the hash in the original URL.',
          'Based on the other information, it looks safe to continue.',
        );
      } else {
        return discard(
          `inconsistency detected: page url does not match url (before): page.url=<<${page.url}>> !== before.url=<<${before.url}>>`,
        );
      }
    }

    // Now, confirm the title, or more precise the "page title".
    // There are three types of titles:
    // 1) "page title": the title from the tab API (should be what the user saw)
    // 2) "DOM title": the title in the "page-structure" (before doublefetch)
    // 3) "doublefetch title(s)": again, extract by "page-structure", but not from
    //    the real document, but from the parsed HTML *after* a doublefetch request.
    //
    // Candidates for the "doublefetch title":
    // There is always the main title (typically <title>...</title>), but
    // we can safely try fallback like "og:title" (Open Graph Meta Tags).
    const doublefetchTitles = [after.title];
    if (after?.meta?.og?.title && after.meta.og.title !== after.title) {
      doublefetchTitles.push(after.meta.og.title);
    }

    const confirmTitle = (before) =>
      doublefetchTitles.some((after) =>
        titlesMatchAfterDoublefetch({ before, after }),
      );

    // Always confirm the "page title" (it will be part of the message)
    if (!confirmTitle(page.title)) {
      return discard(
        `no match for the 'page title' (tab API): <<${
          page.title
        }>> ==> ${JSON.stringify(doublefetchTitles)}`,
      );
    }

    // When a page gets loaded, the "page title" and "DOM title" should generally match.
    // But for single-page applications, it is possible that the "DOM title" gets outdated,
    // because the content may not be fully updated during the history navigations.
    // This is why this step needs to be optional (to avoid false-negatives).
    if (
      page.pageLoadMethod !== 'history-navigation' &&
      !confirmTitle(before.title)
    ) {
      return discard(
        `no match for the 'DOM title' (extracted via 'page-structure'): <<${
          before.title
        }>> ==> ${JSON.stringify(doublefetchTitles)}`,
      );
    }

    return accept();
  }

  _sanitizePage({
    page,
    doublefetchUrl,
    isCanonicalUrl,
    doublefetchPageStructure,
    log,
    logWarn,
  }) {
    const safePage = {
      url: doublefetchUrl,
      title: page.title,
      requestedIndex: page.preDoublefetch.requestedIndex,
      lang: {
        html: page.preDoublefetch?.meta?.language || null,
        detect: page.lang || null,
      },
      aggregator: {
        activity: sanitizeActivity(page.aggregator.activity),
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
    } else if (isCanonicalUrl || isIndexed || safePage.requestedIndex) {
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

    if (doublefetchPageStructure.meta?.jsonld?.length > 0) {
      const { type, ...safeFields } = aggregateMetaDataInJsonLD(
        doublefetchPageStructure.meta.jsonld,
      );
      if (type) {
        safePage.jsonld = { type };

        // timestamps
        for (const key of [
          'dateCreated',
          'dateModified',
          'datePublished',
          'uploadDate',
        ]) {
          const timestamp = safeFields[key];
          if (looksLikeSafeTimestamp(timestamp)) {
            safePage.jsonld[key] = timestamp;
          }
        }

        // durations (currently only the field "duration")
        if (looksLikeSafeDuration(safeFields.duration)) {
          safePage.jsonld.duration = safeFields.duration;
        }
      }
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
