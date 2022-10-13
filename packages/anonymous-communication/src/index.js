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
import { InvalidMessageError } from './errors.js';
import { getTrustedUtcTime, getTimeAsYYYYMMDD } from './timestamps.js';

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
  }

  async send(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new InvalidMessageError('Input message must be an object');
    }
    if (!msg.action) {
      throw new InvalidMessageError('Mandatory field "action" is missing');
    }
    msg.channel = this.config.CHANNEL;
    msg.ts = getTimeAsYYYYMMDD();
    return this.proxiedHttp.send({
      body: JSON.stringify(msg),
    });
  }

  getTrustedUtcTime() {
    return getTrustedUtcTime();
  }
}
