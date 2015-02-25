"use strict";
var ResolvedHandlerInfo = require("./handler-info").ResolvedHandlerInfo;
var forEach = require("./utils").forEach;
var promiseLabel = require("./utils").promiseLabel;
var callHook = require("./utils").callHook;
var Promise = require("rsvp").Promise;

function TransitionState(other) {
  this.handlerInfos = [];
  this.queryParams = {};
  this.params = {};
}

TransitionState.prototype = {
  handlerInfos: null,
  queryParams: null,
  params: null,

  promiseLabel: function(label) {
    var targetName = '';
    forEach(this.handlerInfos, function(handlerInfo) {
      if (targetName !== '') {
        targetName += '.';
      }
      targetName += handlerInfo.name;
    });
    return promiseLabel("'" + targetName + "': " + label);
  },

  resolve: function(shouldContinue, payload) {
    var self = this;
    // First, calculate params for this state. This is useful
    // information to provide to the various route hooks.
    var params = this.params;
    forEach(this.handlerInfos, function(handlerInfo) {
      params[handlerInfo.name] = handlerInfo.params || {};
    });

    payload = payload || {};
    payload.resolveIndex = 0;

    var currentState = this;
    var wasAborted = false;

    // The prelude RSVP.resolve() asyncs us into the promise land.
    return Promise.resolve(null, this.promiseLabel("Start transition"))
    .then(resolveOneHandlerInfo, null, this.promiseLabel('Resolve handler'))['catch'](handleError, this.promiseLabel('Handle error'));

    function innerShouldContinue() {
      return Promise.resolve(shouldContinue(), currentState.promiseLabel("Check if should continue"))['catch'](function(reason) {
        // We distinguish between errors that occurred
        // during resolution (e.g. beforeModel/model/afterModel),
        // and aborts due to a rejecting promise from shouldContinue().
        wasAborted = true;
        return Promise.reject(reason);
      }, currentState.promiseLabel("Handle abort"));
    }

    function handleError(error) {
      // This is the only possible
      // reject value of TransitionState#resolve
      var handlerInfos = currentState.handlerInfos;
      var errorHandlerIndex = payload.resolveIndex >= handlerInfos.length ?
                              handlerInfos.length - 1 : payload.resolveIndex;
      return Promise.reject({
        error: error,
        handlerWithError: currentState.handlerInfos[errorHandlerIndex].handler,
        wasAborted: wasAborted,
        state: currentState
      });
    }

    function proceed(resolvedHandlerInfo) {
      var wasAlreadyResolved = currentState.handlerInfos[payload.resolveIndex].isResolved;

      // Swap the previously unresolved handlerInfo with
      // the resolved handlerInfo
      currentState.handlerInfos[payload.resolveIndex++] = resolvedHandlerInfo;

      if (!wasAlreadyResolved) {
        // Call the redirect hook. The reason we call it here
        // vs. afterModel is so that redirects into child
        // routes don't re-run the model hooks for this
        // already-resolved route.
        var handler = resolvedHandlerInfo.handler;
        callHook(handler, 'redirect', resolvedHandlerInfo.context, payload);
      }

      // Proceed after ensuring that the redirect hook
      // didn't abort this transition by transitioning elsewhere.
      return innerShouldContinue().then(resolveOneHandlerInfo, null, currentState.promiseLabel('Resolve handler'));
    }

    function resolveOneHandlerInfo() {
      if (payload.resolveIndex === currentState.handlerInfos.length) {
        // This is is the only possible
        // fulfill value of TransitionState#resolve
        return {
          error: null,
          state: currentState
        };
      }

      var handlerInfo = currentState.handlerInfos[payload.resolveIndex];

      return handlerInfo.resolve(innerShouldContinue, payload)
                        .then(proceed, null, currentState.promiseLabel('Proceed'));
    }
  }
};

exports["default"] = TransitionState;