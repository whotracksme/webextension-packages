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
  function shouldBeSafe(url) {
    const { result, safeUrl, reason } = sanitizeUrl(url);
    expect(result).to.eql('safe');
    expect(safeUrl).to.eql(url);
    expect(reason).to.be.undefined;
  }

  function shouldBeDropped(url) {
    const { result, safeUrl, reason } = sanitizeUrl(url);
    expect(result).to.eql('dropped');
    expect(safeUrl).to.eql(null);
    expect(reason).to.be.a('string').that.is.not.empty;
  }

  function shouldBeTruncated(url) {
    const { result, safeUrl, reason } = sanitizeUrl(url);
    expect(result).to.eql('truncated');
    expect(safeUrl).to.be.a('string').that.is.not.empty;
    expect(safeUrl.endsWith(' (PROTECTED)'), 'ends with "(PROTECTED)"').to.be
      .true;
    expect(reason).to.be.a('string').that.is.not.empty;
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
      'https://www.amazon.de/SUNNYBAG-Solar-Modul-umweltfreundlich-Solar-Energie-Ultra-leicht/dp/B08FRL5G5S?source=ps-sl-shoppingads-lpcontext&psc=1&smid=AFDDCQLX14EDY?source=ps-sl-shoppingads-lpcontext&psc=1',
      'https://www.elektronik-star.de/Haushalt-Wohnen/Kuechengeraete/Kuechenhelfer-Kuechenaccessoires/Glaeser-Becher/DUOS-doppelwandiges-Glas-Thermoglas-80-ml-Trinkglas-Espressoglas-Teeglas-Shotglas-fuer-heisse-und-kalte-Getraenke-Borosilikatglas-hitze-und-kaeltebestaendig-handgemacht-spuelmaschinenfest-Schwebe-Effekt-4er-Set.html',
      'https://business.currys.co.uk/catalogue/computing/servers-networking/networking/modem-routers/startech-com-m-2-pci-e-nvme-to-u-2-sff-8639-adapter-not-compatible-with-sata-drives-or-sas-controllers-for-m-2-pcie-nvme-ssds-pcie-m-2-drive-to-u-2-host-adapter-m2-ssd-converter-u2m2e125-interface-adapter-m-2-card-u-2/P272563P?cidp=Froogle&affiliate=ppc',
      'http://britain.desertcart.com/products/484923669-bezgar-tc141-toy-grade-1-14-scale-remote-control-car-all-terrains-electric-toy-off-road-rc-truck-remote-control-monster-truck-for-kids-boys-3-4-5-6-7-8-with-rechargeable-battery-bezgar-remote-control-construction-excavator-rc-toys-with-2-rechargeable-batteries-for-kids-age-6-7-8-9-10-11-rc-construction-truck-vehicle-toys-with-light-for-boys-and-girls-tk181-bezgar-hs181-hobby-grade-1-18-scale-remote-control-trucks-4wd-top-speed-35-km-h-all-terrains-off-road-short-course-rc-truck-waterproof-rc-car-with-2-rechargeable-batteries-for-kids-and-adults-bezgar-hm161-hobby-grade-1-16-scale-remote-control-truck-4wd-high-speed-40-kmh-all-terrains-electric-toy-off-road-rc-vehicle-car-crawler-with-2-rechargeable-batteries-for-boys-kids-and-adults',
    ].forEach((url) => {
      it(`should allow long, but safe URLs: ${url}`, function () {
        shouldBeSafe(url);
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
