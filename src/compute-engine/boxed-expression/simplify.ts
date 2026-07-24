import { checkDeadline } from '../../common/interruptible.js';
import { replace } from './rules.js';
import { holdMap } from './hold.js';
import { expToTrig } from './exp-to-trig.js';
import { expand } from './expand.js';
import {
  isValueDef,
  hasAssignedVariable,
  assignedVariableNames,
} from './utils.js';
import type {
  Expression,
  SimplifyOptions,
  BoxedRuleSet,
  RuleStep,
  RuleSteps,
} from '../global-types.js';
import {
  isNumber,
  isSymbol,
  isFunction,
  isString,
  isContinuationOperand,
} from './type-guards.js';

type InternalSimplifyOptions = SimplifyOptions & {
  useVariations: boolean;
  /** When set (only by `expr.explain()`), `simplifyOperands` records the
   * lifted operand-level sub-chain into each `'simplified operands'` aggregate
   * step's `substeps`. Off (undefined) in the plain `simplify()` path — no
   * allocation, byte-identical driver behavior. */
  collectSubsteps?: boolean;
  /** Set on the inner call of the trial expansion (see the end of
   * `simplify()`) so the trial cannot nest. */
  noExpansionTrial?: boolean;
};

const BASIC_ARITHMETIC = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Rational',
];

// Trig functions with constructible special values
const CONSTRUCTIBLE_TRIG = ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot'];

/**
 * Check if an expression contains a constructible trig function somewhere
 * in its subexpressions. Used to determine if we need to recursively
 * simplify an operand to get constructible value simplification.
 */
function containsConstructibleTrig(expr: Expression): boolean {
  if (CONSTRUCTIBLE_TRIG.includes(expr.operator)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => containsConstructibleTrig(op));
}

/**
 * Recursively evaluate purely numeric subexpressions without full simplification.
 * This handles cases like Power(x, Add(1,2)) where Add(1,2) should become 3.
 * Unlike full simplification, this won't expand polynomial factors.
 */
function evaluateNumericSubexpressions(expr: Expression): Expression {
  // Number literals are already simplified
  if (isNumber(expr)) return expr;

  // No ops means symbol or other atomic - return as is
  if (!isFunction(expr)) return expr;

  // Don't evaluate Power expressions that should stay symbolic:
  // - e^n (for potential combination with e^x)
  // - n^{p/q} where result is irrational (e.g., 2^{3/5})
  if (expr.operator === 'Power') {
    if (isSymbol(expr.op1, 'ExponentialE')) {
      return expr;
    }
    // Skip n^{p/q} with non-integer exponent - these produce irrational results
    if (expr.op2?.isRational === true && expr.op2?.isInteger === false) {
      return expr;
    }
  }

  // Value-blindness (see the `hasAssignedVariable` guard below): fold only a
  // GENUINELY constant subexpression (literals and built-in constants). A
  // subexpression with no free unknowns must NOT be folded when its
  // constant-ness comes from an assigned value — `9 - w²` with `w := 5` stays
  // symbolic, not `-72`, and a binder body `Add(x,1)` with a global `x := 5`
  // stays `x + 1`. `simplify()` never substitutes assigned values; that is
  // `.evaluate()`'s job. The `hasAssignedVariable` check is ordered LAST (after
  // the cheap `unknowns`/operator gates) so it runs only on fold candidates.

  // If purely numeric (no unknowns), evaluate the whole expression.
  if (
    expr.unknowns.length === 0 &&
    BASIC_ARITHMETIC.includes(expr.operator) &&
    !hasAssignedVariable(expr)
  ) {
    const evaluated = expr.evaluate();
    if (isNumber(evaluated)) return evaluated;
  }

  // Constant logarithms are folded to their exact value even when they are
  // not BASIC_ARITHMETIC and are buried inside another operand. This closes
  // the Divide-context gap where `(ln(e)·y)/x` kept its `ln(e)` factor: the
  // lazy-Multiply branch simplifies bare `Ln` operands, but the Divide
  // branch only runs this numeric fold on its operands, so a constant `Ln`
  // in a Divide numerator/denominator was never reduced. The exactness
  // contract keeps genuinely-symbolic logs (Ln(2)) as non-literal, so only
  // closed-form constants (Ln(e) -> 1, Log(1000,10) -> 3) fold here.
  if (
    (expr.operator === 'Ln' || expr.operator === 'Log') &&
    expr.unknowns.length === 0 &&
    !hasAssignedVariable(expr)
  ) {
    const evaluated = expr.evaluate();
    if (isNumber(evaluated) && !evaluated.isSame(expr)) return evaluated;
  }

  // Otherwise, recursively process operands
  const newOps = expr.ops.map((op) => evaluateNumericSubexpressions(op));

  // Check if anything changed
  const changed = newOps.some((op, i) => op !== expr.ops[i]);
  if (!changed) return expr;

  // Reconstruct with _fn to avoid re-canonicalization
  return expr.engine._fn(expr.operator, newOps);
}

