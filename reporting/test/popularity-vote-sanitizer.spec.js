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

import { expect, assert } from 'chai';
import fc from 'fast-check';

import {
  sanitizeHostname,
  sanitizePathSegment,
  backportMaskToOriginalText,
} from '../src/popularity-vote-sanitizer.js';

/**
 * Helper to test if it is possible to start from the full text
 * and remove single characters to end up with the reduced text
 * (not changing order).
 *
 * Example:
 * 1) textCanBeDerivedByRemovingChars({ fullText: 'banana', reducedTo: 'aana' }) ==> true
 * 2) textCanBeDerivedByRemovingChars({ fullText: 'banana', reducedTo: 'xyz' }) ==> false
 */
function textCanBeDerivedByRemovingChars({ fullText, reducedTo }) {
  let full = 0;
  let reduced = 0;
  while (reduced < reducedTo.length && full < fullText.length) {
    if (reducedTo[reduced] === fullText[full]) {
      reduced++;
    }
    full++;
  }
  return reduced === reducedTo.length;
}

describe('#sanitizeHostname', function () {
  describe('should not modify safe hostnames', function () {
    for (const safeHostname of [
      'example.com',
      'productionresultssa11.blob.core.windows.net',
      'www.google.com',
      'docs.google.com',
      'hackmd.io',
      'audit.verified-data.com',
      'www.google.de',
      'stackoverflow.com',
      'deepwiki.com',
      'discourt.com',
      'taxi.booking.com',
      'ghostery.1password.com',
      'www.figma.com',
      'signin.aws.amazon.com',
      'www.nytimes.com',
      'www.sueddeutsche.de',
      'hilfe.sueddeutsche.de',
      'www.bild.de',
      'www.youtube.com',
      'www.instagram.com',
      'www.tiktok.com',
      'www.tiktok.com',
      'mastodon.social',
      'github.com',
      'www.nbcnews.com',
      'www.amazon.com',
      'www.otto.de',
      'us-east-1.signin.aws',
      'us-east-1.console.aws.amazon.com',
      'wiki.archlinux.org',
      'chat.deepseek.com',
      'chat.mistral.ai',
      'www.finanzen.net',
      'en.wikipedia.org',
      'www.wsj.com',
      'www.lemonde.fr',
      'www.theguardian.com',
      'www.reddit.com',
      'www.reuters.com',
      'app.tuta.com',
      'support.microsoft.com',
      'alexandros-mpomponieres.gr',
      'мой-сайт.рф', // [Cyrillic]
      'www.мой-сайт.рф', // [Cyrillic]
      'www.%D0%BC%D0%BE%D0%B9-%D1%81%D0%B0%D0%B9%D1%82.%D1%80%D1%84', // [Cyrillic] www.мой-сайт.рф
      'մեդիա.ամ', // [Armenia]
      'www.մեդիա.ամ', // [Armenia]
      'www.%D5%B4%D5%A5%D5%A4%D5%AB%D5%A1.%D5%A1%D5%B4', // [Armenia] www.մեդիա.ամ
    ]) {
      it(`- ${safeHostname}`, function () {
        expect(sanitizeHostname(safeHostname)).to.eql(safeHostname);
      });
    }
  });

  describe('should mask unsafe parts in hostnames', function () {
    for (const { unsafe, safe } of [
      {
        unsafe: 'c3fbed0c-9713-4c89-8074-73dc15b0b34e.example.com',
        safe: '#??#.example.com',
      },
      {
        unsafe: 'c3fbed0c-9713-4c89-8074-73dc15b0b34e.example.com',
        safe: '#??#.example.com',
      },
    ]) {
      it(`- ${unsafe} ==> ${safe}`, function () {
        expect(sanitizeHostname(unsafe)).to.eql(safe);
      });
    }
  });

  describe('[property based testing]', function () {
    it('should only remove, but never add characters', function () {
      fc.assert(
        fc.property(fc.webUrl(), (url) => {
          const { hostname } = new URL(url);
          const sanitized = sanitizeHostname(hostname);
          if (!sanitized.includes('#??#')) {
            return sanitized === hostname;
          }
          if (sanitized.length > hostname.length) {
            return false;
          }
          const nonMasked = sanitized.replaceAll('#??#', '');
          return textCanBeDerivedByRemovingChars({
            fullText: hostname,
            reducedTo: nonMasked,
          });
        }),
      );
    });
  });
});

