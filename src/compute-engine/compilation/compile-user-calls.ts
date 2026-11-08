// Calls of user and local functions: emission, parameter types, inlining of
// collection-valued calls, and operand types in context.

import {
  describe as describeOperand,
  describeType,
} from '../boxed-expression/operand-descriptor.js';
import { deriveApplicationType } from '../boxed-expression/derive-application-type.js';
import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isScalarParam } from './javascript-value-facts.js';
import {
  collectBinderNames,
  isOperatorDef,
  isValueDef,
  freeSymbolNames,
} from '../boxed-expression/utils.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import {
  broadcastableParamSlots,
  declaresBroadcastableParam,
  type BroadcastSlotPlan,
} from '../boxed-expression/boxed-function.js';
import { isTuple, isTupleShapedType } from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
  isPointElementType,
  resolveTypeAlias,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { factsOf } from '../../common/type/facts.js';
import { typeToString } from '../../common/type/serialize.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import { unrollFixedWidthCollections } from './fixed-width-unroll.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  userFunctionSignature,
  signatureParamType,
  userFunctionLiteral,
  userFunctionParamsAreScalar,
} from './compile-assignment-checks.js';
import {
  LOCAL_BOOLEAN,
  isProvablyRealValued,
  localShapeFrameOf,
} from './compile-shapes.js';
import { LOCAL_SCALAR } from './compile-declarations.js';
import type { EnclosingDefinition } from './compiler-types.js';
import {
  compilationType,
  isNominalAtomicType,
  isTopTypedLocalSymbol,
} from './compiler-type-facts.js';
import { compileValueOperand } from './compile-statements.js';
import { tempVar } from './compiler-naming.js';
import {
  MAX_NESTED_INLINES,
  inlineCollectionValuedCalls,
  invariantPrefixes,
  isSinglePointArg,
  substitutedUserFunctionBody,
  userFunctionIsGeneric,
  userFunctionName,
} from './compile-cse.js';
import { core } from './compiler-core-hooks.js';
import { CompilerState } from './compiler-state.js';
import { NO_NAMES } from './compiler-tables.js';
import { CompileDeclineError, UNSETTLED_SHAPE_CODE } from './diagnostics.js';
import {
  isNominalWithUnsettledRank,
  bindsOnePointAsUndeclared,
  isOpenScalarRankType,
  isScalarShaped,
  mapRankOfType,
} from './static-shape.js';

/**
 * True when the static type of `a` is a scalar (`isScalarShaped()`), or `a`
 * is a symbol that the innermost local shape frame records as a SCALAR
 * (`LOCAL_SCALAR`). A declared-complex parameter is entered that way
 * (`addDeclaredComplexParams`): in the complex variant of a shader target
 * its type in context reads as a pair, yet a complex-typed parameter holds
 * exactly one complex object, and a nested call passing it on
 * (`c(x: complex) := b(x) + 1`) must see a scalar argument.
 */
export function provablyScalarOrFramedScalar(a: Expression): boolean {
  if (isScalarShaped(a.type.type)) return true;
  if (!isSymbol(a)) return false;
  return localShapeFrameOf(a.symbol)?.get(a.symbol) === LOCAL_SCALAR;
}

/**
 * The `{ re, im }` delivery of argument `arg` (compiled as `code`) to a
 * declared-complex parameter, in whichever of three forms the argument's
 * static shape already settles:
 *
 *  - provably COMPLEX: the emitted code is already an object, so it is
 *    passed through untouched — no wrap, no runtime test. Only a complex
 *    NUMBER LITERAL qualifies, and only because this compiler emits it as
 *    the `{ re, im }` object itself, so the wrap would be pure redundancy.
 *    Neither looser test works: `isComplexValued` answers "could be
 *    complex" and is true for an untyped symbol, and the TYPE is no better
 *    — `Q(w)` INFERS `w: complex` from the declared parameter, yet `run({
 *    w: 2 })` may still supply a plain number, since a real is a complex.
 *    Both dropped the wrap from the very case that needs it;
 *  - provably REAL: wrapped statically, the shape being known;
 *  - neither (an untyped free symbol bound at `run()` time — the common
 *    case): the caller may hand over a plain number OR an already-complex
 *    object and only a runtime test can tell, so `_SYS.cplx` decides. It
 *    is idempotent, so an object passes through instead of nesting.
 *
 * Shared by the single-literal call site (`emitUserFunctionCall`) and the
 * protocol member dispatch (`userFunctionsPreamble`), so the two agree.
 */
export function complexWrapCode(
  code: string,
  arg: Expression | undefined,
  target?: CompileTarget<Expression>
): string {
  if (
    arg !== undefined &&
    isNumber(arg) &&
    arg.isNumberLiteral === true &&
    isNonRealNumber(arg.type.type)
  )
    return code;
  if (arg !== undefined && isProvablyRealValued(arg, target))
    return `({ re: ${code}, im: 0 })`;
  return `_SYS.cplx(${code})`;
}

/**
 * The call site of an already-emitted user function `name`, in one of three
 * forms that the static types of the arguments select at compile time
 * (rule R2 of `docs/plans/2026-10-31-static-shape-compilation.md`):
 *
 * - a direct call, `name(a…)`, when no argument is a list that the call
 *   maps over;
 * - a static map, when the parameters of the callee are scalar
 *   (`paramsAreScalar`) and some arguments are lists: the interpreter
 *   applies the function to each element (`f(L)` with `f(t) := 2t + 1`
 *   and `L = [1, 2, 3]` is `[3, 5, 7]`). The depth of the map over each
 *   argument is its rank (`callArgumentMapRank()`), written into the code
 *   by the compiler: `_SYS.mapFn(name, [1, 0], L, x)` on JavaScript,
 *   `_IA.mapFn(…)` on interval-js, a comprehension on Python;
 * - a decline, when an argument at a scalar parameter has no settled
 *   shape (rule R3): the code would have to test the value at run time to
 *   know whether to map. The decline names the argument.
 *
 * The code tests no shape of a value at run time. A host value outside
 * the static type of its argument (a list for an input whose type is
 * `real`) gives an unspecified result.
 *
 * Shared by the ENGINE-defined route (`tryCompileUserFunction`), the
 * BLOCK-LOCAL route (`tryCompileLocalFunctionCall`) and the specialized
 * copies (`trySpecializedUserCall`), which differ only in where they read
 * the callee's signature from, never in how the call is spelled.
 *
 * `declaredCoercions[i]` is `true` for an argument to wrap in the
 * `{ re, im }` convention, and `'real'` for an argument whose real
 * projection the callee receives (`realProjection()`), and
 * `'real-operand'` for an argument that the callee receives through
 * `_SYS.crealElements` (`literalRealLaneArguments()` for a `Function`
 * literal); `paramsAreScalar` says no parameter binds a collection whole.
 * A complex argument whose entry is `false` is converted with
 * `_SYS.crealElements` when the definition reads the parameter on the
 * real lane (`realLaneArguments`).
 */
export function emitUserFunctionCall(
  name: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  declaredCoercions: ReadonlyArray<boolean | 'real' | 'real-operand'>,
  paramsAreScalar: boolean,
  /**
   * Compiled arguments appended after `args` in EVERY call form, and
   * never mapped over: the values of an invariant-prefix variant's
   * extra parameters (`tryCompileUserFunction`). A hoisted prefix is a
   * value the callee's body reads whole — a list the body indexes must
   * reach it as that list — so it is passed the way an atomic argument
   * is, while the ordinary arguments keep their map.
   */
  held: ReadonlyArray<string> = []
): TargetSource {
  const coerceToComplex = realLaneArguments(
    name,
    args,
    target,
    declaredCoercions
  );
  // The rank of each argument: the number of list levels that the call
  // maps over. A callee with a parameter that binds a collection whole
  // binds every argument whole, as the interpreter does.
  const ranks = args.map((a) =>
    paramsAreScalar ? callArgumentMapRank(a, target) : 0
  );
  // A value of a nominal type has the rank 0: the call does not map over
  // it. When its definition has no settled rank (`broadcastable<real>`), no
  // variant has a parameter of that type, and the call declines
  // (`isNominalWithUnsettledRank()`).
  const nominal = paramsAreScalar
    ? args.findIndex((a) =>
        isNominalWithUnsettledRank(core.staticTypeOf(a, target))
      )
    : -1;
  if (nominal >= 0) throw unsettledArgumentDecline(name, args[nominal]);
  const unsettled = ranks.findIndex((r) => r === undefined);
  if (unsettled >= 0) {
    const open = openRankCall(name, args, target, coerceToComplex, held);
    if (open !== undefined) return open;
    throw unsettledArgumentDecline(name, args[unsettled]);
  }

  // On a target that spells collection values only in consuming positions
  // (`CompileTarget.compileCollectionValue`), an argument is one when the
  // callee binds it WHOLE (a collection-typed parameter: `d(a, b) :=
  // a[1]·b[1] + a[2]·b[2]` infers both parameters as collections), and
  // when the call maps over it (a rank above 0).
  const spellCollection = (
    a: Expression,
    i: number
  ): TargetSource | undefined => {
    if (target.compileCollectionValue === undefined) return undefined;
    if (paramsAreScalar && !(ranks[i]! > 0)) return undefined;
    return target.compileCollectionValue(a, target);
  };
  const compiledArgs = args.map((a, i) => {
    const code = spellCollection(a, i) ?? compileValueOperand(a, target);
    return code;
  });

  // Deliver a `{ re, im }` to a declared-complex parameter, in whichever of
  // three forms the argument's static shape already settles
  // (`complexWrapCode`). In a map, the wrap applies to the element.
  const coerce = (code: string, i: number) =>
    coerceToComplex[i] === 'real'
      ? `_SYS.creal(${code})`
      : coerceToComplex[i] === 'real-operand'
        ? `_SYS.crealElements(${code})`
        : coerceToComplex[i]
          ? complexWrapCode(code, args[i], target)
          : code;

  if (!ranks.some((r) => r! > 0))
    return `${name}(${[...compiledArgs.map(coerce), ...held].join(', ')})`;

  if (target.language === 'python')
    return pythonMapCall(
      name,
      ranks as number[],
      compiledArgs,
      held,
      target,
      args.map((a, i) =>
        admitsAbsentAtMappedLevel(core.staticTypeOf(a, target), ranks[i]!)
      )
    );

  const helper =
    target.language === 'javascript'
      ? '_SYS.mapFn'
      : target.language === 'interval-javascript'
        ? '_IA.mapFn'
        : undefined;
  if (helper === undefined)
    throw new Error(
      `Could not compile a call of \`${name}\`: the call maps the function ` +
        `over a list argument, which this target does not compile.`
    );
  // With no argument to coerce and no held value, the mapped function is
  // the callee itself, not an arrow that only calls it.
  let fn = name;
  if (coerceToComplex.some((c) => c) || held.length > 0) {
    const params = args.map(() => tempVar(target));
    fn =
      `((${params.join(', ')}) => ` +
      `${name}(${[...params.map(coerce), ...held].join(', ')}))`;
  }
  return `${helper}(${fn}, [${ranks.join(', ')}], ${compiledArgs.join(', ')})`;
}

