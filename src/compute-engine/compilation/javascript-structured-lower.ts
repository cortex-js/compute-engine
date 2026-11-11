/**
 * The lowering of a prepared program of the internal scalar JavaScript
 * fragment target to the structured representation
 * (`structured-ir.ts`), verified with the policy of JavaScript
 * (`javascript-structured-policy.ts`).
 *
 * The lowering reads the prepared tree and the facts that the preparation
 * recorded: the annotation of `typeFragment()` (types, representations,
 * conversions, bindings), the inputs, and an effect fact per prepared node
 * (`StructuredPreparation`). It reads nothing else about an expression: no
 * type of the engine, no evaluation, no lookup of a symbol in the engine and
 * no compilation. A missing fact throws.
 *
 * It follows the prepared tree: the operands of a node are lowered in their
 * order. A function node that is reached again (the same node object, a
 * DAG), in the same scope, is the value of its first lowering when all of
 * these hold (`value()`): the second occurrence is in the region of the
 * first lowering or in a region nested in it and opened after it; no local
 * or parameter changed its value in between (`epoch`); and every operation
 * of the first lowering is `pure` and cannot abort. Otherwise the node is
 * lowered again. No operation moves: a value is shared only where its first
 * evaluation has run on every path. A conversion that the annotation
 * records for an operand is an operation that follows the operand, in the
 * region where the operand is evaluated, once per use. A local with one
 * assignment is the value of its initializer, which is evaluated where it is
 * declared; each read of the local is that value.
 *
 * A read of a binding that the admission captured is a capture read
 * (`IRCaptureRead`) of its snapshot. A helper is lowered once, at its first
 * call, as a function of the program; a call of a helper in the body of
 * another helper lowers the called helper first.
 *
 * A write to a local (`Assign`) makes a new value, and each later read on
 * its path is that value: no operation writes a named variable. An `If`
 * statement whose branches write locals has one result per local that a
 * branch writes and that a later statement reads: the merged value. A
 * branch that does not write the local yields its value before the `If`.
 * A local that no later statement reads is not merged; a read of it after
 * the `If` throws. An `If` statement with no merged value and no effect is
 * not lowered.
 *
 * A `Loop` over `Element(k, Range(a, b))` is a `loop` whose bounds are
 * evaluated once, before it. A local declared outside the loop and written
 * in its body is a carried value when a later statement reads it, or when
 * the body reads it before it writes it in the same iteration; its
 * parameter in the body is its value at the start of an iteration, and the
 * result of the loop is its value after the loop. A local written in the
 * body that is not carried has no value at the start of an iteration and
 * after the loop: a read of it there throws. A local declared in the body
 * is a value of the body region.
 *
 * A `Break` with no value, the last statement of a branch of an `If`
 * statement in the body of a `Loop`, is an `exit` of the innermost loop
 * whose operands are the current values of the carried locals of that
 * loop: after the loop, each local has the value that it had at the
 * `Break`. A branch that ends in `Break` is closed: the results of its `If`
 * are the values of the other branch.
 *
 * A list input or a list parameter of a helper is a value of a list type;
 * `At` and `Length` of it are the operations `at` and `length`.
 * `Comprehension` over a range is a `build`, `ReplaceAt` a `replace-at`. A
 * list can be the value of a local, a carried value, the value of an `If`,
 * of a helper and of the program; a list of integers and a list of reals
 * merge to a list of reals, as an integer and a real merge to a real. The
 * admission keeps a list out of every arithmetic operand.
 *
 * A `Which`, and an `If` with no else branch used as a value, is a chain of
 * `if` operations (`selection()`). A `Sum` or a `Product` over `Limits`
 * clauses is the code of the existing emitter in operations of the
 * representation (`aggregate()`): a literal, the terms with no loop, or a
 * `loop` whose one carried value is the accumulator, in a guard of `if`
 * operations when a bound is not constant.
 *
 * `Random()` and `Random` of a literal domain are a `draw` and the
 * arithmetic of the existing emitter around it (`draw()`); `WithRandomSeed`
 * is a `seeded` region (`seeded()`). Each draw is an operation where its
 * node is lowered, so the draws keep the order and the count of the
 * prepared tree, and a draw in a branch, in an operand of `And` or `Or`, in
 * a term of a `Sum` or in a loop body runs only when that region runs. An
 * operation that evaluates a region, and a call, name the states of their
 * regions and of the body of the function (`IROperation.touches`).
 *
 * A node whose head is a `call` binding of the host (a `functions` or
 * `operators` entry) is a host operation of its operands, and a read of a
 * free symbol that is a `read` binding of the host (a `vars` source that is
 * not the read of an input) is a host operation with no operand
 * (`IRHostCall`, `StructuredPreparation.hosts`). Each is lowered where its
 * node is, once per occurrence, and is never shared.
 */
import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { declareValueOperand } from './compile-declarations.js';
import { exactRationalDivisor } from './compiler-type-facts.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { interval } from '../numerics/interval.js';
import { rangeCount } from '../numerics/range-count.js';
import type {
  FragmentAnnotation,
  FragmentConversion,
  FragmentScope,
  FragmentValueFacts,
} from './fragment.js';
import { nodeText } from './fragment.js';
import type { ScalarRepresentation } from './javascript-fragment-facts.js';
import {
  dischargedEffect,
  exitsIn,
  joinEffects,
  operationCanAbort,
  reachesHost,
  regionsOf,
  touchesField,
  type EffectFact,
  type IRCapture,
  type IRFunction,
  type IRHostBinding,
  type IRInput,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRState,
  type IRValue,
  type ScalarKind,
  type ValueType,
  type BinaryFunctionName,
  type UnaryFunctionName,
} from './structured-ir.js';
import { verifyJavaScriptProgram } from './javascript-structured-policy.js';
import { isShadowedSymbol } from '../library-shadowing.js';
import { unrollFits, unrolledTermSize } from './unroll-budget.js';
import { UNROLL_LIMIT } from './javascript-target.js';

export type StructuredInput = IRInput;

/**
 * The form of a `Power`, `Abs`, `Conjugate` or `Log` node, or of a `Sin`,
 * `Cos` or `Tan` node of a multiple of `Pi`, that the rule of its head admitted
 * (`javascript-fragment-target.ts`), recorded during the annotation:
 *
 * - `square`, `exp`, `three-halves`: the forms of `powerForm()`.
 * - `pow`, `abs-pow`, `signed-pow`: `Power` written as the function of two
 *   operands of that name (`BinaryFunctionName`): `pow` for an exponent
 *   that is not a number literal (the form `variable` of `powerForm()`),
 *   `abs-pow` and `signed-pow` for a float literal exponent (the form
 *   `float`), which the rule of `Power` chooses from the exponent.
 * - `real-pow`: `Power` with a constant exponent, written as the function
 *   `real-pow` of the base and the exponent.
 * - `product-power`: `Power` with the integer exponent 3, 4 or 5, the
 *   products of the base that `_SYS.pow3` to `_SYS.pow5` compute:
 *   `(b·b)·b`, `s·s` and `(s·s)·b` with `s = b·b`.
 * - `reciprocal-square`: `Power` with the exponent -2, the two divisions
 *   `(1 / b) / b`.
 * - `complex-chain`: `Power` of a complex base with an integer exponent `k`
 *   from 3 to 8, the chain of complex products of the existing emitter:
 *   `b^k` is the square of `b^(k/2)` for an even `k`, the product of
 *   `b^(k-1)` and `b` for an odd `k`.
 * - `complex-pow`: `Power` of a complex base with another number literal
 *   exponent, the function `pow` of the base and the converted exponent.
 * - `cbrt`, `root`: `Root` written as the function of that name, `cbrt` of
 *   the radicand for the degree 3, `root` of the radicand and the degree
 *   for a degree that is not a number literal.
 * - `abs`: `Abs` written as the function `abs`.
 * - `abs-identity`: `Abs` of a real operand that the existing emitter proves
 *   non-negative, written as the operand itself, as that emitter writes it
 *   (`identityPassthrough()`): `-0` stays `-0`.
 * - `pi-multiple`: `Sin`, `Cos` or `Tan` of `Multiply(Pi, u)`
 *   (`piMultipleFactor()`), the function `sinpi`, `cospi` or `tanpi` of `u`,
 *   as the existing emitter writes it (`piMultiple()`).
 * - `identity`: `Conjugate` of a real operand, written as the operand
 *   itself, as the existing emitter writes it (`identityPassthrough()`).
 * - `conjugate`: `Conjugate` of a complex operand, the function `conjugate`
 *   of the operand (`_SYS.cconj(z)` on the existing emitter).
 * - `log10`, `log2`: `Log` with no base or with the base 10 or 2, the
 *   function of that name of the first operand; `log-quotient`: `Log(x, b)`
 *   with another base, the quotient `ln(x) / ln(b)`, as the existing emitter
 *   writes them.
 * - `{ folded }`: `Power` or `Root` of two finite real number literals,
 *   which the existing emitter folds to the literal of its value
 *   (`foldedLiteralPower()`, `foldedLiteralRoot()` in
 *   `javascript-fragment-target.ts`): the value is written as a literal, and
 *   the operands have no operation.
 */
export type StructuredForm =
  | { readonly folded: number | { readonly re: number; readonly im: number } }
  | 'pi-multiple'
  | 'identity'
  | 'conjugate'
  | 'log10'
  | 'log2'
  | 'log-quotient'
  | 'square'
  | 'exp'
  | 'three-halves'
  | 'pow'
  | 'abs-pow'
  | 'signed-pow'
  | 'real-pow'
  | 'product-power'
  | 'reciprocal-square'
  | 'complex-chain'
  | 'complex-pow'
  | 'cbrt'
  | 'root'
  | 'abs'
  | 'abs-identity';

/**
 * A binding of the engine that the program reads and does not bind, with
 * the value that the admission found in it (a finite real number). The
 * compiled code holds that value: a later change of the binding does not
 * change the code.
 */
export type StructuredCapture = {
  /** The identity of the binding: the value definition of the engine. */
  readonly binding: object;
  readonly name: string;
  /** The symbol nodes of the prepared tree that read the binding. */
  readonly symbols: ReadonlySet<Expression>;
  /** The value of the binding at the admission. */
  readonly value: number;
  /** Throw when the binding or its value changed after the admission. */
  readonly assertCurrent: () => void;
};

/** The facts that the preparation of the structured route records, and
 *  that the lowering reads. */
export type StructuredPreparation = {
  /** The prepared root: the body of the root function, or the expression. */
  readonly root: Expression;
  /** The root `Function` literal whose body is `root`, if any. */
  readonly functionRoot?: Expression;
  readonly annotation: FragmentAnnotation<ScalarRepresentation>;
  /** The resolved helpers, by name. The key of each in
   *  `annotation.functions` is its name. A helper can call another one;
   *  the admission refuses recursion. */
  readonly helpers: ReadonlyMap<
    string,
    {
      readonly name: string;
      readonly body: Expression;
      /** `IRFunction.parameterElementLabels`. */
      readonly parameterElementLabels?: readonly (string | undefined)[];
    }
  >;
  /** The bindings that the program reads as snapshots, in the order of
   *  their admission. */
  readonly captures: readonly StructuredCapture[];
  /** The parameters of the root function in order, or the free symbols of
   *  the expression in the order of their first read. */
  readonly inputs: readonly StructuredInput[];
  /** The names of the inputs with no declared type, which took the default
   *  kind of the mode, in the order of `inputs`
   *  (`CompilationResult.defaultedSymbols`). The lowering does not read it. */
  readonly defaulted?: readonly string[];
  /** The effect fact of each prepared node that the annotation types. */
  readonly effects: ReadonlyMap<Expression, EffectFact>;
  /** The states that each prepared node of the effect `effectful` touches
   *  itself (`IRState`): the impurity labels of its definition, `random` for
   *  `Random`. A node that is absent touches none. */
  readonly states?: ReadonlyMap<Expression, readonly IRState[]>;
  /** For tests only: the heads that lower to the trace operation, with the
   *  trace id of each. */
  readonly testOperations: ReadonlyMap<string, string>;
  /** The form that the rule of its head chose for each `Power`, `Abs`,
   *  `Conjugate` and `Log` node, and for each `Sin`, `Cos` and `Tan` node of
   *  a multiple of `Pi` (`StructuredForm`). The lowering reads it, and no
   *  fact of the engine; a node of the first four heads with no form is an
   *  error. */
  readonly forms: ReadonlyMap<Expression, StructuredForm>;
  readonly numericPolicy: 'strict' | 'complex';
  /** The iteration budget of the compilation (`CompileTarget.iterationBudget`),
   *  recorded on each `loop`. */
  readonly iterationBudget?: number;
  /** The bindings of the host that the program reads or calls
   *  (`IRProgram.hosts`). A `read` binding is a free symbol of its name,
   *  which the annotation binds in the root scope and which is not an input;
   *  a `call` binding is a head: each node of that head is a host
   *  operation. */
  readonly hosts?: readonly IRHostBinding[];
};

const PREPARATIONS = new WeakMap<
  CompileTarget<Expression>,
  StructuredPreparation
>();

/** Record the preparation of the structured route on its prepared target. */
export function recordStructuredPreparation(
  target: CompileTarget<Expression>,
  preparation: StructuredPreparation
): void {
  PREPARATIONS.set(target, preparation);
}

/** The preparation recorded on `target`. Throws when there is none. */
export function structuredPreparationOf(
  target: CompileTarget<Expression>
): StructuredPreparation {
  const preparation = PREPARATIONS.get(target);
  if (preparation === undefined)
    throw new Error(
      'JS structured lowering: the target holds no structured preparation'
    );
  return preparation;
}

const fail = (message: string): never => {
  throw new Error(`JS structured lowering: ${message}`);
};

/** The operations of the operators that map one to one. */
const OPERATIONS: Readonly<
  Record<
    string,
    | 'add'
    | 'negate'
    | 'multiply'
    | 'less'
    | 'less-equal'
    | 'equal'
    | 'not-equal'
    | 'min'
    | 'max'
    | 'sqrt'
    | 'mod'
    | 'floor'
    | 'divide'
    | 'at'
    | 'length'
    | 'not'
    | 'replace-at'
  >
