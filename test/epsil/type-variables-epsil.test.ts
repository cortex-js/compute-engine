import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

//
// Epsil surface of the type-variable feature — the D13 probes of
// `docs/plans/2026-08-01-type-variables-design.md` §11, restated for the
// trailing `where` clause that replaced the `forall` prefix
// (`docs/plans/2026-08-11-where-clause-type-constraints.md`).
//
// D13 splits the surface three ways:
//
//  1. FULL-TYPE-LITERAL annotation positions are IN, for free: Epsil type
//     annotations delegate to the shared engine type DSL (`parseTypePrefix`),
//     so a `where` clause is inherited from the type layer. The only genuine
//     work is probing that the clause terminates cleanly under the tolerant
//     prefix mode at every annotation boundary (`=`, newline, `)`).
//  2. The SUGARED definition form (`function f(x: T) -> T { … }`) had no
//     clause slot in v1 — its signature was assembled from scattered syntax.
//     Both binder spellings (`function f<T>(…)` and `function f(…) where T`)
//     are covered by `generic-function-sugar.test.ts`.
//  3. SERIALIZATION never decomposes a polytype DECLARATION into the sugared
//     form: the full-literal spelling, or a diagnosed error — never a
//     clause-stripped output (stripping is a CAPTURE, not just a loss:
//     `(point) -> point where point` minus its clause silently re-resolves
//     `point` against a nominal type of that name). A `DefineFunction` whose
//     literal carries a quantified marker DOES round-trip through the M2
//     sugared form (§3.3) — that is the clause-preserving spelling, not a
//     stripped one.
//
// These are parse/serialize/execute-level probes: they pin what the Epsil
// surface actually does, not what the engine's solver does (that is
// `test/compute-engine/type-variables*.test.ts`).
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function parseDiagnostics(source: string) {
  const [, diagnostics] = parseEpsil(source);
  return (diagnostics ?? []).map((d) => d.message);
}

/** Execute an Epsil program on a fresh engine. */
function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  return {
    diagnostics: r.diagnostics.map((d) => d.message),
    value: r.value?.toString(),
    type: r.value?.type?.toString(),
  };
}