/**
 * The conversion of each argument of a call of the JavaScript definition
 * `name`: `coerceToComplex`, the conversion that the declared parameter
 * types ask for, with `'real-operand'` for each argument that it leaves
 * unconverted, that is complex-valued, and whose parameter the definition
 * reads on the real lane (`paramsByName`, recorded by
 * `recordUserFunctionParamLanes`). The call then passes
 * `_SYS.crealElements` of the argument: its real part when the value is
 * real, `NaN` otherwise, which is the real-operand rule of the complex
 * lane (`cisreal ? creal : NaN`).
 *
 * In `mode: 'complex'` an untyped parameter has the wide type `unknown`,
 * so a wide argument is lifted to a `{re, im}` object, while the body can
 * read the parameter on the real lane (a use in `Floor` narrows it to a
 * real type). With `s(x) := x - ⌊x⌋` and `g := t ↦ s(t) + 1`, `g(u)` at
 * `u = 0.25` gave the string `"[object Object]NaN1"`; it is `1.25`, the
 * value of the interpreter.
 *
 * A definition with no record (a multi-clause dispatcher, a list recursion
 * loop, a recursive call reached before its own record) keeps
 * `coerceToComplex`.
 */
function realLaneArguments(
  name: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  coerceToComplex: ReadonlyArray<boolean | 'real' | 'real-operand'>
): ReadonlyArray<boolean | 'real' | 'real-operand'> {
  const registry = target.userFunctions;
  if (target.language !== 'javascript' || registry === undefined)
    return coerceToComplex;
  const paramLanes = core.userFunctionParamLanes(registry, name);
  if (paramLanes === undefined) return coerceToComplex;
  return coerceToComplex.map((c, i) =>
    c === false && paramLanes[i] === false && core.isComplexValued(args[i])
      ? 'real-operand'
      : c
  );
}

/**
 * The call of the function `name`, whose parameters are scalar, when an
 * argument is declared `broadcastable<T>` with `T` a scalar type
 * (`isOpenScalarRankType()`): the host asks for an open rank, so the call
 * maps the function over every list level of the value at run time, with
 * the broadcast helper of the operators (`_SYS.bcast` on JavaScript,
 * `_IA.bcast` on interval-js). With `g := t ↦ t + 1` and
 * `b: broadcastable<real>`, `g(b)` is `_SYS.bcast(_fn_g, _.b)`: 3 for 2,
 * `[2, 3]` for `[1, 2]`, `[[2, 3], [4]]` for `[[1, 2], [3]]`, as the
 * interpreter gives.
 *
 * The helper maps over every array that it receives, so each other
 * argument must be one scalar or have an open rank too. A point or a list
 * of known rank beside the value, a held value, a complex coercion, or
 * another target gives `undefined`, and the call declines.
 */
function openRankCall(
  name: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  coerceToComplex: ReadonlyArray<boolean | 'real' | 'real-operand'>,
  held: ReadonlyArray<string>
): TargetSource | undefined {
  const helper =
    target.language === 'javascript'
      ? '_SYS.bcast'
      : target.language === 'interval-javascript'
        ? '_IA.bcast'
        : undefined;
  if (helper === undefined || held.length > 0) return undefined;
  if (coerceToComplex.some((c) => c)) return undefined;
  const types = args.map((a) => core.staticTypeOf(a, target));
  if (!types.some((t) => isOpenScalarRankType(t))) return undefined;
  if (!types.every((t) => isOpenScalarRankType(t) || isScalarShaped(t)))
    return undefined;
  const codes = args.map((a) => compileValueOperand(a, target));
  return `${helper}(${name}, ${codes.join(', ')})`;
}

/**
 * The decline of a call of the function `name` whose argument `a` has no
 * settled shape at a scalar parameter (rule R3 of
 * `docs/plans/2026-10-31-static-shape-compilation.md`): the interpreter
 * maps the function over a list and applies it to a scalar, so the code
 * would have to test the value at run time. The interpreter fallback puts
 * the argument in `unsupported`: its name for a symbol, else the text
 * that `toString()` writes.
 */
export function unsettledArgumentDecline(
  name: string,
  a: Expression
): CompileDeclineError {
  // `toString()` quotes a symbol of more than one letter (`"xs"`), so a
  // symbol is named by its plain name.
  const argName = isSymbol(a) ? a.symbol : a.toString();
  return new CompileDeclineError({
    code: UNSETTLED_SHAPE_CODE,
    kind: 'capability',
    message:
      `Could not compile a call of \`${name}\`: the argument ` +
      `"${argName}" has the type \`${a.type.toString()}\`, which ` +
      `does not settle one shape (a scalar, a point, or a list of known ` +
      `depth). The interpreter maps the function over a list argument ` +
      `and applies it to a scalar, so the shape of the value would be ` +
      `known only at run time.`,
    value: argName,
  });
}

/**
 * The static map of a call on the Python target: a nested list
 * comprehension, one level per rank. Every argument is bound once by a
 * `lambda`, so an argument is evaluated once, in source order, as in the
 * direct call. Several lists at one level are read in step with `zip`.
 *
 * `absent[j]`: the argument `j` can be absent (`None`) at a mapped level,
 * the whole argument (`L: list<real> | missing`) or an element above the
 * rank-0 level (`list<list<real> | missing>`). At each mapped level, the
 * code then tests that value: an absent value is not iterated, and reaches
 * the function as it is, as an argument of rank 0 does. This is what
 * `mapWith` in `javascript-runtime.ts` does, and the interpreter applies
 * the function to the absent value (`Apply(t ↦ 7, L)` is 7 for an absent
 * `L`). Without the test, the comprehension iterated `None` and raised a
 * `TypeError`.
 */
export function pythonMapCall(
  name: string,
  ranks: ReadonlyArray<number>,
  codes: ReadonlyArray<string>,
  held: ReadonlyArray<string>,
  target: CompileTarget<Expression>,
  absent: ReadonlyArray<boolean> = []
): string {
  // A callee that is not a name (a `lambda`) is bound once too, so it is
  // not built again at each element.
  const fn = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : tempVar(target);
  const bound = codes.map(() => tempVar(target));
  const level = (vars: string[], rs: ReadonlyArray<number>): string => {
    const mapped = rs.map((r, j) => (r > 0 ? j : -1)).filter((j) => j >= 0);
    if (mapped.length === 0) return `${fn}(${[...vars, ...held].join(', ')})`;
    return guard(
      vars,
      rs,
      mapped,
      mapped.filter((j) => absent[j] === true)
    );
  };
  // The test of each argument of `pending` that can be absent at this
  // level: when it is `None`, the code continues with the rank 0 for it.
  const guard = (
    vars: string[],
    rs: ReadonlyArray<number>,
    mapped: ReadonlyArray<number>,
    pending: ReadonlyArray<number>
  ): string => {
    if (pending.length > 0) {
      const [j, ...more] = pending;
      const whole = level(
        vars,
        rs.map((r, i) => (i === j ? 0 : r))
      );
      return `(${whole} if ${vars[j]} is None else ${guard(vars, rs, mapped, more)})`;
    }
    const elements = mapped.map(() => tempVar(target));
    const inner = vars.slice();
    mapped.forEach((j, k) => (inner[j] = elements[k]));
    const body = level(
      inner,
      rs.map((r) => (r > 0 ? r - 1 : 0))
    );
    const source =
      mapped.length === 1
        ? vars[mapped[0]]
        : `zip(${mapped.map((j) => vars[j]).join(', ')})`;
    return `[${body} for ${elements.join(', ')} in ${source}]`;
  };
  const params = fn === name ? bound : [fn, ...bound];
  const values = fn === name ? codes : [name, ...codes];
  return (
    `(lambda ${params.join(', ')}: ${level(bound, ranks)})` +
    `(${values.join(', ')})`
  );
}

/**
 * True when a value of type `t`, mapped over `rank` list levels, can be
 * absent at one of these levels: the value itself, or an element at a
 * level less than `rank` (`list<list<real> | missing>` with the rank 2).
 * An absent element at the level `rank` reaches the function, and is not
 * tested. When the element type is not known, the answer is true if `t`
 * holds `missing` anywhere.
 */
export function admitsAbsentAtMappedLevel(
  t: Readonly<Type>,
  rank: number
): boolean {
  if (rank <= 0) return false;
  if (isSubtype('missing', t)) return true;
  if (rank === 1) return false;
  // `t` does not admit `missing` here, so its element type is read as it
  // is: `stripMissingFromType()` also removes `missing` from the elements.
  const element = collectionElementType(t);
  return element === undefined
    ? typeContainsMissing(t)
    : admitsAbsentAtMappedLevel(element, rank - 1);
}

/**
 * True when the argument `a` is one scalar: its static type is a number, a
 * boolean or a string (`isScalarShaped()`), the result type of the variant
 * included for a call of a user function, and a parameter of the scalar
 * variant of a function (`staticTypeOf()`).
 */
export function isScalarShapedArg(
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  return isScalarShaped(core.staticTypeOf(a, target));
}

/**
 * The number of list levels that a call of a function with scalar
 * parameters maps over for the argument `a`, or `undefined` when the
 * static type of `a` does not settle it (`mapRankOfType()`).
 *
 * The static type is the contract (rule R1): an argument typed `number` is
 * a scalar. An argument that is a call of a user function whose type does
 * not settle the rank (a function assigned with no declaration, or
 * declared `-> unknown`) is read with the result type of its variant
 * (`staticTypeOf()`, rule R2). A parameter of the scalar variant of a
 * function whose parameters are scalar is a scalar (`staticTypeOf()` reads
 * `isScalarParam()`): that variant is compiled from the literal, whose bare
 * parameters have the type `unknown`, and every call reaches it with scalar
 * values, directly or from inside a static map. A point (`isTuple`) and a value of a nominal
 * type (`isNominalAtomicArg`) reach the callee whole.
 *
 * An argument that is a call of a user function is also read with the type
 * of the call in the current scope (`callTypeInCurrentScope()`) when the
 * rules above do not settle the rank.
 */
export function callArgumentMapRank(
  a: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  if (provablyScalarOrFramedScalar(a)) return 0;
  if (isTuple(a) || isNominalAtomicArg(a)) return 0;
  const rank = mapRankOfType(core.staticTypeOf(a, target));
  if (rank !== undefined) return rank;
  const inScope = callTypeInCurrentScope(a);
  const rankInScope =
    inScope === undefined ? undefined : mapRankOfType(inScope);
  if (rankInScope !== undefined) return rankInScope;
  // An input with no type is refused by the root (`assertAdmitted()`, code
  // `'untyped-input'`), which names it in `unsupported`. The call does not
  // decline for it first, so that the decline names the input as one to
  // declare.
  if (isUntypedFreeInput(a, target)) return 0;
  return undefined;
}

