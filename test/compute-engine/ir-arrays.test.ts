/**
 * The mutable arrays of the engine (`array<T>`, a `BoxedArray`) in compiled
 * JavaScript (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 10;
 * `src/compute-engine/compilation/ir/lower-arrays.ts`): the compiled halves
 * of the acceptance cases 3a, 4a, 5, 8, 9, 10 and 14. Each value is
 * compared with the interpreter's where both have one.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { ArrayInterface } from '../../src/compute-engine/types-expression';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';
import { implicitCompile } from '../../src/compute-engine/implicit-compile';
import { executeEpsil } from '../../src/epsil';
import { createJavaScriptRuntime } from '../../src/runtime';

type Run = (...args: unknown[]) => unknown;
type Arr = Expression & ArrayInterface;

const PRELUDE = `type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>
type Raster = tuple<width: integer, height: integer, pixels: array<Byte>>
`;

/** An engine with the host function `draw`, which records its argument,
 *  and the definitions of `source`. */
function engine(source: string) {
  const ce = new ComputeEngine();
  const drawn: Expression[] = [];
  ce.declare('draw', {
    signature: '(any) -> nothing',
    evaluate: (ops) => {
      drawn.push(ops[0]);
      return ce.symbol('Nothing');
    },
  });
  const program = executeEpsil(ce, PRELUDE + source);
  const errors = program.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return { ce, drawn };
}

const fn = (ce: ComputeEngine, name: string) => ce.box(name).evaluate();

function compiled(ce: ComputeEngine, name: string) {
  const result = compile(fn(ce, name), { to: 'javascript', fallback: false });
  expect(result.success).toBe(true);
  return { result, run: result.run as Run };
}

function array(ce: ComputeEngine, name: string): Arr {
  const a = ce.box(name).evaluate();
  if (!isMutableArray(a)) throw new Error(`${name} is not an array`);
  return a;
}

const cells = (ce: ComputeEngine, name: string): number[] =>
  Array.from(array(ce, name).cells as ArrayLike<number>);

/** The number of the interpreter's value of `f(args)`. */
const interpreted = (ce: ComputeEngine, f: string, ...args: number[]) =>
  ce.box([f, ...args]).evaluate().re;

/** The message of the decline of the compilation of `name`. */
function declined(ce: ComputeEngine, name: string): string {
  const result = compile(fn(ce, name), { to: 'javascript' });
  expect(result.success).toBe(false);
  return result.diagnostic?.message ?? '';
}

describe('THE INDEX (acceptance 5)', () => {
  const source = `let a = arrayFrom([10, 20, 30], "Byte")
let x = arrayFrom([0.5, 1.5, 2.5], "real")
let s = arrayFrom([-5, 7, -9], "integer<-300..300>")
let rd = (i: real) => a[i]
let rn = (i: integer) => a[i]
let rx = (i: real) => x[i]
let rs = (i: integer) => s[i] * 2
let wr = (i: integer, v: integer) => do { a[i] = v; a[i] }
let wq = (i: real, v: integer) => do { a[i] = v; 0 }
`;

  test.each([1, 2, 3, -1, -3, 0, 4, -4, 1.5, -0.5, NaN])(
    'a[%p] is the cell or NaN, as in the interpreter',
    (i) => {
      const { ce } = engine(source);
      const run = compiled(ce, 'rd').run;
      expect(run(i)).toEqual(interpreted(ce, 'rd', i));
      expect(compiled(ce, 'rx').run(i)).toEqual(interpreted(ce, 'rx', i));
      if (Number.isInteger(i)) {
        expect(compiled(ce, 'rn').run(i)).toEqual(interpreted(ce, 'rn', i));
        expect(compiled(ce, 'rs').run(i)).toEqual(interpreted(ce, 'rs', i));
      }
    }
  );

  test('a[0], a[n + 1] and a[1.5] are NaN as the result of the function', () => {
    const { ce } = engine(source);
    const run = compiled(ce, 'rd').run;
    for (const i of [0, 4, 1.5]) {
      expect(run(i)).toBeNaN();
      expect(interpreted(ce, 'rd', i)).toBeNaN();
    }
  });

  test('a[-1] = v stores to the last cell, in both runs', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'wr').run(-1, 7)).toBe(7);
    expect(cells(ce, 'a')).toEqual([10, 20, 7]);
    const ref = engine(source).ce;
    expect(interpreted(ref, 'wr', -1, 7)).toBe(7);
    expect(cells(ref, 'a')).toEqual([10, 20, 7]);
  });

  test('a store at an index that names no cell stores nothing (decision C2)', () => {
    const { ce } = engine(source);
    const run = compiled(ce, 'wq').run;
    for (const i of [0, 4, -4, 1.5]) run(i, 99);
    expect(cells(ce, 'a')).toEqual([10, 20, 30]);
    // The interpreter's value there is the error `out-of-range`.
    expect(ce.box(['wq', 0, 99]).evaluate().toString()).toMatch(/out-of-range/);
  });

  test('a value outside the cell type is stored as JavaScript stores it', () => {
    const { ce } = engine(`${source}
let w3 = (v: integer) => do { a[1] = v; 0 }`);
    compiled(ce, 'w3').run(300);
    expect(cells(ce, 'a')[0]).toBe(300 % 256);
  });
});

