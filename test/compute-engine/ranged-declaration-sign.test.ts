import { ComputeEngine } from '../../src/compute-engine';

// A RANGED declaration carries a sign. `BoxedSymbol.sgn` answers from the
// held value, else the assumptions, and — since the 2026-08-22 change this
// file pins — else from the declared type: `integer<1..>` is positive,
// `real<0..>` non-negative, `real<..0>` non-positive, and the intersection
// spelling of "positive", `real<0..> & !0`, combines a bound with the zero
// exclusion. Before that read existed, a range-typed declaration answered
// `sgn: undefined`, so `Sqrt(q)` with `q: integer<1..>` typed
// `complex` — the declaration's sign never reached the sign channel.
// (ROADMAP: "Ranged types should carry sign (and a literal's value) through
// type derivation"; plan doc §5.8 A1.)

describe('sign of a ranged declaration', () => {
  const ce = new ComputeEngine();
  ce.declare('p', 'integer<1..>');
  ce.declare('q', 'real<0..>');
  ce.declare('r', 'real<..0>');
  ce.declare('s', 'real<0..> & !0');
  ce.declare('z', 'integer<0..0>');
  ce.declare('u', '1 | 2');
  ce.declare('w', 'real<-1..1>');
  ce.declare('nz', '!0');

  test('a positive lower bound proves positive', () => {
    expect(ce.symbol('p').sgn).toBe('positive');
    expect(ce.symbol('p').isPositive).toBe(true);
    expect(ce.symbol('p').isNonNegative).toBe(true);
  });

  test('a zero lower bound proves non-negative, not positive', () => {
    expect(ce.symbol('q').sgn).toBe('non-negative');
    expect(ce.symbol('q').isPositive).toBe(undefined);
    expect(ce.symbol('q').isNonNegative).toBe(true);
  });

  test('a zero upper bound proves non-positive', () => {
    expect(ce.symbol('r').sgn).toBe('non-positive');
    expect(ce.symbol('r').isNegative).toBe(undefined);
    expect(ce.symbol('r').isPositive).toBe(false);
  });

  test('the intersection spelling of "positive" proves positive', () => {
    expect(ce.symbol('s').sgn).toBe('positive');
    expect(ce.symbol('s').isPositive).toBe(true);
  });

  test('a degenerate range proves zero; a union joins its members', () => {
    expect(ce.symbol('z').sgn).toBe('zero');
    expect(ce.symbol('u').sgn).toBe('positive');
  });

  test('a bare negation proves nothing — `!0` admits strings and NaN', () => {
    expect(ce.symbol('nz').sgn).toBe(undefined);
    // The zero exclusion becomes usable only next to a NaN-free real
    // domain: `integer & !0` is not-zero, `string & !0` is nothing.
    ce.declare('nzi', 'integer & !0');
    expect(ce.symbol('nzi').sgn).toBe('not-zero');
    ce.declare('nzs', 'string & !0');
    expect(ce.symbol('nzs').sgn).toBe(undefined);
  });

  test('a sign-undecided range and a NaN-admitting type stay undecided', () => {
    // `real<-1..1>` admits both signs; `number` admits NaN, which has no
    // sign — neither may claim one.
    expect(ce.symbol('w').sgn).toBe(undefined);
    ce.declare('nn', 'number');
    expect(ce.symbol('nn').sgn).toBe(undefined);
  });

  test('a held value still wins over the declaration', () => {
    ce.declare('v', 'integer<1..>');
    ce.assign('v', 3);
    expect(ce.symbol('v').sgn).toBe('positive');
    expect(ce.symbol('v').value?.toString()).toBe('3');
  });

  test('an assumption still wins where it is more precise', () => {
    // The declaration alone says nothing (`real`); the assumption decides.
    ce.declare('a', 'real');
    ce.assume(ce.parse('a > 0'));
    expect(ce.symbol('a').sgn).toBe('positive');
  });
});

