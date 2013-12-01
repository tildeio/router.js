"use strict";
var RouteRecognizer = require("route-recognizer")['default'];
var RSVP = require("rsvp")['default'];

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

  resolve: function(async, shouldContinue, payload) {
    var checkForAbort  = bind(this.checkForAbort,      this, shouldContinue),
        beforeModel    = bind(this.runBeforeModelHook, this, async, payload),
        model          = bind(this.getModel,           this, async, payload),
        afterModel     = bind(this.runAfterModelHook,  this, async, payload),
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

  runBeforeModelHook: function(async, payload) {
    if (payload.trigger) {
      payload.trigger(true, 'willResolveModel', payload, this.handler);
    }
    return this.runSharedModelHook(async, payload, 'beforeModel', []);
  },

  runAfterModelHook: function(async, payload, resolvedModel) {
    // Stash the resolved model on the payload.
    // This makes it possible for users to swap out
    // the resolved model in afterModel.
    var name = this.name;
    this.stashResolvedModel(payload, resolvedModel);

    return this.runSharedModelHook(async, payload, 'afterModel', [resolvedModel])
               .then(function() {
                 // Ignore the fulfilled value returned from afterModel.
                 // Return the value stashed in resolvedModels, which
                 // might have been swapped out in afterModel.
                 return payload.resolvedModels[name];
               });
  },

  runSharedModelHook: function(async, payload, hookName, args) {
    this.log(payload, "calling " + hookName + " hook");

    if (this.queryParams) {
      args.push(this.queryParams);
    }
    args.push(payload);

    var handler = this.handler;
    return async(function() {
      var p = handler[hookName] && handler[hookName].apply(handler, args);
      return (p instanceof Transition) ? null : p;
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

  stashResolvedModel: function(payload, resolvedModel) {
    payload.resolvedModels = payload.resolvedModels || {};
    payload.resolvedModels[this.name] = resolvedModel;
  },

  becomeResolved: function(payload, resolvedContext) {
    var params = this.params || serialize(this.handler, resolvedContext, this.names);

    if (payload) {
      this.stashResolvedModel(payload, resolvedContext);
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
    // 4) This handler has parameters that don't match the other.
    if (!other) { return true; }

    var contextsMatch = (other.context === this.context);
    return other.name !== this.name ||
           (this.hasOwnProperty('context') && !contextsMatch) ||
           (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params));
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
UnresolvedHandlerInfoByParam.prototype.getModel = function(async, payload) {
  return this.runSharedModelHook(async, payload, 'model', [this.params]);
};


// These are generated only for named transitions
// with dynamic route segments.
function UnresolvedHandlerInfoByObject(props) {
  HandlerInfo.call(this, props);
}

UnresolvedHandlerInfoByObject.prototype = oCreate(HandlerInfo.prototype);
UnresolvedHandlerInfoByObject.prototype.getModel = function(async, payload) {
  this.log(payload, this.name + ": resolving provided model");
  return RSVP.resolve(this.context);
};

function TransitionIntent(props) {
  if (props) {
    merge(this, props);
  }
  this.data = this.data || {};
}

TransitionIntent.prototype.applyToState = function(oldState) {
  // Default TransitionIntent is a no-op.
  return oldState;
};

function URLTransitionIntent(props) {
  TransitionIntent.call(this, props);
}

URLTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
URLTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler) {
  var newState = new TransitionState();

  var results = recognizer.recognize(this.url),
      queryParams = {},
      i, len;

  if (!results) {
    throw new Router.UnrecognizedURLError(this.url);
  }

  var statesDiffer = false;

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
    if (statesDiffer || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
      statesDiffer = true;
      newState.handlerInfos[i] = newHandlerInfo;
    } else {
      newState.handlerInfos[i] = oldHandlerInfo;
    }
  }

  // TODO: query params
  //for(i = 0, len = results.length; i < len; i++) {
    //merge(queryParams, results[i].queryParams);
  //}

  return statesDiffer ? newState : oldState;
};


function NamedTransitionIntent(props) {
  TransitionIntent.call(this, props);
}

NamedTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
NamedTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler, isIntermediate) {

  var partitionedArgs     = extractQueryParams([this.name].concat(this.contexts)),
    pureArgs              = partitionedArgs[0],
    queryParams           = partitionedArgs[1],
    handlers              = recognizer.handlersFor(pureArgs[0]);
    //handlerInfos          = generateHandlerInfosWithQueryParams({}, handlers, queryParams);

  var targetRouteName = handlers[handlers.length-1].handler;

  return this.applyToHandlers(oldState, handlers, getHandler, targetRouteName, isIntermediate);
};

NamedTransitionIntent.prototype.applyToHandlers = function(oldState, handlers, getHandler, targetRouteName, isIntermediate, checkingIfActive) {

  var newState = new TransitionState();
  var objects = this.contexts.slice(0);

  var invalidateIndex = handlers.length;
  var nonDynamicIndexes = [];

  for (var i = handlers.length - 1; i >= 0; --i) {
    var result = handlers[i];
    var name = result.handler;
    var handler = getHandler(name);

    var oldHandlerInfo = oldState.handlerInfos[i];
    var newHandlerInfo = null;

    if (result.names.length > 0) {
      newHandlerInfo = this.getHandlerInfoForDynamicSegment(name, handler, result.names, objects, oldHandlerInfo, targetRouteName);
    } else {
      // This route has no dynamic segment.
      // Therefore treat as a param-based handlerInfo
      // with empty params. This will cause the `model`
      // hook to be called with empty params, which is desirable.
      newHandlerInfo = this.createParamHandlerInfo(name, handler, result.names, objects, oldHandlerInfo);
      nonDynamicIndexes.unshift(i);
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
    if (newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
      invalidateIndex = i;
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
    this.invalidateNonDynamicHandlers(newState.handlerInfos, nonDynamicIndexes, invalidateIndex);
  }

  return invalidateIndex < handlers.length ? newState : oldState;
};

NamedTransitionIntent.prototype.invalidateNonDynamicHandlers = function(handlerInfos, indexes, invalidateIndex) {
  forEach(indexes, function(i) {
    if (i >= invalidateIndex) {
      var handlerInfo = handlerInfos[i];
      handlerInfos[i] = new UnresolvedHandlerInfoByParam({
        name: handlerInfo.name,
        handler: handlerInfo.handler,
        params: {}
      });
    }
  });
};

NamedTransitionIntent.prototype.getHandlerInfoForDynamicSegment = function(name, handler, names, objects, oldHandlerInfo, targetRouteName) {

  var numNames = names.length;
  var objectToUse;
  if (objects.length > 0) {

    // Use the objects provided for this transition.
    objectToUse = objects[objects.length - 1];
    if (isParam(objectToUse)) {
      return this.createParamHandlerInfo(name, handler, names, objects, oldHandlerInfo);
    } else {
      objects.pop();
    }
  } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
    // Reuse the matching oldHandlerInfo
    return oldHandlerInfo;
  } else {
    throw new Error("Not enough context objects were provided to complete a transition to " + targetRouteName + ". Specifically, the " + name + " route needs an object that can be serialized into its dynamic URL segments [" + names.join(', ') + "]");
  }

  return new UnresolvedHandlerInfoByObject({
    name: name,
    handler: handler,
    context: objectToUse,
    names: names
  });
};

NamedTransitionIntent.prototype.createParamHandlerInfo = function(name, handler, names, objects, oldHandlerInfo) {
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

  return new UnresolvedHandlerInfoByParam({
    name: name,
    handler: handler,
    params: params
  });
};

function TransitionState(other) {
  this.handlerInfos = [];
}

TransitionState.prototype = {
  resolve: function(async, shouldContinue, payload) {

    payload = payload || {};
    payload.resolveIndex = 0;

    var currentState = this;
    var wasAborted = false;

    // The prelude RSVP.resolve() asyncs us into the promise land.
    return RSVP.resolve().then(resolveOne).fail(handleError);

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
        handlerWithError: currentState.handlerInfos[payload.resolveIndex].handler,
        wasAborted: wasAborted,
        state: currentState
      };
    }

    function proceed(resolvedHandlerInfo) {
      // Swap the previously unresolved handlerInfo with
      // the resolved handlerInfo
      currentState.handlerInfos[payload.resolveIndex++] = resolvedHandlerInfo;

      // Call the redirect hook. The reason we call it here
      // vs. afterModel is so that redirects into child
      // routes don't re-run the model hooks for this
      // already-resolved route.
      var handler = resolvedHandlerInfo.handler;
      if (handler && handler.redirect) {
        handler.redirect(resolvedHandlerInfo.context, payload);
      }

      // Proceed after ensuring that the redirect hook
      // didn't abort this transition by transitioning elsewhere.
      return innerShouldContinue().then(resolveOne);
    }

    function resolveOne() {
      if (payload.resolveIndex === currentState.handlerInfos.length) {
        // This is is the only possible
        // fulfill value of TransitionState#resolve
        return {
          error: null,
          state: currentState
        };
      }

      var handlerInfo = currentState.handlerInfos[payload.resolveIndex];

      return handlerInfo.resolve(async, innerShouldContinue, payload)
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

function Transition(router, intent, state, error) {
  var transition = this;
  this.state = state || router.state;
  this.intent = intent;
  this.router = router;
  this.data = this.intent && this.intent.data || {};
  this.resolvedModels = {};
  this.params = {};

  if (error) {
    this.promise = RSVP.reject(error);
    return;
  }

  if (state) {
    var len = state.handlerInfos.length;
    if (len) {
      this.targetName = state.handlerInfos[state.handlerInfos.length-1].name;
    }

    for (var i = 0; i < len; ++i) {
      var handlerInfo = state.handlerInfos[i];
      if (!(handlerInfo instanceof ResolvedHandlerInfo)) {
        break;
      }
      this.pivotHandler = handlerInfo.handler;
    }

    this.sequence = Transition.currentSequence++;
    this.promise = state.resolve(router.async, checkForAbort, this).fail(function(result) {
      if (result.wasAborted) {
        throw logAbort(transition);
      } else {
        transition.trigger('error', result.error, transition, result.handlerWithError);
        transition.abort();
        throw result.error;
      }
    });
  } else {
    this.promise = RSVP.resolve(this.state);
  }

  function checkForAbort() {
    if (transition.isAborted) {
      return RSVP.reject();
    }
  }
}

Transition.currentSequence = 0;

Transition.prototype = {
  targetName: null,
  urlMethod: 'update',
  intent: null,
  params: null,
  pivotHandler: null,
  resolveIndex: 0,
  handlerInfos: null,
  resolvedModels: null,
  isActive: true,
  state: null,

  /**
    @public

    The Transition's internal promise. Calling `.then` on this property
    is that same as calling `.then` on the Transition object itself, but
    this property is exposed for when you want to pass around a
    Transition's promise, but not the Transition object itself, since
    Transition object can be externally `abort`ed, while the promise
    cannot.
   */
  promise: null,

  /**
    @public

    Custom state can be stored on a Transition's `data` object.
    This can be useful for decorating a Transition within an earlier
    hook and shared with a later hook. Properties set on `data` will
    be copied to new transitions generated by calling `retry` on this
    transition.
   */
  data: null,

  /**
    @public

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
    @public

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
    @public

    Retries a previously-aborted transition (making sure to abort the
    transition if it's still active). Returns a new transition that
    represents the new attempt to transition.
   */
  retry: function() {
    // TODO: add tests for merged state retry()s
    this.abort();
    return transitionByIntent(this.router, this.intent, false);
  },

  /**
    @public

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
    @public

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
    trigger(this.router, this.state.handlerInfos.slice(0, this.resolveIndex + 1), ignoreFailure, args);
  },

  /**
    @public

    Transitions are aborted and their promises rejected
    when redirects occur; this method returns a promise
    that will follow any redirects that occur and fulfill
    with the value fulfilled by any redirecting transitions
    that occur.

    @return {Promise} a promise that fulfills with the same
      value that the final redirecting transition fulfills with
   */
  followRedirects: function() {
    var router = this.router;
    return this.promise.fail(function(reason) {
      if (router.activeTransition) {
        return router.activeTransition.followRedirects();
      }
      throw reason;
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

function Router() {
  this.recognizer = new RouteRecognizer();

  this.reset();
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

exports['default'] = Router;


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
    if (this.state) {
      forEach(this.state.handlerInfos, function(handlerInfo) {
        var handler = handlerInfo.handler;
        if (handler.exit) {
          handler.exit();
        }
      });
    }

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

    // Construct a TransitionIntent with the provided params
    // and apply it to the present state of the router.
    var intent = new NamedTransitionIntent({ name: handlerName, contexts: suppliedParams });
    var state = intent.applyToState(this.state, this.recognizer, this.getHandler);
    var params = {};

    for (var i = 0, len = state.handlerInfos.length; i < len; ++i) {
      var handlerInfo = state.handlerInfos[i];
      var handlerParams = handlerInfo.params ||
                          serialize(handlerInfo.handler, handlerInfo.context, handlerInfo.names);
      merge(params, handlerParams);
    }

    return this.recognizer.generate(handlerName, params);

    //var params = paramsForHandler(this, handlerName, suppliedParams, queryParams),
      //validQueryParams = queryParamsForHandler(this, handlerName);

    //var missingParams = [];

    //for (var key in queryParams) {
      //if (queryParams.hasOwnProperty(key) && !~validQueryParams.indexOf(key)) {
        //missingParams.push(key);
      //}
    //}

    //if (missingParams.length > 0) {
      //var err = 'You supplied the params ';
      //err += missingParams.map(function(param) {
        //return '"' + param + "=" + queryParams[param] + '"';
      //}).join(' and ');

      //err += ' which are not valid for the "' + handlerName + '" handler or its parents';

      //throw new Error(err);
    //}

  },

  isActive: function(handlerName) {

    var partitionedArgs   = extractQueryParams(slice.call(arguments, 1)),
        contexts          = partitionedArgs[0],
        queryParams       = partitionedArgs[1],
        activeQueryParams  = {},
        effectiveQueryParams = {};

    var targetHandlerInfos = this.state.handlerInfos,
        found = false, names, object, handlerInfo, handlerObj, i, len;

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

    var state = new TransitionState();
    state.handlerInfos = targetHandlerInfos.slice(0, index + 1);
    recogHandlers = recogHandlers.slice(0, index + 1);

    var intent = new NamedTransitionIntent({
      name: targetHandler,
      contexts: contexts
    });

    var newState = intent.applyToHandlers(state, recogHandlers, this.getHandler, targetHandler, true, true);

    return newState === state;
  },

  trigger: function(name) {
    var args = slice.call(arguments);
    trigger(this, this.currentHandlerInfos, false, args);
  },

  /**
    @private

    The router calls the various handler hooks outside
    of the context of RSVP's try/catch block so that
    errors synchronously thrown from these hooks are
    not caught by RSVP and treated as rejected promises.
    This function reuses RSVP's configurable `async`
    method to escape that try/catch block.

    @param {Function} callback the callback that will
                      be asynchronously called

    @return {Promise} a promise that fulfills with the
                      value returned from the callback
   */
  async: function(callback) {
    return new RSVP.Promise(function(resolve) {
      RSVP.async(function() {
        resolve(callback());
      });
    });
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
/*
function createQueryParamTransition(router, queryParams, isIntermediate) {
  var currentHandlers = router.currentHandlerInfos,
      currentHandler = currentHandlers[currentHandlers.length - 1],
      name = currentHandler.name;

  log(router, "Attempting query param transition");

  return createNamedTransition(router, [name, queryParams], isIntermediate);
}
*/

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
function setupContexts(router, newState, shouldContinue) {
  var partition = partitionHandlers(router.state, newState);

  forEach(partition.exited, function(handlerInfo) {
    var handler = handlerInfo.handler;
    delete handler.context;
    if (handler.exit) { handler.exit(); }
  });

  router.state = newState;
  var currentHandlerInfos = router.currentHandlerInfos = partition.unchanged.slice();

  forEach(partition.updatedContext, function(handlerInfo) {
    return handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, false, shouldContinue);
  });

  forEach(partition.entered, function(handlerInfo) {
    return handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, true, shouldContinue);
  });
}

/**
  @private

  Helper method used by setupContexts. Handles errors or redirects
  that may happen in enter/setup.
*/
function handlerEnteredOrUpdated(currentHandlerInfos, handlerInfo, enter, shouldContinue) {

  var handler = handlerInfo.handler,
      context = handlerInfo.context;

  if (enter && handler.enter) { handler.enter(); }
  if (shouldContinue && !shouldContinue()) { return false; }

  setContext(handler, context);
  setQueryParams(handler, handlerInfo.queryParams);

  if (handler.setup) { handler.setup(context, handlerInfo.queryParams); }
  if (shouldContinue && !shouldContinue()) { return false; }

  currentHandlerInfos.push(handlerInfo);

  return true;
}

function forEach(array, callback) {
  for (var i=0, l=array.length; i<l && false !== callback(array[i]); i++) { }
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

  var urlMethod = transition.urlMethod;
  for (i = handlerInfos.length - 1; i >= 0; --i) {
    var handlerInfo = handlerInfos[i];
    merge(params, handlerInfo.params);
    if (handlerInfo.handler.inaccessibleByURL) {
      urlMethod = null;
    }
  }

  if (urlMethod) {
    var url = router.recognizer.generate(handlerName, params);

    if (urlMethod === 'replace') {
      router.replaceURL(url);
    } else {
      router.updateURL(url);
    }
  }

  // Run all the necessary enter/setup/exit hooks
  setupContexts(router, newState, function() {
    return !transition.isAborted;
  });

  // Check if a redirect occurred in enter/setup
  if (transition.isAborted) {
    // TODO: cleaner way? distinguish b/w targetHandlerInfos?
    router.state.handlerInfos = router.currentHandlerInfos;
    return RSVP.reject(logAbort(transition));
  }

  transition.isActive = false;
  router.activeTransition = null;

  trigger(router, router.currentHandlerInfos, true, ['didTransition']);

  if (router.didTransition) {
    router.didTransition(router.currentHandlerInfos);
  }

  log(router, transition.sequence, "TRANSITION COMPLETE.");

  // Resolve with the final handler.
  return handlerInfos[handlerInfos.length - 1].handler;
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

    log(router, "Attempting URL transition to " + name);
    intent = new URLTransitionIntent({ url: name });

  } else {

    log(router, "Attempting transition to " + name);
    intent = new NamedTransitionIntent({
      name: args[0],
      contexts: slice.call(args, 1)
    });
  }

  return transitionByIntent(router, intent, isIntermediate);
}

function transitionByIntent(router, intent, isIntermediate) {
  var oldState = router.activeTransition ? router.activeTransition.state : router.state;

  try {
    var newState = intent.applyToState(oldState, router.recognizer, router.getHandler, isIntermediate);

    if (newState === oldState) {
      // No-op. No need to create a new transition.
      return new Transition(router);
    }

    if (isIntermediate) {
      return setupContexts(router, newState);
    }

    var newTransition = new Transition(router, intent, newState);

    var wasTransitioning = false;
    if (router.activeTransition) {
      wasTransitioning = true;
      router.activeTransition.abort();
    }
    router.activeTransition = newTransition;

    // Transition promises by default resolve with resolved state.
    // For our purposes, swap out the promise to resolve
    // after the transition has been finalized.
    newTransition.promise = newTransition.promise.then(function(result) {
      return router.async(function() {
        return finalizeTransition(newTransition, result.state);
      });
    });

    if (!wasTransitioning) {
      trigger(router, router.state.handlerInfos, true, ['willTransition', newTransition]);
    }

    return newTransition;
  } catch(e) {
    return new Transition(router, intent, null, e);
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
