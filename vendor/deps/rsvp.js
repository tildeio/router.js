define("rsvp/all",
  ["rsvp/promise","rsvp/utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;
    var isArray = __dependency2__.isArray;
    var isFunction = __dependency2__.isFunction;
    /* global toString */


    function all(promises, label) {
      if (!isArray(promises)) {
        throw new TypeError('You must pass an array to all.');
      }

      return new Promise(function(resolve, reject) {
        var results = [], remaining = promises.length,
        promise;

        if (remaining === 0) {
          resolve([]);
        }

        function resolver(index) {
          return function(value) {
            resolveAll(index, value);
          };
        }

        function resolveAll(index, value) {
          results[index] = value;
          if (--remaining === 0) {
            resolve(results);
          }
        }

        for (var i = 0; i < promises.length; i++) {
          promise = promises[i];

          if (promise && isFunction(promise.then)) {
            promise.then(resolver(i), reject, "RSVP: RSVP#all");
          } else {
            resolveAll(i, promise);
          }
        }
      }, label);
    }


    __exports__.all = all;
  });
define("rsvp/asap",
  ["exports"],
  function(__exports__) {
    "use strict";
    var browserGlobal = (typeof window !== 'undefined') ? window : {};
    var BrowserMutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
    var local = (typeof global !== 'undefined') ? global : this;

    // node
    function useNextTick() {
      return function() {
        process.nextTick(flush);
      };
    }

    function useMutationObserver() {
      var observer = new BrowserMutationObserver(flush);
      var element = document.createElement('div');
      observer.observe(element, { attributes: true });

      // Chrome Memory Leak: https://bugs.webkit.org/show_bug.cgi?id=93661
      window.addEventListener('unload', function(){
        observer.disconnect();
        observer = null;
      }, false);

      return function() {
        element.setAttribute('drainQueue', 'drainQueue');
      };
    }

    function useSetTimeout() {
      return function() {
        local.setTimeout(flush, 1);
      };
    }

    var queue = [];
    function flush() {
      for (var i = 0; i < queue.length; i++) {
        var tuple = queue[i];
        var callback = tuple[0], arg = tuple[1];
        callback(arg);
      }
      queue = [];
    }

    var scheduleFlush;

    // Decide what async method to use to triggering processing of queued callbacks:
    if (typeof process !== 'undefined' && {}.toString.call(process) === '[object process]') {
      scheduleFlush = useNextTick();
    } else if (BrowserMutationObserver) {
      scheduleFlush = useMutationObserver();
    } else {
      scheduleFlush = useSetTimeout();
    }

    function asap(callback, arg) {
      var length = queue.push([callback, arg]);
      if (length === 1) {
        // If length is 1, that means that we need to schedule an async flush.
        // If additional callbacks are queued before the queue is flushed, they
        // will be processed by this flush that we are scheduling.
        scheduleFlush();
      }
    }


    __exports__.asap = asap;
  });
define("rsvp/cast",
  ["exports"],
  function(__exports__) {
    "use strict";
    function cast(object) {
      /*jshint validthis:true */
      if (object && typeof object === 'object' && object.constructor === this) {
        return object;
      }

      var Promise = this;

      return new Promise(function(resolve) {
        resolve(object);
      });
    }


    __exports__.cast = cast;
  });
define("rsvp/config",
  ["rsvp/events","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var EventTarget = __dependency1__.EventTarget;

    var config = {
      instrument: false
    };

    EventTarget.mixin(config);

    function configure(name, value) {
      if (name === 'onerror') {
        // handle for legacy users that expect the actual
        // error to be passed to their function added via
        // `RSVP.configure('onerror', someFunctionHere);`
        config.on('error', value);
        return;
      }

      if (arguments.length === 2) {
        config[name] = value;
      } else {
        return config[name];
      }
    }


    __exports__.config = config;
    __exports__.configure = configure;
  });
define("rsvp/defer",
  ["rsvp/promise","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;

    function defer(label) {
      var deferred = {
        // pre-allocate shape
        resolve: undefined,
        reject:  undefined,
        promise: undefined
      };

      deferred.promise = new Promise(function(resolve, reject) {
        deferred.resolve = resolve;
        deferred.reject = reject;
      }, label);

      return deferred;
    }


    __exports__.defer = defer;
  });
