import { MathJsonSymbol } from '../math-json.js';
import {
  debugStatementHook,
  debugStatementResultHook,
} from '../common/debug-hook.js';
import { cmp } from './boxed-expression/compare.js';
import {
  evaluateInOwnBindings,
  markActivation,
  rebindToBindings,
  rewriteWithBinders,
  sameBindingDef,
  boundVariableNames,
  shadowedKey,
} from './boxed-expression/binders.js';
import type {
  BoxedDefinition,
  BoxedValueDefinition,
  EvaluateOptions,
  Expression,
  ExpressionInput,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
  Scope,
} from './global-types.js';
import {
  isSymbol,
  isFunction,
  isDictionary,
  isString,
  isNumber,
  sym,
} from './boxed-expression/type-guards.js';
import {
  functionLiteralBoundNames,
  functionLiteralDeclaredSignature,
  functionLiteralParameterName,
  functionLiteralParameterNames,
  functionLiteralParameterType,
  isDestructuringParameter,
  mentionsQuantifiedVariable,
  resolveFunctionLiteralTypes,
} from './boxed-expression/function-literal.js';
import { collectTuplePattern } from './boxed-expression/tuple-pattern.js';
import { errorValue } from './boxed-expression/error-value.js';
import {
  beginProvisionalCapture,
  endProvisionalCapture,
  provisionalLiteral,
  registerProvisionalDependents,
  setProvisionalLiteral,
  takeProvisionalDependents,
  type ProvisionalDependent,
} from './boxed-expression/provisional-application.js';
import { activeRollbackFrame } from './inference-rollback.js';
import {
  effectsContractStateOf,
  recordEffectsTransition,
} from './boxed-expression/effects-provenance.js';
import { effectsOf } from './boxed-expression/effects-of.js';
import {
  memoDepsStillValid,
  snapshotMemoDeps,
  type MemoDeps,
} from './boxed-expression/collection-element-memo.js';
import { isPureComputedEffects } from '../common/type/effects.js';
import type { FunctionSignature, Type } from '../common/type/types.js';
import { parseType } from '../common/type/parse.js';
import { isPolymorphicType } from '../common/type/instantiate.js';
import {
  GENERIC_ANNOTATION_COVERAGE_MESSAGE,
  GENERIC_PARTIAL_APPLICATION_MESSAGE,
  INVALID_SIGNATURE_MARKER_MESSAGE,
  TYPE_VARIABLE_INTRODUCTION_MESSAGE,
} from './boxed-expression/type-compatibility-error.js';
import { substituteDeclaredBounds } from './boxed-expression/generic-instantiation.js';
import { isSubtype } from '../common/type/subtype.js';
import { typeToString } from '../common/type/serialize.js';
import {
  isGroupedTypeText,
  returnTypeText,
  signatureEffects,
} from '../common/type/utils.js';
import { journalCheckpointMapEntry } from './checkpoint-journal.js';

// Lazy reference to `validateArguments` (from `boxed-expression/validate.ts`).
// A static import would create a cycle: `validate.ts → utils.ts →
// boxed-operator-definition.ts → function-utils.ts`. Injected once by
// `boxed-expression/init-lazy-refs.ts` at engine load. The type is written
// inline (not `import type`) so madge does not detect a type-only cycle.
type ValidateArgumentsFn = (
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  threadable?: boolean,
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
) => ReadonlyArray<Expression> | null;

let _validateArguments: ValidateArgumentsFn | undefined;
export function _setValidateArguments(fn: ValidateArgumentsFn): void {
  _validateArguments = fn;
}

/***
 * ### THEORY OF OPERATIONS
 *
 * The body of a `["Function"]` expression is a `["Block"]` expression,
 * which is scoped. The function arguments are declared in that scope as well.
 *
 * Some expressions with anonymous parameters (e.g. `["Add", "_", 1]`)
 * are rewritten to a `["Function"]` expression with anonymous parameters
 * (e.g. `["Function", ["Block", ["Add", "_", 1]], "_"]`).
 *
 *
 * #### DURING CANONICALIZATION (in canonicalFunctionLiteralArguments())
 *
 * 1/ If not a `["Function"]` expression, the expression is rewritten
 *    to a `["Function"]` expression with anonymous parameters
 * 2/ A `Block` scope is created
 * 3/ The function parameters are declared in the Block's scope
 * 4/ The function body is canonicalized in the context of the scope.
 *    The Block's localScope captures the defining scope as its parent.
 *
 *
 * #### DURING EVALUATION (executing the result of makeLambda())
 *
 * 1/ The arguments are evaluated in the **calling** scope
 * 2/ A fresh scope is created per call, with parent = the **defining**
 *    scope (body.localScope.parent), giving true lexical scoping
 * 3/ The function parameters are declared in the fresh scope
 * 4/ body.localScope is temporarily re-parented to chain through the
 *    fresh scope: bigOpScope → bodyScope → freshScope → capturedScope.
 *    Param bindings in bodyScope (stale, from canonicalization) are
 *    temporarily hidden so they don't shadow freshScope's values.
 *    This lets nested scoped expressions (Sum, Product) find params
 *    by walking up their static scope chain.
 * 5/ The function body is evaluated in the context of the fresh scope
 * 6/ If the result contains Function literals, they are rebound to
 *    close over the fresh scope (closure capture)
 * 7/ The fresh scope is discarded; body.localScope.parent is restored
 * 8/ The result is returned
 *
 */

/**
 * From an expression, return a predicate function, which can be used to filter.
 */
export function predicate(
  _expr: Expression
): (...args: Expression[]) => boolean {
  // Expression-backed predicates are not implemented; the conservative
  // fallback rejects every candidate.
  return () => false;
}

/**
 * From an expression, create an ordering function, which can be used to sort.
 */
export function order(
  _expr: Expression
): (a: Expression, b: Expression) => -1 | 0 | 1 {
  // Expression-backed comparators are not implemented. Use the canonical
  // expression order as the fallback.
  return (a: Expression, b: Expression) => {
    const c = cmp(a, b);
    if (c === '=') return 0;
    if (c === '<' || c === '<=') return -1;
    return 1;
  };
}

/**
 * Given an expression, rewrite it to a symbol or canonical Function form.
 *
 * - symbol (no change):
 *      "Sin"
 *     -> "Sin"
 *
 * - built-in function:
 *      ["BuiltinFunction", "Sin"]
 *     -> "Sin"
 *
 * - parenthesized expression:
 *      ["Delimiter", ["Add", "_", 1], "'()'"]
 *     -> ["Function", ["Block", ["Add", "_", 1]], "_"]
 *
 * - explicit parameters (adding a block to serve as a scope for the arguments):
 *      ["Function", ["Add", "x", 1], "x"]
 *      -> ["Function", ["Block", ["Add", "x", 1]], "x"]
 *
 *
 * - single anonymous parameters:
 *      ["Add", "_", 1]
 *      -> ["Function", ["Block", ["Add", "_", 1]], "_"]
 *
 * - multiple anonymous parameters:
 *      ["Add", "_1", "_2"]
 *      -> ["Function", ["Block", ["Add", "_1", "_2"]], "_1", "_2"]
 *
 *
 */
export function canonicalFunctionLiteral(
  expr: Expression | undefined,
  options?: { params?: ReadonlyArray<Expression> }
): Expression | undefined {
  if (!expr) return undefined;

  //
  // 0/ A string literal is never a function. Without this guard a string
  //    falls through to the shorthand path below and becomes a constant
  //    nullary function `() ↦ "s"`, so e.g. `Map("nf", [1,2,3])` would map to
  //    `["nf","nf","nf"]` instead of being rejected.
  //
  if (isString(expr)) return undefined;

  //
  // 1/ Canonical function literal
  //
  if (expr.operator === 'Function' && expr.isCanonical) return expr;

  //
  // 2/ If a symbol, e.g. "Sin", return unchanged
  //    When evaluating, the type of the symbol need to be checked to
  //    make sure it's a function
  //
  //    Exception: the BARE wildcard `_` is the identity-function shorthand
  //    (`Map(_, xs)` ≡ `Map(x ↦ x, xs)`). It falls through to the shorthand
  //    path below, which turns it into `(_1) ↦ _1`. Only the bare `_`
  //    qualifies: `_1`/`_2`/… are positional parameters of an ENCLOSING
  //    shorthand, and a named wildcard is a pattern variable — neither is an
  //    identity function.
  //
  if (isSymbol(expr) && !isSymbol(expr, '_')) return expr;

  //
  // 3/ `BuiltinFunction`, e.g. ["BuiltinFunction", "Sin"]
  //    This operator is just a "tag" indicating the nature of the
  //    symbol.
  //
  if (isFunction(expr, 'BuiltinFunction')) return expr.op1;

  //
  // 4/ Parenthesized expression, e.g. ["Delimiter", ["Sin", "_"], "'()'"]
  //
  if (isFunction(expr, 'Delimiter')) {
    // If the expression is a sequence, we need to extract the first
    // element
    const exprOp1 = expr.op1;
    if (isFunction(exprOp1, 'Sequence')) {
      if (exprOp1.nops === 1) {
        expr = exprOp1;
      } else {
        return canonicalFunctionLiteral(
          expr.engine._fn('Block', exprOp1.ops, { canonical: false }),
          options
        );
      }
    }

    return canonicalFunctionLiteral(
      isFunction(expr) ? expr.op1 : undefined,
      options
    );
  }

  //
  // 5/ Function expression
  //
  // If this is a function literal, split the body and the parameters
  // For example, `["Function", ["Add", "x", 1], "x"]`
  if (isFunction(expr, 'Function'))
    return canonicalFunctionLiteralOperands(expr.engine, expr.ops);

  //
  // 5.5/ An expression that DENOTES a function without being a literal — a
  //      qualified protocol member `Comparable.compare` (which is
  //      `Field(Comparable, "compare")`), `InverseFunction(f)`,
  //      `Derivative(f, n)` — is a function VALUE, exactly like the symbol
  //      case 2: return it unchanged and let application reach the value
  //      through evaluation (`makeLambda` routes it through `Apply`).
  //      Without this gate the shorthand path below reads it as a lambda
  //      BODY and turns its free symbols into parameters, so
  //      `Map(Comparable.compare, xs)` bound each ELEMENT to `Comparable`
  //      and mapped `Field(element, "compare")` — an absence marker per
  //      element. Same predicate as `apply()`'s symbolic-application gate,
  //      so the two tiers agree — plus its syntactic sibling for a RAW
  //      operand (a lazy operator's held callback), whose type still reads
  //      `unknown` and cannot answer the type-based predicate.
  //
  if (denotesFunction(expr) || isQualifiedProtocolMember(expr)) return expr;

  //
  // 6/ Shorthand function literal,
  // e.g. `["Add", "_", 1]` or `["Add", "x", 1]`
  //
  console.assert(expr.operator !== 'Function');

  const ce = expr.engine;
  let [body, params] = anonymousParameters(expr);

  if (params.length === 0) {
    // There are no wildcards

    // The caller knows the intended parameter list (`Integrate` passes its
    // integration variables): build the literal from the RAW body with those
    // parameters, so body occurrences bind to them through the normal §6.1
    // pre-declare mechanism in `canonicalFunctionLiteralArguments`. Inferring
    // parameters from the body's unknowns and swapping the parameter list
    // afterwards is NOT equivalent: the inferred parameters are declared in
    // the body scope and the body's occurrences bound to them, so the swap
    // leaves those occurrences bound to discarded parameters (Tycho item
    // 178(a): a parsed `∫_{-x}^{x} cos(x) dn` compared `isSame` false
    // against `ce.box()` of its own `.json`, because the body's `x` stayed
    // bound to a discarded inferred parameter while the bounds' `x` bound
    // the engine's). Wildcard parameters win over caller-supplied ones: a
    // body using `_` names its own parameters.
    if (options?.params !== undefined && options.params.length > 0)
      return canonicalFunctionLiteralArguments(ce, [body, ...options.params]);

    // Check if we have some unknowns
    // We'll need the canonical form of the expression, so we'll create a block if necessary
    if (body.operator !== 'Block') body = ce.function('Block', [body]);
    else body = body.canonical;
    const unknowns = body.unknowns;
    if (unknowns.length > 0) {
      params = unknowns.map((x) => ce.symbol(x, { canonical: false }));
      // Note: we assume the order of parameters is the order in
      // which they appear in the expression.
    }
  }

  return canonicalFunctionLiteralArguments(ce, [body, ...params]);
}

/**
 * Rebuild an INLINE function-literal operand with its unannotated parameters
 * wrapped in `["Typed", param, type]`, from the operand's RAW structure.
 *
 * This is the shared rewrite of the per-application element-type inference
 * (`docs/TYPE-SYSTEM.md`): a call site
 * that knows what a callback's parameter will be bound to annotates the
 * literal it passes, so the literal behaves EXACTLY like the hand-annotated
 * spelling — the body scope declares the parameter with that type, every
 * type-reading gate sees it, and a violated annotation is a loud error
 * (ruling 2, "annotation-as-contract").
 *
 * Returns the rewritten RAW literal, or `undefined` when nothing is rewritten.
 * The result is NEVER canonicalized here: the caller substitutes it into the
 * operand array and the normal canonicalization
 * (`canonicalFunctionLiteralArguments` and its §6.1 pre-declare mechanism)
 * derives the body from raw structure, which is what preserves capture. A
 * scope-graft of an already-bound body is the closure-capture bug factory.
 *
 * Declines, all v1 scope exclusions:
 * - a SYMBOL operand (`Filter(xs, f)`) — a named literal may be SHARED, and
 *   one application site must not retype it for every other. Deliberately
 *   discriminated on the RAW operand: `canonicalFunctionLiteral` LIFTS a
 *   symbol into a literal, so the canonical operand cannot tell the two
 *   spellings apart;
 * - a string, and any operand that is not `Function`-headed (the shorthand
 *   `_ > 5` lifts to a literal only later);
 * - an operand that is already CANONICAL — its raw structure is gone;
 * - a literal with no explicit parameter list, and any parameter that is
 *   already annotated (an author's annotation is never overwritten).
 */
export function annotateFunctionLiteralParams(
  ce: ComputeEngine,
  op: ExpressionInput,
  paramTypes: ReadonlyArray<Type | undefined>
): Expression | undefined {
  const raw = ce.expr(op, { form: 'raw' });
  if (raw.isCanonical) return undefined;
  if (!isFunction(raw, 'Function')) return undefined;

  const ops = raw.ops;
  // `["Function", body]` has no explicit parameter list: its parameters, if
  // any, are the anonymous wildcards the body mentions, which the shorthand
  // path derives later.
  if (ops.length < 2) return undefined;

  let rewritten = false;
  const params = ops.slice(1).map((param, i) => {
    const t = paramTypes[i];
    if (t === undefined) return param;
    // Not a bare symbol: an already-annotated parameter, or an error.
    if (!isSymbol(param)) return param;
    rewritten = true;
    // The same normalized spelling `normalizeTypedParameter` produces (a
    // string type operand), so the rebuilt literal is indistinguishable from
    // the hand-written one.
    return ce._fn('Typed', [param, ce.string(typeToString(t))], {
      canonical: false,
    });
  });
  if (!rewritten) return undefined;

  return ce._fn('Function', [ops[0], ...params], { canonical: false });
}

/**
 * Canonicalize the operands of a `["Function", …]` literal — the body followed
 * by its parameter list.
 *
 * This is `canonicalFunctionLiteralArguments` plus the anonymous-parameter
 * rule, and it is what every route that canonicalizes a *user-written*
 * `Function` literal must use (the `Function` operator's own `canonical`
 * handler, and `canonicalFunctionLiteral` for a function-slot operand).
 * Callers that synthesize a closure from a body and a known binder list (a
 * `Match` arm, `D`) deliberately use `canonicalFunctionLiteralArguments`
 * directly: their body's `_` is not a parameter.
 *
 * The rule: in `["Function", body]` — no explicit parameter list — anonymous
 * parameters used by the body (`_`, `_1`, …) ARE the parameter list, exactly
 * as in the shorthand spelling, so `["Function", ["Add", "_", 1]]` and
 * `["Add", "_", 1]` denote the same lambda. Without it the literal becomes a
 * NULLARY function that never binds its argument (`() ↦ _ + 1`), and
 * `Filter(xs, ["Function", ["Less", "_", 10]])` throws instead of filtering.
 *
 * This form is also the engine's OWN serialization: `toMathJson()` emits a
 * wildcard-parameter lambda by DROPPING the parameter list (see the `Function`
 * case of `serializePrettyJsonFunction`), so `["Function", ["Greater", "_1", 5]]`
 * has to round-trip back to the unary lambda it came from.
 *
 * A body with no wildcard keeps the literal nullary — `["Function", 42]` and
 * `["Function", ["Add", "x", 1]]` are thunks, not unary functions.
 *
 * Regressed in 0e8c11b9, which replaced `canonicalFunctionExpression` (it
 * derived the wildcard parameters from the body) with
 * `canonicalFunctionLiteral`, whose `Function` branch forwarded the operands
 * unchanged.
 */
export function canonicalFunctionLiteralOperands(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 1) {
    const [body, params] = anonymousParameters(ops[0]);
    if (params.length > 0)
      return canonicalFunctionLiteralArguments(ce, [body, ...params]);
  }
  return canonicalFunctionLiteralArguments(ce, ops);
}

/**
 * The anonymous ("wildcard") parameters `_`, `_1`, … `_9` that `expr` uses, in
 * index order, together with the body in which the bare `_` has been
 * normalized to `_1`. The parameter list is empty when the expression uses no
 * wildcard — the caller then decides what the parameters are (the shorthand
 * path falls back to the body's unknowns; the `["Function", body]` path keeps
 * the literal nullary).
 */
