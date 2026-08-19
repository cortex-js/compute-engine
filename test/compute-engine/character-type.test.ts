/**
 * The `character` value model and its place in the type lattice
 * (Strings Phase 1, `docs/STRING_ROADMAP.md` — "The `character` value model").
 *
 * A `character` is exactly one user-perceived character: one NFC-normalized
 * grapheme cluster (UAX #29). It is a SCALAR and a DISJOINT sibling of
 * `string` — not a subtype in either direction — while `string` itself became
 * an indexed collection of characters and left `scalar`.
 *
 * Unicode assumptions are called out at each non-ASCII expectation. Grapheme
 * segmentation comes from the host's `Intl.Segmenter`, so these are pinned
 * against the Unicode version the CI Node ships (design constraint 11); no
 * snapshot tests over exotic clusters.
 */

import { isCharacter } from '../../src/compute-engine/boxed-expression/type-guards';
import { ComputeEngine } from '../../src/compute-engine';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// The D15 test corpus. Each is exactly ONE grapheme cluster.
/** Precomposed "e with acute", U+00E9. One code point, one cluster. */
const E_ACUTE_PRECOMPOSED = 'é';
/** Decomposed "e" + COMBINING ACUTE ACCENT (U+0065 U+0301). NFC folds it to
 * the precomposed form, so it is the SAME value as `E_ACUTE_PRECOMPOSED`. */
const E_ACUTE_DECOMPOSED = 'é';
/** A ZWJ family sequence: MAN + ZWJ + WOMAN + ZWJ + GIRL. Five code points
 * (three of them astral pairs), one grapheme cluster. */
const ZWJ_FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
/** The flag of France: the regional-indicator pair F + R. Two code points,
 * one grapheme cluster. */
const FLAG_FR = '\u{1F1EB}\u{1F1F7}';

describe('lattice placement', () => {
  test('`string` is an indexed collection of characters', () => {
    expect(ce.type('string').matches('indexed_collection<character>')).toBe(
      true
    );
    expect(ce.type('string').matches('collection')).toBe(true);
  });

  test('`string` is NO LONGER a scalar; `character` is one', () => {
    // The `scalar` branch of `value` is now "a boolean, a character, or a
    // number". A declaration `x: scalar` no longer admits a string.
    expect(ce.type('string').matches('scalar')).toBe(false);
    expect(ce.type('character').matches('scalar')).toBe(true);
  });

  test('`character` and `string` are mutually non-subtypes', () => {
    // Disjointness is what keeps a character from being statically iterable
    // while the runtime says it has no elements.
    expect(ce.type('character').matches('string')).toBe(false);
    expect(ce.type('string').matches('character')).toBe(false);
  });

  test('`string` and `list<character>` are SIBLINGS, not subtypes', () => {
    // Grapheme segmentation is not stable under concatenation, so a string is
    // not a list of its characters.
    expect(ce.type('list<character>').matches('string')).toBe(false);
    expect(ce.type('string').matches('list<character>')).toBe(false);
  });

  test('a string is NOT broadcast-eligible at the type level', () => {
    // The type-level mirror of runtime broadcast atomicity: `broadcastable<T>`
    // means "a T or an indexed collection of T", and a string is neither for
    // `T = character`, exactly as a tuple is not.
    expect(ce.type('string').matches('broadcastable<character>')).toBe(false);
  });

  test('the type parser accepts `character`', () => {
    expect(ce.type('character').toString()).toBe('character');
    expect(ce.type('list<character>').toString()).toBe('list<character>');
  });
});

