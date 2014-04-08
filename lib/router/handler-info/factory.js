import ResolvedHandlerInfo from 'router/handler-info/resolved-handler-info';
import UnresolvedHandlerInfoByObject from 'router/handler-info/unresolved-handler-info-by-object';
import UnresolvedHandlerInfoByParam from 'router/handler-info/unresolved-handler-info-by-param';

handlerInfoFactory.klasses = {
  resolved: ResolvedHandlerInfo,
  param: UnresolvedHandlerInfoByParam,
  object: UnresolvedHandlerInfoByObject
};

function handlerInfoFactory(name, props) {
  var Ctor = handlerInfoFactory.klasses[name],
      handlerInfo = new Ctor(props || {});
  handlerInfo.factory = handlerInfoFactory;
  return handlerInfo;
}

export default handlerInfoFactory;

