/**
 * Programs that compute in mutable arrays (`array<T>`), compiled to
 * JavaScript and run beside the interpreter
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, acceptance cases 12 and
 * 12a): a raster prelude with the helpers `get` and `set`, a sieve, a sort
 * by exchanges, a table of a dynamic program, and the Game of Life with two
 * buffers and `swap`. Each program runs on two engines, one compiled and
 * one interpreted, and the cells are compared.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { ArrayInterface } from '../../src/compute-engine/types-expression';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil';

type Run = (...args: unknown[]) => unknown;

function engine(source: string) {
  const ce = new ComputeEngine();
  const drawn: Expression[] = [];
  const snapshots: number[][] = [];
  ce.declare('draw', {
    signature: '(any) -> nothing',
    evaluate: (ops) => {
      drawn.push(ops[0]);
      if (isMutableArray(ops[0]))
        snapshots.push(Array.from(ops[0].cells as ArrayLike<number>));
      return ce.symbol('Nothing');
    },
  });
  const program = executeEpsil(ce, source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, drawn, snapshots };
}

function cells(ce: ComputeEngine, name: string): number[] {
  const x = ce.box(name).evaluate();
  if (!isMutableArray(x)) throw new Error(`${name} is not an array`);
  return Array.from((x as Expression & ArrayInterface).cells as ArrayLike<number>);
}

/** Run `f(args)` `times` times, compiled on one engine and interpreted on
 *  another, and give both, with the cells of `names` after each. */
function both(
  source: string,
  f: string,
  names: string[],
  args: number[] = [],
  times = 1
) {
  const c = engine(source);
  const result = compile(c.ce.box(f).evaluate(), {
    to: 'javascript',
    fallback: false,
  });
  expect(result.success).toBe(true);
  const run = result.run as Run;
  const i = engine(source);
  const code: unknown[] = [];
  const interpreted: unknown[] = [];
  for (let k = 0; k < times; k++) {
    code.push(run(...args));
    interpreted.push(i.ce.box([f, ...args]).evaluate().re);
  }
  return {
    result,
    code: { values: code, cells: names.map((n) => cells(c.ce, n)) },
    interpreted: { values: interpreted, cells: names.map((n) => cells(i.ce, n)) },
    compiledEngine: c,
    interpretedEngine: i,
  };
}

describe('A RASTER PRELUDE (acceptance 12)', () => {
  const source = `type alias Byte = integer<0..255>
type Raster = tuple<width: integer, height: integer, pixels: array<Byte>>
function raster(w: integer, h: integer) { Raster(w, h, arrayFrom(repeat(0, w * h), "Byte")) }
function get(r, x, y) { if (x >= 1 && x <= r.width && y >= 1 && y <= r.height) { r.pixels[(y - 1) * r.width + x] } else { 0 } }
function set(r, x, y, p: integer) { if (x >= 1 && x <= r.width && y >= 1 && y <= r.height) { r.pixels[(y - 1) * r.width + x] = p }; p }
let scr = raster(16, 8)
let frame = (t: integer) => do {
  for y in 1..8 {
    for x in 1..16 {
      set(scr, x, y, Mod(x * y + t + get(scr, x - 1, y), 256))
    }
  }
  get(scr, 16, 8)
}
`;

  test('a frame loop through get and set gives the cells of the interpreter', () => {
    const b = both(source, 'frame', [], [3], 4);
    expect(b.code.values).toEqual(b.interpreted.values);
    const read = (ce: ComputeEngine) => {
      const p = ce.box(['Field', 'scr', { str: 'pixels' }]).evaluate();
      return Array.from((p as Expression & ArrayInterface).cells as ArrayLike<number>);
    };
    expect(read(b.compiledEngine.ce)).toEqual(read(b.interpretedEngine.ce));
    // The raster is a value of a name: the code holds its array as a
    // reference of the program.
    expect(b.result.code).toMatch(/_SYS\.arrays\.refs\[0\]/);
    expect(b.result.arrays).toEqual([]);
  });
});

