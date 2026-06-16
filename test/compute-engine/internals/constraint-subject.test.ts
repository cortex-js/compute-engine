import { ComputeEngine } from '../../../src/compute-engine';
import {
  subjectOf,
  subjectKey,
  toSubject,
  matchesSubject,
  getFactIndex,
} from '../../../src/compute-engine/boxed-expression/constraint-subject';
import { getInequalityBoundsFromAssumptions } from '../../../src/compute-engine/boxed-expression/inequality-bounds';
import { getSignFromAssumptions } from '../../../src/compute-engine/assume';

import '../../utils'; // For snapshot serializers

// NOTE (P1): `assume()` does not yet accept part-predicates like
// `Re(s) > 1` without destructively retyping `s` (that's P2). These tests
// therefore insert pre-normalized facts directly into
// `ce.context.assumptions` — the same normal form `assume()` will store in
// P2: `Less/LessEqual(lhs - rhs, 0)` with the subject term in the lhs.

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

describe('subjectOf', () => {
  const ce = freshEngine();

  it('recognizes a bare symbol', () => {
    expect(subjectOf(ce.expr('x'))).toEqual({ symbol: 'x', part: 'self' });
  });

  it('recognizes Real(z)', () => {
    expect(subjectOf(ce.expr(['Real', 'z']))).toEqual({
      symbol: 'z',
      part: 're',
    });
  });

  it('recognizes Imaginary(tau)', () => {
    expect(subjectOf(ce.expr(['Imaginary', 'tau']))).toEqual({
      symbol: 'tau',
      part: 'im',
    });
  });

  it('recognizes Abs(q)', () => {
    expect(subjectOf(ce.expr(['Abs', 'q']))).toEqual({
      symbol: 'q',
      part: 'abs',
    });
  });

  it('recognizes Argument(z)', () => {
    expect(subjectOf(ce.expr(['Argument', 'z']))).toEqual({
      symbol: 'z',
      part: 'arg',
    });
  });

  it('rejects Real of a compound expression', () => {
    expect(subjectOf(ce.expr(['Real', ['Add', 'z', 'w']]))).toBeUndefined();
  });

  it('rejects nested part extractors', () => {
    expect(subjectOf(ce.expr(['Abs', ['Real', 'z']]))).toBeUndefined();
  });

  it('rejects Abs of a literal', () => {
    // Use a non-canonical box so Abs(-2) is not folded to 2
    expect(
      subjectOf(ce.expr(['Abs', -2], { canonical: false }))
    ).toBeUndefined();
  });

  it('rejects a number literal', () => {
    expect(subjectOf(ce.expr(42))).toBeUndefined();
  });

  it('rejects other function expressions', () => {
    expect(subjectOf(ce.expr(['Sin', 'x']))).toBeUndefined();
  });
});

describe('subjectKey', () => {
  it('produces stable keys', () => {
    expect(subjectKey({ symbol: 'x', part: 'self' })).toBe('self:x');
    expect(subjectKey({ symbol: 's', part: 're' })).toBe('re:s');
    expect(subjectKey({ symbol: 'tau', part: 'im' })).toBe('im:tau');
    expect(subjectKey({ symbol: 'q', part: 'abs' })).toBe('abs:q');
    expect(subjectKey({ symbol: 'z', part: 'arg' })).toBe('arg:z');
  });

  it('round-trips through subjectOf', () => {
    const ce = freshEngine();
    const s = subjectOf(ce.expr(['Real', 's']))!;
    expect(subjectKey(s)).toBe('re:s');
    // Same expression boxed again yields the same key
    expect(subjectKey(subjectOf(ce.expr(['Real', 's']))!)).toBe('re:s');
  });
});

