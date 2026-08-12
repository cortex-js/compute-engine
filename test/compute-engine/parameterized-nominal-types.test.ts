import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  freeTypeVariables,
  hasFreeTypeVariables,
  inferTypeArguments,
  substituteTypeVariables,
} from '../../src/common/type/instantiate';
import { parseType } from '../../src/common/type/parse';
import { declarationOf } from '../../src/common/type/reference';
import { typeToString } from '../../src/common/type/serialize';
import { provablyDisjoint, widen } from '../../src/common/type/subtype';
import type {
  FunctionSignature,
  Type,
  TypeReference,
} from '../../src/common/type/types';

//
// Parameterized NOMINAL types — `type tree<out T> = tuple<value: T, children:
// list<tree<T>>>` (`docs/plans/2026-08-06-parameterized-nominal-types-
// design.md`), PHASE 0 (representation).
//
// A nominal type is OPAQUE, so an applied reference is never expanded: the
// node KEEPS its arguments. That is the whole reason a recursive parametric
// type is expressible nominally and not as a transparent alias (§1), and it is
// the one representation change (§3).
//
// Phase 0 covers representation, parsing, declaration on all three routes,
// applied forward references, serialization and the `instantiate.ts` walkers.
// Subtyping is invariant here — the declared-variance rule of §4.3 is Phase 1
// — and no constructor is minted (Phase 2), so nothing below constructs a
// value, reads a field or matches.
//

/** The error code of a thrown type-layer failure. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const m =
      /(generic-alias-[a-z-]+|unsupported-variable-position|reserved-type-name|unsolvable-type-variable)/.exec(
        e instanceof Error ? e.message : String(e)
      );
    return m ? m[1] : `<no code: ${e instanceof Error ? e.message : e}>`;
  }
  return '<no error>';
}

/** Every `args`-bearing node reachable from `t`, by serialized name. Used to
 * pin the generic-ALIAS invariant: eager expansion means no application ever
 * reaches a consumer. `def` is NOT followed — a recursive nominal reaches
 * itself through it. */
function appliedReferencesIn(t: Type): string[] {
  const found: string[] = [];
  const walk = (x: Type): void => {
    if (typeof x !== 'object') return;
    switch (x.kind) {
      case 'reference':
        if (x.args !== undefined) {
          found.push(x.name);
          x.args.forEach(walk);
        }
        return;
      case 'signature':
        for (const a of [
          ...(x.args ?? []),
          ...(x.optArgs ?? []),
          ...(x.variadicArg ? [x.variadicArg] : []),
        ])
          walk(a.type);
        walk(x.result);
        return;
      case 'union':
      case 'intersection':
        x.types.forEach(walk);
        return;
      case 'negation':
        walk(x.type);
        return;
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
      case 'broadcastable':
        walk(x.elements);
        return;
      case 'tuple':
        x.elements.forEach((e) => walk(e.type));
        return;
      case 'dictionary':
        walk(x.values);
        return;
      case 'record':
        Object.values(x.elements).forEach(walk);
        return;
      default:
        return;
    }
  };
  walk(t);
  return found;
}

const TREE_BODY = 'tuple<value: T, children: list<tree<T>>>';

/** The three declaration routes, each producing the same `tree<out T>`. */
function hostEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declareType('tree', TREE_BODY, {
    typeParams: [{ name: 'T', variance: 'out' }],
  });
  return ce;
}

function boxEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  const r = ce
    .box([
      'DeclareType',
      'tree',
      { str: TREE_BODY },
      ['Dictionary', ['KeyValuePair', 'typeParams', { str: 'out T' }]],
    ])
    .evaluate();
  expect(r.toString()).toBe('"Nothing"');
  return ce;
}

function epsilEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, `type tree<out T> = ${TREE_BODY}\nlet a = 1\na`);
  expect(r.diagnostics.map((d) => d.message)).toEqual([]);
  return ce;
}