describe('TUPLE CELLS (acceptance 3a)', () => {
  const source = `let px = arrayFrom(repeat(Pixel(0, 0, 0, 0), 3), "Pixel")
let st = (i: integer) => do { px[i] = Pixel(1, 2, 3, 4); px[i].g }
let eq = (i: integer) => px[i] == Pixel(1, 2, 3, 4)
let whole = (i: integer) => px[i]
let blue = (i: real) => px[i].b
let sum4 = (i: integer) => do { let p = px[i]; p.r + p.g + p.b + p.a }
`;

  test('a store writes the four bytes, and a field read is one byte', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'st').run(2)).toBe(2);
    expect(cells(ce, 'px')).toEqual([0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
    const ref = engine(source).ce;
    expect(interpreted(ref, 'st', 2)).toBe(2);
    expect(cells(ref, 'px')).toEqual(cells(ce, 'px'));
  });

  test('a cell equals a constant pixel, in both runs', () => {
    const { ce } = engine(source);
    compiled(ce, 'st').run(2);
    const run = compiled(ce, 'eq').run;
    expect([run(1), run(2), run(-2)]).toEqual([false, true, true]);
    const ref = engine(source).ce;
    ref.box(['st', 2]).evaluate();
    expect(
      ['eq', 1, 2, -2].slice(1).map((i) => ref.box(['eq', i]).evaluate().json)
    ).toEqual(['False', 'True', 'True']);
  });

  test('the read of a cell is the tuple, a tuple of NaN out of range', () => {
    const { ce } = engine(source);
    compiled(ce, 'st').run(1);
    const run = compiled(ce, 'whole').run;
    expect(run(1)).toEqual({ r: 1, g: 2, b: 3, a: 4 });
    expect(ce.box(['whole', 1]).evaluate().json).toEqual(['Pixel', 1, 2, 3, 4]);
    const out = run(0) as Record<string, number>;
    expect(Object.values(out).every(Number.isNaN)).toBe(true);
    expect(ce.box(['whole', 0]).evaluate().json).toEqual([
      'Tuple',
      'NaN',
      'NaN',
      'NaN',
      'NaN',
    ]);
  });

  test('an element of a cell at an index on the real lane', () => {
    const { ce } = engine(source);
    compiled(ce, 'st').run(3);
    const run = compiled(ce, 'blue').run;
    for (const i of [3, -1, 1, 0, 4, 2.5])
      expect(run(i)).toEqual(interpreted(ce, 'blue', i));
    expect(compiled(ce, 'sum4').run(3)).toBe(10);
    expect(interpreted(ce, 'sum4', 3)).toBe(10);
  });

  test('a read of one element reads one byte, and a store builds no tuple', () => {
    const { ce } = engine(source);
    const { result } = compiled(ce, 'st');
    expect(result.code.match(/_cells\[/g)).toHaveLength(5);
    expect(result.code).not.toMatch(/\[1, 2, 3, 4\]/);
  });
});

describe('A RANGE OR A LIST AS THE INDEX (acceptance 4a)', () => {
  const source = `let a = arrayFrom([10, 20, 30, 40, 50], "Byte")
let r1 = () => a[2..4]
let r2 = () => a[[1, 3, 5]]
let r3 = () => a[4..7]
let r4 = () => a[4..2]
let r5 = () => a[[true, false, true]]
let r6 = () => do { let s = a[2..4]; a[2] = 99; s }
let r7 = () => listFrom(a)
let r8 = () => sum(listFrom(a)) + length(a)
`;

  test.each(['r1', 'r2', 'r3', 'r4', 'r5', 'r7', 'r8'])(
    '%s gives the list of the interpreter',
    (name) => {
      const { ce } = engine(source);
      const got = compiled(ce, name).run();
      const want = ce.box([name]).evaluate();
      expect(JSON.stringify(got)).toEqual(
        JSON.stringify(
          want.operator === 'List' ? want.ops.map((x) => x.re) : want.re
        )
      );
    }
  );

  test('the values of the ranges', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'r1').run()).toEqual([20, 30, 40]);
    expect(compiled(ce, 'r2').run()).toEqual([10, 30, 50]);
    expect(compiled(ce, 'r3').run()).toEqual([40, 50, NaN, NaN]);
    expect(compiled(ce, 'r4').run()).toEqual([]);
    const backwards = compile(
      ce.box(['Function', ['At', 'a', ['Range', 4, 2]]]),
      {
        to: 'javascript',
        fallback: false,
      }
    );
    expect((backwards.run as Run)()).toEqual([40, 30, 20]);
  });

  test('a later store does not change a list read before it', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'r6').run()).toEqual([20, 30, 40]);
    expect(cells(ce, 'a')[1]).toBe(99);
  });

  test('a range as the index of tuple cells declines', () => {
    const { ce } =
      engine(`let px = arrayFrom(repeat(Pixel(0, 0, 0, 0), 3), "Pixel")
let f = () => px[1..2]`);
    expect(declined(ce, 'f')).toMatch(
      /a range or a list as the index of an array of tuple cells/
    );
  });
});

