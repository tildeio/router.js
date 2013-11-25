
var TransitionIntent = Router.TransitionIntent;
var TransitionState  = Router.TransitionState;

var ResolvedHandlerInfo = Router.ResolvedHandlerInfo;
var HandlerInfo = Router.HandlerInfo;
var UnresolvedHandlerInfoByObject = Router.UnresolvedHandlerInfoByObject;
var UnresolvedHandlerInfoByParam = Router.UnresolvedHandlerInfoByParam;

var URLTransitionIntent = Router.URLTransitionIntent;
var NamedTransitionIntent = Router.NamedTransitionIntent;

var bb = new backburner.Backburner(['promises']);

function customAsync(callback, promise) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

function noop() { }

var handlers, recognizer;

// TODO: remove repetition, DRY in to test_helpers.
module("URLTransitionIntent", {
  setup: function() {
    handlers = {};

    handlers.foo = {};
    handlers.bar = {};

    recognizer = {
      recognize: function(url) {
        if (url === '/foo/bar') {
          return [
            {
              handler: "foo",
              isDynamic: false,
              params: {}
            },
            {
              handler: "bar",
              isDynamic: false,
              params: {}
            }
          ];
        }
      }
    };

    RSVP.configure('async', customAsync);
    bb.begin();
  },

  teardown: function() {
    bb.end();
  }
});

function getHandler(name) {
  if (handlers[name]) {
    return handlers[name];
  } else {
    return handlers[name] = {};
  }
}

test("URLTransitionIntent can be applied to an empty state", function() {

  var state = new TransitionState();
  var intent = new URLTransitionIntent({ url: '/foo/bar' });
  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(handlerInfos[0] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 1");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  equal(handlerInfos[0].handler, handlers.foo);
  equal(handlerInfos[1].handler, handlers.bar);
});

test("URLTransitionIntent applied to single unresolved URL handlerInfo", function() {

  var state = new TransitionState();

  var startingHandlerInfo = new UnresolvedHandlerInfoByParam({
    name: 'foo',
    handler: handlers.foo,
    params: {}
  });

  // This single unresolved handler info will be preserved
  // in the new array of handlerInfos.
  // Reason: if it were resolved, we wouldn't want to replace it.
  // So we only want to replace if it's actually known to be
  // different.
  state.handlerInfos = [ startingHandlerInfo ];

  var intent = new URLTransitionIntent({ url: '/foo/bar', });
  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo, "The starting foo handlerInfo wasn't overridden because the new one wasn't any different");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  equal(handlerInfos[1].handler, handlers.bar);
});

test("URLTransitionIntent applied to an already-resolved handlerInfo", function() {

  var state = new TransitionState();

  var startingHandlerInfo = new ResolvedHandlerInfo({
    name: 'foo',
    handler: handlers.foo,
    context: {},
    params: {}
  });

  state.handlerInfos = [ startingHandlerInfo ];

  var intent = new URLTransitionIntent({ url: '/foo/bar', });
  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo, "The starting foo resolved handlerInfo wasn't overridden because the new one wasn't any different");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  equal(handlerInfos[1].handler, handlers.bar);
});


test("URLTransitionIntent applied to an already-resolved handlerInfo of different route", function() {

  var state = new TransitionState();

  var startingHandlerInfo = new ResolvedHandlerInfo({
    name: 'alex',
    handler: handlers.foo,
    context: {},
    params: {}
  });

  state.handlerInfos = [ startingHandlerInfo ];

  var intent = new URLTransitionIntent({ url: '/foo/bar', });
  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(handlerInfos[0] !== startingHandlerInfo, "The starting foo resolved handlerInfo gets overridden because the new one has a different name");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  equal(handlerInfos[1].handler, handlers.bar);
});
