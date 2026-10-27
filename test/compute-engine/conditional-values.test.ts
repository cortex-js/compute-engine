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
    expect(ce.box(['Sin', whenX]).evaluate().toString()).toBe('sin(x) {0 < x}');
  });

  it('T2: absorbs a plain operand into the guard', () => {
    // When(x, x>0) + 1 → When(x + 1, x>0)
    expect(ce.box(['Add', whenX, 1]).evaluate().toString()).toBe(
      'x + 1 {0 < x}'
    );
  });

  it('T3: conjoins guards of two Whens', () => {
    // When(x, x>0) · When(y, y<1) → When(x·y, (x>0) ∧ (y<1))
    expect(ce.box(['Multiply', whenX, whenY]).evaluate().toString()).toBe(
      'x * y {0 < x && y < 1}'
    );
  });

  it('T4: a decidable-True guard collapses to the bare value', () => {
    // Add(When(5, 3>0), 1) → 6 (guard True, When unwraps, then 5 + 1)
    const r = ce.box(['Add', ['When', 5, ['Greater', 3, 0]], 1]).evaluate();
    expect(r.isSame(6)).toBe(true);
  });

  it('T4: a decidable-False guard masks a number to NaN', () => {
    // When(5, 3<0) → NaN: a masked value is the absence marker of its own
    // type, `NaN` for a number (user decision 2026-09-25; it was `Missing`
    // under the 2026-09-09 alignment with the no-selection ruling).
    expect(ce.box(['When', 5, ['Less', 3, 0]]).evaluate().isNaN).toBe(true);
    expect(
      ce.box(['When', ['Tuple', 1, 2], ['Less', 3, 0]]).evaluate().symbol
    ).toBe('Missing');
  });

  it('numericizes a When with a True guard, passing options through', () => {
    // Opportunistic fix: When(Pi, True).N() must produce a float, not stay `pi`.
    expect(ce.box(['When', 'Pi', 'True']).N().toString()).toMatch(/^3\.14159/);
  });
});

