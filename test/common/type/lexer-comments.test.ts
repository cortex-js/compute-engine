import { ComputeEngine } from '../../../src/compute-engine';
import { executeEpsil } from '../../../src/epsil/execute-epsil';
import { parseType, parseTypePrefix } from '../../../src/common/type/parse';
import { typeToString } from '../../../src/common/type/serialize';

//
// Comments are trivia for the type grammar.
//
// The type lexer (`src/common/type/lexer.ts`) is not fed hand-written type
// strings only: the Epsil parser hands it a slice of program source for a
// `type Name = <body>` declaration and for every annotation, so a comment
// written inside a multi-line `object{…}` / `record{…}` / `tuple<…>` body
// reaches the type grammar verbatim. Before the lexer skipped comments, the
// `/` was an unexpected character, which cut the field list short and left its
// braces over as `unexpected-symbol` diagnostics in Epsil.
//
// Skipping them in the LEXER (rather than stripping them in the Epsil parser)
// also makes the type-string API — `ce.type()`, `parseType()` — tolerant of a
// commented type, which is what a host embedding a multi-line type string
// wants.
//
// Test names avoid single-letter bindings: `let i` folds to the imaginary unit.
//

/** The stringified value and the diagnostic messages (code + arguments joined
 * by a comma) of an Epsil batch, each run on a fresh engine. */
function run(source: string): { value: string; diagnostics: string[] } {
  const result = executeEpsil(new ComputeEngine(), source);
  return {
    value: String(result.value),
    diagnostics: result.diagnostics.map((d) =>
      Array.isArray(d.message)
        ? d.message.map(String).join(',')
        : String(d.message)
    ),
  };
}

describe('COMMENTS IN A TYPE BODY (Epsil)', () => {
  test('a line comment inside a multi-line `object{…}` body', () => {
    expect(
      run(
        `type Obj = object{
  // the name
  nn: string
}
Obj(nn: "xx").nn`
      )
    ).toEqual({ value: '"xx"', diagnostics: [] });
  });

  test('a block comment in a one-line `object{…}` body', () => {
    expect(
      run(
        `type Obj = object{ /* the name */ nn: string }
Obj(nn: "yy").nn`
      )
    ).toEqual({ value: '"yy"', diagnostics: [] });
  });

  test('a comment is the LAST thing before the closing brace', () => {
    expect(
      run(
        `type Obj = object{
  nn: string
  // and that is all
}
Obj(nn: "zz").nn`
      )
    ).toEqual({ value: '"zz"', diagnostics: [] });
  });

  test('comments in a `record{…}` body', () => {
    expect(
      run(
        `type alias rec = record{
  // the abscissa
  xx: number,
  yy: number /* the ordinate */
}
let pp: rec = {xx -> 1, yy -> 2}
pp.yy`
      )
    ).toEqual({ value: '2', diagnostics: [] });
  });

  test('comments in a `tuple<…>` body', () => {
    expect(
      run(
        `type alias pair = tuple<
  // the first
  integer,
  integer /* the second */
>
let pp: pair = (3, 4)
pp`
      )
    ).toEqual({ value: '(3, 4)', diagnostics: [] });
  });

  test('a comment in an annotation and in a return type', () => {
    expect(
      run(
        `function ff(nn: /* count */ integer) -> // doubled
  integer { nn * 2 }
ff(21)`
      )
    ).toEqual({ value: '42', diagnostics: [] });
  });

  test('an unterminated block comment in a type body reports, and terminates', () => {
    // The type parse ends at the comment (it consumes to end of input); the
    // unterminated comment itself is reported by Epsil's own lexer. What
    // matters here is that this returns at all rather than looping.
    const result = run(
      `type Obj = object{
  /* never closed
  nn: string
}
1`
    );
    expect(result.diagnostics).toContain('end-of-comment-expected');
  });
});

describe('COMMENTS IN A TYPE STRING (`parseType` / `ce.type`)', () => {
  test('a block comment between fields', () => {
    expect(typeToString(parseType('record{ /* c */ nn: string }'))).toBe(
      'record{nn: string}'
    );
  });

  test('a line comment in a multi-line type string', () => {
    expect(
      typeToString(
        parseType(`record{
  // the name
  nn: string
}`)
      )
    ).toBe('record{nn: string}');
  });

  test('a comment in a function signature', () => {
    expect(
      typeToString(
        parseType('(integer /* the count */) -> // the result\nnumber')
      )
    ).toBe('(integer) -> number');
  });

  test('block comments NEST, as they do in the Epsil lexer', () => {
    expect(
      typeToString(
        parseType('record{ nn: /* outer /* inner */ still */ string }')
      )
    ).toBe('record{nn: string}');
  });

  test('the engine-level type API accepts a comment', () => {
    expect(
      String(new ComputeEngine().type('record{ /* c */ nn: string }'))
    ).toBe('record{nn: string}');
  });
});

describe('WHAT IS *NOT* A COMMENT', () => {
  test('`//` inside a string-literal type is part of the string', () => {
    expect(typeToString(parseType('"a//b"'))).toBe('"a//b"');
    expect(typeToString(parseType(`record{ kk: "a//b" }`))).toBe(
      'record{kk: "a//b"}'
    );
  });

  test('a slash-star inside a string-literal type is part of the string', () => {
    expect(typeToString(parseType('"a/*b*/c"'))).toBe('"a/*b*/c"');
  });

  test('a lone `/` is still an unexpected character', () => {
    // No rule of the type grammar consumes a `/`, so one that begins neither
    // comment form must keep failing exactly as before.
    expect(() => parseType('integer / 2')).toThrow(/Unexpected character: \//);
  });
});

describe('UNTERMINATED BLOCK COMMENT', () => {
  test('a whole-string parse reports it rather than hanging', () => {
    expect(() => parseType('record{ nn: string /* unterminated')).toThrow(
      /Unterminated comment/
    );
  });

  test('a prefix parse ends the type at the comment', () => {
    // In tolerant (prefix) mode the lexer never throws: the caller is parsing
    // a type from the START of a longer source that it diagnoses itself, so
    // the unterminated comment simply ends the type.
    const { type, end } = parseTypePrefix('integer /* unterminated');
    expect(typeToString(type)).toBe('integer');
    expect(end).toBe('integer'.length);
  });

  test('a comment closed by the very last characters of the input', () => {
    expect(typeToString(parseType('record{ nn: string /* done */}'))).toBe(
      'record{nn: string}'
    );
  });
});
