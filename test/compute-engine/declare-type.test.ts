import { ComputeEngine } from '../../src/compute-engine';

//
// `DeclareType` — the engine form behind an Epsil `type` declaration.
//
// `["DeclareType", name, type, attributes?]` registers a type in the current
// lexical scope: nominal by default, a structural alias with an
// `alias -> True` attribute. The name and type operands are held raw
// (canonicalizing them would auto-declare the names as variables). The
// registration happens both at canonicalization time (so later statements in
// the same `Block` see the type) and at evaluation time; the two are
// idempotent.
//
// A type declaration mutates the engine's scope, so every block below uses a
// fresh `ComputeEngine`.
//

const ALIAS = ['Dictionary', ['KeyValuePair', 'alias', 'True']] as any;

/** True when `ce.type(name)` resolves. */
const resolves = (ce: ComputeEngine, name: string): boolean => {
  try {
    ce.type(name);
    return true;
  } catch {
    return false;
  }
};

describe('DeclareType nominal (box route)', () => {
  const ce = new ComputeEngine();

  test('evaluates to Nothing and registers the type', () => {
    const r = ce
      .box(['DeclareType', 'point', { str: 'tuple<x: integer, y: integer>' }])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('point').toString()).toBe('point');
  });

  test('is nominal: a structurally identical type does not match', () => {
    expect(
      ce.type('tuple<x: integer, y: integer>').matches(ce.type('point'))
    ).toBe(false);
  });
});

describe('DeclareType alias (box route)', () => {
  const ce = new ComputeEngine();

  test('`alias -> True` declares a structural alias', () => {
    const r = ce
      .box([
        'DeclareType',
        'point',
        { str: 'tuple<x: integer, y: integer>' },
        ALIAS,
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(
      ce.type('tuple<x: integer, y: integer>').matches(ce.type('point'))
    ).toBe(true);
  });
});

describe('DeclareType route parity', () => {
  test('`ce.function()` matches the box route', () => {
    const ce = new ComputeEngine();
    const r = ce
      .function('DeclareType', [
        ce.symbol('point'),
        ce.string('tuple<integer, integer>'),
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('point').toString()).toBe('point');
    // Nominal by default on this route too.
    expect(ce.type('tuple<integer, integer>').matches(ce.type('point'))).toBe(
      false
    );
  });

  test('a string name operand works like a symbol name', () => {
    const ce = new ComputeEngine();
    ce.box(['DeclareType', { str: 'point' }, { str: 'tuple<integer, integer>' }, ALIAS])
      .evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('point'))).toBe(
      true
    );
  });
});

describe('DeclareType with Declare', () => {
  test('a declared type can annotate a `Declare`', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'point',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    const r = ce
      .box(['Declare', 'p', { str: 'point' }, ['Tuple', 1, 2]])
      .evaluate();
    expect(r.toString()).toBe('(1, 2)');
    expect(ce.box('p').type.toString()).toBe('point');
  });

  test('regression: a host-declared type resolves on the box route', () => {
    // `Declare`'s evaluate handler used to call `parseType()` without the
    // engine's type resolver, so a user type name always failed to parse.
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<integer, integer>', { alias: true });
    const r = ce
      .box(['Declare', 'p', { str: 'point' }, ['Tuple', 1, 2]])
      .evaluate();
    expect(r.toString()).toBe('(1, 2)');
    expect(ce.box('p').type.toString()).toBe('point');
  });
});

describe('DeclareType redeclaration', () => {
  test('a second statement for the same name replaces the first', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(true);

    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<string, string, string>' },
      ALIAS,
    ]).evaluate();
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(
      false
    );
    expect(
      ce.type('tuple<string, string, string>').matches(ce.type('r'))
    ).toBe(true);
  });

  test('a host-declared type is not replaced: error value, definition intact', () => {
    const ce = new ComputeEngine();
    ce.declareType('q', 'tuple<integer, integer>', { alias: true });
    const r = ce
      .box(['DeclareType', 'q', { str: 'tuple<string, string>' }, ALIAS])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    // The host definition is untouched.
    expect(ce.type('tuple<integer, integer>').matches(ce.type('q'))).toBe(true);
    expect(ce.type('tuple<string, string>').matches(ce.type('q'))).toBe(false);
  });
});

