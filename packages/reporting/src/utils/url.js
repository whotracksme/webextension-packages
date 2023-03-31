import { ImmutableURL } from '@cliqz/url-parser';

const ipv4Part = '0*([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])'; // numbers 0 - 255
const ipv4Regex = new RegExp(
  `^${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}\\.${ipv4Part}([:]([0-9])+)?$`,
); // port number

export function isIpv4Address(host) {
  return ipv4Regex.test(host);
}

/**
 * This is an abstraction over URL with caching and basic error handling built in. The main
 * difference is that this catches exceptions from the URL constructor (when the url is invalid)
 * and returns null instead in these cases.
 * @param String url
 * @returns {URL} parsed URL if valid is parseable, otherwise null;
 */
export function parse(url) {
  // We can only try to parse url of type `string`.
  if (typeof url !== 'string') {
    return null;
  }

  // If it's the first time we see `url`, try to parse it.
  try {
    const parsed = new ImmutableURL(url);
    return parsed;
  } catch (e) {
    return null;
  }
}

function tryDecode(fn) {
  return (url) => {
    // Any decoding function should always be given a 'string' argument but
    // since the name of the function `try` implies that it should *never* throw
    // it is safer to add an explicit check for this.
    if (typeof url !== 'string') {
      return url;
    }

    // We observe that in practice, most URLs do not need any decoding; to make
    // sure the cost is as low as possible, we first check if there is a chance
    // that decoding will be needed (will be false 99% of the time).
    if (url.indexOf('%') === -1) {
      return url;
    }

    try {
      return fn(url);
    } catch (e) {
      return url;
    }
  };
}

export const tryDecodeURIComponent = tryDecode(decodeURIComponent);

export function isPrivateIP(ip) {
  // Need to check for ipv6.
  if (ip.indexOf(':') !== -1) {
    // ipv6
    if (ip === '::1') {
      return true;
    }
    const ipParts = ip.split(':');
    return (
      ipParts[0].startsWith('fd') ||
      ipParts.every((d, i) => {
        if (i === ipParts.length - 1) {
          // last group of address
          return d === '1';
        }
        return d === '0' || !d;
      })
    );
  }
  const ipParts = ip.split('.').map((d) => parseInt(d, 10));
  return (
    ipParts[0] === 10 ||
    (ipParts[0] === 192 && ipParts[1] === 168) ||
    (ipParts[0] === 172 && ipParts[1] >= 16 && ipParts[1] < 32) ||
    ipParts[0] === 127 ||
    ipParts[0] === 0
  );
}

export function getName(url) {
  if (url === null) {
    return null;
  }

  if (url.hostIsIp) {
    return 'IP';
  }

  if (!url.hostname) {
    return url.pathname;
  }

  return url.domainInfo.domainWithoutSuffix || url.generalDomain;
}
