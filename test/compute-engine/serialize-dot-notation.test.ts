import { ComputeEngine } from '../../src/compute-engine';

describe('Serializer: dotNotation option', () => {
  test('default (off): First serializes as function call', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['First', 'p']).toLatex()).not.toContain('.x');
  });

  test('on: First serializes as p.x', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    expect(ce.box(['First', 'p']).toLatex()).toBe('p.x');
  });

  test('on: Second → .y, Third → .z', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    expect(ce.box(['Second', 'p']).toLatex()).toBe('p.y');
    expect(ce.box(['Third', 'p']).toLatex()).toBe('p.z');
  });

  test('on: Length, Sum, Max, Min serialize with operator-name dot form', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    expect(ce.box(['Length', 'L']).toLatex()).toBe('L.\\operatorname{count}');
    expect(ce.box(['Sum', 'L']).toLatex()).toBe('L.\\operatorname{total}');
    expect(ce.box(['Max', 'L']).toLatex()).toBe('L.\\max');
    expect(ce.box(['Min', 'L']).toLatex()).toBe('L.\\min');
  });

  test('on: Real, Imaginary use \\operatorname form', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    expect(ce.box(['Real', 'z']).toLatex()).toBe('z.\\operatorname{real}');
    expect(ce.box(['Imaginary', 'z']).toLatex()).toBe('z.\\operatorname{imag}');
  });

  test('round-trip: parse p.x then toLatex with dotNotation should give p.x back', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    const expr = ce.parse('p.x');
    expect(expr.toLatex()).toBe('p.x');
  });

  test('round-trip: chained component access', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    const expr = ce.parse('p.x.\\operatorname{real}');
    // Should round-trip to something parseable that gives the same AST.
    const back = expr.toLatex();
    expect(ce.parse(back).json).toEqual(['Real', ['First', 'p']]);
  });

  test('on: multi-arg Sum (with index) still uses standard form', () => {
    // Sum(body, Tuple(i, lo, hi)) is the BigOp form; should NOT serialize as dot.
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    const expr = ce.box(['Sum', ['Power', 'i', 2], ['Tuple', 'i', 1, 10]]);
    const latex = expr.toLatex();
    // Should be \sum form, not dot form
    expect(latex).not.toMatch(/^\(.+\)\.\\operatorname\{total\}$/);
  });

  test('parens needed: (x + y).count', () => {
    const ce = new ComputeEngine();
    ce.latexOptions = { dotNotation: true };
    const expr = ce.box(['Length', ['Add', 'x', 'y']]);
    const latex = expr.toLatex();
    // Should contain parens around the Add and the dot suffix
    expect(latex).toContain('.\\operatorname{count}');
    expect(latex).toMatch(/\(.*\+.*\)/);
  });

  test('per-call option override', () => {
    const ce = new ComputeEngine();
    // Engine-wide is off, per-call turns it on
    expect(ce.box(['First', 'p']).toLatex({ dotNotation: true })).toBe('p.x');
    // Engine-wide off means default call has standard form
    expect(ce.box(['First', 'p']).toLatex()).not.toBe('p.x');
  });
});