describe('PARAMETERIZED NOMINAL TYPES — declaration, three routes', () => {
  // `DeclareType` is `lazy: true`, so the box and parse routes hand the handler
  // UNBOUND operands; a suite that only exercised pre-boxed arguments would
  // miss that whole failure class.
  test.each([
    ['host', hostEngine],
    ['box', boxEngine],
    ['epsil statement', epsilEngine],
  ])('%s route registers the type', (_name, make) => {
    const ce = make();
    expect(ce.type('tree<integer>').toString()).toBe('tree<integer>');
  });

  test('the parse route agrees with the box route', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, `type tree<out T> = ${TREE_BODY}`);
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('tree<integer>').toString()).toBe('tree<integer>');
  });

  test('the declared variance is stored on the record', () => {
    for (const make of [hostEngine, boxEngine, epsilEngine]) {
      const ce = make();
      expect(ce._typeResolver.resolve('tree')?.typeParams).toEqual([
        { name: 'T', variance: 'out' },
      ]);
    }
  });

  // Every spelling is writable, and a REDUNDANT `out` (the default) is legal
  // so a generated declaration need not special-case it (§3.1). Each body is
  // one the marker VERIFIES against — Phase 1 checks the declared variance
  // against the position analysis (§4.4).
  test.each([
    ['in', 'tuple<run: (T) -> nothing>'],
    ['out', 'tuple<v: T>'],
    ['inout', 'tuple<v: T>'],
  ])('the `%s` marker is preserved', (v, body) => {
    const ce = new ComputeEngine();
    ce.declareType('box', body, {
      typeParams: `${v} T`,
    });
    expect(ce._typeResolver.resolve('box')?.typeParams).toEqual([
      { name: 'T', variance: v },
    ]);
  });

  test('an unmarked parameter carries no variance (the default is implied)', () => {
    const ce = new ComputeEngine();
    ce.declareType('box', 'tuple<v: T>', { typeParams: ['T'] });
    expect(ce._typeResolver.resolve('box')?.typeParams).toEqual([
      { name: 'T' },
    ]);
  });

  // The words are CONTEXTUAL — claimed only inside a clause, and only when a
  // name follows them.
  test('a parameter may still be NAMED `in`', () => {
    const ce = new ComputeEngine();
    ce.declareType('box', 'tuple<v: in>', { typeParams: 'in' });
    expect(ce._typeResolver.resolve('box')?.typeParams).toEqual([
      { name: 'in' },
    ]);
  });

  // Phase 2: a parameterized body mints a `where`-QUANTIFIED constructor
  // (§5). Its behavior is pinned in
  // `parameterized-nominal-constructor.test.ts`.
  test('a quantified constructor is minted', () => {
    const ce = hostEngine();
    expect(ce.box('tree').operatorDefinition?.signature.toString()).toBe(
      '(value: T, children: list<tree<T>>) -> tree<T> where T'
    );
  });
});

describe('PARAMETERIZED NOMINAL TYPES — application', () => {
  test('an application is OPAQUE: it keeps its arguments', () => {
    const ce = hostEngine();
    const t = ce.type('tree<integer>').type;
    expect(typeof t === 'object' && t.kind).toBe('reference');
    expect(appliedReferencesIn(t)).toEqual(['tree']);
  });

  test('it round-trips through its serialization', () => {
    const ce = hostEngine();
    const s = ce.type('tree<list<integer>>').toString();
    expect(s).toBe('tree<list<integer>>');
    expect(ce.type(s).toString()).toBe(s);
  });

  // A marker belongs to the DECLARATION; an application never carries one.
  test('an application serializes without a variance marker', () => {
    const ce = hostEngine();
    expect(ce.type('list<tree<integer>>').toString()).toBe(
      'list<tree<integer>>'
    );
  });

  test('`Type()` reports the applied spelling', () => {
    const ce = hostEngine();
    ce.declare('t', ce.type('tree<integer>'));
    expect(ce.box(['Type', 't']).evaluate().toString()).toBe('"tree<integer>"');
    expect(ce.parse('\\mathrm{Type}(t)').evaluate().toString()).toBe(
      '"tree<integer>"'
    );
  });

  // §6/N7 — one rule for both forms: a bare generic name is an arity error,
  // not `tree<unknown>`.
  test('a BARE application is an arity error', () => {
    const ce = hostEngine();
    expect(codeOf(() => ce.type('tree'))).toBe('generic-alias-arity');
  });

  test('the WRONG arity is an arity error', () => {
    const ce = hostEngine();
    expect(codeOf(() => ce.type('tree<integer, string>'))).toBe(
      'generic-alias-arity'
    );
    expect(codeOf(() => ce.type('tree<>'))).toBe('generic-alias-arity');
  });

  test('arguments on a NON-generic nominal type are an arity error', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
    expect(codeOf(() => ce.type('point<integer>'))).toBe('generic-alias-arity');
  });

  // §8 — the alias diagnostics are SHARED and generalized, never twinned.
  test('a bound is checked at the application', () => {
    const ce = new ComputeEngine();
    ce.declareType('num', 'tuple<v: T>', { typeParams: 'T: number' });
    expect(ce.type('num<integer>').toString()).toBe('num<integer>');
    expect(codeOf(() => ce.type('num<string>'))).toBe('generic-alias-bound');
  });

  test('a phantom parameter is rejected', () => {
    const ce = new ComputeEngine();
    expect(
      codeOf(() => ce.declareType('phantom', 'integer', { typeParams: ['T'] }))
    ).toBe('generic-alias-unused-parameter');
  });
});

