import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { corpus, type Case } from './corpus.js';
import { verify } from './verify.js';
import { pariBasis } from './pari-basis.js';

// Manual harness tests; no comparator timings or completion scores enter CI.
const cases = corpus('extended');
const byId = new Map(cases.map((c) => [c.id, c]));

test('legacy challenge inputs and ordering remain unchanged', () => {
  const legacy = corpus('challenge');
  assert.deepEqual(cases.slice(0, legacy.length), legacy);
  assert.equal(
    createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
    'a9dfd4cf5d2faaae6c529dd9e7ecc8018dc49ffc8184561b02c325fda7d1cd8d'
  );
});

test('all fixtures reconstruct independently and have unique inputs and IDs', () => {
  assert.equal(byId.size, cases.length);
  const inputs = new Set<string>();
  for (const c of cases) {
    verify(c, c.expected);
    const key = JSON.stringify([c.modulus, c.coefficients]);
    assert.ok(!inputs.has(key), `Duplicate input: ${c.id}`);
    inputs.add(key);
    if (c.id.startsWith('extended-') || c.id.startsWith('source-')) {
      assert.ok(c.provenance?.irreducibility);
      if (c.provenance.kind !== 'generated')
        assert.ok(c.provenance.source?.startsWith('https://'));
    }
  }
});

const rationalCoefficients = (c: Case) =>
  c.coefficients.map((e) => {
    assert.ok(e.length <= 1, `Expected rational input: ${c.id}`);
    assert.equal(e[0]?.[1] ?? '1', '1');
    return Number(e[0]?.[0] ?? '0');
  });

test('sourced inputs match their actual published polynomials', () => {
  const expected: Record<string, number[]> = {
    'source-wester-quartic': [1, 0, -3, 0, 1],
    'source-sage-difference-squares': [0, 0, 2, -2, -1, 0, 1],
    'source-sage-cube-unity': [-1, 0, 0, 1],
    'source-sage-cube-unity-repeated': [1, 0, 0, -2, 0, 0, 1],
    'source-judson-quartic-unity': [1, 0, 0, 0, 1],
    'source-judson-quartic-split': [-8, 0, 2, 0, 1],
    'source-judson-quartic-partial': [-8, 0, 2, 0, 1],
    'source-judson-biquadratic': [21, 0, -10, 0, 1],
    'source-judson-cubic-partial': [-3, 0, 0, 1],
    'source-sage-tutorial-degree16': [
      0, 0, 0, 0, 0, 14, 84, 84, 84, 84, 91, 91, 77, 7, 7, 7, 7,
    ],
  };
  for (const [id, cs] of Object.entries(expected))
    assert.deepEqual(rationalCoefficients(byId.get(id)!), cs, id);
  for (const k of [1, 2, 3])
    assert.deepEqual(
      rationalCoefficients(byId.get(`source-imo1969-sophie-${k}`)!),
      [4 * k ** 4, 0, 0, 0, 1]
    );
  assert.deepEqual(byId.get('source-wester-radical')!.coefficients, [
    [
      ['-4', '1'],
      ['-2', '1'],
    ],
    [],
    [['1', '1']],
  ]);
});

test('verification rejects incorrect factors and self-consistent wrong inputs', () => {
  const c = byId.get('source-wester-quartic')!;
  const wrong = structuredClone(c.expected);
  wrong.factors[0].multiplicity++;
  assert.throws(() => verify(c, wrong), /mismatch/);
  const badInput = structuredClone(c);
  badInput.coefficients[0] = [['2', '1']];
  assert.throws(
    () => verify(badInput, badInput.expected),
    /Reconstruction mismatch/
  );
});

test('PARI integral model preserves original power-basis coordinates', () => {
  for (const id of [
    'extended-nonintegral-3-12',
    'extended-nonintegral-5-12',
    'source-wester-quartic',
  ]) {
    const c = byId.get(id)!,
      basis = pariBasis(c.modulus);
    assert.deepEqual(basis.modulus.at(-1), ['1', '1']);
    assert.ok(basis.modulus.every(([, d]) => d === '1'));
    for (const e of [...c.coefficients, c.expected.coefficient])
      assert.deepEqual(basis.fromPari(basis.toPari(e)), e);
  }
  assert.deepEqual(
    pariBasis([
      ['-2', '1'],
      ['0', '1'],
      ['0', '1'],
      ['8', '1'],
    ]).modulus,
    [
      ['-16', '1'],
      ['0', '1'],
      ['0', '1'],
      ['1', '1'],
    ]
  );
});
