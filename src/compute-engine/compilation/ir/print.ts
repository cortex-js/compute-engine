/**
 * The statement printer that both targets share. A target gives its
 * `Syntax`: the spelling of each IR operation, of a constant, of a type and
 * of each statement form. The printer makes no decision that depends on a
 * target. It writes every instruction in order, as a statement that binds
 * its values, except the values of `inlinedValues()`, which it writes at
 * their use. A result is returned as it is: it can be an input, hold a
 * part of one, or be a value of `once` that every call shares.
 */

import { effects, type Effects, type TraceEntry } from './effects.js';
import { rowOfOp, type OperatorRow } from './operators.js';
import {
  argsOf,
  argumentIndex,
  entryOf,
  outsOf,
  recursiveFunctions,
  regionsOf,
  sameShape,
  useIndex,
  type IRFunction,
  type IRType,
  type Instr,
  nativeVectorArithmetic,
  type Length,
  type Literal,
  type Program,
  type Region,
  type UseIndex,
  type V,
} from './ir.js';

/** The text of an operation, with `$0`, `$1` for its operands (`$#0`: the
 *  length of the list operand 0), and the helpers that the text calls. */
export type Spelling =
  string | { readonly text: string; readonly helpers: readonly string[] };

/** The lines of a region instruction, around the lines of its body (the
 *  printer indents them): its results, operands and parameters by name,
 *  its `pieces`, and whether it has a second region (`closed`), whose
 *  lines `between` separates from those of the first. */
export type RegionSpelling = (r: {
  outs: string[];
  args: string[];
  params: string[];
  pieces?: number;
  closed?: boolean;
}) => {
  open: string[];
  between?: (yields: string[]) => string[];
  close: (yields: string[]) => string[];
};

export type Syntax = {
  readonly nativeVectors?: boolean;
  /** Return a final call directly from a JavaScript expression entry. */
  readonly returnEntryCall?: boolean;
  /** A single fixed-count block, charged after successful completion. */
  shortLoop?(
    index: string,
    start: number,
    count: number
  ): {
    open: string;
    close?: string;
  };
  /** The spelling of each IR operation. An operation `add.int` with no
   *  spelling of its own is spelled as `add`. */
  readonly ops: Record<string, Spelling>;
  /** The spelling of each region row. */
  readonly regions: Record<string, RegionSpelling>;
  /** The definition of each helper, by name. */
  readonly helpers: Record<string, string>;
  constant(value: Literal): string;
  /** The read of the input `name`, the parameter `index` of the entry. */
  input(name: string, index: number): string;
  /** The positional parameter `index` of the entry, named `name`. */
  positional(name: string, index: number): string;
  /** The length of the input whose read is `list`. */
  length(list: string): string;
  /** The length of the first row of the input whose read is `list`, a
   *  matrix of run-time size, 0 for no row (`IRFunction.widthOf`). Absent:
   *  the target has no such input. */
  width?(list: string): string;
  /** The part `index` of the tuple `tuple`, an input read part by part
   *  (`IRFunction.partOf`). */
  part?(tuple: string, index: number): string;
  /** The value of an input or a positional parameter of the entry of type
   *  `type`, from its read `text`. Absent: the read. */
  read?(text: string, type: IRType): string;
  /** The statements of the entry, from the printed ones. Absent: those. */
  entry?(body: string[]): string[];
  list(elements: string[], type: IRType): string;
  /** The read of the field `index` (from 0) of the record `record` of the
   *  type `type` (the operation `field`, and of `field.len`, the `length()`
   *  of that read). Absent: the spelling of the operation. */
  field?(record: string, index: number, type: IRType): string;
  /** An operation applied to each element: `lengths` are the texts of the
   *  lengths, `body` gives the text of one element from its index
   *  variables. Absent: the target has no element-wise operations. */
  map?(lengths: string[], body: (index: string[]) => string): string;
  /** Update a private flat list, in the same order as `map`. */
  updateList?(
    list: string,
    length: number,
    body: (index: string) => string
  ): string[];
  /** A statement that declares `name` with `value` (or no value).
   *  `mutable`: the name is written again. */
  declare(
    type: IRType,
    name: string,
    value?: string,
    mutable?: boolean
  ): string;
  /** An `if` whose condition is a verdict, each arm printed once (the
   *  interval mode): the test that runs the first arm, the test that runs
   *  the second, both of the name of the condition, and the value of a
   *  result from the values of the two arms. Absent: an `if` and an
   *  `else`. */
  readonly verdictIf?: {
    first(cond: string): string;
    second(cond: string): string;
    join(cond: string, a: string, b: string): string;
    /** The test of an `if` in a function on a cycle of calls, which runs
     *  one arm: an undecided verdict throws, so that a recursion ends. */
    decided(cond: string): string;
    /** A boolean `if` one of whose arms is the constant verdict `decides`
     *  (`And`: the else arm `false`; `Or`: the then arm `true`): the lines
     *  before and after the other arm, which yields `${out}_y`. */
    lazy(cond: string, out: string, decides: boolean): [string[], string[]];
  };
  /** The lines that open a counted loop of the index `k` from `lo` to `hi`,
   *  each bound evaluated once. `passes`: a pass of a `Loop`, which the
   *  iteration budget counts. `done`: the name of the flag of the loop's
   *  `exit`; no pass runs once it is true. `window`: the texts of the first
   *  and the end pass count of the loop's `window` (JavaScript only); `hi`
   *  is then not read. `counted`: a pass counter of an iteration budget
   *  below 2^32 bounds the loop, so its length needs no bound (JavaScript
   *  only). */
  loopOpen(
    k: string,
    lo: string,
    hi: string,
    passes: boolean,
    done?: string,
    window?: readonly [string, string],
    counted?: boolean
  ): string[];
  /** The return of the array of `values` (an entry `tuple`). Absent: the
   *  target declines such an entry. */
  retTuple?(values: string[]): string;
  /** The result of the entry of the type `type`, from the text `value` of
   *  a name: a record of a named tuple type, also one in a field, as the
   *  host reads it (`README.md`, "Records"), or `undefined` when the value
   *  is returned as it is. */
  record?(value: string, type: IRType): string | undefined;
  /** `types`: the type of each argument (GLSL passes an array as a
   *  sampler and its count). */
  call(fn: string, args: string[], types?: IRType[]): string;
  /** A function other than the entry. */
  fn(
    name: string,
    params: { name: string; type: IRType }[],
    result: IRType,
    body: string[]
  ): string;
};

