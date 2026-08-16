/**
 * THE B1 MUTABILITY GATE — `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Which
 * types can conform (the mutability gate)" (user-ruled 2026-08-15).
 *
 * A writable property is meaningful only on a mutable object. A protocol that
 * can MODIFY object state — because it declares at least one `readwrite`
 * property, or a function member whose DECLARED effects include the `state`
 * label — can therefore be conformed to only by OBJECT types;
 * `protocol-requires-object` refuses everything else.
 *
 * Two boundaries the ruling draws explicitly, and which the matrix below pins:
 *
 * - A **bare** function requirement never gates. Its effects are DERIVED from
 *   whatever conformers exist, so reading `state` off it would make the gate
 *   depend on the conformer set rather than on the protocol's declaration
 *   alone.
 * - An **explicit `pure`** member never gates. It parses to the STATED EMPTY
 *   set — a real ceiling, and the strongest one — not to an absence.
 *
 * `readonly`-only protocols and SEMANTIC (member-less) protocols are
 * conformable by any type, exactly as before.
 *
 * All three registration routes are exercised, because each reaches the check
 * by a different path: the Epsil statement route, the raw MathJSON
 * `DeclareConformance` box route, and the host
 * `declareProtocolImplementation()` API (which throws where the other two
 * return an error value).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** Run an Epsil program; return its value as a string. */
function result(ce: ComputeEngine, source: string): string {
  return String(executeEpsil(ce, source).value);
}

/** Run an Epsil program, asserting it produced no diagnostics and no error
 * value. */
function ok(ce: ComputeEngine, source: string): void {
  const { diagnostics, value } = executeEpsil(ce, source);
  expect(diagnostics.map((d) => d.message)).toEqual([]);
  expect(String(value)).not.toContain('Error(');
}

/** The `ErrorCode` of an error value, or `undefined`. */
function errorCode(s: string): string | undefined {
  return /ErrorCode\("([^"]+)"/.exec(s)?.[1];
}

/** The diagnostic codes of a program, in order. A runtime error value raised
 * by a statement rides as `["runtime-error", message, "", code]`. */
function diagnosticCodes(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) => {
    const parts = Array.isArray(d.message) ? d.message : [d.message];
    return parts[0] === 'runtime-error'
      ? String(parts[parts.length - 1])
      : String(parts[0]);
  });
}

/** The (targetKey, pending) pairs registered for `protocol`. */
function edges(ce: ComputeEngine, protocol: string) {
  return ce._protocolRegistry[protocol].conformances.map((c) => ({
    key: c.targetKey,
    pending: c.pending,
  }));
}

//
// ── The protocols, one per row of the matrix ─────────────────────────────────
//

/** GATES: a settable property. */
const READWRITE = 'protocol P { readwrite name: string }';
/** GATES: a function member whose DECLARED effects include `state`. */
const DECLARED_STATE =
  'protocol P { function touch(self: Self) state -> string }';
/** Does NOT gate: an explicit `pure` is the stated EMPTY set. */
const EXPLICIT_PURE = 'protocol P { function m(self: Self) pure -> string }';
/** Does NOT gate: a bare arrow states nothing, and its effects are derived. */
const BARE = 'protocol P { function m(self: Self) -> string }';
/** Does NOT gate: only the getter direction exists. */
const READONLY = 'protocol P { readonly name: string }';
/** Does NOT gate: no members at all. */
const SEMANTIC = 'protocol P {}';

/** An implementation block satisfying each protocol above, for a target whose
 * `Self` is spelled by the conformance. */
const BLOCK: Record<string, string> = {
  [READWRITE]: `{
  get name(self: Self) -> string { "x" }
  set name(self: Self, v: string) -> Self { self }
}`,
  [DECLARED_STATE]: `{
  function touch(self: Self) state -> string { "x" }
}`,
  [EXPLICIT_PURE]: `{
  function m(self: Self) -> string { "x" }
}`,
  [BARE]: `{
  function m(self: Self) -> string { "x" }
}`,
  [READONLY]: `{
  get name(self: Self) -> string { "x" }
}`,
  [SEMANTIC]: '',
};

