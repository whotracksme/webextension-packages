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
 * Note the MDN warning:
 * > SHA-1 is now considered vulnerable and should not be used for cryptographic applications.
 *
 * So, why do we use it? The quorum services uses it to convert URLs (or other strings) to a
 * hard-to-reverse, fixed-length digest. sha1 should be still difficult enough to reverse
 * (in practice, going the other way and enumerating URLs should be easier); collision attacks
 * are also unlikely, since to find a collision, an attacker would first need to guess the hash
 * of the URL (or string). But when knowing already the cleartext URL (or its hash), then it
 * can be directly use to trick clients into sharing them.
 *
 * Still, migration the procotol (phasing out sha1) would make sense, especially to modern, faster
 * algorithms (e.g Blake2, Blake3). Unfortunately, the browser support is still lacking; switching
 * instead to widely supported successors like SHA-256 does not seem worth it (having also the
 * drawback of needing more space (not a show-stopper, but a concern on the server side).
 */
export async function sha1(str) {
  const dataUint8 = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-1', dataUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
