import { Promise } from 'rsvp';
import { Dict } from './core';
import { GetHandlerFunc, SerializerFunc } from './router';
import { isTransition, prepareResult, Transition } from './transition';
import { isParam, isPromise, merge, promiseLabel } from './utils';

interface IModel {
  id?: string | number;
}

const stubHandler = {
  _handlerName: '',
  context: undefined,
  handler: '',
  names: [],
};

export const noopGetHandler = () => {
  return Promise.resolve<IHandler>(stubHandler);
};

export const DEFAULT_HANDLER: IHandler = Object.freeze({
  _handlerName: '',
  context: undefined,
  handler: '',
  names: [],
});

export interface HandlerInfoArgs {
  name: string;
  handler?: any;
}

export interface HandlerHooks {
  model?(
    params: Dict<unknown>,
    transition: Transition
  ): Promise<Dict<unknown> | null | undefined> | undefined | Dict<unknown>;
  deserialize?(params: Dict<unknown>, transition: Transition): Dict<unknown>;
  serialize?(model: Dict<unknown>, params: string[]): Dict<unknown>;
  beforeModel?(transition: Transition): Promise<Dict<unknown> | null | undefined> | undefined;
  afterModel?(
    resolvedModel: Dict<unknown>,
    transition: Transition
  ): Promise<Dict<unknown> | null | undefined>;
  setup?(context: Dict<unknown>, transition: Transition): void;
  enter?(transition: Transition): void;
  exit?(transition?: Transition): void;
  reset?(wasReset: boolean, transition?: Transition): void;
  contextDidChange?(): void;
  // Underscore methods for some reason
  redirect?(context: Dict<unknown>, transition: Transition): void;
  _model?(
    params: Dict<unknown>,
    transition: Transition
  ): Promise<Dict<unknown> | null | undefined> | undefined | Dict<unknown>;
  _deserialize?(params: Dict<unknown>, transition: Transition): Dict<unknown>;
  _serialize?(model: Dict<unknown>, params: string[]): Dict<unknown>;
  _beforeModel?(transition: Transition): Promise<Dict<unknown> | null | undefined> | undefined;
  _afterModel?(
    resolvedModel: Dict<unknown>,
    transition: Transition
  ): Promise<Dict<unknown> | null | undefined>;
  _setup?(context: Dict<unknown>, transition: Transition): void;
  _enter?(transition: Transition): void;
  _exit?(transition?: Transition): void;
  _reset?(wasReset: boolean, transition?: Transition): void;
  _contextDidChange?(): void;
  _redirect?(context: Dict<unknown>, transition: Transition): void;
}

export interface IHandler extends HandlerHooks {
  inaccessibleByURL?: boolean;
  _handlerName: string;
  context: unknown;
  names: string[];
  name?: string;
  handler: string;
  events?: Dict<Function>;
}

export type Continuation = () => PromiseLike<boolean> | boolean;

export interface IResolvedModel {
  [key: string]: unknown;
}

export default abstract class HandlerInfo {
  private _handlerPromise?: Promise<IHandler>;
  private _handler?: IHandler | undefined;
  name: string;
  params: Dict<unknown> = {};
  queryParams?: Dict<unknown>;
  context?: Dict<unknown>;
  isResolved = false;

  constructor(name: string, handler?: IHandler) {
    // initialize local properties to ensure consistent object shape
    this._handler = DEFAULT_HANDLER;
    this._handlerPromise = undefined;
    this.name = name;

    if (handler) {
      this._processHandler(handler);
    }
  }

  abstract getModel(transition: Transition): Promise<Dict<unknown> | undefined> | Dict<unknown>;

  abstract getUnresolved(): UnresolvedHandlerInfoByParam | UnresolvedHandlerInfoByObject;

  abstract getHandler: GetHandlerFunc;

  serialize(_context?: Dict<unknown>) {
    return this.params || {};
  }

  resolve(shouldContinue: Continuation, transition: Transition): Promise<ResolvedHandlerInfo> {
    return Promise.resolve(this.handlerPromise, this.promiseLabel('Start handler'))
      .then(
        (handler: IHandler) => this.checkForAbort(shouldContinue, handler),
        null,
        this.promiseLabel('Check for abort')
      )
      .then(
        () => {
          return this.runBeforeModelHook(transition);
        },
        null,
        this.promiseLabel('Before model')
      )
      .then(
        () => this.checkForAbort(shouldContinue, null),
        null,
        this.promiseLabel("Check if aborted during 'beforeModel' hook")
      )
      .then(() => this.getModel(transition))
      .then(
        resolvedModel => this.checkForAbort(shouldContinue, resolvedModel),
        null,
        this.promiseLabel("Check if aborted in 'model' hook")
      )
      .then(resolvedModel => this.runAfterModelHook(transition, resolvedModel))
      .then(resolvedModel => this.becomeResolved(transition, resolvedModel));
  }

