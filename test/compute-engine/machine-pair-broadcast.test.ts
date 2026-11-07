import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// A SUM, A DIFFERENCE, A PRODUCT OR A QUOTIENT OF TWO LONG LISTS OF MACHINE
// NUMBERS IS COMPUTED ON DOUBLES
//
// The coordinates of a list of points (`PointX(L)`, `PointY(L)`) are lists of
// machine numbers. A sum or a product of two such lists, and a quotient that
// has such a list as an operand, are computed at once on doubles when each
// list has more than a hundred elements and the engine is at machine
// precision. The answer is a list that holds its numbers unboxed.
//
// The contract these tests hold: every element is the value, exactness
// included, that the same operation gives on the two scalar elements. A case
// where the doubles could give another value keeps the route that computes
// the elements one by one.
//

const N = 300;
let seed = 13579;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
/** Floats with no zero and no integer value. */
function floats(scale: number): number[] {
  return Array.from({ length: N }, () => {
    const x = (random() + 0.01) * scale;
    return random() < 0.5 ? -x : x;
  });
}
const XS = floats(100);
const YS = floats(0.01);

function engine(xs: number[], ys: number[]): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('L', 'list<tuple<real, real>>');
  ce.assign('L', ce.box(['List', ...xs.map((x, i) => ['Tuple', x, ys[i]])]));
  return ce;
}

const X = ['PointX', 'L'];
const Y = ['PointY', 'L'];

/** Does this list hold its numbers unboxed? */
function isUnboxedList(x: Expression): boolean {
  return (
    x.operator === 'List' &&
    (x as unknown as { _numericStore?: unknown })._numericStore !== undefined
  );
}

/** Each element as its MathJSON and its exactness. */
function cells(x: Expression): [unknown, boolean][] {
  return [...x.each()].map((el) => [el.json, el.isExact]);
}

/** The scalar operation on each pair of elements, as `cells()` gives it. */
function scalarCells(
  ce: ComputeEngine,
  op: (x: number, y: number) => unknown[],
  xs: number[],
  ys: number[]
): [unknown, boolean][] {
  return xs.map((x, i) => {
    const v = ce.box(op(x, ys[i]) as never).evaluate();
    return [v.json, v.isExact];
  });
}

