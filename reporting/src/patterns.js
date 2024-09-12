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

import logger from './logger';
import { sanitizeUrl } from './sanitizer';
import { removeQueryParams } from './url-cleaner';
import { UnsupportedTransformationError } from './errors';
import SelfChecks from './self-check';
import {
  requireString,
  requireInt,
  requireBoolean,
  requireObject,
  requireArrayOfStrings,
} from './utils';

/**
 * A list of predefined string transformations that can be specified
 * in the DSL in the "transforms" definition.
 *
 * Notes:
 * - All transformations are stateless and must be free of side-effects.
 * - If a single steps return "null", the following steps will
 *   not be executed.
 * - The first argument is the current value (the accumulator),
 *   but extra parameters can be defined in the DSL; these will be
 *   passed to the function as additional arguments.
 *
 * Preventing remote code execution
 * --------------------------------
 *
 * The predefined functions need to be carefully checked. To illustrate
 * the threat model, let us look at a constructed example first:
 *
 *   badIdea: (x, param) => eval(param)
 *
 * Now, if an attacker compromises the servers and gets control to push
 * malicious pattern updates, the function could be exploited:
 *
 * ["badIdea", "<some code that the client will execute>"].
 *
 * Be careful not to introduce a function that allows an attack
 * like that. That is why it is so important to keep the function free
 * of side-effects!
 *
 * ----------------------------------------------------------------------
 *
 * Additional warnings:
 *
 * 1) Do not allow DoS (be careful when looping; if possible avoid any loops):
 *
 * As long as the functions are free of side-effects, the worst possible
 * attack would be denial-of-service (in other words, someone could push a
 * rule that results in an infinite loop). So, also be careful when using
 * explicit loops - there should be no need for it anyway.
 * Best keep the transformations simple.
 *
 * 2) Do not trust the parameters:
 *
 * Note that an attacker will be able to control the arguments passed
 * into the function:
 * - extra parameters are under direct control (as they are taken
 *   from the rule definitions)
 * - the first parameter (the accumulator) is more difficult to
 *   control but expect that it is prudent to assume that it can
 *   be controlled as well (e.g., if a user can be tricked to visit
 *   any website where the attacker can control text)
 *
 * As long as you avoid side-effects and loops, critical exploits
 * are not possible, but again there are DoS type attacks.
 *
 * For instance, if you are writing a rule with an parameter that will
 * be used as a regular expression, be careful. What will happen if the
 * attacker pushes a rule with a long regular expression that may lead
 * to exponential backtracking? Think about these kind of attacks and
 * about mitigations (e.g. reject overly long parameters).
 * Again, it is best to keep the functions simple to avoid any surprises.
 *
 * ----------------------------------------------------------------------
 *
 * Error handling:
 *
 * 1) Throwing an exception is supported. In that case, expect the whole
 *    rule to be skipped (no message will be sent). In other words, reserve
 *    it for unexpected cases.
 * 2) Returning "null"/"undefined" has the semantic of stopping the
 *    execution without an error. It is still possible that a
 *    message will be sent, but with a missing value.
 *
 * After adding a new transformation, increase the API version (see PATTERN_DSL_VERSION).
 */
