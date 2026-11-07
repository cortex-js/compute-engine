/**
 * CE-1062: the iteration of a `Sum` or a `Product` puts back the value of its
 * index when it stops.
 *
 * The binding of the index is in the scope of the operator, and that scope
 * stays with the expression. Each step of the iteration assigns a value to
 * the index. Before the fix, the last value stayed in the binding after
 * `evaluate()`: a later `simplify()` of the same expression then read the
 * index as an assigned variable, and did not find the closed form of an
 * inner sum that it found before the evaluation.
 *
 * These tests check the value of the binding after each kind of iteration
 * (a `Limits` range, an `Element` domain, the walks of an infinite sum and
 * of an infinite product, a cancelled iteration), and that `simplify()`
 * gives the same result before and after `evaluate()`. Before the fix, each
 * binding check failed: the binding held the last value of the index.
 *
 * The drivers `run()` and `runAsync()` and the wrapper
 * `withEvaluationEffects()` close the generator when they stop before its
 * end, so that the restore in its `finally` block also runs after a timeout
 * or an abort.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  CancellationError,
  run,
  runAsync,
} from '../../src/common/interruptible';
import { withEvaluationEffects } from '../../src/compute-engine/effects-registry';
import type { EffectHandlers } from '../../src/compute-engine/types-effects';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** The stored value of the binding of `name` in the scope of `expr`. The
 * binding must exist and be a value definition, so that a check of its value
 * cannot pass on a binding that the iteration does not write. */
function indexValue(expr: Expression, name: string): string | undefined {
  const def = expr.localScope?.bindings.get(name);
  expect(def !== undefined && 'value' in def).toBe(true);
  if (def === undefined || !('value' in def)) return undefined;
  return def.value.value?.toString();
}

describe('CE-1062: the index of a big operator after an evaluation', () => {
  test('a nested sum simplifies to the same result after evaluate()', () => {
    const nest = ce.box([
      'Sum',
      [
        'Sum',
        [
          'Subtract',
          ['Sin', ['Add', 'k', 'j', 1]],
          ['Sin', ['Add', 'k', 'j']],
        ],
        ['Limits', 'k', 1, 'n'],
      ],
      ['Limits', 'j', 1, 3],
    ]);
    const before = nest.simplify().toString();
    expect(before).toMatchInlineSnapshot(
      `"sum_(j=1)^(3)(-sin(j + 1) + sin(j + n + 1))"`
    );
    nest.evaluate();
    expect(indexValue(nest, 'j')).toBeUndefined();
    expect(nest.simplify().toString()).toBe(before);
  });

  test('a sum over a range', () => {
    const sum = ce.box(['Sum', 'j', ['Limits', 'j', 1, 3]]);
    expect(sum.evaluate().toString()).toBe('6');
    expect(indexValue(sum, 'j')).toBeUndefined();
  });

  test('a product over a range', () => {
    const product = ce.box(['Product', 'j', ['Limits', 'j', 1, 4]]);
    expect(product.evaluate().toString()).toBe('24');
    expect(indexValue(product, 'j')).toBeUndefined();
  });

  test('a sum over an Element domain', () => {
    const sum = ce.box(['Sum', 'k', ['Element', 'k', ['List', 1, 2, 3]]]);
    expect(sum.evaluate().toString()).toBe('6');
    expect(indexValue(sum, 'k')).toBeUndefined();
  });

  test('the walk of an infinite sum', () => {
    // At the default precision (21 digits, more than machine precision), the
    // sum ends with the interpreter walk, which assigns the index
    // (`acceleratedInfiniteSum()`). At machine precision, the compiled walk
    // gives the value and assigns nothing, and this check would test nothing.
    const sum = ce.box([
      'Sum',
      ['Divide', 1, ['Add', ['Power', 'k', 2], ['Sin', 'k']]],
      ['Limits', 'k', 1, 'PositiveInfinity'],
    ]);
    expect(sum.N().re).toBeCloseTo(1.14441559941, 8);
    expect(indexValue(sum, 'k')).toBeUndefined();
  });

  test('the walk of an infinite product', () => {
    const product = ce.box([
      'Product',
      ['Add', 1, ['Divide', 1, ['Power', 'k', 3]]],
      ['Limits', 'k', 1, 'PositiveInfinity'],
    ]);
    expect(product.N().re).toBeCloseTo(2.42818979, 6);
    expect(indexValue(product, 'k')).toBeUndefined();
  });

  test('a cancelled sum', () => {
    const sum = ce.box(['Sum', ['Sin', 'k'], ['Limits', 'k', 1, 10_000_000]]);
    expect(() =>
      ce.withTimeLimit({ ms: 50, label: 'test:ce-1062' }, () => sum.N())
    ).toThrow(CancellationError);
    expect(indexValue(sum, 'k')).toBeUndefined();
  });

  test('an outer symbol with the name of the index keeps its value', () => {
    // The binding of the index is in the scope of the sum: the iteration and
    // the restore do not write the outer symbol of the same name.
    ce.assign('j', 10);
    const sum = ce.box(['Sum', 'j', ['Limits', 'j', 1, 3]]);
    expect(sum.evaluate().toString()).toBe('6');
    expect(ce.box('j').evaluate().toString()).toBe('10');
  });
});

describe('CE-1062: a driver that stops early closes the generator', () => {
  /** A generator that never ends and records when its `finally` runs. */
  function endless(state: { closed: boolean }): Generator<number> {
    return (function* () {
      try {
        for (let i = 0; ; i++) yield i;
      } finally {
        state.closed = true;
      }
    })();
  }

  test('run() on a timeout', () => {
    const state = { closed: false };
    expect(() => run(endless(state), 0)).toThrow(CancellationError);
    expect(state.closed).toBe(true);
  });

  test('runAsync() on an abort', async () => {
    const state = { closed: false };
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAsync(endless(state), 1_000, controller.signal)
    ).rejects.toBeInstanceOf(CancellationError);
    expect(state.closed).toBe(true);
  });

  test('runAsync() on a rejected promise', async () => {
    const state = { closed: false };
    const gen = (function* (): Generator<unknown> {
      try {
        yield Promise.reject(new Error('term failed'));
      } finally {
        state.closed = true;
      }
    })();
    await expect(runAsync(gen, 1_000)).rejects.toThrow('term failed');
    expect(state.closed).toBe(true);
  });

  test('withEvaluationEffects() passes the close to its generator', () => {
    const state = { closed: false };
    const engine = { _evaluationEffects: undefined, _evalContextStack: [] };
    const wrapped = withEvaluationEffects(
      engine,
      {} as EffectHandlers,
      endless(state)
    );
    expect(() => run(wrapped, 0)).toThrow(CancellationError);
    expect(state.closed).toBe(true);
  });
});
