/**
 * Relaxing the fail-closed boolean-head compile guards (ROADMAP, "Revisit the
 * fail-closed boolean-head compile guards"; Tycho item 86).
 *
 * The compiled `<`/`<=`/`>`/`>=`/`And`/`Or`/`Not` handlers used to DECLINE
 * whenever an operand might be a collection at run time. The justification was
 * a real bug — a user-function application mis-compiled a collection argument
 * to NaN, and `NaN < 10` is an ordinary `false`, so the wrong answer stopped
 * looking wrong. That bug is fixed (the application site dispatches through
 * `_SYS.bcastFn`), so the guard's reach outlived its reason.
 *
 * The relaxation is admission, which is the dangerous direction: every case
 * below is therefore pinned against INTERPRETATION, and the shapes with no
 * faithful runtime dispatch keep declining (a tuple binds atomically; a
 * non-indexed collection has no positional lowering; chained `Equal` switches
 * shape on the runtime operand count).
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** Interpretation, projected the way a real (JavaScript) target represents it. */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing' || x.symbol === 'Undefined') return NaN;
    if (x.operator === 'Error') return NaN;
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.evaluate());
}

function parity(expr: BoxedExpression): unknown {
  const r = compile(expr, { fallback: false });
  expect(r?.success).toBe(true);
  const value = r!.run!();
  expect(value).toEqual(interpreted(expr));
  return value;
}

/** An engine with the open-typed helper consumers actually declare. */
function make(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('q', { signature: '(unknown) -> unknown' });
  ce.assign('q', ce.parse('t \\mapsto 2t+1'));
  ce.assign('L', ce.parse('[1, 2, 3]').evaluate());
  ce.assign('M', ce.parse('[9, 2, 9]').evaluate());
  return ce;
}

describe('orderings over an operand whose shape is only known at run time', () => {
  test('q(x) < y stays the scalar infix lowering (the look-through)', () => {
    const ce = make();
    const r = compile(ce.parse('q(2)<5'), { fallback: false })!;
    expect(r.code).not.toContain('_SYS.bcast');
    expect(r.run!()).toBe(false); // 2·2+1 = 5
  });

  test('q(L) < y is element-wise (the item-86 witness)', () => {
    const ce = make();
    const expr = ce.parse('q(L)<5');
    const r = compile(expr, { fallback: false })!;
    expect(r.code).toContain('_SYS.bcast');
    expect(r.run!()).toEqual([true, false, false]); // q(L) = [3, 5, 7]
    expect(r.run!()).toEqual(interpreted(expr));
  });

  test('q(L) < M zips two run-time arrays', () => {
    const ce = make();
    expect(parity(ce.parse('q(L)<M'))).toEqual([true, false, true]);
  });

  test('a length mismatch projects to NaN, never to a truncated zip', () => {
    const ce = make();
    ce.assign('K', ce.parse('[1, 2]').evaluate());
    const expr = ce.parse('q(L)<K');
    expect(parity(expr)).toEqual(NaN);
  });

  test('a CHAINED ordering conjoins per position', () => {
    const ce = make();
    ce.assign('xs', ce.parse('[1, 7, 3]').evaluate());
    const expr = ce.box(['Less', 0, 'xs', 5] as any);
    expect(parity(expr)).toEqual([true, false, true]);
  });

  test('a chained ordering evaluates each operand exactly once', () => {
    // Every operand is an ARGUMENT of the `_SYS.bcast` call, so the shared
    // middle operand cannot be emitted twice (what `bindExpr` protects on the
    // scalar chained path).
    const ce = make();
    // `constantFold: false`: `L` is an assigned literal list and `q` is pure,
    // so the whole chain would otherwise be evaluated at compile time and
    // emitted as a literal — leaving no `_fn_q` call to count.
    const source = compile(ce.box(['Less', 0, ['q', 'L'], 5] as any), {
      fallback: false,
      constantFold: false,
    })!.code!;
    expect(source.match(/_fn_q/g)?.length).toBe(1);
  });
});

describe('connectives over an operand whose shape is only known at run time', () => {
  test('And broadcasts and absorbs a dominant `false` per position', () => {
    const ce = make();
    const expr = ce.box([
      'And',
      ['Less', ['q', 'L'], 5],
      ['Less', ['q', 'L'], 4],
    ] as any);
    expect(parity(expr)).toEqual([true, false, false]);
  });

  test('Or broadcasts and absorbs a dominant `true` per position', () => {
    const ce = make();
    const expr = ce.box([
      'Or',
      ['Less', ['q', 'L'], 4],
      ['Greater', ['q', 'L'], 6],
    ] as any);
    expect(parity(expr)).toEqual([true, false, true]);
  });

  test('Not broadcasts', () => {
    const ce = make();
    const expr = ce.box(['Not', ['Less', ['q', 'L'], 5]] as any);
    expect(parity(expr)).toEqual([false, true, true]);
  });

  test('an absent position stays absent through a connective', () => {
    // `_SYS.bcast` renders a mismatched position as NaN; `guardConnectiveAbsence`
    // keeps `!`/`&&`/`||` from coercing it into a plain (and wrong) truth
    // value.
    const ce = make();
    ce.assign('K', ce.parse('[1, 2]').evaluate());
    expect(parity(ce.box(['Not', ['Less', ['q', 'L'], 'K']] as any))).toEqual(
      NaN
    );
  });
});

