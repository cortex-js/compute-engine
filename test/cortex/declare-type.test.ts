import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { validCortex } from '../utils';

//
// Cortex user-defined types: the `type name = <type>` and
// `type alias name = <type>` statements.
//
// `type` is a CONTEXTUAL keyword — it stays a legal identifier everywhere
// (`type = 5`, `type: integer = 4`, `let type = 5`, a bare `type`). Only the
// unambiguous shapes `type Name =` / `type Name<` (and the same after
// `alias`) claim it as a statement head. `alias` is not reserved either: the
// disambiguation is pure lookahead.
//
// The lowering (fixed contract, mirrored by the engine's `DeclareType`):
//
//   type point = tuple<x: integer, y: integer>            // NOMINAL
//     → ["DeclareType", "point", {str: "tuple<x: integer, y: integer>"}]
//
//   type alias pair = tuple<number, number>               // STRUCTURAL
//     → ["DeclareType", "pair", {str: "tuple<number, number>"},
//          ["Dictionary", ["KeyValuePair", "alias", "True"]]]
//
// The body is the TRIMMED SOURCE TEXT of the type (the parsed `Type` is
// discarded — parse-time typing is only a syntax check). The bare form carries
// NO attributes: nominal is `DeclareType`'s default. Only the `alias` word
// emits the `alias -> True` bag.
//
// These are PARSE-level tests: they assert on the MathJSON from `parseCortex`,
// never on evaluation, so they do not depend on the engine-side `DeclareType`
// operator.
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function diagnosticsOf(source: string, typeNames?: readonly string[]) {
  const [, diagnostics] = parseCortex(source, undefined, { typeNames });
  return diagnostics.map((d) => d.message);
}

