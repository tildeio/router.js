"use strict";
var oCreate = require("./utils").oCreate;

/**
  Promise reject reasons passed to promise rejection
  handlers for failed transitions.
 */
function UnrecognizedURLError(message) {
  this.message = (message || "UnrecognizedURLError");
  this.name = "UnrecognizedURLError";
  Error.call(this);
}

UnrecognizedURLError.prototype = oCreate(Error.prototype);

exports["default"] = UnrecognizedURLError;