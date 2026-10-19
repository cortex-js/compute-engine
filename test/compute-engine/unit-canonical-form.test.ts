import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

// A unit has one canonical tree: the unit symbols with a positive exponent
// over the unit symbols with a negative exponent, with exact fraction
// exponents. The quantity arithmetic, the `Quantity` canonical handler and
// the LaTeX parser give the same tree, so `isSame()` is `true` for the
// evaluated form and for the parse of its LaTeX.

const UNITS: [string, MathJsonExpression][] = [
  ['m', 'm'],
  ['m/s', ['Divide', 'm', 's']],
  ['kg·m/s^2', ['Divide', ['Multiply', 'kg', 'm'], ['Power', 's', 2]]],
  ['m^(1/2)', ['Power', 'm', ['Rational', 1, 2]]],
  ['1/m^(1/2)', ['Power', 'm', ['Rational', -1, 2]]],
  ['m^(2/3)', ['Power', 'm', ['Rational', 2, 3]]],
];

const OPERATIONS: [string, (q: Expression) => Expression][] = [
  ['^(1/2)', (q) => ce.function('Power', [q, ce.number([1, 2])])],
  ['^(-1/2)', (q) => ce.function('Power', [q, ce.number([-1, 2])])],
  ['^2', (q) => ce.function('Power', [q, ce.number(2)])],
  ['* itself', (q) => ce.function('Multiply', [q, q])],
  ['/ 2 s', (q) => ce.function('Divide', [q, ce.box(['Quantity', 2, 's'])])],
  ['1 /', (q) => ce.function('Divide', [ce.One, q])],
  ['Sqrt', (q) => ce.function('Sqrt', [q])],
  ['Root 3', (q) => ce.function('Root', [q, ce.number(3)])],
];

const MATRIX: [number, string, string, MathJsonExpression][] = [];
for (const magnitude of [4, 3])
  for (const [unitName, unit] of UNITS)
    for (const [opName] of OPERATIONS)
      MATRIX.push([magnitude, unitName, opName, unit]);

function operation(name: string): (q: Expression) => Expression {
  return OPERATIONS.find(([n]) => n === name)![1];
}

describe('THE EVALUATED AND THE PARSED UNIT ARE THE SAME TREE', () => {
  test.each(MATRIX)('%s %s, %s', (magnitude, _unitName, opName, unit) => {
    const q = ce.box(['Quantity', magnitude, unit]);
    const result = operation(opName)(q).evaluate();
    expect(result.operator).toBe('Quantity');
    const parsed = ce.parse(result.latex);
    expect(parsed.json).toEqual(result.json);
    expect(result.isSame(parsed)).toBe(true);
  });

  test.each(MATRIX)(
    '%s %s, %s, numeric evaluation',
    (magnitude, _unitName, opName, unit) => {
      const q = ce.box(['Quantity', magnitude, unit]);
      const result = operation(opName)(q).N();
      expect(result.operator).toBe('Quantity');
      // The LaTeX of a float magnitude has fewer digits than its value (the
      // guard digits are not written), so only the units are compared.
      const parsed = ce.parse(result.latex);
      expect(parsed.operator).toBe('Quantity');
      expect(result.op2.isSame(parsed.op2)).toBe(true);
    }
  );

  test('the example of the defect report', () => {
    const result = ce
      .box(['Power', ['Quantity', 4, 'm'], ['Rational', -1, 2]])
      .evaluate();
    expect(result.json).toEqual([
      'Quantity',
      ['Rational', 1, 2],
      ['Divide', 1, ['Sqrt', 'm']],
    ]);
    expect(result.isSame(ce.parse(result.latex))).toBe(true);
    expect(
      result.isSame(
        ce.parse('\\qty[parse-numbers=false]{\\frac{1}{2}}{1/m^{1/2}}')
      )
    ).toBe(true);
  });

  test('a measurement magnitude', () => {
    const result = ce
      .box([
        'Power',
        ['Quantity', ['Measurement', 4, 0.1], 'm'],
        ['Rational', -1, 2],
      ])
      .evaluate();
    expect(result.op2.json).toEqual(['Divide', 1, ['Sqrt', 'm']]);
    expect(result.isSame(ce.parse(result.latex))).toBe(true);
  });

  test('a float magnitude', () => {
    const result = ce.box(['Divide', 2.5, ['Quantity', 4.5, 's']]).evaluate();
    expect(result.op2.json).toEqual(['Divide', 1, 's']);
    expect(result.isSame(ce.parse(result.latex))).toBe(true);
  });
});

