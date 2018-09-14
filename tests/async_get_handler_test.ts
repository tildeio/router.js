import Router, { IHandler } from 'router';
import { Dict } from 'router/core';
import { Promise } from 'rsvp';
import { createHandler } from './test_helpers';

// Intentionally use QUnit.module instead of module from test_helpers
// so that we avoid using Backburner to handle the async portions of
// the test suite
let handlers: Dict<IHandler>;
let router: Router;
QUnit.module('Async Get Handler', {
  beforeEach: function() {
    QUnit.config.testTimeout = 60000;

    handlers = {};

    class TestRouter extends Router {
      didTransition() {}
      willTransition() {}
      replaceURL() {}
      triggerEvent() {}
      getHandler(_name: string): never {
        throw new Error('never');
      }

      getSerializer(_name: string): never {
        throw new Error('never');
      }

      updateURL(_name: string) {}
    }
    router = new TestRouter();
    router.map(function(match) {
      match('/index').to('index');
      match('/foo').to('foo', function(match) {
        match('/').to('fooIndex');
        match('/bar').to('fooBar');
      });
    });
  },

  afterEach: function() {
    QUnit.config.testTimeout = 1000;
  },
});

QUnit.test('can transition to lazily-resolved routes', function(assert) {
  let done = assert.async();

  router.getHandler = function(name: string) {
    return new Promise(function(resolve) {
      setTimeout(function() {
        resolve(handlers[name] || (handlers[name] = createHandler('empty')));
      }, 1);
    });
  };

  let fooCalled = false;
  let fooBarCalled = false;

  handlers.foo = createHandler('foo', {
    model() {
      fooCalled = true;
    },
  });
  handlers.fooBar = createHandler('fooBar', {
    model: function() {
      fooBarCalled = true;
    },
  });

  router.transitionTo('/foo/bar').then(function() {
    assert.ok(fooCalled, 'foo is called before transition ends');
    assert.ok(fooBarCalled, 'fooBar is called before transition ends');
    done();
  });

  assert.ok(!fooCalled, 'foo is not called synchronously');
  assert.ok(!fooBarCalled, 'fooBar is not called synchronously');
});

QUnit.test('calls hooks of lazily-resolved routes in order', function(assert) {
  let done = assert.async();
  let operations: string[] = [];

  router.getHandler = function(name: string) {
    operations.push('get handler ' + name);
    return new Promise(function(resolve) {
      let timeoutLength = name === 'foo' ? 100 : 1;
      setTimeout(function() {
        operations.push('resolved ' + name);
        resolve(handlers[name] || (handlers[name] = createHandler('empty')));
      }, timeoutLength);
    });
  };

  handlers.foo = createHandler('foo', {
    model: function() {
      operations.push('model foo');
    },
  });
  handlers.fooBar = createHandler('fooBar', {
    model: function() {
      operations.push('model fooBar');
    },
  });

  router.transitionTo('/foo/bar').then(function() {
    assert.deepEqual(
      operations,
      [
        'get handler foo',
        'get handler fooBar',
        'resolved fooBar',
        'resolved foo',
        'model foo',
        'model fooBar',
      ],
      'order of operations is correct'
    );
    done();
  });
});
