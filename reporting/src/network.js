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

import logger from './logger.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Simple function to detect IP addresses that are non-public.
// Local to the machine or link-only (belonging to a local network).
//
// The function assumes that ip addresses are well-formed. That should be
// sufficient, since all IP addresses are coming from the webRequest API.
//
// If there are errors, the function should err on the side of being too
// conservative. In other words, classifying a public IPs to be local is
// better than classifying a local IP as public.
export function isLocalIP(ip) {
  const isIPv6 = ip.includes(':');
  if (isIPv6) {
    if (ip === '::1' || ip.startsWith('fd:') || ip.startsWith('fe:')) {
      return true;
    }
    const ipParts = ip.split(':');
    return (
      ipParts[0].startsWith('fd') ||
      ipParts[0].startsWith('fe') ||
      ipParts.every((d, i) => {
        if (i === ipParts.length - 1) {
          // last group of address
          return d === '1';
        }
        return d === '0' || !d;
      })
    );
  }

  // IPv4
  if (
    ip.startsWith('127.') ||
    ip.startsWith('0.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.')
  ) {
    return true;
  }
  if (ip.startsWith('172.')) {
    const part2 = parseInt(ip.split('.')[1], 10);
    return part2 >= 16 && part2 < 32;
  }
  return false;
}

// There are two unsolved problems:
// - What to do if there is no IP resolution cached yet?
//   (Currently, it assumes that the page is private; but most of the
//    time this assumption will be wrong, so it looks overly conservative.
//    Perhaps, extending the API to return three values: yes/no/unknown
//    could help. But it will push the complexity to the caller.)
// - Perhaps adding all seen URLs from private IPs to the bloom filter
//   could be a solution
export class DnsResolver {
  constructor() {
    this.dns = new Map();
    this._ttlInMs = DAY; // TODO: reconsider (if possible, make it small)
  }

  isPrivateURL(url) {
    const hostname = this._tryParseHostname(url);
    return !hostname || this.isPrivateHostname(hostname);
  }

  isPrivateHostname(hostname) {
    if (hostname === 'localhost') {
      return true;
    }
    const entry = this.dns.get(hostname);
    return entry?.ip && isLocalIP(entry.ip);
  }

  cacheDnsResolution({ url, hostname, ip, now = Date.now() }) {
    const hostname_ = hostname || this._tryParseHostname(url);
    if (hostname_) {
      this.dns.set(hostname_, { ip, updatedAt: now });
      return true;
    }
    return false;
  }

  expireEntries(now = Date.now()) {
    for (const [key, entry] of this.dns) {
      let isExpired = entry.updatedAt + this._ttlInMs <= now;
      if (entry.updatedAt > now + DAY) {
        logger.warn('Clock jumped');
        isExpired = true;
      }
      if (isExpired) {
        this.dns.delete(key);
      }
    }
  }

  _tryParseHostname(url) {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return null;
    }
    try {
      return new URL(url).hostname;
    } catch (e) {
      return null;
    }
  }

  // Returns an object that can be safely stored in Session API.
  // It can be later restored by calling "restore", for instance:
  //
  // const data = obj.serialize();
  // ...
  // obj.restore(data);
  //
  serialize({ now = Date.now() } = {}) {
    this.expireEntries(now);
    return [...this.dns];
  }

  restore(entries = [], { now = Date.now() } = {}) {
    this.dns = new Map(entries);
    this.expireEntries(now);
  }
}
