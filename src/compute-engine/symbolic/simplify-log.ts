import type { Expression, RuleStep } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import {
  isEligibleRealRewrite,
  onBranchCut,
} from '../function-properties/index.js';
import { toBigint } from '../boxed-expression/numerics.js';
import { logarithmAtExceptionalPoint } from '../boxed-expression/logarithm.js';

/** Whether `logBase` is Euler's number — `Log(x, e)` is `Ln(x)`. */
function isNaturalLogBase(base: Expression): boolean {
  return sym(base) === 'ExponentialE';
}

/**
 * Logarithm simplification rules consolidated from simplify-rules.ts.
 * Handles ~30 patterns for simplifying Ln and Log expressions.
 *
 * Categories:
 * - Ln power rules: ln(x^n) -> n*ln(x)
 * - Log power rules: log_c(x^n) -> n*log_c(x)
 * - Logarithm combinations: ln(x) + ln(y) -> ln(xy)
 * - Change of base rules
 * - Logarithm with infinity
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

/**
 * Public entry point. The cost gate in `simplify.ts` exempts logarithm
 * rewrites (e.g. `ln(x^n) -> n*ln(x)`) from its "not more than 30% more
 * expensive" check because they are mathematically preferred even when
 * structurally larger. That exemption used to be a fragile string match on the
 * `because` label in the cost gate; it now travels with the step as a
 * `purpose: 'transform'` tag.
 *
 * The exempted set is the `ln(...)` / `log_...` label prefixes the cost gate
 * originally matched, plus the two `e^(… + y)` sums named in
 * `EXP_OF_LOG_SUM_LABELS`. Those two had been left out only because the
 * original whitelist did not name them: they were passing on the gate's growth
 * tolerance instead (`e^(x + ln x)` scores 14, `x·e^x` scores 18). Splitting a
 * logarithm out from under an exponential is a preferred rewrite whatever it
 * scores, so it is now tagged outright.
 *
 * They are matched by exact label, NOT by an `e^(ln(` prefix: sibling rules in
 * this file label themselves `e^(ln(x) * y) -> x^y` and
 * `e^(ln(x) / y) -> x^(1/y)`, which such a prefix would silently exempt too.
 * Neither needs the exemption (both reduce cost on their own), and a
 * `transform` tag is an unconditional gate bypass, so it should never be
 * handed out by accident.
 *
 * The `combine ln/log terms`, `c^...` and `log base 0 or 1` steps remain
 * untagged.
 */
const EXP_OF_LOG_SUM_LABELS = new Set([
  'e^(ln(x) + y) -> x * e^y',
  'e^(log_c(x) + y) -> x^{1/ln(c)} * e^y',
]);

/**
 * For the terms of an exponent `Add`, the product of the arguments of the
 * logarithm terms that `isLog` accepts (a negated term divides) and the sum
 * of the other terms (`undefined` when there is none). `undefined` when no
 * term is a logarithm. Used for `e^(ln(a) + ln(b) - ln(c) + y) =
 * (a·b/c)·e^y`.
 */
function takeOutLogTerms(
  ce: Expression['engine'],
  terms: ReadonlyArray<Expression>,
  isLog: (term: Expression) => boolean
): [Expression, Expression | undefined] | undefined {
  const numerator: Expression[] = [];
  const denominator: Expression[] = [];
  const rest: Expression[] = [];
  for (const term of terms) {
    if (isLog(term) && isFunction(term)) numerator.push(term.op1);
    else if (
      isFunction(term, 'Negate') &&
      isLog(term.op1) &&
      isFunction(term.op1)
    )
      denominator.push(term.op1.op1);
    else rest.push(term);
  }
  if (numerator.length + denominator.length === 0) return undefined;
  let factor = numerator.reduce((acc, x) => acc.mul(x), ce.One);
  for (const x of denominator) factor = factor.div(x);
  const sum =
    rest.length === 0
      ? undefined
      : rest.length === 1
        ? rest[0]
        : ce._fn('Add', rest);
  return [factor, sum];
}

/**
 * Combine the logarithm terms `group` of the sum `terms` (each entry gives the
 * index of the term in `terms`, the argument of its logarithm, and whether
 * the term is negated: `positive: false`). `makeLog` builds a logarithm of
 * the same kind and base.
 *
 * - A product argument with a positive numeric factor is split first:
 *   `ln(c·u) = ln(c) + ln(u)` for `c > 0` and any `u`, since multiplying by
 *   `c` does not change the argument (the angle) of `u`.
 * - The arguments that are provably non-negative are combined into one
 *   logarithm of their product and quotient (`isNonNegativeLogArgument()`).
 * - The other arguments are kept, except that two terms with the same
 *   argument and opposite signs cancel.
 *
 * Returns the new sum, or `undefined` when nothing combines (fewer than two
 * non-negative arguments and no cancelled pair): splitting a factor alone
 * would only make the sum longer.
 */
