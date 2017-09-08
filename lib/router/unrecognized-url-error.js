function UnrecognizedURLError(message) {
  if (!(this instanceof UnrecognizedURLError)) {
    return new UnrecognizedURLError(message);
  }

  var error = Error.call(this, message);

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, UnrecognizedURLError);
  } else {
    this.stack = error.stack;
  }

  this.description = error.description;
  this.fileName = error.fileName;
  this.lineNumber = error.lineNumber;
  this.message = error.message || 'UnrecognizedURL';
  this.name = 'UnrecognizedURLError';
  this.number = error.number;
  this.code = error.code;
}

UnrecognizedURLError.prototype = Object.create(Error.prototype);

export default UnrecognizedURLError;
