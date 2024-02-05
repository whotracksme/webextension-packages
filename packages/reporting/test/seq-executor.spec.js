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

import SeqExecutor from '../src/seq-executor.js';

describe('#SeqExecutor', function () {
  let uut;

  beforeEach(function () {
    uut = new SeqExecutor();
  });

  describe('#run', function () {
    describe('should get the result from succeeding functions', function () {
      it('started one by one', async () => {
        expect(await uut.run(() => 1)).to.equal(1);
        expect(await uut.run(async () => 2)).to.equal(2);
        expect(
          await uut.run(
            () => new Promise((resolve) => setTimeout(resolve(3), 0)),
          ),
        ).to.equal(3);
        expect(await uut.run(() => 4)).to.equal(4);
      });

      it('started at the same time', async () => {
        const results = await Promise.all([
          uut.run(() => 1),
          uut.run(async () => 2),
          uut.run(() => new Promise((resolve) => setTimeout(resolve(3), 0))),
          uut.run(() => 4),
        ]);
        expect(results).to.deep.equal([1, 2, 3, 4]);
      });
    });

    it('should get the result from failing functions', async () => {
      expect(await uut.run(() => 1)).to.equal(1);

      let gotError2 = false;
      try {
        await uut.run(() => {
          throw new Error(2);
        });
      } catch (e) {
        gotError2 = true;
      }
      if (!gotError2) {
        assert.fail('Should have thrown Error(2)');
      }

      expect(await uut.run(() => 3)).to.equal(3);

      let gotError4 = false;
      try {
        await uut.run(async () => {
          throw new Error(4);
        });
      } catch (e) {
        gotError4 = true;
      }
      if (!gotError4) {
        assert.fail('Should have thrown Error(4)');
      }
    });

    it('should execute function one by one', async () => {
      let state = 0;
      const steps = [];

      const results = await Promise.all([
        uut.run(async () => {
          steps.push('start1');
          expect(state).to.equal(0);
          state += 1;
          return new Promise((resolve) => {
            setTimeout(() => {
              expect(state).to.equal(1);
              state += 1;
              steps.push('end1');
              expect(state).to.equal(2);
              resolve('step1-done');
            }, 0);
          });
        }),
        uut.run(async () => {
          steps.push('start2');
          expect(state).to.equal(2);
          state += 1;
          await Promise.resolve();
          expect(state).to.equal(3);
          state += 1;
          await Promise.resolve();
          expect(state).to.equal(4);
          state += 1;
          await Promise.resolve();
          expect(state).to.equal(5);
          steps.push('end2');
          return 'step2-done';
        }),
        uut.run(() => {
          steps.push('start3');
          expect(state).to.equal(5);
          state += 1;
          expect(state).to.equal(6);
          steps.push('end3');
          return 'step3-done';
        }),
      ]);
      expect(state).to.equal(6);
      expect(results).to.deep.equal(['step1-done', 'step2-done', 'step3-done']);
      expect(steps).to.deep.equal([
        'start1',
        'end1',
        'start2',
        'end2',
        'start3',
        'end3',
      ]);
    });
  });

  describe('#waitForAll', function () {
    it('should return immediately if no operations have been started yet', async () => {
      let timeout = false;
      setTimeout(() => {
        timeout = true;
      }, 0);
      await uut.waitForAll();
      expect(timeout).to.equal(false);
    });

    it('should block until all operations are completed', async () => {
      let timeout = false;
      uut.run(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              timeout = true;
              resolve();
            });
          }),
      );
      await uut.waitForAll();
      expect(timeout).to.equal(true);
    });
  });
});
