import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

/**
 * Phase 1 of the conditional-values design
 * (docs/plans/2026-07-12-conditional-values-design.md): the `When`/`Which`
 * threading algebra (T1–T7), decisions 5/9/10, and conservative predicates.
 * No producer changes — these tests only exercise the threading pre-pass in
 * `_computeValue` and the contained `control-structures.ts` fixes.
 */

const gtx = ['Greater', 'x', 0]; // x > 0
const lty = ['Less', 'y', 1]; // y < 1

// When(x, x > 0)
const whenX = ['When', 'x', gtx];
// When(y, y < 1)
const whenY = ['When', 'y', lty];
// Which(x > 0, 1, x < 0, -1)
const whichX = ['Which', gtx, 1, ['Less', 'x', 0], -1];

describe('CONDITIONAL VALUES — When threading (T1–T5)', () => {
  it('T1: threads a scalar function through a When guard', () => {
    // sin(When(x, x>0)) → When(sin(x), x>0)
    expect(ce.box(['Sin', whenX]).evaluate().toString()).toBe(
      'When(sin(x), 0 < x)'
    );
  });

  it('T2: absorbs a plain operand into the guard', () => {
    // When(x, x>0) + 1 → When(x + 1, x>0)
    expect(ce.box(['Add', whenX, 1]).evaluate().toString()).toBe(
      'When(x + 1, 0 < x)'
    );
  });

  it('T3: conjoins guards of two Whens', () => {
    // When(x, x>0) · When(y, y<1) → When(x·y, (x>0) ∧ (y<1))
    expect(ce.box(['Multiply', whenX, whenY]).evaluate().toString()).toBe(
      'When(x * y, 0 < x && y < 1)'
    );
  });

  it('T4: a decidable-True guard collapses to the bare value', () => {
    // Add(When(5, 3>0), 1) → 6 (guard True, When unwraps, then 5 + 1)
    const r = ce.box(['Add', ['When', 5, ['Greater', 3, 0]], 1]).evaluate();
    expect(r.isSame(6)).toBe(true);
  });

  it('T4: a decidable-False guard masks to Undefined', () => {
    // When(5, 3<0) → Undefined (masking rule)
    expect(
      ce.box(['When', 5, ['Less', 3, 0]]).evaluate().symbol
    ).toBe('Undefined');
  });

  it('numericizes a When with a True guard, passing options through', () => {
    // Opportunistic fix: When(Pi, True).N() must produce a float, not stay `pi`.
    expect(ce.box(['When', 'Pi', 'True']).N().toString()).toMatch(
      /^3\.14159/
    );
  });
});

describe('CONDITIONAL VALUES — fold regressions (decision 5)', () => {
  it('0·When keeps the guard: → When(0, x>0), not plain 0', () => {
    const r = ce.box(['Multiply', 0, whenX]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.isSame(0)).toBe(true);
    expect(r.toString()).toBe('When(0, 0 < x)');
  });

  it('When − When keeps the guard: → When(0, c), not plain 0', () => {
    const r = ce.box(['Subtract', whenX, whenX]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.isSame(0)).toBe(true);
  });

  it('When / When keeps the guard: → When(1, c), not plain 1', () => {
    const r = ce.box(['Divide', whenX, whenX]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.isSame(1)).toBe(true);
  });
});

describe('CONDITIONAL VALUES — logic operators are excluded', () => {
  it('And(When(B, g), False) stays False (Kleene, not lifted)', () => {
    const whenB = ['When', 'B', gtx];
    expect(ce.box(['And', whenB, 'False']).evaluate().symbol).toBe('False');
  });

  it('Or(When(B, g), True) stays True (Kleene, not lifted)', () => {
    const whenB = ['When', 'B', gtx];
    expect(ce.box(['Or', whenB, 'True']).evaluate().symbol).toBe('True');
  });
});

describe('CONDITIONAL VALUES — Which distribution (T6/T7)', () => {
  it('T6: distributes a scalar over Which branches, conditions untouched', () => {
    // Which(x>0, 1, x<0, -1) + 2 → Which(x>0, 3, x<0, 1)
    expect(ce.box(['Add', whichX, 2]).evaluate().toString()).toBe(
      'Which(0 < x, 3, x < 0, 1)'
    );
  });

  it('T7: threads a small two-Which cross-product (lexicographic)', () => {
    const a = ['Which', ['Greater', 'x', 0], 1, 'True', 2];
    const b = ['Which', ['Less', 'y', 0], 10, 'True', 20];
    const r = ce.box(['Add', a, b]).evaluate();
    expect(r.operator).toBe('Which');
    // 2 × 2 = 4 branches, lexicographic (first operand slowest):
    // (x>0 ∧ y<0, 11), (x>0 ∧ True, 21), (True ∧ y<0, 12), (True ∧ True, 22)
    expect(r.ops!.length).toBe(8);
    expect(r.ops![1].isSame(11)).toBe(true);
    expect(r.ops![3].isSame(21)).toBe(true);
    expect(r.ops![5].isSame(12)).toBe(true);
    expect(r.ops![7].isSame(22)).toBe(true);
  });

  it('T7 cost gate: a product above 16 branches stays inert', () => {
    // 5 × 4 = 20 > 16 → no threading; the Add stays symbolic over two Whichs.
    const big1 = [
      'Which',
      ['Greater', 'x', 1],
      1,
      ['Greater', 'x', 2],
      2,
      ['Greater', 'x', 3],
      3,
      ['Greater', 'x', 4],
      4,
      'True',
      5,
    ];
    const big2 = [
      'Which',
      ['Less', 'y', 1],
      1,
      ['Less', 'y', 2],
      2,
      ['Less', 'y', 3],
      3,
      'True',
      4,
    ];
    const r = ce.box(['Add', big1, big2]).evaluate();
    expect(r.operator).toBe('Add');
  });
});