describe('THE TREES OF ONE UNIT HAVE ONE CANONICAL FORM', () => {
  const same = (a: MathJsonExpression, b: MathJsonExpression) =>
    ce.box(['Quantity', 1, a]).isSame(ce.box(['Quantity', 1, b]));

  test('a reciprocal root', () => {
    expect(
      same(
        ['Power', ['Power', 'm', ['Rational', 1, 2]], -1],
        ['Divide', 1, ['Sqrt', 'm']]
      )
    ).toBe(true);
    expect(
      same(['Power', 'm', ['Rational', -1, 2]], ['Divide', 1, ['Sqrt', 'm']])
    ).toBe(true);
  });

  test('a quotient and a product with a negative exponent', () => {
    expect(
      same(['Multiply', 'm', ['Power', 's', -1]], ['Divide', 'm', 's'])
    ).toBe(true);
    expect(
      same(
        ['Multiply', 'kg', 'm', ['Power', 's', -2]],
        ['Divide', ['Multiply', 'm', 'kg'], ['Power', 's', 2]]
      )
    ).toBe(true);
  });

  test('a repeated factor and a power of a quotient', () => {
    expect(same(['Multiply', 'm', 'm'], ['Power', 'm', 2])).toBe(true);
    expect(
      same(
        ['Power', ['Divide', 'm', 's'], 2],
        ['Divide', ['Power', 'm', 2], ['Power', 's', 2]]
      )
    ).toBe(true);
  });

  test('the LaTeX spellings of a unit', () => {
    const a = ce.parse('3\\,\\mathrm{m\\cdot s^{-1}}');
    expect(a.isSame(ce.parse('3\\,\\mathrm{m/s}'))).toBe(true);
    expect(a.isSame(ce.parse('3\\,\\mathrm{s^{-1}\\cdot m}'))).toBe(true);
    expect(a.isSame(ce.box(['Quantity', 3, { str: 'm/s' }]))).toBe(true);
    expect(
      ce
        .parse('3\\,\\mathrm{m^{-1/2}}')
        .isSame(ce.parse('3\\,\\mathrm{1/m^{1/2}}'))
    ).toBe(true);
  });

  test('the sum of two large exact exponents is exact', () => {
    // 6004799503160661/2 - 9007199254740991/3 is 1/6. Each cross-product of
    // the sum is above 2^53: with machine numbers, the sum was 2/6, and the
    // unit was the cube root of m.
    const q = ce.box([
      'Quantity',
      1,
      [
        'Multiply',
        ['Power', 'm', ['Rational', 6004799503160661, 2]],
        ['Power', 'm', ['Rational', -9007199254740991, 3]],
      ],
    ]);
    expect(q.json).toEqual(['Quantity', 1, ['Root', 'm', 6]]);
  });

  test('a product of quantities keeps a unit that cancels only as floats', () => {
    // As machine numbers, both exponents are 3002399751580330.5, and their
    // sum is 0: the product was the plain number 6.
    const A: MathJsonExpression = [
      'Power',
      'm',
      ['Rational', 6004799503160661, 2],
    ];
    const B: MathJsonExpression = [
      'Power',
      'm',
      ['Rational', -9007199254740991, 3],
    ];
    expect(
      ce.box(['Multiply', ['Quantity', 2, A], ['Quantity', 3, B]]).evaluate()
        .json
    ).toEqual(['Quantity', 6, ['Root', 'm', 6]]);
    // The numeric route (a float magnitude)
    expect(
      ce.box(['Multiply', ['Quantity', 2.5, A], ['Quantity', 3, B]]).evaluate()
        .json
    ).toEqual(['Quantity', 7.5, ['Root', 'm', 6]]);
  });

  test('a unit that cancels exactly gives a plain number', () => {
    expect(
      ce
        .box([
          'Multiply',
          ['Quantity', 2, 'm'],
          ['Quantity', 3, ['Power', 'm', -1]],
        ])
        .evaluate().json
    ).toEqual(6);
    expect(
      ce
        .box([
          'Multiply',
          ['Quantity', 2.5, 'm'],
          ['Quantity', 3, ['Power', 'm', -1]],
        ])
        .evaluate().json
    ).toEqual(7.5);
    // Two units of the same dimension cancel with a scale: 2 in · 3/m.
    expect(
      ce
        .box([
          'Multiply',
          ['Quantity', 2, 'in'],
          ['Quantity', 3, ['Power', 'm', -1]],
        ])
        .evaluate().re
    ).toBeCloseTo(0.1524);
  });

  test('the exponents of a product stay exact', () => {
    const result = ce
      .box([
        'Multiply',
        ['Quantity', 4, ['Power', 'm', ['Rational', 2, 3]]],
        ['Quantity', 3, ['Power', 'm', ['Rational', 2, 3]]],
      ])
      .evaluate();
    expect(result.json).toEqual([
      'Quantity',
      12,
      ['Power', 'm', ['Rational', 4, 3]],
    ]);
    expect(
      ce
        .box([
          'Multiply',
          ['Quantity', 1.5, ['Power', 'm', ['Rational', 2, 3]]],
          ['Quantity', 2, ['Power', 'm', ['Rational', 2, 3]]],
        ])
        .evaluate().op2.json
    ).toEqual(['Power', 'm', ['Rational', 4, 3]]);
  });

  test('a unit conversion to a compound unit', () => {
    const result = ce
      .box([
        'UnitConvert',
        ['Quantity', 36, ['Divide', 'km', 'h']],
        ['Multiply', 'm', ['Power', 's', -1]],
      ])
      .evaluate();
    expect(result.op2.json).toEqual(['Divide', 'm', 's']);
    expect(result.isSame(ce.parse(result.latex))).toBe(true);
  });
});

