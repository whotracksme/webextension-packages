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

/**
 * Implements the chrome.storage.session API.
 *
 * Note: this is the promised based implementation (MV3), but currently
 * the optional callbacks are not (the old API) are not implemented.
 */
export default class FakeSessionApi {
  constructor() {
    this._entries = new Map();
  }

  async get(keys) {
    if (keys === null || keys === undefined) {
      return Object.fromEntries(this._entries.entries());
    }

    const result = {};
    if (Array.isArray(keys)) {
      keys.forEach((key) => {
        if (this._entries.has(key)) {
          result[key] = this._entries.get(key);
        }
      });
    } else if (typeof keys === 'string') {
      if (this._entries.has(keys)) {
        result[keys] = this._entries.get(keys);
      }
    } else {
      Object.entries(keys).forEach(([key, val]) => {
        if (this._entries.has(key)) {
          result[key] = this._entries.get(key);
        } else {
          result[key] = val;
        }
      });
    }
    return result;
  }

  async set(keys) {
    Object.entries(keys).forEach(([key, val]) => {
      this._entries.set(key, val);
    });
  }

  async remove(keys) {
    if (!Array.isArray(keys)) {
      keys = [keys];
    }
    keys.forEach((key) => {
      this._entries.delete(key);
    });
  }

  async clear() {
    this._entries.clear();
  }
}
