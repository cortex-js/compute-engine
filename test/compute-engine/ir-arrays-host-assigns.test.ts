/**
 * A function that assigns a variable of the engine and calls a function of
 * the host (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 10.7,
 * acceptance case 12b): the code writes each assigned variable to the
 * engine before a call of the host and reads it again after it. Each
 * program runs on two engines, one compiled and one interpreted, and the
 * values that the host function sees and the values of the engine are
 * compared.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { ArrayInterface } from '../../src/compute-engine/types-expression';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil';

type Run = (...args: unknown[]) => unknown;

/** An engine with the host functions of the tests: `hostDraw(x)` records
 *  `x` and the value of `s` in the engine; `hostSet(x)` assigns `s`;
 *  `hostFail(x)` records `s` and throws; `hostFlag()` records `on`;
 *  `draw(a)` records the cells of the array `a`. */
function engine(source: string) {
  const ce = new ComputeEngine();
  const seen: number[][] = [];
  const flags: boolean[] = [];
  const snapshots: number[][] = [];
  const read = (name: string) => ce.box(name).evaluate().re;
  ce.declare('hostDraw', {
    signature: '(real) -> nothing',
    evaluate: (ops) => {
      seen.push([ops[0].re, read('s')]);
      return ce.symbol('Nothing');
    },
  });
  ce.declare('hostSet', {
    signature: '(real) -> nothing',
    evaluate: (ops) => {
      ce.assign('s', ops[0].re);
      return ce.symbol('Nothing');
    },
  });
  ce.declare('hostFail', {
    signature: '(real) -> nothing',
    evaluate: (ops) => {
      seen.push([ops[0].re, read('s')]);
      throw new Error('host failure');
    },
  });
  ce.declare('hostFlag', {
    signature: '() -> real',
    evaluate: () => {
      flags.push(ce.box('on').evaluate().symbol === 'True');
      return ce.number(1);
    },
  });
  ce.declare('draw', {
    signature: '(any) -> nothing',
    evaluate: (ops) => {
      if (isMutableArray(ops[0]))
        snapshots.push(Array.from(ops[0].cells as ArrayLike<number>));
      return ce.symbol('Nothing');
    },
  });
  const program = executeEpsil(ce, source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, seen, flags, snapshots };
}

function compiled(ce: ComputeEngine, name: string) {
  const result = compile(ce.box(name).evaluate(), {
    to: 'javascript',
    fallback: false,
  });
  expect(result.success).toBe(true);
  return result;
}

