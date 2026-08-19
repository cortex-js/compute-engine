import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal/index.js';
import type {
  ExpressionInput,
  Expression,
  CanonicalOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Scope,
  BoxedValueDefinition,
  BoxedOperatorDefinition,
  BindingSiteSelector,
} from '../global-types.js';
import type { FormOption } from '../types-serialization.js';

import type {
  MathJsonExpression,
  ExpressionObject,
  MathJsonSymbol,
} from '../../math-json/types.js';
import {
  hasMetaData,
  machineValue,
  matchesNumber,
  matchesString,
  matchesSymbol,
  missingIfEmpty,
  stringValue,
  symbol,
} from '../../math-json/utils.js';
import { isValidSymbol, validateSymbol } from '../../math-json/symbols.js';
import { checkDeadline } from '../../common/interruptible.js';

import { isOne, isZero } from '../numerics/rationals.js';
import { SMALL_INTEGER } from '../numerics/numeric.js';
import type { Rational } from '../numerics/types.js';
import { asBigint } from './numerics.js';
import { isInMachineRange } from '../numerics/numeric-bignum.js';

import { canonicalAdd } from './arithmetic-add.js';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div.js';

import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { canonicalPower, canonicalRoot } from './arithmetic-power.js';

import {
  hasNamedArguments,
  inlineLiteralSignature,
  namesRequiredOperands,
  normalizeNamedArguments,
  protocolMemberParts,
  qualifiedFieldParts,
  splitNamedArguments,
} from './named-arguments.js';
import { qualifiedMemberRequirementShape } from '../engine-protocols.js';
import { multiClauseState } from '../multi-clause.js';

import { _BoxedExpression } from './abstract-boxed-expression.js';
import {
  BoxedFunction,
  broadcastableParamSlots,
  paramsAreScalar,
} from './boxed-function.js';
import type { CallbackSlot, Threadable } from './generic-instantiation.js';
import {
  contextualCallbackPlan,
  hasCallbackParam,
  instantiateCallbackSlots,
} from './generic-instantiation.js';
import { BoxedString } from './boxed-string.js';
import { BoxedDictionary } from './boxed-dictionary.js';
import { canonicalForm } from './canonical.js';
import { sortOperands } from './order.js';
import { validateArguments, checkNumericArgs } from './validate.js';
import {
  overloadArms,
  paramAt,
  resolveContextualArm,
  type OverloadResolution,
} from './overload.js';
import { isSubtype } from '../../common/type/subtype.js';
import {
  COLLECTION_SHAPE_TYPE,
  NUMERIC_TYPES,
} from '../../common/type/primitive.js';
import {
  isWildcardFunctionType,
  resolveTypeForCompilation as resolveType,
} from '../../common/type/utils.js';
import { typeToString } from '../../common/type/serialize.js';
import { freeTypeVariables } from '../../common/type/instantiate.js';
import type { FunctionSignature, Type } from '../../common/type/types.js';
import { flatten } from './flatten.js';
import { isValueDef } from './utils.js';
import {
  annotateFunctionLiteralParams,
  lookupApplicable,
} from '../function-utils.js';
import { canonicalNegate } from './negate.js';
import { canonical } from './canonical-utils.js';
import {
  isNumber,
  isFunction,
  isSymbol,
  adoptsForeignEngineObject,
} from './type-guards.js';
import { symbolAtSite, replaceAtSite } from './binding-sites.js';
import { beginDormantPop, endDormantPop } from './binding-tombstone.js';
import { rebindToBindings } from './binders.js';
import {
  isProvisionalCaptureOpen,
  noteProvisionalCall,
} from './provisional-application.js';
// Dynamic import to avoid circular dependency

/**
 * ### THEORY OF OPERATIONS
 *
 *
 * 1/ The result of boxing is canonical by default.
 *
 *   This is the most common need (i.e. to evaluate an expression you need it
 *   in canonical form). Creating a boxed expression which is canonical from the
 *   start avoid going through an intermediary step with a non-canonical
 *   expression.
 *
 * 2/ When boxing (and canonicalizing), if the function is "scoped", a new
 *    scope is created before the canonicalization, so that any declaration
 *    are done within that scope. Example of scoped functions include `Block`
 *    and `Sum`.
 *
 * 3/ When implementing an `evaluate()`:
 * - if `bignumPreferred()` all operations should be done in bignum,
 *    otherwise, they should all be done in machine numbers.
 * - if a rational is encountered, preserve it
 * - if a `Sqrt` of a rational is encountered, preserve it
 * - if a `hold` constant is encountered, preserve it
 * - if `numericApproximation` is false and one of the arguments is not exact,
 *  return an approximation
 * - if `numericApproximation` is true, always return an approximation
 *
 * NUMERIC APPROXIMATION = FALSE
 * - 2 + 5 -> 7
 * - 2 + 5/7 -> 19/7
 * - 2 + √2 -> 2 + √2
 * - 2 + √(5/7) -> 2 + √(5/7)
 * - 5/7 + 9/11 -> 118/77
 * - 5/7 + √2 -> 5/7 + √2
 * - 10/14 + √(18/9) -> 5/7 + √2
 * - √2 + √5 -> √2 + √5
 * - √2 + √2 -> 2√2
 * - sin(2) -> sin(2)
 * - sin(pi/3) -> √3/2
 * - 2 + 2.1 -> 2 + 2.1
 *
 * NUMERIC APPROXIMATION = TRUE
 * - 2 + 2.1 -> 4.1
 * - 2 + √2.1 -> 3.44914
 * - 5/7 + √2.1 -> 2.16342
 * - sin(2) + √2.1 -> 2.35844
 */

/**
 * Translate a public `FormOption` to the internal
 * `{ canonical, structural }` representation.
 */
/**
 * Boxing options for an operand boxed raw (unbound, uncanonicalized) from
 * inside the boxer — what `ce.expr(x, { form: 'raw' })` resolves to. Sites on
 * the recursive boxing path use `box(ce, x, RAW_OPERAND)` directly rather than
 * the public `ce.expr()`, which re-enters through the scope plumbing (five
 * frames per operand) to install a scope that is already the current one.
 */
const RAW_OPERAND = { canonical: false, structural: false } as const;

/**
 * Box the operands of a construction: the same result as
 * `ops.map((x) => box(ce, x, options))` (for the dense arrays MathJSON
 * operands are — a hole in a sparse array would be boxed as a missing
 * operand rather than kept as a hole), spelled to spend as few stack frames
 * per nesting level as possible. Boxing recurses once per level of the
 * MathJSON tree, and the frames per level bound how deep a tree can be boxed
 * before `RangeError: Maximum call stack size exceeded` (see `box()`).
 *
 * Two savings. (1) When this construction is already inside a root boxing
 * pass — the inference transaction is open (`_inferenceTxDepth > 0`) AND a
 * root repair is active — both brackets that `box()` puts around
 * `boxInternal()` are no-ops (a nested `beginInferenceTransaction` neither
 * bumps the epoch nor, on end, clears `_freshlyInferred`; `withDevolveRepair`
 * with the root active just calls its builder), so `boxInternal()` is called
 * directly. When either bracket is not open — a construction that started at
 * `ce.function()` boxes its first operand with no transaction open — the
 * operand goes through `box()` exactly as before, so the transaction's epoch
 * and clearing semantics are unchanged. (2) A `for` loop replaces
 * `Array.prototype.map` and its callback, two frames per level — which is why
 * this is not written as `ops.map(...)`. The choice between `boxInternal` and
 * `box` is made once, before the loop.
 *
 * The two hottest sites (`boxFunctionInternal`'s non-canonical tail and
 * `applyOperatorDefinition`'s canonical operands) inline this loop rather than
 * call it, saving this helper's own frame as well.
 */
function boxOperands(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput>,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression[] {
  const boxOne =
    ce._inferenceTxDepth > 0 && ce._boxingState.isRootActive
      ? boxInternal
      : box;
  const result: Expression[] = [];
  for (const x of ops) result.push(boxOne(ce, x, options));
  return result;
}

export function formToInternal(form?: FormOption): {
  canonical: CanonicalOptions;
  structural: boolean;
} {
  if (form === undefined || form === 'canonical')
    return { canonical: true, structural: false };
  if (form === 'raw') return { canonical: false, structural: false };
  if (form === 'structural') return { canonical: false, structural: true };
  // CanonicalForm or CanonicalForm[]
  return { canonical: form, structural: false };
}

/**
 * Resolve the internal `{ canonical, structural }` boxing form from the
 * options accepted by the public creation/parsing entry points
 * (`parse()`, `expr()`, `function()`).
 *
 * The canonical way to specify the form is the `form` option. As a
 * convenience — and to match the creation modes documented for these
 * methods — the `canonical` and `structural` boolean shortcuts are also
 * accepted. An explicit `form` takes precedence; otherwise `structural`
 * takes precedence over `canonical` (structural form is non-canonical but
 * bound).
 */
export function optionsToInternal(options?: {
  form?: FormOption;
  canonical?: CanonicalOptions;
  structural?: boolean;
}): { canonical: CanonicalOptions; structural: boolean } {
  if (!options) return { canonical: true, structural: false };
  const { form, canonical, structural } = options;
  if (form !== undefined) return formToInternal(form);
  if (structural === true) return { canonical: false, structural: true };
  if (canonical !== undefined) return { canonical, structural: false };
  return { canonical: true, structural: false };
}

function boxHold(
  ce: ComputeEngine,
  expr: ExpressionInput | null,
  options: { canonical?: CanonicalOptions }
): Expression {
  if (expr instanceof _BoxedExpression) return expr;

  expr = missingIfEmpty(expr as MathJsonExpression);

  if (typeof expr === 'string') return box(ce, expr, options);

  if (Array.isArray(expr)) {
    const [fnName, ...ops] = expr;
    return new BoxedFunction(
      ce,
      fnName,
      ops.map((x) => boxHold(ce, x, options)),
      { canonical: false }
    );
  }
  if (typeof expr === 'object') {
    if ('fn' in expr) return boxHold(ce, expr.fn, options);
    if ('str' in expr) return new BoxedString(ce, expr.str);
    if ('sym' in expr) return box(ce, expr.sym, options);
    if ('num' in expr) return box(ce, expr.num, options);
  }

  return box(ce, expr, options);
}

/**
 * Given a name and a set of arguments, return a boxed function expression.
 *
 * If available, preserve LaTeX and wikidata metadata in the boxed expression.
 *
 * This is also used internally when `box()` encounters a function expression.
 * The root repair guard is idempotent, so those nested calls join the existing
 * construction while a direct `ce.function()` call establishes one here.
 */
export function boxFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: readonly ExpressionInput[],
  options?: BoxFunctionOptions
): Expression {
  // Nested constructions join the active root repair — `withDevolveRepair`
  // would only hand `build()` straight back through `withRootRepair`. Call
  // through directly instead of via the two wrappers and a closure: this is
  // on the recursive path of every operand boxed, and each frame spent here
  // is stack a deep MathJSON tree cannot use (see `box()`).
  if (ce._boxingState.isRootActive)
    return boxFunctionInternal(ce, name, ops, options);
  return withDevolveRepair(ce, options?.scope, () =>
    boxFunctionInternal(ce, name, ops, options)
  );
}

type BoxFunctionOptions = {
  metadata?: Metadata;
  canonical?: CanonicalOptions;
  structural?: boolean;
  scope?: Scope;
};

/**
 * Stride for the canonicalization walk's deadline check (see
 * `boxFunctionInternal`), the idiom `common/interruptible.ts` documents.
 *
 * The walk is a plain recursion, not a generator, so `run()`/`runAsync()` —
 * which enforce a deadline BETWEEN yields — do not apply to it. Without an
 * in-walk check the deadline was honored only at the boundaries BETWEEN
 * canonicalization calls, so a single long walk ran to completion no matter
 * how small the budget: measured 2026-08-15, a 12 000-term sum parsed under
 * `ce.withTimeLimit({ ms: 1 })` ran 2 799 ms to completion — a 2 799×
 * overrun, and unbounded in the input size rather than the ~2× recorded when
 * the item was filed. A deadline is a correctness boundary, so an unbounded
 * overrun is a defect independent of how large today's workloads are.
 *
 * At the canonicalization cost measured above (~6.5 µs/node) 1024 nodes is
 * roughly 6 ms, so the residual overrun is bounded by one stride rather than
 * by the size of the input.
 */
const CANONICALIZE_DEADLINE_STRIDE = 0x3ff;

