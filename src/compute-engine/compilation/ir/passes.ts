/**
 * The passes of the slice compiler. Each pass is target-independent and
 * keeps the value of the program within the target's precision; none
 * changes the operation of a computation (`a/b` stays a division).
 *
 * - `scalarize`: an operation on static lists becomes one operation per
 *   element (for a target with no element-wise operations, and for the
 *   short lists of JavaScript, `unrollBuilds`), and an `At` of a
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
 *   would (each of its results); so is an instruction with regions that is
 *   not effectful, by its structure (`regionKey` below).
 *   No value is moved.
 * - `invariants`: an instruction of a loop body that reads nothing that the
 *   body computes is computed once, before the loop (`invariants` below).
 * - `forward` (JavaScript, not the bigint and interval modes): a pure build
 *   or filter that one instruction reads is read where it is, with no list
 *   (`forward` and `filters` below).
 * - `dce`: an instruction whose values are not read (by an instruction, a
 *   yield or a type) is removed, when it is removable.
 *
 * `fold`, `hoist`, `strength`, `inline`, `cse`, `invariants`, `forward` and
 * `dce` run again while
 * one of them changes the program: `cse` then merges a value moved out of
 * two loops. When the checks are on (`setPassChecks()`, on in the test
 * suite), after each pass the program is verified, and its
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
  typeToString,
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
import { passChecksOn, SliceInternalError, verify } from './verify.js';

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
  /** The short lists (JavaScript): `scalarize` writes out an
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
  /** `forward`: a pure build that one instruction reads is read where it
   *  is, with no list (`forward` below). */
  forward?: boolean;
  dce?: boolean;
};

export const ALL_PASSES: PassOptions = Object.freeze({
  fold: true,
  hoist: true,
  strength: true,
  inline: 'loop',
  cse: true,
  invariants: true,
  forward: true,
  dce: true,
});