> = {
  // The rule of `Sqrt` (`javascript-fragment-target.ts`) records the
  // conversion of a real operand of a complex square root.
  Sqrt: 'sqrt',
  Add: 'add',
  Negate: 'negate',
  Multiply: 'multiply',
  Less: 'less',
  LessEqual: 'less-equal',
  Equal: 'equal',
  NotEqual: 'not-equal',
  Min: 'min',
  Max: 'max',
  Mod: 'mod',
  Floor: 'floor',
  Divide: 'divide',
  // The rules of `At` and `Length` (`javascript-fragment-target.ts`) admit
  // a list input or parameter and, for `At`, one integer index.
  At: 'at',
  Length: 'length',
  Not: 'not',
  // The rule of `ReplaceAt` admits a list, an integer index and a real or
  // integer element.
  ReplaceAt: 'replace-at',
};

/** The functions of one or two operands, by the head of the library that
 *  applies them. `Exp(x)` has no head of its own: the canonical form
 *  writes it `Power(ExponentialE, x)` (`powerForm()`). */
const FUNCTIONS: Readonly<
  Record<
    string,
    | { readonly kind: 'unary'; readonly fn: UnaryFunctionName }
    | { readonly kind: 'binary'; readonly fn: BinaryFunctionName }
  >
> = {
  Ln: { kind: 'unary', fn: 'ln' },
  Sin: { kind: 'unary', fn: 'sin' },
  Cos: { kind: 'unary', fn: 'cos' },
  Tanh: { kind: 'unary', fn: 'tanh' },
  Abs: { kind: 'unary', fn: 'abs' },
  Arctan2: { kind: 'binary', fn: 'atan2' },
  Tan: { kind: 'unary', fn: 'tan' },
  Cot: { kind: 'unary', fn: 'cot' },
  Sec: { kind: 'unary', fn: 'sec' },
  Csc: { kind: 'unary', fn: 'csc' },
  Sinh: { kind: 'unary', fn: 'sinh' },
  Cosh: { kind: 'unary', fn: 'cosh' },
  Arctan: { kind: 'unary', fn: 'atan' },
  Arsinh: { kind: 'unary', fn: 'asinh' },
  Gamma: { kind: 'unary', fn: 'gamma' },
  Sign: { kind: 'unary', fn: 'sign' },
  Arcsin: { kind: 'unary', fn: 'asin' },
  Arccos: { kind: 'unary', fn: 'acos' },
  Arcosh: { kind: 'unary', fn: 'acosh' },
  Artanh: { kind: 'unary', fn: 'atanh' },
  Erf: { kind: 'unary', fn: 'erf' },
  Erfc: { kind: 'unary', fn: 'erfc' },
  Digamma: { kind: 'unary', fn: 'digamma' },
  Haversine: { kind: 'unary', fn: 'haversine' },
  Ceil: { kind: 'unary', fn: 'ceil' },
  // The rule of `Round` admits it only for `ce.roundingTies`
  // `'away-from-zero'`.
  Round: { kind: 'unary', fn: 'round-ties-away' },
};

/** The function of `u` for `Sin`, `Cos` and `Tan` of `Multiply(Pi, u)`
 *  (the form `pi-multiple`). */
const PI_MULTIPLE_FUNCTIONS: Readonly<Record<string, UnaryFunctionName>> = {
  Sin: 'sinpi',
  Cos: 'cospi',
  Tan: 'tanpi',
};

/**
 * The factor `u` of the operand `Multiply(Pi, u)` of `Sin`, `Cos` or
 * `Tan`, or `undefined`: a product of two operands, one of them the
 * constant `Pi` of the library (not a symbol of that name that a scope
 * declares), the other one an expression that does not read `Pi`. The
 * existing emitter writes `Sin(π·u)` as `_SYS.sinpi(u)` with the code of
 * that same operand (`piMultiple()` in `compile-real-analysis.ts`, which
 * also reads a product of more factors, a quotient and a negation; it builds
 * a new node for those, and the structured route does not admit them). The
 * rule of the head and the lowering read the factor from this function, so
 * they agree.
 */
export function piMultipleFactor(operand: Expression): Expression | undefined {
  if (!isFunction(operand, 'Multiply') || operand.nops !== 2) return undefined;
  const index = operand.ops.findIndex((op) => isSymbol(op, 'Pi'));
  const pi = operand.ops[index];
  if (!isSymbol(pi) || isShadowedSymbol(pi)) return undefined;
  const u = operand.ops[1 - index];
  return u.symbols.includes('Pi') ? undefined : u;
}

/**
 * The form of the `Power` node `node` that the structured route admits, or
 * `undefined`:
 *
 * - `square`: the literal exponent 2, the product of the base with itself.
 * - `exp`: the base is the constant `ExponentialE` of the library (not a
 *   symbol of that name that a scope declares), the exponential of the
 *   exponent. The canonical form writes `Exp(x)` so.
 * - `three-halves`: the literal exponent `1.5` or `3/2`, the product of the
 *   base and its square root, the base evaluated once. The rule of `Power`
 *   admits it only for a base that it proves non-negative.
 * - `variable`: an exponent that is not a number literal, the function
 *   `pow` of the base and the exponent.
 * - `float`: a real number literal exponent that is not exact, finite and
 *   not an integer (`1.6`, not `8/5`), the function `abs-pow` or
 *   `signed-pow` of the base and the exponent, or one of the forms of a
 *   constant exponent below.
 * - `integer`: a real number literal exponent whose value is an integer
 *   other than 2 (`3`, `-2`, also the float `3.0`).
 * - `rational`: an exact real number literal exponent whose value is not an
 *   integer (`5/2`).
 *
 * The rule of `Power` chooses the code of the forms `float`, `integer` and
 * `rational`, and of `three-halves` for a base that it does not prove
 * non-negative, by the branches of the existing emitter: the function
 * `real-pow`, the products of `product-power`, the divisions of
 * `reciprocal-square` (`StructuredForm`).
 *
 * The rule of `Power` (`javascript-fragment-target.ts`) and the lowering
 * read the form from this function, so they agree.
 */
export function powerForm(
  node: Expression
):
  | 'square'
  | 'exp'
  | 'three-halves'
  | 'variable'
  | 'float'
  | 'integer'
  | 'rational'
  | undefined {
  if (!isFunction(node, 'Power') || node.nops !== 2) return undefined;
  const [base, exponent] = node.ops;
  if (isSymbol(base, 'ExponentialE') && !isShadowedSymbol(base)) return 'exp';
  if (!isNumber(exponent)) return 'variable';
  if (exponent.im !== 0) return undefined;
  if (exponent.re === 2) return 'square';
  if (exponent.re === 1.5) return 'three-halves';
  if (
    !exponent.isExact &&
    Number.isFinite(exponent.re) &&
    !Number.isInteger(exponent.re)
  )
    return 'float';
  if (Number.isInteger(exponent.re)) return 'integer';
  if (exponent.isExact && Number.isFinite(exponent.re)) return 'rational';
  return undefined;
}

function scalarKind(type: { readonly kind: string }): ScalarKind {
  if (
    type.kind === 'real' ||
    type.kind === 'integer' ||
    type.kind === 'boolean' ||
    type.kind === 'complex'
  )
    return type.kind;
  return fail(`the type ${type.kind} is not a scalar type`);
}

/** The type of a value: a scalar type, or a list of reals or of integers,
 *  whatever its length. */
function valueType(type: {
  readonly kind: string;
  readonly element?: { readonly kind: string };
}): ValueType {
  if (type.kind !== 'list') return scalarKind(type);
  const element =
    type.element === undefined ? undefined : scalarKind(type.element);
  if (element !== 'real' && element !== 'integer')
    return fail(
      `the list type of elements ${type.element?.kind} is not in the structured route`
    );
  return `list<${element}>`;
}

/** Lower and verify the program that `preparation` describes. */
export function lowerStructuredFragment(
  preparation: StructuredPreparation
): IRProgram {
  const program = lowerStructuredProgram(preparation);
  verifyJavaScriptProgram(program, preparedNodesOf(preparation));
  return program;
}

/**
 * The most values that the lowering of one program makes: about one per
 * operation (an operation of one result makes one, an `if` or a `loop` one
 * per result, a parameter of a region one). A node reached on several paths
 * that is not shared (a node in both branches of an `If`, in a DAG of `If`
 * nodes) is lowered once per path, so the program can be exponential in the
 * size of the expression; past this limit the lowering throws a
 * `StructuredLimitError`, which the profile declines with
 * `'outside-profile'`.
 */
export const STRUCTURED_OPERATION_LIMIT = 100_000;

/** The error of a lowering over `STRUCTURED_OPERATION_LIMIT`. */
export class StructuredLimitError extends Error {
  constructor() {
    super(
      `JS structured lowering: the program has more than ` +
        `${STRUCTURED_OPERATION_LIMIT} operations`
    );
    this.name = 'StructuredLimitError';
  }
}

/** Lower the program that `preparation` describes, without verifying it:
 *  the caller verifies it (`lowerStructuredFragment()` does both). */
export function lowerStructuredProgram(
  preparation: StructuredPreparation
): IRProgram {
  return new Lowering(preparation).program();
}

/** The nodes that the annotation of `preparation` types, in its root
 *  scope, a nested scope or a function: the origin of each operation must
 *  be one of them. */
export function preparedNodesOf(
  preparation: StructuredPreparation
): Set<Expression> {
  const preparedNodes = new Set<Expression>();
  collectOrigins(preparation.annotation.scope, preparedNodes);
  for (const fn of preparation.annotation.functions.values())
    collectOrigins(fn.scope, preparedNodes);
  return preparedNodes;
}

class Lowering {
  private readonly owner = {};
  private readonly revision = 1;
  private nextId = 0;
  private readonly functions: IRFunction[] = [];
  private readonly functionIndex = new Map<string, number>();
  /** The helpers whose body is being lowered. */
  private readonly lowering = new Set<string>();
  private readonly captures: IRCapture[] = [];
  /** The index of each capture in `captures`, by its binding. */
  private readonly captureIndex = new Map<object, number>();
  /** The carried locals of each loop whose body is being lowered, the
   *  innermost last, and the operands of each `exit` of that loop: a
   *  `Break` reads the current value of each carried local. */
  private loops: {
    readonly carried: readonly {
      readonly binder: FragmentScope<ScalarRepresentation>;
      readonly name: string;
    }[];
    readonly exits: (readonly IRValue[])[];
  }[] = [];
  /** The value of each local and parameter, by the scope that binds it. */
  private readonly bound = new Map<
    FragmentScope<ScalarRepresentation>,
    Map<string, IRValue>
  >();
  /** The number of the current values of `bound` (`changed()`): a value
   *  that `value()` remembers is valid while the number is the one of its
   *  lowering. */
  private epoch = 0;
  /** The last number given to `epoch`: each number is given once. */
  private epochs = 0;
  /** The open `inScope()` calls, the innermost last: the scope of each, and
   *  whether a value of a scope outside it was written (`wrote()`). */
  private scopes: {
    readonly inner: FragmentScope<ScalarRepresentation>;
    outside: boolean;
  }[] = [];
  /** The regions open at this point of the lowering, the innermost last
   *  (`inRegion()`), each with the values that `value()` remembers in it:
   *  by node, then by the scope of the node. A helper body starts with its
   *  own region alone. */
  private regions: {
    readonly operations: IROperation[];
    readonly values: Map<
      Expression,
      Map<
        FragmentScope<ScalarRepresentation>,
        { readonly value: IRValue; readonly epoch: number }
      >
    >;
  }[] = [];
  /** The names of each function node (`namesIn()`). */
  private readonly names = new Map<Expression, ReadonlySet<string>>();
  /** The ids of the values that a `Declare` or an `Assign` writes to a
   *  local (`toLocal()`, `IRProgram.localValues`). */
  private readonly localValues = new Set<number>();

  constructor(private readonly prep: StructuredPreparation) {}

  program(): IRProgram {
    const { annotation, root } = this.prep;
    if (annotation.root !== root)
      fail('the annotation is not the annotation of the prepared root');
    const operations: IROperation[] = [];
    const value = this.inRegion(operations, () =>
      this.value(root, annotation.scope, operations)
    );
    return {
      owner: this.owner,
      revision: this.revision,
      inputs: this.prep.inputs,
      numericPolicy: this.prep.numericPolicy,
      captures: this.captures,
      functions: this.functions,
      ...(this.prep.hosts !== undefined && this.prep.hosts.length > 0
        ? { hosts: this.prep.hosts }
        : {}),
      root: this.region(operations, root, value),
      ...(this.localValues.size > 0 ? { localValues: this.localValues } : {}),
    };
  }

  private newValue(type: ValueType, representation: ScalarRepresentation) {
    if (this.nextId >= STRUCTURED_OPERATION_LIMIT)
      throw new StructuredLimitError();
    return {
      owner: this.owner,
      revision: this.revision,
      id: this.nextId++,
      type,
      representation,
    };
  }

  private resultOf(facts: FragmentValueFacts<ScalarRepresentation>): IRValue {
    return this.newValue(valueType(facts.type), facts.representation);
  }

  /**
   * The folded value `value` of the `Power` or `Root` `node` of two number
   * literals (the form `{ folded }`): a real literal, or the function
   * `complex` of the literals of the two parts. A complex value is not a
   * complex literal: the existing emitter writes the folded object, and a
   * parent reads its parts from it (`x + (-8)^(3/2)` is `x + 0` in the real
   * part, `+0` at `x = -0`), where it writes the constants of a literal and
   * drops a part that is `0`.
   */
  private folded(
    node: Expression,
    value: number | { readonly re: number; readonly im: number },
    facts: FragmentValueFacts<ScalarRepresentation>,
    effect: EffectFact,
    operations: IROperation[]
  ): IRValue {
    const literal = (v: number, result: IRValue): IRValue => {
      operations.push({
        kind: 'literal',
        value: v,
        result,
        operands: [],
        effect,
        origin: node,
      });
      return result;
    };
    const result = this.resultOf(facts);
    if (typeof value === 'number') return literal(value, result);
    const parts = [
      literal(value.re, this.newValue('real', 'number')),
      literal(value.im, this.newValue('real', 'number')),
    ];
    operations.push({
      kind: 'binary',
      fn: 'complex',
      result,
      operands: parts,
      effect,
      origin: node,
    });
    return result;
  }

