import { Expression } from '../../math-json/math-json-format';

export function getApplyFunctionStyle(
  _expr: Expression,
  _level: number
): 'paren' | 'leftright' | 'big' | 'none' {
  return 'paren';
}

export function getGroupStyle(
  _expr: Expression,
  _level: number
): 'paren' | 'leftright' | 'big' | 'none' {
  return 'paren';
}

export function getRootStyle(
  _expr: Expression | null,
  level: number
): 'radical' | 'quotient' | 'solidus' {
  if (level > 2) return 'solidus';
  return 'radical';
}

export function getFractionStyle(
  _expr: Expression,
  level: number
): 'quotient' | 'inline-solidus' | 'nice-solidus' | 'reciprocal' | 'factor' {
  if (level > 3) return 'inline-solidus';
  return 'quotient';
}

// https://en.wikipedia.org/wiki/Logical_connective
export function getLogicStyle(
  _expr: Expression,
  _level: number
): 'word' | 'boolean' | 'uppercase-word' | 'punctuation' {
  // punctuation = & | !
  // word = and or not
  // uppercase-word = AND OR NOT
  // boolean = ∧ ∨ ¬
  return 'boolean';
}

export function getPowerStyle(
  _expr: Expression,
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
  _expr: Expression,
  _level: number
): 'compact' | 'regular' | 'interval' | 'set-builder' {
  return 'compact';
}
