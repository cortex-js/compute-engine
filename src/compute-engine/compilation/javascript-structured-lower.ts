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
import { booleanClaim } from './compile-conditions.js';
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
  elementOf,
  exitsIn,
  isListType,
  isTupleType,
  joinEffects,
  listType,
  tupleType,
  operationCanAbort,
  reachesHost,
  regionsOf,
  definedValues,
  touchesField,
  type EffectFact,
  type IRCapture,
  type IRConstant,
  type IRFunction,
  type IRHostBinding,
  type IRInput,
  type IROperation,
  type IRProgram,
  type IRRegion,
  type IRState,
  type IRValue,
  type CollectionFunctionName,
  type ListType,
  type ScalarKind,
  type TupleType,
  type ValueType,
  type BinaryFunctionName,
  type UnaryFunctionName,
} from './structured-ir.js';
import {
  JAVASCRIPT_POLICY,
  verifyJavaScriptProgram,
} from './javascript-structured-policy.js';
import { withOwnedCopies } from './structured-in-place.js';
import { isShadowedSymbol } from '../library-shadowing.js';
import { isLibraryOperator } from './builtin-callback.js';
import { unrollFits, unrolledTermSize } from './unroll-budget.js';
import {
  UNROLL_LIMIT,
  UNROLL_STATEMENT_MIN_TERMS,
} from './javascript-target.js';

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
 * - `{ selected }`: an `If` or a `Which` used as a value whose constant
 *   conditions select the branch `selected` (`decidedBranch()`), written as
 *   that branch: the conditions and the other branches have no operation.
 * - `RealCallForm`: a library head that the existing emitter writes as
 *   calls of real kernels (`realCallRule()` in
 *   `javascript-fragment-target.ts`).
 */
export type StructuredForm =
  | { readonly folded: number | { readonly re: number; readonly im: number } }
  | { readonly selected: Expression }
  | RealCallForm
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
  | 'abs-identity'
  | 'chain-swap'
  | 'mod-one';

/**
 * The lowering of a head of `realCallRule()` (`javascript-fragment-target.ts`),
 * whose operands the rule admitted with real or integer facts, as the
 * existing emitter writes it:
 *
 * - `{ call }`: the function `call` of the operands, with the number literal
 *   `before` as a first operand and `after` as a last one when they are
 *   given (`_SYS.agm(1, x)` for `AGM(x)`, `_SYS.chop(x, 1e-10)` for
 *   `Chop(x)`).
 * - `{ fold }`: the function `fold` of the first two operands, then of that
 *   value and each next operand, as `reduce` computes it
 *   (`((_a) => _a.reduce((_x, _y) => _SYS.gcd(_x, _y)))([a, b, c])`).
 * - `kronecker-delta`: `1` when the operands are equal (`===`), or when the
 *   one operand is `0`, else `0`: the conditional of the `equal` of the
 *   operands, or of the chain of adjacent pairs for three operands or more.
 * - `clamp`: `Math.min(Math.max(x, lo), hi)`, the operations `max` and
 *   `min`.
 * - `boole`: `1` when the boolean operand holds, else `0`.
 * - `argument`: `Argument` of a real operand, `Math.atan2(0, x + 0)`: the
 *   sum makes `-0` into `0`.
 * - `imaginary`: `Imaginary` of a real operand, the integer literal `0`; the
 *   operand has no operation.
 */
export type RealCallForm =
  | {
      readonly call: UnaryFunctionName | BinaryFunctionName;
      readonly before?: number;
      readonly after?: number;
    }
  | { readonly fold: BinaryFunctionName }
  | 'kronecker-delta'
  | 'clamp'
  | 'boole'
  | 'argument'
  | 'imaginary';

const REAL_CALL_FORMS: ReadonlySet<string> = new Set([
  'kronecker-delta',
  'clamp',
  'boole',
  'argument',
  'imaginary',
]);

/**
 * The branch of the library `If` or `Which` `node` that its constant
 * conditions select, or `undefined`. A pure condition whose type is the
 * value `true` or `false` (`booleanClaim()`) is decided at compile time: the
 * existing emitter writes the branch that it selects, and no test, the
 * condition and the other branches have no code (`liveSelectionArms()` in
 * `compile-conditions.ts`). `If(c, a, b)` with such a condition is `a` or
 * `b`; the symbol `True` has the type `boolean`, so `If(True, x, y)` keeps
 * its test there, and here. A `Which` is its first value whose condition
 * holds when each condition before it is `false`: a condition `true` or
 * the symbol `True`, as the existing compiler reads a clause
 * (`compileExprWhich()` and `liveSelectionArms()`); the symbol `False` is not
 * decided.
 * An `If(c, v)` whose condition is `false`, a `Which` whose clauses all
 * have a `false` condition, and a `Which` with a condition that is not
 * constant before the selected clause have no selected branch.
 *
 * A condition that names a parameter, a local or an index (`bound`) is not
 * constant: the engine types such a name from the definition of an engine
 * symbol of the same name, so that with `n := 5`, the condition `n < 3` of
 * `Function(If(n < 3, 1, 2), n)` has the type `false`.
 */
export function decidedBranch(
  node: Expression,
  bound: (name: string) => boolean = () => false
): Expression | undefined {
  if (!isFunction(node)) return undefined;
  const claimOf = (
    condition: Expression,
    clause: boolean
  ): boolean | undefined =>
    clause && isSymbol(condition, 'True')
      ? true
      : (isSymbol(condition) && bound(condition.symbol)) ||
          (isFunction(condition) && condition.symbols.some(bound))
        ? undefined
        : booleanClaim(condition);
  if (node.operator === 'If' && isLibraryOperator(node, 'If')) {
    if (node.nops !== 2 && node.nops !== 3) return undefined;
    const claim = claimOf(node.op1, false);
    if (claim === undefined) return undefined;
    return claim ? node.op2 : node.nops === 3 ? node.op3 : undefined;
  }
  if (node.operator !== 'Which' || !isLibraryOperator(node, 'Which'))
    return undefined;
  const ops = node.ops;
  for (let i = 0; i + 1 < ops.length; i += 2) {
    const claim = claimOf(ops[i], true);
    if (claim === undefined) return undefined;
    if (claim) return ops[i + 1];
  }
  return undefined;
}

/** Whether the form `form` is a `RealCallForm`. */
export function isRealCallForm(
  form: StructuredForm | undefined
): form is RealCallForm {
  if (form === undefined) return false;
  if (typeof form === 'string') return REAL_CALL_FORMS.has(form);
  return 'call' in form || 'fold' in form;
}

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
  /** The value of the binding at the admission: a number, or `undefined`
   *  for a list (`stored`). */
  readonly value: number | undefined;
  /** The value that the admission typed in place of each read: a number
   *  literal, or a list literal of finite real number literals, which the
   *  lowering writes as a new array at each call (`captureRead()`). */
  readonly stored: Expression;
  /** Throw when the binding or its value changed after the admission. */
  readonly assertCurrent: () => void;
};

/**
 * A definite `Integrate` node with no closed form, as the admission read it
 * (`integralParts()` in `javascript-fragment-target.ts`): the integrand as a
 * body in the variables of the clauses (a `Function` integrand unwrapped,
 * as `integrandLambda()` unwraps it), and the clauses, the first one
 * outermost. The annotation types the bounds of each clause with the
 * variables of the clauses before it, and the body with every variable, a
 * real, in the scope of the node.
 */
export type StructuredIntegral = {
  readonly clauses: readonly {
    /** The name of the variable. */
    readonly name: string;
    /** The symbol node of the variable, which the annotation binds. */
    readonly variable: Expression;
    readonly lower: Expression;
    readonly upper: Expression;
  }[];
  readonly body: Expression;
  /** The starting panel count of the node when it is the outermost
   *  integral of its body: `initialPanelsForDimensions()` of its clauses and
   *  of the deepest chain of `Integrate` nodes in its operands, as
   *  `compileIntegrate()` measures it. An integral in the body or in a bound
   *  of another one has the count of the outermost one. */
  readonly panels: number;
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
      /** A local function of the body: the arguments of each call after
       *  its operands, a symbol of each name that the function captures,
       *  lowered where the call is. */
      readonly captureArguments?: readonly Expression[];
    }
  >;
  /** The bindings that the program reads as snapshots, in the order of
   *  their admission. */
  readonly captures: readonly StructuredCapture[];
  /** The value of each node that the existing compiler writes as a literal
   *  with `constantFold: false`: a function whose result jumps at a point,
   *  of closed exact operands (`closedJumpFold()` in
   *  `javascript-fragment-target.ts`). The lowering writes the literal and
   *  no operand. */
  readonly folds?: ReadonlyMap<Expression, number | boolean>;
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
  /** The expression that replaces each `Integrate`, `D`, `ND` and
   *  `Derivative` node, and each `Apply` of a `Derivative`, of the program:
   *  its closed form, as the existing compiler writes it
   *  (`closedFormReplacement()` in `javascript-fragment-target.ts`). The
   *  annotation typed it in the place of the node, and the node is lowered
   *  as it. */
  readonly closedForms?: ReadonlyMap<Expression, Expression>;
  /** Each definite `Integrate` node of the program with no closed form,
   *  which the existing compiler integrates numerically (`integral()`). */
  readonly integrals?: ReadonlyMap<Expression, StructuredIntegral>;
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
  Arccot: { kind: 'unary', fn: 'acot' },
  Arccsc: { kind: 'unary', fn: 'acsc' },
  Arcsec: { kind: 'unary', fn: 'asec' },
  Arcoth: { kind: 'unary', fn: 'acoth' },
  Arsech: { kind: 'unary', fn: 'asech' },
  Arcsch: { kind: 'unary', fn: 'acsch' },
  Coth: { kind: 'unary', fn: 'coth' },
  Sech: { kind: 'unary', fn: 'sech' },
  Csch: { kind: 'unary', fn: 'csch' },
  Factorial: { kind: 'unary', fn: 'factorial' },
  Factorial2: { kind: 'unary', fn: 'factorial2' },
  Truncate: { kind: 'unary', fn: 'trunc' },
  Fract: { kind: 'unary', fn: 'fract' },
  Hypot: { kind: 'binary', fn: 'hypot' },
};

