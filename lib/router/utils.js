export const slice = Array.prototype.slice;
const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
  Determines if an object is Promise by checking if it is "thenable".
**/
export function isPromise(obj) {
  return (
    ((typeof obj === 'object' && obj !== null) || typeof obj === 'function') &&
    typeof obj.then === 'function'
  );
}

export function merge(hash, other) {
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
export function extractQueryParams(array) {
  let len = array && array.length,
    head,
    queryParams;

  if (
    len &&
    len > 0 &&
    array[len - 1] &&
    array[len - 1].hasOwnProperty('queryParams')
  ) {
    queryParams = array[len - 1].queryParams;
    head = slice.call(array, 0, len - 1);
    return [head, queryParams];
  } else {
    return [array, null];
  }
}

/**
  @private

  Coerces query param properties and array elements into strings.
**/
export function coerceQueryParamsToString(queryParams) {
  for (let key in queryParams) {
    if (typeof queryParams[key] === 'number') {
      queryParams[key] = '' + queryParams[key];
    } else if (Array.isArray(queryParams[key])) {
      for (let i = 0, l = queryParams[key].length; i < l; i++) {
        queryParams[key][i] = '' + queryParams[key][i];
      }
    }
  }
}
/**
  @private
 */
export function log(router, sequence, msg) {
  if (!router.log) {
    return;
  }

  if (arguments.length === 3) {
    router.log('Transition #' + sequence + ': ' + msg);
  } else {
    msg = sequence;
    router.log(msg);
  }
}

export function isParam(object) {
  return (
    typeof object === 'string' ||
    object instanceof String ||
    typeof object === 'number' ||
    object instanceof Number
  );
}

export function forEach(array, callback) {
  for (
    let i = 0, l = array.length;
    i < l && false !== callback(array[i]);
    i++
  ) {
    // empty intentionally
  }
}

export function trigger(router, handlerInfos, ignoreFailure, args) {
  if (router.triggerEvent) {
    router.triggerEvent(handlerInfos, ignoreFailure, args);
    return;
  }

  let name = args.shift();

  if (!handlerInfos) {
    if (ignoreFailure) {
      return;
    }
    throw new Error(
      "Could not trigger event '" + name + "'. There are no active handlers"
    );
  }

  let eventWasHandled = false;

  function delayedEvent(name, args, handler) {
    handler.events[name].apply(handler, args);
  }

  for (let i = handlerInfos.length - 1; i >= 0; i--) {
    let handlerInfo = handlerInfos[i],
      handler = handlerInfo.handler;

    // If there is no handler, it means the handler hasn't resolved yet which
    // means that we should trigger the event later when the handler is available
    if (!handler) {
      handlerInfo.handlerPromise.then(delayedEvent.bind(null, name, args));
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

export function getChangelist(oldObject, newObject) {
  let key;
  let results = {
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
      if (Array.isArray(oldObject[key]) && Array.isArray(newObject[key])) {
        if (oldObject[key].length !== newObject[key].length) {
          results.changed[key] = newObject[key];
          didChange = true;
        } else {
          for (let i = 0, l = oldObject[key].length; i < l; i++) {
            if (oldObject[key][i] !== newObject[key][i]) {
              results.changed[key] = newObject[key];
              didChange = true;
            }
          }
        }
      } else {
        if (oldObject[key] !== newObject[key]) {
          results.changed[key] = newObject[key];
          didChange = true;
        }
      }
    }
  }

  return didChange && results;
}

export function promiseLabel(label) {
  return 'Router: ' + label;
}

export function resolveHook(obj, hookName) {
  if (!obj) {
    return;
  }
  let underscored = '_' + hookName;
  return (obj[underscored] && underscored) || (obj[hookName] && hookName);
}

export function callHook(obj, _hookName, arg1, arg2) {
  let hookName = resolveHook(obj, _hookName);
  return hookName && obj[hookName].call(obj, arg1, arg2);
}

export function applyHook(obj, _hookName, args) {
  let hookName = resolveHook(obj, _hookName);
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
