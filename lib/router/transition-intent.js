import { merge } from './utils';

function TransitionIntent(props) {
  this.initialize(props);

  // TODO: wat
  this.data = this.data || {};
}

TransitionIntent.prototype = {
  initialize: null,
  applyToState: null
};

export default TransitionIntent;
