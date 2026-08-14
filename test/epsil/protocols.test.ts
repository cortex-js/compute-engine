import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

//
// Epsil PROTOCOLS — phase 1: declarations and conformance.
//
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix A is the surface specification;
// `docs/plans/2026-08-12-protocols-design.md` is the ruling record. Phase 1
// covers the `protocol` statement, the `type X is P` conformance forms and the
// registry; implementation blocks are PARSED and carried through, but not
// validated against the protocol (phase 2).
//
// The lowering (fixed contract, mirrored by the engine's operators):
//
//   protocol Comparable { function compare(self: Self, other: Self) -> string }
//     → ["DeclareProtocol", "Comparable",
//         ["Dictionary", ["KeyValuePair", "compare",
//           ["Pair", {str: "function"},
//                    {str: "(self: Self, other: Self) -> string"}]]]]
//
//   type string is Hashable & Comparable
//     → ["DeclareConformance", {str: "string"}, ["List", "Hashable", "Comparable"]]
//
// Member signatures ride as SOURCE TEXT (like a `type` body): the engine
// parses them, which is what keeps `Self` — a textual substitution token, not
// a declarable type — engine-side.
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function diagnosticsOf(source: string, typeNames?: readonly string[]) {
  const [, diagnostics] = parseEpsil(source, undefined, { typeNames });
  return diagnostics.map((d) => d.message);
}

/** Diagnostic codes of an `executeEpsil` batch, in order. */
function runCodes(ce: ComputeEngine, source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
  );
}

const COMPARABLE =
  'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}';

describe('EPSIL PROTOCOL DECLARATIONS', () => {
  test('a function member lowers to a `function` Pair of the signature SOURCE', () => {
    expect(validEpsil(COMPARABLE)).toStrictEqual([
      'DeclareProtocol',
      'Comparable',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          [
            'Pair',
            { str: 'function' },
            { str: '(self: Self, other: Self) -> string' },
          ],
        ],
      ],
    ]);
  });

  test('`readonly` and `readwrite` property members', () => {
    expect(
      validEpsil(
        'protocol Named {\n  readonly hash: string\n  readwrite name: string\n}'
      )
    ).toStrictEqual([
      'DeclareProtocol',
      'Named',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'hash',
          ['Pair', { str: 'readonly' }, { str: 'string' }],
        ],
        [
          'KeyValuePair',
          'name',
          ['Pair', { str: 'readwrite' }, { str: 'string' }],
        ],
      ],
    ]);
  });

  test('a SEMANTIC protocol declares no members and carries no dictionary', () => {
    expect(validEpsil('protocol Copyable {}')).toStrictEqual([
      'DeclareProtocol',
      'Copyable',
    ]);
  });

  test('a bare `value: string` member steers to the property keywords', () => {
    expect(
      diagnosticsOf('protocol Computeable {\n  value: string\n}')
    ).toStrictEqual([['protocol-member-keyword-missing', 'value']]);
  });

  test('a member that is neither shape is a signature diagnostic', () => {
    expect(diagnosticsOf('protocol P {\n  compare(a, b)\n}')).toStrictEqual([
      ['protocol-member-signature-expected', 'P'],
    ]);
  });

  test('a `protocol` with no name is diagnosed', () => {
    expect(diagnosticsOf('protocol { }')[0]?.[0]).toBe(
      'protocol-name-expected'
    );
  });

  test('TOP-LEVEL ONLY: a protocol inside a block is a hard error', () => {
    // Protocols are engine-global, exactly like types — no hoisting.
    expect(diagnosticsOf('do { protocol P {} }')).toStrictEqual([
      ['protocol-declaration-not-top-level', 'P'],
    ]);
    expect(diagnosticsOf('function g(x) { protocol P {} }')).toStrictEqual([
      ['protocol-declaration-not-top-level', 'P'],
    ]);
  });

  test('a DISCARDED declaration does not flavor later diagnostics', () => {
    // The name is seeded for the member block, and unseeded again on every
    // failure return: a declaration the parser threw away is not a protocol, so
    // the name in type position is a plain unknown type — not the
    // `protocol-in-type-position` guidance a real protocol draws.
    expect(
      diagnosticsOf(
        'function f(x) {\n  protocol Bogus { function m(self: Self) -> integer }\n  1\n}\nlet y: Bogus = 1'
      )
    ).toStrictEqual([
      ['protocol-declaration-not-top-level', 'Bogus'],
      ['type-annotation-error', 'Unknown type "Bogus"'],
    ]);
    // …the same for the other failure return, a declaration with no body.
    expect(diagnosticsOf('protocol Bogus\nlet y: Bogus = 1')).toStrictEqual([
      ['opening-bracket-expected', '{'],
      ['type-annotation-error', 'Unknown type "Bogus"'],
    ]);
    // A SUCCESSFUL declaration still draws the protocol diagnostic.
    expect(
      diagnosticsOf(
        'protocol Good { function m(self: Self) -> integer }\nlet y: Good = 1'
      )
    ).toStrictEqual([['protocol-in-type-position', 'Good']]);
  });

  test('…and a failed RE-declaration does not unseed the name it re-declares', () => {
    // Unseeding is conditional on the name not being known BEFORE the statement:
    // a protocol declared earlier in the program (or by the engine's registry)
    // survives a later misplaced copy of itself.
    expect(
      diagnosticsOf(
        'protocol Good { function m(self: Self) -> integer }\nfunction f(x) {\n  protocol Good { function m(self: Self) -> integer }\n  1\n}\nlet y: Good = 1'
      )
    ).toStrictEqual([
      ['protocol-declaration-not-top-level', 'Good'],
      ['protocol-in-type-position', 'Good'],
    ]);
    const [, diagnostics] = parseEpsil(
      'function f(x) {\n  protocol Seeded { function m(self: Self) -> integer }\n  1\n}\nlet y: Seeded = 1',
      undefined,
      { protocolNames: ['Seeded'] }
    );
    expect(diagnostics.map((d) => d.message)).toStrictEqual([
      ['protocol-declaration-not-top-level', 'Seeded'],
      ['protocol-in-type-position', 'Seeded'],
    ]);
  });

  test('the statement after a misplaced protocol still parses', () => {
    // The declaration is parsed and DISCARDED, so the cursor lands past the
    // member block and the enclosing statement list is not swallowed.
    expect(
      diagnosticsOf('do { protocol P { readonly a: string }\n 1 }')
    ).toStrictEqual([['protocol-declaration-not-top-level', 'P']]);
  });

  test('`Self` is contextual: it is only known inside the braces', () => {
    // A protocol signature may name `Self`; an ordinary annotation may not
    // (it is not a declarable type — ruling P12).
    expect(diagnosticsOf(COMPARABLE)).toStrictEqual([]);
    expect(diagnosticsOf('let x: Self = 1')[0]?.[0]).toBe(
      'type-annotation-error'
    );
  });

  test('`protocol` is an ACTIVE word: it is reserved in expression position', () => {
    expect(diagnosticsOf('y = protocol')).toStrictEqual([
      ['reserved-word', 'protocol'],
    ]);
  });
});

