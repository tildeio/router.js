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
      match("/parent").to("parent", function(match) {
        match("/").to("parentIndex");
        match("/child").to("parentChild");
      });
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

function consumeAllFinalQueryParams(params, finalParams) {
  for (var key in params) {
    var value = params[key];
    delete params[key];
    finalParams.push({ key: key, value: value });
  }
  return true;
}

test("a change in query params fires a queryParamsDidChange event", function() {
  expect(7);

  var count = 0;
  handlers.index = {
    setup: function() {
      equal(count, 0, "setup should be called exactly once since we're only changing query params after the first transition");
    },
    events: {
      finalizeQueryParamChange: consumeAllFinalQueryParams,

      queryParamsDidChange: function(changed, all) {
        switch (count) {
          case 0:
            ok(false, "shouldn't fire on first trans");
            break;
          case 1:
            deepEqual(changed, { foo: '5' });
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

test("transitioning between routes fires a queryParamsDidChange event", function() {
  expect(8);
  var count = 0;
  handlers.parent = {
    events: {
      finalizeQueryParamChange: consumeAllFinalQueryParams,
      queryParamsDidChange: function(changed, all) {
        switch (count) {
          case 0:
            ok(false, "shouldn't fire on first trans");
            break;
          case 1:
            deepEqual(changed, { foo: '5' });
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
          case 4:
            deepEqual(changed, { foo: '10', bar: '11'});
            deepEqual(all,     { foo: '10', bar: '11'});
        }
      }
    }
  };

  handlers.parentChild = {
    events: {
      finalizeQueryParamChange: function() {
        // Do nothing since this handler isn't consuming the QPs
        return true;
      },

      queryParamsDidChange: function(changed, all) {
        return true;
      }
    }
  };
  transitionTo(router, '/parent/child');
  count = 1;
  transitionTo(router, '/parent/child?foo=5');
  count = 2;
  transitionTo(router, '/parent/child?foo=5&bar=6');
  count = 3;
  transitionTo(router, '/parent/child?foo=8&bar=9');
  count = 4;
  transitionTo(router, '/parent?foo=10&bar=11');

});

test("a handler can opt into a full-on transition by calling refresh", function() {
  expect(3);

  var count = 0;
  handlers.index = {
    model: function() {
      switch (count) {
        case 0:
          ok(true, "model called in initial transition");
          break;
        case 1:
          ok(true, "model called during refresh");
          break;
        case 2:
          ok(true, "model called during refresh w 2 QPs");
          break;
        default:
          ok(false, "shouldn't have been called for " + count);
      }
    },
    events: {
      queryParamsDidChange: function(changed, all) {
        if (count === 0) {
          ok(false, "shouldn't fire on first trans");
        } else {
          router.refresh(this);
        }
      },
      finalizeQueryParamChange: consumeAllFinalQueryParams
    }
  };

  transitionTo(router, '/index');
  count = 1;
  transitionTo(router, '/index?foo=5');
  count = 2;
  transitionTo(router, '/index?foo=5&wat=lol');
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

  expectedUrl = '/index?foo=123';
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
  var causeRedirect = false;

  map(function(match) {
    match("/index").to("index");
    match("/login").to("login");
  });

  expect(11);

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
        redirect = causeRedirect;
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
  causeRedirect = true;
  expectedUrl = '/login';
  transitionTo(router, '/index?foo=def');
  flushBackburner();
  causeRedirect = false;
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
