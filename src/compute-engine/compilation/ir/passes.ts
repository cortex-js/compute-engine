/**
 * The passes of the slice compiler. Each pass is target-independent and
 * keeps the value of the program within the target's precision; none
 * changes the operation of a computation (`a/b` stays a division).
 *
 * - `scalarize`: an operation on static lists becomes one operation per
 *   element (for a target with no element-wise operations, and for the
 *   short lists of the interval mode, `unrollBuilds`), and an `At` of a
 *   constant index in range of a static list an element (`elem`).
 * - `fold`: a pure operation whose operands are constants is the value of
 *   its row's `fold` (the constants that the passes expose: a sub-expression
 *   with no input is a literal already, `lower.ts`); an element of a list
 *   literal is that element; an element of an element-wise operation is the
 *   operation on elements; the `At` of `scalarize`; a conditional with no
 *   effect whose condition is a constant is the arm it takes. A value
 *   replaces another only on its lane (an integer arm of a real result
 *   stays an arm). The list rules (the elements and the `At`) compute no
 *   number, and run alone in the interval mode (`fold: 'lists'`).
 * - `hoist`: the operands of `And` and `Or` are lowered in an arm (only
 *   evaluated when needed); a pure operand is moved out of its arm, and the
 *   conditional becomes the `and` or `or` it is.
 * - `strength`: `pow` with a literal exponent 1 to 16 is a product: the
 *   definition of `pow` (`realPow()`).
 * - `inline`: a call of a small user function is a copy of its body
 *   (`inline` below), so that `cse` and `invariants` see the calls it makes.
 * - `cse`: an instruction that repeats an earlier mergeable one whose value
 *   is visible reads that value instead, and so does a call of a function
 *   that is not effectful (also one on a cycle of calls), merged with an
 *   earlier visible call of the same arguments, which failed if this one
 *   would (each of its results).
 *   No value is moved.
 * - `invariants`: an instruction of a loop body that reads nothing that the
 *   body computes is computed once, before the loop (`invariants` below).
 * - `dce`: an instruction whose values are not read (by an instruction, a
 *   yield or a type) is removed, when it is removable.
 *
 * `fold`, `hoist`, `strength`, `inline`, `cse`, `invariants` and `dce` run
 * again while
 * one of them changes the program: `cse` then merges a value moved out of
 * two loops. After each pass the program is verified, and its
 * effectful instructions must be the same, in the same regions and order,
 * on the same operands (renamed by the pass).
 */

import {
  argsOf,
  elementIndex,
  elementType,
  lengthValues,
  literalKey,
  mapDirectArgs,
  mapLengths,
  outsOf,
  recursiveFunctions,
  regionsOf,
  scalarType,
  useIndex,
  type Constant,
  type IRType,
  type Instr,
  type Literal,
  type Program,
  type Region,
  type V,
} from './ir.js';
import { effects, effectTrace, sameTrace } from './effects.js';
import {
  foldOf,
  MAX_PRODUCT_EXPONENT,
  rowOfOp,
  type OperatorRow,
} from './operators.js';
import { SliceInternalError, verify } from './verify.js';

export type PassOptions = {
  scalarize?: boolean;
  /** `'lists'`: only the list rules of `fold`, which compute no number
   *  (the interval mode). */
  fold?: boolean | 'lists';
  hoist?: boolean;
  strength?: boolean;
  /** The calls that `inline` replaces: `'loop'`, a call in the body of a
   *  `loop`, a `build` or a `filter`; `'repeated'`, also a call of a
   *  function that its caller calls twice or more. */
  inline?: 'loop' | 'repeated' | false;
  /** The short lists (the interval mode): `scalarize` writes out an
   *  element-wise operation of at most this many elements, and `inline`
   *  copies a call whose result is such a list. Default 0: none. */
  unrollBuilds?: number;
  cse?: boolean;
  invariants?: boolean;
  /** `invariants` moves a loop over the elements of a list that exists out
   *  of a loop that can run no pass: off where such a loop can fail (the
   *  interval mode with an `iterationBudget`, whose limit refuses a loop of
   *  more passes). */
  listLoops?: boolean;
  dce?: boolean;
};