define("rsvp/events",
  ["exports"],
  function(__exports__) {
    "use strict";
    var indexOf = function(callbacks, callback) {
      for (var i=0, l=callbacks.length; i<l; i++) {
        if (callbacks[i][0] === callback) { return i; }
      }

      return -1;
    };

    var callbacksFor = function(object) {
      var callbacks = object._promiseCallbacks;

      if (!callbacks) {
        callbacks = object._promiseCallbacks = {};
      }

      return callbacks;
    };

    var EventTarget = {
      mixin: function(object) {
        object.on = this.on;
        object.off = this.off;
        object.trigger = this.trigger;
        object._promiseCallbacks = undefined;
        return object;
      },

      on: function(eventName, callback) {
        var allCallbacks = callbacksFor(this), callbacks;

        callbacks = allCallbacks[eventName];

        if (!callbacks) {
          callbacks = allCallbacks[eventName] = [];
        }

        if (indexOf(callbacks, callback) === -1) {
          callbacks.push(callback);
        }
      },

      off: function(eventName, callback) {
        var allCallbacks = callbacksFor(this), callbacks, index;

        if (!callback) {
          allCallbacks[eventName] = [];
          return;
        }

        callbacks = allCallbacks[eventName];

        index = indexOf(callbacks, callback);

        if (index !== -1) { callbacks.splice(index, 1); }
      },

      trigger: function(eventName, options) {
        var allCallbacks = callbacksFor(this),
            callbacks, callbackTuple, callback, binding;

        if (callbacks = allCallbacks[eventName]) {
          // Don't cache the callbacks.length since it may grow
          for (var i=0; i<callbacks.length; i++) {
            callback = callbacks[i];

            callback(options);
          }
        }
      }
    };


    __exports__.EventTarget = EventTarget;
  });
define("rsvp/hash",
  ["rsvp/promise","rsvp/utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;
    var isFunction = __dependency2__.isFunction;

    var keysOf = Object.keys || function(object) {
      var result = [];

      for (var prop in object) {
        result.push(prop);
      }

      return result;
    };

    function hash(object, label) {
      var results = {},
          keys = keysOf(object),
          remaining = keys.length;

      return new Promise(function(resolve, reject){
        var promise, prop;

        if (remaining === 0) {
          resolve({});
          return;
        }

        var resolver = function(prop) {
          return function(value) {
            resolveAll(prop, value);
          };
        };

        var resolveAll = function(prop, value) {
          results[prop] = value;
          if (--remaining === 0) {
            resolve(results);
          }
        };


        for (var i = 0, l = keys.length; i < l; i ++) {
          prop = keys[i];
          promise = object[prop];

          if (promise && isFunction(promise.then)) {
            promise.then(resolver(prop), reject, "RSVP: RSVP#hash");
          } else {
            resolveAll(prop, promise);
          }
        }
      });
    }


    __exports__.hash = hash;
  });
define("rsvp/instrument",
  ["rsvp/config","rsvp/utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var config = __dependency1__.config;
    var now = __dependency2__.now;

    function instrument(eventName, promise, child) {
      // instrumentation should not disrupt normal usage.
      try {
        config.trigger(eventName, {
          guid: promise._guidKey + promise._id,
          eventName: eventName,
          detail: promise._detail,
          childGuid: child && promise._guidKey + child._id,
          label: promise._label,
          timeStamp: now()
        });
      } catch(error) {
        setTimeout(function(){
          throw error;
        }, 0);
      }
    }


    __exports__.instrument = instrument;
  });
define("rsvp/node",
  ["rsvp/promise","rsvp/all","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;
    var all = __dependency2__.all;

    var slice = Array.prototype.slice;

    function makeNodeCallbackFor(resolve, reject) {
      return function (error, value) {
        if (error) {
          reject(error);
        } else if (arguments.length > 2) {
          resolve(slice.call(arguments, 1));
        } else {
          resolve(value);
        }
      };
    }

    function denodeify(nodeFunc, binding) {
      return function()  {
        var nodeArgs = slice.call(arguments), resolve, reject;
        var thisArg = this || binding;

        return new Promise(function(resolve, reject) {
          all(nodeArgs).then(function(nodeArgs) {
            try {
              nodeArgs.push(makeNodeCallbackFor(resolve, reject));
              nodeFunc.apply(thisArg, nodeArgs);
            } catch(e) {
              reject(e);
            }
          });
        });
      };
    }


    __exports__.denodeify = denodeify;
  });
