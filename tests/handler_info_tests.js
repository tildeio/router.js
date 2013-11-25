//var TransitionState = Router.TransitionState;
var ResolvedHandlerInfo = Router.ResolvedHandlerInfo;
var HandlerInfo = Router.HandlerInfo;
var UnresolvedHandlerInfoByObject = Router.UnresolvedHandlerInfoByObject;
var UnresolvedHandlerInfoByParam = Router.UnresolvedHandlerInfoByParam;

var bb = new backburner.Backburner(['promises']);

function customAsync(callback, promise) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

function noop() {}

module("HandlerInfo", {
  setup: function() {
    RSVP.configure('async', customAsync);
    bb.begin();
  },

  teardown: function() {
    bb.end();
  }
});

test("ResolvedHandlerInfos resolve to themselves", function() {
  var handlerInfo = new ResolvedHandlerInfo();
  handlerInfo.resolve().then(function(resolvedHandlerInfo) {
    equal(handlerInfo, resolvedHandlerInfo);
  });
});

test("UnresolvedHandlerInfoByParam defaults params to {}", function() {
  var handlerInfo = new UnresolvedHandlerInfoByParam();
  deepEqual(handlerInfo.params, {});

  var handlerInfo2 = new UnresolvedHandlerInfoByParam({ params: { foo: 5 } });
  deepEqual(handlerInfo2.params, { foo: 5 });
});

test("HandlerInfo can be aborted mid-resolve", function() {

  expect(2);

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: {}
  });

  function abortResolve() {
    ok(true, "abort was called");
    return RSVP.reject("LOL");
  }

  handlerInfo.resolve(abortResolve, {}).fail(function(error) {
    equal(error, "LOL");
  });
});

test("HandlerInfo#resolve resolves with a ResolvedHandlerInfo", function() {

  expect(1);

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: {},
    getModel: noop
  });

  handlerInfo.resolve(noop, {}).then(function(resolvedHandlerInfo) {
    return resolvedHandlerInfo.resolve().then(function(previouslyResolvedHandlerInfo) {
      equal(previouslyResolvedHandlerInfo, resolvedHandlerInfo);
    });
  });
});

test("HandlerInfo#resolve runs beforeModel hook on handler", function() {

  expect(1);

  var transition = {};

  var handler = {
    beforeModel: function(payload) {
      equal(transition, payload, "beforeModel was called with the payload we passed to resolve()");
    }
  };

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: handler
  });

  handlerInfo.resolve(noop, transition);
});

test("HandlerInfo#resolve runs getModel hook", function() {

  expect(1);

  var transition = {};

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: {},
    getModel: function(payload) {
      equal(payload, transition);
    }
  });

  handlerInfo.resolve(noop, transition);
});

test("HandlerInfo#resolve runs afterModel hook on handler", function() {

  expect(3);

  var transition = {};
  var model = {};

  var handler = {
    afterModel: function(resolvedModel, payload) {
      equal(resolvedModel, model, "afterModel receives the value resolved by model");
      equal(payload, transition);
      return RSVP.resolve(123); // 123 should get ignored
    }
  };

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: handler,
    getModel: function() {
      return RSVP.resolve(model);
    }
  });

  handlerInfo.resolve(noop, transition).then(function(resolvedHandlerInfo) {
    equal(resolvedHandlerInfo.context, model, "HandlerInfo resolved with correct model");
  });
});

test("serialize gets called when resolving param-less HandlerInfos", function() {

  expect(4);

  var count = 0;

  var model = {};

  var handlerInfo = new HandlerInfo({
    name: 'foo',
    handler: {},
    getModel: function() {
      ok(true, 'model was called');
      return RSVP.resolve(model);
    },
    params: { id: 123 },
    serialize: function(resolvedContext) {
      count++;
      equal(count, 1, "serialize only gets called once");
      equal(resolvedContext, model, "serialize gets passed the resolved model");
    }
  });

  handlerInfo.resolve(noop, {});

  flushBackburner();

  delete handlerInfo.params;
  handlerInfo.resolve(noop, {});
});





