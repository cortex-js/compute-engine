import { ComputeEngine } from '../../../src/compute-engine';
import { getFactIndex } from '../../../src/compute-engine/boxed-expression/constraint-subject';
import { getInequalityBoundsFromAssumptions } from '../../../src/compute-engine/boxed-expression/inequality-bounds';

import '../../utils'; // For snapshot serializers

// P3 of FUNGRIM-PLAN-3-ASSUMPTIONS.md: the query/discharge hooks (§5.1).
//
// This is the query-side acceptance suite for the design §11 cases:
// relational operators over constraint subjects (a), sgn fallbacks for the
// part extractors (b), Element/NotElement fact lookup with SetMinus query
// decomposition (c), disequality discharge (d), and symbol predicate
// fallbacks (e) — all under the §5.2 three-valued invariant.
//
// Note: `ce.verify()` boxes its argument with `form: 'raw'`, which does not
// bind operator definitions for plain MathJSON input — every query below is
// boxed canonically first.

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

const SETMINUS_BRANCH_POINTS = [
  'SetMinus',
  'ComplexNumbers',
  ['Set', 'ImaginaryUnit', ['Negate', 'ImaginaryUnit']],
];

//
// ── §11.1: Element(n, Range(1, +∞)) ⊢ n ≥ 1, n > 0 ────────────────────────
//

describe('§11.1 Element(n, Range(1, +oo))', () => {
  it('verifies n >= 1 and n > 0 under the assumption', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Element', 'n', ['Range', 1, 'PositiveInfinity']]))
    ).toBe('ok');
    expect(ce.box('n').isInteger).toBe(true);
    expect(ce.verify(ce.box(['GreaterEqual', 'n', 1]))).toBe(true);
    expect(ce.verify(ce.box(['Greater', 'n', 0]))).toBe(true);
    // No destructive retype: only the integer refinement
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  it('stays undefined without the assumption', () => {
    const ce = freshEngine();
    expect(ce.verify(ce.box(['GreaterEqual', 'n', 1]))).toBeUndefined();
    expect(ce.verify(ce.box(['Greater', 'n', 0]))).toBeUndefined();
  });
});

//
// ── §11.2: Im(tau) > 0 (the HH desugaring) ─────────────────────────────────
//

describe('§11.2 Greater(Imaginary(tau), 0)', () => {
  it('verifies the guard, refutes isReal, discharges tau != 0', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Greater', ['Imaginary', 'tau'], 0], { canonical: false }))
    ).toBe('ok');

    expect(ce.verify(ce.box(['Greater', ['Imaginary', 'tau'], 0]))).toBe(true);
    expect(ce.box('tau').isReal).toBe(false);
    expect(ce.verify(ce.box(['NotEqual', 'tau', 0]))).toBe(true);

    // The sgn fallback flows through BoxedFunction.sgn into isPositive
    expect(ce.box(['Imaginary', 'tau']).isPositive).toBe(true);
    // ...and only the `number` refinement occurred
    expect(ce.box('tau').type.toString()).toBe('number');
  });

  it('stays undefined without the assumption', () => {
    const ce = freshEngine();
    expect(
      ce.verify(ce.box(['Greater', ['Imaginary', 'tau'], 0]))
    ).toBeUndefined();
    expect(ce.box(['Imaginary', 'tau']).isPositive).toBeUndefined();
    expect(ce.verify(ce.box(['NotEqual', 'tau', 0]))).toBeUndefined();
  });
});

//
// ── §11.3: Re(s) > 1 (half-plane constraint) ───────────────────────────────
//

describe('§11.3 Greater(Real(s), 1)', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.box(['Greater', ['Real', 's'], 1], { canonical: false })
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('verifies Re(s) > 1 and the implied Re(s) > 0', () => {
    expect(ce.verify(ce.box(['Greater', ['Real', 's'], 1]))).toBe(true);
    // Bound implication: lower bound 1 entails > 0
    expect(ce.verify(ce.box(['Greater', ['Real', 's'], 0]))).toBe(true);
    // GreaterEqual is entailed too
    expect(ce.verify(ce.box(['GreaterEqual', ['Real', 's'], 1]))).toBe(true);
  });

  it('does not declare s real (no destructive retype)', () => {
    expect(ce.box('s').isReal).not.toBe(true);
    expect(ce.box('s').type.toString()).toBe('number');
  });

  it('Real(s).isPositive flows through the sgn fallback', () => {
    expect(ce.box(['Real', 's']).isPositive).toBe(true);
  });
});

