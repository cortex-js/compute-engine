import {
  parseType,
  parseTypeWithEffectsProvenance,
} from '../../../src/common/type/parse';
import { typeToString } from '../../../src/common/type/serialize';
import { isSubtype } from '../../../src/common/type/subtype';
import { reduceType } from '../../../src/common/type/reduce';
import { BoxedType } from '../../../src/common/type/boxed-type';
import {
  coFiniteEffects,
  computedEffectsInclude,
  EFFECT_LABELS,
  hasDeclaredEffectLabel,
  isCoFiniteEffects,
  isComputedEffectSubset,
  isEffectLabel,
  isEffectSubset,
  isPureComputedEffects,
  normalizeEffectSet,
  sameEffectSet,
  subtractEffects,
  unionComputedEffects,
  unionEffectSets,
} from '../../../src/common/type/effects';
import type { FunctionSignature, Type } from '../../../src/common/type/types';

//
// Stage 1 of the effects model (`docs/EFFECTS-MODEL.md`): effect sets on
// function signatures — the grammar (the Swift-style specifier slot between
// the argument list and the arrow), the canonical serialization, and the
// covariant subset order.
//

/** Canonical round-trip: parse, serialize, re-parse. */
function roundTrip(s: string): string {
  const once = typeToString(parseType(s));
  // Serialization must be a fixed point (parse ∘ serialize = id)
  expect(typeToString(parseType(once))).toBe(once);
  return once;
}

function sig(s: string): FunctionSignature {
  const t = parseType(s) as FunctionSignature;
  expect(typeof t).toBe('object');
  expect(t.kind).toBe('signature');
  return t;
}

describe('effect labels', () => {
  test('the enumeration is closed, canonical and alphabetical', () => {
    expect(EFFECT_LABELS).toEqual([
      'console',
      'entropy',
      'environment',
      'fs_read',
      'fs_write',
      'network',
      'random',
      'scope',
      'time',
    ]);
    expect([...EFFECT_LABELS].sort()).toEqual([...EFFECT_LABELS]);
  });

  test('every label is declarable, even with no library carrier yet', () => {
    for (const label of EFFECT_LABELS) {
      expect(isEffectLabel(label)).toBe(true);
      expect(roundTrip(`(real) ${label} -> real`)).toBe(
        `(real) ${label} -> real`
      );
    }
  });

  test('`any` is not a label — it is the distinguished top', () => {
    expect(isEffectLabel('any')).toBe(false);
    expect(isEffectLabel('io')).toBe(false);
    expect(isEffectLabel('Random')).toBe(false);
  });
});

