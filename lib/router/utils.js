var slice = Array.prototype.slice;

function merge(hash, other) {
  for (var prop in other) {
    if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
  }
}

var oCreate = Object.create || function(proto) {
  function F() {}
  F.prototype = proto;
  return new F();
};

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

function bind(fn, context) {
  var boundArgs = arguments;
  return function(value) {
    var args = slice.call(boundArgs, 2);
    args.push(value);
    return fn.apply(context, args);
  };
}

function isParam(object) {
  return (typeof object === "string" || object instanceof String || typeof object === "number" || object instanceof Number);
}


function forEach(array, callback) {
  for (var i=0, l=array.length; i<l && false !== callback(array[i]); i++) { }
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

export { trigger, log, oCreate, merge, extractQueryParams, bind, isParam, forEach, slice, serialize };