describe('toSubject / matchesSubject', () => {
  const ce = freshEngine();

  it('toSubject converts a string to a self subject', () => {
    expect(toSubject('x')).toEqual({ symbol: 'x', part: 'self' });
  });

  it('toSubject passes through a Subject', () => {
    const s = { symbol: 's', part: 're' } as const;
    expect(toSubject(s)).toBe(s);
  });

  it('matchesSubject matches the exact subject term only', () => {
    const re_s = { symbol: 's', part: 're' } as const;
    expect(matchesSubject(ce.expr(['Real', 's']), re_s)).toBe(true);
    expect(matchesSubject(ce.expr(['Imaginary', 's']), re_s)).toBe(false);
    expect(matchesSubject(ce.expr(['Real', 't']), re_s)).toBe(false);
    expect(matchesSubject(ce.expr('s'), re_s)).toBe(false);
    expect(matchesSubject(ce.expr('s'), { symbol: 's', part: 'self' })).toBe(
      true
    );
  });
});

describe('getInequalityBoundsFromAssumptions (symbol overload, unchanged)', () => {
  it('extracts a lower bound from x > 4', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.lower?.isSame(4)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
    expect(bounds.upper).toBeUndefined();
  });

  it('extracts an upper bound from x <= 10', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['LessEqual', 'x', 10]));
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.upper?.isSame(10)).toBe(true);
    expect(bounds.upperStrict).toBe(false);
    expect(bounds.lower).toBeUndefined();
  });

  it('extracts a zero lower bound from x > 0', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 0]));
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.lower?.isSame(0)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
  });

  it('keeps the tightest bound', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 2]));
    ce.assume(ce.expr(['Greater', 'x', 5]));
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(bounds.lower?.isSame(5)).toBe(true);
  });

  it('returns empty bounds when there are no assumptions', () => {
    const ce = freshEngine();
    expect(getInequalityBoundsFromAssumptions(ce, 'x')).toEqual({});
  });
});

describe('getInequalityBoundsFromAssumptions (subject overload)', () => {
  it('extracts bounds for Re(s) from a stored part-inequality', () => {
    const ce = freshEngine();
    // Re(s) > 1, normalized as Less(1 - Real(s), 0)
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 's',
      part: 're',
    });
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
    expect(bounds.upper).toBeUndefined();
  });

  it('extracts bounds for Abs(q) from a stored part-inequality', () => {
    const ce = freshEngine();
    // Abs(q) < 1, normalized as Less(Abs(q) - 1, 0)
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', ['Abs', 'q'], 1], 0]),
      true
    );
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 'q',
      part: 'abs',
    });
    expect(bounds.upper?.isSame(1)).toBe(true);
    expect(bounds.upperStrict).toBe(true);
    expect(bounds.lower).toBeUndefined();
  });

  it('extracts a zero bound for Imaginary(tau) > 0', () => {
    const ce = freshEngine();
    // Im(tau) > 0, normalized as Less(Negate(Imaginary(tau)), 0)
    ce.context.assumptions.set(
      ce.expr(['Less', ['Negate', ['Imaginary', 'tau']], 0]),
      true
    );
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 'tau',
      part: 'im',
    });
    expect(bounds.lower?.isSame(0)).toBe(true);
    expect(bounds.lowerStrict).toBe(true);
  });

  it('part facts do not leak to the bare symbol (and vice versa)', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    // No facts about `s` itself
    expect(getInequalityBoundsFromAssumptions(ce, 's')).toEqual({});
    // No facts about Imaginary(s)
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 's', part: 'im' })
    ).toEqual({});
  });

  it('a self subject behaves like the string overload', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const viaString = getInequalityBoundsFromAssumptions(ce, 'x');
    const viaSubject = getInequalityBoundsFromAssumptions(ce, {
      symbol: 'x',
      part: 'self',
    });
    expect(viaSubject.lower?.isSame(viaString.lower!)).toBe(true);
    expect(viaSubject.lowerStrict).toBe(viaString.lowerStrict);
  });
});