describe('construction and validation', () => {
  test('`ce.character` builds a character value', () => {
    const c = ce.character('x');
    expect(c.type.toString()).toBe('character');
    expect(c.string).toBe('x');
    expect(c.operator).toBe('CharacterFrom');
    expect(c.isPure).toBe(true);
    expect(c.isCanonical).toBe(true);
  });

  test('`CharacterFrom` of a one-cluster literal canonicalizes to the value', () => {
    const c = ce.box(['CharacterFrom', "'x'"]);
    expect(c.type.toString()).toBe('character');
    expect(c.isSame(ce.character('x'))).toBe(true);
  });

  test('`CharacterFrom` accepts a multi-CODE-POINT single cluster', () => {
    // "One character" is one CLUSTER, not one code point.
    for (const s of [E_ACUTE_PRECOMPOSED, ZWJ_FAMILY, FLAG_FR]) {
      const c = ce.box(['CharacterFrom', { str: s }]);
      expect(c.type.toString()).toBe('character');
    }
  });

  test('a decomposed "é" is the SAME character as the precomposed one', () => {
    // NFC normalization at construction folds U+0065 U+0301 to U+00E9.
    const a = ce.box(['CharacterFrom', { str: E_ACUTE_DECOMPOSED }]);
    const b = ce.box(['CharacterFrom', { str: E_ACUTE_PRECOMPOSED }]);
    expect(a.isSame(b)).toBe(true);
  });

  test('an empty or multi-cluster string is a diagnostic, never a truncation', () => {
    for (const s of ['', 'ab', 'hello']) {
      const e = ce.box(['CharacterFrom', { str: s }]).evaluate();
      expect(e.operator).toBe('Error');
      expect(e.toString()).toContain('incompatible-type');
    }
  });

  test('`ce.character` THROWS on content that is not one cluster', () => {
    // The one-cluster criterion is a class invariant, enforced with a real
    // throw: `console.assert` is stripped from the minified production build,
    // so it would only hold in development. Callers that cannot check first
    // go through `CharacterFrom`, which reports a diagnostic instead.
    expect(() => ce.character('ab')).toThrow(/one grapheme cluster/);
    expect(() => ce.character('')).toThrow(/one grapheme cluster/);
  });

  test('a character is held WELL-FORMED, exactly as a string is', () => {
    // An unpaired UTF-16 surrogate has no defined segmentation or UTF-8
    // encoding, so both constructors replace it with U+FFFD. Were only
    // `BoxedString` doing it, the two values below would hold different text
    // and the character/string equality bridge would break.
    const c = ce.character('\ud800');
    const s = ce.string('\ud800');
    expect(c.string).toBe('�');
    expect(s.string).toBe('�');
    expect(c.isSame(s)).toBe(true);
    expect(s.isSame(c)).toBe(true);
    expect(c.hash).toBe(s.hash);
  });

  test('a non-literal operand keeps the call form', () => {
    ce.declare('sv', 'string');
    const e = ce.box(['CharacterFrom', 'sv']);
    expect(e.operator).toBe('CharacterFrom');
    expect(e.type.toString()).toBe('character');
  });
});

describe('equality and hashing bridge the two kinds', () => {
  test('a character equals the one-cluster string with the same content', () => {
    // A VALUE law (two values with identical scalar sequences are equal), not
    // a type conversion — the types stay disjoint.
    expect(ce.character('a').isSame(ce.string('a'))).toBe(true);
    expect(ce.string('a').isSame(ce.character('a'))).toBe(true);
  });

  test('the hash agrees with equality', () => {
    expect(ce.character('a').hash).toBe(ce.string('a').hash);
  });

  test('a character does NOT equal a longer string', () => {
    expect(ce.character('a').isSame(ce.string('ab'))).toBe(false);
    expect(ce.string('ab').isSame(ce.character('a'))).toBe(false);
  });

  test('two characters are equal iff their NFC content matches', () => {
    expect(ce.character('a').isSame(ce.character('a'))).toBe(true);
    expect(ce.character('a').isSame(ce.character('b'))).toBe(false);
    expect(
      ce.character(E_ACUTE_DECOMPOSED).isSame(ce.character(E_ACUTE_PRECOMPOSED))
    ).toBe(true);
  });

  test('`Equal` over a character and a string literal', () => {
    expect(
      ce.function('Equal', [ce.character('a'), ce.string('a')]).evaluate()
        .symbol
    ).toBe('True');
    expect(
      ce.function('Equal', [ce.character('a'), ce.string('b')]).evaluate()
        .symbol
    ).toBe('False');
  });
});

describe('ordering bridges only a ONE-cluster string', () => {
  test('a character orders against a one-cluster string', () => {
    expect(
      ce.function('Less', [ce.character('a'), ce.string('b')]).evaluate().symbol
    ).toBe('True');
    expect(
      ce.function('Less', [ce.character('b'), ce.string('a')]).evaluate().symbol
    ).toBe('False');
  });

  test('a character vs a LONGER string stays inert', () => {
    // A multi-cluster string is not a character, and the string model leaves
    // that mixed pair unordered (`docs/STRING_ROADMAP.md`) — so the comparison
    // must not answer `True` by
    // falling through to a prefix comparison.
    const expr = ce
      .function('Less', [ce.character('a'), ce.string('ab')])
      .evaluate();
    expect(expr.symbol).toBeUndefined();
    expect(expr.operator).toBe('Less');
  });
});

