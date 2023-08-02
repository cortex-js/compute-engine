import { IdTable } from '../public';
import { distribute, expand } from '../symbolic/expand';

export const POLYNOMIALS_LIBRARY: IdTable[] = [
  {
    Expand: {
      description: 'Expand out products and positive integer powers',
      signature: {
        domain: ['Function', 'Value', 'Value'],
        evaluate: (_ce, ops) => expand(ops[0]) ?? ops[0],
      },
    },
    Distribute: {
      description: 'Distribute multiplication over addition',
      signature: {
        domain: ['Function', 'Value', 'Value'],
        evaluate: (ce, ops) => {
          const h = ops[0].head;
          if (h === 'Multiply') return distribute(ops[0].ops!) ?? ops[0];
          if (h === 'Negate')
            return distribute([ce._NEGATIVE_ONE, ...ops[0].ops!]) ?? ops[0];
          if (h === 'Divide' && ops[0].ops![0].head === 'Multiply') {
            const numerator = distribute(ops[0].ops!);
            const denominator = ops[0].ops![1];
            if (numerator) {
              if (numerator.head === 'Add')
                return ce.add(
                  numerator.ops!.map((x) => ce.div(x, denominator))
                );

              return ce.div(numerator, denominator);
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