  /** End `operations` with the yield of `value` (of each value of an
   *  array) and summarize its effects. */
  private region(
    operations: IROperation[],
    origin: Expression,
    value: IRValue | readonly IRValue[]
  ): IRRegion {
    const operands = Array.isArray(value) ? value : [value as IRValue];
    operations.push({ kind: 'yield', operands, effect: 'pure', origin });
    return this.closedRegion(operations);
  }

  /** Summarize the effects of `operations`, which end in an `exit` or an
   *  `if` whose two branches are closed, or in a yield (`region()`). */
  private closedRegion(operations: IROperation[]): IRRegion {
    const canAbort = operations.some((op) =>
      operationCanAbort(op, this.functions)
    );
    // A loop, not a spread: a region can hold more operations than a call
    // takes arguments.
    let effect: EffectFact = 'pure';
    const states = new Set<IRState>();
    for (const op of operations) {
      effect = joinEffects(effect, op.effect);
      for (const s of op.touches ?? []) states.add(s);
    }
    return {
      operations,
      effect,
      ...touchesField([...states]),
      ...(canAbort ? { canAbort: true as const } : {}),
    };
  }

  /** Run `step`, which lowers into `operations`, with `operations` the
   *  innermost open region (`regions`). */
  private inRegion<T>(operations: IROperation[], step: () => T): T {
    this.regions.push({ operations, values: new Map() });
    try {
      return step();
    } finally {
      this.regions.pop();
    }
  }

  /** A change of the values of `bound`: a new number for `epoch`. */
  private changed(): void {
    this.epoch = ++this.epochs;
  }

  /**
   * After an operation with the effect `unknown` (a read or a call of the
   * host that is not declared pure, or a call of a helper whose body has
   * one): the host can change the vars object, so no value remembered
   * before it is valid after it. A new epoch, and a write outside every
   * open `inScope()`, so that none brings an older epoch back across it.
   * A draw changes only the random stream, which no remembered value
   * reads.
   */
  private afterUnknown(effect: EffectFact): void {
    if (effect !== 'unknown') return;
    this.changed();
    for (const frame of this.scopes) frame.outside = true;
  }

  /**
   * Note a write to a value of the scope `scope`: in each open `inScope()`
   * whose scope is not `scope` nor around it, the write is outside. Each
   * place that sets or deletes a value of `bound` calls it, except
   * `restore()`: a snapshot that `restore()` brings back was taken by the
   * same `ifStatement()` or `loopStatement()`, so in an `inScope()` open
   * around that statement it holds the values of the start of the
   * `inScope()` for every scope that no noted write changed.
   */
  private wrote(scope: FragmentScope<ScalarRepresentation>): void {
    for (const frame of this.scopes) {
      if (frame.outside) continue;
      let within = false;
      for (let t: typeof scope | undefined = scope; t; t = t.parent)
        if (t === frame.inner) {
          within = true;
          break;
        }
      if (!within) frame.outside = true;
    }
  }

  /**
   * Run `step`, which binds names of the scope `inner` (the index of a
   * `build` or of an aggregate, the parameters of a helper). When `step`
   * wrote no value of a scope outside `inner` (a scope that is neither
   * `inner` nor nested in it, `wrote()`), the epoch after `step` is the one
   * before it: a node outside `inner` reads no name of `inner`, so the
   * values remembered before `step` are still valid. A value remembered
   * during `step`, in a region around it, has an epoch that is never
   * current again, since each number is given once. Otherwise the epoch is
   * the last change of `step`. The values of `inner` are removed after
   * `step`: no node outside `inner` reads them, and a new lowering of the
   * same node binds them again (the written-out terms of an aggregate leave
   * the index bound to the last literal).
   */
  private inScope<T>(
    inner: FragmentScope<ScalarRepresentation> | undefined,
    step: () => T
  ): T {
    if (inner === undefined) return step();
    const frame = { inner, outside: false };
    const epoch = this.epoch;
    this.scopes.push(frame);
    let result: T;
    try {
      result = step();
    } finally {
      this.scopes.pop();
    }
    this.bound.delete(inner);
    // A write outside `inner` was noted in each `inScope()` around this one
    // whose scope does not hold the written scope.
    if (!frame.outside) this.epoch = epoch;
    return result;
  }

  /** The names of the symbols of `node`, read or written (`namesIn()`),
   *  once per node object. */
  private namesOf(node: Expression): ReadonlySet<string> {
    return namesIn(node, this.names);
  }

  private facts(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>
  ): FragmentValueFacts<ScalarRepresentation> {
    const facts = scope.facts.get(node);
    if (facts === undefined || !('representation' in facts))
      return fail(`no value facts for ${nodeText(node)}`);
    return facts;
  }

  private effect(node: Expression): EffectFact {
    const effect = this.prep.effects.get(node);
    if (effect === undefined)
      return fail(`no effect fact for ${nodeText(node)}`);
    return effect;
  }

  /** The states that `node` touches itself (`StructuredPreparation.states`). */
  private states(node: Expression): readonly IRState[] | undefined {
    return this.prep.states?.get(node);
  }

