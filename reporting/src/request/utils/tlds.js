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

import * as tldts from 'tldts-experimental';

const TLDTS_OPTIONS = {
  detectIp: true,
  extractHostname: true,
  mixedInputs: false,
  validateHostname: true,
  validHosts: ['localhost'],
};

function parse(url) {
  const parsed = tldts.parse(url, TLDTS_OPTIONS);

  if (parsed.isIp) {
    parsed.domain = parsed.hostname;
  }

  return parsed;
}

const getGeneralDomain = (url) => parse(url).domain;

function sameGeneralDomain(uri1, uri2) {
  if (uri1 === uri2) {
    return true;
  }

  const domain1 = getGeneralDomain(uri1);
  const domain2 = getGeneralDomain(uri2);

  return domain1 !== null && domain2 !== null && domain1 === domain2;
}

export { getGeneralDomain, sameGeneralDomain };
