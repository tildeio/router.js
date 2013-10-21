import { TransitionIntent } from '../transition-intent';
import { TransitionState } from '../transition-state';
import { UnresolvedHandlerInfoByParam } from '../handler-info';
import { extractQueryParams, oCreate, merge } from '../utils';

function RefreshTransitionIntent(props) {
  TransitionIntent.call(this, props);
}

RefreshTransitionIntent.prototype = oCreate(TransitionIntent.prototype);
RefreshTransitionIntent.prototype.applyToState = function(oldState, recognizer, getHandler, isIntermediate) {

  var pivotHandlerFound = false;
  var newState = new TransitionState();

  var oldHandlerInfos = oldState.handlerInfos;
  for (var i = 0, len = oldHandlerInfos.length; i < len; ++i) {
    var handlerInfo = oldHandlerInfos[i];
    if (handlerInfo.handler === this.pivotHandler) {
      pivotHandlerFound = true;
    }

    if (pivotHandlerFound) {
      newState.handlerInfos.push(new UnresolvedHandlerInfoByParam({
        name: handlerInfo.name,
        handler: handlerInfo.handler,
        params: handlerInfo.params || {}
      }));
    } else {
      newState.handlerInfos.push(handlerInfo);
    }
  }

  merge(newState.queryParams, oldState.queryParams);
  if (this.queryParams) {
    merge(newState.queryParams, this.queryParams);
  }

  return newState;
};

export { RefreshTransitionIntent };