  becomeResolved(
    transition: Transition | null,
    resolvedContext: Dict<unknown>
  ): ResolvedHandlerInfo {
    let params = this.serialize(resolvedContext);

    if (transition) {
      this.stashResolvedModel(transition, resolvedContext);
      transition.params = transition.params || {};
      transition.params[this.name] = params;
    }

    let context;
    let contextsMatch = resolvedContext === this.context;

    if ('context' in this || !contextsMatch) {
      context = resolvedContext;
    }

    return new ResolvedHandlerInfo(this.name, this.handler, params, context);
  }

  shouldSupercede(other?: HandlerInfo) {
    // Prefer this newer handlerInfo over `other` if:
    // 1) The other one doesn't exist
    // 2) The names don't match
    // 3) This handler has a context that doesn't match
    //    the other one (or the other one doesn't have one).
    // 4) This handler has parameters that don't match the other.
    if (!other) {
      return true;
    }

    let contextsMatch = other.context === this.context;
    return (
      other.name !== this.name ||
      ('context' in this && !contextsMatch) ||
      (this.hasOwnProperty('params') && !paramsMatch(this.params, other.params))
    );
  }

  get handler(): IHandler | undefined {
    // _handler could be set to either a handler object or undefined, so we
    // compare against a default reference to know when it's been set
    if (this._handler !== DEFAULT_HANDLER) {
      return this._handler!;
    }

    return this.fetchHandler();
  }

  set handler(handler: IHandler | undefined) {
    this._handler = handler;
  }

  get handlerPromise(): Promise<IHandler> {
    if (this._handlerPromise) {
      return this._handlerPromise;
    }

    this.fetchHandler();

    return this._handlerPromise!;
  }

  set handlerPromise(handlerPromise: Promise<IHandler>) {
    this._handlerPromise = handlerPromise;
  }

  protected promiseLabel(label: string) {
    return promiseLabel("'" + this.name + "' " + label);
  }

  protected log(transition: Transition, message: string) {
    if (transition.log) {
      transition.log(this.name + ': ' + message);
    }
  }

  private updateHandler(handler: IHandler) {
    // Store the name of the handler on the handler for easy checks later
    handler._handlerName = this.name;
    return (this.handler = handler);
  }

  private runBeforeModelHook(transition: Transition) {
    if (transition.trigger) {
      transition.trigger(true, 'willResolveModel', transition, this.handler);
    }

    let result;
    if (this.handler) {
      if (this.handler._beforeModel !== undefined) {
        result = this.handler._beforeModel(transition);
      } else if (this.handler.beforeModel !== undefined) {
        result = this.handler.beforeModel(transition);
      }
    }

    if (isTransition(result)) {
      result = null;
    }

    return Promise.resolve(result);
  }

  private runAfterModelHook(
    transition: Transition,
    resolvedModel?: Dict<unknown>
  ): Promise<Dict<unknown>> {
    // Stash the resolved model on the payload.
    // This makes it possible for users to swap out
    // the resolved model in afterModel.
    let name = this.name;
    this.stashResolvedModel(transition, resolvedModel!);

    let result;
    if (this.handler !== undefined) {
      if (this.handler._afterModel !== undefined) {
        result = this.handler._afterModel(resolvedModel!, transition);
      } else if (this.handler.afterModel !== undefined) {
        result = this.handler.afterModel(resolvedModel!, transition);
      }
    }

    result = prepareResult(result);

    return Promise.resolve(result).then(() => {
      // Ignore the fulfilled value returned from afterModel.
      // Return the value stashed in resolvedModels, which
      // might have been swapped out in afterModel.
      return transition.resolvedModels[name]!;
    });
  }

  private checkForAbort<T>(shouldContinue: Continuation, value: T) {
    return Promise.resolve(shouldContinue(), this.promiseLabel('Check for abort')).then(
      function() {
        // We don't care about shouldContinue's resolve value;
        // pass along the original value passed to this fn.
        return value;
      },
      null,
      this.promiseLabel('Ignore fulfillment value and continue')
    );
  }

  private stashResolvedModel(transition: Transition, resolvedModel?: Dict<unknown>) {
    transition.resolvedModels = transition.resolvedModels || {};
    transition.resolvedModels[this.name] = resolvedModel;
  }

  private fetchHandler() {
    let handler = this.getHandler(this.name);
    return this._processHandler(handler);
  }