describe('an assumption refines the symbol type to a range (§5.8 A2)', () => {
  test('assume on an explicitly declared symbol narrows by meet', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.assume(ce.parse('p > 0'));
    expect(ce.symbol('p').type.toString()).toBe('real<0<..>');
    expect(ce.symbol('p').sgn).toBe('positive');
    // The meet pushes the range into a narrower declared base.
    ce.declare('n', 'integer');
    ce.assume(ce.parse('n > 0'));
    expect(ce.symbol('n').type.toString()).toBe('integer<1..>');
    expect(ce.box(['Factorial', 'n']).type.toString()).toBe('integer');
  });

  test('assume on an undeclared symbol declares the range', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('q \\geq 2'));
    // A strict non-zero bound would be approximated by its closed range
    // (`real<2..>`); the non-strict one here is exact.
    expect(ce.symbol('q').type.toString()).toBe('real<2..>');
    expect(ce.symbol('q').sgn).toBe('positive');
  });

  test('a contradiction with the declaration refuses and leaves the type', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real<..-1>');
    expect(ce.assume(ce.parse('r > 0'))).toBe('contradiction');
    expect(ce.symbol('r').type.toString()).toBe('real<..-1>');
  });

  test('the refined type reaches type-channel consumers', () => {
    // The measured §5.7 case: the solver's root filter reads `isExtendedReal`,
    // which on `sqrt(a)` derives from the TYPE — an assumption that only
    // set the sign channel was invisible to it.
    const ce = new ComputeEngine();
    ce.assume(ce.parse('a > 0'));
    ce.assume(ce.parse('x > 0'));
    const roots = (ce.parse('x^2 = a').solve('x') ?? []).map(String).sort();
    expect(roots).toEqual(['-sqrt(a)', 'sqrt(a)'].sort());
    expect(ce.box(['Sqrt', 'a']).type.toString()).toBe('real');
  });
});

describe('assumption type-refinement — review hardening (2026-08-23)', () => {
  test('forget() rewinds the assumed range out of the type', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.assume(ce.parse('p > 0'));
    expect(ce.symbol('p').type.toString()).toBe('real<0<..>');
    ce.forget('p');
    expect(ce.symbol('p').type.toString()).toBe('real');
    expect(ce.symbol('p').sgn).toBe(undefined);
  });

  test('no-argument forget() rewinds to the pre-assumption state', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('q > 4'));
    expect(ce.symbol('q').type.toString()).toBe('real<4<..>');
    ce.forget(undefined);
    // `q` was auto-declared `unknown` when the proposition was boxed; the
    // rewind restores that pre-assumption state, not a blanket `real`.
    expect(ce.symbol('q').type.toString()).toBe('unknown');
  });

  test('an assumption about an ASSIGNED symbol never touches its type', () => {
    // The value-blindness shield makes the symbol look valueless during
    // dispatch; the symbol is still treated as assigned (checked, never
    // rewritten), so its TYPE keeps coming from its value.
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    expect(ce.assume(ce.parse('w > 0'))).toBe('ok');
    expect(ce.symbol('w').type.toString()).toBe('integer');
    // The assumption is a live CONSTRAINT, though, not a contract: a value
    // that refutes it is refused while it is in force…
    expect(() => ce.assign('w', -3)).toThrow();
    expect(ce.symbol('w').value?.toString()).toBe('5');
    // …and accepted again once the fact is retracted. A declared range would
    // have refused it either way — that is the difference between a fact and
    // a contract.
    ce.forget('w');
    ce.assign('w', -3);
    expect(ce.symbol('w').value?.toString()).toBe('-3');
  });

  test('chained bounds on one symbol intersect instead of clobbering', () => {
    const ce = new ComputeEngine();
    ce.parse('x + 1'); // x is inference-pending before the assumption
    expect(ce.assume(ce.parse('0 < x < 10'))).toBe('ok');
    expect(ce.symbol('x').type.toString()).toBe('real<0<..<10>');
    expect(ce.symbol('x').sgn).toBe('positive');
  });

  test('a scoped assumption meets the inherited declaration', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real<..-1>');
    ce.declare('n', 'integer');
    ce.pushScope();
    // Contradiction with the PARENT declaration fires before any shadow is
    // declared…
    expect(ce.assume(ce.parse('r > 0'))).toBe('contradiction');
    expect(ce.symbol('r').type.toString()).toBe('real<..-1>');
    // …and a consistent one keeps the inherited base in the meet.
    expect(ce.assume(ce.parse('n > 0'))).toBe('ok');
    expect(ce.symbol('n').type.toString()).toBe('integer<1..>');
    ce.popScope();
    expect(ce.symbol('n').type.toString()).toBe('integer');
  });

  test('a non-machine-representable bound rounds OUTWARD into the range, keeps the sign', () => {
    // `x > 1/3` installs the bound's machine projection rounded AWAY from
    // the admitted set — a lower bound DOWN — and closed, so the range
    // admits every value the assumption admits (open-bound ranged types,
    // 2026-08-28; before that the range was declined altogether, because a
    // rounding toward the inside would have excluded admissible values).
    // The sign channel still answers from the stored facts.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    ce.assume(ce.box(['Greater', 'u', ['Rational', 1, 3]]));
    const t = ce.symbol('u').type.type;
    expect(typeof t === 'object' && t.kind === 'numeric').toBe(true);
    if (typeof t === 'object' && t.kind === 'numeric') {
      expect(t.lower).toBeLessThan(1 / 3);
      expect(t.lower).toBeGreaterThan(0.333);
      expect(t.lowerOpen).toBeUndefined();
    }
    expect(ce.symbol('u').sgn).toBe('positive');
  });
});

