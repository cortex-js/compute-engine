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
 *   same binding; any other value is its expression (`expression()`).
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
import {
  exactDoubleValue,
  exactValueDoubleRoundings,
} from '../../numeric-value/exact-integer-value.js';
import {
  realPowerBranchTerms,
  realPowerReconstructionDigits,
} from '../../numerics/real-power.js';
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
  type Binding,
  type Fn,
  type Frame,
  type Lowering,
} from './lower-context.js';
import { toBigint } from '../../boxed-expression/numerics.js';
import { listLowering, literalList, parameterName } from './lower-lists.js';
import { SCALARIZE_LIMIT } from './passes.js';
import {
  integralClosedForm,
  intervalQuadratureRefusal,
  intervalQuadratureSize,
} from '../interval-quadrature.js';
import { derivativeClosedForm } from '../derivative-closed-form.js';
import { withVarsValuesHidden } from '../vars-inputs.js';
import { prefersJetDerivative } from '../jet-derivative.js';
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

/** The frame names of the flags of a `Loop` (`loop()`): no symbol has a
 *  name that starts with a space. */
const SKIP = ' skip';
const DONE = ' done';

const NO_CLOSED_FORM = `a derivative with no closed form of at most ${CLOSED_SIZE} nodes in radians at compile time`;

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
  /** The text of each `vars` name, for the closed form of an integral
   *  (`integralClosedForm()`). */
  readonly varsTexts?: Readonly<Record<string, string>>;
  /** `false` (GLSL): a list parameter of a user function of no stated
   *  length takes the stated length of its argument at the first call. */
  readonly runtimeLengths?: boolean;
  /** A `Sum` or a `Product` of constant bounds of at most this many passes
   *  is written out, its body lowered once per index (`aggregate()` of
   *  `lower-lists.ts`). Default 0: none. */
  readonly unrollSums?: number;
  /** With `runtimeLengths`: a build, a `Range` or a reduction over a list
   *  of a constant length of at most this many elements is written out
   *  (`README.md`, "Lists", the short lists). Default 0: none. */
  readonly unrollBuilds?: number;
  /** JavaScript, not the interval mode: the numeric derivative of a
   *  derivative with no closed form, and the closed form of a definite
   *  integral in place of the quadrature. */
  readonly javascript?: boolean;
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
  // The elements of the `Range` nodes lowered as literal lists.
  let rangeElements = 0;
  const constant = (v: V) => {
    const c = b.constants.get(v);
    return typeof c === 'number' ? c : undefined;
  };
  // The library constants and the closed values marked `inexact` (the
  // interval mode).
  const inexacts = new Set<V>();
  const inexactReal = (x: number, inexact: number): V => {
    const v = b.constant(x, 'real', inexact);
    inexacts.add(v);
    return v;
  };
  const same = (x: readonly Length[], y: readonly Length[]) =>
    sameShape(x, y, constant);
  const row = (head: string) => rowOfHead(rows, head)!;
  /** The row of the IR operation `name` (not a head: an extension row can
   *  have any head). */
  const ofOp = (name: string) => rowOfOp(rows, name)!.row;

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
   *  `s` `real<0..>`) and `forget()` widens it again.
   *
   *  `enclosed` (the interval mode): the printed enclosure of `v` has a
   *  lower end `>= 0`, not only its value. An integer constant `>= 0`, a
   *  real one of at least 2^-1022 (a real literal can be printed a few ulps
   *  wide, and 0 or a denormal then reaches below 0), `abs`, `exp`,
   *  `square`, `sqrt`, an even power, a sum of such values, and a `max` of
   *  one; not a product or `hypot`, whose outward step moves a lower end 0
   *  to `-5e-324`, nor `mul(a, a)`, whose enclosure over a base that
   *  straddles 0 has a negative part. */
  const nonnegative = (v: V, depth = 0, enclosed = false): boolean => {
    const c = constant(v);
    if (c !== undefined)
      return enclosed && type(v).lane !== 'integer' ? c >= 2 ** -1022 : c >= 0;
    const i = b.defs.get(v);
    if (i === undefined || depth > 16) return false;
    const op = i.op.split('.')[0];
    const k = constant(i.args[1]);
    const next = (a: V) => nonnegative(a, depth + 1, enclosed);
    const always = enclosed ? ['square', 'sqrt'] : ['cabs', 'hypot'];
    if (['abs', 'exp', ...always].includes(op)) return true;
    if (op === 'pow' && k !== undefined && Number.isInteger(k) && k % 2 === 0)
      return true;
    if (enclosed)
      return op === 'max'
        ? i.args.some(next)
        : op === 'add' && i.args.every(next);
    if (op === 'mul' && i.args[0] === i.args[1]) return true;
    return (
      ['add', 'mul', 'max', 'pow', 'sqrt'].includes(op) &&
      (op === 'pow' ? [i.args[0]] : i.args).every(next)
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
    const leaf = (names: Set<string>, slice: boolean): Facts => ({
      names,
      writes: none,
      loop: false,
      slice,
      size: 1,
    });
    if (isSymbol(e)) return leaf(new Set([e.symbol]), true);
    // The attributes of a `Declare` read the names of their values: in a sum
    // written out, `Declare(t, {value: k})` is lowered at each term.
    if (isDictionary(e)) {
      const parts = e.values.map(facts);
      return {
        ...leaf(new Set(parts.flatMap((t) => [...t.names])), false),
        writes: new Set(parts.flatMap((t) => [...t.writes])),
        loop: parts.some((t) => t.loop),
      };
    }
    if (!isFunction(e)) return leaf(none, isNumber(e));
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

  /** Apply the row `head`, or the row of the library head of that name, to
   *  the values `args`. */
  const apply = (
    node: Expression,
    head: OperatorRow | string,
    args: V[]
  ): V => {
    const r = typeof head === 'string' ? row(head) : head;
    // An angle in another unit than radians: the operands of a direct
    // function are converted to radians, the result of an inverse one from
    // radians, with the factors of the unit at the time of the compilation.
    const factors = r.angle && ANGLE_FACTORS[ce.angularUnit];
    if (factors) {
      const plain = { ...r, angle: undefined };
      const scale = (v: V, k: number) =>
        apply(node, 'Multiply', [
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
        c.head,
        args.filter((_, i) => i !== c.index)
      );
    const complex = leaves(r, args, node);
    const operation = (given: V[]): V => {
      // A tuple operand: only a row whose value on a tuple is its value on
      // the list of the same elements (`TUPLE_RULES`).
      const tuple = given.find((v) => tuples.has(v));
      if (tuple !== undefined) {
        // `div.q`, the division by the denominator of a rational factor,
        // reads a tuple dividend as `Divide` does. A colour conversion of a
        // tuple is an error of the interpreter.
        const rule =
          TUPLE_RULES[
            r.signatures[0][2] === 'div.q' ? 'Divide' : (r.head ?? '')
          ] ??
          (r.arity === 1 && r.threads && r.signatures[0][0][0] !== 'color'
            ? 'each'
            : undefined);
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
      return apply(node, 'Multiply', [x, x]);
    });
    const sum = squares.reduce((s, x) => apply(node, 'Add', [s, x]));
    return apply(node, 'Sqrt', [sum]);
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
        return apply(e, 'RandomShuffle', [l]);
      }
      case 'At': {
        if (e.nops !== 2) decline(e, 'At with an index for each level');
        const [l, i] = [value(e.ops[0])!, value(e.ops[1])!];
        const [t, k] = [type(l), constant(i)];
        // A list of indexes into a list of numbers: the list of the `At` of
        // each index, as the interpreter's.
        const flat = (v: V) => type(v).shape.length === 1 && !tuples.has(v);
        if (
          flat(i) &&
          flat(l) &&
          isSubLane(t.lane, 'real') &&
          isSubLane(type(i).lane, 'real')
        )
          return lists.over(
            e,
            lists.listSource(i),
            '',
            (x) => apply(e, 'At', [l, x]),
            false,
            e
          );
        if (type(i).shape.length > 0)
          decline(e.ops[1], 'a list where a scalar is required');
        const n = t.shape[0];
        // Out of range, the interpreter gives NaN for a number, `Missing`
        // for a boolean or a list, and `_at` gives the number NaN, which
        // is not a complex value; the `fold` pass makes a constant index
        // in range an element (of colours, `admits()` declines the rest).
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
        return apply(e, 'At', [l, i]);
      }
      case 'PointX':
      case 'PointY':
      case 'PointZ': {
        // The coordinate of a point, an `At` of a tuple of scalars (a
        // coordinate past the last one is an `incompatible-dimensions`
        // error of the canonical form, which declines first).
        // Of a list of points, the list of the coordinates; of the library's
        // literal `List` of points, with no list of points (GLSL has none).
        const [l] = e.ops;
        const k = ['PointX', 'PointY', 'PointZ'].indexOf(e.operator) + 1;
        const coordinate = ([q]: V[]) =>
          apply(e, 'At', [q, b.constant(k, 'integer')]);
        const ps =
          e.nops === 1 && literalList(cx, l) && l.type.type !== 'error'
            ? l.ops.map((x) => value(x)!)
            : undefined;
        if (
          ps?.length &&
          ps.every((q) => tuples.get(q) === 0 && type(q).shape.length === 1)
        )
          return list(
            e,
            ps.map((q) => coordinate([q]))
          );
        const p = ps ? list(l as Fn, ps) : value(l)!;
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
        const d = apply(e, 'Add', [p, apply(e, 'Negate', [q])]);
        return apply(e, 'Abs', [d]);
      }
      case 'Multiply':
        return product(e);
      case 'Power': {
        // The interval mode (`README.md`, "The interval mode"): `x^(p/q)` of
        // a literal rational is `Root(x, q)^p`, or `pow.principal` of the
        // double `p/q` when `q` is a power of 2; a float literal that is not
        // an integer is read as the interpreter reads it
        // (`realPowerBranchTerms()`), `pow.branch` over a base that can be
        // negative when its `q` is odd, `pow.principal` otherwise; a power
        // by the unmarked constant 2 is `square`.
        const nv = isNumber(e.ops[1]) ? e.ops[1].numericValue : undefined;
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
            ? (realPowerBranchTerms(
                undefined,
                float,
                realPowerReconstructionDigits(e.engine.precision)
              ) ?? null)
            : undefined;
        const odd = terms != null && terms[1] % 2 !== 0;
        const pq =
          interval && typeof nv === 'object' && nv.isExact
            ? e.ops[1].toRational()
            : null;
        if (pq === null || !pq.every(Number.isSafeInteger) || pq[1] < 2) {
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
            return apply(e, ofOp(op), [x, k]);
          }
          if (constant(k) === 2 && type(k).lane === 'integer')
            return apply(e, ofOp('square'), [x]);
          // A scalar real exponent known at run time over a scalar base whose
          // enclosure is `>= 0`: the reading of `_IA.powReal` gives the
          // principal power there, `pow.interval`. The base `e` stays
          // `Power` (its row makes it `Exp`).
          return constant(k) === undefined &&
            type(k).lane === 'real' &&
            type(x).lane !== 'complex' &&
            type(x).shape.length === 0 &&
            type(k).shape.length === 0 &&
            constant(x) !== Math.E &&
            nonnegative(x, 0, true)
            ? apply(e, ofOp('pow.interval'), [x, k])
            : apply(e, 'Power', [x, k]);
        }
        if (2 ** Math.round(Math.log2(pq[1])) === pq[1])
          return apply(e, ofOp('pow.principal'), [
            value(e.ops[0])!,
            b.constant(pq[0] / pq[1], 'real'),
          ]);
        const root = apply(e, 'Root', [
          value(e.ops[0])!,
          b.constant(pq[1], 'integer'),
        ]);
        return pq[0] === 1
          ? root
          : apply(e, 'Power', [root, b.constant(pq[0], 'integer')]);
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
        if (is(10)) return apply(e, 'Log', [x]);
        if (is(2) && type(x).lane !== 'complex' && options.mode !== 'complex')
          return apply(e, ofOp('log2'), [x]);
        return apply(
          e,
          'Divide',
          [x, base].map((v) => apply(e, 'Ln', [v]))
        );
      }
      case 'Length':
        return lists.source(e.ops[0], false, true).length;
      case 'Range': {
        const effects = b.effects;
        const s = lists.source(e);
        // A list value of constant operands: the engine's elements, as a
        // literal list (README, "closedValue()"); a consumer that iterates
        // a `Range` reads it by `lists.source()` and never comes here. An
        // operand with no effect and no write is lowered again from the memo
        // or as a pure copy; at most 4,096 elements in all.
        const closed =
          options.fold !== false &&
          b.effects === effects &&
          facts(e).writes.size === 0 &&
          e.ops.every((x) => constant(value(x)!) !== undefined);
        const r = closed ? e.evaluate() : undefined;
        if (
          r?.isFiniteCollection &&
          rangeElements + Number(r.count) <= SCALARIZE_LIMIT ** 2
        ) {
          rangeElements += Number(r.count);
          const l = ce.function('ListFrom', [r]).N();
          if (
            isFunction(l, 'List') &&
            l.nops > 0 &&
            l.ops.every(
              (x) => isNumber(x) && x.im === 0 && Number.isFinite(x.re)
            )
          )
            return value(l)!;
        }
        return lists.built(e, s.length, s.at);
      }
      case 'Map':
        if (e.nops > 2) return lists.mapLists(e);
        if (e.nops !== 2) decline(e, 'Map with no list');
        return lists.build(e, e.ops[1], e.ops[0], false);
      // Every list of the slice is listed: `ListFrom(L)` is `L`.
      case 'ListFrom': {
        const v = e.nops === 1 ? value(e.ops[0])! : undefined;
        if (
          v === undefined ||
          tuples.get(v) === 0 ||
          type(v).shape.length === 0
        )
          decline(e, 'ListFrom of other than one list');
        return v;
      }
      // `min(max(x, lo), hi)`, the interpreter's: `hi` when `lo > hi`.
      case 'Clamp': {
        if (e.nops !== 3) decline(e, 'Clamp with other than three operands');
        const [x, lo, hi] = e.ops.map((o) => value(o)!);
        return apply(e, 'ElementMin', [apply(e, 'ElementMax', [x, lo]), hi]);
      }
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
      case 'Break':
      case 'Continue': {
        const skip = lookup(SKIP);
        const done = e.operator === 'Break' ? lookup(DONE) : skip;
        if (want || e.nops > 0 || !skip || skip.outer || !done)
          decline(e, `a ${e.operator} that is not a statement of a Loop body`);
        skip.binding.v = done.binding.v = b.constant(true, 'boolean');
        return undefined;
      }
      case 'Integrate':
      case 'NIntegrate':
        return integral(e);
      case 'D': {
        // A variable that holds a value (not a `vars` name) is read with it
        // by the engine. With no closed form, JavaScript takes the stencil of
        // the existing compiler (`_SYS.nd`), of `D(f, x)` of a pure real body
        // at the value of the name outside (`D` binds `x`).
        const [body, x] = e.ops;
        const valued = (v: Expression) =>
          isSymbol(v) &&
          !lookup(v.symbol) &&
          !options.vars?.includes(v.symbol) &&
          held(v.symbol)?.value !== undefined;
        if (e.ops.slice(1).some(valued))
          decline(e, 'a variable of a derivative that holds a value');
        const c = closedForm(e, () => derivativeClosedForm('D', e.ops));
        if (c !== undefined) return value(c, want);
        const name = e.nops === 2 && isSymbol(x) ? x.symbol : '';
        if (!options.javascript || !name || body.isPure !== true)
          decline(e, NO_CLOSED_FORM);
        if (!lookup(name) && !ce.lookupDefinition(name))
          decline(x, `the variable ${name} of a derivative is not declared`);
        const point = scalar(lookup(name) ? x : ce.box(name));
        if (!isSubLane(type(point).lane, 'real'))
          decline(e, 'the point of a derivative is not real');
        const effects = b.effects;
        const [out] = region(
          'derivative',
          [point],
          ...realBody(e, name, body, 'a derivative'),
          e
        );
        if (b.effects !== effects) decline(e, 'a derivative with an effect');
        return out;
      }
      case 'Apply': {
        // `Apply(Function(body, p1, …), a1, …)`: the body with each
        // parameter bound to its argument, each argument evaluated once, in
        // order, before it. (`Apply(g, x)` of a name is the call `g(x)` in
        // the canonical form.) `Apply(Derivative(g, n…), a1, …)` is the
        // application of the function literal of the derivative, which
        // declines with none, and at a total order of 3 or more of a large
        // body (the existing compiler's forward mode,
        // `prefersJetDerivative()`) before the engine is asked.
        const [g, ...args] = e.ops;
        let f: Expression | undefined = g;
        if (isFunction(g, 'Derivative')) {
          const h = g.ops[0];
          const lit = isSymbol(h) ? userBinding(h as never)?.literal : h;
          const k = g.ops
            .slice(1)
            .reduce((n, o) => n + Math.floor(o.N().re), 0);
          if (!(k >= 3) || lit === undefined || !prefersJetDerivative(lit, k))
            f = closedForm(g, () => derivativeClosedForm('Derivative', g.ops));
          if (f === g || f === undefined) decline(g, NO_CLOSED_FORM);
        }
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
   *  power of two, it is `(p · factors) / q` (`div.q`): `Floor(x/49)` at 49
   *  is 1, where the product by the double of `1/49` gives 0 (`README.md`,
   *  "The contracts"). The constant can be a free name that holds it. */
  const product = (e: Fn): V => {
    // The number of `x`: a literal, or the value a free name holds.
    const numberOf = (x: Expression): Expression | undefined => {
      if (isNumber(x)) return x;
      if (!isSymbol(x) || lookup(x.symbol) !== undefined) return undefined;
      if (options.vars?.includes(x.symbol) || CONSTANTS.has(x.symbol)) return;
      const v = own(x);
      return v !== undefined && isNumber(v) ? v : undefined;
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
        'Multiply',
        values.map((v, i) => v ?? value(e.ops[i])!)
      );
    const c = e.ops[k];
    if (isSymbol(c) && !held(c.symbol)!.library) b.captures.add(c.symbol);
    const [p, q] = ratio(c)!;
    const mul = (xs: V[]) =>
      xs.length === 1 ? xs[0] : apply(e, 'Multiply', xs);
    const scalars = rest.filter((v) => type(v).shape.length === 0);
    const lists = rest.filter((v) => type(v).shape.length > 0);
    // The interval mode, with a constant marked `inexact` among the scalars
    // (`π`) and a factor that is not a constant: the product of the rational
    // and the constants is one constant, folded as a closed node (`N()` and
    // one ulp) or else `(π / q) · p` as on the existing target, computed
    // once, times the other factors. Else the division stays last: `1/3 · 6`
    // is the point 2.
    const c0 = interval ? scalars.find((v) => inexacts.has(v)) : undefined;
    if (c0 !== undefined && rest.some((v) => constant(v) === undefined)) {
      const fixed = (i: number) =>
        i === k || constant(values[i]!) !== undefined;
      const closed = e.ops.filter((_, i) => fixed(i));
      const others = values.filter((_, i) => !fixed(i)) as V[];
      const folded = closedValue(ce.function('Multiply', closed) as Fn);
      if (folded !== undefined) return mul([folded, ...others]);
      const cq = apply(e, ofOp('div.q'), [c0, b.constant(q, 'integer')]);
      const kq = p === 1 ? cq : mul([cq, b.constant(p, 'integer')]);
      // `c0` once, by position: a constant repeated (`π·π`) is one value.
      const at = scalars.indexOf(c0);
      return mul([kq, ...scalars.filter((_, i) => i !== at), ...lists]);
    }
    let factors = lists;
    if (scalars.length > 0) {
      let s = mul(
        p === 1 || p === -1 ? scalars : [b.constant(p, 'integer'), ...scalars]
      );
      if (p === -1) s = apply(e, 'Negate', [s]);
      factors = [s, ...lists];
    } else if (p !== 1) factors = [b.constant(p, 'integer'), ...lists];
    const v = mul(factors);
    return apply(e, ofOp('div.q'), [v, b.constant(q, 'integer')]);
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
        // `N()` computes in big decimals of more digits than the 17 of a
        // double, so that its value read as a double is within 1 ulp: the
        // engine's precision decides big decimals against doubles
        // (`bignumPreferred()`) and sizes them.
        const big = ce.precision >= 18;
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
    if (!isNumber(n) || (bigint && n.isInteger !== true)) return undefined;
    return number(n, interval && !exact ? 1 : undefined);
  };

  /** The expression that `ask()` gives at compile time for `e` (the closed
   *  form of a derivative), with the values of the `vars` names hidden as on
   *  the existing targets; `undefined` when there is none; a decline under
   *  an angular unit other than radians (the walk converts the units
   *  itself), when `e` or it has more than `CLOSED_SIZE` nodes, and when it
   *  reads a name that the walk would read in another binding (`foreign()`).
   *  An accepted closed form keeps the names that it absorbed as
   *  dependencies of the code (`symbolDeps`): each name of `e` or of a value
   *  that `e` reaches that holds a value, and each user function it reaches. */
  const closedForm = (e: Fn, ask: () => Expression | undefined) => {
    // `withVarsValuesHidden()` hides no value of a constant or of a name
    // whose type is inferred from its value.
    const fixed = (n: string) => {
      const d = held(n);
      return (
        d?.value !== undefined &&
        (d.definition.isConstant || d.definition.inferredType)
      );
    };
    if (
      ce.angularUnit !== 'rad' ||
      facts(e).size > CLOSED_SIZE ||
      options.vars?.some(fixed)
    )
      decline(e, NO_CLOSED_FORM);
    const vars = options.vars?.map((n) => [n, n]);
    const c = withVarsValuesHidden(e, vars && Object.fromEntries(vars), ask);
    if (c !== undefined && (facts(c).size > CLOSED_SIZE || foreign(e, c)))
      decline(e, NO_CLOSED_FORM);
    // The names of the node not bound in the walk or by `e`, the names of the
    // values that it reaches (which their definitions bind), its functions.
    const fns = new Set<string>();
    const own = e.ops
      .slice(1)
      .map((x) => (isFunction(x, 'Limits') ? x.ops[0] : x));
    const names = [...facts(e).names].filter(
      (n) => !lookup(n) && !own.some((x) => isSymbol(x, n))
    );
    if (c !== undefined)
      for (const n of [...names, ...calledNames(e, fns), ...fns])
        if (
          !options.vars?.includes(n) &&
          (fns.has(n) || held(n)?.value !== undefined) &&
          held(n)?.library !== true
        )
          b.captures.add(n);
    return c;
  };
  /** The factors of `x`: through a `Multiply`, a `Negate`, a `Sqrt`, a
   *  `Root` and a `Power` of a number exponent. */
  const factors = (x: Expression): Expression[] =>
    isFunction(x) && ['Multiply', 'Negate', 'Sqrt'].includes(x.operator)
      ? x.ops.flatMap(factors)
      : isFunction(x, 'Root') || (isFunction(x, 'Power') && isNumber(x.ops[1]))
        ? factors(x.ops[0])
        : [x];
  /** The factors of the divisors in `x` (the denominator of a `Divide`, the
   *  base of a `Power` of a negative exponent) and of the value that a name
   *  of one holds; also those of the body of each user function that `x`
   *  calls that read none of its parameters. `always`: only the divisors
   *  that every evaluation of `x` divides by (none in an arm of an `If` or
   *  a `Which`, no base of a `Power` whose exponent is not a number). */
  const divisors = (
    x: Expression,
    always = false,
    out: Expression[] = [],
    seen = new Set<object>()
  ): Expression[] => {
    if (!isFunction(x) || seen.has(x)) return out;
    if (always && (x.operator === 'If' || x.operator === 'Which')) return out;
    seen.add(x);
    const user = userBinding(x as never)?.literal;
    if (isFunction(user, 'Function')) {
      const ps = user.ops.slice(1).map(parameterName);
      for (const f of divisors(user.ops[0], always, [], seen))
        if (![...facts(f).names].some((n) => ps.includes(n))) out.push(f);
    }
    const [p, q] = x.ops;
    const d =
      x.operator === 'Divide'
        ? q
        : x.operator === 'Power' &&
            ((!always && isFunction(q, 'Negate')) || (isNumber(q) && q.re < 0))
          ? p
          : undefined;
    for (const f of d === undefined ? [] : factors(d)) {
      const v = isSymbol(f) ? f.valueDefinition?.value : undefined;
      out.push(f, ...(v === undefined ? [] : factors(v)));
    }
    x.ops.forEach((op) => divisors(op, always, out, seen));
    return out;
  };
  /** `c` reads a name, not its own parameter, that the walk binds other than
   *  as an input (an index, a local, a parameter) and that `e` does not
   *  read, or that a value that `e` reaches reads (`calledNames()`). */
  const foreign = (e: Fn, c: Expression) => {
    const called = calledNames(e);
    const param = (n: string) =>
      isFunction(c, 'Function') &&
      c.ops.slice(1).some((p) => parameterName(p) === n);
    return [...facts(c).names].some(
      (n) =>
        (lookup(n)?.binding.role ?? 'input') !== 'input' &&
        (!facts(e).names.has(n) || called.has(n)) &&
        !param(n)
    );
  };
  /** The names read by the values that `x` reaches: the body of each user
   *  function that it calls or names (other than its parameters) and each
   *  expression that a name of it holds, through other such values. `fns`:
   *  the names of the user functions reached. */
  const calledNames = (
    x: Expression,
    fns = new Set<string>(),
    out = new Set<string>(),
    seen = new Set<object>()
  ) => {
    if (seen.has(x) || !(isFunction(x) || isSymbol(x))) return out;
    seen.add(x);
    const user = userBinding(x as never)?.literal;
    if (user !== undefined) fns.add(isSymbol(x) ? x.symbol : x.operator);
    const v = user ?? (isSymbol(x) ? x.valueDefinition?.value : undefined);
    if (v !== undefined && !seen.has(v)) {
      seen.add(v);
      const [body, ...ps] = isFunction(v, 'Function') ? v.ops : [v];
      const params = ps.map(parameterName);
      for (const n of facts(body).names) if (!params.includes(n)) out.add(n);
      calledNames(body, fns, out, seen);
    }
    if (isFunction(x)) x.ops.forEach((op) => calledNames(op, fns, out, seen));
    return out;
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
      return b.constant(
        Number.isSafeInteger(Number(n)) ? Number(n) : n,
        'integer'
      );
    }
    if (e.im === 0 && inexact !== undefined && Number.isFinite(e.re))
      return inexactReal(e.re, inexact);
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
   *  docs/SCOPING-MODEL.md), its definition, and whether that binding is
   *  the library's. */
  const held = (name: string) => {
    const binding = ce.lookupDefinition(name);
    const library = ce.contextStack[0]?.lexicalScope.bindings.get(name);
    return binding !== undefined && 'value' in binding
      ? {
          definition: binding.value,
          value: binding.value.value,
          library: binding === library,
        }
      : undefined;
  };

  /** The value that the name of `e` holds, when its binding here is the one
   *  that the occurrence reads (always, at the entry). */
  const own = (e: Expression & { symbol: string }) => {
    const h = held(e.symbol);
    return h !== undefined &&
      (cx.inFunction === undefined ||
        h.definition === resolvedValueDefinition(e))
      ? h.value
      : undefined;
  };

  // The names whose held value is being lowered (`expression()`).
  const expanding = new Set<string>();

  /** The held value `v` of the name `name`, which is not a literal, lowered
   *  where `e` reads it. It declines when `v` reads `name` again, has an
   *  effect, or has another rank or lane than the type of `e`, and when a
   *  name that `v` reads (outside a function literal of `v` that binds it)
   *  is bound here other than as an input, or has another binding here
   *  than in `v` with a value in one of the two (the interpreter reads the
   *  bindings of `v`). */
  const expression = (e: Expression, name: string, v: Expression): V => {
    // A node shared by several paths is walked once per set of names that
    // the function literals around it bind.
    const walked = new Map<Expression, readonly string[]>();
    const reason = (x: Expression, inner: readonly string[]): string => {
      if (walked.get(x) === inner) return '';
      walked.set(x, inner);
      if (isFunction(x, 'Function'))
        inner = [
          ...inner,
          ...x.ops.slice(1).map((p) => (isSymbol(p) ? p.symbol : '')),
        ];
      if (!isSymbol(x))
        return isFunction(x)
          ? x.ops.reduce((s, op) => s || reason(op, inner), '')
          : '';
      const n = x.symbol;
      if (inner.includes(n)) return '';
      const role = lookup(n)?.binding.role;
      if (role !== undefined && role !== 'input')
        return `${n}, a local or a parameter here`;
      if (n === name || expanding.has(n)) return `${n} again`;
      const [h, d] = [held(n), resolvedValueDefinition(x)];
      return h?.definition !== d &&
        (h?.value !== undefined || d?.value !== undefined)
        ? `${n} of another binding`
        : '';
    };
    const why = facts(v).writes.size > 0 ? 'a write' : reason(v, []);
    if (why) decline(e, `the value of ${name}, which reads ${why}`);
    const effects = b.effects;
    expanding.add(name);
    let x: V;
    try {
      x = value(v)!;
    } finally {
      expanding.delete(name);
    }
    if (b.effects !== effects)
      decline(e, `the value of ${name}, which has an effect`);
    const t = inputIR(e.type.type);
    if (
      t !== undefined &&
      (t.shape.length !== type(x).shape.length ||
        t.shape.some((n, i) => {
          const m = type(x).shape[i];
          const k = typeof m === 'number' ? m : constant(m.v);
          return typeof n === 'number' && k !== undefined && n !== k;
        }) ||
        !widensTo(type(x).lane, t.lane))
    )
      decline(
        e,
        `the value of ${name}, of another type than ${engineTypeToString(e.type.type)}`
      );
    return x;
  };

  /** The value of the free name `e`, which holds `v` in the engine: a
   *  literal when `v` is a number, a list, a tuple or a `PointList` of
   *  numbers, or a colour constructor of three real numbers
   *  (`Hsv(270, 0.4, 0.95)`); any other value is its expression
   *  (`expression()`), but for a name of the library, which declines. The
   *  name is a capture (`symbolDeps`) unless its binding is the library's. */
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
    const literal = color
      ? isFunction(v) &&
        v.nops === 3 &&
        v.ops.every((x) => isNumber(x) && x.im === 0)
      : numbers(v);
    const library = held(name)!.library;
    if (!literal && library)
      decline(
        e,
        color
          ? `a symbol whose colour value is not ${r.head} of three real numbers`
          : 'a symbol with a value that is not a number or a list of numbers (or a tuple of numbers), or a colour of three numbers'
      );
    // After `expression()`: a decline in it leaves no capture behind.
    const x = literal ? undefined : expression(e, name, v);
    if (!library) b.captures.add(name);
    if (x !== undefined) return x;
    // The interval mode: a constant of the library whose value is not exact
    // (`EulerGamma`, `CatalanConstant`) holds the double nearest to a number
    // that is not a double: an enclosure of one ulp on each side, as on the
    // existing interval target. A decimal of the program is its double
    // (`literalUlps()`).
    if (
      library &&
      interval &&
      isNumber(v) &&
      v.im === 0 &&
      Number.isFinite(v.re)
    ) {
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
      return interval ? inexactReal(c, 1) : b.constant(c, 'real');
    }
    // In a function body the interpreter reads the binding of the body,
    // which need not be the binding of the name where the call is: a name
    // whose binding here is the body's is its value, as at the entry
    // (`compile()` chooses a scope where it is, `compilationScope()`);
    // another name with a value declines; an input is a parameter that
    // each call passes.
    const v = own(e);
    if (v !== undefined) return captured(e, name, v);
    if (cx.inFunction === undefined) return input(e, name, e.type.type);
    if (
      held(name)?.value !== undefined ||
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
    return cx.inFunction === undefined
      ? input(e, name, held(name)?.definition.type.type ?? t)
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
    // A binding is once in the list (the flags of a Loop, `loop()`).
    bindings = [...new Set(frames.flatMap((f) => [...f.names.values()]))]
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
    const length = lengths.reduce((m, x) => apply(e, 'Min', [m, x]));
    return lists.built(e, length, (k) =>
      tuple(
        e,
        parts.map((v) =>
          type(v).shape.length === 0 ? v : lists.listSource(v).at(k)
        )
      )
    );
  };

  const local = (s: Expression, v: V, lane: Lane): V => {
    if (!widensTo(type(v).lane, lane))
      decline(s, `a value that is not ${lane}`);
    return widen(v, lane);
  };

  const block = (e: Fn, want: boolean): V | undefined =>
    withFrame(false, (frame) => {
      let result: V | undefined;
      const statement = (s: Expression, i: number) => {
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
              : bigint || !isSubLane(type(v).lane, 'real')
                ? type(v).lane
                : 'real';
          result = local(s, v, lane);
          frame.names.set(name.symbol, {
            v: result,
            lane,
            role: isSymbol(constant, 'True') ? 'constant' : 'local',
          });
        } else result = value(s, want && i === e.nops - 1);
      };
      // The statements after one that may leave the pass of a Loop (`loop()`)
      // run in the arm where it did not.
      const statements = (from: number): void => {
        for (let i = from; i < e.nops; i++) {
          const skip = lookup(SKIP)?.binding;
          const before = skip?.v;
          statement(e.ops[i], i);
          if (skip === undefined || skip.v === before || i === e.nops - 1)
            continue;
          if (b.constants.get(skip.v) !== true) {
            if (want) decline(e, 'a value after a Break or a Continue');
            const rest = () => (statements(i + 1), undefined);
            branch(e, skip.v, () => undefined, rest, false);
          }
          return;
        }
      };
      statements(0);
      if (want && result === undefined) decline(e, 'a block with no value');
      return result;
    });

  /** `Loop(body, Element(i, L), …)`, a statement whose value is
   *  `Nothing`: a counted loop per clause (a later clause is lowered in the
   *  body of the one before it, so it reads its index), whose carried
   *  values are the locals declared outside it that the body writes. Each
   *  pass is a pass of the `iterationBudget` (`passes`). A `Break` sets the
   *  carried flag `DONE`, the `exit` of every clause; a `Break` or a
   *  `Continue` sets `SKIP` (`DONE` itself when there is no `Continue`),
   *  under which `block()` skips the rest of the pass. */
  const loop = (e: Fn, want: boolean): undefined => {
    if (want) decline(e, 'the value of a Loop (Nothing)');
    if (e.nops < 2) decline(e, 'a Loop with no Element clause');
    const heads = jumps(e.ops[0]);
    if (heads & 4)
      decline(e, 'a Break or a Continue in a function literal in a Loop');
    const flag = (): Binding => ({
      v: b.constant(false, 'boolean'),
      lane: 'boolean',
      role: 'local',
    });
    const done = heads & 1 ? flag() : undefined;
    const carried = [...facts(e).writes].flatMap((n) => {
      const x = lookup(n);
      return x?.binding.role === 'local' && !x.outer ? [x.binding] : [];
    });
    if (done) carried.push(done);
    const exit = done ? { exit: carried.length - 1 } : {};
    const clause = (j: number): void => {
      if (j === e.nops)
        return withFrame(false, (frame) => {
          const skip = heads & 2 ? flag() : done;
          if (skip) frame.names.set(SKIP, skip);
          if (done) frame.names.set(DONE, done);
          value(e.ops[0], false);
        });
      const c = e.ops[j];
      if (!isFunction(c, 'Element') || c.nops !== 2)
        decline(c, 'a Loop clause that is not Element(i, L)');
      const index = c.ops[0];
      if (!isSymbol(index)) decline(c, 'a Loop index that is not a name');
      const s = lists.source(c.ops[1]);
      const lo = b.constant(0, 'integer');
      const hi = apply(c, 'Subtract', [s.length, b.constant(1, 'integer')]);
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
      b.emit({ k: 'loop', outs, lo, hi, init, body, passes: true, ...exit });
      carried.forEach((x, i) => (x.v = outs[i]));
    };
    clause(1);
    return undefined;
  };

  /** The `Break` (1) and the `Continue` (2) of the Loop whose body is `x`,
   *  not of a Loop in it; 4 when one is in a function literal. Memoized: a
   *  shared node is visited once. */
  const jumped = new WeakMap<Expression, number>();
  const jumps = (x: Expression): number => {
    if (!isFunction(x) || x.operator === 'Loop') return 0;
    let k = jumped.get(x);
    if (k !== undefined) return k;
    k = x.operator === 'Break' ? 1 : x.operator === 'Continue' ? 2 : 0;
    for (const op of x.ops) k |= jumps(op);
    if (x.operator === 'Function' && k !== 0) k = 4;
    jumped.set(x, k);
    return k;
  };

  /** The interval mode: the pieces of the integral being lowered, and the
   *  function whose body holds it. */
  let quadrature: { n: number; fn?: string } | undefined;
  /** The region of the closed form that `ask()` gives for an integral, or
   *  `undefined` when there is none, when `ask()` or the lowering declines,
   *  when it is not real, and when it holds a loop or a call, whose function
   *  would stay defined after the region is discarded. Its only effects are
   *  reads of `vars` entries, which in the interval mode read the inputs
   *  object: they are not counted there; `effects` is their number. */
  const closedRegion = (ask: () => Expression | undefined) => {
    let effects = 0;
    const r = trial(() => {
      const c = ask();
      if (c === undefined || facts(c).loop || !facts(c).slice) return undefined;
      const before = b.effects;
      const v = scalar(c);
      effects = b.effects - before;
      return v;
    }, true);
    return r && isSubLane(type(r.yields[0]).lane, 'real')
      ? Object.assign(r, { effects })
      : undefined;
  };
  /** The region of the value that `f` lowers, which is not emitted, or
   *  `undefined` when `f` gives no value or declines; `b.effects` is
   *  restored. A decline after a user function began to be lowered in `f`
   *  is rethrown, unless `any`. */
  const trial = (f: () => V | undefined, any = false): Region | undefined => {
    const [effects, begun, outer] = [b.effects, fns.begun(), quadrature];
    let v: V | undefined;
    const r = b.region([], () => {
      try {
        v = f();
      } catch (error) {
        // A user function whose lowering began stays registered.
        if (!(error instanceof Decline) || (!any && fns.begun() !== begun))
          throw error;
        quadrature = outer;
      }
      return v === undefined ? [] : [v];
    });
    b.effects = effects;
    return v === undefined ? undefined : r;
  };
  /** The interval mode: `x` is safe to compute before an integral whose
   *  integrand holds it (an invariant): every head is a pure row of the
   *  library, which lowers to operations only (no reduction, loop, call,
   *  conditional or integral, which can throw or run where the integrand
   *  would not). */
  const early = new WeakMap<Expression, boolean>();
  /** The row of `x`, a library head that is not a construct or a reduction. */
  const rowNode = (x: Fn) =>
    isLibrary(x) && !CONSTRUCTS.has(x.operator) && !REDUCTIONS.has(x.operator)
      ? rowOfHead(rows, x.operator)
      : undefined;
  const speculatable = (x: Expression): boolean => {
    if (!isFunction(x)) return true;
    let known = early.get(x);
    if (known === undefined) {
      known = rowNode(x)?.effect === 'pure' && x.ops.every(speculatable);
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
      // The engine would read a draw of the integrand once, at compile time.
      if (!e.isPure) decline(e, 'an integrand with an effect');
      const c = integralClosedForm(e.ops, options.varsTexts ?? {});
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
    // The routine binds the parameter of a literal, the interpreter the name
    // of the `Limits`.
    const variable = isFunction(limits, 'Limits') ? limits.ops[0] : undefined;
    if (
      literal &&
      isSymbol(variable) &&
      variable.symbol !== 'Nothing' &&
      variable.symbol !== name
    )
      decline(
        e,
        'an integrand whose parameter is not the variable of the integral'
      );
    // JavaScript: the closed form that the engine gives at compile time, as
    // on the existing compiler, with the guards of `closedForm()`; with none,
    // a guard that fails or a closed form that does not lower, the
    // quadrature. Not with a draw, which the engine would read once, and
    // not for an indefinite integral, a function of its variable. Not when
    // the closed form reads the variable that no bound reads (its value
    // outside), or divides by a name that no divisor of `e` reads: it is
    // NaN or loses its digits where the divisor is 0 or near it
    // (`∫₀ˣ cos(a·t) dt` is `sin(a·x)/a`).
    if (
      options.javascript &&
      e.operator === 'Integrate' &&
      e.isPure &&
      !bounds.some((x) => isSymbol(x, 'Nothing'))
    ) {
      const [vars, captures] = [options.varsTexts ?? {}, [...b.captures]];
      const c = closedRegion(() => {
        const c = closedForm(e, () => integralClosedForm(e.ops, vars));
        const own = (x: Expression) => facts(x).names.has(name);
        const allowed = divisors(e, true);
        // A factor of a number in effect: its names are library constants.
        const fixed = (f: Expression) =>
          [...facts(f).names].every((n) => !lookup(n) && held(n)?.library);
        const nan = (x: Expression): boolean =>
          isNumber(x) ? x.isNaN === true : isFunction(x) && x.ops.some(nan);
        return c === undefined ||
          nan(c) ||
          (own(c) && !bounds.some(own)) ||
          divisors(c).some(
            (f) => !fixed(f) && !allowed.some((g) => g.isSame(f))
          )
          ? undefined
          : c;
      });
      if (c !== undefined) {
        const effects = b.effects;
        c.body.forEach((i) => b.emit(i));
        b.effects = effects + c.effects;
        return c.yields[0];
      }
      b.captures.clear();
      captures.forEach((n) => b.captures.add(n));
    }
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
    // an arm or of a scope stays in place. Not with an infinite bound, where
    // the integrand never runs.
    const invariant = (x: Expression): void => {
      if (!isFunction(x)) return;
      const k = facts(x);
      if (!k.names.has(name) && k.writes.size === 0 && speculatable(x))
        value(x);
      else if (
        (x.operator === 'Block' && x.nops === 1) ||
        userBinding(x) !== undefined ||
        rowNode(x) !== undefined
      )
        x.ops.forEach(invariant);
    };
    if (interval && !bounds.some((x) => isNumber(x) && x.isInfinity))
      invariant(literal?.ops[0] ?? f);
    // The interval mode: the closed form of the existing interval target,
    // which `_IA.integrateClosed` gives when its scan of the integrand
    // finds no pole (`print-interval.ts`); otherwise the enclosure. Not
    // with a draw in a bound: the engine would read one draw, at compile
    // time, where the bound encloses every draw.
    const closed =
      interval && e.operator === 'Integrate' && e.isPure
        ? closedRegion(() => integralClosedForm(e.ops, options.varsTexts ?? {}))
        : undefined;
    const [out] = region(
      'integrate',
      [lo, hi],
      ...realBody(e, name, literal?.ops[0] ?? f, 'an integrand'),
      e,
      interval ? quadrature!.n : undefined,
      closed
    );
    if (b.effects !== effects) decline(e, 'an integrand with an effect');
    quadrature = outer;
    return out;
  };

  /** The parameter and the body of a region of one real parameter, bound to
   *  `name`: the real value of `body` (`what`: the body, in a decline). */
  const realBody = (
    e: Fn,
    name: string,
    body: Expression,
    what: string
  ): [V[], () => V[]] => {
    const t = b.newValue(scalarType('real'));
    return [
      [t],
      () =>
        withFrame(true, (frame) => {
          frame.names.set(name, { v: t, role: 'index' });
          const y = scalar(body);
          if (!isSubLane(type(y).lane, 'real'))
            decline(e, `${what} that is not real`);
          return [y];
        }),
    ];
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
    b,
    rows,
    frames,
    value,
    scalar,
    apply,
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
    unrollSums: options.unrollSums ?? 0,
    unrollBuilds: options.unrollBuilds ?? 0,
    attempt: (f, accept, refund) => {
      const [nodes, begun] = [lowered, fns.begun()];
      const r = trial(() => f(() => lowered - nodes, NODE_LIMIT - nodes));
      if (r === undefined || !accept(r)) {
        // A function lowered in the attempt is called again by the loop.
        if (fns.begun() === begun) {
          lowered = nodes;
          refund();
        }
        return undefined;
      }
      r.body.forEach((i) => b.emit(i));
      return r.yields[0];
    },
    tuples,
  };
  const lists = listLowering(cx);
  const fns = functionLowering(cx, lists);

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