const TRANSFORMS = new Map(
  Object.entries({
    /**
     * Extracts a given query parameter and decodes it.
     *
     * Example ["queryParam", "foo"]:
     * - "https://example.test/path?foo=bar+baz" -> "bar baz"
     * - "/example.test/path?foo=bar+baz" -> "bar baz"
     * - "/example.test/path" -> null
     * - "This is a string but not an URL" -> null
     *
     * @since: 1
     */
    queryParam: (url, queryParam) => {
      requireString(url);
      requireString(queryParam);
      try {
        // we only need the query parameter, but to handle relative
        // URLs we have to pass a base URL (any domain will work)
        return new URL(url, 'http://x').searchParams.get(queryParam);
      } catch (e) {
        return null;
      }
    },

    /**
     * Given a URL and a list of query parameters, it returns an equivalent
     * URL, but with those query parameters removed.
     *
     * Notes:
     * - If the parameter occurs multiple times, all of them will be removed.
     * - If the URL is invalid, null is returned.
     *
     * Example ["removeParams", ["foo"]]:
     * - "https://example.test/path?foo=remove&bar=keep" -> "https://example.test/path?bar=keep"
     * - "This is a string but not an URL" -> null
     * - "/example.test/path" -> null (relative URLs are not supported)
     *
     * Example ["removeParams", ["foo", "bar"]]:
     * - "https://example.test/path?foo=1&bar=2" -> "https://example.test/path"
     *
     * @since: 1
     */
    removeParams: (url, queryParams) => {
      requireString(url);
      requireArrayOfStrings(queryParams);
      if (URL.canParse(url)) {
        return removeQueryParams(url, queryParams);
      } else {
        return null;
      }
    },

    /**
     * Given text, it will verify that it is a well-formed URL;
     * otherwise, it will end the processing by "nulling" it out.
     *
     * @since: 1
     */
    requireURL: (url) => {
      requireString(url);
      return URL.canParse(url) ? url : null;
    },

    /**
     * Validates if the given value is in a predefined list of allowed
     * values; otherwise, it will end the processing by "nulling" it out.
     *
     * @since: 2
     */
    filterExact: (text, allowedStrings) => {
      requireString(text);
      requireArrayOfStrings(allowedStrings);
      return allowedStrings.includes(text) ? text : null;
    },

    /**
     * Given a URL, it runs a set of extra checks to filter out
     * parts that may be sensitive (i.e. keeping only the hostname),
     * or even drop it completely.
     *
     * @since: 1
     */
    maskU: (url) => {
      requireString(url);
      try {
        return sanitizeUrl(url).safeUrl;
      } catch (e) {
        return null;
      }
    },

    /**
     * Like "maskU", but more conservative.
     *
     * Note: in general, "maskU" should be the best trade-off. But if you have
     * URLs that can be dropped without causing much harm, using "strictMaskU"
     * can be useful. However, it will drop many harmless URLs; in other words,
     * expect a high number of false-positives.
     *
     * @since: 1
     */
    strictMaskU: (url) => {
      requireString(url);
      try {
        return sanitizeUrl(url, { strict: true }).safeUrl;
      } catch (e) {
        return null;
      }
    },

    /**
     * Like "maskU", but tries to preserve the URL path when truncating.
     *
     * @since: 1
     */
    relaxedMaskU: (url) => {
      requireString(url);
      try {
        return sanitizeUrl(url, { strict: false, tryPreservePath: true })
          .safeUrl;
      } catch (e) {
        return null;
      }
    },

    /**
     * @since: 1
     */
    split: (text, splitON, arrPos) => {
      requireString(text);
      requireString(splitON);
      requireInt(arrPos);

      const parts = text.split(splitON);
      if (parts.length === 1) {
        return null;
      }
      return parts[arrPos] ?? null;
    },

    /**
     * @since: 1
     */
    trySplit: (text, splitON, arrPos) => {
      requireString(text);
      requireString(splitON);
      requireInt(arrPos);

      return text.split(splitON)[arrPos] || text;
    },

    /**
     * @since: 1
     */
    decodeURIComponent: (text) => {
      requireString(text);
      try {
        return decodeURIComponent(text);
      } catch (e) {
        return null;
      }
    },

    /**
     * @since: 1
     */
    tryDecodeURIComponent: (text) => {
      requireString(text);
      try {
        return decodeURIComponent(text);
      } catch (e) {
        return text;
      }
    },

    /**
     * Takes a JSON string object, parses it and extract the data under the
     * given path. By default, it will only extract safe types (strings,
     * numbers, booleans), mostly to prevent accidentally extracting
     * more than intended.
     *
     * @since: 1
     */
    json: (text, path, extractObjects = false) => {
      requireString(text);
      requireString(path);
      requireBoolean(extractObjects);
      try {
        let obj = JSON.parse(text);
        for (const field of path.split('.')) {
          if (!Object.hasOwn(obj, field)) {
            return '';
          }
          obj = obj[field];
        }
        if (typeof obj === 'string') {
          return obj;
        }
        if (typeof obj === 'number' || typeof obj === 'boolean') {
          return obj.toString();
        }
        if (extractObjects && obj) {
          return JSON.stringify(obj);
        }
        // prevent uncontrolled text extraction
        return '';
      } catch (e) {
        return '';
      }
    },

    /**
     * @since: 3
     */
    trim: (text) => {
      requireString(text);
      return text.trim();
    },
  }),
);

export function lookupBuiltinTransform(name) {
  const transform = TRANSFORMS.get(name);
  if (transform) {
    return transform;
  }
  throw new UnsupportedTransformationError(`Unknown transformation: "${name}"`);
}