/** The heads of the functions of lists of the structured route
 *  (`collectionRule()`), each with the operation of the lowering. */
export const COLLECTION_HEADS: Readonly<
  Record<string, CollectionFunctionName | 'at' | 'length'>
> = {
  Norm: 'norm',
  Mean: 'mean',
  Median: 'median',
  Variance: 'variance',
  Dot: 'dot',
  Take: 'take',
  Drop: 'drop',
  Rest: 'drop',
  Reverse: 'reverse',
  Sort: 'sort',
  Join: 'join',
  ListJoin: 'join',
  First: 'at',
  Last: 'at',
  Count: 'length',
  Range: 'range',
  RotateLeft: 'rotate-left',
  RotateRight: 'rotate-right',
};

/** The heads that take a function operand on the structured route
 *  (`functionOperandRule()`), with the position of the function and the
 *  number of its parameters. `Apply` has one parameter per argument. */
export const FUNCTION_OPERAND_HEADS: Readonly<
  Record<string, { readonly fn: number; readonly arity?: number }>
> = {
  Map: { fn: 0, arity: 1 },
  Filter: { fn: 1, arity: 1 },
  Count: { fn: 1, arity: 1 },
  Reduce: { fn: 1, arity: 2 },
  Scan: { fn: 1, arity: 2 },
  Apply: { fn: 0 },
};

/** The function literal that the admission made for the function operand
 *  of each head node whose function is a user function
 *  (`recordUserFunctionOperand()`), and the operand symbol of the call in
 *  its body. */
const USER_FUNCTION_OPERANDS = new WeakMap<Expression, Expression>();
const USER_FUNCTION_CALLS = new WeakMap<Expression, Expression>();

/**
 * Record `lambda`, `Function(f(p1, …), p1, …)`, as the function operand of
 * the head node `node` (`FUNCTION_OPERAND_HEADS`) whose function operand is
 * the symbol `symbol` of a user function `f`: the admission, the rule and the
 * lowering read the function as that literal (`functionOperandOf()`), so
 * each element is one call of the helper `f`, as the existing emitter calls
 * `_fn_f` once per element (`L.map((_x) => _f(_x))`). The admission makes the
 * literal, since it reads the engine (`userFunctionOperand()` in
 * `javascript-fragment-target.ts`).
 */
export function recordUserFunctionOperand(
  node: Expression,
  symbol: Expression,
  lambda: Expression,
  call: Expression
): void {
  USER_FUNCTION_OPERANDS.set(node, lambda);
  USER_FUNCTION_CALLS.set(call, symbol);
}

/** The function operand of the head node `node` (`FUNCTION_OPERAND_HEADS`):
 *  the literal that `recordUserFunctionOperand()` recorded for a user
 *  function, or the operand itself. */
export function functionOperandOf(
  node: Expression & { ops: readonly Expression[] }
): Expression | undefined {
  const recorded = USER_FUNCTION_OPERANDS.get(node);
  if (recorded !== undefined) return recorded;
  const position = Object.hasOwn(FUNCTION_OPERAND_HEADS, node.operator)
    ? FUNCTION_OPERAND_HEADS[node.operator]
    : undefined;
  return position === undefined ? undefined : node.ops[position.fn];
}

/** The operand symbol of `call` when `call` is the body of a literal that
 *  `recordUserFunctionOperand()` recorded, else `undefined`. */
export function userFunctionOperandSymbol(
  call: Expression
): Expression | undefined {
  return USER_FUNCTION_CALLS.get(call);
}

/**
 * The parameters and the body of the function literal `fn`
 * (`Function(Block(body), p1, …)`, or `Function(body, p1, …)`), with
 * `arity` parameters, and a body of one value; `undefined` for another
 * node. A parameter is a symbol, or `Typed(p, T)` with `T` one of
 * `integer`, `real` and `number` (the preparation of the existing compiler
 * types the parameter of a `Map` with the element type of its list):
 * `type` is then `T`; or with `T` a tuple type (the element type of a list
 * of tuples): `type` is `tuple`, and `tuple` the spelling of `T`, which the
 * rule of the head checks.
 */
export function functionOperandParts(
  fn: Expression,
  arity: number
):
  | {
      readonly parameters: readonly {
        readonly symbol: Expression & { symbol: string };
        readonly type?: 'integer' | 'real' | 'number' | 'tuple';
        readonly tuple?: string;
      }[];
      readonly body: Expression;
    }
  | undefined {
  if (
    !isFunction(fn, 'Function') ||
    !isLibraryOperator(fn, 'Function') ||
    fn.nops !== arity + 1
  )
    return undefined;
  const parameters: {
    symbol: Expression & { symbol: string };
    type?: 'integer' | 'real' | 'number' | 'tuple';
    tuple?: string;
  }[] = [];
  for (const p of fn.ops.slice(1)) {
    if (isSymbol(p)) {
      parameters.push({ symbol: p });
      continue;
    }
    if (!isFunction(p, 'Typed') || p.nops !== 2 || !isSymbol(p.op1))
      return undefined;
    const type = isString(p.op2) ? p.op2.string : undefined;
    const spelling = type?.replace(/^'(.*)'$/, '$1');
    if (spelling !== undefined && /^tuple<.*>$/.test(spelling)) {
      parameters.push({ symbol: p.op1, type: 'tuple', tuple: spelling });
      continue;
    }
    const declared =
      type === "'integer'" || type === 'integer'
        ? 'integer'
        : type === "'real'" || type === 'real'
          ? 'real'
          : type === "'number'" || type === 'number'
            ? 'number'
            : undefined;
    if (declared === undefined) return undefined;
    parameters.push({ symbol: p.op1, type: declared });
  }
  let body = fn.op1;
  if (isFunction(body, 'Block') && isLibraryOperator(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    body = body.op1;
  }
  return { parameters, body };
}

/**
 * The library operators that `Map(f, L)` admits as `f` on the structured
 * route, with the operation of each: the code of the function `_fn_F` that
 * the existing emitter writes for the operator in the `strict` mode
 * (`(_tv1) => Math.sin(_tv1)`, `(_tv1) => -_tv1`) is the code of that
 * operation of a number. `complex: true`: the same code in the `complex`
 * mode; every other operator is a complex function there
 * (`_SYS.cplx(_SYS.csin(_SYS.cplx(_tv1)))`), whose elements are `{re, im}`
 * objects. `trig`: a function of an angle, which the existing emitter
 * converts for `ce.angularUnit`; admitted in radians only.
 */
export const MAPPED_OPERATORS: Readonly<
  Record<
    string,
    {
      readonly kind: 'unary' | 'negate' | 'floor' | 'sqrt';
      readonly fn?: UnaryFunctionName;
      readonly complex?: true;
      readonly trig?: true;
    }
  >
> = {
  Sin: { kind: 'unary', fn: 'sin', trig: true },
  Cos: { kind: 'unary', fn: 'cos', trig: true },
  Tan: { kind: 'unary', fn: 'tan', trig: true },
  Sec: { kind: 'unary', fn: 'sec', trig: true },
  Cot: { kind: 'unary', fn: 'cot', trig: true },
  Arctan: { kind: 'unary', fn: 'atan', trig: true },
  Arcsin: { kind: 'unary', fn: 'asin', trig: true },
  Exp: { kind: 'unary', fn: 'exp' },
  Ln: { kind: 'unary', fn: 'ln' },
  Abs: { kind: 'unary', fn: 'abs' },
  Tanh: { kind: 'unary', fn: 'tanh' },
  Sinh: { kind: 'unary', fn: 'sinh' },
  Cosh: { kind: 'unary', fn: 'cosh' },
  Arsinh: { kind: 'unary', fn: 'asinh' },
  Sign: { kind: 'unary', fn: 'sign' },
  Erf: { kind: 'unary', fn: 'erf' },
  Erfc: { kind: 'unary', fn: 'erfc' },
  Gamma: { kind: 'unary', fn: 'gamma' },
  Factorial: { kind: 'unary', fn: 'factorial' },
  Factorial2: { kind: 'unary', fn: 'factorial2' },
  Truncate: { kind: 'unary', fn: 'trunc' },
  Coth: { kind: 'unary', fn: 'coth' },
  Arccot: { kind: 'unary', fn: 'acot', trig: true },
  Arcsch: { kind: 'unary', fn: 'acsch' },
  Sqrt: { kind: 'sqrt' },
  Negate: { kind: 'negate' },
  Floor: { kind: 'floor', complex: true },
};

/** The library operators that `Reduce(L, op)` and `Scan(L, op)` admit as
 *  `op`, with the operation of each: the combiner of the existing emitter
 *  (`(_a, _b) => _a + _b`, `Math.max(_a, _b)`; `builtinCombiner()` in
 *  `javascript-target.ts`). */
export const FOLD_OPERATORS: Readonly<
  Record<string, 'add' | 'multiply' | 'max' | 'min'>
> = { Add: 'add', Multiply: 'multiply', Max: 'max', Min: 'min' };

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

/** The shape of a fragment type that `valueType()` reads: a kind, the size
 *  of a point, and the element of a list, at every depth. */
type StructuredTypeShape = {
  readonly kind: string;
  readonly size?: number;
  readonly element?: StructuredTypeShape;
};

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

/** The type of a value: a scalar type, a list of reals, of integers or of
 *  tuples of reals, whatever its length, a list of such lists at every
 *  depth (a list of lists), or a tuple (a fragment point) of reals. Every
 *  other element fails, at every depth. */
export function valueType(type: {
  readonly kind: string;
  readonly element?: StructuredTypeShape;
  readonly size?: number;
}): ValueType {
  if (type.kind === 'point') {
    const size = type.size;
    if (size === undefined || !Number.isInteger(size) || size < 1)
      return fail(`a tuple type has the size ${String(size)}`);
    return tupleType(new Array<ScalarKind>(size).fill('real'));
  }
  if (type.kind !== 'list') return scalarKind(type);
  // A list of points is a list of tuples of reals.
  if (type.element?.kind === 'point')
    return listType(valueType(type.element) as TupleType);
  // A list of lists: the element type, checked at every depth.
  if (type.element?.kind === 'list')
    return listType(valueType(type.element) as ListType);
  const element =
    type.element === undefined ? undefined : scalarKind(type.element);
  if (element !== 'real' && element !== 'integer')
    return fail(
      `the list type of elements ${type.element?.kind} is not in the structured route`
    );
  return listType(element);
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

/** A program that the lowering finds outside the profile, for a reason that
 *  the admission cannot see (the operations of a node): the profile
 *  declines it with `'outside-profile'` and this message. */
export class StructuredDeclineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StructuredDeclineError';
  }
}

