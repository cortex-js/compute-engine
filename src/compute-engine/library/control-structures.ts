import {
  BoxedDomain,
  BoxedExpression,
  EvaluateOptions,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { applicable } from '../function-utils';
import { widen } from '../boxed-expression/boxed-domain';
import { each, isCollection } from '../collection-utils';
import { checkConditions } from '../boxed-expression/rules';

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

    // A condition expression tests for one or more conditions of an expression
    // ['Condition', value, "positive"]
    Condition: {
      hold: 'all',
      signature: {
        domain: 'Functions',
        evaluate: ([value, conds], { engine }) => {
          let conditions: string[] = [];
          if (conds.symbol) {
            conditions = [conds.symbol];
          } else if (conds.operator === 'And') {
            conditions = conds.ops!.map((op) => op.symbol ?? '');
          }
          if (checkConditions(value, conditions)) return engine.True;
          return engine.False;
        },
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
        evaluate: ([cond, ifTrue, ifFalse], { engine }) => {
          if (cond && cond.symbol === 'True')
            return ifTrue?.evaluate() ?? engine.Nothing;
          return ifFalse?.evaluate() ?? engine.Nothing;
        },
      },
    },

    Loop: {
      hold: 'all', // Do not evaluate anything
      signature: {
        domain: 'Functions',
        evaluate: ([body, collection], { engine: ce }) => {
          body ??= ce.Nothing;
          if (body.symbol === 'Nothing') return body;

          if (collection && isCollection(collection)) {
            //
            // Iterate over the elements of a collection
            //
            let result: BoxedExpression | undefined = undefined;
            const fn = applicable(body);
            let i = 0;

            for (const x of each(collection)) {
              result = fn([x]) ?? ce.Nothing;
              if (result.operator === 'Break') return result.op1;
              if (result.operator === 'Return') return result;
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
            if (result.operator === 'Break') return result.op1;
            if (result.operator === 'Return') return result;
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
        evaluate: (ops, options) => evaluateWhich(ops, options),
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

function evaluateWhich(
  args: ReadonlyArray<BoxedExpression>,
  options: EvaluateOptions & { engine: IComputeEngine }
): BoxedExpression {
  let i = 0;
  while (i < args.length - 1) {
    if (args[i].evaluate().symbol === 'True') {
      if (!args[i + 1]) return options.engine.symbol('Undefined');
      return args[i + 1].evaluate(options);
    }
    i += 2;
  }

  return options.engine.symbol('Undefined');
}

/** Evaluate a Block expression */
function evaluateBlock(
  ops: ReadonlyArray<BoxedExpression>,
  { engine: ce }
): BoxedExpression {
  // Empty block?
  if (ops.length === 0) return ce.Nothing;

  ce.resetContext();

  let result: BoxedExpression | undefined = undefined;
  for (const op of ops) {
    const h = op.operator;
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
    if (op.operator === 'Declare') declarations.push(op);
    else body.push(invalidateDeclare(op));
  }

  const result = ce._fn('Block', [...declarations, ...body]);

  ce.popScope();
  return result;
}

function invalidateDeclare(expr: BoxedExpression): BoxedExpression {
  if (expr.operator === 'Declare') expr.engine.error('unexpected-declare');

  if (expr.ops)
    return expr.engine._fn(expr.operator, expr.ops.map(invalidateDeclare));

  return expr;
}
