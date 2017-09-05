import { Backburner } from "backburner";
import { resolve, configure } from "rsvp";
import { oCreate } from 'router/utils';
import TransitionAbortedError from 'router/transition-aborted-error';

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

var test = QUnit.test;

function module(name, options) {
  options = options || {};
  QUnit.module(name, {
    setup: function() {
      configure('async', customAsync);
      bb.begin();

      if (options.setup) {
        options.setup.apply(this, arguments);
      }
    },
    teardown: function() {
      bb.end();

      if (options.teardown) {
        options.teardown.apply(this, arguments);
      }
    }
  });
}

function assertAbort(assert) {
  return function _assertAbort(e) {
    assert.ok(e instanceof TransitionAbortedError, 'transition was redirected/aborted');
  };
}

// Helper method that performs a transition and flushes
// the backburner queue. Helpful for when you want to write
// tests that avoid .then callbacks.
function transitionTo(router) {
  var result = router.transitionTo.apply(router, slice.call(arguments, 1));
  flushBackburner();
  return result;
}

function transitionToWithAbort(assert, router) {
  var args = slice.call(arguments, 2);
  router.transitionTo.apply(router, args).then(shouldNotHappen, assertAbort(assert));
  flushBackburner();
}

function handleURL(router) {
  var result = router.handleURL.apply(router, slice.call(arguments, 1));
  flushBackburner();
  return result;
}


function shouldNotHappen(assert, _message) {
  var message = _message || "this .then handler should not be called";
  return function _shouldNotHappen(error) {
    console.error(error.stack); // jshint ignore:line
    assert.ok(false, message);
  };
}

function stubbedHandlerInfoFactory(name, props) {
  var obj = oCreate(props);
  obj._handlerInfoType = name;
  return obj;
}

module("backburner sanity test");

test("backburnerized testing works as expected", function(assert) {
  assert.expect(1);
  resolve("hello").then(function(word) {
    assert.equal(word, "hello", "backburner flush in teardown resolved this promise");
  });
});

export {
  module,
  test,
  flushBackburner,
  handleURL,
  transitionTo,
  transitionToWithAbort,
  shouldNotHappen,
  stubbedHandlerInfoFactory,
  assertAbort
};
