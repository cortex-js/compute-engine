import { ComputeEngine } from '../../src/compute-engine';

/**
 * An indexed big operator (`Sum`/`Product` over `Limits`/`Element`) binds its
 * index by ASSIGNMENT, so a body whose evaluation READS the index resolves on
 * its own. A body that a lazy operator holds and then declines does not: an
 * undecided `If`/`Which` returned `undefined`, the framework kept the ORIGINAL
 * node with the index symbol still in it, and every term of the loop was the
 * same expression. Measured 2026-08-16:
 *
 *   Σ_{k=1}^{3} Which(x < k, k, True, 0)   →  Which(x < k, 9, True, 0)
 *   Σ_{k=1}^{3} If(x < k, k, 0)            →  3·If(x < k, k, 0)
 *
 * — the bound `k` leaked into the result and the value was wrong (three copies
 * of one arm, `3k` re-evaluated at the last index value). The per-term step
 * (`evaluateBigOpTerm`, `library/utils.ts`) now substitutes the current index
 * values into a term that still mentions an index, binder-aware, mirroring the
 * repair `comprehensionStream` already applied to comprehension elements.
 */
describe('big operators — a term that keeps the loop index is repaired', () => {
  const ce = new ComputeEngine();

  test('Σ If(x < k, k, 0): one term per index value, no leaked `k`', () => {
    const r = ce
      .box(['Sum', ['If', ['Less', 'x', 'k'], 'k', 0], ['Limits', 'k', 1, 3]])
      .evaluate();
    expect(r.has('k')).toBe(false);
    expect(r.json).toEqual([
      'Add',
      ['If', ['Less', 'x', 1], 1, 0],
      ['If', ['Less', 'x', 2], 2, 0],
      ['If', ['Less', 'x', 3], 3, 0],
    ]);
    // …and it is a value: once `x` is known, the sum evaluates.
    expect(r.subs({ x: 2 }).evaluate().re).toBe(3);
  });

  test('Σ Which(x < k, k, True, 0) over Limits and over Element agree, and no `k` leaks', () => {
    const limits = ce
      .box([
        'Sum',
        ['Which', ['Less', 'x', 'k'], 'k', 'True', 0],
        ['Limits', 'k', 1, 3],
      ])
      .evaluate();
    const element = ce
      .box([
        'Sum',
        ['Which', ['Less', 'x', 'k'], 'k', 'True', 0],
        ['Element', 'k', ['List', 1, 2, 3]],
      ])
      .evaluate();
    expect(limits.has('k')).toBe(false);
    expect(element.has('k')).toBe(false);
    expect(limits.isSame(element)).toBe(true);
    // The value: at x = 1.5 the terms k = 2, 3 select → 5.
    expect(limits.subs({ x: 1.5 }).evaluate().re).toBe(5);
    expect(limits.subs({ x: 10 }).evaluate().re).toBe(0);
  });

  test('Π If(x < k, k, 1): same repair for Product', () => {
    const r = ce
      .box([
        'Product',
        ['If', ['Less', 'x', 'k'], 'k', 1],
        ['Element', 'k', ['List', 1, 2, 3]],
      ])
      .evaluate();
    expect(r.has('k')).toBe(false);
    expect(r.subs({ x: 1.5 }).evaluate().re).toBe(6);
  });

  test('the repair is binder-aware: an inner binder that reuses the index name keeps its own binding', () => {
    // The held arm `Σ_{k=1}^{2} k` binds its OWN `k` (= 3); only the FREE `k`
    // in the condition takes the loop value.
    const r = ce
      .box([
        'Sum',
        ['If', ['Less', 'x', 'k'], ['Sum', 'k', ['Limits', 'k', 1, 2]], 0],
        ['Limits', 'k', 1, 3],
      ])
      .evaluate();
    // The inner `Σ_{k}` keeps its bound `k` (so `has('k')` is legitimately
    // true); the values show the FREE `k` took 1, 2, 3.
    expect(r.subs({ x: 0 }).evaluate().re).toBe(9); // 3 + 3 + 3
    expect(r.subs({ x: 2 }).evaluate().re).toBe(3); // only k = 3 selects
    // A function literal in a held arm: `k` is free inside it and takes the
    // value; its own parameter `t` is untouched.
    const f = ce
      .box([
        'Sum',
        ['If', ['Less', 'x', 'k'], ['Function', ['Add', 'k', 't'], 't'], 0],
        ['Limits', 'k', 1, 2],
      ])
      .evaluate();
    expect(f.has('k')).toBe(false);
    expect(f.json).toEqual([
      'Add',
      [
        'If',
        ['Less', 'x', 1],
        ['Function', ['Block', ['Add', 't', 1]], 't'],
        0,
      ],
      [
        'If',
        ['Less', 'x', 2],
        ['Function', ['Block', ['Add', 't', 2]], 't'],
        0,
      ],
    ]);
  });

  test('a capture-hazard Element domain declines to symbolic, never a wrong value', () => {
    // The domain element for `k` is the EXPRESSION `t` (a free symbol —
    // declared `integer` so it is assignable to the integer-typed loop
    // index), and the held arm binds its own `t` (`t ↦ k + t`): substituting
    // `k → t` inside the literal would capture it. The repair declines and
    // the whole Sum stays symbolic — not NaN, and not a silently captured
    // body.
    const cec = new ComputeEngine();
    cec.declare('t', 'integer');
    const e = cec.box([
      'Sum',
      ['If', ['Less', 'x', 'k'], ['Function', ['Add', 'k', 't'], 't'], 0],
      ['Element', 'k', ['List', 't', 1]],
    ]);
    const r = e.evaluate();
    expect(r.operator).toBe('Sum');
    expect(r.isNaN).not.toBe(true);
  });

  test('the repair preserves a rebuilt scoped node and reaches dictionary values', () => {
    // A held arm containing an inner one-index Sum over a DIFFERENT name:
    // the rebuild goes through the scoped node, which must keep resolving
    // its own index (`m`) after the outer `k` is substituted next to it.
    const r = ce
      .box([
        'Sum',
        [
          'If',
          ['Less', 'x', 'k'],
          ['Add', 'k', ['Sum', 'm', ['Limits', 'm', 1, 2]]],
          0,
        ],
        ['Limits', 'k', 1, 2],
      ])
      .evaluate();
    expect(r.has('k')).toBe(false);
    expect(r.subs({ x: 0 }).evaluate().re).toBe(4 + 3 + 2); // (1+3)+(2+3)
    // A dictionary in a held arm: the index inside a VALUE slot is repaired
    // (`rewriteWithBinders` descends into dictionary values explicitly).
    const d = ce
      .box([
        'Sum',
        [
          'If',
          ['Less', 'x', 'k'],
          ['Dictionary', ['KeyValuePair', { str: 'v' }, 'k']],
          0,
        ],
        ['Limits', 'k', 1, 2],
      ])
      .evaluate();
    expect(d.has('k')).toBe(false);
  });

  test('controls: bodies that resolve the index on their own are unchanged', () => {
    expect(
      ce.box(['Sum', ['Multiply', 'x', 'k'], ['Limits', 'k', 1, 3]]).evaluate()
        .json
    ).toEqual(['Multiply', 6, 'x']);
    expect(
      ce.box(['Sum', ['f', 'k'], ['Limits', 'k', 1, 3]]).evaluate().json
    ).toEqual(['Add', ['f', 1], ['f', 2], ['f', 3]]);
    // A decidable condition never reaches the repair.
    expect(
      ce
        .box([
          'Sum',
          ['Which', ['Less', 'k', 2], 'k', 'True', 0],
          ['Limits', 'k', 1, 3],
        ])
        .evaluate().re
    ).toBe(1);
  });
});
