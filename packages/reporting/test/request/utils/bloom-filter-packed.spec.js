import * as chai from 'chai';

import BloomFilter from '../../../src/request/utils/bloom-filter-packed';

describe('core/bloom-filter-packed', function () {
  describe('BloomFilterPacked', function () {
    it('should pass simple testSingle tests', function () {
      const buffer = new ArrayBuffer(5 + 101 * 4);
      const view = new DataView(buffer);
      view.setUint32(0, 101, false);
      view.setUint8(4, 7, false);
      const uut = new BloomFilter(view.buffer);

      chai.expect(uut.testSingle('x')).to.be.false;
      chai.expect(uut.testSingle('y')).to.be.false;

      uut.addSingle('x');
      chai.expect(uut.testSingle('x')).to.be.true;
      chai.expect(uut.testSingle('y')).to.be.false;

      uut.addSingle('y');
      chai.expect(uut.testSingle('x')).to.be.true;
      chai.expect(uut.testSingle('y')).to.be.true;
    });
  });
});