function anonymousParameters(
  expr: Expression
): [body: Expression, params: Expression[]] {
  // Replace '_' with '_1'
  const body = expr.subs({ _: '_1' });

  const params: Expression[] = [];
  for (let i = 1; i < 10; i++)
    if (body.has(`_${i}`))
      params.push(body.engine.symbol(`_${i}`, { canonical: false }));

  return [body, params];
}

/** Assuming that ops has the following form:
 * - body
 * - ...params
 * return a canonical function literal (["Function", body, ...params]) where
 * body is potentially wrapped in a Block expression and the arguments are
 * declared in the scope of the body.
 */
export function canonicalFunctionLiteralArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 0) return undefined;

  // ── The E2 pre-pass (generic-literals design §2.3), ordered FIRST ──────────
  //
  // A full-signature marker in the body slot is the literal's contract
  // of record. It has to be read BEFORE the parameter operands are normalized:
  // a hand-authored E2 (and the M2 lowering) may carry `["Typed", x, "'T'"]`
  // parameters, and `T` is not a declared type name — type resolution would
  // fail on it below. Under the erasure ruling (G1) those annotations are
  // redundant anyway: the marker states the parameter types, and quantified
  // positions are erased so the body canonicalizes exactly as an untyped
  // literal's does.
  const erased = eraseGenericParameters(ce, ops);
  let genericMarker = false;
  if (erased !== undefined) {
    // A well-formedness violation is reported in place; otherwise continue with
    // the erased operands.
    if (erased.error !== undefined) return erased.error;
    ops = erased.ops!;
    genericMarker = erased.generic === true;
  }

  // Signature-string sugar (typed-literals design §3.2/§10):
  // `["Function", body, "'(n: integer) -> complex'"]` desugars into the
  // structural form — each named argument becomes a `["Typed", name, type]`
  // parameter and a non-`unknown` result becomes the body's return-type
  // ascription. Applied only when the single parameter operand is a string
  // parsing to a signature type with every argument named and no
  // optional/variadic markers (those need `makeLambda` arity support);
  // anything else falls through to the standard expected-a-symbol error —
  // except a string that IS signature-shaped and fails to parse as a type,
  // which reports the type parser's own diagnostic (see
  // `signatureStringError`) rather than blaming the operand.
  if (ops.length === 2 && isString(ops[1])) {
    // A `where` clause IS accepted here (generic-literals design §2.2, E1):
    // the string parses to a signature carrying `typeParams` and desugars into
    // the E2 form — bare symbols at the quantified positions (erasure, G1) and
    // the full signature as the body's ascription — which then re-enters this
    // function and takes the E2 pre-pass above.
    const desugared = desugarSignatureString(ce, ops[0], ops[1].string);
    if (desugared?.error !== undefined)
      return ce._fn('Function', [ops[0], desugared.error]);
    if (desugared !== undefined)
      return canonicalFunctionLiteralArguments(ce, desugared.ops!);
  }

  // Parameters: a bare symbol (inferred type) or an annotated parameter
  // `["Typed", symbol, type]`. Anything else is an error. An annotated
  // parameter keeps its `Typed` wrapper, normalized so the type operand is a
  // string (mirroring how `Declare` keeps its type operand raw).
  const params = ops.slice(1).map((x) => {
    if (isSymbol(x)) return x;
    // A DESTRUCTURING parameter — a raw `["Tuple", …]` pattern, spelled
    // `((p, q)) => …` in Epsil. It counts as one parameter and binds its leaf
    // names; the pattern operand is kept RAW (`isDestructuringParameter`).
    if (isDestructuringParameter(x)) {
      const bad = illFormedPatternLeaf(x);
      if (bad !== undefined) return ce.error('expected-a-symbol', bad);
      return x;
    }
    if (isFunction(x, 'Typed') && isSymbol(x.op1)) {
      const normalized = normalizeTypedParameter(ce, x);
      // A `where` clause on a PARAMETER annotation is a rank-2 spelling, and
      // stays rejected (G6, §2.2): a type variable enters a literal only
      // through a whole-signature clause.
      const t = functionLiteralParameterType(normalized);
      if (t !== undefined && isPolymorphicType(t))
        return ce.error(TYPE_VARIABLE_INTRODUCTION_MESSAGE, x.toString());
      return normalized;
    }
    return ce.error('expected-a-symbol', x.toString());
  });

  // Collect the declared types of annotated parameters so they are visible
  // during body canonicalization (the §6.1 pre-declare mechanism). A
  // destructuring pattern contributes every leaf name it binds — each is an
  // ordinary parameter as far as the body is concerned, and each must shadow a
  // library constant of the same spelling exactly as a named parameter does.
  const shadowNames: string[] = [];
  const shadowTypes = new Map<string, Type>();
  for (const param of params) {
    const names = functionLiteralParameterNames(param);
    if (names.length === 0) continue;
    shadowNames.push(...names);
    const t = functionLiteralParameterType(param);
    if (t !== undefined) shadowTypes.set(names[0], t);
  }

  // A body-slot return-type ascription `["Typed", body, type]` is normalized
  // per §4.2: the `Typed` wrapper moves INSIDE the Block, wrapping the last
  // statement, so the body slot stays a scoped Block.
  let bodyOp = ops[0];
  let returnTypeOp: Expression | undefined;
  if (isFunction(bodyOp, 'Typed')) {
    returnTypeOp = normalizeTypeOperand(ce, bodyOp.op2);
    // A polytype in the body slot is ALWAYS a full signature (§2.2), and a
    // well-formed one was already recognized — and its quantified parameter
    // positions erased — by the E2 pre-pass above. Anything polymorphic still
    // arriving here is not a single signature (an overload INTERSECTION with a
    // generic arm), which is not a shape a literal can implement.
    if (
      !genericMarker &&
      isString(returnTypeOp) &&
      isPolytypeString(ce, returnTypeOp.string)
    )
      return ce._fn('Function', [
        ce.error(INVALID_SIGNATURE_MARKER_MESSAGE, returnTypeOp.string),
        ...params,
      ]);
    bodyOp = bodyOp.op1;
  }

  // If the body is not scoped, we need to create a new scope
  // and add the parameters to it.
  // `["Function", ["Add", "_", 1], "_"]`
  // becomes `["Function", ["Block", ["Add", "_", 1]], "_"]`
  //
  // The body is canonicalized here. While it is, the parameter names are pushed
  // onto the engine's shadowed-parameter stack so a parameter named like a
  // constant (`i`, `e`, ...) resolves to the parameter, not the constant —
  // `Function(2·i, i)` stays `(i) ↦ 2·i` instead of becoming `(i) ↦ 2i`. The
  // shadowing only blocks the constant substitution; the parameter is still
  // auto-declared as an ordinary local in the body scope, so the closure-capture
  // machinery is unaffected. Annotated parameters additionally carry their
  // declared type so the auto-declaration uses that type (see §6.1).
  ce._pushShadowedParameters(
    shadowNames,
    shadowTypes.size > 0 ? shadowTypes : undefined
  );
  // Collect the juxtapositions the body reads as multiplication only because
  // their leading symbol has no function definition yet — see
  // `boxed-expression/provisional-application.ts`.
  beginProvisionalCapture();
  let provisionalHeads: ReadonlySet<string> | undefined;
  let block: Expression;
  let shadowedDefs: ReadonlyMap<string, BoxedDefinition> = new Map();
  try {
    if (returnTypeOp === undefined) {
      if (isFunction(bodyOp, 'Block')) {
        block = bodyOp.canonical;
        // `get canonical` short-circuits on an invalid expression (a `Block`
        // containing an `Error` node) and returns it unbound — and therefore
        // unscoped. Rebuild it from its statements so `Block`
        // canonicalization runs and creates the scope the parameter
        // declarations below rely on. An EMPTY statement list stays unscoped
        // through the rebuild too (`canonicalBlock` declines zero operands),
        // so it takes the annotated branch's convention: the body is
        // `Nothing`.
        if (!block.isScoped)
          block = ce.function(
            'Block',
            bodyOp.nops === 0 ? [ce.Nothing] : [...bodyOp.ops]
          );
      } else block = ce.function('Block', [bodyOp]);
    } else {
      // Wrap the body Block's last statement in the return-type ascription.
      const statements: Expression[] = isFunction(bodyOp, 'Block')
        ? [...bodyOp.ops]
        : [bodyOp];
      if (statements.length === 0) statements.push(ce.Nothing);
      const lastIdx = statements.length - 1;
      statements[lastIdx] = ce._fn(
        'Typed',
        [statements[lastIdx], returnTypeOp],
        { canonical: false }
      );
      block = ce.function('Block', statements);
    }
    // Read the bindings the body's bare-parameter references auto-declared
    // (and shared) while the frame is still on the stack — the parameter
    // declarations below adopt them.
    shadowedDefs = ce._currentShadowedParameterDefs();
  } finally {
    provisionalHeads = endProvisionalCapture();
    ce._popShadowedParameters();
  }

  console.assert(block.isScoped);
  // Declare the arguments in the scope of the body of the function, for any
  // parameter that was not already auto-declared during body canonicalization
  // (e.g. a parameter unreferenced in the body). Annotated parameters get
  // their declared type, non-inferred.
  for (const param of params) {
    for (const name of functionLiteralParameterNames(param)) {
      if (block.localScope!.bindings.has(name)) continue;
      // A destructuring pattern's leaves carry no annotation of their own, so
      // they always take the bare-parameter branch below.
      const t = isDestructuringParameter(param)
        ? undefined
        : functionLiteralParameterType(param);
      if (t !== undefined)
        ce.declare(name, { inferred: false, type: t }, block.localScope);
      else {
        // A bare parameter whose first reference sat in a NESTED Block scope
        // (an `if` branch, a loop body) auto-declared its shared binding there,
        // not here. Adopt that binding as the parameter's: it is the one every
        // body occurrence resolves to, and the one that carries the type
        // evidence inference wrote (e.g. `cs[j]` ⇒ `cs: indexed_collection`).
        // Declaring a fresh `unknown` binding instead severs the signature from
        // the body's evidence, and the lambda auto-broadcast then wrongly maps
        // the function over a collection argument that the body consumes whole.
        const shared = shadowedDefs.get(name);
        if (shared !== undefined) {
          // Checkpoint journal (funnel 4): a binding write outside the declare
          // routes. The target is the literal's own block scope, which a
          // restore normally discards along with the literal — journaled all
          // the same, because a re-canonicalization of a literal that PREDATES
          // the window writes into a scope the window must be able to rewind.
          journalCheckpointMapEntry(
            ce,
            block.localScope!.bindings,
            name,
            name,
            'declare'
          );
          block.localScope!.bindings.set(name, shared);
        } else
          ce.declare(
            name,
            { inferred: true, type: 'unknown' },
            block.localScope
          );
      }
    }
  }

  // Re-bind parameter occurrences that were canonicalized OUTSIDE this Block.
  //
  // Canonicalizing an already-canonical body is a no-op, so a body that was
  // bound before the literal was built keeps those bindings — and its
  // parameter occurrences then denote whatever the enclosing scope had, not
  // this literal's parameters. The shorthand route does exactly that: `Pipe`
  // is lazy and takes `.canonical` of its right operand, so `x |> Map(f, _)`
  // binds `_1` in the CALLER's scope before `Map(f, _1)` is wrapped into
  // `(_1) ↦ Map(f, _1)`. The parameter then looks like a free variable, and
  // anything keyed on binding — the post-evaluation substitution in
  // `makeLambda`, symbol equality — cannot see it is the parameter.
  //
  // Rebinding is scoped to the names this literal binds, so nothing else in
  // the body moves.
  block = rebindParameters(block, params);

  const literal = ce._fn('Function', [
    block,
    ...bindParameterOperands(ce, block, params),
  ]);

  // Resolve the annotations NOW, while the scope that declares any
  // user-declared type name they use is still current: the literal can escape
  // it (assigned outward, returned, stored in a collection) and its type
  // operands are TEXT, which no longer resolves from where a later reader
  // stands. See `RESOLVED_TYPE_OPERANDS` (`function-literal.ts`).
  resolveFunctionLiteralTypes(literal);

  // Definition order must not change semantics. If the body froze a
  // juxtaposition as multiplication only because its leading symbol had no
  // function definition at this moment, keep the RAW operands so the literal
  // can be re-derived when that symbol gains one
  // (`repairProvisionalDependents`).
  // The literal may also be a RE-canonicalization of one already built (the
  // `Function` operator's canonical handler runs a second time, on the
  // literal's own operands): its body is then the very `Block` recorded the
  // first time round, and the raw operands to re-derive from are the ones
  // recorded with it.
  const provisional =
    provisionalHeads !== undefined
      ? {
          ops,
          heads: provisionalHeads,
          scope: ce.context.lexicalScope,
        }
      : provisionalLiteral(ops[0]);

  if (provisional !== undefined) {
    setProvisionalLiteral(literal, provisional);
    setProvisionalLiteral(block, provisional);
  }

  return literal;
}

/** Definitions currently being re-derived, so a repair that itself installs a
 * definition cannot re-enter one. */
const REPAIRING = new WeakSet<object>();

/** The `Function` literal a dependent currently holds: the operator
 * definition's lambda, or the value definition's value. */
function dependentLiteral(def: ProvisionalDependent): Expression | undefined {
  if ('signature' in def)
    return (def as { _lambdaLiteral?: Expression })._lambdaLiteral;
  return def.value;
}

/** Install a re-derived literal on a dependent, whichever kind it is.
 *
 * Rollback journal: this is the ONE site that mutates a pre-existing
 * definition IN PLACE during the provisional-repair cascade — it does NOT
 * route through `updateDef`, whose half-swap journaling therefore cannot
 * capture it (`docs/TYPE-SYSTEM.md`, family 3 "As
 * implemented" note). While a rollback frame is open, each kind snapshots
 * exactly what its install mutates: the operator kind the
 * `_update({evaluate})`-reachable fields (`_rederivationSnapshot`), the
 * value kind the coupled type/value slots (`_typeSlotSnapshot` — the value
 * setter recomputes `_isSelfReferential`, which rides in the tuple). The
 * registry re-registrations are journaled by the registry's own hooks
 * (family 5). */
function installRebuiltLiteral(
  ce: ComputeEngine,
  def: ProvisionalDependent,
  rebuilt: Expression
): void {
  const frame = activeRollbackFrame(ce);
  // Effects-axis provenance (W2 of
  // `docs/EFFECTS-MODEL.md`): the re-derivation
  // re-stamps the inferred effect set from the rebuilt body, and a change
  // records an entry whose cause is the REBUILT literal — deliberately
  // overriding any ambient canonicalization cause, which would
  // misattribute the re-derivation to the enclosing expression.
  const effectsBefore = effectsContractStateOf(def);
  // `_update()` re-registers the definition for whatever names the rebuilt body
  // still reads provisionally.
  if ('signature' in def) {
    if (frame !== undefined) {
      const snapshot = def._rederivationSnapshot();
      frame.record({
        undo: () => def._restoreRederivationSnapshot(snapshot),
      });
    }
    def._update({ evaluate: rebuilt });
    recordEffectsTransition(
      ce,
      def,
      effectsBefore,
      effectsContractStateOf(def),
      def.signature,
      rebuilt
    );
  } else {
    if (frame !== undefined) {
      const snapshot = def._typeSlotSnapshot();
      frame.record({ undo: () => def._restoreTypeSlots(snapshot) });
    }
    def.value = rebuilt;
    registerProvisionalDependents(ce, rebuilt, def);
    // No effects-provenance recording on this branch — deliberately. The
    // `value` setter writes the stored expression only; it never touches the
    // definition's `type` or `effectsDeclared`, which are the two fields the
    // effects contract state is read from, so the before/after comparison a
    // recording would make is identical by construction and could never
    // produce an entry. (W2 of the effects-axis provenance design covers the
    // OPERATOR branch above, whose `_update()` genuinely re-derives and
    // re-stamps the effect set.) Note the flip side, recorded in ROADMAP.md:
    // a value-bound literal under a DECLARED effects contract is rebuilt here
    // with no contract re-verification at all.
  }
}

/** The name a dependent definition is installed under. Both definition classes
 * are constructed with it (`_BoxedOperatorDefinition`,
 * `_BoxedValueDefinition`), but it is not on the public definition interfaces,
 * so read it defensively: a dependent with no readable name simply does not
 * cascade. */
