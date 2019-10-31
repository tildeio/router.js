import { Promise } from 'rsvp';
import { Dict } from './core';
import InternalRouteInfo, { Continuation, Route } from './route-info';
import Transition from './transition';
import { forEach, promiseLabel } from './utils';

interface IParams {
  [key: string]: unknown;
}

export default class TransitionState<T extends Route> {
  routeInfos: InternalRouteInfo<T>[] = [];
  queryParams: Dict<unknown> = {};
  params: IParams = {};

  promiseLabel(label: string) {
    let targetName = '';
    forEach(this.routeInfos, function(routeInfo) {
      if (targetName !== '') {
        targetName += '.';
      }
      targetName += routeInfo.name;
      return true;
    });
    return promiseLabel("'" + targetName + "': " + label);
  }

  resolve(shouldContinue: Continuation, transition: Transition<T>): Promise<TransitionState<T>> {
    // First, calculate params for this state. This is useful
    // information to provide to the various route hooks.
    let params = this.params;
    forEach(this.routeInfos, routeInfo => {
      params[routeInfo.name] = routeInfo.params || {};
      return true;
    });

    transition.resolveIndex = 0;

    let currentState = this;
    let wasAborted = false;

    // The prelude RSVP.resolve() asyncs us into the promise land.
    return Promise.resolve(null, this.promiseLabel('Start transition'))
      .then(resolveOneRouteInfo, null, this.promiseLabel('Resolve route'))
      .catch(handleError, this.promiseLabel('Handle error'));

    function innerShouldContinue() {
      return Promise.resolve(
        shouldContinue(),
        currentState.promiseLabel('Check if should continue')
      ).catch(function(reason) {
        // We distinguish between errors that occurred
        // during resolution (e.g. before"Model/model/afterModel),
        // and aborts due to a rejecting promise from shouldContinue().
        wasAborted = true;
        return Promise.reject(reason);
      }, currentState.promiseLabel('Handle abort'));
    }

    function handleError(error: Error) {
      // This is the only possible
      // reject value of TransitionState#resolve
      let routeInfos = currentState.routeInfos;
      let errorHandlerIndex =
        transition.resolveIndex >= routeInfos.length
          ? routeInfos.length - 1
          : transition.resolveIndex;
      return Promise.reject(
        new TransitionError(
          error,
          currentState.routeInfos[errorHandlerIndex].route!,
          wasAborted,
          currentState
        )
      );
    }

    function proceed(resolvedRouteInfo: InternalRouteInfo<T>): Promise<InternalRouteInfo<T>> {
      let wasAlreadyResolved = currentState.routeInfos[transition.resolveIndex].isResolved;

      // Swap the previously unresolved routeInfo with
      // the resolved routeInfo
      currentState.routeInfos[transition.resolveIndex++] = resolvedRouteInfo;

      if (!wasAlreadyResolved) {
        // Call the redirect hook. The reason we call it here
        // vs. afterModel is so that redirects into child
        // routes don't re-run the model hooks for this
        // already-resolved route.
        let { route } = resolvedRouteInfo;
        if (route !== undefined) {
          if (route.redirect) {
            route.redirect(resolvedRouteInfo.context as Dict<unknown>, transition);
          }
        }
      }

      // Proceed after ensuring that the redirect hook
      // didn't abort this transition by transitioning elsewhere.
      return innerShouldContinue().then(
        resolveOneRouteInfo,
        null,
        currentState.promiseLabel('Resolve route')
      );
    }

    function resolveOneRouteInfo(): TransitionState<T> | Promise<any> {
      if (transition.resolveIndex === currentState.routeInfos.length) {
        // This is is the only possible
        // fulfill value of TransitionState#resolve
        return currentState;
      }

      let routeInfo = currentState.routeInfos[transition.resolveIndex];

      return routeInfo
        .resolve(innerShouldContinue, transition)
        .then(proceed, null, currentState.promiseLabel('Proceed'));
    }
  }
}

export class TransitionError {
  constructor(
    public error: Error,
    public route: Route,
    public wasAborted: boolean,
    public state: TransitionState<any>
  ) {}
}
