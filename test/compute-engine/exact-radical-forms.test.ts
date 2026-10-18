import { ComputeEngine } from '../../src/compute-engine';

// Exact radical forms that were correct but not reduced.
//
// - An odd integer power of `Sqrt(a)`, with `a` an exact number that has no
//   exact square root value (a negative non-square `a`, or a square-free part
//   above 10⁶), takes the integer part out of the root:
//   `(√a)^(2k+1) = a^k·√a`.
// - An exact integer power of a canonical product of exact number literals
//   (`√1009·√1013`, kept as two factors because the radicand 1022117 of their
//   product is above 10⁶) is folded at canonicalization, as the power of one
//   literal is.
// - The rational part of a radical factor that is kept separate is folded
//   into the coefficient of the product, and the radicals are ordered by
//   radicand, after the coefficient.

const ce = new ComputeEngine();

const SQRT_13 = Math.sqrt(13);
const SQRT_1022117 = Math.sqrt(1022117);

describe('AN ODD POWER OF THE SQUARE ROOT OF A NEGATIVE INTEGER', () => {
  test('(√−13)^3 is −13√13·i', () => {
    const json = ['Complex', 0, ['Multiply', -13, ['Sqrt', 13]]];
    const boxed = ce.box(['Power', ['Sqrt', -13], 3]);
    expect(boxed.evaluate().json).toEqual(json);
    expect(ce.parse('\\sqrt{-13}^3').evaluate().json).toEqual(json);
    const n = boxed.evaluate().N();
    expect(n.re).toBe(0);
    expect(n.im).toBeCloseTo(-13 * SQRT_13, 12);
    expect(boxed.N().im).toBeCloseTo(-13 * SQRT_13, 12);
  });

  test('other odd powers of √−13', () => {
    const v5 = ce.box(['Power', ['Sqrt', -13], 5]).evaluate();
    expect(v5.json).toEqual(['Complex', 0, ['Multiply', 169, ['Sqrt', 13]]]);
    expect(v5.N().im).toBeCloseTo(169 * SQRT_13, 10);

    // (√−13)^(−3) = 1/(−13√13·i) = √13·i/169
    const vm3 = ce.box(['Power', ['Sqrt', -13], -3]).evaluate();
    expect(vm3.json).toEqual(['Complex', 0, ['Divide', ['Sqrt', 13], 169]]);
    expect(vm3.N().im).toBeCloseTo(1 / (13 * SQRT_13), 15);
  });

  test('(√−2)^3 is −2√2·i', () => {
    const v = ce.box(['Power', ['Sqrt', -2], 3]).evaluate();
    expect(v.json).toEqual(['Complex', 0, ['Multiply', -2, ['Sqrt', 2]]]);
    expect(v.N().im).toBeCloseTo(-2 * Math.SQRT2, 14);
  });

  test('an even power is unchanged', () => {
    expect(ce.box(['Power', ['Sqrt', -13], 2]).evaluate().json).toBe(-13);
    expect(ce.box(['Power', ['Sqrt', -13], 4]).evaluate().json).toBe(169);
  });
});

describe('AN ODD POWER OF THE SQUARE ROOT OF A LARGE INTEGER', () => {
  test('(√1022117)^3 is 1022117·√1022117', () => {
    const json = ['Multiply', 1022117, ['Sqrt', 1022117]];
    const boxed = ce.box(['Power', ['Sqrt', 1022117], 3]);
    expect(boxed.evaluate().json).toEqual(json);
    expect(ce.parse('\\sqrt{1022117}^3').evaluate().json).toEqual(json);
    expect(boxed.evaluate().N().re / (1022117 * SQRT_1022117)).toBeCloseTo(
      1,
      14
    );
  });

  test('(√1022117)^5 and (√1022117)^(−3)', () => {
    const v5 = ce.box(['Power', ['Sqrt', 1022117], 5]).evaluate();
    expect(v5.json).toEqual(['Multiply', 1044723161689, ['Sqrt', 1022117]]);
    expect(v5.N().re / (1022117 ** 2 * SQRT_1022117)).toBeCloseTo(1, 14);

    const vm3 = ce.box(['Power', ['Sqrt', 1022117], -3]).evaluate();
    expect(vm3.json).toEqual([
      'Multiply',
      ['Rational', 1, 1044723161689],
      ['Sqrt', 1022117],
    ]);
    expect(vm3.N().re * 1022117 * SQRT_1022117).toBeCloseTo(1, 14);
  });

  test('a power of the square root of a symbol is unchanged', () => {
    expect(ce.parse('\\sqrt{x}^3').evaluate().json).toEqual([
      'Power',
      ['Sqrt', 'x'],
      3,
    ]);
  });
});

