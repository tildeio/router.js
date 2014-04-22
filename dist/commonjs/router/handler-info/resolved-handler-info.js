"use strict";
var HandlerInfo = require("../handler-info")["default"];
var subclass = require("router/utils").subclass;
var promiseLabel = require("router/utils").promiseLabel;
var Promise = require("rsvp/promise")["default"];

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