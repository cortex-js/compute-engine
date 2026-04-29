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
    expect(ce.expr({ num: 'NaN' }).json).toMatchInlineSnapshot(`NaN`));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.expr({ num: '+infinity' }).json).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.expr({ num: '-infinity' }).json).toMatchInlineSnapshot(
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
    expect(expr.json).toMatchObject({ num: '1.23456789e+400' });
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
    expect(ce.expr({ num: 'NaN' }).toMathJson({})).toMatchInlineSnapshot(`NaN`));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.expr({ num: '+infinity' }).toMathJson({})).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.expr({ num: '-infinity' }).toMathJson({})).toMatchInlineSnapshot(
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
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.23456789e+400`);
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
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.expr({ num: 'NaN' }).toMathJson({})).toMatchInlineSnapshot(`NaN`));
  test(`Numeric symbols: +Infinity`, () =>
    expect(ce.expr({ num: '+infinity' }).toMathJson({})).toMatchInlineSnapshot(
      `PositiveInfinity`
    ));
  test(`Numeric symbols: -Infinity`, () =>
    expect(ce.expr({ num: '-infinity' }).toMathJson({})).toMatchInlineSnapshot(
      `NegativeInfinity`
    ));

  test(`No prettification`, () => {
    const expr = ce.parse('\\frac{\\sqrt{x^2-1}}{2}');
    expect(expr.toMathJson({ prettify: false })).toMatchInlineSnapshot(`
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

  test(`Approximate numbers (precision), with custom precision`, () => {
    const expr = ce.parse('1.2345678912345678901234');
    expect(expr.toMathJson({ fractionalDigits: 6 })).toMatchInlineSnapshot(
      `1.234568`
    );
  });
  test(`Approximate numbers (range to infinity)`, () => {
    const expr = ce.parse('1.23456789e400');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.23456789e+400`);
  });
  test(`Approximate numbers (range to 0)`, () => {
    const expr = ce.parse('1.23456789e-400');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.23456789e-400`);
  });

  test(`Approximate numbers (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`1.(2345)`);
  });

  // test(`Custom invisible multiply`, () => {
  //   const expr = ce.parse('2x');
  //   expect(expr.toMathJson(opts)).toMatchInlineSnapshot();
  // });

  test(`No shorthands`, () => {
    const expr = ce.parse('2x+\\sin(x+1)');
    expect(expr.toMathJson({ shorthands: [] })).toMatchInlineSnapshot(`
      {
        fn: [
          Add,
          {
            fn: [
              Multiply,
              {
                num: 2,
              },
              {
                sym: x,
              },
            ],
          },
          {
            fn: [
              Sin,
              {
                fn: [
                  Add,
                  {
                    sym: x,
                  },
                  {
                    num: 1,
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });

  test(`No Sqrt`, () => {
    const expr = ce.parse('\\sqrt{x+1}');
    expect(expr.toMathJson({ exclude: ['Sqrt'] })).toMatchInlineSnapshot(`
      [
        Power,
        [
          Add,
          x,
          1,
        ],
        [
          Rational,
          1,
          2,
        ],
      ]
    `);
  });
});

describe('toMathJson metadata option', () => {
  // Regression: passing metadata: ['latex'] (or ['wikidata']) used to be
  // silently dropped because defaultOptions.metadata stayed []. Only
  // metadata: ['all'] worked. Fixed by adding an Array.isArray() branch.

  test(`metadata: ['latex'] populates the latex field`, () => {
    const expr = ce.number(3.14);
    const result = expr.toMathJson({ metadata: ['latex'] }) as {
      latex?: string;
      wikidata?: string;
    };
    expect(result.latex).toBeDefined();
    expect(result.wikidata).toBeUndefined();
  });

  test(`metadata: ['wikidata'] populates the wikidata field, not latex`, () => {
    // Pi has a wikidata entry
    const expr = ce.symbol('Pi');
    const result = expr.toMathJson({ metadata: ['wikidata'] }) as {
      latex?: string;
      wikidata?: string;
    };
    expect(result.wikidata).toBeDefined();
    expect(result.latex).toBeUndefined();
  });

  test(`metadata: ['all'] populates both fields (legacy behavior preserved)`, () => {
    const expr = ce.symbol('Pi');
    const result = expr.toMathJson({ metadata: ['all'] }) as {
      latex?: string;
      wikidata?: string;
    };
    expect(result.latex).toBeDefined();
    expect(result.wikidata).toBeDefined();
  });

  test(`metadata: [] populates neither field (default)`, () => {
    const expr = ce.symbol('Pi');
    // With shorthand allowed and no metadata, a symbol is shorthanded to a string
    const result = expr.toMathJson({ metadata: [] });
    expect(typeof result === 'string' || (result as any).latex === undefined)
      .toBe(true);
  });
});

describe('toMathJson shorthands option', () => {
  // Regression: passing shorthands: ['all'] used to be silently broken.
  // The 'all' branch correctly expanded defaultOptions.shorthands, but a
  // following unconditional `if (Array.isArray(...))` overwrote it back
  // to the literal `['all']` (which matches no actual shorthand kind),
  // effectively disabling all shorthands. Fixed by changing the second
  // `if` to `else if`.

  test(`shorthands: ['all'] enables shorthands (array form)`, () => {
    const expr = ce.parse('1 + x');
    // With shorthands enabled, an Add of a number and a symbol uses the
    // function-shorthand array form rather than the verbose { fn: [...] } shape.
    const result = expr.toMathJson({ shorthands: ['all'] });
    expect(Array.isArray(result)).toBe(true);
  });

  test(`shorthands: 'all' (string) enables shorthands`, () => {
    const expr = ce.parse('1 + x');
    const result = expr.toMathJson({ shorthands: 'all' as any });
    expect(Array.isArray(result)).toBe(true);
  });

  test(`shorthands: [] disables all shorthands`, () => {
    const expr = ce.parse('1 + x');
    const result = expr.toMathJson({ shorthands: [] });
    // Without function shorthand, Add becomes { fn: [...] } object form.
    expect(typeof result).toBe('object');
    expect(Array.isArray(result)).toBe(false);
  });

  test(`shorthands: ['function'] enables only function shorthand`, () => {
    const expr = ce.parse('1 + x');
    const result = expr.toMathJson({ shorthands: ['function'] });
    // Function shorthand kicks in: the result is a flat array
    expect(Array.isArray(result)).toBe(true);
  });
});
