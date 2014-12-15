import { getChangelist, callHook } from 'router/utils';

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

test("callHook invokes optional methods, preferring underscored versions", function() {
  expect(8);

  var obj = {
    a: function(a, b, c) {
      equal(a, 1);
      equal(b, 2);
      equal(this, obj);
      ok(true);
      return "A";
    },
    _b: function() {
      ok(true);
      return "B";
    },
    b: function() {
      ok(false, "b shouldn't be called");
    }
  };

  equal("A", callHook(obj, 'a', 1, 2, 3));
  equal("B", callHook(obj, 'b'));
  ok(typeof callHook(obj, 'c'), 'undefined');
  callHook(null, "wat");
});

