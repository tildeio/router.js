"use strict";
var TransitionIntent = require("../transition-intent")["default"];
var TransitionState = require("../transition-state")["default"];
var handlerInfoFactory = require("../handler-info/factory")["default"];
var oCreate = require("../utils").oCreate;
var merge = require("../utils").merge;
var subclass = require("../utils").subclass;

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

    for (i = 0, len = results.length; i < len; ++i) {
      var result = results[i];
      var name = result.handler;
      var handler = getHandler(name);

      if (handler.inaccessibleByURL) {
        throw new UnrecognizedURLError(this.url);
      }

      var newHandlerInfo = handlerInfoFactory('param', {
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

    merge(newState.queryParams, results.queryParams);

    return newState;
  }
});

/**
  Promise reject reasons passed to promise rejection
  handlers for failed transitions.
 */
function UnrecognizedURLError(message) {
  this.message = (message || "UnrecognizedURLError");
  this.name = "UnrecognizedURLError";
}