import vm from 'node:vm';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isNumericTypedArray } from '../../src/compute-engine/compilation/javascript-runtime';

/**
 * The list carrier of the `javascript` target is the plain `Array`. The
 * contract of `run()` is: inputs of the shape the compiled code reads,
 * results read-only. On a binding whose declared type proves a JS array, the
 * entry refuses a string and a numeric typed array (`Float64Array`,
 * `Int32Array`, ...), and passes every other value as it is. A plain `Array`
 * gives the expected result. The typed array is refused with a `TypeError`
 * that names the binding (one brand check per binding per call): the
 * compiled code reads plain arrays only, and a host that holds a typed array
 * converts it once, on its side, with `Array.from`.
 *
 * Until 2026-10-13 the runner copied a typed-array input to a plain array on
 * every call. The user replaced that copy with the refusal on 2026-10-13,
 * because its cost grew with the data on every call (Tycho ledger row 371, a
 * kernel called about 1.2 million times with a 9 801-element list input, was
 * the motivating case). The design text is in `docs/COMPILATION-MODEL.md` (search for
 * "inputs of the shape"); the earlier typed-array study is in
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

  it('refuses a numeric typed array at entry, before the body runs', () => {
    // The runner does not convert a typed array to a plain array: it throws
    // a `TypeError` that names the binding, and the compiled code never
    // receives the value.
    const unit = probeUnit();
    const board = new Float64Array([1, 2, 3, 4]);
    expect(() => unit.run(board)).toThrow(
      /"S" \(type `list<number>`\) is compiled as a JavaScript array, and compiled code does not accept a typed array/
    );
    expect(unit.seen()).toBeUndefined();
  });

  it('refuses a typed array; the converted array gives the plain-array result', () => {
    // `RotateLeft` reads its operand as a plain array. A typed array is
    // refused at entry, and a caller converts with `Array.from` first.
    const e = listEngine();
    const r = compile(e.box(['Add', ['RotateLeft', 'S', 1], 'S']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    const plain = r.run!({ S: [1, 2, 3, 4] } as any);
    expect(plain).toEqual([3, 5, 7, 5]);
    expect(() => r.run!({ S: new Float64Array([1, 2, 3, 4]) } as any)).toThrow(
      /does not accept a typed array/
    );
    const converted = r.run!({
      S: Array.from(new Float64Array([1, 2, 3, 4])),
    } as any);
    expect(converted).toEqual(plain);
  });

  it('refuses every numeric typed-array flavor', () => {
    const unit = probeUnit();
    for (const board of [
      new Float32Array([1, 2, 3]),
      new Int32Array([1, 2, 3]),
      new Uint8Array([1, 2, 3]),
      new Int16Array([1, 2, 3]),
    ]) {
      expect(() => unit.run(board)).toThrow(/does not accept a typed array/);
      expect(unit.seen()).toBeUndefined();
    }
  });

  it('passes a scalar, an object and `undefined` through untouched', () => {
    // The entry check refuses a string, and does nothing else. Any other value the declared type does not admit is left
    // to the lowerings, which dispatch on the runtime shape.
    const unit = probeUnit();
    for (const value of [5, { length: 3 }, undefined, null]) {
      unit.run(value);
      expect(unit.seen()).toBe(value);
    }
  });

  it('refuses a string', () => {
    // The compiled code would read the string as an array of UTF-16 code
    // units (`compile-entry-string-refusal.test.ts`).
    const unit = probeUnit();
    expect(() => unit.run('abc')).toThrow(
      /"S" \(type `list<number>`\) is compiled as a JavaScript array/
    );
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
    // `instanceof` test would misclassify it. `isNumericTypedArray()` (the
    // entry's brand check) tests the brand instead: a foreign
    // `Float64Array` is numeric, a foreign `DataView` or `BigInt64Array` is
    // not. At the entry of `run()`, the foreign `Float64Array` is refused and
    // the other two pass as they are.
    const foreign = vm.runInNewContext(
      '({ f64: new Float64Array([1, 2, 3]), dv: new DataView(new ArrayBuffer(8)), big: new BigInt64Array(2) })'
    ) as { f64: Float64Array; dv: DataView; big: BigInt64Array };
    expect(foreign.f64 instanceof Float64Array).toBe(false);
    expect(isNumericTypedArray(foreign.f64)).toBe(true);
    expect(isNumericTypedArray(foreign.dv)).toBe(false);
    expect(isNumericTypedArray(foreign.big)).toBe(false);
    const unit = probeUnit();
    expect(() => unit.run(foreign.f64)).toThrow(
      /does not accept a typed array/
    );
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

  it('refuses a string for an `indexed_collection`-typed symbol', () => {
    // A string inhabits the bare `indexed_collection` type, but the compiled
    // code reads the binding as a JavaScript array, so the entry refuses a
    // string (`compile-entry-string-refusal.test.ts`). An array passes.
    const e = listEngine('indexed_collection');
    const r = compile(e.box(['Length', 'S']), { to: 'javascript' })!;
    expect(r.success).toBe(true);
    expect(() => r.run!({ S: 'abc' } as any)).toThrow(
      /compiled code does not accept a string/
    );
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

  it('accepts a plain array; refuses a numeric typed array', () => {
    // The argument is not converted: the entry throws a `TypeError` that
    // names the parameter. A caller converts with `Array.from`.
    const run = lambdaUnit();
    expect(run([10, 20])).toBe(11);
    expect(() => run(new Float64Array([10, 20]))).toThrow(
      /argument 1 \(type `list<number>`\) is compiled as a JavaScript array, and compiled code does not accept a typed array/
    );
    expect(run(Array.from(new Float64Array([10, 20])))).toBe(11);
  });

  it('passes a non-array argument through untouched', () => {
    // As on the free-symbol route, only a string is refused. `At` on a
    // non-array base answers `NaN`, which is what the interpreter's
    // `Nothing` projects to.
    const run = lambdaUnit();
    for (const value of [
      5,
      {},
      new DataView(new ArrayBuffer(8)),
      new BigInt64Array(2),
    ])
      expect(run(value)).toBeNaN();
    expect(() => run('abc')).toThrow(
      /argument 1 \(type `list<number>`\) is compiled as a JavaScript array/
    );
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

describe('COMPILE list entry: interpreter fallback with text', () => {
  // `S: string | list<number>` is not provably a string, so `At` and
  // `Characters` do not compile and the interpreter runs them instead. A
  // character the interpreter answers is a JS string, as compiled code
  // answers `At(s, 1)` for `s: string` — never `NaN`.
  it('answers a character result as a string', () => {
    const e = listEngine('string | list<number>');
    const r = compile(e.box(['At', 'S', 1]), { to: 'javascript' })!;
    expect(r.success).toBe(false);
    expect(r.run!({ S: 'abc' } as any)).toBe('a');
    expect(r.run!({ S: [4, 5, 6] } as any)).toBe(4);
  });

  it('answers a list of characters as an array of strings', () => {
    const e = listEngine('string | list<number>');
    const r = compile(e.box(['Characters', 'S']), { to: 'javascript' })!;
    expect(r.success).toBe(false);
    expect(r.run!({ S: 'abc' } as any)).toEqual(['a', 'b', 'c']);
  });
});

describe('COMPILE list entry check: a step over a board', () => {
  // The shape of the caller that asked for the typed-array boundary (Tycho
  // items 261-264): a board held outside the engine, bound at `run()` time,
  // and stepped once. The board must be a plain array. A caller that holds
  // a `Float64Array` board converts it first, with `Array.from`, because
  // `run()` refuses a typed array.
  it('takes a plain-array board in and gives a plain array out', () => {
    const e = listEngine();
    const r = compile(e.box(['Add', ['RotateLeft', 'S', 1], 'S']), {
      to: 'javascript',
    })!;
    expect(r.success).toBe(true);
    const held = new Float64Array([1, 0, 1, 0, 1]);
    expect(() => r.run!({ S: held } as any)).toThrow(
      /does not accept a typed array/
    );
    const board = Array.from(held);
    const out = r.run!({ S: board } as any);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual([1, 1, 1, 1, 2]);
    // The board the caller holds is untouched.
    expect(board).toEqual([1, 0, 1, 0, 1]);
    expect(Array.from(held)).toEqual([1, 0, 1, 0, 1]);
  });
});
