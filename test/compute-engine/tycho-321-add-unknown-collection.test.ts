import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

// Tycho item 321. When an `unknown` symbol is an operand of arithmetic that
// is the argument of a parameter which accepts a matrix (the `collection<any>`
// data parameter of `Histogram`), bottom-up inference first types the symbol
// `number`, and then the matrix inference repair in `validate.ts` retypes it
// `matrix` if the arithmetic has a plan for it. The plan accepted a scalar
// factor of a `Multiply` but no scalar term of an `Add`, and had no branch for
// `Divide`, so `P + 0.5` and `(P - 0.5)/√(…)` kept `P: number` and the
// argument was an `incompatible-type` error.

const MIX: MathJsonExpression = [
  'Add',
  ['Multiply', ['Delimiter', ['Subtract', 1, 'v']], 'P_0'],
  ['Multiply', 'v', 'P_1'],
];

const CASES: [string, MathJsonExpression][] = [
  ['Histogram(P_0, 1/100)', ['Histogram', 'P_0', ['Divide', 1, 100]]],
  ['Histogram(mix, 1/100)', ['Histogram', MIX, ['Divide', 1, 100]]],
  [
    'Histogram(0.5 + (mix - 0.5)/sqrt(...), 1/100)',
    [
      'Histogram',
      [
        'Add',
        0.5,
        [
          'Divide',
          ['Subtract', MIX, 0.5],
          [
            'Sqrt',
            [
              'Add',
              ['Power', ['Delimiter', ['Subtract', 1, 'v']], 2],
              ['Power', 'v', 2],
            ],
          ],
        ],
      ],
      ['Divide', 1, 100],
    ],
  ],
  [
    'Histogram(P_0 + 0.5, 1/100)',
    ['Histogram', ['Add', 'P_0', 0.5], ['Divide', 1, 100]],
  ],
  [
    'Histogram(P_0 / 2, 1/100)',
    ['Histogram', ['Divide', 'P_0', 2], ['Divide', 1, 100]],
  ],
  [
    'Histogram(2 P_0, 1/100)',
    ['Histogram', ['Multiply', 2, 'P_0'], ['Divide', 1, 100]],
  ],
];

/** The type of the first occurrence of the symbol `name` in `e`. Boxing
 * declares nothing, so the type of a use is read on its occurrence. */
function occurrenceType(e: Expression, name: string): string | undefined {
  if (e.symbol === name) return e.type.toString();
  for (const op of e.ops ?? []) {
    const found = occurrenceType(op, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

function freshEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P_0', 'unknown');
  ce.declare('P_1', 'unknown');
  ce.declare('v', 'real');
  return ce;
}

describe('Tycho 321: arithmetic over an unknown symbol in a collection slot', () => {
  test.each(CASES)('%s is valid', (_name, json) => {
    const ce = freshEngine();
    const expr = ce.box(json);
    expect(expr.isValid).toBe(true);
    expect(
      ce.type(occurrenceType(expr, 'P_0')!).matches('collection<any>')
    ).toBe(true);
  });

  test('a scalar term of the sum gives P_0 the same type as a scalar factor', () => {
    const ce1 = freshEngine();
    const e1 = ce1.box(['Histogram', ['Add', 'P_0', 0.5], ['Divide', 1, 100]]);
    const ce2 = freshEngine();
    const e2 = ce2.box(['Histogram', ['Multiply', 2, 'P_0'], ['Divide', 1, 100]]);
    expect(occurrenceType(e1, 'P_0')).toBe('list<number>');
    expect(occurrenceType(e2, 'P_0')).toBe('list<number>');
  });

  // Only a CONSTANT term of a sum is taken as a scalar. A term with a free
  // variable is not, so that `Det(A + B)` stays invalid after an earlier
  // `A + 1` inferred `A: number` (pinned as P2 in
  // `matrix-operator-typing.test.ts`). A declared real term is therefore not
  // repaired either.
  test('a sum with a declared real term is not repaired', () => {
    const ce = freshEngine();
    const expr = ce.box(['Histogram', ['Subtract', 'P_0', 'v'], 2]);
    expect(expr.isValid).toBe(false);
    expect(occurrenceType(expr, 'P_0')).toBe('number');
  });

  test('a denominator with a declared real symbol is a scalar', () => {
    const ce = freshEngine();
    const expr = ce.box([
      'Histogram',
      ['Divide', ['Add', 'P_0', 1], ['Sqrt', ['Add', ['Power', 'v', 2], 1]]],
      2,
    ]);
    expect(expr.isValid).toBe(true);
    expect(occurrenceType(expr, 'P_0')).toBe('list<number>');
  });

  test('a matrix-consuming operator gets the same repair: Determinant(A + 1)', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'unknown');
    const expr = ce.box(['Determinant', ['Add', 'A', 1]]);
    expect(expr.isValid).toBe(true);
    expect(occurrenceType(expr, 'A')).toBe('matrix');
  });

  test('a term with the symbol but no plan still fails closed', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'unknown');
    const expr = ce.box(['Determinant', ['Add', 'A', ['Sin', 'A']]]);
    expect(expr.isValid).toBe(false);
    expect(occurrenceType(expr, 'A')).toBe('number');
  });

  test('a denominator with the symbol is not a scalar', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'unknown');
    const expr = ce.box(['Determinant', ['Divide', 1, 'A']]);
    expect(expr.isValid).toBe(false);
  });

  test('outside a collection slot, x + 1 still types x as number', () => {
    for (const json of [
      ['Add', 'x', 1],
      ['Add', 'x', 0.5],
      ['Subtract', 'x', 1],
      ['Divide', 'x', 2],
    ] as MathJsonExpression[]) {
      const ce = new ComputeEngine();
      ce.declare('x', 'unknown');
      const expr = ce.box(json);
      expect(expr.isValid).toBe(true);
      expect(occurrenceType(expr, 'x')).toBe('number');
    }
  });
});
