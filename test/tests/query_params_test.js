import { module, flushBackburner, transitionTo, transitionToWithAbort, shouldNotHappen, shouldBeTransition } from "tests/test_helpers";
import Router from "router";
import { resolve, configure, reject, Promise } from "rsvp";

var router, url, handlers, expectedUrl, actions;

module("Query Params", {
  setup: function() {
    handlers = {};
    expectedUrl = null;

    map(function(match) {
      match("/index").to("index");
    });
  }
});

function map(fn) {
  router = new Router();
  router.map(fn);

  router.getHandler = function(name) {
    return handlers[name] || (handlers[name] = {});
  };

  router.updateURL = function(newUrl) {

    if (expectedUrl) {
      equal(newUrl, expectedUrl, "The url is " + newUrl+ " as expected");
    }

    url = newUrl;
  };
}

function enableErrorHandlingDeferredActionQueue() {
  actions = [];
  configure('async', function(callback, promise) {
    actions.push({
      callback: callback,
      promise: promise
    });
  });
}

test("a change in query params fires a queryParamsDidChange event", function() {
  expect(7);

  var count = 0;
  handlers.index = {
    setup: function() {
      equal(count, 0, "setup should be called exactly once since we're only changing query params after the first transition");
    },
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        // copy to finalParams to tell the router we're consuming
        // these params.
        finalParams.push({ key: 'foo', value: params.foo });
        finalParams.push({ key: 'bar', value: params.bar });
      },

      queryParamsDidChange: function(changed, all) {
        switch (count) {
          case 0:
            ok(false, "shouldn't fire on first trans");
            break;
          case 1:
            deepEqual(changed, { foo: '5', bar: null });
            deepEqual(all,     { foo: '5' });
            break;
          case 2:
            deepEqual(changed, { bar: '6' });
            deepEqual(all,     { foo: '5', bar: '6' });
            break;
          case 3:
            deepEqual(changed, { foo: '8', bar: '9' });
            deepEqual(all,     { foo: '8', bar: '9' });
            break;
        }
      }
    }
  };

  transitionTo(router, '/index');
  count = 1;
  transitionTo(router, '/index?foo=5');
  count = 2;
  transitionTo(router, '/index?foo=5&bar=6');
  count = 3;
  transitionTo(router, '/index?foo=8&bar=9');
});

test("a handler can opt into a full-on transition by calling refresh", function() {

  expect(2);

  var count = 0;
  handlers.index = {
    model: function() {
      switch (count) {
        case 0:
          ok(true, "model called at first");
          break;
        case 1:
          ok(true, "model called at second");
          break;
        default:
          ok(false, "shouldn't have been called for " + count);
      }
    },
    events: {
      queryParamsDidChange: function(changed, all) {
        switch (count) {
          case 0:
            ok(false, "shouldn't fire on first trans");
            break;
          case 1:
            router.refresh(this);
            break;
        }
      },
      finalizeQueryParamChange: function(params) {
        // we have to consume each param so that the
        // router doesn't think it lost lost the param.
        delete params.foo;
      }
    }
  };

  transitionTo(router, '/index');
  count = 1;
  transitionTo(router, '/index?foo=5');
});


test("at the end of a query param change a finalizeQueryParamChange event is fired", function() {
  expect(5);

  var eventHandled = false;
  var count = 0;
  handlers.index = {
    setup: function() {
      ok(!eventHandled, "setup should happen before eventHandled");
    },
    events: {
      finalizeQueryParamChange: function(all) {
        eventHandled = true;
        switch (count) {
          case 0:
            deepEqual(all, {});
            break;
          case 1:
            deepEqual(all, { foo: '5' });
            break;
          case 2:
            deepEqual(all, { foo: '5', bar: '6' });
            break;
          case 3:
            deepEqual(all, { foo: '8', bar: '9' });
            break;
        }
      }
    }
  };

  transitionTo(router, '/index');
  count = 1;
  transitionTo(router, '/index?foo=5');
  count = 2;
  transitionTo(router, '/index?foo=5&bar=6');
  count = 3;
  transitionTo(router, '/index?foo=8&bar=9');
});

test("failing to consume QPs in finalize event tells the router it no longer has those params", function() {
  expect(2);

  handlers.index = {
    setup: function() {
      ok(true, "setup was entered");
    }
  };

  transitionTo(router, '/index?foo=8&bar=9');

  deepEqual(router.state.queryParams, {});
});

test("consuming QPs in finalize event tells the router those params are active", function() {
  expect(1);

  handlers.index = {
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.push({ key: 'foo', value: params.foo });
      }
    }
  };

  transitionTo(router, '/index?foo=8&bar=9');
  deepEqual(router.state.queryParams, { foo: '8' });
});

test("can hide query params from URL if they're marked as visible=false in finalizeQueryParamChange", function() {
  expect(2);

  handlers.index = {
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.push({ key: 'foo', value: params.foo, visible: false });
        finalParams.push({ key: 'bar', value: params.bar });
      }
    }
  };

  expectedUrl = '/index?bar=9';
  transitionTo(router, '/index?foo=8&bar=9');
  deepEqual(router.state.queryParams, { foo: '8', bar: '9' });
});

