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

const DOCUMENT_ID_MIN_VERSIONS = {
  chromium: 106,
  firefox: 153,
  safari: 18.4,
};

export function getBrowserName(userAgent = globalThis.navigator?.userAgent) {
  if (!userAgent) {
    return '';
  }
  if (/Edg(?:A|iOS)?\//.test(userAgent)) {
    return 'edge';
  }
  if (/OPR\/|Opera\//.test(userAgent)) {
    return 'opera';
  }
  if (/YaBrowser\//.test(userAgent)) {
    return 'yandex';
  }
  if (/Chrom(?:e|ium)\//.test(userAgent)) {
    return 'chrome';
  }
  if (/Firefox\//.test(userAgent)) {
    return 'firefox';
  }
  if (/Version\/[\d.]+.*Safari/.test(userAgent)) {
    return 'safari';
  }
  return '';
}

export function isRequestReportingSupported(
  userAgent = globalThis.navigator?.userAgent,
) {
  if (!userAgent) {
    return false;
  }
  // All Chromium forks (Edge, Opera, Yandex) keep the Chrome/<major> token.
  const chromium = userAgent.match(/Chrom(?:e|ium)\/(\d+)/);
  if (chromium) {
    return Number(chromium[1]) >= DOCUMENT_ID_MIN_VERSIONS.chromium;
  }
  const firefox = userAgent.match(/Firefox\/(\d+)/);
  if (firefox) {
    return Number(firefox[1]) >= DOCUMENT_ID_MIN_VERSIONS.firefox;
  }
  const safari = userAgent.match(/Version\/(\d+(?:\.\d+)?).*Safari/);
  if (safari) {
    return parseFloat(safari[1]) >= DOCUMENT_ID_MIN_VERSIONS.safari;
  }
  return false;
}