describe('CORTEX TYPE DECLARATIONS', () => {
  test('a bare `type` lowers to a NOMINAL DeclareType (no attributes)', () => {
    expect(
      validCortex('type point = tuple<x: integer, y: integer>')
    ).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<x: integer, y: integer>' },
    ]);
  });

  test('a simple nominal body', () => {
    expect(validCortex('type point = tuple<number, number>')).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<number, number>' },
    ]);
  });

  test('`type alias` lowers to a STRUCTURAL DeclareType', () => {
    expect(
      validCortex('type alias pair = tuple<number, number>')
    ).toStrictEqual([
      'DeclareType',
      'pair',
      { str: 'tuple<number, number>' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });

  test('`type alias = …` declares a type NAMED `alias` (D8 lookahead pin)', () => {
    // Only `=` follows `alias`, so there is no name for the alias form to
    // claim: this is the BARE form declaring a nominal type named `alias`.
    // Legal, discouraged, and pinned so the lookahead cannot regress.
    expect(validCortex('type alias = tuple<number, number>')).toStrictEqual([
      'DeclareType',
      'alias',
      { str: 'tuple<number, number>' },
    ]);
  });

  test('the declared name is visible to a later annotation', () => {
    // The `type` statement seeds the name BEFORE the rest of the program is
    // parsed, so `p: point` resolves rather than erroring `Unknown type`.
    // (Both forms seed; the alias form is used here because its annotation
    // also succeeds at run time.)
    expect(
      diagnosticsOf('type point = tuple<number, number>\nlet p: point = (1, 2)')
    ).toEqual([]);
    expect(
      validCortex(
        'type alias point = tuple<number, number>\nlet p: point = (1, 2)'
      )
    ).toStrictEqual([
      'Block',
      [
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
        ['Dictionary', ['KeyValuePair', 'alias', 'True']],
      ],
      [
        'Declare',
        'p',
        { str: 'point' },
        ['Dictionary', ['KeyValuePair', 'value', ['Tuple', 1, 2]]],
      ],
    ]);
  });
});

describe('CORTEX TYPE NAMES (host-supplied)', () => {
  test('a host type name resolves when passed as `typeNames`', () => {
    expect(diagnosticsOf('let p: hosttype = 1', ['hosttype'])).toEqual([]);
  });

  test('without `typeNames` an unknown name is still a parse-time error', () => {
    expect(diagnosticsOf('let p: hosttype = 1')).toEqual([
      ['type-annotation-error', 'Unknown type "hosttype"'],
    ]);
  });

  test('a typo is still caught even with other names known', () => {
    expect(diagnosticsOf('let p: hosttyp = 1', ['hosttype'])).toEqual([
      ['type-annotation-error', 'Unknown type "hosttyp"'],
    ]);
  });
});

describe('CORTEX `type` IS A CONTEXTUAL KEYWORD', () => {
  // Each of these must parse exactly as it did before the `type` statement
  // existed: `type` remains an ordinary identifier.
  test('assignment to a variable named `type`', () => {
    expect(validCortex('type = 5')).toStrictEqual(['Assign', 'type', 5]);
  });

  test('`let type = 5`', () => {
    expect(validCortex('let type = 5')).toStrictEqual([
      'Declare',
      'type',
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('an annotation on a variable named `type`', () => {
    expect(validCortex('type: integer = 4')).toStrictEqual([
      'Declare',
      'type',
      { str: 'integer' },
      ['Dictionary', ['KeyValuePair', 'value', 4]],
    ]);
  });

  test('a bare `type` expression', () => {
    expect(validCortex('type')).toStrictEqual('type');
  });

  test('`type` used as a value in a later statement', () => {
    expect(validCortex('let type = 5\ntype + 1')).toStrictEqual([
      'Block',
      ['Declare', 'type', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['Add', 'type', 1],
    ]);
  });
});

describe('CORTEX TYPE DECLARATION DIAGNOSTICS', () => {
  test('the generic-alias slot is reserved but unsupported', () => {
    const diagnostics = diagnosticsOf('type point<T> = tuple<T, T>');
    expect(diagnostics).toEqual([['type-variables-unsupported', 'point']]);
  });

  test('a rejected generic alias does not stop the parse', () => {
    const source = 'type point<T> = tuple<T, T>\nlet a = 1';
    const [value, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['type-variables-unsupported', 'point'],
    ]);
    // The following statement still parses.
    expect(JSON.stringify(value)).toContain('Declare');
  });

  test('…but the `alias` form ACCEPTS a clause (generic aliases)', () => {
    expect(diagnosticsOf('type alias pair<T> = tuple<T, T>')).toEqual([]);
  });

  test('a reserved word cannot name a type', () => {
    expect(diagnosticsOf('type if = integer')).toEqual([
      ['reserved-word', 'if'],
    ]);
  });

  test('a reserved word cannot name an alias either', () => {
    expect(diagnosticsOf('type alias if = integer')).toEqual([
      ['reserved-word', 'if'],
    ]);
  });

  test('a malformed type body is a type-annotation-error', () => {
    expect(diagnosticsOf('type point = tuple<')).toEqual([
      ['type-annotation-error', 'Expected tuple element'],
    ]);
  });
});

//
// GENERIC type aliases: `type alias Pair<T> = tuple<T, T>`
// (`docs/plans/2026-08-04-generic-type-aliases-design.md`).
//
// The clause rides the attributes bag as its source TEXT (A1) — never without
// `alias -> True`, a shape the lowering cannot produce. The body parses with
// the clause's names in scope, and they leave scope with the statement.
//
describe('CORTEX GENERIC TYPE ALIASES (lowering)', () => {
  test('a clause lowers to a `typeParams` attrs entry', () => {
    expect(validCortex('type alias Pair<T> = tuple<T, T>')).toStrictEqual([
      'DeclareType',
      'Pair',
      { str: 'tuple<T, T>' },
      [
        'Dictionary',
        ['KeyValuePair', 'alias', 'True'],
        ['KeyValuePair', 'typeParams', { str: 'T' }],
      ],
    ]);
  });

  test('a multi-parameter, bounded clause keeps the author’s spelling', () => {
    expect(
      validCortex('type alias Two<T, U: list<integer>> = tuple<T, U>')
    ).toStrictEqual([
      'DeclareType',
      'Two',
      { str: 'tuple<T, U>' },
      [
        'Dictionary',
        ['KeyValuePair', 'alias', 'True'],
        ['KeyValuePair', 'typeParams', { str: 'T, U: list<integer>' }],
      ],
    ]);
  });

  test('an applied reference in a later annotation parses', () => {
    expect(
      diagnosticsOf(
        'type alias Pair<T> = tuple<T, T>\nlet p: Pair<integer> = (1, 2)'
      )
    ).toEqual([]);
  });

  test('the clause names are OUT of scope after the statement', () => {
    expect(
      diagnosticsOf('type alias Pair<T> = tuple<T, T>\nlet q: T = 1')
    ).toEqual([['type-annotation-error', 'Unknown type "T"']]);
  });

  test('an empty clause is diagnosed and declares nothing', () => {
    expect(
      diagnosticsOf('type alias Pair<> = tuple<integer, integer>\nlet p: Pair = 1')
    ).toEqual([
      ['empty-type-parameter-clause', 'Pair'],
      ['type-annotation-error', 'Unknown type "Pair"'],
    ]);
  });

  test('a duplicate clause name is diagnosed at the clause, and declares nothing', () => {
    // Exactly ONE diagnostic for the duplicate (the source-range scanner's),
    // and the name is un-seeded: the next annotation reports it unknown.
    expect(
      diagnosticsOf('type alias Pair<T, T> = tuple<T, T>\nlet p: Pair<integer> = 1')
    ).toEqual([
      ['duplicate-type-parameter', 'T'],
      ['type-annotation-error', 'Unknown type "Pair"'],
    ]);
  });

  test('a RESERVED clause name is rejected by the shared clause parser', () => {
    expect(
      diagnosticsOf('type alias Pair<forall> = tuple<forall, forall>')
    ).toEqual([
      ['type-annotation-error', 'The type name "forall" is reserved'],
    ]);
  });

  test('…and its position survives LEADING WHITESPACE in the clause', () => {
    // The shared parser reports positions relative to the TRIMMED clause text,
    // so the whitespace it dropped has to be added back — otherwise the
    // diagnostic lands one column early, on the space.
    const source = 'type alias Pair< forall> = tuple<forall, forall>';
    const [, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'The type name "forall" is reserved'],
    ]);
    expect(diagnostics[0].range[0]).toBe(source.indexOf('forall'));
    expect(source.slice(diagnostics[0].range[0], source.indexOf('>'))).toBe(
      'forall'
    );
  });

  test('a malformed clause un-seeds the name and the next statement parses', () => {
    const source = 'type alias Pair<T = tuple<T, T>\nlet a = 1';
    const [value, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['closing-bracket-expected', '>'],
    ]);
    expect(JSON.stringify(value)).toContain('Declare');
  });
});

//
// A6 recovery, now reachable through the applied-reference syntax: a malformed
// applied alias costs its own statement / its own list element and no more.
//
describe('CORTEX MALFORMED APPLIED ALIAS RECOVERY', () => {
  function recovered(source: string): string {
    const [expr] = parseCortex(source);
    return expr === null ? '' : serializeCortex(expr);
  }

  test('in a `type` statement, the next statement survives', () => {
    const source =
      'type alias Pair<T> = tuple<T, T>\ntype alias Bad = Pair<integer\nlet a = 0\na + 1';
    const [, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
    ]);
    expect(recovered(source)).toContain('let a = 0');
  });

  test('in a function parameter list, the rest of the list parses', () => {
    // The `<` here is never closed, so everything up to the `)` belongs to the
    // type's argument list as far as the resync can tell — `b: integer` is
    // swallowed with it, and only `a` survives (untyped). That is the
    // deliberate trade: honoring `<…>` nesting costs a following element in
    // the UNCLOSED case, and buys never minting a bogus one from the type's
    // own arguments (`f(x, string)` for `x: Pair<integer, string)`).
    const source =
      'type alias Pair<T> = tuple<T, T>\nfunction f(a: Pair<integer, b: integer) { b }';
    const [value, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
    ]);
    expect(JSON.stringify(value)).toContain('DefineFunction');
    expect(serializeCortex(value!)).toContain('function f(a) {b}');
  });

  test('…and a CLOSED `<…>` still resyncs at the next element', () => {
    // The nesting counter only changes the unclosed case: a balanced argument
    // list returns the scan to depth 0 before the comma, so the following
    // parameter parses exactly as it always did.
    const source = 'function f(x: nosuch<integer>, y: integer) { y }';
    const [value, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    expect(serializeCortex(value!)).toBe('function f(x, y: integer) {y}');
  });

  test('in a `match` pattern, the remainder of the arm parses', () => {
    // Same trade as the parameter list: the unclosed `<` swallows `m`, so the
    // arm's pattern recovers as the single binding `n`. The follow-on
    // `match-irrefutable-case` is an honest report about the RECOVERED shape
    // (a bare binding matches everything, so `_` is unreachable), not a second
    // complaint about the type.
    const source =
      'type alias Pair<T> = tuple<T, T>\nmatch x {\n  (n: Pair<integer, m) => 1\n  _ => 2\n}';
    const [value, diagnostics] = parseCortex(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
      'match-irrefutable-case',
    ]);
    expect(JSON.stringify(value)).toContain('Match');
  });
});

