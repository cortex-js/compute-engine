import { applicable } from '../function-utils';
import { checkConditions } from '../boxed-expression/rules';
import { widen } from '../../common/type/utils';
import { CancellationError, run, runAsync } from '../../common/interruptible';
import type {
  Expression,
  SymbolDefinitions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Scope,
} from '../global-types';
import { spellCheckMessage } from '../boxed-expression/validate';
import { isFunction, isSymbol, sym } from '../boxed-expression/type-guards';

export const CONTROL_STRUCTURES_LIBRARY: SymbolDefinitions[] = [
  {
    Block: {
      description: 'Evaluate a sequence of expressions in a local scope.',
      lazy: true,
      scoped: true,
      signature: '(unknown*) -> unknown',
      type: (args) => {
        if (args.length === 0) return 'nothing';
        return args[args.length - 1].type;
      },
      canonical: canonicalBlock,
      evaluate: evaluateBlock,
    },

    // A condition expression tests for one or more conditions of an expression
    // ['Condition', value, "positive"]
    Condition: {
      description: 'Test whether a value satisfies one or more conditions.',
      lazy: true,
      signature: '(value, symbol) -> boolean',
      evaluate: ([value, conds], { engine }) => {
        let conditions: string[] = [];
        if (isSymbol(conds)) {
          conditions = [conds.symbol];
        } else if (isFunction(conds, 'And')) {
          conditions = conds.ops.map((op) => sym(op) ?? '');
        }
        if (checkConditions(value, conditions)) return engine.True;
        return engine.False;
      },
    },

    If: {
      description: 'Conditional branch: evaluate one of two expressions.',
      lazy: true,
      signature: '(expression, expression, expression) -> any',
      type: ([_cond, ifTrue, ifFalse]) =>
        widen(ifTrue.type.type, ifFalse.type.type),
      canonical: ([cond, ifTrue, ifFalse], { engine }) =>
        engine._fn('If', [cond.canonical, ifTrue.canonical, ifFalse.canonical]),
      evaluate: ([cond, ifTrue, ifFalse], { engine }) => {
        const evaluatedCond = sym(cond.evaluate());
        if (evaluatedCond === 'True')
          return ifTrue?.evaluate() ?? engine.Nothing;
        if (evaluatedCond === 'False')
          return ifFalse?.evaluate() ?? engine.Nothing;
        throw new Error(
          `Condition must evaluate to "True" or "False". ${spellCheckMessage(
            cond
          )}`
        );
      },
    },

    Loop: {
      description: 'Evaluate a body expression over elements of a collection.',
      lazy: true,
      signature: '(body:expression, collection:expression) -> any',
      type: ([body]) => body.type,
      evaluate: ([body, collection], { engine: ce }) =>
        run(runLoop(body, collection, ce), ce._timeRemaining),
      evaluateAsync: async ([body, collection], { engine: ce, signal }) =>
        runAsync(runLoop(body, collection, ce), ce._timeRemaining, signal),
    },

    Which: {
      description: 'Return the value for the first condition that is true.',
      lazy: true,
      signature: '(expression+) -> unknown',
      type: (args) => {
        if (args.length % 2 !== 0) return 'nothing';
        return widen(
          ...args.filter((_, i) => i % 2 === 1).map((x) => x.type.type)
        );
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

    FixedPoint: {
      description: 'Iterate a function until a fixed point is reached.',
      lazy: true,
      signature: '(any) -> unknown',
    },
  },
];

function evaluateWhich(
  args: ReadonlyArray<Expression>,
  options: EvaluateOptions & { engine: ComputeEngine }
): Expression {
  let i = 0;
  while (i < args.length - 1) {
    const cond = sym(args[i].evaluate());
    if (cond === 'True') {
      if (!args[i + 1]) return options.engine.symbol('Undefined');
      return args[i + 1].evaluate(options);
    } else if (cond !== 'False') {
      throw new Error(
        `Condition must evaluate to "True" or "False". ${spellCheckMessage(
          args[i]
        )}`
      );
    }
    i += 2;
  }

  return options.engine.symbol('Undefined');
}

/** Evaluate a Block expression */
function evaluateBlock(
  ops: ReadonlyArray<Expression>,
  { engine: ce }
): Expression {
  // Empty block?
  if (ops.length === 0) return ce.Nothing;

  let result: Expression | undefined = undefined;
  for (const op of ops) {
    const h = op.operator;
    if (h === 'Return' && isFunction(op)) {
      result = op.op1.evaluate();
      break;
    }
    if ((h === 'Break' || h === 'Continue') && isFunction(op)) {
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
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
): Expression | null {
  const { engine: ce, scope } = options;
  // Empty block?
  if (ops.length === 0) return null;

  // We canonicalize the statements in the local scope
  const result = ce._fn(
    'Block',
    ce._inScope(scope, () => ops.map((op) => op.canonical)),
    { scope }
  );
  return result;
}

function* runLoop(
  body: Expression,
  collection: Expression,
  ce: ComputeEngine
): Generator<Expression> {
  body ??= ce.Nothing;
  if (sym(body) === 'Nothing') return body;

  if (collection?.isCollection) {
    //
    // Iterate over the elements of a collection
    //
    let result: Expression | undefined = undefined;
    const fn = applicable(body);
    let i = 0;

    for (const x of collection.each()) {
      result = fn([x]) ?? ce.Nothing;
      if (isFunction(result, 'Break')) return result.op1;
      if (result.operator === 'Return') return result;
      i += 1;
      if (i % 1000 === 0) yield result;
      if (i > ce.iterationLimit)
        throw new CancellationError({ cause: 'iteration-limit-exceeded' });
    }
    return result;
  }

  //
  // No collection: infinite loop
  //
  let i = 0;
  while (true) {
    const result = body.evaluate();
    if (isFunction(result, 'Break')) return result.op1;
    if (result.operator === 'Return') return result;
    i += 1;
    if (i % 1000 === 0) yield result;
    if (i > ce.iterationLimit)
      throw new CancellationError({ cause: 'iteration-limit-exceeded' });
  }
}