describe('ONE STORAGE (acceptance 9)', () => {
  const source = `let board = arrayFrom(repeat(0, 4), "Byte")
let other = arrayFrom(repeat(0, 4), "Byte")
let put = (i: integer, v: integer) => do { board[i] = v; 0 }
let putDraw = (i: integer, v: integer) => do { board[i] = v; draw(1) }
`;

  test('a compiled store is the cell of the engine, with no copy', () => {
    const { ce } = engine(source);
    const before = array(ce, 'board').cells;
    const { result, run } = compiled(ce, 'put');
    expect(result.arrays).toEqual(['board']);
    expect(result.symbolDeps ?? []).not.toContain('board');
    run(2, 7);
    expect(ce.box(['At', 'board', 2]).evaluate().re).toBe(7);
    expect(array(ce, 'board').cells).toBe(before);
    expect(Array.from(before)).toEqual([0, 7, 0, 0]);
  });

  test('an interpreted assignment of the name is seen by the next call', () => {
    const { ce } = engine(source);
    const run = compiled(ce, 'put').run;
    run(1, 5);
    ce.box(['Assign', 'board', 'other']).evaluate();
    run(1, 6);
    expect(cells(ce, 'other')).toEqual([6, 0, 0, 0]);
    expect(cells(ce, 'board')).toEqual([6, 0, 0, 0]);
    expect(array(ce, 'board')).toBe(array(ce, 'other'));
  });

  test('a name that holds no array of the cell type throws a TypeError', () => {
    // A name declared `any`, so that the interpreter assigns it an array of
    // another cell type.
    const { ce } = engine(`let board: any = arrayFrom(repeat(0, 4), "Byte")
let put = (i: integer, v: integer) => do { board[i] = v; 0 }
let wide = arrayFrom(repeat(0, 4), "real")`);
    const run = compiled(ce, 'put').run;
    ce.box(['Assign', 'board', 'wide']).evaluate();
    expect(() => run(1, 1)).toThrow(/board.*array<integer<0..255>>/);
  });

  test('the state event is registered before the host function runs, and at the return', () => {
    const { ce, drawn } = engine(source);
    const run = compiled(ce, 'putDraw').run;
    const epoch = ce._objectStoreEpoch;
    const events = jest.spyOn(ce, '_noteStateEvent');
    let seen = -1;
    // The epoch that the host function sees when it runs.
    const draw = ce.lookupDefinition('draw') as {
      operator: { evaluate: unknown };
    };
    const evaluate = draw.operator.evaluate as (...a: unknown[]) => unknown;
    draw.operator.evaluate = (...a: unknown[]) => {
      seen = ce._objectStoreEpoch;
      return evaluate(...a);
    };
    run(1, 3);
    expect(seen).toBe(epoch + 1);
    expect(drawn).toHaveLength(1);
    expect(ce._objectStoreEpoch).toBe(epoch + 2);
    const stores = events.mock.calls.filter(
      (c) => c[0].kind === 'object-store'
    );
    expect(stores).toHaveLength(2);
  });

  test('a unit that only reads registers no event', () => {
    const { ce } = engine(`${source}
let get = (i: integer) => board[i]`);
    const run = compiled(ce, 'get').run;
    const epoch = ce._objectStoreEpoch;
    run(1);
    expect(ce._objectStoreEpoch).toBe(epoch);
  });
});

describe('THE VERSION AND THE CACHES (acceptance 8)', () => {
  test('a memoized pure function gives the new cell after a compiled store', () => {
    const { ce } = engine(`let a = arrayFrom([1, 2, 3], "Byte")
function first(x) { x[1] }
let put = (v: integer) => do { a[1] = v; 0 }`);
    const a = array(ce, 'a');
    expect(ce.box(['first', 'a']).evaluate().re).toBe(1);
    expect(ce.box(['first', 'a']).evaluate().re).toBe(1);
    const version = a.version;
    compiled(ce, 'put').run(9);
    expect(a.version).toBeGreaterThan(version);
    expect(ce.box(['first', 'a']).evaluate().re).toBe(9);
  });
});

describe('THE HOST (acceptance 10)', () => {
  test('a compiled draw(image(r)) passes the array by reference', () => {
    const { ce, drawn } =
      engine(`let scr = Raster(2, 2, arrayFrom(repeat(0, 4), "Byte"))
function image(r) { Raster(r.width, r.height, r.pixels) }
let frame = (t: real) => draw(image(scr))`);
    const { result, run } = compiled(ce, 'frame');
    expect(result.symbolDeps ?? []).not.toContain('pixels');
    run(0);
    expect(drawn).toHaveLength(1);
    const figure = drawn[0];
    expect(figure.operator).toBe('Raster');
    const pixels = ce.box(['Field', 'scr', { str: 'pixels' }]).evaluate();
    expect(figure.ops[2]).toBe(pixels);
    // The interpreter passes the same array.
    ce.box(['frame', 0]).evaluate();
    expect(drawn[1].ops[2]).toBe(pixels);
  });

  test('an array argument of a host function is the engine array', () => {
    const { ce, drawn } = engine(`let a = arrayFrom([1, 2], "Byte")
let f = (t: real) => do { a[1] = 5; draw(a) }`);
    compiled(ce, 'f').run(0);
    expect(drawn[0]).toBe(array(ce, 'a'));
  });
});