describe('PARAMETERIZED NOMINAL TYPES — recursion', () => {
  // Opacity is what makes this work: the recursive `tree<T>` inside the body
  // needs no definition to be built, and the application it produces delegates
  // `def` to the record the declaration is still filling in.
  test('a recursive generic body declares and round-trips', () => {
    const ce = hostEngine();
    expect(ce.type('tree<integer>').toString()).toBe('tree<integer>');
    const body = ce._typeResolver.resolve('tree')!.def!;
    expect(appliedReferencesIn(body)).toEqual(['tree']);
  });

  test('the recursive occurrence resolves to the completed definition', () => {
    const ce = hostEngine();
    const body = ce._typeResolver.resolve('tree')!.def!;
    // `children: list<tree<T>>` — the inner application sees the body that was
    // set AFTER it was built.
    const inner = (body as any).elements[1].type.elements;
    expect(inner.kind).toBe('reference');
    expect(inner.def).toBe(body);
  });

  // The back edge to the declaration record, for the consumers that run below
  // the resolver (the variance-aware subtype rule, field access at an
  // instantiated body). It must stay NON-ENUMERABLE: the de-dup key drops
  // `def` BY NAME before `JSON.stringify`, so an enumerable back edge under
  // another name would re-introduce the circular-structure throw.
  test('an application reaches its declaration record', () => {
    const ce = hostEngine();
    const t = ce.type('tree<integer>').type as TypeReference;
    expect(declarationOf(t)).toBe(ce._typeResolver.resolve('tree'));
    expect(declarationOf(t).typeParams).toEqual([
      { name: 'T', variance: 'out' },
    ]);
    // A declaration record (and an unparameterized use) answers itself.
    const rec = ce._typeResolver.resolve('tree')!;
    expect(declarationOf(rec)).toBe(rec);
  });

  test('the back-pointer is not enumerable, and unions stay cycle-safe', () => {
    const ce = hostEngine();
    const t = ce.type('tree<integer>').type as TypeReference;
    expect(Object.keys(t)).not.toContain('decl');
    // `unionTypes` de-dups with `JSON.stringify` and a replacer that drops
    // `def` by name; anything else pointing back at the record would throw
    // "Converting circular structure to JSON".
    expect(
      ce.type(widen(t, ce.type('tree<string>').type)).toString()
    ).toContain('tree<integer>');
    expect(
      ce
        .type(
          widen(
            ce.type('list<tree<integer>>').type,
            ce.type('list<tree<string>>').type
          )
        )
        .toString()
    ).toBe('list<tree<integer>> | list<tree<string>>');
  });

  // Regression: the pre-existing NON-generic recursive nominal type is
  // untouched by the applied-reference node.
  test('a recursive NON-generic nominal type still works', () => {
    const ce = new ComputeEngine();
    ce.declareType('rtree', 'tuple<value: integer, children: list<rtree>>');
    expect(ce.type('rtree').toString()).toBe('rtree');
    expect(ce.type('rtree').matches('rtree')).toBe(true);
    expect(appliedReferencesIn(ce.type('rtree').type)).toEqual([]);
  });
});