/**
 * The type of the call `a` of a user function (a symbol whose value is a
 * function literal) when it is boxed again in the current scope, or
 * `undefined` when `a` is not such a call.
 *
 * The compiled code calls the function that the name of the callee names
 * in the current scope, and the type of the call there is the type of the
 * compiled value. It can be more precise than the type of `a`: the
 * compilation of a user function that shadows a library name
 * (`withShadowingCallsRenamed()`, `shadowing-calls.ts`) binds the renamed
 * calls to declarations with no value, and a call of `Floor := x ↦ [x, x]`
 * then has the type `list<unknown>`, where the same call bound to the copy
 * with its value has the type `vector<real^2>`.
 */
function callTypeInCurrentScope(a: Expression): Type | undefined {
  if (!isFunction(a)) return undefined;
  const ce = a.engine;
  const def = ce.lookupDefinition(a.operator);
  if (def === undefined || !isValueDef(def)) return undefined;
  const value = def.value.value;
  if (value === undefined || !isFunction(value, 'Function')) return undefined;
  try {
    return ce.function(a.operator, [...a.ops]).type.type;
  } catch (e) {
    if (e instanceof Error && e.name === 'CancellationError') throw e;
    return undefined;
  }
}

/**
 * Is `a`'s STATIC type one whose values are ATOMIC at a call site — bound
 * WHOLE by the interpreter, never mapped over? The nominal counterpart of
 * the `isTuple` clause above (ruled 2026-08-12, context in
 * `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md`).
 *
 * Keyed on the static TYPE, not on the expression's shape: `size(b)` with
 * `b: bag` is as atomic as `size(bag([1,2,3]))`.
 *
 * Two answers are `true`:
 *  - an OPAQUE nominal reference (`alias !== true`). D3: a nominal's
 *    representation is not its definition, so the interpreter binds the
 *    tagged value whole. Compilation erases the tag (D11), and the bare
 *    array left behind is what a static map would wrongly map.
 *  - a TRANSPARENT alias reference that is a sugar-declared SUM — its
 *    declaration record carries `_sumVariants`. Every arm of such a sum is
 *    a nominal, so every runtime value is atomic by the clause above,
 *    whichever arm it came from. (Under the TAGGED policy the value is a
 *    `{_tag}` object; under the ERASED policy it can be a bare array. The
 *    static test covers both uniformly.)
 *
 * Everything else is `false` — in particular a plain transparent alias
 * (`type alias mylist = list<number>`), which the interpreter DOES look
 * through and DOES broadcast over, and a hand-written union, which carries
 * no sum identity.
 *
 * `alias` is read through the LIVE accessor (it delegates to the
 * declaration record — a forward reference is created nominal-by-default
 * and flipped when the `type alias` that fulfils it is parsed), and
 * `_sumVariants` through {@link declarationOf}, since it lives on the
 * declaration record and never on an applied reference.
 */
export function isNominalAtomicArg(a: Expression): boolean {
  return isNominalAtomicType(a.type.type);
}

/**
 * Does user-defined function `h` broadcast over a collection argument, i.e.
 * are all of its formal parameters scalar? Mirrors the interpreter's
 * broadcast gate (`applyFunctionLiteral` / step 2b in `boxed-function.ts`):
 * the DECLARED signature is authoritative when there is one, the literal's
 * own inferred type is the fallback. Conservative (`unknown` → scalar), the
 * same way `paramsAreScalar` is.
 */
/**
 * Does every parameter of `signature` lower to a JavaScript SCALAR — a
 * number, a `{re, im}` object, a boolean, a string — or to an `unknown`
 * value? A tuple, a record, a nominal (tagged or opaque) value and a
 * collection all lower to a bare JavaScript array or object, and the
 * interpreter binds such an argument whole, so a function with such a
 * parameter keeps the bare reference as a value, with no static map over
 * its arguments. A parameter typed `unknown` or `any` is admitted, as the
 * interpreter's own broadcast gate admits it; the static type of the value
 * that reaches it selects the map (`callbackArgumentRanks()`), and a record
 * has the rank 0 (`mapRankOfType()`).
 */
export function signatureParamsLowerToScalars(
  signature: Type | undefined
): boolean {
  if (
    signature === undefined ||
    typeof signature === 'string' ||
    signature.kind !== 'signature'
  )
    return true;
  const params = [
    ...(signature.args ?? []),
    ...(signature.optArgs ?? []),
    ...(signature.variadicArg ? [signature.variadicArg] : []),
  ];
  return params.every(({ type: t }) => {
    if (t === 'unknown' || t === 'any') return true;
    if (isNominalAtomicType(t)) return false;
    if (isTupleShapedType(t)) return false;
    if (typeof t !== 'string' && (t.kind === 'record' || t.kind === 'tuple'))
      return false;
    return (
      isSubtype(t, 'number') ||
      isSubtype(t, 'boolean') ||
      isSubtype(t, 'string')
    );
  });
}

/**
 * Does the DECLARED signature of user-defined function `h` mark any
 * parameter `broadcastable<T>` — in ANY overload arm? Same definition
 * resolution as {@link userFunctionParamsAreScalar}; only the DECLARED type
 * counts (the contract is a declaration, never an inference), so an
 * unannotated literal answers `false` and every existing compilation is
 * untouched.
 */
export function userFunctionHasBroadcastableParam(
  engine: ComputeEngine,
  h: string
): boolean {
  const def = engine.lookupDefinition(h);
  if (!def) return false;
  if (isOperatorDef(def)) return declaresBroadcastableParam(def.operator);
  if (!('value' in def) || def.value === undefined) return false;
  return (
    declaresBroadcastableParam(def.value.type?.type) ||
    declaresBroadcastableParam(def.value.value?.type?.type)
  );
}

/**
 * The PER-SLOT broadcast plan of user-defined function `h`, or `undefined`
 * when it declares no `broadcastable<T>` parameter — or when its type is an
 * overload set, which has no single plan (see
 * {@link declaresBroadcastableParam}).
 */
export function userFunctionBroadcastPlan(
  engine: ComputeEngine,
  h: string
): BroadcastSlotPlan | undefined {
  const def = engine.lookupDefinition(h);
  if (!def) return undefined;
  if (isOperatorDef(def)) return broadcastableParamSlots(def.operator);
  if (!('value' in def) || def.value === undefined) return undefined;
  return (
    broadcastableParamSlots(def.value.type?.type) ??
    broadcastableParamSlots(def.value.value?.type?.type)
  );
}

/**
 * Fail closed rather than emit code for an application the DECLARED
 * `broadcastable<T>` contract would evaluate element-wise.
 *
 * A declared `broadcastable<T>` parameter whose `T` can hold a list
 * (`broadcastable<value>`) is an ELEMENTWISE contract that maps exactly ONE
 * rank down (Option A, ratified 2026-08-08 —
 * `docs/plans/2026-08-08-broadcastable-param-semantics.md`). A `T` that
 * cannot hold a list maps to the cells (amendment of 2026-10-24, ROADMAP
 * CE-405), which the element-wise call expresses: a callee whose every
 * parameter is then scalar (`compilesAsScalarParams`) is not declined.
 * Neither emitted form expresses the one-rank map:
 *   - a direct scalar call hands the callee the whole array (`_fn_g([1,2,3])`
 *     computes the JS string `"1,2,31"` for `x + 1`);
 *   - a static map (`_SYS.mapFn`) over the rank of the static type descends
 *     to the leaves, which is the unannotated default, not the
 *     declaration's one rank.
 *
 * PER SLOT, though: only an argument that could actually be MAPPED forces
 * the decline. A collection at a slot the contract binds whole compiles
 * exactly as it did before the declaration existed, and so does an atomic
 * TUPLE — or an atomic NOMINAL-typed value — the slot's element type
 * ADMITS (neither is ever mapped — rule 4, and the 2026-08-12 nominal
 * ruling). One the element type refutes is NOT exempt: the interpreter
 * answers `incompatible-type` there, and no emitted form says that.
 */
/**
 * Is `a` ONE point — a value the interpreter treats as a single atomic
 * operand in arithmetic (`2·P` scales it, `P + Q` adds componentwise), and
 * never broadcasts over?
 *
 * Three spellings qualify: a literal `Tuple`; a `PointList` whose every
 * operand is provably a number, which is one point with operand k as
 * coordinate k (a `PointList` with a collection-typed operand is a SOURCE
 * of several points instead, and is excluded by the same test the
 * fixed-width unroll and the interval target apply); and any operand whose
 * static type is tuple-shaped, such as a symbol declared
 * `tuple<real, real>`.
 */
/**
 * The first argument position holding a single point (`isSinglePointArg`)
 * whose coordinates are not all plain real numbers at run time — a
 * coordinate that lowers to a `{re, im}` object, or coordinates of mixed
 * shapes (`operandElementLane`) — or `-1`. Such a point cannot be passed
 * to an emitted definition, which reads coordinates as real numbers.
 */
export function complexCoordinateArgumentAt(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): number {
  const written = writtenPointWithComplexCoordinateAt(args);
  if (written >= 0) return written;
  for (let i = 0; i < args.length; i++) {
    const a = throughTyped(args[i]);
    if (!isSinglePointArg(a)) continue;
    // A written-out point was decided above.
    if (isFunction(a, 'Tuple') || isFunction(a, 'PointList')) continue;
    const lane = core.operandElementLane(a, engine, target);
    if (lane === true || lane === 'mixed') return i;
  }
  return -1;
}

/**
 * The first argument position holding a point WRITTEN OUT — a `Tuple` or
 * a `PointList` of scalar coordinates, which is what an inlined
 * point-valued helper leaves behind — one of whose coordinates is
 * complex-shaped (`isComplexValued`), or `-1`. Each coordinate is read on
 * its own lane; `elementComplexness` reads a `Tuple` the same way but
 * answers nothing for a `PointList`, whose components may also be list
 * columns. Read through a return-type ascription (`throughTyped`).
 */
export function writtenPointWithComplexCoordinateAt(
  args: ReadonlyArray<Expression>
): number {
  for (let i = 0; i < args.length; i++) {
    const a = throughTyped(args[i]);
    if (!isFunction(a, 'Tuple') && !isFunction(a, 'PointList')) continue;
    if (!isSinglePointArg(a)) continue;
    if (a.ops.some((c) => core.isComplexValued(c))) return i;
  }
  return -1;
}

/**
 * `a` without its return-type ascriptions: an inlined helper whose
 * declared result is wider than its body leaves its value wrapped in
 * `Typed(value, '…')`.
 */
export function throughTyped(a: Expression): Expression {
  while (isFunction(a, 'Typed')) a = a.op1;
  return a;
}

/**
 * Is this argument, on a shader target, a LIST of 2 to 4 real numbers —
 * a value that lowers to a `vec2`, `vec3` or `vec4` — and not a point or
 * a complex value? The width comes from `aggregateComponentCount`. The
 * element type may be `number` (an element that is a free symbol): a
 * shader computes in floats, and an argument with a complex element is
 * refused through `isComplexValued`.
 */
