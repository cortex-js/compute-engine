import type {
  Expression,
  IComputeEngine as ComputeEngine,
  RuleStep,
} from '../global-types.js';
import { add } from '../boxed-expression/arithmetic-add.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';

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

// Quarter-period cofunction shift: f(θ + π/2) = sign * g(θ).
// - sin(θ+π/2) = cos(θ),   cos(θ+π/2) = -sin(θ)
// - tan(θ+π/2) = -cot(θ),  cot(θ+π/2) = -tan(θ)
// - sec(θ+π/2) = -csc(θ),  csc(θ+π/2) = sec(θ)
// (CE already reduces π±x and the π/2−x reflection; this is the missing
// +π/2 sibling — also the form Rubi's cosine→sine normalization emits.)
const PI_HALF_PLUS: Record<string, { fn: string; sign: number }> = {
  Sin: { fn: 'Cos', sign: 1 },
  Cos: { fn: 'Sin', sign: -1 },
  Tan: { fn: 'Cot', sign: -1 },
  Cot: { fn: 'Tan', sign: -1 },
  Sec: { fn: 'Csc', sign: -1 },
  Csc: { fn: 'Sec', sign: 1 },
};

/**
 * If `arg` is a *provable integer* multiple of π — `c·π` with `c.isInteger` —
 * return the symbolic coefficient `c`; otherwise null. Restricted to symbolic
 * coefficients (`!isNumber(c)`): plain numeric multiples (e.g. `Cos(2π)`) are
 * already reduced by constructible/numeric evaluation, so this fills only the
 * symbolic gap (e.g. `Cos(πk)` for integer `k`).
 */
function integerPiCoefficient(
  arg: Expression,
  ce: ComputeEngine
): Expression | null {
  if (sym(arg) === 'Pi') return null; // bare π is the numeric case (c = 1)
  if (isFunction(arg, 'Negate') && sym(arg.op1) === 'Pi') return null; // c = -1
  if (isFunction(arg, 'Multiply')) {
    const piIndex = arg.ops.findIndex((op) => sym(op) === 'Pi');
    if (piIndex < 0) return null;
    const others = arg.ops.filter((_, idx) => idx !== piIndex);
    if (others.length === 0) return null;
    const coeff = others.length === 1 ? others[0] : ce._fn('Multiply', others);
    if (coeff.isInteger === true && !isNumber(coeff)) return coeff;
  }
  return null;
}

