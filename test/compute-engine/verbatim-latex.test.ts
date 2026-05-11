import { ComputeEngine } from '../../src/compute-engine';

describe('verbatimLatex: invalidation', () => {
  test('parsed expression has verbatimLatex when preserveLatex is on', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.verbatimLatex).toBe('p.x');
  });

  test('canonical of already-canonical preserves verbatimLatex', () => {
    // If the source already matches canonical form, .canonical may return
    // `this` — verbatimLatex stays. This is the easy case.
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.canonical.verbatimLatex).toBe('p.x');
  });

  test('non-canonical → canonical drops verbatimLatex when AST changes', () => {
    // Canonicalization folds 2 + 1 to 3: result AST differs from source.
    const ce = new ComputeEngine();
    const raw = ce.parse('2 + 1', { preserveLatex: true, form: 'raw' });
    expect(raw.verbatimLatex).toBe('2 + 1');
    expect(raw.canonical.verbatimLatex).toBeUndefined();
  });

  test('simplify() drops verbatimLatex on the result', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x + x', { preserveLatex: true });
    expect(expr.simplify().verbatimLatex).toBeUndefined();
  });

  test('substitute() drops verbatimLatex on the result', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x + 1', { preserveLatex: true });
    expect(expr.subs({ x: 2 }).verbatimLatex).toBeUndefined();
  });

  test('ce._fn() never inherits verbatimLatex from operands', () => {
    const ce = new ComputeEngine();
    const x = ce.parse('p.x', { preserveLatex: true });
    const fn = ce._fn('Negate', [x]);
    expect(fn.verbatimLatex).toBeUndefined();
  });

  test('ce.box() propagates verbatimLatex for atoms (sym/num/str)', () => {
    const ce = new ComputeEngine();
    expect(ce.box({ latex: 'auth-sym', sym: 'foo' }).verbatimLatex).toBe(
      'auth-sym'
    );
    expect(ce.box({ latex: 'auth-num', num: '5' }).verbatimLatex).toBe(
      'auth-num'
    );
  });

  test('evaluate() drops verbatimLatex when value changes', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('1 + 1', { preserveLatex: true });
    expect(expr.evaluate().verbatimLatex).toBeUndefined();
  });
});

describe('verbatimLatex: top-level preservation across parse paths', () => {
  // The contract is: verbatimLatex is set only when an expression was
  // directly parsed from that exact LaTeX source. Function expressions
  // whose canonical handler reconstructs the result via ce._fn(...)
  // (e.g. Sin, Add) do not currently propagate parse-time metadata.
  // These tests document the current behavior so future improvements
  // can build on a known baseline.

  test('symbol expression preserves verbatim at top level', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x', { preserveLatex: true }).verbatimLatex).toBe('x');
  });

  test('function without custom canonical handler preserves verbatim', () => {
    // `p.x` parses to `First(p)`. First has no canonical handler, so the
    // default path in boxFunction propagates metadata to the result.
    const ce = new ComputeEngine();
    expect(ce.parse('p.x', { preserveLatex: true }).verbatimLatex).toBe('p.x');
  });

  test('function with custom canonical handler drops verbatim (Sin)', () => {
    // Documents the over-invalidation gap. trigFunction's canonical
    // handler calls ce._fn(op, ops) without threading metadata through.
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\sin(x)', { preserveLatex: true }).verbatimLatex
    ).toBeUndefined();
  });

  test('Add with symbols drops verbatim (over-invalidation gap)', () => {
    // Same root cause as Sin: canonicalAdd doesn't receive metadata.
    const ce = new ComputeEngine();
    expect(
      ce.parse('x + y', { preserveLatex: true }).verbatimLatex
    ).toBeUndefined();
  });

  test('structural form preserves verbatim for function expressions', () => {
    // form: 'structural' bypasses canonical handlers, so metadata flows
    // through to the constructed BoxedFunction.
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\sin(x)', { preserveLatex: true, form: 'structural' })
        .verbatimLatex
    ).toBe('\\sin(x)');
  });
});

describe('toLatex({ verbatim: true })', () => {
  test('returns verbatim source when set', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.toLatex({ verbatim: true })).toBe('p.x');
  });

  test('default toLatex() does not use verbatim (opt-in only)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    // Default behavior is unchanged: re-serializes from canonical AST.
    // For `p.x` the canonical is `First(p)`, which serializes as
    // \operatorname{First}(p) unless dotNotation is on.
    expect(expr.toLatex()).not.toBe('p.x');
  });

  test('.latex getter does not use verbatim (opt-in only)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.latex).not.toBe('p.x');
  });

  test('falls back to re-serialization when no verbatim available', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', 'x', 1]); // no verbatim
    const latex = expr.toLatex({ verbatim: true });
    expect(typeof latex).toBe('string');
    expect(latex).toContain('x');
  });

  test('verbatim: false (or omitted) falls through to re-serialization', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.toLatex({ verbatim: false })).not.toBe('p.x');
  });

  test('verbatim wins over dotNotation when both are set', () => {
    // verbatim is the most-explicit "give me the source" opt-in, so it
    // short-circuits before the serializer sees other options.
    const ce = new ComputeEngine();
    const expr = ce.parse('p.x', { preserveLatex: true });
    expect(expr.toLatex({ verbatim: true, dotNotation: false })).toBe('p.x');
  });

  test('verbatim preserved through lazy collection materialization', () => {
    // Numbers and symbols preserve verbatim; lazy materialization
    // shouldn't lose it before the verbatim check fires.
    const ce = new ComputeEngine();
    const expr = ce.parse('x', { preserveLatex: true });
    expect(expr.toLatex({ verbatim: true })).toBe('x');
  });
});
