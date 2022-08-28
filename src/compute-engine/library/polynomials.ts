import { SymbolTable } from '../public';
import { expand } from '../symbolic/expand';

export const POLYNOMIALS_LIBRARY: SymbolTable[] = [
  {
    functions: [
      {
        name: 'Expand',
        description: 'Expand out products and positive integer powers',
        signatures: [
          {
            evaluate: (ce, ops) =>
              ops[0] ? expand(ops[0]) : ce.symbol('Nothing'),
          },
        ],
      },
    ],
  },
];

//@todo
//   // degree
//   // factors
//   // roots
