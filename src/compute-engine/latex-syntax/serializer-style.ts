import { MathJsonExpression } from '../../math-json/types.js';
import {
  countLeaves,
  machineValue,
  operand,
  operator,
  operands,
} from '../../math-json/utils.js';
import { DelimiterScale } from './types.js';
import { joinLatex } from './tokenizer.js';

export function getApplyFunctionStyle(
  _expr: MathJsonExpression,
  _level: number
): DelimiterScale {
  return 'normal';
}

export function getGroupStyle(
  _expr: MathJsonExpression,
  _level: number
): DelimiterScale {
  return 'normal';
}

export function getRootStyle(
  _expr: MathJsonExpression | null,
  level: number
): 'radical' | 'quotient' | 'solidus' {
  return level > 2 ? 'solidus' : 'radical';
}

export function getFractionStyle(
  expr: MathJsonExpression,
  level: number
):
  | 'quotient'
  | 'block-quotient'
  | 'inline-quotient'
  | 'inline-solidus'
  | 'nice-solidus'
  | 'reciprocal'
  | 'factor' {
  if (level > 3) return 'inline-solidus';

  if (operator(expr) === 'Divide') {
    const [op1, op2] = operands(expr);
    const [n, d] = [countLeaves(op1), countLeaves(op2)];
    // A long numerator over a single power of a small base reads better with an
    // inline solidus — `(...)/x^{23}`, `(...)/x^2`, `(...)/\sqrt{x}` — than as a
    // tall fraction with a tiny denominator. Covers `Power(b, k≥2)`,
    // `Square(b)` and `Sqrt(b)`. Checked before the `factor` branch below so a
    // `Sqrt` denominator (which `factor` would otherwise peel off as
    // `\frac{1}{\sqrt{x}}(...)`) takes this path instead.
    if (n > 5 && isSinglePowerDenominator(op2)) return 'inline-solidus';
    if (d <= 2 && n > 5) return 'factor';
    const denomOp = operator(op2);
    // Prefer quotient over reciprocal when denominator is Sqrt/Root
    // so that 1/sqrt(x) displays as \frac{1}{\sqrt{x}} not \sqrt{x}^{-1}
    if (n <= 2 && d > 5 && denomOp !== 'Sqrt' && denomOp !== 'Root')
      return 'reciprocal';
  }
  return 'quotient';
}

/**
 * True if `denom` is a single power of a *small* base — `Power(base, k)` with
 * an integer `k ≥ 2`, `Square(base)` (k = 2), or `Sqrt(base)` (k = 1/2), where
 * `base` is at most two leaves (e.g. `x`, `2x` is excluded as a product). Used
 * to pick the inline-solidus fraction style for a long numerator over such a
 * denominator.
 */
function isSinglePowerDenominator(denom: MathJsonExpression | null): boolean {
  if (denom === null) return false;
  const base = operand(denom, 1);
  if (base === null || countLeaves(base) > 2) return false;
  switch (operator(denom)) {
    case 'Power': {
      const exp = machineValue(operand(denom, 2));
      return exp !== null && Number.isInteger(exp) && exp >= 2;
    }
    case 'Square':
    case 'Sqrt':
      return true;
    default:
      return false;
  }
}

// https://en.wikipedia.org/wiki/Logical_connective
export function getLogicStyle(
  _expr: MathJsonExpression,
  _level: number
): 'word' | 'boolean' | 'uppercase-word' | 'punctuation' {
  // punctuation = & | !
  // word = and or not
  // uppercase-word = AND OR NOT
  // boolean = ∧ ∨ ¬
  return 'boolean';
}

export function getPowerStyle(
  _expr: MathJsonExpression,
  _level: number
): 'root' | 'solidus' | 'quotient' {
  return 'solidus';
}

//  * - "N"           Q28920044 Natural numbers (positive integers): 1, 2, 3, 4, ...
//  * - "Z^*"          Non-Zero integers: -2, -1, 1, 2, 3, ...
//  * - "R_-":         Q200227 Negative real number <0
//  * - "R_+"          Q3176558 Positive real numbers (JS float) >0
//  * - "R^0_-":        Q47341108 Non-positive real number <= 0
//  * - "R^0_+"         Q13896108 Non-negative real numbers (JS float) >=0
//  * - "R"           Real numbers (JS float)

// Re: "set builder notation"
// The notation itself in its modern form can be traced back to Lefschetz's
// Algebraic Topology (1942), and variants appear already in Principia (1910)
// and von Neumann's Zur Einführung der transfiniten Zahlen (1923). See Who
// first discovered the concept corresponding to the symbol of class
// comprehension? for many more details. However, mathematicians did not use the
// name "set-builder". Bernays (1958) calls it "class operator" and Suppes
// (1960) "definition by abstraction". The name does not appear before 1957, but
// in 1958 we find it in the lively discussions of the high school curriculum in
// The Mathematics Teacher. E.g. Rourke's Some implications of twentieth century
// mathematics for high schools explains:

// A 1948 University of Chicago Press publication Fundamental Mathematics Volume
// 1 Prepared for the General Course 1 in the College ("by the College
// mathematics staff" with a list of 13 names) uses the term "SET-BUILDER" on
// p.25.

// https://hsm.stackexchange.com/questions/3445/first-use-of-curly-braces-to-denote-a-set

// Compact:     \R^*
// Regular       R \setminus { 0 }
// Interval     ]-\infty, 0( \union )0, \infty ]
// Set builder  { x \in \R | x \ne 0 }

// Compact      \N^0
// Regular      \N \union { 0 }
// Interval     [0, 1..]
// Set Builder  { x \in \Z | x > 0 }
export function getNumericSetStyle(
  _expr: MathJsonExpression,
  _level: number
): 'compact' | 'regular' | 'interval' | 'set-builder' {
  return 'compact';
}

export function getIndexStyle(
  _expr: MathJsonExpression,
  _level: number
): 'subscript' | 'bracket' {
  return 'subscript';
}

// Apply template strings to the expression
// The template string s is a LaTeX template string with two placeholders: #1 and #2
// (if the placeholders are omitted, they are assumed to precede and follow the
// string).
export function latexTemplate(s: string, lhs: string, rhs: string): string {
  if (s.indexOf('#1') < 0 && s.indexOf('#2') < 0) s = `#1 ${s} #2`;

  // First, turn the template string s into an array with the placeholders
  // separate elements. So for `s = '#1 + #2'`, parts = ['#1', ' + ', '#2']
  const parts = s
    .split(/(#\d+)/)
    .filter((x) => x.trim() !== '')
    .map((x) => x.trim());

  // Replace the placeholders with the actual values
  return joinLatex(
    parts.map((x) => {
      switch (x) {
        case '#1':
          return lhs;
        case '#2':
          return rhs;
        default:
          return x;
      }
    })
  );
}