describe('DeclareType is top-level only', () => {
  // Types are engine-global (ruled 2026-08-10): a `DeclareType` nested in a
  // Block (or any function body) is a hard error on the box route too, and
  // registers nothing.
  test('a DeclareType nested in a Block is an error and registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Block',
        ['DeclareType', 'localpt', { str: 'tuple<integer, integer>' }, ALIAS],
        42,
      ])
      .evaluate();
    expect(r.toString()).toContain('invalid-type-declaration');
    expect(resolves(ce, 'localpt')).toBe(false);
  });

  test('at the top level of the box route it registers', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['DeclareType', 'toppt', { str: 'tuple<integer, integer>' }, ALIAS])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(resolves(ce, 'toppt')).toBe(true);
  });

  test('a host-forged pre-pass frame name does not bypass the rule', () => {
    // The Epsil static pre-pass frame is a top-level surrogate, but it is
    // recognized by frame name AND the engine's internal
    // `_staticTypeCheckDepth` counter — a host pushing a scope with the same
    // public name must not be able to smuggle a nested DeclareType past the
    // top-level rule.
    const ce = new ComputeEngine();
    ce.pushScope(undefined, 'epsil:static-check');
    const r = ce
      .box(['DeclareType', 'forged', { str: 'integer' }, ALIAS])
      .evaluate();
    ce.popScope();
    expect(r.toString()).toContain('invalid-type-declaration');
    expect(resolves(ce, 'forged')).toBe(false);
  });
});

describe('DeclareType recursive body', () => {
  test('a self-referential type registers', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'DeclareType',
        'tree',
        {
          str: 'tuple<value: integer, left: type tree | nothing, right: type tree | nothing>',
        },
      ])
      .evaluate();
    expect(r.json).toBe('Nothing');
    expect(ce.type('tree').toString()).toBe('tree');
  });
});

describe('DeclareType errors', () => {
  test('an invalid type name is an error value and registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['DeclareType', { str: 'bad name' }, { str: 'integer' }])
      .evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    expect(resolves(ce, 'bad name')).toBe(false);
  });

  test('a malformed type expression is an error value and registers nothing', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['DeclareType', 'oops', { str: 'tuple<<>' }]).evaluate();
    expect(r.operator).toBe('Error');
    expect(r.toString()).toContain('invalid-type-declaration');
    // No dangling placeholder record is left behind.
    expect(resolves(ce, 'oops')).toBe(false);
  });

  test('a failed redeclaration leaves the previous definition intact', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareType',
      'r',
      { str: 'tuple<integer, integer>' },
      ALIAS,
    ]).evaluate();
    const r = ce.box(['DeclareType', 'r', { str: 'tuple<<>' }]).evaluate();
    expect(r.operator).toBe('Error');
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(true);
  });
});

//
// Forward references (`type name` inside a type body) — the spelling
// `doc/08-guide-types.md` documents for a mutually recursive set. The
// reference installs an empty type record; the later declaration must FULFILL
// that record in place rather than treat it as a redeclaration conflict, so
// the types that captured it resolve through to the definition.
//
describe('FORWARD REFERENCES', () => {
  test('a mutually recursive JSON definition closes', () => {
    const ce = new ComputeEngine();
    const alias = { alias: true };
    ce.declareType(
      'json',
      'nothing | boolean | number | string | type json_array | type json_object',
      alias
    );
    ce.declareType('json_array', 'list<json>', alias);
    ce.declareType('json_object', 'dictionary<json>', alias);

    // The forward-declared arms resolve, so `json` accepts its own recursive
    // shapes and rejects a non-JSON one.
    expect(ce.type('list<number>').matches('json')).toBe(true);
    expect(ce.type('dictionary<string>').matches('json')).toBe(true);
    expect(ce.type('list<list<string>>').matches('json')).toBe(true);
    expect(ce.type('(number) -> number').matches('json')).toBe(false);
  });

  // The arms must be ALIASES to be inhabited by plain values: a NOMINAL
  // forward-declared arm resolves just the same, but its inhabitants are
  // constructor applications, so a plain list is not one of them.
  test('a nominal forward-declared arm stays opaque', () => {
    const ce = new ComputeEngine();
    ce.declareType('njson', 'number | type njson_array');
    ce.declareType('njson_array', 'list<njson>');
    expect(ce.type('list<number>').matches('njson')).toBe(false);
  });

  test('the fulfilling declaration is visible through the capturing type', () => {
    const ce = new ComputeEngine();
    // `outer` captures the empty `inner` record before `inner` has a body.
    ce.declareType('outer', 'list<type inner>', { alias: true });
    ce.declareType('inner', 'integer', { alias: true });
    expect(ce.type('list<integer>').matches('outer')).toBe(true);
    expect(ce.type('list<string>').matches('outer')).toBe(false);
  });

  test('a completed declaration still conflicts', () => {
    const ce = new ComputeEngine();
    ce.declareType('done', 'integer');
    expect(() => ce.declareType('done', 'string')).toThrow(
      /already defined/
    );
  });

  test('a failed fulfillment leaves the reference unfulfilled, not broken', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'list<type pending>', { alias: true });
    expect(() => ce.declareType('pending', 'tuple<<>')).toThrow();
    // The promise is still open: a later, well-formed declaration fulfills it.
    ce.declareType('pending', 'integer', { alias: true });
    expect(ce.type('list<integer>').matches('holder')).toBe(true);
  });
});

