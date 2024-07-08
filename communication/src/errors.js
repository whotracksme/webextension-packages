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

/**
 * The base class to cover all expected error situations in
 * anonymous-communication; errors are either recoverable
 * (RecoverableError) or permanent (PermanentError). Clients
 * can use this information to implement their own error recovery.
 *
 * Note: anonymous-communication will not wrap unexpected errors.
 * If you see one, it is a strong indicator that there is a bug
 * in the code (e.g. configuration errors, incorrect use of the API).
 */
class ExtendableError extends Error {
  constructor(message) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error(message).stack;
    }
  }
}

/**
 * Serves as a hint that retrying the failed operation later
 * is a reasonable error-recovery strategy.
 *
 * Even for recoverable errors, retrying immediately is almost
 * never a good idea. When you get an error, it means that
 * anonymous-communication exhausted the basic error recovery options.
 *
 * What does "basic error recovery" mean? annonymous-communications
 * intends to provide a reliable channel, but at some time being
 * agnostic of the semantics of messages.
 *
 * Two illustrate the fine line of responsibilities, let us
 * look at two examples:
 *
 * 1) the network times out when sending one message (same if
 *    the server fails to respond): here anonymous-credentials
 *    can transparently attempt to send it again after a few seconds.
 * 2) the network is down for extended period (e.g. on mobile)
 *    and failed messages are queing up: here it is the responsibly
 *    of the client to decide whether older message should be dropped,
 *    retried at a later point, or replaced by updated messages.
 */
class RecoverableError extends ExtendableError {
  constructor(message) {
    super(message);
    this.isRecoverableError = true;
    this.isPermanentError = false;
  }
}

/**
 * Thrown if an operation failed and it is guaranteed that
 * retrying it will result in the identical error.
 *
 * For example, if a message was rejected since it was is too big,
 * trying to send it again will again trigger the identical error.
 */
class PermanentError extends ExtendableError {
  constructor(message) {
    super(message);
    this.isRecoverableError = false;
    this.isPermanentError = true;
  }
}

export class TooBigMsgError extends PermanentError {}
export class TransportError extends RecoverableError {}
export class ProtocolError extends PermanentError {}
export class InvalidMessageError extends PermanentError {}
export class ClockOutOfSync extends RecoverableError {}
