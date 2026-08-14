/**
 * COMPILED element-wise `Sum`/`Product` over a collection-valued body
 * (JavaScript target).
 *
 * The interpreter's indexed big op zip-broadcasts a collection body
 * (`Σ_k (L + k)` over a 3-list is a 3-list); the compiled form used to fail
 * closed unconditionally (`assertScalarBigOpBody`, Tycho item 45). The JS
 * target now folds the body through `_SYS.bcast` — scalar-at-runtime bodies
 * stay scalar, cells zip position-wise, a length mismatch projects to NaN,
 * and an empty range answers the scalar identity (0 / 1), all matching the
 * interpreter. A BARE collection body never reaches the indexed form (it
 * canonicalizes to `Reduce`); tuple-shaped and complex bodies keep the
 * fail-closed assert, as do the GPU and interval-js targets.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.assign('L', ce.box(['List', 1, 2, 3]));
ce.declare('M', 'list<number>');
ce.declare('n', 'integer');

/** Interpretation, projected the way the JavaScript target represents it. */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.N());
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: BoxedExpression): unknown {
  const r = compile(expr, { fallback: false });
  expect(r?.success).toBe(true);
  const value = r!.run!({});
  expect(value).toEqual(interpreted(expr));
  return value;
}

describe('element-wise Sum/Product: interpreter parity', () => {
  test('a k-independent collection body accumulates element-wise', () => {
    expect(
      parity(ce.box(['Sum', ['Multiply', 2, 'L'], ['Limits', 'k', 1, 3]]))
    ).toEqual([6, 12, 18]);
  });

  test('a k-dependent collection body zips per iteration', () => {
    expect(
      parity(ce.box(['Sum', ['Add', 'L', 'k'], ['Limits', 'k', 1, 3]]))
    ).toEqual([9, 12, 15]);
  });

  test('Product folds element-wise', () => {
    expect(
      parity(ce.box(['Product', ['Add', 'L', 'k'], ['Limits', 'k', 1, 2]]))
    ).toEqual([6, 12, 20]);
  });

  test('an empty constant range answers the scalar identity', () => {
    expect(
      parity(ce.box(['Sum', ['Multiply', 2, 'L'], ['Limits', 'k', 1, 0]]))
    ).toBe(0);
    expect(
      parity(ce.box(['Product', ['Multiply', 2, 'L'], ['Limits', 'k', 1, 0]]))
    ).toBe(1);
  });

  test('a multi-index Sum folds element-wise at every clause level', () => {
    expect(
      parity(
        ce.box([
          'Sum',
          ['Add', 'L', ['Multiply', 'j', 'k']],
          ['Limits', 'j', 1, 2],
          ['Limits', 'k', 1, 3],
        ])
      )
    ).toEqual([24, 30, 36]);
  });

  test('At distributes through the compiled element-wise Sum', () => {
    expect(
      parity(ce.box(['At', ['Sum', ['Add', 'L', 'k'], ['Limits', 'k', 1, 3]], 2]))
    ).toBe(12);
  });
});

describe('element-wise Sum/Product: runtime dispatch', () => {
  const r = compile(
    ce.box(['Sum', ['Add', 'M', 'k'], ['Limits', 'k', 1, 'n']]),
    { fallback: false }
  )!;

  test('a free list-typed body with runtime bounds', () => {
    expect(r.run!({ M: [10, 20], n: 2 })).toEqual([23, 43]);
  });

  test('a runtime-empty range answers the identity', () => {
    expect(r.run!({ M: [10, 20], n: 0 })).toBe(0);
  });

  test('a scalar-at-runtime body stays scalar', () => {
    // (5+1) + (5+2)
    expect(r.run!({ M: 5, n: 2 })).toBe(13);
  });

  test('the seed does not alias the caller-supplied array', () => {
    const M = [10, 20];
    const out = r.run!({ M, n: 1 }) as number[];
    expect(out).toEqual([11, 21]);
    out[0] = 999;
    expect(M[0]).toBe(10);
  });
});

describe('element-wise Sum/Product: review-round fixes (2026-07-28)', () => {
  test('a broadcastable<T>-typed body folds element-wise instead of string-concatenating', () => {
    // `2·b` types `broadcastable<number>`, which matched NEITHER the
    // element-wise gate NOR the fail-closed assert — the bare scalar loop
    // then emitted `acc += <array>`, a silent string concatenation.
    const e = new ComputeEngine();
    e.declare('b', 'broadcastable<number>');
    const r = compile(
      e.box(['Sum', ['Multiply', 2, 'b'], ['Limits', 'k', 1, 3]]),
      { fallback: false }
    )!;
    expect(r.success).toBe(true);
    expect(r.run!({ b: [10, 20] })).toEqual([60, 120]);
    // The fold dispatches on runtime shape: a scalar binding stays scalar.
    expect(r.run!({ b: 5 })).toBe(30);
  });

  test('a mid-loop length mismatch latches to a stable scalar NaN', () => {
    // Alternating-length terms used to answer scalar NaN or an array of NaNs
    // depending on which shape came LAST; the latch pins the scalar
    // projection (same as `_SYS.select` on a mismatch), both orders.
    const e = new ComputeEngine();
    e.declare('A2', 'list<number>');
    e.declare('B3', 'list<number>');
    const r = compile(
      e.box([
        'Sum',
        ['If', ['Equal', ['Mod', 'k', 2], 0], 'A2', 'B3'],
        ['Limits', 'k', 1, 3],
      ]),
      { fallback: false }
    )!;
    expect(r.run!({ A2: [1, 2], B3: [1, 2, 3] })).toBe(NaN);
    expect(r.run!({ A2: [1, 2, 3], B3: [1, 2] })).toBe(NaN);
  });
});

describe('element-wise Sum/Product: unchanged behavior elsewhere', () => {
  test('scalar bodies keep the scalar loop/unroll emission', () => {
    const r = compile(ce.box(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 4]]), {
      fallback: false,
    })!;
    expect(r.run!({})).toBe(30);
    expect(r.code).not.toContain('_SYS.bcast');
  });

  test('the GPU target keeps the fail-closed decline', () => {
    expect(() =>
      new GLSLTarget().compile(
        ce.box(['Sum', ['Multiply', 2, 'L'], ['Limits', 'k', 1, 3]]),
        // `constantFold: false`: `L` is an assigned literal list, so the whole
        // sum would otherwise be evaluated at compile time and emitted as a
        // shader vector literal, bypassing the decline under test.
        { constantFold: false }
      )
    ).toThrow(/collection-valued body does not compile/);
  });

  test('the interval-js target keeps the fail-closed decline', () => {
    const r = compile(
      ce.box(['Sum', ['Multiply', 2, 'L'], ['Limits', 'k', 1, 3]]),
      { to: 'interval-js' } as any
    )!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/collection-valued body does not compile/);
  });
});
