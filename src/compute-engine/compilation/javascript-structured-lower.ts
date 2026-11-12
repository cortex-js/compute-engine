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
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { MAX_MATRIX_POWER_EXPONENT } from '../numerics/value-scaled-caps.js';
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
  FragmentType,
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
  runsRoutine,
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
  collectionResultArray,
  JAVASCRIPT_POLICY,
  verifyJavaScriptProgram,
} from './javascript-structured-policy.js';
import { rootCopyLevels, withOwnedCopies } from './structured-in-place.js';
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
 * - `{ broadcast }`: a scalar head applied to each element of its list
 *   operands (`broadcastRule()` in `javascript-fragment-target.ts`), whose
 *   element is the `BroadcastForm`.
 * - `elementwise-selection`: an `If` or a `Which` whose conditions are
 *   lists of booleans (`selectionBroadcastRule()` in
 *   `javascript-fragment-target.ts`), one `build` over the positions
 *   (`selectionBuild()`).
 * - `list-extremum`: `Max` or `Min` of several operands with a list among
 *   them (`listExtremumRule()` in `javascript-fragment-target.ts`), one
 *   fold over the elements and the scalars (`listExtremum()`).
 * - `list-equality`: `Equal` or `NotEqual` of two lists
 *   (`listEqualityFacts()`), one boolean (`listEquality()`).
 */
export type StructuredForm =
  | { readonly folded: number | { readonly re: number; readonly im: number } }
  | { readonly selected: Expression }
  | { readonly broadcast: BroadcastForm }
  | 'elementwise-selection'
  | 'list-extremum'
  | 'list-equality'
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

/**
 * The code of one element of a scalar head applied to each element of its
 * list operands (`broadcastRule()` in `javascript-fragment-target.ts`): the
 * code of the closure that the existing emitter passes to `_SYS.bcast`,
 * which is the scalar code of the head with every operand an element
 * parameter, never a literal (`L^3` is `_SYS.pow(e, 3)`, not `e*e*e`):
 *
 * - `{ operation }`: the operation of that kind of the operands
 *   (`Math.sqrt(e)`, `Math.floor(e)`, `_SYS.floorMod(e, m)`, `((a) < (b))`,
 *   `((a) <= (b))`, `x === s` and `x !== s` of `_SYS.eq` and `_SYS.neq`
 *   with a number `s`, `!(e)`, `((a) && (b))`, `((a) || (b))`; the second
 *   operand of `and` and `or` is a value read before the operation, as the
 *   closure reads it).
 * - `{ call }`: the function `call` of the operands, with the number
 *   literal `after` as a last operand when it is given
 *   (`_SYS.chop(e, 1e-10)`), as `RealCallForm` writes it.
 * - `clamp`: `Math.min(Math.max(e, lo), hi)`.
 * - `log-quotient`: `(Math.log(e) / Math.log(b))`, the quotient of the
 *   logarithms of the two operands.
 */
export type BroadcastForm =
  | {
      readonly operation:
        | 'sqrt'
        | 'floor'
        | 'mod'
        | 'less'
        | 'less-equal'
        | 'equal'
        | 'not-equal'
        | 'not'
        | 'and'
        | 'or';
    }
  | {
      readonly call: UnaryFunctionName | BinaryFunctionName;
      readonly after?: number;
    }
  | 'clamp'
  | 'log-quotient';

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
   *  for a list, an expression and a complex number (`stored`). */
  readonly value: number | undefined;
  /** The value that the admission typed in place of each read: a number
   *  literal, a list literal of finite real number literals or a list of
   *  such lists (a constant of the program, `capturedList()`), a complex
   *  number literal (`complex`), or an expression (`expression`). */
  readonly stored: Expression;
  /** The value is an expression of the inputs (`x + 1` for `lv`), rewritten
   *  for the angular unit: the existing compiler computes it once per call,
   *  before the body (`const _val_lv = _.x + 1;`), and the lowering computes
   *  it once, in the root region, at its first read (`storedRead()`). */
  readonly expression?: true;
  /** The value is a complex number with finite parts, which the existing
   *  compiler writes as an object at each read (`({ re: -0.5, im: 2 })`). */
  readonly complex?: { readonly re: number; readonly im: number };
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
  /** The integrand in log space (`logSpaceProduct()`), an expression in
   *  the same variables: the `alternative` of the innermost clause, as
   *  the existing emitter writes `_SYS.finiteOr`. */
  readonly alternative?: Expression;
  /** The option `quadrature: 'monte-carlo'`: each clause is the routine
   *  `integrate-sampled` (`_SYS.integrateMC`), with no panel count. */
  readonly sampled?: boolean;
};

/**
 * A derivative or a limit with no closed form, which the existing compiler
 * computes numerically (`numericDerivative()` and `numericLimit()` in
 * `javascript-fragment-target.ts`): the routine `fn` of the body as a
 * function of the variable `name`, at the operands. The annotation types
 * the operands in the scope of the node, then binds the variable, a real,
 * in the scope of the routine and types the body there.
 */
export type StructuredNumericRoutine = {
  readonly fn: 'derivative' | 'limit';
  /** The name of the variable. */
  readonly name: string;
  /** A symbol node of the variable, which the annotation binds. */
  readonly variable: Expression;
  /** The body, an expression in the variable. */
  readonly body: Expression;
  /** The point, then the direction of a limit when it has one. */
  readonly operands: readonly Expression[];
  /** The order of a derivative. */
  readonly order?: number;
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
  /** Each `D`, `ND`, `Apply` of a `Derivative` and `Limit` node of the
   *  program with no closed form, which the existing compiler computes
   *  numerically (`numericRoutine()`). */
  readonly routines?: ReadonlyMap<Expression, StructuredNumericRoutine>;
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
 *  writes it `Power(ExponentialE, x)` (`powerForm()`). The rule of an
 *  element-wise head reads it too (`broadcastRule()` in
 *  `javascript-fragment-target.ts`). */
export const FUNCTIONS: Readonly<
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
  // The matrix functions (slice 3 of
  // `docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`);
  // `Dot` with a list of lists is `matrix-multiply`.
  Determinant: 'determinant',
  Trace: 'trace',
  Transpose: 'transpose',
  RowReduce: 'row-reduce',
  Inverse: 'inverse',
  MatrixPower: 'matrix-power',
  MatrixMultiply: 'matrix-multiply',
  Diagonal: 'diagonal',
  Flatten: 'flatten',
  // `Second` and `Third` are `at` of 2 and 3, `IsEmpty` a test of the
  // `length`, `Most` the `drop` of -1, `Append` the `join` of a list of one
  // element (lowered as `append`).
  Second: 'at',
  Third: 'at',
  IsEmpty: 'length',
  Most: 'drop',
  Append: 'join',
  PopulationVariance: 'population-variance',
  StandardDeviation: 'standard-deviation',
  PopulationStandardDeviation: 'population-standard-deviation',
  Skewness: 'skewness',
  Kurtosis: 'kurtosis',
  Mode: 'mode',
  InterquartileRange: 'interquartile-range',
  Covariance: 'covariance',
  Correlation: 'correlation',
  Ordering: 'ordering',
  IndexOf: 'index-of',
  Contains: 'contains',
  Unique: 'unique',
  Repeat: 'repeat',
  Linspace: 'linspace',
  Slice: 'slice',
};

/** The rank of the engine type `type` when it states one: the number of
 *  its dimensions, or the depth of its nested list types; `0` for a
 *  number, `undefined` for another type (a union, a tensor of no stated
 *  rank). */
function engineRank(type: Type): number | undefined {
  if (typeof type === 'string')
    return isSubtype(type, 'number') ? 0 : undefined;
  if (type.kind !== 'list') return undefined;
  if (type.dimensions === null) return undefined;
  const own = type.dimensions?.length ?? 1;
  const inner = engineRank(type.elements);
  return inner === undefined ? undefined : own + inner;
}

/** The dimensions that the list type `type` states, from the outer one,
 *  `-1` for one that it does not state (the length of a `list<…>`), or
 *  `undefined` for a type that is not a list of a stated rank of numbers. */
function engineDimensions(type: Type): readonly number[] | undefined {
  if (typeof type === 'string' || type.kind !== 'list') return undefined;
  if (type.dimensions === null) return undefined;
  if (type.dimensions !== undefined)
    return typeof type.elements === 'string' &&
      isSubtype(type.elements, 'number')
      ? type.dimensions
      : undefined;
  if (typeof type.elements === 'string')
    return isSubtype(type.elements, 'number') ? [-1] : undefined;
  const inner = engineDimensions(type.elements);
  return inner === undefined ? undefined : [-1, ...inner];
}

/** Whether the value of `node` is a matrix of one row or more by its type:
 *  a stated number of rows of 1 or more, or the engine type `matrix`
 *  (rectangular, of one row or more: the engine types the empty list
 *  `list<never>`) of a name (an input or a parameter, whose value the host
 *  or the caller gives of its type), of a list literal, or of an
 *  element-wise result of such a matrix (`M + x`, which has its rows). */
export function hasRows(node: Expression): boolean {
  const type = node.type.type;
  const dimensions = engineDimensions(type);
  if (dimensions === undefined || dimensions.length !== 2) return false;
  if (dimensions[0] >= 1) return true;
  // A stated count of no row (`matrix<0x3>`).
  if (dimensions[0] === 0) return false;
  if (
    isFunction(node) &&
    ['Add', 'Multiply', 'Negate', 'Divide'].includes(node.operator) &&
    isLibraryOperator(node, node.operator)
  )
    return node.ops.some(hasRows);
  return (
    typeof type === 'object' &&
    type.kind === 'list' &&
    type.dimensions?.length === 2 &&
    (isSymbol(node) || isFunction(node, 'List'))
  );
}

/**
 * Whether the matrix function `node` (a head of `COLLECTION_HEADS` with a
 * `collection` name of a matrix function, or `Dot` of a list of lists) can
 * have no value: its result is then a number in place of the list (`NaN`
 * for a singular inverse; `0` for a product of two empty lists), or a list
 * of `NaN` of a lower rank (`MatrixMultiply(A, Inverse(B))` with `B`
 * singular is `[NaN, NaN]`), as the
 * runtime helper of the existing emitter gives it
 * (`docs/plans/2026-11-11-structured-nested-lists-and-matrices.md`, section
 * 4). `ranks` are the ranks of the operands (0 for a number). Decided from
 * the types only, and true when the types do not prove a value:
 *
 * - `Inverse`: a singular matrix.
 * - `MatrixPower(M, p)`: unless `M` has rows by its type (`hasRows()`) and
 *   `p` is an integer literal from 0 to the limit of the interpreter (a
 *   negative exponent inverts; `_SYS.matpow` of the empty list is `NaN`).
 * - `RowReduce(M)`: unless `M` has rows by its type (`_SYS.rref([])` is
 *   `NaN`).
 * - `MatrixMultiply` and `Dot`: a matrix and a matrix unless the columns of
 *   the first and the rows of the second are stated and agree; a matrix and
 *   a list unless the matrix has rows by its type (`_SYS.matmul` reads the
 *   empty list as a list); a list and a matrix unless the length of the
 *   list and the rows of the matrix are stated and agree.
 * - `Multiply` of two lists, one a matrix (a matrix product, `_SYS.mul`):
 *   unless the inner dimensions are stated and agree, also for a matrix and
 *   a list (`_SYS.mul` gives `NaN` for dimensions that do not agree). Of a
 *   number and a list: never (an element-wise product).
 * - Every matrix function with a list result whose list operand can have
 *   no value (`Transpose(Inverse(M))`).
 */