define("rsvp/promise",
  ["rsvp/config","rsvp/events","rsvp/cast","rsvp/instrument","rsvp/utils","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __exports__) {
    "use strict";
    var config = __dependency1__.config;
    var EventTarget = __dependency2__.EventTarget;
    var cast = __dependency3__.cast;
    var instrument = __dependency4__.instrument;
    var objectOrFunction = __dependency5__.objectOrFunction;
    var isFunction = __dependency5__.isFunction;
    var now = __dependency5__.now;

    var guidKey = 'rsvp_' + now() + '-';
    var counter = 0;

    function Promise(resolver, label) {
      if (!isFunction(resolver)) {
        throw new TypeError('You must pass a resolver function as the first argument to the promise constructor');
      }

      if (!(this instanceof Promise)) {
        throw new TypeError("Failed to construct 'Promise': Please use the 'new' operator, this object constructor cannot be called as a function.");
      }

      this._id = counter++;
      this._label = label;
      this._subscribers = [];

      if (config.instrument) {
        instrument('created', this);
      }

      invokeResolver(resolver, this);
    }

    function invokeResolver(resolver, promise) {
      function resolvePromise(value) {
        resolve(promise, value);
      }

      function rejectPromise(reason) {
        reject(promise, reason);
      }

      try {
        resolver(resolvePromise, rejectPromise);
      } catch(e) {
        rejectPromise(e);
      }
    }

    function invokeCallback(settled, promise, callback, detail) {
      var hasCallback = isFunction(callback),
          value, error, succeeded, failed;

      if (hasCallback) {
        try {
          value = callback(detail);
          succeeded = true;
        } catch(e) {
          failed = true;
          error = e;
        }
      } else {
        value = detail;
        succeeded = true;
      }

      if (handleThenable(promise, value)) {
        return;
      } else if (hasCallback && succeeded) {
        resolve(promise, value);
      } else if (failed) {
        reject(promise, error);
      } else if (settled === FULFILLED) {
        resolve(promise, value);
      } else if (settled === REJECTED) {
        reject(promise, value);
      }
    }

    var PENDING   = void 0;
    var SEALED    = 0;
    var FULFILLED = 1;
    var REJECTED  = 2;

    function subscribe(parent, child, onFulfillment, onRejection) {
      var subscribers = parent._subscribers;
      var length = subscribers.length;

      subscribers[length] = child;
      subscribers[length + FULFILLED] = onFulfillment;
      subscribers[length + REJECTED]  = onRejection;
    }

    function publish(promise, settled) {
      var child, callback, subscribers = promise._subscribers, detail = promise._detail;

      if (config.instrument) {
        instrument(settled === FULFILLED ? 'fulfilled' : 'rejected', promise);
      }

      for (var i = 0; i < subscribers.length; i += 3) {
        child = subscribers[i];
        callback = subscribers[i + settled];

        invokeCallback(settled, child, callback, detail);
      }

      promise._subscribers = null;
    }

    Promise.prototype = {
      constructor: Promise,

      _id: undefined,
      _guidKey: guidKey,
      _label: undefined,

      _state: undefined,
      _detail: undefined,
      _subscribers: undefined,

      _onerror: function (reason) {
        config.trigger('error', reason);
      },

      then: function(done, fail, label) {
        var promise = this;
        this._onerror = null;

        var thenPromise = new this.constructor(function() {}, label);

        if (this._state) {
          var callbacks = arguments;
          config.async(function() {
            invokeCallback(promise._state, thenPromise, callbacks[promise._state - 1], promise._detail);
          });
        } else {
          subscribe(this, thenPromise, done, fail);
        }

        if (config.instrument) {
          instrument('chained', promise, thenPromise);
        }

        return thenPromise;
      },

      fail: function(onRejection, label) {
        return this.then(null, onRejection, label);
      },

      'finally': function(callback) {
        var constructor = this.constructor;

        return this.then(function(value) {
          return constructor.cast(callback()).then(function(){
            return value;
          });
        }, function(reason) {
          return constructor.cast(callback()).then(function(){
            throw reason;
          });
        });
      }
    };

    Promise.prototype['catch'] = Promise.prototype.fail;
    Promise.cast = cast;


    function handleThenable(promise, value) {
      var then = null,
      resolved;

      try {
        if (promise === value) {
          throw new TypeError("A promises callback cannot return that same promise.");
        }

        if (objectOrFunction(value)) {
          then = value.then;

          if (isFunction(then)) {
            then.call(value, function(val) {
              if (resolved) { return true; }
              resolved = true;

              if (value !== val) {
                resolve(promise, val);
              } else {
                fulfill(promise, val);
              }
            }, function(val) {
              if (resolved) { return true; }
              resolved = true;

              reject(promise, val);
            }, 'Locked onto ' + (promise._label || ' unknown promise'));

            return true;
          }
        }
      } catch (error) {
        if (resolved) { return true; }
        reject(promise, error);
        return true;
      }

      return false;
    }

    function resolve(promise, value) {
      if (promise === value) {
        fulfill(promise, value);
      } else if (!handleThenable(promise, value)) {
        fulfill(promise, value);
      }
    }

    function fulfill(promise, value) {
      if (promise._state !== PENDING) { return; }
      promise._state = SEALED;
      promise._detail = value;

      config.async(publishFulfillment, promise);
    }

    function reject(promise, reason) {
      if (promise._state !== PENDING) { return; }
      promise._state = SEALED;
      promise._detail = reason;

      config.async(publishRejection, promise);
    }

    function publishFulfillment(promise) {
      publish(promise, promise._state = FULFILLED);
    }

    function publishRejection(promise) {
      if (promise._onerror) {
        promise._onerror(promise._detail);
      }

      publish(promise, promise._state = REJECTED);
    }


    __exports__.Promise = Promise;
  });