function dependentName(def: ProvisionalDependent): string | undefined {
  const name = (def as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** How deep the `repairWave` recursion currently is. Depth 0 on entry marks
 * the OUTERMOST wave: the one that owns the deferred queue below, because it
 * is the only one that runs after every `REPAIRING` guard has been released. */
let WAVE_DEPTH = 0;

/** Dependents skipped because an enclosing wave already held them under the
 * `REPAIRING` guard, with the name whose wave skipped them. Nothing else
 * retriggers such a definition, so it would stay stale forever: with
 * `outer(a,b) = middle(a) + base(b)`, `middle(a) = base(a)`, `outer`
 * registered on `base` BEFORE `middle`, installing `base` rebuilds `outer`
 * against middle's stale signature, and middle's cascade then finds `outer`
 * guarded and skips it. Drained by the outermost wave. */
let DEFERRED: { name: string; def: ProvisionalDependent }[] = [];

/** Rebuilds already spent on each definition in the current top-level wave,
 * reset when it ends. */
let REBUILD_COUNTS: WeakMap<ProvisionalDependent, number> | undefined;

/** Rebuilds allowed per definition per top-level wave. Two, because the
 * sibling shape above needs exactly a second rebuild (once in the wave that
 * skipped it, once from the drain) and nothing legitimately needs a third: a
 * genuinely cyclic, evidence-free pair would otherwise re-defer each other
 * without end. A definition that hits the cap stays REGISTERED, so a later
 * definition of a name it waits on still retries it. */
const MAX_REBUILDS_PER_WAVE = 2;

/**
 * `name` just became callable: re-derive every definition whose body read
 * `name` as a multiplication operand, from the raw operands recorded at
 * canonicalization time.
 *
 * Injected into `boxed-expression/provisional-application.ts` by
 * `init-lazy-refs.ts` — `updateDef` (`boxed-expression/utils.ts`) is the choke
 * point that fires it, and it cannot import this module.
 */
export function repairProvisionalDependents(
  ce: ComputeEngine,
  name: string,
  justInstalled?: ProvisionalDependent
): void {
  const outermost = WAVE_DEPTH === 0;
  let firstError: { error: unknown } | undefined;
  WAVE_DEPTH += 1;
  try {
    repairWave(ce, name, justInstalled);
  } catch (error) {
    firstError = { error };
  } finally {
    WAVE_DEPTH -= 1;
  }

  if (outermost) {
    // Every guard this wave took is released by now, so a skipped dependent
    // can be repaired. Each drained repair can itself skip (and defer) more,
    // so loop until the queue is empty; `MAX_REBUILDS_PER_WAVE` is what
    // bounds it. The waves fired from here are not outermost — they append to
    // the queue this loop is draining rather than starting a drain of their
    // own.
    WAVE_DEPTH += 1;
    try {
      while (DEFERRED.length > 0) {
        const batch = DEFERRED;
        DEFERRED = [];
        // The defs were re-registered when they were skipped, so firing the
        // name once picks up every dependent that queued under it.
        const fired = new Set<string>();
        for (const entry of batch) {
          if (fired.has(entry.name)) continue;
          fired.add(entry.name);
          try {
            repairWave(ce, entry.name);
          } catch (error) {
            firstError ??= { error };
          }
        }
      }
    } finally {
      WAVE_DEPTH -= 1;
      DEFERRED = [];
      REBUILD_COUNTS = undefined;
    }
  }

  if (firstError !== undefined) throw firstError.error;
}

/** One re-derivation wave. See `repairProvisionalDependents`, which wraps it
 * with the deferred-queue drain. */
function repairWave(
  ce: ComputeEngine,
  name: string,
  justInstalled?: ProvisionalDependent
): void {
  const defs = takeProvisionalDependents(ce, name);
  if (defs === undefined) return;
  // A rebuild can THROW: the definition constructors validate (a violated
  // effect contract, an invalid body). The queue has already been drained, so
  // an error escaping the loop would lose every dependent not yet processed.
  // Each one is therefore rebuilt in isolation; a failed one keeps its previous
  // definition (`_update()` constructs before it swaps) and is RE-REGISTERED so
  // a later redefinition of `name` retries it; and the first error is rethrown
  // once the loop is done — a contract violation must still surface.
  let firstError: { error: unknown } | undefined;
  // Every definition this wave puts under the `REPAIRING` guard, released
  // together once the wave — INCLUDING the cascade below — is done. See the
  // cascade comment for why the release cannot happen per-definition.
  const guarded: ProvisionalDependent[] = [];
  // The definitions this wave actually re-installed, with the name each is
  // installed under. Collected during the loop and cascaded AFTER it (see
  // below), not fired per-rebuild.
  const cascade: { name: string; def: ProvisionalDependent }[] = [];
  try {
    for (const def of defs) {
      if (REPAIRING.has(def)) {
        // Mid-repair further up the stack, or held under the guard until its
        // own wave's cascade finishes. Either way it must go BACK into the
        // registry: `takeProvisionalDependents` has already removed it, and
        // since the cascade keeps a definition guarded well after its own
        // rebuild re-registered it, dropping it here would leave it waiting on
        // nothing — permanently unrepairable by a later definition of `name`.
        registerProvisionalDependents(ce, dependentLiteral(def), def);
        // Re-registering alone does not retrigger it, so queue it for the
        // drain the outermost wave runs once the guards are released.
        if ((REBUILD_COUNTS?.get(def) ?? 0) < MAX_REBUILDS_PER_WAVE)
          DEFERRED.push({ name, def });
        continue;
      }
      // The definition just installed FOR `name` is dropped, not re-derived: it
      // is a recursive body waiting on itself, and re-canonicalizing it against
      // its own fresh definition cannot teach it anything (direct body evidence
      // was already captured in flight). Dropping rather than re-registering is
      // safe: a later redefinition of `name` registers fresh dependents.
      if (def === justInstalled) continue;
      const literal = dependentLiteral(def);
      const info = provisionalLiteral(literal);
      if (info === undefined || !info.heads.has(name)) continue;
      const rebuilds = (REBUILD_COUNTS ??= new WeakMap());
      const spent = rebuilds.get(def) ?? 0;
      if (spent >= MAX_REBUILDS_PER_WAVE) {
        // Out of budget for this top-level wave. Back into the registry, so a
        // later definition still retries it.
        registerProvisionalDependents(ce, literal, def);
        continue;
      }
      rebuilds.set(def, spent + 1);
      REPAIRING.add(def);
      guarded.push(def);
      try {
        // Re-canonicalized in the scope the literal was built in: its free
        // symbols must resolve exactly as they did then, except for the one that
        // has since become a function.
        const rebuilt = ce._inScope(info.scope, () =>
          canonicalFunctionLiteralArguments(ce, info.ops)
        );
        // Installed even when the rebuilt literal is INVALID: a fresh parse made
        // after `name` was defined produces exactly that invalid application, and
        // fresh-parse parity is the contract. Keeping the stale product instead
        // would silently answer a different question.
        if (rebuilt !== undefined && rebuilt !== literal) {
          installRebuiltLiteral(ce, def, rebuilt);
          const installedName = dependentName(def);
          if (installedName !== undefined)
            cascade.push({ name: installedName, def });
        }
      } catch (error) {
        firstError ??= { error };
        registerProvisionalDependents(ce, literal, def);
      }
    }

    // A successful rebuild IS that definition's own name gaining a better
    // definition — `middle` now takes a list — but `installRebuiltLiteral`
    // mutates the definition in place (`def._update()` / `def.value = …`) and
    // never passes through `updateDef`, the choke point that fires the repair.
    // So fire it here, or a chain `outer → middle → inner` would leave `outer`
    // stale once `inner` arrives.
    //
    // COLLECT-THEN-FIRE, breadth-wise: the cascade runs after the whole loop
    // above, not inside it. In a diamond — `top` depending on `left` and
    // `right`, both depending on `base` — installing `base` rebuilds `left`
    // and `right` in this wave, and `top` is then rebuilt ONCE, against two
    // already-current forwarders, instead of once per forwarder. Error
    // isolation also stays per level: a cascaded wave that throws does not
    // cost this wave its remaining siblings.
    //
    // Each rebuilt definition is passed as `justInstalled` so it is not
    // re-derived against itself, exactly as on the `updateDef` route.
    for (const entry of cascade) {
      try {
        repairProvisionalDependents(ce, entry.name, entry.def);
      } catch (error) {
        firstError ??= { error };
      }
    }
  } finally {
    // Released only now. A definition must stay guarded through the cascade of
    // its OWN repair wave: that is what cuts a mutual forward reference. With
    // `pa` and `pb` waiting on each other, repairing `pb` cascades to `pa`,
    // whose cascade comes back to `pb` — still in `REPAIRING`, so it is skipped
    // and the recursion bottoms out. Deleting per-definition inside the loop
    // (as this did before the cascade existed) would make that cycle
    // unbounded.
    for (const def of guarded) REPAIRING.delete(def);
  }
  if (firstError !== undefined) throw firstError.error;
}

/**
 * The first leaf of a destructuring parameter pattern that is not a binding
 * position, rendered for a diagnostic, or `undefined` when the pattern is
 * well formed.
 *
 * A pattern in PARAMETER position is a BINDING pattern, not a `match` pattern:
 * its leaves are names (`_` discards a position) and nested patterns. A literal
 * or an expression leaf — `((1, q)) => …` — has nothing to bind, so it is
 * rejected rather than read as a value to match against.
 */
function illFormedPatternLeaf(pattern: Expression): string | undefined {
  if (!isFunction(pattern, 'Tuple')) return undefined;
  for (const el of pattern.ops) {
    if (isFunction(el, 'Tuple')) {
      const bad = illFormedPatternLeaf(el);
      if (bad !== undefined) return bad;
      continue;
    }
    if (!isSymbol(el)) return el.toString();
  }
  return undefined;
}

/**
 * Make each PARAMETER OPERAND denote the binding the body `Block` declares for
 * it — step 5 of the binder discipline
 * (`docs/SCOPING-MODEL.md`), for the one binder
 * that is not definition-driven.
 *
 * What arrived there differed by route, exactly as it did for `Series` and
 * `Integrate` before their migration: the parse and `ce.box` routes leave the
 * parameter RAW (a symbol with no definition), while
 * `ce.function('Function', [body, ce.symbol('x')])` hands over a symbol
 * carrying the CALLER's binding — a binding that has nothing to do with this
 * literal and, for a caller-assigned `x`, holds a value.
 *
 * Afterwards the literal has exactly ONE binding for the parameter, referenced
 * from both the parameter operand and the body's occurrences. That is what
 * makes the "two live bindings at once" state (`Limit`'s migration attempt,
 * §Stages 5–8 round) detectable rather than silent: a second binder declaring
 * the parameter in ITS scope would show up here as a parameter operand that no
 * longer matches the body.
 */
function bindParameterOperands(
  ce: ComputeEngine,
  block: Expression,
  params: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const scope = block.localScope;
  if (!scope) return params;
  const bindLeaf = (leaf: Expression): Expression => {
    if (isFunction(leaf, 'Tuple'))
      return ce._fn('Tuple', leaf.ops.map(bindLeaf), { canonical: false });
    const name = sym(leaf);
    if (name === undefined || name === '_') return leaf;
    return ce._bindingSymbol(name, scope) ?? leaf;
  };
  return params.map((param) => {
    // A destructuring pattern binds through its LEAVES: each is pointed at the
    // Block's own binding, the same repair the named-parameter branch below
    // makes, so `staticParameterBinding` can read a leaf's definition straight
    // off the operand.
    if (isDestructuringParameter(param)) return bindLeaf(param);
    const name = functionLiteralParameterName(param);
    if (!name) return param;
    // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
    // module cannot import).
    const binding = scope.bindings.get(name);
    if (binding === undefined || !('value' in binding)) return param;
    const def = (binding as { value: BoxedValueDefinition }).value;
    const site = isFunction(param, 'Typed') ? param.op1 : param;
    if (
      (site as { valueDefinition?: BoxedValueDefinition }).valueDefinition ===
      def
    )
      return param;
    // Built on the Block's OWN binding rather than by name: `ce.symbol()` would
    // short-circuit to the interned constant for a parameter named after one
    // (`Pi`, `e`, `i`, ...) and hand back something that is not this
    // parameter at all.
    const bound = ce._bindingSymbol(name, scope);
    if (bound === undefined) return param;
    if (!isFunction(param, 'Typed')) return bound;
    return ce._fn('Typed', [bound, param.op2], { canonical: false });
  });
}

/** Point every occurrence of this literal's parameter names at the binding the
 * body Block declares for them. See the call site for why an already-canonical
 * body can arrive bound elsewhere.
 *
 * EVERY parameter, named as well as anonymous. The invariant is that a
 * parameter occurrence in the body denotes THIS literal's parameter — and
 * nothing else about the body moves, because only the names this literal binds
 * are targets and only occurrences that resolve elsewhere are touched.
 *
 * This used to be restricted to the anonymous placeholders (`_`, `_1`, …)
 * produced by the shorthand/pipe desugaring, because widening it broke three
 * things. All three were the same latent defect rather than a reason to keep
 * the restriction, and are fixed: `Integrate` handed the antiderivative
 * machinery a body still bound to the literal's Block while that machinery
 * minted the integration variable in the caller's scope (`liftIntegrand`,
 * `library/calculus.ts`), and a BINDING SITE held raw by a lazy operator must
 * not be canonicalized (the raw-occurrence rule of `rebindToBindings`).
 *
 * The walk itself is `rebindToBindings` (`binders.ts`), shared with the binder
 * mechanism's post-phase: this is the same repair, for the one binder that is
 * not definition-driven. */
function rebindParameters(
  block: Expression,
  params: ReadonlyArray<Expression>
): Expression {
  const scope = block.localScope;
  if (!scope) return block;

  const names: string[] = [];
  for (const param of params) {
    for (const name of functionLiteralParameterNames(param)) {
      if (names.includes(name)) continue;
      // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
      // module cannot import).
      const binding = scope.bindings.get(name);
      if (binding !== undefined && 'value' in binding) names.push(name);
    }
  }
  if (names.length === 0) return block;

  // The replacement symbols are built on the Block's OWN bindings
  // (`_bindingSymbol`), not resolved by name: `ce.symbol()` binds against the
  // current lexical scope — the enclosing one — and, for a parameter named
  // after a library constant, short-circuits to the constant even inside the
  // Block's scope. The rewrite itself still runs in that scope, so a node it
  // rebuilds canonicalizes where its operands are bound. `skipRootBinds`: the
  // Block's own bindings ARE the rebind targets, so the root must not shadow
  // them; a nested binder that re-binds one of these names owns its
  // occurrences (`shadowed`).
  const ce = block.engine;
  const targets = new Map<string, Expression>();
  for (const name of names) {
    const bound = ce._bindingSymbol(name, scope);
    if (bound !== undefined) targets.set(name, bound);
  }
  return ce._inScope(scope, () =>
    rebindToBindings(block, scope, targets, { skipRootBinds: true })
  );
}

/**
 * The full signature a `Function` literal's body-slot marker declares
 * (`["Function", ["Typed", body, "'(x: T) -> T where T'"], "x"]`, or the
 * ground `"'(x: number) -> number'"`), or `undefined` when the body slot
 * carries no such marker.
 *
 * The decomposition predicate of `functionLiteralDeclaredSignature`, read
 * BEFORE canonicalization: an UNGROUPED signature spelling is the literal's own
 * contract; a grouped one (`"'((number) -> number)'"`) is an ordinary
 * return-type ascription and never reaches the well-formedness check below.
 *
 * Deliberately narrower than `isPolytypeString`: only a single SIGNATURE is a
 * shape a literal can implement. An overload intersection with a generic arm
 * parses as a polytype too, and is left for the return-slot rejection.
 */
function bodySlotSignature(
  ce: ComputeEngine,
  body: Expression | undefined
): { sig?: FunctionSignature; error?: Expression } | undefined {
  // Both marker shapes `functionLiteralReturnMarker` reads: the authoring form
  // `["Typed", body, sig]` in the body slot, and the CANONICAL form, where the
  // marker has moved INSIDE the Block and wraps its last statement. A
  // hand-authored canonical-form literal reaches this route too, and the reader
  // downstream (`functionLiteralDeclaredSignature`) recognizes it as the
  // contract — so it must take the same well-formedness and erasure pass.
  const marker = isFunction(body, 'Block') ? body.ops[body.nops - 1] : body;
  if (!isFunction(marker, 'Typed')) return undefined;
  const op = marker.op2;
  if (op === undefined) return undefined;
  const s = isString(op) ? op.string : sym(op);
  // `->` is a necessary condition for a signature spelling: the cheap gate that
  // keeps an ordinary `-> real` ascription off the resolver-parse path.
  if (s === undefined || !s.includes('->')) return undefined;
  if (isGroupedTypeText(s)) return undefined;
  let t: Type;
  try {
    t = parseType(s, ce._typeResolver);
  } catch (e) {
    // The text IS signature-shaped (ungrouped, with an arrow), so the failure
    // is the author's contract not parsing — not "this is not a marker".
    // Swallowing it here dropped the whole ascription silently (an Epsil
    // `function f<U>(x: U) -> tr<U, U>` typed as `(unknown) -> unknown`).
    return { error: signatureStringError(ce, s, e) };
  }
  if (typeof t === 'string' || t.kind !== 'signature') return undefined;
  return { sig: t };
}

/**
 * The error expression for a signature-string annotation — the E1 sugar's
 * parameter-slot string or the E2 body-slot marker — that is signature-shaped
 * but does not parse as a type.
 *
 * A structured `TypeVariableError` code (`generic-alias-arity`,
 * `variance-violation`, …) becomes the error's own code, so the real cause
 * survives; anything else the type parser rejects is reported as
 * `invalid-type-annotation` carrying the type parser's message. The code is
 * also the head of a `TypeVariableError`'s message, so it is stripped from the
 * detail rather than repeated.
 */
function signatureStringError(
  ce: ComputeEngine,
  signature: string,
  e: unknown
): Expression {
  const err = e as { code?: string; rawMessage?: string };
  let detail = err.rawMessage ?? (e instanceof Error ? e.message : String(e));
  if (err.code !== undefined && detail.startsWith(`${err.code}: `))
    detail = detail.slice(err.code.length + 2);
  return ce.error(
    [err.code ?? 'invalid-type-annotation', detail],
    `"${signature}"`
  );
}

/**
 * The E2 pre-pass (generic-literals design §2.3): validate a full-signature
 * marker in the body slot and ERASE the parameter annotations it quantifies.
 *
 * Returns `undefined` when there is no such marker (the overwhelmingly common
 * case — one `isFunction(_, 'Typed')` test), `{ error }` when the marker is not
 * well-formed, and `{ ops, generic }` with the erased operands otherwise.
 *
 * A GROUND marker (`"'(x: number) -> number'"`) takes the well-formedness half
 * only — it quantifies nothing, so there is nothing to erase. It is checked
 * because it is a contract of record just as a quantified one is (ruled
 * 2026-08-04): an arity mismatch means the author wrote a signature that the
 * literal cannot implement, and the "returns a function" reading has its own
 * spelling (a GROUPED marker), which never reaches here.
 *
 * **Well-formedness.** The marker is the literal's contract of record, not a
 * cosmetic mirror, so its shape is checked: a plain signature (no optional or
 * variadic arguments in v1) with exactly as many arguments as the literal has
 * parameters. **Positional mapping is authoritative** — the marker's argument
 * NAMES are cosmetic, the literal's operand names stay the names of record
 * (the `docs/EFFECTS-MODEL.md` mirror rule).
 *
 * **Erasure (G1).** A parameter whose marker argument type mentions a
 * quantified variable loses its own `Typed` annotation and becomes a bare
 * symbol, so the body canonicalizes exactly as an untyped literal's does and no
 * type variable ever becomes the type of a symbol (the §4.2 ground invariant).
 * A GROUND annotation at a ground marker position is kept and enforced as
 * usual; a ground annotation at a quantified position is dropped in favour of
 * the marker (single source of truth) — but only once it is known to COVER the
 * variable's bound (§2.4 rule 4). The declaration boundary cannot answer that
 * question on this route: it reads the literal's parameters AFTER erasure, by
 * which point a contradicting annotation no longer exists.
 */
function eraseGenericParameters(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
):
  | { ops?: ReadonlyArray<Expression>; error?: Expression; generic?: boolean }
  | undefined {
  const marker = bodySlotSignature(ce, ops[0]);
  if (marker === undefined) return undefined;

  const params = ops.slice(1);
  if (marker.error !== undefined)
    return { error: ce._fn('Function', [marker.error, ...params]) };
  const sig = marker.sig!;

  const args = sig.args ?? [];
  if (
    sig.optArgs !== undefined ||
    sig.variadicArg !== undefined ||
    args.length !== params.length
  )
    return {
      error: ce._fn('Function', [
        ce.error(INVALID_SIGNATURE_MARKER_MESSAGE, typeToString(sig)),
        ...params,
      ]),
    };

  // A GROUND marker quantifies nothing: the well-formedness check above is the
  // whole pre-pass for it, and every parameter annotation stays.
  if (!isPolymorphicType(sig)) return { ops, generic: false };

  // §2.4 rule 4 (CONTRAVARIANT): a ground annotation at a quantified position
  // must accept every instantiation the clause admits — `bound <: annotation`.
  // `substituteDeclaredBounds` leaves an UNBOUNDED variable alone; its
  // kind-level reading is `any`, so supply that bound explicitly (as
  // `acceptsGenericFunctionLiteral` does at the declaration boundary).
  const bounded = (sig.typeParams ?? []).map((p) =>
    p.bound === undefined ? { ...p, bound: 'any' as Type } : p
  );

  let erased = false;
  let coverageError: Expression | undefined;
  const newParams = params.map((p, i) => {
    if (!isFunction(p, 'Typed') || !isSymbol(p.op1)) return p;
    if (!mentionsQuantifiedVariable(args[i].type, sig)) return p;
    const annotation = functionLiteralParameterType(p);
    if (
      coverageError === undefined &&
      annotation !== undefined &&
      !isSubtype(substituteDeclaredBounds(bounded, args[i].type), annotation)
    )
      coverageError = ce.error(
        GENERIC_ANNOTATION_COVERAGE_MESSAGE,
        p.toString()
      );
    erased = true;
    return p.op1;
  });
  if (coverageError !== undefined)
    return { error: ce._fn('Function', [coverageError, ...params]) };
  return erased
    ? { ops: [ops[0], ...newParams], generic: true }
    : { ops, generic: true };
}

/** Desugar a signature-string `Function` parameter (typed-literals design
 * §3.2 sugar) into structural operands `{ ops: [body, ...params] }`, or
 * `undefined` when the string is not a fully-named, non-variadic signature
 * type, or `{ error }` when it is signature-shaped but does not parse. An
 * `unknown`/`any` argument or result type stays unannotated; an explicit
 * `Typed` body ascription is kept over the signature's result type.
 *
 * The `typeToString` round-trips below re-serialize a type that was just
 * resolved, which DISCARDS the resolution of a user-declared type name (a
 * `TypeReference` serializes to its bare name) — the hazard the
 * operator-definition signature had (`boxed-operator-definition.ts`,
 * "assembled as a Type OBJECT, never as a string that is re-parsed"). It is
 * safe HERE only because the text goes straight back into
 * `canonicalFunctionLiteralArguments`, in this same scope, which re-parses it
 * with the resolver and records the resolution against the operand node
 * (`RESOLVED_TYPE_OPERANDS`, `function-literal.ts`) before the literal can
 * escape. Do not move this serialization anywhere the declaring scope may
 * already have popped. */
function desugarSignatureString(
  ce: ComputeEngine,
  body: Expression,
  signature: string
): { ops?: Expression[]; error?: Expression } | undefined {
  let type: Type;
  try {
    type = parseType(signature);
  } catch {
    // The signature may name a user-declared type; retry with the engine's
    // resolver (second, so the memo-cached parse carries the common case).
    try {
      type = parseType(signature, ce._typeResolver);
    } catch (e) {
      // A string that is not signature-shaped is not a signature the author
      // failed to write — it falls through to the parameter-name reading and
      // its `expected-a-symbol` error. One that IS (an ungrouped arrow, the
      // same gate `bodySlotSignature` uses) reports why it did not parse,
      // instead of blaming the operand for not being a symbol.
      if (!signature.includes('->') || isGroupedTypeText(signature))
        return undefined;
      return { error: signatureStringError(ce, signature, e) };
    }
  }
  if (typeof type === 'string' || type.kind !== 'signature') return undefined;
  if (type.optArgs || type.variadicArg) return undefined;
  const args = type.args ?? [];
  if (args.some((a) => !a.name)) return undefined;

  const isWide = (t: Type): boolean => t === 'unknown' || t === 'any';
  // A `where` clause (E1, generic-literals design §2.3): an argument whose
  // type mentions a quantified variable produces a BARE parameter symbol —
  // erasure (G1) — since the marker ascribed onto the body states its type and
  // no type variable may become the type of a symbol. Ground-typed arguments
  // keep their `Typed` marker and are enforced as usual.
  const generic = isPolymorphicType(type);
  const params = args.map((a) =>
    isWide(a.type) || (generic && mentionsQuantifiedVariable(a.type, type))
      ? ce.symbol(a.name!)
      : ce._fn('Typed', [ce.symbol(a.name!), ce.string(typeToString(a.type))], {
          canonical: false,
        })
  );
  let newBody = body;
  if (generic) {
    // A `where` clause is the ONLY record the literal keeps of its type
    // variables, so the full signature is ascribed unconditionally — unlike the
    // result-type cases below, a body-slot ascription does not get to win here
    // and silently drop the clause (it stays, as an inner statement ascription).
    newBody = ce._fn('Typed', [body, ce.string(typeToString(type))], {
      canonical: false,
    });
  } else if (isFunction(body, 'Typed')) {
    // The body's own ascription wins over the signature string's result.
  } else if (signatureEffects(type) !== undefined) {
    // Arrow-level effects are PRESERVED onto the constructed signature
    // (`docs/EFFECTS-MODEL.md`, "Epsil surface"), so the FULL signature is
    // ascribed — regardless of `isWide(type.result)`, since the wide-result
    // convention keeps the return inferred downstream.
    newBody = ce._fn('Typed', [body, ce.string(typeToString(type))], {
      canonical: false,
    });
  } else if (!isWide(type.result))
    // `returnTypeText`, not `typeToString`: a result that is itself a signature
    // has to stay GROUPED here, or the marker it builds re-reads as the
    // literal's OWN contract (`functionLiteralDeclaredSignature`) instead of
    // the return type the signature string declared.
    newBody = ce._fn('Typed', [body, ce.string(returnTypeText(type.result))], {
      canonical: false,
    });
  return { ops: [newBody, ...params] };
}

/** Normalize a `Typed` type operand (a string literal or a type-name symbol)
 * to a string literal, so a type-name symbol such as `real` is not
 * auto-declared as a variable. */
function normalizeTypeOperand(
  ce: ComputeEngine,
  t: Expression | undefined
): Expression {
  if (!t) return ce.string('unknown');
  const s = isString(t) ? t.string : sym(t);
  return s !== undefined ? ce.string(s) : t;
}

/** Rebuild an annotated parameter `["Typed", symbol, type]` with its type
 * operand normalized to a string literal. */
function normalizeTypedParameter(
  ce: ComputeEngine,
  param: Expression
): Expression {
  if (!isFunction(param)) return param;
  return ce._fn('Typed', [param.op1, normalizeTypeOperand(ce, param.op2)], {
    canonical: false,
  });
}

/**
 * The declared type to bind an annotated parameter's fresh-scope binding with
 * (`inferred: false`), or `undefined` to fall back to the historical inferred
 * binding (`{ value, inferred: true }`).
 *
 * Only strict mode attaches a declared type — that is where step 4/step 3
 * validation runs, so a provably-wrong value has already been rejected. The
 * value is nonetheless bound under the declared type only when it is provably
 * compatible: an `unknown`/`any`/symbolic value passes validation as "not
 * provably wrong", but binding it under a narrower fixed type would trip the
 * value-definition covariant check (`value.type.matches(declaredType)`), which
 * throws. Falling back to inferred there keeps the historical symbolic
 * beta-reduction (e.g. an undeclared-symbol argument).
 */
function typedBinding(
  ce: ComputeEngine,
  param: Expression,
  value: Expression
): Type | undefined {
  if (!ce.strict) return undefined;
  const t = functionLiteralParameterType(param);
  if (t === undefined) return undefined;
  return value.type.matches(t) ? t : undefined;
}

/** The shorthand-lambda placeholder symbols: `_` and `_1`…`_9`. An expression
 * containing any of these is a shorthand function body (case 6 of
 * `canonicalFunctionLiteral`). */
export const WILDCARD_SYMBOLS = [
  '_',
  '_1',
  '_2',
  '_3',
  '_4',
  '_5',
  '_6',
  '_7',
  '_8',
  '_9',
];

/**
 * Canonicalize `expr` with the shorthand-lambda placeholders it mentions
 * (`_`, `_1`…`_9`) bound to FRESH, valueless locals.
 *
 * `Pipe` is lazy, so it canonicalizes its held right operand in the CALLER's
 * scope — before `canonicalFunctionLiteral` wraps `Map(f, _1)` into
 * `(_1) ↦ Map(f, _1)`. A placeholder is a parameter of that literal and must
 * shadow a same-named global, in particular its VALUE: with a global
 * `_1 := 7`, `Map`'s canonical handler saw a non-collection source operand,
 * declined (`checkCollectionOperand`), and `[1,2,3] |> Map(k ↦ k², _1)`
 * returned an unevaluated `Map`.
 *
 * The placeholders are PRE-DECLARED in a throwaway scope rather than left to
 * auto-declaration. `_pushShadowedParameters` alone does not shadow here:
 * its untyped branch deliberately reuses an existing non-constant binding
 * (that IS the valued global), and its typed branch auto-declares into the
 * current lexical scope — the very scope the global lives in. The throwaway
 * scope is `noAutoDeclare`, so a genuine free variable in the operand still
 * auto-declares in the caller's scope exactly as before; only the
 * placeholders are intercepted.
 *
 * `scratchDeclarations` exempts the placeholder declarations — and ONLY those
 * — from advancing the engine's `any` cache axis. Pass it when this runs
 * inside a computation whose own caches key on that axis, which today means a
 * TYPE handler (`Pipe`'s, via `pipeImplicitMapType`): every advance retires
 * the `_type`/`_sgn` memo of every expression in the engine, including the
 * ones the enclosing type walk is filling, so a type read that advances the
 * axis invalidates its own footing and can never settle. The exemption is
 * sound here for a reason that does not depend on the caller, and it is a
 * different reason from the scratch scopes that are pushed and popped (`Map`'s
 * element-type probe): the scope is created in THIS call, and every
 * placeholder binding is installed into it before the scope is ever used to
 * resolve a name, so no cached answer anywhere can have been computed against
 * that scope in the absence of those bindings. The registration is unwound
 * before canonicalization for the same reason it exists — a declaration that
 * canonicalization aims at a longer-lived scope (a function literal's
 * `block.localScope`, which the canonical literal captures and outlives this
 * call by) MUST keep its axis advance. It stays off by default so the
 * evaluate-time callers keep advancing the axis exactly as they did.
 */
export function canonicalWithFreshPlaceholders(
  expr: Expression,
  options?: { scratchDeclarations?: boolean }
): Expression {
  const names = WILDCARD_SYMBOLS.filter((name) => expr.has(name));
  if (names.length === 0) return expr.canonical;
  const ce = expr.engine;
  const scope: Scope = {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
    noAutoDeclare: true,
  };
  const scratch = options?.scratchDeclarations === true;
  if (scratch) ce._scratchDeclarationScopes.push(scope);
  try {
    for (const name of names)
      ce._declareSymbolValue(name, { type: 'unknown', inferred: true }, scope);
  } finally {
    if (scratch) {
      const top = ce._scratchDeclarationScopes.pop();
      console.assert(
        top === scope,
        'placeholder scope registration unbalanced'
      );
    }
  }
  return ce._inScope(scope, () => expr.canonical);
}

/**
 * How an application treats an argument whose value is — or embeds — an
 * `Error`. See `docs/LANGUAGE-MODEL.md`
 *
 * - `'bubble'` (the default): error is the absorbing element of strict
 *   evaluation, so the application evaluates to that error value and the body
 *   never runs.
 * - `'bind'`: the error is an ordinary value, bound to the parameter. Reserved
 *   for the non-strict OBSERVERS — the `Match` case guards and bodies, which
 *   have already decided on the error subject and are the rescue construct.
 */
export type ErrorArgPolicy = 'bubble' | 'bind';

/** The first argument that is — or embeds — an `Error`, as its error value.
 * A plain loop: this runs on every application. */
function firstErrorArg(
  args: ReadonlyArray<Expression>
): Expression | undefined {
  for (const a of args) {
    const err = errorValue(a);
    if (err !== undefined) return err;
  }
  return undefined;
}

/**
 * A function-valued expression that is not itself a `Function` literal
 * DENOTES a function (e.g. `Derivative(f, n)`, `InverseFunction(f)`, a
 * qualified protocol member `Comparable.compare` — which is
 * `Field(Comparable, "compare")`); it cannot be beta-reduced and must reach
 * its function value through evaluation. Letting the shorthand-lambda path
 * treat such an expression as a lambda BODY would substitute the argument
 * for its free symbol (`Apply(InverseFunction(f), 2)` → `InverseFunction(2)`;
 * `Map(Comparable.compare, xs)` → each element read as the base of a `Field`
 * access), or, for `Derivative(f, n)` whose `derivative()` representation is
 * the self-applied lambda `Apply(Derivative(f, n), _)`, re-evaluate the inner
 * `Derivative`, regenerating the same lambda and recursing forever (stack
 * overflow). Wildcards (`_`, `_1`…`_9`) mark a genuine shorthand body, so an
 * expression containing one is NOT gated here and still beta-reduces. (The
 * `lazy` attribute was considered as the gate and rejected: laziness governs
 * whether operands are evaluated, not whether the expression is
 * function-valued.)
 *
 * Consulted by `apply()` (stay symbolic, as `Apply(fn, args)`) and by
 * `canonicalFunctionLiteral` (return the expression unchanged instead of
 * running the shorthand path), so the application tier and the
 * canonicalization tier agree on which expressions are function VALUES.
 */
function denotesFunction(e: Expression | undefined | null): boolean {
  return (
    isFunction(e) &&
    e.operator !== 'Function' &&
    e.type.matches('function') &&
    !e.has(WILDCARD_SYMBOLS)
  );
}

/**
 * A `Field(⟨symbol⟩, ⟨string⟩)` expression whose base names a protocol with
 * that FUNCTION member — the qualified protocol member `Comparable.compare`,
 * which evaluates to the protocol-dispatching function literal.
 *
 * This is {@link denotesFunction}'s syntactic sibling, needed because a lazy
 * operator's held operand arrives RAW (`Map` holds its callback), where every
 * type still reads `unknown` and the type-based predicate cannot answer.
 * Recognition is registry-keyed, never scope-keyed — matching what `Field`'s
 * own evaluation does (`protocolOfSymbol`, engine-protocols.ts), including
 * its guard: a base symbol that HOLDS a value is that value, and `Field`
 * reads the value's field, not the protocol. (Checked by name via `lookup`,
 * not `.canonical`, so an undeclared protocol name is not auto-declared as a
 * side effect of asking.)
 */
function isQualifiedProtocolMember(e: Expression): boolean {
  if (!isFunction(e, 'Field')) return false;
  const base = sym(e.op1);
  const member = isString(e.op2) ? e.op2.string : undefined;
  if (base === undefined || member === undefined) return false;
  const ce = e.engine;
  if (ce._protocolRegistry[base]?.members[member]?.kind !== 'function')
    return false;
  const def = lookup(base, ce.context.lexicalScope);
  if (def !== undefined && 'value' in def && def.value.value !== undefined)
    return false;
  return true;
}

/**
 * Options accepted by {@link apply} and the lambda {@link makeLambda} builds.
 *
 * `holdArguments` is how a `hold` function (an Epsil `hold f(e) = …`, i.e. a
 * user-defined function whose operator definition is `lazy`) reaches its
 * body: the arguments are bound to the parameters AS WRITTEN — canonical and
 * bound in the caller's scope, but not evaluated — instead of being evaluated
 * first. Reading such a parameter in the body then evaluates the argument
 * expression there (call-by-name); a structural operator such as `Head` sees
 * the expression itself. The flag is set by the multi-clause selector for a
 * `hold` definition (`selectAndApply`, multi-clause.ts) and by nothing else:
 * an ordinary application always evaluates its arguments first.
 */
export type ApplyOptions = Partial<EvaluateOptions> & {
  holdArguments?: boolean;
  /**
   * The names of the literal's BOUND-VARIABLE parameters (an Epsil `hold
   * mySum(body, bind i, n)`; `ClauseAttributes.bind` in `multi-clause.ts`).
   * Each must be applied to a SYMBOL — the variable the caller names — and is
   * SUBSTITUTED into the body rather than bound to a value: `Sum(body, i, 1,
   * n)` becomes `Sum(body, k, 1, n)` for `mySum(k^2, k, 3)`, so the binder
   * inside the body re-canonicalizes with the caller's symbol as its index
   * and its rebinding of that symbol in the other (held) arguments is the
   * binder's own. Only meaningful with `holdArguments`.
   */
  bindParameters?: readonly string[];
};

/**
 * Apply arguments to an expression which is either:
 * - a `["Function"]` expression
 * - the symbol for a function, e.g. `Sin`.
 *
 * When the literal DECLINES the application — it is not unrolled because it
 * re-entered itself with a symbolic argument (`SymbolicRecursion`), or its
 * body produced an invalid result — the answer is `declined` when the caller
 * supplies one (the application as the caller wrote it, `R(3, x, y)`, for a
 * symbol bound to a literal), and otherwise an inert `Apply` of the literal.
 */
export function apply(
  fn: Expression,
  args: ReadonlyArray<Expression>,
  options?: ApplyOptions,
  errorPolicy: ErrorArgPolicy = 'bubble',
  declined?: Expression
): Expression {
  // Rung 2: applying something that IS an error bubbles it (`err(x)`), as does
  // applying a function literal to an error argument.
  //
  // A bare SYMBOL callee is deliberately excluded here: it is dispatched below
  // through `ce.function(sym, args).evaluate()`, where the direct-call route
  // decides — bubbling for a user function, freezing for a built-in operator
  // (`err |> Sin` must stay `Sin(err)`, exactly like `Sin(err)`; operators are
  // rung 3). That is what keeps `x |> f` ≡ `f(x)` for every callee.
  if (errorPolicy === 'bubble' && !isSymbol(fn)) {
    const err = errorValue(fn) ?? firstErrorArg(args);
    if (err !== undefined) return err;
  }

  if (denotesFunction(fn)) return fn.engine._fn('Apply', [fn, ...args]);

  if (isFunction(fn, 'Apply') && denotesFunction(fn.op1))
    return fn.engine._fn('Apply', [fn.op1, ...args]);

  const result = makeLambda(fn, errorPolicy)?.(args, options);
  if (result) return result;
  return declined ?? fn.engine.function('Apply', [fn, ...args]);
}

/**
 * Evaluate a sequence of statements, handling Return/Break/Continue.
 *
 * Used by both:
 * - `evaluateBlock` in control-structures.ts (Block evaluation handler)
 * - `makeLambda` below (iterates body.ops directly instead of calling
 *   body.evaluate(), because body is a Block whose _localScope has param
 *   bindings from canonicalization — declared with type 'unknown' but no
 *   value. If body.evaluate() were called, Block would push its _localScope
 *   as the eval context, and lookup() would find those stale bindings
 *   before reaching the freshScope where actual param values live.)
 */
export function evaluateStatements(
  ce: ComputeEngine,
  ops: Iterable<Expression>
): Expression {
  let result: Expression = ce.Nothing;
  for (const op of ops) {
    // Debugger pause point (see `common/debug-hook.ts`): only statements
    // that originated from source (carrying `sourceOffsets`) fire — the
    // hook may BLOCK. One comparison per statement when no debugger is
    // attached.
    if (debugStatementHook !== undefined && op.sourceOffsets !== undefined)
      debugStatementHook(op);
    // Evaluate the statement. `Break`/`Continue` are inert registered
    // operators and `Return` is unregistered, so a literal control-flow
    // statement evaluates to itself with its operand evaluated.
    result = op.evaluate();
    // Post-statement debugger hook (break-on-error-value); same guard shape
    // as the pre-statement hook above.
    if (
      debugStatementResultHook !== undefined &&
      op.sourceOffsets !== undefined
    )
      debugStatementResultHook(op, result);
    // Short-circuit on a control-flow result — whether the statement was a
    // literal `Break`/`Continue`/`Return` or *evaluated to* one (e.g.
    // `If(cond, Break)`). The control-flow expression itself is the block's
    // value, so it propagates through nested blocks up to the enclosing
    // `Loop` (which consumes `Break`/`Continue`) or function application
    // (which unwraps `Return` — see `unwrapReturn`).
    //
    // An `Error` VALUE short-circuits the same way: a non-final statement's
    // value is nobody's, so a refusal that is the statement's value (a
    // mistyped write, a `const` reassignment, a readonly protocol-property
    // set) would otherwise VANISH and execution would continue past the
    // fault — `executeEpsil` already surfaces exactly these as
    // `runtime-error` diagnostics for top-level statements; inside a
    // function body or block the error value propagating out IS the
    // diagnostic channel. Top-level `Error` operator only: a still-symbolic
    // statement carrying an embedded error operand is an ordinary inert
    // value, not a fault.
    const h = result.operator;
    if (h === 'Return' || h === 'Break' || h === 'Continue' || h === 'Error')
      break;
  }
  return result;
}

/**
 * Unwrap a `["Return", value]` expression to its value at a function
 * application boundary. `evaluateStatements` propagates `Return` wrapped so
 * that it can escape nested blocks and loops; the function boundary is where
 * it is consumed.
 */
function unwrapReturn(ce: ComputeEngine, expr: Expression): Expression {
  if (expr.operator === 'Return' && isFunction(expr))
    return expr.ops.length > 0 ? expr.op1 : ce.Nothing;
  return expr;
}

/**
 * Temporarily remove stale canonicalization bindings from bodyScope so they
 * don't shadow the freshScope values during scope chain lookup. Returns the
 * removed entries for restoration.
 *
 * Two kinds of bindings are hidden:
 * - the function's parameters (their call values live in freshScope);
 * - inferred, valueless bindings — auto-declared free variables and hoisted
 *   `Declare`/`Assign` block-locals (see `canonicalBlock`). These exist only
 *   as canonicalization bookkeeping: at evaluation time the `Declare`
 *   statement re-creates its local in the current (fresh) scope, and a
 *   nested scoped expression (an inner `Block`, a `Sum`) resolving through
 *   bodyScope must see that runtime binding, not the valueless stale one.
 *
 * Bindings that carry a value or an explicit type are left in place.
 *
 * The first reason is NOT the one activation records retire. §2.1 of the
 * binder-mechanism design expected it to narrow to the second, on the grounds
 * that a frame's definition and the body's now resolve to the same binding —
 * which is true, and irrelevant here: this list is consumed by NAME LOOKUP,
 * not by binding comparison. Dropping the parameter clause leaves an
 * ANNOTATED parameter (declared `inferred: false`, so not covered by the
 * second clause) valueless-but-visible in bodyScope, where a nested `Block`
 * or `Sum` resolving up the chain finds it before `freshScope`'s value.
 * Measured: `f(n: integer) = if n <= 1 { 1 } else { n * f(n-1) }` returns
 * `NaN` (`test/epsil/execute.test.ts` › 'recursion with a typed param still
 * works'). What activation records DID retire is the three-candidate binding
 * search in `bindingKeyedSubs`, which is where the "two live bindings at once"
 * state was actually observable.
 */
function hideBodyScopeParams(
  bodyScope: Scope,
  paramNames: string[]
): Array<[string, BoxedDefinition]> {
  const hidden: Array<[string, BoxedDefinition]> = [];
  const params = new Set(paramNames.filter((n) => n));
  for (const [name, binding] of [...bodyScope.bindings]) {
    const stale =
      params.has(name) ||
      ('value' in binding &&
        binding.value.inferredType &&
        binding.value.value === undefined);
    if (stale) {
      hidden.push([name, binding]);
      bodyScope.bindings.delete(name);
    }
  }
  return hidden;
}

/**
 * Declare a parameter in a call frame's `freshScope`, and record that the
 * binding it creates is an ACTIVATION of the one the literal's body `Block`
 * declares for the same parameter
 * (`docs/SCOPING-MODEL.md`).
 *
 * The "two live bindings at once" state this repairs is not removable: the
 * call's value has to live somewhere other than the literal, or two
 * simultaneous calls would overwrite each other. What the activation link adds
 * is that the two are no longer *unrelated* — `sameBindingDef` resolves both
 * to the static binding, so every consumer that asks "does this occurrence
 * denote the parameter?" gets one answer instead of having to enumerate the
 * places a parameter binding can live.
 *
 * The static binding is read from the PARAMETER OPERAND, not from
 * `bodyScope.bindings`: an enclosing activation of the same literal
 * (recursion) has already hidden the body's binding for the duration of ITS
 * call (`hideBodyScopeParams`), so by the second frame the scope no longer
 * answers. The binding OBJECT survives the hiding, and since stage 10 the
 * parameter operand is a live reference to exactly it — which is what makes
 * recursion work here at all. (Measured: keying on `bodyScope` left every
 * frame of a recursive call unlinked.)
 *
 * Only strict mode declares with the declared type (`inferred: false`); see
 * `typedBinding` for why an `unknown`/`any`/symbolic value still falls back to
 * the historical inferred binding.
 */
function declareParameterActivation(
  ce: ComputeEngine,
  name: string,
  param: Expression,
  value: Expression,
  freshScope: Scope,
  bodyScope: Scope | undefined
): void {
  const pType = typedBinding(ce, param, value);
  if (pType !== undefined)
    ce.declare(name, { value, type: pType, inferred: false }, freshScope);
  else ce.declare(name, { value, inferred: true }, freshScope);

  const staticBinding = staticParameterBinding(param, name, bodyScope);
  if (staticBinding === undefined) return;
  // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
  // module cannot import).
  const activation = freshScope.bindings.get(name);
  if (activation !== undefined && 'value' in activation)
    markActivation(activation.value, staticBinding);
}

/** One name a call frame binds for one parameter. */
type ParameterBinding = {
  name: string;
  /**
   * The node that carries the name's declared type and its static binding: the
   * parameter operand itself for a plain (or `Typed`) parameter, and the
   * pattern's leaf SYMBOL for a destructured position. `bindParameterOperands`
   * points both at the body Block's own binding, which is what lets
   * `staticParameterBinding` read the definition straight off the node.
   */
  site: Expression;
  value: Expression;
};

/**
 * Expand a call's (parameter, argument) pairs into the name-level bindings its
 * frame installs, destructuring each `((p, q))` pattern parameter against its
 * argument.
 *
 * Returns the `Error` value instead when a pattern does not match its
 * argument's shape. That is the SAME error `let (p, q) = v` produces for the
 * same mismatch — both routes go through `collectTuplePattern`, and neither has
 * a mismatch-specific error of its own.
 */
function parameterBindings(
  params: ReadonlyArray<Expression>,
  args: ReadonlyArray<Expression>
): { leaves: ParameterBinding[]; error?: undefined } | { error: Expression } {
  const leaves: ParameterBinding[] = [];
  for (let i = 0; i < args.length && i < params.length; i++) {
    const param = params[i];
    if (!isDestructuringParameter(param)) {
      const name = functionLiteralParameterName(param);
      if (name) leaves.push({ name, site: param, value: args[i] });
      continue;
    }
    const pairs: [name: string, value: Expression][] = [];
    const err = collectTuplePattern(param, args[i], pairs);
    if (err) return { error: err };
    const sites = patternLeafSites(param);
    for (const [name, value] of pairs)
      leaves.push({ name, site: sites.get(name) ?? param, value });
  }
  return { leaves };
}

/** Each name a destructuring pattern binds, mapped to the leaf symbol NODE
 * that binds it. */
function patternLeafSites(pattern: Expression): Map<string, Expression> {
  const sites = new Map<string, Expression>();
  const walk = (p: Expression): void => {
    if (isFunction(p, 'Tuple')) {
      for (const el of p.ops) walk(el);
      return;
    }
    const n = sym(p);
    if (n !== undefined && n !== '_' && !sites.has(n)) sites.set(n, p);
  };
  walk(pattern);
  return sites;
}

/** The literal's OWN binding for a parameter: the operand's, falling back to
 * the body scope's for a literal whose operand was never bound to it (a
 * hand-built `Function` node that skipped `bindParameterOperands`). */
function staticParameterBinding(
  param: Expression,
  name: string,
  bodyScope: Scope | undefined
): BoxedValueDefinition | undefined {
  const site = isFunction(param, 'Typed') ? param.op1 : param;
  const def = (site as { valueDefinition?: BoxedValueDefinition })
    .valueDefinition;
  if (def !== undefined) return def;
  const binding = bodyScope?.bindings.get(name);
  return binding !== undefined && 'value' in binding
    ? binding.value
    : undefined;
}

/** Restore param bindings removed by hideBodyScopeParams. */
function restoreBodyScopeParams(
  bodyScope: Scope,
  hidden: Array<[string, BoxedDefinition]>
): void {
  for (const [name, binding] of hidden) bodyScope.bindings.set(name, binding);
}

/**
 * If `expr` is a bare symbol bound to a user-defined function literal (an
 * operator definition created by `helper(x) = …`), return the underlying
 * `Function` literal so the function can escape its defining scope as a
 * first-class value. Otherwise return `expr` unchanged.
 *
 * Must be called while the defining call frame is still pushed, so the
 * operator definition is reachable via `lookupDefinition`.
 */
export function resolveEscapingLambda(
  ce: ComputeEngine,
  expr: Expression
): Expression {
  if (!isSymbol(expr)) return expr;
  const def = ce.lookupDefinition(expr.symbol);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined) return literal;
  }
  return expr;
}

