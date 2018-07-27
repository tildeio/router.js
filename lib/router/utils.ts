import { Promise } from 'rsvp';
import { Dict } from './core';
import HandlerInfo, { IHandler } from './handler-info';
import Router from './router';
import { Transition } from './transition';
import { UnrecognizedURLError } from './unrecognized-url-error';

export const slice = Array.prototype.slice;
const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
  Determines if an object is Promise by checking if it is "thenable".
**/
export function isPromise<T>(p: any): p is Promise<T> {
  return p !== null && typeof p === 'object' && typeof p.then === 'function';
}

export function merge(hash: Dict<unknown>, other: Dict<unknown>) {
  for (let prop in other) {
    if (hasOwnProperty.call(other, prop)) {
      hash[prop] = other[prop];
    }
  }
}

/**
  @private

  Extracts query params from the end of an array
**/
export function extractQueryParams(array: unknown[]) {
  let len = array && array.length,
    head,
    queryParams;

  if (len && len > 0) {
    let obj = array[len - 1];
    if (isQueryParams(obj)) {
      queryParams = obj.queryParams;
      head = slice.call(array, 0, len - 1);
      return [head, queryParams];
    }
  }

  return [array, null];
}

function isQueryParams(obj: unknown): obj is { queryParams: Dict<unknown> } {
  return obj && hasOwnProperty.call(obj, 'queryParams');
}

/**
  @private

  Coerces query param properties and array elements into strings.
**/
export function coerceQueryParamsToString(queryParams: Dict<unknown>) {
  for (let key in queryParams) {
    let val = queryParams[key];
    if (typeof val === 'number') {
      queryParams[key] = '' + val;
    } else if (Array.isArray(val)) {
      for (let i = 0, l = val.length; i < l; i++) {
        val[i] = '' + val[i];
      }
    }
  }
}
/**
  @private
 */
export function log(router: Router, ...args: (string | number)[]): void {
  if (!router.log) {
    return;
  }

  if (arguments.length === 2) {
    let [sequence, msg] = args;
    router.log('Transition #' + sequence + ': ' + msg);
  } else {
    let [msg] = args;
    router.log(msg as string);
  }
}

export function isParam(object: Dict<unknown>) {
  return (
    typeof object === 'string' ||
    object instanceof String ||
    typeof object === 'number' ||
    object instanceof Number
  );
}

export function forEach<T>(array: T[], callback: (item: T) => boolean) {
  for (let i = 0, l = array.length; i < l && callback(array[i]) !== false; i++) {
    // empty intentionally
  }
}

// name:string,
//
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  transition?: Transition
): void;
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  changedQueryParams?: Dict<unknown>,
  allQueryParams?: Dict<unknown>,
  removedQueryParams?: Dict<unknown>
): void;
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  newQueryParams?: Dict<unknown>,
  finalQueryParams?: Dict<unknown>[],
  transition?: Transition
): void;
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  err?: Error,
  transition?: Transition,
  handler?: IHandler
): void;
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  transition?: Transition,
  handler?: IHandler
): void;
export function trigger(
  router: Router,
  handlerInfos: HandlerInfo[],
  ignoreFailure: boolean,
  name: string,
  ...args: any[]
) {
  if (router.triggerEvent) {
    router.triggerEvent(handlerInfos, ignoreFailure, [name, ...args]);
    return;
  }

  if (!handlerInfos) {
    if (ignoreFailure) {
      return;
    }
    throw new Error("Could not trigger event '" + name + "'. There are no active handlers");
  }

  let eventWasHandled = false;

  for (let i = handlerInfos.length - 1; i >= 0; i--) {
    let currentHandlerInfo = handlerInfos[i],
      currentHandler = currentHandlerInfo.handler;

    // If there is no handler, it means the handler hasn't resolved yet which
    // means that we should trigger the event later when the handler is available
    if (!currentHandler) {
      currentHandlerInfo.handlerPromise!.then(function(resolvedHandler) {
        resolvedHandler.events![name].apply(resolvedHandler, args);
      });
      continue;
    }

    if (currentHandler.events && currentHandler.events[name]) {
      if (currentHandler.events[name].apply(currentHandler, args) === true) {
        eventWasHandled = true;
      } else {
        return;
      }
    }
  }

  // In the case that we got an UnrecognizedURLError as an event with no handler,
  // let it bubble up
  if (name === 'error' && (args[0] as UnrecognizedURLError)!.name === 'UnrecognizedURLError') {
    throw args[0];
  } else if (!eventWasHandled && !ignoreFailure) {
    throw new Error("Nothing handled the event '" + name + "'.");
  }
}

export interface ChangeList {
  all: Dict<unknown>;
  changed: Dict<unknown>;
  removed: Dict<unknown>;
}

export function getChangelist(
  oldObject: Dict<unknown>,
  newObject: Dict<unknown>
): ChangeList | undefined {
  let key;
  let results: ChangeList = {
    all: {},
    changed: {},
    removed: {},
  };

  merge(results.all, newObject);

  let didChange = false;
  coerceQueryParamsToString(oldObject);
  coerceQueryParamsToString(newObject);

  // Calculate removals
  for (key in oldObject) {
    if (hasOwnProperty.call(oldObject, key)) {
      if (!hasOwnProperty.call(newObject, key)) {
        didChange = true;
        results.removed[key] = oldObject[key];
      }
    }
  }

  // Calculate changes
  for (key in newObject) {
    if (hasOwnProperty.call(newObject, key)) {
      let oldElement = oldObject[key];
      let newElement = newObject[key];
      if (isArray(oldElement) && isArray(newElement)) {
        if (oldElement.length !== newElement.length) {
          results.changed[key] = newObject[key];
          didChange = true;
        } else {
          for (let i = 0, l = oldElement.length; i < l; i++) {
            if (oldElement[i] !== newElement[i]) {
              results.changed[key] = newObject[key];
              didChange = true;
            }
          }
        }
      } else if (oldObject[key] !== newObject[key]) {
        results.changed[key] = newObject[key];
        didChange = true;
      }
    }
  }

  return didChange ? results : undefined;
}

function isArray(obj: unknown): obj is ArrayLike<unknown> {
  return Array.isArray(obj);
}

export function promiseLabel(label: string) {
  return 'Router: ' + label;
}

// export function callHook(obj: any, _hookName: string, arg1?: unknown, arg2?: unknown) {
//   let hookName = resolveHook(obj, _hookName);
//   return hookName && obj[hookName].call(obj, arg1, arg2);
// }