//
// ── §11.4: |q| < 1 (unit disk) ─────────────────────────────────────────────
//

describe('§11.4 Less(Abs(q), 1)', () => {
  it('verifies the guard and q.isFinite', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Less', ['Abs', 'q'], 1], { canonical: false }))
    ).toBe('ok');
    expect(ce.verify(ce.box(['Less', ['Abs', 'q'], 1]))).toBe(true);
    expect(ce.verify(ce.box(['LessEqual', ['Abs', 'q'], 1]))).toBe(true);
    expect(ce.box('q').isFinite).toBe(true);
  });

  it('stays undefined without the assumption', () => {
    const ce = freshEngine();
    expect(ce.verify(ce.box(['Less', ['Abs', 'q'], 1]))).toBeUndefined();
    expect(ce.box('q').isFinite).toBeUndefined();
  });

  it('a lower bound on Abs sharpens its sign to positive', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Greater', ['Abs', 'r'], 2], { canonical: false }))
    ).toBe('ok');
    expect(ce.box(['Abs', 'r']).isPositive).toBe(true);
    expect(ce.verify(ce.box(['Greater', ['Abs', 'r'], 1]))).toBe(true);
  });
});

//
// ── §11.5: Element(z, SetMinus(CC, Set(i, -i))) — branch-point guard ───────
//

describe('§11.5 Element(z, SetMinus(ComplexNumbers, Set(i, -i)))', () => {
  it('the guard verifies true under the assumption', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Element', 'z', SETMINUS_BRANCH_POINTS], {
        canonical: false,
      }))
    ).toBe('ok');
    expect(ce.verify(ce.box(['Element', 'z', SETMINUS_BRANCH_POINTS]))).toBe(
      true
    );
    expect(ce.verify(ce.box(['Equal', 'z', 'ImaginaryUnit']))).toBe(false);
    expect(ce.verify(ce.box(['NotEqual', 'z', 'ImaginaryUnit']))).toBe(true);
    expect(
      ce.verify(ce.box(['NotEqual', 'z', ['Negate', 'ImaginaryUnit']]))
    ).toBe(true);
  });

  it('the guard stays undefined without the assumption', () => {
    const ce = freshEngine();
    ce.declare('z', 'number');
    // Previously the SetMinus `contains` handler collapsed the unknown base
    // membership to a definitive False (§5.2.2 bug class); the query-side
    // decomposition stays three-valued.
    expect(
      ce.verify(ce.box(['Element', 'z', SETMINUS_BRANCH_POINTS]))
    ).toBeUndefined();
  });

  it('concrete elements are still decided', () => {
    const ce = freshEngine();
    expect(ce.box(['Element', 0.5, SETMINUS_BRANCH_POINTS]).evaluate().symbol).toBe(
      'True'
    );
    expect(
      ce.box(['Element', 'ImaginaryUnit', SETMINUS_BRANCH_POINTS])
        .evaluate()
        .symbol
    ).toBe('False');
  });
});

//
// ── §11.6: Element(z, SetMinus(CC, NonPositiveIntegers)) — Gamma guards ────
//

describe('§11.6 Element(z, SetMinus(ComplexNumbers, NonPositiveIntegers))', () => {
  it('verifies NotElement(z, NonPositiveIntegers)', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.box(
          ['Element', 'z', ['SetMinus', 'ComplexNumbers', 'NonPositiveIntegers']],
          { canonical: false }
        )
      )
    ).toBe('ok');
    expect(ce.verify(ce.box(['NotElement', 'z', 'NonPositiveIntegers']))).toBe(
      true
    );
  });

  it('membership facts in inert sets answer exact-match queries', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.box(['Element', 'x', 'MyInertSet'], { canonical: false }))
    ).toBe('ok');
    expect(ce.verify(ce.box(['Element', 'x', 'MyInertSet']))).toBe(true);
    // A different inert set is not entailed
    expect(
      ce.verify(ce.box(['Element', 'x', 'MyOtherInertSet']))
    ).toBeUndefined();
  });

  it('exclusion facts answer NotElement queries (and refute Element)', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.box(['NotElement', 'x', 'AlgebraicNumbers'], { canonical: false })
      )
    ).toBe('ok');
    expect(ce.verify(ce.box(['NotElement', 'x', 'AlgebraicNumbers']))).toBe(
      true
    );
    expect(ce.verify(ce.box(['Element', 'x', 'AlgebraicNumbers']))).toBe(false);
  });
});