describe('CONDITIONAL VALUES — layering normal form (decision 6)', () => {
  it('mixed When ⊕ Which keeps the guard outermost', () => {
    // Add(When(x, x>0), Which(...)) → When(Which(...), x>0)
    const r = ce.box(['Add', whenX, whichX]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.operator).toBe('Which');
  });

  it('f(When(Which(...), g)) keeps the guard outermost, Which distributed', () => {
    const wrapped = ['When', whichX, ['Greater', 'z', 0]];
    const r = ce.box(['Sin', wrapped]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.operator).toBe('Which');
  });
});

describe('CONDITIONAL VALUES — Undefined conditions (decision 9)', () => {
  it('Which with an Undefined first condition falls through (no throw)', () => {
    // Undefined → not-True → next branch (True) is selected.
    const r = ce
      .box(['Which', 'Undefined', 1, ['Greater', 3, 0], 2])
      .evaluate();
    expect(r.isSame(2)).toBe(true);
  });

  it('Which with only Undefined/False conditions yields Undefined', () => {
    const r = ce
      .box(['Which', 'Undefined', 1, ['Less', 3, 0], 2])
      .evaluate();
    expect(r.symbol).toBe('Undefined');
  });

  it('When with an Undefined condition masks to Undefined', () => {
    expect(ce.box(['When', 5, 'Undefined']).evaluate().symbol).toBe(
      'Undefined'
    );
  });

  it('a non-boolean Which condition still throws', () => {
    expect(() =>
      ce.box(['Which', 5, 1, ['Greater', 3, 0], 2]).evaluate()
    ).toThrow();
  });
});

describe('CONDITIONAL VALUES — predicates stay conservative (decision 2)', () => {
  it('When(x, x>0).isPositive is undefined', () => {
    expect(ce.box(whenX).isPositive).toBeUndefined();
  });

  it('When(x, x>0).sgn is undefined', () => {
    expect(ce.box(whenX).sgn).toBeUndefined();
  });
});

/**
 * Phase 2 of the conditional-values design: `Solve` is the first `When`
 * producer. A trig root with a symbolic ratio is emitted with its validity
 * guard (`|−b/a| ≤ 1`); a decidable ratio keeps today's behavior exactly
 * (guard True → bare root, guard False → the rule declines to fire), and a
 * guard that resolves False in solution-set position prunes the root
 * (decision 8).
 */
describe('CONDITIONAL VALUES — Solve emission (Phase 2)', () => {
  // `a`, `b` are numeric coefficients here (never boolean operands), so plain
  // lowercase symbols are safe.
  const solveStrings = (
    engine: ComputeEngine,
    eq: unknown,
    unknown: string
  ): string[] | undefined =>
    engine
      .box(['Solve', eq, unknown] as any)
      .evaluate()
      .ops?.map((r) => r.toString());

  it('symbolic a·sin(x) + b = 0 → both branches guarded by |−b/a| ≤ 1', () => {
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Sin', 'x']], 'b'], 0];
    expect(solveStrings(ce, eq, 'x')).toEqual([
      'When(arcsin(-b / a), |-b / a| <= 1)',
      'When(-arcsin(-b / a) + pi, |-b / a| <= 1)',
    ]);
  });

  it('symbolic a·cos(x) + b = 0 → both branches guarded by |−b/a| ≤ 1', () => {
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Cos', 'x']], 'b'], 0];
    expect(solveStrings(ce, eq, 'x')).toEqual([
      'When(arccos(-b / a), |-b / a| <= 1)',
      'When(-arccos(-b / a), |-b / a| <= 1)',
    ]);
  });

  it('numeric decidable-True (2·sin(x) − 1 = 0) → bare roots, unchanged', () => {
    const eq = ['Equal', ['Add', ['Multiply', 2, ['Sin', 'x']], -1], 0];
    // Byte-identical to the pre-Phase-2 output.
    expect(solveStrings(ce, eq, 'x')).toEqual(['1/6 * pi', '5/6 * pi']);
  });

  it('numeric decidable-False (sin(x) + 2 = 0) → no roots, unchanged', () => {
    const eq = ['Equal', ['Add', ['Sin', 'x'], 2], 0];
    expect(solveStrings(ce, eq, 'x')).toEqual([]);
  });

  it('a decidable-False guard prunes the guarded root to [] (decision 8)', () => {
    // Assume concrete out-of-range coefficients (|−b/a| = 5 > 1); the guard
    // resolves False in solution-set position, so both branches vanish.
    const engine = new ComputeEngine();
    engine.assume(engine.parse('a = 1'));
    engine.assume(engine.parse('b = 5'));
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Sin', 'x']], 'b'], 0];
    expect(solveStrings(engine, eq, 'x')).toEqual([]);
  });

  it('a decidable-True guard collapses the guarded root to a bare root', () => {
    // In-range coefficients (|−b/a| = 1/2 ≤ 1): the guard resolves True and
    // both branches unwrap to bare roots (no `When`).
    const engine = new ComputeEngine();
    engine.assume(engine.parse('a = 2'));
    engine.assume(engine.parse('b = 1'));
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Sin', 'x']], 'b'], 0];
    const roots = solveStrings(engine, eq, 'x');
    expect(roots?.every((r) => !r.includes('When'))).toBe(true);
    expect(roots).toEqual(['-1/6 * pi', '7/6 * pi']);
  });
});
