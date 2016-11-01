import { bind, merge, promiseLabel, applyHook, isPromise } from './utils';
import { Promise } from 'rsvp';

var DEFAULT_HANDLER = Object.freeze({});

function HandlerInfo(_props) {
  var props = _props || {};

  // Set a default handler to ensure consistent object shape
  this._handler = DEFAULT_HANDLER;

  if (props.handler) {
    var name = props.name;

    // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
    this.handlerPromise = Promise.resolve(props.handler);

    // Wait until the 'handler' property has been updated when chaining to a handler
    // that is a promise
    if (isPromise(props.handler)) {
      this.handlerPromise = this.handlerPromise.then(bind(this, this.updateHandler));
      props.handler = undefined;
    } else if (props.handler) {
      // Store the name of the handler on the handler for easy checks later
      props.handler._handlerName = name;
    }
  }

  merge(this, props);
  this.initialize(props);
}

HandlerInfo.prototype = {
  name: null,

  getHandler: function() {},

  fetchHandler: function() {
    var handler = this.getHandler(this.name);

    // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
    this.handlerPromise = Promise.resolve(handler);

    // Wait until the 'handler' property has been updated when chaining to a handler
    // that is a promise
    if (isPromise(handler)) {
      this.handlerPromise = this.handlerPromise.then(bind(this, this.updateHandler));
    } else if (handler) {
      // Store the name of the handler on the handler for easy checks later
      handler._handlerName = this.name;
      return this.handler = handler;
    }

    return this.handler = undefined;
  },

  _handlerPromise: undefined,

  params: null,
  context: null,

  // Injected by the handler info factory.
  factory: null,

  initialize: function() {},

  log: function(payload, message) {
    if (payload.log) {
      payload.log(this.name + ': ' + message);
    }
  },

  promiseLabel: function(label) {
    return promiseLabel("'" + this.name + "' " + label);
  },

  getUnresolved: function() {
    return this;
  },

  serialize: function() {
    return this.params || {};
  },

  updateHandler: function(handler) {
    // Store the name of the handler on the handler for easy checks later
    handler._handlerName = this.name;
    return this.handler = handler;
  },

  resolve: function(shouldContinue, payload) {
    var checkForAbort  = bind(this, this.checkForAbort,      shouldContinue),
        beforeModel    = bind(this, this.runBeforeModelHook, payload),
        model          = bind(this, this.getModel,           payload),
        afterModel     = bind(this, this.runAfterModelHook,  payload),
        becomeResolved = bind(this, this.becomeResolved,     payload),
        self = this;

    return Promise.resolve(this.handlerPromise, this.promiseLabel("Start handler"))
            .then(function(handler) {
              // We nest this chain in case the handlerPromise has an error so that
              // we don't have to bubble it through every step
              return Promise.resolve(handler)
                .then(checkForAbort, null, self.promiseLabel("Check for abort"))
                .then(beforeModel, null, self.promiseLabel("Before model"))
                .then(checkForAbort, null, self.promiseLabel("Check if aborted during 'beforeModel' hook"))
                .then(model, null, self.promiseLabel("Model"))
                .then(checkForAbort, null, self.promiseLabel("Check if aborted in 'model' hook"))
                .then(afterModel, null, self.promiseLabel("After model"))
                .then(checkForAbort, null, self.promiseLabel("Check if aborted in 'afterModel' hook"))
                .then(becomeResolved, null, self.promiseLabel("Become resolved"));
            }, function(error) {
              throw error;
            });
  },

  runBeforeModelHook: function(payload) {
    if (payload.trigger) {
      payload.trigger(true, 'willResolveModel', payload, this.handler);
    }
    return this.runSharedModelHook(payload, 'beforeModel', []);
  },

  runAfterModelHook: function(payload, resolvedModel) {
    // Stash the resolved model on the payload.
    // This makes it possible for users to swap out
    // the resolved model in afterModel.
    var name = this.name;
    this.stashResolvedModel(payload, resolvedModel);

    return this.runSharedModelHook(payload, 'afterModel', [resolvedModel])
               .then(function() {
                 // Ignore the fulfilled value returned from afterModel.
                 // Return the value stashed in resolvedModels, which
                 // might have been swapped out in afterModel.
                 return payload.resolvedModels[name];
               }, null, this.promiseLabel("Ignore fulfillment value and return model value"));
  },

  runSharedModelHook: function(payload, hookName, args) {
    this.log(payload, "calling " + hookName + " hook");

    if (this.queryParams) {
      args.push(this.queryParams);
    }
    args.push(payload);

    var result = applyHook(this.handler, hookName, args);

    if (result && result.isTransition) {
      result = null;
    }

    return Promise.resolve(result, this.promiseLabel("Resolve value returned from one of the model hooks"));
  },

  // overridden by subclasses
  getModel: null,

  checkForAbort: function(shouldContinue, promiseValue) {
    return Promise.resolve(shouldContinue(), this.promiseLabel("Check for abort")).then(function() {
      // We don't care about shouldContinue's resolve value;
      // pass along the original value passed to this fn.
      return promiseValue;
    }, null, this.promiseLabel("Ignore fulfillment value and continue"));
  },

  stashResolvedModel: function(payload, resolvedModel) {
    payload.resolvedModels = payload.resolvedModels || {};
    payload.resolvedModels[this.name] = resolvedModel;
  },

  becomeResolved: function(payload, resolvedContext) {
    var params = this.serialize(resolvedContext);

    if (payload) {
      this.stashResolvedModel(payload, resolvedContext);
      payload.params = payload.params || {};
      payload.params[this.name] = params;
    }

    return this.factory('resolved', {
      context: resolvedContext,
      name: this.name,
      handler: this.handler,
      params: params
    });
  },

  shouldSupercede: function(other) {
    // Prefer this newer handlerInfo over `other` if:
    // 1) The other one doesn't exist
    // 2) The names don't match
    // 3) This handler has a context that doesn't match
    //    the other one (or the other one doesn't have one).
    // 4) This handler has parameters that don't match the other.
    if (!other) { return true; }

    var contextsMatch = (other.context === this.context);
    return other.name !== this.name ||
           (this.hasOwnProperty('context') && !contextsMatch) ||
           (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params));
  }
};

Object.defineProperty(HandlerInfo.prototype, 'handler', {
  get: function() {
    // _handler could be set to either a handler object or undefined, so we
    // compare against a default reference to know when it's been set
    if (this._handler !== DEFAULT_HANDLER) {
      return this._handler;
    }

    return this.fetchHandler();
  },

  set: function(handler) {
    return this._handler = handler;
  }
});

Object.defineProperty(HandlerInfo.prototype, 'handlerPromise', {
  get: function() {
    if (this._handlerPromise) {
      return this._handlerPromise;
    }

    this.fetchHandler();

    return this._handlerPromise;
  },

  set: function(handlerPromise) {
    return this._handlerPromise = handlerPromise;
  }
});

function paramsMatch(a, b) {
  if ((!a) ^ (!b)) {
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

export default HandlerInfo;
