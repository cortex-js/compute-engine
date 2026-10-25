/**
 * Tests for engine-level LaTeX options:
 *   - `latexSyntax` constructor option (instance-level defaults take effect)
 *   - `latexOptions` constructor option / mutable property (post-construction)
 *   - Per-call options on `ce.parse()` / `expr.toLatex()` override both
 */

import { ComputeEngine, LatexSyntax } from '../../src/compute-engine';

describe('ce.latexSyntax instance defaults take effect', () => {
  test('decimalSeparator from injected LatexSyntax is honored by ce.parse()', () => {
    const ce = new ComputeEngine({
      latexSyntax: new LatexSyntax({ decimalSeparator: '{,}' }),
    });

    const expr = ce.parse('3{,}14');
    expect(expr.isNumberLiteral).toBe(true);
    expect(expr.re).toBeCloseTo(3.14, 6);
  });

  test('decimalSeparator from injected LatexSyntax is honored by expr.toLatex()', () => {
    const ce = new ComputeEngine({
      latexSyntax: new LatexSyntax({ decimalSeparator: '{,}' }),
    });

    const expr = ce.number(3.14);
    expect(expr.toLatex()).toContain('{,}');
  });
});

describe('ce.latexOptions constructor option', () => {
  test('decimalSeparator applies to parse', () => {
    const ce = new ComputeEngine({
      latexOptions: { decimalSeparator: '{,}' },
    });

    const expr = ce.parse('3{,}14');
    expect(expr.isNumberLiteral).toBe(true);
    expect(expr.re).toBeCloseTo(3.14, 6);
  });

  test('decimalSeparator applies to .latex and toLatex()', () => {
    const ce = new ComputeEngine({
      latexOptions: { decimalSeparator: '{,}' },
    });

    const expr = ce.number(3.14);
    expect(expr.latex).toContain('{,}');
    expect(expr.toLatex()).toContain('{,}');
  });
});

describe('ce.latexOptions mutable post-construction', () => {
  test('decimalSeparator can be changed after construction', () => {
    const ce = new ComputeEngine();

    // Default: dot
    const before = ce.parse('3.14');
    expect(before.re).toBeCloseTo(3.14, 6);

    // Switch to comma
    ce.latexOptions = { decimalSeparator: '{,}' };
    const after = ce.parse('3{,}14');
    expect(after.re).toBeCloseTo(3.14, 6);

    // Serialization also uses the new separator
    expect(ce.number(2.5).latex).toContain('{,}');
  });

  test('latexOptions getter returns the configured bag', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };
    expect(ce.latexOptions.decimalSeparator).toBe('{,}');
  });

  test('assigning latexOptions replaces the whole bag', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}', digitGroupSeparator: ' ' };
    ce.latexOptions = { decimalSeparator: '.' };
    expect(ce.latexOptions.decimalSeparator).toBe('.');
    expect(ce.latexOptions.digitGroupSeparator).toBeUndefined();
  });
});

describe('Per-call options override engine-wide latexOptions', () => {
  test('ce.parse() per-call decimalSeparator wins', () => {
    const ce = new ComputeEngine({
      latexOptions: { decimalSeparator: '{,}' },
    });

    const expr = ce.parse('3.14', { decimalSeparator: '.' });
    expect(expr.re).toBeCloseTo(3.14, 6);
  });

  test('expr.toLatex() per-call decimalSeparator wins', () => {
    const ce = new ComputeEngine({
      latexOptions: { decimalSeparator: '{,}' },
    });

    const expr = ce.number(3.14);
    expect(expr.toLatex({ decimalSeparator: '.' })).toContain('3.14');
  });
});

describe('Engine latexOptions overrides LatexSyntax instance defaults', () => {
  test('ce.latexOptions wins over injected LatexSyntax defaults', () => {
    const ce = new ComputeEngine({
      latexSyntax: new LatexSyntax({ decimalSeparator: '{,}' }),
      latexOptions: { decimalSeparator: '.' },
    });

    // Engine-level option wins
    const expr = ce.parse('3.14');
    expect(expr.re).toBeCloseTo(3.14, 6);
  });
});

