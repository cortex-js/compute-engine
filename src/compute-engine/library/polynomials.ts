import { factor, together } from '../numerics/factor';
import { IdentifierDefinitions } from '../public';
import { distribute, expand, expandAll } from '../symbolic/expand';

export const POLYNOMIALS_LIBRARY: IdentifierDefinitions[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => expand(ops[0]) ?? ops[0],
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
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (_ce, ops) => factor(ops[0]),
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
      signature: {
        domain: ['FunctionOf', 'Values', 'Values'],
        evaluate: (ce, ops) => {
          const h = ops[0].head;
          if (h === 'Multiply') return distribute(ops[0].ops!) ?? ops[0];
          if (h === 'Negate')
            return distribute([ce.NegativeOne, ...ops[0].ops!]) ?? ops[0];
          if (h === 'Divide' && ops[0].ops![0].head === 'Multiply') {
            const numerator = distribute(ops[0].ops!);
            const denominator = ops[0].ops![1];
            if (numerator) {
              if (numerator.head === 'Add')
                return ce
                  .add(...numerator.ops!.map((x) => ce.div(x, denominator)))
                  .evaluate();

              return ce.div(numerator, denominator).evaluate();
            }
          }
          return ops[0];
        },
      },
    },
  },
];

//@todo
//   // degree
//   // factors
//   // roots
