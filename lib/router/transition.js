import Promise from 'rsvp/promise';
import { ResolvedHandlerInfo } from './handler-info';
import { trigger, slice, log, promiseLabel } from './utils';

/**
  @private

  A Transition is a thennable (a promise-like object) that represents
  an attempt to transition to another route. It can be aborted, either
  explicitly via `abort` or by attempting another transition while a
  previous one is still underway. An aborted transition can also
  be `retry()`d later.

  @constructor
  @param {Router} router
  @param {TransitionIntent} [intent]
  @param {TransitionState} [state]
  @param {Error} [error] Rejects the transition with this error through the promise.
 */
function Transition(router, intent, state, error) {
  var transition = this;
  this.state = state || router.state;
  this.intent = intent;
  this.router = router;
  this.data = this.intent && this.intent.data || {};
  this.resolvedModels = {};
  this.queryParams = {};

  if (error) {
    this.promise = Promise.reject(error);
    return;
  }

  if (state) {
    this.params = state.params;
    this.queryParams = state.queryParams;
    this.handlerInfos = state.handlerInfos;

    var len = state.handlerInfos.length;
    if (len) {
      this.targetName = state.handlerInfos[len-1].name;
    }

    for (var i = 0; i < len; ++i) {
      var handlerInfo = state.handlerInfos[i];

      // TODO: this all seems hacky
      if (!handlerInfo.isResolved) { break; }
      this.pivotHandler = handlerInfo.handler;
    }

    this.sequence = Transition.currentSequence++;
    this.promise = state.resolve(checkForAbort, this)['catch'](function(result) {
      if (result.wasAborted || transition.isAborted) {
        return Promise.reject(logAbort(transition));
      } else {
        transition.trigger('error', result.error, transition, result.handlerWithError);
        transition.abort();
        return Promise.reject(result.error);
      }
    }, promiseLabel('Handle Abort'));
  } else {
    this.promise = Promise.resolve(this.state);
    this.params = {};
  }

  function checkForAbort() {
    if (transition.isAborted) {
      return Promise.reject(undefined, promiseLabel("Transition aborted - reject"));
    }
  }
}

/**
 * Latest ID of a sequential unique sequence ID
 *
 * @type {Number}
 */
Transition.currentSequence = 0;

/**
 * @property {Router} router Router
 *           Current Router
 *
 * @property {TransitionIntent} intent
 *           Current intent of transition
 *
 * @property {TransitionState} state
 *           New state for the transition that will be assigned to the router
 *
 * @property {String} urlMethod="update"
 *           Method of url-update. "replace" will replace the url in the
 *           history stack, falsy value does nothing, and any truthy will add a
 *           new entry in the stack.
 *
 * @property {Promise} promise
 *           Promise for transition
 *
 * @property {Number} sequence
 *           Unique transition sequence id
 *
 * @property {String} targetName
 *           Name of the leaf of handlers in this transition
 *
 * @property {HandlerInfo[]} handlerInfos
 *           List of handler-info's within this transition including already
 *           resolve handle-info's
 *
 * @property {Object} params
 *           Dictionary of dictionaries of all parameters keyed by the name of
 *           the handler-info's
 *
 * @property {Object} queryParams
 *           Dictionary of all query parameters
 *
 * @property {Object} pivotHandler
 *           Handler object of the first handler to consider.
 *
 * @property {Number} resolveIndex=0
 *           Index of currently resolving handler-info
 *
 * @property {Object} resolvedModels
 *           Dictionary of the resolved models keyed by the handler-info name
 *
 * @property {Boolean} isActive=true
 *           Is transition active? Is deactivated during abort() and when
 *           transitioned
 *
 * @property {Boolean} isAborted=false
 *           Has abort() been called on the transaction? abort() sets this
 *           value and it is used to fail the promise-chain.
 *
 * @property {Boolean} isTransition=true
 *           Identifies a transition
 *
 * @property {*} data
 *           Data made available to all HandlerInfo's within the current
 *           transition, referencing the data property from the transition-intent
 *
 * @property {Object} _visibleQueryParams
 *           Dictionary of visible parameters for the URL;
 *           see handler.finalizeQueryParamChange
 */
