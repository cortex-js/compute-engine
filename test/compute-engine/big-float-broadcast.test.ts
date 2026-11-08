import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// ELEMENT-WISE ARITHMETIC OVER LISTS OF FLOATS ABOVE MACHINE PRECISION
//
// Above machine precision, `Add` and `Multiply` of two operands and `Negate`
// over lists of floats are computed at once on big decimals
// (`bigFloatBroadcast()`, `boxed-expression/machine-broadcast.ts`) and
// answered as an ordinary `List` of big-number floats. Without this route, a
// broadcast over more than a hundred elements answers a lazy `Map`, and a
// consumer such as `Min` computes each element with a function application.
//
// The contract these tests hold: each element is the value, exactness
// included, that the interpreter computes for the same operation on the
// scalar operands. A case where the big decimals could give another value
// takes the route it took before.
//

const N = 150;
let seed = 1234567;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

/** Floats of many magnitudes, with some zeros and some integer values. */
function randomValue(): number {
  const r = random();
  if (r < 0.05) return 0;
  if (r < 0.1) return Math.round(random() * 20 - 10);
  if (r < 0.15) return Math.round(random() * 40 - 20) / 4;
  if (r < 0.2) return (random() - 0.5) * 10 ** Math.round(random() * 600 - 300);
  return (random() - 0.5) * 10 ** Math.round(random() * 10 - 5);
}

const VALUES_A = Array.from({ length: N }, randomValue);
const VALUES_B = Array.from({ length: N }, randomValue);

/** A list of the values: an integer value is an exact integer, unless
 * `floats` is set, in which case every element is a float. */
function list(ce: ComputeEngine, values: number[], floats = false): Expression {
  return ce.function(
    'List',
    values.map((v) =>
      floats ? ce.number(ce._inexactNumericValue(v)) : ce.number(v)
    )
  );
}

/** A float with all the digits of its double. */
function float(ce: ComputeEngine): Expression {
  return ce.number(ce._inexactNumericValue(0.37731147124215664));
}

/** The elements of a finite collection: a list, or a lazy `Map`. */
function elementsOf(x: Expression): Expression[] {
  return [...x.each()];
}

/** The value and the exactness of a number, to compare two of them. */
function valueAndExactness(x: Expression): [unknown, boolean] {
  return [x.json, x.isExact];
}

/**
 * Compare each element of `op(…operands)` with `op` applied to the elements
 * of the operands, one at a time. A list operand gives its i-th element, a
 * scalar operand is the same in each cell. Returns the evaluated broadcast.
 */
function expectCellValues(
  ce: ComputeEngine,
  op: string,
  operands: Expression[],
  numeric = false
): Expression {
  const expr = ce.function(op, operands);
  const result = numeric ? expr.N() : expr.evaluate();
  const cells = elementsOf(result);
  expect(cells.length).toBe(N);
  const columns = operands.map((x) =>
    x.operator === 'List' ? elementsOf(x) : undefined
  );
  const actual = cells.map(valueAndExactness);
  const expected = cells.map((_, i) => {
    const args = operands.map((x, k) => columns[k]?.[i] ?? x);
    const cell = ce.function(op, args);
    return valueAndExactness(numeric ? cell.N() : cell.evaluate());
  });
  expect(actual).toEqual(expected);
  return result;
}

/**
 * Compare each element of the product of `symbols` (a symbol holds a list)
 * with the product of the elements of `values` (the lists that the symbols
 * hold), one at a time.
 */
function expectSymbolCellValues(
  ce: ComputeEngine,
  symbols: Expression[],
  values: Expression[]
): void {
  const result = ce.function('Multiply', symbols).evaluate();
  const cells = elementsOf(result);
  expect(cells.length).toBe(N);
  const columns = values.map((x) =>
    x.operator === 'List' ? elementsOf(x) : undefined
  );
  expect(cells.map(valueAndExactness)).toEqual(
    cells.map((_, i) =>
      valueAndExactness(
        ce
          .function(
            'Multiply',
            values.map((x, k) => columns[k]?.[i] ?? x)
          )
          .evaluate()
      )
    )
  );
}

