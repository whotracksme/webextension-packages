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

import { truncatedHash } from '../md5.js';
import { parse } from '../utils/url.js';

function truncatePath(path) {
  // extract the first part of the page path
  const [prefix] = path.substring(1).split('/');
  return `/${prefix}`;
}

export default function buildPageLoadObject(page) {
  const urlParts = parse(page.url);
  const tps = { ...page.requestStats };
  return {
    hostname: truncatedHash(urlParts.hostname),
    path: truncatedHash(truncatePath(urlParts.path)),
    scheme: urlParts.scheme,
    c: 1,
    t: Math.round(page.destroyed - page.created),
    active: page.activeTime,
    counter: page.counter,
    ra: 0,
    tps,
    placeHolder: false,
    redirects: [],
    redirectsPlaceHolder: [],
    triggeringTree: {},
    tsv: '',
    tsv_id: false,
    frames: {},
  };
}
