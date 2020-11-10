import Router, { Route, Transition } from 'router';
import { Dict } from 'router/core';
import { createHandler, TestRouter } from './test_helpers';

QUnit.module('native async', function (hooks) {
  let router: LocalRouter;

  class LocalRouter extends TestRouter {
    routes: Dict<Route> = Object.create(null);
    url: string | undefined;

    routeDidChange() {}
    routeWillChange() {}
    didTransition() {}
    willTransition() {}

    getRoute(name: string) {
      if (this.routes[name] === undefined) {
        this.routes[name] = createHandler('empty');
      }

      return this.routes[name];
    }

    getSerializer(_name: string) {
      return undefined;
    }

    replaceURL(name: string) {
      this.updateURL(name);
    }

    updateURL(newUrl: string) {
      this.url = newUrl;
    }
  }

  hooks.beforeEach(() => {
    router = new LocalRouter();
  });

  QUnit.test('returning a transition does not reject with TransitionAborted', async function (
    assert
  ) {
    assert.expect(3);

    router.map(function (match) {
      match('/').to('application', function (match) {
        match('/').to('index');
        match('/about').to('about');
      });
    });

    router.routes = {
      index: createHandler('index', {
        beforeModel(_params: Dict<unknown>, _transition: Transition) {
          assert.step('index beforeModel');

          return router.transitionTo('/about');
        },
      }),

      about: createHandler('about', {
        setup() {
          assert.step('about setup');
        },
      }),
    };

    await router.handleURL('/');

    assert.equal(router.url, '/about', 'ended on /about');

    assert.verifySteps(['index beforeModel', 'about setup']);
  });

  QUnit.test(
    'returning a promise that resolves to a transition (which resolves) does not reject',
    async function (assert) {
      assert.expect(1);

      router.map(function (match) {
        match('/').to('application', function (match) {
          match('/').to('index');
          match('/about').to('about');
        });
      });

      router.routes = {
        index: createHandler('index', {
          async beforeModel(_params: Dict<unknown>, _transition: Transition) {
            return router.transitionTo('/about');
          },
        }),

        about: createHandler('about', {
          setup: function () {
            assert.ok(true, 'setup was entered');
          },
        }),
      };

      return router.handleURL('/');
    }
  );
});
