import { module } from "tests/test_helpers";
import TransitionIntent from 'router/transition-intent';
import URLTransitionIntent from 'router/transition-intent/url-transition-intent';
import NamedTransitionIntent from 'router/transition-intent/named-transition-intent';
import TransitionState from 'router/transition-state';
import { HandlerInfo, ResolvedHandlerInfo, UnresolvedHandlerInfoByObject, UnresolvedHandlerInfoByParam } from 'router/handler-info';

var handlers, recognizer;

// TODO: remove repetition, DRY in to test_helpers.
module("TransitionIntent", {
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
  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  ok(handlerInfos[0] !== startingHandlerInfo, "The starting foo resolved handlerInfo was overridden because the new had different params");
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByParam, "generated state consists of UnresolvedHandlerInfoByParam, 2");
  equal(handlerInfos[1].handler, handlers.comments);
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

  var newState = intent.applyToState(state, recognizer, getHandler);
  var handlerInfos = newState.handlerInfos;

  equal(handlerInfos.length, 2);
  equal(handlerInfos[0], startingHandlerInfo);
  equal(handlerInfos[0].context, article);
  ok(handlerInfos[1] instanceof UnresolvedHandlerInfoByObject, "generated state consists of UnresolvedHandlerInfoByObject, 2");
  equal(handlerInfos[1].handler, handlers.comments);
  equal(handlerInfos[1].context, comment);
});
