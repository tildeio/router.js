import Backburner from 'backburner';
import Router, { IHandler, Transition } from 'router';
import { Dict } from 'router/core';
import HandlerInfo, { noopGetHandler, UnresolvedHandlerInfoByParam } from 'router/handler-info';
import TransitionAbortedError from 'router/transition-aborted-error';
import { configure, resolve } from 'rsvp';

QUnit.config.testTimeout = 1000;

let bb = new Backburner(['promises']);
function customAsync(callback: Function, promise: Promise<unknown>) {
  bb.defer('promises', promise, callback, promise);
}

function flushBackburner() {
  bb.end();
  bb.begin();
}

let test = QUnit.test;

function module(name: string, options?: any) {
  options = options || {};
  QUnit.module(name, {
    beforeEach: function() {
      configure('async', customAsync);
      bb.begin();

      if (options.setup) {
        options.setup.apply(this, arguments);
      }
    },
    afterEach: function() {
      bb.end();

      if (options.teardown) {
        options.teardown.apply(this, arguments);
      }
    },
  });
}

function assertAbort(assert: Assert) {
  return function _assertAbort(e: Error) {
    assert.ok(e instanceof TransitionAbortedError, 'transition was redirected/aborted');
  };
}

// Helper method that performs a transition and flushes
// the backburner queue. Helpful for when you want to write
// tests that avoid .then callbacks.
function transitionTo(
  router: Router,
  path: string | { queryParams: Dict<unknown> },
  ...context: any[]
) {
  let result = router.transitionTo.apply(router, [path, ...context]);
  flushBackburner();
  return result;
}

function transitionToWithAbort(assert: Assert, router: Router, path: string) {
  let args = [path];
  router.transitionTo.apply(router, args).then(shouldNotHappen, assertAbort(assert));
  flushBackburner();
}

function replaceWith(router: Router, path: string) {
  let result = router.transitionTo.apply(router, [path]).method('replace');
  flushBackburner();
  return result;
}

function handleURL(router: Router, url: string) {
  let result = router.handleURL.apply(router, [url]);
  flushBackburner();
  return result;
}

function shouldNotHappen(assert: Assert, _message?: string) {
  let message = _message || 'this .then handler should not be called';
  return function _shouldNotHappen(error: Error) {
    console.error(error.stack); // eslint-disable-line
    assert.ok(false, message);
  };
}

function stubbedHandlerInfoFactory(name: string, props: Dict<unknown>) {
  let obj = Object.create(props);
  obj._handlerInfoType = name;
  return obj;
}

module('backburner sanity test');

test('backburnerized testing works as expected', function(assert) {
  assert.expect(1);
  resolve('hello').then(function(word: string) {
    assert.equal(word, 'hello', 'backburner flush in teardown resolved this promise');
  });
});

export {
  module,
  test,
  flushBackburner,
  handleURL,
  transitionTo,
  transitionToWithAbort,
  replaceWith,
  shouldNotHappen,
  stubbedHandlerInfoFactory,
  assertAbort,
};

export function createHandler(name: string, options?: Dict<unknown>): IHandler {
  return Object.assign(
    { name, _handlerName: name, context: undefined, names: [], handler: name },
    options
  );
}

export function createHandlerInfo(name: string, options: Dict<unknown> = {}): HandlerInfo {
  class Stub extends HandlerInfo {
    constructor(name: string, handler?: IHandler) {
      super(name, handler);
    }
    getModel(_transition: Transition) {
      return {};
    }
    getUnresolved() {
      return new UnresolvedHandlerInfoByParam('empty', noopGetHandler, {});
    }
    getHandler = (name: string) => {
      return createHandler(name);
    };
  }

  let handler = (options.handler as IHandler) || createHandler('foo');
  delete options.handler;

  Object.assign(Stub.prototype, options);
  let stub = new Stub(name, handler);
  return stub;
}
