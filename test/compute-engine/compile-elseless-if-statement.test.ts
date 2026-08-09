/**
 * An ELSE-LESS `If` in STATEMENT position (2026-08-08).
 *
 * `if c { … }` with no else has no value: the interpreter answers `Nothing`,
 * the erasure marker, which the compile targets deliberately refuse to
 * materialize ("the erasure marker is not a value"). `compileExpr`'s
 * conditional therefore needs all three operands and threw `If: wrong number of
 * arguments` on a two-operand one.
 *
 * A LOOP BODY never hit that — `compileLoopBody` (JavaScript) and
 * `compilePythonStatements` (Python) statement-form `If` and already emit the
 * no-else shape. A plain function-body `Block` did, because its statements route
 * through `compileExpr`. So every function containing a guard statement failed
 * to compile, including the `parseNumber` scanner of the Epsil examples
 * (`if cs[j] == "-" { sign = -1; j = j + 1 }`).
 *
 * The fix is confined to the STATEMENT positions of a block: a block's last
 * statement, when the block's value is used, is NOT one — an else-less `If`
 * there still fails closed (D6), since its value is the block's and there is
 * none.
 *
 * It is also confined to PLAIN JavaScript. Python and interval-JavaScript
 * function bodies keep declining, each for a verified reason — see the
 * `the admission is plain-JavaScript only` describe at the bottom.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('an else-less If as a block statement', () => {
  test('compiles to a bare `if (…) { … }` and runs', () => {
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1]],
      's',
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(`
      "(() => {
      let s = 1;
      if (0 < _.x) { s = -1 };
      return s
      })()"
    `);
    // …and the compiled answers ARE the interpreted ones.
    for (const [x, expected] of [
      [3, -1],
      [-3, 1],
    ] as const) {
      expect(r.run!({ x })).toBe(expected);
      ce.assign('x', x);
      expect(expr.evaluate().re).toBe(expected);
    }
  });

  test('a multi-statement then-branch composes', () => {
    executeEpsil(
      ce,
      'function g(x: integer) -> integer {\n' +
        '  let s = 1\n' +
        '  if x > 0 {\n    s = -1\n    x = x + 10\n  }\n' +
        '  s * x\n}'
    );
    for (const [arg, expected] of [
      [3, -13],
      [-3, -3],
    ] as const) {
      const call = ce.box(['g', arg]);
      expect(call.evaluate().re).toBe(expected);
      const r = compile(call, { fallback: false });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(expected);
    }
  });

  test('the `parseNumber` sign/fraction guards of the Epsil examples compile', () => {
    // The shape from `src/epsil/docs/examples.md`: two else-less guards around
    // destructuring assignments from a tuple-returning call.
    executeEpsil(
      ce,
      'let digits = Characters("0123456789")\n' +
        'isDigit(c: string | missing) = c in digits\n' +
        'function parseDigits(cs: list<string>, i: integer) -> tuple<integer, integer> {\n' +
        '  let j = i\n  let n = 0\n' +
        '  while j <= Length(cs) && isDigit(cs[j]) { n = 10 * n + 1\n j = j + 1 }\n' +
        '  (n, j)\n}\n' +
        'function parseNumber(cs: list<string>, i: integer) -> tuple<number, integer> {\n' +
        '  let j = i\n  let sign = 1\n' +
        '  if cs[j] == "-" {\n    sign = -1\n    j = j + 1\n  }\n' +
        '  let n = 0\n  (n, j) := parseDigits(cs, j)\n' +
        '  if cs[j] == "." {\n    let f = 0\n    let start = j + 1\n' +
        '    (f, j) := parseDigits(cs, start)\n' +
        '    n = n + f / 10^(j - start)\n  }\n' +
        '  (sign * n, j)\n}'
    );
    // `parseDigits` here decodes each digit as a `1` (the real one uses
    // `IndexOf`, which is closed on string evidence by a separate, deliberate
    // gate); the guards are what this test is about.
    const call = ce.box(['parseNumber', ['Characters', { str: '-12.5' }], 1]);
    const r = compile(call, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toEqual([-11.1, 6]);
    // The interpreter's exact answer is the same number.
    const interpreted = call.evaluate();
    expect(interpreted.ops![0].N().re).toBeCloseTo(-11.1, 10);
    expect(interpreted.ops![1].re).toBe(6);
  });

  test('an else-less If in a LOOP BODY was already fine, and still is', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 0],
      [
        'Loop',
        ['If', ['Greater', 'i', 2], ['Assign', 's', ['Add', 's', 'i']]],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!()).toBe(12);
    expect(expr.evaluate().re).toBe(12);
  });

  test('an else-less If in VALUE position still fails closed (D6)', () => {
    // The block's value would be the `If`'s, and it has none — the interpreter
    // answers `Nothing`. Declining lets the interpreter say so.
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], 2],
    ]);
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/If: wrong number of arguments/);
  });

  test('an If WITH an else is untouched (the ternary, byte for byte)', () => {
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1], ['Assign', 's', 2]],
      's',
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatchInlineSnapshot(`
      "(() => {
      let s = 1;
      ((0 < _.x) ? (s = -1) : (s = 2));
      return s
      })()"
    `);
    expect(r.run!({ x: 3 })).toBe(-1);
    expect(r.run!({ x: -3 })).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// TARGET COVERAGE. The admission is PLAIN JavaScript only. Each other target
// stays fail-closed for its own verified reason — pinned here so a future
// widening has to confront the evidence.
// -----------------------------------------------------------------------------

describe('the admission is plain-JavaScript only', () => {
  /** `{ let s = 1; if x > 0 { s = -1 }; s }` — the shape fixed above. */
  function elselessBlock(engine: ComputeEngine): BoxedExpression {
    engine.declare('x', 'number');
    return engine.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1]],
      's',
    ]);
  }

  test('PYTHON still declines (the statement dispatcher is loop-body only)', () => {
    // `compilePythonStatements` DOES statement-form an else-less `If`, but a
    // plain function-body `Block` never reaches it — only a loop body does. So
    // the shape falls back to the interpreter here. Routing it needs a target
    // hook (`block` receives already-compiled statements), a separate change.
    const r = compile(elselessBlock(ce), { to: 'python' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/If: wrong number of arguments/);
  });

  test('a Python LOOP body with an else-less If was already fine', () => {
    // The positive control for the reason above: the same `If`, reached from
    // `compilePythonStatements`, compiles to a Python `if` statement.
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 0],
      [
        'Loop',
        ['If', ['Greater', 'i', 2], ['Assign', 's', ['Add', 's', 'i']]],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ]);
    const r = compile(expr, { to: 'python', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/if \(?2 < i\)?:/);
  });

  test('INTERVAL JavaScript still declines — the emission would be WRONG', () => {
    // `compileLoopBody` would emit syntactically valid code here, but its
    // `scalarConditionTarget` only unwraps a literal `_IA.point(…)` spelling
    // (the plain-number loop counter it was written for). A condition over a
    // free variable compiles to `0 < _.x` against an `{lo, hi}` OBJECT, which
    // is always `false`. Admitting the shape would be a silent wrong answer,
    // which is worse than declining.
    const r = compile(elselessBlock(ce), { to: 'interval-js' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/If: wrong number of arguments/);
  });

  test('…and the interval else-FUL lowering, which is correct, is untouched', () => {
    // The contrast that makes the decline above the right call: with an else,
    // interval-js emits `_IA.piecewise(_IA.less(…), …)` and answers correctly
    // for a point interval.
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1], ['Assign', 's', 7]],
      's',
    ]);
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_IA\.piecewise/);
    expect((r.run as any)({ x: 3 })).toEqual({ lo: -1, hi: -1 });
    expect((r.run as any)({ x: -3 })).toEqual({ lo: 7, hi: 7 });
  });

  test('the GPU targets stay fail-closed', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const e = new ComputeEngine();
      const r = compile(elselessBlock(e), { to });
      expect(r.success).toBe(false);
    }
  });
});
