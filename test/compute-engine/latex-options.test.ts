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
      () => new ComputeEngine({ latexOptions: { fractionStyle: 'nope' as any } })
    ).toThrow(/fractionStyle/);
  });
});

describe('solidus/quotient root style over a Power base (Tycho item 113)', () => {
  // The exponent-spelled root styles must delimit a base that is itself a
  // Power: bare `x^2^{1/2}` is unparsable LaTeX (`unexpected-superscript`),
  // so the base is braced — `{x^2}^{1/2}` — like the generic Power path.
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

  test('the solidus witness braces the Power base', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { rootStyle: () => 'solidus' };
    expect(
      ce.box(['Sqrt', ['Power', 'x', 2]], { canonical: false }).toLatex()
    ).toEqual('{x^2}^{1/2}');
  });
});
