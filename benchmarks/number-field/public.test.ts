import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePublicFactor, verify } from './verify.js';
import type { Case } from './corpus.js';

const c: Case = {
  id: 'decoder-test',
  family: 'test',
  modulus: [
    ['-2', '1'],
    ['0', '1'],
    ['1', '1'],
  ],
  coefficients: [[['-2', '1']], [], [['1', '1']]],
  expected: {
    coefficient: [['1', '1']],
    factors: [
      {
        coefficients: [
          [
            ['0', '1'],
            ['-1', '1'],
          ],
          [['1', '1']],
        ],
        multiplicity: 1,
      },
      {
        coefficients: [
          [
            ['0', '1'],
            ['1', '1'],
          ],
          [['1', '1']],
        ],
        multiplicity: 1,
      },
    ],
  },
};
const a = ['AlgebraicGenerator', ['List', -2, 0, 1]];
test('public expression decoding independently reconstructs factors in the requested field', () => {
  verify(
    c,
    decodePublicFactor(c.modulus, [
      'Multiply',
      ['Add', 'x', a],
      ['Subtract', 'x', a],
    ])
  );
});
test('public verification rejects a wrong factor or different field', () => {
  assert.throws(() =>
    verify(c, decodePublicFactor(c.modulus, ['Add', ['Power', 'x', 2], 2]))
  );
  assert.throws(
    () =>
      decodePublicFactor(c.modulus, ['AlgebraicGenerator', ['List', -3, 0, 1]]),
    /field/
  );
  assert.throws(
    () => decodePublicFactor(c.modulus, ['Factor', 'x', 'x', a]),
    /Unsupported/
  );
});
test('an unchanged irreducible expression is still verified against the oracle', () => {
  const irreducible: Case = {
    ...c,
    coefficients: [[['1', '1']], [], [['1', '1']]],
    expected: {
      coefficient: [['1', '1']],
      factors: [
        { coefficients: [[['1', '1']], [], [['1', '1']]], multiplicity: 1 },
      ],
    },
  };
  verify(
    irreducible,
    decodePublicFactor(c.modulus, ['Add', 1, ['Power', 'x', 2]])
  );
});