describe('EPSIL CONFORMANCE DECLARATIONS', () => {
  test('`type string is Hashable` lowers to DeclareConformance', () => {
    expect(validEpsil('type string is Hashable')).toStrictEqual([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Hashable'],
    ]);
  });

  test('the `&` form lists protocol NAMES (not a type intersection)', () => {
    expect(validEpsil('type string is Hashable & Comparable')).toStrictEqual([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Hashable', 'Comparable'],
    ]);
  });

  test('the target may be a ground APPLICATION, captured as source text', () => {
    expect(validEpsil('type list<integer> is Hashable')).toStrictEqual([
      'DeclareConformance',
      { str: 'list<integer>' },
      ['List', 'Hashable'],
    ]);
  });

  test('the COMBINED form lowers to TWO top-level statements', () => {
    // Not a nested `Block` — that would push a scope, and both statements are
    // top-level only.
    expect(
      validEpsil('type Point = tuple<number, number> is Comparable')
    ).toStrictEqual([
      'Block',
      ['DeclareType', 'Point', { str: 'tuple<number, number>' }],
      ['DeclareConformance', { str: 'Point' }, ['List', 'Comparable']],
    ]);
  });

  test('an implementation block is carried syntactically', () => {
    expect(
      validEpsil(
        'type string is Comparable {\n  function compare(self: Self, other: Self) -> string { "=" }\n}'
      )
    ).toStrictEqual([
      'DeclareConformance',
      { str: 'string' },
      ['List', 'Comparable'],
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          [
            'Function',
            ['Typed', ['Block', { str: '=' }], { str: 'string' }],
            ['Typed', 'self', { str: 'Self' }],
            ['Typed', 'other', { str: 'Self' }],
          ],
        ],
      ],
    ]);
  });

  test('`get`/`set` members ride under mangled keys', () => {
    const ast = validEpsil(
      'type Person is Nameable {\n  get name(self: Self) -> string { "a" }\n  set name(self: Self, v: string) -> string { v }\n}'
    ) as any[];
    const keys = (ast[3] as any[]).slice(1).map((kv: any[]) => kv[1]);
    expect(keys).toStrictEqual(['__get__name', '__set__name']);
  });

  test('the expression-position `is` type test is UNAFFECTED', () => {
    // Statement position is disjoint from `TYPE_TEST_PRECEDENCE`.
    expect(validEpsil('x is integer')).toStrictEqual([
      'Element',
      'x',
      'integer',
    ]);
    expect(validEpsil('let b = x is integer')).toStrictEqual([
      'Declare',
      'b',
      ['Dictionary', ['KeyValuePair', 'value', ['Element', 'x', 'integer']]],
    ]);
    // A binding NAMED `type` keeps its type test: the conformance form needs
    // a non-empty target between `type` and `is`.
    expect(validEpsil('type is integer')).toStrictEqual([
      'Element',
      'type',
      'integer',
    ]);
  });

  test('an EXPRESSION headed by a binding named `type` is not hijacked', () => {
    // `type` is only a CONTEXTUAL keyword, so a same-line top-level `is` is
    // not enough on its own: the span between `type` and `is` must actually
    // denote a type.
    expect(diagnosticsOf('let type = 5\ntype + 1 is integer')).toStrictEqual(
      []
    );
    expect(validEpsil('let type = 5\ntype + 1 is integer')).toStrictEqual([
      'Block',
      ['Declare', 'type', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['Element', ['Add', 'type', 1], 'integer'],
    ]);

    expect(diagnosticsOf('let type = 5\ntype.x is integer')).toStrictEqual([]);
    expect(validEpsil('let type = 5\ntype.x is integer')).toStrictEqual([
      'Block',
      ['Declare', 'type', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['Element', ['Field', 'type', { str: 'x' }], 'integer'],
    ]);
  });

  test('a target that DOES denote a type still claims the statement', () => {
    // The counterpart of the test above: an application target parses as a
    // type, so this is a conformance. (Whether `Comparable` is a declared
    // protocol is the engine's verdict at execution — the PARSE shape is what
    // is asserted here.)
    expect(validEpsil('type list<integer> is Comparable')).toStrictEqual([
      'DeclareConformance',
      { str: 'list<integer>' },
      ['List', 'Comparable'],
    ]);
    // An UNDECLARED name is still a type SYNTACTICALLY, so it is claimed too;
    // "no such type" is reported at execution, not by re-reading the
    // statement as an expression.
    expect(validEpsil('type FooBar is Comparable')).toStrictEqual([
      'DeclareConformance',
      { str: 'FooBar' },
      ['List', 'Comparable'],
    ]);
  });

  test('a `function` member may not spell the property-handler mangling', () => {
    // `__get__x` / `__set__x` are the keys `get`/`set` members ride under, so
    // a function of that name would be indistinguishable from a property
    // handler (and would print back as one).
    expect(
      diagnosticsOf(
        'type string is Comparable {\n  function __get__x(self: Self) -> string { "a" }\n}'
      )
    ).toStrictEqual([['reserved-word', '__get__x']]);
  });

  test('an ordinary `type` declaration is unaffected', () => {
    expect(
      validEpsil('type point = tuple<x: integer, y: integer>')
    ).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<x: integer, y: integer>' },
    ]);
  });

  test('TOP-LEVEL ONLY: a conformance inside a block is a hard error', () => {
    expect(
      diagnosticsOf('function g(x) { type string is Hashable }')
    ).toStrictEqual([['type-declaration-not-top-level', 'string']]);
  });

  test('a line break before the first scanned token is a boundary too', () => {
    // `type` ends one line and `string is …` starts the next: these are TWO
    // statements (a bare reference to a binding named `type`, then an
    // expression-position `is` type test) — not one conformance declaration
    // spanning the break. Only the FIRST token after `type` was exempted from
    // the linebreak boundary check (`i > from`), so `type` immediately
    // followed by a linebreak was hijacked; every later token was already
    // correctly checked.
    expect(validEpsil('let type = 5\ntype\nstring is integer')).toStrictEqual(
      [
        'Block',
        ['Declare', 'type', ['Dictionary', ['KeyValuePair', 'value', 5]]],
        'type',
        ['Element', 'string', 'integer'],
      ]
    );
  });

  test('a malformed conformance tail does not leave the type name known', () => {
    // The type body parses (`Foo` is declared), but the tail after `is` is
    // not a protocol name, so `parseConformanceTail` fails and the combined
    // statement is discarded. The parser's own `unseed()` invariant must
    // still fire here, exactly as on every other failure path in
    // `parseTypeStatement` — otherwise `Foo` stays in `knownTypeNames` and a
    // later annotation accepts a type that was never actually declared.
    expect(
      diagnosticsOf('type Foo = tuple<integer> is 1\nlet x: Foo = 1')
    ).toStrictEqual([
      ['protocol-name-expected'],
      ['type-annotation-error', 'Unknown type "Foo"'],
    ]);
  });

  test('the protocol names sit on the SAME LINE as the `is`', () => {
    // Without the linebreak guard the tail read the next statement's head as
    // a protocol name — `let` is contextual, not reserved, so nothing else
    // stopped it. Recovery consumes nothing at a line start, so the following
    // statement still parses.
    const [ast, diagnostics] = parseEpsil(
      'type Foo = tuple<integer> is\nlet x = 1'
    );
    expect(diagnostics.map((d) => d.message)).toStrictEqual([
      ['protocol-name-expected'],
    ]);
    expect(JSON.parse(JSON.stringify(ast))).toMatchObject({
      fn: ['Declare', { sym: 'x' }, {}],
    });
  });

  test('a CONTEXTUAL statement head is never a protocol name', () => {
    // Same-line: `let`/`type`/`alias` are ordinary identifiers everywhere
    // else, but the only way one lands in a conformance tail is a missing
    // name.
    for (const word of ['let', 'type', 'alias'])
      expect(
        diagnosticsOf(`type Foo = tuple<integer> is ${word}`)
      ).toStrictEqual([['protocol-name-expected']]);
  });

  test('an ACTIVE reserved word still reports as a reserved word', () => {
    expect(
      diagnosticsOf('type Foo = tuple<integer> is function')
    ).toStrictEqual([['reserved-word', 'function']]);
  });
});

