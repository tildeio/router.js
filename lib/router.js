import Router from './router/router';

export default Router;

/**
 * Handler object
 *
 * @property {} context
 * @property {Boolean} inaccessibleByURL
 * @property {Function} reset ({Boolean} willExit, {Transition} transition) Prepares for a new context
 * @property {Function} enter ({Transition} transition) Enters active state
 * @property {Function} contextDidChange () Notifies about handle.context changes
 * @property {Function} beforeModel ([{Object} queryParams], {Transition} transition) -> [{Promise}] Triggered before the model is retrieved
 * @property {Function} model/deserialize ([{Object} queryParams], [{Object} params], {Transition} transition) -> {*|Promise} Get model/s from parameters
 * @property {Function} afterModel ({*} model, [{Object} queryParams], {Transition} transition) -> [{Promise}] Triggered after the model is retrieved
 * @property {Function} serialize ({*} model, {String[]} names) -> {Object} Serializes a model to a parameter object
 * @property {Function} redirect ({*} model, {Transition} transition) Give a chance to redirect transition
 * @property {Function} setup ({*} model, {Transition} transition) Call to setup environment for route-segment
 * @property {Function} exit ([{Transition} transition]) Leaves active state
 * @property {Object} events List of events
 * @property {Function} events.willTransition ({Transition} newTransition) Fired shortly before starting to transition.
 * @property {Function} events.willChangeContext ({Transition} newTransition) Fired when transition causes changes to the context/model-data of a handler-object
 * @property {Function} events.willResolveModel ({Transition} transition, {Object} resolvedHandlerObject)
 * @property {Function} events.finalizeQueryParamChange ({Object} newQueryParams, {Object} finalQueryParams, {Transition} transition) Fired when setting context. (Third param has following structure and is an out variable { key:<string>, value:<mixed>, visible:<boolean> })
 * @property {Function} events.didTransition () Fired when transition is completed
 * @property {Function} events.willLeave ({Transition} newTransition, {Function} leavingChecker{String} (name) -> {Boolean} Exited?) Fired when handler-info is going to exit. Use leavingChecker to see which handler-info will be exited. Name is the name of the handle-info.
 */
