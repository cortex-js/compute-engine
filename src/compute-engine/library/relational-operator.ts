import type {
  Expression,
  OperatorDefinition,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isRelationalOperator } from '../latex-syntax/utils.js';
import {
  isCollectionShaped,
  isFiniteBroadcastParticipant,
  isBroadcastableCollection,
  hasUnresolvedCollectionOperand,
  broadcastLengthMismatch,
  isTextAtom,
  isPossiblyCollectionTyped,
  isValuelessCollectionTyped,
} from '../collection-utils.js';
import { flatten } from '../boxed-expression/flatten.js';
import { eq, eqIdentical } from '../boxed-expression/compare.js';
import {
  isNumber,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  typeContainsMissing,
  numericMissingSlot,
} from '../../common/type/utils.js';
import type { Type } from '../../common/type/types.js';
import { parseType } from '../../common/type/parse.js';
import { toBigint } from '../boxed-expression/numerics.js';
import { reduceModulo } from '../boxed-expression/modular-arithmetic.js';
import {
  subjectOf,
  finiteNumericValue,
  hasAssumptions,
  decideComparisonFromBounds,
  signFromChains,
} from '../boxed-expression/constraint-subject.js';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds.js';
import { isQuantity } from './quantity-arithmetic.js';
import { boxedToUnitExpression } from './units.js';
import {
  dimensionsEqual,
  getExpressionDimension,
  getExpressionScale,
} from './unit-data.js';

/**
 * Compare two Quantity expressions.
 * Returns negative if a < b, 0 if equal, positive if a > b,
 * or null if incompatible or not both quantities.
 */
function quantityCompare(a: Expression, b: Expression): number | null {
  if (!isQuantity(a) || !isQuantity(b)) return null;

  const aMag = a.op1.re;
  const bMag = b.op1.re;
  if (aMag === undefined || bMag === undefined) return null;

  const aUE = boxedToUnitExpression(a.op2);
  const bUE = boxedToUnitExpression(b.op2);
  if (!aUE || !bUE) return null;

  // Check compatible dimensions
  const aDim = getExpressionDimension(aUE);
  const bDim = getExpressionDimension(bUE);
  if (!aDim || !bDim || !dimensionsEqual(aDim, bDim)) return null;

  // Convert both to SI
  const aScale = getExpressionScale(aUE);
  const bScale = getExpressionScale(bUE);
  if (aScale === null || bScale === null) return null;

  return aMag * aScale - bMag * bScale;
}

/**
 * Decide `lhs < rhs` (when `strict`) or `lhs ≤ rhs` from assumed bounds on
 * a constraint subject (docs/fungrim/FUNGRIM-PLAN-3-ASSUMPTIONS.md §5.1a).
 *
 * Applies when one side normalizes to a subject term — a bare symbol or
 * `Real/Imaginary/Abs/Argument` of one — and the other side is numeric.
 * The bounds are read directly from the fact index (never via `ask()`), so
 * this also works inside `verify()` where `_isVerifying` suppresses the
 * `ask()` fallbacks.
 *
 * Strict three-valued semantics: `true` only when entailed, `false` only
 * when refuted, `undefined` (stay unevaluated) otherwise.
 */
function compareFromAssumedBounds(
  lhs: Expression,
  rhs: Expression,
  strict: boolean
): boolean | undefined {
  const ce = lhs.engine;
  // Fast gate: engines with no assumptions do no subject or index work.
  if (!hasAssumptions(ce)) return undefined;

  // subject < k / subject ≤ k
  let subject = subjectOf(lhs);
  if (subject !== undefined) {
    const k = finiteNumericValue(rhs);
    if (k !== undefined)
      return decideComparisonFromBounds(
        getInequalityBoundsFromAssumptions(ce, subject),
        k,
        strict ? 'less' : 'lessEqual'
      );
  }

  // k < subject / k ≤ subject ⇔ subject > k / subject ≥ k
  subject = subjectOf(rhs);
  if (subject !== undefined) {
    const k = finiteNumericValue(lhs);
    if (k !== undefined)
      return decideComparisonFromBounds(
        getInequalityBoundsFromAssumptions(ce, subject),
        k,
        strict ? 'greater' : 'greaterEqual'
      );
  }

  // Symbol/expression comparison via assumed inequality chains and the sign of
  // the difference `rhs - lhs` (transitive ≥-closure, and even-power
  // monotonicity such as x > y > 0 ⇒ 2x² > 2y²).
  // `s` is the sign of `diff = rhs - lhs`.
  const s = signFromChains(ce, rhs.sub(lhs));
  if (strict) {
    // lhs < rhs  ⇔  diff > 0
    if (s === 'positive') return true;
    if (s === 'negative' || s === 'zero' || s === 'non-positive') return false;
  } else {
    // lhs ≤ rhs  ⇔  diff ≥ 0
    if (s === 'positive' || s === 'zero' || s === 'non-negative') return true;
    if (s === 'negative') return false;
  }

  return undefined;
}

//   // eq, lt, leq, gt, geq, neq, approx
//   //     shortLogicalImplies: 52, // ➔
//   // shortImplies => 51
//   // implies ==> 49
//   //    impliedBy: 45, // <==
//   // less-than-or-equal-to: Q55935272 241
//   // greater-than-or-equal: Q55935291 242
//   // greater-than: Q47035128  243
//   // less-than: Q52834024 245

/**
 * Evaluate the operands of a relational CHAIN (`a < b < c`, `a = b = c`, …)
 * left to right, stopping at the first adjacent pair that is decidably
 * `False`. A chain is the conjunction of its adjacent pairs, and — like `And`
 * (`library/logic.ts`, `evaluateShortCircuit`) — a conjunction is a
 * short-circuit form: once `a < b` is `False`, `c` is never evaluated (no
 * side effect, no error, no random draw), and the result is `False` whatever
 * the later pairs would have said — including a later `Missing` or an
 * undecided pair (Kleene: `False ∧ x = False`). An operand that evaluates to
 * an error is as final as a `False` pair: it is returned as-is and the
 * operands after it do not run.
 *
 * Returns `False` (or the error) when the walk decided the chain, and
 * otherwise the evaluated operands, in order, for the caller's ordinary
 * (all-operands) code path — each operand evaluated exactly once. Each
 * adjacent pair is decided by `pairIsFalse`, which the caller builds from the
 * SAME cheap primitives its own pairwise loop uses (`quantityCompare`,
 * `isLess`/`isLessEqual`/`isEqual`/`eq`, `compareFromAssumedBounds`) — not by
 * re-dispatching the operator, which would pay canonicalization and a full
 * handler re-entry per pair. Anything but a definite `False` (`True`, an
 * absent or undecided pair) lets the walk continue; the caller's loop then
 * settles absence (`Missing`/`NaN`), inertness and the final verdict on the
 * values, so a holding chain pays the cheap comparisons twice and nothing
 * more.
 *
 * Not applied when the chain is binary (nothing to short-circuit) or when
 * some operand is collection-shaped by type (`isCollectionShaped`): the
 * comparison is then element-wise, every operand is evaluated once and the
 * result is a list — the same exception the connectives make.
 */
function evaluateChainOperands(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined,
  pairIsFalse: (lhs: Expression, rhs: Expression) => boolean
): Expression[] | Expression {
  const evalOptions = { numericApproximation };
  if (rawOps.length <= 2 || rawOps.some(isCollectionShaped))
    return rawOps.map((op) => op.evaluate(evalOptions));
  const ops: Expression[] = [];
  for (const raw of rawOps) {
    const v = raw.evaluate(evalOptions);
    if (!v.isValid) return v;
    if (ops.length > 0 && pairIsFalse(ops[ops.length - 1], v)) return ce.False;
    ops.push(v);
  }
  return ops;
}