describe('EPSIL PROTOCOL SERIALIZATION round-trips', () => {
  test.each([
    [
      'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}',
    ],
    ['protocol Named {\n  readonly hash: string\n  readwrite name: string\n}'],
    ['protocol Copyable {}'],
    ['type string is Hashable'],
    ['type string is Hashable & Comparable'],
    ['type list<integer> is Hashable'],
    // A protocol name that is a HARD-reserved word has no plain spelling: it
    // must round-trip through its verbatim form, on both sides.
    ['protocol `if` {}'],
    ['protocol `if` {\n  readonly hash: string\n}'],
    ['type string is `if`'],
    ['type string is `if` & Comparable'],
  ])('%s', (src) => {
    const [ast, diagnostics] = parseEpsil(src);
    expect(diagnostics).toEqual([]);
    expect(serializeEpsil(ast!)).toBe(src);
  });

  test('the combined form serializes as the two statements it lowers to', () => {
    const [ast] = parseEpsil(
      'type Point = tuple<number, number> is Comparable'
    );
    expect(serializeEpsil(ast!)).toBe(
      'type Point = tuple<number, number>\ntype Point is Comparable'
    );
  });

  test('an implementation block round-trips', () => {
    const src =
      'type string is Comparable {\n  function compare(self: Self, other: Self) -> string {"="}\n}';
    const [ast, diagnostics] = parseEpsil(src);
    expect(diagnostics).toEqual([]);
    expect(serializeEpsil(ast!)).toBe(src);
  });
});