describe('THE ENTRY AND THE RESULT', () => {
  test('a parameter declared array<T> takes the engine array, checked once per call', () => {
    const { ce } = engine(`let a = arrayFrom([1, 2, 3], "Byte")
let b = arrayFrom([1, 2, 3], "real")
let f = (x: array<Byte>, i: integer) => do { x[i] += 3; x[i] }`);
    const run = compiled(ce, 'f').run;
    expect(run(array(ce, 'a'), 2)).toBe(5);
    expect(cells(ce, 'a')).toEqual([1, 5, 3]);
    expect(() => run(array(ce, 'b'), 2)).toThrow(TypeError);
    expect(() => run([1, 2, 3], 2)).toThrow(
      /argument 1 was compiled as an array<integer<0..255>>/
    );
    const unchecked = compile(fn(ce, 'f'), {
      to: 'javascript',
      fallback: false,
      entryChecks: false,
    });
    expect((unchecked.run as Run)(array(ce, 'a'), 1)).toBe(4);
  });

  test('an input declared array<T> with no value', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'array<integer<0..255>>');
    ce.declare('i', 'integer');
    const result = compile(ce.box(['Add', ['At', 'A', 'i'], 1]), {
      to: 'javascript',
      fallback: false,
    });
    expect(result.freeSymbols).toEqual(['A', 'i']);
    expect(result.freeSymbolTypes?.A.lowered).toBe('mutable-array');
    const a = ce
      .box(['ArrayFrom', ['List', 4, 5], { str: 'integer<0..255>' }])
      .evaluate();
    expect((result.run as Run)({ A: a, i: 2 })).toBe(6);
    expect(() => (result.run as Run)({ A: [4, 5], i: 2 })).toThrow(TypeError);
  });

  test('the code is not shippable, load() refuses it, and the engine interprets it', () => {
    const { ce } = engine(`let a = arrayFrom([1, 2, 3], "Byte")
let f = (i: integer) => a[i]
let g = (x: array<Byte>, i: integer) => x[i]`);
    const runtime = createJavaScriptRuntime();
    for (const name of ['f', 'g']) {
      const { result } = compiled(ce, name);
      expect(result.shippable).toBe(false);
      expect(() => runtime.load(result as never)).toThrow();
      expect(implicitCompile(ce, fn(ce, name), 'map')).toBeUndefined();
    }
    expect(compiled(ce, 'g').result.arrays).toEqual([]);
  });

  test('ArrayFrom of compiled code is the engine construction', () => {
    const { ce } =
      engine(`let f = (n: integer) => do { let z = arrayFrom(repeat(5, n), "Byte"); z[2] = 9; z[1] + z[2] + length(z) }
let g = (n: integer) => do { let z = arrayFrom([1, 2, n], "Byte"); let y = arrayFrom(z); y[1] = 7; z[1] + y[1] + y[3] }`);
    const created: Expression[] = [];
    const asked: number[][] = [];
    ce.arrayCreated = (a) => void created.push(a);
    ce.arrayAllocation = (count, bytes) => (asked.push([count, bytes]), true);
    expect(compiled(ce, 'f').run(3)).toBe(17);
    expect(interpreted(ce, 'f', 3)).toBe(17);
    expect(compiled(ce, 'g').run(4)).toBe(12);
    expect(interpreted(ce, 'g', 4)).toBe(12);
    expect(created.length).toBe(6);
    expect(asked[0]).toEqual([3, 1]);
    ce.arrayAllocation = () => false;
    expect(() => compiled(ce, 'f').run(3)).toThrow(/array-allocation-refused/);
  });
});

describe('HOW AN ARRAY REACHES THE CODE (spec section 10.2)', () => {
  const source = `let a = arrayFrom([1, 2, 3], "Byte")
let b = arrayFrom([7, 8], "Byte")
let scr = Raster(3, 1, arrayFrom([4, 5, 6], "Byte"))
let at = (x, k) => x[k]
let local = (k: integer) => do { let px = scr.pixels; px[k] = 9; px = a; px[k] + scr.pixels[k] }
let arms = (c: boolean, k: integer) => (if c { a } else { b })[k]
let helper = (k: integer) => at(a, k) + at(scr.pixels, k)
`;

  test('a block local, also one that the block assigns another array', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'local').run(2)).toBe(11);
    const ref = engine(source).ce;
    expect(interpreted(ref, 'local', 2)).toBe(11);
  });

  test('the two arms of an If', () => {
    const { ce } = engine(source);
    const run = compiled(ce, 'arms').run;
    expect([run(true, 1), run(false, 2), run(false, 3)]).toEqual([1, 8, NaN]);
    const want = [
      ['True', 1],
      ['False', 2],
      ['False', 3],
    ].map(([c, k]) => ce.box(['arms', c, k]).evaluate().re);
    expect(want).toEqual([1, 8, NaN]);
  });

  test('a user function of a lambda called by its name', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'helper').run(1)).toBe(interpreted(ce, 'helper', 1));
  });

  test('a name that holds an array is not a dependency; a value that holds one is', () => {
    const { ce } = engine(source);
    const deps = new Set<string>();
    compile(fn(ce, 'helper'), {
      to: 'javascript',
      fallback: false,
      symbolDeps: deps,
    });
    expect(deps.has('a')).toBe(false);
    expect(deps.has('scr')).toBe(true);
  });
});