describe('THE VALUE OF A PHYSICAL CONSTANT', () => {
  test.each([
    'SpeedOfLight',
    'PlanckConstant',
    'Mu0',
    'StandardGravity',
    'ElementaryCharge',
    'BoltzmannConstant',
    'AvogadroConstant',
    'VacuumPermittivity',
    'GravitationalConstant',
    'StefanBoltzmannConstant',
    'GasConstant',
  ])('%s round trips', (name) => {
    const value = ce.box(name).evaluate();
    expect(value.operator).toBe('Quantity');
    expect(value.isSame(ce.parse(value.latex))).toBe(true);
  });
});

describe('THE UNIT N (NEWTON) DOES NOT HIDE THE OPERATOR N', () => {
  // The canonical form of a product checked that its operands are numbers,
  // and declared the unit `N` as a new symbol of the current scope. Then
  // `N(π)` was not evaluated any more.
  test('after a parse and after quantity arithmetic', () => {
    const engine = new ComputeEngine();
    engine.parse('3\\,\\mathrm{N/A^{2}}');
    engine
      .box(['Multiply', ['Quantity', 2, 'N'], ['Quantity', 3, 's']])
      .evaluate();
    expect(engine.parse('N(\\pi)').evaluate().toString()).toBe(
      '3.14159265358979323846'
    );
  });
});

describe('A POWER OF A QUANTITY WITH A SYMBOLIC EXPONENT', () => {
  test('round trips', () => {
    const e = ce.box(['Power', ['Quantity', 2, 'm'], 'n']);
    expect(e.latex).toBe('(2\\,\\mathrm{m})^{n}');
    expect(e.isSame(ce.parse(e.latex))).toBe(true);
  });
});
