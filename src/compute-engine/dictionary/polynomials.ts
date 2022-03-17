import { Dictionary } from '../public';
import { expand } from '../symbolic/expand';

export const POLYNOMIALS_DICTIONARY: Dictionary[] = [
  {
    functions: [
      {
        name: 'Expand',
        description: 'Expand out products and positive integer powers',
        evaluate: (ce, ops) => (ops[0] ? expand(ops[0]) : ce.symbol('Nothing')),
      },
    ],
  },
];

//@todo
//   // degree
//   // factors
//   // roots
