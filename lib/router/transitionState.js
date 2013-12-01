import { RSVP } from 'rsvp';

function TransitionState(other) {
  this.handlerInfos = [];
}

TransitionState.prototype = {
  resolve: function(async, shouldContinue, payload) {

    payload = payload || {};
    payload.resolveIndex = 0;

    var currentState = this;
    var wasAborted = false;

    // The prelude RSVP.resolve() asyncs us into the promise land.
    return RSVP.resolve().then(resolveOne).fail(handleError);

    function innerShouldContinue() {
      return RSVP.resolve(shouldContinue()).fail(function(reason) {
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
      return innerShouldContinue().then(resolveOne);
    }

    function resolveOne() {
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
  }
};


