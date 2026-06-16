import { ComputeEngine } from '../../../src/compute-engine';
import { getFactIndex } from '../../../src/compute-engine/boxed-expression/constraint-subject';
import { getInequalityBoundsFromAssumptions } from '../../../src/compute-engine/boxed-expression/inequality-bounds';

import '../../utils'; // For snapshot serializers

// P2+P3 of docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md: the `assume()` extension and the
// query/discharge hooks.
//
// These tests cover the assume-side half of the design §11 acceptance
// cases (1, 2, 3, 4, 5, 6, 7, 11), plus the verify()-side halves enabled
// by the P3 query hooks (relational-operator subject bounds, part-extractor
// sgn fallbacks, Element/NotElement fact lookup). The full query-side
// acceptance suite is in `query-hooks.test.ts`.
//
// Note: `ce.verify()` boxes its argument with `form: 'raw'`, which does not
// bind operator definitions for plain MathJSON input — pass a canonical
// boxed expression.

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

//
// ── §11.1: Element(n, Range(1, +∞)) — the ZZGreaterEqual(1) shape ─────────
//

describe('Element(n, Range(1, +oo))', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(['Element', 'n', ['Range', 1, 'PositiveInfinity']])
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('refines n to integer', () => {
    expect(ce.expr('n').isInteger).toBe(true);
    expect(ce.expr('n').type.toString()).toBe('integer');
  });

  it('stores the lower bound n >= 1', () => {
    const bounds = getInequalityBoundsFromAssumptions(ce, 'n');
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.lowerStrict).toBe(false);
    // The infinite upper bound is not stored
    expect(bounds.upper).toBeUndefined();
  });

  // enabled in P3 (relational-operator subject-bounds query hook)
  it('verifies n >= 1 and n > 0', () => {
    expect(ce.verify(ce.expr(['GreaterEqual', 'n', 1]))).toBe(true);
    expect(ce.verify(ce.expr(['Greater', 'n', 0]))).toBe(true);
  });

  it('stores both bounds for a finite Range', () => {
    const ce2 = freshEngine();
    expect(
      ce2.assume(ce2.expr(['Element', 'k', ['Range', 1, 10]]))
    ).toBe('ok');
    const bounds = getInequalityBoundsFromAssumptions(ce2, 'k');
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.upper?.isSame(10)).toBe(true);
    expect(bounds.lowerStrict).toBe(false);
    expect(bounds.upperStrict).toBe(false);
  });
});

//
// ── §11.2: Greater(Imaginary(tau), 0) — the HH (upper half-plane) shape ──
//

describe('Greater(Imaginary(tau), 0)', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('does NOT retype tau as real', () => {
    expect(ce.expr('tau').isReal).not.toBe(true);
    // The only refinement allowed for a part-predicate is `number`
    expect(ce.expr('tau').type.toString()).toBe('number');
  });

  it('stores the bound on the im:tau subject in the fact index', () => {
    const facts = getFactIndex(ce).bySubject.get('im:tau');
    expect(facts?.bounds.lower?.isSame(0)).toBe(true);
    expect(facts?.bounds.lowerStrict).toBe(true);
    // No bound leaked onto the bare symbol
    expect(getFactIndex(ce).bySubject.get('self:tau')?.bounds ?? {}).toEqual(
      {}
    );
  });

  it('stores the derived fact NotEqual(tau, 0)', () => {
    const facts = getFactIndex(ce).bySubject.get('self:tau');
    expect(facts?.notEqual).toHaveLength(1);
    expect(facts?.notEqual[0].isSame(0)).toBe(true);
  });

  it('stores the derived fact NotElement(tau, RealNumbers)', () => {
    const m = getFactIndex(ce).membership.get('tau');
    expect(m?.notIn).toHaveLength(1);
    expect(m?.notIn[0].symbol).toBe('RealNumbers');
  });

  // enabled in P3 (Imaginary sgn fallback + relational query hooks)
  it('verifies Im(tau) > 0 and tau != 0', () => {
    expect(ce.verify(ce.expr(['Greater', ['Imaginary', 'tau'], 0]))).toBe(true);
    expect(ce.verify(ce.expr(['NotEqual', 'tau', 0]))).toBe(true);
  });

  it('does not store derived facts when the bound does not exclude 0', () => {
    const ce2 = freshEngine();
    expect(
      ce2.assume(
        ce2.expr(['GreaterEqual', ['Imaginary', 'w'], 0], { canonical: false })
      )
    ).toBe('ok');
    // Im(w) >= 0 does not imply w != 0 or w not real
    expect(getFactIndex(ce2).bySubject.get('self:w')).toBeUndefined();
    expect(getFactIndex(ce2).membership.get('w')).toBeUndefined();
  });
});

//
// ── §11.3: Greater(Real(s), 1) — half-plane constraint ────────────────────
//

