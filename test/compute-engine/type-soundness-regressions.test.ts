import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * Regression tests for the type-system P0 sequence SYM P0-9 … P0-16
 * (FINDINGS-TRACKER WP-2.9). One `describe` per finding.
 */

describe('SYM P0-10 — reduceType passes through numeric/symbol/expression kinds', () => {
  it('Element(x:integer<0..10>, Integers) evaluates (no crash) to True', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer<0..10>');
    // Previously threw "Unknown type kind".
    expect(ce.expr(['Element', 'x', 'Integers']).evaluate().symbol).toBe(
      'True'
    );
  });
});

describe('SYM P0-9 — negation subtype is sound both directions', () => {
  it('x: !string does not entail isInteger', () => {
    const ce = new ComputeEngine();
    ce.declare('x', '!string');
    expect(ce.symbol('x').isInteger).toBe(undefined); // not `true`
  });

  it('!A <: S only for top types', () => {
    expect(isSubtype('!integer', 'string')).toBe(false);
  });

  it('A <: !B requires A and B disjoint', () => {
    // integer<0..10> overlaps integer<5..20>, so it is NOT a subtype of its
    // complement.
    expect(isSubtype('integer<0..10>', '!integer<5..20>')).toBe(false);
    // disjoint ranges → subtype of the complement
    expect(isSubtype('integer<0..3>', '!integer<5..20>')).toBe(true);
    // integers are never strings → subtype of !string
    expect(isSubtype('integer', '!string')).toBe(true);
  });
});

describe('SYM P0-16 — assume(x ∈ ℤ) narrows via the meet, not `!isSubtype`', () => {
  const assumeInteger = (declared: string): [string, string] => {
    const ce = new ComputeEngine();
    ce.declare('q', declared);
    const r = ce.assume(
      ce.function('Element', [ce.symbol('q'), ce.symbol('Integers')])
    );
    return [r, ce.symbol('q').type.toString()];
  };

  it('finite_number ∈ ℤ → ok, narrowed to finite_integer', () => {
    const [r, t] = assumeInteger('finite_number');
    expect(r).toBe('ok');
    expect(t).toBe('finite_integer');
  });

  it('complex ∈ ℤ → ok (meet non-empty)', () => {
    const [r] = assumeInteger('complex');
    expect(r).toBe('ok');
  });

  it('string ∈ ℤ → contradiction (disjoint meet)', () => {
    const [r] = assumeInteger('string');
    expect(r).toBe('contradiction');
  });
});

describe('SYM P0-11 — Power/Root do not claim closure over negative exponents', () => {
  it('integer ^ integer is not claimed to be an integer set member', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'integer');
    ce.declare('s', 'integer');
    // r=2, s=-2 ⇒ 1/4 ∉ ℤ, so this must not be `True`.
    expect(
      ce.expr(['Element', ['Power', 'r', 's'], 'Integers']).evaluate().symbol
    ).not.toBe('True');
  });

  it('Power(2, -2) has a rational type', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Power', 2, -2]).type.matches('rational')).toBe(true);
    expect(ce.expr(['Power', 2, -2]).type.matches('integer')).toBe(false);
  });
});

describe('SYM P0-12 — finite_real is not over-claimed for poles / out-of-domain', () => {
  it('Ln(-2) is not typed real', () => {
    const ce = new ComputeEngine();
    // A negative-real logarithm is complex; isReal must not be a definitive true.
    expect(ce.expr(['Ln', -2]).isReal).not.toBe(true);
  });

  it('Csc(0) type admits complex infinity (~oo)', () => {
    const ce = new ComputeEngine();
    // Csc(0) = ~oo (typed complex); the static type must cover it.
    const t = ce.expr(['Csc', 0]).type;
    expect(t.matches('finite_real')).toBe(false);
    expect(isSubtype('complex', t.type)).toBe(true);
  });

  it('Arcsin(2) (out of domain) is not typed finite_real', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Arcsin', 2]).type.matches('finite_real')).toBe(false);
  });

  it('Sin of a real symbol is still finite_real (generic-real convention)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.expr(['Sin', 'x']).type.toString()).toBe('finite_real');
  });
});

describe('SYM P0-13 — imaginary ± imaginary is not typed imaginary', () => {
  it('Element(a - b, RealNumbers) is not False for imaginary a, b', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'imaginary');
    ce.declare('b', 'imaginary');
    // a=i, b=i ⇒ a−b = 0 ∈ ℝ, so this must not be `False`.
    expect(
      ce
        .expr(['Element', ['Subtract', 'a', 'b'], 'RealNumbers'])
        .evaluate()
        .symbol
    ).not.toBe('False');
  });
});

describe('SYM P0-15 — Multiply/Divide/Mod finiteness/NaN claims are sound', () => {
  it('0 · ∞ is not typed non_finite_number', () => {
    const ce = new ComputeEngine();
    const t = ce.expr(['Multiply', 0, 'PositiveInfinity']).type;
    // 0·∞ = NaN, only representable by `number`.
    expect(t.matches('non_finite_number')).toBe(false);
  });

  it('Mod(2, 0) is not typed finite_integer', () => {
    const ce = new ComputeEngine();
    // Mod(2,0) = NaN.
    expect(ce.expr(['Mod', 2, 0]).type.matches('finite_integer')).toBe(false);
  });

  it('Divide(∞, i) is not typed non_finite_number', () => {
    const ce = new ComputeEngine();
    const t = ce.expr(['Divide', 'PositiveInfinity', 'ImaginaryUnit']).type;
    expect(t.matches('non_finite_number')).toBe(false);
  });
});

describe('SYM P0-14 — three-valued isInteger / isRational', () => {
  const forType = (ty: string) => {
    const ce = new ComputeEngine();
    ce.declare('x', ty);
    return ce.symbol('x');
  };

  it('real → undefined (a real may be an integer)', () => {
    expect(forType('real').isInteger).toBe(undefined);
    expect(forType('real').isRational).toBe(undefined);
  });

  it('string → false (disjoint)', () => {
    expect(forType('string').isInteger).toBe(false);
    expect(forType('string').isRational).toBe(false);
  });

  it('integer → true; integer is rational', () => {
    expect(forType('integer').isInteger).toBe(true);
    expect(forType('integer').isRational).toBe(true);
  });

  it('number is consistent: isInteger and isReal are both undefined', () => {
    const x = forType('number');
    expect(x.isInteger).toBe(undefined);
    expect(x.isReal).toBe(undefined);
  });

  it('finite_real overlaps the integers → undefined', () => {
    expect(forType('finite_real').isInteger).toBe(undefined);
  });
});