//
// ── §11.7: And(Element(z, CC), z ≠ 0) — Log/Argument guards ────────────────
//

describe('§11.7 And(Element(z, ComplexNumbers), NotEqual(z, 0))', () => {
  it('both conjuncts verify; eq(z, 0) is false', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.box(
          ['And', ['Element', 'z', 'ComplexNumbers'], ['NotEqual', 'z', 0]],
          { canonical: false }
        )
      )
    ).toBe('ok');
    expect(ce.verify(ce.box(['Element', 'z', 'ComplexNumbers']))).toBe(true);
    expect(ce.verify(ce.box(['NotEqual', 'z', 0]))).toBe(true);
    expect(
      ce.verify(
        ce.box(
          ['And', ['Element', 'z', 'ComplexNumbers'], ['NotEqual', 'z', 0]]
        )
      )
    ).toBe(true);
    // eq() consults the stored disequality (design §5.1d)
    expect(ce.box(['Equal', 'z', 0]).evaluate().symbol).toBe('False');
  });
});

//
// ── §11.8: cross-symbol conjunction — Beta-integral guard ──────────────────
//

describe('§11.8 And(Greater(Re(a), 0), Greater(Re(b), 0))', () => {
  it('the Beta-integral guard verifies true', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.box(
          ['And', ['Greater', ['Real', 'a'], 0], ['Greater', ['Real', 'b'], 0]],
          { canonical: false }
        )
      )
    ).toBe('ok');
    expect(
      ce.verify(
        ce.box([
          'And',
          ['Greater', ['Real', 'a'], 0],
          ['Greater', ['Real', 'b'], 0],
        ])
      )
    ).toBe(true);
    // ...but a conjunct about an unconstrained symbol stays undefined
    expect(
      ce.verify(
        ce.box([
          'And',
          ['Greater', ['Real', 'a'], 0],
          ['Greater', ['Real', 'c'], 0],
        ])
      )
    ).toBeUndefined();
  });
});

//
// ── §11.9: negative control — never invent answers ─────────────────────────
//

describe('§11.9 negative control', () => {
  const ce = freshEngine();
  ce.assume(ce.box(['Greater', ['Real', 's'], 1], { canonical: false }));

  it('verify(Re(s) > 2) is undefined — never false', () => {
    expect(ce.verify(ce.box(['Greater', ['Real', 's'], 2]))).toBeUndefined();
  });

  it('a rule guarded on Re(s) > 2 does NOT fire', () => {
    const rules = [
      {
        match: ['Floor', '_z'],
        replace: ['Ceil', '_z'],
        condition: (sub) =>
          sub._z.engine
            .box(['Greater', ['Real', sub._z], 2])
            .evaluate().symbol === 'True',
      },
    ];
    const expr = ce.box(['Floor', 's']);
    const result = expr.replace(rules);
    expect(result).toBeNull();
  });

  it('but a rule guarded on Re(s) > 0 DOES fire (end-to-end discharge)', () => {
    const rules = [
      {
        match: ['Floor', '_z'],
        replace: ['Ceil', '_z'],
        condition: (sub) =>
          sub._z.engine
            .box(['Greater', ['Real', sub._z], 0])
            .evaluate().symbol === 'True',
      },
    ];
    const expr = ce.box(['Floor', 's']);
    const result = expr.replace(rules);
    expect(result?.operator).toBe('Ceil');
  });
});

//
// ── Closure-condition end-to-end: sgn fallback drives rule dispatch ────────
//

