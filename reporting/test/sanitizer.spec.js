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

import { expect } from 'chai';
import fc from 'fast-check';

import {
  sanitizeUrl,
  checkSuspiciousQuery,
  isValidEAN13,
  isValidISSN,
} from '../src/sanitizer.js';

describe('#checkSuspiciousQuery', function () {
  function shouldBeSafe(query) {
    const { accept, reason } = checkSuspiciousQuery(query);
    expect(accept).to.eql(true);
    expect(reason).to.be.undefined;
  }

  function shouldBeDropped(query) {
    const { accept, reason } = checkSuspiciousQuery(query);
    expect(accept).to.eql(false);
    expect(reason).to.be.a('string').that.is.not.empty;
  }

  describe('should accept simple, normal queries', function () {
    for (const safeQuery of [
      'munich',
      'joe biden',
      'what is the meaning of life?',
      'best android phone in 2023',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should drop queries with overly long words', function () {
    for (const unsafeQuery of [
      'UniversitätsverwaltungsdirektorinnenUniversitätsverwaltungsdirektorinnenUniversitätsverwaltungsdirektorinnen',
      'universitätsverwaltungsdirektorinnenuniversitätsverwaltungsdirektorinnenuniversitätsverwaltungsdirektorinnen',
      'Some query containing an overlong word like universitätsverwaltungsdirektorinnenuniversitätsverwaltungsdirektorinnenuniversitätsverwaltungsdirektorinnen',
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }

    for (const safeQuery of [
      'Abarbeitungsgeschwindigkeit',
      'abarbeitungsgeschwindigkeit',
      'Abgeordnetenentschädigungen',
      'abgeordnetenentschädigungen',
      'Unfallentschädigungsbehörde',
      'Universitätsverwaltungsdirektorinnen',
      'universitätsverwaltungsdirektorinnen',
      'Some query containing a long word like Universitätsverwaltungsdirektorinnen',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should drop queries with overly long text', function () {
    for (const unsafeQuery of [
      'Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet. Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam et justo duo dolores et ea rebum. Stet clita kasd gubergren, no sea takimata sanctus est Lorem ipsum dolor sit amet.',
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }

    for (const safeQuery of [
      'how many champions league tournaments have been held',
      'Is life an arbitrary stage in the growing complexity of matter?',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should be more conservative with limits for languages such as Chinese or Japanese', function () {
    for (const unsafeQuery of [
      // lorem impsum auto-translated
      '痛苦本身是巨大的，令人悲伤的事情已经解决了，但是', // Chinese
      '痛み自体は大きく、悲しみのエリートは解決しましたが、一時', // Japanese
      'ความเจ็บปวดนั้นยอดเยี่ยมมาก ความทุกข์ระทมก็สงบลง', // Thai
      '고통 자체는 크며, 슬픈 elitr은 해결되었지만 diam nonumy eirmo는 한동안 노동과 고통으로 대단한 일 이었지만', // Korean
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }

    for (const safeQuery of [
      // "weather munich" auto-translated
      '天气慕尼黑',
      '天気 ミュンヘン',
      'สภาพอากาศ มิวนิค',
      '날씨 뮌헨',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should support languages with different alphabets', function () {
    for (const safeQuery of [
      // "some dummy text" auto-translated
      'какой-то фиктивный текст',
      'بعض النصوص الوهمية',
      'איזה טקסט דמה',
      'कुछ नकली पाठ',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should support special letters', function () {
    for (const safeQuery of [
      'German text äößÖÄ€',
      'French text éèêë',
      'Swedish text åÅ',
      'Polish text ąęśŚ',
      'Turkish text ÇĞİÖŞÜ',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }
  });

  describe('should drop searches containing phone numbers', function () {
    for (const unsafeQuery of [
      '089 / 123 456 789',
      '(0)89 123456789',
      '089123456789',
      '+4989123456789',
      '089 - 1234 567 89',
      'some text 089 - 1234 567 89',
      'some 089 - 1234 567 89 text',
      '089 - 1234 567 89 some text',
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }
  });

  describe('should not drop EAN numbers', function () {
    for (const safeQuery of [
      '9780345418913',
      '9780345418913 some text',
      'some 9780345418913 text',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }

    for (const unsafeQuery of [
      '9780345418912',
      '9780345418912 some text',
      'some 9780345418912 text',
    ]) {
      it(`should drop invalid EANs: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }
  });

  describe('should not drop ISSN numbers', function () {
    for (const safeQuery of [
      '2049-3630',
      '2049-3630 some text',
      'some 2049-3630 text',
    ]) {
      it(`should accept: ${safeQuery}`, function () {
        shouldBeSafe(safeQuery);
      });
    }

    for (const unsafeQuery of [
      '2049-3631',
      '2049-3631 some text',
      'some 2049-3631 text',
    ]) {
      it(`should drop invalid ISSNs: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }
  });

  describe('should drop searches containing email addresses', function () {
    for (const unsafeQuery of [
      'my.name@example.test',
      'some text my.name@example.test',
      'some my.name@example.test text',
      'my.name@example.test some text',
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }
  });

  describe('should drop searches containing HTTP passwords', function () {
    for (const unsafeQuery of [
      'user:password@example.test',
      'some text user:password@example.text',
      'some user:password@example.test text',
      'user:password@example.test some text',
    ]) {
      it(`should reject: ${unsafeQuery}`, function () {
        shouldBeDropped(unsafeQuery);
      });
    }
  });
});

describe('#sanitizeUrl', function () {
  // to test URLs that are generally safe and should be accepted both in
  // normal mode and strict mode
  function shouldBeSafe(url) {
    {
      const { result, safeUrl, reason } = sanitizeUrl(url);
      if (result !== 'safe') {
        expect.fail(
          `Expected the URL ${url} to be safe, but it was rejected: ${reason}`,
        );
      }
      expect(safeUrl).to.eql(url);
      expect(reason).to.be.undefined;
    }
    {
      const { result, safeUrl, reason } = sanitizeUrl(url, { strict: true });
      if (result !== 'safe') {
        expect.fail(
          `Expected the URL ${url} to be safe, but it was rejected: ${reason}`,
        );
      }
      expect(safeUrl).to.eql(url);
      expect(reason).to.be.undefined;
    }
  }

  // to test URLs that are generally safe, but may lead to false-positives in strict mode
  function shouldBeSafeInNonStrictMode(url) {
    const { result, safeUrl, reason } = sanitizeUrl(url);
    if (result !== 'safe') {
      expect.fail(
        `Expected the URL ${url} to be safe, but it was rejected: ${reason}`,
      );
    }
    expect(safeUrl).to.eql(url);
    expect(reason).to.be.undefined;
  }

  // to test URLs that should be always dropped
  function shouldBeDropped(url) {
    {
      const { result, safeUrl, reason } = sanitizeUrl(url);
      expect(result).to.eql('dropped');
      expect(safeUrl).to.eql(null);
      expect(reason).to.be.a('string').that.is.not.empty;
    }
    {
      const { result, safeUrl, reason } = sanitizeUrl(url, { strict: true });
      expect(result).to.eql('dropped');
      expect(safeUrl).to.eql(null);
      expect(reason).to.be.a('string').that.is.not.empty;
    }
  }

  // to test URLs that should be always truncated (or even dropped in strict mode)
  function shouldBeTruncated(url) {
    {
      const { result, safeUrl, reason } = sanitizeUrl(url);
      expect(result).to.eql('truncated');
      expect(safeUrl).to.be.a('string').that.is.not.empty;
      expect(safeUrl.endsWith(' (PROTECTED)'), 'ends with "(PROTECTED)"').to.be
        .true;
      expect(reason).to.be.a('string').that.is.not.empty;
    }
    {
      const { result, safeUrl, reason } = sanitizeUrl(url, { strict: true });
      expect(result).to.be.oneOf(['truncated', 'dropped']);
      if (result === 'truncated') {
        expect(safeUrl).to.be.a('string').that.is.not.empty;
        expect(safeUrl.endsWith(' (PROTECTED)'), 'ends with "(PROTECTED)"').to
          .be.true;
      } else {
        expect(safeUrl).to.eql(null);
      }
      expect(reason).to.be.a('string').that.is.not.empty;
    }
  }

  // to test URLs that should be always truncated or dropped
  function shouldBeDroppedOrTruncated(url) {
    let originalResult;
    {
      const { result, safeUrl, reason } = sanitizeUrl(url);
      expect(result).to.be.oneOf(['truncated', 'dropped']);
      expect(safeUrl).to.not.eql(url);
      expect(reason).to.be.a('string').that.is.not.empty;
      originalResult = result;
    }
    {
      const { result, safeUrl, reason } = sanitizeUrl(url, { strict: true });
      if (originalResult === 'dropped' && result !== 'dropped') {
        expect.fail(
          'Expected the URL ${url} that was dropped in default mode to also be dropped in strict mode',
        );
      }
      expect(result).to.be.oneOf(['truncated', 'dropped']);
      expect(safeUrl).to.not.eql(url);
      expect(reason).to.be.a('string').that.is.not.empty;
    }
  }

  // to test URLs that should be truncated in strict mode
  // (but may be accepted in non-strict mode)
  function shouldBeTruncatedInStrictMode(url) {
    {
      const { result, safeUrl, reason } = sanitizeUrl(url, { strict: true });
      expect(result).to.eql('truncated');
      expect(safeUrl).to.be.a('string').that.is.not.empty;
      expect(safeUrl.endsWith(' (PROTECTED)'), 'ends with "(PROTECTED)"').to.be
        .true;
      expect(reason).to.be.a('string').that.is.not.empty;
    }
  }

  describe('should accept trivial URLs', function () {
    [
      'https://example.com/',
      'https://www.ghostery.com/',
      'https://de.wikipedia.org/',
    ].forEach((url) => {
      it(`should accept URL: ${url}`, function () {
        shouldBeSafe(url);
      });
    });
  });

  describe('should drop URLs with username and/or passwords', function () {
    [
      'https://user@example.com/',
      'https://user@example.com/foo/bar',
      'https://user:password@example.com/',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs to localhost', function () {
    [
      'http://127.0.0.1/',
      'http://127.0.0.1/some/local/app',
      'http://localhost:8080/',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URls where IP addresses are used as hostnames', function () {
    [
      'http://182.180.189.84/',
      'http://192.168.0.119/',
      'http://85.11.187.84/saff/index.php?topic=3221141.0',
      'http://10.234.0.1/',
      'https://10.234.0.1/',
      'http://0.0.0.0/',
      'http://1.1.1.1/',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs with non-standard HTTP ports', function () {
    ['http://myserver.test:1234/', 'https://www.myserver.test:5678/'].forEach(
      (url) => {
        it(`should drop URL: ${url}`, function () {
          shouldBeDropped(url);
        });
      },
    );

    it('should allow port 80', function () {
      shouldBeSafe('http://myserver.test:80/');
    });

    it('should allow port 443', function () {
      shouldBeSafe('https://myserver.test:443/');
    });
  });

  describe('should drop non-HTTP protocols', function () {
    [
      'ftp://example.test/',
      'mailto:someone@example.com',
      'file:///home/user/some-local-file.txt',
      'data:text/plain;charset=UTF-8;page=21,the%20data:1234,5678',
      'data:text/vnd-example+xyz;foo=bar;base64,R0lGODdh',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs that leak extension IDs', function () {
    [
      'moz-extension://ad2fe927-3371-4319-9b32-1c9b3cdb53a0/',
      'moz-extension://ad2fe927-3371-4319-9b32-1c9b3cdb53a0/foo/bar?x=1',
      'chrome-extension://mlomiejdfkolichcflejclcbmpeaniij/app/templates/panel.html',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs with extremly long hostnames', function () {
    [
      'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.foo.test/',
      'https://optsokzkgaqmvplqrcjfkgpnfxuluhmfaklxfvsfeyvwavsrqrhtvkvxhskjjraibwfzau.foo.test/',
      'https://aaaaa.aaaaaaaaaaaa.aaaaaaaaaaaa.aaaaaaaaaaaa.aaaaaaaaaaaaaa.aaaaaaaaaa.foo.test/',
      'https://optso.zkgaqmvplqrc.fkgpnfxuluhm.aklxfvsfeyvw.vsrqrhtvkvxhsk.jraibwfzau.foo.test/',
      'https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.foo.test/bar?x=y',
      'https://optso.zkgaqmvplqrc.fkgpnfxuluhm.aklxfvsfeyvw.vsrqrhtvkvxhsk.jraibwfzau.foo.test/bar?x=y',
      'http://1couriersdeliveryservicesusanycnybostonmawashingtondcnewarknjct.1esamedaycourieranddeliveryserviceinnewyorknybostonmawashington.com/',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs of onion services', function () {
    [
      'https://protonmailrmez3lotccipshtkleegetolb73fuirgj7r4o4vfu7ozyd.onion/',
      'https://protonmailrmez3lotccipshtkleegetolb73fuirgj7r4o4vfu7ozyd.onion/login',
      'https://www.nytimesn7cgmftshazwhfgzm37qxb44r64ytbb2dj3x62d2lljsciiyd.onion/',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeDropped(url);
      });
    });
  });

  describe('should drop URLs that contain geo-coordinates', function () {
    [
      'https://www.google.com/maps/dir//Spring,+TX+77373/@30.095431,-95.6501944,10z/data=!4m18!1m8!3m7!1s0x8640ccc646dfdb4b:0x496129fbe4b11b29!2sSpring,+TX+77373!3b1!8m2!3d30.0799405!4d-95.4171601!16zL20vMDEwMnFx!4m8!1m0!1m5!1m1!1s0x8640ccc646dfdb4b:0x496129fbe4b11b29!2m2!1d-95.4171601!2d30.0799405!3e0?entry=ttu',
      'https://www.google.com/maps/search/correios+curitiba+joao+negrao+telefone/@-25.4393609,-49.2639141,17z/data=!3m1!4b1?entry=ttu',
      'https://www.google.com/maps/dir//London+Stansted+Airport+(STN),+Bassingbourn+Rd,+Stansted+CM24+1QW,+United+Kingdom/@51.8863747,0.2387409,17z/data=!3m1!5s0x47d88fb4f87490e3:0x165d2ba117eb3309!4m17!1m7!3m6!1s0x487604b8a52a1bb7:0x30a4d0976b352648!2sLondon+Stansted+Airport!8m2!3d51.8863747!4d0.2413158!16zL20vMGhjc2g!4m8!1m0!1m5!1m1!1s0x487604b8a52a1bb7:0x30a4d0976b352648!2m2!1d0.2413158!2d51.8863747!3e2?entry=ttu',

      'https://www.google.com/maps/search/somesearch+querythat+may+point+tosomething/@-33.6278509,-39.2539141,17z/data=!3m1!4b1?entry=ttu',
      'https://www.google.com/maps/place/Klinikum+rechts+der+Isar+der+Technischen+Universit%C3%A4t+M%C3%BCnchen/@48.1379612,11.5936122,16z/data=!3m1!5s0x479e75825cd00d45:0xd2ae74823f848e47!4m9!1m2!2m1!1sfriedensengel!3m5!1s0x479e7582085e4a3f:0xa3dffab473c868fe!8m2!3d48.1369622!4d11.5987872!16s%2Fm%2F027drtc?entry=ttu',
      'https://www.google.com/maps/dir/54.7925405,9.4078768/47.664786,12.4509673/@51.0971126,5.652494,6z/data=!3m1!4b1!4m2!4m1!3e1?entry=ttu',
      'https://www.google.com/maps/dir/54.7925405,9.4078768/47.664786,12.4509673/@52.1471636,10.5343305,15z/am=t/data=!4m6!4m5!3e2!6m3!1i0!2i0!3i292?entry=ttu',
      'https://www.google.sk/maps/@48.7418457,19.1206357,17z',
      'https://www.google.sk/maps/@48.7418457,19.1206357,17z?hl=sk',

      'https://earth.google.com/web/search/Friedensengel,+Munich/@48.13744933,11.57593029,543.01680528a,198.36981833d,35y,56.31537172h,63.30010268t,0r/data=CigiJgokCbWQ8mGJyElAEaUBKqw4vUlAGbBzvV65kbq_IUBAl4LnwMe_',
      'https://earth.google.com/web/@52.51681316,13.37854689,36.02282027a,264.60462944d,35y,-85.81195214h,67.15515115t,0r/data=ClQaUhJMCiUweDQ3YTg1MWM2NTVmMjA5ODk6MHgyNmJiZmI0ZTg0Njc0YzYzGbNgPUkVQkpAIQMjL2tiwSpAKhFCcmFuZGVuYnVyZ2VyIFRvchgCIAE',

      'https://www.bing.com/maps?osid=e0523a41-9eb1-41f0-b11c-82e4df1dd657&cp=52.216391~20.965831&lvl=14.48&pi=0&imgid=326a2db2-988d-4b37-b7ee-c6171118f522&v=2&sV=2&form=S00027',
      'https://www.bing.com/maps?osid=e0523a41-9eb1-41f0-b11c-82e4df1dd657&cp=52.217702%7E20.975582&lvl=17.1&imgid=326a2db2-988d-4b37-b7ee-c6171118f522&v=2&sV=2&form=S00027',

      'https://yandex.com/maps/org/untersbergstra_e/186631167268/?ll=11.591015%2C48.108343&z=15',
      'https://yandex.com/maps/99/munich/?ll=11.513703%2C48.114106&mode=routes&rtext=48.088307%2C11.645045~48.116376%2C11.502502&rtt=auto&ruri=~&z=13',

      'https://map.baidu.com/dir/%E6%B9%96%E5%8C%97%E7%9C%81%E8%8D%86%E5%B7%9E%E5%B8%82%E7%9B%91%E5%88%A9%E5%B8%82/%E6%B9%96%E5%8C%97%E7%9C%81%E6%AD%A6%E6%B1%89%E5%B8%82%E6%B1%9F%E5%A4%8F%E5%8C%BA/@12583662.48,3523702.875,10z?querytype=bt&c=1713&sn=1$$$$12549545.96,3485268.75$$%E6%B9%96%E5%8C%97%E7%9C%81%E8%8D%86%E5%B7%9E%E5%B8%82%E7%9B%91%E5%88%A9%E5%B8%82$$0$$$$&en=1$$$$12708649.959999993,3508820.7624418424$$%E6%B9%96%E5%8C%97%E7%9C%81%E6%AD%A6%E6%B1%89%E5%B8%82%E6%B1%9F%E5%A4%8F%E5%8C%BA$$0$$$$&sc=1713&ec=1713&pn=0&rn=5&exptype=dep&exptime=2024-03-04%2017:24&version=5&da_src=shareurl',

      'https://www.openstreetmap.org/search?whereami=1&query=48.13664%2C11.57526#map=19/48.13664/11.57526',
      'https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=48.13697%2C11.57475%3B48.13758%2C11.57521#map=19/48.13635/11.57565',

      'https://citymapper.com/london/superrouter?end=51.5112932884513,-0.117667260852045&eaddr=Somerset House, Strand, London, WC2R 1LA',
      'https://citymapper.com/london/superrouter?end=51.5112932884513,-0.117667260852045&eaddr=Somerset%20House,%20Strand,%20London,%20WC2R%201LA',
      'https://www.seeker.info/index.php/location/fr-DE/Hambourg,_Allemagne@53.5510846,9.99368179999999/theme/18514__Toilettes_publiques/detail/osm_node_264990234__Europa Passage?lang=fr',
      'https://www.timeanddate.com/sun/@12.5781879602632,122.268390655518',
      'http://busqueda.lavoztx.com/en/garden-grove-ca/local/.a_5.c_bingo-halls/?p=2&coords=33.773905300000003,-117.941447699999998',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should truncate long URLs', function () {
    it('should truncate URLs by preserving only the hostname', function () {
      const url =
        'https://www.example.com/foo-106783?cep=C6SNdZ-JdYgfxMe-Ew0e8PbCNBIeJNwcVsgDmQGentDzy4rUEIYTxZt6797urbzd-X5xoFI8QMYyZkHfIevGn3BMV0PZ2myYl6UB65r7iChjOeqLXibqpfGtFNt55Pe68Bi1qnbbHfJ10nNDib54gnog3PEKDMC6G95iU8o7wKTCIHPsL52Vs1pQrdh8eB_ETPDzRCPmJ-QIOKfdBb3RmXkC7EEAO3nG7dhHR3sD60tlU9c-O9mKA73w3p0Er9HEFnibX8QVkoostBEZob5WtfiIgTdiYFWtc0jnBtJQdfRiYbForVoYlkm6eUReWgKRGxmCr8tU6p9GANbZf8QMRyFp0LnK9FaPi3Ti2J99ZMKKxCsCrczjz-0lE-bOtnpAcQ1Kq3CFne4T4_PfF68UhJ3QMQlZK5592M_fOgeCem6g0bDRfWRhva4HV-1PY2ccp4i_olg3mnJhQn1NWLLgOVMDKgWM4zneB_SlBWpZ0FjIIqU6mpAtmx33x6vF9A5qQWKginNWJETV3BZvspcVU47wBxdIMmHPwxIFuVcu1uoS1u_HmEVbsmrIPzCqgmej_Rz0zIMdpB_CUCI6gVHLCUmLhtb0rYCPfRT71L25idEyOOzuhLJd-caBlQWR3D_d54suQZ0YtPk_VtMIUtejmNOVkNJ_XemssaWb0flUKDuypAqogHwhT3GbGC3V_O-AlX1aO92nfo1dP46CMGT9lg8GizI-NRic1_NLy2hMkwmrhtkZjdvqgc-gRLAryB8ayHKEFy-ggfqaK0Dz0lrGgBcEPslee84q6ZQ6DVzkViq-razGQce5BTpD1ee8IxRnKgtxvQLK_i4qfcXLP9xP0vKmg7NjzKc0bre4eG8JiY8EoareMOwEdCb72gWyPOwM9MwR4Q4E8_N93qWRpBfHN_0bKrR9t-OunSr1kCW65qBylJa_bvpJ5UztYXQ8ijbE0gLU4TANyekzY-eYVcXues3dDr3Uso9RNA2BxKwiS7qE8sdI1h9yIHt8JAv3jWAwqvuD6Htv4Fnw2ZKgdYB--it9jYJEAId1SVyMyWjtySpTzYvsf1XDXxl2uOEOHHp67p39xE4XA4fuPBuAhTef9YZgP4qVIPhoTXywyjMQKP0uF09MoOuKCaX4yWNRzTe-3jEA6rSV9KrffnCzbS0UHSLy6zkNnUTulO_rOZ1HLDtslljN7iBNpBeBFg87qAMu0_-h2tFfblBnzcIYAFxfVRPS5Si-RWsaU62yS9R354q9ugncvBBzSHceVLcAMa6-4yvK8qAplqfJXmH8tNz5q6fVMhkxbl-JlNLFOUW0a-mhLglQCl_vr3twJ5HCOnvdiOq2GU3KqUBbIG63ZtNuw-ai8BHIYh1X49gW-s3fgQAbvihJWt3Nuc4wzfQg0KLQE4NQ9c-yYRtEh2PnocC0CHzvgapVQeiuW2e8d7-sJvFELPuCitEQbRBSTvVMEIjiCqhwtGNn5uQw5bvVN2i0ysGw3ebmb-Vg91y965jo0FEmAArJ4OwswS-_dXBYX6lvUZ688yaKPPEzcpgiEyXa-k4mFz60IVjFQROoRmYOZbbg9_PBo5mj2SjMB2-EOvp4_YV8h2JDNk7X7a-AcEUE60VaJkWE3SBcS45VsiAT8-y2Lkyfuq-lbCpBLw1gT1Mm6cdbqCaZ3hX7C_doCBjh3lnQNfCkDtEqUWa1xHULbaDDxxRzZb9R13Ua3YVOJF-DY0KFWxrMgBA_NjRosJEz0Lcji7LN9wmQktyoO5nZrAdQgtogMaiByqMNhjE8agj7FO8S2qItbCDiRg0pbKnes6bTBCw7_y1putoG31uTKcd6Z72Tn7kFyYib8eH_1N8Y';
      expect(sanitizeUrl(url).safeUrl).to.eql(
        'https://www.example.com/ (PROTECTED)',
      );
    });

    [
      'https://www.example.com/foo-106783?cep=C6SNdZ-JdYgfxMe-Ew0e8PbCNBIeJNwcVsgDmQGentDzy4rUEIYTxZt6797urbzd-X5xoFI8QMYyZkHfIevGn3BMV0PZ2myYl6UB65r7iChjOeqLXibqpfGtFNt55Pe68Bi1qnbbHfJ10nNDib54gnog3PEKDMC6G95iU8o7wKTCIHPsL52Vs1pQrdh8eB_ETPDzRCPmJ-QIOKfdBb3RmXkC7EEAO3nG7dhHR3sD60tlU9c-O9mKA73w3p0Er9HEFnibX8QVkoostBEZob5WtfiIgTdiYFWtc0jnBtJQdfRiYbForVoYlkm6eUReWgKRGxmCr8tU6p9GANbZf8QMRyFp0LnK9FaPi3Ti2J99ZMKKxCsCrczjz-0lE-bOtnpAcQ1Kq3CFne4T4_PfF68UhJ3QMQlZK5592M_fOgeCem6g0bDRfWRhva4HV-1PY2ccp4i_olg3mnJhQn1NWLLgOVMDKgWM4zneB_SlBWpZ0FjIIqU6mpAtmx33x6vF9A5qQWKginNWJETV3BZvspcVU47wBxdIMmHPwxIFuVcu1uoS1u_HmEVbsmrIPzCqgmej_Rz0zIMdpB_CUCI6gVHLCUmLhtb0rYCPfRT71L25idEyOOzuhLJd-caBlQWR3D_d54suQZ0YtPk_VtMIUtejmNOVkNJ_XemssaWb0flUKDuypAqogHwhT3GbGC3V_O-AlX1aO92nfo1dP46CMGT9lg8GizI-NRic1_NLy2hMkwmrhtkZjdvqgc-gRLAryB8ayHKEFy-ggfqaK0Dz0lrGgBcEPslee84q6ZQ6DVzkViq-razGQce5BTpD1ee8IxRnKgtxvQLK_i4qfcXLP9xP0vKmg7NjzKc0bre4eG8JiY8EoareMOwEdCb72gWyPOwM9MwR4Q4E8_N93qWRpBfHN_0bKrR9t-OunSr1kCW65qBylJa_bvpJ5UztYXQ8ijbE0gLU4TANyekzY-eYVcXues3dDr3Uso9RNA2BxKwiS7qE8sdI1h9yIHt8JAv3jWAwqvuD6Htv4Fnw2ZKgdYB--it9jYJEAId1SVyMyWjtySpTzYvsf1XDXxl2uOEOHHp67p39xE4XA4fuPBuAhTef9YZgP4qVIPhoTXywyjMQKP0uF09MoOuKCaX4yWNRzTe-3jEA6rSV9KrffnCzbS0UHSLy6zkNnUTulO_rOZ1HLDtslljN7iBNpBeBFg87qAMu0_-h2tFfblBnzcIYAFxfVRPS5Si-RWsaU62yS9R354q9ugncvBBzSHceVLcAMa6-4yvK8qAplqfJXmH8tNz5q6fVMhkxbl-JlNLFOUW0a-mhLglQCl_vr3twJ5HCOnvdiOq2GU3KqUBbIG63ZtNuw-ai8BHIYh1X49gW-s3fgQAbvihJWt3Nuc4wzfQg0KLQE4NQ9c-yYRtEh2PnocC0CHzvgapVQeiuW2e8d7-sJvFELPuCitEQbRBSTvVMEIjiCqhwtGNn5uQw5bvVN2i0ysGw3ebmb-Vg91y965jo0FEmAArJ4OwswS-_dXBYX6lvUZ688yaKPPEzcpgiEyXa-k4mFz60IVjFQROoRmYOZbbg9_PBo5mj2SjMB2-EOvp4_YV8h2JDNk7X7a-AcEUE60VaJkWE3SBcS45VsiAT8-y2Lkyfuq-lbCpBLw1gT1Mm6cdbqCaZ3hX7C_doCBjh3lnQNfCkDtEqUWa1xHULbaDDxxRzZb9R13Ua3YVOJF-DY0KFWxrMgBA_NjRosJEz0Lcji7LN9wmQktyoO5nZrAdQgtogMaiByqMNhjE8agj7FO8S2qItbCDiRg0pbKnes6bTBCw7_y1putoG31uTKcd6Z72Tn7kFyYib8eH_1N8Y',
      'https://www.ebay.com/itm/163578162904?_trkparms=aid=1110006&algo=HOMESPLICE.SIM&ao=1&asc=20200818143132&meid=c742ec041c2a472fb37e5619938525f4&pid=101198&rk=4&rkt=12&b=1&sd=183714353142&itm=163578162904&pmt=1&noa=0&pg=2047675&algv=SimplAMLCvipPairwiseWebWithBBEV2bDemotion&brand=GPR&_trksid=p2047675.c101198.m1985&amdata=cksum:163578162904c742ec041c2a472fb37e5619938525f4|enc:AQAFAAACEO1gRbE4sAI38m6EZRpzbYHt9+yQk5vBehmhugFgnd17OkYn0W555gLuJgoGFdYmC+BHEJ3b1mSo549wwtufJLAdy0dMBi9iAdXKeADjcgjm71kyFYVvAgt/0a+xOvYAqJMv2z3Ygpiux3Ba2KyLymWzBtI8d0dJFza/2IQKhhiibQtAh8AGWxt3i5/GcPW6d8+P36eLlNPC14uobuNPxmA7pxRunrP4xwNkQ7qod9RWebQ4+iBVr8/OBmp8ulmR+toSAD4WEySHQf62yBtANWEAvc7s77XgdgzjIhcxBMz5nBrwEe3ZPwVMiit6Kcnwg5S9bxJchrGh74nQTH3HwEOYN1qghIRC8Me3cOsdF4LFEeZtxiPHvjizNX2RO9+jnwluy0wq7dZeZiM+doqTSxbsh78ah0ZctrGMrMYO3OhY5ptxXsxL0eL5flyRRsXyNzKO/0EtLGzuwZd87pu0/c/B6mI4/JAqfs2+sFpmVW2q+/GnrgaTs0iXK4YdwdSOXd5cn1HTvp2cL18aedatm29/QsP0ZSheuHQAKZCASY4rASb6H1XaYApfOLa0yzU4fwVWCEoTc+5mO55+UxUYwZ0ZX+NWRCrQEjCHkdY+qfIs2JDvCpXQC0PTr571yWFgcQTv3RwYBZlHIqC5aTEYKAVeNQm5HP0udq9Q/pq2uASBXqYldCNh2M0bI0MsvuvFfg==|ampid:PL_CLK|clp:2047675&epid=10029966056',
      'https://pulsar.ebay.de/plsr/mpe/0/SAND/9?pld=%5B%7B%22ef%22%3A%22SAND%22%2C%22ea%22%3A%223PADS%22%2C%22pge%22%3A2367355%2C%22plsUBT%22%3A1%2C%22app%22%3A%22Sandwich%22%2C%22callingEF%22%3A%22SAND%22%2C%22difTS%22%3A60000%2C%22eventOrder%22%3A0%2C%22scandal_imp%22%3A%22meid%3A01HF9D6M05QAY12A7PXJCQC3DA%2Cplid%3A100562%2Cscorid%3A01HF9D5N3RHX8Y5JHFCN6A89J2%2Cprvdr%3Ahybrid%2Cafs%3A1700049145742%2Cade%3A0%7Cmeid%3A01HF9D6M2EBTS39V0893V2KVS1%2Cplid%3A100938%2Cscorid%3A01HF9D5N3RSYG09WFT7RWTDNC0%2Cprvdr%3Ahybrid%2Cafs%3A1700049145804%2Cade%3A0%22%7D%2C%20%7B%22ef%22%3A%22SAND%22%2C%22ea%22%3A%223PADS%22%2C%22pge%22%3A2367355%2C%22plsUBT%22%3A1%2C%22app%22%3A%22Sandwich%22%2C%22callingEF%22%3A%22SAND%22%2C%22difTS%22%3A29996%2C%22eventOrder%22%3A1%2C%22scandal_imp%22%3A%22meid%3A01HF9D7H9X7EC48AM748JF6Q4E%2Cplid%3A100562%2Cscorid%3A01HF9D6M05WNWMZ7GGSXQX7RAD%2Cprvdr%3Ahybrid%2Cafs%3A1700049175742%2Cade%3A0%7Cmeid%3A01HF9D7HBFS4EGX20SGQ0RW8SS%2Cplid%3A100938%2Cscorid%3A01HF9D6M2EDGBZG3Y2PCZ1722Q%2Cprvdr%3Ahybrid%2Cafs%3A1700049175804%2Cade%3A0%22%7D%5D',
      'https://www.skyscrapercity.com/showthread.php?t=1674676:@0.119399:0.238103:0.547455:0.238103:0.547455:0.222531:0.119399:0.222531:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000:0.000000',
    ].forEach((url) => {
      it(`should truncated: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });

    [
      'https://www.medimops.de/chip-huyen-designing-machine-learning-systems-an-iterative-process-for-production-ready-applications-taschenbuch-M01098107969.html?variant=LibriNew',
      'https://www.walmart.com/ip/Purina-ONE-Plus-Natural-Classic-Ground-Healthy-Puppy-Dog-Food-Wet-Lamb-and-Long-Grain-Rice-Entree-13-oz-Can/10295565?wl13=2123&selectedSellerId=0',
      'https://www.worten.pt/informatica-e-acessorios/computadores/computadores-portateis/portatil-asus-f415ea-51alhdcb2-14-intel-core-i5-1135g7-ram-8-gb-512-gb-ssd-intel-iris-xe-graphics-7553568',
      'https://www.oskab.com/cuisine/plan-de-travail-et-credence/plan-de-travail-pret-a-poser/42960-plan-de-travail-cuisine-n311-decor-marbre-noir-stratifie-chant-coordonne-l300-x-l62-x-e38-cm-planeko.html',
      'https://www.walmart.com/ip/Auto-Drive-Lightning-to-USB-A-Durable-Braided-Data-Sync-and-Charging-Cable-Cord-3-feet-Compatible-with-iPhone-12-11-SE-8-7-6-Made-by-Luxshare/351215507?wl13=4166&selectedSellerId=0',
      'https://www.bestbuy.ca/en-ca/product/motiongrey-standing-desk-height-adjustable-electric-motor-sit-to-stand-desk-computer-for-home-and-office-black-frame-55x24-tabletop-included-only-at-best-buy/15766135?cmp=seo-15766135',
      'https://www.darty.com/nav/achat/sports_loisirs/gyropode/gyropode/evercross_evercross_hoverboard_overboard_gyropode_tout_terrain_8_5_self_balancing_scooter_hummer_suv_bluetooth_app_700w_camouflege_hoverkart_kart_camouflage__MK461561901.html?ofmp=52559053',
      'https://www.medion.com/de/shop/p/notebook-zubehoer-medion-life-e83265-usb-headset-stereo-kopfhoerer-fuer-ein-perfektes-klangerlebnis-integriertes-mikrofon-mit-glasklarer-tonaufnahme-pratkischer-lautstaerkeregler-am-kabel-leicht-und-bequem-plug--play-fuer-pcs-und-notebooks-50066287A1',
      'https://www.elektronik-star.de/Haushalt-Wohnen/Kuechengeraete/Kuechenhelfer-Kuechenaccessoires/Glaeser-Becher/DUOS-doppelwandiges-Glas-Thermoglas-80-ml-Trinkglas-Espressoglas-Teeglas-Shotglas-fuer-heisse-und-kalte-Getraenke-Borosilikatglas-hitze-und-kaeltebestaendig-handgemacht-spuelmaschinenfest-Schwebe-Effekt-4er-Set.html',
      'https://business.currys.co.uk/catalogue/computing/servers-networking/networking/modem-routers/startech-com-m-2-pci-e-nvme-to-u-2-sff-8639-adapter-not-compatible-with-sata-drives-or-sas-controllers-for-m-2-pcie-nvme-ssds-pcie-m-2-drive-to-u-2-host-adapter-m2-ssd-converter-u2m2e125-interface-adapter-m-2-card-u-2/P272563P?cidp=Froogle&affiliate=ppc',
      'http://britain.desertcart.com/products/484923669-bezgar-tc141-toy-grade-1-14-scale-remote-control-car-all-terrains-electric-toy-off-road-rc-truck-remote-control-monster-truck-for-kids-boys-3-4-5-6-7-8-with-rechargeable-battery-bezgar-remote-control-construction-excavator-rc-toys-with-2-rechargeable-batteries-for-kids-age-6-7-8-9-10-11-rc-construction-truck-vehicle-toys-with-light-for-boys-and-girls-tk181-bezgar-hs181-hobby-grade-1-18-scale-remote-control-trucks-4wd-top-speed-35-km-h-all-terrains-off-road-short-course-rc-truck-waterproof-rc-car-with-2-rechargeable-batteries-for-kids-and-adults-bezgar-hm161-hobby-grade-1-16-scale-remote-control-truck-4wd-high-speed-40-kmh-all-terrains-electric-toy-off-road-rc-vehicle-car-crawler-with-2-rechargeable-batteries-for-boys-kids-and-adults',
    ].forEach((url) => {
      it(`should allow long, but safe URLs: ${url}`, function () {
        shouldBeSafe(url);
      });
    });

    [
      'https://www.amazon.de/SUNNYBAG-Solar-Modul-umweltfreundlich-Solar-Energie-Ultra-leicht/dp/B08FRL5G5S',
    ].forEach((url) => {
      it(`should allow long, but safe URLs (strict mode exceptions): ${url}`, function () {
        shouldBeSafeInNonStrictMode(url);
      });
    });
  });

  describe('should truncate login specific URLs', function () {
    [
      'https://access.ing.de/delogin/w/login?t=https://access.ing.de/delogin/oauth/authorize?response_type%3Dcode%26client_id%3Dibbr%26scope%3Dbanking%2520postlogin%2520tpa%2520openid%26state%3DAXHw4viZF1ntx4i3gOcflIUKUK80Yix3Hr5LNsb0j0I%253D%26redirect_uri%3Dhttps://banking.ing.de/app/login/oauth2/code/ibbr%26nonce%3D9WjJS-aqnwAoAFd8fF4t5nNLuO-DsPA0ql-oKMGZ6zo%26claims%3D%257B%2522id_token%2522%253A%257B%2522customer_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522partner_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522last_login%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522authentication_means%2522%253A%257B%2522essential%2522%253Atrue%257D%257D%257D',
      'https://web.verimi.de/dipp/api/authenticate?login_challenge=498830e1f9734aebab6f382f673a20e5',
      'https://accounts.google.com/signin/v2/usernamerecovery?continue=https%3A%2F%2Fgroups.google.com%2Fmy-groups&dsh=S285380746%3A1697710203082833&flowEntry=ServiceLogin&flowName=GlifWebSignIn&followup=https%3A%2F%2Fgroups.google.com%2Fmy-groups&ifkv=AVQVeyyeWVx_JoNaqej1zdzdZjDsJ1zQCgD0KdudwHwmez4dVJkWw_4bZVCCj46vLQVUVJGrBIxj&osid=1&theme=glif',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F&ec=65620&hl=en&ifkv=AVQVeyyBkkwVyKEUa4Ul-Mll2WwmLVdi14ivGA8Cyxy2zYPVY1nAWoGydpfvNuPwgbFGJB9QrlpO&passive=true&service=youtube&uilel=3&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S1006818886%3A1697723402009676&theme=glif',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fgroups.google.com%2Fmy-groups&followup=https%3A%2F%2Fgroups.google.com%2Fmy-groups&ifkv=AVQVeyyBm7cgqI8WYA9rOCycOcMyWoz7q8f1d0PTs9qu6Xj7evUrAr2u1DvlW9XklbfNlH4B324E&osid=1&passive=1209600&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S285380746%3A1697710203082833&theme=glif',
      'https://access.ing.de/delogin/w/login?x=sym2BPHMFmqV2hYUXnMw-YbrjfmV2Rsq2JfGZpNH1SnjUKBT1RYcA4A&t=https://access.ing.de/delogin/oauth/authorize%3Fresponse_type%3Dcode%26client_id%3Dibbr%26scope%3Dbanking%2520postlogin%2520tpa%2520openid%26state%3DAXHw4viZF1ntx4i3gOcflIUKUK80Yix3Hr5LNsb0j0I%253D%26redirect_uri%3Dhttps://banking.ing.de/app/login/oauth2/code/ibbr%26nonce%3D9WjJS-aqnwAoAFd8fF4t5nNLuO-DsPA0ql-oKMGZ6zo%26claims%3D%257B%2522id_token%2522%253A%257B%2522customer_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522partner_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522last_login%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522authentication_means%2522%253A%257B%2522essential%2522%253Atrue%257D%257D%257D',
      'https://www.facebook.com/recover/initiate/?privacy_mutation_token=eyJ0eXBlIjowLCJjcmVhdGlvbl90aW1lIjoxNjk3NzEyMTMyLCJjYWxsc2l0ZV9pZCI6MzgxMjI5MDc5NTc1OTQ2fQ==&ars=facebook_login',
      'https://www.facebook.com/login/identify/?ctx=recover&ars=facebook_login&from_login_screen=0#',
      'https://signon.ghostery.com/en/password/forgot?redirect=https%3A%2F%2Faccount.ghostery.com%2Fen%2F',
      'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fconsole.aws.amazon.com%2Fconsole%2Fhome%3FhashArgs%3D%2523%26isauthcode%3Dtrue%26nc2%3Dh_ct%26src%3Dheader-signin%26state%3DhashArgsFromTB_eu-north-1_7bbe8829a3606007&client_id=arn%3Aaws%3Asignin%3A%3A%3Aconsole%2Fcanvas&forceMobileApp=0&code_challenge=LfgbfGbtRHU3oaW7r8IvAWwD2OYiD-yJqcfaXtAijew&code_challenge_method=SHA-256',
      'https://panel.bunny.net/user/login/verifycode?ReturnUrl=',
      'https://panel.bunny.net/user/logout',
      'https://www.faz.net/mein-faz-net/?redirectUrl=%2Faktuell%2F',
      'https://account.booking.com/sign-in?op_token=LvIxMDI1yXO0RvfKdo4gV2Seyld5HAi1IH5pM7YyWZGVXHZ9dQcxnji0EFf9yUF1nUG0Op8lEHN9njKaMj8xy2iaEp3uh21xhQ8byH5ayUFshA8xnA9xMDI1yZ8pEDF9nj5qjTSIno9XkQdIHDG3niFrMiY7WUSFE9GsnlN0EIi5CHs9dUcQkKK2N19DVbd7GoFeVX1tkQNEVoc3IKLpVKSuD9S5D2ZBKQMlG2fpEH8YdlNtVZiiVKSET7dcTH8Tn13FdlcDHLdoKudSh1ZXEIElD7ZfkUo1Go3yFAEITbwgV9IWEjctTj8CWIwfMi8KOIZPFiiNhX9eI7YSNiTghuiiKLi5IQdsFoISdWSVnQsiGj8SViRtd7conANNNLe7NQ8jdjFUF2cqOHgEVKEFHogtWDwSVLNaHDZoyKIWTogoMIYKdHZwhQsmdQwKFWM2diEEVuZiNLL8BjI3VbYyT1o2VH3VkIiMHjgmF7ceM2t3h9wDFjsyHLiwEiL8JKPLM28oEVfwXP6PLuX-r_Ob6dPjCvYXRZmdu6aqYwPYLUFpMDEihQgini8fEHZoEDP',
      'https://chat.openai.com/auth/login',
      'https://auth0.openai.com/u/login/identifier?state=oWEi8YOHNHjyQ8Cyr3OsZ3jUH3QHXHQsIsjaPI1WLIxLCUcEjbEpt5QpbHCyeqDorS3ur8jxrgD9bUXCTGQbLQy7zqjwb83nUEOwKfcTUEysrf3BefxfDJoLP8cXi8DxCDmdQVKWYUDlCXB8Q81IYJKLLXQpzHy5bGQEDJyMrsCAjBe',
      'https://auth0.openai.com/u/mfa-otp-challenge?state=pRHj6MZWGSpWY5GGMSqbdaqaq414GYZHW6GVdrqQUvqDdSpuwRHfhF1cPM1pqYVjWJ94dJNpqFJaqFrv6MO1JarWmBs5Y6nnwHpLY4WhMHpWw69nVBXiWaV7AcNhU3NadJAWCHVvMvraPcUbNrqtGSp4Aav1ekr9q6g1VAV9A686MYVB',
      'https://www.otto.de/user/login?uri=/myaccount/dashboard?entryPoint%3DloginArea&tk=-109064015',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2F85ZW1T2ORppdfp23J8Ff8uzBM_s1AxUk4j2EjEjpUCKY%2Fedit%3Fskip_itp2_check%3Dtrue&followup=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2F85ZW1T2ORppdfp23J8Ff8uzBM_s1AxUk4j2EjEjpUCKY%2Fedit%3Fskip_itp2_check%3Dtrue&ifkv=AVQVeyz9TNpWfqpigNtYCi6bils8e4UV1vVMccyjcYtaeCwWd13k7rhQK8E-1NoMyjq7AQpx1cBdow&ltmpl=sheets&osid=1&passive=1209600&service=wise&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S-7251167306%3A3477788878142089&theme=glif#gid=0',
      'https://bezpiecznedane.gov.pl/auth/realms/DGWEYGSWOGTAOG/login-actions/first-broker-login?client_id=knxzfnmxtndvtn-pn&tab_id=dHvCjad6CwW',
      'https://account.proton.me/authorize?app=proton-mail&state=ipbfP1pSOwS2N236jXMnEQ-zkpWoK06cUtvikQ7qyXq&u=0',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should truncate login specific URLs', function () {
    [
      'https://access.ing.de/delogin/w/login?t=https://access.ing.de/delogin/oauth/authorize?response_type%3Dcode%26client_id%3Dibbr%26scope%3Dbanking%2520postlogin%2520tpa%2520openid%26state%3DAXHw4viZF1ntx4i3gOcflIUKUK80Yix3Hr5LNsb0j0I%253D%26redirect_uri%3Dhttps://banking.ing.de/app/login/oauth2/code/ibbr%26nonce%3D9WjJS-aqnwAoAFd8fF4t5nNLuO-DsPA0ql-oKMGZ6zo%26claims%3D%257B%2522id_token%2522%253A%257B%2522customer_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522partner_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522last_login%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522authentication_means%2522%253A%257B%2522essential%2522%253Atrue%257D%257D%257D',
      'https://web.verimi.de/dipp/api/authenticate?login_challenge=498830e1f9734aebab6f382f673a20e5',
      'https://accounts.google.com/signin/v2/usernamerecovery?continue=https%3A%2F%2Fgroups.google.com%2Fmy-groups&dsh=S285380746%3A1697710203082833&flowEntry=ServiceLogin&flowName=GlifWebSignIn&followup=https%3A%2F%2Fgroups.google.com%2Fmy-groups&ifkv=AVQVeyyeWVx_JoNaqej1zdzdZjDsJ1zQCgD0KdudwHwmez4dVJkWw_4bZVCCj46vLQVUVJGrBIxj&osid=1&theme=glif',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Den%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F&ec=65620&hl=en&ifkv=AVQVeyyBkkwVyKEUa4Ul-Mll2WwmLVdi14ivGA8Cyxy2zYPVY1nAWoGydpfvNuPwgbFGJB9QrlpO&passive=true&service=youtube&uilel=3&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S1006818886%3A1697723402009676&theme=glif',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fgroups.google.com%2Fmy-groups&followup=https%3A%2F%2Fgroups.google.com%2Fmy-groups&ifkv=AVQVeyyBm7cgqI8WYA9rOCycOcMyWoz7q8f1d0PTs9qu6Xj7evUrAr2u1DvlW9XklbfNlH4B324E&osid=1&passive=1209600&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S285380746%3A1697710203082833&theme=glif',
      'https://access.ing.de/delogin/w/login?x=sym2BPHMFmqV2hYUXnMw-YbrjfmV2Rsq2JfGZpNH1SnjUKBT1RYcA4A&t=https://access.ing.de/delogin/oauth/authorize%3Fresponse_type%3Dcode%26client_id%3Dibbr%26scope%3Dbanking%2520postlogin%2520tpa%2520openid%26state%3DAXHw4viZF1ntx4i3gOcflIUKUK80Yix3Hr5LNsb0j0I%253D%26redirect_uri%3Dhttps://banking.ing.de/app/login/oauth2/code/ibbr%26nonce%3D9WjJS-aqnwAoAFd8fF4t5nNLuO-DsPA0ql-oKMGZ6zo%26claims%3D%257B%2522id_token%2522%253A%257B%2522customer_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522partner_number%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522last_login%2522%253A%257B%2522essential%2522%253Atrue%257D%252C%2522authentication_means%2522%253A%257B%2522essential%2522%253Atrue%257D%257D%257D',
      'https://www.facebook.com/recover/initiate/?privacy_mutation_token=eyJ0eXBlIjowLCJjcmVhdGlvbl90aW1lIjoxNjk3NzEyMTMyLCJjYWxsc2l0ZV9pZCI6MzgxMjI5MDc5NTc1OTQ2fQ==&ars=facebook_login',
      'https://www.facebook.com/login/identify/?ctx=recover&ars=facebook_login&from_login_screen=0#',
      'https://signon.ghostery.com/en/password/forgot?redirect=https%3A%2F%2Faccount.ghostery.com%2Fen%2F',
      'https://signin.aws.amazon.com/signin?redirect_uri=https%3A%2F%2Fconsole.aws.amazon.com%2Fconsole%2Fhome%3FhashArgs%3D%2523%26isauthcode%3Dtrue%26nc2%3Dh_ct%26src%3Dheader-signin%26state%3DhashArgsFromTB_eu-north-1_7bbe8829a3606007&client_id=arn%3Aaws%3Asignin%3A%3A%3Aconsole%2Fcanvas&forceMobileApp=0&code_challenge=LfgbfGbtRHU3oaW7r8IvAWwD2OYiD-yJqcfaXtAijew&code_challenge_method=SHA-256',
      'https://panel.bunny.net/user/login/verifycode?ReturnUrl=',
      'https://panel.bunny.net/user/logout',
      'https://www.faz.net/mein-faz-net/?redirectUrl=%2Faktuell%2F',
      'https://www.linkedin.com/authwall?trk=gf&trkInfo=ZBP-qZA0VYwULcZZZXcGa-IBpJOvTmi8dPOR8ko77BJLmkKxvMbI4TEk4rr0gbxqkLN1kKQaWGMb10uEdpF_o5_WyIHxZVft5xLgXHsd68beuKzKDoALJ-Vh8OfiHZ8rrNnEiB7=&original_referer=&sessionRedirect=https%3A%2F%2Fuk.linkedin.com%2Fin%2Fzhaohan-daniel-guo-22475b15',
      'https://www.dolce-gusto.be/m/customer/account/login/referer/oVW4hVY5Lr70i0heHD7bK8NxH0OmiD9eKaNsfJ7xkSAsfcOm/?___store=ndg_be_nl_mobile&___from_store=ndg_be_fr_mobile',
      'https://www.dolce-gusto.ch/m/customer/account/login/referer/fKT4oKX9Iv18n8ouZC1mQ2WcZ8AdnC7uQ2krbJ1mnB6wbv4vXd1qUMYqHxNcoGcdfC18URHlnxlln01dnB0cQRH6R2Hmb2Dp/?___store=ndg_ch_fr_mobile&___from_store=ndg_ch_de_mobile',
      'https://billtobox.zendesk.com/auth/v2/login/signin?auth_origin=114094533013,false,true&brand_id=114094533013&return_to=https://billtobox.zendesk.com/&theme=hc',
      'https://authentication.cardexchangecloud.com/Account/ForgetPassword?returnUrl=/connect/authorize/callback?client_id=spa&redirect_uri=https://controller.cardexchangecloud.com/auth/controller/login&response_type=id_token token&scope=openid profile email roles customer api1 restricted_resources&nonce=N0.787868080387803273027583911101&state=90251394777337.1094681119101925',
      'https://authentication.cardexchangecloud.com/Account/ForgetPassword?returnUrl=/connect/authorize/callback?client_id=spa&redirect_uri=https://controller.cardexchangecloud.com/auth/controller/login&response_type=id_token%20token&scope=openid%20profile%20email%20roles%20customer%20api1%20restricted_resources&nonce=N0.787868080387803273027583911101&state=90251394777337.1094681119101925',
      'https://weibo.com/login.php?url=https%3A%2F%2Fus.weibo.com%2Findex',
      'https://weibo.com/newlogin?tabtype=weibo&gid=102803&openLoginLayer=0&url=https%3A%2F%2Fweibo.com%2F',
      'https://login.sina.com.cn/sso/prelogin.php?entry=weibo&callback=sinaSSOController.preloginCallBack&su=&rsakt=mod&client=ssologin.js(v1.4.19)&_=1702040031979',
      'https://audit.verified-data.com/email/verify/4769/6v2h6102n8f226979f0p981n327v3p061vf4ff2v?expires=1702297704&signature=67m0m205375800m7605j0m6j13wrr328r0q24j3wy127wjj52y417r82414189jy',
      'https://github.com/login?return_to=https%3A%2F%2Fgithub.com%2Fghostery',
      'https://us-east-1.signin.aws/platform/resetpassword?workflowStateHandle=51u55f00-u9u2-27d3-1575-dd80947u0541',
    ].forEach((url) => {
      it(`should truncate URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should truncate URLs containing account information', function () {
    [
      'https://foobar.awsapps.com/start/#/saml/custom/813451362916%20%28Foobarry%29/XA25oDRyH4Y6MWP4L2karl4lX1LmJwF5NTXzXKm7N3yJZ9ByAnL1N4IaGmDrN1J0GDn51R',
      'https://www.otto.de/order/checkout/order/confirmation/1bqz64511y17d1b72zs8yys9120sbs6d71syz643q188syq3dsdq8393483d3176',
    ].forEach((url) => {
      it(`should truncate URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should truncate URLs with redirect links', function () {
    [
      'https://consent.youtube.com/m?continue=https%3A%2F%2Fm.youtube.com%2Fchannel%2FYZZlacy1v-3NY4gUUiQXLiZu%3Fcbrd%3D1&gl=DE&m=1&pc=yt&cm=2&hl=en&src=1',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  // TODO: how to deal with shorteners?
  // describe('should truncate URL shortener links in strict mode', function () {
  //   [
  //     't.ly/PKKKy',
  //     'is.gd/PazNcR',
  //     'bit.ly/1h0ceQI',
  //     'goo.gl/bdkh1L',
  //     't.co/RUiFUYKzkz',
  //     'buff.ly/2LrnrP8',
  //   ].forEach((url) => {
  //     it(`should truncate URL: ${url}`, function () {
  //       shouldBeTruncatedInStrictMode(`http://${url}`);
  //       shouldBeTruncatedInStrictMode(`https://${url}`);
  //     });
  //   });
  // });

  describe('should truncate URLs with long IDs', function () {
    [
      'https://www.bing.com/ck/a?!&&p=badf679299367c84JmltdHM9MTY5NzY3MzYwMCZpZ3VpZD0xNDY2M2EzMS1kMjdlLTY1YTQtMzhlYy0yOTY4ZDM5NTY0ZTkmaW5zaWQ9NTIxMg&ptn=3&hsh=3&fclid=14663a31-d27e-65a4-38ec-2968d39564e9&u=a1aHR0cHM6Ly9ibG9nLnRlbnNvcmZsb3cub3JnLzIwMjEvMDEvY3VzdG9tLW9iamVjdC1kZXRlY3Rpb24taW4tYnJvd3Nlci5odG1s&ntb=1',
      'https://travel.cytric.net/env-a/ibe/?id=512837228%7E0%7Er&prg=112853-2272319397102-3&_dp_=ANHVXLQx_JaKkRxyLHTNkSO3NLHXu92NjHNiHX4bN2H',
      'https://www.youtube.com/redirect?event=video_description&redir_token=QUXFLUhra7ZsRUQ3NKxZX2tUNmxzTjdjS2zZUGk7SZMYd3xBZ4Jnl3tud3JxSTRCXFI2R1o4M2yXRXd0fVQ8ZFY0dxJxRCFFZHprVWtjem53RPR0OUlYQxZEXzNiNmhELTcwbXVibEdMgmNbcml5YblXZAsiYgFoKG15NutRcC74LAtNczW2X22JZFABc2GZWFRvWjgsbXkxR2&q=https%3A%2F%2Farxiv.org%2Fabs%2F2310.08560&v=AITOuXUi9pg',
      'https://pvn.mediamarkt.de/trck/eclick/40907yqy0glbl95qll57qbb59by842yl?subid=7248708625399259997&mfadid=adm',
      'https://timeline.google.com/maps/timeline?authuser=0&hl=de&pli=1&rapt=SOfYD4WykrYUYAj2H0pCAn7cYzQ24k4GQIbQ5UVKER0YlVY54F420EMqcT7yl084f_b0O0-NdKY3lnWR0csEGZOAqkVzc7UXR0KKwZsooOFB4vu5xW7p8QU&pb',
      'https://img.search.brave.com/U4gou0jGxeFs9qethbxRGqeOMRcOH4enMRstvUnSSqq/rs:fit:640:904:1/g:ce/jZY2xZI4Vm0dVvFd/julwGz9ej75mAaZ7/qI1lAz1gAB39UB1l/A7F8UJllUOM8ZJRl/PeCeAOCyZJs8PJVu/UOstGeCsPB5wjTD5/YWxoZWFkLWFsaXNz/VF18dRu5XF1obTA0/LmpwZw',
      'https://consent.yahoo.com/v2/collectConsent?sessionId=3_cc-session_14392mo1-s856-4sk6-2986-28o5k4o1p429',
      'https://www.bloomberg.com/tosv2.html?vid=34g704g1-99yy-66jj-q27m-3m1qqsq454qq&uuid=784qc164-33qq-77ff-5n7q-fn47462b6933&url=L25ld3MvdGVybWluYWwvUloyNE1FTUIyU0pR',
      'https://www.dolce-gusto.es/m/customer/account/login/referer/iDL9uDF7Ve52k2ujJI5xC1UzJ2KtkI8jJWFasT5wC1Egu15eiG5tV1bwuvkgVWkwkIKekIMjie3qiGEls1ba',
      'https://bezpiecznedane.gov.pl/sprawdz-email?state=fKtjCqpHfo00Eut6UvELEqigtwA3lPGMG9uzOZ7pCSEoFYNpaz9ixqtJER9g&session_state=bd3865bg-g5i1-85g6-254z-9b2jd4z02z12&code=4398735i-7741-40t9-i1l9-30761t6t0bt0.xt64i8xj-jyl3-42j7-9l1i-5x9bi1i09i39.773i9865-7x4l-4x5i-7625-9207j4l31884',
      'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/762071641/CourseNode/58610245676829/wiki/Index;jsessionid=N048JED1779324348E7E8C39EE9C7445.opalN5?0',
      'https://docs.google.com/spreadsheets/d/3TJlhj3Zi09g-gwshAljvTdZUz2iXauEo5q9vprZM-GA/edit#gid=0',
      'https://docs.google.com/spreadsheets/d/3TJlhj3Zi09g-gwshAljvTdZUz2iXauEo5q9vprZM-GA/edit',
      'https://www.aliexpress.com/gcp/300001278/Mainvenue?disableNav=YES&pha_manifest=ssr&_immersiveMode=true&aff_fcid=34774b22fc3b4bdb9b1027ab41d31022-1703165608590-05507-_DlRCXbX&tt=CPS_NORMAL&aff_fsk=_DlRCXbX&aff_platform=portals-promotion&sk=_DlRCXbX&aff_trace_key=34774b22fc3b4bdb9b1027ab41d31022-1703165608590-05507-_DlRCXbX&terminal_id=33248a347d6f4043bd1041b4151973e6',
      'http://agenciahabitatge.gencat.cat/wps/portal/!ut/p/z1/sXWWm8JoYJm_Quo3UlVWGcJlineL1FlGLbZB5QZcLWGClhQW_fy91tqOcQAB1JbcSO0bvFYOHFltt9eiWUeM46oSZl3BY20xUlL2QJ8YLe1x2-29LdOIlEjSI8HveoaOLD2f2IAVEHqupBGTvovFHduHz0VKEzLHMCoIbz7z1lqigHsaf-89USmo3COcow2LrGXxkUvP1QtlHwQLrnohqViRyOW8KD2XIcwuPsWWuwZnwIUo5op3kzG_IPP-BVucpSSYyrIix4F9EXV5XShRk6JkUvoIZ0fr45iKTivqcpuYh_q9H5FLyZM5ZKgEXbBquz9aupp97dksk78uJrUF2A9OIhM5trZ9u27V2SiElsAudfEnGvQI6tDoVBxMDDQj5_rzLUpgVG3BVmSoXwEtHk_XhbRrWB-h_CcNprkqkdkKYybGy4RuM0_VFgsALY7dF290trAri9JadCEe80c6z95_Lpw-Qyk!/qh/q5/K1qLJHExX7VLJH6gZHEu/?urile=wcm:path:/ahcca/web/serveis/programes socials/xarxa mediacio lloguer social',
      'http://agenciahabitatge.gencat.cat/wps/portal/!ut/p/z1/sXWWm8JoYJm_Quo3UlVWGcJlineL1FlGLbZB5QZcLWGClhQW_fy91tqOcQAB1JbcSO0bvFYOHFltt9eiWUeM46oSZl3BY20xUlL2QJ8YLe1x2-29LdOIlEjSI8HveoaOLD2f2IAVEHqupBGTvovFHduHz0VKEzLHMCoIbz7z1lqigHsaf-89USmo3COcow2LrGXxkUvP1QtlHwQLrnohqViRyOW8KD2XIcwuPsWWuwZnwIUo5op3kzG_IPP-BVucpSSYyrIix4F9EXV5XShRk6JkUvoIZ0fr45iKTivqcpuYh_q9H5FLyZM5ZKgEXbBquz9aupp97dksk78uJrUF2A9OIhM5trZ9u27V2SiElsAudfEnGvQI6tDoVBxMDDQj5_rzLUpgVG3BVmSoXwEtHk_XhbRrWB-h_CcNprkqkdkKYybGy4RuM0_VFgsALY7dF290trAri9JadCEe80c6z95_Lpw-Qyk!/qh/q5/K1qLJHExX7VLJH6gZHEu/?urile=wcm:path:/ahcca/web/serveis/programes+socials/xarxa+mediacio+lloguer+social',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });

    [
      'https://r.mail.ghostery.com/tr/op/gmGv_I5hqw15bLLyxG0g_FhuZlFYDvGtTVorqzYSqVLR3RLxY4m0GJdAImute2xfJAes2ji4QY4WKRYcsxAKf2dhr5Cdy4RLIyjFhBnoqV5iRyfKuCFYA_czVe-otbPjOWKmpLbZLbAlsVY84mTElAaDexyEuR5ckuyewGMFQpYdvpzl7xQfF-73YkWJHIPGz3B8a_uLLs_mqcIc6NfdkwHRecKOwWoarMIZ',
      'https://beethoven-viur.appspot.com/file/download/AMIfv94I1TCuh-LQwE0klfULZBhalx4up4WpLqX_Etc-TcWqZUjb6NfQw1_t6g_YkGzFMNV34YJh7C0xg5JJIPeWloEE91HDLpPAKQxiVbh6DpGyjYnXcnt9BpMPrMCCuAOeNbZnTL5XEGFbQPP3c5HmotrmnePPcyMD1ieFE0ABr2Tbfxb5LSIgcEh6U8N8l-V-7-UZqEsfqngbNdfpPm2tbndF5mdZaokbBjHirguv0Tj--Yzms_WfrVmvllxKgyG97QFptkf3OWTZzwFkmw80xn52EvRMRzfpc7YjewUX8ctZ4bLW5Cc/Beethoven_Diskographie_10.pdf',
    ].forEach((url) => {
      it(`should drop URL (in strict mode): ${url}`, function () {
        shouldBeTruncatedInStrictMode(url);
      });
    });
  });

  describe('should truncate URLs with base64 content', function () {
    [
      'https://www.e-recht24.de/websitescanner?hash=LIcnBHJ80eL1vZzFQJYUCgkwR3uB0yFtKwIrTb8uQC4Ibu7Yn1CeebupSJhPbIYV&u=aHR0cHM6Ly93d3cuZ2hvc3RlcnkuY29tLw==',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should support news sites', function () {
    describe('that use UUIDs in their article URLs', function () {
      [
        'https://www.ft.com/content/b08c3159-982e-4831-8897-e35f8aca49e1',
        'https://www.ft.com/content/820e66cc-fc8a-4ca9-811d-66cf2c6f0439',
        'https://www.ft.com/content/95d47316-b357-4fc3-b25d-34645eef8abc',
        'https://www.ft.com/content/2699f3c0-78b4-4f73-880e-629375282f73',
        'https://www.propublica.org/article/warren-buffett-privately-traded-stocks-berkshire-hathaway-ethics-irs',
        'https://www.spiegel.de/international/world/forgotten-in-kyiv-support-slides-for-ukraine-following-attack-on-israel-a-68f0b813-d558-4506-9354-5b632d9cf97a',
        'https://www.spiegel.de/ausland/mrbeasts-100-brunnen-ein-beruehmter-youtuber-will-afrika-retten-a-9bf428b2-6ca2-419e-9623-d5983eb710fd',
        'https://www.rnd.de/medien/mrbeast-youtuber-stellt-einkommensrekord-auf-XQDPXC2VVVAN7JYQ7SCWJJQZBY.html',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafeInNonStrictMode(url);
        });
      });
    });

    describe('that use hashes in their article URLs', function () {
      [
        'https://www.huffpost.com/entry/peter-thiel-trump-2024_n_654ddddee4b0373d70b196d1',
        'https://www.lbc.co.uk/world-news/1fe04e54197741a9accba85a1abaf21c/',
        'https://www.ouest-france.fr/monde/israel/ce-que-lon-sait-des-journalistes-accuses-davoir-couvert-lattaque-du-hamas-le-7-octobre-en-israel-e30b9f18-7fd5-11ee-a407-397218b61e71',
        'https://www.elmundo.es/espana/2024/06/05/665f542fe9cf4a3c598b4584.html',
        'https://www.sueddeutsche.de/wissen/palaeoanthropologie-menschenaffen-hammerschmiede-lux.Pwq48LbZ4WW92NgCaZWiJT',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafe(url);
        });
      });
    });

    describe('that use numbers in their article URLs', function () {
      [
        'https://www.wsj.com/personal-finance/mortgage-home-buying-rent-down-payment-41308669',
        'https://taz.de/CDU-beendet-Schwarz-Gruen-in-Hessen/!5969307/',
        'https://taz.de/Taylor-Swift-in-Argentinien/!5969351/',
        'https://www.focus.de/sport/fussball/2-bundesliga-schwere-ausschreitungen-in-hamburg-hannover-fans-pruegeln-sich-mit-der-polizei_id_243186606.html',
        'https://www.wiwo.de/my/politik/ausland/usa-vs-china-das-duell-der-giganten/29490956.html',
        'https://www.handelsblatt.com/politik/konjunktur/sinkende-verbraucherpreise-china-rutscht-wieder-in-die-deflation/29491072.html',
        'https://www.unilad.com/film-and-tv/news/martin-scorsese-daughter-tiktok-never-film-372949-20231110',
        'https://www.bristolpost.co.uk/news/bristol-news/support-bristols-island-neighbourhood-after-8898769',
        'https://de.finance.yahoo.com/nachrichten/tailg-pr%C3%A4sentiert-neue-tlg-marke-202500300.html',
        'https://de.nachrichten.yahoo.com/prosieben-magazin-zervakis-opdenh%C3%B6vel-live-204617336.html',
        'https://www.tagesspiegel.de/politik/bundeswehrtagung-und-wehretat-bald-knallt-es-zwischen-pistorius-und-scholz-10762537.html',
        'https://www.t-online.de/nachrichten/deutschland/innenpolitik/id_100278508/muss-die-bundeswehr-kriegstuechtig-sein-stimmen-aus-dem-bundestag.html',
        'https://www.nzz.ch/feuilleton/israel-zeigt-bilder-des-grauens-auch-hamas-kennt-ihre-wirkmacht-ld.1764329',
        'https://www.bild.de/bild-plus/regional/berlin/berlin-aktuell/pflegedienst-berlin-falsche-medikamente-misshandlung-zwei-tote-senioren-ermittlu-86042368.bild.html',
        'https://www.dailymail.co.uk/news/article-12735811/Why-Charles-great-pain-Harry-King-host-small-party-close-friends-not-family-celebrate-75th-birthday-marks-occasion-striking-portrait.html',
        'https://www.motorsport-total.com/auto/news/royal-enfield-himalayan-452-2024-feiert-premiere-auf-der-eicma-23111005',
        'https://sportowefakty.wp.pl/koszykowka/fototemat/1090963/kosmiczne-pieniadze-zobacz-ile-zarabiaja-gwiazdy-nba-sochan-daleko',
        'https://www.sueddeutsche.de/wissen/technik-radargeraete-koennen-router-funkband-lahmlegen-dpa.urn-newsml-dpa-com-20090101-170322-99-767363',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafe(url);
        });
      });
    });

    describe('that use dates for their article URLs', function () {
      [
        'https://www.nytimes.com/2023/11/10/nyregion/adams-fbi-investigation-phones.html',
        'https://www.npr.org/sections/health-shots/2023/11/09/1211610533/science-says-teens-need-more-sleep-so-why-is-it-so-hard-to-start-school-later',
        'https://www.npr.org/2023/11/09/953342565/nasa-apollo-gemini-astronaut-frank-borman-dies',
        'https://www.washingtonpost.com/food/2023/11/09/american-tipping-confusion-culture-study/',
        'https://www.forbes.com/sites/willskipworth/2023/11/10/billionaire-investor-predicts-spacexs-starlink-will-go-public-around-2027/',
        'https://www.bbc.com/worklife/article/20231108-three-big-reasons-americans-havent-rapidly-adopted-evs',
        'https://edition.cnn.com/2023/11/10/asia/pakistan-india-pollution-new-delhi-lahore-intl-hnk/index.html',
        'https://www.theguardian.com/us-news/2023/nov/10/trump-classified-documents-trial-date-aileen-cannon',
        'https://www.bfmtv.com/pratique/shopping/black-friday-les-dates-officielles-de-l-edition-2023_AB-202310280026.html',
        'https://www.lefigaro.fr/politique/emmanuel-macron-ne-se-rendra-pas-a-la-marche-contre-l-antisemitisme-dimanche-a-paris-20231110',
        'https://www.lemonde.fr/politique/article/2023/11/10/emmanuel-macron-ne-se-rendra-pas-a-la-marche-contre-l-antisemitisme-mais-salue-des-rassemblements-qui-sont-un-motif-d-esperance_6199414_823448.html',
        'https://www.washingtonpost.com/world/asia_pacific/climate-change-crowding-imperil-iconic-route-to-top-of-mount-everest/2018/05/16/4d975094-547a-11e8-a6d4-ca1d035642ce_story.html',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafe(url);
        });
      });
    });

    describe('that use long text in their article URLs', function () {
      [
        'https://www.foxnews.com/entertainment/dwayne-rock-johnson-says-political-parties-approached-run-president-one-other',
        'https://www.gbnews.com/royal/princess-eugenie-princess-beatrice-prince-william-working-royals-latest',
        'https://www.propublica.org/article/warren-buffett-privately-traded-stocks-berkshire-hathaway-ethics-irs',
        'https://www.lbc.co.uk/news/cenotah-armistice-ring-of-steel-sunak-bans-smaller-protests/',
        'https://pressgazette.co.uk/media-audience-and-business-data/media_metrics/most-popular-websites-news-us-monthly-3/',
        'https://www.radiotimes.com/tv/sci-fi/doctor-who-60th-anniversary-special-flux-connection-newsupdate/',
        'https://screenrant.com/star-wars-bo-katan-the-mandalorian-season-4-return-tease/',
        'https://www.swr.de/swraktuell/baden-wuerttemberg/suedbaden/trauer-in-offenburg-um-erschossenen-schueler-100.html',
        'https://www.lto.de/recht/justiz/j/geisterstunde-arbeitsgericht-koeln-videoverhandlung-ton-bild-urteil-erfunden-mysterioes/',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafe(url);
        });
      });
    });
  });

  // TODO: reconsider these tests (yes, the pages should not be shared,
  // but there are other factors that come into play:
  // - Google Translate defines a safe canonical URL, which should be preferred
  // - DeepL encodes its information as an anchor tag (which we arguably should drop)
  describe('should truncate URLs that encode translations', function () {
    [
      'https://www.deepl.com/translator#en/de/This%20is%20a%20test',
      'https://www.deepl.com/translator#de/en/Das%20ist%20ein%20Test',
      "https://www.deepl.com/translator#fr/de/C'est%20un%20test",
      'https://translate.google.com/?sl=en&tl=de&text=Lorem%20ipsum%20dolor%20sit%20amet%2C%20consetetur%20sadipscing%20elitr%2C%20sed%20diam%20nonumy%20eirmod%20tempor%20invidunt%20ut%20labore%20et%20dolore%20magna%20aliquyam%20erat%2C%20sed%20diam%20voluptua.%20At%20vero%20eos%20et%20accusam%20et%20justo%20duo%20dolores%20et%20ea%20rebum.%20Stet%20clita%20kasd%20gubergren%2C%20no%20sea%20takimata%20sanctus%20est%20Lorem%20ipsum%20dolor%20sit%20amet.%20Lorem%20ipsum%20dolor%20sit%20amet%2C%20consetetur%20sadipscing%20elitr%2C%20sed%20diam%20nonumy%20eirmod%20tempor%20invidunt%20ut%20labore%20et%20dolore%20magna%20aliquyam%20erat%2C%20sed%20diam%20voluptua.%20At%20vero%20eos%20et%20accusam%20et%20justo%20duo%20dolores%20et%20ea%20rebum.%20Stet%20clita%20kasd%20gubergren%2C%20no%20sea%20takimata%20sanctus%20est%20Lorem%20ipsum%20dolor%20sit%20amet.&op=translate',
      'https://fanyi.baidu.com/#en/zh/This%20is%20a%20test',
    ].forEach((url) => {
      it(`should drop URL: ${url}`, function () {
        shouldBeTruncated(url);
      });
    });
  });

  describe('should truncate complex URLs but accept their simpler canononical URL counterparts', function () {
    [
      {
        originalUrl:
          'https://www.temu.com/uk/usb-global-travel-converter-multifunctional-plug-socket-u-s-british-standard-conversion-power-adapter-charger-g-601099519482147.html?_bg_fs=1&_p_rfs=1&_x_ads_channel=google&_x_ads_sub_channel=shopping&_x_login_type=Google&_x_vst_scene=adg&mkt_rec=1&goods_id=601099519482147&sku_id=17592228839019&_x_ns_sku_id=17592228839019&_x_gmc_account=435423729&locale_override=210~en~GBP&_x_ads_risk=1',
        canonicalUrl:
          'https://www.temu.com/uk/usb-global-travel-converter-multifunctional-plug-socket-u-s-british-standard-conversion-power-adapter-charger-g-601099519482147.html',
      },
      {
        originalUrl:
          'https://www.temu.com/uk/international-travel-universal-adapter-electrical-plug-for-uk-us-eu-au-to-eu-european-socket-converter-white-black-g-601099518817648.html?_bg_fs=1&_p_rfs=1&_x_ads_channel=google&_x_ads_sub_channel=shopping&_x_login_type=Google&_x_vst_scene=adg&mkt_rec=1&goods_id=601099518817648&sku_id=17592225932210&_x_ns_sku_id=17592225932210&_x_gmc_account=978927325&locale_override=210~en~GBP&_x_ads_risk=1',
        canonicalUrl:
          'https://www.temu.com/uk/international-travel-universal-adapter-electrical-plug-for-uk-us-eu-au-to-eu-european-socket-converter-white-black-g-601099518817648.html',
      },
      {
        originalUrl:
          'https://www.argos.co.uk/product/8586117?storeID=4483&istCompanyId=a74d8886-5df9-4baa-b776-166b3bf9111c&istFeedId=30f62ea9-9626-4cac-97c8-9ff3921f8558&istItemId=ixilqptpw&istBid=t',
        canonicalUrl: 'https://www.argos.co.uk/product/8586117',
      },
      {
        originalUrl:
          'https://www.ebay.com.au/itm/133106580436?_trkparms=ispr%3D1&hash=item1efdc53bd4:g:ugAAAOSwgc5fGpCc&amdata=enc%3AAQAGAAACkPYe5NmHp%252B2JMhMi7yxGiTJkPrKr5t53CooMSQt2orsSHYXPhGXR5uguexJBeHwfgWEntFLFCxG9TnUVZwSLeR7C%252BXHym%252BGM0VtJnLB1L1eR4sX5KzW12iami5Zp40SkFEAuZbk8BKox9l34zLETKOY5zHrJmwt%252Bv9Oa3afvMrzG7kPBDRmPkCAmhJpB0bb%252F7gWc8mNyQWlz6R2Fha5nnLjR03AvMwyvh65v%252F86iijR3hKE8VU45h2kamfYKHaWQE6mpviuYvcgJHhvf%252FWUMCHQDgyXmy0p5U4TISywwdYkI3NnU89HQswzEz8gMcnR6iYskEQEokJChwYiEQnymzZc%252F4fx7vnheSDB%252BOSkmCIsd901xz%252BY2r8cG3eDqI90nHtl5vyCarwdiCJjFgsCoaLWYwvdgACkivSfO6gDV1PhbYqoh1Ke%252BnONygKkK9V%252BkasLxk3CSVAQSzJuYtypdQNAZ8wwyRG9qbfZkByOzyuvhqG1yrUEdj94c1YamtdctisISVOv%252FFC19XkhKfpvcMM5A%252F1OPGTnmyEGDjWo9DMi%252FoX7l7hyWHg0tCbmvNYdp%252ByS9Iw903LHf9dfCWYC7PsOLcSnrC2Sw6IZ1EM1ZW96So9HauMwJS55me0HVXyIOVvxbRrDqiSfbwBZk7SLP25F%252BCRmFSMTPybpZlC2%252FfsKb8I5ZFtd3MAvRJhDIRSGQx48v2Pep7Aey4f4N9Po1kgW61WyMs%252FJWkEkBdgVc%252Bd08T3Ceh2d6lkEbBNw2jiafYD9uN6ii%252BfC6nxj7qa1jMLJ9aBMnM6tWEsjczdeCmWsPhRh9ant9GUcDcfaXX2ygBvSgiT1SgDnHjCzm9tzhrrxrvO8o1RzvZE6xSr8n5OCg%7Campid%3APL_CLK%7Cclp%3A2334524',
        canonicalUrl: 'https://www.ebay.com.au/itm/133106580436',
      },
      {
        originalUrl:
          'https://www.amazon.de/-/en/Lubluelu-Saugroboter-Wischfunktion-Lasernavigation-Roboterstaubsauger/dp/B0BQBQJ784/?_encoding=UTF8&ref_=dlx_gate_dd_dcl_tlt_20e77cb4_dt_pd_gw_unk&pd_rd_w=u0Mp3&content-id=amzn1.sym.c3d3e926-d22d-4baf-8520-b539a55dc072&pf_rd_p=c3d3e926-d22d-4baf-8520-b539a55dc072&pf_rd_r=XQVAFVHSAQ7Y8C84KBJ7&pd_rd_wg=mzrvx&pd_rd_r=63a47cb2-0408-49d9-8a2d-c04c23ae0c8b&th=1',
        canonicalUrl:
          'https://www.amazon.de/-/en/Lubluelu-Cleaner-Function-Navigation-Control/dp/B0BQBQJ784',
      },
    ].forEach(({ originalUrl, canonicalUrl }) => {
      it(`- originalUrl: ${originalUrl} with canonicalUrl: ${canonicalUrl}`, function () {
        shouldBeTruncated(originalUrl);
        shouldBeSafeInNonStrictMode(canonicalUrl);
      });
    });
  });

  describe('should support tracking-free landing pages of ads', function () {
    [
      'https://www.krankenversicherung-vergleiche.info/versicherungen/private-krankenversicherung/vergleich/k/',
      'https://www.hansemerkur.de/angebote/private-krankenversicherung-selbststaendige',
      'https://www.ottonova.de/ml/pkv-sparen-finanzen-top-leistungen',
      'https://www.check24.de/private-krankenversicherung/',
    ].forEach((url) => {
      it(`should allow URL: ${url}`, function () {
        shouldBeSafe(url);
      });
    });
  });

  describe('when using the "tryPreservePath" option on a path that is safe', function () {
    [
      {
        url: 'https://www.bauhaus.info/bodenfliesen/c/10000500?q=%3AAnwendungsbereich00000035%3AInnen',
        whenEnabled:
          'https://www.bauhaus.info/bodenfliesen/c/10000500 (PROTECTED)',
        whenDisabled: 'https://www.bauhaus.info/ (PROTECTED)',
      },
      {
        url: 'https://www.bauhaus.info/bodenfliesen/c/10000500?q=%3AAnwendungsbereich00000035%3AInnen#some-hash-that-should-be-removed',
        whenEnabled:
          'https://www.bauhaus.info/bodenfliesen/c/10000500 (PROTECTED)',
        whenDisabled: 'https://www.bauhaus.info/ (PROTECTED)',
      },
    ].forEach(({ url, whenEnabled, whenDisabled }) => {
      describe(`for ${url}`, function () {
        [true, false, undefined].forEach((strictFlag) => {
          describe(`and strict=<${strictFlag}>`, function () {
            it(`truncates to path ("${whenEnabled}") when "tryPreservePath" is enabled explicitly`, function () {
              const option = { tryPreservePath: true };
              if (strictFlag !== undefined) {
                option.strict = strictFlag;
              }
              expect(sanitizeUrl(url, option).safeUrl).to.eql(whenEnabled);
            });

            it(`truncates to domain ("${whenDisabled}") when "tryPreservePath" is disabled explicitly`, function () {
              const option = { tryPreservePath: false };
              if (strictFlag !== undefined) {
                option.strict = strictFlag;
              }
              expect(sanitizeUrl(url, option).safeUrl).to.eql(whenDisabled);
            });

            it(`truncates to domain ("${whenDisabled}") when "tryPreservePath" is disabled implicitly (by default)`, function () {
              const option = {};
              if (strictFlag !== undefined) {
                option.strict = strictFlag;
              }
              expect(sanitizeUrl(url, option).safeUrl).to.eql(whenDisabled);
            });
          });
        });
      });
    });
  });

  describe('when using the "tryPreservePath" option on a path that is NOT safe', function () {
    [
      {
        url: 'https://example.test/this.should.trigger.a.violation@email.test/1234567890-1234567890-1234567890',
        truncated: 'https://example.test/ (PROTECTED)',
      },
    ].forEach(({ url, truncated }) => {
      describe(`for ${url}`, function () {
        [true, false, undefined].forEach((strictFlag) => {
          it(`and strict=<${strictFlag}>`, function () {
            const option = { tryPreservePath: true };
            if (strictFlag !== undefined) {
              option.strict = strictFlag;
            }
            const { result, safeUrl, reason } = sanitizeUrl(url, option);
            expect(result).to.eql('truncated');
            expect(safeUrl).to.eql(truncated);
            expect(reason).to.be.a('string').that.is.not.empty;
          });
        });
      });
    });
  });

  describe('for URLs that do not fit in other categories', function () {
    describe('but should be safe', function () {
      [
        'https://search.brave.com/search?q=ship+tensorflow+model+in+webextension',
        'https://www.bing.com/search?q=youtube+anti-adblock+linux+os',
        'https://x.com/foobar/status/1713305785659211991',
        'https://help.adblockplus.org/hc/en-us/articles/4402789017747-A-site-asks-me-to-disable-ABP-What-to-do-',
        'https://help.adblockplus.org/hc/en-us/articles/1500002533742-Adblock-Plus-breaks-the-websites-I-visit',
        'https://mastodon.social/@campuscodi/111218275545652125?utm_source=substack&utm_medium=email',
        'https://mastodon.social/@campuscodi/111218275545652125',
        'https://netzpolitik.org/2021/privatsphaere-jugendschuetzerinnen-wollen-ausweiskontrolle-vor-pornoseiten/',
        'https://twitter.com/gorhill/status/1713305785659211991',
        'https://biblehub.com/sermons/auth/aitken/king_of_kings_and_lord_of_lords.htm',
        'https://biblehub.com/sermons/auth/benson/an_acquaintance_with_christ_the_foundation_of_experimental_and_practical_religion.htm',
        'https://akveo.github.io/nebular/docs/auth/getting-user-token',
        'https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/GettingStarted.html',
      ].forEach((url) => {
        it(`should allow URL: ${url}`, function () {
          shouldBeSafe(url);
        });
      });

      [
        'https://www.amazon.co.uk/Unidapt-Adapter-European-Adaptor-Visitor/dp/B08MWRNYXL',
        'https://www.amazon.co.uk/Universal-Adapter-Worldwide-International-European-Black/dp/B0BVZ8VHHH',
        'https://www.amazon.co.uk/Converter-Universal-Standard-Grounded-Portable/dp/B09PBH4JT1',
        'https://www.homedepot.com/p/Makita-Dust-Extracting-Nozzle-for-use-with-Makita-1-1-4-HP-Compact-Router-and-Plunge-Base-model-RT0701C-194733-8/205182383',
        'https://www.youtube.com/watch?app=desktop&v=hLT-W55y-LI',
        'https://www.youtube.com/watch?v=hLT-W55y-LI',
      ].forEach((url) => {
        it(`should allow URL (in non-strict mode): ${url}`, function () {
          shouldBeSafeInNonStrictMode(url);
        });
      });
    });

    describe('but should be rejected', function () {
      [
        // (currently empty)
      ].forEach((url) => {
        it(`should reject URL: ${url}`, function () {
          shouldBeDroppedOrTruncated(url);
        });
      });
    });
  });
});

describe('#isValidEAN13', function () {
  for (const validEAN of [
    '9780345418913',
    '4006381333931',
    '4012345678901',
    '4012028630066',
  ]) {
    it(`should accept ${validEAN}`, function () {
      expect(isValidEAN13(validEAN)).to.eql(true);
    });

    it(`should only accept full matches (testing with variations of ${validEAN})`, function () {
      expect(isValidISSN(` ${validEAN}`)).to.eql(false);
      expect(isValidISSN(` ${validEAN} `)).to.eql(false);
      expect(isValidISSN(`${validEAN}$`)).to.eql(false);
      expect(isValidISSN(`!${validEAN}`)).to.eql(false);
    });
  }

  for (const invalidEAN of [
    '9780345418914',
    '1234567890123',
    '08981912910',
    '07890950160',
  ]) {
    it(`should reject ${invalidEAN}`, function () {
      expect(isValidEAN13(invalidEAN)).to.eql(false);
    });
  }

  describe('should handle any given string without throwing an exception', function () {
    it('with ASCII input', function () {
      fc.assert(
        fc.property(fc.string(), (text) => {
          expect(isValidEAN13(text)).to.be.oneOf([true, false]);
        }),
      );
    });

    it('with unicode input', function () {
      fc.assert(
        fc.property(fc.fullUnicodeString(), (text) => {
          expect(isValidEAN13(text)).to.be.oneOf([true, false]);
        }),
      );
    });
  });
});

describe('#isValidISSN', function () {
  for (const validISSN of [
    '2049-3630',
    '1234-5679',
    '12345679',
    '0975-1025',
    '09751025',
    '0096-9621',
    '0378-5955',
    '1050-124X',
    '1050124X',
    '1050-124x',
    '1050124x',
    '0317-8471',
    '0001-253x',
  ]) {
    it(`should accept ${validISSN}`, function () {
      expect(isValidISSN(validISSN)).to.eql(true);
    });

    it(`should only accept full matches (testing with variations of ${validISSN})`, function () {
      expect(isValidISSN(` ${validISSN}`)).to.eql(false);
      expect(isValidISSN(` ${validISSN} `)).to.eql(false);
      expect(isValidISSN(`${validISSN}$`)).to.eql(false);
      expect(isValidISSN(`!${validISSN}`)).to.eql(false);
    });
  }

  for (const invalidISSN of [
    '1234-567X',
    '1234-567x',
    '1234567x',
    '1234567X',
    '1234-567A',
    '123-4567',
    '0378-595X',
    '1234-12340000',
    'some random text but no ISSN',
  ]) {
    it(`should reject ${invalidISSN}`, function () {
      expect(isValidISSN(invalidISSN)).to.eql(false);
    });
  }

  describe('should handle any given string without throwing an exception', function () {
    it('with ASCII input', function () {
      fc.assert(
        fc.property(fc.string(), (text) => {
          expect(isValidISSN(text)).to.be.oneOf([true, false]);
        }),
      );
    });

    it('with unicode input', function () {
      fc.assert(
        fc.property(fc.fullUnicodeString(), (text) => {
          expect(isValidISSN(text)).to.be.oneOf([true, false]);
        }),
      );
    });
  });
});
