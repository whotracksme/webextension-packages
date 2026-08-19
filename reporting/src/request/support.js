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

// Chromium forks (Edge, Opera, Yandex) keep the Chrome/<major> token.
const DOCUMENT_ID_MIN_VERSIONS = [
  [/Chrom(?:e|ium)\/(\d+)/, 106],
  [/Firefox\/(\d+)/, 153],
  [/Version\/(\d+(?:\.\d+)?).*Safari/, 18.4],
];

export function isRequestReportingSupported(
  userAgent = globalThis.navigator?.userAgent,
) {
  for (const [pattern, minVersion] of DOCUMENT_ID_MIN_VERSIONS) {
    const match = userAgent?.match(pattern);
    if (match) {
      return parseFloat(match[1]) >= minVersion;
    }
  }
  return false;
}
