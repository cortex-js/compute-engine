import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// ARITHMETIC ON LONG LISTS THAT HOLD COMPLEX NUMBERS IS COMPUTED AT ONCE
//
// With `X`, `Y` and `Z` the coordinates of a list of more than a hundred
// points, `i·Y`, `X + i·Y`, `Z / (X + i·Y)` and its conjugate are computed at
// once, one numeric value per element, at machine precision. The answer is
// an ordinary `List` of boxed numbers, not a lazy `Map`.
//
// The contract these tests hold: every element is the value, exactness and
// sign of zero included, that the route used before gives. One exception: a
// result equal to zero is compared without the sign of its zeros in the
// block "lists with float zeros", because the interpreter does not give a
// stable sign there (issue CE-1082). A list of at most
// a hundred points still takes that route, so the reference for each element
// is the same formula over a list of a hundred points: the 300 points are
// compared as three lists of 100.
//

const N = 300;
let seed = 24680;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
/** Random floats, and at positions that depend on `offset`, values that
 * test the special cases of the arithmetic: exact integers (`0`, `1`, `-1`,
 * `3`, `-2`), subnormal numbers and large numbers. */
function values(scale: number, offset: number): number[] {
  const xs = Array.from({ length: N }, () => (random() - 0.5) * scale);
  const special = [0, 1, -1, 3, 1e-310, -2.5e-320, 1e150, -3e140, 0.5, -2];
  special.forEach((x, k) => (xs[(7 * k + offset) % N] = x));
  return xs;
}
const XS = values(4, 3);
const YS = values(10, 5);
const ZS = values(0.1, 8);
// Points whose coordinates are both integers: `X + i·Y` is then an exact
// Gaussian integer (`2 - i`, `i`, `-3`).
[
  [150, 2, -1],
  [151, 0, 1],
  [152, -3, 0],
].forEach(([k, x, y]) => {
  XS[k] = x;
  YS[k] = y;
});

function points(from: number, to: number): unknown {
  return [
    'List',
    ...XS.slice(from, to).map((x, k) => ['Tuple', x, YS[from + k], ZS[from + k]]),
  ];
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('L', 'list<tuple<real, real, real>>');
  ce.assign('L', ce.box(points(0, N) as never));
  for (const k of [0, 1, 2]) {
    ce.declare(`L${k}`, 'list<tuple<real, real, real>>');
    ce.assign(`L${k}`, ce.box(points(100 * k, 100 * (k + 1)) as never));
  }
  return ce;
}

/** The formula with the symbol `L` replaced by `name`. */
function over(json: unknown, name: string): unknown {
  if (json === 'L') return name;
  if (Array.isArray(json)) return json.map((x) => over(x, name));
  return json;
}

/** The real part, the imaginary part and the exactness of a number, with
 * the sign of zero. */
function parts(x: Expression): string {
  const nv = x.numericValue;
  if (nv === undefined) return x.toString();
  const [re, im] = typeof nv === 'number' ? [nv, 0] : [nv.re, nv.im];
  const s = (v: number) => (Object.is(v, -0) ? '-0' : String(v));
  return `${s(re)} ${s(im)} ${x.isExact ? 'exact' : 'float'}`;
}

/**
 * The operator of the evaluated formula, the number of its elements that
 * differ from the elements of the same formula over the lists of 100
 * points, and the first difference.
 */
function compare(
  ce: ComputeEngine,
  json: unknown
): { operator: string; differences: number; first?: string } {
  const value = (x: unknown) => ce.box(x as never).evaluate();
  const result = value(json);
  const cells = [...result.each()].map(parts);
  const expected = [0, 1, 2].flatMap((k) =>
    [...value(over(json, `L${k}`)).each()].map(parts)
  );
  let differences = 0;
  let first: string | undefined = undefined;
  for (let i = 0; i < N; i++) {
    if (cells[i] === expected[i]) continue;
    differences += 1;
    first ??= `${i}: ${cells[i]} vs ${expected[i]}`;
  }
  return { operator: result.operator, differences, first };
}

const X = ['PointX', 'L'];
const Y = ['PointY', 'L'];
const Z = ['PointZ', 'L'];
const IY = ['Multiply', 'ImaginaryUnit', Y];
const W = ['Add', X, IY];
const V = ['Add', Z, ['Multiply', 'ImaginaryUnit', X]];