//
// (a) A `where`-constrained literal in a full-type-annotation position.
//
describe('EPSIL `where` ANNOTATIONS (D13: full-literal positions)', () => {
  test('a `where` annotation parses via the shared type DSL', () => {
    expect(validEpsil('let f: (T) -> T where T')).toStrictEqual([
      'Declare',
      'f',
      { str: '(T) -> T where T' },
    ]);
  });

  test('a bare (keyword-less) annotation takes the clause too', () => {
    expect(validEpsil('f: (T) -> T where T')).toStrictEqual([
      'Declare',
      'f',
      { str: '(T) -> T where T' },
    ]);
  });

  test('multiple variables, bounds, and nested signatures all parse', () => {
    expect(
      validEpsil('let f: (list<T>, (T) any -> U) -> list<U> where T, U')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: '(list<T>, (T) any -> U) -> list<U> where T, U' },
    ]);

    expect(
      validEpsil('let f: (T) -> T where T: indexed_collection')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: '(T) -> T where T: indexed_collection' },
    ]);
  });

  test('an effects specifier composes with the clause', () => {
    expect(validEpsil('let f: (T) random -> T where T')).toStrictEqual([
      'Declare',
      'f',
      { str: '(T) random -> T where T' },
    ]);
  });

  // SUPERSEDED by the generic-function-literals milestone (M1, phase 2): the
  // annotated `const`/`let` route (E3) now INSTALLS the literal
  // (`docs/plans/2026-08-04-generic-function-literals-design.md` §2.4). The
  // annotation still parses through the shared type DSL, as it always did.
  test('a function-literal body INSTALLS, and instantiates per call', () => {
    expect(parseDiagnostics('let f: (T) -> T where T = x |-> x')).toEqual([]);

    const r = run('let f: (T) -> T where T = x |-> x');
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('(x) |-> x');

    // Both instantiations, on ONE engine — no cross-call pollution.
    expect(run('let f: (T) -> T where T = x |-> x\nf(5)')).toMatchObject({
      diagnostics: [],
      value: '5',
      type: 'finite_integer',
    });
    expect(run('let f: (T) -> T where T = x |-> x\nf("a")')).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
  });

  // R1 — the INSTALLED literal is self-describing: the declaration's clause is
  // ascribed onto it as a full-signature marker, so the value's OWN type is the
  // polytype rather than the `(unknown) -> unknown` its bare parameters infer.
  test('…and the installed VALUE carries the declared polytype', () => {
    const r = run('let f: (x: T) -> T where T = x |-> x\nf');
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('(x) |-> x');
    expect(r.type).toBe('(x: T) -> T where T');

    // The unnamed-argument spelling too (marker argument names are cosmetic).
    expect(run('let f: (T) -> T where T = x |-> x\nf').type).toBe(
      '(T) -> T where T'
    );
  });

  test('…and the value serializes with the marker', () => {
    // The known Declare-value-bag gap keeps this off the `x |-> x` sugar; what
    // R1 pins is that the round trip no longer DROPS the clause.
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'let f: (x: T) -> T where T = x |-> x\nf');
    expect(serializeEpsil(r.value!.json)).toBe(
      'Function(do {Typed(x, "(x: T) -> T where T")}, x)'
    );
  });

  test('…and on the §9.1 `(x: T) scope -> T` shape', () => {
    const source = 'let f: (x: T) scope -> T where T = x |-> x + 1\nf(5)';
    expect(parseDiagnostics(source)).toEqual([]);
    expect(run(source)).toMatchObject({
      diagnostics: [],
      value: '6',
      type: 'finite_integer',
    });
  });

  test('a declared BOUND is enforced at the call, not at the declaration', () => {
    const source = 'let f: (x: T) -> T where T: number = x |-> x\nf("a")';
    expect(parseDiagnostics(source)).toEqual([]);
    expect(run(source).value).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });

  test('a rejected polytype is diagnosed at PARSE time by the shared DSL', () => {
    // §7.2 validations reach Epsil through `parseTypePrefix`, as a
    // `type-annotation-error` diagnostic carrying the engine's error code.
    expect(parseDiagnostics('let f: () -> list<T> where T')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `T` occurs only in the result of its signature, so it can never be solved. Write the ground type directly',
      ],
    ]);
    expect(parseDiagnostics('let f: (T) -> T where T, U')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `U` is quantified but never used',
      ],
    ]);
    expect(parseDiagnostics('let f: (T & number) -> T where T')).toEqual([
      [
        'type-annotation-error',
        'unsupported-variable-position: The type variable `T` cannot appear in an intersection. To constrain a type variable, declare a bound on it instead: `where T: number`',
      ],
    ]);
    // A UNION arm is an ALLOWED position (Rule U) — but only one arm of a
    // union may be open.
    expect(parseDiagnostics('let f: (T | string) -> T where T')).toEqual([]);
    expect(
      parseDiagnostics('let f: (T | U) -> tuple<T, U> where T, U')
    ).toEqual([
      [
        'type-annotation-error',
        'unsupported-variable-position: At most one arm of a union can refer to a type variable, but `T | U` has 2. Nothing at a call site says which arm a value took, so neither variable could be solved',
      ],
    ]);
  });

  test('an UNQUANTIFIED variable name is an ordinary unknown type', () => {
    // Implicit quantification is REJECTED by design: `(T) -> T` without a
    // clause names a nominal type that does not exist.
    expect(parseDiagnostics('let f: (T) -> T')).toEqual([
      ['type-annotation-error', 'Unknown type "T"'],
    ]);
  });

  test('the removed `forall` prefix gets the MIGRATION diagnostic', () => {
    expect(parseDiagnostics('let f: forall T. (T) -> T')).toEqual([
      [
        'type-annotation-error',
        'The `forall T. …` prefix syntax was replaced by a trailing `where` clause',
      ],
    ]);
  });

  test('a clause on a NON-SIGNATURE names the parenthesize-the-arm fix', () => {
    const message =
      'unsupported-variable-position: A `where` clause can only quantify a function signature. To constrain one arm of an overload set, parenthesize it: `((list<T>) -> T where T) & …`';
    expect(parseDiagnostics('let f: number where T')).toEqual([
      ['type-annotation-error', message],
    ]);
    // Unparenthesized, the clause attaches to the WHOLE intersection.
    expect(
      parseDiagnostics(
        'let f: ((list<T>) -> T) & ((set<T>) -> boolean) where T'
      )
    ).toEqual([['type-annotation-error', message]]);
  });

  test('…and the per-arm spelling parenthesizes each arm', () => {
    expect(
      validEpsil(
        'let f: ((list<T>) -> T where T) & ((set<T>) -> boolean where T)'
      )
    ).toStrictEqual([
      'Declare',
      'f',
      { str: '((list<T>) -> T where T) & ((set<T>) -> boolean where T)' },
    ]);
  });

  // Phase 4 of the protocols design (P19) activated the slot: the PARSER
  // admits it (it has no protocol registry, so conformance is not a question
  // it can answer), and the engine checks the constraint at each call site —
  // see `where-clause.test.ts` and `protocol-constraints.test.ts`.
  test('the `is` slot parses with no diagnostic', () => {
    expect(
      parseDiagnostics('let f: (T) -> T where T: collection is Hashable')
    ).toEqual([]);
  });
});

