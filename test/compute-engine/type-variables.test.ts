import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';
import {
  collectionElementType,
  functionResult,
} from '../../src/common/type/utils';
import {
  freeTypeVariables,
  inferTypeArguments,
  solveTypeArguments,
  substituteTypeVariables,
} from '../../src/common/type/instantiate';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeCortex } from '../../src/cortex/execute-cortex';
import type { Type } from '../../src/common/type/types';

//
// Type variables (parametric polymorphism), PHASE 1 — the type layer only.
//
// `docs/plans/2026-08-01-type-variables-design.md`: a polytype is a `forall`
// clause prefixing a function signature. This file pins the type-layer half of
// the §11 test plan: parse/serialize round trips, per-arm α-equivalence, the
// §7.2 declaration-time rejections (with their exact error codes), the two
// polytype subtype rules that exist in v1, and the no-mutation invariant on
// substitution.
//
// APPLYING a generic function (call-site instantiation) is phase 2 and is
// deliberately not exercised here.
//

const ce = new ComputeEngine();

/** The type-variable error code carried by the thrown error's message. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const m = message.match(
      /(unresolved-type-variable|unsolvable-type-variable|unsupported-variable-position|reserved-type-name)/
    );
    return m ? m[1] : `(no code) ${message.replace(/\s+/g, ' ').trim()}`;
  }
  return '(did not throw)';
}

describe('PARSE / SERIALIZE ROUND TRIP', () => {
  // Every signature of §4.7, plus the effects-composed forms.
  const ROUND_TRIP = [
    'forall T. (T, T) -> T',
    'forall T. (list<T>) -> T',
    'forall T. (T?) -> list<T>',
    'forall T: number. (T?) -> list<T>',
    'forall T. (T+) -> list<T>',
    'forall T, U. (tuple<T, U>) -> tuple<U, T>',
    'forall T: indexed_collection. (T) -> T',
    'forall T: number. (T) -> T',
    'forall T. ((T) -> boolean, (T) -> boolean) -> T',
    'forall T. ((T) -> boolean, T) -> T',
    'forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V',
    'forall T: number, U. (list<T>, (T) any -> U) -> list<U>',
    'forall Elem. (list<Elem>) -> Elem',
    'forall T. (broadcastable<T>) -> T',
    'forall T. (set<T>, dictionary<T>, record<x: T>) -> T',
    'forall T. (collection<T>, indexed_collection<T>) -> T',
    // A bound may itself be a signature: the dot terminates the clause.
    'forall T: (real) -> real. (g: T) -> boolean',
    // Overload set: per-arm clauses, parenthesized.
    '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)',
    // Effects compose with the clause (the specifier slot sits between the
    // argument list and the arrow).
    'forall T. (T) random -> T',
    'forall T. (T) pure -> T',
    'forall T, U. (T, U) random scope -> U',
    'forall T. (T) any -> T',
  ];

  test.each(ROUND_TRIP)('%s round-trips', (s) => {
    expect(typeToString(parseType(s))).toBe(s);
  });

  test('the author’s variable names are preserved (never canonicalized)', () => {
    expect(ce.type('forall Widget. (list<Widget>) -> Widget').toString()).toBe(
      'forall Widget. (list<Widget>) -> Widget'
    );
    expect(ce.type('forall zz. (zz) -> zz').toString()).toBe(
      'forall zz. (zz) -> zz'
    );
  });

  test('a stated `pure` on a polytype arrow survives serialize → parse', () => {
    const t = ce.type('forall T. (T) pure -> T');
    expect(t.toString()).toBe('forall T. (T) pure -> T');
    expect(t.effects).toEqual([]);
    const reparsed = ce.type(t.toString());
    expect(reparsed.effects).toEqual([]);
    expect(reparsed.toString()).toBe('forall T. (T) pure -> T');
  });

  test('a polytype records its effects contract', () => {
    // NOTE: §11 spells this row `forall T, U. (T) random -> U`, which its own
    // §4.1 result-reachability rule rejects (`U` occurs only in the result);
    // the reachable form is used instead.
    expect(ce.type('forall T, U. (T, U) random -> U').effects).toEqual([
      'random',
    ]);
    expect(ce.type('forall T. (T) -> T').effects).toBeUndefined();
  });

  test('a quantified name shadows a known type name inside its arm', () => {
    const t = parseType('forall integer. (integer) -> integer');
    expect(typeToString(t)).toBe('forall integer. (integer) -> integer');
    expect((t as any).args[0].type).toEqual({
      kind: 'variable',
      name: 'integer',
    });
    // …and only inside its arm: the name is the primitive again afterwards.
    expect(parseType('(integer) -> integer')).toEqual({
      kind: 'signature',
      args: [{ type: 'integer' }],
      result: 'integer',
    });
  });

  test('the clause is represented on the signature', () => {
    expect(parseType('forall T: number, U. (T, U) -> T')).toMatchObject({
      kind: 'signature',
      typeParams: [{ name: 'T', bound: 'number' }, { name: 'U' }],
      args: [
        { type: { kind: 'variable', name: 'T' } },
        { type: { kind: 'variable', name: 'U' } },
      ],
      result: { kind: 'variable', name: 'T' },
    });
  });

  test('isPolymorphic is set on the boxed type', () => {
    expect(ce.type('forall T. (T) -> T').isPolymorphic).toBe(true);
    expect(
      ce.type('(forall T. (list<T>) -> T) & ((integer) -> integer)')
        .isPolymorphic
    ).toBe(true);
    expect(ce.type('(integer) -> integer').isPolymorphic).toBe(false);
    expect(ce.type('number').isPolymorphic).toBe(false);
  });
});

describe('α-EQUIVALENCE (Poly <: Poly, rule 3)', () => {
  const equivalent: [string, string][] = [
    ['forall T. (T) -> T', 'forall U. (U) -> U'],
    ['forall T. (T) -> T', 'forall T. (T) -> T'],
    ['forall T, U. (T, U) -> T', 'forall U, T. (U, T) -> U'],
    ['forall T. (list<T>) -> T', 'forall Elem. (list<Elem>) -> Elem'],
    ['forall T: number. (T) -> T', 'forall U: number. (U) -> U'],
    // `pure` and an absent effect specifier are the two spellings of the SAME
    // (empty) effect set — the generic path must not be stricter than the
    // ground one, which already treats them as equal.
    ['forall T. (T) pure -> T', 'forall U. (U) -> U'],
    ['forall T: number. (T) pure -> T', 'forall T: number. (T) -> T'],
    // The same letter in two arms of an overload set is two unrelated
    // variables: each arm renames independently.
    [
      '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)',
      '(forall A. (list<A>) -> A) & (forall B. (set<B>) -> boolean)',
    ],
  ];
  test.each(equivalent)('%s ≡ %s', (a, b) => {
    expect(isSubtype(parseType(a), parseType(b))).toBe(true);
    expect(isSubtype(parseType(b), parseType(a))).toBe(true);
  });

  const different: [string, string][] = [
    // Different shape, not a renaming.
    ['forall T, U. (T, U) -> T', 'forall T, U. (T, U) -> U'],
    ['forall T. (T, T) -> T', 'forall T, U. (T, U) -> T'],
    // Bounds are compared STRUCTURALLY.
    ['forall T: number. (T) -> T', 'forall U: integer. (U) -> U'],
    ['forall T: number. (T) -> T', 'forall U. (U) -> U'],
    // Effects still compose (and still differ).
    ['forall T. (T) random -> T', 'forall U. (U) -> U'],
  ];
  test.each(different)('%s ≢ %s', (a, b) => {
    expect(isSubtype(parseType(a), parseType(b))).toBe(false);
  });
});

describe('Ground <: Poly (rule 2) is FALSE', () => {
  test.each([
    ['(integer) -> integer', 'forall T. (T) -> T'],
    ['(number) -> number', 'forall T. (T) -> T'],
    ['(list<integer>) -> integer', 'forall T. (list<T>) -> T'],
  ])('%s is not a subtype of %s', (a, b) => {
    expect(isSubtype(parseType(a), parseType(b))).toBe(false);
    // NOTE (phase 2, D12): `BoxedType.matches` with a POLYMORPHIC PATTERN is
    // no longer `isSubtype` — it is the consistent existential
    // instantiate-and-check, so the same row answers `true` there. The two
    // predicates are pinned separately in "QUERY APIS" below; `isSubtype`
    // itself still implements rule 2.
    expect(ce.type(a).matches(b)).toBe(true);
  });

  test('rule 1 (Poly <: Ground) — instantiate-and-check (phase 2)', () => {
    expect(
      isSubtype(parseType('forall T. (T) -> T'), parseType('(number) -> number'))
    ).toBe(true);
    expect(
      isSubtype(
        parseType('forall T. (T) -> T'),
        parseType('(integer) -> integer')
      )
    ).toBe(true);
    // …and a polytype IS a function.
    expect(ce.type('forall T. (T) -> T').matches('function')).toBe(true);
  });
});

describe('DECLARATION-TIME VALIDATION (§7.2)', () => {
  test('result-only variable — unbounded AND bounded both reject', () => {
    expect(codeOf(() => ce.type('forall T. () -> list<T>'))).toBe(
      'unsolvable-type-variable'
    );
    expect(codeOf(() => ce.type('forall T: number. () -> list<T>'))).toBe(
      'unsolvable-type-variable'
    );
    expect(codeOf(() => ce.type('forall T. (integer) -> T'))).toBe(
      'unsolvable-type-variable'
    );
  });

  test('quantified but unused variable', () => {
    expect(codeOf(() => ce.type('forall T, U. (T) -> T'))).toBe(
      'unsolvable-type-variable'
    );
  });

  test('variable in an unsupported position', () => {
    expect(codeOf(() => ce.type('forall T. (T | string) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall T. (T & number) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall T. (!T) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall T. (list<T | string>) -> T'))).toBe(
      'unsupported-variable-position'
    );
  });

  test('a nested ARROW under a union is still a forbidden position', () => {
    // The nested signature does not re-open the position: reached from a union
    // arm, its own parameters and result stay forbidden.
    expect(codeOf(() => ce.type('forall T. (((T) -> T) | string) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(
      codeOf(() => ce.type('forall T. ((integer) -> (T | string)) -> T'))
    ).toBe('unsupported-variable-position');
    expect(
      codeOf(() => ce.type('forall T. (list<((T) -> boolean) & string>) -> T'))
    ).toBe('unsupported-variable-position');
    // …and an ordinary nested arrow, reached from an allowed position, is
    // still accepted.
    expect(
      ce.type('forall T, U. (collection<T>, (T) any -> U) -> collection<U>')
        .isPolymorphic
    ).toBe(true);
    expect(
      ce.type('forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V').isPolymorphic
    ).toBe(true);
  });

  test('non-ground bound (F-bounded, or referring to another variable)', () => {
    expect(codeOf(() => ce.type('forall T: list<T>. (T) -> T'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall U, T: list<U>. (T, U) -> T'))).toBe(
      'unsupported-variable-position'
    );
  });

  test('a clause on a non-signature, or on a bare intersection', () => {
    expect(codeOf(() => ce.type('forall T. list<T>'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall T. integer & string'))).toBe(
      'unsupported-variable-position'
    );
    expect(codeOf(() => ce.type('forall T. integer | string'))).toBe(
      'unsupported-variable-position'
    );
  });

  test('a NESTED clause — parameter, result, element or bound position', () => {
    expect(
      codeOf(() => ce.type('forall T. ((forall U. (U) -> U)) -> T'))
    ).toBe('unsupported-variable-position');
    expect(codeOf(() => ce.type('forall T. (T) -> (forall U. (U) -> U)'))).toBe(
      'unsupported-variable-position'
    );
    expect(
      codeOf(() => ce.type('forall T. (T) -> list<forall U. (U) -> U>'))
    ).toBe('unsupported-variable-position');
    expect(
      codeOf(() => ce.type('forall T: (forall U. (U) -> U). (T) -> T'))
    ).toBe('unsupported-variable-position');
  });

  test('a free variable outside a function signature (object route)', () => {
    expect(codeOf(() => ce.type({ kind: 'variable', name: 'T' } as Type))).toBe(
      'unresolved-type-variable'
    );
    expect(
      codeOf(() =>
        ce.type({
          kind: 'signature',
          typeParams: [{ name: 'T' }],
          args: [{ type: { kind: 'variable', name: 'U' } }],
          result: { kind: 'variable', name: 'T' },
        } as Type)
      )
    ).toBe('unresolved-type-variable');
  });

  test('a NESTED free variable is rejected on the object route too', () => {
    // Not just a bare variable at the top: an open type at ANY depth must not
    // box, or it escapes into the algebra (whose helpers assert on open input).
    expect(
      codeOf(() =>
        ce.type({
          kind: 'list',
          elements: { kind: 'variable', name: 'T' },
        } as Type)
      )
    ).toBe('unresolved-type-variable');
    expect(
      codeOf(() =>
        ce.type({
          kind: 'tuple',
          elements: [{ type: 'integer' }, { type: { kind: 'variable', name: 'T' } }],
        } as Type)
      )
    ).toBe('unresolved-type-variable');
    // A CLOSED object-route type is unaffected.
    expect(
      ce.type({ kind: 'list', elements: 'integer' } as Type).toString()
    ).toBe('list<integer>');
  });

  test('`__proto__` is a legal type-variable name (no prototype pollution)', () => {
    const engine = fresh();
    const SIGNATURE = 'forall __proto__. (__proto__) -> __proto__';
    expect(() => engine.declare('pid', { signature: SIGNATURE })).not.toThrow();
    expect(engine.lookupDefinition('pid')!.operator!.signature.toString()).toBe(
      SIGNATURE
    );
    const e = engine.box(['pid', 5]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('finite_integer');
    // The α-equivalence renaming map is prototype-free too.
    expect(isSubtype(parseType(SIGNATURE), parseType('forall U. (U) -> U'))).toBe(
      true
    );
    // Nothing leaked onto `Object.prototype`.
    expect(({} as any).name).toBeUndefined();
  });

  test('`forall` is a reserved type name', () => {
    const engine = new ComputeEngine();
    expect(codeOf(() => engine.declareType('forall', 'number'))).toBe(
      'reserved-type-name'
    );
  });

  test('a quantified name does not leak out of its arm', () => {
    // The second arm does not quantify `T`, so `T` is an unknown type there.
    expect(
      codeOf(() =>
        ce.type('(forall T. (list<T>) -> T) & ((set<T>) -> boolean)')
      )
    ).toMatch(/Unknown type "T"/);
  });
});

describe('NO BEHAVIOR CHANGE FOR EXISTING TYPE STRINGS', () => {
  test('undeclared variable-looking names still throw, as today', () => {
    expect(() => ce.type('T')).toThrow();
    expect(() => ce.type('list<T>')).toThrow();
    expect(() => ce.type('(T) -> T')).toThrow();
  });

  test('a leading `<` is still a parse error', () => {
    expect(() => ce.type('<T>(T) -> T')).toThrow();
    expect(() => ce.type('<T>')).toThrow();
  });

  test('a bare `forall` is a parse error', () => {
    expect(() => ce.type('forall')).toThrow();
    expect(() => ce.type('forall T (T) -> T')).toThrow(); // missing dot
    expect(() => ce.type('forall T, T. (T) -> T')).toThrow(); // duplicate name
  });

  test('ordinary types are unaffected', () => {
    expect(ce.type('(number, boolean) -> string').toString()).toBe(
      '(number, boolean) -> string'
    );
    expect(ce.type('integer<0..10>').toString()).toBe('integer<0..10>');
    expect(ce.type('(real) random -> real').effects).toEqual(['random']);
  });
});

describe('DIMENSIONED ACTUALS — the two collection readings (subtype.ts)', () => {
  // A dimensioned rank-n list (n >= 2) has two consistent readings as a
  // collection, and `isSubtype` must admit BOTH: the flat scalar-dtype reading,
  // and the PEELED reading the runtime uses (`collectionElementType`: "the
  // first element of a matrix is its first row"). Admitting only the first is
  // what made `forall T. (indexed_collection<T>, …)` reject the very matrix
  // operand whose element type pinned `T`.
  test('the peeled row reading is admitted', () => {
    const m = parseType('matrix<integer^(2x3)>');
    expect(typeToString(collectionElementType(m)!)).toBe('vector<integer^3>');
    expect(
      isSubtype(m, parseType('indexed_collection<vector<integer^3>>'))
    ).toBe(true);
    expect(isSubtype(m, parseType('collection<vector<integer^3>>'))).toBe(true);
  });

  test('the scalar-dtype reading is unchanged (additive, not replaced)', () => {
    const m = parseType('matrix<integer^(2x3)>');
    expect(isSubtype(m, parseType('indexed_collection<integer>'))).toBe(true);
    expect(isSubtype(m, parseType('collection<integer>'))).toBe(true);
  });

  test('a 1-D list is unaffected — there is no dimension to peel', () => {
    const v = parseType('list<string^2>');
    expect(typeToString(collectionElementType(v)!)).toBe('string');
    expect(isSubtype(v, parseType('indexed_collection<string>'))).toBe(true);
    expect(isSubtype(v, parseType('indexed_collection<list<string>>'))).toBe(
      false
    );
  });

  test('the peel is ONE dimension, and the row shape still has to match', () => {
    const m = parseType('matrix<integer^(2x3)>');
    expect(
      isSubtype(m, parseType('indexed_collection<vector<integer^2>>'))
    ).toBe(false);
    expect(isSubtype(m, parseType('indexed_collection<string>'))).toBe(false);
    // Rank 3 peels to rank 2, not to the scalar-plus-one.
    const t3 = parseType('list<integer^(2x3x4)>');
    expect(
      isSubtype(t3, parseType('indexed_collection<matrix<integer^(3x4)>>'))
    ).toBe(true);
    expect(
      isSubtype(t3, parseType('indexed_collection<matrix<integer^(2x4)>>'))
    ).toBe(false);
  });
});

describe('FREE VARIABLES AND SUBSTITUTION', () => {
  test('a polytype has no free variables; an open type does', () => {
    expect([...freeTypeVariables(parseType('forall T. (T) -> T'))]).toEqual([]);
    expect([
      ...freeTypeVariables({
        kind: 'list',
        elements: { kind: 'variable', name: 'T' },
      } as Type),
    ]).toEqual(['T']);
    expect([...freeTypeVariables(parseType('(integer) -> integer'))]).toEqual(
      []
    );
  });

  test('substitution instantiates the arm and removes the clause', () => {
    const poly = parseType('forall T. (list<T>, T) -> T');
    expect(typeToString(substituteTypeVariables(poly, { T: 'integer' }))).toBe(
      '(list<integer>, integer) -> integer'
    );
  });

  test('a partial substitution keeps the remaining clause entries', () => {
    const poly = parseType('forall T, U. (T, (U) -> T) -> list<U>');
    expect(typeToString(substituteTypeVariables(poly, { U: 'string' }))).toBe(
      'forall T. (T, (string) -> T) -> list<string>'
    );
  });

  test('NO-MUTATION PIN: substitution never writes into a shared polytype', () => {
    // `parseType` interns (and deep-freezes) resolver-less results, so the two
    // parses hand back the SAME object — the one a definition would store.
    const a = parseType('forall T. (list<T>, T) -> T');
    const b = parseType('forall T. (list<T>, T) -> T');
    expect(a).toBe(b);
    const before = JSON.stringify(a);

    const instantiated = substituteTypeVariables(a, { T: 'integer' });
    expect(typeToString(instantiated)).toBe(
      '(list<integer>, integer) -> integer'
    );

    // The cached polytype is structurally unchanged, and still a polytype.
    expect(JSON.stringify(a)).toBe(before);
    expect(JSON.stringify(b)).toBe(before);
    expect(typeToString(a)).toBe('forall T. (list<T>, T) -> T');
    expect(instantiated).not.toBe(a);
  });
});

describe('REBUILD INVARIANT (typeParams alongside effects)', () => {
  test('reduction preserves both adjunct fields', () => {
    const t = parseType('forall T. (list<T>) random -> T');
    // `reduceType` runs on every union/intersection member; going through a
    // reduced intersection exercises it on the arm.
    const reduced = parseType(
      '(forall T. (list<T>) random -> T) & (forall U. (set<U>) -> boolean)'
    );
    expect(typeToString(reduced)).toBe(
      '(forall T. (list<T>) random -> T) & (forall U. (set<U>) -> boolean)'
    );
    expect(typeToString(t)).toBe('forall T. (list<T>) random -> T');
  });
});

//
// ────────────────────────────────────────────────────────────────────────────
// PHASE 2 — call-site inference (§4.3–§4.7, §5, §8, §11 of the design)
// ────────────────────────────────────────────────────────────────────────────
//

/** A fresh engine per test: declarations and inferred symbol types are
 * engine-global, and several rows below deliberately narrow a symbol. */