/**
 * Cheap structural pre-check: is there a product or power that expansion could
 * act on at all? Keeps the trial expansion below from calling `expand()` on
 * every expression that reaches the fixpoint.
 */
function mightExpand(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  if (
    expr.operator === 'Multiply' &&
    expr.ops.some((x) => isFunction(x, 'Add'))
  )
    return true;
  if (expr.operator === 'Power' && isFunction(expr.op1, 'Add')) return true;
  return expr.ops.some(mightExpand);
}

/** Cap on the number of terms the trial expansion may produce. Beyond this the
 * expansion is skipped — the acceptance gate rejects a growth anyway, and
 * running `expand()` first would allocate the multinomial blow-up before the
 * cost check could reject it. */
const MAX_TRIAL_EXPANSION_TERMS = 1000;

/** Upper bound on the term count of `expand(expr)` — the product of operand
 * counts for a `Multiply`, `baseᵉˣᵖ` for an integer-power of a sum. Returns
 * `Infinity` for a blow-up so the caller skips the trial. */
function expandedTermBound(expr: Expression): number {
  if (!isFunction(expr)) return 1;
  const op = expr.operator;
  if (op === 'Add')
    return expr.ops.reduce((s, x) => s + expandedTermBound(x), 0);
  if (op === 'Multiply')
    return expr.ops.reduce((p, x) => p * expandedTermBound(x), 1);
  if (op === 'Power') {
    const base = expandedTermBound(expr.op1);
    const n = isNumber(expr.op2) ? expr.op2.re : undefined;
    // Use the exponent's magnitude: `expand()` fully expands the positive
    // power even for a negative exponent, so `(a+b)^-10000` blows up just as
    // `(a+b)^10000` does.
    if (base > 1 && n !== undefined && Number.isInteger(n) && n !== 0) {
      const k = Math.abs(n);
      return k > 40 ? Infinity : Math.pow(base, k);
    }
    return base;
  }
  // Any other head is atomic for expansion purposes (it is not grown).
  return 1;
}

/**
 * Heads that `simplify()` evaluates.
 *
 * **Membership rule:** the operator's `evaluate` handler reduces its operands
 * to a closed form determined by their *structure* — a matrix to a scalar, a
 * collection to a measure — rather than rewriting the expression. Such a head
 * carries no simplification rule of its own, so without this `simplify()`
 * returned it untouched: `det [[a,b],[c,d]]` stayed `Determinant(…)` while
 * `evaluate()` gave `ad − bc`.
 *
 * `Max`/`Min` deliberately fail that rule and are **not** members: they reduce
 * their operands' *values*, not their structure, and the value fold is already
 * evaluation's job. Including them changed no result, only which stage
 * produced it.
 *
 * Deliberately excluded:
 * - the transformers (`Simplify`, `Expand`, `Factor`, …) — their operands are
 *   reduced by `reduceTransformerOperand` instead;
 * - `Evaluate`/`N` — they numericize, the opposite of simplifying;
 * - anything whose handler can re-enter simplification (see CLAUDE.md's
 *   recursion notes), which is why this is a closed list rather than "evaluate
 *   whatever gets cheaper".
 */
const SIMPLIFY_EVALUABLE_HEADS = new Set([
  'Determinant',
  'Trace',
  'Transpose',
  'Length',
]);

/**
 * Heads whose `evaluate` handler performs a heavy symbolic *computation*
 * (differentiation, integration, summation, limits, root-finding) that
 * `simplify()` must never trigger — `docs/SIMPLIFY.md` promises these stay
 * symbolic under `simplify()`. Evaluating a whitelisted structural head
 * (`evaluateStructuralHead`) evaluates the *whole* operand tree, so a matrix
 * entry containing one of these would run it; the gate below declines instead.
 */
const HEAVY_COMPUTE_HEADS = new Set([
  'D',
  'Derivative',
  'ND',
  'Integrate',
  'NIntegrate',
  'Sum',
  'Product',
  'Limit',
  'NLimit',
  'Solve',
  'Root',
  'Series',
]);

/** Does the operand subtree of `expr` contain a heavy-compute head? */
function containsHeavyHead(expr: Expression): boolean {
  if (!isFunction(expr)) return false;
  return expr.ops.some(
    (op) =>
      (isFunction(op) && HEAVY_COMPUTE_HEADS.has(op.operator)) ||
      containsHeavyHead(op)
  );
}

