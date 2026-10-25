import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A collection literal keeps a failed cell in its position
// (`docs/ERROR-MODEL.md` §3). The tree is invalid (`isValid` is `false`),
// but the literal is still a collection, and its type says so. A type
// describes the successful values (`docs/ERROR-MODEL.md` §4), so a failed
// cell is left out of the element type: `[1, Error(…), 3]` is typed as
// `[1, 2, 3]` is (user decision 2026-10-22; before it, a failed cell made the
// element type `unknown`). Before that, the whole literal was typed
// `error`, so on the host route a variable that held it was a scalar:
// `ListJoin(fs, [2])` with `fs := [Error(…)]` gave `[[Error(…)], 2]`, and a
// variable declared `list` refused the value.
//
// A list in which every cell failed is written-out data, as a list of
// numbers is: it evaluates to itself and holds no symbol. Before, a loop that
// grew such a list by one cell per turn evaluated and walked every `Error`
// cell again at each turn.
//

const ERR = ['Error', "'oops'"];
const ERR_TEXT = 'Error("oops")';

describe('A LIST LITERAL WITH A FAILED CELL IS TYPED AS A COLLECTION', () => {
  const ce = new ComputeEngine();

  test('box route', () => {
    const xs = ce.box(['List', 1, ERR, 3]);
    expect(xs.isValid).toBe(false);
    expect(xs.type.toString()).toBe('vector<integer^3>');
    // No cell succeeded: nothing is known of the cells.
    expect(ce.box(['List', ERR]).type.toString()).toBe('list<unknown>');
  });

  test('parse route', () => {
    const xs = ce.parse('[1, \\sin("a"), 3]');
    expect(xs.isValid).toBe(false);
    expect(xs.type.toString()).toBe('vector<integer^3>');
  });

  test('a set literal', () => {
    expect(ce.box(['Set', 1, ERR]).type.toString()).toBe('set<integer>');
  });

  test('an absent cell beside the failed cell is the only cell type', () => {
    expect(ce.box(['List', ERR, 'Missing']).type.toString()).toBe(
      'list<missing^2>'
    );
    expect(ce.box(['Set', ERR, 'Missing']).type.toString()).toBe(
      'set<missing>'
    );
    // A `NaN` cell is a value, and a `Nothing` cell is erased.
    expect(ce.box(['List', ERR, 'NaN']).type.toString()).toBe('vector<nan^2>');
    const erased = ce.box(['List', ERR, 'Nothing']);
    expect(erased.nops).toBe(1);
    expect(erased.type.toString()).toBe('list<unknown>');
    // The failed cell is in place of a row: the nested list gives the cell
    // type.
    expect(ce.box(['List', ERR, ['List', 1, 'Missing']]).type.toString()).toBe(
      'matrix<integer | missing^(2x2)>'
    );
  });

  test('an expression that is not a collection literal is still typed error', () => {
    expect(ce.box(ERR).type.toString()).toBe('error');
    expect(ce.box(['Sin', ERR]).type.toString()).toBe('error');
    // The failed cell is in the list, not in an operand of `Sin`: the
    // broadcast gives a list that keeps the failed cell in place
    // (`[sin(1), <error>]`), typed as the list over the valid cells (CE-450).
    expect(ce.box(['Sin', ['List', 1, ERR]]).type.toString()).toBe(
      'vector<2>'
    );
  });

  test('the value of the evaluation has the same type', () => {
    const xs = ce.box(['List', 1, ERR, 3]);
    const value = xs.evaluate();
    expect(value.toString()).toBe(`[1,${ERR_TEXT},3]`);
    expect(value.type.toString()).toBe('vector<integer^3>');
  });
});

describe('A VARIABLE THAT HOLDS A LIST WITH A FAILED CELL (HOST ROUTE)', () => {
  test('ListJoin splices it', () => {
    const ce = new ComputeEngine();
    ce.assign('fs', ['List', ERR]);
    expect(ce.symbol('fs').type.toString()).toBe('list<unknown>');
    expect(
      ce
        .box(['ListJoin', 'fs', ['List', 2]])
        .evaluate()
        .toString()
    ).toBe(`[${ERR_TEXT},2]`);
  });

  test('ListJoin keeps the failed cell in its position', () => {
    const ce = new ComputeEngine();
    ce.assign('fs', ['List', 1, ERR, 3]);
    expect(
      ce
        .box(['ListJoin', 'fs', ['List', 4]])
        .evaluate()
        .toString()
    ).toBe(`[1,${ERR_TEXT},3,4]`);
  });

  test('At reads each cell', () => {
    const ce = new ComputeEngine();
    ce.assign('fs', ['List', 1, ERR, 3]);
    expect(ce.box(['At', 'fs', 2]).evaluate().toString()).toBe(ERR_TEXT);
    expect(ce.box(['At', 'fs', 3]).evaluate().toString()).toBe('3');
  });

  test('Length counts the failed cell', () => {
    // A list literal with a failed cell is a collection that can be
    // iterated (`docs/ERROR-MODEL.md` §3): `Length` reads its count, which
    // does not demand the value of any cell.
    const ce = new ComputeEngine();
    ce.assign('fs', ['List', 1, ERR, 3]);
    expect(ce.box(['Length', 'fs']).evaluate().toString()).toBe('3');
  });

  test('a variable declared list accepts the value', () => {
    const ce = new ComputeEngine();
    ce.declare('fs', 'list');
    ce.assign('fs', ['List', 1, ERR]);
    expect(ce.symbol('fs').evaluate().toString()).toBe(`[1,${ERR_TEXT}]`);
  });

  test('a variable declared list<number> refuses the value', () => {
    // The failed cell is not a number: `error` is not a subtype of
    // `number`. The type of the value leaves the failed cell out
    // (`vector<integer^2>`), so the declared-type check reads the cells
    // (`failedElementRefusedBy`), and the message names the failed cell.
    const ce = new ComputeEngine();
    ce.declare('fs', 'list<number>');
    expect(() => ce.assign('fs', ['List', 1, ERR])).toThrow(
      /not compatible with the type "list<number>"[\s\S]*failed element "Error\("oops"\)"/
    );
  });
});