describe('the shapes that must keep failing closed', () => {
  test('a TUPLE operand — atomic, never a broadcast source', () => {
    const ce = make();
    ce.declare('p', 'tuple<real,real>');
    expect(compile(ce.parse('p < 3'))?.success).toBe(false);
    expect(compile(ce.box(['Less', ['Tuple', 1, 2], 3] as any))?.success).toBe(
      false
    );
  });

  test('a non-INDEXED collection has no positional lowering', () => {
    const ce = make();
    ce.declare('s', 'set<number>');
    expect(compile(ce.box(['Less', 's', 3] as any))?.success).toBe(false);
  });

  test('chained Equal keeps declining — no faithful runtime dispatch', () => {
    // The interpreter's n-ary `Equal` switches SHAPE on how many operands are
    // collections at run time: `Equal(L, 3, 3)` is element-wise, while
    // `Equal(L, L, 3)` is the SCALAR `False` (whole-collection equality). A
    // conjunction of pairwise `_SYS.eq` calls is a different value, so there
    // is nothing sound to relax to.
    const ce = make();
    expect(
      ce
        .box(['Equal', 'L', 3, 3] as any)
        .evaluate()
        .toString()
    ).toBe('["False","False","True"]');
    expect(
      ce
        .box(['Equal', 'L', 'L', 3] as any)
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(compile(ce.box(['Equal', 'L', 3, 3] as any))?.success).toBe(false);
  });

  test('the free-function compile() still converts the throw to a fallback', () => {
    const ce = make();
    const r = compile(ce.box(['Equal', 'L', 3, 3] as any));
    expect(r?.success).toBe(false);
    expect(typeof r?.run).toBe('function');
  });
});

describe('other targets are unaffected', () => {
  // The relaxation is JavaScript-only: it is a JS coercion hazard, lowered
  // onto a JS runtime helper. The non-shader targets keep their own lowering
  // (no `_SYS`).
  //
  // The Python row used to pin the infix `xs < 3`. That emission was itself
  // unfaithful — a plain-list binding raises `TypeError` and a tuple binding
  // compares lexicographically, where the interpreter broadcasts element-wise —
  // so a collection-TYPED ordering participant now diverts to the `np.less`
  // codegen on that target (see `pyOrderingUnfaithful` in base-compiler.ts and
  // `compile-python-string-fail-closed.test.ts`). Still no `_SYS`.
  //
  // `toContain`, not `toBe`: the Python ufunc goes through the `_ce_ord` shape
  // guard, whose definition is prepended to the emitted code.
  test.each([['python', '_ce_ord(np.less, xs, 3)']])(
    '%s keeps its own lowering',
    (to, expected) => {
      const ce = new ComputeEngine();
      ce.declare('xs', 'list<real>');
      const r = compile(ce.box(['Less', 'xs', 3] as any), { to } as any)!;
      expect(r.code).toContain(expected);
      expect(r.code).not.toContain('_SYS');
    }
  );

  // The interval-js row used to pin `_IA.less(_.xs, _IA.point(3))` — a
  // comparison over a JS array at run time, which answered `'maybe'` behind
  // `success: true` where the interpreter broadcasts. The interval kernels
  // now fail closed on a provably collection-valued operand (the interval
  // domain has no element-wise convention); the engine-level compile()
  // surfaces that as a fallback result. Still no `_SYS`.
  test('interval-js fails closed on a collection-valued comparison operand', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<real>');
    const r = compile(ce.box(['Less', 'xs', 3] as any), {
      to: 'interval-js',
    } as any)!;
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('is a collection');
    expect(r.code ?? '').not.toContain('_SYS');
  });

  // The GLSL row used to pin `xs < 3.0` — invalid shader source (`vec` vs
  // `float` has no infix `<`) reported behind `success: true`. The GPU
  // targets now fail closed on a comparison over a non-scalar operand
  // outside a `Which`/`If` selection condition (2026-07-28); the engine-level
  // compile() surfaces that as a fallback result.
  test('glsl fails closed instead of emitting invalid infix source', () => {
    const ce = new ComputeEngine();
    ce.declare('xs', 'list<real>');
    const r = compile(ce.box(['Less', 'xs', 3] as any), { to: 'glsl' } as any)!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/scalar-only/);
  });
});
