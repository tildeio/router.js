import HandlerInfo from '../handler-info';
import { subclass, promiseLabel } from 'router/utils';
import Promise from 'rsvp/promise';

/**
 * Resolved route handler
 *
 * @constructor
 * @extends HandlerInfo
 */
var ResolvedHandlerInfo = subclass(HandlerInfo,
  /** @lends ResolvedHandlerInfo.prototype */ {

  resolve: function(shouldContinue, payload) {
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

