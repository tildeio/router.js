(function(exports, RouteRecognizer) {
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


  function Transition(router, handlerInfos, updateURLMethod) {
    this.router = router;
    this.handlerInfos = handlerInfos;
    this.updateURLMethod = updateURLMethod;
    this.numPromises = 0;
    this.resolvedContexts = [];
  }

  Transition.prototype = {
  
    /**
      Perform the transition.
    */
    start: function() { this._step(0); },

    /**
      @private

      This updates the URL for `transitionTo` once
      the transition is complete and all context
      promises (if any) have been resolved.
    */
    _updateURL: function() {
      if (!this.finished || this.numPromises !== 0 || !this.updateURLMethod || this.updatedURL) { return; }
      var url = urlForObjects(this.router, this.handlerInfos, this.resolvedContexts, true);
      this.updateURLMethod.call(this.router, url);
      this.updatedURL = true;
    },

    /**
      @private

      This function steps through the transition process,
      pausing along the way if promise contexts are 
      encounter (and a loading state is available).

      Takes an array of functions that, when called, yield
      a `HandlerInfo` that'll be used to build up the final
      array of `HandlerInfo`s to be passed to `setupContexts`.

      If the context provided in a `HandlerInfo` is a promise
      (i.e. has a method called `then`), and a 'loading' 
      handler has been provided, this function will pause
      until the promise is resolved. Otherwise, the function
      will proceed with the transition even if the context
      is a promise.
    */
    _step: function(index) {
      if(index === this.handlerInfos.length) {
        exitLoadingState(this.router);
        setupContexts(this.router, this.handlerInfos);

        this.finished = true;
        this._updateURL();
        return;
      }

      var self = this,
          handlerInfo = this.handlerInfos[index],
          context = handlerInfo.context(),
          resolvedContextsIndex = this.resolvedContexts.length;

      if (context && typeof context.then === 'function') {
        if (handlerInfo.isDynamic && this.updateURLMethod) {
          // We'll still need to update the URL at the end of this
          // transition, after all contexts have resolved.

          // Reserve a spot for this context. It will be replaced later.
          // A leafier route's context may resolve before a parent context, 
          // so we have to be careful to preserve the ordering.
          this.numPromises++;
          this.resolvedContexts[resolvedContextsIndex] = context;
          context.then(function(value) {
            self.numPromises--;
            self.resolvedContexts[resolvedContextsIndex] = value;
            self._updateURL();
          });
        }

        if (enterLoadingState(this.router, handlerInfo.name)) {
          // We've entered the loading state associated with this route, so
          // set up a promise so we can leave the loading state once it's resolved.
          // The chained `then` means that we can also catch errors that happen in `proceed`
          context.then(proceed).then(null, function(error) {
            enterFailureState(self.router, error);
          });
        } else {
          // No loading state associated with this route, so continue
          // transitioning without waiting for promise to resolve.
          proceed(context);
        }
      } else {
        if (handlerInfo.isDynamic && this.updateURLMethod) {
          this.resolvedContexts[resolvedContextsIndex] = context;
        }
        proceed(context);
      }

      function proceed(value) {
        handlerInfo.context = value;

        if (handlerInfo.isDynamic) { 
          self.resolvedContexts[resolvedContextsIndex] = handlerInfo.context;
        }

        var handler = handlerInfo.handler;
        if (handler.context !== handlerInfo.context) {
          setContext(handler, handlerInfo.context);
        }

        self._step(index + 1);
      }
    }
  };


  function Router() {
    this.recognizer = new RouteRecognizer();
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
      The entry point for handling a change to the URL (usually
      via the back and forward button). This will perform a transition
      into the handlers that match the provided URL unless the 
      transition is halted or redirected by a handler's
      TransitionEvent handlers.

      @param {String} url a URL to process
    */
    handleURL: function(url) {
      var results = this.recognizer.recognize(url);

      // URL-less routes should also not be recognized.
      if (!results || this.getHandler(results[results.length - 1].handler).notAccessibleByURL) {
        throw new Error("No route matched the URL '" + url + "'");
      }

      var handlerInfos = [], router = this;
      for (var i = 0; i < results.length; i += 1) {
        var result = results[i], name = result.handler, handler = router.getHandler(name);

        handlerInfos.push({ 
          isDynamic: result.isDynamic, 
          handler: handler, 
          name: name, 
          context: getHandleURLContextResolver(handler, result.params)
        });
      }

      if (!runTransitionHandlers(router, handlerInfos)) { return; }

      var transition = new Transition(this, handlerInfos);
      transition.start();
    },


    /**
      Configure whether `updateURL`/`replaceURL` should be called
      immediately at the beginning of `transitionTo` or whether
      it should wait until all promises are resolved. 

      The default behavior (null) is optimistic;
      it will try to change the URL right away, but if a URL
      can't be serialized, it'll wait until all promises are
      resolved and try again later. 

      When set to true (aggressive), the URL is changed immediately,
      and if a URL can't be serialized, an Error will be raised.

      When set to false, the URL will only be changed at the
      very end of a `transitionTo`, after all promises have
      resolved.

      @param {String} url a URL to update to
    */
    updateURLImmediately: null,

    /**
      Hook point for updating the URL.

      @param {String} url a URL to update to
    */
    updateURL: function() {
      throw "updateURL is not implemented";
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
      var objects = Array.prototype.slice.call(arguments, 1),
          transition = getDirectTransition(this, name, objects, this.updateURL);
      if(!transition) { return; }
      transition.start();
    },

    /**
      Identical to `transitionTo` except that the current URL will be replaced
      if possible.

      This method is intended primarily for use with `replaceState`.

      @param {String} name the name of the route
    */
    replaceWith: function(name) {
      var objects = Array.prototype.slice.call(arguments, 1),
          transition = getDirectTransition(this, name, objects, this.replaceURL);
      if(!transition) { return; }
      transition.start();
    },

    /**
      @private

      This method takes a handler name and a list of contexts and returns
      a serialized parameter hash suitable to pass to `recognizer.generate()`.

      @param {String} handlerName
      @param {Array[Object]} contexts
      @return {Object} a serialized parameter hash
    */
    paramsForHandler: function(handlerName) {
      var handlers = this.recognizer.handlersFor(handlerName),
          objects = [].slice.call(arguments, 1),
          params = {},
          objectsToMatch = objects.length,
          startIdx = handlers.length,
          object, objectChanged, handlerObj, handler, names, i;

      // Find out which handler to start matching at
      for (i=handlers.length-1; i>=0 && objectsToMatch>0; i--) {
        if (handlers[i].names.length) {
          objectsToMatch--;
          startIdx = i;
        }
      }

      if (objectsToMatch > 0) {
        throw "More objects were passed than dynamic segments";
      }

      // Connect the objects to the routes
      for (i=0; i<handlers.length; i++) {
        handlerObj = handlers[i];
        handler = this.getHandler(handlerObj.handler);
        names = handlerObj.names;

        // If it's a dynamic segment
        if (handlerObj.names.length) {
          // If we have objects, use them
          if (i >= startIdx) {
            object = objects.shift();
          // Otherwise use existing context
          } else {
            object = handler.context;
          }

          // Serialize to generate params
          if (handler.serialize) {
            merge(params, handler.serialize(object, handlerObj.names));
          }
        } 
      }

      return params;
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
      var params = this.paramsForHandler.apply(this, arguments);
      return this.recognizer.generate(handlerName, params);
    },

    isActive: function(handlerName) {
      var contexts = [].slice.call(arguments, 1);

      var currentHandlerInfos = this.currentHandlerInfos,
          found = false, names, object, handlerInfo, handlerObj;

      for (var i=currentHandlerInfos.length-1; i>=0; i--) {
        handlerInfo = currentHandlerInfos[i];
        if (handlerInfo.name === handlerName) { found = true; }

        if (found) {
          if (contexts.length === 0) { break; }

          if (handlerInfo.isDynamic) {
            object = contexts.pop();
            if (handlerInfo.context !== object) { return false; }
          }
        }
      }

      return contexts.length === 0 && found;
    },

    trigger: function(name) {
      var args = [].slice.call(arguments);
      trigger(this, args);
    }
  };

  function merge(hash, other) {
    for (var prop in other) {
      if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
    }
  }

  function isCurrent(currentHandlerInfos, handlerName) {
    return currentHandlerInfos[currentHandlerInfos.length - 1].name === handlerName;
  }

  /**
    @private

    This function will resolve the `loading` handler, if one has
    been specified, and trigger `enter` and `setup` on it if
    the router has not already entered the loading state for 
    this particular transition.

    Returns true if a `loading` handler exists, else false.
    This return value is used to determine whether a transition
    should pause when a promise context is encountered,
    for both `transitionTo` and `handleURL` transitions.
    If true (`loading` handler was found), the transition 
    will pause for both transition types and only continue
    once the promise has been resolved. If false, the 
    transition will continue without pausing.

    @param {Router} router
    @return {Boolean} true if loading state exists, else false
  */
  function enterLoadingState(router) {
    var handler = router.getHandler('loading');
    if(!handler) { return false; }

    if (!router.isLoading) {
      router.isLoading = true;
      if (handler.enter) { handler.enter(); }
      if (handler.setup) { handler.setup(); }
    }
    return true;
  }

  /**
    @private

    This function is called if a promise was previously
    encountered once all promises are resolved.

    It triggers the `exit` method on the `loading` handler,
    if one exists.

    @param {Router} router
  */
  function exitLoadingState(router) {
    router.isLoading = false;
    var handler = router.getHandler('loading');
    if (handler && handler.exit) { handler.exit(); }
  }

  /**
    @private

    This function is called if any encountered promise
    is rejected.

    It triggers the `exit` method on the `loading` handler
    and the `setup` method on the `failure` handler with the
    `error`.

    @param {Router} router
    @param {Object} error the reason for the promise
      rejection, to pass into the failure handler's
      `setup` method.
  */
  function enterFailureState(router, error) {
    exitLoadingState(router);
    var handler = router.getHandler('failure');
    if (handler && handler.enter) { handler.enter(error); }
    if (handler && handler.setup) { handler.setup(error); }
  }

  /**
    @private

    This function generates and returns a Transition object based 
    on the handler name and context objects provided, or returns
    null if the transition was halted or redirected.

    @param {Router} router
    @param {String} name The name of the target handler to
      transition into.
    @param {Array} objects the context objects to be passed
      to handlers with dynamic parameters.
    @param {Function} updateURLMethod `updateURL` or `replaceURL`,
      the method used for changing the URL to reflect this transition.
  */
  function getDirectTransition(router, name, objects, updateURLMethod) {

    var handlers = router.recognizer.handlersFor(name),
        startIdx = handlers.length,
        objectsToMatch = objects.length,
        i, len;

    // Find out which handler to start matching at
    for (i=handlers.length-1; i>=0 && objectsToMatch>0; i--) {
      if (handlers[i].names.length) {
        objectsToMatch--;
        startIdx = i;
      }
    }

    if (objectsToMatch > 0) {
      throw "More objects were passed than dynamic segments";
    }

    var handlerInfos = [], objectIndex = 0;
    for (i=0, len=handlers.length; i<len; i++) {
      var handlerObj = handlers[i],
          handlerName = handlerObj.handler,
          handler = router.getHandler(handlerName),
          isDynamic = !!handlerObj.names.length,
          objectToUse = null;

      if(isDynamic && i >= startIdx) {
        objectToUse = objects[objectIndex++];
      }

      handlerInfos.push({ 
        isDynamic: isDynamic, 
        handler: handler, 
        name: handlerName, 
        context: getTransitionToContextResolver(isDynamic, i, startIdx, objectToUse, handler)
      });
    }

    if (!runTransitionHandlers(router, handlerInfos)) { return; }

    if (handlerInfos[handlerInfos.length - 1].handler.notAccessibleByURL) {
      // This is a URL-less transition, so don't attempt to change the URL.
      updateURLMethod = null;
    }

    if (updateURLMethod && router.updateURLImmediately !== false) {
      // Attempt to generate the new URL immediately.
      var url = urlForObjects(router, handlerInfos, objects, router.updateURLImmediately === true);
      if(url) {
        // Perform the URL change and prevent the Transition from doing it later.
        updateURLMethod.call(router, url);
        updateURLMethod = null;
      }
    }

    return new Transition(router, handlerInfos, updateURLMethod);
  }


  /**
    @private
 
    This function as called at the end of a 
    `transitionTo` transition to perform the update to the 
    URL. This function will fail and return false if 
    a valid URL cannot be serialized by the context
    objects provided, which can happen if `serialize`
    is called with a promise which doesn't have enough
    information on it to generate a URL param. 

    This function is used twice: once at the beginning
    of a `transitionTo` to immediately attempt a URL
    change

  */
  function urlForObjects(router, handlerInfos, objects, errorOnFailure) {
    var lastHandlerName = handlerInfos[handlerInfos.length - 1].name,
        params = router.paramsForHandler.apply(router, [lastHandlerName].concat(objects));

    // Validate that the paramsForHandler did return invalid parameters, e.g.
    // parameters with null/undefined values.
    for (var key in params) {
      if (!params.hasOwnProperty(key)) { continue; }

      var value = params[key];
      if (typeof value === "undefined" || value === null) {
        if (errorOnFailure) {
          throw new Error("Could not generate URL. Check that your serialize functions aren't populating the params hash with undefined/null values.");
        } else {
          return null;
        }
      }
    }
    return router.recognizer.generate(lastHandlerName, params);
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
       1. Triggers the `deserialize` callback on the
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

    @param {Router} router
    @param {Array[HandlerInfo]} handlerInfos
  */
  function setupContexts(router, handlerInfos) {
    var partition =
      partitionHandlers(router.currentHandlerInfos || [], handlerInfos);

    router.currentHandlerInfos = handlerInfos;

    eachHandler(partition.exited, function(handler, context) {
      delete handler.context;
      if (handler.exit) { handler.exit(); }
    });

    eachHandler(partition.updatedContext, function(handler, context) {
      setContext(handler, context);
      if (handler.setup) { handler.setup(context); }
    });

    var aborted = false;
    eachHandler(partition.entered, function(handler, context) {
      if (aborted) { return; }
      if (handler.enter) { handler.enter(); }

      setContext(handler, context);

      if (handler.setup) {
        if (false === handler.setup(context)) {
          aborted = true;
        }
      }
    });

    // Perform post-transition client hook.
    if (router.didTransition) {
      router.didTransition(handlerInfos);
    }
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
      var handlerInfo = handlerInfos[i],
          handler = handlerInfo.handler,
          context = handlerInfo.context;

      callback(handler, context);
    }
  }

  /**
    @private

    This function is called when transitioning from one URL to
    another to determine which handlers are not longer active,
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

    The PartitionedHandlers structure has three fields:

    * `updatedContext`: a list of `HandlerInfo` objects that
      represent handlers that remain active but have a changed
      context
    * `entered`: a list of `HandlerInfo` objects that represent
      handlers that are newly active
    * `exited`: a list of `HandlerInfo` objects that are no
      longer active.

    @param {Array[HandlerInfo]} oldHandlers a list of the handler
      information for the previous URL (or `[]` if this is the
      first handled transition)
    @param {Array[HandlerInfo]} newHandlers a list of the handler
      information for the new URL

    @return {Partition}
  */
  function partitionHandlers(oldHandlers, newHandlers) {
    var handlers = {
          updatedContext: [],
          exited: [],
          entered: []
        };

    var handlerChanged, contextChanged, i, l;

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
      }
    }

    for (i=newHandlers.length, l=oldHandlers.length; i<l; i++) {
      handlers.exited.unshift(oldHandlers[i]);
    }

    return handlers;
  }

  function trigger(router, args) {
    var currentHandlerInfos = router.currentHandlerInfos;

    var name = args.shift();

    if (!currentHandlerInfos) {
      throw new Error("Could not trigger event '" + name + "'. There are no active handlers");
    }

    for (var i=currentHandlerInfos.length-1; i>=0; i--) {
      var handlerInfo = currentHandlerInfos[i],
          handler = handlerInfo.handler;

      if (handler.events && handler.events[name]) {
        handler.events[name].apply(handler, args);
        return;
      }
    }

    throw new Error("Nothing handled the event '" + name + "'.");
  }

  function setContext(handler, context) {
    handler.context = context;
    if (handler.contextDidChange) { handler.contextDidChange(); }
  }

  /**
    This is the transition event passed to transition handlers, used
    for cancelling or redirecting an intended transition.
  */
  function TransitionEvent(router, handlerInfos) {
    this.router = router;
    this.handlerInfos = handlerInfos;
    this.currentIndex = 0;
  }

  /**
    The `TransitionEvent` prototype contains all the public API
    for transition event handlers declared in the `transitions`
    hash of the handler. 
   */
  TransitionEvent.prototype = {
    /**
      Halts the attempted transition and forwards arguments to
      the router's `transitionTo`. Use this function to halt
      and redirect a transition elsewhere.
     */
    transitionTo: function() {
      this.preventTransition();
      this.router.transitionTo.apply(this.router, arguments);
    },

    /**
      Halts the attempted transition.
     */
    preventTransition: function() {
      this.transitionCancelled = true;
    },

    /**
      Returns the context object for this handler. 
     */
    getContext: function() {
      if(this.isDestinationRoute) {
        return this.handlerInfos[this.currentIndex].context();
      } else {
        throw new Error("getContext() can only be called from within destination routes.");
      }
    }
  };

  /**
    @private

    Executes all matching transition event handlers defined
    in the `transitions` hash on the handlers. Halts the
    algorithm and returns false if any one of the handlers
    prevented or redirected the transition.

    Order of handler execution is as follows:
    1) Execute source handlers leaf to root
    2) Execute destination handlers from leaf to root
   */
  function runTransitionHandlers(router, destHandlerInfos) {
    var transitionEvent = new TransitionEvent(router, destHandlerInfos),
        sourceHandlerInfos = router.currentHandlerInfos, i;

    // sourceHandlerInfos won't exist for very first transition.
    if(sourceHandlerInfos) {
      for (i = sourceHandlerInfos.length - 1; i >= 0; i--) {
        if(!processTransitionRules(true, sourceHandlerInfos[i], sourceHandlerInfos, destHandlerInfos, transitionEvent)) {
          return false;
        }
      }
    }

    if (transitionEvent.transitionCancelled) { return false; }
    transitionEvent.isDestinationRoute = true;

    for (i = 0; i < destHandlerInfos.length; i++) {
      // Update the current context index on the transitionEvent
      // so that getContext() will return the correct one. 
      transitionEvent.currentIndex = i;
      if(!processTransitionRules(false, destHandlerInfos[i], sourceHandlerInfos, destHandlerInfos, transitionEvent)) {
        return false;
      }
    }

    return true;
  }

  /**
    @private

    Runs matching transition event handlers for a given `handlerInfo`.
    Returns false if the transition was halted or redirected, else true.
   */
  function processTransitionRules(checkingSourceRoutes, handlerInfo, sourceHandlerInfos, destHandlerInfos, transitionEvent) {
    var handler = handlerInfo.handler, transitions = handler.transitions;
    if(!transitions) { return true; }

    for (var transitionRule in transitions) {
      if (!transitions.hasOwnProperty(transitionRule)) { continue; }

      var split = transitionRule.split(' '), fromTo = split[0], routeName = split[1], 
          runHandler = null, handlerInfosToCheck = null;
    
      if (fromTo === 'to') {
        if (checkingSourceRoutes) {
          if (routeName === '*' && sourceHandlerInfos) {
            runHandler = !checkHandlerMembership(handlerInfo.name, destHandlerInfos);
          } else {
            runHandler = checkHandlerMembership(routeName, destHandlerInfos);
          }
        }
      } else if (fromTo === 'from') {
        if (!checkingSourceRoutes) {
          if (routeName === '*') {
            runHandler = !checkHandlerMembership(handlerInfo.name, sourceHandlerInfos);
          } else if (sourceHandlerInfos) {
            runHandler = checkHandlerMembership(routeName, sourceHandlerInfos);
          }
        }
      } else {
        throw new Error("Badly formed transition handler key (expected 'to' or 'from'): " + transitionRule);
      }

      if (runHandler) {
        var transitionHandler = transitions[transitionRule];
        transitionHandler.call(handler, transitionEvent);

        if(transitionEvent.transitionCancelled) { return false; }
      }
    }
    return true;
  }

  function checkHandlerMembership(routeName, handlerInfos) {
    for (var i = 0; i < handlerInfos.length; i += 1) {
      if(handlerInfos[i].name === routeName) { return true; }
    }
    return false;
  }

  /**
    @private

    Returns a function that returns the context to use for
    the provided `handler`. This is used for `handleURL`
    transitions, and therefore makes use of the handler's
    `deserialize` function to determine the context to use.
   */
  function getHandleURLContextResolver(handler, params) {
    var cachedContext;
    return function() {
      if(cachedContext) { return cachedContext; }
      return cachedContext = handler.deserialize && handler.deserialize(params);
    };
  }

  /**
    @private

    Returns a function that returns the context to use for
    the provided `handler`. This is used for `transitionTo`
    transitions.
   */
  function getTransitionToContextResolver(isDynamic, index, startIndex, object, handler) {
    var cachedContext;
    return function() {
      if(cachedContext) { return cachedContext; }

      if (isDynamic) {
        if(index < startIndex) {
          object = handler.context;
        }
      } else {
        // If we've passed the match point we need to deserialize again
        // or if we never had a context
        if (index > startIndex || !handler.hasOwnProperty('context')) {
          if (handler.deserialize) {
            object = handler.deserialize({});
          }
        // Otherwise use existing context
        } else {
          object = handler.context;
        }
      }
      return cachedContext = object;
    };
  }

  exports.Router = Router;
})(window, window.RouteRecognizer);
