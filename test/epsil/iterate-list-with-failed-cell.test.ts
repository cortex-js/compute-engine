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
});

describe('EPSIL A FAILED CELL IN A LOOP OR COMPREHENSION HEADER', () => {
  // No statement holds the value of a header, so a failed cell in it is
  // reported at the header, also when the body does not use the index.

  /** The diagnostics of a program, with the line of each one. */
  function report(body: string): {
    value: string;
    at: string[];
    lines: number[];
    messages: unknown[];
  } {
    const source = G + body;
    const result = executeEpsil(new ComputeEngine(), source);
    return {
      value: result.value.toString(),
      at: result.diagnostics.map(
        (d) => `${d.range[0]}:${source.slice(d.range[0], d.range[1])}`
      ),
      lines: result.diagnostics.map(
        (d) => source.slice(0, d.range[0]).split('\n').length
      ),
      messages: result.diagnostics.map((d) => d.message),
    };
  }

  /** The `at` entry of the first occurrence of `text` in `body`. */
  const atText = (body: string, text: string): string =>
    `${G.length + body.indexOf(text)}:${text}`;

  const LITERAL = '[1, g("a"), 3]';

  test('a literal header is reported as the `let` statement is', () => {
    const body = `let n = 0\nfor x in ${LITERAL} { n = n + 1 }\nn`;
    const r = report(body);
    // The loop still runs one turn for each cell.
    expect(r.value).toBe('3');
    expect(r.at).toEqual([LET_XS, atText(body, LITERAL)]);
    // Line 2 is the `let xs` statement of the prefix; line 4 is the loop.
    expect(r.lines).toEqual([2, 4]);
    // The same code and message as the statement.
    expect(r.messages[1]).toEqual(r.messages[0]);
    expect(r.messages[1]).toEqual([
      'runtime-error',
      'expected `number`, got `string` at `a`',
      '',
      'incompatible-type',
    ]);
  });

  test('a header whose failed cell ends the loop is reported once', () => {
    // The body uses the index, so the failed cell makes an `Error` that ends
    // the loop. That `Error` is the value of the top-level statement, and
    // is the same failure: it is not reported a second time.
    for (const loopBody of ['{ n = n + x }', '{ n = h(x) + 1 }']) {
      const body = `function h(y) { y * 2 }\nlet n = 0\nfor x in ${LITERAL} ${loopBody}\nn`;
      const r = report(body);
      expect(r.at).toEqual([LET_XS, atText(body, LITERAL)]);
      expect(r.messages[1]).toEqual(r.messages[0]);
    }
  });

  test('a failed call in a header is reported once', () => {
    // The parameter of `g` is typed, so the error is at the call.
    const source =
      'function g(s: number) -> number { s + 1 }\nlet s = 0\nfor x in [1, g("a"), 3] { s = s + x }\ns';
    const result = executeEpsil(new ComputeEngine(), source);
    const at = result.diagnostics.map(
      (d) => `${String(d.message[0])} ${source.slice(d.range[0], d.range[1])}`
    );
    expect(at).toEqual(['static-type-error "a"', 'runtime-error "a"']);
  });

  test('a header that is a variable is not reported a second time', () => {
    expect(report('let n = 0\nfor x in xs { n = n + 1 }\nn').at).toEqual([
      LET_XS,
    ]);
    expect(report('let n = 0\n[1 for x in xs]\nn').at).toEqual([LET_XS]);
  });

  test('the header of an inner loop is reported once', () => {
    const body = `let n = 0\nfor i in [1, 2] { for x in ${LITERAL} { n = n + 1 } }\nn`;
    const r = report(body);
    expect(r.value).toBe('6');
    expect(r.at).toEqual([LET_XS, atText(body, LITERAL)]);
  });

  test('a header in a function body is reported once for all calls', () => {
    const body = `function h() { let n = 0\nfor x in ${LITERAL} { n = n + 1 }\nn }\nh() + h()`;
    const r = report(body);
    expect(r.value).toBe('6');
    expect(r.at).toEqual([LET_XS, atText(body, LITERAL)]);
  });

  test('an inner header that reads the failed cell is reported', () => {
    // As a statement of the loop body that holds the failed cell is.
    const body = 'let n = 0\nfor x in xs { for y in [x, 2] { n = n + 1 } }\nn';
    const r = report(body);
    expect(r.value).toBe('6');
    expect(r.at).toEqual([LET_XS, atText(body, '[x, 2]')]);
  });

  test('a header that the static check reports is also reported by the run', () => {
    // As for the statement `let ys = [1, 1/"a", 3]`.
    const body = 'let n = 0\nfor x in [1, 1/"a", 3] { n = n + 1 }\nn';
    const r = report(body);
    expect(r.value).toBe('3');
    // The static check runs before the program, so its report is first.
    expect(r.messages.map((m) => (m as unknown[])[0])).toEqual([
      'static-type-error',
      'runtime-error',
      'runtime-error',
    ]);
    expect(r.at[2]).toBe(atText(body, '[1, 1/"a", 3]'));
  });

  test('a comprehension header is reported when the run reads the list', () => {
    const body = `let ys = [1 for x in ${LITERAL}]\nlet t = 0\nfor y in ys { t = t + y }\nt`;
    const r = report(body);
    expect(r.value).toBe('3');
    expect(r.at).toEqual([LET_XS, atText(body, LITERAL)]);

    const sum = `sum([1 for x in ${LITERAL}])`;
    expect(report(sum).at).toEqual([LET_XS, atText(sum, LITERAL)]);
  });

  test('a comprehension that is the value of the program is read by the host', () => {
    // A comprehension is a lazy list: the header is evaluated when the list
    // is read. The value of the last statement is read by the host, after
    // the run, so the header is not reported. The failed cell is in the
    // value when the body uses the index.
    const r = report(`[x for x in ${LITERAL}]`);
    expect(r.value).toBe(`[1,${ERR},3]`);
    expect(r.at).toEqual([LET_XS]);
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

describe('EPSIL A PIPE INTO MAP OVER A LIST WITH A FAILED CELL', () => {
  // The pipe applies its stage as a function literal (`_ => map(f, _)`).
  // The value of the call substitutes the piped list for the parameter in
  // the result. Before, an operand with a failed cell made that rebuild raw
  // (unbound), and the `Map` stayed unevaluated.

  test('the pipe form gives the value of the direct call', () => {
    const direct = run('map((u) => u, [1, g("a"), 3])').value;
    expect(direct).toBe(`[1,${ERR},3]`);
    expect(run('[1, g("a"), 3] |> map((u) => u, _)').value).toBe(direct);
    expect(run('xs |> map((u) => u, _)').value).toBe(direct);
    expect(run('[1, g("a"), 3] |> map((u) => u + 1)').value).toBe(
      `[2,${ERR},4]`
    );
    expect(run('((z) => map((u) => u, z))([1, g("a"), 3])').value).toBe(direct);
  });

  test('a loop over the pipe form runs one turn for each cell', () => {
    const r = run(
      'let ys = xs |> map((u) => u, _)\nlet n = 0\nfor y in ys { n = n + 1 }\nn'
    );
    expect(r.value).toBe('3');
  });

  test('a pipe over a valid list is unchanged', () => {
    expect(run('[1, 2, 3] |> map((u) => u, _)').value).toBe('[1,2,3]');
    expect(run('[1, 2, 3] |> map((u) => 2 * u)').value).toBe('[2,4,6]');
  });
});

describe('EPSIL A MAP OR FILTER VIEW OVER A LITERAL WITH A FAILED CELL', () => {
  // A `Map` or `Filter` view keeps its source unevaluated: the value of the
  // statement holds no error, but each read of the view gives the error of
  // the failed cell. The statement is reported, as a statement whose value
  // holds the error is.

  function report(body: string): { value: string; at: string[] } {
    const source = G + body;
    const result = executeEpsil(new ComputeEngine(), source);
    return {
      value: result.value.toString(),
      at: result.diagnostics.map(
        (d) => `${d.range[0]}:${source.slice(d.range[0], d.range[1])}`
      ),
    };
  }

  const atText = (body: string, text: string): string =>
    `${G.length + body.indexOf(text)}:${text}`;

  test('a `map` statement is reported', () => {
    const stmt = 'let ys = map((u) => u, [1, g("a"), 3])';
    const body = `${stmt}\n1`;
    expect(report(body).at).toEqual([LET_XS, atText(body, stmt)]);
  });

  test('a `filter` statement is reported', () => {
    const stmt = 'let ys = filter([1, g("a"), 3], (u) => true)';
    const body = `${stmt}\n1`;
    expect(report(body).at).toEqual([LET_XS, atText(body, stmt)]);
  });

  test('a callback that ignores its argument does not change the report', () => {
    const stmt = 'let ys = map((u) => 1, [1, g("a"), 3])';
    const body = `${stmt}\n1`;
    expect(report(body).at).toEqual([LET_XS, atText(body, stmt)]);
  });

  test('a nested statement is reported once', () => {
    const stmt = 'let ys = map((u) => u, [1, g("a"), 3])';
    const body = `let t = 0\nfor k in [1, 2] { ${stmt}; t = t + 1 }\nt`;
    const r = report(body);
    expect(r.value).toBe('2');
    expect(r.at).toEqual([LET_XS, atText(body, stmt)]);
  });

  test('a view with no failed cell is not reported', () => {
    expect(report('let ys = map((u) => u, [1, g(2), 3])\n1').at).toEqual([
      LET_XS,
    ]);
  });

  test('an inner list with a failed cell is a value for the callback', () => {
    // `(u) => 1` gives `1` for the cell `[1, g("a")]`.
    expect(report('let ys = map((u) => 1, [[1, g("a")], 3])\n1').at).toEqual([
      LET_XS,
    ]);
  });

  test('a cell with an effect is not evaluated by the check', () => {
    const ce = new ComputeEngine();
    const printed: string[] = [];
    ce.effects = {
      console: {
        log: (line) => {
          printed.push(line);
        },
        readLine: () => '',
      },
    };
    const result = executeEpsil(
      ce,
      G +
        'function h(x) { print("ran"); 1/x }\nlet ys = map((u) => u, [1, h("a"), 3])\n1'
    );
    expect(printed).toEqual([]);
    // Only the `let xs` statement of the prefix.
    expect(result.diagnostics.length).toBe(1);
    // A read of the view runs the effect.
    executeEpsil(ce, 'for y in ys { 0 }\n1');
    expect(printed).toEqual(['ran']);
  });

  test('a step budget that the check spends stops the program', () => {
    // The pure cell `g(2)` runs a long loop. The check is where the budget
    // runs out, and the cancellation is reported at the statement, as for a
    // statement that spends the budget.
    const ce = new ComputeEngine();
    const stmt = 'let ys = map((u) => u, [1, g(2), 3])';
    const source = `function g(x) { let s = 0; for i in 1..200000 { s = s + i }; s / x }\n${stmt}\n1`;
    const result = ce.withStepBudget({ steps: 200 }, () =>
      executeEpsil(ce, source)
    );
    expect(
      result.diagnostics.map((d) => [
        d.message[0],
        d.message[1],
        source.slice(d.range[0], d.range[1]),
      ])
    ).toEqual([['evaluation-canceled', 'step-budget', stmt]]);
  });
});