Transition.prototype = {
  targetName: null,
  urlMethod: 'update',
  intent: null,
  params: null,
  pivotHandler: null,
  resolveIndex: 0,
  handlerInfos: null,
  resolvedModels: null,
  isActive: true,
  state: null,
  queryParamsOnly: false,

  isTransition: true,

  isExiting: function(handler) {
    var handlerInfos = this.handlerInfos;
    for (var i = 0, len = handlerInfos.length; i < len; ++i) {
      var handlerInfo = handlerInfos[i];
      if (handlerInfo.name === handler || handlerInfo.handler === handler) {
        return false;
      }
    }
    return true;
  },

  /**
    @public

    The Transition's internal promise. Calling `.then` on this property
    is that same as calling `.then` on the Transition object itself, but
    this property is exposed for when you want to pass around a
    Transition's promise, but not the Transition object itself, since
    Transition object can be externally `abort`ed, while the promise
    cannot.
   */
  promise: null,

  /**
    @public

    Custom state can be stored on a Transition's `data` object.
    This can be useful for decorating a Transition within an earlier
    hook and shared with a later hook. Properties set on `data` will
    be copied to new transitions generated by calling `retry` on this
    transition.
   */
  data: null,

  /**
    @public

    A standard promise hook that resolves if the transition
    succeeds and rejects if it fails/redirects/aborts.

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @param {Function} onFulfilled
    @param {Function} onRejected
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
   */
  then: function(onFulfilled, onRejected, label) {
    return this.promise.then(onFulfilled, onRejected, label);
  },

  /**
    @public

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @method catch
    @param {Function} onRejection
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
   */
  catch: function(onRejection, label) {
    return this.promise.catch(onRejection, label);
  },

  /**
    @public

    Forwards to the internal `promise` property which you can
    use in situations where you want to pass around a thennable,
    but not the Transition itself.

    @method finally
    @param {Function} callback
    @param {String} label optional string for labeling the promise.
    Useful for tooling.
    @return {Promise}
   */
  finally: function(callback, label) {
    return this.promise.finally(callback, label);
  },

  /**
    @public

    Aborts the Transition. Note you can also implicitly abort a transition
    by initiating another transition while a previous one is underway.
   */
  abort: function() {
    if (this.isAborted) { return this; }
    log(this.router, this.sequence, this.targetName + ": transition was aborted");
    this.intent.preTransitionState = this.router.state;
    this.isAborted = true;
    this.isActive = false;
    this.router.activeTransition = null;
    return this;
  },

  /**
    @public

    Retries a previously-aborted transition (making sure to abort the
    transition if it's still active). Returns a new transition that
    represents the new attempt to transition.
   */
  retry: function() {
    // TODO: add tests for merged state retry()s
    this.abort();
    return this.router.transitionByIntent(this.intent, false);
  },

  /**
    @public

    Sets the URL-changing method to be employed at the end of a
    successful transition. By default, a new Transition will just
    use `updateURL`, but passing 'replace' to this method will
    cause the URL to update using 'replaceWith' instead. Omitting
    a parameter will disable the URL change, allowing for transitions
    that don't update the URL at completion (this is also used for
    handleURL, since the URL has already changed before the
    transition took place).

    @param {String} method the type of URL-changing method to use
      at the end of a transition. Accepted values are 'replace',
      falsy values, or any other non-falsy value (which is
      interpreted as an updateURL transition).

    @return {Transition} this transition
   */
  method: function(method) {
    this.urlMethod = method;
    return this;
  },

  /**
    @public

    Fires an event on the current list of resolved/resolving
    handlers within this transition. Useful for firing events
    on route hierarchies that haven't fully been entered yet.

    Note: This method is also aliased as `send`

    @param {Boolean} [ignoreFailure=false] a boolean specifying whether
                                           unhandled events throw an error
    @param {String} name the name of the event to fire
   */
  trigger: function (ignoreFailure) {
    var args = slice.call(arguments);
    if (typeof ignoreFailure === 'boolean') {
      args.shift();
    } else {
      // Throw errors on unhandled trigger events by default
      ignoreFailure = false;
    }
    trigger(this.router, this.state.handlerInfos.slice(0, this.resolveIndex + 1), ignoreFailure, args);
  },

  /**
    @public

    Transitions are aborted and their promises rejected
    when redirects occur; this method returns a promise
    that will follow any redirects that occur and fulfill
    with the value fulfilled by any redirecting transitions
    that occur.

    @return {Promise} a promise that fulfills with the same
      value that the final redirecting transition fulfills with
   */
  followRedirects: function() {
    var router = this.router;
    return this.promise['catch'](function(reason) {
      if (router.activeTransition) {
        return router.activeTransition.followRedirects();
      }
      return Promise.reject(reason);
    });
  },

  toString: function() {
    return "Transition (sequence " + this.sequence + ")";
  },

  /**
    @private
   */
  log: function(message) {
    log(this.router, this.sequence, message);
  }
};

// Alias 'trigger' as 'send'
Transition.prototype.send = Transition.prototype.trigger;

/**
  @private

  Logs and returns a TransitionAborted error.
 */
function logAbort(transition) {
  log(transition.router, transition.sequence, "detected abort.");
  return new TransitionAborted();
}

/**
 * Transition abort
 *
 * @constructor
 * @param {String} [message]
 */
function TransitionAborted(message) {
  this.message = (message || "TransitionAborted");
  this.name = "TransitionAborted";
}

export { Transition, logAbort, TransitionAborted };
