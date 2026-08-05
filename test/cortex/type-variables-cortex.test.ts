import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { validCortex } from '../utils';

//
// Cortex surface of the type-variable (`forall`) feature — the D13 probes of
// `docs/plans/2026-08-01-type-variables-design.md` §11.
//
// D13 splits the surface three ways:
//
//  1. FULL-TYPE-LITERAL annotation positions are IN, for free: Cortex type
//     annotations delegate to the shared engine type DSL (`parseTypePrefix`),
//     so a `forall` clause is inherited from the type layer. The only genuine
//     work is probing that the clause's DOT terminates cleanly under the
//     tolerant prefix mode at every annotation boundary (`=`, newline, `)`).
//  2. The SUGARED definition form (`function f(x: T) -> T { … }`) had no
//     clause slot in v1 — its signature was assembled from scattered syntax.
//     The `function f<T>(…)` spelling landed with the M2 milestone; it is
//     covered by `generic-function-sugar.test.ts`.
//  3. SERIALIZATION never decomposes a polytype DECLARATION into the sugared
//     form: the full-literal spelling, or a diagnosed error — never a
//     clause-stripped output (stripping is a CAPTURE, not just a loss:
//     `forall point. (point) -> point` minus its clause silently re-resolves
//     `point` against a nominal type of that name). A `DefineFunction` whose
//     literal carries a `forall` marker DOES round-trip through the M2
//     sugared form (§3.3) — that is the clause-preserving spelling, not a
//     stripped one.
//
// These are parse/serialize/execute-level probes: they pin what the Cortex
// surface actually does, not what the engine's solver does (that is
// `test/compute-engine/type-variables*.test.ts`).
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function parseDiagnostics(source: string) {
  const [, diagnostics] = parseCortex(source);
  return (diagnostics ?? []).map((d) => d.message);
}

/** Execute a Cortex program on a fresh engine. */
function run(source: string) {
  const ce = new ComputeEngine();
  const r = executeCortex(ce, source);
  return {
    diagnostics: r.diagnostics.map((d) => d.message),
    value: r.value?.toString(),
    type: r.value?.type?.toString(),
  };
}

