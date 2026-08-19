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
import { findPlaceholders } from './http';

/**
 * The goal of double-fetch is to reject content that only a logged-in user
 * could see, because such content may leak private information; that is why it
 * loads a page as anonymously as possible: no credentials, no cookies. In
 * practice that is too limiting: a site behind AWS WAF, for instance, may be
 * configured to require its token.
 *
 * Since it is infeasible to detect login-related cookies, we use an allowlist
 * approach. The only rule is that an entry must not unlock non-public content,
 * which rules out anything session-like (e.g. "oauth_token", "api_token").
 *
 * Note: being on this list is necessary but not sufficient. A cookie is read
 * only if a double-fetch configuration names it, and only if it is scoped to
 * the site being fetched - exactly as the browser would scope it.
 */
const TRUSTED_COOKIES = new Set([
  '_abck',
  'acw_tc',
  'addtl_consent',
  'AEC',
  'ak_bmsc',
  'aws-waf-token',
  'AWSALB',
  'AWSALBCORS',
  'axeptio_authorized_vendors',
  'axeptio_cookies',
  'bm_sv',
  'bm_sz',
  'borlabs-cookie',
  '__cf_bm',
  'cf_clearance',
  '__cfduid',
  '__cflb',
  '_cfuvid',
  'cky-consent',
  '__cmpcc',
  '__cmpconsent',
  'cmphitorder',
  '__cmpiab',
  'cmplz_banner-status',
  'cmplz_consented_services',
  'cmpsessid',
  'CONSENT',
  'consent-policy',
  'consentUUID',
  'CookieConsentBulkTicket',
  'cookie_consent',
  'CookieConsent',
  'CookieConsentPolicy',
  'cookieconsent_seen',
  'cookieconsent_status',
  'cookiefirst-consent',
  'cookielawinfo-checkbox-necessary',
  'CookieLawInfoConsent',
  'cookieyes-consent',
  'datadome',
  'didomi_token',
  'disable-cmp',
  'euconsent',
  'euconsent-v2',
  'f5_cspm',
  'FCCDCF',
  'FCNEC',
  'GOOGLE_ABUSE_EXEMPTION',
  'gdpr_popup',
  'gpp',
  'gpp_sid',
  'gpp-string',
  'https_waf_cookie',
  'KP_UIDz',
  'NID',
  'OptanonAlertBoxClosed',
  'OptanonConsent',
  'OptanonControl',
  'osano_consentmanager',
  'pow_challenge',
  'pow_nonce',
  '_px3',
  'pxcts',
  '_pxhd',
  '_pxvid',
  'rbzid',
  'reese84',
  'ROUTEID',
  '__Secure-ENID',
  'SOCS',
  'sp_consent',
  '_sp_enable_dfp_personalized_ads',
  '_sp_v1_consent',
  '__tlbcpv',
  'usercentrics',
  'usprivacy',
  'viewed_cookie_policy',
  'waf_captcha_marker',
  'x-amz-continuous-deployment-state',
]);

/**
 * Finds the cookies that the given double-fetch configuration is allowed to
 * borrow from the user: on the trusted list, asked for by the configuration,
 * and scoped to the URL that is about to be fetched.
 *
 * The lookup passes no "storeId", so it sees only the cookie store of the
 * extension's own background context, which is the user's normal profile.
 * Private windows and Firefox containers are separate stores, so their cookies
 * are never even visible here - they are excluded by not asking for them,
 * rather than by filtering them out afterwards.
 */
export async function findSafeCookies(url, params) {
  const requested = requestedCookies(params);
  if (requested.size === 0) {
    return new Map();
  }
  if (!chrome?.cookies?.getAll) {
    logger.debug('cookie API unavailable: no safe cookie');
    return new Map();
  }

  const found = new Map();
  await Promise.all(
    [...requested].map(async (name) => {
      try {
        // The first match is the most specific one, i.e. the one that the
        // browser itself would send first.
        const cookies = await chrome.cookies.getAll({ url, name });
        const value = cookies?.[0]?.value;
        if (value) {
          found.set(name, value);
        }
      } catch (e) {
        logger.warn('Unable to look up cookie:', name, e);
      }
    }),
  );
  return found;
}

/**
 * Collects the names of all trusted cookies that the given configuration
 * references. Placeholders can occur in headers and in "requires" entries,
 * both in the shared configuration and in each step; the "onError"
 * configuration is scanned recursively.
 */
function requestedCookies(params, requested = new Set()) {
  for (const { headers = {}, requires = [] } of [
    params || {},
    ...(params?.steps || []),
  ]) {
    for (const template of [...Object.values(headers), ...requires]) {
      collectSafeCookies(template, requested);
    }
  }
  if (params?.onError) {
    requestedCookies(params.onError, requested);
  }
  return requested;
}

function collectSafeCookies(template, requested) {
  for (const expression of findPlaceholders(template)) {
    for (const placeholder of expression.split('||')) {
      if (placeholder.startsWith('safecookie:')) {
        const name = placeholder.slice('safecookie:'.length);
        if (TRUSTED_COOKIES.has(name)) {
          requested.add(name);
        } else {
          logger.warn('Ignoring', placeholder, '(not a trusted cookie)');
        }
      }
    }
  }
}
