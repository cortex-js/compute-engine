/**
 * The lane analysis of `mode: 'bigint'` on the JavaScript target (CE-715).
 *
 * In the mode, every numeric node of the compiled expression must compute a
 * JavaScript `bigint` at run time, or the compilation declines with the
 * `bigint-lane` diagnostic (`bigintLaneError`). This module decides, before
 * any code is emitted, whether each node is on that lane, and records for
 * each node what the emitters need to know: the kind of value, the refined
 * static type, the kind of lowering, and whether an integer-forcing parent
 * lowers the node. The rules are those of
 * `docs/plans/2026-10-31-ce715-bigint-compile-mode.md` (§3.1 to §3.4); a
 * rule is named below by what it does, and the section of the spec follows
 * it as a footnote.
 *
 * The yardstick of every rule is the interpreter: a `bigint` or `boolean`
 * result of the compiled code must be the value of `evaluate()` for
 * well-typed inputs. When a rule cannot prove that, the node declines, and
 * the expression runs on the interpreter.
 *
 * A value that is not finite (a "pole": `n!` at `n < 0`, `Mod(n, 0)`) has
 * no `bigint` form. The analysis does not track where a pole can occur:
 * every runtime helper throws at a pole, and one catch at the top of the
 * compiled entry returns a `number` (`NaN` or `Infinity`). A `number`
 * result has no defined relation to the value of `evaluate()` (§3.4). A
 * refined type can still hold a `nan` or `infinity` member: the lane test
 * admits them, and nothing else reads them.
 *
 * The analysis does not change the expression and does not emit code. Its
 * result is a map from each analyzed node to a `BigintLaneRecord`.
 */

