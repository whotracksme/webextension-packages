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

class RecoverableError extends ExtendableError {
  constructor(message) {
    super(message);
    this.isRecoverableError = true;
    this.isPermanentError = false;
  }
}

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
export class ModuleDisabled extends RecoverableError {}