describe('serialization and the round-trip law', () => {
  test('`json` is the CharacterFrom call form', () => {
    expect(ce.character('x').json).toEqual(['CharacterFrom', "'x'"]);
  });

  test('`box(json(c))` is `c`', () => {
    for (const s of ['x', E_ACUTE_PRECOMPOSED, ZWJ_FAMILY, FLAG_FR]) {
      const c = ce.character(s);
      expect(ce.box(c.json).isSame(c)).toBe(true);
    }
  });

  test('a character PRINTS like the one-character string it denotes', () => {
    expect(ce.character('x').toString()).toBe('"x"');
    expect(ce.character('x').latex).toBe('\\text{x}');
  });

  test('`unicodeScalars` reports code points, not UTF-16 units', () => {
    // The flag is one cluster of TWO astral code points.
    expect(ce.character(FLAG_FR).unicodeScalars).toEqual([0x1f1eb, 0x1f1f7]);
  });
});

describe('conversion to and from strings', () => {
  test('`String(c)` is the one-cluster string', () => {
    const s = ce.function('String', [ce.character('x')]).evaluate();
    expect(s.type.toString()).toBe('string');
    expect(s.string).toBe('x');
  });

  test('`CharacterFrom(String(c))` is `c`', () => {
    // A single cluster always re-segments to itself.
    for (const s of ['x', E_ACUTE_PRECOMPOSED, ZWJ_FAMILY, FLAG_FR]) {
      const c = ce.character(s);
      const round = ce
        .function('CharacterFrom', [ce.function('String', [c]).evaluate()])
        .evaluate();
      expect(round.isSame(c)).toBe(true);
    }
  });
});

describe('literal narrowing at a `character` parameter', () => {
  const declareIdentity = (engine: ComputeEngine): void => {
    engine.declare('fc', '(character) -> character');
    engine.assign('fc', engine.parse('c \\mapsto c'));
  };

  test('a one-cluster string literal narrows', () => {
    declareIdentity(ce);
    const call = ce.function('fc', [ce.string('a')]);
    expect(call.isValid).toBe(true);
    // `isSame` bridges a character and its one-cluster string, so it cannot
    // witness narrowing by itself: assert the OPERAND was rewritten to a
    // character (the declared-signature route in `box.ts` used to discard
    // the substituted operand list and rebuild the call from the original
    // string operand). Both construction routes must agree.
    expect(isCharacter(call.op1)).toBe(true);
    expect(call.op1.type.toString()).toBe('character');
    const boxed = ce.box(['fc', "'a'"]);
    expect(isCharacter(boxed.op1)).toBe(true);
    expect(call.evaluate().isSame(ce.character('a'))).toBe(true);
  });

  test('a one-cluster NON-ASCII literal narrows too', () => {
    // Narrowing uses the same one-CLUSTER criterion `CharacterFrom` does.
    declareIdentity(ce);
    for (const s of [E_ACUTE_DECOMPOSED, ZWJ_FAMILY, FLAG_FR])
      expect(ce.function('fc', [ce.string(s)]).isValid).toBe(true);
  });

  test('a multi-cluster literal is a type error', () => {
    declareIdentity(ce);
    const call = ce.function('fc', [ce.string('ab')]);
    expect(call.isValid).toBe(false);
    expect(call.toString()).toContain('incompatible-type');
  });

  test('a `string`-TYPED expression does NOT implicitly convert', () => {
    // Only LITERALS narrow; a string-typed symbol must be written
    // `CharacterFrom(s)`.
    declareIdentity(ce);
    ce.declare('sv2', 'string');
    const call = ce.function('fc', [ce.symbol('sv2')]);
    expect(call.isValid).toBe(false);
    expect(call.toString()).toContain('incompatible-type');
  });
});

describe('`CharacterFrom` decides a LITERAL at canonicalization', () => {
  // The operand is written in the source, so its cluster count cannot change
  // between canonicalization and evaluation. Deciding it at canonicalization
  // is what makes the mistake visible to a static pass (`epsil check`), the
  // way a multi-cluster literal at a `character` parameter already is.

  test('an empty or multi-cluster LITERAL is an error VALUE, before evaluation', () => {
    for (const s of ['', 'ab', 'hello']) {
      const e = ce.box(['CharacterFrom', { str: s }]);
      expect(e.operator).toBe('Error');
      expect(e.toString()).toContain('incompatible-type');
      // Evaluating it changes nothing: the error is already the value.
      expect(e.evaluate().operator).toBe('Error');
    }
  });

  test('a NON-literal operand still keeps the call form for `evaluate`', () => {
    // Its text is unknown until the program runs, so canonicalization cannot
    // decide it; the same error appears when `evaluate` sees the value.
    ce.declare('sv3', 'string');
    const e = ce.box(['CharacterFrom', 'sv3']);
    expect(e.operator).toBe('CharacterFrom');
    ce.assign('sv3', ce.string('ab'));
    expect(ce.box(['CharacterFrom', 'sv3']).evaluate().operator).toBe('Error');
  });
});

