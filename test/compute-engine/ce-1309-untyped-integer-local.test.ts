import { ComputeEngine, compile } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1309. A local with no declared type whose value is an integer, and
// whose reads have an integer engine type, is an integer in compiled code:
// a function declared `-> integer` that counts in a loop compiles, and so
// does a condition on a call of a function that calls it. A local that a
// write makes a real stays a real.
//

const OTHELLO = `
function ray(B: list<integer>, k: integer, p: integer, dx: integer, dy: integer) -> integer {
  let col = k - 1 - 8 * floor((k - 1) / 8) + dx
  let row = floor((k - 1) / 8) + dy
  let n = 0
  let found = 0
  for j in 1..7 {
    if col < 0 || col > 7 || row < 0 || row > 7 { break }
    let v = B[1 + col + 8 * row]
    if v == -p {
      n = n + 1
    } else {
      if v == p { found = n }
      break
    }
    col = col + dx
    row = row + dy
  }
  found
}
function flips(B: list<integer>, k: integer, p: integer) -> integer {
  let n = 0
  if k >= 1 && k <= 64 && p != 0 {
    if B[k] == 0 {
      for dx in -1..1 {
        for dy in -1..1 {
          if dx != 0 || dy != 0 { n = n + ray(B, k, p, dx, dy) }
        }
      }
    }
  }
  n
}
function legal(B: list<integer>, p: integer) -> list<integer> {
  [k for k in 1..64 if flips(B, k, p) > 0]
}
`;

const START = Array.from({ length: 65 }, (_, i) =>
  i === 27 || i === 36 ? -1 : i === 28 || i === 35 || i === 64 ? 1 : 0
);
// A board after a few moves.
const LATER = START.map((x, i) =>
  [19, 20, 26, 29, 37, 44].includes(i) ? -1 : [21, 34, 43].includes(i) ? 1 : x
);

function engine(program: string): ComputeEngine {
  const ce = new ComputeEngine();
  expect(executeEpsil(ce, program).diagnostics).toEqual([]);
  ce.declare('L', 'list<integer>');
  ce.declare('K', 'integer');
  ce.declare('P', 'integer');
  return ce;
}

/** The interpreter's value of `expr` with the board in place of `L`. */
function interpreted(ce: ComputeEngine, expr: unknown, board: number[]) {
  const at = (x: unknown): unknown =>
    x === 'L' ? ['List', ...board] : Array.isArray(x) ? x.map(at) : x;
  return ce.box(at(expr) as never).evaluate().json;
}

describe('CE-1309: a condition on a call of a function that calls another', () => {
  const ce = engine(OTHELLO);
  test.each(['javascript', 'interval-js'])('compiles on %s', (to) => {
    const exprs = [
      ['If', ['Greater', ['flips', 'L', 20, 1], 0], 1, 0],
      ['legal', 'L', 1],
    ];
    for (const expr of exprs)
      expect(
        compile(ce.box(expr as never), { to, fallback: false } as never).success
      ).toBe(true);
  });

  test.each([
    ['the start', START],
    ['a later board', LATER],
  ])('the values on %s are those of the interpreter', (_, board) => {
    const condition = ['If', ['Greater', ['flips', 'L', 'K', 'P'], 0], 1, 0];
    const f = compile(ce.box(condition as never), { fallback: false } as never);
    for (const p of [1, -1]) {
      const expected: number[] = [];
      for (let k = 1; k <= 64; k++) {
        const at = (x: unknown): unknown =>
          x === 'K' ? k : x === 'P' ? p : Array.isArray(x) ? x.map(at) : x;
        const value = interpreted(ce, at(condition), board);
        expect(f.run!({ L: board, K: k, P: p })).toBe(value);
        if (value === 1) expected.push(k);
      }
      expect(expected.length).toBeGreaterThan(0);
      const legal = compile(ce.box(['legal', 'L', p] as never), {
        fallback: false,
      } as never);
      expect(legal.run!({ L: board })).toEqual(expected);
    }
  });
});

describe('CE-1309: the lane of a local with no declared type', () => {
  const run = (body: string, result = 'integer') => {
    const ce = engine(
      `function f(B: list<integer>, k: integer) -> ${result} {\n${body}\n}`
    );
    const r = compile(ce.box(['f', 'L', 3] as never), {
      fallback: false,
    } as never);
    return r.run!({ L: [1, 2, 3, 4, 5, 6, 7] });
  };

  test('a count in a loop is an integer', () => {
    expect(run('let n = 0\nfor j in 1..k { n = n + B[j] }\nn')).toBe(6);
  });

  test('a local that a loop makes a real stays a real', () => {
    expect(run('let t = 0\nfor j in 1..k { t = t + 0.5 }\nt', 'real')).toBe(
      1.5
    );
  });

  test('a real write to a counted local still declines at an integer result', () => {
    expect(() =>
      run('let t = 0\nfor j in 1..k { t = t + 0.5 }\nt', 'integer')
    ).toThrow(/a body of f that is not integer/);
  });
});
