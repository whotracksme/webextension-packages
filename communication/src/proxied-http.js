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

import { encodeWithPadding } from './padding.js';
import { fromBase64, toBase64, fromUTF8, toUTF8 } from './encoding.js';
import { inflate } from './zlib.js';
import { ProtocolError, TransportError } from './errors.js';

const ANONYMOUS_COMMUNICATION_PROTOCOL_VERSION = 1;
const ANONYMOUS_COMMUNICATION_ECDH_P256_AES_128_GCM = 0xea;

async function exportKey(key) {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

async function sha256(data) {
  return new Uint8Array(await crypto.subtle.digest({ name: 'SHA-256' }, data));
}

function randomInt() {
  // Consider using true random here
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/**
 * Responsible for sending WhoTracksMe message to the servers.
 *
 * In our context, there are two additional side-goals:
 *
 * 1) Anonymity: the server should NOT be able to link messages
 *    to the same client
 * 2) Duplicate detection: the server should be able to detect it
 *    when malicious clients send duplicated messages
 *
 * These goals seem to be in conflict, but it can be supported through a
 * cryptographic algorithm called "Direct Anonymous Attestation". The
 * client can include a zero-knowledge proof that it has not sent the
 * message before (see https://github.com/whotracksme/anonymous-credentials).
 *
 * (TODO: anonymous-credentials hasn't been ported to Manifest V3. It relies
 * on pairing-based cryptography, which we implemented with web assembly
 * in Manifest V2. Perhaps web assembly will be support in Manifest V3
 * eventually but it is hard to predict at this point. For details, see
 * https://bugs.chromium.org/p/chromium/issues/detail?id=1173354)
 *
 * When it comes to anonymity, there is still the challenge that the server
 * could link messages by meta data from the network layer (e.g. the IP address).
 * To prevent that, messages can be routed through a trusted-party (e.g. Tor or
 * through third-party proxies). Since the trusted-party should neither be able to
 * read or modify the content of the messages, each message needs to be end-to-end
 * encrypted and techniques to defend against statistical attacks (guessing messages
 * based on their length) should be applied as well.
 *
 * In our current implementation, we are using AES-128-GCM with a non-iteractive
 * Diffie-Hellman key exchange (server keys being rotated once a key). In addition,
 * payloads are padded to power-of-2 buckets to defend against traffic analysis.
 *
 * Notes:
 * - It is important to stress that the assumption here is that messages are
 *   already free of identifiers and are safe against fingerprinting attacks.
 *   If you send messages that can be linked based on their content, then
 *   stripping network layer information will not magically make it safe.
 * - Our goal is to follow a "privacy by design" architecture: the server should
 *   not have access to more information beside the message payload.
 *   But independent of whether the traffic is sent directly or through a
 *   trusted-party, Ghostery will not log the IP of the sender.
 */
export default class ProxiedHttp {
  constructor(config, serverPublicKeyAccessor) {
    this.viaProxyEndpointTemplate = config.COLLECTOR_PROXY_URL;
    this.serverPublicKeyAccessor = serverPublicKeyAccessor;
  }

  async send({ body }) {
    const { ciphertext, iv, secret, clientPublicKey, serverPublicKeyDate } =
      await this.encrypt(body);

    // layout:
    // * algorithm type (1 byte)
    // * client ECDH public key (65 bytes; the size of the key after export)
    // * initialization vector (12 byte)
    const encryptionHeader = new Uint8Array(1 + 65 + 12);
    encryptionHeader[0] = ANONYMOUS_COMMUNICATION_ECDH_P256_AES_128_GCM;
    encryptionHeader.set(clientPublicKey, 1);
    encryptionHeader.set(iv, 1 + 65);

    const headers = {
      'Content-Type': 'application/octet-stream',
      Version: ANONYMOUS_COMMUNICATION_PROTOCOL_VERSION.toString(),
      Encryption: toBase64(encryptionHeader),
      'Key-Date': serverPublicKeyDate,
    };

    const proxyUrl = this._chooseRandomProxyUrl();
    let response;
    try {
      response = await fetch(proxyUrl, {
        method: 'POST',
        headers,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'manual',
        body: ciphertext,
      });
    } catch (e) {
      throw new TransportError(`Failed to send data to '${proxyUrl}'`, {
        cause: e,
      });
    }
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new TransportError(
          `Failed to send data (${response.statusText})`,
        );
      }
      throw new Error(`Failed to send data (${response.statusText})`);
    }

    let data;
    try {
      data = new Uint8Array(await response.arrayBuffer());
    } catch (e) {
      throw new TransportError('Failed to process response data', { cause: e });
    }

    const serverIV = response.headers.get('Encryption-IV');
    if (serverIV) {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64(serverIV),
          tagLength: 128,
        },
        secret,
        data,
      );
      data = new Uint8Array(decrypted);
    }

    // Depending on the message type, we need to decompress the data.
    // In the Anonymous Communication protocol, the type is implicitely defined:
    // * if the data starts with 0x7B (=== '{'), it can be directly consume
    //   (e.g. fire-and-forget messages will always return '{}')
    // * otherwise, decompress it
    //   (format: "<size: 4-byte unsigned int>:<data: "size" bytes>")
    if (data[0] !== 0x7b) {
      const size = new DataView(data.buffer).getUint32();
      if (4 + size > data.length) {
        throw new ProtocolError('Overflow in data received from the server');
      }
      data = inflate(data.subarray(4, 4 + size));
    }
    const { status, body: body_ } = JSON.parse(fromUTF8(data));
    return new Response(body_, { status });
  }

  _chooseRandomProxyUrl() {
    const MIN_PROXY_NUM = 1;
    const MAX_PROXY_NUM = 100;
    const NUM_PROXIES = MAX_PROXY_NUM - MIN_PROXY_NUM + 1;
    const proxyNum = (randomInt() % NUM_PROXIES) + MIN_PROXY_NUM;
    return this.viaProxyEndpointTemplate.replace('*', proxyNum);
  }

  async generateClientECDHKey() {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveKey'],
    );
    return {
      publicKey: await exportKey(publicKey),
      privateKey,
    };
  }

  async negotiateSecret() {
    // Setup:
    // 1) get the server's public key for today
    // 2) compute a new public/private key pair
    const [serverKey, clientKeys] = await Promise.all([
      this.serverPublicKeyAccessor.getKey(),
      this.generateClientECDHKey(),
    ]);
    const { publicKey: serverPublicKey, date: serverPublicKeyDate } = serverKey;
    const { publicKey: clientPublicKey, privateKey: clientPrivateKey } =
      clientKeys;

    // Perform ECDH to get a curve point (on P-256, which is assumed
    // have an effective security strength of at least 128 bits).
    // To derive the symmetric key for AES-128-GCM, first hash with
    // SHA-256, then take 16 bytes resulting in the desired 128 bit key.
    const derivedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', namedCurve: 'P-256', public: serverPublicKey },
      clientPrivateKey,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    );
    const rawDerived = await exportKey(derivedKey);
    const raw128bitKey = (await sha256(rawDerived)).subarray(0, 16);
    const secret = await crypto.subtle.importKey(
      'raw',
      raw128bitKey,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt', 'decrypt'],
    );
    return { secret, clientPublicKey, serverPublicKeyDate };
  }

  /**
   * When sending through proxies, we have to create a secure channel.
   * Like ANONYMOUS_COMMUNICATION, we use an Integrated Encryption Scheme (IES). First, exchange
   * a symmentric key (through ECDH). Then derive a AES key and encrypt
   * the data with AES-128-GCM.
   *
   * In addition, we should take counter-measures against traffic analysis.
   * To achieve that, payloads are padded to the next power-of-2 bucket size
   * (with a minimum size of 1K).
   */
  async encrypt(plaintext) {
    const { secret, clientPublicKey, serverPublicKeyDate } =
      await this.negotiateSecret();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // note: we are assuming JSON messages, here
    const unpaddedPlaintext = toUTF8(
      typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext),
    );
    const data = encodeWithPadding(unpaddedPlaintext);
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 },
        secret,
        data,
      ),
    );

    return { ciphertext, iv, secret, clientPublicKey, serverPublicKeyDate };
  }
}
