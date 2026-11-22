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
import { isSubtype } from '../../../common/type/subtype.js';
import { typesOverlap } from '../../../common/type/reduce.js';
import type {
  BoxedValueDefinition,
  Expression,
  Scope,
} from '../../global-types.js';
import type { NumberLiteralInterface } from '../../types-expression.js';
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
import { literalParamsMap, pipeStageAsCall } from '../../library/core.js';
import { colorStringToOklch } from '../../library/colors.js';
import {
  COLORMAP_NAMES,
  readColorGamut,
} from '../../numerics/color-conversion.js';
import {
  Builder,
  elementIndex,
  elementType,
  isSubLane,
  isSubType,
  joinType,
  widensTo,
  lengthValues,
  mapLengths,
  regionsOf,
  sameShape,
  scalarType,
  typeToString,
  type Assigned,
  type HostCall,
  type IRType,
  type Instr,
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
  BIGINT_LANE,
  decline,
  handlerAnswer,
  hasOwnLowering,
  hasUnsettledShape,
  isUntyped,
  LANE_MISMATCH,
  POSSIBLE_NOTHING,
  type DeclineReason,
  STATIC_TYPE_ERROR,
  text,
  TUPLE_RULES,
  UNSETTLED_SHAPE,
  UntypedInputs,
  userBinding,
  type Binding,
  type Fn,
  type Frame,
  type Lowering,
  type Source,
} from './lower-context.js';
import { toBigint } from '../../boxed-expression/numerics.js';
import {
  listLowering,
  literalList,
  operatorLiteral,
  parameterName,
} from './lower-lists.js';
import { SCALARIZE_LIMIT } from './passes.js';
import {
  characters,
  checkTextDomains,
  colorToString,
  isTextRow,
  patternReplace,
  textOrder,
} from './lower-strings.js';
import {
  CONTROL_FLOW_HEADS,
  MAX_FOLD_EXPANDED_NODES,
  OVERRIDABLE_CONTROL_FLOW_HEADS,
} from '../compiler-tables.js';
import {
  integralClosedForm,
  intervalQuadratureRefusal,
  intervalQuadratureSize,
} from '../interval-quadrature.js';
import { derivativeClosedForm } from '../derivative-closed-form.js';
import { logSpaceProduct } from '../../symbolic/log-space-product.js';
import { withVarsValuesHidden } from '../vars-inputs.js';
import { prefersJetDerivative } from '../jet-derivative.js';
import {
  functionLowering,
  inputType,
  rowsElementLane,
  tupleAxis,
  tupleOrInputType,
  tupleParts,
} from './lower-functions.js';
import {
  COLLECTION,
  enclosureInput,
  enclosureLowering,
  enclosureRefusal,
  isEnclosureCollection,
  isEnclosureNode,
} from './lower-enclosure.js';
import { MATRIX_HEADS, matrixLowering } from './lower-matrices.js';

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
  'Repeat',
  'Iterate',
  // The list operators (`lists.collection()`, and `At` of `First`, ...).
  'First',
  'Second',
  'Third',
  'Last',
  'Count',
  'IsEmpty',
  'Rest',
  'Most',
  'Reverse',
  'Take',
  'Drop',
  'RotateLeft',
  'RotateRight',
  'Mean',
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
  'Median',
  'Mode',
  'Quartiles',
  'InterquartileRange',
  'Skewness',
  'Kurtosis',
  'Covariance',
  'PopulationCovariance',
  'Correlation',
  'Sort',
  'Ordering',
  'Unique',
  'Any',
  'All',
  'Contains',
  'IndexOf',
  'Dot',
  'Norm',
  // The list operators of CE-1531 (`lists.collection()`); not
  // `Element`, a clause of a `Comprehension` too, nor `RandomSample`, a
  // draw: a node that holds one is not closed, and is not evaluated at
  // compile time.
  'Append',
  'DeleteAt',
  'Insert',
  'Slice',
  'Linspace',
  'Chunk',
  'Partition',
  'TakeWhile',
  'DropWhile',
  'FlatMap',
  'Scan',
  'Tabulate',
  'Identity',
  'CountIf',
  'Find',
  'IndexWhere',
  'Position',
  'ArgMax',
  'ArgMin',
  'MaxBy',
  'MinBy',
  'ApplyWhole',
  'StartsWith',
  'EndsWith',
  'ContainsSequence',
  // The matrix operators (`matrices.matrix()`).
  ...MATRIX_HEADS,
]);
/** The heads of a body of draws over literals that a held value folds
 *  under a number as the seed (`seededConstant()`; CE-1524, option (a)). */
const SEEDED_CONSTANT_HEADS = new Set([
  'Random',
  'RandomChoice',
  'RandomSample',
  'List',
  'Range',
  'Interval',
  'Open',
  'Tuple',
]);
/** `x` is a list, at any depth, of finite real numbers. */
const finiteReals = (x: Expression): boolean =>
  isFunction(x, 'List') &&
  x.ops.every(
    (op) =>
      finiteReals(op) || (isNumber(op) && op.im === 0 && Number.isFinite(op.re))
  );
/** The colour conversions, which read a tuple of three numbers as sRGB. */
const COLOR_CONVERSIONS = new Set([
  'AsRgb',
  'AsHsl',
  'AsHsv',
  'AsOklab',
  'AsOklch',
]);
/** The operations of the colour lane whose interpreter value is a colour of
 *  the space they name (a constructor, a conversion), an `Oklch`
 *  (`ColorMix`, `Colormap`) or an `Rgb` (`GamutMap`, `ContrastingColor` of a
 *  background alone): not the head of a candidate, as `ContrastingColor` of
 *  three colours answers. `AsHsv` and `AsHsl` read the space from these. */
const COLOR_SAFE = new Set([
  'rgb',
  'hsl',
  'hsv',
  'oklab',
  'oklch',
  'asrgb',
  'ashsl',
  'ashsv',
  'ashsl.own',
  'ashsv.own',
  'asoklab',
  'asoklch',
  'colormix',
  'contrastingcolor.bw',
  'gamutmap',
  'gamutmap.p3',
  'colormap',
]);
/** The space of the colour that an operation of three channels makes: a
 *  constructor, or the own-space conversion of one (`ashsv.own`). */
const CHANNEL_SPACES: Readonly<Record<string, string>> = Object.freeze({
  'rgb': 'rgb',
  'hsl': 'hsl',
  'hsv': 'hsv',
  'oklab': 'oklab',
  'oklch': 'oklch',
  'ashsl.own': 'hsl',
  'ashsv.own': 'hsv',
});
/** The space that each conversion of one colour names. */
const CONVERSION_SPACES: Readonly<Record<string, string>> = Object.freeze({
  asrgb: 'rgb',
  ashsl: 'hsl',
  ashsv: 'hsv',
  asoklab: 'oklab',
  asoklch: 'oklch',
});
/** The number of leading operands of a colour operator that are colours,
 *  which a tuple of three numbers can stand for (`extractRgb()` of
 *  `library/colors.ts`). */
const COLOR_OPERANDS: ReadonlyMap<string, number> = new Map([
  ...[...COLOR_CONVERSIONS].map((h): [string, number] => [h, 1]),
  ['ColorMix', 2],
  ['ColorContrast', 2],
  ['ColorDelta', 2],
  ['ContrastingColor', 3],
  ['GamutMap', 1],
  ['ColorToColorspace', 1],
]);
/** The colour operands of the row `r` (`COLOR_OPERANDS`). */
const colorOperands = (r: OperatorRow): number =>
  COLOR_OPERANDS.get(r.head ?? '') ?? 0;
