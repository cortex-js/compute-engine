import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A list with a failed cell is a collection that can be iterated
// (`docs/ERROR-MODEL.md` §3). A `for` loop, a `map` and a comprehension read
// every cell, and give the failed cell to the body as the value of the
// element. What the body computes with it follows the ordinary error rules,
// and a nested statement that discards a value holding the error is
// reported (`nested-statement-diagnostics.test.ts`).
//
// Before, `isCollection` was `false` for the list: the loop ran no turn, a
// `map` returned the list unchanged, and a comprehension stayed unevaluated.
//

const G = 'function g(x) { 1/x }\nlet xs = [1, g("a"), 3]\n';

const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

function run(body: string): {
  value: string;
  at: string[];
  codes: string[];
} {
  const source = G + body;
  const result = executeEpsil(new ComputeEngine(), source);
  return {
    value: result.value.toString(),
    // The source text under each diagnostic, and where it starts.
    at: result.diagnostics.map(
      (d) => `${d.range[0]}:${source.slice(d.range[0], d.range[1])}`
    ),
    codes: result.diagnostics.map((d) => String(d.message[0])),
  };
}

/** The diagnostic of the `let xs` statement, which holds the failed cell. */
const LET_XS = `${'function g(x) { 1/x }\n'.length}:let xs = [1, g("a"), 3]`;

describe('EPSIL ITERATION OVER A LIST WITH A FAILED CELL', () => {
  test('a loop over the variable runs one turn for each cell', () => {
    const r = run('let n = 0\nfor x in xs { n = n + 1 }\nn');
    expect(r.value).toBe('3');
    expect(r.at).toEqual([LET_XS]);
  });

  test('a loop over a literal in the header runs one turn for each cell', () => {
    const r = run('let n = 0\nfor x in [1, g("a"), 3] { n = n + 1 }\nn');
    expect(r.value).toBe('3');
  });

  test('the body receives the failed cell as the value', () => {
    const r = run('let n = 0\nfor x in xs { if isError(x) { n = n + 1 } }\nn');
    expect(r.value).toBe('1');
    expect(r.at).toEqual([LET_XS]);
  });

  test('a list built in the loop keeps the failed cell, and the statement is reported', () => {
    const body = 'let ys = []\nfor x in xs { ys = [...ys, x + 1] }\nys';
    const r = run(body);
    expect(r.value).toBe(`[2,${ERR},4]`);
    expect(r.codes).toEqual(['runtime-error', 'runtime-error']);
    // The second report is in the loop body: the operand `x` of `x + 1`,
    // which holds the failed cell.
    const xInBody = (G + body).indexOf('x + 1');
    expect(r.at).toEqual([LET_XS, `${xInBody}:x`]);
  });

  test('an operation on the failed cell gives the error', () => {
    const r = run('let t = 0\nfor x in xs { t = t + x }\nt');
    expect(r.value).toBe(ERR);
  });

  test('map applies the function to each cell', () => {
    expect(run('map((u) => u + 1, xs)').value).toBe(`[2,${ERR},4]`);
  });

  test('a comprehension reads each cell', () => {
    expect(run('[x + 1 for x in xs]').value).toBe(`[2,${ERR},4]`);
    expect(run('[x for x in [1, g("a"), 3]]').value).toBe(`[1,${ERR},3]`);
    expect(run('[isError(x) for x in xs]').value).toBe(
      '["False","True","False"]'
    );
  });

  test('a guard that fails on the cell keeps the error in place', () => {
    // As `filter` keeps the error of its predicate.
    expect(run('[x * 2 for x in xs if x > 1]').value).toBe(`[${ERR},6]`);
    expect(run('filter(xs, (u) => u > 1)').value).toBe(`[${ERR},3]`);
  });

  test('length counts the cell; an aggregate answers the error', () => {
    expect(run('length(xs)').value).toBe('3');
    expect(run('sum(xs)').value).toBe(ERR);
    expect(run('max(xs)').value).toBe(ERR);
    expect(run('sort(xs)').value).toBe(ERR);
    expect(run('first(xs)').value).toBe('1');
    expect(run('xs[2]').value).toBe(ERR);
    expect(run('xs + 1').value).toBe(`[2,${ERR},4]`);
  });
});

describe('EPSIL OPERATORS OVER A NESTED FAILED CELL', () => {
  // `ys` holds a cell that is itself a list with an error.
  const NESTED = 'let ys = [[1, g("a")], [3]]\n';

  test('a callback receives the inner list as a value', () => {
    // Before: `[NaN, 1]` (a wrong value with no error).
    expect(run(NESTED + 'map((u) => 1, ys)').value).toBe('[1,1]');
    // Before: the filter stayed unevaluated.
    expect(run(NESTED + 'filter(ys, (u) => true)').value).toBe(
      `[[1,${ERR}],[3]]`
    );
    // Before: `Error("Invalid filter predicate. ")`.
    expect(run(NESTED + 'count(ys, (u) => true)').value).toBe('2');
  });

  test('a function applied to a bare failed cell is the error', () => {
    expect(run('map((u) => 1, [1, g("a"), 3])').value).toBe(`[1,${ERR},1]`);
  });

  test('an aggregate answers the error inside the cell', () => {
    // Before: the inner list `[1, Error(…)]`.
    expect(run('mean([[1, g("a")], 3])').value).toBe(ERR);
    expect(run(NESTED + 'sort(ys)').value).toBe(ERR);
    expect(run(NESTED + 'max(ys)').value).toBe(ERR);
  });

  test('a broadcast keeps the error in the inner list', () => {
    expect(run('[[1, g("a")], 3] + 1').value).toBe(`[[2,${ERR}],4]`);
  });
});

describe('EPSIL MEMBERSHIP AND EQUALITY OVER A FAILED CELL', () => {
  test('a match among the valid cells decides membership', () => {
    expect(run('1 in xs').value).toBe('"True"');
    // Before: `False`, although the failed cell could be `2`.
    expect(run('2 in xs').value).toBe(ERR);
  });

  test('equality that depends on the failed cell is the error', () => {
    // Before: `True`.
    expect(run('xs == xs').value).toBe(ERR);
    // A valid cell that differs decides.
    expect(run('xs == [2, 2, 3]').value).toBe('"False"');
  });

  test('a user predicate applied to a bare failed cell is the error', () => {
    expect(run('count(xs, (u) => true)').value).toBe(ERR);
  });
});

describe('EPSIL DEDUP AND A MAPPED SOURCE WITH A FAILED ELEMENT', () => {
  test('dedup needs the value of the failed cell', () => {
    // Before: `[1, Error(…), 1]`.
    expect(run('dedup([1, g("a"), 1])').value).toBe(ERR);
    // One element: no comparison.
    expect(run('dedup([g("a")])').value).toBe(`[${ERR}]`);
  });

  test('membership in a mapped list reads the failed element', () => {
    expect(run('1 in map((u) => 1/u, [1, "a"])').value).toBe('"True"');
    expect(run('5 in map((u) => 1/u, [1, "a"])').value).toBe(ERR);
  });
});
