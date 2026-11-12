/**
 * The lowering of the slice compiler: one walk from a canonical expression
 * to the IR, which types each value as it makes it. It is the only place
 * that declines for a reason of scope. Collections are in
 * `lower-lists.ts`, user functions in `lower-functions.ts`.
 *
 * - The head of a call is resolved by its binding first: a user function
 *   (by its definition, `lower-functions.ts`), or the library operator of
 *   its name; any other head declines. Only then is it a construct of the
 *   walk (`If`, `Which`, `Block` with `Declare` and `Assign`, `List`, `At`,
 *   `Length`, `Range`, `Map`, `Filter`, `Reduce`, `WithRandomSeed`, `And`,
 *   `Or`), a reduction (`REDUCTIONS`) or a row of `operators.ts`. A name
 *   bound in the walk's frames is that value, also when it is the name of
 *   a library constant.
 * - A sub-expression whose heads are all rows that are not effectful
 *   (`Mod` may fail, the interpreter does not), constructs
 *   and constants of the slice, with no free name, no name bound in the
 *   frames and no loop is evaluated once by the interpreter, and its value
 *   is a literal (exact rationals and exact constants are exact until then).
 * - A local is renamed at each write (SSA): the walk keeps the value of
 *   each name in a frame, an `Assign` replaces it, and a conditional gives
 *   one result for each name that an arm writes.
 * - A node object that occurs again is the value of its first lowering
 *   when that lowering emitted no effectful instruction, wrote no name
 *   declared outside it, and the names it reads have the same values; so a
 *   tower of shared nodes is linear.
 * - The operands of `And` and `Or` after the first, and the pairs of a
 *   chain after the first, are lowered in an arm: evaluated only when the
 *   values before them do not decide. The `hoist` pass moves a pure one
 *   out of its arm.
 *
 * Nothing persists between two calls of `lower()`: every cache is made per
 * call.
 */

import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import type { Expression } from '../../global-types.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
  resolvedValueDefinition,
} from '../../boxed-expression/type-guards.js';
import {
  isLibraryOperator,
  isShadowedSymbol,
  shadowsLibraryName,
} from '../../library-shadowing.js';
import {
  Builder,
  isSubLane,
  joinType,
  lengthValues,
  sameShape,
  scalarType,
  typeToString,
  type IRType,
  type Lane,
  type Length,
  type Program,
  type Region,
  type V,
} from './ir.js';
import {
  CONSTANTS,
  REDUCTIONS,
  regionRow,
  resultType,
  rowOfHead,
  rowOfOp,
  SETTINGS,
  signatureOf,
  type OperatorRow,
} from './operators.js';
import {
  decline,
  text,
  type Fn,
  type Frame,
  type Lowering,
} from './lower-context.js';
import { listLowering, parameterName } from './lower-lists.js';
import { functionLowering, inputType, userBinding } from './lower-functions.js';

export { Decline } from './lower-context.js';

/** The heads of the walk's constructs, and those that are loops. */
const CONSTRUCTS = new Set([
  'If',
  'Which',
  'Block',
  'Declare',
  'Assign',
  'List',
  'At',
  'Length',
  'Range',
  'Map',
  'Filter',
  'Reduce',
  'Typed',
  'Limits',
]);
const LOOPS = new Set(['Map', 'Filter', 'Reduce', 'Range']);

/** What the memo and `closedValue()` read of a node: the names it reads
 *  and writes (outside it), whether it has a loop, whether every head
 *  is a row that is not effectful, a construct or a constant of the slice, and the number of
 *  its nodes counted on every path (at most `CLOSED_SIZE`, plus one). */
type Facts = {
  names: Set<string>;
  writes: Set<string>;
  loop: boolean;
  slice: boolean;
  size: number;
};

/** The largest closed node, counted on every path, that the walk evaluates
 *  with `N()`: the interpreter walks every path of a shared node, so a
 *  closed tower of shared nodes would take a time exponential in its
 *  depth. A larger node is lowered, and its parts are folded. */
const CLOSED_SIZE = 10_000;