describe('EPSIL PROTOCOL EXECUTION', () => {
  test('a declaration registers, and a re-run REPLACES (P5)', () => {
    const ce = new ComputeEngine();
    expect(runCodes(ce, COMPARABLE)).toEqual([]);
    expect(Object.keys(ce._protocolRegistry.Comparable.members)).toEqual([
      'compare',
    ]);
    // Re-executing the statement (an edited notebook cell) replaces rather
    // than erroring — the `type` statement convention.
    expect(
      runCodes(
        ce,
        'protocol Comparable {\n  function compare(self: Self, other: Self) -> integer\n  readonly key: string\n}'
      )
    ).toEqual([]);
    expect(Object.keys(ce._protocolRegistry.Comparable.members).sort()).toEqual(
      ['compare', 'key']
    );
  });

  test('conformance to a built-in type registers', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, 'type string is Comparable');
    expect(
      ce._protocolRegistry.Comparable.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
  });

  test('the `&` form registers one edge per protocol', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, `${COMPARABLE}\nprotocol Hashable {}`);
    executeEpsil(ce, 'type string is Comparable & Hashable');
    expect(
      ce._protocolRegistry.Comparable.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
    expect(
      ce._protocolRegistry.Hashable.conformances.map((c) => c.targetKey)
    ).toEqual(['string']);
  });

  test('the combined declare-and-conform statement works end to end', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    const r = executeEpsil(
      ce,
      'type Point = tuple<number, number> is Comparable'
    );
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(ce.type('Point').toString()).toBe('Point');
    expect(
      ce._protocolRegistry.Comparable.conformances.map((c) => c.targetKey)
    ).toEqual(['Point']);
  });

  test('an implementation block is stored RAW under its member keys', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(
      ce,
      'type string is Comparable {\n  function compare(self: Self, other: Self) -> string { "=" }\n}'
    );
    const [edge] = ce._protocolRegistry.Comparable.conformances;
    expect(Object.keys(edge.impl!)).toEqual(['compare']);
    expect(edge.pending).toBe(false);
  });

  test('an `&` conformance may not carry an implementation block', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, `${COMPARABLE}\nprotocol Hashable {}`);
    const r = executeEpsil(
      ce,
      'type string is Comparable & Hashable {\n  function compare(self: Self, other: Self) -> string { "=" }\n}'
    );
    expect(r.value.toString()).toContain('protocol-implementation-split');
  });

  test('an unknown protocol and an unknown target are error values', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'type string is Nope').value.toString()).toContain(
      'protocol-unknown'
    );
    executeEpsil(ce, COMPARABLE);
    expect(
      executeEpsil(ce, 'type FooBar is Comparable').value.toString()
    ).toContain('protocol-target-unknown');
  });

  test('a `type alias` target is rejected with the steering message', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, 'type alias Pair = tuple<number, number>');
    const r = executeEpsil(ce, 'type Pair is Comparable');
    expect(r.value.toString()).toContain('protocol-conformance-target-invalid');
    expect(r.value.toString()).toContain('Structural types');
  });

  test('a union target is rejected', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    expect(
      executeEpsil(ce, 'type integer | string is Comparable').value.toString()
    ).toContain('protocol-conformance-target-invalid');
  });

  test('OVERLAP: comparable targets are fine, incomparable overlapping ones are not', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    // `number` then `integer` — comparable, so the refinement is allowed.
    expect(runCodes(ce, 'type number is Comparable')).toEqual([
      'protocol-implementation-pending',
    ]);
    expect(
      executeEpsil(ce, 'type integer is Comparable').value.toString()
    ).toBe('"Nothing"');
    // Disjoint targets never overlap.
    expect(executeEpsil(ce, 'type string is Comparable').value.toString()).toBe(
      '"Nothing"'
    );
  });

  test('OVERLAP: bounded refinements collide', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, 'type integer<1..10> is Comparable');
    const r = executeEpsil(ce, 'type integer<5..20> is Comparable');
    expect(r.value.toString()).toContain('protocol-conformance-overlap');
    expect(r.value.toString()).toContain('integer<5..10>');
    // Nothing was registered by the rejected statement.
    expect(
      ce._protocolRegistry.Comparable.conformances.map((c) => c.targetKey)
    ).toEqual(['integer<1..10>']);
  });

  test('a duplicate conformance is a NO-OP', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    executeEpsil(ce, 'type string is Comparable');
    expect(executeEpsil(ce, 'type string is Comparable').value.toString()).toBe(
      '"Nothing"'
    );
    expect(ce._protocolRegistry.Comparable.conformances).toHaveLength(1);
  });

  test('PENDING: the warning repeats every batch, and clears once fulfilled', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    expect(runCodes(ce, 'type string is Comparable')).toEqual([
      'protocol-implementation-pending',
    ]);
    // …every batch, until fulfilled (P3) — including a batch that has nothing
    // to do with protocols.
    expect(runCodes(ce, '1 + 1')).toEqual(['protocol-implementation-pending']);
    expect(
      runCodes(
        ce,
        'type string is Comparable {\n  function compare(self: Self, other: Self) -> string { "=" }\n}'
      )
    ).toEqual([]);
    expect(runCodes(ce, '1 + 1')).toEqual([]);
  });

  test('a SEMANTIC protocol is complete at declaration: never pending', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'protocol Copyable {}');
    expect(runCodes(ce, 'type string is Copyable')).toEqual([]);
    expect(ce._protocolRegistry.Copyable.conformances[0].pending).toBe(false);
  });
});

