import { getFunctionName } from '../common/utils';
import { Expression } from '../public';
import { match, substitute, Substitution } from './patterns';
import { ComputeEngine, Numeric, Pattern } from './public';

// https://en.wikipedia.org/wiki/Equation_solving

export type Solution = [
  lhs: string | Pattern<Numeric>,
  condition: (ce: ComputeEngine<Numeric>, vars: Substitution) => boolean,
  solutions: (string | Pattern<Numeric>)[]
];

//
// The lhs pattern is a function of (x, y, z)
//
// @todo: MOAR RULES
// x^2, x^2 + a,  a x^2 + b
// polynomials...
// a \\sqrt{x} + b
// a ln x + b, a e^x + b
//
// cos x, acos x, n cos x + a
export const SOLUTION_RULES: Solution[] = [
  [['x + a'], (): boolean => true, ['-a']],

  [['ax + b'], (): boolean => true, ['\\frac{-b}{a}']],

  // Quadratic formula (real)
  // @todo: add rule for when b or c is 0
  [
    ['ax^2 + bx + c'],
    (ce: ComputeEngine, vars: Substitution): boolean =>
      ce.isReal(vars.x) === true,
    [
      '\\frac{{ - b + \\sqrt{b^2 - 4ac} }}{{2a}}',
      '\\frac{{ - b - \\sqrt{b^2 - 4ac} }}{{2a}}',
    ],
  ],

  // Quadratic formula (complex)
  [
    ['ax^2 + bx + c'],
    (ce: ComputeEngine, vars: Substitution): boolean =>
      ce.isComplex(vars.x) === true && ce.isReal(vars.x) === false,
    [
      '-\\frac{b}{2a} - \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}',
      '-\\frac{b}{2a} + \\imaginaryI \\frac{\\sqrt{4ac - b^2}}{2a}',
    ],
  ],
];

export function solutions(
  ce: ComputeEngine<Numeric>,
  rs: Iterable<Solution>
): Solution[] {
  const result: Solution[] = [];
  for (const r of rs) {
    let lhs = r[0];
    if (typeof lhs === 'string') lhs = ce.parse(lhs);
    const sols: Pattern<Numeric>[] = [];
    for (const sol of rs[2]) {
      if (typeof sol === 'string') {
        sols.push(ce.parse(sol));
      } else {
        sols.push(sol);
      }
    }
    result.push([lhs, r[1], sols]);
  }

  return result;
}

export function solve(
  ce: ComputeEngine,
  expr: Expression<Numeric>,
  vars?: string | string[]
): Expression<Numeric>[] | null {
  if (vars === undefined) return null;
  if (typeof vars === 'string') vars = [vars];

  const solRules = ce.cache('solve-rules', () => solutions(ce, SOLUTION_RULES));

  const name = getFunctionName(expr);
  if (name === 'And') {
    // @todo: System of equations
  }

  //
  // Attempt to apply, in turn, each solution rules.
  //
  const result: Expression<Numeric>[] = [];
  for (const sol of solRules) {
    const [lhs, cond, rhss] = sol;
    const pat = substitute(lhs, { x: vars[0], y: vars[1], z: vars[2] });
    const sub: null | Substitution<Numeric> = match<Numeric>(pat, expr);
    if (sub && cond(ce, sub)) {
      for (const rhs of rhss) {
        let found = false;
        const solution = substitute(rhs, sub);
        for (const x of result) {
          if (match(x, solution)) {
            found = true;
            break;
          }
        }
        if (!found) result.push(solution);
      }
    }
  }
  return result;
}
