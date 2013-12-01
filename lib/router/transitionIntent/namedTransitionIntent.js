import { TransitionIntent } from '../transitionIntent';
import { TransitionState } from '../transitionState';
import { oCreate } from '../utils';

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

export { NamedTransitionIntent };