describe('THE EMITTED CODE', () => {
  test('a read and a store', () => {
    const { ce } = engine(
      `let f = (a: array<Byte>, i: integer, v: integer) => do { a[i] = v; a[i] }`
    );
    expect(compiled(ce, 'f').result.code).toMatchInlineSnapshot(`
      "(a0, a1, a2, _ = {}) => {
        const v3 = (a0._version++, a0._cells[a1 > 0 ? a1 - 1 : a0._cells.length + a1] = a2);
        const v4 = (+a0._cells[a1 > 0 ? a1 - 1 : a0._cells.length + a1]);
        return v4;
      }"
    `);
  });
});

describe('THE DECLINES (acceptance 14)', () => {
  const source = `let a = arrayFrom(repeat(0, 10), "Byte")
let b = arrayFrom(repeat(0, 10), "Byte")
let e = arrayFrom([1, 2], "rational")
let d1 = (i: integer) => e[i]
let d2 = (x: array, i: integer) => 2
let d3 = (i: integer) => a
let d4 = (i: integer) => (a, i)
let d5 = (n: integer) => sum(map(k => a[k], 1..n))
let d6 = (i: integer) => [a, b][1][i]
let d7 = (n: integer) => do { let s = 0; parallel for k in 1..n { s += a[k] }; s }
let d8 = (i: integer) => do { a[i] = 0.5; 1 }
let d9 = (i: integer) => do { a[i] = true; 1 }
let d10 = (n: integer) => reduce(1..n, (s, k) => s + a[k], 0)
let d11 = (i: integer, v: integer) => do { a = b; 0 }
let ok = (i: integer) => a[i] + 1
`;

  test.each([
    ['d1', /an array of expression cells \(array<rational>\)/],
    ['d2', /a value of the bare type array/],
    ['d3', /an array as the result of the compiled code/],
    ['d4', /an array as the result of the compiled code/],
    ['d5', /in the body of a function literal that is an operand or a value/],
    ['d6', /a list or a tuple of arrays/],
    ['d7', /an array in a parallel for/],
    ['d8', /a store of a value of type real in an array<integer<0..255>>/],
    ['d9', /a store of a value of type boolean/],
    ['d10', /in the body of a function literal that is an operand or a value/],
  ])('%s declines: %p', (name, message) => {
    const { ce } = engine(source);
    expect(declined(ce, name)).toMatch(message);
  });

  test('an assignment of a name that holds an array compiles (section 10.7)', () => {
    const { ce } = engine(source);
    const result = compile(fn(ce, 'd11'), { to: 'javascript', fallback: false });
    expect(result.assigns).toEqual(['a']);
    expect((result.run as Run)(1, 2)).toBe(0);
    expect(array(ce, 'a')).toBe(array(ce, 'b'));
  });

  test('a declined function runs on the interpreter with fallback', () => {
    const { ce } = engine(source);
    const d5 = compile(fn(ce, 'd5'), { to: 'javascript' });
    ce.box(['Assign', ['At', 'a', 2], 4]).evaluate();
    expect((d5.run as Run)(3)).toEqual(interpreted(ce, 'd5', 3));
    expect((d5.run as Run)(3)).toBe(4);
    const d8 = compile(fn(ce, 'd8'), { to: 'javascript' });
    expect(d8.success).toBe(false);
  });

  test('a host function whose result is an array declines', () => {
    const { ce } = engine('let a = arrayFrom([1], "Byte")');
    ce.declare('load', {
      signature: '(real) -> array<integer<0..255>>',
      evaluate: () => array(ce, 'a'),
    });
    executeEpsil(ce, 'let f = (t: real) => load(t)[1]');
    expect(declined(ce, 'f')).toMatch(
      /of type array<integer<0..255>>, not real/
    );
  });

  test.each([
    [{ to: 'interval-js' }],
    [{ to: 'javascript', mode: 'bigint' }],
    [{ to: 'javascript', mode: 'complex' }],
    [{ to: 'glsl' }],
  ])('%p declines an array', (options) => {
    const { ce } = engine(source);
    const result = compile(fn(ce, 'ok'), { ...(options as object) } as never);
    expect(result.success).toBe(false);
    expect(result.diagnostic?.message).toMatch(
      /an array \(array<T>\), which compiles on javascript in the default mode only/
    );
  });
});