export function matrixResultCanBeAbsent(
  node: Expression,
  ranks: readonly number[]
): boolean {
  if (!isFunction(node)) return false;
  // The value of a `Block` is its last operand
  // (`Transpose(Block(Declare(B, …), Inverse(B)))`): the admission refuses
  // every other carrier of a value that can be absent (a local, an `If`, a
  // `Typed`, the value of a helper; `refuseAbsentMatrixUses()`).
  const valueOf = (op: Expression): Expression => {
    while (isFunction(op, 'Block') && op.nops > 0) op = op.ops[op.nops - 1];
    return op;
  };
  const absentOperand = node.ops.some((operand, i) => {
    const op = valueOf(operand);
    return (
      ranks[i] !== undefined &&
      ranks[i] >= 1 &&
      isFunction(op) &&
      Object.hasOwn(MATRIX_RESULT_HEADS, op.operator) &&
      matrixResultCanBeAbsent(
        op,
        op.ops.map((o) => engineRank(o.type.type) ?? -1)
      )
    );
  });
  if (absentOperand) return true;
  switch (node.operator) {
    case 'Inverse':
      return true;
    case 'MatrixPower': {
      const p = node.op2;
      return !(
        hasRows(node.op1) &&
        isNumber(p) &&
        p.im === 0 &&
        Number.isInteger(p.re) &&
        p.re >= 0 &&
        p.re <= MAX_MATRIX_POWER_EXPONENT
      );
    }
    case 'RowReduce':
      return !hasRows(node.op1);
    case 'Multiply': {
      if (
        node.nops !== 2 ||
        !ranks.every((r) => r >= 1) ||
        !ranks.some((r) => r === 2)
      )
        return false;
      const [a, b] = node.ops;
      const da = engineDimensions(a.type.type);
      const db = engineDimensions(b.type.type);
      if (da === undefined || db === undefined) return true;
      const inner = da[da.length - 1];
      return !(inner >= 1 && inner === db[0] && da[0] >= 1);
    }
    case 'MatrixMultiply':
    case 'Dot': {
      const [a, b] = node.ops;
      const da = engineDimensions(a.type.type);
      const db = engineDimensions(b.type.type);
      if (ranks[0] === 2 && ranks[1] === 2)
        return !(
          da !== undefined &&
          db !== undefined &&
          da[0] >= 1 &&
          da[1] >= 1 &&
          da[1] === db[0]
        );
      if (ranks[0] === 2 && ranks[1] === 1) return !hasRows(a);
      if (ranks[0] === 1 && ranks[1] === 2)
        return !(
          da !== undefined &&
          db !== undefined &&
          da[0] >= 1 &&
          da[0] === db[0]
        );
      return true;
    }
  }
  return false;
}

/** The functions of lists that are matrix functions: a list result of one
 *  can have no value (`matrixResultCanBeAbsent()`). */
const MATRIX_FUNCTIONS: ReadonlySet<CollectionFunctionName> = new Set([
  'determinant',
  'trace',
  'transpose',
  'row-reduce',
  'inverse',
  'matrix-power',
  'matrix-multiply',
  'matrix-product',
  'diagonal',
  'flatten',
] as const);

/** The rank of a value of the type `type`: 0 for a scalar or a tuple, and
 *  the depth of its list types for a list. */
function rankOf(type: ValueType): number {
  const element = elementOf(type);
  return element === undefined ? 0 : 1 + rankOf(element);
}

/** The heads of the matrix functions with a list result, which can have no
 *  value (`matrixResultCanBeAbsent()`). */