export type Printed = {
  /** The statements of the entry, one per line, indented. */
  readonly body: string[];
  /** The other functions, each complete. */
  readonly functions: string[];
  /** The helper definitions that the code calls. */
  readonly helpers: string[];
  /** The effectful instructions, in the order they are printed. */
  readonly order: Omit<TraceEntry, 'region'>[];
  /** The name and the text of each value of `once`, in the order of the
   *  program (the entry first). */
  readonly once: Map<V, readonly [string, string]>;
};

export function spellingOf(
  syntax: Syntax,
  op: string
): { text: string; helpers: readonly string[] } | undefined {
  const s = syntax.ops[op] ?? syntax.ops[op.split('.')[0]];
  if (s === undefined) return undefined;
  return typeof s === 'string' ? { text: s, helpers: [] } : s;
}

/** The spellings that JavaScript and GLSL share. */
// prettier-ignore
export const ARITHMETIC = { add: '($0 + $1)', sub: '($0 - $1)', neg: '(-$0)',
  mul: '($0 * $1)', div: '($0 / $1)' };
// prettier-ignore
export const COMPARISONS = { lt: '($0 < $1)', le: '($0 <= $1)',
  gt: '($0 > $1)', ge: '($0 >= $1)' };
export const LOGIC = { and: '($0 && $1)', or: '($0 || $1)', not: '(!$0)' };

/** The spelling `<prefix>f($0)` of each operation `f` of `names`: a
 *  function of the target of the name of the operation. */
export const calls = (prefix: string, names: string[]) =>
  Object.fromEntries(names.map((f) => [f, `${prefix}${f}($0)`]));

/** The expression of a body of one `return`, or `undefined`. */
export const expressionOf = (body: readonly string[]): string | undefined =>
  body.length === 1 ? /^\s*return (.*);$/s.exec(body[0])?.[1] : undefined;

const INLINE_DEPTH = 64;

/**
 * The values that a printer writes at their single use, not bound to a
 * name: a constant at any number of uses; a pure `op` or `list` read once,
 * by an instruction or a yield of its own region, when the use reads its
 * operand once (its spelling names the operand once), is not an
 * element-wise operation (whose operands are read once per element) unless
 * the value is an element-wise operation of the same shape (the two are one
 * build, which computes each element once), and no instruction between the
 * definition and the use is effectful. A value
 * whose text would nest more than `INLINE_DEPTH` inlined values is named:
 * the printer writes an inlined value by recursion (`Max` of 1,000
 * operands is a chain of 1,000 `max`).
 */
