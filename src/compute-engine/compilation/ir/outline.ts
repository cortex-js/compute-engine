/**
 * The outliner of the parallel loops and comprehensions that `runAsync()`
 * can send to the worker pool (design:
 * `docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`,
 * section 6; README, "Batches and `runAsync()`").
 *
 * It reads the program after the passes and changes nothing in it: `run()`
 * is the same with or without it. For each `loop` marked `parallel` (the
 * loop of the first clause of a `ParallelLoop`, `lower.ts`) at a waiting
 * position whose accumulators it admits (`accumulators()`), it builds a
 * worker program: a root function literal of the positional parameters
 * `i0`, `i1`, `lo` and the values that the body reads from outside the
 * loop, whose body is the same loop restricted to the passes `i0 <= i < i1`
 * (`window`), each scalar accumulator from `-0` and each list accumulator a
 * new array of `-0` (`zeros`), and which returns the partial sums, then the
 * partial arrays. A `parallel.build` returns the slice of values for those
 * passes instead. A loop or comprehension that fails a condition runs in
 * order, as `run()` runs it.
 */

import { isShippableCode } from '../../kernel-pool.js';
import type { IComputeEngine as ComputeEngine } from '../../global-types.js';
import type { ParallelLoopFallbackReason } from '../types.js';
import { passChecksOn, verify } from './verify.js';
import { printJavaScript, type JavaScriptResult } from './print-js.js';
import type { Syntax } from './print.js';
import type { OperatorRow } from './operators.js';
import {
  argsOf,
  lengthValues,
  outsOf,
  regionsOf,
  scalarType,
  useIndex,
  type IRFunction,
  type IRType,
  type Instr,
  type Lane,
  type Program,
  type Region,
  type V,
} from './ir.js';

type Loop = Instr & { k: 'loop' };
type ParallelWork = Loop | (Instr & { k: 'region' });

function isParallelWork(i: Instr): i is ParallelWork {
  return i.k === 'loop'
    ? i.parallel === true
    : i.k === 'region' && i.op === 'parallel.build';
}

/** A loop or comprehension that `runAsync()` can send to the pool. */
export type PoolLoop = {
  /** The loop of the program. */
  readonly loop: ParallelWork;
  /** The values of the program that a worker program reads, after `i0`,
   *  `i1` and `lo`, in the order of its parameters. */
  readonly passed: readonly V[];
  /** The arrays of the program that the list accumulators hold, in the
   *  order of the results of the worker program after the partial sums
   *  (one per carried value of the loop). */
  readonly lists: readonly V[];
  /** The worker program, printed. */
  readonly printed: JavaScriptResult;
};

/** The pool loops of a program, and the functions that wait. */
export type Outline = {
  /** In the order of their ids. */
  readonly loops: readonly PoolLoop[];
  /** The functions printed `async` (the entry first): those that the entry
   *  reaches through waiting calls, each holding a pool loop or such a
   *  call. */
  readonly waits: ReadonlySet<string>;
};

/** The IR operations of a read of `vars` (`hostVarOp()` of `lower.ts`). */
const HOST = /^host\d+\./;

const isAdd = (i: Instr | undefined): i is Instr & { k: 'op' } =>
  i?.k === 'op' && (i.op === 'add' || i.op === 'add.int');

/**
 * The pool loops of `p` and the functions that wait, or `undefined` when
 * the entry reaches no pool loop. `syntax` and `rows` are those of the
 * program's printer; `ce` gives the runtime of a worker program run on the
 * calling thread.
 */
