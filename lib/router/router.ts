import RouteRecognizer, { MatchCallback, Params } from 'route-recognizer';
import { Promise } from 'rsvp';
import { Dict, Maybe } from './core';
import HandlerInfo, { IHandler } from './handler-info';
import { logAbort, Transition } from './transition';
import TransitionAbortedError from './transition-aborted-error';
import { TransitionIntent } from './transition-intent';
import NamedTransitionIntent from './transition-intent/named-transition-intent';
import URLTransitionIntent from './transition-intent/url-transition-intent';
import TransitionState from './transition-state';
import {
  ChangeList,
  extractQueryParams,
  forEach,
  getChangelist,
  log,
  merge,
  promiseLabel,
} from './utils';

export interface SerializerFunc {
  (model: Dict<unknown>, params: Dict<unknown>): unknown;
}
export interface GetSerializerFunc {
  (name: string): SerializerFunc | undefined;
}

export interface GetHandlerFunc {
  (name: string): IHandler | Promise<IHandler>;
}

export interface DidTransitionFunc {
  (handlerInfos: HandlerInfo[]): void;
}

export default abstract class Router {
  log?: (message: string) => void;
  state?: TransitionState = undefined;
  oldState: Maybe<TransitionState> = undefined;
  activeTransition?: Transition = undefined;
  currentHandlerInfos?: HandlerInfo[] = undefined;
  _changedQueryParams?: Dict<unknown> = undefined;
  currentSequence = 0;
  recognizer: RouteRecognizer;

  constructor(logger?: (message: string) => void) {
    this.log = logger;
    this.recognizer = new RouteRecognizer();
    this.reset();
  }

  abstract getHandler(name: string): IHandler | Promise<IHandler>;
  abstract getSerializer(name: string): SerializerFunc | undefined;
  abstract updateURL(url: string): void;
  abstract replaceURL(url: string): void;
  abstract willTransition(
    oldHandlerInfos: HandlerInfo[],
    newHandlerInfos: HandlerInfo[],
    transition: Transition
  ): void;
  abstract didTransition(handlerInfos: HandlerInfo[]): void;
  abstract triggerEvent(
    handlerInfos: HandlerInfo[],
    ignoreFailure: boolean,
    name: string,
    args: unknown[]
  ): void;

  /**
    The main entry point into the router. The API is essentially
    the same as the `map` method in `route-recognizer`.

    This method extracts the String handler at the last `.to()`
    call and uses it as the name of the whole route.

    @param {Function} callback
  */
  map(callback: MatchCallback) {
    this.recognizer.map(callback, function(recognizer, routes) {
      for (let i = routes.length - 1, proceed = true; i >= 0 && proceed; --i) {
        let route = routes[i];
        let handler = route.handler as string;
        recognizer.add(routes, { as: handler });
        proceed = route.path === '/' || route.path === '' || handler.slice(-6) === '.index';
      }
    });
  }

  hasRoute(route: string) {
    return this.recognizer.hasRoute(route);
  }

