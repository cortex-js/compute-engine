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
  evaluate: () => Expression
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
  evaluate: () => Expression
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

export function makePreparedValuePass(
  engine: IComputeEngine,
  own: ReadonlyMap<BoxedValueDefinition, Expression>
) {
  const pass = { read };
  // A null entry marks a read still in progress.
  const values = new Map<BoxedValueDefinition, Expression | null>();

  function read(
    definition: BoxedValueDefinition,
    source: Expression,
    evaluate: () => Expression
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
      let value = evaluate();
      if (isFunction(value) && value.isLazyCollection) {
        const view = engine._fn(value.operator, value.ops, {
          scope: value.localScope,
        });
        shareLazyViewRecord(value, view);
        value = view;
      }
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