/** Does any symbol in `expr` carry an assigned value? */
function hasBoundSymbol(expr: Expression): boolean {
  for (const name of expr.symbols) {
    const def = expr.engine.lookupDefinition(name);
    if (isValueDef(def) && def.value.value !== undefined) return true;
  }
  return false;
}

/**
 * Evaluate a structural head (see `SIMPLIFY_EVALUABLE_HEADS`), or `undefined`
 * when it does not apply.
 *
 * Declines when any operand mentions a symbol with an assigned value:
 * `simplify()` is value-blind — `(a + 2).simplify()` is `a + 2` even when
 * `a := 5` — and evaluating the head would substitute that value, breaking the
 * invariant for this one family of expressions.
 */
function evaluateStructuralHead(expr: Expression): Expression | undefined {
  if (!SIMPLIFY_EVALUABLE_HEADS.has(expr.operator)) return undefined;
  if (hasBoundSymbol(expr)) return undefined;

  // `expr.evaluate()` evaluates the whole operand tree, not just the
  // whitelisted head. An impure descendant would then *run* during
  // simplification — `simplify(Transpose([[Random()]]))` must not draw a
  // random number. Decline anything impure; the exact/value-carrying heads we
  // want (matrix entries, `Length` of a list) are all pure.
  if (expr.isPure === false) return undefined;

  // A pure-but-heavy symbolic-compute descendant (`D`, `Integrate`, `Sum`,
  // `Limit`, …) would likewise *run* during simplification — e.g.
  // `simplify(Transpose([[D(x^2,x)]]))` must leave the `D` symbolic per
  // docs/SIMPLIFY.md. Decline when the operand tree contains such a head.
  if (containsHeavyHead(expr)) return undefined;

  const result = expr.evaluate();
  if (result.isSame(expr) || !result.isValid) return undefined;
  return result;
}

/**
 * Value-blind entry point for the PUBLIC `.simplify()` methods (on
 * `BoxedSymbol`/`BoxedFunction`). It enforces ROADMAP Item E's invariant:
 *
 * > `simplify()` may use sign/parity derived from a symbol's DECLARED TYPE and
 * > in-scope ASSUMPTIONS, but NOT from its ASSIGNED VALUE. An assigned value is
 * > treated as if the symbol were merely declared with that value's type.
 *
 * The seam: before running `simplify`, shadow-declare every assigned,
 * non-constant free symbol of `expr` as VALUELESS (keeping its declared type)
 * in a fresh scope. With no value, `BoxedSymbol.sgn`/`isOdd`/`isEven` fall back
 * to type + assumptions (the shadow scope preserves outer assumptions), so no
 * value leaks into a sign/parity-driven rewrite. `.evaluate()`/`.N()`/type
 * inference are untouched — only `simplify()`'s VIEW is blinded.
 *
 * Re-entrancy is automatically safe: a rule that recursively calls
 * `.simplify()` on a sub-expression re-enters here, but the symbols are already
 * shadowed valueless, so `assignedVariableNames` returns nothing and no scope
 * is pushed.
 */
export function simplifyValueBlind(
  expr: Expression,
  options?: Partial<InternalSimplifyOptions>
): RuleSteps {
  const shadow = assignedVariableNames(expr);
  if (shadow.length === 0) return simplify(expr, options);

  const ce = expr.engine;
  // Capture each symbol's declared type as a STRING; passing the BoxedType
  // object to `declare` throws "type invalid".
  const types = shadow.map((n) => ce.box(n).type.toString());

  ce.pushScope();
  try {
    shadow.forEach((n, i) => {
      // If an exotic type fails to round-trip through `declare`, skip shadowing
      // THAT symbol rather than aborting the whole simplify: a rare value leak
      // is better than a thrown simplify.
      try {
        ce.declare(n, { type: types[i] });
      } catch {
        /* leave this symbol unshadowed */
      }
    });
    return simplify(expr, options);
  } finally {
    ce.popScope();
  }
}

