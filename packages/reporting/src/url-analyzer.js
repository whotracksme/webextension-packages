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

const URL_PATTERNS = [
  {
    type: 'search-goi',
    regexp:
      /^https:[/][/][^/]*[.]google[.].*?[#?&;]((q=[^&]+&([^&]+&)*tbm=isch)|(tbm=isch&([^&]+&)*q=[^&]+))/,
    prefix: 'search?tbm=isch&gbv=1&q=',
  },
  {
    type: 'search-go',
    regexp: /^https:[/][/][^/]*[.]google[.].*?[#?&;]/,
    prefix: 'search?q=',
  },
  {
    type: 'search-ya',
    regexp: /^https:[/][/][^/]*[.]search[.]yahoo[.].*?[#?&;][pq]=[^$&]+/,
    prefix: 'search?q=',
    queryFinder(parsedUrl) {
      return parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('p');
    },
  },
  {
    type: 'search-bii',
    regexp: /^https:[/][/][^/]*[.]bing[.][^/]+[/]images[/]search[?]q=[^$&]+/,
    prefix: 'images/search?q=',
  },
  {
    type: 'search-bi',
    regexp: /^https:[/][/][^/]*[.]bing[.].*?[#?&;]q=[^$&]+/,
    prefix: 'search?q=',
  },
  {
    type: 'search-am',
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
    type: 'search-dd',
    regexp:
      /^https:[/][/]duckduckgo.com[/](?:html$|.*[?&]q=[^&]+.*&ia=web|[?]q=[^&]+$)/,
    prefix: '?q=',
  },
];

export default class UrlAnalyzer {
  constructor(patterns) {
    this.patterns = patterns;
    this._urlPatterns = URL_PATTERNS;
  }

  parseSearchLinks(url) {
    for (const {
      type,
      regexp,
      prefix,
      queryFinder = (parsedUrl) => parsedUrl.searchParams.get('q'),
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
          return { found: false };
        }
        const query_ = encodeURIComponent(query).replaceAll('%20', '+');
        const doublefetchUrl = `https://${parsedUrl.host}/${prefix}${query_}`;
        const doublefetchRequest = this.patterns.createDoublefetchRequest(
          type,
          doublefetchUrl,
        );
        if (!doublefetchRequest) {
          logger.info(
            'Matching rule for',
            url,
            'skipped (no matching server side rules exist)',
          );
          return { found: false };
        }
        return { found: true, type, query, doublefetchRequest };
      }
    }

    return { found: false };
  }
}
