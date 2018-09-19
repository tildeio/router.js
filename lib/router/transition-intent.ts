import { Dict } from './core';
import Router from './router';
import TransitionState from './transition-state';

export abstract class TransitionIntent {
  data: Dict<unknown>;
  router: Router;
  constructor(router: Router, data?: Dict<unknown>) {
    this.router = router;
    this.data = data || {};
  }
  preTransitionState?: TransitionState;
  abstract applyToState(oldState: TransitionState, isIntermidate: boolean): TransitionState;
}