export const ALL_PASSES: PassOptions = Object.freeze({
  fold: true,
  hoist: true,
  strength: true,
  inline: 'loop',
  cse: true,
  invariants: true,
  dce: true,
});

/** The most instructions of a body that `inline` copies (arms included),
 *  and of all its copies in one program, by the rule of the sites. The
 *  rule `'repeated'` is the interval mode's, where the sums written out
 *  multiply the sites: a function read at 16 terms of each of four sums. */
export const INLINE_SIZE = 64;
export const INLINE_BUDGET = { loop: 1000, repeated: 4000 } as const;

/** A pass: whether it changed the program, and how it renamed values. */
type Pass = (
  p: Program,
  rows: readonly OperatorRow[]
) => { changed: boolean; resolve: (v: V) => V };

export function runPasses(
  p: Program,
  options: PassOptions,
  rows: readonly OperatorRow[]
): Program {
  const ids = new Map<Region, number>();
  const run = (name: string, pass: Pass): boolean => {
    const before = effectTrace(p, rows, ids).map((x) => ({
      ...x,
      args: [...x.args],
      outs: [...x.outs],
    }));
    const { changed, resolve } = pass(p, rows);
    verify(p, rows);
    if (!sameTrace(before, effectTrace(p, rows, ids), resolve))
      throw new SliceInternalError(
        `slice pass ${name} changed the effectful instructions`
      );
    return changed;
  };
  const short = options.unrollBuilds ?? 0;
  if (options.scalarize || short > 0)
    run('scalarize', (q, r) =>
      scalarize(q, r, options.scalarize ? SCALARIZE_LIMIT : short)
    );
  const budget = { left: options.inline ? INLINE_BUDGET[options.inline] : 0 };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    const lists = options.fold === 'lists';
    if (options.fold)
      changed = run('fold', (q, r) => fold(q, r, lists)) || changed;
    if (options.hoist) changed = run('hoist', hoist) || changed;
    if (options.strength) changed = run('strength', strength) || changed;
    const where = options.inline;
    if (where)
      changed =
        run('inline', (q, r) => inline(q, r, where, budget, short)) || changed;
    if (options.cse) changed = run('cse', cse) || changed;
    if (options.invariants)
      changed =
        run('invariants', (q, r) =>
          invariants(q, r, options.listLoops !== false)
        ) || changed;
    if (options.dce) changed = run('dce', dce) || changed;
    if (!changed) break;
  }
  return p;
}

/** What `rewrite()` gives `f` with an instruction: `subst`, where `f`
 *  records each value that another value replaces; the value of each
 *  constant rewritten so far; `seen`, keys of `f` visible in the open
 *  regions (`set` writes in the innermost). */
type Rewriting<T> = {
  subst: Map<V, V>;
  constants: ReadonlyMap<V, Constant>;
  seen: { get(key: string): T | undefined; set(key: string, value: T): void };
};

/**
 * Rewrite each region of `p` once, in order. `f` returns `undefined` to
 * keep an instruction, or the instructions that replace it, which are
 * rewritten in turn. The operands of an instruction (and the lengths of
 * the types) are substituted.
 */
function rewrite<T = never>(
  p: Program,
  f: (i: Instr, cx: Rewriting<T>) => Instr[] | undefined
): { changed: boolean; resolve: (v: V) => V } {
  const subst = new Map<V, V>();
  const constants = new Map<V, Constant>();
  const scopes: Map<string, T>[] = [];
  const cx: Rewriting<T> = {
    subst,
    constants,
    seen: {
      get: (key) => scopes.find((s) => s.has(key))?.get(key),
      set: (key, value) => void scopes[scopes.length - 1].set(key, value),
    },
  };
  let changed = false;
  const resolve = (v: V): V => {
    while (subst.has(v)) v = subst.get(v)!;
    return v;
  };
  const instrs = (list: Instr[], out: Instr[]) => {
    for (const i of list) {
      mapDirectArgs(i, resolve);
      if (i.k === 'const') constants.set(i.out, i.value.value);
      const replacement = f(i, cx);
      if (replacement === undefined) {
        regionsOf(i).forEach(region);
        out.push(i);
      } else {
        changed = true;
        instrs(replacement, out);
      }
    }
  };
  const region = (r: Region) => {
    scopes.push(new Map());
    const body: Instr[] = [];
    instrs(r.body, body);
    r.body = body;
    r.yields = r.yields.map(resolve);
    scopes.pop();
  };
  for (const fn of p.functions) region(fn.body);
  if (subst.size > 0) {
    p.types = p.types.map((t) => mapLengths(t, resolve));
    for (const fn of p.functions)
      fn.results.splice(
        0,
        Infinity,
        ...fn.results.map((t) => mapLengths(t, resolve))
      );
  }
  return { changed: changed || subst.size > 0, resolve };
}