describe('CORTEX GENERIC TYPE ALIASES (serialization)', () => {
  test('a generic alias serializes as `type alias Pair<T> = …`', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'T' }],
        ],
      ])
    ).toBe('type alias Pair<T> = tuple<T, T>');
  });

  test('…in any key order', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        [
          'Dictionary',
          ['KeyValuePair', 'typeParams', { str: 'T' }],
          ['KeyValuePair', 'alias', 'True'],
        ],
      ])
    ).toBe('type alias Pair<T> = tuple<T, T>');
  });

  test('…and in the `{dict: …}` shorthand encoding', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        { dict: { alias: 'True', typeParams: { str: 'T' } } } as any,
      ])
    ).toBe('type alias Pair<T> = tuple<T, T>');
  });

  test('`typeParams` WITHOUT `alias` falls back to the generic form', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        ['Dictionary', ['KeyValuePair', 'typeParams', { str: 'T' }]],
      ])
    ).toContain('DeclareType');
  });

  test('an unknown extra attribute still falls back', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'typeParams', { str: 'T' }],
          ['KeyValuePair', 'holdUntil', 'True'],
        ],
      ])
    ).toContain('DeclareType');
  });

  test('round-trip: parse → serialize → parse', () => {
    const source = 'type alias Pair<T, U: number> = tuple<T, U>';
    const ast = validCortex(source);
    const serialized = serializeCortex(ast as any);
    expect(serialized).toBe(source);
    expect(validCortex(serialized)).toStrictEqual(ast);
  });
});

