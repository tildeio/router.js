import { ResolvedHandlerInfo } from './handler-info';
import { forEach } from './utils';
import { resolve } from 'rsvp';

function TransitionState(other) {
  this.handlerInfos = [];
  this.queryParams = {};
  this.params = {};
}

TransitionState.prototype = {
  handlerInfos: null,
  queryParams: null,
  params: null,

  resolve: function(async, shouldContinue, payload) {

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
    return resolve().then(resolveOneHandlerInfo).catch(handleError);

    function innerShouldContinue() {
      return resolve(shouldContinue()).catch(function(reason) {
        // We distinguish between errors that occurred
        // during resolution (e.g. beforeModel/model/afterModel),
        // and aborts due to a rejecting promise from shouldContinue().
        wasAborted = true;
        throw reason;
      });
    }

    function handleError(error) {
      // This is the only possible
      // reject value of TransitionState#resolve
      throw {
        error: error,
        handlerWithError: currentState.handlerInfos[payload.resolveIndex].handler,
        wasAborted: wasAborted,
        state: currentState
      };
    }

    function proceed(resolvedHandlerInfo) {
      // Swap the previously unresolved handlerInfo with
      // the resolved handlerInfo
      currentState.handlerInfos[payload.resolveIndex++] = resolvedHandlerInfo;

      // Call the redirect hook. The reason we call it here
      // vs. afterModel is so that redirects into child
      // routes don't re-run the model hooks for this
      // already-resolved route.
      var handler = resolvedHandlerInfo.handler;
      if (handler && handler.redirect) {
        handler.redirect(resolvedHandlerInfo.context, payload);
      }

      // Proceed after ensuring that the redirect hook
      // didn't abort this transition by transitioning elsewhere.
      return innerShouldContinue().then(resolveOneHandlerInfo);
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

      return handlerInfo.resolve(async, innerShouldContinue, payload)
                        .then(proceed);
    }
  },

  getResolvedHandlerInfos: function() {
    var resolvedHandlerInfos = [];
    var handlerInfos = this.handlerInfos;
    for (var i = 0, len = handlerInfos.length; i < len; ++i) {
      var handlerInfo = handlerInfos[i];
      if (!(handlerInfo instanceof ResolvedHandlerInfo)) {
        break;
      }
      resolvedHandlerInfos.push(handlerInfo);
    }
    return resolvedHandlerInfos;
  }
};

export { TransitionState };