const LOOPS = new Set([
  'Map',
  'Filter',
  'Reduce',
  'Range',
  'Loop',
  'ParallelLoop',
  'Comprehension',
  'Repeat',
  'Iterate',
  'Scan',
  'Tabulate',
  'FlatMap',
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
  /** A host's `compile` handler answers for a node of it (`handled()`). */
  answered: boolean;
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
 *  a `Sum` or a `Product` of more passes than it is NaN (a list of NaN of
 *  the term's length for a list term). */
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
  /** Called when a sum or a short list starts an attempt to be written
   *  out (`sliceProgram()` lowers the loops again only after one). */
  readonly attempted?: () => void;
  /** JavaScript, not the interval mode: the numeric derivative of a
   *  derivative with no closed form, and the closed form of a definite
   *  integral in place of the quadrature. */
  readonly javascript?: boolean;
};

/** The IR operation of the read of the `vars` name of index `k` on the
 *  lane `lane`: an effectful operation, spelled as the host's text. */
export const hostVarOp = (k: number, lane: Lane) => `host${k}.${lane}`;

/** The IR operation of a call of the function of the host of index `k`
 *  (`Program.hosts`): an effectful operation, spelled as a call of
 *  `_SYS.hosts[k]`. */
export const hostCallOp = (k: number) => `call.host${k}`;

/** At most this many arguments in a call of a function of the host: the
 *  largest arity of an IR operation. */
const MAX_HOST_ARGUMENTS = 4;

/** A definition that the host gave with `ce.declare()` and an `evaluate`
 *  function: not of the library, not a function literal (`userBinding()`),
 *  not a definition with clauses, not the dispatcher of a protocol method,
 *  and not lazy. */
function isHostDefinition(e: Fn): boolean {
  const def = e.operatorDefinition as
    | {
        evaluate?: unknown;
        lazy?: boolean;
        _standardLibrary?: boolean;
        _isLambda?: boolean;
        _isMultiClause?: boolean;
        _protocolDispatcher?: unknown;
      }
    | undefined;
  return (
    def !== undefined &&
    typeof def.evaluate === 'function' &&
    def.lazy !== true &&
    def._standardLibrary !== true &&
    def._isLambda !== true &&
    def._isMultiClause !== true &&
    def._protocolDispatcher === undefined
  );
}

/** A use of a list local written in place that it cannot have
 *  (`inPlace()` of `lower()`). */
type Misuse = 'write' | 'read' | undefined;
const worse = (a: Misuse, b: Misuse): Misuse =>
  a === 'write' || b === 'write' ? 'write' : (a ?? b);

/** The decline of a real written to a list local written in place whose
 *  integer lane comes from its value (`listWrite()`): `lower()` lowers the
 *  program again with the local of the declaration `declaration` on the
 *  real lane, as the interpreter widens the list. */
class WidenList extends Decline {
  constructor(
    d: Decline,
    readonly declaration: Expression
  ) {
    super(d.node, d.cause, d.head, d.reason);
  }
}

export function lower(
  root: Expression,
  rows: readonly OperatorRow[],
  options: LowerOptions = {}
): Program {
  // Each retry widens one more declaration; past `MAX_WIDENED` (a bound on
  // the retries, each a whole lowering) the program declines.
  const MAX_WIDENED = 16;
  const wide = new Set<Expression>();
  for (;;) {
    try {
      return lowerOnce(root, rows, options, wide);
    } catch (error) {
      if (!(error instanceof WidenList)) throw error;
      if (wide.has(error.declaration) || wide.size >= MAX_WIDENED)
        throw new Decline(error.node, error.cause, error.head, error.reason);
      wide.add(error.declaration);
    }
  }
}

/**
 * `[p, q]` when `e` is a call of the library's `Rational` of two exact integer
 * literals, `q` not 0, in an expression boxed without the canonical form
 * (`form: 'structural'`), else `undefined` (CE-1499). The canonical form makes
 * such a call the exact number `p/q`, and the lowering reads it as that number
 * (`literalNumber()`). A call of a user's `Rational`, of one with a host
 * `compile` handler, or of an operand that is not exact (`1.0`, which the
 * canonical form divides as a float) is not one. No node is rebuilt: a
 * rebuilt ancestor would be bound again in the current scope.
 */
function exactRational(e: Expression): [bigint, bigint] | undefined {
  if (
    e.isCanonical ||
    !isFunction(e, 'Rational') ||
    e.nops !== 2 ||
    !isLibraryOperator(e as never, 'Rational') ||
    hasOwnLowering(e.operator, e.operatorDefinition)
  )
    return undefined;
  const [p, q] = e.ops.map((op) =>
    isNumber(op) && op.isExact && op.isInteger === true ? toBigint(op) : null
  );
  return p !== null && q !== null && q !== 0n ? [p, q] : undefined;
}

/** `x` when it is a number literal; the exact number `p/q` when it is a
 *  structural `Rational(p, q)` (`exactRational()`); else `undefined`. */
function literalNumber(
  x: Expression
): (Expression & NumberLiteralInterface) | undefined {
  if (isNumber(x)) return x;
  const pq = exactRational(x);
  if (pq === undefined) return undefined;
  const n = x.engine.number(pq);
  return isNumber(n) ? n : undefined;
}

/** `lower()` with the list locals of the declarations `wide` on the real
 *  lane. */
function lowerOnce(
  root: Expression,
  rows: readonly OperatorRow[],
  options: LowerOptions,
  wide: ReadonlySet<Expression>
): Program {
  const ce = root.engine;
  const bigint = options.mode === 'bigint';
  const interval = options.mode === 'interval';
  /** `i` changes or reads state by itself: an operation or a region of an
   *  effectful row, or a call of an effectful function. An operation with
   *  no row is effectful, as in `effects.ts`: the call of a function of the
   *  host (`hostCall()`), whose row `sliceProgram()` adds after the
   *  lowering. */
  const effectful = (i: Instr): boolean =>
    i.k === 'op'
      ? (rowOfOp(rows, i.op)?.row.effect ?? 'effectful') === 'effectful'
      : i.k === 'call'
        ? fns.effect(i.fn) === 'effectful'
        : i.k === 'region' && regionRow(i.op)?.effect === 'effectful';
  const b = new Builder(
    (op) => rowOfOp(rows, op)?.row.effect === 'pure',
    effectful,
    (i) =>
      i.k === 'op'
        ? rowOfOp(rows, i.op)?.row.effect !== 'pure'
        : i.k === 'call'
          ? fns.effect(i.fn) !== 'pure'
          : i.k === 'loop' ||
            (i.k === 'region' && regionRow(i.op)?.effect !== 'pure')
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
      ? `${created.has(e) ? 'c' : 'f'}${e.operator}\u001f${definitionKey(e)}\u001f${e.ops.map(idOf).join()}`
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
  // The answers of the host's `compile` handlers, per node of this lowering
  // (`handlerAnswer()`; not of a control-flow head other than `Which`, whose
  // handler is ignored), and the nodes that an answer created (not a
  // node under the operands of a node that a handler was asked about): the
  // library lowers those, with no handler, and the memo of `value()` keys
  // them apart (`idOf()`).
  const answers = new WeakMap<Expression, Expression | string | undefined>();
  const created = new WeakSet<Expression>();
  const authored = new WeakSet<Expression>();
  const author = (x: Expression) => {
    if (!isFunction(x) || authored.has(x)) return;
    authored.add(x);
    x.ops.forEach(author);
  };
  // The size of a node as a tree, up to `MAX_FOLD_EXPANDED_NODES` plus one.
  // A handler can serialize its operands, and a value that shares its nodes
  // has a text of exponential length: no handler is asked about a node
  // above the limit or about a node under one (`unasked`), a value too
  // large to write out.
  const sizes = new WeakMap<Expression, number>();
  const size = (x: Expression): number => {
    if (!isFunction(x)) return 1;
    let n = sizes.get(x);
    if (n !== undefined) return n;
    n = 1;
    for (const op of x.ops)
      n = Math.min(n + size(op), MAX_FOLD_EXPANDED_NODES + 1);
    sizes.set(x, n);
    return n;
  };
  const unasked = new WeakSet<Expression>();
  const refuse = (x: Expression) => {
    if (!isFunction(x) || unasked.has(x)) return;
    unasked.add(x);
    x.ops.forEach(refuse);
  };
  const oversized = (e: Fn): boolean => {
    if (!unasked.has(e) && size(e) > MAX_FOLD_EXPANDED_NODES) refuse(e);
    return unasked.has(e);
  };
  const handled = (e: Fn): Expression | string | undefined => {
    if (
      created.has(e) ||
      (CONTROL_FLOW_HEADS.has(e.operator) &&
        !OVERRIDABLE_CONTROL_FLOW_HEADS.has(e.operator)) ||
      !hasOwnLowering(e.operator, e.operatorDefinition)
    )
      return undefined;
    if (answers.has(e)) return answers.get(e);
    e.ops.forEach(author);
    let r = oversized(e)
      ? `the compile handler of ${e.operator} is not asked about a node of a value of more than ${MAX_FOLD_EXPANDED_NODES} nodes as a tree`
      : handlerAnswer(
          e,
          interval
            ? 'interval-javascript'
            : options.javascript
              ? 'javascript'
              : 'glsl'
        );
    const mark = (x: Expression) => {
      if (x === e)
        r = `the compile handler of ${e.operator} returns an expression that holds its own node`;
      if (!isFunction(x) || x === e || authored.has(x) || created.has(x))
        return;
      created.add(x);
      x.ops.forEach(mark);
    };
    if (typeof r === 'object') mark(r);
    answers.set(e, r);
    return r;
  };
  const inputLengths = new Set<V>();
  // The calls of the program that have each call or each symbol as an
  // operand, with the position of the operand. One boxed expression in two
  // places (`If(IsMissing(r), K, r)`) has one entry for each place. Each
  // node is visited once.
  const readers = new Map<Expression, [reader: Fn, position: number][]>([
    [root, []],
  ]);
  const reach = (e: Expression): void => {
    if (!isFunction(e)) return;
    e.ops.forEach((op, i) => {
      if (!isFunction(op) && !isSymbol(op)) return;
      const known = readers.get(op);
      if (known !== undefined) return void known.push([e, i]);
      readers.set(op, [[e, i]]);
      reach(op);
    });
  };
  reach(root);
  // Whether a list of NaN can stand for the absent list that is the value
  // of the node `e` of the program (`conditional()`): no discharge,
  // `Length` or `Rest` reads that value, which they must see as absent.
  // This holds when each place of `e` in the program is one of these:
  // - the result of the program: the root (the body of a function
  //   literal), an arm of such an `If` or `Which`, the last expression of
  //   such a `Block`;
  // - the list that a `First`, a `Last`, or an `At` whose indexes are
  //   numbers, of the library reads: an element of the list of NaN is NaN
  //   (a point of NaN), the absent value of an element of an absent list;
  // - the list that an `At` with another index (a list, a `Range`) reads,
  //   when the value of that `At`, a list of NaN, is itself in such a
  //   place;
  // - an operand of `Max`, of `Min`, or of a `Sum` or a `Product` with no
  //   index, of the library: the value is one number, NaN where the
  //   interpreter gives `Missing`;
  // - an operand of an operator row of the library (arithmetic, a function
  //   of numbers, a comparison) or the body of a `Sum` or a `Product` with
  //   an index, when the value of that call is itself in such a place: the
  //   call of a list of NaN gives a list too, which the interpreter gives
  //   as `Missing`;
  // - an arm of an `If` or a `Which`, the last expression of a `Block`, or
  //   the value of a `Typed` (a body of a declared result), whose own value
  //   is in such a place;
  // - the body of a user function being lowered, when each call that its IR
  //   function serves is itself in such a place (`bodies`, `call()` of
  //   `lower-functions.ts`); the places in the body are known once a call
  //   of the function is lowered (`reachBody()`);
  // - the value of a name that the program reads (`expression()`), when
  //   each occurrence of that name in the program is itself in such a
  //   place, and no value of another name and no body of a user function
  //   that the program reaches has the name (`heldAsAbsent()`); the places
  //   in the value are known once the value is lowered.
  // Any other place (a binding, an argument of a function, an element of a
  // list or of a tuple, another list operator) can give the value to a
  // reader that tells an absent list from a list of NaN. Another node that
  // is not in the program (an expression of a compile handler) has no known
  // reader.
  const bodies = new Map<Expression, { nan: () => boolean; read: boolean }>();
  // For each held value that `expression()` lowers, the names that hold it,
  // and whether one of them is read other than by a node of the program
  // (in the value of another name, in an expression of a compile handler).
  const holders = new Map<Expression, { names: Set<string>; other: boolean }>();
  // The names that a value or a body that the program reaches has
  // (`calledNames()`), found once.
  let namesReached: Set<string> | undefined;
  const heldAsAbsent = (h: { names: Set<string>; other: boolean }) => {
    if (h.other) return false;
    namesReached ??= calledNames(root);
    const elsewhere = namesReached;
    return [...h.names].every(
      (n) =>
        !elsewhere.has(n) &&
        [...readers.keys()].every((x) => !isSymbol(x, n) || nanForAbsent(x))
    );
  };
  // The nodes whose value is a list of NaN for an absent list
  // (`conditional()`), checked again when a held value adds places
  // (`expression()`).
  const nanAccepted = new Set<Expression>();
  const declineNanList = (node: Expression): never =>
    decline(
      node,
      'an If with no else of a list arm whose value is read by other than At, First, Last, an arithmetic operator or a reduction'
    );
  const reached = new Set<Expression>();
  // A body adds places to the nodes that it shares with the program.
  const reachBody = (body: Expression) => {
    if (reached.has(body)) return;
    reached.add(body);
    reach(body);
    unreadAsAbsent.clear();
  };
  // A value found while a body is lowered can depend on `bodies`, and is
  // not kept; one found with no body lowered is the same or `false` there.
  const unreadAsAbsent = new Map<Expression, boolean>();
  const nanForAbsent = (e: Expression): boolean => {
    const body = bodies.get(e);
    if (body !== undefined) {
      body.read = true;
      if (!body.nan()) return false;
    }
    let known = body === undefined ? unreadAsAbsent.get(e) : undefined;
    if (known !== undefined) return known;
    const h = holders.get(e);
    known =
      (readers.get(e) ?? (body || h ? [] : undefined))?.every(([reader, i]) => {
        if (reader === root && reader.operator === 'Function') return i === 0;
        if (!isLibrary(reader)) return false;
        switch (reader.operator) {
          case 'If':
            return i > 0 && nanForAbsent(reader);
          case 'Which':
            return i % 2 === 1 && nanForAbsent(reader);
          case 'Block':
            return i === reader.nops - 1 && nanForAbsent(reader);
          case 'Typed':
            return i === 0 && nanForAbsent(reader);
          case 'At':
            // An index that is not proved a number can be a list or a
            // `Range`: the `At` then gives a list of NaN.
            return (
              i === 0 &&
              (reader.ops
                .slice(1)
                .every((k) => isSubtype(k.type.type, 'number')) ||
                nanForAbsent(reader))
            );
          case 'First':
          case 'Last':
            return i === 0;
        }
        const reduction = REDUCTIONS.get(reader.operator);
        if (reduction !== undefined && !(reduction.indexed && reader.nops > 1))
          return true;
        return (
          (reduction !== undefined ? i === 0 : rowNode(reader) !== undefined) &&
          nanForAbsent(reader)
        );
      }) ?? false;
    if (h !== undefined && !heldAsAbsent(h)) known = false;
    if (bodies.size === 0) unreadAsAbsent.set(e, known);
    return known;
  };
  // The names read as inputs of the compilation (of the entry, lifted into
  // a body, `vars`), in the order the lowering reads them, and those that an
  // occurrence or a declaration types (`program()`).
  const seen = new Set<string>();
  const typed = new Set<string>();
  // The type of each of these names for the report (`Program.inputs`), in
  // the order the entry first reads them (a name read in a function body at
  // the call, `free()`): the type of the first binding `def` read at the
  // entry that declares it (a body reads its own binding, which the entry
  // does not give), else the type that the lowering gives the input
  // (`given()`).
  const inputs = new Map<string, { type: Type; declared: boolean }>();
  const note = (name: string, t: Type, def?: BoxedValueDefinition) => {
    seen.add(name);
    if (!isUntyped(t)) typed.add(name);
    if (inputs.get(name)?.declared === true || cx.inFunction !== undefined)
      return;
    if (def !== undefined && !def.inferredType)
      inputs.set(name, { type: def.type.type, declared: true });
  };
  const given = (name: string, t: Type) => {
    if (inputs.get(name)?.declared !== true && cx.inFunction === undefined)
      inputs.set(name, { type: t, declared: false });
  };
  // The root `Tuple`, or the last operand of a root `Block` that is one.
  let rootTuple: Expression | undefined = root;
  while (isFunction(rootTuple, 'Block')) rootTuple = rootTuple.ops.at(-1);
  if (!isFunction(rootTuple, 'Tuple')) rootTuple = undefined;
  let rootParts: V[] | undefined;
  const tuples = new Map<V, number>();
  /** The inputs and the parameters of the lane `rows` (a list of lists of
   *  two lengths not stated, `rowsElementLane()`), and the occurrence of a
   *  name that `wholeRows()` lowers, the only one that may read one. */
  const rowsParams = new Set<V>();
  let rowsRead: Expression | undefined;
  /** The count of the elements of a row `At(g, i)` of such a name at an
   *  index known at run time (0 where `i` is out of range), and the value
   *  of `Length` of the row (NaN there, the interpreter's `Missing`). */
  const rowLengths = new Map<V, V>();
  /** The value of `Length` of a row in `rowLengths`, NaN where it is
   *  absent, or `undefined` for another value. */
  const rowLength = (v: V): V | undefined => {
    const n = type(v).shape[0];
    return n === undefined || typeof n === 'number'
      ? undefined
      : rowLengths.get(n.v);
  };
  /** The value that stands for a tuple input read part by part
   *  (`tupleParts()`, `input()`), which has no value of its own, and the
   *  occurrence of its name that a part read (`At`) lowers, the only one
   *  that may read it. */
  const partsInputs = new Set<V>();
  let partsRead: Expression | undefined;
  const partsDecline = (e: Expression, name: string): never =>
    decline(
      e,
      `${name}, a tuple whose parts have different lanes, other than in a read of a part at a constant index`
    );
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
   *  constant, an input whose declared type is ranged at or above 0
   *  (`b.signs`; an assumption does not change a type), the run-time
   *  length of an input list (`inputLengths`), an operation whose
   *  value is nonnegative (`abs`, `exp`, an even power), a sum or a product
   *  of such values.
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
    if (!enclosed && (b.signs.has(v) || inputLengths.has(v))) return true;
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
    userBinding(e) === undefined &&
    isLibraryOperator(e as never, e.operator) &&
    handled(e) === undefined;

  /** The names that the pattern `p` of a `Declare` or of a `Loop` index
   *  binds: `p` itself, or the names in a `Tuple` of patterns; `_` binds
   *  nothing. */
  const patternNames = (p: Expression): string[] =>
    isSymbol(p)
      ? p.symbol === '_'
        ? []
        : [p.symbol]
      : isFunction(p, 'Tuple')
        ? p.ops.flatMap(patternNames)
        : [];

  const facts = (e: Expression): Facts => {
    const none = new Set<string>();
    const leaf = (names: Set<string>, slice: boolean): Facts => ({
      names,
      writes: none,
      loop: false,
      slice,
      size: 1,
      answered: false,
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
    oversized(e);
    const h = e.operator;
    const user = userBinding(e) !== undefined;
    const library = !user && isLibraryOperator(e as never, h);
    const answer = user ? undefined : handled(e);
    const info: Facts = {
      names: new Set(),
      writes: new Set(),
      loop:
        user ||
        LOOPS.has(h) ||
        (REDUCTIONS.get(h)?.indexed === true && isFunction(e.ops[1], 'Limits')),
      slice:
        library &&
        answer === undefined &&
        !isTextRow(rowOfHead(rows, h), e) &&
        (CONSTRUCTS.has(h) ||
          REDUCTIONS.has(h) ||
          (rowOfHead(rows, h)?.effect ?? 'effectful') !== 'effectful'),
      size: 1,
      answered: answer !== undefined,
    };
    if (h === 'Assign' && isSymbol(e.ops[0])) info.writes.add(e.ops[0].symbol);
    // `(a, b) := …` writes each name; `AddTo(s, e)` writes `s`, and
    // `AddTo(At(L, i), e)` writes `L`.
    if (h === 'Assign' && isFunction(e.ops[0], 'Tuple'))
      for (const x of e.ops[0].ops) if (isSymbol(x)) info.writes.add(x.symbol);
    const sum = h === 'AddTo' ? e.ops[0] : undefined;
    const target = isFunction(sum, 'At') ? sum.ops[0] : sum;
    if (isSymbol(target)) info.writes.add(target.symbol);
    // A handler's answer is read in place of the node (its names, its loops).
    for (const op of typeof answer === 'object' ? [...e.ops, answer] : e.ops) {
      const t = facts(op);
      info.loop ||= t.loop;
      info.slice &&= t.slice;
      info.answered ||= t.answered;
      info.size = Math.min(CLOSED_SIZE + 1, info.size + t.size);
      t.names.forEach((n) => info.names.add(n));
      t.writes.forEach((n) => info.writes.add(n));
    }
    if (h === 'Block')
      for (const op of e.ops)
        if (isFunction(op, 'Declare'))
          for (const n of patternNames(op.ops[0])) info.writes.delete(n);
    known.set(e, info);
    return info;
  };

  /** The operation that makes the colour `x` (`b.defs`), seen through a
   *  conversion of a colour of the space it names, which the interpreter
   *  answers with its operand unchanged: `AsRgb(Rgb(r, g, b))` is the
   *  `rgb` of `r, g, b`. So a constructor written in place and a name whose
   *  value is one are seen alike. `undefined` for a value that no
   *  operation makes (an `If`, a call, a loop value, a parameter). */
  const colorDef = (x: V): (Instr & { k: 'op' }) | undefined => {
    const i = b.defs.get(x);
    const space = i === undefined ? undefined : CONVERSION_SPACES[i.op];
    if (space !== undefined && i!.args.length === 1) {
      const j = colorDef(i!.args[0]);
      if (j?.args.length === 3 && CHANNEL_SPACES[j.op] === space) return j;
    }
    return i;
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
    // `Abs` of a real proved `>= 0` (`nonnegative()`, also by the declared
    // range of an input) is its operand. Not in the interval mode, where a
    // value `>= 0` can have an enclosure that reaches below 0.
    if (
      r.head === 'Abs' &&
      !interval &&
      n === 1 &&
      type(args[0]).shape.length === 0 &&
      (type(args[0]).lane === 'real' || type(args[0]).lane === 'integer') &&
      nonnegative(args[0])
    )
      return args[0];
    // A colour conversion reads a tuple of three numbers as the sRGB colour
    // of its channels (`extractRgb()` of `library/colors.ts`):
    // `AsOklab((1, 0, 0))` is `AsOklab(Rgb(1, 0, 0))`, and so does each of
    // the colours of `ColorMix` and the other colour operators
    // (`COLOR_OPERANDS`). A tuple of four carries an alpha, which `Rgb` here
    // does not, and declines below.
    const colors = colorOperands(r);
    const channels = (v: V, i: number) =>
      i < colors &&
      tuples.get(v) === 0 &&
      same(type(v).shape, [3]) &&
      ['real', 'integer'].includes(type(v).lane);
    if (args.some(channels))
      return apply(
        node,
        r,
        args.map((v, i) =>
          channels(v, i)
            ? apply(
                node,
                'Rgb',
                [1, 2, 3].map((k) =>
                  apply(node, 'At', [v, b.constant(k, 'integer')])
                )
              )
            : v
        )
      );
    // A product of a list of rank 2 or more with another list, and a power
    // of such a list, are the matrix product and power of the interpreter
    // (`M·N`, `M·L`, `M^s` at an integer `s`), not element by element.
    // A list of points is not a matrix: its product and its power are
    // point by point.
    const rank = (v: V) => type(v).shape.length;
    if (
      (r.head === 'Multiply' &&
        args.some((v) => rank(v) > 1 && tuples.get(v) !== 1) &&
        args.filter((v) => rank(v) > 0).length > 1) ||
      (r.head === 'Power' && rank(args[0]) > 1 && tuples.get(args[0]) !== 1)
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
    // A colour constructor reads the real part of a complex channel, as the
    // interpreter does (`.re` in `library/colors.ts`): `Hsv(Sqrt(z), 1, 1)`
    // of the `complex` mode is `Hsv(Real(Sqrt(z)), 1, 1)`.
    if (
      CHANNEL_SPACES[r.signatures[0][2]] !== undefined &&
      args.some((v) => type(v).lane === 'complex')
    )
      return apply(
        node,
        r,
        args.map((v) =>
          type(v).lane === 'complex' ? apply(node, 'Real', [v]) : v
        )
      );
    const complex = leaves(r, args, node);
    const operation = (given: V[]): V => {
      // Two booleans, and two lists or two tuples of real numbers, have one
      // equality (`equality()`); `NotEqual` is its negation.
      if ((r.head === 'Equal' || r.head === 'NotEqual') && given.length === 2) {
        const equal = equality(node, given[0], given[1]);
        if (equal !== undefined)
          return r.head === 'Equal' ? equal : apply(node, 'Not', [equal]);
      }
      // A tuple operand: only a row whose value on a tuple is its value on
      // the list of the same elements (`TUPLE_RULES`).
      const tuple = given.find((v) => tuples.has(v));
      if (tuple !== undefined && colorOperands(r) > 0)
        decline(
          node,
          tuples.get(tuple) === 1
            ? `${r.head} of a list of tuples (a colour from a tuple compiles from one tuple of three real numbers only)`
            : `${r.head} of a tuple that is not three real numbers (a colour from a tuple compiles from three sRGB channels only)`
        );
      if (tuple !== undefined) {
        // `div.q`, the division by the denominator of a rational factor,
        // reads a tuple dividend as `Divide` does. A colour conversion of a
        // tuple of three numbers was read as a colour above; any other tuple
        // declines.
        const rule =
          TUPLE_RULES[
            r.signatures[0][2] === 'div.q' ? 'Divide' : (r.head ?? '')
          ] ??
          (r.arity === 1 && r.threads && r.signatures[0][0][0] !== 'color'
            ? 'each'
            : undefined);
        // A list of points with a point (`all`), scaled by a list of
        // numbers (`scale`), or under `norm`: point by point. A point scaled
        // by a list of numbers (divided by one, as the dividend) is the list
        // of the points that each element scales, as the interpreter gives
        // it.
        if (
          (given.some((v) => tuples.get(v) === 1) &&
            (rule === 'norm' ||
              (rule === 'all' && given.some((v) => tuples.get(v) === 0)) ||
              (rule === 'scale' && given.some((v) => numbers(v))))) ||
          (rule === 'scale' &&
            given.some((v) => numbers(v)) &&
            ((r.head !== 'Divide' && r.signatures[0][2] !== 'div.q') ||
              tuples.get(given[0]) === 0))
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
      // `Equal` and `NotEqual` of two lists compare the lists in the
      // interpreter (one boolean); of a list and a scalar they thread. The
      // two lists that `equality()` does not compare decline.
      if (
        (r.head === 'Equal' || r.head === 'NotEqual') &&
        types.filter((t) => t.shape.length > 0).length > 1
      )
        decline(node, `${r.head} of a list`);
      const signature = signatureOf(r, types, complex, bigint);
      if (signature === undefined)
        decline(
          node,
          !r.threads && types.some((t) => t.shape.length > 0)
            ? `${r.head} of a list`
            : `${r.head} of ${types.map((t) => typeToString(t, -1)).join(', ')}${bigint ? ', whose value is not an integer (the bigint mode)' : ''}`,
          // A row off the integer lane: the bigint mode refuses it.
          bigint && signatureOf(r, types, complex, false) !== undefined
            ? BIGINT_LANE
            : undefined
        );
      // An integer power is an integer for an exponent proved `>= 0`
      // only (`n^m` is a rational at `m < 0`).
      const j = r.leaves?.integer;
      if (bigint && j !== undefined && !nonnegative(given[j]))
        decline(
          node,
          `${r.head} of an exponent that is not proved nonnegative, whose value can be a rational (the bigint mode)`,
          BIGINT_LANE
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

  /** `Equal(x, y)` of two booleans, and of two lists or two tuples of real
   *  numbers, which the row of `Equal` does not compare; `undefined` for
   *  any other pair, which `apply()` gives to the row or declines.
   *
   *  Two booleans are equal when both hold or neither does; a list of
   *  booleans and a boolean thread, as `And`, `Or` and `Not` do.
   *
   *  Two lists, or two tuples, of real numbers are compared as the
   *  interpreter compares them: one boolean, true when they have the same
   *  length and each element equals the element at its index, with the
   *  equality of two numbers (no tolerance, and NaN equals nothing). Not
   *  compared here: a tuple and a list (the interpreter gives `False`,
   *  whatever the elements), lists of lists or of tuples, and elements
   *  that are booleans, complex numbers, strings or colours. */
  const equality = (node: Expression, x: V, y: V): V | undefined => {
    const [s, t] = [type(x), type(y)];
    if (s.shape.length === 0 || t.shape.length === 0) {
      if (
        s.lane !== 'boolean' ||
        t.lane !== 'boolean' ||
        tuples.has(x) ||
        tuples.has(y)
      )
        return undefined;
      const not = (v: V) => apply(node, 'Not', [v]);
      return apply(node, 'Or', [
        apply(node, 'And', [x, y]),
        apply(node, 'And', [not(x), not(y)]),
      ]);
    }
    if (
      !isFunction(node) ||
      tuples.get(x) !== tuples.get(y) ||
      s.shape.length !== 1 ||
      t.shape.length !== 1 ||
      !isSubLane(s.lane, 'real') ||
      !isSubLane(t.lane, 'real')
    )
      return undefined;
    const [p, q] = [lists.listSource(x), lists.listSource(y)];
    const [n, m] = [constant(p.length), constant(q.length)];
    const stated = n !== undefined && m !== undefined;
    if (stated && n !== m) return b.constant(false, 'boolean');
    // Lists of run-time lengths: the elements up to the shorter one, and
    // the test of the lengths.
    const length = stated ? p.length : apply(node, 'Min', [p.length, q.length]);
    const all = lists.reduce(
      node,
      rowOfHead(rows, 'And')!,
      [{ length, at: (k) => apply(node, 'Equal', [p.at(k), q.at(k)]) }],
      b.constant(true, 'boolean'),
      undefined,
      true
    );
    return stated
      ? all
      : apply(node, 'And', [apply(node, 'Equal', [p.length, q.length]), all]);
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
   *  them (of one shape; on a target without run-time lengths, GLSL, the
   *  list written out through `lists.over()`, a `Map`), which reads their
   *  element at each index, and so
   *  under `Multiply` and `Divide` the element of a list of numbers of their
   *  length; a point and a scalar are read as they are. As in
   *  `resultType()`, a run-time length of the outer axis fits any length:
   *  two different lengths are an error of the interpreter that the static
   *  type does not show, and the build has the length of the first list of
   *  points. With no list of points (a point scaled by a list of numbers),
   *  the build is over the first list of numbers. */
  const eachPoint = (
    node: Expression,
    head: string,
    given: V[],
    f: (xs: V[]) => V
  ): V => {
    const first =
      given.find((v) => tuples.get(v) === 1) ?? given.find((v) => numbers(v))!;
    const shape = type(first).shape;
    const known = (x: Length) => (typeof x === 'number' ? x : constant(x.v));
    const fits = (
      [n, ...rest]: readonly Length[],
      [m, ...inner]: readonly Length[]
    ) =>
      same(rest, inner) &&
      (known(n) === undefined ||
        known(m) === undefined ||
        known(n) === known(m));
    for (const v of given) {
      const t = type(v);
      if (
        t.shape.length > 0 &&
        !(tuples.get(v) === 0 && t.shape.length === 1) &&
        !(tuples.get(v) === 1 && fits(t.shape, shape)) &&
        !(
          TUPLE_RULES[head] === 'scale' &&
          numbers(v) &&
          fits(t.shape, shape.slice(0, 1))
        )
      )
        decline(
          node,
          `${head} of a list of points and a value of another shape`
        );
    }
    const point = (k: V) =>
      f(
        given.map((v) =>
          tuples.get(v) === 1 || numbers(v) ? lists.listSource(v).at(k) : v
        )
      );
    const length = lists.listSource(first).length;
    // A target with no run-time length (GLSL) writes out a list of points
    // of a constant length, as a `Map` over it: the result is the list of
    // the values at each point, and the list of points is left to `dce`.
    if (options.runtimeLengths === false && isFunction(node))
      return lists.over(
        node,
        { length, at: (k) => k },
        '',
        (_x, k) => point(k),
        false,
        node
      );
    const k = b.newValue(scalarType('integer'));
    return region('build', [length], [k], () => [point(k)], node)[0];
  };

  /** `At(l, i)` of a list or a tuple `l` and a scalar index `i`. */
  const at = (e: Expression, l: V, i: V): V => {
    const t = type(l);
    const [n, k] = [t.shape[0], constant(i)];
    const flat = t.shape.length === 1 && !tuples.has(l);
    const points = tuples.get(l) === 1 && t.shape.length === 2;
    // Out of range, the interpreter gives NaN for a number or a complex
    // value, a point of NaN for a point and `Missing` for a boolean or a
    // list. On JavaScript, of booleans `atu` gives `undefined` and of real
    // points `atp` a point of NaN, the absent values of
    // `docs/COMPILATION-MODEL.md`; the other kinds decline (a read of an
    // absent row must not fail, and no program of Tycho's corpus reads
    // one), as do GLSL, the interval mode and the bigint mode. The `fold`
    // pass makes a constant index in range an element (of colours,
    // `admits()` declines the rest).
    if (
      (t.lane === 'boolean' || t.lane === 'complex' || t.shape.length > 1) &&
      !(
        typeof n === 'number' &&
        k !== undefined &&
        Number.isInteger(k) &&
        k !== 0 &&
        Math.abs(k) <= n
      )
    ) {
      const reals = points && isSubLane(t.lane, 'real');
      const booleans = flat && t.lane === 'boolean';
      if (!options.javascript || bigint || !(reals || booleans))
        decline(
          e,
          'an index that can be out of range, of a list of booleans, of complex numbers or of lists'
        );
      if (reals)
        return apply(e, ofOp('atp'), [
          l,
          i,
          b.constant(t.shape[1] as number, 'integer'),
        ]);
      return apply(e, ofOp('atu'), [l, i]);
    }
    // Of strings on JavaScript (CE-1556): at a constant index in range of
    // a constant length the element (`text.elem`), else `text.at`, whose
    // `undefined` out of range only a discharge or the result reads
    // (`stringListRefusal()` of `index.ts`).
    if (flat && t.lane === 'string' && options.javascript && !bigint) {
      const j = elementIndex(n, k);
      return j === undefined
        ? apply(e, ofOp('text.at'), [l, i])
        : apply(e, ofOp('text.elem'), [l, b.constant(j, 'integer')]);
    }
    return apply(e, 'At', [l, i]);
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
        `a ${lane} value: the bigint mode computes integers and booleans only`,
        BIGINT_LANE
      );
    if (lane === 'string' && (!options.javascript || bigint))
      decline(e, 'a string: text compiles on javascript only');
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

  /** The value of `e`, where a name of the lane `rows` may be read whole
   *  (`symbol()`). */
  const wholeRows = (e: Expression): V => {
    rowsRead = e;
    try {
      return value(e)!;
    } finally {
      rowsRead = undefined;
    }
  };

  let lowered = 0;
  const node = (e: Expression, want: boolean): V | undefined => {
    if (++lowered > NODE_LIMIT)
      decline(root, `more than ${NODE_LIMIT} nodes to lower`);
    // A number literal, or a structural `Rational(p, q)` of the library: the
    // number `p/q` (`exactRational()`, CE-1499).
    const n = literalNumber(e);
    if (n !== undefined)
      return (
        number(n, interval ? literalUlps(n.numericValue) : undefined) ??
        decline(e, 'a complex number with an infinite part')
      );
    if (isSymbol(e)) return symbol(e, want);
    if (isString(e)) return b.constant(e.string, 'string');
    if (!isFunction(e)) decline(e, 'not a number, a symbol or a function');
    // An invalid sub-expression (`Sin(Tuple(w))` of a vector `w`): the
    // interpreter has no value for it.
    if (e.operator !== 'Error' && e.type.type === 'error')
      decline(
        e,
        'a sub-expression of the static type error (an error of the canonical form)',
        STATIC_TYPE_ERROR
      );
    if (options.vars?.includes(e.operator) === true)
      decline(e, `a call of the vars name ${e.operator}`);
    // The interval mode: a pure node whose type is the value `true` or
    // `false` (`Equal(x, x)`, `(x + 1)^2 < 0` of a real `x`) is that
    // verdict, the rule of the earlier interval target.
    const claim = e.type.type;
    if (interval && typeof claim === 'object' && claim.kind === 'value')
      if (typeof claim.value === 'boolean' && e.isPure === true)
        return b.constant(claim.value, 'boolean');
    const user = userBinding(e);
    // The value kind `enclosure`: a call that the kind cannot lower
    // declines (`enclosureRefusal()`).
    if (interval) {
      const refused = enclosureRefusal(
        e,
        user !== undefined ||
          fns.recursive(e) ||
          (!created.has(e) && hasOwnLowering(e.operator, e.operatorDefinition))
      );
      if (refused !== undefined) decline(e, refused);
    }
    if (user !== undefined || fns.recursive(e)) {
      if (user !== undefined) reachBody(user.literal.ops[0]);
      return fns.call(e, user, undefined, () => nanForAbsent(e));
    }
    // A host's handler (of a library head, or of a host operator): its
    // expression is lowered in place of `e`.
    const answer = handled(e);
    if (typeof answer === 'string') decline(e, answer);
    if (answer !== undefined) return value(answer, want);
    // A closed form is computed with the library's operators.
    if ((e.operator === 'D' || e.operator === 'Integrate') && facts(e).answered)
      decline(e, `${e.operator} of an operator that a compile handler lowers`);
    if (!isLibraryOperator(e as never, e.operator)) {
      if (isHostDefinition(e)) return hostCall(e, want);
      decline(
        e,
        e.operatorDefinition === undefined && e.valueDefinition === undefined
          ? `${e.operator} is an unknown operator (no definition)`
          : `${e.operator} is not the library operator here (a user definition)`
      );
    }
    // The value kind `enclosure` (`lower-enclosure.ts`): a collection of
    // enclosures declines; a node that may read or make one is lowered by
    // the kind, before a closed node is evaluated.
    if (interval && isEnclosureCollection(e.type.type)) decline(e, COLLECTION);
    if (interval && isEnclosureNode(e)) return enclosures(e);
    checkTextDomains(e);
    const closed = closedValue(e);
    if (closed !== undefined) return closed;
    switch (e.operator) {
      case 'If':
        // `If(c, a, b)` of a list condition is `Which(c, a, True, b)`, as
        // in the interpreter: a selection at each position.
        // With no `else`, the interpreter restricts a list arm to the mask
        // (`evaluateRestriction()`: the shorter of the two lengths), and
        // selects a scalar or a point arm at each position; NaN, or a point
        // of NaN, where the condition does not hold.
        if (mask(e.ops[0])) return select(e, [[e.ops[0], e.ops[1]]], e.ops[2]);
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
        // A list condition before a clause `True`: a selection at each
        // position (`select()`); the clauses after `True` are not read.
        const dflt = clauses.findIndex(([c]) => isSymbol(c, 'True'));
        const reached = dflt < 0 ? clauses : clauses.slice(0, dflt);
        if (reached.some(([c]) => mask(c)))
          return select(e, reached, dflt < 0 ? undefined : clauses[dflt][1]);
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
        // A point of NaN coordinates is the absent point: the written
        // `Missing` as a coordinate is not (`IsMissing(Tuple(Missing,
        // Missing))` is False).
        if (e.ops.some((op) => isSymbol(op, 'Missing')))
          decline(e, 'Missing as a coordinate of a tuple');
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
      case 'Join':
        return lists.joinLists(e);
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
      case 'ReplaceAt':
        return replaceAt(e);
      case 'At': {
        if (e.nops !== 2) decline(e, 'At with an index for each level');
        // An element of a list of rows whose lengths can differ (an input
        // or a parameter of the lane `rows`): `At(At(g, i), j)`, NaN where
        // an index is out of range of the list or of its row, as `At` of a
        // number.
        const outer = e.ops[0];
        const lane = isFunction(outer, 'At')
          ? rowsElementLane(outer.ops[0]?.type.type)
          : undefined;
        if (
          lane !== undefined &&
          isFunction(outer, 'At') &&
          outer.nops === 2 &&
          isSymbol(outer.ops[0])
        ) {
          const g = wholeRows(outer.ops[0]);
          if (type(g).lane === 'rows') {
            const [i, j] = [scalar(outer.ops[1]), scalar(e.ops[1])];
            if (!isSubLane(type(i).lane, 'real'))
              decline(outer.ops[1], 'an index that is not a number');
            if (!isSubLane(type(j).lane, 'real'))
              decline(e.ops[1], 'an index that is not a number');
            return b.op(
              lane === 'integer' ? 'rows.at.int' : 'rows.at',
              [g, i, j],
              scalarType(lane)
            );
          }
        }
        // The first read of a tuple input read part by part makes its
        // binding (`input()`).
        if (
          isSymbol(e.ops[0]) &&
          lookup(e.ops[0].symbol) === undefined &&
          tupleParts(e.ops[0].type.type, cx.wide) !== undefined
        ) {
          partsRead = e.ops[0];
          symbol(e.ops[0], true);
        }
        // A read of a list local written in place: in order with its writes.
        const owned = isSymbol(e.ops[0]) ? lookup(e.ops[0].symbol) : undefined;
        // An element of a tuple of tuples (`loop()`), or a part of a tuple
        // input read part by part: a constant index.
        const parts = owned?.binding.parts;
        if (parts !== undefined) {
          const what =
            owned!.binding.role === 'input'
              ? 'a tuple whose parts have different lanes'
              : 'a tuple of tuples';
          const j = e.ops[1].re;
          if (!isNumber(e.ops[1]) || !Number.isInteger(j))
            decline(e, `At of ${what} at an index that is not a constant`);
          const x = parts[j > 0 ? j - 1 : parts.length + j];
          if (x === undefined)
            decline(e, `At of ${what} at an index out of range`);
          return x;
        }
        if (owned?.binding.role === 'list') {
          const l = owned.binding.v;
          const i = scalar(e.ops[1]);
          if (!isSubLane(type(i).lane, 'real'))
            decline(e.ops[1], 'an index that is not a number');
          return b.op(
            type(l).lane === 'boolean' ? 'getatu' : 'getat',
            [l, i],
            elementType(type(l))
          );
        }
        // An element of an `Iterate`: the elements up to the index.
        if (lists.isIterate(e.ops[0])) {
          const i = scalar(e.ops[1]);
          return at(e, lists.iterateTo(e, e.ops[0], i), i);
        }
        const effects = b.effects;
        // A row of a `Chunk` or a `Partition` whose rows can have different
        // lengths (`lists.chunks()`): at a constant index in range of a
        // constant count only. Of an input or a parameter of the lane
        // `rows`, also at another index (`row()`), where `Length` of the
        // row is NaN out of range (`rowLengths`).
        const rows = lists.chunks(e.ops[0]);
        if (rows !== undefined && typeof rows !== 'number') {
          const s = rows.source();
          const i = scalar(e.ops[1]);
          const k = elementIndex(constant(s.length), constant(i));
          if (k !== undefined)
            return rows.groups?.[k] ?? s.at(b.constant(k, 'integer'));
          if (rows.row === undefined)
            decline(
              e,
              'At of a Chunk or a Partition whose rows can have different lengths, at an index other than a constant in range of a constant count'
            );
          if (!isSubLane(type(i).lane, 'real'))
            decline(e.ops[1], 'an index that is not a number');
          const r = rows.row(i);
          const n = type(r.row).shape[0];
          if (typeof n !== 'number') rowLengths.set(n.v, r.length);
          return r.row;
        }
        const [l, i] = [rows ?? value(e.ops[0])!, value(e.ops[1])!];
        const t = type(l);
        // A list of indexes into a list of numbers: the list of the `At` of
        // each index, as the interpreter's.
        const flat = (v: V) => type(v).shape.length === 1 && !tuples.has(v);
        // A boolean mask over a list of numbers or of points: a filter up to
        // the shorter of the two lengths. The interpreter reads a lazy base
        // at the kept positions only, so an effect declines.
        const points = tuples.get(l) === 1 && t.shape.length === 2;
        if (
          flat(i) &&
          type(i).lane === 'boolean' &&
          (flat(l) || points) &&
          isSubLane(t.lane, 'real')
        ) {
          if (b.effects > effects)
            decline(e, 'a mask or a base of a mask with an effect');
          return lists.mask(e, l, i);
        }
        // Of a list of points, each `At` is the point or a point of NaN
        // (`at()`), as `Map(k ↦ At(P, k), I)` is. A list of booleans
        // declines: an index out of range would put `undefined` in it.
        if (
          flat(i) &&
          (flat(l) || points) &&
          isSubLane(t.lane, 'real') &&
          isSubLane(type(i).lane, 'real')
        )
          return lists.over(
            e,
            lists.listSource(i),
            '',
            (x) => at(e, l, x),
            false,
            e
          );
        if (type(i).shape.length > 0)
          decline(e.ops[1], 'a list where a scalar is required');
        return at(e, l, i);
      }
      // `First(L)` is `At(L, 1)`, `Second` and `Third` the indices 2 and 3,
      // `Last` the index -1: the interpreter's value of those reads, also
      // of a tuple, and the absent value of `At` out of range (`Missing` of
      // an empty list, NaN for a number on JavaScript).
      case 'First':
      case 'Second':
      case 'Third':
      case 'Last': {
        if (e.nops !== 1) break;
        const k = { First: 1, Second: 2, Third: 3, Last: -1 }[e.operator]!;
        const i = b.constant(k, 'integer');
        if (lists.isIterate(e.ops[0]) && k > 0)
          return at(e, lists.iterateTo(e, e.ops[0], i), i);
        return at(e, value(e.ops[0])!, i);
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
        //
        // Elsewhere, a scalar base on the integer lane to a literal exponent
        // `>= 1` is the product by squaring on the integer lane, as
        // `Multiply` (exact below 2^53, 2^24 on GLSL): an integer to such a
        // power is an integer, whatever the engine's type of the base (a
        // local `c` of `let c = n^2` is `number` there); the bigint mode
        // has `pow.int`.
        const m = interval || bigint ? undefined : literalExponent(e);
        if (m !== undefined) {
          const x = value(e.ops[0])!;
          if (type(x).lane !== 'integer' || type(x).shape.length > 0)
            return apply(e, 'Power', [x, value(e.ops[1])!]);
          const power = (k: number): V => {
            if (k === 1) return x;
            if (k % 2 === 1) return apply(e, 'Multiply', [power(k - 1), x]);
            const y = power(k / 2);
            return apply(e, 'Multiply', [y, y]);
          };
          return power(m);
        }
        // A matrix base (rank 2 or more, not a list of points) takes no
        // shortcut of the interval mode: the row declines it (the
        // interpreter's value is the matrix power).
        if (interval && e.nops === 2) {
          const x = value(e.ops[0])!;
          if (type(x).shape.length > 1 && tuples.get(x) !== 1)
            return apply(e, 'Power', [x, value(e.ops[1])!]);
        }
        const exponent = literalNumber(e.ops[1]);
        const nv = exponent?.numericValue;
        const float =
          !interval || nv === undefined
            ? undefined
            : typeof nv === 'number'
              ? nv
              : !nv.isExact && nv.im === 0
                ? nv.re
                : undefined;
        const terms =
          float !== undefined &&
          Number.isFinite(float) &&
          !Number.isInteger(float)
            ? (realPowerBranchTerms(
                undefined,
                float,
                realPowerReconstructionDigits(e.engine.precision)
              ) ?? null)
            : undefined;
        const odd = terms != null && terms[1] % 2 !== 0;
        const pq =
          interval && typeof nv === 'object' && nv.isExact
            ? exponent!.toRational()
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
      case 'ColorMix': {
        // `ColorMix(a, b)` mixes at the ratio 0.5, as the interpreter.
        if (e.nops !== 2) break;
        return apply(e, 'ColorMix', [
          ...e.ops.map((op) => value(op)!),
          b.constant(0.5, 'real'),
        ]);
      }
      case 'AsHsv':
      case 'AsHsl': {
        // The interpreter answers a colour of the conversion's own space
        // unchanged, which OKLCh loses at black and at grey (`AsHsv(Hsv(h,
        // 1, 0))` keeps `h`). The value of the operand is read from the
        // operation that makes it (`colorDef()`): a constructor of the own
        // space is its channels (`ashsv.own`, which threads over a list
        // channel as the constructor does), a conversion to that space is
        // its value, and an operation whose interpreter value is never of
        // that space (`COLOR_SAFE`) converts. Any other colour (an `If`, a
        // call of a user function, a `ContrastingColor` of candidates, a
        // loop value) can be of that space at run time, and declines. A
        // literal list of colours is each element by itself.
        if (e.nops !== 1) break;
        const op = e.operator.toLowerCase();
        const own = op.slice(2);
        const convert = (x: V): V => {
          // A tuple of three numbers is sRGB, and another tuple declines
          // (`apply()`).
          if (type(x).lane !== 'color' || tuples.has(x))
            return apply(e, ofOp(op), [x]);
          const i = colorDef(x);
          if (i?.op === own && i.args.length === 3)
            return apply(e, ofOp(`${op}.own`), i.args);
          if (i?.op === op || i?.op === `${op}.own`) return x;
          if (i !== undefined && COLOR_SAFE.has(i.op))
            return apply(e, ofOp(op), [x]);
          // A literal list of colours, just made: each element by itself.
          const l =
            type(x).shape.length === 1
              ? b.current().body.find((j) => j.k === 'list' && j.out === x)
              : undefined;
          if (
            l?.k === 'list' &&
            l.args.every(
              (v) => type(v).lane === 'color' && type(v).shape.length === 0
            )
          )
            return b.list(l.args.map(convert), type(x));
          decline(
            e,
            `${e.operator} of a colour that can be ${own === 'hsv' ? 'an Hsv' : 'an Hsl'} colour at run time and is not one at compile time`
          );
        };
        // The operand is lowered once: an effectful operand draws once.
        return convert(value(e.ops[0])!);
      }
      case 'ColorToString':
        // The interpreter formats the source channels of a colour, so the
        // compiled one formats a colour whose channels it has: a
        // constructor (`colorDef()`), or a tuple of three numbers, the
        // channels of `Rgb`. Any other colour, held in OKLCh here where the
        // interpreter holds it in its own space, can print one unit off at
        // a rounding boundary, and declines.
        return colorToString(e, {
          channels: (x) => {
            const v = value(x)!;
            if (
              tuples.get(v) === 0 &&
              same(type(v).shape, [3]) &&
              ['real', 'integer'].includes(type(v).lane)
            )
              return [
                'rgb',
                [1, 2, 3].map((k) =>
                  apply(e, 'At', [v, b.constant(k, 'integer')])
                ),
              ];
            if (type(v).lane !== 'color' || type(v).shape.length > 0)
              return undefined;
            const i = colorDef(v);
            const space = i === undefined ? undefined : CHANNEL_SPACES[i.op];
            return space === undefined || i!.args.length !== 3
              ? undefined
              : [space, i!.args];
          },
          apply: (op, args) => apply(e, ofOp(op), args),
        });
      case 'Characters':
      case 'GraphemeClusters':
        return characters(e, cx);
      case 'Color': {
        // `Color` of a string literal: the interpreter's colour of the
        // string (`colorStringToOklch()`), computed here, as the `Oklch` of
        // its three channels. A colour with an alpha declines (no row has
        // one), and so does any other operand (no string is a value here).
        const c =
          e.nops === 1 && isString(e.ops[0])
            ? colorStringToOklch(e.ops[0].string)
            : null;
        if (c === null)
          decline(e, 'Color of an operand that is not a literal colour string');
        if (c.alpha !== undefined)
          decline(e, 'Color of a colour string with an alpha');
        return apply(
          e,
          'Oklch',
          [c.L, c.C, c.H].map((x) => b.constant(x, 'real'))
        );
      }
      case 'GamutMap': {
        // The gamut is a string literal: `srgb` is `GamutMap(c)`.
        if (e.nops !== 2) break;
        const gamut = isString(e.ops[1])
          ? readColorGamut(e.ops[1].string)
          : undefined;
        if (gamut === undefined)
          decline(
            e,
            'GamutMap of a gamut that is not the literal "srgb" or "display-p3"'
          );
        const c = value(e.ops[0])!;
        return gamut === 'srgb'
          ? apply(e, 'GamutMap', [c])
          : apply(e, ofOp('gamutmap.p3'), [c]);
      }
      case 'Colormap': {
        // `Colormap(name, t)` of a palette named by a string literal. Its
        // value is a list of colours when `t` is an integer of 2 or more,
        // so it compiles only when the position is a literal that is not
        // one, or when its static type is a range below 2 (`real<0..1>`):
        // the shape is settled at compile time (R1 of
        // docs/COMPILATION-MODEL.md).
        const name =
          e.nops === 2 && isString(e.ops[0]) ? e.ops[0].string : undefined;
        const k = name === undefined ? -1 : COLORMAP_NAMES.indexOf(name);
        if (k < 0)
          decline(
            e,
            'Colormap of a name that is not a literal palette name, or with no position'
          );
        const t = e.ops[1];
        const range = t.type.type;
        if (
          !(isNumber(t)
            ? !(Number.isInteger(t.re) && t.re >= 2)
            : typeof range === 'object' &&
              range.kind === 'numeric' &&
              range.upper !== undefined &&
              range.upper < 2)
        )
          decline(
            e,
            'Colormap of a position that can be an integer of 2 or more (a list of colours): declare its type as a range below 2, such as real<0..1>',
            UNSETTLED_SHAPE
          );
        return apply(e, ofOp('colormap'), [
          b.constant(k, 'integer'),
          value(t)!,
        ]);
      }
      case 'ColorToColorspace': {
        // The tuple of the three channels of the colour in the space named
        // by a string literal (`lab` is `oklab`), as the interpreter.
        const name =
          e.nops === 2 && isString(e.ops[1])
            ? e.ops[1].string.toLowerCase()
            : undefined;
        const space = name === 'lab' ? 'oklab' : name;
        if (
          space === undefined ||
          !['rgb', 'hsl', 'hsv', 'oklab', 'oklch'].includes(space)
        )
          decline(
            e,
            'ColorToColorspace of a space that is not a literal colour space name'
          );
        const c = value(e.ops[0])!;
        return tuple(
          e,
          [0, 1, 2].map((k) =>
            apply(e, ofOp(`colorchannel.${space}`), [
              c,
              b.constant(k, 'integer'),
            ])
          )
        );
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
      case 'StringReplace': {
        // Of a literal pattern (`lower-strings.ts`).
        const v = patternReplace(e, {
          text: (s) => b.constant(s, 'string'),
          scalar,
          apply: (op, args) => apply(e, ofOp(op), args),
        });
        if (v !== undefined) return v;
        break;
      }
      case 'Chop': {
        // `Chop(x)` is `Chop(x, tol)` at the engine's tolerance at the
        // compilation, which the interpreter's `ce.chop()` reads. A constant
        // tolerance is the double that the interpreter compares with, a
        // point in the interval mode, whose kernel reads it as a number
        // (`_IA.chop(x, tol)`): another tolerance declines there.
        if (e.nops > 2) break;
        const x = value(e.ops[0])!;
        const stated = e.nops === 2 ? value(e.ops[1])! : undefined;
        const tol = stated === undefined ? ce.tolerance : constant(stated);
        if (tol === undefined && interval)
          decline(e, 'Chop with a tolerance that is not a constant');
        return apply(e, 'Chop', [
          x,
          tol === undefined ? stated! : b.constant(tol, 'real'),
        ]);
      }
      case 'Length': {
        // The length of a list local written in place: no write changes it.
        const owned = isSymbol(e.ops[0]) ? lookup(e.ops[0].symbol) : undefined;
        if (e.nops === 1 && owned?.binding.role === 'list') {
          const n = type(owned.binding.v).shape[0];
          return typeof n === 'number' ? b.constant(n, 'integer') : n.v;
        }
        // Of a string (its static type): the number of its characters.
        if (e.nops === 1 && isSubtype(e.ops[0].type.type, 'string')) {
          const s = scalar(e.ops[0]);
          if (type(s).lane !== 'string') decline(e, 'Length of a non-string');
          return apply(e, ofOp('text.length'), [s]);
        }
        // Of a row at an index known at run time: NaN where it is absent.
        const s = lists.source(e.ops[0], false, true);
        return rowLengths.get(s.length) ?? s.length;
      }
      case 'Count':
      case 'IsEmpty':
      case 'Rest':
      case 'Most':
      case 'Reverse':
      case 'Take':
      case 'Drop':
      case 'RotateLeft':
      case 'RotateRight':
      case 'Mean':
      case 'Variance':
      case 'PopulationVariance':
      case 'StandardDeviation':
      case 'PopulationStandardDeviation':
      case 'Median':
      case 'Mode':
      case 'Quartiles':
      case 'InterquartileRange':
      case 'Skewness':
      case 'Kurtosis':
      case 'Covariance':
      case 'PopulationCovariance':
      case 'Correlation':
      case 'Sort':
      case 'Ordering':
      case 'Unique':
      case 'Any':
      case 'All':
      case 'Contains':
      case 'IndexOf':
      case 'Dot':
      case 'Norm':
      case 'Append':
      case 'DeleteAt':
      case 'Insert':
      case 'Slice':
      case 'Linspace':
      case 'Chunk':
      case 'Partition':
      case 'TakeWhile':
      case 'DropWhile':
      case 'FlatMap':
      case 'Scan':
      case 'Tabulate':
      case 'Element':
      case 'Identity':
      case 'CountIf':
      case 'Find':
      case 'IndexWhere':
      case 'Position':
      case 'ArgMax':
      case 'ArgMin':
      case 'MaxBy':
      case 'MinBy':
      case 'RandomSample':
      case 'ApplyWhole':
      case 'ContainsSequence':
        return lists.collection(e);
      case 'StartsWith':
      case 'EndsWith':
        // Of strings: the rows of the string lane (CE-1530); of lists, the
        // list operators (CE-1531).
        if (isSubtype(e.ops[0].type.type, 'string')) break;
        return lists.collection(e);
      case 'Matrix':
      case 'Transpose':
      case 'ConjugateTranspose':
      case 'Trace':
      case 'Diagonal':
      case 'Determinant':
      case 'Inverse':
      case 'MatrixPower':
      case 'MatrixMultiply':
      case 'RowReduce':
      case 'Rank':
      case 'Shape':
      case 'Flatten':
      case 'Reshape':
      case 'Cross':
        return matrices.matrix(e);
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
          !facts(e).answered &&
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
      // `Repeat(v, n)`: a build of `n` copies of `v`. A pure `v` is lowered
      // once; the interpreter evaluates a `v` that is not pure once per
      // element, in order (none for a count of 0), so such a `v` is the body
      // of the build, as the body of a `Map`. The count is that of
      // `Range(1, n)`: 0 for `n < 1`.
      case 'Repeat': {
        if (e.nops !== 2)
          decline(e, 'Repeat with no count (an unbounded list)');
        const pure = e.ops[0].isPure && facts(e.ops[0]).writes.size === 0;
        const v = pure ? value(e.ops[0])! : undefined;
        const n = scalar(e.ops[1]);
        if (type(n).lane !== 'integer' && type(n).lane !== 'real')
          decline(e.ops[1], 'a count of Repeat that is not a real number');
        const [one, c] = [b.constant(1, 'integer'), constant(n)];
        const length =
          c !== undefined && Number.isFinite(c)
            ? b.constant(Math.max(0, Math.floor(c)), 'integer')
            : apply(e, ofOp('rangecount'), [one, n, one]);
        return lists.over(
          e,
          { length, at: (k) => k },
          '',
          v === undefined ? e.ops[0] : () => v!,
          false,
          e
        );
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
        // A function literal or a user function of two parameters: the
        // left fold by it (`lists.reduceBy()`), from `init` or, with none,
        // from the first element.
        if ((e.nops === 3 || e.nops === 2) && r === undefined)
          return lists.reduceBy(e);
        // A left fold, as the interpreter's: `Subtract` and `Divide` too.
        if (e.nops !== 3 || (r?.arity !== 'variadic' && r?.arity !== 2))
          decline(
            e,
            'a Reduce with no initial value, or not by a variadic or binary library operator that the compiler supports'
          );
        return lists.reduce(e, r, [lists.source(l)], scalar(init));
      }
      case 'Typed':
        return value(e.ops[0], want);
      case 'WithRandomSeed': {
        // `WithRandomSeed(537911, Random())`, the random constant of a host:
        // a number as the seed and one draw give one value at every call,
        // the interpreter's, as a literal.
        if (
          want &&
          options.fold !== false &&
          !bigint &&
          !interval &&
          e.nops === 2 &&
          isNumber(e.ops[0]) &&
          isFunction(e.ops[1], 'Random') &&
          e.ops[1].nops === 0 &&
          handled(e) === undefined &&
          handled(e.ops[1]) === undefined
        ) {
          // An evaluation that throws (not a cancellation) keeps the frame.
          let n: Expression | undefined;
          try {
            n = e.N();
          } catch (error) {
            if (error instanceof Error && error.name === 'CancellationError')
              throw error;
          }
          if (n && isNumber(n) && n.im === 0 && Number.isFinite(n.re))
            return number(n);
        }
        const seed = scalar(e.ops[0]);
        if (e.nops !== 2 || !isSubLane(type(seed).lane, 'real'))
          decline(e, 'a seed that is not a number');
        return seededFrame(e, seed, () => value(e.ops[1], want), want);
      }
      case 'Assign':
        return assign(e, want);
      case 'AddTo':
        return addTo(e, want);
      case 'Loop':
        return loop(e, want);
      case 'ParallelLoop':
        return parallelLoop(e, want);
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
        // the runtime (`_SYS.nd`), of `D(f, x)` of a pure real body
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
      case 'ND': {
        // `ND(f, x)` of a function literal of one parameter whose body is a
        // pure real number: the stencil of `D` with no closed form
        // (`_SYS.nd`), which the interpreter's `ND` runs too
        // (`stencilDerivativeAt()`). JavaScript only.
        const [f, x] = e.ops;
        if (!options.javascript)
          decline(e, 'ND on another target than javascript');
        if (!isFunction(f, 'Function') || e.nops !== 2)
          decline(
            e,
            'ND of a value that is not a function literal of one parameter'
          );
        const name = f.nops === 2 ? parameterName(f.ops[1]) : undefined;
        if (name === undefined)
          decline(
            e,
            'ND of a value that is not a function literal of one parameter'
          );
        if (f.ops[0].isPure !== true)
          decline(e, 'ND of a function with an effect');
        const point = scalar(x);
        if (!isSubLane(type(point).lane, 'real'))
          decline(e, 'the point of a derivative is not real');
        const effects = b.effects;
        const [out] = region(
          'derivative',
          [point],
          ...realBody(e, name, f.ops[0], 'a derivative'),
          e
        );
        if (b.effects !== effects) decline(e, 'a derivative with an effect');
        return out;
      }
      case 'Limit': {
        // A closed limit only: its value at compile time, the interpreter's
        // (`N()`). Another limit declines: the interpreter computes a
        // symbolic limit at each point first, which no kernel of the
        // runtime reproduces (the numeric limit is NaN at a jump near the
        // point, CE-1232). The interval mode declines: the double of `N()`
        // need not enclose the limit.
        if (interval) decline(e, 'a limit in the interval mode');
        const params = isFunction(e.ops[0], 'Function')
          ? e.ops[0].ops.slice(1).map((p) => parameterName(p))
          : [];
        const free = [...facts(e).names].filter((n) => !params.includes(n));
        if (
          e.unknowns.length > 0 ||
          e.isPure !== true ||
          free.some((n) => lookup(n) !== undefined || options.vars?.includes(n))
        )
          decline(
            e,
            'a limit that is not closed (only the value of a closed limit is compiled)'
          );
        if (ce.angularUnit !== 'rad' || facts(e).size > CLOSED_SIZE)
          decline(e, `a limit in radians of at most ${CLOSED_SIZE} nodes`);
        const c = closedForm(e, () => {
          const v = e.N();
          return isNumber(v) && v.im === 0 && !v.isNaN ? v : undefined;
        });
        if (c === undefined)
          decline(e, 'a limit with no real value at compile time');
        return value(c, want);
      }
      case 'EvaluateAt': {
        // `EvaluateAt(f, a)` is `Apply(f, a)` and `EvaluateAt(f, a, b)` is
        // `Apply(f, b) - Apply(f, a)`, of a function literal of one
        // parameter, as the interpreter applies it. With an effect, the
        // interpreter applies `f` at `a` first, which the compiled
        // difference does not promise: it declines.
        const [f, ...points] = e.ops;
        if (
          !isFunction(f, 'Function') ||
          f.nops !== 2 ||
          points.length < 1 ||
          points.length > 2 ||
          (points.length === 2 && e.isPure !== true)
        )
          decline(
            e,
            'EvaluateAt of a value that is not a function literal of one parameter, of no point or more than two, or of an effect at two bounds'
          );
        const at = (p: Expression) => ce._fn('Apply', [f, p]);
        return value(
          points.length === 1
            ? at(points[0])
            : ce._fn('Subtract', [at(points[1]), at(points[0])]),
          want
        );
      }
      // The interval mode has no complex lane: `Argument` of a real is
      // `Arctan2(0, x)`, 0 for `x >= 0` and π for `x < 0`, as the
      // interpreter's.
      case 'Argument':
        if (!interval || e.nops !== 1) break;
        return apply(e, 'Arctan2', [
          b.constant(0, 'integer'),
          value(e.ops[0])!,
        ]);
      case 'Apply': {
        // `Apply(Function(body, p1, …), a1, …)`: the body with each
        // parameter bound to its argument, each argument evaluated once, in
        // order, before it. (`Apply(g, x)` of a name is the call `g(x)` in
        // the canonical form.) `Apply(Derivative(g, n…), a1, …)` is the
        // application of the function literal of the derivative, which
        // declines with none, and at a total order of 3 or more of a large
        // body (the rule of the forward mode, `prefersJetDerivative()`)
        // before the engine is asked.
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
        // A parameter is a name, or a name with a declared type
        // (`Typed(H, 'list<real>')`).
        const names = isFunction(f, 'Function')
          ? f.ops
              .slice(1)
              .map((p) =>
                isFunction(p, 'Optional') ? '' : (parameterName(p) ?? '')
              )
          : [];
        if (
          !isFunction(f, 'Function') ||
          names.length !== args.length ||
          names.includes('')
        )
          decline(
            e,
            'Apply of a value that is not a function literal of one parameter per argument'
          );
        // The IR type of each typed parameter, from the literal's signature:
        // a scalar, or a list or a tuple of numbers, or on JavaScript a list
        // of lists of two lengths not stated (`rowsInput()`). A union
        // (`real | list<real>`) and another type decline.
        const sig = f.type.type;
        const declared = f.ops.slice(1).map((p, i) => {
          if (!isFunction(p, 'Typed')) return undefined;
          const t =
            typeof sig === 'object' && sig.kind === 'signature'
              ? sig.args?.[i]?.type
              : undefined;
          const ir =
            t === undefined
              ? undefined
              : (tupleOrInputType(t, cx.wide) ?? rowsInput(t));
          if (t === undefined || ir === undefined)
            decline(
              p,
              `a parameter of Apply whose type is not a scalar, a list or a tuple of numbers${t === undefined ? '' : ` (${engineTypeToString(t)})`}`,
              t !== undefined && hasUnsettledShape(t)
                ? UNSETTLED_SHAPE
                : undefined
            );
          return { ...ir, tuple: tupleAxis(t), t };
        });
        // A list argument of a literal whose signature is scalar is mapped
        // over, the interpreter's route (`applyLiteralMaps()`) for flat lists
        // of numbers: `Map(f, list)` of one parameter, and of several the
        // lists zipped and each scalar bound whole in every cell. A
        // parameter declared a list or a tuple binds its argument whole, as
        // the interpreter does: the argument must have that type. Another
        // list or tuple argument declines: the interpreter maps a nested list
        // to its leaves, a tuple is atomic, and a signature that takes a
        // collection binds the argument whole.
        const maps = literalParamsMap(sig);
        const whole = declared.map((d) => (d?.shape.length ?? 0) > 0);
        const values = args.map((a, i) => {
          const d = declared[i];
          // A parameter of the lane `rows` binds an input or a parameter of
          // that lane whole, as a parameter of a user function does: of
          // lists of integers, one of lists of integers only.
          if (d?.lane === 'rows') {
            const raw = wholeRows(a);
            if (type(raw).lane !== 'rows')
              decline(
                a,
                `an argument of Apply for the parameter ${names[i]}, a list of lists of two lengths not stated, that is not an input or a parameter of that type`
              );
            if (
              rowsElementLane(d.t) === 'integer' &&
              rowsElementLane(a.type.type) !== 'integer'
            )
              decline(
                a,
                `an argument of Apply of type ${engineTypeToString(a.type.type)} for the parameter ${names[i]} of lists of integers`
              );
            return raw;
          }
          // The checks read the argument before it is widened to the lane
          // of its parameter, so a widening cannot hide a mismatch.
          const raw = value(a)!;
          const v = d === undefined ? raw : widen(raw, d.lane);
          const t = type(raw);
          // An argument at a list or a tuple parameter must have its
          // declared shape (the positions of a tuple, a stated length); a
          // scalar argument, its lane (below).
          const notDeclared = (at: string) =>
            decline(
              a,
              `an argument of Apply that is not ${engineTypeToString(d!.t)}${at}, the type of its parameter ${names[i]}`
            );
          if (d !== undefined && whole[i]) {
            const n = t.shape[0];
            const want: IRType = {
              lane: d.lane,
              shape: d.shape.map((m) => (m === 'run-time' ? n : m)),
            } as IRType;
            // A list parameter (not of tuples) binds a list argument whole,
            // and the interpreter does not check its elements (a `list<real>`
            // argument at a `list<integer>` parameter: CE-1483): a list of
            // reals keeps its own lane, every read gives the interpreter's
            // number. A tuple argument is an `incompatible-type` error.
            if (
              d.tuple === undefined &&
              !tuples.has(raw) &&
              n !== undefined &&
              t.shape.length === d.shape.length &&
              isSubLane(t.lane, 'real') &&
              isSubLane(d.lane, 'real') &&
              isSubType(t, { ...want, lane: t.lane } as IRType, constant)
            )
              return isSubLane(t.lane, d.lane) ? v : raw;
            if (
              tuples.get(raw) !== d.tuple ||
              n === undefined ||
              !isSubType(t, want, constant) ||
              !isSubtype(a.type.type, d.t)
            )
              notDeclared('');
            return v;
          }
          const flat =
            t.shape.length === 1 &&
            !tuples.has(raw) &&
            (t.lane === 'real' || t.lane === 'integer');
          if (t.shape.length > 0 && !(maps && flat))
            decline(
              a,
              'a list or a tuple argument of Apply (the interpreter may map the function over it)'
            );
          // A typed scalar parameter takes a scalar, or each element of a
          // list mapped over it, of its lane. The engine type of the
          // argument need not prove the declared type: an argument value
          // outside the type of its parameter is unspecified in compiled
          // code (user decision 2026-11-19, CE-1503; `docs/COMPILATION-MODEL.md`,
          // "Caveats of compiled code"), so `a: real | signed_infinity | nan`
          // binds at `p: real` (CE-1498). A value of the real lane binds at
          // an `integer` parameter with its own lane (an untyped local, of
          // the engine type `number`, CE-1485): every integer value gives
          // the interpreter's number (`mode: 'bigint'` has no real value).
          if (d !== undefined && !isSubLane(t.lane, d.lane)) {
            if (t.lane === 'real' && d.lane === 'integer') return raw;
            notDeclared(t.shape.length > 0 ? ' at each element' : '');
          }
          return v;
        });
        // The arguments are lowered once: their effects run once. Lists of
        // different lengths are `incompatible-dimensions` for the
        // interpreter (`applyLiteralMapped()`): of stated lengths, a decline.
        const sources = values.map((v, i) =>
          type(v).shape.length > 0 && !whole[i]
            ? lists.listSource(v)
            : undefined
        );
        const mapped = sources.filter((s) => s !== undefined);
        if (new Set(mapped.flatMap((s) => constant(s.length) ?? [])).size > 1)
          decline(e, 'Apply of lists of different lengths');
        if (mapped.length > 0) {
          const length = lists.shortest(e, mapped);
          const cell = (k: V) =>
            withFrame(true, (frame) => {
              names.forEach((n, i) =>
                frame.names.set(n, {
                  v: sources[i]?.at(k) ?? values[i],
                  role: 'index',
                })
              );
              return value(f.ops[0])!;
            });
          return lists.over(e, { length, at: (k) => k }, '', cell, false, f);
        }
        return withFrame(false, (frame) => {
          names.forEach((n, i) =>
            frame.names.set(n, { v: values[i], role: 'index' })
          );
          return value(f.ops[0], want);
        });
      }
      // An order of two strings or two characters (CE-1574): the order of
      // `textOrder()` compared with 0. A character against a string and a
      // chain of three or more decline; an operand that is not text takes
      // the rows, which have no signature of text.
      case 'Less':
      case 'LessEqual':
      case 'Greater':
      case 'GreaterEqual': {
        const types = e.ops.map((o) => o.type.type);
        if (!types.every((t) => textOrder([t]) !== undefined)) break;
        const order = textOrder(types);
        if (order === undefined || e.nops !== 2)
          decline(
            e,
            `${e.operator} of other than two strings or two characters`
          );
        const [x, y] = [scalar(e.ops[0]), scalar(e.ops[1])];
        if (type(x).lane !== 'string' || type(y).lane !== 'string')
          decline(e, `${e.operator} of text that is not a string value`);
        const c = apply(
          e,
          ofOp(order === 'points' ? 'text.compare' : 'text.cmpu'),
          [x, y]
        );
        return apply(e, e.operator, [c, b.constant(0, 'integer')]);
      }
      // `KroneckerDelta(a, b)` of two numbers or two strings is
      // `Boole(a = b)`, and
      // `KroneckerDelta(n)` is `Boole(n = 0)`: the interpreter's 1 when the
      // values are the same, 0 when their difference is a nonzero constant.
      // A list declines (the interpreter does not thread it), and so do
      // three operands or more.
      case 'KroneckerDelta': {
        if (e.nops > 2) break;
        const [x, y] = [
          scalar(e.ops[0]),
          e.nops === 2 ? scalar(e.ops[1]) : b.constant(0, 'integer'),
        ];
        // Two NaN operands are the same, as `isSame()` reads them; an
        // integer is never NaN.
        const equal = apply(e, 'Equal', [x, y]);
        if (
          [x, y].some((v) => isSubLane(type(v).lane, 'integer')) ||
          [x, y].every((v) => type(v).lane === 'string')
        )
          return apply(e, 'Boole', [equal]);
        const nan = (v: V) => apply(e, ofOp('isnan'), [v]);
        const same = apply(e, 'Or', [equal, apply(e, 'And', [nan(x), nan(y)])]);
        return apply(e, 'Boole', [same]);
      }
      case 'Pipe': {
        // `Pipe(x, f)` is `f(x)`, the call that the interpreter evaluates
        // (`pipeStep()` of `library/core.ts`): a stage that takes the topic
        // as an implicit argument (`Take(10)`) is that completed call; a
        // unary function literal is `Apply(f, x)`; a name is the call of
        // that name. Any other stage declines.
        const call = pipeCall(e);
        if (call === undefined)
          decline(
            e,
            'Pipe of a stage that is not a function literal, a name or a call missing one argument'
          );
        return value(call, want);
      }
      // The discharges (`absent()`).
      case 'IsMissing':
        if (e.nops !== 1) break;
        return absent(e, e.ops[0], value(e.ops[0])!);
      case 'Coalesce':
        return coalesce(e, 0);
      case 'AssertPresent':
        if (e.nops !== 1) break;
        return present(e, value(e.ops[0])!);
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
    const r = rowOfHead(rows, reduction?.row ?? e.operator, e.nops);
    if (r === undefined)
      decline(e, `the operator ${e.operator} is not supported by the compiler`);
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
    // Of a list of booleans, every operand is lowered and the operation
    // threads (`apply()`), as the interpreter's; an effect declines.
    if (
      (e.operator === 'And' || e.operator === 'Or') &&
      e.ops.some((o) => o.type.matches('list<boolean>'))
    ) {
      const before = b.effects;
      const vs = e.ops.map((o) => value(o)!);
      if (b.effects > before)
        decline(e, `${e.operator} of a list with an effect`);
      return apply(e, r, vs);
    }
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
      if (e.nops < 2) decline(e, `${e.operator} with ${e.nops} operands`);
      let prev = value(e.ops[0])!;
      const pair = (i: number) => {
        const v = value(e.ops[i + 1])!;
        // A conditional on a list (`L < 0 < 1`), and an `Equal` of three
        // operands with a list or a tuple, whose value in the interpreter
        // is not the conjunction of its pairs (`Equal(L, L, 3)` is `False`).
        if (e.nops > 2 && [prev, v].some((x) => type(x).shape.length > 0))
          decline(e, 'a chain of three or more operands with a list');
        const p = apply(e, r, [prev, v]);
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

  /** The number of `x`: a literal (`literalNumber()`), or the value a free
   *  name holds. */
  const numberOf = (x: Expression): Expression | undefined => {
    const n = literalNumber(x);
    if (n !== undefined) return n;
    if (!isSymbol(x) || lookup(x.symbol) !== undefined) return undefined;
    if (options.vars?.includes(x.symbol) || CONSTANTS.has(x.symbol)) return;
    const v = own(x);
    return v !== undefined && isNumber(v) ? v : undefined;
  };

  /** A product. With a rational constant `p/q` whose denominator is not a
   *  power of two, it is `(p · factors) / q` (`div.q`): `Floor(x/49)` at 49
   *  is 1, where the product by the double of `1/49` gives 0 (`README.md`,
   *  "The contracts"). The constant can be a free name that holds it, or a
   *  local that no `Assign` writes (CE-1191); several are one constant. */
  const product = (e: Fn): V => {
    const ratio = (x: Expression) => {
      const n =
        numberOf(x) ??
        (isSymbol(x) ? lookup(x.symbol)?.binding.exact : undefined);
      const pq = n !== undefined ? n.toRational() : null;
      return pq !== null &&
        pq.every(Number.isSafeInteger) &&
        (BigInt(pq[1]) & (BigInt(pq[1]) - 1n)) !== 0n
        ? pq
        : undefined;
    };
    const rs = bigint ? [] : e.ops.map(ratio);
    let ks = rs.flatMap((r, i) => (r ? [i] : []));
    const of = (is: number[]) =>
      is.reduce(([m, n], i) => [m * rs[i]![0], n * rs[i]![1]], [1, 1]);
    if (!of(ks).every(Number.isSafeInteger)) ks = ks.slice(0, 1);
    const values = e.ops.map((x, i) =>
      ks.includes(i) ? undefined : value(x)!
    );
    const rest = values.filter((v): v is V => v !== undefined);
    if (ks.length === 0 || rest.some((v) => type(v).lane === 'complex'))
      return apply(
        e,
        'Multiply',
        values.map((v, i) => v ?? value(e.ops[i])!)
      );
    for (const c of ks.map((i) => e.ops[i]))
      if (isSymbol(c) && !lookup(c.symbol) && !held(c.symbol)!.library)
        b.captures.add(c.symbol);
    const [p, q] = of(ks);
    const mul = (xs: V[]) =>
      xs.length === 1 ? xs[0] : apply(e, 'Multiply', xs);
    const scalars = rest.filter((v) => type(v).shape.length === 0);
    const lists = rest.filter((v) => type(v).shape.length > 0);
    // The interval mode, with a constant marked `inexact` among the scalars
    // (`π`) and a factor that is not a constant: the product of the rational
    // and the constants is one constant, folded as a closed node (`N()` and
    // one ulp) or else `(π / q) · p` as on the earlier target, computed
    // once, times the other factors. Else the division stays last: `1/3 · 6`
    // is the point 2.
    const c0 = interval ? scalars.find((v) => inexacts.has(v)) : undefined;
    if (c0 !== undefined && rest.some((v) => constant(v) === undefined)) {
      const fixed = (i: number) =>
        ks.includes(i) || constant(values[i]!) !== undefined;
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
    if (isString(n)) return b.constant(n.string, 'string');
    // A value that is not an integer (a pole, `Mod(5, 0)`) is lowered as
    // written: its helper throws the pole where the node is evaluated.
    if (!isNumber(n) || (bigint && n.isInteger !== true)) return undefined;
    return number(n, interval && !exact ? 1 : undefined);
  };

  /** The expression that `ask()` gives at compile time for `e` (the closed
   *  form of a derivative), with the values of the `vars` names hidden from
   *  the engine; `undefined` when there is none; a decline under
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
      : isFunction(x, 'Root') ||
          (isFunction(x, 'Power') && literalNumber(x.ops[1]) !== undefined)
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
            ((!always && isFunction(q, 'Negate')) ||
              (literalNumber(q)?.re ?? 0) < 0)
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
        decline(
          e,
          'a number that is not an integer (the bigint mode)',
          BIGINT_LANE
        );
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

  /** Whether `def` is the binding of `name` in the scope of the
   *  compilation or in a scope that encloses it (a definition that the
   *  scope of the `inputs` option hides): a binding that the entry reads as
   *  its input of that name, never a local or a variable of a binder of the
   *  expression, whose scopes are inside it. */
  const onScopeChain = (
    name: string,
    def: BoxedValueDefinition | undefined
  ): boolean => {
    if (def === undefined) return false;
    for (let s: Scope | null = ce.context.lexicalScope; s; s = s.parent) {
      const binding = s.bindings.get(name);
      if (binding !== undefined && 'value' in binding && binding.value === def)
        return true;
    }
    return false;
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
   *  effect other than the one draw of a random frame of `v`
   *  (`drawSites()`), or has another rank or lane than the type of `e`,
   *  and when a name that `v` reads (outside a function literal of `v`
   *  that binds it, and outside the body and the condition of a clause of
   *  a `Sum`, a `Product` or a `Comprehension` of `v` that binds it as its
   *  index) is bound here other than as an input, or has another binding
   *  here than in `v` with a value in one of the two (the interpreter reads
   *  the bindings of `v`). */
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
      // A `Sum`, a `Product` or a `Comprehension` binds the index of each
      // clause `Limits(i, …)` or `Element(i, …)` in its body and in the
      // condition of an `Element` clause. The bounds and the lists are
      // checked as reads of the names outside: a later clause that reads an
      // earlier index there can decline, never take another value.
      const clauses =
        isFunction(x) &&
        (x.operator === 'Comprehension' ||
          REDUCTIONS.get(x.operator)?.indexed === true)
          ? x.ops.slice(1)
          : [];
      const indexes = clauses.flatMap((c) =>
        (isFunction(c, 'Limits') || isFunction(c, 'Element')) &&
        isSymbol(c.ops[0])
          ? [c.ops[0].symbol]
          : []
      );
      if (isFunction(x) && indexes.length > 0) {
        const within = [...inner, ...indexes];
        const clause = (c: Expression) =>
          isFunction(c, 'Limits') || isFunction(c, 'Element')
            ? c.ops.reduce(
                (s, op, i) =>
                  s ||
                  (i === 0 && isSymbol(op)
                    ? ''
                    : reason(
                        op,
                        i === 2 && isFunction(c, 'Element') ? within : inner
                      )),
                ''
              )
            : reason(c, inner);
        return clauses.reduce(
          (s, c) => s || clause(c),
          reason(x.ops[0], within)
        );
      }
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
    // The places of `v` and of its nodes (`nanForAbsent()`): a new name
    // that holds `v`, or a read that is not a node of the program, adds
    // places to a node whose list of NaN can already be lowered.
    let h = holders.get(v);
    if (h === undefined)
      holders.set(v, (h = { names: new Set(), other: false }));
    const other = !readers.has(e);
    if (!h.names.has(name) || (other && !h.other)) {
      h.names.add(name);
      h.other ||= other;
      reachBody(v);
      unreadAsAbsent.clear();
      for (const x of nanAccepted) if (!nanForAbsent(x)) declineNanList(x);
    }
    // The instructions of `v` are those that its lowering adds to the
    // region that is open here.
    const [effects, start] = [b.effects, b.current().body.length];
    expanding.add(name);
    let x: V;
    try {
      x = value(seededValue(v) ?? v)!;
    } finally {
      expanding.delete(name);
    }
    if (b.effects !== effects && drawSites(b.current().body.slice(start)) > 0)
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
    // earlier interval target. A decimal of the program is its double
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
    const admitted = rowsRead === e;
    rowsRead = undefined;
    const part = partsRead === e;
    partsRead = undefined;
    const v = nameValue(e, want);
    if (v !== undefined && partsInputs.has(v) && !part)
      partsDecline(e, e.symbol);
    // A list of rows whose lengths can differ is read by `rows.at` and
    // passed whole only: `Length`, `Map` or arithmetic of it would read it
    // as a scalar.
    if (v !== undefined && rowsParams.has(v) && !admitted)
      decline(
        e,
        `${e.symbol} of type ${engineTypeToString(e.type.type)} other than in an element read ${e.symbol}[i][j] or as an argument of a parameter of that type`
      );
    return v;
  };

  const nameValue = (
    e: Expression & { symbol: string },
    want: boolean
  ): V | undefined => {
    const name = e.symbol;
    if (name === 'Nothing') {
      if (want) decline(e, 'Nothing as a value', POSSIBLE_NOTHING);
      return undefined;
    }
    const known = lookup(name);
    // An input has one type: an occurrence of another type (a body boxed
    // where the name had another declaration) declines.
    if (
      known?.binding.role === 'input' &&
      !(known.binding.parts !== undefined
        ? tupleParts(e.type.type, cx.wide)
            ?.map((p) => `${p.lane}${p.list ? '[]' : ''}`)
            .join() ===
          known.binding.parts
            .map((x) => `${type(x).lane}${type(x).shape.length ? '[]' : ''}`)
            .join()
        : sameInput(
            type(known.binding.v),
            readAs(e.type.type, resolvedValueDefinition(e))
          ))
    )
      decline(
        e,
        `${name} read with two types, ${typeToString(type(known.binding.v))} and ${engineTypeToString(e.type.type)}`
      );
    if (known?.binding.role === 'input')
      note(name, e.type.type, resolvedValueDefinition(e));
    // A read of a whole list local written in place (`listLocal()`) is a
    // copy of its array at the read, so no later write changes the value
    // read (the interpreter's lists are values), except as the value of
    // its block, after its last write.
    if (known?.binding.role === 'list' && known.binding !== whole)
      return listCopy(known.binding.v, known.binding.lane!);
    if (known?.binding.parts)
      known.binding.role === 'input'
        ? partsDecline(e, name)
        : decline(e, 'a tuple of tuples');
    if (known) return known.binding.v;
    const k = options.vars?.indexOf(name) ?? -1;
    if (k >= 0) {
      note(name, e.type.type, resolvedValueDefinition(e));
      given(name, e.type.type);
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
    // The written absent value: NaN, as a selection that takes no arm
    // (`Coalesce(Missing, 3)` is 3).
    if (name === 'Missing') {
      if (isShadowedSymbol(e as never) || held(name)?.library !== true)
        decline(e, 'Missing is not the library symbol here');
      return b.constant(NaN, 'real');
    }
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
    return fns.capture(
      e,
      name,
      e.type.type,
      readAs(e.type.type, resolvedValueDefinition(e)),
      resolvedValueDefinition(e)
    );
  };

  /** The input `name` of the type `t`, which a function that `e` calls
   *  reads in the binding `def`: its binding when it is an input here, or a
   *  new input (of the entry, or of the function whose body has the call).
   *  Under a local or an index of that name (the variable of a `Sum` that
   *  the call is in), the input of the outer frame, when `def` is a
   *  binding of the name on the scope chain of the compilation
   *  (`onScopeChain()`), which the local is not (CE-1479). Under a
   *  parameter of that name of the function whose body has the call, on
   *  the same condition, an input of that function that the parameter does
   *  not hide (`capture()`, CE-1502). A positional input of that name at
   *  the entry, another binding (a `vars` name) or a name with a value
   *  declines. */
  const free = (
    e: Fn,
    name: string,
    t: Type,
    def?: BoxedValueDefinition
  ): V => {
    let known = lookup(name)?.binding;
    if (known !== undefined && known.role !== 'input') {
      const outer = frames[0].names.get(name);
      const param =
        outer !== undefined &&
        outer.role !== 'input' &&
        cx.inFunction !== undefined;
      if (
        !onScopeChain(name, def) ||
        (outer !== undefined && outer.role !== 'input' && !param)
      )
        decline(
          e,
          `a call of ${e.operator}, which reads the input ${name}, where ${name} is a local or a parameter`
        );
      if (param) {
        if (held(name)?.value !== undefined)
          decline(
            e,
            `a call of ${e.operator}, which reads the input ${name}, where ${name} has a value`
          );
        note(name, t);
        return fns.capture(
          e,
          name,
          t,
          readAs(t, held(name)?.definition),
          def,
          true
        );
      }
      known = outer;
    }
    note(name, t);
    if (known?.parts !== undefined) partsDecline(e, name);
    if (known !== undefined) return known.v;
    const k = options.vars?.indexOf(name) ?? -1;
    // A `vars` name (`symbol()`): its text, read here at the entry.
    if (k >= 0) {
      if (cx.inFunction !== undefined) return fns.capture(e, name, t);
      note(name, t, held(name)?.definition);
      given(name, t);
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
      : fns.capture(e, name, t, readAs(t, held(name)?.definition), def);
  };

  /** The IR type of an input of the engine type `t`; a tuple is the list of
   *  its elements, which `input()` marks a tuple. `any` is read as
   *  `unknown`: such an input is refused at the end (`program()`). */
  const inputIR = (t: Type) =>
    (interval ? enclosureInput(t) : undefined) ??
    textInput(t) ??
    tupleOrInputType(isUntyped(t) ? 'unknown' : t, cx.wide);

  /** A list of lists of two lengths not stated, on JavaScript: the host's
   *  array of arrays, held whole on the lane `rows` (`rowsElementLane()`).
   *  The bigint and the interval modes decline it. Only an input has it: a
   *  name with a value has the type of its value. */
  const rowsInput = (
    t: Type
  ): { lane: Lane; shape: (number | 'run-time')[] } | undefined =>
    options.javascript && !bigint && !interval && rowsElementLane(t)
      ? { lane: 'rows', shape: [] }
      : undefined;

  /** A string input (read once by `text.in`, `input()`), or a list of
   *  strings. */
  const textInput = (t: Type) => {
    const x = inputType(t, cx.wide, true);
    return x?.lane === 'string' ? x : undefined;
  };

  /** The type that the interval mode reads an input as, whose binding
   *  `def` declares no type: `real` when the inferred type `t` is a number
   *  type that is not read as a real or an integer (`complex | infinity`,
   *  which the signature of `Gamma` gives `x`). Every value that a host
   *  passes is a real interval, which is within `t`. A declared type, and
   *  every type on another target, is `t`. */
  const readAs = (t: Type, def: BoxedValueDefinition | undefined): Type => {
    if (!interval || def?.inferredType === false) return t;
    if (isUntyped(t) || !isSubtype(t, 'number')) return t;
    const lane = inputIR(t)?.lane;
    return lane === 'real' || lane === 'integer' ? t : 'real';
  };

  /** `ir`, the type of an input, is the IR type of the engine type `t`. */
  const sameInput = (ir: IRType, t: Type): boolean => {
    const x = inputIR(t) ?? rowsInput(t);
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
    // The binding of the occurrence, or, for a read in a function that `e`
    // calls, of the name in the scope of the compilation (`free()`).
    const def = positional
      ? undefined
      : isSymbol(e)
        ? resolvedValueDefinition(e)
        : held(name)?.definition;
    if (!positional) {
      note(name, t, def);
      given(name, t);
    }
    const ir = positional
      ? (textInput(t) ?? tupleOrInputType(t, cx.wide) ?? rowsInput(t))
      : (inputIR(readAs(t, def)) ?? rowsInput(t));
    if (ir === undefined && interval && isEnclosureCollection(t))
      decline(e, COLLECTION);
    if (!positional && interval && enclosureInput(t) !== undefined)
      enclosure = true;
    // A tuple whose parts have different lanes (`tuple<string, integer>`),
    // or a list among them (`tuple<integer, list<list<integer>>>`), on
    // JavaScript: a parameter of the entry for each part, read by `At` at
    // a constant index only (`partsRead`); a list of a run-time length has
    // a parameter of its length too, and a list of the lane `rows` is read
    // as such an input.
    const lanes =
      ir === undefined &&
      !positional &&
      !b.literal &&
      options.javascript &&
      !bigint &&
      !interval
        ? tupleParts(t, cx.wide)
        : undefined;
    if (lanes !== undefined) {
      const parts = lanes.map(({ lane, list }, j) => {
        if (list) {
          const length = b.param(name, scalarType('integer'), true, j);
          inputLengths.add(length);
          return b.param(name, { lane, shape: [{ v: length }] }, false, j);
        }
        const param = b.param(name, scalarType(lane), false, j);
        if (lane === 'rows') rowsParams.add(param);
        return lane === 'string'
          ? b.entryOp('text.in', [param], scalarType('string'))
          : param;
      });
      // No instruction defines it: a read of it that escapes the checks
      // fails the verification of the program.
      const v = b.newValue({ lane: 'string', shape: [lanes.length] });
      partsInputs.add(v);
      frames[0].names.set(name, { v, role: 'input', parts });
      return v;
    }
    // Named by the input, not by its declaration `Typed(…)`.
    if (ir === undefined)
      throw new Decline(
        name,
        `the input ${name} of type ${engineTypeToString(t)}`,
        undefined,
        hasUnsettledShape(t) ? UNSETTLED_SHAPE : undefined
      );
    const shape = ir.shape.map((n) => {
      if (n !== 'run-time') return n;
      const length = b.param(name, scalarType('integer'), true);
      inputLengths.add(length);
      if (positional) b.positional += 1;
      return { v: length };
    });
    const param = b.param(name, { lane: ir.lane, shape });
    if (ir.lane === 'rows') rowsParams.add(param);
    // A string is read once, as the engine boxes it (`text.in`); a list of
    // strings is read by `StringJoin` only, which conditions its elements.
    const v =
      ir.lane === 'string' && shape.length === 0
        ? b.entryOp('text.in', [param], scalarType('string'))
        : param;
    // The sign that the range of the declared type proves (`real<0..5>`,
    // `integer<1..>`), not the interval mode, whose enclosure of an input is
    // the host's.
    const declared =
      def !== undefined && !def.inferredType ? def.type.type : undefined;
    if (
      !interval &&
      shape.length === 0 &&
      (ir.lane === 'real' || ir.lane === 'integer') &&
      typeof declared === 'object' &&
      declared.kind === 'numeric' &&
      declared.lower !== undefined &&
      declared.lower >= 0
    )
      b.signs.set(
        v,
        declared.lower > 0 || declared.lowerOpen === true
          ? 'positive'
          : 'nonnegative'
      );
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
    const join = (
      x: V,
      y: V,
      cause: string,
      whole?: { points?: boolean }
    ): V => {
      const points = whole?.points === true;
      let t = joinType(type(x), type(y));
      // Flat lists of reals or integers of two lengths: one constant length
      // is a stated length; otherwise the length of the arm taken is a
      // result too, before the list (README, "Lists"). With `points` (a
      // list local written whole, `wholeLocal()`), lists of points of one
      // stated length too, and a flat list of booleans of such a local.
      const [n, m] = [type(x).shape, type(y).shape];
      const lane = joinType(scalarType(type(x).lane), scalarType(type(y).lane));
      const stated = (l: Length) => (typeof l === 'number' ? l : constant(l.v));
      const inner = n.slice(1);
      if (
        t === undefined &&
        ((n.length === 1 && !tuples.has(x)) ||
          (points &&
            n.length === 2 &&
            typeof n[1] === 'number' &&
            tuples.get(x) === 1)) &&
        m.length === n.length &&
        inner.every((l, k) => l === m[k + 1]) &&
        tuples.get(x) === tuples.get(y) &&
        (isSubLane(lane?.lane ?? 'boolean', 'real') ||
          (whole !== undefined && n.length === 1 && lane?.lane === 'boolean'))
      ) {
        const k = stated(n[0]);
        const [p, q] = [rowLength(x), rowLength(y)];
        // A stated length is at least 1: two empty arms keep the form below.
        if (
          k !== undefined &&
          k > 0 &&
          k === stated(m[0]) &&
          p === undefined &&
          q === undefined
        )
          t = { lane: lane!.lane, shape: [k, ...inner] };
        else {
          if (interval || !options.runtimeLengths)
            decline(node, 'arms that are lists of two lengths');
          const length = (r: Region, l: Length) => {
            if (typeof l !== 'number') return l.v;
            const out = b.newValue(scalarType('integer'));
            r.body.push({
              k: 'const',
              out,
              value: { lane: 'integer', value: l },
            });
            return out;
          };
          a.region.yields.push(length(a.region, n[0]));
          c.region.yields.push(length(c.region, m[0]));
          const l = b.newValue(scalarType('integer'));
          outs.push(l);
          // A row that can be absent (`rowLengths`) in an arm: the value of
          // `Length` of the arm taken is a result too, NaN where that row
          // is absent.
          if (p !== undefined || q !== undefined) {
            a.region.yields.push(p ?? length(a.region, n[0]));
            c.region.yields.push(q ?? length(c.region, m[0]));
            outs.push(b.newValue(scalarType('integer')));
            rowLengths.set(l, outs[outs.length - 1]);
          }
          t = { lane: lane!.lane, shape: [{ v: l }, ...inner] };
        }
      }
      // Arms of two ranks, or a tuple and a list, have no settled shape;
      // lists of two lengths do. Two lanes that do not join (a colour and
      // a real) keep 'outside-profile'.
      if (t === undefined || tuples.get(x) !== tuples.get(y))
        decline(
          node,
          t === undefined ? cause : 'arms of a tuple and a list',
          t !== undefined || n.length !== m.length ? UNSETTLED_SHAPE : undefined
        );
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
      return join(
        a.after[i],
        c.after[i],
        'a local written with two types',
        x.whole
      );
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
    // The element of a build whose length is a constant value (made in
    // the region, which the result cannot name) has that length.
    const ys = body.yields.map((y): IRType => {
      const t = type(y);
      if (op !== 'build') return t;
      return {
        lane: t.lane,
        shape: t.shape.map((n) => {
          if (typeof n === 'number') return n;
          const c = constant(n.v);
          return c !== undefined && c > 0 ? c : n;
        }),
      };
    });
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

  /** `x` is draws over literals: each node is a number, a constant of the
   *  library, or a call of the library's definition of a head of
   *  `SEEDED_CONSTANT_HEADS` (no user function of that name, no host compile
   *  handler), whose draws and `Range`s make at most
   *  `MAX_FOLD_EXPANDED_NODES` elements in all, by literal counts. It reads
   *  no name with a value (which a host can supply at run time through
   *  `vars`), no user function and no other effect, so under a constant
   *  seed its value is the same at every call, and its evaluation at compile
   *  time is bounded. */
  const seededConstant = (x: Expression): boolean => {
    if (size(x) > MAX_FOLD_EXPANDED_NODES) return false;
    // The elements that `N()` makes, summed over the whole body: a draw
    // makes its literal count (one with no count), a `Range` its length.
    // The walk has no memo: `size()` bounds the tree, and a shared node is
    // evaluated once per occurrence.
    let made = 0;
    const num = (b: Expression | number) =>
      typeof b === 'number' ? b : isNumber(b) && b.im === 0 ? b.re : NaN;
    const elements = (y: Fn): number => {
      if (y.operator === 'Random') return 1;
      if (y.operator === 'RandomChoice' || y.operator === 'RandomSample')
        return y.nops < 2 ? 1 : num(y.ops[1]);
      if (y.operator !== 'Range') return 0;
      const [lo, hi, step] =
        y.nops === 1 ? [1, y.ops[0], 1] : [y.ops[0], y.ops[1], y.ops[2] ?? 1];
      return Math.max(0, Math.floor((num(hi) - num(lo)) / num(step)) + 1);
    };
    const constant = (y: Expression): boolean => {
      // Only a constant of the library (`Pi`), not shadowed: a declared
      // constant can hold a value that reads a variable, and a name of
      // `vars` is an input.
      if (isSymbol(y))
        return (
          CONSTANTS.has(y.symbol) &&
          !options.vars?.includes(y.symbol) &&
          !isShadowedSymbol(y as never) &&
          held(y.symbol)?.library === true
        );
      if (isNumber(y)) return true;
      if (!isFunction(y) || !SEEDED_CONSTANT_HEADS.has(y.operator))
        return false;
      // The library's definition of the head: not a user function of the
      // same name, and no host compile handler.
      if (!isLibrary(y)) return false;
      made += elements(y);
      if (!(made <= MAX_FOLD_EXPANDED_NODES)) return false;
      return y.ops.every(constant);
    };
    return constant(x);
  };

  /** The interpreter's value of the held value `v`, a literal, when `v` is
   *  draws under a number as the seed that read no variable and have no
   *  other effect (`seededConstant()`): `a := WithRandomSeed(7,
   *  RandomChoice([0, 1), 3))`, a seeded list of Desmos (CE-1524), is the
   *  same at every call. A finite real, or a list of them. */
  const seededValues = new WeakMap<Expression, Expression | null>();
  const seededValue = (v: Expression): Expression | undefined => {
    let r = seededValues.get(v);
    if (r === undefined) {
      r = seededFold(v) ?? null;
      seededValues.set(v, r);
    }
    return r ?? undefined;
  };
  const seededFold = (v: Expression): Expression | undefined => {
    if (
      options.fold === false ||
      bigint ||
      interval ||
      !isFunction(v, 'WithRandomSeed') ||
      v.nops !== 2 ||
      !isNumber(v.ops[0]) ||
      !isLibrary(v) ||
      !seededConstant(v.ops[1])
    )
      return undefined;
    // An evaluation that throws (not a cancellation) keeps the frame.
    let n: Expression | undefined;
    try {
      n = v.N();
    } catch (error) {
      if (error instanceof Error && error.name === 'CancellationError')
        throw error;
      return undefined;
    }
    if (isNumber(n) && n.im === 0 && Number.isFinite(n.re)) return n;
    return size(n) <= MAX_FOLD_EXPANDED_NODES && finiteReals(n) ? n : undefined;
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
    // list made in the frame is a result too (the row `seeded`), also that
    // of a list local written whole in it (`wholeLocal()`).
    const made = (v: V) =>
      lengthValues(type(v)).filter((n) => n >= start && !inputLengths.has(n));
    const lengths = [
      ...new Set([
        ...changed.flatMap((x) => made(after[bindings.indexOf(x)])),
        ...(want ? made(result!) : []),
      ]),
    ];
    // A length before the lists whose types name it.
    region.yields.push(...lengths);
    region.yields.push(...changed.map((x) => after[bindings.indexOf(x)]));
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
    changed.forEach((x, j) => (x.v = outs[lengths.length + j]));
    return want ? outs[outs.length - 1] : undefined;
  };

  /** `c` is a list of booleans by its static type: a condition of an `If`
   *  or a `Which` that selects at each position. */
  const mask = (c: Expression) => c.type.matches('list<boolean>');

  /** `If` and `Which` of a list condition: the interpreter's selection at
   *  each position (`numpy.select`), a build over the length of the first
   *  condition whose element is the first arm whose condition is true
   *  there, a list arm read at the position and a scalar or a point (a
   *  condition, an arm) the same at every position; NaN, or a point of NaN,
   *  where none is, with no `otherwise`. The conditions and the arms are
   *  lowered once, before the build: the interpreter evaluates an arm (and
   *  a later condition) only where it is reached, so one that is not pure
   *  (an effect, a write to a name, an operation that can throw such as
   *  `AssertPresent`, a loop, a recursive call) declines, except a `Range`
   *  arm, read at each position and never built, and a build that `eager()`
   *  accepts by its length. The first condition is a
   *  list: before it, a scalar condition that holds selects its arm whole,
   *  a value of another shape. Stated lengths that differ decline (the
   *  interpreter gives `incompatible-dimensions`); run-time lengths that
   *  differ give an unspecified value, as for an element-wise operation.
   *  An `If` with no `otherwise` and a list arm is a restriction, which
   *  ends at the shorter of the mask and the arm. */
  const select = (
    node: Expression,
    clauses: [Expression, Expression][],
    otherwise: Expression | undefined
  ): V => {
    if (interval)
      decline(node, 'a selection at each position in the interval mode');
    const first = value(clauses[0][0])!;
    const lazy = [
      ...clauses.slice(1).map(([c]) => c),
      ...clauses.map(([, a]) => a),
      ...(otherwise === undefined ? [] : [otherwise]),
    ];
    if (lazy.some((x) => facts(x).writes.size > 0))
      decline(node, 'a selection at each position that writes a name');
    // The length of the mask, which exists: below 2^32.
    const masked = type(first).shape[0];
    // `x` lowered, which declines when it emits an instruction that is not
    // pure, other than a `build` of a length that `safe()` accepts: a build
    // fails only for a length of 2^32 or more.
    const eager = (x: Expression, safe: (n: Length, v: V) => boolean): V => {
      const start = b.impure.length;
      const v = value(x)!;
      for (const i of b.impure.slice(start))
        if (
          i.k !== 'region' ||
          i.op !== 'build' ||
          masked === undefined ||
          !safe(type(i.outs[0]).shape[0], v)
        )
          decline(
            node,
            'a selection at each position whose arms or later conditions are not pure'
          );
      return v;
    };
    // The interpreter evaluates every list condition up to the first scalar
    // condition that holds, and gives `incompatible-dimensions` for one of
    // another length than the mask: a build of the length of the mask, or
    // of a condition with no scalar condition before it, cannot fail where
    // the selection has a value.
    let scalar = false;
    const conds = [first];
    for (const [c] of clauses.slice(1)) {
      const v = eager(c, (n, v) =>
        [masked!, ...(scalar ? [] : type(v).shape.slice(0, 1))].some((m) =>
          same([n], [m])
        )
      );
      if (type(v).shape.length === 0) scalar = true;
      conds.push(v);
    }
    // The interpreter evaluates an arm only where a position selects it,
    // and reads it at the positions of the mask. A `Range` is the source of
    // its elements, built nowhere: its element at the position is computed
    // there (`ranges`). Another arm accepts a build of the length of the
    // mask only.
    const ranges = new Map<V, Source>();
    const arm = (a: Expression): V => {
      // A `Range` of number literals is a literal list of a stated length.
      if (!isFunction(a, 'Range') || !isLibrary(a) || a.ops.every(isNumber))
        return eager(a, (n) => same([n], [masked!]));
      const start = b.impure.length;
      const s = lists.source(a);
      // The type of an element, from a read in a region that is not
      // emitted; the list is a value that no instruction reads.
      const element = type(
        b.region([], () => [s.at(b.constant(0, 'integer'))]).yields[0]
      );
      if (b.impure.length > start)
        decline(
          node,
          'a selection at each position whose arms or later conditions are not pure'
        );
      const n = constant(s.length);
      const v = b.newValue({
        lane: element.lane,
        shape: [n ?? { v: s.length }],
      });
      ranges.set(v, s);
      return v;
    };
    const arms = clauses.map(([, a]) => arm(a));
    const rest = otherwise === undefined ? undefined : arm(otherwise);
    // A scalar, a flat list, a point, a list of points, or none of them.
    const kind = (v: V) => {
      const [axis, n] = [tuples.get(v), type(v).shape.length];
      if (axis === undefined) return ['scalar', 'list'][n];
      if (axis === 0 && n === 1) return 'point';
      if (axis === 1 && n === 2) return 'points';
      return undefined;
    };
    const listed = (v: V) => kind(v) === 'list' || kind(v) === 'points';
    if (kind(conds[0]) !== 'list')
      decline(clauses[0][0], 'a scalar condition before a list condition');
    conds.forEach((c, j) => {
      if (
        (kind(c) !== 'scalar' && kind(c) !== 'list') ||
        type(c).lane !== 'boolean'
      )
        decline(
          clauses[j][0],
          'a condition that is not a boolean or a list of booleans'
        );
    });
    // The arms are all numbers or booleans, or all points of numbers, as
    // the interpreter requires.
    const values = rest === undefined ? arms : [...arms, rest];
    const pointed = (v: V) => kind(v) === 'point' || kind(v) === 'points';
    for (const v of values)
      if (
        kind(v) === undefined ||
        pointed(v) !== pointed(values[0]) ||
        !(
          isSubLane(type(v).lane, 'real') ||
          (type(v).lane === 'boolean' && !pointed(v))
        )
      )
        decline(
          node,
          'a selection at each position of values that are not all numbers or booleans, or all points of numbers'
        );
    if (rest === undefined && values.some((v) => type(v).lane === 'boolean'))
      decline(
        node,
        'a selection at each position of booleans with no default (the interpreter gives Missing)'
      );
    const stated = new Set(
      [...conds, ...values].flatMap((v) => {
        if (!listed(v)) return [];
        const n = type(v).shape[0];
        const k = typeof n === 'number' ? n : constant(n.v);
        return k === undefined ? [] : [k];
      })
    );
    // An `If` with no else of a list arm is a restriction: it zips the mask
    // with the arm, to the shorter of the two lengths, as the interpreter's
    // (`evaluateRestriction()`).
    const restriction =
      node.operator === 'If' && rest === undefined && listed(arms[0]);
    if (stated.size > 1 && !restriction)
      decline(node, 'lists of two lengths in a selection at each position');
    // Where no condition holds: NaN, or a point of NaN coordinates.
    const absent = (): V => {
      if (!pointed(values[0])) return b.constant(NaN, 'real');
      const t = type(values[0]).shape;
      const n = t[kind(values[0]) === 'point' ? 0 : 1];
      if (typeof n !== 'number')
        decline(node, 'a point whose length is not one number');
      const nan = Array.from({ length: n }, () => b.constant(NaN, 'real'));
      const p = b.list(nan, { lane: 'real', shape: [n] });
      tuples.set(p, 0);
      return p;
    };
    const cell = (v: V, k: V) =>
      (ranges.get(v) ?? (listed(v) ? lists.listSource(v) : undefined))?.at(k) ??
      v;
    const pick = (j: number, k: V): V => {
      if (j === clauses.length)
        return rest === undefined ? absent() : cell(rest, k);
      return branch(
        node,
        cell(conds[j], k),
        () => cell(arms[j], k),
        () => pick(j + 1, k),
        true
      )!;
    };
    const masks = lists.listSource(conds[0]);
    return lists.over(
      node as Fn,
      restriction
        ? {
            ...masks,
            length: lists.shortest(node as Fn, [
              masks,
              lists.listSource(arms[0]),
            ]),
          }
        : masks,
      '',
      (_x, k) => pick(0, k),
      false,
      node
    );
  };

  /** `If` and `Which`: a chain of conditionals whose last arm is
   *  `otherwise` (absent: NaN, the value of a selection that takes no
   *  arm; for an `If` whose arm is a tuple of numbers, the tuple of NaN,
   *  and whose arm is a list of numbers or of points, a list of NaN of its
   *  length: a `Which` gives `Missing`). `start` is the first value of the
   *  arm before `otherwise`. */
  const conditional = (
    node: Expression,
    clauses: [Expression, Expression][],
    otherwise: Expression | undefined,
    want: boolean,
    first?: V,
    start = b.types.length
  ): V | undefined => {
    if (clauses.length === 0) {
      if (otherwise !== undefined) return value(otherwise, want);
      if (!want) return undefined;
      const t = first === undefined ? undefined : type(first);
      // An `If` whose arm is a flat list of numbers or a list of points:
      // the list of NaN, or of points of NaN, of the length of the arm (a
      // Desmos restriction of a list of curves). A length made in the arm
      // is not visible in the other arm, and declines.
      const axis = first === undefined ? undefined : tuples.get(first);
      if (
        node.operator === 'If' &&
        t !== undefined &&
        isSubLane(t.lane, 'real') &&
        ((t.shape.length === 1 && axis === undefined) ||
          (t.shape.length === 2 &&
            axis === 1 &&
            typeof t.shape[1] === 'number'))
      ) {
        const [n, m] = t.shape;
        // The interpreter's value is `Missing`, which a discharge, `Length`
        // or `Rest` reads as absent; a list is never absent in compiled
        // code (`absent()`), so the list of NaN is the value only where no
        // such operator can read it (`nanForAbsent()`).
        if (!nanForAbsent(node)) declineNanList(node);
        // A node of a body is accepted for the calls of the body
        // (`bodies`), which a later held value does not change: a name that
        // a reached body reads is never a holder (`heldAsAbsent()`).
        if (bodies.size === 0) nanAccepted.add(node);
        if (typeof n !== 'number' && n.v >= start && !inputLengths.has(n.v))
          decline(
            node,
            'an If with no else whose list arm has a length made in the arm'
          );
        const nan = () => {
          if (m === undefined) return b.constant(NaN, 'real');
          const xs = Array.from({ length: m as number }, () =>
            b.constant(NaN, 'real')
          );
          const p = b.list(xs, { lane: 'real', shape: [m] });
          tuples.set(p, 0);
          return p;
        };
        const length = typeof n === 'number' ? b.constant(n, 'integer') : n.v;
        return lists.over(
          node as Fn,
          { length, at: (k) => k },
          '',
          nan,
          false,
          node
        );
      }
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
    // A decided condition (a constant: a closed condition is folded, and
    // the interval mode decides one too) takes its arm, and the other is
    // not lowered: the interpreter does not evaluate it, so an arm that
    // would decline (`Less(x, Sqrt(-0.44))`) does not decline the program.
    // A false one with no arm after it is lowered: the shape of the missing
    // value is the shape of its arm.
    // Outside the interval mode, the arms are still compared
    // (`docs/COMPILATION-MODEL.md`, "The arms of a conditional are compared
    // on every target"): an arm is left out only when there is an
    // `otherwise` and the static types of all the arms are one scalar kind
    // (integer, real or boolean), so that the comparison of `branch()`
    // could not decline and its join could not widen the lane of the
    // result (an integer to a real on GLSL, a real to a complex, a number
    // to the NaN of no arm taken). Otherwise both arms are lowered, and the
    // `fold` pass removes the one not taken.
    const arms = [then, ...rest.map(([, a]) => a)];
    if (otherwise !== undefined) arms.push(otherwise);
    const kind = (a: Expression) =>
      isSubtype(a.type.type, 'integer')
        ? 'integer'
        : isSubtype(a.type.type, 'real')
          ? 'real'
          : isSubtype(a.type.type, 'boolean')
            ? 'boolean'
            : undefined;
    const scalarArms =
      otherwise !== undefined &&
      kind(then) !== undefined &&
      arms.every((a) => kind(a) === kind(then));
    const decided =
      interval || (options.fold !== false && scalarArms)
        ? b.constants.get(cond)
        : undefined;
    if (decided === true) return value(then, want);
    if (
      decided === false &&
      (rest.length > 0 || otherwise !== undefined || first !== undefined)
    )
      return conditional(node, rest, otherwise, want, first, start);
    const at = b.types.length;
    return branch(
      node,
      cond,
      () => (first = value(then, want)),
      () => conditional(node, rest, otherwise, want, first, at),
      want
    );
  };

  /** Whether `v` is absent, the test of the discharges (`IsMissing`,
   *  `Coalesce`, `AssertPresent`), chosen from its static type as the
   *  producers spell an absent value (`docs/COMPILATION-MODEL.md`): NaN for
   *  a number (a complex number with a NaN part), a point whose
   *  coordinates are all NaN, `undefined` for a boolean or a string on
   *  JavaScript (only JavaScript has strings). No compiled value of
   *  another kind is absent (a list, the rows, a tuple of another lane, a
   *  boolean on GLSL or in the interval mode: each producer of one
   *  declines), so its test is `false`. A colour has no absent value to
   *  test either, but its producer that can give one (an `At` out of
   *  range) refuses only after the passes: `Coalesce` and `AssertPresent`
   *  keep the colour as their value, so the producer still refuses, while
   *  `IsMissing` would let `dce` remove it first, and declines.
   *  A NaN on the real lane is also a complex value of the interpreter
   *  (`Sqrt(x)` at `x = -4`), which is not absent: the test of an
   *  `operand` whose engine type admits a value that is not real declines,
   *  where its value is on the real lane. An input is not tested: a value
   *  that is not real there is outside its type in `strict` (a `number`
   *  input must be real). */
  const absent = (node: Expression, operand: Expression, v: V): V => {
    const t = type(v);
    const nan = (x: V) => apply(node, ofOp('isnan'), [x]);
    // The NaN of `MaxBy` and `MinBy` stands for a form that the interpreter
    // leaves unevaluated, which is not absent.
    if (
      (isFunction(operand, 'MaxBy') || isFunction(operand, 'MinBy')) &&
      isLibrary(operand)
    )
      decline(
        node,
        `${node.operator} of ${operand.operator} (the interpreter leaves it unevaluated where it has no value)`
      );
    if (
      isSubLane(t.lane, 'real') &&
      !(
        isSymbol(operand) &&
        frames[0].names.get(operand.symbol) === lookup(operand.symbol)?.binding
      )
    ) {
      const ot = operand.type.type;
      const kinds =
        typeof ot === 'object' && ot.kind === 'tuple'
          ? ot.elements.map((x) => x.type)
          : [ot];
      if (kinds.some((k) => typesOverlap(k, 'imaginary')))
        decline(
          node,
          `${node.operator} of a value of type ${operand.type.toString()} on the real lane`
        );
    }
    if (t.shape.length === 0 && isSubLane(t.lane, 'real')) return nan(v);
    if (t.shape.length === 0 && t.lane === 'complex')
      return apply(node, 'Or', [
        nan(apply(node, ofOp('cre'), [v])),
        nan(apply(node, ofOp('cim'), [v])),
      ]);
    if (tuples.get(v) === 0 && t.shape.length === 1) {
      const n = t.shape[0];
      if (t.lane === 'complex' || typeof n !== 'number')
        decline(node, `${node.operator} of a point of complex numbers`);
      if (isSubLane(t.lane, 'real'))
        return Array.from({ length: n }, (_, k) =>
          nan(apply(node, 'At', [v, b.constant(k + 1, 'integer')]))
        ).reduce((x, y) => apply(node, 'And', [x, y]));
    }
    if (
      t.shape.length === 0 &&
      (t.lane === 'string' || (t.lane === 'boolean' && options.javascript))
    )
      return apply(node, ofOp('isundef'), [v]);
    // A row at an index known at run time: absent where its `Length` is.
    const length = rowLength(v);
    if (length !== undefined) return nan(length);
    if (
      t.shape.length === 0 &&
      t.lane === 'color' &&
      node.operator === 'IsMissing'
    )
      decline(node, `${node.operator} of a colour`);
    return b.constant(false, 'boolean');
  };

  /** The call that `Pipe(x, f)` evaluates, or `undefined` for a stage that
   *  is not a canonical function literal of one parameter, a name or a call
   *  that takes the topic as an implicit argument. */
  const pipeCall = (e: Fn): Expression | undefined => {
    if (e.nops !== 2) return undefined;
    const [topic, stage] = [e.ops[0].canonical, e.ops[1]];
    if (isFunction(stage, 'Function'))
      return stage.isCanonical && stage.nops === 2
        ? ce.function('Apply', [stage, topic])
        : undefined;
    if (isSymbol(stage)) return ce.function(stage.symbol, [topic]);
    const completed = pipeStageAsCall(ce as never, topic, stage);
    return completed?.topicAt !== undefined ? completed.call : undefined;
  };

  /** `Coalesce(a, b, …)`: the first operand that is not absent, or the
   *  last; each operand after the first is lowered in an arm, only when
   *  the operands before it are absent. Arms of two shapes decline. */
  const coalesce = (e: Fn, i: number): V => {
    const v = value(e.ops[i])!;
    if (i === e.nops - 1) return v;
    return branch(
      e,
      absent(e, e.ops[i], v),
      () => coalesce(e, i + 1),
      () => v,
      true
    )!;
  };

  /** `AssertPresent(v)`: `v`, or on JavaScript and in the interval mode a
   *  throw where `v` is absent (the interpreter gives the error
   *  `expected-present`); a value that can be absent declines on GLSL. */
  const present = (e: Fn, v: V): V => {
    if (rowLength(v) !== undefined)
      decline(e, 'AssertPresent of a row at an index known at run time');
    const m = absent(e, e.ops[0], v);
    if (b.constants.get(m) === false) return v;
    if (!options.javascript && !interval)
      decline(e, 'AssertPresent of a value that can be absent');
    const t = type(v);
    if (t.shape.length === 0) return apply(e, ofOp('present'), [m, v]);
    // A point: each coordinate.
    return tuple(
      e,
      Array.from({ length: t.shape[0] as number }, (_, k) =>
        apply(e, ofOp('present'), [
          m,
          apply(e, 'At', [v, b.constant(k + 1, 'integer')]),
        ])
      )
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
      if (t === undefined)
        decline(
          e,
          'elements of two types',
          type(v).shape.length !== type(elements[0]).shape.length
            ? UNSETTLED_SHAPE
            : undefined
        );
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
   *  shortest component: the `Min` of the lengths (on a target without
   *  run-time lengths, GLSL, written out through `lists.over()`, a `Map`). */
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
    const at = (k: V) =>
      tuple(
        e,
        parts.map((v) =>
          type(v).shape.length === 0 ? v : lists.listSource(v).at(k)
        )
      );
    // A target with no run-time length (GLSL) writes out a list of points
    // of a constant length as a `Map` over it, the tuple at each index: a
    // reader of the points (`Abs`, `PointX`) then reads each one.
    if (options.runtimeLengths === false)
      return lists.over(e, { length, at }, '', (x) => x, false, e);
    return lists.built(e, length, at);
  };

  const local = (s: Expression, v: V, lane: Lane): V => {
    if (!widensTo(type(v).lane, lane))
      decline(
        s,
        `a value that is not ${lane}`,
        type(v).lane === 'complex' && isSubLane(lane, 'real')
          ? LANE_MISMATCH
          : undefined
      );
    return widen(v, lane);
  };

  /** The names of the pattern `p` (a name, `_`, or a `Tuple` of patterns)
   *  of the statement `s`, each with its value and the expression of that
   *  value when there is one, as the interpreter binds them: a `Tuple`
   *  value of the length of a `Tuple` pattern binds its elements; another
   *  value, `x` or the value of the expression `x`, must be a point of
   *  that length (a list or a scalar is an error in the interpreter) and
   *  binds a name to each of its elements. Every element is evaluated, in
   *  order, before a name is bound. A pattern that names a name twice, or
   *  a length that differs, declines. */
  const destructure = (
    s: Expression,
    p: Expression,
    x: Expression | V
  ): [string, V, Expression | undefined][] => {
    if (interval) decline(s, 'a destructuring pattern in the interval mode');
    const names = patternNames(p);
    const twice = names.find((n, k) => names.indexOf(n) !== k);
    if (twice !== undefined) decline(s, `a pattern that names ${twice} twice`);
    const out: [string, V, Expression | undefined][] = [];
    const bind = (q: Expression, y: Expression | V): void => {
      if (isSymbol(q)) {
        const v = typeof y === 'number' ? y : value(y)!;
        if (q.symbol !== '_')
          out.push([q.symbol, v, typeof y === 'number' ? undefined : y]);
        return;
      }
      if (!isFunction(q, 'Tuple'))
        decline(s, 'a pattern that is not a name or a Tuple');
      if (typeof y !== 'number' && isFunction(y, 'Tuple')) {
        if (y.nops !== q.nops)
          decline(
            s,
            `a pattern of ${q.nops} names for a tuple of ${y.nops} elements`
          );
        q.ops.forEach((z, k) => bind(z, y.ops[k]));
        return;
      }
      const v = typeof y === 'number' ? y : value(y)!;
      const t = type(v);
      if (tuples.get(v) !== 0 || t.shape.length !== 1 || t.shape[0] !== q.nops)
        decline(
          s,
          `a pattern of ${q.nops} names for a value that is not a point of ${q.nops} elements`
        );
      q.ops.forEach((z, k) =>
        bind(z, b.op('elem', [v, b.constant(k, 'integer')], scalarType(t.lane)))
      );
    };
    bind(p, x);
    return out;
  };

  /** The engine type of the first read of `name` in `xs` that has one, or
   *  `real` when `xs` holds a `Power`, which can lower to a real where the
   *  engine type is `integer` (`i^2` of an `i` on the real lane). */
  const readType = (xs: readonly Expression[], name: string): Type => {
    let t: Type = 'unknown';
    const power = (x: Expression): boolean => {
      if (t === 'unknown' && isSymbol(x, name)) t = x.type.type;
      // An integer power (`integerPower()`) stays on the integer lane.
      return (
        isFunction(x) &&
        ((x.operator === 'Power' && integerPower(x) === undefined) ||
          x.ops.some(power))
      );
    };
    return xs.some(power) ? 'real' : t;
  };

  const block = (e: Fn, want: boolean): V | undefined =>
    withFrame(false, (frame) => {
      let result: V | undefined;
      /** Bind `n`, declared by the statement `s` of index `i` with the
       *  value `v` (of the expression `x`, when there is one) and the type
       *  `typeName`: a list or a tuple is a constant, a scalar a local of
       *  its lane. */
      const bindLocal = (
        s: Expression,
        i: number,
        n: string,
        v: V,
        x: Expression | undefined,
        typeName: string,
        constant: Expression | undefined
      ): void => {
        if (type(v).shape.length > 0) {
          if (typeName !== 'unknown')
            decline(
              s,
              `a list value for a local declared ${typeName}`,
              UNSETTLED_SHAPE
            );
          frame.names.set(n, { v, role: 'constant' });
          return void (result = v);
        }
        // With no type, a number is a real: a later write of a real to
        // `let t = 0` is valid. An integer stays one in the bigint mode,
        // and where a later read has an integer engine type (its type
        // after every write) and no `Power` follows (`readType()`): a
        // write that is not an integer then declines (`local()`).
        const lane: Lane =
          typeName !== 'unknown'
            ? (typeName as Lane)
            : bigint ||
                !isSubLane(type(v).lane, 'real') ||
                (type(v).lane === 'integer' &&
                  isSubtype(readType(e.ops.slice(i), n), 'integer'))
              ? type(v).lane
              : 'real';
        result = local(s, v, lane);
        const unwritten = !e.ops.some((y) => facts(y).writes.has(n));
        frame.names.set(n, {
          v: result,
          lane,
          role: isSymbol(constant, 'True') ? 'constant' : 'local',
          exact: unwritten && x !== undefined ? literalNumber(x) : undefined,
        });
      };
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
          const pattern = isFunction(name, 'Tuple') ? name : undefined;
          if (
            (!isSymbol(name) && pattern === undefined) ||
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
          if (pattern !== undefined) {
            // `let (a, b) = p`: every element is evaluated, then each name
            // is a local of the lane of its value. The interpreter checks
            // a stated type against every element and binds no name when
            // one does not fit.
            if (typeName !== 'unknown')
              decline(s, 'a destructuring declaration that states a type');
            for (const [n, v, x] of destructure(s, pattern, value)) {
              if (
                type(v).shape.length > 0 &&
                e.ops.slice(i + 1).some((y) => facts(y).writes.has(n))
              )
                decline(s, `a list or a point ${n} that the block writes`);
              bindLocal(s, i, n, v, x, typeName, constant);
            }
            return void (result = undefined);
          }
          // The pattern branch returned: `name` is a symbol (narrows the type).
          if (!isSymbol(name)) return;
          // A list local that the block writes is written in place
          // (`listLocal()`); its declared type can be a list type.
          const written = e.ops
            .slice(i + 1)
            .some((x) => facts(x).writes.has(name.symbol));
          const scalarLocal = [
            'real',
            'integer',
            'boolean',
            'complex',
            'unknown',
          ].includes(typeName);
          // A local that every write of its scope gives a whole value
          // (`wholeLocal()`).
          const rebuilt =
            written && rebuiltOnly(e.ops.slice(i + 1), name.symbol);
          const listType =
            written && !scalarLocal && !rebuilt
              ? inputType(ce.type(typeName).type)
              : undefined;
          const wholeType =
            rebuilt && !scalarLocal
              ? tupleOrInputType(ce.type(typeName).type)
              : undefined;
          if (!scalarLocal && listType === undefined && wholeType === undefined)
            decline(s, `a local of type ${typeName}`);
          // A constant list that a later statement writes declines (the
          // interpreter refuses the write: `constant-assignment`).
          if (rebuilt && !scalarLocal && isSymbol(constant, 'True'))
            decline(s, 'a write to a constant list local');
          // An empty list of a stated type has the type of the local.
          if (rebuilt && wholeType !== undefined && isEmptyList(value)) {
            const owned = wholeLocal(s, undefined, wholeType, typeName);
            frame.names.set(name.symbol, owned);
            return void (result = owned.v);
          }
          // A list (or a tuple) local of no stated type is its value, a
          // local that no `Assign` writes (`assign()` declines one).
          const v = cx.value(value)!;
          if (rebuilt && (!scalarLocal || type(v).shape.length > 0)) {
            if (isSymbol(constant, 'True'))
              decline(s, 'a write to a constant list local');
            if (
              typeName === 'unknown' &&
              (!value.type.matches('list') || value.type.matches('range'))
            )
              decline(
                s,
                `a list local written whole whose value is of type ${value.type.toString()}`
              );
            const owned = wholeLocal(s, v, wholeType, typeName);
            frame.names.set(name.symbol, owned);
            return void (result = owned.v);
          }
          if (written && type(v).shape.length > 0) {
            // The interpreter refuses a write to a constant, and to a local
            // whose type it infers from its value as a type that is not a
            // list (`let L = 1..3` is a `range`).
            if (isSymbol(constant, 'True'))
              decline(s, 'a write to a constant list local');
            if (
              listType === undefined &&
              (!value.type.matches('list') || value.type.matches('range'))
            )
              decline(
                s,
                `a list local written in place whose value is of type ${value.type.toString()}`
              );
            const owned = listLocal(s, e.ops.slice(i + 1), name.symbol, v, [
              typeName,
              listType,
            ]);
            frame.names.set(name.symbol, owned);
            return void (result = owned.v);
          }
          if (listType !== undefined)
            decline(
              s,
              `a value that is not a list for a local of type ${typeName}`
            );
          bindLocal(s, i, name.symbol, v, value, typeName, constant);
        } else if (isFunction(s, 'DefineFunction')) {
          // `f(x) = …` of a program: the canonical form installed the clause,
          // and a call of `f` is a call of the user function of that binding.
          // The statement writes nothing in compiled code when every call
          // of `f` in the block binds a literal of the same form (not another
          // clause; a recursive literal is canonicalized again); a
          // recursive call in the literal is the function being lowered.
          const [name, literal] = s.ops;
          const calls = (x: Expression): Fn[] =>
            isFunction(x) && x !== literal
              ? [
                  ...(isSymbol(name) && x.operator === name.symbol ? [x] : []),
                  ...x.ops.flatMap(calls),
                ]
              : [];
          if (
            s.nops !== 2 ||
            !isSymbol(name) ||
            !isFunction(literal, 'Function') ||
            calls(e).some((c) => !userBinding(c)?.literal.isSame(literal))
          )
            decline(
              s,
              'a function definition that is not the binding of its calls'
            );
          result = undefined;
        } else {
          // The value of the block, `L` or `Typed(L, …)` of a list local
          // of the block written in place: its array, after every write.
          const read = isFunction(s, 'Typed') ? s.ops[0] : s;
          const own =
            i === e.nops - 1 && isSymbol(read)
              ? frame.names.get(read.symbol)
              : undefined;
          const before = whole;
          if (own?.role === 'list') whole = own;
          try {
            result = value(s, want && i === e.nops - 1);
          } finally {
            whole = before;
          }
        }
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
      // A block that ends in a declaration or an assignment is `Nothing`.
      if (
        want &&
        ['Assign', 'Declare', 'DefineFunction'].includes(
          e.ops[e.nops - 1].operator
        )
      )
        decline(e, 'a block that ends in an assignment (Nothing)');
      if (want && result === undefined) decline(e, 'a block with no value');
      return result;
    });

  /** The list `l` of a `Loop` clause when it is a literal `List` of
   *  `Tuple`s of one length of which a part is a tuple (a tuple of tuples,
   *  `for gap in [(A, B, C), …]`): the list of the parts at each position
   *  (a list of points for the tuples), on JavaScript; otherwise
   *  `undefined`. */
  const tupleColumns = (l: Expression): V[] | undefined => {
    // A literal `List` and `Tuple` rows of the library (a user definition
    // or a host handler takes the normal path).
    if (!options.javascript || interval || !literalList(cx, l)) return;
    const rows = l.ops;
    const m = isFunction(rows[0], 'Tuple') ? rows[0].nops : 0;
    if (
      m === 0 ||
      !rows.every(
        (r) => isFunction(r, 'Tuple') && r.nops === m && isLibrary(r)
      ) ||
      !rows.some((r) => (r as Fn).ops.some((x) => x.type.matches('tuple')))
    )
      return undefined;
    // The interpreter reads the elements in order, row by row: they are
    // lowered in that order (a write of a local in an element reads as the
    // interpreter's), then read by column; an effect declines.
    const effects = b.effects;
    const cells = rows.map((r) => (r as Fn).ops.map((x) => value(x)!));
    if (b.effects > effects)
      decline(l, 'a list of tuples of tuples with an effect');
    return Array.from({ length: m }, (_, j) =>
      list(
        l,
        cells.map((c) => c[j])
      )
    );
  };

  /** `Loop(body, Element(i, L), …)`, a statement whose value is
   *  `Nothing`: a counted loop per clause (a later clause is lowered in the
   *  body of the one before it, so it reads its index), whose carried
   *  values are the locals declared outside it that the body writes. Each
   *  pass is a pass of the `iterationBudget` (`passes`). A `Break` sets the
   *  carried flag `DONE`, the `exit` of every clause; a `Break` or a
   *  `Continue` sets `SKIP` (`DONE` itself when there is no `Continue`),
   *  under which `block()` skips the rest of the pass. `Loop(body)`, with
   *  no clause, is one counted loop of 2^53 passes whose `exit` is `DONE`
   *  (JavaScript only): a `Break` or the `iterationBudget` ends it. */
  const loop = (e: Fn, want: boolean, parallel = false): undefined => {
    if (want) decline(e, 'the value of a Loop (Nothing)');
    const bare = e.nops === 1;
    if (bare && (interval || !options.javascript))
      decline(e, 'a Loop with no Element clause (JavaScript only)');
    const heads = jumps(e.ops[0]);
    if (heads & 4)
      decline(e, 'a Break or a Continue in a function literal in a Loop');
    const flag = (): Binding => ({
      v: b.constant(false, 'boolean'),
      lane: 'boolean',
      role: 'local',
    });
    const done = heads & 1 || bare ? flag() : undefined;
    const carried = [...facts(e).writes].flatMap((n) => {
      const x = lookup(n);
      return x?.binding.role === 'local' && !x.outer ? [x.binding] : [];
    });
    if (done) carried.push(done);
    // A list local written whole is carried as two values: its length, then
    // the list of that length (`wholeLocal()`). `slot` is the position of
    // the value of each binding.
    let slots = 0;
    const slot = carried.map((x) => (slots += x.whole ? 2 : 1) - 1);
    const exit = done ? { exit: slots - 1 } : {};
    const carry = (x: Binding): V[] => {
      if (x.whole === undefined) return [x.v];
      // The carried length is a new value, which `rowLengths` does not
      // name: a row that can be absent would read as present after the
      // loop.
      if (rowLength(x.v) !== undefined)
        decline(e, 'a row at an index known at run time carried by a loop');
      const n = type(x.v).shape[0];
      return [typeof n === 'number' ? b.constant(n, 'integer') : n.v, x.v];
    };
    /** A counted loop from `lo` to `hi` whose pass runs `pass(k)` of its
     *  index `k`, the carried values bound to the parameters. `mark`: the
     *  loop of the first clause of a `ParallelLoop` (`parallel`). */
    const counted = (
      lo: V,
      hi: V,
      pass: (k: V) => void,
      mark = false
    ): void => {
      const init = carried.flatMap((x) =>
        x.whole ? carry(x) : [widen(x.v, x.lane!)]
      );
      const k = b.newValue(scalarType('integer'));
      const params = carried.flatMap((x) => {
        if (x.whole === undefined) return [b.newValue(scalarType(x.lane!))];
        const n = b.newValue(scalarType('integer'));
        const shape = [{ v: n }, ...x.whole.inner];
        const l = b.newValue({ lane: x.lane!, shape });
        if (x.whole.points) tuples.set(l, 1);
        return [n, l];
      });
      const body = b.region([k, ...params], () => {
        carried.forEach((x, i) => (x.v = params[slot[i]]));
        pass(k);
        return carried.flatMap(carry);
      });
      // The type of a carried list names the length carried before it.
      const outs: V[] = [];
      for (const v of params)
        outs.push(
          keep(
            v,
            b.newValue(mapLengths(type(v), (n) => outs[params.indexOf(n)]))
          )
        );
      b.emit({
        k: 'loop',
        outs,
        lo,
        hi,
        init,
        body,
        passes: true,
        ...exit,
        ...(mark ? { parallel: true } : {}),
      });
      carried.forEach((x, i) => (x.v = outs[slot[i]]));
    };
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
      if (!isSymbol(index) && !isFunction(index, 'Tuple'))
        decline(c, 'a Loop index that is not a name or a Tuple of names');
      const columns = tupleColumns(c.ops[1]);
      if (columns !== undefined) {
        // A literal list of tuples of tuples: the loop runs over an index
        // into a list per position of the tuples, and binds the element to
        // the parts at that index (`At` of a constant index reads one).
        const ss = columns.map((l) => lists.listSource(l));
        const hi = b.constant((c.ops[1] as Fn).nops - 1, 'integer');
        return counted(
          b.constant(0, 'integer'),
          hi,
          (k) =>
            withFrame(false, (frame) => {
              const parts = ss.map((s) => s.at(k));
              if (isSymbol(index))
                frame.names.set(index.symbol, { v: k, role: 'index', parts });
              else {
                if (index.nops !== parts.length)
                  decline(
                    c,
                    `a pattern of ${index.nops} names for a tuple of ${parts.length} elements`
                  );
                const names = patternNames(index);
                const twice = names.find((n, i) => names.indexOf(n) !== i);
                if (twice !== undefined)
                  decline(c, `a pattern that names ${twice} twice`);
                index.ops.forEach((q, j) => {
                  for (const [n, v] of destructure(c, q, parts[j]))
                    frame.names.set(n, { v, role: 'index' });
                });
              }
              clause(j + 1);
            }),
          parallel && j === 1
        );
      }
      const s = lists.source(c.ops[1]);
      const lo = b.constant(0, 'integer');
      const hi = apply(c, 'Subtract', [s.length, b.constant(1, 'integer')]);
      counted(
        lo,
        hi,
        (k) =>
          withFrame(false, (frame) => {
            // `for (p, q) in L` of a list of points binds each name to an
            // element of the point (`destructure()`).
            const x = s.at(k);
            if (isSymbol(index))
              frame.names.set(index.symbol, { v: x, role: 'index' });
            else
              for (const [n, v] of destructure(c, index, x))
                frame.names.set(n, { v, role: 'index' });
            clause(j + 1);
          }),
        parallel && j === 1
      );
    };
    if (bare)
      counted(
        b.constant(0, 'integer'),
        b.constant(2 ** 53 - 1, 'integer'),
        () => clause(1)
      );
    else clause(1);
    return undefined;
  };

  /** The `Break` (1) and the `Continue` (2) of the Loop whose body is `x`,
   *  not of a Loop in it; 4 when one is in a function literal. Memoized: a
   *  shared node is visited once. */
  const jumped = new WeakMap<Expression, number>();
  const jumps = (x: Expression): number => {
    if (
      !isFunction(x) ||
      x.operator === 'Loop' ||
      x.operator === 'ParallelLoop'
    )
      return 0;
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
        if (
          !(error instanceof Decline) ||
          error instanceof WidenList ||
          (!any && fns.begun() !== begun)
        )
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
  /** The integrals lowered as their quadrature, the arm taken when their
   *  closed form is NaN. */
  const quadratureOnly = new WeakSet<Expression>();
  /** `Integrate(f, Limits(t, a, b))` or `NIntegrate(f, a, b)`, of real
   *  bounds and a real integrand (a function literal of one parameter, or
   *  a body in the name of the `Limits`): the region `integrate`, whose
   *  value is within the tolerance of the engine's quadrature. The
   *  integrand has no effectful operation: the routine chooses its
   *  samples. */
  const integral = (e: Fn): V => {
    const [f, limits] = e.ops;
    // The interval mode: an indefinite integral (no bounds, or a bound
    // `Nothing`) is its closed form, as on the earlier interval target;
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
      // The closed form reads the variable of the integral through the
      // binding of its `Limits`; the code reads the input of that name, so
      // its occurrences are read with the binding of the scope of the
      // compilation (its declared type, or no type).
      const variable =
        isFunction(limits, 'Limits') && isSymbol(limits.ops[0])
          ? limits.ops[0].symbol
          : undefined;
      return scalar(
        variable === undefined
          ? c
          : c.subs({ [variable]: e.engine.symbol(variable) })
      );
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
    // JavaScript: the closed form that the engine gives at compile time,
    // with the guards of `closedForm()`; with none,
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
      !quadratureOnly.has(e) &&
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
        const v = c.yields[0];
        // The closed form is NaN at a bound where the integrand has an
        // integrable singularity (`∫ ln(t) dt` from `a` = 0 is
        // `a − a·ln(a) − …`): there the quadrature runs. An integral whose
        // quadrature does not lower keeps the closed form alone.
        quadratureOnly.add(e);
        try {
          if (trial(() => integral(e)) === undefined) return v;
          const nan = apply(e, ofOp('isnan'), [v]);
          return branch(
            e,
            nan,
            () => integral(e),
            () => v,
            true
          )!;
        } finally {
          quadratureOnly.delete(e);
        }
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
    // the earlier interval target computed the invariants of an integrand
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
    // The interval mode: the closed form, as on the earlier interval target,
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
      ...realBody(e, name, literal?.ops[0] ?? f, 'an integrand', true),
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
    what: string,
    log = false
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
          // A sample that is not finite: its finite value in log space, if any.
          const form =
            log && options.javascript && logSpaceProduct(body, [name]);
          if (!form) return [y];
          const big = b.constant(Infinity, 'real');
          const fin = (v: V) => apply(e, 'Less', [apply(e, 'Abs', [v]), big]);
          const keep = () => y;
          const alt = () => {
            const w = scalar(form);
            return branch(e, fin(w), () => w, keep, true);
          };
          return [branch(e, fin(y), keep, alt, true)!];
        }),
    ];
  };

  /** The binding of the local that `e` writes as `name`: a local declared
   *  in the walk (not a constant), outside no loop frame around `e`. */
  const writable = (e: Fn, name: Expression): Binding => {
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
    return known.binding;
  };

  const assign = (e: Fn, want: boolean): V | undefined => {
    const name = e.ops[0];
    if (isFunction(name, 'Tuple')) return parallelAssign(e, name, want);
    const owned = isSymbol(name) ? lookup(name.symbol) : undefined;
    if (owned?.binding.role === 'list') {
      // `Assign(L, ReplaceAt(L, i, v))`, the only write of `L` that
      // `inPlace()` admits besides `AddTo`.
      const r = e.ops[1];
      if (!isFunction(r, 'ReplaceAt') || r.nops !== 3 || !isSymbol(r.ops[0]))
        decline(e, 'a write to a list local other than ReplaceAt');
      return listWrite(e, owned, r.ops[1], () => scalar(r.ops[2]), false, want);
    }
    const binding = writable(e, name);
    if (binding.whole !== undefined) {
      // A list local written whole (`wholeLocal()`).
      const r = e.ops[1];
      const x = isEmptyList(r) ? undefined : value(r);
      if (x === undefined && !isEmptyList(r)) decline(e, 'a write of no value');
      binding.v = fitWhole(e, x, binding.whole, binding.lane!);
      return binding.v;
    }
    const v = local(e, scalar(e.ops[1]), binding.lane!);
    binding.v = v;
    return v;
  };

  /** `Assign(Tuple(a_1, …, a_n), Tuple(e_1, …, e_n))` of locals: every
   *  `e_i` is evaluated, then every `a_i` is written. */
  const parallelAssign = (e: Fn, names: Fn, want: boolean): undefined => {
    const values = e.ops[1];
    if (!isFunction(values, 'Tuple') || values.nops !== names.nops)
      decline(
        e,
        'a parallel assignment whose value is not a Tuple of the same length'
      );
    const seen = names.ops.map((x) => (isSymbol(x) ? x.symbol : ''));
    if (new Set(seen).size !== seen.length)
      decline(e, 'a parallel assignment that writes a name twice');
    const bindings = names.ops.map((x) => writable(e, x));
    const vs = values.ops.map((x, k) => local(e, scalar(x), bindings[k].lane!));
    bindings.forEach((x, k) => (x.v = vs[k]));
    if (want) decline(e, 'the value of a parallel assignment');
    return undefined;
  };

  /** `AddTo(s, e)` of a local `s` is `Assign(s, Add(s, e))`; `AddTo(At(L,
   *  i), e)` of a list local written in place adds `e` to its element `i`,
   *  `i` evaluated once, before `e`. */
  const addTo = (e: Fn, want: boolean): V | undefined => {
    if (e.nops !== 2) decline(e, `AddTo with ${e.nops} operands`);
    const [target, increment] = e.ops;
    if (isFunction(target, 'At')) {
      const owned = isSymbol(target.ops[0])
        ? lookup(target.ops[0].symbol)
        : undefined;
      if (owned?.binding.role !== 'list' || target.nops !== 2)
        decline(
          e,
          'AddTo of an element of a list that is not a list local written in place'
        );
      return listWrite(
        e,
        owned,
        target.ops[1],
        () => scalar(increment),
        true,
        want
      );
    }
    const binding = writable(e, target);
    const before = binding.v;
    const v = local(
      e,
      apply(e, 'Add', [before, scalar(increment)]),
      binding.lane!
    );
    binding.v = v;
    return v;
  };

  /** The array of each list local of integer elements whose lane comes from
   *  its value, and its declaration (`listLocal()`). */
  const widenable = new Map<V, Expression>();

  /** `ReplaceAt(L, i, v)` as a value (a write of a list local is
   *  `assign()`): the list `L` of numbers or of booleans with its element
   *  at `i` (from 1, from the end when negative) replaced by `v`, a build
   *  that copies the others; of an integer list and a real `v`, a list of
   *  reals, as the interpreter's. The interpreter leaves an index that is 0
   *  or out of range unevaluated and gives an error for one that is not an
   *  integer: a constant index declines, one known at run time throws
   *  (`wix`, JavaScript only). */
  const replaceAt = (e: Fn): V => {
    if (e.nops !== 3) decline(e, 'ReplaceAt with an index for each level');
    const l = value(e.ops[0])!;
    const t = type(l);
    if (
      t.shape.length !== 1 ||
      tuples.has(l) ||
      !(isSubLane(t.lane, 'real') || t.lane === 'boolean')
    )
      decline(
        e,
        'ReplaceAt of a value that is not a list of reals, integers or booleans'
      );
    const i = scalar(e.ops[1]);
    if (!isSubLane(type(i).lane, 'real'))
      decline(e.ops[1], 'an index that is not a number');
    const x = scalar(e.ops[2]);
    if ((type(x).lane === 'boolean') !== (t.lane === 'boolean'))
      decline(
        e,
        `ReplaceAt of a ${type(x).lane} value in a list of ${t.lane} elements`
      );
    if (!isSubLane(type(x).lane, 'real') && type(x).lane !== 'boolean')
      decline(e, `ReplaceAt of a ${type(x).lane} value`);
    const n = t.shape[0];
    const c = constant(i);
    const source = lists.listSource(l);
    let k: V;
    // A constant index 0 or not an integer: the interpreter leaves the form
    // unevaluated or gives an error, whatever the length.
    if (c !== undefined && (c === 0 || !Number.isInteger(c)))
      decline(e, `the index ${c} of ReplaceAt (the interpreter gives no list)`);
    if (c !== undefined && typeof n === 'number') {
      const at = elementIndex(n, c);
      if (at === undefined)
        decline(
          e,
          `the index ${c} of ReplaceAt of a list of ${n} elements (the interpreter leaves it unevaluated)`
        );
      // A target with no run-time lengths (GLSL) builds no list: the list
      // of the elements.
      if (options.runtimeLengths === false)
        return list(
          e,
          Array.from({ length: n }, (_, j) =>
            j === at ? x : source.at(b.constant(j, 'integer'))
          )
        );
      k = b.constant(at, 'integer');
    } else {
      if (!options.javascript)
        decline(
          e,
          c !== undefined
            ? 'ReplaceAt at a constant index of a list of a length known at run time (JavaScript only)'
            : 'ReplaceAt at an index known at run time (JavaScript only)'
        );
      k = b.op(
        'wix',
        [typeof n === 'number' ? b.constant(n, 'integer') : n.v, i],
        scalarType('integer')
      );
    }
    return lists.built(e, source.length, (j) =>
      branch(
        e,
        apply(e, 'Equal', [j, k]),
        () => x,
        () => source.at(j),
        true
      )!
    );
  };

  /** The binding of the list local whose array is the value of its block
   *  (`block()`), read with no copy (`symbol()`). */
  let whole: Binding | undefined;

  /** A copy of the array `v` on the lane `lane` (effectful: it keeps its
   *  place among the writes of `v`). */
  const listCopy = (v: V, lane: Lane): V =>
    b.op(
      lane === 'integer'
        ? 'copy.int'
        : lane === 'boolean'
          ? 'copy.bool'
          : 'copy',
      [v],
      { lane, shape: type(v).shape }
    );

  /** A write of the element `index` of the list local `owned`, in place:
   *  the value `value()` (`add`: plus the element), evaluated after the
   *  index. An index that is 0, not an integer or out of range fails at
   *  run time (`wix`); a constant one out of a stated length declines. */
  const listWrite = (
    e: Fn,
    owned: { binding: Binding; outer: boolean },
    index: Expression,
    value: () => V,
    add: boolean,
    want: boolean
  ): undefined => {
    if (want) decline(e, 'the value of a write to a list local');
    if (owned.outer)
      decline(e, 'a write in a loop to a local declared outside it');
    const l = owned.binding.v;
    const t = type(l);
    const i = scalar(index);
    if (!isSubLane(type(i).lane, 'real'))
      decline(index, 'an index that is not a number');
    const [n, c] = [t.shape[0], constant(i)];
    let k: V;
    if (c !== undefined && typeof n === 'number') {
      const at = elementIndex(n, c);
      if (at === undefined)
        decline(
          e,
          `the index ${c} of a write to a list of ${n} elements (the interpreter gives an error)`
        );
      k = b.constant(at, 'integer');
    } else
      k = b.op(
        'wix',
        [typeof n === 'number' ? b.constant(n, 'integer') : n.v, i],
        scalarType('integer')
      );
    const element = elementType(t);
    const x = add
      ? apply(e, 'Add', [b.op('get', [l, k], element), value()])
      : value();
    if (type(x).shape.length > 0 || !isSubLane(type(x).lane, t.lane)) {
      const mismatch = () =>
        decline(
          e,
          `a ${type(x).lane} value written to a list of ${t.lane} elements (the interpreter changes the type of the list)`,
          type(x).shape.length === 0 ? LANE_MISMATCH : undefined
        );
      // A real written to a list of integers of no declared type: the
      // interpreter widens the list to reals, and the lowering again puts
      // the local on the real lane from its declaration (`WidenList`).
      const s = widenable.get(l);
      if (
        s !== undefined &&
        type(x).shape.length === 0 &&
        type(x).lane === 'real'
      )
        try {
          mismatch();
        } catch (d) {
          throw new WidenList(d as Decline, s);
        }
      mismatch();
    }
    b.op(t.lane === 'boolean' ? 'set.bool' : 'set', [l, k, x], element);
    return undefined;
  };

  /** The binding of the list local `name` of the value `v`, which the
   *  statements of its scope (`scope`, in its block after the declaration)
   *  write in place: a copy of `v` that the local owns, of the lane that
   *  its declared type (`typeName`, `listType`) or `v` gives. JavaScript
   *  only. */
  const listLocal = (
    s: Fn,
    scope: readonly Expression[],
    name: string,
    v: V,
    [typeName, listType]: [string, ReturnType<typeof inputType>]
  ): Binding => {
    const misuse = scope.reduce<Misuse>(
      (m, x) => worse(m, inPlace(x, name)),
      undefined
    );
    if (misuse === 'write')
      decline(
        s,
        'a write to a constant (the interpreter refuses it) or to a list local other than ReplaceAt or AddTo of an element'
      );
    if (!options.javascript || bigint)
      decline(s, 'a list local that its block writes (JavaScript only)');
    const t = type(v);
    if (
      t.shape.length !== 1 ||
      tuples.has(v) ||
      !(isSubLane(t.lane, 'real') || t.lane === 'boolean')
    )
      decline(
        s,
        'a list local written in place that is not a list of reals, integers or booleans'
      );
    let lane = t.lane;
    if (listType !== undefined) {
      const [m, n] = [listType.shape[0], t.shape[0]];
      if (
        listType.shape.length !== 1 ||
        !['real', 'integer', 'boolean'].includes(listType.lane) ||
        !isSubLane(t.lane, listType.lane) ||
        (typeof m === 'number' && typeof n === 'number' && m !== n)
      )
        decline(
          s,
          `a value of type ${typeToString(t, -1)} for a list local of type ${typeName}`
        );
      lane = listType.lane;
    } else if (lane === 'integer' && typeName === 'unknown' && wide.has(s))
      lane = 'real';
    if (misuse === 'read')
      decline(
        s,
        `the list local ${name}, written in place, read in a function literal (a capture)`
      );
    const copy = listCopy(v, lane);
    if (listType === undefined && typeName === 'unknown' && lane === 'integer')
      widenable.set(copy, s);
    return { v: copy, lane, role: 'list' };
  };

  /** The worst use of the list local `name` in `x` (a `write` is worse than
   *  a `read`), or `undefined` when each write is the target of
   *  `Assign(name, ReplaceAt(name, i, v))` or of `AddTo(At(name, i), e)`
   *  and no function literal reads `name`. A `read` is a read in a function
   *  literal (a capture), which can run after a later write; a `write` any
   *  other write. Any other read is a copy of the array (`symbol()`), or
   *  `At(name, i)` and `Length(name)`, in order with the writes. */
  const inPlace = (x: Expression, name: string): Misuse => {
    if (isSymbol(x)) return undefined;
    const all = (ys: readonly Expression[]) =>
      ys.reduce<Misuse>((m, y) => worse(m, inPlace(y, name)), undefined);
    if (isDictionary(x)) return all(x.values);
    if (!isFunction(x)) return undefined;
    const own = (y: Expression | undefined) => isSymbol(y, name);
    switch (x.operator) {
      case 'At':
        // The interpreter reads the list before the index, so a write to
        // it in the index is not seen by the read.
        if (x.nops === 2 && own(x.ops[0]))
          return facts(x.ops[1]).writes.has(name)
            ? 'write'
            : inPlace(x.ops[1], name);
        break;
      case 'Assign': {
        const t = x.ops[0];
        const r = x.ops[1];
        if (
          own(t) &&
          isFunction(r, 'ReplaceAt') &&
          r.nops === 3 &&
          own(r.ops[0])
        )
          // The interpreter reads the list before the index and the value:
          // a write to it there would be lost, not made in place.
          return r.ops.slice(1).some((y) => facts(y).writes.has(name))
            ? 'write'
            : all(r.ops.slice(1));
        if (own(t) || (isFunction(t, 'Tuple') && t.ops.some(own)))
          return 'write';
        break;
      }
      case 'AddTo': {
        const t = x.ops[0];
        if (isFunction(t, 'At') && t.nops === 2 && own(t.ops[0])) {
          // The interpreter reads the list before the added value
          // (`addToSteps()`), so a write to it there is lost. It sees a write
          // in the index; that one declines too, a crafted case.
          const ys = [t.ops[1], ...x.ops.slice(1)];
          return ys.some((y) => facts(y).writes.has(name)) ? 'write' : all(ys);
        }
        if (own(t)) return 'write';
        break;
      }
      case 'Declare':
        if (own(x.ops[0])) return 'write';
        break;
      case 'Function':
        // A capture: the function can read the array after a write.
        return worse(all(x.ops), mentions(x, name) ? 'read' : undefined);
    }
    return all(x.ops);
  };
  const mentions = (x: Expression, name: string): boolean =>
    isSymbol(x, name) ||
    (isDictionary(x) && x.values.some((y) => mentions(y, name))) ||
    (isFunction(x) && x.ops.some((y) => mentions(y, name)));

  /** Every write of the local `name` in `scope` (the statements of its block
   *  after its declaration) is `Assign(name, value)` of a whole value: no
   *  `ReplaceAt(name, …)` value and no `AddTo` (the forms written in place,
   *  `listLocal()`), no parallel assignment, no write in a function literal
   *  and no declaration of `name` again. */
  const rebuiltOnly = (scope: readonly Expression[], name: string): boolean => {
    const own = (y: Expression) => isSymbol(y, name);
    const ok = (x: Expression): boolean => {
      if (!isFunction(x) || !facts(x).writes.has(name)) return true;
      if (x.operator === 'Function') return false;
      const [t, r] = x.ops;
      if (x.operator === 'Assign' && own(t))
        return !(isFunction(r, 'ReplaceAt') && own(r.ops[0])) && ok(r);
      if (
        (x.operator === 'Assign' &&
          isFunction(t, 'Tuple') &&
          t.ops.some(own)) ||
        (x.operator === 'AddTo' &&
          (own(t) || (isFunction(t, 'At') && own(t.ops[0]))))
      )
        return false;
      return x.ops.every(ok);
    };
    return scope.every(
      (x) => !(isFunction(x, 'Declare') && own(x.ops[0])) && ok(x)
    );
  };

  /** The binding of a list local of the value `v` that its block writes
   *  whole (`rebuiltOnly()`): an SSA value per write, as a scalar local,
   *  whose length can change at each write. Its type (`declared`, of the
   *  stated type `typeName`, or that of `v`) is a list of reals, integers or
   *  booleans, or a list of points of reals or integers, of a run-time
   *  length; a write keeps the rest of its shape. A `Loop` carries its
   *  length and its list (`loop()`), an `if` joins two lengths (`branch()`).
   *  No array is written in place, so a read of the local can share the
   *  array (`M = L`, `f(L)`). JavaScript only. */
  const wholeLocal = (
    s: Fn,
    v: V | undefined,
    declared: ReturnType<typeof inputType>,
    typeName: string
  ): Binding => {
    if (!options.javascript || bigint || !options.runtimeLengths)
      decline(s, 'a list local that its block writes whole (JavaScript only)');
    const t = declared ?? type(v!);
    const points =
      declared !== undefined
        ? tupleAxis(ce.type(typeName).type) === 1
        : tuples.get(v!) === 1;
    const [n, ...inner] = t.shape;
    if (
      (declared === undefined && typeName !== 'unknown') ||
      (declared !== undefined && n !== 'run-time') ||
      (declared === undefined && tuples.get(v!) === 0) ||
      t.shape.length !== (points ? 2 : 1) ||
      !inner.every((x): x is number => typeof x === 'number') ||
      !(
        t.lane === 'real' ||
        t.lane === 'integer' ||
        (t.lane === 'boolean' && !points)
      )
    )
      decline(
        s,
        `a list local written whole of type ${typeName === 'unknown' ? typeToString(type(v!), tuples.get(v!) ?? -1) : typeName}: only a list of reals, integers or booleans, or of points of reals, of a run-time length`
      );
    // A real written to a list of integers of no stated type: the
    // interpreter widens the list, and the lowering again puts the local on
    // the real lane (`WidenList`, as for a list local written in place).
    const lane =
      declared === undefined && t.lane === 'integer' && wide.has(s)
        ? 'real'
        : t.lane;
    const whole = {
      inner,
      points,
      widen: declared === undefined && lane === 'integer' ? s : undefined,
    };
    return { v: fitWhole(s, v, whole, lane), lane, role: 'local', whole };
  };

  /** `List()`, which has no type of its own. */
  const isEmptyList = (x: Expression) => isFunction(x, 'List') && x.nops === 0;

  /** The value `x` written to a list local written whole of the lane `lane`
   *  (`wholeLocal()`): a list of the rank, the lengths after the first and
   *  the tuple mark of the local, of a sub-lane; an empty list (`undefined`
   *  for `List()`) is the empty list of that type. Another value declines:
   *  the interpreter changes the type of the local or gives an error. */
  const fitWhole = (
    e: Fn,
    x: V | undefined,
    whole: NonNullable<Binding['whole']>,
    lane: Lane
  ): V => {
    const t = x === undefined ? { lane, shape: [0] } : type(x);
    if (x === undefined || (t.shape.length === 1 && t.shape[0] === 0)) {
      // A build of no element: a stated length is at least 1.
      const zero = b.constant(lane === 'boolean' ? false : 0, lane);
      const k = b.newValue(scalarType('integer'));
      return region(
        'build',
        [b.constant(0, 'integer')],
        [k],
        () => [
          whole.points ? tuple(e, Array<V>(whole.inner[0]).fill(zero)) : zero,
        ],
        e
      )[0];
    }
    const shaped =
      t.shape.length === 1 + whole.inner.length &&
      whole.inner.every((n, k) => t.shape[k + 1] === n) &&
      (tuples.get(x) === 1) === whole.points &&
      tuples.get(x) !== 0;
    if (shaped && isSubLane(t.lane, lane)) return x;
    const mismatch = () =>
      decline(
        e,
        `a value of type ${typeToString(t, tuples.get(x) ?? -1)} written to a list local of type ${typeToString({ lane, shape: [{ v: 0 }, ...whole.inner] }, whole.points ? 1 : -1)}`
      );
    if (shaped && whole.widen !== undefined && t.lane === 'real')
      try {
        mismatch();
      } catch (d) {
        throw new WidenList(d as Decline, whole.widen);
      }
    return mismatch();
  };

  /** `ParallelLoop(body, Element(x, coll), …)`: the `Loop` of the same
   *  operands, whose passes run in order, as the interpreter runs them. It
   *  declines a body that assigns a name declared outside it other than
   *  with `AddTo`, a `Break` or a `Continue` of the loop, and (`program()`)
   *  a program with a draw or a random frame: the interpreter runs each
   *  pass in a frame of its own, which compiled code does not have. */
  let parallel: Fn | undefined;
  const parallelLoop = (e: Fn, want: boolean): undefined => {
    if (!options.javascript) decline(e, 'a parallel for (JavaScript only)');
    const outer = outerWrite(e.ops[0], new Set());
    if (outer !== undefined)
      decline(
        e,
        `a parallel for whose body assigns ${outer}, declared outside it (parallel-outer-write): only AddTo adds to such a variable`
      );
    if (jumps(e.ops[0]) !== 0)
      decline(e, 'a Break or a Continue of a parallel for (parallel-exit)');
    parallel ??= e;
    return loop(e, want, true);
  };

  /** A name declared outside `x` that `x` writes with `Assign`: a name of
   *  `inner`, a local of a `Block`, an index of a clause and a parameter
   *  of a function literal in `x` are declared inside. */
  const outerWrite = (
    x: Expression,
    inner: ReadonlySet<string>
  ): string | undefined => {
    if (!isFunction(x)) return undefined;
    const names = new Set(inner);
    if (x.operator === 'Function')
      for (const p of x.ops.slice(1)) {
        const n = parameterName(p);
        if (n !== undefined) names.add(n);
      }
    for (const c of x.ops)
      if (isFunction(c, 'Element'))
        for (const n of patternNames(c.ops[0])) names.add(n);
    if (x.operator === 'Assign') {
      const t = x.ops[0];
      for (const n of isFunction(t, 'Tuple') ? t.ops : [t])
        if (isSymbol(n) && !names.has(n.symbol)) return n.symbol;
    }
    for (const op of x.ops) {
      if (x.operator === 'Block' && isFunction(op, 'Declare'))
        for (const n of patternNames(op.ops[0])) names.add(n);
      const w = outerWrite(op, names);
      if (w !== undefined) return w;
    }
    return undefined;
  };

  /** `i` draws from the random frame that it runs in. */
  const drawSite = (i: Instr): boolean =>
    (i.k === 'op' && (i.op === 'draw' || i.op === 'shuffle')) ||
    (i.k === 'region' && (i.op === 'choice' || i.op === 'sample'));

  /** Whether the region `r` draws or holds a random frame. */
  const draws = (r: Region): boolean =>
    r.body.some(
      (i) =>
        drawSite(i) ||
        (i.k === 'region' && i.op === 'seeded') ||
        regionsOf(i).some(draws)
    );

  /** The number of draw sites of the instructions `is` that are outside the
   *  random frames that `is` holds; `Infinity` when `is` has another effect
   *  (a read of a `vars` name, a call of an effectful function), a draw in
   *  a loop or in a per-element body (`repeated`), or a frame of more than
   *  one site. A frame of one site evaluated once starts its draws at its
   *  seed and makes the interpreter's draws, so its values depend only on
   *  the values that it reads: `WithRandomSeed(7, RandomChoice([0, 1), 4N))`
   *  is a function of `N`. The other frames are those of the warning
   *  `seeded-draw-order` (`seededWarnings()` of `index.ts`), whose draws can
   *  differ from the interpreter's. */
  const drawSites = (is: readonly Instr[], repeated = false): number =>
    is.reduce((n, i) => {
      if (i.k === 'region' && i.op === 'seeded')
        return drawSites(i.regions[0].body) <= 1 ? n : Infinity;
      const own = !effectful(i) ? 0 : drawSite(i) && !repeated ? 1 : Infinity;
      const inner = repeated || i.k === 'loop' || i.k === 'region';
      return regionsOf(i).reduce(
        (m, r) => m + drawSites(r.body, inner),
        n + own
      );
    }, 0);

  const cx: Lowering = {
    b,
    rows,
    frames,
    value,
    scalar,
    wholeRows,
    rowsParams,
    rowLengths,
    rowsElementLane,
    apply,
    type,
    constant,
    nonnegative: (v) => nonnegative(v),
    branch,
    withFrame,
    region,
    list,
    isLibrary,
    free,
    widen,
    wide: options.mode === 'complex' ? 'complex' : 'real',
    interval,
    fold: options.fold !== false,
    budget: options.iterationBudget,
    runtimeLengths: options.runtimeLengths ?? true,
    bigint,
    unrollSums: options.unrollSums ?? 0,
    unrollBuilds: options.unrollBuilds ?? 0,
    attempted: options.attempted ?? (() => {}),
    numberOf,
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
    bodies,
  };
  const lists = listLowering(cx);
  const matrices = matrixLowering(cx, lists);
  const fns = functionLowering(cx, lists);
  // The program reads or makes an enclosure (`Program.valueKinds`).
  let enclosure = false;
  const enclosures = enclosureLowering(cx, () => (enclosure = true));

  /** The result of the entry, `v` or its parts: a row at an index known at
   *  run time declines, since out of range it is a list of no element where
   *  the interpreter gives `Missing`. */
  const result = <T extends V | V[]>(v: T): T => {
    for (const x of Array.isArray(v) ? v : [v])
      if (rowLength(x) !== undefined)
        decline(root, 'a row at an index known at run time as the result');
    return v;
  };

  /** The program of the entry `f`, refused when an input that it reads has
   *  no type at any occurrence (`seen`, `typed`). A decline of the lowering
   *  is thrown as it is. */
  const program = (f: () => V | V[]): Program => {
    const p = b.program(f);
    if (parallel !== undefined && p.functions.some((g) => draws(g.body)))
      decline(
        parallel,
        'a parallel for in a program that draws or has a random frame: the interpreter runs each pass in a random frame of its own'
      );
    const names = [...seen].filter((name) => !typed.has(name));
    if (names.length > 0) throw new UntypedInputs(names);
    return {
      ...p,
      inputs,
      ...(enclosure ? { valueKinds: ['enclosure'] } : {}),
      ...(assigns.length > 0 ? { assigns } : {}),
      ...(hosts.length > 0 ? { hosts } : {}),
    };
  };
  // The names of the scope of the compilation that a root function literal
  // assigns (`assignedNames()`).
  let assigns: Assigned[] = [];
  // The functions of the host that the program calls (`hostCall()`).
  const hosts: HostCall[] = [];

  /** The value of `e`, a call of a function that the host declared with an
   *  `evaluate` function (`isHostDefinition()`, CE-1621): an effectful
   *  operation that calls the interpreter for the call at run time
   *  (`_SYS.hosts` of `print-js.ts`), at each evaluation of `e`, in the
   *  order of the program. Each argument is a scalar of the lane `real`,
   *  `integer`, `boolean` or `string`, at most `MAX_HOST_ARGUMENTS` of them.
   *  The static type of the call is `real`, `integer` or `boolean`, the
   *  lane of the value, or `nothing`, which the code reads only as the value
   *  of the root function literal (NaN there, as the interpreter's `Nothing`
   *  is). Plain JavaScript only: the shader targets cannot call the host,
   *  the interval and `bigint` modes have no lane of its values. A function
   *  that assigns a variable of the engine (`assignedNames()`) declines: the
   *  host function would read the variable before the code writes it back. */
  const hostCall = (e: Fn, want: boolean): V | undefined => {
    const name = e.operator;
    const why = (reason: string, code?: DeclineReason): never =>
      decline(e, `a call of the function ${name} of the host, ${reason}`, code);
    if (!options.javascript || interval || bigint) why('on this target');
    if (assigns.length > 0)
      why('in a function that assigns a variable of the engine');
    if (e.nops > MAX_HOST_ARGUMENTS)
      why(`with more than ${MAX_HOST_ARGUMENTS} arguments`);
    const t = e.type.type;
    const result: Lane | 'nothing' | undefined = isSubtype(t, 'nothing')
      ? 'nothing'
      : isSubtype(t, 'boolean')
        ? 'boolean'
        : isSubtype(t, 'integer')
          ? 'integer'
          : isSubtype(t, 'real')
            ? 'real'
            : undefined;
    if (result === undefined)
      why(
        `of type ${engineTypeToString(t)}, not real, integer, boolean or nothing`
      );
    // The value of the root function literal, or the last operand of a
    // `Block` that is: a `Nothing` read as NaN.
    const atRoot = (x: Expression): boolean => {
      const places = readers.get(x) ?? [];
      return (
        places.length > 0 &&
        places.every(
          ([r, i]) =>
            (r === root && r.operator === 'Function' && i === 0) ||
            (r.operator === 'Block' && i === r.nops - 1 && atRoot(r))
        )
      );
    };
    if (result === 'nothing' && want && !atRoot(e))
      why('whose value Nothing is read', POSSIBLE_NOTHING);
    const args = e.ops.map((op) => {
      const v = value(op)!;
      const a = type(v);
      if (
        a.shape.length > 0 ||
        tuples.has(v) ||
        !['real', 'integer', 'boolean', 'string'].includes(a.lane)
      )
        why(
          `with an argument of type ${typeToString(a)}, not a real, an integer, a boolean or a string`
        );
      return v;
    });
    const lanes = args.map((v) => type(v).lane);
    const def = e.operatorDefinition!;
    let k = hosts.findIndex(
      (h) =>
        h.definition === def &&
        h.result === result &&
        h.args.length === lanes.length &&
        h.args.every((l, j) => l === lanes[j])
    );
    if (k < 0) {
      k = hosts.length;
      hosts.push({
        name,
        call: e,
        definition: def,
        args: lanes,
        result: result!,
      });
    }
    const v = b.op(
      hostCallOp(k),
      args,
      scalarType(result === 'nothing' ? 'real' : result!)
    );
    return result === 'nothing' && !want ? undefined : v;
  };

  /** The names that the body of the root function literal `f` assigns (an
   *  `Assign` or an `AddTo` of the name) where the name is a variable of
   *  the scope of the compilation, not a local or a parameter of `f`: the
   *  state that a call of the interpreter changes in the engine (CE-1620).
   *  Each one is a variable with a declared type of the lane `real`,
   *  `integer` or `boolean` (`inputType()`), on the plain JavaScript
   *  target; another one declines. A function that `f` calls and that
   *  reads such a name declines (`free()`): it would read the value before
   *  the call. */
  const assignedNames = (f: Fn): Assigned[] => {
    const out: Assigned[] = [];
    // `bound`: the names that a parameter of a function literal or a
    // `Declare` of a `Block` around `x` binds.
    const visit = (x: Expression, bound: ReadonlySet<string>): void => {
      if (!isFunction(x)) return;
      const binds =
        x.operator === 'Function'
          ? x.ops.slice(1).map((p) => parameterName(p) ?? '')
          : x.operator === 'Block'
            ? x.ops.flatMap((op) =>
                isFunction(op, 'Declare') ? patternNames(op.ops[0]) : []
              )
            : [];
      const inner = binds.length > 0 ? new Set([...bound, ...binds]) : bound;
      const target =
        x.operator === 'Assign' || x.operator === 'AddTo'
          ? x.ops[0]
          : undefined;
      const targets = isFunction(target, 'Tuple') ? target.ops : [target];
      for (const t of targets) {
        if (!isSymbol(t) || inner.has(t.symbol)) continue;
        if (out.some((s) => s.name === t.symbol)) continue;
        const h = held(t.symbol);
        if (h === undefined || h.library) continue;
        const def = h.definition;
        const why = (reason: string) =>
          decline(x, `an assignment of ${t.symbol}, ${reason}`);
        if (!options.javascript || interval || bigint)
          why('a variable of the engine, on this target');
        if (def.isConstant) why('a constant');
        // A name of `vars`, of `symbolic` or of `inputs` is an input of the
        // host, whose value the compilation hides.
        if (options.vars?.includes(t.symbol) || h.value === undefined)
          why('a name with no value at the compilation, or an input');
        if (def.inferredType)
          why('whose type is inferred from its value: declare its type');
        const ir = inputType(def.type.type);
        const lane = ir?.shape.length === 0 ? ir.lane : undefined;
        if (lane !== 'real' && lane !== 'integer' && lane !== 'boolean')
          return why(`of type ${engineTypeToString(def.type.type)}`);
        out.push({ name: t.symbol, definition: def, lane });
      }
      x.ops.forEach((op) => visit(op, inner));
    };
    visit(f, new Set());
    return out;
  };
  // A root function literal: its parameters, by position, come first. A
  // root name of a library operator is its literal (`operatorLiteral()`).
  if (isSymbol(root))
    root = operatorLiteral(root, rows, undefined, options.vars);
  if (isFunction(root, 'Function') && isLibrary(root)) {
    b.literal = true;
    // A parameter of no declared type is a real. One that the body reads as
    // a collection (`w ↦ Sum(w)`: the type of the literal is `(w:
    // collection) -> number`) has no settled shape: a list there would be
    // read as a number.
    const own = root.type.type;
    return program(() => {
      root.ops.slice(1).forEach((p, i) => {
        const name = parameterName(p);
        if (name === undefined) decline(root, 'a parameter that is not a name');
        // `run()` takes every positional argument: no default fills one.
        if (isFunction(p, 'Optional'))
          decline(root, `the parameter ${name} with a default value`);
        const declared =
          isFunction(p, 'Typed') && isString(p.ops[1])
            ? ce.type(p.ops[1].string).type
            : 'unknown';
        const read =
          typeof own === 'object' && own.kind === 'signature'
            ? own.args?.[i]?.type
            : undefined;
        if (
          declared === 'unknown' &&
          read !== undefined &&
          read !== 'unknown' &&
          read !== 'any' &&
          inputType(read)?.shape.length !== 0
        )
          decline(
            root,
            `the parameter ${name} of no declared type, read as ${engineTypeToString(read)}`
          );
        input(p, name, declared, true);
      });
      const states = assignedNames(root);
      if (states.length === 0) return result(value(root.ops[0])!);
      // Each name is a local whose value is a positional parameter after
      // the arguments, and the code returns the value of the body and the
      // value of each name after it (`Program.assigns`). The stored value
      // is hidden while the body is lowered, so that no analysis reads it.
      for (const s of states) {
        b.positional += 1;
        const v = b.param(s.name, scalarType(s.lane));
        frames[0].names.set(s.name, { v, lane: s.lane, role: 'local' });
      }
      assigns = states;
      const hidden = Object.fromEntries(states.map((s) => [s.name, true]));
      // A body that ends in an assignment is `Nothing`, which the code gives
      // as NaN: `do { s = s + 1 }`.
      const body = root.ops[0];
      const last = isFunction(body, 'Block') ? body.ops.at(-1) : undefined;
      const want = !['Assign', 'Declare', 'DefineFunction'].includes(
        last?.operator ?? ''
      );
      const v = withVarsValuesHidden(root, hidden, () => value(body, want));
      return [
        want && v !== undefined ? result(v) : b.constant(NaN, 'real'),
        ...states.map((s) => frames[0].names.get(s.name)!.v),
      ];
    });
  }
  return program(() => {
    const v = value(root)!;
    return result(rootParts ?? v);
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

/** The exponent of `x` when it is a `Power` of a literal integer exponent
 *  `>= 1` that the engine types `integer` (`n^2` of an integer `n` is
 *  `integer<0..>`), or `undefined`. */
function integerPower(x: Expression): number | undefined {
  const k = literalExponent(x);
  return k !== undefined && isSubtype(x.type.type, 'integer') ? k : undefined;
}

/** The exponent of `x` when it is a `Power` of a literal safe integer
 *  exponent `>= 1`, or `undefined`. */
function literalExponent(x: Expression): number | undefined {
  if (!isFunction(x, 'Power') || x.nops !== 2) return undefined;
  const k = literalNumber(x.ops[1]);
  return k !== undefined &&
    k.isInteger === true &&
    Number.isSafeInteger(k.re) &&
    k.re >= 1
    ? k.re
    : undefined;
}

/**
 * The interval mode: the count of ulps within which the double of the
 * number literal `nv` is its value, or `undefined` when the double is the
 * value. A number that is not exact (a machine number or a decimal: `1.8`)
 * is its double, as on the earlier target and in the JavaScript code (the
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
