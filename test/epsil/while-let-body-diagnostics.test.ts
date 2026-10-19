import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A `while let` loop is a `Loop` whose body is a `Match`
// (`Loop(Match(subject, MatchCase(pattern, guard, body), MatchCase(_, Break)))`).
// The loop discards the value of each iteration, so the last statement of a
// `while let` body is discarded, as the last statement of a `for` or `while`
// body is. When its value holds an error, it is reported.
//
// An `if let` is a `Match` that is a statement of its block: its last
// statement passes its value to the `if let`, as the branch of an `if` does.
//

const G = 'function g(x) { 1/x }\n';

function run(source: string): { at: string[]; codes: string[] } {
  const result = executeEpsil(new ComputeEngine(), source);
  return {
    at: result.diagnostics.map((d) => source.slice(d.range[0], d.range[1])),
    codes: result.diagnostics.map((d) => String(d.message[0])),
  };
}

describe('EPSIL WHILE LET BODY DIAGNOSTICS', () => {
  test('the last statement of a `while let` body is reported', () => {
    // The loop runs once: the second test of `i` fails, as `i` is a string.
    const r = run(
      G + 'let i = 0\nwhile let n: number = i { i = "s"\n [g("a")] }\n1'
    );
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.at).toEqual(['[g("a")]']);
  });

  test('a value passed up from an `if` in a `while let` body is reported where it was made', () => {
    const r = run(
      G +
        'let i = 0\nwhile let n: number = i { i = "s"; if true { [g("a")] } }\n1'
    );
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.at).toEqual(['[g("a")]']);
  });

  test('a `while` body is reported as before', () => {
    const r = run(G + 'let x = 1\nwhile x < 2 { x = x + 1\n [g("a")] }\n1');
    expect(r.at).toEqual(['[g("a")]']);
  });

  test('an `if let` in a loop body is reported at its branch statement', () => {
    const r = run(G + 'for k in [1] { if let n: number = k { [g("a")] } }\n1');
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.at).toEqual(['[g("a")]']);
  });

  test('the value of an `if let` that a function returns is not reported', () => {
    const r = run(
      G + 'function h(x) { if let n: number = x { [g("a")] } else { 2 } }\nh(1)'
    );
    expect(r.codes).toEqual([]);
  });
});