/** A new value of type `t`. */
const fresh = (p: Program, t: IRType): V => p.types.push(t) - 1;

/** An integer constant `value`, appended to `out`. */
function integer(p: Program, value: number, out: Instr[]): V {
  const v = fresh(p, scalarType('integer'));
  out.push({ k: 'const', out: v, value: { lane: 'integer', value } });
  return v;
}

/** The element `k` of the list `a`: a constant index and an `elem`. */
function element(p: Program, a: V, k: number, out: Instr[]): V {
  const index = integer(p, k, out);
  const e = fresh(p, elementType(p.types[a]));
  out.push({ k: 'op', out: e, op: 'elem', args: [a, index] });
  return e;
}

/** `At(l, i)` of a constant index `i` in range of a static list `l` as an
 *  `elem`, or `undefined`. */
function atToElem(
  p: Program,
  i: Instr,
  constants: ReadonlyMap<V, Constant>
): Instr[] | undefined {
  if (i.k !== 'op' || i.op !== 'at') return undefined;
  const [l, index] = i.args;
  const k = elementIndex(p.types[l].shape[0], constants.get(index));
  if (k === undefined) return undefined;
  const out: Instr[] = [];
  out.push({ k: 'op', out: i.out, op: 'elem', args: [l, integer(p, k, out)] });
  return out;
}

/** Whether the operation `op` applies to each element of a list result. */
const threads = (rows: readonly OperatorRow[], op: string) =>
  rowOfOp(rows, op)?.row.threads === true;

/** The instructions that compute the element-wise `op` `i` on scalars. */
function perElement(
  p: Program,
  rows: readonly OperatorRow[],
  i: Instr & { k: 'op' },
  out: Instr[]
): V {
  const t = p.types[i.out];
  if (t.shape.length === 0 || !threads(rows, i.op)) {
    out.push(i);
    return i.out;
  }
  const elements: V[] = [];
  for (let k = 0; k < (t.shape[0] as number); k++) {
    const args = i.args.map((a) =>
      p.types[a].shape.length === 0 ? a : element(p, a, k, out)
    );
    const o = fresh(p, elementType(t));
    elements.push(
      perElement(p, rows, { k: 'op', out: o, op: i.op, args }, out)
    );
  }
  out.push({ k: 'list', out: i.out, args: elements });
  return i.out;
}

/** The most elements of a list that `scalarize` writes one by one. */
export const SCALARIZE_LIMIT = 64;

/** The number of elements of `t`, NaN for a length that is a value. */
const count = (t: IRType): number =>
  t.shape.reduce<number>((m, n) => (typeof n === 'number' ? m * n : NaN), 1);

const scalarize = (
  p: Program,
  rows: readonly OperatorRow[],
  limit: number
): ReturnType<Pass> =>
  rewrite(p, (i, { constants }) => {
    if (i.k !== 'op') return undefined;
    const at = atToElem(p, i, constants);
    if (at !== undefined) return at;
    const t = p.types[i.out];
    if (t.shape.length === 0 || !threads(rows, i.op)) return undefined;
    // A longer list stays element-wise: one expression per element would
    // make text without bound, and the target's check (`admits()`) refuses it.
    if (!(count(t) <= limit)) return undefined;
    const out: Instr[] = [];
    perElement(p, rows, i, out);
    return out;
  });

/** A value of `a` replaces `b` only on the same lane: an integer that
 *  stands for a real result (an arm, a list cell, `pow`) would narrow the
 *  types computed from `b` (a `build` of it). */
const sameLane = (p: Program, a: V, b: V) =>
  p.types[a].lane === p.types[b].lane;

