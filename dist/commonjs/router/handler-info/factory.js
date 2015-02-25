"use strict";
var ResolvedHandlerInfo = require("./resolved-handler-info")["default"];
var UnresolvedHandlerInfoByObject = require("./unresolved-handler-info-by-object")["default"];
var UnresolvedHandlerInfoByParam = require("./unresolved-handler-info-by-param")["default"];

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