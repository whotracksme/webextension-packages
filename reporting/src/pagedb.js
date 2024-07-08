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
import SeqExecutor from './seq-executor';
import { chunk, equalityCanBeProven } from './utils';
import SelfCheck from './self-check';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

const DEFAULT_PAGE_COOLDOWN_IN_MS = 1 * HOUR;

function normalizeUrl(url) {
  try {
    // Remove URL fragement:
    //    https://abc.test/foo#bar
    // -> https://abc.test/foo
    const tmp = new URL(url);
    tmp.hash = '';
    return tmp.toString();
  } catch (e) {
    // It is not necessarily a bug this code path hits, but ideally
    // invalid URLs should have been filtered already.
    logger.warn('Bad URL detected:', url, '(ignore this page and continue)');
    return null;
  }
}

export function toPersistedKey(url, createdAt) {
  return `${createdAt}:${url}`;
}

export function parsePersistedKey(key) {
  const pos = key.indexOf(':');
  if (pos === -1) {
    throw new Error(`Corrupted key (<${key}>)`);
  }
  const createdAt = +key.slice(0, pos);
  if (isNaN(createdAt)) {
    throw new Error(
      `Corrupted key (<${key}>). Failed to parse timestamp (<${createdAt}>)`,
    );
  }
  const url = key.slice(pos + 1);
  return { createdAt, url };
}

/**
 * The data fields of the page description that needs to be
 * persisted to disk.
 */
const pageDataSchema = [
  'url',
  'status',
  'pageLoadMethod',
  'title',
  'search',
  'ref',
  'redirects',
  'preDoublefetch',
  'lang',
  'lastUpdatedAt',
];

/**
 * Project only on the set of fields that we need. When the "page" class
 * describe its current state, it may include additional fields in its
 * description.
 *
 * This function also defines the (implicit) schema of the documents that
 * we store in the database.
 */
function pageWithAggregationInfo(page, now = Date.now()) {
  const result = {
    aggregator: {
      // Timestamps when the page aggregator first and last saw it.
      // This is not equivalent to when the page was opened or closed,
      // but rather when it reached the page aggregator and how long
      // it stayed there.
      firstSeenAt: now,
      lastSeenAt: now,

      // The timestamp when it was stored in the database
      // (or "null" as long as it is only kept in memory).
      lastWrittenAt: null,

      activity: page.activity ?? 0.0,
    },
  };

  pageDataSchema.forEach((field) => {
    if (page[field] !== undefined) {
      result[field] = page[field];
    }
  });
  return result;
}

/**
 * In general, it is best to prefer the latest information; but there
 * are special cases where it would lose information
 */
function shouldOverrideField({ field, oldEntry, newEntry }) {
  if (newEntry === undefined) {
    return false;
  }
  if (oldEntry === undefined) {
    return true;
  }

  // prefer entries with "depth === 1", since it implies that
  // the page is publically indexed
  if (field === 'search') {
    return newEntry.depth === 1 || oldEntry.depth !== 1;
  }

  // fallback: prefer the newer entry
  return true;
}

function mergeRightIntoLeft(left, right) {
  pageDataSchema.forEach((field) => {
    const oldEntry = left[field];
    const newEntry = right[field];
    if (shouldOverrideField({ field, oldEntry, newEntry })) {
      left[field] = newEntry;
    }
  });

  left.aggregator.firstSeenAt = Math.min(
    left.aggregator.firstSeenAt,
    right.aggregator.firstSeenAt,
  );
  left.aggregator.lastSeenAt = Math.max(
    left.aggregator.lastSeenAt,
    right.aggregator.lastSeenAt,
  );
  left.aggregator.lastWrittenAt = null;
  left.aggregator.activity = Math.max(
    left.aggregator.activity,
    right.aggregator.activity,
  );

  return left;
}

/**
 * Merges information together. If there is conflicting information,
 * the newest information should win. The function may perform
 * updates in-place.
 */
function mergePages(pages) {
  if (pages.length === 0) {
    throw Error('Internal error: the list of pages cannot be empty');
  }
  pages.sort((x, y) => x.lastUpdatedAt - y.lastUpdatedAt);

  let merged = pages[0];
  for (let i = 1; i < pages.length; i += 1) {
    merged = mergeRightIntoLeft(merged, pages[i]);
  }
  return merged;
}

export default class PageDB {
  constructor({ newPageApprover, database }) {
    this.newPageApprover = newPageApprover;
    this.db = database;
    this._dbLock = new SeqExecutor();
    this.maxAllowedMappings = 2000;

    // An in-memory cache of the database. The keys will be always
    // in sync with the database, but the entries will be lazy-loaded.
    // Initially, the entries will start as "null"; but once a key has
    // been loaded, it will be kept in memory. The assumption is that
    // the memory footprint is no concern. Instead, lazy-loading is
    // intended to improve startup performance.
    this.aggregatedPages = new Map(); // url -> page|null
    this.urlsToPersistedKeys = new Map(); // url -> key
    this.dirty = new Set(); // keys: url

    // sorted by timestamp (with the oldest entry at first position)
    this.expiration = []; // entries: { url, createdAt }

    this.verboseLogging = false;
  }

