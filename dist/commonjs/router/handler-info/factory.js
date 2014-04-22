"use strict";
var ResolvedHandlerInfo = require("router/handler-info/resolved-handler-info")["default"];
var UnresolvedHandlerInfoByObject = require("router/handler-info/unresolved-handler-info-by-object")["default"];
var UnresolvedHandlerInfoByParam = require("router/handler-info/unresolved-handler-info-by-param")["default"];

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

exports["default"] = handlerInfoFactory;