define("rsvp/race",
  ["rsvp/promise","rsvp/utils","exports"],
  function(__dependency1__, __dependency2__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;
    var isArray = __dependency2__.isArray;
    /* global toString */


    function race(promises, label) {
      if (!isArray(promises)) {
        throw new TypeError('You must pass an array to race.');
      }
      return new Promise(function(resolve, reject) {
        var results = [], promise;

        for (var i = 0; i < promises.length; i++) {
          promise = promises[i];

          if (promise && typeof promise.then === 'function') {
            promise.then(resolve, reject, "RSVP: RSVP#race");
          } else {
            resolve(promise);
          }
        }
      }, label);
    }


    __exports__.race = race;
  });
define("rsvp/reject",
  ["rsvp/promise","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;

    function reject(reason, label) {
      return new Promise(function (resolve, reject) {
        reject(reason);
      }, label);
    }


    __exports__.reject = reject;
  });
define("rsvp/resolve",
  ["rsvp/promise","exports"],
  function(__dependency1__, __exports__) {
    "use strict";
    var Promise = __dependency1__.Promise;

    function resolve(thenable, label) {
      return new Promise(function(resolve, reject) {
        resolve(thenable);
      }, label);
    }


    __exports__.resolve = resolve;
  });
define("rsvp/rethrow",
  ["exports"],
  function(__exports__) {
    "use strict";
    var local = (typeof global === "undefined") ? this : global;

    function rethrow(reason) {
      local.setTimeout(function() {
        throw reason;
      });
      throw reason;
    }


    __exports__.rethrow = rethrow;
  });
define("rsvp/utils",
  ["exports"],
  function(__exports__) {
    "use strict";
    function objectOrFunction(x) {
      return isFunction(x) || (typeof x === "object" && x !== null);
    }

    function isFunction(x) {
      return typeof x === "function";
    }

    function isArray(x) {
      return Object.prototype.toString.call(x) === "[object Array]";
    }

    // Date.now is not available in browsers < IE9
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/now#Compatibility
    var now = Date.now || function() { return new Date().getTime(); };



    __exports__.objectOrFunction = objectOrFunction;
    __exports__.isFunction = isFunction;
    __exports__.isArray = isArray;
    __exports__.now = now;
  });
define("rsvp",
  ["rsvp/events","rsvp/promise","rsvp/node","rsvp/all","rsvp/race","rsvp/hash","rsvp/rethrow","rsvp/defer","rsvp/config","rsvp/resolve","rsvp/reject","rsvp/asap","exports"],
  function(__dependency1__, __dependency2__, __dependency3__, __dependency4__, __dependency5__, __dependency6__, __dependency7__, __dependency8__, __dependency9__, __dependency10__, __dependency11__, __dependency12__, __exports__) {
    "use strict";
    var EventTarget = __dependency1__.EventTarget;
    var Promise = __dependency2__.Promise;
    var denodeify = __dependency3__.denodeify;
    var all = __dependency4__.all;
    var race = __dependency5__.race;
    var hash = __dependency6__.hash;
    var rethrow = __dependency7__.rethrow;
    var defer = __dependency8__.defer;
    var config = __dependency9__.config;
    var configure = __dependency9__.configure;
    var resolve = __dependency10__.resolve;
    var reject = __dependency11__.reject;
    var asap = __dependency12__.asap;

    config.async = asap; // default async is asap;

    function async(callback, arg) {
      config.async(callback, arg);
    }

    function on() {
      config.on.apply(config, arguments);
    }

    function off() {
      config.off.apply(config, arguments);
    }

    function trigger() {
      config.trigger.apply(config, arguments);
    }

    Promise.on = on;
    Promise.off = off;
    Promise.trigger = trigger;


    __exports__.Promise = Promise;
    __exports__.EventTarget = EventTarget;
    __exports__.all = all;
    __exports__.race = race;
    __exports__.hash = hash;
    __exports__.rethrow = rethrow;
    __exports__.defer = defer;
    __exports__.denodeify = denodeify;
    __exports__.configure = configure;
    __exports__.trigger = trigger;
    __exports__.on = on;
    __exports__.off = off;
    __exports__.resolve = resolve;
    __exports__.reject = reject;
    __exports__.async = async;
  });