/** The target types, one per column: the declarations that must precede the
 * conformance, and the type NAME the conformance uses. */
const TARGETS: { label: string; decl: string; name: string }[] = [
  { label: 'a record', decl: 'type T = record{a: string}', name: 'T' },
  { label: 'a tuple', decl: 'type T = tuple<a: string>', name: 'T' },
  { label: 'a builtin', decl: '', name: 'string' },
  { label: 'a nominal value type', decl: 'type T = integer', name: 'T' },
  { label: 'an object', decl: 'type T = object{a: string}', name: 'T' },
];

describe('the gate MATRIX — statement route', () => {
  for (const [protoLabel, protocol, gates] of [
    ['a `readwrite` property', READWRITE, true],
    ['a DECLARED `state` member', DECLARED_STATE, true],
    ['an explicit `pure` member', EXPLICIT_PURE, false],
    ['a BARE member', BARE, false],
    ['`readonly` only', READONLY, false],
    ['a SEMANTIC protocol', SEMANTIC, false],
  ] as [string, string, boolean][]) {
    for (const target of TARGETS) {
      const admitted = !gates || target.label === 'an object';
      test(`${protoLabel} × ${target.label}: ${
        admitted ? 'admitted' : 'refused'
      }`, () => {
        const ce = new ComputeEngine();
        ok(ce, protocol);
        if (target.decl !== '') ok(ce, target.decl);
        const r = result(
          ce,
          `type ${target.name} is P ${BLOCK[protocol]}`.trimEnd()
        );
        if (admitted) {
          expect(errorCode(r)).toBeUndefined();
          expect(edges(ce, 'P')).toEqual([
            { key: target.name, pending: false },
          ]);
        } else {
          expect(errorCode(r)).toBe('protocol-requires-object');
          // A refused conformance registers NOTHING.
          expect(edges(ce, 'P')).toEqual([]);
        }
      });
    }
  }
});

describe('the gate on the BOX route (`DeclareConformance`)', () => {
  const conform = (ce: ComputeEngine, target: string) =>
    ce
      .box(['DeclareConformance', { str: target }, ['List', 'P']] as never)
      .evaluate()
      .toString();

  test('a gating protocol refuses a builtin target', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    expect(errorCode(conform(ce, 'string'))).toBe('protocol-requires-object');
    expect(edges(ce, 'P')).toEqual([]);
  });

  test('a gating protocol admits an object target', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    ce.declareType('Obj', 'object{a: string}');
    expect(errorCode(conform(ce, 'Obj'))).toBeUndefined();
    expect(edges(ce, 'P')).toEqual([{ key: 'Obj', pending: true }]);
  });

  test('a DECLARED `state` member gates the box route too', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', {
      functions: { touch: '(self: Self) state -> string' },
    });
    expect(errorCode(conform(ce, 'string'))).toBe('protocol-requires-object');
  });

  test('a `readonly`-only protocol does not gate the box route', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readonly: { name: 'string' } });
    expect(errorCode(conform(ce, 'string'))).toBeUndefined();
    expect(edges(ce, 'P')).toEqual([{ key: 'string', pending: true }]);
  });
});

describe('the gate on the HOST route (it THROWS)', () => {
  test('a `readwrite` property refuses a builtin target', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    expect(() =>
      ce.declareProtocolImplementation('string', 'P', {
        getters: { name: () => 'x' },
        setters: { name: (self: unknown) => self },
      })
    ).toThrow(/protocol-requires-object/);
    expect(edges(ce, 'P')).toEqual([]);
  });

  test('a DECLARED `state` member refuses a builtin target', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', {
      functions: { touch: '(self: Self) state -> string' },
    });
    expect(() =>
      ce.declareProtocolImplementation('string', 'P', {
        functions: { touch: () => 'x' },
      })
    ).toThrow(/declares the `state` effect on `touch`/);
  });

  test('an object target is admitted', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    ce.declareType('Obj', 'object{a: string}');
    ce.declareProtocolImplementation('Obj', 'P', {
      getters: { name: () => 'x' },
      setters: { name: (self: unknown) => self },
    });
    expect(edges(ce, 'P')).toEqual([{ key: 'Obj', pending: false }]);
  });

  test('a BARE member does not gate the host route', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { functions: { m: '(self: Self) -> string' } });
    ce.declareProtocolImplementation('string', 'P', {
      functions: { m: () => 'x' },
    });
    expect(edges(ce, 'P')).toEqual([{ key: 'string', pending: false }]);
  });
});

