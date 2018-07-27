import { Transition } from 'router';
import { Dict } from 'router/core';
import HandlerInfo, {
  noopGetHandler,
  ResolvedHandlerInfo,
  UnresolvedHandlerInfoByObject,
  UnresolvedHandlerInfoByParam,
} from 'router/handler-info';
import { reject, resolve } from 'rsvp';
import { createHandler, createHandlerInfo, module, test } from './test_helpers';

function noop() {
  return resolve(true);
}

module('HandlerInfo');

test('ResolvedHandlerInfos resolve to themselves', function(assert) {
  let handlerInfo = new ResolvedHandlerInfo('foo', createHandler('empty'), {});
  handlerInfo.resolve().then(function(resolvedHandlerInfo) {
    assert.equal(handlerInfo, resolvedHandlerInfo);
  });
});

test('UnresolvedHandlerInfoByParam defaults params to {}', function(assert) {
  let handlerInfo = new UnresolvedHandlerInfoByParam('empty', noopGetHandler, {});
  assert.deepEqual(handlerInfo.params, {});

  let handlerInfo2 = new UnresolvedHandlerInfoByParam('empty', noopGetHandler, { foo: 5 });
  assert.deepEqual(handlerInfo2.params, { foo: 5 });
});

test('HandlerInfo can be aborted mid-resolve', function(assert) {
  assert.expect(2);

  let handlerInfo = createHandlerInfo('stub');

  function abortResolve() {
    assert.ok(true, 'abort was called');
    return reject('LOL');
  }

  handlerInfo.resolve(abortResolve, {} as Transition).catch(function(error: Error) {
    assert.equal(error, 'LOL');
  });
});

test('HandlerInfo#resolve resolves with a ResolvedHandlerInfo', function(assert) {
  assert.expect(1);

  let handlerInfo = createHandlerInfo('stub');
  handlerInfo
    .resolve(() => false, {} as Transition)
    .then(function(resolvedHandlerInfo: HandlerInfo) {
      assert.ok(resolvedHandlerInfo instanceof ResolvedHandlerInfo);
    });
});

test('HandlerInfo#resolve runs beforeModel hook on handler', function(assert) {
  assert.expect(1);

  let transition = {};

  let handlerInfo = createHandlerInfo('stub', {
    handler: createHandler('stub', {
      beforeModel: function(currentTransition: Transition) {
        assert.equal(
          transition,
          currentTransition,
          'beforeModel was called with the payload we passed to resolve()'
        );
      },
    }),
  });

  handlerInfo.resolve(noop, transition as Transition);
});

test('HandlerInfo#resolve runs getModel hook', function(assert) {
  assert.expect(1);

  let transition = {};

  let handlerInfo = createHandlerInfo('stub', {
    getModel(payload: Dict<unknown>) {
      assert.equal(payload, transition);
    },
  });

  handlerInfo.resolve(noop, transition as Transition);
});

test('HandlerInfo#resolve runs afterModel hook on handler', function(assert) {
  assert.expect(3);

  let transition = {};
  let model = {};

  let handlerInfo = createHandlerInfo('foo', {
    handler: createHandler('foo', {
      afterModel: function(resolvedModel: Dict<unknown>, payload: Dict<unknown>) {
        assert.equal(resolvedModel, model, 'afterModel receives the value resolved by model');
        assert.equal(payload, transition);
        return resolve(123); // 123 should get ignored
      },
    }),
    getModel: function() {
      return resolve(model);
    },
  });

  handlerInfo
    .resolve(noop, transition as Transition)
    .then(function(resolvedHandlerInfo: HandlerInfo) {
      assert.equal(resolvedHandlerInfo.context, model, 'HandlerInfo resolved with correct model');
    });
});

test('UnresolvedHandlerInfoByParam gets its model hook called', function(assert) {
  assert.expect(2);

  let transition = {};

  let handlerInfo = new UnresolvedHandlerInfoByParam(
    'empty',
    noopGetHandler,
    { first_name: 'Alex', last_name: 'Matchnerd' },
    createHandler('h', {
      model: function(params: Dict<unknown>, payload: Dict<unknown>) {
        assert.equal(payload, transition);
        assert.deepEqual(params, {
          first_name: 'Alex',
          last_name: 'Matchnerd',
        });
      },
    })
  );

  handlerInfo.resolve(noop, transition as Transition);
});

test('UnresolvedHandlerInfoByObject does NOT get its model hook called', function(assert) {
  assert.expect(1);

  class Handler extends UnresolvedHandlerInfoByObject {
    handler = createHandler('uresolved', {
      model: function() {
        assert.ok(false, "I shouldn't be called because I already have a context/model");
      },
    });
  }
  let handlerInfo = new Handler(
    'unresolved',
    ['wat'],
    noopGetHandler,
    () => {},
    resolve({ name: 'dorkletons' })
  );

  handlerInfo.resolve(noop, {} as Transition).then(function(resolvedHandlerInfo: HandlerInfo) {
    assert.equal(resolvedHandlerInfo.context!.name, 'dorkletons');
  });
});