export function isShaderVectorListArg(a: Expression): boolean {
  if (isSinglePointArg(a)) return false;
  if (core.isComplexValued(a)) return false;
  const t = resolveTypeForCompilation(a.type.type);
  if (!isSubtype(t, 'indexed_collection<number>')) return false;
  const elt = collectionElementType(t);
  if (elt === undefined || !isSubtype(elt, 'number')) return false;
  const width = core.aggregateComponentCount(a);
  return width !== undefined && width >= 2 && width <= 4;
}

/**
 * Is this argument a LIST of real numbers by its type — an indexed
 * collection whose element type is a real number subtype (`vector<real^4>`,
 * `list<number>`) — and not a point? A complex element type is refused:
 * the specialized body would be compiled in the real lane.
 */
export function isRealListArg(a: Expression): boolean {
  if (isSinglePointArg(a)) return false;
  const t = resolveTypeForCompilation(a.type.type);
  if (!isSubtype(t, 'indexed_collection<number>')) return false;
  const elt = collectionElementType(t);
  return elt !== undefined && isSubtype(elt, 'number') && !isNonRealNumber(elt);
}

/**
 * Is this argument a list of lists of real numbers by its type, at any
 * depth (`list<list<real>>`, `list<vector<real^3>>`), and not a point? A
 * complex leaf type is refused, as for `isRealListArg()`. A union element
 * type (`list<list<real> | real>`) is refused: such an element has no
 * settled shape.
 */
export function isNestedRealListArg(a: Expression): boolean {
  if (isSinglePointArg(a)) return false;
  let t = resolveTypeForCompilation(a.type.type);
  if (!isSubtype(t, 'indexed_collection<indexed_collection<any>>'))
    return false;
  for (let depth = 0; depth < 16; depth++) {
    const elt = collectionElementType(t);
    if (elt === undefined) return false;
    if (isSubtype(elt, 'number')) return !isNonRealNumber(elt);
    const resolved = resolveTypeForCompilation(elt);
    if (!isSubtype(resolved, 'indexed_collection<any>')) return false;
    t = resolved;
  }
  return false;
}

/**
 * The 0-based position of the first argument that is a single point
 * ({@link isSinglePointArg}) bound to a parameter of `h` that has NO type
 * — `unknown` or `any`, the type an unannotated parameter keeps when no use
 * in the body narrows it, `value`, or a union with such a member, such as
 * the `collection<any> | value` that a body which uses the parameter whole
 * infers (`bindsOnePointAsUndeclared()`) — or `-1` when there is none.
 *
 * Such a call cannot go by reference. A definition is emitted once, and its
 * body's arithmetic is shaped by the parameter's STATIC type: with `P`
 * untyped, `r(P) := 2·P` is emitted as scalar arithmetic, and the call
 * `r((a, b))` hands that arithmetic the JavaScript array a point lowers
 * to, which answers NaN where the interpreter answers the point
 * `(2a, 2b)`. A parameter is typed from the uses in its own body, never
 * from a call site, so the parameter cannot say it holds a point; the call
 * site is the only place that knows. `tryCompileUserFunction` inlines such
 * a call instead, so the point reaches the body and the target's own
 * point lowering applies, and fails closed when it cannot.
 *
 * A parameter whose type IS tuple-shaped (`P: tuple<real, real>`, or one
 * narrowed by a `PointX(P)` in the body) is not affected: the body was
 * emitted for a point. Neither is a parameter the body never READS —
 * `f(p, x) := g(x)` binds a point to `p` and does nothing with it, so the
 * emitted body computes the same value whatever `p` holds, and the
 * by-reference call stands: the version of the function chosen from the
 * argument types at the call binds the point whole, with no run-time
 * broadcast over its coordinates. A function with no
 * single literal (a multi-clause function) is not examined: each clause
 * dispatches on the run-time shape of its arguments.
 */
export function pointArgumentAtUntypedParameter(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): number {
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return -1;
  // FREE occurrences only: a parameter whose name the body uses only under
  // an inner lambda of the same name (`f(p) := Map(p ↦ 2p, L)`) is never
  // read, and the call goes by reference as an unmentioned parameter does.
  const mentioned = freeSymbolNames(literal.ops[0]);
  for (const [i, a] of args.entries()) {
    if (!isSinglePointArg(a)) continue;
    const name = functionLiteralParameterName(literal.ops[i + 1]);
    if (!name || !mentioned.has(name)) continue;
    const pt = userFunctionParamType(engine, h, i);
    if (pt === undefined || bindsOnePointAsUndeclared(pt)) return i;
  }
  return -1;
}

/**
 * The 0-based position of the first argument that is a LIST (its type is
 * an indexed collection, and it is not a point) bound WHOLE to a
 * parameter of `h` whose element type is open, or `-1` when there is
 * none.
 *
 * A list is bound whole when a parameter of `h` admits a collection
 * (`userFunctionParamsAreScalar` is false). The element type is open when
 * the signature is inferred, or the parameter is declared with no element
 * type (`paramElementTypeIsOpen`). The emitted definition of such a
 * function compiles the body against the scalar arm of the slot, so it
 * cannot receive the list. A parameter declared with an element type
 * (`list<real>`) is the host's contract, and the definition is compiled
 * against it. Only a parameter that the body mentions free is counted.
 */
export function listArgumentAtOpenWholeParameter(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): number {
  if (userFunctionParamsAreScalar(engine, h)) return -1;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined) return -1;
  const mentioned = freeSymbolNames(literal.ops[0]);
  for (const [i, a] of args.entries()) {
    if (isSinglePointArg(a)) continue;
    const t = resolveTypeForCompilation(a.type.type);
    if (t === 'never' || !isSubtype(t, 'indexed_collection<any>')) continue;
    const name = functionLiteralParameterName(literal.ops[i + 1]);
    if (!name || !mentioned.has(name)) continue;
    if (!paramElementTypeIsOpen(engine, h, i)) continue;
    if (isElementWiseOperand(literal.ops[0], name)) return i;
  }
  return -1;
}

/**
 * Is the symbol `name` a direct operand of an element-wise
 * (`broadcastable`) application somewhere in `body`? Such an application
 * is compiled for the scalar arm of an open parameter slot, so it is the
 * use that gives a wrong value over a list. A parameter that reaches only
 * whole-collection readers (`a[1]`, `Length(a)`) is compiled correctly
 * over an array, and is not counted.
 */
export function isElementWiseOperand(body: Expression, name: string): boolean {
  const seen = new Set<Expression>();
  const visit = (e: Expression): boolean => {
    if (!isFunction(e) || seen.has(e)) return false;
    seen.add(e);
    if (
      e.operatorDefinition?.broadcastable === true &&
      e.ops.some((op) => isSymbol(op) && op.symbol === name)
    )
      return true;
    return e.ops.some(visit);
  };
  return visit(body);
}

/**
 * True when `t` is the type `expression`, or a transparent alias of it
 * (`type alias A = expression`). A nominal type is not unfolded, and is not
 * read as `expression`.
 */
function isExpressionParameterType(t: Type): boolean {
  return resolveTypeAlias(t) === 'expression';
}

/**
 * True when a value of the static type `t` can be a collection: a
 * collection type, a union with a collection arm, or one of the wide types
 * `any`, `expression`, `value` and `unknown`, which can hold one. A string
 * is not read as a collection.
 */
function typeMayBeCollection(t: Type): boolean {
  const r = resolveTypeAlias(t);
  if (r === 'any' || r === 'expression' || r === 'value' || r === 'unknown')
    return true;
  if (r === 'never' || r === 'error' || r === 'nothing') return false;
  if (isSubtype(r, 'string')) return false;
  return factsOf(r).collection !== false;
}

/**
 * True when the name `name` is free in `body`: the reading of
 * `freeSymbolNames(body).has(name)`, where a nested `Function` literal that
 * binds `name` hides it. The answer for each distinct subtree is kept, so a
 * body that shares subtrees (a DAG, `e_k = e_(k-1) + e_(k-1)`) is read in
 * time linear in its number of distinct nodes, where `freeSymbolNames`
 * walks every path.
 */
function bodyReadsName(body: Expression, name: string): boolean {
  const memo = new Map<Expression, boolean>();
  const visit = (e: Expression): boolean => {
    if (isSymbol(e)) return e.symbol === name;
    if (!isFunction(e)) return false;
    const known = memo.get(e);
    if (known !== undefined) return known;
    let result: boolean;
    if (e.operator === 'Function')
      result =
        !boundVariableNames(e).includes(name) &&
        e.ops[0] !== undefined &&
        visit(e.ops[0]);
    else result = e.ops.some(visit);
    memo.set(e, result);
    return result;
  };
  return visit(body);
}

/**
 * The 0-based position of the first parameter of the `Function` literal
 * `literal` that is DECLARED `expression` (or with an alias of it) and that
 * the body reads, or `-1` when there is none. `declaredType(i)` gives the
 * type of parameter `i` when the literal has no annotation for it (the
 * signature that a host declared for a named function).
 *
 * The interpreter binds a collection argument whole to such a parameter
 * (`isScalarType` refuses the wide types), and the body then maps over it:
 * `((t: expression) ↦ 2t)([[1, 2], [3, 4]])` is `[[2, 4], [6, 8]]`.
 * Compiled code reads a parameter declared `expression` as a scalar, and
 * emits `2 * t`, which gives `NaN` or `null` for an array. A parameter
 * declared `any` or `value` does not have this problem: compiled code tests
 * it at run time (`Array.isArray(t) ? … : 2 * t`).
 */
export function expressionParameterReadAt(
  literal: Expression,
  declaredType?: (i: number) => Type | undefined
): number {
  if (!isFunction(literal, 'Function')) return -1;
  const params = literal.ops.slice(1);
  for (const [i, param] of params.entries()) {
    const declared = functionLiteralParameterType(param) ?? declaredType?.(i);
    if (declared === undefined || !isExpressionParameterType(declared))
      continue;
    const name = functionLiteralParameterName(param);
    if (name && bodyReadsName(literal.ops[0], name)) return i;
  }
  return -1;
}

/**
 * The 0-based position of the first argument of a call of the `Function`
 * literal `literal` that can be a collection (`typeMayBeCollection`) and
 * that reaches a parameter declared `expression` which the body reads
 * (`expressionParameterReadAt`), or `-1` when there is none.
 *
 * Compiled code cannot follow the interpreter for such a call, so the
 * caller declines it (`expressionParameterDecline`). A scalar argument at
 * such a parameter (`5`, or a symbol declared `real`) is not counted, and
 * the call compiles. This is the simple, sound reading: a run-time test of
 * the argument, as compiled code emits for a parameter declared `any` or
 * `value`, would compile more of these calls.
 *
 * `argTypes[i]` is the static type of argument `i`. The caller reads the
 * types before a constant fold of the arguments, which can narrow them.
 * An argument with no provable type (`undefined`, for example the element
 * of a source whose element type is not known) is counted as a possible
 * collection.
 */
