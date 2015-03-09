import UnrecognizedURLError from 'router/unrecognized-url-error';

module("unrecognized-url-error");

test("correct inheritance", function() {
  var error;
  try {
    throw new UnrecognizedURLError('Message');
  } catch(e) {
    error = e;
  }

  ok(error instanceof UnrecognizedURLError);
  ok(error instanceof Error);
});