/** The IR operations whose value changes when an integer of 2^53 or more
 *  is rounded to a double (`Mod(2^60 + n, 3)`), and those through which
 *  such an integer stays one. */
const EXACT_OPS = new Set([
  'mod',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'fract',
  'lt',
  'le',
  'gt',
  'ge',
  'eq',
  'ne',
]);
const INTEGER_OPS = new Set(['add', 'sub', 'neg', 'mul', 'abs', 'max', 'min']);

/** `fold: false` (the `constantFold: false` option of the profile `ir`):
 *  no closed sub-expression is evaluated with `N()`. */
export type LowerOptions = { readonly fold?: boolean };

export function lower(
  root: Expression,
  rows: readonly OperatorRow[],
  options: LowerOptions = {}
): Program {
  const ce = root.engine;
  const b = new Builder(
    (op) => rowOfOp(rows, op)?.row.effect === 'pure',
    (i) =>
      i.k === 'op'
        ? rowOfOp(rows, i.op)?.row.effect === 'effectful'
        : i.k === 'call' && fns.effect(i.fn) === 'effectful'
  );
  const frames: Frame[] = [{ names: new Map(), loop: false }];
  const memo = new Map<
    Expression,
    { v: V; region: Region; reads: [string, V | undefined][] }
  >();
  const known = new WeakMap<Expression, Facts>();
  const inputLengths = new Set<V>();
  /** The values that are, or are computed exactly from, an integer
   *  constant of 2^53 or more (`EXACT_OPS`). */
  const large = new Set<V>();
  const constantOf = (x: number, lane: 'integer' | 'real'): V => {
    const v = b.constant(x, lane);
    if (Number.isInteger(x) && Math.abs(x) >= 2 ** 53) large.add(v);
    return v;
  };
  const type = (v: V) => b.typeOf(v);
  const constant = (v: V) => {
    const c = b.constants.get(v);
    return typeof c === 'number' ? c : undefined;
  };
  const same = (x: readonly Length[], y: readonly Length[]) =>
    sameShape(x, y, constant);
  const row = (head: string) => rowOfHead(rows, head)!;

  const lookup = (name: string) => {
    let outer = false;
    for (let i = frames.length - 1; i >= 0; i--) {
      const binding = frames[i].names.get(name);
      if (binding) return { binding, outer };
      if (frames[i].loop) outer = true;
    }
    return undefined;
  };
  const bound = (name: string) => lookup(name)?.binding.v;

  const withFrame = <T>(loop: boolean, f: (frame: Frame) => T): T => {
    const frame: Frame = { names: new Map(), loop };
    frames.push(frame);
    try {
      return f(frame);
    } finally {
      frames.pop();
    }
  };

  const isLibrary = (e: Fn) =>
    userBinding(e) === undefined && isLibraryOperator(e as never, e.operator);

  const facts = (e: Expression): Facts => {
    const none = new Set<string>();
    if (isSymbol(e))
      return {
        names: new Set([e.symbol]),
        writes: none,
        loop: false,
        slice: true,
        size: 1,
      };
    if (!isFunction(e))
      return {
        names: none,
        writes: none,
        loop: false,
        slice: isNumber(e),
        size: 1,
      };
    const f = known.get(e);
    if (f !== undefined) return f;
    const h = e.operator;
    const user = userBinding(e) !== undefined;
    const library = !user && isLibraryOperator(e as never, h);
    const info: Facts = {
      names: new Set(),
      writes: new Set(),
      loop:
        user ||
        LOOPS.has(h) ||
        (REDUCTIONS.get(h)?.indexed === true && isFunction(e.ops[1], 'Limits')),
      slice:
        library &&
        (CONSTRUCTS.has(h) ||
          REDUCTIONS.has(h) ||
          (rowOfHead(rows, h)?.effect ?? 'effectful') !== 'effectful'),
      size: 1,
    };
    if (h === 'Assign' && isSymbol(e.ops[0])) info.writes.add(e.ops[0].symbol);
    for (const op of e.ops) {
      const t = facts(op);
      info.loop ||= t.loop;
      info.slice &&= t.slice;
      info.size = Math.min(CLOSED_SIZE + 1, info.size + t.size);
      t.names.forEach((n) => info.names.add(n));
      t.writes.forEach((n) => info.writes.add(n));
    }
    if (h === 'Block')
      for (const op of e.ops)
        if (isFunction(op, 'Declare') && isSymbol(op.ops[0]))
          info.writes.delete(op.ops[0].symbol);
    known.set(e, info);
    return info;
  };

  /** Apply `row` to the values `args`. */
  const apply = (node: Expression, r: OperatorRow, args: V[]): V => {
    for (const s of r.settings ?? [])
      if (!SETTINGS[s](ce))
        decline(node, `${r.head} with a ${s} other than the default`);
    const n = args.length;
    if (typeof r.arity === 'number' ? n !== r.arity : n < 2)
      decline(node, `${r.head} with ${n} operands`);
    const c = r.constantOperand;
    if (c !== undefined && b.constants.get(args[c.index]) === c.value)
      return apply(
        node,
        row(c.head),
        args.filter((_, i) => i !== c.index)
      );
    const operation = (operands: V[]): V => {
      const types = operands.map(type);
      const signature = signatureOf(r, types);
      if (signature === undefined)
        decline(
          node,
          !r.threads && types.some((t) => t.shape.length > 0)
            ? `${r.head} of a list`
            : `${r.head} of ${types.map(typeToString).join(', ')}`
        );
      const base = signature[2].split('.')[0];
      const fromLarge = operands.some((v) => large.has(v));
      if (fromLarge && EXACT_OPS.has(base))
        decline(
          node,
          'an integer of 2^53 or more, which the interpreter computes with exactly and a double does not hold'
        );
      const t = resultType(signature, types, same);
      if (t === undefined)
        decline(
          node,
          types.some((t) => lengthValues(t).length > 0)
            ? 'lists of run-time lengths that are not one length by construction (the same list, or a Map of it)'
            : 'lists of different lengths'
        );
      const out = b.op(signature[2], operands, t);
      if (fromLarge && INTEGER_OPS.has(base)) large.add(out);
      return out;
    };
    if (typeof r.arity === 'number' || r.arity === 'chain')
      return operation(args);
    return args.slice(1).reduce((x, y) => operation([x, y]), args[0]);
  };

  /** Lower `e`. With `want` false its value is not used (a statement). */
  const value = (e: Expression, want = true): V | undefined => {
    const shared = want && isFunction(e) && facts(e).writes.size === 0;
    if (shared) {
      const m = memo.get(e);
      if (
        m !== undefined &&
        b.isOpen(m.region) &&
        m.reads.every(([n, v]) => bound(n) === v)
      )
        return m.v;
    }
    const region = b.current();
    const effects = b.effects;
    const v = node(e, want);
    if (shared && v !== undefined && b.effects === effects) {
      const reads = [...facts(e).names].map((n): [string, V | undefined] => [
        n,
        bound(n),
      ]);
      memo.set(e, { v, region, reads });
    }
    return v;
  };

  const scalar = (e: Expression): V => {
    const v = value(e)!;
    if (type(v).shape.length > 0)
      decline(e, 'a list where a scalar is required');
    return v;
  };

  const node = (e: Expression, want: boolean): V | undefined => {
    if (isNumber(e)) {
      if (e.im !== 0) decline(e, 'a complex number');
      return constantOf(e.re, Number.isSafeInteger(e.re) ? 'integer' : 'real');
    }
    if (isSymbol(e)) return symbol(e, want);
    if (!isFunction(e)) decline(e, 'not a number, a symbol or a function');
    const user = userBinding(e);
    if (user !== undefined || fns.recursive(e)) return fns.call(e, user);
    if (!isLibraryOperator(e as never, e.operator))
      decline(
        e,
        e.operatorDefinition === undefined && e.valueDefinition === undefined
          ? `${e.operator} is an unknown operator (no definition)`
          : `${e.operator} is not the library operator here (a user definition)`
      );
    const closed = closedValue(e);
    if (closed !== undefined) return closed;
    switch (e.operator) {
      case 'If':
        return conditional(e, [[e.ops[0], e.ops[1]]], e.ops[2], want);
      case 'Which': {
        if (e.nops % 2 !== 0) decline(e, 'an odd number of operands');
        const clauses: [Expression, Expression][] = [];
        for (let i = 0; i < e.nops; i += 2)
          clauses.push([e.ops[i], e.ops[i + 1]]);
        // A last clause `True` is the arm taken when no other is.
        const last = clauses[clauses.length - 1];
        if (last !== undefined && isSymbol(last[0], 'True'))
          return conditional(e, clauses.slice(0, -1), last[1], want);
        return conditional(e, clauses, undefined, want);
      }
      case 'Block':
        return block(e, want);
      case 'List':
        return list(e);
      case 'At': {
        if (e.nops !== 2) decline(e, 'At with an index for each level');
        const [l, i] = [value(e.ops[0])!, scalar(e.ops[1])];
        const [t, k] = [type(l), constant(i)];
        const n = t.shape[0];
        // Out of range, the interpreter gives NaN for a number, `Missing`
        // for a boolean or a list; the `fold` pass makes a constant index
        // in range an element.
        if (
          (t.lane === 'boolean' || t.shape.length > 1) &&
          !(
            typeof n === 'number' &&
            k !== undefined &&
            Number.isInteger(k) &&
            k !== 0 &&
            Math.abs(k) <= n
          )
        )
          decline(
            e,
            'an index that can be out of range, of a list of booleans or of lists'
          );
        return apply(e, row('At'), [l, i]);
      }
      case 'Length':
        return lists.source(e.ops[0]).length;
      case 'Range':
        return lists.source(e).value();
      case 'Map':
        if (e.nops !== 2) decline(e, 'Map of more than one list');
        return lists.build(e, e.ops[1], e.ops[0], false);
      case 'Filter':
        if (e.nops !== 2)
          decline(e, 'Filter with more than a list and a predicate');
        return lists.build(e, e.ops[0], e.ops[1], true);
      case 'Reduce': {
        const [l, head, init] = e.ops;
        const r =
          isSymbol(head) && !shadowsLibraryName(ce as never, head.symbol)
            ? rowOfHead(rows, head.symbol)
            : undefined;
        if (e.nops !== 3 || r?.arity !== 'variadic')
          decline(
            e,
            'a Reduce with no initial value, or not by a variadic library operator of the slice'
          );
        return lists.reduce(e, r, [lists.source(l)], scalar(init));
      }
      case 'Typed':
        return value(e.ops[0], want);
      case 'WithRandomSeed': {
        const seed = scalar(e.ops[0]);
        if (e.nops !== 2 || type(seed).lane === 'boolean')
          decline(e, 'a seed that is not a number');
        return seededFrame(e, seed, () => value(e.ops[1], want), want);
      }
      case 'Assign':
        return assign(e);
      case 'Declare':
        decline(e, 'Declare outside a block');
      case 'Function':
        decline(
          e,
          'a function value that is not the program or the literal of a Map or a Filter'
        );
      case 'Error':
        decline(e, 'an error of the canonical form');
    }
    const reduction = REDUCTIONS.get(e.operator);
    const r = rowOfHead(rows, reduction?.row ?? e.operator);
    if (r === undefined)
      decline(e, `the operator ${e.operator} is not in the slice`);
    if (reduction !== undefined) return lists.reduction(e, r);
    if (e.operator === 'And' || e.operator === 'Or') {
      const boolean = (i: number) => {
        const v = scalar(e.ops[i]);
        if (type(v).lane !== 'boolean') decline(e.ops[i], 'not a boolean');
        return v;
      };
      return lazily(e, e.operator === 'Or', boolean(0), e.nops, boolean);
    }
    // The pairs of a chain, joined by `And`.
    if (r.arity === 'chain') {
      let prev = value(e.ops[0])!;
      const pair = (i: number) => {
        const v = value(e.ops[i + 1])!;
        const p = apply(e, r, [prev, v]);
        // A conditional on a list: `L < 0 < 1`.
        if (e.nops > 2 && type(p).shape.length > 0)
          decline(e, 'a chain of three or more operands with a list');
        prev = v;
        return p;
      };
      return lazily(e, false, pair(0), e.nops - 1, pair);
    }
    return apply(
      e,
      r,
      e.ops.map((op) => value(op)!)
    );
  };

  /** The booleans `first`, `next(1)`, … `next(n - 1)` joined by `And`
   *  (`decides` false) or `Or` (true): each after the first is lowered in
   *  an arm, only when the values before it do not decide. */
  const lazily = (
    e: Fn,
    decides: boolean,
    first: V,
    n: number,
    next: (i: number) => V
  ): V => {
    const go = (acc: V, i: number): V => {
      if (i === n) return acc;
      const decided = () => b.constant(decides, 'boolean');
      const rest = () => go(next(i), i + 1);
      return branch(
        e,
        acc,
        decides ? decided : rest,
        decides ? rest : decided,
        true
      )!;
    };
    return go(first, 1);
  };

  /** The interpreter's value of a sub-expression of the slice's own heads
   *  with no free name, no effect and no loop, as a literal; `undefined`
   *  when it has another form, or when its evaluation throws (other than a
   *  cancellation, which propagates): the walk lowers it then. */
  const closedValue = (e: Fn): V | undefined => {
    const f = facts(e);
    if (
      options.fold === false ||
      !f.slice ||
      f.loop ||
      f.size > CLOSED_SIZE ||
      e.unknowns.length > 0
    )
      return undefined;
    // A name bound in the walk (a parameter named `Pi`) is not the
    // library's; a name with a value declines where it is read.
    const valued = (s: string) =>
      lookup(s) !== undefined ||
      (!CONSTANTS.has(s) &&
        s !== 'True' &&
        s !== 'False' &&
        resolvedValueDefinition(ce.box(s))?.value !== undefined);
    if ([...f.names].some(valued)) return undefined;
    let n: Expression;
    try {
      n = e.N();
    } catch (error) {
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return undefined;
    }
    if (isSymbol(n, 'True') || isSymbol(n, 'False'))
      return b.constant(isSymbol(n, 'True'), 'boolean');
    if (!isNumber(n) || n.im !== 0) return undefined;
    return constantOf(n.re, Number.isSafeInteger(n.re) ? 'integer' : 'real');
  };

  const symbol = (
    e: Expression & { symbol: string },
    want: boolean
  ): V | undefined => {
    const name = e.symbol;
    if (name === 'Nothing') {
      if (want) decline(e, 'Nothing as a value');
      return undefined;
    }
    const known = lookup(name);
    if (known) return known.binding.v;
    if (name === 'True' || name === 'False')
      return b.constant(name === 'True', 'boolean');
    const c = CONSTANTS.get(name);
    if (c !== undefined) {
      if (isShadowedSymbol(e as never))
        decline(e, `${name} is not the library constant here`);
      return b.constant(c, 'real');
    }
    if (cx.inFunction !== undefined)
      decline(
        e,
        `the function ${cx.inFunction} reads ${name}, which is not a parameter (a capture)`
      );
    if (resolvedValueDefinition(e)?.value !== undefined)
      decline(e, 'a symbol with a value');
    return input(e, name, e.type.type);
  };

  /** The input `name` of the engine type `t`: a parameter of the entry (a
   *  positional one: of a root function literal). A list of run-time length
   *  has its length as a parameter before it. */
  const input = (
    e: Expression,
    name: string,
    t: Parameters<typeof inputType>[0],
    positional = false
  ): V => {
    const ir = inputType(t);
    if (ir === undefined)
      decline(e, `the input ${name} of type ${engineTypeToString(t)}`);
    const shape = ir.shape.map((n) => {
      if (n !== 'run-time') return n;
      const length = b.param(name, scalarType('integer'), true);
      inputLengths.add(length);
      if (positional) b.positional += 1;
      return { v: length };
    });
    const v = b.param(name, { lane: ir.lane, shape });
    if (positional) b.positional += 1;
    frames[0].names.set(name, { v, role: positional ? 'index' : 'input' });
    return v;
  };

  /** A region made by `f`, from the bindings before it: its result, and
   *  the value of each binding of `bindings` after it (the bindings are
   *  restored; an input that `f` reads adds a binding, not in the list). */
  const arm = (
    f: () => V | undefined,
    bindings = frames.flatMap((f) => [...f.names.values()])
  ) => {
    const before = bindings.map((x) => x.v);
    let result: V | undefined;
    let after: V[] = [];
    const region = b.region([], () => {
      result = f();
      after = bindings.map((x) => x.v);
      return [];
    });
    bindings.forEach((x, i) => (x.v = before[i]));
    return { region, result, after, bindings, before };
  };

  /** A conditional on the value `cond`. Each arm starts from the bindings
   *  before it; a binding that an arm changes becomes a result. */
  const branch = (
    node: Expression,
    cond: V,
    then: () => V | undefined,
    otherwise: () => V | undefined,
    want: boolean
  ): V | undefined => {
    const a = arm(then);
    const c = arm(otherwise, a.bindings);
    const { bindings, before } = a;
    const outs: V[] = [];
    const join = (x: V, y: V, cause: string): V => {
      const t = joinType(type(x), type(y));
      if (t === undefined) decline(node, cause);
      a.region.yields.push(x);
      c.region.yields.push(y);
      outs.push(b.newValue(t));
      return outs[outs.length - 1];
    };
    const changed = bindings.filter(
      (_, i) => a.after[i] !== before[i] || c.after[i] !== before[i]
    );
    const joined = changed.map((x) => {
      const i = bindings.indexOf(x);
      return join(a.after[i], c.after[i], 'a local written with two types');
    });
    let result: V | undefined;
    if (want) {
      if (a.result === undefined || c.result === undefined)
        decline(node, 'an arm with no value');
      result = join(a.result, c.result, 'arms of two types');
    }
    b.emit({ k: 'if', outs, cond, then: a.region, else: c.region });
    changed.forEach((x, j) => (x.v = joined[j]));
    return result;
  };

  /** The region instruction of the row `op`, of the operands `args` and the
   *  region `f` with `params`: its results, typed by its row. */
  const region = (
    op: string,
    args: V[],
    params: V[],
    f: () => V[],
    site: Expression
  ): V[] => {
    const r = regionRow(op)!;
    const body = b.region(params, f);
    const ys = body.yields.map(type);
    const outs = r
      .results(args, ys, [])!
      .map(() => b.newValue(scalarType('real')));
    r.results(args, ys, outs)!.forEach((t, k) => (b.types[outs[k]] = t));
    b.emit({ k: 'region', outs, op, args, regions: [body], site: text(site) });
    return outs;
  };

  /** A region run in a new random frame of `seed`: a binding that it
   *  changes, and its value, are its results. */
  const seededFrame = (
    node: Expression,
    seed: V,
    f: () => V | undefined,
    want: boolean
  ): V | undefined => {
    const start = b.types.length;
    const { region, result, after, bindings, before } = arm(f);
    const changed = bindings.filter((_, i) => after[i] !== before[i]);
    if (want && result === undefined) decline(node, 'a frame with no value');
    // A value made in the frame is not visible after it.
    if (
      want &&
      lengthValues(type(result!)).some(
        (n) => n >= start && !inputLengths.has(n)
      )
    )
      decline(node, 'a list of run-time length made in a random frame');
    region.yields.push(...changed.map((x) => after[bindings.indexOf(x)]));
    if (want) region.yields.push(result!);
    const outs = region.yields.map((y) => b.newValue(type(y)));
    b.emit({
      k: 'region',
      outs,
      op: 'seeded',
      args: [seed],
      regions: [region],
      site: text(node),
    });
    changed.forEach((x, j) => (x.v = outs[j]));
    return want ? outs[outs.length - 1] : undefined;
  };

  /** `If` and `Which`: a chain of conditionals whose last arm is
   *  `otherwise` (absent: NaN, the value of a selection that takes no
   *  arm). */
  const conditional = (
    node: Expression,
    clauses: [Expression, Expression][],
    otherwise: Expression | undefined,
    want: boolean
  ): V | undefined => {
    if (clauses.length === 0) {
      if (otherwise !== undefined) return value(otherwise, want);
      return want ? b.constant(NaN, 'real') : undefined;
    }
    const [[test, then], ...rest] = clauses;
    const cond = scalar(test);
    if (type(cond).lane !== 'boolean')
      decline(test, 'a condition that is not a boolean');
    return branch(
      node,
      cond,
      () => value(then, want),
      () => conditional(node, rest, otherwise, want),
      want
    );
  };

  const list = (e: Fn): V => {
    if (e.nops === 0) decline(e, 'an empty list');
    const elements = e.ops.map((op) => value(op)!);
    let t: IRType | undefined = type(elements[0]);
    for (const v of elements) {
      t = joinType(t, type(v));
      if (t === undefined) decline(e, 'elements of two types');
    }
    if (lengthValues(t).length > 0)
      decline(e, 'a list of lists of run-time length');
    return b.list(elements, {
      lane: t.lane,
      shape: [elements.length, ...t.shape],
    });
  };

  const local = (s: Expression, v: V, lane: Lane): V => {
    if (!isSubLane(type(v).lane, lane))
      decline(s, `a value that is not ${lane}`);
    return v;
  };

  const block = (e: Fn, want: boolean): V | undefined =>
    withFrame(false, (frame) => {
      let result: V | undefined;
      e.ops.forEach((s, i) => {
        if (isFunction(s, 'Declare')) {
          // `Declare(t, type, value)`, `Declare(t, type, {value})` or
          // `Declare(t, {value})`; a type `unknown`, or none, is the lane
          // of the value. (A declaration with no value is an error of the
          // canonical form.)
          const [name, ...rest] = s.ops;
          const last = rest[rest.length - 1];
          const attributes = isDictionary(last) ? last : undefined;
          const [declared, init] = attributes ? rest.slice(0, -1) : rest;
          const value = init ?? attributes?.get('value');
          if (
            !isSymbol(name) ||
            value === undefined ||
            attributes?.keys.some((k) => k !== 'value') === true
          )
            decline(s, 'a declaration with no value, or with attributes');
          const typeName = isString(declared)
            ? declared.string
            : isSymbol(declared)
              ? declared.symbol
              : 'unknown';
          if (!['real', 'integer', 'boolean', 'unknown'].includes(typeName))
            decline(s, `a local of type ${typeName}`);
          const v = scalar(value);
          // With no type, a number is a real: a later write of a real to
          // `let t = 0` is valid.
          const lane: Lane =
            typeName !== 'unknown'
              ? (typeName as Lane)
              : type(v).lane === 'boolean'
                ? 'boolean'
                : 'real';
          result = local(s, v, lane);
          frame.names.set(name.symbol, { v: result, lane, role: 'local' });
        } else result = value(s, want && i === e.nops - 1);
      });
      if (want && result === undefined) decline(e, 'a block with no value');
      return result;
    });

  const assign = (e: Fn): V => {
    const name = e.ops[0];
    if (!isSymbol(name)) decline(e, 'a write that is not to a name');
    const known = lookup(name.symbol);
    if (known?.binding.role !== 'local')
      decline(e, 'a write to a name that is not a local');
    if (known.outer)
      decline(e, 'a write in a loop to a local declared outside it');
    const v = local(e, scalar(e.ops[1]), known.binding.lane!);
    known.binding.v = v;
    return v;
  };

  const cx: Lowering = {
    ce,
    b,
    rows,
    frames,
    value,
    scalar,
    apply,
    row,
    type,
    constant,
    branch,
    withFrame,
    region,
    isLibrary,
  };
  const lists = listLowering(cx);
  const fns = functionLowering(cx);

  // A root function literal: its parameters, by position, come first.
  if (isFunction(root, 'Function') && isLibrary(root)) {
    b.literal = true;
    return b.program(() => {
      root.ops.slice(1).forEach((p) => {
        const name = parameterName(p);
        if (name === undefined) decline(root, 'a parameter that is not a name');
        const declared =
          isFunction(p, 'Typed') && isString(p.ops[1])
            ? ce.type(p.ops[1].string).type
            : 'unknown';
        input(p, name, declared, true);
      });
      return value(root.ops[0])!;
    });
  }
  return b.program(() => value(root)!);
}
