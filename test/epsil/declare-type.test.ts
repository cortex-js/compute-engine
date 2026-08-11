import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

//
// Epsil user-defined types: the `type name = <type>` and
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
// These are PARSE-level tests: they assert on the MathJSON from `parseEpsil`,
// never on evaluation, so they do not depend on the engine-side `DeclareType`
// operator.
//

/** The diagnostic messages (code + arguments) of a parse, in order. */
function diagnosticsOf(source: string, typeNames?: readonly string[]) {
  const [, diagnostics] = parseEpsil(source, undefined, { typeNames });
  return diagnostics.map((d) => d.message);
}

describe('EPSIL TYPE DECLARATIONS', () => {
  test('a bare `type` lowers to a NOMINAL DeclareType (no attributes)', () => {
    expect(
      validEpsil('type point = tuple<x: integer, y: integer>')
    ).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<x: integer, y: integer>' },
    ]);
  });

  test('a simple nominal body', () => {
    expect(validEpsil('type point = tuple<number, number>')).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<number, number>' },
    ]);
  });

  test('`type alias` lowers to a STRUCTURAL DeclareType', () => {
    expect(
      validEpsil('type alias pair = tuple<number, number>')
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
    expect(validEpsil('type alias = tuple<number, number>')).toStrictEqual([
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
      validEpsil(
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

describe('EPSIL TYPE NAMES (host-supplied)', () => {
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

describe('EPSIL `type` IS A CONTEXTUAL KEYWORD', () => {
  // Each of these must parse exactly as it did before the `type` statement
  // existed: `type` remains an ordinary identifier.
  test('assignment to a variable named `type`', () => {
    expect(validEpsil('type = 5')).toStrictEqual(['Assign', 'type', 5]);
  });

  test('`let type = 5`', () => {
    expect(validEpsil('let type = 5')).toStrictEqual([
      'Declare',
      'type',
      ['Dictionary', ['KeyValuePair', 'value', 5]],
    ]);
  });

  test('an annotation on a variable named `type`', () => {
    expect(validEpsil('type: integer = 4')).toStrictEqual([
      'Declare',
      'type',
      { str: 'integer' },
      ['Dictionary', ['KeyValuePair', 'value', 4]],
    ]);
  });

  test('a bare `type` expression', () => {
    expect(validEpsil('type')).toStrictEqual('type');
  });

  test('`type` used as a value in a later statement', () => {
    expect(validEpsil('let type = 5\ntype + 1')).toStrictEqual([
      'Block',
      ['Declare', 'type', ['Dictionary', ['KeyValuePair', 'value', 5]]],
      ['Add', 'type', 1],
    ]);
  });
});

describe('EPSIL TYPE DECLARATION DIAGNOSTICS', () => {
  test('the bare form ACCEPTS a clause (parameterized nominal types)', () => {
    expect(diagnosticsOf('type point<T> = tuple<T, T>')).toEqual([]);
    expect(diagnosticsOf('type point<out T> = tuple<T, T>')).toEqual([]);
  });

  test('…and so does the `alias` form (generic aliases)', () => {
    expect(diagnosticsOf('type alias pair<T> = tuple<T, T>')).toEqual([]);
  });

  // Variance is a NOMINAL declaration's contract between two applications; a
  // transparent alias expands instead, so a marker there is meaningless.
  test('a variance marker on an alias clause is rejected', () => {
    const diagnostics = diagnosticsOf('type alias pair<out T> = tuple<T, T>');
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0][0]).toBe('type-annotation-error');
    expect(String(diagnostics[0][1])).toContain('cannot declare a variance');
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
describe('EPSIL GENERIC TYPE ALIASES (lowering)', () => {
  test('a clause lowers to a `typeParams` attrs entry', () => {
    expect(validEpsil('type alias Pair<T> = tuple<T, T>')).toStrictEqual([
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
      validEpsil('type alias Two<T, U: list<integer>> = tuple<T, U>')
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
    const [, diagnostics] = parseEpsil(source);
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
    const [value, diagnostics] = parseEpsil(source);
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
describe('EPSIL MALFORMED APPLIED ALIAS RECOVERY', () => {
  function recovered(source: string): string {
    const [expr] = parseEpsil(source);
    return expr === null ? '' : serializeEpsil(expr);
  }

  test('in a `type` statement, the next statement survives', () => {
    const source =
      'type alias Pair<T> = tuple<T, T>\ntype alias Bad = Pair<integer\nlet a = 0\na + 1';
    const [, diagnostics] = parseEpsil(source);
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
    const [value, diagnostics] = parseEpsil(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
    ]);
    expect(JSON.stringify(value)).toContain('DefineFunction');
    expect(serializeEpsil(value!)).toContain('function f(a) {b}');
  });

  test('…and a CLOSED `<…>` still resyncs at the next element', () => {
    // The nesting counter only changes the unclosed case: a balanced argument
    // list returns the scan to depth 0 before the comma, so the following
    // parameter parses exactly as it always did.
    const source = 'function f(x: nosuch<integer>, y: integer) { y }';
    const [value, diagnostics] = parseEpsil(source);
    expect(diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "nosuch"'],
    ]);
    expect(serializeEpsil(value!)).toBe('function f(x, y: integer) {y}');
  });

  test('in a `match` pattern, the remainder of the arm parses', () => {
    // Same trade as the parameter list: the unclosed `<` swallows `m`, so the
    // arm's pattern recovers as the single binding `n`. The follow-on
    // `match-irrefutable-case` is an honest report about the RECOVERED shape
    // (a bare binding matches everything, so `_` is unreachable), not a second
    // complaint about the type.
    const source =
      'type alias Pair<T> = tuple<T, T>\nmatch x {\n  (n: Pair<integer, m) => 1\n  _ => 2\n}';
    const [value, diagnostics] = parseEpsil(source);
    expect(diagnostics.map((d) => d.message[0])).toEqual([
      'type-annotation-error',
      'match-irrefutable-case',
    ]);
    expect(JSON.stringify(value)).toContain('Match');
  });
});

describe('EPSIL GENERIC TYPE ALIASES (serialization)', () => {
  test('a generic alias serializes as `type alias Pair<T> = …`', () => {
    expect(
      serializeEpsil([
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
      serializeEpsil([
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
      serializeEpsil([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        { dict: { alias: 'True', typeParams: { str: 'T' } } } as any,
      ])
    ).toBe('type alias Pair<T> = tuple<T, T>');
  });

  // `typeParams` WITHOUT `alias` is a parameterized NOMINAL type — the
  // statement form, not a fallback (adversarial-review finding 7).
  test('`typeParams` WITHOUT `alias` is the parameterized nominal form', () => {
    expect(
      serializeEpsil([
        'DeclareType',
        'Pair',
        { str: 'tuple<T, T>' },
        ['Dictionary', ['KeyValuePair', 'typeParams', { str: 'T' }]],
      ])
    ).toBe('type Pair<T> = tuple<T, T>');
  });

  test('an unknown extra attribute still falls back', () => {
    expect(
      serializeEpsil([
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
    const ast = validEpsil(source);
    const serialized = serializeEpsil(ast as any);
    expect(serialized).toBe(source);
    expect(validEpsil(serialized)).toStrictEqual(ast);
  });
});

//
// A malformed body costs its OWN statement and nothing more. The type
// subparse only diagnoses (it leaves the cursor at the offending token); the
// statement recovers exactly ONCE, and the statement loop is told so — before
// that fix the top-level loop recovered a SECOND time, swallowing the next
// statement, and a block abandoned everything after the bad declaration.
//
describe('EPSIL TYPE STATEMENT RECOVERY', () => {
  /** The parsed program, serialized back to Epsil: which statements survived. */
  function recovered(source: string): string {
    const [expr] = parseEpsil(source);
    return expr === null ? '' : serializeEpsil(expr);
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
    // A block-local `type` statement is a hard error (types are global; ruled
    // 2026-08-10) — reported BEFORE the body parses, so the malformed body is
    // never reached. Recovery skips just the statement.
    const source =
      'do {\n  type inner = )bad(\n  let b = 1\n  b + 1\n}\nlet c = 2';
    expect(diagnosticsOf(source)).toEqual([
      ['type-declaration-not-top-level', 'inner'],
    ]);
    // Both the block's remaining statements and the statement AFTER the block.
    expect(recovered(source)).toBe('do {let b = 1; b + 1}\nlet c = 2');
  });

  test('a misplaced declaration does not eat the block’s closing brace', () => {
    // Same-line closer: the statement recovery stops at `}` rather than
    // skipping past it and unbalancing the block.
    const source = 'do { type inner = )bad( }\nlet c = 2';
    expect(diagnosticsOf(source)).toEqual([
      ['type-declaration-not-top-level', 'inner'],
    ]);
    expect(recovered(source)).toBe('do {}\nlet c = 2');
  });
});

describe('EPSIL TYPE SELF-REFERENCE', () => {
  test('the `type X` forward spelling in the body', () => {
    expect(
      validEpsil(
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
    expect(validEpsil('type json = list<json> | integer')).toStrictEqual([
      'DeclareType',
      'json',
      { str: 'list<json> | integer' },
    ]);
  });

  test('the `alias` form seeds its name too', () => {
    expect(validEpsil('type alias json = list<json> | integer')).toStrictEqual(
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
describe('EPSIL TYPE NAME SEEDING', () => {
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

  test('a MALFORMED generic clause un-seeds its name too', () => {
    expect(diagnosticsOf('type gen<> = tuple<T, T>\nlet p: gen = 1')).toEqual([
      ['empty-type-parameter-clause', 'gen'],
      ['type-annotation-error', 'Unknown type "gen"'],
    ]);
  });

  test('a failed declaration does not un-declare a HOST-supplied name', () => {
    expect(
      diagnosticsOf('type taken = )bad(\nlet p: taken = 1', ['taken'])
    ).toEqual([['type-annotation-error', 'Expected a type']]);
  });

  // Types are ENGINE-GLOBAL (ruled 2026-08-10, global-type-registry plan): a
  // `type` statement inside any block or function body is a hard error — no
  // hoisting. The name is not seeded (the declaration declares nothing), so a
  // later annotation naming it gets an accurate `Unknown type`.
  test('a `type` statement in a `do` block is a hard error', () => {
    expect(
      diagnosticsOf(
        'do {\n  type inner = integer\n  let q: inner = 1\n  q\n}\nlet z: inner = 2'
      )
    ).toEqual([
      ['type-declaration-not-top-level', 'inner'],
      ['type-annotation-error', 'Unknown type "inner"'],
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
  });

  test('a `type` statement in a function body is a hard error', () => {
    expect(
      diagnosticsOf(
        'function f() {\n  type inner = integer\n  let q: inner = 1\n  q\n}\nlet z: inner = 2'
      )
    ).toEqual([
      ['type-declaration-not-top-level', 'inner'],
      ['type-annotation-error', 'Unknown type "inner"'],
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
  });

  test('a `type` statement in an `if` branch is a hard error', () => {
    expect(
      diagnosticsOf('if true {\n  type inner = integer\n  1\n}\nlet z: inner = 2')
    ).toEqual([
      ['type-declaration-not-top-level', 'inner'],
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
  });

  test('a nested block errors too, and the name never lands', () => {
    expect(
      diagnosticsOf(
        'do {\n  do {\n    type deep = integer\n    let a: deep = 1\n    a\n  }\n  let b: deep = 2\n}'
      )
    ).toEqual([
      ['type-declaration-not-top-level', 'deep'],
      ['type-annotation-error', 'Unknown type "deep"'],
      ['type-annotation-error', 'Unknown type "deep"'],
    ]);
  });

  test('a TOP-LEVEL declaration stays visible across a block', () => {
    expect(
      diagnosticsOf(
        'type outer = integer\ndo {\n  let q: outer = 1\n  q\n}\nlet z: outer = 2'
      )
    ).toEqual([]);
  });
});

describe('EPSIL TYPE DECLARATIONS ARE TOP-LEVEL ONLY', () => {
  // Types are ENGINE-GLOBAL (ruled 2026-08-10): shadowing is impossible — a
  // block-local declaration of ANY name (fresh or existing) is the
  // `type-declaration-not-top-level` hard error. Top level stays permissive:
  // re-declaring at depth 0 is the legitimate statement-replace flow.
  test('a block-local declaration reusing a program type name errors', () => {
    const [, diagnostics] = parseEpsil(
      'type point = tuple<number, number>\nlet a = 0\ndo {\n  type point = tuple<string, string>\n  1\n}'
    );
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['error', ['type-declaration-not-top-level', 'point']],
    ]);
  });

  test('a block-local declaration reusing a HOST type name errors', () => {
    const [, diagnostics] = parseEpsil(
      'let a = 0\ndo {\n  type hostpt = tuple<number, number>\n  1\n}',
      undefined,
      { typeNames: ['hostpt'] }
    );
    expect(diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['error', ['type-declaration-not-top-level', 'hostpt']],
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

  test('a fresh block-local name errors too', () => {
    expect(
      diagnosticsOf('let a = 0\ndo {\n  type fresh = tuple<number, number>\n  1\n}')
    ).toEqual([['type-declaration-not-top-level', 'fresh']]);
  });

  test('the outer type is untouched by a rejected block-local declaration', () => {
    const ce = new ComputeEngine();
    // The block-local `type point` errors; the top-level `point` (numbers)
    // stays the one and only `point`, so its constructor still validates.
    const r = executeEpsil(
      ce,
      'type point = tuple<number, number>\nlet a = 0\ndo {\n  type point = tuple<string, string>\n  point(1, 2)\n}'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-declaration-not-top-level', 'point'],
    ]);
    expect(r.value.toString()).toBe('point(1, 2)');
  });
});

describe('EPSIL TYPE DECLARATION SERIALIZATION', () => {
  test('a structural alias serializes as a `type alias` statement', () => {
    expect(
      serializeEpsil([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
        ['Dictionary', ['KeyValuePair', 'alias', 'True']],
      ])
    ).toBe('type alias point = tuple<number, number>');
  });

  test('a nominal declaration (no attributes) serializes as a bare `type`', () => {
    expect(
      serializeEpsil([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
      ])
    ).toBe('type point = tuple<number, number>');
  });

  test('an extra attribute has no `type` spelling', () => {
    expect(
      serializeEpsil([
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
      serializeEpsil([
        'DeclareType',
        'point',
        { str: 'integer' },
        ['Dictionary', ['KeyValuePair', 'alias', 'False']],
      ])
    ).toContain('DeclareType');
  });

  test('round-trip: parse → serialize → parse (nominal)', () => {
    const source = 'type point = tuple<x: integer, y: integer>';
    const ast = validEpsil(source);
    const serialized = serializeEpsil(ast as any);
    expect(serialized).toBe(source);
    expect(validEpsil(serialized)).toStrictEqual(ast);
  });

  test('round-trip: parse → serialize → parse (alias)', () => {
    const source = 'type alias pair = tuple<x: integer, y: integer>';
    const ast = validEpsil(source);
    const serialized = serializeEpsil(ast as any);
    expect(serialized).toBe(source);
    expect(validEpsil(serialized)).toStrictEqual(ast);
  });
});

//
// End-to-end: the statement executed against a live engine (the `DeclareType`
// operator registers the type; later statements — and later cells on the same
// engine — use it in annotations).
//
describe('EPSIL TYPE DECLARATIONS (end-to-end)', () => {
  test('declare an alias then annotate', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
      ce,
      'type alias meters = number\nfunction f(m: meters) { m + 1 }\nf(2)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
  });

  test('a host-declared type is usable from a program', () => {
    const ce = new ComputeEngine();
    ce.declareType('hostpt', 'tuple<number, number>', { alias: true });
    const r = executeEpsil(ce, 'let h: hostpt = (5, 6)\nh');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(5, 6)');
  });

  test('a later cell on the same engine sees the type', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'type alias point = tuple<number, number>').diagnostics
    ).toEqual([]);
    const r = executeEpsil(ce, 'let p: point = (1, 2)\np');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('re-running a `type` statement replaces the definition', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type alias point = tuple<number, number>');
    const r = executeEpsil(
      ce,
      'type alias point = tuple<number, number, number>\nlet p: point = (1, 2, 3)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2, 3)');
  });

  test('a type declared in a block is a hard error and declares nothing', () => {
    const ce = new ComputeEngine();
    // Two top-level statements: a single `do {…}` program would be unwrapped
    // as the program wrapper and its statements would run at top level.
    const r = executeEpsil(
      ce,
      'let start = 0\ndo {\n  type alias inner = tuple<number, number>\n  let q: inner = (3, 4)\n  q\n}'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-declaration-not-top-level', 'inner'],
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
    // Nothing landed in the engine registry…
    expect(() => ce.type('inner')).toThrow();
    // …and a next cell's annotation errors at parse time.
    const r2 = executeEpsil(ce, 'let z: inner = (3, 4)\nz');
    expect(r2.diagnostics.map((d) => d.message)).toEqual([
      ['type-annotation-error', 'Unknown type "inner"'],
    ]);
  });

  test('conflicting with a host-declared type is an error value', () => {
    const ce = new ComputeEngine();
    ce.declareType('taken', 'tuple<number, number>');
    const r = executeEpsil(ce, 'type taken = tuple<string, string>');
    expect(r.value.operator).toBe('Error');
    // The host definition is untouched (still nominal, same body).
    expect(
      ce.type('tuple<number, number>').matches(ce.type('taken'))
    ).toBe(false);
  });

  test('a parameterized nominal type declares end-to-end', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'type gen<T> = tuple<T, T>\nlet a = 1\na');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(r.value.toString()).toBe('1');
    expect(ce.type('gen<integer>').toString()).toBe('gen<integer>');
  });

  // Variance (parameterized-nominal design §4) on the statement route: the
  // marker rides the clause TEXT, and the engine verifies it against the body
  // exactly as it does for a host `ce.declareType`.
  test('a variance marker relates two applications', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type tree<out T> = tuple<value: T, children: list<tree<T>>>\nlet a = 1\na'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
    expect(ce.type('tree<number>').matches('tree<integer>')).toBe(false);
  });

  test('an unannotated clause means `out`, and is verified as such', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'type box<T> = tuple<v: T>\nlet a = 1\na');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('box<integer>').matches('box<number>')).toBe(true);
  });

  test('an `in` marker reverses the relation', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type sink<in T> = tuple<run: (T) -> nothing>\nlet a = 1\na'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('sink<number>').matches('sink<integer>')).toBe(true);
    expect(ce.type('sink<integer>').matches('sink<number>')).toBe(false);
  });

  // A body that contradicts the declared (or defaulted) variance is a
  // `variance-violation`. The statement route surfaces the engine's message
  // verbatim inside `invalid-type-declaration`.
  test('a body contradicting the marker is an error value', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'type h<out T> = tuple<run: (T) -> nothing>');
    expect(r.value.operator).toBe('Error');
    expect(r.value.toString()).toContain('variance-violation');
    expect(() => ce.type('h<integer>')).toThrow();
  });

  test('…and so does the unannotated form, prescriptively', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type events<T> = tuple<log: list<T>, notify: (T) -> nothing>'
    );
    expect(r.value.operator).toBe('Error');
    const s = r.value.toString();
    expect(s).toContain('variance-violation');
    expect(s).toContain('notify');
    expect(s).toContain('`out` is the default when no marker is written');
    expect(s).toContain('declare it `inout`');
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
describe('EPSIL TYPE NAME IN CALL POSITION', () => {
  test('calling a RECORD-bodied nominal type warns `type-not-callable`', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(ce, 'hostrec(1, 2)');
    expect(r.diagnostics.map((d) => d.message)).toEqual([
      ['type-not-callable', 'hostrec'],
    ]);
  });

  test('a MINTED constructor silences the lint (both kinds)', () => {
    // The phase-1 pin: the lint keys on "no operator definition", so minting
    // retires it with no name table to maintain.
    expect(
      executeEpsil(
        new ComputeEngine(),
        'type alias pt = tuple<number, number>\nconst p = pt(1, 2)\np'
      ).diagnostics
    ).toEqual([]);
    expect(
      executeEpsil(
        new ComputeEngine(),
        'type point = tuple<number, number>\npoint(1, 2)'
      ).diagnostics
    ).toEqual([]);
    const ce = new ComputeEngine();
    ce.declareType('hostpt', 'tuple<number, number>', { alias: true });
    expect(executeEpsil(ce, 'hostpt(1, 2)').diagnostics).toEqual([]);
  });

  test('an ordinary unknown function is unchanged', () => {
    const ce = new ComputeEngine();
    // No close known operator, so no diagnostic at all — an intentionally
    // symbolic `f(x)` is never nagged.
    expect(executeEpsil(ce, 'f(1, 2)').diagnostics).toEqual([]);
    // …and a near-miss still gets the did-you-mean path.
    const r = executeEpsil(new ComputeEngine(), 'Sqr(4)');
    expect(r.diagnostics.map((d) => d.message[0])).toEqual(['unknown-function']);
  });

  test('one diagnostic per name per program run', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
// `test/compute-engine/type-constructors.test.ts`; these are the Epsil
// end-to-end shapes.
//
describe('EPSIL TYPE CONSTRUCTORS', () => {
  test('the §2 program: declare, construct, read back', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
      ce,
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nFirst(p)'
    );
    expect(r.value.operator).toBe('Error');

    const r2 = executeEpsil(
      new ComputeEngine(),
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nlet (a, b) = p\na'
    );
    expect(JSON.stringify(r2.diagnostics)).toContain('incompatible-type');
  });

  test('`match` destructures a tagged value (free, §2)', () => {
    // NOTE: the Epsil `match` grammar has no `case` keyword — the spec's
    // `case point(x, y) => …` spelling is prose; the real surface is a bare
    // operator pattern.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type point = tuple<x: number, y: number>\nlet p = point(1, 2)\nmatch p {\n  point(x, y) => x + y\n}'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
  });

  test('an alias constructor is a checked cast (D10)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type alias pt = tuple<number, number>\nlet p = pt(1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
    expect(r.value.type.toString()).toBe('tuple<finite_integer, finite_integer>');
  });

  test('a scalar newtype tags, a scalar alias does not', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type meters = number\ntype alias secs = number\n(meters(5), secs(5))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(meters(5), 5)');
  });

  test('D5: a same-scope function named after the type is a collision', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'function pf(x) { x + 1 }').diagnostics).toEqual(
      []
    );
    const r = executeEpsil(ce, 'type pf = tuple<number, number>');
    expect(r.value.operator).toBe('Error');
    // NOTHING was registered: the type name is still unknown…
    expect(() => ce.type('pf')).toThrow();
    // …and the user's function is untouched.
    expect(executeEpsil(ce, 'pf(2)').value.toString()).toBe('3');
  });

  test('D5: the same collision for an ALIAS declaration', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function g(x) { x }');
    const r = executeEpsil(ce, 'type alias g = tuple<number, number>');
    expect(r.value.operator).toBe('Error');
    expect(() => ce.type('g')).toThrow();
  });

  test('D5: a statement re-run replaces BOTH halves', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type po = tuple<number, number>');
    const r = executeEpsil(
      ce,
      'type po = tuple<number, number, number>\npo(1, 2, 3)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('po(1, 2, 3)');
    expect(r.value.type.toString()).toBe('po');
    // The old arity no longer validates.
    expect(executeEpsil(ce, 'po(1, 2)').value.toString()).toContain('Error');
  });

  test('a block-local declaration mints NO constructor', () => {
    // The `type` statement errors (top-level only, ruled 2026-08-10), so
    // neither namespace is claimed: no type record, no constructor.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'let start = 0\ndo {\n  type inner = tuple<number, number>\n  inner(3, 4)\n}'
    );
    expect(r.diagnostics.map((d) => d.message[0])).toEqual([
      'type-declaration-not-top-level',
    ]);
    expect(ce.operatorInfo('inner')).toBeUndefined();
    expect(() => ce.type('inner')).toThrow();
  });

  test('a function-body declaration is rejected (no escaping result type)', () => {
    // Historically a function-local type could escape as the inferred result
    // type (and once broke signature reparsing: `Failed to parse type
    // "(unknown) -> inner"`). Under the global-type-registry ruling the
    // declaration itself is the error, closing that class by construction:
    // declare the type at top level instead.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function f(a) {\n  type inner = tuple<number, number>\n  inner(a, a)\n}\nf(2)'
    );
    expect(r.diagnostics.map((d) => d.message[0])).toEqual([
      'type-declaration-not-top-level',
    ]);
    expect(() => ce.type('inner')).toThrow();
  });

  test('a top-level type is usable inside a function body', () => {
    // The supported spelling of the two rejected shapes above.
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'type inner = tuple<number, number>\nfunction f(a) {\n  inner(a, a)\n}\nfunction g(a) {\n  match inner(a, a) { inner(u, v) => u + v }\n}\n(f(2), g(2))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(inner(2, 2), 4)');
    expect(r.value.ops![0].type.toString()).toBe('inner');
  });

  test('pre-pass parity: a replacement to a record body drops the OLD constructor for later statements', () => {
    // Cell 1 mints an arity-2 tuple constructor. Cell 2 replaces the type
    // with a record body (which mints NO constructor) and then calls the old
    // constructor shape. The static pre-pass replaces in a transient frame
    // while the old constructor lives in the GLOBAL scope — left visible
    // through the chain it would produce a spurious arity diagnostic
    // (`po(1, 2, 3)` validated against the removed arity-2 constructor).
    // The mint step masks the inherited constructor, so the pass sees the
    // same value namespace real evaluation will: the call is inert.
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'type po = tuple<number, number>').diagnostics
    ).toEqual([]);
    const r = executeEpsil(
      ce,
      'type po = record<x: number, y: number>\npo(1, 2, 3)'
    );
    // Identical to declaring the record type on a FRESH engine: the
    // `type-not-callable` lint (record bodies mint no constructor), not a
    // stale-arity `static-type-error`.
    expect(r.diagnostics.map((d) => [d.severity, d.message])).toEqual([
      ['warning', ['type-not-callable', 'po']],
    ]);
    // Inert application: record bodies mint no constructor.
    expect(r.value.operator).toBe('po');
  });

  test('a program with no type statements does not bump the world/semantic axes', () => {
    // The pre-pass registry rollback runs on EVERY executeEpsil call; a
    // no-op rollback (no `type` statements) must not invalidate
    // mutation-keyed caches (mirrors the conditional `_assumptionsDirty`
    // bump precedent, Tycho item 38).
    const ce = new ComputeEngine();
    executeEpsil(ce, '1 + 1'); // warm up any lazy initialization
    const world = ce._worldVersion;
    const semantic = ce._semanticVersion;
    executeEpsil(ce, '2 + 3');
    expect(ce._worldVersion).toBe(world);
    expect(ce._semanticVersion).toBe(semantic);
  });

  test('notebook re-run: a second cell sees the constructor', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'type point = tuple<x: number, y: number>').diagnostics
    ).toEqual([]);
    const r = executeEpsil(ce, 'point(7, 8)');
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
    const r = executeEpsil(
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
    const r = executeEpsil(
      ce,
      'type alias pt = record<x: number, y: number>\nconst p: pt = {x -> 1, z -> 2}\np'
    );
    const messages = r.diagnostics.map((d) => d.message);
    expect(messages).toHaveLength(1);
    expect(String(messages[0][1])).toContain('incompatible-type');
  });

  test('equality is structural over the tag (D9)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
describe('EPSIL RECURSIVE TYPES', () => {
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
        const r = executeEpsil(
          ce,
          def + 'let a: json = {items -> [1, {k -> "v"}], ok -> True}\na'
        );
        expect(r.diagnostics).toEqual([]);
      });

      test('accepts `Missing` as a position-preserving null', () => {
        const ce = new ComputeEngine();
        const r = executeEpsil(ce, def + 'let a: json = [1, Missing, 3]\nLength(a)');
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
          const r = executeEpsil(ce, def + `let a: json = ${value}\na`);
          const messages = r.diagnostics.map((d) => String(d.message[1]));
          expect(messages).toHaveLength(1);
          expect(messages[0]).toContain('incompatible-type');
          expect(messages[0]).not.toContain('call stack');
        });
      }

      // The parameter type admits a list, so the list is ONE argument.
      test('binds a list argument whole instead of broadcasting', () => {
        const ce = new ComputeEngine();
        const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(
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
    const r = executeEpsil(ce, 'type alias branch = list<string>\n1');
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
describe('EPSIL RECURSIVE TYPE FIELD ACCESS', () => {
  const TREE =
    'type tree = tuple<value: any, children: list<tree>>\n' +
    'let t = tree(1, [tree(2, []), tree(3, [])])\n';

  test('a field read through the recursive field resolves', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, TREE + 't.children[1].value');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('2');
  });

  test('the same read via `First`', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, TREE + 'First(t.children).value');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('2');
  });

  test('a deep chain resolves', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
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
    const r = executeEpsil(
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

//
// NOTEBOOK RE-RUNS — a `type` statement re-run on the same engine UPDATES the
// existing record IN PLACE rather than swapping in a fresh one.
//
// The record is what every mentioning type captured (and what an applied
// reference `box<integer>` holds through its `decl` back-pointer), so a swap
// left those captures reading the previous definition: two nodes for the same
// type disagreed depending on which run parsed them, and a mutually recursive
// pair needed a THIRD run to converge.
//
describe('EPSIL TYPE RE-DECLARATION (in place)', () => {
  const recordOf = (ce: ComputeEngine, name: string) =>
    (ce as any)._typeResolver.resolve(name);

  test('re-running a `type` statement keeps the same record object', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type box<T> = tuple<v: T>\nlet a = 1\na');
    const before = recordOf(ce, 'box');
    const r = executeEpsil(ce, 'type box<T> = tuple<v: T, w: T>\nlet a = 1\na');
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);
    expect(recordOf(ce, 'box')).toBe(before);
  });

  test('a node parsed BEFORE the re-run answers from the new definition', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type box<out T> = tuple<v: T>\nlet a = 1\na');
    const staleInt = ce.type('box<integer>');
    const staleNum = ce.type('box<number>');
    expect(staleInt.matches(staleNum)).toBe(true);

    // The edited body forces invariance, and the clause is edited to match.
    const r = executeEpsil(
      ce,
      'type box<inout T> = tuple<v: T, f: (T) -> nothing>\nlet a = 1\na'
    );
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    const freshInt = ce.type('box<integer>');
    const freshNum = ce.type('box<number>');
    // All four old/new combinations agree.
    expect(staleInt.matches(staleNum)).toBe(false);
    expect(freshInt.matches(freshNum)).toBe(false);
    expect(staleInt.matches(freshNum)).toBe(false);
    expect(freshInt.matches(staleNum)).toBe(false);
  });

  // The one-run lag: on the second run, the forward reference `type m2<T>` in
  // `m1`'s body RESOLVES (the name is declared from run 1), so `m1` captures
  // the run-1 record — which a swapping replacement then orphaned.
  test('a mutually recursive pair converges on the SECOND run', () => {
    const ce = new ComputeEngine();
    const program = (tail: string) =>
      `type m1<T> = tuple<a: T, b: list<type m2<T>>>\ntype m2<T> = tuple<c: T${tail}>\nlet a = 1\na`;

    expect(
      executeEpsil(ce, program('')).diagnostics.map((d) => d.message)
    ).toEqual([]);
    expect(
      executeEpsil(ce, program(', d: string')).diagnostics.map((d) => d.message)
    ).toEqual([]);

    const m1 = recordOf(ce, 'm1');
    const m2 = recordOf(ce, 'm2');
    // `m1`'s `b` field is `list<m2<T>>`; its element must be an application of
    // the LIVE `m2` record, not of run 1's.
    const element = (m1.def as any).elements[1].type.elements;
    expect(element.kind).toBe('reference');
    expect(element.name).toBe('m2');
    // The back-pointer itself is pinned: an `?? element` fallback here would
    // pass on a node that carries no `decl` at all, and the subtype rule now
    // relates two applications by that pointer.
    expect(element.decl).toBe(m2);
    expect(element.def).toBe(m2.def);
  });

  // A dependent's declared variance is re-verified against the new definition.
  // The redeclaration is what makes it unsound, so the REDECLARATION fails and
  // rolls back; the message is attributed to the dependent and names the
  // redeclaration as the trigger.
  test('a re-run that unsounds a dependent fails on the run that introduces it', () => {
    const ce = new ComputeEngine();
    const r1 = executeEpsil(
      ce,
      'type w2<out T> = tuple<v: T>\ntype w1<out T> = tuple<w: w2<T>>\nlet a = 1\na'
    );
    expect(r1.diagnostics.map((d) => d.message)).toEqual([]);
    expect(ce.type('w1<integer>').matches('w1<number>')).toBe(true);

    // Run 2 edits `w2` alone — sound in isolation, fatal for `w1`.
    const r2 = executeEpsil(ce, 'type w2<in T> = tuple<run: (T) -> nothing>');
    expect(r2.value.operator).toBe('Error');
    const s = r2.value.toString();
    expect(s).toContain('variance-violation');
    expect(s).toContain('parameter `T` of `w1`');
    expect(s).toContain('surfaced when `w2` was declared');

    // The engine is left in run 1's state: `w2` keeps its run-1 body, and
    // `w1` is still verified covariant. Both stay usable.
    expect(ce.type('w2<integer>').matches('w2<number>')).toBe(true);
    expect(ce.type('w1<integer>').matches('w1<number>')).toBe(true);
    expect(recordOf(ce, 'w2')._varianceState).toBe('verified');
    expect(recordOf(ce, 'w1')._varianceState).toBe('verified');
  });

  test('re-running an UNCHANGED program is clean, values included', () => {
    const ce = new ComputeEngine();
    const program =
      'type tree<out T> = tuple<value: T, children: list<tree<T>>>\ntree(1, [])';
    for (const _ of [1, 2, 3]) {
      const r = executeEpsil(ce, program);
      expect(r.diagnostics.map((d) => d.message)).toEqual([]);
      expect(r.value.type.toString()).toBe('tree<finite_integer>');
    }
    expect(ce.type('tree<integer>').matches('tree<number>')).toBe(true);
  });
});

//
// Arity coherence across notebook runs: editing a type's clause while another
// type still applies it at the old arity fails the RE-DECLARING statement and
// rolls back, exactly as an unsound variance edit does.
//
describe('EPSIL TYPE RE-DECLARATION (dependent arity)', () => {
  const recordOf = (ce: ComputeEngine, name: string) =>
    (ce as any)._typeResolver.resolve(name);

  test('editing a clause under a dependent errors on the run that does it', () => {
    const ce = new ComputeEngine();
    const r1 = executeEpsil(
      ce,
      'type a2<out T> = tuple<v: T>\ntype a1<out T> = tuple<w: a2<T>>\nlet a = 1\na'
    );
    expect(r1.diagnostics.map((d) => d.message)).toEqual([]);

    // Run 2 gives `a2` a second parameter; `a1` still writes `a2<T>`.
    const r2 = executeEpsil(ce, 'type a2<out T, out U> = tuple<v: T, u: U>');
    expect(r2.value.operator).toBe('Error');
    const s = r2.value.toString();
    expect(s).toContain('generic-alias-arity');
    expect(s).toContain('The definition of \\"a1\\" applies \\"a2\\"');
    expect(s).toContain('surfaced when `a2` was declared');

    // Left in run 1's state: both types still usable at their old clauses.
    expect(recordOf(ce, 'a2').typeParams).toHaveLength(1);
    expect(ce.type('a2<integer>').matches('a2<number>')).toBe(true);
    expect(ce.type('a1<integer>').matches('a1<number>')).toBe(true);
  });

  test('an arity-preserving edit under a dependent re-runs cleanly', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'type h2<out T> = tuple<v: T>\ntype h1<out T> = tuple<w: h2<T>>\nlet a = 1\na'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);
    expect(
      executeEpsil(
        ce,
        'type h2<out T> = tuple<v: T, extra: string>\nlet a = 1\na'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);
    expect(ce.type('h1<integer>').matches('h1<number>')).toBe(true);
    expect(ce.type('h2<integer>').matches('h2<number>')).toBe(true);
  });
});

//
// Re-declaration coherence, VALUE half. The type-level dependent pass above
// only ever scanned `scope.types`, so a declared symbol or operator signature
// mentioning the record survived an incompatible clause edit silently: `f:
// (Foo) -> integer` after `Foo` became generic held a bare application of a
// generic type, which matches nothing — `f` was uncallable with no diagnostic
// anywhere, and a stale application could leak a free type variable downstream.
// Bounds are the same story one step over: adding `T: integer` to a clause left
// every existing `box<string>` behind it.
//
describe('EPSIL TYPE RE-DECLARATION (value dependents and bounds)', () => {
  const recordOf = (ce: ComputeEngine, name: string) =>
    (ce as any)._typeResolver.resolve(name);

  test('a VALUE dependent at a stale arity fails the redeclaring run', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'type Foo = tuple<a: integer>\nlet z = 1\nz'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);
    ce.declare('f', '(Foo) -> integer');
    expect(ce.box('f').type.toString()).toBe('(Foo) -> integer');

    // `Foo` becomes generic; `f`'s declared signature still writes it bare.
    const r = executeEpsil(ce, 'type Foo<T> = tuple<a: T>');
    expect(r.value.operator).toBe('Error');
    const s = r.value.toString();
    expect(s).toContain('generic-alias-arity');
    expect(s).toContain('The signature of \\"f\\" applies \\"Foo\\"');
    expect(s).toContain('surfaced when `Foo` was declared');

    // Rolled back: `Foo` is plain again and `f` is still callable.
    expect(recordOf(ce, 'Foo').typeParams).toBeUndefined();
    expect(ce.box('f').type.toString()).toBe('(Foo) -> integer');
    expect(ce.type('Foo').matches('Foo')).toBe(true);
  });

  test('a benign redeclaration with value dependents still succeeds', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type Bar = tuple<a: integer>\nlet z = 1\nz');
    ce.declare('g', '(Bar) -> integer');
    expect(
      executeEpsil(
        ce,
        'type Bar = tuple<a: integer, b: string>\nlet z = 1\nz'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);
    expect(ce.box('g').type.toString()).toBe('(Bar) -> integer');
    expect((recordOf(ce, 'Bar').def as any).elements).toHaveLength(2);
  });

  // The dependency walk (`mentionsOf`) descends every type constructor. The
  // contextual-callback wrapper (Design D §4) is one of them: a reference
  // occurring ONLY inside `callback<S>` was invisible to the walk, so an
  // incompatible re-declaration behind one landed silently.
  test('a mention hidden inside `callback<S>` is still a dependent', () => {
    const control = (slot: string) => {
      const ce = new ComputeEngine();
      expect(
        executeEpsil(ce, 'type Wrap<T> = list<T>\nlet z = 1\nz').diagnostics
      ).toEqual([]);
      ce.declare('holder', `(${slot}) -> integer`);
      const r = executeEpsil(ce, 'type Wrap<T, U> = tuple<T, U>');
      return r.value;
    };

    for (const slot of [
      'Wrap<integer>', // the uncallback'd control
      'callback<(Wrap<integer>) -> boolean>', // the hidden mention
    ]) {
      const v = control(slot);
      expect(v.operator).toBe('Error');
      const s = v.toString();
      expect(s).toContain('generic-alias-arity');
      expect(s).toContain('The signature of \\"holder\\" applies \\"Wrap\\"');
    }
  });

  test('a TYPE dependent violating a NEW bound fails the redeclaring run', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(
        ce,
        'type bx<T> = tuple<v: T>\ntype holder = tuple<b: bx<string>>\nlet z = 1\nz'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);

    const r = executeEpsil(ce, 'type bx<T: integer> = tuple<v: T>');
    expect(r.value.operator).toBe('Error');
    const s = r.value.toString();
    expect(s).toContain('generic-alias-bound');
    expect(s).toContain('The definition of \\"holder\\" applies \\"bx\\"');
    expect(s).toContain('surfaced when `bx` was declared');

    // Rolled back: the clause is unbounded again, so `bx<string>` still builds.
    expect(recordOf(ce, 'bx').typeParams[0].bound).toBeUndefined();
    expect(ce.type('bx<string>').matches('bx<string>')).toBe(true);
  });

  test('a VALUE dependent violating a NEW bound fails the redeclaring run', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type cx<T> = tuple<v: T>\nlet z = 1\nz');
    ce.declare('h', '(cx<string>) -> integer');

    const r = executeEpsil(ce, 'type cx<T: integer> = tuple<v: T>');
    expect(r.value.operator).toBe('Error');
    const s = r.value.toString();
    expect(s).toContain('generic-alias-bound');
    expect(s).toContain('The signature of \\"h\\" applies \\"cx\\"');

    expect(recordOf(ce, 'cx').typeParams[0].bound).toBeUndefined();
    expect(ce.box('h').type.toString()).toBe('(cx<string>) -> integer');
  });

  test('a bound the dependents satisfy re-runs cleanly', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'type dx<T> = tuple<v: T>\ntype dholder = tuple<b: dx<integer>>\nlet z = 1\nz'
    );
    ce.declare('k', '(dx<integer>) -> integer');
    expect(
      executeEpsil(
        ce,
        'type dx<T: number> = tuple<v: T>\nlet z = 1\nz'
      ).diagnostics.map((d) => d.message)
    ).toEqual([]);
    expect(recordOf(ce, 'dx').typeParams[0].bound).toBe('number');
    expect(ce.box('k').type.toString()).toBe('(dx<integer>) -> integer');
  });
});