//
// ── First-parameter `Self` inference (P22) ──────────────────────────────────
//
// Appendix A allows `function compare(self, other: Self)`; the type grammar
// rejects a parameter list mixing named and unnamed parameters, so the sugar
// is a parser-side SOURCE REWRITE (`: Self` injected on an unannotated first
// parameter), never a grammar change. The captured signature is the
// NORMALIZED one, which is what the registry stores and the serializer prints.
//

describe('EPSIL PROTOCOL `Self` INFERENCE', () => {
  /** The signature source captured for the sole member of a protocol. */
  const signatureOf = (src: string): unknown =>
    ((validEpsil(src) as any[])[2] as any[])[1][2][2];

  test('an unannotated first parameter is normalized to `self: Self`', () => {
    expect(
      signatureOf(
        'protocol Comparable {\n  function compare(self, other: Self) -> string\n}'
      )
    ).toStrictEqual({ str: '(self: Self, other: Self) -> string' });
  });

  test('the zero-annotation SINGLE parameter form', () => {
    expect(
      signatureOf('protocol Hashable {\n  function hash(self) -> string\n}')
    ).toStrictEqual({ str: '(self: Self) -> string' });
  });

  test('an EXPLICIT `Self` is unchanged', () => {
    expect(
      signatureOf(
        'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}'
      )
    ).toStrictEqual({ str: '(self: Self, other: Self) -> string' });
  });

  test('an explicit NON-`Self` first parameter is left alone for the engine', () => {
    // The sugar must not rewrite it: `protocol-self-required` is the engine's
    // verdict on the signature the author actually wrote.
    expect(
      signatureOf(
        'protocol Bad {\n  function compare(self: list, other: Self) -> string\n}'
      )
    ).toStrictEqual({ str: '(self: list, other: Self) -> string' });
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'protocol Bad {\n  function compare(self: list, other: Self) -> string\n}'
      ).value.toString()
    ).toContain('protocol-self-required');
  });

  test('only the FIRST parameter is inferred', () => {
    // `(self: Self, other)` mixes named and unnamed parameters, which the type
    // grammar rejects — reported on the source as written.
    expect(
      diagnosticsOf('protocol P {\n  function f(self, other) -> string\n}')[0]
    ).toStrictEqual(['type-annotation-error', 'Unknown type "self"']);
  });

  test('a member with NO parameters is left to `protocol-self-required`', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'protocol P {\n  function f() -> string\n}'
      ).value.toString()
    ).toContain('protocol-self-required');
  });

  test('the sugar reaches the ENGINE: the member registers with `Self`', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self, other: Self) -> string\n}'
    );
    expect(ce._protocolRegistry.Comparable.members).toEqual({
      compare: {
        kind: 'function',
        signature: '(self: Self, other: Self) -> string',
      },
    });
  });

  test('ROUND TRIP: the sugar NORMALIZES — the explicit form is what prints', () => {
    // The serializer emits what is STORED, and what is stored is normalized;
    // re-parsing the normalized form is then a fixed point.
    const [ast, diagnostics] = parseEpsil(
      'protocol Comparable {\n  function compare(self, other: Self) -> string\n}'
    );
    expect(diagnostics).toEqual([]);
    const normalized =
      'protocol Comparable {\n  function compare(self: Self, other: Self) -> string\n}';
    expect(serializeEpsil(ast!)).toBe(normalized);
    const [again] = parseEpsil(normalized);
    expect(serializeEpsil(again!)).toBe(normalized);
  });
});

//
// ── Implementation blocks (phase 2, ruling P17) ─────────────────────────────
//

