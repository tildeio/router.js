import { getChangelist } from 'router/utils';

module("utils");

test("getChangelist", function() {

  var result = getChangelist({}, { foo: '123' });
  deepEqual(result, { all: { foo: '123' }, changed: { foo: '123' }, removed: {} });

  result = getChangelist({ foo: '123' }, { foo: '123' });
  ok(!result);

  result = getChangelist({ foo: '123' }, {});
  deepEqual(result, { all: {}, changed: {}, removed: { foo: '123' } });

  result = getChangelist({ foo: '123', bar: '456'}, { foo: '123'});
  deepEqual(result, { all: { foo: '123' }, changed: {}, removed: { bar: '456' } });

  result = getChangelist({ foo: '123', bar: '456'}, { foo: '456'});
  deepEqual(result, { all: { foo: '456' }, changed: { foo: '456' }, removed: { bar: '456' } });
});
