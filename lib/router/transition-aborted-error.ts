export interface TransitionAbortedErrorContructor {
  new (message?: string): TransitionAbortedError;
  readonly prototype: TransitionAbortedError;
}

export interface TransitionAbortedError extends Error {
  constructor: TransitionAbortedErrorContructor;
}

const TransitionAbortedError: TransitionAbortedErrorContructor = (function() {
  TransitionAbortedError.prototype = Object.create(Error.prototype);
  TransitionAbortedError.prototype.constructor = TransitionAbortedError;

  function TransitionAbortedError(this: TransitionAbortedError, message?: string) {
    let error = Error.call(this, message);
    this.name = 'TransitionAborted';
    this.message = message || 'TransitionAborted';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransitionAbortedError);
    } else {
      this.stack = error.stack;
    }
  }

  return TransitionAbortedError as any;
})();

export default TransitionAbortedError;