export function simplify(
  expr: Expression,
  options?: Partial<InternalSimplifyOptions>,
  steps?: RuleSteps
): RuleSteps {
  const hasSeen = (x: Expression) =>
    steps && steps.some((y) => y.value.isSame(x));

  // Check we are not recursing infinitely
  if (hasSeen(expr)) return steps!;

  // Additional safety: limit maximum simplification steps to prevent stack overflow
  // This catches cases where .simplify() is called recursively in new contexts
  const MAX_SIMPLIFY_STEPS = 1000;
  if (steps && steps.length >= MAX_SIMPLIFY_STEPS) {
    console.warn(
      `Simplification exceeded ${MAX_SIMPLIFY_STEPS} steps, stopping to prevent infinite recursion`
    );
    return steps;
  }

  if (!steps) steps = [{ value: expr, because: 'initial' }];

  //
  // 1/ Use the canonical form, if applicable
  //
  if (!expr.isValid) return steps;

  if (!(expr.isCanonical || expr.isStructural)) {
    const canonical = expr.canonical;
    if (!(canonical.isCanonical || canonical.isStructural)) return steps;
    // Don't pass steps when recursing for canonicalization.
    // The non-canonical form is structurally the same (isSame returns true),
    // so the hasSeen check would incorrectly trigger and skip simplification.
    return simplify(canonical, options);
  }

  const ce = expr.engine;

  //
  // 2/ If the 'fu' strategy is requested, apply the Fu algorithm
  //
  if (options?.strategy === 'fu') {
    // Strategy: Try both approaches and pick the best result
    // 1. Fu first (preserves symbolic patterns like Morrie's law)
    // 2. Simplify first, then Fu (handles period reduction for angle contraction)

    const costFn = (e: Expression) => ce.costFunction(e);

    // Approach 1: Fu first (for Morrie-like patterns)
    const fuFirst = ce._fuAlgorithm(expr);
    let result1 = fuFirst?.value ?? expr;
    if (fuFirst) {
      const postSimplified = result1.simplify();
      if (!postSimplified.isSame(result1)) {
        result1 = postSimplified;
      }
    }

    // Approach 2: Simplify first, then Fu (for period reduction patterns)
    const preSimplified = expr.simplify();
    const fuSecond = ce._fuAlgorithm(preSimplified);
    let result2 = fuSecond?.value ?? preSimplified;
    if (fuSecond) {
      const postSimplified = result2.simplify();
      if (!postSimplified.isSame(result2)) {
        result2 = postSimplified;
      }
    }

    // Pick the best result (lower cost wins)
    const cost1 = costFn(result1);
    const cost2 = costFn(result2);
    const bestResult = cost1 <= cost2 ? result1 : result2;

    if (!bestResult.isSame(expr)) {
      steps.push({ value: bestResult, because: 'fu' });
    }

    return steps as RuleSteps;
  }

  //
  // 2b/ If the 'trig' strategy is requested, rewrite exponentials of an
  // imaginary argument to trigonometric form (e^{iθ} → cos θ + i·sin θ) before
  // the standard simplification. This is the opt-in inverse of the default
  // evaluate() behavior, which keeps e^{iθ} symbolic for a symbolic angle.
  //
  if (options?.strategy === 'trig') {
    const converted = expToTrig(expr);
    if (!converted.isSame(expr)) {
      expr = converted;
      steps.push({ value: expr, because: 'exp-to-trig' });
    }
    // fall through to the standard rule loop to simplify the trig form
  }

  // Rules tagged `purpose: 'expand'` grow expressions by design: they are
  // excluded from simplify()'s scan (the 'standard-simplification' set is
  // already filtered in its build closure), but remain reachable via
  // `expr.replace()`.
  // Ruleset selection per the documented `rules` contract
  // (`SimplifyOptions.rules`): `null` means "use no rules" (structural /
  // numeric folding only), an omitted (`undefined`) value means "use the
  // default simplification rules", and any provided value is used as the custom
  // ruleset. A truthy check conflated `null` with omitted, applying the full
  // default ruleset where the docs promise none — so branch on the exact value.
  // Capture the caller's original `rules` mode before it is overwritten below:
  // `null` means "no rules, structural/numeric folding only", which also
  // disables the trial expansion (an `expand()` is a rule-driven rewrite).
  const rulesWereNull = options?.rules === null;

  let rules: BoxedRuleSet;
  if (options?.rules === null) {
    rules = { rules: [] };
  } else if (options?.rules !== undefined) {
    const boxed = ce.rules(options.rules, { canonical: true });
    rules = { rules: boxed.rules.filter((r) => r.purpose !== 'expand') };
  } else rules = ce.getRuleSet('standard-simplification')!;

  options = { ...options, rules };

  //
  // 3/ Loop until the expression has been previously seen,
  // or no rules can be applied
  //
  do {
    const newSteps = simplifyExpression(expr, rules, options, steps);

    if (newSteps.length <= steps.length) break;

    // Record the new expression as the current one
    expr = newSteps.at(-1)!.value;

    steps = newSteps;
  } while (!steps.slice(0, -1).some((x) => x.value.isSame(expr)));

  //
  // 4/ Cost-guarded trial expansion
  //
  // Rules tagged `purpose: 'expand'` are excluded from the scan above because
  // expansion usually grows an expression. That left `simplify()` unable to
  // reach a strictly *cheaper* distributed form — it never generated the
  // candidate. For `(-3y/x + 2/x²)·(1+xy)³` the stuck form costs 76 and the
  // distributed, recombined form costs 27; `Expand(expr).simplify()` found it
  // immediately, `expr.simplify()` could not.
  //
  // So try it exactly once, at the fixpoint, and keep the result only when the
  // cost function says it is strictly cheaper. This cannot cycle — it runs
  // after the loop and the inner call has the trial disabled — and it cannot
  // blow up, because the cost gate is the acceptance test.
  //
  if (
    !options.noExpansionTrial &&
    !rulesWereNull &&
    mightExpand(expr) &&
    expandedTermBound(expr) <= MAX_TRIAL_EXPANSION_TERMS
  ) {
    const expanded = expand(expr);
    if (expanded !== null && expanded !== undefined && !expanded.isSame(expr)) {
      const settled = simplify(expanded, {
        ...options,
        noExpansionTrial: true,
      }).at(-1)!.value;
      const costFn =
        options.costFunction ?? ((e: Expression) => ce.costFunction(e));
      if (costFn(settled) < costFn(expr))
        steps = [...steps, { value: settled, because: 'expanded (cheaper)' }];
    }
  }

  return steps as RuleSteps;
}