describe('EPSIL PROTOCOL IMPLEMENTATIONS', () => {
  /** An engine with `Comparable.compare(self: Self, other: Self) -> string`. */
  const withComparable = (): ComputeEngine => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    return ce;
  };
  const impl = (body: string): string =>
    `type string is Comparable {\n  ${body}\n}`;

  test('a matching implementation registers and clears `pending`', () => {
    const ce = withComparable();
    expect(
      runCodes(
        ce,
        impl('function compare(self: Self, other: Self) -> string { "=" }')
      )
    ).toEqual([]);
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);
  });

  test('`Self` and the target’s own name are SYNONYMS in an implementation', () => {
    const ce = withComparable();
    expect(
      executeEpsil(
        ce,
        impl('function compare(self: string, other: Self) -> string { "=" }')
      ).value.toString()
    ).toBe('"Nothing"');
  });

  test('an unknown member steers with a did-you-mean', () => {
    const ce = withComparable();
    const r = executeEpsil(
      ce,
      impl('function cmpare(self: Self, other: Self) -> string { "=" }')
    );
    expect(r.value.toString()).toContain('protocol-member-unknown');
    expect(r.value.toString()).toContain('Did you mean `compare`?');
    expect(ce._protocolRegistry.Comparable.conformances).toEqual([]);
  });

  test('a NARROWED parameter is `protocol-signature-mismatch` (Appendix A)', () => {
    const ce = withComparable();
    const r = executeEpsil(
      ce,
      impl('function compare(self: string, other: number) -> string { "=" }')
    );
    expect(r.value.toString()).toContain('protocol-signature-mismatch');
    expect(r.value.toString()).toContain('at `Self = string`');
    expect(r.value.toString()).toContain('argument 2 is `number`');
  });

  test('a WIDENED parameter and a NARROWED result are accepted', () => {
    const ce = withComparable();
    expect(
      executeEpsil(
        ce,
        impl(
          'function compare(self: Self, other: any) -> "<" | "=" | ">" { "=" }'
        )
      ).value.toString()
    ).toBe('"Nothing"');
  });

  test('an EFFECTFUL implementation of a BARE requirement is accepted', () => {
    // `COMPARABLE`'s requirement spells no effect specifier, and a bare
    // requirement is no ceiling: a protocol function is a dispatcher over an
    // open set of conforming bodies, so its effect set is DERIVED from them.
    // `docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
    // effect", rejects the alternative by name ("bare-means-pure ceilings on
    // requirements").
    const ce = withComparable();
    expect(
      runCodes(
        ce,
        impl(
          'function compare(self: Self, other: Self) console -> string { "=" }'
        )
      )
    ).toEqual([]);
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);
  });

  test('an explicit `pure` ceiling in the requirement rejects it', () => {
    // The Epsil protocol surface CAN spell an effect specifier on a
    // requirement, and a spelled one IS a ceiling.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self: Self, other: Self) pure -> string\n}'
    );
    const r = executeEpsil(
      ce,
      impl(
        'function compare(self: Self, other: Self) console -> string { "=" }'
      )
    );
    const message = r.value.toString();
    expect(message).toContain('protocol-signature-mismatch');
    expect(message).toContain('it declares the effects `console`');
    expect(message).toContain('exceeded by `console`');
    expect(message).toContain(
      "the requirement's ceiling on `Comparable.compare`"
    );
    expect(message).toContain('widen the ceiling');
  });

  test('a ceiling rejects a BODY that exceeds it, with no declared marker', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self: Self, other: Self) pure -> string\n}'
    );
    const r = executeEpsil(
      ce,
      impl(
        'function compare(self: Self, other: Self) -> string { Random(); "=" }'
      )
    );
    const message = r.value.toString();
    expect(message).toContain('protocol-signature-mismatch');
    expect(message).toContain(
      'the body of `compare` infers the effects `random`'
    );
    expect(message).toContain('exceeded by `random`');
  });

  test('an EMPTY block on a protocol WITH requirements is a hole', () => {
    const ce = withComparable();
    const r = executeEpsil(ce, 'type string is Comparable {}');
    expect(r.value.toString()).toContain('protocol-implementation-missing');
    expect(r.value.toString()).toContain('compare');
  });

  test('an empty block on a SEMANTIC protocol is accepted', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'protocol Copyable {}');
    expect(runCodes(ce, 'type string is Copyable {}')).toEqual([]);
  });

  test('the `Self`-inference sugar works in the protocol, not the block', () => {
    // The protocol member is sugared; the implementation's own parameters are
    // ordinary function-literal parameters, so an unannotated one is `any`
    // (documented v1 behavior) and passes contravariance.
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Comparable {\n  function compare(self, other: Self) -> string\n}'
    );
    expect(
      runCodes(ce, impl('function compare(self, other) -> string { "=" }'))
    ).toEqual([]);
  });

  test('ATOMIC REPLACE: an invalid re-declaration keeps the previous impl', () => {
    const ce = withComparable();
    executeEpsil(
      ce,
      impl('function compare(self: Self, other: Self) -> string { "=" }')
    );
    const stored = ce._protocolRegistry.Comparable.conformances[0].impl;

    const r = executeEpsil(
      ce,
      impl('function compare(self: Self, other: number) -> string { "=" }')
    );
    expect(r.value.toString()).toContain('protocol-signature-mismatch');
    expect(ce._protocolRegistry.Comparable.conformances[0].impl).toBe(stored);
    expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(false);

    // A VALID re-run replaces (P5).
    expect(
      runCodes(
        ce,
        impl('function compare(self: Self, other: any) -> string { "=" }')
      )
    ).toEqual([]);
    expect(ce._protocolRegistry.Comparable.conformances[0].impl).not.toBe(
      stored
    );
  });

  //
  // ── P47: same batch = duplicate, later batch = re-run ─────────────────────
  //
  // A second implementation block for one (type, protocol) pair WITHIN one
  // `executeEpsil` run is `protocol-implementation-duplicate`; the same
  // statement re-run in a LATER batch replaces (the notebook pattern). The
  // batch spans the static pre-pass AND the evaluation loop, and one statement
  // registers its block up to three times per batch — none of which may read
  // as a duplicate of itself.
  //
  describe('P47: a second block in one batch is a duplicate', () => {
    const BLOCK = (result: string): string =>
      impl(`function compare(self: Self, other: Self) -> string { ${result} }`);

    test('ONE block in a batch runs clean (the pre-pass does not shadow itself)', () => {
      // The pre-pass installs the block (stamped with THIS batch), rolls back,
      // and the evaluation loop installs it again: the loop's install must not
      // read the pre-pass's own stamp as a duplicate. Both edge states are
      // exercised — one the batch CREATES, one a previous batch left behind.
      const ce = withComparable();
      const r = executeEpsil(ce, BLOCK('"="'));
      expect(r.diagnostics).toEqual([]);
      expect(r.value.toString()).toBe('"Nothing"');
      expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(
        false
      );

      const onExistingEdge = new ComputeEngine();
      executeEpsil(onExistingEdge, COMPARABLE);
      executeEpsil(onExistingEdge, 'type string is Comparable');
      const again = executeEpsil(onExistingEdge, BLOCK('"="'));
      expect(again.diagnostics).toEqual([]);
      expect(again.value.toString()).toBe('"Nothing"');
    });

    test('TWO blocks in one batch: the second is a duplicate, the first stands', () => {
      const ce = withComparable();
      const r = executeEpsil(ce, `${BLOCK('"="')}\n${BLOCK('"<"')}`);
      expect(r.value.toString()).toContain('protocol-implementation-duplicate');
      expect(r.value.toString()).toContain(
        'already has an implementation of the `Comparable` protocol in this batch'
      );
      // The pre-pass sees the collision first (conformances register from the
      // canonical handler), so it is a STATIC diagnostic too.
      expect(
        r.diagnostics.map((d) => (Array.isArray(d.message) ? d.message : []))
      ).toContainEqual(
        expect.arrayContaining(['protocol-implementation-duplicate'])
      );
      // The FIRST implementation is installed and functional.
      expect(ce._protocolRegistry.Comparable.conformances[0].pending).toBe(
        false
      );
      expect(executeEpsil(ce, 'compare("a", "b")').value.toString()).toBe(
        '"="'
      );
    });

    test('TWO BATCHES: the same statement re-run REPLACES (P24 atomicity kept)', () => {
      const ce = withComparable();
      expect(runCodes(ce, BLOCK('"="'))).toEqual([]);
      const stored = ce._protocolRegistry.Comparable.conformances[0].impl;
      expect(runCodes(ce, BLOCK('"<"'))).toEqual([]);
      expect(ce._protocolRegistry.Comparable.conformances[0].impl).not.toBe(
        stored
      );
      expect(executeEpsil(ce, 'compare("a", "b")').value.toString()).toBe(
        '"<"'
      );
    });

    test('a bare re-declaration between the two blocks does not reset the stamp', () => {
      const ce = withComparable();
      const r = executeEpsil(
        ce,
        `${BLOCK('"="')}\ntype string is Comparable\n${BLOCK('"<"')}`
      );
      expect(r.value.toString()).toContain('protocol-implementation-duplicate');
    });

    test('the NEXT batch replaces normally after an in-batch duplicate', () => {
      const ce = withComparable();
      executeEpsil(ce, `${BLOCK('"="')}\n${BLOCK('"<"')}`);
      expect(runCodes(ce, BLOCK('">"'))).toEqual([]);
      expect(executeEpsil(ce, 'compare("a", "b")').value.toString()).toBe(
        '">"'
      );
    });
  });

  test('PROPERTY handlers: shapes, readonly `set`, and a missing `get`', () => {
    const NAMED =
      'protocol Named {\n  readonly hash: string\n  readwrite name: string\n}';
    const block = (...members: string[]) =>
      `type string is Named {\n  ${members.join('\n  ')}\n}`;
    const GET_HASH = 'get hash(self: Self) -> string { "h" }';
    const GET_NAME = 'get name(self: Self) -> string { "n" }';
    const SET_NAME = 'set name(self: Self, v: string) -> string { v }';

    const ce = new ComputeEngine();
    executeEpsil(ce, NAMED);
    expect(runCodes(ce, block(GET_HASH, GET_NAME, SET_NAME))).toEqual([]);

    const bad = new ComputeEngine();
    executeEpsil(bad, NAMED);
    expect(
      executeEpsil(
        bad,
        block('get hash(self: Self) -> integer { 1 }', GET_NAME, SET_NAME)
      ).value.toString()
    ).toContain('protocol-signature-mismatch');
    expect(
      executeEpsil(
        bad,
        block(
          GET_HASH,
          'set hash(self: Self, v: string) -> string { v }',
          GET_NAME,
          SET_NAME
        )
      ).value.toString()
    ).toContain('protocol-property-readonly-set');
    const missing = executeEpsil(bad, block(GET_HASH, SET_NAME));
    expect(missing.value.toString()).toContain(
      'protocol-implementation-missing'
    );
    expect(missing.value.toString()).toContain('get name');
    expect(bad._protocolRegistry.Named.conformances).toEqual([]);
  });
});