describe('grammar: accepted forms', () => {
  test('a bare arrow is pure — no effect field, byte-identical output', () => {
    expect(roundTrip('(real) -> real')).toBe('(real) -> real');
    expect(sig('(real) -> real').effects).toBeUndefined();
    expect(sig('() -> nothing').effects).toBeUndefined();
    expect(roundTrip('(x: number, y: number?) -> number')).toBe(
      '(x: number, y: number?) -> number'
    );
    expect(roundTrip('(number+) -> number')).toBe('(number+) -> number');
  });

  test('a single label', () => {
    expect(roundTrip('(real) random -> real')).toBe('(real) random -> real');
    expect(sig('(real) random -> real').effects).toEqual(['random']);
    expect(roundTrip('() entropy -> expression')).toBe(
      '() entropy -> expression'
    );
    expect(roundTrip('() scope -> nothing')).toBe('() scope -> nothing');
    expect(roundTrip('(string) network -> string')).toBe(
      '(string) network -> string'
    );
  });

  test('multiple labels, in any input order, canonicalize alphabetically', () => {
    expect(roundTrip('(real) random scope -> real')).toBe(
      '(real) random scope -> real'
    );
    expect(roundTrip('(real) scope random -> real')).toBe(
      '(real) random scope -> real'
    );
    expect(roundTrip('(real) time fs_read -> real')).toBe(
      '(real) fs_read time -> real'
    );
    expect(
      roundTrip('(real) time scope network console environment -> real')
    ).toBe('(real) console environment network scope time -> real');
    expect(sig('(real) scope random -> real').effects).toEqual([
      'random',
      'scope',
    ]);
  });

  test('`any` — unknown effects', () => {
    expect(roundTrip('(real) any -> real')).toBe('(real) any -> real');
    expect(sig('(real) any -> real').effects).toBe('any');
  });

  test('the slot works with every argument-list shape', () => {
    expect(roundTrip('() random -> real')).toBe('() random -> real');
    expect(roundTrip('(x: real, y: real) random -> real')).toBe(
      '(x: real, y: real) random -> real'
    );
    expect(roundTrip('(real, real?) random -> real')).toBe(
      '(real, real?) random -> real'
    );
    expect(roundTrip('(real*) random -> real')).toBe('(real*) random -> real');
    expect(roundTrip('(real+) random -> real')).toBe('(real+) random -> real');
  });

  test('the slot anchors per-arrow — nested signature bounds', () => {
    expect(roundTrip('(g: (real) random -> real) scope -> boolean')).toBe(
      '(g: (real) random -> real) scope -> boolean'
    );
    const outer = sig('(g: (real) random -> real) scope -> boolean');
    expect(outer.effects).toEqual(['scope']);
    expect((outer.args![0].type as FunctionSignature).effects).toEqual([
      'random',
    ]);

    // Deeper nesting, and an effect set on the *result* signature
    expect(
      roundTrip('(g: (h: (real) entropy -> real) -> real) any -> boolean')
    ).toBe('(g: (h: (real) entropy -> real) -> real) any -> boolean');
    expect(roundTrip('(real) -> ((real) random -> real)')).toBe(
      '(real) -> (real) random -> real'
    );
  });

  //
  // `pure` (ruled 2026-08-01) — SYNTACTIC SUGAR in the specifier slot for the
  // explicitly-stated EMPTY effect set. It is parse-accepted but NEVER
  // serialized: the canonical spelling of a pure arrow remains the empty slot,
  // the same in-not-out asymmetry as label ordering. The `Type` it builds is
  // identical to the bare form — provenance lives on the DEFINITION, never in
  // the type (see `user-function-purity.test.ts` for the contract half).
  //
  describe('`pure` — accepted authoring input, never serialized', () => {
    test('it builds exactly the bare-arrow type', () => {
      expect(sig('(real) pure -> real').effects).toBeUndefined();
      expect(sig('(real) pure -> real')).toEqual(sig('(real) -> real'));
      // No `effects: []` state leaks into the built type.
      expect('effects' in sig('(real) pure -> real')).toBe(false);
    });

    test('it serializes back to the empty slot', () => {
      expect(roundTrip('(real) pure -> real')).toBe('(real) -> real');
      expect(roundTrip('() pure -> nothing')).toBe('() -> nothing');
      expect(roundTrip('(x: number, y: number?) pure -> number')).toBe(
        '(x: number, y: number?) -> number'
      );
    });

    test('the slot anchors per-arrow, so `pure` nests too', () => {
      expect(roundTrip('(g: (real) pure -> real) scope -> boolean')).toBe(
        '(g: (real) -> real) scope -> boolean'
      );
    });

    test('the parse reports the author`s statement, out of band', () => {
      // The ONE mechanism that carries "the author wrote `pure`" past the
      // parser: the type itself cannot, by design.
      expect(
        parseTypeWithEffectsProvenance('(real) pure -> real').effectsStated
      ).toBe(true);
      expect(
        parseTypeWithEffectsProvenance('(real) -> real').effectsStated
      ).toBe(false);
      expect(
        parseTypeWithEffectsProvenance('(real) random -> real').effectsStated
      ).toBe(true);
      expect(
        parseTypeWithEffectsProvenance('(real) any -> real').effectsStated
      ).toBe(true);
      expect(parseTypeWithEffectsProvenance('real').effectsStated).toBe(false);
      // Only the TOP-LEVEL arrow's slot is provenance: a nested one is a type.
      expect(
        parseTypeWithEffectsProvenance('(g: (real) pure -> real) -> boolean')
          .effectsStated
      ).toBe(false);
      // Byte-identical types, whatever the provenance says.
      expect(
        typeToString(parseTypeWithEffectsProvenance('(real) pure -> real').type)
      ).toBe('(real) -> real');
    });
  });

  test('signatures with effects inside unions and intersections', () => {
    expect(roundTrip('((real) random -> real) | integer')).toBe(
      '((real) random -> real) | integer'
    );
    expect(
      roundTrip('((real) random -> real) & ((string) scope -> string)')
    ).toBe('((real) random -> real) & ((string) scope -> string)');
  });
});