describe('THE DISCHARGES OF A CELL', () => {
  const source = `let px = arrayFrom(repeat(Pixel(1, 2, 3, 4), 2), "Pixel")
let q = arrayFrom(repeat((1, 2, 3, 4), 2), "tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>")
let a = arrayFrom([10, 20], "Byte")
let x = arrayFrom([0.5, 1.5], "real")
let pm = (i: integer) => isMissing(px[i])
let pc = (i: integer) => (px[i] ?? Pixel(9, 9, 9, 9)).r
let ps = (i: integer) => (px[i]?!).r
let qm = (i: integer) => isMissing(q[i])
let qc = (i: integer) => (q[i] ?? (9, 9, 9, 9))[1]
let am = (i: integer) => isMissing(a[i])
let ac = (i: integer) => a[i] ?? 7
let as = (i: integer) => a[i]?!
let xm = (i: real) => isMissing(x[i])
let xc = (i: real) => x[i] ?? 7
let xs = (i: real) => x[i]?!
function getPixel(i: integer) { px[i] }
let fm = (i: integer) => isMissing(getPixel(i))
let im = (i: integer) => isMissing(if i > 0 { px[i] } else { px[1] })
let lm = (i: integer) => isMissing(Pixel(1, 2, 3, 4))
function hm(p) { isMissing(p) }
function hc(p) { (p ?? Pixel(9, 9, 9, 9)).r }
function ha(p: any) { isMissing(p) }
let um = (i: integer) => hm(px[i])
let uc = (i: integer) => hc(px[i])
let ua = (i: integer) => ha(px[i])
`;

  // `fm` reads the cell through a user function and `im` through an arm of
  // an `If`: the record is then not known as the read of a cell, so every
  // record of a type that is a tuple cell declines, a literal too (`lm`).
  // `um`, `uc` and `ua` give the read to a function whose parameter has no
  // type, or the type `any`: the record of the code still names its type.
  test.each(['pm', 'pc', 'ps', 'fm', 'im', 'lm', 'um', 'uc', 'ua'])(
    '%s, a discharge of a value of a nominal type that is a tuple cell, declines',
    (name) => {
      const { ce } = engine(source);
      expect(declined(ce, name)).toMatch(
        /of a value of a nominal type that is a tuple cell \(array<Pixel>\)/
      );
    }
  );

  test('a cell read through a user function is absent out of range in the interpreter', () => {
    const { ce } = engine(source);
    expect(ce.box(['fm', 9]).evaluate().json).toBe('True');
    expect(ce.box(['fm', 1]).evaluate().json).toBe('False');
  });

  test('the interpreter reads the nominal tuple cell out of range as absent', () => {
    const { ce } = engine(source);
    expect(ce.box(['pm', 3]).evaluate().json).toBe('True');
    expect(ce.box(['pc', 3]).evaluate().re).toBe(9);
    expect(ce.box(['ps', 3]).evaluate().toString()).toMatch(/expected-present/);
  });

  test.each(['qm', 'qc', 'am', 'ac', 'as', 'xm', 'xc', 'xs'])(
    '%s gives the value of the interpreter in and out of range',
    (name) => {
      const { ce } = engine(source);
      const run = compiled(ce, name).run;
      const indexes = name.startsWith('x') ? [1, -1, 0, 3, 1.5] : [1, -1, 0, 3];
      for (const i of indexes) {
        const want = ce.box([name, i]).evaluate();
        if (want.operator === 'Error') {
          expect(want.toString()).toMatch(/expected-present/);
          expect(() => run(i)).toThrow(/expected-present/);
        } else
          expect(run(i)).toEqual(
            want.json === 'True'
              ? true
              : want.json === 'False'
                ? false
                : want.re
          );
      }
    }
  );
});

describe('THE STORED CODE (load)', () => {
  test('code whose only array is a parameter, with entryChecks false', () => {
    const { ce } = engine(
      'let f = (a: array<Byte>, i: integer) => do { a[i] = 1; 0 }'
    );
    const result = compile(fn(ce, 'f'), {
      to: 'javascript',
      fallback: false,
      entryChecks: false,
    });
    expect(result.success).toBe(true);
    expect(() => createJavaScriptRuntime().load(result as never)).toThrow(
      /reads or writes a mutable array of the engine \(array<T>\): it cannot be loaded/
    );
  });

  test('the message names the array, not a value kind', () => {
    const { ce } = engine(`let a = arrayFrom([1, 2, 3], "Byte")
let f = (i: integer) => a[i]
let g = (x: array<Byte>, i: integer) => x[i]`);
    for (const name of ['f', 'g'])
      expect(() =>
        createJavaScriptRuntime().load(compiled(ce, name).result as never)
      ).toThrow(
        /^The stored code reads or writes a mutable array of the engine/
      );
  });

  test('the batch loaders refuse an expression that reads an array input', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'array<integer<0..255>>');
    ce.declare('i', 'integer');
    const result = compile(ce.box(['Add', ['At', 'A', 'i'], 1]), {
      to: 'javascript',
      fallback: false,
      entryChecks: false,
    });
    expect(result.success).toBe(true);
    const runtime = createJavaScriptRuntime();
    expect(() => runtime.loadBroadcast(result as never)).toThrow(
      /mutable array of the engine/
    );
    expect(() => runtime.loadBroadcastSlice(result as never)).toThrow(
      /mutable array of the engine/
    );
  });
});

describe('A LOCAL HELPER IN A CALLBACK', () => {
  test('a block-local function literal does not compile, and the fallback gives the interpreter value', () => {
    const source = `let a = arrayFrom([1, 2, 3], "Byte")
let f = (n: integer) => do { let get = (k) => a[k]; let L = map(k => get(k), 1..n); a[1] = 9; L[1] }`;
    const { ce } = engine(source);
    expect(declined(ce, 'f')).toMatch(
      /a function value that is not the program or the literal of a Map/
    );
    const ref = engine(source).ce;
    expect(interpreted(ref, 'f', 3)).toBe(1);
    const run = compile(fn(ce, 'f'), { to: 'javascript' }).run as Run;
    expect(run(3)).toBe(1);
  });
});