describe('EPSIL PROTOCOL DISPATCH (phase 3)', () => {
  // The Epsil-surface half of `test/compute-engine/protocol-dispatch.test.ts`:
  // a whole program, executed, whose VALUE is the dispatched result.
  const PROGRAM = `protocol Comparable {
  function compare(self: Self, other: Self) -> string
}
type string is Comparable {
  function compare(self: Self, other: Self) -> string {
    if (self < other) { "<" } else { "=" }
  }
}`;

  test('a bare call dispatches to the implementation', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, PROGRAM);
    const r = executeEpsil(ce, 'compare("a", "b")');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('"<"');
  });

  test('a QUALIFIED call dispatches inside the named protocol', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, PROGRAM);
    const r = executeEpsil(ce, 'Comparable.compare("z", "b")');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('"="');
  });

  test('a whole program dispatches in one batch, warning-free (P20)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, `${PROGRAM}\ncompare("a", "b")`);
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('"<"');
  });

  test('a user `function` of the member name shadows the bare call', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `${PROGRAM}\nfunction compare(a, b) { "user" }\ncompare("a", "b")`
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('"user"');
    expect(
      executeEpsil(ce, 'Comparable.compare("a", "b")').value.toString()
    ).toBe('"<"');
  });

  test('`Self` binds to the first argument: argument 2 is checked against it', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, PROGRAM);
    const r = executeEpsil(ce, 'compare("a", 3)');
    expect(r.value.toString()).toContain('incompatible-type');
  });
});