describe('big-float broadcast: the values are the element-by-element values', () => {
  // The precision of the big decimals is global (`BigDecimal.precision`), and
  // the last engine made sets it, so each test makes its own engine.
  for (const precision of [21, 50]) {
    describe(`precision ${precision}`, () => {
      const cases: [
        string,
        string,
        (ce: ComputeEngine) => Expression[],
      ][] = [
        [
          'a list of floats plus an integer',
          'Add',
          (ce) => [list(ce, VALUES_A, true), ce.number(2)],
        ],
        [
          'an integer plus a list of floats',
          'Add',
          (ce) => [ce.number(2), list(ce, VALUES_A, true)],
        ],
        ['a list plus a float', 'Add', (ce) => [list(ce, VALUES_A), float(ce)]],
        [
          'a list plus an integer-valued float',
          'Add',
          (ce) => [list(ce, VALUES_A), ce.number(ce._inexactNumericValue(3))],
        ],
        [
          'two lists',
          'Add',
          (ce) => [list(ce, VALUES_A), list(ce, VALUES_B, true)],
        ],
        [
          'two lists with exact integers',
          'Add',
          (ce) => [list(ce, VALUES_A), list(ce, VALUES_B)],
        ],
        [
          'an integer times a list of floats',
          'Multiply',
          (ce) => [ce.number(-2), list(ce, VALUES_A, true)],
        ],
        [
          'a float times a list',
          'Multiply',
          (ce) => [float(ce), list(ce, VALUES_A)],
        ],
        [
          'a list times a float',
          'Multiply',
          (ce) => [list(ce, VALUES_A), float(ce)],
        ],
        [
          'two lists',
          'Multiply',
          (ce) => [list(ce, VALUES_A, true), list(ce, VALUES_B)],
        ],
        [
          'the negation of a list of floats',
          'Negate',
          (ce) => [list(ce, VALUES_A, true)],
        ],
      ];
      for (const [name, op, operands] of cases) {
        for (const numeric of [false, true]) {
          test(`${op}: ${name}${numeric ? ', under N()' : ''}`, () => {
            const ce = new ComputeEngine();
            ce.precision = precision;
            expectCellValues(ce, op, operands(ce), numeric);
          });
        }
      }
    });
  }

  test('a scalar with more digits than a double', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const third = ce.box(['Divide', 1, 3]).N();
    const a = list(ce, VALUES_A, true);
    expectCellValues(ce, 'Multiply', [third, a]);
    expectCellValues(ce, 'Add', [a, third]);
  });

  test('elements with more digits than a double', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const third = ce.box(['Divide', 1, 3]).N();
    const a = ce.function(
      'List',
      VALUES_A.map((v) => ce.box(['Add', third, v]).N())
    );
    expectCellValues(ce, 'Add', [a, ce.number(2)]);
    expectCellValues(ce, 'Negate', [a]);
  });

  // A sum keeps the digits of its operands, past twice the working precision.
  // A product rounds there, except a product with a factor `±1`, which is the
  // other factor with all its digits.
  test('a factor 1 or -1 keeps more digits than a product', () => {
    const ce = new ComputeEngine();
    ce.precision = 21;
    const third = ce.box(['Divide', 1, 3]).N();
    const long = ce.function(
      'List',
      VALUES_A.map((_, i) =>
        ce.box(['Add', third, ['Multiply', i + 1, ['Power', 10, -90]]]).N()
      )
    );
    // More digits than a product keeps at this precision (2·21 + 20).
    expect(
      JSON.stringify(long.ops![0].json).replace(/[^0-9]/g, '').length
    ).toBeGreaterThan(62);
    // A product with a symbol that holds the list is a broadcast over the
    // elements. (A product with the list itself takes a packed tensor, whose
    // cells are the boxed elements when a double does not hold their digits,
    // so it keeps these digits too.)
    ce.declare('B', { value: long });
    ce.declare('Ones', {
      value: ce.function(
        'List',
        VALUES_A.map(() => ce.number(1))
      ),
    });
    const one = ce.number(ce._inexactNumericValue(1));
    const minusOne = ce.number(ce._inexactNumericValue(-1));
    expectSymbolCellValues(ce, [ce.symbol('B'), one], [long, one]);
    expectSymbolCellValues(ce, [minusOne, ce.symbol('B')], [minusOne, long]);
    expectSymbolCellValues(
      ce,
      [ce.symbol('B'), ce.symbol('Ones')],
      [long, ce.symbol('Ones').value!]
    );
    const scalar = ce.box(['Add', third, ['Power', 10, -90]]).N();
    const units = list(
      ce,
      VALUES_A.map((_, i) => [1, -1, 2, 0.5][i % 4] as number)
    );
    expectCellValues(ce, 'Multiply', [scalar, units]);
  });

  test('floats made at machine precision, then a higher precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    const a = list(ce, VALUES_A, true);
    ce.precision = 21;
    expectCellValues(ce, 'Add', [a, ce.number(2)]);
    expectCellValues(ce, 'Multiply', [ce.number(-2), a]);
  });
});

