import RouteRecognizer from 'route-recognizer';
import { Dict } from './core';
import { GetHandlerFunc, GetSerializerFunc } from './router';
import TransitionState from './transition-state';

export abstract class TransitionIntent {
  data: Dict<unknown>;
  constructor(data?: Dict<unknown>) {
    this.data = data || {};
  }
  preTransitionState?: TransitionState;
  abstract applyToState(
    oldState: TransitionState,
    recognizer: RouteRecognizer,
    getHandler: GetHandlerFunc,
    isIntermidate: boolean,
    getSerializer: GetSerializerFunc
  ): TransitionState;
}
