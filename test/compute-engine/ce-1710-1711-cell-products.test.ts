/**
 * Under `.N()`, each cell of a product with a list or a tuple is the
 * numeric value of the scalar product of the same factors.
 *
 * - CE-1710: at machine precision, a fraction times a list of floats rounded
 *   the fraction first: `(2/3)·[81.67574227865587]` was one ulp off.
 * - CE-1711: a list or a tuple that mixes exact cells with other cells was
 *   rounded cell by cell first: `3·[1/3, 0.5]` gave `0.999…9`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression as Json } from '../../src/math-json/types';

const cellsOf = (ce: ComputeEngine, json: Json) =>
  (ce.box(json).N().json as unknown as unknown[]).slice(1);
const scalar = (ce: ComputeEngine, json: Json) => ce.box(json).N().json;

describe('CE-1710: a fraction times a list of floats, at machine precision', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';

  test('the witness', () => {
    expect(
      cellsOf(ce, [
        'Multiply',
        ['Rational', 2, 3],
        ['List', 81.67574227865587, 2.5],
      ])
    ).toEqual([54.45049485243725, 1.6666666666666667]);
  });

  test('every cell is the scalar product', () => {
    // A fixed pseudo-random sequence, so that a failure repeats.
    let seed = 1709;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const mismatches: string[] = [];
    for (let k = 0; k < 60; k++) {
      const q = 2 + Math.floor(random() * 40);
      const p = 1 + Math.floor(random() * (q - 1));
      const cells = [random() * 200 - 100, random() * 10, random() * 1e6];
      const fraction: Json = ['Rational', p, q];
      const list = cellsOf(ce, ['Multiply', fraction, ['List', ...cells]]);
      const matrix = (
        cellsOf(ce, [
          'Multiply',
          fraction,
          ['List', ['List', ...cells]],
        ])[0] as unknown[]
      ).slice(1);
      cells.forEach((x, i) => {
        const expected = scalar(ce, ['Multiply', fraction, x]);
        if (list[i] !== expected || matrix[i] !== expected)
          mismatches.push(
            `${p}/${q}·${x}: ${list[i]}, ${matrix[i]} vs ${expected}`
          );
      });
    }
    expect(mismatches).toEqual([]);
  });
});

describe('CE-1711: a list or tuple that mixes exact cells with other cells', () => {
  // Beside an exact radical factor (`√2`) the cells are rounded first, as
  // before: CE-1715 records the digits of that case at this precision.
  const ce = new ComputeEngine();

  test.each([
    ['a float cell', ['Multiply', 3, ['List', ['Rational', 1, 3], 0.5]]],
    ['a symbol cell', ['Multiply', 3, ['List', ['Rational', 1, 3], 'x']]],
    ['NaN', ['Multiply', 3, ['List', ['Rational', 1, 3], 'NaN']]],
    [
      'a complex cell',
      ['Multiply', ['Rational', 1, 3], ['List', ['Complex', 3, 6], 2]],
    ],
    [
      'a tuple of fractions',
      ['Multiply', 3, ['Tuple', ['Rational', 1, 3], ['Rational', 2, 3]]],
    ],
    [
      'a π factor',
      ['Multiply', 'Pi', ['List', ['Rational', 1, 3], ['Rational', 2, 7]]],
    ],
    [
      'an exact complex factor',
      ['Multiply', ['Complex', 2, 5], ['List', ['Rational', 1, 3], 0.5]],
    ],
    [
      'a float factor',
      ['Multiply', 0.5, ['List', ['Rational', 1, 3], ['Rational', 2, 7]]],
    ],
    [
      'a matrix',
      [
        'Multiply',
        3,
        ['List', ['List', ['Rational', 1, 3], 0.25], ['List', 2, 'Pi']],
      ],
    ],
  ] as const)('%s: each cell is the scalar product', (_, json) => {
    const [, ...factors] = json as unknown as Json[];
    const container = factors.find(
      (f) => Array.isArray(f) && (f[0] === 'List' || f[0] === 'Tuple')
    ) as unknown[];
    const others = factors.filter((f) => f !== container);
    const expected = (cell: Json): unknown =>
      Array.isArray(cell) && cell[0] === 'List'
        ? ['List', ...(cell.slice(1) as Json[]).map(expected)]
        : scalar(ce, ['Multiply', ...others, cell]);
    expect(ce.box(json as Json).N().json).toEqual([
      container[0],
      ...(container.slice(1) as Json[]).map(expected),
    ]);
  });

  test('the witness', () => {
    expect(
      ce.box(['Multiply', 3, ['List', ['Rational', 1, 3], 0.5]]).N().json
    ).toEqual(['List', 1, 1.5]);
  });

  test('a cell that is not exact is evaluated once', () => {
    let calls = 0;
    ce.declare('Tick', {
      signature: '() -> real',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.number(0.5);
      },
    });
    const product = ce.box([
      'Multiply',
      3,
      ['List', ['Rational', 1, 3], ['Tick']],
    ]);
    calls = 0;
    expect(product.N().json).toEqual(['List', 1, 1.5]);
    expect(calls).toBe(1);
  });

  test('a cell whose value is a sequence does not shift the exact cells', () => {
    // `[Empty(), 1/3, Two()]` has three cells and its value three cells:
    // `Empty()` is spliced out and `Two()` gives two.
    ce.declare('Empty', {
      signature: '() -> any',
      evaluate: () => ce.function('Sequence', []),
    });
    ce.declare('Two', {
      signature: '() -> any',
      evaluate: () => ce.function('Sequence', [ce.number(5), ce.number(7)]),
    });
    const list = ['List', ['Empty'], ['Rational', 1, 3], ['Two']];
    // The exact cell is not put back in another place: the product takes
    // the rounded cells, as before CE-1711 (a crafted case declines).
    const cells = ce.box(['Multiply', 3, list] as Json).N();
    expect(cells.nops).toBe(3);
    expect(cells.ops![0].re).toBeCloseTo(1, 15);
    expect(cells.ops![1].json).toBe(15);
    expect(cells.ops![2].json).toBe(21);
  });
});
