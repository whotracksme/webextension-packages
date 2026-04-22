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

const STORAGE_KEY = 'wtm-request-reporting:reported-documents';
const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * documentIds that were already reported, persisted in
 * chrome.storage.session with a 5-minute TTL. Survives SW shutdown;
 * cleared on browser restart (documentIds are session-scoped anyway).
 * LRU-bounded by MAX_ENTRIES to stay within the storage quota.
 */
export default class ReportedDocuments {
  #sessionApi;
  #entries;
  #ready;

  constructor({
    sessionApi = typeof chrome !== 'undefined' && chrome?.storage?.session,
    ttlMs = TTL_MS,
    maxEntries = MAX_ENTRIES,
  } = {}) {
    this.#sessionApi = sessionApi;
    this.#entries = new Map();
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  async init() {
    this.#ready ||= new Promise((resolve) => {
      this.#sessionApi.get([STORAGE_KEY], (result) => {
        const raw = (result && result[STORAGE_KEY]) || {};
        const now = Date.now();
        for (const [docId, expireAt] of Object.entries(raw)) {
          if (expireAt > now) {
            this.#entries.set(docId, expireAt);
          }
        }
        resolve();
      });
    });
    return this.#ready;
  }

  has(documentId) {
    if (!documentId) return false;
    this.#evictExpired();
    return this.#entries.has(documentId);
  }

  add(documentId) {
    if (!documentId) return;
    this.#evictExpired();
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest !== undefined) {
        this.#entries.delete(oldest);
      }
    }
    this.#entries.set(documentId, Date.now() + this.ttlMs);
    this.#persist();
  }

  #evictExpired() {
    const now = Date.now();
    for (const [docId, expireAt] of this.#entries) {
      if (expireAt <= now) {
        this.#entries.delete(docId);
      }
    }
  }

  #persist() {
    this.#sessionApi?.set?.({
      [STORAGE_KEY]: Object.fromEntries(this.#entries),
    });
  }
}
