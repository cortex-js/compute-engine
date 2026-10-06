import { ComputeEngine } from '../../src/compute-engine';

// The symbolic tensor field adds and subtracts cells with the exact n-ary
// `add()` function. The `.add()` and `.sub()` methods fold two exact number
// literals to a machine float, so the determinant of `[[√2, 1], [1, 1]]` was
// `0.414…` instead of `√2 − 1`.
describe('DETERMINANT AND CHARACTERISTIC POLYNOMIAL OF EXACT ENTRIES', () => {
  const ce = new ComputeEngine();
  const m2 = ['List', ['List', ['Sqrt', 2], 1], ['List', 1, 1]];

  test('2×2 determinant with a radical entry stays exact', () => {
    expect(ce.box(['Determinant', m2]).evaluate().toString()).toBe(
      '-1 + sqrt(2)'
    );
  });

  test('3×3 determinant with radical entries stays exact', () => {
    const m3 = [
      'List',
      ['List', ['Sqrt', 2], 1, 0],
      ['List', 1, 1, ['Sqrt', 3]],
      ['List', 0, 2, 1],
    ];
    const det = ce.box(['Determinant', m3]).evaluate();
    expect(det.toString()).toBe('-1 - 2sqrt(6) + sqrt(2)');
    expect(det.N().re).toBeCloseTo(Math.sqrt(2) - 2 * Math.sqrt(6) - 1, 12);
  });

  test('N() of the determinant is a float', () => {
    const n = ce.box(['Determinant', m2]).N();
    expect(n.isNumberLiteral).toBe(true);
    expect(n.re).toBeCloseTo(Math.sqrt(2) - 1, 12);
  });

  // From 4×4, the determinant of a matrix with a symbol or an exact
  // irrational entry is a cofactor expansion. Bareiss elimination divided by
  // a sum of radicals at each step, and the quotients nested.
  const m4 = [
    'List',
    ['List', ['Sqrt', 2], 1, 0, 1],
    ['List', 1, 1, ['Sqrt', 3], 2],
    ['List', 0, 2, 1, 3],
    ['List', 1, 0, 1, 1],
  ];

  test('4×4 determinant with radical entries is an expanded exact sum', () => {
    const det = ce.box(['Determinant', m4]).evaluate();
    expect(det.toString()).toBe('1 - 2sqrt(6) - sqrt(3) + 2sqrt(2)');
    expect(det.N().re).toBeCloseTo(
      1 - 2 * Math.sqrt(6) - Math.sqrt(3) + 2 * Math.sqrt(2),
      12
    );
  });

  test('a singular 4×4 matrix with radical entries has determinant 0', () => {
    // The third row is the sum of the first two.
    const singular = [
      'List',
      ['List', ['Sqrt', 2], 1, 0, 1],
      ['List', 1, 1, ['Sqrt', 3], 2],
      ['List', ['Add', ['Sqrt', 2], 1], 2, ['Sqrt', 3], 3],
      ['List', 1, 0, 1, 1],
    ];
    expect(ce.box(['Determinant', singular]).evaluate().json).toBe(0);
  });

  test('4×4 determinant of symbols has the 24 terms of the expansion', () => {
    const rows = ['abcd', 'efgh', 'ijkl', 'mnop'].map((r) => [
      'List',
      ...r.split(''),
    ]);
    const det = ce.box(['Determinant', ['List', ...rows]]).evaluate();
    expect(det.operator).toBe('Add');
    expect(det.nops).toBe(24);
  });

  // A float pivot that is zero in exact arithmetic is about 1e-16 after
  // rounding. Bareiss elimination now takes the largest pivot of the column.
  test('N() of a 4×4 determinant chooses a large pivot', () => {
    const m = [
      'List',
      ['List', ['Add', 1, ['Sqrt', 2]], 1, 2, 3],
      ['List', 1, ['Subtract', ['Sqrt', 2], 1], 5, 7],
      ['List', 2, 3, 1, 1],
      ['List', 1, 4, 2, 9],
    ];
    const exact = 23 - 126 * Math.sqrt(2);
    expect(ce.box(['Determinant', m]).N().re).toBeCloseTo(exact, 9);
    const floats = [
      'List',
      ['List', 1 + Math.SQRT2, 1, 2, 3],
      ['List', 1, Math.SQRT2 - 1, 5, 7],
      ['List', 2, 3, 1, 1],
      ['List', 1, 4, 2, 9],
    ];
    expect(ce.box(['Determinant', floats]).evaluate().re).toBeCloseTo(exact, 9);
  });

  test('the characteristic polynomial keeps exact coefficients', () => {
    expect(
      ce.box(['CharacteristicPolynomial', m2, 'x']).evaluate().toString()
    ).toBe('x^2 + x * (-1 - sqrt(2)) - 1 + sqrt(2)');
  });

  // The variable of `CharacteristicPolynomial` is typed `any`, so the list
  // `x·I − A` of a symbolic matrix is not typed `matrix`. The polynomial is
  // computed from the packed cells, not through `Determinant(...)`, which
  // declined such a list.
  test('the characteristic polynomial of a symbolic matrix is evaluated', () => {
    const m = ['List', ['List', 'a', 'b'], ['List', 'c', 'd']];
    expect(
      ce.box(['CharacteristicPolynomial', m, 'x']).evaluate().toString()
    ).toBe('x^2 - b * c + a * d - a * x - d * x');
  });

  test('a NaN in a pivot column makes the determinant NaN', () => {
    const m = [
      'List',
      ['List', 0, 1.5, 2, 3],
      ['List', 'NaN', 1, 2, 4],
      ['List', 0, 5, 1, 2],
      ['List', 0, 2, 3, 1.5],
    ];
    expect(ce.box(['Determinant', m]).evaluate().isNaN).toBe(true);
  });

  test('a big decimal outside the machine range is not a zero pivot', () => {
    const m = [
      'List',
      ['List', { num: '1e-400' }, 0.0, 0.0, 0.0],
      ['List', 0.0, 1.0, 0.0, 0.0],
      ['List', 0.0, 0.0, 1.0, 0.0],
      ['List', 0.0, 0.0, 0.0, 1.0],
    ];
    expect(ce.box(['Determinant', m]).evaluate().toString()).toBe('1e-400');
  });

  test('the characteristic polynomial in a list variable is a type error', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<integer>');
    const m = ['List', ['List', 1, 2], ['List', 3, 4]];
    const result = engine.box(['CharacteristicPolynomial', m, 'L']).evaluate();
    expect(result.operator).toBe('Error');
  });
});

