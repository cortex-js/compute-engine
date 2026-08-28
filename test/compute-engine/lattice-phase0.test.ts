import { ComputeEngine, compile } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  isSubtype,
  isPrimitiveSubtype,
  meetPrimitiveTypes,
  widen,
} from '../../src/common/type/subtype';
import { isNonRealNumber } from '../../src/common/type/utils';
import { typeAcceptsValue } from '../../src/compute-engine/boxed-expression/value-membership';
import { widenAssignedType } from '../../src/compute-engine/boxed-expression/boxed-value-definition';
import type { Expression } from '../../src/compute-engine/global-types';
import { widenValueTypes } from '../../src/common/type/widen-value';
import { reduceType } from '../../src/common/type/reduce';
import type { Type } from '../../src/common/type/types';

// Phase 0 of the finite-by-default numeric-lattice flip
// (`docs/plans/2026-08-27-lattice-flip-implementation.md`) made two numeric
// primitives — `infinity` and `nan` — and the unsigned singleton spelling
// `~oo` declarable, parseable and matchable, without moving any value.
// Phase 1 then flipped the lattice itself: the bare numeric names became
// finite and the values retyped onto the new names. The blocks below pin both
// halves; the last one, which recorded the pre-flip answers, now records the
// post-flip ones.

const ce = new ComputeEngine();

const t = (s: string): Type => {
  const parsed = parseType(s);
  expect(parsed).toBeDefined();
  return parsed!;
};

describe('LATTICE PHASE 0: the new primitive names parse', () => {
  it('parses `infinity` and `nan` as primitives, not as value literals', () => {
    // A primitive is a BARE STRING in the type AST; a value literal is an
    // object with `kind: 'value'`. Before Phase 0 the lowercase words were
    // value keywords in the lexer, so this is what changed.
    expect(t('infinity')).toBe('infinity');
    expect(t('nan')).toBe('nan');
  });

  it('keeps the value spellings of the infinities and of NaN', () => {
    for (const spelling of ['oo', '∞', 'Infinity', '+oo', '+∞', '+infinity'])
      expect(typeToString(t(spelling))).toBe('Infinity');
    for (const spelling of ['-oo', '-∞', '-infinity'])
      expect(typeToString(t(spelling))).toBe('-Infinity');
    expect(typeToString(t('NaN'))).toBe('NaN');
  });

  it('parses the unsigned complex infinity `~oo` and `~∞`', () => {
    expect(typeToString(t('~oo'))).toBe('~oo');
    expect(typeToString(t('~∞'))).toBe('~oo');
  });

  it('rejects a `~` that does not start `~oo`', () => {
    expect(() => parseType('~x')).toThrow();
    expect(() => parseType('~')).toThrow();
  });

  it('still rejects a NaN bound in a numeric range', () => {
    // `nan` is no longer a value token, so it is no longer a bound the range
    // grammar can read. The parse must still FAIL rather than silently
    // truncate (the pin in `test/common/types.test.ts`, case F17).
    expect(() => parseType('integer<nan..10>')).toThrow();
  });

  it('round-trips serialize -> reparse', () => {
    for (const spelling of ['infinity', 'nan', '+oo', '-oo', '~oo']) {
      const original = t(spelling);
      const reparsed = t(typeToString(original));
      expect(isSubtype(original, reparsed)).toBe(true);
      expect(isSubtype(reparsed, original)).toBe(true);
    }
  });
});

describe('LATTICE PHASE 0: where the new primitives sit', () => {
  it('places `infinity` between `number` and `non_finite_number`', () => {
    expect(isPrimitiveSubtype('infinity', 'number')).toBe(true);
    expect(isPrimitiveSubtype('non_finite_number', 'infinity')).toBe(true);
    expect(isPrimitiveSubtype('infinity', 'non_finite_number')).toBe(false);
  });

  it('keeps `infinity` out of `complex` and its subtypes', () => {
    // An unsigned infinity is not a complex number, so `infinity` is NOT below
    // `complex`. The signed pair still is, through `non_finite_number`.
    for (const above of ['complex', 'real', 'rational', 'integer'] as const)
      expect(isPrimitiveSubtype('infinity', above)).toBe(false);
  });

  it('makes `nan` a subtype of `number` and of nothing else numeric', () => {
    expect(isPrimitiveSubtype('nan', 'number')).toBe(true);
    for (const above of [
      'complex',
      'real',
      'rational',
      'integer',
      'infinity',
      'non_finite_number',
    ] as const)
      expect(isPrimitiveSubtype('nan', above)).toBe(false);
  });

  it('meets `infinity` with the real tower at nothing', () => {
    // The bare numeric names are finite, so they share no value with
    // `infinity`. (Before the flip the overlap was the signed pair
    // `non_finite_number`, which is now below `infinity` alone.)
    expect(meetPrimitiveTypes('real', 'infinity')).toEqual([]);
    expect(meetPrimitiveTypes('complex', 'infinity')).toEqual([]);
    expect(meetPrimitiveTypes('integer', 'non_finite_number')).toEqual([]);
  });

  it('meets `nan` with every other numeric type at nothing', () => {
    expect(meetPrimitiveTypes('nan', 'complex')).toEqual([]);
    expect(meetPrimitiveTypes('nan', 'real')).toEqual([]);
    expect(meetPrimitiveTypes('nan', 'infinity')).toEqual([]);
    expect(meetPrimitiveTypes('nan', 'error')).toEqual([]);
  });
});

