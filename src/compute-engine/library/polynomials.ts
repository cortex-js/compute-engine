import { factor, together } from '../boxed-expression/factor';
import { IdentifierDefinitions } from '../public';
import { distribute } from '../symbolic/distribute';
import { expand, expandAll } from '../symbolic/expand';

export const POLYNOMIALS_LIBRARY: IdentifierDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => expand(ops[0].canonical) ?? ops[0],
      },
    },
    ExpandAll: {
      description:
        'Recursively expand out products and positive integer powers',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => expandAll(ops[0]) ?? ops[0],
      },
    },
    Factor: {
      description:
        'Factors an algebraic expression into a product of irreducible factors',
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => factor(ops[0].canonical),
      },
    },
    Together: {
      description: 'Combine rational expressions into a single fraction',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => together(ops[0]),
      },
    },
    Distribute: {
      description: 'Distribute multiplication over addition',
      hold: 'all',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => (!ops[0] ? ops[0] : distribute(ops[0])),
      },
    },
  },
];

//@todo
//   // degree
//   // factors
//   // roots
