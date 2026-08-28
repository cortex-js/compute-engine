import { ComputeEngine } from '../../src/compute-engine';

/**
 * Since the Tycho item-193 round (2026-08-15) a comparison whose broadcast
 * outcome cannot be settled statically — `h(x) = 10` with `h` undeclared —
 * types `broadcastable<boolean>` (the union `boolean |
 * indexed_collection<boolean>`). That type is a subtype of NEITHER `boolean`
 * nor `indexed_collection<boolean | missing>`, so the evaluate-side condition
 * gates that tested those two — `isBooleanishCondition` behind `If`/`Which`,
 * and the mask-cell gate of `When` — no longer recognized such a condition:
 * `Which(h(x) = 10, 1, True, 0)` THREW the "Condition must evaluate to True
 * or False" spell-check error out of `evaluate()`, where before the round it
 * was held as an ordinary undecided condition, and `x{h(x) ≤ [1,2,3]}` stayed
 * un-broadcast. Measured 2026-08-16 while running down the `unknown`-symbol
 * comparison entry in `ROADMAP.md`. Both gates now admit the type through the
 * same predicate the `If`/`Which` TYPE handlers already use
 * (`possiblyElementwiseCondition`).
 *
 * The second half pins the lazy-operator rule for `If`/`Which`: an undecided
 * condition is returned EVALUATED (arms untouched), not discarded. A lazy
 * handler that returns `undefined` hands the framework the original node, so
 * `Which(C = U[1], …)` used to keep `U[1]` where its condition had already
 * read `10`.
 */
describe('an undecided `broadcastable<boolean>` condition is held, not an error', () => {
  const ce = new ComputeEngine();
  ce.assign('U', ce.box(['List', 10, 20, 30]));

  test('Which/If over a comparison with an undeclared function stay inert', () => {
    for (const j of [
      ['Which', ['Equal', ['h', 'x'], 10], 1, 'True', 0],
      ['If', ['Equal', ['h', 'x'], 10], 1, 0],
      ['Which', ['Less', ['h', 'x'], 10], 1, 'True', 0],
    ] as const) {
      const e = ce.box(j as never);
      // The type handlers already answered for this shape…
      expect(e.type.toString()).toBe('broadcastable<integer>');
      // …and evaluate() must hold it rather than throw.
      const r = e.evaluate();
      expect(r.operator).toBe(j[0]);
      // Fixpoint: evaluating the held node again is a no-op.
      expect(r.evaluate().isSame(r)).toBe(true);
    }
  });

  test('When over a mask whose cells are such comparisons broadcasts into held Whens', () => {
    const r = ce
      .box(['When', 'x', ['LessEqual', ['h', 'x'], ['List', 1, 2, 3]]])
      .evaluate();
    expect(r.json).toEqual([
      'List',
      ['When', 'x', ['LessEqual', ['h', 'x'], 1]],
      ['When', 'x', ['LessEqual', ['h', 'x'], 2]],
      ['When', 'x', ['LessEqual', ['h', 'x'], 3]],
    ]);
  });
});

describe('If/Which return an undecided condition EVALUATED, arms untouched', () => {
  const ce = new ComputeEngine();
  ce.assign('U', ce.box(['List', 10, 20, 30]));

  test('the condition is evaluated in place, the held arms are not', () => {
    const w = ce
      .box(['Which', ['Equal', 'C', ['At', 'U', 1]], ['At', 'U', 2], 'True', 0])
      .evaluate();
    expect(w.json).toEqual([
      'Which',
      ['Equal', 'C', 10],
      ['At', 'U', 2], // held: an arm is not evaluated until selected
      'True',
      0,
    ]);
    const i = ce.box(['If', ['Equal', 'C', ['At', 'U', 1]], 1, 0]).evaluate();
    expect(i.json).toEqual(['If', ['Equal', 'C', 10], 1, 0]);
  });

  test('fixpoint: a condition that evaluates to itself leaves the node unchanged', () => {
    const w = ce.box(['Which', ['Equal', 'x', 4], 1, 'True', 0]);
    const r = w.evaluate();
    expect(r.isSame(w)).toBe(true);
    expect(r.evaluate().isSame(r)).toBe(true);
    const i = ce.box(['If', ['Less', 'x', 4], 1, 0]);
    expect(i.evaluate().isSame(i)).toBe(true);
  });

  test('a decided condition still selects (controls)', () => {
    expect(
      ce.box(['Which', ['Equal', ['At', 'U', 1], 10], 1, 'True', 0]).evaluate()
        .re
    ).toBe(1);
    expect(
      ce.box(['If', ['Equal', ['At', 'U', 1], 11], 1, 0]).evaluate().re
    ).toBe(0);
  });
});