function inlinedValues(
  p: Program,
  syntax: Syntax,
  rows: readonly OperatorRow[],
  fx: Effects,
  index: UseIndex
): Set<V> {
  const inlined = new Set<V>();
  const depth = new Map<V, number>();
  const readsOnce = (user: Instr, v: V): boolean => {
    if (user.k !== 'op') return true;
    if (threads(rows, p, user) && !fuses(rows, p, index.def.get(v)!, user))
      return false;
    const text = spellingOf(syntax, user.op)?.text ?? '';
    return user.args.every(
      (a, k) => a !== v || text.split(`$${k}`).length - 1 <= 1
    );
  };
  const walk = (r: Region) => {
    // The first instruction that reads each value, and the count of the
    // instructions that are not crossable before each position: one pass.
    const firstUse = new Map<V, number>();
    const blocked = [0];
    r.body.forEach((u, j) => {
      for (const a of argsOf(u)) if (!firstUse.has(a)) firstUse.set(a, j);
      blocked.push(blocked[j] + (fx.crossable(u) ? 0 : 1));
    });
    r.body.forEach((i, at) => {
      regionsOf(i).forEach(walk);
      if (i.k === 'const') return void inlined.add(i.out);
      if ((i.k !== 'op' && i.k !== 'list') || !fx.speculatable(i)) return;
      if (index.uses.get(i.out) !== 1) return;
      const user = firstUse.get(i.out) ?? -1;
      if (user < 0 && !r.yields.includes(i.out)) return;
      const end = user < 0 ? r.body.length : user;
      if (blocked[end] !== blocked[at + 1]) return;
      if (user >= 0 && !readsOnce(r.body[user], i.out)) return;
      const d = 1 + Math.max(0, ...argsOf(i).map((a) => depth.get(a) ?? 0));
      if (d > INLINE_DEPTH) return;
      depth.set(i.out, d);
      inlined.add(i.out);
    });
  };
  for (const f of p.functions) walk(f.body);
  return inlined;
}

/** An element-wise operation: its row threads, and its result is a list. */
const threads = (rows: readonly OperatorRow[], p: Program, i: Instr) =>
  i.k === 'op' &&
  p.types[i.out].shape.length > 0 &&
  rowOfOp(rows, i.op)?.row.threads === true;

/** Whether the element-wise operations `i` and its user `user` have one
 *  shape, so that an element of `user` reads the element of `i` at its own
 *  index. */
const fuses = (
  rows: readonly OperatorRow[],
  p: Program,
  i: Instr,
  user: Instr
): boolean =>
  threads(rows, p, i) &&
  sameShape(p.types[outsOf(i)[0]].shape, p.types[outsOf(user)[0]].shape);

/** The asynchronous text of a JavaScript program (`runAsync()`; README,
 *  "Batches and `runAsync()`"): its pool loops, each with its id and the
 *  values that its driver call passes (`PoolLoop` of `outline.ts`), and the
 *  functions that wait, the entry included. */
export type Wait = {
  readonly loops: ReadonlyMap<
    Instr,
    { id: number; passed: readonly V[]; lists: readonly V[] }
  >;
  readonly waits: ReadonlySet<string>;
};

/** `once`: the values that the target computes once, out of the
 *  functions, each bound to its name (`Printed.once`). `wait`: print the
 *  asynchronous text instead, whose `functions` are the `async` copies
 *  `<name>$async` of the functions that wait (each restores the caller's
 *  state when it ends, `_run.d()`), and whose entry body awaits. */