/** The adjacent-pair deciders of `evaluateChainOperands`, one per chainable
 * relation — each the `False` branch of the corresponding handler's own
 * pairwise loop. */
const CHAIN_PAIR_IS_FALSE = {
  Equal: (ce: ComputeEngine) => (a: Expression, b: Expression) => {
    const q = quantityCompare(a, b);
    if (q !== null) return Math.abs(q) > ce.tolerance;
    return eq(a, b) === false;
  },
  NotEqual: (_ce: ComputeEngine) => (a: Expression, b: Expression) =>
    a.isEqual(b) === true,
  Less: (_ce: ComputeEngine) => (a: Expression, b: Expression) => {
    const q = quantityCompare(a, b);
    if (q !== null) return q >= 0;
    return (a.isLess(b) ?? compareFromAssumedBounds(a, b, true)) === false;
  },
  LessEqual: (_ce: ComputeEngine) => (a: Expression, b: Expression) => {
    const q = quantityCompare(a, b);
    if (q !== null) return q > 0;
    return (
      (a.isLessEqual(b) ?? compareFromAssumedBounds(a, b, false)) === false
    );
  },
};

/**
 * Keep an undecidable comparison inert — but over the *evaluated* operands
 * rather than the raw ones.
 *
 * `Equal`/`NotEqual`/`Less`/`LessEqual` are `lazy` (their `canonical` handlers
 * need raw, direction-intact operands for chain decomposition), so each
 * evaluates its operands itself at the top of the handler. Returning
 * `undefined` from there means "unchanged", which makes the framework keep the
 * ORIGINAL expression and throw that operand evaluation away: `d/dx x^2 > 0`
 * reported `0 < D(x^2, x)` rather than `0 < 2x`. The non-lazy relations
 * (`Approx`, `Tilde`, `Precedes`…) never had the problem, because for them the
 * framework substitutes the evaluated operands on an `undefined` return — this
 * brings the four lazy ones in line.
 *
 * The comparison itself still stays inert when undecidable (`x^2 = 4` is a
 * *condition*, not a falsity — see the `Equal` handler): only the operands
 * change. `undefined` is returned when evaluation changed nothing, which keeps
 * this a fixpoint and avoids allocating on the hot rule-guard path.
 */
function inertRelation(
  ce: ComputeEngine,
  op: string,
  rawOps: ReadonlyArray<Expression>,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length !== rawOps.length) return undefined;
  if (ops.every((x, i) => x.isSame(rawOps[i]))) return undefined;
  return ce._fn(op, ops);
}

