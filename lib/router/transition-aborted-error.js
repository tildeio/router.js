import { oCreate } from './utils';

function TransitionAbortedError(message) {
  if (!(this instanceof TransitionAbortedError)) {
    return new TransitionAbortedError(message);
  }

  let error = Error.call(this, message);

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, TransitionAbortedError);
  } else {
    this.stack = error.stack;
  }

  this.description = error.description;
  this.fileName = error.fileName;
  this.lineNumber = error.lineNumber;
  this.message = error.message || 'TransitionAborted';
  this.name = 'TransitionAborted';
  this.number = error.number;
  this.code = error.code;
}

TransitionAbortedError.prototype = oCreate(Error.prototype);

export default TransitionAbortedError;