describe('#sanitizePathSegment', function () {
  describe('should not modify safe URL path segments', function () {
    for (const safePath of [
      'actions-results',
      'logs',
      'job',
      'job-logs.txt',
      'maps',
      'place',
      'presentation',
      'd',
      'document',
      'edit',
      'projects',
      'page-inspector',
      'dir',
      'questions',
      'how-to-programmatically-skip-a-test-in-mocha',
      'search',
      'invite',
      'en-gb',
      'promotions',
      'free-taxi',
      'ghostery',
      '@ghostery',
      'vaults',
      'all',
      'allitems',
      'tags',
      'proto',
      'Ghostery-Search',
      'oauth',
      '2026',
      '03',
      '24',
      'us',
      'politics',
      'saudi-prince-iran-trump.html',
      'science',
      'archaeology-egypt-hatshepsut.html',
      'politik',
      'muenchen',
      'neuer-login',
      'regional',
      'watch',
      'heidiklum',
      'reel',
      'explore',
      '@',
      '@houseofhighlights',
      '@NBA@sportsbots.xyz',
      'privacy-policy',
      'commits',
      'main',
      'commit',
      'pull',
      'ghostery-extension',
      '38364',
      'specials',
      'unaffordable-america-economy-inflation-us-jobs-prices-bills-stocks',
      's',
      'Apple-iPhone-Version-Desert-Titanium',
      'dp',
      'platform',
      'login',
      'cloudwatch',
      'home',
      'capricorn86',
      'happy-dom',
      'title',
      'Main_page',
      'Frequently_asked_questions',
      'General_troubleshooting',
      'a',
      'chat',
      's',
      'nachricht',
      'aktien',
      'wiki',
      'articles',
      'en',
      'opinion',
      'article',
      'italy-giorgia-meloni-s-failed-gamble-on-judicial-reform_6751782_23.html',
      'lifeandstyle',
      'mar',
      'do-we-really-need-eight-hours-sleep-night',
      'popular',
      'comments',
      '1s2fh5u',
      'curiosity_wheels_taken_yesterday_showing_the',
      'sustainability',
      'bpclsembcorp-jv-wins-indias-lowest-green-hydrogen-supply-contract-2026-03-24',
      'mail',
      'c++',
      'a+b', // because we never want to increase size ("a+b" smaller than "#??#")
      '+@Matthiasberger_',
      '@Matthiasberger_',
      '@ghostery_adblocker',
      'whotracksme',
      'en-us',
      'windows',
      '25',
      'technology',
      'social-media-trial-verdict.html',
      'cegkatalogus',
      '%ce%b4%ce%b9%ce%b5%cf%8d%ce%b8%cf%85%ce%bd%cf%83%ce%b7',
      'armodiotites',
      '%CE%B2%CE%B1%CF%80%CF%84%CE%B9%CF%83%CF%84%CE%B9%CE%BA%CE%B1-%CE%BA%CE%BF%CF%81%CE%B9%CF%84%CF%83%CE%B9', // [Greek] βαπτιστικα-κοριτσι/σετ-βαπτισης-κοριτσι
      '%CF%83%CE%B5%CF%84-%CE%B2%CE%B1%CF%80%CF%84%CE%B9%CF%83%CE%B7%CF%82-%CE%BA%CE%BF%CF%81%CE%B9%CF%84%CF%83%CE%B9', // [Greek] σετ-βαπτισης-κοριτσι
      '%cf%83%cf%87%ce%bf%ce%bb%ce%b9%ce%ba%ce%ae-%ce%ba%ce%bf%ce%b9%ce%bd%cf%8c%cf%84%ce%b7%cf%84%ce%b1', // [Greek] σχολική-κοινότητα
      '%d9%82%d8%b1%d8%a7%d8%b1-%d8%b1%d9%82%d9%85-255-%d8%a7%d9%84%d9%85%d8%a4%d8%b1%d8%ae-%d9%81%d9%8a-25-%d9%81%d9%8a%d9%81%d8%b1%d9%8a-2024-%d8%a7%d9%84%d8%b0%d9%8a-%d9%8a%d8%ad%d8%af%d8%af-%d9%85%d8%b9', // [Arabic] قرار-رقم-255-المؤرخ-في-25-فيفري-2024-الذي-يحدد-مع
      'მაგალითი', // [Georgian]
      '%E1%83%9B%E1%83%90%E1%83%92%E1%83%90%E1%83%9A%E1%83%98%E1%83%97%E1%83%98', // [Georgian] მაგალითი
      '%E1%83%97%E1%83%98%E1%83%A1-%E1%83%98%E1%83%A1-%E1%83%90-%E1%83%9A%E1%83%9D%E1%83%9C%E1%83%92%E1%83%94%E1%83%A0-%E1%83%94%E1%83%A5%E1%83%96%E1%83%94%E1%83%9B%E1%83%9E%E1%83%9A', // [Georgian] თის-ის-ა-ლონგერ-ექზემპლ
      'це-є-тест-довшого-урл', // [Cyrillic letters]
      '%D1%86%D0%B5-%D1%94-%D1%82%D0%B5%D1%81%D1%82-%D0%B4%D0%BE%D0%B2%D1%88%D0%BE%D0%B3%D0%BE-%D1%83%D1%80%D0%BB', // [Cyrillic letters] це-є-тест-довшого-урл
      'հարցազրույց', // [Armenia]
      '%D5%B0%D5%A1%D6%80%D6%81%D5%A1%D5%A6%D6%80%D5%B8%D6%82%D5%B5%D6%81', // [Armenia] հարցազրույց
    ]) {
      it(`- "${safePath}"`, function () {
        expect(sanitizePathSegment(safePath)).to.eql(safePath);
      });
    }
  });

  describe('should mask unsafe parts in URL path segments', function () {
    for (const { unsafe, safe } of [
      {
        unsafe: 'c3fbed0c-9713-4c89-8074-73dc15b0b34e',
        safe: '#??#',
      },
      {
        unsafe: 'workflow-job-run-5264e576-3c6f-51f6-f055-fab409685f20',
        safe: 'workflow-job-run-#??#',
      },
      {
        unsafe: '@45.5335096,9.5914633,6z',
        safe: '#??#',
      },
      {
        unsafe:
          'data=!4m6!3m5!1s0x14e08328df81f339:0x54f774f3db260cf6!8m2!3d34.8714923!4d33.6076734!16zL20vMDhjdnl0',
        safe: '#??#',
      },
      {
        unsafe:
          'iran-news-heute-lars-klingbeil-plaediert-fuer-benzin-preisobergrenzen-a-51a9d808-0b50-457b-9f02-3b57ea73c1e2',
        safe: 'iran-news-heute-lars-klingbeil-plaediert-fuer-benzin-preisobergrenzen-a-#??#',
      },
      {
        unsafe: '9XpbVvYa_lFqDCGEWIpICseNdEAuxcq4DgMs0JDfMwi3',
        safe: '#??#',
      },
      {
        unsafe: 'HniR4NtMZLqRsFeuXZ-t_h',
        safe: '#??#',
      },
      {
        unsafe: '9796qb15-x17b-79x6-4xv2-qv3v28px9x22',
        safe: '#??#',
      },
      {
        unsafe: 'rn4f8296-8394-781z-rj32-f0zf3rj0r651',
        safe: '#??#',
      },
      {
        unsafe: 'LARNACA+INTERNATIONAL+AIRPORT',
        safe: '#??#',
      },
      {
        unsafe: '@48.1464153,11.5525926,11.75z',
        safe: '#??#',
      },
      {
        unsafe: 'data=!4m3!15m2!1m1!1s%2Fg%2F11s4_3sshh',
        safe: '#??#',
      },
      {
        unsafe: '48.1564796,11.6311754',
        safe: '#??#',
      },
      {
        unsafe: 'Wiener+Platz,+81667+M%C3%BCnchen',
        safe: '#??#',
      },
      {
        unsafe: '@48.1565756,11.6231737,15.29z',
        safe: '#??#',
      },
      {
        unsafe:
          'data=!4m9!4m8!1m0!1m5!1m1!1s0x479e7580f08e3557:0x9ebb96a9af940857!2m2!1d11.5963084!2d48.1344051!3e1',
        safe: '#??#',
      },
      {
        unsafe: '32723167',
        safe: '#??#',
      },
      {
        unsafe: 'Prinzenstra%C3%9Fe+34,+10969+Berlin',
        safe: '#??#',
      },
      {
        unsafe:
          'data=!4m8!4m7!1m2!1m1!1s0x47a84e27f6193ab3:0xdbe499a344366b2b!1m2!1m1!1s0x47a84e2da4f0f1d7:0x76a0f390734091c0!3e0',
        safe: '#??#',
      },
      {
        unsafe:
          'when-writing-shards-there-is-a_9db8c020-ea05-4c3e-a9bb-41e877400db7',
        safe: 'when-writing-shards-there-is-#??#',
      },
      {
        unsafe:
          'ZnOXrIKBwG5Hbsq28oB7cH4MbLLwZUbcA5LvUq8LG8aMe-hoTi4SdcC30NgUj0jtw4_HbaODtTyXwYAI765zmy5vRKeUjbCG-rk4H69cHxfy3ogjMlD2LXG4PG89Jul_Y6XnlFtIg7EId0L2u4-r1Ksg1ggG9YiP3Tr1jiyFMb4cPJk0U7rBGdMJbsLhh1b5kR1l7RqysjBzkp-McAAtwYa80E9Um7Cg5WMKwa3gHsgVy6VgxgCq0aWX8H5huMdh2xKHSLIZG1MbT3q5dXeOi-2GCFMMAggfqO99aDjbmsuGtRn2ipg-cENXNoOtkpJqqc0x8SJIuU6RePpaX1q7uF76hcWHLPPMqFRRwsPVZ1ZvPJyWJS1erITnQaEoHROu03FC5GOU2KJpQIRlKAtuYEhsddrBXi-Ry0gIXS9Q12msXopYA6qo6iiraRNCQLgpb0A1AfDl44alSgkSLHiYKIbxtYYNFcIaCBI3ms-0XzRBIo6kr9JTkwJOXXPsT1wTPyPrv8enAK7D6dXMhW81Dck5WZusefLIdTKqemP24Iq=',
        safe: '#??#',
      },
      {
        unsafe: 'X3PHB-LW4',
        safe: '#??#',
      },
      {
        unsafe: '4a405zik6imv2zpvbcyjbvmzny',
        safe: '#??#',
      },
      {
        unsafe: 'oy7juqz5atpcyfqqiakaudysof',
        safe: '#??#',
      },
      {
        unsafe: '1cuy4g2rcnoszcic0kgp9orfv0',
        safe: '#??#',
      },
      {
        unsafe: 'ahnh704vx6nomjylyx8hnbtixl',
        safe: '#??#',
      },
      {
        unsafe: 'GXFNk9mpiyKYXizAwhE9VE',
        safe: '#??#',
      },
      {
        unsafe: 'VhyRJ31lL3CL00OZ7kiNfL',
        safe: '#??#',
      },
      {
        unsafe: '5ztlf8Dazo-Oyj8kqVZwv7aSqg5ZPBlu3_cIbhgJdQfX',
        safe: '#??#',
      },
      {
        unsafe: 'russland-spione-drohnen-manager-anschlag-li.3458250',
        safe: 'russland-spione-drohnen-manager-anschlag-li#??#',
      },
      {
        unsafe: 'krieg-trump-iran-verhandlungen-pakistan-li.3457876',
        safe: 'krieg-trump-iran-verhandlungen-pakistan-li#??#',
      },
      {
        unsafe:
          'muenchen-buergermeisterin-koalition-gruene-stellvertreterin-dominik-krause-li.3457909',
        safe: 'muenchen-buergermeisterin-koalition-gruene-stellvertreterin-dominik-krause-li#??#',
      },
      {
        unsafe:
          'mario-gomez-fc-bayern-legende-hat-millionen-stress-mit-denkmalamt-69be6e5be2b1286a2c524d8a',
        safe: 'mario-gomez-fc-bayern-legende-hat-millionen-stress-mit-denkmalamt-#??#',
      },
      {
        unsafe: 'kmwIeEkFYLf',
        safe: '#??#',
      },
      {
        unsafe: 'DWOQbyEjvCQ',
        safe: '#??#',
      },
      {
        unsafe: '7620632578755710221',
        safe: '#??#',
      },
      {
        unsafe: 'a3bdcc71e74e66d1607d2490e197e675ae8b2b7b',
        safe: '#??#',
      },
      {
        unsafe: 'B0DHJ9SCJ4',
        safe: '#??#',
      },
      {
        unsafe:
          'songmics-gartenliege-1-st-sonnenliege-6cm-dicker-matratze-aluminium-atmungsaktiv-S0B190PP',
        safe: 'songmics-gartenliege-1-st-sonnenli#??#icker-matratze-aluminium-atmungs#??#',
      },
      {
        unsafe: 'd-906766b033',
        safe: 'd-9#??#',
      },
      {
        unsafe: '5b1f0808-18b9-4602-8100-6147f2cc9812',
        safe: '#??#',
      },
      {
        unsafe: 'Spittelmarkt,+10117+Berlin',
        safe: '#??#',
      },
      {
        unsafe:
          'strategischer-rueckzug-bayer-aktie-schwach-grossaktionaer-trennt-sich-von-aktien-im-dreistelligen-millionenwert-00-15573032',
        safe: 'strategischer-rueckzug-bayer-aktie-schwach-grossaktionaer-trennt-sich-von-aktien-im-dreistelligen-millionenwert-00-#??#',
      },
      {
        unsafe: '1954973424486608928',
        safe: '#??#',
      },
      {
        unsafe: 'Jeffrey_W._Ubben',
        safe: 'Jeffr#??#',
      },
      {
        unsafe: 'fox-nominates-valueact-ceo-jeffrey-ubben-to-board-1443530308',
        safe: 'fox-nominates-valueact-ceo-jeffrey-ubben-to-board-#??#',
      },
      {
        unsafe: 'RUiFUYKzkz',
        safe: '#??#',
      },
      {
        unsafe:
          'uF8IEAt2DG_hdNoik_OC5zrh3lt2ncoIWYd1Q-_N-gz-FyCi9Kb6pXEafGc9cCJBEIhIbl_Oj0aPe8yKGj3ZRcIAB4vbNyjCYS-mFVJLSVK-ygPdXpiV4JGdsH1Qsv',
        safe: '#??#',
      },
      {
        unsafe:
          'vROTCK_qdTD3DStjilJEWWtP1zOO3iVFx9glCW0J8C6IanZ8B4ALln45mK0rj8gf4-0MOMkYOenRqUymMhYkIz==',
        safe: '#??#',
      },
      {
        unsafe: 'Jhf6-Ie-7x-3',
        safe: '#??#',
      },
      {
        unsafe: 'EaXSrHR--S-3',
        safe: '#??#',
      },
      {
        unsafe:
          'free-up-drive-space-in-windows-85529ccb-c365-490d-b548-831022bc9b32',
        safe: 'free-up-drive-space-in-windows-#??#',
      },
      {
        unsafe:
          'this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text',
        safe: 'this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-some-huge-text-this-is-s#??#',
      },
      {
        unsafe:
          '5662_3290_-ac-dc-hegesztogep-acelhegeszto-elektroda-acetilen-palack-aggregator-akkumulatortolto-aluminium-hegesztogep-argon-palack-avi-hegesztogep-awi-elektroda-szinei-awi-hegesztes-awi-hegesztogep-badogos-paka-borkoteny-co-hegesztogep-CO2-palack-corgon-palack-csaphegeszto-egoszarak-elektroda-tipusok-elfelrako-elektrodak-femszoras-fogyoelektrodas-hegesztogep-forrasztas-gazpalack-toltes-hasznalt-co-palack-hasznalt-hegesztogep-hegesztes-hegesztes-dunakeszi-hegesztes-kreativitas-hegeszteskreativitas-hegesztestechnika-hegesztestechnika-dunakeszi-hegesztestechnikai-eljarasok-hegeszto-elektroda-tipusok-hegeszto-eszkozok-hegeszto-palack-hegeszto-transzformatorok-hegesztoanyagok-hegesztoelektroda-hegesztoeljarasok-hegesztogep-hegesztogep-alkatresz-hegesztogep-elado-hegesztogep-felulvizsgalat-hegesztogep-gyartas-hegesztogep-javitas-hegesztogep-kolcsonzes-hegesztogep-szerviz-hegesztokabel-hegesztopajzs-hegesztopalca-hegesztopisztoly-helium-palack-hosszu-ivvel-hegesztes-inverter-inverteres-hegesztogep-ipari-ezust-ipari-gazok-iv-lang-hegesztes-ivhegeszto-kevert-gazpalack-kis-langhegeszto-labszarvedo-langhegesztes-langhegeszto-lezersugaras-hegesztes-mag-hegesztogep-markolat-mig-hegesztogepek-MIG-WIG-eljaras-muanyag-hegesztogep-muanyaghegesztes-munkakabel-nagyfrekvencias-hegesztogep-hegesztes-es-kreativitas-nitrogen-palack-nyomascsokkento-oxigenpalack-ontvenypalcak-plazmahegesztes-plazmavago-ponthegesztes-ponthegeszto-porbeles-huzal-propanbutan-palack-reduktor-savallo-huzalok-tig-hegesztogep-vagokorong-vas-langhegesztese-vedogazas-hegesztogep-vedogazos-ivhegesztes-vedokesztyu-vedoszemuveg-vonalhegesztes-vonalhegeszto-wolfram-elektroda-wolframelektrodas-ivhegesztes-Plazma-iv-Kft-Dunakeszi.html',
        safe: '5662_3290_-ac-dc-hegesztogep-acelhegeszto-elektroda-acetilen-palack-aggregator-akkumulatortolto-aluminium-hegesztogep-argon-#??#',
      },
      {
        unsafe:
          'set-vaptisis-koritsi-ksilini-troley-elena-manakou-origami-bird-7450-1499-17398-17424-17429-17430-17431-17432-17433-17434-17435-detail',
        safe: 'set-vaptisis-koritsi-ksilini-troley-elena-manakou-origami-bird-7450-1499-17398-17424-17429-17430-17431-17432-17433-17434-174#??#',
      },
      {
        // simulate mixed text: takes a safe Greek text and appends a UUID at the end (which should be masked)
        unsafe:
          '%CE%B2%CE%B1%CF%80%CF%84%CE%B9%CF%83%CF%84%CE%B9%CE%BA%CE%B1-%CE%BA%CE%BF%CF%81%CE%B9%CF%84%CF%83%CE%B9-b6100c59-d9b4-412a-bf57-e0925354971a',
        safe: '%CE%B2%CE%B1%CF%80%CF%84%CE%B9%CF%83%CF%84%CE%B9%CE%BA%CE%B1-%CE%BA%CE%BF%CF%81%CE%B9%CF%84%CF%83%CE%B9-#??#',
      },
      {
        // simulate mixed text: takes a safe Arabic text and appends a UUID at the end (which should be masked)
        unsafe:
          '%d9%82%d8%b1%d8%a7%d8%b1-%d8%b1%d9%82%d9%85-255-%d8%a7%d9%84%d9%85%d8%a4%d8%b1%d8%ae-%d9%81%d9%8a-25-%d9%81%d9%8a%d9%81%d8%b1%d9%8a-2024-%d8%a7%d9%84%d8%b0%d9%8a-%d9%8a%d8%ad%d8%af%d8%af-%d9%85%d8%b9-b6100c59-d9b4-412a-bf57-e0925354971a',
        safe: '%d9%82%d8%b1%d8%a7%d8%b1-%d8%b1%d9%82%d9%85-255-%d8%a7%d9%84%d9%85%d8%a4%d8%b1%d8%ae-%d9%81%d9%8a-25-%d9%81%d9%8a%d9%81%d8%b1%d9%8a-2024-%d8%a7%d9%84%d8%b0%d9%8a-%d9%8a%d8%ad#??#',
      },
      {
        // simulate mixed text: takes a safe text with Cyrillic letters and appends a UUID at the end (which should be masked)
        unsafe: 'це-є-тест-довшого-урл-b6100c59-d9b4-412a-bf57-e0925354971a',
        safe: 'це-є-тест-довшого-урл-#??#',
      },
      {
        // simulate mixed text: takes a safe text with Cyrillic letters and appends a UUID at the end (which should be masked)
        unsafe:
          '%D1%86%D0%B5-%D1%94-%D1%82%D0%B5%D1%81%D1%82-%D0%B4%D0%BE%D0%B2%D1%88%D0%BE%D0%B3%D0%BE-%D1%83%D1%80%D0%BB-b6100c59-d9b4-412a-bf57-e0925354971a',
        safe: '%D1%86%D0%B5-%D1%94-%D1%82%D0%B5%D1%81%D1%82-%D0%B4%D0%BE%D0%B2%D1%88%D0%BE%D0%B3%D0%BE-%D1%83%D1%80%D0%BB-#??#',
      },
      {
        // simulate mixed text: takes a safe text with Armenian letters and appends a UUID at the end (which should be masked)
        unsafe:
          '%D5%B0%D5%A1%D6%80%D6%81%D5%A1%D5%A6%D6%80%D5%B8%D6%82%D5%B5%D6%81-b6100c59-d9b4-412a-bf57-e0925354971a',
        safe: '%D5%B0%D5%A1%D6%80%D6%81%D5%A1%D5%A6%D6%80%D5%B8%D6%82%D5%B5%D6%81-#??#',
      },
    ]) {
      it(`- ${unsafe} ==> ${safe}`, function () {
        const sanitized = sanitizePathSegment(unsafe);
        if (sanitized !== safe) {
          assert.fail(
            `mismatch for example:\n${unsafe}   (was the actual result)\n==>\n${sanitized}\n${safe}  (would have been correct)`,
          );
        }
      });
    }
  });

  describe('should not crash on arbitrary URL path segments', function () {
    for (const segment of ['%F0%90%80%80%F0%90%80%82%F0%90%A0%81IbFe']) {
      it(`- <<${segment}>>`, function () {
        sanitizePathSegment(segment); // should not throw
      });
    }
  });

  describe('[property based testing]', function () {
    it('should only remove, but never add characters', function () {
      fc.assert(
        fc.property(fc.webUrl(), (url) => {
          const { pathname } = new URL(url);
          for (const pathSegment of pathname.split('/').filter((x) => x)) {
            const sanitized = sanitizePathSegment(pathSegment);
            if (!sanitized.includes('#??#')) {
              return sanitized === pathSegment;
            }
            if (sanitized.length > pathSegment.length) {
              return false;
            }
            const nonMasked = sanitized.replaceAll('#??#', '');
            return textCanBeDerivedByRemovingChars({
              fullText: pathSegment,
              reducedTo: nonMasked,
            });
          }
        }),
      );
    });
  });
});