describe('LATTICE PHASE 0: the singleton value types', () => {
  it('places `~oo` under `infinity` only', () => {
    expect(isSubtype(t('~oo'), 'infinity')).toBe(true);
    expect(isSubtype(t('~oo'), 'number')).toBe(true);
    // Unsigned: neither a complex number nor one of the signed infinities.
    expect(isSubtype(t('~oo'), 'complex')).toBe(false);
    expect(isSubtype(t('~oo'), 'real')).toBe(false);
    expect(isSubtype(t('~oo'), 'non_finite_number')).toBe(false);
    expect(isSubtype(t('~oo'), 'nan')).toBe(false);
  });

  it('makes `~oo` a subtype of itself', () => {
    // Two occurrences of `~oo` are distinct objects carrying the same
    // sentinel, so the relation cannot rest on object identity.
    expect(isSubtype(t('~oo'), t('~oo'))).toBe(true);
  });

  it('admits `~oo` into no bounded numeric range', () => {
    expect(isSubtype(t('~oo'), t('integer<0..10>'))).toBe(false);
    expect(isSubtype(t('~oo'), t('real<-oo..oo>'))).toBe(false);
  });

  it('places the signed infinity singletons under `infinity` alone', () => {
    for (const spelling of ['+oo', '-oo']) {
      expect(isSubtype(t(spelling), 'non_finite_number')).toBe(true);
      expect(isSubtype(t(spelling), 'infinity')).toBe(true);
      // The flip: `real` is finite now, so a signed infinity is outside it.
      expect(isSubtype(t(spelling), 'real')).toBe(false);
      expect(isSubtype(t(spelling), 'complex')).toBe(false);
      expect(isSubtype(t(spelling), 'nan')).toBe(false);
    }
  });

  it('widens every infinite literal to `infinity` and NaN to `nan`', () => {
    // The tiers a literal projects to when a handler result is stored. All
    // three infinities share one tier; NaN has its own.
    expect(widenValueTypes(t('~oo'))).toBe('infinity');
    expect(widenValueTypes(t('+oo'))).toBe('infinity');
    expect(widenValueTypes(t('-oo'))).toBe('infinity');
    expect(widenValueTypes(t('NaN'))).toBe('nan');
  });

  it('makes `nan` the principal type of the NaN literal', () => {
    expect(isSubtype(t('NaN'), 'nan')).toBe(true);
    expect(isSubtype(t('NaN'), 'number')).toBe(true);
    expect(isSubtype(t('NaN'), 'real')).toBe(false);
    expect(isSubtype(t('NaN'), 'infinity')).toBe(false);
  });
});

describe('LATTICE PHASE 0: engine routes', () => {
  it('matches the box-route infinities against `infinity`', () => {
    expect(ce.box(Infinity).type.matches('infinity')).toBe(true);
    expect(ce.box(-Infinity).type.matches('infinity')).toBe(true);
  });

  it('matches the parse-route infinities against `infinity`', () => {
    expect(ce.parse('\\infty').type.matches('infinity')).toBe(true);
    expect(ce.parse('-\\infty').type.matches('infinity')).toBe(true);
  });

  it('declares a symbol with the new primitive types', () => {
    const engine = new ComputeEngine();
    engine.declare('phase0_inf', 'infinity');
    engine.declare('phase0_nan', 'nan');
    expect(engine.box('phase0_inf').type.toString()).toBe('infinity');
    expect(engine.box('phase0_nan').type.toString()).toBe('nan');
  });

  it('declares a symbol with the `~oo` singleton type', () => {
    const engine = new ComputeEngine();
    engine.declare('phase0_cinf', '~oo' as any);
    expect(engine.box('phase0_cinf').type.toString()).toBe('~oo');
  });
});

