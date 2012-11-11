(function(exports) {

  var RouteRecognizer = exports.RouteRecognizer;

  exports.Router = function Router() {
    this.recognizer = new RouteRecognizer();
  }

  Router.prototype = {
    map: function(callback) {
      this.recognizer.map(callback, function(recognizer, route) {
        var lastHandler = route[route.length - 1].handler;
        var args = [route, { as: lastHandler }];
        recognizer.add.apply(recognizer, args);
      });
    },

    generate: function(name, params) {
      return this.recognizer.generate(name, params);
    },

    handleURL: function(url) {
      var results = this.recognizer.recognize(url),
          objects = [];

      this._collectObjects(results, 0, []);
    },

    _loading: function() {
      if (!this._isLoading) {
        var handler = this.getHandler('loading');
        handler && handler.setup();
      }
    },

    _loaded: function() {
      var handler = this.getHandler('loading');
      handler && handler.exit();
    },

    _collectObjects: function(results, index, objects) {
      if (results.length === index) {
        this._loaded();
        this._setupContexts(objects);
        return;
      }

      var result = results[index], self = this;

      handler = this.getHandler(result.handler);
      var object = handler.deserialize && handler.deserialize(result.params);

      if (typeof object.then === 'function') {
        this._loading();

        object.then(function(resolved) {
          self._collectObjects(results, index + 1, objects.concat([{ value: resolved, handler: result.handler }]));
        });
      } else {
        self._collectObjects(results, index + 1, objects.concat([{ value: object, handler: result.handler }]));
      }
    },

    _setupContexts: function(objects) {
      for (var i=0, l=objects.length; i<l; i++) {
        var object = objects[i],
            value = object.value,
            handler = this.getHandler(object.handler);

        if (handler.context !== value) {
          handler.context = value;
          handler.setup && handler.setup(value);
        }
      }
    },

    transitionTo: function(name) {
      var handlers = this.recognizer.handlersFor(name),
          objects = [].slice.call(arguments, 1),
          params = {},
          setupHandlers = false;

      for (var i=0, l=handlers.length; i<l; i++) {
        var handlerObj = handlers[i],
            handler = this.getHandler(handlerObj.handler),
            names = handlerObj.names,
            params;

        if (names.length) {
          var object = objects.shift();

          if (handler.context !== object) {
            setupHandlers = true;
            merge(params, handler.serialize(object));
            handler.context = object;
          }
        }

        if (setupHandlers) {
          handler.setup(handler.context);
        }
      }

      var url = this.recognizer.generate(name, params);
      this.updateURL(url);
    }
  }

  function merge(hash, other) {
    for (var prop in other) {
      if (other.hasOwnProperty(prop)) { hash[prop] = other[prop]; }
    }
  }

})(window);