export const RELOP_LIBRARY: SymbolDefinitions = {
  Congruent: {
    description: 'Indicate that two expressions are congruent modulo a number',
    keywords: ['congruence'],
    complexity: 11000,
    // `modulo` is `number` (not `integer`) so a symbolic modulus expression
    // such as `p^{k+1}` (statically typed `finite_number`, not `integer`) is
    // accepted and the congruence stays symbolic instead of erroring. The
    // `evaluate` handler only reduces when all three operands are concrete
    // integers (`toBigint`), so a non-integer modulus simply stays unevaluated.
    signature: '(number, number, modulo: number) -> boolean',
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 3) return undefined;
      const [lhs, rhs, modulo] = ops;
      // Congruence is integer arithmetic. Use bigint so it works under the
      // bignum-preferred default precision (where `.value` is not a JS
      // number), and reduce with a floored modulo so negatives are handled
      // correctly (JS `%` is a remainder: `-1 % 7 === -1`, not `6`).
      // A symbolic (non-integer) modulus stays unevaluated.
      const m = toBigint(modulo);
      if (m === null || m === 0n) return undefined;
      const mAbs = m < 0n ? -m : m;
      // Reduce each side to its canonical residue in [0, mAbs). `toBigint`
      // handles concrete integer literals directly; when it declines (e.g.
      // `2^(3^20)`, whose value can't be materialized), fall back to the
      // modular walker, which reduces in ℤ/mℤ without forming the integer.
      const reduce = (x: Expression): bigint | null => {
        const v = toBigint(x);
        if (v !== null) return ((v % mAbs) + mAbs) % mAbs;
        return reduceModulo(x, mAbs);
      };
      const a = reduce(lhs);
      const b = reduce(rhs);
      if (a === null || b === null) return undefined;
      return a === b ? ce.True : ce.False;
    },
  },

  IsSame: {
    description: 'Compare two expressions for structural equality',
    lazy: true,
    signature: '(any, any) -> boolean',

    // Since we want to work on non-canonical expressions,
    // do nothing to canonicalize the arguments (the lazy flag will prevent
    // canonicalization of the arguments)
    evaluate: (ops, { engine: ce }) => {
      if (ops.length !== 2) return undefined;
      const [lhs, rhs] = ops;
      return lhs.isSame(rhs) ? ce.True : ce.False;
    },
  },

  Equal: {
    description: 'Equality comparison (equal to).',
    complexity: 11000,
    signature: '(any, any) -> boolean',

    lazy: true,

    // Comparisons follow IEEE 754 for `NaN` and Kleene for the `Missing` symbol
    // (the Julia model, §3.D amended 2026-07-24). A `Missing` operand makes the
    // comparison `Missing` (Kleene); a `NaN` operand makes it `False` (IEEE:
    // `NaN == NaN` is `false`). Declared `handle` so a `Missing` operand
    // validates (its `missing` arm is stripped against the `any` parameter,
    // which already admits it, but the handle declaration keeps the gate off the
    // propagate path). Result type: `missing` when an operand is definitely
    // absent, `boolean | missing` when only possibly (an operand's type carries
    // the arm), `boolean` otherwise.
    missingBehavior: 'handle',

    type: (ops) => comparisonResultType(ops),

    // Broadcast element-wise over a list operand (Desmos `L[d=4]` filtering).
    // Restricted to the list-vs-scalar case: `skipBroadcastForVectorOps` skips
    // broadcasting when two-or-more operands are collections, so whole-list
    // equality `Equal(L, M)` stays a scalar boolean. See
    // docs/COLLECTIONS-MODEL.md.
    broadcastable: true,

    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Equal', args),

    // Comparing two equalities...
    // Two equations are equivalent if they have the same solution set.
    // For polynomial equations, this means the LHS-RHS expressions differ
    // only by a non-zero constant factor.
    eq: (a, b, prover) => {
      // Relation equivalence (same solution set) is an *identity* question in
      // the free variables of the operands: prover tier only, per the ratified
      // audit (docs/LANGUAGE-MODEL.md). The cheap
      // arithmetic tier (`eq()` / `.isEqual()`) declines. `cmp()` passes no
      // flag, so its behavior is unchanged.
      if (prover === false) return undefined;
      if (a.operator !== b.operator) return undefined;
      if (!isFunction(a) || !isFunction(b)) return undefined;

      const ce = a.engine;

      // Get LHS - RHS for each equation
      const expr1 = a.op1.sub(a.op2);
      const expr2 = b.op1.sub(b.op2);

      // Handle special cases where expressions are zero (identity equations)
      const s1 = expr1.simplify();
      const s2 = expr2.simplify();
      const expr1Zero = s1.isSame(0) || (isNumber(s1) && s1.re === 0);
      const expr2Zero = s2.isSame(0) || (isNumber(s2) && s2.re === 0);

      // If both are identities (0 = 0), they're equivalent
      if (expr1Zero && expr2Zero) return true;

      // If only one is an identity, they're not equivalent
      if (expr1Zero || expr2Zero) return false;

      // Get unknowns from both expressions
      const unknowns = [...new Set([...expr1.unknowns, ...expr2.unknowns])];

      // If no unknowns, compare directly
      if (unknowns.length === 0) {
        const v1 = expr1.N().re;
        const v2 = expr2.N().re;
        if (!Number.isFinite(v1) || !Number.isFinite(v2)) return undefined;
        if (Math.abs(v2) < ce.tolerance) return false;
        // Both are constants - they differ by a constant factor if both are non-zero
        return (
          Math.abs(v1) > ce.tolerance &&
          Math.abs(v2) > ce.tolerance &&
          Number.isFinite(v1 / v2)
        );
      }

      // Sample-based check: if expr1/expr2 evaluates to the same constant
      // for multiple values of unknowns, they're likely equivalent
      const testValues = [0.5, 1.5, 2, -1, 3, -0.5, 0.7, 2.3];
      let constantRatio: number | undefined = undefined;
      const tolerance = ce.tolerance;

      for (let t = 0; t < testValues.length; t++) {
        // Assign an INDEPENDENT value to each unknown. Previously every
        // unknown was given the same value, so e.g. `x + y` and `2x` both
        // collapsed to `2·v` and compared equal. Rotating the sample pool by
        // the unknown's index (plus an index offset) keeps the unknowns
        // distinct within a trial and varies the assignment across trials.
        const sub: Record<string, number> = {};
        unknowns.forEach((u, j) => {
          sub[u] = testValues[(t + j * 3) % testValues.length] + j;
        });

        const v1 = expr1.subs(sub).N();
        const v2 = expr2.subs(sub).N();

        const n1 = v1.re;
        const n2 = v2.re;

        if (!Number.isFinite(n1) || !Number.isFinite(n2)) continue;
        if (Math.abs(n2) < tolerance) continue; // Skip if denominator is zero

        const r = n1 / n2;
        if (!Number.isFinite(r)) continue;

        if (constantRatio === undefined) {
          constantRatio = r;
        } else if (Math.abs(r - constantRatio) > tolerance) {
          // Ratio is not constant - equations are not equivalent
          return false;
        }
      }

      // If we found a constant ratio (non-zero), equations are equivalent
      if (constantRatio !== undefined && Math.abs(constantRatio) > tolerance) {
        return true;
      }

      return undefined;
    },

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      if (rawOps.length < 2) return ce.True;
      // This operator is `lazy` (so its `canonical` handler sees raw,
      // direction-intact operands for chain decomposition). `lazy` also skips
      // evaluating the arguments before this handler runs, so evaluate them
      // here — otherwise a compound operand like `R^2` (with `R = [1,2,3]`)
      // never folds to the list `[1,4,9]`. A chain (`a = b = c`) stops at
      // the first adjacent pair that is `False` (`evaluateChainOperands`).
      const chain = evaluateChainOperands(
        ce,
        rawOps,
        numericApproximation,
        CHAIN_PAIR_IS_FALSE.Equal(ce)
      );
      if (!Array.isArray(chain)) return chain;
      const ops = chain;
      // Element-wise broadcast when an operand evaluated to a collection, so a
      // named list behaves like a literal one: `x^2+y^2 = R^2` broadcasts to a
      // list of `Equal`s, matching the inequality operators (which already
      // broadcast via the same helper) and Desmos semantics (Tycho report).
      // Restricted to the list-vs-scalar case: when two or more operands are
      // collections, whole-list equality stays a scalar boolean — broadcasting
      // there would also recurse forever, since re-dispatching `Equal` on the
      // same two collections re-enters this handler (`skipBroadcastForVectorOps`
      // enforces the same rule for the engine-level broadcast).
      if (broadcastableComparisonOperands(ops)) {
        const bc = broadcastComparison(ce, 'Equal', ops, numericApproximation);
        if (bc) return bc;
      }
      if (undecidedCollectionComparison(ops))
        return inertRelation(ce, 'Equal', rawOps, ops);
      // Absence semantics (§3.D, amended 2026-07-24): once broadcast has had
      // its chance (so a list-vs-scalar operand comparison is per-cell), a
      // SCALAR `Missing` operand makes the comparison `Missing` (Kleene), while
      // a `NaN` operand makes it `False` (IEEE: `NaN == NaN` is `false`).
      // `Missing` wins over `NaN` (Kleene propagation). Per-cell broadcast
      // re-enters this handler on scalar cells, so the rule applies
      // element-wise too. A `Missing` read from a numeric-domain slot
      // (`number | missing`) is `NaN`, not Kleene (`readComparisonAbsence`).
      const vals = readComparisonAbsence(ce, rawOps, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
      let lhs: Expression | undefined = undefined;
      for (const arg of ops) {
        if (!lhs) lhs = arg;
        else {
          // Try quantity comparison first
          const qcmp = quantityCompare(lhs, arg);
          if (qcmp !== null) {
            if (Math.abs(qcmp) > ce.tolerance) return ce.False;
            lhs = arg;
            continue;
          }

          const test = eq(lhs, arg);
          if (test === false) return ce.False;

          // An undecidable comparison (free variables present, no proof
          // either way) stays INERT: `x^2 = 4` is a *condition*, not a
          // falsity — it evaluates to itself, like the inequality operators
          // (`x^2 < 4` already stays symbolic) and like Mathematica's `==`.
          // Decidable comparisons are unchanged (`2+2=4` → True,
          // `x = x+1` → False when provable). This replaced the earlier
          // pragmatic collapse-to-False, which silently ruined equations
          // that were later piped into `Solve` (Tycho 0.72.0 report,
          // item 8). Three-valued verification mode (`ce.isVerifying`)
          // behaves identically. `inertRelation` keeps the *evaluated*
          // operands (`x^2 = 2+2` → `x^2 = 4`).
          if (test === undefined)
            return inertRelation(ce, 'Equal', rawOps, ops);
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  IdenticallyEqual: {
    description: [
      'Identity comparison (`\\equiv`).',
      'True iff the operands are equal for every value of their free variables.',
    ],
    complexity: 11000,

    signature: '(any, any) -> boolean',

    // `lazy` for the same reason as `Equal`: the `canonical` handler needs the
    // raw, direction-intact operands to decompose a chain (`a ≡ b ≡ c`).
    lazy: true,

    // Same absence semantics as `Equal` (§3.D): a `Missing` operand makes the
    // comparison `Missing` (Kleene), a `NaN` operand makes it `False` (IEEE).
    missingBehavior: 'handle',

    type: (ops) => relationalAbsenceType(ops),

    // Deliberately NOT `broadcastable`: this is a PROVER (is this an identity
    // in all the free variables?), not an arithmetic comparison, so a list
    // operand is compared as a whole rather than zipped element-wise.

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'IdenticallyEqual', args),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      if (rawOps.length < 2) return ce.True;
      // `lazy` skips evaluating the arguments before this handler runs, so
      // evaluate them here (see the `Equal` handler).
      const ops = rawOps.map((op) => op.evaluate({ numericApproximation }));
      const vals = readComparisonAbsence(ce, rawOps, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
      let lhs: Expression | undefined = undefined;
      for (const arg of ops) {
        if (!lhs) lhs = arg;
        else {
          // Dimensioned quantities compare by their SI magnitude, like
          // `Equal` (`5 m ≡ 500 cm`).
          const qcmp = quantityCompare(lhs, arg);
          if (qcmp !== null) {
            if (Math.abs(qcmp) > ce.tolerance) return ce.False;
            lhs = arg;
            continue;
          }

          const test = eqIdentical(lhs, arg);
          if (test === false) return ce.False;
          // Undecidable stays INERT, like `Equal`: `x ≡ y` is a *claim*, not a
          // falsity. Note the prover degrades a sampled disagreement to
          // `undefined` (D9), so a non-identity such as `x ≡ x+1` also stays
          // inert rather than collapsing to `False`.
          if (test === undefined)
            return inertRelation(ce, 'IdenticallyEqual', rawOps, ops);
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  Same: {
    description: [
      'Structural identity comparison (Epsil `===`).',
      'True iff every adjacent pair of operands is structurally identical.',
    ],
    complexity: 11000,

    // Variadic (the Epsil parser emits a chained `a === b === c` as a single
    // n-ary `Same`). Documentary only: like the other `lazy` relations
    // (`Equal`, whose fixed `(any, any)` signature only works for the same
    // reason), argument validation is skipped.
    signature: '(any, any+) -> boolean',

    // `lazy`, so the operands are CANONICALIZED but never evaluated: `Same` is
    // strictly SYNTACTIC equality of the canonical forms. Canonicalization
    // still folds exact arithmetic (`Same(1+1, 2)` is `True`) and binds
    // structure, but it does NOT dereference a symbol's value — so `Same` never
    // depends on the current bindings, unlike `Equal`. `IsSame` remains the
    // fully raw counterpart (no canonicalization at all).
    //
    // A `lazy` operator with no `canonical` handler is inert on the box/parse
    // routes (its held operands arrive UNBOUND), hence the handler below; the
    // `evaluate` handler canonicalizes defensively too, since it consumes held
    // operands.
    lazy: true,

    canonical: (args, { engine: ce }) =>
      ce._fn(
        'Same',
        args.map((x) => x.canonical)
      ),

    //
    // Deliberately NOT `broadcastable`: `Same` is a structural predicate, so a
    // list operand is compared as a whole (`[1,2] === [1,2]` is the scalar
    // `True`, not a list of booleans). This is the point of the operator —
    // `Equal` is the broadcasting, tolerant, possibly-inert comparison.
    //
    // `handle` (rather than the default absence propagation) because `Same` is
    // TOTAL: it always decides. A `Missing` operand is just another structure
    // to compare — `Missing === Missing` is `True`, `Missing === 1` is `False`
    // — never a Kleene `Missing` result.
    missingBehavior: 'handle',

    // Total structural complement of `Equal`: where `Equal` may stay inert
    // (`x = y` is a *condition*) and compares numerically within tolerance
    // (`sqrt(2) = 1.4142135623730951` is `True`), `Same` always answers, uses
    // no tolerance, and never evaluates a radical to a float
    // (`sqrt(2) === 1.4142135623730951` is `False`). Same philosophy as the
    // structural totality of `match`.
    evaluate: (rawOps, { engine: ce }) => {
      if (rawOps.length < 2) return ce.True;
      const ops = rawOps.map((op) => op.canonical);
      for (let i = 1; i < ops.length; i++)
        if (!ops[i - 1].isSame(ops[i])) return ce.False;
      return ce.True;
    },
  },

  NotEqual: {
    description: 'Inequality comparison (not equal to).',
    wikidata: 'Q28113351',
    complexity: 11000,

    signature: '(any, any) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence
    // with `Equal`, amended 2026-07-24): `NotEqual(Missing, x) = Missing`;
    // `NotEqual(NaN, x) = True` (IEEE: `NaN != x` is `true`, incl. `NaN != NaN`).
    // Declared `handle` so a `Missing` operand validates and the propagate gate
    // stays off.
    missingBehavior: 'handle',

    type: comparisonResultType,

    // Broadcast element-wise over a list operand (list-vs-scalar only; see
    // `Equal` above and `skipBroadcastForVectorOps`).
    broadcastable: true,

    // `lazy` so the `canonical` handler receives raw, direction-intact operands
    // for chain decomposition (see `canonicalComparisonChain`); a chained
    // `a ≠ b ≠ c` becomes `And(a ≠ b, b ≠ c)`.
    lazy: true,

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'NotEqual', args),

    // Comparing two equalities...
    eq: (a, b, prover) => {
      // Relation equivalence is an identity question in the free variables:
      // prover tier only (see `Equal`'s handler).
      if (prover === false) return undefined;
      if (a.operator !== b.operator) return undefined;
      if (!isFunction(a) || !isFunction(b)) return undefined;
      // Equality is commutative.
      // Comparing two relations asks whether they express the same condition:
      // an identity question in their free variables, hence the prover tier
      // (`isIdenticallyEqual`) rather than arithmetic `isEqual()`.
      if (
        (a.op1.isIdenticallyEqual(b.op1) === true &&
          a.op2.isIdenticallyEqual(b.op2) === true) ||
        (a.op1.isIdenticallyEqual(b.op2) === true &&
          a.op2.isIdenticallyEqual(b.op1) === true)
      )
        return true;
      // Three-valued: pairwise NON-identity does not prove the two relations
      // are non-equivalent (`x ≠ 1` and `x+1 ≠ 2` have the same solution set
      // with pairwise-different operands), and neither does a different
      // operator. Decline rather than assert a definitive `false`.
      return undefined;
    },

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // `lazy` skips argument evaluation before this handler runs (see the
      // `Less` handler): evaluate the operands here so compound operands fold.
      // A chain stops at the first adjacent pair that is `False`
      // (`evaluateChainOperands`).
      const chain = evaluateChainOperands(
        ce,
        rawOps,
        numericApproximation,
        CHAIN_PAIR_IS_FALSE.NotEqual(ce)
      );
      if (!Array.isArray(chain)) return chain;
      const ops = chain;
      if (ops.length < 2) return ce.False;
      // Broadcast over a list operand that only appeared after evaluation (e.g.
      // `R^2` with `R = [1,2,3]`), matching `Equal` and the literal-list form;
      // list-vs-scalar only (see `Equal`'s handler for why 2+ collections stay
      // a scalar boolean and would otherwise recurse).
      if (broadcastableComparisonOperands(ops)) {
        const bc = broadcastComparison(
          ce,
          'NotEqual',
          ops,
          numericApproximation
        );
        if (bc) return bc;
      }
      if (undecidedCollectionComparison(ops))
        return inertRelation(ce, 'NotEqual', rawOps, ops);
      // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`
      // (`NotEqual(Missing, x) = Missing`), IEEE over `NaN` (`NotEqual(NaN, x)
      // = True`). `Missing` wins over `NaN`; a numeric-domain slot's `Missing`
      // reads as `NaN` (`readComparisonAbsence`).
      const vals = readComparisonAbsence(ce, rawOps, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.True;
      let lhs: Expression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const test = lhs.isEqual(arg);
          if (test === true) return ce.False;

          // An undecidable comparison stays INERT (three-valued logic in
          // every mode, matching `Equal` and the inequality operators) —
          // but first try to *prove* the two sides distinct from assumed
          // bounds. A proven strict inequality in either direction entails
          // ≠ (e.g. `assume(z > 0)` ⇒ `z ≠ 0`), so rule guards like
          // `; z ≠ 0` fire under such assumptions. If distinctness is not
          // provable, stay symbolic: `x ≠ 4` is a condition, not a truth.
          // (This replaced the earlier pragmatic collapse-to-True in normal
          // evaluation mode — Tycho 0.72.0 report, item 8.)
          if (test === undefined) {
            const distinct =
              compareFromAssumedBounds(lhs, arg, true) === true ||
              compareFromAssumedBounds(arg, lhs, true) === true;
            if (!distinct) return inertRelation(ce, 'NotEqual', rawOps, ops);
          }
          // Continue the loop - if all comparisons are not equal, return True
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  Less: {
    description: 'Less-than comparison (strictly less than).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence,
    // amended 2026-07-24): a `Missing` operand makes the ordering `Missing`; a
    // `NaN` operand makes it `False` (IEEE: `NaN` is unordered). `Greater`/
    // `GreaterEqual` canonicalize to `Less`/`LessEqual`, so this handler (and
    // `LessEqual`'s) covers all four orderings. Declared `handle` so a `Missing`
    // operand validates and the propagate gate stays off.
    missingBehavior: 'handle',

    type: relationalAbsenceType,

    lazy: true,
    // Broadcast element-wise over a list operand so `L > 0` (canonicalizes to
    // `Less(0, L)`) yields a `list<boolean>` mask for Desmos `L[L>0]` filtering.
    broadcastable: true,
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Less', ops),

    eq: (a, b, prover) => inequalityEq(a, b, 'Greater', prover),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // This operator is `lazy` (so its `canonical` handler can see raw,
      // direction-intact operands for chain decomposition). `lazy` also skips
      // evaluating the arguments before this handler runs, so evaluate them
      // here — otherwise a compound operand like `Im(𝑖)` never folds to `1`.
      // A chain (`a < b < c`) stops at the first adjacent pair that is `False`
      // (`evaluateChainOperands`).
      const chain = evaluateChainOperands(
        ce,
        rawOps,
        numericApproximation,
        CHAIN_PAIR_IS_FALSE.Less(ce)
      );
      if (!Array.isArray(chain)) return chain;
      const ops = chain;
      // Element-wise broadcast when an operand evaluated to a collection (e.g.
      // `|[1...5]-2| > 0`, canonical `Less(0, Abs(…))`). See `broadcastComparison`.
      const bc = broadcastComparison(ce, 'Less', ops, numericApproximation);
      if (bc) return bc;
      // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`,
      // IEEE over `NaN` (unordered ⇒ `False`). Applies per-cell too (broadcast
      // re-enters this handler on scalar cells). A numeric-domain slot's
      // `Missing` reads as `NaN` (`readComparisonAbsence`).
      const vals = readComparisonAbsence(ce, rawOps, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        // Try quantity comparison first
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp < 0 ? ce.True : ce.False;
        const cmp = lhs.isLess(rhs) ?? compareFromAssumedBounds(lhs, rhs, true);
        if (cmp === undefined) return inertRelation(ce, 'Less', rawOps, ops);
        return cmp ? ce.True : ce.False;
      }
      if (ops.length < 2) return ce.True;
      // Less can have multiple arguments, i.e. a < b < c < d
      let lhs: Expression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const qcmp = quantityCompare(lhs, arg);
          if (qcmp !== null) {
            if (qcmp >= 0) return ce.False;
          } else {
            const cmp =
              lhs.isLess(arg) ?? compareFromAssumedBounds(lhs, arg, true);
            if (cmp === undefined)
              return inertRelation(ce, 'Less', rawOps, ops);
            if (cmp === false) return ce.False;
          }
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  NotLess: {
    description: 'Negated less-than relation (not less than).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Less', ops)]),
  },

  Greater: {
    description: 'Greater-than comparison (strictly greater than).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    lazy: true,
    // Broadcast element-wise over a list operand (canonicalizes to `Less`; the
    // flag is kept here for a non-canonicalized `Greater`).
    broadcastable: true,
    // Pass the operator through unchanged (rather than reversing to `Less`
    // here). `canonicalRelational` needs the original direction to correctly
    // decompose mixed-direction chains (e.g. `a ≤ b > c`); the Greater→Less
    // normalization happens there, per chain segment.
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Greater', ops),
  },

  NotGreater: {
    description: 'Negated greater-than relation (not greater than).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [ce._fn('Greater', args)]),
  },

  LessEqual: {
    description: 'Less-than-or-equal comparison (less than or equal to).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    // Kleene over the `Missing` symbol, IEEE over `NaN` (§3.D, family coherence,
    // amended 2026-07-24); see `Less`. Covers `GreaterEqual` too (canonicalizes
    // here).
    missingBehavior: 'handle',

    type: relationalAbsenceType,

    lazy: true,
    // Broadcast element-wise over a list operand (see `Less`).
    broadcastable: true,
    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', ops),

    eq: (a, b, prover) => inequalityEq(a, b, 'LessGreater', prover),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // `lazy` skips argument evaluation (see `Less` above): evaluate here.
      // A chain stops at the first `False` pair (`evaluateChainOperands`).
      const chain = evaluateChainOperands(
        ce,
        rawOps,
        numericApproximation,
        CHAIN_PAIR_IS_FALSE.LessEqual(ce)
      );
      if (!Array.isArray(chain)) return chain;
      const ops = chain;
      // Element-wise broadcast when an operand evaluated to a collection.
      const bc = broadcastComparison(
        ce,
        'LessEqual',
        ops,
        numericApproximation
      );
      if (bc) return bc;
      // Absence semantics (§3.D, amended 2026-07-24): Kleene over `Missing`,
      // IEEE over `NaN` (unordered ⇒ `False`). See `Less`.
      const vals = readComparisonAbsence(ce, rawOps, ops);
      if (vals.some((op) => isSymbol(op, 'Missing'))) return ce.Missing;
      if (vals.some((op) => isNumber(op) && op.isNaN === true)) return ce.False;
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp <= 0 ? ce.True : ce.False;
        const cmp =
          lhs.isLessEqual(rhs) ?? compareFromAssumedBounds(lhs, rhs, false);
        if (cmp === undefined)
          return inertRelation(ce, 'LessEqual', rawOps, ops);
        return cmp ? ce.True : ce.False;
      }
      if (ops.length < 2) return ce.True;
      // LessEqual can have multiple arguments, i.e. a <= b <= c <= d
      let lhs: Expression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const qcmp = quantityCompare(lhs, arg);
          if (qcmp !== null) {
            if (qcmp > 0) return ce.False;
          } else {
            const cmp =
              lhs.isLessEqual(arg) ?? compareFromAssumedBounds(lhs, arg, false);
            if (cmp === undefined)
              return inertRelation(ce, 'LessEqual', rawOps, ops);
            if (cmp === false) return ce.False;
          }
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  NotLessNotEqual: {
    description: 'Neither less than nor equal to.',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'LessEqual', ops)]),
  },

  GreaterEqual: {
    description: 'Greater-than-or-equal comparison (greater than or equal to).',
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    lazy: true,
    // Broadcast element-wise over a list operand (canonicalizes to `LessEqual`).
    broadcastable: true,
    // Pass the operator through unchanged (see `Greater` above): the
    // GreaterEqual→LessEqual normalization is done per chain segment inside
    // `canonicalRelational`.
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'GreaterEqual', args),
  },

  NotGreaterNotEqual: {
    description: 'Neither greater than nor equal to.',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'GreaterEqual', args)]),
  },

  TildeFullEqual: {
    description: 'Indicate isomorphism, congruence and homotopic equivalence',
    signature: '(any, any+) -> boolean',

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeFullEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotTildeFullEqual: {
    description:
      'Negated isomorphism/congruence relation (not isomorphic or congruent).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeFullEqual', args)]),
  },

  Tilde: {
    description:
      'Generic similarity relation (`\\sim`): similar geometric figures, asymptotic equivalence, or "is distributed as". Inert: stays symbolic.',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Tilde', args),
  },

  NotTilde: {
    description: 'Negated similarity relation (not similar).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Tilde', args)]),
  },

  TildeEqual: {
    description: 'Approximately or asymptotically equal',
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'TildeEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotTildeEqual: {
    description:
      'Negated approximately/asymptotically-equal relation (not approximately equal).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeEqual', args)]),
  },

  Approx: {
    description: 'Approximate-equality relation (approximately equal).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Approx', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApprox: {
    description:
      'Negated approximate-equality relation (not approximately equal).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Approx', args)]),
  },

  ApproxEqual: {
    description: 'Approximately-equal relation.',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApproxEqual: {
    description: 'Negated approximately-equal relation.',
    complexity: 11100,
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'ApproxEqual', args)]),
  },

  ApproxNotEqual: {
    description: 'Approximately-not-equal relation.',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxNotEqual', args),
    evaluate: (ops, { engine: ce }) => {
      const result = evaluateApproxChain(ops, ce);
      if (result === undefined) return undefined;
      return result === ce.True ? ce.False : ce.True;
    },
  },

  NotApproxNotEqual: {
    description: 'Negated approximately-not-equal relation.',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'ApproxNotEqual', args)]),
  },

  Precedes: {
    description: 'Precedes relation in an ordering (comes before).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Precedes', args),
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return ce.True;
      let prev = ops[0];
      for (let i = 1; i < ops.length; i++) {
        const result = prev.isLess(ops[i]);
        if (result === undefined) return undefined;
        if (result === false) return ce.False;
        prev = ops[i];
      }
      return ce.True;
    },
  },

  NotPrecedes: {
    description: 'Negated precedes relation (does not precede).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Precedes', args)]),
  },

  Succeeds: {
    description: 'Succeeds relation in an ordering (comes after).',
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      canonicalRelational(engine, 'Succeeds', args),
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return ce.True;
      let prev = ops[0];
      for (let i = 1; i < ops.length; i++) {
        const result = ops[i].isLess(prev);
        if (result === undefined) return undefined;
        if (result === false) return ce.False;
        prev = ops[i];
      }
      return ce.True;
    },
  },

  NotSucceeds: {
    description: 'Negated succeeds relation (does not succeed).',
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Succeeds', args)]),
  },
};

