/**
 * Grouping of a compound FACTOR in a shader `Multiply`.
 *
 * A GPU target lowers a `Multiply` with a vector operand through the shared
 * function handler rather than the infix path (the infix path declines as soon
 * as an operand is a collection), and that handler joined its already-compiled
 * operand strings with a bare ` * `. Since the `compile` callback a handler
 * receives carries no precedence context, an additive factor arrived
 * unparenthesized and was spliced raw:
 *
 *   Multiply(Add(t, 1), Tuple(x, 0))  →  t + 1.0 * vec2(x, 0.0)
 *
 * GLSL reads that as `t + (1.0 * vec2(x, 0.0))`, broadcasting the float into
 * the vector — the wrong geometry, behind `success: true`. The consumer
 * witness is the Desmos lerp `t·P₁ + (1−t)·P₀`, which compiled to `t·P₁ − t +
 * P₀`.
 *
 * The same grouping is lost one level up, where an INFIX `*` has a
 * function-handler operand: the `Add` handler emits `vec2(a, b) + vec2(c, d)`
 * for a sum of two points, and the dispatcher returned that verbatim, so
 * `s · (P + Q)` emitted `s * vec2(a, b) + vec2(c, d)`.
 *
 * A third instance of the same class, found while probing and fixed with it,
 * is not GPU-specific: unwrapping a single-statement `Block` used as a
 * sub-expression dropped the grouping its braces carried, on every target.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
const glsl = new GLSLTarget();
const wgsl = new WGSLTarget();

/**
 * Compile-time constant folding is off: several probes below are all-literal
 * point expressions that would otherwise be evaluated at compile time and
 * emitted as one `vec2` literal, erasing the operand grouping under test.
 */
const NO_FOLD = { constantFold: false } as const;

function g(expr: any): string {
  const result = glsl.compile(ce.box(expr), NO_FOLD);
  expect(result.success).toBe(true);
  return result.code!;
}

function w(expr: any): string {
  const result = wgsl.compile(ce.box(expr), NO_FOLD);
  expect(result.success).toBe(true);
  return result.code!;
}

describe('a compound factor of a vector Multiply keeps its grouping', () => {
  test('the minimal shape: (t + 1) · (x, 0)', () => {
    const expr = ['Multiply', ['Add', 't', 1], ['Tuple', 'x', 0]];
    expect(g(expr)).toBe('(t + 1.0) * vec2(x, 0.0)');
    expect(w(expr)).toBe('(t + 1.0) * vec2f(x, 0.0)');
  });

  test('the lerp witness t·P₁ + (1 − t)·P₀', () => {
    const expr = [
      'Add',
      ['Multiply', 't', ['Tuple', 'x1', 'y1']],
      ['Multiply', ['Add', ['Negate', 't'], 1], ['Tuple', 'x0', 'y0']],
    ];
    expect(g(expr)).toBe('(-t + 1.0) * vec2(x0, y0) + t * vec2(x1, y1)');
    expect(w(expr)).toBe('(-t + 1.0) * vec2f(x0, y0) + t * vec2f(x1, y1)');
  });

  test('the lerp witness with the terms authored in the other order', () => {
    const expr = [
      'Add',
      ['Multiply', ['Add', ['Negate', 't'], 1], ['Tuple', 'x0', 'y0']],
      ['Multiply', 't', ['Tuple', 'x1', 'y1']],
    ];
    expect(g(expr)).toBe('(-t + 1.0) * vec2(x0, y0) + t * vec2(x1, y1)');
    expect(w(expr)).toBe('(-t + 1.0) * vec2f(x0, y0) + t * vec2f(x1, y1)');
  });

  test('three factors: 2 · (t + 1) · (x, 0)', () => {
    const expr = ['Multiply', ['Add', 't', 1], ['Tuple', 'x', 0], 2];
    expect(g(expr)).toBe('2.0 * (t + 1.0) * vec2(x, 0.0)');
    expect(w(expr)).toBe('2.0 * (t + 1.0) * vec2f(x, 0.0)');
  });

  test('a sum of two POINTS as the factor: s · (P + Q)', () => {
    // The factor is emitted by the `Add` FUNCTION handler (`vec2 + vec2`),
    // which the dispatcher returns verbatim; the enclosing `*` is the infix
    // path here, not the `Multiply` handler.
    const expr = [
      'Multiply',
      ['Add', ['Tuple', 'a', 'b'], ['Tuple', 'c', 'd']],
      's',
    ];
    expect(g(expr)).toBe('s * (vec2(a, b) + vec2(c, d))');
    expect(w(expr)).toBe('s * (vec2f(a, b) + vec2f(c, d))');
  });

  test('a compound factor on BOTH sides: (t + 1) · (P + Q)', () => {
    const expr = [
      'Multiply',
      ['Add', ['Tuple', 'a', 'b'], ['Tuple', 'c', 'd']],
      ['Add', 't', 1],
    ];
    expect(g(expr)).toBe('(t + 1.0) * (vec2(a, b) + vec2(c, d))');
    expect(w(expr)).toBe('(t + 1.0) * (vec2f(a, b) + vec2f(c, d))');
  });

  test('a user function whose body is a sum compiles to an atomic call', () => {
    // No parentheses are needed and none are added: the application lowers to
    // a call to an emitted helper, which binds tighter than `*` already. Its
    // own body is where the sum lives.
    const engine = new ComputeEngine();
    engine.assign('f', ['Function', ['Add', 't', 1], 't'] as any);
    const expr = engine.box(['Multiply', ['f', 't'], ['Tuple', 'x', 0]] as any);
    const result = new GLSLTarget().compile(expr, NO_FOLD);
    expect(result.success).toBe(true);
    expect(result.code).toBe('vec2(x, 0.0) * _fn_f(t)');
  });
});

