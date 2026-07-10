import type { Expression, RuleStep } from '../global-types.js';
import { asRational } from '../boxed-expression/numerics.js';
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
} from '../boxed-expression/factor.js';
import { isFunction, isNumber } from '../boxed-expression/type-guards.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { isEligibleRealRewrite } from '../function-properties/index.js';

/**
 * Denest a nested square root √(a + b√c) → √x + sign(b)·√y.
 *
 * With x + y = a and 2√(xy) = |b|√c, the values x, y are the roots of
 * t² − a·t + b²c/4, i.e. x,y = (a ± √(a²−b²c))/2. The denesting is exact
 * (over the rationals) exactly when a²−b²c is a perfect square, in which case
 *   √(a + b√c) = √x + sign(b)·√y       (x ≥ y ≥ 0, principal root, a > 0).
 *
 * `arg` is the radicand: an Add of a rational term `a` and a single surd term
 * `b√c` (a real exact number with integer radical c > 1). Returns the denested
 * expression, or undefined when it does not denest over the rationals.
 *
 * Examples: √(3+2√2) → 1+√2, √(7+4√3) → 2+√3, √(5+2√6) → √2+√3,
 *           √(3−2√2) → √2−1.
 */
function denestSqrt(arg: Expression): Expression | undefined {
  if (!isFunction(arg, 'Add') || arg.nops !== 2) return undefined;
  const ce = arg.engine;
  const [t0, t1] = arg.ops!;
  if (!isNumber(t0) || !isNumber(t1)) return undefined;

  // Exactly one term must be a pure rational `a`, the other a surd `b√c`.
  const r0 = asRational(t0);
  const r1 = asRational(t1);
  const aIsT0 = !!r0 && !r1;
  const aIsT1 = !!r1 && !r0;
  if (!aIsT0 && !aIsT1) return undefined;
  const aTerm = aIsT0 ? t0 : t1;
  const surd = aIsT0 ? t1 : t0;

  // Extract the surd b·√c (exact, real, with an integer radical c > 1).
  const snv = surd.numericValue;
  if (!(snv instanceof ExactNumericValue) || snv.im !== 0) return undefined;
  const c = snv.radical;
  if (!Number.isInteger(c) || c <= 1) return undefined;
  const bn = Number(snv.rational[0]);
  const bd = Number(snv.rational[1]);

  const aRat = asRational(aTerm)!;
  const aVal = Number(aRat[0]) / Number(aRat[1]);
  if (!(aVal > 0)) return undefined; // principal root: a + b√c with a > 0

  // D = a² − b²c must be a non-negative perfect square (over the rationals).
  const bSqC = ce.number([bn * bn * c, bd * bd]); // b²·c
  const dExpr = aTerm.mul(aTerm).sub(bSqC);
  const dVal = dExpr.re;
  if (dVal === null || dVal < 0) return undefined;
  const qExpr = dExpr.sqrt();
  if (!asRational(qExpr)) return undefined; // D not a perfect square

  // x = (a + q)/2, y = (a − q)/2 (rationals, x ≥ y ≥ 0).
  const half = ce.number([1, 2]);
  const x = aTerm.add(qExpr).mul(half);
  const y = aTerm.sub(qExpr).mul(half);
  const xN = x.re;
  const yN = y.re;
  if (xN === null || yN === null || xN < 0 || yN < 0) return undefined;

  // Build the result with ce.function so √x + √y stays symbolic (the `.add`
  // method would fold √2 + 1 to a numeric approximation).
  const sign = bn * bd < 0 ? -1 : 1;
  const sqrtX = ce.function('Sqrt', [x]);
  const sqrtY = ce.function('Sqrt', [y]);
  const result = ce.function('Add', [
    sqrtX,
    sign < 0 ? ce.function('Negate', [sqrtY]) : sqrtY,
  ]);

  // Safety gate (pure machine floats, no bignum): the denested form must be
  // the positive principal root of the radicand.
  const argN = aVal + (bn / bd) * Math.sqrt(c);
  const resN = Math.sqrt(xN) + sign * Math.sqrt(yN);
  if (!(resN >= 0)) return undefined;
  if (Math.abs(resN * resN - argN) > 1e-9 * (1 + Math.abs(argN)))
    return undefined;

  return result;
}

/**
 * Denest a three-surd nested radical
 *   √(a + 2√p + 2√q + 2√r) → √x + √y + √z
 * where the radicand is the expansion of (√x + √y + √z)² =
 *   x + y + z + 2√(xy) + 2√(xz) + 2√(yz).
 *
 * From the three cross terms 2√p, 2√q, 2√r (each with coefficient exactly 2),
 * the pairwise products are {xy, xz, yz} = {p, q, r}. Then xyz = √(pqr), and
 * the unknowns are x = xyz/(yz), etc. — i.e. {xyz/p, xyz/q, xyz/r}. Accept only
 * when pqr is a perfect square, each unknown is a positive rational, and their
 * sum equals the rational part a. Verified numerically.
 *
 * Example: √(10 + 2√6 + 2√10 + 2√15) → √2 + √3 + √5.
 */
