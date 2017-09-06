import { module, test } from './test_helpers';
import { getChangelist, callHook } from 'router/utils';

module('utils');

test('getChangelist', function(assert) {
  var result = getChangelist({}, { foo: '123' });
  assert.deepEqual(result, {
    all: { foo: '123' },
    changed: { foo: '123' },
    removed: {},
  });

  result = getChangelist({ foo: '123' }, { foo: '123' });
  assert.notOk(result);

  result = getChangelist({ foo: '123' }, {});
  assert.deepEqual(result, { all: {}, changed: {}, removed: { foo: '123' } });

  result = getChangelist({ foo: '123', bar: '456' }, { foo: '123' });
  assert.deepEqual(result, {
    all: { foo: '123' },
    changed: {},
    removed: { bar: '456' },
  });

  result = getChangelist({ foo: '123', bar: '456' }, { foo: '456' });
  assert.deepEqual(result, {
    all: { foo: '456' },
    changed: { foo: '456' },
    removed: { bar: '456' },
  });
});

test('callHook invokes optional methods, preferring underscored versions', function(
  assert
) {
  assert.expect(8);

  var obj = {
    a: function(a, b) {
      assert.equal(a, 1);
      assert.equal(b, 2);
      assert.equal(this, obj);
      assert.ok(true);
      return 'A';
    },
    _b: function() {
      assert.ok(true);
      return 'B';
    },
    b: function() {
      assert.ok(false, "b shouldn't be called");
    },
  };

  assert.equal('A', callHook(obj, 'a', 1, 2, 3));
  assert.equal('B', callHook(obj, 'b'));
  assert.ok(typeof callHook(obj, 'c'), 'undefined');
  callHook(null, 'wat');
});
