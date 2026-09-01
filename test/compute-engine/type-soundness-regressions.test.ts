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

  it('number ∈ ℤ → ok, narrowed to integer', () => {
    // `integer` sits below `number`, so the meet is `integer` itself. The old
    // check asked for `isSubtype(assumed, declared)` in the wrong direction
    // and reported a contradiction here.
    const [r, t] = assumeInteger('number');
    expect(r).toBe('ok');
    expect(t).toBe('integer');
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

describe('SYM P0-12 — real is not over-claimed for poles / out-of-domain', () => {
  it('Ln(-2) is not typed real', () => {
    const ce = new ComputeEngine();
    // A negative-real logarithm is complex; isExtendedReal must not be a definitive true.
    expect(ce.expr(['Ln', -2]).isExtendedReal).not.toBe(true);
  });

  it('Csc(0) type admits complex infinity (~oo)', () => {
    const ce = new ComputeEngine();
    // Csc(0) = ~oo (typed complex); the static type must cover it.
    const t = ce.expr(['Csc', 0]).type;
    expect(t.matches('real')).toBe(false);
    expect(isSubtype('complex', t.type)).toBe(true);
  });

  it('Arcsin(2) (out of domain) is not typed real', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Arcsin', 2]).type.matches('real')).toBe(false);
  });

  it('Sin of a real symbol is still real (generic-real convention)', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    expect(ce.expr(['Sin', 'x']).type.toString()).toBe('real');
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
  it('0 · ∞ is not typed signed_infinity', () => {
    const ce = new ComputeEngine();
    const t = ce.expr(['Multiply', 0, 'PositiveInfinity']).type;
    // 0·∞ = NaN, only representable by `number`.
    expect(t.matches('signed_infinity')).toBe(false);
  });

  it('Mod(2, 0) is not typed integer', () => {
    const ce = new ComputeEngine();
    // Mod(2,0) = NaN.
    expect(ce.expr(['Mod', 2, 0]).type.matches('integer')).toBe(false);
  });

  it('Divide(∞, i) is not typed signed_infinity', () => {
    const ce = new ComputeEngine();
    const t = ce.expr(['Divide', 'PositiveInfinity', 'ImaginaryUnit']).type;
    expect(t.matches('signed_infinity')).toBe(false);
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

  it('number is consistent: isInteger and isExtendedReal are both undefined', () => {
    const x = forType('number');
    expect(x.isInteger).toBe(undefined);
    expect(x.isExtendedReal).toBe(undefined);
  });

  it('real overlaps the integers → undefined', () => {
    expect(forType('real').isInteger).toBe(undefined);
  });
});

describe('Tycho item 89 — rounding a symbolic number stays integer-valued', () => {
  const ce = new ComputeEngine();
  const typeOf = (s: string) => ce.parse(s).type.toString();

  // The family took its Phase F Contract B flip (2026-08-31): each
  // operator declares `(real | signed_infinity)`, so a proven off-carrier
  // operand (a complex value) is a boxing error, an undeclared symbol is
  // inferred extended-real from the carrier and claims
  // `integer | signed_infinity`, and a maybe-NaN operand carries the
  // propagated `nan` arm. The original item-89 concern — a MORE
  // informative operand must never produce a WEAKER claim — still holds
  // on the flipped claims and stays pinned below.
  it('Round of a literal, a bare symbol and an arithmetic term all agree', () => {
    expect(typeOf('\\mathrm{Round}(4.7)')).toBe('integer');
    // `Q` is inferred `real | signed_infinity` from the carrier, so the
    // claim is the mixed-finiteness union; the finite product `4Q` then
    // sharpens back to `integer` — more information, sharper type.
    expect(typeOf('\\mathrm{Round}(Q)')).toBe('integer | signed_infinity');
    expect(typeOf('\\mathrm{Round}(4Q)')).toBe('integer');
  });

  it('Floor/Ceil follow', () => {
    expect(typeOf('\\lfloor 4Q \\rfloor')).toBe('integer');
    expect(typeOf('\\lceil 4Q \\rceil')).toBe('integer');
  });

  it('a PROVABLY non-real argument is a boxing error now', () => {
    expect(ce.parse('\\mathrm{Round}(1.2+3.4i)').isValid).toBe(false);
    expect(ce.parse('\\mathrm{Round}(i)').isValid).toBe(false);
  });

  it('a precision argument never claims integer, whatever the finiteness', () => {
    // `Round(x, 2)` with `x: real` (finiteness unknown) used to fall through
    // to the integer claim while evaluating to `3.14`-like rationals.
    // (`xr`/`xf` parse as juxtaposition PRODUCTS of undeclared symbols —
    // they always have — so those rows exercise a maybe-NaN compound
    // operand, which now honestly carries the propagated `nan` arm.)
    ce.declare('xr', 'real');
    ce.declare('xf', 'real');
    expect(typeOf('\\mathrm{Round}(xr, 2)')).toBe(
      'nan | real | signed_infinity'
    );
    expect(typeOf('\\mathrm{Round}(xf, 2)')).toBe(
      'nan | real | signed_infinity'
    );
    expect(typeOf('\\mathrm{Round}(Q, 2)')).toBe('real | signed_infinity');
    expect(typeOf('\\mathrm{Round}(3.14159, 2)')).toBe('real');
    expect(ce.parse('\\mathrm{Round}(1.2+3.4i, 2)').isValid).toBe(false);
    expect(typeOf('\\mathrm{Round}(\\infty, 2)')).toBe('signed_infinity');
  });

  it('the non-finite and NaN claims', () => {
    expect(typeOf('\\mathrm{Round}(\\infty)')).toBe('signed_infinity');
    // A proven-NaN argument in the propagate slot types exactly `nan`.
    expect(typeOf('\\mathrm{Round}(\\mathrm{NaN})')).toBe('nan');
  });

  it('a precision argument still gives a real, not an integer', () => {
    expect(typeOf('\\mathrm{Round}(4.7, 2)')).toBe('real');
  });
});

describe('Tycho item 92 — a union is assignable only when EVERY arm is', () => {
  const ce = new ComputeEngine();

  it('a union does not match a single arm, whatever the SHAPE of the target', () => {
    // Composite target (was any-branch: `true`) and primitive target
    // (already all-branch) now answer the same question the same way.
    const t = ce.type(
      'list<tuple<number,number,number>> | tuple<number,number,number>'
    );
    expect(t.matches('tuple<number, number, number>')).toBe(false);
    expect(t.matches('list<unknown>')).toBe(false);
    expect(ce.type('number | list<number>').matches('number')).toBe(false);
  });

  it('a union matches a target that covers every arm', () => {
    expect(
      ce
        .type('list<tuple<number,number,number>> | tuple<number,number,number>')
        .matches('collection')
    ).toBe(true);
    expect(
      ce.type('number | list<number>').matches('collection | number')
    ).toBe(true);
    expect(ce.type('integer | real').matches('real')).toBe(true);
    expect(ce.type('list<integer> | list<real>').matches('list<real>')).toBe(
      true
    );
  });

  it('a matrix-accepting UNION parameter still drives matrix repair', () => {
    // `LinearSolve`'s first parameter is `matrix | vector`: the repair asks
    // whether a matrix would satisfy the parameter, not whether the parameter
    // is itself a matrix.
    const engine = new ComputeEngine();
    engine.declare('M', 'matrix');
    expect(engine.box(['LinearSolve', 'M', ['Add', 'A', 'B']]).isValid).toBe(
      true
    );
  });
});