describe('LATTICE PHASE 1: the flipped world', () => {
  // Phase 1 of `docs/plans/2026-08-27-lattice-flip-implementation.md` retyped
  // the values. Every answer below is the OPPOSITE of what the engine gave
  // before it, and the block is here — rather than in a new file — because it
  // replaces, line for line, the pins that recorded the pre-flip answers.

  it('gives ±∞ a singleton principal type', () => {
    // A literal's public type is the singleton that names it (ruling O9). The
    // serializer spells a numeric value type with the JavaScript number it
    // carries, so `+∞` prints `Infinity` rather than the `+oo` the type
    // grammar also accepts for it.
    expect(ce.parse('\\infty').type.toString()).toBe('Infinity');
    expect(ce.box(Infinity).type.toString()).toBe('Infinity');
    expect(ce.box(-Infinity).type.toString()).toBe('-Infinity');
    // The tier below the singleton is the signed pair, and thence `infinity`.
    expect(ce.box(Infinity).type.matches('non_finite_number')).toBe(true);
    expect(ce.box(Infinity).type.matches('infinity')).toBe(true);
  });

  it('puts ±∞ outside the bare real tower', () => {
    const oo = ce.parse('\\infty').type;
    expect(oo.matches('real')).toBe(false);
    expect(oo.matches('integer')).toBe(false);
    expect(oo.matches('complex')).toBe(false);
    // The extended real line has to be spelled out.
    expect(oo.matches('real | infinity')).toBe(true);
  });

  it('gives NaN the `nan` tier', () => {
    const nan = ce.box(NaN).type;
    expect(nan.toString()).toBe('NaN');
    expect(nan.matches('nan')).toBe(true);
    expect(nan.matches('non_finite_number')).toBe(false);
    expect(nan.matches('infinity')).toBe(false);
    expect(nan.matches('real')).toBe(false);
  });

  it('gives the unsigned complex infinity the `~oo` singleton', () => {
    const cinf = ce.parse('\\tilde\\infty').type;
    expect(cinf.toString()).toBe('~oo');
    expect(cinf.matches('number')).toBe(true);
    expect(cinf.matches('infinity')).toBe(true);
    // Unsigned, so not the signed pair; infinite, so not finite `complex`.
    expect(cinf.matches('non_finite_number')).toBe(false);
    expect(cinf.matches('complex')).toBe(false);
  });

  it('types a mixed infinite complex value `infinity`', () => {
    // `∞ + i` has infinite magnitude but a direction, so it is neither
    // `~oo` nor a finite complex number: ruling L2(a) puts it in `infinity`
    // as an anonymous member. It used to type bare `complex`.
    const mixed = ce.box(['Complex', { num: '+Infinity' }, 1]).type;
    expect(mixed.toString()).toBe('infinity');
    expect(mixed.matches('complex')).toBe(false);
  });

  it('keeps the finite literals where they were', () => {
    // The control: the flip moves the non-finite values only.
    expect(ce.box(0).type.matches('integer')).toBe(true);
    expect(ce.box(0).type.matches('real')).toBe(true);
    expect(ce.box(3.5).type.matches('real')).toBe(true);
    expect(ce.box(3.5).type.matches('integer')).toBe(false);
  });
});

