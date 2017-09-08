import HandlerInfo from '../handler-info';
import { isParam } from '../utils';
import { Promise } from 'rsvp';

export default class UnresolvedHandlerInfoByObject extends HandlerInfo {
  constructor(props) {
    super(props);
    this.names = this.names || [];
  }

  getModel(payload) {
    this.log(payload, this.name + ': resolving provided model');
    return Promise.resolve(this.context);
  }

  /**
    @private

    Serializes a handler using its custom `serialize` method or
    by a default that looks up the expected property name from
    the dynamic segment.

    @param {Object} model the model to be serialized for this handler
  */
  serialize(_model) {
    var model = _model || this.context,
      names = this.names,
      serializer = this.serializer || (this.handler && this.handler.serialize);

    var object = {};
    if (isParam(model)) {
      object[names[0]] = model;
      return object;
    }

    // Use custom serialize if it exists.
    if (serializer) {
      return serializer(model, names);
    }

    if (names.length !== 1) {
      return;
    }

    var name = names[0];

    if (/_id$/.test(name)) {
      object[name] = model.id;
    } else {
      object[name] = model;
    }
    return object;
  }
}