describe('#backportMaskToOriginalText', function () {
  for (const { originalText, maskedDecodedText, expected } of [
    {
      originalText: 'dummy',
      maskedDecodedText: '#??#',
      expected: '#??#',
    },
    {
      originalText: '%C3%A4%c3%a4',
      maskedDecodedText: '%C3%A4%c3%a4',
      expected: '%C3%A4%c3%a4',
    },
    {
      originalText: 'before-a3a95e19-5411-4444-9db9-0121fe86fe57-after',
      maskedDecodedText: 'before-#??#-after',
      expected: 'before-#??#-after',
    },
    {
      originalText:
        '%C3%A4-a3a95e19-5411-4444-9db9-0121fe86fe57-%c3%a4-a3a95e19-5411-4444-9db9-0121fe86fe57',
      maskedDecodedText: 'ä-#??#-ä-#??#',
      expected: '%C3%A4-#??#-%c3%a4-#??#',
    },
    {
      originalText:
        '%C3%A4%C3%A4-a3a95e19-5411-4444-9db9-0121fe86fe57-%c3%a4-a3a95e19-5411-4444-9db9-0121fe86fe57',
      maskedDecodedText: 'ää-#??#-ä-#??#',
      expected: '%C3%A4%C3%A4-#??#-%c3%a4-#??#',
    },
    {
      originalText: 'data=!4m3!15m2!1m1!1s%2Fg%2F11s4_3sshh',
      maskedDecodedText: '#??#',
      expected: '#??#',
    },
    {
      originalText:
        '%d9%82%d8%b1%d8%a7%d8%b1-%d8%b1%d9%82%d9%85-255-%d8%a7%d9%84%d9%85%d8%a4%d8%b1%d8%ae-%d9%81%d9%8a-25-%d9%81%d9%8a%d9%81%d8%b1%d9%8a-2024-%d8%a7%d9%84%d8%b0%d9%8a-%d9%8a%d8%ad%d8%af%d8%af-%d9%85%d8%b9-b6100c59-d9b4-412a-bf57-e0925354971a',
      maskedDecodedText: 'قرار-رقم-255-المؤرخ-في-25-فيفري-2024-الذي-يح#??#',
      expected:
        '%d9%82%d8%b1%d8%a7%d8%b1-%d8%b1%d9%82%d9%85-255-%d8%a7%d9%84%d9%85%d8%a4%d8%b1%d8%ae-%d9%81%d9%8a-25-%d9%81%d9%8a%d9%81%d8%b1%d9%8a-2024-%d8%a7%d9%84%d8%b0%d9%8a-%d9%8a%d8%ad#??#',
    },
    {
      originalText:
        'Cross-country_skiing_at_the_2026_Winter_Olympics_%E2%80%93_Men%27s_50_kilometre_classical',
      maskedDecodedText:
        'Cross-country_skiing_at_th#??#inter_Olympics_–_Me#??#ometre_classical',
      expected:
        'Cross-country_skiing_at_th#??#inter_Olympics_%E2%80%93_Me#??#ometre_classical',
    },
    {
      originalText:
        'Universidade%20NOVA%20de%20Lisboa%20-%20Faculdade%20de%20Ci%C3%AAncias%20e%20Tecnologia%20(FCT%20NOVA).html',
      maskedDecodedText: 'Universidade NOV#??#Faculdade de Ciência#??#',
      expected: 'Universidade%20NOV#??#Faculdade%20de%20Ci%C3%AAncia#??#',
    },
  ]) {
    it(`- ${originalText} and ${maskedDecodedText}`, function () {
      const actual = backportMaskToOriginalText(
        originalText,
        decodeURIComponent(originalText),
        maskedDecodedText,
      );
      expect(actual).to.eql(expected);
    });
  }
});