describe('Greater(Real(s), 1)', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(['Greater', ['Real', 's'], 1], { canonical: false })
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('does NOT retype s as real (the destructive-retype bug)', () => {
    expect(ce.expr('s').isReal).not.toBe(true);
    expect(ce.expr('s').type.toString()).toBe('number');
  });

  it('stores the bound on the re:s subject', () => {
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 's',
      part: 're',
    });
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
    // ...and not on the bare symbol
    expect(getInequalityBoundsFromAssumptions(ce, 's')).toEqual({});
  });

  it('detects an implied part-bound as a tautology', () => {
    expect(
      ce.assume(ce.expr(['Greater', ['Real', 's'], 0], { canonical: false }))
    ).toBe('tautology');
  });

  it('detects a conflicting part-bound as a contradiction', () => {
    expect(
      ce.assume(ce.expr(['Less', ['Real', 's'], 0], { canonical: false }))
    ).toBe('contradiction');
  });

  // enabled in P3 (relational-operator subject-bounds query hook)
  it('verifies Re(s) > 1 and the implied Re(s) > 0', () => {
    expect(ce.verify(ce.expr(['Greater', ['Real', 's'], 1]))).toBe(true);
    expect(ce.verify(ce.expr(['Greater', ['Real', 's'], 0]))).toBe(true);
    // Negative control (§11.9): not decidable, must stay undefined
    expect(ce.verify(ce.expr(['Greater', ['Real', 's'], 2]))).toBeUndefined();
  });
});

//
// ── §11.4: Less(Abs(q), 1) — unit disk ────────────────────────────────────
//

describe('Less(Abs(q), 1)', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(['Less', ['Abs', 'q'], 1], { canonical: false })
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('stores the bound on the abs:q subject', () => {
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 'q',
      part: 'abs',
    });
    expect(bounds.upper?.isSame(1)).toBe(true);
    expect(bounds.upperStrict).toBe(true);
  });

  it('refines q to finite_number (|q| bounded => finite)', () => {
    expect(ce.expr('q').type.toString()).toBe('finite_number');
    expect(ce.expr('q').isReal).not.toBe(true);
  });

  // enabled in P3 (isFinite type fallback + relational query hooks)
  it('verifies |q| < 1 and q.isFinite', () => {
    expect(ce.verify(ce.expr(['Less', ['Abs', 'q'], 1]))).toBe(true);
    expect(ce.expr('q').isFinite).toBe(true);
  });

  it('a lower bound on Abs does not refine to finite_number', () => {
    const ce2 = freshEngine();
    expect(
      ce2.assume(ce2.expr(['Greater', ['Abs', 'r'], 2], { canonical: false }))
    ).toBe('ok');
    // |r| > 2 says nothing about finiteness: only `number`
    expect(ce2.expr('r').type.toString()).toBe('number');
  });
});

//
// ── §11.5: Element(z, SetMinus(CC, Set(i, -i))) — branch-point exclusion ──
//

describe('Element(z, SetMinus(ComplexNumbers, Set(i, -i)))', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(
      [
        'Element',
        'z',
        [
          'SetMinus',
          'ComplexNumbers',
          ['Set', 'ImaginaryUnit', ['Negate', 'ImaginaryUnit']],
        ],
      ],
      { canonical: false }
    )
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('refines z to complex', () => {
    expect(ce.expr('z').type.matches('complex')).toBe(true);
  });

  it('stores NotEqual facts for both exclusions', () => {
    const facts = getFactIndex(ce).bySubject.get('self:z');
    expect(facts?.notEqual).toHaveLength(2);
    const ims = facts!.notEqual.map((e) => e.im).sort();
    expect(ims).toEqual([-1, 1]);
  });

  // enabled in P3 (Element/NotElement fact lookup + SetMinus query
  // decomposition; eq() consults the stored NotEqual fact via the ask()
  // assumption-matching loop, which is not suppressed inside verify())
  it('verifies z != i (and z = i is false)', () => {
    expect(ce.verify(ce.expr(['NotEqual', 'z', 'ImaginaryUnit']))).toBe(true);
    expect(ce.verify(ce.expr(['Equal', 'z', 'ImaginaryUnit']))).toBe(false);
  });
});

describe('Element(z, SetMinus(ComplexNumbers, NonPositiveIntegers))', () => {
  const ce = freshEngine();
  const result = ce.assume(
    ce.expr(['Element', 'z', ['SetMinus', 'ComplexNumbers', 'NonPositiveIntegers']], {
      canonical: false,
    })
  );

  it('returns ok', () => expect(result).toBe('ok'));

  it('refines z to complex and stores a NotElement fact', () => {
    expect(ce.expr('z').type.matches('complex')).toBe(true);
    const m = getFactIndex(ce).membership.get('z');
    expect(m?.notIn).toHaveLength(1);
    expect(m?.notIn[0].symbol).toBe('NonPositiveIntegers');
  });

  // enabled in P3 (NotElement fact lookup)
  it('verifies NotElement(z, NonPositiveIntegers)', () => {
    expect(ce.verify(ce.expr(['NotElement', 'z', 'NonPositiveIntegers']))).toBe(
      true
    );
  });
});

