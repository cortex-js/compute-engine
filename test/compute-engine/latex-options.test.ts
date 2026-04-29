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
  // `expr.toMathJson({ metadata: ['all'] })`. It bypasses the
  // engine-level parse/toLatex paths and goes through six call sites
  // that all funnel into `_serializeLatexMetadata(ce, ...)`.

  test('number metadata respects ce.latexOptions', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };

    const result = ce.number(3.14).toMathJson({ metadata: ['all'] });
    // Result is { num, latex } (or a similar shape with a latex field)
    const latex = (result as { latex?: string }).latex;
    expect(latex).toBeDefined();
    expect(latex).toContain('{,}');
  });

  test('function metadata respects ce.latexOptions', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { decimalSeparator: '{,}' };

    const expr = ce.parse('1.5 + 2', { decimalSeparator: '.' });
    const result = expr.toMathJson({ metadata: ['all'] });
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
    const result = ce.symbol('x').toMathJson({ metadata: ['all'] });
    const latex = (result as { latex?: string }).latex;
    expect(latex).toBeDefined();
    expect(latex).toContain('x');
  });
});
