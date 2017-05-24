(function(globals, RSVP, RouteRecognizer) {
var define, requireModule, require, requirejs;

(function() {
  var registry = {}, seen = {};

  define = function(name, deps, callback) {
    registry[name] = { deps: deps, callback: callback };
  };

  requirejs = require = requireModule = function(name) {

    if (seen[name]) { return seen[name]; }
    seen[name] = {};

    if (!registry[name]) {
      throw new Error("Could not find module " + name);
    }

    var mod = registry[name],
        deps = mod.deps,
        callback = mod.callback,
        reified = [],
        exports;

    for (var i=0, l=deps.length; i<l; i++) {
      if (deps[i] === 'exports') {
        reified.push(exports = {});
      } else {
        reified.push(requireModule(resolve(deps[i])));
      }
    }

    var value = callback.apply(this, reified);
    return seen[name] = exports || value;

    function resolve(child) {
      if (child.charAt(0) !== '.') { return child; }
      var parts = child.split("/");
      var parentBase = name.split("/").slice(0, -1);

      for (var i=0, l=parts.length; i<l; i++) {
        var part = parts[i];

        if (part === '..') { parentBase.pop(); }
        else if (part === '.') { continue; }
        else { parentBase.push(part); }
      }

      return parentBase.join("/");
    }
  };
})();

define("router/handler-info",
  ["./utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var bind = __dependency1__.bind;
    var merge = __dependency1__.merge;
    var promiseLabel = __dependency1__.promiseLabel;
    var applyHook = __dependency1__.applyHook;
    var isPromise = __dependency1__.isPromise;
    var Promise = __dependency2__.Promise;

    var DEFAULT_HANDLER = Object.freeze({});

    function HandlerInfo(_props) {
      var props = _props || {};

      // Set a default handler to ensure consistent object shape
      this._handler = DEFAULT_HANDLER;

      if (props.handler) {
        var name = props.name;

        // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
        this.handlerPromise = Promise.resolve(props.handler);

        // Wait until the 'handler' property has been updated when chaining to a handler
        // that is a promise
        if (isPromise(props.handler)) {
          this.handlerPromise = this.handlerPromise.then(bind(this, this.updateHandler));
          props.handler = undefined;
        } else if (props.handler) {
          // Store the name of the handler on the handler for easy checks later
          props.handler._handlerName = name;
        }
      }

      merge(this, props);
      this.initialize(props);
    }

    HandlerInfo.prototype = {
      name: null,

      getHandler: function() {},

      fetchHandler: function() {
        var handler = this.getHandler(this.name);

        // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
        this.handlerPromise = Promise.resolve(handler);

        // Wait until the 'handler' property has been updated when chaining to a handler
        // that is a promise
        if (isPromise(handler)) {
          this.handlerPromise = this.handlerPromise.then(bind(this, this.updateHandler));
        } else if (handler) {
          // Store the name of the handler on the handler for easy checks later
          handler._handlerName = this.name;
          return this.handler = handler;
        }

        return this.handler = undefined;
      },

      _handlerPromise: undefined,

      params: null,
      context: null,

      // Injected by the handler info factory.
      factory: null,

      initialize: function() {},

      log: function(payload, message) {
        if (payload.log) {
          payload.log(this.name + ': ' + message);
        }
      },

      promiseLabel: function(label) {
        return promiseLabel("'" + this.name + "' " + label);
      },

      getUnresolved: function() {
        return this;
      },

      serialize: function() {
        return this.params || {};
      },

      updateHandler: function(handler) {
        // Store the name of the handler on the handler for easy checks later
        handler._handlerName = this.name;
        return this.handler = handler;
      },

      resolve: function(shouldContinue, payload) {
        var checkForAbort  = bind(this, this.checkForAbort,      shouldContinue),
            beforeModel    = bind(this, this.runBeforeModelHook, payload),
            model          = bind(this, this.getModel,           payload),
            afterModel     = bind(this, this.runAfterModelHook,  payload),
            becomeResolved = bind(this, this.becomeResolved,     payload),
            self = this;

        return Promise.resolve(this.handlerPromise, this.promiseLabel("Start handler"))
                .then(function(handler) {
                  // We nest this chain in case the handlerPromise has an error so that
                  // we don't have to bubble it through every step
                  return Promise.resolve(handler)
                    .then(checkForAbort, null, self.promiseLabel("Check for abort"))
                    .then(beforeModel, null, self.promiseLabel("Before model"))
                    .then(checkForAbort, null, self.promiseLabel("Check if aborted during 'beforeModel' hook"))
                    .then(model, null, self.promiseLabel("Model"))
                    .then(checkForAbort, null, self.promiseLabel("Check if aborted in 'model' hook"))
                    .then(afterModel, null, self.promiseLabel("After model"))
                    .then(checkForAbort, null, self.promiseLabel("Check if aborted in 'afterModel' hook"))
                    .then(becomeResolved, null, self.promiseLabel("Become resolved"));
                }, function(error) {
                  throw error;
                });
      },

      runBeforeModelHook: function(payload) {
        if (payload.trigger) {
          payload.trigger(true, 'willResolveModel', payload, this.handler);
        }
        return this.runSharedModelHook(payload, 'beforeModel', []);
      },

      runAfterModelHook: function(payload, resolvedModel) {
        // Stash the resolved model on the payload.
        // This makes it possible for users to swap out
        // the resolved model in afterModel.
        var name = this.name;
        this.stashResolvedModel(payload, resolvedModel);

        return this.runSharedModelHook(payload, 'afterModel', [resolvedModel])
                   .then(function() {
                     // Ignore the fulfilled value returned from afterModel.
                     // Return the value stashed in resolvedModels, which
                     // might have been swapped out in afterModel.
                     return payload.resolvedModels[name];
                   }, null, this.promiseLabel("Ignore fulfillment value and return model value"));
      },

      runSharedModelHook: function(payload, hookName, args) {
        this.log(payload, "calling " + hookName + " hook");

        if (this.queryParams) {
          args.push(this.queryParams);
        }
        args.push(payload);

        var result = applyHook(this.handler, hookName, args);

        if (result && result.isTransition) {
          result = null;
        }

        return Promise.resolve(result, this.promiseLabel("Resolve value returned from one of the model hooks"));
      },

      // overridden by subclasses
      getModel: null,

      checkForAbort: function(shouldContinue, promiseValue) {
        return Promise.resolve(shouldContinue(), this.promiseLabel("Check for abort")).then(function() {
          // We don't care about shouldContinue's resolve value;
          // pass along the original value passed to this fn.
          return promiseValue;
        }, null, this.promiseLabel("Ignore fulfillment value and continue"));
      },

      stashResolvedModel: function(payload, resolvedModel) {
        payload.resolvedModels = payload.resolvedModels || {};
        payload.resolvedModels[this.name] = resolvedModel;
      },

      becomeResolved: function(payload, resolvedContext) {
        var params = this.serialize(resolvedContext);

        if (payload) {
          this.stashResolvedModel(payload, resolvedContext);
          payload.params = payload.params || {};
          payload.params[this.name] = params;
        }

        return this.factory('resolved', {
          context: resolvedContext,
          name: this.name,
          handler: this.handler,
          params: params
        });
      },

      shouldSupercede: function(other) {
        // Prefer this newer handlerInfo over `other` if:
        // 1) The other one doesn't exist
        // 2) The names don't match
        // 3) This handler has a context that doesn't match
        //    the other one (or the other one doesn't have one).
        // 4) This handler has parameters that don't match the other.
        if (!other) { return true; }

        var contextsMatch = (other.context === this.context);
        return other.name !== this.name ||
               (this.hasOwnProperty('context') && !contextsMatch) ||
               (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params));
      }
    };

    Object.defineProperty(HandlerInfo.prototype, 'handler', {
      get: function() {
        // _handler could be set to either a handler object or undefined, so we
        // compare against a default reference to know when it's been set
        if (this._handler !== DEFAULT_HANDLER) {
          return this._handler;
        }

        return this.fetchHandler();
      },

      set: function(handler) {
        return this._handler = handler;
      }
    });

    Object.defineProperty(HandlerInfo.prototype, 'handlerPromise', {
      get: function() {
        if (this._handlerPromise) {
          return this._handlerPromise;
        }

        this.fetchHandler();

        return this._handlerPromise;
      },

      set: function(handlerPromise) {
        return this._handlerPromise = handlerPromise;
      }
    });

    function paramsMatch(a, b) {
      if ((!a) ^ (!b)) {
        // Only one is null.
        return false;
      }

      if (!a) {
        // Both must be null.
        return true;
      }

      // Note: this assumes that both params have the same
      // number of keys, but since we're comparing the
      // same handlers, they should.
      for (var k in a) {
        if (a.hasOwnProperty(k) && a[k] !== b[k]) {
          return false;
        }
      }
      return true;
    }

    __exports__["default"] = HandlerInfo;
  });
define("router/handler-info/factory",
  ["./resolved-handler-info","./unresolved-handler-info-by-object","./unresolved-handler-info-by-param","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var ResolvedHandlerInfo = __dependency1__["default"];
    var UnresolvedHandlerInfoByObject = __dependency2__["default"];
    var UnresolvedHandlerInfoByParam = __dependency3__["default"];

    handlerInfoFactory.klasses = {
      resolved: ResolvedHandlerInfo,
      param: UnresolvedHandlerInfoByParam,
      object: UnresolvedHandlerInfoByObject
    };

    function handlerInfoFactory(name, props) {
      var Ctor = handlerInfoFactory.klasses[name],
          handlerInfo = new Ctor(props || {});
      handlerInfo.factory = handlerInfoFactory;
      return handlerInfo;
    }

    __exports__["default"] = handlerInfoFactory;
  });
define("router/handler-info/resolved-handler-info",
  ["../handler-info","../utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var HandlerInfo = __dependency1__["default"];
    var subclass = __dependency2__.subclass;
    var Promise = __dependency3__.Promise;

    var ResolvedHandlerInfo = subclass(HandlerInfo, {
      resolve: function(shouldContinue, payload) {
        // A ResolvedHandlerInfo just resolved with itself.
        if (payload && payload.resolvedModels) {
          payload.resolvedModels[this.name] = this.context;
        }
        return Promise.resolve(this, this.promiseLabel("Resolve"));
      },

      getUnresolved: function() {
        return this.factory('param', {
          name: this.name,
          handler: this.handler,
          params: this.params
        });
      },

      isResolved: true
    });

    __exports__["default"] = ResolvedHandlerInfo;
  });
define("router/handler-info/unresolved-handler-info-by-object",
  ["../handler-info","../utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var HandlerInfo = __dependency1__["default"];
    var subclass = __dependency2__.subclass;
    var isParam = __dependency2__.isParam;
    var Promise = __dependency3__.Promise;

    var UnresolvedHandlerInfoByObject = subclass(HandlerInfo, {
      getModel: function(payload) {
        this.log(payload, this.name + ": resolving provided model");
        return Promise.resolve(this.context);
      },

      initialize: function(props) {
        this.names = props.names || [];
        this.context = props.context;
      },

      /**
        @private

        Serializes a handler using its custom `serialize` method or
        by a default that looks up the expected property name from
        the dynamic segment.

        @param {Object} model the model to be serialized for this handler
      */
      serialize: function(_model) {
        var model = _model || this.context,
            names = this.names,
            serializer = this.serializer || (this.handler && this.handler.serialize);

        var object = {};
        if (isParam(model)) {
          object[names[0]] = model;
          return object;
        }

        // Use custom serialize if it exists.
        if (serializer) {
          return serializer(model, names);
        }

        if (names.length !== 1) { return; }

        var name = names[0];

        if (/_id$/.test(name)) {
          object[name] = model.id;
        } else {
          object[name] = model;
        }
        return object;
      }
    });

    __exports__["default"] = UnresolvedHandlerInfoByObject;
  });
define("router/handler-info/unresolved-handler-info-by-param",
  ["../handler-info","../utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var HandlerInfo = __dependency1__["default"];
    var resolveHook = __dependency2__.resolveHook;
    var merge = __dependency2__.merge;
    var subclass = __dependency2__.subclass;

    // Generated by URL transitions and non-dynamic route segments in named Transitions.
    var UnresolvedHandlerInfoByParam = subclass (HandlerInfo, {
      initialize: function(props) {
        this.params = props.params || {};
      },

      getModel: function(payload) {
        var fullParams = this.params;
        if (payload && payload.queryParams) {
          fullParams = {};
          merge(fullParams, this.params);
          fullParams.queryParams = payload.queryParams;
        }

        var handler = this.handler;
        var hookName = resolveHook(handler, 'deserialize') ||
                       resolveHook(handler, 'model');

        return this.runSharedModelHook(payload, hookName, [fullParams]);
      }
    });

    __exports__["default"] = UnresolvedHandlerInfoByParam;
  });
define("router/router",
  ["route-recognizer","rsvp","./utils","./transition-state","./transition","./transition-aborted-error","./transition-intent/named-transition-intent","./transition-intent/url-transition-intent","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __dependency6__, __dependency7__, __dependency8__, __exports__) {
    "use strict";
    var RouteRecognizer = __dependency1__["default"];
    var Promise = __dependency2__.Promise;
    var trigger = __dependency3__.trigger;
    var log = __dependency3__.log;
    var slice = __dependency3__.slice;
    var forEach = __dependency3__.forEach;
    var merge = __dependency3__.merge;
    var extractQueryParams = __dependency3__.extractQueryParams;
    var getChangelist = __dependency3__.getChangelist;
    var promiseLabel = __dependency3__.promiseLabel;
    var callHook = __dependency3__.callHook;
    var TransitionState = __dependency4__["default"];
    var logAbort = __dependency5__.logAbort;
    var Transition = __dependency5__.Transition;
    var TransitionAbortedError = __dependency6__["default"];
    var NamedTransitionIntent = __dependency7__["default"];
    var URLTransitionIntent = __dependency8__["default"];

    var pop = Array.prototype.pop;

    function Router(_options) {
      var options = _options || {};
      this.getHandler = options.getHandler || this.getHandler;
      this.getSerializer = options.getSerializer || this.getSerializer;
      this.updateURL = options.updateURL || this.updateURL;
      this.replaceURL = options.replaceURL || this.replaceURL;
      this.didTransition = options.didTransition || this.didTransition;
      this.willTransition = options.willTransition || this.willTransition;
      this.delegate = options.delegate || this.delegate;
      this.triggerEvent = options.triggerEvent || this.triggerEvent;
      this.log = options.log || this.log;
      this.dslCallBacks = []; // NOTE: set by Ember
      this.state = undefined;
      this.activeTransition = undefined;
      this._changedQueryParams = undefined;
      this.oldState = undefined;
      this.currentHandlerInfos = undefined;
      this.state = undefined;
      this.currentSequence = 0;

      this.recognizer = new RouteRecognizer();
      this.reset();
    }

    function getTransitionByIntent(intent, isIntermediate) {
      var wasTransitioning = !!this.activeTransition;
      var oldState = wasTransitioning ? this.activeTransition.state : this.state;
      var newTransition;

      var newState = intent.applyToState(oldState, this.recognizer, this.getHandler, isIntermediate, this.getSerializer);
      var queryParamChangelist = getChangelist(oldState.queryParams, newState.queryParams);

      if (handlerInfosEqual(newState.handlerInfos, oldState.handlerInfos)) {

        // This is a no-op transition. See if query params changed.
        if (queryParamChangelist) {
          newTransition = this.queryParamsTransition(queryParamChangelist, wasTransitioning, oldState, newState);
          if (newTransition) {
            newTransition.queryParamsOnly = true;
            return newTransition;
          }
        }

        // No-op. No need to create a new transition.
        return this.activeTransition || new Transition(this);
      }

      if (isIntermediate) {
        setupContexts(this, newState);
        return;
      }

      // Create a new transition to the destination route.
      newTransition = new Transition(this, intent, newState, undefined, this.activeTransition);

      // transition is to same route with same params, only query params differ.
      // not caught above probably because refresh() has been used
      if (  handlerInfosSameExceptQueryParams(newState.handlerInfos, oldState.handlerInfos ) ) {
        newTransition.queryParamsOnly = true;
      }

      // Abort and usurp any previously active transition.
      if (this.activeTransition) {
        this.activeTransition.abort();
      }
      this.activeTransition = newTransition;

      // Transition promises by default resolve with resolved state.
      // For our purposes, swap out the promise to resolve
      // after the transition has been finalized.
      newTransition.promise = newTransition.promise.then(function(result) {
        return finalizeTransition(newTransition, result.state);
      }, null, promiseLabel("Settle transition promise when transition is finalized"));

      if (!wasTransitioning) {
        notifyExistingHandlers(this, newState, newTransition);
      }

      fireQueryParamDidChange(this, newState, queryParamChangelist);

      return newTransition;
    }

    Router.prototype = {

      /**
        The main entry point into the router. The API is essentially
        the same as the `map` method in `route-recognizer`.

        This method extracts the String handler at the last `.to()`
        call and uses it as the name of the whole route.

        @param {Function} callback
      */
      map: function(callback) {
        this.recognizer.delegate = this.delegate;

        this.recognizer.map(callback, function(recognizer, routes) {
          for (var i = routes.length - 1, proceed = true; i >= 0 && proceed; --i) {
            var route = routes[i];
            recognizer.add(routes, { as: route.handler });
            proceed = route.path === '/' || route.path === '' || route.handler.slice(-6) === '.index';
          }
        });
      },

      hasRoute: function(route) {
        return this.recognizer.hasRoute(route);
      },

      getHandler: function() {},

      getSerializer: function() {},

      queryParamsTransition: function(changelist, wasTransitioning, oldState, newState) {
        var router = this;

        fireQueryParamDidChange(this, newState, changelist);

        if (!wasTransitioning && this.activeTransition) {
          // One of the handlers in queryParamsDidChange
          // caused a transition. Just return that transition.
          return this.activeTransition;
        } else {
          // Running queryParamsDidChange didn't change anything.
          // Just update query params and be on our way.

          // We have to return a noop transition that will
          // perform a URL update at the end. This gives
          // the user the ability to set the url update
          // method (default is replaceState).
          var newTransition = new Transition(this);
          newTransition.queryParamsOnly = true;

          oldState.queryParams = finalizeQueryParamChange(this, newState.handlerInfos, newState.queryParams, newTransition);

          newTransition.promise = newTransition.promise.then(function(result) {
            updateURL(newTransition, oldState, true);
            if (router.didTransition) {
              router.didTransition(router.currentHandlerInfos);
            }
            return result;
          }, null, promiseLabel("Transition complete"));
          return newTransition;
        }
      },

      // NOTE: this doesn't really belong here, but here
      // it shall remain until our ES6 transpiler can
      // handle cyclical deps.
      transitionByIntent: function(intent/*, isIntermediate*/) {
        try {
          return getTransitionByIntent.apply(this, arguments);
        } catch(e) {
          return new Transition(this, intent, null, e);
        }
      },

      /**
        Clears the current and target route handlers and triggers exit
        on each of them starting at the leaf and traversing up through
        its ancestors.
      */
      reset: function() {
        if (this.state) {
          forEach(this.state.handlerInfos.slice().reverse(), function(handlerInfo) {
            var handler = handlerInfo.handler;
            callHook(handler, 'exit');
          });
        }

        this.oldState = undefined;
        this.state = new TransitionState();
        this.currentHandlerInfos = null;
      },

      activeTransition: null,

      /**
        var handler = handlerInfo.handler;
        The entry point for handling a change to the URL (usually
        via the back and forward button).

        Returns an Array of handlers and the parameters associated
        with those parameters.

        @param {String} url a URL to process

        @return {Array} an Array of `[handler, parameter]` tuples
      */
      handleURL: function(url) {
        // Perform a URL-based transition, but don't change
        // the URL afterward, since it already happened.
        var args = slice.call(arguments);
        if (url.charAt(0) !== '/') { args[0] = '/' + url; }

        return doTransition(this, args).method(null);
      },

      /**
        Hook point for updating the URL.

        @param {String} url a URL to update to
      */
      updateURL: function() {
        throw new Error("updateURL is not implemented");
      },

      /**
        Hook point for replacing the current URL, i.e. with replaceState

        By default this behaves the same as `updateURL`

        @param {String} url a URL to update to
      */
      replaceURL: function(url) {
        this.updateURL(url);
      },

      /**
        Transition into the specified named route.

        If necessary, trigger the exit callback on any handlers
        that are no longer represented by the target route.

        @param {String} name the name of the route
      */
      transitionTo: function(/*name*/) {
        return doTransition(this, arguments);
      },

      intermediateTransitionTo: function(/*name*/) {
        return doTransition(this, arguments, true);
      },

      refresh: function(pivotHandler) {
        var previousTransition = this.activeTransition;
        var state = previousTransition ? previousTransition.state : this.state;
        var handlerInfos = state.handlerInfos;
        var params = {};
        for (var i = 0, len = handlerInfos.length; i < len; ++i) {
          var handlerInfo = handlerInfos[i];
          params[handlerInfo.name] = handlerInfo.params || {};
        }

        log(this, "Starting a refresh transition");
        var intent = new NamedTransitionIntent({
          name: handlerInfos[handlerInfos.length - 1].name,
          pivotHandler: pivotHandler || handlerInfos[0].handler,
          contexts: [], // TODO collect contexts...?
          queryParams: this._changedQueryParams || state.queryParams || {}
        });

        var newTransition = this.transitionByIntent(intent, false);

        // if the previous transition is a replace transition, that needs to be preserved
        if (previousTransition && previousTransition.urlMethod === 'replace') {
          newTransition.method(previousTransition.urlMethod);
        }

        return newTransition;
      },

      /**
        Identical to `transitionTo` except that the current URL will be replaced
        if possible.

        This method is intended primarily for use with `replaceState`.

        @param {String} name the name of the route
      */
      replaceWith: function(/*name*/) {
        return doTransition(this, arguments).method('replace');
      },

      /**
        Take a named route and context objects and generate a
        URL.

        @param {String} name the name of the route to generate
          a URL for
        @param {...Object} objects a list of objects to serialize

        @return {String} a URL
      */
      generate: function(handlerName) {

        var partitionedArgs = extractQueryParams(slice.call(arguments, 1)),
          suppliedParams = partitionedArgs[0],
          queryParams = partitionedArgs[1];

        // Construct a TransitionIntent with the provided params
        // and apply it to the present state of the router.
        var intent = new NamedTransitionIntent({ name: handlerName, contexts: suppliedParams });
        var state = intent.applyToState(this.state, this.recognizer, this.getHandler, null, this.getSerializer);
        var params = {};

        for (var i = 0, len = state.handlerInfos.length; i < len; ++i) {
          var handlerInfo = state.handlerInfos[i];
          var handlerParams = handlerInfo.serialize();
          merge(params, handlerParams);
        }
        params.queryParams = queryParams;

        return this.recognizer.generate(handlerName, params);
      },

      applyIntent: function(handlerName, contexts) {
        var intent = new NamedTransitionIntent({
          name: handlerName,
          contexts: contexts
        });

        var state = this.activeTransition && this.activeTransition.state || this.state;
        return intent.applyToState(state, this.recognizer, this.getHandler, null, this.getSerializer);
      },

      isActiveIntent: function(handlerName, contexts, queryParams, _state) {
        var state = _state || this.state,
            targetHandlerInfos = state.handlerInfos,
            handlerInfo, len;

        if (!targetHandlerInfos.length) { return false; }

        var targetHandler = targetHandlerInfos[targetHandlerInfos.length - 1].name;
        var recogHandlers = this.recognizer.handlersFor(targetHandler);

        var index = 0;
        for (len = recogHandlers.length; index < len; ++index) {
          handlerInfo = targetHandlerInfos[index];
          if (handlerInfo.name === handlerName) { break; }
        }

        if (index === recogHandlers.length) {
          // The provided route name isn't even in the route hierarchy.
          return false;
        }

        var testState = new TransitionState();
        testState.handlerInfos = targetHandlerInfos.slice(0, index + 1);
        recogHandlers = recogHandlers.slice(0, index + 1);

        var intent = new NamedTransitionIntent({
          name: targetHandler,
          contexts: contexts
        });

        var newState = intent.applyToHandlers(testState, recogHandlers, this.getHandler, targetHandler, true, true, this.getSerializer);

        var handlersEqual = handlerInfosEqual(newState.handlerInfos, testState.handlerInfos);
        if (!queryParams || !handlersEqual) {
          return handlersEqual;
        }

        // Get a hash of QPs that will still be active on new route
        var activeQPsOnNewHandler = {};
        merge(activeQPsOnNewHandler, queryParams);

        var activeQueryParams  = state.queryParams;
        for (var key in activeQueryParams) {
          if (activeQueryParams.hasOwnProperty(key) &&
              activeQPsOnNewHandler.hasOwnProperty(key)) {
            activeQPsOnNewHandler[key] = activeQueryParams[key];
          }
        }

        return handlersEqual && !getChangelist(activeQPsOnNewHandler, queryParams);
      },

      isActive: function(handlerName) {
        var partitionedArgs = extractQueryParams(slice.call(arguments, 1));
        return this.isActiveIntent(handlerName, partitionedArgs[0], partitionedArgs[1]);
      },

      trigger: function(/*name*/) {
        var args = slice.call(arguments);
        trigger(this, this.currentHandlerInfos, false, args);
      },

      /**
        Hook point for logging transition status updates.

        @param {String} message The message to log.
      */
      log: null
    };

    /**
      @private

      Fires queryParamsDidChange event
    */
    function fireQueryParamDidChange(router, newState, queryParamChangelist) {
      // If queryParams changed trigger event
      if (queryParamChangelist) {

        // This is a little hacky but we need some way of storing
        // changed query params given that no activeTransition
        // is guaranteed to have occurred.
        router._changedQueryParams = queryParamChangelist.all;
        trigger(router, newState.handlerInfos, true, ['queryParamsDidChange', queryParamChangelist.changed, queryParamChangelist.all, queryParamChangelist.removed]);
        router._changedQueryParams = null;
      }
    }

    /**
      @private

      Takes an Array of `HandlerInfo`s, figures out which ones are
      exiting, entering, or changing contexts, and calls the
      proper handler hooks.

      For example, consider the following tree of handlers. Each handler is
      followed by the URL segment it handles.

      ```
      |~index ("/")
      | |~posts ("/posts")
      | | |-showPost ("/:id")
      | | |-newPost ("/new")
      | | |-editPost ("/edit")
      | |~about ("/about/:id")
      ```

      Consider the following transitions:

      1. A URL transition to `/posts/1`.
         1. Triggers the `*model` callbacks on the
            `index`, `posts`, and `showPost` handlers
         2. Triggers the `enter` callback on the same
         3. Triggers the `setup` callback on the same
      2. A direct transition to `newPost`
         1. Triggers the `exit` callback on `showPost`
         2. Triggers the `enter` callback on `newPost`
         3. Triggers the `setup` callback on `newPost`
      3. A direct transition to `about` with a specified
         context object
         1. Triggers the `exit` callback on `newPost`
            and `posts`
         2. Triggers the `serialize` callback on `about`
         3. Triggers the `enter` callback on `about`
         4. Triggers the `setup` callback on `about`

      @param {Router} transition
      @param {TransitionState} newState
    */
    function setupContexts(router, newState, transition) {
      var partition = partitionHandlers(router.state, newState);
      var i, l, handler;

      for (i=0, l=partition.exited.length; i<l; i++) {
        handler = partition.exited[i].handler;
        delete handler.context;

        callHook(handler, 'reset', true, transition);
        callHook(handler, 'exit', transition);
      }

      var oldState = router.oldState = router.state;
      router.state = newState;
      var currentHandlerInfos = router.currentHandlerInfos = partition.unchanged.slice();

      try {
        for (i=0, l=partition.reset.length; i<l; i++) {
          handler = partition.reset[i].handler;
          callHook(handler, 'reset', false, transition);
        }

        for (i=0, l=partition.updatedContext.length; i<l; i++) {
          handlerEnteredOrUpdated(currentHandlerInfos, partition.updatedContext[i], false, transition);
        }

        for (i=0, l=partition.entered.length; i<l; i++) {
          handlerEnteredOrUpdated(currentHandlerInfos, partition.entered[i], true, transition);
        }
      } catch(e) {
        router.state = oldState;
        router.currentHandlerInfos = oldState.handlerInfos;
        throw e;
      }

      router.state.queryParams = finalizeQueryParamChange(router, currentHandlerInfos, newState.queryParams, transition);
    }


    /**
      @private

      Helper method used by setupContexts. Handles errors or redirects
      that may happen in enter/setup.
    */
    function handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, enter, transition) {
      var handler = handlerInfo.handler,
          context = handlerInfo.context;

      function _handlerEnteredOrUpdated(handler) {
        if (enter) {
          callHook(handler, 'enter', transition);
        }

        if (transition && transition.isAborted) {
          throw new TransitionAbortedError();
        }

        handler.context = context;
        callHook(handler, 'contextDidChange');

        callHook(handler, 'setup', context, transition);
        if (transition && transition.isAborted) {
          throw new TransitionAbortedError();
        }

        currentHandlerInfos.push(handlerInfo);
      }

      // If the handler doesn't exist, it means we haven't resolved the handler promise yet
      if (!handler) {
        handlerInfo.handlerPromise = handlerInfo.handlerPromise.then(_handlerEnteredOrUpdated);
      } else {
        _handlerEnteredOrUpdated(handler);
      }

      return true;
    }


    /**
      @private

      This function is called when transitioning from one URL to
      another to determine which handlers are no longer active,
      which handlers are newly active, and which handlers remain
      active but have their context changed.

      Take a list of old handlers and new handlers and partition
      them into four buckets:

      * unchanged: the handler was active in both the old and
        new URL, and its context remains the same
      * updated context: the handler was active in both the
        old and new URL, but its context changed. The handler's
        `setup` method, if any, will be called with the new
        context.
      * exited: the handler was active in the old URL, but is
        no longer active.
      * entered: the handler was not active in the old URL, but
        is now active.

      The PartitionedHandlers structure has four fields:

      * `updatedContext`: a list of `HandlerInfo` objects that
        represent handlers that remain active but have a changed
        context
      * `entered`: a list of `HandlerInfo` objects that represent
        handlers that are newly active
      * `exited`: a list of `HandlerInfo` objects that are no
        longer active.
      * `unchanged`: a list of `HanderInfo` objects that remain active.

      @param {Array[HandlerInfo]} oldHandlers a list of the handler
        information for the previous URL (or `[]` if this is the
        first handled transition)
      @param {Array[HandlerInfo]} newHandlers a list of the handler
        information for the new URL

      @return {Partition}
    */
    function partitionHandlers(oldState, newState) {
      var oldHandlers = oldState.handlerInfos;
      var newHandlers = newState.handlerInfos;

      var handlers = {
            updatedContext: [],
            exited: [],
            entered: [],
            unchanged: [],
            reset: undefined
          };

      var handlerChanged, contextChanged = false, i, l;

      for (i=0, l=newHandlers.length; i<l; i++) {
        var oldHandler = oldHandlers[i], newHandler = newHandlers[i];

        if (!oldHandler || oldHandler.handler !== newHandler.handler) {
          handlerChanged = true;
        }

        if (handlerChanged) {
          handlers.entered.push(newHandler);
          if (oldHandler) { handlers.exited.unshift(oldHandler); }
        } else if (contextChanged || oldHandler.context !== newHandler.context) {
          contextChanged = true;
          handlers.updatedContext.push(newHandler);
        } else {
          handlers.unchanged.push(oldHandler);
        }
      }

      for (i=newHandlers.length, l=oldHandlers.length; i<l; i++) {
        handlers.exited.unshift(oldHandlers[i]);
      }

      handlers.reset = handlers.updatedContext.slice();
      handlers.reset.reverse();

      return handlers;
    }

    function updateURL(transition, state/*, inputUrl*/) {
      var urlMethod = transition.urlMethod;

      if (!urlMethod) {
        return;
      }

      var router = transition.router,
          handlerInfos = state.handlerInfos,
          handlerName = handlerInfos[handlerInfos.length - 1].name,
          params = {};

      for (var i = handlerInfos.length - 1; i >= 0; --i) {
        var handlerInfo = handlerInfos[i];
        merge(params, handlerInfo.params);
        if (handlerInfo.handler.inaccessibleByURL) {
          urlMethod = null;
        }
      }

      if (urlMethod) {
        params.queryParams = transition._visibleQueryParams || state.queryParams;
        var url = router.recognizer.generate(handlerName, params);

        // transitions during the initial transition must always use replaceURL.
        // When the app boots, you are at a url, e.g. /foo. If some handler
        // redirects to bar as part of the initial transition, you don't want to
        // add a history entry for /foo. If you do, pressing back will immediately
        // hit the redirect again and take you back to /bar, thus killing the back
        // button
        var initial = transition.isCausedByInitialTransition;

        // say you are at / and you click a link to route /foo. In /foo's
        // handler, the transition is aborted using replacewith('/bar').
        // Because the current url is still /, the history entry for / is
        // removed from the history. Clicking back will take you to the page
        // you were on before /, which is often not even the app, thus killing
        // the back button. That's why updateURL is always correct for an
        // aborting transition that's not the initial transition
        var replaceAndNotAborting = (
          urlMethod === 'replace' &&
          !transition.isCausedByAbortingTransition
        );

        // because calling refresh causes an aborted transition, this needs to be
        // special cased - if the initial transition is a replace transition, the
        // urlMethod should be honored here.
        var isQueryParamsRefreshTransition = (
          transition.queryParamsOnly &&
          urlMethod === 'replace'
        );

        if (initial || replaceAndNotAborting || isQueryParamsRefreshTransition) {
          router.replaceURL(url);
        } else {
          router.updateURL(url);
        }
      }
    }

    /**
      @private

      Updates the URL (if necessary) and calls `setupContexts`
      to update the router's array of `currentHandlerInfos`.
     */
    function finalizeTransition(transition, newState) {

      try {
        log(transition.router, transition.sequence, "Resolved all models on destination route; finalizing transition.");

        var router = transition.router,
            handlerInfos = newState.handlerInfos;

        // Run all the necessary enter/setup/exit hooks
        setupContexts(router, newState, transition);

        // Check if a redirect occurred in enter/setup
        if (transition.isAborted) {
          // TODO: cleaner way? distinguish b/w targetHandlerInfos?
          router.state.handlerInfos = router.currentHandlerInfos;
          return Promise.reject(logAbort(transition));
        }

        updateURL(transition, newState, transition.intent.url);

        transition.isActive = false;
        router.activeTransition = null;

        trigger(router, router.currentHandlerInfos, true, ['didTransition']);

        if (router.didTransition) {
          router.didTransition(router.currentHandlerInfos);
        }

        log(router, transition.sequence, "TRANSITION COMPLETE.");

        // Resolve with the final handler.
        return handlerInfos[handlerInfos.length - 1].handler;
      } catch(e) {
        if (!((e instanceof TransitionAbortedError))) {
          //var erroneousHandler = handlerInfos.pop();
          var infos = transition.state.handlerInfos;
          transition.trigger(true, 'error', e, transition, infos[infos.length-1].handler);
          transition.abort();
        }

        throw e;
      }
    }

    /**
      @private

      Begins and returns a Transition based on the provided
      arguments. Accepts arguments in the form of both URL
      transitions and named transitions.

      @param {Router} router
      @param {Array[Object]} args arguments passed to transitionTo,
        replaceWith, or handleURL
    */
    function doTransition(router, args, isIntermediate) {
      // Normalize blank transitions to root URL transitions.
      var name = args[0] || '/';

      var lastArg = args[args.length-1];
      var queryParams = {};
      if (lastArg && lastArg.hasOwnProperty('queryParams')) {
        queryParams = pop.call(args).queryParams;
      }

      var intent;
      if (args.length === 0) {

        log(router, "Updating query params");

        // A query param update is really just a transition
        // into the route you're already on.
        var handlerInfos = router.state.handlerInfos;
        intent = new NamedTransitionIntent({
          name: handlerInfos[handlerInfos.length - 1].name,
          contexts: [],
          queryParams: queryParams
        });

      } else if (name.charAt(0) === '/') {

        log(router, "Attempting URL transition to " + name);
        intent = new URLTransitionIntent({ url: name });

      } else {

        log(router, "Attempting transition to " + name);
        intent = new NamedTransitionIntent({
          name: args[0],
          contexts: slice.call(args, 1),
          queryParams: queryParams
        });
      }

      return router.transitionByIntent(intent, isIntermediate);
    }

    function handlerInfosEqual(handlerInfos, otherHandlerInfos) {
      if (handlerInfos.length !== otherHandlerInfos.length) {
        return false;
      }

      for (var i = 0, len = handlerInfos.length; i < len; ++i) {
        if (handlerInfos[i] !== otherHandlerInfos[i]) {
          return false;
        }
      }
      return true;
    }

    function handlerInfosSameExceptQueryParams(handlerInfos, otherHandlerInfos) {
      if (handlerInfos.length !== otherHandlerInfos.length) {
        return false;
      }

      for (var i = 0, len = handlerInfos.length; i < len; ++i) {
        if (handlerInfos[i].name !== otherHandlerInfos[i].name) {
          return false;
        }

        if (!paramsEqual(handlerInfos[i].params, otherHandlerInfos[i].params)) {
          return false;
        }
      }
      return true;

    }

    function paramsEqual(params, otherParams) {
      if (!params && !otherParams) {
        return true;
      } else if (!params && !!otherParams || !!params && !otherParams) {
        // one is falsy but other is not;
        return false;
      }
      var keys        = Object.keys(params);
      var otherKeys   = Object.keys(otherParams);

      if (keys.length !== otherKeys.length) {
        return false;
      }

      for (var i = 0, len = keys.length; i < len; ++i) {
        var key = keys[i];

        if ( params[key] !== otherParams[key] ) {
          return false;
        }
      }

      return true;

    }

    function finalizeQueryParamChange(router, resolvedHandlers, newQueryParams, transition) {
      // We fire a finalizeQueryParamChange event which
      // gives the new route hierarchy a chance to tell
      // us which query params it's consuming and what
      // their final values are. If a query param is
      // no longer consumed in the final route hierarchy,
      // its serialized segment will be removed
      // from the URL.

      for (var k in newQueryParams) {
        if (newQueryParams.hasOwnProperty(k) &&
            newQueryParams[k] === null) {
          delete newQueryParams[k];
        }
      }

      var finalQueryParamsArray = [];
      trigger(router, resolvedHandlers, true, ['finalizeQueryParamChange', newQueryParams, finalQueryParamsArray, transition]);

      if (transition) {
        transition._visibleQueryParams = {};
      }

      var finalQueryParams = {};
      for (var i = 0, len = finalQueryParamsArray.length; i < len; ++i) {
        var qp = finalQueryParamsArray[i];
        finalQueryParams[qp.key] = qp.value;
        if (transition && qp.visible !== false) {
          transition._visibleQueryParams[qp.key] = qp.value;
        }
      }
      return finalQueryParams;
    }

    function notifyExistingHandlers(router, newState, newTransition) {
      var oldHandlers = router.state.handlerInfos,
          changing = [],
          leavingIndex = null,
          leaving, leavingChecker, i, oldHandlerLen, oldHandler, newHandler;

      oldHandlerLen = oldHandlers.length;
      for (i = 0; i < oldHandlerLen; i++) {
        oldHandler = oldHandlers[i];
        newHandler = newState.handlerInfos[i];

        if (!newHandler || oldHandler.name !== newHandler.name) {
          leavingIndex = i;
          break;
        }

        if (!newHandler.isResolved) {
          changing.push(oldHandler);
        }
      }

      if (leavingIndex !== null) {
        leaving = oldHandlers.slice(leavingIndex, oldHandlerLen);
        leavingChecker = function(name) {
          for (var h = 0, len = leaving.length; h < len; h++) {
            if (leaving[h].name === name) {
              return true;
            }
          }
          return false;
        };
      }

      trigger(router, oldHandlers, true, ['willTransition', newTransition]);

      if (router.willTransition) {
        router.willTransition(oldHandlers, newState.handlerInfos, newTransition);
      }
    }

    __exports__["default"] = Router;
  });
