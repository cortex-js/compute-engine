import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const deepmerge = require('../../vendor/deepmerge');

test('vendored deepmerge rejects prototype-poisoning keys', () => {
  const source = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"bad":true}},"safe":{"x":1}}'
  );
  const result = deepmerge({}, source);

  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.prototype.bad, undefined);
  assert.equal(Object.hasOwn(result, '__proto__'), false);
  assert.equal(Object.hasOwn(result, 'constructor'), false);
  assert.deepEqual(result.safe, { x: 1 });
});
