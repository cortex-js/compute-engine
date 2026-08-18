import {
  couldBeUnkeyedCollectionOperand,
  isFiniteIndexedCollection,
  typeCouldBeCollection,
  typeCouldBeNumericCollection,
  typeCouldBeNumericTuple,
  typeIsProvablyNonNumericCollection,
} from '../collection-utils.js';

import { flatten, flattenHoldingBarriers } from './flatten.js';
import { isSubtype } from '../../common/type/subtype.js';
import { deepEraseCallbackTypes } from '../../common/type/callback.js';
import { admissionOf, hasValueComponent } from './value-membership.js';
import {
  broadcastableBaseMatches,
  couldBeNonRealNumber,
  narrowingPreservesEffects,
  overlapsForDeferredValidation,
  stripMissingFromType,
  typeContainsMissing,
} from '../../common/type/utils.js';
import {
  diagnoseNoMatch,
  isRepairableOperatorSymbol,
  joinParamAt,
  overloadArms,
  resolveOverload,
  type ArmTrialFn,
  type OverloadResolution,
} from './overload.js';
import { parseType } from '../../common/type/parse.js';
import { typeToString } from '../../common/type/serialize.js';
import { reduceType } from '../../common/type/reduce.js';
import {
  freeTypeVariables,
  parameterPositions,
  type TypeInferenceResult,
} from '../../common/type/instantiate.js';
import {
  instantiatedParam,
  isThreadableAt,
  polytypeArm,
  solveArm,
  type Threadable,
} from './generic-instantiation.js';
import { FunctionSignature, Type } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Scope,
  BoxedValueDefinition,
  TypeProvenanceEntry,
} from '../global-types.js';
import { recordTypeProvenance, currentBoxingEpoch } from './type-provenance.js';
import {
  activeRollbackFrame,
  repairsForbiddenByRollbackFrame,
} from '../inference-rollback.js';
import { fuzzyStringMatch } from '../../common/fuzzy-string-match.js';
import { isOperatorDef, isValueDef } from './utils.js';
import { isTensorValue } from './tensor-view.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import {
  isSymbol,
  isFunction,
  isString,
  isContinuationOperand,
  containsContinuationOperand,
} from './type-guards.js';
import { narrowStringLiteralToCharacter } from './boxed-character.js';

// Parsed once: the type of an indexed collection whose every element is a
// number. Used in `checkNumericArgs` to accept collections for broadcasting on
// the strength of their static element type.
const INDEXED_COLLECTION_OF_NUMBER = parseType('indexed_collection<number>');

// `typeCouldBeNumericCollection` / `typeCouldBeNumericTuple` — the COULD-
// semantics predicates `checkNumericArgs` uses to admit collection/tuple
// operands — are imported from `collection-utils.ts`, where the
// `Add`/`Multiply` type handlers and the invisible-operator gate share the
// SAME predicates. Keeping a private copy here let the two layers diverge:
// an operand admitted by validation but missed by the type handlers
// collapsed to `number` and baked `incompatible-type` (Tycho item 30).

// `couldBeUnkeyedCollectionOperand` moved to `collection-utils.ts` alongside
// the sibling COULD-semantics predicates, so validation, overload resolution
// and result typing share ONE definition — a private copy here would let the
// resolution used for validation admit different arms from the one used for
// result typing.

/**
 * Exclusion gate for scalar numeric INFERENCE — deliberately WIDER than
 * broadcast admission (`couldBeUnkeyedCollectionOperand`). The hazard the
 * gate prevents is keyedness-independent: `x._infer('real')` on an operand
 * whose inferred result signature is collection-shaped WIDENS the shared
 * definition (Tycho item 121), and a `dictionary<…>`-shaped signature is
 * corrupted by that write exactly as a `vector<2>` one is. So ANY operand
 * that is, or could be, a collection of any kind is excluded from the
 * scalar inference — even though only the unkeyed ones are ever consumed
 * by broadcast.
 */
function excludedFromScalarInference(op: Expression): boolean {
  return op.isCollection || typeCouldBeCollection(op.type.type);
}

/**
 * Check that the number of arguments is as expected.
 *
 * Converts the arguments to canonical, and flattens the sequence.
 */
export function checkArity(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  count: number
): ReadonlyArray<Expression> {
  ops = flatten(ops);

  // @fastpath
  if (!ce.strict) {
    // Skip the "unexpected-argument" bookkeeping below, but still pad a
    // missing *required* argument with an `Error("missing")` marker.
    // Leaving it out entirely stores a raw JS `undefined` in the operand
    // array once `count` operands are assumed downstream (e.g. `Sin()`
    // canonicalizes to a zero-operand `Sin`, and `.evaluate()` then
    // destructures `ops[0]` as `undefined`, producing the garbage
    // expression `Sin([undefined])` instead of degrading gracefully).
    if (ops.length >= count) return ops;
    const xs = [...ops];
    while (xs.length < count) xs.push(ce.error('missing'));
    return xs;
  }

  if (ops.length === count) return ops;

  const xs: Expression[] = [...ops.slice(0, count)];
  let i = Math.min(count, ops.length);
  while (i < count) {
    xs.push(ce.error('missing'));
    i += 1;
  }
  while (i < ops.length) {
    xs.push(ce.error('unexpected-argument', ops[i].toString()));
    i += 1;
  }
  return xs;
}

/**
 * Prose-style fallback for un-applied builtin operators: a single
 * uppercase-letter symbol bound to a **standard-library** operator (`N`, `D`)
 * that appears as a bare operand of a numeric function (`N + 1`, `M = N + 1`,
 * `S/D`) almost always means a variable, not the builtin. Devolve it to an
 * unknown symbol by shadowing the builtin in the current scope; its type is
 * then inferred like any other free variable.
 *
 * Only *root-scope* (standard library) bindings devolve — a user-declared
 * function used as an operand is a genuine error and is preserved. Note the
 * shadow persists in the scope: a later `N(...)` in the same scope refers to
 * the variable, not the builtin (same convention as type inference, which is
 * also use-order dependent).
 *
 * The repair applies only to an operand that is itself bound to an OPERATOR
 * definition — an un-applied operator. A symbol bound to a value definition
 * has a type of its own, and re-boxing it here would silently launder the
 * parameter check it just failed.
 *
 * Returns the re-boxed symbol, or `null` if the fallback does not apply.
 */
function devolveUnappliedOperator(
  ce: ComputeEngine,
  op: Expression
): Expression | null {
  if (!isSymbol(op)) return null;
  // Must never execute inside a repair-FORBIDDING rollback frame — phase
  // 2c's trial validation, which admits a repairable operand by
  // `isRepairableOperatorSymbol` without running the repair. An ORDINARY
  // frame (the Epsil static checking pass) legitimately reaches this: the
  // shadow declaration below routes through `ce.declare`, which the
  // declaration journal family rolls back.
  console.assert(
    !repairsForbiddenByRollbackFrame(ce),
    'devolveUnappliedOperator must not run in trial (repair-free) validation'
  );
  const name = op.symbol;
  if (!/^[A-Z]$/.test(name)) return null;
  // An un-applied OPERATOR is what devolves. A symbol already bound to a
  // value (a user declaration such as `V: tuple<number,number,number>`) is
  // not repairable: its declared type is the answer, and the failed check
  // must surface as `incompatible-type` like it does for any other name.
  if (!op.operatorDefinition) return null;

  // Find the scope where the name is currently bound
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope && !scope.bindings.has(name)) scope = scope.parent;
  if (!scope) return null;

  const def = scope.bindings.get(name)!;
  if (!scope.parent) {
    // Bound to the standard library: shadow it in the current scope
    if (!isOperatorDef(def)) return null;
    // A top-level `ce.assign('F', x ↦ x²)` hoists its definition into the
    // same parentless scope as the standard library, so scope position alone
    // cannot tell a builtin from a user function. Discriminate on the
    // definition's ORIGIN: a definition backed by a user-defined function
    // literal is a genuine user function — using it as a numeric operand must
    // surface `incompatible-type`, not silently shadow the function (which
    // would also turn a later `F(2)` into the product `2F`).
    if (
      def.operator instanceof _BoxedOperatorDefinition &&
      def.operator._isLambda
    )
      return null;
    ce.declare(name, 'unknown');
    // Remember the shadow we just created: a later operand of the same
    // expression still carries the stale operator binding and has to be
    // rebound to it (see below).
    let shadowScope: Scope | null = ce.context.lexicalScope;
    while (shadowScope && !shadowScope.bindings.has(name))
      shadowScope = shadowScope.parent;
    const shadow = shadowScope?.bindings.get(name);
    if (shadowScope && shadow && isValueDef(shadow)) {
      shadow.value._isDevolvedShadow = true;
      ce._boxingState.noteDevolvedShadow(shadowScope);
    }
    return ce.box(name);
  }
  // The name was already shadowed with a value BY THIS REPAIR (e.g. by a
  // previous operand of the same expression): rebind this occurrence to the
  // shadow. Any other value definition — in particular a user declaration —
  // is not a repair target.
  if (isValueDef(def) && def.value._isDevolvedShadow) return ce.box(name);
  return null;
}