export function collectionAtExpressionParameter(
  literal: Expression,
  argTypes: ReadonlyArray<Type | undefined>,
  declaredType?: (i: number) => Type | undefined
): number {
  if (!isFunction(literal, 'Function')) return -1;
  const params = literal.ops.slice(1);
  for (const [i, t] of argTypes.entries()) {
    const param = params[i];
    if (param === undefined) break;
    const declared = functionLiteralParameterType(param) ?? declaredType?.(i);
    if (declared === undefined || !isExpressionParameterType(declared))
      continue;
    const name = functionLiteralParameterName(param);
    if (!name || !bodyReadsName(literal.ops[0], name)) continue;
    if (t === undefined || typeMayBeCollection(t)) return i;
  }
  return -1;
}

/**
 * The error of a call that `collectionAtExpressionParameter` refuses, or of
 * a function that `expressionParameterReadAt` refuses when it is compiled
 * as a function value (its arguments are not known at compile time).
 * `callee` names the function or the consumer in the message; `position`
 * is the 0-based position of the parameter. `argumentType` is the type of
 * the argument at that position, `null` when the type is not provable, and
 * `undefined` for a function value.
 */
export function expressionParameterDecline(
  callee: string,
  position: number,
  argumentType?: Type | null
): Error {
  const what =
    argumentType === undefined
      ? `parameter ${position + 1} is declared \`expression\`, and an ` +
        `argument of the compiled function can be a collection`
      : argumentType === null
        ? `the type of argument ${position + 1} is not provable, so it ` +
          `can be a collection, and its parameter is declared \`expression\``
        : `argument ${position + 1} has the type ` +
          `\`${typeToString(argumentType)}\`, which can be a ` +
          `collection, and its parameter is declared \`expression\``;
  return new Error(
    `Could not compile ${callee}: ${what}. The interpreter binds a ` +
      `collection whole to such a parameter, and the body maps over it. ` +
      `Compiled code reads a parameter declared \`expression\` as a ` +
      `scalar. Declare the parameter \`any\` or \`value\` (compiled code ` +
      `then tests the argument at run time), or with a collection type.`
  );
}

/**
 * True when the symbol `id` has a value definition that the host DECLARED
 * with the type `expression` (or with a transparent alias of it). A type
 * that the engine inferred is not counted.
 *
 * The interpreter accepts a collection as the value of such a symbol, and
 * an element-wise operator maps over it: with `x` declared `expression` and
 * `x = [1, 2]`, `2x` is `[2, 4]`. Compiled code reads such a symbol as a
 * scalar: `2x` compiled to `2 * _.x`, which gives `null` for `[1, 2]`. The
 * JavaScript target declines a read of such a symbol as an input
 * (`expressionInputDecline`), as it declines a parameter declared
 * `expression` (`expressionParameterReadAt`).
 */
export function isExpressionDeclaredInput(
  engine: ComputeEngine,
  id: string
): boolean {
  const def = engine.lookupDefinition(id);
  if (!isValueDef(def)) return false;
  const value = def.value;
  return (
    value.inferredType !== true && isExpressionParameterType(value.type.type)
  );
}

/** The error of a read of the input `id` that `isExpressionDeclaredInput`
 * refuses. */
export function expressionInputDecline(id: string): Error {
  return new Error(
    `Could not compile a read of "${id}": it is declared \`expression\`, ` +
      `and its value can be a collection. The interpreter maps an ` +
      `element-wise operator over a collection value, and compiled code ` +
      `reads a symbol declared \`expression\` as a scalar. Declare it ` +
      `\`any\` or \`value\` (compiled code then tests the value at run ` +
      `time), or with a scalar or a collection type.`
  );
}

export function checkDeclaredBroadcast(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  isScalarArg: (a: Expression) => boolean,
  target?: CompileTarget<Expression>
): void {
  checkDeclaredBroadcastAgainst(
    h,
    args,
    isScalarArg,
    userFunctionBroadcastPlan(engine, h),
    () => userFunctionHasBroadcastableParam(engine, h),
    () => userFunctionParamsAreScalar(engine, h),
    target === undefined ? undefined : (a) => bakedTupleValueType(a, target)
  );
}

/**
 * The type of the tuple value held by symbol `a`, when the compiled code
 * bakes that value: `a` is a symbol whose own type is not a tuple type
 * (`Q: broadcastable<tuple<number, number>>`), its held value is a tuple
 * (`Q := (1, 2)`), and it is not a live input of the compile (`vars`), so
 * `tryFoldKnownSymbol` emits the value in its place. Otherwise
 * `undefined`.
 *
 * `isTuple(a)` already reads the held value, so such an argument binds
 * whole, as one point. Its declared type is not a subtype of the point
 * type, while the value it compiles to is: the value's type is the one to
 * check against the parameter (ROADMAP CE-415).
 */
export function bakedTupleValueType(
  a: Expression,
  target: CompileTarget<Expression>
): Type | undefined {
  if (!isSymbol(a) || isTupleShapedType(a.type.type)) return undefined;
  if (target.varsKeys?.has(a.symbol) === true) return undefined;
  const value = a.value;
  if (value === undefined || isSymbol(value)) return undefined;
  return isTupleShapedType(value.type.type) ? value.type.type : undefined;
}

/**
 * The body of {@link checkDeclaredBroadcast}, over a broadcast plan the
 * caller supplies rather than one read from an engine definition.
 *
 * Shared so the ENGINE-defined and BLOCK-LOCAL call routes enforce ONE
 * implementation of the gate. They differ only in where the callee's
 * declared shape comes from — a definition versus the declared literal's own
 * signature — and a second copy of the rule is exactly how the local route
 * came to emit a direct call for `const pair = (x: broadcastable<value>) =>
 * (x, x)`, answering a tuple of arrays where the interpreter answers an
 * elementwise list of pairs.
 */
export function checkDeclaredBroadcastAgainst(
  h: string,
  args: ReadonlyArray<Expression>,
  isScalarArg: (a: Expression) => boolean,
  plan: BroadcastSlotPlan | undefined,
  hasBroadcastableParam: () => boolean,
  // Whether the callee compiles as a function of scalar parameters, each
  // `broadcastable<T>` slot whose `T` cannot hold a list read as `T`
  // (`withCellSlotsAsElements`): its calls are then emitted through the
  // static map (`_SYS.mapFn`), which maps to the cells as the
  // interpreter does for such a slot (user decision 2026-10-24, ROADMAP
  // CE-405).
  compilesAsScalarParams: () => boolean = () => false,
  // The type of the value the compiled code bakes for an argument that is
  // a tuple only by its held value (`bakedTupleValueType`), or `undefined`.
  heldTupleType: (a: Expression) => Type | undefined = () => undefined
): void {
  if (args.length === 0) return;
  const scalarParams = plan !== undefined && compilesAsScalarParams();
  const risky =
    plan !== undefined
      ? args.some((a, i) => {
          const slot = plan.at(i);
          if (!slot.mappable || isScalarArg(a)) return false;
          // An ATOMIC argument — a tuple, or a nominal-typed value (see
          // {@link isNominalAtomicArg}; same 2026-08-12 ruling) — binds
          // whole, so it is safe to emit, provided the slot's element
          // contract actually admits it. Without the second clause this
          // gate would contradict the call-site carve-out below: it would
          // decline the very applications that carve-out proves atomic.
          if (isTuple(a) || isNominalAtomicArg(a)) {
            if (slot.elements === undefined) return false;
            const held = heldTupleType(a);
            return held !== undefined
              ? !isSubtype(held, slot.elements)
              : !a.type.matches(slot.elements);
          }
          // A function that compiles with scalar parameters is called
          // through the element-wise call, which maps to the cells as the
          // declaration now does (`compilesAsScalarParams`).
          return !scalarParams;
        })
      : // An OVERLOAD set has no single plan — which arm binds is a runtime
        // question — so answer conservatively over the whole argument list.
        hasBroadcastableParam() && !args.every(isScalarArg);
  if (!risky) return;
  throw new Error(
    `Could not compile \`${h}\`: an application of a function with a declared \`broadcastable<T>\` parameter over a possibly-collection argument — the declaration maps ONE rank down and the compile targets map to the leaves. Evaluate this expression with evaluate() instead, or declare the parameter as its element type.`
  );
}

/**
 * The declared type of positional parameter `i` of user-defined function
 * `h`, from its value definition's function type or its operator
 * definition's signature (required, then optional, then variadic).
 * `undefined` when no signature is known.
 */
export function userFunctionParamType(
  engine: ComputeEngine,
  h: string,
  i: number
): Type | undefined {
  return signatureParamType(userFunctionSignature(engine, h), i);
}

/**
 * Is positional parameter `i` of the MULTI-CLAUSE function `h` complex-
 * conventioned in every clause? The call-boundary coercion condition for a
 * clause set (`userFunctionParamType` reads nothing from an intersection
 * signature).
 *
 * Deliberately unanimous: where clauses disagree at a position (one `real`,
 * one `complex`), wrapping the argument would make it fail the real
 * clause's guard — the coercion would change DISPATCH, not just the
 * convention. Such positions stay uncoerced, as before.
 */
export function multiClauseParamIsComplex(
  engine: ComputeEngine,
  h: string,
  i: number
): boolean {
  const state = multiClauseState(engine.lookupDefinition(h));
  if (state === undefined || state.clauses.length === 0) return false;
  return state.clauses.every((c) => {
    // A generic clause declines (see `userFunctionParamType`).
    if (isPolymorphicType(c.signature)) return false;
    const params = c.signature.args;
    if (params === undefined || i >= params.length) return false;
    return isNonRealNumber(params[i].type);
  });
}

/**
 * The first argument position at which a call of the multi-clause function
 * `h` with `args` is a strict-mode lane mismatch, or `-1`: the argument is
 * a complex-shaped SCALAR and some clause declares, at that position, a
 * parameter whose type is WIDE — not a non-real number type (those bodies
 * are complex-shaped and the dispatcher coerces into them) and not a
 * real-only type (whose JS guard rejects a `{re, im}` at dispatch, so the
 * value never reaches that body). A wide clause parameter accepts the
 * object at dispatch and its body was compiled real-lane: the mismatch.
 */
export function multiClauseLaneMismatchAt(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>
): number {
  const state = multiClauseState(engine.lookupDefinition(h));
  if (state === undefined || state.clauses.length === 0) return -1;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!provablyScalarOrFramedScalar(a) || !core.isComplexValued(a)) continue;
    const wide = state.clauses.some((c) => {
      if (isPolymorphicType(c.signature)) return true;
      const pt = c.signature.args?.[i]?.type;
      if (pt === undefined) return false;
      if (isNonRealNumber(pt)) return false;
      return !isSubtype(pt, 'real');
    });
    if (wide) return i;
  }
  return -1;
}

