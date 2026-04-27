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

import * as tldts from 'tldts-experimental';

import logger from './logger';
import { includesMiddleChar } from './utils';
import { isHash } from './hash-detector-v2';

// Note that this cannot be part of a hostname or a URL path
// ('#' is not a valid character in hostnames and URL paths)
const MASKED = '#??#';

export function sanitizeHostname(hostname) {
  const { domain } = tldts.parse(hostname, {
    extractHostname: false,
    mixedInputs: false,
    validateHostname: false,
  });
  if (hostname === domain) {
    return hostname;
  }

  return hostname
    .split('.')
    .map((part) => sanitizePart(part))
    .join('.');
}

export function sanitizePathSegment(path) {
  return sanitizePart(path);
}

// Protect against large URL path segments. First, they are in most cases
// degenerated cases that should not be shared. But it defends against
// performance regression, since our masking algorithm will perform O(n^2)
// hash checks. Since each hash detector check will likely have to look at
// all characters, we have already O(n^3) in the most optimistic scenario.
// There are URLs in the wild where the URL path segments exceed 1000 chars.
const MAX_TEXT_LENGTH = 128;

function ensureTextIsNotHuge(str) {
  if (str.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Internal error: Long text should have been truncated before. Failed at text with ${str.length} > ${MAX_TEXT_LENGTH} characters: <<${str}>>`,
    );
  }
}

function sanitizePart(str) {
  // By construction, this should never be reachable. By including this test,
  // we have strong guarantees that we will never have to face it in.
  if (str.includes(MASKED)) {
    logger.warn(
      `Found the reserved MASKED sequence (${MASKED}) in the input text: ${str}`,
    );
    return MASKED;
  }

  // First pass on the original text
  const sanitized = sanitizePart__fixedButNotYetTruncated__(str);
  if (sanitized === str) {
    return str; // no sanitization needed ==> text is safe
  }

  // The original text was not accepted, but there can be false-positives
  // if the text contains percent-encoded parts.
  if (str.includes('%')) {
    let decodedStr;
    try {
      decodedStr = decodeURIComponent(str);
      if (decodedStr.includes(MASKED)) {
        logger.warn(
          'Ignoring unlikely edge case where the reserved MASKED sequence was percent encoded:',
          str,
        );
        decodedStr = undefined;
      } else if (hasInvalidSurrogates(decodedStr)) {
        logger.warn(
          'Ignoring edge case where the decoded string contains invalid surrogates',
          str,
        );
        decodedStr = undefined;
      }
    } catch {
      // ignore (not well formed)
    }
    if (decodedStr !== undefined && decodedStr !== str) {
      const decodedSanitized =
        sanitizePart__fixedButNotYetTruncated__(decodedStr);
      if (decodedSanitized === decodedStr) {
        return str; // URL decoded text is safe ==> the original text is also safe
      }

      return backportMaskToOriginalText(str, decodedStr, decodedSanitized);
    }
  }

  return sanitized;
}

// Phase 2: text is fixed, but not yet truncated.
function sanitizePart__fixedButNotYetTruncated__(str) {
  if (str.length >= MAX_TEXT_LENGTH) {
    let splitAt = MAX_TEXT_LENGTH - MASKED.length;
    if (splitsSurrogatePair(str, splitAt)) {
      // avoid splitting between a unicode pair, since it will result in broken text
      splitAt -= 1;
    }

    const truncated = str.slice(0, splitAt);
    logger.debug('Truncating long text segment:', str, '->', truncated);
    const sanitized = sanitizePart__fixedText__(truncated);
    return sanitized.endsWith(MASKED) ? sanitized : sanitized + MASKED;
  }

  return sanitizePart__fixedText__(str);
}

// Phase 3 (final): text is fixed and truncated
function sanitizePart__fixedText__(str) {
  ensureTextIsNotHuge(str);

  if (shouldBeMasked(str)) {
    return MASKED;
  }

  // Some sites keep searches or edited text in the URL. These are often
  // '+' separated ("example.com/search/searching+for+foo+bar").
  // Though there are false-positives, filtering out is most of the time
  // the right thing to do.
  if (str.length >= 12 && includesMiddleChar(str, '+')) {
    return MASKED;
  }

  const { safePrefix, rest } = findSafePrefix(str);
  return mergeMaskInterruptions(safePrefix + maskHashes(rest));
}

function findSafePrefix(str, maxWords = 10) {
  if (maxWords <= 0) {
    return { safePrefix: '', rest: str };
  }

  let i = 0;
  while (i < str.length) {
    const code = str.charCodeAt(i);
    if (i > 0 && code === '-'.charCodeAt(0)) {
      let { safePrefix: nextSafePrefix, rest } = findSafePrefix(
        str.slice(i + 1),
        maxWords - 1,
      );
      if (shouldBeMasked(nextSafePrefix)) {
        nextSafePrefix = MASKED;
      }
      let thisSafePrefix = str.slice(0, i);
      const text = thisSafePrefix.endsWith('-')
        ? thisSafePrefix.slice(0, thisSafePrefix.length - 1)
        : thisSafePrefix;
      if (shouldBeMasked(text)) {
        thisSafePrefix = MASKED;
      }
      const safePrefix = `${thisSafePrefix}-${nextSafePrefix}`;
      return { safePrefix, rest };
    }

    if (
      isAsciiLowerCase(code) ||
      isGreekLowerCase(code) ||
      isArabic(code) ||
      isGeorgian(code) ||
      isCyrillicLowerCase(code) ||
      isArmenianLowerCase(code)
    ) {
      i += 1;
    } else {
      break;
    }
  }
  return { safePrefix: '', rest: str };
}

const MIN_SIZE_TO_BE_MASKED = 8;
if (MASKED.length > MIN_SIZE_TO_BE_MASKED) {
  throw new Error('Masking should never increase the length of the text');
}

function shouldBeMasked(str) {
  if (str.length < MIN_SIZE_TO_BE_MASKED) {
    return false;
  }

  // geo-coordinates (e.g. "@45.5335096,9.5914633,6z")
  if (str.length >= 8 && str.match(/^@?[\d,.]+z?$/)) {
    return true;
  }

  // look for identifiers, but first eliminate known false-positives
  return !skipHashDetection(str) && isHash(str);
}

function maskHashes(str) {
  ensureTextIsNotHuge(str);

  for (let size = str.length; size >= MIN_SIZE_TO_BE_MASKED; size -= 1) {
    for (let start = str.length - size; start >= 0; start -= 1) {
      if (splitsSurrogatePair(str, start)) {
        // would result in broken encodings
        continue;
      }
      const substring = str.slice(start, start + size);
      if (shouldBeMasked(substring)) {
        let prefix = '';
        if (start > 0) {
          prefix = maskHashes(str.slice(0, start));
        }

        let postfix = '';
        const beginPostfix = start + size;
        if (beginPostfix < str.length) {
          postfix = maskHashes(str.slice(beginPostfix));
        }

        const prefixMergable = prefix.endsWith(MASKED);
        const postfixMergable = postfix.startsWith(MASKED);
        if (prefixMergable && postfixMergable) {
          return prefix + postfix.slice(MASKED.length);
        }
        if (prefixMergable || postfixMergable) {
          return prefix + postfix;
        }
        return prefix + MASKED + postfix;
      }
    }
  }

  return str;
}

function mergeMaskInterruptions(str) {
  const lastMatch = str.lastIndexOf(MASKED);
  if (lastMatch === -1) {
    return str;
  }
  if (str === MASKED) {
    return MASKED;
  }

  const remainingCharsAfter = str.length - lastMatch - MASKED.length;
  if (remainingCharsAfter > 0 && remainingCharsAfter <= 8) {
    // aggressively cut text at the end after masked text
    return mergeMaskInterruptions(
      str.slice(0, str.length - remainingCharsAfter),
    );
  }

  const prevMatch = str.lastIndexOf(MASKED, lastMatch - 1);
  if (prevMatch === -1) {
    return str;
  }

  const charsBetween = lastMatch - prevMatch - MASKED.length;
  if (charsBetween <= 6) {
    return mergeMaskInterruptions(str.slice(0, prevMatch + MASKED.length));
  }
  return str;
}

function isAsciiLowerCase(code) {
  return code >= 97 && code <= 122; // a to z
}

function isGreekLowerCase(code) {
  return code >= 0x03b1 && code <= 0x03c9; // α to ω
}

function isGeorgian(code) {
  return code >= 0x10d0 && code <= 0x10ff; // ა to ჿ
}

function isArabic(code) {
  return code >= 0x0600 && code <= 0x06ff;
}

function isCyrillicLowerCase(code) {
  return (
    (code >= 0x0430 && code <= 0x044f) || (code >= 0x0450 && code <= 0x045f)
  );
}

function isArmenianLowerCase(code) {
  return code >= 0x0561 && code <= 0x0587;
}

function skipHashDetection(str) {
  const lowercaseWordDetectors = [
    { matches: isAsciiLowerCase, threshold: 6 },
    { matches: isGreekLowerCase, threshold: 3 },
    { matches: isArabic, threshold: 3 },
    { matches: isGeorgian, threshold: 3 },
    { matches: isCyrillicLowerCase, threshold: 4 },
    { matches: isArmenianLowerCase, threshold: 3 },
  ];
  lowercaseWordDetectors.forEach((x) => (x.current = 0));

  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    for (const detector of lowercaseWordDetectors) {
      if (detector.matches(code)) {
        detector.current += 1;
        if (detector.current >= detector.threshold) {
          return true;
        }
      } else {
        detector.current = 0;
      }
    }
  }

  return false;
}

function isHighSurrogate(code) {
  return (code & 0xfc00) === 0xd800;
}

function isLowSurrogate(code) {
  return (code & 0xfc00) === 0xdc00;
}

function hasInvalidSurrogates(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (isHighSurrogate(code)) {
      if (!isLowSurrogate(str.charCodeAt(i + 1))) {
        // high surrogate must be followed by a low surrogate
        return true;
      }
      i++; // skip the low surrogate (already validated)
    } else if (isLowSurrogate(code)) {
      // low surrogate without a preceding high surrogate
      return true;
    }
  }
  return false;
}

// If we split an UTF-16 string in the middle of a surrogate pair,
// it results in broken text. This function detects it.
function splitsSurrogatePair(str, pos) {
  if (pos <= 0 || pos >= str.length) {
    // spliting at the start or end can never break
    return false;
  }

  return (
    isHighSurrogate(str.charCodeAt(pos - 1)) &&
    isLowSurrogate(str.charCodeAt(pos))
  );
}

// visible for testing
export function backportMaskToOriginalText(
  originalText,
  decodedText,
  maskedDecodedText,
) {
  if (maskedDecodedText.length === 0) {
    return '';
  }

  let nextMasked = maskedDecodedText.indexOf(MASKED);
  if (nextMasked === -1) {
    return originalText;
  }

  const matches = [];
  let posOrig = 0; // originalText
  let posDecoded = 0; // decodedText
  let posMasked = 0; // maskedDecodedText

  while (posMasked < maskedDecodedText.length) {
    const decodedPart = maskedDecodedText.slice(posMasked, nextMasked);
    const posDecodedMaskingBegins = posDecoded;
    posDecoded = decodedText.indexOf(decodedPart, posDecoded);
    if (posDecoded === -1) {
      logger.error('[backportMaskToOriginalText] Failed for example:', {
        originalText,
        decodedText,
        maskedDecodedText,
      });
      throw new Error('Illegal state: expected a match.');
    }
    if (
      posDecoded > 0 &&
      decodedText.indexOf(decodedPart, posDecoded + 1) !== -1
    ) {
      // Edge case: there are multiple candidates from which could continue.
      // Be conservative and mask to the end.
      const result = matches.join(MASKED) + MASKED;
      logger.warn('Conservative matching hit:', {
        originalText,
        decodedText,
        maskedDecodedText,
        result,
      });
      return result;
    }

    const skipped = decodedText.slice(posDecodedMaskingBegins, posDecoded);
    posOrig += encodeURIComponent(skipped).length;

    const encodedPart = encodeURIComponent(decodedPart);
    matches.push(originalText.slice(posOrig, posOrig + encodedPart.length));

    posOrig += encodedPart.length;
    posDecoded += decodedPart.length;
    posMasked = nextMasked + MASKED.length;

    nextMasked = maskedDecodedText.indexOf(MASKED, posMasked);
    if (nextMasked === -1) {
      const fromEnd = encodeURIComponent(
        maskedDecodedText.slice(posMasked),
      ).length;
      matches.push(originalText.slice(originalText.length - fromEnd));
      break; // end of text is masked
    }
  }

  return matches.join(MASKED);
}