  queryParamsTransition(
    changelist: ChangeList,
    wasTransitioning: boolean,
    oldState: TransitionState,
    newState: TransitionState
  ) {
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
      let newTransition = new Transition(this, undefined, undefined);
      newTransition.queryParamsOnly = true;

      oldState.queryParams = finalizeQueryParamChange(
        this,
        newState.handlerInfos,
        newState.queryParams,
        newTransition
      );

      newTransition.promise = newTransition.promise!.then(
        (result: TransitionState | IHandler | Error | undefined) => {
          updateURL(newTransition, oldState);
          if (this.didTransition) {
            this.didTransition(this.currentHandlerInfos!);
          }
          return result;
        },
        null,
        promiseLabel('Transition complete')
      );
      return newTransition;
    }
  }

  // NOTE: this doesn't really belong here, but here
  // it shall remain until our ES6 transpiler can
  // handle cyclical deps.
  transitionByIntent(intent: TransitionIntent, isIntermediate: boolean) {
    try {
      return getTransitionByIntent.apply(this, [intent, isIntermediate]);
    } catch (e) {
      return new Transition(this, intent, undefined, e, undefined);
    }
  }

  /**
    Clears the current and target route handlers and triggers exit
    on each of them starting at the leaf and traversing up through
    its ancestors.
  */
  reset() {
    if (this.state) {
      forEach<HandlerInfo>(this.state.handlerInfos.slice().reverse(), function(handlerInfo) {
        let handler = handlerInfo.handler;
        if (handler !== undefined) {
          if (handler._exit !== undefined) {
            handler._exit();
          } else if (handler.exit !== undefined) {
            handler.exit();
          }
        }
        return true;
      });
    }

    this.oldState = undefined;
    this.state = new TransitionState();
    this.currentHandlerInfos = undefined;
  }

  /**
    let handler = handlerInfo.handler;
    The entry point for handling a change to the URL (usually
    via the back and forward button).

    Returns an Array of handlers and the parameters associated
    with those parameters.

    @param {String} url a URL to process

    @return {Array} an Array of `[handler, parameter]` tuples
  */
  handleURL(url: string) {
    // Perform a URL-based transition, but don't change
    // the URL afterward, since it already happened.
    if (url.charAt(0) !== '/') {
      url = '/' + url;
    }

    return doTransition(this, url).method(null);
  }

  /**
    Transition into the specified named route.

    If necessary, trigger the exit callback on any handlers
    that are no longer represented by the target route.

    @param {String} name the name of the route
  */
  transitionTo(name: string | { queryParams: Dict<unknown> }, ...contexts: any[]) {
    if (typeof name === 'object') {
      contexts.push(name);
      return doTransition(this, undefined, contexts, false);
    }

    return doTransition(this, name, contexts);
  }

  intermediateTransitionTo(name: string, ...args: any[]) {
    return doTransition(this, name, args, true);
  }

  refresh(pivotHandler?: IHandler) {
    let previousTransition = this.activeTransition;
    let state = previousTransition ? previousTransition.state : this.state;
    let handlerInfos = state!.handlerInfos;

    if (pivotHandler === undefined) {
      pivotHandler = handlerInfos[0].handler;
    }

    log(this, 'Starting a refresh transition');
    let name = handlerInfos[handlerInfos.length - 1].name;
    let intent = new NamedTransitionIntent(
      name,
      pivotHandler,
      [],
      this._changedQueryParams || state!.queryParams
    );

    let newTransition = this.transitionByIntent(intent, false);

    // if the previous transition is a replace transition, that needs to be preserved
    if (previousTransition && previousTransition.urlMethod === 'replace') {
      newTransition.method(previousTransition.urlMethod);
    }

    return newTransition;
  }

  /**
    Identical to `transitionTo` except that the current URL will be replaced
    if possible.

    This method is intended primarily for use with `replaceState`.

    @param {String} name the name of the route
  */
  replaceWith(name: string) {
    return doTransition(this, name).method('replace');
  }

  /**
    Take a named route and context objects and generate a
    URL.

    @param {String} name the name of the route to generate
      a URL for
    @param {...Object} objects a list of objects to serialize

    @return {String} a URL
  */
  generate(handlerName: string, ...args: any[]) {
    let partitionedArgs = extractQueryParams(args),
      suppliedParams = partitionedArgs[0],
      queryParams = partitionedArgs[1];

    // Construct a TransitionIntent with the provided params
    // and apply it to the present state of the router.
    let intent = new NamedTransitionIntent(handlerName, undefined, suppliedParams);
    let state = intent.applyToState(
      this.state!,
      this.recognizer,
      this.getHandler,
      false,
      this.getSerializer
    );

    let params: Params = {};
    for (let i = 0, len = state.handlerInfos.length; i < len; ++i) {
      let handlerInfo = state.handlerInfos[i];
      let handlerParams = handlerInfo.serialize();
      merge(params, handlerParams);
    }
    params.queryParams = queryParams;

    return this.recognizer.generate(handlerName, params);
  }

  applyIntent(handlerName: string, contexts: Dict<unknown>[]) {
    let intent = new NamedTransitionIntent(handlerName, undefined, contexts);

    let state = (this.activeTransition && this.activeTransition.state) || this.state!;

    return intent.applyToState(state, this.recognizer, this.getHandler, false, this.getSerializer);
  }

  isActiveIntent(
    handlerName: string,
    contexts: any[],
    queryParams?: Dict<unknown>,
    _state?: TransitionState
  ) {
    let state = _state || this.state!,
      targetHandlerInfos = state.handlerInfos,
      handlerInfo,
      len;

    if (!targetHandlerInfos.length) {
      return false;
    }

    let targetHandler = targetHandlerInfos[targetHandlerInfos.length - 1].name;
    let recogHandlers = this.recognizer.handlersFor(targetHandler) as IHandler[];

    let index = 0;
    for (len = recogHandlers.length; index < len; ++index) {
      handlerInfo = targetHandlerInfos[index];
      if (handlerInfo.name === handlerName) {
        break;
      }
    }

    if (index === recogHandlers.length) {
      // The provided route name isn't even in the route hierarchy.
      return false;
    }

    let testState = new TransitionState();
    testState.handlerInfos = targetHandlerInfos.slice(0, index + 1);
    recogHandlers = recogHandlers.slice(0, index + 1);

    let intent = new NamedTransitionIntent(targetHandler, undefined, contexts);

    let newState = intent.applyToHandlers(
      testState,
      recogHandlers,
      this.getHandler,
      targetHandler,
      true,
      true,
      this.getSerializer
    );

    let handlersEqual = handlerInfosEqual(newState.handlerInfos, testState.handlerInfos);
    if (!queryParams || !handlersEqual) {
      return handlersEqual;
    }

    // Get a hash of QPs that will still be active on new route
    let activeQPsOnNewHandler: Dict<unknown> = {};
    merge(activeQPsOnNewHandler, queryParams);

    let activeQueryParams = state.queryParams;
    for (let key in activeQueryParams) {
      if (activeQueryParams.hasOwnProperty(key) && activeQPsOnNewHandler.hasOwnProperty(key)) {
        activeQPsOnNewHandler[key] = activeQueryParams[key];
      }
    }

    return handlersEqual && !getChangelist(activeQPsOnNewHandler, queryParams);
  }

  isActive(handlerName: string, ...args: unknown[]) {
    let partitionedArgs = extractQueryParams(args);
    return this.isActiveIntent(handlerName, partitionedArgs[0], partitionedArgs[1]);
  }

  trigger(name: string, ...args: any[]) {
    this.triggerEvent(this.currentHandlerInfos!, false, name, args);
  }
}

