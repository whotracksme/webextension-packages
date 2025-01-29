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

import { ImmutableURL } from '@cliqz/url-parser';
import logger from './logger';

/**
 * Can be used to add search engines. Detecting search engines enables
 * some optimizations (e.g. quorum checks can be skipped).
 */
const URL_PATTERNS = [
  {
    category: 'search-gos',
    regexp: /^https:[/][/]scholar[.]google[.][^/]+[/]scholar.*[?&]q=/,
    prefix: 'scholar?q=',
  },
  {
    category: 'search-goi',
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*udm=2)|(udm=2&([^&]+&)*q=[^&]+))/,
    prefix: 'search?udm=2&q=',
  },
  {
    category: 'search-gov',
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*udm=7)|(udm=7&([^&]+&)*q=[^&]+))/,
    prefix: 'search?udm=7&q=',
  },
  {
    category: 'search-go',
    regexp: /^https:[/][/][^/]*[.]google[.].*?[#?&;]/,
    prefix: 'search?q=',
  },
  {
    category: 'search-ya',
    regexp: /^https:[/][/][^/]*[.]search[.]yahoo[.].*?[#?&;][pq]=[^$&]+/,
    prefix: 'search?q=',
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('p');
    },
  },
  {
    category: 'search-bii',
    regexp: /^https:[/][/][^/]*[.]bing[.][^/]+[/]images[/]search[?]q=[^$&]+/,
    prefix: 'images/search?q=',
  },
  {
    category: 'search-bi',
    regexp: /^https:[/][/][^/]*[.]bing[.].*?[#?&;]q=[^$&]+/,
    prefix: 'search?q=',
  },
  {
    category: 'search-am',
    regexp:
      /^https:[/][/][^/]*[.]amazon[.][^/]+[/](s[?]k=[^$&]+|.*[?&]field-keywords=[^$&]+)/,
    prefix: 's/?field-keywords=',
    queryFinder(parsedUrl) {
      return (
        parsedUrl.searchParams.get('field-keywords') ||
        parsedUrl.searchParams.get('k')
      );
    },
  },
  {
    category: 'search-dd',
    regexp:
      /^https:[/][/](?:html[.])?duckduckgo[.]com[/].*([?&]q=[^&]+.*&ia=web|[?]q=[^&]+$)/,
    prefix: 'html?q=',
    doublefetchHost() {
      return 'html.duckduckgo.com';
    },
  },
  {
    category: 'search-gh',
    regexp: /^https:[/][/](glowstery|ghosterysearch)[.]com[/]search[?]q=[^&]+/,
    prefix: 'search?q=',
  },
  {
    category: 'search-ghi',
    regexp: /^https:[/][/](glowstery|ghosterysearch)[.]com[/]images[?]q=[^&]+/,
    prefix: 'search?q=',
  },
  {
    category: 'search-ghv',
    regexp: /^https:[/][/](glowstery|ghosterysearch)[.]com[/]videos[?]q=[^&]+/,
    prefix: 'search?q=',
  },
  {
    category: 'search-br',
    regexp: /^https:[/][/]search[.]brave[.]com[/]search[?]q=[^&]+/,
    prefix: 'search?q=',
  },
  {
    category: 'search-bri',
    regexp: /^https:[/][/]search[.]brave[.]com[/]images[?]q=[^&]+/,
    prefix: 'images?q=',
  },
  {
    category: 'search-brn',
    regexp: /^https:[/][/]search[.]brave[.]com[/]news[?]q=[^&]+/,
    prefix: 'news?q=',
  },
  {
    category: 'search-brv',
    regexp: /^https:[/][/]search[.]brave[.]com[/]videos[?]q=[^&]+/,
    prefix: 'videos?q=',
  },
  {
    category: 'search-ec',
    regexp:
      /^https:[/][/]www[.]ecosia[.]org[/]search[?](?:method=index&)?q=[^&]+/,
    prefix: 'search?q=',
  },
];

export default class UrlAnalyzer {
  constructor(patterns) {
    this.patterns = patterns;
    this._urlPatterns = URL_PATTERNS;
  }

  parseSearchLinks(url) {
    for (const {
      category,
      regexp,
      prefix,
      queryFinder = (parsedUrl) => parsedUrl.searchParams.get('q'),
      doublefetchHost = (parsedUrl) => parsedUrl.host,
    } of this._urlPatterns) {
      if (regexp.test(url)) {
        // Workaround for an encoding issue (source: https://stackoverflow.com/a/24417399/783510).
        // Reason: we want to preserve the original search term. In other words, searches
        // for "abc def" and "abc+def" should be distinguishable. That is why we need to
        // avoid the ambigious '+' character and use explicit white space encoding.
        const url_ = url.replaceAll('+', '%20');
        const parsedUrl = new ImmutableURL(url_);

        const query = queryFinder(parsedUrl);
        if (!query) {
          return { isSupported: false };
        }
        const query_ = encodeURIComponent(query).replaceAll('%20', '+');
        const host_ = doublefetchHost(parsedUrl);
        const doublefetchUrl = `https://${host_}/${prefix}${query_}`;
        const doublefetchRequest = this.patterns.createDoublefetchRequest(
          category,
          doublefetchUrl,
        );
        if (!doublefetchRequest) {
          logger.debug(
            'Matching rule for',
            url,
            'skipped (no matching server side rules exist)',
          );
          return { isSupported: false, category, query };
        }
        return { isSupported: true, category, query, doublefetchRequest };
      }
    }

    return { isSupported: false };
  }
}