describe('lists that hold complex numbers', () => {
  const ce = engine();
  test.each([
    ['i·Y', IY],
    ['Y·i', ['Multiply', Y, 'ImaginaryUnit']],
    ['(2 - i)·Y', ['Multiply', ['Complex', 2, -1], Y]],
    ['2.5i·Y', ['Multiply', ['Complex', 0, 2.5], Y]],
    ['X + i·Y', W],
    ['X - i·Y', ['Subtract', X, IY]],
    ['-(i·Y)', ['Negate', IY]],
    ['-(X + i·Y)', ['Negate', W]],
    ['Z / (X + i·Y)', ['Divide', Z, W]],
    ['(X + i·Y) / Z', ['Divide', W, Z]],
    ['1 / (X + i·Y)', ['Divide', 1, W]],
    ['Conjugate(X + i·Y)', ['Conjugate', W]],
    ['Conjugate(Z / (X + i·Y))', ['Conjugate', ['Divide', Z, W]]],
    ['(X + i·Y)·(Z + i·X)', ['Multiply', W, V]],
    ['(X + i·Y)·Conjugate(X + i·Y)', ['Multiply', W, ['Conjugate', W]]],
    ['(X + i·Y) / (Z + i·X)', ['Divide', W, V]],
    ['2.5·(X + i·Y)', ['Multiply', 2.5, W]],
    ['3·(X + i·Y)', ['Multiply', 3, W]],
    ['(X + i·Y) / 4', ['Divide', W, 4]],
    ['(X + i·Y) + (Z + i·X)', ['Add', W, V]],
  ])('%s: each element is the value of the route used before', (_, json) => {
    expect(compare(ce, json)).toEqual({
      operator: 'List',
      differences: 0,
      first: undefined,
    });
  });

});

describe('lists with float zeros', () => {
  // Floats `0.0` and `-0.0`, and complex floats with a zero part: the sign of
  // a zero result of the operations on numeric values can differ from the
  // interpreter's, and such a cell is computed as before. The zeros are one
  // cell in ten: above one cell in eight, the broadcast keeps its lazy `Map`.
  const M = 150;
  function element(ce: ComputeEngine, k: number): Expression {
    const kind = k % 20;
    const x = (random() - 0.5) * 4;
    const value =
      kind === 0
        ? 0
        : kind === 1
          ? -0
          : kind === 2
            ? { re: -0, im: x }
            : kind === 3
              ? { re: x, im: -0 }
              : { re: x, im: (random() - 0.5) * 4 };
    const factory = (
      ce as unknown as { _inexactNumericValue: (v: unknown) => never }
    )._inexactNumericValue;
    return ce.number(factory(value));
  }
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  for (const [name, offset] of [
    ['A', 0],
    ['B', 3],
    // The zeros of `C` are at the positions of the zeros of `A`.
    ['C', 0],
  ] as const) {
    const elements = Array.from({ length: M }, (_, k) =>
      element(ce, k + offset)
    );
    ce.assign(name, ce.function('List', elements));
    ce.assign(`${name}0`, ce.function('List', elements.slice(0, 75)));
    ce.assign(`${name}1`, ce.function('List', elements.slice(75)));
  }
  /** The formula over `A`, `B` and `C` against the formula over the lists of
   * 75 elements (`A0`, `B0`, `C0`, then `A1`, `B1`, `C1`). */
  function differences(json: unknown): string[] {
    const rename = (x: unknown, suffix: string): unknown =>
      x === 'A' || x === 'B' || x === 'C'
        ? `${x}${suffix}`
        : Array.isArray(x)
          ? x.map((y) => rename(y, suffix))
          : x;
    // A result equal to zero is compared without the sign of its zeros: the
    // interpreter does not give a stable sign there (`Negate(0.0)` is `0`
    // for one element and `-0` for another element of the same value,
    // depending on what was evaluated before). Every other cell keeps the
    // sign of a zero part.
    const zero = (x: Expression) => {
      const nv = x.numericValue;
      return typeof nv === 'number' ? nv === 0 : nv?.isZero === true;
    };
    const cells = (x: unknown) =>
      [...ce.box(x as never).evaluate().each()].map((c) =>
        zero(c) ? `zero ${c.isExact ? 'exact' : 'float'}` : parts(c)
      );
    const expected = [...cells(rename(json, '0')), ...cells(rename(json, '1'))];
    return cells(json).flatMap((c, i) =>
      c === expected[i] ? [] : [`${i}: ${c} vs ${expected[i]}`]
    );
  }
  test.each([
    ['A / B', ['Divide', 'A', 'B']],
    ['B / A', ['Divide', 'B', 'A']],
    ['A·B', ['Multiply', 'A', 'B']],
    ['A + B', ['Add', 'A', 'B']],
    ['A / C', ['Divide', 'A', 'C']],
    ['C / A', ['Divide', 'C', 'A']],
    ['A·C', ['Multiply', 'A', 'C']],
    ['-0.5·A', ['Multiply', -0.5, 'A']],
    ['(1.5 - 2.5i)·A', ['Multiply', ['Complex', 1.5, -2.5], 'A']],
    ['-A', ['Negate', 'A']],
    ['Conjugate(A)', ['Conjugate', 'A']],
  ])('%s: each element is the value of the route used before', (_, json) => {
    expect(differences(json)).toEqual([]);
  });

  test('-A, Conjugate(A) and A / C are computed at once, with the zero cells by the interpreter', () => {
    expect(ce.box(['Negate', 'A']).evaluate().operator).toBe('List');
    expect(ce.box(['Conjugate', 'A']).evaluate().operator).toBe('List');
    expect(ce.box(['Divide', 'A', 'C']).evaluate().operator).toBe('List');
  });

  test('a float 0.0 divided by a complex float is the zero of the interpreter, +0', () => {
    // `div()` gives `-0` for the real part of `0.0 / (-1.25 - 0.75i)`, and
    // the interpreter gives `+0`: such a cell is computed by the interpreter.
    const w = ['Complex', -1.25, -0.75];
    const elements = Array.from({ length: 150 }, (_, k) =>
      element(ce, k % 20 === 0 ? 4 : k)
    );
    // The float `0.0` (`element()` of kind 0).
    elements[7] = element(ce, 0);
    ce.assign('D', ce.function('List', elements));
    const result = ce.box(['Divide', 'D', w]).evaluate();
    expect(result.operator).toBe('List');
    const cell = result.ops![7];
    const expected = ce._fn('Divide', [elements[7], ce.box(w)]).evaluate();
    expect(parts(cell)).toBe(parts(expected));
    expect(parts(cell)).toBe('0 0 float');
  });

  test('A / B keeps its lazy Map: one cell in five is a zero dividend or divisor', () => {
    expect(ce.box(['Divide', 'A', 'B']).evaluate().operator).toBe('Map');
  });
});

