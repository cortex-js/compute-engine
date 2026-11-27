/**
 * An array whose cells the host keeps elsewhere (CE-1893): `markStale(fetch)`
 * records that the cells are out of date, and the engine runs the fetch once,
 * at the next access of the cells, in the interpreter, through `cells` and in
 * compiled JavaScript (`docs/COMPILATION-MODEL.md`, "Arrays").
 */
import { compile } from '../../src/compile';
import { ComputeEngine, isMutableArray } from '../../src/compute-engine';
import type { ArrayInterface, Expression } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';
import {
  BoxedArray,
  dropCollectedStale,
  staleArrays,
} from '../../src/compute-engine/boxed-expression/boxed-array';

type Arr = Expression & ArrayInterface;
type Run = (...args: unknown[]) => unknown;

const BYTE = 'integer<0..255>';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** The value of the Epsil program `source`, with no error. */
function epsil(source: string): Expression {
  const { value, diagnostics } = executeEpsil(ce, source);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((d) => d.message).join());
  return value!;
}

/** The compiled function of the Epsil function literal `source`. */
function compiled(source: string): Run {
  const result = compile(epsil(source), {
    to: 'javascript',
    fallback: false,
    constantFold: false,
  });
  expect(result.success).toBe(true);
  return result.run as Run;
}

function asArray(x: Expression): Arr {
  if (!isMutableArray(x)) throw new Error(`no array: ${x.toString()}`);
  return x;
}

/** A fetch that copies `device` into the cells and counts its calls. */
function deviceFetch(device: Uint8Array) {
  const fetch = jest.fn((a: ArrayInterface) => {
    (a.cells as Uint8Array).set(device);
  });
  return fetch;
}

const value = (x: Expression): unknown => x.evaluate().valueOf();

describe('ACCEPTANCE (CE-1893)', () => {
  test('an alias and a compiled reader see the device bytes, and a CPU store keeps the other cell', () => {
    const type = `array<${BYTE}>`;
    const board = ce.array(new Uint8Array([10, 20]), BYTE);
    ce.declare('board', { type, value: board });
    ce.declare('aliasBoard', { type, value: board });
    // The control: an ordinary array, never marked.
    const plain = ce.array(new Uint8Array([1, 2]), BYTE);
    ce.declare('plain', { type, value: plain });

    const reader = compiled(`(cells: array<${BYTE}>, i: integer) => cells[i]`);
    const writer = compiled(
      `(cells: array<${BYTE}>, i: integer, v: integer) => do { cells[i] = v }`
    );
    const alias = (i: number) => ce.box(['At', 'aliasBoard', i]);
    expect(reader(board, 1)).toBe(10);
    expect(value(alias(1))).toBe(10);

    // The device publishes new bytes.
    const v0 = board.version;
    board.markStale(deviceFetch(Uint8Array.of(30, 40)));
    expect(board.stale).toBe(true);
    expect(board.version).toBe(v0 + 1);
    expect(value(alias(1))).toBe(30);
    expect(board.stale).toBe(false);
    expect(reader(board, 1)).toBe(30);

    // An interpreted store of cell 1 keeps the device value of cell 2.
    board.markStale(deviceFetch(Uint8Array.of(50, 60)));
    ce.box(['Assign', ['At', 'aliasBoard', 1], 5]).evaluate();
    expect(Array.from(board.cells as Uint8Array)).toEqual([5, 60]);
    expect(reader(board, 2)).toBe(60);

    // A compiled store of cell 2 keeps the device value of cell 1.
    board.markStale(deviceFetch(Uint8Array.of(70, 80)));
    writer(board, 2, 7);
    expect(Array.from(board.cells as Uint8Array)).toEqual([70, 7]);
    expect(value(alias(1))).toBe(70);
    expect(reader(board, 1)).toBe(70);

    // The control reads its own cells, and is never stale.
    expect(plain.stale).toBe(false);
    expect(reader(plain, 2)).toBe(2);
    expect(value(ce.box(['At', 'plain', 1]))).toBe(1);
    writer(plain, 1, 9);
    expect(Array.from(plain.cells as Uint8Array)).toEqual([9, 2]);
  });
});

