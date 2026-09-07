import vm from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The list carrier of the `javascript` target: on a binding whose declared
 * type proves a JS array, a plain `Array` passes through untouched and a
 * numeric typed array is copied into a plain one at entry. Every other value
 * passes untouched too — the lowerings dispatch on the runtime shape, so a
 * declared type narrower than the bound value is not enforced here. See
 * `docs/plans/2026-09-07-numeric-list-store-and-typed-array-boundary.md`.
 */

/** An engine with `S` declared as a valueless list of numbers. */
function listEngine(type = 'list<number>'): ComputeEngine {
  const e = new ComputeEngine();
  e.declare('S', type as any);
  return e;
}

/**
 * A compiled unit whose body hands `S` to a caller-supplied function, so the
 * test can see the exact value the artifact reads.
 *
 * The recorded value goes through `globalThis`, not through a closure: a
 * `functions` entry may be re-created from its SOURCE TEXT inside the
 * artifact, which loses the variables the original arrow closed over.
 */
function probeUnit(type = 'list<number>'): {
  run: (arg: unknown) => unknown;
  seen: () => unknown;
} {
  const e = listEngine(type);
  e.declare('Probe', { signature: '(list<number>) -> number' });
  const r = compile(e.box(['Probe', 'S']), {
    to: 'javascript',
    functions: {
      Probe: (x: unknown) => (((globalThis as any).__ceListEntrySeen = x), 0),
    },
  })!;
  expect(r.success).toBe(true);
  return {
    run: (arg: unknown) => {
      (globalThis as any).__ceListEntrySeen = undefined;
      return r.run!({ S: arg } as any);
    },
    seen: () => (globalThis as any).__ceListEntrySeen,
  };
}

describe('COMPILE list entry check (vars route)', () => {
  it('accepts a plain array without copying it', () => {
    const unit = probeUnit();
    const board = [1, 2, 3, 4];
    unit.run(board);
    // The identity, not just the contents: a plain array is passed through.
    expect(unit.seen()).toBe(board);
  });

  it('accepts a numeric typed array and copies it into a plain array', () => {
    const unit = probeUnit();
    const board = new Float64Array([1, 2, 3, 4]);
    unit.run(board);
    const seen = unit.seen();
    expect(Array.isArray(seen)).toBe(true);
    expect(seen).toEqual([1, 2, 3, 4]);
    // The copy is fresh: the caller's buffer is not aliased.
    expect(seen).not.toBe(board);
    (seen as number[])[0] = 99;
    expect(board[0]).toBe(1);
  });

  it('gives a typed array the same result as the plain array', () => {
    const e = listEngine();
    const r = compile(e.box(['Add', ['RotateLeft', 'S', 1], 'S']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    const plain = r.run!({ S: [1, 2, 3, 4] } as any);
    const typed = r.run!({ S: new Float64Array([1, 2, 3, 4]) } as any);
    expect(typed).toEqual(plain);
  });

  it('accepts every numeric typed-array flavor', () => {
    const unit = probeUnit();
    for (const board of [
      new Float32Array([1, 2, 3]),
      new Int32Array([1, 2, 3]),
      new Uint8Array([1, 2, 3]),
      new Int16Array([1, 2, 3]),
    ]) {
      unit.run(board);
      expect(Array.isArray(unit.seen())).toBe(true);
      expect(unit.seen()).toEqual([1, 2, 3]);
    }
  });

  it('passes a scalar, a string, an object and `undefined` through untouched', () => {
    // The entry check copies a typed array and does nothing else. A value the
    // declared type does not admit is left to the lowerings, which dispatch on
    // the runtime shape.
    const unit = probeUnit();
    for (const value of [5, 'abc', { length: 3 }, undefined, null]) {
      unit.run(value);
      expect(unit.seen()).toBe(value);
    }
  });

  it('passes a DataView and a BigInt typed array through untouched', () => {
    const unit = probeUnit();
    for (const value of [
      new DataView(new ArrayBuffer(8)),
      new BigInt64Array(2),
      new BigUint64Array(2),
    ]) {
      unit.run(value);
      expect(unit.seen()).toBe(value);
    }
  });

  it('recognizes views from another realm by their brand', () => {
    // A view built in another realm has a foreign constructor, so an
    // `instanceof` test would misclassify it. The brand test does not: a
    // foreign `Float64Array` is copied, a foreign `DataView` or `BigInt64Array`
    // passes through untouched.
    const foreign = vm.runInNewContext(
      '({ f64: new Float64Array([1, 2, 3]), dv: new DataView(new ArrayBuffer(8)), big: new BigInt64Array(2) })'
    ) as { f64: Float64Array; dv: DataView; big: BigInt64Array };
    expect(foreign.f64 instanceof Float64Array).toBe(false);
    const unit = probeUnit();
    unit.run(foreign.f64);
    expect(Array.isArray(unit.seen())).toBe(true);
    expect(unit.seen()).toEqual([1, 2, 3]);
    for (const value of [foreign.dv, foreign.big]) {
      unit.run(value);
      expect(unit.seen()).toBe(value);
    }
  });

  it('keeps the runtime-shape projection of a scalar on a list binding', () => {
    // The lane the narrow rule protects: a `list`-declared symbol bound to a
    // number still gives the scalar result, never an entry error.
    const e = listEngine();
    const r = compile(e.box(['Add', 'S', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ S: 5 } as any)).toBe(6);
    expect(r.run!({ S: [1, 2] } as any)).toEqual([2, 3]);
  });

  it('leaves a string-typed symbol accepting a string', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    const r = compile(e.box(['Length', 's']), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ s: 'abc' } as any)).toBe(3);
  });

  it('leaves an `indexed_collection`-typed symbol accepting a string', () => {
    // A string inhabits the bare `indexed_collection` type, so the entry check
    // does not cover it: a typed-array copy there would be wrong.
    const e = listEngine('indexed_collection');
    const r = compile(e.box(['Length', 'S']), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ S: 'abc' } as any)).toBe(3);
    expect(r.run!({ S: [1, 2, 3] } as any)).toBe(3);
  });

  it('leaves a `number | list<number>` symbol accepting a scalar', () => {
    const e = listEngine('number | list<number>');
    const r = compile(e.box(['Add', 'S', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ S: 5 } as any)).toBe(6);
    expect(r.run!({ S: [1, 2] } as any)).toEqual([2, 3]);
  });

  it('leaves a real-typed symbol accepting a scalar', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    const r = compile(e.box(['Add', 'x', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 5 } as any)).toBe(6);
  });
});

