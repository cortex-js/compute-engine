import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createJavaScriptRuntime } from '../../src/runtime';
import { normalizeRunResult } from '../../src/compute-engine/compilation/javascript-runtime';

/**
 * The contract of `run()` on the `javascript` target, decided by the user on
 * 2026-10-13: the compiled route requires inputs of the shape the compiled
 * code reads, and its results are read-only. At entry, the runner does a
 * constant amount of work per binding on each call — one `typeof`, to refuse
 * a `{re, im}` object in a real slot, lift a plain number into a complex
 * slot, project the unsigned pole, and refuse a string for a binding the code
 * reads as an array, and one brand check, to refuse a typed array for such a
 * binding (the host converts it once, on its side). It never reads the
 * entries of a list input and never copies a returned collection. The one
 * per-call cost that grows with the data is on the result: the result
 * convention reads each cell of a RETURNED collection with one `typeof`, to
 * find a `{re, im: 0}` cell, and allocates nothing when it finds none.
 *
 * Before, the runner walked every entry of a list input read on the real
 * lane on every call, copied a typed-array input to a plain array on every
 * call, and returned every collection as a fresh array. For a kernel called
 * 1.2 million times with a 9 801-element list input, that walk was the whole
 * per-call cost (Tycho ledger row 371, filed 2026-10-12). The interpreter is
 * the route that validates.
 */

/** A plain array of `n` numbers behind a proxy that counts the reads of its
 * numeric indices: the runner reads only what the compiled code indexes. */
function countingList(n: number): { list: number[]; reads: () => number } {
  const base = Array.from({ length: n }, (_, i) => i + 0.5);
  let reads = 0;
  const list = new Proxy(base, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads += 1;
      return Reflect.get(target, prop, receiver);
    },
  });
  return { list, reads: () => reads };
}

describe('run() contract — list inputs', () => {
  const AT_T3 = ['Add', ['At', 'T', 3], -3];

  test('reads only the indexed entry of a list input', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const r = compile(ce.box(AT_T3), { to: 'javascript' });
    expect(r.success).toBe(true);
    const { list, reads } = countingList(100);
    expect(r.run!({ T: list })).toBe(-0.5);
    expect(reads()).toBe(1);
  });

  test('the same on the lambda route', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box([
        'Function',
        ['At', 'T', 3],
        ['Typed', 'T', { str: 'list<real>' }],
      ] as any),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    const { list, reads } = countingList(100);
    expect((r.run as unknown as (T: unknown) => unknown)(list)).toBe(2.5);
    expect(reads()).toBe(1);
  });

  test('the entry plan records no per-entry check', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const r = compile(ce.box(AT_T3), { to: 'javascript' });
    expect(r.entryPlan).toBeDefined();
    expect(r.entryPlan).not.toHaveProperty('entries');
    expect(r.entryPlan!.lists).toEqual(['T']);
  });

  test('a typed array is refused at entry; the caller converts once', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const r = compile(ce.box(AT_T3), { to: 'javascript' });
    const typed = Float64Array.from({ length: 10 }, (_, i) => i + 0.5);
    expect(() => r.run!({ T: typed })).toThrow(/does not accept a typed array/);
    // The caller converts once, on its side.
    expect(r.run!({ T: Array.from(typed) })).toBe(-0.5);
  });

  test('a complex entry in a real list is the caller’s responsibility: nothing throws', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const bad = [1, { re: 1, im: 2 }, 3, 4];
    const r = compile(ce.box(['At', 'T', 1]), { to: 'javascript' });
    expect(r.run!({ T: bad })).toBe(1);
    // The compiled body computes with the object as plain JavaScript would
    // (`{re, im} + 1` is a string concatenation): no promise is made about
    // the value, only that the runner adds no walk and no check.
    const r2 = compile(ce.box(['Add', ['At', 'T', 2], 1]), {
      to: 'javascript',
    });
    expect(() => r2.run!({ T: bad })).not.toThrow();
  });
});

describe('run() contract — the constant-cost checks stay', () => {
  test('a complex object in a real scalar slot throws a named error', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Add', 'x', 1]), { to: 'javascript' });
    expect(() => r.run!({ x: { re: 1, im: 2 } })).toThrow(
      /"x" was compiled as a real number but received a complex/
    );
  });

  test('a plain number in a complex slot is lifted', () => {
    const ce = new ComputeEngine();
    ce.declare('z', { type: 'complex' });
    const r = compile(ce.box(['Multiply', 'z', 'z']), {
      to: 'javascript',
      mode: 'complex',
    });
    expect(r.run!({ z: 2 })).toBe(4);
  });

  test('a string for a binding the code reads as an array is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const r = compile(ce.box(['Length', 'T']), { to: 'javascript' });
    expect(() => r.run!({ T: 'abc' })).toThrow(/does not accept a string/);
  });
});

