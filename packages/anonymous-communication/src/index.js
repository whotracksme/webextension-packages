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

import ServerPublicKeyAccessor from './server-public-key-accessor.js';
import ProxiedHttp from './proxied-http.js';
import { sortObjectKeys } from './utils.js';
import { InvalidMessageError } from './errors.js';
import { TrustedClock } from './trusted-clock.js';

export default class AnonymousCommunication {
  constructor({ config, storage }) {
    this.serverPublicKeyAccessor = new ServerPublicKeyAccessor({
      config,
      storage,
      storageKey: 'wtm.anonymous-communication.server-ecdh-keys',
    });
    this.config = config;
    if (!config.CHANNEL) {
      throw new Error('CHANNEL is missing on the config object');
    }
    this.proxiedHttp = new ProxiedHttp(config, this.serverPublicKeyAccessor);
    this.trustedClock = new TrustedClock();
  }

  async send(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new InvalidMessageError('Input message must be an object');
    }
    if (!msg.action) {
      throw new InvalidMessageError('Mandatory field "action" is missing');
    }

    // Add meta fields (channel, ts) if absent.
    //
    // Implementation details:
    // * Avoid accessing the clock if it is not needed, as the operation may
    //   fail in rare situations if the clock is out of sync
    // * Sorting keys prevents that details about how the message was
    //   constructed leaks through the JSON representation to the server
    const ts = msg.ts || this.trustedClock.getTimeAsYYYYMMDD();
    const fullMessage = {
      channel: this.config.CHANNEL,
      ts,
      ...msg,
    };
    return this.proxiedHttp.send({
      body: JSON.stringify(sortObjectKeys(fullMessage)),
    });
  }
}