/**
 * Recursively walk `expr` and rebind any Function literals so their body
 * scopes close over `closureParent`. This handles Functions nested inside
 * List, Tuple, Pair, or any other compound expression.
 *
 * Example: given `List(Function(x+n), Function(x+2*n))` where n=5 lives
 * in `closureParent` (the outer call's fresh scope), both inner Functions
 * are rebound so their Block scopes have `parent = closureParent`, ensuring
 * they see n=5 even after the outer fresh scope is popped.
 *
 * Multi-level nesting (f returning g returning h) still works because each
 * evaluation of a Function triggers its own closure capture at that level.
 */
function captureClosures(
  ce: ComputeEngine,
  expr: Expression,
  closureParent: Scope,
  // Per-call memo of the capture of a node under a given parent scope. A
  // value that shares its operands (a user function applied to its own
  // previous result embeds that result once per mention of the parameter)
  // is captured once per node, so the rebuilt value keeps that sharing —
  // rebuilding each path separately would unfold it into a tree exponential
  // in the nesting depth. Keyed on the parent scope as well: a scoped node
  // reached under two different captured chains is two different closures.
  memo: Map<Scope, Map<Expression, Expression>> = new Map()
): Expression {
  if (!isFunction(expr)) return expr;
  let byNode = memo.get(closureParent);
  const hit = byNode?.get(expr);
  if (hit !== undefined) return hit;
  const captured = captureClosuresUncached(ce, expr, closureParent, memo);
  if (byNode === undefined) {
    byNode = new Map();
    memo.set(closureParent, byNode);
  }
  byNode.set(expr, captured);
  return captured;
}

