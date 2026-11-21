import type {
  BoxedValueDefinition,
  EvaluateOptions,
  Expression,
  IComputeEngine,
} from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import { shareLazyViewRecord } from '../boxed-expression/lazy-view-context.js';

type ReadValue = (
  definition: BoxedValueDefinition,
  value: Expression,
  evaluate: (value: Expression) => Expression
) => Expression | undefined;

type ValuePass = {
  read: ReadValue;
};

const ACTIVE = new WeakMap<IComputeEngine, ValuePass>();
let openPasses = 0;

/** The synchronous document pass for this engine, if there is one. */
function activeValuePass(engine: IComputeEngine): ValuePass | undefined {
  return openPasses === 0 ? undefined : ACTIVE.get(engine);
}

/** Read an owned value in the current exact evaluation pass. */
export function evaluatePreparedValue(
  engine: IComputeEngine,
  definition: BoxedValueDefinition,
  source: Expression,
  options: Partial<EvaluateOptions> | undefined,
  evaluate: (value: Expression) => Expression
): Expression | undefined {
  const pass = activeValuePass(engine);
  // One pass result serves exact reads. Numeric and other option-dependent
  // routes keep their ordinary dereference and exact admission fallback.
  if (
    pass === undefined ||
    options?.numericApproximation === true ||
    (options !== undefined &&
      Object.keys(options).some((key) => key !== 'numericApproximation'))
  )
    return undefined;
  return pass.read(definition, source, evaluate);
}

/** True when the elements of `expr` can draw random values. */
function drawsRandom(expr: Expression): boolean {
  const effects = expr.effects;
  return (
    effects !== undefined && effects !== 'any' && effects.includes('random')
  );
}

/**
 * `expr` with a new instance of each lazy collection in it whose elements
 * draw random values, and of each node that holds one. Other nodes are kept.
 *
 * The element memo of a lazy collection is keyed by its instance, and one
 * instance is one draw set (`docs/RANDOMNESS-MODEL.md` §6). A new pass gets
 * new instances, so it draws again, at any depth: `ListJoin(xs, ys)` reads
 * the instance `ys` that it holds. A collection that draws no random value
 * keeps its instance, and its memo, from one pass to the next. `fresh` maps
 * each instance replaced in this pass to its replacement, and each
 * replacement to itself, for the whole pass: an instance that two rows, or
 * two operands, share is replaced once, so it stays one draw set.
 */
function withFreshDraws(
  engine: IComputeEngine,
  expr: Expression,
  fresh: Map<Expression, Expression>
): Expression {
  const known = fresh.get(expr);
  if (known !== undefined) return known;
  if (!isFunction(expr) || !drawsRandom(expr)) return expr;
  let changed = false;
  const ops = expr.ops.map((op) => {
    const result = withFreshDraws(engine, op, fresh);
    if (result !== op) changed = true;
    return result;
  });
  if (!changed && !expr.isLazyCollection) return expr;
  const view = engine._fn(expr.operator, ops, { scope: expr.localScope });
  shareLazyViewRecord(expr, view);
  fresh.set(expr, view);
  fresh.set(view, view);
  return view;
}

export function makePreparedValuePass(
  engine: IComputeEngine,
  own: ReadonlyMap<BoxedValueDefinition, Expression>
) {
  const pass = { read };
  // A null entry marks a read still in progress.
  const values = new Map<BoxedValueDefinition, Expression | null>();
  // The fresh instances of this pass, shared by all its reads.
  const fresh = new Map<Expression, Expression>();

  function read(
    definition: BoxedValueDefinition,
    source: Expression,
    evaluate: (value: Expression) => Expression
  ): Expression | undefined {
    // A live write replaces the formula. Only the prepared RHS is sampled.
    if (own.get(definition) !== source) return undefined;
    const cached = values.get(definition);
    if (cached !== undefined) return cached ?? undefined;

    const effects = source.effects;
    if (effects === 'any' || effects?.some((effect) => effect !== 'random'))
      return undefined;
    values.set(definition, null);
    try {
      // The source and the value both: an evaluation can read a lazy
      // collection of the source (`ListJoin` makes a list of its elements),
      // and the value can hold one that is not in the source (the value of
      // a row that this pass does not read).
      const value = withFreshDraws(
        engine,
        evaluate(withFreshDraws(engine, source, fresh)),
        fresh
      );
      values.set(definition, value);
      return value;
    } catch (error) {
      values.delete(definition);
      throw error;
    }
  }

  return {
    /** Publish a list after the caller admitted the result of its bounded walk. */
    retain(
      definition: BoxedValueDefinition,
      view: Expression,
      result: Expression
    ): void {
      if (
        result.engine === engine &&
        isFunction(result, 'List') &&
        view.isLazyCollection &&
        values.get(definition) === view
      )
        values.set(definition, result);
    },
    run<T>(fn: () => T): T {
      const previous = ACTIVE.get(engine);
      if (previous === pass) return fn();
      ACTIVE.set(engine, pass);
      openPasses++;
      try {
        return fn();
      } finally {
        openPasses--;
        if (previous === undefined) ACTIVE.delete(engine);
        else ACTIVE.set(engine, previous);
      }
    },
  };
}
