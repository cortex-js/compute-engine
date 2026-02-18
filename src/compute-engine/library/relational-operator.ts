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
      const nLhs = lhs.value;
      const nRhs = rhs.value;
      const nModulo = modulo.value;
      if (typeof nLhs !== 'number') return undefined;
      if (typeof nRhs !== 'number') return undefined;
      if (typeof nModulo !== 'number') return undefined;
      return nLhs % nModulo === nRhs % nModulo ? ce.True : ce.False;
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

      for (const testVal of testValues) {
        // Create substitution for all unknowns
        const sub: Record<string, number> = {};
        for (const u of unknowns) sub[u] = testVal;

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

    evaluate: (ops, { engine: ce }) => {
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
          //   Return undefined to preserve 3-valued logic.
          //
          // In normal evaluation mode:
          //   Return True because NotEqual(x, 1) should evaluate to True when we
          //   can't prove equality. This matches expected behavior (though note
          //   this is not strictly correct three-valued logic - it's a pragmatic
          //   choice for usability).
          if (test === undefined && ce.isVerifying) return undefined;
          // Continue the loop - if all comparisons are not equal, return True
        }
      }
      return ce.True;
    },
  } as OperatorDefinition,

  Less: {
    complexity: 11000,
    signature: '(any, any+) -> boolean',

    canonical: (ops, { engine: ce }) => canonicalRelational(ce, 'Less', ops),

    eq: (a, b) => inequalityEq(a, b, 'Greater'),

    evaluate: (ops, { engine: ce }) => {
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        // Try quantity comparison first
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp < 0 ? ce.True : ce.False;
        const cmp = lhs.isLess(rhs);
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
            const cmp = lhs.isLess(arg);
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
    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'Less', [...ops].reverse()),
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

    canonical: (ops, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', ops),

    eq: (a, b) => inequalityEq(a, b, 'LessGreater'),

    evaluate: (ops, { engine: ce }) => {
      if (ops.length === 2) {
        const [lhs, rhs] = ops;
        const qcmp = quantityCompare(lhs, rhs);
        if (qcmp !== null) return qcmp <= 0 ? ce.True : ce.False;
        const cmp = lhs.isLessEqual(rhs);
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
            const cmp = lhs.isLessEqual(arg);
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

    canonical: (args, { engine: ce }) =>
      canonicalRelational(ce, 'LessEqual', [...args].reverse()),
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

function canonicalRelational(
  ce: ComputeEngine,
  operator: string,
  ops: ReadonlyArray<Expression>
): Expression {
  ops = flatten(ops, operator);

  const nestedRelational: Expression[] = [];
  const newOps: Expression[] = [];
  // Separate any nested relational operators
  for (const op of ops) {
    if (isRelationalOperator(op.operator) && isFunction(op)) {
      nestedRelational.push(op);
      newOps.push(op.ops[op.ops.length - 1]);
    } else newOps.push(op);
  }

  if (nestedRelational.length === 0) return ce._fn(operator, newOps);

  return ce._fn('And', [ce._fn(operator, newOps), ...nestedRelational]);

  // if (!ops.every((op) => op.isValid))
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