describe('PARAMETERIZED NOMINAL TYPES — subtyping', () => {
  test('two applications relate argument-wise', () => {
    const ce = hostEngine();
    expect(ce.type('tree<integer>').matches('tree<integer>')).toBe(true);
    expect(ce.type('tree<integer>').matches('tree<string>')).toBe(false);
    // Granted by the declared `out` (Phase 1, §4.3); the full variance matrix
    // lives in `parameterized-nominal-variance.test.ts`.
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });

  test('two different nominal names never relate', () => {
    const ce = hostEngine();
    ce.declareType('other', 'tuple<v: T>', { typeParams: ['T'] });
    expect(ce.type('tree<integer>').matches('other<integer>')).toBe(false);
  });

  test('the zero-parameter case is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declareType('point', 'tuple<number, number>');
    expect(ce.type('point').matches('point')).toBe(true);
  });

  // §3/§10 — `provablyDisjoint` must NOT read disjointness off the arguments.
  // Invariance says two applications do not SUBTYPE each other; it does not say
  // their inhabitants are disjoint, and over-claiming here feeds negation
  // subtyping (`A <: !B`) and is unsound. The witness: a body combining
  // `list<T>` with a contravariant `(T) -> nothing` field is inhabited by an
  // empty list plus an `any` callback at BOTH instantiations.
  test('two applications are NOT provably disjoint', () => {
    const ce = new ComputeEngine();
    // `T` occurs both covariantly and contravariantly, so `inout` is the only
    // marker the body verifies against (§4.4).
    ce.declareType('handler', 'tuple<log: list<T>, run: (T) -> nothing>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    const a = ce.type('handler<integer>').type;
    const b = ce.type('handler<string>').type;
    // In-file positive control: `provablyDisjoint` is not simply answering
    // `false` to everything, so the `false` above is a verdict, not a stub.
    expect(provablyDisjoint('integer', 'string')).toBe(true);
    expect(provablyDisjoint(a, b)).toBe(false);
    expect(ce.type('handler<integer>').isDisjointFrom('handler<string>')).toBe(
      false
    );
  });

  // Finding 9. Relating two applications by NAME alone read the per-parameter
  // variance off the RHS declaration and then applied it to the LHS's body —
  // the subtype rule requires two applications of the SAME declaration record
  // (`declarationOf` identity, `subtype.ts`). The original probe built two
  // same-name records in nested scopes; that scenario is unrepresentable now
  // that types are engine-global (ruled 2026-08-10): a second declaration of
  // the name is refused, so one name ⇒ one declaration record per engine, and
  // the record-identity guard remains as defense in depth (e.g. across
  // engines).
  test('a same-name redeclaration is refused: one declaration record per name', () => {
    const ce = new ComputeEngine();
    ce.declareType('box', 'tuple<v: T, f: (T) -> nothing>', {
      typeParams: [{ name: 'T', variance: 'inout' }],
    });
    const outerInt = ce.type('box<integer>');
    const outerNum = ce.type('box<number>');
    ce.pushScope();
    expect(() =>
      ce.declareType('box', 'tuple<v: T>', {
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).toThrow(/already defined/);
    ce.popScope();

    // The one declaration is untouched: `inout` still refuses to widen.
    expect(outerInt.matches(outerNum)).toBe(false);
    expect(outerInt.matches('box<integer>')).toBe(true);
  });

  test('a `typeToString`/re-parse round trip still relates', () => {
    const ce = hostEngine();
    const round = ce.type(
      parseType(typeToString(ce.type('tree<integer>').type), ce._typeResolver)
    );
    expect(round.matches('tree<number>')).toBe(true);
    expect(ce.type('tree<integer>').matches(round)).toBe(true);
  });
});

// Sound#7 — `type r<T> = r<T>` was accepted: `type-builder.ts` gates its
// self-reference diagnostic on `record.alias === true`, and a nominal body
// reaches that site legitimately (a recursive occurrence is the whole feature).
// A body that is NOTHING BUT the self-application defines nothing at all.
describe('PARAMETERIZED NOMINAL TYPES — vacuous self-application', () => {
  test('a body that is only an application of itself is rejected', () => {
    const ce = new ComputeEngine();
    expect(codeOf(() => ce.declareType('r', 'r<T>', { typeParams: ['T'] }))).toBe(
      'generic-alias-self-reference'
    );
    // Nothing was declared: the placeholder is rolled back.
    expect((ce.context.lexicalScope.types ?? {})['r']).toBeUndefined();
  });

  test('recursion UNDER structure stays legal', () => {
    const ce = new ComputeEngine();
    ce.declareType('rec', 'tuple<v: T, c: list<rec<T>>>', {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    expect(ce.type('rec<integer>').matches('rec<number>')).toBe(true);
    ce.declareType('wrap', 'list<wrap<T>>', {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    expect(ce.type('wrap<integer>').toString()).toBe('wrap<integer>');
  });
});

describe('PARAMETERIZED NOMINAL TYPES — instantiate.ts walkers', () => {
  // §3: without traversing `args`, `(tree<T>) -> T where T` reads as GROUND,
  // and the signature would be rejected as "quantified but never used".
  test('a free variable is detected THROUGH an application', () => {
    const ce = hostEngine();
    // An OPEN type: `T` is seeded, as a declaration's own clause seeds a body.
    const open = parseType('tree<T>', ce._typeResolver, [{ name: 'T' }]);
    expect(hasFreeTypeVariables(open)).toBe(true);
    expect([...freeTypeVariables(open)]).toEqual(['T']);
    expect(hasFreeTypeVariables(ce.type('tree<integer>').type)).toBe(false);
  });

  test('a signature whose only variable sits inside an application is legal', () => {
    const ce = hostEngine();
    expect(ce.type('(tree<T>) -> T where T').toString()).toBe(
      '(tree<T>) -> T where T'
    );
  });

  // The solver's applied-reference unification rule: name equality plus
  // pairwise argument unification. `tree<T>` unifies with `tree<integer>`.
  test('the solver reaches a variable inside an application', () => {
    const ce = hostEngine();
    const arm = ce.type('(tree<T>) -> T where T').type as FunctionSignature;
    expect(
      inferTypeArguments(arm, [ce.type('tree<integer>').type])
    ).toMatchObject({ T: 'integer' });
    // …and through the public existential, which runs the same solver.
    expect(
      ce.type('(tree<integer>) -> integer').matches('(tree<T>) -> T where T')
    ).toBe(true);
  });

  test('a DIFFERENT nominal name does not unify', () => {
    const ce = hostEngine();
    ce.declareType('other', 'tuple<v: T>', { typeParams: ['T'] });
    const arm = ce.type('(tree<T>) -> T where T').type as FunctionSignature;
    expect(inferTypeArguments(arm, [ce.type('other<integer>').type])).toBe(
      null
    );
  });

  test('a different ARITY does not unify', () => {
    const ce = hostEngine();
    ce.declareType('pair', 'tuple<a: A, b: B>', { typeParams: ['A', 'B'] });
    const arm = ce.type('(tree<T>) -> T where T').type as FunctionSignature;
    expect(
      inferTypeArguments(arm, [ce.type('pair<integer, string>').type])
    ).toBe(null);
  });

  test('substitution reaches into an application but never through it', () => {
    const ce = hostEngine();
    const arm = ce.type('(T) -> tree<T> where T').type as FunctionSignature;
    const bindings = inferTypeArguments(arm, ['integer'])!;
    expect(typeToString(substituteTypeVariables(arm, bindings))).toBe(
      '(integer) -> tree<integer>'
    );
  });
});

describe('PARAMETERIZED NOMINAL TYPES — forward references (§4.2)', () => {
  // An applied use of a not-yet-declared name records its argument count; the
  // declaration that fulfills the promise is checked against every recorded
  // use. Variance/window semantics at fulfilment are Phase 1.
  test('the tree/forest pair declares cleanly', () => {
    const ce = new ComputeEngine();
    ce.declareType('tree', 'tuple<value: T, children: type forest<T>>', {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    ce.declareType('forest', 'list<tree<T>>', {
      typeParams: [{ name: 'T', variance: 'out' }],
    });
    expect(ce.type('tree<integer>').toString()).toBe('tree<integer>');
    expect(ce.type('forest<integer>').toString()).toBe('forest<integer>');
    // The capturing type resolves through to the fulfilled definition.
    const body = ce._typeResolver.resolve('tree')!.def!;
    const forestRef = (body as any).elements[1].type;
    expect(forestRef.kind).toBe('reference');
    expect(forestRef.def).toBe(ce._typeResolver.resolve('forest')!.def);
  });

  test('a fulfilment at the WRONG arity is the arity diagnostic', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'list<type later<T>>', { typeParams: ['T'] });
    expect(
      codeOf(() =>
        ce.declareType('later', 'tuple<A, B>', { typeParams: ['A', 'B'] })
      )
    ).toBe('generic-alias-arity');
    // The promise is still open: a well-formed declaration still fulfills it.
    ce.declareType('later', 'tuple<v: A>', { typeParams: ['A'] });
    expect(ce.type('later<integer>').toString()).toBe('later<integer>');
  });

  test('a BARE forward use pins the fulfilment to zero parameters', () => {
    const ce = new ComputeEngine();
    ce.declareType('holder', 'list<type later>', { alias: true });
    expect(
      codeOf(() =>
        ce.declareType('later', 'tuple<v: T>', { typeParams: ['T'] })
      )
    ).toBe('generic-alias-arity');
    ce.declareType('later', 'integer', { alias: true });
    expect(ce.type('list<integer>').matches('holder')).toBe(true);
  });
});

describe('PARAMETERIZED NOMINAL TYPES — regressions', () => {
  // The zero-unfold-site property of generic aliases is preserved verbatim: an
  // alias application is expanded eagerly, so no `args`-bearing node reaches
  // any consumer.
  test('a generic alias still expands eagerly, with no `args` node', () => {
    const ce = new ComputeEngine();
    ce.declareType('Duo', 'tuple<T, T>', { alias: true, typeParams: ['T'] });
    ce.declareType('Wrap', 'list<Duo<T>>', {
      alias: true,
      typeParams: ['T'],
    });
    expect(ce.type('Duo<integer>').toString()).toBe('tuple<integer, integer>');
    expect(appliedReferencesIn(ce.type('Duo<integer>').type)).toEqual([]);
    expect(ce.type('Wrap<integer>').toString()).toBe(
      'list<tuple<integer, integer>>'
    );
    expect(appliedReferencesIn(ce.type('Wrap<integer>').type)).toEqual([]);
    expect(appliedReferencesIn(ce._typeResolver.resolve('Wrap')!.def!)).toEqual(
      []
    );
  });

  // Variance is a property of a NOMINAL declaration: an alias is transparent,
  // so it has no relation between two applications to declare (§2).
  test('an alias clause REJECTS a variance marker on every route', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('Duo', 'tuple<T, T>', {
        alias: true,
        typeParams: 'out T',
      })
    ).toThrow(/cannot declare a variance/);
    expect(() =>
      ce.declareType('Duo', 'tuple<T, T>', {
        alias: true,
        typeParams: [{ name: 'T', variance: 'out' }],
      })
    ).toThrow(/cannot declare a variance/);

    const ce2 = new ComputeEngine();
    const r = ce2
      .box([
        'DeclareType',
        'Duo',
        { str: 'tuple<T, T>' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'out T' }],
        ],
      ])
      .evaluate();
    expect(r.toString()).toContain('invalid-type-declaration');

    const ce3 = new ComputeEngine();
    const r3 = executeEpsil(ce3, 'type alias Duo<out T> = tuple<T, T>');
    expect(r3.diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
    ]);
  });
});
