"use strict";
var HandlerInfo = require("../handler-info")["default"];
var subclass = require("../utils").subclass;
var promiseLabel = require("../utils").promiseLabel;
var Promise = require("rsvp").Promise;

var ResolvedHandlerInfo = subclass(HandlerInfo, {
  resolve: function(shouldContinue, payload) {
    // A ResolvedHandlerInfo just resolved with itself.
    if (payload && payload.resolvedModels) {
      payload.resolvedModels[this.name] = this.context;
    }
    return Promise.resolve(this, this.promiseLabel("Resolve"));
  },

  getUnresolved: function() {
    return this.factory('param', {
      name: this.name,
      handler: this.handler,
      params: this.params
    });
  },

  isResolved: true
});

exports["default"] = ResolvedHandlerInfo;