//
// (a) A `forall` literal in a full-type-annotation position.
//
describe('CORTEX `forall` ANNOTATIONS (D13: full-literal positions)', () => {
  test('a `forall` annotation parses via the shared type DSL', () => {
    expect(validCortex('let f: forall T. (T) -> T')).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T. (T) -> T' },
    ]);
  });

  test('a bare (keyword-less) annotation takes the clause too', () => {
    expect(validCortex('f: forall T. (T) -> T')).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T. (T) -> T' },
    ]);
  });

  test('multiple variables, bounds, and nested signatures all parse', () => {
    expect(
      validCortex('let f: forall T, U. (list<T>, (T) any -> U) -> list<U>')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T, U. (list<T>, (T) any -> U) -> list<U>' },
    ]);

    expect(
      validCortex('let f: forall T: indexed_collection. (T) -> T')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T: indexed_collection. (T) -> T' },
    ]);
  });

  test('an effects specifier composes with the clause', () => {
    expect(validCortex('let f: forall T. (T) random -> T')).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T. (T) random -> T' },
    ]);
  });

  // SUPERSEDED by the generic-function-literals milestone (M1, phase 2): the
  // annotated `const`/`let` route (E3) now INSTALLS the literal
  // (`docs/plans/2026-08-04-generic-function-literals-design.md` §2.4). The
  // annotation still parses through the shared type DSL, as it always did.
  test('a function-literal body INSTALLS, and instantiates per call', () => {
    expect(parseDiagnostics('let f: forall T. (T) -> T = x |-> x')).toEqual([]);

    const r = run('let f: forall T. (T) -> T = x |-> x');
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('(x) |-> x');

    // Both instantiations, on ONE engine — no cross-call pollution.
    expect(run('let f: forall T. (T) -> T = x |-> x\nf(5)')).toMatchObject({
      diagnostics: [],
      value: '5',
      type: 'finite_integer',
    });
    expect(run('let f: forall T. (T) -> T = x |-> x\nf("a")')).toMatchObject({
      diagnostics: [],
      value: '"a"',
      type: 'string',
    });
  });

  // R1 — the INSTALLED literal is self-describing: the declaration's clause is
  // ascribed onto it as a full-signature marker, so the value's OWN type is the
  // polytype rather than the `(unknown) -> unknown` its bare parameters infer.
  test('…and the installed VALUE carries the declared polytype', () => {
    const r = run('let f: forall T. (x: T) -> T = x |-> x\nf');
    expect(r.diagnostics).toEqual([]);
    expect(r.value).toBe('(x) |-> x');
    expect(r.type).toBe('forall T. (x: T) -> T');

    // The unnamed-argument spelling too (marker argument names are cosmetic).
    expect(run('let f: forall T. (T) -> T = x |-> x\nf').type).toBe(
      'forall T. (T) -> T'
    );
  });

  test('…and the value serializes with the marker', () => {
    // The known Declare-value-bag gap keeps this off the `x |-> x` sugar; what
    // R1 pins is that the round trip no longer DROPS the clause.
    const ce = new ComputeEngine();
    const r = executeCortex(ce, 'let f: forall T. (x: T) -> T = x |-> x\nf');
    expect(serializeCortex(r.value!.json)).toBe(
      'Function(do {Typed(x, "forall T. (x: T) -> T")}, x)'
    );
  });

  test('…and on the §9.1 `(x: T) scope -> T` shape', () => {
    const source = 'let f: forall T. (x: T) scope -> T = x |-> x + 1\nf(5)';
    expect(parseDiagnostics(source)).toEqual([]);
    expect(run(source)).toMatchObject({
      diagnostics: [],
      value: '6',
      type: 'finite_integer',
    });
  });

  test('a declared BOUND is enforced at the call, not at the declaration', () => {
    const source = 'let f: forall T: number. (x: T) -> T = x |-> x\nf("a")';
    expect(parseDiagnostics(source)).toEqual([]);
    expect(run(source).value).toBe(
      'Error(ErrorCode("incompatible-type", "number", "string"))'
    );
  });

  test('a rejected polytype is diagnosed at PARSE time by the shared DSL', () => {
    // §7.2 validations reach Cortex through `parseTypePrefix`, as a
    // `type-annotation-error` diagnostic carrying the engine's error code.
    expect(parseDiagnostics('let f: forall T. () -> list<T>')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `T` occurs only in the result of its signature, so it can never be solved. Write the ground type directly',
      ],
    ]);
    expect(parseDiagnostics('let f: forall T, U. (T) -> T')).toEqual([
      [
        'type-annotation-error',
        'unsolvable-type-variable: The type variable `U` is quantified but never used',
      ],
    ]);
    expect(parseDiagnostics('let f: forall T. (T | string) -> T')).toEqual([
      [
        'type-annotation-error',
        'unsupported-variable-position: The type variable `T` cannot appear in a union, an intersection, a negation or a bound',
      ],
    ]);
  });
});

