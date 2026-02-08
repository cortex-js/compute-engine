import type { BoxedExpression, RuleStep } from '../global-types';
import {
  isBoxedFunction,
  isBoxedSymbol,
  sym,
} from '../boxed-expression/type-guards';

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

export function simplifyLog(x: BoxedExpression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  if (!isBoxedFunction(x)) return undefined;

  // Handle Ln
  if (op === 'Ln') {
    const arg = x.op1;
    if (!arg) return undefined;

    // ln(0) -> NaN
    if (arg.is(0)) {
      return { value: ce.NaN, because: 'ln(0) -> NaN' };
    }

    // ln(+inf) -> +inf
    if (sym(arg) === 'PositiveInfinity') {
      return { value: ce.PositiveInfinity, because: 'ln(+inf) -> +inf' };
    }

    // ln(x^n) -> n*ln(x) when x >= 0 or n is odd or n is irrational
    if (arg.operator === 'Power' && isBoxedFunction(arg)) {
      const base = arg.op1;
      const exp = arg.op2;
      if (base && exp) {
        // ln(x^n) -> n*ln(x) when x is non-negative or n is odd or n is irrational
        if (
          base.isNonNegative === true ||
          exp.isOdd === true ||
          exp.isRational === false
        ) {
          return {
            value: exp.mul(ce._fn('Ln', [base])),
            because: 'ln(x^n) -> n*ln(x)',
          };
        }
        // ln(x^n) -> n*ln(|x|) when n is even
        if (exp.isEven === true) {
          return {
            value: exp.mul(ce._fn('Ln', [ce._fn('Abs', [base])])),
            because: 'ln(x^n) -> n*ln(|x|) when n even',
          };
        }
      }
    }

    // ln(e^x) -> x
    if (
      arg.operator === 'Power' &&
      isBoxedFunction(arg) &&
      sym(arg.op1) === 'ExponentialE'
    ) {
      return { value: arg.op2, because: 'ln(e^x) -> x' };
    }

    // ln(e^x * y) -> x + ln(y)
    if (arg.operator === 'Multiply' && isBoxedFunction(arg)) {
      for (let i = 0; i < arg.ops.length; i++) {
        const factor = arg.ops[i];
        if (
          factor.operator === 'Power' &&
          isBoxedFunction(factor) &&
          sym(factor.op1) === 'ExponentialE'
        ) {
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
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
      if (
        arg.op1?.operator === 'Power' &&
        isBoxedFunction(arg.op1) &&
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
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
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
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
      if (
        arg.op2?.operator === 'Power' &&
        isBoxedFunction(arg.op2) &&
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

    // log_c(x) -> NaN when c is 0 or 1
    if (logBase.is(0) || logBase.is(1)) {
      return { value: ce.NaN, because: 'log base 0 or 1 -> NaN' };
    }

    // log_c(0) -> NaN
    if (arg.is(0)) {
      return { value: ce.NaN, because: 'log(0) -> NaN' };
    }

    // log_c(c) -> 1
    if (arg.isSame(logBase)) {
      return { value: ce.One, because: 'log_c(c) -> 1' };
    }

    // log_c(e) -> 1/ln(c) when c ≠ e
    // This handles log_10(e) -> 1/ln(10) ~ 0.434
    if (
      sym(arg) === 'ExponentialE' &&
      sym(logBase) !== 'ExponentialE'
    ) {
      return {
        value: ce.One.div(ce._fn('Ln', [logBase])),
        because: 'log_c(e) -> 1/ln(c)',
      };
    }

    // log_c(+inf) patterns
    if (sym(arg) === 'PositiveInfinity') {
      // log_c(+inf) -> +inf when c > 1
      if (logBase.isGreater(1) === true) {
        return {
          value: ce.PositiveInfinity,
          because: 'log_c(+inf) -> +inf when c > 1',
        };
      }
      // log_c(+inf) -> -inf when 0 < c < 1
      if (logBase.isLess(1) === true && logBase.isPositive === true) {
        return {
          value: ce.NegativeInfinity,
          because: 'log_c(+inf) -> -inf when 0 < c < 1',
        };
      }
    }

    // log_c(x, +inf) -> 0 when x is positive, x != 1, and x is finite
    if (
      sym(logBase) === 'PositiveInfinity' &&
      arg.isPositive === true &&
      arg.is(1) === false &&
      arg.isFinite === true
    ) {
      return { value: ce.Zero, because: 'log_inf(x) -> 0' };
    }

    // log_c(c^x) -> x
    if (
      arg.operator === 'Power' &&
      isBoxedFunction(arg) &&
      arg.op1?.isSame(logBase)
    ) {
      return { value: arg.op2, because: 'log_c(c^x) -> x' };
    }

    // log_c(e^x) -> x / ln(c) when c ≠ e
    // This handles log_10(e^x) -> x/ln(10)
    if (
      arg.operator === 'Power' &&
      isBoxedFunction(arg) &&
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
      arg.operator === 'Exp' &&
      isBoxedFunction(arg) &&
      arg.op1 &&
      !sym(logBase)?.match(/ExponentialE/)
    ) {
      return {
        value: arg.op1.div(ce._fn('Ln', [logBase])),
        because: 'log_c(exp(x)) -> x/ln(c)',
      };
    }

    // log_c(x^n) -> n*log_c(x) when x >= 0 or n is odd or n is irrational
    if (arg.operator === 'Power' && isBoxedFunction(arg)) {
      const powerBase = arg.op1;
      const exp = arg.op2;
      if (powerBase && exp) {
        if (
          powerBase.isNonNegative === true ||
          exp.isOdd === true ||
          exp.isRational === false
        ) {
          return {
            value: exp.mul(ce._fn('Log', [powerBase, logBase])),
            because: 'log_c(x^n) -> n*log_c(x)',
          };
        }
        // log_c(x^n) -> n*log_c(|x|) when n is even
        if (exp.isEven === true) {
          return {
            value: exp.mul(
              ce._fn('Log', [ce._fn('Abs', [powerBase]), logBase])
            ),
            because: 'log_c(x^n) -> n*log_c(|x|) when n even',
          };
        }
      }
    }

    // log_c(c^x * y) -> x + log_c(y)
    if (arg.operator === 'Multiply' && isBoxedFunction(arg)) {
      for (let i = 0; i < arg.ops.length; i++) {
        const factor = arg.ops[i];
        if (
          factor.operator === 'Power' &&
          isBoxedFunction(factor) &&
          factor.op1?.isSame(logBase)
        ) {
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
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
      if (
        arg.op1?.operator === 'Power' &&
        isBoxedFunction(arg.op1) &&
        arg.op1.op1?.isSame(logBase)
      ) {
        return {
          value: arg.op1.op2.sub(ce._fn('Log', [arg.op2, logBase])),
          because: 'log_c(c^x / y) -> x - log_c(y)',
        };
      }
    }

    // log_c(y / c^x) -> log_c(y) - x
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
      if (
        arg.op2?.operator === 'Power' &&
        isBoxedFunction(arg.op2) &&
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
    if (arg.operator === 'Divide' && isBoxedFunction(arg)) {
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
    if (
      logBase.operator === 'Divide' &&
      isBoxedFunction(logBase) &&
      logBase.op1?.is(1)
    ) {
      return {
        value: ce._fn('Log', [arg, logBase.op2]).neg(),
        because: 'log_{1/c}(a) -> -log_c(a)',
      };
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
      isBoxedFunction(exp)
    ) {
      return { value: exp.op1, because: 'e^ln(x) -> x' };
    }

    // e^log_c(x) -> x^{1/ln(c)} when c ≠ e
    // This handles exp(log(x)) = x^{1/ln(10)}
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Log' &&
      isBoxedFunction(exp) &&
      exp.op1
    ) {
      const logBase = exp.op2;
      // If no base specified (Nothing) or base is 10, use ln(10)
      const isDefaultOrBase10 =
        !logBase || sym(logBase) === 'Nothing' || logBase.is(10);
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
    if (
      sym(base) === 'ExponentialE' &&
      exp.operator === 'Add' &&
      isBoxedFunction(exp)
    ) {
      for (let i = 0; i < exp.ops.length; i++) {
        const term = exp.ops[i];
        if (term.operator === 'Ln' && isBoxedFunction(term)) {
          const otherTerms = exp.ops.filter((_, idx) => idx !== i);
          const remaining =
            otherTerms.length === 0
              ? ce.Zero
              : otherTerms.length === 1
                ? otherTerms[0]
                : ce._fn('Add', [...otherTerms]);
          return {
            value: term.op1.mul(ce._fn('Exp', [remaining])),
            because: 'e^(ln(x) + y) -> x * e^y',
          };
        }
      }

      // e^(log_c(x) + y) -> x^{1/ln(c)} * e^y
      for (let i = 0; i < exp.ops.length; i++) {
        const term = exp.ops[i];
        if (
          term.operator !== 'Log' ||
          !isBoxedFunction(term) ||
          !term.op1
        )
          continue;

        const otherTerms = exp.ops.filter((_, idx) => idx !== i);
        const remaining =
          otherTerms.length === 0
            ? ce.Zero
            : otherTerms.length === 1
              ? otherTerms[0]
              : ce._fn('Add', [...otherTerms]);

        const logBase = term.op2;
        const isDefaultOrBase10 =
          !logBase || sym(logBase) === 'Nothing' || logBase.is(10);

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
      isBoxedFunction(exp)
    ) {
      for (let i = 0; i < exp.ops.length; i++) {
        const factor = exp.ops[i];
        if (factor.operator === 'Ln' && isBoxedFunction(factor)) {
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
      isBoxedFunction(exp) &&
      exp.op1?.operator === 'Ln' &&
      isBoxedFunction(exp.op1)
    ) {
      return {
        value: exp.op1.op1.pow(ce.One.div(exp.op2)),
        because: 'e^(ln(x) / y) -> x^(1/y)',
      };
    }

    // c^log_c(x) -> x
    if (
      exp.operator === 'Log' &&
      isBoxedFunction(exp) &&
      exp.op2?.isSame(base)
    ) {
      return { value: exp.op1, because: 'c^log_c(x) -> x' };
    }

    // c^(log_c(x) + y) -> x * c^y
    if (exp.operator === 'Add' && isBoxedFunction(exp)) {
      for (let i = 0; i < exp.ops.length; i++) {
        const term = exp.ops[i];
        if (
          term.operator === 'Log' &&
          isBoxedFunction(term) &&
          term.op2?.isSame(base)
        ) {
          const otherTerms = exp.ops.filter((_, idx) => idx !== i);
          const remaining =
            otherTerms.length === 0
              ? ce.Zero
              : otherTerms.length === 1
                ? otherTerms[0]
                : ce._fn('Add', [...otherTerms]);
          return {
            value: term.op1.mul(base.pow(remaining)),
            because: 'c^(log_c(x) + y) -> x * c^y',
          };
        }
      }
    }

    // c^(log_c(x) * y) -> x^y
    if (exp.operator === 'Multiply' && isBoxedFunction(exp)) {
      for (let i = 0; i < exp.ops.length; i++) {
        const factor = exp.ops[i];
        if (
          factor.operator === 'Log' &&
          isBoxedFunction(factor) &&
          factor.op2?.isSame(base)
        ) {
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
      exp.operator === 'Divide' &&
      isBoxedFunction(exp) &&
      exp.op1?.operator === 'Log' &&
      isBoxedFunction(exp.op1) &&
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
      arg: BoxedExpression;
      positive: boolean;
    }> = [];
    const logTerms: Map<
      string,
      Array<{
        index: number;
        arg: BoxedExpression;
        base: BoxedExpression;
        positive: boolean;
      }>
    > = new Map();

    for (let i = 0; i < x.ops.length; i++) {
      const term = x.ops[i];

      // Direct Ln term
      if (term.operator === 'Ln' && isBoxedFunction(term)) {
        lnTerms.push({ index: i, arg: term.op1, positive: true });
      }
      // Negated Ln or Log term: -ln(x) or -log_c(x) which comes from subtraction
      else if (term.operator === 'Negate' && isBoxedFunction(term)) {
        const innerTerm = term.op1;
        if (
          innerTerm.operator === 'Ln' &&
          isBoxedFunction(innerTerm) &&
          innerTerm.op1
        ) {
          lnTerms.push({ index: i, arg: innerTerm.op1, positive: false });
        } else if (
          innerTerm.operator === 'Log' &&
          isBoxedFunction(innerTerm) &&
          innerTerm.op1 &&
          innerTerm.op2
        ) {
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
      // Direct Log term
      else if (
        term.operator === 'Log' &&
        isBoxedFunction(term) &&
        term.op1 &&
        term.op2
      ) {
        const baseKey = JSON.stringify(term.op2.json);
        if (!logTerms.has(baseKey)) {
          logTerms.set(baseKey, []);
        }
        logTerms
          .get(baseKey)!
          .push({ index: i, arg: term.op1, base: term.op2, positive: true });
      }
    }

    // Combine Ln terms: ln(a) + ln(b) -> ln(ab), ln(a) - ln(b) -> ln(a/b)
    if (lnTerms.length >= 2) {
      // Combine all Ln terms: multiply positives, divide negatives
      // Result is ln(product of positives / product of negatives)
      let numerator = ce.One;
      let denominator = ce.One;
      for (const t of lnTerms) {
        if (t.positive) {
          numerator = numerator.mul(t.arg);
        } else {
          denominator = denominator.mul(t.arg);
        }
      }

      const combinedArg = numerator.div(denominator);
      const combinedIndices = new Set(lnTerms.map((t) => t.index));
      const remainingTerms = [...x.ops].filter(
        (_, i) => !combinedIndices.has(i)
      );

      if (remainingTerms.length === 0) {
        return {
          value: ce._fn('Ln', [combinedArg]),
          because: 'combine ln terms',
        };
      }
      return {
        value: ce._fn('Add', [ce._fn('Ln', [combinedArg]), ...remainingTerms]),
        because: 'combine ln terms',
      };
    }

    // Combine Log terms with same base: log_c(a) + log_c(b) -> log_c(ab)
    for (const [, terms] of logTerms) {
      if (terms.length >= 2) {
        let numerator = ce.One;
        let denominator = ce.One;
        for (const t of terms) {
          if (t.positive) {
            numerator = numerator.mul(t.arg);
          } else {
            denominator = denominator.mul(t.arg);
          }
        }

        const combinedArg = numerator.div(denominator);
        const combinedIndices = new Set(terms.map((t) => t.index));
        const remainingTerms = [...x.ops].filter(
          (_, i) => !combinedIndices.has(i)
        );

        // Don't include 'Nothing' as explicit base - use single-argument form for default base 10
        const base = terms[0].base;
        const isDefaultBase = sym(base) === 'Nothing';
        const combinedLog = isDefaultBase
          ? ce._fn('Log', [combinedArg])
          : ce._fn('Log', [combinedArg, base]);

        if (remainingTerms.length === 0) {
          return {
            value: combinedLog,
            because: 'combine log terms',
          };
        }
        return {
          value: ce._fn('Add', [combinedLog, ...remainingTerms]),
          because: 'combine log terms',
        };
      }
    }
  }

  // Handle Divide for change of base formulas
  if (op === 'Divide') {
    const num = x.op1;
    const denom = x.op2;

    if (num && denom) {
      // log_c(a) / log_c(b) -> ln(a) / ln(b)
      if (
        num.operator === 'Log' &&
        isBoxedFunction(num) &&
        denom.operator === 'Log' &&
        isBoxedFunction(denom) &&
        num.op2?.isSame(denom.op2)
      ) {
        return {
          value: ce._fn('Ln', [num.op1]).div(ce._fn('Ln', [denom.op1])),
          because: 'log_c(a) / log_c(b) -> ln(a) / ln(b)',
        };
      }

      // log_c(a) / ln(a) -> 1/ln(c)
      if (
        num.operator === 'Log' &&
        isBoxedFunction(num) &&
        denom.operator === 'Ln' &&
        isBoxedFunction(denom) &&
        num.op1?.isSame(denom.op1)
      ) {
        return {
          value: ce.One.div(ce._fn('Ln', [num.op2])),
          because: 'log_c(a) / ln(a) -> 1/ln(c)',
        };
      }

      // ln(a) / log_c(a) -> ln(c)
      if (
        num.operator === 'Ln' &&
        isBoxedFunction(num) &&
        denom.operator === 'Log' &&
        isBoxedFunction(denom) &&
        num.op1?.isSame(denom.op1)
      ) {
        return {
          value: ce._fn('Ln', [denom.op2]),
          because: 'ln(a) / log_c(a) -> ln(c)',
        };
      }
    }
  }

  return undefined;
}
