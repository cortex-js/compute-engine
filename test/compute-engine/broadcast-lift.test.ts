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

// §D6.1 shape-aware lift: shape-known operands now yield dimensioned static types.
describe('BROADCAST LIFT Phase 1 — eager forms unchanged', () => {
  const ce = new ComputeEngine();

  test('Mod([0,1,2,3,4],2) → [0,1,0,1,0]', () => {
    const e = ce.box(['Mod', ['List', 0, 1, 2, 3, 4], 2]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('vector<5>');
    expect(JSON.stringify(e.evaluate().json)).toBe(
      JSON.stringify(['List', 0, 1, 0, 1, 0])
    );
  });
});

describe('BROADCAST LIFT Phase 2 — declared type agrees with the broadcast value', () => {
  // R := Range(-2,2) = [-2,-1,0,1,2]; L := [1,2,3]; N declared integer.
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('N', 'integer');
    ce.assign('R', ce.box(['Range', -2, 2]));
    ce.assign('L', ce.box(['List', 1, 2, 3]));
  });

  /** The declared type is an unbounded list (no scalar/union artifact), and the
   * evaluated type is a subtype of it (`expr.type ⊇ expr.evaluate().type`). */
  function expectListTyped(expr: BoxedExpression): void {
    expect(expr.isValid).toBe(true);
    expect(expr.type.matches('list<any>')).toBe(true);
    expect(expr.type.matches('number')).toBe(false);
    // No `scalar | list<…>` union at the top level.
    expect(expr.type.toString()).not.toContain('|');
    expect(expr.evaluate().type.matches(expr.type.type)).toBe(true);
  }

  describe('Add/Multiply post-eval fold — no scalar|list union', () => {
    test.each([
      ['R^2-2', ['Subtract', ['Power', 'R', 2], 2], ['List', 2, -1, -2, -1, 2]],
      ['1-L', ['Subtract', 1, 'L'], ['List', 0, -1, -2]],
      ['L^2-2', ['Subtract', ['Power', 'L', 2], 2], ['List', -1, 2, 7]],
    ])('%s → list<…>, value matches', (_label, mj, expected) => {
      const e = ce.box(mj as any);
      expectListTyped(e);
      expect(JSON.stringify(e.evaluate().json)).toBe(JSON.stringify(expected));
      // Exactness stable under .N(): the value stays an element-wise collection
      // (a list/vector), never collapsing to a scalar.
      expect(e.N().type.matches('list<any>')).toBe(true);
    });

    test('R·(2,3) → list<tuple<…>> (range × point), value matches', () => {
      const e = ce.box(['Multiply', 'R', ['Tuple', 2, 3]]);
      expectListTyped(e);
      expect(e.type.matches('list<tuple<number, number>>')).toBe(true);
      const evaluated = e.evaluate();
      expect(evaluated.operator).toBe('List');
      expect(evaluated.nops).toBe(5);
      expect(JSON.stringify(evaluated.json)).toBe(
        JSON.stringify([
          'List',
          ['Tuple', -4, -6],
          ['Tuple', -2, -3],
          ['Tuple', 0, 0],
          ['Tuple', 2, 3],
          ['Tuple', 4, 6],
        ])
      );
    });
  });

  describe('symbolic-length shape — declared list<…> before the bound resolves', () => {
    // `Mod(Range(0,3N),N)` / `Remainder(Range(0,3N),N)`: valid since Phase 1,
    // now declared `list<…>` even while N is symbolic (declared, unassigned).
    // While N is unresolved the value lazifies to an element-wise `Map`
    // (uniform with Add/Sin over a symbolic-length Range) instead of staying
    // inert. The lazy Map's computed type is `indexed_collection<…>`, wider
    // than the declared `list<…>` — the same precision gap the Add path has
    // always had. Narrowing the lazy-Map type to honor the declared type is
    // the Phase-2 declared-type reconciliation follow-up; these pins assert
    // the declared type and the lazy value form, not evaluated-type subtyping.
    test.each([
      ['Mod', ['Mod', ['Range', 0, ['Multiply', 3, 'N']], 'N']],
      ['Remainder', ['Remainder', ['Range', 0, ['Multiply', 3, 'N']], 'N']],
    ])('%s(Range(0,3N),N) declares list<…>, lazifies to Map', (_label, mj) => {
      const expr = ce.box(mj as any);
      expect(expr.isValid).toBe(true);
      expect(expr.type.matches('list<any>')).toBe(true);
      expect(expr.type.matches('number')).toBe(false);
      // No `scalar | list<…>` union at the top level.
      expect(expr.type.toString()).not.toContain('|');
      expect(expr.evaluate().operator).toBe('Map');
    });

    test('Mod value broadcasts once N resolves == element-wise Map', () => {
      ce.assign('N', ce.box(5));
      const e = ce.box(['Mod', ['Range', 0, ['Multiply', 3, 'N']], 'N']);
      const xs = Array.from({ length: 16 }, (_, i) => i); // 0..15
      expect(JSON.stringify(e.evaluate().json)).toBe(
        JSON.stringify(mapValues(ce, 'Mod', xs, [ce.box(5)]))
      );
    });
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

describe('BROADCAST LIFT — broadcastable operand admitted by non-threadable params', () => {
  const ce = new ComputeEngine();

  // Fungrim b9c36d: `e_(k)` is an application of an unknown symbol, so
  // `Power(NthPrime(k), e_(k))` lifts to `broadcastable<number>`. A
  // non-threadable `number` parameter (`Totient`) must still admit it — the
  // operand COULD be a plain scalar at runtime, and before the lift the same
  // expression typed plain `number` and was admitted.
  test('Totient(NthPrime(k)^e_(k)) validates (Fungrim b9c36d)', () => {
    const e = ce.box([
      'Totient',
      ['Power', ['NthPrime', 'k'], ['e_', 'k']],
    ] as any);
    expect(e.type.toString()).not.toBe('error');
    expect(e.isValid).toBe(true);
  });

  test('full b9c36d formula boxes valid', () => {
    const formula = [
      'Equal',
      [
        'Totient',
        [
          'Product',
          ['Power', ['NthPrime', 'k'], ['e_', 'k']],
          ['Limits', 'k', 1, 'm'],
        ],
      ],
      [
        'Product',
        ['Totient', ['Power', ['NthPrime', 'k'], ['e_', 'k']]],
        ['Limits', 'k', 1, 'm'],
      ],
    ];
    expect(ce.box(formula as any).isValid).toBe(true);
  });

  test('mismatched scalar base still rejects (Totient of a string)', () => {
    expect(ce.box(['Totient', { str: 'hello' }] as any).isValid).toBe(false);
  });
});
