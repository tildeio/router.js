"use strict";
var HandlerInfo = require("../handler-info")["default"];
var merge = require("../utils").merge;
var subclass = require("../utils").subclass;
var promiseLabel = require("../utils").promiseLabel;
var isParam = require("../utils").isParam;
var Promise = require("rsvp").Promise;

var UnresolvedHandlerInfoByObject = subclass(HandlerInfo, {
  getModel: function(payload) {
    this.log(payload, this.name + ": resolving provided model");
    return Promise.resolve(this.context);
  },

  initialize: function(props) {
    this.names = props.names || [];
    this.context = props.context;
  },

  /**
    @private

    Serializes a handler using its custom `serialize` method or
    by a default that looks up the expected property name from
    the dynamic segment.

    @param {Object} model the model to be serialized for this handler
  */
  serialize: function(_model) {
    var model = _model || this.context,
        names = this.names,
        handler = this.handler;

    var object = {};
    if (isParam(model)) {
      object[names[0]] = model;
      return object;
    }

    // Use custom serialize if it exists.
    if (handler.serialize) {
      return handler.serialize(model, names);
    }

    if (names.length !== 1) { return; }

    var name = names[0];

    if (/_id$/.test(name)) {
      object[name] = model.id;
    } else {
      object[name] = model;
    }
    return object;
  }
});

exports["default"] = UnresolvedHandlerInfoByObject;