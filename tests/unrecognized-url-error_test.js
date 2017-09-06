import { module, test } from './test_helpers';
import UnrecognizedURLError from 'router/unrecognized-url-error';

module('unrecognized-url-error');

test('correct inheritance', function(assert) {
  var error;

  try {
    throw new UnrecognizedURLError('Message');
  } catch (e) {
    error = e;
  }

  assert.ok(error instanceof UnrecognizedURLError);
  assert.ok(error instanceof Error);
});
