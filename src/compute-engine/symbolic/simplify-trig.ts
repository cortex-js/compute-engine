import type {
  Expression,
  IComputeEngine as ComputeEngine,
  RuleStep,
} from '../global-types';
import { add } from '../boxed-expression/arithmetic-add';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards';

/**
 * Trigonometric simplification rules consolidated from simplify-rules.ts.
 * Handles ~80 patterns for simplifying trig expressions.
 *
 * Categories:
 * - Trig with infinity -> NaN
 * - Odd/even function properties with negation
 * - Pi transformations (pi - x, pi + x)
 * - Co-function identities (pi/2 - x)
 * - Periodicity reduction (reduce multiples of pi)
 * - Product-to-sum identities
 * - Pythagorean identities
 * - Inverse trig with infinity
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

// Trig functions
const TRIG_FUNCS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

// Odd trig functions: f(-x) = -f(x)
const ODD_TRIG = new Set(['Sin', 'Tan', 'Cot', 'Csc']);

// Even trig functions: f(-x) = f(x)
const EVEN_TRIG = new Set(['Cos', 'Sec']);

// Co-function pairs: f(pi/2 - x) = g(x)
const COFUNCTION_MAP: Record<string, string> = {
  Sin: 'Cos',
  Cos: 'Sin',
  Tan: 'Cot',
  Cot: 'Tan',
  Sec: 'Csc',
  Csc: 'Sec',
};

// For pi + x: f(pi + x) = sign * f(x)
// Mathematical identities:
// - sin(π+x) = -sin(x), cos(π+x) = -cos(x)
// - tan(π+x) = tan(x) (period π), cot(π+x) = cot(x) (period π)
// - sec(π+x) = -sec(x), csc(π+x) = -csc(x)
const PI_PLUS_SIGN: Record<string, number> = {
  Sin: -1,
  Cos: -1,
  Tan: 1,
  Cot: 1, // cotangent has period π, so cot(π+x) = cot(x)
  Sec: -1,
  Csc: -1, // csc(π+x) = 1/sin(π+x) = 1/(-sin(x)) = -csc(x)
};

// For pi - x: f(pi - x) = sign * f(x)
const PI_MINUS_SIGN: Record<string, number> = {
  Sin: 1,
  Cos: -1,
  Tan: -1,
  Cot: -1,
  Sec: -1,
  Csc: 1,
};

// Inverse trig functions
const INVERSE_TRIG = new Set([
  'Arcsin',
  'Arccos',
  'Arctan',
  'Arccot',
  'Arcsec',
  'Arccsc',
]);

/**
 * Reduce trigonometric functions by their periodicity.
 *
 * For sin/cos/sec/csc (period 2π): reduce coefficient of π modulo 2
 * For tan/cot (period π): reduce coefficient of π modulo 1 (just remove integer multiples)
 *
 * Example: cos(5π + k) → -cos(k) because 5 mod 2 = 1, and cos(π + x) = -cos(x)
 */