describe('EPSIL CONDITIONAL CONFORMANCE (phase 5)', () => {
  //
  // `type list<T> is Comparable where T is Comparable { … }` — the head names
  // the target's variables and the trailing `where` clause BINDS them. The
  // clause rides the lowering as its VERBATIM source text (the P11 pattern),
  // ahead of the implementation block and told apart from it by its head.
  //

  test('the clause rides as a STRING operand', () => {
    expect(
      validEpsil('type list<T> is Comparable where T is Comparable')
    ).toStrictEqual([
      'DeclareConformance',
      { str: 'list<T>' },
      ['List', 'Comparable'],
      { str: 'where T is Comparable' },
    ]);
  });

  test('an ELIDED bound is legal', () => {
    expect(validEpsil('type list<T> is Comparable where T')).toStrictEqual([
      'DeclareConformance',
      { str: 'list<T>' },
      ['List', 'Comparable'],
      { str: 'where T' },
    ]);
  });

  test('the clause`s names are in scope for the implementation block, whose quantified parameters are ERASED', () => {
    // The parameter annotations mention `T`, so they lower to bare symbols and
    // the FULL signature — clause included — rides as the body's ascription
    // (§3.1's erased lowering). Keeping `["Typed", "self", {str:"list<T>"}]`
    // would name a variable no clause declares once the literal is boxed.
    expect(
      validEpsil(
        'type list<T> is Comparable where T is Comparable {\n  function compare(self: list<T>, other: list<T>) -> string { "=" }\n}'
      )
    ).toStrictEqual([
      'DeclareConformance',
      { str: 'list<T>' },
      ['List', 'Comparable'],
      { str: 'where T is Comparable' },
      [
        'Dictionary',
        [
          'KeyValuePair',
          'compare',
          [
            'Function',
            [
              'Typed',
              ['Block', { str: '=' }],
              {
                str: '(self: list<T>, other: list<T>) -> string where T is Comparable',
              },
            ],
            'self',
            'other',
          ],
        ],
      ],
    ]);
  });

  test('a member that mentions NO clause variable keeps the ordinary ascription', () => {
    // Appending an unused clause would make the assembled signature fail the
    // type grammar's "quantified but never used" rule.
    const ast = validEpsil(
      'type list<T> is Comparable where T {\n  function compare(self, other) -> string { "=" }\n}'
    ) as any[];
    expect(ast[4][1][2]).toStrictEqual([
      'Function',
      ['Typed', ['Block', { str: '=' }], { str: 'string' }],
      'self',
      'other',
    ]);
  });

  test('a clause on the next line is NOT this statement`s clause', () => {
    // A conformance tail does not cross a line.
    expect(
      diagnosticsOf('type list<T> is Comparable\nwhere T', ['integer'])
    ).not.toEqual([]);
  });

  test('a bound in the HEAD is steered to the clause', () => {
    const [message] = diagnosticsOf('type list<T: number> is Comparable');
    expect(message[0]).toBe('type-annotation-error');
    expect(String(message[1])).toContain('where T: <bound>');
  });

  test('round-trips through the serializer', () => {
    const source =
      'type list<T> is Comparable where T is Comparable {\n  function compare(self: list<T>, other: list<T>) -> string {"="}\n}';
    const [ast] = parseEpsil(source, undefined, { typeNames: [] });
    expect(serializeEpsil(ast)).toBe(source);
  });

  test('the whole Appendix A example runs and dispatches', () => {
    const ce = new ComputeEngine();
    const program = [
      COMPARABLE,
      'type string is Comparable {\n  function compare(self: Self, other: Self) -> string {\n    if (self < other) { "<" } else { ">" }\n  }\n}',
      'type list<T> is Comparable where T is Comparable {\n  function compare(self: list<T>, other: list<T>) -> string {\n    compare(self[1], other[1])\n  }\n}',
      'compare(["b","x"], ["a","c"])',
    ].join('\n');
    const r = executeEpsil(ce, program);
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('">"');
  });

  test('a PROTOCOL name in type position is reported as such', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, COMPARABLE);
    expect(
      executeEpsil(
        ce,
        'function f(x: Comparable) -> boolean { true }'
      ).diagnostics.map((d) => d.message)
    ).toEqual([['protocol-in-type-position', 'Comparable']]);
    // …and an unknown name keeps its generic report.
    expect(
      executeEpsil(
        ce,
        'function g(x: Bogus) -> boolean { true }'
      ).diagnostics.map((d) => d.message)
    ).toEqual([['type-annotation-error', 'Unknown type "Bogus"']]);
  });
});