/** True if `t` is the constant π/2 (canonical `(1/2)·Pi` or `Pi/2`). */
function isPiOverTwo(t: Expression | undefined): boolean {
  if (!t) return false;
  if (isFunction(t, 'Divide') && sym(t.op1) === 'Pi' && t.op2?.isSame(2))
    return true;
  if (isFunction(t, 'Multiply') && t.nops === 2) {
    const other =
      sym(t.op1) === 'Pi' ? t.op2 : sym(t.op2) === 'Pi' ? t.op1 : undefined;
    const r = other?.re;
    return typeof r === 'number' && Math.abs(r - 0.5) < 1e-10;
  }
  return false;
}

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
  if (!isFunction(arg, 'Add')) return null;

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
    if (isFunction(term, 'Multiply')) {
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
    if (isFunction(term, 'Negate') && sym(term.op1) === 'Pi') {
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
      remainingTerms.push(ce.expr(['Multiply', reduced, 'Pi']));
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

  return ce.expr([fn, newArg]);
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
    if (isFunction(arg, 'Negate')) {
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
    if (isFunction(arg, 'Subtract')) {
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
    if (isFunction(arg, 'Add')) {
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
    if (isFunction(arg, 'Subtract')) {
      const left = arg.op1;
      const right = arg.op2;

      // Check if left is π/2
      let isPiOver2 = false;
      if (
        isFunction(left, 'Divide') &&
        sym(left.op1) === 'Pi' &&
        left.op2?.isSame(2)
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
    if (isFunction(arg, 'Add') && arg.nops === 2) {
      const argOps = arg.ops;
      let piOver2Term: Expression | null = null;
      let negatedTerm: Expression | null = null;

      for (const term of argOps) {
        // Check for π/2 term: Multiply(1/2, Pi) or Multiply(Rational(1,2), Pi)
        if (isFunction(term, 'Multiply') && term.nops === 2) {
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
        if (isFunction(term, 'Negate') && term.op1) {
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

    // θ + π/2 cofunction shift: f(θ + π/2) -> ±g(θ). Handles the canonical
    // Add form (e.g. `x + (1/2)·Pi`). The π/2 − x reflection above already
    // consumed the negated-term case; here the remaining term(s) are θ.
    if (isFunction(arg, 'Add')) {
      const piHalfIndex = arg.ops.findIndex((t) => isPiOverTwo(t));
      if (piHalfIndex >= 0) {
        const map = PI_HALF_PLUS[op];
        if (map) {
          const otherTerms = arg.ops.filter((_, idx) => idx !== piHalfIndex);
          if (otherTerms.length > 0) {
            const theta =
              otherTerms.length === 1
                ? otherTerms[0]
                : ce._fn('Add', otherTerms);
            const result = ce._fn(map.fn, [theta]);
            return {
              value: map.sign === 1 ? result : result.neg(),
              because: `${op}(θ + π/2) -> ${map.sign === 1 ? '' : '-'}${map.fn}(θ)`,
            };
          }
        }
      }
    }

    // Integer multiples of π: Sin(c·π) -> 0, Cos(c·π) -> (-1)^c for a
    // provable (symbolic) integer c. This is the reduction the +π/2 cofunction
    // shift above feeds into: Sin(πk + π/2) -> Cos(πk) -> (-1)^k.
    if (op === 'Sin' || op === 'Cos') {
      const c = integerPiCoefficient(arg, ce);
      if (c) {
        if (op === 'Sin') return { value: ce.Zero, because: 'Sin(c·π) -> 0' };
        return {
          value: ce._fn('Power', [ce.NegativeOne, c]),
          because: 'Cos(c·π) -> (-1)^c',
        };
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
        if (isFunction(term, 'Sin') && !sinTerm) {
          sinTerm = term;
        } else if (isFunction(term, 'Cos') && !cosTerm) {
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
            if (coefficient.isSame(2)) {
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
      if (isFunction(a, 'Sin') && isFunction(b) && b.operator === 'Sin') {
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
      if (isFunction(a, 'Cos') && isFunction(b) && b.operator === 'Cos') {
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
      if (isFunction(a, 'Tan') && isFunction(b) && b.operator === 'Cot') {
        const argA = a.op1;
        const argB = b.op1;
        if (argA?.isSame(argB)) {
          return { value: ce.One, because: 'tan(x)*cot(x) -> 1' };
        }
      }

      // cot(x) * tan(x) -> 1
      if (isFunction(a, 'Cot') && isFunction(b) && b.operator === 'Tan') {
        const argA = a.op1;
        const argB = b.op1;
        if (argA?.isSame(argB)) {
          return { value: ce.One, because: 'cot(x)*tan(x) -> 1' };
        }
      }

      // Power reduction identities:
      // 2sin²(x) -> 1 - cos(2x)
      // 2cos²(x) -> 1 + cos(2x)
      if (a.isSame(2) && isFunction(b, 'Power') && b.op2?.isSame(2)) {
        const base = b.op1;
        if (isFunction(base, 'Sin') && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.sub(cos2x),
            because: '2sin²(x) -> 1 - cos(2x)',
          };
        }
        if (isFunction(base, 'Cos') && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.add(cos2x),
            because: '2cos²(x) -> 1 + cos(2x)',
          };
        }
      }
      // Also check reversed order (Power first, then 2)
      if (b.isSame(2) && isFunction(a, 'Power') && a.op2?.isSame(2)) {
        const base = a.op1;
        if (isFunction(base, 'Sin') && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.sub(cos2x),
            because: '2sin²(x) -> 1 - cos(2x)',
          };
        }
        if (isFunction(base, 'Cos') && base.op1) {
          const cos2x = ce._fn('Cos', [base.op1.mul(2)]);
          return {
            value: ce.One.add(cos2x),
            because: '2cos²(x) -> 1 + cos(2x)',
          };
        }
      }
    }
  }

  // Pythagorean identities.
  //
  // Pairwise scan keyed on the trig argument: a matching pair (sin²/cos² of
  // the same argument, tan²/cot² with a literal 1, or a·sin²/a·cos² with the
  // same coefficient) is combined and the *rest* of the sum kept, so the
  // identity fires even inside a larger n-ary sum (e.g. `sin²x + cos²x + y`
  // -> `1 + y`, not just the exactly-two-term case). Mirrors the
  // collect-then-combine shape of the ln/log combine in simplify-log.ts.
  if (op === 'Add' && isFunction(x) && x.ops.length >= 2) {
    const ops = x.ops;

    // A bare squared trig term `f(u)²` -> { fn, arg: u }.
    const squaredTrig = (
      term: Expression
    ): { fn: string; arg: Expression } | null => {
      if (isFunction(term, 'Power') && term.op2?.isSame(2)) {
        const base = term.op1;
        if (isFunction(base) && TRIG_FUNCS.has(base.operator) && base.op1)
          return { fn: base.operator, arg: base.op1 };
      }
      return null;
    };

    // Build the result of combining the pair at indices `i`, `j` into
    // `replacement`, keeping every other operand of the sum.
    const combinePair = (
      i: number,
      j: number,
      replacement: Expression,
      because: string
    ): RuleStep => {
      const rest = ops.filter((_, k) => k !== i && k !== j);
      if (rest.length === 0) return { value: replacement, because };
      return { value: ce._fn('Add', [replacement, ...rest]), because };
    };

    // -- sin²(u) + cos²(u) -> 1
    for (let i = 0; i < ops.length; i++) {
      const ti = squaredTrig(ops[i]);
      if (!ti || (ti.fn !== 'Sin' && ti.fn !== 'Cos')) continue;
      const wantFn = ti.fn === 'Sin' ? 'Cos' : 'Sin';
      for (let j = 0; j < ops.length; j++) {
        if (j === i) continue;
        const tj = squaredTrig(ops[j]);
        if (!tj || tj.fn !== wantFn || !tj.arg.isSame(ti.arg)) continue;
        return combinePair(i, j, ce.One, 'sin²(x) + cos²(x) -> 1');
      }
    }

    // -- a·sin²(u) + a·cos²(u) -> a (same coefficient, same argument)
    const coeffSquaredTrig = (
      term: Expression
    ): { coeff: Expression; fn: string; arg: Expression } | null => {
      if (!isFunction(term, 'Multiply') || term.ops.length !== 2) return null;
      const [c, p] = term.ops;
      const fromPower = (
        pow: Expression,
        coeff: Expression
      ): { coeff: Expression; fn: string; arg: Expression } | null => {
        if (
          isFunction(pow, 'Power') &&
          pow.op2?.isSame(2) &&
          isFunction(pow.op1) &&
          (pow.op1.operator === 'Sin' || pow.op1.operator === 'Cos') &&
          pow.op1.op1
        )
          return { coeff, fn: pow.op1.operator, arg: pow.op1.op1 };
        return null;
      };
      return fromPower(p, c) ?? fromPower(c, p);
    };

    for (let i = 0; i < ops.length; i++) {
      const ti = coeffSquaredTrig(ops[i]);
      if (!ti) continue;
      const wantFn = ti.fn === 'Sin' ? 'Cos' : 'Sin';
      for (let j = 0; j < ops.length; j++) {
        if (j === i) continue;
        const tj = coeffSquaredTrig(ops[j]);
        if (
          !tj ||
          tj.fn !== wantFn ||
          !tj.arg.isSame(ti.arg) ||
          !tj.coeff.isSame(ti.coeff)
        )
          continue;
        return combinePair(i, j, ti.coeff, 'a*sin²(x) + a*cos²(x) -> a');
      }
    }

    // -- g·sin²(u) + g·cos²(u) -> g, for an arbitrary common factor g.
    //
    // Generalizes the two special cases above: the shared factor may itself be
    // a product (or a residual power of the same trig), so this reaches the
    // factored form `cos³x + cos x·sin²x` = `cos x·(cos²x + sin²x)` -> `cos x`,
    // which then cancels a trailing `−cos x` to 0. The rewrite `g·(cos²u +
    // sin²u) = g` is unconditionally valid, so it is always sound; requiring the
    // residual factor `g` to be structurally identical keeps it from firing on
    // mismatched terms.
    //
    // View a term as `rest · f(u)²` (f ∈ {Sin, Cos}) by peeling one squared
    // Sin/Cos factor. Enumerate every way this can be done for the term.
    const squareViews = (
      term: Expression
    ): { fn: string; arg: Expression; rest: Expression }[] => {
      const factors = isFunction(term, 'Multiply') ? term.ops : [term];
      const views: { fn: string; arg: Expression; rest: Expression }[] = [];
      for (let k = 0; k < factors.length; k++) {
        const f = factors[k];
        if (!isFunction(f, 'Power')) continue;
        const base = f.op1;
        const exp = f.op2;
        if (
          !isFunction(base) ||
          (base.operator !== 'Sin' && base.operator !== 'Cos') ||
          !base.op1
        )
          continue;
        if (exp?.isInteger !== true) continue;
        const n = exp.re;
        if (typeof n !== 'number' || n < 2) continue;
        // The factors left after removing f(u)², plus the residual power of the
        // squared trig itself (f(u)^(n-2)).
        const residualFactors = factors.filter((_, m) => m !== k);
        if (n === 3) residualFactors.push(base);
        else if (n > 3) residualFactors.push(ce._fn('Power', [base, ce.number(n - 2)]));
        const rest =
          residualFactors.length === 0
            ? ce.One
            : residualFactors.length === 1
              ? residualFactors[0]
              : ce._fn('Multiply', residualFactors);
        views.push({ fn: base.operator, arg: base.op1, rest });
      }
      return views;
    };

    for (let i = 0; i < ops.length; i++) {
      const vis = squareViews(ops[i]);
      if (vis.length === 0) continue;
      for (let j = 0; j < ops.length; j++) {
        if (j === i) continue;
        const vjs = squareViews(ops[j]);
        if (vjs.length === 0) continue;
        for (const vi of vis) {
          const wantFn = vi.fn === 'Sin' ? 'Cos' : 'Sin';
          const match = vjs.find(
            (vj) =>
              vj.fn === wantFn &&
              vj.arg.isSame(vi.arg) &&
              vj.rest.isSame(vi.rest)
          );
          if (match)
            return combinePair(i, j, vi.rest, 'g*sin²(x) + g*cos²(x) -> g');
        }
      }
    }

    // -- tan²(u) + 1 -> sec²(u); cot²(u) + 1 -> csc²(u) (needs a literal 1)
    const oneIndex = ops.findIndex((t) => t.isSame(1));
    if (oneIndex >= 0) {
      for (let i = 0; i < ops.length; i++) {
        if (i === oneIndex) continue;
        const ti = squaredTrig(ops[i]);
        if (!ti) continue;
        if (ti.fn === 'Tan')
          return combinePair(
            i,
            oneIndex,
            ce._fn('Sec', [ti.arg]).pow(2),
            'tan²(x) + 1 -> sec²(x)'
          );
        if (ti.fn === 'Cot')
          return combinePair(
            i,
            oneIndex,
            ce._fn('Csc', [ti.arg]).pow(2),
            '1 + cot²(x) -> csc²(x)'
          );
      }
    }
  }

  // Angle-addition (sine): sin(a)cos(b) ± cos(a)sin(b) -> sin(a ± b).
  // Gated strictly to a two-term sum where each term is a signed product of one
  // Sin and one Cos (coefficient exactly ±1), so it never fires speculatively
  // inside larger sums. `fu` already produced this rewrite; adding it to the
  // default path closes the gap for the plain identity. The result is strictly
  // cheaper than the product form, so the cost gate accepts it.
  if (op === 'Add' && isFunction(x) && x.ops.length === 2) {
    // Decompose a term into `sign · Sin(sinArg) · Cos(cosArg)` (sign ∈ {+1,-1}).
    // Returns null for anything else (other coefficients, missing Sin or Cos,
    // extra factors).
    const sinCosProduct = (
      term: Expression
    ): { sign: number; sinArg: Expression; cosArg: Expression } | null => {
      let sign = 1;
      // Unwrap a leading Negate (the canonical form of a subtracted term is
      // `Negate(Multiply(...))`, not a Multiply with a -1 factor).
      while (isFunction(term, 'Negate') && term.op1) {
        sign = -sign;
        term = term.op1;
      }
      if (!isFunction(term, 'Multiply')) return null;
      let sinArg: Expression | undefined;
      let cosArg: Expression | undefined;
      for (const f of term.ops) {
        if (isNumber(f)) {
          if (f.isSame(1)) continue;
          if (f.isSame(-1)) {
            sign = -sign;
            continue;
          }
          return null;
        }
        if (isFunction(f, 'Sin') && f.op1 && sinArg === undefined)
          sinArg = f.op1;
        else if (isFunction(f, 'Cos') && f.op1 && cosArg === undefined)
          cosArg = f.op1;
        else return null;
      }
      if (sinArg === undefined || cosArg === undefined) return null;
      return { sign, sinArg, cosArg };
    };

    const t0 = sinCosProduct(x.ops[0]);
    const t1 = sinCosProduct(x.ops[1]);
    // For the identity the two terms are sin(a)cos(b) and cos(a)sin(b), i.e.
    // their sin/cos arguments are cross-matched.
    if (
      t0 &&
      t1 &&
      t0.sinArg.isSame(t1.cosArg) &&
      t0.cosArg.isSame(t1.sinArg)
    ) {
      if (t0.sign === t1.sign) {
        // sin(a)cos(b) + cos(a)sin(b) = sin(a+b) (overall sign carried through)
        const res = ce._fn('Sin', [t0.sinArg.add(t0.cosArg)]);
        return {
          value: t0.sign === 1 ? res : res.neg(),
          because: 'sin(x)cos(y)+cos(x)sin(y) -> sin(x+y)',
        };
      }
      // Signs differ: the positive term is sin(a)cos(b), so
      // sin(a)cos(b) - cos(a)sin(b) = sin(a-b).
      const pos = t0.sign === 1 ? t0 : t1;
      return {
        value: ce._fn('Sin', [pos.sinArg.sub(pos.cosArg)]),
        because: 'sin(x)cos(y)-cos(x)sin(y) -> sin(x-y)',
      };
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

    if (a.isSame(1) && isFunction(b, 'Negate')) {
      one = a;
      negatedTrigSquared = b.op1;
    } else if (b.isSame(1) && isFunction(a, 'Negate')) {
      one = b;
      negatedTrigSquared = a.op1;
    }

    if (one && negatedTrigSquared) {
      // Check if it's a squared trig function
      if (
        isFunction(negatedTrigSquared, 'Power') &&
        negatedTrigSquared.op2?.isSame(2)
      ) {
        const base = negatedTrigSquared.op1;
        // 1 - sin²(x) -> cos²(x)
        if (isFunction(base, 'Sin')) {
          return {
            value: ce._fn('Cos', [base.op1]).pow(2),
            because: '1 - sin²(x) -> cos²(x)',
          };
        }
        // 1 - cos²(x) -> sin²(x)
        if (isFunction(base, 'Cos')) {
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

    if (a.isSame(-1) && isFunction(b, 'Power') && b.op2?.isSame(2)) {
      negOne = a;
      trigSquared = b;
    } else if (b.isSame(-1) && isFunction(a, 'Power') && a.op2?.isSame(2)) {
      negOne = b;
      trigSquared = a;
    }

    if (negOne && isFunction(trigSquared)) {
      const base = trigSquared.op1;
      // sin²(x) - 1 -> -cos²(x)
      if (isFunction(base, 'Sin')) {
        return {
          value: ce._fn('Cos', [base.op1]).pow(2).neg(),
          because: 'sin²(x) - 1 -> -cos²(x)',
        };
      }
      // cos²(x) - 1 -> -sin²(x)
      if (isFunction(base, 'Cos')) {
        return {
          value: ce._fn('Sin', [base.op1]).pow(2).neg(),
          because: 'cos²(x) - 1 -> -sin²(x)',
        };
      }
      // sec²(x) - 1 -> tan²(x)
      if (isFunction(base, 'Sec')) {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (isFunction(base, 'Csc')) {
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
      isFunction(a, 'Negate') &&
      a.op1?.isSame(1) &&
      isFunction(b) &&
      b.operator === 'Power' &&
      b.op2?.isSame(2)
    ) {
      negOneAlt = a;
      secOrCscSquared = b;
    } else if (
      isFunction(b, 'Negate') &&
      b.op1?.isSame(1) &&
      isFunction(a) &&
      a.operator === 'Power' &&
      a.op2?.isSame(2)
    ) {
      negOneAlt = b;
      secOrCscSquared = a;
    }

    if (negOneAlt && isFunction(secOrCscSquared)) {
      const base = secOrCscSquared.op1;
      // sec²(x) - 1 -> tan²(x)
      if (isFunction(base, 'Sec')) {
        return {
          value: ce._fn('Tan', [base.op1]).pow(2),
          because: 'sec²(x) - 1 -> tan²(x)',
        };
      }
      // csc²(x) - 1 -> cot²(x)
      if (isFunction(base, 'Csc')) {
        return {
          value: ce._fn('Cot', [base.op1]).pow(2),
          because: 'csc²(x) - 1 -> cot²(x)',
        };
      }
    }

    // Check for "-sin²(x) + -cos²(x)" pattern -> -1
    if (isFunction(a, 'Negate') && isFunction(b) && b.operator === 'Negate') {
      const aInner = a.op1;
      const bInner = b.op1;
      if (
        isFunction(aInner, 'Power') &&
        aInner.op2?.isSame(2) &&
        isFunction(bInner) &&
        bInner.operator === 'Power' &&
        bInner.op2?.isSame(2)
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