describe('latexOptions threads through MathJSON metadata serialization', () => {
  // The latex metadata path in serialize.ts is reached via
  // `expr.toMathJson({ metadata: ['latex'] })`. It bypasses the
  // engine-level parse/toLatex paths and goes through six call sites
  // that all funnel into `_serializeLatexMetadata(ce, ...)`.

  test('number metadata respects ce.latexOptions', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };

    const result = ce.number(3.14).toMathJson({ metadata: ['latex'] });
    // Result is { num, latex } (or a similar shape with a latex field)
    const latex = (result as { latex?: string }).latex;
    expect(latex).toBeDefined();
    expect(latex).toContain('{,}');
  });

  test('function metadata respects ce.latexOptions', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };

    const expr = ce.parse('1.5 + 2', { decimalSeparator: '.' });
    const result = expr.toMathJson({ metadata: ['latex'] });
    // The top-level fn metadata, plus any nested numeric latex,
    // should use the comma separator. Stringify and look for it.
    const json = JSON.stringify(result);
    expect(json).toContain('{,}');
  });

  test('symbol metadata path does not break with latexOptions set', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };

    // Symbols don't use decimalSeparator, but the path still runs through
    // _serializeLatexMetadata. Just verify no throw + latex is populated.
    const result = ce.symbol('x').toMathJson({ metadata: ['latex'] });
    const latex = (result as { latex?: string }).latex;
    expect(latex).toBeDefined();
    expect(latex).toContain('x');
  });
});

describe('Style options accept a constant as well as a function', () => {
  test('rootStyle as a string matches the function form', () => {
    const ce = new ComputeEngine();

    ce.latexOptions = { rootStyle: () => 'solidus' };
    const fnForm = ce.parse('\\sqrt{x}').latex;

    ce.latexOptions = { rootStyle: 'solidus' };
    const stringForm = ce.parse('\\sqrt{x}').latex;

    expect(stringForm).toEqual('x^{1/2}');
    expect(stringForm).toEqual(fnForm);
  });

  test('fractionStyle as a string matches the function form', () => {
    const ce = new ComputeEngine();

    ce.latexOptions = { fractionStyle: () => 'inline-solidus' };
    const fnForm = ce.parse('\\frac{a}{b}').latex;

    ce.latexOptions = { fractionStyle: 'inline-solidus' };
    const stringForm = ce.parse('\\frac{a}{b}').latex;

    expect(stringForm).toEqual('a/b');
    expect(stringForm).toEqual(fnForm);
  });

  test('indexStyle as a string matches the function form', () => {
    const ce = new ComputeEngine();

    ce.latexOptions = { indexStyle: () => 'subscript' };
    const fnForm = ce.box(['At', 'v', 1]).latex;

    ce.latexOptions = { indexStyle: 'subscript' };
    const stringForm = ce.box(['At', 'v', 1]).latex;

    expect(stringForm).toEqual(fnForm);
    expect(stringForm).toContain('_1');
  });

  test('a constant style passed to the constructor is honored', () => {
    const ce = new ComputeEngine({ latexOptions: { rootStyle: 'solidus' } });
    expect(ce.parse('\\sqrt{x}').latex).toEqual('x^{1/2}');
  });

  test('a constant style passed per-call is honored', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sqrt{x}').toLatex({ rootStyle: 'solidus' })).toEqual(
      'x^{1/2}'
    );
  });

  test('an invalid constant throws when the option is set', () => {
    const ce = new ComputeEngine();
    expect(() => {
      ce.latexOptions = { rootStyle: 'sold' as any };
    }).toThrow(/rootStyle/);
    // The engine is left usable, with the previous options
    expect(ce.parse('\\sqrt{x}').latex).toEqual('\\sqrt{x}');
  });

  test('an invalid constant throws from the constructor', () => {
    expect(
      () =>
        new ComputeEngine({ latexOptions: { fractionStyle: 'nope' as any } })
    ).toThrow(/fractionStyle/);
  });
});

