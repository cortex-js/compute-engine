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

/** The text of an operation, with `$0`, `$1` for its operands, and the
 *  helpers that the text calls. */
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
  /** The lines that open a counted loop of the index `k` from `lo` to `hi`,
   *  each bound evaluated once. */
  loopOpen(k: string, lo: string, hi: string): string[];
  readonly close: string;
  /** `copy`: the value can be (or hold) an input. */
  ret(value: string, type: IRType, copy: boolean): string;
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

/**
 * The values that a printer writes at their single use, not bound to a
 * name: a constant at any number of uses; a pure `op` or `list` read once,
 * by an instruction or a yield of its own region, when the use reads its
 * operand once (its spelling names the operand once), is not an
 * element-wise operation (whose operands are read once per element), and
 * no instruction between the definition and the use is effectful.
 */
export function inlinedValues(
  p: Program,
  syntax: Syntax,
  rows: readonly OperatorRow[],
  fx: Effects = effects(p, rows),
  index: UseIndex = useIndex(p)
): Set<V> {
  const inlined = new Set<V>();
  const readsOnce = (user: Instr, v: V): boolean => {
    if (user.k !== 'op') return true;
    if (threads(rows, p, user)) return false;
    const text = spellingOf(syntax, user.op)?.text ?? '';
    return user.args.every(
      (a, k) => a !== v || text.split(`$${k}`).length - 1 <= 1
    );
  };
  const walk = (r: Region) => {
    r.body.forEach((i, at) => {
      regionsOf(i).forEach(walk);
      if (i.k === 'const') return void inlined.add(i.out);
      if ((i.k !== 'op' && i.k !== 'list') || !fx.speculatable(i)) return;
      if (index.uses.get(i.out) !== 1) return;
      const later = r.body.slice(at + 1);
      const user = later.findIndex((u) => argsOf(u).includes(i.out));
      if (user < 0 && !r.yields.includes(i.out)) return;
      const between = user < 0 ? later : later.slice(0, user);
      if (!between.every((u) => fx.crossable(u))) return;
      if (user >= 0 && !readsOnce(later[user], i.out)) return;
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
      k < positional ? syntax.positional(name, k) : syntax.input(name, k);
    names.set(v, entry.lengthOf[k] ? syntax.length(input) : input);
  });
  const type = (v: V): IRType => p.types[v];
  const name = (v: V): string => names.get(v) ?? `v${v}`;
  /** The text of the value of `v` at a use. */
  const use = (v: V): string =>
    inlined.has(v) ? text(index.def.get(v)!) : name(v);

  /** The text of `op` applied to the texts of `operands`. */
  const spell = (op: string, operands: (k: number) => string): string => {
    const spelling = spellingOf(syntax, op);
    if (spelling === undefined)
      throw new Error(`slice printer: no spelling for the operation ${op}`);
    for (const h of spelling.helpers) helpers.add(syntax.helpers[h]);
    return spelling.text.replace(/\$(\d)/g, (_, k) => operands(Number(k)));
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
        if (!threads(rows, p, i)) return spell(i.op, (k) => use(i.args[k]));
        if (syntax.map === undefined)
          throw new Error(
            `slice printer: an element-wise ${i.op} on a target without them`
          );
        const lengths = shape.shape.map((n) =>
          typeof n === 'number' ? String(n) : use(n.v)
        );
        return syntax.map(lengths, (ix) =>
          spell(i.op, (k) => {
            const a = i.args[k];
            return type(a).shape.length === 0
              ? use(a)
              : ix.reduce(
                  (l, j) => spell('elem', (m) => (m === 0 ? l : j)),
                  use(a)
                );
          })
        );
      }
    }
    throw new Error(`slice printer: ${i.k} is not a value`);
  };

  const body = (r: Region, depth: number): string[] => {
    const lines: string[] = [];
    const line = (s: string, d = depth) => lines.push('  '.repeat(d) + s);
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
      if (i.k === 'if') {
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
          .loopOpen(name(i.body.params[0]), use(i.lo), use(i.hi))
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
