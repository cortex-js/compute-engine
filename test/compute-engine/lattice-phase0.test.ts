import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  isSubtype,
  isPrimitiveSubtype,
  meetPrimitiveTypes,
  widen,
} from '../../src/common/type/subtype';
import { typeAcceptsValue } from '../../src/compute-engine/boxed-expression/value-membership';
import { widenValueTypes } from '../../src/common/type/widen-value';
import { reduceType } from '../../src/common/type/reduce';
import type { Type } from '../../src/common/type/types';

// Phase 0 of the finite-by-default numeric-lattice flip
// (`docs/plans/2026-08-27-lattice-flip-implementation.md`). Two numeric
// primitives — `infinity` and `nan` — and the unsigned singleton spelling
// `~oo` become declarable, parseable and matchable. The step is ADDITIVE: no
// existing value changes its principal type, and no existing `matches()`
// answer changes. The last describe block is the proof of that.

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
      'finite_number',
    ] as const)
      expect(isPrimitiveSubtype('nan', above)).toBe(false);
  });

  it('meets `infinity` with the real tower at the signed pair', () => {
    // The pre-flip overlap `real ∩ infinity` is exactly `{+∞, −∞}`, which the
    // lattice already names `non_finite_number`.
    expect(meetPrimitiveTypes('real', 'infinity')).toEqual([
      'non_finite_number',
    ]);
    expect(meetPrimitiveTypes('complex', 'infinity')).toEqual([
      'non_finite_number',
    ]);
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

  it('keeps the signed infinity singletons where they were, and adds `infinity`', () => {
    for (const spelling of ['+oo', '-oo']) {
      expect(isSubtype(t(spelling), 'non_finite_number')).toBe(true);
      expect(isSubtype(t(spelling), 'real')).toBe(true);
      expect(isSubtype(t(spelling), 'infinity')).toBe(true);
      expect(isSubtype(t(spelling), 'nan')).toBe(false);
    }
  });

  it('widens `~oo` to `infinity`', () => {
    // `infinity` is the only type that names the unsigned infinity, so it is
    // the tier a `~oo` literal projects to when a handler result is stored.
    // The NaN and ±∞ targets are deliberately unchanged — see the unchanged
    // world block below.
    expect(widenValueTypes(t('~oo'))).toBe('infinity');
    expect(widenValueTypes(t('NaN'))).toBe('number');
    expect(widenValueTypes(t('+oo'))).toBe('non_finite_number');
  });

  it('makes the NaN literal a subtype of `nan`', () => {
    expect(isSubtype(t('NaN'), 'nan')).toBe(true);
    // ... while its principal type is still the wide `number`.
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

describe('LATTICE PHASE 0: the unchanged world', () => {
  // Phase 0 adds vocabulary. Every answer below is what the engine gave
  // before it, and each one flips in Phase 1 of
  // `docs/plans/2026-08-27-lattice-flip-implementation.md`.

  it('keeps the principal type of ±∞', () => {
    expect(ce.parse('\\infty').type.toString()).toBe('non_finite_number');
    expect(ce.box(Infinity).type.toString()).toBe('non_finite_number');
  });

  it('keeps ±∞ inside the bare real tower', () => {
    const oo = ce.parse('\\infty').type;
    expect(oo.matches('real')).toBe(true);
    expect(oo.matches('integer')).toBe(true);
    expect(oo.matches('complex')).toBe(true);
  });

  it('keeps the principal type of NaN', () => {
    const nan = ce.box(NaN).type;
    expect(nan.toString()).toBe('number');
    expect(nan.matches('non_finite_number')).toBe(false);
    expect(nan.matches('real')).toBe(false);
    // A boxed NaN carries the PRIMITIVE `number`, which is wider than `nan`,
    // so it does not match the new marker type. The NaN VALUE-LITERAL type
    // does (see the singleton block above). Retyping the value onto `nan` is
    // Phase 1.
    expect(nan.matches('nan')).toBe(false);
  });

  it('keeps the principal type of the unsigned complex infinity', () => {
    const cinf = ce.parse('\\tilde\\infty').type;
    expect(cinf.toString()).toBe('number');
    expect(cinf.matches('number')).toBe(true);
    expect(cinf.matches('complex')).toBe(false);
    // Same reason as NaN above: the VALUE still carries the primitive
    // `number`. Retyping it onto the `~oo` singleton is Phase 1.
    expect(cinf.matches('infinity')).toBe(false);
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
    // Joins of pre-existing types do not move.
    expect(typeToString(widen('finite_integer', 'finite_real'))).toBe(
      'finite_real'
    );
    expect(typeToString(widen('non_finite_number', 'finite_integer'))).toBe(
      'integer'
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
