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

// Note: is expected to be used as input of chrome.scripting.executeScript.
// It must not depend on no external functions (only the DOM API is safe to use).
// Also, it should work on all supported browsers.
export async function analyzePageStructure(doc) {
  function getTitle(doc) {
    if (doc.title) {
      return doc.title;
    }
    const elem = doc.querySelector('html > head > meta[name="title"]');
    if (elem) {
      return elem.getAttribute('content') || '';
    }
    return '';
  }

  function getCanonicalUrl(doc) {
    const elem = doc.querySelector('html > head > link[rel="canonical"]');
    return elem ? elem.href : null;
  }

  /**
   * Parse the robots meta tag. By default, the standard treats pages
   * do not opt-out ("noindex") as indexable. But explicitly opt-in
   * (e.g. "index") may still be a clue that a page wants to be indexed.
   */
  function parseMetaRobotTags(doc) {
    let requestedIndex = false;
    for (const elem of doc.querySelectorAll(
      'html > head > meta[name="robots"]',
    )) {
      const attr = elem.getAttribute('content');
      if (attr) {
        const tags = attr.split(',').map((x) => x.trim());
        if (tags.includes('noindex') || tags.includes('none')) {
          return { noindex: true, requestedIndex: false };
        }

        // Detect some tags that typically are only added to websites
        // that want to be found. The presence of such tags does not
        // prove anything, but it increases the chance that a page
        // is free of private information.
        requestedIndex =
          requestedIndex ||
          tags.includes('all') ||
          tags.includes('index') ||
          tags.includes('index') ||
          tags.includes('max-image-preview:large') ||
          tags.includes('max-image-preview:standard') ||
          tags.includes('max-video-preview:-1');
      }
    }
    return { noindex: false, requestedIndex };
  }

  function sanitizeLanguage(lang) {
    if (lang) {
      const lang_ = lang.trim();
      if (lang_.length <= 10) {
        return lang_;
      }
    }
    return null;
  }

  function parseHtmlLangAttribute(doc) {
    return sanitizeLanguage(doc.documentElement.getAttribute('lang'));
  }

  function parseOpenGraphMetaTags(doc) {
    const og = {};
    for (const tag of ['title', 'url', 'image', 'video']) {
      const elem = doc.querySelector(
        `html > head > meta[property="og:${tag}"]`,
      );
      if (elem) {
        const content = elem.getAttribute('content');
        if (content) {
          og[tag] = content;
        }
      }
    }
    return og;
  }

  doc = doc || document;

  try {
    const { noindex, requestedIndex } = parseMetaRobotTags(doc);
    if (noindex) {
      return {
        noindex: true,
      };
    }

    const title = getTitle(doc);
    const url = doc.URL;

    // Meta information (be aware that for single-page applications,
    // these values can to be unreliable. After navigations, the
    // canonical URL may become outdated.
    const canonicalUrl = getCanonicalUrl(doc);
    const contentType = doc.contentType || null;
    const language = parseHtmlLangAttribute(doc);
    const og = parseOpenGraphMetaTags(doc);

    return {
      title,
      url,
      meta: {
        canonicalUrl,
        language,
        contentType,
        og,
      },
      noindex: false,
      requestedIndex,
    };
  } catch (e) {
    return {
      error: true,
      details: (e.stack || e).toString(),
      noindex: true,
    };
  }
}
