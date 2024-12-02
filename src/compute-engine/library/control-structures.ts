import {
  BoxedExpression,
  EvaluateOptions,
  IComputeEngine,
  IdentifierDefinitions,
} from '../public';
import { applicable } from '../function-utils';
import { each } from '../collection-utils';
import { checkConditions } from '../boxed-expression/rules';
import { widen } from '../../common/type/utils';

export const CONTROL_STRUCTURES_LIBRARY: IdentifierDefinitions[] = [
  {
    Block: {
      lazy: true,
      signature: '(any) -> any',
      canonical: canonicalBlock,
      evaluate: evaluateBlock,
    },

    // A condition expression tests for one or more conditions of an expression
    // ['Condition', value, "positive"]
    Condition: {
      lazy: true,
      signature: '(value, symbol) -> boolean',
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

    If: {
      lazy: true,
      signature: '(expression, expression, expression) -> any',
      type: ([cond, ifTrue, ifFalse]) => widen(ifTrue.type, ifFalse.type),
      evaluate: ([cond, ifTrue, ifFalse], { engine }) => {
        cond = cond.evaluate();
        if (cond && cond.symbol === 'True')
          return ifTrue?.evaluate() ?? engine.Nothing;
        return ifFalse?.evaluate() ?? engine.Nothing;
      },
    },

    Loop: {
      lazy: true,
      signature: '(body:expression, collection:expression) -> any',
      type: ([body]) => body.type,
      evaluate: ([body, collection], { engine: ce }) => {
        body ??= ce.Nothing;
        if (body.symbol === 'Nothing') return body;

        if (collection && collection.isCollection) {
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

    Which: {
      lazy: true,
      signature: '(...expression) -> unknown',
      type: (args) => {
        if (args.length % 2 !== 0) return 'nothing';
        return widen(...args.filter((_, i) => i % 2 === 1).map((x) => x.type));
      },
      canonical: (args, options) => {
        if (args.length % 2 !== 0) return options.engine.Nothing;
        return options.engine._fn(
          'Which',
          args.map((x) => x.canonical)
        );
      },
      evaluate: (ops, options) => evaluateWhich(ops, options),
    },

    FixedPoint: { lazy: true, signature: 'any -> any' },
  },
];

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
  ops: ReadonlyArray<BoxedExpression>,
  options: { engine: IComputeEngine }
): BoxedExpression | null {
  const { engine: ce } = options;
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