function boxFunctionInternal(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: readonly ExpressionInput[],
  options?: BoxFunctionOptions
): Expression {
  // A deadline frame is armed only by an enclosing `ce.withTimeLimit()` span,
  // so work outside a span pays one `undefined` comparison and nothing else.
  //
  // The stride counter lives ON THE FRAME, not in a module-level variable, so
  // it counts the nodes of the span that armed it and only those. A shared
  // counter would let a nested canonicalization on a DIFFERENT engine consume
  // stride boundaries — reachable, because a canonical handler runs arbitrary
  // caller code — at moments when the engine being checked has no frame armed;
  // the check is then a no-op and the engine that DOES have a budget waits up
  // to another full stride, so the one-stride bound above would not hold.
  const frame = ce._deadlineFrame;
  if (
    frame !== undefined &&
    ((frame.tick = (frame.tick ?? 0) + 1) & CANONICALIZE_DEADLINE_STRIDE) === 0
  )
    checkDeadline(frame);

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  if (!isValidSymbol(name)) {
    throw new Error(
      `Unexpected operator: "${name}" is not a valid symbol: ${validateSymbol(
        name
      )}`
    );
  }

  const structural = options.structural ?? false;

  // An operand that IS, or that transitively CONTAINS, an object from another
  // engine cannot be adopted into this engine's expression (see the same check
  // in `boxInternal`). In a session that has never constructed an object this
  // is a single boolean read for the whole operand list; only once an object
  // exists anywhere does the per-operand walk run.
  if (adoptsForeignEngineObject(ops, ce))
    return ce.error('object-foreign-engine');

  //
  // Hold
  //

  if (name === 'Hold') {
    return new BoxedFunction(ce, 'Hold', [boxHold(ce, ops[0], options)], {
      ...options,
      canonical: true,
      structural,
    });
  }

  //
  // Error
  //
  if (name === 'Error' || name === 'ErrorCode') {
    return new BoxedFunction(ce, name, boxOperands(ce, ops, RAW_OPERAND), {
      metadata: options?.metadata,
      canonical: true,
    });
  }

  //
  // Number
  //
  if (name === 'Number' && ops.length === 1) return box(ce, ops[0], options);

  const canonicalNumber = structural === false && options.canonical === true;

  // If canonical, handle cases of various expression structures being able to
  // be cast as BoxedNumbers (some cases of Negate, Rational, Divide, Complex),
  // or 'de-number' some 'borderline invalid' boxed number-like expressions
  // (!@note: this procedure is similarly repeated within the 'number'
  //  CanonicalForm, but the numberForm variant more simply applies to fully
  // BoxedExprs., and during partial canonicalization only)
  if (canonicalNumber) {
    //
    // Rational (as Divide)
    //
    if ((name === 'Divide' || name === 'Rational') && ops.length === 2) {
      const n = asBigint(ops[0]);
      if (n !== null) {
        const d = asBigint(ops[1]);
        if (d !== null) {
          // Handle division by zero: 0/0 = NaN, a/0 = ~∞
          if (d === 0n) return n === 0n ? ce.NaN : ce.ComplexInfinity;
          return ce.number([n, d], options);
        }
      }
      name = 'Divide';
    }

    //
    // Complex
    //
    if (name === 'Complex') {
      if (ops.length === 1) {
        // If single argument, assume it's imaginary
        const op1 = ops[0];
        if (op1 instanceof _BoxedExpression && op1.isNumberLiteral)
          return ce.number(ce.complex(0, op1.re), options);

        const im = machineValue(ops[0] as MathJsonExpression);
        if (im !== null && im !== 0)
          return ce.number(ce.complex(0, im), options);

        return ce.expr(op1).mul(ce.I);
      }
      if (ops.length === 2) {
        // Box the real operand so a high-precision bignum literal (e.g. a
        // 50-digit √2) is not truncated to a machine float. When the operand
        // arrives as raw MathJSON (`{ num: '1.414…' }`), reading `machineValue`
        // alone would silently discard the extra digits on re-boxing
        // (`ce.expr(z.json)`).
        const reOp =
          ops[0] instanceof _BoxedExpression
            ? ops[0]
            : box(ce, ops[0], options);
        const imOp =
          ops[1] instanceof _BoxedExpression
            ? ops[1]
            : box(ce, ops[1], options);

        // Exact components (integers, rationals, radicals) reconstruct an
        // EXACT complex value when the pair is representable (a Gaussian
        // rational, or a pure-imaginary radical). This is what makes
        // `ExactNumericValue.toJSON()` lossless: `['Complex', ['Rational',1,2], 3]`
        // re-boxes to the exact `1/2 + 3i`, not a machine float.
        {
          const reC = exactRealComponent(reOp);
          if (reC !== null) {
            const imC = exactRealComponent(imOp);
            if (imC !== null && !isZero(imC.rational)) {
              const reIsZero = isZero(reC.rational);
              if (
                (reIsZero || (reC.radical === 1 && imC.radical === 1)) &&
                imC.radical <= SMALL_INTEGER &&
                reC.radical <= SMALL_INTEGER
              )
                return ce.number(
                  ce._numericValue({
                    rational: reC.rational,
                    radical: reC.radical,
                    imRational: imC.rational,
                    imRadical: imC.radical,
                  }),
                  options
                );
            }
          }
        }

        const re = reOp.re;
        const im = imOp.re;
        if (im !== null && re !== null && !isNaN(im) && !isNaN(re)) {
          if (im === 0 && re === 0) return ce.Zero;
          if (im !== 0) {
            const bignumRe = reOp.bignumRe;
            return ce.number(
              ce._numericValue(
                bignumRe !== undefined ? { re: bignumRe, im } : { re, im }
              ),
              options
            );
          }
          return box(ce, ops[0], options);
        }
        return box(ce, ops[0], options).add(box(ce, ops[1], options).mul(ce.I));
      }
      throw new Error('Expected one or two arguments with Complex expression');
    }

    //
    // Negate
    //
    // Distribute over literals
    //
    if (name === 'Negate' && ops.length === 1) {
      const op1 = ops[0];
      if (typeof op1 === 'number') return ce.number(-op1, options);
      if (op1 instanceof BigDecimal) return ce.number(op1.neg(), options);
      const boxedop1 = ce.expr(op1, options);
      if (isNumber(boxedop1)) {
        const num = boxedop1.numericValue;
        return ce.number(typeof num === 'number' ? -num : num.neg(), options);
      }
      ops = [boxedop1];
    }
  }

  if (options.canonical === true)
    return makeCanonicalFunction(
      ce,
      name,
      ops,
      options.metadata,
      options.scope
    );

  // Inlined `boxOperands()` (see there for why): this is the recursive path
  // of every non-canonical operand, and even the helper's own call frame is
  // stack space a deep tree cannot afford.
  const operandOptions = {
    canonical: options.canonical,
    structural,
    scope: options.scope,
  };
  const boxOne =
    ce._inferenceTxDepth > 0 && ce._boxingState.isRootActive
      ? boxInternal
      : box;
  const boxedOps: Expression[] = [];
  for (const x of ops) boxedOps.push(boxOne(ce, x, operandOptions));
  return canonicalForm(
    new BoxedFunction(ce, name, boxedOps, {
      metadata: options.metadata,
      canonical: false,
      structural,
      scope: options.scope,
    }),
    options.canonical ?? false,
    options.scope
  );
}

/**
 * Notes about the boxed form:
 *
 * [1] MathJsonExpression with an operator of `Number`, `String`, `Symbol` and `Dictionary`
 *      are converted to the corresponding atomic expression.
 *
 * [2] Expressions with an operator of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 *     The precedence of `Complex` (for serialization) is sometimes the
 *     precedence of `Add` (when re and im != 0), sometimes the precedence of
 *    `Multiply` (when im or re === 0). Using a number or an explicit
 *    `Add`/`Multiply` expression avoids this ambiguity.
 *
 * [3] An expression with a `Rational` operator is converted to a rational
 *    number if possible, to a `Divide` otherwise.
 *
 * [4] A `Negate` function applied to a number literal is converted to a number.
 *
 *     Note that `Negate` is only distributed over addition. In practice, having
 * `Negate` factored on multiply/divide is more useful to detect patterns.
 *
 * Note that this function should only be called from `ce.expr()`
 *
 */

/**
 * Mark the start of a (possibly nested) boxing operation. While at least one
 * is in progress, `BoxedSymbol._infer()` records every value definition whose
 * type transitions unknown → concrete into `ce._freshlyInferred` — the
 * forward-computed provenance for `repairFreshMatrixInference`'s "first
 * inferred while canonicalizing this argument" eligibility test. This
 * replaced an eager snapshot of all inferred symbols (a walk over every
 * binding in every scope, per outermost box) that dominated the per-call
 * cost of small operations engine-wide.
 */
export function beginInferenceTransaction(ce: ComputeEngine): void {
  ce._inferenceTxDepth += 1;
  // A new OUTERMOST pass gets a new epoch; nested begins share the outer
  // pass's. Provenance entries stamp the current epoch so consumers can ask
  // "recorded by the pass running now?" in O(1) (`TypeProvenanceEntry.epoch`).
  if (ce._inferenceTxDepth === 1) ce._boxingEpoch += 1;
}

export function endInferenceTransaction(ce: ComputeEngine): void {
  ce._inferenceTxDepth -= 1;
  if (ce._inferenceTxDepth === 0) ce._freshlyInferred = null;
}

const EMPTY_FRESHLY_INFERRED: ReadonlySet<BoxedValueDefinition> = new Set();

/** Stringify an offending input for an error's context, truncating if huge.
 *  Never throws (JSON.stringify can fail on bigint or circular values). */