/** Lower the program that `preparation` describes, without verifying it:
 *  the caller verifies it (`lowerStructuredFragment()` does both). A loop
 *  that updates a list that the program does not own copies it once,
 *  before its first pass (`withOwnedCopies()`). */
export function lowerStructuredProgram(
  preparation: StructuredPreparation
): IRProgram {
  return withOwnedCopies(new Lowering(preparation).program());
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
  /** The lists that the program holds once (`capturedList()`). */
  private readonly constants: IRConstant[] = [];
  /** The index of each constant in `constants`, by its binding. */
  private readonly constantIndex = new Map<object, number>();
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
  /** The names that a call of the helper `operator` reads where it is
   *  called: the captured names of a local function
   *  (`StructuredPreparation.helpers`, `captureArguments`). */
  private readonly capturedNames = (operator: string): readonly string[] =>
    (this.prep.helpers.get(operator)?.captureArguments ?? []).map((a) =>
      isSymbol(a) ? a.symbol : ''
    );
  /** The names of each function node (`namesIn()`). */
  private readonly names = new Map<Expression, ReadonlySet<string>>();
  /** The ids of the values that a `Declare` or an `Assign` writes to a
   *  local (`toLocal()`, `IRProgram.localValues`). */
  private readonly localValues = new Set<number>();
  /** The panel count of the outermost integral being lowered in the
   *  current body (`integral()`), or none. A helper body starts with none:
   *  it measures its own integrals, as `compileIntegrate()` does. */
  private panels: number | undefined = undefined;

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
      ...(this.constants.length > 0 ? { constants: this.constants } : {}),
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
    return namesIn(
      node,
      this.names,
      this.capturedNames,
      this.prep.closedForms
    );
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
    const closedForm = this.prep.closedForms?.get(node);
    if (closedForm !== undefined)
      return this.value(closedForm, scope, operations);
    if (isFunction(node, 'Block')) return this.block(node, scope, operations);
    const facts = this.facts(node, scope);
    // A node that the existing compiler folds (`StructuredPreparation.folds`).
    const folded = this.prep.folds?.get(node);
    if (folded !== undefined) {
      const result = this.resultOf(facts);
      operations.push({
        kind: 'literal',
        value: folded,
        result,
        operands: [],
        effect: this.effect(node),
        origin: node,
      });
      return result;
    }
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

    // A list literal and a tuple: the operation `list` or `tuple` of the
    // elements, each evaluated once, in order.
    if (operator === 'List' || operator === 'Tuple') {
      const operands = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      operations.push({
        kind: operator === 'List' ? 'list' : 'tuple',
        result,
        operands,
        effect,
        origin: node,
      });
      return result;
    }

    // A fold of one list or tuple (`foldRule()` in
    // `javascript-fragment-target.ts`).
    if (
      (operator === 'Sum' ||
        operator === 'Product' ||
        operator === 'Max' ||
        operator === 'Min') &&
      node.nops === 1
    )
      return this.fold(node, facts, scope, operations, effect);

    // A head with a function operand (`functionOperandRule()` in
    // `javascript-fragment-target.ts`), and a function of lists
    // (`collectionRule()`). `Count(L)` is the length.
    if (
      Object.hasOwn(FUNCTION_OPERAND_HEADS, operator) &&
      !(operator === 'Count' && node.nops === 1)
    )
      return this.inScope(scope.inner.get(node), () =>
        this.functionOperand(node, facts, scope, operations)
      );
    if (Object.hasOwn(COLLECTION_HEADS, operator))
      return this.collection(node, facts, scope, operations);

    // The branch that the constant conditions select (`decidedBranch()`).
    const selected = this.prep.forms.get(node);
    if (typeof selected === 'object' && 'selected' in selected)
      return this.value(selected.selected, scope, operations);

    if (operator === 'Which' || (operator === 'If' && node.nops === 2))
      return this.selection(node, facts, scope, operations, effect);

    if (operator === 'Sum' || operator === 'Product')
      return this.inScope(scope.inner.get(node), () =>
        this.aggregate(node, facts, scope, operations)
      );

    // A definite integral with no closed form (`integral()`).
    const integral = this.prep.integrals?.get(node);
    if (integral !== undefined)
      return this.inScope(scope.inner.get(node), () =>
        this.integral(node, integral, facts, scope, operations)
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
      // The operands, then the captured names of a local function, each
      // with the conversion of its argument.
      const captured = this.prep.helpers.get(operator)!.captureArguments ?? [];
      const args = [
        ...this.operands(node, facts, scope, operations),
        ...captured.map((argument, j) =>
          this.convert(
            this.value(argument, scope, operations),
            facts.conversions?.[node.ops.length + j],
            node,
            operations
          )
        ),
      ];
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

    // An operator of a list operand, applied to each element
    // (`elementwiseRule()` in `javascript-fragment-target.ts`).
    if (
      (operator === 'Add' ||
        operator === 'Multiply' ||
        operator === 'Negate' ||
        operator === 'Divide') &&
      facts.type.kind === 'list'
    )
      return this.elementwise(node, facts, scope, operations, effect);

    // `Power` in the form that its rule recorded (`StructuredForm`, the
    // forms of `powerForm()`). `Power(x, 2)`: the product of
    // the operand with itself; `Power(x, 1.5)`: the product of the operand
    // and its square root. The operand is evaluated once, and the literal
    // exponent has no operation. `Power(ExponentialE, x)`: the function
    // `exp` of the exponent, whose conversion is the first one of the facts
    // (the rule of `Power` types no base for this form).
    if (operator === 'Power') {
      const form = this.prep.forms.get(node);
      if (typeof form === 'object' && 'folded' in form)
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
            n === k
              ? this.resultOf(facts)
              : this.newValue('complex', 'complex');
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
      if (typeof form === 'object' && 'folded' in form)
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
    // `Mod(a, 1)` of a dividend that is not integer-valued: the fractional
    // part of `a`, the literal divisor not lowered (`modRule()`).
    if (special === 'mod-one') {
      const operand = this.convert(
        this.value(node.ops[0], scope, operations),
        facts.conversions?.[0],
        node,
        operations
      );
      const result = this.resultOf(facts);
      operations.push({
        kind: 'unary',
        fn: 'mod-one',
        result,
        operands: [operand],
        effect,
        origin: node,
      });
      return result;
    }
    if (isRealCallForm(special))
      return this.realCall(node, special, facts, scope, operations, effect);

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

    // `At(M, i, j)` of a list of lists (`atRule()`): one `at` per index, the
    // row `i`, then its element `j`, as `At(At(M, i), j)`.
    if (operator === 'At' && node.nops > 2) {
      const [base, ...indexes] = this.operands(node, facts, scope, operations);
      let value = base;
      indexes.forEach((index, i) => {
        const result =
          i === indexes.length - 1
            ? this.resultOf(facts)
            : this.newValue(
                elementOf(value.type) ??
                  fail(`${nodeText(node)} reads no list of lists`),
                'array'
              );
        operations.push({
          kind: 'at',
          result,
          operands: [value, index],
          effect,
          origin: node,
        });
        value = result;
      });
      return value;
    }

    // `ReplaceAt(M, i, j, x)` of a list of lists (`nestedReplaceAt()`): the
    // row `i` with its element `j` replaced, written as the row `i` of `M`:
    // `replace-at(M, i, replace-at(at(M, i), j, x))`, which copies the outer
    // array and the row `i`, as `_SYS.replaceAtPath(M, i, j, x)` does.
    if (operator === 'ReplaceAt' && node.nops === 4) {
      const [list, i, j, x] = this.operands(node, facts, scope, operations);
      const result = this.resultOf(facts);
      const resultRow = elementOf(result.type);
      const row = elementOf(list.type);
      if (resultRow === undefined || row === undefined || !isListType(row))
        return fail(`${nodeText(node)} writes no row of a list of lists`);
      const read = this.newValue(row, 'array');
      operations.push({
        kind: 'at',
        result: read,
        operands: [list, i],
        effect,
        origin: node,
      });
      const written = this.newValue(resultRow, 'array');
      operations.push({
        kind: 'replace-at',
        result: written,
        operands: [read, j, x],
        effect,
        origin: node,
      });
      operations.push({
        kind: 'replace-at',
        result,
        operands: [list, i, written],
        effect,
        origin: node,
      });
      return result;
    }

    const kind = Object.hasOwn(OPERATIONS, operator)
      ? OPERATIONS[operator]
      : undefined;
    if (kind === undefined) return fail(`no lowering for the head ${operator}`);
    if (
      node.nops > 2 &&
      (kind === 'less' ||
        kind === 'less-equal' ||
        kind === 'equal' ||
        kind === 'not-equal')
    )
      return this.chain(node, kind, facts, scope, operations, effect);
    const operands = this.operands(node, facts, scope, operations);
    const result = this.resultOf(facts);
    operations.push({ kind, result, operands, effect, origin: node });
    return result;
  }

  /**
   * A comparison of three operands or more, which the rule of the
   * comparison admitted: the conjunction of its adjacent pairs, each operand
   * evaluated once. The first two operands are evaluated here, in the order
   * that the rule recorded (`chainForms()` in `javascript-fragment-target.ts`:
   * the second one first for the form `chain-swap`), then compared; each
   * later operand is evaluated in an `and` region that runs only when the
   * pairs before it hold, and compared with the operand before it, whose
   * value is the one of the earlier pair. The interpreter stops at the first
   * pair that is false, and so does the existing emitter.
   */
  private chain(
    node: Expression & { ops: readonly Expression[] },
    kind: 'less' | 'less-equal' | 'equal' | 'not-equal',
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const values: IRValue[] = [];
    const operand = (i: number, ops: IROperation[]) => {
      values[i] = this.convert(
        this.value(node.ops[i], scope, ops),
        facts.conversions?.[i],
        node,
        ops
      );
    };
    for (const i of this.prep.forms.get(node) === 'chain-swap'
      ? [1, 0]
      : [0, 1])
      operand(i, operations);
    const compare = (i: number, ops: IROperation[]): IRValue => {
      const result = this.newValue('boolean', 'boolean');
      ops.push({
        kind,
        result,
        operands: [values[i], values[i + 1]],
        effect,
        origin: node,
      });
      return result;
    };
    // The pairs from the pair of the operands `i - 1` and `i` on, after the
    // value `first` of the pairs before them.
    const rest = (i: number, ops: IROperation[], first: IRValue): IRValue => {
      if (i === node.ops.length) return first;
      const inner: IROperation[] = [];
      const value = this.inRegion(inner, () => {
        operand(i, inner);
        return rest(i + 1, inner, compare(i - 1, inner));
      });
      const region = this.region(inner, node.ops[i], value);
      const result =
        i === 2 ? this.resultOf(facts) : this.newValue('boolean', 'boolean');
      ops.push({
        kind: 'and',
        result,
        operands: [first],
        rest: [region],
        effect: joinEffects(effect, region.effect),
        ...touchesField(this.states(node), region.touches),
        origin: node,
      });
      return result;
    };
    return rest(2, operations, compare(0, operations));
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
      (spec.nops !== 2 && spec.nops !== 3) ||
      !isSymbol(spec.op1) ||
      !isFunction(spec.op2, 'Range') ||
      spec.op2.nops !== 2
    )
      return fail(`no lowering for the comprehension ${nodeText(node)}`);
    if (spec.nops === 3)
      return this.guardedBuild(
        body,
        spec.op1.symbol,
        spec.op2.op1,
        spec.op2.op2,
        spec.op3,
        node,
        facts,
        scope,
        inner,
        operations,
        effect
      );
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
   * `Comprehension(body, Element(j, Range(a, b), guard))`, a comprehension
   * with a guard, which the rule of `Comprehension` checked: the code of the
   * existing emitter (`compileComprehension()` in `compile-loops.ts`),
   * `const result = []; for (…) { if (guard) result.push(body); }`. The
   * bounds are evaluated here, before the loop. The `loop` carries the list,
   * whose initial value is the empty `list`; its body evaluates the guard
   * with the index bound, then an `if` whose first branch evaluates `body`
   * and `append`s it, and whose other branch yields the list as it is. The
   * loop visits `Range(a, b)` as the interpreter does, in steps of -1 when
   * `b < a`, and has no iteration budget: the existing emitter counts no pass
   * of a comprehension. The rule refused a guard or a body that is not pure.
   */
  private guardedBuild(
    body: Expression,
    indexName: string,
    fromNode: Expression,
    toNode: Expression,
    guard: Expression,
    node: Expression,
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    inner: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${nodeText(b)} of a comprehension is not an integer`);
      return value;
    };
    const from = bound(fromNode);
    const to = bound(toNode);
    const type = valueType(facts.type);
    if (!isListType(type))
      return fail(`the comprehension ${nodeText(node)} does not make a list`);
    const empty = this.newValue(type, 'array');
    operations.push({
      kind: 'list',
      result: empty,
      operands: [],
      effect: 'pure',
      origin: node,
    });
    const index = this.newValue('integer', 'number');
    const list = this.newValue(type, 'array');
    this.bound.set(inner, new Map([[indexName, index]]));
    this.wrote(inner);
    this.changed();
    const bodyOperations: IROperation[] = [];
    const next = this.inRegion(bodyOperations, () =>
      this.conditional(
        this.value(guard, inner, bodyOperations),
        (into) => {
          const element = this.value(body, inner, into);
          const result = this.newValue(type, 'array');
          into.push({
            kind: 'append',
            result,
            operands: [list, element],
            effect: 'pure',
            origin: node,
          });
          return result;
        },
        () => list,
        node,
        bodyOperations
      )
    );
    const region: IRRegion = {
      ...this.region(bodyOperations, body, next),
      parameters: [index, list],
    };
    const result = this.resultOf(facts);
    operations.push({
      kind: 'loop',
      results: [result],
      operands: [from, to, empty],
      body: region,
      effect: joinEffects(effect, region.effect),
      ...touchesField(this.states(node), region.touches),
      origin: node,
    });
    return result;
  }

  /** The literal `1` and the `length` of `list` at the end of
   *  `operations`: the bounds of a pass over its elements. */
  private elementRange(
    list: IRValue,
    origin: Expression,
    operations: IROperation[]
  ): [IRValue, IRValue] {
    const one = this.numberLiteral(1, 'integer', origin, operations);
    const length = this.newValue('integer', 'number');
    operations.push({
      kind: 'length',
      result: length,
      operands: [list],
      effect: 'pure',
      origin,
    });
    return [one, length];
  }

  /** The element of `list` (a list, or a tuple of reals) at `index`, at the
   *  end of `operations`: a number, or a tuple of a list of tuples. */
  private element(
    list: IRValue,
    index: IRValue,
    origin: Expression,
    operations: IROperation[]
  ): IRValue {
    const type = list.type;
    const element = isTupleType(type)
      ? type.elements[0]
      : (elementOf(type) ?? fail(`${nodeText(origin)} reads no list`));
    // A tuple of a list of tuples and a row of a list of lists are arrays.
    const result = this.newValue(
      element,
      isTupleType(element) || isListType(element) ? 'array' : 'number'
    );
    operations.push({
      kind: 'at',
      result,
      operands: [list, index],
      effect: 'pure',
      origin,
    });
    return result;
  }

  /**
   * `Sum(L)`, `Product(L)`, `Max(L)` or `Min(L)` of one list or tuple `L`,
   * which the rule of the fold checked (`foldRule()` in
   * `javascript-fragment-target.ts`), as the existing emitter writes it:
   *
   * - A sum or a product of a tuple: one `add` (`multiply`) of `0` (`1`)
   *   and the elements in order (`get`), `(0 + P[0] + P[1])`.
   * - A sum or a product of a list: a `loop` over the elements, from 1 to
   *   the length (`ascending`, so an empty list gives the initial value),
   *   whose carried value starts at `0` (`1`) and adds (multiplies) the
   *   element: the order of `(L).reduce((_a, _b) => _a + _b, 0)`.
   * - A maximum or a minimum of a list or a tuple: the same `loop` from
   *   `-Infinity` (`Infinity`) with `max` (`min`), in the else branch of an
   *   `if` on an empty list, whose value is `NaN`: `_l.length === 0 ? NaN :
   *   _l.reduce((_a, _b) => Math.max(_a, _b), -Infinity)`.
   *
   * The list is evaluated once, before the loop. The operations of the fold
   * are `pure`.
   */
  private fold(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const operator = node.operator;
    const kind =
      operator === 'Sum'
        ? 'add'
        : operator === 'Product'
          ? 'multiply'
          : operator === 'Max'
            ? 'max'
            : 'min';
    const collection = this.convert(
      this.value(node.ops[0], scope, operations),
      facts.conversions?.[0],
      node,
      operations
    );
    const type = valueType(facts.type);
    if (type !== 'real' && type !== 'integer')
      return fail(`the fold ${nodeText(node)} is not a number`);
    const tuple = collection.type;
    if (isTupleType(tuple) && (kind === 'add' || kind === 'multiply')) {
      const terms = [
        this.numberLiteral(kind === 'add' ? 0 : 1, 'integer', node, operations),
        ...tuple.elements.map((element, i) => {
          const result = this.newValue(element, 'number');
          operations.push({
            kind: 'get',
            position: i + 1,
            result,
            operands: [collection],
            effect: 'pure',
            origin: node,
          });
          return result;
        }),
      ];
      const result = this.resultOf(facts);
      operations.push({ kind, result, operands: terms, effect, origin: node });
      return result;
    }
    const [one, length] = this.elementRange(collection, node, operations);
    const loop = (into: IROperation[]): IRValue => {
      const index = this.newValue('integer', 'number');
      const accumulator = this.newValue(type, 'number');
      const body: IROperation[] = [];
      const next = this.newValue(type, 'number');
      body.push({
        kind,
        result: next,
        operands: [accumulator, this.element(collection, index, node, body)],
        effect: 'pure',
        origin: node,
      });
      const region: IRRegion = {
        ...this.region(body, node, next),
        parameters: [index, accumulator],
      };
      const initial =
        kind === 'add' || kind === 'multiply'
          ? this.numberLiteral(kind === 'add' ? 0 : 1, 'integer', node, into)
          : this.numberLiteral(
              kind === 'max' ? -Infinity : Infinity,
              'real',
              node,
              into
            );
      const result = this.newValue(type, 'number');
      into.push({
        kind: 'loop',
        results: [result],
        operands: [one, length, initial],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        ascending: true,
        origin: node,
      });
      return result;
    };
    if (kind === 'add' || kind === 'multiply') return loop(operations);
    const zero = this.numberLiteral(0, 'integer', node, operations);
    const empty = this.newValue('boolean', 'boolean');
    operations.push({
      kind: 'equal',
      result: empty,
      operands: [length, zero],
      effect: 'pure',
      origin: node,
    });
    return this.conditional(
      empty,
      (into) => this.numberLiteral(NaN, 'real', node, into),
      loop,
      node,
      operations,
      effect
    );
  }

  /**
   * `Add`, `Multiply`, `Negate` or `Divide` with a list operand, which the
   * rule of the head admitted (`elementwiseRule()` in
   * `javascript-fragment-target.ts`): each operand evaluated once, in
   * order, then a `build` over the elements of the first list operand, from
   * 1 to its length (`ascending`), whose body applies the operation of the
   * head to the elements of the list operands at the index (`at`) and to
   * the values of the scalar operands, as the closure of `_SYS.bcast` does:
   * `(_tv1 + _tv2)`, `(_tv1 * _tv2 * _tv3)` in the order of the operands,
   * `(-(_tv1))`, `((_tv1) / (_tv2))`. The rule admitted two list operands
   * only when their lengths are equal by construction.
   */
  private elementwise(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const operator = node.operator;
    const kind =
      operator === 'Add'
        ? 'add'
        : operator === 'Multiply'
          ? 'multiply'
          : operator === 'Negate'
            ? 'negate'
            : 'divide';
    const values = this.operands(node, facts, scope, operations);
    const list =
      values.find((v) => isListType(v.type)) ??
      fail(`no list operand in ${nodeText(node)}`);
    const type = valueType(facts.type);
    const element = elementOf(type) ?? fail(`${nodeText(node)} is not a list`);
    const [one, length] = this.elementRange(list, node, operations);
    const index = this.newValue('integer', 'number');
    const body: IROperation[] = [];
    const operands = values.map((v) =>
      isListType(v.type) ? this.element(v, index, node, body) : v
    );
    const value = this.newValue(element, 'number');
    body.push({ kind, result: value, operands, effect: 'pure', origin: node });
    const region: IRRegion = {
      ...this.region(body, node, value),
      parameters: [index],
    };
    const result = this.resultOf(facts);
    operations.push({
      kind: 'build',
      result,
      operands: [one, length],
      body: region,
      effect: joinEffects(effect, region.effect),
      ...touchesField(this.states(node), region.touches),
      ascending: true,
      origin: node,
    });
    return result;
  }

  /**
   * A function of lists, which `collectionRule()` (in
   * `javascript-fragment-target.ts`) admitted: its operands evaluated once,
   * in order, then
   *
   * - `Norm`, `Mean`, `Median`, `Variance`, `Dot` of two lists, `Take`,
   *   `Drop`, `Reverse`, `Sort`, `Join`, `RotateLeft` and `RotateRight`: the
   *   `collection` operation of the head; `Rest(L)` is `drop` of the count
   *   `1`, and a rotation with no shift rotates by `1`;
   * - `Dot` of two tuples: one `add` of the products of the elements at each
   *   position (`get`), in order, or the one product of a tuple of one
   *   element, as the existing emitter writes `(P[0] * Q[0] + P[1] *
   *   Q[1])`;
   * - `First(L)` and `Last(L)`: `at` of the index `1` and `-1`; `Count(L)`:
   *   `length`;
   * - `Range(a, b)` (`Range(b)` from 1) and `Range(a, b, step)`: the
   *   `collection` operation `range` of the bounds (and the step).
   */
  private collection(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const operator = node.operator;
    const operands = this.operands(node, facts, scope, operations);
    const push = (
      fn: CollectionFunctionName,
      values: readonly IRValue[],
      result: IRValue = this.resultOf(facts)
    ): IRValue => {
      operations.push({
        kind: 'collection',
        fn,
        result,
        operands: values,
        effect: 'pure',
        origin: node,
      });
      return result;
    };
    switch (operator) {
      case 'Norm':
      case 'Mean':
      case 'Median':
      case 'Variance':
      case 'Take':
      case 'Drop':
      case 'Reverse':
      case 'Sort':
      case 'Join':
      case 'ListJoin': {
        const fn = COLLECTION_HEADS[operator];
        if (fn === 'at' || fn === 'length')
          return fail(`no function of lists for ${operator}`);
        return push(fn, operands);
      }
      case 'Rest':
        return push('drop', [
          operands[0],
          this.numberLiteral(1, 'integer', node, operations),
        ]);
      // A rotation with no shift rotates by 1, as the existing emitter
      // writes `_SYS.rotl(L, 1)`.
      case 'RotateLeft':
      case 'RotateRight':
        return push(
          COLLECTION_HEADS[operator] as CollectionFunctionName,
          operands.length === 2
            ? operands
            : [operands[0], this.numberLiteral(1, 'integer', node, operations)]
        );
      case 'Dot': {
        const [a, b] = operands;
        if (!isTupleType(a.type) || !isTupleType(b.type))
          return push('dot', operands);
        const elements = a.type.elements;
        const products = elements.map((element, i) => {
          const get = (tuple: IRValue, kind: ScalarKind) => {
            const result = this.newValue(kind, 'number');
            operations.push({
              kind: 'get',
              position: i + 1,
              result,
              operands: [tuple],
              effect: 'pure',
              origin: node,
            });
            return result;
          };
          const left = get(a, element);
          const right = get(b, (b.type as TupleType).elements[i]);
          const result =
            elements.length === 1
              ? this.resultOf(facts)
              : this.newValue('real', 'number');
          operations.push({
            kind: 'multiply',
            result,
            operands: [left, right],
            effect: 'pure',
            origin: node,
          });
          return result;
        });
        if (products.length === 1) return products[0];
        const result = this.resultOf(facts);
        operations.push({
          kind: 'add',
          result,
          operands: products,
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      case 'First':
      case 'Last':
        return this.element(
          operands[0],
          this.numberLiteral(
            operator === 'First' ? 1 : -1,
            'integer',
            node,
            operations
          ),
          node,
          operations
        );
      case 'Count': {
        const result = this.resultOf(facts);
        operations.push({
          kind: 'length',
          result,
          operands,
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      case 'Range': {
        // `Range(b)` from 1; `Range(a, b, step)` has three operands.
        const bounds =
          operands.length === 1
            ? [this.numberLiteral(1, 'integer', node, operations), operands[0]]
            : operands;
        return push('range', bounds);
      }
    }
    return fail(`no lowering for the function of lists ${nodeText(node)}`);
  }

  /**
   * A head with a function operand, which `functionOperandRule()` (in
   * `javascript-fragment-target.ts`) admitted. The operands that are not
   * the function are evaluated once, in order, before the elements. The
   * function is applied where the existing emitter calls it, in the same
   * order and as many times: a lambda by its body, lowered in the region of
   * each pass with its parameters bound in the scope of the node (the caller
   * runs this in `inScope()` of that scope); a library operator by its
   * operation (`MAPPED_OPERATORS`, `FOLD_OPERATORS`). Each pass over the
   * elements is from 1 to the length (`ascending`), as `map`, `filter` and
   * `reduce` of an array visit it:
   *
   * - `Map(f, L)`: a `build` whose body yields `f` of the element.
   * - `Filter(L, p)`: a `loop` that carries the list, from the empty list,
   *   with an `if` of `p` of the element whose first branch `append`s it.
   *   `Count(L, p)` carries an integer from `0` and adds `1`.
   * - `Reduce(L, op)`: an `if` on the length `0`, whose value is `NaN`, else
   *   a `loop` from 2 that carries the accumulator from the first element:
   *   `_l.length === 0 ? NaN : _l.reduce(op)`. With `init`, the `loop` from 1
   *   carries it from `init`. A lambda takes the accumulator and the element.
   * - `Scan`: the same `loop`, which also carries the list of the
   *   accumulators and `append`s each new one; with no `init`, the list
   *   starts with the first element, and an empty list gives the empty list.
   * - `Apply(f, a1, …)`: the body of `f` with each parameter bound to its
   *   argument, where the node is.
   *
   * The operations that the lowering adds are `pure`; the `build`, the
   * `loop` and the `if` join the effects of their regions (the rule refused
   * a body that is not pure).
   */
  private functionOperand(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const operator = node.operator;
    const position = FUNCTION_OPERAND_HEADS[operator];
    const fn = functionOperandOf(node) ?? node.ops[position.fn];
    const lambda = functionOperandParts(
      fn,
      position.arity ?? node.ops.length - 1
    );
    const inner = scope.inner.get(node);
    if (lambda !== undefined && inner === undefined)
      return fail(`no scope for the function of ${nodeText(node)}`);
    // The operands that are not the function, with their conversions.
    const others = node.ops
      .map((operand, i) => ({ operand, i }))
      .filter(({ i }) => i !== position.fn);
    const values = others.map(({ operand }, j) =>
      this.convert(
        this.value(operand, scope, operations),
        facts.conversions?.[j],
        node,
        operations
      )
    );
    /** The value of the function at `args`, at the end of `into`, the
     *  innermost open region. */
    const apply = (args: readonly IRValue[], into: IROperation[]): IRValue => {
      if (lambda !== undefined) {
        this.bound.set(
          inner!,
          new Map(lambda.parameters.map((p, i) => [p.symbol.symbol, args[i]]))
        );
        this.wrote(inner!);
        this.changed();
        return this.value(lambda.body, inner!, into);
      }
      const name = isSymbol(fn) ? fn.symbol : '';
      const fold = Object.hasOwn(FOLD_OPERATORS, name)
        ? FOLD_OPERATORS[name]
        : undefined;
      if (fold !== undefined && args.length === 2) {
        const integer = args.every((a) => a.type === 'integer');
        const result = this.newValue(integer ? 'integer' : 'real', 'number');
        into.push({
          kind: fold,
          result,
          operands: [...args],
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      const mapped = Object.hasOwn(MAPPED_OPERATORS, name)
        ? MAPPED_OPERATORS[name]
        : undefined;
      if (mapped === undefined || args.length !== 1)
        return fail(`no operation for the function ${nodeText(fn)}`);
      const integer =
        mapped.kind === 'floor' ||
        ((mapped.kind === 'negate' || mapped.fn === 'abs') &&
          args[0].type === 'integer');
      const result = this.newValue(integer ? 'integer' : 'real', 'number');
      into.push(
        mapped.kind === 'unary'
          ? {
              kind: 'unary',
              fn: mapped.fn!,
              result,
              operands: [...args],
              effect: 'pure',
              origin: node,
            }
          : {
              kind: mapped.kind,
              result,
              operands: [...args],
              effect: 'pure',
              origin: node,
            }
      );
      return result;
    };

    if (operator === 'Apply') return apply(values, operations);

    const list = values[0];
    const type = valueType(facts.type);
    const [one, length] = this.elementRange(list, node, operations);
    const representationOf = (t: ValueType): ScalarRepresentation =>
      isListType(t) ? 'array' : 'number';
    const literal = (
      value: number,
      kind: 'real' | 'integer',
      into: IROperation[]
    ) => this.numberLiteral(value, kind, node, into);
    /** A pass over the elements from the index `from` to the length: a
     *  `loop` that carries one value per entry of `carried` (its initial
     *  value and its type), whose body computes the next values from the
     *  element and the carried values (`step`). */
    const pass = (
      from: IRValue,
      carried: readonly {
        readonly initial: IRValue;
        readonly type: ValueType;
      }[],
      step: (
        element: IRValue,
        current: readonly IRValue[],
        into: IROperation[]
      ) => readonly IRValue[],
      into: IROperation[]
    ): IRValue[] => {
      const index = this.newValue('integer', 'number');
      const parameters = carried.map((c) =>
        this.newValue(c.type, representationOf(c.type))
      );
      const body: IROperation[] = [];
      const next = this.inRegion(body, () =>
        step(this.element(list, index, node, body), parameters, body)
      );
      const region: IRRegion = {
        ...this.region(body, node, [...next]),
        parameters: [index, ...parameters],
      };
      const results = carried.map((c) =>
        this.newValue(c.type, representationOf(c.type))
      );
      into.push({
        kind: 'loop',
        results,
        operands: [from, length, ...carried.map((c) => c.initial)],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        ascending: true,
        origin: node,
      });
      return results;
    };
    const append = (to: IRValue, element: IRValue, into: IROperation[]) => {
      const result = this.newValue(to.type, 'array');
      into.push({
        kind: 'append',
        result,
        operands: [to, element],
        effect: 'pure',
        origin: node,
      });
      return result;
    };
    const empty = (listOf: ValueType, into: IROperation[]) => {
      const result = this.newValue(listOf, 'array');
      into.push({
        kind: 'list',
        result,
        operands: [],
        effect: 'pure',
        origin: node,
      });
      return result;
    };
    /** An `if` on an empty list: the value of `none` for one, else the
     *  value of `some`. */
    const unlessEmpty = (
      none: (into: IROperation[]) => IRValue,
      some: (into: IROperation[]) => IRValue
    ): IRValue => {
      const zero = literal(0, 'integer', operations);
      const test = this.newValue('boolean', 'boolean');
      operations.push({
        kind: 'equal',
        result: test,
        operands: [length, zero],
        effect: 'pure',
        origin: node,
      });
      return this.conditional(test, none, some, node, operations);
    };

    switch (operator) {
      case 'Map': {
        const index = this.newValue('integer', 'number');
        const body: IROperation[] = [];
        const element = this.inRegion(body, () =>
          apply([this.element(list, index, node, body)], body)
        );
        const region: IRRegion = {
          ...this.region(body, node, element),
          parameters: [index],
        };
        const result = this.resultOf(facts);
        operations.push({
          kind: 'build',
          result,
          operands: [one, length],
          body: region,
          effect: region.effect,
          ...touchesField(region.touches),
          ascending: true,
          origin: node,
        });
        return result;
      }
      case 'Filter':
      case 'Count': {
        const filter = operator === 'Filter';
        const start = filter
          ? empty(type, operations)
          : literal(0, 'integer', operations);
        const [result] = pass(
          one,
          [{ initial: start, type }],
          (element, [current], into) => [
            this.conditional(
              apply([element], into),
              (inner) => {
                if (filter) return append(current, element, inner);
                const sum = this.newValue('integer', 'number');
                inner.push({
                  kind: 'add',
                  result: sum,
                  operands: [current, literal(1, 'integer', inner)],
                  effect: 'pure',
                  origin: node,
                });
                return sum;
              },
              () => current,
              node,
              into
            ),
          ],
          operations
        );
        return result;
      }
      case 'Reduce':
      case 'Scan': {
        const scan = operator === 'Scan';
        const init = values[1];
        // The type of the accumulator: the element type of a scan, the type
        // of a reduce with an initial value, and with none the type of the
        // else branch of the test of an empty list.
        const accumulator: ValueType = scan
          ? (elementOf(type) ?? fail(`${nodeText(node)} is not a list`))
          : init !== undefined
            ? type
            : lambda !== undefined
              ? 'real'
              : (elementOf(list.type) ?? 'real');
        const step =
          (withList: boolean) =>
          (
            element: IRValue,
            current: readonly IRValue[],
            into: IROperation[]
          ): readonly IRValue[] => {
            const value = apply([current[0], element], into);
            return withList
              ? [value, append(current[1], value, into)]
              : [value];
          };
        if (init !== undefined) {
          const carried = [{ initial: init, type: accumulator }];
          if (scan) carried.push({ initial: empty(type, operations), type });
          const results = pass(one, carried, step(scan), operations);
          return results[scan ? 1 : 0];
        }
        // No initial value: the first element starts the fold.
        return unlessEmpty(
          (into) => (scan ? empty(type, into) : literal(NaN, 'real', into)),
          (into) => {
            const first = this.element(list, one, node, into);
            const carried = [{ initial: first, type: accumulator }];
            if (scan) {
              const start = this.newValue(type, 'array');
              into.push({
                kind: 'list',
                result: start,
                operands: [first],
                effect: 'pure',
                origin: node,
              });
              carried.push({ initial: start, type });
            }
            const results = pass(
              literal(2, 'integer', into),
              carried,
              step(scan),
              into
            );
            return results[scan ? 1 : 0];
          }
        );
      }
    }
    return fail(`no lowering for ${nodeText(node)}`);
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
   * A definite `Integrate` with no closed form (`StructuredIntegral`), as
   * the existing emitter writes it (`compileIntegrate()` in
   * `javascript-target.ts`): one `routine` `integrate` per clause, nested,
   * the first clause outermost. The bounds of the first clause are
   * evaluated where the node is, the lower one first; the bounds of a later
   * clause are operations of the body of the clause before it, evaluated
   * at each of its samples. The body of the last clause is the integrand.
   * Each body binds the variable of its clause to its parameter and starts
   * a new epoch (`changed()`), so no node of the body is the value of an
   * earlier lowering outside it: every operation of the integrand runs at
   * each sample, as the code of the existing emitter with `cse: false`
   * does. Each clause starts from the panel count of the outermost integral
   * of the body that holds the node (`panels`), or of this node.
   */
  private integral(
    node: Expression & { ops: readonly Expression[] },
    integral: StructuredIntegral,
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined)
      return fail(`no scope for the integral ${nodeText(node)}`);
    const rule = JAVASCRIPT_POLICY.routines?.integrate;
    if (rule === undefined) return fail('the target has no routine integrate');
    const outermost = this.panels === undefined;
    const panels = this.panels ?? integral.panels;
    if (outermost) this.panels = panels;
    const { clauses, body } = integral;
    // The conversion of each bound, then of the body (`integralRule()` in
    // `javascript-fragment-target.ts`).
    const conversion = (i: number) => facts.conversions?.[i];
    const clause = (d: number, out: IROperation[]): IRValue => {
      const { name, lower, upper } = clauses[d];
      const bound = (b: Expression, i: number) =>
        this.convert(this.value(b, inner, out), conversion(i), node, out);
      const lo = bound(lower, 2 * d);
      const hi = bound(upper, 2 * d + 1);
      const parameter = this.newValue('real', 'number');
      const bodyOperations: IROperation[] = [];
      const value = this.inRegion(bodyOperations, () => {
        const values = new Map(this.bound.get(inner) ?? []);
        values.set(name, parameter);
        this.bound.set(inner, values);
        this.wrote(inner);
        this.changed();
        return d + 1 < clauses.length
          ? clause(d + 1, bodyOperations)
          : this.convert(
              this.value(body, inner, bodyOperations),
              conversion(2 * clauses.length),
              node,
              bodyOperations
            );
      });
      const region: IRRegion = {
        ...this.region(
          bodyOperations,
          d + 1 < clauses.length ? node : body,
          value
        ),
        parameters: [parameter],
      };
      const result =
        d === 0 ? this.resultOf(facts) : this.newValue('real', 'number');
      out.push({
        kind: 'routine',
        fn: 'integrate',
        result,
        operands: [lo, hi],
        body: region,
        initialPanels: panels,
        effect: joinEffects(rule.effect, region.effect),
        ...touchesField(rule.touches, region.touches),
        ...(rule.aborts !== undefined ? { aborts: rule.aborts } : {}),
        origin: node,
      });
      return result;
    };
    try {
      return clause(0, operations);
    } finally {
      if (outermost) this.panels = undefined;
    }
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
          return push(
            'multiply',
            [constant, v],
            this.newValue('real', 'number')
          );
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
      fail(
        `the two values of a conditional ${nodeText(origin)} have different representations`
      );
    const result = this.newValue(
      widerType(a.type, b.type) ??
        fail(
          `the two values of a conditional ${nodeText(origin)} have no common type`
        ),
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
   * A head of `realCallRule()` in the form `form` (`RealCallForm`). The
   * operands are evaluated once, in order, before the functions of the
   * form, as the existing emitter evaluates the arguments of its call;
   * `imaginary` evaluates none.
   */
  private realCall(
    node: Expression & { ops: readonly Expression[] },
    form: RealCallForm,
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    if (form === 'imaginary')
      return this.numberLiteral(0, 'integer', node, operations);
    const operands = this.operands(node, facts, scope, operations);
    const apply = (
      fn: UnaryFunctionName | BinaryFunctionName,
      args: IRValue[],
      result: IRValue = this.newValue('real', 'number')
    ): IRValue => {
      operations.push(
        args.length === 1
          ? {
              kind: 'unary',
              fn: fn as UnaryFunctionName,
              result,
              operands: args,
              effect,
              origin: node,
            }
          : {
              kind: 'binary',
              fn: fn as BinaryFunctionName,
              result,
              operands: args,
              effect,
              origin: node,
            }
      );
      return result;
    };
    const literal = (value: number) =>
      this.numberLiteral(value, 'integer', node, operations);
    if (typeof form === 'object' && 'call' in form) {
      const args = [
        ...(form.before === undefined ? [] : [literal(form.before)]),
        ...operands,
        ...(form.after === undefined
          ? []
          : [this.numberLiteral(form.after, 'real', node, operations)]),
      ];
      return apply(form.call, args, this.resultOf(facts));
    }
    if (typeof form === 'object') {
      let value = operands[0];
      for (const operand of operands.slice(1))
        value = apply(form.fold, [value, operand]);
      return value;
    }
    const oneOrZero = (test: IRValue): IRValue =>
      this.conditional(
        test,
        (inner) => this.numberLiteral(1, 'integer', node, inner),
        (inner) => this.numberLiteral(0, 'integer', node, inner),
        node,
        operations,
        effect
      );
    const equal = (a: IRValue, b: IRValue, into: IROperation[]): IRValue => {
      const result = this.newValue('boolean', 'boolean');
      into.push({
        kind: 'equal',
        result,
        operands: [a, b],
        effect,
        origin: node,
      });
      return result;
    };
    switch (form) {
      case 'boole':
        return oneOrZero(operands[0]);
      case 'kronecker-delta': {
        // `(x === 0 ? 1 : 0)`, and `_v.every((_x) => _x === _v[0]) ? 1 : 0`
        // over the values of the operands: each later operand is compared
        // with the first, only while the comparisons before it hold.
        if (operands.length === 1)
          return oneOrZero(equal(operands[0], literal(0), operations));
        const [first, ...rest] = operands;
        const chain = (i: number, into: IROperation[]): IRValue => {
          // The first operand first, as the existing compiler evaluates
          // the operands in order (a later operand that can throw is
          // refused by the rule, `realCallRule()`).
          const test = equal(first, rest[i], into);
          if (i === rest.length - 1)
            return this.conditional(
              test,
              (inner) => this.numberLiteral(1, 'integer', node, inner),
              (inner) => this.numberLiteral(0, 'integer', node, inner),
              node,
              into,
              effect
            );
          return this.conditional(
            test,
            (inner) => chain(i + 1, inner),
            (inner) => this.numberLiteral(0, 'integer', node, inner),
            node,
            into,
            effect
          );
        };
        return chain(0, operations);
      }
      case 'clamp': {
        // `Math.min(Math.max(x, lo), hi)`.
        const type = valueType(facts.type);
        const extremum = (kind: 'min' | 'max', args: IRValue[]): IRValue => {
          const result = this.newValue(type, 'number');
          operations.push({
            kind,
            result,
            operands: args,
            effect,
            origin: node,
          });
          return result;
        };
        return extremum('min', [
          extremum('max', [operands[0], operands[1]]),
          operands[2],
        ]);
      }
      case 'argument': {
        // `Math.atan2(0, (x) + 0)`.
        const sum = this.newValue('real', 'number');
        operations.push({
          kind: 'add',
          result: sum,
          operands: [operands[0], literal(0)],
          effect,
          origin: node,
        });
        return apply('atan2', [literal(0), sum], this.resultOf(facts));
      }
    }
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
   * The existing emitter stops at the first term whose value is `NaN`
   * (`if (_tv1 !== _tv1) return NaN`, `emitSumProduct()`) when its terms are
   * skippable by its purity oracle and can be `NaN`, in a loop and in an
   * unrolled sum of `UNROLL_STATEMENT_MIN_TERMS` terms or more; a shorter
   * unrolled sum is one chain that evaluates every term, and its terms are
   * not refused. `NaN` absorbs
   * both operations, so the value is the same when a later term has no
   * effect and cannot throw. A term that can throw where an earlier term is
   * `NaN` (`termThrower()`: a `routine`, a `replace-at`, a call of a
   * function whose body can throw, a `mod` but one whose operands are safe
   * integers or the same in every term; a read or a call of the host is
   * left out, as the admission orders and counts those) declines
   * (`StructuredDeclineError`): `Sum(Mod(1, j/k))`
   * at `k = 0` was `NaN` on the existing compiler and a `RangeError` of
   * `_SYS.floorMod` at the second term here, and a sum of integrals that do
   * not converge drew 160 times from the entropy source here and 32 times
   * there.
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
    const clauses = node.ops
      .slice(1)
      .map((clause) =>
        isFunction(clause, 'Limits') &&
        clause.nops === 3 &&
        isSymbol(clause.op1)
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
      // `exits`: the existing emitter can stop at this term when the sum is
      // `NaN` before it. It cannot in an unrolled clause of fewer than
      // `UNROLL_STATEMENT_MIN_TERMS` terms, a flat chain that evaluates
      // every term (`emitSumProduct()`, the same unroll condition as here),
      // so a term there is not refused.
      const term = (
        k: IRValue,
        into: IROperation[],
        exits: boolean
      ): IRValue => {
        bindIndex(index, k);
        const start = into.length;
        const value =
          i + 1 < clauses.length
            ? clause(i + 1, into)
            : this.convert(
                this.value(body, inner, into),
                bodyConversion,
                node,
                into
              );
        const thrower = exits ? this.termThrower(into.slice(start)) : undefined;
        if (thrower !== undefined)
          throw new StructuredDeclineError(
            `${node.operator} ${nodeText(node)} has a term that can throw or ` +
              `integrates numerically (${nodeText(thrower.origin)}): the ` +
              `existing compiler can stop the ${sum ? 'sum' : 'product'} at ` +
              `its first term that is NaN, and not evaluate the later terms`
          );
        return value;
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
          const exits = hi - lo + 1 >= UNROLL_STATEMENT_MIN_TERMS;
          for (let k = lo; k <= hi; k++) {
            // The index literal is defined before the term: it varies across
            // the terms, and is a safe integer (`termThrower()`).
            const indexValue = literal(k, out);
            this.aggregateIndexes.add(indexValue.id);
            terms.push(term(indexValue, out, exits));
          }
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
        this.aggregateIndexes.add(indexValue.id);
        const accumulator = this.newValue(type, representation);
        const bodyOperations: IROperation[] = [];
        const t = this.inRegion(bodyOperations, () =>
          term(indexValue, bodyOperations, true)
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
          [
            magnitude,
            this.numberLiteral(Infinity, 'real', node, finiteOperations),
          ],
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
            return this.region(checkOperations, node, check(checkOperations));
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
          others.length === 1
            ? quotientOf(numerator.ops[others[0]])
            : undefined;
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
    if (capture.value === undefined)
      return this.capturedList(capture, operations);
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
   * A read of a captured list (`StructuredCapture.stored`, a list literal of
   * finite real number literals, which the admission typed in the root
   * scope): a constant of the program (`IRConstant`), held once and shared
   * by every call and every function, and one read of it here
   * (`IRConstantRead`). The existing compiler writes the elements of the
   * same literals (`_val_L`, an array that it builds once per artifact and
   * never writes), so the doubles are the same: the double of a number
   * literal is its `re`, as in the lowering of a literal.
   */
  private capturedList(
    capture: StructuredCapture,
    operations: IROperation[]
  ): IRValue {
    const node = capture.stored;
    if (!isFunction(node, 'List'))
      return fail(`the captured value of ${capture.name} is not a list`);
    const result = this.resultOf(this.facts(node, this.prep.annotation.scope));
    if (!isListType(result.type))
      return fail(`the captured value of ${capture.name} is not a list`);
    let index = this.constantIndex.get(capture.binding);
    if (index === undefined) {
      index = this.constants.length;
      this.constants.push({
        binding: capture.binding,
        name: capture.name,
        type: result.type,
        representation: result.representation,
        elements: node.ops.map((element) => element.re),
      });
      this.constantIndex.set(capture.binding, index);
    }
    operations.push({
      kind: 'constant',
      constant: index,
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
    const value = this.value(last, inner, operations);
    // The existing emitter writes a block operand as a function that it
    // calls, never as the literal of its value, so a complex sum reads the
    // parts of the value and drops no term of it: `x + { b0 ⩴ 1; i }` is
    // `{ re: x + t.re, im: t.im }`, `+0` where `x` is `-0`. The value is
    // read as a value that a local holds (`IRProgram.localValues`).
    this.localValues.add(value.id);
    return value;
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
    // The definition of a local function: its helper is a function of the
    // program, lowered at its first call (`helper()`).
    if (
      (isFunction(node, 'Declare') && isFunction(initializer, 'Function')) ||
      (isFunction(node, 'DefineFunction') &&
        isFunction(node.op2, 'Function')) ||
      (isFunction(node, 'Assign') && isFunction(node.op2, 'Function'))
    )
      return false;
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
      let locals = binder === undefined ? undefined : this.bound.get(binder);
      const binding = binder?.bindings.get(name);
      // The admission and the pass refuse a write to a name that is not a
      // local; an input of the program is bound in the root scope. A local
      // can have no value before the write: a local that a loop body writes
      // and does not carry (`loopStatement()`), and a local of a block that
      // its first write declares (`implicitLocal()` in
      // `javascript-fragment-target.ts`), whose scope can have no value yet.
      if (
        locals === undefined &&
        binder !== undefined &&
        binder !== this.prep.annotation.scope &&
        binding !== undefined
      )
        this.bound.set(binder, (locals = new Map()));
      if (
        locals === undefined ||
        binder === this.prep.annotation.scope ||
        binding === undefined
      )
        return fail(`the name ${name} is not a declared local`);
      if (!('representation' in binding))
        return fail(`the local ${name} has no representation`);
      locals.set(name, this.toLocal(written, binding, name, node, operations));
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

  /** The ids of the index values of the loops of `Sum` and `Product`
   *  (`aggregate()`): integers whose bounds are guarded to the safe range. */
  private readonly aggregateIndexes = new Set<number>();

  /**
   * The operation of `term`, the operations of one term of a `Sum` or a
   * `Product`, that can make the existing compiler's early exit observable,
   * or `undefined` (`aggregate()`): an operation that `canThrowNoHost()`
   * answers for, but a `mod` that cannot throw, or that throws in every
   * term alike. `_SYS.floorMod(a, b)` throws only for an operand beyond
   * ±(2^53 − 1), the infinities included (`integerOperand()` in
   * `javascript-runtime.ts`); `NaN` and a non-integer do not throw. So a
   * `mod` is harmless when each operand is a safe integer by construction
   * (an index of an aggregate, whose bounds are guarded, or an integer
   * literal in the safe range), or, for a `mod` that every term evaluates
   * (one of `term`, not in a region of one), the same value in every term
   * (a value defined before the term, or computed in it by pure operations
   * from such values, inputs, captures and constants): then it throws in
   * the first term on both compilers, or never. `Mod(k, 3)`, `x·Mod(k, 2)`,
   * `Mod(k, m)` with an input `m` are harmless; `Mod(1, j/k)` is not. The
   * functions `real-remainder`, `real-gcd` and `real-lcm` read their
   * operands with `integerOperand()` too, and are judged as a `mod`:
   * `GCD(k, 6)` is harmless, `Remainder(1, j/m)` is not.
   */
  private termThrower(term: readonly IROperation[]): IROperation | undefined {
    const defined = new Map<number, IROperation>();
    const collect = (operations: readonly IROperation[]): void => {
      for (const op of operations) {
        for (const v of definedValues(op)) defined.set(v.id, op);
        for (const region of regionsOf(op)) {
          for (const p of region.parameters ?? []) defined.set(p.id, op);
          collect(region.operations);
        }
      }
    };
    collect(term);
    const safe = (v: IRValue): boolean => {
      if (this.aggregateIndexes.has(v.id)) return true;
      const op = defined.get(v.id);
      return (
        op?.kind === 'literal' &&
        typeof op.value === 'number' &&
        Number.isSafeInteger(op.value)
      );
    };
    const invariants = new Map<number, boolean>();
    const invariant = (v: IRValue): boolean => {
      const op = defined.get(v.id);
      if (op === undefined) return !this.aggregateIndexes.has(v.id);
      let known = invariants.get(v.id);
      if (known === undefined) {
        known =
          op.kind === 'literal' ||
          op.kind === 'input' ||
          op.kind === 'capture' ||
          op.kind === 'constant' ||
          (op.effect === 'pure' &&
            regionsOf(op).length === 0 &&
            op.operands.every(invariant));
        invariants.set(v.id, known);
      }
      return known;
    };
    const visit = (
      operations: readonly IROperation[],
      everyTerm: boolean
    ): IROperation | undefined => {
      for (const op of operations) {
        if (
          op.kind === 'mod' ||
          (op.kind === 'binary' &&
            (op.fn === 'real-remainder' ||
              op.fn === 'real-gcd' ||
              op.fn === 'real-lcm'))
        ) {
          if (
            !op.operands.every((v) => safe(v) || (everyTerm && invariant(v)))
          )
            return op;
          continue;
        }
        if (regionsOf(op).length === 0) {
          if (this.canThrowNoHost(op)) return op;
          continue;
        }
        if (op.kind === 'routine') return op;
        for (const region of regionsOf(op)) {
          const found = visit(region.operations, false);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    };
    return visit(term, true);
  }

  /** Whether each function of the program can throw other than by a call
   *  of the host (`canThrow()` with `host` false), by index. */
  private readonly throwingBodiesNoHost = new Map<number, boolean>();

  /** `canThrow()` of `op` with a call or a read of the host left out: the
   *  admission orders and counts those in a `Sum` or a `Product`
   *  (`aggregate()`). */
  private readonly canThrowNoHost = (op: IROperation): boolean =>
    canThrow(
      op,
      (i) => {
        let known = this.throwingBodiesNoHost.get(i);
        if (known === undefined) {
          const fn = this.functions[i];
          if (fn === undefined) return fail(`no function ${i} for a call`);
          known = fn.body.operations.some(this.canThrowNoHost);
          this.throwingBodiesNoHost.set(i, known);
        }
        return known;
      },
      false
    );

  /**
   * The value `value` written to the local `name` (a `Declare` or an
   * `Assign`, `node`), as a value of the type of the local (`binding`):
   * the pass gives a local its declared type and admits a write only when a
   * conversion reads the value as that type. An integer written to a real
   * local and a list of integers written to a list of reals are the same
   * JavaScript value, as in the existing emitter (`let t = 1`): an identity
   * conversion (`integer-to-real`, `integer-list-to-real-list`,
   * `integer-rows-to-real-rows`) gives the
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
    if (
      value.type === type &&
      value.representation === binding.representation
    ) {
      this.localValues.add(value.id);
      return value;
    }
    const conversion =
      value.type === 'integer' && type === 'real'
        ? 'integer-to-real'
        : value.type === listType('integer') && type === listType('real')
          ? 'integer-list-to-real-list'
          : value.type === listType(listType('integer')) &&
              type === listType(listType('real'))
            ? 'integer-rows-to-real-rows'
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
   *
   * A `Loop` over `Element(c, L)` with a list `L` is a `loop` from 1 to the
   * length of the value of `L`, evaluated once before the loop, whose index
   * is not a name: the body reads the element at the index (`at`, at the
   * start of each iteration) as `c`, as `for (const c of L)` of the
   * existing emitter visits each element in order.
   */
  private loopStatement(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    liveOut: ReadonlySet<string>
  ): void {
    const [body, spec] = node.ops;
    const loopScope = scope.inner.get(node);
    const overList =
      isFunction(spec, 'Element') &&
      spec.nops === 2 &&
      isSymbol(spec.op1) &&
      !isFunction(spec.op2, 'Range');
    if (
      loopScope === undefined ||
      !isFunction(spec, 'Element') ||
      spec.nops !== 2 ||
      !isSymbol(spec.op1) ||
      (!overList && (!isFunction(spec.op2, 'Range') || spec.op2.nops !== 2))
    )
      return fail(`no lowering for the loop ${nodeText(node)}`);
    const index = spec.op1.symbol;
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${nodeText(b)} of a loop is not an integer`);
      return value;
    };
    // The list of a loop over a list, and its length; the bounds of a loop
    // over a range.
    const list = overList ? this.value(spec.op2, scope, operations) : undefined;
    let from: IRValue;
    let to: IRValue;
    if (list !== undefined) {
      from = this.numberLiteral(1, 'integer', node, operations);
      to = this.newValue('integer', 'number');
      operations.push({
        kind: 'length',
        result: to,
        operands: [list],
        effect: 'pure',
        origin: node,
      });
    } else {
      const range = spec.op2 as Expression & {
        op1: Expression;
        op2: Expression;
      };
      from = bound(range.op1);
      to = bound(range.op2);
    }

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
    const exposed = exposedReads(
      body,
      this.names,
      this.capturedNames,
      this.prep.closedForms
    );
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
      const inner: IROperation[] = [];
      this.bound.set(
        loopScope,
        new Map([
          [
            index,
            list === undefined
              ? indexValue
              : this.element(list, indexValue, node, inner),
          ],
        ])
      );
      this.wrote(loopScope);
      this.changed();
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
        // A loop over a list runs no iteration for an empty list.
        ...(list === undefined ? {} : { ascending: true as const }),
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
    const panels = this.panels;
    this.loops = [];
    this.regions = [];
    this.panels = undefined;
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
      this.panels = panels;
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
 *  integer range), the functions `real-remainder`, `real-gcd` and
 *  `real-lcm` (`_SYS.remainder`, `_SYS.gcd`, `_SYS.lcm`, the same rule),
 *  `replace-at` (`_SYS.replaceAt` throws for an index out of range),
 *  `host`, a function of the host, which can throw and
 *  whose calls the host can count, also when it is declared pure, and
 *  `routine` (`_SYS.integrate` throws the timeout of a deadline). A throw
 *  is not an effect, so the lowering keeps such an operation where the
 *  existing emitter evaluates it (`ifStatement()`).
 *  `bodyThrows` answers for the function of index `i` of the program (a
 *  called function is lowered before its call). */