//
// A malformed body costs its OWN statement and nothing more. The type
// subparse only diagnoses (it leaves the cursor at the offending token); the
// statement recovers exactly ONCE, and the statement loop is told so — before
// that fix the top-level loop recovered a SECOND time, swallowing the next
// statement, and a block abandoned everything after the bad declaration.
//
describe('CORTEX TYPE STATEMENT RECOVERY', () => {
  /** The parsed program, serialized back to Cortex: which statements survived. */
  function recovered(source: string): string {
    const [expr] = parseCortex(source);
    return expr === null ? '' : serializeCortex(expr);
  }

  test('the statement after a malformed body still parses', () => {
    const source = 'type point = )bad(\nlet a = 0\na + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });

  test('…including when the body is an unknown type name', () => {
    const source = 'type point = nosuchtype\nlet a = 0\na + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuchtype"'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });

  test('…and when the statements are `;`-separated on one line', () => {
    const source = 'type point = )bad(; let a = 0; a + 1';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    expect(recovered(source)).toBe('let a = 0\na + 1');
  });

  test('inside a block, the rest of the block still parses', () => {
    const source =
      'do {\n  type inner = )bad(\n  let b = 1\n  b + 1\n}\nlet c = 2';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    // Both the block's remaining statements and the statement AFTER the block.
    expect(recovered(source)).toBe('do {let b = 1; b + 1}\nlet c = 2');
  });

  test('a malformed body does not eat the block’s closing brace', () => {
    // Same-line closer: the statement recovery stops at `}` rather than
    // skipping past it and unbalancing the block.
    const source = 'do { type inner = )bad( }\nlet c = 2';
    expect(diagnosticsOf(source)).toEqual([
      ['type-annotation-error', 'Expected a type'],
    ]);
    expect(recovered(source)).toBe('do {}\nlet c = 2');
  });
});

describe('CORTEX TYPE SELF-REFERENCE', () => {
  test('the `type X` forward spelling in the body', () => {
    expect(
      validCortex(
        'type tree = tuple<value: integer, left: type tree | nothing, right: type tree | nothing>'
      )
    ).toStrictEqual([
      'DeclareType',
      'tree',
      {
        str: 'tuple<value: integer, left: type tree | nothing, right: type tree | nothing>',
      },
    ]);
  });

  test('a bare self-reference (the name is seeded before the body parses)', () => {
    expect(validCortex('type json = list<json> | integer')).toStrictEqual([
      'DeclareType',
      'json',
      { str: 'list<json> | integer' },
    ]);
  });

  test('the `alias` form seeds its name too', () => {
    expect(validCortex('type alias json = list<json> | integer')).toStrictEqual(
      [
        'DeclareType',
        'json',
        { str: 'list<json> | integer' },
        ['Dictionary', ['KeyValuePair', 'alias', 'True']],
      ]
    );
  });
});

//
// The parse-time set of known type names is seeded by every `type` statement
// (before its body, so the body may refer to itself). Two things bound that
// seeding: a declaration that FAILS to parse un-seeds its name, and a
// declaration inside a BLOCK is un-seeded when the block ends. Without them an
// annotation parses cleanly and fails only later, engine-side, with a
// confusing `Unknown type`.
//
describe('CORTEX TYPE NAME SEEDING', () => {
  test('a malformed body un-seeds the name', () => {
    // The malformed body costs its OWN statement and nothing else: the very
    // next statement is the one that reports `point` is unknown.
    expect(diagnosticsOf('type point = )bad(\nlet p: point = 1')).toEqual([
      ['type-annotation-error', 'Expected a type'],
      ['type-annotation-error', 'Unknown type "point"'],
    ]);
  });

  test('an unknown-type body un-seeds the name', () => {
    expect(diagnosticsOf('type point = nosuchtype\nlet p: point = 1')).toEqual([
      ['type-annotation-error', 'Unknown type "nosuchtype"'],
      ['type-annotation-error', 'Unknown type "point"'],
    ]);
  });

  test('the rejected generic slot un-seeds its name too', () => {
    expect(diagnosticsOf('type gen<T> = tuple<T, T>\nlet p: gen = 1')).toEqual([
      ['type-variables-unsupported', 'gen'],
      ['type-annotation-error', 'Unknown type "gen"'],
    ]);
  });

  test('a failed declaration does not un-declare a HOST-supplied name', () => {
    expect(
      diagnosticsOf('type taken = )bad(\nlet p: taken = 1', ['taken'])
    ).toEqual([['type-annotation-error', 'Expected a type']]);
  });

  test('a type declared in a `do` block is not visible after it', () => {
    expect(
      diagnosticsOf(
        'do {\n  type inner = integer\n  let q: inner = 1\n  q\n}\nlet z: inner = 2'
      )
    ).toEqual([['type-annotation-error', 'Unknown type "inner"']]);
  });

  test('…but it IS visible inside the block', () => {
    expect(
      diagnosticsOf('do {\n  type inner = integer\n  let q: inner = 1\n  q\n}')
    ).toEqual([]);
  });

  test('a type declared in a function body does not leak', () => {
    expect(
      diagnosticsOf(
        'function f() {\n  type inner = integer\n  let q: inner = 1\n  q\n}\nlet z: inner = 2'
      )
    ).toEqual([['type-annotation-error', 'Unknown type "inner"']]);
  });

  test('a type declared in an `if` branch does not leak', () => {
    expect(
      diagnosticsOf('if true {\n  type inner = integer\n  1\n}\nlet z: inner = 2')
    ).toEqual([['type-annotation-error', 'Unknown type "inner"']]);
  });

  test('nested blocks each restore their own snapshot', () => {
    expect(
      diagnosticsOf(
        'do {\n  do {\n    type deep = integer\n    let a: deep = 1\n    a\n  }\n  let b: deep = 2\n}'
      )
    ).toEqual([['type-annotation-error', 'Unknown type "deep"']]);
  });

  test('a TOP-LEVEL declaration stays visible across a block', () => {
    expect(
      diagnosticsOf(
        'type outer = integer\ndo {\n  type inner = integer\n  let q: inner = 1\n  q\n}\nlet z: outer = 2'
      )
    ).toEqual([]);
  });
});

describe('CORTEX TYPE SHADOW WARNING', () => {
  // Nominal identity is the type NAME, so a block-local declaration shadowing
  // an existing type silently merges the two identities. The `type-shadow`
  // warning makes the accident loud (ruled 2026-08-01). Top level stays
  // silent: re-declaring at depth 0 is the legitimate statement-replace flow.
  test('a block-local type shadowing a program type warns', () => {
    const [, diagnostics] = parseCortex(
      'type point = tuple<number, number>\nlet a = 0\ndo {\n  type point = tuple<string, string>\n  1\n}'
    );
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['warning', ['type-shadow', 'point']],
    ]);
  });

  test('a block-local type shadowing a HOST type warns', () => {
    const [, diagnostics] = parseCortex(
      'let a = 0\ndo {\n  type hostpt = tuple<number, number>\n  1\n}',
      undefined,
      { typeNames: ['hostpt'] }
    );
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['warning', ['type-shadow', 'hostpt']],
    ]);
  });

  test('a top-level redeclaration does NOT warn (statement replace)', () => {
    expect(
      diagnosticsOf(
        'type point = tuple<number, number>\ntype point = tuple<number, number, number>'
      )
    ).toEqual([]);
    // …including across cells (host-supplied name, top level):
    expect(
      diagnosticsOf('type point = tuple<number, number>', ['point'])
    ).toEqual([]);
  });

  test('a fresh block-local name does not warn', () => {
    expect(
      diagnosticsOf('let a = 0\ndo {\n  type fresh = tuple<number, number>\n  1\n}')
    ).toEqual([]);
  });

  test('the shadowed program still evaluates (and the shadow takes effect)', () => {
    const ce = new ComputeEngine();
    // The inner (shadowing) `point` accepts strings — its constructor is the
    // one in scope inside the block, so the call proves the shadow is live.
    const r = executeCortex(
      ce,
      'type point = tuple<number, number>\nlet a = 0\ndo {\n  type point = tuple<string, string>\n  point("a", "b")\n}'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-shadow', 'point'],
    ]);
    expect(r.value.toString()).toBe('point("a", "b")');
  });
});