describe('LATTICE PHASE 1: assignment promotion', () => {
  // When a value is assigned to a symbol with no declared type, the symbol
  // takes the TIER of the value, not the narrow literal type of the value:
  // `x := 5` declares `integer`, so that `x := 6` needs no retype. The
  // finite-by-default lattice puts an infinite value and NaN outside `real`
  // and outside `complex`, so each needs a tier of its own: `x := oo`
  // declares `infinity` (which keeps `x := -oo` legal) and `x := NaN`
  // declares `nan` (the wider `number` would admit every finite value and
  // hide the marker).
  //
  // The table has three copies, and all three are pinned here: a FRESH
  // declaration uses `inferTypeFromValue`
  // (`boxed-expression/boxed-value-definition.ts`), an assignment onto a
  // symbol whose type came from a USE uses `promotedValueType`
  // (`engine-declarations.ts`), and an equality ASSUMPTION uses the copy in
  // `assume.ts`.

  const declaredTypeAfterAssign = (name: string, value: Expression): string => {
    const engine = new ComputeEngine();
    engine.assign(name, value);
    const def = engine.lookupDefinition(name);
    // The definition holds the declared type; `box(name).type` reads it back.
    expect(def).toBeDefined();
    return engine.box(name).type.toString();
  };

  it('promotes an infinite value to `infinity` on a fresh declaration', () => {
    const e = new ComputeEngine();
    expect(declaredTypeAfterAssign('xA', e.box(Infinity))).toBe('infinity');
    expect(declaredTypeAfterAssign('xB', e.box(-Infinity))).toBe('infinity');
    expect(declaredTypeAfterAssign('xC', e.box('ComplexInfinity'))).toBe(
      'infinity'
    );
  });

  it('keeps a symbol holding `+oo` reassignable to `-oo`', () => {
    // This is why the rung stops at the `infinity` tier instead of keeping
    // the `+oo` singleton the value carries.
    const e = new ComputeEngine();
    e.assign('xD', e.box(Infinity));
    expect(e.box('xD').type.toString()).toBe('infinity');
    e.assign('xD', e.box(-Infinity));
    expect(e.box('xD').type.toString()).toBe('infinity');
    expect(e.box('xD').evaluate().toString()).toBe('-oo');
  });

  it('promotes NaN to `nan`', () => {
    const e = new ComputeEngine();
    expect(declaredTypeAfterAssign('xE', e.box(NaN))).toBe('nan');
  });

  it('leaves the finite rungs unchanged', () => {
    const e = new ComputeEngine();
    expect(declaredTypeAfterAssign('xF', e.box(5))).toBe('integer');
    expect(declaredTypeAfterAssign('xG', e.box(3.14))).toBe('real');
    expect(declaredTypeAfterAssign('xH', e.parse('\\frac{1}{3}'))).toBe('real');
    expect(declaredTypeAfterAssign('xI', e.box(['Complex', 2, 3]))).toBe(
      'number'
    );
  });

  it('applies the same rungs at the TYPE level (`widenAssignedType`)', () => {
    // The Epsil static pre-pass widens a destructured leaf from its TYPE
    // alone, with no value expression in hand, so this twin must agree with
    // the value-driven table above.
    const e = new ComputeEngine();
    const widened = (t: Type) => typeToString(widenAssignedType(e, t));
    expect(widened(e.box(Infinity).type.type)).toBe('infinity');
    expect(widened(e.box(-Infinity).type.type)).toBe('infinity');
    expect(widened(e.box(NaN).type.type)).toBe('nan');
    expect(widened(e.box(5).type.type)).toBe('integer');
    expect(widened('infinity')).toBe('infinity');
    expect(widened('nan')).toBe('nan');
  });

  it('applies the same rungs when the incumbent type came from a use', () => {
    // `p` is auto-declared `number` by the arithmetic use, so the assignment
    // takes the `engine-declarations.ts` copy of the table rather than the
    // fresh-declaration one.
    const e = new ComputeEngine();
    e.box(['Add', 'p', 1]).evaluate();
    expect(e.box('p').type.toString()).toBe('number');
    e.assign('p', e.box(Infinity));
    expect(e.box('p').type.toString()).toBe('infinity');
  });

  it('applies the same rungs to an equality assumption', () => {
    const e = new ComputeEngine();
    expect(e.assume(e.parse('x = \\infty'))).toBe('ok');
    expect(e.box('x').type.toString()).toBe('infinity');
  });
});

describe('LATTICE PHASE 1: assuming realness of a non-finite symbol', () => {
  // `real` no longer admits ±∞, so an assumption that a symbol is real
  // contradicts a symbol that holds an infinity. This is the ratified
  // reading: ∞ is not a real number.

  it('reports a contradiction for a symbol holding an infinity', () => {
    const e = new ComputeEngine();
    e.assign('u', e.box(Infinity));
    expect(e.assume(e.parse('u \\in \\R'))).toBe('contradiction');
    // The rejected assumption records nothing: the type is left alone.
    expect(e.box('u').type.toString()).toBe('infinity');
  });

  it('reports a contradiction for a symbol holding NaN', () => {
    const e = new ComputeEngine();
    e.assign('w', e.box(NaN));
    expect(e.assume(e.parse('w \\in \\R'))).toBe('contradiction');
  });

  it('accepts the assumption for a symbol holding a finite value', () => {
    const e = new ComputeEngine();
    e.assign('v', e.box(5));
    expect(e.assume(e.parse('v \\in \\R'))).toBe('ok');
    expect(e.box('v').type.toString()).toBe('real');
  });
});

