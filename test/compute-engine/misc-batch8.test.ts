import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import {
  convertUnit,
  getExpressionDimension,
  parseUnitDSL,
  unitConversionCoefficients,
} from '../../src/compute-engine/library/unit-data';
import { isCollection } from '../../src/compute-engine/boxed-expression/type-guards';
import { cantorEnumerateComplexNumbers } from '../../src/numerics';

const ce = new ComputeEngine();

/** The dimension vector of the unit of a quantity, or `undefined`. */
function unitDimension(q: Expression): unknown {
  if (q.operator !== 'Quantity') return undefined;
  return ce.box(['UnitDimension', q.ops![1].json]).evaluate().json;
}

/** The first `n` elements of the enumeration of a set. */
function firstElements(name: string, n: number): string[] {
  const set = ce.box(name);
  if (!isCollection(set)) throw new Error(`${name} is not a collection`);
  const result: string[] = [];
  for (const x of set.each()) {
    result.push(x.toString());
    if (result.length >= n) break;
  }
  return result;
}

describe('A UNIT WITH A FRACTION EXPONENT', () => {
  test('the square root of a quantity serializes its unit as m^{1/2}', () => {
    const q = ce
      .box(['Power', ['Quantity', 4, 'm'], ['Rational', 1, 2]])
      .evaluate();
    expect(q.latex).toBe('2\\,\\mathrm{m^{1/2}}');
    const back = ce.parse(q.latex);
    expect(back.operator).toBe('Quantity');
    expect(unitDimension(back)).toEqual(['List', 0.5, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('a negative and a non-unit fraction exponent round-trip', () => {
    const q1 = ce
      .box(['Power', ['Quantity', 4, 'm'], ['Rational', -1, 2]])
      .evaluate();
    expect(q1.latex).toBe(
      '\\qty[parse-numbers=false]{\\frac{1}{2}}{1/m^{1/2}}'
    );
    // The magnitude `1/2` is not a number literal, so the quantity is written
    // with `\qty`, which parses back as a quantity with the same magnitude
    // and the same unit dimension.
    const back1 = ce.parse(q1.latex);
    expect(back1.operator).toBe('Quantity');
    expect(back1.op1.json).toEqual(['Rational', 1, 2]);
    expect(unitDimension(back1)).toEqual(['List', -0.5, 0, 0, 0, 0, 0, 0, 0]);
    expect(unitDimension(ce.parse('3\\,\\mathrm{1/m^{1/2}}'))).toEqual([
      'List',
      -0.5,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    // The exponents of a power of a power are multiplied exactly
    const q2 = ce
      .box(['Power', ['Power', ['Quantity', 8, 'm'], ['Rational', 1, 3]], 2])
      .evaluate();
    expect(q2.latex).toBe('4\\,\\mathrm{m^{2/3}}');
    expect(ce.parse(q2.latex).operator).toBe('Quantity');
  });

  test('a power of a compound unit applies to every factor', () => {
    // `m/s^{2}` is m/s², not (m/s)²
    const q1 = ce.box(['Power', ['Quantity', 8, ['Divide', 'm', 's']], 2]);
    expect(q1.evaluate().latex).toBe('64\\,\\mathrm{m^{2}/s^{2}}');
    const q2 = ce.box(['Power', ['Quantity', 8, ['Multiply', 'kg', 'm']], 2]);
    expect(q2.evaluate().latex).toBe('64\\,\\mathrm{kg^{2}\\cdot m^{2}}');
    expect(unitDimension(ce.parse(q1.evaluate().latex))).toEqual([
      'List',
      2,
      0,
      -2,
      0,
      0,
      0,
      0,
      0,
    ]);
  });

  test('a decimal exponent is read as written', () => {
    const q = ce.parse('3\\,\\mathrm{m^{0.5}}');
    expect(q.json).toEqual(['Quantity', 3, ['Power', 'm', 0.5]]);
    expect(q.latex).toBe('3\\,\\mathrm{m^{0.5}}');
  });

  test('an exponent outside the braces can be a fraction', () => {
    const q = ce.parse('3\\,\\text{ft}^{1/2}');
    expect(q.operator).toBe('Quantity');
    expect(unitDimension(q)).toEqual(['List', 0.5, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('the square of a unit square root is the unit', () => {
    const q = ce.parse('3\\,\\mathrm{m^{1/2}}');
    expect(ce.box(['Power', q.json, 2]).evaluate().json).toEqual([
      'Quantity',
      9,
      'm',
    ]);
  });

  test('a quantity with a root unit converts', () => {
    const q = ce.box([
      'UnitConvert',
      ce.parse('3\\,\\mathrm{m^{1/2}}').json,
      ce.parse('\\mathrm{cm^{1/2}}').json,
    ]);
    expect(q.evaluate().ops![0].re).toBe(30);
  });

  test('a reciprocal unit `1/s` parses', () => {
    const q = ce.parse('3\\,\\mathrm{1/s}');
    expect(q.operator).toBe('Quantity');
    expect(unitDimension(q)).toEqual(['List', 0, 0, -1, 0, 0, 0, 0, 0]);
  });

  test('an exponent followed by text is not a unit', () => {
    // It was read as `m^2`, and the `s` was lost
    expect(ce.parse('3\\,\\mathrm{m^{2}s}').operator).not.toBe('Quantity');
  });

  test('the unit DSL reads a decimal or a fraction exponent', () => {
    expect(parseUnitDSL('m^0.5')).toEqual(['Power', 'm', 0.5]);
    expect(parseUnitDSL('m^(1/2)')).toEqual(['Power', 'm', ['Rational', 1, 2]]);
    expect(parseUnitDSL('m^(4/2)')).toEqual(['Power', 'm', 2]);
    expect(parseUnitDSL('1/s')).toEqual(['Power', 's', -1]);
    expect(parseUnitDSL('m^2s')).toBe('m^2s');
    expect(getExpressionDimension(['Power', 'm', ['Rational', 1, 2]])).toEqual([
      0.5, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
});

describe('A TEMPERATURE CONVERSION IS CORRECTLY ROUNDED', () => {
  test.each([
    [20, 'degC', 'degF', 68],
    [32, 'degF', 'degC', 0],
    [212, 'degF', 'degC', 100],
    [-40, 'degC', 'degF', -40],
    [20, 'degF', 'degC', -60 / 9],
    [20.5, 'degC', 'degF', 68.9],
    [300, 'K', 'degC', 26.85],
    [100, 'degC', 'K', 373.15],
    [300, 'mK', 'degC', -272.85],
  ])('%p %s in %s is %p', (value, from, to, expected) => {
    expect(convertUnit(value, from, to)).toBe(expected);
    const q = ce.box(['UnitConvert', ['Quantity', value, from], to]).evaluate();
    expect(q.ops![0].re).toBe(expected);
  });

  test('the coefficients of the conversion are exact', () => {
    expect(unitConversionCoefficients('degC', 'degF')).toEqual({
      factor: 1.8,
      offset: 32,
    });
    expect(unitConversionCoefficients('m', 'cm')).toEqual({
      factor: 100,
      offset: 0,
    });
  });

  test('a measurement converts with the exact coefficients', () => {
    const q = ce.box([
      'UnitConvert',
      ce.parse('(20\\pm 1)\\,\\mathrm{degC}').json,
      'degF',
    ]);
    const m = q.evaluate().ops![0];
    expect(m.operator).toBe('Measurement');
    expect(m.ops![0].re).toBe(68);
    expect(m.ops![1].re).toBe(1.8);
  });
});

describe('THE ENUMERATION OF A NUMBER SET', () => {
  test('cantorEnumerateComplexNumbers yields each value once, as fractions', () => {
    const seen = new Set<string>();
    let count = 0;
    for (const [re, im] of cantorEnumerateComplexNumbers()) {
      for (const [n, d] of [re, im]) {
        expect(Number.isInteger(n) && Number.isInteger(d) && d > 0).toBe(true);
      }
      const key = `${re[0]}/${re[1]} ${im[0]}/${im[1]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      count += 1;
      if (count >= 5000) break;
    }
    // A value whose two parts have different heights is reached
    expect(seen.has('1/1 1/2')).toBe(true);
    expect(seen.has('1/2 -2/1')).toBe(true);
  });

  test('ComplexNumbers enumerates exact values, 0 once', () => {
    expect(firstElements('ComplexNumbers', 10)).toEqual([
      '0',
      'i',
      '1',
      '-i',
      '(1 + i)',
      '-1',
      '1/2i',
      '(1 - i)',
      '(-1 + i)',
      '1/2',
    ]);
  });

  test('RationalNumbers and ImaginaryNumbers enumerate 0 once', () => {
    expect(firstElements('RationalNumbers', 5)).toEqual([
      '0',
      '1',
      '-1',
      '1/2',
      '-1/2',
    ]);
    expect(firstElements('ImaginaryNumbers', 3)).toEqual(['0', 'i', '-i']);
  });

  test('PositiveNumbers does not enumerate 0', () => {
    expect(firstElements('PositiveNumbers', 3)).toEqual(['1', '1/2', '2']);
    expect(firstElements('NegativeNumbers', 3)).toEqual(['-1', '-1/2', '-2']);
    expect(firstElements('NonNegativeNumbers', 3)).toEqual(['0', '1', '1/2']);
  });
});

describe('A NUMERIC VALUE DIVIDED BY 0', () => {
  test.each(['machine', 'auto'] as const)(
    'a JavaScript 0 and a numeric value 0 give the same answer (%s)',
    (precision) => {
      const engine = new ComputeEngine();
      engine.precision = precision;
      for (const [value, expected] of [
        [2.5, 'Infinity'],
        [-2.5, '-Infinity'],
        [{ re: 2, im: 3 }, '~oo'],
        [{ re: 0, im: 3 }, '~oo'],
      ] as const) {
        const x = engine._numericValue(value);
        expect(x.div(0).toString()).toBe(expected);
        expect(x.div(engine._numericValue(0)).toString()).toBe(expected);
      }
      expect(engine._numericValue(0).div(0).isNaN).toBe(true);
    }
  );

  test('the boxed route gives the complex infinity', () => {
    expect(ce.parse('(2.0+3.0i)/0').evaluate().toString()).toBe('~oo');
  });
});

describe('limits of the unit exponents and of the temperature map', () => {
  test('an exponent product that is not finite does not hang the serializer', () => {
    // The product of the exponents is `Infinity`, and `gcd()` of it never
    // ended (`Infinity % 1` is `NaN`).
    const q = ce.box([
      'Quantity',
      1,
      ['Power', ['Power', 'm', 1e200], 1e200],
    ] as any);
    expect(typeof q.latex).toBe('string');
  });

  test('a temperature near the largest float converts to a finite value', () => {
    // `1e308·5` overflows before the division by 9.
    const c = convertUnit(1e308, 'degF', 'degC')!;
    expect(Number.isFinite(c)).toBe(true);
    expect(c / 5.555555555555556e307).toBeCloseTo(1, 12);
    expect(convertUnit(20, 'degC', 'degF')).toBe(68);
  });
});