/**
 * Validation of arguments is normally done by checking the signature of the
 * function vs the arguments of the expression. However, we have a fastpath
 * for some common operations (add, multiply, power, neg, etc...) that bypasses
 * the regular checks. This is its replacements.
 *
 * Since all those fastpath functions are numeric (i.e. have numeric arguments
 * and a numeric result), we do a simple numeric check of all arguments, and
 * verify we have the number of expected arguments.
 *
 * We also assume that the function is threadable.
 *
 * The arguments are made canonical.
 *
 * Flattens sequence expressions.
 */
export function checkNumericArgs(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  options?: number | { count?: number; flatten?: string }
): ReadonlyArray<Expression> {
  let count = typeof options === 'number' ? options : options?.count;
  const flattenHead =
    typeof options === 'number' ? undefined : options?.flatten;

  // Ellipsis fold barrier: when a direct `ContinuationPlaceholder` operand is
  // present (a notational sum/product like `2 · 4 · … · 2n`), do not lift
  // nested associative operands — that would tear a coefficient out of its
  // anchor (the `2n` in `Multiply(2, n)`). Still lift `Sequence`/`Nothing`.
  if (flattenHead && ops.some((x) => isContinuationOperand(x)))
    ops = flatten(ops);
  else if (flattenHead && ops.some((x) => containsContinuationOperand(x))) {
    // Depth-aware barrier (mirrors `canonicalMultiply`): a nested product may
    // carry its ellipsis at any depth — e.g. raw-boxed
    // `Multiply(Multiply(a, Multiply(b, ContinuationPlaceholder)), c)` — and,
    // since `flatten` descends `Sequence` too, it may also sit behind a
    // `Sequence` wrapper. Splicing either would smuggle the placeholder past
    // the direct-operand check above. Hold barrier-bearing products back
    // whole; everything else still flattens.
    ops = flattenHoldingBarriers(ops, flattenHead);
  } else ops = flatten(ops, flattenHead);

  // @fastpath
  if (!ce.strict) {
    // Skip the full per-argument type checking below, but still pad a
    // missing *required* argument (when a `count` is specified, e.g.
    // `Negate`/`Power`/`Root`) with an `Error("missing")` marker. Leaving
    // it out entirely stores a raw JS `undefined` in the operand array,
    // which crashes the first time a `canonical`/`evaluate` handler
    // destructures that fixed-arity operand (e.g. `Negate()`, `Power(2)`)
    // instead of degrading gracefully like strict mode does.
    let xs: ReadonlyArray<Expression> = ops;
    if (count !== undefined && ops.length < count) {
      const padded = [...ops];
      while (padded.length < count) padded.push(ce.error('missing'));
      xs = padded;
    }
    let inferredType: Type = 'real';
    // If any of the arguments is a complex or imaginary number,
    // we'll infer the type as number
    for (const x of xs)
      if (couldBeNonRealNumber(x.type.type)) {
        inferredType = 'number';
        break;
      }
    // Numeric operators are threadable: an operand that could be a collection
    // at runtime (a `vector<n>`-returning application, `number | list`, a
    // tuple) is consumed by BROADCAST, so the scalar numeric context must not
    // be inferred onto it — `x._infer('real')` on a call whose inferred result
    // signature is already `vector<2>` WIDENS the shared definition to
    // `real | vector<2>`, and every later use of that function then types as
    // `number` (Tycho item 121: the compiled Sum then emits scalar `+` over
    // arrays). The exclusion is wider than admission — see
    // `excludedFromScalarInference` — and mirrors the guard on the
    // signature-validation route (`validateSignature`).
    for (const x of xs)
      if (!excludedFromScalarInference(x)) x._infer(inferredType);
    return xs;
  }

  let isValid = true;

  count ??= ops.length;

  const xs: Expression[] = [];
  const last = Math.max(count - 1, ops.length - 1);
  for (let i = 0; i <= last; i++) {
    const op = ops[i];
    if (i > count - 1) {
      isValid = false;
      xs.push(ce.error('unexpected-argument', op.toString()));
    } else if (op === undefined) {
      isValid = false;
      xs.push(ce.error('missing'));
    } else if (!op.isValid) {
      isValid = false;
      xs.push(op);
    } else if (op.isNumber) {
      // The argument is a number literal or a function whose result is a number
      xs.push(op);
    } else if (op.operator === 'Quantity') {
      // Quantity expressions are accepted in arithmetic contexts;
      // the evaluate handler will handle unit arithmetic.
      xs.push(op);
    } else if (isSymbol(op) && !ce.lookupDefinition(op.symbol)) {
      // We have an unknown symbol, we'll infer it's a number later
      xs.push(op);
    } else if (op.type.isUnknown || op.type.type === 'any') {
      // Unknown or any type. Keep it that way, infer later
      xs.push(op);
    } else if (typeContainsMissing(op.type.type)) {
      // An absent (`Missing`) or possibly-absent (`T | missing`) operand in a
      // numeric position. Every numeric operator resolves to `propagate`
      // (§3.A), so admit it here — the runtime gate produces `NaN` in the
      // result cell (strip-before-validate, §3.B). Keeps the short path in
      // lockstep with the definition route for `Add`/`Multiply`/`Negate`/…
      xs.push(op);
    } else if (typeCouldBeNumericCollection(op.type.type)) {
      // The argument's type could be a numeric collection at runtime
      // (e.g. `list`, `number | list`). Since numeric functions are
      // threadable, accept it.
      xs.push(op);
    } else if (typeCouldBeNumericTuple(op.type.type)) {
      // The argument is a numeric tuple (point/vector in ℝⁿ). Accept it for
      // vector arithmetic (Add/Multiply/Negate/Subtract/Divide). Pass through
      // without inferring its elements to `real` (like the tensor branch).
      xs.push(op);
    } else if (isTensorValue(op)) {
      // The argument is a tensor (matrix or vector). Accept it for tensor
      // operations like element-wise addition. Tensor-specific validation
      // (shape compatibility, etc.) happens in the evaluate function.
      xs.push(op);
    } else if (isFiniteIndexedCollection(op)) {
      if (op.type.matches(INDEXED_COLLECTION_OF_NUMBER)) {
        // (1) The static type already proves every element is a number (mirror
        // the indeterminate-size branch below). Accept without walking.
        xs.push(op);
      } else if (typeIsProvablyNonNumericCollection(op.type.type)) {
        // (2) The static element type is concrete and provably non-numeric
        // (e.g. `indexed_collection<string>`). The element type already
        // disproves numericity, so reject WITHOUT walking. Derived from the
        // shared `typeIsProvablyNonNumericCollection` predicate so this stays
        // in lockstep with the `Add`/`Multiply` type handlers (item 30).
        isValid = false;
        xs.push(ce.typeError('number', op.type, op));
      } else if (op.isLazyCollection) {
        // (3) The static element type is indeterminate (`any`/`unknown`), and
        // this is a lazy collection: `.each()` would materialize every element
        // just to type-check it. For a large lazy source (item 16:
        // `\frac{[1...1e8]}{2}` hung `ce.parse`) that is O(size) at
        // canonicalization time — and the cost does not depend on free
        // variables. Accept on the strength of laziness REGARDLESS of
        // `unknowns` and defer element validation to evaluate time — fail-open:
        // a lazy weak-typed collection of non-numbers now fails at evaluate
        // rather than erroring at canonicalization.
        xs.push(op);
      } else {
        // (3, eager) An eager, operand-backed collection (e.g. a literal
        // `List`) with an indeterminate element type: its elements are already
        // stored, so walking is cheap. Check that all elements are numbers and
        // infer the type of the elements. Use a local flag: `isValid` may
        // already be false from an earlier operand, which must not brand this
        // one with a type error.
        let allNumbers = true;
        for (const x of op.each()) {
          // A function-valued symbol element is accepted without inference,
          // mirroring the scalar gate's treatment of a bare function symbol
          // in numeric position (`2·N` stays symbolic and valid). An
          // `unknown`-typed element is infer-later, mirroring the
          // unknown-operand branch above. Both keep pathological values like
          // `[N, 2N]` (a list capturing an operator symbol) OUT of the
          // element-inference path — the operator-definition corruption
          // guard (type-inference.test.ts) pins this.
          const xt = x.type.type;
          if (isSymbol(x) && typeof xt !== 'string' && xt.kind === 'signature')
            continue;
          if (x.type.isUnknown) continue;
          if (!x.isNumber) {
            allNumbers = false;
            break;
          }
        }
        if (!allNumbers) {
          isValid = false;
          xs.push(ce.typeError('number', op.type, op));
        } else xs.push(op);
      }
    } else if (
      op.isIndexedCollection &&
      op.isFiniteCollection === undefined &&
      op.type.matches(INDEXED_COLLECTION_OF_NUMBER)
    ) {
      // An indexed collection of numbers whose size is indeterminate (e.g.
      // `Range(1, n)` with symbolic `n`). Accept it for broadcasting on the
      // strength of the element type: iterating to validate the elements —
      // what the finite branch above does — is not possible here.
      xs.push(op);
    } else if (
      op.valueDefinition?.inferredType &&
      isSubtype('number', op.type.type)
    ) {
      // There was an inferred type, and it is a supertype of "number"
      // e.g. "any". We'll narrow it down to "number" when we infer later.
      xs.push(op);
    } else if (
      op.operatorDefinition?.inferredSignature &&
      isSubtype('number', op.type.type)
    ) {
      // There is an inferred signature, and it is a supertype of 'number
      // e.g. "any". We'll narrow it down to "number" when we infer later.
      xs.push(op);
    } else if (
      op.operator === 'Hold' ||
      op.valueDefinition?.value?.operator === 'Hold'
    ) {
      // We keep 'Hold' expressions as is
      xs.push(op);
    } else {
      // Last chance: an un-applied single-letter builtin operator (`N + 1`)
      // devolves to an unknown symbol (see devolveUnappliedOperator)
      const devolved = op.operatorDefinition
        ? devolveUnappliedOperator(ce, op)
        : null;
      if (devolved) xs.push(devolved);
      else {
        isValid = false;
        xs.push(ce.typeError('number', op.type, op));
      }
    }
  }

  // Only if all arguments are valid, we infer the type of the arguments
  if (isValid) {
    let inferredType: Type = 'real';
    // If any of the arguments is a complex number, we'll infer the type as `number`
    for (const x of xs)
      if (couldBeNonRealNumber(x.type.type)) {
        inferredType = 'number';
        break;
      }
    for (const x of xs)
      if (isFiniteIndexedCollection(x)) {
        // `.each()` on a *lazy* collection (e.g. a large `Range`) materializes
        // every element, so walking it just to run no-op inferences enumerates
        // the whole collection at parse time (item 16: `\frac{[1...1e8]}{2}`
        // hung `ce.parse`). Skip the walk for ANY lazy collection: the
        // materialization cost is O(size) and does NOT depend on free variables,
        // so a lazy source with a free variable (`Map(x ↦ x+k, Range(1,2e5))`)
        // must be skipped just like a variable-free `Range` — walking it just to
        // run element inferences that narrow nothing (`k` stays `unknown`) is
        // pure overhead. Element validation/inference is deferred to evaluate
        // time (fail-open), mirroring the admission-branch guard above. Eager
        // collections (e.g. a literal `List`) already store their elements as
        // operands, so walking them is cheap regardless of `unknowns`:
        // `BoxedFunction._infer()` also narrows an inferred *result signature*
        // (not just free symbols), so a concrete literal list containing an
        // inferred function call still needs the walk.
        if (x.isLazyCollection) continue;
        // An ELEMENT that is itself a collection is consumed by NESTED
        // broadcast, not as a scalar, so it gets the same exclusion the
        // top-level operand gets on the branch below. Without it,
        // `Multiply(2, [L, L])` with `L := [1, 2]` narrowed `L`'s value
        // definition from `vector<finite_integer^2>` to `real` while
        // evaluating to the matrix `[[2, 4], [2, 4]]` — an unsound declared
        // type for a value that is still a list, and one that made a second
        // broadcast over the same symbol claim `vector<real^2>` for a
        // `matrix<...^(2x2)>` result.
        for (const y of x.each())
          if (!excludedFromScalarInference(y)) y._infer(inferredType);
      } else if (!excludedFromScalarInference(x)) x._infer(inferredType);
    // A possibly-collection operand (a `vector<n>`-returning application,
    // `number | list`, a tuple, a `dictionary<…>`-shaped signature) is not a
    // scalar: inferring the scalar numeric context onto it would WIDEN a
    // shared inferred result signature to `real | vector<…>` (Tycho item
    // 121) — same guard as the signature-validation route above, and wider
    // than broadcast admission (see `excludedFromScalarInference`).
  }

  return xs;
}