/** The body of {@link captureClosures}: one node's capture. */
function captureClosuresUncached(
  ce: ComputeEngine,
  expr: Expression,
  closureParent: Scope,
  memo: Map<Scope, Map<Expression, Expression>>
): Expression {
  if (expr.operator === 'Function' && isFunction(expr)) {
    const innerBlock = expr.op1;
    if (innerBlock && isFunction(innerBlock) && innerBlock.localScope) {
      // Only copy bindings for the inner function's own parameters.
      // Other entries (auto-declared free variables, local declarations)
      // must NOT be copied — they would shadow the closureParent chain
      // where the outer call's parameter values live.
      //
      // Local variables from Declare statements are safe to drop here
      // because they are re-created at evaluation time when the Declare
      // op is processed by evaluateStatements.
      const innerParamNames = new Set(
        functionLiteralBoundNames(expr.ops.slice(1))
      );
      const closureBindings: Map<string, BoxedDefinition> = new Map();
      for (const [key, val] of innerBlock.localScope.bindings) {
        if (innerParamNames.has(key)) closureBindings.set(key, val);
      }
      const closureScope: Scope = {
        parent: closureParent,
        bindings: closureBindings,
      };
      // Rebuild the body's own ops against the NEW scope: a scoped `Block`
      // nested inside the body (an `If` branch, a loop body) keeps its
      // canonicalization-time parent chain otherwise, which reaches the stale
      // copies of these same lexical levels instead of the captured ones. That
      // is invisible for an arithmetic body — its symbols live directly in the
      // body Block, which IS rebuilt here — and shows up the moment a held
      // operand introduces a scope: `k ↦ (x ↦ If(x > 1, {k}, {0}))` applied at
      // `k = 100` returned the symbol `k`, while the same body without the
      // branch Blocks, or a plain `do { k }`, returned `100`.
      // `metadata` on the rebuilds: a debugger maps statements back to
      // source through `sourceOffsets`, and this copy is the body the hook
      // sees at application time — dropping them here silently disables
      // body breakpoints for the rebuilt statements.
      const closedBlock = ce._fn(
        'Block',
        innerBlock.ops.map((op) => captureClosures(ce, op, closureScope, memo)),
        {
          scope: closureScope,
          metadata: { sourceOffsets: innerBlock.sourceOffsets },
        }
      );
      return ce._fn('Function', [closedBlock, ...expr.ops.slice(1)], {
        metadata: { sourceOffsets: expr.sourceOffsets },
      });
    }
    return expr;
  }

  // A scoped `Block` re-roots onto the captured chain, keeping its OWN
  // bindings (genuine block-locals). Stale canonicalization shadows among them
  // are swept when the block evaluates (`evaluateBlock`), so re-parenting is
  // what makes that sweep reach the captured value rather than another stale
  // level.
  // ANY scoped expression — a `Block`, or a binder such as
  // `Sum`/`Product`/`Loop`/`Comprehension` — re-roots its own scope onto the
  // captured chain and recurses through its operands against that new scope.
  //
  // Both halves are load-bearing:
  // - RE-ROOT, because the expression's canonicalization-time scope chains to
  //   the stale copies of these same lexical levels; leaving it in place is
  //   what made a captured variable read as unbound from an `If` branch, and
  //   preserving it verbatim on a `Loop` silently zeroed the loop body.
  // - COPY the bindings, because `expr` is the template shared by every closure
  //   derived from this literal and the scope is mutated at evaluation
  //   (`evaluateBlock` sweeps it, `Declare` writes to it). Aliasing gives
  //   overlapping activations one frame, so a nested call clobbers an outer
  //   call's locals: `make = k ↦ (n ↦ if n > 0 { let y = k; y + make(k+1)(n-1) }
  //   else { k })` returned 9 for `make(0)(3)` instead of 6.
  //
  // Dropping the scope instead re-resolves a binder's index against the
  // enclosing chain — `Sum(If(i > 0, {i·k}, {0}), i, 1, n)` in an escaping
  // closure threw `Cannot assign a value to the constant "i"`, `i` having
  // fallen through to the imaginary unit.
  if (isFunction(expr) && expr.localScope) {
    const scope: Scope = {
      parent: closureParent,
      bindings: new Map(expr.localScope.bindings),
    };
    return ce._fn(
      expr.operator!,
      expr.ops.map((op) => captureClosures(ce, op, scope, memo)),
      { scope, metadata: { sourceOffsets: expr.sourceOffsets } }
    );
  }

  // Recurse into unscoped compound expressions (List, Tuple, Pair, etc.)
  if (isFunction(expr) && expr.ops.length > 0) {
    let changed = false;
    const newOps = expr.ops.map((op) => {
      const captured = captureClosures(ce, op, closureParent, memo);
      if (captured !== op) changed = true;
      return captured;
    });
    if (changed)
      return ce._fn(expr.operator!, newOps, {
        metadata: { sourceOffsets: expr.sourceOffsets },
      });
  }

  return expr;
}

