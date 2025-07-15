import { factor, together } from '../boxed-expression/factor';
import { distribute } from '../symbolic/distribute';
import { expand, expandAll } from '../boxed-expression/expand';
import type { SymbolDefinitions } from '../global-types';

export const POLYNOMIALS_LIBRARY: SymbolDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expand(x.canonical) ?? x.canonical,
    },

    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expandAll(x.canonical) ?? x.canonical,
    },

    Factor: {
      // @todo: extend to factor over the integers: return a ['Multiply', ['Power', a, b], ...]
      description:
        'Factors an algebraic expression into a product of irreducible factors',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => factor(x.canonical) ?? x.canonical,
    },

    Together: {
      description: 'Combine rational expressions into a single fraction',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => together(x.canonical),
    },

    Distribute: {
      description: 'Distribute multiplication over addition',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => (!x ? x : distribute(x.canonical)),
    },
  },
];

//@todo
// Polynomial([0, 2, 0, 4]:list, x:symbol) -> 2x + 4x^3
//  -> Dot([0, 2, 0, 4], x^Range(0, 3)) -> 2x + 4x^3
// CoefficientList(2x + 4x^3, 'x') -> [0, 2, 0, 4]
// Degree(x) = Length(Coefficients(x)) - 1
//   Factors
//   Roots
