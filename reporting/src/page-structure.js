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

    // Workaround for parsers like Linkedom, which require <title> tags
    // to be within <html><head> (though they are optional in HTML5):
    // ```
    // <!doctype html>
    // <html>
    //   <head>
    //     <title>...</title>
    //   </head>
    //   <body>...</body>
    // </html>
    // ```
    //
    // But these parsers fail on valid examples like that:
    // ```
    // <!doctype html>
    // <title>...</title>
    // ```
    //
    // The workaround introduces the risk of false-positive matches
    // (e.g. within <body>). Since the parsers are expected to create
    // the implicit <html> and <head>, the following guard will not
    // result in "null" on browsers like Firefox or Chrome, only
    // in parsers like Linkedom.
    if (doc.querySelector('html > head > title') === null) {
      const title = doc.querySelector('title')?.textContent?.trim();
      if (title) {
        return title;
      }
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

  function sanitizeJsonLdField(text) {
    if (typeof text === 'string') {
      const text_ = text.trim();
      if (text_.length <= 2048) {
        return text_;
      }
    }
    return null;
  }

  // parse JSON-LD (https://json-ld.org/)
  function parseJsonLd(doc) {
    const jsonld = [];
    for (const elem of doc.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      let parsedJson;
      try {
        parsedJson = JSON.parse(elem.textContent);

        // 1) some websites put the content in a '@graph' array, for instance:
        // {
        //   "@context": "https://schema.org",
        //   "@graph": [
        //     {<0>},
        //     {<1>},
        //   ]
        // }
        // ==> lift "@graph" to the top-level
        if (
          typeof parsedJson['@context'] === 'string' &&
          Array.isArray(parsedJson['@graph']) &&
          Object.keys(parsedJson).length === 2
        ) {
          for (const elem of parsedJson['@graph']) {
            elem['@context'] ||= parsedJson['@context'];
          }
          parsedJson = parsedJson['@graph'];
        }

        // 2) some websites use arrays, some split it across multiple scripts
        // ==> everything becomes an array
        parsedJson = Array.isArray(parsedJson) ? parsedJson : [parsedJson];
      } catch (e) {
        continue; // ignore broken JSON
      }
      for (const json of parsedJson) {
        const entry = {};
        for (const key of [
          '@context',
          '@type',
          '@id',
          'url',
          'name',
          'headline',
          'duration',
          'dateCreated',
          'dateModified',
          'datePublished',
          'uploadDate',
        ]) {
          const value = sanitizeJsonLdField(json[key]);
          if (value) {
            entry[key] = value;
          }
        }
        jsonld.push(entry);
      }
    }
    return jsonld;
  }

  doc = doc || document;

  try {
    const { noindex, requestedIndex } = parseMetaRobotTags(doc);
    const title = getTitle(doc);
    const url = doc.URL;

    // Meta information (be aware that for single-page applications,
    // these values can to be unreliable. After navigations, the
    // canonical URL may become outdated.
    const canonicalUrl = getCanonicalUrl(doc);
    const contentType = doc.contentType || null;
    const language = parseHtmlLangAttribute(doc);
    const og = parseOpenGraphMetaTags(doc);
    const jsonld = parseJsonLd(doc);

    return {
      title,
      url,
      meta: {
        canonicalUrl,
        language,
        contentType,
        og,
        jsonld,
      },
      noindex,
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
