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

// This list is not intended to be complete. For missing entries, the
// DnsResolver class will fallback to dynamic mappings learned from
// observing network requests (hostname -> IP).
//
// Why include explicit mappings at all? Because it provides stronger
// guarantees during the bootstrapping phase. In a web extension context,
// where no DNS resolution API is available, we otherwise could not guarantee
// that the critical IP addresses would be always resolvable.
const WELL_KNOWN_HOSTNAME_IS_PRIVATE_NETWORK = {
  // list of private networks (completeness not required):
  '127.0.0.1': true,
  'localhost': true,
  'fritz.box': true,

  // (generated: top 100 public domains ranked by traffic):
  'www.google.com': false,
  'www.fiverr.com': false,
  'www.youtube.com': false,
  'www.amazon.com': false,
  'www.reddit.com': false,
  'www.facebook.com': false,
  'mail.google.com': false,
  'docs.google.com': false,
  'x.com': false,
  'accounts.google.com': false,
  'www.instagram.com': false,
  'www.bing.com': false,
  'www.linkedin.com': false,
  'login.microsoftonline.com': false,
  'en.wikipedia.org': false,
  'github.com': false,
  'www.amazon.de': false,
  'www.ebay.com': false,
  'www.twitch.tv': false,
  'www.amazon.co.jp': false,
  'chatgpt.com': false,
  'www.amazon.fr': false,
  'www.msn.com': false,
  'news.yahoo.co.jp': false,
  'old.reddit.com': false,
  'www.amazon.co.uk': false,
  'www.roblox.com': false,
  'drive.google.com': false,
  'rule34.xxx': false,
  'www.pornhub.com': false,
  'www.imdb.com': false,
  'xhamster.com': false,
  'www.xvideos.com': false,
  'e-hentai.org': false,
  'www.paypal.com': false,
  'www.amazon.ca': false,
  'www.espn.com': false,
  'www.bbc.co.uk': false,
  'www.kleinanzeigen.de': false,
  'www.nexusmods.com': false,
  'steamcommunity.com': false,
  'www.bilibili.com': false,
  'www.ebay.co.uk': false,
  'allegro.pl': false,
  'meet.google.com': false,
  'www.aliexpress.com': false,
  'chaturbate.com': false,
  'www.yahoo.co.jp': false,
  'www.nytimes.com': false,
  'www.canva.com': false,
  'www.etsy.com': false,
  'nhentai.net': false,
  'www.ozon.ru': false,
  'www.theguardian.com': false,
  'www.amazon.it': false,
  'hitomi.la': false,
  'www.neopets.com': false,
  'outlook.live.com': false,
  'supjav.com': false,
  'store.steampowered.com': false,
  'www.deviantart.com': false,
  'calendar.google.com': false,
  'www.ecosia.org': false,
  'mail.yahoo.com': false,
  'de.fiverr.com': false,
  'letterboxd.com': false,
  'login.live.com': false,
  'www.fmkorea.com': false,
  'outlook.office.com': false,
  'news.google.com': false,
  'statics.teams.cdn.office.net': false,
  'gall.dcinside.com': false,
  'citizenfreepress.com': false,
  'duckduckgo.com': false,
  'www.amazon.es': false,
  'www.xnxx.com': false,
  'www.imagefap.com': false,
  'www.pixiv.net': false,
  'www.ikea.com': false,
  'www.netflix.com': false,
  'www.ebay.de': false,
  'imgsrc.ru': false,
  'www.dailymail.co.uk': false,
  'www.marktplaats.nl': false,
  'www.foxnews.com': false,
  'auctions.yahoo.co.jp': false,
  'www.booking.com': false,
  'game.granbluefantasy.jp': false,
  'www.erome.com': false,
  'f95zone.to': false,
  'www.cardmarket.com': false,
  'www.chess.com': false,
  'www.vinted.fr': false,
  'www.discogs.com': false,
  'www.ancestry.com': false,
  'app.hubspot.com': false,
  '1337x.to': false,
  'www.upwork.com': false,
  'search.yahoo.co.jp': false,
  'www.patreon.com': false,
};

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

export class DnsResolver {
  constructor() {
    this.dns = new Map();
    this._ttlInMs = DAY;
  }

  isPrivateURL(url) {
    const hostname = this._tryParseHostname(url);
    return !hostname || this.isPrivateHostname(hostname);
  }

  isPrivateHostname(hostname) {
    // For a limited set of hostnames, we know how to classify them.
    // By design, this will never cover all websites.
    const isPrivate = WELL_KNOWN_HOSTNAME_IS_PRIVATE_NETWORK[hostname];
    if (isPrivate !== undefined) {
      return isPrivate;
    }

    // For the long tail, fall back to checking the IP address. Since we lack a
    // DNS resolution API, we use mappings built from observing network requests.
    //
    // Note: Since this is a heuristic, there remains the question on how to deal
    // with hostnames that we have not seen before. That case should be rare
    // enough, since we work with hostnames that originate from visited websites.
    // Yet if no such mapping exists, we have to guess. Assuming a hostname is
    // private by default would be overly conservative; instead, we default to
    // public unless proven otherwise.
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