describe('CONDITIONAL conformance is judged on its HEAD', () => {
  test('a non-object head (`list<T>`) is refused', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    expect(() =>
      ce.declareProtocolImplementation(
        'list<T>',
        'P',
        {
          getters: { name: () => 'x' },
          setters: { name: (self: unknown) => self },
        },
        { where: 'T' }
      )
    ).toThrow(/protocol-requires-object/);
    expect(edges(ce, 'P')).toEqual([]);
  });

  test('a GENERIC OBJECT head (`Box<T>`) is accepted', () => {
    // A type variable in a stored field must be declared `inout` (ruling B13),
    // which is what makes an object-bodied generic nominal declarable at all.
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    ce.declareType('Box', 'object{value: T}', { typeParams: 'inout T' });
    ce.declareProtocolImplementation(
      'Box<T>',
      'P',
      {
        getters: { name: () => 'x' },
        setters: { name: (self: unknown) => self },
      },
      { where: 'T' }
    );
    expect(edges(ce, 'P')).toEqual([{ key: 'Box<T> where T', pending: false }]);
  });
});

describe('MULTI-PROTOCOL `is A & B` registers NOTHING when one arm gates', () => {
  test('the gating arm is reported and neither edge is registered', () => {
    const ce = new ComputeEngine();
    ok(ce, 'protocol A { readonly a: string }');
    ok(ce, 'protocol B { readwrite b: string }');
    ok(ce, 'type Nom = integer');
    const r = result(ce, 'type Nom is A & B');
    expect(errorCode(r)).toBe('protocol-requires-object');
    // The message names the arm that gated, not the first one listed.
    expect(r).toContain('`B` protocol');
    expect(edges(ce, 'A')).toEqual([]);
    expect(edges(ce, 'B')).toEqual([]);
  });
});

describe('a type an OBJECT INHABITS is still refused, and told why accurately', () => {
  // `any`, `unknown`, `value` and `expression` are not object types, but an
  // object is a value of each of them. `conformanceTargetProblem` admits a
  // bare primitive name, so they reach the gate — and are refused, because
  // admitting one would let a value conform through a target that decides
  // nothing. What must NOT be said about them is the ordinary wording, "has no
  // state to change": that is a false statement about a type an object
  // inhabits.
  const TOPS = ['any', 'unknown', 'value', 'expression'];

  for (const top of TOPS) {
    test(`\`${top}\` is refused on the statement route, without the false wording`, () => {
      const ce = new ComputeEngine();
      ok(ce, READWRITE);
      const r = result(ce, `type ${top} is P`);
      expect(errorCode(r)).toBe('protocol-requires-object');
      expect(r).toContain(
        `\`${top}\` is not an object type — a value of that type may or may not be an object`
      );
      expect(r).not.toContain('has no state to change');
      expect(edges(ce, 'P')).toEqual([]);
    });

    test(`\`${top}\` is refused on the host route too`, () => {
      const ce = new ComputeEngine();
      ce.declareProtocol('P', { readwrite: { name: 'string' } });
      expect(() =>
        ce.declareProtocolImplementation(top, 'P', {
          getters: { name: () => 'x' },
          setters: { name: (self: unknown) => self },
        })
      ).toThrow(/may or may not be an object/);
      expect(edges(ce, 'P')).toEqual([]);
    });
  }

  test('a NOMINAL declared as a top type gets the same wording', () => {
    // A nominal is opaque to the subtype lattice, so the verdict is read off
    // the type it RESOLVES to: `type T = any` deserves the same answer as
    // `any`, not "nominal value types are immutable".
    const ce = new ComputeEngine();
    ok(ce, READWRITE);
    ok(ce, 'type T = any');
    const r = result(ce, 'type T is P');
    expect(errorCode(r)).toBe('protocol-requires-object');
    expect(r).toContain('may or may not be an object');
    expect(r).not.toContain('immutable');
  });

  test('a GENUINE builtin keeps the "no state to change" wording', () => {
    const ce = new ComputeEngine();
    ok(ce, READWRITE);
    const r = result(ce, 'type string is P');
    expect(r).toContain(
      '`string` is a builtin type, which has no state to change'
    );
  });
});