define("router/transition-aborted-error",
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var oCreate = __dependency1__.oCreate;

    function TransitionAbortedError(message) {
      if (!(this instanceof TransitionAbortedError)) {
        return new TransitionAbortedError(message);
      }

      var error = Error.call(this, message);

      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, TransitionAbortedError);
      } else {
        this.stack = error.stack;
      }

      this.description = error.description;
      this.fileName = error.fileName;
      this.lineNumber = error.lineNumber;
      this.message = error.message || 'TransitionAborted';
      this.name = 'TransitionAborted';
      this.number = error.number;
      this.code = error.code;
    }

    TransitionAbortedError.prototype = oCreate(Error.prototype);

    __exports__["default"] = TransitionAbortedError;
  });
define("router/transition-intent",
  ["exports"],
  function(__exports__) {
    "use strict";
    function TransitionIntent(props) {
      this.initialize(props);

      // TODO: wat
      this.data = this.data || {};
    }

    TransitionIntent.prototype = {
      initialize: null,
      applyToState: null
    };

    __exports__["default"] = TransitionIntent;
  });
define("router/transition-intent/named-transition-intent",
  ["../transition-intent","../transition-state","../handler-info/factory","../utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __exports__) {
    "use strict";
    var TransitionIntent = __dependency1__["default"];
    var TransitionState = __dependency2__["default"];
    var handlerInfoFactory = __dependency3__["default"];
    var isParam = __dependency4__.isParam;
    var extractQueryParams = __dependency4__.extractQueryParams;
    var merge = __dependency4__.merge;
    var subclass = __dependency4__.subclass;

    __exports__["default"] = subclass(TransitionIntent, {
      name: null,
      pivotHandler: null,
      contexts: null,
      queryParams: null,

      initialize: function(props) {
        this.name = props.name;
        this.pivotHandler = props.pivotHandler;
        this.contexts = props.contexts || [];
        this.queryParams = props.queryParams;
      },

      applyToState: function(oldState, recognizer, getHandler, isIntermediate, getSerializer) {

        var partitionedArgs     = extractQueryParams([this.name].concat(this.contexts)),
          pureArgs              = partitionedArgs[0],
          handlers              = recognizer.handlersFor(pureArgs[0]);

        var targetRouteName = handlers[handlers.length-1].handler;

        return this.applyToHandlers(oldState, handlers, getHandler, targetRouteName, isIntermediate, null, getSerializer);
      },

      applyToHandlers: function(oldState, handlers, getHandler, targetRouteName, isIntermediate, checkingIfActive, getSerializer) {

        var i, len;
        var newState = new TransitionState();
        var objects = this.contexts.slice(0);

        var invalidateIndex = handlers.length;

        // Pivot handlers are provided for refresh transitions
        if (this.pivotHandler) {
          for (i = 0, len = handlers.length; i < len; ++i) {
            if (handlers[i].handler === this.pivotHandler._handlerName) {
              invalidateIndex = i;
              break;
            }
          }
        }

        for (i = handlers.length - 1; i >= 0; --i) {
          var result = handlers[i];
          var name = result.handler;

          var oldHandlerInfo = oldState.handlerInfos[i];
          var newHandlerInfo = null;

          if (result.names.length > 0) {
            if (i >= invalidateIndex) {
              newHandlerInfo = this.createParamHandlerInfo(name, getHandler, result.names, objects, oldHandlerInfo);
            } else {
              var serializer = getSerializer(name);
              newHandlerInfo = this.getHandlerInfoForDynamicSegment(name, getHandler, result.names, objects, oldHandlerInfo, targetRouteName, i, serializer);
            }
          } else {
            // This route has no dynamic segment.
            // Therefore treat as a param-based handlerInfo
            // with empty params. This will cause the `model`
            // hook to be called with empty params, which is desirable.
            newHandlerInfo = this.createParamHandlerInfo(name, getHandler, result.names, objects, oldHandlerInfo);
          }

          if (checkingIfActive) {
            // If we're performing an isActive check, we want to
            // serialize URL params with the provided context, but
            // ignore mismatches between old and new context.
            newHandlerInfo = newHandlerInfo.becomeResolved(null, newHandlerInfo.context);
            var oldContext = oldHandlerInfo && oldHandlerInfo.context;
            if (result.names.length > 0 && newHandlerInfo.context === oldContext) {
              // If contexts match in isActive test, assume params also match.
              // This allows for flexibility in not requiring that every last
              // handler provide a `serialize` method
              newHandlerInfo.params = oldHandlerInfo && oldHandlerInfo.params;
            }
            newHandlerInfo.context = oldContext;
          }

          var handlerToUse = oldHandlerInfo;
          if (i >= invalidateIndex || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
            invalidateIndex = Math.min(i, invalidateIndex);
            handlerToUse = newHandlerInfo;
          }

          if (isIntermediate && !checkingIfActive) {
            handlerToUse = handlerToUse.becomeResolved(null, handlerToUse.context);
          }

          newState.handlerInfos.unshift(handlerToUse);
        }

        if (objects.length > 0) {
          throw new Error("More context objects were passed than there are dynamic segments for the route: " + targetRouteName);
        }

        if (!isIntermediate) {
          this.invalidateChildren(newState.handlerInfos, invalidateIndex);
        }

        merge(newState.queryParams, this.queryParams || {});

        return newState;
      },

      invalidateChildren: function(handlerInfos, invalidateIndex) {
        for (var i = invalidateIndex, l = handlerInfos.length; i < l; ++i) {
          var handlerInfo = handlerInfos[i];
          handlerInfos[i] = handlerInfo.getUnresolved();
        }
      },

      getHandlerInfoForDynamicSegment: function(name, getHandler, names, objects, oldHandlerInfo, targetRouteName, i, serializer) {
        var objectToUse;
        if (objects.length > 0) {

          // Use the objects provided for this transition.
          objectToUse = objects[objects.length - 1];
          if (isParam(objectToUse)) {
            return this.createParamHandlerInfo(name, getHandler, names, objects, oldHandlerInfo);
          } else {
            objects.pop();
          }
        } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
          // Reuse the matching oldHandlerInfo
          return oldHandlerInfo;
        } else {
          if (this.preTransitionState) {
            var preTransitionHandlerInfo = this.preTransitionState.handlerInfos[i];
            objectToUse = preTransitionHandlerInfo && preTransitionHandlerInfo.context;
          } else {
            // Ideally we should throw this error to provide maximal
            // information to the user that not enough context objects
            // were provided, but this proves too cumbersome in Ember
            // in cases where inner template helpers are evaluated
            // before parent helpers un-render, in which cases this
            // error somewhat prematurely fires.
            //throw new Error("Not enough context objects were provided to complete a transition to " + targetRouteName + ". Specifically, the " + name + " route needs an object that can be serialized into its dynamic URL segments [" + names.join(', ') + "]");
            return oldHandlerInfo;
          }
        }

        return handlerInfoFactory('object', {
          name: name,
          getHandler: getHandler,
          serializer: serializer,
          context: objectToUse,
          names: names
        });
      },

      createParamHandlerInfo: function(name, getHandler, names, objects, oldHandlerInfo) {
        var params = {};

        // Soak up all the provided string/numbers
        var numNames = names.length;
        while (numNames--) {

          // Only use old params if the names match with the new handler
          var oldParams = (oldHandlerInfo && name === oldHandlerInfo.name && oldHandlerInfo.params) || {};

          var peek = objects[objects.length - 1];
          var paramName = names[numNames];
          if (isParam(peek)) {
            params[paramName] = "" + objects.pop();
          } else {
            // If we're here, this means only some of the params
            // were string/number params, so try and use a param
            // value from a previous handler.
            if (oldParams.hasOwnProperty(paramName)) {
              params[paramName] = oldParams[paramName];
            } else {
              throw new Error("You didn't provide enough string/numeric parameters to satisfy all of the dynamic segments for route " + name);
            }
          }
        }

        return handlerInfoFactory('param', {
          name: name,
          getHandler: getHandler,
          params: params
        });
      }
    });
  });