function canThrow(
  op: IROperation,
  bodyThrows: (i: number) => boolean,
  host = true
): boolean {
  return (
    op.kind === 'mod' ||
    (op.kind === 'binary' &&
      (op.fn === 'real-remainder' ||
        op.fn === 'real-gcd' ||
        op.fn === 'real-lcm')) ||
    op.kind === 'replace-at' ||
    (host && op.kind === 'host') ||
    op.kind === 'routine' ||
    (op.kind === 'call' && bodyThrows(op.function)) ||
    regionsOf(op).some((region) =>
      region.operations.some((inner) => canThrow(inner, bodyThrows, host))
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
  if (pair.has(listType('integer')) && pair.has(listType('real')))
    return listType('real');
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
  memo: Map<Expression, ReadonlySet<string>>,
  captured?: (operator: string) => readonly string[],
  replaced?: ReadonlyMap<Expression, Expression>
): Set<string> {
  const exposed = new Set<string>();
  const reads = (
    node: Expression | undefined,
    written: ReadonlySet<string>
  ) => {
    if (node === undefined) return;
    for (const name of namesIn(node, memo, captured, replaced))
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
 *  paths is walked once. `captured`: the names that a call of the helper of
 *  a head reads where it is called (a local function), which count as names
 *  of the call. */
function namesIn(
  node: Expression,
  memo: Map<Expression, ReadonlySet<string>>,
  captured?: (operator: string) => readonly string[],
  replaced?: ReadonlyMap<Expression, Expression>
): ReadonlySet<string> {
  const closedForm = replaced?.get(node);
  if (closedForm !== undefined)
    return namesIn(closedForm, memo, captured, replaced);
  // The symbol of a local function as a function operand (`Map(lf, L)`)
  // reads the names that a call of it reads.
  if (isSymbol(node))
    return new Set([node.symbol, ...(captured?.(node.symbol) ?? [])]);
  if (!isFunction(node)) return new Set();
  const known = memo.get(node);
  if (known !== undefined) return known;
  const names = new Set<string>(captured?.(node.operator) ?? []);
  for (const operand of node.ops)
    for (const name of namesIn(operand, memo, captured, replaced))
      names.add(name);
  memo.set(node, names);
  return names;
}