describe('markStale()', () => {
  test('the fetch runs once for several accesses, after the mark is cleared', () => {
    const a = ce.array(new Uint8Array([1, 2, 3]), BYTE);
    ce.assign('a', a);
    let staleInFetch: boolean | undefined;
    const fetch = jest.fn((x: ArrayInterface) => {
      staleInFetch = x.stale;
      (x.cells as Uint8Array).set([4, 5, 6]);
    });
    a.markStale(fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(epsil('a[1] + a[2] + a[3]').json).toBe(15);
    expect(Array.from(a.cells as Uint8Array)).toEqual([4, 5, 6]);
    expect(epsil('listFrom(a)').json).toEqual(['List', 4, 5, 6]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(a);
    expect(staleInFetch).toBe(false);
  });

  test('the fetch writes no new version', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    const v0 = a.version;
    a.markStale((x) => {
      (x.cells as Uint8Array)[0] = 9;
      x.noteStore();
    });
    expect(a.version).toBe(v0 + 1);
    expect((a.cells as Uint8Array)[0]).toBe(9);
    expect(a.version).toBe(v0 + 1);
  });

  test('a second markStale() replaces the pending fetch', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    const first = deviceFetch(Uint8Array.of(3, 4));
    const second = deviceFetch(Uint8Array.of(5, 6));
    a.markStale(first);
    a.markStale(second);
    expect(Array.from(a.cells as Uint8Array)).toEqual([5, 6]);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('invalidates a cached result that read the array', () => {
    epsil('function f(x) pure { x[1] }');
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    ce.assign('a', a);
    const call = ce.box(['f', 'a']);
    expect(call.evaluate().json).toBe(1);
    expect(call.evaluate().json).toBe(1);
    const fetch = deviceFetch(Uint8Array.of(42, 2));
    a.markStale(fetch);
    expect(call.evaluate().json).toBe(42);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a swapCells() while stale gives the cells and skips the fetch', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    const fetch = deviceFetch(Uint8Array.of(3, 4));
    a.markStale(fetch);
    const v = a.version;
    const next = Uint8Array.of(7, 8);
    a.swapCells(next);
    expect(a.stale).toBe(false);
    expect(a.version).toBe(v + 1);
    expect(a.cells).toBe(next);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('a fetch can give new storage with swapCells(), with no new version', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    ce.assign('a', a);
    const device = Uint8Array.of(5, 6);
    a.markStale((x) => {
      x.swapCells(device);
    });
    const v = a.version;
    expect(epsil('a[2]').json).toBe(6);
    expect(a.cells).toBe(device);
    expect(a.version).toBe(v);
  });

  test('Swap and serialization synchronize the cells', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    const b = ce.array(new Uint8Array([3, 4]), BYTE);
    ce.assign('a', a);
    ce.assign('b', b);
    a.markStale(deviceFetch(Uint8Array.of(8, 9)));
    epsil('swap(a, b)');
    expect(Array.from(b.cells as Uint8Array)).toEqual([8, 9]);
    expect(Array.from(a.cells as Uint8Array)).toEqual([3, 4]);
    b.markStale(deviceFetch(Uint8Array.of(6, 7)));
    expect(JSON.stringify(b.json)).toContain('6,7');
    expect(b.stale).toBe(false);
  });

  test('refuses a fetch that is not a function', () => {
    const a = ce.array(new Uint8Array(2), BYTE);
    expect(() => a.markStale(3 as any)).toThrow(TypeError);
    expect(a.stale).toBe(false);
  });

  test('refuses an array of expression cells', () => {
    const a = asArray(ce.box(['ArrayFrom', ['List', 1, 2]]).evaluate());
    const v = a.version;
    expect(() => a.markStale(() => {})).toThrow(TypeError);
    expect(() => a.markStale(() => {})).toThrow(/not machine cells/);
    expect(a.stale).toBe(false);
    expect(a.version).toBe(v);
  });

  test('a fetch that throws keeps the array stale, and the next access calls it again', () => {
    const a = ce.array(new Uint8Array([1, 2]), BYTE);
    ce.assign('a', a);
    let fail = true;
    const fetch = jest.fn((x: ArrayInterface) => {
      if (fail) throw new Error('device lost');
      (x.cells as Uint8Array).set([3, 4]);
    });
    a.markStale(fetch);
    expect(() => a.cells).toThrow('device lost');
    expect(a.stale).toBe(true);
    fail = false;
    expect(epsil('a[2]').json).toBe(4);
    expect(a.stale).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('COMPILED CODE', () => {
  /** A host function `publish()` that marks `target` stale with the
   *  device bytes `device` each time it is called. */
  function declarePublish(target: () => Arr, device: Uint8Array) {
    const fetch = deviceFetch(device);
    ce.declare('publish', {
      signature: '() -> nothing',
      evaluate: () => {
        target().markStale(fetch);
        return ce.symbol('Nothing');
      },
    });
    return fetch;
  }

  test('a host call that marks a parameter stale: the next access reads the new bytes', () => {
    const board = ce.array(new Uint8Array([10, 20]), BYTE);
    const fetch = declarePublish(() => board, Uint8Array.of(30, 40));
    const run = compiled(
      `(x: array<${BYTE}>, i: integer) => do { let p = x[i]; publish(); p * 1000 + x[i] }`
    );
    expect(run(board, 1)).toBe(10 * 1000 + 30);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a host call that marks a name of the program stale', () => {
    epsil(`let board = arrayFrom([10, 20], "${BYTE}")`);
    const board = () => asArray(ce.box('board').evaluate());
    declarePublish(board, Uint8Array.of(30, 40));
    const run = compiled(
      `(i: integer) => do { let p = board[i]; publish(); p * 1000 + board[i] }`
    );
    expect(run(2)).toBe(20 * 1000 + 40);
  });

  test('a host call that marks an array that the code made', () => {
    let made: Arr | undefined;
    ce.declare('stain', {
      signature: `(array<${BYTE}>) -> nothing`,
      evaluate: (ops) => {
        made = asArray(ops[0]);
        made.markStale(deviceFetch(Uint8Array.of(50, 60)));
        return ce.symbol('Nothing');
      },
    });
    const run = compiled(
      `(i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); stain(b); b[i] }`
    );
    expect(run(2)).toBe(60);
    expect(made?.stale).toBe(false);
  });

  test('an array held in a field of a named tuple', () => {
    epsil(`type alias Byte = ${BYTE}
type Raster = tuple<width: integer, height: integer, pixels: array<Byte>>
let scr = Raster(2, 1, arrayFrom([10, 20], "Byte"))`);
    const run = compiled(`(k: integer) => scr.pixels[k]`);
    expect(run(1)).toBe(10);
    const pixels = asArray(ce.box('scr').evaluate().ops![2]);
    const fetch = deviceFetch(Uint8Array.of(30, 40));
    pixels.markStale(fetch);
    expect(run(1)).toBe(30);
    expect(run(2)).toBe(40);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a call of run() from a host function keeps the frame of the outer call', () => {
    const board = ce.array(new Uint8Array([10, 20]), BYTE);
    const inner = ce.array(new Uint8Array([5, 6]), BYTE);
    const fetch = deviceFetch(Uint8Array.of(30, 40));
    let run: Run | undefined;
    let innerValue: unknown;
    let depth = 0;
    ce.declare('hop', {
      signature: '() -> nothing',
      evaluate: () => {
        if (depth === 0) {
          depth += 1;
          innerValue = run!(inner, 1);
          depth -= 1;
          board.markStale(fetch);
        }
        return ce.symbol('Nothing');
      },
    });
    run = compiled(
      `(x: array<${BYTE}>, i: integer) => do { let p = x[i]; hop(); p * 1000 + x[i] }`
    );
    expect(run(board, 1)).toBe(10 * 1000 + 30);
    expect(innerValue).toBe(5 * 1000 + 5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('a loop that makes an array and calls the host each pass', () => {
    // The hook and the host call each mark the new array, with a fetch of
    // one cell.
    const created = jest.fn((a: Arr) =>
      a.markStale((x) => {
        (x.cells as Uint8Array)[0] = 100;
      })
    );
    ce.arrayCreated = created;
    const poked = jest.fn((x: ArrayInterface) => {
      (x.cells as Uint8Array)[1] = 200;
    });
    ce.declare('poke', {
      signature: `(array<${BYTE}>) -> nothing`,
      evaluate: (ops) => {
        const t = asArray(ops[0]);
        // The fetch of the hook ran when the array was made.
        expect(t.stale).toBe(false);
        expect((t.cells as Uint8Array)[0]).toBe(100);
        t.markStale(poked);
        return ce.symbol('Nothing');
      },
    });
    const run = compiled(
      `(n: integer) => do { let s = 0; for k in 1..n { let t = arrayFrom([k, k], "${BYTE}"); poke(t); s = s + t[1] + t[2] }; s }`
    );
    expect(run(5)).toBe(5 * 300);
    expect(created).toHaveBeenCalledTimes(5);
    expect(poked).toHaveBeenCalledTimes(5);
  });

  test('an arrayCreated hook that marks an array stale, with no host call', () => {
    const board = ce.array(new Uint8Array([10, 20]), BYTE);
    const boardFetch = deviceFetch(Uint8Array.of(30, 40));
    const madeFetch = deviceFetch(Uint8Array.of(7, 8));
    ce.arrayCreated = (a) => {
      a.markStale(madeFetch);
      board.markStale(boardFetch);
    };
    const made = compiled(
      `(i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); b[i] }`
    );
    expect(made(2)).toBe(8);
    expect(madeFetch).toHaveBeenCalledTimes(1);
    const both = compiled(
      `(x: array<${BYTE}>, i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); x[i] * 1000 + b[i] }`
    );
    expect(both(board, 1)).toBe(30 * 1000 + 7);
    expect(boardFetch).toHaveBeenCalledTimes(2);
  });

  test('a host call that marks an array that the code made and that the call does not receive', () => {
    // The hook registers each new array, and `publish()` marks every
    // registered array stale.
    const registered: Arr[] = [];
    ce.arrayCreated = (a) => {
      registered.push(a as Arr);
    };
    const fetch = deviceFetch(Uint8Array.of(50, 60));
    ce.declare('publish', {
      signature: '() -> nothing',
      evaluate: () => {
        for (const a of registered) a.markStale(fetch);
        return ce.symbol('Nothing');
      },
    });
    const read = compiled(
      `(i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); publish(); b[i] }`
    );
    expect(read(1)).toBe(50);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(registered[0].stale).toBe(false);

    // A store after the call keeps the device value of the other cell.
    const store = compiled(
      `(i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); publish(); b[1] = 5; b[i] }`
    );
    expect(store(2)).toBe(60);
    const b = registered[registered.length - 1];
    expect(b.stale).toBe(false);
    expect(Array.from(b.cells as Uint8Array)).toEqual([5, 60]);
  });

  test('a loop that makes an array and calls the host each pass, with no array stale, runs no fetch', () => {
    const refresh = jest.spyOn(BoxedArray.prototype, '_refresh');
    try {
      const created = jest.fn();
      ce.arrayCreated = created;
      const tick = jest.fn(() => ce.symbol('Nothing'));
      ce.declare('tick', { signature: '() -> nothing', evaluate: tick });
      const run = compiled(
        `(n: integer) => do { let s = 0; for k in 1..n { let t = arrayFrom([k, 2 * k], "${BYTE}"); tick(); s = s + t[1] + t[2] }; s }`
      );
      expect(run(10)).toBe(3 * 55);
      expect(created).toHaveBeenCalledTimes(10);
      expect(tick).toHaveBeenCalledTimes(10);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      refresh.mockRestore();
    }
  });

  test('a stale array that the code does not reach is not fetched by a run that calls the host', () => {
    const far = ce.array(new Uint8Array([1, 2]), BYTE);
    const fetch = deviceFetch(Uint8Array.of(3, 4));
    far.markStale(fetch);
    ce.declare('tick', {
      signature: '() -> nothing',
      evaluate: () => ce.symbol('Nothing'),
    });
    const x = ce.array(new Uint8Array([7, 8]), BYTE);
    const run = compiled(
      `(x: array<${BYTE}>, i: integer) => do { let b = arrayFrom([1, 2], "${BYTE}"); tick(); x[i] + b[i] }`
    );
    expect(run(x, 2)).toBe(10);
    expect(fetch).not.toHaveBeenCalled();
    expect(far.stale).toBe(true);
  });

  test('an array that a host call gave to a name, kept by a local, is fetched when a later call marks it', () => {
    epsil(`let board = arrayFrom([1, 2], "${BYTE}")`);
    // The first call of `advance()` gives `board` the array `next`; the
    // second marks `next` stale and gives `board` another array.
    let next = ce.array(new Uint8Array([10, 20]), BYTE);
    let device = Uint8Array.of(30, 40);
    let calls = 0;
    ce.declare('advance', {
      signature: '() -> nothing',
      evaluate: () => {
        calls += 1;
        if (calls % 2 === 1) ce.assign('board', next);
        else {
          next.markStale(deviceFetch(device));
          ce.assign('board', ce.array(new Uint8Array([90, 90]), BYTE));
        }
        return ce.symbol('Nothing');
      },
    });
    const read = compiled(
      `(i: integer) => do { advance(); let saved = board; advance(); saved[i] }`
    );
    expect(read(1)).toBe(30);
    expect(next.stale).toBe(false);

    // A store after the call keeps the device value of the other cell.
    next = ce.array(new Uint8Array([10, 20]), BYTE);
    device = Uint8Array.of(50, 60);
    const store = compiled(
      `(i: integer) => do { advance(); let saved = board; advance(); saved[1] = 5; saved[i] }`
    );
    expect(store(2)).toBe(60);
    expect(next.stale).toBe(false);
    expect(Array.from(next.cells as Uint8Array)).toEqual([5, 60]);
  });

  test('a loop of reads runs the fetch once, at entry', () => {
    const a = ce.array(new Uint8Array([1, 2, 3, 4]), BYTE);
    const run = compiled(
      `(x: array<${BYTE}>) => do { let s = 0; for k in 1..4 { s = s + x[k] }; s }`
    );
    const fetch = deviceFetch(Uint8Array.of(5, 6, 7, 8));
    a.markStale(fetch);
    expect(run(a)).toBe(26);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(run(a)).toBe(26);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('THE STALE ARRAYS OF AN ENGINE', () => {
  // A collection cannot be awaited in a test: the cleanup of the registry is
  // called directly, with the entry that `markStale()` registered.
  test('a stale array is registered once, and its cleanup deletes its entry', () => {
    const register = jest.spyOn(FinalizationRegistry.prototype, 'register');
    const unregister = jest.spyOn(FinalizationRegistry.prototype, 'unregister');
    try {
      const stale = staleArrays(ce);
      const a = ce.array(new Uint8Array([1, 2]), BYTE);
      a.markStale(() => {});
      a.markStale(() => {});
      expect(stale.size).toBe(1);
      const mine = register.mock.calls.filter((c) => c[0] === a);
      expect(mine).toHaveLength(1);
      const entry = mine[0][1] as Parameters<typeof dropCollectedStale>[0];
      expect(entry.set).toBe(stale);
      expect(entry.ref.deref()).toBe(a);
      dropCollectedStale(entry);
      expect(stale.size).toBe(0);

      // An array whose fetch runs is no longer registered.
      const b = ce.array(new Uint8Array([1, 2]), BYTE);
      b.markStale(() => {});
      const token = register.mock.calls.find((c) => c[0] === b)![2];
      void b.cells;
      expect(unregister).toHaveBeenCalledWith(token);
      expect(stale.size).toBe(0);
    } finally {
      register.mockRestore();
      unregister.mockRestore();
    }
  });

  test('compiled code that an array entered drops the entry of a collected array', () => {
    const stale = staleArrays(ce);
    // An entry whose array was collected.
    stale.add({ deref: () => undefined } as unknown as WeakRef<BoxedArray>);
    const run = compiled(
      `(i: integer) => do { let b = arrayFrom([7, 8], "${BYTE}"); b[i] }`
    );
    expect(run(2)).toBe(8);
    expect(stale.size).toBe(0);
  });
});