describe('a single-statement Block keeps its grouping as a sub-expression', () => {
  // Unwrapping the block removes the braces that carried the grouping, so the
  // lone statement must be compiled at the ENCLOSING precedence. This is not
  // GPU-specific — every target dropped the parentheses.
  const block = ['Block', ['Add', 't', 1]];

  test('as a factor, on every target', () => {
    const expr = ['Multiply', block, 'x'];
    expect(g(expr)).toBe('x * (t + 1.0)');
    expect(w(expr)).toBe('x * (t + 1.0)');
    const js = compile(ce.box(expr as any), {
      to: 'javascript',
      constantFold: false,
    } as any);
    expect(js.success).toBe(true);
    expect(js.code).toBe('_.x * (_.t + 1)');
    const py = compile(ce.box(expr as any), {
      to: 'python',
      constantFold: false,
    } as any);
    expect(py.success).toBe(true);
    expect(py.code).toBe('x * (t + 1)');
  });

  test('under a Negate', () => {
    expect(g(['Negate', block])).toBe('-(t + 1.0)');
    expect(w(['Negate', block])).toBe('-(t + 1.0)');
  });

  test('no parentheses where the enclosing operator binds looser', () => {
    // The block's statement is a `*`, the enclosing operator a `+`: nothing to
    // group, and the emission must not grow redundant parentheses.
    expect(g(['Add', ['Block', ['Multiply', 't', 2]], 'x'])).toBe(
      'x + 2.0 * t'
    );
  });
});

describe('controls: emissions that were already correct are unchanged', () => {
  test('a SCALAR multiply takes the infix path and self-parenthesizes', () => {
    const expr = ['Multiply', ['Add', 't', 1], 'x'];
    expect(g(expr)).toBe('x * (t + 1.0)');
    expect(w(expr)).toBe('x * (t + 1.0)');
  });

  test('a Divide by a sum', () => {
    const expr = ['Divide', ['Tuple', 'x', 0], ['Add', 't', 1]];
    expect(g(expr)).toBe('vec2(x / (t + 1.0), 0.0)');
    expect(w(expr)).toBe('vec2f(x / (t + 1.0), 0.0)');
  });

  test('a Negate factor is not re-wrapped', () => {
    // `Negate` binds tighter than `*`, so the factor needs no parentheses of
    // its own — the canonical form here hoists the negation out of the
    // product.
    const expr = ['Multiply', ['Negate', ['Add', 't', 1]], ['Tuple', 'x', 0]];
    expect(g(expr)).toBe('-((t + 1.0) * vec2(x, 0.0))');
  });

  test('the javascript target broadcasts instead of splicing an infix `*`', () => {
    const result = compile(
      ce.box(['Multiply', ['Add', 't', 1], ['Tuple', 'x', 0]] as any),
      { to: 'javascript', constantFold: false } as any
    );
    expect(result.success).toBe(true);
    expect(result.code).toBe(
      '_SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), _.t + 1, [_.x, 0])'
    );
  });

  test('the python target fails closed on arithmetic over a point', () => {
    // Python's `*` repeats a list instead of broadcasting, so the target
    // declines rather than emitting a wrong answer — it never had this hole.
    const result = compile(
      ce.box(['Multiply', ['Add', 't', 1], ['Tuple', 'x', 0]] as any),
      { to: 'python', constantFold: false } as any
    );
    expect(result.success).toBe(false);
  });
});
