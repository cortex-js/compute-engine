/**
 * Compiled comparisons and logical connectives over a COLLECTION-valued
 * operand: the compiler must REFUSE, never answer wrongly (D6).
 *
 * These heads lower to raw JavaScript infix operators (`<`, `&&`, `!`), which
 * are silently wrong on an array:
 *
 *   - `0 < [1, 0, 1]` stringifies the array (`0 < "1,0,1"`) → scalar `false`;
 *   - a JS array is TRUTHY, so `m1 && m2` returns a whole operand and `!m`
 *     returns `false`.
 *
 * The interpreter broadcasts element-wise in every one of those cases, so each
 * was a wrong answer behind a `success: true`. The guard that should have
 * caught it tested `.isCollection`, which is `false` for a COMPUTED
 * `list<real>` such as `|L - k|` — which is exactly why it went unnoticed. The
 * base compiler now declines the infix path on the declared type instead, and
 * the JavaScript handlers fail closed, so the engine falls back to the
 * interpreter and the result is correct.
 *
 * The witness that motivated this: the Desmos filter form `L[|[1...n]-k|>0]`
 * compiled to `NaN` instead of the interpreted `[10, 30]`, because its mask
 * collapsed to a scalar `false` before `_SYS.at` ever saw it.
 *
 * An element-wise *compiled* lowering was implemented and withdrawn — see
 * ROADMAP.md, "Element-wise compiled comparisons". Faithful broadcasting needs
 * per-POSITION projection (an empty or complex position must not poison its
 * siblings), correct shortest-length truncation, and a purity rule that tells a
 * repeated scalar from the collection being traversed. Until that exists,
 * refusing is the correct behavior, and these tests pin the refusal so a future
 * attempt cannot quietly reintroduce a wrong answer.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('k', ce.box(2 as any));

/** Interpretation, projected the way a real target represents it. */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.evaluate());
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: BoxedExpression): unknown {
  const r = compile(expr);
  expect(r?.success).toBe(true);
  const compiled = r!.run!();
  expect(compiled).toEqual(interpreted(expr));
  return compiled;
}

/** `[True, False, True]` — a mask that is only an array at RUN time. */
const m1 = () => ce.parse('|[1...3]-k|>0');
/** `[False, True, True]` — a second, differently-shaped mask. */
const m2 = () => ce.parse('[1...3]>1');

describe('a computed collection operand makes these heads fail closed', () => {
  // Each of these interprets to a element-wise boolean list. Before the fix the
  // compiled form returned a silently wrong scalar; now it refuses.
  test('an ordering over a computed collection', () => {
    expect(compile(m1())?.success).toBe(false);
    expect(compile(m2())?.success).toBe(false);
  });

  test('the connectives over computed collections', () => {
    expect(compile(ce.box(['And', m1(), m2()] as any))?.success).toBe(false);
    expect(compile(ce.box(['Or', m1(), m2()] as any))?.success).toBe(false);
    expect(compile(ce.box(['Not', m1()] as any))?.success).toBe(false);
  });

  test('a declared collection-typed operand', () => {
    const engine = new ComputeEngine();
    engine.declare('xs', 'list<real>');
    expect(compile(engine.box(['Less', 0, 'xs'] as any))?.success).toBe(false);
  });

  test('refusing means the interpreter still answers correctly', () => {
    // The point of failing closed: `evaluate()` is unaffected and correct.
    expect(interpreted(m1())).toEqual([true, false, true]);
    expect(interpreted(ce.box(['And', m1(), m2()] as any))).toEqual([
      false,
      false,
      true,
    ]);
  });
});

describe('a CONCRETE list still compiles through the unary map broadcast', () => {
  // `BaseCompiler` emits `([true, false]).map((x) => !x)` for a unary
  // broadcastable head over a concrete finite collection. That lowering is
  // correct and must not be swept up by the refusal — the handler is reached
  // from INSIDE the map callback, where the element is a scalar.
  test('Not over a literal boolean list', () => {
    expect(parity(ce.box(['Not', ['List', 'True', 'False']] as any))).toEqual([
      false,
      true,
    ]);
    expect(
      parity(ce.box(['Not', ['List', 'True', 'True', 'False']] as any))
    ).toEqual([false, false, true]);
  });
});

describe('the scalar paths are unchanged', () => {
  test('orderings', () => {
    expect(parity(ce.parse('2 < 3'))).toBe(true);
    expect(parity(ce.parse('3 \\le 3'))).toBe(true);
    expect(parity(ce.parse('2 > 3'))).toBe(false);
    // Chained scalar comparisons still conjoin pairwise.
    expect(parity(ce.parse('1 < 2 < 3'))).toBe(true);
  });

  test('connectives', () => {
    expect(parity(ce.box(['And', 'True', 'False'] as any))).toBe(false);
    expect(parity(ce.box(['Or', 'True', 'False'] as any))).toBe(true);
    expect(parity(ce.box(['Not', 'True'] as any))).toBe(false);
    expect(parity(ce.box(['And', ['Less', 2, 3], ['Less', 3, 4]] as any))).toBe(
      true
    );
  });
});

describe('other targets keep their existing lowering', () => {
  // The divert is JavaScript-only: it exists to avoid a JS coercion rule and
  // routes to a JS-specific handler. Python is untouched.
  const engine = new ComputeEngine();

  test('Python still lowers a collection comparison as before', () => {
    const r = compile(engine.box(['Less', ['List', 1, 2], 2] as any), {
      to: 'python',
    });
    expect(r?.success).toBe(true);
    expect(r!.code).toMatch(/np\.less/);
  });

  test('Python equality keeps its tolerance-aware lowering', () => {
    const r = compile(engine.box(['Equal', ['List', 1, 2], 2] as any), {
      to: 'python',
    });
    expect(r?.success).toBe(true);
    expect(r!.code).not.toMatch(/np\./);
  });
});
