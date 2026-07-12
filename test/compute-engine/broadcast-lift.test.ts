import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Broadcast typing lift — Phase 1 (validator gap fix).
 * See docs/plans/2026-07-11-broadcast-typing-lift-design.md.
 *
 * A broadcastable operator that canonicalizes through the *general*
 * `validateArguments` path (i.e. NOT a numeric fastpath op — `Mod`, `Sin`,
 * `Abs`, `Gcd`, …) must accept a symbolic-length numeric collection operand
 * (e.g. `Range(0, 3N)` with symbolic `N`) where a scalar is expected, exactly
 * as the numeric fastpath (`checkNumericArgs`) already does. Before the fix,
 * `typeCouldBeCollection` omitted the parametrized `indexed_collection<…>`
 * object kind, so such operands were rejected with an `incompatible-type`
 * `Error` node planted at canonicalization — unrecoverable, since an invalid
 * tree never reaches the evaluator.
 *
 * Phase 1 is an *acceptance* fix: validation admits on the strength of the
 * element type; the value path broadcasts once the collection materializes.
 * For a symbolic-length range the declared type stays scalar until the bound
 * resolves to a literal (the two-tier arrangement, design note §1.4/§2.3);
 * reconciling that declared type is Phase 2 and out of scope here.
 */

/** Element-wise reference: apply `op` to each element of `xs`. */
function mapValues(
  ce: ComputeEngine,
  op: string,
  xs: number[],
  rest: BoxedExpression[] = []
): unknown {
  return ce
    .box([
      'List',
      ...xs.map((x) => ce.box([op, x, ...rest.map((r) => r.json)] as any)),
    ])
    .evaluate().json;
}

describe('BROADCAST LIFT Phase 1 — symbolic-length collection accepted where scalar expected', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('N', 'integer');
    ce.assign('N', ce.box(5));
    ce.declare('k', 'integer');
    ce.assign('k', ce.box(3));
  });

  test('census kfmt6lkiwt/1 — Mod([0,…,kN],N)/N validates and broadcasts', () => {
    const e = ce.parse(
      '\\operatorname{mod}\\left(\\left[0,\\ldots,kN\\right],N\\right)/N',
      { strict: false }
    );
    expect(e.isValid).toBe(true);
    // kN = 15 → Range(0,15): mod each by 5, divide by 5.
    const evaluated = e.evaluate();
    expect(evaluated.operator).toBe('List');
    expect(evaluated.nops).toBe(16);
    // Element-wise reference.
    const expected: unknown[] = [];
    for (let i = 0; i <= 15; i++) {
      const m = i % 5;
      expected.push(m === 0 ? 0 : ['Rational', m, 5]);
    }
    expect(JSON.stringify(evaluated.json)).toBe(
      JSON.stringify(['List', ...expected])
    );
  });

  test('Mod(Range(0,3N),N) — symbolic-expression bound: valid, value == element-wise Map', () => {
    const e = ce.box(['Mod', ['Range', 0, ['Multiply', 3, 'N']], 'N']);
    expect(e.isValid).toBe(true);
    const xs = Array.from({ length: 16 }, (_, i) => i); // 0..15
    expect(JSON.stringify(e.evaluate().json)).toBe(
      JSON.stringify(mapValues(ce, 'Mod', xs, [ce.box(5)]))
    );
  });

  test('Sin over symbolic range: valid, value == element-wise Map, exact stays symbolic', () => {
    const e = ce.box(['Sin', ['Range', 0, 'N']]);
    expect(e.isValid).toBe(true);
    const xs = [0, 1, 2, 3, 4, 5];
    expect(JSON.stringify(e.evaluate().json)).toBe(
      JSON.stringify(mapValues(ce, 'Sin', xs))
    );
    // .N() numericizes each element (exactness stable under approximation).
    const n = e.N();
    expect(n.operator).toBe('List');
    expect(n.nops).toBe(6);
  });

  test('Abs over symbolic range: valid, value == element-wise Map', () => {
    const e = ce.box(['Abs', ['Range', ['Negate', 'N'], 'N']]);
    expect(e.isValid).toBe(true);
    const xs = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
    expect(JSON.stringify(e.evaluate().json)).toBe(
      JSON.stringify(mapValues(ce, 'Abs', xs))
    );
  });
});

describe('BROADCAST LIFT Phase 1 — declared type is honest where the wrapper fires', () => {
  const ce = new ComputeEngine();

  /** For finite (materialized) collections the declared type is a list and
   * the evaluated type never disagrees (expr.type ⊇ expr.evaluate().type). */
  function expectHonestBroadcast(expr: BoxedExpression): void {
    expect(expr.isValid).toBe(true);
    expect(expr.type.matches('list<any>')).toBe(true);
    expect(expr.type.matches('number')).toBe(false);
    expect(expr.evaluate().type.matches(expr.type.type)).toBe(true);
  }

  test.each([
    ['Mod([0,…,9],N)', '\\operatorname{mod}\\left(\\left[0,\\ldots,9\\right],5\\right)'],
  ])('%s', (_label, latex) => {
    expectHonestBroadcast(ce.parse(latex, { strict: false }));
  });

  test.each([
    ['Sin(Range(0,4))', ['Sin', ['Range', 0, 4]] as any],
    ['Mod(Range(0,9),5)', ['Mod', ['Range', 0, 9], 5] as any],
    ['Cos(List)', ['Cos', ['List', 0, 1, 2]] as any],
  ])('%s', (_label, mj) => {
    expectHonestBroadcast(ce.box(mj));
  });
});

describe('BROADCAST LIFT Phase 1 — eager forms unchanged', () => {
  const ce = new ComputeEngine();

  test('Mod([0,1,2,3,4],2) → [0,1,0,1,0]', () => {
    const e = ce.box(['Mod', ['List', 0, 1, 2, 3, 4], 2]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('list<number>');
    expect(JSON.stringify(e.evaluate().json)).toBe(
      JSON.stringify(['List', 0, 1, 0, 1, 0])
    );
  });
});

describe('BROADCAST LIFT Phase 1 — boundaries not crossed', () => {
  const ce = new ComputeEngine();

  test('Boole of a boolean list still rejects (no boolean→number lift)', () => {
    const e = ce.box(['Boole', ['List', true, false, true]]);
    expect(e.isValid).toBe(false);
  });

  test('scalar where a collection is required still rejects (Determinant(5))', () => {
    const e = ce.box(['Determinant', 5]);
    expect(e.isValid).toBe(false);
  });
});
