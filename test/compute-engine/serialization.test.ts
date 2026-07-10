import { engine as ce } from '../utils';
import { BigDecimal } from '../../src/big-decimal';
import { toAsciiMath } from '../../src/compute-engine/boxed-expression/ascii-math';

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
  test(`Exact rationals (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.json).toMatchInlineSnapshot(`
      [
        Rational,
        12344,
        9999,
      ]
    `);
  });
});

describe('DEFAULT JSON SERIALIZATION', () => {
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.expr({ num: 'NaN' }).toMathJson({})).toMatchInlineSnapshot(
      `NaN`
    ));
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
  test(`Exact rationals (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`
      [
        Rational,
        12344,
        9999,
      ]
    `);
  });
});

describe('CUSTOM JSON SERIALIZATION', () => {
  // Nan, +Infinity, -Infinity are represented as symbols
  test(`Numeric symbols: Nan`, () =>
    expect(ce.expr({ num: 'NaN' }).toMathJson({})).toMatchInlineSnapshot(
      `NaN`
    ));
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

  test(`Exact rationals (repeating decimal)`, () => {
    const expr = ce.parse('1.(2345)');
    expect(expr.toMathJson({})).toMatchInlineSnapshot(`
      [
        Rational,
        12344,
        9999,
      ]
    `);
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
    expect(
      typeof result === 'string' || (result as any).latex === undefined
    ).toBe(true);
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

// REVIEW.md G6: BoxedString.json dropped the MathJSON '...' string delimiters
// for symbol-like content, so re-boxing the serialized JSON yielded a *symbol*
// instead of a string — a round-trip identity loss. A string literal must
// always be single-quote wrapped.
describe('String round-trip (REVIEW.md G6)', () => {
  for (const s of ['world', 'hello', 'hello world', '123', '']) {
    test(`ce.string(${JSON.stringify(s)}) round-trips as a string`, () => {
      const str = ce.string(s);
      const reboxed = ce.expr(str.json as any);
      expect(reboxed.type.toString()).toBe('string');
      expect(reboxed.string).toBe(s);
      expect(str.isSame(reboxed)).toBe(true);
    });
  }

  test('symbol-like string json is quoted, not bare', () => {
    expect(ce.string('world').json).toBe("'world'");
  });
});

// Display-digits control (`digits` option): significant figures and decimal
// places, applied at serialization time (a display concern, not the value).
describe('DISPLAY DIGITS', () => {
  const sig3 = { digits: { significant: 3 } } as const;
  const frac2 = { digits: { fractional: 2 } } as const;

  describe('toMathJson', () => {
    test('π (N) → 3 sig figs / 2 fractional', () => {
      const e = ce.parse('\\pi').N();
      expect(e.toMathJson(sig3)).toEqual('3.14');
      expect(e.toMathJson(frac2)).toEqual('3.14');
    });

    test('N(1/3) → 3 sig figs / 2 fractional', () => {
      const e = ce.parse('\\frac{1}{3}').N();
      expect(e.toMathJson(sig3)).toEqual('0.333');
      expect(e.toMathJson(frac2)).toEqual('0.33');
    });

    test('1500. (float) stays fixed notation (not 1.5e3)', () => {
      const e = ce.parse('1500.');
      // exact integer: significant is a no-op
      expect(e.toMathJson(sig3)).toEqual(1500);
      expect(e.toMathJson(frac2)).toEqual({ num: '1500.00' });
    });

    test('integer-valued floats (1500.0, 7.0) pad like bare integers', () => {
      // These parse to a pure-integer ExactNumericValue; `{ fractional }` must
      // still pad them, and `{ significant }` stays a no-op.
      const a = ce.parse('1500.0');
      expect(a.toMathJson(frac2)).toEqual({ num: '1500.00' });
      expect(a.toMathJson(sig3)).toEqual(1500);

      const b = ce.parse('7.0');
      expect(b.toMathJson(frac2)).toEqual({ num: '7.00' });
      expect(b.toMathJson(sig3)).toEqual(7);

      const c = ce.parse('123456.0');
      expect(c.toMathJson(frac2)).toEqual({ num: '123456.00' });
      expect(c.toMathJson(sig3)).toEqual(123456);
    });

    test('0.00123456 (float) → 3 sig figs / 2 fractional', () => {
      const e = ce.parse('0.00123456');
      expect(e.toMathJson(sig3)).toEqual('0.00123');
      expect(e.toMathJson(frac2)).toEqual('0.00');
    });

    test('123456 (exact int): significant is a no-op, fractional pads', () => {
      const e = ce.parse('123456');
      expect(e.toMathJson(sig3)).toEqual(123456);
      expect(e.toMathJson(frac2)).toEqual({ num: '123456.00' });
    });

    test('exact rational 1/3 stays a symbolic fraction', () => {
      const e = ce.parse('\\frac{1}{3}');
      expect(e.toMathJson(sig3)).toEqual(['Rational', 1, 3]);
      expect(e.toMathJson(frac2)).toEqual(['Rational', 1, 3]);
    });

    test('high precision (BigDecimal path): π to 5 sig figs', () => {
      const savedCE = ce.precision;
      const savedBD = BigDecimal.precision;
      try {
        ce.precision = 30;
        expect(
          ce
            .parse('\\pi')
            .N()
            .toMathJson({ digits: { significant: 5 } })
        ).toEqual('3.1416');
      } finally {
        ce.precision = savedCE;
        BigDecimal.precision = savedBD;
      }
    });
  });

  describe('toLatex', () => {
    test('π (N) → 3 sig figs / 2 fractional', () => {
      const e = ce.parse('\\pi').N();
      expect(e.toLatex(sig3)).toEqual('3.14');
      expect(e.toLatex(frac2)).toEqual('3.14');
    });

    test('exact rational 1/3 stays \\frac{1}{3}', () => {
      const e = ce.parse('\\frac{1}{3}');
      expect(e.toLatex(sig3)).toEqual('\\frac{1}{3}');
      expect(e.toLatex(frac2)).toEqual('\\frac{1}{3}');
    });
  });

  describe('AsciiMath', () => {
    test('π (N) → 3 sig figs / 2 fractional', () => {
      const e = ce.parse('\\pi').N();
      expect(toAsciiMath(e as any, sig3)).toEqual('3.14');
      expect(toAsciiMath(e as any, frac2)).toEqual('3.14');
    });

    test('exact integer: significant no-op, fractional pads', () => {
      const e = ce.parse('123456');
      expect(toAsciiMath(e as any, sig3)).toEqual('123456');
      expect(toAsciiMath(e as any, frac2)).toEqual('123456.00');
    });
  });

  describe('back-compat with fractionalDigits', () => {
    test('legacy fractionalDigits: n behaves as { fractional: n }', () => {
      const e = ce.parse('\\pi').N();
      expect(e.toMathJson({ fractionalDigits: 2 })).toEqual(
        e.toMathJson({ digits: { fractional: 2 } })
      );
    });

    test("digits: 'max' matches legacy fractionalDigits: 'max'", () => {
      const e = ce.parse('\\pi').N();
      expect(e.toMathJson({ digits: 'max' })).toEqual(
        e.toMathJson({ fractionalDigits: 'max' })
      );
    });

    test('digits takes precedence over fractionalDigits', () => {
      const e = ce.parse('\\pi').N();
      expect(
        e.toMathJson({ digits: { significant: 3 }, fractionalDigits: 6 })
      ).toEqual('3.14');
    });
  });

  // A bare number is not part of `DisplayDigits`, but it is an easy author
  // mistake (and the exact shape of a mechanical `fractionalDigits: n` →
  // `digits: n` migration), so it is accepted at runtime with the deprecated
  // numeric convention: n ≥ 0 = fractional digits, n < 0 = significant
  // digits. It previously crashed with `RangeError: The number NaN cannot be
  // converted to a BigInt` on a bignum-precision engine (Tycho, 0.72.0).
  describe('bare-number digits (Tycho 0.72.0 report)', () => {
    test('digits: n rounds to n fractional digits on a bignum engine', () => {
      expect(ce.parse('1/3').N().toLatex({ digits: 6 })).toEqual('0.333\\,333');
    });

    test('digits: -n rounds to n significant digits', () => {
      expect(ce.parse('\\pi').N().toLatex({ digits: -4 })).toEqual('3.142');
    });

    test('digits: n matches { fractional: n }', () => {
      const e = ce.parse('\\pi').N();
      expect(e.toLatex({ digits: 2 })).toEqual(
        e.toLatex({ digits: { fractional: 2 } })
      );
    });

    test('an invalid digits shape is a validation error, not a crash', () => {
      expect(() =>
        ce
          .parse('1/3')
          .N()
          .toLatex({ digits: { sig: 3 } })
      ).toThrow(/Invalid `digits` option/);
    });
  });
});