//
// REVIEW FINDINGS (2026-08-06 dual review of the forward-reference change).
//
describe('FORWARD REFERENCES: review findings', () => {
  // A forward reference records the arity of every use that created it. A BARE
  // use captured the name with no arguments, so a declaration that turns it
  // generic would leave that type holding an unapplied generic reference,
  // which matches nothing. Since the parameterized-nominal work this is the
  // generalized ARITY diagnostic (design §4.2) rather than a blanket ban.
  test('a generic declaration cannot fulfill a BARE forward reference', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'list<type Gen>', { alias: true });
    expect(() =>
      ce.declareType('Gen', 'tuple<T, T>', { alias: true, typeParams: ['T'] })
    ).toThrow(/declared with 1 type parameter.*0 type arguments/);
  });

  // The rollback must restore the record to exactly what `forward()` created.
  // `_declaredByStatement` is set BEFORE the body parses, and the
  // redeclaration guard keys on it — so leaving it behind let a later
  // statement silently replace a type no statement had declared.
  test('a failed fulfillment does not mark the record statement-declared', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'list<type pending>', { alias: true });
    expect(() =>
      ce.declareType('pending', 'tuple<<>', { fromStatement: true })
    ).toThrow();
    // A host declaration now completes it — and stays protected.
    ce.declareType('pending', 'integer', { alias: true });
    expect(() =>
      ce.declareType('pending', 'string', { fromStatement: true, alias: true })
    ).toThrow(/already defined/);
    expect(ce.type('list<integer>').matches('holder')).toBe(true);
  });
});