define("router/transition-intent/url-transition-intent",
  ["../transition-intent","../transition-state","../handler-info/factory","../utils","../unrecognized-url-error","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var TransitionIntent = __dependency1__["default"];
    var TransitionState = __dependency2__["default"];
    var handlerInfoFactory = __dependency3__["default"];
    var merge = __dependency4__.merge;
    var subclass = __dependency4__.subclass;
    var UnrecognizedURLError = __dependency5__["default"];

    __exports__["default"] = subclass(TransitionIntent, {
      url: null,

      initialize: function(props) {
        this.url = props.url;
      },

      applyToState: function(oldState, recognizer, getHandler) {
        var newState = new TransitionState();

        var results = recognizer.recognize(this.url),
            i, len;

        if (!results) {
          throw new UnrecognizedURLError(this.url);
        }

        var statesDiffer = false;
        var url = this.url;

        // Checks if a handler is accessible by URL. If it is not, an error is thrown.
        // For the case where the handler is loaded asynchronously, the error will be
        // thrown once it is loaded.
        function checkHandlerAccessibility(handler) {
          if (handler && handler.inaccessibleByURL) {
            throw new UnrecognizedURLError(url);
          }

          return handler;
        }

        for (i = 0, len = results.length; i < len; ++i) {
          var result = results[i];
          var name = result.handler;
          var newHandlerInfo = handlerInfoFactory('param', {
            name: name,
            getHandler: getHandler,
            params: result.params
          });
          var handler = newHandlerInfo.handler;

          if (handler) {
            checkHandlerAccessibility(handler);
          } else {
            // If the hanlder is being loaded asynchronously, check if we can
            // access it after it has resolved
            newHandlerInfo.handlerPromise = newHandlerInfo.handlerPromise.then(checkHandlerAccessibility);
          }

          var oldHandlerInfo = oldState.handlerInfos[i];
          if (statesDiffer || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
            statesDiffer = true;
            newState.handlerInfos[i] = newHandlerInfo;
          } else {
            newState.handlerInfos[i] = oldHandlerInfo;
          }
        }

        merge(newState.queryParams, results.queryParams);

        return newState;
      }
    });
  });