function stringifyForError(value: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (typeof s !== 'string') s = String(value);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

/**
 * Run `build`, redoing it once if the un-applied-operator repair invented a
 * binding while it ran.
 *
 * The repair (`devolveUnappliedOperator`, `validate.ts`) can declare a
 * variable for a builtin name PARTWAY through a construction: in `N, N+1` the
 * bare `N` binds the operator, and only the `N` of `N+1` devolves. The
 * occurrences boxed before the shadow existed keep the operator binding, so one
 * expression ends up denoting two different things by one name — and boxing the
 * same input again (as a serialize/parse round trip does) a third, which is why
 * byte-identical MathJSON could compare `isSame` false.
 *
 * Detect it and redo the construction, now that the binding the name should
 * have had all along exists. Nested unscoped constructions join the engine's
 * root construction; a scoped operator establishes its own repair frame and
 * rebuilds against the same scope.
 *
 * `build` must be free of side effects other than boxing: it is called twice.
 */
function withDevolveRepair(
  ce: ComputeEngine,
  scope: Scope | undefined,
  build: () => Expression
): Expression {
  // Nested constructions join the active root (withRootRepair returns
  // build() directly), so the persistence classifier below would be built
  // and discarded — skip the allocation on this per-node hot path.
  if (ce._boxingState.isRootActive)
    return ce._boxingState.withRootRepair(build);

  // Persistence classifier for the first-boxing binding-divergence repair
  // (`EngineBoxingState.noteDeclarationIn`): a scope outlives this
  // construction iff it is on a lexical chain that existed when the
  // construction began — the engine's current chain, or the caller-supplied
  // `scope` option's chain (a harvest scope from `ce.createScope()` is
  // persistent but not on the engine's chain). Scopes created DURING the
  // construction (a binder body's scope) are parented onto these chains but
  // never members of them. Walking at query time sees the same chains that
  // existed at capture time: scopes created during canonicalization never
  // reparent, and the engine's one reparenting site (nullary-closure
  // invocation in `function-utils.ts`, which swaps a stored closure body
  // scope's parent around an evaluation call and restores it in a `finally`)
  // targets closure-owned scopes, not the pre-existing lexical chains
  // captured here.
  const bases: Scope[] = [ce.context.lexicalScope];
  if (scope !== undefined) bases.push(scope);
  return ce._boxingState.withRootRepair(build, (s) => {
    for (const base of bases) {
      // A chain may terminate with `parent: undefined` rather than `null`
      // (`pushScope` builds scopes with `ce.context?.lexicalScope`), so test
      // truthiness, not `!== null`.
      let cur: Scope | null | undefined = base;
      while (cur) {
        if (cur === s) return true;
        cur = cur.parent;
      }
    }
    return false;
  });
}

/**
 * The half of the repair a rebuild cannot do on its own: an operand the caller
 * had ALREADY boxed (`ce.function('Tuple', [ce.box('N'), ['Add', 'N', 1]])`)
 * is canonical, so it passes through boxing unchanged and keeps the operator
 * binding it got before the shadow existed — one expression again denoting two
 * things by one name.
 *
 * On a rebuild only, re-resolve such an operand against the shadow. The
 * caller's expression is never mutated: the rebinding is a fresh symbol in the
 * OUTPUT tree.
 *
 * Returns `null` when the operand is not a stale un-applied operator.
 */
function rebindDevolvedSymbol(
  ce: ComputeEngine,
  expr: Expression,
  scope: Scope | undefined
): Expression | null {
  if (!isSymbol(expr)) return null;
  // An un-applied OPERATOR binding is what the repair replaces. A symbol bound
  // to a value is either the shadow already (nothing to do) or a declaration
  // the repair never touches.
  if (!expr.operatorDefinition) return null;

  const name = expr.symbol;
  let s: Scope | null = scope ?? ce.context.lexicalScope;
  while (s && !s.bindings.has(name)) s = s.parent;
  const def = s?.bindings.get(name);
  // Same provenance check as `devolveUnappliedOperator` (`validate.ts`): only
  // a shadow the repair itself created is a rebinding target.
  if (!def || !isValueDef(def) || !def.value._isDevolvedShadow) return null;

  return ce._inScope(scope, () => ce.expr(name));
}

export function box(
  ce: ComputeEngine,
  expr: null | undefined | NumericValue | ExpressionInput,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression {
  beginInferenceTransaction(ce);
  try {
    // Once a root repair is active (i.e. this is an operand of an enclosing
    // construction), `withDevolveRepair` degenerates to calling `build()`.
    // Skip the wrappers: boxing recurses once per level of the MathJSON tree,
    // and the number of stack frames per level bounds how deep a tree can be
    // boxed at all (a left-nested `Subtract` chain from parsing `1-2-3-…`, or
    // `Sin(Sin(…))`, overflows the stack past a few hundred levels).
    if (ce._boxingState.isRootActive) return boxInternal(ce, expr, options);
    return withDevolveRepair(ce, options?.scope, () =>
      boxInternal(ce, expr, options)
    );
  } finally {
    endInferenceTransaction(ce);
  }
}

function boxInternal(
  ce: ComputeEngine,
  expr: null | undefined | NumericValue | ExpressionInput,
  options?: {
    canonical?: CanonicalOptions;
    structural?: boolean;
    scope?: Scope;
  }
): Expression {
  if (expr === null || expr === undefined) return ce.error('missing');

  if (expr instanceof NumericValue) return fromNumericValue(ce, expr);

  if (expr instanceof _BoxedExpression) {
    // An object belongs to the engine that constructed it — its pinned type,
    // its state events and its cache dependencies all speak to that engine —
    // so adopting a foreign one here would produce an expression whose
    // invalidation is wired to the wrong place. This route adopts the
    // pre-boxed expression WHOLE, so the check has to be transitive: a `List`
    // or dictionary holding a foreign object is not itself an object, yet
    // adopting it retains the object all the same. Refuse as a value, the
    // errors-as-values convention of every expression route.
    if (adoptsForeignEngineObject([expr], ce))
      return ce.error('object-foreign-engine');

    // While rebuilding after a devolved shadow, an operand boxed before the
    // shadow existed still carries the stale operator binding (see
    // `rebindDevolvedSymbol`). A normal pass never asks.
    const rebound = ce._boxingState.isRebuilding
      ? rebindDevolvedSymbol(ce, expr, options?.scope)
      : null;
    // The common case — full canonical form, no scope — is exactly the
    // `.canonical` getter; `canonicalForm()` would only add a frame on the
    // recursive path of canonicalizing an already-boxed tree.
    const forms = options?.canonical ?? true;
    if (forms === true && options?.scope === undefined)
      return (rebound ?? expr).canonical;
    return canonicalForm(rebound ?? expr, forms, options?.scope);
  }

  options = options ? { ...options } : {};
  if (!('canonical' in options)) options.canonical = true;

  // If canonical is true, we want to canonicalize the arguments
  // If it's false or a CanonicalForm, we don't want to canonicalize the
  // arguments during create, we'll call canonicalForm to take care of it
  const canonical = options.canonical === true;

  const structural = options.structural ?? false;

  //
  //  Box a function
  //
  if (Array.isArray(expr)) {
    if (typeof expr[0] !== 'string') {
      // A function-literal head (or any boxed/array expression head) is
      // treated as an application, e.g.
      //   [["Function", body, "x"], arg] ≡ ["Apply", ["Function", body, "x"], arg]
      // This matches the explicit `Apply` form, which already beta-reduces.
      if (Array.isArray(expr[0]) || expr[0] instanceof _BoxedExpression)
        return box(ce, ['Apply', ...expr] as ExpressionInput, options);

      // Malformed MathJSON: the head of a function array must be a string,
      // an array (function-literal head) or a boxed expression. Return an
      // Error expression rather than throwing so callers boxing untrusted
      // input never have to special-case a JS exception.
      return ce.error('unexpected-mathjson', stringifyForError(expr));
    }

    // `boxFunction()` is only a root-repair dispatcher; with the root
    // already active it would call `boxFunctionInternal()` straight back, so
    // skip its frame (boxing recurses once per level, see `box()`).
    return canonicalForm(
      (ce._boxingState.isRootActive ? boxFunctionInternal : boxFunction)(
        ce,
        expr[0],
        expr.slice(1) as ExpressionInput[],
        { canonical, structural, scope: options?.scope }
      ),
      options?.canonical ?? true,
      options?.scope
    );
  }

  //
  // Box a number
  //
  // `bigint` is part of `ExpressionInput` and preserves exact integer-ness
  // regardless of magnitude or engine precision (a large integer literal
  // routed through a float would silently become inexact).
  if (
    typeof expr === 'number' ||
    typeof expr === 'bigint' ||
    expr instanceof BigDecimal ||
    expr instanceof Complex
  )
    return ce.number(expr);

  //
  // Box a boolean primitive as the True/False symbol.
  // Tensors with `dtype: 'bool'` store JS booleans directly, so `.each()`
  // and `.at()` over such a tensor need this case to yield usable
  // symbolic values. Mirrors the `boolean → True/False` mapping in
  // `jsValueToExpression`.
  //
  if (typeof expr === 'boolean') return ce.symbol(expr ? 'True' : 'False');

  //
  // Box a String, a Symbol or a number as a string shorthand
  //
  if (typeof expr === 'string') {
    // Is it a symbol?
    if (matchesSymbol(expr)) {
      const sym = symbol(expr);
      if (!sym || !isValidSymbol(sym)) return ce.error('invalid-symbol', expr);
      // Let 'partial' canonicalization fetch the canonical variant of symbols: in order that at
      // minimum, they may be substituted with associated definition values (when its def. 'holdUntil'
      // is 'never')
      // @note: alternatively, this could be signalled by a 'Symbol' CanonicalForm: but this way is
      // more predictable, & ensures substitution as per above
      // A partial form resolves symbols but never DECLARES them: its output is
      // not fully canonical, so it follows the structural symbol contract and
      // leaves the caller's scope untouched (`autoDeclare: false`).
      const canonicalSymbol = canonical || options.canonical !== false;
      return ce.symbol(sym, {
        canonical: canonicalSymbol,
        autoDeclare: canonical,
      });
    }

    if (matchesNumber(expr)) return ce.number(expr);

    // Must be a string...
    console.assert(matchesString(expr));
    return new BoxedString(ce, stringValue(expr)!);
  }

  //
  // Box a MathJSON object literal
  //
  if (typeof expr === 'object') {
    // Extract metadata (latex, wikidata) from the MathJSON object if present
    const metadata = hasMetaData(expr as ExpressionObject)
      ? {
          latex: (expr as ExpressionObject & { latex?: string }).latex,
          wikidata: (expr as ExpressionObject & { wikidata?: string }).wikidata,
          sourceOffsets: (
            expr as ExpressionObject & {
              sourceOffsets?: [start: number, end: number];
            }
          ).sourceOffsets,
        }
      : undefined;

    if ('fn' in expr) {
      const [fnName, ...ops] = expr.fn;
      return canonicalForm(
        (ce._boxingState.isRootActive ? boxFunctionInternal : boxFunction)(
          ce,
          fnName,
          ops,
          { canonical, structural, metadata }
        ),
        options.canonical!,
        options.scope
      );
    }
    if ('str' in expr) return new BoxedString(ce, expr.str, metadata);
    if ('sym' in expr) return ce.symbol(expr.sym, { canonical, metadata });
    if ('num' in expr) return ce.number(expr, { canonical, metadata });
    if ('dict' in expr)
      return new BoxedDictionary(ce, expr.dict, { canonical });

    // Not a recognized MathJSON object (no 'fn'/'str'/'sym'/'num'/'dict'
    // key). Return an Error expression rather than throwing so callers
    // boxing untrusted input never have to special-case a JS exception.
    return ce.error('unexpected-mathjson', stringifyForError(expr));
  }

  return ce.symbol('Undefined');
}

/**
 * True when every declared parameter of a signature (required, optional and
 * variadic) is a numeric type (a subtype of `number`). Used to restrict the
 * post-canonical argument re-validation in `makeCanonicalFunction` to the
 * pure-numeric operators (`Sin`, `Factorial`, …) whose custom canonical
 * handlers historically only checked arity. A signature with no parameters, or
 * any non-numeric parameter, returns `false` so structural/higher-order
 * operators are left untouched.
 */
function allParamsNumeric(signature: Type): boolean {
  if (typeof signature === 'string') return false;
  if (signature.kind !== 'signature') return false;
  const params: Type[] = [
    ...(signature.args?.map((x) => x.type) ?? []),
    ...(signature.optArgs?.map((x) => x.type) ?? []),
    ...(signature.variadicArg ? [signature.variadicArg.type] : []),
  ];
  if (params.length === 0) return false;
  return params.every((t) => isSubtype(t, 'number'));
}

/**
 * The parameter types an operand at position `idx` could be bound to by a
 * value definition's declared signature — one entry per overload arm (a
 * single entry for a plain signature). Empty when the position is beyond
 * every arm's parameters (an arity error, diagnosed elsewhere).
 */
function candidateParamsAt(valueType: Type, idx: number): Type[] {
  const arms: ReadonlyArray<FunctionSignature> =
    typeof valueType !== 'string' && valueType.kind === 'signature'
      ? [valueType]
      : (overloadArms(valueType) ?? []);

  const result: Type[] = [];
  for (const arm of arms) {
    const args = arm.args ?? [];
    const optArgs = arm.optArgs ?? [];
    if (idx < args.length) result.push(args[idx].type);
    else if (idx < args.length + optArgs.length)
      result.push(optArgs[idx - args.length].type);
    else if (arm.variadicArg) result.push(arm.variadicArg.type);
  }
  return result;
}

/**
 * The `threadable` gate `validateArguments` must see for `sig`.
 *
 * `whenUndeclared` is the pre-existing signature-wide answer (the
 * `opDef.broadcastable` flag, or `paramsAreScalar` on the value-definition
 * route); it is returned unchanged for every signature that declares no
 * `broadcastable<T>` parameter, which is every built-in and every inferred
 * lambda.
 *
 * A signature that DOES declare one answers PER POSITION (Option A,
 * `docs/plans/2026-08-08-broadcastable-param-semantics.md`): the slots the
 * declaration maps elementwise admit a collection operand — the contract is
 * checked per ELEMENT, where the elements exist — while a sibling slot that
 * binds its argument WHOLE (`list<…>`, `tuple<…>`, a callback) is validated
 * exactly as it would be without the declaration. A signature-wide `true`
 * there admitted a collection at every slot unchecked.
 */
function threadableGate(sig: Type, whenUndeclared: boolean): Threadable {
  const plan = broadcastableParamSlots(sig);
  if (plan === undefined) return whenUndeclared;
  // A `broadcastable: true` OPERATOR (an arithmetic builtin) threads
  // everywhere it always did; the plan only ever adds slots.
  return whenUndeclared ? true : (i: number) => plan.at(i).mappable;
}

/**
 * The types to annotate an inline callback literal's parameters with, given
 * the type DECLARED for the slot the literal occupies — or `undefined` when
 * the slot is not a concrete arrow type and carries no information.
 *
 * The bare `function` primitive is a string type, so it declines here — a
 * built-in callback slot spelled that way carries no parameter types. A GENERIC
 * arrow (`(T) -> boolean where T`) also declines: its quantified positions
 * are not types a literal can be annotated with, and instantiating them is the
 * contextual solve's job.
 *
 * Admission is untouched by the stamp either way: an arrow slot admits by
 * COMPATIBILITY (Design E §3,
 * `docs/TYPE-SYSTEM.md`), and what is
 * annotated here is the author's own declared contract.
 */
function declaredCallbackParamTypes(t: Type): DeclaredCallbackSlot | undefined {
  const sig = t;
  if (typeof sig === 'string' || sig.kind !== 'signature') return undefined;
  if (sig.typeParams !== undefined && sig.typeParams.length > 0)
    return undefined;
  const args = sig.args;
  if (args === undefined || args.length === 0) return undefined;
  // A plain arrow is an explicit author-written contract and keeps the wider
  // `concreteCallbackParamType` gate (the contextual-solve path applies its
  // own `admissibleElementType` gate to what it stamps).
  const types = args.map((arg) => concreteCallbackParamType(arg.type));
  if (!types.some((x) => x !== undefined)) return undefined;
  // The declared slot's CONSUMPTION arity: its required parameters, optionally
  // through its optional ones, and unbounded when it declares a variadic tail.
  // Only the required positions are stamped — an optional or variadic
  // parameter's type is not read here — but a literal that supplies them is
  // still correctly paired and must not be turned away.
  //
  // A `+` tail (`variadicMin === 1`) demands at least one occurrence, so it
  // raises the MINIMUM too — the spelling `validateArguments` and the
  // arity diagnostic both read (`sig.variadicMin ?? 0`). Without it a
  // `(integer, string+)` slot admitted a unary literal and stamped it.
  return {
    types,
    required: args.length + (sig.variadicMin ?? 0),
    max:
      sig.variadicArg !== undefined
        ? Infinity
        : args.length + (sig.optArgs?.length ?? 0),
  };
}

/** A declared callback slot the signature-driven trigger will stamp: the
 * parameter types to write, positionally, plus the literal arities that pair
 * with them ({@link declaredCallbackParamTypes}). */
type DeclaredCallbackSlot = {
  types: ReadonlyArray<Type | undefined>;
  required: number;
  max: number;
};

/** A declared callback-parameter type that is worth stamping on a literal, or
 * `undefined`. Only positive evidence qualifies: `unknown`/`any` say nothing,
 * and a `broadcastable<T>` slot is a callee-side APPLICATION contract
 * (2026-08-08 broadcastable-param ruling) — stamping it on a literal would
 * give it an elementwise contract its author never wrote. The containment test
 * is on the SPELLING so a nested occurrence declines too; a false positive
 * only means "no annotation", which is the safe direction. */
function concreteCallbackParamType(t: Type): Type | undefined {
  if (t === 'unknown' || t === 'any') return undefined;
  if (typeToString(t).includes('broadcastable')) return undefined;
  return t;
}

/**
 * The SIGNATURE-driven trigger of the per-application element-type inference
 * (`docs/TYPE-SYSTEM.md`, ruling 1): a
 * callee whose signature declares a concrete arrow-typed parameter annotates
 * an INLINE `Function` literal passed at that position with the declared
 * parameter types — a plain concrete arrow (see
 * {@link declaredCallbackParamTypes}). This is what the mechanism offers
 * USER-DEFINED functions; no library signature qualifies, every converted
 * library slot being a POLYTYPE that takes the contextual route below.
 *
 * Runs before any operand is boxed and before any operand type is read, so the
 * literal is canonicalized ONCE, already annotated — exactly as the
 * hand-annotated spelling would be.
 *
 * An OVERLOAD set is skipped: resolution happens after this hook and the
 * annotation would itself feed the resolution. The one exception is R-D4
 * resolve-then-stamp — an arm that declares a contextual arrow slot — since a
 * contextual stamp is decided by the DECLARED slot, never by the operand's own
 * type, so it cannot feed the resolution it follows.
 */
function annotateCallbacksFromSignature(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput>,
  sigType: Type | undefined
): ReadonlyArray<ExpressionInput> {
  if (sigType === undefined || typeof sigType === 'string') return ops;
  const arms = overloadArms(sigType);
  if (arms !== undefined) {
    // R-D4 (§9, ruled 2026-08-09): resolve the arm FIRST, then stamp against
    // the resolved one alone. A set no arm of which declares a contextual slot
    // — every user-defined overload set — resolves to nothing and keeps the
    // ratified conservative skip.
    const arm = resolveContextualArm(arms, ops.length);
    if (arm === undefined) return ops;
    return annotateCallbacksFromContextualSolve(ce, ops, arm);
  }
  if (sigType.kind !== 'signature') return ops;
  // A POLYMORPHIC callee takes the CONTEXTUAL route instead (Design D): its
  // parameter types mention the variables its own `where` clause binds, so
  // stamping one verbatim would leave `T` unresolved outside that scope (or
  // capture an unrelated nominal type of the same name). Only a contextual
  // slot is contextually typed there, and only after `S` has been
  // instantiated from the sibling operands.
  if (sigType.typeParams !== undefined && sigType.typeParams.length > 0)
    return annotateCallbacksFromContextualSolve(ce, ops, sigType);

  return annotateFromDeclaredParams(ce, ops, sigType);
}

/**
 * The stamp read straight off a signature's DECLARED parameter slots, with no
 * solve: each supplied operand's parameter is read for callback parameter types
 * ({@link declaredCallbackParamTypes}) and an inline `Function` literal there is
 * annotated with them.
 *
 */
function annotateFromDeclaredParams(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput>,
  sig: FunctionSignature
): ReadonlyArray<ExpressionInput> {
  let result: ExpressionInput[] | undefined;
  for (let i = 0; i < ops.length; i++) {
    // The parameter each SUPPLIED operand binds to: required, then optional,
    // then variadic — `paramAt` mirrors `validateArguments`' consumption
    // order, so a concrete arrow type in an optional or variadic position
    // triggers exactly like a required one.
    const param = paramAt(sig, i);
    if (param === undefined) break;
    const slot = declaredCallbackParamTypes(param);
    if (slot === undefined) continue;
    // The raw box is taken here rather than left to
    // `annotateFunctionLiteralParams` (whose own discrimination is the same
    // three tests) so that the ARITY GUARD below has the literal to measure.
    const raw = inlineLiteral(ce, ops[i]);
    if (raw === undefined) continue;
    // ARITY GUARD, the contextual route's (§5 step 3) applied to this one: the
    // stamp pairs the literal's parameters with the declared ones
    // POSITIONALLY, so a literal of the wrong arity would take a PARTIAL stamp
    // — a declared `(integer) -> boolean` slot annotating the `a` of
    // `(a, b) => a > b` and leaving `b` bare. The whole stamp declines
    // instead. Evaluation is unchanged either way (the arity error dominates);
    // what this buys is that a declined application carries no half-written
    // contract.
    const arity = isFunction(raw) ? raw.nops - 1 : 0;
    if (arity < slot.required || arity > slot.max) continue;
    const literal = annotateFunctionLiteralParams(ce, raw, slot.types);
    if (literal === undefined) continue;
    result ??= [...ops];
    result[i] = literal;
  }
  return result ?? ops;
}

/**
 * The CONTEXTUAL-CALLBACK trigger (`docs/TYPE-SYSTEM.md`): a POLYMORPHIC
 * callee with a
 * contextual arrow slot annotates an INLINE `Function` literal at that slot with
 * `S`'s parameter types, instantiated from the sibling operands.
 *
 * The five steps of §5, in the spec's numbering:
 *
 * 1. **canonicalize** ONLY the operands that contribute constraints — the
 *    non-callback positions mentioning a variable `S`'s parameters read
 *    ({@link contextualCallbackPlan}'s `sources`), to read their types: the
 *    operands arrive unboxed here, and on the lazy path they would otherwise
 *    never bind. The canonical form is substituted back so the operator's own
 *    handler reuses it;
 * 2. **solve** the callback-DOMAIN variables from those sources alone
 *    ({@link instantiateCallbackSlots});
 * 3. **rebuild** each inline literal with the instantiated parameter types,
 *    per parameter, through the {@link admissibleElementType} gate (inherited
 *    verbatim from the `callbackElementOf` metadata trigger this replaced);
 * 4. **result-side** variables are solved from the callback's own type — NOT
 *    this pass: they are left open here and fall to ordinary validation;
 * 5. **validate** proceeds normally — where an arrow slot admits by
 *    COMPATIBILITY (Design E §3), broad in exactly the way a bare slot
 *    exactly what the primitive `function` admits (§4 clause 1).
 *
 * The discrimination that precedes step 1 (does the arm declare a slot, does
 * any operand hold a stampable literal) is not one of the five steps: it is
 * the guard that keeps the shared-symbol and shorthand spellings free, as the
 * retired metadata trigger's own guard did.
 *
 * Runs before ANY operand is boxed, so the literal canonicalizes ONCE, already
 * annotated — the same contract as
 * {@link annotateCallbacksFromSignature}, the other surviving trigger.
 */
function annotateCallbacksFromContextualSolve(
  ce: ComputeEngine,
  ops: ReadonlyArray<ExpressionInput>,
  arm: FunctionSignature
): ReadonlyArray<ExpressionInput> {
  // Discriminate FIRST, in strictly increasing cost, so an application with no
  // stampable literal at all — the overwhelmingly common case, including every
  // symbol/operator-name callback — pays only allocation-free checks:
  //
  //  a. does the arm even DECLARE a contextual slot (a field scan);
  //  b. does any operand LOOK like an inline literal (a syntactic scan of the
  //     unboxed inputs — no boxing, no type read);
  //  c. only then plan the slots and their sources (allocates), and only then
  //     raw-box the callback operands to answer (b) exactly.
  //
  // Ordering matters: `contextualCallbackPlan` allocates per parameter
  // position, and before this the shared-symbol spelling paid for a plan it
  // could never use.
  if (!hasCallbackParam(arm)) return ops;
  if (!ops.some(mayBeInlineFunctionLiteral)) return ops;

  // The `hasCallbackParam` answer is threaded in: the planning pass opens with
  // the same field scan, and on the overload route `resolveContextualArm` has
  // already run it a third time.
  const plan = contextualCallbackPlan(arm, ops.length, true);
  if (plan === undefined) {
    // No plan: the arm's arrow slots have no domain variables to solve. A
    // MONOMORPHIC arm — an overload-set arm reached through
    // `resolveContextualArm` — stamps its concrete arrow slots straight off
    // the declaration, exactly as the identical standalone signature does;
    // without this, an overload arm silently stamped nothing (the Design D
    // ground-`S` fallback, inherited by the arrow spelling). A POLYMORPHIC
    // arm's ground arrow slot deliberately declines: pre-Design-E plain
    // arrows in polytype arms never stamped on this route, and
    // `declaredCallbackParamTypes` cannot judge which of the arm's own
    // `where`-bound variables its sibling slots mention.
    if (arm.typeParams === undefined || arm.typeParams.length === 0)
      return annotateFromDeclaredParams(ce, ops, arm);
    return ops;
  }

  // The raw box is computed ONCE per slot here and threaded into the stamp
  // below. `annotateFunctionLiteralParams` still re-boxes what it is given —
  // but on an already-raw `Expression` that call is the identity, so what this
  // buys is the ARITY GUARD below, which needs this exact expression before the
  // stamp runs.
  const stampable: { slot: CallbackSlot; raw: Expression }[] = [];
  for (const slot of plan.callbacks) {
    const op = ops[slot.index];
    if (op === undefined) continue;
    // The syntactic scan again, per slot: `Map`'s variadic clause puts a
    // SOURCE at the slot position, and raw-boxing one only to discard it is
    // work every multi-collection `Map` would otherwise pay.
    if (!mayBeInlineFunctionLiteral(op)) continue;
    const raw = inlineLiteral(ce, op);
    if (raw !== undefined) stampable.push({ slot, raw });
  }
  if (stampable.length === 0) return ops;

  let result: ExpressionInput[] | undefined;

  // §5 step 1: canonicalize only the operands the solve needs, and hand the
  // CANONICAL form onward (canonical-of-canonical is the identity, so the
  // operator's own operand check does not redo the work).
  const actuals: (Type | undefined)[] = new Array(ops.length).fill(undefined);
  for (const i of plan.sources) {
    const src = ops[i];
    if (src === undefined) continue;
    const canonicalSrc =
      src instanceof _BoxedExpression ? src.canonical : ce.expr(src);
    if (canonicalSrc !== src) {
      result ??= [...ops];
      result[i] = canonicalSrc;
    }
    actuals[i] = resolveType(canonicalSrc.type.type);
  }

  // §5 step 2 + step 3.
  const instantiated = instantiateCallbackSlots(arm, plan, actuals);
  for (const { slot, raw } of stampable) {
    const s = instantiated.get(slot.index);
    if (s === undefined) continue;
    // A VARIADIC contextual arrow (`(T+) any -> U` as a SLOT) would pair one
    // parameter with N sources. No converted signature spells one — `Map`'s
    // variadic (zip) clause deliberately declares no contextual slot — and a
    // slot that did spell one declines outright rather than stamping a
    // guess.
    if (s.variadicArg !== undefined) continue;
    // ARITY GUARD: the stamp pairs the literal's parameters with `S`'s
    // POSITIONALLY, so a literal of the wrong arity would take a PARTIAL stamp
    // — `Filter(cs, (a, b) => a > b)` annotating `a` alone. The whole stamp
    // declines instead. Evaluation is unchanged either way (the arity error
    // dominates); what this buys is that a declined application carries no
    // half-written contract. The admissible range is `S`'s consumption arity:
    // required parameters, optionally through the optional ones.
    const required = s.args?.length ?? 0;
    const arity = isFunction(raw) ? raw.nops - 1 : 0;
    if (arity < required || arity > required + (s.optArgs?.length ?? 0))
      continue;
    const paramTypes = [...(s.args ?? []), ...(s.optArgs ?? [])].map((arg) =>
      stampableParamType(arg.type)
    );
    if (!paramTypes.some((x) => x !== undefined)) continue;
    const literal = annotateFunctionLiteralParams(ce, raw, paramTypes);
    if (literal === undefined) continue;
    result ??= [...ops];
    result[slot.index] = literal;
  }

  return result ?? ops;
}

/** Could `op` be an inline `Function` literal? A purely SYNTACTIC test on the
 * UNBOXED operand — no boxing, no type read — used to skip the whole
 * contextual pass before it allocates anything. Conservative by construction:
 * it may answer `true` for an operand {@link inlineLiteral} then declines (an
 * already-canonical literal, a `["Function", body]` shorthand), never `false`
 * for one it would accept. Nothing else in `ExpressionInput` — a number, a
 * string, a symbol/number/string/dictionary object literal — can raw-box to a
 * `Function`. */
function mayBeInlineFunctionLiteral(op: ExpressionInput): boolean {
  if (op instanceof _BoxedExpression) return op.operator === 'Function';
  if (Array.isArray(op)) return op[0] === 'Function';
  if (typeof op === 'object' && op !== null && 'fn' in op)
    return (op as { fn: ReadonlyArray<unknown> }).fn[0] === 'Function';
  return false;
}

/** `op` raw-boxed when it is an INLINE `Function` literal with an explicit
 * parameter list — the one operand shape a contextual stamp rewrites — and
 * `undefined` otherwise. Answered on the ORIGINAL operand, raw-boxed: an
 * already-canonical literal is never rewritten, a symbol callback is shared and
 * never rebuilt (`canonicalFunctionLiteral` would LIFT one into a literal,
 * which is why this must not use it), and a `["Function", body]` shorthand has
 * no parameter list to stamp. The box is RETURNED rather than discarded — the
 * stamp needs this exact expression. */
function inlineLiteral(
  ce: ComputeEngine,
  op: ExpressionInput
): Expression | undefined {
  const raw = ce.expr(op, { form: 'raw' });
  if (raw.isCanonical || !isFunction(raw, 'Function') || raw.nops < 2)
    return undefined;
  return raw;
}

/** An instantiated contextual arrow parameter type this trigger will stamp, or
 * `undefined`. The gate is {@link admissibleElementType}'s — including the
 * PERMANENT union exclusion — plus the ground-type invariant: a parameter
 * still mentioning a variable the solve could not pin says nothing about an
 * element, so it stays bare. */
function stampableParamType(t: Type): Type | undefined {
  if (freeTypeVariables(t).size > 0) return undefined;
  const resolved = resolveType(t);
  return admissibleElementType(resolved) ? t : undefined;
}

/** The signature to read a callee's declared callback slots from, for a
 * function-typed VALUE definition. A bare-`function` wildcard declaration
 * carries no parameter types and deliberately stays that way through
 * assignment, so the assigned value's own signature is the only one there is
 * — the same source the narrowing sink below reads. */
function calleeSignatureType(def: BoxedValueDefinition): Type | undefined {
  if (isWildcardFunctionType(def.type.type)) return def.value?.type.type;
  return def.type.type;
}

/** A `Spread` operand makes the final positional operands unknown until
 * evaluation, so a positional callback rewrite cannot be trusted. Answered on
 * the UNBOXED operand — the hook runs before anything is boxed. */
function isSpreadOperand(x: ExpressionInput): boolean {
  if (x instanceof _BoxedExpression) return x.operator === 'Spread';
  if (Array.isArray(x)) return x[0] === 'Spread';
  if (typeof x === 'object' && x !== null && 'fn' in x)
    return (x as { fn: ReadonlyArray<unknown> }).fn[0] === 'Spread';
  return false;
}

/** The CONCRETE scalar primitives {@link admissibleElementType} admits: the
 * numeric types plus `boolean`, `character`, `string` and `color`. Every other
 * primitive —
 * the abstract supertypes (`scalar`, `value`, `expression`, …), the bare
 * composite names (`'tuple'`, `'collection'`, …) and `unknown`/`any`/`never` —
 * declines.
 *
 * `color` is a leaf primitive with no subtypes of its own (it is not in
 * `SCALAR_TYPES`, but only because `scalar` does not cover it), so the
 * union-like exclusion rationale below does not apply to it.
 */
const ADMISSIBLE_ELEMENT_PRIMITIVES: ReadonlySet<string> = new Set<string>([
  ...NUMERIC_TYPES,
  'boolean',
  // `character` is a concrete leaf scalar (one grapheme cluster, no subtypes)
  // and is the ELEMENT type of every string, so it is the type a callback
  // parameter over a string source — or over `Characters(s)` — deserves.
  'character',
  'string',
  'color',
  // `regexp` for exactly the reason `color` is here: a leaf primitive with no
  // subtypes, outside `SCALAR_TYPES` only because `scalar` does not cover it.
  // A callback over a `list<regexp>` deserves the same contextual element
  // stamp a `list<color>` gets.
  'regexp',
  // `type` (a reified type expression) is another such leaf: a callback over
  // a `list<type>` deserves the same contextual element stamp.
  'type',
]);

/**
 * The admission gate of the contextual stamp (ruling 4, widened 2026-08-09;
 * inherited unchanged from the `callbackElementOf` metadata trigger it
 * outlived): an element type this mechanism will stamp on a callback
 * parameter.
 *
 * Admits a CONCRETE type — a concrete scalar primitive (a numeric type,
 * `boolean` or `string`) or a parameterized structured kind (a tuple or a
 * collection node). Rejects everything that is not evidence about a single
 * element:
 *
 * - a UNION (even of tuples) — PERMANENTLY (ruled 2026-08-09). One
 *   annotation cannot express "each element satisfies its own arm":
 *   stamping the union makes a body that is valid for SOME arms fail once,
 *   at canonicalization, for the whole application — where the
 *   un-annotated program errors per element, which is the published Epsil
 *   "errors are values" behavior. And that un-annotated behavior IS the
 *   ruled per-element semantics: interpretation is value-directed, so the
 *   arm an element "satisfies" is its value and evaluation under it is
 *   ordinary evaluation. A union derived from the source's own element
 *   type is vacuously unviolatable, so admission would buy only a
 *   displayed signature — at the price of the published output (strict
 *   stamping) or a second annotation kind that breaks hand-annotation
 *   equivalence and serialization round-trip (loose stamping). Unions are
 *   explicit-contract-only: the signature-driven trigger admits them
 *   because an author wrote them; this trigger never will because no one
 *   did. (Design record: the union section of
 *   docs/TYPE-SYSTEM.md.)
 * - an ABSTRACT supertype — `scalar`, `value`, `expression`, `symbol`,
 *   `missing`, … These are union-like (`scalar` covers number, boolean and
 *   string), so stamping one poisons the whole application at
 *   canonicalization exactly as a written-out union does, even when every
 *   element is fine.
 * - a BARE composite NAME (`'tuple'`, `'list'`, `'collection'`, …): positive
 *   structural evidence requires a parameterized node, not a name that says
 *   only "some tuple, of some arity, of some element types".
 * - `unknown`/`any` (already excluded upstream) and `never`: the top and the
 *   bottom say nothing about an element. `never` is the element type of an
 *   EMPTY literal collection, and stamping it would make `Filter([], …)` a
 *   type error.
 * - every other kind — a signature, a type variable, a negation: not a type a
 *   literal's parameter can be annotated with here.
 *
 * Scalar admission is safe since follow-up (1): the Map fusion / exact-compile
 * gate now accepts an annotated parameter whose annotation the source's
 * element type provably satisfies (`annotationSatisfiedBySource` in
 * `map-broadcast-shape.ts`), so the fast paths survive the annotation instead
 * of falling out of it.
 *
 * The signature-driven trigger is deliberately NOT gated this way — a
 * user-declared arrow parameter is an explicit contract, whatever its types.
 */
function admissibleElementType(t: Type): boolean {
  if (typeof t === 'string') return ADMISSIBLE_ELEMENT_PRIMITIVES.has(t);
  switch (t.kind) {
    case 'tuple':
    case 'list':
    case 'set':
    case 'dictionary':
    case 'record':
    case 'collection':
    case 'indexed_collection':
      return true;
    default:
      return false;
  }
}

function makeCanonicalFunction(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<ExpressionInput>,
  metadata: Metadata | undefined,
  scope: Scope | undefined
): Expression {
  // Ambient inference-cause context: while this operator canonicalizes, any
  // `_infer()` write onto a definition records THIS expression as the cause
  // of the write in the definition's provenance history (`_noteInferenceWrite`
  // in `index.ts`). Save/restore rather than set/clear so nested
  // canonicalizations (a canonical handler boxing sub-expressions) resolve
  // to the innermost enclosing operator. The context stores only
  // `{operator, ops}` — two field writes on this hot path; the expression is
  // materialized lazily by the (rare) write that records it.
  const previousCause = ce._inferenceCause;
  ce._inferenceCause = { operator: name, ops };
  try {
    return makeCanonicalFunctionCore(ce, name, ops, metadata, scope);
  } finally {
    ce._inferenceCause = previousCause;
  }
}

function makeCanonicalFunctionCore(
  ce: ComputeEngine,
  name: string,
  ops: ReadonlyArray<ExpressionInput>,
  metadata: Metadata | undefined,
  scope: Scope | undefined
): Expression {
  // A `NamedArgument` carrier among the operands (`f(rate: 0.05)`) makes the
  // written order NOT the declaration order, so the call must be permuted
  // before anything reads an operand by position. The scan is a head
  // comparison per operand and nothing else: when no carrier is present every
  // path below is exactly what it was before named arguments existed.
  //
  // The three short paths are skipped for a named call so that it routes
  // through definition lookup and its names can be checked against a
  // signature. (`Add` and `List` declare no parameter names, so a named call
  // to either correctly reports `argument-name-unknown` rather than silently
  // taking the fast path.) See
  // `docs/LANGUAGE-MODEL.md`
  const named = hasNamedArguments(ops);

  if (!named) {
    const result = makeNumericFunction(ce, name, ops, metadata, scope);
    if (result) return result;
  }

  //
  // A `List` is always a plain canonical `List` `BoxedFunction` — tensor-ness
  // is a lazy view over its ops (`tensor-view.ts`), never a distinct
  // representation (§D1). Metadata is forwarded so latex/... survives boxing.
  //
  // A `Spread` element (`[...xs, c]`) takes the NORMAL path below instead:
  // `List`'s canonical handler owns the splice-and-lower rewrite
  // (`canonicalList`, library/collections.ts), which this fast path would
  // bypass.
  //
  if (name === 'List' && !named && !ops.some(isSpreadOperand)) {
    const boxedOps = boxOperands(ce, ops, RAW_OPERAND);
    // `flatten` applies the two operand-list rules a collection literal owes
    // its elements, and must stay in step with `canonicalList`
    // (library/collections.ts), which this fast path bypasses:
    // - `Sequence` is SPLICED — `[1, Sequence(2, 3), 4]` is the 4-element
    //   list `[1, 2, 3, 4]`. A `Sequence` is the engine-wide "these operands,
    //   inlined here" marker and must never be STORED as an element; leaving
    //   it in place produced a 3-element list whose middle element was a
    //   `tuple<…>`.
    // - `Nothing` is ERASED — `[12, Nothing, 34]` is a 2-element list. Use
    //   `Missing` for an absent-but-positioned value.
    //
    // `canonicalize: false` (the third argument): the operands were just made
    // canonical in `scope`, and `flatten` would otherwise re-canonicalize the
    // whole list in the AMBIENT scope the moment any one of them came back
    // non-canonical (an error node, a declined handler). `flatten` is wanted
    // here only for the splice-and-erase step.
    const canonicalOps = flatten(
      canonical(ce, boxedOps, scope),
      undefined,
      false
    );
    return new BoxedFunction(ce, 'List', canonicalOps, {
      metadata,
      canonical: true,
    });
  }

  // A `Spread` entry (`{-> , ...d, "k" -> v}` merge) takes the normal path
  // below instead: the `Dictionary` definition's canonical handler owns the
  // merge lowering (library/collections.ts), which this structural
  // construction would bypass.
  if (name === 'Dictionary' && !named && !ops.some(isSpreadOperand)) {
    const boxedOps = boxOperands(ce, ops, RAW_OPERAND);
    return new BoxedDictionary(ce, ce._fn('Dictionary', boxedOps), {
      canonical: true,
    });
  }

  //
  // Didn't match a short path, look for a definition.
  //
  // Function-application position: an inner binding that provably cannot be
  // applied (a user symbol `N = 85` shadowing the built-in `N` operator)
  // defers to an outer applicable definition — see `lookupApplicable` — so
  // the operator path (with its canonical handler) runs. `_bind()` performs
  // the same resolution, keeping construction and binding consistent.
  //
  const def = lookupApplicable(name, scope ?? ce.context.lexicalScope, ce);
  if (!def) {
    // No def. This is for example `["f", 2]` where "f" is not declared.
    // Inside a resolve-only region (`ce._resolveOnly()`: partial forms,
    // serialization) a read must not write to the caller's scope: skip the
    // auto-declaration and construct the application with an unbound
    // operator, per the structural symbol contract. Note this gates only
    // the AUTO-declare of an undeclared head — binding-site declarations
    // (a Sum index into its local scope) are deliberate and unaffected.
    if (ce._resolveOnlyDepth === 0)
      ce.declare(name, { type: 'function', inferred: true });
    const boxedOps = flatten(semiCanonical(ce, ops));
    // Definition order must not change semantics. `name` has no definition
    // yet, so the collection evidence its parameters would have narrowed onto
    // an unknown symbol argument (`narrowArgsFromInferredSignature`) does not
    // exist: note the call so the enclosing `Function` literal is re-derived
    // once `name` is defined (`provisional-application.ts`).
    if (isProvisionalCaptureOpen() && hasNarrowableArg(boxedOps))
      noteProvisionalCall(name);
    return new BoxedFunction(ce, name, boxedOps, {
      metadata,
      canonical: true,
    });
  }

  //
  // An operator that REQUIRES named arguments (an object-type constructor —
  // `docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, ruling B11) rejects any argument
  // written positionally.
  //
  // Checked HERE, before the permutation below, because that is the last point
  // at which a named call and a positional one are still distinguishable:
  // normalization rewrites a named call into declaration order, and from then
  // on every consumer sees the same operand list either way. A MIXED call is
  // rejected too (`Person("Alan", lastName: "Turing")`): naming the arguments
  // is what makes the call order-free, and one positional argument puts a slot
  // back under the control of its position.
  //
  if (
    ops.length > 0 &&
    !isValueDef(def) &&
    def.operator.namedArgumentsRequired
  ) {
    const blamed = namesRequiredOperands(ce, ops, def.operator.signature.type);
    if (blamed !== undefined)
      return new BoxedFunction(ce, name, flatten(semiCanonical(ce, blamed)), {
        metadata,
        canonical: true,
      });
  }

  //
  // A named call is permuted into declaration order HERE — after the callee's
  // definition is known, and before every consumer that reads an operand by
  // position: `annotateCallbacksFromSignature` (whose contextual arm selection
  // keys on `ops.length`), `semiCanonical`/`flatten`, the binder pre-phase
  // (`canonicalizeBinder` picks binding sites by raw operand index), the lazy
  // split, and `validateArguments`. Placing the seam above all of them is what
  // makes per-position effects metadata and binder site selection correct with
  // no changes of their own.
  //
  // The no-definition branch above is deliberately NOT covered: a call ahead
  // of its definition has no names to check, so its carriers are left
  // untouched and each reports `argument-names-unavailable` when it
  // canonicalizes (design doc §6).
  //
  // `Apply` is EXCLUDED (sub-ruling R4), with two carve-outs below. Its own
  // parameters are `(name, arguments*)` — the first one IS the callee — so a
  // name written in an `Apply` argument list is meant for that callee, not
  // for `Apply`, and matching it against `Apply`'s signature would answer a
  // question nobody asked. `(⟨literal⟩)(x: 1)` canonicalizes to `Apply` too,
  // so this one exclusion covers the whole non-symbol-callee spelling.
  // Declining leaves the carriers to report `argument-names-unavailable`.
  // The carve-outs are the two `Apply` shapes whose callee's parameter names
  // ARE knowable here: a qualified protocol member (next comment) and an
  // inline function literal (below it).
  //
  // The carve-out is the QUALIFIED protocol-member call, which parses as
  // `Apply(Field(Protocol, "member"), …)` (and can be written directly as
  // `ProtocolMember(Protocol, "member", …)` on the box route). Unlike an
  // inline literal, its parameter names are STATICALLY known — the
  // requirement of the named protocol declares them — so the call is
  // permuted here, against that requirement, before the carriers would
  // canonicalize. Without this, qualification (the escape hatch the
  // `protocol-call-ambiguous` diagnostic steers to) forced a named call to
  // drop its names. The bare `member(self: x, …)` form needs none of this:
  // the dispatcher's synthesized signature carries the requirement's names
  // (`sharedParameterName`, engine-protocols.ts) and the ordinary seam
  // below permutes it.
  const qualified = !named
    ? undefined
    : name === 'Apply'
      ? qualifiedFieldParts(ops[0])
      : name === 'ProtocolMember'
        ? protocolMemberParts(ops)
        : undefined;
  if (qualified !== undefined) {
    const requirement = qualifiedMemberRequirementShape(
      ce,
      qualified.base,
      qualified.member,
      // Only the `Field` route has a SYMBOL base a value binding could
      // shadow; the `ProtocolMember` operands name the protocol as data.
      name === 'Apply' ? (scope ?? ce.context.lexicalScope) : undefined
    );
    if (requirement !== null) {
      // The operands before the argument list: the callee for `Apply`, the
      // protocol and member names for `ProtocolMember`.
      const prefix = name === 'Apply' ? 1 : 2;
      const split = splitNamedArguments(ops.slice(prefix));
      const normalized = normalizeNamedArguments(ce, split, requirement);
      // `kind: 'apply'` cannot occur: a requirement is one signature, never
      // an overload set, and no clauses are passed.
      if (normalized.kind === 'error')
        return new BoxedFunction(
          ce,
          name,
          flatten(
            semiCanonical(ce, [...ops.slice(0, prefix), ...normalized.ops])
          ),
          { metadata, canonical: true }
        );
      if (normalized.kind === 'ok')
        ops = [...ops.slice(0, prefix), ...normalized.ops];
      // `unavailable` leaves `ops` alone: the carriers decline as before.
    }
  } else if (named && name === 'Apply') {
    // Second carve-out: an INLINE function-literal callee,
    // `((x: number) => x + 1)(x: 5)`. Its parameter names sit in the very
    // expression being applied — read syntactically by
    // `inlineLiteralSignature`, so an UNANNOTATED literal's names work too,
    // even though its inferred signature type drops them (that drop is why a
    // literal bound to a NAME is still not name-addressable; ROADMAP
    // "Named-argument calls — v1 residuals"). The callee operand itself is
    // left untouched: only the argument list is permuted, and the literal
    // canonicalizes downstream exactly as a positional call's would.
    const literalSignature = inlineLiteralSignature(ops[0]);
    if (literalSignature !== undefined) {
      const split = splitNamedArguments(ops.slice(1));
      const normalized = normalizeNamedArguments(ce, split, literalSignature);
      // `kind: 'apply'` cannot occur: the synthesized signature is a single
      // arm, never an overload set, and no clauses are passed.
      if (normalized.kind === 'error')
        return new BoxedFunction(
          ce,
          name,
          flatten(semiCanonical(ce, [ops[0], ...normalized.ops])),
          { metadata, canonical: true }
        );
      if (normalized.kind === 'ok') ops = [ops[0], ...normalized.ops];
      // `unavailable` leaves `ops` alone: the carriers decline as before.
    }
  } else if (named && name !== 'Apply') {
    const split = splitNamedArguments(ops);
    if (split) {
      const normalized = normalizeNamedArguments(
        ce,
        split,
        isValueDef(def)
          ? calleeSignatureType(def.value)
          : def.operator.signature.type,
        multiClauseState(def)?.clauses
      );
      // Sub-ruling R5 enforcement: the names determined ONE clause of a
      // multi-clause callee and the ordinary call would dispatch elsewhere, so
      // the emitted expression applies that clause's literal directly instead
      // of re-entering the callee (which has no names left to filter its
      // clauses with). The printed form changes — `Apply(⟨literal⟩, …)` rather
      // than `f(…)` — and only for a call whose value would otherwise diverge
      // from what the names asked for.
      if (normalized.kind === 'apply')
        return ce.function('Apply', [normalized.literal, ...normalized.ops], {
          metadata,
          scope,
        });
      if (normalized.kind === 'error')
        return new BoxedFunction(
          ce,
          name,
          flatten(semiCanonical(ce, normalized.ops)),
          { metadata, canonical: true }
        );
      // `unavailable` leaves `ops` alone: the carriers survive to their own
      // canonicalization, which is where `argument-names-unavailable` is
      // minted.
      if (normalized.kind === 'ok') ops = normalized.ops;
    }
  }

  if (isValueDef(def)) {
    // The symbol is declared, but as a value.
    // We construct the function expression and will check its value
    // is a function literal when evaluating it.
    //
    // Before ANY operand is boxed: a declared arrow-typed parameter annotates
    // an inline `Function` literal passed at that position (the
    // signature-driven trigger), so the literal canonicalizes once, already
    // annotated. Runs ahead of the wildcard narrowing sink below, preserving
    // the documented sink-before-noting order.
    const calleeOps = ops.some(isSpreadOperand)
      ? ops
      : annotateCallbacksFromSignature(ce, ops, calleeSignatureType(def.value));

    const boxedOps = flatten(semiCanonical(ce, calleeOps));

    // A function-typed value definition that was INFERRED is not a user
    // constraint but a placeholder — typically the auto-declaration the
    // no-def branch above made for an earlier occurrence of `name` in this
    // very body. It carries no parameter types, so the same evidence loss
    // applies: note the call (idempotent per literal).
    //
    // The bare `function` WILDCARD (`ce.declare('clean', 'function')`, the
    // documented forward-declaration form) is the same situation reached by a
    // different provenance: the author stated only "this is callable", so
    // there are no parameter types to narrow from either — until something is
    // assigned, at which point `setSymbolValue`/`updateDef` fire the repair
    // and the re-canonicalization reads the signature below.
    const wildcardCallee = isWildcardFunctionType(def.value.type.type);

    // The narrowing sink for a wildcard-declared callee. The declared type is
    // a widening that carries no parameter types, and it deliberately STAYS
    // that way through assignment (narrowing it would turn a permissive
    // forward declaration into an arity/parameter contract that a later
    // re-assignment would have to satisfy). The assigned value's own type is
    // the only signature there is, so read it here — the same collection-only
    // evidence the operator path takes from `opDef.signature`.
    //
    // Runs BEFORE the noting below so the "assignment first, then caller"
    // order resolves synchronously: the sink writes the evidence, the
    // arguments stop being narrowable, and the caller does not register as a
    // permanent dependent that every later re-assignment would re-derive. A
    // SCALAR assignment writes nothing (scalar parameter types are not
    // evidence), so those callers stay narrowable and do still park.
    if (wildcardCallee) {
      const assignedType = def.value.value?.type.type;
      if (assignedType !== undefined)
        narrowArgsFromInferredSignature(assignedType, boxedOps);
    }

    if (
      wildcardCallee ||
      (def.value.inferredType && def.value.type.matches('function'))
    ) {
      if (isProvisionalCaptureOpen() && hasNarrowableArg(boxedOps))
        noteProvisionalCall(name);
    }

    // If the symbol was declared with an explicit *function* signature (e.g.
    // `ce.declare('f', '(integer) -> integer')`), enforce the parameter types
    // on application in strict mode: `f(0.5)` and `f("a")` are ill-typed. The
    // value-def application path historically honored the *result* type but
    // never validated the operands. An *inferred* signature carries no user
    // constraint (and an assigned function literal validates its own params
    // when applied), so skip those.
    const valueType = def.value.type.type;
    if (
      ce.strict &&
      !def.value.inferredType &&
      typeof valueType !== 'string' &&
      // A plain signature, OR an overload set (an intersection of signatures).
      // Gating on `kind === 'signature'` alone let an overload-typed value
      // definition skip validation entirely — `h(true)` and `h(1,2,3)` against
      // `((integer) -> integer) & ((string) -> string)` were both reported
      // valid. `validateArguments` resolves the overload itself.
      (valueType.kind === 'signature' || overloadArms(valueType) !== undefined)
      // Complex-family parameters (`(complex) -> complex`, …) are enforced
      // like any other: under D10 (2026-07-02) `real ⊂ complex`, so
      // real/integer/rational arguments satisfy them through the normal
      // subtype path, and the arithmetic type handlers (Multiply, Divide,
      // Power, Ln) are complex-aware for real × pure-imaginary operands (a
      // pure-imaginary product such as `√2·i` types as `imaginary` ⊂
      // `complex`), which retired the last `signatureHasComplexParam` skip.
    ) {
      // Scalar-param signatures are THREADABLE at the application site: the
      // lambda-broadcast machinery maps the body element-wise over a
      // collection operand at runtime (`h(L+1)` evaluates to a List), so
      // validation must admit collection-typed operands against the scalar
      // parameter instead of baking `incompatible-type` (Tycho item 73).
      //
      // `valueResolutionOut` receives the overload resolution when
      // `valueType` is an overload set: it is attached to the constructed
      // call so result typing reads the arm the call was VALIDATED against
      // (`_resolvedOverload`, phase 2c).
      const valueResolutionOut: { resolution?: OverloadResolution } = {};
      const invalid = validateArguments(
        ce,
        boxedOps,
        valueType,
        undefined,
        // A DECLARED `broadcastable<T>` slot is threadable BY DECLARATION
        // (Option A, 2026-08-08): the application MAPS a collection argument
        // there, so the whole-argument check against `broadcastable<T>` is the
        // wrong one — the contract is per ELEMENT, and it is checked where the
        // elements exist (`declaredBroadcastElement`). Without this the
        // declared spelling rejected a mixed-element list that the plain
        // `(T)` spelling admits and diagnoses element by element.
        //
        // PER POSITION, not signature-wide: a sibling slot the declaration
        // binds WHOLE (`list<…>`, `tuple<…>`, a callback) is validated as
        // usual, or `(broadcastable<number>, list<string>)` would admit a
        // `list<number>` at the second slot unchecked.
        threadableGate(valueType, paramsAreScalar(valueType)),
        undefined,
        undefined,
        { resolutionOut: valueResolutionOut, operatorName: name }
      );
      if (invalid) {
        // Only reject *closed* operands — literals and constant expressions
        // whose type is definite (`0.5`, `"a"`). An operand with free
        // variables (a bare symbol `x`, a pattern variable `_q`, or `x+1`)
        // has a provisional/broad type and may satisfy the parameter at
        // runtime, so it is not eagerly rejected; un-reject those and only
        // keep an invalid result if a closed operand actually violated the
        // signature.
        //
        // …unless the operand's own type *refutes* the parameter. "Has free
        // variables" is a proxy for "provisional type", and it is only a
        // valid proxy while the type could still turn out compatible: a
        // symbol declared `string` can never denote a `tuple<…>`, so the
        // error is definite, not provisional. Refute only on PROVABLE
        // disjointness (`isDisjointFrom`, conservative by construction), so
        // union-declared, `unknown`-typed and same-category-composite
        // operands (`list<integer>` vs `list<string>` — the empty list
        // inhabits both) keep deferring exactly as before.
        const cleaned = invalid.map((r, i) => {
          const orig = boxedOps[i];
          if (
            orig &&
            orig.isValid &&
            !r.isValid &&
            orig.freeVariables.length > 0 &&
            // "Has free variables" is a proxy for "provisional type" — and a
            // symbol the Epsil static pre-pass recorded ASSIGNMENT EVIDENCE
            // for is NOT provisional: the pass established its type from an
            // actual assignment (`x = g()` ⇒ `x: number`), so a rejection
            // against that type is as definite as one against a held value,
            // and un-rejecting it here was what kept the whole-program
            // static check from ever reporting the mismatch.
            !(
              isSymbol(orig) &&
              orig.valueDefinition !== undefined &&
              ce._staticAssignmentEvidence?.has(orig.valueDefinition)
            )
          ) {
            const params = candidateParamsAt(valueType, i);
            if (
              params.length > 0 &&
              params.every((p) => orig.type.isDisjointFrom(p))
            )
              return r;
            return orig;
          }
          return r;
        });
        // `validateArguments` returns a non-null list not only when an
        // operand was REJECTED but also when one was SUBSTITUTED and every
        // entry is valid — a one-cluster string literal narrowed to the
        // `character` a declared parameter expects, or an operand repaired
        // by matrix inference. Building the call from `boxedOps` here would
        // discard that substitution (the operator-definition route keeps it),
        // so the cleaned list is used whether or not it carries an error.
        const fn = new BoxedFunction(ce, name, cleaned, {
          metadata,
          canonical: true,
        });
        fn._resolvedOverload = valueResolutionOut.resolution;
        return fn;
      }
      const fn = new BoxedFunction(ce, name, boxedOps, {
        metadata,
        canonical: true,
      });
      fn._resolvedOverload = valueResolutionOut.resolution;
      return fn;
    }

    // A symbol whose DECLARED type is provably INAPPLICABLE — a scalar
    // constant (`Pi`), an absence marker (`Nothing`), a `number`-declared
    // variable — applied as a function is a definite mistake: nothing can
    // make the application meaningful, and it used to stay inert typed
    // `unknown` (`Pi(2)` and `Nothing()` alike), silently absorbing what is
    // almost always a syntax slip. The error code starts with `expected-`,
    // so the Epsil static pre-pass reports it before anything runs.
    //
    // Narrow by construction — every one of these stays inert/applicable:
    // - INFERRED types (a guess; the devolve/repair machinery owns those);
    // - `any`/`unknown` (could still be a function);
    // - anything that COULD be a function, including a mixed callable
    //   union (`((integer) -> integer) | number` keeps its latent set);
    // - collection-SHAPED types: a collection-typed head applied is a
    //   legal APPLICATION (Tycho item 173 — `S(B)` with `S: set<number>`
    //   keeps operator `S`; field adjunction applies a set constant,
    //   `Q(\sqrt{2})`).
    //
    // A head declared exactly `value` is NOT exempted, even though `value`
    // overlaps `collection<any>`: `value` excludes functions from the
    // lattice, so the application can never become meaningful as a CALL,
    // and the vacuous could-be-a-collection overlap of the widest value
    // type is no positive evidence for the indexing/adjunction reading the
    // collection exemption exists for. Declaring `a: value` and writing
    // `a(x)` is diagnosed as applying a non-function; the LaTeX route reads
    // the same juxtaposition as multiplication instead (see the wide-type
    // arms in `invisible-operator.ts`).
    if (
      // Non-strict engines skip application-time type validation, matching
      // the declared-signature parameter checks above.
      ce.strict &&
      !def.value.inferredType &&
      !def.value.type.isUnknown &&
      def.value.type.type !== 'any' &&
      !def.value.type.couldMatch('function') &&
      // `couldMatch`, not `matches`: a MIXED union (`set<number> | number`)
      // or a `broadcastable<T>` head could still hold an applicable
      // collection at run time — only a type that could not possibly be
      // collection-shaped is provably inapplicable.
      (def.value.type.type === 'value' ||
        !def.value.type.couldMatch('collection<any>'))
    ) {
      return ce.error(
        ['expected-function', name, def.value.type.toString()],
        name
      );
    }

    return new BoxedFunction(ce, name, boxedOps, {
      metadata,
      canonical: true,
    });
  }

  const opDef = def.operator;

  // If the operator has a local scope, create it now (unless we were given one,
  // for example one might have been create to record the arguments of a
  // function, but not for a Block expression)
  scope ??= opDef.scoped
    ? {
        parent: ce.context.lexicalScope,
        bindings: new Map(),
      }
    : undefined;

  // A *binder* declares which of its operands are its bound variables, by
  // giving its `scoped` flag a binding-site selector instead of `true`. The
  // framework then owns the two things every binder used to improvise: the
  // declaration of the variable in the operator's own scope (before the
  // canonical handler canonicalizes the body against it), and the rebinding of
  // the site afterwards, so the parse, `ce.box()` and `ce.function()` routes
  // agree about which binding the variable denotes.
  // See `docs/SCOPING-MODEL.md`
  const sites = opDef.bindingSites;
  if (sites !== undefined && scope !== undefined)
    return ce._boxingState.withScopedRepair(scope, () =>
      canonicalizeBinder(ce, name, ops, metadata, scope, opDef, sites)
    );

  if (opDef.scoped && scope !== undefined)
    return ce._boxingState.withScopedRepair(scope, () =>
      applyOperatorDefinition(ce, name, ops, metadata, scope, opDef)
    );

  return applyOperatorDefinition(ce, name, ops, metadata, scope, opDef);
}

/** Every value of `t` is a collection — a union qualifies only when all its
 * arms do. Scalar-admitting types (including `unknown`/`any`) do not. */
function isCollectionOnlyType(t: Type): boolean {
  if (typeof t === 'object' && t.kind === 'union')
    return t.types.every(isCollectionOnlyType);
  // Shape question — asked against the absence-admitting family top (the
  // bare-synonym ruling, 2026-08-17): `dictionary<any>` — At's base param —
  // is collection-only evidence just as bare `dictionary` was.
  return isSubtype(t, COLLECTION_SHAPE_TYPE);
}

/**
 * True when at least one operand is a symbol `narrowArgsFromInferredSignature`
 * could still write evidence onto: its type is INFERRED and still `unknown`.
 * That is the only case a re-derivation of the enclosing `Function` literal
 * could learn something from, so it gates the forward-reference noting
 * (`noteProvisionalCall`) — a call with closed or already-typed arguments
 * waits on nothing.
 */
function hasNarrowableArg(args: ReadonlyArray<Expression>): boolean {
  return args.some(
    (arg) =>
      isSymbol(arg) &&
      arg.valueDefinition?.inferredType &&
      arg.type.type === 'unknown'
  );
}

/**
 * A call to a user function whose signature was INFERRED skips argument
 * validation (currying and partial application are resolved by the lambda at
 * evaluation time). That skip also silenced the one inference side-channel the
 * validators provide: narrowing an unknown-typed symbol argument to the
 * parameter's type. Without it, a function that merely FORWARDS its parameter
 * (`g(xs) = f(xs)` where `f`'s body indexes its parameter) accumulates no
 * collection evidence on `xs`, its inferred signature stays `(unknown)`, and
 * the lambda auto-broadcast then maps `g` over a collection argument that `f`
 * consumes whole.
 *
 * Propagate just that side-channel here: an argument that is a symbol whose
 * type is inferred and still `unknown` narrows to the callee's inferred
 * parameter type, when that type is collection-only (the evidence is
 * unambiguous — no scalar value could occupy the slot). Scalar parameter
 * types are NOT propagated: an inferred scalar is a broadcast-friendly guess,
 * not evidence the caller's argument is scalar.
 */
function narrowArgsFromInferredSignature(
  sig: Type,
  args: ReadonlyArray<Expression>
): void {
  if (typeof sig === 'string' || sig.kind !== 'signature' || !sig.args) return;
  const n = Math.min(args.length, sig.args.length);
  for (let i = 0; i < n; i++) {
    const arg = args[i];
    if (!isSymbol(arg)) continue;
    if (!arg.valueDefinition?.inferredType) continue;
    if (arg.type.type !== 'unknown') continue;
    const paramType = sig.args[i].type;
    if (!isCollectionOnlyType(paramType)) continue;
    arg._infer(paramType, 'narrow');
  }
}

/**
 * The operator-definition half of `makeCanonicalFunction`: apply the `lazy`
 * flag, the `canonical` handler, signature validation, `flatten`,
 * `idempotent`/`involution` and operand sorting.
 *
 * Split out so the binder hook (`canonicalizeBinder`) can wrap it as a whole:
 * every one of its exits is a canonicalization result the post-phase must see.
 * `rawOps` lets the caller pass operands it has already boxed raw (the
 * pre-phase needs them to locate the binding sites), so a binder does not box
 * its operands twice.
 */
/**
 * Re-attach the source position carried by `metadata` to a canonically
 * constructed result that lost it: a custom `canonical` handler (and the
 * numeric fast-path constructors in `makeNumericFunction`) build their result
 * without the caller's metadata. Statement-level positions (`Block` operands,
 * loop bodies, `Declare`/`Assign`) must survive canonicalization so a
 * debugger can map canonical statements back to source
 * (`vscode-epsil/VSCODE_EPSIL_ROADMAP.md`, Tier 2).
 *
 * Only a FUNCTION expression lacking its own offsets is stamped:
 *  - a number/symbol/string result may be an interned singleton (`ce.One`,
 *    a library symbol) shared across unrelated expressions — writing a
 *    position on one would smear it engine-wide;
 *  - a result already carrying offsets (a pass-through operand with its own,
 *    more precise, sub-span) keeps them.
 *
 * The write cannot reach an unrelated statement: a handler's function result
 * is either constructed fresh or is an operand of the very node being
 * canonicalized. (A handler serving a cached function expression would be
 * stamped once with its first consumer's span — positions are advisory
 * metadata, so a stale span is acceptable; structural semantics never read
 * them.) Free when the input carries no offsets (LaTeX and programmatic
 * construction).
 */
function withSourceOffsets(
  result: Expression,
  metadata: Metadata | undefined
): Expression {
  const sourceOffsets = metadata?.sourceOffsets;
  if (sourceOffsets === undefined) return result;
  if (!(result instanceof BoxedFunction)) return result;
  if (result.sourceOffsets !== undefined) return result;
  (result as { sourceOffsets?: [number, number] }).sourceOffsets =
    sourceOffsets;
  return result;
}

/**
 * The log payload for a canonical-handler throw: the error message, plus —
 * for a deadline cancellation — the owner and span chain of the budget that
 * fired (`CancellationError.attribution`/`spans`). Without them the console
 * line reads bare `Timeout exceeded`, which is indistinguishable from an
 * engine-imposed deadline; no such deadline exists — a deadline frame is
 * armed only by an enclosing `withTimeLimit` span, so naming its owner tells
 * the reader whose clock expired (Tycho item 163). Identified by NAME, never
 * `instanceof`: plugin bundles re-bundle engine code.
 */
/**
 * Is `e` a cancellation — an expired deadline, an abort signal, an iteration
 * or recursion-depth breach?
 *
 * The two `catch` blocks around a `canonical` handler log the error and fall
 * back to a NON-canonical `BoxedFunction`, which is right for a handler that
 * genuinely failed on its operands but wrong for a cancellation: a caller who
 * armed `ce.withTimeLimit()` would get their span back NORMALLY, holding a
 * silently degraded expression, with the breach visible only as a line on the
 * console. That is a worse outcome than the unbounded overrun the strided
 * check in `boxFunctionInternal` was added to fix, because it looks like
 * success. Verified before the fix by a canonical handler that builds nodes
 * (which re-enters the strided check from inside the `try`): the span returned
 * normally with `isCanonical === false`.
 *
 * Every other catch site in the engine already makes this exception —
 * `abstract-boxed-expression.ts`, `rules.ts`, `stochastic-equal.ts`,
 * `boxed-function.ts` — so this only brings `box.ts` into line with them.
 *
 * Identified by NAME, never `instanceof`: plugin bundles re-bundle engine
 * code, so a `CancellationError` crossing a bundle boundary is not an instance
 * of the host's class. `isTimeoutCancellation` is deliberately NOT reused —
 * it admits only `cause: 'timeout'`, and an abort or an iteration-limit breach
 * must propagate here for the same reason a timeout must.
 */
function isCancellation(e: unknown): boolean {
  return e instanceof Error && e.name === 'CancellationError';
}

function canonicalErrorDetail(e: unknown): unknown {
  if (!(e instanceof Error)) return e;
  if (e.name === 'CancellationError') {
    const { attribution, spans } = e as {
      attribution?: string;
      spans?: string[];
    };
    if (attribution !== undefined || (spans?.length ?? 0) > 0) {
      const chain = spans?.length ? `, spans: ${spans.join(' → ')}` : '';
      return `${e.message} (budget owner: ${attribution ?? 'unlabeled'}${chain})`;
    }
  }
  return e.message;
}

function applyOperatorDefinition(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: ReadonlyArray<ExpressionInput>,
  metadata: Metadata | undefined,
  scope: Scope | undefined,
  opDef: BoxedOperatorDefinition,
  rawOps?: ReadonlyArray<Expression>
): Expression {
  let result: Expression | null;

  // Before ANY operand is boxed and before any operand type is read: a
  // declared arrow-typed parameter annotates an inline `Function` literal
  // passed at that position (the signature-driven trigger of
  // `docs/TYPE-SYSTEM.md`). Skipped when
  // the caller supplied already-boxed operands (a binder's pre-phase) and when
  // a `Spread` makes the positions uncertain.
  //
  // The `rawOps === undefined` half is a DELIBERATE narrowing (Design D §9b):
  // the deleted `callbackElementOf` trigger ran on both routes, and the
  // contextual trigger runs only on the unboxed one — where its whole contract
  // (the literal canonicalizes ONCE, already annotated) is achievable. No
  // converted operator declares binding sites, so nothing reaches the other
  // route today. TRIPWIRE: a converted operator that also BINDS variables must
  // re-visit this gate — it would silently stamp nothing.
  if (rawOps === undefined && !ops.some(isSpreadOperand))
    ops = annotateCallbacksFromSignature(ce, ops, opDef.signature.type);

  if (opDef.lazy) {
    // If we have a lazy function, we don't canonicalize the arguments
    const xs = rawOps ?? boxOperands(ce, ops, RAW_OPERAND);
    if (opDef.canonical) {
      try {
        result = opDef.canonical(xs, { engine: ce, scope });
        if (result) return withSourceOffsets(result, metadata);
      } catch (e) {
        if (isCancellation(e)) throw e;
        // Multi-arg form: a non-Error thrown value keeps its structure in the
        // console (and a Symbol or null-prototype object, whose implicit
        // string conversion throws, cannot break the recovery path).
        console.error(
          `ComputeEngine: error canonicalizing \`${name}\`:`,
          canonicalErrorDetail(e)
        );
      }
      // The canonical handler gave up, return a non-canonical expression
      result = new BoxedFunction(ce, name, xs, {
        metadata,
        canonical: false,
      });
      return result;
    }

    if (opDef.inferredSignature) {
      // No forward-reference noting on this LAZY path, unlike the non-lazy one
      // below: `xs` are raw, unbound operands, so they carry no binding a
      // re-derivation could narrow (`hasNarrowableArg` reads
      // `valueDefinition`) and there is nothing to wait on.
      narrowArgsFromInferredSignature(opDef.signature.type, xs);
    }
    // See the value-definition site above: the resolution of an overload-set
    // signature is attached to the constructed call for result typing.
    const lazyResolutionOut: { resolution?: OverloadResolution } = {};
    const lazyFn = new BoxedFunction(
      ce,
      name,
      opDef.inferredSignature
        ? xs
        : (validateArguments(
            ce,
            xs,
            opDef.signature.type,
            opDef.lazy,
            // Declared-`broadcastable<T>` slots are threadable by declaration,
            // per position — see the value-definition site above.
            threadableGate(opDef.signature.type, opDef.broadcastable === true),
            undefined,
            undefined,
            { resolutionOut: lazyResolutionOut, operatorName: name }
          ) ?? xs),
      { metadata, canonical: true, scope }
    );
    lazyFn._resolvedOverload = lazyResolutionOut.resolution;
    result = lazyFn;
    return result;
  }

  // Keep a boundary around inference performed while canonicalizing these
  // operands. Signature validation may use this to retract only fresh,
  // provisional guesses; inferences from earlier expressions are never
  // eligible for repair.
  // Inlined `boxOperands()` (see there for why): this is the recursive path
  // of every canonical operand — the innermost boxing frames of a deep tree
  // are here — so it neither goes through the public `ce.expr()` (five
  // frames of scope re-installation) nor through `Array.prototype.map` and
  // a callback, nor through the helper itself.
  const boxOne =
    ce._inferenceTxDepth > 0 && ce._boxingState.isRootActive
      ? boxInternal
      : box;
  const xs: Expression[] = [];
  for (const x of ops) xs.push(boxOne(ce, x));

  // A symbolic `Spread` operand (`f(...p)` where `p` is not a literal tuple
  // — a literal one already spliced to a `Sequence` when the operand
  // canonicalized above) makes the final positional operands unknown until
  // evaluation, and every canonical handler assumes them (arity checks,
  // sorting, folding). Skip the handler and validation: the evaluate path
  // (step 0 of `_computeValue`) splices the tuple and rebuilds through
  // `ce.function`, which re-runs both on the real arguments.
  if (xs.some((x) => x.operator === 'Spread'))
    return new BoxedFunction(ce, name, xs, {
      metadata,
      canonical: true,
      scope,
    });

  //
  // 3/ Apply `canonical` handler
  //
  // If present, the canonical handler is responsible for
  //  - validating the signature (domain and number of arguments)
  //  - sorting them
  //  - applying involution and idempotent to the expression
  //  - flatenning sequences
  //
  // The arguments have been put in canonical form
  //
  if (opDef.canonical) {
    try {
      const result = opDef.canonical(xs, { engine: ce, scope });
      if (result) {
        // In strict mode, validate the operands against the operator's declared
        // signature *after* the canonical handler runs. Historically a custom
        // canonical handler was the sole gate on argument validity, and most
        // only check arity — so ill-typed calls such as `Sin("hello")` or
        // `Factorial("x")` slipped through as `isValid`.
        //
        // The re-validation is deliberately narrow, gated on all of:
        //  - the handler returned an expression with the *same* operator (a
        //    handler that rewrote the head — `Rational`→`Divide`,
        //    `Sqrt`→`Power` — or folded to a number made its own decision);
        //  - that result is still valid (don't second-guess a handler that
        //    already flagged an argument);
        //  - the signature is not inferred (an inferred signature carries no
        //    constraints; inference narrows it later);
        //  - every declared parameter is numeric (subtype of `number`). This
        //    restricts the check to the pure-numeric operators the finding
        //    targets and leaves higher-order/structural operators — `Apply`
        //    (`symbol` param), `Equivalent` (`boolean`), the big-ops — alone,
        //    since their declared signatures are looser than what their
        //    handlers legitimately accept.
        //
        // The check uses `checkNumericArgs` (not the exact-typed
        // `validateArguments`) so it matches the leniency of the fast-path
        // numeric operators: unknown symbols, `number | list` unions, tensors
        // and numeric collections are all accepted (a numeric operator is
        // threadable), and only a *provably* non-numeric operand — a string,
        // a boolean — is rejected.
        if (
          ce.strict &&
          !opDef.inferredSignature &&
          isFunction(result, name) &&
          result.isValid &&
          allParamsNumeric(opDef.signature.type)
        ) {
          const checked = checkNumericArgs(ce, result.ops);
          if (checked.some((x) => !x.isValid))
            return new BoxedFunction(ce, name, checked, {
              metadata,
              canonical: true,
              scope,
            });
        }
        return withSourceOffsets(result, metadata);
      }
    } catch (e) {
      if (isCancellation(e)) throw e;
      // Multi-arg form — see the lazy-path catch above.
      console.error(
        `ComputeEngine: error canonicalizing \`${name}\`:`,
        canonicalErrorDetail(e)
      );
    }

    // The canonical handler gave up, return a non-canonical expression
    const result = new BoxedFunction(ce, name, xs, {
      metadata,
      canonical: false,
    });

    return result;
  }

  //
  // Flatten any sequence
  // f(a, Sequence(b, c), Sequence(), d) -> f(a, b, c, d)
  //
  let args: ReadonlyArray<Expression> = flatten(
    xs,
    opDef.associative ? name : undefined
  );

  // Skip validation for function literals with inferred signatures.
  // These will be validated during evaluation by the lambda function,
  // which handles currying and partial application. Collection evidence on
  // the callee's parameters still narrows unknown symbol arguments (see
  // `narrowArgsFromInferredSignature`).
  if (opDef.inferredSignature) {
    // As in the lazy path above: an inferred signature is a guess, so wait on
    // a redefinition of `name` that could supersede it with real evidence.
    if (isProvisionalCaptureOpen() && hasNarrowableArg(args))
      noteProvisionalCall(name);
    narrowArgsFromInferredSignature(opDef.signature.type, args);
  }
  // See the value-definition site above: the resolution of an overload-set
  // signature is attached to the constructed call for result typing
  // (`_resolvedOverload`, phase 2c).
  const resolutionOut: { resolution?: OverloadResolution } = {};
  const adjustedArgs = opDef.inferredSignature
    ? null
    : validateArguments(
        ce,
        args,
        opDef.signature.type,
        opDef.lazy,
        // Declared-`broadcastable<T>` slots are threadable by declaration, per
        // position — see the value-definition site above.
        threadableGate(opDef.signature.type, opDef.broadcastable === true),
        // The repair is enabled whenever a boxing operation is in progress
        // (matching the old always-present snapshot); an empty log means "no
        // fresh inference happened", not "repair disabled".
        ce._inferenceTxDepth > 0
          ? (ce._freshlyInferred ?? EMPTY_FRESHLY_INFERRED)
          : undefined,
        // Strip-before-validate (§3.B): a `propagate`/`handle` operator admits
        // an absent (`Missing`) or possibly-absent (`T | missing`) operand in a
        // stripped position; the runtime gate carries the absence.
        (i) => opDef.stripsMissingAt(i),
        { resolutionOut, operatorName: name }
      );

  if (adjustedArgs) {
    // If any adjusted argument is invalid, the arguments did not match the
    // parameters of the signature. We're done.
    if (adjustedArgs.some((x) => !x.isValid)) {
      const fn = new BoxedFunction(ce, name, adjustedArgs, {
        metadata,
        canonical: true,
        scope,
      });
      fn._resolvedOverload = resolutionOut.resolution;
      return fn;
    }
    // All valid: an operand was substituted (devolved to an unknown symbol,
    // or repaired by matrix inference). Continue canonicalization with the
    // substituted operands.
    args = adjustedArgs;
  }

  //
  // 4/ Apply `idempotent` and `involution`
  //
  if (args.length === 1 && args[0].operator === name) {
    // f(f(x)) -> x
    if (opDef.involution && isFunction(args[0])) return args[0].op1;

    // f(f(x)) -> f(x)
    if (opDef.idempotent && isFunction(xs[0])) {
      const fn = new BoxedFunction(ce, name, xs[0].ops, {
        metadata,
        canonical: true,
        scope,
      });
      // The rewrite RETAINS the inner call (same operator, same operands),
      // so the inner call's validated overload resolution is this
      // expression's too — without the transfer, `.type` falls to the
      // prefilter-only cold path and can rank a different arm than the one
      // the inner call validated against.
      if (xs[0] instanceof BoxedFunction)
        fn._resolvedOverload = xs[0]._resolvedOverload;
      return fn;
    }
  }

  //
  // 5/ Sort the operands
  //
  // The attached resolution is index-INSENSITIVE for its consumer: result
  // typing reads `selected`/`selectedInstance` only, so a commutative sort of
  // the operands does not invalidate it.
  const fn = new BoxedFunction(ce, name, sortOperands(name, args), {
    metadata,
    canonical: true,
    scope,
  });
  fn._resolvedOverload = resolutionOut.resolution;
  return fn;
}

/**
 * Canonicalize a **binder**: an operator whose `scoped` flag is a
 * binding-site selector (`docs/SCOPING-MODEL.md`
 * §1.3). Two phases, because a canonical handler both *needs* the bound
 * variable declared before it canonicalizes the body and *may reshape* the
 * operands.
 *
 * Pre-phase: declare each site's symbol in the operator's own scope, with
 * `noAutoDeclare` set so the free variables of the body and the bounds are
 * promoted to the ENCLOSING scope instead (the prologue `canonicalBigop` and
 * `canonicalLoopLike` each hand-rolled).
 *
 * Post-phase: `bindBindingSites`, below.
 *
 * Two things the pre-phase deliberately does NOT do:
 *
 * - It does not push a scope when there is no site to declare. A bare
 *   `Loop(body)` and a `Series(f)` whose expansion variable the handler
 *   supplies have nothing to bind before the handler runs, and a scope pushed
 *   for them is popped and discarded — swallowing a `Declare` in the body. The
 *   post-phase still runs, and declares a site the handler revealed.
 *
 * - It does not declare a *later* clause's index (see
 *   `BindingSite.clauseLocal`). The whole node is canonicalized by ONE
 *   handler call, so the framework cannot interleave a declaration between two
 *   clauses; the clause walk inside the handler (`canonicalIndexingSet`,
 *   `canonicalLoopLike`) declares each index in this scope just before its own
 *   clause, and the post-phase is the backstop. Only the FIRST clause's index
 *   can be declared up front — nothing is canonicalized ahead of it.
 */
function canonicalizeBinder(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  ops: ReadonlyArray<ExpressionInput>,
  metadata: Metadata | undefined,
  scope: Scope,
  opDef: BoxedOperatorDefinition,
  sites: BindingSiteSelector
): Expression {
  // The selector reads the operands, so they must be boxed before the handler
  // runs. Raw (unbound) boxing is what a lazy operator does anyway, and the
  // result is handed on so it is done once.
  const xs = boxOperands(ce, ops, RAW_OPERAND);

  const preSites = sites(xs, 'pre');

  let result: Expression;
  if (preSites.length === 0) {
    // Nothing to declare: canonicalize in the ambient scope rather than in a
    // frame that is pushed, never populated, and discarded.
    result = applyOperatorDefinition(ce, name, ops, metadata, scope, opDef, xs);
  } else {
    const wasNoAutoDeclare = scope.noAutoDeclare;
    scope.noAutoDeclare = true;
    ce.pushScope(scope);
    try {
      // A clause-local site is visible only from its own operand onward, and
      // the handler canonicalizes the operands in one call: all the pre-phase
      // can declare is the first clause's index.
      let firstClause: number | undefined;
      for (const site of preSites) {
        if (site.clauseLocal) {
          firstClause ??= site.path[0];
          if (site.path[0] !== firstClause) continue;
        }
        const sym = symbolAtSite(xs, site.path);
        if (sym === undefined) continue;
        // An explicit `ce.declare()` is not affected by `noAutoDeclare`: it
        // always lands in the target (this operator's) scope.
        // A site WITHOUT a declared type gets an INFERRED `unknown` binding,
        // not a declared one. A binder's canonical handler then narrows the
        // index to whatever the iterated collection's element type claims
        // (`canonicalLoopLike` in `library/control-structures.ts` does this
        // for `Loop`/`Comprehension`) — a GUESS, which an element whose
        // actual value falls outside the claimed element type must be able to
        // widen at the per-iteration `ce.assign(index, value)` rather than be
        // rejected by it as `incompatible-type` (`assignFn`,
        // `engine-declarations.ts`, which widens on the inferred track and
        // enforces on the declared one). `BoxedSymbol._infer()` also marks the
        // types it writes inferred, so this is belt-and-braces; declaring the
        // provenance HERE keeps the binding honest even before any inference
        // runs, for the readers of `inferredType` that ask whether a type was
        // declared. A site that DOES declare a type states a real contract
        // and stays on the declared track.
        if (!scope.bindings.has(sym.symbol))
          ce.declare(sym.symbol, {
            type: site.type ?? 'unknown',
            inferred: site.type === undefined,
          });
      }
      result = applyOperatorDefinition(
        ce,
        name,
        ops,
        metadata,
        scope,
        opDef,
        xs
      );
    } finally {
      // A DORMANT pop: the canonical expression keeps this scope as its
      // `localScope` and pushes it again on every evaluation, so it is not
      // dying and must not be tombstoned by the debug invariant.
      beginDormantPop();
      try {
        ce.popScope();
      } finally {
        endDormantPop();
      }
      scope.noAutoDeclare = wasNoAutoDeclare;
    }
  }

  return bindBindingSites(ce, name, result, metadata, scope, sites);
}

/**
 * The post-phase of the binder hook: make every occurrence of a bound variable
 * denote THIS node's binding.
 *
 * Step 5 — the binding site itself. What arrives there differs by route: the
 * parse route leaves it RAW (a symbol with no definition — `box.ts` boxes a
 * lazy operator's operands with `form: 'raw'`), while `ce.function('Series',
 * [f, ce.symbol('x')])` hands over a symbol carrying the CALLER's binding.
 * Both are discarded, and only at the binding site.
 *
 * Step 6 — the same names elsewhere in the node, through the shared
 * `rebindToBindings` walk (`binders.ts`), which a `Function` literal's
 * parameter repair also runs: canonicalizing an already-canonical body is a
 * no-op, so a body canonicalized before this node's scope existed keeps the
 * earlier bindings. See that function for the raw-occurrence rule and the
 * rest of the contract.
 *
 * Step 6 is CLAUSE-ORDERED: a `BindingSite.clauseLocal` site's name is
 * rewritten only in its own clause and the ones after it (and in the operands
 * before the first clause — the body, which is inside every clause). An
 * earlier clause's collection referencing the name legitimately denotes the
 * ENCLOSING binding — `Comprehension(…, Element(i, [j, j+1]), Element(j, …))`
 * draws `i` from the ambient `j`.
 */
function bindBindingSites(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  result: Expression,
  metadata: Metadata | undefined,
  scope: Scope,
  sites: BindingSiteSelector
): Expression {
  // A handler that rewrote the head (`canonicalBigop` returns a `Reduce` for a
  // collection body) or gave up made its own decision: the paths no longer
  // describe this expression.
  if (!isFunction(result, name) || !result.isCanonical) return result;

  const found = sites(result.ops, 'post');
  if (found.length === 0) return result;

  // Step 5: the site denotes this node's binding.
  let ops: ReadonlyArray<Expression> = result.ops;
  const bound = new Map<string, Expression>();
  // The operand index a bound name becomes visible at (0 = the whole node),
  // and the index of the first clause — every operand before it (the body)
  // sees all the bindings.
  const visibleFrom = new Map<string, number>();
  let firstClause = Number.POSITIVE_INFINITY;
  for (const site of found) {
    const sym = symbolAtSite(ops, site.path);
    if (sym === undefined) continue;
    const id = sym.symbol;
    const from = site.clauseLocal ? site.path[0] : 0;
    if (site.clauseLocal) firstClause = Math.min(firstClause, site.path[0]);
    visibleFrom.set(id, Math.min(visibleFrom.get(id) ?? from, from));
    let binding = bound.get(id);
    if (binding === undefined) {
      // The 'post' phase is the authoritative one: a handler that reshapes
      // its operands (or supplies a default variable) can reveal a site the
      // 'pre' phase could not see, and that site still gets its binding here.
      // As in the 'pre' phase above: a site without a declared type gets an
      // INFERRED binding, so the narrowing a binder's canonical handler
      // applies (from the iterated collection's claimed element type) stays a
      // revisable guess rather than a contract the per-iteration assignment
      // must satisfy.
      if (!scope.bindings.has(id))
        ce._inScope(scope, () =>
          ce.declare(id, {
            type: site.type ?? 'unknown',
            inferred: site.type === undefined,
          })
        );
      // From the scope's OWN binding, not by name: `ce.symbol()` resolves a
      // constant-named variable (`D(f, Pi)`) to the interned constant rather
      // than to the binding this node just declared for it.
      binding = ce._bindingSymbol(id, scope);
      if (binding === undefined) continue;
      bound.set(id, binding);
    }
    if (sym.valueDefinition === binding.valueDefinition) continue;
    ops = replaceAtSite(ops, site.path, binding);
  }
  if (bound.size === 0) return result;

  // Step 6: same-named occurrences in the node's other operands.
  //
  // The node must also END UP carrying the scope: `boundVariableNames` reads
  // `localScope.bindings`, and that is the only channel `same()`,
  // `rebindEscaping` and the rewrite walks have for learning what a node binds.
  // A handler that builds its result with a bare `ce._fn(…)` does not attach
  // it, so a rebuild is needed even when no operand moved.
  let changed = ops !== result.ops || result.localScope !== scope;
  const next = ops.map((op, m) => {
    // An operand before the first clause is the body: it is inside every
    // clause, so it sees every binding.
    const limit = m < firstClause ? Number.POSITIVE_INFINITY : m;
    const rewritten = rebindToBindings(op, scope, bound, {
      accept: (name) => (visibleFrom.get(name) ?? 0) <= limit,
    });
    if (rewritten !== op) changed = true;
    return rewritten;
  });
  if (!changed) return result;

  return ce._fn(name, next, { metadata, scope });
}

function makeNumericFunction(
  ce: ComputeEngine,
  name: MathJsonSymbol,
  semiOps: ReadonlyArray<ExpressionInput>,
  metadata?: Metadata,
  scope?: Scope
): Expression | null {
  let ops: ReadonlyArray<Expression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), {
      flatten: name,
    });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 1);
  else if (name === 'Ln' || name === 'Log') {
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing')];
  } else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope), 2);
  else if (name === 'Divide') {
    // Note: Divide can have more than one argument, i.e.
    // Divide(a, b, c) = a / b / c
    // But it needs at least two arguments
    ops = checkNumericArgs(ce, semiCanonical(ce, semiOps, scope));
    if (ops.length === 0) ops = [ce.error('missing'), ce.error('missing')];
    if (ops.length === 1) ops = [ops[0], ce.error('missing')];
  } else return null;

  // A `Spread` operand (`Add(...t)`) defers the whole numeric fast path to
  // the generic operator route: the canonical constructors below (the
  // single-operand `Add`/`Multiply` unwrap, eager folding) and the arity
  // padding above assume the FINAL positional operands, which only exist
  // once the spread splices at evaluation (step 0 of the evaluate path).
  if (ops.some((x) => x.operator === 'Spread')) return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid))
    return new BoxedFunction(ce, name, ops, { metadata, canonical: true });

  //
  // Short path for some functions
  // (avoid looking up a definition)
  //
  if (name === 'Add') return withSourceOffsets(canonicalAdd(ce, ops), metadata);
  if (name === 'Negate')
    return withSourceOffsets(canonicalNegate(ops[0]), metadata);
  if (name === 'Multiply')
    return withSourceOffsets(canonicalMultiply(ce, ops), metadata);
  if (name === 'Divide') {
    if (ops.length === 2)
      return withSourceOffsets(
        canonicalDivide(...(ops as [Expression, Expression])),
        metadata
      );
    return withSourceOffsets(
      ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]),
      metadata
    );
  }
  if (name === 'Exp')
    return withSourceOffsets(canonicalPower(ce.E, ops[0]), metadata);
  if (name === 'Square')
    return withSourceOffsets(canonicalPower(ops[0], ce.number(2)), metadata);
  if (name === 'Power')
    return withSourceOffsets(canonicalPower(ops[0], ops[1]), metadata);
  if (name === 'Root')
    return withSourceOffsets(canonicalRoot(ops[0], ops[1]), metadata);
  if (name === 'Sqrt')
    return withSourceOffsets(canonicalRoot(ops[0], 2), metadata);

  if (name === 'Ln' || name === 'Log') {
    if (ops.length > 0) {
      // Ln(1) -> 0, Log(1) -> 0 — literal only: `.isSame(1)` follows symbol
      // value bindings, and a mutable symbol's transient value must not fold
      // into canonical structure (`Ln(x)` while `x` holds 1 stays `Ln(x)`).
      if (isNumber(ops[0]) && ops[0].isSame(1)) return ce.Zero;
      // Ln(a) -> Ln(a), Log(a) -> Log(a)
      if (ops.length === 1)
        return new BoxedFunction(ce, name, ops, { metadata, canonical: true });
    }
    // Ln(a,b) -> Log(a, b)
    return new BoxedFunction(ce, 'Log', ops, { metadata, canonical: true });
  }

  return null;
}