describe('closure-guarded rule on an Imaginary subject', () => {
  const rules = [
    {
      match: ['Floor', '_z'],
      replace: ['Ceil', '_z'],
      // solve.ts-style closure condition (design §5.1, rules.ts CONDITIONS)
      condition: (sub) =>
        sub._z.engine.box(['Imaginary', sub._z]).isPositive === true,
    },
  ];

  it('fires only under the assumption', () => {
    const ce = freshEngine();
    // Without the assumption: the condition is undefined, not true → no fire
    expect(ce.box(['Floor', 'tau']).replace(rules)).toBeNull();

    expect(
      ce.assume(
        ce.box(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
      )
    ).toBe('ok');
    const result = ce.box(['Floor', 'tau']).replace(rules);
    expect(result?.operator).toBe('Ceil');
  });
});

//
// ── §11.10: regression controls ────────────────────────────────────────────
//

describe('§11.10 regression: bare-symbol behavior unchanged', () => {
  it('assume(x > 0) still yields x.isPositive and x.isReal', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.parse('x > 0'))).toBe('ok');
    expect(ce.box('x').isPositive).toBe(true);
    expect(ce.box('x').isReal).toBe(true);
    expect(ce.verify(ce.box(['Greater', 'x', 0]))).toBe(true);
    expect(ce.verify(ce.box(['Less', 'x', 0]))).toBe(false);
  });
});

//
// ── §11.11: scope and forget ───────────────────────────────────────────────
//

describe('§11.11 scope and forget', () => {
  it('facts made in a pushed scope disappear after popScope', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(
      ce.assume(
        ce.box(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
      )
    ).toBe('ok');
    expect(ce.verify(ce.box(['Greater', ['Imaginary', 'tau'], 0]))).toBe(true);
    expect(ce.box(['Imaginary', 'tau']).isPositive).toBe(true);
    ce.popScope();
    expect(
      ce.verify(ce.box(['Greater', ['Imaginary', 'tau'], 0]))
    ).toBeUndefined();
    expect(ce.box(['Imaginary', 'tau']).isPositive).toBeUndefined();
  });

  it('forget(tau) removes derived facts too', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.box(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
      )
    ).toBe('ok');
    expect(ce.verify(ce.box(['NotEqual', 'tau', 0]))).toBe(true);

    ce.forget('tau');

    expect(ce.verify(ce.box(['Greater', ['Imaginary', 'tau'], 0]))).toBeUndefined();
    expect(ce.verify(ce.box(['NotEqual', 'tau', 0]))).toBeUndefined();
    expect(getFactIndex(ce).bySubject.get('im:tau')).toBeUndefined();
    expect(getFactIndex(ce).membership.get('tau')).toBeUndefined();
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'tau', part: 'im' })
    ).toEqual({});
  });
});

//
// ── §5.2 invariant: strict three-valued discipline ─────────────────────────
//

describe('§5.2 three-valued invariant', () => {
  it('predicates on an unconstrained symbol stay undefined', () => {
    const ce = freshEngine();
    const u = ce.box('u');
    expect(u.isPositive).toBeUndefined();
    expect(u.isReal).toBeUndefined();
    expect(u.isFinite).toBeUndefined();
    expect(ce.box(['Real', 'u']).isPositive).toBeUndefined();
    expect(ce.box(['Imaginary', 'u']).isPositive).toBeUndefined();
    expect(ce.box(['Argument', 'u']).isPositive).toBeUndefined();
    expect(ce.verify(ce.box(['Greater', ['Real', 'u'], 0]))).toBeUndefined();
    expect(ce.verify(ce.box(['Less', ['Abs', 'u'], 1]))).toBeUndefined();
    expect(ce.verify(ce.box(['NotEqual', 'u', 1]))).toBeUndefined();
  });

  it('returns False only on refutation (bounds contradict the query)', () => {
    const ce = freshEngine();
    ce.assume(ce.box(['Greater', ['Real', 's'], 1], { canonical: false }));
    // Re(s) < 1 is refuted by the strict lower bound
    expect(ce.verify(ce.box(['Less', ['Real', 's'], 1]))).toBe(false);
    expect(ce.verify(ce.box(['LessEqual', ['Real', 's'], 1]))).toBe(false);
    expect(ce.verify(ce.box(['Less', ['Real', 's'], 0]))).toBe(false);
    // Re(s) <= 2 is not refuted (and not entailed): undefined
    expect(ce.verify(ce.box(['LessEqual', ['Real', 's'], 2]))).toBeUndefined();
  });

  it('Abs sign never collapses to a definitive answer wrongly', () => {
    const ce = freshEngine();
    // Without assumptions: |u| is non-negative (structural), not positive
    expect(ce.box(['Abs', 'u']).isNonNegative).toBe(true);
    expect(ce.box(['Abs', 'u']).isPositive).toBeUndefined();
  });
});
