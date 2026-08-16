import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { validEpsil } from '../utils';

//
// A `type` statement whose BODY spans several lines, followed by an
// `is Protocol` conformance clause.
//
// The parser locates the `is` of a conformance with a token pre-scan
// (`Parser.scanConformanceIs`). That scan stops at a statement boundary, and a
// line break is a statement boundary only at bracket depth 0: inside
// `object{ … }`, `record{ … }`, `tuple< … >`, a parenthesized group or a
// square-bracketed one, a newline is mere layout and the scan runs through it.
// Angle brackets have no token type of their own — the Epsil lexer
// maximal-munches a run of angle characters into one OPERATOR token — so their
// depth is counted out of the operator text (`Parser.angleDepthAfter`), under
// two rules that keep ordinary arithmetic out of it: the function-type arrow
// `->` is removed and only a token that is then NOTHING BUT angle characters
// counts as a bracket run (so `<=`, `>=`, `=>`, `<-` do not), and a `<` opens a
// group only when its token is ATTACHED to the one before it, as a generic
// application is written (`tuple<`) and a comparison is not (`n < 3`).
//
// A line break at depth 0 still ends the scan, so `is` written on the line
// AFTER a complete body is NOT part of the `type` statement (pinned below).
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

const NAMED = 'protocol Named { readonly qq: string }';

