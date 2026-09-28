import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';

// The float value (`.N()`) of an exact number literal follows the CURRENT
// precision of the engine, not the precision at which the literal was made.
// Each exact numeric value keeps the factory of its float value
// (`ExactNumericValue.factory`); the factory of the engine reads the
// precision of the engine at each call. When the factory was chosen at the
// creation of the literal, a literal made at machine precision kept a
// double value after the precision was raised.

const SQRT2_50 = '1.4142135623730950488016887242096980785696718753769';

describe('A LITERAL MADE AT MACHINE PRECISION', () => {
  const bigDecimalPrecision = BigDecimal.precision;
  afterAll(() => {
    BigDecimal.precision = bigDecimalPrecision;
  });

  test('gets all the digits of a raised precision', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    const sqrt2 = e.box(['Sqrt', 2]);
    const third = e.box(['Rational', 1, 3]);
    // A rational folded by the canonical form of `Add`
    const sum = e.box(['Add', ['Rational', 1, 3], ['Rational', 2, 5]]);
    const product = e.box(['Multiply', 3, ['Sqrt', 2]]);
    expect(sqrt2.N().toString()).toBe('1.4142135623730951');

    e.precision = 50;
    expect(sqrt2.N().toString()).toBe(SQRT2_50);
    expect(third.N().toString()).toBe(
      '0.33333333333333333333333333333333333333333333333333'
    );
    expect(sum.N().toString()).toBe(
      '0.73333333333333333333333333333333333333333333333333'
    );
    expect(product.N().toString()).toBe(
      '4.2426406871192851464050661726290942357090156261308'
    );
  });

  test('gets a machine value again when the precision is lowered', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    const sqrt2 = e.box(['Sqrt', 2]);
    e.precision = 50;
    expect(sqrt2.N().toString()).toBe(SQRT2_50);
    e.precision = 'machine';
    expect(sqrt2.N().toString()).toBe('1.4142135623730951');
    expect(sqrt2.N().numericValue!.constructor.name).toBe(
      'MachineNumericValue'
    );
  });
});

describe('THE ARITHMETIC OF A MACHINE FLOAT', () => {
  const bigDecimalPrecision = BigDecimal.precision;
  afterAll(() => {
    BigDecimal.precision = bigDecimalPrecision;
  });

  // The float `3` (from `1.5 + 1.5`) is a float, even though its value is an
  // integer (user decision of 2026-09-27: the spelling rule holds at machine
  // precision too). Its product with the rational `1/7` is a machine float,
  // and a raised precision does not add digits to it. Before, a machine
  // float with an integer value was exact, and the product was `3/7`.
  test('stays a machine float at a raised precision', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    const three = e.parse('1.5+1.5').evaluate();
    expect(three.isExact).toBe(false);
    const product = three.mul(e.box(['Rational', 1, 7]));
    const quotient = three.div(e.number(7));
    expect(product.isExact).toBe(false);
    expect(product.toString()).toBe('0.42857142857142855');
    e.precision = 50;
    expect(product.N().toString()).toBe('0.42857142857142855');
    expect(quotient.N().toString()).toBe('0.42857142857142855');
  });
});

describe('A LITERAL MADE AT THE DEFAULT PRECISION', () => {
  const bigDecimalPrecision = BigDecimal.precision;
  afterAll(() => {
    BigDecimal.precision = bigDecimalPrecision;
  });

  test('gets a machine value at machine precision, then 50 digits', () => {
    const e = new ComputeEngine();
    const sqrt2 = e.box(['Sqrt', 2]);
    expect(sqrt2.N().toString()).toBe('1.4142135623730950488');
    e.precision = 'machine';
    expect(sqrt2.N().numericValue!.constructor.name).toBe(
      'MachineNumericValue'
    );
    expect(sqrt2.N().toString()).toBe('1.4142135623730951');
    e.precision = 50;
    expect(sqrt2.N().toString()).toBe(SQRT2_50);
  });
});

describe('THE EXACT ORDER AT MACHINE PRECISION', () => {
  // The order of two constants closer than the error of a double is decided
  // at a raised precision (`exactOrder`, step 1), also at machine precision.
  test.each([['machine' as const], [21]])('precision %p', (precision) => {
    const e = new ComputeEngine({ precision });
    const a = e.box(['Sqrt', ['Add', 2, ['Power', 10, -30]]]).evaluate();
    const b = e.box(['Sqrt', 2]).evaluate();
    expect(e.box(['Max', a, b]).evaluate().isSame(a)).toBe(true);
    expect(e.box(['Min', a, b]).evaluate().isSame(b)).toBe(true);
    expect(
      e
        .box(['Sort', ['List', a, b]])
        .evaluate()
        .toString()
    ).toBe(e.box(['List', b, a]).toString());
  });
});