/**
 * Check that an argument is of the expected type.
 *
 * Converts the arguments to canonical
 */
export function checkType(
  ce: ComputeEngine,
  arg: Expression | undefined | null,
  type: Type | undefined
): Expression {
  if (arg === undefined || arg === null) return ce.error('missing');
  if (type === undefined)
    return ce.error('unexpected-argument', arg.toString());

  arg = arg.canonical;

  if (!arg.isValid) return arg;

  if (arg.type.matches(type)) return arg;

  // A one-cluster string literal at a `character` parameter narrows.
  const narrowed = narrowCharacterLiteral(ce, arg, type);
  if (narrowed !== undefined) return narrowed;

  // Value-component type (`0`, `integer<0..10>`): tri-state admission —
  // membership or undecidability admits; only proven refutation errors.
  // See `value-membership.ts`.
  if (hasValueComponent(type) && admissionOf(arg, type) !== 'refute')
    return arg;

  // Broadcastable operand: could be a plain scalar at runtime, admit it.
  if (broadcastableBaseMatches(arg.type.type, type)) return arg;

  // Overlap-deferred validation (§D6.2) — see validateArguments.
  if (overlapsForDeferredValidation(arg.type.type, type)) return arg;

  return ce.typeError(type, arg.type, arg);
}

/**
 * Does `param` expect a CHARACTER and refuse a string?
 *
 * True for the bare `character` type, and for a union that has a `character`
 * arm and no arm that already admits a string. An arm admitting the string
 * operand as-is means the call has a home for the literal as written, so
 * narrowing would silently resolve it to a DIFFERENT arm than the one the
 * author's value matched.
 *
 * "Admits a string" is tested with `isSubtype('string', arm)` rather than by
 * comparing the arm to the literal `'string'`: an identity test missed a
 * reference or alias arm that resolves to `string`, a nested union with a
 * `string` arm inside it, and a SUPERTYPE arm such as `value`, `expression`
 * or `any` — each of which accepts the string without help. `isSubtype`
 * resolves aliases and looks through nested unions itself, so no recursion is
 * needed here.
 *
 * Exported because literal narrowing happens in two places that must agree on
 * which declared types trigger it: argument validation (below) and a typed
 * declaration or assignment (`Declare`/`Assign` in `library/core.ts`).
 */
export function expectsCharacterNotString(param: Type): boolean {
  if (param === 'character') return true;
  if (typeof param === 'string') return false;
  if (param.kind !== 'union') return false;
  let hasCharacter = false;
  for (const arm of param.types) {
    if (isSubtype('string', arm)) return false;
    if (arm === 'character') hasCharacter = true;
  }
  return hasCharacter;
}

/**
 * LITERAL NARROWING: a string literal in a `character`-expecting position
 * becomes the character it denotes.
 *
 * Epsil has no character literal — `"a"` is a string — so without this the
 * `character` type would be unusable in practice: `f(c: character)` could
 * never be called with a written-out character. The criterion is the one
 * `CharacterFrom` applies (`isSingleGraphemeCluster`), so there is exactly one
 * definition of "one character" in the system; a multi-cluster or empty
 * literal returns `undefined` here and falls through to the ordinary
 * `incompatible-type` error.
 *
 * Confined to LITERALS on purpose: a `string`-TYPED expression does NOT
 * implicitly convert (`docs/STRING_ROADMAP.md`, design constraint 4) and must
 * be written `CharacterFrom(s)`.
 *
 * Returns `undefined` when no narrowing applies, so every call site is
 * `narrowCharacterLiteral(...) ?? <its existing behavior>`.
 */
function narrowCharacterLiteral(
  ce: ComputeEngine,
  op: Expression,
  param: Type
): Expression | undefined {
  if (!isString(op)) return undefined;
  if (!expectsCharacterNotString(param)) return undefined;
  return narrowStringLiteralToCharacter(ce, op);
}

export function checkTypes(
  ce: ComputeEngine,
  args: ReadonlyArray<Expression>,
  types: Type[]
): ReadonlyArray<Expression> {
  // Do a quick check for the common case where everything is as expected.
  // Avoid allocating arrays and objects
  if (
    args.length === types.length &&
    args.every((x, i) => x.type.matches(types[i]))
  )
    return args;

  const xs: Expression[] = [];
  for (let i = 0; i <= types.length - 1; i++)
    xs.push(checkType(ce, args[i], types[i]));

  for (let i = types.length; i <= args.length - 1; i++)
    xs.push(ce.error('unexpected-argument', args[i].toString()));

  return xs;
}

/**
 * Check that the argument is pure.
 */
export function checkPure(
  ce: ComputeEngine,
  arg: Expression | Expression | undefined | null
): Expression {
  if (arg === undefined || arg === null) return ce.error('missing');
  arg = arg.canonical;
  if (!arg.isValid) return arg;
  if (arg.isPure) return arg;
  return ce.error('expected-pure-expression', arg.toString());
}

