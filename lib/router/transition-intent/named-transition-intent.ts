import { Dict } from '../core';
import InternalRouteInfo, {
  Route,
  UnresolvedRouteInfoByObject,
  UnresolvedRouteInfoByParam,
} from '../route-info';
import Router, { ParsedHandler } from '../router';
import { TransitionIntent } from '../transition-intent';
import TransitionState from '../transition-state';
import { extractQueryParams, isParam, merge } from '../utils';

export default class NamedTransitionIntent<T extends Route> extends TransitionIntent<T> {
  name: string;
  pivotHandler?: Route;
  contexts: unknown[];
  queryParams: Dict<unknown>;
  preTransitionState?: TransitionState<T> = undefined;

  constructor(
    router: Router<T>,
    name: string,
    pivotHandler: Route | undefined,
    contexts: unknown[] = [],
    queryParams: Dict<unknown> = {},
    data?: {}
  ) {
    super(router, data);
    this.name = name;
    this.pivotHandler = pivotHandler;
    this.contexts = contexts;
    this.queryParams = queryParams;
  }

  applyToState(oldState: TransitionState<T>, isIntermediate: boolean): TransitionState<T> {
    // TODO: WTF fix me
    let partitionedArgs = extractQueryParams([this.name].concat(this.contexts as any)),
      pureArgs = partitionedArgs[0],
      handlers: ParsedHandler[] = this.router.recognizer.handlersFor(pureArgs[0]);

    let targetRouteName = handlers[handlers.length - 1].handler;

    return this.applyToHandlers(oldState, handlers, targetRouteName, isIntermediate, false);
  }

  applyToHandlers(
    oldState: TransitionState<T>,
    parsedHandlers: ParsedHandler[],
    targetRouteName: string,
    isIntermediate: boolean,
    checkingIfActive: boolean
  ) {
    let i, len;
    let newState = new TransitionState<T>();
    let objects = this.contexts.slice(0);

    let invalidateIndex = parsedHandlers.length;

    // Pivot handlers are provided for refresh transitions
    if (this.pivotHandler) {
      for (i = 0, len = parsedHandlers.length; i < len; ++i) {
        if (parsedHandlers[i].handler === this.pivotHandler._internalName) {
          invalidateIndex = i;
          break;
        }
      }
    }

    for (i = parsedHandlers.length - 1; i >= 0; --i) {
      let result = parsedHandlers[i];
      let name = result.handler;

      let oldHandlerInfo = oldState.routeInfos[i];
      let newHandlerInfo = null;

      if (result.names.length > 0) {
        if (i >= invalidateIndex) {
          newHandlerInfo = this.createParamHandlerInfo(name, result.names, objects, oldHandlerInfo);
        } else {
          newHandlerInfo = this.getHandlerInfoForDynamicSegment(
            name,
            result.names,
            objects,
            oldHandlerInfo,
            targetRouteName,
            i
          );
        }
      } else {
        // This route has no dynamic segment.
        // Therefore treat as a param-based handlerInfo
        // with empty params. This will cause the `model`
        // hook to be called with empty params, which is desirable.
        newHandlerInfo = this.createParamHandlerInfo(name, result.names, objects, oldHandlerInfo);
      }

      if (checkingIfActive) {
        // If we're performing an isActive check, we want to
        // serialize URL params with the provided context, but
        // ignore mismatches between old and new context.
        newHandlerInfo = newHandlerInfo.becomeResolved(
          null,
          newHandlerInfo.context as Dict<unknown>
        );
        let oldContext = oldHandlerInfo && oldHandlerInfo.context;
        if (
          result.names.length > 0 &&
          oldHandlerInfo.context !== undefined &&
          newHandlerInfo.context === oldContext
        ) {
          // If contexts match in isActive test, assume params also match.
          // This allows for flexibility in not requiring that every last
          // handler provide a `serialize` method
          newHandlerInfo.params = oldHandlerInfo && oldHandlerInfo.params;
        }
        newHandlerInfo.context = oldContext;
      }

      let handlerToUse = oldHandlerInfo;
      if (i >= invalidateIndex || newHandlerInfo.shouldSupersede(oldHandlerInfo)) {
        invalidateIndex = Math.min(i, invalidateIndex);
        handlerToUse = newHandlerInfo;
      }

      if (isIntermediate && !checkingIfActive) {
        handlerToUse = handlerToUse.becomeResolved(null, handlerToUse.context as Dict<unknown>);
      }

      newState.routeInfos.unshift(handlerToUse);
    }

    if (objects.length > 0) {
      throw new Error(
        'More context objects were passed than there are dynamic segments for the route: ' +
          targetRouteName
      );
    }

    if (!isIntermediate) {
      this.invalidateChildren(newState.routeInfos, invalidateIndex);
    }

    merge(newState.queryParams, this.queryParams || {});
    if (isIntermediate) {
      merge(newState.queryParams, oldState.queryParams);
    }

    return newState;
  }

  invalidateChildren(handlerInfos: InternalRouteInfo<T>[], invalidateIndex: number) {
    for (let i = invalidateIndex, l = handlerInfos.length; i < l; ++i) {
      let handlerInfo = handlerInfos[i];
      if (handlerInfo.isResolved) {
        let { name, params, route, paramNames } = handlerInfos[i];
        handlerInfos[i] = new UnresolvedRouteInfoByParam(
          this.router,
          name,
          paramNames,
          params,
          route
        );
      }
    }
  }

  getHandlerInfoForDynamicSegment(
    name: string,
    names: string[],
    objects: unknown[],
    oldHandlerInfo: InternalRouteInfo<T>,
    _targetRouteName: string,
    i: number
  ) {
    let objectToUse: unknown;
    if (objects.length > 0) {
      // Use the objects provided for this transition.
      objectToUse = objects[objects.length - 1];
      if (isParam(objectToUse)) {
        return this.createParamHandlerInfo(name, names, objects, oldHandlerInfo);
      } else {
        objects.pop();
      }
    } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
      // Reuse the matching oldHandlerInfo
      return oldHandlerInfo;
    } else {
      if (this.preTransitionState) {
        let preTransitionHandlerInfo = this.preTransitionState.routeInfos[i];
        objectToUse = preTransitionHandlerInfo && preTransitionHandlerInfo.context!;
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

    return new UnresolvedRouteInfoByObject(this.router, name, names, objectToUse as Dict<unknown>);
  }

  createParamHandlerInfo(
    name: string,
    names: string[],
    objects: unknown[],
    oldHandlerInfo: InternalRouteInfo<T>
  ) {
    let params: Dict<unknown> = {};

    // Soak up all the provided string/numbers
    let numNames = names.length;
    let missingParams = [];
    while (numNames--) {
      // Only use old params if the names match with the new handler
      let oldParams =
        (oldHandlerInfo && name === oldHandlerInfo.name && oldHandlerInfo.params) || {};

      let peek = objects[objects.length - 1];
      let paramName = names[numNames];
      if (isParam(peek)) {
        params[paramName] = '' + objects.pop();
      } else {
        // If we're here, this means only some of the params
        // were string/number params, so try and use a param
        // value from a previous handler.
        if (oldParams.hasOwnProperty(paramName)) {
          params[paramName] = oldParams[paramName];
        } else {
          missingParams.push(paramName);
        }
      }
    }
    if (missingParams.length > 0) {
      throw new Error(
        `You didn't provide enough string/numeric parameters to satisfy all of the dynamic segments for route ${name}.` +
          ` Missing params: ${missingParams}`
      );
    }

    return new UnresolvedRouteInfoByParam(this.router, name, names, params);
  }
}
