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

import { determineEndOfPageCooldown } from '../../src/new-page-approver.js';

/**
 * In-memory implementation of NewPageApprover
 */
export class InMemoryNewPageApprover {
  constructor() {
    this._markedAsPrivate = new Set();
    this._cooldowns = new Map();
  }

  async allowCreation(url, now = Date.now()) {
    const reject = (reason) => ({ ok: false, reason: `[mock] ${reason}` });
    const cooldownUntil = this._cooldowns.get(url);
    if (cooldownUntil && now <= cooldownUntil) {
      return reject('not yet expired');
    }
    if (this._markedAsPrivate.has(url)) {
      return reject('marked as private');
    }

    const expireAt = determineEndOfPageCooldown(now);
    this._cooldowns.set(url, expireAt);
    return { ok: true };
  }

  async markAsPrivate(url) {
    this._markedAsPrivate.set(url);
  }
}
