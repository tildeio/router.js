import { module, flushBackburner, stubbedHandlerInfoFactory } from "tests/test_helpers";
import Router from "router";
import TransitionState from 'router/transition-state';

import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';

import { resolve, configure, reject } from "rsvp";

module("TransitionState");

test("it starts off with default state", function() {
  var state = new TransitionState();
  deepEqual(state.handlerInfos, [], "it has an array of handlerInfos");
});

test("#resolve delegates to handleInfo objects' resolve()", function() {

  expect(8);

  var state = new TransitionState();

  var counter = 0;

  var resolvedHandlerInfos = [{}, {}];

  state.handlerInfos = [
    {
      resolve: function(shouldContinue) {
        ++counter;
        equal(counter, 1);
        shouldContinue();
        return resolve(resolvedHandlerInfos[0]);
      }
    },
    {
      resolve: function(shouldContinue) {
        ++counter;
        equal(counter, 2);
        shouldContinue();
        return resolve(resolvedHandlerInfos[1]);
      }
    }
  ];

  function keepGoing() {
    ok(true, "continuation function was called");
  }

  state.resolve(keepGoing).then(function(result) {
    ok(!result.error);
    deepEqual(result.state.handlerInfos, resolvedHandlerInfos);
  });
});

test("State resolution can be halted", function() {

  expect(2);

  var state = new TransitionState();

  state.handlerInfos = [
    {
      resolve: function(shouldContinue) {
        return shouldContinue();
      }
    },
    {
      resolve: function() {
        ok(false, "I should not be entered because we threw an error in shouldContinue");
      }
    }
  ];

  function keepGoing() {
    return reject("NOPE");
  }

  state.resolve(keepGoing).catch(function(reason) {
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
      },
      factory: stubbedHandlerInfoFactory
    }),
    new UnresolvedHandlerInfoByObject({
      name: 'bar',
      names: ['bar_id'],
      context: resolve(barModel),
      handler: {},
      factory: stubbedHandlerInfoFactory
    })
  ];

  function noop() {}

  state.resolve(noop, transition).then(function(result) {
    var models = [];
    for (var i=0;i<result.state.handlerInfos.length;i++){
      models.push(result.state.handlerInfos[i].context);
    }

    ok(!result.error);
    equal(models[0], fooModel);
    equal(models[1], barModel);
  }).catch(function(error){
    ok(false, "Caught error: "+error);
  });
});



