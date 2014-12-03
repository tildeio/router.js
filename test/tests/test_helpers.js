import { Backburner } from "backburner";
import { resolve, configure, reject, Promise } from "rsvp";
import { oCreate } from 'router/utils';

var slice = Array.prototype.slice;

QUnit.config.testTimeout = 1000;

var bb = new Backburner(['promises']);
function customAsync(callback, promise) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

function module(name, options) {
  options = options || {};
  QUnit.module(name, {
    setup: function() {
      configure('async', customAsync);
      bb.begin();

      if (options.setup) {
        options.setup();
      }
    },
    teardown: function() {
      bb.end();

      if (options.teardown) {
        options.teardown();
      }
    }
  });
}


// Helper method that performs a transition and flushes
// the backburner queue. Helpful for when you want to write
// tests that avoid .then callbacks.
function transitionTo(router) {
  var result = router.transitionTo.apply(router, slice.call(arguments, 1));
  flushBackburner();
  return result;
}

function transitionToWithAbort(router) {
  var args = slice.call(arguments, 1);
  router.transitionTo.apply(router, args).then(shouldNotHappen, function(reason) {
    equal(reason.name, "TransitionAborted", "transition was redirected/aborted");
  });
  flushBackburner();
}

function shouldNotHappen(error) {
  console.error(error.stack);
  ok(false, "this .then handler should not be called");
}

function shouldBeTransition (object) {
  ok(object.toString().match(/Transition \(sequence \d+\)/), "Object should be transition");
}


function stubbedHandlerInfoFactory(name, props) {
  var obj = oCreate(props);
  obj._handlerInfoType = name;
  return obj;
}

module("backburner sanity test");

test("backburnerized testing works as expected", function() {
  expect(1);
  resolve("hello").then(function(word) {
    equal(word, "hello", "backburner flush in teardown resolved this promise");
  });
});

export { module, flushBackburner, transitionTo, transitionToWithAbort, shouldNotHappen, shouldBeTransition, stubbedHandlerInfoFactory };
