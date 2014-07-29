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
 * @property {*} data
 *           Data that is assigned to the transition (by reference)
 */
TransitionIntent.prototype = {
  initialize: null,
  applyToState: null
};

export default TransitionIntent;