/**
 *
 * If the arguments match the parameters, return null.
 *
 * Otherwise return a list of expressions indicating the mismatched
 * arguments.
 *
 * <!--
 * @todo?:
 * - Some permutations of operands should perhaps always be treated as invalid. Consider:
 *   - A sequence wildcard (non-optional, i.e. '__') followed by either a universal wildcard ('_'),
 *   or another non-optional sequence wildcard. (note that an optional sequence wildcard is
 *   unproblematic here.)
 *
 * -->
 *
 */
/**
 * Strip-before-validate decision (§3.B): at a stripped position, an operand
 * carrying a `missing` arm is admitted iff its stripped type still matches the
 * parameter. A Missing-free operand (`typeContainsMissing` false) is never
 * touched, so the lift is invisible to Missing-free programs.
 */
function strippedMatchesParam(
  op: Expression,
  param: Type,
  idx: number,
  stripMissing?: (index: number) => boolean
): boolean {
  if (!stripMissing?.(idx)) return false;
  if (!typeContainsMissing(op.type.type)) return false;
  const stripped = stripMissingFromType(op.type.type);
  return stripped === 'never' || isSubtype(stripped, param);
}

/** Engine-internal knobs of {@link validateArguments} (phase 2c of
 * `docs/plans/2026-08-13-inference-tx-design.md`). Not for library callers. */
export interface ValidateArgumentsInternals {
  /** Repair-free TRIAL mode: this call is an overload arm's trial, running
   * under a repair-forbidding rollback frame. The two construction-level
   * repairs are admitted by their write-free preconditions and NOT executed
   * (`devolveUnappliedOperator` would declare a shadow and request a
   * rebuild; `repairFreshMatrixInference` would retype symbols and re-box).
   * The winning arm's REAL validation — non-trial, no frame — performs any
   * repairs, exactly once. */
  trial?: boolean;
  /** The solve `resolveOverload` already ran on this (single-arm, polytype)
   * signature with the identical context — reused instead of re-solving. */
  armSolution?: TypeInferenceResult;
  /** Out-slot: the overload resolution computed by this call, when the
   * signature was an overload set. The caller attaches it to the call
   * expression it constructs, so result typing (`resolvedArm`) reads the
   * SAME resolution the call was validated against instead of re-deriving
   * one with the trial-less prefilter. */
  resolutionOut?: { resolution?: OverloadResolution };
}

