/**
 * Tests for interval JavaScript compilation target
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'real');

/** The diagnostic of the decline that `f` throws. */
function declineOf(f: () => unknown) {
  try {
    f();
  } catch (e) {
    return compileDiagnosticOf(e);
  }
  throw new Error('no decline');
}

/** The whole emitted artifact: the constant table and the definitions the
 *  preamble carries, then the expression that reads them. Every constant
 *  interval is bound in that table (`hoistIntervalConstants`), so a test that
 *  looks for a constant's spelling has to look at both halves. */
function emitted(fn: { preamble?: string; code: string }): string {
  return `${fn.preamble ?? ''}\n${fn.code}`;
}

describe('INTERVAL JS COMPILATION - BASIC', () => {
  test('compiles constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
  });

  test('compiles variable', () => {
    const expr = ce.parse('x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_.x');
  });

  test('compiles Pi', () => {
    const expr = ce.parse('\\pi');
    const fn = compile(expr, { to: 'interval-js' });
    // An irrational constant is emitted as the two-ulp ENCLOSURE of its
    // value, not as a point at the nearest double: no double is π, so a
    // point would exclude the constant it claims to bound.
    const v = unwrapInterval(fn.run!({}));
    expect(v.lo).toBeLessThan(v.hi);
    expect(v.lo).toBeLessThanOrEqual(Math.PI);
    expect(v.hi).toBeGreaterThanOrEqual(Math.PI);
  });
});

describe('INTERVAL JS COMPILATION - ARITHMETIC', () => {
  test('compiles addition', () => {
    const expr = ce.parse('x + y');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.add');
  });

  test('compiles subtraction', () => {
    const expr = ce.parse('x - y');
    const fn = compile(expr, { to: 'interval-js' });
    // `Subtract` canonicalizes to `Add(x, Negate(y))`, and the `Add` chain
    // subtracts a negated operand instead of adding its negation. See
    // `compile-interval-sub.test.ts` for the full set of positions.
    expect(fn.code).toContain('_IA.sub');
  });

  test('compiles multiplication', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.mul');
  });

  test('compiles division', () => {
    const expr = ce.parse('\\frac{x}{y}');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.div');
  });

  test('compiles negation', () => {
    const expr = ce.parse('-x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.negate');
  });
});

describe('INTERVAL JS COMPILATION - FUNCTIONS', () => {
  test('compiles sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.sin');
  });

  test('compiles cos', () => {
    const expr = ce.parse('\\cos(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.cos');
  });

  test('compiles tan', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.tan');
  });

  test('compiles sqrt', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.sqrt');
  });

  test('compiles square', () => {
    const expr = ce.parse('x^2');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.square');
  });

  test('compiles power', () => {
    const expr = ce.parse('x^3');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.pow');
  });

  test('compiles exp', () => {
    // e^x is Power(ExponentialE, x) internally but should compile to exp
    const expr = ce.parse('e^x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.exp');
  });

  test('compiles ln', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.ln');
  });

  test('compiles abs', () => {
    const expr = ce.parse('|x|');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.code).toContain('_IA.abs');
  });

  test('compiles if to a closure-free conditional', () => {
    const expr = ce.expr(['If', ['Greater', 'x', 0], 'x', ['Negate', 'x']]);
    const fn = compile(expr, { to: 'interval-js' });
    // The condition is bound to a temporary and read back before either arm
    // is evaluated; no arm is wrapped in a function.
    expect(fn.code).toContain("=== 'true' ?");
    expect(fn.code).toContain('_IA.hull(');
  });

  test('compiles Gamma', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.gamma');
  });

  test('compiles GammaLn', () => {
    const expr = ce.expr(['GammaLn', 'x']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.gammaln');
  });
});

