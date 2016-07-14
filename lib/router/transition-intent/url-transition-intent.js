import TransitionIntent from '../transition-intent';
import TransitionState from '../transition-state';
import handlerInfoFactory from '../handler-info/factory';
import { oCreate, merge, subclass, isPromise } from '../utils';
import UnrecognizedURLError from './../unrecognized-url-error';

export default subclass(TransitionIntent, {
  url: null,

  initialize: function(props) {
    this.url = props.url;
  },

  applyToState: function(oldState, recognizer, getHandler) {
    var newState = new TransitionState();

    var results = recognizer.recognize(this.url),
        queryParams = {},
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
      if (handler.inaccessibleByURL) {
        throw new UnrecognizedURLError(url);
      }

      return handler;
    }

    for (i = 0, len = results.length; i < len; ++i) {
      var result = results[i];
      var name = result.handler;
      var handler = getHandler(name);

      checkHandlerAccessibility(handler);

      var newHandlerInfo = handlerInfoFactory('param', {
        name: name,
        handler: handler,
        params: result.params
      });

      // If the hanlder is being loaded asynchronously, check again if we can
      // access it after it has resolved
      if (isPromise(handler)) {
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
