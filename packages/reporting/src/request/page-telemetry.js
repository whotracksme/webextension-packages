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

import { truncatedHash } from '../md5';
import { parse } from './utils/url';

function truncatePath(path) {
  // extract the first part of the page path
  const [prefix] = path.substring(1).split('/');
  return `/${prefix}`;
}

export default function buildPageLoadObject(page) {
  const urlParts = parse(page.url);
  const tps = {};
  for (const [domain, stats] of page.requestStats.entries()) {
    tps[domain] = stats;
  }
  return {
    hostname: truncatedHash(urlParts.hostname),
    path: truncatedHash(truncatePath(urlParts.path)),
    scheme: urlParts.scheme,
    c: 1,
    t: page.destroyed - page.created,
    active: page.activeTime,
    counter: page.counter,
    ra: 0,
    tps,
    placeHolder: false,
    redirects: [],
    redirectsPlaceHolder: [],
    triggeringTree: {},
    tsv: page.tsv,
    tsv_id: page.tsvId !== undefined,
    frames: {},
    cmp: page.annotations.cmp,
    hiddenElements: page.annotations.hiddenElements,
  };
}
