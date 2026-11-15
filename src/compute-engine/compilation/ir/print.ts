/**
 * The statement printer that both targets share. A target gives its
 * `Syntax`: the spelling of each IR operation, of a constant, of a type and
 * of each statement form. The printer makes no decision that depends on a
 * target. It writes every instruction in order, as a statement that binds
 * its values, except the values of `inlinedValues()`, which it writes at
 * their use. A result that may alias an input (`mayAliasInput()`) is
 * returned as a copy.
 */

import { effects, type Effects, type TraceEntry } from './effects.js';
import { regionRow, rowOfOp, type OperatorRow } from './operators.js';
import {
  argsOf,
  argumentIndex,
  entryOf,
  outsOf,
  regionsOf,
  useIndex,
  type IRFunction,
  type IRType,
  type Instr,
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
 *  printer indents them): its results, operands and parameters by name. */
export type RegionSpelling = (r: {
  outs: string[];
  types: IRType[];
  args: string[];
  params: string[];
}) => { open: string[]; close: (yields: string[]) => string[] };

export type Syntax = {
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
  /** The value of an input or a positional parameter of the entry of type
   *  `type`, from its read `text`. Absent: the read. */
  read?(text: string, type: IRType): string;
  /** The statements of the entry, from the printed ones. Absent: those. */
  entry?(body: string[]): string[];
  list(elements: string[], type: IRType): string;
  /** An operation applied to each element: `lengths` are the texts of the
   *  lengths, `body` gives the text of one element from its index
   *  variables. Absent: the target has no element-wise operations. */
  map?(lengths: string[], body: (index: string[]) => string): string;
  /** A statement that declares `name` with `value` (or no value).
   *  `mutable`: the name is written again. */
  declare(
    type: IRType,
    name: string,
    value?: string,
    mutable?: boolean
  ): string;
  assign(name: string, value: string): string;
  ifOpen(cond: string): string;
  readonly elseOpen: string;
  /** An `if` whose condition is a verdict, each arm printed once (the
   *  interval mode): the test that runs the first arm, the test that runs
   *  the second, both of the name of the condition, and the value of a
   *  result from the values of the two arms. Absent: `ifOpen` and
   *  `elseOpen`. */
  readonly verdictIf?: {
    first(cond: string): string;
    second(cond: string): string;
    join(cond: string, a: string, b: string): string;
  };
  /** The lines that open a counted loop of the index `k` from `lo` to `hi`,
   *  each bound evaluated once. `passes`: a pass of a `Loop`, which the
   *  iteration budget counts. */
  loopOpen(k: string, lo: string, hi: string, passes: boolean): string[];
  readonly close: string;
  /** `copy`: the value can be (or hold) an input. */
  ret(value: string, type: IRType, copy: boolean): string;
  /** The return of the array of `values` (an entry `tuple`); `copy[k]`:
   *  the value `k` can be (or hold) an input. Absent: the target declines
   *  such an entry. */
  retTuple?(values: string[], copy: boolean[]): string;
  call(fn: string, args: string[]): string;
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
};

