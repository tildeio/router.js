import RouteRecognizer from 'route-recognizer';
import { reject, async, Promise } from 'rsvp';
import { trigger, log, slice, forEach, merge, serialize, extractQueryParams } from './utils';
import { TransitionState } from './transitionState';
import { logAbort, transitionByIntent } from './transition';
import { NamedTransitionIntent } from './transitionIntent/namedTransitionIntent';
import { URLTransitionIntent } from './transitionIntent/urlTransitionIntent';

function Router() {
  this.recognizer = new RouteRecognizer();
  this.reset();
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
    return new Promise(function(resolve) {
      async(function() {
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

  handler.context = context;
  if (handler.contextDidChange) { handler.contextDidChange(); }

  // setQueryParams(handler, handlerInfo.queryParams);

  if (handler.setup) { handler.setup(context, handlerInfo.queryParams); }
  if (shouldContinue && !shouldContinue()) { return false; }

  currentHandlerInfos.push(handlerInfo);

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

    // if (!oldHandler || oldHandler.handler !== newHandler.handler) {
      // handlerChanged = true;
    // } else if (!queryParamsEqual(oldHandler.queryParams, newHandler.queryParams)) {
      // queryParamsChanged = true;
    // }

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
    return reject(logAbort(transition));
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

export { Router, finalizeTransition, setupContexts };