  private _processHandler(handler: IHandler | Promise<IHandler>) {
    // Setup a handlerPromise so that we can wait for asynchronously loaded handlers
    this.handlerPromise = Promise.resolve(handler);

    // Wait until the 'handler' property has been updated when chaining to a handler
    // that is a promise
    if (isPromise(handler)) {
      this.handlerPromise = this.handlerPromise.then(h => {
        return this.updateHandler(h);
      });
      // set to undefined to avoid recursive loop in the handler getter
      return (this.handler = undefined);
    } else if (handler) {
      return this.updateHandler(handler);
    }

    return undefined;
  }
}

export class ResolvedHandlerInfo extends HandlerInfo {
  isResolved: boolean;
  constructor(
    name: string,
    handler: IHandler | undefined,
    params: Dict<unknown>,
    context?: Dict<unknown>
  ) {
    super(name, handler);
    this.params = params;
    this.isResolved = true;
    this.context = context;
  }

  resolve(_shouldContinue?: Continuation, transition?: Transition): Promise<this> {
    // A ResolvedHandlerInfo just resolved with itself.
    if (transition && transition.resolvedModels) {
      transition.resolvedModels[this.name] = this.context!;
    }
    return Promise.resolve<this>(this, this.promiseLabel('Resolve'));
  }

  getUnresolved() {
    return new UnresolvedHandlerInfoByParam(this.name, noopGetHandler, this.params, this.handler);
  }

  getHandler = (_name: string) => {
    throw new Error('Method not implemented.');
  };

  getModel(): never {
    throw new Error('Method not implemented.');
  }
}

export class UnresolvedHandlerInfoByParam extends HandlerInfo {
  getHandler: GetHandlerFunc;
  params: Dict<unknown> = {};
  constructor(name: string, getHandler: GetHandlerFunc, params: Dict<unknown>, handler?: IHandler) {
    super(name, handler);
    this.params = params;
    this.getHandler = getHandler;
  }

  getUnresolved() {
    return this;
  }

  getModel(transition: Transition) {
    let fullParams = this.params;
    if (transition && transition.queryParams) {
      fullParams = {};
      merge(fullParams, this.params);
      fullParams.queryParams = transition.queryParams;
    }

    let handler = this.handler!;

    let result: Dict<unknown> | undefined = undefined;

    if (handler._deserialize) {
      result = handler._deserialize(fullParams, transition);
    } else if (handler.deserialize) {
      result = handler.deserialize(fullParams, transition);
    } else if (handler._model) {
      result = handler._model(fullParams, transition);
    } else if (handler.model) {
      result = handler.model(fullParams, transition);
    }

    if (result && isTransition(result)) {
      result = undefined;
    }

    return Promise.resolve(
      result,
      this.promiseLabel('Resolve value returned from one of the model hooks')
    );
  }
}

export class UnresolvedHandlerInfoByObject extends HandlerInfo {
  names: string[] = [];
  serializer?: SerializerFunc;
  getHandler: GetHandlerFunc;
  constructor(
    name: string,
    names: string[],
    getHandler: GetHandlerFunc,
    serializer: SerializerFunc | undefined,
    context: Dict<unknown>
  ) {
    super(name);
    this.names = names;
    this.getHandler = getHandler;
    this.serializer = serializer;
    this.context = context;
    this.names = this.names || [];
  }

  getModel(transition: Transition) {
    this.log(transition, this.name + ': resolving provided model');
    return Promise.resolve(this.context);
  }

  getUnresolved() {
    return this;
  }

  /**
    @private

    Serializes a handler using its custom `serialize` method or
    by a default that looks up the expected property name from
    the dynamic segment.

    @param {Object} model the model to be serialized for this handler
  */
  serialize(model?: IModel) {
    let { names, context } = this;

    if (!model) {
      model = context as IModel;
    }

    let object: Dict<unknown> = {};
    if (isParam(model)) {
      object[names[0]] = model;
      return object;
    }

    // Use custom serialize if it exists.
    if (this.serializer) {
      // invoke this.serializer unbound (getSerializer returns a stateless function)
      return this.serializer.call(null, model, names);
    } else if (this.handler) {
      if (this.handler._serialize) {
        return this.handler._serialize(model, names);
      }

      if (this.handler.serialize) {
        return this.handler.serialize(model, names);
      }
    }

    if (names.length !== 1) {
      return;
    }

    let name = names[0];

    if (/_id$/.test(name)) {
      object[name] = model.id;
    } else {
      object[name] = model;
    }
    return object;
  }
}

function paramsMatch(a: Dict<unknown>, b: Dict<unknown>) {
  if (!a !== !b) {
    // Only one is null.
    return false;
  }

  if (!a) {
    // Both must be null.
    return true;
  }

  // Note: this assumes that both params have the same
  // number of keys, but since we're comparing the
  // same handlers, they should.
  for (let k in a) {
    if (a.hasOwnProperty(k) && a[k] !== b[k]) {
      return false;
    }
  }
  return true;
}
