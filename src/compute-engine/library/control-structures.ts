import {
  BoxedDomain,
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { applicable, apply, iterable } from '../function-utils';
import { sharedAncestorDomain } from '../boxed-expression/boxed-domain';

export const CONTROL_STRUCTURES_LIBRARY: IdentifierDefinitions[] = [
  {
    Block: {
      signature: { domain: 'Function', evaluate: evaluateBlock },
    },

    If: {
      hold: 'rest', // Evaluate the condition, but no the true/false branches
      signature: {
        domain: 'Function',
        codomain: (ce, ops) => ce.domain(['Union', ops[0], ops[1]]),
        evaluate: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].evaluate() : ce.symbol('Nothing');
          return ops[2] ? ops[2].evaluate() : ce.symbol('Nothing');
        },
      },
    },

    Loop: {
      hold: 'all', // Do not evaluate anything
      signature: {
        domain: 'Function',
        evaluate: (ce, ops) => {
          const body = ops[0] ?? ce.symbol('Nothing');
          if (body.isNothing) return body;

          const collection = ops[1];

          if (collection) {
            //
            // Iterate over the elements of a collection
            //
            const iter = iterable(collection);
            if (!iter) return ce.symbol('Nothing');
            let result: BoxedExpression | undefined = undefined;
            let i = 0;
            const fn = applicable(body);
            while (true) {
              const { done, value } = iter.next();
              if (done) return result ?? ce.symbol('Nothing');
              result = fn([value]);
              if (result.head === 'Break') return result.op1;
              if (result.head === 'Return') return result;
              if (i++ > ce.iterationLimit)
                return ce.error('iteration-limit-exceeded');
            }
          }

          //
          // No collection: infinite loop
          //
          let i = 0;
          while (true) {
            const result = body.evaluate();
            if (result.head === 'Break') return result.op1;
            if (result.head === 'Return') return result;
            if (i++ > ce.iterationLimit)
              return ce.error('iteration-limit-exceeded');
          }
        },
      },
    },

    Which: {
      hold: 'all',
      signature: {
        domain: 'Function',
        codomain: (ce, ops) => domainWhich(ce, ops),
        evaluate: (ce, ops) => whichEvaluate(ce, ops, 'evaluate'),
      },
    },

    FixedPoint: {
      hold: 'all',
      signature: {
        domain: 'Function',
        // @todo
      },
    },
  },
];

function domainWhich(ce: IComputeEngine, args: BoxedDomain[]): BoxedDomain {
  let dom: BoxedDomain | null = null;
  for (let i = 1; i <= args.length - 1; i += 2) {
    if (!dom) dom = args[i].domain;
    else dom = sharedAncestorDomain(dom, args[i].domain);
  }
  return dom ?? ce.domain('Nothing');
}

function whichEvaluate(
  ce: IComputeEngine,
  args: BoxedExpression[],
  mode: 'N' | 'evaluate'
): BoxedExpression {
  let i = 0;
  while (i < args.length - 1) {
    if (args[i].evaluate().symbol === 'True') {
      if (!args[i + 1]) return ce.symbol('Undefined');
      return mode === 'N' ? args[i + 1].N() : args[i + 1].evaluate();
    }
    i += 2;
  }

  return ce.symbol('Undefined');
}

/** Evaluate a Block expression */
function evaluateBlock(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  // Empty block?
  if (ops.length === 0) return ce.symbol('Nothing');

  ce.pushScope();

  let result: BoxedExpression | undefined = undefined;
  for (const op of ops) {
    result = op.evaluate();
    const h = result.head;
    if (h === 'Return' || h === 'Break' || h === 'Continue') break;
  }

  ce.popScope();

  return result ?? ce.symbol('Nothing');
}