describe('CORTEX TYPE DECLARATION SERIALIZATION', () => {
  test('a structural alias serializes as a `type alias` statement', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
        ['Dictionary', ['KeyValuePair', 'alias', 'True']],
      ])
    ).toBe('type alias point = tuple<number, number>');
  });

  test('a nominal declaration (no attributes) serializes as a bare `type`', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
      ])
    ).toBe('type point = tuple<number, number>');
  });

  test('an extra attribute has no `type` spelling', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'integer' },
        [
          'Dictionary',
          ['KeyValuePair', 'alias', 'True'],
          ['KeyValuePair', 'holdUntil', 'True'],
        ],
      ])
    ).toContain('DeclareType');
  });

  test('a non-alias attribute has no `type` spelling', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'integer' },
        ['Dictionary', ['KeyValuePair', 'alias', 'False']],
      ])
    ).toContain('DeclareType');
  });

  test('round-trip: parse → serialize → parse (nominal)', () => {
    const source = 'type point = tuple<x: integer, y: integer>';
    const ast = validCortex(source);
    const serialized = serializeCortex(ast as any);
    expect(serialized).toBe(source);
    expect(validCortex(serialized)).toStrictEqual(ast);
  });

  test('round-trip: parse → serialize → parse (alias)', () => {
    const source = 'type alias pair = tuple<x: integer, y: integer>';
    const ast = validCortex(source);
    const serialized = serializeCortex(ast as any);
    expect(serialized).toBe(source);
    expect(validCortex(serialized)).toStrictEqual(ast);
  });
});