  async ready() {
    if (!this._ready) {
      this._ready = this._restoreKeysFromDisk();
    }
    await this._ready;
  }

  async updatePages(openPages_, activePage_) {
    await this.ready();
    await this._dbLock.run(async () => {
      // First, normalize all URLs that will be used as keys
      const openPages = openPages_
        .map((page) => ({ ...page, url: normalizeUrl(page.url) }))
        .filter((page) => page.url);
      let activePage = null;
      if (activePage_) {
        const url = normalizeUrl(activePage_.url);
        if (url) {
          activePage = { ...activePage_, url };
        }
      }

      // It is possible that the same page is opened in multiple tabs
      const openPagesMultimap = new Map();
      const now = Date.now();
      for (const page of openPages) {
        const url = normalizeUrl(page.url);
        const pageWithInfo = pageWithAggregationInfo(page, now);
        let value = openPagesMultimap.get(url);
        if (value) {
          value.push(pageWithInfo);
        } else {
          openPagesMultimap.set(url, [pageWithInfo]);
        }
      }
      const activeUrl = activePage?.url;

      const pending = [];
      for (const [url, pages] of openPagesMultimap) {
        const inMemoryEntry = this.aggregatedPages.get(url);
        if (inMemoryEntry === undefined) {
          pending.push(
            (async () => {
              const { ok, reason } = await this.newPageApprover.allowCreation(
                url,
                now,
              );
              if (ok) {
                logger.debug('New page found:', url);
                const page = mergePages(pages);
                this.aggregatedPages.set(url, page);
                this.urlsToPersistedKeys.set(url, toPersistedKey(url, now));
                this.expiration.push({ url, createdAt: now });
                this._markPageAsDirty(url);
              } else {
                logger.debug(
                  'Skipping aggregation for url',
                  url,
                  ':',
                  reason || '<no reason given>',
                );
              }
            })(),
          );
        } else {
          const shouldUpdate =
            url == activeUrl ||
            (inMemoryEntry !== null &&
              pages.some((x) => x.lastUpdatedAt) > inMemoryEntry.lastUpdatedAt);
          if (shouldUpdate) {
            const updateDB = (oldEntry) => {
              const page = mergePages([oldEntry, ...pages]);
              this.aggregatedPages.set(url, page);
              this._markPageAsDirty(url);
            };
            if (inMemoryEntry === null) {
              logger.debug('Loading page from disk:', url);
              pending.push(
                (async () => {
                  const persistedKey = this.urlsToPersistedKeys.get(url);
                  const contentFromDB = await this.db.get(persistedKey);
                  if (contentFromDB) {
                    updateDB(contentFromDB);
                  } else {
                    logger.warn(
                      'Mappings out of sync: key',
                      persistedKey,
                      'vanished (skipping update)',
                    );
                  }
                })(),
              );
            } else {
              updateDB(inMemoryEntry);
            }
          }
        }
      }
      if (pending.length > 0) {
        await Promise.all(pending); // TODO: what to do if this fails?
      }
    });
  }

  async updateActivity(urls, activityEstimator) {
    await this.ready();
    return this._dbLock.run(async () => {
      const now = Date.now();
      const pending = [];
      for (const url_ of urls) {
        const url = normalizeUrl(url_);
        const persistedKey = this.urlsToPersistedKeys.get(url);
        if (persistedKey) {
          const score = activityEstimator.estimate(url, now);
          if (score > 0.0) {
            const updateScore = (entry) => {
              if (score > entry.aggregator.activity) {
                entry.aggregator.activity = score;
                this._markPageAsDirty(url);
              }
            };
            const inMemoryEntry = this.aggregatedPages.get(url);
            if (inMemoryEntry === null) {
              logger.debug('Loading page from disk:', url);
              pending.push(
                (async () => {
                  const contentFromDB = await this.db.get(persistedKey);
                  if (contentFromDB) {
                    this.aggregatedPages.set(url, contentFromDB);
                    updateScore(contentFromDB);
                  } else {
                    logger.warn(
                      'Mappings out of sync: key',
                      persistedKey,
                      'vanished (skipping update)',
                    );
                  }
                })(),
              );
            } else {
              updateScore(inMemoryEntry);
            }
          }
        }
      }
      if (pending.length > 0) {
        await Promise.all(pending); // TODO: what to do if this fails?
      }
    });
  }

