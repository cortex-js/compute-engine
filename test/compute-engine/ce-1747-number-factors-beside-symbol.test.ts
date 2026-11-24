/**
 * CE-1747: under `.N()`, the number factors of a product with a symbolic
 * factor are folded into one coefficient with the exact rationals, as the
 * product of the number factors alone is. With the rounded `1/3`,
 * `N((1/3)·√-2·x)` gave `0.471404520791031682933i·x`, where `N(√-2/3)` gives
 * `0.471404520791031682934i`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression as Json } from '../../src/math-json/types';

const n = (ce: ComputeEngine, json: Json) => ce.box(json).N().json;

describe('CE-1747: number factors beside a symbol, at the default precision', () => {
  const ce = new ComputeEngine();
  const cases: [string, Json[]][] = [
    [
      'the witness',
      [
        ['Rational', 1, 3],
        ['Sqrt', -2],
      ],
    ],
    [
      'a fraction and a sine',
      [
        ['Rational', 1, 3],
        ['Sin', 1],
      ],
    ],
    ['a fraction and π', [['Rational', 1, 3], 'Pi']],
    ['a fraction and a float', [['Rational', 2, 3], 81.67574227865587]],
  ];
  test.each(cases)('%s', (_, numbers) => {
    expect(n(ce, ['Multiply', ...numbers, 'x'])).toEqual([
      'Multiply',
      n(ce, ['Multiply', ...numbers]),
      'x',
    ]);
  });

  test('the value of the witness', () => {
    expect(n(ce, ['Multiply', ['Rational', 1, 3], ['Sqrt', -2], 'x'])).toEqual([
      'Multiply',
      ['Complex', 0, { num: '0.47140452079103168293389633' }],
      'x',
    ]);
  });

  test('a reciprocal symbol keeps a float coefficient', () => {
    expect(
      n(ce, ['Multiply', ['Rational', 1, 3], ['Sin', 1], ['Divide', 1, 'x']])
    ).toEqual([
      'Divide',
      n(ce, ['Multiply', ['Rational', 1, 3], ['Sin', 1]]),
      'x',
    ]);
  });
});

describe('CE-1747: number factors beside a symbol, at machine precision', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  test('a fraction and a float', () => {
    expect(
      n(ce, ['Multiply', ['Rational', 2, 3], 81.67574227865587, 'x'])
    ).toEqual(['Multiply', 54.45049485243725, 'x']);
  });
});