describe('big-float broadcast: the answer', () => {
  test('a sum over a list of floats is an ordinary list', () => {
    const ce = new ComputeEngine();
    const result = ce
      .function('Add', [list(ce, VALUES_A, true), ce.number(2)])
      .evaluate();
    expect(result.operator).toBe('List');
    expect(
      (result as unknown as { _numericStore?: unknown })._numericStore
    ).toBeUndefined();
  });

  test('a product of an exact integer and a list of integers stays exact', () => {
    const ce = new ComputeEngine();
    const integers = VALUES_A.map((v) => Math.round(v * 1000) % 1000);
    const result = ce
      .function('Multiply', [ce.number(3), list(ce, integers)])
      .evaluate();
    expect(elementsOf(result).map((x) => [x.json, x.isExact])).toEqual(
      integers.map((k) => [3 * k === 0 ? 0 : 3 * k, true])
    );
  });

  test('a sum of integers above machine precision keeps the lazy form', () => {
    const ce = new ComputeEngine();
    const integers = VALUES_A.map((v) => Math.round(v * 1000) % 1000);
    ce.declare('K', { value: list(ce, integers) });
    const result = ce.box(['Add', 'K', 1]).evaluate();
    expect(result.operator).toBe('Map');
  });

  test('an exact zero factor gives the exact zero', () => {
    const ce = new ComputeEngine();
    const values = [0, ...VALUES_A.slice(1)];
    const result = expectCellValues(ce, 'Multiply', [
      ce.number(ce._inexactNumericValue(0.5)),
      list(ce, values),
    ]);
    expect(elementsOf(result)[0].isExact).toBe(true);
  });
});

describe('big-float broadcast: the minimum of a colour row', () => {
  // `Min(1, 2 − 2·z)` over the third coordinates of a list of points.
  test('Min over the broadcast', () => {
    const ce = new ComputeEngine();
    const points = VALUES_A.map((v, i) => [
      'Tuple',
      v,
      VALUES_B[i],
      Math.abs(VALUES_A[(i + 1) % N]) / 1e6 + 0.5,
    ]);
    ce.declare('C', { value: ce.box(['List', ...points] as never) });
    const inner = ce
      .box(['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]])
      .evaluate();
    expect(inner.operator).toBe('List');
    const minimum = ce
      .box(['Min', 1, ['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]]])
      .evaluate();
    let expected = ce.number(1);
    for (const p of points) {
      const z = ce
        .box(['Subtract', 2, ['Multiply', 2, p[3] as number]])
        .evaluate();
      if (z.isLess(expected)) expected = z;
    }
    expect(minimum.json).toEqual(expected.json);
  });
});
