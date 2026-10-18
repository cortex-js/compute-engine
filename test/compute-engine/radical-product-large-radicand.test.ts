import { engine as ce } from '../utils';

// An exact number holds one radical with a radicand of at most 10⁶ times a
// Gaussian rational. The product of two radicals can leave this set:
// √1009·√1013 = √1022117, and 1022117 = 1009·1013 has no square factor. Such
// a product was computed as a float at canonicalization
// (`\sqrt{1009}\sqrt{1013}` parsed to `1010.998…`). The two radicals are now
// kept as separate factors, so the product stays exact, and `.N()` gives the
// float. Reference value: √1022117 = 1010.998021758697607 (Python
// `decimal`, 30 digits: 1010.99802175869760699777766486).

const SQRT_1022117 = 1010.998021758697607;

describe('A PRODUCT OF TWO RADICALS WHOSE RADICAND IS ABOVE 10⁶', () => {
  test('√1009·√1013 stays exact on every route', () => {
    const e = ce.parse('\\sqrt{1009}\\sqrt{1013}');
    const json = ['Multiply', ['Sqrt', 1009], ['Sqrt', 1013]];
    expect(e.json).toEqual(json);
    expect(e.evaluate().json).toEqual(json);
    expect(e.simplify().json).toEqual(json);
    expect(e.N().re).toBeCloseTo(SQRT_1022117, 12);
  });

  test('√1009·√1013 on the box route', () => {
    const e = ce.box(['Multiply', ['Sqrt', 1009], ['Sqrt', 1013]]);
    expect(e.json).toEqual(['Multiply', ['Sqrt', 1009], ['Sqrt', 1013]]);
    expect(e.N().re).toBeCloseTo(SQRT_1022117, 12);
  });

  test('√1009·√1013 compares exactly with √1022117', () => {
    const e = ce.parse('\\sqrt{1009}\\sqrt{1013}');
    expect(e.isEqual(ce.parse('\\sqrt{1022117}'))).toBe(true);
    expect(e.type.matches('real')).toBe(true);
    expect(
      ce.parse('\\lfloor\\sqrt{1009}\\sqrt{1013}\\rfloor').evaluate().json
    ).toBe(1010);
  });

  test('the canonical form does not depend on the order of the factors', () => {
    const a = ce.box(['Multiply', 2, ['Sqrt', 1009], ['Sqrt', 1013]]);
    const b = ce.box(['Multiply', ['Sqrt', 1013], 2, ['Sqrt', 1009]]);
    expect(a.isSame(b)).toBe(true);
    // The serialization boxes back to the same expression
    expect(ce.box(a.json).isSame(a)).toBe(true);
    expect(ce.parse(a.latex).isSame(a)).toBe(true);
    expect(a.N().re).toBeCloseTo(2 * SQRT_1022117, 11);
  });

  test('a factor kept separate still combines with a later factor', () => {
    expect(
      ce.box(['Multiply', ['Sqrt', 1009], ['Sqrt', 1013], ['Sqrt', 1013]]).json
    ).toEqual(['Multiply', 1013, ['Sqrt', 1009]]);
    expect(
      ce.box(['Multiply', ['Sqrt', 1009], ['Sqrt', 1013], ['Sqrt', 1009]]).json
    ).toEqual(['Multiply', 1009, ['Sqrt', 1013]]);
  });

  test('a product whose radicand has a square factor still folds', () => {
    // 101·103 = 10403 is below 10⁶
    expect(ce.parse('\\sqrt{101}\\sqrt{103}').json).toEqual(['Sqrt', 10403]);
    // 17·323323 = 5496491 = 17²·19019
    expect(ce.box(['Multiply', ['Sqrt', 17], ['Sqrt', 323323]]).json).toEqual([
      'Multiply',
      17,
      ['Sqrt', 19019],
    ]);
  });

  test('with a symbolic factor', () => {
    const e = ce.parse('\\sqrt{1009}\\sqrt{1013}x');
    expect(e.json).toEqual(['Multiply', ['Sqrt', 1009], ['Sqrt', 1013], 'x']);
    expect(e.evaluate().json).toEqual(e.json);
    const n = ce.box(['Multiply', ['Sqrt', 1009], 'x', ['Sqrt', 1013]]);
    expect(n.json).toEqual(e.json);
  });

  test('the `.mul()` method keeps the product exact', () => {
    const a = ce.parse('\\sqrt{1009}x');
    const b = ce.box(['Sqrt', 1013]);
    expect(a.mul(b).json).toEqual([
      'Multiply',
      ['Sqrt', 1009],
      ['Sqrt', 1013],
      'x',
    ]);
    // A third factor √1013 pairs with the second one
    expect(a.mul(b).mul(b).json).toEqual([
      'Multiply',
      1013,
      ['Sqrt', 1009],
      'x',
    ]);
  });

  test('a quotient of two radicals stays exact', () => {
    const e = ce.parse('\\frac{\\sqrt{1009}}{\\sqrt{1013}}');
    const json = ['Divide', ['Sqrt', 1009], ['Sqrt', 1013]];
    expect(e.json).toEqual(json);
    expect(e.evaluate().json).toEqual(json);
    expect(e.simplify().json).toEqual(json);
    expect(e.N().re).toBeCloseTo(Math.sqrt(1009 / 1013), 14);
  });

  test('a quotient with integer factors is reduced the same way on every route', () => {
    const p = ['Multiply', 2, ['Sqrt', 1009]];
    const q = ['Multiply', 4, ['Sqrt', 1013]];
    const json = ['Divide', ['Sqrt', 1009], ['Multiply', 2, ['Sqrt', 1013]]];
    const boxed = ce.box(['Divide', p, q]);
    const divided = ce.box(p).div(ce.box(q));
    expect(boxed.json).toEqual(json);
    expect(divided.json).toEqual(json);
    expect(boxed.isSame(divided)).toBe(true);
    expect(boxed.N().re).toBeCloseTo(Math.sqrt(1009 / 1013) / 2, 14);
  });

  test('a coefficient extracted from the product stays exact', () => {
    // `Product.mul` extracts the coefficient of `√(√1009·√1013·x)`. It was
    // the float 31.796… (the square root of √1022117).
    const e = ce.box([
      'Multiply',
      'y',
      ['Sqrt', ['Multiply', ['Sqrt', 1009], ['Sqrt', 1013], 'x']],
    ]);
    const json = [
      'Multiply',
      'y',
      ['Sqrt', ['Sqrt', 1009]],
      ['Sqrt', ['Sqrt', 1013]],
      ['Sqrt', 'x'],
    ];
    expect(e.evaluate().json).toEqual(json);
    expect(
      ce
        .symbol('y')
        .mul(
          ce.box(['Sqrt', ['Multiply', ['Sqrt', 1009], ['Sqrt', 1013], 'x']])
        ).json
    ).toEqual(json);
    const n = e.evaluate().subs({ x: 2, y: 3 }).N();
    expect(n.re).toBeCloseTo(3 * Math.sqrt(SQRT_1022117 * 2), 12);
  });

  test('the inverse of the product stays exact', () => {
    const e = ce.parse('\\frac{1}{\\sqrt{1009}\\sqrt{1013}}');
    const json = ['Divide', ['Sqrt', 1009], ['Multiply', 1009, ['Sqrt', 1013]]];
    expect(e.evaluate().json).toEqual(json);
    expect(e.simplify().json).toEqual(json);
    expect(ce.box(json).isSame(e.evaluate())).toBe(true);
    expect(e.N().re).toBeCloseTo(1 / SQRT_1022117, 17);
  });

  test('a power of the product is exact', () => {
    expect(ce.parse('(\\sqrt{1009}\\sqrt{1013})^2').evaluate().json).toEqual(
      1022117
    );
    expect(
      ce.box(['Power', ['Multiply', ['Sqrt', 1009], 'x'], 2]).evaluate().json
    ).toEqual(['Multiply', 1009, ['Power', 'x', 2]]);
  });

  test('a complex factor keeps the product exact', () => {
    const e = ce.parse('\\sqrt{1009}\\sqrt{1013}\\imaginaryI');
    expect(e.json).toEqual([
      'Multiply',
      ['Sqrt', 1013],
      ['Complex', 0, ['Sqrt', 1009]],
    ]);
    const n = e.N();
    expect(n.re).toBeCloseTo(0, 12);
    expect(n.im).toBeCloseTo(SQRT_1022117, 12);
  });
});

