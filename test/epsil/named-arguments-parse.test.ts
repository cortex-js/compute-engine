import type { MathJsonExpression } from '../../src/math-json/types';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

// The surface half of the named-argument feature (`docs/LANGUAGE-MODEL.md`):
// the parser carries `f(rate: 0.05)` as
// `["NamedArgument", "'rate'", 0.05]`, and canonicalization consumes the
// carrier by matching it against the callee's declared parameter names. The
// consuming half is not built yet, so every pin below is on the RAW,
// UNCANONICALIZED tree — boxing or executing these programs would only observe
// the carrier going unconsumed.

/** Every parser node carries `sourceOffsets`; drop them so a tree can be
 * compared against a plain MathJSON literal. */
function strip(expr: MathJsonExpression): any {
  return JSON.parse(
    JSON.stringify(expr, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );
}

/** The raw AST of `src`, with an assertion that it parsed cleanly. */
function ast(src: string): any {
  const [expr, diagnostics] = parseEpsil(src);
  expect(diagnostics.map((d) => d.message)).toEqual([]);
  return strip(expr);
}

/** The diagnostic codes `src` reports (`[]` when it parses cleanly). */
function codes(src: string): string[] {
  const [, diagnostics] = parseEpsil(src);
  return diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message[0] : d.message
  );
}

describe('the named-argument carrier', () => {
  test('a lone named argument', () => {
    expect(ast('f(a: 1)')).toEqual({
      fn: ['f', { fn: ['NamedArgument', { str: 'a' }, { num: '1' }] }],
    });
  });

  test('positional arguments and named arguments mix', () => {
    // The parser accepts any interleaving; rejecting a positional argument
    // AFTER a named one (`argument-order-invalid`) is canonicalization's job,
    // because only the callee's declaration says which slot each name fills.
    expect(ast('f(1, b: 2)')).toEqual({
      fn: [
        'f',
        { num: '1' },
        { fn: ['NamedArgument', { str: 'b' }, { num: '2' }] },
      ],
    });
  });

  test('a verbatim symbol names an argument', () => {
    expect(ast('f(`my name`: 1)')).toEqual({
      fn: ['f', { fn: ['NamedArgument', { str: 'my name' }, { num: '1' }] }],
    });
  });

  test('a trailing comma is still allowed', () => {
    expect(ast('f(a: 1, b: 2,)')).toEqual({
      fn: [
        'f',
        { fn: ['NamedArgument', { str: 'a' }, { num: '1' }] },
        { fn: ['NamedArgument', { str: 'b' }, { num: '2' }] },
      ],
    });
  });

  test('the value is a full expression, not just a primary', () => {
    expect(ast('f(a: 1 + 2 * 3)')).toEqual({
      fn: [
        'f',
        {
          fn: [
            'NamedArgument',
            { str: 'a' },
            {
              fn: [
                'Add',
                { num: '1' },
                { fn: ['Multiply', { num: '2' }, { num: '3' }] },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe('what the named-argument production does NOT claim', () => {
  test('`f(a := 1)` is still an assignment operand', () => {
    // The trigger is an OPERATOR token whose text STARTS with `:`, excluding
    // any token starting with `:=`, so an assignment written as an argument is
    // untouched.
    expect(ast('f(a := 1)')).toEqual({
      fn: ['f', { fn: ['Assign', { sym: 'a' }, { num: '1' }] }],
    });
  });

  test('a mapsto parameter list still reads `x: T` as an annotation', () => {
    expect(ast('(x: integer) => x')).toEqual({
      fn: [
        'Function',
        { sym: 'x' },
        { fn: ['Typed', { sym: 'x' }, { str: 'integer' }] },
      ],
    });
  });

  test('a match pattern still reads `P(a: integer)` as a type guard', () => {
    expect(ast('match v { P(a: integer) => 1\n  _ => 0 }')).toEqual({
      fn: [
        'Match',
        { sym: 'v' },
        {
          fn: [
            'MatchCase',
            { fn: ['P', { sym: '_a' }] },
            {
              fn: [
                'MatchesType',
                { sym: 'a' },
                { fn: ['TypeFrom', { str: 'integer' }] },
              ],
            },
            { num: '1' },
          ],
        },
        { fn: ['MatchCase', { sym: '_' }, { num: '0' }] },
      ],
    });
  });

  test('a list literal rejects `a: 1` as before', () => {
    expect(codes('[a: 1]')).toEqual([
      'closing-bracket-expected',
      'unexpected-symbol',
    ]);
  });

  test('a brace literal rejects `a: 1` as before', () => {
    expect(codes('{a: 1}')).toEqual([
      'closing-bracket-expected',
      'unexpected-symbol',
    ]);
  });
});

describe('the lexer munch hazard (design §1)', () => {
  // `:` is not in Epsil's operator table, so the lexer's maximal munch glues it
  // to a following operator character: the `:-` of `f(a:-1)` is one token. The
  // named-argument production accepts such a token and splits the leading `:`
  // off it, so the spaced and tight forms agree — valid syntax must not depend
  // on whitespace.
  test('`f(a: -1)` parses', () => {
    expect(ast('f(a: -1)')).toEqual({
      fn: ['f', { fn: ['NamedArgument', { str: 'a' }, { num: '-1' }] }],
    });
  });

  test('`f(a:-1)` parses the same way (the `:-` token is split)', () => {
    expect(ast('f(a:-1)')).toEqual({
      fn: ['f', { fn: ['NamedArgument', { str: 'a' }, { num: '-1' }] }],
    });
  });

  test('the split leaves a prefix operator to start the value', () => {
    // The remainder of the munched token is re-read by the ordinary expression
    // grammar, so any prefix operator works, not just a numeric sign.
    expect(ast('f(a:-x)')).toEqual({
      fn: [
        'f',
        {
          fn: ['NamedArgument', { str: 'a' }, { fn: ['Negate', { sym: 'x' }] }],
        },
      ],
    });
    expect(ast('f(a:!true)')).toEqual({
      fn: [
        'f',
        {
          fn: ['NamedArgument', { str: 'a' }, { fn: ['Not', { sym: 'True' }] }],
        },
      ],
    });
  });

  test('`f(a::b)` is a clean parse error, not a crash', () => {
    // The leading `:` opens the named argument; the remaining `:` cannot start
    // a value expression and is reported at its own offset.
    const [, diagnostics] = parseEpsil('f(a::b)');
    expect(diagnostics.map((d) => d.range)).toEqual([[4, 5]]);
    expect(codes('f(a::b)')).toEqual(['unexpected-symbol']);
  });
});

describe('serializing the raw carrier', () => {
  // Canonical trees never contain the carrier, so this row exists for the raw
  // tree: source formatting, and quoting an offending statement in a
  // diagnostic.
  test('a named argument round-trips through the serializer', () => {
    expect(serializeEpsil(ast('f(a: 1)'))).toBe('f(a: 1)');
    expect(serializeEpsil(ast('f(1, b: 2)'))).toBe('f(1, b: 2)');
  });

  test('a verbatim name keeps its backticks', () => {
    expect(serializeEpsil(ast('f(`my name`: 1)'))).toBe('f(`my name`: 1)');
  });

  test('a malformed carrier falls back to the generic call form', () => {
    expect(serializeEpsil({ fn: ['NamedArgument', { str: 'a' }] })).toBe(
      'NamedArgument("a")'
    );
  });
});
