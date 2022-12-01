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

const HOUR = 1000 * 60 * 60;

/**
 * Responsible for sending "alive" messages. Alive messages exist
 * to monitor whether the client side of WhoTracks.me reporting
 * is healthy.
 *
 * By separating alive messages from more sensitive messages (e.g.
 * one that may contain a URL), we can include additional information
 * (like the browser) without risking to introduce fingerprinting.
 * Given that there is a correlation between the number of sent
 * "alive" messages and the number of other messages that enables us
 * to detect scenerios like a message drop after a browser release.
 *
 * Note that putting information like the browser directly inside
 * all (non-alive) messages would solve the monitoring problem
 * but at the cost of potentially introducing fingerprinting.
 * Separating monitoring (alive) and other messages limits the
 * risk: even if you could link "alive" messages, they do not
 * contain sensitive information.
 */
export default class AliveCheck {
  constructor({
    communication,
    countryProvider,
    trustedClock,
    storage,
    storageKey,
  }) {
    this.communication = communication;
    this.countryProvider = countryProvider;
    this.trustedClock = trustedClock;
    this.storage = storage;
    this.storageKey = storageKey;
    this._skipChecksUntil = 0; // Unix timestamp
  }

  /**
   * Guaranteed to finish fast and never fail. Callers can safely execute it from
   * at any place. Since "alive" messages should correlate with activity, this
   * should be called from places like page visits (triggered by human interaction).
   *
   * What counts as "activity" is currently not specified. A vague definition is
   * that if a user keeps actively using the browser, it should trigger an "alive"
   * message eventually; but if there is no user interaction and the device is idle,
   * it should eventually stop sending signals.
   */
  ping(now = Date.now()) {
    this._check(now).catch((e) => {
      logger.warn('Error while processing alive checks', e);
    });
  }

  async _check(now = Date.now()) {
    if (this._pendingUpdate || now < this._skipChecksUntil) {
      return;
    }

    this._pendingUpdate = (async () => {
      try {
        logger.debug('Checking whether a hourly ping should be sent...');
        const lastSent = await this.storage.get(this.storageKey);

        const updateSentAt = () =>
          this.storage.set(this.storageKey, { sentAt: now });

        if (!lastSent) {
          logger.info(
            'Last alive check not found. This should only happen on the first time the extension is started.',
          );
          await updateSentAt();
          return;
        } else if (lastSent.sentAt > now) {
          const now_ = new Date(now);
          const sentAt_ = new Date(lastSent.sentAt);
          logger.warn(
            `Clock jump detected (now=${now_} but sentAt=${sentAt_} is in the future). Resetting counter.`,
          );
          await updateSentAt();
          return;
        } else if (lastSent.sentAt + HOUR > now) {
          logger.debug(
            'Checking whether a hourly ping should be sent... No reached yet.',
          );
          this._skipChecksUntil = lastSent.sentAt + HOUR;
          return;
        }

        logger.debug('Hourly ping reached. Sending...');
        await this._reportAlive();
        this._skipChecksUntil = now + HOUR;
        logger.debug('Hourly ping successfully sent. Saving state...');
        await updateSentAt();
        logger.debug('Hourly ping succeeded.');
      } finally {
        this._pendingUpdate = null;
      }
    })();
    await this._pendingUpdate;
  }

  async _reportAlive() {
    // TODO: here we start with a minimal message. In a later step,
    // we should include information about the browser. When we add
    // more fields here, best be conservative and add a check for
    // quorum. since the message is minimal hour+country, we don't
    // need that extra step for now.
    const message = {
      action: 'wtm.alive',
      ver: 1,
      payload: {
        t: this.trustedClock.getTimeAsYYYYMMDDHH(),
        ctry: this.countryProvider.getSafeCountryCode(),
      },
    };
    logger.debug('Sending alive:', message);
    await this.communication.send(message);
  }
}
