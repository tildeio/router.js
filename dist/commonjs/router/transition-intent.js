"use strict";
var merge = require("./utils").merge;

function TransitionIntent(props) {
  this.initialize(props);

  // TODO: wat
  this.data = this.data || {};
}

TransitionIntent.prototype = {
  initialize: null,
  applyToState: null
};

exports["default"] = TransitionIntent;