/** With `lists`, only the list rules: an element of a list or of an
 *  element-wise operation, and the `At` of `scalarize`. */
const fold = (
  p: Program,
  rows: readonly OperatorRow[],
  lists = false
): ReturnType<Pass> => {
  const fx = effects(p, rows);
  const defs = new Map<V, Instr>();
  // `seen`: the element of an operation on lists, by list and index, written
  // in the region or a region around it: a shared graph is rewritten once
  // per element, not once per path.
  return rewrite<V>(p, (i, { subst, constants, seen }) => {
    for (const o of outsOf(i)) defs.set(o, i);
    const at = atToElem(p, i, constants);
    if (at !== undefined) return at;
    if (i.k === 'op' && i.op === 'elem' && constants.has(i.args[1])) {
      const [a, index] = i.args;
      const k = constants.get(index) as number;
      const list = defs.get(a);
      if (list?.k === 'list' && sameLane(p, list.args[k], i.out)) {
        subst.set(i.out, list.args[k]);
        return [];
      }
      if (list?.k === 'op' && fx.speculatable(list) && threads(rows, list.op)) {
        const key = `${a},${k}`;
        const known = seen.get(key);
        if (known !== undefined) {
          subst.set(i.out, known);
          return [];
        }
        // The operation on the elements of its list operands; a new value
        // of the operation's element type (`i.out` can have a wider lane).
        const out: Instr[] = [];
        const args = list.args.map((x) =>
          p.types[x].shape.length === 0 ? x : element(p, x, k, out)
        );
        const o = fresh(p, elementType(p.types[list.out]));
        out.push({ k: 'op', out: o, op: list.op, args });
        subst.set(i.out, o);
        seen.set(key, o);
        return out;
      }
    }
    if (lists) return undefined;
    if (
      i.k === 'op' &&
      fx.speculatable(i) &&
      i.args.every((a) => constants.has(a))
    ) {
      const args = i.args.map((a) => constants.get(a)!);
      const value = foldOf(rows, i.op)?.(...args);
      if (value !== undefined)
        return [
          {
            k: 'const',
            out: i.out,
            value: { lane: p.types[i.out].lane, value } as Literal,
          },
        ];
    }
    if (i.k === 'if' && constants.has(i.cond) && fx.of(i) !== 'effectful') {
      const taken = constants.get(i.cond) ? i.then : i.else;
      if (!taken.yields.every((y, j) => sameLane(p, y, i.outs[j])))
        return undefined;
      taken.yields.forEach((y, j) => subst.set(i.outs[j], y));
      return taken.body;
    }
    return undefined;
  });
};

/** `if (c) { …y } else { false }` is `and(c, y)`, `if (c) { true } else
 *  { …y }` is `or(c, y)`, when the body of `y` is pure: it moves out. */
const hoist: Pass = (p, rows) => {
  const fx = effects(p, rows);
  return rewrite(p, (i, { constants }) => {
    if (i.k !== 'if' || i.outs.length !== 1) return undefined;
    const decided = (r: Region) => {
      const c = r.body.find((x) => x.k === 'const' && x.out === r.yields[0]);
      return r.body.every((x) => x.k === 'const')
        ? ((c as { value?: Literal } | undefined)?.value?.value ??
            constants.get(r.yields[0]))
        : undefined;
    };
    const op =
      decided(i.else) === false
        ? 'and'
        : decided(i.then) === true
          ? 'or'
          : undefined;
    if (op === undefined) return undefined;
    const arm = op === 'and' ? i.then : i.else;
    if (!arm.body.every((x) => fx.speculatable(x))) return undefined;
    return [
      ...arm.body,
      { k: 'op', out: i.outs[0], op, args: [i.cond, arm.yields[0]] },
    ];
  });
};

