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

export default class AnonymousCommunication {
  constructor({ config, storage }) {
    this.serverPublicKeyAccessor = new ServerPublicKeyAccessor({
      config,
      storage,
      storageKey: 'server-ecdh-keys',
    });
    this.proxiedHttp = new ProxiedHttp(config, this.serverPublicKeyAccessor);
  }
}
