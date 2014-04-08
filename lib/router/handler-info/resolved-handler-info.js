import HandlerInfo from '../handler-info';
import { subclass, promiseLabel } from 'router/utils';
import Promise from 'rsvp/promise';

var ResolvedHandlerInfo = subclass(HandlerInfo, {
  resolve: function(async, shouldContinue, payload) {
    // A ResolvedHandlerInfo just resolved with itself.
    if (payload && payload.resolvedModels) {
      payload.resolvedModels[this.name] = this.context;
    }
    return Promise.resolve(this, this.promiseLabel("Resolve"));
  },

  getUnresolved: function() {
    return this.factory('param', {
      name: this.name,
      handler: this.handler,
      params: this.params
    });
  },

  isResolved: true
});

export default ResolvedHandlerInfo;