const strength: Pass = (p) =>
  rewrite(p, (i, { subst, constants }) => {
    if (i.k !== 'op' || i.op !== 'pow') return undefined;
    const [base, exponent] = i.args;
    const n = constants.get(exponent);
    const t = p.types[i.out];
    if (n === 1 && sameLane(p, base, i.out)) {
      subst.set(i.out, base);
      return [];
    }
    if (
      typeof n === 'number' &&
      Number.isInteger(n) &&
      n >= 2 &&
      n <= MAX_PRODUCT_EXPONENT
    ) {
      const out: Instr[] = [];
      let acc = base;
      for (let k = 1; k < n; k++) {
        const next = k === n - 1 ? i.out : fresh(p, t);
        out.push({ k: 'op', out: next, op: 'mul', args: [acc, base] });
        acc = next;
      }
      return out;
    }
    return undefined;
  });

const cse: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const key = (i: Instr): string | undefined => {
    // A call of a function with no effect: a `may-fail` one too (a function
    // on a cycle of calls), since the visible call failed if this one would.
    if (i.k === 'call')
      return fx.of(i) !== 'effectful'
        ? `c ${i.fn} ${i.args.join(',')}`
        : undefined;
    if (!fx.mergeable(i)) return undefined;
    if (i.k === 'const') return literalKey(i.value);
    if (i.k === 'op') return `o ${i.op} ${i.args.join(',')}`;
    if (i.k === 'list') return `l ${p.types[i.out].lane} ${i.args.join(',')}`;
    return undefined;
  };
  // `seen`: the keys of the visible instructions to their values.
  return rewrite<V[]>(p, (i, { subst, seen }) => {
    const k = key(i);
    if (k === undefined) return undefined;
    const found = seen.get(k);
    if (found !== undefined) {
      outsOf(i).forEach((o, j) => subst.set(o, found[j]));
      return [];
    }
    seen.set(k, outsOf(i));
    return undefined;
  });
};

/** Whether `test` holds for `i` or for an instruction of its regions. */
const some = (i: Instr, test: (x: Instr) => boolean): boolean =>
  test(i) || regionsOf(i).some((r) => r.body.some((x) => some(x, test)));

/** The body that a `loop`, a `build` or a `filter` repeats. */
const repeated = (i: Instr): Region | undefined =>
  i.k === 'loop'
    ? i.body
    : i.k === 'region' && (i.op === 'build' || i.op === 'filter')
      ? i.regions[0]
      : undefined;

/** `t` is a list of a constant length of at most `n` elements. */
const shortList = (t: IRType, n: number): boolean =>
  n > 0 && t.shape.length > 0 && count(t) <= n;

/** The number of instructions of `r`, nested regions included. */
const size = (r: Region): number =>
  r.body.reduce((n, i) => regionsOf(i).reduce((m, x) => m + size(x), n + 1), 0);

/** The pass `inline` (README, "User functions", the rule): a call that
 *  `where` names is a copy of its callee's body. */
