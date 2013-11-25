//var TransitionState = Router.TransitionState;
var ResolvedHandlerInfo = Router.ResolvedHandlerInfo;
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



/*
test("UnresolvedHandlerInfoByObject runs beforeModel hook", function() {

  var handler = {
  };

  var context = {};

  var handlerInfo = new UnresolvedHandlerInfoByObject({
    name: 'foo',
    handler: handler,
    context: context
  });

  //name: null,
  //handler: null,
  //params: null,
  //context: null,
  //resolve: null

});

*/
