import { ComputeEngine } from '../../../src/compute-engine';

import '../../utils'; // For snapshot serializers

// Three-valued membership discipline for the set library
// (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.2 invariant: `true` only when entailed,
// `false` only when refuted, `undefined` otherwise).
//
// Covers the two P4 guard-census FIXABLE buckets:
// 1. Intervals with infinite endpoints (e.g. `Interval(Open(-oo), 0)`,
//    the Gamma/Log branch-cut guards) must be well-typed sets so the
//    query-side SetMinus decomposition can discharge them.
// 2. `Union`/finite `Set`/`Range` `contains` must not collapse an
//    indeterminate membership test to a definitive `false`.
//
// Note: `ce.verify()` boxes its argument with `form: 'raw'`, which does not
// bind operator definitions for plain MathJSON input — every query below is
// boxed canonically first.

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

// The gamma/37a95a & log/0ba9b2 corpus shape: ℂ ∖ (-∞, 0]
const NEGATIVE_RAY = ['Interval', ['Open', 'NegativeInfinity'], 0];
const CC_MINUS_RAY = ['SetMinus', 'ComplexNumbers', NEGATIVE_RAY];

//
// ── Bucket 1: intervals with infinite endpoints ────────────────────────────
//

describe('Interval with an infinite endpoint', () => {
  it('is a well-typed set and a collection', () => {
    const ce = freshEngine();
    const ray = ce.expr(NEGATIVE_RAY);
    expect(ray.type.toString()).toBe('set<real>');
    expect(ray.isCollection).toBe(true);
    expect(ray.isCanonical).toBe(true);

    // Both endpoints infinite
    const line = ce.expr([
      'Interval',
      ['Open', 'NegativeInfinity'],
      ['Open', 'PositiveInfinity'],
    ]);
    expect(line.type.toString()).toBe('set<real>');
    expect(line.isCollection).toBe(true);

    // The Negate(PositiveInfinity) spelling used by some corpus entries
    const ray2 = ce.expr([
      'Interval',
      ['Open', ['Negate', 'PositiveInfinity']],
      0,
    ]);
    expect(ray2.type.toString()).toBe('set<real>');
    expect(ray2.isCollection).toBe(true);
  });

  it('contains literals below/at/above the (closed) upper boundary', () => {
    const ce = freshEngine();
    const ray = ce.expr(NEGATIVE_RAY); // (-∞, 0]
    expect(ray.contains(ce.number(-1))).toBe(true);
    expect(ray.contains(ce.number(-1e10))).toBe(true);
    expect(ray.contains(ce.number(0))).toBe(true); // closed end: included
    expect(ray.contains(ce.number(1))).toBe(false);
  });

  it('excludes the open infinite endpoint, includes a closed one', () => {
    const ce = freshEngine();
    const openRay = ce.expr(NEGATIVE_RAY); // (-∞, 0]
    expect(openRay.contains(ce.expr('NegativeInfinity'))).toBe(false);

    const closedRay = ce.expr(['Interval', 'NegativeInfinity', 0]); // [-∞, 0]
    expect(closedRay.contains(ce.expr('NegativeInfinity'))).toBe(true);
  });

  it('distinguishes open vs closed finite endpoints', () => {
    const ce = freshEngine();
    const upRay = ce.expr(['Interval', ['Open', 0], 'PositiveInfinity']);
    expect(upRay.contains(ce.number(0))).toBe(false); // open: excluded
    expect(upRay.contains(ce.number(0.5))).toBe(true);
    const upRayClosed = ce.expr(['Interval', 0, 'PositiveInfinity']);
    expect(upRayClosed.contains(ce.number(0))).toBe(true);
  });

  it('refutes non-real members, stays undefined for symbolic ones', () => {
    const ce = freshEngine();
    const ray = ce.expr(NEGATIVE_RAY);
    expect(ray.contains(ce.expr('ImaginaryUnit'))).toBe(false);
    expect(ray.contains(ce.string('text'))).toBe(false);
    // Symbolic element of unknown type/sign: indeterminate, not false
    expect(ray.contains(ce.expr('z'))).toBeUndefined();
  });

  it('decides symbolic members from assumed bounds', () => {
    const ce = freshEngine();
    ce.pushScope();
    ce.assume(ce.expr(['Greater', 'x', 0]));
    // x > 0 refutes x ∈ (-∞, 0]
    expect(ce.expr(NEGATIVE_RAY).contains(ce.expr('x'))).toBe(false);
    ce.popScope();
  });
});