const inline = (
  p: Program,
  rows: readonly OperatorRow[],
  where: 'loop' | 'repeated',
  budget: { left: number },
  short = 0
): ReturnType<Pass> => {
  const fx = effects(p, rows);
  const cyclic = recursiveFunctions(p.functions);
  const byName = new Map(p.functions.map((f) => [f.name, f.body]));
  // Each call: its function, and whether it is in a repeated body; the
  // number of calls of each callee in each function.
  type Site = { fn: string; loop: boolean };
  const sites = new Map<Instr, Site>();
  const counts = new Map<string, number>();
  const site = (i: Instr & { k: 'call' }, s: Site) => {
    sites.set(i, s);
    counts.set(`${s.fn} ${i.fn}`, (counts.get(`${s.fn} ${i.fn}`) ?? 0) + 1);
  };
  const walk = (fn: string, r: Region, loop: boolean): void =>
    r.body.forEach((i) => {
      if (i.k === 'call') site(i, { fn, loop });
      regionsOf(i).forEach((x) => walk(fn, x, loop || repeated(i) === x));
    });
  p.functions.forEach((f) => walk(f.name, f.body, false));
  // The functions whose body, or the body of a function it calls, holds an
  // `At`.
  const reads = new Set<string>();
  for (let more = true; more;) {
    more = false;
    for (const f of p.functions) {
      const at = (z: Instr) =>
        (z.k === 'op' && z.op === 'at') || (z.k === 'call' && reads.has(z.fn));
      if (reads.has(f.name) || !f.body.body.some((x) => some(x, at))) continue;
      reads.add(f.name);
      more = true;
    }
  }
  return rewrite(p, (i, { subst, constants }) => {
    if (i.k !== 'call' || fx.of(i) === 'effectful' || cyclic.has(i.fn))
      return undefined;
    const g = byName.get(i.fn)!;
    const s = sites.get(i)!;
    const n = size(g);
    const m = new Map(g.params.map((q, k) => [q, i.args[k]]));
    const v = (x: V) => m.get(x) ?? x;
    if (
      n > Math.min(INLINE_SIZE, budget.left) ||
      i.outs.length !== 1 ||
      !sameLane(p, v(g.yields[0]), i.outs[0]) ||
      g.body.some((x) => some(x, (z) => z.k === 'loop' || z.k === 'region')) ||
      // An `At` whose index the copy makes a constant out of range declines
      // on GLSL, where the call gives NaN.
      (i.args.some((a) => constants.has(a)) && reads.has(i.fn)) ||
      // In the interval mode (the rule 'repeated') nothing is copied into a
      // function on a cycle of calls: an `if` there runs one arm
      // (`verdictIf.decided`), so a copied `if` of the callee would lose
      // its hull.
      (where === 'repeated' && cyclic.has(s.fn)) ||
      i.args.some(
        (a, k) => p.types[a].shape.length > 0 && !sameLane(p, a, g.params[k])
      ) ||
      !(
        s.loop ||
        (where === 'repeated' && counts.get(`${s.fn} ${i.fn}`)! > 1) ||
        shortList(p.types[i.outs[0]], short)
      )
    )
      return undefined;
    budget.left -= n;
    const out = (x: V) => m.set(x, fresh(p, mapLengths(p.types[x], v))).get(x)!;
    const copy = (r: Region): Region => ({
      params: [],
      body: r.body.map((x) => {
        const c = { ...x };
        mapDirectArgs(c, v);
        if (c.k === 'if') [c.then, c.else] = [copy(c.then), copy(c.else)];
        if (c.k === 'call') site(c, s);
        if ('outs' in c) c.outs = c.outs.map(out);
        else c.out = out(c.out);
        return c;
      }),
      yields: r.yields.map(v),
    });
    const { body, yields } = copy(g);
    subst.set(i.outs[0], yields[0]);
    return body;
  });
};

/**
 * An instruction at the top level of a repeated body that reads no
 * parameter of the body and no value of the body that stays moves to just
 * before the loop, the inner loops first (README, "Effects"). What moves:
 * - a pure instruction, unless `hazard`: the pass `plain` of the interval
 *   mode makes it throw (`_IA.rangeCount()`, `_IA.number()`);
 * - one that can fail, or a call that is not effectful and not on a cycle
 *   of calls, out of a loop that runs a pass and is not a `Loop`, before
 *   the first effectful instruction of the body: it failed in the first
 *   pass if it fails before the loop;
 * - out of a loop that can run no pass, a build with a pure body over the
 *   elements of a list that exists, and with `listLoops` a loop over them:
 *   each runs once, no longer than the list took to make.
 */