describe('LATTICE PHASE 0: review-round fixes', () => {
  // Pins for the dual-review findings applied after the initial Phase 0
  // diff. Each block names the behavior, not the finding.

  it('rejects a non-number bound in a numeric range', () => {
    // The `~oo` sentinel is an object, so without an explicit check it
    // slipped past `Number.isNaN` and was stored where `NumericType.lower`
    // must be a number. Booleans and strings had the same hole.
    expect(() => parseType('integer<~oo..10>')).toThrow();
    expect(() => parseType('integer<true..10>')).toThrow();
    expect(() => parseType('integer<"a"..10>')).toThrow();
    // The signed-infinity bounds stay legal: they mean an open end.
    expect(parseType('real<0..oo>')).toBeDefined();
    expect(parseType('integer<-oo..10>')).toBeDefined();
  });

  it('joins the new names at `infinity`, not `number`', () => {
    expect(typeToString(widen(t('~oo'), 'non_finite_number'))).toBe(
      'infinity'
    );
    expect(typeToString(widen('non_finite_number', t('~oo')))).toBe(
      'infinity'
    );
    // The finite rungs of the probe order still answer with the `finite_*`
    // spelling, so joins inside the finite subtree do not move.
    expect(typeToString(widen('integer', 'real'))).toBe(
      'real'
    );
    // A finite type joined with an infinity reaches only the top: the three
    // children of `number` are disjoint. (Before the flip this answered
    // `integer`, which admitted both.)
    expect(typeToString(widen('non_finite_number', 'integer'))).toBe(
      'number'
    );
  });

  it('admits the values the new types name', () => {
    // The runtime membership channel: a NaN value inhabits `nan`, the
    // unsigned complex infinity inhabits `infinity` and its own singleton.
    expect(typeAcceptsValue(ce.box(NaN), t('~oo'))).toBe(false);
    expect(typeAcceptsValue(ce.parse('\\tilde\\infty'), t('~oo'))).toBe(true);
    expect(typeAcceptsValue(ce.box(0), t('~oo'))).toBe(false);
    expect(typeAcceptsValue(ce.box(Infinity), t('~oo'))).toBe(false);
  });

  it('dispatches a `nan`-typed parameter on a NaN argument', () => {
    // End to end through declaration and application: before the fix the
    // parameter refuted the very value its type names.
    ce.pushScope();
    try {
      ce.declare('fNanParam', '(nan) -> number');
      const ok = ce.box(['fNanParam', NaN]);
      expect(ok.isValid).toBe(true);
      const bad = ce.box(['fNanParam', 5]);
      expect(bad.isValid).toBe(false);
    } finally {
      ce.popScope();
    }
  });

  it('answers finiteness for symbols declared with the new types', () => {
    ce.pushScope();
    try {
      ce.declare('xInfTyped', 'infinity');
      ce.declare('yNanTyped', 'nan');
      const x = ce.box('xInfTyped');
      const y = ce.box('yNanTyped');
      expect(x.isFinite).toBe(false);
      expect(x.isInfinity).toBe(true);
      expect(x.isNaN).toBe(false);
      expect(y.isFinite).toBe(false);
      expect(y.isInfinity).toBe(false);
      expect(y.isNaN).toBe(true);
    } finally {
      ce.popScope();
    }
  });

  it('keeps an uninhabited bounded meet at `never`', () => {
    // A finite interval contains no member of `infinity` or `nan`, so the
    // meet of a bounded range with either is empty — it must not surface
    // as a bounded range over an uninhabited base (`infinity<0..10>`). The
    // range is hand-built: the type-string parser does not accept bounds on
    // `number`, so only constructed types reach this path.
    const range: Type = { kind: 'numeric', type: 'number', lower: 0, upper: 10 };
    const meetTo = (b: Type) =>
      typeToString(reduceType({ kind: 'intersection', types: [range, b] }));
    expect(meetTo('infinity')).toBe('never');
    expect(meetTo('nan')).toBe('never');
    expect(meetTo('real')).toBe('real<0..10>');
  });
});

