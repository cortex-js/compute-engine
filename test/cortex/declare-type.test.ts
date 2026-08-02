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

  test('the generic-alias slot is reserved in the `alias` form too', () => {
    expect(diagnosticsOf('type alias pair<T> = tuple<T, T>')).toEqual([
      ['type-variables-unsupported', 'pair'],
    ]);
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
    // (The filler statement is where the type-body recovery stops.)
    expect(
      diagnosticsOf('type point = )bad(\nlet a = 0\nlet p: point = 1')
    ).toEqual([
      ['type-annotation-error', 'Expected a type'],
      ['type-annotation-error', 'Unknown type "point"'],
    ]);
  });

  test('an unknown-type body un-seeds the name', () => {
    expect(
      diagnosticsOf('type point = nosuchtype\nlet a = 0\nlet p: point = 1')
    ).toEqual([
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
      diagnosticsOf('type taken = )bad(\nlet a = 0\nlet p: taken = 1', [
        'taken',
      ])
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
    expect(String(messages[0][1])).toContain('is not compatible with the type');
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
    expect(JSON.stringify(r.diagnostics)).toContain('not compatible');
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