describe('grammar: rejected forms (all fail closed)', () => {
  const rejects: [string, RegExp][] = [
    ['(real) foo -> real', /Unknown effect label `foo`/],
    ['(real) io -> real', /Unknown effect label `io`/],
    // Case matters: the enumeration is exact
    ['(real) Random -> real', /Unknown effect label `Random`/],
    ['(real) random random -> real', /Duplicate effect label `random`/],
    ['(real) scope random scope -> real', /Duplicate effect label `scope`/],
    [
      '(real) any random -> real',
      /`any` cannot be combined with other effect labels/,
    ],
    [
      '(real) random any -> real',
      /`any` cannot be combined with other effect labels/,
    ],
    [
      '(real) any any -> real',
      /`any` cannot be combined with other effect labels/,
    ],
    // `pure` is exclusive with every label AND with `any`, and is not
    // repeatable — the same rules `any` follows.
    [
      '(real) pure random -> real',
      /`pure` cannot be combined with other effect labels/,
    ],
    [
      '(real) random pure -> real',
      /`pure` cannot be combined with other effect labels/,
    ],
    [
      '(real) pure any -> real',
      /`pure` cannot be combined with other effect labels/,
    ],
    [
      '(real) any pure -> real',
      /`pure` cannot be combined with other effect labels/,
    ],
    [
      '(real) pure pure -> real',
      /`pure` cannot be combined with other effect labels/,
    ],
    // `!` is reserved for the future complement form
    ['(real) !random -> real', /complement form is reserved/],
    ['(real) ! -> real', /complement form is reserved/],
    ['(real) !any -> real', /complement form is reserved/],
    ['(real) random !scope -> real', /complement form is reserved/],
    // The slot only exists after a parenthesized argument list
    ['real random -> real', /must be enclosed in parentheses/],
    ['real -> real', /must be enclosed in parentheses/],
  ];

  for (const [source, message] of rejects) {
    test(`\`${source}\` is a parse error`, () => {
      expect(() => parseType(source)).toThrow(message);
    });
  }

  test('an effect label alone is not a type', () => {
    // `random` is not a type name: with no resolver it is an unresolved
    // reference, never an effect set.
    expect(() => parseType('random')).toThrow();
  });
});

