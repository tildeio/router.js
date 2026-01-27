import Router, { Route, Transition, TransitionError } from 'router';
import RouteInfo from 'router/route-info';
import { Dict } from 'router/core';
import { Promise } from 'rsvp';
import { createHandler, TestRouter, trigger } from './test_helpers';

function map(router: Router<Route>) {
  router.map(function (match) {
    match('/index').to('index');
    match('/query').to('query');
    match('/foo').to('foo', function (match) {
      match('/').to('fooIndex');
      match('/bar').to('fooBar');
    });
  });
}

function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Intentionally use QUnit.module instead of module from test_helpers
// so that we avoid using Backburner to handle the async portions of
// the test suite
let routes: Dict<Route>;
let router: TestRouter;
QUnit.module('Async Get Handler', {
  beforeEach: function () {
    QUnit.config.testTimeout = 6000;
    routes = {};
  },

  afterEach: function () {
    QUnit.config.testTimeout = 1000;
  },
});

QUnit.test('can transition to lazily-resolved routes', function (assert) {
  let done = assert.async();

  class LazyRouter extends TestRouter {
    getRoute(name: string) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(routes[name] || (routes[name] = createHandler('empty')));
        }, 1);
      });
    }
  }

  router = new LazyRouter();
  map(router);

  let fooCalled = false;
  let fooBarCalled = false;

  routes.foo = createHandler('foo', {
    model() {
      fooCalled = true;
    },
  });
  routes.fooBar = createHandler('fooBar', {
    model: function () {
      fooBarCalled = true;
    },
  });

  router.transitionTo('/foo/bar').then(function () {
    assert.ok(fooCalled, 'foo is called before transition ends');
    assert.ok(fooBarCalled, 'fooBar is called before transition ends');
    done();
  });

  assert.ok(!fooCalled, 'foo is not called synchronously');
  assert.ok(!fooBarCalled, 'fooBar is not called synchronously');
});

QUnit.test('calls hooks of lazily-resolved routes in order', function (assert) {
  let done = assert.async();
  let operations: string[] = [];

  class LazyRouter extends TestRouter {
    getRoute(name: string) {
      operations.push('get handler ' + name);
      return new Promise(function (resolve) {
        let timeoutLength = name === 'foo' ? 100 : 1;
        setTimeout(function () {
          operations.push('resolved ' + name);
          resolve(routes[name] || (routes[name] = createHandler('empty')));
        }, timeoutLength);
      });
    }
  }

  router = new LazyRouter();
  map(router);

  routes.foo = createHandler('foo', {
    model: function () {
      operations.push('model foo');
    },
  });
  routes.fooBar = createHandler('fooBar', {
    model: function () {
      operations.push('model fooBar');
    },
  });

  router.transitionTo('/foo/bar').then(function () {
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
  }, null);
});

QUnit.test('pause transitions', function (assert) {
  let done = assert.async();
  let operations: string[] = [];
  let enteredWillChange = 0;
  let enteredDidError = 0;

  class PauseRouter extends TestRouter {
    getRoute(name: string) {
      operations.push('resolved ' + name);
      return routes[name] || (routes[name] = createHandler('empty'));
    }
  }

  let router: Router<Route> = new PauseRouter();

  router.routeWillChange = (transition: Transition) => {
    enteredWillChange++;

    const { promise, resolve, reject } = createDeferred();
    transition.waitFor(promise);
    setTimeout(() => {
      operations.push('paused transition');
      if (enteredWillChange === 1) {
        resolve();
        operations.push('resolved pause');
      } else {
        reject('reject');
        operations.push('rejected pause');
      }
    }, 1);
  };

  router.transitionDidError = (error: TransitionError, transition: Transition) => {
    enteredDidError++;
    assert.equal('reject', error.error);
    transition.trigger(false, 'error', error.error, transition, error.route);
    transition.abort();
    return error.error;
  };

  map(router);

  routes.index = createHandler('index', {
    model: function () {
      operations.push('model index');
    },
  });
  routes.foo = createHandler('foo', {
    model: function () {
      operations.push('model foo');
    },
  });
  routes.fooBar = createHandler('fooBar', {
    model: function () {
      operations.push('model fooBar');
    },
  });

  router.transitionTo('/index').then(function () {
    assert.deepEqual(
      operations,
      [
        'resolved index',
        'paused transition',
        'resolved pause',
        'model index',
      ],
      'order of /index operations is correct'
    );

    operations = [];

    router.transitionTo('/foo/bar').catch(function () {
      assert.deepEqual(
        operations,
        [
          'resolved foo',
          'resolved fooBar',
          'paused transition',
          'rejected pause',
        ],
        'order of /foo/bar operations is correct'
      );
      done();
    });

  }, null);
});

QUnit.test('pause transitions query params only', function (assert) {
  let done = assert.async();
  let operations: string[] = [];
  let enteredWillChange = 0;

  class QpPauseRouter extends TestRouter {
    getRoute(name: string) {
      operations.push('resolved ' + name);
      return routes[name] || (routes[name] = createHandler('empty'));
    }
    triggerEvent(
      handlerInfos: RouteInfo<Route>[],
      ignoreFailure: boolean,
      name: string,
      args: any[]
    ) {
      trigger(handlerInfos, ignoreFailure, name, ...args);
    }
  }

  let router: Router<Route> = new QpPauseRouter();

  router.routeWillChange = (transition: Transition) => {
    enteredWillChange++;

    const { promise, resolve } = createDeferred();
    transition.waitFor(promise);
    setTimeout(() => {
      operations.push('paused transition');
      resolve();
      operations.push('resolved pause');
    }, 1);
  };

  map(router);

  routes.query = createHandler('query', {
    model: function () {
      operations.push('model query');
    },

    events: {
      finalizeQueryParamChange: function ({ param }) {
        operations.push('param is now ' + param);
      }
    },
  });

  router.transitionTo('/query').then(function () {
    operations = [];
    router.transitionTo('/query?param=1').then(function () {
      assert.deepEqual(
        operations,
        [
          'resolved query',
          'param is now 1',
          'paused transition',
          'resolved pause',
        ],
        'order of /query?param=1 operations is correct'
      );

      operations = [];
      router.transitionTo('/query?param=2').then(function () {
        assert.deepEqual(
          operations,
          [
            'resolved query',
            'param is now 2',
            'paused transition',
            'resolved pause',
          ],
          'order of /query?param=2 operations is correct'
        );
        done();
      });

    }, null);
  });
});
