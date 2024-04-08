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

// The concept here is taken from ../../anonymous-communication/src/errors.es
// (see comments there for details). In a nutshell, by classifying errors in
// being either recoverable or permanent, you can give hints to steer
// the error recovery.

class ExtendableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

class RecoverableError extends ExtendableError {
  constructor(message, options) {
    super(message, options);
    this.isRecoverableError = true;
    this.isPermanentError = false;
  }
}

class PermanentError extends ExtendableError {
  constructor(message, options) {
    super(message, options);
    this.isRecoverableError = false;
    this.isPermanentError = true;
  }
}

/**
 * For jobs that are ill-formed (e.g. have missing or invalid fields).
 */
export class BadJobError extends PermanentError {}

/**
 * If trying to override HTTP headers, but the platform does not support it.
 */
export class UnableToOverrideHeadersError extends PermanentError {}

/**
 * Thrown when requests failed, but where the client can try to
 * repeat the request without modification (e.g. timeouts will
 * fall into this category).
 */
export class TemporarilyUnableToFetchUrlError extends RecoverableError {}

/**
 * Thrown when requests failed, but where the client should not
 * repeat the request without modification (e.g. most 4xx errors fall
 * into this category).
 */
export class PermanentlyUnableToFetchUrlError extends PermanentError {}

/**
 * For 429 (too many request) errors that should be retried.
 */
export class RateLimitedByServerError extends TemporarilyUnableToFetchUrlError {}

/**
 * Thrown if patterns are invalid. This could either be because they are
 * corrupted, or if the client is too outdated.
 */
export class BadPatternError extends PermanentError {}

/**
 * Thrown when an unknown transformation builtin is referrenced.
 * In most situation, it means the client is outdated.
 */
export class UnsupportedTransformationError extends PermanentError {}
