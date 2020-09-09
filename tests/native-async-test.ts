import Router, { Route, Transition } from 'router';
import { Dict } from 'router/core';
import { createHandler, TestRouter } from './test_helpers';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

QUnit.module('native async', function (hooks) {
  let router: Router<Route>;
  let url: string | undefined;
  let routes: Dict<Route>;

  class LocalRouter extends TestRouter {
    routeDidChange() {}
    routeWillChange() {}
    didTransition() {}
    willTransition() {}

    getRoute(name: string) {
      if (routes[name] === undefined) {
        routes[name] = createHandler('empty');
      }

      return routes[name];
    }

    getSerializer(_name: string) {
      return undefined;
    }

    replaceURL(name: string) {
      this.updateURL(name);
    }
    updateURL(newUrl: string) {
      url = newUrl;
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

    routes = {
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

    assert.equal(url, '/about', 'ended on /about');

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

      routes = {
        index: createHandler('index', {
          async beforeModel(_params: Dict<unknown>, _transition: Transition) {
            await sleep(5);

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