describe('subtyping: the effect set is covariant, by subset inclusion', () => {
  const sub = (a: string, b: string) => isSubtype(parseType(a), parseType(b));

  test('the empty set is below every singleton', () => {
    for (const label of EFFECT_LABELS) {
      expect(sub('(real) -> real', `(real) ${label} -> real`)).toBe(true);
      expect(sub(`(real) ${label} -> real`, '(real) -> real')).toBe(false);
    }
  });

  test('singletons are pairwise incomparable (both directions false)', () => {
    for (const a of EFFECT_LABELS) {
      for (const b of EFFECT_LABELS) {
        if (a === b) continue;
        expect(sub(`(real) ${a} -> real`, `(real) ${b} -> real`)).toBe(false);
      }
    }
    // Notably `fs_write` does NOT imply `fs_read`
    expect(sub('(real) fs_write -> real', '(real) fs_read -> real')).toBe(
      false
    );
    expect(sub('(real) fs_read -> real', '(real) fs_write -> real')).toBe(
      false
    );
  });

  test('subset ordering on multi-label sets', () => {
    expect(sub('(real) random -> real', '(real) random scope -> real')).toBe(
      true
    );
    expect(sub('(real) scope -> real', '(real) random scope -> real')).toBe(
      true
    );
    expect(sub('(real) random scope -> real', '(real) random -> real')).toBe(
      false
    );
    expect(
      sub('(real) random scope -> real', '(real) fs_read random scope -> real')
    ).toBe(true);
    // Incomparable multi-label sets
    expect(
      sub('(real) random scope -> real', '(real) network scope -> real')
    ).toBe(false);
    expect(
      sub('(real) network scope -> real', '(real) random scope -> real')
    ).toBe(false);
  });

  test('reflexivity', () => {
    expect(
      sub('(real) random scope -> real', '(real) scope random -> real')
    ).toBe(true);
    expect(sub('(real) any -> real', '(real) any -> real')).toBe(true);
    expect(sub('(real) -> real', '(real) -> real')).toBe(true);
  });

  test('`any` is the top: everything below it, nothing finite above it', () => {
    expect(sub('(real) -> real', '(real) any -> real')).toBe(true);
    for (const label of EFFECT_LABELS)
      expect(sub(`(real) ${label} -> real`, '(real) any -> real')).toBe(true);
    expect(
      sub('(real) console entropy fs_write -> real', '(real) any -> real')
    ).toBe(true);

    // An `any` operand fails every finite bound: it cannot prove absence.
    expect(sub('(real) any -> real', '(real) -> real')).toBe(false);
    for (const label of EFFECT_LABELS)
      expect(sub('(real) any -> real', `(real) ${label} -> real`)).toBe(false);
    expect(
      sub(
        '(real) any -> real',
        '(real) console entropy environment fs_read fs_write network random scope time -> real'
      )
    ).toBe(false);
  });

  test('the effect check composes with the result covariance', () => {
    expect(sub('(real) -> integer', '(real) random -> real')).toBe(true);
    // Effects fit, result does not
    expect(sub('(real) -> real', '(real) random -> integer')).toBe(false);
    // Result fits, effects do not
    expect(sub('(real) random -> integer', '(real) -> real')).toBe(false);
  });

  test('contravariant flip in argument position', () => {
    // A function accepting an effectful callback is a subtype of one
    // accepting only pure callbacks.
    expect(
      sub(
        '(g: (real) random -> real) -> boolean',
        '(g: (real) -> real) -> boolean'
      )
    ).toBe(true);
    expect(
      sub(
        '(g: (real) -> real) -> boolean',
        '(g: (real) random -> real) -> boolean'
      )
    ).toBe(false);
    // `any` in argument position: the most permissive acceptor
    expect(
      sub(
        '(g: (real) any -> real) -> boolean',
        '(g: (real) random -> real) -> boolean'
      )
    ).toBe(true);
    expect(
      sub(
        '(g: (real) random -> real) -> boolean',
        '(g: (real) any -> real) -> boolean'
      )
    ).toBe(false);
    // Same flip through an optional and a variadic parameter
    expect(
      sub(
        '(g: (real) random -> real, h: (real) scope -> real?) -> boolean',
        '(g: (real) -> real, h: (real) -> real?) -> boolean'
      )
    ).toBe(true);
    expect(
      sub(
        '(g: (real) random -> real*) -> boolean',
        '(g: (real) -> real*) -> boolean'
      )
    ).toBe(true);
  });

  test('the bare `function` primitive is effect-top as a bound', () => {
    expect(sub('(real) -> real', 'function')).toBe(true);
    expect(sub('(real) any -> real', 'function')).toBe(true);
    for (const label of EFFECT_LABELS)
      expect(sub(`(real) ${label} -> real`, 'function')).toBe(true);
    expect(
      sub('(real) console fs_write network scope -> real', 'function')
    ).toBe(true);
    // ...and via an argument bound, so `Map(xs, x |-> Random())` keeps working
    expect(
      sub('(collection, function) -> list', '(collection, function) -> list')
    ).toBe(true);
    expect(
      sub(
        '(f: function) -> boolean',
        '(f: (real) random scope -> real) -> boolean'
      )
    ).toBe(true);
  });

  test('`function` and `expression` bounds are unaffected by effects', () => {
    expect(sub('(real) random -> real', 'expression')).toBe(true);
    expect(sub('(real) random -> real', 'any')).toBe(true);
    expect(sub('(real) random -> real', 'unknown')).toBe(true);
  });
});

