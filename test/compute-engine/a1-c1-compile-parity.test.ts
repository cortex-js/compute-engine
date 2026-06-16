/**
 * A1 — First/Second/Third / Range compile parity tests.
 *
 * Verifies that the AST nodes produced by p.x / p.y / p.z
 * (First/Second/Third) and Range compile correctly to both JS and GLSL targets.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

describe('A1 — First/Second/Third compile', () => {
  describe('JS target', () => {
    test('First compiles to JS array index 0', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number>');
      const result = compile(ce.parse('p.x'));
      expect(result?.success).toBe(true);
      expect(result?.code).toBe('_.p[0]');
      expect(result?.run?.({ p: [10, 20] })).toEqual(10);
    });

    test('Second compiles to JS array index 1', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number>');
      const result = compile(ce.parse('p.y'));
      expect(result?.success).toBe(true);
      expect(result?.code).toBe('_.p[1]');
      expect(result?.run?.({ p: [10, 20] })).toEqual(20);
    });

    test('Third compiles to JS array index 2', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number, number>');
      const result = compile(ce.parse('p.z'));
      expect(result?.success).toBe(true);
      expect(result?.code).toBe('_.p[2]');
      expect(result?.run?.({ p: [10, 20, 30] })).toEqual(30);
    });

    test('First in a larger expression compiles cleanly', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number>');
      // Distance from origin to p: sqrt(p.x^2 + p.y^2)
      const result = compile(ce.parse('\\sqrt{p.x^2 + p.y^2}'));
      expect(result?.success).toBe(true);
      expect(result?.run?.({ p: [3, 4] })).toBeCloseTo(5);
    });
  });

  describe('GLSL target', () => {
    const glsl = new GLSLTarget();

    test('First compiles to .x swizzle in GLSL', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number>');
      const result = glsl.compile(ce.parse('p.x'));
      expect(result.success).toBe(true);
      expect(result.code).toBe('p.x');
    });

    test('Second compiles to .y swizzle in GLSL', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number>');
      const result = glsl.compile(ce.parse('p.y'));
      expect(result.success).toBe(true);
      expect(result.code).toBe('p.y');
    });

    test('Third compiles to .z swizzle in GLSL', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'tuple<number, number, number>');
      const result = glsl.compile(ce.parse('p.z'));
      expect(result.success).toBe(true);
      expect(result.code).toBe('p.z');
    });
  });
});

describe('A1 — Range GPU compile', () => {
  test('Range(1, 5) compiles to a small constant array in GLSL', () => {
    const ce = new ComputeEngine();
    const glslTarget = new GLSLTarget();
    const expr = ce.parse('\\operatorname{Range}(1, 5)');
    const result = glslTarget.compile(expr);
    expect(result.success).toBe(true);
    // Expect float[5](...) literal with all five values
    expect(result.code).toMatch(/float\[5\]/);
    expect(result.code).toMatch(/1\.0,\s*2\.0,\s*3\.0,\s*4\.0,\s*5\.0/);
  });

  test('Range(1, 5) compiles to a small constant array in WGSL', () => {
    const ce = new ComputeEngine();
    const wgslTarget = new WGSLTarget();
    const expr = ce.parse('\\operatorname{Range}(1, 5)');
    const result = wgslTarget.compile(expr);
    expect(result.success).toBe(true);
    // Expect array<f32, 5>(...) literal with all five values
    expect(result.code).toMatch(/array<f32,\s*5>/);
    expect(result.code).toMatch(/1\.0,\s*2\.0,\s*3\.0,\s*4\.0,\s*5\.0/);
  });

  test('Range(2, 8, 2) compiles with custom step in GLSL', () => {
    const ce = new ComputeEngine();
    const glslTarget = new GLSLTarget();
    const expr = ce.parse('\\operatorname{Range}(2, 8, 2)');
    const result = glslTarget.compile(expr);
    expect(result.success).toBe(true);
    // [2, 4, 6, 8] → float[4](2.0, 4.0, 6.0, 8.0)
    expect(result.code).toMatch(/float\[4\]/);
    expect(result.code).toMatch(/2\.0,\s*4\.0,\s*6\.0,\s*8\.0/);
  });

  test('Range(1, n) with non-constant upper bound throws in GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const glslTarget = new GLSLTarget();
    const expr = ce.parse('\\operatorname{Range}(1, n)');
    expect(() => glslTarget.compile(expr)).toThrow();
  });

  test('Range with non-integer step preserves precision', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{Range}(0, 1, 0.25)');
    const result = target.compile(expr);
    // Should contain 0.25 (not "0.3" from toFixed(1) truncation)
    expect(result.code).toContain('0.25');
  });

  test('Range with empty bounds throws', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{Range}(5, 1)'); // lo > hi, positive step
    expect(() => target.compile(expr)).toThrow(/empty range/i);
  });
});

describe('A1 — Variance/GCD/Median GPU compile', () => {
  test('Variance compiles for a constant-size list in GLSL', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{var}([1, 2, 3, 4, 5])');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeGreaterThan(0);
    // Inline variance: each element minus mean, squared, summed, divided by N-1.
    // The denominator should be 4.0 for 5 elements (sample variance).
    expect(result.code).toMatch(/4\.0\)/);
    // All five values should appear in the code.
    expect(result.code).toContain('1.0');
    expect(result.code).toContain('5.0');
  });

  test('Median compiles for a constant-size list in GLSL', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{median}([1, 5, 3, 2, 4])');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeGreaterThan(0);
    // Emits a call to the preamble helper for the list size.
    expect(result.code).toMatch(/_gpu_median_5\(/);
  });

  test('GCD compiles for two integers in GLSL', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{gcd}(12, 18)');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeGreaterThan(0);
    // Emits a call to the preamble helper (evaluated at shader runtime).
    expect(result.code).toMatch(/_gpu_gcd\(/);
  });

  test('Variance compiles for a constant-size list in WGSL', () => {
    const ce = new ComputeEngine();
    const target = new WGSLTarget();
    const expr = ce.parse('\\operatorname{var}([1, 2, 3, 4, 5])');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeGreaterThan(0);
  });

  test('GCD compiles for two integers in WGSL', () => {
    const ce = new ComputeEngine();
    const target = new WGSLTarget();
    const expr = ce.parse('\\operatorname{gcd}(12, 18)');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code.length).toBeGreaterThan(0);
  });

  test('Variance with non-constant list elements compiles in GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const target = new GLSLTarget();
    const expr = ce.parse('\\operatorname{var}([x, 2, 3])');
    // Non-constant list elements are supported (x is a variable)
    // The handler should compile successfully using the variable name
    const result = target.compile(expr);
    expect(result.success).toBe(true);
  });
});

describe('A1 — Random GPU compile (deterministic seed)', () => {
  test('Random(seed) compiles to a deterministic GLSL hash', () => {
    const ce = new ComputeEngine();
    // Random(n) with an integer seed is valid per the Random signature.
    // In GPU shaders the seed is typically a per-fragment integer expression.
    ce.declare('n', 'integer');
    const target = new GLSLTarget();
    const expr = ce.expr(['Random', 'n']);
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/_gpu_random|fract\(sin/);
  });

  test('Random() with no seed compiles to a fragment-coord-based fallback in GLSL', () => {
    const ce = new ComputeEngine();
    const target = new GLSLTarget();
    const expr = ce.expr(['Random']);
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/gl_FragCoord|_gpu_random/);
  });

  test('Random(seed) preamble is emitted exactly once', () => {
    const ce = new ComputeEngine();
    ce.declare('n1', 'integer');
    ce.declare('n2', 'integer');
    const target = new GLSLTarget();
    // Use Random twice in same expression — preamble should appear only once.
    const expr = ce.expr(['Add', ['Random', 'n1'], ['Random', 'n2']]);
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    // The function definition should appear exactly once in the preamble.
    const defMatches = (result.preamble ?? '').match(/float _gpu_random\s*\(/g) ?? [];
    expect(defMatches.length).toEqual(1);
  });

  test('Random() with no seed in WGSL throws', () => {
    const ce = new ComputeEngine();
    const target = new WGSLTarget();
    const expr = ce.parse('\\operatorname{Random}()');
    expect(() => target.compile(expr)).toThrow(/explicit seed/i);
  });

  test('Random(seed) compiles in WGSL', () => {
    const ce = new ComputeEngine();
    ce.declare('s', 'integer');
    const target = new WGSLTarget();
    const expr = ce.parse('\\operatorname{Random}(s)');
    const result = target.compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/_gpu_random/);
  });
});

describe('A1 — Loop / Integrate JS compile', () => {
  test('Loop compiles in JS to the List of body values', () => {
    // Loop(i^2, Element(i, Range(1,5))) evaluates to ["List",1,4,9,16,25];
    // the compiled JS now collects each iteration's value and returns it.
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\operatorname{Loop}(i^2, \\operatorname{Element}(i, \\operatorname{Range}(1, 5)))'
    );
    const result = compile(expr);
    expect(result?.success).toBe(true);
    // Still uses the efficient counter-loop form …
    expect(result?.code).toMatch(/for\s*\(let i/);
    // … but now returns the collected values rather than undefined.
    expect(result?.run?.({})).toEqual([1, 4, 9, 16, 25]);
  });

  test('Integrate compiles in JS to a numeric estimate of the integral', () => {
    // Integrate(Function(Block(Power(x,2)), x), Limits(x, 0, 1)). The integrand
    // is now compiled to a single lambda (not a double-lambda), so the
    // Monte-Carlo estimator returns ≈ 1/3 instead of NaN.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_{0}^{1} x^2 \\, dx');
    const result = compile(expr);
    expect(result?.success).toBe(true);
    expect(result?.code).toMatch(/_SYS\.integrate/);
    expect(result?.run?.({})).toBeCloseTo(1 / 3, 2);
  });

  test('Integrate honors non-integer bounds (no flooring)', () => {
    // Regression: extractLimits floors bounds, which collapsed ∫₀^0.5 to ∫₀^0.
    // True value ∫₀^0.5 x² dx = 0.5³/3 ≈ 0.0417.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_{0}^{0.5} x^2 \\, dx');
    const result = compile(expr);
    expect(result?.success).toBe(true);
    expect(result?.run?.({})).toBeCloseTo(0.5 ** 3 / 3, 2);
  });

  test('Loop with runtime-bound range surfaces a diagnostic in GLSL', () => {
    // Loop: bounds must be finite numbers — mentions 'bounds'
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse(
      '\\operatorname{Loop}(i, \\operatorname{Element}(i, \\operatorname{Range}(1, n)))'
    );
    const target = new GLSLTarget();
    let observed: string | undefined;
    try {
      const result = target.compile(expr);
      observed = result.success
        ? 'unexpected success'
        : `failure: ${result.code ?? ''}`;
    } catch (e) {
      observed = `throw: ${(e as Error).message}`;
    }
    // Observed: 'throw: Loop: bounds must be finite numbers'
    expect(observed).toMatch(/Loop|Range|bounds|runtime/i);
  });

  test('Integrate in GLSL surfaces a diagnostic', () => {
    // GLSL target has no Integrate handler — throws 'Unknown operator `Integrate`'
    const ce = new ComputeEngine();
    const expr = ce.parse('\\int_{0}^{1} x^2 \\, dx');
    const target = new GLSLTarget();
    let observed: string | undefined;
    try {
      const result = target.compile(expr);
      observed = result.success
        ? 'unexpected success'
        : `failure: ${result.code ?? ''}`;
    } catch (e) {
      observed = `throw: ${(e as Error).message}`;
    }
    // Observed: 'throw: Unknown operator `Integrate`'
    expect(observed).not.toEqual('unexpected success');
    expect(observed).toMatch(/Integrate/i);
  });
});

describe('C1 — toSignedFunction()', () => {
  test('Equal(lhs, rhs) returns lhs - rhs', () => {
    const ce = new ComputeEngine();
    const eq = ce.parse('x^2 + y^2 + z^2 = 1');
    const sf = eq.toSignedFunction();
    expect(sf).toBeDefined();
    // Equivalent (up to canonical form) to x^2 + y^2 + z^2 - 1
    expect(sf!.simplify().isSame(ce.parse('x^2 + y^2 + z^2 - 1').simplify())).toBe(true);
  });

  test('Less(lhs, rhs) returns lhs - rhs (negative when relation holds)', () => {
    const ce = new ComputeEngine();
    const ineq = ce.parse('x + y < 10');
    const sf = ineq.toSignedFunction();
    expect(sf).toBeDefined();
    ce.assign('x', 1); ce.assign('y', 1);
    // Evaluate at (1, 1): lhs - rhs = 2 - 10 = -8 → negative → inside.
    expect(sf!.evaluate().re).toEqual(-8);
  });

  test('Greater(lhs, rhs) returns rhs - lhs (negative when relation holds)', () => {
    const ce = new ComputeEngine();
    const ineq = ce.parse('x + y > 10');
    const sf = ineq.toSignedFunction();
    expect(sf).toBeDefined();
    ce.assign('x', 5); ce.assign('y', 6);
    // Evaluate at (5, 6): rhs - lhs = 10 - 11 = -1 → negative → inside.
    expect(sf!.evaluate().re).toEqual(-1);
  });

  test('LessEqual and GreaterEqual return the same signed function as Less and Greater', () => {
    const ce = new ComputeEngine();
    const leq = ce.parse('x \\le 5');
    expect(leq.toSignedFunction()).toBeDefined();
    // x <= 5 canonicalizes to LessEqual(x, 5) → sf = x - 5 (negative when relation holds)
    expect(leq.operator).toEqual('LessEqual');

    // x >= 5 canonicalizes to LessEqual(5, x) — GreaterEqual normalizes to LessEqual.
    // toSignedFunction still works: sf = 5 - x (negative when x >= 5 i.e. relation holds)
    const geq = ce.parse('x \\ge 5');
    const sfGeq = geq.toSignedFunction();
    expect(sfGeq).toBeDefined();
    // Verify sign: at x=6 (relation holds), sf should be negative
    ce.assign('x', 6);
    expect(sfGeq!.evaluate().re).toBeLessThan(0);
    // At x=4 (relation does not hold), sf should be positive
    ce.assign('x', 4);
    expect(sfGeq!.evaluate().re).toBeGreaterThan(0);
  });

  test('Non-relation expressions return undefined', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x + 1').toSignedFunction()).toBeUndefined();
    expect(ce.parse('5').toSignedFunction()).toBeUndefined();
    expect(ce.parse('\\sin(x)').toSignedFunction()).toBeUndefined();
  });

  test('toSignedFunction result compiles for 3D implicit rendering', () => {
    const ce = new ComputeEngine();
    const eq = ce.parse('x^2 + y^2 + z^2 = 1');
    const sf = eq.toSignedFunction()!;
    const result = compile(sf);
    expect(result?.success).toBe(true);
    // On the unit sphere: f(1, 0, 0) = 0
    expect(result?.run?.({ x: 1, y: 0, z: 0 })).toBeCloseTo(0);
    // Inside: f(0, 0, 0) = -1
    expect(result?.run?.({ x: 0, y: 0, z: 0 })).toBeCloseTo(-1);
    // Outside: f(2, 0, 0) = 3
    expect(result?.run?.({ x: 2, y: 0, z: 0 })).toBeCloseTo(3);
  });
});
