import { OnFulfilled, OnRejected, Promise } from 'rsvp';
import { Dict, Maybe } from './core';
import HandlerInfo, { IHandler } from './handler-info';
import Router from './router';
import TransitionAborted from './transition-aborted-error';
import { TransitionIntent } from './transition-intent';
import TransitionState, { TransitionError } from './transition-state';
import { log, promiseLabel } from './utils';

export { default as TransitionAborted } from './transition-aborted-error';

/**
  A Transition is a thennable (a promise-like object) that represents
  an attempt to transition to another route. It can be aborted, either
  explicitly via `abort` or by attempting another transition while a
  previous one is still underway. An aborted transition can also
  be `retry()`d later.

  @class Transition
  @constructor
  @param {Object} router
  @param {Object} intent
  @param {Object} state
  @param {Object} error
  @private
 */
export class Transition {
  state?: TransitionState;
  router: Router;
  data: Dict<unknown>;
  intent?: TransitionIntent;
  resolvedModels: Dict<Dict<unknown> | undefined>;
  queryParams: Dict<unknown>;
  promise?: Promise<any>; // Todo: Fix this shit its actually TransitionState | IHandler | undefined | Error
  error: Maybe<Error>;
  params: Dict<unknown>;
  handlerInfos: HandlerInfo[];
  targetName: Maybe<string>;
  pivotHandler: Maybe<IHandler>;
  sequence: number;
  isAborted = false;
  isActive = true;
  urlMethod = 'update';
  resolveIndex = 0;
  queryParamsOnly = false;
  isTransition = true;
  isCausedByAbortingTransition = false;
  isCausedByInitialTransition = false;
  isCausedByAbortingReplaceTransition = false;
  _visibleQueryParams: Dict<unknown> = {};

  constructor(
    router: Router,
    intent: TransitionIntent | undefined,
    state: TransitionState | undefined,
    error: Maybe<Error> = undefined,
    previousTransition: Maybe<Transition> = undefined
  ) {
    this.state = state || router.state;
    this.intent = intent;
    this.router = router;
    this.data = (intent && intent.data) || {};
    this.resolvedModels = {};
    this.queryParams = {};
    this.promise = undefined;
    this.error = undefined;
    this.params = {};
    this.handlerInfos = [];
    this.targetName = undefined;
    this.pivotHandler = undefined;
    this.sequence = -1;

    if (error) {
      this.promise = Promise.reject(error);
      this.error = error;
      return;
    }

    // if you're doing multiple redirects, need the new transition to know if it
    // is actually part of the first transition or not. Any further redirects
    // in the initial transition also need to know if they are part of the
    // initial transition
    this.isCausedByAbortingTransition = !!previousTransition;
    this.isCausedByInitialTransition =
      !!previousTransition &&
      (previousTransition.isCausedByInitialTransition || previousTransition.sequence === 0);
    // Every transition in the chain is a replace
    this.isCausedByAbortingReplaceTransition =
      !!previousTransition &&
      (previousTransition.urlMethod === 'replace' &&
        (!previousTransition.isCausedByAbortingTransition ||
          previousTransition.isCausedByAbortingReplaceTransition));

    if (state) {
      this.params = state.params;
      this.queryParams = state.queryParams;
      this.handlerInfos = state.handlerInfos;

      let len = state.handlerInfos.length;
      if (len) {
        this.targetName = state.handlerInfos[len - 1].name;
      }

      for (let i = 0; i < len; ++i) {
        let handlerInfo = state.handlerInfos[i];

        // TODO: this all seems hacky
        if (!handlerInfo.isResolved) {
          break;
        }
        this.pivotHandler = handlerInfo.handler;
      }

      this.sequence = router.currentSequence++;
      this.promise = state
        .resolve(() => {
          if (this.isAborted) {
            return Promise.reject(false, promiseLabel('Transition aborted - reject'));
          }

          return Promise.resolve(true);
        }, this)
        .catch((result: TransitionError) => {
          if (result.wasAborted || this.isAborted) {
            return Promise.reject(logAbort(this));
          } else {
            this.trigger(false, 'error', result.error, this, result.handler);
            this.abort();
            return Promise.reject(result.error);
          }
        }, promiseLabel('Handle Abort'));
    } else {
      this.promise = Promise.resolve(this.state!);
      this.params = {};
    }
  }

  // Todo Delete?
  isExiting(handler: IHandler | string) {
    let handlerInfos = this.handlerInfos;
    for (let i = 0, len = handlerInfos.length; i < len; ++i) {
      let handlerInfo = handlerInfos[i];
      if (handlerInfo.name === handler || handlerInfo.handler === handler) {
        return false;
      }
    }
    return true;
  }

  /**
    The Transition's internal promise. Calling `.then` on this property
    is that same as calling `.then` on the Transition object itself, but
    this property is exposed for when you want to pass around a
    Transition's promise, but not the Transition object itself, since
    Transition object can be externally `abort`ed, while the promise
    cannot.

    @property promise
    @type {Object}
    @public
   */