const MATRIX_RESULT_HEADS: Readonly<Record<string, true>> = {
  Multiply: true,
  Inverse: true,
  MatrixPower: true,
  RowReduce: true,
  MatrixMultiply: true,
  Dot: true,
  Transpose: true,
  Diagonal: true,
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
  CountIf: { fn: 1, arity: 1 },
  Any: { fn: 1, arity: 1 },
  All: { fn: 1, arity: 1 },
  Find: { fn: 1, arity: 1 },
  IndexWhere: { fn: 1, arity: 1 },
  Position: { fn: 1, arity: 1 },
  TakeWhile: { fn: 1, arity: 1 },
  DropWhile: { fn: 1, arity: 1 },
  Tabulate: { fn: 0, arity: 1 },
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
 * rule of the head checks; or with `T` a list type (`vector`, `list<real>`,
 * the type of a row of a list of lists): `type` is `list`, and `list` the
 * spelling of `T`, which the rule of the head checks.
 */
export function functionOperandParts(
  fn: Expression,
  arity: number
):
  | {
      readonly parameters: readonly {
        readonly symbol: Expression & { symbol: string };
        readonly type?: 'integer' | 'real' | 'number' | 'tuple' | 'list';
        readonly tuple?: string;
        readonly list?: string;
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
    type?: 'integer' | 'real' | 'number' | 'tuple' | 'list';
    tuple?: string;
    list?: string;
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
    if (spelling !== undefined && /^(list|vector|matrix)\b/.test(spelling)) {
      parameters.push({ symbol: p.op1, type: 'list', list: spelling });
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
  // A list of booleans: the value of an element-wise comparison.
  if (element !== 'real' && element !== 'integer' && element !== 'boolean')
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
  const program = withOwnedCopies(new Lowering(preparation).program());
  if (rootCopyLevels(program) === 'deep')
    throw new StructuredDeclineError(
      'the value of the program is a list of rank 3 or more, and the ' +
        'program reads a captured list: a row of the value can hold the ' +
        'captured list, which every call shares, below the two levels ' +
        'that the profile copies'
    );
  return program;
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
  /** The body of the innermost loop whose body is being lowered: in its
   *  statements, an `If` with a branch that ends in `Continue` holds the
   *  statements after it (`statements()`). */
  private loopBody: Expression | undefined;
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
    return namesIn(node, this.names, this.capturedNames, this.nameSources());
  }

  /** The expression whose names stand for the names of a node: the closed
   *  form of a calculus node, and for a derivative or a limit computed
   *  numerically a list of its operands and its body (which can be the
   *  body of a user function, not an operand of the node). */
  private nameSourceMap: ReadonlyMap<Expression, Expression> | undefined;
  private nameSources(): ReadonlyMap<Expression, Expression> | undefined {
    const routines = this.prep.routines;
    if (routines === undefined || routines.size === 0)
      return this.prep.closedForms;
    if (this.nameSourceMap === undefined) {
      const map = new Map(this.prep.closedForms ?? []);
      for (const [node, routine] of routines)
        map.set(
          node,
          node.engine._fn('List', [...routine.operands, routine.body])
        );
      this.nameSourceMap = map;
    }
    return this.nameSourceMap;
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
    // its calls (`IRHostCall`). Neither is a routine, also a pure `limit` or
    // `derivative`, nor a value whose operations run one (in a region or in
    // the body of a called function): each occurrence runs its body, as
    // the existing code does (`IRRoutine`).
    for (let i = start; i < operations.length; i++) {
      const op = operations[i];
      if (
        op.effect !== 'pure' ||
        operationCanAbort(op, this.functions) ||
        reachesHost(op, this.functions) ||
        runsRoutine(op, this.functions)
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
    // `Return(v)` in tail position of a function body (the admission).
    if (operator === 'Return') return this.value(node.ops[0], scope, operations);

    // A derivative or a limit with no closed form (`numericRoutine()`).
    const routine = this.prep.routines?.get(node);
    if (routine !== undefined)
      return this.inScope(scope.inner.get(node), () =>
        this.numericRoutine(node, routine, facts, scope, operations)
      );

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
    // A head of a test operation (`Trace` of the tests) is not a function
    // of lists.
    if (
      Object.hasOwn(COLLECTION_HEADS, operator) &&
      !this.prep.testOperations.has(operator)
    )
      return this.collection(node, facts, scope, operations);

    // The branch that the constant conditions select (`decidedBranch()`).
    const selected = this.prep.forms.get(node);
    if (typeof selected === 'object' && 'selected' in selected)
      return this.value(selected.selected, scope, operations);

    // A scalar head applied to each element of its list operands
    // (`broadcastRule()` in `javascript-fragment-target.ts`).
    if (typeof selected === 'object' && 'broadcast' in selected)
      return this.elementwise(
        node,
        facts,
        scope,
        operations,
        effect,
        selected.broadcast
      );
    if (selected === 'elementwise-selection')
      return this.selectionBuild(node, facts, scope, operations, effect);
    if (selected === 'list-extremum')
      return this.listExtremum(node, facts, scope, operations);
    if (selected === 'list-equality')
      return this.listEquality(node, facts, scope, operations);

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
      // A list argument at a real or integer parameter: the helper applied
      // to each element (`mapsListArguments` of the definition).
      const signature = entry.type;
      if (
        signature.kind === 'function' &&
        args.some((v, i) => this.mapsArgument(signature, v, i))
      )
        return this.elementCall(operator, node, args, facts, operations, effect);
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

    // `At(L, x)` of a list of numbers with a real index, and `At(L, I)` with
    // a list of indexes (a list literal, a `Range`, a list name): a read at a
    // real index (`at-real`) and a gather (`gather`), as the existing emitter
    // writes both, `_SYS.atNumeric(L, i, "real")` (`atRule()`).
    if (operator === 'At' && node.nops === 2) {
      const operands = this.operands(node, facts, scope, operations);
      const fn =
        operands[1].type === 'real'
          ? 'at-real'
          : isListType(operands[1].type)
            ? 'gather'
            : undefined;
      if (fn !== undefined) {
        const result = this.resultOf(facts);
        operations.push({
          kind: 'collection',
          fn,
          ...collectionResultArray(JAVASCRIPT_POLICY, fn),
          result,
          operands,
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      const result = this.resultOf(facts);
      operations.push({ kind: 'at', result, operands, effect, origin: node });
      return result;
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
    // The general form: several generators, a list, a range with a step.
    if (
      inner !== undefined &&
      !(
        node.ops.length === 2 &&
        isFunction(spec, 'Element') &&
        isFunction(spec.op2, 'Range') &&
        spec.op2.nops === 2
      )
    )
      return this.nestedBuild(node, facts, scope, inner, operations, effect);
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
    if (countFits([spec.op2.op1, spec.op2.op2]))
      FITTING_COUNTS.add(operations.at(-1)!);
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

  /**
   * `Comprehension(body, g_1, …, g_n)` of the general form, which the rule
   * of `Comprehension` checked (`comprehensionClauses()` in
   * `javascript-fragment-target.ts`): the code of the existing emitter
   * (`compileComprehension()` and `compileElementLoops()` in
   * `compile-loops.ts`), `const result = []; for (…) { for (…) { if (filter)
   * result.push(body); } }`. One `loop` per generator, the first
   * outermost, each carrying the list from the empty `list`: the source of
   * a generator is evaluated in the body of the loop before it (where the
   * node is, for the first), once per pass there; a range visits its
   * integers in steps of 1, or of -1 when `b < a`, and tests its count
   * before its first pass (`checksCount`), as `compileCountedRange()`
   * does; a list is visited from its first element (`ascending`). A filter
   * is an `if` whose first branch runs the loops of the later generators,
   * or `append`s the body, and whose other branch yields the list as it
   * is. No pass is counted against the iteration budget, as on the
   * existing emitter. The indexes are bound in the one scope `inner`.
   */
  private nestedBuild(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    inner: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const type = valueType(facts.type);
    if (!isListType(type))
      return fail(`the comprehension ${nodeText(node)} does not make a list`);
    const body = node.ops[0];
    const specs = node.ops.slice(1) as (Expression & {
      ops: readonly Expression[];
    })[];
    const empty = this.newValue(type, 'array');
    operations.push({
      kind: 'list',
      result: empty,
      operands: [],
      effect: 'pure',
      origin: node,
    });
    this.bound.set(inner, new Map());
    this.wrote(inner);
    this.changed();
    // The loop of the generator `i`, at the end of `into`, evaluated in
    // `at`, with the list `acc` before it: the list after it.
    const level = (
      i: number,
      at: FragmentScope<ScalarRepresentation>,
      into: IROperation[],
      acc: IRValue
    ): IRValue => {
      const spec = specs[i];
      const [binder, source, guard] = spec.ops;
      if (!isSymbol(binder) || source === undefined)
        return fail(`no lowering for the generator ${nodeText(spec)}`);
      const range =
        isFunction(source, 'Range') && source.nops === 2 ? source : undefined;
      let from: IRValue;
      let to: IRValue;
      let list: IRValue | undefined;
      if (range !== undefined) {
        [from, to] = range.ops.map((b) => {
          const value = this.value(b, at, into);
          if (value.type !== 'integer')
            fail(`the bound ${nodeText(b)} of a comprehension is not an integer`);
          return value;
        });
      } else {
        list = this.value(source, at, into);
        [from, to] = this.elementRange(list, node, into);
      }
      const index = this.newValue('integer', 'number');
      const carried = this.newValue(type, 'array');
      const bodyOperations: IROperation[] = [];
      const next = this.inRegion(bodyOperations, () => {
        const indexes = new Map(this.bound.get(inner) ?? []);
        indexes.set(
          binder.symbol,
          list === undefined
            ? index
            : this.element(list, index, node, bodyOperations)
        );
        this.bound.set(inner, indexes);
        this.wrote(inner);
        this.changed();
        const rest = (ops: IROperation[]): IRValue => {
          if (i + 1 < specs.length) return level(i + 1, inner, ops, carried);
          const element = this.value(body, inner, ops);
          const appended = this.newValue(type, 'array');
          ops.push({
            kind: 'append',
            result: appended,
            operands: [carried, element],
            effect: 'pure',
            origin: node,
          });
          return appended;
        };
        if (guard === undefined) return rest(bodyOperations);
        return this.conditional(
          this.value(guard, inner, bodyOperations),
          rest,
          () => carried,
          node,
          bodyOperations
        );
      });
      const region: IRRegion = {
        ...this.region(bodyOperations, body, next),
        parameters: [index, carried],
      };
      const result = this.newValue(type, 'array');
      into.push({
        kind: 'loop',
        results: [result],
        operands: [from, to, acc],
        body: region,
        effect: joinEffects(i === 0 ? effect : 'pure', region.effect),
        ...touchesField(i === 0 ? this.states(node) : undefined, region.touches),
        ...(list === undefined
          ? testsRangeCount(source, false)
            ? { checksCount: true as const }
            : {}
          : { ascending: true as const }),
        origin: node,
      });
      return result;
    };
    return level(0, scope, operations, empty);
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
    operations: IROperation[],
    inRange = false
  ): IRValue {
    const type = list.type;
    const element = isTupleType(type)
      ? type.elements[0]
      : (elementOf(type) ?? fail(`${nodeText(origin)} reads no list`));
    // A tuple of a list of tuples and a row of a list of lists are arrays;
    // an element of a list of booleans is a boolean.
    const result = this.newValue(
      element,
      isTupleType(element) || isListType(element)
        ? 'array'
        : element === 'boolean'
          ? 'boolean'
          : 'number'
    );
    operations.push({
      kind: 'at',
      result,
      operands: [list, index],
      effect: 'pure',
      origin,
      ...(inRange ? { inRange } : {}),
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
    if (
      isListType(type) &&
      (kind === 'add' || kind === 'multiply') &&
      isListType(elementOf(collection.type)!)
    )
      return this.foldRows(kind, collection, type, node, operations, effect);
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
   * `Sum(M)` or `Product(M)` of the rows of a matrix `M` of one row or more
   * (`withFoldOfRows()` in `javascript-fragment-target.ts`), as the existing
   * emitter writes it, `(M).reduce((_a, _b) => _SYS.add(_a, _b), 0)`: the
   * first row added to (multiplied by) the integer `0` (`1`) element by
   * element, a `build` over the first row whose element is `0 + x`
   * (`1 * x`), as `_SYS.add(0, row)` gives it; then a `loop` over the other
   * rows, from 2 to the number of rows, whose carried value is the list so
   * far and whose body is a `build` of the sum (product) of its elements and
   * of the elements of the row, in this order. The rows of a matrix have
   * one length, so each `build` runs over the length of the list so far.
   */
  private foldRows(
    kind: 'add' | 'multiply',
    collection: IRValue,
    type: ListType,
    node: Expression,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const element = elementOf(type) as ScalarKind;
    /** The `build` of `kind` of `left` (a number or a list) and of the
     *  elements of the list `right`, over the length of `right`. */
    const combine = (
      left: IRValue,
      right: IRValue,
      into: IROperation[]
    ): IRValue => {
      const [one, length] = this.elementRange(right, node, into);
      const index = this.newValue('integer', 'number');
      const body: IROperation[] = [];
      const a = isListType(left.type)
        ? this.element(left, index, node, body)
        : left;
      const b = this.element(right, index, node, body);
      const value = this.newValue(element, 'number');
      body.push({
        kind,
        result: value,
        operands: [a, b],
        effect: 'pure',
        origin: node,
      });
      const region: IRRegion = {
        ...this.region(body, node, value),
        parameters: [index],
      };
      const result = this.newValue(type, 'array');
      into.push({
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
    };
    const first = this.element(
      collection,
      this.numberLiteral(1, 'integer', node, operations),
      node,
      operations
    );
    const initial = combine(
      this.numberLiteral(kind === 'add' ? 0 : 1, 'integer', node, operations),
      first,
      operations
    );
    const two = this.numberLiteral(2, 'integer', node, operations);
    const rows = this.newValue('integer', 'number');
    operations.push({
      kind: 'length',
      result: rows,
      operands: [collection],
      effect: 'pure',
      origin: node,
    });
    const index = this.newValue('integer', 'number');
    const accumulator = this.newValue(type, 'array');
    const body: IROperation[] = [];
    const next = combine(
      accumulator,
      this.element(collection, index, node, body),
      body
    );
    const region: IRRegion = {
      ...this.region(body, node, next),
      parameters: [index, accumulator],
    };
    const result = this.newValue(type, 'array');
    operations.push({
      kind: 'loop',
      results: [result],
      operands: [two, rows, initial],
      body: region,
      effect: region.effect,
      ...touchesField(region.touches),
      ascending: true,
      origin: node,
    });
    return result;
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
   *
   * Another scalar head (`broadcastRule()`) has the same `build`, whose body
   * applies the element form `form` to the elements and to the values of
   * the scalar operands (`broadcastElement()`).
   */
  private elementwise(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact,
    form?: BroadcastForm
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
    // `Exp(L)` is `Power(ExponentialE, L)`, whose base the preparation of
    // the existing compiler keeps as the symbol: the closure of `_SYS.bcast`
    // reads it as `Math.E`.
    const values =
      form !== undefined && isSymbol(node.ops[0], 'ExponentialE')
        ? node.ops.map((operand, i) =>
            i === 0
              ? this.numberLiteral(Math.E, 'real', node, operations)
              : this.convert(
                  this.value(operand, scope, operations),
                  facts.conversions?.[i],
                  node,
                  operations
                )
          )
        : this.operands(node, facts, scope, operations);
    const type = valueType(facts.type);
    // A product of two lists, one a matrix (`nestedElementwise()`): the
    // matrix product, `_SYS.mul(A, B)`.
    if (
      form === undefined &&
      operator === 'Multiply' &&
      values.length === 2 &&
      values.every((v) => isListType(v.type)) &&
      values.some((v) => rankOf(v.type) === 2)
    ) {
      const result = this.resultOf(facts);
      const absent = matrixResultCanBeAbsent(
        node,
        values.map((v) => rankOf(v.type))
      );
      operations.push({
        kind: 'collection',
        fn: 'matrix-product',
        ...collectionResultArray(JAVASCRIPT_POLICY, 'matrix-product'),
        result,
        operands: values,
        effect: 'pure',
        origin: node,
        ...(absent ? { absent: true as const } : {}),
      });
      return result;
    }
    // One `build` per level of a list of lists (`nestedElementwise()` in
    // `javascript-fragment-target.ts`): its body reads the element of each
    // list operand at the index, a row at an outer level, and applies the
    // operation of the head to the numbers at the last level; the scalar
    // operands are the values evaluated once, before the outer `build`.
    const level = (
      operands: readonly IRValue[],
      levelType: ValueType,
      result: IRValue,
      ops: IROperation[]
    ): IRValue => {
      const list =
        operands.find((v) => isListType(v.type)) ??
        fail(`no list operand in ${nodeText(node)}`);
      const element =
        elementOf(levelType) ?? fail(`${nodeText(node)} is not a list`);
      const [one, length] = this.elementRange(list, node, ops);
      const index = this.newValue('integer', 'number');
      const body: IROperation[] = [];
      const elements = operands.map((v) =>
        isListType(v.type) ? this.element(v, index, node, body, true) : v
      );
      let value: IRValue;
      if (isListType(element))
        value = level(
          elements,
          element,
          this.newValue(element, 'array'),
          body
        );
      else if (form !== undefined)
        value = this.broadcastElement(form, elements, element, node, body);
      else {
        value = this.newValue(element, 'number');
        body.push({
          kind,
          result: value,
          operands: elements,
          effect: 'pure',
          origin: node,
        });
      }
      const region: IRRegion = {
        ...this.region(body, node, value),
        parameters: [index],
      };
      ops.push({
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
    };
    return level(values, type, this.resultOf(facts), operations);
  }

  /**
   * `Max` or `Min` of several operands with a list among them
   * (`listExtremumRule()` in `javascript-fragment-target.ts`), as the
   * existing emitter writes it: the operands evaluated once, in order, then
   * one accumulator from `-Infinity` (`Infinity`) and, for each operand in
   * order, a `loop` over the elements of a list (over the rows, then their
   * elements, for a list of lists, as `_p0.flat(Infinity)` reads them) or
   * one step with a scalar, each step `Math.max(acc, x)` (`Math.min`). When
   * every operand is a list, the value is `NaN` if they have no element,
   * as the existing closure counts them (`_n === 0 ? NaN : _a`).
   */
  private listExtremum(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const kind = node.operator === 'Max' ? 'max' : 'min';
    const type = valueType(facts.type);
    const values = this.operands(node, facts, scope, operations);
    const step = (acc: IRValue, x: IRValue, into: IROperation[]): IRValue => {
      const result = this.newValue(type, 'number');
      into.push({ kind, result, operands: [acc, x], effect: 'pure', origin: node });
      return result;
    };
    const fold = (list: IRValue, acc: IRValue, into: IROperation[]): IRValue => {
      const [one, length] = this.elementRange(list, node, into);
      const index = this.newValue('integer', 'number');
      const accumulator = this.newValue(type, 'number');
      const body: IROperation[] = [];
      const next = this.inRegion(body, () => {
        const x = this.element(list, index, node, body, true);
        return isListType(x.type)
          ? fold(x, accumulator, body)
          : step(accumulator, x, body);
      });
      const region: IRRegion = {
        ...this.region(body, node, next),
        parameters: [index, accumulator],
      };
      const result = this.newValue(type, 'number');
      into.push({
        kind: 'loop',
        results: [result],
        operands: [one, length, acc],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        ascending: true,
        origin: node,
      });
      return result;
    };
    let acc = this.numberLiteral(
      kind === 'max' ? -Infinity : Infinity,
      'real',
      node,
      operations
    );
    for (const v of values)
      acc = isListType(v.type) ? fold(v, acc, operations) : step(acc, v, operations);
    if (!values.every((v) => isListType(v.type))) return acc;
    // Every operand a list (of one level, by the rule): `NaN` when the sum
    // of their lengths is 0.
    const lengths = values.map((v) => this.elementRange(v, node, operations)[1]);
    let count = lengths[0];
    if (lengths.length > 1) {
      count = this.newValue('integer', 'number');
      operations.push({
        kind: 'add',
        result: count,
        operands: lengths,
        effect: 'pure',
        origin: node,
      });
    }
    const empty = this.newValue('boolean', 'boolean');
    operations.push({
      kind: 'equal',
      result: empty,
      operands: [count, this.numberLiteral(0, 'integer', node, operations)],
      effect: 'pure',
      origin: node,
    });
    const folded = acc;
    return this.conditional(
      empty,
      (into) => this.numberLiteral(NaN, 'real', node, into),
      () => folded,
      node,
      operations
    );
  }

  /**
   * `Equal(A, B)` or `NotEqual(A, B)` of two lists of numbers
   * (`listEqualityFacts()` in `javascript-fragment-target.ts`), the value of
   * the existing emitter's `_SYS.eq(A, B)` (`eqTensor()`): the operands
   * evaluated once, in order, then `true` when the lengths are equal and a
   * `loop` over the elements finds every pair `===` (`NaN` equals nothing,
   * `0` and `-0` are equal); the loop runs only when the lengths are equal,
   * and reads no element out of range. `NotEqual` is the negation. Every
   * operation is pure, so the loop does not stop at the first pair that
   * differs, where `eqTensor()` does: the value is the same.
   */
  private listEquality(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const [a, b] = this.operands(node, facts, scope, operations);
    const [one, length] = this.elementRange(a, node, operations);
    const other = this.elementRange(b, node, operations)[1];
    const sameLength = this.newValue('boolean', 'boolean');
    operations.push({
      kind: 'equal',
      result: sameLength,
      operands: [length, other],
      effect: 'pure',
      origin: node,
    });
    const pairs: IROperation[] = [];
    const every = this.inRegion(pairs, () => {
      const index = this.newValue('integer', 'number');
      const accumulator = this.newValue('boolean', 'boolean');
      const body: IROperation[] = [];
      const equal = this.newValue('boolean', 'boolean');
      body.push({
        kind: 'equal',
        result: equal,
        operands: [
          this.element(a, index, node, body, true),
          this.element(b, index, node, body, true),
        ],
        effect: 'pure',
        origin: node,
      });
      const next = this.newValue('boolean', 'boolean');
      body.push({
        kind: 'and',
        result: next,
        operands: [accumulator],
        rest: [this.region([], node, equal)],
        effect: 'pure',
        origin: node,
      });
      const region: IRRegion = {
        ...this.region(body, node, next),
        parameters: [index, accumulator],
      };
      const result = this.newValue('boolean', 'boolean');
      const initial = this.newValue('boolean', 'boolean');
      pairs.push({
        kind: 'literal',
        result: initial,
        value: true,
        operands: [],
        effect: 'pure',
        origin: node,
      });
      pairs.push({
        kind: 'loop',
        results: [result],
        operands: [one, length, initial],
        body: region,
        effect: 'pure',
        ascending: true,
        origin: node,
      });
      return result;
    });
    const equal = this.newValue('boolean', 'boolean');
    operations.push({
      kind: 'and',
      result: equal,
      operands: [sameLength],
      rest: [this.region(pairs, node, every)],
      effect: 'pure',
      origin: node,
    });
    if (node.operator === 'Equal') return equal;
    const result = this.resultOf(facts);
    operations.push({
      kind: 'not',
      result,
      operands: [equal],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /**
   * An `If` or a `Which` whose conditions are lists of booleans
   * (`selectionBroadcastRule()` in `javascript-fragment-target.ts`): the
   * conditions in clause order, then the arms in clause order, each
   * evaluated once, then one `build` over the positions of the first
   * condition, from 1 to its length, whose body is the chain of `if` of
   * the clauses: at each position, the element of the first condition that
   * holds there selects its arm (the element of a list arm, or the value of
   * a scalar arm); a last clause `True` (the third operand of `If`) is the
   * default; with no default, `NaN`. The rule admitted lists of one
   * length; an arm with an operation that is not pure or that can throw,
   * abort or reach the host declines here.
   */
  private selectionBuild(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const ops = node.ops;
    // The clauses: a condition (absent for the default clause) and an arm.
    const pairs: { condition?: number; arm: number }[] = [];
    if (node.operator === 'If') {
      pairs.push({ condition: 0, arm: 1 });
      if (ops.length === 3) pairs.push({ arm: 2 });
    } else
      for (let i = 0; i + 1 < ops.length; i += 2)
        pairs.push(
          i === ops.length - 2 && isSymbol(ops[i], 'True')
            ? { arm: i + 1 }
            : { condition: i, arm: i + 1 }
        );
    const operand = (i: number): IRValue =>
      this.convert(
        this.value(ops[i], scope, operations),
        facts.conversions?.[i],
        node,
        operations
      );
    const conditions = pairs.map((p) =>
      p.condition === undefined ? undefined : operand(p.condition)
    );
    // Every arm is evaluated, where `selectWith()` evaluates an arm only
    // when a position selects it: the two agree only for arms whose
    // operations are pure and cannot throw, abort or reach the host.
    const armsStart = operations.length;
    const arms = pairs.map((p) => operand(p.arm));
    for (let i = armsStart; i < operations.length; i++) {
      const op = operations[i];
      if (
        op.effect !== 'pure' ||
        this.canThrow(op) ||
        operationCanAbort(op, this.functions) ||
        reachesHost(op, this.functions)
      )
        throw new StructuredDeclineError(
          `${node.operator} with the list condition ${nodeText(ops[0])} is not in ` +
            `the profile: an arm has an operation that can draw, throw, abort or ` +
            `reach the host (${nodeText(op.origin)}), and the profile evaluates ` +
            `every arm, where the existing compiler evaluates an arm only where a ` +
            `position selects it`
        );
    }
    const [one, length] = this.elementRange(conditions[0]!, node, operations);
    const index = this.newValue('integer', 'number');
    const body: IROperation[] = [];
    const armAt = (k: number, into: IROperation[]): IRValue =>
      isListType(arms[k].type)
        ? this.element(arms[k], index, node, into, true)
        : arms[k];
    const chain = (k: number, into: IROperation[]): IRValue => {
      if (k === pairs.length)
        return this.numberLiteral(NaN, 'real', node, into);
      const condition = conditions[k];
      if (condition === undefined) return armAt(k, into);
      const test = this.element(condition, index, node, into, true);
      return this.conditional(
        test,
        (inner) => armAt(k, inner),
        (inner) => chain(k + 1, inner),
        node,
        into
      );
    };
    const value = this.inRegion(body, () => chain(0, body));
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
   * The element of an element-wise head (`BroadcastForm`) at the end of
   * `operations`: the operation of the form applied to `operands`, the
   * elements of the list operands and the values of the scalar operands,
   * in the order of the operands, with a result of the type `type` (a
   * real, or a boolean for a comparison). Each operation is `pure`.
   */
  private broadcastElement(
    form: BroadcastForm,
    operands: readonly IRValue[],
    type: ValueType,
    origin: Expression,
    operations: IROperation[]
  ): IRValue {
    const push = (
      op:
        | { kind: 'unary'; fn: UnaryFunctionName }
        | { kind: 'binary'; fn: BinaryFunctionName }
        | {
            kind:
              | 'sqrt'
              | 'floor'
              | 'mod'
              | 'less'
              | 'less-equal'
              | 'equal'
              | 'not-equal'
              | 'not'
              | 'min'
              | 'max'
              | 'divide';
          },
      args: readonly IRValue[],
      result: IRValue = this.newValue(
        type,
        type === 'boolean' ? 'boolean' : 'number'
      )
    ): IRValue => {
      operations.push({
        ...op,
        result,
        operands: args,
        effect: 'pure',
        origin,
      } as IROperation);
      return result;
    };
    const real = () => this.newValue('real', 'number');
    if (form === 'clamp')
      return push({ kind: 'min' }, [
        push({ kind: 'max' }, [operands[0], operands[1]], real()),
        operands[2],
      ]);
    if (form === 'log-quotient')
      return push({ kind: 'divide' }, [
        push({ kind: 'unary', fn: 'ln' }, [operands[0]], real()),
        push({ kind: 'unary', fn: 'ln' }, [operands[1]], real()),
      ]);
    if ('operation' in form && (form.operation === 'and' || form.operation === 'or')) {
      // `((a) && (b) && (c))`: each later operand is a value of the body,
      // which its region yields.
      const result = this.newValue('boolean', 'boolean');
      operations.push({
        kind: form.operation,
        result,
        operands: [operands[0]],
        rest: operands.slice(1).map((v) => this.region([], origin, v)),
        effect: 'pure',
        origin,
      });
      return result;
    }
    if ('operation' in form)
      return push(
        { kind: form.operation as Exclude<typeof form.operation, 'and' | 'or'> },
        operands
      );
    const args =
      form.after === undefined
        ? operands
        : [...operands, this.numberLiteral(form.after, 'real', origin, operations)];
    return push(
      args.length === 1
        ? { kind: 'unary', fn: form.call as UnaryFunctionName }
        : { kind: 'binary', fn: form.call as BinaryFunctionName },
      args
    );
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
      // A matrix function whose list result can have no value
      // (`matrixResultCanBeAbsent()`).
      const absent =
        MATRIX_FUNCTIONS.has(fn) &&
        isListType(result.type) &&
        matrixResultCanBeAbsent(
          node,
          values.map((v) => rankOf(v.type))
        );
      operations.push({
        kind: 'collection',
        fn,
        ...collectionResultArray(JAVASCRIPT_POLICY, fn),
        result,
        operands: values,
        effect: 'pure',
        origin: node,
        ...(absent ? { absent: true as const } : {}),
      });
      return result;
    };
    const nested = operands.some((o) => {
      const element = elementOf(o.type);
      return element !== undefined && isListType(element);
    });
    switch (operator) {
      case 'Determinant':
      case 'Trace':
      case 'Transpose':
      case 'RowReduce':
      case 'Inverse':
      case 'MatrixPower':
      case 'Diagonal':
      case 'Flatten':
        return push(COLLECTION_HEADS[operator] as CollectionFunctionName, operands);
      // A product of two lists is their inner product, as `Dot` is.
      case 'MatrixMultiply':
        return push(nested ? 'matrix-multiply' : 'dot', operands);
      case 'Norm':
      case 'Mean':
      case 'Median':
      case 'Variance':
      case 'Take':
      case 'Drop':
      case 'Reverse':
      case 'Sort':
      case 'Join':
      case 'ListJoin':
      case 'PopulationVariance':
      case 'StandardDeviation':
      case 'PopulationStandardDeviation':
      case 'Skewness':
      case 'Kurtosis':
      case 'Mode':
      case 'InterquartileRange':
      case 'Covariance':
      case 'Correlation':
      case 'Ordering':
      case 'IndexOf':
      case 'Contains':
      case 'Unique':
      case 'Repeat':
      case 'Slice': {
        const fn = COLLECTION_HEADS[operator];
        if (fn === 'at' || fn === 'length')
          return fail(`no function of lists for ${operator}`);
        return push(fn, operands);
      }
      // `Linspace(a, b)` has 50 elements, as the existing emitter writes it.
      case 'Linspace':
        return push(
          'linspace',
          operands.length === 3
            ? operands
            : [...operands, this.numberLiteral(50, 'integer', node, operations)]
        );
      // `Most(L)` drops the last element: `L.slice(0, -1)`.
      case 'Most':
        return push('drop', [
          operands[0],
          this.numberLiteral(-1, 'integer', node, operations),
        ]);
      // `Append(L, x)`: a new list, or `L` with `x` pushed when `L` is
      // unique (`inPlaceUpdates()`).
      case 'Append': {
        const result = this.resultOf(facts);
        operations.push({
          kind: 'append',
          result,
          operands,
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      // `IsEmpty(L)`: the length is 0, `(L.length === 0)`.
      case 'IsEmpty': {
        const length = this.newValue('integer', 'number');
        operations.push({
          kind: 'length',
          result: length,
          operands: [operands[0]],
          effect: 'pure',
          origin: node,
        });
        const zero = this.numberLiteral(0, 'integer', node, operations);
        const result = this.resultOf(facts);
        operations.push({
          kind: 'equal',
          result,
          operands: [length, zero],
          effect: 'pure',
          origin: node,
        });
        return result;
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
        if (nested) return push('matrix-multiply', operands);
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
      case 'Second':
      case 'Third':
        return this.element(
          operands[0],
          this.numberLiteral(
            { First: 1, Last: -1, Second: 2, Third: 3 }[operator],
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
        const range = push('range', bounds);
        if (countFits(node.ops)) FITTING_COUNTS.add(operations.at(-1)!);
        return range;
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

    // `Tabulate(f, n)`: a `build` from 1 to `n` (`ascending`, so none for
    // `n` less than 1) whose body is `f` of the index, as the existing
    // emitter calls `_f(_i + 1)` for each `_i` below `Math.max(0, n)`.
    // The count is not a length (`counted`): for more than 2^32 - 1
    // elements the code throws a `RangeError` before it calls `f`, as
    // `Array.from({ length: n })` does.
    if (operator === 'Tabulate') {
      const index = this.newValue('integer', 'number');
      const body: IROperation[] = [];
      const element = this.inRegion(body, () => apply([index], body));
      const region: IRRegion = {
        ...this.region(body, node, element),
        parameters: [index],
      };
      const result = this.resultOf(facts);
      operations.push({
        kind: 'build',
        result,
        operands: [
          this.numberLiteral(1, 'integer', node, operations),
          values[0],
        ],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        ascending: true,
        counted: true,
        origin: node,
      });
      return result;
    }

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
        into: IROperation[],
        index: IRValue
      ) => readonly IRValue[],
      into: IROperation[]
    ): IRValue[] => {
      const index = this.newValue('integer', 'number');
      const parameters = carried.map((c) =>
        this.newValue(c.type, representationOf(c.type))
      );
      const body: IROperation[] = [];
      const next = this.inRegion(body, () =>
        step(this.element(list, index, node, body), parameters, body, index)
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
      case 'Count':
      case 'CountIf':
      case 'Position': {
        const filter = operator === 'Filter' || operator === 'Position';
        const start = filter
          ? empty(type, operations)
          : literal(0, 'integer', operations);
        const [result] = pass(
          one,
          [{ initial: start, type }],
          (element, [current], into, index) => [
            this.conditional(
              apply([element], into),
              (inner) => {
                // `Position` appends the index of the element.
                if (operator === 'Position')
                  return append(current, index, inner);
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
      case 'Any':
      case 'All':
      case 'Find':
      case 'IndexWhere':
      case 'TakeWhile':
      case 'DropWhile': {
        // A pass that ends at the first element that decides the value, as
        // `some`, `every`, `find` and `findIndex` of the existing emitter
        // stop there: a `loop` from 1 to the length that carries the value
        // for no such element, with an `if` on the predicate whose branch
        // ends the loop with an `exit` of the value at that element. The
        // predicate is applied to the same elements, in the same order.
        const stopsWhen = operator !== 'All' && !operator.endsWith('While');
        const literalOf = (value: number | boolean, into: IROperation[]) => {
          if (typeof value === 'number')
            return literal(value, Number.isNaN(value) ? 'real' : 'integer', into);
          const result = this.newValue('boolean', 'boolean');
          into.push({
            kind: 'literal',
            value,
            result,
            operands: [],
            effect: 'pure',
            origin: node,
          });
          return result;
        };
        // The value for no such element, and at the element `element` of
        // the index `index`.
        const none = (into: IROperation[]): IRValue =>
          operator === 'Any'
            ? literalOf(false, into)
            : operator === 'All'
              ? literalOf(true, into)
              : operator === 'Find'
                ? literalOf(NaN, into)
                : operator === 'IndexWhere'
                  ? literalOf(0, into)
                  : length;
        const found = (
          element: IRValue,
          index: IRValue,
          into: IROperation[]
        ): IRValue => {
          if (operator === 'Any') return literalOf(true, into);
          if (operator === 'All') return literalOf(false, into);
          if (operator === 'Find') {
            if (element.type !== 'integer') return element;
            // An integer element, carried with the real `NaN`.
            const real = this.newValue('real', 'number');
            into.push({
              kind: 'convert',
              conversion: 'integer-to-real',
              result: real,
              operands: [element],
              effect: 'pure',
              origin: node,
            });
            return real;
          }
          if (operator === 'IndexWhere') return index;
          // The count of the elements before the element: `index + -1`.
          const count = this.newValue('integer', 'number');
          into.push({
            kind: 'add',
            result: count,
            operands: [index, literal(-1, 'integer', into)],
            effect: 'pure',
            origin: node,
          });
          return count;
        };
        const initial = none(operations);
        // The carried value has the type of the value: a boolean, the
        // element (a real for `Find`, which can be `NaN`), or an integer.
        const carriedType: ValueType =
          operator === 'Any' || operator === 'All'
            ? 'boolean'
            : operator === 'Find'
              ? 'real'
              : 'integer';
        const representation: ScalarRepresentation =
          carriedType === 'boolean' ? 'boolean' : 'number';
        const index = this.newValue('integer', 'number');
        const current = this.newValue(carriedType, representation);
        const body: IROperation[] = [];
        this.inRegion(body, () => {
          const element = this.element(list, index, node, body);
          const test = apply([element], body);
          const exit: IROperation[] = [];
          const value = this.inRegion(exit, () =>
            found(element, index, exit)
          );
          exit.push({
            kind: 'exit',
            operands: [value],
            effect: 'pure',
            origin: node,
          });
          const closed = this.closedRegion(exit);
          const open = this.region([], node, []);
          body.push({
            kind: 'if',
            results: [],
            operands: [test],
            then: stopsWhen ? closed : open,
            else: stopsWhen ? open : closed,
            effect: joinEffects(closed.effect, open.effect),
            ...touchesField(closed.touches, open.touches),
            origin: node,
          });
        });
        const region: IRRegion = {
          ...this.region(body, node, current),
          parameters: [index, current],
        };
        const searched = this.newValue(carriedType, representation);
        operations.push({
          kind: 'loop',
          results: [searched],
          operands: [one, length, initial],
          body: region,
          effect: region.effect,
          ...touchesField(region.touches),
          ascending: true,
          origin: node,
        });
        if (operator !== 'TakeWhile' && operator !== 'DropWhile')
          return searched;
        // The elements before the first one where the predicate is false,
        // and the others: `L.slice(0, i)` and `L.slice(i)`, new arrays.
        const result = this.resultOf(facts);
        operations.push({
          kind: 'collection',
          fn: operator === 'TakeWhile' ? 'take' : 'drop',
          ...collectionResultArray(
            JAVASCRIPT_POLICY,
            operator === 'TakeWhile' ? 'take' : 'drop'
          ),
          result,
          operands: [list, searched],
          effect: 'pure',
          origin: node,
        });
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
    const fn = integral.sampled === true ? 'integrate-sampled' : 'integrate';
    const rule = JAVASCRIPT_POLICY.routines?.[fn];
    if (rule === undefined) return fail(`the target has no routine ${fn}`);
    const outermost = this.panels === undefined;
    const panels = this.panels ?? integral.panels;
    if (outermost) this.panels = panels;
    const { clauses, body, alternative } = integral;
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
      // The integrand in log space, on the innermost clause: a region of
      // its own parameter, which the routine binds to the abscissa of the
      // body, with the variables of the clauses before it bound as in the
      // body.
      let second: IRRegion | undefined;
      if (alternative !== undefined && d + 1 === clauses.length) {
        const own = this.newValue('real', 'number');
        const alternativeOperations: IROperation[] = [];
        const alternativeValue = this.inRegion(alternativeOperations, () => {
          const values = new Map(this.bound.get(inner) ?? []);
          values.set(name, own);
          this.bound.set(inner, values);
          this.wrote(inner);
          this.changed();
          return this.convert(
            this.value(alternative, inner, alternativeOperations),
            conversion(2 * clauses.length + 1),
            node,
            alternativeOperations
          );
        });
        second = {
          ...this.region(alternativeOperations, alternative, alternativeValue),
          parameters: [own],
        };
      }
      const regions = second === undefined ? [region] : [region, second];
      const result =
        d === 0 ? this.resultOf(facts) : this.newValue('real', 'number');
      out.push({
        kind: 'routine',
        fn,
        result,
        operands: [lo, hi],
        body: region,
        ...(second === undefined ? {} : { alternative: second }),
        ...(fn === 'integrate' ? { initialPanels: panels } : {}),
        effect: regions.reduce<EffectFact>(
          (e, r) => joinEffects(e, r.effect),
          rule.effect
        ),
        ...touchesField(rule.touches, ...regions.map((r) => r.touches)),
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
   * A derivative or a limit with no closed form (`StructuredNumericRoutine`),
   * as the existing emitter writes it (`compileNumericDerivativeFallback()`
   * in `library/calculus.ts`, the `Limit` handler of `javascript-target.ts`):
   * one `routine` `derivative` or `limit`. The operands (the point, then the
   * direction of a limit) are evaluated where the node is, in its scope;
   * the body binds the variable to its parameter and starts a new epoch
   * (`changed()`), so every operation of the body runs at each point that
   * the routine samples, as with `cse: false`.
   */
  private numericRoutine(
    node: Expression,
    routine: StructuredNumericRoutine,
    facts: FragmentValueFacts<ScalarRepresentation>,
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): IRValue {
    const inner = scope.inner.get(node);
    if (inner === undefined)
      return fail(`no scope for the routine ${nodeText(node)}`);
    const rule = JAVASCRIPT_POLICY.routines?.[routine.fn];
    if (rule === undefined)
      return fail(`the target has no routine ${routine.fn}`);
    // The conversion of each operand, then of the body (`routineRule()` in
    // `javascript-fragment-target.ts`).
    const conversion = (i: number) => facts.conversions?.[i];
    const operands = routine.operands.map((operand, i) =>
      this.convert(
        this.value(operand, scope, operations),
        conversion(i),
        node,
        operations
      )
    );
    const parameter = this.newValue('real', 'number');
    const bodyOperations: IROperation[] = [];
    const value = this.inRegion(bodyOperations, () => {
      const values = new Map(this.bound.get(inner) ?? []);
      values.set(routine.name, parameter);
      this.bound.set(inner, values);
      this.wrote(inner);
      this.changed();
      return this.convert(
        this.value(routine.body, inner, bodyOperations),
        conversion(routine.operands.length),
        node,
        bodyOperations
      );
    });
    const region: IRRegion = {
      ...this.region(bodyOperations, routine.body, value),
      parameters: [parameter],
    };
    const result = this.resultOf(facts);
    operations.push({
      kind: 'routine',
      fn: routine.fn,
      result,
      operands,
      body: region,
      ...(routine.order !== undefined ? { order: routine.order } : {}),
      effect: joinEffects(rule.effect, region.effect),
      ...touchesField(rule.touches, region.touches),
      ...(rule.aborts !== undefined ? { aborts: rule.aborts } : {}),
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
   * `Sum(body, Limits(k, a, b), …)` and `Product(…)` whose body is a list
   * (`listAggregateFacts()` in `javascript-fragment-target.ts`: every bound
   * a number literal, every range not empty or the width of the body
   * stated, one length in every term), as the existing emitter writes it
   * (`emitSumProduct()` in `javascript-target.ts`, with an accumulator
   * that starts at `null`): for each clause, the outermost first, the term
   * at the floor `a` of the lower bound, then one `loop` from `a + 1` to the
   * floor `b` of the upper bound (`ascending`: no iteration when `b ≤ a`)
   * that carries the list and adds (multiplies) each later term to it,
   * element by element (`_SYS.bcast((_a, _b) => _a + _b, acc, term)`), in
   * index order. So the first term is the value of the clause as it is, not
   * `0 + t` (a `-0` stays), and every term is evaluated: the existing loop
   * tests the accumulator for `NaN`, and an array is never `NaN`. A clause
   * of an empty range is the list of `w` zeros (ones) of the stated width
   * `w`, as the existing emitter writes it (`[0, 0, 0]`). The term of a
   * clause is the aggregate of the clauses after it, and the body for the
   * last one. With an iteration budget, the program declines: the
   * existing emitter guards the loop of a list body differently.
   */
  private listAggregate(
    node: Expression & { ops: readonly Expression[] },
    facts: FragmentValueFacts<ScalarRepresentation>,
    inner: FragmentScope<ScalarRepresentation>,
    clauses: readonly { index: string; lower: Expression; upper: Expression }[],
    operations: IROperation[]
  ): IRValue {
    if (this.prep.iterationBudget !== undefined)
      throw new StructuredDeclineError(
        `${node.operator} ${nodeText(node)}, whose body is a list, is not in ` +
          `the profile with an iteration budget`
      );
    const body = node.ops[0];
    const sum = node.operator === 'Sum';
    const type = valueType(facts.type);
    const element =
      elementOf(type) ?? fail(`the body of ${nodeText(node)} is not a list`);
    const bodyConversion = facts.conversions?.[2 * clauses.length];
    const bound = (b: Expression): number =>
      isNumber(b) ? Math.floor(b.re) : fail(`the bound ${nodeText(b)} is not a literal`);
    const literal = (value: number, into: IROperation[]) =>
      this.numberLiteral(value, 'integer', node, into);
    const bindIndex = (name: string, value: IRValue) => {
      const values = new Map(this.bound.get(inner) ?? []);
      values.set(name, value);
      this.bound.set(inner, values);
      this.wrote(inner);
      this.changed();
    };
    // `a + b` (`a · b`) of two lists of one length, element by element.
    const combine = (a: IRValue, b: IRValue, into: IROperation[]): IRValue => {
      const [one, length] = this.elementRange(a, node, into);
      const index = this.newValue('integer', 'number');
      const cells: IROperation[] = [];
      const value = this.newValue(element, 'number');
      cells.push({
        kind: sum ? 'add' : 'multiply',
        result: value,
        operands: [
          this.element(a, index, node, cells, true),
          this.element(b, index, node, cells, true),
        ],
        effect: 'pure',
        origin: node,
      });
      const region: IRRegion = {
        ...this.region(cells, node, value),
        parameters: [index],
      };
      const result = this.newValue(type, 'array');
      into.push({
        kind: 'build',
        result,
        operands: [one, length],
        body: region,
        effect: 'pure',
        ascending: true,
        origin: node,
      });
      return result;
    };
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
      const lo = bound(lower);
      const hi = bound(upper);
      // An empty range: the list of the stated width (the rule admitted
      // it), `[0, 0, 0]` or `[1, 1, 1]`.
      if (lo > hi) {
        const width =
          (() => {
            const t = body.type.type;
            return typeof t === 'object' && t.kind === 'list'
              ? t.dimensions?.[0]
              : undefined;
          })() ?? fail(`the body of ${nodeText(node)} has no stated width`);
        const ones = Array.from({ length: width }, () =>
          this.numberLiteral(sum ? 0 : 1, 'integer', node, out)
        );
        const result = this.newValue(type, 'array');
        out.push({
          kind: 'list',
          result,
          operands: ones,
          effect: 'pure',
          origin: node,
        });
        return result;
      }
      const first = literal(lo, out);
      this.aggregateIndexes.add(first.id);
      const start = term(first, out);
      if (hi === lo) return start;
      const indexValue = this.newValue('integer', 'number');
      this.aggregateIndexes.add(indexValue.id);
      const accumulator = this.newValue(type, 'array');
      const bodyOperations: IROperation[] = [];
      const next = this.inRegion(bodyOperations, () =>
        combine(accumulator, term(indexValue, bodyOperations), bodyOperations)
      );
      const region: IRRegion = {
        ...this.region(bodyOperations, node, next),
        parameters: [indexValue, accumulator],
      };
      const result = this.newValue(type, 'array');
      out.push({
        kind: 'loop',
        results: [result],
        operands: [literal(lo + 1, out), literal(hi, out), start],
        body: region,
        effect: region.effect,
        ...touchesField(region.touches),
        ascending: true,
        origin: node,
      });
      return result;
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
   * `NaN` (`termThrower()`: a `routine` but a `derivative`, whose
   * `_SYS.nd` does not throw and whose body is judged as the term is, a
   * `replace-at`, a call of a
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
    if (isListType(type))
      return this.listAggregate(node, facts, inner, clauses, operations);
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
    // A value that is a name (`sv := y`) is a read of that name where the
    // alias is read, as the existing compiler writes it at each read
    // (`bindsFoldedValue()` binds applications only); another value is
    // computed once (`storedRead()`).
    if (capture.expression === true) {
      if (!isSymbol(capture.stored)) return this.storedRead(capture);
      // In the body of a helper, an alias of a captured expression
      // (`sa := lv`, also through other aliases) reads the parameter of the
      // expression that the helper receives (`storedParameters()` of the
      // admission).
      if (this.lowering.size > 0) {
        const end = this.aliasEnd(capture);
        if (end !== undefined) return this.read(end, scope, operations);
      }
      return this.value(capture.stored, this.prep.annotation.scope, operations);
    }
    const snapshot = capture.complex ?? capture.value;
    if (snapshot === undefined) return this.capturedList(capture, operations);
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
        snapshot,
      });
      this.captureIndex.set(capture.binding, index);
    }
    operations.push({
      kind: 'capture',
      capture: index,
      binding: capture.binding,
      snapshot,
      result,
      operands: [],
      effect: 'pure',
      origin: node,
    });
    return result;
  }

  /** The symbol of the captured expression at the end of the chain of
   *  aliases that starts at `capture` (`sa := lv`, `sb := sa`), or
   *  `undefined` when the chain ends at a name with no captured expression
   *  (an input) or comes back to one of its names. */
  private aliasEnd(
    capture: StructuredCapture
  ): (Expression & { symbol: string }) | undefined {
    const seen = new Set<StructuredCapture>();
    let current = capture;
    while (current.expression === true && isSymbol(current.stored)) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const stored = current.stored;
      const next = this.prep.captures.find((c) => c.symbols.has(stored));
      if (next === undefined) return undefined;
      if (next.expression === true && !isSymbol(next.stored)) return stored;
      current = next;
    }
    return undefined;
  }

  /** The value of each captured expression (`storedRead()`), by its
   *  binding. */
  private readonly storedValues = new Map<object, IRValue>();
  /** The number of operations at the start of the root region that compute
   *  the captured expressions (`storedRead()`). */
  private storedEnd = 0;
  /** Whether a captured expression is being lowered (`storedRead()`). */
  private storing = false;

  /**
   * A read of a captured binding whose value is an expression
   * (`StructuredCapture.expression`, `lv := x + 1`), which the admission
   * typed in the root scope, where its names are read. The existing
   * compiler computes it once per call, before the body
   * (`const _val_lv = _.x + 1;`), and writes its name at each read. The
   * lowering computes it once, at its first read, and puts its operations
   * at the start of the root region, after those of the captured
   * expressions lowered before it: before every operation of the body, so
   * that its reads of the inputs come before a call of the host, which can
   * change the inputs object (the emitter moves no pure value across such a
   * call). Each read is that value. The admission refuses an impure value
   * and a value that reads the host; a value whose operations can throw or
   * abort declines here: the existing compiler computes every value before
   * the body, also one that the body does not read on the path it takes. A
   * value of another captured expression that it reads is lowered with it,
   * before it. A read in the body of a helper declines: a helper has no
   * root region.
   */
  private storedRead(capture: StructuredCapture): IRValue {
    // Before the value that the root computed: that value is not in the
    // region of a helper.
    if (this.lowering.size > 0 || this.regions.length === 0)
      throw new StructuredDeclineError(
        `the value of ${capture.name} (${nodeText(capture.stored)}) is read ` +
          `in the body of a helper, which the structured route does not ` +
          `compute it in`
      );
    const known = this.storedValues.get(capture.binding);
    if (known !== undefined) return known;
    // A value that another captured expression reads is lowered with it.
    const nested = this.storing;
    const operations: IROperation[] = nested
      ? this.regions[0].operations
      : [];
    const start = operations.length;
    // The value is lowered alone, in the root scope: no value that a region
    // around the read remembers, no loop and no integral of the read is
    // around it.
    const { regions, loops, scopes, panels } = this;
    this.regions = [];
    this.loops = [];
    this.scopes = [];
    this.panels = undefined;
    this.storing = true;
    let value: IRValue;
    try {
      value = this.inRegion(operations, () =>
        this.value(capture.stored, this.prep.annotation.scope, operations)
      );
    } finally {
      this.regions = regions;
      this.loops = loops;
      this.scopes = scopes;
      this.panels = panels;
      this.storing = nested;
    }
    for (let i = start; i < operations.length; i++) {
      const op = operations[i];
      if (
        op.effect !== 'pure' ||
        this.canThrow(op) ||
        operationCanAbort(op, this.functions) ||
        reachesHost(op, this.functions)
      )
        throw new StructuredDeclineError(
          `the value of ${capture.name} (${nodeText(capture.stored)}) has ` +
            `an operation that can throw, abort or read the host ` +
            `(${nodeText(op.origin)}), which the profile does not compute ` +
            `before the body`
        );
    }
    // The value is computed where the existing compiler computes
    // `_val_lv`, before the body, also when it has one use: written at that
    // use, its reads of the inputs would come after those of the operands
    // before it.
    const defining = operations.findIndex(
      (op, i) => i >= start && 'result' in op && op.result?.id === value.id
    );
    if (defining >= 0)
      operations[defining] = {
        ...operations[defining],
        atDefinition: true,
      } as IROperation;
    if (!nested) {
      this.regions[0].operations.splice(this.storedEnd, 0, ...operations);
      this.storedEnd += operations.length;
    }
    this.storedValues.set(capture.binding, value);
    return value;
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
      // A list of lists holds its rows, each the array of its cells.
      const nested = isListType(result.type.element);
      if (
        nested &&
        !node.ops.every((row) => isFunction(row, 'List') && row.nops > 0)
      )
        return fail(`a row of the captured value of ${capture.name} is not a list`);
      this.constants.push({
        binding: capture.binding,
        name: capture.name,
        type: result.type,
        representation: result.representation,
        elements: nested
          ? node.ops.map((row) =>
              (row as Expression & { ops: readonly Expression[] }).ops.map(
                (cell) => cell.re
              )
            )
          : node.ops.map((element) => element.re),
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
    liveOut: ReadonlySet<string>,
    loopBody = false
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
    for (const [i, s] of statements.entries()) {
      if (closed) fail('a statement follows a Break');
      // In the body of a loop, an `If` with a branch that ends in
      // `Continue`: the statements after it run in its other branches, as
      // the existing emitter's `continue` skips them in that branch.
      if (loopBody && isFunction(s, 'If') && (s.nops === 2 || s.nops === 3)) {
        if (s.ops.slice(1).some(endsInContinue))
          return this.ifStatement(s, scope, operations, liveOut, statements.slice(i + 1), true);
        closed = this.ifStatement(s, scope, operations, live[i], undefined, true);
        continue;
      }
      closed = this.statement(s, scope, operations, live[i]);
    }
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
    // A destructuring declaration or write: every component, in order,
    // then each name (`destructure()`).
    if (
      (isFunction(node, 'Declare') || isFunction(node, 'Assign')) &&
      isFunction(node.op1, 'Tuple')
    ) {
      this.destructure(node, scope, operations);
      return false;
    }
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
    if (isFunction(node, 'Loop')) {
      this.loopStatement(node, scope, operations, liveOut);
      return false;
    }
    if (isFunction(node, 'Block')) {
      const inner = scope.inner.get(node);
      if (inner === undefined) return fail('no scope for a block');
      const body = node === this.loopBody;
      this.loopBody = undefined;
      return this.statements(node.ops, inner, operations, liveOut, body);
    }
    // A `Continue` is lowered only where it ends a branch of an `If` of the
    // body of a loop (`ifStatement()` with `loopStatement`); anywhere else
    // dropping it would skip nothing, so it is an error of the admission.
    if (isFunction(node, 'Continue'))
      return fail(
        'a Continue that is not the last statement of a branch of an If of the body of a loop'
      );
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

  /**
   * A destructuring declaration `Declare((a, b), {value: v})` or write
   * `(a, b) ≔ v`, which the admission and the pass checked: the value of
   * each component, in order, before any name has its new value, as the
   * existing emitter writes it (`_tv1 = b; _tv2 = a + b; a = _tv1; b =
   * _tv2`). A literal tuple gives its operands; another value (a call of a
   * user function) is evaluated once, and each component is a `get` of it,
   * as the existing emitter reads it with `_SYS.at`.
   */
  private destructure(
    node: Expression & { ops: readonly Expression[] },
    scope: FragmentScope<ScalarRepresentation>,
    operations: IROperation[]
  ): void {
    const pattern = node.ops[0] as Expression & { ops: readonly Expression[] };
    const names = pattern.ops.map((p) =>
      isSymbol(p) ? p.symbol : fail(`the pattern ${nodeText(pattern)} is not a tuple of names`)
    );
    const value =
      node.operator === 'Declare' ? declareValueOperand(node.ops) : node.ops[1];
    if (value === undefined)
      return fail(`the destructuring ${nodeText(node)} has no value`);
    let components: IRValue[];
    if (isFunction(value, 'Tuple') && value.nops === names.length)
      components = value.ops.map((op) => this.value(op, scope, operations));
    else {
      const tuple = this.value(value, scope, operations);
      if (!isTupleType(tuple.type) || tuple.type.elements.length !== names.length)
        return fail(`the value of ${nodeText(node)} is not a tuple of ${names.length} components`);
      const elements = tuple.type.elements;
      components = elements.map((element, i) => {
        const result = this.newValue(element, 'number');
        operations.push({
          kind: 'get',
          position: i + 1,
          result,
          operands: [tuple],
          effect: 'pure',
          origin: node,
        });
        return result;
      });
    }
    names.forEach((name, i) => {
      const binder =
        node.operator === 'Declare' ? scope : bindingScope(scope, name);
      const binding = binder?.bindings.get(name);
      if (
        binder === undefined ||
        binder === this.prep.annotation.scope ||
        binding === undefined ||
        !('representation' in binding)
      )
        return fail(`the name ${name} is not a local`);
      let locals = this.bound.get(binder);
      if (locals === undefined) this.bound.set(binder, (locals = new Map()));
      locals.set(name, this.toLocal(components[i], binding, name, node, operations));
      this.wrote(binder);
    });
    this.changed();
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
   * term alike, and an `inverse` or a `matrix-power` judged as such a `mod`
 * (`throwingMatrixFunction()`). `_SYS.floorMod(a, b)` throws only for an operand beyond
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
        // An inverse or a power of a matrix throws for a matrix that is not
        // square: harmless as a `mod` is when every term evaluates it with
        // the same operands (it throws in the first term on both
        // compilers, or never).
        if (throwingMatrixFunction(op)) {
          if (!(everyTerm && op.operands.every(invariant))) return op;
          continue;
        }
        if (regionsOf(op).length === 0) {
          if (this.canThrowNoHost(op)) return op;
          continue;
        }
        // An operation with regions is judged by its own code (a `build` of
        // a count that the program computes, a `routine` but a
        // `derivative`), then by the operations of its regions.
        if (throwsItself(op, false)) return op;
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
    liveOut: ReadonlySet<string>,
    rest?: readonly Expression[],
    loopStatement = false
  ): boolean {
    // The operations of the condition, kept apart until the `If` is known
    // to be lowered. Their region is not open in the branches nor after the
    // `If`: the values that it remembers are not shared.
    const condition: IROperation[] = [];
    const test = this.inRegion(condition, () =>
      this.value(node.ops[0], scope, condition)
    );
    const before = this.snapshot();
    // With `rest`, a branch that does not end in `Continue` runs the
    // statements `rest` after its own, in `scope` (`statements()`).
    const branch = (statement: Expression | undefined) => {
      this.restore(before);
      const inner: IROperation[] = [];
      const tail =
        rest !== undefined && !(statement !== undefined && endsInContinue(statement))
          ? rest
          : [];
      const closed = this.inRegion(inner, () => {
        const live = new Set([...liveOut, ...tail.flatMap((s) => [...this.namesOf(s)])]);
        // `loopStatement`: the `If` is a statement of the body of a loop, and
        // a `Continue` that ends a branch is not lowered: the branch does not
        // run `rest` (`tail` is empty).
        if (loopStatement && statement !== undefined && endsInContinue(statement)) {
          if (isFunction(statement, 'Block')) {
            const blockScope = scope.inner.get(statement);
            if (blockScope === undefined) return fail('no scope for a block');
            return this.statements(statement.ops.slice(0, -1), blockScope, inner, live);
          }
          return false;
        }
        if (statement !== undefined && this.statement(statement, scope, inner, live))
          return true;
        return this.statements(tail, scope, inner, liveOut, true);
      });
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
    liveOut: ReadonlySet<string>,
    clause = 0
  ): void {
    // A `Loop` with several index sets is a loop per index set, the first
    // outermost: the loop of the index set `clause` has the loop of the
    // next one as its body. One scope of the pass binds every index; the
    // source of the index set `clause` is evaluated in the scope of the
    // loop of the index set before it (`scope` for the first one). A `Loop`
    // with no index set is a loop with no end (`IRLoop.unbounded`).
    const body = node.ops[0];
    const clauses = node.ops.slice(1);
    const spec = clauses[clause];
    const loopScope = clause === 0 ? scope.inner.get(node) : scope;
    const unbounded = clauses.length === 0;
    const overList =
      isFunction(spec, 'Element') &&
      spec.nops === 2 &&
      isSymbol(spec.op1) &&
      !(isFunction(spec.op2, 'Range') && spec.op2.nops === 2);
    if (
      loopScope === undefined ||
      (!unbounded &&
        (!isFunction(spec, 'Element') ||
          spec.nops !== 2 ||
          !isSymbol(spec.op1) ||
          (!overList &&
            (!isFunction(spec.op2, 'Range') || spec.op2.nops !== 2))))
    )
      return fail(`no lowering for the loop ${nodeText(node)}`);
    const index = unbounded
      ? undefined
      : (spec as Expression & { op1: Expression & { symbol: string } }).op1
          .symbol;
    const bound = (b: Expression) => {
      const value = this.value(b, scope, operations);
      if (value.type !== 'integer')
        fail(`the bound ${nodeText(b)} of a loop is not an integer`);
      return value;
    };
    // The list of a loop over a list, and its length; the bounds of a loop
    // over a range.
    const source = (spec as Expression & { op2: Expression } | undefined)?.op2;
    const list =
      overList && source !== undefined
        ? this.value(source, scope, operations)
        : undefined;
    let from: IRValue;
    let to: IRValue;
    if (unbounded) {
      from = this.numberLiteral(1, 'integer', node, operations);
      to = from;
    } else if (list !== undefined) {
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
      const range = source as Expression & {
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
      this.nameSources()
    );
    // The source of each later index set is evaluated at each pass of this
    // loop, after the body of the pass before: a local that the body writes
    // and that such a source reads is carried too.
    for (const later of clauses.slice(clause + 1))
      for (const name of namesIn(
        later,
        this.names,
        this.capturedNames,
        this.nameSources()
      ))
        exposed.add(name);
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
      // The indexes of the index sets before this one, then this index.
      const indexes = new Map(
        clause === 0 ? [] : (this.bound.get(loopScope) ?? [])
      );
      if (index !== undefined)
        indexes.set(
          index,
          list === undefined
            ? indexValue
            : this.element(list, indexValue, node, inner)
        );
      this.bound.set(loopScope, indexes);
      this.wrote(loopScope);
      this.changed();
      const context = { carried, exits: [] as (readonly IRValue[])[] };
      this.loops.push(context);
      let closed = false;
      try {
        if (clause + 1 < clauses.length)
          this.inRegion(inner, () =>
            this.loopStatement(
              node,
              loopScope,
              inner,
              carriedNames,
              clause + 1
            )
          );
        else {
          const outerBody = this.loopBody;
          this.loopBody = body;
          try {
            closed = this.inRegion(inner, () =>
              // An `If` that is the whole body is a statement of the body,
              // where a branch can end in `Continue`.
              isFunction(body, 'If') && (body.nops === 2 || body.nops === 3)
                ? this.ifStatement(body, loopScope, inner, carriedNames, undefined, true)
                : this.statement(body, loopScope, inner, carriedNames)
            );
          } finally {
            this.loopBody = outerBody;
          }
        }
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
        ...(unbounded ? { unbounded: true as const } : {}),
        // A range tests its count where the existing emitter's loop over a
        // `Range` clause does (`testsRangeCount()`).
        ...(!unbounded &&
        list === undefined &&
        testsRangeCount(source!, clauses.length === 1)
          ? { checksCount: true as const }
          : {}),
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

  /** Whether a call of the helper of the type `type` applies it to each
   *  element of its argument `value` at the position `i`: a list at a
   *  parameter that is not a list (`mapsListArguments` of the definition,
   *  `javascript-fragment-target.ts`). A captured name, after the
   *  parameters of the literal, is never one. */
  private mapsArgument(
    type: FragmentType & { kind: 'function' },
    value: IRValue,
    i: number
  ): boolean {
    const parameter = type.parameters[i]?.type;
    return (
      parameter !== undefined &&
      parameter.kind !== 'list' &&
      isListType(value.type)
    );
  }

  /**
   * A call of the helper `name` applied to each element of its list
   * arguments at real or integer parameters, as the existing emitter
   * writes it, `_SYS.mapFn(_fn_f, [1, 0], L, x)` (`mapWith()` in
   * `javascript-runtime.ts`): the arguments `args` are evaluated once, in
   * order (the caller did), then one `build` over the elements of the
   * first list argument, from 1 to its length, whose body reads each list
   * argument at the index and passes each other argument whole to one call
   * of the helper. So the helper is called once per element, in the order
   * of the elements, and not at all for an empty list. The rule admitted
   * list arguments of lengths equal by construction. The helper is the one
   * that a scalar call reaches: one function of the program, whose
   * parameter is a number.
   */
  private elementCall(
    name: string,
    node: Expression & { ops: readonly Expression[] },
    args: readonly IRValue[],
    facts: FragmentValueFacts<ScalarRepresentation>,
    operations: IROperation[],
    effect: EffectFact
  ): IRValue {
    const entry = this.prep.annotation.functions.get(name)!;
    const type = entry.type as FragmentType & { kind: 'function' };
    const index = this.helper(name, args, facts, node);
    const fn = this.functions[index];
    const callEffect = joinEffects(effect, fn.body.effect);
    // One `build` per level of a list of lists (`mapWith()` maps the rows
    // of a list of lists, then their numbers).
    const level = (
      values: readonly IRValue[],
      ranks: readonly number[],
      result: IRValue,
      ops: IROperation[]
    ): IRValue => {
      const list = values.find((_, i) => ranks[i] > 0)!;
      const [one, length] = this.elementRange(list, node, ops);
      const position = this.newValue('integer', 'number');
      const body: IROperation[] = [];
      const value = this.inRegion(body, () => {
        const cells = values.map((v, i) =>
          ranks[i] > 0 ? this.element(v, position, node, body, true) : v
        );
        const inner = ranks.map((r) => (r > 0 ? r - 1 : 0));
        if (inner.some((r) => r > 0)) {
          const row = elementOf(result.type) ?? fail(`${nodeText(node)} is not a list`);
          return level(cells, inner, this.newValue(row, 'array'), body);
        }
        const element = this.newValue(
          fn.result.type,
          fn.result.representation as ScalarRepresentation
        );
        body.push({
          kind: 'call',
          function: index,
          result: element,
          operands: cells,
          effect: callEffect,
          ...touchesField(this.states(node), fn.body.touches),
          origin: node,
        });
        this.afterUnknown(callEffect);
        return element;
      });
      const region: IRRegion = {
        ...this.region(body, node, value),
        parameters: [position],
      };
      ops.push({
        kind: 'build',
        result,
        operands: [one, length],
        body: region,
        effect: joinEffects(effect, region.effect),
        ...touchesField(this.states(node), region.touches),
        ascending: true,
        origin: node,
      });
      this.afterUnknown(region.effect);
      return result;
    };
    return level(
      args,
      args.map((v, i) => (this.mapsArgument(type, v, i) ? rankOf(v.type) : 0)),
      this.resultOf(facts),
      operations
    );
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
    // A list argument of a call applied to each element (`elementCall()`)
    // passes a number to the parameter.
    const parameters = entry.type.parameters.map((p, i) =>
      this.newValue(
        valueType(p.type),
        conversions[i].type.kind === 'list' && p.type.kind !== 'list'
          ? 'number'
          : conversions[i].representation
      )
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
    // The value of a call applied to each element is a list of the values
    // of the helper, each a number.
    const result = {
      type: valueType(entry.type.result),
      representation:
        facts.type.kind === 'list' && entry.type.result.kind !== 'list'
          ? ('number' as const)
          : facts.representation,
    };
    if (value.representation !== result.representation)
      fail(
        `the body of ${name} does not have the representation of its result`
      );
    const labels = this.prep.helpers.get(name)!.parameterElementLabels;
    const body = this.region(operations, entry.body, value);
    // The inputs of the program that the body reads, as the root reads
    // them: a name of the body that no scope of the helper binds
    // (`IRFunction.inputs`).
    const inputs = new Set<number>();
    const visit = (region: IRRegion): void => {
      for (const op of region.operations) {
        if (op.kind === 'input') inputs.add(op.input);
        for (const inner of regionsOf(op)) visit(inner);
      }
    };
    visit(body);
    this.functions.push({
      name,
      parameters,
      ...(labels?.some((l) => l !== undefined)
        ? { parameterElementLabels: labels }
        : {}),
      result,
      body,
      ...(inputs.size > 0
        ? { inputs: [...inputs].sort((a, b) => a - b) }
        : {}),
      origin: node,
    });
    this.functionIndex.set(name, this.functions.length - 1);
    return this.functions.length - 1;
  }
}

/**
 * Whether the code of an operation itself can throw on JavaScript for
 * operands that hold values of their declared types (`canThrow()` adds the
 * regions that it evaluates and the functions that it calls). A value
 * outside its type (an array where the type is a number, which
 * `_SYS.atNumeric` refuses) is unspecified, and a throw for lack of memory
 * is not counted. The aborts that an operation states (`aborts`: the size
 * limit and the poles of the `bigint` mode), the iteration budget of a
 * `loop` and the seed of a `seeded` are aborts, which `operationCanAbort()`
 * answers, not throws.
 *
 * - `false`: the code gives a value for every operand.
 * - `true`: it can throw.
 * - `count`: an array of a count that the program computes, which throws a
 *   `RangeError` for more than 2^32 - 1 elements, unless the lowering knows
 *   that the count fits (`FITTING_COUNTS`).
 *
 * `FUNCTION_THROWS` answers for a `unary` and a `binary`, and
 * `COLLECTION_THROWS` for a `collection`.
 */
export const OPERATION_THROWS: Readonly<
  Record<IROperation['kind'], boolean | 'count'>
> = {
  'literal': false,
  'input': false,
  'capture': false,
  'constant': false,
  'add': false,
  'negate': false,
  'not': false,
  'multiply': false,
  'less': false,
  'less-equal': false,
  'equal': false,
  'not-equal': false,
  'min': false,
  'max': false,
  'sqrt': false,
  // `_SYS.floorMod` reads its operands with `integerOperand()`
  // (`javascript-runtime.ts`), which throws for an operand beyond
  // ±(2^53 − 1), the infinities included.
  'mod': true,
  'floor': false,
  'divide': false,
  'unary': false,
  'binary': false,
  // The `bigint` mode: a throw of its helpers is the abort `error` of the
  // policy (`bigintAborts()` in `javascript-structured-policy.ts`).
  'integer': false,
  // The abort `no-value`.
  'no-value': false,
  // `_SYS.atNumeric`, `_SYS.at` and `_SYS.atPoint` give `NaN`, or a point
  // of `NaN`, for an index out of range.
  'at': false,
  'length': false,
  'list': false,
  'tuple': false,
  'get': false,
  'append': false,
  // The test of the count that the emitter writes (`build` in
  // `javascript-structured-emit.ts`) for a build that is not `ascending`
  // (a `Comprehension` over a `Range`) or that is `counted` (`Tabulate`).
  // An `ascending` build that is not `counted` runs over the elements of a
  // list, and has no test.
  'build': 'count',
  // `_SYS.replaceAt` throws for an index out of range (`listPosition()`).
  'replace-at': true,
  'copy': false,
  'collection': false,
  'convert': false,
  'if': false,
  // The test of the count of a `Range` clause (`IRLoop.checksCount`), a
  // `RangeError` for more than 2^32 - 1 passes, as the existing emitter's
  // loop writes it. A loop with no end (`IRLoop.unbounded`) may not
  // terminate: an abort (`operationCanAbort()`), not a throw.
  'loop': 'count',
  'and': false,
  'or': false,
  // A call throws when the body of its function can throw (`canThrow()`).
  'call': false,
  'trace': false,
  // Outside a seeded frame, the live source throws `CapabilityDeniedError`
  // when the host denies entropy (`createSysRuntime()`, `random: null`).
  // That throw is not counted: a `draw` is `effectful`, so the lowering
  // never removes it, moves it or evaluates it where the existing emitter
  // does not.
  'draw': false,
  'seeded': false,
  // `_SYS.integrate`, `_SYS.integrateMC` and `_SYS.limit` throw the
  // timeout of a deadline; `_SYS.nd` (a `derivative`) does not throw
  // (`throwsItself()`).
  'routine': true,
  // A function of the host can throw, and the host can count its calls,
  // also when it is declared pure.
  'host': true,
  'yield': false,
  'exit': false,
};

/**
 * Whether the code of each function of lists (`IRCollection`) can throw for
 * operands of their declared types, as in `OPERATION_THROWS`:
 *
 * - `inverse` and `matrix-power`: `_SYS.inv` and `_SYS.matpow` throw
 *   `expected-square-matrix` for a rectangular matrix that is not square
 *   (but `M^1`), through `nonSquareMatrixPower()` in `javascript-runtime.ts`.
 * - `range`: `_SYS.range` (`materializeRange()`) throws a `RangeError` for
 *   more than 2^32 - 1 elements.
 * - `repeat` and `linspace`: `Array.from({ length: n })` throws a
 *   `RangeError` for a count of more than 2^32 - 1.
 * - Every other function gives a value. The statistics (`oneDatumOk()`, and
 *   `covariance` and `correlation` of `numerics/statistics.ts`) give `NaN`
 *   for an empty list or a `NaN` element. `_SYS.det`, `_SYS.trace`,
 *   `_SYS.rref`, `_SYS.transpose`, `_SYS.diagonal`, `_SYS.matmul`,
 *   `_SYS.mul` and `_SYS.norm` give `NaN` for an operand of another shape
 *   and do not throw for an operand of rank 1 or 2 (an absent row is never
 *   their operand). `_SYS.rotl`, `_SYS.rotr`, `_SYS.idxt`, `_SYS.atNumeric`
 *   (`at-real`, `gather`) and the texts of `ordering`, `unique`,
 *   `contains`, `slice`, `take`, `drop`, `reverse`, `sort`, `join` and
 *   `flatten` give a value for every list of numbers or of rows.
 */
export const COLLECTION_THROWS: Readonly<
  Record<CollectionFunctionName, boolean | 'count'>
> = {
  'norm': false,
  'mean': false,
  'median': false,
  'variance': false,
  'dot': false,
  'take': false,
  'drop': false,
  'reverse': false,
  'sort': false,
  'join': false,
  'range': 'count',
  'rotate-left': false,
  'rotate-right': false,
  'determinant': false,
  'trace': false,
  'transpose': false,
  'row-reduce': false,
  'inverse': true,
  'matrix-power': true,
  'matrix-multiply': false,
  'matrix-product': false,
  'diagonal': false,
  'flatten': false,
  'population-variance': false,
  'standard-deviation': false,
  'population-standard-deviation': false,
  'skewness': false,
  'kurtosis': false,
  'mode': false,
  'interquartile-range': false,
  'covariance': false,
  'correlation': false,
  'ordering': false,
  'index-of': false,
  'contains': false,
  'unique': false,
  'repeat': 'count',
  'linspace': 'count',
  'slice': false,
  'at-real': false,
  'gather': false,
};

/** Whether the code of each function of one or two operands
 *  (`IRUnaryFunction`, `IRBinaryFunction`) can throw for a number, as in
 *  `OPERATION_THROWS`. The code of every function marked `false` gives a
 *  value for every number, `NaN` and the infinities included. */
export const FUNCTION_THROWS: Readonly<
  Record<UnaryFunctionName | BinaryFunctionName, boolean>
> = {
  'exp': false,
  'ln': false,
  'sin': false,
  'cos': false,
  'tanh': false,
  'abs': false,
  'cbrt': false,
  'tan': false,
  'cot': false,
  'sec': false,
  'csc': false,
  'sinh': false,
  'cosh': false,
  'atan': false,
  'asinh': false,
  'gamma': false,
  'sign': false,
  'conjugate': false,
  'asin': false,
  'acos': false,
  'acosh': false,
  'atanh': false,
  'log10': false,
  'log2': false,
  'erf': false,
  'erfc': false,
  'digamma': false,
  'haversine': false,
  'sinpi': false,
  'cospi': false,
  'tanpi': false,
  'ceil': false,
  'round-ties-away': false,
  'acot': false,
  'acsc': false,
  'asec': false,
  'acoth': false,
  'asech': false,
  'acsch': false,
  'coth': false,
  'sech': false,
  'csch': false,
  'factorial': false,
  'factorial2': false,
  'trunc': false,
  'fract': false,
  'mod-one': false,
  'heaviside': false,
  'ln-gamma': false,
  'sinc': false,
  'erfi': false,
  'erf-inv': false,
  'trigamma': false,
  'fresnel-s': false,
  'fresnel-c': false,
  'sin-integral': false,
  'cos-integral': false,
  'exp-integral-ei': false,
  'log-integral': false,
  'dirichlet-eta': false,
  'dirichlet-beta': false,
  'zeta': false,
  'stieltjes': false,
  'lambert-w': false,
  'elliptic-k': false,
  'elliptic-e': false,
  'atan2': false,
  'pow': false,
  'abs-pow': false,
  'signed-pow': false,
  'real-pow': false,
  'root': false,
  'complex': false,
  'hypot': false,
  'gamma-q': false,
  'gamma-upper': false,
  'beta': false,
  'real-binomial': false,
  'clausen': false,
  'elliptic-f': false,
  'elliptic-e-incomplete': false,
  'elliptic-pi': false,
  'bessel-j': false,
  'bessel-y': false,
  'bessel-i': false,
  'bessel-k': false,
  'agm': false,
  'polygamma': false,
  'zeta-generalized': false,
  'stieltjes-generalized': false,
  'hurwitz-zeta': false,
  'polylog': false,
  'lambert-w-branch': false,
  // `_SYS.remainder`, `_SYS.gcd` and `_SYS.lcm` read their operands with
  // `integerOperand()`, as `mod` does.
  'real-remainder': true,
  'real-gcd': true,
  'real-lcm': true,
  'chop': false,
};

/** The builds and the `range` functions of lists whose count the lowering
 *  knows to be at most 2^32 - 1 (`countFits()`): a `Comprehension` over a
 *  `Range` of literal bounds, and a `Range` of literal operands. */
const FITTING_COUNTS = new WeakSet<IROperation>();

/** Whether the count of the elements of `Range(...bounds)` is known to be
 *  at most 2^32 - 1: every bound is a literal real number, and the count of
 *  `rangeCount()`, the count of `_SYS.range` and of the interpreter, fits.
 *  `bounds` is `[to]`, `[from, to]` or `[from, to, step]`. */
function countFits(bounds: readonly Expression[]): boolean {
  const values = bounds.map((b) =>
    isNumber(b) && b.im === 0 && Number.isFinite(b.re) ? b.re : undefined
  );
  if (values.some((v) => v === undefined)) return false;
  const [from, to, step] =
    values.length === 1 ? [1, values[0]!] : (values as number[]);
  return rangeCount(from, to, step ?? (to >= from ? 1 : -1)) <= 4294967295;
}

/** Whether the code of `op` itself, with no region and no called function,
 *  can throw (`OPERATION_THROWS`, `COLLECTION_THROWS`,
 *  `FUNCTION_THROWS`). With `host` false, a call or a read of the host
 *  is left out. */
function throwsItself(op: IROperation, host = true): boolean {
  if (op.kind === 'host') return host;
  if (op.kind === 'routine') return op.fn !== 'derivative';
  const fact =
    op.kind === 'collection'
      ? COLLECTION_THROWS[op.fn]
      : op.kind === 'unary' || op.kind === 'binary'
        ? FUNCTION_THROWS[op.fn]
        : OPERATION_THROWS[op.kind];
  if (fact !== 'count') return fact;
  if (op.kind === 'loop') return op.checksCount === true;
  if (FITTING_COUNTS.has(op)) return false;
  return op.kind !== 'build' || op.ascending !== true || op.counted === true;
}

/** Whether `op` is a matrix function whose runtime helper can throw
 *  (`COLLECTION_THROWS`): `inverse` and `matrix-power`. */
function throwingMatrixFunction(op: IROperation): boolean {
  return (
    op.kind === 'collection' &&
    (op.fn === 'inverse' || op.fn === 'matrix-power')
  );
}

/** Whether the code of `op`, or of an operation of a region that it
 *  evaluates, or of the body of a function that it calls, can throw on
 *  JavaScript (`throwsItself()`). With `host` false, a call or a read of
 *  the host is left out. A throw is not an effect, so the lowering keeps
 *  such an operation where the existing emitter evaluates it
 *  (`ifStatement()`). `bodyThrows` answers for the function of index `i`
 *  of the program (a called function is lowered before its call). */
function canThrow(
  op: IROperation,
  bodyThrows: (i: number) => boolean,
  host = true
): boolean {
  return (
    throwsItself(op, host) ||
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

/**
 * Whether the existing emitter tests the count of the range `range` of a
 * `Loop` or a `Comprehension` clause before its first pass
 * (`compileCountedRange()`: `if (count > 4294967295) throw new
 * RangeError(…)`): not when its bounds are number literals with at most
 * 2^32 − 1 elements, and not for the single ascending range of literal
 * bounds of a `Loop` (`single`), which it writes as a counted `for`
 * (`isLegacyCompatibleRange()`). Another source (a list) has no such test.
 */
function testsRangeCount(range: Expression, single: boolean): boolean {
  if (!isFunction(range, 'Range') || range.nops !== 2) return false;
  const [a, b] = range.ops;
  if (!isNumber(a) || !isNumber(b)) return true;
  if (single && a.re <= b.re) return false;
  return Math.abs(b.re - a.re) + 1 > 4294967295;
}

/** The names that the target `target` of a `Declare` or an `Assign`
 *  writes: a name, or each name of a destructuring pattern `Tuple(a, b)`. */
function patternNames(target: Expression): string[] {
  if (isSymbol(target)) return [target.symbol];
  if (isFunction(target, 'Tuple'))
    return target.ops.flatMap((p) => (isSymbol(p) ? [p.symbol] : []));
  return [];
}

/** Whether the branch `branch` of an `If` ends in `Continue`: it is
 *  `Continue`, or a `Block` whose last statement is. */
function endsInContinue(branch: Expression): boolean {
  const last =
    isFunction(branch, 'Block') && branch.nops > 0
      ? branch.ops[branch.nops - 1]
      : branch;
  return isFunction(last, 'Continue') && last.nops === 0;
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
  // A destructuring write writes each name of its pattern.
  else if (statement.operator === 'Assign')
    for (const name of patternNames(statement.op1)) names.add(name);
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
        return new Set([...written, ...patternNames(node.op1)]);
      case 'Assign':
        reads(node.op2, written);
        return new Set([...written, ...patternNames(node.op1)]);
      case 'If': {
        reads(node.op1, written);
        const a = visit(node.op2, new Set(written));
        const b = node.nops === 3 ? visit(node.op3, new Set(written)) : written;
        return new Set([...a].filter((name) => b.has(name)));
      }
      case 'Loop': {
        // The bounds of each index set, then the body, which can run no
        // time.
        for (const spec of node.ops.slice(1)) reads(spec, written);
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