/** One parameter's post-evaluation substitution: the literal's OWN binding for
 * it, its name, the value to substitute, and whether the ARGUMENT mentions the
 * name (see `bindingKeyedSubs`). */
type ParameterSub = readonly [
  binding: BoxedValueDefinition | undefined,
  name: string,
  value: Expression,
  ambiguous: boolean,
];

/**
 * Substitute by BINDING identity: rewrite an occurrence only when it resolves
 * to the given binding, whatever it is spelled.
 *
 * "Resolves to" is `sameBindingDef`, so a call frame's ACTIVATION of the
 * parameter counts as the parameter — which is what lets this ask ONE question
 * where it used to enumerate the three places a parameter's binding can live
 * (the body binding hidden by `hideBodyScopeParams`, the live body binding,
 * and `freshScope`'s).
 *
 * `ambiguous` is the item-26 guard, and it is the one thing the two sides of an
 * activation are still distinguished for. When the argument itself mentions the
 * parameter's name, an occurrence bound on the ACTIVATION side may have been
 * bound by canonicalizing the ARGUMENT in-frame rather than by the body —
 * substituting it double-applies (`Apply(x ↦ x, Hold(raw x))` must stay
 * `Hold(x)`). An occurrence carrying the literal's own binding cannot have come
 * from the argument, so it stays substitutable even when ambiguous
 * (`Apply(w ↦ If(c, w, 0), w + 1)` = `If(c, w + 1, 0)`).
 *
 * The binding-keyed half needs no shadowing exclusion — a nested `Function`
 * literal that re-binds the name declares a DIFFERENT binding (not an
 * activation of this one), so its occurrences simply do not match, and
 * `(x ↦ (x ↦ x))(1)` keeps its inner binder for free. The RAW-name fallback
 * half is name-based, so it does need one: any binder between the root and the
 * occurrence that binds the name — a nested literal's parameter list, but also
 * a scoped operator's `localScope` (the parser leaves a `Sum`'s binding-site
 * symbol raw) — owns its occurrences, and the walker's `shadowed` set carries
 * exactly that.
 */
function bindingKeyedSubs(
  expr: Expression,
  subs: ReadonlyArray<ParameterSub>
): Expression {
  return rewriteWithBinders(expr, (sym, shadowed) => {
    const def = (sym as { valueDefinition?: BoxedValueDefinition })
      .valueDefinition;
    for (const [binding, name, value, ambiguous] of subs) {
      // Bound: it denotes this parameter — either the literal's own binding or
      // this frame's activation of it.
      if (
        def !== undefined &&
        binding !== undefined &&
        sameBindingDef(def, binding) &&
        (!ambiguous || def === binding)
      )
        return value;
      // Raw: a lazy operator holds its operands unevaluated, so the body
      // source reaches here un-canonicalized and its parameter references
      // carry no binding at all (`Map`'s held body, a pipe's `_1` topic). An
      // unbound occurrence has nothing else it could denote inside this
      // frame, so the name is the whole answer — the same rule the equality
      // contract uses for a raw operand.
      if (
        def === undefined &&
        sym.symbol === name &&
        shadowed?.has(name) !== true
      )
        return value;
    }
    return sym;
  });
}

/** Wrap a lambda so each invocation is counted against `recursionLimit`: a
 * runaway user-function recursion (`f(x) := … f(x-1) …` with no reachable base
 * case) throws a `CancellationError` (`cause: 'recursion-depth-exceeded'`)
 * instead of overflowing the native JS call stack with a `RangeError`. */
/**
 * Thrown by an application of a user-function literal that is re-entered —
 * an application of the same literal is already on the evaluation stack —
 * with an argument that contains a free symbol. Caught by the outermost
 * application of that literal (`guardSymbolicRecursion`), which then
 * declines, so the whole application stays inert.
 *
 * A recursive definition is not unrolled symbolically: `R(i,x,y) :=
 * R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))` with `x`, `y` free answers `R(3, x, y)`,
 * not a closed form. The closed form's size is inherent in such a definition
 * (each level embeds the previous one as many times as the body mentions it),
 * and entering the body once while leaving the inner self-calls inert would
 * answer neither a closed form nor a clean decline. Ground arguments —
 * numbers, strings, booleans, constants with a value, collections and
 * dictionaries of those, closed function literals — never throw here: a
 * recursive scanner over a literal list, or a string-building recursion,
 * recurses as before, and the pure-application memo makes the number-literal
 * route linear. The check is dynamic rather than a scan of the body for its
 * own name, so mutual recursion (`f` → `g` → `f`) is caught the same way.
 * The ruling and its measurements: `ROADMAP.md`, "Symbolic evaluation of a
 * recursive user function: not unrolled".
 *
 * Two boundaries. A `hold`/`bind` operator whose bound-variable reduction
 * substitutes into the body and applies the result
 * (`invokeWithBoundVariables`) is applied through a literal of a different
 * structure at each level, which the per-literal count never sees twice, so
 * such a recursion is not declined here — the recursion limit
 * (`ce.recursionLimit`) still ends it. And a `catch` between the re-entry
 * and the outermost application that does not let the signal through
 * (`rules.ts` treats any exception as "this rule failed") ends the recursion
 * at that point with a locally degraded answer rather than the clean
 * decline; the `canonical`-handler catches in `box.ts` let it through.
 *
 * Not an `Error`: it is control flow, and it must not be mistaken for a
 * failed evaluation by a handler that reports exceptions. Recognized by
 * `name`, never `instanceof`, across plugin-bundle boundaries.
 */
class SymbolicRecursion {
  readonly name = 'SymbolicRecursion';
  /** The structural hash of the literal whose application is abandoned. */
  constructor(readonly literal: number) {}
}

/**
 * Applications of each literal currently on the evaluation stack, keyed by
 * the literal's structural hash rather than its identity: a literal with a
 * function-typed parameter is rebuilt on every application (its inferred
 * type changes), so the object the outer and the inner application see is
 * not the same one, while its structure is. Entries are removed when the
 * outermost application exits, so the map never grows.
 */
const activeApplications = new Map<number, number>();

/**
 * Does an evaluated argument contain a free symbol — a symbol occurrence,
 * not bound by a binder inside the argument, whose binding has no value? That
 * is the argument a recursive definition is not unrolled over.
 *
 * Deliberately not `expr.unknowns`: that resolves each name in the current
 * evaluation context, and inside the body of `R(i,x,y)` the caller's `x`
 * looks bound — to the frame's own parameter `x` — so every argument would
 * count as ground. A symbol node's `value` instead follows the binding the
 * node denotes (a foreign parameter activation is skipped;
 * `valueDefinitionInContext`, `binders.ts`); a constant without a stored
 * value (`True`) and the absence marker `Nothing` are values, not unknowns.
 * Names bound inside the argument
 * (a closed literal's parameters, a `Sum` index) are shadowed as the walk
 * descends, so a closed callback literal is ground; dictionary values are
 * walked like operands, since a dictionary is not a function node.
 */
function containsFreeSymbol(
  expr: Expression,
  shadowed?: ReadonlySet<string>,
  // Per-call memo of the answer for a function node under a given set of
  // shadowed names: an argument that shares its operands (the previous
  // result of the very function being applied, embedded once per mention of
  // the parameter) is walked once per node, not once per path — the same
  // hazard `rewriteWithBinders` guards against, and an evaluated argument is
  // exactly such a value.
  memo: Map<Expression, Map<string, boolean>> = new Map()
): boolean {
  if (isSymbol(expr)) {
    if (shadowed?.has(expr.symbol)) return false;
    // A constant (`True`, `False`, `π`) is a value whether or not it stores
    // one, and `Nothing` is the absence marker, not an unknown.
    if (expr.valueDefinition?.isConstant || expr.symbol === 'Nothing')
      return false;
    return expr.value === undefined;
  }
  if (!isFunction(expr) && !isDictionary(expr)) return false;
  // A dictionary and a function node are memoized alike: a shared dictionary
  // reached on several paths is walked once too.
  const key = shadowedKey(shadowed);
  const hit = memo.get(expr)?.get(key);
  if (hit !== undefined) return hit;
  let result: boolean;
  if (isDictionary(expr))
    result = expr.values.some((v) => containsFreeSymbol(v, shadowed, memo));
  else {
    const binds = boundVariableNames(expr);
    const inner =
      binds.length > 0
        ? new Set(shadowed ? [...shadowed, ...binds] : binds)
        : shadowed;
    result = expr.ops.some((op) => containsFreeSymbol(op, inner, memo));
  }
  let byShadowing = memo.get(expr);
  if (byShadowing === undefined) {
    byShadowing = new Map();
    memo.set(expr, byShadowing);
  }
  byShadowing.set(key, result);
  return result;
}

/**
 * Count the applications of `literal` on the stack around `fn`, and turn a
 * `SymbolicRecursion` raised for it inside the OUTERMOST application into a
 * decline (`undefined` — the application stays inert). See
 * `SymbolicRecursion`.
 */
function guardSymbolicRecursion(
  literal: Expression,
  fn: (
    params: ReadonlyArray<Expression>,
    options?: ApplyOptions
  ) => Expression | undefined
): (
  params: ReadonlyArray<Expression>,
  options?: ApplyOptions
) => Expression | undefined {
  const key = literal.hash;
  return (params, options) => {
    const depth = activeApplications.get(key) ?? 0;
    activeApplications.set(key, depth + 1);
    try {
      return fn(params, options);
    } catch (e) {
      if (e instanceof SymbolicRecursion && e.literal === key && depth === 0)
        return undefined;
      throw e;
    } finally {
      if (depth === 0) activeApplications.delete(key);
      else activeApplications.set(key, depth);
    }
  };
}

function wrapRecursion(
  ce: ComputeEngine,
  fn: (
    params: ReadonlyArray<Expression>,
    options?: ApplyOptions
  ) => Expression | undefined
): (
  params: ReadonlyArray<Expression>,
  options?: ApplyOptions
) => Expression | undefined {
  return (params, options) => {
    ce._enterRecursion();
    try {
      return fn(params, options);
    } finally {
      ce._exitRecursion();
    }
  };
}

/**
 * Substitute, in a HELD argument, every symbol bound in the CALLER's frames
 * that the callee cannot reach: a symbol whose live binding is found on the
 * current (caller's) scope chain but not on `captured` — the callee's
 * defining scope chain, which is what its call frame will chain to. The
 * substituted expression is that binding's value: for a hold parameter of the
 * calling function, the expression IT was handed (inlined recursively, so a
 * chain of forwarding hold functions collapses to the original argument); for
 * a `let` local, its stored value. A binding without a value (a valueless
 * declaration) is left as the symbol.
 *
 * Symbols shadowed by a binder inside the argument (`Sum(x^2, x, 1, n)`'s
 * `x`) are never touched — `rewriteWithBinders` reports them — and a symbol
 * whose binding is reachable from `captured` stays symbolic: that is the
 * ordinary case (`hold f(e) = e; f(a + 1)` keeps `a + 1`), and it is why this
 * is a substitution of FRAME-LOCALS only, not an evaluation. The recursion
 * is bounded by a visited set on the definitions already inlined, so a
 * frame-local whose value mentions itself cannot loop.
 */
function inlineFrameLocals(
  ce: ComputeEngine,
  expr: Expression,
  captured: Scope | null | undefined,
  visited: Set<BoxedValueDefinition> = new Set()
): Expression {
  const reachableFrom = (
    start: Scope | null | undefined,
    name: string,
    own: BoxedValueDefinition
  ): BoxedValueDefinition | undefined => {
    for (let s = start; s; s = s.parent) {
      const found = s.bindings.get(name);
      if (
        found !== undefined &&
        'value' in found &&
        sameBindingDef(found.value, own)
      )
        return found.value;
    }
    return undefined;
  };
  return rewriteWithBinders(expr, (sym, shadowed) => {
    const name = sym.symbol;
    if (shadowed?.has(name)) return sym;
    const own = sym.valueDefinition;
    if (own === undefined) return sym;
    if (reachableFrom(captured, name, own) !== undefined) return sym;
    const live = reachableFrom(ce.context.lexicalScope, name, own);
    if (live === undefined || visited.has(live)) return sym;
    const value = live.value;
    if (value === undefined) return sym;
    visited.add(live);
    return inlineFrameLocals(ce, value, captured, visited);
  });
}