function fresh(): ComputeEngine {
  return new ComputeEngine();
}

/** Solve `sig` (a polytype string) against ground actual type strings, and
 * report the substituted signature — or `FAIL` with the §8 detail lines. */
function solve(sig: string, actuals: string[], opts?: any): string {
  const arm = parseType(sig) as any;
  const r = solveTypeArguments(
    arm,
    actuals.map((a) => parseType(a)),
    opts
  );
  if (!r.matched) return 'NO MATCH';
  if (r.failures.length > 0)
    return `FAIL ${r.failures.map((f) => f.detail).join('; ')}`;
  return typeToString(substituteTypeVariables(arm, r.bindings));
}

/** The solved binding of `name`, as a string. */
function solvedVar(sig: string, actuals: string[], name: string): string {
  const arm = parseType(sig) as any;
  const r = solveTypeArguments(
    arm,
    actuals.map((a) => parseType(a))
  );
  return typeToString(r.bindings[name]);
}

describe('SOLVER — the §4.7 worked examples (unit)', () => {
  test('join of two lower bounds', () => {
    expect(solve('forall T. (T, T) -> T', ['integer', 'real'])).toBe(
      '(real, real) -> real'
    );
  });

  test('a non-inferable `unknown` ABSORBS (never raw `widen`)', () => {
    // `widen(unknown, integer)` is `integer`, which would OVERSTATE the result.
    expect(solve('forall T. (T, T) -> T', ['unknown', 'integer'])).toBe(
      '(unknown, unknown) -> unknown'
    );
  });

  test('only a TOP-LEVEL top type waives the declared bound (D8 provenance)', () => {
    // The D8 waiver exists because the GROUND path admits a top-typed operand
    // unconditionally (the unknown/`any` gate in `validateArguments`) — that
    // gate reads the WHOLE operand's type, so the waiver is for a bound
    // recorded at a bare-variable pattern, depth 0.
    for (const top of ['any', 'unknown']) {
      expect(solve('forall T: indexed_collection. (T) -> T', [top])).toBe(
        `(${top}) -> ${top}`
      );
      // NESTED under a constructor there is no such counterpart:
      // `isSubtype(tuple<any>, tuple<number>)` is false, so the bound is
      // enforced and the solve FAILS, exactly as the ground reading does.
      expect(solve('forall T: number. (tuple<T>) -> T', [`tuple<${top}>`])).toMatch(
        /^FAIL .*is declared with bound `number`/
      );
      // The JOIN itself is unchanged — `T` still solves to the top type.
      expect(solvedVar('forall T: number. (tuple<T>) -> T', [`tuple<${top}>`], 'T')).toBe(
        top
      );
    }
    // An UNBOUNDED variable is unaffected either way.
    expect(solve('forall T. (tuple<T>) -> T', ['tuple<any>'])).toBe(
      '(tuple<any>) -> any'
    );
  });

  test('element extraction from a list', () => {
    expect(solve('forall T. (list<T>) -> T', ['list<integer | string>'])).toBe(
      '(list<integer | string>) -> integer | string'
    );
  });

  test('S3 fallback — `unknown` when unbounded, the BOUND when bounded', () => {
    expect(solve('forall T. (T?) -> list<T>', [])).toBe(
      '(unknown?) -> list<unknown>'
    );
    expect(solve('forall T: number. (T?) -> list<T>', [])).toBe(
      '(number?) -> list<number>'
    );
    // Explicitly NOT `never` — an omitted optional must not type the result
    // "impossible".
    expect(solvedVar('forall T. (T?) -> list<T>', [], 'T')).not.toBe('never');
  });

  test('variadic fold — one bound per actual, all into the same variable', () => {
    expect(
      solve('forall T. (T+) -> list<T>', ['integer', 'real', 'rational'])
    ).toBe('(real+) -> list<real>');
  });

  test('tuple destructuring, two variables', () => {
    expect(
      solve('forall T, U. (tuple<T, U>) -> tuple<U, T>', [
        'tuple<integer, string>',
      ])
    ).toBe('(tuple<integer, string>) -> tuple<string, integer>');
  });

  test('bounded identity — the operand type VERBATIM, dimensions preserved', () => {
    expect(
      solve('forall T: indexed_collection. (T) -> T', ['matrix<integer^(2x3)>'])
    ).toBe('(matrix<integer^(2x3)>) -> matrix<integer^(2x3)>');
  });

  test('a violated DECLARED bound fails, naming the bound (§8)', () => {
    const r = solve('forall T: indexed_collection. (T) -> T', ['set<real>']);
    expect(r).toContain('FAIL');
    expect(r).toContain('bound `indexed_collection`');
    expect(r).toContain('set<real>');
  });

  test('§8 blame — a repeated variable blames the OFFENDING position', () => {
    /** The blamed operand index of the first bound failure. */
    const blame = (sig: string, actuals: string[]): number | undefined => {
      const arm = parseType(sig) as any;
      const r = solveTypeArguments(
        arm,
        actuals.map((a) => parseType(a))
      );
      return r.failures.find((f) => f.kind === 'bound')?.index;
    };
    // Under `(T, T) -> T` the JOIN violates the bound, but only ONE operand is
    // at fault: blaming the first PINNING position named the innocent one.
    expect(
      blame('forall T: number. (T, T) -> T', [
        'finite_integer',
        'matrix<integer^(2x2)>',
      ])
    ).toBe(1);
    expect(
      blame('forall T: number. (T, T) -> T', [
        'matrix<integer^(2x2)>',
        'finite_integer',
      ])
    ).toBe(0);
    // Deterministic: the EARLIEST individually-violating position, never the
    // last one, when several are at fault.
    expect(
      blame('forall T: number. (T, T) -> T', [
        'matrix<integer^(2x2)>',
        'string',
      ])
    ).toBe(0);
    expect(
      blame('forall T: number. (T, T, T) -> T', ['integer', 'real', 'string'])
    ).toBe(2);
    // A widening join (no union in sight) is blamed the same way: `real` is the
    // operand that does not fit `T: integer`.
    expect(
      blame('forall T: integer. (T, T) -> T', ['integer', 'real'])
    ).toBe(1);
    // The single-position case is unchanged.
    expect(blame('forall T: number. (T) -> T', ['string'])).toBe(0);
    // NOTE: the "every contribution individually satisfies the bound but the
    // JOIN does not" case is NOT constructible — the join is a least upper
    // bound, so `A <: B` and `C <: B` imply `widen(A, C) <: B`. The
    // fall-back-to-`pinnedBy[0]` arm is therefore defensive only.
  });

  test('D10 — a LIFT-admitted operand at a bare variable binds the FULL actual', () => {
    // Admission is checked at the scalar base by the lift gate (`integer <:
    // number`); the variable binds `list<integer>`, so the result is the
    // collection type — what today's echo handlers produce under broadcast.
    expect(
      solve('forall T: number. (T) -> T', ['list<integer>'], {
        lifted: () => true,
      })
    ).toBe('(list<integer>) -> list<integer>');
    // Without the lift flag the same call violates the declared bound.
    expect(solve('forall T: number. (T) -> T', ['list<integer>'])).toContain(
      'FAIL'
    );
  });

  test('compose — order-independent (2a fully before solve, then 2b)', () => {
    expect(
      solve('forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V', [
        '(real) -> string',
        '(integer) -> real',
      ])
    ).toBe('((real) -> string, (integer) -> real) -> (integer) -> string');
    // The same problem with the operands (and the clause) reversed.
    expect(
      solve('forall T, U, V. ((T) -> U, (U) -> V) -> (T) -> V', [
        '(integer) -> real',
        '(real) -> string',
      ])
    ).toBe('((integer) -> real, (real) -> string) -> (integer) -> string');
  });

  test('multi-callback upper bounds MEET', () => {
    expect(
      solvedVar(
        'forall T. ((T) -> boolean, (T) -> boolean) -> T',
        ['(integer) -> boolean', '(real) -> boolean'],
        'T'
      )
    ).toBe('integer');
  });

  test('DISJOINT upper bounds fail (empty meet)', () => {
    const r = solve('forall T. ((T) -> boolean, (T) -> boolean) -> T', [
      '(integer) -> boolean',
      '(string) -> boolean',
    ]);
    expect(r).toContain('FAIL');
    expect(r).toContain('incompatible requirements');
  });

  test('D8 — an absorbed `unknown` satisfies upper bounds PROVISIONALLY', () => {
    expect(
      solve('forall T. ((T) -> boolean, T) -> T', [
        '(integer) -> boolean',
        'unknown',
      ])
    ).toBe('((unknown) -> boolean, unknown) -> unknown');
  });

  test('`never` is NEUTRAL in the bound join (the `Concat([], [1])` shape)', () => {
    expect(
      solvedVar(
        'forall T. (list<T>, list<T>) -> list<T>',
        ['list<never>', 'list<integer>'],
        'T'
      )
    ).toBe('integer');
    // …and all-`never` still solves to `never`, not to `unknown`.
    expect(
      solvedVar(
        'forall T. (list<T>, list<T>) -> list<T>',
        ['list<never>', 'list<never>'],
        'T'
      )
    ).toBe('never');
  });

  test('a ground constructor mismatch does not match', () => {
    expect(solve('forall T. (list<T>) -> T', ['set<real>'])).toBe('NO MATCH');
  });

  test('§4.4 — `broadcastable<T>` binds through all THREE shapes', () => {
    expect(solvedVar('forall T. (broadcastable<T>) -> T', ['integer'], 'T')).toBe(
      'integer'
    );
    expect(
      solvedVar('forall T. (broadcastable<T>) -> T', ['list<real>'], 'T')
    ).toBe('real');
    expect(
      solvedVar('forall T. (broadcastable<T>) -> T', ['broadcastable<string>'], 'T')
    ).toBe('string');
  });

  test('a UNION actual distributes — every arm contributes a bound', () => {
    expect(
      solvedVar(
        'forall T. (list<T>) -> T',
        ['list<integer> | list<string>'],
        'T'
      )
    ).toBe('integer | string');
  });

  test('dimensioned element extraction matches `collectionElementType`', () => {
    // ONE index into a `matrix<integer^(2x3)>` is a ROW (`integer^3`), not the
    // scalar `integer`. The solver mirrors `collectionElementType` exactly.
    expect(
      typeToString(collectionElementType(parseType('matrix<integer^(2x3)>'))!)
    ).toBe('vector<integer^3>');
    expect(
      solvedVar('forall T. (list<T>) -> T', ['matrix<integer^(2x3)>'], 'T')
    ).toBe('vector<integer^3>');
  });

  test('dictionary and record element extraction matches `collectionElementType`', () => {
    // Indexing a dictionary/record yields a `(key, value)` ENTRY — the solver
    // mirrors `collectionElementType`, which the OBJECT (non-primitive) shapes
    // used to fall through, silently dropping the bound.
    expect(
      typeToString(collectionElementType(parseType('dictionary<number>'))!)
    ).toBe('tuple<string, number>');
    expect(
      solvedVar('forall T. (collection<T>) -> T', ['dictionary<number>'], 'T')
    ).toBe('tuple<string, number>');
    expect(
      typeToString(
        collectionElementType(parseType('record<a: integer, b: string>'))!
      )
    ).toBe('tuple<string, integer | string>');
    expect(
      solvedVar(
        'forall T. (collection<T>) -> T',
        ['record<a: integer, b: string>'],
        'T'
      )
    ).toBe('tuple<string, integer | string>');
    // End to end: the operand pins `T`; it does not fall to the S3 `unknown`.
    const ce = fresh();
    ce.declare('entryOf', { signature: 'forall T. (collection<T>) -> T' });
    const d = ce.box([
      'Dictionary',
      ['Tuple', ce.string('a'), 1],
      ['Tuple', ce.string('b'), 2],
    ]);
    const e = ce.box(['entryOf', d]);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('tuple<string, finite_integer>');
  });

  test('D10 waives ONLY the declared bound, not a positioned upper bound', () => {
    // The lift carve-out exists so the (collection) solution is not re-checked
    // against the SCALAR declared bound. An upper bound contributed
    // contravariantly by another position is a different constraint, and must
    // still be checked.
    const r = solve(
      'forall T: number. (T, (T) -> boolean) -> T',
      ['list<integer>', '(string) -> boolean'],
      { lifted: (i: number) => i === 0 }
    );
    expect(r).toContain('FAIL');
    expect(r).toContain('T <: string');
    // The bound itself is still waived: the plain lifted echo passes, and no
    // `bound` failure is reported.
    expect(
      solve('forall T: number. (T) -> T', ['list<integer>'], {
        lifted: () => true,
      })
    ).toBe('(list<integer>) -> list<integer>');
    // …and a COMPATIBLE positioned upper bound still solves.
    expect(
      solve(
        'forall T: number. (T, (T) -> boolean) -> T',
        ['list<integer>', '(list<number>) -> boolean'],
        { lifted: (i: number) => i === 0 }
      )
    ).toBe('(list<integer>, (list<integer>) -> boolean) -> list<integer>');
  });

  test('`inferTypeArguments` returns null exactly when a constraint fails', () => {
    const ok = inferTypeArguments(parseType('forall T. (T, T) -> T') as any, [
      'integer',
      'real',
    ]);
    expect(ok && typeToString(ok.T)).toBe('real');
    expect(
      inferTypeArguments(
        parseType('forall T: indexed_collection. (T) -> T') as any,
        ['set<real>']
      )
    ).toBeNull();
    expect(
      inferTypeArguments(parseType('forall T. (list<T>) -> T') as any, [
        'set<real>',
      ])
    ).toBeNull();
  });

  test('the solver is WRITE-FREE: the arm is structurally unchanged', () => {
    const arm = parseType('forall T: number. (list<T>, T) -> T');
    const before = JSON.stringify(arm);
    solveTypeArguments(arm as any, [
      parseType('list<integer>'),
      parseType('real'),
    ]);
    expect(JSON.stringify(arm)).toBe(before);
  });
});