define("router/transition-state",
  ["./utils","rsvp","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var forEach = __dependency1__.forEach;
    var promiseLabel = __dependency1__.promiseLabel;
    var callHook = __dependency1__.callHook;
    var Promise = __dependency2__.Promise;

    function TransitionState() {
      this.handlerInfos = [];
      this.queryParams = {};
      this.params = {};
    }

    TransitionState.prototype = {
      promiseLabel: function(label) {
        var targetName = '';
        forEach(this.handlerInfos, function(handlerInfo) {
          if (targetName !== '') {
            targetName += '.';
          }
          targetName += handlerInfo.name;
        });
        return promiseLabel("'" + targetName + "': " + label);
      },

      resolve: function(shouldContinue, payload) {
        // First, calculate params for this state. This is useful
        // information to provide to the various route hooks.
        var params = this.params;
        forEach(this.handlerInfos, function(handlerInfo) {
          params[handlerInfo.name] = handlerInfo.params || {};
        });

        payload = payload || {};
        payload.resolveIndex = 0;

        var currentState = this;
        var wasAborted = false;

        // The prelude RSVP.resolve() asyncs us into the promise land.
        return Promise.resolve(null, this.promiseLabel("Start transition"))
        .then(resolveOneHandlerInfo, null, this.promiseLabel('Resolve handler'))['catch'](handleError, this.promiseLabel('Handle error'));

        function innerShouldContinue() {
          return Promise.resolve(shouldContinue(), currentState.promiseLabel("Check if should continue"))['catch'](function(reason) {
            // We distinguish between errors that occurred
            // during resolution (e.g. beforeModel/model/afterModel),
            // and aborts due to a rejecting promise from shouldContinue().
            wasAborted = true;
            return Promise.reject(reason);
          }, currentState.promiseLabel("Handle abort"));
        }

        function handleError(error) {
          // This is the only possible
          // reject value of TransitionState#resolve
          var handlerInfos = currentState.handlerInfos;
          var errorHandlerIndex = payload.resolveIndex >= handlerInfos.length ?
                                  handlerInfos.length - 1 : payload.resolveIndex;
          return Promise.reject({
            error: error,
            handlerWithError: currentState.handlerInfos[errorHandlerIndex].handler,
            wasAborted: wasAborted,
            state: currentState
          });
        }

        function proceed(resolvedHandlerInfo) {
          var wasAlreadyResolved = currentState.handlerInfos[payload.resolveIndex].isResolved;

          // Swap the previously unresolved handlerInfo with
          // the resolved handlerInfo
          currentState.handlerInfos[payload.resolveIndex++] = resolvedHandlerInfo;

          if (!wasAlreadyResolved) {
            // Call the redirect hook. The reason we call it here
            // vs. afterModel is so that redirects into child
            // routes don't re-run the model hooks for this
            // already-resolved route.
            var handler = resolvedHandlerInfo.handler;
            callHook(handler, 'redirect', resolvedHandlerInfo.context, payload);
          }

          // Proceed after ensuring that the redirect hook
          // didn't abort this transition by transitioning elsewhere.
          return innerShouldContinue().then(resolveOneHandlerInfo, null, currentState.promiseLabel('Resolve handler'));
        }

        function resolveOneHandlerInfo() {
          if (payload.resolveIndex === currentState.handlerInfos.length) {
            // This is is the only possible
            // fulfill value of TransitionState#resolve
            return {
              error: null,
              state: currentState
            };
          }

          var handlerInfo = currentState.handlerInfos[payload.resolveIndex];

          return handlerInfo.resolve(innerShouldContinue, payload)
                            .then(proceed, null, currentState.promiseLabel('Proceed'));
        }
      }
    };

    __exports__["default"] = TransitionState;
  });