export function validateArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  /** Global (`opDef.broadcastable`, `paramsAreScalar`) or PER-POSITION: a
   * declared `broadcastable<T>` signature threads only the slots it marks
   * elementwise, so a sibling slot that binds its argument whole is validated
   * as usual (`docs/plans/2026-08-08-broadcastable-param-semantics.md`). */
  threadable?: Threadable,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>,
  /** Strip-before-validate (§3.B of the missing-value typing design): for a
   * position where this predicate returns `true`, an operand carrying a
   * `missing` arm is admitted when its stripped type still matches the
   * parameter (a scalar `Missing` → `never`, admissible everywhere). The
   * missing arm is carried by the runtime gate, not the type. */
  stripMissing?: (index: number) => boolean,
  internals?: ValidateArgumentsInternals
): ReadonlyArray<Expression> | null {
  // A `Spread` operand (`f(...p)`) makes the effective arity unknown until
  // the enclosing call's evaluation splices the tuple's elements in — defer
  // ALL validation (including the non-strict missing-argument padding below)
  // to that runtime re-validation. Must precede the non-strict fastpath: the
  // padding would otherwise treat `f(...p)` as an arity-1 call.
  if (ops.some((x) => x.operator === 'Spread')) return null;

  // @fastpath
  if (!ce.strict) {
    // Skip the full per-parameter type checking below, but still pad a
    // missing *required* argument with an `Error("missing")` marker.
    // Returning `null` unconditionally here (the previous behavior) tells
    // the caller "use the operands as-is", so a genuinely missing argument
    // (e.g. `Arctan()`) left a fixed-arity `evaluate` handler destructuring
    // past the end of the operand array — a raw JS `undefined` rather than
    // a boxed error, which crashes instead of degrading gracefully.
    if (typeof signature !== 'string' && signature.kind === 'signature') {
      const requiredCount = signature.args?.length ?? 0;
      if (ops.length < requiredCount) {
        const xs = [...ops];
        while (xs.length < requiredCount) xs.push(ce.error('missing'));
        return xs;
      }
    } else {
      // Overload set: pad only up to the SMALLEST required count across the
      // arms. An arm needing more is simply not the one being called; padding
      // to the largest would manufacture `Error("missing")` operands for a
      // perfectly well-formed call to a shorter arm.
      const arms = overloadArms(signature);
      if (arms) {
        const requiredCount = Math.min(...arms.map((a) => a.args?.length ?? 0));
        if (ops.length < requiredCount) {
          const xs = [...ops];
          while (xs.length < requiredCount) xs.push(ce.error('missing'));
          return xs;
        }
      }
    }
    return null;
  }

  if (typeof signature === 'string') return null;

  // An intersection of signatures is an overload set. Resolve it to a single
  // arm and validate against that (`docs/plans/2026-07-25-overload-resolution
  // -design.md`). Resolution is write-free (§4.2), so no symbol is mutated on
  // account of an arm that is subsequently rejected.
  //
  // `viable` (not `selected`) drives the operand inference at the bottom of
  // this function: the result type comes from the most-specific arm, but the
  // constraint pushed back into an operand must be the JOIN over every arm
  // that survived (§4.3). Those pull in opposite directions.
  let sig: FunctionSignature;
  let viableArms: ReadonlyArray<FunctionSignature> | undefined;
  /** The selected arm's solve, when resolution already computed it — the
   * call-site instantiation below reuses it instead of solving the same arm
   * against the same operands with the same context a second time. */
  let armSolution: TypeInferenceResult | undefined;
  if (signature.kind === 'signature') {
    sig = signature;
  } else {
    const arms = overloadArms(signature);
    if (!arms) return null;
    // The policies reach both the cheap prefilter and the generic solver, so
    // resolution and validation see the same call.
    const policies = {
      lazy,
      threadable,
      couldBeUnkeyedCollection: couldBeUnkeyedCollectionOperand,
      stripMissing,
      freshMatrixRepair: (op: Expression, param: Type) =>
        couldRepairFreshMatrixInference(ce, op, param, freshlyInferred),
    };
    // Trial admission (phase 2c): an arm is viable iff running THIS function
    // on it, in trial mode, succeeds. The trial runs under a rollback frame,
    // so every inference write it performs — operand narrowing, signature
    // refinement, auto-declares — is undone whatever the outcome, and under a
    // boxing-pass window of its own (a frame must not straddle window
    // boundaries; opening a nested window inside an existing one is two
    // counter bumps). `forbidsRepairs` marks it as repair-free: the
    // construction-level repairs are admitted by precondition inside trial
    // mode and assert they never execute here. This replaced the write-free
    // mirror filter, whose gate conditions had to track this function's
    // admission logic by hand.
    const trial: ArmTrialFn = (declared, _instance, solution, armOps) =>
      ce._withBoxingPassWindow(() =>
        ce._withRolledBackInference(
          () => {
            const res = validateArguments(
              ce,
              armOps,
              declared,
              lazy,
              threadable,
              freshlyInferred,
              stripMissing,
              { trial: true, armSolution: solution }
            );
            // `null` = valid, operands unchanged. In trial mode no repair
            // executes, so `substituted` is never set and a non-null result
            // always carries at least one invalid operand — the refuted
            // positions.
            if (res === null) return null;
            const refuted: number[] = [];
            res.forEach((x, k) => {
              if (!x.isValid) refuted.push(k);
            });
            return refuted.length === 0 ? null : refuted;
          },
          { forbidsRepairs: true }
        )
      );
    const resolution = resolveOverload(
      ce,
      ops,
      arms,
      policies,
      undefined,
      trial
    );
    if (internals?.resolutionOut !== undefined)
      internals.resolutionOut.resolution = resolution;
    const { selected, viable, selectedSolution } = resolution;
    if (!selected) {
      // No arm fits. Blame the operands actually at fault: an operand every
      // near-miss arm accepts at its position stays untouched, so a bad seed
      // does not also indict a perfectly good domain argument.
      const { arityViable, arityTarget, refuted } = diagnoseNoMatch(
        ce,
        ops,
        arms,
        policies,
        trial
      );
      if (arityViable.length === 0) {
        // Wrong number of arguments for every arm. `arityTarget` is the
        // NEAREST accepted count, which also covers a gap in the accepted set
        // (arms of arity 1 and 3 called with 2) — the previous global
        // min/max bracketing waved those through with no marker at all.
        const target = arityTarget ?? ops.length;
        const xs: Expression[] = ops.map((op, idx) =>
          idx < target ? op : ce.error('unexpected-argument', op.toString())
        );
        while (xs.length < target) xs.push(ce.error('missing'));
        return xs;
      }
      const blamed = ops.map((op, idx) => {
        const expected = refuted.get(idx);
        return expected === undefined
          ? op
          : ce.typeError(expected, op.type, op);
      });
      // Invariant: a call with no selected arm must never come back fully
      // valid. `diagnoseNoMatch` guarantees a non-empty `refuted` whenever an
      // arm was arity-viable, so this is a backstop against a future
      // regression rather than an expected path.
      if (blamed.every((x) => x.isValid))
        blamed[0] = ce.error('unexpected-argument', ops[0]?.toString() ?? '');
      return blamed;
    }
    sig = selected;
    viableArms = viable;
    armSolution = selectedSolution;
  }

  const result: Expression[] = [];
  let isValid = true;
  // Set when an operand was replaced (devolved to an unknown symbol, or
  // repaired by matrix inference). The substituted list must then be returned
  // even if validation succeeds: returning `null` tells the caller to use the
  // original operands, and the original boxed symbol keeps its stale operator
  // binding (`N \equiv 1 \pmod k` stayed bound to the builtin `N`, so a later
  // `N := 11` was invisible to the expression).
  let substituted = false;

  // Positions accepted via overlap-deferred validation (§D6.2): acceptance
  // is an unrefuted possibility, not a proof, so these positions are
  // excluded from the final `_infer(param)` narrowing below — narrowing an
  // inferred symbol to `matrix` on the strength of a guess would
  // over-constrain unrelated later uses.
  const deferredIdx = new Set<number>();

  //
  // Call-site instantiation (§4.3 of the type-variables design). Gated on the
  // O(1) polytype test: a ground signature reaches none of this.
  //
  // Every site below that consumes a parameter type — `matches`, `isSubtype`,
  // `infer` — must see the INSTANTIATED ground parameter, never an open one
  // (§4.2 rule 1). The cheapest way to guarantee that is to instantiate the
  // parameter arrays ONCE, here, so no gate can accidentally read the pattern.
  // `paramStillOpen` records a residue that stayed open (impossible with a
  // total solver, but a leak must SKIP every write rather than write an open
  // type).
  //
  // `armSolution` is that same solve, when overload resolution already ran it
  // on this arm with this context (the policies it passes to `solveArm` are
  // exactly the three below) — reused rather than recomputed.
  const polyArm = polytypeArm(sig);
  const solved = polyArm
    ? (armSolution ??
      // A TRIAL of a single polytype arm: `resolveOverload` already solved
      // it with this exact context — reuse rather than re-solve.
      internals?.armSolution ??
      solveArm(polyArm, ops, {
        threadable,
        stripMissing,
        lazy,
        resolver: ce._typeResolver,
      }))
    : undefined;
  let paramStillOpen = false;
  const groundParam = (param: Type): Type => {
    // Design D §4, contract clause 1: a `callback<S>` slot is the primitive
    // `function` for EVERY argument-validation decision. Erased once here, at
    // the projection every gate below reads, so admission, the reported
    // expected type and the post-validation `_infer()` write are all
    // byte-identical to the bare-`function` slot this converted from — the
    // wrapped signature is contextual-typing information and never escapes
    // through an inference WRITE or a diagnostic. (It legitimately survives
    // where a user DECLARED it: a value declared `callback<S>` carries the
    // constructor in its definition, per clause 5; R-D5 erases it again at the
    // display surfaces.)
    //
    // DEEP: the builtins converted so far write the constructor as a whole
    // parameter slot, but a USER-declared signature may nest it
    // (`(list<callback<(integer) -> boolean>>) -> integer`), and a top-level-
    // only erasure would leak `callback<…>` into both the diagnostic and the
    // `_infer()` write for those.
    param = deepEraseCallbackTypes(param);
    if (!solved) return param;
    const t = instantiatedParam(param, solved.bindings);
    if (t !== undefined) return t;
    paramStillOpen = true;
    // Still open: admit everything at this position and skip every write.
    return 'any';
  };

  // D8 — absorbed top type × upper bounds. When a variable solved to an
  // ABSORBED `unknown` or `any` (a non-inferable top-typed operand), every
  // constraint that mentions it is satisfied PROVISIONALLY: the position is
  // admitted exactly as the engine's other provisional admissions are, and the
  // runtime stays the honest party. Without this, a generic signature would be
  // statically STRICTER than its ground counterpart on unknown/`any` operands,
  // breaking the §4.5 parity requirement. Deferred like the other provisional
  // admissions, so the final inference pass does not narrow on a guess.
  const provisionalIdx = new Set<number>();
  if (solved && solved.absorbed.size > 0 && polyArm) {
    const patterns = parameterPositions(polyArm, ops.length);
    patterns.forEach((p, k) => {
      if (p === undefined) return;
      for (const v of freeTypeVariables(p))
        if (solved.absorbed.has(v)) {
          provisionalIdx.add(k);
          return;
        }
    });
  }

  const params = sig.args?.map((x) => groundParam(x.type)) ?? [];
  const optParams = sig.optArgs?.map((x) => groundParam(x.type)) ?? [];
  // One instantiation for the whole variadic tail: the solver folds every
  // matching actual into the same variable's bound set (§4.3), so the tail's
  // instantiated pattern is position-independent.
  const varParam =
    sig.variadicArg === undefined
      ? undefined
      : groundParam(sig.variadicArg.type);
  const varParamCount = sig.variadicMin ?? 0;

  // §8 DISPLAY ONLY. A variable that got no call-site bound and carries no
  // declared bound falls to S3's `unknown`, so the instantiated parameter
  // reads `indexed_collection<unknown>` in an `incompatible-type` message — an
  // impossible-looking requirement for what is really "any indexed
  // collection". The message shows such a variable at its GROUND SKELETON
  // (`any`, which `reduceType` normalizes back to the bare constructor,
  // restoring the ground signature's wording). Nothing that TYPES the call
  // uses these: `params`/`optParams`/`varParam` keep the solved bindings.
  const displayBindings =
    solved && solved.unbound.size > 0
      ? {
          ...solved.bindings,
          ...Object.fromEntries(
            [...solved.unbound].map((v) => [v, 'any' as Type])
          ),
        }
      : undefined;
  const displayParam = (param: Type, ground: Type): Type => {
    if (displayBindings === undefined) return ground;
    // Clause 1 again: what is DISPLAYED for a callback slot is `function` —
    // deeply, for the nested-slot reason `groundParam` documents.
    const t = instantiatedParam(deepEraseCallbackTypes(param), displayBindings);
    return t === undefined ? ground : reduceType(t);
  };
  const displayParams =
    sig.args?.map((x, k) => displayParam(x.type, params[k])) ?? [];
  const displayOptParams =
    sig.optArgs?.map((x, k) => displayParam(x.type, optParams[k])) ?? [];
  const displayVarParam =
    sig.variadicArg === undefined || varParam === undefined
      ? undefined
      : displayParam(sig.variadicArg.type, varParam);

  /** The type to infer into the operand at `idx`. For a plain signature this
   * is the parameter itself; for an overload set it is the JOIN over every
   * viable arm (§4.3) — never the selected arm's parameter, which would
   * over-constrain the symbol (§4.5). */
  const inferenceTypeAt = (idx: number, param: Type): Type | undefined => {
    // §4.2 rule 1: never write while a parameter is still open.
    if (paramStillOpen) return undefined;
    if (!viableArms) return param;
    const joined = joinParamAt(viableArms, idx);
    // BACKSTOP (§4.2). `resolveOverload` instantiates every arm before the
    // join, so `viableArms` is ground and this join is too. A residue would
    // mean an unsolved variable leaked through the solver: skip the write
    // rather than narrow a symbol to a type variable.
    if (joined !== undefined && freeTypeVariables(joined).size > 0)
      return undefined;
    return joined;
  };

  let i = 0;

  // Iterate over any required parameters
  for (const param of params) {
    const idx = i;
    const op = ops[i++];
    if (!op) {
      result.push(ce.error('missing'));
      isValid = false;
      continue;
    }
    if (lazy) {
      result.push(op);
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      continue;
    }
    if (op.type.isUnknown || op.type.type === 'any') {
      // An expression with an unknown or any type is assumed to be valid,
      // we'll infer the type later
      result.push(op);
      continue;
    }
    if (
      isThreadableAt(threadable, idx) &&
      couldBeUnkeyedCollectionOperand(op)
    ) {
      result.push(op);
      continue;
    }
    // D8 provisional admission (see `provisionalIdx`).
    if (provisionalIdx.has(idx)) {
      result.push(op);
      deferredIdx.add(result.length - 1);
      continue;
    }
    if (op.valueDefinition?.inferredType && op.type.matches(param)) {
      result.push(op);
      continue;
    }

    // The symbol's type was inferred (not declared), and the required type is
    // a subtype of the current inferred type. Narrowing is sound, so narrow
    // the symbol's type rather than erroring (e.g. `B` inferred as `value`
    // from `SetMinus(A, B)`, later required as `set` in `SetMinus(B, A)`).
    // NOT on the effect axis: see `narrowingPreservesEffects`. NOT to a
    // value-component type (`0`, `integer<0..10>`): one call requiring the
    // value does not prove the symbol always holds it — pinning `k: 0` from
    // `g(k)` would over-constrain every later use. Membership (below)
    // admits the concrete-witness case instead, without the write.
    // NOT while a parameter is still OPEN (§4.2 rule 1): `param` here is the
    // INSTANTIATED ground projection, and a site that could not be
    // instantiated skips the write rather than narrowing to a type variable.
    if (
      !paramStillOpen &&
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      op._infer(param, 'narrow');
      result.push(op);
      continue;
    }

    if (op.operatorDefinition?.inferredSignature && op.type.matches(param)) {
      result.push(op);
      continue;
    }

    // A broadcastable operand whose scalar base matches the parameter could
    // be a plain scalar at runtime: admit it (see broadcastableBaseMatches).
    if (broadcastableBaseMatches(op.type.type, param)) {
      result.push(op);
      continue;
    }

    if (!op.type.matches(param)) {
      // A one-cluster string literal at a `character` parameter narrows to
      // the character it denotes; a multi-cluster one falls through to the
      // ordinary type error below.
      const asCharacter = narrowCharacterLiteral(ce, op, param);
      if (asCharacter !== undefined) {
        result.push(asCharacter);
        substituted = true;
        continue;
      }
      // Value-component parameter (`0`, `integer<0..10>`): tri-state
      // admission (§4.4). A concrete value passing membership ADMITS; a
      // symbolic operand that is not provably disjoint is UNDECIDABLE and
      // is provisionally admitted (the call could be fine — dispatch stays
      // open until the value is known); only proven refutation errors.
      // Mirrored in `paramMatches` (overload.ts). Deferred like the other
      // provisional admissions: the final `_infer(param)` pass must not
      // narrow a symbol's type to the VALUE type (`k := 0; g(k)` would
      // otherwise pin `k: 0`).
      if (hasValueComponent(param) && admissionOf(op, param) !== 'refute') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      // Strip-before-validate (§3.B): admit an operand carrying a `missing`
      // arm whose stripped type still matches the parameter. Accepted
      // provisionally (added to `deferredIdx`) so the final `_infer(param)`
      // narrowing does not widen an unconstrained symbol (I4).
      if (strippedMatchesParam(op, param, idx, stripMissing)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      if (internals?.trial) {
        // TRIAL mode: the two construction-level repairs are admitted by
        // their write-free preconditions and NOT executed — a repair
        // entangles state the trial's rollback frame must not touch (the
        // devolve shadow participates in the boxing-state rebuild loop; the
        // matrix repair re-boxes). A precondition is not a proof: the
        // winning arm's REAL validation runs the repair and may fail where
        // the trial admitted — that failure surfaces as the call's error,
        // with no second chance, byte-identical to the filter-era behavior.
        if (couldRepairFreshMatrixInference(ce, op, param, freshlyInferred)) {
          result.push(op);
          continue;
        }
        if (isRepairableOperatorSymbol(ce, op)) {
          result.push(op);
          continue;
        }
      } else {
        const repaired = repairFreshMatrixInference(
          ce,
          op,
          param,
          freshlyInferred
        );
        if (repaired) {
          result.push(repaired);
          substituted = true;
          continue;
        }
        // A bare uppercase symbol bound to a standard-library operator (`N`,
        // `D`) used where a value is required almost always means a variable
        // (`N \equiv 1 \pmod k`): devolve it to an unknown symbol, mirroring
        // the checkNumericArgs fallback.
        const devolved = devolveUnappliedOperator(ce, op);
        if (devolved !== null) {
          result.push(devolved);
          substituted = true;
          continue;
        }
      }
      // Overlap-deferred validation (§D6.2): a collection-kind parameter and
      // an operand whose static type does not REFUTE conformance (bare
      // `list`, unknown elements, `broadcastable<R>`, rank-compatible
      // nested lists) is accepted provisionally; runtime conformance is the
      // operator's own evaluate-time gate (handler precedence — a
      // nonconforming or still-symbolic operand stays inert or gets the
      // handler's specific error, e.g. `expected-square-matrix`).
      if (overlapsForDeferredValidation(op.type.type, param)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      result.push(ce.typeError(displayParams[idx] ?? param, op.type, op));
      isValid = false;
      continue;
    }
    result.push(op);
  }

  // Iterate over any optional parameters
  for (const param of optParams) {
    const op = ops[i];
    if (!op) {
      // No more ops, we're done
      break;
    }
    if (lazy) {
      result.push(op);
      i += 1;
      continue;
    }
    if (!op.isValid) {
      result.push(op);
      isValid = false;
      i += 1;
      continue;
    }
    if (op.type.isUnknown || op.type.type === 'any') {
      // An expression with an unknown or any type is assumed to be valid,
      // we'll infer the type later
      result.push(op);
      i += 1;
      continue;
    }
    if (isThreadableAt(threadable, i) && couldBeUnkeyedCollectionOperand(op)) {
      result.push(op);
      i += 1;
      continue;
    }
    // D8 provisional admission (see `provisionalIdx`).
    if (provisionalIdx.has(i)) {
      result.push(op);
      deferredIdx.add(result.length - 1);
      i += 1;
      continue;
    }
    if (op.valueDefinition?.inferredType && op.type.matches(param)) {
      // There was an inferred type, and it is contravariant with `number`
      // e.g. "any". We'll narrow it down to `number` when we infer later.
      result.push(op);
      i += 1;
      continue;
    }
    // Inferred (not declared) symbol type, and the required type is a subtype
    // of the current inferred type: narrow rather than error. NOT on the
    // effect axis (`narrowingPreservesEffects`); NOT to a value-component
    // type (see the required-param gate).
    if (
      !paramStillOpen &&
      op.valueDefinition?.inferredType &&
      isSubtype(param, op.type.type) &&
      !hasValueComponent(param) &&
      narrowingPreservesEffects(op.type.type, param)
    ) {
      op._infer(param, 'narrow');
      result.push(op);
      i += 1;
      continue;
    }
    // Broadcastable operand: could be a plain scalar at runtime, admit it.
    if (broadcastableBaseMatches(op.type.type, param)) {
      result.push(op);
      i += 1;
      continue;
    }
    if (!op.type.matches(param)) {
      // Literal narrowing at a `character` parameter — see the required-param
      // gate.
      const asCharacter = narrowCharacterLiteral(ce, op, param);
      if (asCharacter !== undefined) {
        result.push(asCharacter);
        substituted = true;
        i += 1;
        continue;
      }
      // Value-component tri-state admission — see the required-param gate
      // (deferred: the final inference pass must not narrow a symbol to the
      // value type).
      if (hasValueComponent(param) && admissionOf(op, param) !== 'refute') {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      // Strip-before-validate (§3.B) — see the required-param gate.
      if (strippedMatchesParam(op, param, i, stripMissing)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      // Overlap-deferred validation (§D6.2) — see the required-param gate.
      if (overlapsForDeferredValidation(op.type.type, param)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        i += 1;
        continue;
      }
      result.push(
        ce.typeError(displayOptParams[i - params.length] ?? param, op.type, op)
      );
      isValid = false;
      i += 1;
      continue;
    }
    result.push(op);
    i += 1;
  }

  // Iterate over any remaining ops
  if (varParam) {
    let additionalParam = 0;
    for (const op of ops.slice(i)) {
      i += 1;
      additionalParam += 1;
      if (lazy) {
        result.push(op);
        continue;
      }
      if (!op.isValid) {
        result.push(op);
        isValid = false;
        continue;
      }
      if (op.type.isUnknown || op.type.type === 'any') {
        // An expression with an unknown or any type is assumed to be valid,
        // we'll infer the type later
        result.push(op);
        continue;
      }
      // The operand index is `i - 1` (already incremented at the loop top).
      if (
        isThreadableAt(threadable, i - 1) &&
        couldBeUnkeyedCollectionOperand(op)
      ) {
        result.push(op);
        continue;
      }
      // D8 provisional admission (see `provisionalIdx`).
      if (provisionalIdx.has(i - 1)) {
        result.push(op);
        deferredIdx.add(result.length - 1);
        continue;
      }
      if (op.valueDefinition?.inferredType && op.type.matches(varParam)) {
        // There was an inferred type, and it is contravariant with `number`
        // e.g. "any". We'll narrow it down `number` to  when we infer later.
        result.push(op);
        continue;
      }
      // Inferred (not declared) symbol type, and the required variadic type is
      // a subtype of the current inferred type: narrow rather than error. NOT
      // on the effect axis (`narrowingPreservesEffects`); NOT to a
      // value-component type (see the required-param gate).
      if (
        !paramStillOpen &&
        op.valueDefinition?.inferredType &&
        isSubtype(varParam, op.type.type) &&
        !hasValueComponent(varParam) &&
        narrowingPreservesEffects(op.type.type, varParam)
      ) {
        op._infer(varParam, 'narrow');
        result.push(op);
        continue;
      }
      // Broadcastable operand: could be a plain scalar at runtime, admit it.
      if (broadcastableBaseMatches(op.type.type, varParam)) {
        result.push(op);
        continue;
      }
      if (!op.type.matches(varParam)) {
        // Literal narrowing at a `character` parameter — see the
        // required-param gate.
        const asCharacter = narrowCharacterLiteral(ce, op, varParam);
        if (asCharacter !== undefined) {
          result.push(asCharacter);
          substituted = true;
          continue;
        }
        // Value-component tri-state admission — see the required-param gate
        // (deferred: the final inference pass must not narrow a symbol to
        // the value type).
        if (
          hasValueComponent(varParam) &&
          admissionOf(op, varParam) !== 'refute'
        ) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        // Strip-before-validate (§3.B) — see the required-param gate. The
        // operand index is `i - 1` (already incremented at the loop top).
        if (strippedMatchesParam(op, varParam, i - 1, stripMissing)) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        // Overlap-deferred validation (§D6.2) — see the required-param gate.
        if (overlapsForDeferredValidation(op.type.type, varParam)) {
          result.push(op);
          deferredIdx.add(result.length - 1);
          continue;
        }
        result.push(ce.typeError(displayVarParam ?? varParam, op.type, op));
        isValid = false;
        continue;
      }
      result.push(op);
    }
    if (additionalParam < varParamCount) {
      // We didn't get enough parameters for the variadic argument
      result.push(ce.error('missing'));
      isValid = false;
    }
  }

  // Are there any remaining parameters?
  if (i < ops.length) {
    for (const op of ops.slice(i)) {
      result.push(ce.error('unexpected-argument', op.toString()));
      isValid = false;
    }
  }

  // A bound constraint the per-position gates cannot see (§8): the solved
  // value violates a declared bound, or two contravariant positions demand
  // incompatible instantiations. Every position matched its INSTANTIATED
  // parameter, so this is the only place the conflict can surface. The
  // displayed expected type is always ground (§8 rule 1).
  if (solved && solved.failures.length > 0 && polyArm) {
    const patterns = parameterPositions(polyArm, ops.length);
    for (const f of solved.failures) {
      const idx = f.index ?? 0;
      if (idx >= result.length) continue;
      if (!result[idx].isValid) continue;
      // A `where T is P` constraint (protocols design P19) is not a subtype
      // violation, so it does not report as one: the offending operand carries
      // `protocol-constraint-unsatisfied`, naming the protocol and the type
      // the variable solved to.
      if (f.kind === 'protocol') {
        result[idx] = ce.error(
          [
            'protocol-constraint-unsatisfied',
            `\`${typeToString(f.solution)}\` does not conform to the \`${f.protocol}\` protocol (\`${f.variable}\` is constrained by \`where ${f.variable} is ${f.protocol}\`)`,
          ],
          ops[idx]?.toString()
        );
        isValid = false;
        continue;
      }
      // For a contravariant (callback) conflict the expected type displayed is
      // the blamed position's parameter with the variable set to what the
      // OTHER constraints pin it to — §8's `(integer) -> boolean`, not the
      // bare constraining type. A violated DECLARED bound gets the same
      // treatment with the variable set to the bound itself: the blamed
      // position may be a CONSTRUCTOR pattern (`list<T>` at a `T: integer`
      // bound), where displaying the bare bound would read "expected
      // `integer`, got `vector<finite_real^2>`" — the instantiated pattern
      // (`list<integer>`) is the position's true expected type. For a
      // bare-variable position the instantiation IS the bound, so the message
      // is unchanged there.
      const pattern = patterns[idx];
      const pinTo =
        f.kind === 'upper' && f.pin !== undefined
          ? f.pin
          : f.kind === 'bound'
            ? f.expected
            : undefined;
      const expected =
        pinTo !== undefined && pattern !== undefined
          ? (instantiatedParam(pattern, {
              ...solved.bindings,
              [f.variable]: pinTo,
            }) ?? f.expected)
          : f.expected;
      result[idx] = ce.typeError(expected, ops[idx]?.type, ops[idx]);
      isValid = false;
    }
  }

  if (!isValid) return result;

  //
  // All arguments are valid, we can infer the domain of the arguments
  //
  // When an operand was substituted, infer on (and return) the substituted
  // list: `result` and `ops` are index-aligned on the valid path (one entry
  // pushed per consumed operand).
  const finalOps = substituted ? result : ops;
  i = 0;
  for (const param of params) {
    const t = inferenceTypeAt(i, param);
    if (t !== undefined && !lazy && !deferredIdx.has(i))
      if (
        !isThreadableAt(threadable, i) ||
        !couldBeUnkeyedCollectionOperand(finalOps[i])
      )
        finalOps[i]._infer(t);
    i += 1;
  }
  for (const param of optParams) {
    if (!finalOps[i]) break;
    const t = inferenceTypeAt(i, param);
    if (t !== undefined && !lazy && !deferredIdx.has(i))
      if (
        !isThreadableAt(threadable, i) ||
        !couldBeUnkeyedCollectionOperand(finalOps[i])
      )
        finalOps[i]._infer(t);
    i += 1;
  }
  if (varParam) {
    for (const op of finalOps.slice(i)) {
      const t = inferenceTypeAt(i, varParam);
      if (t !== undefined && !lazy && !deferredIdx.has(i))
        if (
          !isThreadableAt(threadable, i) ||
          !couldBeUnkeyedCollectionOperand(op)
        )
          op._infer(t);
      i += 1;
    }
  }
  return substituted ? result : null;
}

/**
 * Would a `matrix` argument satisfy this parameter? The repair below rewrites
 * its operands to `matrix`, so this — not "is the parameter type itself a
 * matrix" — is its entry gate. The direction matters for a UNION parameter
 * (`LinearSolve`'s `matrix | vector`): a union is assignable to `R` only when
 * EVERY arm is, so `matrix | vector` does not match `matrix`, while `matrix`
 * *is* assignable to `matrix | vector`. The reversed spelling silently
 * declined the repair for every union-typed parameter.
 */
function acceptsMatrix(ce: ComputeEngine, expected: Type): boolean {
  return ce.type('matrix').matches(expected);
}

/**
 * The **write-free** precondition of {@link repairFreshMatrixInference}: true
 * when the repair could apply to this operand/parameter pair.
 *
 * The repair itself mutates definitions, re-boxes, and rolls back on failure,
 * so overload resolution — which must not write (§4.2 of the overload design)
 * — cannot run it to find out. It consults this instead. Deliberately
 * conservative in the ADMITTING direction: it checks the repair's own
 * entry gates (a `matrix`-ish parameter, at least one fresh eligible symbol,
 * and a non-empty structural plan) but not whether the re-box would actually
 * produce a conforming type. An arm kept on a repair that then fails is handed
 * to full validation, which produces the error — exactly what happens for a
 * plain signature. Refusing to model the repair at all would be worse: an
 * operand a plain signature repairs and accepts would silently match no arm.
 */
function couldRepairFreshMatrixInference(
  ce: ComputeEngine,
  op: Expression,
  expected: Type,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): boolean {
  if (!freshlyInferred || !acceptsMatrix(ce, expected)) return false;

  const eligible = new Set<string>();
  for (const name of op.freeVariables) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) continue;
    if (freshlyInferred.has(def.value) || def.value.type.isUnknown)
      eligible.add(name);
  }
  if (eligible.size === 0) return false;

  const names = matrixInferencePlan(op, eligible);
  return names !== null && names.size > 0;
}

/**
 * Repair bottom-up numeric inference when a matrix-consuming operator gives
 * the enclosing context that was unavailable to Add/Multiply. Only symbols
 * first inferred while canonicalizing this argument are eligible. The repair
 * is deliberately structural and fail-closed: an ambiguous product such as
 * `a A` (both names fresh) is not guessed.
 *
 * Its write-free entry gates are factored into
 * {@link couldRepairFreshMatrixInference} so overload resolution can consult
 * them without mutating; keep the two in step.
 */
function repairFreshMatrixInference(
  ce: ComputeEngine,
  op: Expression,
  expected: Type,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
): Expression | null {
  if (!freshlyInferred || !acceptsMatrix(ce, expected)) return null;

  const eligible = new Set<string>();
  for (const name of op.freeVariables) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) continue;
    // "Fresh" = the definition's type was first inferred (unknown → concrete)
    // during this boxing operation — the forward log recorded by
    // `BoxedSymbol._infer()` — or is still unknown (never inferred; the
    // previous snapshot-based provenance excluded unknown-typed definitions
    // from "inferred before", making them always eligible). Keying on the
    // definition's identity rather than its name also means a symbol whose
    // fresh inner-scope definition has been popped, and which now resolves to
    // an outer definition inferred before this box, is correctly ineligible.
    if (freshlyInferred.has(def.value) || def.value.type.isUnknown)
      eligible.add(name);
  }
  if (eligible.size === 0) return null;

  const names = matrixInferencePlan(op, eligible);
  if (!names || names.size === 0) return null;

  // Per-name repair-local records for an EXACT failure-leg restore (phase 2a
  // of docs/plans/2026-08-13-inference-tx-design.md). Three families:
  // - `snapshots`: the coupled type/value slots, restored setter-bypassing
  //   via `_restoreTypeSlots` — the old restore wrote through the `type`
  //   setter, which allocates fresh `BoxedType`s (defeating identity-keyed
  //   caches) and, when the previous type was `unknown` (eligible above),
  //   WIPED the definition's assigned value.
  // - `histories`: the provenance array as it stood before the write — the
  //   write below records a provenance entry, and a failed repair must leave
  //   the history byte-identical (including a cap-displaced entry, which the
  //   slice preserves wholesale).
  // - `freshlyAdded`: definitions this repair itself added to
  //   `_freshlyInferred` (an `unknown` → `matrix` transition during a boxing
  //   pass), removed again on failure so a rolled-back repair leaves no
  //   phantom repair eligibility.
  // The narrowing sink is notified only on the SUCCESS path (below): sink
  // retraction machinery is a phase-2b journal family, so an entry recorded
  // at write time for a repair the failure leg then undoes would report a
  // narrowing that never took effect — but a SUCCESSFUL repair permanently
  // narrows an (possibly enclosing) definition, and a contained parse's
  // `scope.narrowings()` must see that.
  // The repair must never execute inside a repair-FORBIDDING rollback frame
  // — phase 2c's trial validation mode, which admits repairs by their
  // write-free precondition (`couldRepairFreshMatrixInference`) without
  // running them; the winning arm re-validates for real, outside any frame.
  // An ORDINARY rollback frame (the Epsil static checking pass wraps full
  // canonicalization in one) legitimately reaches this repair, and every
  // write below is journaled so the frame rolls it back.
  console.assert(
    !repairsForbiddenByRollbackFrame(ce),
    'repairFreshMatrixInference must not run in trial (repair-free) validation'
  );

  const snapshots = new Map<string, unknown>();
  const histories = new Map<string, TypeProvenanceEntry[] | undefined>();
  const beforeTypes = new Map<string, BoxedType>();
  const freshlyAdded: BoxedValueDefinition[] = [];
  const frame = activeRollbackFrame(ce);
  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (!def || !isValueDef(def) || !def.value.inferredType) return null;
    snapshots.set(name, def.value._typeSlotSnapshot());
    histories.set(name, def.value._typeProvenance?.slice());
    beforeTypes.set(name, def.value.type);
    const wasUnknown = def.value.type.isUnknown;
    // Rollback journal (family 1): the repair-local records above serve the
    // repair's own FAILURE leg; the journal entry is what reverses a
    // SUCCESSFUL repair when an enclosing rollback frame aborts. On a failed
    // repair the frame's entries replay over already-restored state, and
    // every family involved composes with that: `_restoreTypeSlots` writes
    // the same slots again (idempotent); the family-6 undo deletes a set
    // member the failure leg already removed (`Set.delete` no-op); and the
    // family-7 undo pops the array object `recordTypeProvenance` pushed to —
    // which the failure leg's `_typeProvenance = histories.get(name)` has
    // DETACHED from the definition, so the pop touches nothing live.
    // (Pinned by the "failure leg inside an open rollback frame" tests in
    // `test/compute-engine/inference-rollback.test.ts`.)
    if (frame !== undefined) {
      const target = def.value;
      const slots = target._typeSlotSnapshot();
      frame.record({ undo: () => target._restoreTypeSlots(slots) });
    }
    def.value.type = ce.type('matrix');
    // Freeze the contextual assignment during re-canonicalization so the
    // numeric fast path cannot immediately narrow it back to `real`.
    def.value.inferredType = false;
    // The write is now channel-visible where it matters: provenance (the
    // matrix inference is evidence, with the operand as its cause) and the
    // fresh-inference set (matching `_noteInferenceWrite`'s condition).
    recordTypeProvenance(ce, def.value, {
      type: def.value.type,
      kind: 'inferred',
      axis: 'type',
      cause: op,
      epoch: currentBoxingEpoch(ce),
    });
    if (
      wasUnknown &&
      ce._inferenceTxDepth > 0 &&
      !ce._freshlyInferred?.has(def.value)
    ) {
      const set = (ce._freshlyInferred ??= new Set());
      // Rollback journal (family 6): this add is guarded by the `!has`
      // check above, so the prior-presence bit is always "absent" here.
      if (frame !== undefined) {
        const added = def.value;
        frame.record({ undo: () => set.delete(added) });
      }
      set.add(def.value);
      freshlyAdded.push(def.value);
    }
  }
  ce._noteStateEvent({ kind: 'inference' });

  const repaired = ce.box(op.json);
  if (repaired.type.matches(expected)) {
    const sink = ce._narrowingSink;
    for (const name of names) {
      const def = ce.lookupDefinition(name);
      if (def && isValueDef(def)) {
        def.value.inferredType = true;
        // Report the COMMITTED net transition to a contained parse's
        // narrowing capture — only now, when the write is permanent.
        if (sink !== undefined)
          sink._recordNarrowing(
            name,
            def,
            beforeTypes.get(name)!,
            def.value.type
          );
      }
    }
    return repaired;
  }

  for (const name of names) {
    const def = ce.lookupDefinition(name);
    if (def && isValueDef(def)) {
      def.value._restoreTypeSlots(snapshots.get(name));
      def.value._typeProvenance = histories.get(name);
    }
  }
  for (const fresh of freshlyAdded) ce._freshlyInferred?.delete(fresh);
  ce._noteStateEvent({ kind: 'inference' });
  return null;
}