describe('EPSIL MULTI-LINE TYPE BODY + `is` CONFORMANCE', () => {
  test('a multi-line `object{…}` body keeps its conformance clause', () => {
    expect(
      run(
        `${NAMED}
type Obj = object{
  nn: string
} is Named { get qq(self: Obj) -> string { self.nn } }
Obj(nn: "xx").qq`
      )
    ).toEqual({ value: '"xx"', diagnostics: [] });
  });

  test('the one-line spelling of the same declaration agrees', () => {
    expect(
      run(
        `${NAMED}
type Obj = object{nn: string} is Named { get qq(self: Obj) -> string { self.nn } }
Obj(nn: "xx").qq`
      )
    ).toEqual({ value: '"xx"', diagnostics: [] });
  });

  test('a multi-line `tuple<…>` body keeps its conformance clause', () => {
    // The closing `>` opens its own line: the scan tests the line break BEFORE
    // applying the token's own depth contribution, so the angle group is still
    // open when the break is seen.
    expect(
      run(
        `${NAMED}
type Tup = tuple<
  nn: string
> is Named { get qq(self: Tup) -> string { self.nn } }
Tup("yy").qq`
      )
    ).toEqual({ value: '"yy"', diagnostics: [] });
  });

  test('a multi-line `record{…}` body lowers to declaration + conformance', () => {
    // A record-bodied nominal type is deliberately NOT callable (D4b: its
    // inhabitation story is user-defined constructor functions), so this one is
    // asserted at the LOWERING rather than by evaluating a constructor call.
    // The body rides as its verbatim source text, newlines included.
    expect(
      validEpsil(
        `type Rec = record{
  xx: number,
  yy: number
} is Sized`
      )
    ).toStrictEqual([
      'Block',
      [
        'DeclareType',
        'Rec',
        { str: 'record{\n  xx: number,\n  yy: number\n}' },
      ],
      ['DeclareConformance', { str: 'Rec' }, ['List', 'Sized']],
    ]);
  });

  test('nested generics spread over lines', () => {
    expect(
      run(
        `${NAMED}
type Pair = tuple<
  aa: list<integer>,
  bb: string
> is Named { get qq(self: Pair) -> string { self.bb } }
Pair([1, 2], "hi").qq`
      )
    ).toEqual({ value: '"hi"', diagnostics: [] });
  });

  test('a function-typed field: the `->` must not unbalance the angle depth', () => {
    // Were the `>` of `->` counted as an angle close, the depth would go to 0
    // (clamped) mid-body and the `}` line break would end the scan.
    expect(
      run(
        `protocol Applied { readonly qq: integer }
type Fun = object{
  ff: (integer) -> integer
} is Applied { get qq(self: Fun) -> integer { self.ff(3) } }
Fun(ff: (xx) => xx + 1).qq`
      )
    ).toEqual({ value: '4', diagnostics: [] });
  });

  test('a nested function type inside a generic, across lines', () => {
    expect(
      run(
        `protocol Applied { readonly qq: number }
type Box = tuple<
  ff: (integer) -> number,
  vv: integer
> is Applied { get qq(self: Box) -> number { self.ff(self.vv) } }
Box((xx) => xx * 2, 5).qq`
      )
    ).toEqual({ value: '10', diagnostics: [] });
  });

  test('comments around the clause and inside the implementation block', () => {
    expect(
      run(
        `${NAMED}
type Obj = object{
  nn: string
} /* the clause follows */ is Named {
  // computed on demand
  get qq(self: Obj) -> string { self.nn }
}
Obj(nn: "cc").qq`
      )
    ).toEqual({ value: '"cc"', diagnostics: [] });
  });

  test('a comment INSIDE the type body', () => {
    // The type body is handed to the shared type subparser
    // (`src/common/type/parse.ts`), so a comment written inside `object{…}`
    // reaches the type grammar verbatim. Its lexer skips `//` and `/* … */` as
    // trivia, exactly as the Epsil lexer does, so the field list parses and
    // the conformance clause after it still applies. (Until that was fixed,
    // the `/` was an unexpected character, the field list was cut short, and
    // its braces were left over as `unexpected-symbol {` / `}`.) See
    // `test/common/type/lexer-comments.test.ts` for the lexer-level coverage.
    expect(
      run(
        `${NAMED}
type Obj = object{
  // the name
  nn: string
} is Named { get qq(self: Obj) -> string { self.nn } }
Obj(nn: "xx").qq`
      )
    ).toEqual({ value: '"xx"', diagnostics: [] });
    // The same body with no `is` clause anywhere: the comment was never a
    // conformance-scan problem, so this route is clean too.
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

  test('the combined declare-and-conform form still lowers to TWO statements', () => {
    // `hasAssign` — the flag that tells `scanConformanceIs`' callers a top-level
    // `=` precedes the `is` — must still be set when the `=` and the `is` are
    // on different lines: it is what routes this to the declaration path with a
    // queued conformance, rather than to the standalone conformance statement.
    expect(
      validEpsil(
        `type Obj = object{
  nn: string
} is Named`
      )
    ).toStrictEqual([
      'Block',
      ['DeclareType', 'Obj', { str: 'object{\n  nn: string\n}' }],
      ['DeclareConformance', { str: 'Obj' }, ['List', 'Named']],
    ]);
  });

  test('a multi-line conformance to SEVERAL protocols', () => {
    expect(
      validEpsil(
        `type Obj = object{
  nn: string
} is Named & Sized`
      )
    ).toStrictEqual([
      'Block',
      ['DeclareType', 'Obj', { str: 'object{\n  nn: string\n}' }],
      ['DeclareConformance', { str: 'Obj' }, ['List', 'Named', 'Sized']],
    ]);
  });
});

describe('EPSIL FORMS THAT MUST BE UNAFFECTED', () => {
  test('the standalone `type X is Proto` form (no `=`) still works', () => {
    expect(
      run(
        `${NAMED}
type Obj = object{
  nn: string
}
type Obj is Named { get qq(self: Obj) -> string { self.nn } }
Obj(nn: "sep").qq`
      )
    ).toEqual({ value: '"sep"', diagnostics: [] });
  });

  test('the standalone form on a one-line named type', () => {
    expect(
      run(
        `protocol Sized { readonly nn: integer }
type Pt = tuple<integer, integer>
type Pt is Sized { get nn(self: Pt) -> integer { 9 } }
Pt(1, 2).nn`
      )
    ).toEqual({ value: '9', diagnostics: [] });
  });

  test('a multi-line `type alias` declares an alias, with no conformance', () => {
    expect(
      validEpsil(
        `type alias Pear = tuple<
  integer,
  integer
>`
      )
    ).toStrictEqual([
      'DeclareType',
      'Pear',
      { str: 'tuple<\n  integer,\n  integer\n>' },
      ['Dictionary', ['KeyValuePair', 'alias', 'True']],
    ]);
  });

  test('a multi-line ANONYMOUS conformance target reaches its own diagnostic', () => {
    // Previously this failed in the parser with `unexpected-symbol is`. It is
    // still rejected — an anonymous structural type cannot be conformed — but
    // now by the rule that owns the refusal, which names the fix.
    const result = run(
      `protocol Sized { readonly nn: integer }
type tuple<
  integer,
  integer
> is Sized { get nn(self: tuple<integer, integer>) -> integer { 7 } }
1`
    );
    expect(
      result.diagnostics.some((d) => d.startsWith('unexpected-symbol'))
    ).toBe(false);
    expect(
      result.diagnostics.some((d) =>
        d.includes('protocol-conformance-target-invalid')
      )
    ).toBe(true);
  });

  test('a spaced `<` on an earlier line does not drag the scan forward', () => {
    // `1 < 2` must NOT open an angle group: nothing force-closes an angle
    // depth, so an opened one would disable the depth-0 line-break test for
    // the rest of the file and let this scan pull the `is` off a later line
    // into an unrelated statement. Each statement here stays its own.
    expect(
      run(
        `${NAMED}
type Obj = object{nn: string}
let cc = 1 < 2
type Obj is Named { get qq(self: Obj) -> string { self.nn } }
Obj(nn: "ok").qq`
      )
    ).toEqual({ value: '"ok"', diagnostics: [] });
  });

  test('`<=` after a conformance header is not read as an angle bracket', () => {
    // The lexer fuses `<=` into a single OPERATOR token. Only a token that is
    // nothing but angle characters counts as a bracket run, so this neither
    // opens nor closes a group and the multi-line body above it still works.
    expect(
      run(
        `${NAMED}
type Obj = object{
  nn: string
} is Named { get qq(self: Obj) -> string { self.nn } }
let dd = 1 <= 2
Obj(nn: "ok").qq`
      )
    ).toEqual({ value: '"ok"', diagnostics: [] });
  });

  test('`is` on the line AFTER a complete body is NOT this statement (pinned)', () => {
    // A line break at depth 0 remains a statement boundary. Making the clause
    // work across one is deliberately out of scope; this pins today's
    // behavior so a future change to it is a visible decision.
    expect(
      run(
        `${NAMED}
type Obj = object{nn: string}
 is Named { get qq(self: Obj) -> string { self.nn } }
1`
      ).diagnostics
    ).toEqual(['unexpected-symbol,Named']);
  });
});

describe('EPSIL TYPE_SYSTEM_ROADMAP APPENDIX B `Person` EXAMPLE', () => {
  // `docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B ("Mutable objects"), under "A
  // conforming object type" — reproduced verbatim in its documented multi-line
  // layout, which is exactly the layout this file exists to support. The
  // declaration is followed by a use, so the test covers the whole documented
  // story end to end: field-backed satisfaction (the stored `firstName` field
  // meets the protocol's `readwrite firstName` requirement), the computed
  // `fullName` getter, and a `birthday` call that mutates `age` in place.
  //
  // `birthday` is called as a free function, `birthday(alan)`, rather than
  // `alan.birthday()`: a protocol function dispatches on its first argument
  // and is not reachable through field-access syntax.
  const PERSON = `protocol Identifiable {
  readwrite firstName: string
  readwrite lastName: string
  readonly fullName: string
  readwrite age: integer
  readwrite role: string
  function birthday(self: Self) -> Self
}
type Person = object{
  firstName: string,
  lastName: string,
  age: integer,
  role: string
} is Identifiable {
  // fullName is not a stored field: it is computed on demand.
  get fullName(self: Person) -> string {
    "\\(self.firstName) \\(self.lastName)"
  }
  function birthday(self: Person) -> Person {
    self.age = self.age + 1
    self   // the protocol promises that birthday returns Self
  }
}
let alan = Person(firstName: "Alan", lastName: "Turing", age: 42, role: "logician")
birthday(alan)
"Happy birthday, \\(alan.fullName)! You are \\(alan.age)."`;

  test('declares, conforms and runs clean', () => {
    expect(run(PERSON)).toEqual({
      value: '"Happy birthday, Alan Turing! You are 43."',
      diagnostics: [],
    });
  });
});