function makeLambda(
  expr: Expression,
  errorPolicy: ErrorArgPolicy = 'bubble'
):
  | ((
      params: ReadonlyArray<Expression>,
      options?: ApplyOptions
    ) => Expression | undefined)
  | undefined {
  const ce = expr.engine;

  // If the expression is a symbol, interpret it as an operator
  if (isSymbol(expr)) {
    const sym = expr.symbol;
    return (args, options) => ce.function(sym, args).evaluate(options);
  }

  const canonicalExpr = canonicalFunctionLiteral(expr);
  // Not a function literal (e.g. a bare string or number): decline so callers
  // fall through to their symbolic `Apply(fn, args)` fallback instead of
  // throwing (`apply()` uses `makeLambda(fn)?.(...)`).
  if (!canonicalExpr) return undefined;

  expr = canonicalExpr;

  // An expression that DENOTES a function without being a literal (a
  // qualified protocol member `Comparable.compare`, `InverseFunction(f)`, …)
  // came back unchanged from `canonicalFunctionLiteral` (its case 5.5). It
  // cannot be beta-reduced here: apply it through `Apply`, whose strict
  // evaluation reduces the callee to its function value first (a qualified
  // member evaluates to the protocol-dispatching literal), then applies.
  if (expr.operator !== 'Function') {
    const fnExpr = expr;
    return (args, options) =>
      ce.function('Apply', [fnExpr, ...args]).evaluate(options);
  }

  console.assert(expr.operator === 'Function');
  console.assert(expr.isCanonical);

  // expr is a canonical Function expression — it satisfies FunctionInterface
  const fnExpr = expr as Expression & FunctionInterface;

  //
  // No parameters (nullary function). Extra arguments are ignored (historical
  // contract). Two cases:
  //
  if (fnExpr.ops.length === 1) {
    console.assert(fnExpr.ops[0] !== undefined);
    const onlyBody = fnExpr.ops[0];

    // (a) The body is not a scoped Block: there is no per-call local state to
    //     instantiate, so evaluate it directly (fast path for plain thunks and
    //     bare-expression bodies).
    if (!onlyBody.isScoped || !onlyBody.localScope)
      return wrapRecursion(ce, (_args, options) => onlyBody.evaluate(options));

    // (b) The body IS a scoped Block: it may declare mutable locals (`let`)
    //     captured by an escaping closure — e.g. a counter factory
    //     `() => do { let count = 0; () => do { count = count + 1; count } }`.
    //     Those locals must live in a fresh per-call scope so separate
    //     invocations don't share state. Evaluate the block's statements in a
    //     fresh scope (parent = the defining scope) and run `captureClosures`,
    //     mirroring the parameterized `invoke` path below — the same machinery
    //     that already makes parameterized factories produce independent
    //     closures. Unlike `invoke`, arguments are ignored rather than
    //     arity-checked, preserving the nullary contract.
    const nullaryBody = onlyBody as Expression & FunctionInterface;
    return wrapRecursion(ce, (_args, options) => {
      const bodyScope = nullaryBody.localScope!;
      const capturedScope = bodyScope.parent ?? ce.context.lexicalScope;
      const freshScope: Scope = { parent: capturedScope, bindings: new Map() };
      const savedParent = bodyScope.parent;
      bodyScope.parent = freshScope;
      // Hide the stale canonicalization bookkeeping in bodyScope (hoisted
      // `Declare`/`Assign` targets, auto-declared references — all inferred
      // and valueless), exactly as the parameterized `invoke` path does.
      // The runtime `Declare`s below run against freshScope, so a stale
      // valueless binding left in bodyScope would shadow the fresh local for
      // every NESTED scope that chains through bodyScope — a `while` loop's
      // condition then reads the valueless binding forever and never
      // terminates.
      const hiddenBindings = hideBodyScopeParams(bodyScope, []);
      // Named 'call': a function-application activation frame. The debugger's
      // statement hook uses this to delimit stack frames (one per
      // activation — nested unnamed Block/loop contexts group into it).
      ce.pushScope(freshScope, 'call');
      let result: Expression;
      try {
        result = unwrapReturn(ce, evaluateStatements(ce, nullaryBody.ops));
        result = resolveEscapingLambda(ce, result);
        result = captureClosures(ce, result, freshScope);
        if (options?.numericApproximation)
          result = result.evaluate({ numericApproximation: true });
      } finally {
        ce.popScope();
        bodyScope.parent = savedParent;
        restoreBodyScopeParams(bodyScope, hiddenBindings);
      }
      return result.isValid ? result : undefined;
    });
  }

  const [body, ...params] = fnExpr.ops;

  console.assert(body.isScoped);
  if (!body.localScope)
    throw new Error('Function body must be a scoped Block expression');

  // body is a Block (scoped) — safe to access .ops and .localScope
  const bodyFn = body as Expression & FunctionInterface;

  // Apply-time enforcement (§6.4) is a strict-mode feature gated on the literal
  // carrying at least one annotated parameter — untyped literals skip it
  // entirely (zero overhead). Computed once; `ce.strict` is re-checked at
  // invocation time.
  const hasAnnotatedParam = params.some(
    (p) => functionLiteralParameterType(p) !== undefined
  );

  // A GENERIC literal has no annotated parameter to gate on — erasure removed
  // them — yet its polytype marker IS a contract, and an ANONYMOUS application
  // (`Apply(Function(…), …)`) never passes a symbol's boxed-definition seam
  // where the check would otherwise happen. So the apply-time validation gate
  // widens to the marker (§2.5): `fnExpr.type.type` is then the polytype, and
  // `_validateArguments` is already polytype-aware.
  const declaredSignature = functionLiteralDeclaredSignature(fnExpr);
  const isGenericLiteral =
    declaredSignature !== undefined &&
    (declaredSignature.typeParams?.length ?? 0) > 0;
  const validateApplication = hasAnnotatedParam || isGenericLiteral;

  // A BARE parameter of a PARTIALLY annotated literal imposes NO constraint
  // (ruled 2026-08-09). The §6.4 gate above is all-or-nothing — one annotation
  // turns validation on for EVERY parameter — but a bare parameter's signature
  // slot is only whatever inference left there (`unknown` by default), which is
  // not a contract its author wrote. Validating against it rejects values that
  // are legitimately unconstrained: `nothing` is deliberately not a subtype of
  // `unknown`, so `Reduce(xs, (acc, n: integer) => acc + n)` errored with
  // `incompatible-type unknown nothing` on the sentinel a seedless fold used to
  // start from. So for VALIDATION ONLY, a bare parameter's slot is relaxed to
  // `any`; annotated parameters keep their exact enforcement, and the literal's
  // reported type is untouched.
  //
  // Skipped entirely when the literal carries a whole-signature marker (§2.5):
  // there the arrow IS the contract for every position, annotated operand or
  // not (a GENERIC literal's parameter annotations were erased — relaxing them
  // would silently disable its check).
  const bareParamIndexes =
    declaredSignature === undefined
      ? params.reduce<number[]>((acc, p, i) => {
          if (functionLiteralParameterType(p) === undefined) acc.push(i);
          return acc;
        }, [])
      : [];

  /** `t` with each bare parameter's argument slot widened to `any`. */
  const relaxBareParams = (t: Type): Type => {
    if (bareParamIndexes.length === 0) return t;
    if (typeof t === 'string' || t.kind !== 'signature') return t;
    const args = t.args;
    if (args === undefined || args.length === 0) return t;
    let changed = false;
    const relaxed = args.map((arg, i) => {
      if (!bareParamIndexes.includes(i)) return arg;
      changed = true;
      return { ...arg, type: 'any' as Type };
    });
    // A signature rebuilt field-by-field must carry its adjuncts; the spread
    // does that (`typeParams`, `effects`).
    return changed ? { ...t, args: relaxed } : t;
  };

  // The return-type ascription operand (§4.2 marker: the last Block statement
  // wrapped in `["Typed", stmt, type]`), reused verbatim when re-attaching the
  // return type onto a curried literal (§6.5 point 3). `undefined` when the
  // literal has no return ascription.
  const lastStatement = bodyFn.ops[bodyFn.ops.length - 1];
  const returnTypeOp = isFunction(lastStatement, 'Typed')
    ? lastStatement.op2
    : undefined;

  const invokeWithBoundVariables = (
    args: ReadonlyArray<Expression>,
    options: ApplyOptions
  ): Expression | undefined => {
    const bound = new Set(options.bindParameters);
    const substitutions: Record<string, Expression> = {};
    const keptParams: Expression[] = [];
    const keptArgs: Expression[] = [];
    for (let i = 0; i < params.length; i++) {
      const name = functionLiteralParameterName(params[i]);
      const arg = args[i];
      if (name !== undefined && bound.has(name)) {
        // No argument at a bound position (partial application) leaves the
        // parameter in place — nothing to substitute yet.
        if (arg === undefined) {
          keptParams.push(params[i]);
          continue;
        }
        substitutions[name] = arg;
        continue;
      }
      keptParams.push(params[i]);
      if (arg !== undefined) keptArgs.push(arg);
    }
    if (Object.keys(substitutions).length === 0)
      return invoke(args, { ...options, bindParameters: undefined });
    // Substitute the caller's symbols for the bound parameters in the body —
    // EVERY occurrence of the name, binder positions and shadowed occurrences
    // included: `bind i` means "the name the body uses as a bound variable",
    // and in `Sum(body, i, 1, n)` that `i` is Sum's own index (Sum's binder
    // claims it at definition time, shadowing the parameter), which is
    // precisely the occurrence that must become the caller's `k`. Then
    // rebuild the literal without those parameters; canonicalizing it in the
    // CALLER's context (the current one) is where the body's binder
    // (`Sum(body, k, 1, n)`) declares the caller's `k`.
    const newBody = rewriteWithBinders(
      body,
      (sym) => substitutions[sym.symbol] ?? sym
    );
    const reduced = ce.function('Function', [newBody, ...keptParams]);
    return apply(reduced, keptArgs, {
      ...options,
      bindParameters: undefined,
    });
  };

  const invoke = (
    args: ReadonlyArray<Expression>,
    options?: ApplyOptions
  ): Expression | undefined => {
    // BOUND-VARIABLE parameters (`bindParameters`) are eliminated first, by
    // substitution: the parameter is replaced in the body by the symbol the
    // caller passed (every occurrence of the name, inner binders included —
    // see `invokeWithBoundVariables`), and the reduced literal — without that
    // parameter — is applied to the remaining arguments under the same
    // options. The caller (`selectAndApply`) has already checked that each
    // such argument is a symbol.
    if (
      options?.bindParameters !== undefined &&
      options.bindParameters.length > 0
    )
      return invokeWithBoundVariables(args, options);

    // The scope the literal was defined in — the parent of every call frame
    // (step 5), and the chain a held argument's symbols must be resolvable
    // through (`inlineFrameLocals`).
    const capturedScope = bodyFn.localScope!.parent ?? ce.context.lexicalScope;

    // A `hold` application binds each argument as WRITTEN. `.canonical` is
    // value-safe — it binds structure (a held operand reaching here from the
    // box or parse route is still unbound) but does not substitute assigned
    // symbol values — so the parameter ends up bound to the caller's
    // expression, and reading it in the body evaluates it there.
    //
    // One class of symbol IS substituted: a CALLER-FRAME binding — a hold
    // parameter of the calling function, or a `let` local of its body — that
    // the callee could not otherwise resolve, because a call frame chains to
    // the callee's DEFINING scope, never to the caller's (step 5 below). With
    // `hold p1(e) = Head(e); hold p3(x) = p1(x)`, the argument `x` names
    // p3's frame binding; left as the symbol, p1 would read it in a chain
    // that has no `x` (`Head(e)` → `Symbol`, and evaluation only half
    // resolves). Inlining that binding's value — the expression p3 itself
    // was handed — makes forwarding a held argument mean the same expression,
    // which is what call-by-name promises. Bindings the callee CAN reach
    // through its own chain (a top-level `let a`, or a frame binding of an
    // enclosing function the callee was defined inside) stay symbolic, so
    // `hold f(e) = e; f(a + 1)` still binds `e` to `a + 1`, not to `4`.
    const argValue = (a: Expression): Expression =>
      options?.holdArguments
        ? inlineFrameLocals(ce, a.canonical, capturedScope)
        : a.evaluate();
    //
    // 1/ If there are more arguments than expected, exit
    //
    if (args.length > params.length) {
      throw new Error(
        `Too many arguments for function "${expr.toString()}": expected ${
          params.length
        }, got ${args.length}`
      );
    }

    //
    // 2/ An argument that is — or embeds — an `Error` (rung 2 of the
    //    error-propagation design): the application evaluates to that error
    //    value, and the body never runs. Under the `'bind'` policy the caller
    //    is an observer that has already decided on the error (a `Match` case),
    //    so it is bound like any other value.
    //
    if (errorPolicy === 'bubble') {
      const err = firstErrorArg(args);
      if (err !== undefined) return err;
      // Not dead: `errorValue` does NOT descend into collection values, so an
      // argument like `[1, "a" + 1]` is invalid without yielding an error to
      // bubble. This keeps the body from running for it (the result would be
      // discarded by the `result.isValid` gate at the end of `invoke` anyway).
      if (ce.strict && !args.every((x) => x.isValid)) return undefined;
    }

    //
    // 3/ If there are fewer arguments than expected, curry the function
    //
    if (args.length < params.length) {
      // G5 (§2.5): a GENERIC literal is not curried. The residual literal has
      // no honest type — a variable consumed by the supplied prefix occurs
      // nowhere in the remaining arrow, so the clause is unsolvable. Fires on
      // the polytype marker regardless of `hasAnnotatedParam`: erasure leaves a
      // generic literal with no annotated parameter at all, so the prefix
      // validation below never runs for one. (Measured before the guard: the
      // residual was built by re-attaching the FULL n-ary marker onto the
      // (n-k)-ary curried literal, whose §2.3 arity check then rejected it —
      // `(_1) => Error("A function-literal signature marker must be …")`,
      // an error buried in the body rather than a diagnostic on the call.)
      // Partial INSTANTIATION is the principled lift; recorded as future work.
      if (isGenericLiteral)
        return ce.error(GENERIC_PARTIAL_APPLICATION_MESSAGE, expr.toString());

      // Generate unique parameter names for the remaining (unapplied) params
      const unappliedParams = params.slice(args.length);
      const allSymbols = new Set([
        ...body.symbols,
        ...functionLiteralBoundNames(params),
      ]);
      const extraSymbols = unappliedParams.map((_, i) => {
        let name = `_${i + 1}`;
        let counter = 0;
        while (allSymbols.has(name)) name = `_${i + 1}_${counter++}`;
        allSymbols.add(name);
        return ce.symbol(name, { canonical: false });
      });

      // The curried literal's remaining params keep their annotations (§6.5
      // point 2): an unapplied `["Typed", p, T]` is re-wrapped around the fresh
      // symbol with its original (already-normalized) type operand. The bare
      // fresh symbols are used for body substitution; the wrapped versions
      // become the new Function parameters.
      //
      // An unapplied DESTRUCTURING parameter is carried over VERBATIM instead
      // (`extras`, the PURE residual below): the body reads the pattern's own
      // leaf names, and there is nothing to rename them to — a fresh symbol
      // names the whole tuple, not its components. The DEFERRED residual is the
      // opposite case: it re-applies the ORIGINAL literal, which does its own
      // destructuring, so its parameter must be the single fresh symbol that
      // receives the tuple whole (`extraSymbols`).
      const extras = unappliedParams.map((param, i) => {
        if (isDestructuringParameter(param)) return param;
        return isFunction(param, 'Typed')
          ? ce._fn('Typed', [extraSymbols[i], param.op2], { canonical: false })
          : extraSymbols[i];
      });

      // Rename remaining params to fresh names in the body. A destructuring
      // parameter is not renamed (see `extras` above), so it contributes none.
      const substitutions: Record<string, Expression> = {};
      for (let i = 0; i < unappliedParams.length; i++) {
        if (isDestructuringParameter(unappliedParams[i])) continue;
        const name = functionLiteralParameterName(unappliedParams[i]);
        if (name) substitutions[name] = extraSymbols[i];
      }

      // Evaluate body with known args in a fresh scope
      let evaluatedKnownArgs = args.map(argValue);

      // An argument that only became an error when EVALUATED (`f(g(1))` with
      // `g(1)` failing) bubbles like a literal one — see step 2.
      if (errorPolicy === 'bubble') {
        const err = firstErrorArg(evaluatedKnownArgs);
        if (err !== undefined) return err;
      }

      // Validate the applied prefix against the declared parameter types
      // (§6.4/§6.5). On mismatch, return the inert application with the
      // error-marked arguments (§13 decision 6).
      if (ce.strict && hasAnnotatedParam && _validateArguments) {
        const fullSig = relaxBareParams(fnExpr.type.type);
        if (typeof fullSig !== 'string' && fullSig.kind === 'signature') {
          const prefixSig: Type = {
            kind: 'signature',
            args: (fullSig.args ?? []).slice(0, args.length),
            // The arrow's `where` clause is an adjunct field: a signature
            // rebuilt field-by-field carries it (the rebuild invariant).
            ...(fullSig.typeParams !== undefined
              ? { typeParams: fullSig.typeParams }
              : {}),
            result: fullSig.result,
          };
          const validated = _validateArguments(
            ce,
            evaluatedKnownArgs,
            prefixSig
          );
          if (validated !== null) {
            // Any invalid operand: mismatch — return the inert application.
            if (validated.some((x) => !x.isValid))
              return ce._fn('Apply', [fnExpr, ...validated]);
            // All valid: an operand was substituted (e.g. devolved); proceed
            // with the substituted arguments.
            evaluatedKnownArgs = [...validated];
          }
        }
      }
      // Purity-gated pre-evaluation (`docs/EFFECTS-MODEL.md`, "Currying /
      // partial application"). Evaluating the body with the applied prefix is
      // an optimization: the residual literal carries an already-reduced body.
      // It is only sound for a PURE body — an effectful one would fire its
      // effects at partial application, and again at saturation. So an
      // effectful body is CAPTURED WITHOUT EVALUATION, as a residual that
      // re-applies the ORIGINAL literal to the prefix once the last argument
      // arrives: `(a, b) ↦ body` applied to `1` becomes
      // `(_1) ↦ Apply((a, b) ↦ body, 1, _1)`.
      //
      // Substituting the prefix VALUES into the body instead would be the
      // obvious encoding and is wrong: `subs()` is not capture-avoiding, so a
      // nested literal that rebinds a parameter name has its own parameter
      // symbol overwritten (`(a) ↦ a * 2` becomes `(1) ↦ 2`). Re-application
      // keeps the body untouched, and binding goes through the same scope
      // machinery as a saturated call.
      //
      // The prefix ARGUMENTS are evaluated either way (above): producing an
      // operand is not the body's effect, and eager operands are evaluated at
      // the call that supplies them.
      if (!isPureComputedEffects(effectsOf(body))) {
        const deferred = ce._fn(
          'Apply',
          [fnExpr, ...evaluatedKnownArgs, ...extraSymbols],
          { canonical: false }
        );
        return ce.function('Function', [
          returnTypeOp !== undefined
            ? ce._fn('Typed', [deferred, returnTypeOp], { canonical: false })
            : deferred,
          // The deferred residual re-applies the original literal, so an
          // unapplied destructuring parameter takes its fresh SYMBOL here (the
          // `Apply` above passes it whole, and the original literal
          // destructures it), not the pattern `extras` carries for the pure
          // residual.
          ...unappliedParams.map((param, i) =>
            isDestructuringParameter(param) ? extraSymbols[i] : extras[i]
          ),
        ]);
      }

      const capturedScope =
        bodyFn.localScope!.parent ?? ce.context.lexicalScope;
      const freshScope: Scope = {
        parent: capturedScope,
        bindings: new Map(),
      };
      // The applied prefix binds exactly as a saturated call's parameters do,
      // destructuring included (step 5); a pattern in the prefix whose argument
      // has the wrong shape is the same error value here.
      const boundPrefix = parameterBindings(params, evaluatedKnownArgs);
      if (boundPrefix.error !== undefined) return boundPrefix.error;
      for (const leaf of boundPrefix.leaves)
        // Typed binding only in strict mode, where the applied prefix was
        // validated in step 3.
        declareParameterActivation(
          ce,
          leaf.name,
          leaf.site,
          leaf.value,
          freshScope,
          bodyFn.localScope
        );

      // Re-parent body scope to chain through freshScope, so nested
      // scoped expressions (Sum, Product) can find params by walking up:
      //   bigOpScope → bodyScope → freshScope(params) → capturedScope
      // Also temporarily remove param bindings from bodyScope so they
      // don't shadow the freshScope values during lookup.
      const bodyScope = bodyFn.localScope!;
      const savedParent = bodyScope.parent;
      bodyScope.parent = freshScope;
      const curryParamNames = boundPrefix.leaves.map((l) => l.name);
      const hiddenBindings = hideBodyScopeParams(bodyScope, curryParamNames);

      // Named 'call': a function-application activation frame. The debugger's
      // statement hook uses this to delimit stack frames (one per
      // activation — nested unnamed Block/loop contexts group into it).
      ce.pushScope(freshScope, 'call');
      let newBody: Expression;
      try {
        newBody = unwrapReturn(ce, evaluateStatements(ce, bodyFn.ops));
      } finally {
        ce.popScope();
        bodyScope.parent = savedParent;
        restoreBodyScopeParams(bodyScope, hiddenBindings);
      }

      // Re-attach the original return-type ascription onto the curried literal
      // (§6.5 point 3): partial application does not change the result type.
      // `newBody` is the evaluated body (the marker was consumed by
      // evaluation), so wrap it again; canonicalization re-normalizes the
      // ascription inside the Block (Phase 1).
      const curriedBody = newBody.subs(substitutions);
      const finalBody =
        returnTypeOp !== undefined
          ? ce._fn('Typed', [curriedBody, returnTypeOp], { canonical: false })
          : curriedBody;
      return ce.function('Function', [finalBody, ...extras]);
    }

    //
    // 4/ Evaluate arguments in the calling scope before switching context
    //
    let evaluatedArgs = args.map(argValue);

    // An argument that only became an error when EVALUATED (`f(g(1))` with
    // `g(1)` failing) bubbles like a literal one — see step 2.
    if (errorPolicy === 'bubble') {
      const err = firstErrorArg(evaluatedArgs);
      if (err !== undefined) return err;
    }

    //
    // 4b/ In strict mode, validate the evaluated arguments against the
    //     literal's declared parameter types (only when the literal carries at
    //     least one annotated parameter — untyped literals skip this entirely,
    //     §6.4). On mismatch, return the inert application carrying the
    //     error-marked arguments (§13 decision 6), matching the named-`Declare`
    //     path so broadcast consumers (`Map`, …) surface the same diagnostic.
    //
    if (ce.strict && validateApplication && _validateArguments) {
      const validated = _validateArguments(
        ce,
        evaluatedArgs,
        relaxBareParams(fnExpr.type.type)
      );
      if (validated !== null) {
        // Any invalid operand: mismatch — return the inert application.
        if (validated.some((x) => !x.isValid))
          return ce._fn('Apply', [fnExpr, ...validated]);
        // All valid: an operand was substituted (e.g. devolved); proceed with
        // the substituted arguments.
        evaluatedArgs = [...validated];
      }
    }

    // A pure literal over number-literal arguments: answer a memoized result
    // of the same application taken earlier in this evaluation (see
    // `IComputeEngine._applicationMemo`). Purity is read HERE, per
    // application, not when this wrapper was built — the wrapper is built
    // once per definition, and a callee the body applies may have been
    // redefined impure since (`effectsOf` is memoized, so the read is
    // cheap). The key carries the numeric-approximation flag — the exact
    // and the `.N()` answers differ — and spells `-0` apart from `0`, which
    // `JSON.stringify` would collapse.
    const memoKey =
      evaluatedArgs.every((a) => isNumber(a)) &&
      isPureComputedEffects(effectsOf(body))
        ? `${options?.numericApproximation ? 'N' : 'E'}|${evaluatedArgs
            .map((a) => (Object.is(a.re, -0) ? '-0' : JSON.stringify(a.json)))
            .join('|')}`
        : undefined;
    if (memoKey !== undefined) {
      const memo = ce._applicationMemo?.get(fnExpr);
      if (
        memo !== undefined &&
        memo.semanticVersion === ce._semanticVersion &&
        memo.objectStoreEpoch === ce._objectStoreEpoch &&
        memoDepsStillValid(fnExpr, memo.deps as MemoDeps)
      ) {
        const hit = memo.results.get(memoKey);
        if (hit !== undefined) return hit;
      }
    }

    // A recursive definition is not unrolled symbolically: a re-entrant
    // application with an argument that contains a free symbol abandons the
    // outermost application of this literal, which stays inert (see
    // `SymbolicRecursion`). Ground arguments never abandon anything.
    if (
      (activeApplications.get(fnExpr.hash) ?? 0) > 1 &&
      evaluatedArgs.some((a) => containsFreeSymbol(a))
    )
      throw new SymbolicRecursion(fnExpr.hash);

    //
    // 5/ Create a fresh scope per call with parent = the defining scope.
    //    bodyFn.localScope.parent is the scope where the Function was defined.
    //    This gives true lexical scoping: the fresh scope chain is
    //    [fresh scope (params)] -> [defining scope] -> ...
    //    The calling scope is never in the chain. (`capturedScope` is
    //    computed at the top of `invoke`: the hold-argument inlining above
    //    needs it before any argument is bound.)
    //
    const freshScope: Scope = {
      parent: capturedScope,
      bindings: new Map(),
    };

    // Declare parameters in the fresh scope. Annotated parameters are declared
    // with their declared type, non-inferred (§6.4); bare parameters stay
    // inferred as before. A DESTRUCTURING parameter binds one name per pattern
    // leaf, taken from the matching component of its (tuple) argument; a shape
    // mismatch is an error value and the body never runs.
    const bound = parameterBindings(params, evaluatedArgs);
    if (bound.error !== undefined) return bound.error;
    const leaves = bound.leaves;
    const paramNames = leaves.map((l) => l.name);
    for (const leaf of leaves)
      // Arguments were validated in step 4b, so a strict-mode typed binding
      // is known compatible.
      declareParameterActivation(
        ce,
        leaf.name,
        leaf.site,
        leaf.value,
        freshScope,
        bodyFn.localScope
      );

    // Re-parent body scope to chain through freshScope, so nested
    // scoped expressions (Sum, Product) can find params by walking up:
    //   bigOpScope → bodyScope → freshScope(params) → capturedScope
    // Also temporarily remove param bindings from bodyScope so they
    // don't shadow the freshScope values during lookup.
    const bodyScope = bodyFn.localScope!;
    const savedParent = bodyScope.parent;
    bodyScope.parent = freshScope;
    const hiddenBindings = hideBodyScopeParams(bodyScope, paramNames);

    // Push fresh scope and evaluate block contents directly.
    // We evaluate bodyFn.ops (the Block's children) rather than calling
    // body.evaluate() — see evaluateStatements JSDoc for why.
    // Named 'call': a function-application activation frame. The debugger's
    // statement hook uses this to delimit stack frames (one per
    // activation — nested unnamed Block/loop contexts group into it).
    ce.pushScope(freshScope, 'call');
    let result: Expression;
    try {
      result = unwrapReturn(ce, evaluateStatements(ce, bodyFn.ops));

      // A function body whose final value is a *bare symbol* bound to a
      // user-defined function literal (`helper(x) = …`, which creates an
      // operator definition local to this call frame) must return that
      // function as a first-class value so it can escape the frame. The
      // operator definition is unreachable once the frame is popped, but its
      // stored literal (`_lambdaLiteral`) is a plain value. Resolve it here,
      // while the frame is still pushed and the definition is reachable;
      // `captureClosures` (next) then rebinds the literal's free variables to
      // this frame. (Built-in operators are not lambdas and are unaffected.)
      result = resolveEscapingLambda(ce, result);

      // Closure capture: walk the result tree and rebind any Function literals
      // so their body scopes close over the current freshScope.
      //
      // Without this, inner functions' Block._localScope.parent points to
      // the static defining scope, so outer-call parameters are lost once
      // freshScope is popped.
      result = captureClosures(ce, result, freshScope);

      // Substitute each parameter's VALUE into a partially-symbolic result that
      // still references the parameter symbol. A body that cannot fully evaluate
      // (e.g. `Which`/`If` with an undetermined condition) returns itself inert,
      // referencing the raw parameter symbol rather than the bound value; once
      // `freshScope` is popped that symbol is unbound, so every element of a
      // lazy `Map`/`Filter`/`Tabulate` stream would otherwise lose its argument
      // (Tycho item 26). This mirrors the comprehension stream's
      // `comprehensionIndexSubs` fix. It is a no-op for a body that already
      // resolved its parameters.
      //
      // Keyed on the parameter's BINDING, not its name. The question is "did
      // this occurrence come from an unevaluated reference to the parameter?",
      // and the binding answers it exactly: an occurrence resolving to the
      // body's parameter binding did, and one that merely shares the spelling
      // — a free symbol that arrived inside a dereferenced stored value, or an
      // inner lambda's own re-binding of the name — did not.
      //
      // This replaces a name-keyed substitution that could not tell those
      // apart and needed three heuristics to approximate the difference: a
      // capture-avoiding walk to protect a returned lambda that re-binds the
      // parameter, a held-conditional test, and an argument-ambiguity test for
      // `Apply(x ↦ x + 1, x + 1)` (which must be `x + 2`, not `x + 3`). All
      // three fall out of asking the right question: a re-binding lambda
      // declares a DIFFERENT binding, and an `x` that came from the argument's
      // value carries the caller's binding, so neither matches.
      if (result.has(paramNames)) {
        // ONE binding per parameter — the literal's own. `hideBodyScopeParams`
        // has removed it from `bodyScope` for the duration of the call, and
        // the call's value lives in a SEPARATE definition in `freshScope`; the
        // activation link (`declareParameterActivation`) is what makes both
        // resolve to it, so this no longer has to enumerate the places a
        // parameter's binding can be found. The raw-occurrence case is still
        // name-keyed — a raw symbol carries no binding at all.
        const subs: ParameterSub[] = [];
        for (const leaf of leaves) {
          if (!result.has(leaf.name)) continue;
          subs.push([
            staticParameterBinding(leaf.site, leaf.name, bodyScope),
            leaf.name,
            leaf.value,
            leaf.value.has(leaf.name),
          ]);
        }
        if (subs.length > 0) result = bindingKeyedSubs(result, subs);
      }

      // Honor a numeric-approximation request (`N(f(2))`) by approximating
      // the (exactly-evaluated) result HERE, while the function's scope
      // frame is still pushed. Approximating after the frame is popped
      // would re-resolve free symbols in the *caller's* dynamic context,
      // breaking lexical scoping (see scope.test.ts "Dynamic scoping").
      //
      // In-frame, though, the pass must not re-resolve those symbols by NAME
      // either — that was Channel C of the name-capture defect: `let a = x + 1;
      // g(x) = a; N(g(5))` gave `6` while `g(5)` gave `x + 1`, because the
      // numeric pass looked `x` up again and found the frame's parameter. Every
      // occurrence that genuinely refers to a parameter has already been
      // replaced by its value (`bindingKeyedSubs`, above), so what remains
      // means its own binding and is resolved as such.
      if (options?.numericApproximation)
        result = evaluateInOwnBindings(ce, result, {
          numericApproximation: true,
        });
    } finally {
      ce.popScope();
      bodyScope.parent = savedParent;
      restoreBodyScopeParams(bodyScope, hiddenBindings);
    }

    if (memoKey !== undefined && result.isValid) {
      ce._applicationMemo ??= new WeakMap();
      let memo = ce._applicationMemo.get(fnExpr);
      if (
        memo === undefined ||
        memo.semanticVersion !== ce._semanticVersion ||
        memo.objectStoreEpoch !== ce._objectStoreEpoch ||
        !memoDepsStillValid(fnExpr, memo.deps as MemoDeps)
      ) {
        // A literal whose dependencies cannot be snapshotted (a free name
        // with no binding at all, resolved dynamically at walk time) is not
        // memoizable.
        const deps = snapshotMemoDeps(fnExpr);
        if (deps === undefined) return result;
        memo = {
          semanticVersion: ce._semanticVersion,
          objectStoreEpoch: ce._objectStoreEpoch,
          deps,
          results: new Map(),
        };
        ce._applicationMemo.set(fnExpr, memo);
      }
      memo.results.set(memoKey, result);
    }
    return result.isValid ? result : undefined;
  };

  return wrapRecursion(ce, guardSymbolicRecursion(fnExpr, invoke));
}