describe('SetMinus(CC, Interval(Open(-oo), 0)) round trip (gamma/37a95a shape)', () => {
  it('assumes and verifies the membership', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(ce.assume(ce.expr(['Element', 'z', CC_MINUS_RAY]))).toBe('ok');
    expect(ce.verify(ce.expr(['Element', 'z', CC_MINUS_RAY]))).toBe(true);
    // The decomposed exclusion verifies too
    expect(ce.verify(ce.expr(['NotElement', 'z', NEGATIVE_RAY]))).toBe(true);
    ce.popScope();
  });

  it('is undefined without the assumption (not false)', () => {
    const ce = freshEngine();
    expect(ce.verify(ce.expr(['Element', 'z', CC_MINUS_RAY]))).toBeUndefined();
  });

  it('decides concrete members of the SetMinus', () => {
    const ce = freshEngine();
    const cut = ce.expr(CC_MINUS_RAY);
    expect(cut.contains(ce.number(1))).toBe(true); // in ℂ, not on the cut
    expect(cut.contains(ce.expr('ImaginaryUnit'))).toBe(true);
    expect(cut.contains(ce.number(-1))).toBe(false); // on the branch cut
    expect(cut.contains(ce.number(0))).toBe(false); // 0 is in (-∞, 0]
  });

  it('the direct NotElement conjunct still discharges (regression)', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(ce.assume(ce.expr(['Element', 'z', 'ComplexNumbers']))).toBe('ok');
    expect(
      ce.assume(
        ce.expr(['NotElement', 'z', NEGATIVE_RAY], { canonical: false })
      )
    ).toBe('ok');
    expect(ce.verify(ce.expr(['NotElement', 'z', NEGATIVE_RAY]))).toBe(true);
    ce.popScope();
  });
});

//
// ── Bucket 2: three-valued contains for Union / Set / Range ───────────────
//

describe('finite Set contains', () => {
  it('is undefined for a symbolic element, decided for literals', () => {
    const ce = freshEngine();
    const set = ce.expr(['Set', -1, 1]);
    expect(set.contains(ce.expr('omega'))).toBeUndefined();
    expect(set.contains(ce.number(1))).toBe(true);
    expect(set.contains(ce.number(-1))).toBe(true);
    expect(set.contains(ce.number(2))).toBe(false);
    expect(set.contains(ce.number(0.5))).toBe(false);
  });

  it('discharges a stored membership fact (coulomb_wave/01af55 shape)', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(ce.assume(ce.expr(['Element', 'omega', ['Set', -1, 1]]))).toBe('ok');
    expect(ce.verify(ce.expr(['Element', 'omega', ['Set', -1, 1]]))).toBe(true);
    ce.popScope();
    // ...and is undefined again outside the scope
    expect(
      ce.verify(ce.expr(['Element', 'omega', ['Set', -1, 1]]))
    ).toBeUndefined();
  });

  it('matches symbolic elements structurally', () => {
    const ce = freshEngine();
    const set = ce.expr(['Set', 'a', 'b']);
    expect(set.contains(ce.expr('a'))).toBe(true);
    expect(set.contains(ce.expr('c'))).toBeUndefined(); // could equal a or b
  });
});

describe('Range contains', () => {
  it('is undefined for a symbolic element, decided for literals', () => {
    const ce = freshEngine();
    const range = ce.expr(['Range', 1, 5]);
    expect(range.contains(ce.expr('n'))).toBeUndefined();
    expect(range.contains(ce.number(3))).toBe(true);
    expect(range.contains(ce.number(6))).toBe(false);
    expect(range.contains(ce.number(2.5))).toBe(false); // off the step grid
  });

  it('refutes elements whose type is disjoint from the reals', () => {
    const ce = freshEngine();
    const range = ce.expr(['Range', 1, 5]);
    expect(range.contains(ce.string('text'))).toBe(false);
  });

  it('still decides membership in infinite ranges (ZZGreaterEqual shape)', () => {
    const ce = freshEngine();
    const range = ce.expr(['Range', 1, 'PositiveInfinity']);
    expect(range.contains(ce.number(5))).toBe(true);
    expect(range.contains(ce.number(0))).toBe(false);
    expect(range.contains(ce.expr('PositiveInfinity'))).toBe(false);
  });

  it('is undefined for symbolic bounds', () => {
    const ce = freshEngine();
    const range = ce.expr(['Range', 1, 'n']);
    expect(range.contains(ce.number(5))).toBeUndefined();
  });
});

