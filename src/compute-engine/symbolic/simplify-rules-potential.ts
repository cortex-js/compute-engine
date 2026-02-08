/**
 * POTENTIAL SIMPLIFICATION RULES
 *
 * This file contains experimental, incomplete, or situational simplification
 * rules that are NOT currently active. They are preserved here for future
 * reference and potential implementation.
 *
 * Rules that are already implemented in active files have been removed.
 * See the active implementations in:
 * - simplify-abs.ts - absolute value rules
 * - simplify-log.ts - logarithm rules
 * - simplify-power.ts - power/exponent rules
 * - simplify-trig.ts - trigonometric rules
 * - simplify-hyperbolic.ts - hyperbolic trig rules
 * - simplify-infinity.ts - infinity-related rules
 *
 * Categories in this file:
 * - Rules marked "NEW" that don't work correctly yet
 * - "Situational" rules that may not always be desirable
 * - Rules with known issues (e.g., "gives infinity instead of NaN")
 * - Logarithm combination rules (may increase complexity)
 * - Domain-sensitive rules with complex conditions
 *
 * NOTE: Many rules use LaTeX string syntax (e.g., 'x^n') which requires
 * parsing. For better performance, convert to MathJSON array syntax
 * (e.g., ['Power', '_x', '_n']) when activating.
 */

import type { Rule } from '../global-types';

/**
 * Potential rules that are NOT currently active.
 * Uncomment and move to appropriate file to activate.
 */