describe('two lists of floats', () => {
  const ce = engine(XS, YS);
  test.each([
    ['X + Y', ['Add', X, Y], (x: number, y: number) => ['Add', x, y]],
    ['X - Y', ['Subtract', X, Y], (x: number, y: number) => ['Subtract', x, y]],
    ['X·Y', ['Multiply', X, Y], (x: number, y: number) => ['Multiply', x, y]],
    ['X / Y', ['Divide', X, Y], (x: number, y: number) => ['Divide', x, y]],
    ['X / 2.5', ['Divide', X, 2.5], (x: number) => ['Divide', x, 2.5]],
    ['3 / X', ['Divide', 3, X], (x: number) => ['Divide', 3, x]],
    ['X / -0.5', ['Divide', X, -0.5], (x: number) => ['Divide', x, -0.5]],
  ])('%s is the scalar operation on each element', (_l, json, op) => {
    const result = ce.box(json as never).evaluate();
    expect(isUnboxedList(result)).toBe(true);
    expect(cells(result)).toEqual(scalarCells(ce, op, XS, YS));
  });

  test('N() gives the values of the elements', () => {
    for (const json of [
      ['Add', X, Y],
      ['Multiply', X, Y],
    ]) {
      const result = ce.box(json as never).N();
      expect(cells(result)).toEqual(
        cells(ce.box(json as never).evaluate())
      );
    }
  });

  test('a division by a list with a zero element is not computed on doubles', () => {
    const ys = [...YS];
    ys[7] = 0;
    const ce0 = engine(XS, ys);
    const result = ce0.box(['Divide', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(false);
  });
});

describe('exact integers', () => {
  const ints = Array.from({ length: N }, () =>
    Math.floor((random() - 0.5) * 200)
  );
  const divisors = Array.from({ length: N }, () => 1 + Math.floor(random() * 9));

  test('a quotient that divides is an exact integer', () => {
    const ce = engine(
      ints.map((n, i) => n * divisors[i]),
      divisors
    );
    const result = ce.box(['Divide', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(true);
    expect(cells(result)).toEqual(ints.map((n) => [n === 0 ? 0 : n, true]));
  });

  test('a quotient that does not divide is an exact rational', () => {
    const ce = engine(
      ints.map((n, i) => n * divisors[i] + (divisors[i] > 1 ? 1 : 0)),
      divisors
    );
    const result = ce.box(['Divide', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    const xs = ints.map((n, i) => n * divisors[i] + (divisors[i] > 1 ? 1 : 0));
    expect(cells(result)).toEqual(
      scalarCells(ce, (x, y) => ['Divide', x, y], xs, divisors)
    );
  });

  test('a sum and a product of integers are exact integers', () => {
    const ce = engine(ints, divisors);
    for (const [json, op] of [
      [['Add', X, Y], (x: number, y: number) => ['Add', x, y]],
      [['Multiply', X, Y], (x: number, y: number) => ['Multiply', x, y]],
    ] as const) {
      const result = ce.box(json as never).evaluate();
      expect(isUnboxedList(result)).toBe(true);
      expect(cells(result)).toEqual(scalarCells(ce, op, ints, divisors));
    }
  });
});

describe('an exact zero factor', () => {
  // `0 · 2.5` is the exact `0`, not the float `0`, also on doubles.
  const xs = XS.map((x, i) => (i % 10 === 3 ? 0 : x));

  test('in a product of two coordinates', () => {
    const ce = engine(xs, YS);
    const result = ce.box(['Multiply', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(true);
    expect(cells(result)).toEqual(
      scalarCells(ce, (x, y) => ['Multiply', x, y], xs, YS)
    );
    expect([...result.each()][3].isExact).toBe(true);
  });

  test('in a product of two symbols that hold lists, and by a float', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('A', { value: ce.box(['List', ...xs]) });
    ce.declare('B', { value: ce.box(['List', ...YS]) });
    for (const [json, op] of [
      [['Multiply', 'A', 'B'], (x: number, y: number) => ['Multiply', x, y]],
      [['Multiply', 2.5, 'A'], (x: number) => ['Multiply', 2.5, x]],
      // Three factors: a product by 2 is exact in every order, so the
      // order of the fold does not change the last digit.
      [
        ['Multiply', 2, 'A', 'B'],
        (x: number, y: number) => ['Multiply', 2, x, y],
      ],
    ] as const) {
      const result = ce.box(json as never).evaluate();
      expect(isUnboxedList(result)).toBe(true);
      expect(cells(result)).toEqual(scalarCells(ce, op, xs, YS));
      expect([...result.each()][3].isExact).toBe(true);
    }
  });

  test('a zero divided by a float is a float', () => {
    const ce = engine(xs, YS);
    const result = ce.box(['Divide', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(true);
    expect(cells(result)).toEqual(
      scalarCells(ce, (x, y) => ['Divide', x, y], xs, YS)
    );
    expect([...result.each()][3].isExact).toBe(false);
  });
});

describe('lists of two lengths', () => {
  test.each(['Add', 'Multiply', 'Divide'])(
    '%s of lists of 300 and 250 elements is an error',
    (operator) => {
      const ce = new ComputeEngine();
      ce.precision = 'machine';
      ce.declare('A', { value: ce.box(['List', ...XS]) });
      ce.declare('B', { value: ce.box(['List', ...YS.slice(0, 250)]) });
      const result = ce.box([operator, 'A', 'B'] as never).evaluate();
      expect(result.operator).toBe('Error');
      expect(JSON.stringify(result.json)).toContain('incompatible-dimensions');
    }
  );
});

describe('the boundaries of the route', () => {
  test('lists of at most a hundred elements keep their boxed elements', () => {
    const ce = engine(XS.slice(0, 100), YS.slice(0, 100));
    const result = ce.box(['Add', X, Y] as never).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(cells(result)).toEqual(
      scalarCells(
        ce,
        (x, y) => ['Add', x, y],
        XS.slice(0, 100),
        YS.slice(0, 100)
      )
    );
  });

  test('above machine precision the elements are not computed on doubles', () => {
    const ce = engine(XS, YS);
    ce.precision = 30;
    const sum = ce.box(['Add', X, Y] as never).evaluate();
    expect(isUnboxedList(sum)).toBe(false);
    expect(cells(sum)).toEqual(
      scalarCells(ce, (x, y) => ['Add', x, y], XS, YS)
    );
    // The quotient is not compared with the scalar quotient: at this
    // precision, a number written in an expression is a big decimal of its
    // shortest decimal form, but the list holds the double, so the two
    // quotients differ in the last digits.
    const quotient = ce.box(['Divide', X, Y] as never).evaluate();
    expect(isUnboxedList(quotient)).toBe(false);
  });
});