  /**
   * Scans for expired pages. That means, for pages that have been in the
   * aggregation state long enough.
   *
   * Hint: the behavior can be overriden, which can be useful for debugging.
   */
  async acquireExpiredPages({
    minPageCooldownInMs = DEFAULT_PAGE_COOLDOWN_IN_MS,
    forceExpiration = false,
    maxEntriesToCheck = 1,
  } = {}) {
    await this.ready();
    return this._dbLock.run(async () => {
      let end;
      if (forceExpiration) {
        end = this.expiration.length;
        logger.debug('Forcing expiration of all entries:', end, 'in total');
      } else {
        const maxEnd = Math.min(this.expiration.length, maxEntriesToCheck);
        const now = Date.now();
        end = 0;
        while (
          end < maxEnd &&
          now >= this.expiration[end].createdAt + minPageCooldownInMs
        ) {
          end += 1;
        }
        if (end > 0 || this.verboseLogging) {
          logger.debug(end, 'of', this.expiration.length, 'pages expired');
        }
      }
      if (end === 0) {
        return [];
      }

      const expired = this.expiration.splice(0, end);
      logger.debug('Processing expired pages:', expired);
      const allExpiredPages = await Promise.all(
        expired.map(async ({ url }) => {
          const persistedKey = this.urlsToPersistedKeys.get(url);
          let page;
          try {
            page = this.aggregatedPages.get(url);
            if (page === null) {
              logger.debug('Loading expired page from disk:', persistedKey);
              page = await this.db.get(persistedKey);
            }

            const { promotedPage } = await this._processExpiredPage(url, page);
            return promotedPage;
          } catch (e) {
            logger.error('Failed to process URL:', { url, page }, e);
            return null;
          } finally {
            this.aggregatedPages.delete(url);
            this.urlsToPersistedKeys.delete(url);
            this.dirty.delete(url);
            await this.db.remove(persistedKey).catch(console.warn);
          }
        }),
      );
      const promotedPages = allExpiredPages.filter((x) => x);
      logger.info(
        promotedPages.length,
        'expired pages have been promoted to the next step:',
        promotedPages,
      );
      return promotedPages;
    });
  }

  async _processExpiredPage(url, page) {
    const reject = (reason) => {
      logger.debug('Dropping page:', { url, reason, page });
      return { promotedPage: null, reason };
    };

    const rejectForever = async (reason) => {
      logger.info('Mark page as private:', { url, reason, page });
      try {
        await this.newPageApprover.markAsPrivate(url);
      } catch (e) {
        logger.error('Failed to mark url', url, 'as private', e);
      }
      return { promotedPage: null, reason };
    };

    // check that page has complete information
    if (!page.preDoublefetch) {
      return reject('incomplete information: preDoublefetch missing');
    }
    if (page.status !== 'complete') {
      return reject('incomplete information: page not fully loaded');
    }

    // check static heuristics
    if (page.preDoublefetch.noindex) {
      return rejectForever('marked as noindex');
    }
    if (page.search && page.search.depth === 0) {
      return rejectForever('ignore search engine result pages');
    }

    return { promotedPage: page };
  }

  async flush() {
    this._clearAutoFlush();
    if (this.dirty.size === 0) {
      return;
    }

    const pendingKeys = [...this.dirty];
    this.dirty.clear();
    if (this.verboseLogging) {
      logger.debug(
        'flushing',
        pendingKeys.length,
        'keys to disk:',
        pendingKeys,
      );
    }

    const now = Date.now();
    await Promise.all(
      pendingKeys.map(async (url) => {
        const entry = this.aggregatedPages.get(url);
        if (entry) {
          entry.aggregator.lastWrittenAt = now;
          const persistedKey = this.urlsToPersistedKeys.get(url);
          await this.db.set(persistedKey, entry);
        } else {
          logger.warn(
            `Corrupted state: key=${url} marked as dirty, but not present. Ignoring and continuing...`,
          );
        }
      }),
    );
    if (this.verboseLogging) {
      logger.debug(pendingKeys.length, 'keys successfully written');
    }
  }

  _markPageAsDirty(url) {
    this.dirty.add(url);
    if (!this._autoFlushTimer) {
      this._autoFlushTimer = setTimeout(() => {
        this.flush().catch(logger.error);
      }, 100); // TODO: reconsider
    }
  }

  _clearAutoFlush() {
    if (this._autoFlushTimer) {
      clearTimeout(this._autoFlushTimer);
      this._autoFlushTimer = null;
    }
  }