export const POTENTIAL_RULES: Rule[] = [
  /*
  // ========================================
  // NEW RULES - Don't work correctly yet
  // ========================================
  // These rules for handling (-x)^n are mathematically correct but
  // the implementation doesn't work because the negative sign is kept.
  // Needs investigation into how Negate interacts with Power.

  // (-x)^n -> x^n when n is even (doesn't work b/c keeps - sign)
  {
    match: '(-x)^n',
    replace: 'x^n',
    condition: ({ _n }) => _n.isEven === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: 'x^{n/m}',
    condition: ({ _n, _m }) => _n.isEven === true && _m.isOdd === true,
  },

  // (-x)^n -> -x^n when n is odd
  {
    match: '(-x)^n',
    replace: '-x^n',
    condition: ({ _n }) => _n.isOdd === true,
  },
  {
    match: '(-x)^{n/m}',
    replace: '-x^{n/m}',
    condition: (ids) => ids._n.isOdd === true && ids._m.isOdd === true,
  },

  // ========================================
  // SITUATIONAL RULES
  // ========================================
  // These rules are mathematically correct but may not always produce
  // simpler expressions. Use with caution.

  // Fraction addition - may increase complexity
  {
    match: 'a/b+c/d',
    replace: '(a*d+b*c)/(b*d)',
    condition: (ids) => ids._a.isNotZero === true,
  },

  // ========================================
  // RULES WITH KNOWN ISSUES
  // ========================================
  // These rules produce incorrect results in the current implementation.
  // They document expected behavior that differs from actual behavior.

  // Division by zero - currently gives infinity instead of NaN
  {
    match: ['Divide', '_x', 0],
    replace: toNaN,
  },

  // 0^x when x is non-positive - currently gives infinity instead of NaN
  {
    match: ['Power', 0, '_x'],
    replace: toNaN,
    condition: (ids) => ids._x.isNonPositive === true,
  },

  // 0 * infinity - currently gives 0, should be NaN (indeterminate)
  {
    match: ['Multiply', 0, '_x'],
    replace: toNaN,
    condition: (_x) => _x._x.isInfinity === true,
  },

  // ========================================
  // LOGARITHM COMBINATION RULES
  // ========================================
  // These rules are mathematically correct but may not always simplify
  // expressions. For example, ln(2) + ln(3) -> ln(6) increases the
  // argument size. They also assume negative arguments are allowed,
  // which may not be appropriate in all contexts.

  // ln(x) + ln(y) -> ln(x*y)
  {
    match: ['Add', ['Ln', '_x'], ['Ln', '_y']],
    replace: (expr, ids) => expr.engine._fn('Ln', [ids._x.mul(ids._y)]),
  },

  // ln(x) - ln(y) -> ln(x/y)
  {
    match: ['Subtract', ['Ln', '_x'], ['Ln', '_y']],
    replace: (expr, ids) => expr.engine._fn('Ln', [ids._x.div(ids._y)]),
  },

  // log_c(x) + log_c(y) -> log_c(x*y)
  {
    match: ['Add', ['Log', '_x', '_c'], ['Log', '_y', '_c']],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._x.mul(ids._y), ids._c]),
  },

  // log_c(x) - log_c(y) -> log_c(x/y)
  {
    match: ['Subtract', ['Log', '_x', '_c'], ['Log', '_y', '_c']],
    replace: (expr, ids) =>
      expr.engine._fn('Log', [ids._x.div(ids._y), ids._c]),
  },

  // ========================================
  // DOMAIN-SENSITIVE POWER RULES
  // ========================================
  // These rules have complex domain conditions that need careful
  // consideration. They use LaTeX syntax which requires parsing.

  // x/x^n -> 1/x^{n-1}
  {
    match: 'x/x^n',
    replace: '1/x^{n-1}',
    condition: (ids) => ids._x.isNotZero || ids._n.isGreater(1) === true,
  },

  // x^n/x -> 1/x^{1-n}
  {
    match: 'x^n/x',
    replace: '1/x^{1-n}',
    condition: (ids) => ids._x.isNotZero || ids._n.isLess(1) === true,
  },

  // x^n*x -> x^{n+1} (with domain checks)
  {
    match: 'x^n*x',
    replace: 'x^{n+1}',
    condition: (ids) =>
      ids._x.isNotZero === true ||
      ids._n.isPositive === true ||
      ids._x.isLess(-1) === true,
  },

  // x^n*x^m -> x^{n+m} (with complex domain checks)
  {
    match: 'x^n*x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true ||
        ids._n.add(ids._m).isNegative === true ||
        ids._n.mul(ids._m).isPositive === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.add(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  },

  // x^n/x^m -> x^{n-m} (with domain checks)
  {
    match: 'x^n/x^m',
    replace: 'x^{n+m}',
    condition: (ids) =>
      (ids._x.isNotZero === true || ids._n.add(ids._m).isNegative === true) &&
      (ids._n.isInteger === true ||
        ids._m.isInteger === true ||
        ids._n.sub(ids._m).isRational === false ||
        ids._x.isNonNegative === true),
  },

  // (a^n)^m -> a^{m*n} (with domain checks)
  // @fixme: this rule may not be correct for all n,m
  {
    match: '(a^n)^m',
    replace: 'a^{m*n}',
    condition: (ids) =>
      ((ids._n.isInteger === true && ids._m.isInteger === true) ||
        ids._a.isNonNegative ||
        ids._n.mul(ids._m).isRational === false) &&
      (ids._n.isPositive === true || ids._m.isPositive === true),
  },

  // ========================================
  // LOGARITHM POWER RULES (LaTeX syntax)
  // ========================================
  // These are alternative formulations using LaTeX syntax.
  // The MathJSON versions are already active in simplify-log.ts.

  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\ln(x^{n/k})',
    replace: 'n*\\ln(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\ln(x^n)',
    replace: 'n*\\ln(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(x)',
    condition: (ids) =>
      ids._x.isNonNegative ||
      ids._n.isOdd === true ||
      ids._n.isRational === false,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(x)/k',
    condition: (ids) => ids._x.isNonNegative || ids._n.isOdd === true,
  },
  {
    match: '\\log_c(x^{n/k})',
    replace: 'n*\\log_c(|x|)/k',
    condition: (ids) => ids._n.isEven === true && ids._k.isOdd === true,
  },
  {
    match: '\\log_c(x^n)',
    replace: 'n*\\log_c(|x|)',
    condition: (ids) => ids._n.isEven === true,
  },
  */
];