describe('STEP 1.3: isExtendedReal', () => {
  // The `isReal` predicate was renamed to `isExtendedReal` (ruling L4 as
  // amended, `docs/plans/2026-08-26-numeric-lattice-ratification-brief.md`),
  // which says what it always meant: the value is on the EXTENDED real line —
  // a finite real, or one of the two signed infinities. The old name was
  // removed rather than re-pointed, so every caller chose extended or finite
  // under typecheck. `isFinite` keeps its name and means finite MAGNITUDE.
  //
  // For the FINITE reals, test `type.matches('real')` instead: after the flip
  // the bare type name `real` denotes the finite reals.

  it('admits the finite reals and the two signed infinities', () => {
    expect(ce.box(5).isExtendedReal).toBe(true);
    expect(ce.parse('\\frac12').isExtendedReal).toBe(true);
    expect(ce.box('PositiveInfinity').isExtendedReal).toBe(true);
    expect(ce.box('NegativeInfinity').isExtendedReal).toBe(true);
    // The machine-float route agrees with the symbol route.
    expect(ce.box(Infinity).isExtendedReal).toBe(true);
    expect(ce.box(-Infinity).isExtendedReal).toBe(true);
    // A function expression whose static type is the signed pair, with no
    // value to probe before evaluation.
    expect(ce.box(['Ln', 0]).isExtendedReal).toBe(true);
  });

  it('excludes NaN — the machine-float route no longer answers `true`', () => {
    // The fix this rename carried. The machine-number fast path used to
    // return `true` for ANY float, NaN included, while the NumericValue route
    // answered `false` for the same value (NaN types `nan`, which is below
    // neither `real` nor `non_finite_number`). NaN is not a point of the
    // extended real line, so both routes now say `false`.
    expect(ce.box(NaN).isExtendedReal).toBe(false);
    expect(ce.box('NaN').isExtendedReal).toBe(false);
  });

  it('excludes the unsigned infinity and the non-real values', () => {
    // `~oo` has no sign and no place on the real line; the sign-aware folds
    // that read this predicate must not accept it.
    expect(ce.parse('\\tilde\\infty').isExtendedReal).toBe(false);
    expect(ce.box('i').isExtendedReal).toBe(false);
    expect(ce.box(['Complex', 1, 2]).isExtendedReal).toBe(false);
    // A non-zero imaginary part with an infinite real part is `∞ + i`. The
    // predicate cannot decide it: `Add`'s type handler reports the top numeric
    // type `number` for this mixed operand pair, and `number` covers both the
    // extended-real values and the non-real ones, so the answer is `undefined`
    // rather than a verdict. An `Add` claim sharp enough to keep the non-real
    // imaginary part visible would let the predicate answer. (The engine's
    // arithmetic reduces the SUM to `+oo`, which is on the extended real line,
    // so the sharper claim is a question about the unevaluated form only.)
    expect(ce.box(['Add', 'PositiveInfinity', 'i']).isExtendedReal).toBe(
      undefined
    );
  });

  it('stays three-valued for a symbol of unknown type', () => {
    expect(ce.box('zUnknownRealness').isExtendedReal).toBe(undefined);
  });

  it('still folds `1/±∞ = 0` through the renamed gate', () => {
    // The `Divide` type handler requires `isExtendedReal === true` of BOTH
    // operands before claiming that a finite real over a non-finite real is
    // exactly `0` (`i/∞` and `x/~oo` are not). The rename keeps the fold.
    expect(ce.box(['Divide', 1, 'PositiveInfinity']).evaluate().toString()).toBe(
      '0'
    );
    expect(
      ce.box(['Divide', 1, ['Abs', 'PositiveInfinity']]).evaluate().toString()
    ).toBe('0');
    // The same claim on the TYPE, taken before evaluation from `Ln(0)`, whose
    // non-finiteness is visible only in its static type.
    expect(ce.box(['Divide', 1, ['Ln', 0]]).type.toString()).toBe('0');
  });

  it('still claims a signed infinity for `real · ±∞` and `real + ±∞`', () => {
    // The `Multiply` and `Add` folds require `isExtendedReal === true` of
    // every operand, which is what keeps `∞·i = ~oo` out of the claim.
    expect(ce.box(['Multiply', 2, ['Ln', 0]]).type.toString()).toBe(
      'non_finite_number'
    );
    expect(ce.box(['Add', 2, ['Ln', 0]]).type.toString()).toBe(
      'non_finite_number'
    );
  });
});

