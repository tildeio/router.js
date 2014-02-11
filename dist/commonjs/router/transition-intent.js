"use strict";
var merge = require("./utils").merge;

function TransitionIntent(props) {
  if (props) {
    merge(this, props);
  }
  this.data = this.data || {};
}

TransitionIntent.prototype.applyToState = function(oldState) {
  // Default TransitionIntent is a no-op.
  return oldState;
};

exports["default"] = TransitionIntent;