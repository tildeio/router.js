import { Transition } from 'router';
import { Dict } from 'router/core';
import {
  Continuation,
  noopGetHandler,
  UnresolvedHandlerInfoByObject,
  UnresolvedHandlerInfoByParam,
} from 'router/handler-info';
import TransitionState, { TransitionError } from 'router/transition-state';
import { Promise, reject, resolve } from 'rsvp';
import { createHandler, createHandlerInfo, flushBackburner, module, test } from './test_helpers';

module('TransitionState');

test('it starts off with default state', function(assert) {
  let state = new TransitionState();
  assert.deepEqual(state.handlerInfos, [], 'it has an array of handlerInfos');
});

test("#resolve delegates to handleInfo objects' resolve()", function(assert) {
  assert.expect(7);

  let state = new TransitionState();

  let counter = 0;

  let resolvedHandlerInfos: any[] = [{}, {}];

  state.handlerInfos = [
    createHandlerInfo('one', {
      resolve: function(shouldContinue: Continuation) {
        ++counter;
        assert.equal(counter, 1);
        shouldContinue();
        return resolve(resolvedHandlerInfos[0]);
      },
    }),
    createHandlerInfo('two', {
      resolve: function(shouldContinue: Continuation) {
        ++counter;
        assert.equal(counter, 2);
        shouldContinue();
        return resolve(resolvedHandlerInfos[1]);
      },
    }),
  ];

  function keepGoing() {
    assert.ok(true, 'continuation function was called');
    return Promise.resolve(false);
  }

  state.resolve(keepGoing, {} as Transition).then(function(result: TransitionState) {
    assert.deepEqual(result.handlerInfos, resolvedHandlerInfos);
  });
});

test('State resolution can be halted', function(assert) {
  assert.expect(2);

  let state = new TransitionState();

  state.handlerInfos = [
    createHandlerInfo('one', {
      resolve: function(shouldContinue: Continuation) {
        return shouldContinue();
      },
    }),
    createHandlerInfo('two', {
      resolve: function() {
        assert.ok(false, 'I should not be entered because we threw an error in shouldContinue');
      },
    }),
  ];

  function keepGoing() {
    return reject('NOPE');
  }

  state.resolve(keepGoing, {} as Transition).catch(function(reason: TransitionError) {
    assert.equal(reason.error, 'NOPE');
    assert.ok(reason.wasAborted, 'state resolution was correctly marked as aborted');
  });

  flushBackburner();
});

test('Integration w/ HandlerInfos', function(assert) {
  assert.expect(4);

  let state = new TransitionState();

  let fooModel = {};
  let barModel = {};
  let transition = {};

  state.handlerInfos = [
    new UnresolvedHandlerInfoByParam(
      'foo',
      noopGetHandler,
      { foo_id: '123' },
      createHandler('foo', {
        model: function(params: Dict<unknown>, payload: Dict<unknown>) {
          assert.equal(payload, transition);
          assert.equal(params.foo_id, '123', 'foo#model received expected params');
          return resolve(fooModel);
        },
      })
    ),
    new UnresolvedHandlerInfoByObject(
      'bar',
      ['bar_id'],
      noopGetHandler,
      () => {},
      resolve(barModel)
    ),
  ];

  function noop() {
    return Promise.resolve(false);
  }

  state
    .resolve(noop, transition as Transition)
    .then(function(result: TransitionState) {
      let models = [];
      for (let i = 0; i < result.handlerInfos.length; i++) {
        models.push(result.handlerInfos[i].context);
      }

      assert.equal(models[0], fooModel);
      assert.equal(models[1], barModel);
      return Promise.resolve(new TransitionState());
    })
    .catch(function(error: Error) {
      assert.ok(false, 'Caught error: ' + error);
    });
});