//
// (b) Prefix-mode dot termination. `parseTypePrefix` is tolerant — it consumes
// as much as it can and hands the rest back — so the clause's dot must not
// swallow the annotation's right-hand boundary, and the bound must not swallow
// the dot.
//
describe('CORTEX `forall` ANNOTATIONS (D13: prefix-mode dot termination)', () => {
  test('a SIGNATURE-typed bound terminates at the dot, not at the arrow', () => {
    // The §3 motivating case: `(real) -> real` has an unbounded right edge, so
    // only the dot can end the bound. NOTE: a signature bound is GROUND (it
    // mentions no variable), so §7.2's non-ground-bound rejection does NOT
    // apply — it is accepted, and the whole string lands in the annotation.
    expect(
      validCortex('let g: forall T: (real) -> real. (T) -> boolean')
    ).toStrictEqual([
      'Declare',
      'g',
      { str: 'forall T: (real) -> real. (T) -> boolean' },
    ]);
    expect(run('let g: forall T: (real) -> real. (T) -> boolean').value).toBe(
      '"Nothing"'
    );
  });

  test('the annotation terminates at `=` (initializer boundary)', () => {
    expect(
      validCortex('let g: forall T: (real) -> real. (T) -> boolean = 5')
    ).toStrictEqual([
      'Declare',
      'g',
      { str: 'forall T: (real) -> real. (T) -> boolean' },
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('the annotation terminates at the end of the statement (newline)', () => {
    expect(
      validCortex('let g: forall T: (real) -> real. (T) -> boolean\nlet h = 2')
    ).toStrictEqual([
      'Block',
      ['Declare', 'g', { str: 'forall T: (real) -> real. (T) -> boolean' }],
      ['Declare', 'h', ['Dictionary', ['KeyValuePair', 'value', 2]]],
    ]);
  });

  test('the annotation terminates at `)` (parameter-list boundary)', () => {
    expect(validCortex('f(x: forall T. (T) -> T) = x')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', 'x', ['Typed', 'x', { str: 'forall T. (T) -> T' }]],
    ]);
  });

  test('a decimal-looking bound does not confuse the dot', () => {
    // A literal type as a bound puts a digit immediately before the clause's
    // dot; the lexer must not glue `5.` into a float.
    expect(validCortex('let f: forall T: 5. (T) -> T')).toStrictEqual([
      'Declare',
      'f',
      { str: 'forall T: 5. (T) -> T' },
    ]);
  });
});

//
// (c) Interaction with the Cortex `type` statement: a quantified name SHADOWS
// a nominal type of the same name inside its arm (§3, and the D13 capture
// hazard this shadowing creates for serialization).
//
describe('CORTEX `forall` × the `type` statement (D13: shadowing)', () => {
  test('a quantified name shadows a nominal type of the same name', () => {
    const source =
      'type point = tuple<number, number>\nlet f: forall point. (point) -> point\nf(5)';
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
    // drop `forall point.` and `point` silently means the user's tuple type.
    const r = run(
      'type point = tuple<number, number>\nlet g: (point) -> point\ng(5)'
    );
    expect(r.value).toBe(
      'g(Error(ErrorCode("incompatible-type", "point", "finite_integer")))'
    );
  });

  test('a quantified name still binds structurally in its arm', () => {
    const r = run(
      'type point = tuple<number, number>\nlet f: forall point. (point) -> point\nf((1, 2))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.type).toBe('tuple<finite_integer, finite_integer>');
  });
});

//
// (d) Serialization: full-literal spelling only — never a sugared,
// clause-stripped definition.
//
describe('CORTEX `forall` SERIALIZATION (D13: never decompose)', () => {
  test('a polytype declaration serializes as a full-literal annotation', () => {
    expect(
      serializeCortex(['Declare', 'f', { str: 'forall T. (T) -> T' }])
    ).toBe('let f: forall T. (T) -> T');
    expect(
      serializeCortex([
        'Declare',
        'f',
        { str: 'forall T: indexed_collection. (T) -> T' },
      ])
    ).toBe('let f: forall T: indexed_collection. (T) -> T');
  });

  test('the clause is never stripped and never becomes `function f(x: T)`', () => {
    for (const type of [
      'forall T. (T) -> T',
      'forall T, U. (tuple<T, U>) -> tuple<U, T>',
      'forall point. (point) -> point',
    ]) {
      const out = serializeCortex(['Declare', 'f', { str: type }]);
      expect(out).toContain('forall');
      expect(out).not.toContain('function ');
      expect(out).toBe(`let f: ${type}`);
    }
  });

  test('round-trip: parse → serialize → parse', () => {
    for (const source of [
      'let f: forall T. (T) -> T',
      'let f: forall T, U. (tuple<T, U>) -> tuple<U, T>',
      'let g: forall T: (real) -> real. (T) -> boolean',
      'let h: forall T: indexed_collection. (T) -> T',
      'let f: forall T, U. (list<T>, (T) any -> U) -> list<U>',
    ]) {
      const ast = validCortex(source);
      const serialized = serializeCortex(ast as any);
      expect(serialized).toBe(source);
      expect(validCortex(serialized)).toStrictEqual(ast);
    }
  });

  test('a polytype in a PARAMETER annotation keeps its clause too', () => {
    // The sugared definition form has no clause slot for the function's OWN
    // signature (v1), but a parameter whose TYPE is a polytype is an ordinary
    // full-literal annotation and round-trips.
    const source = 'f(x: forall T. (T) -> T) = x';
    const ast = validCortex(source);
    const serialized = serializeCortex(ast as any);
    expect(serialized).toBe(source);
    expect(validCortex(serialized)).toStrictEqual(ast);
  });

  // SUPERSEDED by the generic-function-literals milestone (M2, phase 3): an
  // UNGROUPED polytype in the return slot is the literal's OWN full signature
  // (§2.2 — "a polytype cannot be anything else"), so the engine reads
  // `f(x) -> forall T. (T) -> T = x` as declaring `f : forall T. (T) -> T`.
  // The serializer mirrors that reading exactly (the two halves stay in sync)
  // and emits the M2 sugared form. The GROUPED spelling is still an ordinary
  // return-type ascription and still round-trips verbatim.
  test('an UNGROUPED polytype return marker is the literal’s own signature', () => {
    const ast = validCortex('f(x) -> forall T. (T) -> T = x');
    // The engine reads this marker as `f`'s own polytype…
    const ce = new ComputeEngine();
    ce.box(ast as any).evaluate();
    expect(ce.symbol('f').type.toString()).toBe('forall T. (T) -> T');
    // …and the serializer decomposes it into the sugared form. Parameter
    // NAMES come from the literal operands, types from the marker arguments.
    expect(serializeCortex(ast as any)).toBe('function f<T>(x: T) -> T {x}');
  });

  test('a GROUPED polytype return annotation keeps the return reading', () => {
    const source = 'f(x) -> (forall T. (T) -> T) = x';
    const ast = validCortex(source);
    const serialized = serializeCortex(ast as any);
    expect(serialized).toBe(source);
    expect(validCortex(serialized)).toStrictEqual(ast);
  });

  // The v1 never-decompose rule still holds for the DECLARATION route: no
  // `Declare` path attaches a polytype to a `DefineFunction`, so the
  // full-literal spelling below is the only one it can produce. (The M2
  // sugared form is reached only from a `DefineFunction` whose literal
  // carries a `forall` marker — see `generic-function-sugar.test.ts`.)
  test('an initializer serializes in call form — pre-existing, and generic/ground identical', () => {
    // BUG (pre-existing, NOT generics-specific): a `Function` literal in a
    // `Declare` attribute bag serializes as `Function(x, x)` rather than the
    // `x |-> x` mapsto spelling, so `let f: … = x |-> x` does not round-trip.
    // Pinned here only to show the polytype path behaves EXACTLY like the
    // ground path — the clause itself is not implicated.
    const withValue = (type: string) =>
      serializeCortex([
        'Declare',
        'f',
        { str: type },
        ['Dictionary', ['KeyValuePair', 'value', ['Function', 'x', 'x']]],
      ]);

    expect(withValue('(integer) -> integer')).toBe(
      'let f: (integer) -> integer = Function(x, x)'
    );
    expect(withValue('forall T. (T) -> T')).toBe(
      'let f: forall T. (T) -> T = Function(x, x)'
    );
  });
});
