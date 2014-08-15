import ResolvedHandlerInfo from 'router/handler-info/resolved-handler-info';
import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';

/**
 * List of types supported by the handler-info factory
 *
 * @type {Object}
 */
handlerInfoFactory.klasses = {
  resolved: ResolvedHandlerInfo,
  param: UnresolvedHandlerInfoByParam,
  object: UnresolvedHandlerInfoByObject
};

/**
 * Factory for handler route segments
 *
 * @param {String} name Name of the handler-info type.
 * @param {Object} [props] Properties given to the constructor.
 * @returns {HandlerInfo} HandlerInfo instance
 */
function handlerInfoFactory(name, props) {
  var Ctor = handlerInfoFactory.klasses[name],
      handlerInfo = new Ctor(props || {});
  handlerInfo.factory = handlerInfoFactory;
  return handlerInfo;
}

export default handlerInfoFactory;

