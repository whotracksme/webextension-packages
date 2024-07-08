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

import { split0 } from './utils';

/**
 * Given a URL and a list of query parameters, it returns an
 * equivalent URL, but with those query parameters removed.
 *
 * Note: this function will not do any decoding. Instead, it will try
 * to preserve the original URL as best as it can (e.g. the invalid URL
 * "https://example.test?q=x y" will not be normalized to the valid URL
 * "https://example.test/?q=x%20y").
 */
export function removeQueryParams(url, queryParams) {
  const searchStart = url.indexOf('?');
  if (searchStart === -1) {
    return url;
  }
  const searchEnd = url.indexOf('#', searchStart + 1);
  const search =
    searchEnd === -1
      ? url.slice(searchStart + 1)
      : url.slice(searchStart + 1, searchEnd);
  if (!search) {
    return url;
  }
  const parts = search
    .split('&')
    .filter((x) => !queryParams.includes(split0(x, '=')));
  const beforeSearch = url.slice(0, searchStart);

  const hash = searchEnd === -1 ? '' : url.slice(searchEnd);
  if (parts.length === 0) {
    return beforeSearch + hash;
  } else {
    return `${beforeSearch}?${parts.join('&')}${hash}`;
  }
}

/**
 * Given a URL, it returns an equivalent URL, but with the hash removed.
 * If the URL did not have a hash, the unmodifed URL will be returned.
 *
 * Note: this function will not do any decoding. Instead, it will try
 * to preserve the original URL as best as it can (e.g. the invalid URL
 * "https://example.test?q=x y" will not be normalized to the valid URL
 * "https://example.test/?q=x%20y").
 */
export function removeSearchHash(url) {
  return split0(url, '#');
}
