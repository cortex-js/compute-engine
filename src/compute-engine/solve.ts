import {
  getArg,
  getFunctionName,
  getNumberValue,
  MISSING,
} from '../common/utils';
import { Expression, Substitution } from '../math-json/math-json-format';
import { match, substitute } from './patterns';
import {
  ComputeEngine,
  Numeric,
  Pattern,
} from '../math-json/compute-engine-interface';

// https://en.wikipedia.org/wiki/Equation_solving

export type Solution = [
  lhs: string | Pattern<Numeric>,
  solutions: (string | Pattern<Numeric>)[],
  condition?: (ce: ComputeEngine<Numeric>, vars: Substitution) => boolean
];

//
// UNIVARIATE_ROOTS is a collection of rules that find the roots for
// various expressions.
//
// The lhs pattern is a function of (x, y, z)
//
// @todo: MOAR RULES
// x^2, x^2 + a,  a x^2 + b
// \sin(x)...
// polynomials...
// a \sqrt{x} + b
// a \ln x + b
// a e^x + b
//
// cos x, acos x, n cos x + a
export const UNIVARIATE_ROOTS: Solution[] = [
  ['x + a', ['-a']],

  ['ax + b', ['\\frac{-b}{a}']],

  // Quadratic formula (real)
  // @todo: add rule for when b or c is 0
  [
    'ax^2 + bx + c',
    [
      '\\frac{{ - b + \\sqrt{b^2 - 4ac} }}{{2a}}',
      '\\frac{{ - b - \\sqrt{b^2 - 4ac} }}{{2a}}',
    ],
    (ce: ComputeEngine, vars: Substitution): boolean =>
      ce.isReal(vars.x) === true,
  ],

  // Quadratic formula (complex)
  [
    'ax^2 + bx + c',
    [
      '-\\frac{b}{2a} - \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}',
      '-\\frac{b}{2a} + \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}',
    ],
    (ce: ComputeEngine, vars: Substitution): boolean =>
      ce.isComplex(vars.x) === true && ce.isReal(vars.x) === false,
  ],
];

/**
 * Compile a set of solution rules
 */
export function solutions(
  ce: ComputeEngine<Numeric>,
  rs: Iterable<Solution>
): Solution[] {
  const result: Solution[] = [];
  for (const r of rs) {
    let lhs = r[0];
    if (typeof lhs === 'string') lhs = ce.parse(lhs);
    const sols: Pattern<Numeric>[] = [];
    for (const sol of rs[1]) {
      if (typeof sol === 'string') {
        sols.push(ce.parse(sol));
      } else {
        sols.push(sol);
      }
    }
    result.push([lhs, sols, r[2]]);
  }

  return result;
}

/**
 * Expression is a function of x.
 *
 * Return the roots of x.
 *
 */
function findUnivariateRoots(
  ce: ComputeEngine,
  expr: Expression<Numeric>,
  x: string
): Expression<Numeric>[] {
  const sols = ce.cache('roots-rules', () => solutions(ce, UNIVARIATE_ROOTS));
  const result: Expression<Numeric>[] = [];
  for (const solution of sols) {
    const [lhs, rhss, cond] = solution;
    const sub = match<Numeric>(substitute(lhs, { x }), expr);
    if (sub && (!cond || cond(ce, sub))) {
      for (const rhs of rhss) {
        let found = false;
        // Check that the solution is not a duplicate
        const sol = ce.simplify(substitute(rhs, sub));
        for (const x of result) {
          if (match(x, sol)) {
            found = true;
            break;
          }
        }
        // New, unique, solution, add it
        if (!found) result.push(sol);
      }
    }
  }
  return result;
}

/** Expr is an equation with a head of
 * - `Equal`, `Less`, `Greater`, `LessEqual`, `GreaterEqual`
 *
 * Return an expression with the same head, but with the first argument
 * a variable, if possible:
 * `2x < 4` => `x < 2`
 */
export function univariateSolve(
  ce: ComputeEngine,
  expr: Expression<Numeric>,
  x: string
): Expression<Numeric>[] | null {
  const name = getFunctionName(expr);
  if (name === 'And') {
    // @todo: System of equations
  }

  if (
    name === null ||
    !['Equal', 'Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(name)
  ) {
    return null;
  }

  const rhs = getArg(expr, 2) ?? MISSING;
  let lhs = getArg(expr, 1) ?? MISSING;
  if (getNumberValue(rhs) !== 0) {
    lhs = ['Subtract', lhs, rhs];
  }

  const roots = findUnivariateRoots(ce, lhs, x);
  if (roots.length === 0) return null;
  if (roots.length > 1) return ['Or', ...roots];
  return roots[0];
}