describe('REVIEW ROUND: finiteness gate', () => {
  // The bare numeric names denote exactly the finite values, so `complex` —
  // the widest of them — IS the engine's canonical finiteness type-test
  // (`BoxedSymbol.isFinite`, `factsFromType`, the `Re`/`Im`/`Arg`/`Abs` type
  // handlers all ask `matches('complex')`). Phase 1 spelled the same gate
  // `finite_number` and bridged it to the bare names with one-directional
  // edges; Phase 2 retired that spelling and the bridge with it, leaving the
  // disjoint tree below to answer on its own.

  it('places every bare finite name below `complex`', () => {
    for (const name of ['imaginary', 'real', 'rational', 'integer'])
      expect(isPrimitiveSubtype(name as any, 'complex')).toBe(true);
  });

  it('keeps the non-finite names out of `complex`', () => {
    // `number` is the top of the numeric tree and admits `infinity` and `nan`,
    // so it is NOT finite; the three below are not finite either.
    for (const name of ['number', 'infinity', 'nan', 'non_finite_number'])
      expect(isPrimitiveSubtype(name as any, 'complex')).toBe(false);
  });

  it('answers `isNonRealNumber` false for the generic numeric type', () => {
    // `isNonRealNumber` reads "below `complex`, not below `real`". `number`
    // sits ABOVE `complex`, so it answers `false` — which is what keeps the
    // compiler on its real lowering lane for the generic numeric expressions
    // (`sin(6u)` with `u` undeclared) that carry it.
    expect(isNonRealNumber('number')).toBe(false);
    expect(isNonRealNumber('complex')).toBe(true);
    expect(isNonRealNumber('real')).toBe(false);
  });

  it('accepts the retired `finite_*` spellings as parse-time aliases', () => {
    // They are input aliases for one release cycle: normalized before a node
    // is built, so they never reach a `Type` and are never serialized back.
    expect(typeToString(t('finite_number'))).toBe('complex');
    expect(typeToString(t('finite_complex'))).toBe('complex');
    expect(typeToString(t('finite_real'))).toBe('real');
    expect(typeToString(t('finite_rational'))).toBe('rational');
    expect(typeToString(t('finite_integer'))).toBe('integer');
    // …including in a RANGED spelling, whose base normalizes too.
    expect(typeToString(t('finite_real<0..1>'))).toBe('real<0..1>');
  });

  it('does not resolve an `Object.prototype` member as an alias', () => {
    // The alias table is indexed by an identifier taken from the input, so it
    // has a null prototype: a name inherited from `Object.prototype` must be
    // an unknown type, not a lookup hit.
    expect(() => t('constructor')).toThrow();
    expect(() => t('toString')).toThrow();
    expect(() => t('valueOf')).toThrow();
    expect(() => t('hasOwnProperty')).toThrow();
  });

  it('names every meet inside the numeric tower with the narrower operand', () => {
    // The tower is a chain, so a meet against `complex` is the other operand.
    expect(meetPrimitiveTypes('complex', 'real')).toEqual(['real']);
    expect(meetPrimitiveTypes('complex', 'integer')).toEqual(['integer']);
    expect(meetPrimitiveTypes('complex', 'imaginary')).toEqual(['imaginary']);
    expect(meetPrimitiveTypes('real', 'integer')).toEqual(['integer']);
    expect(meetPrimitiveTypes('real', 'complex')).toEqual(['real']);
    // `complex` is disjoint from the two non-finite children of `number`.
    expect(meetPrimitiveTypes('complex', 'infinity')).toEqual([]);
    expect(meetPrimitiveTypes('complex', 'nan')).toEqual([]);
  });

  it('treats a range over a finite base as finite whatever its bounds', () => {
    // A range relates to a supertype exactly as its BASE does — bounds only
    // narrow — and every bare base is finite. `integer<1..>` and `real<0..>`
    // are the shapes `nonNegativeRangeType` and the assumption channel
    // produce, so the half-bounded case has to reach the finiteness gate.
    expect(isSubtype(t('integer<1..>'), 'integer')).toBe(true);
    expect(isSubtype(t('real<0..>'), 'real')).toBe(true);
    expect(isSubtype(t('real<..0>'), 'real')).toBe(true);
    expect(isSubtype(t('integer<1..>'), 'complex')).toBe(true);
    expect(isSubtype(t('real<0..10>'), 'real')).toBe(true);
    expect(isSubtype(t('integer<0..10>'), 'integer')).toBe(true);
  });

  it('keeps a range over a NON-finite base non-finite', () => {
    // The type parser refuses bounds on `number`, `infinity` and `nan`, so
    // only a hand-built `Type` object has these shapes. A range answers as its
    // BASE does, so `number<0..10>` stays outside `complex` even though its
    // bounds are finite: Phase 2 dropped the bounds-driven narrowing that
    // used to map such a range onto the retired `finite_number`, and no bare
    // name is a sound replacement (the bounds do not prove the value real).
    const range = (type: string, lower?: number, upper?: number): Type =>
      ({ kind: 'numeric', type, lower, upper }) as Type;
    expect(isSubtype(range('number', 0, undefined), 'complex')).toBe(false);
    expect(isSubtype(range('number', 0, undefined), 'number')).toBe(true);
    expect(isSubtype(range('number', 0, 10), 'complex')).toBe(false);
    expect(isSubtype(range('number', 0, 10), 'number')).toBe(true);
    expect(isSubtype(range('infinity', 0, undefined), 'complex')).toBe(false);
    expect(isSubtype(range('infinity', 0, undefined), 'infinity')).toBe(true);
    expect(isSubtype(range('nan', 0, undefined), 'complex')).toBe(false);
  });

  it('does not close the subtype relation over the `number` partition', () => {
    // `number = complex ⊔ infinity ⊔ nan` partitions the VALUES, but a union
    // is a supertype only of types below one of its members, and `number` is
    // above all three rather than inside any one of them. Deciding the
    // converse needs covering-union machinery the type checker does not have.
    expect(isSubtype('number', t('complex | infinity | nan'))).toBe(false);
    expect(isSubtype(t('complex | infinity | nan'), 'number')).toBe(true);
  });

  it('widens a number literal to a BARE tier', () => {
    // A literal's public type is the literal itself (ruling O9); every
    // STORAGE position widens it back to its tier, and the tier is now the
    // bare name — the retired `finite_integer`/`finite_real` spellings were
    // what `widenValueTypes` used to produce.
    expect(ce.box(0).type.toString()).toBe('0');
    expect(typeToString(widenValueTypes(ce.box(0).type.type))).toBe('integer');
    expect(typeToString(widenValueTypes(ce.box(0.5).type.type))).toBe('real');
  });

  it('reports a finite symbol and a finite tier for the consumers of the gate', () => {
    // A private engine: declaring symbols on the file-level `ce` would leak
    // into the other blocks.
    const engine = new ComputeEngine();
    engine.declare('xReal', 'real');
    engine.declare('zComplex', 'complex');
    // `BoxedSymbol.isFinite` asks `matches('complex')`; before the lattice
    // flip both answered `undefined`.
    expect(engine.box('xReal').isFinite).toBe(true);
    expect(engine.box('zComplex').isFinite).toBe(true);
    // The `Re`/`Im`/`Arg`/`Abs` type handlers narrow against the finite tier;
    // before the bridge the first three widened all the way to `number`.
    expect(engine.box(['Re', 'zComplex']).type.toString()).toBe('real');
    expect(engine.box(['Im', 'zComplex']).type.toString()).toBe('real');
    expect(engine.box(['Arg', 'zComplex']).type.toString()).toBe('real');
    expect(engine.box(['Abs', 'zComplex']).type.toString()).toBe(
      'real<0..>'
    );
  });
});

