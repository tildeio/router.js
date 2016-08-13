"use strict";
var TransitionIntent = require("../transition-intent")["default"];
var TransitionState = require("../transition-state")["default"];
var handlerInfoFactory = require("../handler-info/factory")["default"];
var merge = require("../utils").merge;
var subclass = require("../utils").subclass;
var UnrecognizedURLError = require("./../unrecognized-url-error")["default"];

exports["default"] = subclass(TransitionIntent, {
  url: null,

  initialize: function(props) {
    this.url = props.url;
  },

  applyToState: function(oldState, recognizer, getHandler) {
    var newState = new TransitionState();

    var results = recognizer.recognize(this.url),
        i, len;

    if (!results) {
      throw new UnrecognizedURLError(this.url);
    }

    var statesDiffer = false;
    var url = this.url;

    // Checks if a handler is accessible by URL. If it is not, an error is thrown.
    // For the case where the handler is loaded asynchronously, the error will be
    // thrown once it is loaded.
    function checkHandlerAccessibility(handler) {
      if (handler && handler.inaccessibleByURL) {
        throw new UnrecognizedURLError(url);
      }

      return handler;
    }

    for (i = 0, len = results.length; i < len; ++i) {
      var result = results[i];
      var name = result.handler;
      var newHandlerInfo = handlerInfoFactory('param', {
        name: name,
        getHandler: getHandler,
        params: result.params
      });
      var handler = newHandlerInfo.handler;

      if (handler) {
        checkHandlerAccessibility(handler);
      } else {
        // If the hanlder is being loaded asynchronously, check if we can
        // access it after it has resolved
        newHandlerInfo.handlerPromise = newHandlerInfo.handlerPromise.then(checkHandlerAccessibility);
      }

      var oldHandlerInfo = oldState.handlerInfos[i];
      if (statesDiffer || newHandlerInfo.shouldSupercede(oldHandlerInfo)) {
        statesDiffer = true;
        newState.handlerInfos[i] = newHandlerInfo;
      } else {
        newState.handlerInfos[i] = oldHandlerInfo;
      }
    }

    merge(newState.queryParams, results.queryParams);

    return newState;
  }
});