function matrixInferencePlan(
  expr: Expression,
  eligible: ReadonlySet<string>
): Set<string> | null {
  if (isSymbol(expr))
    return eligible.has(expr.symbol) ? new Set([expr.symbol]) : null;

  if (!isFunction(expr)) return null;

  if (expr.operator === 'Negate')
    return matrixInferencePlan(expr.op1, eligible);

  if (expr.operator === 'Add' || expr.operator === 'Subtract') {
    const result = new Set<string>();
    for (const term of expr.ops) {
      const plan = matrixInferencePlan(term, eligible);
      if (!plan) return null;
      for (const name of plan) result.add(name);
    }
    return result;
  }

  if (expr.operator === 'Multiply') {
    const candidates = expr.ops
      .map((factor) => matrixInferencePlan(factor, eligible))
      .filter((x): x is Set<string> => x !== null);
    // Numeric literals and already-declared scalar factors may scale the one
    // matrix factor. More than one candidate is underdetermined (`a A`).
    if (candidates.length !== 1) return null;
    return candidates[0];
  }

  if (expr.operator === 'Power' && expr.op2?.isInteger === true)
    return matrixInferencePlan(expr.op1, eligible);

  return null;
}

/** Recursively examine the symbols and operators and for any
 * that don't have a definition, suggest an alternative name.
 */