//
// (b) Prefix-mode clause termination. `parseTypePrefix` is tolerant — it
// consumes as much as it can and hands the rest back — so a TRAILING clause
// must not swallow the annotation's right-hand boundary, and a bound must not
// swallow the rest of the clause.
//
describe('EPSIL `where` ANNOTATIONS (D13: prefix-mode termination)', () => {
  test('a SIGNATURE-typed bound has an unbounded right edge and still ends', () => {
    // The §3 motivating case: `(real) -> real` has an unbounded right edge, so
    // only the end of the annotation can close it. NOTE: a signature bound is
    // GROUND (it mentions no variable), so §7.2's non-ground-bound rejection
    // does NOT apply — it is accepted, and the whole string lands in the
    // annotation.
    expect(
      validEpsil('let g: (T) -> boolean where T: (real) -> real')
    ).toStrictEqual([
      'Declare',
      'g',
      { str: '(T) -> boolean where T: (real) -> real' },
    ]);
    expect(run('let g: (T) -> boolean where T: (real) -> real').value).toBe(
      '"Nothing"'
    );
  });

  test('the annotation terminates at `=` (initializer boundary)', () => {
    expect(
      validEpsil('let g: (T) -> boolean where T: (real) -> real = 5')
    ).toStrictEqual([
      'Declare',
      'g',
      { str: '(T) -> boolean where T: (real) -> real' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('the annotation terminates at the end of the statement (newline)', () => {
    expect(
      validEpsil('let g: (T) -> boolean where T: (real) -> real\nlet h = 2')
    ).toStrictEqual([
      'Block',
      ['Declare', 'g', { str: '(T) -> boolean where T: (real) -> real' }],
      ['Declare', 'h', ['Dictionary', ['KeyValuePair', 'value', 2]]],
    ]);
  });

  test('the annotation terminates at `)` (parameter-list boundary)', () => {
    // A parameter annotation is COMMA-DELIMITED, so it does not admit a bare
    // clause — the polytype has to be parenthesized, which is also what makes
    // the `)` boundary unambiguous.
    expect(validEpsil('f(x: ((T) -> T where T)) = x')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', 'x', ['Typed', 'x', { str: '((T) -> T where T)' }]],
    ]);
  });

  test('a decimal-looking bound does not run into the next entry', () => {
    // A literal type as a bound puts a digit at the bound's right edge; the
    // lexer must not glue it into a float.
    expect(validEpsil('let f: (T) -> T where T: 5')).toStrictEqual([
      'Declare',
      'f',
      { str: '(T) -> T where T: 5' },
    ]);
  });

  test('a BRACKETED comma inside a bound does not split the clause', () => {
    expect(
      validEpsil('let f: (T, U) -> T where T: tuple<integer, string>, U')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: '(T, U) -> T where T: tuple<integer, string>, U' },
    ]);
  });
});

//
// (c) Interaction with the Epsil `type` statement: a quantified name SHADOWS
// a nominal type of the same name inside its arm (§3, and the D13 capture
// hazard this shadowing creates for serialization).
//
// This is the ACCEPTANCE CRITERION of the trailing-clause migration: the clause
// is read AFTER the body, so the shadowing can only survive if the clause's
// names are located by a lexical pre-scan and seeded before the body parses.
//
describe('EPSIL `where` × the `type` statement (D13: shadowing)', () => {
  test('a quantified name shadows a nominal type of the same name', () => {
    const source =
      'type point = tuple<number, number>\nlet f: (point) -> point where point\nf(5)';
    expect(parseDiagnostics(source)).toEqual([]);

    const r = run(source);
    expect(r.diagnostics).toEqual([]);
    // `point` in the arm is the VARIABLE: an integer argument is admitted and
    // the result is typed from it. If the nominal `point` had won, this would
    // be an `incompatible-type` error instead.
    expect(r.value).toBe('f(5)');
    expect(r.type).toBe('finite_integer');
  });

  test('WITHOUT the clause the same name IS the nominal type (the capture)', () => {
    // The contrast that makes clause-stripping a capture rather than a loss:
    // drop `where point` and `point` silently means the user's tuple type.
    const r = run(
      'type point = tuple<number, number>\nlet g: (point) -> point\ng(5)'
    );
    expect(r.value).toBe(
      'g(Error(ErrorCode("incompatible-type", "point", "finite_integer")))'
    );
  });

  test('a quantified name still binds structurally in its arm', () => {
    const r = run(
      'type point = tuple<number, number>\nlet f: (point) -> point where point\nf((1, 2))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.type).toBe('tuple<finite_integer, finite_integer>');
  });
});

//
// (d) Serialization: full-literal spelling only — never a sugared,
// clause-stripped definition.
//
describe('EPSIL `where` SERIALIZATION (D13: never decompose)', () => {
  test('a polytype declaration serializes as a full-literal annotation', () => {
    expect(serializeEpsil(['Declare', 'f', { str: '(T) -> T where T' }])).toBe(
      'let f: (T) -> T where T'
    );
    expect(
      serializeEpsil([
        'Declare',
        'f',
        { str: '(T) -> T where T: indexed_collection' },
      ])
    ).toBe('let f: (T) -> T where T: indexed_collection');
  });

  test('the clause is never stripped and never becomes `function f(x: T)`', () => {
    for (const type of [
      '(T) -> T where T',
      '(tuple<T, U>) -> tuple<U, T> where T, U',
      '(point) -> point where point',
    ]) {
      const out = serializeEpsil(['Declare', 'f', { str: type }]);
      expect(out).toContain('where');
      expect(out).not.toContain('function ');
      expect(out).toBe(`let f: ${type}`);
    }
  });

  test('round-trip: parse → serialize → parse', () => {
    for (const source of [
      'let f: (T) -> T where T',
      'let f: (tuple<T, U>) -> tuple<U, T> where T, U',
      'let g: (T) -> boolean where T: (real) -> real',
      'let h: (T) -> T where T: indexed_collection',
      'let f: (list<T>, (T) any -> U) -> list<U> where T, U',
    ]) {
      const ast = validEpsil(source);
      const serialized = serializeEpsil(ast as any);
      expect(serialized).toBe(source);
      expect(validEpsil(serialized)).toStrictEqual(ast);
    }
  });

  test('a polytype in a PARAMETER annotation keeps its clause too', () => {
    // The sugared definition form has no clause slot for the function's OWN
    // signature (v1), but a parameter whose TYPE is a polytype is an ordinary
    // full-literal annotation and round-trips. The parens are load-bearing —
    // a comma-delimited annotation does not admit a bare clause.
    const source = 'f(x: ((T) -> T where T)) = x';
    const ast = validEpsil(source);
    const serialized = serializeEpsil(ast as any);
    expect(serialized).toBe(source);
    expect(validEpsil(serialized)).toStrictEqual(ast);
  });

  // The UNGROUPED spelling changed meaning with the trailing clause: `-> (T)
  // -> T where T` no longer reads as one polytype in the return slot. The
  // clause always goes LAST and quantifies the ASSEMBLED signature, so this
  // declares `f : (x: unknown) -> ((T) -> T) where T` — where `T` occurs only
  // in the result, and is rejected. Writing the marker as the literal's own
  // signature is now spelled with the definition's own clause
  // (`f(x: T) -> T where T = x`); see `generic-function-sugar.test.ts`.
  test('an UNGROUPED clause quantifies the ASSEMBLED signature', () => {
    expect(parseDiagnostics('f(x) -> (T) -> T where T = x')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `T` occurs only in the result of its signature, so it can never be solved. Write the ground type directly',
      ],
    ]);
  });

  test('a GROUPED polytype return annotation keeps the return reading', () => {
    const source = 'f(x) -> ((T) -> T where T) = x';
    const ast = validEpsil(source);
    const serialized = serializeEpsil(ast as any);
    expect(serialized).toBe(source);
    expect(validEpsil(serialized)).toStrictEqual(ast);
  });

  // The v1 never-decompose rule still holds for the DECLARATION route: no
  // `Declare` path attaches a polytype to a `DefineFunction`, so the
  // full-literal spelling below is the only one it can produce. (The M2
  // sugared form is reached only from a `DefineFunction` whose literal
  // carries a quantified marker — see `generic-function-sugar.test.ts`.)
  test('an initializer serializes in call form — pre-existing, and generic/ground identical', () => {
    // BUG (pre-existing, NOT generics-specific): a `Function` literal in a
    // `Declare` attribute bag serializes as `Function(x, x)` rather than the
    // `x |-> x` mapsto spelling, so `let f: … = x |-> x` does not round-trip.
    // Pinned here only to show the polytype path behaves EXACTLY like the
    // ground path — the clause itself is not implicated.
    const withValue = (type: string) =>
      serializeEpsil([
        'Declare',
        'f',
        { str: type },
        ['Dictionary', ['KeyValuePair', 'value', ['Function', 'x', 'x']]],
      ]);

    expect(withValue('(integer) -> integer')).toBe(
      'let f: (integer) -> integer = Function(x, x)'
    );
    expect(withValue('(T) -> T where T')).toBe(
      'let f: (T) -> T where T = Function(x, x)'
    );
  });
});
