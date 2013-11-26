define("router", 
  ["route-recognizer","rsvp","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    /**
      @private

      This file references several internal structures:

      ## `RecognizedHandler`

      * `{String} handler`: A handler name
      * `{Object} params`: A hash of recognized parameters

      ## `HandlerInfo`

      * `{Boolean} isDynamic`: whether a handler has any dynamic segments
      * `{String} name`: the name of a handler
      * `{Object} handler`: a handler object
      * `{Object} context`: the active context for the handler
    */

    var RouteRecognizer = __dependency1__['default'];
    var RSVP = __dependency2__['default'];

    var slice = Array.prototype.slice;

    var oCreate = Object.create || function(proto) {
      function F() {}
      F.prototype = proto;
      return new F();
    };

    function HandlerInfo(props) {
      if (props) {
        merge(this, props);
      }
    }

    function bind(fn, context) {
      var boundArgs = arguments;
      return function(value) {
        var args = slice.call(boundArgs, 2);
        args.push(value);
        return fn.apply(context, args);
      };
    }

    HandlerInfo.prototype = {
      name: null,
      handler: null,
      params: null,
      context: null,

      log: function(payload, message) {
        if (payload.log) {
          payload.log(this.name + ': ' + message);
        }
      },

      resolve: function(shouldContinue, payload) {
        var checkForAbort  = bind(this.checkForAbort,      this, shouldContinue),
            beforeModel    = bind(this.runBeforeModelHook, this, payload),
            model          = bind(this.getModel,           this, payload),
            afterModel     = bind(this.runAfterModelHook,  this, payload),
            becomeResolved = bind(this.becomeResolved,     this, payload);

        return RSVP.resolve().then(checkForAbort)
                             .then(beforeModel)
                             .then(checkForAbort)
                             .then(model)
                             .then(checkForAbort)
                             .then(afterModel)
                             .then(checkForAbort)
                             .then(becomeResolved);
      },

      runBeforeModelHook: function(payload) {
        return this.runSharedModelHook(payload, 'beforeModel', []);
      },

      runAfterModelHook: function(payload, context) {
        return this.runSharedModelHook(payload, 'afterModel', [context])
                   .then(function() {
                     // We ignore the value returned/fulfilled by afterModel.
                     // TODO: how to swap?
                     return context;
                   });
      },

      runSharedModelHook: function(payload, hookName, args) {
        this.log(payload, "calling " + hookName + " hook");

        if (this.queryParams) {
          args.push(this.queryParams);
        }
        args.push(payload);

        var handler = this.handler;
        return async(function() {
          var p = handler[hookName] && handler[hookName].apply(handler, args);
          return (p instanceof Transition) ? null : p; // TODO: better place for this check?
        });
      },

      getModel: function(payload) {
        throw new Error("This should be overridden by a subclass of HandlerInfo");
      },

      checkForAbort: function(shouldContinue, promiseValue) {
        return RSVP.resolve(shouldContinue()).then(function() {
          // We don't care about shouldContinue's resolve value;
          // pass along the original value passed to this fn.
          return promiseValue;
        });
      },

      becomeResolved: function(payload, resolvedContext) {
        var params = this.params || serialize(this.handler, resolvedContext, this.names);

        // Stash resolved params on the payload as we resolve.
        if (payload) {
          payload.params = payload.params || {};
          payload.params[this.name] = params;
        }

        return new ResolvedHandlerInfo({
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
        // 4) Neither contexts nor parameters match.
        if (!other) { return true; }

        var contextsMatch = (other.context === this.context);
        return other.name !== this.name ||
               (this.hasOwnProperty('context') && !contextsMatch) ||
               (!contextsMatch && !paramsMatch(this.params, other.params));
      }
    };

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


    function ResolvedHandlerInfo(props) {
      HandlerInfo.call(this, props);
    }
    ResolvedHandlerInfo.prototype = oCreate(HandlerInfo.prototype);
    ResolvedHandlerInfo.prototype.resolve = function() {
      // A ResolvedHandlerInfo just resolved with itself.
      return RSVP.resolve(this);
    };

    // These are generated by URL transitions and
    // named transitions for non-dynamic route segments.
    function UnresolvedHandlerInfoByParam(props) {
      HandlerInfo.call(this, props);
      this.params = this.params || {};
    }
    UnresolvedHandlerInfoByParam.prototype = oCreate(HandlerInfo.prototype);
    UnresolvedHandlerInfoByParam.prototype.getModel = function(payload) {
      return this.runSharedModelHook(payload, 'model', [this.params]);
    };


    // These are generated only for named transitions
    // with dynamic route segments.
    function UnresolvedHandlerInfoByObject(props) {
      HandlerInfo.call(this, props);
    }

    UnresolvedHandlerInfoByObject.prototype = oCreate(HandlerInfo.prototype);
    UnresolvedHandlerInfoByObject.prototype.getModel = function(payload) {
      this.log(payload, this.name + ": resolving provided model");
      return RSVP.resolve(this.context);
    };

    function TransitionIntent(props) {
      if (props) {
        merge(this, props);
      }
    }

    function URLTransitionIntent(props) {
      TransitionIntent.call(this, props);
    }

    URLTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
    URLTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler) {
      var newState = new TransitionState();

      var results = recognizer.recognize(this.url),
          queryParams = {},
          i, len;

      // TODO: LOG. maybe move this elsewhere?
      //log(router, "Attempting URL transition to " + url);

      if (!results) {
        throw new Router.UnrecognizedURLError(this.url);
      }

      for (i = 0, len = results.length; i < len; ++i) {
        var result = results[i];
        var name = result.handler;
        var handler = getHandler(name);

        if (handler.inaccessibleByURL) {
          throw new Router.UnrecognizedURLError(this.url);
        }

        var newHandlerInfo = new UnresolvedHandlerInfoByParam({
          name: name,
          handler: handler,
          params: result.params
        });

        var oldHandlerInfo = oldState.handlerInfos[i];
        if (newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
          newState.handlerInfos[i] = newHandlerInfo;
        } else {
          newState.handlerInfos[i] = oldHandlerInfo;
        }
      }

      // TODO: query params
      //for(i = 0, len = results.length; i < len; i++) {
        //merge(queryParams, results[i].queryParams);
      //}

      return newState;
    };


    function NamedTransitionIntent(props) {
      TransitionIntent.call(this, props);
    }

    NamedTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
    NamedTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler) {

      var newState = new TransitionState();

      var partitionedArgs     = extractQueryParams([this.name].concat(this.contexts)),
        pureArgs              = partitionedArgs[0],
        queryParams           = partitionedArgs[1],
        handlers              = recognizer.handlersFor(pureArgs[0]);
        //handlerInfos          = generateHandlerInfosWithQueryParams({}, handlers, queryParams);

      var objects = this.contexts.slice(0);

      for (var i = handlers.length - 1; i >= 0; --i) {
        var result = handlers[i];
        var name = result.handler;
        var handler = getHandler(name);

        var oldHandlerInfo = oldState.handlerInfos[i];
        var newHandlerInfo;

        if (result.names.length > 0) {
          // This route has a dynamic segment.
          var objectToUse;
          if (objects.length) {
            objectToUse = objects.pop();
          } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
            // Reuse the old handler info's context,
            // since its handler matches.
            objectToUse = oldHandlerInfo.context;
          } else {
            throw new Error("More context objects were passed than there are dynamic segments for the route: " + handlers[handlers.length - 1].handler);
          }

          newHandlerInfo = new UnresolvedHandlerInfoByObject({
            name: name,
            handler: handler,
            context: objectToUse,
            names: result.names
          });
        } else {
          // This route has no dynamic segment.
          // Therefore treat as a param-based handlerInfo
          // with empty params. This will cause the `model`
          // hook to be called with empty params, which is desirable.
          newHandlerInfo = new UnresolvedHandlerInfoByParam({
            name: name,
            handler: handler,
            params: {}
          });
        }

        if (newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
          newState.handlerInfos.unshift(newHandlerInfo);
        } else {
          newState.handlerInfos.unshift(oldHandlerInfo);
        }
      }

      return newState;
    };

    function TransitionState(other) {
      this.handlerInfos = [];
    }

    TransitionState.prototype = {
      resolve: function(shouldContinue, payload) {

        // Create a new state that we'll be appending handlerInfos to.
        var currentState = this;
        var newState = new TransitionState(this);
        var wasAborted = false;
        var index = 0;

        // The prelude RSVP.resolve() asyncs us into the promise land.
        return RSVP.resolve().then(resolveOne);

        function innerShouldContinue() {
          return RSVP.resolve(shouldContinue()).fail(function(reason) {
            // We distinguish between errors that occurred
            // during resolution (e.g. beforeModel/model/afterModel),
            // and aborts due to a rejecting promise from shouldContinue().
            wasAborted = true;
            throw reason;
          });
        }

        function handleError(error) {
          // This is the only possible
          // reject value of TransitionState#resolve
          throw {
            error: error,
            wasAborted: wasAborted,
            state: newState
          };
        }

        function proceed(resolvedHandlerInfo) {
          // Swap the previously unresolved handlerInfo with
          // the resolved handlerInfo
          newState.handlerInfos[index++] = resolvedHandlerInfo;
          return resolveOne();
        }

        function resolveOne() {
          if (index === currentState.handlerInfos.length) {
            // This is is the only possible
            // fulfill value of TransitionState#resolve
            return {
              error: null,
              state: newState
            };
          }

          var handlerInfo = currentState.handlerInfos[index];

          return handlerInfo.resolve(innerShouldContinue, payload)
                            .fail(handleError)
                            .then(proceed);
        }
      }
    };


    /**
      @private

      A Transition is a thennable (a promise-like object) that represents
      an attempt to transition to another route. It can be aborted, either
      explicitly via `abort` or by attempting another transition while a
      previous one is still underway. An aborted transition can also
      be `retry()`d later.
     */

    function Transition(router, state) {

      this.state = state;
      this.router = router;
      this.data = {};
      this.sequence = ++Transition.currentSequence;

      var transition = this;

      // Kick off transition.
      if (state) {
        this.promise = state.resolve(checkForAbort, this)
                            .then(saveTransitionToRouter);
      }

      function checkForAbort() {
        if (transition.isAborted) {
          return RSVP.reject();
        }
      }

      function saveTransitionToRouter(result) {
        finalizeTransition(transition, result.state);
      }
    }

    Transition.currentSequence = 0;

    Transition.prototype = {
      targetName: null,
      urlMethod: 'update',
      params: null,
      pivotHandler: null,
      resolveIndex: 0,
      handlerInfos: null,

      isActive: true,

      state: null,

      /**
        The Transition's internal promise. Calling `.then` on this property
        is that same as calling `.then` on the Transition object itself, but
        this property is exposed for when you want to pass around a
        Transition's promise, but not the Transition object itself, since
        Transition object can be externally `abort`ed, while the promise
        cannot.
       */
      promise: null,

      /**
        Custom state can be stored on a Transition's `data` object.
        This can be useful for decorating a Transition within an earlier
        hook and shared with a later hook. Properties set on `data` will
        be copied to new transitions generated by calling `retry` on this
        transition.
       */
      data: null,

      /**
        A standard promise hook that resolves if the transition
        succeeds and rejects if it fails/redirects/aborts.

        Forwards to the internal `promise` property which you can
        use in situations where you want to pass around a thennable,
        but not the Transition itself.

        @param {Function} success
        @param {Function} failure
       */
      then: function(success, failure) {
        return this.promise.then(success, failure);
      },

      /**
        Aborts the Transition. Note you can also implicitly abort a transition
        by initiating another transition while a previous one is underway.
       */
      abort: function() {
        if (this.isAborted) { return this; }
        log(this.router, this.sequence, this.targetName + ": transition was aborted");
        this.isAborted = true;
        this.isActive = false;
        this.router.activeTransition = null;
        return this;
      },

      /**
        Retries a previously-aborted transition (making sure to abort the
        transition if it's still active). Returns a new transition that
        represents the new attempt to transition.
       */
      retry: function() {
        //this.abort();
        //var recogHandlers = this.router.recognizer.handlersFor(this.targetName),
            //handlerInfos  = generateHandlerInfosWithQueryParams(this.router.currentQueryParams, recogHandlers, this.queryParams),
            //newTransition = performTransition(this.router, handlerInfos, this.providedModelsArray, this.params, this.queryParams, this.data);

        //return newTransition;
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

        @param {String} method the type of URL-changing method to use
          at the end of a transition. Accepted values are 'replace',
          falsy values, or any other non-falsy value (which is
          interpreted as an updateURL transition).

        @return {Transition} this transition
       */
      method: function(method) {
        this.urlMethod = method;
        return this;
      },

      /**
        Fires an event on the current list of resolved/resolving
        handlers within this transition. Useful for firing events
        on route hierarchies that haven't fully been entered yet.

        @param {Boolean} ignoreFailure the name of the event to fire
        @param {String} name the name of the event to fire
       */
      trigger: function(ignoreFailure) {
        var args = slice.call(arguments);
        if (typeof ignoreFailure === 'boolean') {
          args.shift();
        } else {
          // Throw errors on unhandled trigger events by default
          ignoreFailure = false;
        }
        trigger(this.router, this.handlerInfos.slice(0, this.resolveIndex + 1), ignoreFailure, args);
      },

      toString: function() {
        return "Transition (sequence " + this.sequence + ")";
      },

      log: function(message) {
        log(this.router, this.sequence, message);
      }
    };

    function Router() {
      this.recognizer = new RouteRecognizer();
      this.state = new TransitionState();
    }

    // TODO: separate into module?
    Router.Transition = Transition;
    Router.TransitionIntent = TransitionIntent;
    Router.TransitionState = TransitionState;

    Router.UnresolvedHandlerInfoByParam = UnresolvedHandlerInfoByParam;
    Router.UnresolvedHandlerInfoByObject = UnresolvedHandlerInfoByObject;
    Router.ResolvedHandlerInfo = ResolvedHandlerInfo;
    Router.HandlerInfo = HandlerInfo;

    Router.NamedTransitionIntent = NamedTransitionIntent;
    Router.URLTransitionIntent = URLTransitionIntent;

    __exports__['default'] = Router;


    /**
      Promise reject reasons passed to promise rejection
      handlers for failed transitions.
     */
    Router.UnrecognizedURLError = function(message) {
      this.message = (message || "UnrecognizedURLError");
      this.name = "UnrecognizedURLError";
    };

    Router.TransitionAborted = function(message) {
      this.message = (message || "TransitionAborted");
      this.name = "TransitionAborted";
    };

    function errorTransition(router, reason) {
      var t = new Transition(router, null);
      t.promise = RSVP.reject(reason);
      return t;
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

        this.recognizer.map(callback, function(recognizer, route) {
          var lastHandler = route[route.length - 1].handler;
          var args = [route, { as: lastHandler }];
          recognizer.add.apply(recognizer, args);
        });
      },

      hasRoute: function(route) {
        return this.recognizer.hasRoute(route);
      },

      /**
        Clears the current and target route handlers and triggers exit
        on each of them starting at the leaf and traversing up through
        its ancestors.
      */
      reset: function() {
        eachHandler(this.currentHandlerInfos || [], function(handlerInfo) {
          var handler = handlerInfo.handler;
          if (handler.exit) {
            handler.exit();
          }
        });
        this.currentHandlerInfos = null;
        this.targetHandlerInfos = null;
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
      transitionTo: function(name) {
        return doTransition(this, arguments);
      },

      intermediateTransitionTo: function(name) {
        doTransition(this, arguments, true);
      },

      /**
        Identical to `transitionTo` except that the current URL will be replaced
        if possible.

        This method is intended primarily for use with `replaceState`.

        @param {String} name the name of the route
      */
      replaceWith: function(name) {
        return doTransition(this, arguments).method('replace');
      },

      /**
        @private

        This method takes a handler name and a list of contexts and returns
        a serialized parameter hash suitable to pass to `recognizer.generate()`.

        @param {String} handlerName
        @param {Array[Object]} contexts
        @return {Object} a serialized parameter hash
      */

      paramsForHandler: function(handlerName, contexts) {
        var partitionedArgs = extractQueryParams(slice.call(arguments, 1));
        return paramsForHandler(this, handlerName, partitionedArgs[0], partitionedArgs[1]);
      },

      /**
        This method takes a handler name and returns a list of query params
        that are valid to pass to the handler or its parents

        @param {String} handlerName
        @return {Array[String]} a list of query parameters
      */
      queryParamsForHandler: function (handlerName) {
        return queryParamsForHandler(this, handlerName);
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

        var params = paramsForHandler(this, handlerName, suppliedParams, queryParams),
          validQueryParams = queryParamsForHandler(this, handlerName);

        var missingParams = [];

        for (var key in queryParams) {
          if (queryParams.hasOwnProperty(key) && !~validQueryParams.indexOf(key)) {
            missingParams.push(key);
          }
        }

        if (missingParams.length > 0) {
          var err = 'You supplied the params ';
          err += missingParams.map(function(param) {
            return '"' + param + "=" + queryParams[param] + '"';
          }).join(' and ');

          err += ' which are not valid for the "' + handlerName + '" handler or its parents';

          throw new Error(err);
        }

        return this.recognizer.generate(handlerName, params);
      },

      isActive: function(handlerName) {
        var partitionedArgs   = extractQueryParams(slice.call(arguments, 1)),
            contexts          = partitionedArgs[0],
            queryParams       = partitionedArgs[1],
            activeQueryParams  = {},
            effectiveQueryParams = {};

        var targetHandlerInfos = this.targetHandlerInfos,
            found = false, names, object, handlerInfo, handlerObj;

        if (!targetHandlerInfos) { return false; }

        var recogHandlers = this.recognizer.handlersFor(targetHandlerInfos[targetHandlerInfos.length - 1].name);
        for (var i=targetHandlerInfos.length-1; i>=0; i--) {
          handlerInfo = targetHandlerInfos[i];
          if (handlerInfo.name === handlerName) { found = true; }

          if (found) {
            var recogHandler = recogHandlers[i];

            merge(activeQueryParams, handlerInfo.queryParams);
            if (queryParams !== false) {
              merge(effectiveQueryParams, handlerInfo.queryParams);
              mergeSomeKeys(effectiveQueryParams, queryParams, recogHandler.queryParams);
            }

            if (handlerInfo.isDynamic && contexts.length > 0) {
              object = contexts.pop();

              if (isParam(object)) {
                var name = recogHandler.names[0];
                if ("" + object !== this.currentParams[name]) { return false; }
              } else if (handlerInfo.context !== object) {
                return false;
              }
            }
          }
        }


        return contexts.length === 0 && found && queryParamsEqual(activeQueryParams, effectiveQueryParams);
      },

      trigger: function(name) {
        var args = slice.call(arguments);
        trigger(this, this.currentHandlerInfos, false, args);
      },

      /**
        Hook point for logging transition status updates.

        @param {String} message The message to log.
      */
      log: null
    };

    function isParam(object) {
      return (typeof object === "string" || object instanceof String || typeof object === "number" || object instanceof Number);
    }

    /**
      @private

      This method takes a handler name and returns a list of query params
      that are valid to pass to the handler or its parents

      @param {Router} router
      @param {String} handlerName
      @return {Array[String]} a list of query parameters
    */
    function queryParamsForHandler(router, handlerName) {
      var handlers = router.recognizer.handlersFor(handlerName),
        queryParams = [];

      for (var i = 0; i < handlers.length; i++) {
        queryParams.push.apply(queryParams, handlers[i].queryParams || []);
      }

      return queryParams;
    }
    /**
      @private

      This method takes a handler name and a list of contexts and returns
      a serialized parameter hash suitable to pass to `recognizer.generate()`.

      @param {Router} router
      @param {String} handlerName
      @param {Array[Object]} objects
      @return {Object} a serialized parameter hash
    */
    function paramsForHandler(router, handlerName, objects, queryParams) {

      var handlers = router.recognizer.handlersFor(handlerName),
          params = {},
          handlerInfos = generateHandlerInfosWithQueryParams(router.currentQueryParams, handlers, queryParams),
          matchPoint = getMatchPoint(router, handlerInfos, objects).matchPoint,
          mergedQueryParams = {},
          object, handlerObj, handler, names, i;

      params.queryParams = {};

      for (i=0; i<handlers.length; i++) {
        handlerObj = handlers[i];
        handler = router.getHandler(handlerObj.handler);
        names = handlerObj.names;

        // If it's a dynamic segment
        if (names.length) {
          // If we have objects, use them
          if (i >= matchPoint) {
            object = objects.shift();
          // Otherwise use existing context
          } else {
            object = handler.context;
          }

          // Serialize to generate params
          merge(params, serialize(handler, object, names));
        }
        if (queryParams !== false) {
          mergeSomeKeys(params.queryParams, router.currentQueryParams, handlerObj.queryParams);
          mergeSomeKeys(params.queryParams, queryParams, handlerObj.queryParams);
        }
      }

      if (queryParamsEqual(params.queryParams, {})) { delete params.queryParams; }
      return params;
    }

    function merge(hash, other) {
      for (var prop in other) {
        if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
      }
    }

    function mergeSomeKeys(hash, other, keys) {
      if (!other || !keys) { return; }
      for(var i = 0; i < keys.length; i++) {
        var key = keys[i], value;
        if(other.hasOwnProperty(key)) {
          value = other[key];
          if(value === null || value === false || typeof value === "undefined") {
            delete hash[key];
          } else {
            hash[key] = other[key];
          }
        }
      }
    }

    /**
      @private
    */

    function generateHandlerInfosWithQueryParams(currentQueryParams, handlers, queryParams) {
      var handlerInfos = [];

      for (var i = 0; i < handlers.length; i++) {
        var handler = handlers[i],
          handlerInfo = { handler: handler.handler, names: handler.names, context: handler.context, isDynamic: handler.isDynamic },
          activeQueryParams = {};

        if (queryParams !== false) {
          mergeSomeKeys(activeQueryParams, currentQueryParams, handler.queryParams);
          mergeSomeKeys(activeQueryParams, queryParams, handler.queryParams);
        }

        if (handler.queryParams && handler.queryParams.length > 0) {
          handlerInfo.queryParams = activeQueryParams;
        }

        handlerInfos.push(handlerInfo);
      }

      return handlerInfos;
    }

    /**
      @private
    */
    function createQueryParamTransition(router, queryParams, isIntermediate) {
      var currentHandlers = router.currentHandlerInfos,
          currentHandler = currentHandlers[currentHandlers.length - 1],
          name = currentHandler.name;

      log(router, "Attempting query param transition");

      return createNamedTransition(router, [name, queryParams], isIntermediate);
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

      @param {Transition} transition
      @param {Array[HandlerInfo]} handlerInfos
    */
    function setupContexts(transition, newState) {
      var handlerInfos = newState.handlerInfos,
          router = transition.router,
          partition = partitionHandlers(router.state, newState);

      router.targetHandlerInfos = handlerInfos;

      eachHandler(partition.exited, function(handlerInfo) {
        var handler = handlerInfo.handler;
        delete handler.context;
        if (handler.exit) { handler.exit(); }
      });

      var currentHandlerInfos = partition.unchanged.slice();
      router.currentHandlerInfos = currentHandlerInfos;

      eachHandler(partition.updatedContext, function(handlerInfo) {
        handlerEnteredOrUpdated(transition, currentHandlerInfos, handlerInfo, false);
      });

      eachHandler(partition.entered, function(handlerInfo) {
        handlerEnteredOrUpdated(transition, currentHandlerInfos, handlerInfo, true);
      });
    }

    /**
      @private

      Helper method used by setupContexts. Handles errors or redirects
      that may happen in enter/setup.
    */
    function handlerEnteredOrUpdated(transition, currentHandlerInfos, handlerInfo, enter) {

      if (transition.isAborted) { return; }

      var handler = handlerInfo.handler,
          context = handlerInfo.context;

      if (enter && handler.enter) { handler.enter(); }
      if (transition.isAborted) { return; }

      setContext(handler, context);
      setQueryParams(handler, handlerInfo.queryParams);

      if (handler.setup) { handler.setup(context, handlerInfo.queryParams); }
      if (transition.isAborted) { return; }

      currentHandlerInfos.push(handlerInfo);
    }


    /**
      @private

      Iterates over an array of `HandlerInfo`s, passing the handler
      and context into the callback.

      @param {Array[HandlerInfo]} handlerInfos
      @param {Function(Object, Object)} callback
    */
    function eachHandler(handlerInfos, callback) {
      for (var i=0, l=handlerInfos.length; i<l; i++) {
        callback(handlerInfos[i]);
      }
    }

    /**
      @private

      determines if two queryparam objects are the same or not
    **/
    function queryParamsEqual(a, b) {
      a = a || {};
      b = b || {};
      var checkedKeys = [], key;
      for(key in a) {
        if (!a.hasOwnProperty(key)) { continue; }
        if(b[key] !== a[key]) { return false; }
        checkedKeys.push(key);
      }
      for(key in b) {
        if (!b.hasOwnProperty(key)) { continue; }
        if (~checkedKeys.indexOf(key)) { continue; }
        // b has a key not in a
        return false;
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
            unchanged: []
          };

      var handlerChanged, contextChanged, queryParamsChanged, i, l;

      for (i=0, l=newHandlers.length; i<l; i++) {
        var oldHandler = oldHandlers[i], newHandler = newHandlers[i];

        if (!oldHandler || oldHandler.handler !== newHandler.handler) {
          handlerChanged = true;
        } else if (!queryParamsEqual(oldHandler.queryParams, newHandler.queryParams)) {
          queryParamsChanged = true;
        }

        if (handlerChanged) {
          handlers.entered.push(newHandler);
          if (oldHandler) { handlers.exited.unshift(oldHandler); }
        } else if (contextChanged || oldHandler.context !== newHandler.context || queryParamsChanged) {
          contextChanged = true;
          handlers.updatedContext.push(newHandler);
        } else {
          handlers.unchanged.push(oldHandler);
        }
      }

      for (i=newHandlers.length, l=oldHandlers.length; i<l; i++) {
        handlers.exited.unshift(oldHandlers[i]);
      }

      return handlers;
    }

    function trigger(router, handlerInfos, ignoreFailure, args) {
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

      for (var i=handlerInfos.length-1; i>=0; i--) {
        var handlerInfo = handlerInfos[i],
            handler = handlerInfo.handler;

        if (handler.events && handler.events[name]) {
          if (handler.events[name].apply(handler, args) === true) {
            eventWasHandled = true;
          } else {
            return;
          }
        }
      }

      if (!eventWasHandled && !ignoreFailure) {
        throw new Error("Nothing handled the event '" + name + "'.");
      }
    }

    function setContext(handler, context) {
      handler.context = context;
      if (handler.contextDidChange) { handler.contextDidChange(); }
    }

    function setQueryParams(handler, queryParams) {
      handler.queryParams = queryParams;
      if (handler.queryParamsDidChange) { handler.queryParamsDidChange(); }
    }


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

    function performIntermediateTransition(router, recogHandlers, matchPointResults) {

      var handlerInfos = generateHandlerInfos(router, recogHandlers);
      for (var i = 0; i < handlerInfos.length; ++i) {
        var handlerInfo = handlerInfos[i];
        handlerInfo.context = matchPointResults.providedModels[handlerInfo.name];
      }

      var stubbedTransition = {
        router: router,
        isAborted: false
      };

      setupContexts(stubbedTransition, handlerInfos);
    }

    /**
      @private
     */
    function didTransition(router, transition) {
      trigger(router, router.currentHandlerInfos, true, ['didTransition']);

      if (router.didTransition) {
        router.didTransition(router.currentHandlerInfos);
      }

      router.activeTransition.isActive = false;
      router.activeTransition = null;

      log(router, transition.sequence, "TRANSITION COMPLETE.");
    }

    /**
      @private

      Accepts handlers in Recognizer format, either returned from
      recognize() or handlersFor(), and returns unified
      `HandlerInfo`s.
     */
    function generateHandlerInfos(router, recogHandlers) {
      var handlerInfos = [];
      for (var i = 0, len = recogHandlers.length; i < len; ++i) {
        var handlerObj = recogHandlers[i],
            isDynamic = handlerObj.isDynamic || (handlerObj.names && handlerObj.names.length);

        var handlerInfo = {
          isDynamic: !!isDynamic,
          name: handlerObj.handler,
          handler: router.getHandler(handlerObj.handler)
        };
        if(handlerObj.queryParams) {
          handlerInfo.queryParams = handlerObj.queryParams;
        }
        handlerInfos.push(handlerInfo);
      }
      return handlerInfos;
    }

    /**
      @private

      Updates the URL (if necessary) and calls `setupContexts`
      to update the router's array of `currentHandlerInfos`.
     */
    function finalizeTransition(transition, newState) {

      log(transition.router, transition.sequence, "Resolved all models on destination route; finalizing transition.");

      var router = transition.router,
          handlerInfos = newState.handlerInfos,
          seq = transition.sequence,
          handlerName = handlerInfos[handlerInfos.length - 1].name,
          params = {},
          len, i;

      var newQueryParams = {};
      for (i = handlerInfos.length - 1; i >= 0; --i) {
        //merge(newQueryParams, handlerInfos[i].queryParams);

        merge(params, handlerInfos[i].params);
      }
      router.currentQueryParams = newQueryParams;

      // TODO: remove this? Risky as some folk might already
      // be using it in their code.
      router.currentParams = params;

      if (transition.urlMethod) {
        var url = router.recognizer.generate(handlerName, params);

        if (transition.urlMethod === 'replace') {
          router.replaceURL(url);
        } else {
          // Assume everything else is just a URL update for now.
          router.updateURL(url);
        }
      }

      setupContexts(transition, newState);

      trigger(router, router.currentHandlerInfos, true, ['didTransition']);

      if (router.didTransition) {
        router.didTransition(handlerInfos);
      }

      log(router, transition.sequence, "TRANSITION COMPLETE.");

      // Resolve with the final handler.
      transition.isActive = false;


      // TODO: de-promise-landify. What needs to happen here?
      return handlerInfos[handlerInfos.length - 1].handler;
    }

    /**
      @private

      The router calls the various handler hooks outside
      of the context of RSVP's try/catch block so that
      errors synchronously thrown from these hooks are
      not caught by RSVP and treated as rejected promises.
      This function reuses RSVP's configurable `async`
      method to escape that try/catch block.
     */
    function async(callback) {
      return new RSVP.Promise(function(resolve) {
        RSVP.async(function() {
          resolve(callback());
        });
      });
    }

    /**
      @private

      Logs and returns a TransitionAborted error.
     */
    function logAbort(transition) {
      log(transition.router, transition.sequence, "detected abort.");
      return new Router.TransitionAborted();
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

      var intent;
      if(args.length === 1 && args[0].hasOwnProperty('queryParams')) {
        throw new Error("not implemented");
        //return createQueryParamTransition(router, args[0], isIntermediate);
      } else if (name.charAt(0) === '/') {
        intent = new URLTransitionIntent({
          url: name
        });
      } else {
        intent = new NamedTransitionIntent({
          name: args[0],
          contexts: slice.call(args, 1)
        });
      }

      var oldState = router.activeTransition ?
                     router.activeTransition.state : router.state;

      try {
        var newState = intent.applyToState(oldState, router.recognizer, router.getHandler);

        return new Transition(router, newState);
      } catch(e) {
        return errorTransition(router, e);
      }
    }

    /**
      @private

      Serializes a handler using its custom `serialize` method or
      by a default that looks up the expected property name from
      the dynamic segment.

      @param {Object} handler a router handler
      @param {Object} model the model to be serialized for this handler
      @param {Array[Object]} names the names array attached to an
        handler object returned from router.recognizer.handlersFor()
    */
    function serialize(handler, model, names) {

      var object = {};
      if (isParam(model)) {
        object[names[0]] = model;
        return object;
      }

      // Use custom serialize if it exists.
      if (handler.serialize) {
        return handler.serialize(model, names);
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
