import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An IMPURE branch condition is three-valued like any other (ruled
 * 2026-09-03). Before the ruling `conditionDecidability` declined any
 * condition with an impure leaf, because the decidedness tests name an
 * operand up to three times and inlining an effectful operand would run it
 * at every naming; `If(Random() > 0.5 ∧ x > 0, a, b)` therefore selected by
 * JavaScript truthiness and took the else arm at `x = NaN`. The lazy
 * lowering binds every leaf exactly once, so the exemption's reason no
 * longer holds: a `Random` draw inside the condition is drawn once per
 * call, or not at all when a decided sibling short-circuits it, and the
 * absence marker is answered at NaN.
 */

const ce = new ComputeEngine();

type Compiled = { code: string; run: (vars?: object) => unknown };

function js(expr: any): Compiled {
  const r = compile(ce.box(expr), { fallback: false, constantFold: false });
  expect(r?.success).toBe(true);
  return { code: String(r!.code), run: (vars = {}) => r!.run!(vars) };
}

const draws = (code: string): number =>
  (code.match(/drawNextRandomNumber/g) ?? []).length;

describe('an impure branch condition is lowered three-valued', () => {
  test('a lone impure relation: one draw per call, absence marker at NaN', () => {
    const c = js(['If', ['Greater', ['Random'], 'x'], 1, -1]);
    expect(draws(c.code)).toBe(1);
    expect(c.run({ x: NaN })).toBeNaN();
    expect(c.run({})).toBeNaN(); // an unsupplied `x`
    expect(c.run({ x: -1 })).toBe(1); // every draw is above -1
    expect(c.run({ x: 2 })).toBe(-1); // every draw is below 2
  });

  test('an impure connective: one draw, Kleene at NaN, short circuit kept', () => {
    // Every draw is below 2, so the first conjunct is decided `true` and the
    // `And` is decided by `x > 0` alone: undecided at NaN.
    const c = js([
      'If',
      ['And', ['Less', ['Random'], 2], ['Greater', 'x', 0]],
      1,
      -1,
    ]);
    expect(draws(c.code)).toBe(1);
    expect(c.run({ x: NaN })).toBeNaN();
    expect(c.run({ x: -1 })).toBe(-1);
    expect(c.run({ x: 1 })).toBe(1);
    // A draw that is decided `false` (never above 2) short-circuits the
    // `And` whatever `x` is, NaN included.
    const c0 = js([
      'If',
      ['And', ['Greater', ['Random'], 2], ['Greater', 'x', 0]],
      1,
      -1,
    ]);
    expect(c0.run({ x: NaN })).toBe(-1);
    // `And(undecided, false)` is `false`: the decided second conjunct wins.
    // The draw happens here although the plain `&&` would have stopped at
    // the first conjunct's ordinary `false` — the Kleene table needs it.
    const c2 = js([
      'If',
      ['And', ['Greater', 'x', 0], ['Greater', ['Random'], 2]],
      1,
      -1,
    ]);
    expect(c2.run({ x: NaN })).toBe(-1);
    // `And(undecided, true)` stays undecided.
    const c3 = js([
      'If',
      ['And', ['Greater', 'x', 0], ['Less', ['Random'], 2]],
      1,
      -1,
    ]);
    expect(c3.run({ x: NaN })).toBeNaN();
    // A decided-false first conjunct never reaches the draw.
    const c4 = js([
      'If',
      ['And', ['Greater', 'x', 0], ['Greater', ['Random'], 0.5]],
      1,
      -1,
    ]);
    expect(c4.run({ x: -1 })).toBe(-1);
  });

  test('Which and the statement form take the same lowering', () => {
    const w = js(['Which', ['Greater', ['Random'], 'x'], 1, 'True', -1]);
    expect(draws(w.code)).toBe(1);
    expect(w.run({ x: NaN })).toBeNaN();
    expect(w.run({ x: -1 })).toBe(1);
    const s = js([
      'Block',
      ['Assign', 'k', 0],
      [
        'If',
        ['Greater', ['Random'], 'x'],
        ['Assign', 'k', 1],
        ['Assign', 'k', 2],
      ],
      'k',
    ]);
    expect(draws(s.code)).toBe(1);
    // Neither branch runs on an undecided condition; the block continues.
    expect(s.run({ x: NaN })).toBe(0);
    expect(s.run({ x: -1 })).toBe(1);
    expect(s.run({ x: 2 })).toBe(2);
  });

  test('the shapes that keep the truthiness lowering', () => {
    // An impure CHAIN: the emitted `&&` of the chain skips the draw once the
    // first pair is false, which a binding up front would not.
    const chain = js(['If', ['Less', 5, 1, ['Random']], 1, -1]);
    expect(chain.code).not.toMatch(/_tv\d+ === _tv\d+/);
    expect(chain.run({})).toBe(-1);
    // One impure node in both positions: two draws were written, and a
    // binding keyed on the node would make one.
    const d = ce.box(['Random']);
    const same = ce.function('If', [
      ce.function('Less', [d, d]),
      ce.number(1),
      ce.number(-1),
    ]);
    const r = compile(same, { fallback: false, constantFold: false });
    expect(r?.success).toBe(true);
    expect(draws(String(r!.code))).toBe(2);
  });

  test('Python: no impure head lowers, so the condition fails closed', () => {
    // The Python lowering takes the same analysis, but no effectful operator
    // has a Python spelling today (`Random` declines), so an impure
    // condition never reaches it; the whole compile fails closed instead.
    expect(() =>
      compile(ce.box(['If', ['Greater', ['Random'], 'x'], 1, -1]), {
        to: 'python',
        fallback: false,
      } as any)
    ).toThrow(/Fail closed/);
  });

  test('a GPU target keeps its own selection', () => {
    // GLSL takes its `If` entry before the decidedness analysis, and a draw
    // there is the shader's own stream — unchanged by this ruling.
    const r = compile(ce.box(['If', ['Greater', ['Random'], 'x'], 1, -1]), {
      to: 'glsl',
      fallback: false,
    } as any);
    expect(r?.success).toBe(true);
    expect(String(r!.code)).toMatch(/\? \(1\.0\) : \(-1\.0\)/);
  });
});