describe('COMPILE list entry check (args route)', () => {
  /** A compiled lambda with one `list<number>` parameter. */
  function lambdaUnit(): (arg: unknown) => unknown {
    const e = new ComputeEngine();
    const r = compile(
      e.box([
        'Function',
        ['Add', ['At', 'v', 1], 1],
        ['Typed', 'v', { str: 'list<number>' }],
      ]),
      { to: 'javascript' }
    )!;
    expect(r.success).toBe(true);
    return r.run as unknown as (arg: unknown) => unknown;
  }

  it('accepts a plain array and a numeric typed array', () => {
    const run = lambdaUnit();
    expect(run([10, 20])).toBe(11);
    expect(run(new Float64Array([10, 20]))).toBe(11);
  });

  it('passes a non-array argument through untouched', () => {
    // As on the free-symbol route, only a typed array is rewritten. `At` on a
    // non-array base answers `NaN`, which is what the interpreter's `Nothing`
    // projects to — the behavior before the typed-array copy existed.
    const run = lambdaUnit();
    for (const value of [
      5,
      'abc',
      {},
      new DataView(new ArrayBuffer(8)),
      new BigInt64Array(2),
    ])
      expect(run(value)).toBeNaN();
  });

  it('leaves an unannotated parameter unchecked', () => {
    const e = new ComputeEngine();
    const r = compile(e.box(['Function', ['Add', 'w', 1], 'w']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    expect((r.run as unknown as (x: unknown) => unknown)(4)).toBe(5);
  });
});

describe('COMPILE list entry check: a step over a board', () => {
  // The shape of the caller that asked for the typed-array boundary: a board
  // held outside the engine, bound at `run()` time, and stepped once.
  it('takes a Float64Array board in and gives a plain array out', () => {
    const e = listEngine();
    const r = compile(e.box(['Add', ['RotateLeft', 'S', 1], 'S']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    const board = new Float64Array([1, 0, 1, 0, 1]);
    const out = r.run!({ S: board } as any);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([1, 1, 1, 1, 2]);
    // The board the caller holds is untouched.
    expect(Array.from(board)).toEqual([1, 0, 1, 0, 1]);
  });
});