/**
 * Result-type handler for the absence-aware relational operators
 * (`IdenticallyEqual`, `Less`, `LessEqual`; `Equal` and `NotEqual` apply it
 * first, through `comparisonResultType`). Mirrors §3.D: a
 * definitely-absent operand (`missing`) makes the result `missing`; a
 * possibly-absent operand (an operand type carrying a `missing` arm) makes it
 * `boolean | missing`; otherwise `boolean` (unchanged). A `NaN` operand is not
 * visible at the type level (its static type is `number`), so it does not
 * widen the result type — the IEEE `False`/`True` is a runtime-only outcome.
 */
function relationalAbsenceType(ops: ReadonlyArray<Expression>) {
  let definite = false;
  let possible = false;
  for (const op of ops) {
    const t = op.type.type;
    if (t === 'missing') definite = true;
    // A NUMERIC-domain `missing` arm (`number | missing`) does NOT widen the
    // result: that slot's absence representation is `NaN` (I6), and an IEEE
    // comparison of `NaN` is a plain boolean. Only an OBJECT-domain arm — a
    // slot that can hold the `Missing` symbol itself — makes the Kleene
    // `Missing` result reachable. This is also what lets a comparison over
    // `number | missing` operands compile guard-free on float-only targets
    // (GPU): its result type has no `missing` arm to fail closed on.
    else if (typeContainsMissing(t) && !numericMissingSlot(t)) possible = true;
  }
  if (definite) return 'missing';
  if (possible) return parseType('boolean | missing');
  return 'boolean';
}