function isCheaper(
  oldExpr: Expression,
  newExpr: Expression | null | undefined,
  costFunction?: (expr: Expression) => number
): boolean {
  if (newExpr === null || newExpr === undefined) return false;
  if (oldExpr === newExpr) return false;

  if (oldExpr.isSame(newExpr)) return false;

  const ce = oldExpr.engine;

  costFunction ??= (x) => ce.costFunction(x);

  const oldCost = costFunction(oldExpr);
  const newCost = costFunction(newExpr);

  // Use a threshold of 1.3 (30% more expensive) to allow mathematically valid
  // simplifications like combining powers (2 * 2^x -> 2^(x+1))
  if (newCost <= 1.3 * oldCost) return true;

  return false;
}

/**
 * Lift the sub-chain produced by fully simplifying an operand into
 * whole-expression context and append it to `substepsOut`. Only reached when
 * collecting (during `expr.explain()`); the plain `simplify()` path passes
 * `substepsOut === undefined` and never allocates.
 *
 * `build` is the same constructor the branch's return path uses (so lifted
 * intermediate states match how the aggregate value is built); `prefix` is the
 * already-simplified earlier operands and `suffix` the untouched original
 * later operands (operands are processed in order).
 */
function collectOperandSubsteps(
  chain: RuleSteps,
  substepsOut: RuleSteps,
  prefix: readonly Expression[],
  suffix: readonly Expression[],
  build: (ops: Expression[]) => Expression
): void {
  const lift = (v: Expression) => build([...prefix, v, ...suffix]);
  // Skip index 0 (the `'initial'` seed of the operand's own chain).
  for (let i = 1; i < chain.length; i++) {
    const s = chain[i];
    // Flatten a nested `'simplified operands'` aggregate that carries its own
    // substeps: those values are already lifted into this operand's context by
    // the deeper recursion, so re-lift them one level up. A bare
    // `'simplified operands'` step (no substeps) is kept as-is and curated
    // generically upstream.
    const inner =
      s.because === 'simplified operands' && s.substeps ? s.substeps : [s];
    for (const sub of inner) {
      const step: RuleStep = { value: lift(sub.value), because: sub.because };
      if (sub.purpose !== undefined) step.purpose = sub.purpose;
      substepsOut.push(step);
    }
  }
}

/**
 * Fully simplify one operand `x` at position `index` (of `ops`), capturing its
 * lifted sub-chain into `substepsOut` when collecting. `prefix` is the running
 * array of already-simplified operands (indices `< index`). Returns the
 * simplified operand value.
 */
function simplifyOperandCapture(
  x: Expression,
  index: number,
  ops: readonly Expression[],
  prefix: readonly Expression[],
  options: Partial<SimplifyOptions> | undefined,
  substepsOut: RuleSteps | undefined,
  build: (ops: Expression[]) => Expression
): Expression {
  const chain = simplify(x, options);
  if (substepsOut && chain.length > 1)
    collectOperandSubsteps(
      chain,
      substepsOut,
      prefix,
      ops.slice(index + 1),
      build
    );
  return chain.at(-1)!.value;
}