describe('effect-aware structural equality', () => {
  test('two signatures differing only in effects are not equal', () => {
    expect(typeToString(parseType('(real) random -> real'))).not.toBe(
      typeToString(parseType('(real) -> real'))
    );
    expect(
      new BoxedType('(real) random -> real').is(parseType('(real) -> real'))
    ).toBe(false);
    expect(
      new BoxedType('(real) random -> real').is(
        parseType('(real) scope -> real')
      )
    ).toBe(false);
    expect(
      new BoxedType('(real) scope random -> real').is(
        parseType('(real) random scope -> real')
      )
    ).toBe(true);
  });

  test('incomparable signatures do not merge in a union', () => {
    const t = reduceType({
      kind: 'union',
      types: [
        parseType('(real) random -> real'),
        parseType('(real) scope -> real'),
      ],
    } as Type);
    expect(typeToString(t)).toBe(
      '((real) random -> real) | ((real) scope -> real)'
    );
  });

  test('a union collapses only when one signature subsumes the other', () => {
    const t = reduceType({
      kind: 'union',
      types: [parseType('(real) -> real'), parseType('(real) random -> real')],
    } as Type);
    expect(typeToString(t)).toBe('(real) random -> real');

    const same = reduceType({
      kind: 'union',
      types: [
        parseType('(real) random -> real'),
        parseType('(real) random -> real'),
      ],
    } as Type);
    expect(typeToString(same)).toBe('(real) random -> real');
  });

  test('reduceType canonicalizes a hand-built effect set', () => {
    // WP2 builds signatures programmatically; `reduceType` sorts and
    // de-duplicates, and collapses an empty set to "absent" (≡ pure).
    const unsorted = reduceType({
      kind: 'signature',
      args: [{ type: 'real' }],
      effects: ['scope', 'random', 'scope'],
      result: 'real',
    } as Type) as FunctionSignature;
    expect(unsorted.effects).toEqual(['random', 'scope']);
    expect(typeToString(unsorted)).toBe('(real) random scope -> real');

    const empty = reduceType({
      kind: 'signature',
      args: [{ type: 'real' }],
      effects: [],
      result: 'real',
    } as Type) as FunctionSignature;
    expect(empty.effects).toBeUndefined();
    expect(typeToString(empty)).toBe('(real) -> real');
  });

  test('`matches()` is effect-aware and write-free', () => {
    const t = new BoxedType('(real) random -> real');
    const before = typeToString(t.type);
    expect(t.matches('(real) any -> real')).toBe(true);
    expect(t.matches('(real) -> real')).toBe(false);
    expect(t.matches('function')).toBe(true);
    // No mutation of either operand
    expect(typeToString(t.type)).toBe(before);
    expect(typeToString(parseType('(real) -> real'))).toBe('(real) -> real');
  });
});