function reduceTrigPeriodicity(
  fn: 'Sin' | 'Cos' | 'Tan' | 'Cot' | 'Sec' | 'Csc',
  arg: Expression,
  ce: ComputeEngine
): Expression | null {
  // Only handle Add expressions
  if (!isFunction(arg) || arg.operator !== 'Add') return null;

  const terms = arg.ops;

  // Find a term that is a multiple of π
  let piCoeff: number | null = null;
  let piTermIndex = -1;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];

    // Check for plain Pi
    if (sym(term) === 'Pi') {
      piCoeff = 1;
      piTermIndex = i;
      break;
    }

    // Check for n * Pi or Pi * n
    if (isFunction(term) && term.operator === 'Multiply') {
      const termOps = term.ops;
      // Look for Pi among the factors
      const piIndex = termOps.findIndex((op) => sym(op) === 'Pi');
      if (piIndex >= 0) {
        // Get the coefficient (product of all other factors)
        const otherFactors = termOps.filter((_, idx) => idx !== piIndex);
        if (otherFactors.length === 1) {
          const factor = otherFactors[0];
          if (isNumber(factor)) {
            const n = factor.numericValue;
            if (typeof n === 'number' && Number.isInteger(n)) {
              piCoeff = n;
              piTermIndex = i;
              break;
            }
          }
        } else if (otherFactors.length === 0) {
          // Just Pi in a Multiply (shouldn't happen but handle it)
          piCoeff = 1;
          piTermIndex = i;
          break;
        }
      }
    }

    // Check for Negate(Pi) = -Pi
    if (
      isFunction(term) &&
      term.operator === 'Negate' &&
      sym(term.op1) === 'Pi'
    ) {
      piCoeff = -1;
      piTermIndex = i;
      break;
    }
  }

  // No multiple of π found
  if (piCoeff === null || piTermIndex < 0) return null;

  // Determine the period and calculate the reduced coefficient
  const period = fn === 'Tan' || fn === 'Cot' ? 1 : 2;

  // Reduce coefficient modulo period
  // JavaScript % can give negative results, so we normalize
  let reduced = piCoeff % period;
  if (reduced < 0) reduced += period;

  // If reduced is 0, the multiple of π has no effect - just remove the π term
  // If reduced is 1 (for period 2), we have a half-period shift

  // Build the remaining argument (without the π term)
  const remainingTerms = terms.filter((_, idx) => idx !== piTermIndex);

  // Add back the reduced π coefficient if non-zero
  if (reduced !== 0) {
    if (reduced === 1) {
      remainingTerms.push(ce.Pi);
    } else {
      remainingTerms.push(ce.box(['Multiply', reduced, 'Pi']));
    }
  }

  // If nothing changed (same coefficient), return null to avoid infinite loop
  if (reduced === piCoeff % period && reduced === piCoeff) return null;

  // Build the new argument
  let newArg: Expression;
  if (remainingTerms.length === 0) {
    newArg = ce.Zero;
  } else if (remainingTerms.length === 1) {
    newArg = remainingTerms[0];
  } else {
    newArg = add(...remainingTerms);
  }

  // For period 2 functions (sin, cos, sec, csc):
  // - If we removed an even multiple of π (reduced from n to 0), no sign change
  // - We've now reduced to having at most π in the argument
  // The existing rules for sin(π + x) -> -sin(x) etc. will handle the final step

  // For period 1 functions (tan, cot):
  // - Any integer multiple of π is removed, no sign change needed

  return ce.box([fn, newArg]);
}