//
// End-to-end: the statement executed against a live engine (the `DeclareType`
// operator registers the type; later statements — and later cells on the same
// engine — use it in annotations).
//
describe('CORTEX TYPE DECLARATIONS (end-to-end)', () => {
  test('declare an alias then annotate', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias point = tuple<number, number>\nlet p: point = (1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('a bare `type` is NOMINAL: a structural value does not inhabit it', () => {
    // D7: until constructors land, a nominal type is declarable but
    // uninhabited — and this is the FINAL behavior, not an interim one: the
    // annotation is rejected because `(1, 2)` is a tuple, not a `point`.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<number, number>\nlet p: point = (1, 2)\np'
    );
    const messages = r.diagnostics.map((d) => d.message);
    expect(messages).toHaveLength(1);
    expect(messages[0][0]).toBe('runtime-error');
    // The declared-type rejection is an `incompatible-type` error VALUE (the
    // `Declare` operator route does not throw), so the diagnostic quotes the
    // coded error rather than an opaque host message.
    expect(String(messages[0][1])).toContain('incompatible-type');
    expect(String(messages[0][1])).toContain('point');
    // The type itself IS registered — only the annotation is refused.
    expect(ce.type('point').matches('point')).toBe(true);
    expect(ce.type('tuple<number, number>').matches('point')).toBe(false);
  });

  test('an alias type annotates a function parameter', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = tuple<number, number>\nfunction f(a: pt) { a }\nf((1, 2))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('an alias-typed operand is USABLE, not just assignable', () => {
    // The §6 LHS-unfold fix: an alias reference in operand position unfolds
    // to its definition, so structure-requiring operators accept it.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias meters = number\nfunction f(m: meters) { m + 1 }\nf(2)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
  });

  test('a host-declared type is usable from a program', () => {
    const ce = new ComputeEngine();
    ce.declareType('hostpt', 'tuple<number, number>', { alias: true });
    const r = executeCortex(ce, 'let h: hostpt = (5, 6)\nh');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(5, 6)');
  });

  test('a later cell on the same engine sees the type', () => {
    const ce = new ComputeEngine();
    expect(
      executeCortex(ce, 'type alias point = tuple<number, number>').diagnostics
    ).toEqual([]);
    const r = executeCortex(ce, 'let p: point = (1, 2)\np');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('re-running a `type` statement replaces the definition', () => {
    const ce = new ComputeEngine();
    executeCortex(ce, 'type alias point = tuple<number, number>');
    const r = executeCortex(
      ce,
      'type alias point = tuple<number, number, number>\nlet p: point = (1, 2, 3)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2, 3)');
  });

  test('a type declared in a block stays in the block', () => {
    const ce = new ComputeEngine();
    // Two top-level statements: a single `do {…}` program would be unwrapped
    // as the program wrapper and its statements would run at top level.
    const r = executeCortex(
      ce,
      'let start = 0\ndo {\n  type alias inner = tuple<number, number>\n  let q: inner = (3, 4)\n  q\n}'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(3, 4)');
    // Not visible at top level afterwards…
    expect(() => ce.type('inner')).toThrow();
    // …and a next cell's annotation errors at parse time.
    const r2 = executeCortex(ce, 'let z: inner = (3, 4)\nz');
    expect(r2.diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
  });

  test('conflicting with a host-declared type is an error value', () => {
    const ce = new ComputeEngine();
    ce.declareType('taken', 'tuple<number, number>');
    const r = executeCortex(ce, 'type taken = tuple<string, string>');
    expect(r.value.operator).toBe('Error');
    // The host definition is untouched (still nominal, same body).
    expect(
      ce.type('tuple<number, number>').matches(ce.type('taken'))
    ).toBe(false);
  });

  test('the generics rejection is a diagnostic, not a crash', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(ce, 'type gen<T> = tuple<T, T>\nlet a = 1\na');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-variables-unsupported', 'gen'],
    ]);
    expect(r.value.toString()).toBe('1');
  });
});

//
// The call-position lint: a declared TYPE name used as a function with NO
// value-level constructor behind it. The call stays an inert symbolic
// application — indistinguishable, on the page, from a working constructor
// call. The lint is keyed on "the name is a declared type AND no operator
// definition exists", so phase 1's minted constructor silences it
// automatically for every body kind that mints one (D4/D10).
//
// What is left for the lint after phase 1 is exactly the bodies that mint
// NOTHING: `record` bodies, nominal or alias (D4b — their inhabitation story
// is user-defined constructor functions, §4.5/v2).
//
describe('CORTEX TYPE NAME IN CALL POSITION', () => {
  test('calling a RECORD-bodied nominal type warns `type-not-callable`', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type rec = record<x: number, y: number>\nconst p = rec(1, 2)\np'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-not-callable', 'rec'],
    ]);
    expect(r.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  test('a record-bodied ALIAS warns too (D4b covers both kinds)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias reca = record<x: number, y: number>\nreca(1, 2)'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-not-callable', 'reca'],
    ]);
  });

  test('a host-declared record type name warns as well', () => {
    const ce = new ComputeEngine();
    ce.declareType('hostrec', 'record<x: number, y: number>', { alias: true });
    const r = executeCortex(ce, 'hostrec(1, 2)');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-not-callable', 'hostrec'],
    ]);
  });

  test('a MINTED constructor silences the lint (both kinds)', () => {
    // The phase-1 pin: the lint keys on "no operator definition", so minting
    // retires it with no name table to maintain.
    expect(
      executeCortex(
        new ComputeEngine(),
        'type alias pt = tuple<number, number>\nconst p = pt(1, 2)\np'
      ).diagnostics
    ).toEqual([]);
    expect(
      executeCortex(
        new ComputeEngine(),
        'type point = tuple<number, number>\npoint(1, 2)'
      ).diagnostics
    ).toEqual([]);
    const ce = new ComputeEngine();
    ce.declareType('hostpt', 'tuple<number, number>', { alias: true });
    expect(executeCortex(ce, 'hostpt(1, 2)').diagnostics).toEqual([]);
  });

  test('an ordinary unknown function is unchanged', () => {
    const ce = new ComputeEngine();
    // No close known operator, so no diagnostic at all — an intentionally
    // symbolic `f(x)` is never nagged.
    expect(executeCortex(ce, 'f(1, 2)').diagnostics).toEqual([]);
    // …and a near-miss still gets the did-you-mean path.
    const r = executeCortex(new ComputeEngine(), 'Sqr(4)');
    expect(r.diagnostics.map((d) => d.message[0])).toEqual(['unknown-function']);
  });

  test('one diagnostic per name per program run', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type rp = record<x: number>\nlet a = rp(1)\nlet b = rp(3)\nb'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-not-callable', 'rp'],
    ]);
  });
});