/**
 * Result-type handler for `Equal`/`NotEqual`.
 *
 * These two operators broadcast element-wise ONLY in the list-vs-scalar case:
 * `Equal([1,2,3], 2)` is the mask `[False, True, False]`, while two collection
 * operands are compared as a whole and yield a single boolean. (That rule is
 * applied at evaluation by `broadcastableComparisonOperands` below and by its
 * pre-evaluation twin `skipBroadcastForVectorOps` in
 * `boxed-expression/boxed-function.ts`.)
 *
 * Which of the two outcomes applies is not always decidable statically. When
 * one operand is DEFINITELY a collection and another is only POSSIBLY one —
 * a top-typed application such as `At(U, 1)` where `U` is declared bare
 * `indexed_collection`, or an operand already typed `broadcastable<…>` — the
 * answer is only fixed once that operand evaluates: a scalar makes the result
 * an element-wise `list<boolean>` mask, a collection makes it a scalar
 * `boolean`. `broadcastable<boolean>` is exactly the type that admits both
 * (it is the union `boolean | indexed_collection<boolean>`), and it is the
 * spelling the engine already gives every other possibly-broadcast result.
 *
 * Answering the scalar `boolean` there was a type/value disagreement rather
 * than a conservative approximation: a possibly-collection operand also makes
 * the pre-evaluation broadcast gate skip, so nothing lifted the declared type,
 * yet the evaluate handler went on to broadcast over the definite collection
 * and produced a list. `\sum_i Which(C = U_i, i, 0)` with both symbols
 * declared `indexed_collection` typed `number` while evaluating to `[1,2,1]`.
 *
 * Two-or-more DEFINITE collections stay the scalar `boolean`: that is the
 * whole-collection compare, decided statically. With no possibly-collection
 * operand at all the plain `boolean` also stands, and the generic broadcast
 * typing in `boxed-function.ts` lifts it to `list<boolean>` when a definite
 * collection is present.
 */
