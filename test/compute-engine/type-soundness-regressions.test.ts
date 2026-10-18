import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';

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

// A float operand makes a float result. The type of a float is its value
// (`8.0` is typed `8`, an `integer`; `0.25` is typed `0.25`, which the lattice
// does not class as `rational`), so the type of a power over a float literal
// may claim `integer` when the result is an integer, but never `rational`.
describe('Power over a float literal claims the tier of its float value', () => {
  const ce = new ComputeEngine();
  ce.declare('k', 'integer<1..3>');

  // Each row: the input, the type of the power, and the evaluated value.
  test.each([
    ['(-8)^{2.0}', 'integer<64..64>', { num: '64.0' }],
    ['2^{3.0}', 'integer<8..8>', { num: '8.0' }],
    ['2.0^3', 'integer<8..8>', { num: '8.0' }],
    ['4^{0.5}', 'real<0<..>', { num: '2.0' }],
    ['2^{-2.0}', 'real<0.25..0.25>', 0.25],
    ['2.0^{-2}', 'real<0.25..0.25>', 0.25],
    ['(\\frac12)^{3.0}', 'real<0.125..0.125>', 0.125],
    ['(-8)^{1/3}', 'real', -2],
    ['\\sqrt{4.0}', 'real', { num: '2.0' }],
  ])('%s', (latex, type, value) => {
    const e = ce.parse(latex);
    const v = e.evaluate();
    expect(e.type.toString()).toBe(type);
    expect(v.json).toEqual(value);
    // The claimed type admits the value: the value's own type is a subtype.
    expect(v.type.matches(e.type)).toBe(true);
  });

  it('a float exponent does not make the quotient tier rational', () => {
    // `3^(−1.0)` evaluates to the float `0.333…`, not the exact `1/3`.
    const e = ce.box(['Power', 3, { num: '-1.0' }]);
    expect(e.type.toString()).toBe('real<0.3333..0.3334>');
    expect(e.type.matches('rational')).toBe(false);
    expect(e.evaluate().type.matches('rational')).toBe(false);
  });

  it('a ranged integer base with a float exponent', () => {
    // An integer-valued float exponent keeps the integer interval: every
    // value of `k^(2.0)` is an integer-valued float, typed `integer`.
    expect(ce.box(['Power', 'k', { num: '2.0' }]).type.toString()).toBe(
      'integer<1..9>'
    );
    // A negative float exponent gives a float that need not be an integer,
    // so the tier is `real`; the exact exponent keeps `rational`.
    expect(ce.box(['Power', 'k', { num: '-1.0' }]).type.toString()).toBe(
      'real<0.3333..1>'
    );
    expect(ce.box(['Power', 'k', -1]).type.toString()).toBe(
      'rational<0.3333..1>'
    );
  });
});

