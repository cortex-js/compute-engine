import { ComputeEngine } from '../../src/compute-engine';

/**
 * WP-2.12 regression tests.
 *
 * Covers three canonicalization / scope-cache P0s:
 *  - P0-25 (CORRECTNESS): exact-integer overflow folded to NaN in
 *    `numerics/rationals.ts` `mul()`/`add()`.
 *  - P0-26 (CORRECTNESS): the canonical sort commuted symbolic matrix
 *    products (`arithmetic-mul-div.ts` `isTensorOperand`).
 *  - SYMBOLIC P0-7: a stale `sgn`/`type` cache survived `popScope()`
 *    (`engine-scope.ts` `popEvalContext`).
 */

describe('WP-2.12: P0-25 exact-integer overflow folds to exact BigInt (not NaN)', () => {
  test('Multiply(1e200, x, 1e200) canonicalizes without NaN', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Multiply', 1e200, 'x', 1e200]);
    expect(e.toString().includes('NaN')).toBe(false);
  });

  test('Multiply(1e200, 1e200).evaluate() is the exact integer product', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Multiply', 1e200, 1e200]).evaluate();
    // 1e200 boxes as the exact integer value of the double, so the product is
    // the exact BigInt product of those two doubles (consistent with the Add
    // path). It must be an exact integer, not NaN.
    expect(p.isNaN).toBe(false);
    expect(p.isInteger).toBe(true);
    expect(p.isSame(ce.number(BigInt(1e200) * BigInt(1e200)))).toBe(true);
  });

  test('Multiply(1e308, x, 1e308).N() is not NaN', () => {
    const ce = new ComputeEngine();
    const n = ce.box(['Multiply', 1e308, 'x', 1e308]).N();
    expect(n.toString().includes('NaN')).toBe(false);
  });

  test('Terms coefficient reduce: Add(1.7e308 x, 1.7e308 x) exact under both evaluate and N', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Add',
      ['Multiply', 1.7e308, 'x'],
      ['Multiply', 1.7e308, 'x'],
    ]);
    const coef = ce.number(BigInt(1.7e308) * 2n);
    const expected = ce.box(['Multiply', coef, 'x']);
    expect(e.evaluate().isSame(expected)).toBe(true);
    expect(e.N().isSame(expected)).toBe(true);
  });

  test('Add path still folds large integer doubles to exact BigInt', () => {
    const ce = new ComputeEngine();
    const a = ce.box(['Add', 1e200, 1e200]).evaluate();
    expect(a.isNaN).toBe(false);
    expect(a.isSame(ce.number(BigInt(1e200) + BigInt(1e200)))).toBe(true);
  });

  test('Non-finite inputs still propagate (guard preserved)', () => {
    const ce = new ComputeEngine();
    // 0 * ∞ stays indeterminate (NaN), not silently promoted.
    const e = ce.box(['Multiply', 0, 'PositiveInfinity']).evaluate();
    expect(e.isNaN).toBe(true);
  });
});