describe('A RASTER WITH DECLARED HELPERS (acceptance 12)', () => {
  const source = `type alias Byte = integer<0..255>
type Raster = tuple<width: integer, height: integer, pixels: array<Byte>>
function set(r: Raster, x: integer, y: integer, p: integer) { r.pixels[y * r.width + x + 1] = p }
function get(r: Raster, x: integer, y: integer) { r.pixels[y * r.width + x + 1] }
let scr = Raster(16, 8, arrayFrom(repeat(0, 128), "Byte"))
let frame = (t: integer) => do {
  for y in 0..7 {
    for x in 0..15 {
      set(scr, x, y, Mod(x * y + t + get(scr, Max(x - 1, 0), y), 256))
    }
  }
  get(scr, 15, 7)
}
`;

  test('a frame loop through get and set gives the cells of the interpreter', () => {
    const b = both(source, 'frame', [], [3], 4);
    expect(b.code.values).toEqual(b.interpreted.values);
    const read = (ce: ComputeEngine) => {
      const p = ce.box(['Field', 'scr', { str: 'pixels' }]).evaluate();
      return Array.from((p as Expression & ArrayInterface).cells as ArrayLike<number>);
    };
    expect(read(b.compiledEngine.ce)).toEqual(read(b.interpretedEngine.ce));
    expect(read(b.compiledEngine.ce).some((x) => x !== 0)).toBe(true);
  });
});

