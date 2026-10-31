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
import { isConstructedScalar } from './javascript-value-facts.js';
import {
  isOperatorDef,
  isValueDef,
  freeSymbolNames,
} from '../boxed-expression/utils.js';
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
import { typeToString } from '../../common/type/serialize.js';
import { isPolymorphicType } from '../../common/type/instantiate.js';
import type { Type } from '../../common/type/types.js';
import {
  isSymbol,
  isNumber,
  isString,
  isCharacter,
  isFunction,
} from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
  isScalarType,
} from '../boxed-expression/function-literal.js';
import { multiClauseState } from '../multi-clause.js';
import { unrollFixedWidthCollections } from './fixed-width-unroll.js';
import type { CompileTarget, TargetSource } from './types.js';
import {
  provablyScalarArg,
  provablyScalarArg as provablyScalarArg__,
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
import type {
  AbsentArgumentCheck,
  EnclosingDefinition,
} from './compiler-types.js';
import {
  compilationType,
  isNominalAtomicType,
  isProvablyNumericListOperand,
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
  userFunctionName,
} from './compile-cse.js';
import { core } from './compiler-core-hooks.js';
import { userFunctionSignature } from './compile-absence.js';
import { NO_NAMES } from './compiler-tables.js';

/**
 * `provablyScalarArg`, extended to a symbol the innermost local shape frame
 * records as a SCALAR (`LOCAL_SCALAR`). A declared-complex parameter is
 * entered that way (`addDeclaredComplexParams`): its declared type says
 * complex but not "scalar" to `provablyScalarArg`, yet a complex-typed
 * parameter holds exactly one complex object, and a nested call passing it
 * on (`c(x: complex) := b(x) + 1`) must see a scalar argument.
 */
export function provablyScalarOrFramedScalar(a: Expression): boolean {
  if (provablyScalarArg(a)) return true;
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
 * Per argument of a call of the function literal `literal`, the message of
 * a run-time check that the argument is present, or `undefined` for no
 * check.
 *
 * At evaluation, an absent value (`Missing`) at a parameter annotated with
 * a type that has no `missing` member and is not numeric is an
 * `incompatible-type` error (user decision of 2026-09-30, pinned by
 * `test/compute-engine/absent-argument-annotated-parameter.test.ts`); a
 * numeric annotation reads it as `NaN`. Boxing admits an argument typed
 * `missing | T` at such a parameter, because its value is usually present,
 * so the compiled call ran the body with `undefined` (the compiled form of
 * an absent value) and answered `NaN`, threw a `TypeError` from inside the
 * body, or answered a wrong value. Compiled code has no error value, so
 * the call stops the run instead, with a `TypeError` that names the
 * parameter and its type (`_SYS.present`), as an operand of the wrong kind
 * stops it with a `RangeError` (`_SYS.arr`).
 *
 * A check is emitted only where it can fire: on the JavaScript target (the
 * only one whose run-time library has the check), for an argument whose
 * static type admits `missing`, at a parameter so annotated. When a call
 * maps over a list of points (`tryCompilePointListCall`, the point-list
 * branch of `tryCompileLocalFunctionCall`), the mapped argument is exempt:
 * the map answers `undefined` for an absent point without calling the
 * function, as the interpreter answers `Missing` for that cell; the other
 * arguments are checked inside the map, once per point, so that an empty
 * list answers the empty list without a check, as the interpreter does.
 * The JavaScript `Apply` of a function literal (`javascript-target.ts`)
 * uses this too.
 *
 * A list argument at a SCALAR parameter (`isScalarType`) is mapped: the
 * function is applied to each element, at any depth, and the interpreter
 * gives the `incompatible-type` error for an absent element. So when the
 * type of such an argument has an absent member at any depth
 * (`typeContainsMissing`), the check is made on each element of the list,
 * nested lists included (`elements: true`).
 *
 * At a NUMERIC annotation the interpreter reads an absent argument as
 * `NaN` (`makeLambda`, `function-utils.ts`), and the call site
 * does the same (`message: undefined`, `_SYS.absentNaN`). Without it, a
 * body that does not compute with the parameter (`(x: number) => x`)
 * answered `undefined` where the interpreter answers `NaN`.
 */
export function absentArgumentChecks(
  calleeName: string,
  literal: Expression | undefined,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Array<AbsentArgumentCheck | undefined> {
  if (target.language !== 'javascript') return [];
  if (literal === undefined || !isFunction(literal, 'Function')) return [];
  const params = literal.ops.slice(1);
  return args.map((a, i) => {
    const param = params[i];
    if (param === undefined) return undefined;
    const declared = functionLiteralParameterType(param);
    if (declared === undefined) return undefined;
    if (isSubtype('missing', declared)) return undefined;
    const t = a.type.type;
    const elements =
      isScalarType(declared) && !isTupleShapedType(t) && typeContainsMissing(t);
    if (!elements && !isSubtype('missing', t)) return undefined;
    if (isSubtype(declared, 'number')) return { message: undefined, elements };
    const name = functionLiteralParameterName(param) || `#${i + 1}`;
    return {
      message:
        `${calleeName}: the argument of the parameter '${name}' is absent, ` +
        `and the parameter is annotated '${typeToString(declared)}'`,
      elements,
    };
  });
}

/**
 * `code` wrapped in the run-time absent-argument check `check`
 * (`_SYS.present`, or `_SYS.absentNaN` at a numeric parameter, see
 * `absentArgumentChecks`), or `code` as it is when `check` is `undefined`.
 */
export function presentCheckedCode(
  code: string,
  check: AbsentArgumentCheck | undefined
): string {
  if (check === undefined) return code;
  if (check.message === undefined)
    return check.elements
      ? `_SYS.absentNaN(${code}, true)`
      : `_SYS.absentNaN(${code})`;
  const message = JSON.stringify(check.message);
  return check.elements
    ? `_SYS.present(${code}, ${message}, true)`
    : `_SYS.present(${code}, ${message})`;
}

/**
 * The call site of an already-emitted user function `name`: a direct scalar
 * call, the unconditional broadcast dispatch, or a runtime `Array.isArray`
 * guard that chooses between the two, per the rules below.
 *
 * Shared by the ENGINE-defined route (`tryCompileUserFunction`) and the
 * BLOCK-LOCAL route (`tryCompileLocalFunctionCall`), which differ only in
 * where they read the callee's signature from — the engine's definition
 * versus the declared literal's own type — never in how the call is spelled.
 *
 * `coerceToComplex[i]` marks an argument to wrap in the `{ re, im }`
 * convention; `paramsAreScalar` says no parameter binds a collection whole.
 * `alwaysDispatch` suppresses the provably-scalar fast path, so the runtime
 * broadcast dispatch is emitted even for arguments whose static type says
 * they cannot be collections — the callee's parameters are open type
 * variables and that static type came from their bounds, not from the
 * caller (see the call in `tryCompileUserFunction`).
 */
export function emitUserFunctionCall(
  name: string,
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>,
  coerceToComplex: ReadonlyArray<boolean>,
  paramsAreScalar: boolean,
  alwaysDispatch = false,
  /**
   * Compiled arguments appended after `args` in EVERY call form, and
   * never broadcast over: the values of an invariant-prefix variant's
   * extra parameters (`tryCompileUserFunction`). A hoisted prefix is a
   * value the callee's body reads whole — a list the body indexes must
   * reach it as that list — so it is passed the way an atomic argument
   * is, whatever its run-time shape, while the ordinary arguments keep
   * their dispatch.
   */
  held: ReadonlyArray<string> = [],
  /**
   * Per argument, the run-time check that the argument is present, or
   * `undefined` for no check (`absentArgumentChecks`).
   */
  absentChecks: ReadonlyArray<AbsentArgumentCheck | undefined> = []
): TargetSource {
  const provablyScalarArg = provablyScalarArg__;

  // On a target that spells collection values only in consuming positions
  // (`CompileTarget.compileCollectionValue`), an argument is one when the
  // callee binds it WHOLE (a collection-typed parameter: `d(a, b) :=
  // a[1]·b[1] + a[2]·b[2]` infers both parameters as collections) — and
  // when the callee's parameters are scalar but the argument is provably a
  // list of numbers, which the element-wise call below maps the callee
  // over. An argument the spelling does not cover compiles as before.
  const spellCollection = (a: Expression): TargetSource | undefined => {
    if (target.compileCollectionValue === undefined) return undefined;
    if (paramsAreScalar && !isProvablyNumericListOperand(a)) return undefined;
    return target.compileCollectionValue(a, target);
  };
  const compiledArgs = args.map((a, i) => {
    const code = spellCollection(a) ?? compileValueOperand(a, target);
    return presentCheckedCode(code, absentChecks[i]);
  });
  // The interval target's call-boundary broadcast. The interpreter maps a
  // scalar-parameter callee over a list argument (`f(x) := x²` applied to
  // `[1, 2]` answers `[1, 4]`), and the emitted callee is scalar interval
  // code, so a bare `_fn_f([…])` would read `.lo`/`.hi` off an array and
  // answer nonsense behind `success: true` (measured before this branch:
  // `{ lo: -5e-324, hi: null }`). The JavaScript target's runtime dispatch
  // (`_SYS.bcastFn`, below) does not exist on this target — its `_SYS` is
  // reserved but never emitted — so the decision is static: an argument
  // PROVABLY a list of numbers is mapped through `_IA.bcast` with every
  // other argument reused at each position, which requires those others to
  // be provably numbers; any other collection-shaped argument beside a
  // scalar parameter fails closed. An argument whose collection-ness is not
  // provable keeps the direct call, exactly as before — scalar curve and
  // implicit plotting ride this target on such arguments.
  if (
    target.language === 'interval-javascript' &&
    paramsAreScalar &&
    args.length > 0
  ) {
    const lists = args.map(isProvablyNumericListOperand);
    if (lists.some((x) => x)) {
      const offending = args.find(
        (a, i) => !lists[i] && !a.type.matches('number')
      );
      if (offending !== undefined)
        throw new Error(
          `Could not compile \`${name}\`: the call maps over a list argument, ` +
            `and the argument \`${offending.toString()}\` (type ` +
            `\`${offending.type.toString()}\`) is not provably a number to ` +
            `reuse at every position.`
        );
      const params = args.map(() => tempVar(target));
      return (
        `_IA.bcastFn((${params.join(', ')}) => ` +
        `${name}(${[...params, ...held].join(', ')}), ` +
        `${compiledArgs.join(', ')})`
      );
    }
    const collection = args.find(
      (a) => a.isCollection || a.type.matches('collection<any>')
    );
    if (collection !== undefined && !isTuple(collection))
      throw new Error(
        `Could not compile \`${name}\`: the argument ` +
          `\`${collection.toString()}\` is a collection (type ` +
          `\`${collection.type.toString()}\`) handed to a scalar parameter. ` +
          `The interpreter maps the call over it, and this target maps only ` +
          `over a provable list of numbers.`
      );
  }
  // Deliver a `{ re, im }` to a declared-complex parameter, in whichever of
  // three forms the argument's static shape already settles:
  //
  //  - provably COMPLEX: the emitted code is already an object, so it is
  //    passed through untouched — no wrap, no runtime test;
  //  - provably REAL: wrapped statically, the shape being known;
  //  - neither (an untyped free symbol bound at `run()` time — the common
  //    case): the caller may hand over a plain number OR an already-complex
  //    object and only a runtime test can tell, so `_SYS.cplx` decides. It
  //    is idempotent, so an object passes through instead of nesting.
  const complexWrap = complexWrapCode;

  // The interpreter BROADCASTS a user function over a collection argument
  // (`applyFunctionLiteral` / the step-2b lambda broadcast): `q(L)` with
  // `q: t ↦ n·t+1` and `L = [1,2,3]` answers `[5,9,13]`, not a scalar. The
  // emitted callee is SCALAR code, so a bare `_fn_q([1,2,3])` computes
  // `4*[1,2,3]+1` — the string-coerced NaN this dispatch fixes.
  //
  // Mirroring the interpreter's *runtime* dispatch (the item-34 ruling)
  // rather than a compile-time "is this operand provably a collection?"
  // gate: `_SYS.bcast` applies the scalar closure directly when no argument
  // is an array and maps it element-wise otherwise, so a declared type wider
  // than the runtime value costs nothing. Length mismatches project the
  // interpreter's `incompatible-dimensions` error to NaN, as everywhere else
  // in `bcast`.
  //
  // What is decided at compile time is only a property of the CALLEE and of
  // the argument's static shape class, both of which the interpreter also
  // reads statically:
  //   - `paramsAreScalar`: a collection-typed parameter binds its argument
  //     WHOLE (`f: (list<number>) -> number`), so it must not be mapped;
  //   - a TUPLE argument is atomic (a point/vector), excluded from broadcast
  //     by the interpreter yet lowered to a JS array here — `bcast` would
  //     map over its components. Leave those on the direct-call path;
  //   - a NOMINAL-TYPED argument is atomic for exactly the same reason
  //     (`isNominalAtomicArg`, ruled 2026-08-12 — see
  //     `docs/plans/2026-08-12-sum-type-sugar-and-compilation.md` context):
  //     D3 opacity means the interpreter binds the whole tagged value, but
  //     D11 erasure lowers `bag([1,2,3])` to the bare JS array, which
  //     `bcastFn`'s runtime `Array.isArray` dispatch would then map over —
  //     `size(bag([1,2,3]))` answering `[42,42,42]` where the interpreter
  //     answers `42`. Leave those on the direct-call path too;
  //   - every argument PROVABLY not a collection (`provablyScalarArg`, at
  //     the top of this function) takes the cheaper runtime `Array.isArray`
  //     guard below instead of this unconditional dispatch. That static
  //     reading alone chooses the form of the test. Explicit scalar input
  //     declarations and constructed scalar values can remove it.
  // The dispatch is `_SYS.bcastFn`, not `_SYS.bcast`: applying a function
  // literal to an EMPTY collection zips zero elements and answers `[]` in
  // the interpreter, where an empty operator position answers `Nothing`
  // (NaN). Everything else — mismatch → NaN, scalar reuse, nesting — is
  // shared.
  //
  // The two conditions that are NOT about the argument's shape class — the
  // JavaScript target and a scalar-parameter callee — gate every emitted
  // broadcast form. An ATOMIC argument (a tuple or a nominal value, the two
  // clauses just above) additionally bars the two forms below, which would
  // hand that argument to the broadcast as a source; where such an argument
  // has a sibling that may be a collection, the third form — the HOLDING
  // dispatch further down — broadcasts over the sibling alone.
  const atomicArg = args.map((a) => isTuple(a) || isNominalAtomicArg(a));
  const mayBroadcast =
    target.language === 'javascript' &&
    args.length > 0 &&
    !atomicArg.some((x) => x) &&
    paramsAreScalar;

  /** The scalar call, with each argument's complex coercion applied. */
  const directCall = (codes: ReadonlyArray<string>) =>
    `${name}(${[
      ...codes.map((code, i) =>
        coerceToComplex[i] ? complexWrap(code, args[i], target) : code
      ),
      ...held,
    ].join(', ')})`;

  /**
   * `_SYS.bcastFn(closure, …)` over `codes`.
   *
   * A complex-typed parameter is coerced INSIDE the closure, on the element
   * the broadcast selected: wrapping the whole argument would both hand the
   * callee `{ re: [1,2,3], im: 0 }` and (before) force the entire call onto
   * the direct scalar path, so a sibling collection argument never
   * broadcast. The wrap applies to the ELEMENT the broadcast selected, but
   * the ARGUMENT's realness still settles which wrap: a provably
   * real-valued operand — a scalar like `0`, or a collection of reals —
   * yields only real elements, so the static wrap holds and no runtime test
   * is emitted. Anything else takes `_SYS.cplx`.
   */
  const dispatchCall = (codes: ReadonlyArray<string>) => {
    // With no argument to coerce, the closure would be an ETA-EXPANSION of
    // the callee — `(a, b) => _fn_f(a, b)` — so hand `_SYS.bcastFn` the
    // function itself. The broadcast never reads the closure's `length`
    // (`bcastWith` and its generated kernels spread the cell array into
    // `f(...)`), so a named function behaves exactly as the arrow did, and
    // one closure per call site is saved. (The Tycho code-generation audit
    // of 2026-09-08 measured 297 such eta-expanded dispatches.)
    // A held argument is appended inside the closure, so the broadcast
    // never sees it as a source.
    if (!coerceToComplex.some((c) => c) && held.length === 0)
      return `_SYS.bcastFn(${name}, ${codes.join(', ')})`;
    const params = args.map(() => tempVar(target));
    const callParams = [
      ...params.map((p, i) =>
        coerceToComplex[i] ? complexWrap(p, args[i], target) : p
      ),
      ...held,
    ];
    return `_SYS.bcastFn((${params.join(', ')}) => ${name}(${callParams.join(
      ', '
    )}), ${codes.join(', ')})`;
  };

  const scalarArg = (a: Expression): boolean =>
    certainlyScalarArg(a) ||
    (target.language === 'javascript' && isConstructedScalar(a, target));

  // A CONSTRUCTED scalar settles the call form on both routes. On the
  // generic route it is the only admissible evidence (`alwaysDispatch`:
  // the static type came from a type variable's bound, not from the
  // caller). On the ordinary route it stands beside the static type, so an
  // argument whose type is wider than `number` — a call of a user function
  // whose result type is open — still keeps the direct call form its
  // construction proves sound, instead of forcing the whole application
  // through the runtime broadcast.
  const directCallArg = (a: Expression): boolean =>
    alwaysDispatch ? scalarArg(a) : provablyScalarArg(a) || scalarArg(a);

  if (mayBroadcast && !args.every(directCallArg))
    return dispatchCall(compiledArgs);

  // An ATOMIC argument beside one that may be a collection. The atomic one
  // must reach the callee WHOLE — the runtime broadcast descends a nested
  // array (`bcastWith`), so a point handed to it as a broadcast source is
  // mapped over its coordinates, which is not what the interpreter does
  // with a point — while the sibling still has to be mapped, because the
  // callee's body is scalar code. So each atomic argument is bound to a
  // temporary and the broadcast CLOSES OVER it, mapping the other
  // arguments only: `((_t1, _t2) => _SYS.bcastFn((_t3) => _fn_f(_t1, _t3),
  // _t2))(codeP, codeX)`. With `g(x) := 2x` and `f(p, x) := g(x)`, the
  // application `f((a, b), [u, v])` answers the interpreter's `[2, 4]`
  // this way, where the bare direct call computed `2 * [u, v]` and
  // answered NaN.
  //
  // Every argument that is not a literal is bound in the outer call, so an
  // argument is evaluated exactly once and in source order — `Random()` as
  // a coordinate of the point draws one number, as it does in the direct
  // call and under the `Array.isArray` guard below.
  //
  // When every non-atomic argument is provably scalar there is nothing to
  // map over, and the bare direct call stands.
  if (
    target.language === 'javascript' &&
    args.length > 0 &&
    paramsAreScalar &&
    atomicArg.some((x) => x) &&
    !args.every((a, i) => atomicArg[i] || directCallArg(a))
  ) {
    // `bound`: the outer temporaries, in argument order. `element`: the
    // closure parameter each mapped argument's ELEMENT arrives in.
    const bound = new Map<number, string>();
    const element = new Map<number, string>();
    args.forEach((a, i) => {
      if (atomicArg[i] || !certainlyScalarArg(a)) bound.set(i, tempVar(target));
      if (!atomicArg[i]) element.set(i, tempVar(target));
    });
    const callArgs = args.map((a, i) => {
      // An atomic argument is coerced where it is BOUND, so the coercion
      // runs once instead of once per element; a mapped one is coerced
      // inside the closure, on the element the broadcast selected, for the
      // reason `dispatchCall` gives.
      if (atomicArg[i]) return bound.get(i)!;
      const p = element.get(i)!;
      return coerceToComplex[i] ? complexWrap(p, a, target) : p;
    });
    const sources = [...element.keys()].map(
      (i) => bound.get(i) ?? compiledArgs[i]
    );
    const outerArgs = [...bound.keys()].map((i) =>
      atomicArg[i] && coerceToComplex[i]
        ? complexWrap(compiledArgs[i], args[i], target)
        : compiledArgs[i]
    );
    return (
      `((${[...bound.values()].join(', ')}) => ` +
      `_SYS.bcastFn((${[...element.values()].join(', ')}) => ` +
      `${name}(${[...callArgs, ...held].join(', ')}), ${sources.join(', ')}))` +
      `(${outerArgs.join(', ')})`
    );
  }

  // A statically scalar argument is still not a run-time scalar. Reaching
  // here, every argument's TYPE says it cannot be a collection — but that
  // type is usually an INFERENCE from the callee's own declared parameter,
  // not a fact about the value: `f(x: number) = 2x + 1` types the free `y`
  // in `f(y)` as `number`, and `run({ y: [1, 2, 3] })` then hands the call
  // an array all the same. A bare `_fn_f(_.y)` computed NaN there, where
  // the interpreter broadcasts to `[3, 5, 7]`.
  //
  // Inferred scalar types choose a guarded direct call instead of an
  // unconditional broadcast. Explicit scalar input declarations and values
  // constructed from known scalars are stronger contracts: `scalarArg`
  // excludes those arguments from the test.
  //
  // The guard binds each tested argument to a temporary, so an argument
  // expression is evaluated exactly once however the test goes. A LITERAL
  // argument (`certainlyScalarArg` — a number, string, character or boolean
  // literal) is a run-time scalar by construction: it is neither tested nor
  // bound, and a call whose arguments are all literals keeps the bare
  // direct call it emitted before.
  //
  // An array is not always a collection to broadcast over: a POINT — a
  // tuple-typed value — lowers to a JS array too, and mapping the callee
  // over its coordinates would answer one result per coordinate where the
  // interpreter answers one result for the whole point. The guard cannot
  // reach such a value. It is emitted only where `mayBroadcast` holds, which
  // requires a callee whose parameters are all SCALAR — a tuple-, point- or
  // collection-typed parameter makes `paramsAreScalar` false and keeps the
  // bare direct call — and only where every argument passed
  // `provablyScalarArg`, whose answer is `true` for exactly the `number`,
  // `boolean` and `string` types. A point-typed argument fails that test, so
  // it never reaches the guard; it takes whichever path it took before.
  if (mayBroadcast && !args.every(scalarArg)) {
    const tested = args
      .map((a, i) => (scalarArg(a) ? -1 : i))
      .filter((i) => i >= 0);
    const temps = new Map(tested.map((i) => [i, tempVar(target)] as const));
    // Each argument as the guarded branches see it: a bound temporary where
    // one was made, the literal's own code everywhere else.
    const bound = compiledArgs.map((code, i) => temps.get(i) ?? code);
    const test = tested
      .map((i) => `Array.isArray(${temps.get(i)})`)
      .join(' || ');
    return (
      `((${tested.map((i) => temps.get(i)).join(', ')}) => ${test} ? ` +
      `${dispatchCall(bound)} : ${directCall(bound)})` +
      `(${tested.map((i) => compiledArgs[i]).join(', ')})`
    );
  }

  return directCall(compiledArgs);
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
 *    array left behind is what `bcastFn` would wrongly map.
 *  - a TRANSPARENT alias reference that is a sugar-declared SUM — its
 *    declaration record carries `_sumVariants`. Every arm of such a sum is
 *    a nominal, so every runtime value is atomic by the clause above,
 *    whichever arm it came from. (Under the TAGGED policy the value is a
 *    `{_tag}` object, which `bcastFn` would not map anyway; under the
 *    ERASED policy it can be a bare array, which it would. The static test
 *    covers both uniformly.)
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
 * value the runtime reads by shape? The broadcast-aware wrapper a function
 * value receives (`broadcastingWrapper`) decides at run time with
 * `Array.isArray`, and a tuple, a record, a nominal (tagged or opaque) value
 * and a collection all lower to a bare JavaScript array or object, so the
 * wrapper would map over the FIELDS of one such argument where the
 * interpreter binds the whole value. Such a function keeps the bare
 * reference. A parameter typed `unknown` or `any` is admitted, as the
 * interpreter's own broadcast gate admits it; a record reaching it through a
 * callback value is a known limitation recorded in ROADMAP.md.
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
 *   - `_SYS.bcastFn` recurses into NESTED arrays — that is the unannotated
 *     default's leaf descent, not the declaration's one rank — and is
 *     all-or-nothing across arguments, so a sibling slot the declaration
 *     binds WHOLE would be mapped too.
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
 * The 0-based position of the first argument that is a single point
 * ({@link isSinglePointArg}) bound to a parameter of `h` that has NO type
 * — `unknown` or `any`, the type an unannotated parameter keeps when no use
 * in the body narrows it — or `-1` when there is none.
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
 * by-reference call (with its sibling broadcast) stands. A function with no
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
    if (pt === undefined || pt === 'unknown' || pt === 'any') return i;
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
 * Is `a` a scalar by CONSTRUCTION rather than by its static type — a number,
 * string or character LITERAL, whose runtime value is the literal itself?
 *
 * The stricter sibling of {@link provablyScalarArg}, for the call boundary
 * of a callee whose parameter types are read off a `where` clause rather
 * than declared by the caller. A scalar TYPE is not proof there (a free
 * symbol at a `T: number` parameter types `number` by inference, yet
 * `run({ y: [1,2,3] })` still hands the call an array); a literal is.
 */
export const certainlyScalarArg = (a: Expression): boolean =>
  (isNumber(a) && a.isNumberLiteral === true) ||
  isString(a) ||
  isCharacter(a) ||
  // A boolean LITERAL — the symbols `True`/`False` — is scalar by
  // construction, the same way a number/string/character literal is: its
  // runtime value cannot be an array. `a.type.matches('boolean')`, used by
  // `provablyScalarArg`, is not enough here, since a free symbol bound to a
  // `boolean`-typed parameter can still be an array at run time.
  isSymbol(a, 'True') ||
  isSymbol(a, 'False');

export function checkDeclaredBroadcast(
  engine: ComputeEngine,
  h: string,
  args: ReadonlyArray<Expression>,
  provablyScalarArg: (a: Expression) => boolean,
  target?: CompileTarget<Expression>
): void {
  checkDeclaredBroadcastAgainst(
    h,
    args,
    provablyScalarArg,
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
  provablyScalarArg: (a: Expression) => boolean,
  plan: BroadcastSlotPlan | undefined,
  hasBroadcastableParam: () => boolean,
  // Whether the callee compiles as a function of scalar parameters, each
  // `broadcastable<T>` slot whose `T` cannot hold a list read as `T`
  // (`withCellSlotsAsElements`): its calls are then emitted through the
  // element-wise call (`_SYS.bcastFn`), which maps to the cells as the
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
          if (!slot.mappable || provablyScalarArg(a)) return false;
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
        hasBroadcastableParam() && !args.every(provablyScalarArg);
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
 *    argument is broadcast by the by-reference call (`_SYS.bcastFn`) but
 *    would be substituted whole into the body;
 *  - every argument is pure: the by-reference call evaluates an argument
 *    ONCE, while substitution repeats it at every occurrence of its
 *    parameter — `(Random(), y)` into a body reading `P.x` twice would
 *    draw twice;
 *  - no binder in the body captures the substitution: `subs` replaces
 *    only the free occurrences of a parameter, but it is not
 *    capture-avoiding, so an argument symbol that an inner `Sum`/
 *    `Function`/`Block` binds would be CAPTURED by that binder. A
 *    parameter REBOUND by such a binder is refused as well. This is the
 *    condition `betaReduceLambda`
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
 * site: the strict lane-mismatch check above already compared the
 * arguments against the declared parameter types before either route was
 * chosen, and the by-reference definition enforces nothing further at run
 * time either.
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
 * a name is left untouched: `subs` is not capture-avoiding, and rebuilding a
 * scoped node would re-canonicalize its scope.
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
 * of the emitted body (`isConstructedScalar`) is read as a number too.
 * Only the TYPE is read here: a call of a user function is emitted as
 * before, with its run-time broadcast (`_SYS.bcastFn`), so an input that
 * holds a list at run time still maps the call over it; the scalar code
 * around the call is the lane every free input already takes. `memo`
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
    return isUntypedFreeInput(expr, target) || isConstructedScalar(expr, target)
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