describe('LATTICE PHASE 2: the retired `finite_*` names', () => {
  // Phase 2 removed `finite_number`, `finite_complex`, `finite_real`,
  // `finite_rational` and `finite_integer` from `NumericPrimitiveType`. Each
  // denoted exactly the same values as a bare name, because every bare name
  // under `number` is finite. What is left is the parse-time alias table and
  // the claims the engine now makes in their place.

  it('never SERIALIZES a retired spelling', () => {
    // The aliases are normalized before a node is built, so a round trip
    // through the parser emits the bare name.
    for (const [alias, bare] of [
      ['finite_number', 'complex'],
      ['finite_complex', 'complex'],
      ['finite_real', 'real'],
      ['finite_rational', 'rational'],
      ['finite_integer', 'integer'],
    ] as const)
      expect(typeToString(t(alias))).toBe(bare);
    expect(typeToString(t('list<finite_integer>'))).toBe('list<integer>');
    expect(typeToString(t('finite_real<0..1>'))).toBe('real<0..1>');
  });

  it('claims the TOP numeric type at a generic numeric point', () => {
    // A generic numeric expression is finite-but-possibly-complex, which no
    // bare name spells: `complex` would say PROVABLY non-real, which is what
    // the compiler reads to choose its complex lowering lane. The sound and
    // lane-preserving claim is the top type `number`.
    const engine = new ComputeEngine();
    expect(engine.parse('x \\times y').type.toString()).toBe('number');
    expect(engine.parse('\\sin(x y)').type.toString()).toBe('number');
    expect(isNonRealNumber('number')).toBe(false);
  });

  it('keeps a generic numeric node on the REAL compile lane', () => {
    // The lane consequence of the claim above: in the default (strict) mode
    // a `number`-typed node lowers to real arithmetic, and in complex mode
    // `liftWideResult` still recognizes it as WIDE and lifts it.
    const engine = new ComputeEngine();
    const real = compile(engine.parse('\\sin(x y)'));
    expect(real.code).toBe('Math.sin(_.x * _.y)');
    const cx = compile(engine.parse('\\sin(x y)'), { mode: 'complex' });
    expect(cx.code).toContain('_SYS.csin(');
    expect(cx.code).toContain('_SYS.cplx(');
  });
});
