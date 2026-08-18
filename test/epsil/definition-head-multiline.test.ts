import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { validEpsil } from '../utils';

//
// A math-style function definition (`f(x) -> Type = body`) whose RETURN TYPE
// or PARAMETER LIST spans several lines.
//
// The parser decides whether the statement at the cursor is such a definition
// with a token pre-scan (`Parser.isMathFunctionDef`): past the `->` it looks
// for the `=` that closes the head. That scan stops at a statement boundary,
// and a line break is a statement boundary only at bracket depth 0: inside
// `record{ … }`, `object{ … }`, `tuple< … >`, a parenthesized group or a
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
// A line break at depth 0 still ends the scan, so a head that is already
// complete on its line does not reach across the break to claim what follows
// (pinned below).
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

describe('EPSIL MULTI-LINE DEFINITION HEAD', () => {
  test('a multi-line `record{…}` return type, math form', () => {
    expect(
      run(
        `f(x: integer) -> record{
  a: integer,
  b: integer
} = {a -> x, b -> x}
f(3)`
      )
    ).toEqual({ value: '{"a" -> 3, "b" -> 3}', diagnostics: [] });
  });

  test('the one-line spelling of the same definition agrees', () => {
    expect(
      run(
        `f(x: integer) -> record{a: integer, b: integer} = {a -> x, b -> x}
f(3)`
      )
    ).toEqual({ value: '{"a" -> 3, "b" -> 3}', diagnostics: [] });
  });

  test('a multi-line `record{…}` return type, `function` form', () => {
    expect(
      run(
        `function f(x: integer) -> record{
  a: integer,
  b: integer
} { {a -> x, b -> x} }
f(3)`
      )
    ).toEqual({ value: '{"a" -> 3, "b" -> 3}', diagnostics: [] });
  });

  test('a multi-line `tuple<…>` return type', () => {
    expect(
      run(
        `f(x: integer) -> tuple<
  integer,
  integer
> = (x, x)
f(3)`
      )
    ).toEqual({ value: '(3, 3)', diagnostics: [] });
  });

  test('nested angles fused into one closing token (`>>`)', () => {
    expect(
      run(
        `f(x: integer) -> list<list<
  integer
>> = [[x]]
f(3)`
      )
    ).toEqual({ value: '[[3]]', diagnostics: [] });
  });

  test('a function type inside the multi-line return type', () => {
    // The `->` of `(integer) -> integer` must not close the `tuple<` angle
    // group: if it did, the line break before the final `>` would fall at
    // depth 0 and end the scan.
    expect(
      run(
        `g(y: integer) -> integer = y + 1
f(x: integer) -> tuple<
  (integer) -> integer,
  integer
> = (g, x)
f(4)[1](10)`
      )
    ).toEqual({ value: '11', diagnostics: [] });
  });

  test('a multi-line return type followed by a `where` clause', () => {
    expect(
      run(
        `f(x: T) -> list<
  T
> where T: number = [x, x]
f(3)`
      )
    ).toEqual({ value: '[3,3]', diagnostics: [] });
  });

  test('a parameter list across lines', () => {
    expect(
      run(
        `f(
  a: integer,
  b: integer
) -> integer = a + b
f(3, 4)`
      )
    ).toEqual({ value: '7', diagnostics: [] });
  });

  test('a parameter list AND a return type across lines', () => {
    expect(
      run(
        `f(
  a: integer
) -> tuple<
  integer,
  integer
> = (a, a)
f(5)`
      )
    ).toEqual({ value: '(5, 5)', diagnostics: [] });
  });

  test('an `=` on the next line does NOT close the head', () => {
    // A line break at depth 0 is a statement boundary, so `f(x: integer) ->
    // integer` is an expression (a key/value pair with a type test), not a
    // definition — the `=` below it is a comparison, and calling `f` by name
    // has no declaration to match. Unchanged by the depth-aware rule.
    expect(
      run(
        `f(x: integer) -> integer
= x + 1`
      ).diagnostics
    ).toEqual([
      'static-type-error,argument names unavailable: x, the callee has no declaration with parameter names to match; call it with positional arguments,f(x: integer),argument-names-unavailable',
    ]);
  });

  test('a spaced `<` is a comparison, not the start of a generic', () => {
    // `n < 3` must NOT open an angle group. If it did, the group would never
    // close — nothing force-closes an angle depth — so the depth-0 line-break
    // test would be disabled for the rest of the file and the scan would keep
    // looking for its `=` on later lines. Here a later line balances the `<`
    // with a `>` and then carries an `=`, which is exactly the shape that
    // would make this lookahead answer `true` and mis-lower the first
    // statement as a definition of `p`.
    //
    // What it actually is: a key/value pair whose value is a comparison,
    // followed by an unrelated equation.
    expect(
      validEpsil(
        `p(n) -> n < 3
q > 1 = 2`
      )
    ).toStrictEqual([
      'Block',
      ['KeyValuePair', ['p', 'n'], ['Less', 'n', 3]],
      ['Equal', ['Greater', 'q', 1], 2],
    ]);
  });

  test('`>=` cannot close a group, so an unspaced `<` still bounds nothing', () => {
    // `n<3` has no space, so the attachment test cannot tell it from a generic
    // application and it does open an angle group — the residual case the
    // spacing heuristic does not cover. What keeps the statement safe is the
    // other half of the rule: `>=` is one fused OPERATOR token, not a run of
    // angle characters, so it cannot close that group, the scan never gets
    // back to depth 0, and the `=` on the second line is never read as the one
    // that closes `p`'s head. Both statements stay as written.
    expect(
      validEpsil(
        `p(n) -> n<3
q >= 1 = 2`
      )
    ).toStrictEqual([
      'Block',
      ['KeyValuePair', ['p', 'n'], ['Less', 'n', 3]],
      ['Equal', ['GreaterEqual', 'q', 1], 2],
    ]);
  });

  test('a comparison on an earlier line does not disturb a later definition', () => {
    expect(
      run(
        `let aa = 5 < 3
ff(nn: integer) -> integer = nn + 1
ff(2)`
      )
    ).toEqual({ value: '3', diagnostics: [] });
  });

  test('`<=` and `>=` are not angle brackets', () => {
    // The lexer maximal-munches `+-*/^=<>!&|~:?%.` into one OPERATOR token, so
    // `<=` and `>=` arrive with an angle character fused to an `=`. Only a
    // token that is nothing but angle characters counts as a bracket run, so
    // neither of these opens or closes a group.
    expect(run(`let aa = 3 <= 5\naa`)).toEqual({
      value: '"True"',
      diagnostics: [],
    });
    expect(
      run(
        `let bb = 5 >= 3
gg(nn: integer) -> boolean = nn <= 3
gg(2)`
      )
    ).toEqual({ value: '"True"', diagnostics: [] });
  });

  test('a `{` on the next line after a complete head is its own statement', () => {
    // The head is finished on its line, so the braced group below it is an
    // ordinary set literal, not a body block.
    expect(
      run(
        `f(x: integer) -> integer = x + 1
{ 1 + 1 }`
      )
    ).toEqual({ value: 'Set(2)', diagnostics: [] });
  });
});
