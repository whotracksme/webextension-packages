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

// In-memory storage would disable every persistence path in the library.
export function createStorage(namespace) {
  const prefix = `${namespace}::`;
  const scopedKey = (key) => `${prefix}${key}`;

  return {
    async get(key) {
      const result = await chrome.storage.local.get(scopedKey(key));
      return result[scopedKey(key)];
    },
    async set(key, value) {
      await chrome.storage.local.set({ [scopedKey(key)]: value });
    },
    async remove(key) {
      await chrome.storage.local.remove(scopedKey(key));
    },
    async clear() {
      const all = await chrome.storage.local.get(null);
      const owned = Object.keys(all).filter((key) => key.startsWith(prefix));
      if (owned.length > 0) {
        await chrome.storage.local.remove(owned);
      }
    },
    async keys() {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length));
    },
    open() {},
    close() {},
  };
}

export function createTrustedClock() {
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const parts = (date) => ({
    year: pad(date.getUTCFullYear(), 4),
    month: pad(date.getUTCMonth() + 1),
    day: pad(date.getUTCDate()),
    hour: pad(date.getUTCHours()),
  });

  return {
    getTimeAsYYYYMMDD() {
      const { year, month, day } = parts(new Date());
      return `${year}${month}${day}`;
    },
    getTimeAsYYYYMMDDHH() {
      const { year, month, day, hour } = parts(new Date());
      return `${year}${month}${day}${hour}`;
    },
  };
}