//
// ── §11.6 / inert sets ─────────────────────────────────────────────────────
//

describe('Element(x, <inert/unknown set symbol>)', () => {
  it('stores a membership fact instead of throwing', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.expr(['Element', 'x', 'MyInertSet'], { canonical: false }))
    ).toBe('ok');
    const m = getFactIndex(ce).membership.get('x');
    expect(m?.in).toHaveLength(1);
    expect(m?.in[0].symbol).toBe('MyInertSet');
  });

  it('NotElement(x, S) stores an exclusion fact', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(['NotElement', 'x', 'AlgebraicNumbers'], { canonical: false })
      )
    ).toBe('ok');
    const m = getFactIndex(ce).membership.get('x');
    expect(m?.notIn).toHaveLength(1);
    expect(m?.notIn[0].symbol).toBe('AlgebraicNumbers');
  });
});

//
// ── Element(x, Interval(...)) ──────────────────────────────────────────────
//

describe('Element(x, Interval(...))', () => {
  it('refines to real and stores bounds, honoring Open markers', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(['Element', 'x', ['Interval', ['Open', 0], 10]], {
          canonical: false,
        })
      )
    ).toBe('ok');
    expect(ce.expr('x').type.toString()).toBe('real');
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.lower?.isSame(0)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
    expect(bounds.upper?.isSame(10)).toBe(true);
    expect(bounds.upperStrict).toBe(false);
  });

  it('skips infinite bounds', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(
          ['Element', 'y', ['Interval', ['Open', 1], 'PositiveInfinity']],
          { canonical: false }
        )
      )
    ).toBe('ok');
    const bounds = getInequalityBoundsFromAssumptions(ce, 'y');
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
    expect(bounds.upper).toBeUndefined();
  });
});

//
// ── NotEqual ───────────────────────────────────────────────────────────────
//

describe('NotEqual assumptions', () => {
  it('stores a disequality fact for a symbol', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.expr(['NotEqual', 'v', 3], { canonical: false }))).toBe(
      'ok'
    );
    const facts = getFactIndex(ce).bySubject.get('self:v');
    expect(facts?.notEqual).toHaveLength(1);
    expect(facts?.notEqual[0].isSame(3)).toBe(true);
  });

  it('stores a disequality fact for a part subject', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.expr(['NotEqual', ['Real', 's'], 1], { canonical: false }))
    ).toBe('ok');
    const facts = getFactIndex(ce).bySubject.get('re:s');
    expect(facts?.notEqual).toHaveLength(1);
    expect(facts?.notEqual[0].isSame(1)).toBe(true);
  });

  it('contradicts an assigned value (§4.3)', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Equal', 'w', 5]));
    expect(ce.assume(ce.expr(['NotEqual', 'w', 5], { canonical: false }))).toBe(
      'contradiction'
    );
  });

  it('is a tautology when the values are known to differ', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Equal', 'w', 5]));
    expect(ce.assume(ce.expr(['NotEqual', 'w', 4], { canonical: false }))).toBe(
      'tautology'
    );
  });
});

//
// ── §11.7: And(...) — conjunction splitting ────────────────────────────────
//

describe('And(...) assumptions', () => {
  it('assumes each conjunct', () => {
    const ce = freshEngine();
    const result = ce.assume(
      ce.expr(
        ['And', ['Element', 'z', 'ComplexNumbers'], ['NotEqual', 'z', 0]],
        { canonical: false }
      )
    );
    expect(result).toBe('ok');
    expect(ce.expr('z').type.matches('complex')).toBe(true);
    const facts = getFactIndex(ce).bySubject.get('self:z');
    expect(facts?.notEqual).toHaveLength(1);
    expect(facts?.notEqual[0].isSame(0)).toBe(true);
    // eq(z, 0) is decided false from the stored disequality (§5.1.d)
    expect(ce.expr(['Equal', 'z', 0]).evaluate().symbol).toBe('False');
  });

  it('splits conjuncts across symbols (§11.8)', () => {
    const ce = freshEngine();
    const result = ce.assume(
      ce.expr(
        [
          'And',
          ['Greater', ['Real', 'a'], 0],
          ['Greater', ['Real', 'b'], 0],
        ],
        { canonical: false }
      )
    );
    expect(result).toBe('ok');
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'a', part: 're' })
        .lower?.isSame(0)
    ).toBe(true);
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'b', part: 're' })
        .lower?.isSame(0)
    ).toBe(true);
  });

  it('reports a contradiction if any conjunct contradicts', () => {
    const ce = freshEngine();
    const result = ce.assume(
      ce.expr(['And', ['Greater', 'x', 2], ['Less', 'x', 1]], {
        canonical: false,
      })
    );
    expect(result).toBe('contradiction');
  });
});

