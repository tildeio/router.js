var TransitionState = Router.TransitionState;

var bb = new backburner.Backburner(['promises']);

function customAsync(callback, promise) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

module("TransitionState", {

  setup: function() {
    RSVP.configure('async', customAsync);
    bb.begin();
  },

  teardown: function() {
    bb.end();
  }
});

// handlerInfo = {
//  * `{Boolean} isDynamic`: whether a handler has any dynamic segments
//  * `{String} name`: the name of a handler
//  * `{Object} handler`: a handler object
//  * `{Object} context`: the active context for the handler
//  * `{Object} queryParams`: them shitz
// }

/* handlersFor(routeName) Format:
 * - This gets information about a route registered in route-recognizer
 * - This result then gets decorated with queryParams
 *
 * handler: "nestedChild"
 * names: Array[0] // e.g. ['ass_id']
 * queryParams: Array[1] // e.g. ['childParam']
 */

/* Generate(): returns a recogHandlerInfo for a URL.
 * This gives us params for a URL.
 *
 *
    handler: "index"
    isDynamic: false (true if params not empty!)
    params:
      foo: 'asd'
      butt: 'nork'
    queryParams:
      sort: "name"
 */



test("it starts off with default state", function() {
  var state = new TransitionState();
  deepEqual(state.handlerInfos, [], "it has an array of handlerInfos");
  deepEqual(state.params, {}, "it has a hash of params");
  equal(state.resolveIndex, 0, "it has a resolveIndex of zero");
});

test("new TransitionState clones state of passed in TransitionState", function() {
  var first = new TransitionState();
  first.handlerInfos = [ { foo: 123 }, { bar: 456 } ];

  var second = new TransitionState(first);

  ok(first.handlerInfos !== second.handlerInfos,     "separate handlerInfos arrays...");
  deepEqual(first.handlerInfos, second.handlerInfos, "...with the same content");
});


test("#resolve delegates to handleInfo objects' resolve()", function() {

  expect(6);

  var state = new TransitionState();

  var counter = 0;

  var resolvedHandlerInfos = [{}, {}];

  state.handlerInfos = [
    {
      resolve: function(shouldContinue) {
        ++counter;
        equal(counter, 1);
        shouldContinue();
        return RSVP.resolve(resolvedHandlerInfos[0]);
      }
    },
    {
      resolve: function(shouldContinue) {
        ++counter;
        equal(counter, 2);
        shouldContinue();
        return RSVP.resolve(resolvedHandlerInfos[1]);
      }
    },
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
    },
  ];

  function keepGoing() {
    return RSVP.reject("NOPE");
  }

  state.resolve(keepGoing).fail(function(reason) {
    equal(reason.error, "NOPE");
    ok(reason.wasAborted, "state resolution was correctly marked as aborted");
  });

  flushBackburner();
});


