import { merge } from './utils';

/**
 * @constructor
 * @param {Object} props
 */
function TransitionIntent(props) {
  this.initialize(props);

  // TODO: wat
  this.data = this.data || {};
}

/**
 * @property {*} data Data that is copied between multiple transitions
 */
TransitionIntent.prototype = {
  initialize: null,
  applyToState: null
};

export default TransitionIntent;