function declined(ce: ComputeEngine, name: string): string {
  const result = compile(ce.box(name).evaluate(), { to: 'javascript' });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

function cells(ce: ComputeEngine, name: string): number[] {
  const x = ce.box(name).evaluate();
  if (!isMutableArray(x)) throw new Error(`${name} is not an array`);
  return Array.from((x as Expression & ArrayInterface).cells as ArrayLike<number>);
}

/** Each call of `calls`, of `f` compiled on one engine and interpreted on
 *  another: the values, what the host functions saw, and the values of
 *  `names` in each engine after the calls. */
function both(source: string, f: string, calls: number[][], names = ['s']) {
  const c = engine(source);
  const run = compiled(c.ce, f).run as Run;
  const i = engine(source);
  const code = calls.map((args) => run(...args));
  const interpreted = calls.map(
    (args) => i.ce.box([f, ...args]).evaluate().re
  );
  const values = (ce: ComputeEngine) =>
    names.map((n) => ce.box(n).evaluate().re);
  return {
    code: { values: code, seen: c.seen, engine: values(c.ce) },
    interpreted: {
      values: interpreted,
      seen: i.seen,
      engine: values(i.ce),
    },
  };
}

describe('A VARIABLE AND A CALL OF THE HOST (acceptance 12b)', () => {
  test('the host function reads the new value of s', () => {
    const source = `let s = 0
let f = (t: real) => do { s = s + t; hostDraw(s) }`;
    const { ce } = engine(source);
    const result = compiled(ce, 'f');
    expect(result.assigns).toEqual(['s']);
    expect(result.hostCalls).toEqual(['hostDraw']);
    const b = both(source, 'f', [[1], [2], [3.5]]);
    expect(b.code.seen).toEqual([
      [1, 1],
      [3, 3],
      [6.5, 6.5],
    ]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a host function that assigns s changes the value read after it', () => {
    const source = `let s = 0
let f = (t: real) => do { s = s + t; hostSet(100); s = s + 1; s * 2 }`;
    const b = both(source, 'f', [[1], [2]]);
    expect(b.code.values).toEqual([202, 202]);
    expect(b.code.engine).toEqual([101]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a host call in a Loop shows each value to the host', () => {
    const source = `let s = 0
let f = (n: integer) => do { for k in 1..n { s = s + k; hostDraw(k) }; s }`;
    const b = both(source, 'f', [[3], [2]]);
    expect(b.code.seen).toEqual([
      [1, 1],
      [2, 3],
      [3, 6],
      [1, 7],
      [2, 9],
    ]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a host function that assigns s in a Loop', () => {
    const source = `let s = 0
let f = (n: integer) => do { for k in 1..n { s = s + 1; hostSet(s * 10) }; s }`;
    // s = 1, then 10; 11, then 110; 111, then 1110.
    const b = both(source, 'f', [[3]]);
    expect(b.code.values).toEqual([1110]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('an If with a host call in one arm', () => {
    const source = `let s = 0
let f = (t: real) => do { if t > 1 { hostSet(t * 10) } else { s = s - 1 }; s + 1 }`;
    const b = both(source, 'f', [[2], [0], [5], [-1]]);
    expect(b.code.values).toEqual([21, 20, 51, 50]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a user function that calls the host and assigns s', () => {
    const source = `let s: real = 0
function bump(t: real) scope { s = s + t; hostDraw(s) }
function twice(t: real) scope { bump(t); bump(t) }
let f = (t: real) => do { twice(t); hostSet(s + 1000); bump(1); s }`;
    const b = both(source, 'f', [[1], [2]]);
    expect(b.code.seen).toEqual([
      [1, 1],
      [2, 2],
      [1003, 1003],
      [1005, 1005],
      [1007, 1007],
      [2008, 2008],
    ]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a Loop in a user function carries s around a host call', () => {
    const source = `let s: real = 0
function many(n: integer) scope { for k in 1..n { s = s + k; hostDraw(k); s = s * 2 }; s }
let f = (n: integer) => many(n) + s`;
    const b = both(source, 'f', [[3], [1]]);
    expect(b.code.seen).toEqual([
      [1, 1],
      [2, 4],
      [3, 11],
      [1, 23],
    ]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a user function that only calls the host sees s', () => {
    const source = `let s: real = 0
function show() { hostDraw(s) }
let f = (t: real) => do { s = s + t; show(); hostSet(7); show(); s }`;
    const b = both(source, 'f', [[1], [2]]);
    expect(b.code.seen).toEqual([
      [1, 1],
      [7, 7],
      [9, 9],
      [7, 7],
    ]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a throw after a host call keeps the values written at that call', () => {
    const source = `let s = 0
let f = (t: real) => do { s = s + t; hostDraw(s); s = s + 100; hostFail(s); s = s + 1000; s }`;
    const { ce, seen } = engine(source);
    const run = compiled(ce, 'f').run as Run;
    expect(() => run(1)).toThrow('host failure');
    // `hostFail` saw the value written before it, and the engine keeps it.
    expect(seen).toEqual([
      [1, 1],
      [101, 101],
    ]);
    expect(ce.box('s').evaluate().re).toBe(101);
    const i = engine(source);
    expect(() => i.ce.box(['f', 1]).evaluate()).toThrow('host failure');
    expect(i.ce.box('s').evaluate().re).toBe(101);
  });

  test('a throw with no host call before it writes nothing', () => {
    // The `iterationBudget` stops the loop, before the host call.
    const source = `let s = 0
let f = (n: integer) => do { s = s + n; for k in 1..n { s = s + 1 }; hostDraw(s); s }`;
    const { ce, seen } = engine(source);
    const result = compile(ce.box('f').evaluate(), {
      to: 'javascript',
      fallback: false,
      iterationBudget: 5,
    });
    const run = result.run as Run;
    expect(run(2)).toBe(4);
    expect(() => run(30)).toThrow('iterationBudget');
    expect(seen).toEqual([[4, 4]]);
    expect(ce.box('s').evaluate().re).toBe(4);
  });

  test('a boolean variable', () => {
    const source = `let on = false
let f = (t: real) => do { on = t > 1; let a = hostFlag(); on = !on; a + if on { 10 } else { 20 } }`;
    const c = engine(source);
    const run = compiled(c.ce, 'f').run as Run;
    const i = engine(source);
    for (const t of [2, 0, 3]) {
      expect(run(t)).toBe(i.ce.box(['f', t]).evaluate().re);
      expect(c.ce.box('on').evaluate().symbol).toBe(
        i.ce.box('on').evaluate().symbol
      );
    }
    expect(c.flags).toEqual([true, false, true]);
    expect(c.flags).toEqual(i.flags);
  });

  test('a variable with no value of its lane after a host call throws a TypeError', () => {
    const source = `let s = 0
let f = (t: real) => do { s = s + t; hostBreak(t); s }`;
    const ce = new ComputeEngine();
    ce.declare('hostBreak', {
      signature: '(real) -> nothing',
      evaluate: () => {
        ce.assign('s', ce.complex(1, 2));
        return ce.symbol('Nothing');
      },
    });
    executeEpsil(ce, source);
    const run = compiled(ce, 'f').run as Run;
    expect(() => run(1)).toThrow(
      /The variable "s" that the compiled function assigns holds/
    );
  });

  test('a function that assigns s and makes no host call is unchanged', () => {
    const source = `let s = 0.5
let f = (t: real) => do { s = s + t / 1000 }`;
    const { ce } = engine(source);
    const result = compiled(ce, 'f');
    expect(result.assigns).toEqual(['s']);
    expect(result.code).not.toContain('_SYS.state');
    (result.run as Run)(16);
    expect(ce.box('s').evaluate().re).toBeCloseTo(0.516, 12);
  });
});

describe('AN ASSIGNED ARRAY', () => {
  test('board = next compiles at the root and in a user function', () => {
    const source = `let board = arrayFrom([1, 2, 3], "integer<0..255>")
let other = arrayFrom([7, 8, 9], "integer<0..255>")
function flip() scope { let x = board; board = other; other = x; 0 }
let f = (t: real) => do { flip(); draw(board); board[1] + other[1] }`;
    const { ce, snapshots } = engine(source);
    const result = compiled(ce, 'f');
    expect(result.assigns).toEqual(['board', 'other']);
    expect(result.arrays).toEqual([]);
    const run = result.run as Run;
    const board = ce.box('board').evaluate();
    const other = ce.box('other').evaluate();
    expect(run(0)).toBe(8);
    expect(ce.box('board').evaluate()).toBe(other);
    expect(ce.box('other').evaluate()).toBe(board);
    expect(run(0)).toBe(8);
    expect(ce.box('board').evaluate()).toBe(board);
    expect(snapshots).toEqual([
      [7, 8, 9],
      [1, 2, 3],
    ]);
  });

  test('(a, b) = (b, a) at the root, with a host call between', () => {
    const source = `let a = arrayFrom([1, 2], "real")
let b = arrayFrom([5, 6], "real")
let f = (t: real) => do { a[1] = t; (a, b) := (b, a); draw(a); a[1] * 10 + b[1] }`;
    const c = engine(source);
    const run = compiled(c.ce, 'f').run as Run;
    const i = engine(source);
    for (const t of [3, 4, 9])
      expect(run(t)).toBe(i.ce.box(['f', t]).evaluate().re);
    expect(cells(c.ce, 'a')).toEqual(cells(i.ce, 'a'));
    expect(cells(c.ce, 'b')).toEqual(cells(i.ce, 'b'));
    expect(c.snapshots).toEqual(i.snapshots);
  });

  test('an interpreted assignment of cur between two calls is seen', () => {
    const source = `let cur = arrayFrom([1, 2], "integer<0..255>")
let spare = arrayFrom([30, 40], "integer<0..255>")
let f = (t: real) => do { draw(cur); cur = spare; cur[1] + t }`;
    const { ce, snapshots } = engine(source);
    const run = compiled(ce, 'f').run as Run;
    const first = ce.box('cur').evaluate();
    expect(run(1)).toBe(31);
    // An interpreted assignment between the two calls.
    executeEpsil(ce, 'cur = arrayFrom([5, 6], "integer<0..255>")');
    expect(run(2)).toBe(32);
    expect(snapshots).toEqual([
      [1, 2],
      [5, 6],
    ]);
    expect(ce.box('cur').evaluate()).not.toBe(first);
  });

  test('a host function that assigns another array to cur', () => {
    const run = (compiledRun: boolean) => {
      const ce = new ComputeEngine();
      const other = ce
        .box(['ArrayFrom', ['List', 9, 9], "'integer<0..255>'"])
        .evaluate();
      ce.declare('hostSwitch', {
        signature: '(real) -> nothing',
        evaluate: () => {
          ce.assign('cur', other);
          return ce.symbol('Nothing');
        },
      });
      executeEpsil(
        ce,
        `let cur = arrayFrom([1, 2], "integer<0..255>")
let spare = arrayFrom([3, 4], "integer<0..255>")
let f = (t: integer) => do { cur = spare; cur[1] = t; hostSwitch(t); cur[2] = t; cur[1] }`
      );
      const value = compiledRun
        ? (compiled(ce, 'f').run as Run)(4)
        : ce.box(['f', 4]).evaluate().re;
      return {
        value,
        other: ce.box('cur').evaluate() === other,
        cur: cells(ce, 'cur'),
        spare: cells(ce, 'spare'),
      };
    };
    expect(run(true)).toEqual({
      value: 9,
      other: true,
      cur: [9, 4],
      spare: [4, 4],
    });
    expect(run(true)).toEqual(run(false));
  });
});

describe('A NAME THAT HOLDS AN ARRAY, READ AFTER A CALL OF THE HOST', () => {
  /** `f(…args)` compiled and interpreted, on engines where `hostSwitch`
   *  assigns `cur` an array `[9, 9]` of the cells `cell`: the value, whether
   *  `cur` holds that array, the cells of both arrays and their versions. */
  const run = (
    source: string,
    args: number[],
    compiledRun: boolean,
    cell = 'integer<0..255>'
  ) => {
    const ce = new ComputeEngine();
    const other = ce.box(['ArrayFrom', ['List', 9, 9], `'${cell}'`]).evaluate();
    let switches = 0;
    ce.declare('hostSwitch', {
      signature: '(real) -> nothing',
      evaluate: () => {
        switches += 1;
        ce.assign('cur', other);
        return ce.symbol('Nothing');
      },
    });
    ce.declare('hostKeep', {
      signature: '(real) -> nothing',
      evaluate: () => ce.symbol('Nothing'),
    });
    executeEpsil(ce, source);
    const first = ce.box('cur').evaluate() as Expression & ArrayInterface;
    const result = compiledRun ? compiled(ce, 'f') : undefined;
    const value = result
      ? (result.run as Run)(...args)
      : ce.box(['f', ...args]).evaluate().re;
    const o = other as Expression & ArrayInterface;
    return {
      value,
      switched: ce.box('cur').evaluate() === other,
      first: Array.from(first.cells as ArrayLike<number>),
      other: Array.from(o.cells as ArrayLike<number>),
      versions: [first.version > 0, o.version > 0],
      switches,
      ...(result ? { arrays: result.arrays, assigns: result.assigns } : {}),
    };
  };
  const both2 = (source: string, args: number[]) => {
    const code = run(source, args, true);
    const { arrays: _a, assigns: _s, ...rest } = code;
    expect(rest).toEqual(run(source, args, false));
    return code;
  };
  const head = 'let cur = arrayFrom([1, 2], "integer<0..255>")\n';

  test('a read after the call reads the array that the host assigned', () => {
    const r = both2(
      head + 'let f = (t: integer) => do { cur[1] = t; hostSwitch(t); cur[1] }',
      [4]
    );
    expect(r).toMatchObject({ value: 9, switched: true, arrays: ['cur'] });
    expect(r.assigns).toBeUndefined();
  });

  test('stores before and after the call land in the two arrays', () => {
    const r = both2(
      head +
        'let f = (t: integer) => do { cur[2] = t; hostSwitch(t); cur[1] = t + 1; cur[1] * 10 + cur[2] }',
      [4]
    );
    expect(r).toMatchObject({
      value: 59,
      first: [1, 4],
      other: [5, 9],
      versions: [true, true],
    });
  });

  test('a read in a loop after the call', () => {
    const r = both2(
      head +
        'let f = (t: integer) => do { hostSwitch(t); let n = 0; for k in 1..2 { n = n + cur[k] }; n }',
      [1]
    );
    expect(r.value).toBe(18);
  });

  test('a call in a loop, with a read after each', () => {
    const r = both2(
      head +
        'let f = (t: integer) => do { let n = 0; for k in 1..2 { n = n + cur[1]; hostSwitch(k) }; n + cur[2] }',
      [1]
    );
    expect(r).toMatchObject({ value: 19, switches: 2 });
  });

  test('through a user function that calls the host', () => {
    const r = both2(
      head +
        `function show(t: integer) { hostSwitch(t); cur[1] }
let f = (t: integer) => do { cur[1] = t; let x = show(t); x + cur[2] }`,
      [4]
    );
    expect(r.value).toBe(18);
  });

  test('a host call that does not assign the name gives the same value', () => {
    const r = both2(
      head + 'let f = (t: integer) => do { cur[1] = t; hostKeep(t); cur[1] }',
      [4]
    );
    expect(r).toMatchObject({ value: 4, switched: false, first: [4, 2] });
  });

  test('a name assigned an array of other cells throws the TypeError of the entry', () => {
    expect(() =>
      run(
        // A declared type that admits both cell types.
        'let cur: array<integer<0..255>> | array<real> = arrayFrom([1, 2], "integer<0..255>")\n' +
          'let f = (t: integer) => do { cur[1] = t; hostSwitch(t); cur[1] }',
        [4],
        true,
        'real'
      )
    ).toThrow(/The variable "cur" was compiled as an array<integer<0..255>>/);
  });

  test('a host call in a Sum, in a program that reads an array name, declines', () => {
    const ce = new ComputeEngine();
    ce.declare('hostVal', {
      signature: '(real) -> real',
      evaluate: (ops) => ops[0],
    });
    executeEpsil(
      ce,
      head + 'let f = (t: integer) => sum(hostVal(k), k, 1, 3) + cur[1]'
    );
    expect(declined(ce, 'f')).toMatch(
      /hostVal of the host, in a body that is evaluated several times .* the variable cur of the engine/
    );
  });
});

describe('THE GAME OF LIFE WITH AN EXCHANGE OF NAMES (acceptance 12b)', () => {
  const source = `let n = 6
let cur = arrayFrom(repeat(0, n * n), "integer<0..1>")
let next = arrayFrom(repeat(0, n * n), "integer<0..1>")
cur[9] = 1
cur[15] = 1
cur[21] = 1
cur[22] = 1
function step() {
  for y in 1..n {
    for x in 1..n {
      let c = 0
      for dy in -1..1 {
        for dx in -1..1 {
          if dx != 0 || dy != 0 {
            c = c + cur[(Mod(y - 1 + dy, n)) * n + Mod(x - 1 + dx, n) + 1]
          }
        }
      }
      let alive = cur[(y - 1) * n + x]
      next[(y - 1) * n + x] = if (c == 3 || (alive == 1 && c == 2)) { 1 } else { 0 }
    }
  }
}
let tick = t => do { step(); (cur, next) := (next, cur); draw(cur) }
`;

  test('the same cells as the interpreter over 20 generations', () => {
    const c = engine(source);
    const result = compiled(c.ce, 'tick');
    expect(result.assigns).toEqual(['cur', 'next']);
    const run = result.run as Run;
    const i = engine(source);
    for (let k = 0; k < 20; k++) {
      run(0);
      i.ce.box(['tick', 0]).evaluate();
    }
    expect(c.snapshots).toHaveLength(20);
    expect(c.snapshots).toEqual(i.snapshots);
    expect(cells(c.ce, 'cur')).toEqual(cells(i.ce, 'cur'));
    expect(cells(c.ce, 'next')).toEqual(cells(i.ce, 'next'));
  });
});

describe('WHAT DECLINES (section 10.7)', () => {
  test('a list variable in a function that calls the host', () => {
    const { ce } = engine(`let L = [1, 2]
let f = (t: real) => do { L = L + [t]; hostDraw(t) }`);
    expect(declined(ce, 'f')).toMatch(
      /hostDraw of the host, in a function that assigns the list variable L/
    );
  });

  test('a list of lists in a function that calls the host', () => {
    const { ce } = engine(`let g = [[1, 0], [0, 1]]
let f = (t: real) => do { g = [[t, 0], [0, t]]; hostDraw(t) }`);
    expect(declined(ce, 'f')).toMatch(
      /hostDraw of the host, in a function that assigns the list variable g/
    );
  });

  // A host function of a real value, in bodies that are evaluated several
  // times, which carry no variable.
  const many = (body: string) => {
    const ce = new ComputeEngine();
    ce.declare('hostVal', {
      signature: '(real) -> real',
      evaluate: (ops) => ce.number(2 * ops[0].re),
    });
    executeEpsil(
      ce,
      `let s = 0
function g(k: real) { hostVal(k) }
function r(n: integer) { if n <= 0 { hostVal(0) } else { r(n - 1) } }
function p(n: integer) { if n <= 0 { hostVal(0) } else { q(n - 1) } }
function q(n: integer) { p(n) }
let f = (t: real) => do { s = s + t; ${body} }`
    );
    return declined(ce, 'f');
  };
  const several =
    /hostVal of the host, in a body that is evaluated several times .* in a function that assigns the variable s of the engine/;

  test.each([
    ['in a Sum', 'sum(hostVal(k), k, 1, 3)'],
    ['in a callback of Map', 'let L = map(k => hostVal(k), [1, 2]); L[1]'],
    ['in a callback of Filter', 'let L = filter([1, 2], k => hostVal(k) > 2); length(L)'],
    ['through a user function in a Sum', 'sum(g(k), k, 1, 3)'],
    ['through a user function given by name to Map', 'let L = map(g, [t, s]); L[1]'],
  ])('a host call %s', (_, body) => {
    expect(many(body)).toMatch(several);
  });

  test('a user function that calls the host, mapped over a list', () => {
    expect(many('let L = g([1, 2]); L[1]')).toMatch(
      /a call of g that maps over a list, which calls the function hostVal of the host, in a function that assigns the variable s/
    );
  });

  test('a recursive function that calls the host', () => {
    expect(many('r(2)')).toMatch(
      /a recursive call of r, which calls the function hostVal of the host, in a function that assigns the variable s/
    );
  });

  test('a cycle of functions that calls the host', () => {
    expect(many('p(2)')).toMatch(
      /a recursive call of p, .*a function on a cycle of calls/
    );
  });

  test('the same bodies compile in a function that assigns no variable', () => {
    const ce = new ComputeEngine();
    ce.declare('hostVal', {
      signature: '(real) -> real',
      evaluate: (ops) => ce.number(2 * ops[0].re),
    });
    executeEpsil(
      ce,
      `function g(k: real) { hostVal(k) }
let f = (t: real) => sum(g(k), k, 1, 3) + t`
    );
    expect(compiled(ce, 'f').run(1)).toBe(13);
  });
});