//
// Phase 1 — value constructors minted by a type declaration
// (`docs/plans/2026-08-01-nominal-types-design.md` §4.1/§4.1b/§4.1c, D4/D4b/
// D5/D10). Engine-level coverage lives in
// `test/compute-engine/type-constructors.test.ts`; these are the Cortex
// end-to-end shapes.
//
describe('CORTEX TYPE CONSTRUCTORS', () => {
  test('the §2 program: declare, construct, read back', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('point(1, 2)');
    expect(r.value.type.toString()).toBe('point');
  });

  test('nominal and alias side by side', () => {
    // `pair` accepts `(1, 2)` structurally; `point` requires the constructor.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type alias pair = tuple<number, number>',
        'type point = tuple<x: number, y: number>',
        'let a: pair = (1, 2)',
        'let p = point(3, 4)',
        '(a, p)',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('((1, 2), point(3, 4))');
  });

  test('a nominal annotation still rejects a structural value (D3)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<x: number, y: number>\nlet q: point = (1, 2)\nq'
    );
    expect(r.diagnostics.length).toBeGreaterThan(0);
    // The rejection travels as an `incompatible-type` error VALUE, not a
    // host throw, so the diagnostic carries the code (see the channel note in
    // `test/compute-engine/nominal-assign.test.ts`).
    expect(JSON.stringify(r.diagnostics)).toContain('incompatible-type');
    expect(JSON.stringify(r.diagnostics)).toContain('point');
  });

  test('opacity: `First` and destructuring do not pierce (D3)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nFirst(p)'
    );
    expect(r.value.operator).toBe('Error');

    const r2 = executeCortex(
      new ComputeEngine(),
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nlet (a, b) = p\na'
    );
    expect(JSON.stringify(r2.diagnostics)).toContain('incompatible-type');
  });

  test('`match` destructures a tagged value (free, §2)', () => {
    // NOTE: the Cortex `match` grammar has no `case` keyword — the spec's
    // `case point(x, y) => …` spelling is prose; the real surface is a bare
    // operator pattern.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nmatch p {\n  point(x, y) => x + y\n}'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
  });

  test('an alias constructor is a checked cast (D10)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = tuple<number, number>\nlet p = pt(1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
    expect(r.value.type.toString()).toBe('tuple<finite_integer, finite_integer>');
  });

  test('a scalar newtype tags, a scalar alias does not', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type meters = number\ntype alias secs = number\n(meters(5), secs(5))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(meters(5), 5)');
  });

  test('D5: a same-scope function named after the type is a collision', () => {
    const ce = new ComputeEngine();
    expect(executeCortex(ce, 'function pf(x) { x + 1 }').diagnostics).toEqual(
      []
    );
    const r = executeCortex(ce, 'type pf = tuple<number, number>');
    expect(r.value.operator).toBe('Error');
    // NOTHING was registered: the type name is still unknown…
    expect(() => ce.type('pf')).toThrow();
    // …and the user's function is untouched.
    expect(executeCortex(ce, 'pf(2)').value.toString()).toBe('3');
  });

  test('D5: the same collision for an ALIAS declaration', () => {
    const ce = new ComputeEngine();
    executeCortex(ce, 'function g(x) { x }');
    const r = executeCortex(ce, 'type alias g = tuple<number, number>');
    expect(r.value.operator).toBe('Error');
    expect(() => ce.type('g')).toThrow();
  });

  test('D5: a statement re-run replaces BOTH halves', () => {
    const ce = new ComputeEngine();
    executeCortex(ce, 'type po = tuple<number, number>');
    const r = executeCortex(
      ce,
      'type po = tuple<number, number, number>\npo(1, 2, 3)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('po(1, 2, 3)');
    expect(r.value.type.toString()).toBe('po');
    // The old arity no longer validates.
    expect(executeCortex(ce, 'po(1, 2)').value.toString()).toContain('Error');
  });

  test('a type declared in a block keeps its constructor in the block', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'let start = 0\ndo {\n  type inner = tuple<number, number>\n  inner(3, 4)\n}'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('inner(3, 4)');
    // Not visible at top level afterwards.
    expect(ce.operatorInfo('inner')).toBeUndefined();
  });

  test('a type declared in a function body may ESCAPE as the inferred result type', () => {
    // The inferred signature used to be assembled as a STRING and re-parsed at
    // the declaration site, where `inner` is out of scope:
    // `Failed to parse type "(unknown) -> inner"`. The signature is now built
    // as a Type object, so the `TypeReference` (carrying its own definition)
    // survives the escape.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'function f(a) {\n  type inner = tuple<number, number>\n  inner(a, a)\n}\nf(2)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('inner(2, 2)');
    expect(r.value.type.toString()).toBe('inner');
    // The type name itself still does not leak out of the function body.
    expect(() => ce.type('inner')).toThrow();
  });

  test('a scalar-result body using a locally declared type still works', () => {
    // The type name never enters the signature here — the historical
    // working case, pinned alongside the escaping one.
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'function g(a) {\n  type inner = tuple<number, number>\n  match inner(a, a) { inner(u, v) => u + v }\n}\ng(2)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('4');
  });

  test('notebook re-run: a second cell sees the constructor', () => {
    const ce = new ComputeEngine();
    expect(
      executeCortex(ce, 'type point = tuple<x: number, y: number>').diagnostics
    ).toEqual([]);
    const r = executeCortex(ce, 'point(7, 8)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.type.toString()).toBe('point');
  });

  // A dictionary literal synthesizes `record<x: …, y: …>` (its keys are
  // statically known), so a `record`-bodied ALIAS is inhabitable from a
  // literal. Before record-aware synthesis the literal typed as
  // `dictionary<finite_integer>` and this annotation failed `incompatible-type`
  // even though the shape matched exactly.
  test('a record-bodied alias is inhabited by a dictionary literal', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = record<x: number, y: number>\nconst p: pt = {x -> 1, y -> 2}\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.type.toString()).toBe(
      'record<x: finite_integer, y: finite_integer>'
    );
  });

  test('a record-bodied alias still rejects a mismatched literal', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type alias pt = record<x: number, y: number>\nconst p: pt = {x -> 1, z -> 2}\np'
    );
    const messages = r.diagnostics.map((d) => d.message);
    expect(messages).toHaveLength(1);
    expect(String(messages[0][1])).toContain('incompatible-type');
  });

  test('equality is structural over the tag (D9)', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type point = tuple<x: number, y: number>',
        'type polar = tuple<r: number, t: number>',
        '(point(1, 2) == point(1, 2), point(1, 2) == (1, 2), polar(1, 2) == point(1, 2))',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('("True", "False", "False")');
  });
});

