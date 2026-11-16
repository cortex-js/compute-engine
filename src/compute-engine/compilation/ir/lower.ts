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
 *   `Length`, `Range`, `Map`, `Filter`, `Reduce`, `Tuple`, `PointList`,
 *   `Comprehension`, `WithRandomSeed`, `Apply` of a function literal, `And`,
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
 * - A free name with a value in the engine is that value, a literal of the
 *   program (`Program.captures`), when it is a number, or a list or a
 *   tuple of numbers, also in a function body whose occurrence reads the
 *   same binding.
 * - A real read where a complex is read is converted there (`widen()`).
 *
 * Nothing persists between two calls of `lower()`: every cache is made per
 * call.
 */

import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import type { Type } from '../../../common/type/types.js';
import type { Expression } from '../../global-types.js';
import type { NumericValue } from '../../numeric-value/types.js';
import { BigNumericValue } from '../../numeric-value/big-numeric-value.js';
import { ExactNumericValue } from '../../numeric-value/exact-numeric-value.js';
import { MachineNumericValue } from '../../numeric-value/machine-numeric-value.js';
import { BigDecimal } from '../../../big-decimal/index.js';
import {
  exactDoubleValue,
  exactValueDoubleRoundings,
} from '../../numeric-value/exact-integer-value.js';
import { realPowerBranchTerms } from '../../numerics/real-power.js';
import {
  freeBinding,
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
import { literalParamsMap } from '../../library/core.js';
import {
  Builder,
  isSubLane,
  joinType,
  widensTo,
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
  ANGLE_FACTORS,
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
  Decline,
  decline,
  hasOwnLowering,
  isUntyped,
  text,
  TUPLE_RULES,
  UntypedInputs,
  type Fn,
  type Frame,
  type Lowering,
} from './lower-context.js';
import { toBigint } from '../../boxed-expression/numerics.js';
import { listLowering, parameterName } from './lower-lists.js';
import {
  intervalClosedForm,
  intervalQuadratureRefusal,
  intervalQuadratureSize,
} from '../interval-quadrature.js';
import {
  functionLowering,
  inputType,
  tupleAxis,
  tupleOrInputType,
  userBinding,
} from './lower-functions.js';

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
  'Loop',
  'Tuple',
  'PointList',
  'Comprehension',
]);
const LOOPS = new Set([
  'Map',
  'Filter',
  'Reduce',
  'Range',
  'Loop',
  'Comprehension',
]);

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

/** The most nodes that one compilation lowers. A shared node, and the nodes
 *  equal to it, are lowered once per region (the memo of `value()`), so
 *  the two arms of an `If` that both read a shared graph lower it once
 *  each, and a chain of such `If`s takes a time and gives a text
 *  exponential in its depth. Over the limit the program declines. */
const NODE_LIMIT = 50_000;

/** `fold: false` (the `constantFold: false` option of the profile `ir`):
 *  no closed sub-expression is evaluated with `N()`. `mode: 'complex'`: a
 *  row that can leave the reals takes its complex signature unless its
 *  operands prove a real value (`OperatorRow.leaves`). `mode: 'bigint'`:
 *  every number is an integer, exact at any size (a closed node is the
 *  exact value of `evaluate()`); a real or complex value declines.
 *  `mode: 'interval'`: `'strict'`, with a real literal whose double is not
 *  its value marked `inexact`, and `x^(p/q)` of a literal rational `p/q`
 *  lowered as `Root(x, q)^p`. `iterationBudget`:
 *  a `Sum` or a `Product` of more passes than it is NaN. */
export type LowerOptions = {
  readonly fold?: boolean;
  readonly mode?: 'strict' | 'complex' | 'bigint' | 'interval';
  readonly iterationBudget?: number;
  /** The `vars` option: a name read as the host's text (`hostVarOp()`). */
  readonly vars?: readonly string[];
  /** The names of `vars` whose text reads the inputs object
   *  (`readsVarsObject()`): a function body reads one as an input. */
  readonly objectVars?: readonly string[];
  /** The interval mode: the text of each `vars` name, for the closed form
   *  of an integral (`intervalClosedForm()`). */
  readonly varsTexts?: Readonly<Record<string, string>>;
  /** `false` (GLSL): a list parameter of a user function of no stated
   *  length takes the stated length of its argument at the first call. */
  readonly runtimeLengths?: boolean;
};

/** The IR operation of the read of the `vars` name of index `k` on the
 *  lane `lane`: an effectful operation, spelled as the host's text. */
export const hostVarOp = (k: number, lane: Lane) => `host${k}.${lane}`;