describe('getSignFromAssumptions (symbol overload, unchanged)', () => {
  it('x > 0 implies positive', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 0]));
    expect(getSignFromAssumptions(ce, 'x')).toBe('positive');
  });

  it('x <= 0 implies non-positive', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['LessEqual', 'x', 0]));
    expect(getSignFromAssumptions(ce, 'x')).toBe('non-positive');
  });

  it('x > 4 implies positive', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    expect(getSignFromAssumptions(ce, 'x')).toBe('positive');
  });

  it('no assumptions implies undefined', () => {
    const ce = freshEngine();
    expect(getSignFromAssumptions(ce, 'x')).toBeUndefined();
  });
});

describe('getSignFromAssumptions (subject overload)', () => {
  it('Im(tau) > 0 implies Imaginary(tau) is positive', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Negate', ['Imaginary', 'tau']], 0]),
      true
    );
    expect(getSignFromAssumptions(ce, { symbol: 'tau', part: 'im' })).toBe(
      'positive'
    );
    // ... but says nothing about tau itself
    expect(getSignFromAssumptions(ce, 'tau')).toBeUndefined();
  });

  it('Re(s) > 1 implies Real(s) is positive', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    expect(getSignFromAssumptions(ce, { symbol: 's', part: 're' })).toBe(
      'positive'
    );
  });

  it('Real(s) <= 0 implies Real(s) is non-positive', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(ce.expr(['LessEqual', ['Real', 's'], 0]), true);
    expect(getSignFromAssumptions(ce, { symbol: 's', part: 're' })).toBe(
      'non-positive'
    );
  });
});

describe('fact index', () => {
  it('returns a shared empty index when there are no assumptions', () => {
    const ce = freshEngine();
    const idx1 = getFactIndex(ce);
    const idx2 = getFactIndex(ce);
    expect(idx1.bySubject.size).toBe(0);
    expect(idx1.membership.size).toBe(0);
    expect(idx2).toBe(idx1);
  });

  it('returns the same cached object when nothing changed', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const idx1 = getFactIndex(ce);
    const idx2 = getFactIndex(ce);
    expect(idx2).toBe(idx1);
    expect(idx1.bySubject.get('self:x')?.bounds.lower?.isSame(4)).toBe(true);
  });

  it('is rebuilt after a new assumption', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const idx1 = getFactIndex(ce);
    ce.assume(ce.expr(['Less', 'y', 0]));
    const idx2 = getFactIndex(ce);
    expect(idx2).not.toBe(idx1);
    expect(idx2.bySubject.get('self:y')?.bounds.upper?.isSame(0)).toBe(true);
    // Previous facts still present
    expect(idx2.bySubject.get('self:x')?.bounds.lower?.isSame(4)).toBe(true);
  });

  it('is rebuilt after a direct insertion into the assumptions map', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const idx1 = getFactIndex(ce);
    // Direct .set() does not bump the generation counter; the index relies
    // on the entry count to detect this kind of mutation.
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    const idx2 = getFactIndex(ce);
    expect(idx2).not.toBe(idx1);
    expect(idx2.bySubject.get('re:s')?.bounds.lower?.isSame(1)).toBe(true);
  });

  it('indexes NotEqual facts by subject', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['NotEqual', 'z', 0], { canonical: false }),
      true
    );
    ce.context.assumptions.set(
      ce.expr(['NotEqual', ['Real', 's'], 1], { canonical: false }),
      true
    );
    const idx = getFactIndex(ce);
    const zFacts = idx.bySubject.get('self:z');
    expect(zFacts?.notEqual).toHaveLength(1);
    expect(zFacts?.notEqual[0].isSame(0)).toBe(true);
    const reSFacts = idx.bySubject.get('re:s');
    expect(reSFacts?.notEqual).toHaveLength(1);
    expect(reSFacts?.notEqual[0].isSame(1)).toBe(true);
  });

  it('indexes Element/NotElement membership facts by symbol', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['Element', 'x', 'AlgebraicNumbers'], { canonical: false }),
      true
    );
    ce.context.assumptions.set(
      ce.expr(['NotElement', 'x', 'RealNumbers'], { canonical: false }),
      true
    );
    const idx = getFactIndex(ce);
    const m = idx.membership.get('x');
    expect(m?.in).toHaveLength(1);
    expect(m?.in[0].symbol).toBe('AlgebraicNumbers');
    expect(m?.notIn).toHaveLength(1);
    expect(m?.notIn[0].symbol).toBe('RealNumbers');
  });

  it('merges bounds from multiple assumptions on the same subject', () => {
    const ce = freshEngine();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', ['Real', 's'], 10], 0]),
      true
    );
    const bounds = getInequalityBoundsFromAssumptions(ce, {
      symbol: 's',
      part: 're',
    });
    expect(bounds.lower?.isSame(1)).toBe(true);
    expect(bounds.upper?.isSame(10)).toBe(true);
  });

  it('returns a fresh copy of bounds (no aliasing of the index)', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    const bounds = getInequalityBoundsFromAssumptions(ce, 'x');
    bounds.lower = ce.expr(99);
    const again = getInequalityBoundsFromAssumptions(ce, 'x');
    expect(again.lower?.isSame(4)).toBe(true);
  });
});

