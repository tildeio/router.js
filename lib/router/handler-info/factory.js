import ResolvedHandlerInfo from './resolved-handler-info';
import UnresolvedHandlerInfoByObject from './unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from './unresolved-handler-info-by-param';

handlerInfoFactory.klasses = {
  resolved: ResolvedHandlerInfo,
  param: UnresolvedHandlerInfoByParam,
  object: UnresolvedHandlerInfoByObject,
};

export default function handlerInfoFactory(name, props) {
  let klass = handlerInfoFactory.klasses[name];
  let handlerInfo = new klass(props || {});
  handlerInfo.factory = handlerInfoFactory;
  return handlerInfo;
}
