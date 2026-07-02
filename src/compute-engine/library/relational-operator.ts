import type {
  Expression,
  OperatorDefinition,
  SymbolDefinitions,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import { isRelationalOperator } from '../latex-syntax/utils';
import { flatten } from '../boxed-expression/flatten';
import { eq } from '../boxed-expression/compare';
import { isNumber, isFunction } from '../boxed-expression/type-guards';
import { toBigint } from '../boxed-expression/numerics';
import {
  subjectOf,
  finiteNumericValue,
  hasAssumptions,
  decideComparisonFromBounds,
} from '../boxed-expression/constraint-subject';
import { getInequalityBoundsFromAssumptions } from '../boxed-expression/inequality-bounds';
import { isQuantity } from './quantity-arithmetic';
import { boxedToUnitExpression } from './units';
import {
  dimensionsEqual,
  getExpressionDimension,
  getExpressionScale,
} from './unit-data';

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

export const RELOP_LIBRARY: SymbolDefinitions = {
  Congruent: {
    description: 'Indicate that two expressions are congruent modulo a number',
    complexity: 11000,
    signature: '(number, number, modulo: integer) -> boolean',
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 3) return undefined;
      const [lhs, rhs, modulo] = ops;
      // Congruence is integer arithmetic. Use bigint so it works under the
      // bignum-preferred default precision (where `.value` is not a JS
      // number), and reduce with a floored modulo so negatives are handled
      // correctly (JS `%` is a remainder: `-1 % 7 === -1`, not `6`).
      const a = toBigint(lhs);
      const b = toBigint(rhs);
      const m = toBigint(modulo);
      if (a === null || b === null || m === null || m === 0n) return undefined;
      const reduce = (x: bigint) => ((x % m) + m) % m;
      return reduce(a) === reduce(b) ? ce.True : ce.False;
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
    complexity: 11000,
    signature: '(any, any) -> boolean',

    lazy: true,

    canonical: (args, { engine: ce }) => canonicalRelational(ce, 'Equal', args),

    // Comparing two equalities...
    // Two equations are equivalent if they have the same solution set.
    // For polynomial equations, this means the LHS-RHS expressions differ
    // only by a non-zero constant factor.
    eq: (a, b) => {
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

    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return ce.True;
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

          // Handle undefined (unknown) comparisons differently based on context:
          //
          // In verification mode (ce.isVerifying = true):
          //   Return undefined to preserve 3-valued logic (true/false/unknown).
          //   This is needed for verify() to correctly handle unprovable predicates.
          //
          // In normal evaluation mode:
          //   Return False because Equal(x, 1) should evaluate to False when we
          //   can't prove it's true. This matches expected behavior for equations.
          if (test === undefined && ce.isVerifying) return undefined;
          if (test === undefined) return ce.False;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  NotEqual: {
    wikidata: 'Q28113351',
    complexity: 11000,

    signature: '(any, any) -> boolean',

    // `lazy` so the `canonical` handler receives raw, direction-intact operands
    // for chain decomposition (see `canonicalComparisonChain`); a chained
    // `a ≠ b ≠ c` becomes `And(a ≠ b, b ≠ c)`.
    lazy: true,

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'NotEqual', args),

    // Comparing two equalities...
    eq: (a, b) => {
      if (a.operator !== b.operator) return false;
      if (!isFunction(a) || !isFunction(b)) return false;
      // Equality is commutative
      if (
        (a.op1.isEqual(b.op1) && a.op2.isEqual(b.op2)) ||
        (a.op1.isEqual(b.op2) && a.op2.isEqual(b.op1))
      )
        return true;
      return false;
    },

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // `lazy` skips argument evaluation before this handler runs (see the
      // `Less` handler): evaluate the operands here so compound operands fold.
      const ops = rawOps.map((op) => op.evaluate({ numericApproximation }));
      if (ops.length < 2) return ce.False;
      let lhs: Expression | undefined = undefined;
      for (const arg of ops!) {
        if (!lhs) lhs = arg;
        else {
          const test = lhs.isEqual(arg);
          if (test === true) return ce.False;

          // Handle undefined (unknown) comparisons differently based on context:
          //
          // In verification mode (ce.isVerifying = true):
          //   Preserve 3-valued logic — but first try to *prove* the two sides
          //   distinct from assumed bounds. A proven strict inequality in
          //   either direction entails ≠ (e.g. `assume(z > 0)` ⇒ `z ≠ 0`), so
          //   rule guards like `; z ≠ 0` fire under such assumptions even
          //   though the pragmatic collapse below is suppressed. If distinctness
          //   is not provable, stay undefined.
          //
          // In normal evaluation mode:
          //   Return True because NotEqual(x, 1) should evaluate to True when we
          //   can't prove equality. This matches expected behavior (though note
          //   this is not strictly correct three-valued logic - it's a pragmatic
          //   choice for usability).
          if (test === undefined && ce.isVerifying) {
            const distinct =
              compareFromAssumedBounds(lhs, arg, true) === true ||
              compareFromAssumedBounds(arg, lhs, true) === true;
            if (!distinct) return undefined;
          }
          // Continue the loop - if all comparisons are not equal, return True
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  Less: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    lazy: true,
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Less', ops),

    eq: (a, b) => inequalityEq(a, b, 'Greater'),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // This operator is `lazy` (so its `canonical` handler can see raw,
      // direction-intact operands for chain decomposition). `lazy` also skips
      // evaluating the arguments before this handler runs, so evaluate them
      // here — otherwise a compound operand like `Im(𝑖)` never folds to `1`.
      const ops = rawOps.map((op) => op.evaluate({ numericApproximation }));
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        // Try quantity comparison first
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp < 0 ? ce.True : ce.False;
        const cmp = lhs.isLess(rhs) ?? compareFromAssumedBounds(lhs, rhs, true);
        if (cmp === undefined) return undefined;
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
            if (cmp === undefined) return undefined;
            if (cmp === false) return ce.False;
          }
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  NotLess: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Less', ops)]),
  },

  Greater: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    lazy: true,
    // Pass the operator through unchanged (rather than reversing to `Less`
    // here). `canonicalRelational` needs the original direction to correctly
    // decompose mixed-direction chains (e.g. `a ≤ b > c`); the Greater→Less
    // normalization happens there, per chain segment.
    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Greater', ops),
  },

  NotGreater: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [ce._fn('Greater', args)]),
  },

  LessEqual: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    lazy: true,
    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', ops),

    eq: (a, b) => inequalityEq(a, b, 'LessGreater'),

    evaluate: (rawOps, { engine: ce, numericApproximation }) => {
      // `lazy` skips argument evaluation (see `Less` above): evaluate here.
      const ops = rawOps.map((op) => op.evaluate({ numericApproximation }));
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp <= 0 ? ce.True : ce.False;
        const cmp =
          lhs.isLessEqual(rhs) ?? compareFromAssumedBounds(lhs, rhs, false);
        if (cmp === undefined) return undefined;
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
            if (cmp === undefined) return undefined;
            if (cmp === false) return ce.False;
          }
          lhs = arg;
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  NotLessNotEqual: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',
    canonical: (ops, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'LessEqual', ops)]),
  },

  GreaterEqual: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    lazy: true,
    // Pass the operator through unchanged (see `Greater` above): the
    // GreaterEqual→LessEqual normalization is done per chain segment inside
    // `canonicalRelational`.
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'GreaterEqual', args),
  },

  NotGreaterNotEqual: {
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
    complexity: 11100,
    signature: '(any, any+) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeFullEqual', args)]),
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
    complexity: 11100,
    signature: '(any, any+) -> boolean',

    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'TildeEqual', args)]),
  },

  Approx: {
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'Approx', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApprox: {
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'Approx', args)]),
  },

  ApproxEqual: {
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'ApproxEqual', args),
    evaluate: (ops, { engine: ce }) => evaluateApproxChain(ops, ce),
  },

  NotApproxEqual: {
    complexity: 11100,
    canonical: (args, { engine: ce }) =>
      ce._fn('Not', [canonicalRelational(ce, 'ApproxEqual', args)]),
  },

  ApproxNotEqual: {
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
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'ApproxNotEqual', args)]),
  },

  Precedes: {
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
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Precedes', args)]),
  },

  Succeeds: {
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
    complexity: 11100,
    signature: '(any, any+) -> boolean',
    canonical: (args, { engine }) =>
      engine._fn('Not', [canonicalRelational(engine, 'Succeeds', args)]),
  },
};

/**
 * Check if two expressions are approximately equal, i.e. their numeric
 * values differ by at most `ce.tolerance`.
 * Returns `true`, `false`, or `undefined` if the comparison can't be made.
 */
function approxEq(a: Expression, b: Expression): boolean | undefined {
  const ce = a.engine;
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
]);

function canonicalRelational(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  // Direction-aware handling for the core comparison operators (see below).
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
  oppositeOperator?: string
): boolean {
  if (!isFunction(a) || !isFunction(b)) return false;

  if (a.operator === b.operator) {
    if (a.nops !== b.nops) return false;
    return a.ops.every((op, i) => op.isEqual(b.ops[i]));
  }

  if (b.operator === oppositeOperator) {
    if (a.nops !== b.nops) return false;
    return a.ops.every((op, i) => op.isEqual(b.ops[b.nops - 1 - i]));
  }

  return false;
}