describe('effect-set helpers', () => {
  test('normalizeEffectSet: absent and empty are the same state', () => {
    expect(normalizeEffectSet(undefined)).toBeUndefined();
    expect(normalizeEffectSet([])).toBeUndefined();
    expect(normalizeEffectSet(['random'])).toEqual(['random']);
    expect(normalizeEffectSet(['scope', 'random'])).toEqual([
      'random',
      'scope',
    ]);
    expect(normalizeEffectSet(['random', 'random'])).toEqual(['random']);
    expect(normalizeEffectSet('any')).toBe('any');
  });

  test('normalizeEffectSet fails closed on an unknown label', () => {
    // The label enumeration is closed: an unchecked programmatic caller must
    // not be able to register an unknown label (which the impurity table would
    // then classify as pure).
    expect(() => normalizeEffectSet(['bogus'] as any)).toThrow(
      /Unknown effect label `bogus`/
    );
    expect(() => normalizeEffectSet(['random', 'bogus'] as any)).toThrow(
      /Unknown effect label `bogus`/
    );
    // A bare string that is not `'any'` is not a collection of labels: the
    // characters of `'random'` are not effect labels.
    expect(() => normalizeEffectSet('random' as any)).toThrow(
      /Invalid effect set/
    );
    expect(() => normalizeEffectSet(42 as any)).toThrow(/Invalid effect set/);
    expect(() => normalizeEffectSet(null as any)).toThrow(/Invalid effect set/);
    // The error names every valid label
    expect(() => normalizeEffectSet(['bogus'] as any)).toThrow(
      new RegExp(EFFECT_LABELS.join(', '))
    );
    // Valid inputs are untouched
    expect(normalizeEffectSet(new Set(['scope', 'random']))).toEqual([
      'random',
      'scope',
    ]);
  });

  test('a hand-built empty effect set serializes as absent', () => {
    // An empty array is not a canonical effect set, but a hand-built signature
    // (one that never went through `normalizeEffectSet`/`reduceType`) may
    // carry one — it must not emit an empty specifier slot (double space).
    const pure = {
      kind: 'signature',
      args: [{ type: 'real' }],
      result: 'real',
    } as Type;
    const emptyEffects = {
      kind: 'signature',
      args: [{ type: 'real' }],
      effects: [],
      result: 'real',
    } as Type;
    expect(typeToString(emptyEffects)).toBe(typeToString(pure));
    expect(typeToString(emptyEffects)).toBe('(real) -> real');
  });

  test('isEffectSubset is the stateless subset test', () => {
    expect(isEffectSubset(undefined, undefined)).toBe(true);
    expect(isEffectSubset(undefined, ['random'])).toBe(true);
    expect(isEffectSubset(['random'], undefined)).toBe(false);
    expect(isEffectSubset(['random'], ['random', 'scope'])).toBe(true);
    expect(isEffectSubset(['random', 'scope'], ['random'])).toBe(false);
    expect(isEffectSubset(['random'], ['scope'])).toBe(false);
    expect(isEffectSubset('any', 'any')).toBe(true);
    expect(isEffectSubset(undefined, 'any')).toBe(true);
    expect(isEffectSubset(['random'], 'any')).toBe(true);
    expect(isEffectSubset('any', undefined)).toBe(false);
    expect(isEffectSubset('any', ['random'])).toBe(false);
  });

  test('sameEffectSet is order-insensitive', () => {
    expect(sameEffectSet(undefined, undefined)).toBe(true);
    expect(sameEffectSet(['scope', 'random'], ['random', 'scope'])).toBe(true);
    expect(sameEffectSet(['random'], undefined)).toBe(false);
    expect(sameEffectSet('any', ['random'])).toBe(false);
  });

  test('unionEffectSets: `any` absorbs, and there is no intersection', () => {
    expect(unionEffectSets(undefined, undefined)).toBeUndefined();
    expect(unionEffectSets(undefined, ['random'])).toEqual(['random']);
    expect(unionEffectSets(['scope'], ['random'])).toEqual(['random', 'scope']);
    expect(unionEffectSets(['random'], ['random'])).toEqual(['random']);
    expect(unionEffectSets('any', ['random'])).toBe('any');
    expect(unionEffectSets(['random'], 'any')).toBe('any');
    expect(unionEffectSets(undefined, 'any')).toBe('any');
  });
});