function getTransitionByIntent(this: Router, intent: TransitionIntent, isIntermediate: boolean) {
  let wasTransitioning = !!this.activeTransition;
  let oldState = wasTransitioning ? this.activeTransition!.state : this.state;
  let newTransition: Transition;

  let newState = intent.applyToState(
    oldState!,
    this.recognizer,
    this.getHandler,
    isIntermediate,
    this.getSerializer
  );
  let queryParamChangelist = getChangelist(oldState!.queryParams, newState.queryParams);

  if (handlerInfosEqual(newState.handlerInfos, oldState!.handlerInfos)) {
    // This is a no-op transition. See if query params changed.
    if (queryParamChangelist) {
      newTransition = this.queryParamsTransition(
        queryParamChangelist,
        wasTransitioning,
        oldState!,
        newState
      );
      if (newTransition) {
        newTransition.queryParamsOnly = true;
        return newTransition;
      }
    }

    // No-op. No need to create a new transition.
    return this.activeTransition || new Transition(this, undefined, undefined);
  }

  if (isIntermediate) {
    setupContexts(this, newState);
    return;
  }

  // Create a new transition to the destination route.
  newTransition = new Transition(this, intent, newState, undefined, this.activeTransition);

  // transition is to same route with same params, only query params differ.
  // not caught above probably because refresh() has been used
  if (handlerInfosSameExceptQueryParams(newState.handlerInfos, oldState!.handlerInfos)) {
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
  newTransition.promise = newTransition.promise!.then<IHandler>(
    (result: TransitionState) => {
      return finalizeTransition(newTransition, result);
    },
    null,
    promiseLabel('Settle transition promise when transition is finalized')
  );

  if (!wasTransitioning) {
    notifyExistingHandlers(this, newState, newTransition);
  }

  fireQueryParamDidChange(this, newState, queryParamChangelist!);

  return newTransition;
}

/**
  @private

  Fires queryParamsDidChange event
*/
function fireQueryParamDidChange(
  router: Router,
  newState: TransitionState,
  queryParamChangelist: ChangeList
) {
  // If queryParams changed trigger event
  if (queryParamChangelist) {
    // This is a little hacky but we need some way of storing
    // changed query params given that no activeTransition
    // is guaranteed to have occurred.
    router._changedQueryParams = queryParamChangelist.all;
    router.triggerEvent(newState.handlerInfos, true, 'queryParamsDidChange', [
      queryParamChangelist.changed,
      queryParamChangelist.all,
      queryParamChangelist.removed,
    ]);
    router._changedQueryParams = undefined;
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
function setupContexts(router: Router, newState: TransitionState, transition?: Transition) {
  let partition = partitionHandlers(router.state!, newState);
  let i, l, handler;

  for (i = 0, l = partition.exited.length; i < l; i++) {
    handler = partition.exited[i].handler;
    delete handler!.context;

    if (handler !== undefined) {
      if (handler._reset !== undefined) {
        handler._reset(true, transition);
      } else if (handler.reset !== undefined) {
        handler.reset(true, transition);
      }

      if (handler._exit !== undefined) {
        handler._exit(transition);
      } else if (handler.exit !== undefined) {
        handler.exit(transition);
      }
    }
  }

  let oldState = (router.oldState = router.state);
  router.state = newState;
  let currentHandlerInfos = (router.currentHandlerInfos = partition.unchanged.slice());

  try {
    for (i = 0, l = partition.reset.length; i < l; i++) {
      handler = partition.reset[i].handler;
      if (handler !== undefined) {
        if (handler._reset !== undefined) {
          handler._reset(false, transition);
        } else if (handler.reset !== undefined) {
          handler.reset(false, transition);
        }
      }
    }

    for (i = 0, l = partition.updatedContext.length; i < l; i++) {
      handlerEnteredOrUpdated(currentHandlerInfos, partition.updatedContext[i], false, transition!);
    }

    for (i = 0, l = partition.entered.length; i < l; i++) {
      handlerEnteredOrUpdated(currentHandlerInfos, partition.entered[i], true, transition!);
    }
  } catch (e) {
    router.state = oldState;
    router.currentHandlerInfos = oldState!.handlerInfos;
    throw e;
  }

  router.state.queryParams = finalizeQueryParamChange(
    router,
    currentHandlerInfos,
    newState.queryParams,
    transition!
  );
}

/**
  @private

  Helper method used by setupContexts. Handles errors or redirects
  that may happen in enter/setup.
*/
function handlerEnteredOrUpdated(
  currentHandlerInfos: HandlerInfo[],
  handlerInfo: HandlerInfo,
  enter: boolean,
  transition: Transition
) {
  let handler = handlerInfo.handler,
    context = handlerInfo.context;

  function _handlerEnteredOrUpdated(handler: IHandler) {
    if (enter) {
      if (handler._enter !== undefined) {
        handler._enter(transition);
      } else if (handler.enter !== undefined) {
        handler.enter(transition);
      }
    }

    if (transition && transition.isAborted) {
      throw new TransitionAbortedError();
    }

    handler.context = context;

    if (handler._contextDidChange !== undefined) {
      handler._contextDidChange();
    } else if (handler.contextDidChange !== undefined) {
      handler.contextDidChange();
    }

    if (handler._setup !== undefined) {
      handler._setup(context!, transition);
    } else if (handler.setup !== undefined) {
      handler.setup(context!, transition);
    }

    if (transition && transition.isAborted) {
      throw new TransitionAbortedError();
    }

    currentHandlerInfos.push(handlerInfo);
    return handler;
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
function partitionHandlers(oldState: TransitionState, newState: TransitionState) {
  let oldHandlerInfos = oldState.handlerInfos;
  let newHandlerInfos = newState.handlerInfos;

  let handlers: HandlerPartition = {
    updatedContext: [],
    exited: [],
    entered: [],
    unchanged: [],
    reset: [],
  };

  let handlerChanged,
    contextChanged = false,
    i,
    l;

  for (i = 0, l = newHandlerInfos.length; i < l; i++) {
    let oldHandlerInfo = oldHandlerInfos[i],
      newHandlerInfo = newHandlerInfos[i];

    if (!oldHandlerInfo || oldHandlerInfo.handler !== newHandlerInfo.handler) {
      handlerChanged = true;
    }

    if (handlerChanged) {
      handlers.entered.push(newHandlerInfo);
      if (oldHandlerInfo) {
        handlers.exited.unshift(oldHandlerInfo);
      }
    } else if (contextChanged || oldHandlerInfo.context !== newHandlerInfo.context) {
      contextChanged = true;
      handlers.updatedContext.push(newHandlerInfo);
    } else {
      handlers.unchanged.push(oldHandlerInfo);
    }
  }

  for (i = newHandlerInfos.length, l = oldHandlerInfos.length; i < l; i++) {
    handlers.exited.unshift(oldHandlerInfos[i]);
  }

  handlers.reset = handlers.updatedContext.slice();
  handlers.reset.reverse();

  return handlers;
}

function updateURL(transition: Transition, state: TransitionState, _inputUrl?: string) {
  let urlMethod: string | null = transition.urlMethod;

  if (!urlMethod) {
    return;
  }

  let { router } = transition;
  let { handlerInfos } = state;
  let { name: handlerName } = handlerInfos[handlerInfos.length - 1];
  let params: Dict<unknown> = {};

  for (let i = handlerInfos.length - 1; i >= 0; --i) {
    let handlerInfo = handlerInfos[i];
    merge(params, handlerInfo.params);
    if (handlerInfo.handler!.inaccessibleByURL) {
      urlMethod = null;
    }
  }

  if (urlMethod) {
    params.queryParams = transition._visibleQueryParams || state.queryParams;
    let url = router.recognizer.generate(handlerName, params as Params);

    // transitions during the initial transition must always use replaceURL.
    // When the app boots, you are at a url, e.g. /foo. If some handler
    // redirects to bar as part of the initial transition, you don't want to
    // add a history entry for /foo. If you do, pressing back will immediately
    // hit the redirect again and take you back to /bar, thus killing the back
    // button
    let initial = transition.isCausedByInitialTransition;

    // say you are at / and you click a link to route /foo. In /foo's
    // handler, the transition is aborted using replacewith('/bar').
    // Because the current url is still /, the history entry for / is
    // removed from the history. Clicking back will take you to the page
    // you were on before /, which is often not even the app, thus killing
    // the back button. That's why updateURL is always correct for an
    // aborting transition that's not the initial transition
    let replaceAndNotAborting = urlMethod === 'replace' && !transition.isCausedByAbortingTransition;

    // because calling refresh causes an aborted transition, this needs to be
    // special cased - if the initial transition is a replace transition, the
    // urlMethod should be honored here.
    let isQueryParamsRefreshTransition = transition.queryParamsOnly && urlMethod === 'replace';

    // say you are at / and you a `replaceWith(/foo)` is called. Then, that
    // transition is aborted with `replaceWith(/bar)`. At the end, we should
    // end up with /bar replacing /. We are replacing the replace. We only
    // will replace the initial route if all subsequent aborts are also
    // replaces. However, there is some ambiguity around the correct behavior
    // here.
    let replacingReplace =
      urlMethod === 'replace' && transition.isCausedByAbortingReplaceTransition;

    if (initial || replaceAndNotAborting || isQueryParamsRefreshTransition || replacingReplace) {
      router.replaceURL!(url);
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
function finalizeTransition(
  transition: Transition,
  newState: TransitionState
): IHandler | Promise<never> {
  try {
    log(
      transition.router,
      transition.sequence,
      'Resolved all models on destination route; finalizing transition.'
    );

    let router = transition.router,
      handlerInfos = newState.handlerInfos;

    // Run all the necessary enter/setup/exit hooks
    setupContexts(router, newState, transition);

    // Check if a redirect occurred in enter/setup
    if (transition.isAborted) {
      // TODO: cleaner way? distinguish b/w targetHandlerInfos?
      router.state!.handlerInfos = router.currentHandlerInfos!;
      return Promise.reject(logAbort(transition));
    }

    updateURL(transition, newState, (transition.intent! as URLTransitionIntent).url);

    transition.isActive = false;
    router.activeTransition = undefined;

    router.triggerEvent(router.currentHandlerInfos!, true, 'didTransition', []);

    if (router.didTransition) {
      router.didTransition(router.currentHandlerInfos!);
    }

    log(router, transition.sequence, 'TRANSITION COMPLETE.');

    // Resolve with the final handler.
    return handlerInfos[handlerInfos.length - 1].handler!;
  } catch (e) {
    if (!(e instanceof TransitionAbortedError)) {
      //let erroneousHandler = handlerInfos.pop();
      let infos = transition.state!.handlerInfos;
      transition.trigger(true, 'error', e, transition, infos[infos.length - 1].handler);
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
function doTransition(
  router: Router,
  name?: string,
  modelsArray: Dict<unknown>[] = [],
  isIntermediate = false
) {
  let lastArg = modelsArray[modelsArray.length - 1];
  let queryParams: Dict<unknown> = {};

  if (lastArg !== undefined && lastArg.hasOwnProperty('queryParams')) {
    queryParams = modelsArray.pop()!.queryParams as Dict<unknown>;
  }

  let intent;
  if (name === undefined) {
    log(router, 'Updating query params');

    // A query param update is really just a transition
    // into the route you're already on.
    let { handlerInfos } = router.state!;
    intent = new NamedTransitionIntent(
      handlerInfos[handlerInfos.length - 1].name,
      undefined,
      [],
      queryParams
    );
  } else if (name.charAt(0) === '/') {
    log(router, 'Attempting URL transition to ' + name);
    intent = new URLTransitionIntent(name);
  } else {
    log(router, 'Attempting transition to ' + name);
    intent = new NamedTransitionIntent(name, undefined, modelsArray, queryParams);
  }

  return router.transitionByIntent(intent, isIntermediate);
}

function handlerInfosEqual(handlerInfos: HandlerInfo[], otherHandlerInfos: HandlerInfo[]) {
  if (handlerInfos.length !== otherHandlerInfos.length) {
    return false;
  }

  for (let i = 0, len = handlerInfos.length; i < len; ++i) {
    if (handlerInfos[i] !== otherHandlerInfos[i]) {
      return false;
    }
  }
  return true;
}

function handlerInfosSameExceptQueryParams(
  handlerInfos: HandlerInfo[],
  otherHandlerInfos: HandlerInfo[]
) {
  if (handlerInfos.length !== otherHandlerInfos.length) {
    return false;
  }

  for (let i = 0, len = handlerInfos.length; i < len; ++i) {
    if (handlerInfos[i].name !== otherHandlerInfos[i].name) {
      return false;
    }

    if (!paramsEqual(handlerInfos[i].params, otherHandlerInfos[i].params)) {
      return false;
    }
  }
  return true;
}

function paramsEqual(params: Dict<unknown>, otherParams: Dict<unknown>) {
  if (!params && !otherParams) {
    return true;
  } else if ((!params && !!otherParams) || (!!params && !otherParams)) {
    // one is falsy but other is not;
    return false;
  }
  let keys = Object.keys(params);
  let otherKeys = Object.keys(otherParams);

  if (keys.length !== otherKeys.length) {
    return false;
  }

  for (let i = 0, len = keys.length; i < len; ++i) {
    let key = keys[i];

    if (params[key] !== otherParams[key]) {
      return false;
    }
  }

  return true;
}

function finalizeQueryParamChange(
  router: Router,
  resolvedHandlers: HandlerInfo[],
  newQueryParams: Dict<unknown>,
  transition: Transition
) {
  // We fire a finalizeQueryParamChange event which
  // gives the new route hierarchy a chance to tell
  // us which query params it's consuming and what
  // their final values are. If a query param is
  // no longer consumed in the final route hierarchy,
  // its serialized segment will be removed
  // from the URL.

  for (let k in newQueryParams) {
    if (newQueryParams.hasOwnProperty(k) && newQueryParams[k] === null) {
      delete newQueryParams[k];
    }
  }

  let finalQueryParamsArray: {
    key: string;
    value: string;
    visible: boolean;
  }[] = [];

  router.triggerEvent(resolvedHandlers, true, 'finalizeQueryParamChange', [
    newQueryParams,
    finalQueryParamsArray,
    transition,
  ]);

  if (transition) {
    transition._visibleQueryParams = {};
  }

  let finalQueryParams: Dict<unknown> = {};
  for (let i = 0, len = finalQueryParamsArray.length; i < len; ++i) {
    let qp = finalQueryParamsArray[i];
    finalQueryParams[qp.key] = qp.value;
    if (transition && qp.visible !== false) {
      transition._visibleQueryParams[qp.key] = qp.value;
    }
  }
  return finalQueryParams;
}

function notifyExistingHandlers(
  router: Router,
  newState: TransitionState,
  newTransition: Transition
) {
  let oldHandlers = router.state!.handlerInfos,
    changing = [],
    i,
    oldHandlerLen,
    oldHandler,
    newHandler;

  oldHandlerLen = oldHandlers.length;
  for (i = 0; i < oldHandlerLen; i++) {
    oldHandler = oldHandlers[i];
    newHandler = newState.handlerInfos[i];

    if (!newHandler || oldHandler.name !== newHandler.name) {
      break;
    }

    if (!newHandler.isResolved) {
      changing.push(oldHandler);
    }
  }

  router.triggerEvent(oldHandlers, true, 'willTransition', [newTransition]);

  if (router.willTransition) {
    router.willTransition(oldHandlers, newState.handlerInfos, newTransition);
  }
}

export interface HandlerPartition {
  updatedContext: HandlerInfo[];
  exited: HandlerInfo[];
  entered: HandlerInfo[];
  unchanged: HandlerInfo[];
  reset: HandlerInfo[];
}