export function lower(
  root: Expression,
  rows: readonly OperatorRow[],
  options: LowerOptions = {}
): Program {
  const ce = root.engine;
  const bigint = options.mode === 'bigint';
  const interval = options.mode === 'interval';
  const b = new Builder(
    (op) => rowOfOp(rows, op)?.row.effect === 'pure',
    (i) =>
      i.k === 'op'
        ? rowOfOp(rows, i.op)?.row.effect === 'effectful'
        : i.k === 'call'
          ? fns.effect(i.fn) === 'effectful'
          : i.k === 'region' && regionRow(i.op)?.effect === 'effectful'
  );
  const frames: Frame[] = [{ names: new Map(), loop: false }];
  // The memo of `value()`, keyed by the structural id of a node (`idOf()`),
  // so that equal sub-expressions that the source writes as separate nodes
  // are lowered once.
  const memo = new Map<
    number,
    { v: V; region: Region; reads: [string, V | undefined][] }
  >();
  // The id of a node, and of a definition: equal ids for two nodes of the
  // same operator, definition and operands, of the same kind and value of a
  // number, of the same string, of the same name and definition (and type,
  // for a name with no definition); a new id for every other node.
  const ids = new WeakMap<object, number>();
  const interned = new Map<string, number>();
  let lastId = 0;
  const objectId = (x: object): number => {
    let k = ids.get(x);
    if (k === undefined) ids.set(x, (k = ++lastId));
    return k;
  };
  const definitionKey = (e: Expression): string => {
    const free = freeBinding(e) as { value?: object; operator?: object };
    const d =
      e.valueDefinition ??
      e.operatorDefinition ??
      free?.value ??
      free?.operator;
    return d === undefined ? `t${e.type.toString()}` : `d${objectId(d)}`;
  };
  const idOf = (e: Expression): number => {
    let k = ids.get(e);
    if (k !== undefined) return k;
    const key = isFunction(e)
      ? `f${e.operator}\u001f${definitionKey(e)}\u001f${e.ops.map(idOf).join()}`
      : isSymbol(e)
        ? `s${e.symbol}\u001f${definitionKey(e)}`
        : isNumber(e)
          ? numberKey(e.numericValue)
          : isString(e)
            ? `"${e.string}`
            : undefined;
    k = key === undefined ? ++lastId : interned.get(key);
    if (k === undefined) interned.set(key!, (k = ++lastId));
    ids.set(e, k);
    return k;
  };
  const known = new WeakMap<Expression, Facts>();
  const inputLengths = new Set<V>();
  // The names read as inputs of the compilation (of the entry, lifted into
  // a body, `vars`), in the order the lowering reads them, and those that an
  // occurrence or a declaration types (`program()`).
  const seen = new Set<string>();
  const typed = new Set<string>();
  const note = (name: string, t: Type) => {
    seen.add(name);
    if (!isUntyped(t)) typed.add(name);
  };
  // The root `Tuple`, or the last operand of a root `Block` that is one.
  let rootTuple: Expression | undefined = root;
  while (isFunction(rootTuple, 'Block')) rootTuple = rootTuple.ops.at(-1);
  if (!isFunction(rootTuple, 'Tuple')) rootTuple = undefined;
  let rootParts: V[] | undefined;
  const tuples = new Map<V, number>();
  /** `to`, marked a tuple where `from` is one, with the axis `from` has
   *  plus `shift`. */
  const keep = (from: V, to: V, shift = 0): V => {
    const a = tuples.get(from);
    if (a !== undefined && a + shift >= 0) tuples.set(to, a + shift);
    return to;
  };
  const type = (v: V) => b.typeOf(v);
  const constant = (v: V) => {
    const c = b.constants.get(v);
    return typeof c === 'number' ? c : undefined;
  };
  const same = (x: readonly Length[], y: readonly Length[]) =>
    sameShape(x, y, constant);
  const row = (head: string) => rowOfHead(rows, head)!;
  /** The constant of the integer `x`: a number when it is safe. */
  const exact = (x: bigint): V => {
    const n = Number(x);
    return b.constant(Number.isSafeInteger(n) ? n : x, 'integer');
  };

  /** `v` where a value of `lane` is read: converted to the complex lane
   *  when it is real, as it is otherwise. */
  const widen = (v: V, lane: Lane): V =>
    lane === 'complex' && type(v).lane !== 'complex'
      ? b.op('cplx', [v], { lane, shape: type(v).shape })
      : v;

  /** `cplx` of `v` appended to the closed region `r` (an arm). */
  const widenIn = (r: Region, v: V, t: IRType): V => {
    if (type(v).lane === t.lane || t.lane !== 'complex') return v;
    const out = b.newValue(t);
    r.body.push({ k: 'op', out, op: 'cplx', args: [v] });
    return out;
  };

  /** `v` is proved `>= 0` by what cannot change after the compilation: a
   *  constant, an operation whose value is nonnegative (`abs`, `exp`, an
   *  even power), a sum or a product of such values. Not the type of an
   *  input: an assumption narrows it (`assume(s >= 0)` makes the type of
   *  `s` `real<0..>`) and `forget()` widens it again. */
  const nonnegative = (v: V, depth = 0): boolean => {
    const c = constant(v);
    if (c !== undefined) return c >= 0;
    const i = b.defs.get(v);
    if (i === undefined || depth > 16) return false;
    const op = i.op.split('.')[0];
    const k = constant(i.args[1]);
    if (['abs', 'cabs', 'exp', 'hypot'].includes(op)) return true;
    if (op === 'pow' && k !== undefined && Number.isInteger(k) && k % 2 === 0)
      return true;
    if (op === 'mul' && i.args[0] === i.args[1]) return true;
    return (
      ['add', 'mul', 'max', 'pow', 'sqrt'].includes(op) &&
      (op === 'pow' ? [i.args[0]] : i.args).every((a) =>
        nonnegative(a, depth + 1)
      )
    );
  };

  /** Whether `r` takes its complex signature on `args`: in every mode when
   *  the operands are finite constants on which the row's real function is
   *  NaN (`Ln(-2)`, a complex-shaped value of the `strict` mode); in
   *  `mode: 'strict'` when the node's operand `nonnegative` is proved
   *  negative (`isNegative`), the others are constants and the real
   *  function is NaN at -1 there; in `mode: 'complex'` when its row can
   *  leave the reals and no operand proves a real value (an operand
   *  `nonnegative()`, an integer exponent where the row says so). */
  const leaves = (r: OperatorRow, args: V[], node: Expression): boolean => {
    if (r.leaves === undefined) return false;
    const c = args.map(constant);
    if (
      r.fold !== undefined &&
      c.every((x) => x !== undefined && Number.isFinite(x)) &&
      Number.isNaN(r.fold(...c))
    )
      return true;
    const { nonnegative: k, integer: j } = r.leaves;
    // Strict: the operand `k` of the node is proved negative, and the real
    // function is NaN at -1 there with the other operands constant (not
    // the real root `Root(-8, 3)`).
    if (options.mode !== 'complex')
      return (
        options.mode !== 'bigint' &&
        k !== undefined &&
        r.fold !== undefined &&
        isFunction(node, r.head) &&
        node.nops === args.length &&
        node.ops[k].isNegative === true &&
        c.every((x, i) => i === k || x !== undefined) &&
        Number.isNaN(r.fold(...c.map((x, i) => (i === k ? -1 : x!))))
      );
    if (j !== undefined && type(args[j]).lane === 'integer') return false;
    return k === undefined || !nonnegative(args[k]);
  };

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
    // An angle in another unit than radians: the operands of a direct
    // function are converted to radians, the result of an inverse one from
    // radians, with the factors of the unit at the time of the compilation.
    const factors = r.angle && ANGLE_FACTORS[ce.angularUnit];
    if (factors) {
      const plain = { ...r, angle: undefined };
      const scale = (v: V, k: number) =>
        apply(node, row('Multiply'), [
          v,
          // Two roundings (`Math.PI / 180`).
          b.constant(k, 'real', interval ? 2 : undefined),
        ]);
      return r.angle === 'operands'
        ? apply(
            node,
            plain,
            args.map((v) => scale(v, factors[0]))
          )
        : scale(apply(node, plain, args), factors[1]);
    }
    for (const s of r.settings ?? [])
      if (!SETTINGS[s](ce))
        decline(node, `${r.head} with a ${s} other than the default`);
    const n = args.length;
    if (typeof r.arity === 'number' ? n !== r.arity : n < 2)
      decline(node, `${r.head} with ${n} operands`);
    // A product of a list of rank 2 or more with another list, and a power
    // of such a list, are the matrix product and power of the interpreter
    // (`M·N`, `M·L`, `M^s` at an integer `s`), not element by element.
    // A list of points is not a matrix: its product is point by point.
    const rank = (v: V) => type(v).shape.length;
    if (
      (r.head === 'Multiply' &&
        args.some((v) => rank(v) > 1 && tuples.get(v) !== 1) &&
        args.filter((v) => rank(v) > 0).length > 1) ||
      (r.head === 'Power' && rank(args[0]) > 1)
    )
      decline(
        node,
        `${r.head} of a matrix (a list of rank 2 or more) with a list or as a base: the interpreter's value is the matrix product or power, or element by element for some operands`
      );
    // The interval mode: only for the library constant of the value
    // (`ExponentialE`), not for a literal whose double is the value
    // (`Power(2.718281828459045, x)` is not `Exp(x)`).
    const c = r.constantOperand;
    const operand = isFunction(node) ? node.ops[c?.index ?? 0] : undefined;
    if (
      c !== undefined &&
      b.constants.get(args[c.index]) === c.value &&
      (!interval ||
        (isSymbol(operand) && CONSTANTS.get(operand.symbol) === c.value))
    )
      return apply(
        node,
        row(c.head),
        args.filter((_, i) => i !== c.index)
      );
    const complex = leaves(r, args, node);
    const operation = (given: V[]): V => {
      // A tuple operand: only a row whose value on a tuple is its value on
      // the list of the same elements (`TUPLE_RULES`).
      const tuple = given.find((v) => tuples.has(v));
      if (tuple !== undefined) {
        // `div.q`, the division by the denominator of a rational factor,
        // reads a tuple dividend as `Divide` does.
        const rule =
          TUPLE_RULES[
            r.signatures[0][2] === 'div.q' ? 'Divide' : (r.head ?? '')
          ] ?? (r.arity === 1 && r.threads ? 'each' : undefined);
        // A list of points with a point (`all`), scaled by a list of
        // numbers (`scale`), or under `norm`: point by point.
        if (
          given.some((v) => tuples.get(v) === 1) &&
          (rule === 'norm' ||
            (rule === 'all' && given.some((v) => tuples.get(v) === 0)) ||
            (rule === 'scale' && given.some((v) => numbers(v))))
        )
          return eachPoint(node, r.head!, given, operation);
        if (rule === 'norm') return norm(node, tuple);
        const lists = given.filter((v) => type(v).shape.length > 0);
        if (
          r.head !== 'At' &&
          (rule === undefined ||
            lists.some((v) => tuples.get(v) !== tuples.get(tuple)) ||
            (rule === 'all' && lists.length < given.length) ||
            (rule === 'scale' &&
              (lists.length > 1 ||
                (r.head === 'Divide' && lists[0] !== given[0]))))
        )
          decline(
            node,
            `${r.head} of a tuple: its value on a tuple is not its value on a list`
          );
      }
      const types = given.map(type);
      const signature = signatureOf(r, types, complex, bigint);
      if (signature === undefined)
        decline(
          node,
          !r.threads && types.some((t) => t.shape.length > 0)
            ? `${r.head} of a list`
            : `${r.head} of ${types.map(typeToString).join(', ')}${bigint ? ', whose value is not an integer (the bigint mode)' : ''}`
        );
      // An integer power is an integer for an exponent proved `>= 0`
      // only (`n^m` is a rational at `m < 0`).
      const j = r.leaves?.integer;
      if (bigint && j !== undefined && !nonnegative(given[j]))
        decline(
          node,
          `${r.head} of an exponent that is not proved nonnegative, whose value can be a rational (the bigint mode)`
        );
      const [lanes] = signature;
      const operands = given.map((v, i) => {
        const a = lanes.length === 1 ? lanes[0] : lanes[i];
        return a === 'list' ? v : widen(v, a);
      });
      const t = resultType(signature, operands.map(type), same);
      if (t === undefined) decline(node, 'lists of different lengths or ranks');
      const out = b.op(signature[2], operands, t);
      return tuple === undefined
        ? out
        : keep(tuple, out, t.shape.length - type(tuple).shape.length);
    };
    if (typeof r.arity === 'number' || r.arity === 'chain')
      return operation(args);
    return args.slice(1).reduce((x, y) => operation([x, y]), args[0]);
  };

  /** The Euclidean norm of the point `p` (a tuple of real or integer
   *  numbers): the square root of the sum of the squares of its elements. */
  const norm = (node: Expression, p: V): V => {
    const t = type(p);
    const n = t.shape[0];
    if (
      tuples.get(p) !== 0 ||
      t.shape.length !== 1 ||
      typeof n !== 'number' ||
      (t.lane !== 'real' && t.lane !== 'integer')
    )
      decline(node, 'the norm of a value that is not a point of numbers');
    const squares = Array.from({ length: n }, (_, k) => {
      const x = b.op('elem', [p, b.constant(k, 'integer')], scalarType(t.lane));
      return apply(node, row('Multiply'), [x, x]);
    });
    const sum = squares.reduce((s, x) => apply(node, row('Add'), [s, x]));
    return apply(node, row('Sqrt'), [sum]);
  };

  /** `v` is a list of numbers (not a tuple). */
  const numbers = (v: V) => !tuples.has(v) && type(v).shape.length === 1;

  /** `f` of `given` point by point: a build over the lists of points among
   *  them (of one shape), which reads their element at each index, and so
   *  under `Multiply` and `Divide` the element of a list of numbers of their
   *  length; a point and a scalar are read as they are. */
  const eachPoint = (
    node: Expression,
    head: string,
    given: V[],
    f: (xs: V[]) => V
  ): V => {
    const first = given.find((v) => tuples.get(v) === 1)!;
    const shape = type(first).shape;
    for (const v of given) {
      const t = type(v);
      if (
        t.shape.length > 0 &&
        !(tuples.get(v) === 0 && t.shape.length === 1) &&
        !(tuples.get(v) === 1 && same(t.shape, shape)) &&
        !(
          TUPLE_RULES[head] === 'scale' &&
          numbers(v) &&
          same(t.shape, shape.slice(0, 1))
        )
      )
        decline(
          node,
          `${head} of a list of points and a value of another shape`
        );
    }
    const k = b.newValue(scalarType('integer'));
    const at = (v: V) => lists.listSource(v).at(k);
    return region(
      'build',
      [lists.listSource(first).length],
      [k],
      () => [
        f(given.map((v) => (tuples.get(v) === 1 || numbers(v) ? at(v) : v))),
      ],
      node
    )[0];
  };

  /** Lower `e`. With `want` false its value is not used (a statement). */
  const value = (e: Expression, want = true): V | undefined => {
    // The root `Tuple` is lowered where it is (`rootParts`).
    const shared =
      want && isFunction(e) && e !== rootTuple && facts(e).writes.size === 0;
    const id = shared ? idOf(e) : 0;
    if (shared) {
      const m = memo.get(id);
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
    const lane = v === undefined ? undefined : type(v).lane;
    if (bigint && (lane === 'real' || lane === 'complex' || lane === 'color'))
      decline(
        e,
        `a ${lane} value: the bigint mode computes integers and booleans only`
      );
    if (shared && v !== undefined && b.effects === effects) {
      const reads = [...facts(e).names].map((n): [string, V | undefined] => [
        n,
        bound(n),
      ]);
      memo.set(id, { v, region, reads });
    }
    return v;
  };

  const scalar = (e: Expression): V => {
    const v = value(e)!;
    if (type(v).shape.length > 0)
      decline(e, 'a list where a scalar is required');
    return v;
  };

  let lowered = 0;
  const node = (e: Expression, want: boolean): V | undefined => {
    if (++lowered > NODE_LIMIT)
      decline(root, `more than ${NODE_LIMIT} nodes to lower`);
    if (isNumber(e))
      return (
        number(e, interval ? literalUlps(e.numericValue) : undefined) ??
        decline(e, 'a complex number with an infinite part')
      );
    if (isSymbol(e)) return symbol(e, want);
    if (!isFunction(e)) decline(e, 'not a number, a symbol or a function');
    // An invalid sub-expression (`Sin(Tuple(w))` of a vector `w`): the
    // interpreter has no value for it.
    if (e.operator !== 'Error' && e.type.type === 'error')
      decline(
        e,
        'a sub-expression of the static type error (an error of the canonical form)'
      );
    if (options.vars?.includes(e.operator) === true)
      decline(e, `a call of the vars name ${e.operator}`);
    // The interval mode: a pure node whose type is the value `true` or
    // `false` (`Equal(x, x)`, `(x + 1)^2 < 0` of a real `x`) is that
    // verdict, the rule of the existing interval target (`booleanClaim()`).
    const claim = e.type.type;
    if (interval && typeof claim === 'object' && claim.kind === 'value')
      if (typeof claim.value === 'boolean' && e.isPure === true)
        return b.constant(claim.value, 'boolean');
    const user = userBinding(e);
    if (user !== undefined || fns.recursive(e)) return fns.call(e, user);
    if (!isLibraryOperator(e as never, e.operator))
      decline(
        e,
        e.operatorDefinition === undefined && e.valueDefinition === undefined
          ? `${e.operator} is an unknown operator (no definition)`
          : `${e.operator} is not the library operator here (a user definition)`
      );
    if (hasOwnLowering(e.operator, e.operatorDefinition))
      decline(
        e,
        `the definition of ${e.operator} has its own lowering (compile or compileHelpers), which the profile does not call`
      );
    const closed = closedValue(e);
    if (closed !== undefined) return closed;
    switch (e.operator) {
      case 'If':
        // The missing arm of a boolean is `False`, as in the interpreter
        // (`maskedValue()`); of a number NaN (`conditional()`).
        return conditional(
          e,
          [[e.ops[0], e.ops[1]]],
          e.ops[2] ?? (e.ops[1].type.type === 'boolean' ? ce.False : undefined),
          want
        );
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
        return list(
          e,
          e.ops.map((op) => value(op)!)
        );
      case 'Tuple': {
        const parts = e.ops.map((op) => value(op)!);
        const t = parts.map(type);
        // A root `Tuple` (or the last operand of a root `Block`) of tuples
        // or of elements not of one shape (`Tuple(H)` of a list of run-time
        // length) is no value of the program: the entry returns the array
        // of its elements.
        if (
          e !== rootTuple ||
          (!parts.some((v) => tuples.has(v)) &&
            t.every(
              (x) => same(x.shape, t[0].shape) && !lengthValues(x).length
            ))
        )
          return tuple(e, parts);
        rootParts = parts;
        return parts[0];
      }
      case 'PointList':
        return pointList(e);
      case 'Comprehension':
        return lists.comprehension(e);
      // The list of the tuples of the elements at each index, as long as
      // the shortest list: the value of `PointList` of lists. The
      // interpreter stops at the shortest list, so a list with an effect
      // declines.
      case 'Zip': {
        const before = b.effects;
        const v = pointList(e);
        if (b.effects > before)
          decline(
            e,
            'Zip of a list with an effect (the interpreter reads the lists up to the shortest)'
          );
        return v;
      }
      case 'ListJoin':
        return lists.join(e);
      case 'RandomChoice': {
        // Of the unit interval only: the interpreter's draws are its own
        // (`_SYS.randomChoice`), `lo + u·(hi − lo)` of each draw `u`.
        const [d, n] = e.ops;
        const end = (x: Expression) => (isFunction(x, 'Open') ? x.ops[0] : x);
        if (
          e.nops !== 2 ||
          !isFunction(d, 'Interval') ||
          d.nops !== 2 ||
          !isNumber(end(d.ops[0])) ||
          !end(d.ops[0]).isSame(0) ||
          !isNumber(end(d.ops[1])) ||
          !end(d.ops[1]).isSame(1)
        )
          decline(e, 'RandomChoice of another domain than Interval(0, 1)');
        const count = scalar(n);
        if (!isSubLane(type(count).lane, 'real'))
          decline(n, 'a count that is not a real number');
        return region('choice', [count], [], () => [], e)[1];
      }
      case 'RandomShuffle': {
        const l = value(e.ops[0])!;
        const t = type(l);
        if (
          e.nops !== 1 ||
          tuples.has(l) ||
          t.shape.length !== 1 ||
          !isSubLane(t.lane, 'real')
        )
          decline(e, 'RandomShuffle of a value that is not a list of numbers');
        return apply(e, row('RandomShuffle'), [l]);
      }
      case 'At': {
        if (e.nops !== 2) decline(e, 'At with an index for each level');
        const [l, i] = [value(e.ops[0])!, scalar(e.ops[1])];
        const [t, k] = [type(l), constant(i)];
        const n = t.shape[0];
        // Out of range, the interpreter gives NaN for a number, `Missing`
        // for a boolean or a list, and `_at` gives the number NaN, which
        // is not a complex value; the `fold` pass makes a constant index
        // in range an element.
        if (
          (t.lane === 'boolean' ||
            t.lane === 'complex' ||
            t.shape.length > 1) &&
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
            'an index that can be out of range, of a list of booleans, of complex numbers or of lists'
          );
        return apply(e, row('At'), [l, i]);
      }
      case 'PointX':
      case 'PointY':
      case 'PointZ': {
        // The coordinate of a point, an `At` of a tuple of scalars (a
        // coordinate past the last one is an `incompatible-dimensions`
        // error of the canonical form, which declines first).
        // Of a list of points, the list of the coordinates.
        const p = value(e.ops[0])!;
        const k = ['PointX', 'PointY', 'PointZ'].indexOf(e.operator) + 1;
        const coordinate = ([q]: V[]) =>
          apply(e, row('At'), [q, b.constant(k, 'integer')]);
        if (e.nops === 1 && tuples.get(p) === 1 && type(p).shape.length === 2)
          return eachPoint(e, e.operator, [p], coordinate);
        if (e.nops !== 1 || tuples.get(p) !== 0 || type(p).shape.length !== 1)
          decline(e, `${e.operator} of a value that is not a point`);
        return coordinate([p]);
      }
      case 'Distance': {
        // The norm of the difference of two points, or point by point with
        // a list of points; a list of numbers declines.
        if (e.nops !== 2) break;
        const [p, q] = e.ops.map((op) => value(op)!);
        if (!tuples.has(p) || !tuples.has(q))
          decline(e, 'Distance of a value that is not a point');
        const d = apply(e, row('Add'), [p, apply(e, row('Negate'), [q])]);
        return apply(e, row('Abs'), [d]);
      }
      case 'Multiply':
        return product(e);
      case 'Power': {
        // The interval mode: `x^(p/q)` of a literal rational exponent is
        // the integer power `p` of the root of degree `q`, which the kernels
        // enclose tightly for a negative `x` too (a `q` that is a power of 2
        // below).
        const nv = isNumber(e.ops[1]) ? e.ops[1].numericValue : undefined;
        // A float literal that is not an integer is its double `e`, read
        // as the interpreter reads it (`realPowerBranchTerms()`), now: over
        // a base that can be negative, `p/q` of odd `q` is the real root
        // `±|x|^e` with the double (`pow.branch`); anything else, and every
        // float over a base that the lowering proves non-negative, is the
        // principal power `x^e` (`pow.principal`), with no real value over
        // a negative base.
        const float =
          !interval || nv === undefined
            ? undefined
            : typeof nv === 'number'
              ? nv
              : !nv.isExact && nv.im === 0
                ? nv.re
                : undefined;
        const terms =
          float !== undefined && Number.isFinite(float) && !Number.isInteger(float)
            ? (realPowerBranchTerms(undefined, float) ?? null)
            : undefined;
        const odd = terms != null && terms[1] % 2 !== 0;
        const pq =
          interval && typeof nv === 'object' && nv.isExact
            ? e.ops[1].toRational()
            : null;
        if (pq === null || !pq.every(Number.isSafeInteger) || pq[1] < 2) {
          // The interval mode: a power by the unmarked constant 2 (a
          // literal, a name that holds 2) is `square`, the kernel of half
          // the cost of `pow`.
          if (!interval || e.nops !== 2) break;
          const [x, k] = e.ops.map((op) => value(op)!);
          if (terms !== undefined) {
            // A base proved non-negative by the lowering (`nonnegative()`,
            // not the type or the value of an input).
            const op =
              !odd || nonnegative(x)
                ? 'pow.principal'
                : terms[0] % 2 !== 0
                  ? 'pow.branch'
                  : 'pow.branch.even';
            return apply(e, rowOfOp(rows, op)!.row, [x, k]);
          }
          return constant(k) === 2 && type(k).lane === 'integer'
            ? apply(e, rowOfOp(rows, 'square')!.row, [x])
            : apply(e, row('Power'), [x, k]);
        }
        // A denominator that is a power of 2: `p/q` is a double, and the
        // power has no real value over a negative base. The principal power
        // of the double, one kernel, as the existing target.
        if (2 ** Math.round(Math.log2(pq[1])) === pq[1])
          return apply(e, rowOfOp(rows, 'pow.principal')!.row, [
            value(e.ops[0])!,
            b.constant(pq[0] / pq[1], 'real'),
          ]);
        const root = apply(e, row('Root'), [
          value(e.ops[0])!,
          b.constant(pq[1], 'integer'),
        ]);
        return pq[0] === 1
          ? root
          : apply(e, row('Power'), [root, b.constant(pq[0], 'integer')]);
      }
      case 'Log': {
        // `Log(x, 10)` is `log10`, a real `Log(x, 2)` is `log2` (exact at a
        // power of the base, as the interpreter: `Floor(Log(1000, 10))` is
        // 3); another base is `Ln(x) / Ln(b)`.
        if (e.nops !== 2) break;
        const [x, base] = e.ops.map((op) => value(op)!);
        // In the interval mode the base is 10 or 2 only on the integer
        // lane: a real constant whose double is 10 is a folded closed node
        // with an enclosure, and takes `Ln(x) / Ln(b)`. A decimal is its
        // double: `10.0000000000000001` is the integer 10.
        const is = (n: number) =>
          constant(base) === n && (!interval || type(base).lane === 'integer');
        if (is(10)) return apply(e, row('Log'), [x]);
        if (
          is(2) &&
          type(x).lane !== 'complex' &&
          options.mode !== 'complex'
        )
          return apply(e, rowOfOp(rows, 'log2')!.row, [x]);
        return apply(
          e,
          row('Divide'),
          [x, base].map((v) => apply(e, row('Ln'), [v]))
        );
      }
      case 'Length':
        return lists.source(e.ops[0], false, true).length;
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
        if (e.nops !== 2 || !isSubLane(type(seed).lane, 'real'))
          decline(e, 'a seed that is not a number');
        return seededFrame(e, seed, () => value(e.ops[1], want), want);
      }
      case 'Assign':
        return assign(e);
      case 'Loop':
        return loop(e, want);
      case 'Integrate':
      case 'NIntegrate':
        return integral(e);
      case 'Apply': {
        // `Apply(Function(body, p1, …), a1, …)`: the body with each
        // parameter bound to its argument, each argument evaluated once, in
        // order, before it. (`Apply(g, x)` of a name is the call `g(x)` in
        // the canonical form.)
        const [f, ...args] = e.ops;
        const names = isFunction(f, 'Function')
          ? f.ops.slice(1).map((p) => (isSymbol(p) ? p.symbol : ''))
          : [];
        if (
          !isFunction(f, 'Function') ||
          names.length !== args.length ||
          names.includes('')
        )
          decline(
            e,
            'Apply of a value that is not a function literal of one untyped parameter per argument'
          );
        // A list argument of a literal of one parameter whose signature
        // is scalar is `Map(f, list)`, the interpreter's route
        // (`applyLiteralMaps()`) for a flat list of numbers. Another list
        // or tuple argument declines: the interpreter maps a nested list to
        // its leaves, a tuple is atomic, and a signature that takes a
        // collection binds the argument whole.
        const maps = args.length === 1 && literalParamsMap(f.type.type);
        const values = args.map((a) => {
          const v = value(a)!;
          const t = type(v);
          const flat =
            t.shape.length === 1 &&
            !tuples.has(v) &&
            (t.lane === 'real' || t.lane === 'integer');
          if (t.shape.length > 0 && !(maps && flat))
            decline(
              a,
              'a list or a tuple argument of Apply (the interpreter may map the function over it)'
            );
          return v;
        });
        // The argument is lowered once: its effects run once.
        if (maps && type(values[0]).shape.length > 0)
          return lists.over(
            e,
            lists.listSource(values[0]),
            names[0],
            f.ops[0],
            false,
            f
          );
        return withFrame(false, (frame) => {
          names.forEach((n, i) =>
            frame.names.set(n, { v: values[i], role: 'index' })
          );
          return value(f.ops[0], want);
        });
      }
      case 'Declare':
        decline(e, 'Declare outside a block');
      case 'Function':
        decline(
          e,
          'a function value that is not the program or the literal of a Map, a Filter or an Apply'
        );
      case 'Error':
        decline(e, 'an error of the canonical form');
    }
    const reduction = REDUCTIONS.get(e.operator);
    const r = rowOfHead(rows, reduction?.row ?? e.operator);
    if (r === undefined)
      decline(e, `the operator ${e.operator} is not in the slice`);
    // The interpreter does not evaluate a `Sum` or a `Product` over a bound
    // with an effect, and does not change `p` for `Limits(i, 1, (p := 4;
    // 2))` (rule R3 of docs/COMPILATION-MODEL.md).
    if (
      reduction?.indexed === true &&
      e.ops
        .slice(1)
        .some((l) => isFunction(l, 'Limits') && facts(l).writes.size > 0)
    )
      decline(e, `a bound of ${e.operator} that assigns a name outside it`);
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

  /** A product. With a rational constant `p/q` whose denominator is not a
   *  power of two, it is `(p · factors) / q`: a multiplication by the
   *  integer `p` (a negation for -1), then a division by the integer `q`.
   *  IEEE division is correctly rounded, so the value is exact wherever
   *  `p · factors` is an exact multiple of `q`: `Floor(x/49)` at 49 is 1,
   *  where the product by the double of `1/49` gives 0. `p` and the sign
   *  multiply the scalar factors first, so a list is passed over once for
   *  the product and once for the division. The constant can be a free
   *  name that holds it (a capture, as `captured()` lowers it). A power of
   *  two as the denominator keeps the product by the double `p/q`, which is
   *  exact; so do a complex factor (no rounding reads a complex value) and
   *  the `bigint` mode (a rational declines there). */
  const product = (e: Fn): V => {
    // The number of `x`: a literal, or the value a free name holds.
    const numberOf = (x: Expression): Expression | undefined => {
      if (isNumber(x)) return x;
      if (!isSymbol(x) || lookup(x.symbol) !== undefined) return undefined;
      if (options.vars?.includes(x.symbol) || CONSTANTS.has(x.symbol)) return;
      const def = ce.lookupDefinition(x.symbol);
      const v = held(x.symbol)?.value;
      return v !== undefined &&
        isNumber(v) &&
        (cx.inFunction === undefined ||
          (def !== undefined &&
            'value' in def &&
            def.value === resolvedValueDefinition(x)))
        ? v
        : undefined;
    };
    const ratio = (x: Expression) => {
      const n = numberOf(x);
      const pq = n !== undefined ? n.toRational() : null;
      return pq !== null &&
        pq.every(Number.isSafeInteger) &&
        (BigInt(pq[1]) & (BigInt(pq[1]) - 1n)) !== 0n
        ? pq
        : undefined;
    };
    const k = bigint ? -1 : e.ops.findIndex((x) => ratio(x) !== undefined);
    const values = e.ops.map((x, i) => (i === k ? undefined : value(x)!));
    const rest = values.filter((v): v is V => v !== undefined);
    if (k < 0 || rest.some((v) => type(v).lane === 'complex'))
      return apply(
        e,
        row('Multiply'),
        values.map((v, i) => v ?? value(e.ops[i])!)
      );
    const c = e.ops[k];
    if (isSymbol(c) && !held(c.symbol)!.library) b.captures.add(c.symbol);
    const [p, q] = ratio(c)!;
    const mul = (xs: V[]) =>
      xs.length === 1 ? xs[0] : apply(e, row('Multiply'), xs);
    const scalars = rest.filter((v) => type(v).shape.length === 0);
    const lists = rest.filter((v) => type(v).shape.length > 0);
    let factors = lists;
    if (scalars.length > 0) {
      let s = mul(
        p === 1 || p === -1 ? scalars : [b.constant(p, 'integer'), ...scalars]
      );
      if (p === -1) s = apply(e, row('Negate'), [s]);
      factors = [s, ...lists];
    } else if (p !== 1) factors = [b.constant(p, 'integer'), ...lists];
    const v = mul(factors);
    return apply(e, rowOfOp(rows, 'div.q')!.row, [v, b.constant(q, 'integer')]);
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
    // A `List` or a `Tuple` is not a number: its elements are folded one by
    // one, and a literal is read as it is, with no `N()` (CE-1065: the cost
    // of a large literal list).
    if (
      options.fold === false ||
      e.operator === 'List' ||
      e.operator === 'Tuple' ||
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
      options.vars?.includes(s) === true ||
      (!CONSTANTS.has(s) &&
        s !== 'True' &&
        s !== 'False' &&
        resolvedValueDefinition(ce.box(s))?.value !== undefined);
    if ([...f.names].some(valued)) return undefined;
    let n: Expression;
    // The interval mode: the value of `evaluate()` when it is an exact
    // number that is a double, or a safe integer computed in big decimals
    // (`Mod(1, 1/10)` is 0, `Floor(100π)` is 314); else the value of `N()`
    // marked `inexact`, when `N()` computes in big decimals of more digits
    // than a double holds, so that its double is within 1 ulp; else the node
    // is lowered as written, and the kernels enclose it.
    let exact = false;
    try {
      // The bigint mode: the exact value (`N()` of `2^70 + 1` is rounded).
      n = bigint || interval ? e.evaluate() : e.N();
      if (interval) {
        const nv = isNumber(n) ? n.numericValue : undefined;
        const big = bigDecimalFolds(ce.precision);
        exact =
          typeof nv === 'number'
            ? big && Number.isSafeInteger(nv)
            : nv !== undefined &&
              nv.isExact &&
              exactDoubleValue(nv) !== undefined;
        if (!exact && !big) return undefined;
        if (!exact) n = e.N();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return undefined;
    }
    if (isSymbol(n, 'True') || isSymbol(n, 'False'))
      return b.constant(isSymbol(n, 'True'), 'boolean');
    // A value that is not an integer (a pole, `Mod(5, 0)`) is lowered as
    // written: its helper throws the pole where the node is evaluated.
    if (bigint && isNumber(n) && n.isInteger !== true) return undefined;
    if (!isNumber(n)) return undefined;
    return number(n, interval && !exact ? 1 : undefined);
  };

  /** The literal of the number `e`: an integer, a real, or a complex of
   *  finite parts (not `ComplexInfinity`, which a real pole gives).
   *  `inexact`: the mark of a finite real (the interval mode). */
  const number = (
    e: Expression & { re: number; im: number },
    inexact?: number
  ): V | undefined => {
    if (bigint) {
      const n = e.isInteger === true ? toBigint(e) : null;
      if (n === null)
        decline(e, 'a number that is not an integer (the bigint mode)');
      return exact(n);
    }
    if (e.im === 0 && inexact !== undefined && Number.isFinite(e.re))
      return b.constant(e.re, 'real', inexact);
    // The interval mode: an exact number that is a double is that double
    // (`e.re` converts the numerator and the denominator of a rational that
    // is not reduced separately).
    const nv = interval && isNumber(e) ? e.numericValue : undefined;
    const re =
      (typeof nv === 'object' && nv.isExact
        ? exactDoubleValue(nv)
        : undefined) ?? e.re;
    if (e.im === 0)
      return b.constant(re, Number.isSafeInteger(re) ? 'integer' : 'real');
    if (Number.isFinite(e.re) && Number.isFinite(e.im))
      return b.constant({ re: e.re, im: e.im }, 'complex');
    return undefined;
  };

  /** The value that the name `name` holds in the innermost binding of
   *  the engine (as the interpreter reads a symbol that is not a call,
   *  docs/SCOPING-MODEL.md), and whether that binding is the library's. */
  const held = (name: string) => {
    const binding = ce.lookupDefinition(name);
    const library = ce.contextStack[0]?.lexicalScope.bindings.get(name);
    return binding !== undefined && 'value' in binding
      ? { value: binding.value.value, library: binding === library }
      : undefined;
  };

  /** The value of the free name `e`, which holds `v` in the engine: a
   *  literal when `v` is a number, a list, a tuple or a `PointList` of
   *  numbers, or a colour
   *  constructor of three real numbers (`Hsv(270, 0.4, 0.95)`; no symbol, no
   *  other application); any other value declines, as its names have
   *  bindings of their own. The name is a capture (`symbolDeps`) unless its
   *  binding is the library's. */
  const captured = (e: Expression, name: string, v: Expression): V => {
    const numbers = (x: Expression): boolean =>
      isNumber(x) ||
      (isFunction(x) &&
        ['List', 'Tuple', 'PointList'].includes(x.operator) &&
        x.nops > 0 &&
        x.ops.every(numbers));
    // A constructor of the colour lane (a row of three real channels).
    const r = isFunction(v) ? rowOfHead(rows, v.operator) : undefined;
    const color =
      r?.arity === 3 &&
      r.signatures[0][1] === 'color' &&
      r.signatures[0][0].every((a) => a === 'real');
    if (
      color &&
      isFunction(v) &&
      (v.nops !== 3 || !v.ops.every((x) => isNumber(x) && x.im === 0))
    )
      decline(
        e,
        `a symbol whose colour value is not ${r.head} of three real numbers`
      );
    if (!color && !numbers(v))
      decline(
        e,
        'a symbol with a value that is not a number or a list of numbers (or a tuple of numbers), or a colour of three numbers'
      );
    if (!held(name)!.library) b.captures.add(name);
    // The interval mode: a constant of the library whose value is not exact
    // (`EulerGamma`, `CatalanConstant`) holds the double nearest to a number
    // that is not a double: an enclosure of one ulp on each side, as on the
    // existing interval target. A decimal of the program is its double
    // (`literalUlps()`).
    else if (interval && isNumber(v) && v.im === 0 && Number.isFinite(v.re)) {
      const nv = v.numericValue;
      if (typeof nv === 'number' ? !Number.isInteger(nv) : !nv.isExact)
        return number(v, 1)!;
    }
    return value(v)!;
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
    // An input has one type: an occurrence of another type (a body boxed
    // where the name had another declaration) declines.
    if (
      known?.binding.role === 'input' &&
      !sameInput(type(known.binding.v), e.type.type)
    )
      decline(
        e,
        `${name} read with two types, ${typeToString(type(known.binding.v))} and ${engineTypeToString(e.type.type)}`
      );
    if (known?.binding.role === 'input') note(name, e.type.type);
    if (known) return known.binding.v;
    const k = options.vars?.indexOf(name) ?? -1;
    if (k >= 0) {
      note(name, e.type.type);
      // The host's text, in the scope of the entry, read at each use.
      // A function body and a root function literal have no such scope:
      // a read of the inputs object there is an input that each call
      // passes, read at the call in the entry (`free()`).
      const read =
        cx.inFunction !== undefined &&
        !b.literal &&
        options.objectVars?.includes(name) === true;
      if ((cx.inFunction !== undefined || b.literal) && !read)
        decline(e, `the vars name ${name} in a function`);
      // A name of type `any` is read as a real until the end refuses it
      // (`program()`); a capture records the occurrence's own type.
      const t = inputType(e.type.type === 'any' ? 'real' : e.type.type);
      if (t === undefined || t.lane === 'complex' || t.shape.length > 0)
        decline(
          e,
          `the vars name ${name} of type ${engineTypeToString(e.type.type)}`
        );
      if (read) return fns.capture(e, name, e.type.type);
      return b.op(hostVarOp(k, t.lane), [], scalarType(t.lane));
    }
    if (name === 'True' || name === 'False')
      return b.constant(name === 'True', 'boolean');
    const c = CONSTANTS.get(name);
    if (c !== undefined) {
      // The symbol's binding, and the innermost binding of its name.
      if (isShadowedSymbol(e as never) || held(name)?.library !== true)
        decline(e, `${name} is not the library constant here`);
      return b.constant(c, 'real', interval ? 1 : undefined);
    }
    const h = held(name);
    if (cx.inFunction === undefined)
      return h?.value !== undefined
        ? captured(e, name, h.value)
        : input(e, name, e.type.type);
    // In a function body the interpreter reads the binding of the body,
    // which need not be the binding of the name where the call is: a name
    // whose binding here is the body's is its value, as at the entry
    // (`compile()` chooses a scope where it is, `compilationScope()`);
    // another name with a value declines; an input is a parameter that
    // each call passes.
    const def = ce.lookupDefinition(name);
    if (
      h?.value !== undefined &&
      def !== undefined &&
      'value' in def &&
      def.value === resolvedValueDefinition(e)
    )
      return captured(e, name, h.value);
    if (
      h?.value !== undefined ||
      resolvedValueDefinition(e)?.value !== undefined
    )
      decline(
        e,
        `the function ${cx.inFunction} reads ${name}, which is not a parameter (a capture)`
      );
    note(name, e.type.type);
    return fns.capture(e, name, e.type.type);
  };

  /** The input `name` of the type `t`, which a function that `e` calls
   *  reads: its binding when it is an input here, or a new input (of the
   *  entry, or of the function whose body has the call). A local, a
   *  parameter or a name with a value of that name here declines. */
  const free = (e: Fn, name: string, t: Type): V => {
    const known = lookup(name);
    if (known !== undefined && known.binding.role !== 'input')
      decline(
        e,
        `a call of ${e.operator}, which reads the input ${name}, where ${name} is a local or a parameter`
      );
    note(name, t);
    if (known !== undefined) return known.binding.v;
    const k = options.vars?.indexOf(name) ?? -1;
    // A `vars` name (`symbol()`): its text, read here at the entry.
    if (k >= 0) {
      if (cx.inFunction !== undefined) return fns.capture(e, name, t);
      const lane = inputType(isUntyped(t) ? 'real' : t)!.lane;
      return b.op(hostVarOp(k, lane), [], scalarType(lane));
    }
    if (held(name)?.value !== undefined)
      decline(
        e,
        `a call of ${e.operator}, which reads the input ${name}, where ${name} has a value`
      );
    // At the entry the input has the type that the scope of the
    // compilation gives the name, which a call checks against the
    // parameter.
    const def = ce.lookupDefinition(name);
    return cx.inFunction === undefined
      ? input(
          e,
          name,
          def !== undefined && 'value' in def ? def.value.type.type : t
        )
      : fns.capture(e, name, t);
  };

  /** The IR type of an input of the engine type `t`; a tuple is the list of
   *  its elements, which `input()` marks a tuple. `any` is read as
   *  `unknown`: such an input is refused at the end (`program()`). */
  const inputIR = (t: Type) =>
    tupleOrInputType(isUntyped(t) ? 'unknown' : t, cx.wide);

  /** `ir`, the type of an input, is the IR type of the engine type `t`. */
  const sameInput = (ir: IRType, t: Type): boolean => {
    const x = inputIR(t);
    return (
      x !== undefined &&
      x.lane === ir.lane &&
      x.shape.length === ir.shape.length &&
      x.shape.every((n, i) =>
        n === 'run-time' ? typeof ir.shape[i] === 'object' : n === ir.shape[i]
      )
    );
  };

  /** The input `name` of the engine type `t`: a parameter of the entry (a
   *  positional one: of a root function literal). A list of run-time length
   *  has its length as a parameter before it. A positional one of no
   *  declared type is a real; one declared `any` declines (it is not an
   *  input that `program()` refuses). */
  const input = (
    e: Expression,
    name: string,
    t: Parameters<typeof inputType>[0],
    positional = false
  ): V => {
    if (!positional) note(name, t);
    const ir = positional ? tupleOrInputType(t, cx.wide) : inputIR(t);
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
    const axis = tupleAxis(t);
    if (axis !== undefined) tuples.set(v, axis);
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
      if (t === undefined || tuples.get(x) !== tuples.get(y))
        decline(node, t === undefined ? cause : 'arms of a tuple and a list');
      a.region.yields.push(widenIn(a.region, x, t));
      c.region.yields.push(widenIn(c.region, y, t));
      outs.push(keep(x, b.newValue(t)));
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
    site: Expression,
    pieces?: number,
    closed?: Region
  ): V[] => {
    const r = regionRow(op)!;
    const body = b.region(params, f);
    const ys = body.yields.map(type);
    const outs = r
      .results(args, ys, [])!
      .map(() => b.newValue(scalarType('real')));
    r.results(args, ys, outs)!.forEach((t, k) => (b.types[outs[k]] = t));
    // A build of tuples is a list of tuples.
    keep(body.yields[body.yields.length - 1], outs[outs.length - 1], 1);
    b.emit({
      k: 'region',
      outs,
      op,
      args,
      regions: closed === undefined ? [body] : [body, closed],
      site: text(site),
      ...(pieces === undefined ? {} : { pieces }),
    });
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
    // A value made in the frame is not visible after it: the length of a
    // list made in the frame is a result too (the row `seeded`).
    const lengths = want
      ? lengthValues(type(result!)).filter(
          (n) => n >= start && !inputLengths.has(n)
        )
      : [];
    region.yields.push(...changed.map((x) => after[bindings.indexOf(x)]));
    region.yields.push(...lengths);
    if (want) region.yields.push(result!);
    const ys = region.yields;
    const outs = ys.map((y) => keep(y, b.newValue(type(y))));
    regionRow('seeded')!
      .results([seed], ys.map(type), outs, ys)!
      .forEach((t, k) => (b.types[outs[k]] = t));
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
   *  arm; for an `If` whose arm is a tuple of numbers, the tuple of NaN:
   *  a `Which` gives `Missing`). */
  const conditional = (
    node: Expression,
    clauses: [Expression, Expression][],
    otherwise: Expression | undefined,
    want: boolean,
    first?: V
  ): V | undefined => {
    if (clauses.length === 0) {
      if (otherwise !== undefined) return value(otherwise, want);
      if (!want) return undefined;
      const t = first === undefined ? undefined : type(first);
      if (
        node.operator !== 'If' ||
        t?.shape.length !== 1 ||
        tuples.get(first!) !== 0 ||
        t.lane === 'complex'
      )
        return b.constant(NaN, 'real');
      const nan = Array.from({ length: t.shape[0] as number }, () =>
        b.constant(NaN, 'real')
      );
      return keep(first!, b.list(nan, { lane: 'real', shape: t.shape }));
    }
    const [[test, then], ...rest] = clauses;
    const cond = scalar(test);
    if (type(cond).lane !== 'boolean')
      decline(test, 'a condition that is not a boolean');
    // The interval mode, whose `fold` is off: a decided condition takes its
    // arm, and the other is not lowered, as on the existing interval target.
    // A false one with no arm after it is lowered: the shape of the missing
    // value is the shape of its arm.
    const decided = interval ? b.constants.get(cond) : undefined;
    if (decided === true) return value(then, want);
    if (
      decided === false &&
      (rest.length > 0 || otherwise !== undefined || first !== undefined)
    )
      return conditional(node, rest, otherwise, want, first);
    return branch(
      node,
      cond,
      () => (first = value(then, want)),
      () => conditional(node, rest, otherwise, want, first),
      want
    );
  };

  /** The list `e` of the values `elements`; a list of tuples when they are
   *  tuples. */
  const list = (e: Fn, elements: V[]): V => {
    if (elements.length === 0) decline(e, 'an empty list');
    if (elements.some((v) => tuples.get(v) !== tuples.get(elements[0])))
      decline(e, 'a list of tuples and lists');
    let t: IRType | undefined = type(elements[0]);
    for (const v of elements) {
      t = joinType(t, type(v));
      if (t === undefined) decline(e, 'elements of two types');
    }
    if (lengthValues(t).length > 0)
      decline(e, 'a list of lists of run-time length');
    const v = b.list(
      elements.map((v) => widen(v, t!.lane)),
      {
        lane: t.lane,
        shape: [elements.length, ...t.shape],
      }
    );
    return keep(elements[0], v, 1);
  };

  /** A `Tuple`: the list of its elements, marked a tuple (a tuple of
   *  tuples declines). */
  const tuple = (e: Fn, elements: V[]): V => {
    if (elements.some((v) => tuples.has(v))) decline(e, 'a tuple of tuples');
    const v = list(e, elements);
    tuples.set(v, 0);
    return v;
  };

  /** `PointList`: the tuple of its components when none is a list;
   *  otherwise the list of the tuples of the elements of its list
   *  components at each index (a scalar is in every tuple), as long as the
   *  shortest component: the `Min` of the lengths. */
  const pointList = (e: Fn): V => {
    const parts = e.ops.map((op) => value(op)!);
    if (parts.some((v) => tuples.has(v) || type(v).shape.length > 1))
      decline(e, 'a component that is a point or a list of lists');
    const n = parts.flatMap((v) => type(v).shape);
    if (n.length === 0) return tuple(e, parts);
    const fixed = n.filter((x): x is number => typeof x === 'number');
    const lengths = [
      ...(fixed.length > 0 ? [b.constant(Math.min(...fixed), 'integer')] : []),
      ...new Set(n.flatMap((x) => (typeof x === 'number' ? [] : [x.v]))),
    ];
    const length = lengths.reduce((m, x) => apply(e, row('Min'), [m, x]));
    const k = b.newValue(scalarType('integer'));
    const at = (v: V) =>
      type(v).shape.length === 0 ? v : lists.listSource(v).at(k);
    return region(
      'build',
      [length],
      [k],
      () => [tuple(e, parts.map(at))],
      e
    )[0];
  };

  const local = (s: Expression, v: V, lane: Lane): V => {
    if (!widensTo(type(v).lane, lane))
      decline(s, `a value that is not ${lane}`);
    return widen(v, lane);
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
          // `constant: True` makes a local that no `Assign` writes.
          const constant = attributes?.get('constant');
          if (
            !isSymbol(name) ||
            value === undefined ||
            attributes?.keys.some((k) => k !== 'value' && k !== 'constant') ===
              true ||
            !(
              constant === undefined ||
              isSymbol(constant, 'True') ||
              isSymbol(constant, 'False')
            )
          )
            decline(s, 'a declaration with no value, or with attributes');
          const typeName = isString(declared)
            ? declared.string
            : isSymbol(declared)
              ? declared.symbol
              : 'unknown';
          if (
            !['real', 'integer', 'boolean', 'complex', 'unknown'].includes(
              typeName
            )
          )
            decline(s, `a local of type ${typeName}`);
          // A list (or a tuple) local of no stated type is its value, a
          // local that no `Assign` writes (`assign()` declines one).
          const v = cx.value(value)!;
          if (type(v).shape.length > 0) {
            if (typeName !== 'unknown')
              decline(s, `a list value for a local declared ${typeName}`);
            frame.names.set(name.symbol, { v, role: 'constant' });
            return void (result = v);
          }
          // With no type, a number is a real: a later write of a real to
          // `let t = 0` is valid.
          // In the bigint mode a real write declines: an integer stays one.
          const lane: Lane =
            typeName !== 'unknown'
              ? (typeName as Lane)
              : type(v).lane === 'boolean' ||
                  type(v).lane === 'complex' ||
                  type(v).lane === 'color' ||
                  bigint
                ? type(v).lane
                : 'real';
          result = local(s, v, lane);
          frame.names.set(name.symbol, {
            v: result,
            lane,
            role: isSymbol(constant, 'True') ? 'constant' : 'local',
          });
        } else result = value(s, want && i === e.nops - 1);
      });
      if (want && result === undefined) decline(e, 'a block with no value');
      return result;
    });

  /** `Loop(body, Element(i, L), …)`, a statement whose value is
   *  `Nothing`: a counted loop per clause (a later clause is lowered in the
   *  body of the one before it, so it reads its index), whose carried
   *  values are the locals declared outside it that the body writes. Each
   *  pass is a pass of the `iterationBudget` (`passes`). */
  const loop = (e: Fn, want: boolean): undefined => {
    if (want) decline(e, 'the value of a Loop (Nothing)');
    if (e.nops < 2) decline(e, 'a Loop with no Element clause');
    const carried = [...facts(e).writes].flatMap((n) => {
      const x = lookup(n);
      return x?.binding.role === 'local' && !x.outer ? [x.binding] : [];
    });
    const clause = (j: number): void => {
      if (j === e.nops) return void value(e.ops[0], false);
      const c = e.ops[j];
      if (!isFunction(c, 'Element') || c.nops !== 2)
        decline(c, 'a Loop clause that is not Element(i, L)');
      const index = c.ops[0];
      if (!isSymbol(index)) decline(c, 'a Loop index that is not a name');
      const s = lists.source(c.ops[1]);
      const lo = b.constant(0, 'integer');
      const hi = apply(c, row('Subtract'), [
        s.length,
        b.constant(1, 'integer'),
      ]);
      const init = carried.map((x) => widen(x.v, x.lane!));
      const k = b.newValue(scalarType('integer'));
      const params = carried.map((x) => b.newValue(scalarType(x.lane!)));
      const body = b.region([k, ...params], () => {
        carried.forEach((x, i) => (x.v = params[i]));
        withFrame(false, (frame) => {
          frame.names.set(index.symbol, { v: s.at(k), role: 'index' });
          clause(j + 1);
        });
        return carried.map((x) => x.v);
      });
      const outs = params.map((v) => b.newValue(type(v)));
      b.emit({ k: 'loop', outs, lo, hi, init, body, passes: true });
      carried.forEach((x, i) => (x.v = outs[i]));
    };
    clause(1);
    return undefined;
  };

  /** The interval mode: the pieces of the integral being lowered, and the
   *  function whose body holds it. */
  let quadrature: { n: number; fn?: string } | undefined;
  /** The interval mode: the region of the closed form `c` of an integral,
   *  or `undefined` when the lowering declines it, when it is not real,
   *  and when it holds a loop or a call, whose function would stay defined
   *  after the region is discarded. Its only effects are reads of `vars`
   *  entries, which in the mode read the inputs object: they are not
   *  counted. */
  const closedRegion = (c: Expression | undefined): Region | undefined => {
    if (c === undefined || facts(c).loop || !facts(c).slice) return undefined;
    const effects = b.effects;
    try {
      const r = b.region([], () => [scalar(c)]);
      return isSubLane(type(r.yields[0]).lane, 'real') ? r : undefined;
    } catch (error) {
      if (!(error instanceof Decline)) throw error;
      return undefined;
    } finally {
      b.effects = effects;
    }
  };
  /** The interval mode: `x` is safe to compute before an integral whose
   *  integrand holds it (an invariant): every head is a pure row of the
   *  library, which lowers to operations only (no reduction, loop, call,
   *  conditional or integral, which can throw or run where the integrand
   *  would not). */
  const early = new WeakMap<Expression, boolean>();
  const speculatable = (x: Expression): boolean => {
    if (!isFunction(x)) return true;
    let known = early.get(x);
    if (known === undefined) {
      known =
        isLibrary(x) &&
        !CONSTRUCTS.has(x.operator) &&
        !REDUCTIONS.has(x.operator) &&
        rowOfHead(rows, x.operator)?.effect === 'pure' &&
        x.ops.every(speculatable);
      early.set(x, known);
    }
    return known;
  };
  /** `Integrate(f, Limits(t, a, b))` or `NIntegrate(f, a, b)`, of real
   *  bounds and a real integrand (a function literal of one parameter, or
   *  a body in the name of the `Limits`): the region `integrate`, whose
   *  value is within the tolerance of the engine's quadrature. The
   *  integrand has no effectful operation: the routine chooses its
   *  samples. */
  const integral = (e: Fn): V => {
    const [f, limits] = e.ops;
    // The interval mode: an indefinite integral (no bounds, or a bound
    // `Nothing`) is its closed form, as on the existing interval target;
    // with none it is a function, not a number.
    if (
      interval &&
      e.operator === 'Integrate' &&
      (e.nops === 1 ||
        (e.nops === 2 &&
          isFunction(limits, 'Limits') &&
          (limits.nops < 3 ||
            limits.ops.slice(1).some((x) => isSymbol(x, 'Nothing')))))
    ) {
      const c = intervalClosedForm(e.ops, options.varsTexts ?? {});
      if (c === undefined)
        decline(
          e,
          e.engine.angularUnit !== 'rad'
            ? 'an indefinite integral with an angular unit other than radians (its closed form is not used)'
            : 'an indefinite integral with no closed form (a function, not a number)'
        );
      return scalar(c);
    }
    const bounds =
      e.operator === 'NIntegrate'
        ? e.nops === 3
          ? e.ops.slice(1)
          : undefined
        : e.nops === 2 && isFunction(limits, 'Limits') && limits.nops === 3
          ? limits.ops.slice(1)
          : undefined;
    if (bounds === undefined)
      decline(e, 'an integral that is not of one variable and two bounds');
    const literal = isFunction(f, 'Function') ? f : undefined;
    const name = literal
      ? literal.nops === 2
        ? parameterName(literal.ops[1])
        : undefined
      : isFunction(limits, 'Limits') && isSymbol(limits.ops[0])
        ? limits.ops[0].symbol
        : undefined;
    if (name === undefined || name === 'Nothing')
      decline(e, 'an integrand that is not a function of one variable');
    // The interval mode: the pieces of the partition, measured by the
    // outermost integral of a body (`intervalQuadratureSize()`) and taken
    // by every integral in its bounds and its integrand.
    const outer = quadrature;
    if (interval && (outer === undefined || outer.fn !== cx.inFunction)) {
      const size = intervalQuadratureSize(e.ops, 1, true);
      const refusal = intervalQuadratureRefusal(size);
      if (refusal !== undefined) decline(e, refusal);
      quadrature = { n: size.n, fn: cx.inFunction };
    }
    const [lo, hi] = bounds.map((x) => {
      const v = scalar(x);
      if (!isSubLane(type(v).lane, 'real'))
        decline(x, 'a bound that is not real');
      return v;
    });
    const effects = b.effects;
    // The interval mode: a part of the integrand that does not read its
    // variable and is safe to compute early (`speculatable()`) is lowered
    // once before the region, and the memo of `value()` reads it there, as
    // the existing interval target computes the invariants of an integrand
    // once. Only the operands of rows and of calls are searched: a part of
    // an arm or of a scope stays in place.
    const invariant = (x: Expression): void => {
      if (!isFunction(x)) return;
      const k = facts(x);
      if (!k.names.has(name) && k.writes.size === 0 && speculatable(x))
        value(x);
      else if (
        (x.operator === 'Block' && x.nops === 1) ||
        userBinding(x) !== undefined ||
        (isLibrary(x) &&
          !CONSTRUCTS.has(x.operator) &&
          !REDUCTIONS.has(x.operator) &&
          rowOfHead(rows, x.operator) !== undefined)
      )
        x.ops.forEach(invariant);
    };
    if (interval) invariant(literal?.ops[0] ?? f);
    // The interval mode: the closed form of the existing interval target,
    // which `_IA.integrateClosed` gives when its scan of the integrand
    // finds no pole (`print-interval.ts`); otherwise the enclosure.
    const closed =
      interval && e.operator === 'Integrate'
        ? closedRegion(intervalClosedForm(e.ops, options.varsTexts ?? {}))
        : undefined;
    const t = b.newValue(scalarType('real'));
    const [out] = region(
      'integrate',
      [lo, hi],
      [t],
      () =>
        withFrame(true, (frame) => {
          frame.names.set(name, { v: t, role: 'index' });
          const y = scalar(literal?.ops[0] ?? f);
          if (!isSubLane(type(y).lane, 'real'))
            decline(e, 'an integrand that is not real');
          return [y];
        }),
      e,
      interval ? quadrature!.n : undefined,
      closed
    );
    if (b.effects !== effects) decline(e, 'an integrand with an effect');
    quadrature = outer;
    return out;
  };

  const assign = (e: Fn): V => {
    const name = e.ops[0];
    if (!isSymbol(name)) decline(e, 'a write that is not to a name');
    const known = lookup(name.symbol);
    if (known?.binding.role === 'constant')
      decline(
        e,
        'a write to a constant (the interpreter refuses it) or to a list local'
      );
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
    list,
    isLibrary,
    free,
    widen,
    wide: options.mode === 'complex' ? 'complex' : 'real',
    budget: options.iterationBudget,
    runtimeLengths: options.runtimeLengths ?? true,
    tuples,
  };
  const lists = listLowering(cx);
  const fns = functionLowering(cx);

  /** The program of the entry `f`, refused when an input that it reads has
   *  no type at any occurrence (`seen`, `typed`). A decline of the lowering
   *  is thrown as it is. */
  const program = (f: () => V | V[]): Program => {
    const p = b.program(f);
    const names = [...seen].filter((name) => !typed.has(name));
    if (names.length > 0) throw new UntypedInputs(names);
    return p;
  };
  // A root function literal: its parameters, by position, come first.
  if (isFunction(root, 'Function') && isLibrary(root)) {
    b.literal = true;
    return program(() => {
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
  return program(() => {
    const v = value(root)!;
    return rootParts ?? v;
  });
}

/** The key of a number for `idOf()`: its kind and its exact value (a
 *  double, the parts of a complex double, of a big decimal, of an exact
 *  number); `undefined` for another kind, such as a numeric value of a
 *  class of another copy of the library, which is then not merged. */
function numberKey(nv: number | NumericValue): string | undefined {
  const d = (x: number) => (Object.is(x, -0) ? '-0' : String(x));
  const q = ([n, m]: readonly (number | bigint)[]) =>
    `${typeof n}${n}/${typeof m}${m}`;
  if (typeof nv === 'number') return `m${d(nv)}`;
  if (nv instanceof MachineNumericValue) return `c${d(nv.decimal)},${d(nv.im)}`;
  if (nv instanceof BigNumericValue) return `b${nv.decimal},${nv.imDecimal}`;
  if (nv instanceof ExactNumericValue)
    return `q${q(nv.rational)}r${nv.radical},${q(nv.imRational)}r${nv.imRadical}`;
  return undefined;
}

/**
 * The interval mode: the count of ulps within which the double of the
 * number literal `nv` is its value, or `undefined` when the double is the
 * value. A number that is not exact (a machine number or a decimal: `1.8`)
 * is its double, as on the existing target and in the JavaScript code (the
 * precision of the target); so is an exact number that is a double (`1/2`,
 * `5`). An exact number with no double value (`1/3`, a radical) is
 * enclosed.
 */
function literalUlps(nv: number | NumericValue): number | undefined {
  if (
    typeof nv === 'number' ||
    !nv.isExact ||
    nv.im !== 0 ||
    !Number.isFinite(nv.re)
  )
    return undefined;
  return exactDoubleValue(nv) === undefined
    ? exactValueDoubleRoundings(nv)
    : undefined;
}

/**
 * The interval mode: whether `N()` computes in big decimals of more digits
 * than the 17 of a double, so that its value read as a double is within
 * 1 ulp. The engine's precision decides big decimals against doubles
 * (`bignumPreferred()`, `precision > MACHINE_PRECISION`), and the
 * process-global `BigDecimal.precision`, which another engine can have
 * changed, sizes the big decimals (the note in `numerics/real-power.ts`).
 */
function bigDecimalFolds(precision: number): boolean {
  return precision >= 18 && BigDecimal.precision >= 18;
}
