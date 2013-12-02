import { Backburner } from "backburner";
import { resolve, configure, reject, Promise } from "rsvp";

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
};

module("backburner sanity test");

test("backburnerized testing works as expected", function() {
  expect(1);
  resolve("hello").then(function(word) {
    equal(word, "hello", "backburner flush in teardown resolved this promise");
  });
});

export { module, flushBackburner };
