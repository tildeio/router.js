export interface TransitionAbortedErrorContructor {
  new (message?: string): ITransitionAbortedError;
  readonly prototype: ITransitionAbortedError;
}

export interface ITransitionAbortedError extends Error {
  constructor: TransitionAbortedErrorContructor;
}

const TransitionAbortedError: TransitionAbortedErrorContructor = (function () {
  TransitionAbortedError.prototype = Object.create(Error.prototype);
  TransitionAbortedError.prototype.constructor = TransitionAbortedError;

  function TransitionAbortedError(this: ITransitionAbortedError, message?: string) {
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
