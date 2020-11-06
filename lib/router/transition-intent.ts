import { Route } from './route-info';
import Router from './router';
import TransitionState from './transition-state';

export type OpaqueIntent = TransitionIntent<any>;

export abstract class TransitionIntent<T extends Route> {
  data: {};
  router: Router<T>;
  constructor(router: Router<T>, data: {} = {}) {
    this.router = router;
    this.data = data;
  }
  preTransitionState?: TransitionState<T>;
  abstract applyToState(oldState: TransitionState<T>, isIntermediate: boolean): TransitionState<T>;
}