export function printProgram(
  p: Program,
  syntax: Syntax,
  rows: readonly OperatorRow[],
  once?: ReadonlySet<V>,
  wait?: Wait
): Printed {
  const index = useIndex(p);
  const fx = effects(p, rows);
  const inlined = inlinedValues(p, syntax, rows, fx, index);
  once?.forEach((v) => inlined.delete(v));
  const onceText = new Map<V, readonly [string, string]>();
  const names = new Map<V, string>();
  const helpers = new Set<string>();
  const order: Omit<TraceEntry, 'region'>[] = [];
  // The functions whose `if` runs one arm (`verdictIf.decided()`), and
  // whether the function printed is one of them.
  const cyclic = syntax.verdictIf ? recursiveFunctions(p.functions) : undefined;
  let decided = false;
  const entry = entryOf(p);
  const positional = entry.positional ?? 0;
  // Input conversions read once at the start of the entry when used.
  const inputBindings = new Map<V, string>();
  const inputsRead = new Set<V>();
  entry.body.params.forEach((v, k) => {
    const name = entry.paramNames[k];
    const part = entry.partOf?.[k];
    const whole =
      k < positional
        ? syntax.positional(name, argumentIndex(entry, k))
        : syntax.input(name, k);
    const input = part === undefined ? whole : syntax.part!(whole, part);
    if (entry.lengthOf[k] && entry.widthOf?.[k] === true) {
      inputBindings.set(v, syntax.width!(input));
      return;
    }
    const t = p.types[v];
    names.set(
      v,
      entry.lengthOf[k]
        ? syntax.length(input)
        : (syntax.read?.(input, t) ?? input)
    );
  });
  const type = (v: V): IRType => p.types[v];
  const name = (v: V): string => {
    if (inputBindings.has(v)) inputsRead.add(v);
    return names.get(v) ?? `v${v}`;
  };
  /** The text of the value of `v` at a use. */
  const use = (v: V): string =>
    inlined.has(v) ? text(index.def.get(v)!) : name(v);
  const length = (n: Length) => (typeof n === 'number' ? String(n) : use(n.v));
  /** The verdict of the arm of a boolean `if` that is the constant deciding
   *  it (`verdictIf.lazy`), and whether the other arm is pure. */
  const decidingArm = (i: Instr & { k: 'if' }) => {
    const verdict = (r: Region) => {
      const d = index.def.get(r.yields[0]);
      return r.body.every((x) => x.k === 'const') && d?.k === 'const'
        ? d.value.value
        : undefined;
    };
    const t = i.outs.length === 1 ? type(i.outs[0]) : undefined;
    if (t?.lane !== 'boolean' || t.shape.length > 0) return;
    const decides =
      verdict(i.else) === false ? false : verdict(i.then) === true || undefined;
    const arm = decides ? i.else : i.then;
    return decides === undefined
      ? undefined
      : { decides, pure: arm.body.every((x) => fx.speculatable(x)) };
  };

  /** The values `>= 0` (or NaN) by the conditions of the `if` arms that
   *  enclose the instruction printed (`guards()`). */
  const guarded = new Set<V>();
  /** Whether the real value `v` is `>= 0` or NaN: a constant `>= 0`, an
   *  `abs`, `sqrt`, `exp` or `hypot`, a square, a sum, product or `pow` of
   *  such values (a `pow` of its base), a `max` of one, or a value of
   *  `guarded`. */
  const nonnegative = (v: V, depth = 0): boolean => {
    if (guarded.has(v) || p.signs?.has(v)) return true;
    const i = index.def.get(v);
    if (i?.k === 'const')
      return typeof i.value.value === 'number' && i.value.value >= 0;
    if (i?.k !== 'op' || depth > 8 || type(v).lane === 'complex') return false;
    const op = i.op.split('.')[0];
    if (['abs', 'sqrt', 'exp', 'hypot'].includes(op)) return true;
    if (op === 'mul' && i.args[0] === i.args[1]) return true;
    const next = (a: V) => nonnegative(a, depth + 1);
    if (op === 'max') return i.args.some(next);
    const args = op === 'pow' ? [i.args[0]] : i.args;
    return ['add', 'mul', 'pow'].includes(op) && args.every(next);
  };
  /** The values `>= 0` where the condition `c` is true: the operand of a
   *  comparison with a constant `>= 0` below it, and those of each operand
   *  of an `and`. */
  const guards = (c: V, depth = 0): V[] => {
    const i = index.def.get(c);
    if (i?.k !== 'op' || depth > 8) return [];
    const op = i.op.split('.')[0];
    if (op === 'and') return i.args.flatMap((a) => guards(a, depth + 1));
    const [lo, hi] =
      op === 'lt' || op === 'le' ? i.args : i.args.slice().reverse();
    const bound = index.def.get(lo);
    return ['lt', 'le', 'gt', 'ge'].includes(op) &&
      bound?.k === 'const' &&
      typeof bound.value.value === 'number' &&
      bound.value.value >= 0
      ? [hi]
      : [];
  };

  /** Whether the real value `v` is `> 0`: a constant `> 0`, or an input
   *  whose declared type excludes 0 and below (`p.signs`). Not an `exp`,
   *  which underflows to 0. */
  const positive = (v: V): boolean => {
    if (p.signs?.get(v) === 'positive') return true;
    const i = index.def.get(v);
    return (
      i?.k === 'const' && typeof i.value.value === 'number' && i.value.value > 0
    );
  };

  /** The text of `op` applied to the texts of `operands`; `$#k` is the
   *  length of the list operand `k` of `i`. An operation whose operand 0 is
   *  `positive()` is spelled `<op>.positive`, one whose operand 0 is
   *  `nonnegative()` `<op>.nonnegative`, when the target has that spelling. */
  const spell = (
    op: string,
    operands: (k: number) => string,
    i?: Instr & { k: 'op' }
  ): string => {
    const refined = [
      [`${op}.positive`, positive],
      [`${op}.nonnegative`, nonnegative],
    ] as const;
    const spelling = spellingOf(
      syntax,
      (i !== undefined &&
        refined.find(
          ([name, proves]) =>
            syntax.ops[name] !== undefined && proves(i.args[0])
        )?.[0]) ||
        op
    );
    if (spelling === undefined)
      throw new Error(`slice printer: no spelling for the operation ${op}`);
    if (i !== undefined && spelling.text === ARITHMETIC.add) {
      // `a + (-c)` and `(-c) + a` are `a - c`, the same IEEE value.
      for (const [k, other] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const def = index.def.get(i.args[k]);
        if (def?.k !== 'const') continue;
        const literal = def.value;
        if (
          (literal.lane === 'real' || literal.lane === 'integer') &&
          typeof literal.value === 'number' &&
          Number.isFinite(literal.value) &&
          (literal.value < 0 || Object.is(literal.value, -0))
        )
          return `(${operands(other)} - ${syntax.constant({
            ...literal,
            value: -literal.value,
          })})`;
      }
      // An inlined negation of a scalar: `a + (-b)` is `a - b`, and
      // `(-a) + b` is `b - a`, the same IEEE value (negation is exact and
      // addition commutes). An inlined value is pure (`inlinedValues()`),
      // so reading `b` before `a` changes nothing.
      const negated = (v: V): V | undefined => {
        const d = index.def.get(v);
        return d?.k === 'op' &&
          inlined.has(v) &&
          spellingOf(syntax, d.op)?.text === ARITHMETIC.neg
          ? d.args[0]
          : undefined;
      };
      const subtrahend = (v: V) => {
        const t = use(v);
        return t.startsWith('-') ? `(${t})` : t;
      };
      // An inlined product of a scalar by a negative constant:
      // `a + ((-c) * y)` is `a - (c * y)`, the same IEEE value (the product
      // of `-c` is the negation of the product of `c`, in every rounding
      // to nearest, and `a + (-p)` is `a - p`).
      const scaled = (v: V): string | undefined => {
        const d = index.def.get(v);
        if (
          d?.k !== 'op' ||
          !inlined.has(v) ||
          d.args.length !== 2 ||
          type(v).shape.length !== 0 ||
          spellingOf(syntax, d.op)?.text !== ARITHMETIC.mul
        )
          return undefined;
        for (const k of [0, 1] as const) {
          const c = index.def.get(d.args[k]);
          if (c?.k !== 'const') continue;
          const literal = c.value;
          if (
            (literal.lane === 'real' || literal.lane === 'integer') &&
            typeof literal.value === 'number' &&
            Number.isFinite(literal.value) &&
            literal.value < 0
          ) {
            const factor = syntax.constant({
              ...literal,
              value: -literal.value,
            });
            const y = use(d.args[1 - k]);
            return k === 0 ? `(${factor} * ${y})` : `(${y} * ${factor})`;
          }
        }
        return undefined;
      };
      if (type(i.out).shape.length === 0) {
        const b = negated(i.args[1]);
        if (b !== undefined) return `(${operands(0)} - ${subtrahend(b)})`;
        const a = negated(i.args[0]);
        if (a !== undefined) return `(${operands(1)} - ${subtrahend(a)})`;
        const pb = scaled(i.args[1]);
        if (pb !== undefined) return `(${operands(0)} - ${pb})`;
        const pa = scaled(i.args[0]);
        if (pa !== undefined) return `(${operands(1)} - ${pa})`;
      }
    }
    for (const h of spelling.helpers) helpers.add(syntax.helpers[h]);
    return spelling.text
      .replace(/\$#(\d)/g, (_, k) => length(type(i!.args[Number(k)]).shape[0]!))
      .replace(/\$(\d)/g, (_, k) => operands(Number(k)));
  };

  /** The text of an instruction that defines one value. */
  const text = (i: Instr): string => {
    switch (i.k) {
      case 'const':
        return syntax.constant(i.value);
      case 'list':
        return syntax.list(i.args.map(use), type(i.out));
      case 'call':
        return syntax.call(i.fn, i.args.map(use), i.args.map(type));
      case 'op': {
        const shape = type(i.out);
        if (
          (i.op === 'field' || i.op === 'field.len') &&
          syntax.field !== undefined
        ) {
          const k = index.def.get(i.args[1]);
          if (k?.k !== 'const' || typeof k.value.value !== 'number')
            throw new Error(
              'slice printer: a field at an index that is not a constant'
            );
          const read = syntax.field(
            use(i.args[0]),
            k.value.value,
            type(i.args[0])
          );
          return i.op === 'field' ? read : syntax.length(read);
        }
        // A read of a list in storage is spelled `<op>.<storage kind>`.
        const held = i.args.length > 0 ? type(i.args[0]).storage : undefined;
        const op = held === undefined ? i.op : `${i.op}.${held}`;
        if (
          !threads(rows, p, i) ||
          (syntax.nativeVectors && nativeVectorArithmetic(p, i))
        )
          return spell(op, (k) => use(i.args[k]), i);
        if (syntax.map === undefined)
          throw new Error(
            `slice printer: an element-wise ${i.op} on a target without them`
          );
        // A plain `elem`: a list in storage is on GLSL only, which has no
        // `map` (no target reaches this with one).
        return syntax.map(shape.shape.map(length), (ix) => element(i, ix));
      }
    }
    throw new Error(`slice printer: ${i.k} is not a value`);
  };

  /** The text of the element at the indices `ix` of the element-wise
   *  operation `i`; an inlined operand is such an operation (`fuses()`). */
  const element = (i: Instr & { k: 'op' }, ix: string[]): string =>
    spell(i.op, (k) => {
      const a = i.args[k];
      if (type(a).shape.length === 0) return use(a);
      if (inlined.has(a))
        return element(index.def.get(a) as Instr & { k: 'op' }, ix);
      return ix.reduce(
        (l, j) => spell('elem', (m) => (m === 0 ? l : j)),
        use(a)
      );
    });

  /** The wait of the promise `p` in the asynchronous text: the caller's
   *  state is set when the program leaves the thread (`_run.s`), and the
   *  program's when it continues, with the value or the rejection
   *  (`_run.r`). */
  const awaited = (promise: string) =>
    `_run.r(await _run.s(${promise}).then(_run.ok, _run.fail))`;
  /** The text of the call `i`: at a waiting position of the asynchronous
   *  text, the wait of the `async` copy of a function that waits. */
  const callText = (i: Instr & { k: 'call' }, waiting: boolean): string =>
    waiting && wait?.waits.has(i.fn) === true
      ? awaited(syntax.call(`${i.fn}$async`, i.args.map(use)))
      : text(i);

  /** `waiting`: the asynchronous text (`wait`), at a waiting position. */
  const body = (
    r: Region,
    depth: number,
    waiting = false,
    returnedCall?: Instr
  ): string[] => {
    const lines: string[] = [];
    // The indentation stops at 16 levels: the text of a nest of depth d
    // would otherwise grow as d^2.
    const line = (s: string, d = depth) =>
      lines.push('  '.repeat(Math.min(d, 16)) + s);
    const nested = (
      inner: Region,
      targets: string[],
      carried: boolean,
      innerWaiting = waiting
    ) => {
      lines.push(...body(inner, depth + 1, innerWaiting));
      // A loop body's yield can read a carried variable that an earlier
      // assignment wrote: with more than one, each value is read first.
      if (!carried || targets.length === 1) {
        targets.forEach((t, j) =>
          line(`${t} = ${use(inner.yields[j])};`, depth + 1)
        );
        return;
      }
      const temps = inner.yields.map((y, j) => {
        line(syntax.declare(type(y), `${targets[j]}_next`, use(y)), depth + 1);
        return `${targets[j]}_next`;
      });
      temps.forEach((t, j) => line(`${targets[j]} = ${t};`, depth + 1));
    };
    for (const i of r.body) {
      if (
        fx.of(i) === 'effectful' &&
        (i.k === 'op' || i.k === 'call' || i.k === 'region')
      )
        order.push({
          name: i.k === 'call' ? `call ${i.fn}` : i.op,
          args: i.args,
          outs: outsOf(i),
        });
      const lazy =
        i.k === 'if' && syntax.verdictIf !== undefined
          ? decidingArm(i)
          : undefined;
      if (
        i.k === 'if' &&
        syntax.verdictIf !== undefined &&
        (!decided || lazy?.pure === true)
      ) {
        // The condition is read more than once (three times in the three-way
        // form, twice in `verdictIf.lazy`): a value written at its use is
        // bound to a name first (a constant is its text).
        const v = syntax.verdictIf;
        let c = use(i.cond);
        if (inlined.has(i.cond) && index.def.get(i.cond)?.k !== 'const') {
          line(syntax.declare(type(i.cond), name(i.cond), c));
          c = name(i.cond);
        }
        if (lazy !== undefined) {
          const o = name(i.outs[0]);
          const [open, close] = v.lazy(c, o, lazy.decides);
          open.forEach((s) => line(s));
          nested(lazy.decides ? i.else : i.then, [`${o}_y`], false);
          close.forEach((s) => line(s));
          continue;
        }
        const arm = (k: string) => i.outs.map((o) => `${name(o)}_${k}`);
        i.outs.forEach((o) =>
          ['a', 'b'].forEach((k) =>
            line(syntax.declare(type(o), `${name(o)}_${k}`, undefined, true))
          )
        );
        line(v.first(c));
        nested(i.then, arm('a'), false);
        line('}');
        line(v.second(c));
        nested(i.else, arm('b'), false);
        line('}');
        i.outs.forEach((o, j) =>
          line(
            syntax.declare(
              type(o),
              name(o),
              v.join(c, arm('a')[j], arm('b')[j])
            )
          )
        );
      } else if (i.k === 'if') {
        i.outs.forEach((v) =>
          line(syntax.declare(type(v), name(v), undefined, true))
        );
        const c = use(i.cond);
        line(`if (${decided ? syntax.verdictIf!.decided(c) : c}) {`);
        const facts = guards(i.cond).filter((v) => !guarded.has(v));
        facts.forEach((v) => guarded.add(v));
        nested(i.then, i.outs.map(name), false);
        facts.forEach((v) => guarded.delete(v));
        line('} else {');
        nested(i.else, i.outs.map(name), false);
        line('}');
      } else if (i.k === 'loop') {
        const result = type(i.outs[0]);
        const update = index.def.get(i.body.yields[0]);
        const width = result?.shape[0];
        const privateList =
          syntax.updateList !== undefined &&
          i.outs.length === 1 &&
          !i.passes &&
          !i.parallel &&
          i.exit === undefined &&
          i.window === undefined &&
          result?.lane === 'real' &&
          result.shape.length === 1 &&
          typeof width === 'number' &&
          width > 0 &&
          width < 2 ** 32 &&
          update?.k === 'op' &&
          i.body.body.includes(update) &&
          inlined.has(update.out) &&
          fuses(rows, p, update, i) &&
          i.body.body.every((x) => fx.speculatable(x));
        const initial = index.def.get(i.init[0]);
        // Take ownership only of a fresh allocation in this region.
        // Hoisting can give a single-use initializer to an inner loop
        // that runs repeatedly over the same array.
        const copyInitial =
          privateList &&
          (index.uses.get(i.init[0]) !== 1 ||
            once?.has(i.init[0]) ||
            initial === undefined ||
            !r.body.includes(initial) ||
            !(
              initial.k === 'list' ||
              (initial.k === 'region' && initial.op === 'build')
            ));
        // A carried value has one variable: the result of the loop, which
        // the body reads as its parameter.
        i.outs.forEach((v, j) => {
          names.set(i.body.params[j + 1], name(v));
          const initial = use(i.init[j]);
          line(
            syntax.declare(
              type(v),
              name(v),
              copyInitial ? `(${initial}).slice()` : initial,
              !privateList
            )
          );
        });
        // A pool loop of the asynchronous text: the driver runs it on the
        // pool, or gives `undefined` and the loop runs in order (README,
        // "Batches and `runAsync()`").
        const pooled = waiting ? wait?.loops.get(i) : undefined;
        const k = name(i.body.params[0]);
        if (pooled !== undefined)
          line(
            `const ${k}_p = _run.loop(${pooled.id}, ${use(i.lo)}, ${use(i.hi)}, [${pooled.passed.map(use).join(', ')}], [${pooled.lists.map(use).join(', ')}]);`
          );
        if (pooled !== undefined) line(`if (${k}_p === undefined) {`);
        const lo = index.def.get(i.lo);
        const hi = index.def.get(i.hi);
        const start = lo?.k === 'const' ? lo.value.value : undefined;
        const end = hi?.k === 'const' ? hi.value.value : undefined;
        const short =
          syntax.shortLoop !== undefined &&
          !i.passes &&
          !i.parallel &&
          i.exit === undefined &&
          i.window === undefined &&
          typeof start === 'number' &&
          typeof end === 'number' &&
          Number.isSafeInteger(start) &&
          Number.isSafeInteger(end) &&
          end < Number.MAX_SAFE_INTEGER &&
          end - start < 1024
            ? syntax.shortLoop(k, start, Math.max(0, end - start + 1))
            : undefined;
        if (short !== undefined) line(short.open);
        else
          syntax
            .loopOpen(
              k,
              use(i.lo),
              use(i.hi),
              i.passes === true,
              i.exit === undefined ? undefined : name(i.outs[i.exit]),
              i.window === undefined
                ? undefined
                : [use(i.window[0]), use(i.window[1])]
            )
            .forEach((s) => line(s));
        if (privateList) {
          lines.push(...body(i.body, depth + 1, waiting));
          syntax.updateList!(name(i.outs[0]), width, (k) =>
            element(update, [k])
          ).forEach((s) => line(s, depth + 1));
        } else nested(i.body, i.outs.map(name), true, waiting && !i.parallel);
        line('}');
        if (short?.close !== undefined) line(short.close);
        if (pooled !== undefined) {
          line('} else {');
          line(`  const ${k}_s = ${awaited(`${k}_p`)};`);
          i.outs.forEach((v, j) =>
            line(`  ${name(v)} = _run.addNumber(${name(v)}, ${k}_s, ${j});`)
          );
          pooled.lists.forEach((l, m) =>
            line(`  _run.addList(${use(l)}, ${k}_s, ${i.outs.length + m});`)
          );
          line('}');
          line(`_run.finishLoop(${pooled.id});`);
        }
      } else if (i.k === 'region') {
        const [inner] = i.regions;
        const pooled = waiting ? wait?.loops.get(i) : undefined;
        const out = name(i.outs[0]);
        const local = `${out}_serial`;
        if (pooled !== undefined) {
          line(`let ${out};`);
          line(
            `const ${out}_p = _run.loop(${pooled.id}, 0, (${use(i.args[0])}) - 1, [${pooled.passed.map(use).join(', ')}], []);`
          );
          line(`if (${out}_p === undefined) {`);
        }
        const s = syntax.regions[i.op]({
          outs: pooled === undefined ? i.outs.map(name) : [local],
          args: i.args.map(use),
          params: inner.params.map(name),
          pieces: i.pieces,
          ...(i.regions.length > 1 ? { closed: true } : {}),
        });
        s.open.forEach((x) => line(x));
        lines.push(...body(inner, depth + 1));
        const last = i.regions[i.regions.length - 1];
        if (last !== inner) {
          s.between!(inner.yields.map(use)).forEach((x) => line(x));
          lines.push(...body(last, depth + 1));
        }
        s.close(last.yields.map(use)).forEach((x) => line(x));
        if (pooled !== undefined) {
          line(`  ${out} = ${local};`);
          line('} else {');
          line(`  ${out} = _run.joinSlices(${awaited(`${out}_p`)});`);
          line('}');
          line(`_run.finishLoop(${pooled.id});`);
        }
      } else if (i.k === 'call' && i === returnedCall) {
        line(`return ${callText(i, waiting)};`);
      } else if (i.k === 'call' && i.outs.length === 2) {
        // The list, then its length (`lower-functions.ts`).
        const [n, list] = i.outs.map(name);
        line(syntax.declare(type(i.outs[1]), list, callText(i, waiting)));
        line(syntax.declare(type(i.outs[0]), n, syntax.length(list)));
      } else if (i.k === 'call' && i.outs.length !== 1) {
        throw new Error('slice printer: a call with several results');
      } else {
        const out = outsOf(i)[0];
        if (once?.has(out)) onceText.set(out, [name(out), text(i)]);
        else if (!inlined.has(out))
          line(
            syntax.declare(
              type(out),
              name(out),
              i.k === 'call' ? callText(i, waiting) : text(i)
            )
          );
      }
    }
    return lines;
  };

  const returned = (f: IRFunction): string[] => {
    decided = cyclic?.has(f.name) ?? false;
    const ys = f.body.yields;
    const waiting = wait !== undefined;
    // A record result of the entry is converted once, there: each is read
    // through a name.
    const named: string[] = [];
    const result = (y: V, k: number): string => {
      const t = type(y);
      if (f.name !== p.entry || t.lane !== 'record') return use(y);
      const r = `_record${k}`;
      const text = syntax.record?.(r, t);
      if (text === undefined) return use(y);
      named.push(`  const ${r} = ${use(y)};`);
      return text;
    };
    if (f.tuple === true && syntax.retTuple !== undefined) {
      const lines = body(f.body, 1, waiting);
      const values = ys.map(result);
      return [...lines, ...named, '  ' + syntax.retTuple(values)];
    }
    if (f.results.length !== 1)
      throw new Error('slice printer: a function with several results');
    const last = f.body.body.at(-1);
    if (
      syntax.returnEntryCall &&
      f.name === p.entry &&
      f.literal !== true &&
      !waiting &&
      last?.k === 'call' &&
      last.outs.length === 1 &&
      ys[0] === last.outs[0] &&
      !once?.has(ys[0]) &&
      type(ys[0]).lane !== 'record'
    )
      return body(f.body, 1, false, last);
    const lines = body(f.body, 1, waiting);
    const value = result(ys[0], 0);
    return [...lines, ...named, `  return ${value};`];
  };
  // The entry first: `order` follows `p.functions`, whose first is the entry.
  const statements = returned(entry);
  const main = [
    ...[...inputBindings]
      .filter(([v]) => inputsRead.has(v))
      .map(([v, text]) => '  ' + syntax.declare(type(v), `v${v}`, text)),
    ...statements,
  ];
  const functions = p.functions
    .filter(
      (f) =>
        f.name !== p.entry && (wait === undefined || wait.waits.has(f.name))
    )
    .map((f) => {
      const params = f.body.params.map((v) => ({
        name: name(v),
        type: type(v),
      }));
      if (wait === undefined)
        return syntax.fn(f.name, params, f.results[0], returned(f));
      return [
        `const ${f.name}$async = async (${params.map((x) => x.name).join(', ')}) => {`,
        'try {',
        ...returned(f),
        '} finally { _run.d(); }',
        '};',
      ].join('\n');
    });
  return {
    body: main,
    functions,
    helpers: [...helpers],
    order,
    once: onceText,
  };
}
