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
import sinon from 'sinon';

import Observable from '../src/observable.js';

describe('#Observable', function () {
  let uut;

  beforeEach(() => {
    uut = new Observable();
  });

  it('should handle empty observer list', () => {
    expect(() => uut.notifyObservers()).to.not.throw();
  });

  it('should call all subscribed observers', () => {
    const observer1 = sinon.stub();
    const observer2 = sinon.stub();
    const observer3 = sinon.stub();
    uut.addObserver(observer1);
    uut.addObserver(observer2);
    uut.addObserver(observer3);

    uut.notifyObservers('foo', 'bar');

    expect(observer1.calledOnceWithExactly('foo', 'bar')).to.be.true;
    expect(observer2.calledOnceWithExactly('foo', 'bar')).to.be.true;
    expect(observer3.calledOnceWithExactly('foo', 'bar')).to.be.true;
  });

  it('should continue if a single observers fails', () => {
    const observer1 = sinon.stub().throws(new Error('Test error'));
    const observer2 = sinon.stub();
    const observer3 = sinon.stub();

    uut.addObserver(observer1);
    uut.addObserver(observer2);
    uut.addObserver(observer3);

    expect(() => uut.notifyObservers('arg1', 'arg2')).to.not.throw();

    expect(observer1.calledOnce).to.be.true;
    expect(observer2.calledOnce).to.be.true;
    expect(observer3.calledOnce).to.be.true;
  });

  it('should not call observers that have unsubscribed', () => {
    const observer1 = sinon.stub();
    const observer2 = sinon.stub();
    uut.addObserver(observer1);

    uut.addObserver(observer2);
    uut.removeObserver(observer2);

    uut.notifyObservers('foo', 'bar');

    expect(observer1.calledOnceWithExactly('foo', 'bar')).to.be.true;
    expect(observer2.calledOnceWithExactly('foo', 'bar')).to.be.false;
  });
});
