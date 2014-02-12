import { merge } from './utils';

function TransitionIntent(props) {
  if (props) {
    merge(this, props);
  }
  this.data = this.data || {};
}

TransitionIntent.prototype.applyToState = function(oldState) {
  // Default TransitionIntent is a no-op.
  return oldState;
};

export default TransitionIntent;