test("transitionTo() works with single query param arg", function() {
  expect(2);

  handlers.index = {
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.push({ key: 'foo', value: params.foo });
        finalParams.push({ key: 'bar', value: params.bar });
      }
    }
  };

  transitionTo(router, '/index?bar=9&foo=8');
  deepEqual(router.state.queryParams, { foo: '8', bar: '9' });

  expectedUrl = '/index?bar=9&foo=123';
  transitionTo(router, { queryParams: { foo: '123' }});
});

test("handleURL will NOT follow up with a replace URL if query params are already in sync", function() {
  expect(0);

  router.replaceURL = function(url) {
    ok(false, "query params are in sync, this replaceURL shouldn't happen: " + url);
  };

  router.handleURL('/index');
});

test("model hook receives queryParams", function() {

  expect(1);

  handlers.index = {
    model: function(params, t) {
      deepEqual(params, { queryParams: { foo: '5' } });
    }
  };

  transitionTo(router, '/index?foo=5');
});

test("can cause full transition by calling refresh within queryParamsDidChange", function() {

  expect(5);

  var modelCount = 0;
  handlers.index = {
    model: function(params, t) {
      ++modelCount;
      if (modelCount === 1) {
        deepEqual(params, { queryParams: { foo: '5' } });
      } else if (modelCount === 2) {
        deepEqual(params, { queryParams: { foo: '6' } });
      }
    },
    events: {
      queryParamsDidChange: function() {
        router.refresh(this);
      }
    }
  };

  equal(modelCount, 0);
  transitionTo(router, '/index?foo=5');
  equal(modelCount, 1);
  transitionTo(router, '/index?foo=6');
  equal(modelCount, 2);
});

test("can retry a query-params refresh", function() {

  map(function(match) {
    match("/index").to("index");
    match("/login").to("login");
  });

  expect(8);

  var redirect = false;
  var indexTransition;
  handlers.index = {
    model: function(params, transition) {
      if (redirect) {
        indexTransition = transition;
        router.transitionTo('login');
      }
    },
    setup: function() {
      ok(true, "index#setup");
    },
    events: {
      queryParamsDidChange: function() {
        ok(true, "index#queryParamsDidChange");
        redirect = true;
        router.refresh(this);
      },
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.foo = params.foo;
        finalParams.push({ key: 'foo', value: params.foo });
      }
    }
  };

  handlers.login = {
    setup: function() {
      ok(true, "login#setup");
    }
  };

  expectedUrl = '/index?foo=abc';
  transitionTo(router, '/index?foo=abc');
  expectedUrl = '/login';
  transitionTo(router, '/index?foo=def');
  flushBackburner();
  redirect = false;
  ok(indexTransition, "index transition was saved");
  indexTransition.retry();
  expectedUrl = '/index?foo=def';
});

test("tests whether query params to transitionTo are considered active", function() {
  expect(6);

  handlers.index = {
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.push({ key: 'foo', value: params.foo });
        finalParams.push({ key: 'bar', value: params.bar });
      }
    }
  };

  transitionTo(router, '/index?foo=8&bar=9');
  deepEqual(router.state.queryParams, { foo: '8', bar: '9' });
  ok(router.isActive('index', { queryParams: {foo: '8', bar: '9' }}), "The index handler is active");
  ok(router.isActive('index', { queryParams: {foo: 8, bar: 9 }}), "Works when property is number");
  ok(!router.isActive('index', { queryParams: {foo: '9'}}), "Only supply one changed query param");
  ok(!router.isActive('index', { queryParams: {foo: '8', bar: '10', baz: '11' }}), "A new query param was added");
  ok(!router.isActive('index', { queryParams: {foo: '8', bar: '11', }}), "A query param changed");
});

test("tests whether array query params to transitionTo are considered active", function() {
  expect(7);

  handlers.index = {
    events: {
      finalizeQueryParamChange: function(params, finalParams) {
        finalParams.push({ key: 'foo', value: params.foo });
      }
    }
  };

  transitionTo(router, '/index?foo[]=1&foo[]=2');
  deepEqual(router.state.queryParams, { foo: ['1', '2']});
  ok(router.isActive('index', { queryParams: {foo: ['1', '2'] }}), "The index handler is active");
  ok(router.isActive('index', { queryParams: {foo: [1, 2] }}), "Works when array has numeric elements");
  ok(!router.isActive('index', { queryParams: {foo: ['2', '1']}}), "Change order");
  ok(!router.isActive('index', { queryParams: {foo: ['1', '2', '3']}}), "Change Length");
  ok(!router.isActive('index', { queryParams: {foo: ['3', '4']}}), "Change Content");
  ok(!router.isActive('index', { queryParams: {foo: []}}), "Empty Array");
});
