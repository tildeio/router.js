import TransitionIntent from '../transition-intent';
import TransitionState from '../transition-state';
import handlerInfoFactory from '../handler-info/factory';
import { isParam, extractQueryParams, merge, subclass } from '../utils';

export default subclass(TransitionIntent, {
  name: null,
  pivotHandler: null,
  contexts: null,
  queryParams: null,

  initialize: function(props) {
    this.name = props.name;
    this.pivotHandler = props.pivotHandler;
    this.contexts = props.contexts || [];
    this.queryParams = props.queryParams;
  },

  applyToState: function(oldState, recognizer, getHandler, isIntermediate, getSerializer) {

    var partitionedArgs     = extractQueryParams([this.name].concat(this.contexts)),
      pureArgs              = partitionedArgs[0],
      handlers              = recognizer.handlersFor(pureArgs[0]);

    var targetRouteName = handlers[handlers.length-1].handler;

    return this.applyToHandlers(oldState, handlers, getHandler, targetRouteName, isIntermediate, null, getSerializer);
  },

  applyToHandlers: function(oldState, handlers, getHandler, targetRouteName, isIntermediate, checkingIfActive, getSerializer) {

    var i, len;
    var newState = new TransitionState();
    var objects = this.contexts.slice(0);

    var invalidateIndex = handlers.length;

    // Pivot handlers are provided for refresh transitions
    if (this.pivotHandler) {
      for (i = 0, len = handlers.length; i < len; ++i) {
        if (handlers[i].handler === this.pivotHandler._handlerName) {
          invalidateIndex = i;
          break;
        }
      }
    }

    for (i = handlers.length - 1; i >= 0; --i) {
      var result = handlers[i];
      var name = result.handler;

      var oldHandlerInfo = oldState.handlerInfos[i];
      var newHandlerInfo = null;

      if (result.names.length > 0) {
        if (i >= invalidateIndex) {
          newHandlerInfo = this.createParamHandlerInfo(name, getHandler, result.names, objects, oldHandlerInfo);
        } else {
          var serializer = getSerializer(name);
          newHandlerInfo = this.getHandlerInfoForDynamicSegment(name, getHandler, result.names, objects, oldHandlerInfo, targetRouteName, i, serializer);
        }
      } else {
        // This route has no dynamic segment.
        // Therefore treat as a param-based handlerInfo
        // with empty params. This will cause the `model`
        // hook to be called with empty params, which is desirable.
        newHandlerInfo = this.createParamHandlerInfo(name, getHandler, result.names, objects, oldHandlerInfo);
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
      if (i >= invalidateIndex || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
        invalidateIndex = Math.min(i, invalidateIndex);
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
      this.invalidateChildren(newState.handlerInfos, invalidateIndex);
    }

    merge(newState.queryParams, this.queryParams || {});

    return newState;
  },

  invalidateChildren: function(handlerInfos, invalidateIndex) {
    for (var i = invalidateIndex, l = handlerInfos.length; i < l; ++i) {
      var handlerInfo = handlerInfos[i];
      handlerInfos[i] = handlerInfo.getUnresolved();
    }
  },

  getHandlerInfoForDynamicSegment: function(name, getHandler, names, objects, oldHandlerInfo, targetRouteName, i, serializer) {
    var objectToUse;
    if (objects.length > 0) {

      // Use the objects provided for this transition.
      objectToUse = objects[objects.length - 1];
      if (isParam(objectToUse)) {
        return this.createParamHandlerInfo(name, getHandler, names, objects, oldHandlerInfo);
      } else {
        objects.pop();
      }
    } else if (oldHandlerInfo && oldHandlerInfo.name === name) {
      // Reuse the matching oldHandlerInfo
      return oldHandlerInfo;
    } else {
      if (this.preTransitionState) {
        var preTransitionHandlerInfo = this.preTransitionState.handlerInfos[i];
        objectToUse = preTransitionHandlerInfo && preTransitionHandlerInfo.context;
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

    return handlerInfoFactory('object', {
      name: name,
      getHandler: getHandler,
      serializer: serializer,
      context: objectToUse,
      names: names
    });
  },

  createParamHandlerInfo: function(name, getHandler, names, objects, oldHandlerInfo) {
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

    return handlerInfoFactory('param', {
      name: name,
      getHandler: getHandler,
      params: params
    });
  }
});