export function simplifyTrig(x: Expression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle basic trig functions
  if (TRIG_FUNCS.has(op)) {
    if (!isFunction(x)) return undefined;
    const arg = x.op1;
    if (!arg) return undefined;

    // Trig with infinity -> NaN
    if (arg.isInfinity === true) {
      return { value: ce.NaN, because: `${op}(infinity) -> NaN` };
    }

    // Odd/even function properties with negation
    if (isFunction(arg) && arg.operator === 'Negate') {
      const innerArg = arg.op1;
      if (innerArg) {
        // Odd functions: f(-x) = -f(x)
        if (ODD_TRIG.has(op)) {
          return {
            value: ce._fn(op, [innerArg]).neg(),
            because: `${op}(-x) -> -${op}(x)`,
          };
        }
        // Even functions: f(-x) = f(x)
        if (EVEN_TRIG.has(op)) {
          return {
            value: ce._fn(op, [innerArg]),
            because: `${op}(-x) -> ${op}(x)`,
          };
        }
      }
    }

    // π - x transformations
    if (isFunction(arg) && arg.operator === 'Subtract') {
      const left = arg.op1;
      const right = arg.op2;
      if (sym(left) === 'Pi' && right) {
        const sign = PI_MINUS_SIGN[op];
        if (sign !== undefined) {
          const result = ce._fn(op, [right]);
          return {
            value: sign === 1 ? result : result.neg(),
            because: `${op}(π - x) -> ${sign === 1 ? '' : '-'}${op}(x)`,
          };
        }
      }
    }

    // π + x transformations (when Pi appears in Add)
    if (isFunction(arg) && arg.operator === 'Add') {
      // Check if Pi is one of the operands
      const piIndex = arg.ops.findIndex((term) => sym(term) === 'Pi');
      if (piIndex >= 0) {
        const otherTerms = arg.ops.filter((_, idx) => idx !== piIndex);

        // Only handle simple case: Pi + x (not n*Pi + x)
        if (otherTerms.length === arg.ops.length - 1) {
          const remaining =
            otherTerms.length === 1 ? otherTerms[0] : ce._fn('Add', otherTerms);

          const sign = PI_PLUS_SIGN[op];
          if (sign !== undefined) {
            const result = ce._fn(op, [remaining]);
            return {
              value: sign === 1 ? result : result.neg(),
              because: `${op}(π + x) -> ${sign === 1 ? '' : '-'}${op}(x)`,
            };
          }
        }
      }
    }

    // Co-function identities: f(π/2 - x) -> g(x)
    // Handle both Subtract form and canonical Add form (Add(Negate(x), π/2))
    if (isFunction(arg) && arg.operator === 'Subtract') {
      const left = arg.op1;
      const right = arg.op2;

      // Check if left is π/2
      let isPiOver2 = false;
      if (
        isFunction(left) &&
        left.operator === 'Divide' &&
        sym(left.op1) === 'Pi' &&
        left.op2?.is(2)
      ) {
        isPiOver2 = true;
      }

      if (isPiOver2 && right) {
        const coFunc = COFUNCTION_MAP[op];
        if (coFunc) {
          return {
            value: ce._fn(coFunc, [right]),
            because: `${op}(π/2 - x) -> ${coFunc}(x)`,
          };
        }
      }
    }

    // Handle canonical form: Add(Negate(x), Multiply(1/2, Pi)) = π/2 - x
    if (isFunction(arg) && arg.operator === 'Add' && arg.nops === 2) {
      const argOps = arg.ops;
      let piOver2Term: Expression | null = null;
      let negatedTerm: Expression | null = null;

      for (const term of argOps) {
        // Check for π/2 term: Multiply(1/2, Pi) or Multiply(Rational(1,2), Pi)
        if (
          isFunction(term) &&
          term.operator === 'Multiply' &&
          term.nops === 2
        ) {
          const [coef, symExpr] = [term.op1, term.op2];
          if (sym(symExpr) === 'Pi') {
            // Check if coefficient is 1/2 using .re for numeric comparison
            const coefRe = coef?.re;
            if (typeof coefRe === 'number' && Math.abs(coefRe - 0.5) < 1e-10) {
              piOver2Term = term;
            }
          }
        }
        // Check for negated term: Negate(x)
        if (isFunction(term) && term.operator === 'Negate' && term.op1) {
          negatedTerm = term.op1;
        }
      }

      if (piOver2Term && negatedTerm) {
        const coFunc = COFUNCTION_MAP[op];
        if (coFunc) {
          return {
            value: ce._fn(coFunc, [negatedTerm]),
            because: `${op}(π/2 - x) -> ${coFunc}(x)`,
          };
        }
      }
    }

    // Trigonometric periodicity reduction for multiples of π
    if (arg.operator === 'Add') {
      const reduced = reduceTrigPeriodicity(
        op as 'Sin' | 'Cos' | 'Tan' | 'Cot' | 'Sec' | 'Csc',
        arg,
        ce
      );
      if (reduced) {
        return { value: reduced, because: `${op} periodicity reduction` };
      }
    }
  }

  // Inverse trig with infinity
  if (INVERSE_TRIG.has(op)) {
    if (!isFunction(x)) return undefined;
    const arg = x.op1;
    if (!arg) return undefined;

    // Arcsin/Arccos with infinity -> NaN
    if (op === 'Arcsin' || op === 'Arccos') {
      if (arg.isInfinity === true) {
        return { value: ce.NaN, because: `${op}(infinity) -> NaN` };
      }
    }

    // Arctan with infinity -> ±π/2
    if (op === 'Arctan') {
      if (arg.isInfinity === true && arg.isPositive === true) {
        return { value: ce.Pi.div(2), because: 'arctan(+inf) -> π/2' };
      }
      if (arg.isInfinity === true && arg.isNegative === true) {
        return { value: ce.Pi.div(-2), because: 'arctan(-inf) -> -π/2' };
      }
    }

    // Arccot with infinity
    if (op === 'Arccot') {
      if (arg.isInfinity === true && arg.isPositive === true) {
        return { value: ce.Zero, because: 'arccot(+inf) -> 0' };
      }
      if (arg.isInfinity === true && arg.isNegative === true) {
        return { value: ce.Pi, because: 'arccot(-inf) -> π' };
      }
    }

    // Arcsec with infinity -> π/2
    if (op === 'Arcsec') {
      if (arg.isInfinity === true) {
        return { value: ce.Pi.div(2), because: 'arcsec(±inf) -> π/2' };
      }
    }

    // Arccsc with infinity -> 0
    if (op === 'Arccsc') {
      if (arg.isInfinity === true) {
        return { value: ce.Zero, because: 'arccsc(±inf) -> 0' };
      }
    }
  }

  // Product-to-sum identities
  if (op === 'Multiply' && isFunction(x)) {
    // Handle coefficient * sin(x) * cos(x) -> coefficient * sin(2x)/2
    // This includes the case of 2*sin(x)*cos(x) -> sin(2x)
    if (x.ops.length >= 2) {
      // Find sin and cos terms
      let sinTerm: (Expression & { op1: Expression }) | null = null;
      let cosTerm: (Expression & { op1: Expression }) | null = null;
      const otherTerms: Expression[] = [];

      for (const term of x.ops) {
        if (isFunction(term) && term.operator === 'Sin' && !sinTerm) {
          sinTerm = term;
        } else if (isFunction(term) && term.operator === 'Cos' && !cosTerm) {
          cosTerm = term;
        } else {
          otherTerms.push(term);
        }
      }

      // sin(x) * cos(x) with same argument -> coefficient * sin(2x)/2
      if (sinTerm && cosTerm) {
        const sinArg = sinTerm.op1;
        const cosArg = cosTerm.op1;
        if (sinArg?.isSame(cosArg)) {
          const sin2x = ce._fn('Sin', [sinArg.mul(2)]);
          if (otherTerms.length === 0) {
            // Plain sin(x)*cos(x) -> sin(2x)/2
            return {
              value: sin2x.div(2),
              because: 'sin(x)*cos(x) -> sin(2x)/2',
            };
          } else {
            // coefficient * sin(x) * cos(x) -> coefficient * sin(2x)/2
            // Special case: 2 * sin(x) * cos(x) -> sin(2x)
            const coefficient =
              otherTerms.length === 1
                ? otherTerms[0]
                : ce._fn('Multiply', otherTerms);
            if (coefficient.is(2)) {
              return {
                value: sin2x,
                because: '2*sin(x)*cos(x) -> sin(2x)',
              };
            }
            return {
              value: coefficient.mul(sin2x).div(2),
              because: 'c*sin(x)*cos(x) -> c*sin(2x)/2',
            };
          }
        }
      }
    }

    // Remaining product-to-sum identities (need exactly 2 operands)
    if (x.ops.length === 2) {
      const [a, b] = x.ops;

      // sin(x) * sin(y) -> (cos(x-y) - cos(x+y))/2
      if (
        isFunction(a) &&
        a.operator === 'Sin' &&
        isFunction(b) &&
        b.operator === 'Sin'
      ) {
        const argA = a.op1;
        const argB = b.op1;
        if (argA && argB) {
          return {
            value: ce
              ._fn('Cos', [argA.sub(argB)])
              .sub(ce._fn('Cos', [argA.add(argB)]))
              .div(2),
            because: 'sin(x)*sin(y) -> (cos(x-y)-cos(x+y))/2',
          };
        }
      }

      // cos(x) * cos(y) -> (cos(x-y) + cos(x+y))/2
      if (
        isFunction(a) &&
        a.operator === 'Cos' &&
        isFunction(b) &&
        b.operator === 'Cos'
      ) {
        const argA = a.op1;
        const argB = b.op1;
        if (argA && argB) {
          return {
            value: ce
              ._fn('Cos', [argA.sub(argB)])
              .add(ce._fn('Cos', [argA.add(argB)]))
              .div(2),
            because: 'cos(x)*cos(y) -> (cos(x-y)+cos(x+y))/2',
          };
        }
      }

      // tan(x) * cot(x) -> 1
      if (
        isFunction(a) &&
        a.operator === 'Tan' &&
        isFunction(b) &&
        b.operator === 'Cot'
      ) {
        const argA = a.op1;
        const argB = b.op1;
        if (argA?.isSame(argB)) {
          return { value: ce.One, because: 'tan(x)*cot(x) -> 1' };
        }
      }

      // cot(x) * tan(x) -> 1
      if (
        isFunction(a) &&
        a.operator === 'Cot' &&
        isFunction(b) &&
        b.operator === 'Tan'
      ) {
        const argA = a.op1;
        const argB = b.op1;
        if (argA?.isSame(argB)) {
          return { value: ce.One, because: 'cot(x)*tan(x) -> 1' };
        }
      }

      // Power reduction identities:
      // 2sin²(x) -> 1 - cos(2x)
      // 2cos²(x) -> 1 + cos(2x)
      if (a.is(2) && isFunction(b) && b.operator === 'Power' && b.op2?.is(2)) {
        const base = b.op1;
        if (isFunction(base) && base.operator === 'Sin' && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.sub(cos2x),
            because: '2sin²(x) -> 1 - cos(2x)',
          };
        }
        if (isFunction(base) && base.operator === 'Cos' && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.add(cos2x),
            because: '2cos²(x) -> 1 + cos(2x)',
          };
        }
      }
      // Also check reversed order (Power first, then 2)
      if (b.is(2) && isFunction(a) && a.operator === 'Power' && a.op2?.is(2)) {
        const base = a.op1;
        if (isFunction(base) && base.operator === 'Sin' && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.sub(cos2x),
            because: '2sin²(x) -> 1 - cos(2x)',
          };
        }
        if (isFunction(base) && base.operator === 'Cos' && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.add(cos2x),
            because: '2cos²(x) -> 1 + cos(2x)',
          };
        }
      }
    }
  }

  // Pythagorean identities
  if (op === 'Add' && isFunction(x) && x.ops.length === 2) {
    const [a, b] = x.ops;

    // sin²(x) + cos²(x) -> 1
    if (
      isFunction(a) &&
      a.operator === 'Power' &&
      isFunction(b) &&
      b.operator === 'Power' &&
      a.op2?.is(2) &&
      b.op2?.is(2)
    ) {
      const aBase = a.op1;
      const bBase = b.op1;
      const sinArg =
        isFunction(aBase) && aBase.operator === 'Sin' ? aBase.op1 : null;
      const cosArg =
        isFunction(bBase) && bBase.operator === 'Cos' ? bBase.op1 : null;

      if (sinArg && cosArg && sinArg.isSame(cosArg)) {
        return { value: ce.One, because: 'sin²(x) + cos²(x) -> 1' };
      }

      // Also check reversed order
      const sinArg2 =
        isFunction(bBase) && bBase.operator === 'Sin' ? bBase.op1 : null;
      const cosArg2 =
        isFunction(aBase) && aBase.operator === 'Cos' ? aBase.op1 : null;

      if (sinArg2 && cosArg2 && sinArg2.isSame(cosArg2)) {
        return { value: ce.One, because: 'cos²(x) + sin²(x) -> 1' };
      }
    }

    // tan²(x) + 1 -> sec²(x) and 1 + tan²(x) -> sec²(x)
    // (one operand is Power, the other is 1)
    if (isFunction(a) && a.operator === 'Power' && a.op2?.is(2) && b.is(1)) {
      if (isFunction(a.op1) && a.op1.operator === 'Tan') {
        return {
          value: ce._fn('Sec', [a.op1.op1]).pow(2),
          because: 'tan²(x) + 1 -> sec²(x)',
        };
      }
    }
    if (isFunction(b) && b.operator === 'Power' && b.op2?.is(2) && a.is(1)) {
      if (isFunction(b.op1) && b.op1.operator === 'Tan') {
        return {
          value: ce._fn('Sec', [b.op1.op1]).pow(2),
          because: '1 + tan²(x) -> sec²(x)',
        };
      }
    }

    // 1 + cot²(x) -> csc²(x) and cot²(x) + 1 -> csc²(x)
    if (isFunction(a) && a.operator === 'Power' && a.op2?.is(2) && b.is(1)) {
      if (isFunction(a.op1) && a.op1.operator === 'Cot') {
        return {
          value: ce._fn('Csc', [a.op1.op1]).pow(2),
          because: 'cot²(x) + 1 -> csc²(x)',
        };
      }
    }
    if (isFunction(b) && b.operator === 'Power' && b.op2?.is(2) && a.is(1)) {
      if (isFunction(b.op1) && b.op1.operator === 'Cot') {
        return {
          value: ce._fn('Csc', [b.op1.op1]).pow(2),
          because: '1 + cot²(x) -> csc²(x)',
        };
      }
    }

    // a*sin²(x) + a*cos²(x) -> a (with coefficient)
    if (
      isFunction(a) &&
      a.operator === 'Multiply' &&
      isFunction(b) &&
      b.operator === 'Multiply'
    ) {
      // Extract coefficient and trig functions
      const extractCoeffAndTrig = (expr: Expression) => {
        if (
          !isFunction(expr) ||
          expr.operator !== 'Multiply' ||
          expr.ops.length !== 2
        )
          return null;
        const [c, p] = expr.ops;
        if (
          isFunction(p) &&
          p.operator === 'Power' &&
          p.op2?.is(2) &&
          isFunction(p.op1) &&
          (p.op1.operator === 'Sin' || p.op1.operator === 'Cos')
        ) {
          return { coeff: c, trigFunc: p.op1.operator, trigArg: p.op1.op1 };
        }
        // Try reversed
        if (
          isFunction(c) &&
          c.operator === 'Power' &&
          c.op2?.is(2) &&
          isFunction(c.op1) &&
          (c.op1.operator === 'Sin' || c.op1.operator === 'Cos')
        ) {
          return { coeff: p, trigFunc: c.op1.operator, trigArg: c.op1.op1 };
        }
        return null;
      };

      const infoA = extractCoeffAndTrig(a);
      const infoB = extractCoeffAndTrig(b);

      if (
        infoA &&
        infoB &&
        infoA.coeff.isSame(infoB.coeff) &&
        infoA.trigArg?.isSame(infoB.trigArg) &&
        ((infoA.trigFunc === 'Sin' && infoB.trigFunc === 'Cos') ||
          (infoA.trigFunc === 'Cos' && infoB.trigFunc === 'Sin'))
      ) {
        return {
          value: infoA.coeff,
          because: 'a*sin²(x) + a*cos²(x) -> a',
        };
      }
    }
  }

  // 1 - sin²(x) -> cos²(x) and similar subtractions
  // These are canonicalized as Add expressions:
  // - "1 - sin²(x)" becomes Add(Negate(Power(Sin(x), 2)), 1) or Add(1, Negate(Power(Sin(x), 2)))
  // - "sin²(x) - 1" becomes Add(Power(Sin(x), 2), -1)
  if (op === 'Add' && isFunction(x) && x.ops.length === 2) {
    const [a, b] = x.ops;

    // Check for "1 + Negate(sin²(x))" or "Negate(sin²(x)) + 1" pattern (1 - sin²(x))
    // Find the "1" and the negated trig squared term
    let one: Expression | null = null;
    let negatedTrigSquared: Expression | null = null;

    if (a.is(1) && isFunction(b) && b.operator === 'Negate') {
      one = a;
      negatedTrigSquared = b.op1;
    } else if (b.is(1) && isFunction(a) && a.operator === 'Negate') {
      one = b;
      negatedTrigSquared = a.op1;
    }

    if (one && negatedTrigSquared) {
      // Check if it's a squared trig function
      if (
        isFunction(negatedTrigSquared) &&
        negatedTrigSquared.operator === 'Power' &&
        negatedTrigSquared.op2?.is(2)
      ) {
        const base = negatedTrigSquared.op1;
        // 1 - sin²(x) -> cos²(x)
        if (isFunction(base) && base.operator === 'Sin') {
          return {
            value: ce._fn('Cos', [base.op1]).pow(2),
            because: '1 - sin²(x) -> cos²(x)',
          };
        }
        // 1 - cos²(x) -> sin²(x)
        if (isFunction(base) && base.operator === 'Cos') {
          return {
            value: ce._fn('Sin', [base.op1]).pow(2),
            because: '1 - cos²(x) -> sin²(x)',
          };
        }
      }
    }

    // Check for "sin²(x) + (-1)" or "(-1) + sin²(x)" pattern (sin²(x) - 1)
    // This simplifies to -cos²(x)
    let negOne: Expression | null = null;
    let trigSquared: Expression | null = null;

    if (a.is(-1) && isFunction(b) && b.operator === 'Power' && b.op2?.is(2)) {
      negOne = a;
      trigSquared = b;
    } else if (
      b.is(-1) &&
      isFunction(a) &&
      a.operator === 'Power' &&
      a.op2?.is(2)
    ) {
      negOne = b;
      trigSquared = a;
    }

    if (negOne && trigSquared && isFunction(trigSquared)) {
      const base = trigSquared.op1;
      // sin²(x) - 1 -> -cos²(x)
      if (isFunction(base) && base.operator === 'Sin') {
        return {
          value: ce._fn('Cos', [base.op1]).pow(2).neg(),
          because: 'sin²(x) - 1 -> -cos²(x)',
        };
      }
      // cos²(x) - 1 -> -sin²(x)
      if (isFunction(base) && base.operator === 'Cos') {
        return {
          value: ce._fn('Sin', [base.op1]).pow(2).neg(),
          because: 'cos²(x) - 1 -> -sin²(x)',
        };
      }
      // sec²(x) - 1 -> tan²(x)
      if (isFunction(base) && base.operator === 'Sec') {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (isFunction(base) && base.operator === 'Csc') {
        return {
          value: ce._fn('Cot', [base.op1]).pow(2),
          because: 'csc²(x) - 1 -> cot²(x)',
        };
      }
    }

    // Check for "-1 + sec²(x)" pattern (sec²(x) - 1)
    // Also handle Negate(1) which is -1
    let negOneAlt: Expression | null = null;
    let secOrCscSquared: Expression | null = null;

    if (
      isFunction(a) &&
      a.operator === 'Negate' &&
      a.op1?.is(1) &&
      isFunction(b) &&
      b.operator === 'Power' &&
      b.op2?.is(2)
    ) {
      negOneAlt = a;
      secOrCscSquared = b;
    } else if (
      isFunction(b) &&
      b.operator === 'Negate' &&
      b.op1?.is(1) &&
      isFunction(a) &&
      a.operator === 'Power' &&
      a.op2?.is(2)
    ) {
      negOneAlt = b;
      secOrCscSquared = a;
    }

    if (negOneAlt && secOrCscSquared && isFunction(secOrCscSquared)) {
      const base = secOrCscSquared.op1;
      // sec²(x) - 1 -> tan²(x)
      if (isFunction(base) && base.operator === 'Sec') {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (isFunction(base) && base.operator === 'Csc') {
        return {
          value: ce._fn('Cot', [base.op1]).pow(2),
          because: 'csc²(x) - 1 -> cot²(x)',
        };
      }
    }

    // Check for "-sin²(x) + -cos²(x)" pattern -> -1
    if (
      isFunction(a) &&
      a.operator === 'Negate' &&
      isFunction(b) &&
      b.operator === 'Negate'
    ) {
      const aInner = a.op1;
      const bInner = b.op1;
      if (
        isFunction(aInner) &&
        aInner.operator === 'Power' &&
        aInner.op2?.is(2) &&
        isFunction(bInner) &&
        bInner.operator === 'Power' &&
        bInner.op2?.is(2)
      ) {
        const aBase = aInner.op1;
        const bBase = bInner.op1;
        // -sin²(x) + -cos²(x) -> -1
        if (
          isFunction(aBase) &&
          isFunction(bBase) &&
          ((aBase.operator === 'Sin' && bBase.operator === 'Cos') ||
            (aBase.operator === 'Cos' && bBase.operator === 'Sin')) &&
          aBase.op1?.isSame(bBase.op1)
        ) {
          return { value: ce.NegativeOne, because: '-sin²(x) - cos²(x) -> -1' };
        }
      }
    }
  }

  // Note: arcsin(x) -> arctan2(...) conversion is an expansion, not included
  // here to preserve function identity for |arcsin(x)| -> arcsin(|x|).

  return undefined;
}