define("router/transition",
  ["rsvp","./utils","./transition-aborted-error","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;
    var trigger = __dependency2__.trigger;
    var slice = __dependency2__.slice;
    var log = __dependency2__.log;
    var promiseLabel = __dependency2__.promiseLabel;
    var TransitionAbortedError = __dependency3__["default"];

    /**
      A Transition is a thennable (a promise-like object) that represents
      an attempt to transition to another route. It can be aborted, either
      explicitly via `abort` or by attempting another transition while a
      previous one is still underway. An aborted transition can also
      be `retry()`d later.

      @class Transition
      @constructor
      @param {Object} router
      @param {Object} intent
      @param {Object} state
      @param {Object} error
      @private
     */
    function Transition(router, intent, state, error, previousTransition) {
      var transition = this;
      this.state = state || router.state;
      this.intent = intent;
      this.router = router;
      this.data = this.intent && this.intent.data || {};
      this.resolvedModels = {};
      this.queryParams = {};
      this.promise = undefined;
      this.error = undefined;
      this.params = undefined;
      this.handlerInfos = undefined;
      this.targetName = undefined;
      this.pivotHandler = undefined;
      this.sequence = undefined;
      this.isAborted = false;
      this.isActive = true;

      if (error) {
        this.promise = Promise.reject(error);
        this.error = error;
        return;
      }

      // if you're doing multiple redirects, need the new transition to know if it
      // is actually part of the first transition or not. Any further redirects
      // in the initial transition also need to know if they are part of the
      // initial transition
      this.isCausedByAbortingTransition = !!previousTransition;
      this.isCausedByInitialTransition = (
        previousTransition && (
          previousTransition.isCausedByInitialTransition ||
          previousTransition.sequence === 0
        )
      );

      if (state) {
        this.params = state.params;
        this.queryParams = state.queryParams;
        this.handlerInfos = state.handlerInfos;

        var len = state.handlerInfos.length;
        if (len) {
          this.targetName = state.handlerInfos[len-1].name;
        }

        for (var i = 0; i < len; ++i) {
          var handlerInfo = state.handlerInfos[i];

          // TODO: this all seems hacky
          if (!handlerInfo.isResolved) { break; }
          this.pivotHandler = handlerInfo.handler;
        }

        this.sequence = router.currentSequence++;
        this.promise = state.resolve(checkForAbort, this)['catch'](
          catchHandlerForTransition(transition), promiseLabel('Handle Abort'));
      } else {
        this.promise = Promise.resolve(this.state);
        this.params = {};
      }

      function checkForAbort() {
        if (transition.isAborted) {
          return Promise.reject(undefined, promiseLabel("Transition aborted - reject"));
        }
      }
    }

    function catchHandlerForTransition(transition) {
      return function(result) {
        if (result.wasAborted || transition.isAborted) {
          return Promise.reject(logAbort(transition));
        } else {
          transition.trigger('error', result.error, transition, result.handlerWithError);
          transition.abort();
          return Promise.reject(result.error);
        }
      };
    }


    Transition.prototype = {
      targetName: null,
      urlMethod: 'update',
      intent: null,
      pivotHandler: null,
      resolveIndex: 0,
      resolvedModels: null,
      state: null,
      queryParamsOnly: false,

      isTransition: true,

      isExiting: function(handler) {
        var handlerInfos = this.handlerInfos;
        for (var i = 0, len = handlerInfos.length; i < len; ++i) {
          var handlerInfo = handlerInfos[i];
          if (handlerInfo.name === handler || handlerInfo.handler === handler) {
            return false;
          }
        }
        return true;
      },

      /**
        The Transition's internal promise. Calling `.then` on this property
        is that same as calling `.then` on the Transition object itself, but
        this property is exposed for when you want to pass around a
        Transition's promise, but not the Transition object itself, since
        Transition object can be externally `abort`ed, while the promise
        cannot.

        @property promise
        @type {Object}
        @public
       */
      promise: null,

      /**
        Custom state can be stored on a Transition's `data` object.
        This can be useful for decorating a Transition within an earlier
        hook and shared with a later hook. Properties set on `data` will
        be copied to new transitions generated by calling `retry` on this
        transition.

        @property data
        @type {Object}
        @public
       */
      data: null,

      /**
        A standard promise hook that resolves if the transition
        succeeds and rejects if it fails/redirects/aborts.

        Forwards to the internal `promise` property which you can
        use in situations where you want to pass around a thennable,
        but not the Transition itself.

        @method then
        @param {Function} onFulfilled
        @param {Function} onRejected
        @param {String} label optional string for labeling the promise.
        Useful for tooling.
        @return {Promise}
        @public
       */
      then: function(onFulfilled, onRejected, label) {
        return this.promise.then(onFulfilled, onRejected, label);
      },

      /**

        Forwards to the internal `promise` property which you can
        use in situations where you want to pass around a thennable,
        but not the Transition itself.

        @method catch
        @param {Function} onRejection
        @param {String} label optional string for labeling the promise.
        Useful for tooling.
        @return {Promise}
        @public
       */
      "catch": function(onRejection, label) {
        return this.promise["catch"](onRejection, label);
      },

      /**

        Forwards to the internal `promise` property which you can
        use in situations where you want to pass around a thennable,
        but not the Transition itself.

        @method finally
        @param {Function} callback
        @param {String} label optional string for labeling the promise.
        Useful for tooling.
        @return {Promise}
        @public
       */
      "finally": function(callback, label) {
        return this.promise["finally"](callback, label);
      },

      /**
        Aborts the Transition. Note you can also implicitly abort a transition
        by initiating another transition while a previous one is underway.

        @method abort
        @return {Transition} this transition
        @public
       */
      abort: function() {
        if (this.isAborted) { return this; }
        log(this.router, this.sequence, this.targetName + ": transition was aborted");
        this.intent.preTransitionState = this.router.state;
        this.isAborted = true;
        this.isActive = false;
        this.router.activeTransition = null;
        return this;
      },

      /**

        Retries a previously-aborted transition (making sure to abort the
        transition if it's still active). Returns a new transition that
        represents the new attempt to transition.

        @method retry
        @return {Transition} new transition
        @public
       */
      retry: function() {
        // TODO: add tests for merged state retry()s
        this.abort();
        var newTransition = this.router.transitionByIntent(this.intent, false);

        // inheriting a `null` urlMethod is not valid
        // the urlMethod is only set to `null` when
        // the transition is initiated *after* the url
        // has been updated (i.e. `router.handleURL`)
        //
        // in that scenario, the url method cannot be
        // inherited for a new transition because then
        // the url would not update even though it should
        if (this.urlMethod !== null) {
          newTransition.method(this.urlMethod);
        }
        return newTransition;
      },

      /**

        Sets the URL-changing method to be employed at the end of a
        successful transition. By default, a new Transition will just
        use `updateURL`, but passing 'replace' to this method will
        cause the URL to update using 'replaceWith' instead. Omitting
        a parameter will disable the URL change, allowing for transitions
        that don't update the URL at completion (this is also used for
        handleURL, since the URL has already changed before the
        transition took place).

        @method method
        @param {String} method the type of URL-changing method to use
          at the end of a transition. Accepted values are 'replace',
          falsy values, or any other non-falsy value (which is
          interpreted as an updateURL transition).

        @return {Transition} this transition
        @public
       */
      method: function(method) {
        this.urlMethod = method;
        return this;
      },

      /**

        Fires an event on the current list of resolved/resolving
        handlers within this transition. Useful for firing events
        on route hierarchies that haven't fully been entered yet.

        Note: This method is also aliased as `send`

        @method trigger
        @param {Boolean} [ignoreFailure=false] a boolean specifying whether unhandled events throw an error
        @param {String} name the name of the event to fire
        @public
       */
      trigger: function (ignoreFailure) {
        var args = slice.call(arguments);
        if (typeof ignoreFailure === 'boolean') {
          args.shift();
        } else {
          // Throw errors on unhandled trigger events by default
          ignoreFailure = false;
        }
        trigger(this.router, this.state.handlerInfos.slice(0, this.resolveIndex + 1), ignoreFailure, args);
      },

      /**
        Transitions are aborted and their promises rejected
        when redirects occur; this method returns a promise
        that will follow any redirects that occur and fulfill
        with the value fulfilled by any redirecting transitions
        that occur.

        @method followRedirects
        @return {Promise} a promise that fulfills with the same
          value that the final redirecting transition fulfills with
        @public
       */
      followRedirects: function() {
        var router = this.router;
        return this.promise['catch'](function(reason) {
          if (router.activeTransition) {
            return router.activeTransition.followRedirects();
          }
          return Promise.reject(reason);
        });
      },

      toString: function() {
        return "Transition (sequence " + this.sequence + ")";
      },

      /**
        @private
       */
      log: function(message) {
        log(this.router, this.sequence, message);
      }
    };

    // Alias 'trigger' as 'send'
    Transition.prototype.send = Transition.prototype.trigger;

    /**
      @private

      Logs and returns an instance of TransitionAbortedError.
     */
    function logAbort(transition) {
      log(transition.router, transition.sequence, "detected abort.");
      return new TransitionAbortedError();
    }

    __exports__.Transition = Transition;
    __exports__.logAbort = logAbort;
    __exports__.TransitionAbortedError = TransitionAbortedError;
  });