describe('A LIST WITH A FAILED CELL (EPSIL ROUTE)', () => {
  test('a spread of the list splices it', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function g(x) { 1/x }\nlet fs = [g("a")]\nlet h = [...fs, 2]\nh'
    );
    expect(r.value.operator).toBe('List');
    expect(r.value.nops).toBe(2);
    expect(r.value.ops![0].operator).toBe('Error');
    expect(r.value.ops![1].toString()).toBe('2');
    expect(r.value.type.toString()).toBe('vector<integer^2>');
  });

  test('a variable declared list accepts the value', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function g(x) { 1/x }\nlet q: list = [1, g("a")]\nq'
    );
    expect(r.value.nops).toBe(2);
    // Only the failed call is reported, not the declaration.
    expect(r.diagnostics.map((d) => d.message[3])).toEqual([
      'incompatible-type',
    ]);
  });
});

describe('A LIST OF FAILED CELLS IS WRITTEN-OUT DATA', () => {
  const ce = new ComputeEngine();

  test('it evaluates to itself', () => {
    const xs = ce.box(['List', ERR, 2, ERR]);
    expect(xs.evaluate()).toBe(xs);
    expect(xs.N()).toBe(xs);
  });

  test('it holds no symbol', () => {
    const xs = ce.box(['List', ERR, 2, ERR]);
    expect(xs.unknowns).toEqual([]);
    expect(xs.symbols).toEqual([]);
    expect(xs.isPure).toBe(true);
  });

  test('an error that holds a symbol is not data', () => {
    // The `where` operand of a static diagnostic can name a symbol. Such an
    // error is not data, and the symbol is still reported.
    const xs = ce.box(['List', ['Error', "'oops'", 'y'], 2]);
    expect(xs.unknowns).toEqual(['y']);
    expect(xs.symbols).toEqual(['y']);
  });

  test('an error payload with shared subtrees is walked once per node', () => {
    // `t₀ = 1`, `tₙ₊₁ = Tuple(tₙ, tₙ)`: depth 60 has 2⁶⁰ paths but only 61
    // distinct nodes. A walk of every path would not finish.
    let t = ce.number(1);
    for (let i = 0; i < 60; i++) t = ce._fn('Tuple', [t, t]);
    const err = ce._fn('Error', [ce.string('oops'), t]);
    const xs = ce._fn('List', [err, ce.number(2)]);
    const start = performance.now();
    expect(xs.unknowns).toEqual([]);
    expect(xs.evaluate()).toBe(xs);
    expect(xs.isPure).toBe(true);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

// The time of a loop that grows a list by one cell per turn, when every cell
// fails, against the same loop when only the first cell fails. Before, each
// turn evaluated and walked every `Error` cell again, and the first loop
// took about ten times as long as the second (11.5 s against 0.7 s for 3200
// turns). Timing assertions run only in a `CE_PERF=1` run
// (`npm run test:perf`), which runs its suites one at a time.
const perfTest = process.env.CE_PERF === '1' ? test : test.skip;

describe('A LIST WHERE EVERY CELL FAILED, GROWN IN A LOOP', () => {
  perfTest(
    'every cell failed: the loop is not slower than when one cell failed',
    () => {
      const G = 'function g(x) { 1/x }\n';
      const N = 1600;
      const time = (source: string) => {
        const ce = new ComputeEngine();
        const start = performance.now();
        const r = executeEpsil(ce, source);
        const elapsed = performance.now() - start;
        expect(r.value.nops).toBe(N);
        return elapsed;
      };
      const oneFailed = time(
        G +
          `let fs = []\nfor i in 1..${N} { fs = [...fs, if i == 1 { g("a") } else { i }] }\nfs`
      );
      const allFailed = time(
        G + `let fs = []\nfor i in 1..${N} { fs = [...fs, g("a")] }\nfs`
      );
      expect(allFailed).toBeLessThan(3 * oneFailed);
    },
    10_000
  );
});

describe('a tuple whose coordinate is a list with a failed cell', () => {
  // The tuple is bound when it is boxed alone, so it must be bound in the
  // same way when it is an element of a list: its type is the same in both
  // places. Before, inside a list it stayed unbound and was typed `error`.
  test('has the same type alone and inside a list', () => {
    const ce = new ComputeEngine();
    const E = ['Error', { str: 'x' }];
    const alone = ce.box(['Tuple', ['List', 1, E], 2] as any);
    const inner = ce.box(['List', ['Tuple', ['List', 1, E], 2]] as any).ops![0];
    expect(alone.type.toString()).toBe('tuple<vector<integer^2>, integer>');
    expect(inner.type.toString()).toBe(alone.type.toString());
    expect(inner.isCanonical).toBe(true);
  });

  test('a tuple with a failed coordinate stays frozen', () => {
    const ce = new ComputeEngine();
    const inner = ce.box([
      'List',
      ['Tuple', ['Error', { str: 'x' }], 2],
    ] as any).ops![0];
    expect(inner.isCanonical).toBe(false);
  });
});