  /**
    Custom state can be stored on a Transition's `data` object.
    This can be useful for decorating a Transition within an earlier
    hook and shared with a later hook. Properties set on `data` will
    be copied to new transitions generated by calling `retry` on this
    transition.

    @property data
    @type {Object}
    @public
   */

  /**
    A standard promise hook that resolves if the transition
    succeeds and rejects if it fails/redirects/aborts.

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @method then
    @param {Function} onFulfilled
    @param {Function} onRejected
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
    @public
   */
  then<T>(
    onFulfilled: OnFulfilled<TransitionState | undefined | Error, T>,
    onRejected: OnRejected<TransitionState, T>,
    label: string
  ) {
    return this.promise!.then(onFulfilled, onRejected, label);
  }

  /**

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @method catch
    @param {Function} onRejection
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
    @public
   */
  catch<T>(onRejection: OnRejected<TransitionState, T>, label: string) {
    return this.promise!.catch(onRejection, label);
  }

  /**

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @method finally
    @param {Function} callback
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
    @public
   */
  finally<T>(callback: T | undefined, label?: string) {
    return this.promise!.finally(callback, label);
  }

  /**
    Aborts the Transition. Note you can also implicitly abort a transition
    by initiating another transition while a previous one is underway.

    @method abort
    @return {Transition} this transition
    @public
   */
  abort() {
    if (this.isAborted) {
      return this;
    }
    log(this.router, this.sequence, this.targetName + ': transition was aborted');

    this.intent!.preTransitionState = this.router.state;
    this.isAborted = true;
    this.isActive = false;
    this.router.activeTransition = undefined;
    return this;
  }

  /**

    Retries a previously-aborted transition (making sure to abort the
    transition if it's still active). Returns a new transition that
    represents the new attempt to transition.

    @method retry
    @return {Transition} new transition
    @public
   */
  retry() {
    // TODO: add tests for merged state retry()s
    this.abort();
    let newTransition = this.router.transitionByIntent(this.intent!, false);

    // inheriting a `null` urlMethod is not valid
    // the urlMethod is only set to `null` when
    // the transition is initiated *after* the url
    // has been updated (i.e. `router.handleURL`)
    //
    // in that scenario, the url method cannot be
    // inherited for a new transition because then
    // the url would not update even though it should
    if (this.urlMethod !== null) {
      newTransition.method(this.urlMethod);
    }
    return newTransition;
  }

  /**

    Sets the URL-changing method to be employed at the end of a
    successful transition. By default, a new Transition will just
    use `updateURL`, but passing 'replace' to this method will
    cause the URL to update using 'replaceWith' instead. Omitting
    a parameter will disable the URL change, allowing for transitions
    that don't update the URL at completion (this is also used for
    handleURL, since the URL has already changed before the
    transition took place).

    @method method
    @param {String} method the type of URL-changing method to use
      at the end of a transition. Accepted values are 'replace',
      falsy values, or any other non-falsy value (which is
      interpreted as an updateURL transition).

    @return {Transition} this transition
    @public
   */
  method(method: string) {
    this.urlMethod = method;
    return this;
  }

  // Alias 'trigger' as 'send'
  send(
    ignoreFailure: boolean,
    _name: string,
    err?: Error,
    transition?: Transition,
    handler?: IHandler
  ) {
    this.trigger(ignoreFailure, _name, err, transition, handler);
  }

  /**

    Fires an event on the current list of resolved/resolving
    handlers within this transition. Useful for firing events
    on route hierarchies that haven't fully been entered yet.

    Note: This method is also aliased as `send`

    @method trigger
    @param {Boolean} [ignoreFailure=false] a boolean specifying whether unhandled events throw an error
    @param {String} name the name of the event to fire
    @public
   */
  trigger(ignoreFailure: boolean, name: string, ...args: any[]) {
    this.router.triggerEvent(
      this.state!.handlerInfos.slice(0, this.resolveIndex + 1),
      ignoreFailure,
      name,
      args
    );
  }

  /**
    Transitions are aborted and their promises rejected
    when redirects occur; this method returns a promise
    that will follow any redirects that occur and fulfill
    with the value fulfilled by any redirecting transitions
    that occur.

    @method followRedirects
    @return {Promise} a promise that fulfills with the same
      value that the final redirecting transition fulfills with
    @public
   */
  followRedirects(): Promise<unknown> {
    let router = this.router;
    return this.promise!.catch(function(reason) {
      if (router.activeTransition) {
        return router.activeTransition.followRedirects();
      }
      return Promise.reject(reason);
    });
  }

  toString() {
    return 'Transition (sequence ' + this.sequence + ')';
  }

  /**
    @private
   */
  log(message: string) {
    log(this.router, this.sequence, message);
  }
}

/**
  @private

  Logs and returns an instance of TransitionAborted.
 */
export function logAbort(transition: Transition) {
  log(transition.router, transition.sequence, 'detected abort.');
  return new TransitionAborted();
}

export function isTransition(obj: Dict<unknown> | undefined): obj is Transition {
  return typeof obj === 'object' && obj instanceof Transition && obj.isTransition;
}

export function prepareResult(obj: Dict<unknown> | undefined) {
  if (isTransition(obj)) {
    return null;
  }

  return obj;
}