describe('INTERVAL JS EXECUTION', () => {
  test('evaluates constant', () => {
    const expr = ce.parse('5');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({});

    // A constant compiles to a point interval, which the runner answers as
    // the `interval` result, the shape of every scalar value.
    expect(result).toEqual({ kind: 'interval', value: { lo: 5, hi: 5 } });
  });

  test('evaluates point interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 2, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates interval input', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(2);
    expect(result.value.hi).toBe(3);
  });

  test('evaluates number input (converts to point)', () => {
    const expr = ce.parse('x + 1');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: 5 });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(6);
    expect(result.value.hi).toBe(6);
  });

  test('evaluates sin', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 5);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.1), 5);
  });

  test('sin over full period', () => {
    const expr = ce.parse('\\sin(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 * Math.PI } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(-1);
    expect(result.value.hi).toBe(1);
  });

  test('sin with compound arguments', () => {
    const expr = ce.parse('\\sin(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with additive argument', () => {
    const expr = ce.parse('\\sin(x+x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.2), 6);
  });

  test('sin with power argument', () => {
    const expr = ce.parse('\\sin(x^2)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(Math.sin(0.01), 6);
  });

  test('cos with compound arguments', () => {
    const expr = ce.parse('\\cos(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.cos(0.2), 6);
    expect(result.value.hi).toBeCloseTo(1, 6);
  });

  test('ln with compound argument', () => {
    const expr = ce.parse('\\ln(2x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.log(2), 6);
    expect(result.value.hi).toBeCloseTo(Math.log(4), 6);
  });

  test('abs with additive argument', () => {
    const expr = ce.parse('|x+x|');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -0.1, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0, 6);
    expect(result.value.hi).toBeCloseTo(0.4, 6);
  });

  test('max with compound argument', () => {
    const expr = ce.parse('\\max(x, x+1)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 0.2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1, 6);
    expect(result.value.hi).toBeCloseTo(1.2, 6);
  });

  test('comparison with compound argument', () => {
    const expr = ce.expr(['Less', 'x', ['Add', 'x', 2]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result).toBe('true');
  });

  test('comparison with compound argument is indeterminate', () => {
    const expr = ce.expr(['Less', 'x', ['Add', 'x', 1]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('maybe');
  });

  test('comparison with compound argument is false', () => {
    const expr = ce.expr(['Greater', 'x', ['Add', 'x', 3]]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 2 } });

    expect(result).toBe('false');
  });

  // Regression: N-ary chained relations and N-ary And/Or must compile ALL
  // operands, not just the first two. A binary-only emission silently drops
  // the tail comparison — unsound for mask exclusion / inclusion.
  test('chained 1 < x < 4 is false for a wholly-outside box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    // [5, 6] is entirely outside 1 < x < 4.
    expect(fn.run!({ x: { lo: 5, hi: 6 } })).toBe('false');
  });

  test('chained 1 < x < 4 is true for a wholly-inside box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    expect(fn.run!({ x: { lo: 2, hi: 3 } })).toBe('true');
  });

  test('chained 1 < x < 4 is maybe for a straddling box', () => {
    const fn = compile(ce.parse('1<x<4'), { to: 'interval-js' });
    expect(fn.run!({ x: { lo: 0, hi: 2 } })).toBe('maybe');
  });

  test('3-operand Or admits a box via its third branch only', () => {
    const fn = compile(ce.parse('x<-2\\lor x>2\\lor y>0'), {
      to: 'interval-js',
    });
    // First two branches are false for x∈[0,1]; only y>0 (third) admits it.
    // A binary-only fold would drop y>0 and wrongly report 'false'.
    expect(fn.run!({ x: { lo: 0, hi: 1 }, y: { lo: 5, hi: 6 } })).toBe('true');
  });

  test('3-operand And is false when its third operand excludes the box', () => {
    const fn = compile(ce.parse('x>-2\\land x<2\\land y>0'), {
      to: 'interval-js',
    });
    // First two conjuncts hold for x∈[0,1]; y<0 (third) excludes the box.
    // A binary-only fold would drop y>0 and wrongly report 'true'.
    expect(fn.run!({ x: { lo: 0, hi: 1 }, y: { lo: -6, hi: -5 } })).toBe(
      'false'
    );
  });

  test('piecewise with compound argument', () => {
    const expr = ce.expr([
      'If',
      ['Greater', ['Add', 'x', 'x'], 0],
      ['Add', 'x', 1],
      ['Negate', ['Add', 'x', 1]],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(2, 6);
    expect(result.value.hi).toBeCloseTo(3, 6);
  });

  test('piecewise without a default returns empty when no branch matches, partial when undecided', () => {
    for (const expr of [
      ce.expr(['Which', ['Less', 'x', 0], 1]),
      ce.expr(['Which', ['Less', 'x', 0], 1, ['Less', 'x', 1], 2]),
      ce.parse('\\begin{cases}1 & x < 0\\end{cases}'),
    ]) {
      const fn = compile(expr, { to: 'interval-js' });
      expect(fn.success).toBe(true);
      expect(fn.run!({ x: { lo: 2, hi: 3 } })).toEqual({ kind: 'empty' });
      expect(fn.run!({ x: { lo: -2, hi: -1 } })).toEqual({
        kind: 'interval',
        value: { lo: 1, hi: 1 },
      });
    }

    // An undecided condition with no default: the arm is a value over part
    // of the cell only, so the answer is `partial`, as an undecided restriction
    // answers — not an `interval`, which would claim the value over the
    // whole cell. The same holds for an arm that is itself empty (an `At`
    // out of range) beside the default arm.
    const fn = compile(ce.expr(['Which', ['Less', 'x', 0], 1]), {
      to: 'interval-js',
    });
    expect(fn.run!({ x: { lo: -1, hi: 1 } })).toEqual({
      kind: 'partial',
      value: { lo: 1, hi: 1 },
      domainClipped: 'both',
    });
    const emptyArm = compile(
      ce.expr([
        'Which',
        ['Less', 'x', 1],
        ['At', ['List', 10, 20, 30], 7],
        'True',
        ['At', ['List', 10, 20, 30], 2],
      ]),
      { to: 'interval-js' }
    );
    expect(emptyArm.success).toBe(true);
    expect(emptyArm.run!({ x: { lo: -1, hi: 3 } })).toEqual({
      kind: 'partial',
      value: { lo: 20, hi: 20 },
      domainClipped: 'both',
    });
    expect(emptyArm.run!({ x: { lo: 2, hi: 3 } })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 20 },
    });
    expect(emptyArm.run!({ x: { lo: -1, hi: 0 } })).toEqual({ kind: 'empty' });
  });

  test('piecewise union on indeterminate condition', () => {
    const expr = ce.expr([
      'If',
      ['Greater', ['Add', 'x', 'x'], 0],
      ['Add', 'x', 1],
      ['Negate', ['Add', 'x', 1]],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(-2, 6);
    expect(result.value.hi).toBeCloseTo(2, 6);
  });

  test('piecewise with constant branches (Heaviside)', () => {
    const expr = ce.expr(['If', ['GreaterEqual', 'x', 0], 1, 0]);
    const fn = compile(expr, { to: 'interval-js' });

    // x definitely >= 0 → 1
    const r1 = fn.run!({ x: { lo: 2, hi: 3 } });
    expect(r1.kind).toBe('interval');
    expect(r1.value.lo).toBeCloseTo(1, 10);
    expect(r1.value.hi).toBeCloseTo(1, 10);

    // x definitely < 0 → 0
    const r2 = fn.run!({ x: { lo: -3, hi: -1 } });
    expect(r2.kind).toBe('interval');
    expect(r2.value.lo).toBeCloseTo(0, 10);
    expect(r2.value.hi).toBeCloseTo(0, 10);

    // x spans 0 → union [0, 1]
    const r3 = fn.run!({ x: { lo: -1, hi: 1 } });
    expect(r3.kind).toBe('interval');
    expect(r3.value.lo).toBeCloseTo(0, 10);
    expect(r3.value.hi).toBeCloseTo(1, 10);

    // x exactly 0 → 1 (>= includes 0)
    const r4 = fn.run!({ x: { lo: 0, hi: 0 } });
    expect(r4.kind).toBe('interval');
    expect(r4.value.lo).toBeCloseTo(1, 10);
    expect(r4.value.hi).toBeCloseTo(1, 10);
  });

  test('piecewise from text{if} LaTeX', () => {
    const expr = ce.parse('\\text{if} x \\geq 0 \\text{then} 1 \\text{else} 0');
    expect(expr.operator).toBe('If');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ x: { lo: 2, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1, 10);
  });

  test('multiplication widens interval', () => {
    const expr = ce.parse('x \\cdot y');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(3);
    expect(result.value.hi).toBe(8);
  });
});

describe('INTERVAL JS SINGULARITY DETECTION', () => {
  test('division by zero interval is singular', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 1 } });

    expect(result.kind).toBe('singular');
  });

  test('division by positive interval is safe', () => {
    const expr = ce.parse('\\frac{1}{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0.5, 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });

  test('sqrt of negative interval is empty', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -2, hi: -1 } });

    expect(result.kind).toBe('empty');
  });

  test('sqrt of mixed interval is partial', () => {
    const expr = ce.parse('\\sqrt{x}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: 4 } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBe(2);
    expect(result.domainClipped).toBe('lo');
  });

  // Tycho item 254: the domain-clip marker survives the operations ABOVE the
  // clipped head. A box whose ends are in the domain of `sqrt` but whose
  // interior is not answered a bounded `interval` for `x + sqrt(x² − 0.01)`,
  // indistinguishable from a continuous cell.
  test('an operation over a partial operand stays partial', () => {
    const fn = compile(ce.parse('x+\\sqrt{x^2-0.01}'), { to: 'interval-js' });
    const gap = fn.run!({ x: { lo: -0.3, hi: 0.3 } });
    expect(gap.kind).toBe('partial');
    expect(gap.value.lo).toBeCloseTo(-0.3, 12);
    expect(gap.value.hi).toBeCloseTo(0.3 + Math.sqrt(0.08), 12);
    expect(gap.domainClipped).toBe('both');
    // Entirely inside the domain: a clean interval.
    expect(fn.run!({ x: { lo: 0.11, hi: 0.3 } }).kind).toBe('interval');
    // Entirely outside: empty.
    expect(fn.run!({ x: { lo: -0.05, hi: 0.05 } }).kind).toBe('empty');
  });

  test('a partial with an infinite bound stays partial through negate and add', () => {
    const fn = compile(ce.parse('y-\\ln x'), { to: 'interval-js' });
    const r = fn.run!({ x: { lo: -0.3, hi: 0.3 }, y: { lo: 0, hi: 1 } });
    expect(r.kind).toBe('partial');
    expect(r.value.hi).toBe(Infinity);
    expect(
      fn.run!({ x: { lo: 0.11, hi: 0.3 }, y: { lo: 0, hi: 1 } }).kind
    ).toBe('interval');
  });

  test('tan near PI/2 is singular', () => {
    const expr = ce.parse('\\tan(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1.5, hi: 1.65 } });

    expect(result.kind).toBe('singular');
  });

  test('ln of non-positive is empty', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -2, hi: 0 } });

    expect(result.kind).toBe('empty');
  });

  test('ln crossing zero is partial', () => {
    const expr = ce.parse('\\ln(x)');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: -1, hi: Math.E } });

    expect(result.kind).toBe('partial');
    expect(result.value.lo).toBe(-Infinity);
    expect(result.value.hi).toBeCloseTo(1, 5);
    expect(result.domainClipped).toBe('lo');
  });
});

