import { engine as ce } from '../utils';

// There are several paths that need to be tested:
// - expr.json: only use shorthands, no sugaring/prettification, numbers are
//   always converted to JavaScript numbers and may lose precision
// - expr.toJson({}): use shorthand when possible (no metadata), does prettify,
// numbers precision is preserved
// - expr.toJson(options): custom options

describe('JSON PROPERTY', () => {
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.box({ num: 'NaN' }).json).toMatchInlineSnapshot(`NaN`));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.box({ num: '+infinity' }).json).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.box({ num: '-infinity' }).json).toMatchInlineSnapshot(
      `NegativeInfinity`
    ));

  test(`No prettification`, () => {
    const expr = ce.parse('\\frac{\\sqrt{x^2-1}}{2}');
    expect(expr.json).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Rational,
          1,
          2,
        ],
        [
          Sqrt,
          [
            Add,
            [
              Power,
              x,
              2,
            ],
            -1,
          ],
        ],
      ]
    `);
  });

  test(`Approximate numbers (precision)`, () => {
    const expr = ce.parse('1.2345678912345678901234');
    expect(expr.json).toMatchObject({ num: '1.2345678912345678901234' });
  });
  test(`Approximate numbers (range to infinity)`, () => {
    const expr = ce.parse('1.23456789e400');
    expect(expr.json).toMatchObject({ num: '123456789e+392' });
  });
  test(`Approximate numbers (range to 0)`, () => {
    const expr = ce.parse('1.23456789e-400');
    expect(expr.json).toMatchObject({ num: '1.23456789e-400' });
  });
  test(`Approximate numbers (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.json).toMatchInlineSnapshot(`
      {
        num: 1.2345234523452345234523452345234523452345234523452345234523452345234523452345234523452345234523452345,
      }
    `);
  });
});

describe('DEFAULT JSON SERIALIZATION', () => {
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.box({ num: 'NaN' }).toMathJson({})).toMatchInlineSnapshot(`NaN`));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.box({ num: '+infinity' }).toMathJson({})).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.box({ num: '-infinity' }).toMathJson({})).toMatchInlineSnapshot(
      `NegativeInfinity`
    ));

  test(`No prettification`, () => {
    const expr = ce.parse('\\frac{\\sqrt{x^2-1}}{2}');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Rational,
          1,
          2,
        ],
        [
          Sqrt,
          [
            Subtract,
            [
              Square,
              x,
            ],
            1,
          ],
        ],
      ]
    `);
  });

  test(`Approximate numbers (precision)`, () => {
    const expr = ce.parse('1.2345678912345678901234');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(
      `1.2345678912345678901234`
    );
  });
  test(`Approximate numbers (range to infinity)`, () => {
    const expr = ce.parse('1.23456789e400');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`
      {
        num: 123456789e+392,
      }
    `);
  });
  test(`Approximate numbers (range to 0)`, () => {
    const expr = ce.parse('1.23456789e-400');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.23456789e-400`);
  });
  test(`Approximate numbers (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.(2345)`);
  });
});

describe('CUSTOM JSON SERIALIZATION', () => {
  const opts = {};
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.box({ num: 'NaN' }).toMathJson(opts)).toMatchInlineSnapshot(
      `NaN`
    ));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.box({ num: '+infinity' }).toMathJson(opts)).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.box({ num: '-infinity' }).toMathJson(opts)).toMatchInlineSnapshot(
      `NegativeInfinity`
    ));

  test(`No prettification`, () => {
    const expr = ce.parse('\\frac{\\sqrt{x^2-1}}{2}');
    expect(expr.toMathJson(opts)).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Rational,
          1,
          2,
        ],
        [
          Sqrt,
          [
            Subtract,
            [
              Square,
              x,
            ],
            1,
          ],
        ],
      ]
    `);
  });

  test(`Approximate numbers (precision)`, () => {
    const expr = ce.parse('1.2345678912345678901234');
    expect(expr.toMathJson(opts)).toMatchInlineSnapshot(
      `1.2345678912345678901234`
    );
  });
  test(`Approximate numbers (range to infinity)`, () => {
    const expr = ce.parse('1.23456789e400');
    expect(expr.toMathJson(opts)).toMatchInlineSnapshot(`
      {
        num: 123456789e+392,
      }
    `);
  });
  test(`Approximate numbers (range to 0)`, () => {
    const expr = ce.parse('1.23456789e-400');
    expect(expr.toMathJson(opts)).toMatchInlineSnapshot(`1.23456789e-400`);
  });
  test(`Approximate numbers (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.toMathJson(opts)).toMatchInlineSnapshot(`1.(2345)`);
  });
});
