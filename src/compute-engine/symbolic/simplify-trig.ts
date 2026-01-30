import type { BoxedExpression, ComputeEngine, RuleStep } from '../global-types';
import { add } from '../boxed-expression/arithmetic-add';

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
const TRIG_FUNCS = new Set([
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
]);

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
  arg: BoxedExpression,
  ce: ComputeEngine
): BoxedExpression | null {
  // Only handle Add expressions
  if (arg.operator !== 'Add' || !arg.ops) return null;

  const terms = arg.ops;

  // Find a term that is a multiple of π
  let piCoeff: number | null = null;
  let piTermIndex = -1;

  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];

    // Check for plain Pi
    if (term.symbol === 'Pi') {
      piCoeff = 1;
      piTermIndex = i;
      break;
    }

    // Check for n * Pi or Pi * n
    if (term.operator === 'Multiply' && term.ops) {
      const termOps = term.ops;
      // Look for Pi among the factors
      const piIndex = termOps.findIndex((op) => op.symbol === 'Pi');
      if (piIndex >= 0) {
        // Get the coefficient (product of all other factors)
        const otherFactors = termOps.filter((_, idx) => idx !== piIndex);
        if (otherFactors.length === 1) {
          const n = otherFactors[0].numericValue;
          if (typeof n === 'number' && Number.isInteger(n)) {
            piCoeff = n;
            piTermIndex = i;
            break;
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
    if (term.operator === 'Negate' && term.op1?.symbol === 'Pi') {
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
  let newArg: BoxedExpression;
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

export function simplifyTrig(x: BoxedExpression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle basic trig functions
  if (TRIG_FUNCS.has(op)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Trig with infinity -> NaN
    if (arg.isInfinity === true) {
      return { value: ce.NaN, because: `${op}(infinity) -> NaN` };
    }

    // Odd/even function properties with negation
    if (arg.operator === 'Negate') {
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
    if (arg.operator === 'Subtract') {
      const left = arg.op1;
      const right = arg.op2;
      if (left?.symbol === 'Pi' && right) {
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
    if (arg.operator === 'Add' && arg.ops) {
      // Check if Pi is one of the operands
      const piIndex = arg.ops.findIndex((op) => op.symbol === 'Pi');
      if (piIndex >= 0) {
        const otherTerms = arg.ops.filter((_, idx) => idx !== piIndex);

        // Only handle simple case: Pi + x (not n*Pi + x)
        if (otherTerms.length === arg.ops.length - 1) {
          const remaining =
            otherTerms.length === 1
              ? otherTerms[0]
              : ce._fn('Add', otherTerms);

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
    if (arg.operator === 'Subtract') {
      const left = arg.op1;
      const right = arg.op2;

      // Check if left is π/2
      let isPiOver2 = false;
      if (
        left?.operator === 'Divide' &&
        left.op1?.symbol === 'Pi' &&
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
      if (arg.symbol === 'PositiveInfinity') {
        return { value: ce.Pi.div(2), because: 'arctan(+inf) -> π/2' };
      }
      if (arg.symbol === 'NegativeInfinity') {
        return { value: ce.Pi.div(-2), because: 'arctan(-inf) -> -π/2' };
      }
    }

    // Arccot with infinity
    if (op === 'Arccot') {
      if (arg.symbol === 'PositiveInfinity') {
        return { value: ce.Zero, because: 'arccot(+inf) -> 0' };
      }
      if (arg.symbol === 'NegativeInfinity') {
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
  if (op === 'Multiply' && x.ops && x.ops.length === 2) {
    const [a, b] = x.ops;

    // sin(x) * cos(x) -> sin(2x)/2
    if (a.operator === 'Sin' && b.operator === 'Cos') {
      const argA = a.op1;
      const argB = b.op1;
      if (argA?.isSame(argB)) {
        return {
          value: ce._fn('Sin', [argA.mul(2)]).div(2),
          because: 'sin(x)*cos(x) -> sin(2x)/2',
        };
      }
    }

    // cos(x) * sin(x) -> sin(2x)/2
    if (a.operator === 'Cos' && b.operator === 'Sin') {
      const argA = a.op1;
      const argB = b.op1;
      if (argA?.isSame(argB)) {
        return {
          value: ce._fn('Sin', [argA.mul(2)]).div(2),
          because: 'cos(x)*sin(x) -> sin(2x)/2',
        };
      }
    }

    // sin(x) * sin(y) -> (cos(x-y) - cos(x+y))/2
    if (a.operator === 'Sin' && b.operator === 'Sin') {
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
    if (a.operator === 'Cos' && b.operator === 'Cos') {
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
    if (a.operator === 'Tan' && b.operator === 'Cot') {
      const argA = a.op1;
      const argB = b.op1;
      if (argA?.isSame(argB)) {
        return { value: ce.One, because: 'tan(x)*cot(x) -> 1' };
      }
    }

    // cot(x) * tan(x) -> 1
    if (a.operator === 'Cot' && b.operator === 'Tan') {
      const argA = a.op1;
      const argB = b.op1;
      if (argA?.isSame(argB)) {
        return { value: ce.One, because: 'cot(x)*tan(x) -> 1' };
      }
    }
  }

  // Pythagorean identities
  if (op === 'Add' && x.ops && x.ops.length === 2) {
    const [a, b] = x.ops;

    // sin²(x) + cos²(x) -> 1
    if (
      a.operator === 'Power' &&
      b.operator === 'Power' &&
      a.op2?.is(2) &&
      b.op2?.is(2)
    ) {
      const sinArg =
        a.op1?.operator === 'Sin' ? a.op1.op1 : null;
      const cosArg =
        b.op1?.operator === 'Cos' ? b.op1.op1 : null;

      if (sinArg && cosArg && sinArg.isSame(cosArg)) {
        return { value: ce.One, because: 'sin²(x) + cos²(x) -> 1' };
      }

      // Also check reversed order
      const sinArg2 =
        b.op1?.operator === 'Sin' ? b.op1.op1 : null;
      const cosArg2 =
        a.op1?.operator === 'Cos' ? a.op1.op1 : null;

      if (sinArg2 && cosArg2 && sinArg2.isSame(cosArg2)) {
        return { value: ce.One, because: 'cos²(x) + sin²(x) -> 1' };
      }
    }

    // tan²(x) + 1 -> sec²(x) and 1 + tan²(x) -> sec²(x)
    // (one operand is Power, the other is 1)
    if (a.operator === 'Power' && a.op2?.is(2) && b.is(1)) {
      if (a.op1?.operator === 'Tan') {
        return {
          value: ce._fn('Sec', [a.op1.op1]).pow(2),
          because: 'tan²(x) + 1 -> sec²(x)',
        };
      }
    }
    if (b.operator === 'Power' && b.op2?.is(2) && a.is(1)) {
      if (b.op1?.operator === 'Tan') {
        return {
          value: ce._fn('Sec', [b.op1.op1]).pow(2),
          because: '1 + tan²(x) -> sec²(x)',
        };
      }
    }

    // 1 + cot²(x) -> csc²(x) and cot²(x) + 1 -> csc²(x)
    if (a.operator === 'Power' && a.op2?.is(2) && b.is(1)) {
      if (a.op1?.operator === 'Cot') {
        return {
          value: ce._fn('Csc', [a.op1.op1]).pow(2),
          because: 'cot²(x) + 1 -> csc²(x)',
        };
      }
    }
    if (b.operator === 'Power' && b.op2?.is(2) && a.is(1)) {
      if (b.op1?.operator === 'Cot') {
        return {
          value: ce._fn('Csc', [b.op1.op1]).pow(2),
          because: '1 + cot²(x) -> csc²(x)',
        };
      }
    }

    // a*sin²(x) + a*cos²(x) -> a (with coefficient)
    if (a.operator === 'Multiply' && b.operator === 'Multiply') {
      // Extract coefficient and trig functions
      const extractCoeffAndTrig = (expr: BoxedExpression) => {
        if (
          expr.operator !== 'Multiply' ||
          !expr.ops ||
          expr.ops.length !== 2
        )
          return null;
        const [c, p] = expr.ops;
        if (
          p.operator === 'Power' &&
          p.op2?.is(2) &&
          (p.op1?.operator === 'Sin' || p.op1?.operator === 'Cos')
        ) {
          return { coeff: c, trigFunc: p.op1.operator, trigArg: p.op1.op1 };
        }
        // Try reversed
        if (
          c.operator === 'Power' &&
          c.op2?.is(2) &&
          (c.op1?.operator === 'Sin' || c.op1?.operator === 'Cos')
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
  if (op === 'Add' && x.ops && x.ops.length === 2) {
    const [a, b] = x.ops;

    // Check for "1 + Negate(sin²(x))" or "Negate(sin²(x)) + 1" pattern (1 - sin²(x))
    // Find the "1" and the negated trig squared term
    let one: BoxedExpression | null = null;
    let negatedTrigSquared: BoxedExpression | null = null;

    if (a.is(1) && b.operator === 'Negate') {
      one = a;
      negatedTrigSquared = b.op1;
    } else if (b.is(1) && a.operator === 'Negate') {
      one = b;
      negatedTrigSquared = a.op1;
    }

    if (one && negatedTrigSquared) {
      // Check if it's a squared trig function
      if (
        negatedTrigSquared.operator === 'Power' &&
        negatedTrigSquared.op2?.is(2)
      ) {
        const base = negatedTrigSquared.op1;
        // 1 - sin²(x) -> cos²(x)
        if (base?.operator === 'Sin') {
          return {
            value: ce._fn('Cos', [base.op1]).pow(2),
            because: '1 - sin²(x) -> cos²(x)',
          };
        }
        // 1 - cos²(x) -> sin²(x)
        if (base?.operator === 'Cos') {
          return {
            value: ce._fn('Sin', [base.op1]).pow(2),
            because: '1 - cos²(x) -> sin²(x)',
          };
        }
      }
    }

    // Check for "sin²(x) + (-1)" or "(-1) + sin²(x)" pattern (sin²(x) - 1)
    // This simplifies to -cos²(x)
    let negOne: BoxedExpression | null = null;
    let trigSquared: BoxedExpression | null = null;

    if (a.is(-1) && b.operator === 'Power' && b.op2?.is(2)) {
      negOne = a;
      trigSquared = b;
    } else if (b.is(-1) && a.operator === 'Power' && a.op2?.is(2)) {
      negOne = b;
      trigSquared = a;
    }

    if (negOne && trigSquared) {
      const base = trigSquared.op1;
      // sin²(x) - 1 -> -cos²(x)
      if (base?.operator === 'Sin') {
        return {
          value: ce._fn('Cos', [base.op1]).pow(2).neg(),
          because: 'sin²(x) - 1 -> -cos²(x)',
        };
      }
      // cos²(x) - 1 -> -sin²(x)
      if (base?.operator === 'Cos') {
        return {
          value: ce._fn('Sin', [base.op1]).pow(2).neg(),
          because: 'cos²(x) - 1 -> -sin²(x)',
        };
      }
      // sec²(x) - 1 -> tan²(x)
      if (base?.operator === 'Sec') {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (base?.operator === 'Csc') {
        return {
          value: ce._fn('Cot', [base.op1]).pow(2),
          because: 'csc²(x) - 1 -> cot²(x)',
        };
      }
    }

    // Check for "-1 + sec²(x)" pattern (sec²(x) - 1)
    // Also handle Negate(1) which is -1
    let negOneAlt: BoxedExpression | null = null;
    let secOrCscSquared: BoxedExpression | null = null;

    if (
      a.operator === 'Negate' &&
      a.op1?.is(1) &&
      b.operator === 'Power' &&
      b.op2?.is(2)
    ) {
      negOneAlt = a;
      secOrCscSquared = b;
    } else if (
      b.operator === 'Negate' &&
      b.op1?.is(1) &&
      a.operator === 'Power' &&
      a.op2?.is(2)
    ) {
      negOneAlt = b;
      secOrCscSquared = a;
    }

    if (negOneAlt && secOrCscSquared) {
      const base = secOrCscSquared.op1;
      // sec²(x) - 1 -> tan²(x)
      if (base?.operator === 'Sec') {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (base?.operator === 'Csc') {
        return {
          value: ce._fn('Cot', [base.op1]).pow(2),
          because: 'csc²(x) - 1 -> cot²(x)',
        };
      }
    }

    // Check for "-sin²(x) + -cos²(x)" pattern -> -1
    if (a.operator === 'Negate' && b.operator === 'Negate') {
      const aInner = a.op1;
      const bInner = b.op1;
      if (
        aInner?.operator === 'Power' &&
        aInner.op2?.is(2) &&
        bInner?.operator === 'Power' &&
        bInner.op2?.is(2)
      ) {
        const aBase = aInner.op1;
        const bBase = bInner.op1;
        // -sin²(x) + -cos²(x) -> -1
        if (
          ((aBase?.operator === 'Sin' && bBase?.operator === 'Cos') ||
            (aBase?.operator === 'Cos' && bBase?.operator === 'Sin')) &&
          aBase?.op1?.isSame(bBase?.op1)
        ) {
          return { value: ce.NegativeOne, because: '-sin²(x) - cos²(x) -> -1' };
        }
      }
    }
  }

  // Arcsin(x) -> 2 * Arctan2(x, 1 + sqrt(1 - x²))
  if (op === 'Arcsin') {
    const arg = x.op1;
    if (arg) {
      return {
        value: ce
          ._fn('Arctan2', [
            arg,
            ce.One.add(ce._fn('Sqrt', [ce.One.sub(arg.pow(2))])),
          ])
          .mul(2),
        because: 'arcsin(x) -> 2*arctan2(x, 1+sqrt(1-x²))',
      };
    }
  }

  return undefined;
}