//
// A statement re-declaration UPDATES THE RECORD IN PLACE.
//
// Every type that mentions a name captured the RECORD the scope holds, and an
// applied reference (`box<integer>`) captures it twice over — through a hard
// `decl` back-pointer as well as through `def`. Swapping in a fresh record on
// re-declaration therefore left those captures answering from the OLD
// definition: nodes parsed before and after a re-run disagreed about the same
// pair of types, and a mutually recursive set needed a third run to converge.
//
// Replacement is a write to the record, and the failure path is a
// snapshot-and-RESTORE (not the clear-and-reopen a forward-reference
// fulfilment rolls back to — clearing would leave a working type undefined).
//
describe('DeclareType statement replacement is IN PLACE', () => {
  /** The declaration record the resolver holds for `name`. */
  const recordOf = (ce: ComputeEngine, name: string) =>
    (ce as any)._typeResolver.resolve(name);

  test('the record object survives the replacement', () => {
    const ce = new ComputeEngine();
    ce.declareType('r', 'tuple<integer, integer>', {
      alias: true,
      fromStatement: true,
    });
    const before = recordOf(ce, 'r');
    ce.declareType('r', 'tuple<string, string>', {
      alias: true,
      fromStatement: true,
    });
    expect(recordOf(ce, 'r')).toBe(before);
    // …and it carries the NEW definition.
    expect(ce.type('tuple<string, string>').matches(ce.type('r'))).toBe(true);
    expect(ce.type('tuple<integer, integer>').matches(ce.type('r'))).toBe(
      false
    );
  });

  test('a dependent NOMINAL type follows the new definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('inner', 'tuple<integer, integer>', {
      alias: true,
      fromStatement: true,
    });
    ce.declareType('outer', 'list<inner>', {
      alias: true,
      fromStatement: true,
    });
    ce.declareType('inner', 'tuple<string, string>', {
      alias: true,
      fromStatement: true,
    });
    // `outer`'s body holds the SAME record, so it reads the new body.
    expect(ce.type('list<tuple<string, string>>').matches('outer')).toBe(true);
    expect(ce.type('list<tuple<integer, integer>>').matches('outer')).toBe(
      false
    );
  });

  test('a stale APPLIED node answers from the new definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('box', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    const staleInt = ce.type('box<integer>');
    const staleNum = ce.type('box<number>');
    expect(staleInt.matches(staleNum)).toBe(true);

    // A body that forces invariance, declared as such.
    ce.declareType('box', 'tuple<v: T, f: (T) -> nothing>', {
      typeParams: ['inout T'],
      fromStatement: true,
    });
    const freshInt = ce.type('box<integer>');
    const freshNum = ce.type('box<number>');

    // All four old/new combinations agree — the answer is a property of the
    // declaration, not of when a node happened to be parsed.
    expect(staleInt.matches(staleNum)).toBe(false);
    expect(freshInt.matches(freshNum)).toBe(false);
    expect(staleInt.matches(freshNum)).toBe(false);
    expect(freshInt.matches(staleNum)).toBe(false);
    // Invariance still relates a type to itself.
    expect(staleInt.matches(freshInt)).toBe(true);
    expect(freshInt.matches(staleInt)).toBe(true);
  });

  test('the generation is bumped (A5)', () => {
    const ce = new ComputeEngine();
    ce.declareType('g', 'integer', { alias: true, fromStatement: true });
    const before = ce._anyVersion;
    ce.declareType('g', 'string', { alias: true, fromStatement: true });
    expect(ce._anyVersion).toBeGreaterThan(before);
  });

  //
  // Rollback: a failing replacement must put the record back, field by field.
  //
  test('a failing replacement restores def, clause, variance and constructor', () => {
    const ce = new ComputeEngine();
    ce.declareType('bx', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    const record = recordOf(ce, 'bx');
    const built = ce.box(['bx', 1]).evaluate();
    expect(built.type.toString()).toBe('bx<finite_integer>');

    // A body that contradicts the (still declared) `out`.
    expect(() =>
      ce.declareType('bx', 'tuple<run: (T) -> nothing>', {
        typeParams: ['out T'],
        fromStatement: true,
      })
    ).toThrow(/variance-violation/);

    expect(recordOf(ce, 'bx')).toBe(record);
    expect(record.typeParams).toEqual([{ name: 'T', variance: 'out' }]);
    expect(record._varianceState).toBe('verified');
    // The definition, the variance and the constructor all still work.
    expect(ce.type('bx<integer>').matches('bx<number>')).toBe(true);
    expect(ce.box(['bx', 1]).evaluate().type.toString()).toBe(
      'bx<finite_integer>'
    );
    // A well-formed replacement still lands afterwards.
    ce.declareType('bx', 'tuple<v: T, w: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(ce.box(['bx', 1, 2]).evaluate().type.toString()).toBe(
      'bx<finite_integer>'
    );
  });

  test('a replacement that fails to parse restores the previous definition', () => {
    const ce = new ComputeEngine();
    ce.declareType('p', 'tuple<integer, integer>', {
      alias: true,
      fromStatement: true,
    });
    const record = recordOf(ce, 'p');
    expect(() =>
      ce.declareType('p', 'tuple<<>', { alias: true, fromStatement: true })
    ).toThrow();
    expect(recordOf(ce, 'p')).toBe(record);
    expect(record.alias).toBe(true);
    expect(ce.type('tuple<integer, integer>').matches(ce.type('p'))).toBe(true);
    // Still statement-declared, so a later statement may still replace it.
    ce.declareType('p', 'tuple<string, string>', {
      alias: true,
      fromStatement: true,
    });
    expect(ce.type('tuple<string, string>').matches(ce.type('p'))).toBe(true);
  });

  //
  // A dependent's declared variance is re-verified against the NEW definition:
  // the redeclaration is what makes it unsound, so the redeclaration fails.
  //
  test('a redeclaration that unsounds a dependent fails, attributed to the dependent', () => {
    const ce = new ComputeEngine();
    ce.declareType('w2', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('w1', 'tuple<w: w2<T>>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(ce.type('w1<integer>').matches('w1<number>')).toBe(true);

    let thrown: Error | undefined;
    try {
      // Sound on its own, but it flips `w2` to contravariant, which `w1`'s
      // `out T` no longer survives.
      ce.declareType('w2', 'tuple<run: (T) -> nothing>', {
        typeParams: ['in T'],
        fromStatement: true,
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('variance-violation');
    // Attributed to the DEPENDENT, naming the redeclaration as the trigger.
    expect(thrown!.message).toContain('parameter `T` of `w1`');
    expect(thrown!.message).toContain('surfaced when `w2` was declared');

    // Rolled back: `w2` keeps its previous body and `w1` is still covariant.
    expect(ce.type('w2<integer>').matches('w2<number>')).toBe(true);
    expect(ce.type('w1<integer>').matches('w1<number>')).toBe(true);
    expect(recordOf(ce, 'w1')._varianceState).toBe('verified');
    expect(recordOf(ce, 'w2')._varianceState).toBe('verified');
  });

  test('a redeclaration a dependent DOES survive lands', () => {
    const ce = new ComputeEngine();
    ce.declareType('d2', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('d1', 'tuple<w: d2<T>>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('d2', 'tuple<v: T, w: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(ce.type('d1<integer>').matches('d1<number>')).toBe(true);
    expect(ce.type('d2<integer>').matches('d2<number>')).toBe(true);
  });

  //
  // The replacement mechanism is the STATEMENT's alone: nothing here loosens
  // the host policy.
  //
  test('the host route still throws on any redeclaration', () => {
    const ce = new ComputeEngine();
    ce.declareType('h', 'integer', { alias: true });
    expect(() => ce.declareType('h', 'string', { alias: true })).toThrow(
      /already defined/
    );
    // …including with `fromStatement`, on a record no statement declared.
    expect(() =>
      ce.declareType('h', 'string', { alias: true, fromStatement: true })
    ).toThrow(/already defined/);
    // And a statement-declared record is not replaceable by the plain host
    // route either.
    ce.declareType('s', 'integer', { alias: true, fromStatement: true });
    expect(() => ce.declareType('s', 'string', { alias: true })).toThrow(
      /already defined/
    );
    expect(ce.type('integer').matches(ce.type('s'))).toBe(true);
  });
});

//
// Arity coherence under an in-place replacement.
//
// A dependent's body holds the application it was WRITTEN with (`a2<T>`, or a
// bare `b2`). Once the record is updated in place the dependent reads the new
// clause, so a re-declaration that changes the type-parameter count leaves that
// application matching nothing. Same failure semantics as the variance case:
// the REDECLARING statement fails and rolls back, and the message is
// attributed to the dependent, naming the redeclaration as the trigger. The
// code is the shared `generic-alias-arity` (spec §8 — codes are never twinned).
//
describe('DeclareType statement replacement: dependent ARITY', () => {
  const recordOf = (ce: ComputeEngine, name: string) =>
    (ce as any)._typeResolver.resolve(name);

  test('a changed PARAMETER COUNT fails, attributed to the dependent', () => {
    const ce = new ComputeEngine();
    ce.declareType('a2', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('a1', 'tuple<w: a2<T>>', {
      typeParams: ['out T'],
      fromStatement: true,
    });

    let thrown: Error | undefined;
    try {
      ce.declareType('a2', 'tuple<v: T, u: U>', {
        typeParams: ['out T', 'out U'],
        fromStatement: true,
      });
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown!.message).toContain('generic-alias-arity');
    expect(thrown!.message).toContain(
      'The definition of "a1" applies "a2" to 1 type argument'
    );
    expect(thrown!.message).toContain('declared with 2 type parameters');
    expect(thrown!.message).toContain('surfaced when `a2` was declared');

    // Rolled back: `a2` is still the one-parameter type both agree on.
    expect(recordOf(ce, 'a2').typeParams).toEqual([
      { name: 'T', variance: 'out' },
    ]);
    expect(ce.type('a2<integer>').matches('a2<number>')).toBe(true);
    expect(ce.type('a1<integer>').matches('a1<number>')).toBe(true);
  });

  test('GENERIC → PLAIN fails: the dependent still applies it', () => {
    const ce = new ComputeEngine();
    ce.declareType('b2', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('b1', 'tuple<w: b2<T>>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(() =>
      ce.declareType('b2', 'tuple<v: integer>', { fromStatement: true })
    ).toThrow(
      /generic-alias-arity[\s\S]*"b1" applies "b2" to 1 type argument[\s\S]*0 type parameters/
    );
    // Rolled back: still generic, still constructible at its clause.
    expect(recordOf(ce, 'b2').typeParams).toHaveLength(1);
    expect(ce.type('b2<integer>').toString()).toBe('b2<integer>');
  });

  test('PLAIN → GENERIC fails: a bare mention is an application at arity 0', () => {
    const ce = new ComputeEngine();
    ce.declareType('c2', 'tuple<v: integer>', { fromStatement: true });
    ce.declareType('c1', 'tuple<w: c2, v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(() =>
      ce.declareType('c2', 'tuple<v: U>', {
        typeParams: ['out U'],
        fromStatement: true,
      })
    ).toThrow(
      /generic-alias-arity[\s\S]*"c1" applies "c2" to 0 type arguments[\s\S]*1 type parameter/
    );
    expect(recordOf(ce, 'c2').typeParams).toBeUndefined();
    expect(ce.type('c2').toString()).toBe('c2');
  });

  test('an ALIAS dependent is covered too', () => {
    const ce = new ComputeEngine();
    ce.declareType('e2', 'integer', { alias: true, fromStatement: true });
    ce.declareType('e1', 'tuple<e2, integer>', {
      alias: true,
      fromStatement: true,
    });
    expect(() =>
      ce.declareType('e2', 'list<T>', {
        alias: true,
        typeParams: ['T'],
        fromStatement: true,
      })
    ).toThrow(/generic-alias-arity/);
    expect(ce.type('tuple<integer, integer>').matches('e1')).toBe(true);
  });

  test('an OBJECT dependent is covered: its field types are mentions too', () => {
    // The structural walk behind this re-check must descend into an
    // `object<…>` layout exactly as it does into a `record<…>` body. An
    // object layout is legal ONLY as the body of a named type declaration —
    // which is precisely what this walk reads — so a missed arm here means a
    // dependent object type silently keeps an application that now matches
    // nothing. `inout` is the only variance a stored field admits (ruling
    // B13), so both types use it.
    const ce = new ComputeEngine();
    ce.declareType('h2', 'tuple<v: T>', {
      typeParams: ['inout T'],
      fromStatement: true,
    });
    ce.declareType('h1', 'object<b: h2<T>>', {
      typeParams: ['inout T'],
      fromStatement: true,
    });
    expect(() =>
      ce.declareType('h2', 'tuple<v: T, u: U>', {
        typeParams: ['inout T', 'inout U'],
        fromStatement: true,
      })
    ).toThrow(
      /generic-alias-arity[\s\S]*"h1" applies "h2" to 1 type argument[\s\S]*2 type parameters/
    );
  });

  test('an OBJECT dependent is re-checked against a newly ADDED bound', () => {
    // The bounds half of the same walk: adding `T: integer` must reject the
    // `k1` layout that already applies `k2<string>`.
    const ce = new ComputeEngine();
    ce.declareType('k2', 'tuple<v: T>', {
      typeParams: ['inout T'],
      fromStatement: true,
    });
    ce.declareType('k1', 'object<b: k2<string>>', { fromStatement: true });
    expect(() =>
      ce.declareType('k2', 'tuple<v: T>', {
        typeParams: ['inout T: integer'],
        fromStatement: true,
      })
    ).toThrow(/generic-alias-bound/);
  });

  // The control: an arity-PRESERVING replacement under a dependent lands, both
  // for a plain type and for a parameterized one.
  test('an arity-preserving replacement with a dependent still succeeds', () => {
    const ce = new ComputeEngine();
    ce.declareType('f2', 'tuple<v: T>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('f1', 'tuple<w: f2<T>>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    ce.declareType('f2', 'tuple<v: T, extra: string>', {
      typeParams: ['out T'],
      fromStatement: true,
    });
    expect(ce.type('f1<integer>').matches('f1<number>')).toBe(true);
    expect(ce.type('f2<integer>').matches('f2<number>')).toBe(true);

    ce.declareType('g2', 'integer', { alias: true, fromStatement: true });
    ce.declareType('g1', 'tuple<g2, integer>', {
      alias: true,
      fromStatement: true,
    });
    ce.declareType('g2', 'string', { alias: true, fromStatement: true });
    // The dependent follows: an in-place update is what it reads.
    expect(ce.type('tuple<string, integer>').matches('g1')).toBe(true);
    expect(ce.type('tuple<integer, integer>').matches('g1')).toBe(false);
  });
});