// The same rule for the other heads that claim `rational` for exact
// operands: a float literal operand with an integer value (`4.0`) makes a
// float result, and a float that is not an integer is `real`.
describe('Arithmetic over a float literal claims the tier of its float value', () => {
  const ce = new ComputeEngine();
  ce.declare('k', 'integer<1..3>');
  ce.declare('z', 'integer');
  ce.declare('p', 'tuple<integer, integer>');
  const third = ['Rational', 1, 3];
  const f = (num: string) => ({ num });

  // Each row: the input and the type of the expression. A literal type
  // that no double holds is a compact enclosure rounded to two digits
  // (`real<1.3..1.4>` for the float 1.333…), which is wider than the
  // handler's own range, so the check reads the value as a double: the
  // type of that double must be a subtype of the claimed type.
  test.each([
    [['Divide', 6, f('4.0')], 'real<1.5..1.5>'],
    [['Divide', f('4.0'), 3], 'real<1.333..1.334>'],
    [['Divide', 'k', f('4.0')], 'real<0.25..0.75>'],
    [['Divide', f('4.0'), 'k'], 'real<1.333..4>'],
    [['Divide', 'z', f('4.0')], 'real'],
    [['Divide', 'p', f('4.0')], 'tuple<real, real>'],
    [['Multiply', third, f('4.0')], 'real<1.32..1.36>'],
    [['Multiply', third, f('2.0')], 'real<0.66..0.68>'],
    [['Add', f('-4.0'), third], 'real<-3.671..-3.659>'],
    [['Mod', f('5.0'), ['Rational', 3, 2]], 'real'],
    [['Mod', ['Rational', 7, 2], f('2.0')], 'real'],
    [['Remainder', f('5.0'), ['Rational', 3, 2]], 'real'],
    [['Remainder', ['Rational', 7, 2], f('2.0')], 'real'],
    // A step with an integer value makes a multiple of an integer, and a
    // float `x` over an exact step rounds to an exact value: rounding keeps
    // its claims.
    [['Floor', ['Rational', 7, 2], f('2.0')], 'integer'],
    [['Floor', f('2.5'), third], 'rational'],
  ] as const)('%j', (json, type) => {
    const e = ce.box(json as any);
    expect(e.type.toString()).toBe(type);
    const v = e.evaluate();
    // An expression over an unassigned symbol stays symbolic: no value.
    if (!v.isNumberLiteral) return;
    const valueType = v.isExact ? v.type : ce.number(v.re).type;
    expect(valueType.matches(e.type)).toBe(true);
  });

  it('a symbolic quotient takes a float value once the symbol is assigned', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('p', 'tuple<integer, integer>');
    ce2.assign('p', ce2.box(['Tuple', 1, 2]));
    const v = ce2.box(['Divide', 'p', f('4.0')]).evaluate();
    expect(v.json).toEqual(['Tuple', 0.25, 0.5]);
    expect(v.type.toString()).toBe('tuple<real, real>');
  });

  // A `Subtract` that is not canonicalized is typed by its own handler, as
  // the sum of the minuend and the negated subtrahends: on the derivation
  // from operand descriptors (`deriveApplicationType`) and for a structural
  // `Subtract`. The negation of the float `2.0` is a float, so
  // `1/3 − 2.0` is the float `−1.666…`, typed `real`, not `rational`.
  test.each([
    [third, f('2.0')],
    [f('2.0'), third],
  ] as const)(
    'Subtract(%j, %j) on the derivation and structural routes',
    (a, b) => {
      const ops = [ce.box(a as any), ce.box(b as any)];
      const derived = deriveApplicationType(
        ce,
        'Subtract',
        ops.map((x) => describeOperand(x))
      );
      const structural = ce.function('Subtract', ops, { form: 'structural' });
      const v = structural.evaluate();
      expect(v.isExact).toBe(false);
      const valueType = ce.number(v.re).type;
      expect(derived).toBeDefined();
      expect(valueType.matches(ce.type(typeToString(derived!)))).toBe(true);
      expect(valueType.matches(structural.type)).toBe(true);
      expect(structural.type.matches('rational')).toBe(false);
    }
  );

  // A tuple literal with a float component divided by an integer: each
  // component of the quotient is a float, typed `real`. The type of the
  // tuple (`tuple<integer, integer>`) cannot tell `(2.0, 4.0)` from
  // `(2, 4)`; its structural view can.
  test('a shaped quotient of a tuple literal of floats has real components', () => {
    const num = ce.box(['Tuple', f('2.0'), f('4.0')]);
    const derived = deriveApplicationType(ce, 'Divide', [
      describeOperand(num),
      describeOperand(ce.number(3)),
    ]);
    expect(derived && typeToString(derived)).toBe('tuple<real, real>');
    const structural = ce.function('Divide', [num, ce.number(3)], {
      form: 'structural',
    });
    expect(structural.type.toString()).toBe('tuple<real, real>');
    const v = structural.evaluate();
    expect(v.operator).toBe('Tuple');
    expect(v.ops!.map((x) => x.isExact)).toEqual([false, false]);
    expect(v.type.matches(structural.type)).toBe(true);
    // Exact components keep the `rational` tier.
    expect(
      ce
        .function('Divide', [ce.box(['Tuple', 2, 4]), ce.number(3)], {
          form: 'structural',
        })
        .type.toString()
    ).toBe('tuple<rational, rational>');
  });

  // Exact operands keep the `rational` tier.
  test.each([
    [['Divide', 6, 4], 'rational<1.5..1.5>'],
    [['Divide', 'k', 4], 'rational<0.25..0.75>'],
    [['Divide', 'p', 4], 'tuple<rational, rational>'],
    [['Multiply', third, 4], 'rational<1.3..1.4>'],
    [['Add', -4, third], 'rational<-3.7..-3.6>'],
    [['Mod', 5, ['Rational', 3, 2]], 'rational'],
  ] as const)('exact %j', (json, type) => {
    expect(ce.box(json as any).type.toString()).toBe(type);
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
      ce.expr(['Element', ['Subtract', 'a', 'b'], 'RealNumbers']).evaluate()
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
  // propagated `nan` arm. Since 2026-10-17 the carrier also admits `~oo`
  // (`Round(~oo)` is `~oo`), so an undeclared symbol is inferred
  // `real | signed_infinity | ~oo` and its claims have the `~oo` arm. A
  // maybe-NaN operand still carries the
  // propagated `nan` arm. The original item-89 concern — a MORE
  // informative operand must never produce a WEAKER claim — still holds
  // on the flipped claims and stays pinned below.
  it('Round of a literal, a bare symbol and an arithmetic term all agree', () => {
    expect(typeOf('\\mathrm{Round}(4.7)')).toBe('integer');
    // `Q` is inferred `real | signed_infinity | ~oo` from the carrier (the
    // carrier admits `~oo` since 2026-10-17, and `Round(~oo)` is `~oo`), so
    // the claim is `integer | +oo | -oo | ~oo`, which reduces to
    // `infinity | integer`. `4Q` is typed `number` (the `Multiply` type
    // handler claims `number` for an operand that may be `~oo`), which
    // admits `NaN`, so its rounding adds the `nan` arm: the operand with
    // less information gets the weaker type.
    expect(typeOf('\\mathrm{Round}(Q)')).toBe('infinity | integer');
    expect(typeOf('\\mathrm{Round}(4Q)')).toBe('infinity | integer | nan');
  });

  it('Floor/Ceil follow', () => {
    expect(typeOf('\\lfloor 4Q \\rfloor')).toBe('infinity | integer | nan');
    expect(typeOf('\\lceil 4Q \\rceil')).toBe('infinity | integer | nan');
  });

  it('a PROVABLY non-real argument is a boxing error now', () => {
    expect(ce.parse('\\mathrm{Round}(1.2+3.4i)').isValid).toBe(false);
    expect(ce.parse('\\mathrm{Round}(i)').isValid).toBe(false);
  });

  it('a step that is not an integer never claims integer, whatever the finiteness', () => {
    // `Round(x, step)` is a multiple of the step: with a non-integer step,
    // the result is a rational (an exact step) or a real (a float step),
    // never an integer, also for `x: real` of unknown finiteness. With an
    // integer step, the result is an integer.
    // (`xr`/`xf` parse as juxtaposition PRODUCTS of undeclared symbols —
    // they always have — so those rows exercise a maybe-NaN compound
    // operand, which now honestly carries the propagated `nan` arm.)
    ce.declare('xr', 'real');
    ce.declare('xf', 'real');
    // The operands below may be `~oo`, so each claim has the `~oo` arm,
    // and `signed_infinity | ~oo` reduces to `infinity`.
    expect(typeOf('\\mathrm{Round}(xr, 0.01)')).toBe('infinity | nan | real');
    expect(typeOf('\\mathrm{Round}(xf, \\frac{1}{100})')).toBe(
      'infinity | nan | rational'
    );
    expect(typeOf('\\mathrm{Round}(xr, 2)')).toBe('infinity | integer | nan');
    expect(typeOf('\\mathrm{Round}(Q, 0.01)')).toBe('infinity | real');
    expect(typeOf('\\mathrm{Round}(3.14159, 0.01)')).toBe('real');
    expect(ce.parse('\\mathrm{Round}(1.2+3.4i, 0.01)').isValid).toBe(false);
    expect(typeOf('\\mathrm{Round}(\\infty, 0.01)')).toBe('signed_infinity');
  });

  it('the non-finite and NaN claims', () => {
    expect(typeOf('\\mathrm{Round}(\\infty)')).toBe('signed_infinity');
    // A proven-NaN argument in the propagate slot types exactly `nan`.
    expect(typeOf('\\mathrm{Round}(\\mathrm{NaN})')).toBe('nan');
  });

  it('a step that is not an integer gives a real or a rational, not an integer', () => {
    expect(typeOf('\\mathrm{Round}(4.7, 0.01)')).toBe('real');
    expect(typeOf('\\mathrm{Round}(4.7, \\frac{1}{100})')).toBe('rational');
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