function simplifyOperands(
  expr: Expression,
  options?: Partial<SimplifyOptions>,
  // Out-param: when provided (only by `simplifyExpression` during
  // `expr.explain()`), the operand-level sub-chains are lifted and appended
  // here to enrich the `'simplified operands'` aggregate step. When undefined,
  // this function is byte-for-byte the plain simplify path.
  substepsOut?: RuleSteps
): Expression {
  if (!isFunction(expr)) return expr;

  const def = expr.operatorDefinition;

  // For scoped functions (Sum, Product, D), use holdMap but simplify non-body operands
  if (def?.scoped === true) {
    // Use _fn() to bypass canonicalization - operands are already canonical.
    // This avoids triggering handlers like D's canonicalFunctionLiteralArguments
    // which would add extra Function wrappers.
    const build = (o: Expression[]) => expr.engine._fn(expr.operator, o);
    const simplifiedOps: Expression[] = [];
    for (let i = 0; i < expr.ops.length; i++) {
      const x = expr.ops[i];
      // Don't simplify the body (first operand) to allow pattern-matching rules to work
      if (i === 0) simplifiedOps.push(x);
      // Simplify other operands (like Limits)
      else
        simplifiedOps.push(
          simplifyOperandCapture(
            x,
            i,
            expr.ops,
            simplifiedOps,
            options,
            substepsOut,
            build
          )
        );
    }
    return build(simplifiedOps);
  }

  // For non-scoped functions, we need to balance simplification with holdMap semantics

  // First get the operands through holdMap
  const ops = holdMap(expr, (x) => x);

  // Collection literals (List — including the rows of a matrix) are lazy to
  // avoid eager element evaluation, but simplify() should still reach each
  // element. Unlike Add/Multiply, a List has no cross-element simplify rules
  // to interfere with, so simplifying elements independently is safe.
  if (expr.operator === 'List') {
    const build = (o: Expression[]) => expr.engine.function('List', o);
    const simplifiedOps: Expression[] = [];
    for (let i = 0; i < ops.length; i++)
      simplifiedOps.push(
        simplifyOperandCapture(
          ops[i],
          i,
          ops,
          simplifiedOps,
          options,
          substepsOut,
          build
        )
      );
    const changed = simplifiedOps.some((op, i) => !op.isSame(ops[i]));
    if (!changed) return expr;
    return build(simplifiedOps);
  }

  // For lazy functions (Multiply, Add), only simplify Sum/Product operands
  // and expressions containing constructible trig functions
  // to avoid interfering with their special handling in simplify-rules.
  // However, always evaluate purely numeric subexpressions (like 2*3 in exponents)
  // so that (x^3)^2 * (y^2)^2 becomes x^6 * y^4.
  // Also simplify Power expressions with negative bases and fractional exponents
  // to ensure proper sign factoring (e.g., (-2x)^{3/5} -> -(2x)^{3/5}).
  if (def?.lazy) {
    const build = (o: Expression[]) => expr.engine.function(expr.operator, o);
    const simplifiedOps: Expression[] = [];
    const full = (x: Expression, i: number) =>
      simplifyOperandCapture(
        x,
        i,
        ops,
        simplifiedOps,
        options,
        substepsOut,
        build
      );
    for (let i = 0; i < ops.length; i++) {
      const x = ops[i];
      if (
        x.operator === 'Sum' ||
        x.operator === 'Product' ||
        containsConstructibleTrig(x)
      )
        simplifiedOps.push(full(x, i));
      // Simplify Ln/Log operands within Add/Multiply to enable term cancellation
      // (e.g., ln(x^3) -> 3*ln(x) so that ln(x^3) - 3*ln(x) = 0)
      // Only simplify Ln (natural log), not Log (which may lose base info)
      else if (x.operator === 'Ln') simplifiedOps.push(full(x, i));
      // Simplify Abs operands to enable cancellation
      // (e.g., |xy| -> |x||y| so that |xy| - |x||y| = 0)
      // Also handle Negate(Abs(...)) which appears in subtraction expressions
      else if (x.operator === 'Abs') simplifiedOps.push(full(x, i));
      else if (isFunction(x, 'Negate') && x.op1?.operator === 'Abs')
        simplifiedOps.push(full(x, i));
      // Power expressions with fractional exponents may need sign factoring
      // e.g., (-2x)^{3/5} should become -(2x)^{3/5} for correct real evaluation
      else if (
        isFunction(x, 'Power') &&
        x.op2?.isRational === true &&
        !x.op2.isInteger
      )
        simplifiedOps.push(full(x, i));
      // Evaluate purely numeric subexpressions in all operands
      else simplifiedOps.push(evaluateNumericSubexpressions(x));
    }
    return build(simplifiedOps);
  }

  // For non-lazy, non-scoped functions (e.g., Factorial2, Sqrt, Degrees),
  // recursively simplify operands. This ensures expressions like Factorial2(-1 + 2*3)
  // become Factorial2(5) and Degrees(tan(90-0.000001)) becomes Degrees(tan(89.999999)).
  //
  // EXCEPTION: For Divide expressions, only evaluate purely numeric subexpressions
  // but don't do full recursive simplification. This preserves factored polynomial
  // structure for the cancelCommonFactors rule.
  // e.g., (x-1)(x+2)/((x-1)(x+3)) should cancel to (x+2)/(x+3), not expand first.
  // But x^(1+2)/(1+2) should still simplify to x^3/3.
  if (expr.operator === 'Divide') {
    // Numeric folding only — no operand sub-chain, so nothing to capture.
    const simplifiedOps = ops.map((x) =>
      evaluateNumericSubexpressions(x)
    );
    const changed = simplifiedOps.some((op, i) => op !== ops[i]);
    if (!changed) return expr;
    return expr.engine._fn(expr.operator, simplifiedOps);
  }

  // Use _fn() since operands are already canonical (simplified above)
  const build = (o: Expression[]) => expr.engine._fn(expr.operator, o);
  const simplifiedOps: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const x = ops[i];
    // For purely numeric basic arithmetic expressions, evaluate directly
    // to get simpler results like √(1+2) → √3
    // BUT skip Power expressions that should stay symbolic:
    // - e^n and n^{p/q} with non-integer exponent
    if (
      !isNumber(x) &&
      isFunction(x) &&
      x.unknowns.length === 0 &&
      !hasAssignedVariable(x) &&
      BASIC_ARITHMETIC.includes(x.operator)
    ) {
      // Don't evaluate Power expressions that produce irrational results
      const symbolicPower =
        x.operator === 'Power' &&
        (isSymbol(x.op1, 'ExponentialE') ||
          (x.op2?.isRational === true && x.op2?.isInteger === false));
      if (symbolicPower) {
        simplifiedOps.push(x);
        continue;
      }
      const evaluated = x.evaluate();
      if (isNumber(evaluated)) {
        simplifiedOps.push(evaluated);
        continue;
      }
    }
    // For other expressions with ops (like Tan, Sqrt, etc.), recursively simplify
    if (isFunction(x))
      simplifiedOps.push(
        simplifyOperandCapture(
          x,
          i,
          ops,
          simplifiedOps,
          options,
          substepsOut,
          build
        )
      );
    else simplifiedOps.push(x);
  }
  return build(simplifiedOps);
}

