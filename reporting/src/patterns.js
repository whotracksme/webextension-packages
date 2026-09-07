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
  parseUntrustedJSON,
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
// Upper bound for the binary payloads handled by "base64" and "protobuf"
// (an attacker controls the input; see the DoS notes above).
const MAX_BINARY_LENGTH = 64 * 1024;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// Reads one base-128 varint. Five bytes cover any tag or length that fits
// in a message of MAX_BINARY_LENGTH; anything longer fails closed.
function readVarint(bytes, start) {
  let value = 0;
  let pos = start;
  for (let i = 0; i < 5; i += 1) {
    if (pos >= bytes.length) {
      return null;
    }
    const byte = bytes[pos];
    pos += 1;
    value += (byte & 0x7f) * 2 ** (7 * i);
    if ((byte & 0x80) === 0) {
      return { value, pos };
    }
  }
  return null;
}

// The payload of the first length-delimited field with the given number,
// or null. Fields of other wire types are skipped; groups and truncated
// messages fail closed. "pos" grows in every iteration, so the loop is
// bounded by the message length.
function findLengthDelimitedField(bytes, wantedField) {
  let pos = 0;
  while (pos < bytes.length) {
    const tag = readVarint(bytes, pos);
    if (!tag) {
      return null;
    }
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    pos = tag.pos;
    if (wireType === 0) {
      while (pos < bytes.length && (bytes[pos] & 0x80) !== 0) {
        pos += 1;
      }
      pos += 1;
    } else if (wireType === 1) {
      pos += 8;
    } else if (wireType === 2) {
      const len = readVarint(bytes, pos);
      if (!len || len.pos + len.value > bytes.length) {
        return null;
      }
      if (field === wantedField) {
        return bytes.subarray(len.pos, len.pos + len.value);
      }
      pos = len.pos + len.value;
    } else if (wireType === 5) {
      pos += 4;
    } else {
      return null;
    }
  }
  return null;
}

