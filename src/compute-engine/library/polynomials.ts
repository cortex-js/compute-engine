import { factor, together } from '../boxed-expression/factor';
import { IdentifierDefinitions } from '../public';
import { distribute } from '../symbolic/distribute';
import { expand, expandAll } from '../boxed-expression/expand';

export const POLYNOMIALS_LIBRARY: IdentifierDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expand(x.canonical) ?? x,
    },
    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => expandAll(x) ?? x,
    },
    Factor: {
      // @todo: extend to factor over the integers: return a ['Multiply', ['Power', a, b], ...]
      description:
        'Factors an algebraic expression into a product of irreducible factors',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => factor(x.canonical),
    },
    Together: {
      description: 'Combine rational expressions into a single fraction',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => together(x),
    },
    Distribute: {
      description: 'Distribute multiplication over addition',
      lazy: true,
      signature: '(value)-> value',
      evaluate: ([x]) => (!x ? x : distribute(x)),
    },
  },
];

//@todo
//   // degree
//   // factors
//   // roots