//
// Stage 2 (`docs/EFFECTS-MODEL.md`, "Discharge from `any`"): the INTERNAL
// co-finite value `any − D = ¬D`. It is a computed value only — never surface
// syntax, never stored on an arrow, never serialized — so these are algebra
// tests, and the comparison rules are the stateless ones given under
// "Complement form" (Subtyping).
//
describe('co-finite effect values (internal, computed)', () => {
  test('the representation cannot collide with an effect set', () => {
    expect(isCoFiniteEffects(coFiniteEffects(['random']))).toBe(true);
    expect(isCoFiniteEffects(undefined)).toBe(false);
    expect(isCoFiniteEffects('any')).toBe(false);
    expect(isCoFiniteEffects(['random'])).toBe(false);
  });

  test('¬∅ normalizes to the top, and the complement is canonical', () => {
    expect(coFiniteEffects([])).toBe('any');
    expect(coFiniteEffects(['scope', 'random', 'random'])).toEqual({
      not: ['random', 'scope'],
    });
  });

  test('subtraction: only `any` produces a co-finite value', () => {
    expect(subtractEffects('any', ['random'])).toEqual({ not: ['random'] });
    // The complement GROWS as more is discharged.
    expect(subtractEffects({ not: ['random'] }, ['scope'])).toEqual({
      not: ['random', 'scope'],
    });
    // A finite set is plain set difference; the empty set stays empty.
    expect(subtractEffects(['random', 'scope'], ['random'])).toEqual(['scope']);
    expect(subtractEffects(['random'], ['random'])).toBeUndefined();
    expect(subtractEffects(undefined, ['random'])).toBeUndefined();
    // Discharging nothing changes nothing.
    expect(subtractEffects('any', undefined)).toBe('any');
    expect(subtractEffects('any', [])).toBe('any');
  });

  test('union: `any` absorbs; a finite set SHRINKS a complement', () => {
    expect(unionComputedEffects({ not: ['random'] }, 'any')).toBe('any');
    expect(unionComputedEffects({ not: ['random'] }, undefined)).toEqual({
      not: ['random'],
    });
    expect(unionComputedEffects({ not: ['random'] }, ['scope'])).toEqual({
      not: ['random'],
    });
    // Adding back exactly what was removed returns the top.
    expect(unionComputedEffects({ not: ['random'] }, ['random'])).toBe('any');
    // Two complements INTERSECT.
    expect(
      unionComputedEffects({ not: ['random', 'scope'] }, { not: ['scope'] })
    ).toEqual({ not: ['scope'] });
  });

  test('subset: the three complement-form rules', () => {
    // finite ⊆ ¬N iff the positives avoid N
    expect(isComputedEffectSubset(['scope'], { not: ['random'] })).toBe(true);
    expect(isComputedEffectSubset(['random'], { not: ['random'] })).toBe(false);
    expect(isComputedEffectSubset(undefined, { not: ['random'] })).toBe(true);
    // ¬N₁ ⊆ ¬N₂ iff N₂ ⊆ N₁
    expect(
      isComputedEffectSubset({ not: ['random', 'scope'] }, { not: ['scope'] })
    ).toBe(true);
    expect(
      isComputedEffectSubset({ not: ['scope'] }, { not: ['random', 'scope'] })
    ).toBe(false);
    // co-finite ⊄ any finite set — it is version-open
    expect(isComputedEffectSubset({ not: ['random'] }, ['scope'])).toBe(false);
    expect(isComputedEffectSubset({ not: ['random'] }, undefined)).toBe(false);
    expect(isComputedEffectSubset({ not: ['random'] }, 'any')).toBe(true);
    // …and the top fits no complement
    expect(isComputedEffectSubset('any', { not: ['random'] })).toBe(false);
  });

  test('membership: mathematical vs. DECLARED (the frame axis)', () => {
    // Mathematically, ¬{random} contains every other label.
    expect(computedEffectsInclude({ not: ['random'] }, 'scope')).toBe(true);
    expect(computedEffectsInclude({ not: ['random'] }, 'random')).toBe(false);
    expect(computedEffectsInclude('any', 'random')).toBe(true);
    // But frame participation requires an EXPLICIT declaration: a co-finite
    // value arose from discharging an UNKNOWN body, so it never pins a frame —
    // the same ruling that makes `any` not pin.
    expect(hasDeclaredEffectLabel({ not: ['scope'] }, 'random')).toBe(false);
    expect(hasDeclaredEffectLabel('any', 'random')).toBe(false);
    expect(hasDeclaredEffectLabel(['random'], 'random')).toBe(true);
  });

  test('a co-finite value is never pure', () => {
    expect(isPureComputedEffects(undefined)).toBe(true);
    expect(isPureComputedEffects('any')).toBe(false);
    expect(isPureComputedEffects({ not: ['random'] })).toBe(false);
    // Even a complement of every current impurity: it is version-open.
    expect(isPureComputedEffects({ not: [...EFFECT_LABELS] })).toBe(false);
  });
});
