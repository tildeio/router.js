import UnrecognizedURLError from 'router/unrecognized-url-error';

module("unrecognized-url-error");

test("correct inheritance", function() {
  var error;
  try {
    throw UnrecognizedURLError('Message');
  } catch(e) { 
    error = e;
  }

  assert(error instanceof UnrecognizedURLError);
  assert(error instanceof Error);
});