//
// RECURSIVE TYPES
//
// A JSON value is the canonical recursive type: it refers to itself through
// its own array and object arms. Two spellings must work — one self-recursive
// alias, and a mutually recursive set closed by `type`-prefixed forward
// references (the spelling `doc/08-guide-types.md` documents for the host API).
//
// Each of these pinned a distinct defect:
//  - `hasValueComponent` unfolded a structural alias with no cycle guard, so
//    every REJECTED value blew the stack instead of erroring `incompatible-type`.
//  - A forward reference installed a type record that the fulfilling
//    declaration then read as a redeclaration conflict, so a mutually
//    recursive set could not be written at all.
//  - `isScalarType` did not unfold alias references, so a parameter typed by
//    an alias of a collection BROADCAST over its argument instead of binding
//    it whole.
//
describe('CORTEX RECURSIVE TYPES', () => {
  const SELF =
    'type alias json = missing | boolean | finite_real | string | list<json> | dictionary<json>\n';

  const MUTUAL = [
    'type alias json = missing | boolean | finite_real | string | type jsonArray | type jsonObject',
    'type alias jsonArray = list<json>',
    'type alias jsonObject = dictionary<json>',
    '',
  ].join('\n');

  for (const [shape, def] of [
    ['self-recursive', SELF],
    ['mutually recursive', MUTUAL],
  ] as const) {
    describe(`a ${shape} JSON alias`, () => {
      test('accepts a nested value', () => {
        const ce = new ComputeEngine();
        const r = executeCortex(
          ce,
          def + 'let a: json = {items -> [1, {k -> "v"}], ok -> True}\na'
        );
        expect(r.diagnostics).toEqual([]);
      });

      test('accepts `Missing` as a position-preserving null', () => {
        const ce = new ComputeEngine();
        const r = executeCortex(ce, def + 'let a: json = [1, Missing, 3]\nLength(a)');
        expect(r.diagnostics).toEqual([]);
        expect(r.value.toString()).toBe('3');
      });

      // Every arm of the rejection path used to overflow the stack: the type
      // is only consulted recursively when NO arm matches.
      for (const [label, value] of [
        ['a function', '(x) |-> x + 1'],
        ['a complex number', '2 + 3i'],
        ['NaN', 'NaN'],
      ] as const) {
        test(`rejects ${label} with a type error, not a stack overflow`, () => {
          const ce = new ComputeEngine();
          const r = executeCortex(ce, def + `let a: json = ${value}\na`);
          const messages = r.diagnostics.map((d) => String(d.message[1]));
          expect(messages).toHaveLength(1);
          expect(messages[0]).toContain('incompatible-type');
          expect(messages[0]).not.toContain('call stack');
        });
      }

      // The parameter type admits a list, so the list is ONE argument.
      test('binds a list argument whole instead of broadcasting', () => {
        const ce = new ComputeEngine();
        const r = executeCortex(
          ce,
          def + 'function f(v: json) -> string { "ok" }\nf([1, 2, 3])'
        );
        expect(r.diagnostics).toEqual([]);
        expect(r.value.toString()).toBe('"ok"');
      });
    });
  }

  test('an alias of a collection binds whole, like the inline spelling', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type alias u = list<number>',
        'function f(v: u) -> string { "ok" }',
        'f([1, 2])',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('"ok"');
  });

  // The dual of the rule above: a NOMINAL type stays opaque, and opaque means
  // scalar — its values are tagged applications, never collections, so a list
  // of them is a genuine broadcast.
  test('a nominal-typed parameter still broadcasts over a list', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type point = tuple<x: number, y: number>',
        'function n(p: point) -> number { 1 }',
        'n([point(1, 2), point(3, 4)])',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('[1,1]');
  });

  test('a forward reference is fulfilled in place, not conflicted', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type alias tree = number | type branch',
        'type alias branch = list<tree>',
        'let t: tree = [1, [2, [3]]]',
        't',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
  });

  // Only the EMPTY promise is fulfillable; a completed declaration still
  // conflicts, so the forward-reference path cannot be used to redeclare.
  test('a fulfilled forward reference cannot be declared twice', () => {
    const ce = new ComputeEngine();
    ce.declareType('branch', 'list<number>');
    const r = executeCortex(ce, 'type alias branch = list<string>\n1');
    const messages = r.diagnostics.map((d) => String(d.message[1]));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('already defined');
  });
});

//
// Field access reaching THROUGH a recursive type's own recursive field.
// `unionTypes` keyed its de-dup set on `JSON.stringify(type)`, and a recursive
// reference reaches itself through `def` — so joining two element types of a
// `list<tree>` threw "Converting circular structure to JSON".
//
describe('CORTEX RECURSIVE TYPE FIELD ACCESS', () => {
  const TREE =
    'type tree = tuple<value: any, children: list<tree>>\n' +
    'let t = tree(1, [tree(2, []), tree(3, [])])\n';

  test('a field read through the recursive field resolves', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(ce, TREE + 't.children[1].value');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('2');
  });

  test('the same read via `First`', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(ce, TREE + 'First(t.children).value');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('2');
  });

  test('a deep chain resolves', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type tree = tuple<value: any, children: list<tree>>\n' +
        'let t = tree(1, [tree(2, [tree(4, [])])])\n' +
        't.children[1].children[1].value'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('4');
  });

  test('a recursive `map` over the tree', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      [
        'type tree = tuple<value: any, children: list<tree>>',
        'function map(f, t) { tree(f(t.value), map(f, t.children)) }',
        'let t = tree(1, [tree(2, [tree(4, [])]), tree(3, [])])',
        'map((x) |-> x * 10, t)',
      ].join('\n')
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('tree(10, [tree(20, [tree(40, [])]),tree(30, [])])');
  });
});