function comparisonResultType(ops: ReadonlyArray<Expression>): Type {
  const absence = relationalAbsenceType(ops);
  // An absent operand decides the result before broadcasting is even reached
  // (`missing`/`boolean | missing` per §3.D), so leave those answers alone.
  if (absence !== 'boolean') return absence;
  if (!ops.some((op) => isPossiblyCollectionTyped(op))) return 'boolean';
  // The DEFINITE half of the operand count `skipBroadcastForVectorOps` and
  // `broadcastableComparisonOperands` share — an enumerable collection value,
  // or a valueless operand whose declared type is definitely a collection —
  // spelled with the same helpers so the three sites cannot drift apart.
  const definiteCollections = ops.filter(
    (op) => op.isCollection || isValuelessCollectionTyped(op)
  ).length;
  if (definiteCollections >= 2) return 'boolean';
  return { kind: 'broadcastable', elements: 'boolean' };
}

/**
 * Domain-directed absence read for comparison operands (§3.D + I6).
 *
 * An operand that EVALUATED to the `Missing` symbol is Kleene — except when
 * the operand it evaluated from is typed with a numeric-domain `missing` arm
 * (`numericMissingSlot`): that slot's honest absence value is `NaN`, so the
 * comparison reads it as `NaN` and follows IEEE. Keeps the static type
 * (plain `boolean`, per `relationalAbsenceType`), the interpreter, and
 * compiled code (where the slot's absent value already IS `NaN` at the ABI)
 * in agreement.
 */