/**
 * If `h` names a user-defined function (see `userFunctionLiteral`) and the
 * target hosts a `userFunctions` registry, ensure its definition is emitted
 * once into `registry.defs` as a named local function (`const _fn_h = …`) and
 * return that local name — so both the call-site path
 * (`tryCompileUserFunction`) and the value-position path (a bare symbol used
 * as a higher-order operand, e.g. `Map(h, list)`) reference the *same* shared
 * local rather than inlining or emitting a dangling identifier.
 *
 * Returns `undefined` when `h` is not a user function or the target opts out
 * of user functions (no registry — GPU / raw direct targets, where recursion
 * therefore stays fail-closed). A re-entrant name (in `registry.compiling`)
 * is a recursive reference and compiles to a call by name.
 *
 */
/**
 * Compile a call of the user function `h` by INLINING its body at the call
 * site — the body with each parameter SUBSTITUTED by its argument — for a
 * target that could not emit `h` as a definition, or `undefined` when
 * inlining is not sound for this call and the definition's own decline
 * should stand.
 *
 * A definition is emitted once, with PARAMETER types: a shader target needs
 * a static type for every parameter, and a point-typed one
 * (`f(P) := a·P.x² + b·P.y²`, whose `P` is a `tuple`) has none. (The
 * interval target had no lowering for `PointX`/`PointY` over an opaque
 * parameter either, and took this route; it now reads the coordinate at
 * the value and emits the definition.) The CALL, however, binds `P` to a
 * concrete point `(x, y)`,
 * and the body over it — `a·x² + b·y²` once the coordinate accessors of
 * the literal point are folded — is ordinary scalar code both targets
 * compile. A chained definition (`F(x) := g(x / 3.6)`) inlines to a call
 * of its callee, which compiles by reference or inlines in turn
 * (Tycho item 216).
 *
 * The body is SUBSTITUTED, never evaluated (`apply` would run the body:
 * a `Random()` in it was folded into a compile-time constant, and an
 * assigned free symbol would be read at compile time where the emitted
 * definition reads it at run time).
 *
 * Sound only when the inlined body is what the by-reference call would
 * have computed, once:
 *  - the callee is a single-statement pure literal — an impure body would
 *    run its effect per inlined occurrence — and not generic (no ground
 *    types to substitute into);
 *  - the callee is not recursive: a direct self-call in the body, a callee
 *    whose definition is on the in-flight compile stack (mutual recursion
 *    by reference), or one already being inlined higher up (mutual
 *    recursion through inlining) — an inlining would not terminate;
 *  - every argument is provably a scalar or a literal point: a collection
 *    argument is mapped over by the by-reference call (`_SYS.mapFn`) but
 *    would be substituted whole into the body;
 *  - every argument is pure: the by-reference call evaluates an argument
 *    ONCE, while substitution repeats it at every occurrence of its
 *    parameter — `(Random(), y)` into a body reading `P.x` twice would
 *    draw twice;
 *  - no binder in the body binds a parameter or a symbol of an argument.
 *    `subs` replaces only the free occurrences of a parameter, and it
 *    renames an inner `Sum`/`Function`/`Block` binder that would capture
 *    a symbol of an argument, except in the cases that
 *    `subsIfCaptureFree()` (`boxed-expression/subs-capture-mode.ts`)
 *    lists. This condition is stricter: it declines such a body also when
 *    `subs` gives the correct one. This is the condition `betaReduceLambda`
 *    (`boxed-expression/utils.ts`) applies to a lambda application, and only
 *    that condition: a body that merely CONTAINS a binder colliding with
 *    nothing — `Map(p ↦ …, list)` as the whole body — inlines.
 *
 * The substituted body runs through `unrollFixedWidthCollections`
 * (`fixed-width-unroll.ts`) before it is compiled. That is what turns the
 * body's `P.x`/`P.y` over a literal point into the coordinate itself, and a
 * fixed-width collection the body builds into straight-line scalar code —
 * the shapes a target with no `PointX` or collection lowering (interval
 * arithmetic, the shader targets) can compile.
 *
 * A `Typed` parameter's annotation is not re-validated at the inline call
 * site. Before any call of this function, the caller
 * (`tryCompileUserFunction()`) compares the static type of each argument
 * with the type that the literal declares for its parameter
 * (`appliedArgumentTypeMismatch()`, in a strict engine), and declines a
 * call where they cannot match. A mismatch that depends on the value at
 * run time is not checked: the compilation contract leaves that case
 * unspecified. `hr((i·x, x))` with `hr = (p: tuple<real, real>) ↦ p[1] +
 * p[2]` gives `2 + 2i` at `x = 2` where the interpreter gives an
 * `incompatible-type` error, because the static type of `i·x` is
 * `number`, which can match `real`. The by-reference definition enforces
 * nothing further at run time either.
 */
export function tryInlineUserFunctionCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** Also admit these arguments, besides the scalars and single points
   * that `substitutedUserFunctionBody` admits. */
  admits?: (a: Expression) => boolean
): TargetSource | undefined {
  const inlined = inlinedUserFunctionCall(engine, h, args, target, admits);
  if (inlined === undefined) return undefined;
  // The body is written at this call site, with no common-subexpression
  // pass of its own (`CompileTarget.checkDefinitionBody`). Asked here,
  // where the body is compiled, and not in `inlinedUserFunctionCall`,
  // which also answers questions about calls that are not compiled.
  target.checkDefinitionBody?.(inlined, target, false);
  // The generated code bakes this definition, as an emitted one would.
  target.symbolDeps?.add(h);
  const inlining = (target.userFunctions!.inlining ??= new Set<string>());
  inlining.add(h);
  try {
    return core.compile(inlined, target);
  } finally {
    inlining.delete(h);
  }
}

/**
 * The expression that `tryInlineUserFunctionCall` compiles for the call
 * `h(args)`, or `undefined` when the call cannot be inlined. Nothing is
 * compiled here. Also used to read the lane of an inlined call
 * (`userCallDefinition`) before the call is compiled.
 */
export function inlinedUserFunctionCall(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  admits?: (a: Expression) => boolean
): Expression | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;
  if (registry.compiling.has(userFunctionName(registry, h))) return undefined;
  if (registry.inlining?.has(h)) return undefined;
  // The call may sit inside an emitted DEFINITION or a lambda, whose bound
  // names — the definition's parameters, the lambda's — are the target's
  // `boundVars` while their body is compiled. A free symbol of the callee's
  // body that collides with one of them would be read as that binding once
  // the body lands here: with a global `k := 10`, `r(P) := k·P` and
  // `f(k, t) := r((t, t))`, the substituted `k·(t, t)` inside `_fn_f` would
  // read the parameter `k`. The bound names are handed to the substitution
  // as the enclosing local names, which is the same capture test the
  // definition route runs (`inlineCollectionValuedCallsInDefinitionBody`).
  // No scalar-name evidence is added: the argument test here is the static
  // one alone.
  const bound = target.boundVars;
  const enclosing: EnclosingDefinition | undefined =
    bound !== undefined && bound.size > 0
      ? { scalarNames: NO_NAMES, localNames: bound }
      : undefined;
  const substituted = substitutedUserFunctionBody(
    engine,
    h,
    args,
    target,
    enclosing,
    admits
  );
  if (substituted === undefined) return undefined;
  const inlined = unrollFixedWidthCollections(
    inlineCollectionValuedCalls(
      engine,
      substituted,
      target,
      new Set([h]),
      { left: MAX_NESTED_INLINES },
      enclosing
    ),
    {
      // The accessor reads a point SUBSTITUTED for a parameter, in a body
      // the target could not emit as a definition; folding it to the
      // coordinate is what makes the body ordinary scalar code.
      foldSingleLiteralPoint: true,
      // The entry hooks never see this body — it comes from the engine
      // definition — so the heads the caller overrode are read from the
      // target (`CompileTarget.unrollSkipHeads`).
      skipHeads: target.unrollSkipHeads,
      overridesHead: target.overridesHead,
      iterationBudget: target.iterationBudget,
      readsLiveSource: target.cse?.harvestOptions?.isStringVar,
      minWidth: target.unrollMinWidth,
      unrollConstantLists: target.unrollConstantLists,
      typedPointLists: target.unrollTypedPointLists,
      unrollComprehensions: target.unrollComprehensions,
    }
  );
  if (!inlined.isValid) return undefined;
  return inlined;
}

/**
 * `expr` with every nested user-function call whose VALUE is not provably a
 * scalar replaced by the callee's substituted body.
 *
 * A call is opaque to the shape-reading lowerings: `PointX(V(x, y))` asks
 * what kind of point `V(x, y)` is and gets a list of points, which the
 * shader and interval targets have no lowering for, and the fixed-width
 * unroll cannot see the list's width through the call either. Substituting
 * the callee's body exposes both. Only a call that is NOT provably a scalar
 * is substituted: a scalar-valued helper compiles by reference on every
 * target, and inlining it would copy a shared definition for nothing.
 *
 * `onPath` holds the names being inlined above this point, so a mutually
 * recursive pair stops rather than expanding forever; `budget` caps the
 * total substitutions (see {@link MAX_NESTED_INLINES}). A subtree that BINDS
 * a name is descended with those names added to the names that the
 * enclosing definition binds, and is rebuilt with its own scope; a
 * `Function` literal, or a binder whose scope cannot be reused, is left
 * untouched, because rebuilding it would re-canonicalize its scope.
 *
 * `enclosing` describes the definition whose body is being rewritten, on the
 * definition-emission route. Its `scalarNames` reach
 * {@link substitutedUserFunctionBody} as extra evidence that an argument is
 * a run-time scalar. Its `localNames` are the names that definition BINDS,
 * and they shadow the engine: a call of one of them is a call of the bound
 * value, which no engine-level definition describes, so it is left as a
 * call here. The other half of the shadowing — a callee body whose own free
 * symbols one of those names would CAPTURE — is declined inside
 * {@link substitutedUserFunctionBody}, which still has the body before the
 * substitution and can therefore tell a captured symbol from a substituted
 * argument.
 */
/**
 * The ROOT-entry form of {@link inlineCollectionValuedCalls}: `expr` with
 * every user-function call of a callee whose BODY type matches `bodyType`
 * replaced by the callee's substituted body, under one inlining budget and
 * no enclosing definition. For a target with no list lowering at all (the
 * interval target, `bodyType` the collection top), this is what lets the
 * fixed-width unroll see the width of a list a helper returns — `F(x, y)[1]`
 * becomes an index into a written-out list — where the call by reference
 * would decline. The shader targets ask for LIST bodies only (`list<any>`):
 * a shader function cannot return a run-time list, while a point-valued
 * helper has its own shared `vecN` definition there. The JavaScript target
 * does not use this form: its retained helpers carry a static-width
 * analysis of their own (`docs/CALL-SHAPE-SPECIALIZATION.md`). The target
 * must carry its user-function registry.
 */