function denestSqrt3(arg: Expression): Expression | undefined {
  if (!isFunction(arg, 'Add') || arg.nops !== 4) return undefined;
  const ce = arg.engine;

  // Partition the 4 terms into one rational `a` and three surds `2√p`.
  let aTerm: Expression | undefined;
  const radicals: number[] = [];
  for (const t of arg.ops!) {
    if (!isNumber(t)) return undefined;
    const nv = t.numericValue;
    if (!(nv instanceof ExactNumericValue) || nv.im !== 0) return undefined;
    if (nv.radical <= 1) {
      if (aTerm) return undefined; // more than one rational term
      aTerm = t;
    } else {
      // Cross term must be exactly 2√p.
      if (Number(nv.rational[0]) !== 2 || Number(nv.rational[1]) !== 1)
        return undefined;
      radicals.push(nv.radical);
    }
  }
  if (!aTerm || radicals.length !== 3) return undefined;

  const aVal = aTerm.re;
  if (aVal === null || !(aVal > 0)) return undefined;

  const [p, q, r] = radicals;
  const prod = p * q * r;
  const xyz = Math.sqrt(prod);
  if (!Number.isInteger(xyz)) return undefined; // pqr not a perfect square

  // x,y,z = xyz/p, xyz/q, xyz/r (exact rationals). Their pairwise products
  // reproduce {p,q,r} automatically.
  const xs = radicals.map((v) => ce.number([xyz, v]));
  const sumXs = xs.reduce((s, x) => s + (x.re ?? NaN), 0);
  if (!Number.isFinite(sumXs)) return undefined;
  if (Math.abs(sumXs - aVal) > 1e-9 * (1 + aVal)) return undefined;

  const result = ce.function(
    'Add',
    xs.map((x) => ce.function('Sqrt', [x]))
  );

  // Numeric safety gate: result must be the positive principal root.
  const argN = aVal + 2 * (Math.sqrt(p) + Math.sqrt(q) + Math.sqrt(r));
  const resN = result.N().re;
  if (resN === null || !(resN >= 0)) return undefined;
  if (Math.abs(resN * resN - argN) > 1e-9 * (1 + Math.abs(argN)))
    return undefined;

  return result;
}

/**
 * A term of a radical denominator is "rationalizable" when it is an exact real
 * value whose square is rational — i.e. a rational `a`, or a single surd `r√c`
 * (r rational, c a positive integer). Such a term squares to a rational, so a
 * two-term sum of them has a rational conjugate product.
 */
function squaresToRational(t: Expression): boolean {
  if (!isNumber(t)) return false;
  if (asRational(t)) return true;
  const nv = t.numericValue;
  return nv instanceof ExactNumericValue && nv.im === 0;
}

/** A genuine surd `r√c` with c > 1 (as opposed to a pure rational). */
function isSurd(t: Expression): boolean {
  if (!isNumber(t)) return false;
  const nv = t.numericValue;
  return nv instanceof ExactNumericValue && nv.im === 0 && nv.radical > 1;
}

/**
 * Rationalize a quotient with a two-term radical denominator:
 *   num / (p + q)  →  num·(p − q) / (p² − q²)
 *
 * Fires when the denominator is a two-term `Add` whose terms each square to a
 * rational (a rational, or a single surd `r√c`), and at least one term is a
 * genuine surd — covering `a + b√c` and `b√c + d√e` forms (either term may be
 * the surd). The conjugate `p − q` makes the denominator rational (p² − q²);
 * the numerator is expanded pairwise and folded to rational + radical terms.
 *
 * Examples: (√3+√2)/(√3−√2) → 5 + 2√6, 1/(1+√2) → √2 − 1,
 *           1/(√5−√3) → (√5+√3)/2. Declines cube roots (Root(2,3) is not an
 *           exact real numeric value here) and 3-term denominators.
 */
function rationalizeRadicalDenominator(x: Expression): Expression | undefined {
  if (!isFunction(x)) return undefined;
  const ce = x.engine;
  const num = x.op1;
  const denom = x.op2;
  if (!num || !denom) return undefined;
  if (!isFunction(denom, 'Add') || denom.nops !== 2) return undefined;

  const [p, q] = denom.ops!;
  if (!squaresToRational(p) || !squaresToRational(q)) return undefined;
  // Require at least one genuine surd; a purely rational denominator would
  // already have been folded by canonicalization.
  if (!isSurd(p) && !isSurd(q)) return undefined;

  // newDenom = p² − q² (a nonzero rational). Fold via ce.function('Add', …) so
  // exact squares combine rather than collapsing to a float.
  const newDenom = ce.function('Add', [p.mul(p), q.mul(q).neg()]);
  if (!isNumber(newDenom) || asRational(newDenom) === null) return undefined;
  if (newDenom.isSame(0)) return undefined;

  // conjugate = p − q
  const conjugate = ce.function('Add', [p, q.neg()]);
  const conjTerms = isFunction(conjugate, 'Add') ? conjugate.ops! : [conjugate];
  const numTerms = isFunction(num, 'Add') ? num.ops! : [num];

  // Expand num · conjugate pairwise. Each pair of exact reals multiplies to a
  // single exact number (e.g. √3·√2 → √6); ce.function('Add', …) then folds
  // like radicals (3 + √6 + √6 + 2 → 5 + 2√6).
  const products: Expression[] = [];
  for (const a of numTerms)
    for (const b of conjTerms) products.push(a.mul(b));
  const newNum = ce.function('Add', products);

  const result = ce.function('Divide', [newNum, newDenom]);

  // Numeric safety gate: the rationalized form must match the original.
  const xN = x.N().re;
  const rN = result.N().re;
  if (xN !== null && rN !== null && Number.isFinite(xN) && Number.isFinite(rN)) {
    if (Math.abs(xN - rN) > 1e-9 * (1 + Math.abs(xN))) return undefined;
  }

  return result;
}