describe('the DIAGNOSTIC message', () => {
  test('the Appendix B `Badge` example, verbatim', () => {
    const ce = new ComputeEngine();
    ok(ce, 'protocol Identifiable { readwrite id: string }');
    expect(result(ce, 'type Badge = record{id: string} is Identifiable')).toBe(
      'Error(ErrorCode("protocol-requires-object", "the `Identifiable` ' +
        'protocol has settable properties. `Badge` is a record, and records ' +
        'are immutable; declare `Badge` as an object type to conform."))'
    );
  });

  test('a DECLARED `state` member names the member and the builtin', () => {
    const ce = new ComputeEngine();
    ok(ce, 'protocol Touchable { function touch(self: Self) state -> string }');
    expect(
      result(
        ce,
        'type string is Touchable {\n  function touch(self: Self) state -> string { "x" }\n}'
      )
    ).toBe(
      'Error(ErrorCode("protocol-requires-object", "the `Touchable` protocol ' +
        'declares the `state` effect on `touch`. `string` is a builtin type, ' +
        'which has no state to change; only an object type can conform."))'
    );
  });

  test('a TUPLE nominal is told to become an object type', () => {
    const ce = new ComputeEngine();
    ok(ce, 'protocol P { readwrite name: string }');
    const r = result(ce, 'type Pt = tuple<a: string> is P');
    expect(r).toContain('`Pt` is a tuple, and tuples are immutable');
    expect(r).toContain('declare `Pt` as an object type to conform');
  });
});