describe('AN INTEGER POWER OF A PRODUCT OF EXACT NUMBER LITERALS', () => {
  const base = ['Multiply', ['Sqrt', 1009], ['Sqrt', 1013]];

  test('(√1009·√1013)^(−2) is folded at canonicalization', () => {
    const e = ce.box(['Power', base, -2]);
    expect(e.json).toEqual(['Rational', 1, 1022117]);
    expect(ce.parse('(\\sqrt{1009}\\sqrt{1013})^{-2}').json).toEqual([
      'Rational',
      1,
      1022117,
    ]);
    // The same rule as for a literal base: (√2·√3)^(−2) = 1/6
    expect(
      ce.box(['Power', ['Multiply', ['Sqrt', 2], ['Sqrt', 3]], -2]).json
    ).toEqual(['Rational', 1, 6]);
  });

  test('other integer powers of √1009·√1013', () => {
    expect(ce.box(['Power', base, 2]).json).toBe(1022117);
    const cube = ce.box(['Power', base, 3]);
    expect(cube.json).toEqual([
      'Multiply',
      1022117,
      ['Sqrt', 1009],
      ['Sqrt', 1013],
    ]);
    expect(cube.evaluate().json).toEqual(cube.json);
    expect(cube.N().re / (1022117 * SQRT_1022117)).toBeCloseTo(1, 14);
  });

  test('a non-integer power is not folded', () => {
    expect(ce.box(['Power', base, ['Rational', 1, 2]]).json).toEqual([
      'Sqrt',
      base,
    ]);
  });
});

describe('THE COEFFICIENT AND THE ORDER OF SEPARATE RADICAL FACTORS', () => {
  test('2√1009·√1013 serializes with the coefficient first', () => {
    const json = ['Multiply', 2, ['Sqrt', 1009], ['Sqrt', 1013]];
    for (const input of [
      json,
      ['Multiply', ['Sqrt', 1013], 2, ['Sqrt', 1009]],
      ['Multiply', 2, ['Sqrt', 1013], ['Sqrt', 1009]],
    ]) {
      const e = ce.box(input);
      expect(e.json).toEqual(json);
      expect(e.latex).toBe('2\\sqrt{1\\,009}\\sqrt{1\\,013}');
      expect(ce.parse(e.latex).isSame(e)).toBe(true);
      expect(e.evaluate().json).toEqual(json);
    }
  });

  test('the rational parts of the radical factors are folded together', () => {
    const json = ['Multiply', 6, ['Sqrt', 1009], ['Sqrt', 1013]];
    const nested = ce.box([
      'Multiply',
      ['Multiply', 2, ['Sqrt', 1009]],
      ['Multiply', 3, ['Sqrt', 1013]],
    ]);
    expect(nested.json).toEqual(json);
    expect(nested.evaluate().json).toEqual(json);
    expect(ce.parse('2\\sqrt{1009}\\times3\\sqrt{1013}').json).toEqual(json);
    expect(nested.N().re / (6 * SQRT_1022117)).toBeCloseTo(1, 14);

    // The `Product` route (the evaluation of a product)
    const big = ce.function('Multiply', [
      ce.box(['Multiply', 1009, ['Sqrt', 1009]]),
      ce.box(['Multiply', 1013, ['Sqrt', 1013]]),
      ce.symbol('x'),
    ]);
    expect(big.evaluate().json).toEqual([
      'Multiply',
      1022117,
      ['Sqrt', 1009],
      ['Sqrt', 1013],
      'x',
    ]);
  });

  test('a square root with no exact value comes after the literals', () => {
    const e = ce.box(['Multiply', ['Sqrt', 1022117], 2, ['Sqrt', 2]]);
    expect(e.json).toEqual([
      'Multiply',
      2,
      ['Sqrt', 2],
      ['Sqrt', 1022117],
    ]);
    expect(e.latex).toBe('2\\sqrt{2}\\sqrt{1\\,022\\,117}');
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
  });

  test('a quotient of radicals keeps its form', () => {
    const q = ce.box(['Divide', ['Sqrt', 1009], ['Sqrt', 1013]]);
    expect(q.evaluate().json).toEqual(['Divide', ['Sqrt', 1009], ['Sqrt', 1013]]);
  });
});