function combineLogGroup(
  ce: Expression['engine'],
  terms: ReadonlyArray<Expression>,
  group: ReadonlyArray<{ index: number; arg: Expression; positive: boolean }>,
  makeLog: (arg: Expression) => Expression
): Expression | undefined {
  if (group.length < 2) return undefined;

  // Split a positive numeric factor out of a product argument.
  const entries: Array<{ arg: Expression; positive: boolean }> = [];
  for (const t of group) {
    const arg = t.arg;
    if (isFunction(arg, 'Multiply') && arg.nops >= 2) {
      const constants = arg.ops.filter(
        (f) => isNumber(f) && !f.isComplex && f.isPositive === true
      );
      if (constants.length > 0 && constants.length < arg.nops) {
        const others = arg.ops.filter((f) => !constants.includes(f));
        for (const c of constants)
          entries.push({ arg: c, positive: t.positive });
        entries.push({
          arg: others.length === 1 ? others[0] : ce._fn('Multiply', others),
          positive: t.positive,
        });
        continue;
      }
    }
    entries.push({ arg, positive: t.positive });
  }

  const combinable = entries.filter((e) => isNonNegativeLogArgument(e.arg));
  const kept = entries.filter((e) => !isNonNegativeLogArgument(e.arg));

  // Cancel kept terms with the same argument and opposite signs.
  let cancelled = 0;
  for (let i = 0; i < kept.length; i++) {
    const j = kept.findIndex(
      (e, k) =>
        k > i && e.positive !== kept[i].positive && e.arg.isSame(kept[i].arg)
    );
    if (j < 0) continue;
    kept.splice(j, 1);
    kept.splice(i, 1);
    cancelled += 1;
    i -= 1;
  }

  if (combinable.length < 2 && cancelled === 0) return undefined;

  const newTerms: Expression[] = [];
  if (combinable.length > 0) {
    let numerator = ce.One;
    let denominator = ce.One;
    for (const e of combinable) {
      if (e.positive) numerator = numerator.mul(e.arg);
      else denominator = denominator.mul(e.arg);
    }
    newTerms.push(makeLog(numerator.div(denominator)));
  }
  for (const e of kept)
    newTerms.push(
      e.positive ? makeLog(e.arg) : ce._fn('Negate', [makeLog(e.arg)])
    );

  const groupIndices = new Set(group.map((t) => t.index));
  newTerms.push(...terms.filter((_, i) => !groupIndices.has(i)));
  if (newTerms.length === 0) return ce.Zero;
  if (newTerms.length === 1) return newTerms[0];
  return ce._fn('Add', newTerms);
}

/**
 * Whether `ln(a) + ln(b) → ln(ab)` may use `a`: `a` is provably non-negative
 * (by its value, its type or an assumption), or `a` is an absolute value.
 * For real arguments at or above 0 the principal values of both sides are
 * equal, also at 0, where both sides are `-∞`. An absolute value is
 * non-negative or `NaN`, and a `NaN` argument makes both sides `NaN`; its
 * `isNonNegative` is `undefined` when the operand type admits `NaN`, so it is
 * accepted here by its operator (`ln|x + 1| - ln|x + 2|` is the result of an
 * integration).
 */
function isNonNegativeLogArgument(a: Expression): boolean {
  return a.isNonNegative === true || isFunction(a, 'Abs');
}

export function simplifyLog(x: Expression): RuleStep | undefined {
  const r = simplifyLogCore(x);
  if (r === undefined) return r;
  const b = r.because;
  if (
    b === 'ln' ||
    b?.startsWith('ln(') ||
    b?.startsWith('log_') ||
    (b !== undefined && EXP_OF_LOG_SUM_LABELS.has(b))
  )
    return { ...r, purpose: 'transform' };
  return r;
}