function spellcheckSymbols(expr: Expression): Record<string, string> {
  const { symbols, operators } = getKnownNames(expr.engine);
  const suggestions: Record<string, string> = {};

  const visit = (expr: Expression): void => {
    if (isSymbol(expr) && !expr.symbol.startsWith('_')) {
      if (!(expr.symbol in suggestions) && !symbols.includes(expr.symbol)) {
        const match = fuzzyStringMatch(expr.symbol, symbols);
        if (match) suggestions[expr.symbol] = match;
      }
    } else if (isFunction(expr) && !expr.operator.startsWith('_')) {
      const operator = expr.operator;
      if (!(operator in suggestions) && !operators.includes(operator)) {
        const match = fuzzyStringMatch(operator, operators);
        if (match) suggestions[operator] = match;
      }
      for (const op of expr.ops) visit(op);
    }
  };

  visit(expr);
  return suggestions;
}

/** Collect, in a single walk of the scope chain, the names of all known
 * symbols (value defs) and operators (operator defs) visible in the current
 * scope. A name bound to both appears in both lists. */
function getKnownNames(ce: ComputeEngine): {
  symbols: string[];
  operators: string[];
} {
  const symbols: string[] = [];
  const operators: string[] = [];
  let currentScope: Scope | null = ce.context.lexicalScope;
  while (currentScope) {
    for (const [key, def] of currentScope.bindings) {
      if (isValueDef(def)) symbols.push(key);
      if (isOperatorDef(def)) operators.push(key);
    }
    currentScope = currentScope.parent;
  }

  return { symbols, operators };
}

export function spellCheckMessage(expr: Expression): string {
  const suggestions = spellcheckSymbols(expr);
  if (Object.keys(suggestions).length === 0) return '';

  if (Object.keys(suggestions).length === 1) {
    const [symbol, suggestion] = Object.entries(suggestions)[0];
    return `Unknown symbol "${symbol}". Did you mean "${suggestion}"?`;
  }

  const lines: string[] = [];
  for (const [symbol, suggestion] of Object.entries(suggestions)) {
    lines.push(`- "${symbol}" -> "${suggestion}"?`);
  }
  return `Unknown symbols found:\n${lines.join('\n')}`;
}