describe('REPLACING a protocol into a gating one', () => {
  // Conformance is monotone (Appendix A "Conformance"), so a replacement never
  // REMOVES an edge and is never itself rejected. A value-type edge the
  // replacement has made inadmissible goes PENDING instead.
  const setUp = (ce: ComputeEngine): void => {
    ok(
      ce,
      `protocol Tagged { readonly tag: string }
type string is Tagged { get tag(self: Self) -> string { "s" } }`
    );
  };

  // These also guard the gate memo's KEY. The verdict is memoized per protocol
  // (deriving it parses every function requirement's signature), and a protocol
  // record mutates IN PLACE on re-declaration — so a memo keyed on the record
  // would answer for the old requirement set and leave the edge un-gated here.
  // Keying on `record.members`, which every declaration allocates afresh,
  // invalidates by construction.
  test('the value-type edge goes PENDING, and the end-of-batch warning names it', () => {
    const ce = new ComputeEngine();
    setUp(ce);
    expect(edges(ce, 'Tagged')).toEqual([{ key: 'string', pending: false }]);

    expect(
      diagnosticCodes(
        ce,
        'protocol Tagged {\n  readonly tag: string\n  readwrite label: string\n}'
      )
    ).toEqual(['protocol-implementation-pending']);
    expect(edges(ce, 'Tagged')).toEqual([{ key: 'string', pending: true }]);
  });

  test('a read through the pending edge reports the missing implementation', () => {
    const ce = new ComputeEngine();
    ok(
      ce,
      `protocol Comparable { function compare(self: Self, other: Self) -> string }
type string is Comparable {
  function compare(self: Self, other: Self) -> string { "=" }
}`
    );
    expect(result(ce, 'compare("a", "b")')).toBe('"="');

    executeEpsil(
      ce,
      `protocol Comparable {
  function compare(self: Self, other: Self) -> string
  readwrite w: string
}`
    );
    expect(errorCode(result(ce, 'compare("a", "b")'))).toBe(
      'protocol-implementation-missing'
    );

    // Replacing the protocol BACK re-fulfils the edge.
    ok(
      ce,
      'protocol Comparable { function compare(self: Self, other: Self) -> string }'
    );
    expect(result(ce, 'compare("a", "b")')).toBe('"="');
  });

  test('a BLOCK-LESS edge is gated too, and stops inheriting', () => {
    // `integer` carries no implementation of its own; it inherits `number`'s.
    // Once the protocol gates, neither edge is covered, so the inheritance
    // pass has nothing to inherit FROM either.
    const ce = new ComputeEngine();
    ok(
      ce,
      `protocol Sized { readonly size: integer }
type number is Sized { get size(self: Self) -> integer { 1 } }
type integer is Sized
let n = 3`
    );
    expect(result(ce, 'n.size')).toBe('1');
    expect(edges(ce, 'Sized')).toEqual([
      { key: 'number', pending: false },
      { key: 'integer', pending: false },
    ]);

    executeEpsil(
      ce,
      'protocol Sized {\n  readonly size: integer\n  readwrite w: integer\n}'
    );
    expect(edges(ce, 'Sized')).toEqual([
      { key: 'number', pending: true },
      { key: 'integer', pending: true },
    ]);
    expect(String(executeEpsil(ce, 'n.size').value)).toContain('Error(');
  });

  test('an OBJECT edge of the same protocol is unaffected', () => {
    const ce = new ComputeEngine();
    ok(
      ce,
      `protocol Sized { readonly size: integer }
type Cell = object{v: integer}
type Cell is Sized { get size(self: Self) -> integer { self.v } }
type string is Sized { get size(self: Self) -> integer { 0 } }
let c = Cell(v: 7)`
    );
    expect(result(ce, 'c.size')).toBe('7');

    executeEpsil(
      ce,
      'protocol Sized {\n  readonly size: integer\n  readwrite w: integer\n}'
    );
    // Both edges are pending — `Cell` because it has no `w` accessor, `string`
    // because the gate refuses it — but for different reasons: giving `Cell`
    // the missing accessors fulfils it, while nothing can fulfil `string`.
    // The `string` edge is still pending — nothing can fulfil it — so its
    // end-of-batch warning rides along; the `Cell` edge is now covered.
    expect(
      diagnosticCodes(
        ce,
        `type Cell is Sized {
  get size(self: Self) -> integer { self.v }
  get w(self: Self) -> integer { self.v }
  set w(self: Self, x: integer) -> Self { self }
}`
      )
    ).toEqual(['protocol-implementation-pending']);
    expect(edges(ce, 'Sized')).toEqual([
      { key: 'Cell', pending: false },
      { key: 'string', pending: true },
    ]);
    expect(result(ce, 'c.size')).toBe('7');
  });
});

describe('the gate sits ahead of the duplicate guards, which still fire', () => {
  test('P47: a second implementation block in ONE batch is still refused', () => {
    // The gate does not admit this pair, so P47 never gets a chance to fire on
    // it; on a pair the gate DOES admit, P47 is unchanged.
    const ce = new ComputeEngine();
    ok(ce, 'protocol P { readwrite name: string }');
    ok(ce, 'type Obj = object{a: string}');
    const block = `{
  get name(self: Self) -> string { "x" }
  set name(self: Self, v: string) -> Self { self }
}`;
    expect(
      errorCode(result(ce, `type Obj is P ${block}\ntype Obj is P ${block}`))
    ).toBe('protocol-implementation-duplicate');
  });

  test('P5: a second HOST implementation of an admitted pair still throws', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol('P', { readwrite: { name: 'string' } });
    ce.declareType('Obj', 'object{a: string}');
    const impl = {
      getters: { name: () => 'x' },
      setters: { name: (self: unknown) => self },
    };
    ce.declareProtocolImplementation('Obj', 'P', impl);
    expect(() => ce.declareProtocolImplementation('Obj', 'P', impl)).toThrow(
      /protocol-implementation-duplicate/
    );
  });
});
