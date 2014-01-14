import { bind, merge, oCreate, serialize, promiseLabel } from './utils';
import { resolve } from 'rsvp';

function HandlerInfo(props) {
  if (props) {
    merge(this, props);
  }
}

HandlerInfo.prototype = {
  name: null,
  handler: null,
  params: null,
  context: null,

  log: function(payload, message) {
    if (payload.log) {
      payload.log(this.name + ': ' + message);
    }
  },

  promiseLabel: function(label) {
    return promiseLabel("'" + this.name + "' " + label);
  },

  resolve: function(async, shouldContinue, payload) {
    var checkForAbort  = bind(this.checkForAbort,      this, shouldContinue),
        beforeModel    = bind(this.runBeforeModelHook, this, async, payload),
        model          = bind(this.getModel,           this, async, payload),
        afterModel     = bind(this.runAfterModelHook,  this, async, payload),
        becomeResolved = bind(this.becomeResolved,     this, payload);

    return resolve(undefined, this.promiseLabel("Start handler"))
           .then(checkForAbort, null, this.promiseLabel("Check for abort"))
           .then(beforeModel, null, this.promiseLabel("Before model"))
           .then(checkForAbort, null, this.promiseLabel("Check if aborted during 'beforeModel' hook"))
           .then(model, null, this.promiseLabel("Model"))
           .then(checkForAbort, null, this.promiseLabel("Check if aborted in 'model' hook"))
           .then(afterModel, null, this.promiseLabel("After model"))
           .then(checkForAbort, null, this.promiseLabel("Check if aborted in 'afterModel' hook"))
           .then(becomeResolved, null, this.promiseLabel("Become resolved"));
  },

  runBeforeModelHook: function(async, payload) {
    if (payload.trigger) {
      payload.trigger(true, 'willResolveModel', payload, this.handler);
    }
    return this.runSharedModelHook(async, payload, 'beforeModel', []);
  },

  runAfterModelHook: function(async, payload, resolvedModel) {
    // Stash the resolved model on the payload.
    // This makes it possible for users to swap out
    // the resolved model in afterModel.
    var name = this.name;
    this.stashResolvedModel(payload, resolvedModel);

    return this.runSharedModelHook(async, payload, 'afterModel', [resolvedModel])
               .then(function() {
                 // Ignore the fulfilled value returned from afterModel.
                 // Return the value stashed in resolvedModels, which
                 // might have been swapped out in afterModel.
                 return payload.resolvedModels[name];
               }, null, this.promiseLabel("Ignore fulfillment value and return model value"));
  },

  runSharedModelHook: function(async, payload, hookName, args) {
    this.log(payload, "calling " + hookName + " hook");

    if (this.queryParams) {
      args.push(this.queryParams);
    }
    args.push(payload);

    var handler = this.handler;
    return async(function() {
      return handler[hookName] && handler[hookName].apply(handler, args);
    }, this.promiseLabel("Handle " + hookName));
  },

  getModel: function(payload) {
    throw new Error("This should be overridden by a subclass of HandlerInfo");
  },

  checkForAbort: function(shouldContinue, promiseValue) {
    return resolve(shouldContinue(), this.promiseLabel("Check for abort")).then(function() {
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
    var params = this.params || serialize(this.handler, resolvedContext, this.names);

    if (payload) {
      this.stashResolvedModel(payload, resolvedContext);
      payload.params = payload.params || {};
      payload.params[this.name] = params;
    }

    return new ResolvedHandlerInfo({
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

function ResolvedHandlerInfo(props) {
  HandlerInfo.call(this, props);
}

ResolvedHandlerInfo.prototype = oCreate(HandlerInfo.prototype);
ResolvedHandlerInfo.prototype.resolve = function(async, shouldContinue, payload) {
  // A ResolvedHandlerInfo just resolved with itself.
  if (payload && payload.resolvedModels) {
    payload.resolvedModels[this.name] = this.context;
  }
  return resolve(this, this.promiseLabel("Resolve"));
};

// These are generated by URL transitions and
// named transitions for non-dynamic route segments.
function UnresolvedHandlerInfoByParam(props) {
  HandlerInfo.call(this, props);
  this.params = this.params || {};
}

UnresolvedHandlerInfoByParam.prototype = oCreate(HandlerInfo.prototype);
UnresolvedHandlerInfoByParam.prototype.getModel = function(async, payload) {
  var fullParams = this.params;
  if (payload && payload.queryParams) {
    fullParams = {};
    merge(fullParams, this.params);
    fullParams.queryParams = payload.queryParams;
  }

  var hookName = typeof this.handler.deserialize === 'function' ?
                 'deserialize' : 'model';

  return this.runSharedModelHook(async, payload, hookName, [fullParams]);
};


// These are generated only for named transitions
// with dynamic route segments.
function UnresolvedHandlerInfoByObject(props) {
  HandlerInfo.call(this, props);
}

UnresolvedHandlerInfoByObject.prototype = oCreate(HandlerInfo.prototype);
UnresolvedHandlerInfoByObject.prototype.getModel = function(async, payload) {
  this.log(payload, this.name + ": resolving provided model");
  return resolve(this.context);
};

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

export { HandlerInfo, ResolvedHandlerInfo, UnresolvedHandlerInfoByParam, UnresolvedHandlerInfoByObject };
