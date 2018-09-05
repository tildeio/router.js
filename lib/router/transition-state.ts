import { Promise } from 'rsvp';
import { Dict } from './core';
import RouteInfo, { Continuation, IHandler } from './route-info';
import { Transition } from './transition';
import { forEach, promiseLabel } from './utils';

interface IParams {
  [key: string]: unknown;
}

export default class TransitionState {
  handlerInfos: RouteInfo[] = [];
  queryParams: Dict<unknown> = {};
  params: IParams = {};

  promiseLabel(label: string) {
    let targetName = '';
    forEach(this.handlerInfos, function(handlerInfo) {
      if (targetName !== '') {
        targetName += '.';
      }
      targetName += handlerInfo.name;
      return true;
    });
    return promiseLabel("'" + targetName + "': " + label);
  }

  resolve(shouldContinue: Continuation, transition: Transition): Promise<TransitionState> {
    // First, calculate params for this state. This is useful
    // information to provide to the various route hooks.
    let params = this.params;
    forEach(this.handlerInfos, handlerInfo => {
      params[handlerInfo.name] = handlerInfo.params || {};
      return true;
    });

    transition.resolveIndex = 0;

    let currentState = this;
    let wasAborted = false;

    // The prelude RSVP.resolve() asyncs us into the promise land.
    return Promise.resolve(null, this.promiseLabel('Start transition'))
      .then(resolveOneHandlerInfo, null, this.promiseLabel('Resolve handler'))
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
      let handlerInfos = currentState.handlerInfos;
      let errorHandlerIndex =
        transition.resolveIndex >= handlerInfos.length
          ? handlerInfos.length - 1
          : transition.resolveIndex;
      return Promise.reject(
        new TransitionError(
          error,
          currentState.handlerInfos[errorHandlerIndex].handler!,
          wasAborted,
          currentState
        )
      );
    }

    function proceed(resolvedHandlerInfo: RouteInfo): Promise<RouteInfo> {
      let wasAlreadyResolved = currentState.handlerInfos[transition.resolveIndex].isResolved;

      // Swap the previously unresolved handlerInfo with
      // the resolved handlerInfo
      currentState.handlerInfos[transition.resolveIndex++] = resolvedHandlerInfo;

      if (!wasAlreadyResolved) {
        // Call the redirect hook. The reason we call it here
        // vs. afterModel is so that redirects into child
        // routes don't re-run the model hooks for this
        // already-resolved route.
        let handler = resolvedHandlerInfo.handler;
        if (handler !== undefined) {
          if (handler._redirect) {
            handler._redirect(resolvedHandlerInfo.context!, transition);
          } else if (handler.redirect) {
            handler.redirect(resolvedHandlerInfo.context!, transition);
          }
        }
      }

      // Proceed after ensuring that the redirect hook
      // didn't abort this transition by transitioning elsewhere.
      return innerShouldContinue().then(
        resolveOneHandlerInfo,
        null,
        currentState.promiseLabel('Resolve handler')
      );
    }

    function resolveOneHandlerInfo(): TransitionState | Promise<any> {
      if (transition.resolveIndex === currentState.handlerInfos.length) {
        // This is is the only possible
        // fulfill value of TransitionState#resolve
        return currentState;
      }

      let handlerInfo = currentState.handlerInfos[transition.resolveIndex];

      return handlerInfo
        .resolve(innerShouldContinue, transition)
        .then(proceed, null, currentState.promiseLabel('Proceed'));
    }
  }
}

export class TransitionError {
  constructor(
    public error: Error,
    public handler: IHandler,
    public wasAborted: boolean,
    public state: TransitionState
  ) {}
}