import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralBoundNames,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { BigNumericValue } from '../numeric-value/big-numeric-value.js';
import type { CompileTarget } from './types.js';
import { CompileDeclineError, bigintLaneError } from './diagnostics.js';
import {
  signatureParamType,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import { userFunctionSignature } from './compile-absence.js';
import {
  literalWithParameterTypes,
  parameterTypesKey,
  userFunctionSignatureIsInferred,
} from './compile-callbacks.js';
import { isUserDefinedFunction } from './compile-statements.js';
import { collectionElementTypeOf } from './compile-declarations.js';
import { reachesExcludedName } from './compiler-names.js';
import { core } from './compiler-core-hooks.js';
import { CONSTANT_FOLD_MAX_COST } from './compile-folding.js';

// ---------------------------------------------------------------------------
// Types of the lane
// ---------------------------------------------------------------------------

/** Every finite member is an integer: the lane test of a scalar (§3.1). */
const LANE_TYPE = parseType('integer | nan | infinity | signed_infinity');
const INTEGER_OR_INFINITY = parseType('integer | infinity');
const INTEGER_OR_NAN = parseType('integer | nan');
const NON_NEGATIVE_INTEGER = parseType('integer<0..>');
const POSITIVE_INTEGER = parseType('integer<1..>');
const NEGATIVE_INTEGER = parseType('integer<..-1>');
const NON_NEGATIVE_OR_INFINITY = parseType('integer<0..> | infinity');
const NON_NEGATIVE_OR_NAN = parseType('integer<0..> | nan');
const NON_NEGATIVE_NAN_OR_INFINITY = parseType('integer<0..> | nan | infinity');
const LIST_OF_INTEGERS = parseType('list<integer>');
const INTEGER_NAN_OR_INFINITY = parseType('integer | nan | infinity');

/**
 * Whether a value of type `t` is on the bigint lane: `t` is a subtype of
 * `integer | nan | infinity | signed_infinity`, so every finite member of
 * `t` is an integer. A value that is not finite has no `bigint` form: the
 * helper that computes it throws, and the compiled entry returns a
 * `number` (§3.1, §3.4).
 */
export function bigintLane(t: Type): boolean {
  return t !== 'never' && isSubtype(t, LANE_TYPE);
}

/**
 * The kind of an input of the mode whose type is `t`, for the entry check
 * (§3.5): `integer` for a scalar on the lane, `integer-list` for a list of
 * integers, and `undefined` for any other type. These are the two kinds of
 * input that the analysis accepts (`BigintLaneRecord.input`).
 */
export function bigintInputLane(
  t: Type
): 'integer' | 'integer-list' | undefined {
  if (bigintLane(t)) return 'integer';
  return isListOfIntegers(t) ? 'integer-list' : undefined;
}

/** Whether the lane type `t` has a non-finite member (`nan`, `infinity`
 * or `signed_infinity`). */
function hasNonFiniteMember(t: Type): boolean {
  return !isSubtype(t, 'integer');
}

/**
 * The refined type `base` (`integer` or `integer<0..>`), plus the
 * non-finite members of the lane types `types`: `nan` when one of them can
 * be `NaN`, `infinity` when one of them can be infinite (§3.1.3).
 */
function withNonFiniteMembersOf(
  base: 'integer' | 'integer<0..>',
  types: ReadonlyArray<Type>
): Type {
  const nan = types.some((t) => !isSubtype(t, INTEGER_OR_INFINITY));
  const infinity = types.some((t) => !isSubtype(t, INTEGER_OR_NAN));
  if (base === 'integer') {
    if (nan && infinity) return INTEGER_NAN_OR_INFINITY;
    if (nan) return INTEGER_OR_NAN;
    return infinity ? INTEGER_OR_INFINITY : 'integer';
  }
  if (nan && infinity) return NON_NEGATIVE_NAN_OR_INFINITY;
  if (nan) return NON_NEGATIVE_OR_NAN;
  return infinity ? NON_NEGATIVE_OR_INFINITY : NON_NEGATIVE_INTEGER;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * What a node computes at run time in the mode.
 * - `bigint`: a JavaScript `bigint`.
 * - `bigint-list`: an array of `bigint`, nested arrays for a nested list.
 * - `boolean`, `string`: a JavaScript boolean or string.
 * - `rational-constant`: an exact rational `p/q` that is not an integer,
 *   used only as an operand of a comparison or as the factor of a
 *   parent-lowered product. It has no value of its own.
 * - `parent-lowered`: a non-integer subtree that its integer-forcing parent
 *   lowers (`parentLowered`). It has no value of its own.
 * - `function`: a callback literal (`Map`, `Reduce`) or the `Function`
 *   literal at the root.
 */
export type BigintLaneValue =
  | 'bigint'
  | 'bigint-list'
  | 'boolean'
  | 'string'
  | 'rational-constant'
  | 'parent-lowered'
  | 'function';

/**
 * How the emitter lowers a node on the lane (§3.1.1):
 * - `bigint` (a): a lowering on `bigint` values (operators, `b*` helpers);
 * - `number-wrapped` (b): the lowering of the double mode, whose value is a
 *   safe integer, wrapped in `BigInt(…)` (`Length`, `Count`, `Boole`);
 * - `index-conversion` (c): a lowering that converts a `bigint` index or
 *   count to a `number` after an exact check (`At`, `First`, `Last`,
 *   `Take`, `Drop`, `ReplaceAt`);
 * - `folded`: a constant subtree with no free variable, emitted from the
 *   exact value of `evaluate()` (constant folding);
 * - `input`: a read of a binding, lifted to `bigint` at the boundary;
 * - `none`: no lowering of its own (a boolean head, a comparison, a
 *   rational constant, a parent-lowered subtree, a callback literal).
 */
export type BigintLowering =
  | 'bigint'
  | 'number-wrapped'
  | 'index-conversion'
  | 'folded'
  | 'input'
  | 'none';

/** The integer-forcing parent that lowers a non-integer subtree (§3.2). */
export type BigintForcingParent =
  'Floor' | 'Ceil' | 'Round' | 'Truncate' | 'promise';

/** The shapes of a non-integer subtree that an integer-forcing parent
 * lowers (§3.2):
 * - `rational-product`: `Multiply(Rational(p, q), t₁, …)`, the quotient
 *   `p·t₁·… / q` (`p`, `q` in `rational` of the record);
 * - `quotient`: `Divide(a, b)`, the quotient `a / b`;
 * - `power`: `Power(a, e)` with an exponent not typed `integer<0..>`, the
 *   quotient `1 / a^(−e)` for `e < 0` and `a^e` otherwise;
 * - `sqrt`: `Sqrt(t)` under a rounding parent only, the integer square
 *   root of `t` rounded by the parent. */
export type BigintParentLoweredShape =
  'rational-product' | 'quotient' | 'power' | 'sqrt';

/** What the emitter of `mode: 'bigint'` reads for one node. */
export interface BigintLaneRecord {
  value: BigintLaneValue;
  /** The refined static type (§3.1.3), or the engine's type of the node. */
  type: Type;
  lowering: BigintLowering;
  /** Set on a non-integer subtree that its integer-forcing parent lowers
   * (§3.2). The record holds the shape only, not the parent: the same node
   * object can be the operand of two integer-forcing parents
   * (`Floor(d) + Ceil(d)`), and a record is kept for each node, not for
   * each position. The emitter decides the lowering at the integer-forcing
   * node (the rounding head or the promise) and passes it down to the
   * lowered node, also through a single-statement `Block` between them:
   * in `Floor(Block(n/2))` the direct parent of the quotient is the `Block`,
   * which carries the same record. The only rule of the analysis that
   * depends on the kind of
   * parent (`Sqrt` is lowered by a rounding parent, not by an integer
   * promise) declines the whole expression when the other kind meets the
   * node, so no accepted record depends on the kind of parent. */
  parentLowered?: {
    shape: BigintParentLoweredShape;
  };
  /** The node is an integer promise for its operand (§3.2): a `Typed`
   * ascription, or the callback literal of a `Map`, `Fold` or `Reduce`
   * that names a user function declared `-> integer` (a promise for its
   * body). `promiseType` is the promised type, which can be narrower than
   * `integer` (`integer<0..>`). A call of a user function records its
   * promise in `userCall.resultPromise`. */
  promiseType?: Type;
  /** The exact value of a `rational-constant`, `q > 0`. */
  rational?: { p: bigint; q: bigint };
  /** Set on a `folded` node whose value is a pole (§3.4): the `number`
   * that the emitted code throws in a `NonFiniteValue` where the node is
   * evaluated, `Infinity` for an infinite value and `NaN` for `NaN`
   * (`LaneAnalyzer.constantPole`). */
  pole?: number;
  /**
   * A comparison with a rational constant operand (§3.3): the operand at
   * `constantOperand` is `p/q` (`q > 0`). The comparison is emitted exactly
   * on the lane (`q·n < p`). `folded` is the value of an `Equal` or
   * `NotEqual` with a non-integer constant, which is known at compile time.
   */
  comparison?: {
    constantOperand: number;
    p: bigint;
    q: bigint;
    folded?: boolean;
  };
  /** A call of a user function (§3.1.2). `literal` is the literal whose
   * body was analyzed (a copy with typed parameters for an untyped
   * literal); `resultPromise` is whether the function is declared
   * `-> integer`. */
  userCall?: {
    name: string;
    literal: Expression & FunctionInterface;
    resultPromise: boolean;
  };
  /** The callback literal of a `Map`, `Reduce` or `Fold` whose body was
   * analyzed. */
  callback?: Expression & FunctionInterface;
  /** A binding read by the expression (§3.1, last paragraph). */
  input?: 'integer' | 'integer-list';
}

/** The result of a successful analysis. */
export interface BigintLaneAnalysis {
  /** The node that was analyzed: the root of the compilation. */
  readonly root: Expression;
  /** A record for every analyzed node. */
  readonly records: ReadonlyMap<Expression, BigintLaneRecord>;
}

/** The options of the analysis. */
export interface BigintLaneOptions {
  /** The target of the compilation: its `overridesHead` names the heads
   * that the caller replaced with the `operators` or `functions` option,
   * and its `localFunctions` the block-local functions. */
  target?: CompileTarget<Expression>;
  /** Whether the `vars` option gives the symbol `name` a value that is not
   * a read of the vars object (a baked value, or caller source). */
  isCallerSourceVar?: (name: string) => boolean;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Analyze `expr` for `mode: 'bigint'`. Returns the analysis, or the
 * `bigint-lane` decline of the first node that is not on the lane. Any
 * other error of the analysis is thrown.
 */
export function analyzeBigintLane(
  expr: Expression,
  options: BigintLaneOptions = {}
):
  | { accepted: true; analysis: BigintLaneAnalysis }
  | { accepted: false; decline: CompileDeclineError } {
  try {
    return { accepted: true, analysis: requireBigintLane(expr, options) };
  } catch (e) {
    if (e instanceof CompileDeclineError && e.diagnostic.code === 'bigint-lane')
      return { accepted: false, decline: e };
    throw e;
  }
}

/** Analyze `expr` for `mode: 'bigint'`, or throw its `bigint-lane`
 * decline. */
export function requireBigintLane(
  expr: Expression,
  options: BigintLaneOptions = {}
): BigintLaneAnalysis {
  const analyzer = new LaneAnalyzer(expr.engine, options);
  analyzer.analyzeRoot(expr);
  return { root: expr, records: analyzer.records };
}

/**
 * The analyses made before the compilation proper, by the JavaScript
 * target (`prepareCompilation`), keyed by the root target of the
 * compilation (`CompileTarget.userFunctions.root`, which every `{...target}`
 * copy shares). The CSE harvest runs before the core compiler, and must
 * read the same analysis.
 */
const PREPARED = new WeakMap<object, BigintLaneAnalysis>();

/** Record `analysis` as the analysis of the compilation whose root target
 * is `target`. */
export function setPreparedBigintLane(
  target: CompileTarget<Expression>,
  analysis: BigintLaneAnalysis
): void {
  PREPARED.set(target.userFunctions?.root ?? target, analysis);
}

/**
 * The analysis of `expr` in the compilation of `target`: the analysis made
 * by `prepareCompilation` when it holds a record for `expr`, or a new one.
 * Throws the `bigint-lane` decline when `expr` is not on the lane. A new
 * analysis that cannot read the caller's `vars` option treats every `vars`
 * key as caller source (`CompileTarget.varsKeys`).
 */
export function bigintLaneAnalysisFor(
  expr: Expression,
  target: CompileTarget<Expression>
): BigintLaneAnalysis {
  const prepared = PREPARED.get(target.userFunctions?.root ?? target);
  if (prepared !== undefined && prepared.records.has(expr)) return prepared;
  const keys = target.varsKeys;
  return requireBigintLane(expr, {
    target,
    isCallerSourceVar: keys === undefined ? undefined : (n) => keys.has(n),
  });
}

/**
 * The CSE exclusion of the mode (§3.2), as a predicate for
 * `CseHarvestOptions.notACandidate`: a parent-lowered subtree is not a
 * candidate, because its lowering depends on its parent
 * (`Floor(n/2) + Ceil(n/2)` needs two quotients). A rational constant and a
 * callback literal are not candidates either: they have no value of their
 * own, and a hoisted copy would be emitted as a double (the shared
 * `Fibonacci(30)/7` of `n < Fibonacci(30)/7 < m`) or as a function value
 * outside its consumer. A node that the analysis
 * did not see (the body of a user function, which the compiler can emit
 * from another copy of its literal) is judged by its type: a numeric node
 * that is not on the lane is not a candidate (only a parent-lowered
 * subtree can be one in an accepted compilation). A node that can give a
 * non-finite value stays a candidate: its helper throws, and the throw
 * ends the whole computation wherever the node is emitted (§3.4). A
 * constant whose value is a pole (`record.pole`) is not a candidate: its
 * code is a throw, and a hoisted binding would throw before the code that
 * comes before the node in the evaluation order runs.
 */
export function bigintCseExclusion(
  analysis: BigintLaneAnalysis
): (node: Expression) => boolean {
  return (node) => {
    const record = analysis.records.get(node);
    if (record !== undefined)
      return (
        record.parentLowered !== undefined ||
        record.pole !== undefined ||
        record.value === 'rational-constant' ||
        record.value === 'function'
      );
    const t = node.type.type;
    if (!isSubtype(t, 'number')) return false;
    return !bigintLane(t);
  };
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/** The context a parent gives an operand. */
interface Context {
  /** The operand's parent is integer-forcing (§3.2). */
  forcing?: BigintForcingParent;
}

const COMPARISON_HEADS: ReadonlySet<string> = new Set([
  'Less',
  'Greater',
  'LessEqual',
  'GreaterEqual',
  'Equal',
  'NotEqual',
]);

/** The heads whose operands are `bigint` values and whose lowering is (a),
 * with no rule of their own beyond the lane test. */
const PLAIN_LANE_HEADS: ReadonlySet<string> = new Set([
  'Multiply',
  'Min',
  'Max',
  'Sign',
  'GCD',
  'LCM',
  'Factorial',
  'Binomial',
  'Fibonacci',
]);

/** The heads whose application to exact integer constants can have a
 * non-finite value, which the analysis folds as a pole (§3.4,
 * `LaneAnalyzer.constantPole`): `Factorial` of a negative integer
 * (`(−1)!`), `Mod` and `Remainder` with a zero divisor (`Mod(5, 0)`),
 * `Power` with a base whose value is zero (`Fibonacci(0)^(−1)`,
 * `Abs(0)^0`), and `Divide` with a divisor whose value is zero
 * (`1/Fibonacci(0)`). The canonical form of a literal zero base or
 * divisor (`0^(−1)`, `1/0`) is a non-finite literal (`~oo`,
 * `NaN`), not an application of these heads: the analysis of
 * a number literal folds it as a pole (`LaneAnalyzer.numberLiteral`). `Factorial2` is not one of them: its
 * operand must be typed `integer<0..>`, and its helper throws a
 * `RangeError` for a negative operand. */
const POLE_HEADS: ReadonlySet<string> = new Set([
  'Factorial',
  'Mod',
  'Remainder',
  'Power',
  'Divide',
]);

/** The heads that give an integer for integer operands, whose type the
 * analysis computes from the refined types of their operands
 * (`LaneAnalyzer.closedType`). */
const CLOSED_HEADS: ReadonlySet<string> = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Min',
  'Max',
  'If',
  'Which',
]);

class LaneAnalyzer {
  readonly records = new Map<Expression, BigintLaneRecord>();
  /** The user function bodies being analyzed, by `parameterTypesKey`: a
   * call met while its own body is analyzed is a recursive call. */
  private readonly inProgress = new Set<string>();
  /** The user function calls analyzed, by `parameterTypesKey`: the type of
   * the call and the literal whose body was analyzed. */
  private readonly callMemo = new Map<
    string,
    { type: Type; literal: Expression & FunctionInterface }
  >();
  /** The answers of `mentionsUnfoldableName`, for the scopes in which they
   * were computed (the array `scopes`, which `withBound` replaces). A node
   * object can be at several positions of the tree (a DAG): the memo keeps
   * the walk linear in the distinct nodes. */
  private unfoldableMemo:
    | {
        scopes: ReadonlyArray<ReadonlySet<string>>;
        answers: Map<Expression, boolean>;
      }
    | undefined;
  /** The records computed by `analyze`, with the scopes and the
   * integer-forcing parent they were computed in. */
  private readonly analyzed = new Map<
    Expression,
    {
      scopes: ReadonlyArray<ReadonlySet<string>>;
      forcing: BigintForcingParent | undefined;
      record: BigintLaneRecord;
    }
  >();
  /** The names bound by the enclosing constructs: loop indices, callback
   * and user function parameters. */
  private scopes: Array<ReadonlySet<string>> = [];
  /** The scope of the parameters of a `Function` literal at the root: its
   * parameters are the inputs of the compiled function. */
  private rootParameters: ReadonlySet<string> | undefined;

  constructor(
    private readonly engine: ComputeEngine,
    private readonly options: BigintLaneOptions
  ) {}

  analyzeRoot(expr: Expression): void {
    if (isFunction(expr, 'Function')) {
      // The `Function` literal at the root: its parameters are the inputs,
      // read with the type the body gives them (§3.5). They are bound in
      // the body: a parameter is never read as the global symbol of its
      // name, which can have a value.
      const params = new Set(functionLiteralBoundNames(expr.ops.slice(1)));
      this.rootParameters = params;
      this.scopes = [params];
      const body = this.analyze(expr.ops[0], {});
      this.scopes = [];
      this.requireValue(body, expr.ops[0], 'the result of a function');
      this.set(expr, { ...this.blank('function', 'none'), type: 'function' });
      return;
    }
    const info = this.analyze(expr, {});
    this.requireValue(info, expr, 'the result');
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private isBound(name: string): boolean {
    return this.scopes.some((scope) => scope.has(name));
  }

  /** Whether `name` is a parameter of the `Function` literal at the root
   * that no inner construct rebinds: an input of the compiled function. */
  private isRootParameter(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--)
      if (this.scopes[i].has(name))
        return this.scopes[i] === this.rootParameters;
    return false;
  }

  /**
   * Whether the subtree `node` can be folded at compile time from the
   * value of `evaluate()`. It cannot when it mentions:
   * - a name bound by an enclosing construct (a loop index, a callback, a
   *   user function or root function parameter): `evaluate()` would read
   *   the global symbol of that name;
   * - an operator that the caller replaced (`operators`, `functions`) or a
   *   symbol with a `vars` entry: the compiled code must run the caller's
   *   code or read the input, not the engine's definition or value; the
   *   walk follows assigned values and user function bodies
   *   (`reachesExcludedName`);
   * - a variable whose assigned value is not an exact constant
   *   (`exactConstantValue`): with `c := Floor(Sin(y))`, `c` has no value
   *   to fold. An engine constant (`Pi`, `ExponentialE`) is not such a
   *   variable: `Floor(Pi)` folds to the exact `3` that `evaluate()` gives;
   * - a call whose head is a bound name or a `vars` entry: the call applies
   *   that binding, and `evaluate()` would apply the global function of the
   *   same name (`(g) ↦ g(2)` with a global `g := x ↦ x + 1`);
   * and when its estimated cost is above the limit of the double-mode fold
   * (`foldCostEstimate` against `CONSTANT_FOLD_MAX_COST`).
   */
  private foldable(node: Expression): boolean {
    if (this.mentionsUnfoldableName(node)) return false;
    const target = this.options.target;
    if (target !== undefined && reachesExcludedName(node, target)) return false;
    return core.foldCostEstimate(node) <= CONSTANT_FOLD_MAX_COST;
  }

  private mentionsUnfoldableName(node: Expression): boolean {
    if (this.unfoldableMemo?.scopes !== this.scopes)
      this.unfoldableMemo = { scopes: this.scopes, answers: new Map() };
    const answers = this.unfoldableMemo.answers;
    const known = answers.get(node);
    if (known !== undefined) return known;
    const answer = this.unfoldableNameAt(node);
    answers.set(node, answer);
    return answer;
  }

  private isUnfoldableName(name: string): boolean {
    if (this.isBound(name)) return true;
    if (this.options.isCallerSourceVar?.(name) === true) return true;
    return this.options.target?.varsKeys?.has(name) === true;
  }

  private unfoldableNameAt(node: Expression): boolean {
    if (isSymbol(node)) {
      const name = node.symbol;
      if (this.isUnfoldableName(name)) return true;
      if (node.isConstant) return false;
      const value = this.engine._getSymbolValue(name);
      return value !== undefined && !exactConstantValue(value);
    }
    if (!isFunction(node)) return false;
    if (this.overridden(node.operator)) return true;
    if (this.isUnfoldableName(node.operator)) return true;
    return node.ops.some((op) => this.mentionsUnfoldableName(op));
  }

  /** Run `fn` with `names` bound. With `fresh`, the names of the enclosing
   * constructs are not visible (the body of a user function is lexically
   * outside the call). */
  private withBound<T>(names: Iterable<string>, fn: () => T, fresh = false): T {
    const saved = this.scopes;
    this.scopes = [...(fresh ? [] : saved), new Set(names)];
    try {
      return fn();
    } finally {
      this.scopes = saved;
    }
  }

  private literalBody(
    literal: Expression & FunctionInterface,
    ctx: Context,
    fresh = false
  ): BigintLaneRecord {
    return this.withBound(
      functionLiteralBoundNames(literal.ops.slice(1)),
      () => this.analyze(literal.ops[0], ctx),
      fresh
    );
  }

  private blank(
    value: BigintLaneValue,
    lowering: BigintLowering,
    type: Type = 'unknown'
  ): BigintLaneRecord {
    return { value, type, lowering };
  }

  /** Record `record` for `node`. A node that the analysis visits more than
   * once (the same node object in two operands, or a body analyzed for two
   * calls) keeps the record of the last visit. */
  private set(node: Expression, record: BigintLaneRecord): BigintLaneRecord {
    this.records.set(node, record);
    return record;
  }

  private fail(node: Expression, reason: string, type?: Type): never {
    throw bigintLaneError({
      node: node.toString(),
      type: type !== undefined ? typeToString(type) : node.type.toString(),
      reason,
    });
  }

  /** A value the compiled code can return or hold in a list cell: anything
   * but a rational constant, a parent-lowered subtree or a callback. */
  private requireValue(
    info: BigintLaneRecord,
    node: Expression,
    what: string
  ): void {
    if (
      info.value === 'bigint' ||
      info.value === 'bigint-list' ||
      info.value === 'boolean' ||
      info.value === 'string'
    )
      return;
    this.fail(
      node,
      `${what} must be an integer, a list, a boolean or a string`
    );
  }

  /** An operand that must be a `bigint`. */
  private scalar(
    node: Expression,
    parentHead: string,
    ctx: Context = {}
  ): BigintLaneRecord {
    const info = this.analyze(node, ctx);
    if (info.value === 'bigint') return info;
    if (info.value === 'parent-lowered') return info;
    this.fail(
      node,
      `an operand of \`${parentHead}\` must be an integer value on the lane, not a ${describeValue(info.value)}`
    );
  }

  /** An operand that must be a list the mode holds as an array of
   * `bigint`. */
  private laneList(node: Expression, parentHead: string): BigintLaneRecord {
    const info = this.analyze(node, {});
    if (info.value !== 'bigint-list')
      this.fail(
        node,
        `an operand of \`${parentHead}\` must be a list of integers, not a ${describeValue(info.value)}`
      );
    return info;
  }

  /** Whether the overriding rule of the caller applies to `head`. */
  private overridden(head: string): boolean {
    return this.options.target?.overridesHead?.(head) === true;
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------

  /**
   * The record of `node` in the context `ctx`. A node object can be at
   * several positions of the tree (a DAG: `List(e, e)`): a node already
   * analyzed in the same scopes and with the same integer-forcing parent
   * gets the same record, so the walk is linear in the distinct nodes, not
   * in the paths from the root.
   */
  analyze(node: Expression, ctx: Context): BigintLaneRecord {
    const seen = this.analyzed.get(node);
    if (
      seen !== undefined &&
      seen.scopes === this.scopes &&
      seen.forcing === ctx.forcing
    )
      return seen.record;
    const record = this.analyzeNode(node, ctx);
    this.analyzed.set(node, {
      scopes: this.scopes,
      forcing: ctx.forcing,
      record,
    });
    return record;
  }

  private analyzeNode(node: Expression, ctx: Context): BigintLaneRecord {
    // A non-integer subtree under an integer-forcing parent (§3.2).
    if (ctx.forcing !== undefined) {
      const lowered = this.parentLowered(node, ctx.forcing);
      if (lowered !== undefined) return lowered;
    }

    if (isNumber(node)) return this.numberLiteral(node);
    if (isSymbol(node)) return this.symbol(node);
    if (isString(node))
      this.fail(node, 'a string literal is not a value of the mode');
    if (!isFunction(node))
      this.fail(node, 'this kind of expression is not a value of the mode');

    if (this.overridden(node.operator))
      this.fail(
        node,
        `the caller replaced the compilation of \`${node.operator}\` with the \`operators\` or \`functions\` option, and that code computes with doubles`
      );

    // A constant subtree with no free variable: folded, and emitted from
    // the exact value of `evaluate()`.
    const folded = this.constant(node);
    if (folded !== undefined) return folded;

    return this.application(node, ctx);
  }

  private numberLiteral(node: Expression): BigintLaneRecord {
    const t = node.type.type;
    const r = exactRational(node);
    if (r !== undefined && r.q === 1n)
      return this.set(node, this.blank('bigint', 'folded', t));
    if (r !== undefined)
      this.fail(
        node,
        'a rational constant is on the lane only as an operand of a comparison or of an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise)'
      );
    // A non-finite literal (`~oo`, `+oo`, `−oo`, `NaN`) is a pole
    // (§3.4): its code throws where the node is evaluated. The canonical
    // form of `0^(−1)` and `1/0` is `~oo`, and of `0^0` it is
    // `NaN`, so these nodes give the same result as the same
    // operation on inputs.
    if (bigintLane(t) && hasNonFiniteMember(t))
      return this.pole(
        node,
        isNumber(node) && node.isNaN === true ? NaN : Infinity
      );
    if (isInexactDecimalInteger(node))
      this.fail(
        node,
        'an integer literal held as an inexact decimal (a JavaScript number of 2^53 or more) is rounded by the interpreter under some operations; write it as an exact integer (a string of digits or a LaTeX literal)'
      );
    this.fail(node, 'a real (non-rational) constant has no exact bigint value');
  }

  private symbol(node: Expression & { symbol: string }): BigintLaneRecord {
    const name = node.symbol;
    if (name === 'True' || name === 'False')
      return this.set(node, this.blank('boolean', 'folded', 'boolean'));
    if (this.options.isCallerSourceVar?.(name) === true)
      this.fail(
        node,
        'the `vars` option gives it a value or source code that the mode cannot read as a bigint input'
      );
    const t = node.type.type;
    // A name bound by an enclosing construct (a loop index, a callback or
    // user function parameter) is a local of the emitted code. Any other
    // name is an input, or a constant that is folded. A parameter of the
    // `Function` literal at the root is an input. A symbol with a `vars`
    // entry is read from the vars object, not folded from its value.
    const rootParameter = this.isRootParameter(name);
    const local = !rootParameter && this.isBound(name);
    const value =
      local ||
      rootParameter ||
      this.options.target?.varsKeys?.has(name) === true
        ? undefined
        : node.engine._getSymbolValue(name);
    const constant = value !== undefined;
    const reading: BigintLowering = local
      ? 'bigint'
      : constant
        ? 'folded'
        : 'input';
    // A constant is folded from its value: the value must be an exact
    // integer, or a list of them, whatever the type of the symbol. With
    // `c := Floor(Sin(x))`, `c` is typed `integer` but has no value to
    // fold. A constant whose value is not finite (`c := 1/0`) is a pole, as
    // a non-finite literal is (§3.4).
    if (
      constant &&
      bigintLane(t) &&
      isNumber(value) &&
      (value.isNaN === true || value.isFinite === false)
    )
      return this.pole(node, value.isNaN === true ? NaN : Infinity);
    if (
      constant &&
      (bigintLane(t) || (t !== 'never' && isListOfIntegers(t))) &&
      !exactConstantValue(value, true)
    )
      this.fail(
        node,
        'its assigned value is not an exact integer constant, or a list of them, so it cannot be folded'
      );
    if (bigintLane(t)) {
      // A local whose type has a non-finite member (a parameter specialized
      // to the type `integer | infinity` of the argument `n!`) is an
      // ordinary bigint local: a pole throws before the local is bound, so
      // the local never holds a non-finite value (§3.4).
      if (hasNonFiniteMember(t) && !local)
        this.fail(
          node,
          constant
            ? 'a non-finite constant has no bigint value'
            : 'a binding whose type admits a non-finite value is not an input of the mode (CE-715.4)'
        );
      const record = this.blank('bigint', reading, t);
      if (reading === 'input') record.input = 'integer';
      return this.set(node, record);
    }
    if (t !== 'never' && isListOfIntegers(t)) {
      const record = this.blank('bigint-list', reading, t);
      if (reading === 'input') record.input = 'integer-list';
      return this.set(node, record);
    }
    if (bigintLane(t) === false && isSubtype(t, 'real') && constant)
      this.fail(
        node,
        'a real (non-rational) constant has no exact bigint value'
      );
    this.fail(
      node,
      'the mode accepts only bindings of a subtype of `integer`, or of `list<integer>`'
    );
  }

  /** A function node with no free variable whose value is folded. */
  private constant(
    node: Expression & FunctionInterface
  ): BigintLaneRecord | undefined {
    if (node.operator === 'Function') return undefined;
    if (node.unknowns.length > 0 || !node.isPure) return undefined;
    const t = node.type.type;
    if (t === 'never') return undefined;
    // A subtree that mentions a bound name, a caller's code or input, or a
    // symbol with a value that is not exact is analyzed as any other node.
    if (!this.foldable(node)) return undefined;
    if (bigintLane(t) && !hasNonFiniteMember(t))
      return this.set(node, this.blank('bigint', 'folded', t));
    if (isSubtype(t, 'boolean'))
      return this.set(node, this.blank('boolean', 'folded', t));
    if (isListOfIntegers(t))
      return this.set(node, this.blank('bigint-list', 'folded', t));
    const pole = this.constantPole(node);
    if (pole !== undefined) return this.pole(node, pole);
    if (isSubtype(t, 'string')) return undefined;
    // A constant whose type is a real type that is not on the lane (`π`,
    // `1/2`). A constant of a wider type (`f(3)`, typed `number` by the
    // engine) is analyzed as any other node.
    if (isSubtype(t, 'real') && !bigintLane(t)) {
      if (isSubtype(t, 'rational'))
        this.fail(
          node,
          'a rational constant is on the lane only as an operand of a comparison or of an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise)'
        );
      this.fail(
        node,
        'a real (non-rational) constant has no exact bigint value'
      );
    }
    return undefined;
  }

  /**
   * The pole of a constant node, or `undefined`. A constant node has a pole
   * when its head is a head of the lane that has poles (§3.4), every
   * operand is an exact integer constant, and the value of `evaluate()` is
   * not finite: `(−1)!` is `~oo`, `Mod(5, 0)` is `NaN`. The result is the
   * `number` that the helper of the head throws for the same operands at
   * run time: `NaN` for `NaN`, `Infinity` for every infinite value.
   *
   * The engine types some of these nodes as `number` (`(−1)!`), and such a
   * node is not on the lane as an application. The analysis folds it as a
   * pole instead, so that the node gives the same result as the same
   * operation on inputs (`n!` at `n = −1`). The emitted code throws where
   * the node is evaluated, not at compile time: a pole on a branch that
   * does not run has no effect (`If(n > 0, n, (−1)!)` is `n` for `n > 0`).
   *
   * Another head (`Ln(0)`, `Max()`, `Factorial2(−2)`), or an operand that
   * is not an exact integer (`Factorial(Ln(0))`), gives `undefined`, and
   * the node is analyzed as any other node.
   */
  private constantPole(
    node: Expression & FunctionInterface
  ): number | undefined {
    if (!POLE_HEADS.has(node.operator)) return undefined;
    for (const op of node.ops) {
      const r = exactRational(isNumber(op) ? op : op.evaluate());
      if (r === undefined || r.q !== 1n) return undefined;
    }
    const value = node.evaluate();
    if (!isNumber(value)) return undefined;
    if (value.isNaN === true) return NaN;
    if (value.isFinite === false) return Infinity;
    return undefined;
  }

  /** The record of a constant node whose value is the pole `pole`
   * (`Infinity` or `NaN`): a folded `bigint` node whose code throws a
   * `NonFiniteValue` with `pole` where it is evaluated (§3.4). */
  private pole(node: Expression, pole: number): BigintLaneRecord {
    return this.set(node, {
      ...this.blank(
        'bigint',
        'folded',
        Number.isNaN(pole) ? INTEGER_OR_NAN : INTEGER_OR_INFINITY
      ),
      pole,
    });
  }

  // -------------------------------------------------------------------------
  // Applications
  // -------------------------------------------------------------------------

  private application(
    node: Expression & FunctionInterface,
    ctx: Context
  ): BigintLaneRecord {
    const head = node.operator;
    if (COMPARISON_HEADS.has(head)) return this.comparison(node);
    switch (head) {
      case 'And':
      case 'Or':
      case 'Not':
        return this.booleanOperator(node);
      case 'IsPrime':
        return this.isPrime(node);
      case 'String':
        return this.string(node);
      case 'Boole':
        return this.boole(node);
      case 'Block':
        return this.block(node, ctx);
      case 'Add':
      case 'Subtract':
        return this.add(node);
      case 'Negate':
        return this.negate(node);
      case 'Abs':
        return this.abs(node);
      case 'Power':
        return this.power(node);
      case 'Mod':
      case 'Remainder':
        return this.mod(node);
      case 'Factorial2':
        return this.factorial2(node);
      case 'Floor':
      case 'Ceil':
      case 'Round':
      case 'Truncate':
        return this.rounding(node);
      case 'Typed':
        return this.typed(node);
      case 'If':
      case 'Which':
        return this.conditional(node);
      case 'Sum':
      case 'Product':
        return this.sum(node);
      case 'Reduce':
      case 'Fold':
        return this.fold(node);
      case 'Range':
        return this.range(node);
      case 'List':
        return this.list(node);
      case 'Map':
        return this.map(node);
      case 'Length':
      case 'Count':
        return this.length(node);
      case 'At':
      case 'First':
      case 'Last':
        return this.at(node);
      case 'Take':
      case 'Drop':
        return this.take(node);
      case 'ReplaceAt':
        return this.replaceAt(node);
      case 'Function':
        this.fail(node, 'a function value is not a value of the mode');
    }
    if (PLAIN_LANE_HEADS.has(head)) return this.plain(node);
    // A call whose head is a bound name (a parameter of the root `Function`
    // literal, of a callback or of a user function) or a `vars` entry
    // applies that binding, not the global user function of the same name:
    // in `(g) ↦ g(2)`, `g` is the argument. A function-valued binding is
    // not a value of the mode.
    if (this.isUnfoldableName(head))
      this.fail(
        node,
        `\`${head}\` is a bound name or a \`vars\` entry, and a call of a function-valued binding is not on the list of heads of the bigint mode`
      );
    if (isUserDefinedFunction(this.engine, head)) return this.userCall(node);
    if (isSubtype(node.type.type, 'number') && !bigintLane(node.type.type))
      this.notInteger(node);
    this.fail(
      node,
      `\`${head}\` is not on the list of heads of the bigint mode (CE-715.3)`
    );
  }

  /** The decline of a numeric node that is not an integer type and is not
   * a parent-lowered shape under an integer-forcing parent (§3.2, §3.3). */
  private notInteger(node: Expression, type?: Type): never {
    this.fail(
      node,
      'its type is not an integer type, and it is not the operand of an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise) in one of the shapes p/q·t, a/b, a^e or √t',
      type
    );
  }

  /** The lane test of a node whose head is on the list (§3.1). */
  private laneType(node: Expression, refined?: Type): Type {
    const t = refined ?? node.type.type;
    if (!bigintLane(t)) this.notInteger(node, t);
    return t;
  }

  /** Whether the parameter `i` of the library head of `node` is declared a
   * subtype of `integer`: the argument is then under an integer promise
   * (`Fibonacci` is `(integer) -> integer`, §3.2). */
  private integerParameter(
    node: Expression & FunctionInterface,
    i: number
  ): boolean {
    const sig = node.operatorDefinition?.signature?.type;
    const t = signatureParamType(sig, i);
    return t !== undefined && t !== 'never' && isSubtype(t, 'integer');
  }

  /** A head with `bigint` operands and no rule of its own: `Multiply`,
   * `Min`, `Max`, `Sign`, `GCD`, `LCM`, `Factorial`, `Binomial`,
   * `Fibonacci`. */
  private plain(node: Expression & FunctionInterface): BigintLaneRecord {
    // `n(n+1)/2` is `Multiply(Rational(1, 2), n, n + 1)`: the decline names
    // the product, not its rational factor.
    if (
      node.operator === 'Multiply' &&
      isNumber(node.op1) &&
      (exactRational(node.op1)?.q ?? 1n) !== 1n
    )
      this.notInteger(node);
    if ((node.operator === 'Min' || node.operator === 'Max') && node.nops === 0)
      this.fail(
        node,
        `\`${node.operator}\` with no operand is \`NaN\` in the interpreter, which has no bigint value`
      );
    const ops = node.ops.map((op, i) =>
      this.scalar(
        op,
        node.operator,
        this.integerParameter(node, i) ? { forcing: 'promise' } : {}
      )
    );
    const t = this.laneType(node, this.closedType(node, ops));
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /**
   * The type of a node whose head gives an integer for integer operands
   * (`Add`, `Subtract`, `Negate`, `Multiply`, `Min`, `Max`, and the
   * branches of `If` and `Which`), when the engine's type of the node is
   * not on the lane: `integer`, plus the non-finite members of the refined
   * types of its operands `ops` (§3.1.3). The engine types such a node from
   * the engine's types of its operands, which can be wider than their
   * refined types: with `f := x ↦ x!`, the engine types `f(n)` and
   * `f(n) + 1` as `number`, while the analysis gives `f(n)` the type of the
   * body, `infinity | integer`. `undefined` (the engine's type) for any
   * other head, or when the engine's type is on the lane.
   */
  private closedType(
    node: Expression & FunctionInterface,
    ops: ReadonlyArray<BigintLaneRecord>
  ): Type | undefined {
    if (!CLOSED_HEADS.has(node.operator)) return undefined;
    // With no operand there is no integer to give: `Max()` is `NaN`.
    if (node.nops === 0) return undefined;
    if (bigintLane(node.type.type)) return undefined;
    return withNonFiniteMembersOf(
      'integer',
      ops.map((info) => info.type)
    );
  }

  /** `Add`, `Subtract`: `bigint` operands. */
  private add(node: Expression & FunctionInterface): BigintLaneRecord {
    const ops = node.ops.map((op) => this.scalar(op, node.operator));
    const t = this.laneType(node, this.closedType(node, ops));
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  private negate(node: Expression & FunctionInterface): BigintLaneRecord {
    const info = this.scalar(node.op1, 'Negate');
    const t = this.laneType(node, this.closedType(node, [info]));
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /** `Abs(t)`: refined `integer<0..>`, plus `nan` when `t` can be `NaN` and
   * `infinity` when `t` can be infinite (§3.1.3). */
  private abs(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 1) this.fail(node, '`Abs` takes one operand');
    const info = this.scalar(node.op1, 'Abs');
    const t = this.laneType(
      node,
      refinedType(node, withNonFiniteMembersOf('integer<0..>', [info.type]))
    );
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /** `Power(t, u)` with `u` typed `integer<0..>`: refined `integer`, plus
   * `nan` when `t` and `u` can both be `0` (`0^0`, §3.1.3). Any other
   * exponent is lowered only by a rounding parent or an integer promise
   * (§3.2). */
  private power(node: Expression & FunctionInterface): BigintLaneRecord {
    const [base, exp] = node.ops;
    const expInfo = this.analyze(exp, {});
    // `(−1)^k` is `1` or `−1` for every integer `k`, also a negative one:
    // the engine types it `rational`, and the sign of `k` does not matter.
    // The exponent of the `bpow` lowering can then be negative.
    const unitBase = exactRational(base);
    if (
      unitBase !== undefined &&
      unitBase.q === 1n &&
      unitBase.p === -1n &&
      expInfo.value === 'bigint'
    ) {
      const t = this.laneType(node, refinedType(node, 'integer'));
      this.set(base, this.blank('bigint', 'folded', base.type.type));
      return this.set(node, this.blank('bigint', 'bigint', t));
    }
    if (
      expInfo.value !== 'bigint' ||
      !isSubtype(expInfo.type, NON_NEGATIVE_INTEGER)
    )
      this.fail(
        node,
        'the exponent is not typed `integer<0..>`, so the power is not an integer; it is on the lane only under an integer-forcing parent (Floor, Ceil, Round, Truncate, an integer promise)'
      );
    const baseInfo = this.scalar(base, 'Power');
    const nan = canBeZero(base, baseInfo.type) && canBeZero(exp, expInfo.type);
    const t = this.laneType(
      node,
      refinedType(node, nan ? INTEGER_OR_NAN : 'integer')
    );
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /** `Mod(t, u)`, `Remainder(t, u)`: refined `integer | nan`, or `integer`
   * when `u` is a non-zero literal (§3.1.3). `Mod` is `(real, real) ->
   * real`: not an integer promise, so `Mod(n/2, 7)` declines (it is `3/2`
   * at `n = 3`). */
  private mod(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 2)
      this.fail(node, `\`${node.operator}\` takes two operands`);
    const [t, u] = node.ops;
    this.scalar(t, node.operator);
    this.scalar(u, node.operator);
    const nan = !isNonZeroLiteral(u);
    const type = this.laneType(
      node,
      refinedType(node, nan ? INTEGER_OR_NAN : 'integer')
    );
    return this.set(node, this.blank('bigint', 'bigint', type));
  }

  /** `Factorial2(t)` with `t` typed `integer<0..>`: refined `integer`
   * (§3.1.3). Any other operand declines: `(−5)!! = 1/3`. */
  private factorial2(node: Expression & FunctionInterface): BigintLaneRecord {
    const info = this.scalar(node.op1, 'Factorial2');
    if (info.value !== 'bigint' || !isSubtype(info.type, NON_NEGATIVE_INTEGER))
      this.fail(
        node,
        'the operand is not typed `integer<0..>`, and the double factorial of a negative odd integer is a rational (`(−5)!! = 1/3`)'
      );
    return this.set(
      node,
      this.blank('bigint', 'bigint', refinedType(node, 'integer'))
    );
  }

  // -------------------------------------------------------------------------
  // Integer-forcing parents
  // -------------------------------------------------------------------------

  /** `Floor`, `Ceil`, `Round`, `Truncate` of a lane operand, or of a shape
   * of §3.2 that the head lowers. */
  private rounding(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 1)
      this.fail(
        node,
        `\`${node.operator}\` with a step operand is not on the list of heads of the bigint mode (CE-715.3)`
      );
    const forcing = node.operator as BigintForcingParent;
    const info = this.analyze(node.op1, { forcing });
    if (info.value !== 'bigint' && info.value !== 'parent-lowered')
      this.fail(
        node.op1,
        `an operand of \`${node.operator}\` must be an integer value on the lane, not a ${describeValue(info.value)}`
      );
    const t = this.laneType(node);
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /** `Typed(x, T)` with `T` a subtype of `integer`: an integer promise for
   * `x` (§3.2). */
  private typed(node: Expression & FunctionInterface): BigintLaneRecord {
    const promised = functionLiteralParameterType(node);
    if (
      promised === undefined ||
      promised === 'never' ||
      !isSubtype(promised, 'integer')
    )
      this.fail(
        node,
        'an ascription is on the lane only with a subtype of `integer`'
      );
    const info = this.analyze(node.op1, { forcing: 'promise' });
    if (info.value !== 'bigint' && info.value !== 'parent-lowered')
      this.fail(
        node.op1,
        `an operand of \`Typed\` must be an integer value on the lane, not a ${describeValue(info.value)}`
      );
    const t = this.laneType(node);
    return this.set(node, {
      ...this.blank('bigint', 'bigint', t),
      promiseType: promised,
    });
  }

  /**
   * The shapes of §3.2 under an integer-forcing parent: the record of a
   * parent-lowered node, or `undefined` when `node` is not one of them (it
   * is then analyzed as any other node). A shape whose operands are not on
   * the lane declines.
   */
  private parentLowered(
    node: Expression,
    parent: BigintForcingParent
  ): BigintLaneRecord | undefined {
    if (!isFunction(node)) return undefined;
    // An integer node is not lowered by its parent.
    if (bigintLane(node.type.type)) return undefined;
    if (this.overridden(node.operator)) return undefined;
    let shape: BigintParentLoweredShape | undefined;
    let operands: ReadonlyArray<Expression> = [];
    let rational: { p: bigint; q: bigint } | undefined;
    if (node.operator === 'Multiply' && node.nops >= 2) {
      const r = isNumber(node.op1) ? exactRational(node.op1) : undefined;
      if (r !== undefined && r.q !== 1n) {
        shape = 'rational-product';
        operands = node.ops.slice(1);
        rational = r;
      }
    } else if (node.operator === 'Divide' && node.nops === 2) {
      shape = 'quotient';
      operands = node.ops;
    } else if (node.operator === 'Power' && node.nops === 2) {
      shape = 'power';
      operands = node.ops;
    } else if (
      node.operator === 'Sqrt' &&
      node.nops === 1 &&
      parent !== 'promise'
    ) {
      shape = 'sqrt';
      operands = node.ops;
    }
    if (shape === undefined) return undefined;
    for (const op of operands) {
      const info = this.scalar(op, node.operator);
      if (info.value !== 'bigint')
        this.fail(
          op,
          `an operand of \`${node.operator}\` must be an integer value on the lane`
        );
    }
    if (rational !== undefined)
      this.set(node.op1, {
        ...this.blank('rational-constant', 'none', node.op1.type.type),
        rational,
      });
    return this.set(node, {
      ...this.blank('parent-lowered', 'none', node.type.type),
      parentLowered: { shape },
    });
  }

  // -------------------------------------------------------------------------
  // Booleans, comparisons and strings
  // -------------------------------------------------------------------------

  /** `Less`, `Greater`, `LessEqual`, `GreaterEqual`, `Equal`, `NotEqual`:
   * both operands on the lane, or one on the lane and the other a rational
   * constant, compared exactly (§3.3). */
  private comparison(node: Expression & FunctionInterface): BigintLaneRecord {
    const head = node.operator;
    if (node.nops !== 2)
      this.fail(
        node,
        'a chained comparison is not on the list of heads of the bigint mode (CE-715.8)'
      );
    const record = this.blank('boolean', 'none', 'boolean');
    let constantOperand = -1;
    let constant: { p: bigint; q: bigint } | undefined;
    node.ops.forEach((op, i) => {
      // A constant operand is evaluated here: only when it can be folded
      // (`foldable`). Otherwise it is analyzed as any other operand.
      if (
        constantOperand < 0 &&
        isConstantNumeric(op) &&
        (isNumber(op) || this.foldable(op))
      ) {
        const r = exactRational(isNumber(op) ? op : op.evaluate());
        if (r !== undefined && r.q !== 1n) {
          constantOperand = i;
          constant = r;
          this.set(op, {
            ...this.blank('rational-constant', 'none', op.type.type),
            rational: r,
          });
          return;
        }
      }
      const info = this.analyze(op, {});
      if (info.value !== 'bigint')
        this.fail(
          op,
          `an operand of \`${head}\` must be an integer value on the lane or a rational constant, not a ${describeValue(info.value)}`
        );
    });
    if (constant !== undefined) {
      record.comparison = {
        constantOperand,
        p: constant.p,
        q: constant.q,
        ...(head === 'Equal' ? { folded: false } : {}),
        ...(head === 'NotEqual' ? { folded: true } : {}),
      };
    }
    return this.set(node, record);
  }

  private booleanOperator(
    node: Expression & FunctionInterface
  ): BigintLaneRecord {
    for (const op of node.ops) {
      const info = this.analyze(op, {});
      if (info.value !== 'boolean')
        this.fail(
          op,
          `an operand of \`${node.operator}\` must be a boolean, not a ${describeValue(info.value)}`
        );
    }
    return this.set(node, this.blank('boolean', 'none', 'boolean'));
  }

  /** `IsPrime` of a lane value, through `isPrimeBigint` (§3.1.1). */
  private isPrime(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 1) this.fail(node, '`IsPrime` takes one operand');
    const info = this.scalar(node.op1, 'IsPrime');
    if (info.value !== 'bigint')
      this.fail(node.op1, 'the operand of `IsPrime` must be an integer value');
    return this.set(node, this.blank('boolean', 'bigint', 'boolean'));
  }

  /** `String` of a lane value declines. The interpreter writes a large
   * integer in exponent form (`String(n^2)` at `n = 10^15` is `"1e+30"`),
   * and the JavaScript `String(x)` of a `bigint` writes every digit, so
   * the compiled string would differ from the value of `evaluate()`
   * (CE-715.3). */
  private string(node: Expression & FunctionInterface): never {
    if (node.nops !== 1)
      this.fail(
        node,
        '`String` is on the lane with one operand only (CE-715.3)'
      );
    const info = this.analyze(node.op1, {});
    if (info.value !== 'bigint')
      this.fail(
        node.op1,
        `\`String\` is on the lane only for an integer operand, not a ${describeValue(info.value)} (CE-715.3)`
      );
    this.fail(
      node,
      "`String` of an integer is not on the list of heads of the bigint mode: the interpreter's number format (exponent form for a large integer) is not reproduced (CE-715.3)"
    );
  }

  /** `Boole(b)`: `BigInt(<boolean>)`, lowering (b). */
  private boole(node: Expression & FunctionInterface): BigintLaneRecord {
    const info = this.analyze(node.op1, {});
    if (info.value !== 'boolean')
      this.fail(node.op1, 'the operand of `Boole` must be a boolean');
    const t = this.laneType(node);
    return this.set(node, this.blank('bigint', 'number-wrapped', t));
  }

  /** A `Block` with a single operand (the body that canonicalization gives
   * a function literal) is the value of that operand. A longer block has
   * statements, which are not on the list of heads. */
  private block(
    node: Expression & FunctionInterface,
    ctx: Context
  ): BigintLaneRecord {
    if (node.nops !== 1)
      this.fail(
        node,
        'a block of statements is not on the list of heads of the bigint mode (CE-715.8)'
      );
    const info = this.analyze(node.op1, ctx);
    return this.set(node, { ...info });
  }

  // -------------------------------------------------------------------------
  // Conditionals
  // -------------------------------------------------------------------------

  /** `If(c, a, b)` and `Which(c₁, v₁, …, True, vₖ)`: boolean tests, and
   * branches of one kind. */
  private conditional(node: Expression & FunctionInterface): BigintLaneRecord {
    const ops = node.ops;
    let tests: Expression[];
    let branches: Expression[];
    if (node.operator === 'If') {
      if (ops.length !== 3)
        this.fail(node, 'an `If` without an `else` branch has no value');
      tests = [ops[0]];
      branches = [ops[1], ops[2]];
    } else {
      if (
        ops.length < 2 ||
        ops.length % 2 !== 0 ||
        !isSymbol(ops[ops.length - 2], 'True')
      )
        this.fail(
          node,
          'a `Which` whose last test is not `True` can have no value'
        );
      tests = ops.filter((_, i) => i % 2 === 0);
      branches = ops.filter((_, i) => i % 2 === 1);
    }
    for (const test of tests) {
      const info = this.analyze(test, {});
      if (info.value !== 'boolean')
        this.fail(test, 'the test of a conditional must be a boolean');
    }
    let value: BigintLaneValue | undefined;
    const infos: BigintLaneRecord[] = [];
    for (const branch of branches) {
      const info = this.analyze(branch, {});
      if (info.value !== 'bigint' && info.value !== 'boolean')
        this.fail(
          branch,
          `a branch of \`${node.operator}\` must be an integer value or a boolean, not a ${describeValue(info.value)}`
        );
      if (value !== undefined && value !== info.value)
        this.fail(branch, 'the branches give different kinds of value');
      value = info.value;
      infos.push(info);
    }
    if (value === 'boolean')
      return this.set(node, this.blank('boolean', 'none', 'boolean'));
    const t = this.laneType(node, this.closedType(node, infos));
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  // -------------------------------------------------------------------------
  // Loops and collections
  // -------------------------------------------------------------------------

  /** `Sum(body, Limits(i, lo, hi), …)`, `Product(…)`: a loop with a
   * `bigint` counter. The limits are on the lane (a rational bound declines,
   * CE-715.2; a limit is not an integer promise), and so is the body. The
   * first `Limits` is the outer loop: the bounds of each `Limits` are
   * analyzed with the indices of the earlier ones bound
   * (`Sum(p·j, Limits(p, 1, n), Limits(j, 1, p))`, whose inner bound `p` is
   * the outer index), and the body with every index bound. */
  private sum(node: Expression & FunctionInterface): BigintLaneRecord {
    const [body, ...limits] = node.ops;
    if (limits.length === 0)
      this.fail(
        node,
        `\`${node.operator}\` without index limits is not on the list of heads of the bigint mode (CE-715.3)`
      );
    const loop = (i: number): BigintLaneRecord => {
      if (i === limits.length) return this.scalar(body, node.operator);
      const limit = limits[i];
      if (!isFunction(limit, 'Limits') || limit.nops !== 3)
        return this.fail(
          limit,
          `an index of \`${node.operator}\` must have a lower and an upper limit`
        );
      for (const bound of limit.ops.slice(1)) {
        if (isRationalTyped(bound))
          this.fail(
            bound,
            `a limit of \`${node.operator}\` that is not an integer is not on the lane: the interpreter takes the floor of the count there (CE-715.2)`
          );
        const info = this.analyze(bound, {});
        if (info.value !== 'bigint')
          this.fail(
            bound,
            `a limit of \`${node.operator}\` must be an integer value on the lane (a rational bound is CE-715.2)`
          );
      }
      this.set(limit, this.blank('bigint', 'none', 'unknown'));
      return this.withBound(isSymbol(limit.op1) ? [limit.op1.symbol] : [], () =>
        loop(i + 1)
      );
    };
    const info = loop(0);
    if (info.value !== 'bigint')
      this.fail(
        body,
        `the body of \`${node.operator}\` must be an integer value`
      );
    // A sum or a product of integers is an integer (an empty sum is `0`,
    // an empty product `1`), plus the non-finite members of the body. The
    // engine types `Sum(k!, k = 0..n)` as `number`.
    const t = this.laneType(
      node,
      bigintLane(node.type.type)
        ? undefined
        : withNonFiniteMembersOf('integer', [info.type])
    );
    return this.set(node, this.blank('bigint', 'bigint', t));
  }

  /**
   * `Reduce(coll, f, init?)` and `Fold(f, init, coll)` over a lane list,
   * with a callback whose body is on the lane. The engine
   * types the callback with untyped parameters, and the fold as `number`;
   * the analysis types the accumulator and the element parameters
   * `integer` (the seed and every element are lane values) and analyzes
   * that copy of the callback. When its body gives an integer, every step
   * of the fold does, so the fold is typed `integer`, plus the non-finite
   * members of the seed and of the body (§3.1.3).
   */
  private fold(node: Expression & FunctionInterface): BigintLaneRecord {
    let coll: Expression;
    let fn: Expression;
    let init: Expression | undefined;
    if (node.operator === 'Reduce') [coll, fn, init] = node.ops;
    else [fn, init, coll] = node.ops;
    this.laneList(coll, node.operator);
    // The elements are the arguments of the callback: each must be an
    // integer, not a list (`Reduce([1, [2, 3]], (a, b) ↦ a + b, 0)` is
    // `[3, 4]`).
    const element = collectionElementTypeOf(coll);
    if (
      element === undefined ||
      element === 'never' ||
      !isSubtype(element, 'integer')
    )
      this.fail(
        coll,
        `the elements of the collection of \`${node.operator}\` must be integers, not lists`
      );
    const seed =
      init === undefined ? undefined : this.scalar(init, node.operator);
    if (init === undefined && !isNonEmptyCollection(coll))
      // `Reduce(L, (a, b) ↦ a + b)` is `Nothing` for an empty `L`.
      this.fail(
        coll,
        '`Reduce` with no initial value gives `Nothing` for an empty collection, and this collection is not known to be non-empty'
      );
    const original = this.callbackLiteral(fn, node.operator);
    if (original.nops !== 3)
      this.fail(
        fn,
        `the callback of \`${node.operator}\` must take two parameters`
      );
    // A declared parameter type is kept: it must be on the integer lane,
    // as for a call of a user function (§3.1.2). An untyped parameter is
    // typed `integer`.
    const inferred =
      isSymbol(fn) && userFunctionSignatureIsInferred(this.engine, fn.symbol);
    const signature = isSymbol(fn)
      ? userFunctionSignature(this.engine, fn.symbol)
      : undefined;
    const types = original.ops.slice(1).map((param, i): Type | undefined => {
      const declared =
        functionLiteralParameterType(param) ??
        (inferred ? undefined : signatureParamType(signature, i));
      if (declared === undefined) return 'integer';
      if (declared === 'never' || !isSubtype(declared, 'integer'))
        this.fail(
          fn,
          `the parameter ${i + 1} of the callback of \`${node.operator}\` is typed \`${typeToString(declared)}\`, which is not on the integer lane, so the fold would mix bigint and double values`
        );
      return functionLiteralParameterType(param) === undefined
        ? declared
        : undefined;
    });
    const literal = literalWithParameterTypes(this.engine, original, types);
    if (literal === undefined)
      this.fail(
        fn,
        `the callback of \`${node.operator}\` cannot be typed with integer parameters`
      );
    // The body of a named callback (a user function) is lexically outside
    // the expression: no enclosing bound name is visible in it. A callback
    // declared `-> integer` is an integer promise for its body, as for a
    // call (§3.1.2, §3.2).
    const promise = callbackResultPromise(inferred, signature);
    const body = this.literalBody(
      literal,
      promise !== undefined ? { forcing: 'promise' } : {},
      !isFunction(fn, 'Function')
    );
    if (
      body.value !== 'bigint' &&
      !(body.value === 'parent-lowered' && promise !== undefined)
    )
      this.fail(
        literal.ops[0],
        `the callback of \`${node.operator}\` must give an integer value`
      );
    this.set(literal, {
      ...this.blank('function', 'none', literal.type.type),
      ...(promise !== undefined ? { promiseType: promise } : {}),
    });
    const bodyType = promise ?? body.type;
    const t = bigintLane(node.type.type)
      ? node.type.type
      : withNonFiniteMembersOf(
          'integer',
          seed === undefined ? [bodyType] : [seed.type, bodyType]
        );
    return this.set(node, {
      ...this.blank('bigint', 'bigint', t),
      callback: literal,
    });
  }

  private callbackLiteral(
    fn: Expression,
    parentHead: string
  ): Expression & FunctionInterface {
    let literal: (Expression & FunctionInterface) | undefined;
    if (isFunction(fn, 'Function')) literal = fn;
    // A callback named by a bound name (`(g) ↦ Map(g, L)`) or a `vars`
    // entry is that binding, not the global user function of its name.
    else if (
      isSymbol(fn) &&
      !this.overridden(fn.symbol) &&
      !this.isUnfoldableName(fn.symbol)
    ) {
      const local = this.options.target?.localFunctions?.get(fn.symbol);
      if (
        local === undefined &&
        !this.options.target?.boundVars?.has(fn.symbol)
      )
        literal = userFunctionLiteral(this.engine, fn.symbol);
    }
    if (literal === undefined)
      this.fail(
        fn,
        `the callback of \`${parentHead}\` must be a function literal or a user function`
      );
    return literal;
  }

  /** `Range(lo, hi, step)` with lane operands: an array of `bigint`. */
  private range(node: Expression & FunctionInterface): BigintLaneRecord {
    for (const op of node.ops) {
      if (isRationalTyped(op))
        this.fail(
          op,
          'an operand of `Range` that is not an integer is not on the lane: the interpreter takes the floor of the count there (CE-715.2)'
        );
      const info = this.analyze(op, {});
      if (info.value !== 'bigint')
        this.fail(
          op,
          'an operand of `Range` must be an integer value on the lane (a rational bound is CE-715.2)'
        );
    }
    const t = node.type.type;
    if (!isListOfIntegers(t))
      this.fail(node, 'the elements of this range are not integers');
    return this.set(node, this.blank('bigint-list', 'bigint', t));
  }

  /** `List(…)` of lane cells: an array of `bigint`. A cell that throws at
   * a pole ends the whole computation, so the result is then a `number`
   * (§3.4). */
  private list(node: Expression & FunctionInterface): BigintLaneRecord {
    for (const cell of node.ops) {
      const info = this.analyze(cell, {});
      if (info.value !== 'bigint' && info.value !== 'bigint-list')
        this.fail(
          cell,
          `a cell of a list must be an integer value or a list of them, not a ${describeValue(info.value)}`
        );
    }
    return this.set(node, this.blank('bigint-list', 'bigint', node.type.type));
  }

  /** `Map(f, coll)` over a lane list: an array of `bigint`, one cell for
   * each application of the callback. */
  private map(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 2)
      this.fail(
        node,
        '`Map` over more than one collection is not on the list of heads of the bigint mode (CE-715.3)'
      );
    const [fn, coll] = node.ops;
    this.laneList(coll, 'Map');
    const original = this.callbackLiteral(fn, 'Map');
    if (original.nops !== 2)
      this.fail(fn, 'the callback of `Map` must take one parameter');
    const t = node.type.type;
    // An inline literal is typed by the engine with the element type of
    // the collection. The literal of a user function named as the callback
    // is typed with its own parameters, as for a call (§3.1.2): a bare
    // parameter is given the type of the signature when the signature is
    // declared, which must be on the integer lane, and the element type
    // when the signature is inferred.
    const element = collectionElementTypeOf(coll);
    let literal = original;
    const named = !isFunction(fn, 'Function');
    const inferred =
      isSymbol(fn) && userFunctionSignatureIsInferred(this.engine, fn.symbol);
    const signature = isSymbol(fn)
      ? userFunctionSignature(this.engine, fn.symbol)
      : undefined;
    if (named && functionLiteralParameterType(original.ops[1]) === undefined) {
      const declared = inferred ? undefined : signatureParamType(signature, 0);
      if (
        declared !== undefined &&
        (declared === 'never' || !isSubtype(declared, 'integer'))
      )
        this.fail(
          fn,
          `the parameter of the callback of \`Map\` is typed \`${typeToString(declared)}\`, which is not on the integer lane, so the map would mix bigint and double values`
        );
      const paramType = declared ?? element;
      const typed =
        paramType === undefined
          ? undefined
          : literalWithParameterTypes(this.engine, original, [paramType]);
      if (typed === undefined)
        this.fail(
          fn,
          'the callback of `Map` cannot be typed with the element type of the list'
        );
      literal = typed;
    }
    // The body of a named callback (a user function) is lexically outside
    // the expression: no enclosing bound name is visible in it. A callback
    // declared `-> integer` is an integer promise for its body, as for a
    // call (§3.1.2, §3.2).
    const promise = callbackResultPromise(inferred, signature);
    const body = this.literalBody(
      literal,
      promise !== undefined ? { forcing: 'promise' } : {},
      named
    );
    if (
      body.value !== 'bigint' &&
      !(body.value === 'parent-lowered' && promise !== undefined)
    )
      this.fail(
        literal.ops[0],
        `the callback of \`Map\` must give an integer value, not a ${describeValue(body.value)}`
      );
    this.set(literal, {
      ...this.blank('function', 'none', literal.type.type),
      ...(promise !== undefined ? { promiseType: promise } : {}),
    });
    return this.set(node, {
      ...this.blank('bigint-list', 'bigint', t),
      callback: literal,
    });
  }

  /** `Length(L)`, `Count(L)` of a list the mode holds: lowering (b). The
   * engine types them `integer | infinity` for an infinite collection; an
   * array is finite, so the refined type is `integer<0..>`. */
  private length(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 1)
      this.fail(
        node,
        `\`${node.operator}\` with a predicate is not on the list of heads of the bigint mode (CE-715.3)`
      );
    this.laneList(node.op1, node.operator);
    return this.set(
      node,
      this.blank('bigint', 'number-wrapped', NON_NEGATIVE_INTEGER)
    );
  }

  /** `At(L, i)`, `First(L)`, `Last(L)`: lowering (c). An index out of range
   * is a pole carrying `NaN`, as the engine's type `integer | nan` of
   * `At(L, n)` shows (§3.1.1). */
  private at(node: Expression & FunctionInterface): BigintLaneRecord {
    const expected = node.operator === 'At' ? 2 : 1;
    if (node.nops !== expected)
      this.fail(
        node,
        `\`${node.operator}\` with ${node.nops} operands is not on the list of heads of the bigint mode (CE-715.3)`
      );
    this.laneList(node.op1, node.operator);
    if (node.operator === 'At') {
      const info = this.scalar(node.op2, 'At');
      if (info.value !== 'bigint')
        this.fail(node.op2, 'the index of `At` must be an integer value');
    }
    const t = this.laneType(node);
    return this.set(node, this.blank('bigint', 'index-conversion', t));
  }

  /** `Take(L, c)`, `Drop(L, c)` with a lane count: lowering (c). */
  private take(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 2)
      this.fail(node, `\`${node.operator}\` takes a list and a count`);
    this.laneList(node.op1, node.operator);
    const info = this.scalar(node.op2, node.operator);
    if (info.value !== 'bigint')
      this.fail(
        node.op2,
        `the count of \`${node.operator}\` must be an integer value`
      );
    const t = node.type.type;
    if (!isListOfIntegers(t))
      this.fail(node, 'the elements of this list are not integers');
    return this.set(node, this.blank('bigint-list', 'index-conversion', t));
  }

  /** `ReplaceAt(L, i, v)` with a lane position: lowering (c). The position
   * parameter is `integer`, an integer promise. */
  private replaceAt(node: Expression & FunctionInterface): BigintLaneRecord {
    if (node.nops !== 3)
      this.fail(node, '`ReplaceAt` takes a list, a position and a value');
    this.laneList(node.op1, 'ReplaceAt');
    for (const i of [1, 2]) {
      const op = node.ops[i];
      this.scalar(
        op,
        'ReplaceAt',
        this.integerParameter(node, i) ? { forcing: 'promise' } : {}
      );
    }
    const t = node.type.type;
    if (!isListOfIntegers(t))
      this.fail(node, 'the elements of this list are not integers');
    return this.set(node, this.blank('bigint-list', 'index-conversion', t));
  }

  // -------------------------------------------------------------------------
  // User functions
  // -------------------------------------------------------------------------

  /**
   * A call of a user function (§3.1.2). The lane of a parameter is its
   * declared type, or the type of the argument when the literal gives the
   * parameter no type and the signature is inferred (the literal is then
   * analyzed with parameters typed by the arguments). A call whose argument
   * lane differs from the parameter lane declines. A function declared
   * `-> integer` is an integer promise for its body. The emitted definition
   * has no catch: a pole in its body goes up to the catch of the compiled
   * entry (§3.4).
   */
  private userCall(node: Expression & FunctionInterface): BigintLaneRecord {
    const h = node.operator;
    const literal = userFunctionLiteral(this.engine, h);
    if (literal === undefined)
      this.fail(
        node,
        `\`${h}\` has no single function literal to compile (a multi-clause or declared-only function is not on the lane)`
      );
    const params = literal.ops.slice(1);
    if (params.length !== node.nops)
      this.fail(
        node,
        `the call gives ${node.nops} arguments to \`${h}\`, which takes ${params.length}`
      );
    const inferred = userFunctionSignatureIsInferred(this.engine, h);
    const signature = userFunctionSignature(this.engine, h);
    const types: Array<Type | undefined> = [];
    let specialize = false;
    node.ops.forEach((arg, i) => {
      const annotated = functionLiteralParameterType(params[i]);
      const declared =
        annotated ?? (inferred ? undefined : signatureParamType(signature, i));
      if (declared !== undefined) {
        if (declared === 'never' || !isSubtype(declared, 'integer'))
          this.fail(
            arg,
            `the parameter ${i + 1} of \`${h}\` is typed \`${typeToString(declared)}\`, which is not on the integer lane, so the call would mix bigint and double values`
          );
        this.scalar(arg, h, { forcing: 'promise' });
        // A type read from the signature is given to the bare parameter of
        // the literal: the literal's body was typed with the parameter
        // `unknown`.
        if (annotated === undefined) {
          types.push(declared);
          specialize = true;
        } else types.push(undefined);
        return;
      }
      const info = this.scalar(arg, h);
      if (info.value !== 'bigint')
        this.fail(arg, `an argument of \`${h}\` must be an integer value`);
      types.push(info.type);
      specialize = true;
    });
    const resultType =
      !inferred && signature !== undefined ? signature.result : undefined;
    const resultPromise =
      resultType !== undefined &&
      resultType !== 'never' &&
      isSubtype(resultType, 'integer');

    const key = parameterTypesKey(h, types);
    const analyzed = this.userBody(
      h,
      key,
      literal,
      specialize ? types : undefined,
      resultPromise,
      resultType
    );
    const t = this.laneType(node, analyzed.type);
    return this.set(node, {
      ...this.blank('bigint', 'bigint', t),
      userCall: { name: h, literal: analyzed.literal, resultPromise },
    });
  }

  /** The type of a call of `h`, from an analysis of its body in a scope
   * that holds only its parameters. A recursive call met while the body is
   * analyzed has the declared result type, or the engine's type of the
   * body. */
  private userBody(
    h: string,
    key: string,
    literal: Expression & FunctionInterface,
    types: Array<Type | undefined> | undefined,
    resultPromise: boolean,
    resultType: Type | undefined
  ): { type: Type; literal: Expression & FunctionInterface } {
    const memo = this.callMemo.get(key);
    if (memo !== undefined) return memo;
    if (this.inProgress.has(key))
      return { type: resultType ?? literal.ops[0].type.type, literal };
    let analyzedLiteral = literal;
    if (types !== undefined) {
      const typed = literalWithParameterTypes(this.engine, literal, types);
      if (typed === undefined)
        this.fail(
          literal,
          `the body of \`${h}\` cannot be typed with the types of the arguments`
        );
      analyzedLiteral = typed;
    }
    this.inProgress.add(key);
    let body: BigintLaneRecord;
    try {
      body = this.literalBody(
        analyzedLiteral,
        resultPromise ? { forcing: 'promise' } : {},
        true
      );
    } finally {
      this.inProgress.delete(key);
    }
    if (body.value !== 'bigint' && body.value !== 'parent-lowered')
      this.fail(
        analyzedLiteral.ops[0],
        `the body of \`${h}\` must give an integer value, not a ${describeValue(body.value)}`
      );
    if (body.value === 'parent-lowered' && !resultPromise)
      this.notInteger(analyzedLiteral.ops[0]);
    const result = {
      type: resultPromise ? resultType! : body.type,
      literal: analyzedLiteral,
    };
    this.callMemo.set(key, result);
    this.set(
      analyzedLiteral,
      this.blank('function', 'none', analyzedLiteral.type.type)
    );
    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers on nodes
// ---------------------------------------------------------------------------

function describeValue(v: BigintLaneValue): string {
  switch (v) {
    case 'bigint':
      return 'integer';
    case 'bigint-list':
      return 'list';
    case 'rational-constant':
      return 'rational constant';
    case 'parent-lowered':
      return 'non-integer value';
    case 'function':
      return 'function';
    default:
      return v;
  }
}

/**
 * The refined type of `node` (§3.1.3): `table`, the type of the refinement
 * table, when the engine's type of `node` is not on the lane, and the
 * engine's type otherwise. A refinement never admits a value that the
 * engine's type excludes, so an engine type on the lane, which is at least
 * as narrow (`integer<0..>` for `n^2`), is kept.
 */
function refinedType(node: Expression, table: Type): Type {
  const engine = node.type.type;
  return bigintLane(engine) ? engine : table;
}

/** Whether `node` is a numeric node whose type is not on the lane but
 * admits only rationals (`n/2`). */
function isRationalTyped(node: Expression): boolean {
  const t = node.type.type;
  return t !== 'never' && !bigintLane(t) && isSubtype(t, 'rational');
}

/** The declared result type of a named callback whose signature is
 * declared (`inferred` is `false`) with a result that is a subtype of
 * `integer`: an integer promise for the body of the callback (§3.2).
 * `undefined` for any other callback. */
function callbackResultPromise(
  inferred: boolean,
  signature: { result: Type } | undefined
): Type | undefined {
  if (inferred || signature === undefined) return undefined;
  const result = signature.result;
  return result !== 'never' && isSubtype(result, 'integer')
    ? result
    : undefined;
}

/** Whether `t` is a list (or a nested list) whose elements are integers. A
 * transparent alias is unfolded at each level. A recursive alias
 * (`R = list<R>`) would unfold without end, so the walk stops after
 * `MAX_LIST_DEPTH` levels and answers `false`, which declines the input. */
const MAX_LIST_DEPTH = 64;
function isListOfIntegers(t: Type, depth = 0): boolean {
  if (depth > MAX_LIST_DEPTH) return false;
  t = resolveTypeAlias(t);
  if (t === 'never') return false;
  if (isSubtype(t, LIST_OF_INTEGERS)) return true;
  if (typeof t !== 'object' || t.kind !== 'list') return false;
  return isListOfIntegers(t.elements, depth + 1);
}

/** Whether `node` is a number literal held as an inexact big decimal whose
 * value is an integer, such as `ce.box(1e20)` or `ce.box(2 ** 53)` (a
 * JavaScript number past the safe integer range). Such a literal is not on
 * the lane: the interpreter computes with it at its working precision, so
 * `Power(2^53, n)` is rounded for a large `n`, while bigint code would give
 * the exact power. The same value written as an exact integer (a string of
 * digits, or a LaTeX literal) is an exact rational and is on the lane. */
function isInexactDecimalInteger(node: Expression): boolean {
  if (!isNumber(node)) return false;
  const v = node.numericValue;
  return (
    v instanceof BigNumericValue &&
    !v.isComplex &&
    v.decimal.isFinite() &&
    v.decimal.isInteger()
  );
}

/** The exact value of a number literal, as `p/q` with `q > 0`, or
 * `undefined` for a value that is not an exact rational (a double that is
 * not an integer, an inexact big decimal, a radical, a complex or
 * non-finite value). */
export function exactRational(
  node: Expression
): { p: bigint; q: bigint } | undefined {
  if (!isNumber(node)) return undefined;
  const v = node.numericValue;
  if (typeof v === 'number')
    return Number.isInteger(v) ? { p: BigInt(v), q: 1n } : undefined;
  if (v === undefined || v.isComplex) return undefined;
  if (v instanceof BigNumericValue) return undefined;
  const exact = v.asExact;
  if (!(exact instanceof ExactNumericValue) || exact.radical !== 1)
    return undefined;
  let p = BigInt(exact.rational[0]);
  let q = BigInt(exact.rational[1]);
  if (q === 0n) return undefined;
  if (q < 0n) {
    p = -p;
    q = -q;
  }
  return { p, q };
}

/**
 * Whether the assigned value `value` of a symbol is an exact constant that
 * a fold can read: an exact rational number, `True`, `False`, or a list of
 * them. With `integerOnly`, the numbers must be integers. The stored value
 * is read as it is, not evaluated: a value with a free variable
 * (`Floor(Sin(x))`) or any other expression is not an exact constant.
 */
function exactConstantValue(value: Expression, integerOnly = false): boolean {
  if (isNumber(value)) {
    const r = exactRational(value);
    return r !== undefined && (!integerOnly || r.q === 1n);
  }
  if (isSymbol(value))
    return (
      !integerOnly && (value.symbol === 'True' || value.symbol === 'False')
    );
  if (isFunction(value, 'List'))
    return value.ops.every((op) => exactConstantValue(op, integerOnly));
  return false;
}

/** Whether the collection `coll` is known to have an element: a `List`
 * literal with an operand, or a `Range` of integer literals that is not
 * empty. */
function isNonEmptyCollection(coll: Expression): boolean {
  if (isFunction(coll, 'List')) return coll.nops > 0;
  if (!isFunction(coll, 'Range') || coll.nops === 0) return false;
  const bounds = coll.ops.map((op) => exactRational(op));
  if (bounds.some((b) => b === undefined || b.q !== 1n)) return false;
  // `Range(b)` is `1..b`, `Range(a, b)` is `a..b` with step 1.
  const [lo, hi, step] =
    bounds.length === 1
      ? [1n, bounds[0]!.p, 1n]
      : [bounds[0]!.p, bounds[1]!.p, bounds[2]?.p ?? 1n];
  if (step > 0n) return lo <= hi;
  if (step < 0n) return lo >= hi;
  return false;
}

/** A numeric subtree with no free variable, which `evaluate()` reduces to
 * a number. A symbol with an assigned value (`h := 7/2`) is such a
 * subtree: its `unknowns` is empty. The caller still tests that the name
 * is not bound by an enclosing construct and has no `vars` entry
 * (`LaneAnalyzer.foldable`). */
function isConstantNumeric(node: Expression): boolean {
  if (isNumber(node)) return true;
  return (
    (isFunction(node) || isSymbol(node)) &&
    node.unknowns.length === 0 &&
    node.isPure &&
    isSubtype(node.type.type, 'number')
  );
}

function isNonZeroLiteral(node: Expression): boolean {
  const r = exactRational(node);
  return r !== undefined && r.p !== 0n;
}

/** Whether the lane value `node` of type `t` can be zero: not when it is a
 * non-zero literal, a power of a non-zero literal (`2^n`), or of a type
 * that excludes zero. */
function canBeZero(node: Expression, t: Type): boolean {
  if (isNumber(node)) return !isNonZeroLiteral(node);
  if (isFunction(node, 'Power') && isNonZeroLiteral(node.op1)) return false;
  if (
    t !== 'never' &&
    (isSubtype(t, POSITIVE_INTEGER) || isSubtype(t, NEGATIVE_INTEGER))
  )
    return false;
  return true;
}
