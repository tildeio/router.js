import { TransitionIntent } from '../transitionIntent';
import { TransitionState } from '../transitionState';
import { UnresolvedHandlerInfoByParam } from '../handlerInfo';
import { oCreate } from '../utils';

function URLTransitionIntent(props) {
  TransitionIntent.call(this, props);
}

URLTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
URLTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler) {
  var newState = new TransitionState();

  var results = recognizer.recognize(this.url),
      queryParams = {},
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

    var newHandlerInfo = new UnresolvedHandlerInfoByParam({
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

  // TODO: query params
  //for(i = 0, len = results.length; i < len; i++) {
    //merge(queryParams, results[i].queryParams);
  //}

  return statesDiffer ? newState : oldState;
};

/**
  Promise reject reasons passed to promise rejection
  handlers for failed transitions.
 */
function UnrecognizedURLError(message) {
  this.message = (message || "UnrecognizedURLError");
  this.name = "UnrecognizedURLError";
}

export { URLTransitionIntent };