/**
 * Return a lambda function, assuming a scoped environment has been
 * created and there is a single numeric argument
 */
export function makeLambdaN1(
  expr: Expression
): ((arg: number) => number) | undefined {
  const lambda = makeLambda(expr);
  if (!lambda) return undefined;
  return (arg) =>
    (lambda([expr.engine.number(arg)])?.valueOf() as number) ?? NaN;
}

/**
 * Given an expression such as:
 * - ["Function", ["Add", 1, "x"], "x"]
 * - ["Function", ["Divide", "_", 2]]
 * - ["Multiply, "_", 3]
 * - ["Add, "_1", "_2"]
 * - "Sin"
 *
 * return a JS function that can be called with arguments.
 */
export function applicable(
  fn: Expression
): (
  xs: ReadonlyArray<Expression>,
  options?: ApplyOptions
) => Expression | undefined {
  return (
    makeLambda(fn) ??
    ((xs, options) =>
      fn.engine.function('Apply', [fn, ...xs]).evaluate(options))
  );
}

/**
 * Use `applicableN1()` when the function is known to be a function with a
 * single real argument that returns a real value.
 *
 * Unlike `apply()`, `applicableN1()` returns a function that can be called
 * with an argument.
 *
 */
export function applicableN1(fn: Expression): (x: number) => number {
  const lambda = makeLambda(fn);
  const ce = fn.engine;

  if (lambda) return (x) => lambda([ce.number(x)])?.re ?? NaN;

  return (x) => ce.function('Apply', [fn, ce.number(x)]).evaluate().re;
}

/**
 * Given a string like "f(x,y)" return, ["f", ["x", "y"]]
 */
export function parseFunctionSignature(
  s: string
): [id: string, args: string[] | undefined] {
  const m = s.match(/(.+)\((.*)\)/);
  if (!m) return [s, undefined];
  const id = m[1];
  const args = m[2].split(',').map((x) => x.trim());
  return [id, args];
}

/** Lookup a definition matching a symbol in a lexical scope chain */
export function lookup(
  id: MathJsonSymbol,
  scope: Scope
): undefined | BoxedDefinition {
  console.assert(typeof id === 'string' && id.length > 0);
  let currentScope: Scope | null = scope;
  while (currentScope) {
    const def = currentScope.bindings.get(id);
    if (def) return def;

    currentScope = currentScope.parent;
  }
  return undefined;
}

/** Could this definition satisfy a function-application (operator) position?
 * An operator def always can; a value def can unless its declared type
 * PROVABLY excludes functions (a plain `number`, `string`, collection, …).
 * A value def with an indeterminate type (`unknown`/`any`/`value`) may hold a
 * function literal, so it can. (Inline property checks, not
 * `isValueDef`/`isOperatorDef` from `boxed-expression/utils`, to avoid a
 * dependency cycle.)
 */
function isApplicableDef(def: BoxedDefinition): boolean {
  if ('operator' in def) return true;
  if ('value' in def) {
    const t = (def as { value: BoxedValueDefinition }).value.type;
    if (t.isUnknown) return true;
    const tt = t.type;
    if (tt === 'any' || tt === 'value' || tt === 'unknown') return true;
    return t.matches('function');
  }
  return true;
}

/**
 * Lookup a definition for a symbol in FUNCTION-APPLICATION (operator)
 * position. Like {@link lookup}, but an inner binding that PROVABLY cannot be
 * applied — a value def whose type excludes functions, e.g. a user symbol
 * `N = 85` shadowing the built-in `N` operator — defers to an outer
 * applicable definition of the same name. A bare-symbol reference still
 * resolves to the inner value (`N + 1` is `86`); only the operator position
 * skips it (`N(x)` numericizes). If no applicable definition exists anywhere
 * in the chain, the innermost binding is returned unchanged so the ordinary
 * "not a function" diagnostics still apply.
 *
 * Pass `engine` from a CANONICALIZATION-time caller. A name introduced by the
 * construct being canonicalized — a function literal's parameter, a `Block`'s
 * `Declare`d local — shadows any same-named binding of the enclosing context,
 * and must do so in operator position as well as in value position. Its
 * binding may not exist yet when a call to it is canonicalized (the body of
 * `(g) ↦ g(2)` is canonicalized before its parameters are declared), and
 * without the engine the walk then escapes to the enclosing binding and caches
 * it on the node: `const g = (x) ↦ x + 1; const f = (g) ↦ g(2)` applied the
 * OUTER `g`, so `f(x ↦ 10x)` answered 3 instead of 20. Callers with no
 * canonicalization in progress (the compiler, `D`) omit it.
 */
export function lookupApplicable(
  id: MathJsonSymbol,
  scope: Scope,
  engine?: ComputeEngine
): undefined | BoxedDefinition {
  console.assert(typeof id === 'string' && id.length > 0);

  // A shadowed name resolves to the binding the shadowing construct's own
  // references already created, if any; otherwise the walk below stops before
  // the scope enclosing that construct, so a binding from outside it is never
  // reached. Returning nothing leaves the head undeclared, which is exactly the
  // state it would be in with no enclosing binding of that name — the caller
  // then auto-declares it locally, as it already does for `(g) ↦ g(2)` written
  // where no outer `g` exists.
  let boundary: Scope | undefined;
  if (engine?._isShadowedParameter(id)) {
    const shadowed = engine._shadowedParameterDef(id);
    if (shadowed !== undefined) return shadowed;
    boundary = engine._shadowedParameterBoundary(id);
  }

  let innermost: BoxedDefinition | undefined;
  let currentScope: Scope | null = scope;
  while (currentScope && currentScope !== boundary) {
    const def = currentScope.bindings.get(id);
    if (def) {
      if (isApplicableDef(def)) return def;
      innermost ??= def;
    }
    currentScope = currentScope.parent;
  }
  return innermost;
}

/** True when `s` is a type string that parses to a POLYTYPE (a `where`
 * clause). Used to reject a generic annotation on a function literal (D7,
 * §4.1 of the type-variables design); a non-type string is not our business
 * and answers `false`. */
function isPolytypeString(ce: ComputeEngine, s: string): boolean {
  if (!s.includes('where')) return false;
  try {
    return isPolymorphicType(parseType(s, ce._typeResolver));
  } catch {
    return false;
  }
}