describe('ALGORITHMS IN AN ARRAY (acceptance 12)', () => {
  test('a sieve of Eratosthenes', () => {
    const source = `let flags = arrayFrom(repeat(1, 100), "integer<0..1>")
let sieve = (n: integer) => do {
  flags[1] = 0
  for i in 2..n {
    if flags[i] == 1 {
      for k in 2..(n / i) { flags[i * k] = 0 }
    }
  }
  let count = 0
  for i in 1..n { count = count + flags[i] }
  count
}`;
    const b = both(source, 'sieve', ['flags'], [100]);
    expect(b.code.values).toEqual([25]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a sort by exchanges', () => {
    const source = `let a = arrayFrom([5, 3, 9, 1, 7, 2, 8, 6, 4], "integer<0..100>")
let sort = (n: integer) => do {
  for i in 1..n {
    for j in 1..(n - i) {
      if a[j] > a[j + 1] {
        let t = a[j]
        a[j] = a[j + 1]
        a[j + 1] = t
      }
    }
  }
  a[1] * 10 + a[-1]
}`;
    const b = both(source, 'sort', ['a'], [9]);
    expect(b.code.cells).toEqual([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    expect(b.code).toEqual(b.interpreted);
  });

  test('a table of a dynamic program, of real cells', () => {
    // The fewest coins of 1, 3 and 4 for each amount, and a real table of
    // the average of the last three values.
    const source = `let best = arrayFrom(repeat(0, 41), "real")
let avg = arrayFrom(repeat(0, 41), "real")
let coins = (n: integer) => do {
  for m in 2..n {
    let b = best[m - 1] + 1
    if m > 3 { b = min(b, best[m - 3] + 1) }
    if m > 4 { b = min(b, best[m - 4] + 1) }
    if m == 4 || m == 5 { b = 1 }
    best[m] = b
    avg[m] = (best[m] + best[m - 1] + avg[m - 1]) / 3
  }
  best[n] + avg[n]
}`;
    const b = both(source, 'coins', ['best', 'avg'], [41]);
    expect(b.code.cells[0]).toEqual(b.interpreted.cells[0]);
    expect(b.code.cells[1].map((x, k) => Math.abs(x - b.interpreted.cells[1][k]) < 1e-12)).toEqual(b.code.cells[1].map(() => true));
    expect(b.code.values[0]).toBeCloseTo(b.interpreted.values[0] as number, 12);
  });
});

describe('THE GAME OF LIFE (acceptance 12a)', () => {
  const source = `type alias Bit = integer<0..1>
let w = 6
let h = 6
let cur = arrayFrom(repeat(0, 36), "Bit")
let next = arrayFrom(repeat(0, 36), "Bit")
cur[9] = 1
cur[15] = 1
cur[21] = 1
let step = () => do {
  for y in 1..h {
    for x in 1..w {
      let n = 0
      for dy in -1..1 {
        for dx in -1..1 {
          if dx != 0 || dy != 0 {
            n = n + cur[(Mod(y - 1 + dy, h)) * w + Mod(x - 1 + dx, w) + 1]
          }
        }
      }
      let alive = cur[(y - 1) * w + x]
      next[(y - 1) * w + x] = if (n == 3 || (alive == 1 && n == 2)) { 1 } else { 0 }
    }
  }
  swap(cur, next)
}
let tick = (t: real) => do { step(); draw(cur) }
`;
  const vertical = [9, 15, 21];
  const horizontal = [14, 15, 16];
  const ones = (xs: number[]) => xs.flatMap((x, k) => (x === 1 ? [k + 1] : []));

  test('the callback compiles, a blinker turns, and draw receives cur', () => {
    const { ce, drawn, snapshots } = engine(source);
    const result = compile(ce.box('tick').evaluate(), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    expect(result.arrays).toEqual(['cur', 'next']);
    const run = result.run as Run;
    const cur = ce.box('cur').evaluate();
    run(0);
    expect(ones(cells(ce, 'cur'))).toEqual(horizontal);
    expect(drawn[0]).toBe(cur);
    expect(ones(snapshots[0])).toEqual(horizontal);
    run(0);
    expect(ones(cells(ce, 'cur'))).toEqual(vertical);
    expect(ones(snapshots[1])).toEqual(vertical);
  });

  test('50 compiled calls give the cells of 50 interpreted calls', () => {
    const b = both(source, 'tick', ['cur', 'next'], [0], 50);
    expect(b.code.cells).toEqual(b.interpreted.cells);
    expect(b.compiledEngine.snapshots).toEqual(b.interpretedEngine.snapshots);
  });

  // The form of the spec: arrays of a size computed from a name, a
  // declared function `step()` and the callback `t => …`.
  const declared = `let n = 6
let cur = arrayFrom(repeat(0, n * n), "integer<0..1>")
let next = arrayFrom(repeat(0, n * n), "integer<0..1>")
cur[9] = 1
cur[15] = 1
cur[21] = 1
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
  swap(cur, next)
}
let tick = t => do { step(); draw(cur) }
`;

  test('a declared step(): the callback compiles, a blinker turns, and draw receives cur', () => {
    const { ce, drawn, snapshots } = engine(declared);
    const result = compile(ce.box('tick').evaluate(), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.success).toBe(true);
    const run = result.run as Run;
    const cur = ce.box('cur').evaluate();
    run(0);
    expect(ones(cells(ce, 'cur'))).toEqual(horizontal);
    expect(drawn[0]).toBe(cur);
    expect(ones(snapshots[0])).toEqual(horizontal);
    run(0);
    expect(ones(cells(ce, 'cur'))).toEqual(vertical);
    expect(ones(snapshots[1])).toEqual(vertical);
  });

  test('a declared step(): 50 compiled calls give the cells of 50 interpreted calls', () => {
    const b = both(declared, 'tick', ['cur', 'next'], [0], 50);
    expect(b.code.cells).toEqual(b.interpreted.cells);
    expect(b.compiledEngine.snapshots).toEqual(b.interpretedEngine.snapshots);
    expect(b.compiledEngine.snapshots).toHaveLength(50);
  });

  test('length(a) before and after swap(a, b) of two counts', () => {
    const source2 = `let a = arrayFrom([1, 2, 3], "integer<0..9>")
let b = arrayFrom([4, 5], "integer<0..9>")
let f = () => do { let n = length(a); swap(a, b); n * 10 + length(a) + a[1] * 100 }`;
    const x = both(source2, 'f', ['a', 'b']);
    expect(x.code.values).toEqual([432]);
    expect(x.code).toEqual(x.interpreted);
    expect(x.code.cells).toEqual([[4, 5], [1, 2, 3]]);
  });

  test('a swap increments both versions and keeps the identities', () => {
    const source2 = `let a = arrayFrom([1, 2, 3], "integer<0..9>")
let b = arrayFrom([4, 5], "integer<0..9>")
let f = () => do { swap(a, b); 0 }`;
    const { ce } = engine(source2);
    const [a, b] = ['a', 'b'].map(
      (n) => ce.box(n).evaluate() as Expression & ArrayInterface
    );
    const [va, vb] = [a.version, b.version];
    (compile(ce.box('f').evaluate(), { to: 'javascript', fallback: false })
      .run as Run)();
    expect(ce.box('a').evaluate()).toBe(a);
    expect(ce.box('b').evaluate()).toBe(b);
    expect(a.count).toBe(2);
    expect(b.count).toBe(3);
    expect(a.version).toBeGreaterThan(va);
    expect(b.version).toBeGreaterThan(vb);
  });

  test('Swap of two cell types declines', () => {
    const { ce } = engine(`let a = arrayFrom([1, 2, 3], "integer<0..9>")
let b = arrayFrom([4, 5], "real")
let f = () => do { swap(a, b); 0 }`);
    const result = compile(ce.box('f').evaluate(), { to: 'javascript' });
    expect(result.success).toBe(false);
  });
});