describe('END TO END — a user-declared generic operator', () => {
  test('§4.7 rows, through `ce.declare` and a call', () => {
    const ce = fresh();
    ce.declare('idf', { signature: 'forall T. (T) -> T' });
    expect(ce.box(['idf', 5]).type.toString()).toBe('finite_integer');

    ce.declare('firstOf', { signature: 'forall T. (list<T>) -> T' });
    expect(ce.box(['firstOf', ['List', 1, 2, 3]]).type.toString()).toBe(
      'finite_integer'
    );

    ce.declare('swap', { signature: 'forall T, U. (tuple<T, U>) -> tuple<U, T>' });
    expect(
      ce.box(['swap', ['Tuple', 1, ce.string('a')]]).type.toString()
    ).toBe('tuple<string, finite_integer>');

    ce.declare('pack', { signature: 'forall T. (T+) -> list<T>' });
    expect(ce.box(['pack', 1, 2.5]).type.toString()).toBe('list<finite_real>');

    ce.declare('opt', { signature: 'forall T. (T?) -> list<T>' });
    expect(ce.box(['opt']).type.toString()).toBe('list<unknown>');
    ce.declare('optb', { signature: 'forall T: number. (T?) -> list<T>' });
    expect(ce.box(['optb']).type.toString()).toBe('list<number>');
  });

  test('bounded identity preserves kind AND dimensions', () => {
    const ce = fresh();
    ce.declare('rev', {
      signature: 'forall T: indexed_collection. (T) -> T',
    });
    const m = ce.box(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]);
    expect(m.type.toString()).toBe('matrix<finite_integer^(2x3)>');
    expect(ce.box(['rev', m]).type.toString()).toBe(
      'matrix<finite_integer^(2x3)>'
    );
  });

  test('a violated declared bound is an `incompatible-type` naming the BOUND (§8)', () => {
    const ce = fresh();
    ce.declare('rev', { signature: 'forall T: indexed_collection. (T) -> T' });
    const bad = ce.box(['rev', ['Set', 1, 2]]);
    expect(bad.isValid).toBe(false);
    // §8 rule 1: the displayed expected type is always GROUND.
    expect(bad.toString()).toContain('"indexed_collection"');
    expect(bad.toString()).toContain('set<finite_integer>');
    expect(bad.toString()).not.toContain('forall');
  });

  test('§8 blame — the OFFENDING operand carries the error, not the first one', () => {
    const ce = fresh();
    ce.declare('rem2', { signature: 'forall T: number. (T, T) -> T' });
    ce.declare('mtx', 'matrix<integer^(2x2)>');

    const bad = ce.box(['rem2', 5, 'mtx']);
    expect(bad.isValid).toBe(false);
    // The `5` is innocent — it satisfies `T: number` on its own. Blaming it
    // produced the self-contradictory "expected number, got finite_integer".
    expect(bad.op1.isValid).toBe(true);
    expect(bad.op1.toString()).toBe('5');
    expect(bad.op2.isValid).toBe(false);
    expect(bad.op2.toString()).toContain('matrix<integer^(2x2)>');
    expect(bad.op2.toString()).toContain('"number"');

    // Reversed: the offending operand is now first, and it is the one blamed.
    const rev = ce.box(['rem2', 'mtx', 5]);
    expect(rev.isValid).toBe(false);
    expect(rev.op1.isValid).toBe(false);
    expect(rev.op2.isValid).toBe(true);
    expect(rev.op2.toString()).toBe('5');

    // A widening join, no union: `real` is what does not fit `T: integer`,
    // and the reported actual is `real` — never the innocent `integer`.
    ce.declare('gInt', { signature: 'forall T: integer. (T, T) -> T' });
    ce.declare('iSym', 'integer');
    ce.declare('rSym', 'real');
    const g = ce.box(['gInt', 'iSym', 'rSym']);
    expect(g.isValid).toBe(false);
    expect(g.op1.isValid).toBe(true);
    expect(g.op2.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "real"))'
    );
  });

  test('`never` neutrality — the `Concat([], [1])` shape', () => {
    const ce = fresh();
    ce.declare('cat', {
      signature: 'forall T. (list<T>, list<T>) -> list<T>',
    });
    expect(ce.box(['cat', ['List'], ['List', 1]]).type.toString()).toBe(
      'list<finite_integer>'
    );
  });

  test('compose — the SAME answer with the operands in either order', () => {
    const ce = fresh();
    ce.declare('f1', '(real) -> string');
    ce.declare('f2', '(integer) -> real');
    ce.declare('comp', {
      signature: 'forall T, U, V. ((U) -> V, (T) -> U) -> (T) -> V',
    });
    ce.declare('flip', {
      signature: 'forall T, U, V. ((T) -> U, (U) -> V) -> (T) -> V',
    });
    expect(ce.box(['comp', 'f1', 'f2']).type.toString()).toBe(
      '(integer) -> string'
    );
    expect(ce.box(['flip', 'f2', 'f1']).type.toString()).toBe(
      '(integer) -> string'
    );
  });

  test('multi-callback meet, and the disjoint-uppers failure with §8 blame', () => {
    const ce = fresh();
    ce.declare('pInt', '(integer) -> boolean');
    ce.declare('pReal', '(real) -> boolean');
    ce.declare('pStr', '(string) -> boolean');
    ce.declare('both', {
      signature: 'forall T. ((T) -> boolean, (T) -> boolean) -> T',
    });
    expect(ce.box(['both', 'pInt', 'pReal']).type.toString()).toBe('integer');

    const bad = ce.box(['both', 'pInt', 'pStr']);
    expect(bad.isValid).toBe(false);
    // §8: the blamed operand is the conflicting one, and the expected type is
    // the GROUND arrow the other position pins.
    expect(bad.toString()).toContain('"(integer) -> boolean"');
    expect(bad.toString()).toContain('"(string) -> boolean"');
  });

  test('§8 lower-vs-upper conflict blames the callback', () => {
    const ce = fresh();
    ce.declare('sPred', '(string) -> boolean');
    ce.declare('keep', {
      signature: 'forall T. (list<T>, (T) -> boolean) -> list<T>',
    });
    const bad = ce.box(['keep', ['List', 1, 2, 3], 'sPred']);
    expect(bad.isValid).toBe(false);
    expect(bad.toString()).toContain('"(finite_integer) -> boolean"');
    expect(bad.toString()).toContain('"(string) -> boolean"');
  });

  test('D8 — an absorbed `unknown` operand does not reject the callback', () => {
    const ce = fresh();
    ce.declare('u', 'unknown'); // DECLARED unknown ⇒ non-inferable
    ce.declare('pInt', '(integer) -> boolean');
    ce.declare('d8', { signature: 'forall T. ((T) -> boolean, T) -> T' });
    const e = ce.box(['d8', 'pInt', 'u']);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('unknown');
  });

  test('D10 — a broadcastable echo at a collection operand', () => {
    const ce = fresh();
    ce.declare('neg2', {
      signature: 'forall T: number. (T) -> T',
      broadcastable: true,
    });
    expect(ce.box(['neg2', 5]).type.toString()).toBe('finite_integer');
    // Admission at the scalar base, `T` bound to the FULL actual.
    expect(ce.box(['neg2', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
  });

  test('D10 — the OPERATOR route echoes rank ≥ 2 without re-shaping it', () => {
    const ce = fresh();
    ce.declare('pEcho', {
      signature: 'forall T: number. (T) -> T',
      broadcastable: true,
    });
    // A GROUND broadcastable is the reference answer: the wrapper builds the
    // operand's shape around the scalar per-element result.
    ce.declare('gEcho', { signature: '(number) -> number', broadcastable: true });
    const m22 = ['List', ['List', 1, 2], ['List', 3, 4]] as any;
    expect(ce.box(['gEcho', m22]).type.toString()).toBe('matrix<2x2>');
    // The polytype arm binds `T` to the FULL actual under D10, so its result
    // ALREADY is that matrix. Unwrapping one level and re-shaping it produced
    // the mixed encoding `list<vector<finite_integer^2>^(2x2)>`.
    expect(ce.box(['pEcho', m22]).type.toString()).toBe(
      'matrix<finite_integer^(2x2)>'
    );
    // Rank 1 is unchanged (the re-shape happened to round-trip there).
    expect(ce.box(['pEcho', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['gEcho', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<3>'
    );
    // A declared collection-typed operand (not a literal) takes the same route.
    ce.declare('pm', 'matrix<integer^(2x2)>');
    expect(ce.box(['pEcho', 'pm']).type.toString()).toBe(
      'matrix<integer^(2x2)>'
    );
    // A UNION solution is a join over MORE than the echo (`Remainder(M, 7)`),
    // i.e. the widen artifact the broadcast wrapper exists to repair — it stays
    // on the wrapper path and keeps its definite `list<…>` shape.
    ce.declare('pRem', {
      signature: 'forall T: number. (T, T) -> T',
      broadcastable: true,
    });
    expect(ce.box(['pRem', m22, 7]).type.toString()).toBe(
      'list<finite_integer | vector<finite_integer^2>^(2x2)>'
    );
  });

  test('the D10 unwrap is for the TRUE echo shape only (value route)', () => {
    // The lifted-echo short circuit returns the solved result UNWRAPPED, which
    // is right only when the arm's result IS the bare variable: the lift
    // already bound the full collection to it. A result that merely MENTIONS
    // the variable wraps it, so the broadcast shape must be built as usual.
    const ce = fresh();
    ce.declare('vEcho', 'forall T. (T) -> T');
    ce.declare('vTuple', 'forall T. (T) -> tuple<T>');
    ce.declare('vList', 'forall T. (T) -> list<T>');
    const xs = ['List', 1, 2, 3] as any;
    expect(ce.box(['vEcho', xs]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(ce.box(['vTuple', xs]).type.toString()).toBe(
      'list<tuple<vector<finite_integer^3>>>'
    );
    expect(ce.box(['vList', xs]).type.toString()).toBe(
      'list<list<vector<finite_integer^3>>>'
    );
    // A BOUNDED echo is still an echo.
    ce.declare('vBounded', 'forall T: indexed_collection. (T) -> T');
    expect(ce.box(['vBounded', xs]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
  });

  test('a POLYTYPE actual is admitted against the instantiated expected arrow', () => {
    const ce = fresh();
    ce.declare('gid', 'forall T. (T) -> T');
    ce.declare('useIt', { signature: '((integer) -> integer, integer) -> integer' });
    expect(ce.box(['useIt', 'gid', 3]).isValid).toBe(true);
  });

  test('open expected × polytype actual — v1 declines to unify, then admits', () => {
    const ce = fresh();
    ce.declare('gp', 'forall U. (U) -> boolean');
    ce.declare('hof', { signature: 'forall T. ((T) -> boolean, T) -> T' });
    // The generic callback contributes NO bound; `T` is pinned by argument 2.
    expect(ce.box(['hof', 'gp', 3]).type.toString()).toBe('finite_integer');
    // With nothing else to pin it, `T` falls to S3.
    ce.declare('hof2', { signature: 'forall T. ((T) -> boolean) -> list<T>' });
    expect(ce.box(['hof2', 'gp']).type.toString()).toBe('list<unknown>');
  });
});

describe('GROUND-TYPE INVARIANT — no open type escapes as an expression type', () => {
  test('`functionResult` of a polytype is `unknown`, never the OPEN pattern', () => {
    // A dozen library `type:` handlers read `functionResult(callback.type)` and
    // pass it straight through (`Map(xs, genericFn)`).
    expect(typeToString(functionResult(parseType('forall T. (T) -> T'))!)).toBe(
      'unknown'
    );
    const ce = fresh();
    ce.declare('gid', 'forall T. (T) -> T');
    const mapped = ce.box(['Map', ['List', 1, 2, 3], 'gid']);
    expect(mapped.isValid).toBe(true);
    expect(freeTypeVariables(mapped.type.type).size).toBe(0);
  });

  test('a generic call’s result type is always ground', () => {
    const ce = fresh();
    ce.declare('g', { signature: 'forall T, U. (T, list<U>) -> tuple<T, U>' });
    for (const call of [
      ['g', 1, ['List', ce.string('a')]],
      ['g', 'undeclaredSym', ['List']],
      ['g', 1, 'notAList'],
    ] as any[]) {
      const e = ce.box(call);
      expect(freeTypeVariables(e.type.type).size).toBe(0);
    }
  });
});

describe('§5 — `Poly <: Ground` (rule 1) accepts only a COMPLETE match', () => {
  const rows: [string, string, boolean][] = [
    ['forall T. (T) -> T', '(number) -> number', true],
    ['forall T. (list<T>) -> T', '(list<integer>) -> integer', true],
    ['forall T. (T) -> T', '(integer) -> number', true],
    // Result covariance violated after a successful argument instantiation.
    ['forall T. (T) -> T', '(integer) -> string', false],
    // Effects: a `random` polytype does not fit a pure ground arrow…
    ['forall T. (T) random -> T', '(integer) -> integer', false],
    // …but a pure one fits an effect-permitting arrow.
    ['forall T. (T) -> T', '(integer) random -> integer', true],
    // Arity shape.
    ['forall T. (T) -> T', '(integer, integer) -> integer', false],
    // A top type NESTED under a constructor does not waive the declared bound
    // (D8 is a TOP-LEVEL waiver): the ground reading needs
    // `tuple<any> <: tuple<number>`, which is false, so no instantiation fits.
    // There is no runtime re-check on this route, so admitting it would be
    // unsound rather than merely optimistic.
    ['forall T: number. (tuple<T>) -> T', '(tuple<any>) -> any', false],
    ['forall T: number. (tuple<T>) -> T', '(tuple<unknown>) -> unknown', false],
    // Unbounded: unchanged.
    ['forall T. (tuple<T>) -> T', '(tuple<any>) -> any', true],
  ];
  test.each(rows)('%s <: %s → %s', (a, b, expected) => {
    expect(isSubtype(parseType(a), parseType(b))).toBe(expected);
  });
});

describe('GROUND-INVARIANT REGRESSION (§4.2 rule 1)', () => {
  // A previously-inferred symbol narrowed against a GENERIC parameter must end
  // with a GROUND type and must not throw — on all three narrow paths.
  const shapes: [string, (ce: ComputeEngine) => any][] = [
    ['forall T. (T) -> T', (ce) => ce.box(['g', 'q'])],
    ['forall T. (integer, T?) -> T', (ce) => ce.box(['g', 1, 'q'])],
    ['forall T. (T+) -> list<T>', (ce) => ce.box(['g', 'q'])],
  ];
  test.each(shapes)('%s narrows an inferred symbol to a ground type', (sig, call) => {
    const ce = fresh();
    ce.declare('g', { signature: sig });
    ce.box(['Add', 'q', 1]).evaluate(); // `q` is now INFERRED
    expect(() => call(ce)).not.toThrow();
    const e = call(ce);
    expect(e.isValid).toBe(true);
    // Ground: the symbol's type never mentions a type variable.
    expect(ce.box('q').type.toString()).not.toMatch(/\bT\b/);
    expect(freeTypeVariables(ce.box('q').type.type).size).toBe(0);
    expect(freeTypeVariables(e.type.type).size).toBe(0);
  });
});

describe('ADMISSION-GATE PARITY (§4.5)', () => {
  /** Accept/reject for a call, under a generic signature and under its ground
   * instantiation — they must agree. */
  function parity(
    generic: string,
    ground: string,
    build: (ce: ComputeEngine) => any,
    setup?: (ce: ComputeEngine) => void
  ): [boolean, boolean] {
    const a = fresh();
    setup?.(a);
    a.declare('p', { signature: generic });
    const b = fresh();
    setup?.(b);
    b.declare('p', { signature: ground });
    return [build(a).isValid, build(b).isValid];
  }

  test('inferable unknown symbol', () => {
    const [g, r] = parity(
      'forall T: number. (T) -> T',
      '(number) -> number',
      (ce) => ce.box(['p', 'z']),
      (ce) => {
        ce.box(['Add', 'z', 1]).evaluate();
      }
    );
    expect(g).toBe(r);
    expect(g).toBe(true);
  });

  test('NON-inferable unknown operand (D8)', () => {
    const [g, r] = parity(
      'forall T: number. (T) -> T',
      '(number) -> number',
      (ce) => ce.box(['p', 'u']),
      (ce) => ce.declare('u', 'unknown')
    );
    expect(g).toBe(r);
    expect(g).toBe(true);
  });

  test('NON-inferable `any` operand at a BOUNDED variable (D8, any arm)', () => {
    // `any` is the top type: it is a subtype of nothing but itself, so a
    // variable it absorbs would fail EVERY declared bound — while the ground
    // signature admits an `any` operand unconditionally (the unknown/any gate).
    // `any` therefore absorbs exactly as `unknown` does.
    const [g, r] = parity(
      'forall T: indexed_collection. (T) -> T',
      '(indexed_collection) -> indexed_collection',
      (ce) => ce.box(['p', 'a']),
      (ce) => ce.declare('a', 'any')
    );
    expect(g).toBe(r);
    expect(g).toBe(true);
    // The D8 `unknown` arm at the SAME bounded shape stays green.
    const [gu, ru] = parity(
      'forall T: indexed_collection. (T) -> T',
      '(indexed_collection) -> indexed_collection',
      (ce) => ce.box(['p', 'u']),
      (ce) => ce.declare('u', 'unknown')
    );
    expect(gu).toBe(ru);
    expect(gu).toBe(true);
    // A library witness of each: the bound is not re-checked, but a genuinely
    // wrong operand is still refused.
    const ce2 = fresh();
    ce2.declare('rvA', 'any');
    expect(ce2.function('Reverse', [ce2.box('rvA')]).isValid).toBe(true);
    expect(ce2.function('Reverse', [ce2.string('hello')]).isValid).toBe(false);
  });

  test('a NESTED top type is NOT waived — both routes refuse (D8 is top-level)', () => {
    // The D8 waiver above is for a top type arriving as the WHOLE operand's
    // type. Under a constructor there is no ground counterpart to preserve:
    // `(tuple<number>) -> number` refuses a `tuple<any>` operand, so the
    // generic reading must refuse it too rather than loosen past the ground
    // signature.
    for (const nested of ['tuple<any>', 'tuple<unknown>']) {
      const [g, r] = parity(
        'forall T: number. (tuple<T>) -> T',
        '(tuple<number>) -> number',
        (ce) => ce.box(['p', 'n']),
        (ce) => ce.declare('n', nested)
      );
      expect([nested, g, r]).toEqual([nested, false, false]);
    }
    // Control: the same shape with an in-bound element is admitted by both.
    const [g2, r2] = parity(
      'forall T: number. (tuple<T>) -> T',
      '(tuple<number>) -> number',
      (ce) => ce.box(['p', 'n']),
      (ce) => ce.declare('n', 'tuple<integer>')
    );
    expect([g2, r2]).toEqual([true, true]);
  });

  test('a refuted operand is refuted under BOTH', () => {
    const [g, r] = parity(
      'forall T: number. (T) -> T',
      '(number) -> number',
      (ce) => ce.box(['p', ce.string('nope')])
    );
    expect(g).toBe(r);
    expect(g).toBe(false);
  });

  test('broadcastable lift', () => {
    const a = fresh();
    a.declare('p', {
      signature: 'forall T: number. (T) -> T',
      broadcastable: true,
    });
    const b = fresh();
    b.declare('p', { signature: '(number) -> number', broadcastable: true });
    expect(a.box(['p', ['List', 1, 2]]).isValid).toBe(
      b.box(['p', ['List', 1, 2]]).isValid
    );
  });

  test('deferred (overlap-provisional) collection admission', () => {
    const [g, r] = parity(
      'forall T. (list<T>) -> T',
      '(list<number>) -> number',
      (ce) => ce.box(['p', 'c']),
      (ce) => ce.declare('c', 'list')
    );
    expect(g).toBe(r);
  });

  test('`Spread` defers all validation under both', () => {
    const [g, r] = parity(
      'forall T. (T, T) -> T',
      '(number, number) -> number',
      (ce) => ce.box(['p', ['Spread', ['Tuple', 1, 2]]]),
      (ce) => undefined
    );
    expect(g).toBe(r);
  });

  test('non-strict mode admits under both', () => {
    const a = fresh();
    a.strict = false;
    a.declare('p', { signature: 'forall T: number. (T) -> T' });
    const b = fresh();
    b.strict = false;
    b.declare('p', { signature: '(number) -> number' });
    expect(a.box(['p', a.string('nope')]).isValid).toBe(
      b.box(['p', b.string('nope')]).isValid
    );
  });
});

describe('LAZY-IDLE (§4.5 landmine ledger)', () => {
  // Named test: a `lazy: true` operator with a GENERIC signature performs no
  // inference and rejects no operand. If the lazy carve-out is ever closed,
  // this test must fail DELIBERATELY rather than silently activating every
  // dormant generic bound on the highest-traffic operators.
  test('a lazy operator with a generic signature stays idle', () => {
    const ce = fresh();
    ce.declare('lz', {
      signature: 'forall T: number. (list<T>) -> T',
      lazy: true,
      evaluate: (ops) => ops[0],
    });
    // An operand that flatly refutes the parameter is NOT rejected…
    const bad = ce.box(['lz', ce.string('not a list')]);
    expect(bad.isValid).toBe(true);
    // …and no bound is inferred: `T` falls to the S3 declared-bound fallback.
    expect(bad.type.toString()).toBe('number');
    expect(ce.box(['lz', ['List', 1, 2]]).type.toString()).toBe('number');
  });
});

describe('EFFECTS (§4.6) — substitution never touches the effects slot', () => {
  function probe(sig: string, callback: string): boolean {
    const ce = fresh();
    ce.declare('cb', callback);
    ce.declare('ap', { signature: sig });
    return ce.box(['ap', 'cb', 1]).isValid;
  }
  const ANY = 'forall T, U. ((T) any -> U, T) -> U';
  const PURE = 'forall T, U. ((T) -> U, T) -> U';

  test('`(T) any -> U` accepts pure, random and scope callbacks', () => {
    expect(probe(ANY, '(integer) -> string')).toBe(true);
    expect(probe(ANY, '(integer) random -> string')).toBe(true);
    expect(probe(ANY, '(integer) scope -> string')).toBe(true);
  });

  test('`(T) -> U` rejects effectful callbacks', () => {
    expect(probe(PURE, '(integer) -> string')).toBe(true);
    expect(probe(PURE, '(integer) random -> string')).toBe(false);
    expect(probe(PURE, '(integer) scope -> string')).toBe(false);
  });

  test('`effectsDeclared` is recorded from a polytype arrow', () => {
    // NOTE: §11 spells this row `forall T. (T) random -> U`, which its own
    // §4.1 result-reachability rule rejects (`U` occurs only in the result);
    // the reachable spelling is used instead.
    const ce = fresh();
    ce.declare('g', 'forall T, U. (T, U) random -> U');
    const def: any = ce.lookupDefinition('g');
    expect(def.value.effectsDeclared).toBe(true);
    expect(def.value.type.effects).toEqual(['random']);
  });
});

describe('D7 — the assignment boundary', () => {
  const D7 = /generic declaration cannot take a function-literal body/;

  test('route 1 — `ce.assign` throws a `TypeCompatibilityError`', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    let caught: any;
    try {
      ce.assign('f', ce.parse('x \\mapsto x'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.name).toBe('TypeCompatibilityError');
    expect(caught.message).toMatch(D7);
  });

  test('route 1b — declare-with-value throws the same diagnostic', () => {
    const ce = fresh();
    let caught: any;
    try {
      ce.declare('h', {
        type: 'forall T. (T) -> T',
        value: ce.parse('x \\mapsto x'),
      } as any);
    } catch (e) {
      caught = e;
    }
    expect(caught?.name).toBe('TypeCompatibilityError');
    expect(caught.message).toMatch(D7);
  });

  test('route 2 — the `Assign` OPERATOR yields an error VALUE, not a throw', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    const r = ce.box(['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']]);
    const v = r.evaluate();
    expect(v.toString()).toContain('incompatible-type');
    expect(v.toString()).toMatch(D7);
  });

  test('route 3 — a Cortex annotated declaration', () => {
    const ce = fresh();
    const { value } = executeCortex(ce, 'let f: forall T. (T) -> T = x |-> x');
    // The ANNOTATION parses (via the shared type DSL); the BODY is rejected.
    expect(value.toString()).toContain('incompatible-type');
    expect(value.toString()).toContain('forall T. (T) -> T');
    expect(value.toString()).toMatch(D7);
  });

  test('a NON-callable value is an ordinary mismatch, not the D7 case', () => {
    const ce = fresh();
    ce.declare('f', 'forall T. (T) -> T');
    let caught: any;
    try {
      // NOTE: a non-string operand would be LIFTED into a constant lambda by
      // `canonicalFunctionLiteral`, which IS the D7 case; a string is not.
      ce.assign('f', ce.string('nope'));
    } catch (e) {
      caught = e;
    }
    expect(caught?.message ?? '').not.toMatch(D7);
  });

  test('a `forall` annotation on a function LITERAL is rejected with D7', () => {
    const ce = fresh();
    // signature-string sugar
    const a = ce.box([
      'Function',
      ['Add', 'x', 1],
      { str: 'forall T. (x: T) -> T' },
    ] as any);
    expect(a.isValid).toBe(false);
    expect(a.toString()).toMatch(D7);
    // annotated PARAMETER (a rank-2 spelling)
    const b = ce.box([
      'Function',
      1,
      ['Typed', 'x', { str: 'forall T. (T) -> T' }],
    ] as any);
    expect(b.isValid).toBe(false);
    expect(b.toString()).toMatch(D7);
    // return-type ascription
    const c = ce.box([
      'Function',
      ['Typed', 1, { str: 'forall T. (T) -> T' }],
      'x',
    ] as any);
    expect(c.isValid).toBe(false);
    expect(c.toString()).toMatch(D7);
  });

  test('Cortex — a `forall` parameter annotation is rejected, not a parse error', () => {
    const ce = fresh();
    const { value, diagnostics } = executeCortex(
      ce,
      'f(x: forall T. (T) -> T) = 1'
    );
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toMatch(D7);
  });
});

describe('QUERY APIS (D6 + D12) — `matches` and `couldMatch` pinned SEPARATELY', () => {
  // NOTE: §11 spells three of these rows with a RESULT-ONLY variable
  // (`forall T. () -> list<T>`, `forall T. () -> tuple<T, T>`), which phase 1's
  // result-reachability rule rejects at declaration time (§4.1). The nearest
  // constructible analogues are used, and each row still exercises the
  // property §11 names.
  const ce2 = fresh();

  test('the identity probe — the row where the two predicates DIVERGE', () => {
    // D12: pattern-side `matches` is a consistent existential ⇒ true.
    expect(ce2.type('(number) -> number').matches('forall T. (T) -> T')).toBe(
      true
    );
    // D6: `couldMatch` reads each occurrence as its bound — `any` in a
    // CONTRAVARIANT position is the tightest reading, so ⇒ false.
    expect(ce2.type('(number) -> number').couldMatch('forall T. (T) -> T')).toBe(
      false
    );
  });

  test('a covariant row — same answer on both predicates', () => {
    // Purely COVARIANT occurrences: `T` under a callback PARAMETER is flipped
    // twice, so the bound-reading (`any`) is the loose one there too. (§11
    // spells this row `() -> list<T>`, which the result-reachability rule
    // rejects; this is the nearest constructible analogue.)
    const pattern = 'forall T. ((T) -> boolean) -> list<T>';
    const subject = ce2.type('((integer) -> boolean) -> list<integer>');
    expect(subject.matches(pattern)).toBe(true);
    expect(subject.couldMatch(pattern)).toBe(true);
  });

  test('a repeated-variable row — true on BOTH (via a genuine join)', () => {
    // `matches`: `T = integer | string` is a real solution (D12's corrected
    // claim on the record). `couldMatch`: the wildcard reading.
    const pattern = 'forall T. ((T) -> boolean) -> tuple<T, T>';
    const subject = ce2.type(
      '((integer | string) -> boolean) -> tuple<integer, string>'
    );
    expect(subject.matches(pattern)).toBe(true);
    expect(subject.couldMatch(pattern)).toBe(true);
  });

  test('a pattern with no consistent instantiation does NOT match', () => {
    expect(ce2.type('(integer) -> string').matches('forall T. (T) -> T')).toBe(
      false
    );
  });

  test('subject-side — a generic function `couldMatch` `function` and its bound', () => {
    expect(ce2.type('forall T. (T) -> T').couldMatch('function')).toBe(true);
    expect(ce2.type('forall T. (T) -> T').matches('function')).toBe(true);
    // A BOUNDED variable reads as its bound in the `couldMatch` reading.
    expect(
      ce2
        .type('forall T: indexed_collection. (T) -> T')
        .couldMatch('(indexed_collection) -> indexed_collection')
    ).toBe(true);
  });

  test('subject-side `matches` against a ground pattern is rule 1', () => {
    expect(ce2.type('forall T. (T) -> T').matches('(number) -> number')).toBe(
      true
    );
    expect(ce2.type('forall T. (T) -> T').matches('(number) -> string')).toBe(
      false
    );
  });

  test('a ground pattern still costs nothing (unchanged answers)', () => {
    expect(ce2.type('integer').matches('number')).toBe(true);
    expect(ce2.type('integer').couldMatch('number')).toBe(true);
    expect(ce2.type('string').matches('number')).toBe(false);
  });
});

describe('ROUTE PARITY — `ce.function`, `ce.box`, `ce.parse`', () => {
  test('a generic user operator types identically on all three routes', () => {
    const ce = fresh();
    ce.declare('firstOf', {
      signature: 'forall T. (list<T>) -> T',
      evaluate: (ops) => ops[0],
    });
    const viaFn = ce.function('firstOf', [ce.box(['List', 1, 2])]);
    const viaBox = ce.box(['firstOf', ['List', 1, 2]]);
    const viaParse = ce.parse('\\mathrm{firstOf}(\\lbrack 1, 2\\rbrack)');
    expect(viaFn.type.toString()).toBe('finite_integer');
    expect(viaBox.type.toString()).toBe('finite_integer');
    expect(viaParse.type.toString()).toBe('finite_integer');
    expect(viaFn.isValid && viaBox.isValid && viaParse.isValid).toBe(true);
  });
});

describe('COMPILE (§6)', () => {
  test('a CALL to a generic operator compiles (ground result)', () => {
    const ce = fresh();
    ce.declare('Echo', {
      signature: 'forall T: number. (T) -> T',
      compile: (args, compile, { language }) =>
        language === 'javascript' ? `(${compile(args[0])})` : undefined,
    });
    const target = ce.getCompilationTarget('javascript');
    const fn = target.compile(ce.parse('\\mathrm{Echo}(x) + 1'));
    expect(fn.run!({ x: 4 })).toEqual(5);
  });

  test('a generic user function itself DECLINES cleanly (no throw)', () => {
    const ce = fresh();
    ce.declare('gg', {
      signature: 'forall T. (T) -> T',
      evaluate: (ops) => ops[0],
    });
    expect(() => compile(ce.box(['gg', 'x']))).not.toThrow();
    expect(compile(ce.box(['gg', 'x']))?.code).toBe('');
  });
});

//
// PHASE 3a — overload sets × generics (§6 of the design, the `overload.ts`
// row). Each arm is instantiated INDEPENDENTLY at the call site; admissibility
// and specificity are computed on the INSTANTIATED arms; the viable-arm join
// that feeds operand inference therefore sees only ground types.
//

/** The minimal collection-handler set an operator needs to register, plus an
 * `at` handler unless `withAt` is false. */
function collectionHandlers(withAt = true): unknown {
  const handlers: Record<string, unknown> = {
    iterator: () => ({ next: () => ({ done: true, value: undefined }) }),
    count: () => 0,
  };
  if (withAt) handlers.at = () => undefined;
  return handlers;
}

describe('OVERLOADS × GENERICS (§6, per-arm instantiation)', () => {
  test('the same letter in two arms is two UNRELATED variables', () => {
    const ce = fresh();
    ce.declare('pick', {
      signature: '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)',
    });
    // The operand kind selects the arm, and each arm solves its own `T`.
    expect(ce.box(['pick', ['List', 1, 2, 3]]).type.toString()).toBe(
      'finite_integer'
    );
    expect(ce.box(['pick', ['Set', 1, 2]]).type.toString()).toBe('boolean');
    // An operand no arm admits: the diagnosis reports the INSTANTIATED
    // parameters, never a bare type variable.
    const bad = ce.box(['pick', ce.string('x')]);
    expect(bad.isValid).toBe(false);
    expect(bad.toString()).not.toContain('forall');
    expect(bad.toString()).not.toContain('"T"');
  });

  test('an arm whose declared BOUND is violated is not viable', () => {
    const ce = fresh();
    ce.declare('rv', {
      signature:
        '(forall T: indexed_collection. (T) -> T) & ((set<number>) -> number)',
    });
    // The bounded arm takes the list; the ground arm takes the set.
    expect(ce.box(['rv', ['List', 1, 2]]).type.toString()).toBe(
      'vector<finite_integer^2>'
    );
    expect(ce.box(['rv', ['Set', 1, 2]]).type.toString()).toBe('number');
  });

  test('the viable-arm JOIN feeding `joinParamAt` is GROUND', () => {
    const ce = fresh();
    ce.declare('g', {
      signature: '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> T)',
    });
    // An inferable unknown operand keeps BOTH arms viable, with different
    // bindings. Narrowing consumes the join of the two INSTANTIATED arms, so
    // the symbol ends ground — never narrowed to a type variable.
    const e = ce.box(['g', 'zz']);
    expect(e.isValid).toBe(true);
    const inferred = ce.box('zz').type.toString();
    expect(inferred).toBe('list<unknown> | set<unknown>');
    expect(inferred).not.toContain('T');
  });

  test('resolution is WRITE-FREE: the stored signature is unchanged', () => {
    const ce = fresh();
    ce.declare('wf', {
      signature: '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)',
    });
    const def = ce.lookupDefinition('wf')!.operator!;
    const before = JSON.stringify(def.signature.type);
    ce.box(['wf', ['List', 1, 2, 3]]).type;
    ce.box(['wf', ['Set', 1, 2]]).type;
    ce.box(['wf', ce.string('x')]).type;
    expect(JSON.stringify(def.signature.type)).toBe(before);
    // The declared arms still carry their clauses (nothing was substituted in
    // place — instantiation is a pure rebuild).
    expect(def.signature.toString()).toBe(
      '(forall T. (list<T>) -> T) & (forall T. (set<T>) -> boolean)'
    );
  });

  test('D11 — a ground arm beats an identical instantiated-generic arm, in EITHER declaration order', () => {
    // The arms are chosen so the winner is observable: their ARGUMENTS
    // coincide at an `integer` operand (the D11 tie), and only their results
    // differ.
    const GENERIC_FIRST = '(forall T. (T) -> list<T>) & ((integer) -> string)';
    const GROUND_FIRST = '((integer) -> string) & (forall T. (T) -> list<T>)';
    for (const signature of [GENERIC_FIRST, GROUND_FIRST]) {
      const ce = fresh();
      ce.declare('tie', { signature });
      ce.declare('n', 'integer');
      // Ground wins the tie — the same answer both ways round.
      expect(ce.box(['tie', 'n']).type.toString()).toBe('string');
      // Control: at an operand the generic arm instantiates STRICTLY more
      // specifically (`finite_integer` <: `integer`), D11 does not apply and
      // the generic arm wins — the tie-break is a tie-break only.
      expect(ce.box(['tie', 5]).type.toString()).toBe('list<finite_integer>');
      // And where the ground arm does not apply at all, the generic one takes
      // the call.
      expect(ce.box(['tie', ce.string('a')]).type.toString()).toBe(
        'list<string>'
      );
    }
  });

  test('a generic overload set ROUND-TRIPS through declaration', () => {
    const ce = fresh();
    const SIGNATURE =
      '(forall T. (list<T>) -> T) & (forall T, U. (tuple<T, U>) -> U)';
    // The registration-time round-trip guard (`boxed-operator-definition.ts`)
    // re-parses the serialized signature and compares: an α-name-losing
    // serialization would throw here.
    expect(() => ce.declare('rt', { signature: SIGNATURE })).not.toThrow();
    expect(ce.lookupDefinition('rt')!.operator!.signature.toString()).toBe(
      SIGNATURE
    );
  });
});

describe('ARM-AWARE `at`-HANDLER CHECK (§6)', () => {
  test('mixed indexed / non-indexed arms register cleanly', () => {
    const ce = fresh();
    expect(() =>
      ce.declare('mix', {
        signature:
          '((list<number>) -> list<number>) & ((set<number>) -> set<number>)',
        collection: collectionHandlers(),
      } as any)
    ).not.toThrow();
  });

  test('an `at` handler with NO possibly-indexed arm is an error', () => {
    const ce = fresh();
    expect(() =>
      ce.declare('noidx', {
        signature: '(set<number>) -> set<number>',
        collection: collectionHandlers(),
      } as any)
    ).toThrow(/no arm of the signature .* can return an indexed collection/);
    // Without the `at` handler the same signature is fine.
    expect(() =>
      ce.declare('noidx2', {
        signature: '(set<number>) -> set<number>',
        collection: collectionHandlers(false),
      } as any)
    ).not.toThrow();
  });

  test('a BOUNDED variable result counts as possibly indexed (D6 bound-reading)', () => {
    const ce = fresh();
    expect(() =>
      ce.declare('rev3', {
        signature: 'forall T: indexed_collection. (T) -> T',
        collection: collectionHandlers(),
      } as any)
    ).not.toThrow();
    // ... and the check still discriminates: a non-indexed bound is refused.
    expect(() =>
      ce.declare('rev4', {
        signature: 'forall T: set<number>. (T) -> T',
        collection: collectionHandlers(),
      } as any)
    ).toThrow(/no arm of the signature .* can return an indexed collection/);
  });
});
