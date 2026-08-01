import { ComputeEngine } from '../../src/compute-engine';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { validCortex } from '../utils';

//
// Cortex user-defined types: the `type name = <type>` statement.
//
// `type` is a CONTEXTUAL keyword — it stays a legal identifier everywhere
// (`type = 5`, `type: integer = 4`, `let type = 5`, a bare `type`). Only the
// unambiguous shapes `type Name =` / `type Name<` claim it as a statement head.
//
// The lowering (fixed contract, mirrored by the engine's `DeclareType`):
//
//   type point = tuple<x: integer, y: integer>
//     → ["DeclareType", "point", {str: "tuple<x: integer, y: integer>"},
//          ["Dictionary", ["KeyValuePair", "alias", "True"]]]
//
// The body is the TRIMMED SOURCE TEXT of the type (the parsed `Type` is
// discarded — parse-time typing is only a syntax check), and the attributes bag
// always carries `alias -> True`: a Cortex `type` declares a STRUCTURAL alias.
// Nominal types are reachable only through raw MathJSON.
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
  test('type alias lowers to DeclareType', () => {
    expect(
      validCortex('type point = tuple<x: integer, y: integer>')
    ).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<x: integer, y: integer>' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });

  test('a simple alias body', () => {
    expect(validCortex('type point = tuple<number, number>')).toStrictEqual([
      'DeclareType',
      'point',
      { str: 'tuple<number, number>' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });

  test('the declared name is visible to a later annotation', () => {
    // The `type` statement seeds the name BEFORE the rest of the program is
    // parsed, so `p: point` resolves rather than erroring `Unknown type`.
    expect(
      diagnosticsOf('type point = tuple<number, number>\nlet p: point = (1, 2)')
    ).toEqual([]);
    expect(
      validCortex('type point = tuple<number, number>\nlet p: point = (1, 2)')
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

  test('a reserved word cannot name a type', () => {
    expect(diagnosticsOf('type if = integer')).toEqual([
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
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });

  test('a bare self-reference (the name is seeded before the body parses)', () => {
    expect(validCortex('type json = list<json> | integer')).toStrictEqual([
      'DeclareType',
      'json',
      { str: 'list<json> | integer' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });
});

describe('CORTEX TYPE DECLARATION SERIALIZATION', () => {
  test('a structural alias serializes as a `type` statement', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
        ['Dictionary', ['KeyValuePair', 'alias', 'True']],
      ])
    ).toBe('type point = tuple<number, number>');
  });

  test('a nominal declaration (no attributes) has no `type` spelling', () => {
    expect(
      serializeCortex([
        'DeclareType',
        'point',
        { str: 'tuple<number, number>' },
      ])
    ).toBe('DeclareType(point, "tuple<number, number>")');
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

  test('round-trip: parse → serialize → parse', () => {
    const source = 'type point = tuple<x: integer, y: integer>';
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
  test('declare then annotate', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type point = tuple<number, number>\nlet p: point = (1, 2)\np'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('the type annotates a function parameter', () => {
    const ce = new ComputeEngine();
    const r = executeCortex(
      ce,
      'type pt = tuple<number, number>\nfunction f(a: pt) { a }\nf((1, 2))'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
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
      executeCortex(ce, 'type point = tuple<number, number>').diagnostics
    ).toEqual([]);
    const r = executeCortex(ce, 'let p: point = (1, 2)\np');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('(1, 2)');
  });

  test('re-running a `type` statement replaces the definition', () => {
    const ce = new ComputeEngine();
    executeCortex(ce, 'type point = tuple<number, number>');
    const r = executeCortex(
      ce,
      'type point = tuple<number, number, number>\nlet p: point = (1, 2, 3)\np'
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
      'let start = 0\ndo {\n  type inner = tuple<number, number>\n  let q: inner = (3, 4)\n  q\n}'
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