  /**
   * Hopefully this should not be reached. It is a fail-safe if the extension starts
   * producing more keys than it deletes. If this happen, it can only be because of a bug
   * (or if the threshold was unrealistically small).
   */
  async _emergencyCleanup(allKeys) {
    logger.error(
      `The keys on the profile ran full: ${allKeys.length} keys, but the limit is ${this.maxAllowedMappings}.`,
      'Purging now to prevent performance impacts.',
    );

    // This is not an efficient to delete lots of values from IndexedDB;
    // batching is done only to avoid freezing the browser when deleting possibly
    // thousands of entries at the same time.
    let count = 0;
    for (const keyBatch of chunk(allKeys, 100)) {
      await Promise.all(keyBatch.map((key) => this.db.remove(key)));
      count += keyBatch.length;
      logger.info(
        `Emergency cleanup in progress: ${count} of ${allKeys.length} deleted`,
      );
    }
    logger.info('Emergency cleanup finished:', count, 'keys deleted');
  }

  async _restoreKeysFromDisk() {
    if (
      this.aggregatedPages.size !== 0 ||
      this.urlsToPersistedKeys.size !== 0 ||
      this.dirty.size !== 0 ||
      this.expiration.length !== 0
    ) {
      throw new Error('Illegal state');
    }

    const allKeys = await this.db.keys();
    if (allKeys.length > this.maxAllowedMappings) {
      await this._emergencyCleanup(allKeys).catch((e) => {
        logger.error('Unexpected error during emergency cleanup', e);
      });
    } else {
      // preparation: validate keys and group by url
      // (to verify that URLs in the keys are unique)
      const now = Date.now();
      const badKeys = [];
      const groupedByUrl = new Map();
      allKeys.forEach((key) => {
        try {
          const { createdAt, url } = parsePersistedKey(key);
          if (createdAt > now + 5 * MINUTE) {
            throw new Error(`Timestamp lies in the future: ${createdAt}`);
          }
          let entry = groupedByUrl.get(url);
          if (entry) {
            entry.push({ createdAt, url, key });
          } else {
            groupedByUrl.set(url, [{ createdAt, url, key }]);
          }
        } catch (e) {
          logger.warn('Corrupted key detected:', key, e);
          badKeys.push(key);
        }
      });

      for (const group of groupedByUrl.values()) {
        if (group.length === 1) {
          const { createdAt, url, key } = group[0];
          this.aggregatedPages.set(url, null); // pages are lazy loaded
          this.urlsToPersistedKeys.set(url, key);
          this.expiration.push({ url, createdAt });
        } else {
          const duplicatedKeys = group.map((x) => x.key);
          logger.warn(
            'Assumption violated that URLs are unique:',
            duplicatedKeys,
          );
          badKeys.push(...duplicatedKeys);
        }
      }
      this.expiration.sort((x, y) => x.createdAt - y.createdAt);

      if (badKeys.length > 0) {
        await Promise.all(
          badKeys.map(async (key) => {
            try {
              await this.db.remove(key);
            } catch (e) {
              logger.warn(`Failed to delete key=${key}`, e);
            }
          }),
        );
        logger.warn(badKeys.length, 'corrupted keys deleted:', badKeys);
      }
    }
  }

  /**
   * Intended for debugging and testing only.
   */
  async describeState({ inMemoryOnly = false } = {}) {
    return this._dbLock.run(async () => {
      const result = {
        keys: {},
        memory: {},
        dirty: [...this.dirty],
      };
      if (!inMemoryOnly) {
        result.disk = {};
      }
      await Promise.all(
        [...this.aggregatedPages].map(async ([url, page]) => {
          const key = this.urlsToPersistedKeys.get(url);
          let state;
          if (this.dirty.has(url)) {
            state = 'dirty';
          } else {
            state = page !== null ? 'loaded' : 'not loaded';
          }
          result.keys[url] = {
            state,
            keyInDB: key,
          };
          result.memory[url] = page;
          if (!inMemoryOnly) {
            try {
              result.disk[key] = await this.db.get(key);
            } catch (e) {
              logger.warn(
                `Unable to load page from disk (url=${url}, persistedKey=${key})`,
                e,
              );
            }
          }
        }),
      );
      return result;
    });
  }

  async selfChecks(check = new SelfCheck()) {
    if (this.aggregatedPages.size > this.maxAllowedMappings) {
      check.warn('Number of persisted pages exceeds limits', {
        numKeys: this.aggregatedPages.size,
        limit: this.maxAllowedMappings,
      });
    }
    const urls1 = [...this.aggregatedPages.keys()].sort();
    const urls2 = [...this.urlsToPersistedKeys.keys()].sort();
    const urls3 = this.expiration.map((x) => x.url).sort();
    if (
      !equalityCanBeProven(urls1, urls2) ||
      !equalityCanBeProven(urls1, urls3)
    ) {
      check.fail('Logical bug: data structures out of sync');
    }
    for (let i = 0; i < this.expiration.length - 1; i += 1) {
      if (this.expiration[i].createdAt > this.expiration[i + 1].createdAt) {
        check.fail('Logical bug: expirations are not ordered');
        break;
      }
    }
    return check;
  }
}