/** The most instructions of a body that `inline` copies (arms included),
 *  and the most instructions by which its copies grow the program, by the
 *  rule of the sites. The growth is measured at the start of each round of
 *  the passes, so a copy that the other passes shrink (a call with a
 *  constant argument folds) gives back its instructions; in one round the
 *  copies are at most the budget that is left. The rule `'repeated'` is
 *  JavaScript's, where the sums written out multiply the sites: a function
 *  read at 16 terms of each of four sums. */
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
    if (!passChecksOn()) return pass(p, rows).changed;
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
  // The budget of `inline` (`INLINE_BUDGET`) bounds the growth of the
  // program since the passes started, measured before `inline` in each
  // round.
  const cap = options.inline ? INLINE_BUDGET[options.inline] : 0;
  const total = () => p.functions.reduce((n, f) => n + size(f.body), 0);
  const start = total();
  const budget = { left: cap, grown: new Set<string>() };
  for (let round = 0; round < 8; round++) {
    let changed = false;
    const lists = options.fold === 'lists';
    if (options.fold)
      changed = run('fold', (q, r) => fold(q, r, lists)) || changed;
    if (options.hoist) changed = run('hoist', hoist) || changed;
    if (options.strength) changed = run('strength', strength) || changed;
    const where = options.inline;
    if (where) budget.left = Math.min(cap, cap - (total() - start));
    if (where)
      changed =
        run('inline', (q, r) => inline(q, r, where, budget, short)) || changed;
    if (options.cse) changed = run('cse', cse) || changed;
    if (options.invariants)
      changed =
        run('invariants', (q, r) =>
          invariants(q, r, options.listLoops !== false)
        ) || changed;
    if (options.forward) changed = run('forward', forward) || changed;
    if (options.forward) changed = run('filters', filters) || changed;
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
  if (i.k !== 'op' || !['at', 'atu', 'atp'].includes(i.op)) return undefined;
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

/** The rule of `fold: 'lists'` on an exact zero, which computes no
 *  number: an `add` with an exact zero as an operand is its other operand.
 *  An exact zero is printed as the point `[0, 0]` or `[-0, -0]`: the
 *  integer literal 0, its `neg`, its `elem` at a constant index of a
 *  `list`, and its `div` by a nonzero integer literal (README, "The
 *  interval mode"). */
function zeros(
  p: Program,
  i: Instr,
  defs: Map<V, Instr>,
  constants: ReadonlyMap<V, Literal['value']>,
  subst: Map<V, V>
): Instr[] | undefined {
  const integer = (v: V) => {
    const d = defs.get(v);
    return d?.k === 'const' && d.value.lane === 'integer'
      ? d.value.value
      : undefined;
  };
  const zero = (v: V): boolean => {
    const d = defs.get(v);
    if (d?.k !== 'op') return integer(v) === 0;
    const [x, y] = d.args;
    if (d.op === 'neg' || d.op === 'neg.int') return zero(x);
    const q = integer(y);
    if (d.op === 'div' || d.op === 'div.q')
      return zero(x) && q !== undefined && q !== 0;
    const list = defs.get(x);
    const k = constants.get(y) as number;
    return d.op === 'elem' && list?.k === 'list' && zero(list.args[k]);
  };
  if (i.k !== 'op' || (i.op !== 'add' && i.op !== 'add.int')) return undefined;
  const [a, b] = i.args;
  const other = zero(b) ? a : zero(a) ? b : undefined;
  if (other === undefined || !sameLane(p, other, i.out)) return undefined;
  if (p.types[other].shape.length !== p.types[i.out].shape.length)
    return undefined;
  subst.set(i.out, other);
  return [];
}

/** With `lists`, only the list rules: an element of a list or of an
 *  element-wise operation, and the `At` of `scalarize`; and `zeros()`. */
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
    if (lists) return zeros(p, i, defs, constants, subst);
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

/** The most instructions of an instruction with regions that `cse` keys. */
const KEYED_SIZE = 1000;

const cse: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const key = (i: Instr, resolve: (v: V) => V): string | undefined => {
    // A call of a function with no effect: a `may-fail` one too (a function
    // on a cycle of calls), since the visible call failed if this one would.
    if (i.k === 'call')
      return fx.of(i) !== 'effectful'
        ? `c ${i.fn} ${i.args.join(',')}`
        : undefined;
    if (regionsOf(i).length > 0) return regionKey(i, resolve);
    if (!fx.mergeable(i)) return undefined;
    if (i.k === 'const') return literalKey(i.value);
    if (i.k === 'op') return `o ${i.op} ${i.args.join(',')}`;
    // A record by its whole type: its nominal name, the names and the
    // types of its fields.
    if (i.k === 'list') {
      const t = p.types[i.out];
      const of = t.lane === 'record' ? typeToString(t) : t.lane;
      return `l ${of} ${i.args.join(',')}`;
    }
    return undefined;
  };
  // An instruction with regions that is not effectful (a `may-fail` one, as
  // a call): its fields, operands, the types of its values and its regions
  // instruction by instruction, a value defined in them by its order of
  // definition, an outer one by its identity; not its `site`, the text of
  // a message. None above `KEYED_SIZE`.
  const regionKey = (i: Instr, resolve: (v: V) => V): string | undefined => {
    if (fx.of(i) === 'effectful') return undefined;
    const own = outsOf(i);
    const inner = new Map<V, number>();
    const name = (v: V): string =>
      inner.has(v)
        ? `#${inner.get(v)}`
        : own.includes(v)
          ? `@${own.indexOf(v)}`
          : `${resolve(v)}`;
    const type = (v: V) => {
      const t = p.types[v];
      const shape = t.shape.map((n) => (typeof n === 'number' ? n : name(n.v)));
      const of = t.lane === 'record' ? typeToString(t) : t.lane;
      return `${of}${t.storage ?? ''}[${shape.join(',')}]`;
    };
    const def = (v: V) => (inner.set(v, inner.size), type(v));
    const parts: string[] = [];
    let left = KEYED_SIZE;
    const walk = (x: Instr, top: boolean): boolean => {
      if (--left < 0) return false;
      const head =
        x.k === 'const'
          ? literalKey(x.value)
          : x.k === 'op'
            ? `op ${x.op}`
            : x.k === 'region'
              ? `region ${x.op} ${x.pieces}`
              : x.k === 'call'
                ? `call ${x.fn}`
                : x.k === 'loop'
                  ? `loop ${x.passes} ${x.exit} ${x.parallel}`
                  : x.k;
      parts.push(`(${head}`, ...argsOf(x).map(name));
      for (const r of regionsOf(x)) {
        parts.push('{', ...r.params.map(def));
        if (!r.body.every((y) => walk(y, false))) return false;
        parts.push('|', ...r.yields.map(name), '}');
      }
      parts.push('=', ...outsOf(x).map(top ? type : def), ')');
      return true;
    };
    return walk(i, true) ? parts.join(' ') : undefined;
  };
  // `seen`: the keys of the visible instructions to their values.
  return rewrite<V[]>(p, (i, { subst, seen }) => {
    const k = key(i, (v) => {
      while (subst.has(v)) v = subst.get(v)!;
      return v;
    });
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

/** The body that a `loop`, a `build` or a `filter` repeats (also of the
 *  lane `rows`). */
const repeated = (i: Instr): Region | undefined =>
  i.k === 'loop'
    ? i.body
    : i.k === 'region' &&
        (i.op === 'build' ||
          i.op === 'filter' ||
          i.op === 'rows.build' ||
          i.op === 'rows.filter')
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
  budget: { left: number; grown: Set<string> },
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
  // By the rule 'repeated', the functions that call a callee twice or more,
  // in this round or an earlier one (`budget.grown`, kept across the rounds
  // since a copy removes the calls), marked as each call is counted, so a
  // copy made later in the round counts too: such a function is not copied
  // by that rule, so that a chain of functions each calling the next several
  // times grows with the call counts, not their product.
  const site = (i: Instr & { k: 'call' }, s: Site) => {
    sites.set(i, s);
    const key = `${s.fn} ${i.fn}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (where === 'repeated' && !cyclic.has(i.fn) && counts.get(key)! > 1)
      budget.grown.add(s.fn);
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
      // By the rule 'repeated' nothing is copied into a function on a cycle
      // of calls: in the interval mode an `if` there runs one arm
      // (`verdictIf.decided`), so a copied `if` of the callee would lose
      // its hull.
      (where === 'repeated' && cyclic.has(s.fn)) ||
      i.args.some(
        (a, k) => p.types[a].shape.length > 0 && !sameLane(p, a, g.params[k])
      ) ||
      !(
        s.loop ||
        (where === 'repeated' &&
          counts.get(`${s.fn} ${i.fn}`)! > 1 &&
          !budget.grown.has(i.fn)) ||
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
    // A length that a result type names is live: the arm that `fold` takes
    // of an `if` with a length result can hold it alone (README, "Lists").
    f.results.forEach((t) => lengthValues(t).forEach((n) => live.add(n)));
    region(f.body);
  }
  return { changed, resolve: (v) => v };
};

/** The integer values of `p` below 2^32, which a build or a filter of that
 *  length does not refuse: a length parameter (of a list that exists), the
 *  count of a filter, a constant, and the least of two of them. The guard of
 *  a loop of `n` passes refuses more than 2^32 passes, where a build of `n`
 *  elements refuses 2^32, so `forward` reads a list at its place only where
 *  its length is one of these: the loop that reads it then refuses what the
 *  build refused, nothing. */
function boundedLengths(p: Program): Set<V> {
  const bounded = new Set<V>();
  const walk = (r: Region) =>
    r.body.forEach((i) => {
      if (
        i.k === 'const' &&
        typeof i.value.value === 'number' &&
        i.value.lane === 'integer' &&
        i.value.value >= 0 &&
        i.value.value < 2 ** 32
      )
        bounded.add(i.out);
      if (i.k === 'region' && i.op === 'filter') bounded.add(i.outs[0]);
      if (
        i.k === 'op' &&
        i.op === 'min.int' &&
        i.args.every((a) => bounded.has(a))
      )
        bounded.add(i.out);
      regionsOf(i).forEach(walk);
    });
  for (const f of p.functions) {
    f.lengthOf.forEach((l, k) => l && bounded.add(f.body.params[k]));
    walk(f.body);
  }
  return bounded;
}

/** A `build` whose body `forward` copies: one index and one element, and a
 *  body of pure operations, conditionals and calls (no loop or region,
 *  which `copyBody()` does not copy). */
const forwardable = (
  fx: ReturnType<typeof effects>,
  i: Instr
): i is Instr & { k: 'region' } => {
  if (i.k !== 'region' || i.op !== 'build' || i.outs.length !== 1) return false;
  const [r] = i.regions;
  const flat = (x: Instr): boolean =>
    x.k === 'op' ||
    x.k === 'const' ||
    x.k === 'list' ||
    x.k === 'call' ||
    (x.k === 'if' && regionsOf(x).every((y) => y.body.every(flat)));
  return (
    i.regions.length === 1 &&
    r.params.length === 1 &&
    r.yields.length === 1 &&
    r.body.every((x) => flat(x) && fx.of(x) === 'pure')
  );
};

/** The instructions of the body `r` of a build at the index `k`, each with
 *  new values, and the copy of its element. */
function copyBody(p: Program, r: Region, k: V): { body: Instr[]; y: V } {
  const m = new Map<V, V>([[r.params[0], k]]);
  const v = (x: V) => m.get(x) ?? x;
  const out = (x: V) => m.set(x, fresh(p, mapLengths(p.types[x], v))).get(x)!;
  const copy = (q: Region): Region => ({
    params: [],
    body: q.body.map((x) => {
      const c = { ...x };
      mapDirectArgs(c, v);
      if (c.k === 'if') [c.then, c.else] = [copy(c.then), copy(c.else)];
      if ('outs' in c) c.outs = c.outs.map(out);
      else c.out = out(c.out);
      return c;
    }),
    yields: q.yields.map(v),
  });
  const { body, yields } = copy(r);
  return { body, y: yields[0] };
}

/** A read of a value: the instruction, and the instructions around it. */
type Site = { i: Instr; around: Instr[] };

/** The index of `p` that `forward` and `filters` read: the value of each
 *  constant, the definition of each value, each instruction with its region
 *  and the instructions around it, and the reads of each value; `only(v)`,
 *  the reads of `v` when no yield reads it; `between(s, d)`, the
 *  instructions between the region of the definition `d` and the read `s`. */
function siteIndex(p: Program) {
  const { uses, def } = useIndex(p);
  const constants = new Map<V, Constant>();
  const readers = new Map<V, Site[]>();
  const sites = new Map<Instr, { region: Region; around: Instr[] }>();
  const walk = (r: Region, around: Instr[]) => {
    for (const i of r.body) {
      if (i.k === 'const') constants.set(i.out, i.value.value);
      sites.set(i, { region: r, around });
      for (const a of argsOf(i)) {
        if (!readers.has(a)) readers.set(a, []);
        readers.get(a)!.push({ i, around });
      }
      regionsOf(i).forEach((x) => walk(x, [...around, i]));
    }
  };
  p.functions.forEach((f) => walk(f.body, []));
  const only = (v: V): Site[] | undefined => {
    const s = readers.get(v) ?? [];
    return s.length === (uses.get(v) ?? 0) ? s : undefined;
  };
  const between = (s: Site, d: { around: Instr[] }) =>
    s.around.slice(d.around.length);
  return { uses, def, constants, readers, sites, only, between };
}

/**
 * The pass `forward` (README, "Lists", where a view is a list): the list of
 * a pure `build` that one instruction reads is not made, and that read
 * computes the element it reads:
 * - `elem(b, j)` is the body of the build at `j`, where the read runs once
 *   for each run of the build (only conditionals between them), or in the
 *   one loop, build or filter between them whose index is `j` (a reduction
 *   of the list, a `Map` of it), which reads each element once;
 * - `at(b, k)` of real elements, where the read runs once for each run of
 *   the build, is the body at the index of `k` where `k` is in range, as
 *   `At` reads it (an integer, from 1, from the end when negative), and NaN
 *   elsewhere, the value of `at`.
 * The build, unread, is then removed by `dce`. A list read twice, or by
 * another instruction (a call, a list, a yield: the result, an argument of
 * a function of the host), stays.
 */
const forward: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const bounded = boundedLengths(p);
  const { constants, def, sites, only, between } = siteIndex(p);
  /** The value `m` is at most `n`: `n`, the least of values one of which
   *  is `n`, or a constant at most the constant `n`. */
  const atMost = (m: V, n: V): boolean => {
    const d = def.get(m);
    const [a, b] = [constants.get(m), constants.get(n)];
    return (
      m === n ||
      (d?.k === 'op' && d.op === 'min.int' && d.args.includes(n)) ||
      (typeof a === 'number' && typeof b === 'number' && a <= b)
    );
  };
  // Whether the read `i`, inside the instructions `between` from the region
  // of its build of `n` elements, computes each element at most once per
  // run of the build, at an index below `n`: a loop from 0 to `m - 1`, or a
  // build or a filter of `m` elements, with `m` at most `n` (`Dot` reads its
  // second list over the length of the first).
  const reads = (i: Instr & { k: 'op' }, between: Instr[], n: V): boolean => {
    const loops = between.filter((x) => x.k !== 'if');
    if (i.op === 'at') {
      const t = p.types[i.out];
      return loops.length === 0 && t.lane === 'real' && t.shape.length === 0;
    }
    if (loops.length === 0) return true;
    const [x] = loops;
    const body = repeated(x);
    if (
      loops.length !== 1 ||
      body === undefined ||
      body.params[0] !== i.args[1]
    )
      return false;
    if (x.k !== 'loop') return x.k === 'region' && atMost(x.args[0], n);
    // The last index: `m - 1`, or a constant below the constant `n`.
    const last = def.get(x.hi);
    const [hi, top] = [constants.get(x.hi), constants.get(n)];
    return (
      !x.parallel &&
      x.window === undefined &&
      constants.get(x.lo) === 0 &&
      ((last?.k === 'op' &&
        last.op === 'sub.int' &&
        constants.get(last.args[1]) === 1 &&
        atMost(last.args[0], n)) ||
        (typeof hi === 'number' && typeof top === 'number' && hi < top))
    );
  };
  // The reads to rewrite, each with its build.
  const plan = new Map<Instr, Instr & { k: 'region' }>();
  for (const [i, site] of sites) {
    if (!forwardable(fx, i) || !bounded.has(i.args[0])) continue;
    const readers = only(i.outs[0]) ?? [];
    const [read] = readers;
    if (
      read !== undefined &&
      read.i.k === 'op' &&
      (read.i.op === 'elem' || read.i.op === 'at') &&
      read.i.args[0] === i.outs[0] &&
      readers.length === 1 &&
      reads(read.i, between(read, site), i.args[0])
    )
      plan.set(read.i, i);
  }
  if (plan.size === 0) return { changed: false, resolve: (v) => v };
  return rewrite(p, (i, { subst }) => {
    const build = plan.get(i);
    if (build === undefined || i.k !== 'op') return undefined;
    const [r] = build.regions;
    const index = i.args[1];
    if (i.op === 'elem') {
      const { body, y } = copyBody(p, r, index);
      subst.set(i.out, y);
      return body;
    }
    return atElement(
      p,
      i.out,
      build.args[0],
      index,
      constants.get(index),
      (j) => copyBody(p, r, j)
    );
  });
};

/** The instructions that give `out` the value of `At` of a list of reals of
 *  the length `n` at the index `k` (the constant `c`, when it is one):
 *  `element(j)` at its index from 0 `j` where it is in range, and NaN
 *  elsewhere, as `_at` of the runtime. */
function atElement(
  p: Program,
  out: V,
  n: V,
  k: V,
  c: Constant | undefined,
  element: (j: V) => { body: Instr[]; y: V }
): Instr[] {
  const code: Instr[] = [];
  const op = (o: string, args: V[], lane: 'boolean' | 'integer'): V => {
    const v = fresh(p, scalarType(lane));
    code.push({ k: 'op', out: v, op: o, args });
    return v;
  };
  const nan = (v: V): Instr => ({
    k: 'const',
    out: v,
    value: { lane: 'real', value: NaN },
  });
  let j: V;
  let ok: V;
  if (c !== undefined) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c === 0)
      return [nan(out)];
    if (c > 0) {
      j = integer(p, c - 1, code);
      ok = op('lt', [j, n], 'boolean');
    } else {
      j = op('sub.int', [n, integer(p, -c, code)], 'integer');
      ok = op('le', [integer(p, 0, code), j], 'boolean');
    }
  } else {
    // A real index is read where it is an integer (`At(L, 1.5)` is NaN).
    let whole: V | undefined;
    let m = k;
    if (p.types[k].lane !== 'integer') {
      m = op('floor', [k], 'integer');
      whole = op('eq', [k, m], 'boolean');
    }
    const zero = integer(p, 0, code);
    const one = integer(p, 1, code);
    const positive = op('lt', [zero, m], 'boolean');
    const [down, back] = [
      fresh(p, scalarType('integer')),
      fresh(p, scalarType('integer')),
    ];
    j = fresh(p, scalarType('integer'));
    code.push({
      k: 'if',
      outs: [j],
      cond: positive,
      then: {
        params: [],
        body: [{ k: 'op', out: down, op: 'sub.int', args: [m, one] }],
        yields: [down],
      },
      else: {
        params: [],
        body: [{ k: 'op', out: back, op: 'add.int', args: [n, m] }],
        yields: [back],
      },
    });
    const within = op(
      'and',
      [op('le', [zero, j], 'boolean'), op('lt', [j, n], 'boolean')],
      'boolean'
    );
    ok = whole === undefined ? within : op('and', [whole, within], 'boolean');
  }
  const { body, y } = element(j);
  const none = fresh(p, scalarType('real'));
  code.push({
    k: 'if',
    outs: [out],
    cond: ok,
    then: { params: [], body, yields: [y] },
    else: { params: [], body: [nan(none)], yields: [none] },
  });
  return code;
}

/**
 * The second half of `forward`: a `filter` of a pure body whose list is
 * not needed is a loop over its source, with no list:
 * - a list that no instruction reads, and a count read otherwise than by
 *   `0 < count` (`Length`, `All`), is a loop that counts the elements kept;
 * - a list read once, by `at` of the index 1 of a real element or by the
 *   `elem` at 0 (`First`, `Find`), where the read runs once for each run of
 *   the filter (only conditionals between them), or not read (`Any`), and
 *   a count read only by `0 < count`, is a loop that stops at the first
 *   element kept: whether there is one, and its value (NaN, the value of
 *   `at`, where there is none);
 * - a list that one loop after it in its region reduces (from 0 to the
 *   count less 1, reading the element at its index and nothing else at
 *   that index, of a pure body that does not read the count: `Sum`, `Mean`,
 *   `Max`) is that loop over the source, whose body runs where an element
 *   is kept, and which counts them; nothing between the two reads the list
 *   or the count.
 * A loop over the source has as many passes as the filter; one that stops
 * has the guard of a loop with an exit (`print-js.ts`).
 */
const filters: Pass = (p, rows) => {
  const fx = effects(p, rows);
  const bounded = boundedLengths(p);
  const { uses, def, constants, readers, sites, only, between } = siteIndex(p);
  /** `x` or an instruction of its regions reads `v`, yields it, or has a
   *  value whose type names it as a length. */
  const mentions = (x: Instr, v: V): boolean =>
    some(
      x,
      (y) =>
        argsOf(y).includes(v) ||
        outsOf(y).some((o) => lengthValues(p.types[o]).includes(v)) ||
        regionsOf(y).some((r) => r.yields.includes(v))
    );
  const op = (i: Instr, name: string): i is Instr & { k: 'op' } =>
    i.k === 'op' && i.op === name;
  // The instructions that replace an instruction (none: it is removed), and
  // the value that replaces the value of a read.
  const replaced = new Map<Instr, Instr[]>();
  const renamed = new Map<Instr, V>();
  /** `0`, `1`, and the index `n - 1` of the last element of `n`. */
  const bounds = (n: V, out: Instr[]) => {
    const zero = integer(p, 0, out);
    const one = integer(p, 1, out);
    const hi = fresh(p, scalarType('integer'));
    out.push({ k: 'op', out: hi, op: 'sub.int', args: [n, one] });
    return { zero, one, hi };
  };
  for (const [x, site] of sites) {
    const { region } = site;
    if (x.k !== 'region' || x.op !== 'filter' || x.outs.length !== 2) continue;
    const [body] = x.regions;
    if (
      x.regions.length !== 1 ||
      body.params.length !== 1 ||
      body.yields.length !== 2 ||
      !bounded.has(x.args[0]) ||
      !body.body.every((y) => fx.of(y) === 'pure')
    )
      continue;
    const [count, list] = x.outs;
    const [n] = x.args;
    const [keep, value] = body.yields;
    // A yield of the count reads it as a value (`Length` as the result).
    const counts = readers.get(count) ?? [];
    const yielded = counts.length < (uses.get(count) ?? 0);
    const lists = only(list);
    if (lists === undefined) continue;
    const out: Instr[] = [];
    const t = p.types[value];
    // The first element kept.
    const positive = (s: Site) =>
      op(s.i, 'lt') &&
      s.i.args[1] === count &&
      constants.get(s.i.args[0]) === 0;
    const [read] = lists;
    const first =
      lists.length === 0 ||
      (lists.length === 1 &&
        between(read, site).every((y) => y.k === 'if') &&
        t.shape.length === 0 &&
        ((op(read.i, 'at') &&
          t.lane === 'real' &&
          constants.get(read.i.args[1]) === 1) ||
          (op(read.i, 'elem') &&
            ['real', 'integer', 'boolean'].includes(t.lane) &&
            constants.get(read.i.args[1]) === 0)));
    if (
      first &&
      !yielded &&
      counts.every(positive) &&
      counts.length + lists.length > 0
    ) {
      const { zero, hi } = bounds(n, out);
      const no = fresh(p, scalarType('boolean'));
      out.push({
        k: 'const',
        out: no,
        value: { lane: 'boolean', value: false },
      });
      const [done, found] = [
        fresh(p, scalarType('boolean')),
        fresh(p, scalarType('boolean')),
      ];
      const loop: Instr & { k: 'loop' } = {
        k: 'loop',
        outs: [found],
        lo: zero,
        hi,
        init: [no],
        exit: 0,
        body: {
          params: [body.params[0], done],
          body: body.body,
          yields: [keep],
        },
      };
      // The element kept, carried from the pass that keeps it.
      if (read !== undefined) {
        const none = fresh(p, t);
        out.push({
          k: 'const',
          out: none,
          value:
            t.lane === 'boolean'
              ? { lane: 'boolean', value: false }
              : t.lane === 'integer'
                ? { lane: 'integer', value: 0 }
                : { lane: 'real', value: NaN },
        });
        const [held, element, next] = [fresh(p, t), fresh(p, t), fresh(p, t)];
        loop.outs.push(element);
        loop.init.push(none);
        loop.body.params.push(held);
        loop.body.body = [
          ...body.body,
          {
            k: 'if',
            outs: [next],
            cond: keep,
            then: { params: [], body: [], yields: [value] },
            else: { params: [], body: [], yields: [held] },
          },
        ];
        loop.body.yields.push(next);
        renamed.set(read.i, element);
      }
      out.push(loop);
      replaced.set(x, out);
      for (const s of counts) renamed.set(s.i, found);
      continue;
    }
    if (lists.length === 0 && (counts.length > 0 || yielded)) {
      // A count.
      const { zero, one, hi } = bounds(n, out);
      const [c, next, more] = [
        fresh(p, scalarType('integer')),
        fresh(p, scalarType('integer')),
        fresh(p, scalarType('integer')),
      ];
      out.push({
        k: 'loop',
        outs: [count],
        lo: zero,
        hi,
        init: [zero],
        body: {
          params: [body.params[0], c],
          body: [
            ...body.body,
            {
              k: 'if',
              outs: [next],
              cond: keep,
              then: {
                params: [],
                body: [{ k: 'op', out: more, op: 'add.int', args: [c, one] }],
                yields: [more],
              },
              else: { params: [], body: [], yields: [c] },
            },
          ],
          yields: [next],
        },
      });
      replaced.set(x, out);
      continue;
    }
    // A reduction: the loop `l` whose body reads the element at its index.
    if (lists.length !== 1 || !op(read.i, 'elem')) continue;
    const [l, ...ifs] = between(read, site);
    if (
      l === undefined ||
      l.k !== 'loop' ||
      !region.body.includes(l) ||
      !ifs.every((y) => y.k === 'if') ||
      l.passes === true ||
      l.exit !== undefined ||
      l.parallel === true ||
      l.window !== undefined ||
      l.body.params[0] !== read.i.args[1] ||
      uses.get(read.i.args[1]) !== 1 ||
      constants.get(l.lo) !== 0 ||
      uses.get(l.hi) !== 1 ||
      !l.body.body.every((y) => fx.of(y) === 'pure') ||
      l.body.body.some((y) => mentions(y, count)) ||
      // The loop gives the count: its initial values, its yields and its
      // operands other than its last index do not read it.
      argsOf(l).includes(count) ||
      l.body.yields.includes(count) ||
      l.outs.some((o) => lengthValues(p.types[o]).includes(count))
    )
      continue;
    const last = def.get(l.hi);
    if (
      last === undefined ||
      !op(last, 'sub.int') ||
      last.args[0] !== count ||
      constants.get(last.args[1]) !== 1 ||
      !region.body.includes(last)
    )
      continue;
    const [from, to] = [region.body.indexOf(x), region.body.indexOf(l)];
    if (
      region.body
        .slice(from + 1, to)
        .some((y) => y !== last && (mentions(y, count) || mentions(y, list)))
    )
      continue;
    // Where the count is read after the loop (`Mean`, `Max`), the loop
    // counts the elements kept.
    const { zero, one, hi } = bounds(n, out);
    const carried = l.body.params.slice(1);
    const nexts = carried.map((v) => fresh(p, p.types[v]));
    const then: Region = {
      params: [],
      body: [...l.body.body],
      yields: [...l.body.yields],
    };
    const otherwise: Region = { params: [], body: [], yields: [...carried] };
    const loop: Instr & { k: 'loop' } = {
      k: 'loop',
      outs: [...l.outs],
      lo: zero,
      hi,
      init: [...l.init],
      body: {
        params: [body.params[0], ...carried],
        body: [
          ...body.body,
          { k: 'if', outs: nexts, cond: keep, then, else: otherwise },
        ],
        yields: nexts,
      },
    };
    if (yielded || counts.some((s) => s.i !== last)) {
      const [c, more, next] = [
        fresh(p, scalarType('integer')),
        fresh(p, scalarType('integer')),
        fresh(p, scalarType('integer')),
      ];
      loop.outs.push(count);
      loop.init.push(zero);
      loop.body.params.push(c);
      nexts.push(next);
      then.body.push({ k: 'op', out: more, op: 'add.int', args: [c, one] });
      then.yields.push(more);
      otherwise.yields.push(c);
    }
    out.push(loop);
    replaced.set(x, []);
    replaced.set(last, []);
    replaced.set(l, out);
    renamed.set(read.i, value);
  }
  if (replaced.size === 0) return { changed: false, resolve: (v) => v };
  return rewrite(p, (i, { subst }) => {
    const v = renamed.get(i);
    if (v !== undefined) {
      outsOf(i).forEach((o) => subst.set(o, v));
      return [];
    }
    return replaced.get(i);
  });
};