function simplifyExpression(
  expr: Expression,
  rules: BoxedRuleSet,
  options: Partial<InternalSimplifyOptions>,
  steps: RuleSteps
): RuleSteps {
  // Respect the engine deadline (`ce.timeLimit`): simplifyExpression is the
  // per-node choke point of the simplification recursion, and each call does
  // a full rule scan, so an unstrided check is cheap relative to the work.
  checkDeadline(expr.engine._deadlineFrame);

  //
  // 1/ If a number or a string, no simplification to do
  //
  if (isNumber(expr) || isString(expr)) return steps;

  //
  // 2/ Simplify a symbol
  //
  if (isSymbol(expr)) {
    const result = replace(expr, rules, {
      recursive: false,
      form: 'canonical',
      useVariations: false,
    });
    if (result.length > 0) return [...steps, ...result];
    return steps;
  }

  //
  // Ellipsis fold barrier: an `Add`/`Multiply` (or any operator) with a direct
  // `ContinuationPlaceholder` operand is a notational object. Leave it and its
  // operand structure unchanged rather than folding across the elided terms.
  //
  if (isFunction(expr) && expr.ops.some((x) => isContinuationOperand(x)))
    return steps;

  //
  // 3/ Simplify a function expression
  //

  // Simplify the operands...
  // When `expr.explain()` asks for it, collect the operand-level sub-chain so
  // the aggregate `'simplified operands'` step can surface the real rule work
  // it summarizes. `substeps` stays undefined (no allocation) otherwise, and
  // is inert enrichment — the chain length, ordering, and driver logic
  // (`hasSeen`, length comparisons, cycle checks) are unaffected.
  const substeps: RuleSteps | undefined = options.collectSubsteps
    ? []
    : undefined;
  const alt = simplifyOperands(expr, options, substeps);
  if (!alt.isSame(expr)) {
    const aggregate: RuleStep =
      substeps && substeps.length > 0
        ? { value: alt, because: 'simplified operands', substeps }
        : { value: alt, because: 'simplified operands' };
    steps = [...steps, aggregate];
    expr = alt;
  }

  // A structural head (`Determinant`, `Trace`, …) has no rule of its own: run
  // its `evaluate` handler so `simplify()` does not hand back the input.
  const evaluated = evaluateStructuralHead(expr);
  if (evaluated !== undefined) {
    steps = [...steps, { value: evaluated, because: 'evaluated operator' }];
    expr = evaluated;
  }

  // Try to simplify the function expression
  const result = simplifyNonCommutativeFunction(expr, rules, options, steps);
  if (result.length > steps.length) return result;

  // NOTE: Trying permutations of operands for commutative functions is
  // NOT needed:
  //
  // 1. Pattern-based rules already try permutations via `matchPermutations:
  //    true` (default) which permutes the *pattern* operands to find matches.
  //
  // 2. Most simplification rules (90%+) are functional, not pattern-based.
  //    Functional rules have direct access to operands and can check any
  //    ordering they need.
  //
  // 3. Canonicalization sorts commutative operators during boxing, providing
  //    consistent ordering that most rules rely on.
  //
  // 4. The performance cost would be factorial: 6× for 3 operands, 24× for
  //    4 operands, 720× for 6 operands - far exceeding any benefit.
  //
  // 5. Rules that truly need custom permutation logic
  //    (like factorPerfectSquare) implement it internally with controlled
  //    complexity.

  return steps;
}