describe('CONDITIONAL VALUES — fold regressions (decision 5)', () => {
  it('0·When keeps the guard: → When(0, x>0), not plain 0', () => {
    const r = ce.box(['Multiply', 0, whenX]).evaluate();
    expect(r.operator).toBe('When');
    expect(r.op1.isSame(0)).toBe(true);
    expect(r.toString()).toBe('0 {0 < x}');
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
    // Which(x>0, 1, x<0, -1) + 2 → Which(x>0, 3, x<0, 1, True, NaN): the
    // `Which` has no default clause, so `Missing + 2` (`NaN`) is the last
    // branch.
    expect(ce.box(['Add', whichX, 2]).evaluate().toString()).toBe(
      'Which(0 < x, 3, x < 0, 1, "True", NaN)'
    );
  });

  // With no condition true, the threaded form has the value of the
  // application evaluated after the conditions are decided: an absent
  // operand gives `NaN` (`docs/ERROR-MODEL.md`), not `Missing`.
  it('a Which with no default clause: both orders agree', () => {
    const noDefault = ['Which', ['Greater', 'x', 1], 0];
    for (const json of [
      ['Add', 3, noDefault],
      ['Add', ['List', 1, 2], noDefault],
      ['Add', 3, ['Which', ['Greater', 'x', 1], 0, 'True', 1]],
    ]) {
      const e = ce.box(json as never);
      const threaded = e.evaluate();
      for (const x of [0, 2])
        expect(threaded.subs({ x }).evaluate().toString()).toBe(
          e.subs({ x }).evaluate().toString()
        );
    }
    expect(ce.box(['Add', 3, noDefault]).evaluate().toString()).toBe(
      'Which(1 < x, 3, "True", NaN)'
    );
    expect(
      ce
        .box(['Add', ['List', 1, 2], noDefault])
        .evaluate()
        .toString()
    ).toBe('[Which(1 < x, 1, "True", NaN),Which(1 < x, 2, "True", NaN)]');
    // A default clause: no extra branch.
    expect(
      ce
        .box(['Add', 3, ['Which', ['Greater', 'x', 1], 0, 'True', 1]])
        .evaluate()
        .toString()
    ).toBe('Which(1 < x, 3, "True", 4)');
  });

  it('a True conjunct, a repeated conjunct and a repeated branch are dropped', () => {
    const pw = ['Which', ['Greater', 'x', 1], 0, 'True', 1];
    expect(
      ce
        .box(['Sum', ['Multiply', 'k', pw], ['Limits', 'k', 1, 3]])
        .evaluate()
        .toString()
    ).toBe('Which(1 < x, 0, "True", 6)');
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

  it('T7 cost gate: the generated default branches are limited too', () => {
    // Twelve `Which` of one clause and no default: the written count is 1,
    // but each operand also has the generated `(True, Missing)` branch, so
    // distributing would generate 2^12 = 4096 combinations. It stays inert.
    const terms = Array.from({ length: 12 }, (_, k) => [
      'Which',
      ['Greater', `x_${k}`, 0],
      k + 1,
    ]);
    const r = ce.box(['Add', ...terms]).evaluate();
    expect(r.operator).toBe('Add');
    expect(r.nops).toBe(12);
  });

  it('T7 cost gate: four Which of two clauses and no default distribute', () => {
    // Written count 2^4 = 16; 3^4 = 81 combinations with the generated
    // default branches, at the limit.
    const terms = Array.from({ length: 4 }, (_, k) => [
      'Which',
      ['Greater', `y_${k}`, 1],
      1,
      ['Greater', `y_${k}`, 0],
      2,
    ]);
    const r = ce.box(['Add', ...terms]).evaluate();
    expect(r.operator).toBe('Which');
  });
});

// ROADMAP CE-515 (Tycho row 452): a selection whose arms are lists of one
// length evaluates to a list of selections, one for each position, so that a
// list combined with a piecewise is a `List`.
describe('CONDITIONAL VALUES — a selection of lists is a list of selections', () => {
  const pw = ['Which', ['Greater', 'x', 1], 0, 'True', 1];
  const at = (e: ReturnType<typeof ce.box>, x: number) =>
    e.subs({ x: ce.number(x) }).N().re;
  // The value is a `List`, equal element by element to `body(k)` for each
  // element `k` of the list, at one point in each branch of the piecewise.
  const expectListOfPieces = (
    value: ReturnType<typeof ce.box>,
    body: (l: unknown) => unknown,
    elements: number[]
  ) => {
    expect(value.operator).toBe('List');
    for (const x of [0.5, 2])
      expect(value.ops!.map((op) => at(op, x))).toEqual(
        elements.map((k) => at(ce.box(body(k) as never), x))
      );
  };

  it('a list plus a piecewise (box route)', () => {
    const body = (l: unknown) => ['Add', l, pw];
    const value = ce.box(body(['List', 1, 2]) as never).evaluate();
    expect(value.toString()).toBe(
      '[Which(1 < x, 1, "True", 2),Which(1 < x, 2, "True", 3)]'
    );
    expectListOfPieces(value, body, [1, 2]);
  });

  it('a range times a piecewise (parse route)', () => {
    const value = ce
      .parse(
        '[0...3] \\cdot \\begin{cases}0 & x>1\\\\ 1 & \\text{otherwise}\\end{cases}'
      )
      .evaluate();
    expectListOfPieces(value, (l) => ['Multiply', l, pw], [0, 1, 2, 3]);
  });

  it('Abs, a bounded Sum and .N() give a list too', () => {
    const abs = (l: unknown) => ['Abs', ['Subtract', l, ['Multiply', 5, pw]]];
    expectListOfPieces(
      ce.box(abs(['List', 2, 3]) as never).evaluate(),
      abs,
      [2, 3]
    );
    const sum = (l: unknown) => [
      'Sum',
      ['Multiply', 'k', l, pw],
      ['Limits', 'k', 1, 3],
    ];
    expectListOfPieces(
      ce.box(sum(['List', 2, 3]) as never).evaluate(),
      sum,
      [2, 3]
    );
    const mul = (l: unknown) => ['Multiply', l, pw];
    expectListOfPieces(
      ce.box(mul(['Range', 0, 19]) as never).N(),
      mul,
      Array.from({ length: 20 }, (_, k) => k)
    );
  });

  it('a Which or an If with list arms of one length', () => {
    expect(
      ce
        .box([
          'Which',
          ['Greater', 'x', 1],
          ['List', 1, 2],
          'True',
          ['List', 3, 4],
        ])
        .evaluate()
        .toString()
    ).toBe('[Which(1 < x, 1, "True", 3),Which(1 < x, 2, "True", 4)]');
    expect(
      ce
        .box(['If', ['Greater', 'x', 1], ['List', 1, 2], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[If(1 < x, 1, 3),If(1 < x, 2, 4)]');
    // Matrix arms give a matrix of selections.
    expect(
      ce
        .box([
          'Which',
          ['Greater', 'x', 1],
          ['List', ['List', 1, 2], ['List', 3, 4]],
          'True',
          ['List', ['List', 5, 6], ['List', 7, 8]],
        ])
        .evaluate()
        .toString()
    ).toBe(
      '[[Which(1 < x, 1, "True", 5),Which(1 < x, 2, "True", 6)],[Which(1 < x, 3, "True", 7),Which(1 < x, 4, "True", 8)]]'
    );
  });

  it('arms of different lengths, or no default clause, stay a selection', () => {
    expect(
      ce
        .box([
          'Which',
          ['Greater', 'x', 1],
          ['List', 1, 2],
          'True',
          ['List', 3, 4, 5],
        ])
        .evaluate().operator
    ).toBe('Which');
    // With no default clause the value is `Missing` when no condition holds,
    // which a list of `Missing` cells is not.
    expect(
      ce.box(['Which', ['Greater', 'x', 1], ['List', 1, 2]]).evaluate().operator
    ).toBe('Which');
    // A piecewise of scalars is unchanged.
    expect(ce.box(['Add', pw, 2]).evaluate().toString()).toBe(
      'Which(1 < x, 2, "True", 3)'
    );
  });

  // A guard that can be a list of booleans (a mask) selects element-wise,
  // which the list of selections does not do: the selection stays whole.
  it('a guard that can be a mask stays a selection', () => {
    const ce = new ComputeEngine();
    ce.declare('C', 'boolean');
    ce.declare('M', 'list<boolean>');
    // A boolean guard distributes.
    expect(
      ce
        .box(['Which', 'C', ['List', 1, 2], 'True', ['List', 5, 6]])
        .evaluate()
        .toString()
    ).toBe('[Which(C, 1, "True", 5),Which(C, 2, "True", 6)]');
    // A later guard is a mask: with `C = False` the value is `[3, 6]`.
    const later = ce.box([
      'Which',
      'C',
      ['List', 1, 2],
      ['List', 'True', 'False'],
      ['List', 3, 4],
      'True',
      ['List', 5, 6],
    ]);
    const held = later.evaluate();
    expect(held.operator).toBe('Which');
    // A collection-typed guard with no value, and a guard of unknown type.
    for (const g of ['M', 'U'])
      expect(
        ce.box(['If', g, ['List', 1, 2], ['List', 3, 4]]).evaluate().operator
      ).toBe('If');
    ce.assign('C', false);
    expect(held.evaluate().toString()).toBe('[3,6]');
    expect(later.evaluate().toString()).toBe('[3,6]');
  });
});

describe('CONDITIONAL VALUES — the cost limit of the Which distribution', () => {
  // Two `Which`s of 4 clauses with no default clause have 16 combinations
  // of written branches, which the limit admits. The `(True, Missing)`
  // branch added for the missing default clause is not counted.
  it('two Whiches of 4 clauses with no default clause distribute', () => {
    const w = (s: string) => [
      'Which',
      ['Greater', s, 1],
      1,
      ['Greater', s, 2],
      2,
      ['Greater', s, 3],
      3,
      ['Greater', s, 4],
      4,
    ];
    const e = ce.box(['Add', w('x'), w('y')]);
    const threaded = e.evaluate();
    expect(threaded.operator).toBe('Which');
    for (const [x, y] of [
      [0, 0],
      [2.5, 0],
      [1.5, 3.5],
      [5, 5],
    ])
      expect(threaded.subs({ x, y }).evaluate().toString()).toBe(
        e.subs({ x, y }).evaluate().toString()
      );
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

  it('Which with only Undefined/False conditions yields Missing', () => {
    // Decision 9 is unchanged: an `Undefined` guard is treated as not-True
    // and falls through. What changed is the END value when no clause is
    // selected — `Missing`, the position-preserving absent datum
    // (no-selection ruling 2026-08-27), where it used to be `Undefined`.
    const r = ce.box(['Which', 'Undefined', 1, ['Less', 3, 0], 2]).evaluate();
    expect(r.symbol).toBe('Missing');
  });

  it('When with an Undefined condition masks (NaN for a number)', () => {
    expect(ce.box(['When', 5, 'Undefined']).evaluate().isNaN).toBe(true);
  });

  it('a provably non-boolean Which condition is an error operand', () => {
    // A condition whose type proves it is not a boolean — here the number
    // 5 — is replaced at boxing by an `incompatible-type` error operand
    // (user ruling 2026-09-02, restoring the diagnostic the 2026-08-31
    // inertness ruling removed with the host throw). The later clauses are
    // NOT consulted: `Greater(3, 0)` is True, yet the answer is not 2 — the
    // condition's error is the value. Never a host exception.
    const boxed = ce.box(['Which', 5, 1, ['Greater', 3, 0], 2]);
    expect(boxed.errors).toHaveLength(1);
    expect(boxed.errors[0].toString()).toContain('incompatible-type');
    const r = boxed.evaluate();
    expect(r.operator).toBe('Error');
  });

  it('an undecided Which condition stays inert', () => {
    // A symbol of unknown type may still be assigned a boolean, so the
    // `Which` is returned unevaluated (user ruling 2026-08-31).
    const r = ce
      .box(['Which', 'undecidedCond', 1, ['Greater', 3, 0], 2])
      .evaluate();
    expect(r.operator).toBe('Which');
  });
});

describe('CONDITIONAL VALUES — Which operand pairing', () => {
  // `Which` takes alternating `(condition, value)` operands, and the
  // unconditional default clause is a literal `True` condition — NOT a
  // trailing unpaired operand. The LaTeX `cases` parser settles the
  // convention: a row written without a condition is normalized to an
  // explicit `True` one, so it produces an even operand count too.
  it('an EVEN operand count selects the first True clause', () => {
    expect(ce.box(['Which', 'True', 1, 'False', 2]).evaluate().isSame(1)).toBe(
      true
    );
    expect(ce.box(['Which', 'False', 1, 'True', 2]).evaluate().isSame(2)).toBe(
      true
    );
  });

  it('a literal True condition is how a default clause is written', () => {
    expect(
      ce
        .box(['Which', ['Less', 3, 0], 1, 'True', 2])
        .evaluate()
        .isSame(2)
    ).toBe(true);
  });

  it('an EVEN, unmatched Which is Missing', () => {
    expect(ce.box(['Which', 'False', 1, 'False', 2]).evaluate().symbol).toBe(
      'Missing'
    );
    // The no-operand case is the same rule with no clauses to try.
    expect(ce.box(['Which']).evaluate().symbol).toBe('Missing');
  });

  it('a condition-less LaTeX cases row becomes an explicit True clause', () => {
    const cases = ce.parse('\\begin{cases} x & x>0 \\\\ -x \\end{cases}');
    expect(cases.ops!.length).toBe(4);
    expect(cases.ops![2].symbol).toBe('True');
  });

  it('an ODD operand count is a malformed call, not a value', () => {
    // Both of these used to canonicalize to `Nothing` — a malformed call
    // quietly becoming an ordinary value, which hid the mistake and made the
    // two calls indistinguishable despite their opposite conditions.
    for (const expr of [
      ['Which', 'True', 1, 2],
      ['Which', 'False', 1, 2],
      ['Which', 1],
    ] as any[]) {
      const x = ce.box(expr);
      expect(x.type.toString()).toBe('error');
      expect(x.toString()).toContain('even number of operands');
    }
  });

  it('an ODD structural Which types as the error it evaluates to', () => {
    // The structural form skips canonicalization, so the odd operand list
    // survives to the `type` handler. It does not survive EVALUATION: the
    // structural expression canonicalizes first, and canonicalization is what
    // rejects the odd count. So the type must be the `error` that call
    // produces, not the `integer` its second operand suggests.
    const s = ce.function('Which', [ce.True, ce.box(1), ce.box(2)], {
      form: 'structural',
    });
    expect(s.operator).toBe('Which');
    expect(s.nops).toBe(3);
    expect(s.type.toString()).toBe('error');
    expect(s.evaluate().toString()).toContain('even number of operands');
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
      '2pi * t + arcsin(-b / a) {|-b / a| <= 1}',
      '2pi * t - arcsin(-b / a) + pi {|-b / a| <= 1}',
    ]);
  });

  it('symbolic a·cos(x) + b = 0 → both branches guarded by |−b/a| ≤ 1', () => {
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Cos', 'x']], 'b'], 0];
    expect(solveStrings(ce, eq, 'x')).toEqual([
      '2pi * t + arccos(-b / a) {|-b / a| <= 1}',
      '2pi * t - arccos(-b / a) {|-b / a| <= 1}',
    ]);
  });

  it('numeric decidable-True (2·sin(x) − 1 = 0) → bare roots, unchanged', () => {
    const eq = ['Equal', ['Add', ['Multiply', 2, ['Sin', 'x']], -1], 0];
    // No guard. Each root is a family with the integer parameter `t`.
    expect(solveStrings(ce, eq, 'x')).toEqual([
      '2pi * t + 1/6 * pi',
      '2pi * t + 5/6 * pi',
    ]);
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
    // both branches unwrap to bare roots (no `When`). Each root of a family
    // is in (-π, π]: `7π/6 + 2πt` is `-5π/6 + 2πt`.
    const engine = new ComputeEngine();
    engine.assume(engine.parse('a = 2'));
    engine.assume(engine.parse('b = 1'));
    const eq = ['Equal', ['Add', ['Multiply', 'a', ['Sin', 'x']], 'b'], 0];
    const roots = solveStrings(engine, eq, 'x');
    expect(roots?.every((r) => !r.includes('When'))).toBe(true);
    expect(roots).toEqual(['2pi * t - 5/6 * pi', '2pi * t - 1/6 * pi']);
  });
});

describe('Convergence guards (Phase 3a)', () => {
  const evalStr = (latex: string): string =>
    ce.parse(latex).evaluate().toString();

  // ── The six acceptance rows ────────────────────────────────────────────

  it('∫₀^∞ e^(−a·x) dx → 1/a {0 < a}', () => {
    expect(evalStr('\\int_0^\\infty e^{-a x} dx')).toBe('1 / a {0 < a}');
  });

  it('∫₀^∞ e^(−2x) dx → 1/2 (decidable, unchanged)', () => {
    expect(evalStr('\\int_0^\\infty e^{-2 x} dx')).toBe('1/2');
  });

  it('∫₀^1 xⁿ dx → 1/(n+1) {−1 < n} (no leaked 0^(n+1))', () => {
    expect(evalStr('\\int_0^1 x^n dx')).toBe('1 / (n + 1) {0 < n + 1}');
  });

  it('∫₀^∞ xⁿ dx diverges for every n: it stays unevaluated (CE-383)', () => {
    // The leaks `0^(n+1)` (a limit under `0 < n+1`) and `∞^(n+1)` (a limit
    // under `n+1 < 0`) have guards that no `n` satisfies.
    expect(evalStr('\\int_0^\\infty x^n dx')).toBe('int_(0)^(+oo)(x^n dx)');
  });

  it('∫₁^∞ x^(−s) dx → 1/(s−1) {1 < s} (no leaked ∞^(1−s))', () => {
    expect(evalStr('\\int_1^\\infty x^{-s} dx')).toBe(
      '-1 / (1 - s) {1 - s < 0}'
    );
  });

  it('Σ_{n=0}^∞ xⁿ → 1/(1−x) {|x| < 1}', () => {
    expect(evalStr('\\sum_{n=0}^\\infty x^n')).toBe('1 / (1 - x) {|x| < 1}');
  });

  it('Σ_{n=0}^∞ (1/2)ⁿ → 2 (exact)', () => {
    expect(evalStr('\\sum_{n=0}^\\infty (1/2)^n')).toBe('2');
  });

  // ── Guard collapse (integral) ──────────────────────────────────────────

  it('substituting a = 2 into ∫₀^∞ e^(−a·x) dx collapses to 1/2', () => {
    const r = ce.parse('\\int_0^\\infty e^{-a x} dx').evaluate();
    expect(r.subs({ a: 2 }).evaluate().toString()).toBe('1/2');
  });

  it('substituting a = −1 (outside the guard) gives NaN', () => {
    // The guarded value is a number, so the mask is `NaN` (user decision
    // 2026-09-25); it was `Missing`.
    const r = ce.parse('\\int_0^\\infty e^{-a x} dx').evaluate();
    expect(r.subs({ a: -1 }).evaluate().isNaN).toBe(true);
  });

  it('an assumption a > 0 discharges the guard to a bare 1/a', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.parse('a > 0'));
    expect(
      engine.parse('\\int_0^\\infty e^{-a x} dx').evaluate().toString()
    ).toBe('1 / a');
  });

  // ── Fail-closed: no indeterminate form leaks ───────────────────────────

  it('the two leak cases no longer contain 0^… / ∞^… indeterminates', () => {
    const xn = evalStr('\\int_0^1 x^n dx');
    const xs = evalStr('\\int_1^\\infty x^{-s} dx');
    expect(xn).not.toMatch(/0\^/);
    expect(xs).not.toMatch(/oo\^/);
    // And the correct guarded values survived.
    expect(xn).toContain('1 / (n + 1)');
    expect(xs).toContain('1 - s');
  });

  it('∫₁^∞ x^(−1/2) dx stays +∞ (divergent-when-decidable, unchanged)', () => {
    expect(evalStr('\\int_1^\\infty x^{-1/2} dx')).toBe('+oo');
  });

  it('∫₀^∞ e^(2x) dx stays +∞ (divergent-when-decidable, unchanged)', () => {
    expect(evalStr('\\int_0^\\infty e^{2 x} dx')).toBe('+oo');
  });

  // ── Geometric series exactness ─────────────────────────────────────────

  it('Σ (1/2)ⁿ evaluate → exact integer 2 (not 2.)', () => {
    const r = ce.parse('\\sum_{n=0}^\\infty (1/2)^n').evaluate();
    expect(r.isSame(2)).toBe(true);
  });

  it('Σ (1/3)ⁿ → 3/2 (exact)', () => {
    expect(evalStr('\\sum_{n=0}^\\infty (1/3)^n')).toBe('3/2');
  });

  it('Σ (1/√2)ⁿ → exact closed form 2 + √2', () => {
    const r = ce.parse('\\sum_{n=0}^\\infty (1/\\sqrt{2})^n').evaluate();
    expect(r.isEqual(ce.box(['Add', 2, ['Sqrt', 2]]))).toBe(true);
  });

  it('numeric divergent geometric (Σ 2ⁿ) is +∞', () => {
    // The geometric closed form declines (`|r| ≥ 1`); the divergence is then
    // certified by the limit comparison with the harmonic series.
    expect(
      ce.parse('\\sum_{n=0}^\\infty 2^n').evaluate().isSame(ce.PositiveInfinity)
    ).toBe(true);
  });

  it('.N() of Σ (1/2)ⁿ composes to 2', () => {
    expect(ce.parse('\\sum_{n=0}^\\infty (1/2)^n').N().re).toBeCloseTo(2, 12);
  });
});

describe('Phase 3b', () => {
  const evalStr = (latex: string): string =>
    ce.parse(latex).evaluate().toString();

  // D-verify an indefinite integral: differentiate the closed form back and
  // check it equals the integrand numerically at three sample points (house
  // rule — verify math empirically, not from recall). The integrand is parsed
  // separately (the `Integrate` node stores it as a `Function` lambda binding
  // `x`, so it is not directly substitutable). `x` is the integration variable,
  // `a` a free parameter.
  const dVerify = (
    integralLatex: string,
    integrandLatex: string,
    samples: Record<string, number>[]
  ): void => {
    const F = ce.parse(integralLatex).evaluate();
    expect(F.has('Integrate')).toBe(false);
    const dF = ce.box(['D', F, 'x']).evaluate();
    const integrand = ce.parse(integrandLatex);
    for (const s of samples) {
      const sub = Object.fromEntries(
        Object.entries(s).map(([k, v]) => [k, ce.number(v)])
      );
      const lhs = dF.subs(sub).N().re;
      const rhs = integrand.subs(sub).N().re;
      expect(rhs).not.toBeNaN();
      expect(lhs).toBeCloseTo(rhs!, 10);
    }
  };

  // ── Item 1: linear-exponential antiderivatives (D-verified) ────────────

  it('∫ e^(−a·x) dx → closed form (was inert)', () => {
    expect(evalStr('\\int e^{-a x} dx')).toBe('-(e^(-(a * x))) / a');
    dVerify('\\int e^{-a x} dx', 'e^{-a x}', [
      { x: 0.3, a: 0.7 },
      { x: 1.1, a: 1.3 },
      { x: -0.6, a: 0.5 },
    ]);
  });

  it('∫ e^(−2x) dx → −e^(−2x)/2 (D-verified)', () => {
    dVerify('\\int e^{-2x} dx', 'e^{-2x}', [
      { x: 0.2 },
      { x: 1.4 },
      { x: -0.9 },
    ]);
  });

  it('∫ e^(3−2x) dx → closed form (D-verified)', () => {
    dVerify('\\int e^{3-2x} dx', 'e^{3-2x}', [
      { x: 0.2 },
      { x: 1.4 },
      { x: -0.9 },
    ]);
  });

  it('∫ 5·e^(−x/2) dx → closed form (D-verified)', () => {
    dVerify('\\int 5e^{-x/2} dx', '5e^{-x/2}', [
      { x: 0.2 },
      { x: 1.4 },
      { x: -0.9 },
    ]);
  });

  it('∫ e^(a·x) dx behavior unchanged', () => {
    expect(evalStr('\\int e^{ax} dx')).toBe('e^(a * x) / a');
  });

  // The improper-integral acceptance behavior is preserved through the general
  // antiderivative path (the `improperExpAntiderivative` workaround is retired).
  it('∫₀^∞ e^(−a·x) dx → 1/a {0 < a} (preserved)', () => {
    expect(evalStr('\\int_0^\\infty e^{-a x} dx')).toBe('1 / a {0 < a}');
  });

  it('∫₀^∞ e^(−2x) dx → 1/2 (preserved)', () => {
    expect(evalStr('\\int_0^\\infty e^{-2 x} dx')).toBe('1/2');
  });

  // ── Item 2: radical equations with a symbolic RHS ──────────────────────

  const solveStrings = (
    engine: ComputeEngine,
    latex: string
  ): string[] | undefined =>
    engine
      .box(['Solve', engine.parse(latex), 'x'])
      .evaluate()
      .ops?.map((r) => r.toString());

  it('√(x+3) = a (symbolic) → one guarded root a² − 3 {0 ≤ a}', () => {
    expect(solveStrings(ce, '\\sqrt{x+3} = a')).toEqual(['a^2 - 3 {0 <= a}']);
  });

  it('the guarded root collapses under substitution', () => {
    const root = ce
      .box(['Solve', ce.parse('\\sqrt{x+3} = a'), 'x'])
      .evaluate().op1;
    expect(root?.subs({ a: 2 }).evaluate().toString()).toBe('1');
    // A masked number is `NaN` (user decision 2026-09-25).
    expect(root?.subs({ a: -2 }).evaluate().isNaN).toBe(true);
  });

  it('numeric RHS unchanged: √(x+3) = 2 → [1]', () => {
    expect(solveStrings(ce, '\\sqrt{x+3} = 2')).toEqual(['1']);
  });

  it('numeric out-of-range RHS unchanged: √(x+3) = −2 → []', () => {
    expect(solveStrings(ce, '\\sqrt{x+3} = -2')).toEqual([]);
  });

  it('x-dependent coefficient is untouched: x·√(x²+1) = 1', () => {
    // No guard is attached (the √ coefficient contains x); result unchanged.
    expect(solveStrings(ce, 'x\\sqrt{x^2+1} = 1')).toEqual([
      'sqrt(-1/2 + sqrt(5)/2)',
    ]);
  });

  it('x-dependent RHS is untouched: √(2x+3) = x − 1', () => {
    expect(solveStrings(ce, '\\sqrt{2x+3} = x-1')).toEqual(['2 + sqrt(6)']);
  });
});