describe('the result is computed at once', () => {
  test.each([
    ['Z / (X + i·Y)', ['Divide', Z, W]],
    ['Conjugate(Z / (X + i·Y))', ['Conjugate', ['Divide', Z, W]]],
    ['-(X + i·Y)', ['Negate', W]],
  ])('%s is a List of 300 numbers, not a lazy Map', (_, json) => {
    const result = engine()
      .box(json as never)
      .evaluate();
    expect(result.operator).toBe('List');
    expect(result.nops).toBe(N);
  });
});

describe('the cases that keep the route used before', () => {
  function listOf(
    precision: number | 'machine',
    elements: unknown[]
  ): ComputeEngine {
    const ce = new ComputeEngine();
    ce.precision = precision;
    ce.assign('A', ce.box(['List', ...elements] as never));
    return ce;
  }
  const complexes = (n: number) =>
    Array.from({ length: n }, (_, k) => ['Complex', k + 0.5, 1.25 - k]);

  test('under N(), the quotient is still a lazy Map', () => {
    const result = engine()
      .box(['Divide', Z, W] as never)
      .N();
    expect(result.operator).toBe('Map');
  });

  test('a list with an exact rational is still a lazy Map', () => {
    const elements = complexes(150);
    elements[5] = ['Rational', 1, 3] as never;
    const ce = listOf('machine', elements);
    const result = ce.box(['Divide', 1, 'A']).evaluate();
    expect(result.operator).toBe('Map');
    // `at()` counts from 1: the element of index 6.
    expect(result.at(7)!.evaluate().toString()).toBe(
      ce.box(['Divide', 1, ['Complex', 6.5, -4.75]]).evaluate().toString()
    );
  });

  test('a product of a complex float and a list with an exact 0', () => {
    // The product keeps the route of a list of 100 elements, which answers
    // the exact `0` for the element `0`.
    const elements: unknown[] = complexes(150);
    elements[9] = 0;
    const ce = listOf('machine', elements);
    ce.assign('B', ce.box(['List', ...elements.slice(0, 100)] as never));
    const product = (list: string) =>
      ce.box(['Multiply', list, ['Complex', 1.5, 2.5]]).evaluate();
    const cells = [...product('A').each()].map(parts).slice(0, 100);
    expect(cells).toEqual([...product('B').each()].map(parts));
    expect(cells[9]).toBe('0 0 exact');
  });

  test('a product of a real float and an exact 0 is the exact 0', () => {
    const elements: unknown[] = complexes(150);
    elements[9] = 0;
    const ce = listOf('machine', elements);
    const result = ce.box(['Multiply', 'A', 2.5]).evaluate();
    expect(parts(result.ops![9])).toBe('0 0 exact');
  });

  test('above machine precision, the elements are big-number values', () => {
    const ce = listOf(30, complexes(150));
    const result = ce.box(['Divide', 1, 'A']).evaluate();
    // `at()` counts from 1: the element of index 7.
    expect(result.at(8)!.evaluate().toString()).toBe(
      ce.box(['Divide', 1, ['Complex', 7.5, -5.75]]).evaluate().toString()
    );
  });
});
