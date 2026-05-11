import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

describe('A2 — Interval extraction from When expressions', () => {
  test('extracts open bounds from When(f(x), a < x < b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x < 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
    expect(interval?.lowerStrict).toBe(true);
    expect(interval?.upperStrict).toBe(true);
  });

  test('extracts closed bounds from When(f(x), a <= x <= b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 \\le x \\le 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
    expect(interval?.lowerStrict).toBe(false);
    expect(interval?.upperStrict).toBe(false);
  });

  test('extracts mixed strictness from When(f(x), a < x <= b)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x \\le 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lowerStrict).toBe(true);
    expect(interval?.upperStrict).toBe(false);
  });

  test('extracts from When with And of comparisons', () => {
    const ce = new ComputeEngine();
    // Two stacked restrictions canonicalize to When(e, And(c1, c2))
    const expr = ce.parse('f(x)\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper?.re).toEqual(5);
  });

  test('handles one-sided bounds', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{x > 3\\right\\}');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(3);
    expect(interval?.upper).toBeUndefined();
  });

  test('returns undefined for non-restriction expressions', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x + 1').getInterval('x')).toBeUndefined();
    expect(ce.parse('\\sin(x)').getInterval('x')).toBeUndefined();
    expect(ce.parse('5').getInterval('x')).toBeUndefined();
  });

  test('returns undefined for unrelated symbol', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{0 < x < 5\\right\\}');
    expect(expr.getInterval('y')).toBeUndefined();
  });

  test('extracts from a bare comparison expression', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('0 < x');
    const interval = expr.getInterval('x');
    expect(interval).toBeDefined();
    expect(interval?.lower?.re).toEqual(0);
    expect(interval?.upper).toBeUndefined();
  });
});

describe('A2 — Compact piecewise parsing', () => {
  test('{cond:val, cond:val, default} parses to Which', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}');
    // Should produce Which(cond1, val1, cond2, val2, True, default)
    expect(expr.operator).toEqual('Which');
    const ops = expr.ops!;
    expect(ops.length).toEqual(6);
    expect(ops[0].operator).toEqual('Less');  // x > 0 canonicalizes to 0 < x → Less(0, x)
    expect(ops[1].re).toEqual(1);
    expect(ops[2].operator).toEqual('Less');
    expect(ops[3].re).toEqual(-1);
    expect(ops[4].symbol).toEqual('True');
    expect(ops[5].re).toEqual(0);
  });

  test('{cond:val, default} parses to Which', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1, 0\\right\\}');
    expect(expr.operator).toEqual('Which');
    expect(expr.ops!.length).toEqual(4);  // cond1, val1, True, default
  });

  test('{cond:val} (no default) parses to Which with implicit default', () => {
    // Desmos behavior: missing default = Undefined.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left\\{x > 0 : 1\\right\\}');
    expect(expr.operator).toEqual('Which');
    expect(expr.ops!.length).toEqual(2);  // cond1, val1
  });

  test('compact piecewise evaluates correctly', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 3);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(1);
    ce.assign('x', -3);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(-1);
    ce.assign('x', 0);
    expect(ce.parse('\\left\\{x > 0 : 1, x < 0 : -1, 0\\right\\}').evaluate().re).toEqual(0);
  });

  test('non-piecewise set literals still parse as Set', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{1, 2, 3\\}');
    expect(expr.operator).toEqual('Set');
    expect(expr.ops!.length).toEqual(3);
  });

  test('set-builder notation still parses correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{x \\mid x > 0\\}');
    expect(expr.operator).toEqual('Set');
    // Set-builder form: Set(x, Condition(x > 0))
    expect(expr.ops!.length).toEqual(2);
  });
});

describe('A2 — Multi-restriction GLSL verification', () => {
  test('stacked restrictions canonicalize to When(e, And(c1, c2))', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('f(x)\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    // The When may be wrapped in Multiply (per A2.1 finding).
    // Find the When in the AST.
    let when = expr.operator === 'When' ? expr : undefined;
    if (!when && expr.operator === 'Multiply') {
      when = expr.ops?.find((o) => o.operator === 'When');
    }
    expect(when).toBeDefined();
    expect(when!.op2.operator).toEqual('And');
    expect(when!.op2.ops!.length).toEqual(2);
  });

  test('stacked restrictions compile to a single chained ternary in GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const target = new GLSLTarget();
    const expr = ce.parse('x^2\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    // One ternary, not nested.
    const ternaryCount = (result.code.match(/\?/g) ?? []).length;
    expect(ternaryCount).toEqual(1);
  });

  test('stacked restrictions evaluate correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x^2\\left\\{x > 0\\right\\}\\left\\{x < 5\\right\\}');
    ce.assign('x', 3);
    const v1 = expr.evaluate();
    expect(v1.re).toEqual(9);
    ce.assign('x', -1);
    const v2 = expr.evaluate();
    expect(v2.symbol).toEqual('Undefined');
    ce.assign('x', 10);
    const v3 = expr.evaluate();
    expect(v3.symbol).toEqual('Undefined');
  });
});

describe('A2 — When(e, False) masking rule', () => {
  test('When(e, False) evaluates to Undefined', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['When', 42, 'False']);
    expect(expr.evaluate().symbol).toEqual('Undefined');
  });

  test('When(e, True) evaluates to e', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['When', 42, 'True']);
    expect(expr.evaluate().re).toEqual(42);
  });

  test('When(e, indeterminate) holds the form', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(['When', 'x', ['Less', 0, 'x']]);
    const result = expr.evaluate();
    expect(result.operator).toEqual('When');
  });
});
