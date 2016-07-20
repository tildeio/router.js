import { module, stubbedHandlerInfoFactory } from "tests/test_helpers";
import TransitionIntent from 'router/transition-intent';
import URLTransitionIntent from 'router/transition-intent/url-transition-intent';
import NamedTransitionIntent from 'router/transition-intent/named-transition-intent';
import TransitionState from 'router/transition-state';

import ResolvedHandlerInfo from 'router/handler-info/resolved-handler-info';
import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';
import { Promise } from 'rsvp';

var handlers, recognizer;

var scenarios = [
  {
    name: 'Sync Get Handler',
    async: false,
    getHandler: function(name) {
      return handlers[name] || (handlers[name] = {});
    },
    getSerializer: function() {}
  },
  {
    name: 'Async Get Handler',
    async: true,
    getHandler: function(name) {
      return Promise.resolve(handlers[name] || (handlers[name] = {}));
    },
    getSerializer: function() {}
  }
];

scenarios.forEach(function(scenario) {

// Asserts that a handler from a handlerInfo equals an expected valued.
// Returns a promise during async scenarios to wait until the handler is ready.
function assertHandlerEquals(handlerInfo, expected) {
  if (!scenario.async) {
    return equal(handlerInfo.handler, expected);
  } else {
    equal(handlerInfo.handler, undefined);
    return handlerInfo.handlerPromise.then(function(handler) {
      equal(handler, expected);
    });
  }
}

// TODO: remove repetition, DRY in to test_helpers.
module("TransitionIntent (" + scenario.name + ")", {
  setup: function() {
    handlers = {};

    handlers.foo = {};
    handlers.bar = {};
    handlers.articles = {};
    handlers.comments = {};

    recognizer = {
      handlersFor: function(name) {
        if (name === 'comments') {
          return [
            {
              handler: 'articles',
              names: ['article_id']
            },
            {
              handler: 'comments',
              names: ['comment_id']
            }
          ];
        }
      },
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
        } else if (url === '/articles/123/comments/456') {
          return [
            {
              handler: "articles",
              isDynamic: true,
              params: { article_id: '123' }
            },
            {
              handler: "comments",
              isDynamic: true,
              params: { comment_id: '456' }
            }
          ];
        }
      }
    };
  }
});

test("URLTransitionIntent can be applied to an empty state", function() {
  var state = new TransitionState();
  var intent = new URLTransitionIntent({ url: '/foo/bar' });
  var newState = intent.applyToState(state, recognizer, scenario.getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(!handlerInfos[0].isResolved, "generated state consists of unresolved handler info, 1");
  ok(!handlerInfos[1].isResolved, "generated state consists of unresolved handler info, 2");
  Promise.all([
    assertHandlerEquals(handlerInfos[0], handlers.foo),
    assertHandlerEquals(handlerInfos[1], handlers.bar)
  ]);
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
  var newState = intent.applyToState(state, recognizer, scenario.getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo, "The starting foo handlerInfo wasn't overridden because the new one wasn't any different");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  assertHandlerEquals(handlerInfos[1], handlers.bar);
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
  var newState = intent.applyToState(state, recognizer, scenario.getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo, "The starting foo resolved handlerInfo wasn't overridden because the new one wasn't any different");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  assertHandlerEquals(handlerInfos[1], handlers.bar);
});

test("URLTransitionIntent applied to an already-resolved handlerInfo (non-empty params)", function() {
  var state = new TransitionState();

  var article = {};

  var startingHandlerInfo = new ResolvedHandlerInfo({
    name: 'articles',
    handler: {},
    context: article,
    params: { article_id: 'some-other-id' }
  });

  state.handlerInfos = [ startingHandlerInfo ];

  var intent = new URLTransitionIntent({ url: '/articles/123/comments/456', });
  var newState = intent.applyToState(state, recognizer, scenario.getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(handlerInfos[0] !== startingHandlerInfo, "The starting foo resolved handlerInfo was overridden because the new had different params");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  assertHandlerEquals(handlerInfos[1], handlers.comments);
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
  var newState = intent.applyToState(state, recognizer, scenario.getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(handlerInfos[0] !== startingHandlerInfo, "The starting foo resolved handlerInfo gets overridden because the new one has a different name");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  assertHandlerEquals(handlerInfos[1], handlers.bar);
});

test("NamedTransitionIntent applied to an already-resolved handlerInfo (non-empty params)", function() {
  var state = new TransitionState();

  var article = {};
  var comment = {};

  var startingHandlerInfo = new ResolvedHandlerInfo({
    name: 'articles',
    handler: {},
    context: article,
    params: { article_id: 'some-other-id' }
  });

  state.handlerInfos = [ startingHandlerInfo ];

  var intent = new NamedTransitionIntent({
    name: 'comments',
    contexts: [ article, comment ]
  });

  var newState = intent.applyToState(state, recognizer, scenario.getHandler, null, scenario.getSerializer);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo);
  equal(handlerInfos[0].context, article);
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByObject, "generated state consists of UnresolvedHandlerInfoByObject, 2");
  equal(handlerInfos[1].context, comment);
  assertHandlerEquals(handlerInfos[1], handlers.comments);
});

});