//
// ── Contradiction / tautology detection (§4.3) ─────────────────────────────
//

describe('contradiction detection', () => {
  it('x > 2 then x < 1 is a contradiction (bare symbol, unchanged)', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.expr(['Greater', 'x', 2]))).toBe('ok');
    expect(ce.assume(ce.expr(['Less', 'x', 1]))).toBe('contradiction');
  });

  it('Re(s) > 1 then Re(s) < 0 is a contradiction (part subject)', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.expr(['Greater', ['Real', 's'], 1], { canonical: false }))
    ).toBe('ok');
    expect(
      ce.assume(ce.expr(['Less', ['Real', 's'], 0], { canonical: false }))
    ).toBe('contradiction');
  });

  it('equal strict bounds on a part subject contradict', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(['Greater', ['Imaginary', 't'], 0], { canonical: false })
      )
    ).toBe('ok');
    expect(
      ce.assume(ce.expr(['Less', ['Imaginary', 't'], 0], { canonical: false }))
    ).toBe('contradiction');
  });
});

//
// ── Unsupported shapes return 'not-a-predicate' (no throw) ─────────────────
//

describe('unsupported predicate shapes', () => {
  it('Or(...) returns not-a-predicate instead of throwing', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(['Or', ['Greater', 'x', 0], ['Less', 'x', 0]], {
          canonical: false,
        })
      )
    ).toBe('not-a-predicate');
  });

  it('Not(...) returns not-a-predicate', () => {
    const ce = freshEngine();
    expect(
      ce.assume(ce.expr(['Not', ['Greater', 'x', 0]], { canonical: false }))
    ).toBe('not-a-predicate');
  });
});

//
// ── §11.11: scope and forget() behavior ────────────────────────────────────
//

describe('scope behavior', () => {
  it('part facts made in a pushed scope disappear after popScope', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(
      ce.assume(
        ce.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
      )
    ).toBe('ok');
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'tau', part: 'im' })
        .lower?.isSame(0)
    ).toBe(true);
    expect(getFactIndex(ce).membership.get('tau')?.notIn).toHaveLength(1);
    ce.popScope();
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'tau', part: 'im' })
    ).toEqual({});
    expect(getFactIndex(ce).membership.get('tau')).toBeUndefined();
    expect(getFactIndex(ce).bySubject.get('self:tau')).toBeUndefined();
  });

  it('forget(tau) removes derived facts too', () => {
    const ce = freshEngine();
    expect(
      ce.assume(
        ce.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false })
      )
    ).toBe('ok');
    // The bound, the derived NotEqual and the derived NotElement are present
    expect(getFactIndex(ce).bySubject.get('im:tau')).toBeDefined();
    expect(getFactIndex(ce).bySubject.get('self:tau')?.notEqual).toHaveLength(
      1
    );
    expect(getFactIndex(ce).membership.get('tau')?.notIn).toHaveLength(1);

    ce.forget('tau');

    expect(getFactIndex(ce).bySubject.get('im:tau')).toBeUndefined();
    expect(getFactIndex(ce).bySubject.get('self:tau')).toBeUndefined();
    expect(getFactIndex(ce).membership.get('tau')).toBeUndefined();
  });
});

//
// ── §11.10: regression controls ────────────────────────────────────────────
//

describe('regression: bare-symbol inequalities keep historical behavior', () => {
  it('assume(x > 0) still implies x.isPositive and x.isReal', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.parse('x > 0'))).toBe('ok');
    expect(ce.expr('x').isPositive).toBe(true);
    expect(ce.expr('x').isReal).toBe(true);
  });

  it('assume(x > 4) declares x real and stores the bound', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.expr(['Greater', 'x', 4]))).toBe('ok');
    expect(ce.expr('x').type.toString()).toBe('real');
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.lower?.isSame(4)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
  });

  it('redundant and conflicting bare-symbol assumptions are detected', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.expr(['Greater', 'x', 4]))).toBe('ok');
    expect(ce.assume(ce.expr(['Greater', 'x', 0]))).toBe('tautology');
    expect(ce.assume(ce.expr(['Less', 'x', 0]))).toBe('contradiction');
  });

  it('Element with a primitive number set still refines the type', () => {
    const ce = freshEngine();
    expect(ce.assume(ce.expr(['Element', 'm', 'Integers']))).toBe('ok');
    expect(ce.expr('m').isInteger).toBe(true);
  });
});