define("router/unrecognized-url-error",
  ["./utils","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var oCreate = __dependency1__.oCreate;

    function UnrecognizedURLError(message) {
      if (!(this instanceof UnrecognizedURLError)) {
        return new UnrecognizedURLError(message);
      }

      var error = Error.call(this, message);

      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, UnrecognizedURLError);
      } else {
        this.stack = error.stack;
      }

      this.description = error.description;
      this.fileName = error.fileName;
      this.lineNumber = error.lineNumber;
      this.message = error.message || 'UnrecognizedURL';
      this.name = 'UnrecognizedURLError';
      this.number = error.number;
      this.code = error.code;
    }

    UnrecognizedURLError.prototype = oCreate(Error.prototype);

    __exports__["default"] = UnrecognizedURLError;
  });
define("router/utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    var slice = Array.prototype.slice;

    var _isArray;
    if (!Array.isArray) {
      _isArray = function (x) {
        return Object.prototype.toString.call(x) === "[object Array]";
      };
    } else {
      _isArray = Array.isArray;
    }

    var isArray = _isArray;
    __exports__.isArray = isArray;
    /**
      Determines if an object is Promise by checking if it is "thenable".
    **/
    function isPromise(obj) {
      return ((typeof obj === 'object' && obj !== null) || typeof obj === 'function') && typeof obj.then === 'function';
    }

    __exports__.isPromise = isPromise;function merge(hash, other) {
      for (var prop in other) {
        if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
      }
    }

    var oCreate = Object.create || function(proto) {
      function F() {}
      F.prototype = proto;
      return new F();
    };
    __exports__.oCreate = oCreate;
    /**
      @private

      Extracts query params from the end of an array
    **/
    function extractQueryParams(array) {
      var len = (array && array.length), head, queryParams;

      if(len && len > 0 && array[len - 1] && array[len - 1].hasOwnProperty('queryParams')) {
        queryParams = array[len - 1].queryParams;
        head = slice.call(array, 0, len - 1);
        return [head, queryParams];
      } else {
        return [array, null];
      }
    }

    __exports__.extractQueryParams = extractQueryParams;/**
      @private

      Coerces query param properties and array elements into strings.
    **/
    function coerceQueryParamsToString(queryParams) {
      for (var key in queryParams) {
        if (typeof queryParams[key] === 'number') {
          queryParams[key] = '' + queryParams[key];
        } else if (isArray(queryParams[key])) {
          for (var i = 0, l = queryParams[key].length; i < l; i++) {
            queryParams[key][i] = '' + queryParams[key][i];
          }
        }
      }
    }
    /**
      @private
     */
    function log(router, sequence, msg) {
      if (!router.log) { return; }

      if (arguments.length === 3) {
        router.log("Transition #" + sequence + ": " + msg);
      } else {
        msg = sequence;
        router.log(msg);
      }
    }

    __exports__.log = log;function bind(context, fn) {
      var boundArgs = arguments;
      return function(value) {
        var args = slice.call(boundArgs, 2);
        args.push(value);
        return fn.apply(context, args);
      };
    }

    __exports__.bind = bind;function isParam(object) {
      return (typeof object === "string" || object instanceof String || typeof object === "number" || object instanceof Number);
    }


    function forEach(array, callback) {
      for (var i=0, l=array.length; i < l && false !== callback(array[i]); i++) { }
    }

    __exports__.forEach = forEach;function trigger(router, handlerInfos, ignoreFailure, args) {
      if (router.triggerEvent) {
        router.triggerEvent(handlerInfos, ignoreFailure, args);
        return;
      }

      var name = args.shift();

      if (!handlerInfos) {
        if (ignoreFailure) { return; }
        throw new Error("Could not trigger event '" + name + "'. There are no active handlers");
      }

      var eventWasHandled = false;

      function delayedEvent(name, args, handler) {
        handler.events[name].apply(handler, args);
      }

      for (var i=handlerInfos.length-1; i>=0; i--) {
        var handlerInfo = handlerInfos[i],
            handler = handlerInfo.handler;

        // If there is no handler, it means the handler hasn't resolved yet which
        // means that we should trigger the event later when the handler is available
        if (!handler) {
          handlerInfo.handlerPromise.then(bind(null, delayedEvent, name, args));
          continue;
        }

        if (handler.events && handler.events[name]) {
          if (handler.events[name].apply(handler, args) === true) {
            eventWasHandled = true;
          } else {
            return;
          }
        }
      }

      // In the case that we got an UnrecognizedURLError as an event with no handler,
      // let it bubble up
      if (name === 'error' && args[0].name === 'UnrecognizedURLError') {
        throw args[0];
      } else if (!eventWasHandled && !ignoreFailure) {
        throw new Error("Nothing handled the event '" + name + "'.");
      }
    }

    __exports__.trigger = trigger;function getChangelist(oldObject, newObject) {
      var key;
      var results = {
        all: {},
        changed: {},
        removed: {}
      };

      merge(results.all, newObject);

      var didChange = false;
      coerceQueryParamsToString(oldObject);
      coerceQueryParamsToString(newObject);

      // Calculate removals
      for (key in oldObject) {
        if (oldObject.hasOwnProperty(key)) {
          if (!newObject.hasOwnProperty(key)) {
            didChange = true;
            results.removed[key] = oldObject[key];
          }
        }
      }

      // Calculate changes
      for (key in newObject) {
        if (newObject.hasOwnProperty(key)) {
          if (isArray(oldObject[key]) && isArray(newObject[key])) {
            if (oldObject[key].length !== newObject[key].length) {
              results.changed[key] = newObject[key];
              didChange = true;
            } else {
              for (var i = 0, l = oldObject[key].length; i < l; i++) {
                if (oldObject[key][i] !== newObject[key][i]) {
                  results.changed[key] = newObject[key];
                  didChange = true;
                }
              }
            }
          }
          else {
            if (oldObject[key] !== newObject[key]) {
              results.changed[key] = newObject[key];
              didChange = true;
            }
          }
        }
      }

      return didChange && results;
    }

    __exports__.getChangelist = getChangelist;function promiseLabel(label) {
      return 'Router: ' + label;
    }

    __exports__.promiseLabel = promiseLabel;function subclass(parentConstructor, proto) {
      function C(props) {
        parentConstructor.call(this, props || {});
      }
      C.prototype = oCreate(parentConstructor.prototype);
      merge(C.prototype, proto);
      return C;
    }

    __exports__.subclass = subclass;function resolveHook(obj, hookName) {
      if (!obj) { return; }
      var underscored = "_" + hookName;
      return obj[underscored] && underscored ||
             obj[hookName] && hookName;
    }

    function callHook(obj, _hookName, arg1, arg2) {
      var hookName = resolveHook(obj, _hookName);
      return hookName && obj[hookName].call(obj, arg1, arg2);
    }

    function applyHook(obj, _hookName, args) {
      var hookName = resolveHook(obj, _hookName);
      if (hookName) {
        if (args.length === 0) {
          return obj[hookName].call(obj);
        } else if (args.length === 1) {
          return obj[hookName].call(obj, args[0]);
        } else if (args.length === 2) {
          return obj[hookName].call(obj, args[0], args[1]);
        } else {
          return obj[hookName].apply(obj, args);
        }
      }
    }

    __exports__.merge = merge;
    __exports__.slice = slice;
    __exports__.isParam = isParam;
    __exports__.coerceQueryParamsToString = coerceQueryParamsToString;
    __exports__.callHook = callHook;
    __exports__.resolveHook = resolveHook;
    __exports__.applyHook = applyHook;
  });
define("router",
  ["./router/router","./router/transition","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var Router = __dependency1__["default"];
    var Transition = __dependency2__.Transition;

    __exports__["default"] = Router;

    __exports__.Transition = Transition;
  });define("route-recognizer", [], function() { return {"default": RouteRecognizer}; });
define("rsvp", [], function() { return RSVP;});
define("rsvp/promise", [], function() { return {"default": RSVP.Promise}; });
window.Router = requireModule('router');
}(window, window.RSVP, window.RouteRecognizer));