describe('INTERVAL JS COMPLEX EXPRESSIONS', () => {
  test('sin(x)/x - classic singularity example', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{x}');
    const fn = compile(expr, { to: 'interval-js' });

    // At zero - singular
    const atZero = fn.run!({ x: { lo: -0.1, hi: 0.1 } });
    expect(atZero.kind).toBe('singular');

    // Away from zero - valid
    const awayFromZero = fn.run!({ x: { lo: 1, hi: 2 } });
    expect(awayFromZero.kind).toBe('interval');
  });

  test('x^2 + y^2 composition', () => {
    const expr = ce.parse('x^2 + y^2');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 1, hi: 2 }, y: { lo: 3, hi: 4 } });

    expect(result.kind).toBe('interval');
    // x^2 in [1,4], y^2 in [9,16], sum in [10,20]
    expect(result.value.lo).toBe(10);
    expect(result.value.hi).toBe(20);
  });

  test('exp(-x^2) Gaussian-like', () => {
    const expr = ce.parse('e^{-x^2}');
    const fn = compile(expr, { to: 'interval-js' });
    const result = fn.run!({ x: { lo: 0, hi: 1 } });

    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(Math.exp(-1), 5);
    expect(result.value.hi).toBeCloseTo(1, 5);
  });

  test('Gamma function positive values', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });

    // Gamma(2.5) ≈ 1.329
    const result = fn.run!({ x: { lo: 2.5, hi: 2.5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(1.329, 2);
    expect(result.value.hi).toBeCloseTo(1.329, 2);
  });

  test('Gamma function detects singularity at zero', () => {
    const expr = ce.parse('\\Gamma(x)');
    const fn = compile(expr, { to: 'interval-js' });

    // Interval crossing zero should detect the pole
    const result = fn.run!({ x: { lo: -0.5, hi: 0.5 } });
    expect(result.kind).toBe('singular');
  });

  test('GammaLn function', () => {
    const expr = ce.expr(['GammaLn', 'x']);
    const fn = compile(expr, { to: 'interval-js' });

    // GammaLn(2.5) ≈ ln(1.329) ≈ 0.284
    const result = fn.run!({ x: { lo: 2.5, hi: 2.5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBeCloseTo(0.284, 2);
    expect(result.value.hi).toBeCloseTo(0.284, 2);
  });
});

describe('INTERVAL JS - NEGATIVE BASE POWER', () => {
  test('(-1)^k with point integer exponent', () => {
    // (-1)^k where k is a variable — powInterval path
    const expr = ce.expr(['Power', -1, 'k']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // Even exponent → 1
    const r0 = fn.run!({ k: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBe(1);
    expect(r0.value.hi).toBe(1);

    // Odd exponent → -1
    const r1 = fn.run!({ k: { lo: 1, hi: 1 } });
    expect(r1.kind).toBe('interval');
    expect(r1.value.lo).toBe(-1);
    expect(r1.value.hi).toBe(-1);

    // Even exponent → 1
    const r4 = fn.run!({ k: { lo: 4, hi: 4 } });
    expect(r4.kind).toBe('interval');
    expect(r4.value.lo).toBe(1);
    expect(r4.value.hi).toBe(1);
  });

  test('(-2)^k with point integer exponent', () => {
    const expr = ce.expr(['Power', -2, 'k']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // (-2)^3 = -8
    const r3 = fn.run!({ k: { lo: 3, hi: 3 } });
    expect(r3.kind).toBe('interval');
    expect(r3.value.lo).toBe(-8);
    expect(r3.value.hi).toBe(-8);

    // (-2)^2 = 4
    const r2 = fn.run!({ k: { lo: 2, hi: 2 } });
    expect(r2.kind).toBe('interval');
    expect(r2.value.lo).toBe(4);
    expect(r2.value.hi).toBe(4);
  });

  test('(-1)^k with interval exponent spanning integers', () => {
    const expr = ce.expr(['Power', -1, 'k']);
    const fn = compile(expr, { to: 'interval-js' });

    // Exponent spans both even and odd → [-1, 1]
    const r = fn.run!({ k: { lo: 0, hi: 3 } });
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBe(-1);
    expect(r.value.hi).toBe(1);
  });

  test('Factorial compiles and executes', () => {
    const expr = ce.expr(['Factorial', 'n']);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // 5! = 120
    const r5 = fn.run!({ n: { lo: 5, hi: 5 } });
    expect(r5.kind).toBe('interval');
    expect(r5.value.lo).toBe(120);
    expect(r5.value.hi).toBe(120);

    // 0! = 1
    const r0 = fn.run!({ n: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBe(1);
    expect(r0.value.hi).toBe(1);
  });

  test('alternating sign summation: sum of (-1)^k', () => {
    // Sum((-1)^k, k=0..5) = 1-1+1-1+1-1 = 0
    const expr = ce.expr(['Sum', ['Power', -1, 'k'], ['Limits', 'k', 0, 5]]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({});
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(0);
    expect(result.value.hi).toBe(0);
  });

  test('Taylor-like: sum of (-1)^k * x^(2k+1) / (2k+1)!', () => {
    // First 4 terms of arctan(x) Taylor series: x - x^3/3! + x^5/5! - x^7/7!
    // But with factorial denominators approximating arctan
    const expr = ce.expr([
      'Sum',
      [
        'Divide',
        [
          'Multiply',
          ['Power', -1, 'k'],
          ['Power', 'x', ['Add', ['Multiply', 2, 'k'], 1]],
        ],
        ['Factorial', ['Add', ['Multiply', 2, 'k'], 1]],
      ],
      ['Limits', 'k', 0, 3],
    ]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    // Evaluate at x = 0.5 (point interval)
    const result = fn.run!({ x: { lo: 0.5, hi: 0.5 } });
    expect(result.kind).toBe('interval');
    // Should be a finite number (not empty/singular)
    expect(Number.isFinite(result.value.lo)).toBe(true);
    expect(Number.isFinite(result.value.hi)).toBe(true);
  });

  // REVIEW.md E5: a compound symbolic bound (e.g. `n + 2`) compiles to an
  // `_IA.*` call that returns an IntervalResult wrapper ({kind, value}), not a
  // bare {lo, hi}. The loop bound read `.hi` off the wrapper → undefined →
  // Math.floor(undefined) = NaN → the loop never ran, silently returning the
  // identity (0 for Sum, 1 for Product) instead of the real value.
  test('Sum with a compound symbolic upper bound (n + 2)', () => {
    // Sum(k, k=1..n+2) with n=3 → 1+2+3+4+5 = 15
    const expr = ce.expr(['Sum', 'k', ['Limits', 'k', 1, ['Add', 'n', 2]]]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 3, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(15);
    expect(result.value.hi).toBe(15);
  });

  test('Sum with a simple symbolic upper bound (n) still works', () => {
    // Sum(k, k=1..n) with n=5 → 15 (the bare-interval `.hi` path)
    const expr = ce.expr(['Sum', 'k', ['Limits', 'k', 1, 'n']]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 5, hi: 5 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(15);
    expect(result.value.hi).toBe(15);
  });

  test('Product with a compound symbolic upper bound (n + 1)', () => {
    // Product(k, k=1..n+1) with n=3 → 1·2·3·4 = 24
    const expr = ce.expr(['Product', 'k', ['Limits', 'k', 1, ['Add', 'n', 1]]]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);

    const result = fn.run!({ n: { lo: 3, hi: 3 } });
    expect(result.kind).toBe('interval');
    expect(result.value.lo).toBe(24);
    expect(result.value.hi).toBe(24);
  });

  test('a collection-valued Sum body: the boxes contain the interpreter’s value', () => {
    // `Σ h(i)·(1/1.4^i)·a(…)` where `a` returns a vector — the interpreter's
    // elementwise Sum. The loop carries a list of two intervals and adds the
    // terms element by element (CE-1470), so each box contains the
    // interpreter's element.
    const e = new ComputeEngine();
    e.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    e.parse(
      'h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)'
    ).evaluate();
    const expr = e.parse(
      '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))'
    );
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    for (const t of [0.3, -1.2]) {
      const want = e
        .withValues({ t: e.number(t) } as never, () => expr.evaluate().N())
        .ops!.map((x) => x.re);
      const got = fn.run!({ t: { lo: t, hi: t } }) as unknown as {
        kind: string;
        value: { lo: number; hi: number };
      }[];
      expect(got).toHaveLength(2);
      got.forEach((b, k) => {
        expect(b.kind).toBe('interval');
        expect(b.value.lo).toBeLessThanOrEqual(want[k]);
        expect(want[k]).toBeLessThanOrEqual(b.value.hi);
      });
    }
  });
});

/**
 * Helper to extract numeric interval from result
 */
function unwrapInterval(val: unknown): { lo: number; hi: number } {
  if (val && typeof val === 'object') {
    if ('kind' in val && (val as any).kind === 'interval')
      return (val as any).value;
    if ('lo' in val && 'hi' in val) return val as { lo: number; hi: number };
  }
  throw new Error(`Expected interval result, got: ${JSON.stringify(val)}`);
}

describe('INTERVAL JS - ADDITIONAL FUNCTIONS', () => {
  test('Binomial(5, 2) = 10', () => {
    const expr = ce.expr(['Binomial', 5, 2]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(10, 10);
    expect(val.hi).toBeCloseTo(10, 10);
  });

  // Issue #384: the scalar kernel was a Pascal-triangle table lookup that
  // threw on a negative `n`. `C(-3, 2) = 6`, as the interpreter gives.
  test('Binomial(-3, 2) = 6', () => {
    const expr = ce.expr(['Binomial', -3, 2]);
    const fn = compile(expr, { to: 'interval-js', constantFold: false });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(6, 10);
    expect(val.hi).toBeCloseTo(6, 10);
  });

  test('Binomial over an n range that crosses 0 encloses the negative-n values', () => {
    const fn = compile(ce.expr(['Binomial', 'n', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    // n ∈ [-3, 3]: C(n, 2) takes the values 6, 3, 1, 0, 0, 1, 3.
    const val = unwrapInterval(fn.run!({ n: { lo: -3, hi: 3 } }));
    expect(val.lo).toBeLessThanOrEqual(0);
    expect(val.hi).toBeGreaterThanOrEqual(6);
  });

  test('Binomial over an n range unbounded above has an unbounded enclosure', () => {
    const fn = compile(ce.expr(['Binomial', 'n', 2]), { to: 'interval-js' });
    const val = unwrapInterval(fn.run!({ n: { lo: 0, hi: Infinity } }));
    expect(val.lo).toBeLessThanOrEqual(0);
    expect(val.hi).toBe(Infinity);
  });

  // The interval target encloses the real function, as the interpreter
  // defines it through Γ, not the function on the integers.
  test('Binomial(x, 2) encloses the parabola x(x − 1)/2', () => {
    const fn = compile(ce.expr(['Binomial', 'x', 2]), { to: 'interval-js' });
    // The point enclosure is widened by the error bound of the scalar
    // kernel, so it is a few ulps wide around 12.375, not a single double.
    const point = unwrapInterval(fn.run!({ x: { lo: 5.5, hi: 5.5 } }));
    expect(point.lo).toBeLessThanOrEqual(12.375);
    expect(point.hi).toBeGreaterThanOrEqual(12.375);
    expect(point.hi - point.lo).toBeLessThan(1e-10);
    // The endpoint values are widened by the error bound of the scalar
    // kernel (about 1e-12 here).
    const range = unwrapInterval(fn.run!({ x: { lo: 2.3, hi: 2.7 } }));
    expect(range.lo).toBeCloseTo(1.495, 10);
    expect(range.hi).toBeCloseTo(2.295, 10);
    expect(range.lo).toBeLessThanOrEqual(1.495);
    expect(range.hi).toBeGreaterThanOrEqual(2.295);
    // The minimum −1/8 at x = 1/2 is inside the enclosure.
    const aroundMin = unwrapInterval(fn.run!({ x: { lo: 0.2, hi: 0.8 } }));
    expect(aroundMin.lo).toBeLessThanOrEqual(-0.125);
    expect(aroundMin.hi).toBeGreaterThanOrEqual(-0.08);
  });

  test('Binomial(n, -3) is a jump that encloses 0 and the values at negative integers', () => {
    const fn = compile(ce.expr(['Binomial', 'n', -3]), { to: 'interval-js' });
    // C(−3, −3) = 1, C(−2, −3) = −2, C(−1, −3) = 1, and 0 elsewhere.
    const result = fn.run!({ n: { lo: -6, hi: 2 } }) as any;
    expect(result.kind).toBe('singular');
    expect(result.at).toBe(-3);
    expect(result.value.lo).toBeCloseTo(-2, 12);
    expect(result.value.hi).toBeCloseTo(1, 12);
  });

  test('Binomial at a pole of Γ(n + 1) is singular', () => {
    const fn = compile(ce.expr(['Binomial', 'n', 0.5]), { to: 'interval-js' });
    expect((fn.run!({ n: { lo: -3, hi: -3 } }) as any).kind).toBe('singular');
  });

  // With an integer k, C(n, k) is a polynomial in n: the poles cancel, and
  // C(−3, 1500) = C(1502, 1500) = 1127251.
  test('Binomial(n, 1500) over an n interval with a negative integer is finite', () => {
    const fn = compile(ce.expr(['Binomial', 'n', 1500]), { to: 'interval-js' });
    const val = unwrapInterval(fn.run!({ n: { lo: -3.5, hi: -2.5 } }));
    expect(val.lo).toBeLessThanOrEqual(1127251);
    expect(val.hi).toBeGreaterThanOrEqual(1127251);
  });

  test('Binomial(n, 0.5) over an n interval with a pole of Γ(n + 1) is singular', () => {
    const fn = compile(ce.expr(['Binomial', 'n', 0.5]), { to: 'interval-js' });
    const result = fn.run!({ n: { lo: -2.5, hi: -1.2 } }) as any;
    expect(result.kind).toBe('singular');
    expect(result.at).toBe(-2);
  });

  test('Factorial encloses Γ(x + 1)', () => {
    const fn = compile(ce.expr(['Factorial', 'x']), { to: 'interval-js' });
    const point = unwrapInterval(fn.run!({ x: { lo: 2.5, hi: 2.5 } }));
    expect(point.lo).toBeCloseTo(3.3233509704478426, 12);
    const range = unwrapInterval(fn.run!({ x: { lo: 2.3, hi: 2.7 } }));
    expect(range.lo).toBeCloseTo(2.6834373819557675, 12);
    expect(range.hi).toBeCloseTo(4.170651783796603, 12);
    // The minimum of x! near x = 0.4616 is inside the enclosure.
    const aroundMin = unwrapInterval(fn.run!({ x: { lo: 0.3, hi: 0.7 } }));
    expect(aroundMin.lo).toBeCloseTo(0.8856031944108887, 9);
    const negative = unwrapInterval(fn.run!({ x: { lo: -0.5, hi: -0.5 } }));
    expect(negative.lo).toBeCloseTo(Math.sqrt(Math.PI), 12);
    // x! has a pole at x = −1.
    const pole = fn.run!({ x: { lo: -1.5, hi: -0.5 } }) as any;
    expect(pole.kind).toBe('singular');
    expect(pole.at).toBe(-1);
  });

  // The enclosures must CONTAIN the true value, not be close to it: the
  // scalar Γ and binomial kernels are off by hundreds to thousands of ulps,
  // so a one-ulp outward step missed the value. The references are
  // 50-digit values from a separate engine.
  describe('Factorial, Gamma and Binomial enclosures contain the 50-digit value', () => {
    const precise = new ComputeEngine();
    precise.precision = 50;
    const contains = (result: any, ref: MathJsonExpression) => {
      // `entire` holds every value (the interpreter fallback of an
      // expression whose value is not exactly a double).
      if (result.kind === 'entire') return;
      const value = result.value;
      const reference = precise.box(ref).N();
      if (!reference.isFinite) return;
      // A value computed in machine precision has no big-decimal part.
      const exact = reference.bignumRe;
      if (exact) expect(exact.gte(value.lo) && exact.lte(value.hi)).toBe(true);
      else {
        expect(reference.re).toBeGreaterThanOrEqual(value.lo);
        expect(reference.re).toBeLessThanOrEqual(value.hi);
      }
    };
    const run = (expr: MathJsonExpression, args: Record<string, unknown>) =>
      compile(ce.expr(expr), { to: 'interval-js' }).run!(args);
    const at = (v: number) => ({ lo: v, hi: v });

    test.each([2.5, 20.7, -2.5, -5.3, 100.5, 170.1])('Factorial(%p)', (x) =>
      contains(run(['Factorial', 'x'], { x: at(x) }), ['Gamma', x + 1])
    );

    test.each([
      [-200.5, 3],
    ])('Binomial(%p, %p)', (n, k) =>
      contains(run(['Binomial', 'n', 'k'], { n: at(n), k: at(k) }), [
        'Binomial',
        n,
        k,
      ])
    );

    test('Binomial(n, 0.3) over n ∈ [838, 839], where Γ(n + 1) overflows', () => {
      const result = run(['Binomial', 'n', 0.3], { n: { lo: 838, hi: 839 } });
      contains(result, ['Binomial', 838, 0.3]);
      contains(result, ['Binomial', 839, 0.3]);
    });

    // A partial product C(n, i) of the falling factorial overflows although
    // C(n, k) is finite; the enclosure must still contain the value.
    test('Binomial(n, k) for a large integer k', () => {
      const cases: Array<[[number, number], number]> = [
        [[1100, 1100.5], 1000],
        [[1999.5, 1999.6], 2000],
        [[1040.5, 1040.6], 1041],
      ];
      for (const [[n0, n1], k] of cases) {
        const result = run(['Binomial', 'n', k], { n: { lo: n0, hi: n1 } });
        expect(result.kind).toBe('interval');
        contains(result, ['Binomial', n0, k]);
        contains(result, ['Binomial', n1, k]);
      }
    });

    // Past the safe-integer range, `m + 1` rounds back to `m`: an enumeration
    // of the negative integers n with k ≤ n ≤ −1 must not loop forever.
    test('Binomial(n, k) with a negative integer k past the safe-integer range ends', () => {
      const cases: Array<[[number, number], number]> = [
        [[-9007199254740996, -9007199254740994], -9007199254740996],
        [[-1e20 - 16384, -1e20], -1e20],
      ];
      for (const [[n0, n1], k] of cases) {
        const result = run(['Binomial', 'n', 'k'], {
          n: { lo: n0, hi: n1 },
          k: at(k),
        });
        expect(result.kind).toBe('entire');
      }
    });

    test('GammaLn over [0.5, 2] contains the minimum near 1.4616', () => {
      const result = run(['GammaLn', 'x'], { x: { lo: 0.5, hi: 2 } });
      contains(result, ['GammaLn', 1.4616321449683622]);
      contains(result, ['GammaLn', 0.5]);
    });

    // Below about x = −171.6 the scalar Γ underflows to 0 or to a subnormal
    // with no correct digits; the enclosure must still hold the true value.
    test('Gamma below −171.6', () => {
      const result = run(['Gamma', 'x'], { x: { lo: -173.3, hi: -173.2 } });
      contains(result, ['Gamma', -173.25]);
      contains(result, ['Gamma', -173.3]);
    });

    test('GammaLn on a negative strip', () =>
      contains(run(['GammaLn', 'x'], { x: at(-8.95) }), ['GammaLn', -8.95]));
  });

  test('Factorial and Binomial stay exact at integer points', () => {
    const f = compile(ce.expr(['Factorial', 'x']), { to: 'interval-js' });
    expect(f.run!({ x: { lo: 5, hi: 5 } })).toEqual({
      kind: 'interval',
      value: { lo: 120, hi: 120 },
    });
    const b = compile(ce.expr(['Binomial', 'n', 2]), { to: 'interval-js' });
    expect(b.run!({ n: { lo: 5, hi: 5 } })).toEqual({
      kind: 'interval',
      value: { lo: 10, hi: 10 },
    });
  });

  test('GCD(12, 8) = 4', () => {
    const expr = ce.expr(['GCD', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(4, 10);
    expect(val.hi).toBeCloseTo(4, 10);
  });

  test('LCM(12, 8) = 24', () => {
    const expr = ce.expr(['LCM', 12, 8]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(24, 10);
    expect(val.hi).toBeCloseTo(24, 10);
  });

  test('Chop(x, tol) declines a symbolic tolerance', () => {
    const fn = compile(ce.expr(['Chop', 0.5, 't']), { to: 'interval-js' });
    expect(fn.success).toBe(false);
  });

  test('Erf(1) ≈ 0.8427', () => {
    const expr = ce.expr(['Erf', 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(0.8427, 3);
    expect(val.hi).toBeCloseTo(0.8427, 3);
  });

  test('Erfc(0) ≈ 1', () => {
    const expr = ce.expr(['Erfc', 0]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(1, 3);
    expect(val.hi).toBeCloseTo(1, 3);
  });

  test('Exp2(3) = 8', () => {
    const expr = ce.expr(['Exp2', 3]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(8, 10);
    expect(val.hi).toBeCloseTo(8, 10);
  });

  test('Arctan2(1, 1) ≈ π/4', () => {
    const expr = ce.expr(['Arctan2', 1, 1]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(Math.PI / 4, 10);
    expect(val.hi).toBeCloseTo(Math.PI / 4, 10);
  });

  test('Hypot(3, 4) = 5', () => {
    const expr = ce.expr(['Hypot', 3, 4]);
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const val = unwrapInterval(fn.run!());
    expect(val.lo).toBeCloseTo(5, 10);
    expect(val.hi).toBeCloseTo(5, 10);
  });
});

// WP-2.17: the compiled interval runtime must agree with the interpreter's real
// conventions for Arccot (continuous (0, π)), odd roots / rational powers of
// negative bases, and Mod (floored) on a negative divisor multiple.
describe('INTERVAL JS - WP-2.17 INTERPRETER ALIGNMENT', () => {
  test('Arccot of a negative point uses the (0, π) branch', () => {
    const fn = compile(ce.box(['Arccot', 'x']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    // Arccot(-2) ≈ 2.678 (NOT the atan(1/x) value −0.4636).
    const r = unwrapInterval(fn.run!({ x: { lo: -2, hi: -2 } }));
    expect(r.lo).toBeCloseTo(2.677945044588987, 9);
    expect(r.hi).toBeCloseTo(2.677945044588987, 9);
  });

  test('Arccot is continuous through zero (Arccot(0) = π/2, not singular)', () => {
    const fn = compile(ce.box(['Arccot', 'x']), { to: 'interval-js' });
    const r0 = fn.run!({ x: { lo: 0, hi: 0 } });
    expect(r0.kind).toBe('interval');
    expect(r0.value.lo).toBeCloseTo(Math.PI / 2, 9);
    // An interval straddling 0 is a valid decreasing interval, not singular.
    const r = unwrapInterval(fn.run!({ x: { lo: -1, hi: 1 } }));
    expect(r.lo).toBeCloseTo(Math.PI / 4, 9);
    expect(r.hi).toBeCloseTo((3 * Math.PI) / 4, 9);
  });

  test('odd Root of a negative base is real (Root(-8, 3) = -2)', () => {
    const fn = compile(ce.box(['Root', 'x', 3]), { to: 'interval-js' });
    expect(fn.code).toContain('_IA.nthRoot');
    const r = unwrapInterval(fn.run!({ x: { lo: -8, hi: -8 } }));
    expect(r.lo).toBeCloseTo(-2, 9);
    expect(r.hi).toBeCloseTo(-2, 9);
    // Interval straddling zero: monotone increasing.
    const r2 = unwrapInterval(fn.run!({ x: { lo: -8, hi: 27 } }));
    expect(r2.lo).toBeCloseTo(-2, 9);
    expect(r2.hi).toBeCloseTo(3, 9);
  });

  test('even Root of a negative base has no real value (empty)', () => {
    const fn = compile(ce.box(['Root', 'x', 4]), { to: 'interval-js' });
    const r = fn.run!({ x: { lo: -16, hi: -1 } });
    expect(r.kind).toBe('empty');
  });

  test('rational Power with odd denominator over a negative base', () => {
    const f23 = compile(ce.box(['Power', 'x', ['Rational', 2, 3]]), {
      to: 'interval-js',
    });
    // (-8)^(2/3) = 4
    const r = unwrapInterval(f23.run!({ x: { lo: -8, hi: -8 } }));
    expect(r.lo).toBeCloseTo(4, 9);
    expect(r.hi).toBeCloseTo(4, 9);

    const f35 = compile(ce.box(['Power', 'x', ['Rational', 3, 5]]), {
      to: 'interval-js',
    });
    // (-32)^(3/5) = -8
    const r2 = unwrapInterval(f35.run!({ x: { lo: -32, hi: -32 } }));
    expect(r2.lo).toBeCloseTo(-8, 9);
    expect(r2.hi).toBeCloseTo(-8, 9);
  });

  test('a rational power encloses the interpreter, and is the cube root squared', () => {
    // `_IA.powRational` computes `x^(2/3)` as `(x^(1/3))^2` — the same
    // composition the target emits for `\sqrt[3]{x}^2` — so the two
    // spellings answer the same enclosure. At x = 8 the root is the exact 2
    // and the square the exact 4, and the enclosure is the point the
    // interpreter answers.
    const expr = ce.parse('x^{\\frac{2}{3}}');
    const fn = compile(expr, { to: 'interval-js' });
    const r = unwrapInterval(fn.run!({ x: { lo: 8, hi: 8 } }));
    expect(r).toEqual({ lo: 4, hi: 4 });
    expect(r.lo).toBe(expr.subs({ x: 8 }).N().re);

    // A point with no exact value: the enclosure contains the interpreter's
    // float rather than reproducing it.
    const truth = expr.subs({ x: 5 }).N().re!;
    const r5 = unwrapInterval(fn.run!({ x: { lo: 5, hi: 5 } }));
    expect(r5.lo).toBeLessThan(truth);
    expect(r5.hi).toBeGreaterThan(truth);

    const rooted = compile(ce.parse('\\sqrt[3]{x}^2'), { to: 'interval-js' });
    expect(unwrapInterval(rooted.run!({ x: { lo: 5, hi: 5 } }))).toEqual(r5);
  });

  test('Mod is floored: Mod(-1, 3) = 2, Mod(5, -3) = -1', () => {
    const fn = compile(ce.box(['Mod', 'x', 'y']), { to: 'interval-js' });
    const r1 = unwrapInterval(
      fn.run!({ x: { lo: -1, hi: -1 }, y: { lo: 3, hi: 3 } })
    );
    expect(r1.lo).toBe(2);
    expect(r1.hi).toBe(2);
    const r2 = unwrapInterval(
      fn.run!({ x: { lo: 5, hi: 5 }, y: { lo: -3, hi: -3 } })
    );
    expect(r2.lo).toBe(-1);
    expect(r2.hi).toBe(-1);
    // Point on a multiple of a negative divisor is 0 (well-defined), not singular.
    const r3 = unwrapInterval(
      fn.run!({ x: { lo: 6, hi: 6 }, y: { lo: -3, hi: -3 } })
    );
    expect(r3.lo).toBe(0);
    expect(r3.hi).toBe(0);
  });

  test('Round rounds half away from zero (Round(-2.5) = -3)', () => {
    const fn = compile(ce.box(['Round', 'x']), { to: 'interval-js' });
    const rNeg = unwrapInterval(fn.run!({ x: { lo: -2.5, hi: -2.5 } }));
    expect(rNeg.lo).toBe(-3);
    expect(rNeg.hi).toBe(-3);
    const rPos = unwrapInterval(fn.run!({ x: { lo: 2.5, hi: 2.5 } }));
    expect(rPos.lo).toBe(3);
    expect(rPos.hi).toBe(3);
  });
});

// GammaRegularized/BetaRegularized have no interval kernel (`_IA` has no
// gammaQ/betaRegularized equivalent). Compiling must fail closed — report
// `success: false` with the offending head listed as unsupported — rather
// than silently emit wrong (point-only) code.
describe('INTERVAL JS - fails closed on regularized gamma/beta (no kernel)', () => {
  test('GammaRegularized is reported unsupported', () => {
    const fn = compile(ce.box(['GammaRegularized', 3, 'x']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.unsupported).toContain('GammaRegularized');
  });

  test('BetaRegularized is reported unsupported', () => {
    const fn = compile(ce.box(['BetaRegularized', 'x', 2, 3]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.unsupported).toContain('BetaRegularized');
  });
});

// The interval domain is scalar — one interval per quantity — so there is no
// element-wise selection convention for a collection-valued `Which`/`If`
// condition. Decline with a message that says so (D6), instead of the generic
// ``Unknown operator `List` `` the clause list used to produce.
describe('INTERVAL JS - element-wise selection declines cleanly', () => {
  const ceSel = new ComputeEngine();
  ceSel.declare('x', 'real');
  ceSel.declare('BL', 'list<boolean>');

  test('Which with a literal boolean-list condition declines', () => {
    const fn = compile(
      ceSel.box(['Which', ['List', 'True', 'False'], 1, 'True', 0]),
      {
        to: 'interval-js',
      }
    );
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });

  test('Which with a `list<boolean>` declared condition declines', () => {
    const fn = compile(ceSel.box(['Which', 'BL', 1, 'True', 0]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });

  test('If with a collection condition declines', () => {
    const fn = compile(ceSel.box(['If', 'BL', 1, 0]), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });

  test('When with a collection condition declines', () => {
    const fn = compile(ceSel.box(['If', ['List', 'True', 'False'], 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });

  test('a scalar Which is unchanged', () => {
    const fn = compile(ceSel.box(['Which', ['Less', 'x', 3], 1, 'True', 0]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain("=== 'true' ?");
  });

  test('a wide-declared (unprovable) condition still compiles', () => {
    // Only PROVABLE collection-ness declines: a condition whose collection-ness
    // is not statically visible must keep compiling (scalar curve/implicit
    // plotting rides this target).
    // A free input of type `unknown` is refused: the compiled code must know
    // the shape of each input from its type. A condition over a real input
    // is not provably a collection either, and compiles.
    const ceWide = new ComputeEngine();
    ceWide.declare('u', 'unknown');
    const json = ['Which', ['Less', 'u', 3], 1, 'True', 0] as const;
    const refused = compile(ceWide.box(json as never), { to: 'interval-js' });
    expect(refused.success).toBe(false);
    expect(refused.diagnostic?.code).toBe('untyped-input');
    expect(refused.unsupported).toContain('u');
    const ceReal = new ComputeEngine();
    ceReal.declare('u', 'real');
    const fn = compile(ceReal.box(json as never), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain("=== 'true' ?");
    expect(fn.code).toContain('_IA.hull(');
  });
});

// Collection OPERANDS on the interval target (`At`, `Length`,
// `PointX`/`PointY`/`PointZ`). A collection is never the target's RESULT — its
// `run` contract is a single interval — but it is a legal operand of these
// accessors, where it is a JavaScript array of intervals at run time.
describe('INTERVAL JS - collection access', () => {
  const ceColl = new ComputeEngine();
  ceColl.declare('L', 'list<number>');
  ceColl.declare('P', 'tuple<number, number>');

  /** An `At` that selects nothing answers the `empty` result, the spelling
   * of an absent value on the interval-js target. */
  function expectAbsent(result) {
    expect(result).toStrictEqual({ kind: 'empty' });
  }

  test('At with a point index selects the element (1-based)', () => {
    const fn = compile(ceColl.box(['At', 'L', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('_IA.at(_.L,');
    // A plain numeric array input: each element is read as a point interval.
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 20, hi: 20 },
    });
  });

  test('At over an array of intervals', () => {
    const fn = compile(ceColl.box(['At', 'L', 2]), { to: 'interval-js' });
    expect(fn.run!({ L: [{ lo: 0, hi: 1 }, { lo: 2, hi: 5 }, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 5 },
    });
  });

  test('At out of range yields empty', () => {
    const fn = compile(ceColl.box(['At', 'L', 9]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expectAbsent(fn.run!({ L: [10, 20, 30] }));
  });

  test('At with a negative index counts from the end', () => {
    const fn = compile(ceColl.box(['At', 'L', -1]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 30, hi: 30 },
    });
  });

  test('At over a literal list with a literal index folds statically', () => {
    const fn = compile(ceColl.box(['At', ['List', 10, 20, 30], 2]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 20, hi: 20 } });
  });

  test('a literal-list index out of range folds to empty', () => {
    const fn = compile(ceColl.box(['At', ['List', 10, 20, 30], 7]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expectAbsent(fn.run!({}));
  });

  test('Length of a declared list', () => {
    const fn = compile(ceColl.box(['Length', 'L']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [10, 20, 30] })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('Length of a literal list folds statically', () => {
    const fn = compile(ceColl.box(['Length', ['List', 10, 20, 30]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
  });

  test('PointX/PointY of a declared tuple', () => {
    const fx = compile(ceColl.box(['PointX', 'P']), { to: 'interval-js' });
    const fy = compile(ceColl.box(['PointY', 'P']), { to: 'interval-js' });
    expect(fx.success).toBe(true);
    expect(fx.run!({ P: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
    expect(fy.run!({ P: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    // An interval-valued coordinate keeps its band.
    expect(fx.run!({ P: [{ lo: 0, hi: 1 }, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 1 },
    });
  });

  test('PointX of a literal Tuple folds statically', () => {
    const fn = compile(ceColl.box(['PointX', ['Tuple', 3, 4]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
  });
});

describe('INTERVAL JS - At with an index declared integer', () => {
  const ceK = new ComputeEngine();
  ceK.declare('L', 'list<real>');
  ceK.declare('k', 'integer');

  test('At with a WIDE index hulls the elements it spans', () => {
    const fn = compile(ceK.box(['At', 'L', 'k']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [10, 20, 30], k: { lo: 1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: 10, hi: 20 },
    });
    // Partly out of range: the value exists over only part of the index band.
    expect(fn.run!({ L: [10, 20, 30], k: { lo: 2, hi: 9 } })).toEqual({
      kind: 'partial',
      value: { lo: 20, hi: 30 },
      domainClipped: 'both',
    });
  });

  test('an absent value composes through interval arithmetic', () => {
    const fn = compile(ceK.box(['Add', ['At', 'L', 'k'], 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    // In range: ordinary arithmetic.
    expect(fn.run!({ L: [10, 20, 30], k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 21, hi: 21 },
    });
    // Out of range: the `empty` of the read propagates rather than inventing
    // a value.
    expect(fn.run!({ L: [10, 20, 30], k: 9 })).toStrictEqual({ kind: 'empty' });
  });
});

describe('INTERVAL JS - collections decline where the value model has no room', () => {
  const ceNo = new ComputeEngine();
  ceNo.declare('L', 'list<number>');
  ceNo.declare('PL', 'list<tuple<number, number>>');
  ceNo.declare('S', 'string');

  test('a List root is an array of intervals only for numeric elements', () => {
    // There is no `List`/`Tuple` lowering in the function table: the array
    // spelling exists only below a position that consumes a collection value
    // whole (`compileIntervalCollectionValue`), and the ROOT is one — its
    // array goes straight to the caller of `run`, the same contract a
    // comprehension root has (`IntervalValue`). The spelling covers elements
    // with an interval reading only, so a list of numbers is an array and a
    // list of booleans or strings declines as before.
    const fn = compile(ceNo.box(['List', 1, 2, 3]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'interval', value: { lo: 2, hi: 2 } },
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
    for (const root of [
      ceNo.box(['List', ['Less', 'x', 1], ['Less', 'x', 2]]),
      ceNo.box(['List', "'a'", "'b'"]),
    ]) {
      const declined = compile(root, { to: 'interval-js' });
      expect(declined.success).toBe(false);
    }
  });

  test('PointX over a LIST of points broadcasts the coordinate', () => {
    // The coordinates are a collection value (an array of intervals), which
    // an accessor projects back to one interval. The full lowering is pinned
    // in `compile-interval-collections.test.ts`.
    const fn = compile(ceNo.box(['Length', ['PointX', 'PL']]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(
      fn.run!({
        PL: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual({ kind: 'interval', value: { lo: 2, hi: 2 } });
  });

  test('Length of a string declines (no text model)', () => {
    const fn = compile(ceNo.box(['Length', 'S']), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });

  test('a collection-valued INDEX (gather) counts the gathered elements', () => {
    // The interpreter's value of `Length(At(L, [1, 2]))` is 2.
    const fn = compile(ceNo.box(['Length', ['At', 'L', ['List', 1, 2]]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ L: [5, 6, 7] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });
});

// A literal single point — a `Tuple` of scalars, or an all-scalar `PointList`
// — compiles at the ROOT of a compilation to the JavaScript array of its
// coordinate intervals. The value model is one interval per quantity, and a
// point is two quantities. The spelling is confined to the root: the scalar
// kernels read `.lo`/`.hi` off whatever they are handed, so a point in an
// operand position still declines.
describe('INTERVAL JS - a single point at the ROOT', () => {
  const cePt = new ComputeEngine();
  cePt.declare('a', 'real');
  cePt.declare('b', 'real');

  test('a Tuple of scalars at the root is an array of intervals', () => {
    const fn = compile(cePt.box(['Tuple', 'a', 'b']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('[_.a, _.b]');
    expect(fn.run!({ a: { lo: 1, hi: 2 }, b: 3 })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 2 } },
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
  });

  test('an all-scalar PointList at the root is an array of intervals', () => {
    const fn = compile(cePt.box(['PointList', 'a', 'b']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('[_.a, _.b]');
    expect(fn.run!({ a: { lo: 1, hi: 2 }, b: 3 })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 2 } },
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
  });

  test('a computed coordinate keeps its IntervalResult wrapper', () => {
    // Each coordinate is emitted by its ordinary scalar lowering, so a
    // coordinate that is a kernel result arrives as the `{ kind, value }`
    // wrapper, exactly as it would as a scalar root. The wrapper is not
    // unwrapped: it carries the `partial`/`jump` report of that coordinate.
    const fn = compile(
      cePt.box(['PointList', ['Multiply', 2, 'a'], ['Add', 'b', 1]]),
      { to: 'interval-js' }
    );
    expect(fn.success).toBe(true);
    expect(fn.run!({ a: { lo: 1, hi: 2 }, b: 3 })).toEqual([
      { kind: 'interval', value: { lo: 2, hi: 4 } },
      { kind: 'interval', value: { lo: 4, hi: 4 } },
    ]);
  });

  test('a point in an OPERAND position: arithmetic and kernels map, a selection declines', () => {
    // Point ARITHMETIC is coordinate-wise, and lowers through the
    // element-wise broadcast — the kernel is handed one coordinate at a
    // time, never the array (pinned in full in
    // `compile-interval-collections.test.ts`).
    const scaled = compile(cePt.box(['Multiply', ['Tuple', 'a', 'b'], 2]), {
      to: 'interval-js',
    });
    expect(scaled.success).toBe(true);
    expect(scaled.run!({ a: { lo: 1, hi: 2 }, b: 3 })).toEqual([
      { kind: 'interval', value: { lo: 2, hi: 4 } },
      { kind: 'interval', value: { lo: 6, hi: 6 } },
    ]);
    // A kernel maps over the coordinates of a point operand too, as the
    // interpreter does: `Sin((1, 2))` is `(sin 1, sin 2)`.
    const ceDeclared = new ComputeEngine();
    ceDeclared.declare('Pt', 'tuple<number, number>');
    const fn = compile(ceDeclared.box(['Sin', 'Pt']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const sines = fn.run!({ Pt: [1, 2] }) as any[];
    for (const [i, x] of [1, 2].entries()) {
      expect(sines[i].value.lo).toBeLessThanOrEqual(Math.sin(x));
      expect(sines[i].value.hi).toBeGreaterThanOrEqual(Math.sin(x));
    }
    // A `Which` whose arm is a point is a SELECTION among values at the root:
    // the point where its condition holds, the number where it fails, and no
    // one value (the absence marker, which the runner answers as `empty`)
    // where the condition is undecided.
    // Its branches have different shapes (a point and a number), so the
    // compilation declines: the shape of its value is known only at run
    // time. The fallback gives the interpreter's value.
    const fw = compile(
      cePt.box(['Which', ['Less', 'a', 1], ['Tuple', 'a', 'b'], 'True', 0]),
      { to: 'interval-js' }
    );
    expect(fw.success).toBe(false);
    expect(fw.diagnostic?.code).toBe('unsettled-shape');
  });

  test('a point with a broadcasting component is a list of points', () => {
    // A component that is itself a collection zips into one point per element,
    // so the value is a LIST of points. A `PointList` of that shape is built at
    // run time, the scalar component reused at every point; a `Tuple` of that
    // shape is a tuple that holds the list, as in the interpreter
    // (`([1,2], 3)`).
    const list = compile(cePt.box(['PointList', ['List', 1, 2], 'b']), {
      to: 'interval-js',
    });
    expect(list.success).toBe(true);
    expect(list.run!({ b: { lo: 3, hi: 3 } })).toEqual([
      [
        { kind: 'interval', value: { lo: 1, hi: 1 } },
        { kind: 'interval', value: { lo: 3, hi: 3 } },
      ],
      [
        { kind: 'interval', value: { lo: 2, hi: 2 } },
        { kind: 'interval', value: { lo: 3, hi: 3 } },
      ],
    ]);
    const tuple = compile(cePt.box(['Tuple', ['List', 1, 2], 'b']), {
      to: 'interval-js',
    });
    expect(tuple.success).toBe(true);
    expect(tuple.run!({ b: { lo: 3, hi: 3 } })).toEqual([
      [
        { kind: 'interval', value: { lo: 1, hi: 1 } },
        { kind: 'interval', value: { lo: 2, hi: 2 } },
      ],
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
  });

  test('a coordinate that is not provably a number declines', () => {
    const ceS = new ComputeEngine();
    ceS.declare('a', 'real');
    ceS.declare('S', 'string');
    const fn = compile(ceS.box(['Tuple', 'a', 'S']), { to: 'interval-js' });
    expect(fn.success).toBe(false);
  });

  test('a coordinate READ of a point is unchanged', () => {
    // The fixed-width fold projects the coordinate at compile time, so the
    // accessor still compiles to the coordinate's own code, not to an array.
    const fn = compile(cePt.box(['PointX', ['PointList', 'a', 'b']]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.code).toBe('_.a');
    expect(fn.run!({ a: { lo: 1, hi: 2 }, b: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
  });
});

describe('INTERVAL JS - ACCESSORS OVER AN ASSIGNED LITERAL', () => {
  // A symbol whose assigned value is a literal collection is looked through
  // by the accessors (`assignedLiteral` in the target): the element, count or
  // coordinate folds at compile time, where the generic symbol fold would
  // compile the `List`/`Tuple` value and decline.
  const ceA = new ComputeEngine();
  ceA.assign('La', ceA.box(['List', 10, 20, 30]));
  ceA.assign('Pa', ceA.box(['Tuple', 1, 2]));

  test('At over an assigned list folds to the element', () => {
    const fn = compile(ceA.box(['At', 'La', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 20, hi: 20 } });
  });

  test('Length of an assigned list folds to the count', () => {
    const fn = compile(ceA.box(['Length', 'La']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
  });

  test('PointY of an assigned point folds to the coordinate', () => {
    const fn = compile(ceA.box(['PointY', 'Pa']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toEqual({ kind: 'interval', value: { lo: 2, hi: 2 } });
  });
});

describe('INTERVAL JS - At/Length OVER A TUPLE BASE', () => {
  const ceT = new ComputeEngine();
  ceT.declare('Pt', 'tuple<number, number>');
  ceT.declare('Mixed', 'tuple<number, string>');

  test('At over a declared tuple reads the component', () => {
    const fn = compile(ceT.box(['At', 'Pt', 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Pt: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('Length of a declared tuple is its arity', () => {
    const fn = compile(ceT.box(['Length', 'Pt']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Pt: [1, 2] })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
  });

  test('At over a tuple with a non-numeric component declines', () => {
    const fn = compile(ceT.box(['At', 'Mixed', 1]), { to: 'interval-js' });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('outside-profile');
  });
});

describe('INTERVAL JS - COLLECTIONS: kernels fail closed, roots and fallbacks are arrays', () => {
  // One interval per quantity: a scalar kernel handed a collection operand
  // whose type does not PROVE a list of numbers declines with a reason (it
  // used to answer NaN bounds or `'maybe'` behind `success: true`); an
  // operand PROVABLY a list of numbers is mapped element-wise instead
  // (`_IA.bcast`, `compile-interval-collections.test.ts`); a
  // collection-valued RESULT is an array of interval values
  // (`IntervalValue`), on the compiled path and on the interpreter fallback
  // alike.
  const ceC = new ComputeEngine();
  ceC.declare('Lc', 'list<number>');
  // A collection whose elements are not provably numbers: no element-wise
  // lowering, the kernel gate stands.
  ceC.declare('Lu', 'list<unknown>');

  test('Add over a provable numeric list broadcasts; over a wider list it declines', () => {
    const fn = compile(ceC.box(['Add', 'Lc', 1]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Lc: [1, 2] })).toEqual([
      { kind: 'interval', value: { lo: 2, hi: 2 } },
      { kind: 'interval', value: { lo: 3, hi: 3 } },
    ]);
    const wide = compile(ceC.box(['Add', 'Lu', 1]), { to: 'interval-js' });
    expect(wide.success).toBe(false);
    expect(wide.diagnostic?.code).toBe('unsettled-shape');
  });

  test('Sin over a provable numeric list broadcasts; over a wider list it declines', () => {
    const fn = compile(ceC.box(['Sin', 'Lc']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const sines = fn.run!({ Lc: [1, 2] }) as any[];
    for (const [i, x] of [1, 2].entries()) {
      expect(sines[i].value.lo).toBeLessThanOrEqual(Math.sin(x));
      expect(sines[i].value.hi).toBeGreaterThanOrEqual(Math.sin(x));
    }
    const wide = compile(ceC.box(['Sin', 'Lu']), { to: 'interval-js' });
    expect(wide.success).toBe(false);
    expect(wide.diagnostic?.code).toBe('unsettled-shape');
  });

  test('an If with a collection-valued arm declines', () => {
    // A list and a number: the branches have different shapes.
    const fn = compile(ceC.box(['If', ['Less', 'x', 0], 'Lc', 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(false);
    expect(fn.diagnostic?.code).toBe('unsettled-shape');
  });

  test('an accessor over the same list still compiles (the gate is per kernel)', () => {
    const fn = compile(ceC.box(['Add', ['At', 'Lc', 1], 1]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ Lc: [5, 6] })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  test('the interpreter fallback maps a collection result to an array of point intervals', () => {
    // `Unique` has no interval lowering; with `fallback: true` the interpreter
    // evaluates it and its list is handed back element by element, not
    // collapsed to `entire`.
    const fn = compile(ceC.box(['Unique', ['List', 3, 2, 1, 2]]), {
      to: 'interval-js',
      fallback: true,
    });
    expect(fn.success).toBe(false);
    // Each present number is the interval result of a point.
    expect(fn.run!({})).toEqual([
      { kind: 'interval', value: { lo: 3, hi: 3 } },
      { kind: 'interval', value: { lo: 2, hi: 2 } },
      { kind: 'interval', value: { lo: 1, hi: 1 } },
    ]);
  });
});

describe('INTERVAL JS - CONSTANT ARRAYS ARE BOUND ONCE PER ARTIFACT', () => {
  // A list value the emitter spells at each read site built one array per
  // read per call — inside a loop-form sum once per iteration (a 400-element
  // assigned list read 400 times per evaluation, Tycho corpus document
  // `vwbagbcerj`). The constant table (`hoistIntervalConstants`) now binds an
  // array of bound constants once, after its elements, and an unrolled term
  // whose index folds to a constant integer selects its element at compile
  // time and never reads the array at all.
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('k', 'integer');
  const h = Array.from({ length: 120 }, (_, i) => (i + 1) / 8);
  ce.assign('h', ce.box(['List', ...h]));

  test('an unrolled sum over an assigned list selects each element statically', () => {
    // The index of the unrolled term is `i + 1` with `i` substituted, an
    // unfolded sum the constant fold answers — not a number literal.
    const expr = ce.parse('\\sum_{i=0}^{3} h[i+1] x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    expect(fn.code).not.toContain('_IA.at(');
    expect(emitted(fn)).not.toContain('[_k');
    const v = fn.run!({ x: { lo: 2, hi: 2 } }) as {
      value: { lo: number; hi: number };
    };
    const exact = 2 * (h[0] + h[1] + h[2] + h[3]);
    expect(v.value.lo).toBeCloseTo(exact, 12);
    expect(v.value.hi).toBeCloseTo(exact, 12);
  });

  test('a loop-form sum over an assigned list reads one array bound in the table', () => {
    // 120 terms: above the unroll limit, so the sum is a loop and the index
    // is the loop variable.
    const expr = ce.parse('\\sum_{i=1}^{120} h[i] x');
    const fn = compile(expr, { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const v = fn.run!({ x: { lo: 2, hi: 2 } }) as {
      value: { lo: number; hi: number };
    };
    const exact = 2 * h.reduce((a, b) => a + b, 0);
    expect(v.value.lo).toBeLessThanOrEqual(exact);
    expect(v.value.hi).toBeGreaterThanOrEqual(exact);
    expect(v.value.hi - v.value.lo).toBeLessThan(1e-9);
  });

  test('a nested list is bound from the inside out', () => {
    const fn = compile(ce.box(['List', ['List', 1, 2], ['List', 3, 4]]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    // Answered at the root, the constant is copied at every level, so a
    // caller who writes to the result cannot change what the next call
    // answers.
    const a = fn.run!({}) as unknown[][];
    const b = fn.run!({}) as unknown[][];
    expect(a).toEqual([
      [
        { kind: 'interval', value: { lo: 1, hi: 1 } },
        { kind: 'interval', value: { lo: 2, hi: 2 } },
      ],
      [
        { kind: 'interval', value: { lo: 3, hi: 3 } },
        { kind: 'interval', value: { lo: 4, hi: 4 } },
      ],
    ]);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
    expect(a[0][0]).not.toBe(b[0][0]);
  });

  test('an array with a run-time element stays where it is', () => {
    const fn = compile(ce.box(['At', ['List', 'x', 2, 3], 'k']), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    expect(fn.run!({ x: { lo: 1, hi: 2 }, k: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 2 },
    });
    expect(fn.run!({ x: { lo: 1, hi: 2 }, k: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 2 },
    });
    expect(fn.run!({ x: 5, k: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 3, hi: 3 },
    });
  });

  test('a constant array answered at the root is a fresh copy on every call', () => {
    const fn = compile(ce.box(['List', 1, 2]), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const a = fn.run!({}) as unknown[];
    const b = fn.run!({}) as unknown[];
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('INTERVAL JS - NORM OF A POINT WITH A LIST COMPONENT', () => {
  // `|(x + [1/2, 1], y)|` is one point per element of the list component, so
  // its norm is one number per element. The JavaScript target answers that
  // list. This target answers the array of one enclosure per element, written
  // as the explicit `√(Σ cᵢ²)` when the lists have one known length, and as a
  // run-time zip of the points otherwise.
  const ceN = new ComputeEngine();
  ceN.declare('x', 'real');
  ceN.declare('y', 'real');
  ceN.declare('L', 'list<real>');

  const samples = [
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: -0.75, y: 0.3 },
    { x: 3.5, y: -2.25 },
  ];

  /** Compile `latex` on both targets and check that, at every sample, each
   *  interval of the interval target encloses the JavaScript value. */
  function agreesWithJavaScript(latex: string, L?: number[]): string {
    const expr = ceN.parse(latex);
    const js = compile(expr, { to: 'javascript', fallback: false });
    const iv = compile(expr, { to: 'interval-js', fallback: false });
    expect(js.success).toBe(true);
    expect(iv.success).toBe(true);
    for (const { x, y } of samples) {
      const expected = js.run!({ x, y, L }) as number[];
      // An element is an interval, or a result that carries one.
      const actual = (iv.run!({ x, y, L }) as any[]).map(
        (r) =>
          (r.kind === 'interval' ? r.value : r) as { lo: number; hi: number }
      );
      expect(actual).toHaveLength(expected.length);
      expected.forEach((v, i) => {
        expect(actual[i].lo).toBeLessThanOrEqual(v);
        expect(actual[i].hi).toBeGreaterThanOrEqual(v);
        expect(actual[i].hi - actual[i].lo).toBeLessThan(1e-12);
      });
    }
    return iv.code;
  }

  test('a list in the first component', () => {
    agreesWithJavaScript(
      '\\left|\\left(x+\\left[\\frac{1}{2},1\\right],y\\right)\\right|'
    );
  });

  test('a list in the second component', () => {
    agreesWithJavaScript('\\left|\\left(x,y+[1,2]\\right)\\right|');
  });

  test('two lists of the same length', () => {
    agreesWithJavaScript('\\left|\\left(x+[1,2],y+[3,4]\\right)\\right|');
  });

  test('a point with three components', () => {
    agreesWithJavaScript('\\left|\\left(x+[1,2],y,x-y\\right)\\right|');
  });

  test('lists of different lengths zip to the shortest, as on JavaScript', () => {
    agreesWithJavaScript('\\left|\\left(x+[1,2],y+[3,4,5]\\right)\\right|');
  });

  test('a list whose length is known only at run time zips at run time', () => {
    agreesWithJavaScript('\\left|\\left(L,y\\right)\\right|', [1, -2, 0.5]);
  });

  test('a Tuple whose lists have different lengths still declines', () => {
    // A `Tuple` broadcasts its lists element-wise, which requires one length;
    // it does not zip to the shortest list as a `PointList` does.
    const d = declineOf(() =>
      compile(
        ceN.box([
          'Abs',
          [
            'Tuple',
            ['Add', 'x', ['List', 1, 2]],
            ['Add', 'y', ['List', 3, 4, 5]],
          ],
        ]),
        { to: 'interval-js', fallback: false }
      )
    );
    expect(d.code).toBe('outside-profile');
  });

  test('a point of scalars keeps the scalar norm', () => {
    const tuple = compile(ceN.parse('\\left|\\left(x,y\\right)\\right|'), {
      to: 'interval-js',
      fallback: false,
    });
    expect(tuple.success).toBe(true);
    // An all-scalar `PointList` is one point too.
    const pointList = compile(ceN.box(['Abs', ['PointList', 'x', 'y']]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(pointList.success).toBe(true);
  });
});

describe('INTERVAL JS - APPLIED DERIVATIVE OF A FUNCTION OF TWO ARGUMENTS', () => {
  // `Apply(Derivative(F, k₁, k₂), a, b)` compiles from the closed form of the
  // derivative, which the `Derivative` evaluate handler computes.
  const ceD = new ComputeEngine();
  ceD.declare('x', 'real');
  ceD.declare('y', 'real');
  ceD.declare('h', 'function');
  ceD.assign('h', ceD.parse('(u, w) \\mapsto u^2 \\sin(w)'));

  function compiled(f: string, k1: number, k2: number) {
    return compile(ceD.box(['Apply', ['Derivative', f, k1, k2], 'x', 'y']), {
      to: 'interval-js',
      fallback: false,
    });
  }

  test('the closed form is the callee', () => {
    for (const [f, k1, k2] of [
      ['Power', 0, 1],
      ['Arctan2', 1, 0],
      ['h', 1, 1],
    ] as const) {
      const fn = compiled(f, k1, k2);
      expect(fn.success).toBe(true);
      const closedForm = ceD
        .box(['Apply', ['Derivative', f, k1, k2], 'x', 'y'])
        .evaluate();
      for (const [x, y] of [
        [1.7, 2.3],
        [0.4, 3.1],
      ]) {
        const expected = closedForm.subs({ x, y }).N().re;
        const v = unwrapInterval(fn.run!({ x, y }));
        expect(v.lo).toBeLessThanOrEqual(expected);
        expect(v.hi).toBeGreaterThanOrEqual(expected);
      }
      const box = unwrapInterval(
        fn.run!({ x: { lo: 1.7, hi: 1.71 }, y: { lo: 2.3, hi: 2.31 } })
      );
      for (const [x, y] of [
        [1.7, 2.3],
        [1.705, 2.305],
        [1.71, 2.31],
      ]) {
        const expected = closedForm.subs({ x, y }).N().re;
        expect(box.lo).toBeLessThanOrEqual(expected);
        expect(box.hi).toBeGreaterThanOrEqual(expected);
      }
    }
  });

  test('the enclosure contains the value of the closed form', () => {
    for (const [f, k1, k2] of [
      ['Power', 1, 0],
      ['Log', 0, 1],
      ['Arctan2', 0, 1],
      ['Mod', 0, 1],
      ['h', 1, 1],
    ] as const) {
      const run = compiled(f, k1, k2).run!;
      const closedForm = ceD
        .box(['Apply', ['Derivative', f, k1, k2], 'x', 'y'])
        .evaluate();
      for (const [x, y] of [
        [1.7, 2.3],
        [0.4, 3.1],
      ]) {
        const expected = closedForm.subs({ x, y }).N().re;
        const r = run({ x, y }) as any;
        const v = r.kind === 'interval' ? r.value : r;
        expect(v.lo).toBeLessThanOrEqual(expected);
        expect(v.hi).toBeGreaterThanOrEqual(expected);
      }
    }
  });

  test('a derivative with no closed form declines', () => {
    expect(declineOf(() => compiled('BesselJ', 1, 0))).toMatchObject({
      code: 'outside-profile',
      operator: 'Derivative',
    });
  });
});

describe('INTERVAL JS COMPILATION - ZERO TO THE POWER ZERO (CE-1372)', () => {
  // `0^0` has no value, as the interpreter and the JavaScript targets read
  // it (`NaN`): the point is `empty`, and a comparison on it is `'false'`.
  // A box that holds the point and others keeps its enclosure.
  test('y^x at (0, 0) is empty', () => {
    const fn = compile(ce.box(['Power', 'y', 'x']), { to: 'interval-js' });
    expect(fn.success).toBe(true);
    const point = { lo: 0, hi: 0 };
    expect(fn.run!({ x: point, y: point })).toEqual({ kind: 'empty' });
    expect(fn.run!({ x: point, y: { lo: 0, hi: 1 } })).toEqual({
      kind: 'interval',
      value: { lo: 1, hi: 1 },
    });
  });

  test('a comparison on 0^0 is not decided true', () => {
    const fn = compile(
      ce.box([
        'Less',
        0,
        ['Add', ['Multiply', 'y', ['Power', 'y', ['Floor', 'x']]], 1],
      ]),
      { to: 'interval-js' }
    );
    expect(fn.run!({ x: { lo: 0.5, hi: 0.5 }, y: { lo: 0, hi: 0 } })).toBe(
      'false'
    );
  });
});
