import { module, test, stubbedHandlerInfoFactory } from './test_helpers';

import HandlerInfo from 'router/handler-info';

import ResolvedHandlerInfo from 'router/handler-info/resolved-handler-info';
import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';

import { resolve, reject } from 'rsvp';

function noop() {}

var resolvedModel = {};

class StubHandlerInfo extends HandlerInfo {
  getModel() {
    return resolvedModel;
  }
}

function create(Klass, _props) {
  var props = _props || {};
  props.handler = props.handler || {};
  props.params = props.params || {};
  props.name = props.name || 'foo';

  var handlerInfo = new Klass(props);
  handlerInfo.factory = stubbedHandlerInfoFactory;
  return handlerInfo;
}

module('HandlerInfo');

test('ResolvedHandlerInfos resolve to themselves', function(assert) {
  var handlerInfo = new ResolvedHandlerInfo();
  handlerInfo.resolve().then(function(resolvedHandlerInfo) {
    assert.equal(handlerInfo, resolvedHandlerInfo);
  });
});

test('UnresolvedHandlerInfoByParam defaults params to {}', function(assert) {
  var handlerInfo = new UnresolvedHandlerInfoByParam();
  assert.deepEqual(handlerInfo.params, {});

  var handlerInfo2 = new UnresolvedHandlerInfoByParam({ params: { foo: 5 } });
  assert.deepEqual(handlerInfo2.params, { foo: 5 });
});

test('HandlerInfo can be aborted mid-resolve', function(assert) {
  assert.expect(2);

  var handlerInfo = create(StubHandlerInfo);

  function abortResolve() {
    assert.ok(true, 'abort was called');
    return reject('LOL');
  }

  handlerInfo.resolve(abortResolve, {}).catch(function(error) {
    assert.equal(error, 'LOL');
  });
});

test('HandlerInfo#resolve resolves with a ResolvedHandlerInfo', function(
  assert
) {
  assert.expect(1);

  var handlerInfo = create(StubHandlerInfo);

  handlerInfo.resolve(noop, {}).then(function(resolvedHandlerInfo) {
    assert.equal(resolvedHandlerInfo._handlerInfoType, 'resolved');
  });
});

test('HandlerInfo#resolve runs beforeModel hook on handler', function(assert) {
  assert.expect(1);

  var transition = {};

  var handlerInfo = create(StubHandlerInfo, {
    handler: {
      beforeModel: function(payload) {
        assert.equal(
          transition,
          payload,
          'beforeModel was called with the payload we passed to resolve()'
        );
      },
    },
  });

  handlerInfo.resolve(noop, transition);
});

test('HandlerInfo#resolve runs getModel hook', function(assert) {
  assert.expect(1);

  var transition = {};

  var handlerInfo = create(StubHandlerInfo, {
    getModel: function(payload) {
      assert.equal(payload, transition);
    },
  });
  handlerInfo.factory = stubbedHandlerInfoFactory;

  handlerInfo.resolve(noop, transition);
});

test('HandlerInfo#resolve runs afterModel hook on handler', function(assert) {
  assert.expect(3);

  var transition = {};
  var model = {};

  var handlerInfo = new HandlerInfo({
    handler: {
      afterModel: function(resolvedModel, payload) {
        assert.equal(
          resolvedModel,
          model,
          'afterModel receives the value resolved by model'
        );
        assert.equal(payload, transition);
        return resolve(123); // 123 should get ignored
      },
    },

    getModel: function() {
      return resolve(model);
    },
    factory: stubbedHandlerInfoFactory,
  });

  handlerInfo.resolve(noop, transition).then(function(resolvedHandlerInfo) {
    assert.equal(
      resolvedHandlerInfo.context,
      model,
      'HandlerInfo resolved with correct model'
    );
  });
});

test('UnresolvedHandlerInfoByParam gets its model hook called', function(
  assert
) {
  assert.expect(2);

  var transition = {};

  var handlerInfo = new UnresolvedHandlerInfoByParam({
    handler: {
      model: function(params, payload) {
        assert.equal(payload, transition);
        assert.deepEqual(params, {
          first_name: 'Alex',
          last_name: 'Matchnerd',
        });
      },
    },

    params: { first_name: 'Alex', last_name: 'Matchnerd' },
  });

  handlerInfo.resolve(noop, transition);
});

test('UnresolvedHandlerInfoByObject does NOT get its model hook called', function(
  assert
) {
  assert.expect(1);

  var handlerInfo = create(UnresolvedHandlerInfoByObject, {
    handler: {
      model: function() {
        assert.ok(
          false,
          "I shouldn't be called because I already have a context/model"
        );
      },
    },
    names: ['wat'],
    context: resolve({ name: 'dorkletons' }),
  });

  handlerInfo.resolve(noop, {}).then(function(resolvedHandlerInfo) {
    assert.equal(resolvedHandlerInfo.context.name, 'dorkletons');
  });
});