describe('signOfType unfolds a transparent alias', () => {
  test('an alias of a ranged type carries its sign; a recursive alias stops', () => {
    // Built directly: a TRANSPARENT reference is semantically identical to
    // its definition, so the sign reads through it; a nominal reference
    // (alias: false) stays opaque.
    const { signOfType } = require('../../src/common/type/utils');
    const { parseType } = require('../../src/common/type/parse');
    const alias = {
      kind: 'reference',
      name: 'positive_int',
      alias: true,
      def: parseType('integer<1..>'),
    };
    expect(signOfType(alias)).toBe('positive');
    expect(signOfType({ ...alias, alias: false })).toBe(undefined);
    const recursive: any = { kind: 'reference', name: 'r', alias: true };
    recursive.def = recursive;
    expect(signOfType(recursive)).toBe(undefined);
  });
});

describe('type-handler consumers of a ranged declaration', () => {
  const ce = new ComputeEngine();
  ce.declare('p', 'integer<1..>');
  ce.declare('r', 'real<..0>');
  ce.declare('s', 'real<0..> & !0');
  const t = (json: unknown) => ce.box(json as any).type.toString();

  test('Sqrt of a provably non-negative real is real', () => {
    expect(t(['Sqrt', 'p'])).toBe('real');
    expect(t(['Sqrt', 's'])).toBe('real');
    // Non-positive: the radicand may be 0 (→ 0) or negative (→ imaginary).
    expect(t(['Sqrt', 'r'])).toBe('complex');
  });

  test('Factorial and Gamma see the pole-free domain', () => {
    expect(t(['Factorial', 'p'])).toBe('integer');
    expect(t(['Gamma', 'p'])).toBe('real');
  });

  test('Ln of a provably positive operand is real', () => {
    expect(t(['Ln', 'p'])).toBe('real');
    expect(t(['Ln', 's'])).toBe('real');
  });

  test('a zero-pole reciprocal head accepts a proven non-zero operand', () => {
    expect(t(['Csc', 's'])).toBe('real');
  });
});