/**
 * Defines the version of the engine that processes the patterns DSL
 * (Domain Specific Language).
 *
 * It is always safe to increase it: neither will it lead to overhead,
 * nor will it split the population. Its sole purpose is to be used
 * to disable clients that do not meet the minimum requirements of the
 * current patterns.
 */
const PATTERN_DSL_VERSION = 3;

/**
 * "Magic" empty rule set, which exists only if patterns were loaded, but
 * our engine is too old and does not supported them. Therefore, they are
 * disabled. Although not a typical error, reaching this state should be
 * avoided; the client will be dead from the perspective of the server.
 *
 * There are two to exit this state:
 * 1) The client updates to a newer version (this is the preferred one)
 * 2) The server can decide to serve a backward-compatible set of rules to
 *    restore support for older clients. It will restore the traffic since
 *    old clients will still poll for patterns.
 *
 * Note that option two will not be sustainable over a longer period. It
 * also comes with the disadvantage that old clients will form their own
 * group; anonymity will suffer if their population becomes too small.
 */
const RULES_REJECTED__ENGINE_TOO_OLD = {};

/**
 * "Magic" empty rule set, which should exist only temporarily when
 * the background page or service worker is starting up. It should
 * get quickly replaces by a normal set of rules.
 */
const RULES_NOT_LOADED_YET = {};

/**
 * "Magic" empty rule set, which exists only if patterns failed to load,
 * because they were not well-formed.
 */
const RULES_REJECTED__CORRUPTED = {};

/**
 * Represents the currently active rules.
 *
 * It is updated by the PatternsUpdater, which polls
 * the server for updates.
 */
export default class Patterns {
  constructor() {
    this._rules = RULES_NOT_LOADED_YET;
  }

  updatePatterns(rules) {
    this._rules = this._sanitizeRules(rules);
    logger.info('Loaded patterns:', this._rules);
  }

  /**
   * Grants access to the active patterns. It is guaranteed that the
   * returned object will not be modified.
   *
   * If you plan to perform multiple operations, it is recommended
   * to call this function one and then operate on this snapshot.
   * Even though it is unlikely, patterns can change at any point
   * in time. As long as you operate on the snapshot, you do not have
   * to worry about it.
   */
  getRulesSnapshot() {
    return this._rules;
  }

  /**
   * Constructs a "doublefetchRequest" object, which defines the doublefetch
   * requests for the given URL.
   *
   * Example outputs:
   * 1. { url: 'https://example.test/foo', followRedirects: true, headers: { Cookie: 'bar' } }
   *  - allow redirects and overwrite the "Cookie" HTTP headers (as 'Cookie: bar')
   * 2. { url: 'https://example.test/foo' }
   *  - do not allow redirects and do not overwrite headers
   */
  createDoublefetchRequest(msgType, url) {
    if (!this._rules[msgType]) {
      return null;
    }
    const doublefetchRequest = { url };
    if (this._rules[msgType].doublefetch) {
      const { headers, followRedirects } = this._rules[msgType].doublefetch;
      if (followRedirects) {
        doublefetchRequest.redirect = 'follow';
      }
      if (headers) {
        doublefetchRequest.headers = headers;
      }
    }
    return doublefetchRequest;
  }

  _sanitizeRules(rules) {
    try {
      requireObject(rules);
      const minVersion = requireInt(rules._meta?.minVersion || 0);
      if (minVersion > PATTERN_DSL_VERSION) {
        logger.warn(
          'Ignoring patterns, since our engine does not meet the minimum version:',
          minVersion,
          '>',
          PATTERN_DSL_VERSION,
        );
        return RULES_REJECTED__ENGINE_TOO_OLD;
      }
      return rules;
    } catch (e) {
      logger.error(
        'Unable to apply rules because they could not be parsed:',
        rules,
        e,
      );
      return RULES_REJECTED__CORRUPTED;
    }
  }

  async selfChecks(check = new SelfChecks()) {
    if (this._rules === RULES_REJECTED__ENGINE_TOO_OLD) {
      check.warn('patterns rejected, because our engine is too old');
    } else if (this._rules === RULES_REJECTED__CORRUPTED) {
      check.error('patterns rejected, because the rules were corrupted');
    } else if (this._rules === RULES_NOT_LOADED_YET) {
      check.warn(
        'patterns still not initialized (this should happen only at startup)',
      );
    } else {
      check.pass('patterns loaded');
    }
    return check;
  }
}