export function inlineCollectionValuedCallsAtRoot(
  expr: Expression,
  target: CompileTarget<Expression>,
  bodyType: string = 'collection<any>'
): Expression {
  return inlineCollectionValuedCalls(
    expr.engine as unknown as ComputeEngine,
    expr,
    target,
    new Set<string>(),
    { left: MAX_NESTED_INLINES },
    undefined,
    bodyType
  );
}

/**
 * Whether `expr` is an untyped free input of the compiled code: a symbol
 * that is not a parameter or a local of the emitted body (`boundVars`),
 * not a caller mapping (`varsKeys`), not a block local, not a constant,
 * that holds no value, and whose type the engine inferred from its uses
 * (`inferredType`: it has no declaration). The compiled function receives
 * its value from the host at each call.
 */
export function isUntypedFreeInput(
  expr: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isSymbol(expr) || expr.isConstant) return false;
  if (
    target.boundVars?.has(expr.symbol) ||
    target.varsKeys?.has(expr.symbol) ||
    isTopTypedLocalSymbol(expr)
  )
    return false;
  if (expr.engine._getSymbolValue(expr.symbol) !== undefined) return false;
  const current = expr.engine.lookupDefinition(expr.symbol);
  const definition = isValueDef(current) ? current.value : expr.valueDefinition;
  return definition?.inferredType === true;
}

/**
 * The type of `expr` with each untyped free input read as a number, which
 * is how the emitted JavaScript reads such an input. A free input with no
 * declaration and no use that narrows it is typed `unknown` by the engine,
 * and the emitted code binds it to the bare run-time value (`_.x`, or
 * `_SYS.cplx(_.x)` on the complex lane) inside scalar code: `x + 1` is
 * `_.x + 1`. The engine's type of an expression over such an input is
 * wider than the value the code reads: a call `g(x)` of a user function
 * is typed from the signature of `g`, `list<unknown>` for
 * `g := t ↦ [t, 2]`, so `g(x)[1]` is `unknown` and `Trace(m(x))` is
 * `number | tensor`, and the scalar-arithmetic guard refused them as
 * possibly list-valued where the emitted code reads one number.
 *
 * This reading types the input `number` and rederives each application
 * whose operands changed, bottom-up, with the engine's own derivation
 * (`deriveApplicationType`), as the engine types the same expression when
 * `x` is declared `number`: `g(x)` is the body at a number, `vector<2>`,
 * `g(x)[1]` is `number`, and `Trace(m(x))` is `number`. An application
 * whose operands keep their types keeps its own type, and so does one
 * whose rederived type does not fit its own. The operands of a scoped
 * operator (a `Sum` over an index) are not rederived. A scalar parameter
 * of the scalar variant (`isScalarParam()`) is read as a number too.
 * Only the TYPE is read here; the scalar code around the call is the lane
 * every free input already takes. `memo`
 * holds the answers of one top-level call, so a shared subexpression is
 * walked once. The shader targets read a free input as a float for the
 * same reason, and `gpuAtBaseShape` (`gpu-at.ts`) reads the static
 * length of a call's result through this type. ROADMAP CE-377 (landed
 * 2026-10-23).
 */
export function typeWithFreeInputsAsNumbers(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0,
  memo: Map<Expression, Type> = new Map()
): Type {
  const own = expr.type.type;
  if (depth > 32) return own;
  if (isSymbol(expr)) {
    if (own !== 'unknown') return own;
    return isUntypedFreeInput(expr, target) ||
      isScalarParam(expr.symbol, target.boundVars)
      ? 'number'
      : own;
  }
  if (!isFunction(expr) || expr.operatorDefinition?.scoped) return own;
  const known = memo.get(expr);
  if (known !== undefined) return known;
  const types = expr.ops.map((op) =>
    typeWithFreeInputsAsNumbers(op, target, depth + 1, memo)
  );
  let result = own;
  if (!types.every((t, i) => t === expr.ops[i].type.type)) {
    const operands = expr.ops.map((op, i) =>
      types[i] === op.type.type
        ? describeOperand(op)
        : describeOperand(op, types[i])
    );
    const inferred = deriveApplicationType(
      expr.engine,
      expr.operator,
      operands
    );
    if (
      inferred !== undefined &&
      inferred !== 'never' &&
      isSubtype(inferred, own)
    )
      result = inferred;
  }
  memo.set(expr, result);
  return result;
}

/**
 * Whether the emitted code reads `a` as one scalar although its own type
 * admits a collection: its type with each untyped free input read as a
 * number (`typeWithFreeInputsAsNumbers`) is a scalar type, a number, a
 * boolean or a string, beside an absence marker at most. `g(x)[1]` with
 * `g := t ↦ [t, 2]` and `x` free is typed `unknown` by the engine and
 * `number` under that reading. An operand whose type the reading leaves
 * unchanged is not read as a scalar here: the predicates on its own type
 * decide.
 */
export function readsAsScalarThroughFreeInputs(
  a: Expression,
  target: CompileTarget<Expression>
): boolean {
  const t = typeWithFreeInputsAsNumbers(a, target);
  if (t === a.type.type) return false;
  const r = resolveTypeForCompilation(stripMissingFromType(t));
  if (r === 'never') return false;
  return (
    isSubtype(r, 'number') || isSubtype(r, 'boolean') || isSubtype(r, 'string')
  );
}

/** A shader's framed scalar locals have a concrete representation even
 * when their stored expression types still admit a collection. Derive
 * enclosing applications from those local facts for operator handlers. */
export function operandTypeInContext(
  expr: Expression,
  target: CompileTarget<Expression>,
  depth = 0
): Type {
  if (depth > 32 || (target.language !== 'glsl' && target.language !== 'wgsl'))
    return expr.type.type;
  if (isSymbol(expr)) {
    const frame = localShapeFrameOf(expr.symbol)?.get(expr.symbol);
    if (frame === LOCAL_SCALAR) return 'number';
    if (frame === LOCAL_BOOLEAN) return 'boolean';
    if (frame !== undefined && frame > 0)
      return {
        kind: 'tuple',
        elements: Array.from({ length: frame }, () => ({ type: 'number' })),
      };
    return expr.type.type === 'unknown' ? 'number' : expr.type.type;
  }
  if (!isFunction(expr) || expr.operatorDefinition?.scoped)
    return expr.type.type;
  const types = expr.ops.map((x) => operandTypeInContext(x, target, depth + 1));
  if (types.every((t, i) => t === expr.ops[i].type.type)) return expr.type.type;
  const operands = types.map((t) => describeType(t));
  const inferred = deriveApplicationType(expr.engine, expr.operator, operands);
  return inferred !== undefined &&
    inferred !== 'never' &&
    isSubtype(inferred, expr.type.type)
    ? inferred
    : expr.type.type;
}

/**
 * Whether `expr`'s type is a union whose every arm is a tuple — a value
 * that is a point whichever arm it takes. A single tuple type is `isTuple`'s
 * business; a union with a non-tuple arm is not a point.
 */
export function isUnionOfPoints(expr: Expression): boolean {
  const t = compilationType(expr);
  if (typeof t === 'string' || t.kind !== 'union') return false;
  return t.types.every((arm) => isTupleShapedType(arm));
}

/**
 * When `type` is a union that admits a single point (a `tuple` option) and
 * an ordered collection of points (`list<tuple<number, number>> |
 * tuple<number, number>`), the arity of the point options when they all
 * have the same arity, in `arity`. `undefined` for any other type.
 *
 * A shader has no value that can be either one: a point is a `vec2`,
 * `vec3` or `vec4`, and a list of points is an array.
 */
export function pointOrPointListUnion(
  type: Type
): { arity: number | undefined } | undefined {
  const t = resolveTypeAlias(type);
  if (typeof t === 'string' || t.kind !== 'union') return undefined;
  const arities = new Set<number>();
  let pointList = false;
  for (const branch of t.types) {
    const arm = resolveTypeAlias(branch);
    if (typeof arm === 'string') continue;
    if (arm.kind === 'tuple') arities.add(arm.elements.length);
    else if (isSubtype(arm, 'indexed_collection<any>')) {
      const element = collectionElementType(arm);
      if (element !== undefined && isPointElementType(element))
        pointList = true;
    }
  }
  if (arities.size === 0 || !pointList) return undefined;
  return { arity: arities.size === 1 ? [...arities][0] : undefined };
}

/**
 * Whether a parameter declared `declared` accepts a `width`-component
 * point one of whose coordinates is a list (or any other non-scalar).
 *
 * Decided structurally, alternative by alternative, and conservatively:
 * a tuple alternative of this width admits one when any of its element
 * types is not provably a scalar (`unknown`, `broadcastable<number>`,
 * `list<integer>`, a union); a list, set or collection alternative admits
 * one when its element type can hold a list — a written point can be a
 * member of `list<list<number> | number>`, but not of
 * `list<tuple<number, number>>`, whose members are points with scalar
 * coordinates; a scalar alternative and a tuple of another width cannot
 * hold such a point at all; every other shape (`unknown`, `any`, `value`,
 * a nominal reference, an intersection) is taken to admit it. Probing
 * with example types instead — "is
 * `tuple<list<number>, number>` a subtype?" — missed a declaration that
 * admits two list coordinates, or a narrower element type such as
 * `list<integer>`, and let the caller erase broadcasting for them.
 *
 * A declaration that admits none rejects such an argument at the
 * interpreter's parameter check, so a compiled call may treat a written
 * point's coordinates as scalars.
 */
export function declaredPointAdmitsListCoordinate(
  declared: Type,
  width: number
): boolean {
  const isScalar = (t: Type) => isSubtype(t, 'scalar');
  // A type none of whose values is a list: a scalar, a tuple of such
  // types, or a union of them. Anything else is taken to hold a list.
  const cannotHoldAList = (raw: Type): boolean => {
    const t = resolveTypeForCompilation(raw);
    if (typeof t === 'string') return isScalar(t);
    if (t.kind === 'tuple')
      return t.elements.every((e) => cannotHoldAList(e.type));
    if (t.kind === 'union') return t.types.every(cannotHoldAList);
    return false;
  };
  const resolved = resolveTypeForCompilation(declared);
  const alternatives =
    typeof resolved !== 'string' && resolved.kind === 'union'
      ? resolved.types
      : [resolved];
  for (const raw of alternatives) {
    const alt = resolveTypeForCompilation(raw);
    if (typeof alt === 'string') {
      if (isScalar(alt)) continue;
      return true;
    }
    switch (alt.kind) {
      case 'tuple':
        if (alt.elements.length !== width) continue;
        // Element types are resolved so a nominal type over a scalar
        // (`type Meters = number`) is read as the scalar it wraps.
        if (
          alt.elements.some((e) => !isScalar(resolveTypeForCompilation(e.type)))
        )
          return true;
        continue;
      case 'list':
      case 'set':
      case 'collection':
      case 'indexed_collection':
        if (cannotHoldAList(alt.elements)) continue;
        return true;
      case 'union':
        if (declaredPointAdmitsListCoordinate(alt, width)) return true;
        continue;
      default:
        return true;
    }
  }
  return false;
}

