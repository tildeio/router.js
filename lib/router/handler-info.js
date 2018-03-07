import { promiseLabel, applyHook, isPromise } from './utils';
import { Promise } from 'rsvp';

const DEFAULT_HANDLER = Object.freeze({});

export default class HandlerInfo {
  constructor(props = {}) {
    // initialize local properties to ensure consistent object shape
    this._handler = DEFAULT_HANDLER;
    this._handlerPromise = null;
    this.factory = null; // Injected by the handler info factory
    this.name = props.name;

    for (let prop in props) {
      if (prop === 'handler') {
        this._processHandler(props.handler);
      } else {
        this[prop] = props[prop];
      }
    }
  }

  getHandler() {}

  fetchHandler() {
    let handler = this.getHandler(this.name);
    return this._processHandler(handler);
  }

  _processHandler(handler) {
    // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
    this.handlerPromise = Promise.resolve(handler);

    // Wait until the 'handler' property has been updated when chaining to a handler
    // that is a promise
    if (isPromise(handler)) {
      this.handlerPromise = this.handlerPromise.then(h => {
        return this.updateHandler(h);
      });
      // set to undefined to avoid recursive loop in the handler getter
      return (this.handler = undefined);
    } else if (handler) {
      return this.updateHandler(handler);
    }
  }

  log(payload, message) {
    if (payload.log) {
      payload.log(this.name + ': ' + message);
    }
  }

  promiseLabel(label) {
    return promiseLabel("'" + this.name + "' " + label);
  }

  getUnresolved() {
    return this;
  }

  serialize() {
    return this.params || {};
  }

  updateHandler(handler) {
    // Store the name of the handler on the handler for easy checks later
    handler._handlerName = this.name;
    return (this.handler = handler);
  }

  resolve(shouldContinue, payload) {
    let checkForAbort = this.checkForAbort.bind(this, shouldContinue);
    let beforeModel = this.runBeforeModelHook.bind(this, payload);
    let model = this.getModel.bind(this, payload);
    let afterModel = this.runAfterModelHook.bind(this, payload);
    let becomeResolved = this.becomeResolved.bind(this, payload);

    return Promise.resolve(
      this.handlerPromise,
      this.promiseLabel('Start handler')
    )
      .then(checkForAbort, null, this.promiseLabel('Check for abort'))
      .then(beforeModel, null, this.promiseLabel('Before model'))
      .then(
        checkForAbort,
        null,
        this.promiseLabel("Check if aborted during 'beforeModel' hook")
      )
      .then(model, null, this.promiseLabel('Model'))
      .then(
        checkForAbort,
        null,
        this.promiseLabel("Check if aborted in 'model' hook")
      )
      .then(afterModel, null, this.promiseLabel('After model'))
      .then(
        checkForAbort,
        null,
        this.promiseLabel("Check if aborted in 'afterModel' hook")
      )
      .then(becomeResolved, null, this.promiseLabel('Become resolved'));
  }

  runBeforeModelHook(payload) {
    if (payload.trigger) {
      payload.trigger(true, 'willResolveModel', payload, this.handler);
    }
    return this.runSharedModelHook(payload, 'beforeModel', []);
  }

  runAfterModelHook(payload, resolvedModel) {
    // Stash the resolved model on the payload.
    // This makes it possible for users to swap out
    // the resolved model in afterModel.
    let name = this.name;
    this.stashResolvedModel(payload, resolvedModel);

    return this.runSharedModelHook(payload, 'afterModel', [resolvedModel]).then(
      function() {
        // Ignore the fulfilled value returned from afterModel.
        // Return the value stashed in resolvedModels, which
        // might have been swapped out in afterModel.
        return payload.resolvedModels[name];
      },
      null,
      this.promiseLabel('Ignore fulfillment value and return model value')
    );
  }

  runSharedModelHook(payload, hookName, args) {
    this.log(payload, 'calling ' + hookName + ' hook');

    if (this.queryParams) {
      args.push(this.queryParams);
    }
    args.push(payload);

    var result = applyHook(this.handler, hookName, args);

    if (result && result.isTransition) {
      result = null;
    }

    return Promise.resolve(
      result,
      this.promiseLabel('Resolve value returned from one of the model hooks')
    );
  }

  // overridden by subclasses
  getModel() {}

  checkForAbort(shouldContinue, promiseValue) {
    return Promise.resolve(
      shouldContinue(),
      this.promiseLabel('Check for abort')
    ).then(
      function() {
        // We don't care about shouldContinue's resolve value;
        // pass along the original value passed to this fn.
        return promiseValue;
      },
      null,
      this.promiseLabel('Ignore fulfillment value and continue')
    );
  }

  stashResolvedModel(payload, resolvedModel) {
    payload.resolvedModels = payload.resolvedModels || {};
    payload.resolvedModels[this.name] = resolvedModel;
  }

  becomeResolved(payload, resolvedContext) {
    var params = this.serialize(resolvedContext);

    if (payload) {
      this.stashResolvedModel(payload, resolvedContext);
      payload.params = payload.params || {};
      payload.params[this.name] = params;
    }

    var resolution = {
      name: this.name,
      handler: this.handler,
      params: params,
    };

    // Don't set a context on the resolution unless we actually have one.
    var contextsMatch = resolvedContext === this.context;
    if (this.hasOwnProperty('context') || !contextsMatch) {
      resolution.context = resolvedContext;
    }

    return this.factory('resolved', resolution);
  }

  shouldSupercede(other) {
    // Prefer this newer handlerInfo over `other` if:
    // 1) The other one doesn't exist
    // 2) The names don't match
    // 3) This handler has a context that doesn't match
    //    the other one (or the other one doesn't have one).
    // 4) This handler has parameters that don't match the other.
    if (!other) {
      return true;
    }

    var contextsMatch = other.context === this.context;
    return (
      other.name !== this.name ||
      (this.hasOwnProperty('context') && !contextsMatch) ||
      (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params))
    );
  }

  get handler() {
    // _handler could be set to either a handler object or undefined, so we
    // compare against a default reference to know when it's been set
    if (this._handler !== DEFAULT_HANDLER) {
      return this._handler;
    }

    return this.fetchHandler();
  }

  set handler(handler) {
    return (this._handler = handler);
  }

  get handlerPromise() {
    if (this._handlerPromise !== null) {
      return this._handlerPromise;
    }

    this.fetchHandler();

    return this._handlerPromise;
  }

  set handlerPromise(handlerPromise) {
    this._handlerPromise = handlerPromise;

    return handlerPromise;
  }
}

function paramsMatch(a, b) {
  if (!a ^ !b) {
    // Only one is null.
    return false;
  }

  if (!a) {
    // Both must be null.
    return true;
  }

  // Note: this assumes that both params have the same
  // number of keys, but since we're comparing the
  // same handlers, they should.
  for (var k in a) {
    if (a.hasOwnProperty(k) && a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