describe('WP-2.12: P0-26 non-commutative matrix products preserve written order', () => {
  function freshMatrixEngine() {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix');
    ce.declare('P', 'matrix');
    ce.declare('v1', 'vector');
    ce.declare('v2', 'vector');
    ce.declare('a', 'number');
    ce.declare('b', 'number');
    return ce;
  }

  test('M·P and P·M are structurally distinct (canonical stored order)', () => {
    const ce = freshMatrixEngine();
    const mp = ce.box(['Multiply', 'M', 'P']);
    const pm = ce.box(['Multiply', 'P', 'M']);
    expect(mp.isSame(pm)).toBe(false);
    expect(mp.ops!.map((o) => o.symbol)).toEqual(['M', 'P']);
    expect(pm.ops!.map((o) => o.symbol)).toEqual(['P', 'M']);
  });

  test('order is preserved through evaluate()', () => {
    const ce = freshMatrixEngine();
    const mp = ce.box(['Multiply', 'M', 'P']).evaluate();
    const pm = ce.box(['Multiply', 'P', 'M']).evaluate();
    expect(mp.isSame(pm)).toBe(false);
    expect(pm.ops!.map((o) => o.symbol)).toEqual(['P', 'M']);
  });

  test('mixed symbolic·concrete matrix products preserve order', () => {
    const ce = freshMatrixEngine();
    const conc = ce.box(['List', ['List', 1, 2], ['List', 3, 4]]);
    const a = ce.box(['Multiply', 'M', conc]);
    const b = ce.box(['Multiply', conc, 'M']);
    expect(a.isSame(b)).toBe(false);
  });

  test('symbolic vector products are non-commutative', () => {
    const ce = freshMatrixEngine();
    const v12 = ce.box(['Multiply', 'v1', 'v2']);
    const v21 = ce.box(['Multiply', 'v2', 'v1']);
    expect(v12.isSame(v21)).toBe(false);
  });

  test('scalar-typed symbols still commute (do not over-trigger)', () => {
    const ce = freshMatrixEngine();
    const ab = ce.box(['Multiply', 'a', 'b']);
    const ba = ce.box(['Multiply', 'b', 'a']);
    expect(ab.isSame(ba)).toBe(true);
  });

  test('unknown symbols still commute', () => {
    const ce = new ComputeEngine();
    const xy = ce.box(['Multiply', 'x', 'y']);
    const yx = ce.box(['Multiply', 'y', 'x']);
    expect(xy.isSame(yx)).toBe(true);
  });

  test('scalar·tensor products (2·[1,2,3]) still evaluate element-wise', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Multiply', 2, ['List', 1, 2, 3]]).evaluate();
    expect(r.isSame(ce.box(['List', 2, 4, 6]))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────
  // ESCALATED (out of WP-2.12 allowed edit scope): fully non-commutative
  // serialization and the symbolic commutator additionally require making
  // `sortOperands('Multiply')` (order.ts) and `negateProduct` (negate.ts)
  // tensor-order-aware — those files are outside the WP-2.12 allowlist.
  // Empirically confirmed necessary AND sufficient; enable once applied.
  // ─────────────────────────────────────────────────────────────────────
  test('.json of P·M keeps written order', () => {
    const ce = freshMatrixEngine();
    expect(ce.box(['Multiply', 'P', 'M']).json).toEqual(['Multiply', 'P', 'M']);
  });

  test('symbolic commutator M·P − P·M ≠ 0', () => {
    const ce = freshMatrixEngine();
    const comm = ce
      .box(['Subtract', ['Multiply', 'M', 'P'], ['Multiply', 'P', 'M']])
      .evaluate();
    expect(comm.isSame(0)).toBe(false);
  });
});

describe('WP-2.12: SYM P0-7 sgn/type cache invalidated on popScope', () => {
  test('a held expression reverts its simplification after popScope', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('|x^3|');
    const base = e.simplify().toString();

    ce.pushScope();
    ce.assume(ce.parse('x > 0'));
    expect(e.simplify().toString()).toBe('x^3');

    ce.popScope();
    // Must revert to the no-assumption result, not stay 'x^3'.
    expect(e.simplify().toString()).toBe(base);
    expect(base).not.toBe('x^3');
  });

  test('a held symbol’s isPositive returns to undefined after popScope', () => {
    const ce = new ComputeEngine();
    const x = ce.symbol('x');
    expect(x.isPositive).toBeUndefined();

    ce.pushScope();
    ce.assume(ce.parse('x > 0'));
    expect(x.isPositive).toBe(true);

    ce.popScope();
    expect(x.isPositive).toBeUndefined();
  });
});

describe('Canonical folds must not follow symbol value bindings (2026-07-10)', () => {
  // `.isSame(n)` follows a symbol's value binding, so canonical folds that
  // used it leaked a mutable symbol's *transient* value into canonical
  // structure: `Divide(2, x)` canonicalized to `2` while `x` held `1` (and
  // to ComplexInfinity while it held `0`). Symptom: in a notebook/Cortex
  // program, Newton's method `x = (x + 2/x)/2` starting from `x = 1`
  // silently computed the (x+2)/2 ladder — 63/32 instead of √2. Canonical
  // folds now require the number *literal* (isLiteral in
  // arithmetic-mul-div.ts); evaluation still substitutes the value.

  test('Divide(2, x) keeps its structure whatever x currently holds', () => {
    for (const v of [1, 0, -1, 3]) {
      const ce = new ComputeEngine();
      ce.declare('x', { value: v });
      expect(ce.box(['Divide', 2, 'x']).json).toEqual(['Divide', 2, 'x']);
    }
  });

  test('Multiply and Ln folds are literal-only', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { value: 1 });
    expect(ce.box(['Multiply', 2, 'x']).json).toEqual(['Multiply', 2, 'x']);
    expect(ce.box(['Ln', 'x']).json).toEqual(['Ln', 'x']);
  });

  test('the literal folds themselves still apply', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Divide', 'a', 1]).json).toEqual('a');
    expect(ce.box(['Divide', 5, 0]).json).toEqual('ComplexInfinity');
    expect(ce.box(['Ln', 1]).json).toEqual(0);
  });

  test('evaluation still substitutes the current value', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { value: 1 });
    expect(ce.box(['Divide', 2, 'x']).evaluate().re).toBe(2);
    ce.assign('x', 4);
    expect(ce.box(['Divide', 2, 'x']).evaluate().toString()).toBe('1/2');
    ce.assign('x', 1);
    expect(ce.box(['Ln', 'x']).evaluate().re).toBe(0);
  });

  test("Newton's method from x0 = 1: canonicalize once, iterate", () => {
    const ce = new ComputeEngine();
    ce.declare('x', { value: 1 });
    // Canonicalize the update once — while x holds 1 — as a loop body would,
    // then evaluate it repeatedly.
    const update = ce.box([
      'Assign',
      'x',
      ['Divide', ['Add', 'x', ['Divide', 2, 'x']], 2],
    ]);
    for (let i = 0; i < 6; i++) update.evaluate();
    expect(ce.box('x').N().re).toBeCloseTo(Math.SQRT2, 14);
  });
});
