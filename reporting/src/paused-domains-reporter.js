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
import { requireParam } from './utils';

export default class PausedDomainsReporter {
  constructor({ filterModeProvider }) {
    this.active = false;
    this.filterModeProvider = requireParam(filterModeProvider);
  }

  async init() {
    this.active = true;
  }

  unload() {
    this.active = false;
  }

  onPauseEvent({ hostname, paused }) {
    if (!this.active) {
      return;
    }

    logger.info(hostname, 'is now', paused ? 'paused' : 'unpaused');
    const filterMode = this.filterModeProvider();
    const event = { filterMode, hostname, paused, ts: Date.now() };

    this._processEvent(event).catch((e) => {
      logger.error('Failed to process event', event, e);
    });
  }

  async _processEvent(event) {
    // TODO:
    logger.warn(
      '[STUB] handing of pause/unpause is not yet implemented',
      event,
    );
  }
}
