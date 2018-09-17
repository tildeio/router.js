import { Route, UnresolvedHandlerInfoByParam } from '../route-info';
import Router from '../router';
import { TransitionIntent } from '../transition-intent';
import TransitionState from '../transition-state';
import UnrecognizedURLError from '../unrecognized-url-error';
import { merge } from '../utils';

export default class URLTransitionIntent extends TransitionIntent {
  preTransitionState?: TransitionState;
  url: string;
  constructor(url: string, router: Router) {
    super(router);
    this.url = url;
    this.preTransitionState = undefined;
  }

  applyToState(oldState: TransitionState) {
    let newState = new TransitionState();

    let results = this.router.recognizer.recognize(this.url),
      i,
      len;

    if (!results) {
      throw new UnrecognizedURLError(this.url);
    }

    let statesDiffer = false;
    let _url = this.url;

    // Checks if a handler is accessible by URL. If it is not, an error is thrown.
    // For the case where the handler is loaded asynchronously, the error will be
    // thrown once it is loaded.
    function checkHandlerAccessibility(handler: Route) {
      if (handler && handler.inaccessibleByURL) {
        throw new UnrecognizedURLError(_url);
      }

      return handler;
    }

    for (i = 0, len = results.length; i < len; ++i) {
      let result = results[i]!;
      let name = result.handler as string;

      let newHandlerInfo = new UnresolvedHandlerInfoByParam(name, this.router, result.params);

      let handler = newHandlerInfo.route;

      if (handler) {
        checkHandlerAccessibility(handler);
      } else {
        // If the hanlder is being loaded asynchronously, check if we can
        // access it after it has resolved
        newHandlerInfo.routePromise = newHandlerInfo.routePromise.then(checkHandlerAccessibility);
      }

      let oldHandlerInfo = oldState.handlerInfos[i];
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
}