function readComparisonAbsence(
  ce: ComputeEngine,
  rawOps: ReadonlyArray<Expression>,
  ops: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  if (!ops.some((op) => isSymbol(op, 'Missing'))) return ops;
  return ops.map((op, i) =>
    isSymbol(op, 'Missing') && numericMissingSlot(rawOps[i].type.type)
      ? ce.NaN
      : op
  );
}

/**
 * May an `Equal`/`NotEqual` over these EVALUATED operands broadcast
 * element-wise, or does it stay a whole-collection boolean?
 *
 * This must apply the same rule as `skipBroadcastForVectorOps` (step 2 in
 * `boxed-function`), because that is the step this handler defers from: step 2
 * skips whenever two or more operands are collections **or possibly-collection
 * typed**, and hands the decision here "with full information".
 *
 * Counting only `isCollection` here made the two rules DISAGREE, and the
 * disagreement was an infinite loop rather than a wrong answer. An application
 * with a top type (`A(t)` with `A` undeclared) is possibly-collection typed and
 * stays so after evaluation — it never resolves. Step 2 therefore skipped
 * forever, this handler counted one collection, `broadcastComparison` rebuilt
 * the identical node, and evaluating it re-entered step 2: `A(t) = [1, 2]`
 * overflowed the stack out of `evaluate()` on a bare engine.
 *
 * Deferring is still what step 2 intends: an opaque operand that turns out to
 * be a genuine scalar has a concrete type by the time it reaches here, so it no
 * longer counts and the element-wise broadcast happens exactly as before.
 */
function broadcastableComparisonOperands(
  ops: ReadonlyArray<Expression>
): boolean {
  return (
    ops.filter(
      (op) =>
        // A STRING is a collection of its characters in the lattice, but it is
        // ATOMIC here — it must stay the SCALAR side of a list-vs-scalar
        // comparison, so `Equal([1,2,3], "a")` keeps broadcasting element-wise
        // instead of degrading to whole-collection equality. Must stay in
        // lockstep with `skipBroadcastForVectorOps`
        // (`boxed-expression/boxed-function.ts`), which excludes it too.
        !isTextAtom(op) &&
        (op.isCollection ||
          isPossiblyCollectionTyped(op) ||
          // A DEFINITELY collection-typed operand that is not a collection NODE:
          // a symbol declared `vector<2>` with no value, or an application
          // `L(1)` under `L: (number) -> vector<2>`. `isCollection` is false
          // (nothing to enumerate) and the concrete type is neither top nor
          // `broadcastable`, so the two predicates above both miss it. This
          // disjunct must stay in lockstep with `skipBroadcastForVectorOps`
          // (`boxed-expression/boxed-function.ts`), which gained the same test
          // on 2026-08-15 when placeholder-signature refinement started giving
          // such operands their concrete collection types: while only step 2
          // counted them, step 2 skipped and this handler broadcast, so
          // `broadcastComparison` rebuilt the identical node and evaluating it
          // re-entered step 2 — `M = [1,2]` with `M: vector<2>` overflowed the
          // stack out of `evaluate()` on a bare engine, in the same way the
          // top-typed case described above once did.
          op.type.matches('collection<any>'))
    ).length < 2
  );
}

/**
 * Is a whole-collection `Equal`/`NotEqual` over these operands UNDECIDED?
 *
 * Once the element-wise broadcast has declined, a collection operand is
 * compared structurally against the other side. That is only sound when both
 * sides have resolved: an opaque operand (a top-typed application such as
 * `q(2)`, or a `broadcastable<T>` node) may still BE that collection, so
 * answering `False` would claim a mismatch the engine cannot see. Stay inert
 * instead — the same rule the handlers already apply to `x^2 = 4`.
 *
 * "Unresolved" includes an operand that is DEFINITELY collection-typed but
 * carries no value — a symbol declared `vector<2>`, or an application whose
 * head returns one. Such an operand is exactly as unresolved as an opaque one,
 * and for the same reason: it may still be equal to the other side. This
 * predicate is the last line of defense before the structural comparison, so
 * omitting them here would rest on `eq()` happening to decline for a free
 * variable — true today, but a coincidence rather than a guarantee, and it
 * would become an unsound `False` the moment `eq()` grew stronger. It also
 * keeps this in step with `broadcastableComparisonOperands` above, whose twin
 * `skipBroadcastForVectorOps` (`boxed-expression/boxed-function.ts`) applies
 * the same test. When those two disagreed, the pre-evaluation guard skipped,
 * this handler broadcast and rebuilt the identical node, and evaluating it
 * re-entered the pre-evaluation guard — `M = [1,2]` with `M` declared
 * `vector<2>` overflowed the stack out of `evaluate()` on a bare engine.
 * Pinned by `test/compute-engine/relational-broadcast-recursion.test.ts`.
 */
function undecidedCollectionComparison(
  ops: ReadonlyArray<Expression>
): boolean {
  const unresolved = (op: Expression): boolean =>
    isPossiblyCollectionTyped(op) ||
    (!op.isCollection && op.type.matches('collection<any>'));
  return ops.some(unresolved) && ops.some((op) => op.isCollection);
}

/**
 * Post-evaluation element-wise broadcast for the `lazy` comparison operators.
 *
 * `Less`/`LessEqual` are `lazy`, so the generic broadcast in `boxed-function`
 * (steps 2 and 4b) does not fire when an operand only *becomes* a collection
 * after evaluation — e.g. `|[1...5]-2| > 0`, whose operand `Abs(Add(…, Range))`
 * is not a materialized collection until evaluated. The handlers evaluate their
 * operands internally; once evaluated, if any operand is a finite indexed
 * collection, rebuild the comparison so the generic broadcast (step 2) zips it
 * into a `list<boolean>`. Reusing the already-evaluated operands means no
 * double evaluation on the scalar path.
 */
function broadcastComparison(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>,
  numericApproximation: boolean | undefined
): Expression | undefined {
  // Tuples are excluded, matching the pre-evaluation broadcast (step 2 in
  // boxed-function): a `Tuple` is an atomic value, never mapped over. Without
  // the exclusion, a tuple-only comparison re-enters evaluate — whose step 2
  // now skips tuples — and ping-pongs back here forever (stack overflow).
  if (!ops.some((op) => isFiniteBroadcastParticipant(op))) return undefined;
  // A collection-TYPED but valueless operand is excluded for the same reason,
  // and it is the same ping-pong: step 2 DECLINES such a comparison (it would
  // splice the valueless operand into every cell as a scalar — see
  // `hasUnresolvedCollectionOperand`), so re-entering evaluate here would come
  // straight back and recurse until the stack is exhausted. Declining leaves
  // the comparison inert, which is what the veto wants; once the operand is
  // assigned it broadcasts normally.
  if (hasUnresolvedCollectionOperand(ops, isBroadcastableCollection)) {
    // A length disagreement among the operands that DO have values outranks the
    // veto: no assignment to the unresolved operand can reconcile 2 elements
    // against 3, so the comparison is the same error it would be without that
    // operand, rather than an inert form waiting on a value.
    const mismatch = broadcastLengthMismatch(ce, ops);
    if (mismatch) return mismatch;
    return undefined;
  }
  return ce._fn(operator, ops).evaluate({ numericApproximation });
}