describe('A STORE OF A LIST IN A TUPLE CELL', () => {
  const source = `let q = arrayFrom(repeat((0, 0, 0, 0), 2), "tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>")
let wl = (i: integer) => do { q[i] = [5, 6, 7, 8]; 0 }
let wt = (i: integer) => do { q[i] = (5, 6, 7, 8); 0 }
`;

  test('a list declines (the interpreter gives incompatible-type)', () => {
    const { ce } = engine(source);
    expect(declined(ce, 'wl')).toMatch(
      /a store of a value of type .* in an array<tuple</
    );
    expect(ce.box(['wl', 1]).evaluate().toString()).toMatch(
      /incompatible-type/
    );
    expect(cells(ce, 'q')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('a tuple is stored', () => {
    const { ce } = engine(source);
    compiled(ce, 'wt').run(2);
    expect(cells(ce, 'q')).toEqual([0, 0, 0, 0, 5, 6, 7, 8]);
  });
});

describe('AN INDEX ON THE REAL LANE THAT ROUNDS', () => {
  const source = `let a = arrayFrom([1, 2, 3, 4, 5, 6, 7, 8], "Byte")
let x = arrayFrom([1, 2, 3, 4, 5, 6, 7, 8], "real")
let ra = (i: real) => a[i]
let rx = (i: real) => x[i]
let wa = (i: real) => do { a[i] = 99; 0 }
let wx = (i: real) => do { x[i] = 99; 0 }
`;
  const i = -0.9999999999999999;

  test('8 + i is 7 in floating point', () => expect(8 + i).toBe(7));

  test('a read is NaN, as in the interpreter', () => {
    const { ce } = engine(source);
    for (const name of ['ra', 'rx']) {
      expect(compiled(ce, name).run(i)).toBeNaN();
      expect(interpreted(ce, name, i)).toBeNaN();
      expect(compiled(ce, name).run(-1)).toBe(8);
    }
  });

  test('a store writes nothing (the interpreter gives out-of-range)', () => {
    const { ce } = engine(source);
    for (const [name, arr] of [
      ['wa', 'a'],
      ['wx', 'x'],
    ]) {
      compiled(ce, name).run(i);
      expect(cells(ce, arr)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(ce.box([name, i]).evaluate().toString()).toMatch(/out-of-range/);
      compiled(ce, name).run(-1);
      expect(cells(ce, arr)[7]).toBe(99);
    }
  });

  test('the emitted code tests the index for an integer', () => {
    const { ce } = engine(
      `let f = (a: array<Byte>, i: real, v: integer) => do { a[i] = v; a[i] }`
    );
    expect(compiled(ce, 'f').result.code).toMatchInlineSnapshot(`
      "(a0, a1, a2, _ = {}) => {
        const v3 = (a0._version++, a0._cells[Number.isInteger(a1) ? (a1 > 0 ? a1 - 1 : a0._cells.length + a1) : -1] = a2);
        const v4 = (+a0._cells[Number.isInteger(a1) ? (a1 > 0 ? a1 - 1 : a0._cells.length + a1) : -1]);
        return v4;
      }"
    `);
  });
});

describe('A BODY THAT ENDS IN A STORE OR A LOOP', () => {
  // The value of the root literal is `Nothing`, which the code gives as NaN
  // (`nothingPlace()`); the cells are those of the interpreter.
  const source = `let screen = arrayFrom(repeat(0, 4), "integer<0..255>")
let st = (k: integer, v: integer) => do { screen[1] = 1; screen[k] = v }
let lp = (t: integer) => do { for k in 1..4 { screen[k] = t } }
let wh = (t: integer) => do { let k = 1; while (k <= 4) { screen[k] = t; k = k + 1 } }
function z() { screen[2] = 1 }
let zc = (t: integer) => do { z(); screen[3] = t; 0 }
function fill(t: integer) { for k in 1..4 { screen[k] = t } }
let fc = (t: integer) => do { fill(t) }
let rd = (t: integer) => do { let x = do { for k in 1..4 { screen[k] = t } }; 1 }
let hd = (n: integer) => do { for k in 1..n { draw(k) } }
`;

  const same = (name: string, args: number[], want: number[]) => {
    const { ce } = engine(source);
    expect(ce.box([name, ...args]).evaluate().symbol).toBe('Nothing');
    expect(cells(ce, 'screen')).toEqual(want);
    const { ce: ce2 } = engine(source);
    expect(compiled(ce2, name).run(...args)).toBeNaN();
    expect(cells(ce2, 'screen')).toEqual(want);
  };

  test('a block that ends in a store', () => same('st', [3, 2], [1, 0, 2, 0]));

  test('a block that ends in a for loop of stores', () =>
    same('lp', [7], [7, 7, 7, 7]));

  test('a block that ends in a while loop', () =>
    same('wh', [5], [5, 5, 5, 5]));

  test('a root literal whose body is one loop', () => {
    const { ce } = engine(source);
    const g = ce
      .box([
        'Function',
        [
          'Loop',
          ['Block', ['Assign', ['At', 'screen', 'k'], 't']],
          ['Element', 'k', ['Range', 1, 4, 1]],
        ],
        ['Typed', 't', "'integer'"],
      ])
      .evaluate();
    const result = compile(g, { to: 'javascript', fallback: false });
    expect(result.success).toBe(true);
    expect((result.run as Run)(6)).toBeNaN();
    expect(cells(ce, 'screen')).toEqual([6, 6, 6, 6]);
  });

  test('a user function that ends in a store, called as a statement', () => {
    const { ce } = engine(source);
    expect(compiled(ce, 'zc').run(4)).toBe(0);
    expect(cells(ce, 'screen')).toEqual([0, 1, 4, 0]);
  });

  test('a user function that ends in a loop, called last', () =>
    same('fc', [9], [9, 9, 9, 9]));

  test('a loop whose value is read declines', () => {
    const { ce } = engine(source);
    expect(declined(ce, 'rd')).toMatch(/the value of a Loop \(Nothing\)/);
  });

  test('a loop of host calls with no array', () => {
    const { ce, drawn } = engine(source);
    expect(compiled(ce, 'hd').run(5)).toBeNaN();
    expect(drawn.map((x) => x.re)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('A PARAMETER DECLARED AS AN ARRAY', () => {
  /** `f(…args)` compiled on one engine and interpreted on another: both
   *  values, and the cells of `a` and `b` in each engine after the call. */
  const both = (source: string, args: number[]) => {
    const c = engine(source);
    const i = engine(source);
    const code = compiled(c.ce, 'f').run(...args);
    const value = interpreted(i.ce, 'f', ...args);
    const names = ['a', 'b'];
    return {
      code: [code, ...names.map((n) => cells(c.ce, n))],
      interpreted: [value, ...names.map((n) => cells(i.ce, n))],
    };
  };
  const arrays = `let a = arrayFrom([5, 6, 7], "Byte")
let b = arrayFrom([1, 2], "Byte")
`;

  test.each([
    ['a function', 'function g(x: array<Byte>, i: integer) { x[i] }'],
    [
      'a function of a declared result',
      'function g(x: array<Byte>, i: integer) -> integer { x[i] }',
    ],
    ['a function literal', 'let g = (x: array<Byte>, i: integer) => x[i]'],
  ])('a read through %s', (_, g) => {
    const r = both(arrays + g + '\nlet f = (i: integer) => g(a, i)', [2]);
    expect(r.code[0]).toBe(6);
    expect(r.code).toEqual(r.interpreted);
  });

  test('a store goes to the cells of the argument', () => {
    const r = both(
      arrays +
        `function set(x: array<Byte>, i: integer, v: integer) { x[i] = v }
let f = (i: integer) => do { set(a, i, 9); a[i] }`,
      [2]
    );
    expect(r.code).toEqual([9, [5, 9, 7], [1, 2]]);
    expect(r.code).toEqual(r.interpreted);
  });

  test('a function called with two arrays', () => {
    const r = both(
      arrays +
        `function set(x: array<Byte>, i: integer, v: integer) { x[i] = v; length(x) }
let f = (i: integer) => do { let n = set(a, i, 9); let m = set(b, 1, 4); n * 10 + m + a[i] + b[1] }`,
      [3]
    );
    expect(r.code).toEqual([45, [5, 6, 9], [4, 2]]);
    expect(r.code).toEqual(r.interpreted);
  });

  test('an array given through a field of a record', () => {
    const r = both(
      arrays +
        `let r = Raster(3, 1, a)
function set(x: array<Byte>, i: integer, v: integer) { x[i] = v }
let f = (i: integer) => do { set(r.pixels, i, 8); a[i] + r.pixels[i] }`,
      [1]
    );
    expect(r.code).toEqual([16, [8, 6, 7], [1, 2]]);
    expect(r.code).toEqual(r.interpreted);
  });

  test('a function that calls the host', () => {
    const source =
      arrays +
      `let s = 0
function show(x: array<Byte>, i: integer) scope { s = s + x[i]; draw(x); s }
let f = (i: integer) => do { a[i] = 3; let p = show(a, i); let q = show(b, 1); p * 10 + q }`;
    const c = engine(source);
    const run = compiled(c.ce, 'f').run;
    const i = engine(source);
    expect(run(2)).toBe(interpreted(i.ce, 'f', 2));
    expect(c.ce.box('s').evaluate().re).toBe(i.ce.box('s').evaluate().re);
    expect(c.drawn).toHaveLength(2);
    expect(c.drawn[0] === array(c.ce, 'a')).toBe(true);
    expect(c.drawn[1] === array(c.ce, 'b')).toBe(true);
  });

  test('a function given by name to Map declines', () => {
    const { ce } = engine(
      arrays +
        `function g(x: array<Byte>) { length(x) }
let f = (i: integer) => sum(map(g, [a, b])) + i`
    );
    expect(declined(ce, 'f')).toMatch(/a list or a tuple of arrays/);
  });

  test('a parameter of expression cells or of the bare type array declines', () => {
    const { ce } = engine(`let e = arrayFrom([1, 2], "rational")
let a = arrayFrom([5, 6, 7], "Byte")
function g(x: array<rational>, i: integer) { 1 }
function h(x: array, i: integer) { 1 }
let f = (i: integer) => g(e, i)
let k = (i: integer) => h(a, i)`);
    expect(declined(ce, 'f')).toMatch(/an array of expression cells/);
    expect(declined(ce, 'k')).toMatch(/the bare type array/);
  });
});
