import HandlerInfo from '../handler-info';
import { Promise } from 'rsvp';

export default class ResolvedHandlerInfo extends HandlerInfo {
  constructor(props) {
    super(props);
    this.isResolved = true;
  }

  resolve(shouldContinue, payload) {
    // A ResolvedHandlerInfo just resolved with itself.
    if (payload && payload.resolvedModels) {
      payload.resolvedModels[this.name] = this.context;
    }
    return Promise.resolve(this, this.promiseLabel('Resolve'));
  }

  getUnresolved() {
    return this.factory('param', {
      name: this.name,
      handler: this.handler,
      params: this.params,
    });
  }
}