// An integer power of `q·√r` is `q^n·r^⌊n/2⌋·√r^(n mod 2)`. It was computed as
// a float when `r^n` was above 10⁶: `(√1009)^2` was `1009.0`.
describe('AN INTEGER POWER OF A RADICAL WHOSE POWER IS ABOVE 10⁶', () => {
  test('(√1009)^2 = 1009', () => {
    const e = ce.parse('(\\sqrt{1009})^2');
    expect(e.json).toEqual(1009);
    expect(e.isExact).toBe(true);
  });

  test('(√1009)^3 = 1009√1009', () => {
    expect(ce.parse('(\\sqrt{1009})^3').json).toEqual([
      'Multiply',
      1009,
      ['Sqrt', 1009],
    ]);
  });

  test('(-(2/3)√1009)^3 = -(8072/27)√1009', () => {
    const v = ce._numericValue({ rational: [-2, 3], radical: 1009 }).pow(3);
    expect(v.isExact).toBe(true);
    expect(ce.number(v).json).toEqual([
      'Multiply',
      ['Rational', -8072, 27],
      ['Sqrt', 1009],
    ]);
    expect(v.re).toBeCloseTo((-8 / 27) * 1009 ** 1.5, 9);
  });

  test('(√999983)^4 = 999983²', () => {
    const v = ce._numericValue({ radical: 999983 }).pow(4);
    expect(v.isExact).toBe(true);
    expect(ce.number(v).json).toEqual(999966000289);
  });
});
