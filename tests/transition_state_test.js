import {
  module,
  test,
  flushBackburner,
  stubbedHandlerInfoFactory,
} from './test_helpers';
import TransitionState from 'router/transition-state';

import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';

import { resolve, reject } from 'rsvp';

module('TransitionState');

test('it starts off with default state', function(assert) {
  var state = new TransitionState();
  assert.deepEqual(state.handlerInfos, [], 'it has an array of handlerInfos');
});

test("#resolve delegates to handleInfo objects' resolve()", function(assert) {
  assert.expect(8);

  var state = new TransitionState();

  var counter = 0;

  var resolvedHandlerInfos = [{}, {}];

  state.handlerInfos = [
    {
      resolve: function(shouldContinue) {
        ++counter;
        assert.equal(counter, 1);
        shouldContinue();
        return resolve(resolvedHandlerInfos[0]);
      },
    },
    {
      resolve: function(shouldContinue) {
        ++counter;
        assert.equal(counter, 2);
        shouldContinue();
        return resolve(resolvedHandlerInfos[1]);
      },
    },
  ];

  function keepGoing() {
    assert.ok(true, 'continuation function was called');
  }

  state.resolve(keepGoing).then(function(result) {
    assert.notOk(result.error);
    assert.deepEqual(result.state.handlerInfos, resolvedHandlerInfos);
  });
});

test('State resolution can be halted', function(assert) {
  assert.expect(2);

  var state = new TransitionState();

  state.handlerInfos = [
    {
      resolve: function(shouldContinue) {
        return shouldContinue();
      },
    },
    {
      resolve: function() {
        assert.ok(
          false,
          'I should not be entered because we threw an error in shouldContinue'
        );
      },
    },
  ];

  function keepGoing() {
    return reject('NOPE');
  }

  state.resolve(keepGoing).catch(function(reason) {
    assert.equal(reason.error, 'NOPE');
    assert.ok(
      reason.wasAborted,
      'state resolution was correctly marked as aborted'
    );
  });

  flushBackburner();
});

test('Integration w/ HandlerInfos', function(assert) {
  assert.expect(5);

  var state = new TransitionState();

  var fooModel = {};
  var barModel = {};
  var transition = {};

  state.handlerInfos = [
    new UnresolvedHandlerInfoByParam({
      name: 'foo',
      params: { foo_id: '123' },
      handler: {
        model: function(params, payload) {
          assert.equal(payload, transition);
          assert.equal(
            params.foo_id,
            '123',
            'foo#model received expected params'
          );
          return resolve(fooModel);
        },
      },
      factory: stubbedHandlerInfoFactory,
    }),
    new UnresolvedHandlerInfoByObject({
      name: 'bar',
      names: ['bar_id'],
      context: resolve(barModel),
      handler: {},
      factory: stubbedHandlerInfoFactory,
    }),
  ];

  function noop() {}

  state
    .resolve(noop, transition)
    .then(function(result) {
      var models = [];
      for (var i = 0; i < result.state.handlerInfos.length; i++) {
        models.push(result.state.handlerInfos[i].context);
      }

      assert.notOk(result.error);
      assert.equal(models[0], fooModel);
      assert.equal(models[1], barModel);
    })
    .catch(function(error) {
      assert.ok(false, 'Caught error: ' + error);
    });
});
