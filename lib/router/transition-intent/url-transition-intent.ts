import { Route, UnresolvedRouteInfoByParam } from '../route-info';
import Router from '../router';
import { TransitionIntent } from '../transition-intent';
import TransitionState from '../transition-state';
import UnrecognizedURLError from '../unrecognized-url-error';
import { merge } from '../utils';

export default class URLTransitionIntent<T extends Route> extends TransitionIntent<T> {
  preTransitionState?: TransitionState<T>;
  url: string;
  constructor(router: Router<T>, url: string, data?: {}) {
    super(router, data);
    this.url = url;
    this.preTransitionState = undefined;
  }

  applyToState(oldState: TransitionState<T>) {
    let newState = new TransitionState<T>();
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
    function checkHandlerAccessibility(handler: T) {
      if (handler && handler.inaccessibleByURL) {
        throw new UnrecognizedURLError(_url);
      }

      return handler;
    }

    for (i = 0, len = results.length; i < len; ++i) {
      let result = results[i]!;
      let name = result.handler as string;
      let paramNames: string[] = [];

      if (this.router.recognizer.hasRoute(name)) {
        paramNames = this.router.recognizer.handlersFor(name)[i].names;
      }

      let newRouteInfo = new UnresolvedRouteInfoByParam(
        this.router,
        name,
        paramNames,
        result.params
      );

      let route = newRouteInfo.route;

      if (route) {
        checkHandlerAccessibility(route);
      } else {
        // If the handler is being loaded asynchronously, check if we can
        // access it after it has resolved
        newRouteInfo.routePromise = newRouteInfo.routePromise.then(checkHandlerAccessibility);
      }

      let oldRouteInfo = oldState.routeInfos[i];
      if (statesDiffer || newRouteInfo.shouldSupersede(oldRouteInfo)) {
        statesDiffer = true;
        newState.routeInfos[i] = newRouteInfo;
      } else {
        newState.routeInfos[i] = oldRouteInfo;
      }
    }

    merge(newState.queryParams, results.queryParams);

    return newState;
  }
}