  /**
   * Apply the conversion that the facts of `node` record for an operand
   * whose value is `value`. A conversion that changes the representation is
   * an operation that follows the operand in `operations`.
   */
  private convert(
    value: IRValue,
    conversion: FragmentConversion<ScalarRepresentation> | undefined,
    node: Expression,
    operations: IROperation[]
  ): IRValue {
    if (conversion === undefined)
      return fail(`no conversion fact for an operand of ${nodeText(node)}`);
    if (conversion.kind === 'none') {
      if (conversion.representation !== value.representation)
        fail(
          `an identity conversion of ${nodeText(node)} changes the representation`
        );
      return value;
    }
    if (conversion.kind !== 'real-to-complex')
      return fail(
        `the conversion ${conversion.kind} is not in the structured route`
      );
    const result = this.newValue('complex', 'complex');
    operations.push({
      kind: 'convert',
      conversion: 'real-to-complex',
      result,
      operands: [value],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /** The operands of `node` in order, each with its conversion. */
  private operands(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue[] {
    return node.ops.map((operand, i) =>
      this.convert(
        this.value(operand, scope, operations),
        facts.conversions?.[i],
        node,
        operations
      )
    );
  }

  /**
   * The value of `node`, typed in `scope`, at the end of `operations`, the
   * innermost open region: the value that an earlier lowering of the same
   * function node in the same scope gave, in this region or in a region
   * around it, when no local or parameter changed since; otherwise the
   * value of a new lowering (`lower()`). The new value is remembered in this
   * region when its lowering changed no local or parameter and every
   * operation that it appended is `pure` and cannot abort: an operation of
   * a nested region is in the effect and the abort fact of the operation
   * that holds it. A conversion of the value is applied by the caller, once
   * per use. A leaf (a symbol, a number) is lowered at each use: its
   * lowering is one operation, and a read of an input written at each use
   * keeps the code of a program with no shared node as it is.
   */
  private value(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const region = this.regions[this.regions.length - 1];
    if (region === undefined || region.operations !== operations)
      return fail(`${nodeText(node)} is lowered in a region that is not open`);
    if (!isFunction(node)) return this.lower(node, scope, operations);
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const known = this.regions[i].values.get(node)?.get(scope);
      if (known !== undefined && known.epoch === this.epoch) return known.value;
    }
    const epoch = this.epoch;
    const start = operations.length;
    const value = this.lower(node, scope, operations);
    if (epoch !== this.epoch) return value;
    // A host operation is never shared, also a pure one: the host can count
    // its calls (`IRHostCall`).
    for (let i = start; i < operations.length; i++) {
      const op = operations[i];
      if (
        op.effect !== 'pure' ||
        operationCanAbort(op, this.functions) ||
        reachesHost(op, this.functions)
      )
        return value;
    }
    let byScope = region.values.get(node);
    if (byScope === undefined) region.values.set(node, (byScope = new Map()));
    byScope.set(scope, { value, epoch });
    return value;
  }

  /** Lower `node`, typed in `scope`, at the end of `operations`. */
  private lower(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    if (isFunction(node, 'Block')) return this.block(node, scope, operations);
    const facts = this.facts(node, scope);
    if (isNumber(node) || isSymbol(node, 'True') || isSymbol(node, 'False')) {
      const result = this.resultOf(facts);
      operations.push({
        kind: 'literal',
        value: isSymbol(node)
          ? node.symbol === 'True'
          : result.representation === 'complex'
            ? { re: node.re, im: node.im }
            : node.re,
        result,
        operands: [],
        effect: this.effect(node),
        origin: node,
      });
      return result;
    }
    if (isSymbol(node)) return this.read(node, scope, operations);
    if (!isFunction(node)) return fail(`no lowering for ${nodeText(node)}`);

    const effect = this.effect(node);
    const operator = node.operator;

    // `Typed(value, T)` around the value of a function body: the rule of
    // `Typed` admits a value whose fact is `T`, or an integer (a list of
    // integers) for a real (a list of reals), which is a valid value of the
    // result of the function as it is.
    if (operator === 'Typed') return this.value(node.ops[0], scope, operations);

    if (operator === 'Comprehension')
      return this.inScope(scope.inner.get(node), () =>
        this.build(node, facts, scope, operations, effect)
      );

    if (operator === 'Which' || (operator === 'If' && node.nops === 2))
      return this.selection(node, facts, scope, operations, effect);

    if (operator === 'Sum' || operator === 'Product')
      return this.inScope(scope.inner.get(node), () =>
        this.aggregate(node, facts, scope, operations)
      );

    if (operator === 'If') {
      if (node.nops !== 3) fail('an If needs a condition and two branches');
      const [condition, a, b] = node.ops;
      const test = this.convert(
        this.value(condition, scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const branch = (operand: Expression, index: number): IRRegion => {
        const inner: IROperation[] = [];
        const v = this.inRegion(inner, () =>
          this.convert(
            this.value(operand, scope, inner),
            facts.conversions?.[index],
            node,
            inner
          )
        );
        return this.region(inner, operand, v);
      };
      const then = branch(a, 1);
      const otherwise = branch(b, 2);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'if',
        results: [result],
        operands: [test],
        then,
        else: otherwise,
        effect: joinEffects(effect, then.effect, otherwise.effect),
        ...touchesField(this.states(node), then.touches, otherwise.touches),
        origin: node,
      });
      return result;
    }

    if (operator === 'And' || operator === 'Or') {
      const [head, ...tail] = node.ops;
      const first = this.convert(
        this.value(head, scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const rest = tail.map((operand, i) => {
        const inner: IROperation[] = [];
        const v = this.inRegion(inner, () =>
          this.convert(
            this.value(operand, scope, inner),
            facts.conversions?.[i + 1],
            node,
            inner
          )
        );
        return this.region(inner, operand, v);
      });
      const result = this.resultOf(facts);
      operations.push({
        kind: operator === 'And' ? 'and' : 'or',
        result,
        operands: [first],
        rest,
        effect: joinEffects(effect, ...rest.map((r) => r.effect)),
        ...touchesField(this.states(node), ...rest.map((r) => r.touches)),
        origin: node,
      });
      return result;
    }

    if (operator === 'Random') return this.draw(node, facts, operations);

    if (operator === 'WithRandomSeed')
      return this.seeded(node, facts, scope, operations);

    // A head of a `call` binding of the host: its operands, then the call.
    const host = this.hostIndex(operator, 'call');
    if (host >= 0) {
      const operands = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      const hostEffect: EffectFact = this.prep.hosts![host].pure
        ? 'pure'
        : 'unknown';
      operations.push({
        kind: 'host',
        host,
        result,
        operands,
        effect: hostEffect,
        origin: node,
      });
      this.afterUnknown(hostEffect);
      return result;
    }

    const entry = this.prep.annotation.functions.get(operator);
    if (entry !== undefined && this.prep.helpers.has(operator)) {
      const args = this.operands(node, facts, scope, operations);
      const index = this.helper(operator, args, facts, node);
      const result = this.resultOf(facts);
      const callEffect = joinEffects(effect, this.functions[index].body.effect);
      operations.push({
        kind: 'call',
        function: index,
        result,
        operands: args,
        effect: callEffect,
        ...touchesField(this.states(node), this.functions[index].body.touches),
        origin: node,
      });
      this.afterUnknown(callEffect);
      return result;
    }

    const trace = this.prep.testOperations.get(operator);
    if (trace !== undefined) {
      const operands = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'trace',
        trace,
        result,
        operands,
        effect,
        ...touchesField(this.states(node)),
        origin: node,
      });
      return result;
    }

    // `Power` in the form that its rule recorded (`StructuredForm`, the
    // forms of `powerForm()`). `Power(x, 2)`: the product of
    // the operand with itself; `Power(x, 1.5)`: the product of the operand
    // and its square root. The operand is evaluated once, and the literal
    // exponent has no operation. `Power(ExponentialE, x)`: the function
    // `exp` of the exponent, whose conversion is the first one of the facts
    // (the rule of `Power` types no base for this form).
    if (operator === 'Power') {
      const form = this.prep.forms.get(node);
      if (typeof form === 'object')
        return this.folded(node, form.folded, facts, effect, operations);
      if (form === 'exp') {
        const exponent = this.convert(
          this.value(node.ops[1], scope, operations),
          facts.conversions?.[0],
          node,
          operations
        );
        const result = this.resultOf(facts);
        operations.push({
          kind: 'unary',
          fn: 'exp',
          result,
          operands: [exponent],
          effect,
          origin: node,
        });
        return result;
      }
      // A function of the base and the exponent, both converted by the
      // facts of the rule.
      if (
        form === 'pow' ||
        form === 'abs-pow' ||
        form === 'signed-pow' ||
        form === 'real-pow' ||
        form === 'complex-pow'
      ) {
        const operands = this.operands(node, facts, scope, operations);
        const result = this.resultOf(facts);
        operations.push({
          kind: 'binary',
          fn: form === 'complex-pow' ? 'pow' : form,
          result,
          operands,
          effect,
          origin: node,
        });
        return result;
      }
      if (form === 'complex-chain') {
        // The base is evaluated once; the literal exponent has no
        // operation. The products are in the order of `pow()` of the
        // existing emitter (`Power` in `javascript-target.ts`).
        const base = this.convert(
          this.value(node.ops[0], scope, operations),
          facts.conversions?.[0],
          node,
          operations
        );
        const k = (node.ops[1] as Expression & { re: number }).re;
        const power = (n: number): IRValue => {
          if (n === 1) return base;
          const half = n % 2 === 0 ? power(n / 2) : undefined;
          const operands =
            half !== undefined ? [half, half] : [power(n - 1), base];
          const result =
            n === k ? this.resultOf(facts) : this.newValue('complex', 'complex');
          operations.push({
            kind: 'multiply',
            result,
            operands,
            effect,
            origin: node,
          });
          return result;
        };
        return power(k);
      }
      if (
        form !== 'square' &&
        form !== 'three-halves' &&
        form !== 'product-power' &&
        form !== 'reciprocal-square'
      )
        return fail(`no recorded form for the power ${nodeText(node)}`);
      const operand = this.convert(
        this.value(node.ops[0], scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      // The operations of `_SYS.pow3` to `_SYS.pow5` and of `(1 / b / b)`,
      // in their order, so each rounding is the same.
      const push = (
        kind: 'multiply' | 'divide',
        operands: IRValue[],
        result: IRValue = this.newValue(valueType(facts.type), 'number')
      ): IRValue => {
        operations.push({ kind, result, operands, effect, origin: node });
        return result;
      };
      if (form === 'product-power') {
        const n = (node.ops[1] as Expression & { re: number }).re;
        const square = push('multiply', [operand, operand]);
        const result = this.resultOf(facts);
        if (n === 3) return push('multiply', [square, operand], result);
        if (n === 4) return push('multiply', [square, square], result);
        return push(
          'multiply',
          [push('multiply', [square, square]), operand],
          result
        );
      }
      if (form === 'reciprocal-square') {
        const one = this.newValue('integer', 'number');
        operations.push({
          kind: 'literal',
          value: 1,
          result: one,
          operands: [],
          effect: 'pure',
          origin: node,
        });
        const reciprocal = push('divide', [one, operand]);
        return push('divide', [reciprocal, operand], this.resultOf(facts));
      }
      let factor = operand;
      if (form === 'three-halves') {
        factor = this.newValue('real', 'number');
        operations.push({
          kind: 'sqrt',
          result: factor,
          operands: [operand],
          effect,
          origin: node,
        });
      }
      const result = this.resultOf(facts);
      operations.push({
        kind: 'multiply',
        result,
        operands: [operand, factor],
        effect,
        origin: node,
      });
      return result;
    }

    // `Root` in the form that its rule recorded: `cbrt` of the radicand
    // (the literal degree 3 has no operation), or `root` of the radicand
    // and the degree.
    if (operator === 'Root') {
      const form = this.prep.forms.get(node);
      if (typeof form === 'object')
        return this.folded(node, form.folded, facts, effect, operations);
      if (form !== 'cbrt' && form !== 'root')
        return fail(`no recorded form for the root ${nodeText(node)}`);
      const operands =
        form === 'root'
          ? this.operands(node, facts, scope, operations)
          : [
              this.convert(
                this.value(node.ops[0], scope, operations),
                facts.conversions?.[0],
                node,
                operations
              ),
            ];
      const result = this.resultOf(facts);
      operations.push(
        form === 'cbrt'
          ? {
              kind: 'unary',
              fn: 'cbrt',
              result,
              operands,
              effect,
              origin: node,
            }
          : {
              kind: 'binary',
              fn: 'root',
              result,
              operands,
              effect,
              origin: node,
            }
      );
      return result;
    }

    // The forms of `Sin`, `Cos`, `Tan`, `Conjugate` and `Log` that are not
    // one function of the operands (`StructuredForm`).
    const special = this.prep.forms.get(node);
    if (special === 'pi-multiple') {
      // The function of the factor `u` of `Multiply(Pi, u)`, which the rule
      // admitted with a real or an integer fact: the product is not lowered.
      const u = piMultipleFactor(node.ops[0]);
      if (u === undefined || !Object.hasOwn(PI_MULTIPLE_FUNCTIONS, operator))
        return fail(`no multiple of Pi in ${nodeText(node)}`);
      const operand = this.value(u, scope, operations);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'unary',
        fn: PI_MULTIPLE_FUNCTIONS[operator],
        result,
        operands: [operand],
        effect,
        origin: node,
      });
      return result;
    }
    if (special === 'identity')
      return this.operands(node, facts, scope, operations)[0];
    if (special === 'conjugate') {
      const operands = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'unary',
        fn: 'conjugate',
        result,
        operands,
        effect,
        origin: node,
      });
      return result;
    }
    if (special === 'log10' || special === 'log2') {
      // The base, a literal or absent, has no operation.
      const operand = this.convert(
        this.value(node.ops[0], scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const result = this.resultOf(facts);
      operations.push({
        kind: 'unary',
        fn: special,
        result,
        operands: [operand],
        effect,
        origin: node,
      });
      return result;
    }
    if (special === 'log-quotient') {
      const logs = this.operands(node, facts, scope, operations).map(
        (operand) => {
          const log = this.newValue('real', 'number');
          operations.push({
            kind: 'unary',
            fn: 'ln',
            result: log,
            operands: [operand],
            effect,
            origin: node,
          });
          return log;
        }
      );
      const result = this.resultOf(facts);
      operations.push({
        kind: 'divide',
        result,
        operands: logs,
        effect,
        origin: node,
      });
      return result;
    }
    if (operator === 'Conjugate' || operator === 'Log')
      return fail(`no recorded form for ${nodeText(node)}`);

    const fn = Object.hasOwn(FUNCTIONS, operator)
      ? FUNCTIONS[operator]
      : undefined;
    if (fn !== undefined) {
      // `Abs` of an operand that the existing emitter proves non-negative
      // is the operand itself (`abs-identity`).
      const form = operator === 'Abs' ? this.prep.forms.get(node) : 'abs';
      if (form !== 'abs' && form !== 'abs-identity')
        return fail(`no recorded form for ${nodeText(node)}`);
      const operands = this.operands(node, facts, scope, operations);
      if (form === 'abs-identity') return operands[0];
      const result = this.resultOf(facts);
      operations.push(
        fn.kind === 'unary'
          ? { kind: 'unary', fn: fn.fn, result, operands, effect, origin: node }
          : {
              kind: 'binary',
              fn: fn.fn,
              result,
              operands,
              effect,
              origin: node,
            }
      );
      return result;
    }

    if (operator === 'Multiply' && facts.representation === 'complex')
      return this.complexProduct(node, facts, scope, operations, effect);

    if (
      operator === 'Multiply' &&
      node.ops.some((op) => exactRationalDivisor(op) !== undefined)
    )
      return this.multiplyByRational(node, facts, scope, operations, effect);

    if (operator === 'Multiply')
      return this.realProduct(
        node,
        node.ops.map((_, i) => i),
        facts,
        scope,
        operations,
        effect,
        this.resultOf(facts)
      );

    const kind = Object.hasOwn(OPERATIONS, operator)
      ? OPERATIONS[operator]
      : undefined;
    if (kind === undefined) return fail(`no lowering for the head ${operator}`);
    const operands = this.operands(node, facts, scope, operations);
    const result = this.resultOf(facts);
    operations.push({ kind, result, operands, effect, origin: node });
    return result;
  }

  /**
   * `Comprehension(body, Element(j, Range(a, b)))`, which the rule of
   * `Comprehension` checked: a `build` whose bounds are the values of `a`
   * and `b`, evaluated here, before it, and whose body region has the index
   * `j` as its parameter and yields the value of `body`. The index is bound
   * in the scope of the comprehension.
   */
  private build(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const [body, spec] = node.ops;
    const inner = scope.inner.get(node);
    if (
      inner === undefined ||
      node.ops.length !== 2 ||
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return fail(`no lowering for the comprehension ${nodeText(node)}`);
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${nodeText(b)} of a comprehension is not an integer`);
      return value;
    };
    const from = bound(spec.op2.op1);
    const to = bound(spec.op2.op2);
    const index = this.newValue('integer', 'number');
    this.bound.set(inner, new Map([[spec.op1.symbol, index]]));
    this.wrote(inner);
    this.changed();
    const bodyOperations: IROperation[] = [];
    const element = this.inRegion(bodyOperations, () =>
      this.value(body, inner, bodyOperations)
    );
    const region: IRRegion = {
      ...this.region(bodyOperations, body, element),
      parameters: [index],
    };
    const result = this.resultOf(facts);
    operations.push({
      kind: 'build',
      result,
      operands: [from, to],
      body: region,
      effect: joinEffects(effect, region.effect),
      ...touchesField(this.states(node), region.touches),
      origin: node,
    });
    return result;
  }

  /**
   * `Random()`, `Random(Interval(a, b))` or `Random(Range(…))`, which the
   * rule of `Random` admitted (`randomRule` in
   * `javascript-fragment-target.ts`), as the existing emitter writes it
   * (`Random` in `javascript-target.ts`): one `draw`, and for a literal
   * domain pure arithmetic around it, with the parameters that the rule read
   * (`randomDomainOf()`): `a + u·w` with the double `w = b - a` for an
   * `Interval`, `first + step·floor(u·n)` for a `Range`. The domain has no
   * operation of its own: its literals have the origin of the node.
   */
  private draw(
    node: Expression,
    facts: FragmentValueFacts<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const domain = randomDomainOf(node);
    if (domain === undefined)
      return fail(`no drawable domain in ${nodeText(node)}`);
    const u = this.newValue('real', 'number');
    operations.push({
      kind: 'draw',
      result: u,
      operands: [],
      effect: 'effectful',
      touches: ['random'],
      origin: node,
    });
    if (domain.kind === 'unit') return u;
    const literal = (value: number, type: 'real' | 'integer') =>
      this.numberLiteral(value, type, node, operations);
    const push = (
      kind: 'add' | 'multiply' | 'floor',
      operands: IRValue[],
      result: IRValue
    ): IRValue => {
      operations.push({ kind, result, operands, effect: 'pure', origin: node });
      return result;
    };
    if (domain.kind === 'interval') {
      const scaled = push(
        'multiply',
        [u, literal(domain.width, 'real')],
        this.newValue('real', 'number')
      );
      return push(
        'add',
        [literal(domain.start, 'real'), scaled],
        this.resultOf(facts)
      );
    }
    const first = literal(domain.first, 'integer');
    const step = literal(domain.step, 'integer');
    const index = push(
      'floor',
      [
        push(
          'multiply',
          [u, literal(domain.n, 'integer')],
          this.newValue('real', 'number')
        ),
      ],
      this.newValue('integer', 'number')
    );
    return push(
      'add',
      [
        first,
        push('multiply', [step, index], this.newValue('integer', 'number')),
      ],
      this.resultOf(facts)
    );
  }

  /**
   * `WithRandomSeed(seed, body)`, which the rule of `WithRandomSeed`
   * admitted (`seededRule()` in `javascript-fragment-target.ts`): the seed,
   * evaluated here (a literal number or string seed has no operation), then
   * a `seeded` whose body region is the value of `body`. Its effect and its
   * states are those of the body without `random` (`dischargedEffect()`).
   */
  private seeded(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const [seedNode, bodyNode] = node.ops;
    const literalSeed = literalSeedOf(seedNode);
    const seed =
      literalSeed === undefined
        ? this.convert(
            this.value(seedNode, scope, operations),
            facts.conversions?.[0],
            node,
            operations
          )
        : undefined;
    // The body is a region of its own: a value that its lowering remembers
    // is not visible after the region (`inRegion()`). It binds no name.
    const inner: IROperation[] = [];
    const value = this.inRegion(inner, () =>
      this.convert(
        this.value(bodyNode, scope, inner),
        facts.conversions?.[literalSeed === undefined ? 1 : 0],
        node,
        inner
      )
    );
    const body = this.region(inner, bodyNode, value);
    const result = this.newValue(
      value.type,
      value.representation as ScalarRepresentation
    );
    operations.push({
      kind: 'seeded',
      result,
      operands: seed === undefined ? [] : [seed],
      ...(literalSeed !== undefined ? { seed: literalSeed } : {}),
      body,
      ...dischargedEffect(body.effect, body.touches),
      origin: node,
    });
    return result;
  }

  /**
   * A product with a complex result, which the rule of `Multiply` admitted
   * with each operand in its own representation, lowered as the existing
   * emitter writes it (`Multiply` in `javascript-target.ts`):
   *
   * - Two operands, one a complex literal `p + qi` with finite parts and
   *   the other a real `v`: the function `complex` of the two parts, each
   *   `0` for a part 0, `v` for a part 1 and the real product `k·v`
   *   otherwise (`i·x` is `complex(0, x)`). The literal has no operation.
   * - Two other operands: one `multiply`.
   * - Three operands or more: the left fold of binary products in the
   *   order of the operands, after one real product of the real factors
   *   that come before the first complex one. A real factor scales both
   *   parts of the complex product so far, as the existing emitter
   *   accumulates them; a complex literal is a factor of the fold.
   *
   * A rational factor is a literal of its double. Every operand is
   * evaluated once, in order, before the first product.
   */
  private complexProduct(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const push = (
      kind: 'multiply',
      operands: IRValue[],
      result: IRValue
    ): IRValue => {
      operations.push({ kind, result, operands, effect, origin: node });
      return result;
    };
    if (node.ops.length === 2) {
      const index = node.ops.findIndex(
        (op, i) =>
          isNumber(op) &&
          op.im !== 0 &&
          Number.isFinite(op.re) &&
          Number.isFinite(op.im) &&
          this.facts(op, scope).representation === 'complex' &&
          this.facts(node.ops[1 - i], scope).representation !== 'complex'
      );
      if (index >= 0) {
        const literal = node.ops[index];
        const v = this.convert(
          this.value(node.ops[1 - index], scope, operations),
          facts.conversions?.[1 - index],
          node,
          operations
        );
        const part = (k: number): IRValue => {
          if (k === 1) return v;
          const constant = this.newValue('real', 'number');
          operations.push({
            kind: 'literal',
            value: k === 0 ? 0 : k,
            result: constant,
            operands: [],
            effect: 'pure',
            origin: literal,
          });
          if (k === 0) return constant;
          return push('multiply', [constant, v], this.newValue('real', 'number'));
        };
        const re = part(literal.re);
        const im = part(literal.im);
        const result = this.resultOf(facts);
        operations.push({
          kind: 'binary',
          fn: 'complex',
          result,
          operands: [re, im],
          effect,
          origin: node,
        });
        return result;
      }
    }
    const values = this.operands(node, facts, scope, operations);
    const first = values.findIndex((v) => v.representation === 'complex');
    if (first < 0) return fail(`no complex factor in ${nodeText(node)}`);
    const real = values.slice(0, first);
    let product: IRValue | undefined =
      real.length === 0
        ? undefined
        : real.length === 1
          ? real[0]
          : push(
              'multiply',
              real,
              this.newValue(
                real.every((v) => v.type === 'integer') ? 'integer' : 'real',
                'number'
              )
            );
    values.slice(first).forEach((v, i) => {
      if (product === undefined) {
        product = v;
        return;
      }
      product = push(
        'multiply',
        [product, v],
        first + i === values.length - 1
          ? this.resultOf(facts)
          : this.newValue('complex', 'complex')
      );
    });
    return product!;
  }

  /** A number literal of the type `type` at the end of `operations`. */
  private numberLiteral(
    value: number,
    type: 'real' | 'integer',
    origin: Expression,
    operations: IROperation[]
  ): IRValue {
    const result = this.newValue(type, 'number');
    operations.push({
      kind: 'literal',
      value,
      result,
      operands: [],
      effect: 'pure',
      origin,
    });
    return result;
  }

  /**
   * An `if` of one result at the end of `operations`: the value of
   * `then` when `test` holds, else the value of `otherwise`, each lowered
   * in its own region. The result has the type of both values, or `real`
   * for an integer and a real one.
   */
  private conditional(
    test: IRValue,
    then: (operations: IROperation[]) => IRValue,
    otherwise: (operations: IROperation[]) => IRValue,
    origin: Expression,
    operations: IROperation[],
    effect: EffectFact = 'pure'
  ): IRValue {
    const thenOperations: IROperation[] = [];
    const a = this.inRegion(thenOperations, () => then(thenOperations));
    const thenRegion = this.region(thenOperations, origin, a);
    const elseOperations: IROperation[] = [];
    const b = this.inRegion(elseOperations, () => otherwise(elseOperations));
    const elseRegion = this.region(elseOperations, origin, b);
    if (a.representation !== b.representation)
      fail(`the two values of a conditional ${nodeText(origin)} have different representations`);
    const result = this.newValue(
      widerType(a.type, b.type) ??
        fail(`the two values of a conditional ${nodeText(origin)} have no common type`),
      a.representation as ScalarRepresentation
    );
    operations.push({
      kind: 'if',
      results: [result],
      operands: [test],
      then: thenRegion,
      else: elseRegion,
      effect: joinEffects(effect, thenRegion.effect, elseRegion.effect),
      ...touchesField(thenRegion.touches, elseRegion.touches),
      origin,
    });
    return result;
  }

  /**
   * `Which(c1, v1, …, cn, vn)`, and `If(c, v)` used as a value, which the
   * rule of `Which` checked (`selectionRule()` in
   * `javascript-fragment-target.ts`): an `if` per clause, nested in the
   * else branch of the one before, as the existing emitter writes a chain of
   * conditional expressions (`compileExprWhich()` in
   * `compile-conditionals.ts`). The first condition is evaluated where the
   * node is, each later one only when the conditions before it are false. A
   * last condition `True` is the default clause: its value has no test.
   * With no default clause, the value when no condition holds is the literal
   * `NaN`, of the type of the node, as the existing emitter writes it for a
   * numeric result (`noBranchValue()`): the absent value of a number.
   */
  private selection(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const ops = node.ops;
    const type = valueType(facts.type);
    if (type !== 'real' && type !== 'integer')
      return fail(`the value of ${nodeText(node)} is not a number`);
    const operand = (i: number, into: IROperation[]): IRValue =>
      this.convert(
        this.value(ops[i], scope, into),
        facts.conversions?.[i],
        node,
        into
      );
    const clause = (i: number, into: IROperation[]): IRValue => {
      if (i >= ops.length) return this.numberLiteral(NaN, type, node, into);
      if (isSymbol(ops[i], 'True')) return operand(i + 1, into);
      const test = operand(i, into);
      return this.conditional(
        test,
        (inner) => operand(i + 1, inner),
        (inner) => clause(i + 2, inner),
        node,
        into,
        effect
      );
    };
    return clause(0, operations);
  }

  /**
   * `Sum(body, Limits(k, a, b), …)` and `Product(…)`, which the rule of the
   * aggregate checked (`aggregateRule()` in
   * `javascript-fragment-target.ts`), lowered as the existing emitter writes
   * them (`emitSumProduct()` in `javascript-target.ts`). The first clause is
   * the outermost; the term of a clause is the aggregate of the clauses
   * after it, and the body for the last one. The indexes are bound in the
   * scope of the aggregate. For each clause, in the order of the existing
   * emitter:
   *
   * - A bound is constant when it is a number literal or a captured binding
   *   (`bigOpBoundConstant()`): its value is the floor of that number, and
   *   the bound has no operation. Every other bound is evaluated once, before
   *   the terms, the lower bound first, and floored (`compileBound()`).
   * - Both bounds constant and, with an iteration budget, `b - a` less than
   *   the budget: no term for `a > b` (the literal `0` of a sum, `1` of a
   *   product); the terms in order, each with the index a literal, joined by
   *   one `add` or `multiply`, when the clause fits the size limit of the
   *   unrolled form (`unrollFits()` with `UNROLL_LIMIT` terms); a single term
   *   is the term itself. So `Σ_{k=1}^{3} t_k` is `(t_1 + t_2) + t_3`, not
   *   `((0 + t_1) + t_2) + t_3`, which differs for terms of `-0`.
   * - Both bounds constant and `b - a` not less than the budget: the literal
   *   `NaN`, the value of the guard of the loop of the existing emitter.
   * - Otherwise a `loop` with one carried value, the accumulator, whose
   *   initial value is `0` or `1` and whose next value is the accumulator
   *   plus (times) the term: the order of the operations of the loop of the
   *   existing emitter, `acc += term` from the lower bound up. The loop has
   *   no iteration budget, and so cannot abort: the existing emitter counts
   *   no pass of an aggregate. When a bound is not constant, the loop is in
   *   two `if` operations, the guard of the existing emitter: the value is
   *   `NaN` when a bound that is not constant is not a safe integer (with a
   *   budget: a finite number that is not a safe integer), or, with a
   *   budget, when `b - a` is not less than the budget; else the value of
   *   the loop when `a <= b`, and `0` or `1` otherwise (the `loop` of the
   *   representation visits a range in steps of -1 when `b < a`, where the
   *   aggregate has no term). The value of a bound is an integer, `±∞` or
   *   `NaN` after the floor, so each test is the one of the existing emitter
   *   with the operations of the representation: `Number.isSafeInteger(b)`
   *   is `|b| <= 2^53 - 1`, `Number.isFinite(b)` is `|b| < ∞`.
   *
   * The early exit of the existing emitter on a `NaN` accumulator gives the
   * same value: `NaN` absorbs both operations, and it skips a term only when
   * the term has no effect.
   *
   * The operations that the lowering adds (the sum, the guard) are `pure`.
   * The effect fact of the node is not read: it joins the effects of the
   * body and of the bounds (`shallowApplicationEffects()`), which their own
   * operations carry, and the `loop` and the `if` operations join the
   * effects of their regions.
   */
  private aggregate(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined)
      return fail(`no scope for the aggregate ${nodeText(node)}`);
    const clauses = node.ops.slice(1).map((clause) =>
      isFunction(clause, 'Limits') && clause.nops === 3 && isSymbol(clause.op1)
        ? { index: clause.op1.symbol, lower: clause.op2, upper: clause.op3 }
        : fail(`no lowering for the index set ${nodeText(clause)}`)
    );
    const body = node.ops[0];
    const sum = node.operator === 'Sum';
    const type = valueType(facts.type);
    if (type !== 'real' && type !== 'integer')
      return fail(`the body of ${nodeText(node)} is not a number`);
    const representation = facts.representation;
    const budget = this.prep.iterationBudget;
    const bodyConversion = facts.conversions?.[2 * clauses.length];

    // The value of a constant bound, floored, or `undefined`.
    const constant = (bound: Expression): number | undefined => {
      const value = isNumber(bound)
        ? bound.re
        : isSymbol(bound)
          ? this.prep.captures.find((c) => c.symbols.has(bound))?.value
          : undefined;
      return value === undefined ? undefined : Math.floor(value);
    };
    const bindIndex = (name: string, value: IRValue) => {
      const values = new Map(this.bound.get(inner) ?? []);
      values.set(name, value);
      this.bound.set(inner, values);
      this.wrote(inner);
      this.changed();
    };
    const push = (
      kind: 'add' | 'negate' | 'multiply' | 'less' | 'less-equal' | 'not',
      operands: IRValue[],
      type: ValueType,
      into: IROperation[]
    ): IRValue => {
      const result = this.newValue(
        type,
        type === 'boolean' ? 'boolean' : 'number'
      );
      into.push({ kind, result, operands, effect: 'pure', origin: node });
      return result;
    };
    const abs = (v: IRValue, into: IROperation[]): IRValue => {
      const result = this.newValue('integer', 'number');
      into.push({
        kind: 'unary',
        fn: 'abs',
        result,
        operands: [v],
        effect: 'pure',
        origin: node,
      });
      return result;
    };
    const literal = (value: number, into: IROperation[]) =>
      this.numberLiteral(
        value,
        Number.isInteger(value) ? 'integer' : 'real',
        node,
        into
      );

    const clause = (i: number, out: IROperation[]): IRValue => {
      const { index, lower, upper } = clauses[i];
      const term = (k: IRValue, into: IROperation[]): IRValue => {
        bindIndex(index, k);
        return i + 1 < clauses.length
          ? clause(i + 1, into)
          : this.convert(
              this.value(body, inner, into),
              bodyConversion,
              node,
              into
            );
      };
      const identity = (into: IROperation[]) =>
        this.numberLiteral(sum ? 0 : 1, type, node, into);
      const lo = constant(lower);
      const hi = constant(upper);
      const constantBounds = lo !== undefined && hi !== undefined;
      const withinBudget =
        budget === undefined || (constantBounds && hi - lo < budget);
      if (constantBounds && withinBudget) {
        if (lo > hi) return identity(out);
        const rest = node.ops.slice(i + 2);
        if (
          unrollFits(hi - lo + 1, unrolledTermSize(body, rest), UNROLL_LIMIT)
        ) {
          const terms: IRValue[] = [];
          for (let k = lo; k <= hi; k++) terms.push(term(literal(k, out), out));
          if (terms.length === 1) return terms[0];
          return push(
            sum ? 'add' : 'multiply',
            terms,
            terms
              .map((t) => t.type)
              .reduce(
                (a, b) =>
                  widerType(a, b) ??
                  fail(`the terms of ${nodeText(node)} have no common type`)
              ),
            out
          );
        }
      }
      if (constantBounds && !withinBudget)
        return this.numberLiteral(NaN, type, node, out);

      // The bounds, evaluated once, the lower one first, and floored.
      const bound = (b: Expression, value: number | undefined): IRValue => {
        if (value !== undefined) return literal(value, out);
        const v = this.value(b, inner, out);
        const result = this.newValue('integer', 'number');
        out.push({
          kind: 'floor',
          result,
          operands: [v],
          effect: 'pure',
          origin: b,
        });
        return result;
      };
      const from = bound(lower, lo);
      const to = bound(upper, hi);

      const loop = (into: IROperation[]): IRValue => {
        const indexValue = this.newValue('integer', 'number');
        const accumulator = this.newValue(type, representation);
        const bodyOperations: IROperation[] = [];
        const t = this.inRegion(bodyOperations, () =>
          term(indexValue, bodyOperations)
        );
        if (widerType(type, t.type) !== type)
          fail(`a term of ${nodeText(node)} has the type ${t.type}`);
        const next = push(
          sum ? 'add' : 'multiply',
          [accumulator, t],
          type,
          bodyOperations
        );
        const region: IRRegion = {
          ...this.region(bodyOperations, node, next),
          parameters: [indexValue, accumulator],
        };
        const initial = this.numberLiteral(sum ? 0 : 1, 'integer', node, into);
        const result = this.newValue(type, representation);
        into.push({
          kind: 'loop',
          results: [result],
          operands: [from, to, initial],
          body: region,
          effect: region.effect,
          ...touchesField(region.touches),
          origin: node,
        });
        return result;
      };
      if (constantBounds) return loop(out);

      // The guard: `NaN` when a bound that is not constant is not a safe
      // integer, or when the range is over the budget.
      const MAX = Number.MAX_SAFE_INTEGER;
      const checks: ((into: IROperation[]) => IRValue)[] = [];
      const unsafe = (v: IRValue) => (into: IROperation[]) => {
        const magnitude = abs(v, into);
        if (budget === undefined)
          return push(
            'not',
            [
              push(
                'less-equal',
                [magnitude, literal(MAX, into)],
                'boolean',
                into
              ),
            ],
            'boolean',
            into
          );
        const finiteOperations: IROperation[] = [];
        const finite = push(
          'less',
          [magnitude, this.numberLiteral(Infinity, 'real', node, finiteOperations)],
          'boolean',
          finiteOperations
        );
        const result = this.newValue('boolean', 'boolean');
        into.push({
          kind: 'and',
          result,
          operands: [
            push('less', [literal(MAX, into), magnitude], 'boolean', into),
          ],
          rest: [this.region(finiteOperations, node, finite)],
          effect: 'pure',
          origin: node,
        });
        return result;
      };
      if (hi === undefined) checks.push(unsafe(to));
      if (lo === undefined) checks.push(unsafe(from));
      if (budget !== undefined)
        checks.push((into) =>
          push(
            'not',
            [
              push(
                'less',
                [
                  push(
                    'add',
                    [to, push('negate', [from], 'integer', into)],
                    'integer',
                    into
                  ),
                  literal(budget, into),
                ],
                'boolean',
                into
              ),
            ],
            'boolean',
            into
          )
        );
      const first = checks[0](out);
      let invalid = first;
      if (checks.length > 1) {
        invalid = this.newValue('boolean', 'boolean');
        out.push({
          kind: 'or',
          result: invalid,
          operands: [first],
          rest: checks.slice(1).map((check) => {
            const checkOperations: IROperation[] = [];
            return this.region(
              checkOperations,
              node,
              check(checkOperations)
            );
          }),
          effect: 'pure',
          origin: node,
        });
      }
      return this.conditional(
        invalid,
        (into) => this.numberLiteral(NaN, type, node, into),
        (into) =>
          this.conditional(
            push('less-equal', [from, to], 'boolean', into),
            loop,
            identity,
            node,
            into
          ),
        node,
        out
      );
    };
    return clause(0, operations);
  }

  /**
   * A product with an exact rational factor `p/q` (`exactRationalDivisor()`:
   * `q` is not 1 nor a power of two), lowered as the existing emitter
   * writes it (`Multiply` in `compile-operators.ts`): the product of the
   * other factors, in order, divided by `q`, then multiplied by `p` when `p`
   * is not 1, or negated when `p` is -1. So `Multiply(1/49, k)` is
   * `k / 49`, `Multiply(29/50, n)` is `n / 50 * 29` and `Multiply(2/3, x,
   * y)` is `x * y / 3 * 2`. A division is correctly rounded, so `k / 49` is
   * exactly 1 at `k = 49`, where the product by the rounded `1/49` is
   * `0.9999999999999999`. The first such factor is the divisor; another
   * rational factor is a number literal of the product.
   */
  private multiplyByRational(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const index = node.ops.findIndex(
      (op) => exactRationalDivisor(op) !== undefined
    );
    const rational = node.ops[index];
    const { p, q } = exactRationalDivisor(rational)!;
    const literal = (value: number): IRValue => {
      const result = this.newValue('integer', 'number');
      operations.push({
        kind: 'literal',
        value,
        result,
        operands: [],
        effect: 'pure',
        origin: rational,
      });
      return result;
    };
    const push = (
      kind: 'multiply' | 'divide' | 'negate',
      operands: IRValue[],
      result: IRValue
    ): IRValue => {
      operations.push({ kind, result, operands, effect, origin: node });
      return result;
    };
    // The other factors, in parentheses on the existing emitter: their
    // product is read as the product of the parent (`realProduct()`).
    const numerator = this.realProduct(
      node,
      node.ops.flatMap((_, i) => (i === index ? [] : [i])),
      facts,
      scope,
      operations,
      effect
    );
    const quotient = push(
      'divide',
      [numerator, literal(q)],
      this.newValue('real', 'number')
    );
    if (p === 1) return quotient;
    if (p === -1)
      return push('negate', [quotient], this.newValue('real', 'number'));
    return push(
      'multiply',
      [quotient, literal(p)],
      this.newValue('real', 'number')
    );
  }

  /**
   * The real product of the operands of `node` at `indexes`, in order, each
   * with its conversion in `facts`, as the existing emitter writes it:
   * `compileExprOperator()` (`compile-operators.ts`) joins the codes of the
   * factors with ` * `, and a factor that is a real quotient is written
   * `n / d` with no parentheses (`Divide` binds tighter than `Multiply` on
   * the JavaScript target), so JavaScript reads the text from left to
   * right: `x * (1/y)` is `x * 1 / y`, that is `(x * 1) / y`, and
   * `x * (z/y) * (w/z)` is `((x * w) / z * z) / y` in the canonical order of
   * the factors. A factor after the first that is a real quotient
   * multiplies the product by its numerator (a numerator that is a quotient
   * in turn is read the same way, `a / b / c`, and a numerator
   * `Multiply(1/d, a, …)` that `multiplyByRational()` writes `a / d` as the
   * product of its other factors, then a division by `d`: `q * (0.1/3)/w`
   * is `q * 0.1 / 3 / w`) and divides it by its
   * denominator; a denominator is in parentheses, and so is a numerator
   * that is a product. The first factor and every other factor are one
   * operand. The multiplications between two divisions are one `multiply`
   * of their operands, so a product with no quotient factor is one
   * `multiply`, as before. `result`: the value of the last operation.
   */
  private realProduct(
    node: Expression & { ops: readonly Expression[] },
    indexes: readonly number[],
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact,
    result?: IRValue
  ): IRValue {
    const factor = (i: number) =>
      this.convert(
        this.value(node.ops[i], scope, operations),
        facts.conversions?.[i],
        node,
        operations
      );
    const quotientOf = (operand: Expression) =>
      isFunction(operand, 'Divide') &&
      operand.nops === 2 &&
      this.facts(operand, scope).representation === 'number'
        ? operand
        : undefined;
    const steps: { kind: 'multiply' | 'divide'; value: IRValue }[] = [];
    const quotient = (q: Expression & { ops: readonly Expression[] }) => {
      const qFacts = this.facts(q, scope);
      const part = (i: number) =>
        this.convert(
          this.value(q.ops[i], scope, operations),
          qFacts.conversions?.[i],
          q,
          operations
        );
      const inner = quotientOf(q.ops[0]);
      const numerator = q.ops[0];
      if (inner !== undefined) quotient(inner);
      else if (
        isFunction(numerator, 'Multiply') &&
        this.facts(numerator, scope).representation === 'number' &&
        unitRationalFactor(numerator) !== undefined
      ) {
        // A numerator `Multiply(1/d, a, …)` (`multiplyByRational()`) is
        // `a / d`, or `(a * …) / d`, with no parentheses around it on the
        // existing emitter: the product multiplies by the other factors as
        // one operand, then divides by `d`.
        const index = unitRationalFactor(numerator)!;
        const others = numerator.ops.flatMap((_, i) =>
          i === index ? [] : [i]
        );
        // One other factor that is a quotient is written `a / b / d`, a
        // part of the chain; more than one, `(a * …) / d`.
        const single =
          others.length === 1 ? quotientOf(numerator.ops[others[0]]) : undefined;
        if (single !== undefined) quotient(single);
        else
          steps.push({
            kind: 'multiply',
            value: this.realProduct(
              numerator,
              others,
              this.facts(numerator, scope),
              scope,
              operations,
              this.effect(numerator)
            ),
          });
        const divisor = this.newValue('integer', 'number');
        operations.push({
          kind: 'literal',
          value: exactRationalDivisor(numerator.ops[index])!.q,
          result: divisor,
          operands: [],
          effect: 'pure',
          origin: numerator.ops[index],
        });
        steps.push({ kind: 'divide', value: divisor });
      } else steps.push({ kind: 'multiply', value: part(0) });
      steps.push({ kind: 'divide', value: part(1) });
    };
    const first = factor(indexes[0]);
    for (const i of indexes.slice(1)) {
      const q = quotientOf(node.ops[i]);
      if (q !== undefined) quotient(q);
      else steps.push({ kind: 'multiply', value: factor(i) });
    }
    let product = first;
    let pending: IRValue[] = [first];
    const push = (
      kind: 'multiply' | 'divide',
      operands: IRValue[],
      last: boolean
    ): IRValue => {
      const type =
        kind === 'multiply' && operands.every((v) => v.type === 'integer')
          ? 'integer'
          : 'real';
      const value =
        last && result !== undefined ? result : this.newValue(type, 'number');
      operations.push({ kind, result: value, operands, effect, origin: node });
      return value;
    };
    steps.forEach((step, i) => {
      const last = i === steps.length - 1;
      if (step.kind === 'multiply') {
        pending.push(step.value);
        if (last) product = push('multiply', pending, true);
        return;
      }
      const dividend =
        pending.length > 1 ? push('multiply', pending, false) : pending[0];
      product = push('divide', [dividend, step.value], last);
      pending = [product];
    });
    if (steps.length === 0 && result !== undefined)
      return push('multiply', pending, true);
    return product;
  }

  /**
   * A read of a name, in the scope that binds it: a local or a parameter
   * is its value; an input of the program is a read of the input at this
   * position.
   */
  private read(
    node: Expression & { symbol: string },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const name = node.symbol;
    for (
      let s: FragmentScope<ScalarRepresentation> | undefined = scope;
      s;
      s = s.parent
    ) {
      if (!s.bindings.has(name)) continue;
      const value = this.bound.get(s)?.get(name);
      if (value !== undefined) return value;
      if (s !== this.prep.annotation.scope)
        return fail(`the name ${name} is read before its value is lowered`);
      const facts = this.facts(node, scope);
      // A `read` binding of the host: a read of the host at this position.
      const host = this.hostIndex(name, 'read');
      if (host >= 0) {
        const result = this.resultOf(facts);
        operations.push({
          kind: 'host',
          host,
          result,
          operands: [],
          effect: 'unknown',
          origin: node,
        });
        this.afterUnknown('unknown');
        return result;
      }
      const input = this.prep.inputs.findIndex((i) => i.name === name);
      if (input < 0) return fail(`the name ${name} is not an input`);
      const result = this.resultOf(facts);
      operations.push({
        kind: 'input',
        input,
        result,
        operands: [],
        effect: this.effect(node),
        origin: node,
      });
      return result;
    }
    return this.captureRead(node, scope, operations);
  }

  /** The index of the host binding of the name `name` and the form `form`
   *  in `StructuredPreparation.hosts`, or -1. */
  private hostIndex(name: string, form: 'call' | 'read'): number {
    return (
      this.prep.hosts?.findIndex((h) => h.name === name && h.form === form) ??
      -1
    );
  }

  /**
   * A read of a name that no scope binds: a binding that the admission
   * captured, read as its snapshot. The facts of the node are the facts of
   * the snapshot value (`FragmentDefinition.storedValue`).
   */
  private captureRead(
    node: Expression & { symbol: string },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const capture = this.prep.captures.find((c) => c.symbols.has(node));
    if (capture === undefined)
      return fail(`no binding for the name ${node.symbol}`);
    const facts = this.facts(node, scope);
    const result = this.resultOf(facts);
    let index = this.captureIndex.get(capture.binding);
    if (index === undefined) {
      index = this.captures.length;
      this.captures.push({
        binding: capture.binding,
        name: capture.name,
        type: scalarKind(facts.type),
        representation: result.representation,
        snapshot: capture.value,
      });
      this.captureIndex.set(capture.binding, index);
    }
    operations.push({
      kind: 'capture',
      capture: index,
      binding: capture.binding,
      snapshot: capture.value,
      result,
      operands: [],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /**
   * A block that has a value: its statements in order (`statement()`),
   * then its last statement, which is the value of the block.
   */
  private block(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined) return fail('no scope for a block');
    if (node.ops.length === 0) return fail('an empty block has no value');
    const last = node.ops[node.ops.length - 1];
    if (
      this.statements(
        node.ops.slice(0, -1),
        inner,
        operations,
        this.namesOf(last)
      )
    )
      fail('a statement of a block that has a value is a Break');
    return this.value(last, inner, operations);
  }

  /**
   * The statements `statements`, in order, in `scope`. `liveOut`: the
   * names that the code after the statements can read. True when the last
   * statement closes the region (`statement()`).
   */
  private statements(
    statements: readonly Expression[],
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    // The names that the code after the statement `i` can read: the names
    // in the statements after it, and `liveOut`. A name that a later
    // statement writes before it reads it counts too: the set is larger
    // than needed, never smaller.
    const live: ReadonlySet<string>[] = [];
    let after = new Set(liveOut);
    for (let i = statements.length - 1; i >= 0; i--) {
      live[i] = after;
      after = new Set([...after, ...this.namesOf(statements[i])]);
    }
    let closed = false;
    statements.forEach((s, i) => {
      if (closed) fail('a statement follows a Break');
      closed = this.statement(s, scope, operations, live[i]);
    });
    return closed;
  }

  /**
   * A statement: a `Declare` binds its local to the value of its
   * initializer (`Declare(t, type, value)`, or `Declare(t, {value: …})`,
   * the form of a `let`); an `Assign` gives the local a new value; an `If`
   * statement merges the values of the locals that its branches write; a
   * `Loop` carries the values of the locals that its body writes
   * (`loopStatement()`); a `Block` (a branch of an `If`, the body of a
   * `Loop`) is its statements; a `Break` is an `exit` of the innermost loop.
   * The admission of the structured route admits no other statement.
   *
   * True when the statement closes the region: a `Break`, an `If` whose two
   * branches close, or a `Block` whose last statement closes.
   */
  private statement(
    node: Expression,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    const initializer = isFunction(node, 'Declare')
      ? declareValueOperand(node.ops)
      : undefined;
    if (
      isFunction(node, 'Declare') &&
      initializer !== undefined &&
      isSymbol(node.op1)
    ) {
      const name = node.op1.symbol;
      const binding = scope.bindings.get(name);
      if (binding === undefined || !('representation' in binding))
        return fail(`the local ${name} has no binding`);
      const value = this.toLocal(
        this.value(initializer, scope, operations),
        binding,
        name,
        node,
        operations
      );
      let locals = this.bound.get(scope);
      if (locals === undefined) this.bound.set(scope, (locals = new Map()));
      locals.set(name, value);
      this.wrote(scope);
      this.changed();
      return false;
    }
    if (isFunction(node, 'Assign') && node.nops === 2 && isSymbol(node.op1)) {
      const name = node.op1.symbol;
      const written = this.value(node.op2, scope, operations);
      const binder = bindingScope(scope, name);
      const locals = binder === undefined ? undefined : this.bound.get(binder);
      const binding = binder?.bindings.get(name);
      // The admission and the pass refuse a write to a name that is not a
      // local; an input of the program is bound in the root scope. A local
      // can have no value before the write: a local that a loop body writes
      // and does not carry (`loopStatement()`).
      if (
        locals === undefined ||
        binder === this.prep.annotation.scope ||
        binding === undefined
      )
        return fail(`the name ${name} is not a declared local`);
      if (!('representation' in binding))
        return fail(`the local ${name} has no representation`);
      locals.set(
        name,
        this.toLocal(written, binding, name, node, operations)
      );
      this.wrote(binder!);
      this.changed();
      return false;
    }
    if (isFunction(node, 'If') && (node.nops === 2 || node.nops === 3))
      return this.ifStatement(node, scope, operations, liveOut);
    if (isFunction(node, 'Loop') && node.nops === 2) {
      this.loopStatement(node, scope, operations, liveOut);
      return false;
    }
    if (isFunction(node, 'Block')) {
      const inner = scope.inner.get(node);
      if (inner === undefined) return fail('no scope for a block');
      return this.statements(node.ops, inner, operations, liveOut);
    }
    if (isFunction(node, 'Break') && node.nops === 0) {
      const loop = this.loops[this.loops.length - 1];
      if (loop === undefined) return fail('a Break outside a loop');
      const operands = loop.carried.map(
        ({ binder, name }) =>
          this.bound.get(binder)?.get(name) ??
          fail(`the carried local ${name} has no value at a Break`)
      );
      loop.exits.push(operands);
      operations.push({ kind: 'exit', operands, effect: 'pure', origin: node });
      return true;
    }
    return fail(`no lowering for the statement ${nodeText(node)}`);
  }

  /** Whether the body of each function of the program can throw
   *  (`canThrow()`), by index. */
  private readonly throwingBodies = new Map<number, boolean>();

  /** `canThrow()` of `op` in this program: a call throws when the body of
   *  its function can throw. Recursion is refused, so the walk ends. */
  private readonly canThrow = (op: IROperation): boolean =>
    canThrow(op, (i) => {
      let known = this.throwingBodies.get(i);
      if (known === undefined) {
        const fn = this.functions[i];
        if (fn === undefined) return fail(`no function ${i} for a call`);
        known = fn.body.operations.some(this.canThrow);
        this.throwingBodies.set(i, known);
      }
      return known;
    });

  /**
   * The value `value` written to the local `name` (a `Declare` or an
   * `Assign`, `node`), as a value of the type of the local (`binding`):
   * the pass gives a local its declared type and admits a write only when a
   * conversion reads the value as that type. An integer written to a real
   * local and a list of integers written to a list of reals are the same
   * JavaScript value, as in the existing emitter (`let t = 1`): an identity
   * conversion (`integer-to-real`, `integer-list-to-real-list`) gives the
   * value the type of the local, with no code. The admission and the pass
   * refuse every other write of a value of another type
   * (`checkLocalWrites()`, `structuredLocalType()`).
   */
  private toLocal(
    value: IRValue,
    binding: FragmentValueFacts<ScalarRepresentation>,
    name: string,
    node: Expression,
    operations: IROperation[]
  ): IRValue {
    const type = valueType(binding.type);
    if (value.type === type && value.representation === binding.representation) {
      this.localValues.add(value.id);
      return value;
    }
    const conversion =
      value.type === 'integer' && type === 'real'
        ? 'integer-to-real'
        : value.type === 'list<integer>' && type === 'list<real>'
          ? 'integer-list-to-real-list'
          : undefined;
    if (conversion === undefined)
      return fail(
        `a value of the type ${value.type} is written to the local ${name} of the type ${type}`
      );
    const result = this.newValue(type, binding.representation);
    operations.push({
      kind: 'convert',
      conversion,
      result,
      operands: [value],
      effect: 'pure',
      origin: node,
    });
    this.localValues.add(result.id);
    return result;
  }

  /**
   * An `If` statement: an `if` whose results are the merged values of the
   * locals that a branch writes and that `liveOut` names, in the order of
   * their bindings. The `If` itself has no effect: its effect is the one
   * of its regions. A write to a local is not an effect: it makes a value.
   *
   * A branch that ends in `Break` is closed: the values of the locals after
   * the `If` are those of the other branch, and the closed branch yields
   * nothing. When both branches are closed, the `if` has no result and
   * closes the region (true).
   */
  private ifStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): boolean {
    // The operations of the condition, kept apart until the `If` is known
    // to be lowered. Their region is not open in the branches nor after the
    // `If`: the values that it remembers are not shared.
    const condition: IROperation[] = [];
    const test = this.inRegion(condition, () =>
      this.value(node.ops[0], scope, condition)
    );
    const before = this.snapshot();
    const branch = (statement: Expression | undefined) => {
      this.restore(before);
      const inner: IROperation[] = [];
      const closed =
        statement !== undefined &&
        this.inRegion(inner, () =>
          this.statement(statement, scope, inner, liveOut)
        );
      return { operations: inner, values: this.snapshot(), closed };
    };
    const a = branch(node.ops[1]);
    const b = branch(node.ops[2]);
    this.restore(before);
    if (a.closed && b.closed) {
      const then = this.closedRegion(a.operations);
      const otherwise = this.closedRegion(b.operations);
      for (const op of condition) operations.push(op);
      operations.push({
        kind: 'if',
        results: [],
        operands: [test],
        then,
        else: otherwise,
        effect: joinEffects(then.effect, otherwise.effect),
        ...touchesField(then.touches, otherwise.touches),
        origin: node,
      });
      return true;
    }
    // The values after the `If` of each branch: those of the other branch
    // for a closed branch, which does not reach the code after the `If`.
    const thenValues = a.closed ? b.values : a.values;
    const elseValues = b.closed ? a.values : b.values;
    // The locals to merge, with their values before the `If` and in each
    // branch.
    const merged: {
      locals: Map<string, IRValue>;
      name: string;
      then: IRValue;
      else: IRValue;
    }[] = [];
    // The names of each scope that has values before the `If`: a name with
    // no value before it (a local that a loop body writes and does not
    // carry, `loopStatement()`) has a value after it when both branches
    // write it. A scope that a branch opens is not visible after the `If`.
    for (const [binder, locals] of before)
      for (const name of new Set([
        ...locals.keys(),
        ...(thenValues.get(binder)?.keys() ?? []),
        ...(elseValues.get(binder)?.keys() ?? []),
      ])) {
        const value = locals.get(name);
        const then = thenValues.get(binder)?.get(name);
        const otherwise = elseValues.get(binder)?.get(name);
        if (then === value && otherwise === value) continue;
        const target = this.bound.get(binder)!;
        this.wrote(binder);
        // A local that no later statement reads has no value after the
        // `If`: a read of it throws. A local with no value after a branch
        // is such a local: a nested `If` of the branch removed it, and its
        // later statements are the ones of this `If`.
        if (then === undefined || otherwise === undefined || !liveOut.has(name))
          target.delete(name);
        else merged.push({ locals: target, name, then, else: otherwise });
      }
    // The merged value has the type of both branches, or is `real` for an
    // integer and a real value (a list of reals for a list of integers and
    // a list of reals).
    const results = merged.map((m) => {
      const type =
        widerType(m.then.type, m.else.type) ??
        fail(
          `the local ${m.name} has the type ${m.then.type} in one branch and ${m.else.type} in the other`
        );
      return this.newValue(type, m.then.representation as ScalarRepresentation);
    });
    merged.forEach((m, i) => m.locals.set(m.name, results[i]));
    this.changed();
    const then = a.closed
      ? this.closedRegion(a.operations)
      : this.region(
          a.operations,
          node.ops[1],
          merged.map((m) => m.then)
        );
    const otherwise = b.closed
      ? this.closedRegion(b.operations)
      : this.region(
          b.operations,
          node.ops[2] ?? node,
          merged.map((m) => m.else)
        );
    // An `If` with no result and no effect has nothing to give: it is
    // not lowered, and its condition is lowered only when it has an effect
    // (with the pure operations that the effect reads). A branch that can
    // abort (a loop with an iteration budget) keeps the `If`, and so does a
    // branch that holds an `exit`, at any depth: the exit decides which
    // operations run after the `If`. An operation whose code can throw
    // (`canThrow()`), in a branch or in the condition, keeps the `If` too:
    // such an operation is `pure` and touches no state, so the effect
    // facts would let the `If` go, but the existing emitter evaluates the
    // statement and throws there.
    if (
      exitsIn(then).length === 0 &&
      exitsIn(otherwise).length === 0 &&
      results.length === 0 &&
      joinEffects(then.effect, otherwise.effect) === 'pure' &&
      then.canAbort !== true &&
      otherwise.canAbort !== true &&
      !condition.some(this.canThrow) &&
      !then.operations.some(this.canThrow) &&
      !otherwise.operations.some(this.canThrow)
    ) {
      if (condition.some((op) => op.effect !== 'pure'))
        for (const op of condition) operations.push(op);
      return false;
    }
    // A loop, not a spread: the condition can hold more operations than a
    // call takes arguments.
    for (const op of condition) operations.push(op);
    operations.push({
      kind: 'if',
      results,
      operands: [test],
      then,
      else: otherwise,
      effect: joinEffects(then.effect, otherwise.effect),
      ...touchesField(then.touches, otherwise.touches),
      origin: node,
    });
    return false;
  }

  /**
   * A `Loop` statement over `Element(k, Range(a, b))`, which the admission
   * of the structured route checked: a `loop` whose operands are the values
   * of `a` and `b`, evaluated here, before the loop, and the value before
   * the loop of each carried local.
   *
   * The carried locals are the locals declared outside the loop that the
   * body writes, and that `liveOut` names or that the body reads before it
   * writes them in an iteration (`exposedReads()`), in the order of their
   * bindings. The parameter of a carried local has the type of its value
   * before the loop; when the body yields a real value for an integer
   * parameter, the body is lowered again with a real parameter, as the two
   * values of an `If` merge to `real`, until no parameter changes (each
   * pass but the last makes at least one more parameter real, so there are
   * at most one pass per carried local, and one more). A local that the body writes and
   * does not carry has no value at the start of the body and after the
   * loop. The index is bound in the scope of the loop.
   *
   * A `Break` of the body passes the current value of each carried local to
   * the result of the loop (an `exit`); a real value there makes the
   * parameter real too, as a real next value does. A body that always
   * exits throws: the admission refuses it.
   */
  private loopStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
    const [body, spec] = node.ops;
    const loopScope = scope.inner.get(node);
    if (
      loopScope === undefined ||
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return fail(`no lowering for the loop ${nodeText(node)}`);
    const index = spec.op1.symbol;
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${nodeText(b)} of a loop is not an integer`);
      return value;
    };
    const from = bound(spec.op2.op1);
    const to = bound(spec.op2.op2);

    // The locals of the scopes around the loop that the body writes.
    const written = assignedNames(body);
    const candidates: {
      binder: FragmentScope<ScalarRepresentation>;
      name: string;
    }[] = [];
    for (const name of written) {
      const binder = bindingScope(scope, name);
      if (binder !== undefined && this.bound.get(binder)?.has(name))
        candidates.push({ binder, name });
    }
    const exposed = exposedReads(body, this.names);
    const carried = candidates.filter(
      ({ name }) => liveOut.has(name) || exposed.has(name)
    );
    const initial = carried.map(({ binder, name }) =>
      this.bound.get(binder)!.get(name)!
    );
    const carriedNames = new Set(carried.map((c) => c.name));

    const before = this.snapshot();
    let types = initial.map((v) => v.type);
    for (let pass = 0; ; pass++) {
      this.restore(before);
      const indexValue = this.newValue('integer', 'number');
      const parameters = carried.map((c, i) =>
        this.newValue(
          types[i],
          initial[i].representation as ScalarRepresentation
        )
      );
      for (const { binder, name } of candidates) {
        this.bound.get(binder)!.delete(name);
        this.wrote(binder);
      }
      carried.forEach(({ binder, name }, i) =>
        this.bound.get(binder)!.set(name, parameters[i])
      );
      this.bound.set(loopScope, new Map([[index, indexValue]]));
      this.wrote(loopScope);
      this.changed();
      const inner: IROperation[] = [];
      const context = { carried, exits: [] as (readonly IRValue[])[] };
      this.loops.push(context);
      let closed: boolean;
      try {
        closed = this.inRegion(inner, () =>
          this.statement(body, loopScope, inner, carriedNames)
        );
      } finally {
        this.loops.pop();
      }
      if (closed) fail('the body of a loop always exits');
      const next = carried.map(({ binder, name }) => {
        const value = this.bound.get(binder)?.get(name);
        if (value === undefined)
          return fail(
            `the carried local ${name} has no value at the end of the loop body`
          );
        return value;
      });
      // A real next value of an integer parameter: lower the body again
      // with a real parameter. A parameter that is real is never changed.
      const widened = next.map((v, i) =>
        [v, ...context.exits.map((exit) => exit[i])].reduce<ValueType>(
          (type, value) =>
            widerType(type, value.type) ??
            fail(
              `the carried local ${carried[i].name} has the type ${types[i]} before the loop and ${value.type} in its body`
            ),
          types[i]
        )
      );
      if (widened.some((t, i) => t !== types[i])) {
        if (pass >= carried.length)
          fail('the types of the carried locals of a loop do not settle');
        types = widened;
        continue;
      }
      const region: IRRegion = {
        ...this.region(inner, body, next),
        parameters: [indexValue, ...parameters],
      };
      this.restore(before);
      const results = parameters.map((p) =>
        this.newValue(p.type, p.representation as ScalarRepresentation)
      );
      for (const { binder, name } of candidates) {
        this.bound.get(binder)!.delete(name);
        this.wrote(binder);
      }
      carried.forEach(({ binder, name }, i) =>
        this.bound.get(binder)!.set(name, results[i])
      );
      this.changed();
      operations.push({
        kind: 'loop',
        results,
        operands: [from, to, ...initial],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        iterationBudget: this.prep.iterationBudget,
        origin: node,
      });
      return;
    }
  }

  /** The value of each local and parameter, copied. */
  private snapshot(): Map<
    FragmentScope<ScalarRepresentation>,
    Map<string, IRValue>
  > {
    return new Map(
      [...this.bound].map(([scope, locals]) => [scope, new Map(locals)])
    );
  }

  /** Make the values of `snapshot` the values of the locals again. A
   *  scope that has no values in `snapshot` has none after. */
  private restore(
    snapshot: ReadonlyMap<
      FragmentScope<ScalarRepresentation>,
      ReadonlyMap<string, IRValue>
    >
  ): void {
    this.bound.clear();
    for (const [scope, locals] of snapshot)
      this.bound.set(scope, new Map(locals));
    this.changed();
  }

  /**
   * The index of the function of the helper `name`, lowered once, at its
   * first call, whatever the number of its calls. A call in its body of
   * another helper lowers that helper first, so a function of the program
   * calls only functions of a lower index. Its parameters have the types
   * and representations that the conversions of the call record (the
   * admission requires identity conversions), and its result the
   * representation of the call. A helper that calls itself, directly or
   * through other helpers, throws: the admission refuses it.
   */
  private helper(
    name: string,
    args: readonly IRValue[],
    facts: FragmentValueFacts<ScalarRepresentation>,
    node: Expression
  ): number {
    const known = this.functionIndex.get(name);
    if (known !== undefined) return known;
    if (this.lowering.has(name)) return fail(`the helper ${name} calls itself`);
    const entry = this.prep.annotation.functions.get(name)!;
    if (
      entry.type.kind !== 'function' ||
      entry.body !== this.prep.helpers.get(name)?.body
    )
      return fail(`the helper ${name} has no function facts`);
    const conversions = facts.conversions ?? [];
    if (
      conversions.length !== args.length ||
      entry.type.parameters.length !== args.length
    )
      fail(`a call of ${name} does not match its parameters`);
    const parameters = entry.type.parameters.map((p, i) =>
      this.newValue(valueType(p.type), conversions[i].representation)
    );
    const names = entry.type.parameters.map((p) => p.name);
    const operations: IROperation[] = [];
    this.lowering.add(name);
    // A `Break` of the helper leaves a loop of the helper, never a loop of
    // the code that calls it, and a value of the code that calls it is not
    // visible in the body: the body starts with its own region alone. The
    // body binds the names of its own scopes (a function scope has the root
    // scope as its parent), so the values that the caller remembers stay
    // valid (`inScope()`).
    const loops = this.loops;
    const regions = this.regions;
    this.loops = [];
    this.regions = [];
    let value: IRValue;
    try {
      value = this.inScope(entry.scope, () => {
        this.bound.set(
          entry.scope,
          new Map(names.map((n, i) => [n, parameters[i]]))
        );
        this.wrote(entry.scope);
        this.changed();
        return this.inRegion(operations, () =>
          this.value(entry.body, entry.scope, operations)
        );
      });
    } finally {
      this.loops = loops;
      this.regions = regions;
    }
    this.lowering.delete(name);
    const result = {
      type: valueType(entry.type.result),
      representation: facts.representation,
    };
    if (value.representation !== result.representation)
      fail(
        `the body of ${name} does not have the representation of its result`
      );
    const labels = this.prep.helpers.get(name)!.parameterElementLabels;
    this.functions.push({
      name,
      parameters,
      ...(labels?.some((l) => l !== undefined)
        ? { parameterElementLabels: labels }
        : {}),
      result,
      body: this.region(operations, entry.body, value),
      origin: node,
    });
    this.functionIndex.set(name, this.functions.length - 1);
    return this.functions.length - 1;
  }
}

/** Whether the code of `op`, or of an operation of a region that it
 *  evaluates, or of the body of a function that it calls, can throw on
 *  JavaScript: `mod` (`_SYS.floorMod` throws for an operand beyond the safe
 *  integer range) and `replace-at` (`_SYS.replaceAt` throws for an index
 *  out of range), and `host`, a function of the host, which can throw and
 *  whose calls the host can count, also when it is declared pure. A throw
 *  is not an effect, so the lowering keeps such an operation where the
 *  existing emitter evaluates it (`ifStatement()`).
 *  `bodyThrows` answers for the function of index `i` of the program (a
 *  called function is lowered before its call). */
function canThrow(
  op: IROperation,
  bodyThrows: (i: number) => boolean
): boolean {
  return (
    op.kind === 'mod' ||
    op.kind === 'replace-at' ||
    op.kind === 'host' ||
    (op.kind === 'call' && bodyThrows(op.function)) ||
    regionsOf(op).some((region) =>
      region.operations.some((inner) => canThrow(inner, bodyThrows))
    )
  );
}

/** The index of the exact rational factor `1/d` of the product `node`
 *  that `multiplyByRational()` divides by (its first factor that
 *  `exactRationalDivisor()` accepts), when its numerator is 1; otherwise
 *  `undefined`. The existing emitter writes such a product `a / d`, with no
 *  multiplication by the numerator. */
function unitRationalFactor(
  node: Expression & { ops: readonly Expression[] }
): number | undefined {
  const index = node.ops.findIndex(
    (op) => exactRationalDivisor(op) !== undefined
  );
  if (index < 0 || exactRationalDivisor(node.ops[index])!.p !== 1)
    return undefined;
  return index;
}

/** The type that holds a value of the type `a` and a value of the type
 *  `b`: the type of both, `real` for an integer and a real, a list of reals
 *  for a list of integers and a list of reals; otherwise `undefined`. */
function widerType(a: ValueType, b: ValueType): ValueType | undefined {
  if (a === b) return a;
  const pair = new Set([a, b]);
  if (pair.has('integer') && pair.has('real')) return 'real';
  if (pair.has('list<integer>') && pair.has('list<real>')) return 'list<real>';
  return undefined;
}

/** Every node that has facts in `scope` or in a scope nested in it, and
 *  every statement that the pass checked there. */
function collectOrigins(
  scope: FragmentScope<ScalarRepresentation>,
  origins: Set<Expression>
): void {
  for (const node of scope.facts.keys()) origins.add(node);
  for (const node of scope.statements) origins.add(node);
  for (const inner of scope.inner.values()) collectOrigins(inner, origins);
}

/** The scope that binds `name`, from `scope` outward. */
function bindingScope(
  scope: FragmentScope<ScalarRepresentation>,
  name: string
): FragmentScope<ScalarRepresentation> | undefined {
  for (
    let s: FragmentScope<ScalarRepresentation> | undefined = scope;
    s;
    s = s.parent
  )
    if (s.bindings.has(name)) return s;
  return undefined;
}

/** The names that an `Assign` of `statement` writes, in a nested block,
 *  branch or loop too. */
function assignedNames(
  statement: Expression,
  names = new Set<string>()
): Set<string> {
  if (!isFunction(statement)) return names;
  if (statement.operator === 'Assign' && isSymbol(statement.op1))
    names.add(statement.op1.symbol);
  else if (statement.operator === 'Block' || statement.operator === 'If')
    for (const s of statement.ops) assignedNames(s, names);
  else if (statement.operator === 'Loop') assignedNames(statement.op1, names);
  return names;
}

/**
 * The names that `statement` can read before it writes them, when it runs
 * from its start: a read on a path where no earlier statement of the path
 * wrote the name. After an `If`, a name is written when both branches write
 * it; after a `Loop`, the names that its body writes are not written,
 * because the body can run no time. A read in the body of a nested `Loop`
 * counts when no statement before it in the body, nor before the loop,
 * writes the name. The admission of the structured route admits the
 * statements `Block`, `Declare`, `Assign`, `If` and `Loop`; any other node
 * is read as an expression.
 */
function exposedReads(
  statement: Expression,
  memo: Map<Expression, ReadonlySet<string>>
): Set<string> {
  const exposed = new Set<string>();
  const reads = (
    node: Expression | undefined,
    written: ReadonlySet<string>
  ) => {
    if (node === undefined) return;
    for (const name of namesIn(node, memo))
      if (!written.has(name)) exposed.add(name);
  };
  const visit = (node: Expression, written: Set<string>): Set<string> => {
    if (!isFunction(node)) {
      reads(node, written);
      return written;
    }
    switch (node.operator) {
      case 'Block':
        return node.ops.reduce((w, s) => visit(s, w), written);
      case 'Declare':
        reads(declareValueOperand(node.ops), written);
        return isSymbol(node.op1)
          ? new Set([...written, node.op1.symbol])
          : written;
      case 'Assign':
        reads(node.op2, written);
        return isSymbol(node.op1)
          ? new Set([...written, node.op1.symbol])
          : written;
      case 'If': {
        reads(node.op1, written);
        const a = visit(node.op2, new Set(written));
        const b = node.nops === 3 ? visit(node.op3, new Set(written)) : written;
        return new Set([...a].filter((name) => b.has(name)));
      }
      case 'Loop': {
        // The bounds, then the body, which can run no time.
        if (node.nops === 2) reads(node.op2, written);
        visit(node.op1, new Set(written));
        return written;
      }
      default:
        reads(node, written);
        return written;
    }
  };
  visit(statement, new Set());
  return exposed;
}

/**
 * The domain of the node `Random(…)` that the structured route admits, or
 * `undefined`. The parameters are those that the handler `Random` of the
 * existing emitter reads (`javascript-target.ts`), so the code computes the
 * same doubles:
 *
 * - `unit`: no operand, one draw `u` in `[0, 1)`.
 * - `interval`: `Interval(a, b)` whose endpoints are real number literals
 *   (an `Open` or `Closed` marker is ignored, as there), finite, with
 *   `b > a`: `a + u·w`, with the double `w = b - a` computed here, as the
 *   existing emitter writes `${start} + u * ${end - start}` (`interval()`).
 * - `range`: `Range(…)` of one to three real number literals, normalized
 *   as `literalRangeParams()` of the existing emitter does (one operand `n`
 *   is `Range(1, n)`; two operands have the step 1 or -1): `first +
 *   step·floor(u·n)` with `n` the number of elements (`rangeCount()`).
 *   `first` and `step` are safe integers, `n` a positive safe integer, so
 *   the result is an integer; another `Range` is not admitted.
 *
 * Every other operand (a domain with a symbol, a list, an empty or
 * unbounded domain, which the existing compiler refuses at compile time) is
 * not admitted. The rule of `Random` (`javascript-fragment-target.ts`) and
 * the lowering read the domain from this function, so they agree.
 */
export function randomDomainOf(node: Expression):
  | { readonly kind: 'unit' }
  | {
      readonly kind: 'interval';
      readonly start: number;
      readonly width: number;
    }
  | {
      readonly kind: 'range';
      readonly first: number;
      readonly step: number;
      readonly n: number;
    }
  | undefined {
  if (!isFunction(node, 'Random')) return undefined;
  if (node.nops === 0) return { kind: 'unit' };
  if (node.nops !== 1) return undefined;
  const domain = node.op1;
  const literal = (x: Expression): number | undefined =>
    isNumber(x) && x.im === 0 && Number.isFinite(x.re) ? x.re : undefined;
  if (isFunction(domain, 'Interval')) {
    if (domain.nops !== 2) return undefined;
    const endpoint = (x: Expression) =>
      isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x;
    if (
      literal(endpoint(domain.op1)) === undefined ||
      literal(endpoint(domain.op2)) === undefined
    )
      return undefined;
    const bounds = interval(domain);
    if (
      bounds === undefined ||
      !Number.isFinite(bounds.start) ||
      !Number.isFinite(bounds.end) ||
      !(bounds.end > bounds.start)
    )
      return undefined;
    return {
      kind: 'interval',
      start: bounds.start,
      width: bounds.end - bounds.start,
    };
  }
  if (isFunction(domain, 'Range')) {
    const ops = domain.ops;
    if (ops.length === 0 || ops.length > 3) return undefined;
    const values = ops.map(literal);
    if (values.some((v) => v === undefined)) return undefined;
    const [first, upper, step] =
      values.length === 1
        ? [1, values[0]!, 1]
        : [
            values[0]!,
            values[1]!,
            values.length > 2 ? values[2]! : values[1]! >= values[0]! ? 1 : -1,
          ];
    const n = rangeCount(first, upper, step);
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(step) ||
      !Number.isSafeInteger(n) ||
      n <= 0 ||
      !Number.isSafeInteger(first + step * (n - 1))
    )
      return undefined;
    return { kind: 'range', first, step, n };
  }
  return undefined;
}

/**
 * The literal seed of the seed operand `seed` of `WithRandomSeed`: a
 * string, or a finite real number literal (its double), or `undefined` for
 * a seed that is evaluated (`IRSeeded`).
 */
export function literalSeedOf(seed: Expression): number | string | undefined {
  if (isString(seed)) return seed.string;
  if (isNumber(seed) && seed.im === 0 && Number.isFinite(seed.re))
    return seed.re;
  return undefined;
}

/** The names of the symbols of `node`, read or written. `memo` holds the
 *  names of each function node already seen, so a node reached on several
 *  paths is walked once. */
function namesIn(
  node: Expression,
  memo: Map<Expression, ReadonlySet<string>>
): ReadonlySet<string> {
  if (isSymbol(node)) return new Set([node.symbol]);
  if (!isFunction(node)) return new Set();
  const known = memo.get(node);
  if (known !== undefined) return known;
  const names = new Set<string>();
  for (const operand of node.ops)
    for (const name of namesIn(operand, memo)) names.add(name);
  memo.set(node, names);
  return names;
}