export function spellingOf(
  syntax: Syntax,
  op: string
): { text: string; helpers: readonly string[] } | undefined {
  const s = syntax.ops[op] ?? syntax.ops[op.split('.')[0]];
  if (s === undefined) return undefined;
  return typeof s === 'string' ? { text: s, helpers: [] } : s;
}

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
export function inlinedValues(
  p: Program,
  syntax: Syntax,
  rows: readonly OperatorRow[],
  fx: Effects = effects(p, rows),
  index: UseIndex = useIndex(p)
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
  JSON.stringify(p.types[outsOf(i)[0]].shape) ===
    JSON.stringify(p.types[outsOf(user)[0]].shape);

/**
 * Whether the list value `v` can be an input of the entry or share an
 * element with one: a parameter; the result of an operation whose row
 * says it is a part of its operand (`alias`), of a list literal, an `if`,
 * or a region whose row says which yields it can be, that holds such a
 * list. Any other result is a new list.
 */
export function mayAliasInput(
  p: Program,
  rows: readonly OperatorRow[],
  index = useIndex(p)
): (v: V) => boolean {
  const memo = new Map<V, boolean>();
  const sources = (i: Instr, v: V): V[] => {
    const j = outsOf(i).indexOf(v);
    if (i.k === 'if') return [i.then.yields[j], i.else.yields[j]];
    if (i.k === 'region') return regionRow(i.op)!.alias(j, i.regions[0].yields);
    if (i.k === 'list') return i.args;
    if (i.k === 'op' && rowOfOp(rows, i.op)?.row.alias === 'operand')
      return i.args;
    return [];
  };
  const alias = (v: V): boolean => {
    if (p.types[v].shape.length === 0) return false;
    const known = memo.get(v);
    if (known !== undefined) return known;
    memo.set(v, false);
    const i = index.def.get(v);
    const r = i === undefined || sources(i, v).some(alias);
    memo.set(v, r);
    return r;
  };
  return alias;
}

export function printProgram(
  p: Program,
  syntax: Syntax,
  rows: readonly OperatorRow[]
): Printed {
  const index = useIndex(p);
  const fx = effects(p, rows);
  const inlined = inlinedValues(p, syntax, rows, fx, index);
  const alias = mayAliasInput(p, rows, index);
  const names = new Map<V, string>();
  const helpers = new Set<string>();
  const order: Omit<TraceEntry, 'region'>[] = [];
  const entry = entryOf(p);
  const positional = entry.positional ?? 0;
  entry.body.params.forEach((v, k) => {
    const name = entry.paramNames[k];
    const input =
      k < positional
        ? syntax.positional(name, argumentIndex(entry, k))
        : syntax.input(name, k);
    names.set(
      v,
      entry.lengthOf[k]
        ? syntax.length(input)
        : (syntax.read?.(input, p.types[v]) ?? input)
    );
  });
  const type = (v: V): IRType => p.types[v];
  const name = (v: V): string => names.get(v) ?? `v${v}`;
  /** The text of the value of `v` at a use. */
  const use = (v: V): string =>
    inlined.has(v) ? text(index.def.get(v)!) : name(v);

  /** The text of `op` applied to the texts of `operands`; `$#k` is the
   *  length of the list operand `k` of `i`. */
  const spell = (
    op: string,
    operands: (k: number) => string,
    i?: Instr & { k: 'op' }
  ): string => {
    const spelling = spellingOf(syntax, op);
    if (spelling === undefined)
      throw new Error(`slice printer: no spelling for the operation ${op}`);
    for (const h of spelling.helpers) helpers.add(syntax.helpers[h]);
    return spelling.text
      .replace(/\$#(\d)/g, (_, k) => {
        const n = type(i!.args[Number(k)]).shape[0]!;
        return typeof n === 'number' ? String(n) : use(n.v);
      })
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
        return syntax.call(i.fn, i.args.map(use));
      case 'op': {
        const shape = type(i.out);
        // A read of a list in storage is spelled `<op>.<storage kind>`.
        const held = i.args.length > 0 ? type(i.args[0]).storage : undefined;
        const op = held === undefined ? i.op : `${i.op}.${held}`;
        if (!threads(rows, p, i)) return spell(op, (k) => use(i.args[k]), i);
        if (syntax.map === undefined)
          throw new Error(
            `slice printer: an element-wise ${i.op} on a target without them`
          );
        // A plain `elem`: a list in storage is on GLSL only, which has no
        // `map` (no target reaches this with one).
        const lengths = shape.shape.map((n) =>
          typeof n === 'number' ? String(n) : use(n.v)
        );
        return syntax.map(lengths, (ix) => element(i, ix));
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

  const body = (r: Region, depth: number): string[] => {
    const lines: string[] = [];
    // The indentation stops at 16 levels: the text of a nest of depth d
    // would otherwise grow as d^2.
    const line = (s: string, d = depth) =>
      lines.push('  '.repeat(Math.min(d, 16)) + s);
    const nested = (inner: Region, targets: string[], carried: boolean) => {
      lines.push(...body(inner, depth + 1));
      // A loop body's yield can read a carried variable that an earlier
      // assignment wrote: with more than one, each value is read first.
      if (!carried || targets.length === 1) {
        targets.forEach((t, j) =>
          line(syntax.assign(t, use(inner.yields[j])), depth + 1)
        );
        return;
      }
      const temps = inner.yields.map((y, j) => {
        line(syntax.declare(type(y), `${targets[j]}_next`, use(y)), depth + 1);
        return `${targets[j]}_next`;
      });
      temps.forEach((t, j) => line(syntax.assign(targets[j], t), depth + 1));
    };
    for (const i of r.body) {
      if (
        fx.of(i) === 'effectful' &&
        i.k !== 'if' &&
        i.k !== 'loop' &&
        i.k !== 'const' &&
        i.k !== 'list'
      )
        order.push({
          name: i.k === 'call' ? `call ${i.fn}` : i.op,
          args: i.args,
          outs: outsOf(i),
        });
      if (i.k === 'if' && syntax.verdictIf !== undefined) {
        // The condition is read three times: a value written at its use is
        // bound to a name first (a constant is its text).
        const v = syntax.verdictIf;
        let c = use(i.cond);
        if (inlined.has(i.cond) && index.def.get(i.cond)?.k !== 'const') {
          line(syntax.declare(type(i.cond), name(i.cond), c));
          c = name(i.cond);
        }
        const arm = (k: string) => i.outs.map((o) => `${name(o)}_${k}`);
        i.outs.forEach((o) =>
          ['a', 'b'].forEach((k) =>
            line(syntax.declare(type(o), `${name(o)}_${k}`, undefined, true))
          )
        );
        line(v.first(c));
        nested(i.then, arm('a'), false);
        line(syntax.close);
        line(v.second(c));
        nested(i.else, arm('b'), false);
        line(syntax.close);
        i.outs.forEach((o, j) =>
          line(
            syntax.declare(type(o), name(o), v.join(c, arm('a')[j], arm('b')[j]))
          )
        );
      } else if (i.k === 'if') {
        i.outs.forEach((v) =>
          line(syntax.declare(type(v), name(v), undefined, true))
        );
        line(syntax.ifOpen(use(i.cond)));
        nested(i.then, i.outs.map(name), false);
        line(syntax.elseOpen);
        nested(i.else, i.outs.map(name), false);
        line(syntax.close);
      } else if (i.k === 'loop') {
        // A carried value has one variable: the result of the loop, which
        // the body reads as its parameter.
        i.outs.forEach((v, j) => {
          names.set(i.body.params[j + 1], name(v));
          line(syntax.declare(type(v), name(v), use(i.init[j]), true));
        });
        syntax
          .loopOpen(
            name(i.body.params[0]),
            use(i.lo),
            use(i.hi),
            i.passes === true
          )
          .forEach((s) => line(s));
        nested(i.body, i.outs.map(name), true);
        line(syntax.close);
      } else if (i.k === 'region') {
        const [inner] = i.regions;
        const s = syntax.regions[i.op]({
          outs: i.outs.map(name),
          types: i.outs.map(type),
          args: i.args.map(use),
          params: inner.params.map(name),
        });
        s.open.forEach((x) => line(x));
        lines.push(...body(inner, depth + 1));
        s.close(inner.yields.map(use)).forEach((x) => line(x));
      } else if (i.k === 'call' && i.outs.length === 2) {
        // The list, then its length (`lower-functions.ts`).
        const [n, list] = i.outs.map(name);
        line(syntax.declare(type(i.outs[1]), list, text(i)));
        line(syntax.declare(type(i.outs[0]), n, syntax.length(list)));
      } else if (i.k === 'call' && i.outs.length !== 1) {
        throw new Error('slice printer: a call with several results');
      } else {
        const out = outsOf(i)[0];
        if (!inlined.has(out))
          line(syntax.declare(type(out), name(out), text(i)));
      }
    }
    return lines;
  };

  const returned = (f: IRFunction): string[] => {
    const ys = f.body.yields;
    if (f.tuple === true && syntax.retTuple !== undefined)
      return [
        ...body(f.body, 1),
        '  ' + syntax.retTuple(ys.map(use), ys.map(alias)),
      ];
    if (f.results.length !== 1)
      throw new Error('slice printer: a function with several results');
    const y = f.body.yields[0];
    return [
      ...body(f.body, 1),
      '  ' + syntax.ret(use(y), f.results[0], alias(y)),
    ];
  };
  // The entry first: `order` follows `p.functions`, whose first is the entry.
  const main = returned(entry);
  const functions = p.functions
    .filter((f) => f.name !== p.entry)
    .map((f) => {
      const params = f.body.params.map((v) => ({
        name: name(v),
        type: type(v),
      }));
      return syntax.fn(f.name, params, f.results[0], returned(f));
    });
  return { body: main, functions, helpers: [...helpers], order };
}