function simplifyNonCommutativeFunction(
  expr: Expression,
  rules: BoxedRuleSet,
  options: Partial<InternalSimplifyOptions>,
  steps: RuleSteps
): RuleSteps {
  const result = replace(expr, rules, {
    recursive: false,
    form: 'canonical',
    useVariations: options.useVariations ?? false,
  });

  if (result.length === 0) return steps;

  // Two rules could be conflicting, for example: `ln(xy) = ln(x) + ln(y)`
  // and `ln(x) + ln(y) = ln(xy)`, resulting in a loop. In this case,
  // we bail out.

  let last = result.at(-1)!.value;
  if (last.isSame(expr)) return steps;

  // Post-rule operand cleanup: NOT captured as substeps — it stays absorbed
  // into the rule step (as today), so `explain()` attributes it to the rule.
  last = simplifyOperands(last, options);

  // If the simplified expression is not cheaper, we're done.
  //
  // Exception 1: rules that are mathematically preferred even when structurally
  // larger (power combination `-4·2^x → -2^(x+2)`, log rewrites `ln(x^n) →
  // n·ln(x)`, odd-root sign extraction, Abs identities `|xy| → |x||y|`,
  // quotient-power distribution, factorial factoring). Each such rule now tags
  // its step with `purpose: 'transform'` at the source (simplify-log.ts,
  // simplify-abs.ts, simplify-power.ts, simplify-factorial.ts,
  // simplify-rules.ts) instead of the cost gate string-matching on the fragile
  // `because` label. `isTransformPurpose` below is the single check that
  // replaces those per-label predicates.
  const because = result.at(-1)!.because;
  // Expand may produce more nodes but enables term cancellation
  // Accept when expansion reduces terms or eliminates Power-of-Add patterns
  const isExpandWithSimplification =
    because === 'expand' &&
    (() => {
      if (!isFunction(last) || !isFunction(expr)) return false;
      // Fewer terms means cancellation happened
      if (
        expr.operator === 'Add' &&
        last.operator === 'Add' &&
        last.nops < expr.nops
      )
        return true;
      // Expansion eliminated Power(Add(...), n) patterns — the result is flatter
      if (
        expr.operator === 'Add' &&
        last.operator === 'Add' &&
        last.nops <= expr.nops
      ) {
        // Check if original had Power-of-Add that was expanded away
        const hasPowerOfAdd = (e: Expression): boolean => {
          if (isFunction(e, 'Power') && e.op1?.operator === 'Add') return true;
          if (isFunction(e)) return e.ops.some(hasPowerOfAdd);
          return false;
        };
        return hasPowerOfAdd(expr) && !hasPowerOfAdd(last);
      }
      return false;
    })();
  // Steps from rules tagged `purpose: 'transform'` are mathematically
  // preferred rewrites: they are exempt from the cost gate.
  const isTransformPurpose = result.at(-1)!.purpose === 'transform';
  if (
    !isCheaper(expr, last, options?.costFunction) &&
    !isExpandWithSimplification &&
    !isTransformPurpose
  )
    return steps;

  result.at(-1)!.value = last;
  return [...steps, ...result];
}
