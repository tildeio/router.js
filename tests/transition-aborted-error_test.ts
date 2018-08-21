import TransitionAbortedError from 'router/transition-aborted-error';
import { module, test } from './test_helpers';

module('transition-aborted-error');

test('correct inheritance and name', function(assert) {
  let error;

  try {
    throw new TransitionAbortedError('Message');
  } catch (e) {
    error = e;
  }

  // it would be more correct with TransitionAbortedError, but other libraries may rely on this name
  assert.equal(
    error.name,
    'TransitionAborted',
    "TransitionAbortedError has the name 'TransitionAborted'"
  );

  assert.ok(error instanceof TransitionAbortedError);
  assert.ok(error instanceof Error);
});