describe('literal narrowing at a `character` DECLARATION and ASSIGNMENT', () => {
  // The same conversion argument validation performs at a `character`
  // parameter, reached through the same two helpers, so a declaration and a
  // call cannot disagree about which literals narrow.

  test('a one-cluster literal narrows at a typed `Declare`', () => {
    const r = ce.box(['Declare', 'cd', "'character'", { str: 'a' }]).evaluate();
    expect(r.type.toString()).toBe('character');
    expect(ce.box('cd').evaluate().isSame(ce.character('a'))).toBe(true);
  });

  test('the value carried in the ATTRIBUTES dictionary narrows too', () => {
    // `let c: character = "a"` lowers with the initializer inside the
    // attributes bag, not positionally.
    const r = ce
      .box(['Declare', 'cd2', "'character'", { dict: { value: { str: 'a' } } }])
      .evaluate();
    expect(ce.box('cd2').evaluate().isSame(ce.character('a'))).toBe(true);
    expect(r.isSame(ce.character('a'))).toBe(true);
  });

  test('a one-cluster NON-ASCII literal narrows at a declaration', () => {
    for (const [i, s] of [E_ACUTE_DECOMPOSED, ZWJ_FAMILY, FLAG_FR].entries()) {
      const name = `cd_nonascii_${i}`;
      ce.box(['Declare', name, "'character'", { str: s }]).evaluate();
      expect(ce.box(name).evaluate().type.toString()).toBe('character');
    }
  });

  test('a MULTI-cluster literal keeps failing with `incompatible-type`', () => {
    const r = ce
      .box(['Declare', 'cd3', "'character'", { str: 'ab' }])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('incompatible-type');
  });

  test('a `string`-TYPED symbol does NOT implicitly convert', () => {
    // Only a syntactic LITERAL narrows — the rule is on the raw operand, not
    // on what it evaluates to.
    ce.declare('sv4', 'string');
    ce.assign('sv4', ce.string('a'));
    const r = ce.box(['Declare', 'cd4', "'character'", 'sv4']).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('incompatible-type');
  });

  test('an ASSIGNMENT to a `character`-declared name narrows', () => {
    ce.declare('cd5', 'character');
    const r = ce.box(['Assign', 'cd5', { str: 'a' }]).evaluate();
    expect(r.isSame(ce.character('a'))).toBe(true);
    expect(ce.box('cd5').evaluate().type.toString()).toBe('character');
    // A multi-cluster literal still fails, and a string-typed symbol too.
    expect(ce.box(['Assign', 'cd5', { str: 'ab' }]).evaluate().operator).toBe(
      'Error'
    );
    expect(ce.box(['Assign', 'cd5', 'sv4']).evaluate().operator).toBe('Error');
  });

  test('an INFERRED type is not a narrowing target', () => {
    // An inferred type summarizes what has been stored so far, not a contract
    // the next store must satisfy — widening it is the normal outcome — so a
    // string literal assigned to such a name stays a string.
    ce.box(['Assign', 'cd6', ['CharacterFrom', "'a'"]]).evaluate();
    ce.box(['Assign', 'cd6', { str: 'b' }]).evaluate();
    expect(ce.box('cd6').evaluate().type.toString()).toBe('string');
  });
});

describe('narrowing declines at a union arm that ALREADY admits a string', () => {
  // Narrowing a `"a"` literal to a character is a service to the author, not a
  // silent reinterpretation: it only applies when the declared type has no
  // home for the literal as written. A union arm that already accepts a
  // string is such a home, so narrowing there would resolve the value to a
  // DIFFERENT arm than the one the author's literal matched.
  //
  // "Already accepts a string" is a SUBTYPE question, not a spelling one. The
  // check used to compare each top-level arm to the literal type `string`, so
  // a SUPERTYPE arm — `value`, `expression`, `any`, each of which admits a
  // string — was not recognized and the literal narrowed anyway.

  const declaredValueOf = (type: string, index: number): string => {
    const name = `u${index}`;
    ce.box(['Declare', name, `'${type}'`, { str: 'a' }]).evaluate();
    return ce.box(name).evaluate().type.toString();
  };

  test.each(['character | value', 'character | any', 'character | expression'])(
    'a SUPERTYPE arm (%s) keeps the literal a string',
    (type) => {
      expect(declaredValueOf(type, 0)).toBe('string');
    }
  );

  test('an explicit `string` arm keeps the literal a string, as before', () => {
    expect(declaredValueOf('character | string', 1)).toBe('string');
  });

  test.each(['character | integer', 'character | number', 'character'])(
    'a DISJOINT arm (%s) still narrows',
    (type) => {
      expect(declaredValueOf(type, 2)).toBe('character');
    }
  );
});
