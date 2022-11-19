import { IdTable } from '../public';
import { expand } from '../symbolic/expand';

export const POLYNOMIALS_LIBRARY: IdTable[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      signature: {
        domain: ['Function', 'Value', 'Value'],
        evaluate: (_ce, ops) => expand(ops[0]),
      },
    },
  },
];

//@todo
//   // degree
//   // factors
//   // roots
