import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsilAsync } from '../../src/epsil';

// ROADMAP CE-314.1: `Assign` and `Declare` have an `evaluateAsync` handler.
// Both handlers are one generator each (`assignSteps`, `declareSteps` in
// src/compute-engine/library/core.ts, driven by `operand-steps.ts`): the
// value operand is evaluated with `evaluate()` on the synchronous route and
// with `evaluateAsync()` on the asynchronous one. Before, the asynchronous
// route used the synchronous handler, so `x = FindFit(…)` and
// `let x = FindFit(…)` ran the synchronous `FindFit`, and an operator with
// only an `evaluateAsync` handler stayed unevaluated in the value.

/** `Declare(name, value)` in the form that Epsil's `let` lowers to. */
const declare = (name: string, value: unknown): unknown[] => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', { str: 'value' }, value]],
];

const FIT = [
  'FindFit',
  ['List', ['Tuple', 0, 1], ['Tuple', 1, 3], ['Tuple', 2, 5]],
  ['Add', ['Multiply', 'a', 't'], 'b'],
  ['List', 'a', 'b'],
  ['List', 't'],
];

/** An engine with `Late(x)`, an operator with only an asynchronous handler
 * that gives `x + 1` after a turn of the event loop. */
function lateEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Late', {
    signature: '(integer) -> integer',
    lazy: true,
    evaluateAsync: async ([x], options) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const v = await ce
        .withEvaluationContext(options, () => x.canonical)
        .evaluateAsync(options);
      return ce.number(v.re + 1);
    },
  });
  return ce;
}

describe('Assign and Declare on the asynchronous route', () => {
  test.each([
    ['Assign', ['Assign', 'r', FIT]],
    ['Declare', declare('r', FIT)],
  ])(
    '%s: the value runs the asynchronous handler of FindFit',
    async (_, expr) => {
      const ce = new ComputeEngine();
      const sync = new ComputeEngine().box(expr as never).evaluate();
      const value = await ce.box(expr as never).evaluateAsync();
      // The record of the asynchronous route of `FindFit` has a `route`.
      expect(sync.get('route')).toBeUndefined();
      expect(value.get('route')?.string).toBe('calling-thread');
      expect(ce.box('r').evaluate().get('route')?.string).toBe(
        'calling-thread'
      );
      expect(String(value.get('parameters'))).toBe(
        String(sync.get('parameters'))
      );
    }
  );

  test.each([
    ['Assign', ['Assign', 'y', ['Late', 4]]],
    ['Declare', declare('y', ['Late', 4])],
  ])(
    '%s: an operator with only an asynchronous handler is evaluated',
    async (_, expr) => {
      const ce = lateEngine();
      const value = await ce.box(expr as never).evaluateAsync();
      expect(value.re).toBe(5);
      expect(ce.box('y').evaluate().re).toBe(5);
    }
  );

  test('a field assignment awaits its value', async () => {
    const ce = lateEngine();
    const r = await executeEpsilAsync(
      ce,
      'type Point = object{x: real, y: real}\nlet p = Point(x: 1, y: 2)\np.x = Late(4)\np.x'
    );
    expect(r.value.re).toBe(5);
  });

  test('a destructuring assignment awaits its value', async () => {
    const ce = lateEngine();
    await ce
      .box(['Assign', ['Tuple', 'p', 'q'], ['Tuple', ['Late', 1], 7]] as never)
      .evaluateAsync();
    expect(ce.box('p').evaluate().re).toBe(2);
    expect(ce.box('q').evaluate().re).toBe(7);
  });

  test('a program block: each statement awaits its value', async () => {
    const ce = lateEngine();
    const value = await ce
      .box([
        'Block',
        declare('u', ['Late', 1]),
        ['Assign', 'u', ['Late', 'u']],
        'u',
      ] as never)
      .evaluateAsync();
    expect(value.re).toBe(3);
  });

  test('the routes give the same values and errors', async () => {
    const programs: unknown[] = [
      ['Block', declare('k', 2), ['Assign', 'k', ['Multiply', 'k', 5]], 'k'],
      [
        'Block',
        ['Declare', 'c', { dict: { value: 1, constant: 'True' } }],
        ['Assign', 'c', 2],
      ],
      ['Block', ['Declare', 'n', 'integer'], ['Assign', 'n', { str: 'a' }]],
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 1, 2, 3]],
    ];
    for (const program of programs) {
      let sync: string;
      try {
        sync = String(new ComputeEngine().box(program as never).evaluate());
      } catch (e) {
        sync = `throws ${String(e)}`;
      }
      let async_: string;
      try {
        async_ = String(
          await new ComputeEngine().box(program as never).evaluateAsync()
        );
      } catch (e) {
        async_ = `throws ${String(e)}`;
      }
      expect(async_).toBe(sync);
    }
  });
});
