import {
  BoxedDomain,
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { applicable } from '../function-utils';
import { widen } from '../boxed-expression/boxed-domain';
import { each, isCollection } from '../collection-utils';

export const CONTROL_STRUCTURES_LIBRARY: IdentifierDefinitions[] = [
  {
    Block: {
      hold: 'all',
      signature: {
        domain: 'Functions',
        canonical: canonicalBlock,
        evaluate: evaluateBlock,
      },
    },

    If: {
      hold: 'rest', // Evaluate the condition, but no the true/false branches
      signature: {
        domain: 'Functions',
        result: (ce, ops) => {
          if (ops.length !== 2) return ce.domain('NothingDomain');
          return widen(ops[0], ops[1]);
        },
        evaluate: (ce, ops) => {
          const cond = ops[0];
          if (cond && cond.symbol === 'True')
            return ops[1] ? ops[1].evaluate() : ce.Nothing;
          return ops[2] ? ops[2].evaluate() : ce.Nothing;
        },
      },
    },

    Loop: {
      hold: 'all', // Do not evaluate anything
      signature: {
        domain: 'Functions',
        evaluate: (ce, ops) => {
          const body = ops[0] ?? ce.Nothing;
          if (body.symbol === 'Nothing') return body;

          const collection = ops[1];

          if (collection && isCollection(collection)) {
            //
            // Iterate over the elements of a collection
            //
            let result: BoxedExpression | undefined = undefined;
            const fn = applicable(body);
            let i = 0;

            for (const x of each(collection)) {
              result = fn([x]) ?? ce.Nothing;
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
        domain: 'Functions',
        result: (ce, ops) => domainWhich(ce, ops),
        evaluate: (ce, ops) => whichEvaluate(ce, ops, 'evaluate'),
      },
    },

    FixedPoint: {
      hold: 'all',
      signature: {
        domain: 'Functions',
        // @todo
      },
    },
  },
];

function domainWhich(ce: IComputeEngine, args: BoxedDomain[]): BoxedDomain {
  let dom: BoxedDomain | null | undefined = null;
  for (let i = 1; i <= args.length - 1; i += 2)
    dom = widen(dom, args[i].domain);
  return dom ?? ce.domain('NothingDomain');
}

function whichEvaluate(
  ce: IComputeEngine,
  args: ReadonlyArray<BoxedExpression>,
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
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  // Empty block?
  if (ops.length === 0) return ce.Nothing;

  ce.resetContext();

  let result: BoxedExpression | undefined = undefined;
  for (const op of ops) {
    const h = op.head;
    if (h === 'Return') {
      result = op.op1.evaluate();
      break;
    }
    if (h === 'Break' || h === 'Continue') {
      result = ce.box([h, op.op1.evaluate()]);
      break;
    }
    result = op.evaluate();
  }

  return result ?? ce.Nothing;
}

/**
 *
 *  Canonicalize a Block expression
 *
 * - Hoist any `Declare` expression to the top of the block
 * - Add a `Declare` expression for any `Assign` expression
 * - Error for any `Declare` expression that's an argument to a function
 *
 */

function canonicalBlock(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  // Empty block?
  if (ops.length === 0) return null;

  ce.pushScope();

  const declarations: BoxedExpression[] = [];
  const body: BoxedExpression[] = [];
  for (const op of ops) {
    if (op.head === 'Declare') declarations.push(op);
    else body.push(invalidateDeclare(op));
  }

  const result = ce._fn('Block', [...declarations, ...body]);

  ce.popScope();
  return result;
}

function invalidateDeclare(expr: BoxedExpression): BoxedExpression {
  if (expr.head === 'Declare') expr.engine.error('unexpected-declare');

  if (expr.ops)
    return expr.engine._fn(expr.head, expr.ops.map(invalidateDeclare));

  return expr;
}
