/**
 * An ELSE-LESS `If` in STATEMENT position (2026-08-08).
 *
 * `if c { … }` with no else is a guard STATEMENT: its arm is an assignment,
 * a block or a jump, which has no expression form. `compileExpr`'s
 * conditional needs an expression in every operand and threw `If: wrong
 * number of arguments` on such a two-operand one. (The VALUE form of the
 * two-operand `If` — an expression arm, `If(c, x + 1)` — is a different
 * shape: since the no-selection ruling of 2026-08-27 the interpreter answers
 * `Missing` for it when the condition is false, and since 2026-09-09 the
 * compiler lowers it as the one-clause `Which(c, x + 1)` on every target,
 * with the codomain's absence marker — `NaN` for a number — where no clause
 * is selected. The last test of the first describe pins that form.)
 *
 * A LOOP BODY never hit that — `compileLoopBody` (JavaScript) statement-forms
 * `If` and already emits the no-else shape. A plain function-body `Block` did, because its statements route
 * through `compileExpr`. So every function containing a guard statement failed
 * to compile, including the `parseNumber` scanner of the Epsil examples
 * (`if cs[j] == "-" { sign = -1; j = j + 1 }`).
 *
 * The fix is confined to the STATEMENT positions of a block: a block's last
 * statement, when the block's value is used, is NOT one — an else-less `If`
 * there is the value form, and compiles as the one-clause `Which` described
 * above.
 *
 * It is also confined to PLAIN JavaScript. Interval-JavaScript function
 * bodies keep declining, for a verified reason — see the
 * `the admission is plain-JavaScript only` describe at the bottom.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

describe('an else-less If as a block statement', () => {

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

  test('an else-less If in VALUE position is the one-clause Which', () => {
    // The block's value is the `If`'s. The interpreter answers `2` when the
    // condition holds and `Missing` when it does not (no-selection ruling
    // 2026-08-27), and the compiled function answers `2` and the absence
    // marker of the number codomain, `NaN` — the same lowering the
    // default-less `Which(x > 0, 2)` gets. Before 2026-09-09 this shape was
    // refused with `If: wrong number of arguments` on every target.
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], 2],
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 1 })).toBe(2);
    expect((r.run as any)({ x: -1 })).toBeNaN();
  });

  test('the value-form else-less If compiles on every target as a one-clause Which', () => {
    ce.declare('x', 'number');
    const expr = ce.box(['If', ['Greater', 'x', 0], ['Add', 'x', 1]]);
    for (const to of ['javascript', 'interval-js', 'glsl'] as const) {
      const r = compile(expr, { to, fallback: false });
      expect([to, r.success]).toEqual([to, true]);
    }
    const js = compile(expr, { fallback: false });
    expect((js.run as any)({ x: 2 })).toBe(3);
    expect((js.run as any)({ x: -2 })).toBeNaN();
  });

  test('a Block arm is read through to its value statement', () => {
    ce.declare('x', 'number');
    // `Block(Declare(y, "unknown", x), y)` ends in a value, so the else-less
    // `If` around it is the value form and compiles as the one-clause
    // `Which`.
    const valueBlock = ce.box([
      'If',
      ['Greater', 'x', 0],
      ['Block', ['Declare', 'y', "'unknown'", 'x'], 'y'],
    ]);
    const r = compile(valueBlock, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as any)({ x: 2 })).toBe(2);
    expect((r.run as any)({ x: -2 })).toBeNaN();
  });
});

// -----------------------------------------------------------------------------
// TARGET COVERAGE. The admission is PLAIN JavaScript only. Each other target
// stays fail-closed for its own verified reason — pinned here so a future
// widening has to confront the evidence.
// -----------------------------------------------------------------------------

describe('an EMPTY block — effect position compiles, value position declines', () => {
  // An empty `Block` is canonical and evaluates to `Nothing`, the erasure
  // marker, which has no compiled representation. Where the block's value is
  // discarded it is an empty statement; where it is consumed the shape
  // declines (D6) instead of splicing `''` into a template (`(x) => `).
  const ce = new ComputeEngine();

  test('an empty block as a non-final statement is an empty statement', () => {
    const expr = ce.box([
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', 'value', 0]]],
      ['Block'],
      's',
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(0);
  });
});

describe('the admission is plain-JavaScript only', () => {
  /** `{ let s = 1; if x > 0 { s = -1 }; s }` — the shape fixed above. */
  function elselessBlock(engine: ComputeEngine): Expression {
    engine.declare('x', 'number');
    return engine.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1]],
      's',
    ]);
  }

  test('INTERVAL JavaScript encloses the value of the interpreter', () => {
    // The interval mode writes the statement on each side of an undecided
    // condition and answers the hull of the values of `s`.
    const expr = elselessBlock(ce);
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    for (const x of [3, -3, 0]) {
      ce.assign('x', x);
      const want = expr.evaluate().re;
      expect((r.run as any)({ x })).toEqual({
        kind: 'interval',
        value: { lo: want, hi: want },
      });
    }
    // On `[-1, 2]` the condition is undecided: the box holds both values.
    expect((r.run as any)({ x: { lo: -1, hi: 2 } })).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: 1 },
    });
  });

  test('…and the interval else-FUL lowering, which is correct, is untouched', () => {
    // The contrast that makes the decline above the right call: with an else,
    // interval-js emits its closure-free conditional over `_IA.less(…)` and
    // answers correctly for a point interval.
    ce.declare('x', 'number');
    const expr = ce.box([
      'Block',
      ['Declare', 's', { str: 'unknown' }, 1],
      ['If', ['Greater', 'x', 0], ['Assign', 's', -1], ['Assign', 's', 7]],
      's',
    ]);
    const r = compile(expr, { to: 'interval-js', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/=== 'true' \?/);
    expect(r.code).toContain('_IA.hull(');
    expect((r.run as any)({ x: 3 })).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: -1 },
    });
    expect((r.run as any)({ x: -3 })).toEqual({
      kind: 'interval',
      value: { lo: 7, hi: 7 },
    });
  });
});

/**
 * A STATEMENT-form `If` under an undecided condition (ruling 2026-09-02).
 *
 * The expression form answers NaN when its condition is not exactly `true` or
 * `false`. A statement has no value, so the same rule reads: run NEITHER
 * branch, and carry on with the next statement. That is the interpreter's
 * inertness — it holds an undecidable `If` rather than choosing an arm, so no
 * assignment inside it happens and no `Break` under it fires.
 *
 * The condition is undecided for the two reasons a comparison can be: a NaN
 * operand, and an operand the caller left out of the vars object. JavaScript
 * answers an ordinary `false` for a comparison against either, so before the
 * ruling the else-less `if` simply did not run and the else-FUL one ran its
 * else branch — in both cases a decision the condition did not support.
 */
describe('a statement-form If takes no branch on an undecided condition', () => {

  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so a condition input cannot be declared absent.
  test('a condition declared boolean | missing is a static error', () => {
    expect(() => new ComputeEngine().declare('b', 'boolean | missing')).toThrow();
  });
});