export function outline(
  p: Program,
  rows: readonly OperatorRow[],
  syntax: Syntax,
  ce?: ComputeEngine,
  fallbacks?: Set<ParallelLoopFallbackReason>,
  disabled?: ParallelLoopFallbackReason
): Outline | undefined {
  if (disabled !== undefined) {
    const hasParallelLoop = (r: Region): boolean =>
      r.body.some(
        (i) => isParallelWork(i) || regionsOf(i).some(hasParallelLoop)
      );
    if (p.functions.some((f) => hasParallelLoop(f.body)))
      fallbacks?.add(disabled);
    return undefined;
  }
  const fns = new Map(p.functions.map((f) => [f.name, f]));
  const { def, uses } = useIndex(p);
  type Calls = { fn: string; waiting: boolean }[];
  const calls = new Map<string, Calls>();
  /** The marked loops at a waiting position of each function, not yet
   *  refused. */
  const marked = new Map<string, ParallelWork[]>();
  const serial = new Set<string>();
  for (const f of p.functions) {
    const own: Calls = [];
    const loops: ParallelWork[] = [];
    // A waiting position: the regions up to the function's body are only
    // `if` arms and bodies of loops that are not marked.
    const walk = (r: Region, waiting: boolean): void => {
      for (const i of r.body) {
        if (i.k === 'call') {
          own.push({ fn: i.fn, waiting });
          if (!waiting) serial.add(i.fn);
        }
        if (isParallelWork(i)) {
          if (waiting) loops.push(i);
          else fallbacks?.add('unsupported-position');
        }
        const inner =
          i.k === 'if' || (i.k === 'loop' && i.parallel !== true)
            ? waiting
            : false;
        regionsOf(i).forEach((x) => walk(x, inner));
      }
    };
    walk(f.body, true);
    calls.set(f.name, own);
    marked.set(f.name, loops);
  }
  if (fallbacks !== undefined)
    for (const name of serial) {
      if (marked.get(name)?.length) fallbacks.add('unsupported-position');
      for (const call of calls.get(name) ?? []) serial.add(call.fn);
    }

  // The worker programs are built only for the loops of the functions that
  // the entry reaches; a loop refused there can change which functions wait,
  // so the reach is computed again until no loop is refused.
  const built = new Map<ParallelWork, PoolLoop>();
  for (;;) {
    // A function waits when it holds a pool loop or a waiting call of a
    // function that waits (a fixed point; recursion included).
    const waits = new Set(
      p.functions
        .filter((f) => marked.get(f.name)!.length > 0)
        .map((f) => f.name)
    );
    for (let changed = true; changed;) {
      changed = false;
      for (const f of p.functions)
        if (
          !waits.has(f.name) &&
          calls.get(f.name)!.some((c) => c.waiting && waits.has(c.fn))
        ) {
          waits.add(f.name);
          changed = true;
        }
    }
    if (!waits.has(p.entry)) return undefined;
    // The functions that the entry reaches through waiting calls.
    const reached = new Set([p.entry]);
    for (const name of reached)
      for (const c of calls.get(name)!)
        if (c.waiting && waits.has(c.fn)) reached.add(c.fn);
    let refused = false;
    for (const name of reached) {
      const loops = marked.get(name)!;
      for (const loop of [...loops]) {
        if (built.has(loop)) continue;
        const x = outlined(loop);
        if (typeof x !== 'string') built.set(loop, x);
        else {
          fallbacks?.add(x);
          loops.splice(loops.indexOf(loop), 1);
          refused = true;
        }
      }
    }
    if (!refused)
      return {
        loops: [...reached].flatMap((name) =>
          marked.get(name)!.map((loop) => built.get(loop)!)
        ),
        waits: reached,
      };
  }

  /** The worker program of the marked loop, or the reason it runs in order. */
  function outlined(loop: ParallelWork): PoolLoop | ParallelLoopFallbackReason {
    const region = loop.k === 'loop' ? loop.body : loop.regions[0];
    const carried = region.params.slice(1);
    let lists: V[] = [];
    if (loop.k === 'loop') {
      if (loop.exit !== undefined || loop.window !== undefined)
        return 'unsupported-position';
      if (
        !carried.every((v) => {
          const t = p.types[v];
          return (
            t.shape.length === 0 && (t.lane === 'real' || t.lane === 'integer')
          );
        })
      )
        return 'unsupported-accumulator';
      if (!scalarAccumulators(loop)) return 'accumulator-dependency';
      const accumulators = listAccumulators(loop);
      if (accumulators === undefined) return 'accumulator-dependency';
      lists = accumulators;
      if (carried.length + lists.length === 0) return 'no-accumulator';
    }

    // The values that the body reads from outside the loop: the operands,
    // the yields and the lengths of the types of its values, and of the
    // functions it calls, transitively.
    const inside = new Set<V>();
    const read = new Set<V>();
    const called = new Set<string>();
    const ops: string[] = [];
    const scan = (r: Region): void => {
      r.params.forEach((v) => inside.add(v));
      for (const i of r.body) {
        argsOf(i).forEach((v) => read.add(v));
        outsOf(i).forEach((v) => inside.add(v));
        if (i.k === 'call') called.add(i.fn);
        if (i.k === 'op') ops.push(i.op);
        regionsOf(i).forEach(scan);
      }
      r.yields.forEach((v) => read.add(v));
    };
    scan(region);
    for (const v of [...inside, ...read])
      lengthValues(p.types[v]).forEach((n) => read.add(n));
    for (const name of called) {
      const g = fns.get(name);
      if (g === undefined || g.name === 'main') return 'unshippable-body';
      const inner = (r: Region): void =>
        r.body.forEach((i) => {
          if (i.k === 'call') called.add(i.fn);
          if (i.k === 'op') ops.push(i.op);
          regionsOf(i).forEach(inner);
        });
      inner(g.body);
    }
    // The body reads no name of `vars`: a worker has no inputs object.
    if (ops.some((op) => HOST.test(op))) return 'host-input';
    const listSet = new Set(lists);
    const free: V[] = [];
    const seen = new Set<V>();
    const add = (v: V): void => {
      if (seen.has(v) || inside.has(v)) return;
      seen.add(v);
      lengthValues(p.types[v]).forEach(add);
      if (!listSet.has(v)) free.push(v);
    };
    [...read].forEach(add);
    lists.forEach((l) => lengthValues(p.types[l]).forEach(add));

    // A constant is copied, unless it is the length of a list that is
    // passed (a parameter's type names a parameter); every other value is
    // passed, a number, a boolean or a list of these (no colour or complex
    // object).
    const lengths = new Set(
      free.flatMap((v) =>
        def.get(v)?.k === 'const' ? [] : lengthValues(p.types[v])
      )
    );
    const types = p.types.slice();
    const fresh = (t: IRType): V => {
      types.push(t);
      return types.length - 1;
    };
    const constant = (value: number, lane: Lane): [V, Instr] => {
      const out = fresh(scalarType(lane));
      return [
        out,
        { k: 'const', out, value: { lane, value } as never } as Instr,
      ];
    };
    const body: Instr[] = [];
    const passed: V[] = [];
    for (const v of free) {
      const d = def.get(v);
      if (d?.k === 'const' && !lengths.has(v)) body.push(d);
      else if (
        !(['real', 'integer', 'boolean'] as Lane[]).includes(p.types[v].lane)
      )
        return 'unsupported-capture';
      else passed.push(v);
    }
    // The scalars first: a length is a parameter before its list.
    passed.sort(
      (a, b) =>
        Math.sign(p.types[a].shape.length) - Math.sign(p.types[b].shape.length)
    );
    const [i0, i1, lo] = [0, 1, 2].map(() => fresh(scalarType('integer')));
    for (const l of lists) {
      const t = p.types[l];
      const n = t.shape[0];
      let length: V;
      if (typeof n === 'number') {
        const [c, i] = constant(n, 'integer');
        body.push(i);
        length = c;
      } else length = n.v;
      const [z, zero] = constant(-0, t.lane);
      body.push({
        k: 'region',
        outs: [l],
        op: 'zeros',
        args: [length],
        regions: [{ params: [], body: [zero], yields: [z] }],
      });
    }
    const init = carried.map((v) => {
      const [c, i] = constant(-0, p.types[v].lane);
      body.push(i);
      return c;
    });
    let yields: V[];
    if (loop.k === 'loop') {
      body.push({
        k: 'loop',
        outs: loop.outs,
        lo,
        hi: lo,
        init,
        body: region,
        passes: true,
        window: [i0, i1],
      });
      yields = [...loop.outs, ...lists];
    } else {
      // A worker allocates only its slice. The body receives the original
      // pass index, and the worker writes its result at the slice's index.
      const count = fresh(scalarType('integer'));
      const k = fresh(scalarType('integer'));
      const out = fresh({
        lane: p.types[region.yields[0]].lane,
        shape: [{ v: count }],
      });
      body.push(
        { k: 'op', op: 'sub.int', out: count, args: [i1, i0] },
        {
          k: 'region',
          op: 'build',
          args: [count],
          outs: [out],
          regions: [
            {
              params: [k],
              body: [
                { k: 'op', op: 'add.int', out: region.params[0], args: [i0, k] },
                ...region.body,
              ],
              yields: region.yields,
            },
          ],
        }
      );
      yields = [out];
    }
    const params = [i0, i1, lo, ...passed];
    const main: IRFunction = {
      name: 'main',
      paramNames: params.map((v) => `v${v}`),
      lengthOf: params.map(() => false),
      positional: params.length,
      literal: true,
      tuple: true,
      body: { params, body, yields },
      results: yields.map((v) => types[v]),
    };
    const worker: Program = {
      types,
      functions: [main, ...[...called].map((name) => fns.get(name)!)],
      entry: 'main',
    };
    try {
      verify(worker, rows);
    } catch (e) {
      // A defect of the outliner: the loop runs in order, and the checks of
      // the test suite report it.
      if (passChecksOn()) throw e;
      return 'unshippable-body';
    }
    // Its `run` is built at the first sub-range that the calling thread
    // runs again.
    const printed = printJavaScript(
      worker,
      rows,
      ce,
      syntax,
      undefined,
      undefined,
      true
    );
    if (!isShippableCode(`${printed.preambleOnce}\n${printed.code}`))
      return 'unshippable-body';
    return { loop, passed, lists, printed };
  }

  /**
   * Each value that `loop` carries is a scalar accumulator (6.1): each
   * value of the body has at most one root, the carried parameter from
   * which it accumulates; an `add` of one value with a root has its root, an
   * `if` result the root of the yields of both arms, an inner loop result
   * the root of its initial value when its body yields its own parameter's
   * accumulation there. Every other read of a value with a root (an
   * operand of another operation, a call, a condition, a yield to another
   * position) fails.
   */
  function scalarAccumulators(loop: Loop): boolean {
    const root = new Map<V, V>();
    const params = loop.body.params;
    params.slice(1).forEach((v) => root.set(v, v));
    const ok = (r: Region): boolean => {
      for (const i of r.body) {
        if (isAdd(i)) {
          const [a, b] = i.args.map((v) => root.get(v));
          if (a !== undefined && b !== undefined) return false;
          if ((a ?? b) !== undefined) root.set(i.out, (a ?? b)!);
          continue;
        }
        if (i.k === 'if') {
          if (root.has(i.cond) || !ok(i.then) || !ok(i.else)) return false;
          for (let m = 0; m < i.outs.length; m++) {
            const [a, b] = [i.then, i.else].map((x) => root.get(x.yields[m]));
            if (a !== b) return false;
            if (a !== undefined) root.set(i.outs[m], a);
          }
          continue;
        }
        if (i.k === 'loop') {
          if (root.has(i.lo) || root.has(i.hi)) return false;
          const inner = i.body.params;
          i.init.forEach((v, m) => {
            if (root.has(v)) root.set(inner[m + 1], inner[m + 1]);
          });
          if (!ok(i.body)) return false;
          for (let m = 0; m < i.init.length; m++) {
            const r0 = root.get(i.init[m]);
            const y = root.get(i.body.yields[m]);
            if (r0 === undefined ? y !== undefined : y !== inner[m + 1])
              return false;
            if (r0 !== undefined) root.set(i.outs[m], r0);
          }
          continue;
        }
        if (argsOf(i).some((v) => root.has(v))) return false;
        for (const x of regionsOf(i))
          if (!ok(x) || x.yields.some((v) => root.has(v))) return false;
      }
      return true;
    };
    if (!ok(loop.body)) return false;
    return loop.body.yields.every((y, j) => root.get(y) === params[j + 1]);
  }

  /**
   * The list accumulators of `loop` (6.1): the arrays defined outside it
   * that its body writes (`set`), each of the lane `real` or `integer`,
   * whose only uses in the body, in any nested region, are triples
   * `set(L, k, add(get(L, k), e))` of one index value, in one region with no
   * other use of `L` between the read and the write. `undefined` when an
   * array that the body writes is not one.
   */
  function listAccumulators(loop: Loop): V[] | undefined {
    const inside = new Set<V>();
    const writes: (Instr & { k: 'op' })[] = [];
    const scan = (r: Region): void => {
      r.params.forEach((v) => inside.add(v));
      for (const i of r.body) {
        outsOf(i).forEach((v) => inside.add(v));
        if (i.k === 'op' && (i.op === 'set' || i.op === 'set.bool'))
          writes.push(i);
        regionsOf(i).forEach(scan);
      }
    };
    scan(loop.body);
    const lists = [...new Set(writes.map((i) => i.args[0]))];
    if (lists.some((l) => inside.has(l))) return undefined;
    for (const l of lists) {
      const t = p.types[l];
      if (t.shape.length !== 1 || !(t.lane === 'real' || t.lane === 'integer'))
        return undefined;
      // The reads matched to a write.
      const matched = new Set<Instr>();
      const mentions = (i: Instr): boolean =>
        argsOf(i).includes(l) ||
        regionsOf(i).some((r) => r.yields.includes(l) || r.body.some(mentions));
      const check = (r: Region): boolean => {
        if (r.yields.includes(l)) return false;
        for (let s = 0; s < r.body.length; s++) {
          const i = r.body[s];
          if (!(i.k === 'op' && i.op === 'set' && i.args[0] === l)) continue;
          const [, k, a] = i.args;
          const sum = def.get(a);
          if (!isAdd(sum) || uses.get(a) !== 1 || uses.get(i.out)) return false;
          const g = sum.args
            .map((v) => def.get(v))
            .find(
              (x) =>
                x?.k === 'op' &&
                x.op === 'get' &&
                x.args[0] === l &&
                x.args[1] === k &&
                uses.get(x.out) === 1 &&
                !matched.has(x)
            );
          const at = g === undefined ? -1 : r.body.indexOf(g);
          if (at < 0 || at > s) return false;
          if (r.body.slice(at + 1, s).some(mentions)) return false;
          matched.add(g!);
        }
        return r.body.every((i) => regionsOf(i).every(check));
      };
      if (!check(loop.body)) return undefined;
      // Every other use of the array is a read.
      const other = (r: Region): boolean =>
        r.yields.includes(l) ||
        r.body.some(
          (i) =>
            (argsOf(i).includes(l) &&
              !(i.k === 'op' && i.op === 'set') &&
              !matched.has(i)) ||
            regionsOf(i).some(other)
        );
      if (other(loop.body)) return undefined;
    }
    return lists;
  }
}
