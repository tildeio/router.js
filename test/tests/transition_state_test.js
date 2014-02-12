import { module, flushBackburner } from "tests/test_helpers";
import Router from "router";
import TransitionState from 'router/transition-state';
import { UnresolvedHandlerInfoByObject, UnresolvedHandlerInfoByParam } from 'router/handler-info';
import { resolve, configure, reject } from "rsvp";

module("TransitionState");

test("it starts off with default state", function() {
  var state = new TransitionState();
  deepEqual(state.handlerInfos, [], "it has an array of handlerInfos");
});

var async = Router.prototype.async;

test("#resolve delegates to handleInfo objects' resolve()", function() {

  expect(8);

  var state = new TransitionState();

  var counter = 0;

  var resolvedHandlerInfos = [{}, {}];

  state.handlerInfos = [
    {
      resolve: function(_, shouldContinue) {
        ++counter;
        equal(counter, 1);
        shouldContinue();
        return resolve(resolvedHandlerInfos[0]);
      }
    },
    {
      resolve: function(_, shouldContinue) {
        ++counter;
        equal(counter, 2);
        shouldContinue();
        return resolve(resolvedHandlerInfos[1]);
      }
    },
  ];

  function keepGoing() {
    ok(true, "continuation function was called");
  }

  state.resolve(async, keepGoing).then(function(result) {
    ok(!result.error);
    deepEqual(result.state.handlerInfos, resolvedHandlerInfos);
  });
});

test("State resolution can be halted", function() {

  expect(2);

  var state = new TransitionState();

  state.handlerInfos = [
    {
      resolve: function(_, shouldContinue) {
        return shouldContinue();
      }
    },
    {
      resolve: function() {
        ok(false, "I should not be entered because we threw an error in shouldContinue");
      }
    },
  ];

  function keepGoing() {
    return reject("NOPE");
  }

  state.resolve(async, keepGoing).catch(function(reason) {
    equal(reason.error, "NOPE");
    ok(reason.wasAborted, "state resolution was correctly marked as aborted");
  });

  flushBackburner();
});


test("Integration w/ HandlerInfos", function() {

  expect(5);

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
          equal(payload, transition);
          equal(params.foo_id, '123', "foo#model received expected params");
          return resolve(fooModel);
        }
      }
    }),
    new UnresolvedHandlerInfoByObject({
      name: 'bar',
      names: ['bar_id'],
      context: resolve(barModel),
      handler: {}
    })
  ];

  function noop() {}

  state.resolve(async, noop, transition).then(function(result) {
    var models = result.state.handlerInfos.map(function(handlerInfo) {
      return handlerInfo.context;
    });

    ok(!result.error);
    equal(models[0], fooModel);
    equal(models[1], barModel);
  });
});