/**
 * Check if two expressions are approximately equal, i.e. their numeric
 * values differ by at most `ce.tolerance`.
 * Returns `true`, `false`, or `undefined` if the comparison can't be made.
 */
function approxEq(a: Expression, b: Expression): boolean | undefined {
  const ce = a.engine;
  // An operand with unknowns cannot numericize, so the `isNumber` test below
  // would reject it after an unbounded (exponential, for nested user-function
  // applications) traversal.
  if (a.unknowns.length > 0 || b.unknowns.length > 0) return undefined;
  const aN = a.N();
  const bN = b.N();

  if (!isNumber(aN) || !isNumber(bN)) return undefined;

  const diff = aN.sub(bN);
  if (!isNumber(diff)) return undefined;

  const n = diff.numericValue;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}

/**
 * Evaluate a chain of approximately-equal comparisons:
 * `a ≈ b ≈ c` means `a ≈ b` and `b ≈ c`.
 */
function evaluateApproxChain(
  ops: ReadonlyArray<Expression>,
  ce: ComputeEngine
): Expression | undefined {
  if (ops.length < 2) return ce.True;
  let prev = ops[0];
  for (let i = 1; i < ops.length; i++) {
    const result = approxEq(prev, ops[i]);
    if (result === false) return ce.False;
    if (result === undefined) return undefined;
    prev = ops[i];
  }
  return ce.True;
}

// The comparison operators that participate in mixed-direction chains. These
// are declared `lazy` so their `canonical` handler receives the *raw* operands
// (with the written direction still intact), which is required to decompose a
// chain like `a ≤ b > c` correctly. See `canonicalComparisonChain`.
const CHAINABLE_COMPARISON = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'IdenticallyEqual',
]);

function canonicalRelational(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  // Core comparisons need the direction-aware chain handling in
  // `canonicalComparisonChain`.
  if (CHAINABLE_COMPARISON.has(operator))
    return canonicalComparisonChain(ce, operator, ops);

  // Legacy path for the other relational operators (approx/precedes/…). These
  // are not `lazy` and never flip direction, so the simple boundary-term
  // splice below is adequate.
  ops = flatten(ops, operator);

  const nestedRelational: Expression[] = [];
  const newOps: Expression[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isRelationalOperator(op.operator) && isFunction(op)) {
      nestedRelational.push(op);
      newOps.push(i === 0 ? op.ops[op.ops.length - 1] : op.ops[0]);
    } else newOps.push(op);
  }

  if (nestedRelational.length === 0) return ce._fn(operator, newOps);

  return ce._fn('And', [ce._fn(operator, newOps), ...nestedRelational]);
}

/**
 * Flatten a (possibly nested) chain of comparison operators into an ordered
 * list of `terms` and the `links` (operators) between them, in *reading*
 * order. `terms.length === links.length + 1`.
 *
 * The parser nests mixed-operator chains, e.g. `a ≤ b > c` parses as
 * `LessEqual(a, Greater(b, c))`, and same-operator chains are already n-ary,
 * e.g. `Less(1, 2, 3)`. Because the comparison operators are `lazy`, the nested
 * operands still carry their *original* direction here (a nested `>` is a
 * `Greater`, not a reversed `Less`), so the chain can be reconstructed exactly
 * as written.
 */
function flattenComparisonChain(
  operator: string,
  ops: ReadonlyArray<Expression>
): { terms: Expression[]; links: string[] } {
  const terms: Expression[] = [];
  const links: string[] = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const sub =
      isFunction(op) && CHAINABLE_COMPARISON.has(op.operator)
        ? flattenComparisonChain(op.operator, op.ops)
        : { terms: [op], links: [] as string[] };
    if (i > 0) links.push(operator);
    terms.push(...sub.terms);
    links.push(...sub.links);
  }
  return { terms, links };
}

/** Build a single (n-ary) canonical comparison, normalizing the direction:
 *  `Greater`→`Less` and `GreaterEqual`→`LessEqual` (with the terms reversed). */
function buildComparison(
  ce: ComputeEngine,
  operator: string,
  terms: ReadonlyArray<Expression>
): Expression {
  if (operator === 'Greater') return ce._fn('Less', [...terms].reverse());
  if (operator === 'GreaterEqual')
    return ce._fn('LessEqual', [...terms].reverse());
  return ce._fn(operator, terms);
}

/**
 * Canonicalize a chain of comparison operators.
 *
 * A same-operator chain stays n-ary (`1 < 2 < 3` → `Less(1, 2, 3)`). A chain
 * that mixes operators — whether same-direction (`a ≤ b < c`) or opposite
 * direction (`a ≤ b > c`) — is decomposed into an explicit `And` of pairwise
 * (or n-ary same-operator) links that all share their boundary terms, e.g.
 * `a ≤ b > c` → `And(a ≤ b, b > c)` = `And(LessEqual(a, b), Less(c, b))`.
 */
function canonicalComparisonChain(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  const { terms: rawTerms, links } = flattenComparisonChain(operator, ops);
  const terms = rawTerms.map((t) => t.canonical);

  // Degenerate cases (fewer than two terms): nothing to chain.
  if (links.length === 0) return buildComparison(ce, operator, terms);

  // Group maximal runs of the *same* operator into n-ary segments, then `And`
  // the segments together. Segment `i..j` (inclusive links) spans the terms
  // `i..j+1`.
  const segments: Expression[] = [];
  let i = 0;
  while (i < links.length) {
    let j = i;
    // Group maximal runs of the same operator into one n-ary segment — EXCEPT
    // `NotEqual`, which is not transitive: `a ≠ b ≠ c` means `a ≠ b ∧ b ≠ c`
    // (adjacent pairs), NOT the n-ary "all distinct". Keep each `NotEqual` link
    // as its own pairwise segment so the chain decomposes into an `And`.
    if (links[i] !== 'NotEqual')
      while (j + 1 < links.length && links[j + 1] === links[i]) j++;
    segments.push(buildComparison(ce, links[i], terms.slice(i, j + 2)));
    i = j + 1;
  }

  if (segments.length === 1) return segments[0];
  return ce.function('And', segments);
}

function inequalityEq(
  a: Expression,
  b: Expression,
  oppositeOperator?: string,
  prover?: boolean
): boolean | undefined {
  // Relation equivalence is an identity question in the free variables:
  // prover tier only (see `Equal`'s `eq` handler).
  if (prover === false) return undefined;
  if (!isFunction(a) || !isFunction(b)) return undefined;

  // Two relations are equivalent when they have the same solution set — an
  // *identity* question in the free variables of the operands (`2(13.1+x) < 5`
  // vs `26.2+2x < 5`), not arithmetic equality. Use the prover tier
  // (`isIdenticallyEqual`), which keeps the free-variable machinery; cheap
  // `isEqual()` would report a spurious `false` here.
  //
  // Three-valued: only an all-pairs *provable* identity yields `true`. An
  // undecided pair (or pairwise non-identity, which does not prove the
  // relations differ: `x < 1` vs `x+1 < 2`) yields `undefined`, never `false`.
  if (a.operator === b.operator) {
    if (a.nops !== b.nops) return undefined;
    return a.ops.every((op, i) => op.isIdenticallyEqual(b.ops[i]) === true)
      ? true
      : undefined;
  }

  if (b.operator === oppositeOperator) {
    if (a.nops !== b.nops) return undefined;
    return a.ops.every(
      (op, i) => op.isIdenticallyEqual(b.ops[b.nops - 1 - i]) === true
    )
      ? true
      : undefined;
  }

  return undefined;
}
