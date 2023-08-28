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

export function truncateDomain(host, depth) {
  const generalDomain = host.domain;

  if (
    host.isIp ||
    host.hostname === generalDomain ||
    generalDomain === null ||
    generalDomain.length === 0
  ) {
    return host.hostname;
  }

  const subdomains = host.subdomain.split('.').filter((p) => p.length > 0);
  return `${subdomains
    .slice(Math.max(subdomains.length - depth, 0))
    .join('.')}.${generalDomain}`;
}

export function shuffle(s) {
  const a = s.split('');
  const n = a.length;

  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a.join('');
}