const invariants = (
  p: Program,
  rows: readonly OperatorRow[],
  listLoops: boolean
): ReturnType<Pass> => {
  const fx = effects(p, rows);
  const cyclic = recursiveFunctions(p.functions);
  const constants = new Map<V, Constant>();
  const { def: defs } = useIndex(p);
  // The index of each loop, build and filter.
  const indices = new Set<V>();
  // The lengths of the lists that exist where the length is visible.
  const lengths = new Set<V>();
  const ofLists = (vs: V[]) =>
    vs.forEach((v) =>
      lengthValues(p.types[v]).forEach((n) => {
        if (vs.includes(n)) lengths.add(n);
      })
    );
  const index = (r: Region) =>
    r.body.forEach((i) => {
      if (i.k === 'const') constants.set(i.out, i.value.value);
      if (i.k === 'call' || i.k === 'region') ofLists(i.outs);
      // The shortest of such lists (`PointList(A, B)`).
      if (
        i.k === 'op' &&
        i.op === 'min.int' &&
        i.args.every((a) => lengths.has(a))
      )
        lengths.add(i.out);
      const body = repeated(i);
      if (body !== undefined) indices.add(body.params[0]);
      regionsOf(i).forEach(index);
    });
  for (const f of p.functions) {
    ofLists(f.body.params);
    index(f.body);
  }
  const integer = (v: V) => {
    const c = constants.get(v);
    return typeof c === 'number' ? c : undefined;
  };
  const pure = (r: Region) => r.body.every((x) => fx.of(x) === 'pure');
  const hazard = (x: Instr) =>
    x.k === 'call' ||
    (x.k === 'op' &&
      (x.op === 'rangecount' ||
        x.op === 'rangestep' ||
        (x.op === 'elem' &&
          integer(x.args[1]) === undefined &&
          !indices.has(x.args[1]))));
  /** A loop or a build over the elements of a list that exists. */
  const overList = (x: Instr): boolean => {
    if (x.k === 'region') return x.op === 'build' && lengths.has(x.args[0]);
    if (!listLoops || x.k !== 'loop' || x.passes === true) return false;
    if (integer(x.lo) !== 0) return false;
    const hi = defs.get(x.hi);
    return (
      hi?.k === 'op' &&
      hi.op === 'sub.int' &&
      lengths.has(hi.args[0]) &&
      integer(hi.args[1]) === 1
    );
  };
  let changed = false;
  /** The instructions that move out of `body`, the body of `loop`. */
  const moveOut = (loop: Instr, body: Region): Instr[] => {
    const counted = loop.k === 'loop' && loop.passes === true;
    const lo = loop.k === 'loop' ? integer(loop.lo) : 1;
    const hi = integer(loop.k === 'loop' ? loop.hi : argsOf(loop)[0]);
    const runs = lo !== undefined && hi !== undefined && lo <= hi;
    const variant = new Set<V>(body.params);
    const inBody = (v: V) => variant.has(v);
    const reads = (x: Instr) =>
      argsOf(x).some(inBody) ||
      outsOf(x).some((o) => lengthValues(p.types[o]).some(inBody)) ||
      regionsOf(x).some((r) => r.yields.some(inBody));
    let effect = false;
    const moved: Instr[] = [];
    const kept: Instr[] = [];
    for (const x of body.body) {
      const e = fx.of(x);
      const free = !some(x, reads);
      const risky = some(x, hazard);
      const ok =
        free &&
        ((e === 'pure' && !risky) ||
          (e !== 'effectful' &&
            !effect &&
            !counted &&
            !some(x, (y) => y.k === 'call' && cyclic.has(y.fn)) &&
            (runs || (overList(x) && !risky && regionsOf(x).every(pure)))));
      if (ok) moved.push(x);
      else {
        kept.push(x);
        outsOf(x).forEach((o) => variant.add(o));
        if (e === 'effectful') effect = true;
      }
    }
    if (moved.length > 0) {
      changed = true;
      body.body = kept;
    }
    return moved;
  };
  const visit = (r: Region) => {
    const out: Instr[] = [];
    for (const i of r.body) {
      regionsOf(i).forEach(visit);
      const body = repeated(i);
      if (body !== undefined) out.push(...moveOut(i, body));
      out.push(i);
    }
    r.body = out;
  };
  p.functions.forEach((f) => visit(f.body));
  return { changed, resolve: (v) => v };
};

/** One backward pass per region: an instruction is kept when one of its
 *  values is read later (or names the length of a value read later), or
 *  when it is not removable. */
const dce: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const live = new Set<V>();
  let changed = false;
  const read = (v: V) => {
    live.add(v);
    lengthValues(p.types[v]).forEach((n) => live.add(n));
  };
  const region = (r: Region) => {
    r.yields.forEach(read);
    const kept: Instr[] = [];
    for (let j = r.body.length - 1; j >= 0; j--) {
      const i = r.body[j];
      if (!outsOf(i).some((v) => live.has(v)) && fx.removable(i)) {
        changed = true;
        continue;
      }
      outsOf(i).forEach(read);
      argsOf(i).forEach(read);
      regionsOf(i).forEach(region);
      kept.push(i);
    }
    r.body = kept.reverse();
  };
  for (const f of p.functions) {
    f.body.params.forEach(read);
    region(f.body);
  }
  return { changed, resolve: (v) => v };
};