const JS_LETTER_ESCAPES = new Map(
  Object.entries({
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    v: '\v',
    0: '\0',
  }),
);

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
        let obj = parseUntrustedJSON(text, {
          maxSize: 1024 * 1024, // 1 MB
          sanitizeSilently: true,
        });
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

    /**
     * Removes the first match of a regular expression. The length cannot
     * increase, because characters can only be removed, never added.
     *
     * Example ["removeFirstMatch", "AB+"]:
     * - "xABBBy ABz" -> "xy ABz"
     *
     * @since: 9
     */
    removeFirstMatch: (text, pattern) => {
      requireString(text);
      requireString(pattern);
      if (text.length === 0) {
        return '';
      }
      try {
        return text.replace(new RegExp(pattern), '');
      } catch (e) {
        return '';
      }
    },

    /**
     * Removes every match of a regular expression. The length cannot
     * increase, because characters can only be removed, never added.
     *
     * Example ["removeAllMatches", "AB+"]:
     * - "xABBBy ABz" -> "xy z"
     *
     * @since: 9
     */
    removeAllMatches: (text, pattern) => {
      requireString(text);
      requireString(pattern);
      if (text.length === 0) {
        return '';
      }
      try {
        return text.replaceAll(new RegExp(pattern, 'g'), '');
      } catch (e) {
        return '';
      }
    },

    /**
     * Keeps only the first match of a regular expression (or an empty
     * string if there is no match). The length cannot increase, because
     * characters can only be removed, never added.
     *
     * Example ["selectFirstMatch", "AB+"]:
     * - "xABBBy ABz" -> "ABBB"
     *
     * @since: 9
     */
    selectFirstMatch: (text, pattern) => {
      requireString(text);
      requireString(pattern);
      if (text.length === 0) {
        return '';
      }
      try {
        const m = new RegExp(pattern).exec(text);
        return m ? m[0] : '';
      } catch (e) {
        return '';
      }
    },

    /**
     * Keeps only the matches of a regular expression, concatenated in
     * order (everything else is removed). The length cannot increase,
     * because characters can only be removed, never added.
     *
     * Example ["selectAllMatches", "AB+"]:
     * - "xABBBy ABz" -> "ABBBAB"
     *
     * @since: 9
     */
    selectAllMatches: (text, pattern) => {
      requireString(text);
      requireString(pattern);
      if (text.length === 0) {
        return '';
      }
      try {
        const regexp = new RegExp(pattern, 'g');

        // Pathological patterns will always be slow, but we can defend against
        // one class: if the pattern can match empty and we can prove it,
        // we can switch to a more memory-efficient implementation, avoiding
        // massive arrays of empty strings.
        //
        // The test('') heuristic is incomplete, but it catches common cases
        // that could be introduced by accident (e.g. "[^a-zA-Z0-9]*").
        const canMatchEmpty = regexp.test('');
        if (canMatchEmpty) {
          // "exec" is safer for empty-matching patterns. It avoids the worst case
          // of creating massive arrays of empty strings.
          let matches = [];
          let m;
          regexp.lastIndex = 0;
          while ((m = regexp.exec(text)) !== null) {
            if (m[0]) {
              matches.push(m[0]);
            } else {
              regexp.lastIndex += 1;
            }
          }
          return matches.join('');
        }

        // "match" is slightly faster for non-empty-matching patterns
        const matches = text.match(regexp);
        return matches ? matches.join('') : '';
      } catch (e) {
        return '';
      }
    },

    /**
     * @since: 9
     */
    maxLength: (text, size) => {
      requireString(text);
      requireInt(size);
      return text.length <= size ? text : null;
    },

    /**
     * @since: 9
     */
    minLength: (text, size) => {
      requireString(text);
      requireInt(size);
      return text.length >= size ? text : null;
    },

    /**
     * Resolves the escape sequences of a JavaScript string literal, which
     * is how text inside inline <script> tags is typically encoded:
     * "\uXXXX", "\xXX", the letter escapes ("\n", "\t", ...), and
     * "\<char>" for any other character (e.g. "\"" or "\/").
     *
     * Not supported (left untouched): "\u{...}" code points and line
     * continuations. A trailing lone backslash is left untouched as well.
     *
     * Example ["decodeJSString"]:
     * - "a<b" -> "a<b"
     * - "?v=2&blob=abc" -> "?v=2&blob=abc"
     *
     * @since: 10
     */
    decodeJSString: (text) => {
      requireString(text);
      return text.replace(
        /\\(?:u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(.))/g,
        (match, unicode, hex, char) => {
          if (char !== undefined) {
            return JS_LETTER_ESCAPES.get(char) ?? char;
          }
          return String.fromCharCode(parseInt(unicode ?? hex, 16));
        },
      );
    },

    /**
     * Decodes base64 text, in either the standard or the URL-safe alphabet,
     * with or without padding. Returns a binary string (one character per
     * byte, as "atob" does), which is not text: it is meant to feed
     * "protobuf". Returns null if the text is not base64 or exceeds
     * MAX_BINARY_LENGTH.
     *
     * Example ["base64"]:
     * - "aGVsbG8=" -> "hello"
     * - "aGVsbG8" -> "hello"
     * - "not base64 text" -> null
     *
     * @since: 10
     */
    base64: (text) => {
      requireString(text);
      if (text.length > MAX_BINARY_LENGTH) {
        return null;
      }
      const standard = text.replaceAll('-', '+').replaceAll('_', '/');
      const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
      try {
        return atob(padded);
      } catch (e) {
        return null;
      }
    },

    /**
     * Extracts a string from a binary protobuf message, the twin of "json":
     * the path is a dot-separated list of field numbers, each leading into
     * a length-delimited field, and the bytes at the end are decoded as
     * UTF-8. The first occurrence of a field wins. Anything else (a missing
     * or non-string field, a group, a truncated message, or a payload that
     * is not UTF-8) results in null.
     *
     * The message is a binary string as returned by "base64"; a string
     * with characters above \xff, or longer than MAX_BINARY_LENGTH,
     * results in null.
     *
     * Example ["protobuf", "2.3"]:
     * - "\x12\x07\x1a\x05hello" -> "hello"
     * - "\x0a\x02hi" -> null
     *
     * @since: 10
     */
    protobuf: (binary, path) => {
      requireString(binary);
      requireString(path);
      const fieldPath = path.split('.').map((segment) => {
        if (!/^[1-9][0-9]*$/.test(segment)) {
          throw new Error(
            `Bad protobuf path: <${path}> (expected dot-separated field numbers)`,
          );
        }
        return Number(segment);
      });
      if (binary.length > MAX_BINARY_LENGTH) {
        return null;
      }
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        const code = binary.charCodeAt(i);
        if (code > 0xff) {
          return null;
        }
        bytes[i] = code;
      }
      let payload = bytes;
      for (const field of fieldPath) {
        payload = findLengthDelimitedField(payload, field);
        if (!payload) {
          return null;
        }
      }
      try {
        return UTF8_DECODER.decode(payload);
      } catch (e) {
        return null;
      }
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
const PATTERN_DSL_VERSION = 10;

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
    const convert = (
      { followRedirects, headers, steps, timeout, emptyHtml, onError },
      target = {},
    ) => {
      if (followRedirects) {
        target.redirect = 'follow';
      }
      if (headers) {
        target.headers = headers;
      }
      if (steps) {
        target.steps = steps;
      }
      if (timeout) {
        target.timeout = timeout;
      }
      if (typeof emptyHtml === 'boolean') {
        target.emptyHtml = emptyHtml;
      }
      if (onError) {
        target.onError = convert(onError);
      }
      return target;
    };

    // Start with the mandatory "url" field and fill the remaining,
    // optional fields from the configuration from patterns.
    return convert(this._rules[msgType].doublefetch || {}, { url });
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
