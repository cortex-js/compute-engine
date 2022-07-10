import {
  BoxedExpression,
  BoxedSubstitution,
  IComputeEngine,
  LatexString,
  Pattern,
  SemiBoxedExpression,
} from './public';
import { isLatexString } from './boxed-expression/utils';

// https://en.wikipedia.org/wiki/Equation_solving

export type Solution = [
  lhs: LatexString | Pattern,
  solutions: (LatexString | Pattern)[],
  condition?: (ce: IComputeEngine, vars: BoxedSubstitution) => boolean
];

export type BoxedSolution = [
  lhs: Pattern,
  solutions: Pattern[],
  condition?: (ce: IComputeEngine, vars: BoxedSubstitution) => boolean
];

//
// UNIVARIATE_ROOTS is a collection of rules that find the roots for
// various expressions.
//
// The lhs pattern is a function of (x, a, b)
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

// Set of rules to find the root(s) for `x`
// Note: this is not a RuleSet because for each matching pattern, there
// may be more than one solution/root
export const UNIVARIATE_ROOTS: Solution[] = [
  ['$x + a$', ['$-a$']],
  ['$-x + a$', ['$a$']],

  ['$\\frac{x}{a} - 1$', ['$a$']],
  ['$1 - \\frac{x}{a}$', ['$a$']],
  ['$\\frac{-x}{a} - 1$', ['$-a$']],

  ['$ax + b$', ['$\\frac{-b}{a}$']],
  ['$ax$', ['$0$']],

  // Quadratic formula (real)
  // @todo: add rule for when b or c is 0
  [
    '$ax^2 + bx + c$',
    [
      '$\\frac{{ - b + \\sqrt{b^2 - 4ac} }}{{2a}}$',
      '$\\frac{{ - b - \\sqrt{b^2 - 4ac} }}{{2a}}$',
    ],
    (_ce, vars): boolean => vars.x.isReal === true,
  ],

  // Quadratic formula (complex)
  [
    '$ax^2 + bx + c$',
    [
      '$-\\frac{b}{2a} - \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}$',
      '$-\\frac{b}{2a} + \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}$',
    ],
    (_ce, vars): boolean => vars.x.isImaginary === true,
  ],
];

/**
 * Compile a set of rules for solving equations
 */
export function boxSolutions(
  ce: IComputeEngine,
  rs: Iterable<Solution>
): BoxedSolution[] {
  const result: BoxedSolution[] = [];
  for (const [lhs, rhss, cond] of rs)
    result.push([
      ce.pattern(lhs),
      rhss.map((x) => ce.pattern(isLatexString(x) ? ce.parse(x)! : x)),
      cond,
    ]);

  return result;
}

/**
 * Expression is a function of a single variable (`x`)
 *
 * Return the roots of that variable
 *
 */
function findUnivariateRoots(
  expr: BoxedExpression,
  x: string
): BoxedExpression[] {
  const ce = expr.engine;
  const rules = ce.cache(
    'univariate-roots-rules',
    () => boxSolutions(ce, UNIVARIATE_ROOTS),
    (rules) => {
      for (const r of rules) r._purge();
      return rules;
    }
  );
  const result: BoxedExpression[] = [];
  const unknown = { x: ce.symbol(x) };
  for (const [lhs, rhss, cond] of rules) {
    // Replace the `x` in `lhs` with the actual symbol we're looking for
    // and attempt to match
    const sub = lhs.subs(unknown)?.match(expr);
    if (sub && (!cond || cond(ce, sub))) {
      for (const rhs of rhss) {
        let found = false;
        // Check that the solution is not a duplicate
        const sol = rhs.subs(sub).simplify();
        for (const x of result) {
          if (sol.isSame(x)) {
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
  expr: BoxedExpression,
  x: string
): SemiBoxedExpression[] | null {
  const ce = expr.engine;
  const name = expr.head;
  if (name === 'And') {
    // @todo: System of equations
  }

  if (
    name === null ||
    (typeof name === 'string' &&
      !['Equal', 'Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(name))
  ) {
    return null;
  }

  const rhs = expr.op2;
  let lhs: SemiBoxedExpression = expr.op1;
  if (rhs.isNotZero === true) lhs = ['Subtract', lhs, rhs];

  const roots = findUnivariateRoots(ce.box(lhs), x);
  if (roots.length === 0) return null;
  return roots;
}