/**
 * Does the declaration of user function `h` leave the element type of
 * parameter `i` open? It does when `h` has no declared signature (a bare
 * `function` declaration, or a function assigned without a declaration,
 * whose parameter types are inferred from the body), or when the declared
 * parameter is `unknown` or a collection whose element type is not stated
 * (`collection`, `list`, `indexed_collection<unknown>`).
 *
 * A parameter declared with an element type (`list<number>`,
 * `collection<number>`) is the host's contract: the definition is compiled
 * once against it, whatever list type a call site passes, so that a ground
 * declaration and a generic one bounded by the same type compile alike.
 */
export function paramElementTypeIsOpen(
  engine: ComputeEngine,
  h: string,
  i: number
): boolean {
  const def = engine.lookupDefinition(h);
  if (def !== undefined && isOperatorDef(def) && def.operator.inferredSignature)
    return true;
  const declared = userFunctionParamType(engine, h, i);
  if (
    declared === undefined ||
    declared === 'unknown' ||
    declared === 'any' ||
    declared === 'value'
  )
    return true;
  const resolved = resolveTypeForCompilation(declared);
  // A union with a collection arm (`collection<any> | number`, the slot of
  // a parameter the body consumes whole) is open when that arm is: the
  // generic definition compiles the body against the scalar arm, so a
  // list argument needs the helper specialized to its own list type
  // (`mean(xs^2)` over an array read `xs * xs` as scalar arithmetic and
  // answered `NaN`).
  const members =
    typeof resolved !== 'string' && resolved.kind === 'union'
      ? resolved.types
      : [resolved];
  return members.some((m) => {
    if (!isSubtype(m, 'collection<any>')) return false;
    const element = collectionElementType(m);
    return element === undefined || element === 'unknown' || element === 'any';
  });
}

/**
 * Throw when the emitted code of an invariant-prefix variant of `h` does
 * not read one of its extra parameters `extraParams`. The body compile
 * emits a parameter's name where a node carries its code override, but a
 * target handler that takes such a node apart compiles its parts instead,
 * and then the body computes the prefix again while the call site
 * computes it once more to pass it. The check before the body compile
 * finds each prefix in the expression tree; this one reads the emitted
 * text. The throw declines the variant, and the call site takes the
 * ordinary call. The names are temporaries of the compilation, so a
 * whole-word match cannot hit anything else.
 *
 * `inSignature` is the number of times `code` names each parameter
 * outside the body: 0 for a body alone (the arrow form), 1 for a complete
 * definition from a target lowering, whose `define` writes every extra
 * parameter into the declaration (the GPU targets do). A parameter is
 * read when it occurs more often than that.
 */
export function assertExtraParamsRead(
  h: string,
  code: TargetSource,
  extraParams: ReadonlyArray<string>,
  inSignature: 0 | 1
): void {
  const unread = extraParams.find(
    (p) =>
      (code.match(new RegExp(`(?<![\\w$])${p}(?![\\w$])`, 'g'))?.length ?? 0) <=
      inSignature
  );
  if (unread !== undefined)
    throw new Error(
      `Could not compile \`${h}\`: the emitted body does not read the ` +
        `invariant-prefix parameter \`${unread}\`, so no variant is emitted`
    );
}

/**
 * Emit the INVARIANT-PREFIX VARIANT of user function `h` that takes the
 * prefixes at `prefixIndices` (indices into `invariantPrefixes`) as extra
 * parameters after the ordinary ones, once per distinct index set, and
 * return its local name. The ordinary definition of `h` is untouched: a
 * call that hoists nothing still calls it.
 */
export function ensureUserFunctionVariantEmitted(
  engine: ComputeEngine,
  h: string,
  prefixIndices: ReadonlyArray<number>,
  target: CompileTarget<Expression>,
  /** The base definition, when it is not the definition named for `h`:
   * a range specialization, with its key and its emitted name. */
  specialization?: { key: string; name: string }
): string | undefined {
  const registry = target.userFunctions;
  if (!registry) return undefined;
  // The literal the BASE definition was emitted from, when it has been —
  // the call-shape specialization may have rebuilt it with the parameter
  // types the call proved (`registry.literals`) — else the engine's own.
  const baseName = specialization?.name ?? userFunctionName(registry, h);
  const base = registry.literals?.get(baseName);
  const literal =
    base !== undefined && isFunction(base, 'Function')
      ? (base as Expression & FunctionInterface)
      : userFunctionLiteral(engine, h);
  if (literal === undefined) return undefined;
  const all = invariantPrefixes(engine, h, target);
  const prefixes = prefixIndices.map((i) => all[i]);
  if (prefixes.some((p) => p === undefined)) return undefined;
  target.symbolDeps?.add(h);
  const variant = core.emitFunctionLiteralDefinition(
    h,
    literal,
    target,
    registry,
    undefined,
    {
      key: `${specialization?.key ?? h}$inv${prefixIndices.join('_')}`,
      prefixes,
    }
  );
  if (variant !== undefined)
    (registry.variantBases ??= new Map()).set(variant, baseName);
  return variant;
}

/**
 * For each argument of a call, whether it is a LIST INPUT of the compiled
 * expression: a symbol of a list type that names a value and that no
 * enclosing form binds (not a parameter, a block local or an index). Only
 * such a symbol is visible to a module-level shader function. The test reads
 * every record of the bindings of the caller (`CompileTarget.boundVars`,
 * the local shape frames, `CompilerState._boundVarsCtx` and the binder
 * shield of an analysis), so it must run before a route hides them
 * (`withCallerBindingsHidden`).
 */
export function boundListArguments(
  engine: ComputeEngine,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): boolean[] {
  return args.map(
    (a) =>
      isSymbol(a) &&
      target.boundVars?.has(a.symbol) !== true &&
      localShapeFrameOf(a.symbol)?.has(a.symbol) !== true &&
      CompilerState._boundVarsCtx?.has(a.symbol) !== true &&
      !CompilerState._binderShield.some((f) => f.has(a.symbol)) &&
      isValueDef(engine.lookupDefinition(a.symbol)) &&
      isSubtype(a.type.type, 'list<any>')
  );
}

/**
 * On a target with its own definition lowering (the shader targets), emit
 * the BOUND-LIST VARIANT of the user function `h` for the call `h(args)`,
 * and return its local name with the arguments that the variant still
 * takes. `undefined` when the call has no argument to bind, or when the
 * variant cannot be emitted.
 *
 * A shader function cannot take a list parameter: GLSL and WGSL have no
 * array type of an unknown length, a sampler parameter has no index helper
 * of the width of the argument, and WGSL cannot pass a storage buffer to a
 * function. So `define` declines `g(H: list<integer>, x: real)`. The
 * variant has no parameter for such a list: its body reads the argument
 * itself, which is an input of the compiled expression. With the input `H`
 * in a texture, `g(H, x)` compiles to `_fn_g_bind0_H(x)`, and the body reads
 * `_gpu_texat90001(H, k)` where the definition of `g` reads `H[k]`. The
 * interpreter binds the value of the argument to the parameter, so the body
 * computes the same value. One variant is emitted for each function and
 * each set of bound arguments, and every call with the same set shares it.
 *
 * An argument is bound when it is a symbol of a list type that no enclosing
 * form binds (not a parameter, a block local or an index): only an input of
 * the expression is visible to a module-level function. The variant is not
 * emitted when the body binds the name of an argument or of a bound
 * parameter itself, or when another parameter has the name of an argument,
 * because the substituted body would then read a different value.
 */
export function ensureBoundListVariantEmitted(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  /** Which arguments are list inputs (`boundListArguments`), when the
   * caller read it before it hid its own bindings. */
  inputs: ReadonlyArray<boolean> = boundListArguments(engine, args, target)
): { name: string; args: Expression[] } | undefined {
  const registry = target.userFunctions;
  if (registry?.lowering === undefined) return undefined;
  const literal = userFunctionLiteral(engine, h);
  if (literal === undefined || userFunctionIsGeneric(engine, h, literal))
    return undefined;
  const params = literal.ops.slice(1);
  if (params.length !== args.length) return undefined;
  const names = params.map((p) =>
    isSymbol(p) || isFunction(p, 'Typed')
      ? functionLiteralParameterName(p)
      : undefined
  );
  if (names.some((n) => n === undefined)) return undefined;
  const bound = args.map((_, i) => inputs[i] === true);
  if (!bound.includes(true)) return undefined;
  const body = literal.ops[0];
  // The names that the body binds. The scope of the top `Block` of a body
  // also holds the parameters, so that block is read by its statements: its
  // own locals are the names of its `Declare` statements.
  const binders = new Set<string>();
  if (isFunction(body, 'Block'))
    for (const statement of body.ops) {
      if (isFunction(statement, 'Declare') && isSymbol(statement.op1))
        binders.add(statement.op1.symbol);
      collectBinderNames(statement, binders);
    }
  else collectBinderNames(body, binders);
  const kept = new Set(names.filter((_, i) => !bound[i]) as string[]);
  const substitution: Record<string, Expression> = {};
  // The key of the variant names each bound position and its input. The
  // name of the input is quoted, so that two sets of bound arguments never
  // give the same key: with unquoted names, `(0, X_1_Y)` and
  // `(0, X), (1, Y_2_Z)` gave the same text.
  const key: string[] = [];
  for (const [i, a] of args.entries()) {
    if (!bound[i] || !isSymbol(a)) continue;
    const name = names[i]!;
    if (binders.has(name) || binders.has(a.symbol) || kept.has(a.symbol))
      return undefined;
    substitution[name] = a;
    key.push(`${i}=${JSON.stringify(a.symbol)}`);
  }
  const variantBody = body.subs(substitution);
  if (!variantBody.isValid) return undefined;
  // The variant is boxed again from its MathJSON, so that each name binds
  // in the scope of the variant. When the argument has the name of its
  // parameter (`g(H, x)` with the parameter `H`), the substitution keeps
  // the occurrences of the body as they are, bound to the parameter, and
  // they would keep its type (`list<integer>`, with no length) instead of
  // the type of the input (`list<real^1600>`).
  const variant = engine.box([
    'Function',
    variantBody.json,
    ...params.filter((_, i) => !bound[i]).map((p) => p.json),
  ]) as Expression & FunctionInterface;
  if (!variant.isValid || !isFunction(variant, 'Function')) return undefined;
  target.symbolDeps?.add(h);
  // The positions in the declaration of `h` of the parameters that the
  // variant keeps. A type or a fact that is recorded for `h` by position is
  // read there, because the positions of the variant differ.
  const at = args.flatMap((_, i) => (bound[i] ? [] : [i]));
  const name = core.emitFunctionLiteralDefinition(
    h,
    variant,
    target,
    registry,
    {
      key: `${h}#bind${key.join(',')}`,
      types: at.map((i) => userFunctionParamType(engine, h, i) ?? 'unknown'),
      positions: { at, arity: args.length },
    }
  );
  if (name === undefined) return undefined;
  return { name, args: args.filter((_, i) => !bound[i]) };
}