// The product of two radicals whose radicand is above 10⁶ was a float, even
// when the radicand has a square factor. The determinant of a matrix of
// radicals multiplies many of them.
describe('PRODUCT OF RADICALS WITH A LARGE RADICAND', () => {
  const ce = new ComputeEngine();

  test('√17 · √323323 = 17√19019', () => {
    expect(
      ce
        .box(['Multiply', ['Sqrt', 17], ['Sqrt', 323323]])
        .evaluate()
        .toString()
    ).toBe('17sqrt(19019)');
  });

  test('√17 / √323323 = √19019 / 19019', () => {
    expect(
      ce
        .box(['Divide', ['Sqrt', 17], ['Sqrt', 323323]])
        .evaluate()
        .toString()
    ).toBe('sqrt(19019)/19019');
  });

  test('8×8 determinant with eight prime radicands has no float term', () => {
    const primes = [2, 3, 5, 7, 11, 13, 17, 19];
    const m = [
      'List',
      ...primes.map((p, i) => [
        'List',
        ...primes.map((q, j) =>
          i === j
            ? ['Sqrt', p]
            : (i + 2 * j) % 3 === 0
              ? ['Sqrt', q]
              : (i * 5 + j) % 4
        ),
      ]),
    ];
    const det = ce.box(['Determinant', m]).evaluate();
    expect(JSON.stringify(det.json)).not.toMatch(/\d\.\d/);
    expect(det.N().re).toBeCloseTo(ce.box(['Determinant', m]).N().re, 6);
  });
});