function simplifyLogCore(x: Expression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  if (!isFunction(x)) return undefined;

  // Handle Ln
  if (op === 'Ln') {
    const arg = x.op1;
    if (!arg) return undefined;

    // ln(0) = −∞, ln(+∞) = +∞, ln(~oo) = ~oo, ln(NaN) = NaN: the same values
    // as the evaluate route (`logarithmAtExceptionalPoint`). This branch is
    // currently shadowed by the unconditional "Ln, Log (basic evaluation)"
    // rule in simplify-rules.ts, which calls `.ln()` and reduces these
    // before this one runs — but keep it in sync with `evaluate()` in case
    // that ordering changes. An anonymous infinity has no exact spelling and
    // declines.
    {
      const special = logarithmAtExceptionalPoint(ce, arg, undefined, false);
      if (special !== undefined)
        return { value: special, because: 'ln at an exceptional point' };
    }

    // ln(p/q) -> ln(p) - ln(q) for positive rational p/q (not integer)
    if (
      arg.operator === 'Rational' &&
      arg.isRational === true &&
      arg.isInteger === false
    ) {
      const j = arg.json;
      if (Array.isArray(j) && j[0] === 'Rational') {
        const p = j[1] as number;
        const q = j[2] as number;
        if (p > 0 && q > 0) {
          if (p === 1) {
            // ln(1/q) -> -ln(q)
            return {
              value: ce._fn('Ln', [ce.number(q)]).neg(),
              because: 'ln(1/q) -> -ln(q)',
            };
          }
          return {
            value: ce
              ._fn('Ln', [ce.number(p)])
              .sub(ce._fn('Ln', [ce.number(q)])),
            because: 'ln(p/q) -> ln(p) - ln(q)',
          };
        }
      }
    }

    // ln(x^n) -> n*ln(x) when x >= 0 or n is odd or n is irrational
    if (isFunction(arg, 'Power')) {
      const base = arg.op1;
      const exp = arg.op2;
      if (base && exp) {
        // ln(x^n) -> n*ln(x) is unconditionally sound when x >= 0.
        if (base.isNonNegative === true) {
          return {
            value: exp.mul(ce._fn('Ln', [base])),
            because: 'ln(x^n) -> n*ln(x)',
          };
        }
        // ln(x^n) -> n*ln(|x|) when n is even — sound for every real x (SYM
        // P0-2); requires a real-eligible base (bail on declared complex, D4).
        if (exp.isEven === true && isEligibleRealRewrite(base)) {
          return {
            value: exp.mul(ce._fn('Ln', [ce._fn('Abs', [base])])),
            because: 'ln(x^n) -> n*ln(|x|) when n even',
          };
        }
        // ln(x^n) -> n*ln(x) for a non-even exponent: the documented generic-
        // real convention (D4) for a real-eligible base not provably on the cut
        // (D3). On the negative real axis the odd / irrational cases differ by a
        // multiple of 2πi (e.g. ln(x³) = 3ln(x) is wrong at x = -3), so a
        // provably-negative base stays symbolic; a declared-complex base bails.
        if (
          isEligibleRealRewrite(base) &&
          onBranchCut(ce, 'Ln', base) !== true
        ) {
          return {
            value: exp.mul(ce._fn('Ln', [base])),
            because: 'ln(x^n) -> n*ln(x)',
          };
        }
      }
    }

    // ln(e^x) -> x
    if (isFunction(arg, 'Power') && sym(arg.op1) === 'ExponentialE') {
      return { value: arg.op2, because: 'ln(e^x) -> x' };
    }

    // ln(e^x * y) -> x + ln(y)
    if (isFunction(arg, 'Multiply')) {
      for (let i = 0; i < arg.ops.length; i++) {
        const factor = arg.ops[i];
        if (isFunction(factor, 'Power') && sym(factor.op1) === 'ExponentialE') {
          const exp = factor.op2;
          const otherFactors = arg.ops.filter((_, idx) => idx !== i);
          const remaining =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', [...otherFactors]);
          return {
            value: exp.add(ce._fn('Ln', [remaining])),
            because: 'ln(e^x * y) -> x + ln(y)',
          };
        }
      }
    }

    // ln(e^x / y) -> x - ln(y)
    if (isFunction(arg, 'Divide')) {
      if (
        arg.op1?.operator === 'Power' &&
        isFunction(arg.op1) &&
        sym(arg.op1.op1) === 'ExponentialE'
      ) {
        return {
          value: arg.op1.op2.sub(ce._fn('Ln', [arg.op2])),
          because: 'ln(e^x / y) -> x - ln(y)',
        };
      }
    }

    // ln(x/y) -> ln(x) - ln(y) (quotient rule expansion)
    // Only apply when both x and y are positive (to avoid branch cut issues)
    if (isFunction(arg, 'Divide')) {
      const num = arg.op1;
      const denom = arg.op2;
      if (num.isPositive === true && denom.isPositive === true) {
        return {
          value: ce._fn('Ln', [num]).sub(ce._fn('Ln', [denom])),
          because: 'ln(x/y) -> ln(x) - ln(y)',
        };
      }
    }

    // ln(y / e^x) -> ln(y) - x
    if (isFunction(arg, 'Divide')) {
      if (
        arg.op2?.operator === 'Power' &&
        isFunction(arg.op2) &&
        sym(arg.op2.op1) === 'ExponentialE'
      ) {
        return {
          value: ce._fn('Ln', [arg.op1]).sub(arg.op2.op2),
          because: 'ln(y / e^x) -> ln(y) - x',
        };
      }
    }
  }

  // Handle Log with base
  if (op === 'Log') {
    const arg = x.op1;
    const base = x.op2;
    if (!arg) return undefined;

    // Default base is 10 if not specified (base may be Nothing symbol)
    const logBase = !base || sym(base) === 'Nothing' ? ce.number(10) : base;

    // The exceptional points — 0, 1, the infinities and NaN, in the
    // argument or the base — take the same values as the evaluate route:
    // the quotient rule of `logarithmAtExceptionalPoint`, the single source
    // of truth (`Log(8, 1) = ~oo`, `Log(8, 0) = 0`, `Log(0, 1/2) = +∞`,
    // `Log(+∞, +∞) = NaN`, …). This rule used to keep its own table, which
    // had drifted (base 0 or 1 rewrote to NaN). `Log(−∞, b)` has no exact
    // spelling and declines here, as it stays symbolic under `evaluate()`.
    {
      const special = logarithmAtExceptionalPoint(ce, arg, logBase, false);
      if (special !== undefined)
        return { value: special, because: 'log at an exceptional point' };
    }

    // log_e(x) -> ln(x): base-e logarithm is the natural logarithm
    if (isNaturalLogBase(logBase)) {
      return { value: ce._fn('Ln', [arg]), because: 'log_e(x) -> ln(x)' };
    }

    // log_c(c) -> 1 (an infinite base was answered above: `∞/∞` is NaN)
    if (arg.isSame(logBase) && logBase.isInfinity !== true) {
      return { value: ce.One, because: 'log_c(c) -> 1' };
    }

    // log_c(e) -> 1/ln(c) when c ≠ e
    // This handles log_10(e) -> 1/ln(10) ~ 0.434
    if (sym(arg) === 'ExponentialE' && sym(logBase) !== 'ExponentialE') {
      return {
        value: ce.One.div(ce._fn('Ln', [logBase])),
        because: 'log_c(e) -> 1/ln(c)',
      };
    }

    // log_c(c^x) -> x
    if (isFunction(arg, 'Power') && arg.op1?.isSame(logBase)) {
      return { value: arg.op2, because: 'log_c(c^x) -> x' };
    }

    // log_c(e^x) -> x / ln(c) when c ≠ e
    // This handles log_10(e^x) -> x/ln(10)
    if (
      isFunction(arg, 'Power') &&
      sym(arg.op1) === 'ExponentialE' &&
      !sym(logBase)?.match(/ExponentialE/)
    ) {
      return {
        value: arg.op2.div(ce._fn('Ln', [logBase])),
        because: 'log_c(e^x) -> x/ln(c)',
      };
    }

    // log_c(Exp(x)) -> x / ln(c) when c ≠ e
    if (
      isFunction(arg, 'Exp') &&
      arg.op1 &&
      !sym(logBase)?.match(/ExponentialE/)
    ) {
      return {
        value: arg.op1.div(ce._fn('Ln', [logBase])),
        because: 'log_c(exp(x)) -> x/ln(c)',
      };
    }

    // log_c(x^n) -> n*log_c(x) when x >= 0, or (n odd / irrational) under the
    // generic-real convention (D4) for a real-eligible base not provably on the
    // cut (D3). Mirrors the Ln power rule; a declared-complex base bails and a
    // provably-negative base stays symbolic.
    if (isFunction(arg, 'Power')) {
      const powerBase = arg.op1;
      const exp = arg.op2;
      if (powerBase && exp) {
        if (
          powerBase.isNonNegative === true ||
          (isEligibleRealRewrite(powerBase) &&
            (exp.isOdd === true || exp.isRational === false) &&
            onBranchCut(ce, 'Ln', powerBase) !== true)
        ) {
          return {
            value: exp.mul(ce._fn('Log', [powerBase, logBase])),
            because: 'log_c(x^n) -> n*log_c(x)',
          };
        }
        // log_c(x^n) -> n*log_c(|x|) when n is even — sound for every real x;
        // bail on a declared-complex base (D4).
        if (exp.isEven === true && isEligibleRealRewrite(powerBase)) {
          return {
            value: exp.mul(
              ce._fn('Log', [ce._fn('Abs', [powerBase]), logBase])
            ),
            because: 'log_c(x^n) -> n*log_c(|x|) when n even',
          };
        }
        // log_c(x^{p/q}) for non-integer rational p/q (real-eligible only, D4)
        if (
          exp.isRational === true &&
          exp.isInteger === false &&
          isEligibleRealRewrite(powerBase)
        ) {
          const j = exp.json;
          if (Array.isArray(j) && j[0] === 'Rational') {
            const p = j[1] as number;
            const q = j[2] as number;
            // q even: x >= 0 implied (even root), no |x| needed
            // q odd, p odd: preserves sign, no |x| needed
            // q odd, p even: x^{p/q} is non-negative, need |x|
            if (q % 2 === 0 || p % 2 !== 0) {
              return {
                value: exp.mul(ce._fn('Log', [powerBase, logBase])),
                because: 'log_c(x^{p/q}) -> (p/q)*log_c(x)',
              };
            }
            return {
              value: exp.mul(
                ce._fn('Log', [ce._fn('Abs', [powerBase]), logBase])
              ),
              because: 'log_c(x^{p/q}) -> (p/q)*log_c(|x|) when p even',
            };
          }
        }
      }
    }

    // log_c(c^x * y) -> x + log_c(y)
    if (isFunction(arg, 'Multiply')) {
      for (let i = 0; i < arg.ops.length; i++) {
        const factor = arg.ops[i];
        if (isFunction(factor, 'Power') && factor.op1?.isSame(logBase)) {
          const exp = factor.op2;
          const otherFactors = arg.ops.filter((_, idx) => idx !== i);
          const remaining =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', [...otherFactors]);
          return {
            value: exp.add(ce._fn('Log', [remaining, logBase])),
            because: 'log_c(c^x * y) -> x + log_c(y)',
          };
        }
      }
    }

    // log_c(c^x / y) -> x - log_c(y)
    if (isFunction(arg, 'Divide')) {
      if (
        arg.op1?.operator === 'Power' &&
        isFunction(arg.op1) &&
        arg.op1.op1?.isSame(logBase)
      ) {
        return {
          value: arg.op1.op2.sub(ce._fn('Log', [arg.op2, logBase])),
          because: 'log_c(c^x / y) -> x - log_c(y)',
        };
      }
    }

    // log_c(y / c^x) -> log_c(y) - x
    if (isFunction(arg, 'Divide')) {
      if (
        arg.op2?.operator === 'Power' &&
        isFunction(arg.op2) &&
        arg.op2.op1?.isSame(logBase)
      ) {
        return {
          value: ce._fn('Log', [arg.op1, logBase]).sub(arg.op2.op2),
          because: 'log_c(y / c^x) -> log_c(y) - x',
        };
      }
    }

    // log_c(x/y) -> log_c(x) - log_c(y) (quotient rule expansion)
    // Only apply when both x and y are positive (to avoid branch cut issues)
    if (isFunction(arg, 'Divide')) {
      const num = arg.op1;
      const denom = arg.op2;
      if (num.isPositive === true && denom.isPositive === true) {
        // Don't include 'Nothing' as explicit base
        const isDefaultBase = sym(logBase) === 'Nothing';
        const logNum = isDefaultBase
          ? ce._fn('Log', [num])
          : ce._fn('Log', [num, logBase]);
        const logDenom = isDefaultBase
          ? ce._fn('Log', [denom])
          : ce._fn('Log', [denom, logBase]);
        return {
          value: logNum.sub(logDenom),
          because: 'log_c(x/y) -> log_c(x) - log_c(y)',
        };
      }
    }

    // Change of base: log_{1/c}(a) -> -log_c(a)
    if (isFunction(logBase, 'Divide') && logBase.op1?.isSame(1)) {
      return {
        value: ce._fn('Log', [arg, logBase.op2]).neg(),
        because: 'log_{1/c}(a) -> -log_c(a)',
      };
    }
    // Same rule for Rational(1, q): log_{1/q}(a) -> -log_q(a)
    if (logBase.operator === 'Rational') {
      const bj = logBase.json;
      if (Array.isArray(bj) && bj[0] === 'Rational' && bj[1] === 1) {
        return {
          value: ce._fn('Log', [arg, ce.number(bj[2] as number)]).neg(),
          because: 'log_{1/c}(a) -> -log_c(a)',
        };
      }
    }
  }

  // Handle Power with e and Ln
  if (op === 'Power') {
    const base = x.op1;
    const exp = x.op2;

    if (!base || !exp) return undefined;

    // e^ln(x) -> x
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Ln' &&
      isFunction(exp)
    ) {
      return { value: exp.op1, because: 'e^ln(x) -> x' };
    }

    // e^log_c(x) -> x^{1/ln(c)} when c ≠ e
    // This handles exp(log(x)) = x^{1/ln(10)}
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Log' &&
      isFunction(exp) &&
      exp.op1
    ) {
      const logBase = exp.op2;
      // If no base specified (Nothing) or base is 10, use ln(10)
      const isDefaultOrBase10 =
        !logBase || sym(logBase) === 'Nothing' || logBase.isSame(10);
      if (isDefaultOrBase10) {
        // e^log(x) = e^(ln(x)/ln(10)) = x^{1/ln(10)}
        return {
          value: exp.op1.pow(ce.One.div(ce._fn('Ln', [ce.number(10)]))),
          because: 'e^log(x) -> x^{1/ln(10)}',
        };
      }
      // For other bases: e^log_c(x) = x^{1/ln(c)}
      if (logBase && sym(logBase) !== 'ExponentialE') {
        return {
          value: exp.op1.pow(ce.One.div(ce._fn('Ln', [logBase]))),
          because: 'e^log_c(x) -> x^{1/ln(c)}',
        };
      }
    }

    // e^(ln(x) + y) -> x * e^y
    //
    // Every logarithm term is taken out at once: e^(ln(a) + ln(b) - ln(c) + y)
    // is (a·b/c)·e^y. This holds for any a, b, c, since e^(ln(u)) = u on the
    // whole plane, so it does not need the combination ln(a) + ln(b) ->
    // ln(ab), which requires non-negative arguments.
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Add' &&
      isFunction(exp)
    ) {
      const taken = takeOutLogTerms(ce, exp.ops, (t) => isFunction(t, 'Ln'));
      if (taken !== undefined) {
        const [factor, rest] = taken;
        return {
          value:
            rest === undefined ? factor : factor.mul(ce._fn('Exp', [rest])),
          because: 'e^(ln(x) + y) -> x * e^y',
        };
      }

      // e^(log_c(x) + y) -> x^{1/ln(c)} * e^y
      for (let i = 0; i < exp.ops.length; i++) {
        const term = exp.ops[i];
        if (!isFunction(term, 'Log') || !term.op1) continue;

        const otherTerms = exp.ops.filter((_, idx) => idx !== i);
        const remaining =
          otherTerms.length === 0
            ? ce.Zero
            : otherTerms.length === 1
              ? otherTerms[0]
              : ce._fn('Add', [...otherTerms]);

        const logBase = term.op2;
        const isDefaultOrBase10 =
          !logBase || sym(logBase) === 'Nothing' || logBase.isSame(10);

        const expOfLog = isDefaultOrBase10
          ? term.op1.pow(ce.One.div(ce._fn('Ln', [ce.number(10)])))
          : sym(logBase) === 'ExponentialE'
            ? term.op1
            : term.op1.pow(ce.One.div(ce._fn('Ln', [logBase])));

        return {
          value: expOfLog.mul(base.pow(remaining)),
          because: 'e^(log_c(x) + y) -> x^{1/ln(c)} * e^y',
        };
      }
    }

    // e^(ln(x) * y) -> x^y
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Multiply' &&
      isFunction(exp)
    ) {
      for (let i = 0; i < exp.ops.length; i++) {
        const factor = exp.ops[i];
        if (isFunction(factor, 'Ln')) {
          const otherFactors = exp.ops.filter((_, idx) => idx !== i);
          const y =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', [...otherFactors]);
          return {
            value: factor.op1.pow(y),
            because: 'e^(ln(x) * y) -> x^y',
          };
        }
      }
    }

    // e^(ln(x) / y) -> x^(1/y)
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Divide' &&
      isFunction(exp) &&
      exp.op1?.operator === 'Ln' &&
      isFunction(exp.op1)
    ) {
      return {
        value: exp.op1.op1.pow(ce.One.div(exp.op2)),
        because: 'e^(ln(x) / y) -> x^(1/y)',
      };
    }

    // c^log_c(x) -> x
    if (isFunction(exp, 'Log') && exp.op2?.isSame(base)) {
      return { value: exp.op1, because: 'c^log_c(x) -> x' };
    }

    // c^(log_c(x) + y) -> x * c^y, every log_c term at once (see the
    // e^(ln(x) + y) rule above: c^(log_c(u)) = u for any u).
    if (isFunction(exp, 'Add')) {
      const taken = takeOutLogTerms(
        ce,
        exp.ops,
        (t) => isFunction(t, 'Log') && t.op2?.isSame(base) === true
      );
      if (taken !== undefined) {
        const [factor, rest] = taken;
        return {
          value: rest === undefined ? factor : factor.mul(base.pow(rest)),
          because: 'c^(log_c(x) + y) -> x * c^y',
        };
      }
    }

    // c^(log_c(x) * y) -> x^y
    if (isFunction(exp, 'Multiply')) {
      for (let i = 0; i < exp.ops.length; i++) {
        const factor = exp.ops[i];
        if (isFunction(factor, 'Log') && factor.op2?.isSame(base)) {
          const otherFactors = exp.ops.filter((_, idx) => idx !== i);
          const y =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', [...otherFactors]);
          return {
            value: factor.op1.pow(y),
            because: 'c^(log_c(x) * y) -> x^y',
          };
        }
      }
    }

    // c^(log_c(x) / y) -> x^(1/y)
    if (
      isFunction(exp, 'Divide') &&
      exp.op1?.operator === 'Log' &&
      isFunction(exp.op1) &&
      exp.op1.op2?.isSame(base)
    ) {
      return {
        value: exp.op1.op1.pow(ce.One.div(exp.op2)),
        because: 'c^(log_c(x) / y) -> x^(1/y)',
      };
    }
  }

  // Handle Add for logarithm combination: ln(x) + ln(y) -> ln(xy), ln(x) - ln(y) -> ln(x/y)
  // Note: Subtract is canonicalized to Add with Negate, so we handle both cases here
  if (op === 'Add' && x.ops.length >= 2) {
    // Look for Ln and Log terms, tracking whether they're negated
    // positive: true means ln(x), false means -ln(x) which represents subtraction
    const lnTerms: Array<{
      index: number;
      arg: Expression;
      positive: boolean;
    }> = [];
    const logTerms: Map<
      string,
      Array<{
        index: number;
        arg: Expression;
        base: Expression;
        positive: boolean;
      }>
    > = new Map();

    for (let i = 0; i < x.ops.length; i++) {
      const term = x.ops[i];

      // Direct Ln term
      if (isFunction(term, 'Ln')) {
        lnTerms.push({ index: i, arg: term.op1, positive: true });
      }
      // Negated Ln or Log term: -ln(x) or -log_c(x) which comes from subtraction
      else if (isFunction(term, 'Negate')) {
        const innerTerm = term.op1;
        if (isFunction(innerTerm, 'Ln') && innerTerm.op1) {
          lnTerms.push({ index: i, arg: innerTerm.op1, positive: false });
        } else if (
          isFunction(innerTerm, 'Log') &&
          innerTerm.op1 &&
          innerTerm.op2
        ) {
          if (isNaturalLogBase(innerTerm.op2)) {
            lnTerms.push({
              index: i,
              arg: innerTerm.op1,
              positive: false,
            });
          } else {
            const baseKey = JSON.stringify(innerTerm.op2.json);
            if (!logTerms.has(baseKey)) {
              logTerms.set(baseKey, []);
            }
            logTerms.get(baseKey)!.push({
              index: i,
              arg: innerTerm.op1,
              base: innerTerm.op2,
              positive: false,
            });
          }
        }
      }
      // Direct Log term
      else if (isFunction(term, 'Log') && term.op1 && term.op2) {
        if (isNaturalLogBase(term.op2)) {
          lnTerms.push({ index: i, arg: term.op1, positive: true });
        } else {
          const baseKey = JSON.stringify(term.op2.json);
          if (!logTerms.has(baseKey)) {
            logTerms.set(baseKey, []);
          }
          logTerms
            .get(baseKey)!
            .push({ index: i, arg: term.op1, base: term.op2, positive: true });
        }
      }
    }

    // Combine Ln terms: ln(a) + ln(b) -> ln(ab), ln(a) - ln(b) -> ln(a/b)
    //
    // The combine is valid only for non-negative arguments. Elsewhere the
    // principal values can differ by a multiple of 2πi: at a = b = -1,
    // ln(a) + ln(b) is 2πi but ln(ab) is ln(1) = 0, and at x = 3,
    // ln(2 + x) - ln(2 - x) is ln(5) - πi but ln((2 + x)/(2 - x)) is
    // ln(5) + πi. So only the arguments that are provably non-negative are
    // combined (`isNonNegativeLogArgument()`: by their value, their type, an
    // assumption such as `assume(a > 0)`, or an absolute value); the others
    // stay as they are (cortex-js/compute-engine#397; the policy is in
    // `docs/SIMPLIFY.md`, "Generic-real simplification policy").
    // `combineLogGroup()` also splits a positive constant factor out of an
    // argument, which is valid everywhere, so `ln(2x) - ln(x)` is `ln(2)`.
    const lnResult = combineLogGroup(ce, x.ops, lnTerms, (arg) =>
      ce._fn('Ln', [arg])
    );
    if (lnResult !== undefined)
      return { value: lnResult, because: 'combine ln terms' };

    // Combine Log terms with same base: log_c(a) + log_c(b) -> log_c(ab),
    // with the same requirement as the Ln combine above (log_c(x) is
    // ln(x)/ln(c)).
    for (const [, terms] of logTerms) {
      // Don't include 'Nothing' as explicit base - use single-argument form
      // for default base 10
      const base = terms[0].base;
      const isDefaultBase = sym(base) === 'Nothing';
      const logResult = combineLogGroup(ce, x.ops, terms, (arg) =>
        isDefaultBase ? ce._fn('Log', [arg]) : ce._fn('Log', [arg, base])
      );
      if (logResult !== undefined)
        return { value: logResult, because: 'combine log terms' };
    }
  }

  // Handle Divide for change of base formulas
  if (op === 'Divide') {
    const num = x.op1;
    const denom = x.op2;

    if (num && denom) {
      // log_c(a) / log_c(b) -> ln(a) / ln(b)
      if (
        isFunction(num, 'Log') &&
        denom.operator === 'Log' &&
        isFunction(denom) &&
        num.op2?.isSame(denom.op2)
      ) {
        return {
          value: ce._fn('Ln', [num.op1]).div(ce._fn('Ln', [denom.op1])),
          because: 'log_c(a) / log_c(b) -> ln(a) / ln(b)',
        };
      }

      // log_c(a) / ln(a) -> 1/ln(c)
      if (
        isFunction(num, 'Log') &&
        denom.operator === 'Ln' &&
        isFunction(denom) &&
        num.op1?.isSame(denom.op1)
      ) {
        return {
          value: ce.One.div(ce._fn('Ln', [num.op2])),
          because: 'log_c(a) / ln(a) -> 1/ln(c)',
        };
      }

      // ln(a) / log_c(a) -> ln(c)
      if (
        isFunction(num, 'Ln') &&
        denom.operator === 'Log' &&
        isFunction(denom) &&
        num.op1?.isSame(denom.op1)
      ) {
        return {
          value: ce._fn('Ln', [denom.op2]),
          because: 'ln(a) / log_c(a) -> ln(c)',
        };
      }

      // ln(a) / ln(b) -> k when a = b^k for positive integers a, b
      if (
        isFunction(num, 'Ln') &&
        denom.operator === 'Ln' &&
        isFunction(denom)
      ) {
        const a = num.op1;
        const b = denom.op1;
        if (
          a &&
          b &&
          a.isInteger === true &&
          b.isInteger === true &&
          a.isPositive === true &&
          b.isPositive === true
        ) {
          const aVal = a.re;
          const bVal = b.re;
          if (
            Number.isFinite(aVal) &&
            Number.isFinite(bVal) &&
            bVal > 1 &&
            aVal > 0
          ) {
            // Check if a = b^k for some non-negative integer k.
            //
            // The machine-float `Math.log(a)/Math.log(b)` only supplies a
            // *candidate* exponent: above 2^53 the float versions of `a`/`b`
            // lose precision and `Math.pow(b, k) === a` can report a false
            // equality (e.g. two distinct huge integers whose float images
            // coincide). Verify the candidate with exact bigint exponentiation
            // instead, so a match is only reported when `b^k === a` holds on the
            // true integers. Probe a small window around the float guess to
            // absorb the log's rounding error for very large operands.
            const aBig = toBigint(a);
            const bBig = toBigint(b);
            if (aBig !== null && bBig !== null && bBig > 1n) {
              const kRaw = Math.log(aVal) / Math.log(bVal);
              const kGuess = Math.round(kRaw);
              for (const k of [kGuess - 1, kGuess, kGuess + 1]) {
                if (k < 0) continue;
                if (bBig ** BigInt(k) === aBig) {
                  return {
                    value: ce.number(k),
                    because: 'ln(a)/ln(b) -> k when a = b^k',
                  };
                }
              }
            }
          }
        }
      }
    }
  }

  return undefined;
}