/**
 * Power simplification rules consolidated from simplify-rules.ts.
 * Handles ~25 patterns for simplifying Power expressions.
 *
 * Categories:
 * - Basic power rules: x^0, x^1, 0^x, 1^x
 * - Power combination: x^n * x^m -> x^{n+m}
 * - Nested powers: (x^n)^m -> x^{n*m}
 * - Root simplifications: sqrt(x^2) -> |x|
 * - Negative exponent in denominator
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

export function simplifyPower(x: Expression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle Root operator
  if (op === 'Root' && isFunction(x)) {
    const arg = x.op1;
    const rootIndex = x.op2;

    if (!arg || !rootIndex) return undefined;

    // Edge case: 0th root is undefined -> NaN
    if (rootIndex.isSame(0)) {
      return { value: ce.NaN, because: 'root(x, 0) -> NaN' };
    }

    // Edge case: root(0, n)
    if (arg.isSame(0)) {
      if (rootIndex.isPositive === true) {
        return { value: ce.Zero, because: 'root(0, n) -> 0 when n > 0' };
      }
      return { value: ce.NaN, because: 'root(0, n) -> NaN when n <= 0' };
    }

    // Edge case: root(1, n) = 1 for all nonzero n
    if (arg.isSame(1)) {
      return { value: ce.One, because: 'root(1, n) -> 1' };
    }

    // Edge case: root(+inf, n) -> +inf when n > 0
    if (arg.isInfinity === true && arg.isPositive === true) {
      if (rootIndex.isPositive === true) {
        return {
          value: ce.PositiveInfinity,
          because: 'root(+inf, n) -> +inf when n > 0',
        };
      }
      if (rootIndex.isNegative === true) {
        return { value: ce.Zero, because: 'root(+inf, n) -> 0 when n < 0' };
      }
    }

    // Sign extraction for odd roots: root(-a, n) -> -root(a, n) when n is odd
    if (rootIndex.isOdd === true && arg.isNegative === true) {
      // Cost-gate exempt (mathematically preferred normalization): the
      // `purpose: 'transform'` tag replaces the former `root(-` label match in
      // simplify.ts.
      return {
        value: ce._fn('Root', [arg.neg(), rootIndex]).neg(),
        because: 'root(-a, n) -> -root(a, n) when n odd',
        purpose: 'transform',
      };
    }

    // root(sqrt(x), n) -> x^{1/(2n)} (nth root of square root)
    if (isFunction(arg, 'Sqrt') && arg.op1) {
      const innerBase = arg.op1;
      // root(sqrt(x), n) = x^{1/(2n)}
      return {
        value: innerBase.pow(ce.One.div(ce.number(2).mul(rootIndex))),
        because: 'root(sqrt(x), n) -> x^{1/(2n)}',
      };
    }

    // root(root(x, m), n) -> x^{1/(m*n)} (nested roots)
    if (isFunction(arg, 'Root') && arg.op1 && arg.op2) {
      const innerBase = arg.op1;
      const innerRootIndex = arg.op2;
      // root(root(x, m), n) = x^{1/(m*n)}
      return {
        value: innerBase.pow(ce.One.div(innerRootIndex.mul(rootIndex))),
        because: 'root(root(x, m), n) -> x^{1/(m*n)}',
      };
    }

    // Root(x^n, n) -> |x| or x depending on n
    if (isFunction(arg, 'Power')) {
      const base = arg.op1;
      const exp = arg.op2;

      if (base && exp?.isSame(rootIndex)) {
        // Even root: return |x|
        if (rootIndex.isEven === true) {
          return {
            value: ce._fn('Abs', [base]),
            because: 'root(x^n, n) -> |x| when n even',
          };
        }
        // Odd root or x >= 0: return x
        if (rootIndex.isOdd === true || base.isNonNegative === true) {
          return { value: base, because: 'root(x^n, n) -> x when n odd' };
        }
      }

      // Generalized root simplification: root(x^m, n) -> x^{m/n} or |x|^{m/n}
      // Examples: root(x^6, 4) -> |x|^{3/2}, root(x^6, 3) -> x^2, root(x^8, 4) -> x^2
      if (base && exp) {
        // Get the resulting exponent m/n
        const resultExp = exp.div(rootIndex);

        // For even root index, we need |x|^{m/n}
        if (rootIndex.isEven === true) {
          // Only simplify if m/n is simpler than root form
          // (i.e., m/n is a rational with smaller denominator than n, or an integer)
          if (resultExp.isInteger === true) {
            // root(x^m, n) -> |x|^k when m/n = k is integer
            return {
              value: ce._fn('Abs', [base]).pow(resultExp),
              because: 'root(x^m, n) -> |x|^{m/n} when m/n is integer',
            };
          }
          // For non-integer m/n, still simplify to |x|^{m/n} form
          // This is simpler than root(x^m, n)
          const rat = asRational(resultExp);
          if (rat) {
            const [, denom] = rat;
            const rootN = asRational(rootIndex);
            // Only simplify if the new denominator is smaller
            if (rootN && Number(denom) < Number(rootN[0])) {
              return {
                value: ce._fn('Abs', [base]).pow(resultExp),
                because: 'root(x^m, n) -> |x|^{m/n}',
              };
            }
          }
        }

        // For odd root index: root(x^m, n) -> x^{m/n}
        // Odd roots are single-valued for all real numbers, so this is always valid
        if (rootIndex.isOdd === true && exp.isInteger === true) {
          return {
            value: base.pow(resultExp),
            because: 'root(x^m, n) -> x^{m/n} when n is odd',
          };
        }

        // If x is non-negative, we can always simplify
        if (base.isNonNegative === true) {
          if (resultExp.isInteger === true) {
            return {
              value: base.pow(resultExp),
              because: 'root(x^m, n) -> x^{m/n} when x >= 0',
            };
          }
        }
      }
    }

    // Root of Multiply: root(a*b*..., n) -> root(a,n) * root(b,n) * ...
    // Distribute root over product when some factors have perfect nth roots
    if (isFunction(arg, 'Multiply') && arg.ops.length >= 2) {
      const n = rootIndex.re;
      if (n !== undefined && Number.isInteger(n) && n >= 2) {
        const insideRoot: Expression[] = [];
        const outsideRoot: Expression[] = [];

        for (const factor of arg.ops) {
          // Try to simplify root(factor, n) individually
          const rootOfFactor = ce._fn('Root', [factor, rootIndex]);
          const simplified = simplifyPower(rootOfFactor);
          if (simplified && !simplified.value.isSame(rootOfFactor)) {
            outsideRoot.push(simplified.value);
          } else {
            // Check if factor is a numeric perfect nth power
            const numVal = factor.re;
            if (numVal !== undefined && numVal > 0) {
              const nthRoot = Math.round(Math.pow(numVal, 1 / n));
              if (Math.pow(nthRoot, n) === numVal) {
                outsideRoot.push(ce.number(nthRoot));
                continue;
              }
            }
            insideRoot.push(factor);
          }
        }

        if (outsideRoot.length > 0) {
          const outside =
            outsideRoot.length === 1
              ? outsideRoot[0]
              : ce._fn('Multiply', outsideRoot);
          if (insideRoot.length === 0) {
            return {
              value: outside,
              because: 'root(product, n) -> factored',
            };
          }
          const inside =
            insideRoot.length === 1
              ? insideRoot[0]
              : ce._fn('Multiply', insideRoot);
          return {
            value: ce._fn('Multiply', [
              outside,
              ce._fn('Root', [inside, rootIndex]),
            ]),
            because: 'root(product, n) -> factored',
          };
        }
      }
    }
  }

  // Handle Sqrt operator
  if (op === 'Sqrt' && isFunction(x)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Edge case: sqrt(+inf) -> +inf
    if (arg.isInfinity === true && arg.isPositive === true) {
      return { value: ce.PositiveInfinity, because: 'sqrt(+inf) -> +inf' };
    }

    // Try factoring perfect square trinomials and difference of squares first
    // This enables simplification of sqrt(x^2+2x+1) -> |x+1|
    if (arg.operator === 'Add') {
      // Try perfect square trinomial: a² ± 2ab + b² → (a±b)²
      const perfectSquare = factorPerfectSquare(arg);
      if (perfectSquare !== null) {
        // We have (a±b)², so sqrt((a±b)²) = |a±b| — valid only on the reals
        // (D4); a complex factor bails (fall through).
        const base = isFunction(perfectSquare)
          ? perfectSquare.op1
          : perfectSquare;
        if (isEligibleRealRewrite(base)) {
          return {
            value: ce._fn('Abs', [base]),
            because: 'sqrt(perfect square trinomial) -> |factor|',
          };
        }
      }

      // Try difference of squares: a² - b² → (a-b)(a+b)
      const diffSquares = factorDifferenceOfSquares(arg);
      if (diffSquares !== null) {
        // We have (a-b)(a+b), so sqrt((a-b)(a+b)) = sqrt(a²-b²)
        // This doesn't simplify further directly, but we return the factored form
        // wrapped in sqrt for further simplification
        return {
          value: ce._fn('Sqrt', [diffSquares]),
          because: 'sqrt(a²-b²) -> sqrt((a-b)(a+b))',
        };
      }

      // Denest a nested radical: √(a + b√c) → √x + √y when a²−b²c is a
      // perfect square (e.g. √(3+2√2) → 1+√2).
      const denested = denestSqrt(arg);
      if (denested !== undefined) {
        return { value: denested, because: 'denest √(a+b√c) -> √x+√y' };
      }

      // Denest a three-surd nested radical:
      // √(a + 2√p + 2√q + 2√r) → √x + √y + √z.
      const denested3 = denestSqrt3(arg);
      if (denested3 !== undefined) {
        return {
          value: denested3,
          because: 'denest √(a+2√p+2√q+2√r) -> √x+√y+√z',
        };
      }
    }

    // sqrt(sqrt(x)) -> x^{1/4} (nested square roots)
    if (isFunction(arg, 'Sqrt') && arg.op1) {
      return {
        value: arg.op1.pow(ce.number([1, 4])),
        because: 'sqrt(sqrt(x)) -> x^{1/4}',
      };
    }

    // sqrt(root(x, n)) -> x^{1/(2n)} (square root of nth root)
    if (isFunction(arg, 'Root') && arg.op1 && arg.op2) {
      const innerBase = arg.op1;
      const rootIndex = arg.op2;
      // sqrt(root(x, n)) = x^{1/(2n)}
      return {
        value: innerBase.pow(ce.One.div(ce.number(2).mul(rootIndex))),
        because: 'sqrt(root(x, n)) -> x^{1/(2n)}',
      };
    }

    if (isFunction(arg, 'Power')) {
      const base = arg.op1;
      const exp = arg.op2;

      if (base && exp) {
        // sqrt(x^2) -> x when x is non-negative (sound for any base)
        if (exp.isSame(2) && base.isNonNegative === true) {
          return { value: base, because: 'sqrt(x^2) -> x when x >= 0' };
        }

        // The |x|-forms below are valid only on the reals: √(z²) = |z| fails
        // for a complex base (√(i²) = i ≠ 1). Bail on a provably-non-real /
        // declared-complex base (SYM P0-4 / D4); unconstrained bases keep the
        // generic-real convention.
        if (isEligibleRealRewrite(base)) {
          // sqrt(x^2) -> |x| (general case)
          if (exp.isSame(2)) {
            return {
              value: ce._fn('Abs', [base]),
              because: 'sqrt(x^2) -> |x|',
            };
          }

          // sqrt(x^{2n}) -> |x|^n for positive integer n
          if (exp.isEven === true && exp.isPositive === true) {
            return {
              value: ce._fn('Abs', [base]).pow(exp.div(2)),
              because: 'sqrt(x^{2n}) -> |x|^n',
            };
          }

          // sqrt(x^{2n+1}) -> |x|^n * sqrt(x) for positive integer n
          // e.g., sqrt(x^5) = sqrt(x^4 * x) = |x|^2 * sqrt(x)
          if (
            exp.isOdd === true &&
            exp.isInteger === true &&
            exp.isPositive === true
          ) {
            const n = exp.sub(ce.One).div(2);
            if (n.isPositive === true) {
              return {
                value: ce
                  ._fn('Abs', [base])
                  .pow(n)
                  .mul(ce._fn('Sqrt', [base])),
                because: 'sqrt(x^{2n+1}) -> |x|^n * sqrt(x)',
              };
            }
          }
        }
      }
    }

    // sqrt(a * b * ...) -> factor out perfect squares
    // sqrt(x^2 * y) -> |x| * sqrt(y)
    // sqrt(x^{2n} * y) -> |x|^n * sqrt(y)
    if (isFunction(arg, 'Multiply')) {
      const perfectSquares: Expression[] = [];
      const remaining: Expression[] = [];

      for (const factor of arg.ops) {
        // The |x|-extraction below is valid only on the reals (D4): a complex
        // factor is left inside the radical unchanged.
        if (
          isFunction(factor, 'Power') &&
          factor.op1 &&
          factor.op2 &&
          isEligibleRealRewrite(factor.op1)
        ) {
          const base = factor.op1;
          const exp = factor.op2;
          // x^2 -> |x| outside, nothing inside
          if (exp.isSame(2)) {
            perfectSquares.push(ce._fn('Abs', [base]));
          }
          // x^{2n} -> |x|^n outside, nothing inside
          else if (exp.isEven === true && exp.isPositive === true) {
            perfectSquares.push(ce._fn('Abs', [base]).pow(exp.div(2)));
          }
          // x^{2n+1} -> |x|^n outside, x inside (for positive even part)
          else if (
            exp.isInteger === true &&
            exp.isPositive === true &&
            exp.isOdd === true
          ) {
            // Split: x^{2n+1} = x^{2n} * x
            // sqrt(x^{2n+1}) = |x|^n * sqrt(x)
            const n = exp.sub(ce.One).div(2);
            if (n.isPositive === true) {
              perfectSquares.push(ce._fn('Abs', [base]).pow(n));
            }
            remaining.push(base);
          } else {
            remaining.push(factor);
          }
        } else {
          remaining.push(factor);
        }
      }

      // Only simplify if we found at least one perfect square
      if (perfectSquares.length > 0) {
        const outsideSqrt =
          perfectSquares.length === 1
            ? perfectSquares[0]
            : ce._fn('Multiply', perfectSquares);

        if (remaining.length === 0) {
          return {
            value: outsideSqrt,
            because: 'sqrt(a^2 * ...) -> |a| * ...',
          };
        }

        const insideSqrt =
          remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining);

        return {
          value: outsideSqrt.mul(ce._fn('Sqrt', [insideSqrt])),
          because: 'sqrt(a^2 * b) -> |a| * sqrt(b)',
        };
      }
    }
  }

  // Handle Power operator
  if (op === 'Power' && isFunction(x)) {
    const base = x.op1;
    const exp = x.op2;

    if (!base || !exp) return undefined;

    // x^1 -> x
    if (exp.isSame(1)) {
      return { value: base, because: 'x^1 -> x' };
    }

    // 0^x -> 0 when x is positive (including symbolic like π)
    // Note: 0^0 = NaN and 0^(-x) = ComplexInfinity are handled elsewhere
    if (base.isSame(0) && exp.isPositive === true) {
      return { value: ce.Zero, because: '0^x -> 0 when x > 0' };
    }

    // (-1)^{p/q} -> -1 when both p and q are odd (real odd root of -1)
    // This handles the literal -1 case (not Negate(1))
    if (base.isSame(-1)) {
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        const numN = Number(num);
        const denomN = Number(denom);
        // Both numerator and denominator odd means real root exists
        if (numN % 2 !== 0 && denomN % 2 !== 0) {
          return {
            value: ce.number(-1),
            because: '(-1)^{p/q} -> -1 when p,q odd',
          };
        }
      }
    }

    // (negative * b * ...)^{p/q} -> -(positive * b * ...)^{p/q} when p,q odd
    // e.g., (-2x)^{3/5} -> -(2x)^{3/5}
    // This handles products like Multiply(-2, x) raised to a rational power
    if (isFunction(base, 'Multiply')) {
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        const numN = Number(num);
        const denomN = Number(denom);
        const numIsOdd = numN % 2 !== 0;
        const denomIsOdd = denomN % 2 !== 0;

        if (numIsOdd && denomIsOdd) {
          // Find if there's a negative numeric coefficient
          let negativeIndex = -1;
          for (let i = 0; i < base.ops.length; i++) {
            const factor = base.ops[i];
            if (isNumber(factor) && factor.isNegative === true) {
              negativeIndex = i;
              break;
            }
          }

          if (negativeIndex >= 0) {
            // Factor out the sign: (-a * b)^{p/q} = -(a * b)^{p/q} when p,q odd
            const negFactor = base.ops[negativeIndex];
            const posFactor = negFactor.neg();
            const newFactors = base.ops.map((f, i) =>
              i === negativeIndex ? posFactor : f
            );
            const posBase =
              newFactors.length === 1
                ? newFactors[0]
                : ce._fn('Multiply', newFactors);
            return {
              value: posBase.pow(exp).neg(),
              because: '(-a*b)^{p/q} -> -(a*b)^{p/q} when p,q odd',
            };
          }
        }
      }
    }

    // (a * b * ...)^n -> a^n * b^n * ... when n is an integer
    // Distribute exponent over product
    if (isFunction(base, 'Multiply') && exp.isInteger === true) {
      const newFactors = base.ops.map((factor) => factor.pow(exp));
      return {
        value: ce._fn('Multiply', newFactors),
        because: '(a*b)^n -> a^n * b^n',
      };
    }

    // (-x)^n -> x^n when n is even, (-x)^n -> -x^n when n is odd
    if (isFunction(base, 'Negate')) {
      const innerBase = base.op1;

      // Handle integer exponents
      if (exp.isEven === true) {
        // (-x)^{even} -> x^{even}
        return {
          value: innerBase.pow(exp),
          because: '(-x)^n -> x^n when n is even',
        };
      }
      if (exp.isOdd === true) {
        // (-x)^{odd} -> -(x^{odd})
        return {
          value: innerBase.pow(exp).neg(),
          because: '(-x)^n -> -x^n when n is odd',
        };
      }

      // Handle rational exponents n/m where we can determine parity
      // Rational exponents may be stored as Number with rational numericValue
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        // Convert to Number for modulo operation (safe for small integers)
        const numN = Number(num);
        const denomN = Number(denom);
        const numIsEven = numN % 2 === 0;
        const numIsOdd = numN % 2 !== 0;
        const denomIsOdd = denomN % 2 !== 0;

        // (-x)^{even/odd} -> x^{even/odd} (e.g., (-x)^{4/3} -> x^{4/3})
        if (numIsEven && denomIsOdd) {
          return {
            value: innerBase.pow(exp),
            because: '(-x)^{n/m} -> x^{n/m} when n is even and m is odd',
          };
        }
        // (-x)^{odd/odd} -> -(x^{odd/odd}) (e.g., (-x)^{3/5} -> -(x^{3/5}))
        if (numIsOdd && denomIsOdd) {
          return {
            value: innerBase.pow(exp).neg(),
            because: '(-x)^{n/m} -> -x^{n/m} when n and m are odd',
          };
        }
        // NOTE: (-x)^{odd/even} is NOT rewritten. An even root of a negative
        // base is complex (e.g. for x > 0, (-x)^{3/4} is complex), whereas
        // x^{3/4} is a real positive — the two are not equal, so collapsing the
        // sign here would change the expression's meaning.
      }
    }

    // (sqrt(x))^n -> x^{n/2}
    if (isFunction(base, 'Sqrt')) {
      const innerBase = base.op1;
      // sqrt(x)^n = x^{n/2}
      // Safe when: n is even (result is integer power), or x is non-negative
      if (exp.isEven === true) {
        // sqrt(x)^{2k} = x^k - always valid
        return {
          value: innerBase.pow(exp.div(2)),
          because: 'sqrt(x)^n -> x^{n/2} when n is even',
        };
      }
      if (innerBase.isNonNegative === true) {
        // sqrt(x)^n = x^{n/2} when x >= 0
        return {
          value: innerBase.pow(exp.div(2)),
          because: 'sqrt(x)^n -> x^{n/2} when x >= 0',
        };
      }
    }

    // (root(x, k))^n -> x^{n/k}
    if (isFunction(base, 'Root')) {
      const innerBase = base.op1;
      const rootIndex = base.op2;
      // root(x, k)^n = x^{n/k}
      // Safe when result exponent is integer, or x is non-negative
      const resultExp = exp.div(rootIndex);
      if (resultExp.isInteger === true || innerBase.isNonNegative === true) {
        return {
          value: innerBase.pow(resultExp),
          because: 'root(x, k)^n -> x^{n/k}',
        };
      }
    }

    // (x^n)^m -> x^{n*m} under certain conditions
    if (isFunction(base, 'Power')) {
      const innerBase = base.op1;
      const innerExp = base.op2;

      if (innerBase && innerExp) {
        // (a^n)^m -> a^{n*m} only when mathematically safe:
        // - base is non-negative (no sign info to lose), or
        // - outer exponent m is integer (repeated multiplication is safe).
        // An odd inner exponent n is NOT sufficient: on the principal branch
        // (a^n)^m differs from a^{nm} by a phase factor when a < 0 and m is
        // non-integer (e.g. (x^3)^{1/2} = √(x^3), not x^{3/2}). See the note
        // in canonicalPower (arithmetic-power.ts).
        const baseNonNeg = innerBase.isNonNegative === true;
        const outerIsInteger = exp.isInteger === true;

        if (baseNonNeg || outerIsInteger) {
          return {
            value: innerBase.pow(innerExp.mul(exp)),
            because: '(x^n)^m -> x^{n*m}',
          };
        }
      }
    }

    // (a/b)^{-n} -> (b/a)^n
    if (isFunction(base, 'Divide') && base.op2.isSame(0) === false) {
      const num = base.op1;
      const denom = base.op2;

      if (isFunction(exp, 'Negate')) {
        return {
          value: denom.div(num).pow(exp.op1),
          because: '(a/b)^{-n} -> (b/a)^n',
        };
      }

      // (a/b)^{-1} -> b/a
      if (exp.isSame(-1)) {
        return { value: denom.div(num), because: '(a/b)^{-1} -> b/a' };
      }

      // (a/b)^{negative number} -> (b/a)^{positive number}
      // Handle numeric negative exponents like (a/b)^{-2} -> (b/a)^2
      if (exp.isNegative === true && isNumber(exp)) {
        return {
          value: denom.div(num).pow(exp.neg()),
          because: '(a/b)^{-n} -> (b/a)^n',
        };
      }
    }
  }

  // Handle Divide with negative exponent in denominator
  if (op === 'Divide' && isFunction(x)) {
    const num = x.op1;
    const denom = x.op2;

    if (!num || !denom) return undefined;

    // Rationalize a two-term radical denominator: num / (p + q) ->
    // num·(p − q) / (p² − q²). E.g. (√3+√2)/(√3−√2) → 5 + 2√6.
    const rationalized = rationalizeRadicalDenominator(x);
    if (rationalized !== undefined) {
      return {
        value: rationalized,
        because: 'rationalize radical denominator',
      };
    }

    // Same-base division: a^m / a^n -> a^{m-n}
    if (
      isFunction(num, 'Power') &&
      denom.operator === 'Power' &&
      isFunction(denom)
    ) {
      const baseNum = num.op1;
      const expNum = num.op2;
      const baseDenom = denom.op1;
      const expDenom = denom.op2;

      if (baseNum?.isSame(baseDenom) && expNum && expDenom) {
        // Use symbolic Add to preserve exact forms (e.g., sqrt(2) - 3)
        // instead of .sub() which evaluates numerically
        const diffExp = ce.function('Add', [expNum, expDenom.neg()]);
        return {
          value: baseNum.pow(diffExp),
          because: 'a^m / a^n -> a^{m-n}',
        };
      }
    }

    // a^m / a -> a^{m-1}
    if (isFunction(num, 'Power') && num.op1.isSame(denom)) {
      const diffExp = ce.function('Add', [num.op2, ce.NegativeOne]);
      return {
        value: denom.pow(diffExp),
        because: 'a^m / a -> a^{m-1}',
      };
    }

    // a / a^n -> a^{1-n}
    if (isFunction(denom, 'Power') && denom.op1.isSame(num)) {
      const diffExp = ce.function('Add', [ce.One, denom.op2.neg()]);
      return {
        value: num.pow(diffExp),
        because: 'a / a^n -> a^{1-n}',
      };
    }

    // a / b^{-n} -> a * b^n
    if (isFunction(denom, 'Power') && denom.op1.isSame(0) === false) {
      const base = denom.op1;
      const exp = denom.op2;

      if (isFunction(exp, 'Negate')) {
        return {
          value: num.mul(base.pow(exp.op1)),
          because: 'a / b^{-n} -> a * b^n',
        };
      }
    }

    // a / (d * b^{-n}) -> (a/d) * b^n
    if (isFunction(denom, 'Multiply')) {
      for (let i = 0; i < denom.ops.length; i++) {
        const factor = denom.ops[i];
        if (
          isFunction(factor, 'Power') &&
          factor.op1.isSame(0) === false &&
          factor.op2.operator === 'Negate' &&
          isFunction(factor.op2)
        ) {
          const base = factor.op1;
          const posExp = factor.op2.op1;
          const otherFactors = denom.ops.filter((_, idx) => idx !== i);
          const d =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', otherFactors);
          return {
            value: num.div(d).mul(base.pow(posExp)),
            because: 'a / (d * b^{-n}) -> (a/d) * b^n',
          };
        }
      }
    }

    // a / (b/c)^d -> a * (c/b)^d
    if (
      isFunction(denom, 'Power') &&
      denom.op1.operator === 'Divide' &&
      isFunction(denom.op1) &&
      denom.op1.op2.isSame(0) !== true
    ) {
      const fracNum = denom.op1.op1;
      const fracDenom = denom.op1.op2;
      const exp = denom.op2;
      // Cost-gate exempt (eliminates a nested fraction): the
      // `purpose: 'transform'` tag replaces the former `a / (b/c)^d` label match
      // in simplify.ts.
      return {
        value: num.mul(fracDenom.div(fracNum).pow(exp)),
        because: 'a / (b/c)^d -> a * (c/b)^d',
        purpose: 'transform',
      };
    }
  }

  // Handle Multiply for power combination
  if (op === 'Multiply' && isFunction(x) && x.ops.length >= 2) {
    // x^n * x^m -> x^{n+m}
    // This is a more complex rule that needs to find matching bases
    // The main rule file has a more complete implementation for 3+ operands
    // Here we handle the simple 2-operand case

    if (x.ops.length === 2) {
      const [a, b] = x.ops;

      // Both are powers
      if (isFunction(a, 'Power') && b.operator === 'Power' && isFunction(b)) {
        const baseA = a.op1;
        const expA = a.op2;
        const baseB = b.op1;
        const expB = b.op2;

        if (baseA?.isSame(baseB) && expA && expB) {
          // Use symbolic Add to preserve exact forms (e.g., 1 + sqrt(2))
          // instead of .add() which evaluates numerically
          const sumExp = ce.function('Add', [expA, expB]);
          // Only combine if base is non-zero or sum of exponents is non-negative
          const canCombine =
            baseA.isPositive === true ||
            baseA.isNegative === true ||
            sumExp.isNonNegative === true;

          if (canCombine) {
            return {
              value: baseA.pow(sumExp),
              because: 'x^n * x^m -> x^{n+m}',
            };
          }
        }
      }

      // x * x^n -> x^{n+1}
      if (isFunction(b, 'Power') && a.isSame(b.op1)) {
        const canCombine =
          a.isPositive === true || a.isNegative === true || isNumber(a);

        if (canCombine) {
          return {
            value: a.pow(ce.function('Add', [b.op2, ce.One])),
            because: 'x * x^n -> x^{n+1}',
          };
        }
      }

      // x^n * x -> x^{n+1}
      if (isFunction(a, 'Power') && b.isSame(a.op1)) {
        const canCombine =
          b.isPositive === true || b.isNegative === true || isNumber(b);

        if (canCombine) {
          return {
            value: b.pow(ce.function('Add', [a.op2, ce.One])),
            because: 'x^n * x -> x^{n+1}',
          };
        }
      }
    }
  }

  return undefined;
}
