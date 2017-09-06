import ResolvedHandlerInfo from './resolved-handler-info';
import UnresolvedHandlerInfoByObject from './unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from './unresolved-handler-info-by-param';

handlerInfoFactory.klasses = {
  resolved: ResolvedHandlerInfo,
  param: UnresolvedHandlerInfoByParam,
  object: UnresolvedHandlerInfoByObject,
};

function handlerInfoFactory(name, props) {
  var Ctor = handlerInfoFactory.klasses[name],
    handlerInfo = new Ctor(props || {});
  handlerInfo.factory = handlerInfoFactory;
  return handlerInfo;
}

export default handlerInfoFactory;