describe('scope behavior', () => {
  it('assumptions made in a pushed scope disappear on pop', () => {
    const ce = freshEngine();
    ce.pushScope();
    ce.assume(ce.expr(['Greater', 'q', 2]));
    expect(
      getInequalityBoundsFromAssumptions(ce, 'q').lower?.isSame(2)
    ).toBe(true);
    ce.popScope();
    expect(getInequalityBoundsFromAssumptions(ce, 'q')).toEqual({});
  });

  it('part facts made in a pushed scope disappear on pop', () => {
    const ce = freshEngine();
    ce.pushScope();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 's']], 0]),
      true
    );
    expect(
      getInequalityBoundsFromAssumptions(ce, {
        symbol: 's',
        part: 're',
      }).lower?.isSame(1)
    ).toBe(true);
    ce.popScope();
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 's', part: 're' })
    ).toEqual({});
  });

  it('parent-scope assumptions are visible in a child scope', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    ce.pushScope();
    expect(
      getInequalityBoundsFromAssumptions(ce, 'x').lower?.isSame(4)
    ).toBe(true);
    ce.popScope();
  });

  it('forget removes facts about a symbol, including part facts', () => {
    const ce = freshEngine();
    ce.assume(ce.expr(['Greater', 'x', 4]));
    ce.context.assumptions.set(
      ce.expr(['Less', ['Subtract', 1, ['Real', 'x']], 0]),
      true
    );
    expect(
      getInequalityBoundsFromAssumptions(ce, 'x').lower?.isSame(4)
    ).toBe(true);
    expect(
      getInequalityBoundsFromAssumptions(ce, {
        symbol: 'x',
        part: 're',
      }).lower?.isSame(1)
    ).toBe(true);

    // forget() deletes every assumption that *contains* the symbol, so
    // part facts (whose subject term contains `x`) are removed too.
    ce.forget('x');

    expect(getInequalityBoundsFromAssumptions(ce, 'x')).toEqual({});
    expect(
      getInequalityBoundsFromAssumptions(ce, { symbol: 'x', part: 're' })
    ).toEqual({});
  });

  it('getSignFromAssumptions respects scope pop', () => {
    const ce = freshEngine();
    ce.pushScope();
    ce.context.assumptions.set(
      ce.expr(['Less', ['Negate', ['Imaginary', 'tau']], 0]),
      true
    );
    expect(getSignFromAssumptions(ce, { symbol: 'tau', part: 'im' })).toBe(
      'positive'
    );
    ce.popScope();
    expect(
      getSignFromAssumptions(ce, { symbol: 'tau', part: 'im' })
    ).toBeUndefined();
  });
});