describe('Union contains (Kleene OR)', () => {
  const EXTENDED_CC = [
    'Union',
    'ComplexNumbers',
    ['Set', 'NegativeInfinity', 'PositiveInfinity'],
  ];

  it('is undefined for a symbolic element, decided for literals', () => {
    const ce = freshEngine();
    const u = ce.expr(EXTENDED_CC);
    expect(u.contains(ce.expr('z'))).toBeUndefined();
    expect(u.contains(ce.number(2))).toBe(true); // in ℂ
    expect(u.contains(ce.expr('PositiveInfinity'))).toBe(true); // in the Set
  });

  it('any true member test decides true even if another is undefined', () => {
    const ce = freshEngine();
    // x is indeterminate for the Set, but 1 ∈ {1} is decided
    const u = ce.expr(['Union', ['Set', 'x'], ['Set', 1]]);
    expect(u.contains(ce.number(1))).toBe(true);
  });

  it('all-false member tests decide false', () => {
    const ce = freshEngine();
    const u = ce.expr(['Union', ['Set', 1, 2], ['Set', 3]]);
    expect(u.contains(ce.number(4))).toBe(false);
  });

  it('discharges a stored membership fact (atan/0ee626 shape)', () => {
    const ce = freshEngine();
    ce.pushScope();
    expect(ce.assume(ce.expr(['Element', 'z', EXTENDED_CC]))).toBe('ok');
    expect(ce.verify(ce.expr(['Element', 'z', EXTENDED_CC]))).toBe(true);
    ce.popScope();
  });
});

describe('Intersection contains (Kleene AND)', () => {
  it('refutes when any operand refutes, even with indeterminate operands', () => {
    const ce = freshEngine();
    const i = ce.expr(['Intersection', ['Set', 'x'], ['Set', 1, 2]]).evaluate();
    // For a lazy Intersection expression: 5 is refuted by {1, 2}
    const lazy = ce.expr(['Intersection', 'RealNumbers', ['Set', 1, 2]]);
    expect(lazy.contains(ce.number(5))).toBe(false);
    expect(lazy.contains(ce.number(1))).toBe(true);
    expect(lazy.contains(ce.expr('y'))).toBeUndefined();
    expect(i.isValid).toBe(true);
  });
});

describe('compound-subject membership facts', () => {
  it('verifies a stored NotElement fact with a compound subject', () => {
    const ce = freshEngine();
    ce.pushScope();
    ce.assume(ce.expr(['Element', 'ell', 'ComplexNumbers']));
    ce.assume(ce.expr(['Element', 'eta', 'ComplexNumbers']));
    const subject = [
      'Add',
      1,
      'ell',
      ['Multiply', 'ImaginaryUnit', 'eta'],
    ];
    expect(
      ce.assume(ce.expr(['NotElement', subject, 'NonPositiveIntegers']))
    ).toBe('ok');
    expect(
      ce.verify(ce.expr(['NotElement', subject, 'NonPositiveIntegers']))
    ).toBe(true);
    ce.popScope();
    expect(
      ce.verify(ce.expr(['NotElement', subject, 'NonPositiveIntegers']))
    ).toBeUndefined();
  });
});

//
// ── Regression: literal membership behaviors unchanged ────────────────────
//

describe('regression: literal membership unchanged', () => {
  it('number-set membership for literals', () => {
    const ce = freshEngine();
    expect(ce.expr('Integers').contains(ce.number(3))).toBe(true);
    expect(ce.expr('Integers').contains(ce.number(0.5))).toBe(false);
    expect(ce.expr('RealNumbers').contains(ce.number(0.5))).toBe(true);
    expect(ce.expr('RealNumbers').contains(ce.expr('ImaginaryUnit'))).toBe(
      false
    );
    expect(ce.expr('PositiveNumbers').contains(ce.number(-2))).toBe(false);
    expect(ce.expr('ComplexNumbers').contains(ce.expr('ImaginaryUnit'))).toBe(
      true
    );
  });

  it('finite interval membership for literals', () => {
    const ce = freshEngine();
    const closed = ce.expr(['Interval', 0, 1]);
    expect(closed.contains(ce.number(0))).toBe(true);
    expect(closed.contains(ce.number(0.5))).toBe(true);
    expect(closed.contains(ce.number(1))).toBe(true);
    expect(closed.contains(ce.number(2))).toBe(false);
    expect(closed.contains(ce.number(-1))).toBe(false);
  });

  it('Element evaluation for literals', () => {
    const ce = freshEngine();
    expect(
      ce.expr(['Element', 3, ['Set', 1, 2, 3]]).evaluate().symbol
    ).toBe('True');
    expect(
      ce.expr(['Element', 5, ['Set', 1, 2, 3]]).evaluate().symbol
    ).toBe('False');
    expect(
      ce.expr(['Element', 3, ['Range', 1, 5]]).evaluate().symbol
    ).toBe('True');
  });

  it('SetMinus membership for literals', () => {
    const ce = freshEngine();
    const s = ce.expr(['SetMinus', 'ComplexNumbers', ['Set', 0]]);
    expect(s.contains(ce.number(1))).toBe(true);
    expect(s.contains(ce.number(0))).toBe(false);
    // Symbolic: indeterminate (z could be 0)
    expect(s.contains(ce.expr('z'))).toBeUndefined();
  });
});