describe('solidus/quotient root style over a Power base (Tycho item 113)', () => {
  // The exponent-spelled root styles must delimit a base that is itself a
  // Power: bare `x^2^{1/2}` is unparsable LaTeX (`unexpected-superscript`),
  // so the base is parenthesized — `(x^2)^{1/2}` — like the generic Power
  // path.
  const shapes: [string, unknown][] = [
    ['Sqrt(Power)', ['Sqrt', ['Power', 'x', 2]]],
    ['Root(Power, 3)', ['Root', ['Power', 'x', 2], 3]],
    ['nested Sqrt', ['Sqrt', ['Sqrt', ['Power', 'x', 2]]]],
  ];
  for (const style of ['solidus', 'quotient'] as const) {
    for (const [label, json] of shapes) {
      test(`${label} round-trips under rootStyle '${style}'`, () => {
        const ce = new ComputeEngine();
        ce.latexOptions = { rootStyle: () => style };
        const expr = ce.box(json as any, { canonical: false });
        // The reparse spells the root as a fractional Power; compare
        // canonically (`x^2^{1/2}` used to reparse as an Error instead).
        const reparsed = ce.parse(expr.toLatex());
        expect(reparsed.isValid).toBe(true);
        expect(reparsed.isSame(expr.canonical)).toBe(true);
      });
    }
  }

  test('the solidus witness parenthesizes the Power base', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { rootStyle: () => 'solidus' };
    expect(
      ce.box(['Sqrt', ['Power', 'x', 2]], { canonical: false }).toLatex()
    ).toEqual('(x^2)^{1/2}');
  });
});

describe('Tycho item 145 — `invisibleMultiply` and `\\bmod` parenthesization', () => {
  // `\bmod` (DIVISION_PRECEDENCE) binds LOOSER than juxtaposition, so `fk\bmod
  // 1` re-parses as `Mod(fk, 1)` with no parens needed. But when
  // `invisibleMultiply` is an explicit token, the product serializes with an
  // infix operator at MULTIPLICATION_PRECEDENCE, which re-parses LOOSER than
  // `\bmod` — the operand must then be parenthesized.
  const modProduct = ['Mod', ['Multiply', 'k', 'f'], 1] as any;

  test('the default (invisible) serialization is unchanged', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(modProduct);
    expect(expr.toLatex()).toEqual('fk\\bmod1');
    expect(ce.parse(expr.toLatex()).json).toEqual([
      'Mod',
      ['Multiply', 'f', 'k'],
      1,
    ]);
  });

  test('an explicit `invisibleMultiply` parenthesizes the lhs product', () => {
    const ce = new ComputeEngine();
    const tex = ce.box(modProduct).toLatex({ invisibleMultiply: '\\cdot' });
    expect(tex).toEqual('(f\\cdot k)\\bmod1');
    expect(ce.parse(tex).json).toEqual(['Mod', ['Multiply', 'f', 'k'], 1]);
  });

  test('an explicit `invisibleMultiply` parenthesizes the rhs product', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Mod', 5, ['Multiply', 'k', 'f']] as any);
    const tex = expr.toLatex({ invisibleMultiply: '\\times' });
    expect(tex).toEqual('5\\bmod(f\\times k)');
    expect(ce.parse(tex).json).toEqual(['Mod', 5, ['Multiply', 'f', 'k']]);
  });

  test('non-product operands are unaffected by the override', () => {
    const ce = new ComputeEngine();
    // An `Add` operand is parenthesized either way; a fraction is not.
    expect(
      ce.box(['Mod', ['Add', 'x', 5], 2] as any).toLatex({
        invisibleMultiply: '\\cdot',
      })
    ).toEqual('(x+5)\\bmod2');
    expect(
      ce.box(['Mod', ['Divide', 'x', 5], 2] as any).toLatex({
        invisibleMultiply: '\\cdot',
      })
    ).toEqual('\\frac{x}{5}\\bmod2');
  });
});