describe('run() contract — results are read-only', () => {
  test('a hoisted list literal is returned shared', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['List', 1, 2, 3, 4]), { to: 'javascript' });
    expect(r.preambleOnce).toContain('_lit_1');
    const a = r.run!({});
    expect(a).toEqual([1, 2, 3, 4]);
    expect(r.run!({})).toBe(a);
  });

  test('a nested literal is shared at every level', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['List', ['List', 1, 2], ['List', 3, 4]]), {
      to: 'javascript',
    });
    const m1 = r.run!({}) as unknown[][];
    const m2 = r.run!({}) as unknown[][];
    expect(m1).toBe(m2);
    expect(m1[0]).toBe(m2[0]);
  });

  test('a function the kernel returns answers the shared literal', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Function', ['List', 1, 2, 3, 4], 'k']), {
      to: 'javascript',
    });
    const f = r.run as unknown as (k: number) => unknown;
    expect(f(1)).toEqual([1, 2, 3, 4]);
    expect(f(1)).toBe(f(2));
  });

  test('a bound list value is returned shared', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 5, 6, 7]));
    const r = compile(ce.box('L'), { to: 'javascript' });
    const a = r.run!({});
    expect(a).toEqual([5, 6, 7]);
    expect(r.run!({})).toBe(a);
  });

  test('the convention is kept: a {re, im: 0} cell reads as a number, a complex cell stays complex', () => {
    const ce = new ComputeEngine();
    ce.declare('z', { type: 'complex' });
    const r = compile(ce.box(['List', ['Multiply', 'z', 'z'], 2, 3]), {
      to: 'javascript',
      mode: 'complex',
    });
    expect(r.run!({ z: { re: 0, im: 1 } })).toEqual([-1, 2, 3]);
    expect(r.run!({ z: { re: 1, im: 1 } })).toEqual([{ re: 0, im: 2 }, 2, 3]);
    const s = compile(ce.box(['Multiply', 'z', 'z']), {
      to: 'javascript',
      mode: 'complex',
    });
    expect(s.run!({ z: { re: 0, im: 1 } })).toBe(-1);
    expect(s.run!({ z: { re: 1, im: 1 } })).toEqual({ re: 0, im: 2 });
  });
});

describe('run() contract — the shared form of the result convention', () => {
  test('a shared array with a {re, im: 0} cell is copied, and the shared array is left unchanged', () => {
    const cell = { re: 1, im: 0 };
    const shared: unknown[] = [cell, 2, [3, { re: 4, im: 0 }]];
    const inner = shared[2];
    const out = normalizeRunResult(shared) as unknown[];
    expect(out).toEqual([1, 2, [3, 4]]);
    expect(out).not.toBe(shared);
    // Only the cells that change are rewritten, in the copy: the shared
    // array still holds its complex objects, and the next call reads them.
    expect(shared[0]).toBe(cell);
    expect(shared[2]).toBe(inner);
    expect((inner as unknown[])[1]).toEqual({ re: 4, im: 0 });
  });

  test('a shared array with nothing to rewrite is returned as it is, at every depth', () => {
    const row = [1, { re: 0, im: 2 }];
    const shared: unknown[] = [row, 3, true];
    expect(normalizeRunResult(shared)).toBe(shared);
    expect((normalizeRunResult(shared) as unknown[])[0]).toBe(row);
    const c = { re: 1, im: 2 };
    expect(normalizeRunResult(c)).toBe(c);
  });
});

describe('run() contract — stored code', () => {
  test('a runtime that loads the stored result applies the same contract', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['List', 1, 2, 3, 4]), { to: 'javascript' });
    const stored = JSON.parse(JSON.stringify(r));
    expect(stored.entryPlan).toBeUndefined();
    const fn = createJavaScriptRuntime().load(stored);
    const a = fn({});
    expect(a).toEqual([1, 2, 3, 4]);
    expect(fn({})).toBe(a);
  });

  test('a stored lambda answers the shared literal', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Function', ['List', 1, 2, 3, 4], 'k']), {
      to: 'javascript',
    });
    const fn = createJavaScriptRuntime().load(JSON.parse(JSON.stringify(r)));
    expect(fn(1)).toEqual([1, 2, 3, 4]);
    expect(fn(1)).toBe(fn(2));
  });

  test('a stored plan written with the old `entries` field loads and is ignored', () => {
    const ce = new ComputeEngine();
    ce.declare('T', { type: 'list<real>' });
    const r = compile(ce.box(['At', 'T', 1]), { to: 'javascript' });
    const stored = JSON.parse(JSON.stringify(r));
    stored.entryPlan.entries = [
      ['T', { numbers: true, depth: 0, label: '"T"' }],
    ];
    const fn = createJavaScriptRuntime().load(stored);
    // The old field must not bring the refusal back: the call does not throw.
    expect(() => fn({ T: [{ re: 1, im: 2 }, 3] })).not.toThrow();
  });
});