/**
 * The exact real component (`rational · √radical`) of a boxed expression that
 * is an exact real number literal, or `null`. Used to reconstruct exact
 * complex values when boxing `['Complex', re, im]`.
 */
function exactRealComponent(
  op: Expression
): { rational: Rational; radical: number } | null {
  if (!isNumber(op)) return null;
  const nv = op.numericValue;
  if (typeof nv === 'number') {
    if (!Number.isInteger(nv)) return null;
    return { rational: [nv, 1], radical: 1 };
  }
  if (nv.im !== 0) return null;
  const exact = nv.asExact;
  if (!(exact instanceof ExactNumericValue)) return null;
  if (exact.isNaN || exact.isPositiveInfinity || exact.isNegativeInfinity)
    return null;
  return { rational: exact.rational, radical: exact.radical };
}

function fromNumericValue(ce: ComputeEngine, value: NumericValue): Expression {
  if (value.isZero) return ce.Zero;
  if (value.isOne) return ce.One;
  if (value.isNegativeOne) return ce.NegativeOne;
  if (value.isNaN) return ce.NaN;
  if (value.isNegativeInfinity) return ce.NegativeInfinity;
  if (value.isPositiveInfinity) return ce.PositiveInfinity;

  value = value.asExact ?? value;

  // An exact complex value is best represented as a number literal directly:
  // decomposing it into `re + im·i` terms would only re-fold to the same
  // literal (via canonicalAdd), and the machine-complex imaginary emission
  // below would degrade it to an inexact float.
  if (value.im !== 0 && value instanceof ExactNumericValue)
    return ce.number(value);

  if (!value.isExact) {
    const im = value.im;
    if (im === 0) return ce.number(value.bignumRe ?? value.re);
    if (value.re === 0) return ce.number(ce.complex(0, im));
    if (value.bignumRe !== undefined && !isInMachineRange(value.bignumRe)) {
      return canonicalAdd(ce, [
        ce.number(value.bignumRe),
        ce.number(ce.complex(0, im)),
      ]);
    }
    return ce.number(ce.complex(value.re, value.im));
  }

  const terms: Expression[] = [];

  //
  // Real Part
  //
  const exactValue = value as ExactNumericValue;
  if (exactValue.sign !== 0) {
    // The real part is the product of a rational and radical

    if (exactValue.radical === 1) {
      // No radical, just a rational part
      terms.push(ce.number(exactValue.rational));
    } else {
      const rational = exactValue.rational;
      // At least a radical, maybe a rational as well.
      const radical = ce.function('Sqrt', [ce.number(exactValue.radical)]);
      if (isOne(rational)) terms.push(radical);
      else {
        const [n, d] = rational;
        if (d === 1) {
          if (n === 1) terms.push(radical);
          else terms.push(ce.function('Multiply', [ce.number(n), radical]));
        } else {
          if (n === 1)
            terms.push(ce.function('Divide', [radical, ce.number(d)]));
          else
            terms.push(
              ce.function('Divide', [
                ce.function('Multiply', [ce.number(n), radical]),
                ce.number(d),
              ])
            );
        }
      }
    }
  }

  let result: Expression;

  if (value.im === 0) {
    if (terms.length === 0) return ce.Zero;
    result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
    return result;
  }

  //
  // Imaginary Part
  //
  if (terms.length === 0) return ce.number(ce.complex(0, value.im));

  result = terms.length === 1 ? terms[0] : canonicalMultiply(ce, terms);
  return canonicalAdd(ce, [result, ce.number(ce.complex(0, value.im))]);
}

export function semiCanonical(
  ce: ComputeEngine,
  xs: ReadonlyArray<ExpressionInput>,
  scope?: Scope
): ReadonlyArray<Expression> {
  // Avoid memory allocation if possible
  if (xs.every((x) => x instanceof _BoxedExpression && x.isCanonical))
    return xs as ReadonlyArray<Expression>;

  return xs.map((x) => ce.expr(x, { scope }));
}