// A standalone `LatexSyntax` serializer has no MathJSON step and no engine
// precision, so it applies `digits` itself: `{ fractional: n }` and
// `{ significant: n }` round a float number literal; an exact number is
// written in full; `"auto"` and `"max"` write every digit. (It replaces the
// removed `fractionalDigits` constructor option, which cut the digits and
// wrote a `\ldots` marker.)
describe('standalone LatexSyntax digits', () => {
  test('{ fractional: n } rounds a float, as a string or a JSON number', () => {
    const s = new LatexSyntax({ digits: { fractional: 3 } });
    expect(s.serialize({ num: '3.14159265' })).toBe('3.142');
    expect(s.serialize(3.14159265)).toBe('3.142');
    expect(s.serialize({ num: '2.0' })).toBe('2.000');
  });

  test('an exact number is written in full', () => {
    const s = new LatexSyntax({ digits: { fractional: 3 } });
    expect(s.serialize(314)).toBe('314');
    expect(s.serialize({ num: '0.(3)' })).toBe('0.\\overline{3}');
  });

  test('{ fractional: 0 } gives an integer spelling', () => {
    const s = new LatexSyntax({ digits: { fractional: 0 } });
    expect(s.serialize({ num: '2.7' })).toBe('3');
  });

  test('{ significant: n } rounds to n significant digits', () => {
    const s = new LatexSyntax({ digits: { significant: 4 } });
    // The integer-valued result keeps a float spelling, as in `toMathJson()`
    // (`"12350.0"`), so that it is not read back as an exact integer.
    expect(s.serialize({ num: '12345.678' })).toBe('12\\,350.0');
  });

  test('a per-call digits overrides the constructor option', () => {
    expect(
      new LatexSyntax().serialize(
        { num: '1.23456' },
        { digits: { fractional: 2 } }
      )
    ).toBe('1.23');
  });

  test('without digits, every digit is written', () => {
    expect(new LatexSyntax().serialize({ num: '1.23456789' })).toBe(
      '1.234\\,567\\,89'
    );
  });
});

// The LaTeX layer rounds a float with the rules of the MathJSON
// serialization, so `toLatex()` (which rounds at both steps) and a
// standalone serializer agree with `toMathJson()`.
describe('LaTeX digits follow the MathJSON rounding rules', () => {
  const sig3 = { digits: { significant: 3 } } as const;

  test('{ significant: n } keeps an integer-valued float and its float spelling', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('123456.0').toMathJson(sig3)).toBe('123456.0');
    expect(ce.parse('123456.0').toLatex(sig3)).toBe('123\\,456.0');
    expect(ce.parse('123.456').toMathJson(sig3)).toBe('123.0');
    expect(ce.parse('123.456').toLatex(sig3)).toBe('123.0');
    const s = new LatexSyntax(sig3);
    expect(s.serialize({ num: '123.456' })).toBe('123.0');
    expect(s.serialize({ num: '123456.0' })).toBe('123\\,456.0');
  });

  test('a count of more than 100 significant digits keeps the number', () => {
    const ce = new ComputeEngine();
    const d = { digits: { significant: 150 } } as const;
    expect(ce.box(['Add', 0.1, 'x']).toLatex(d)).toBe('x+0.1');
    expect(new LatexSyntax(d).serialize(['Add', 0.1, 'x'])).toBe('0.1+x');
  });

  test('a float written with a negative exponent is rounded', () => {
    const s = new LatexSyntax({ digits: { fractional: 2 } });
    expect(s.serialize({ num: '1e-5' })).toBe('0.00');
    expect(s.serialize({ num: '12e-3' })).toBe('0.01');
  });

  test('a JSON number and a number string round the same way, and -0 is 0', () => {
    const s0 = new LatexSyntax({ digits: { fractional: 0 } });
    expect(s0.serialize(2.5)).toBe(s0.serialize({ num: '2.5' }));
    const s2 = new LatexSyntax({ digits: { fractional: 2 } });
    expect(s2.serialize(-0.000123456)).toBe('0.00');
  });

  test('a number string with no digit after the point is written with one', () => {
    expect(new LatexSyntax().serialize({ num: '5.' })).toBe('5.0');
  });
});

describe('engine-wide digits validation and cache', () => {
  test('an invalid ce.latexOptions.digits throws when it is set', () => {
    const ce = new ComputeEngine();
    expect(() => {
      ce.latexOptions = { digits: 3 as any };
    }).toThrow(/Invalid `digits` option/);
  });

  test('a change of ce.latexOptions.digits made in place is not served from the cache', () => {
    const ce = new ComputeEngine();
    const x = ce.number(1.23456);
    ce.latexOptions = { ...ce.latexOptions, digits: { fractional: 2 } };
    expect(x.latex).toBe('1.23');
    (ce.latexOptions.digits as { fractional: number }).fractional = 3;
    expect(x.latex).toBe('1.235');
  });
});
