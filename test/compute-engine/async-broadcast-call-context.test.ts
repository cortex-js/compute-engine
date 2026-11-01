import { ComputeEngine } from '../../src/compute-engine';

/**
 * A broadcast on the asynchronous route evaluates its lifted operands first
 * (an `await`), then zips the operands and builds the cells. That second
 * part runs synchronously after the `await`, when the engine no longer has
 * the context stack of the evaluation installed. In the body of a function
 * literal, a lazy operand such as `Map(f, xs)` reads the parameter `xs` from
 * the frame of the call, which is on that stack only. Outside it, `xs` had
 * no value: `(xs ↦ 1 + Map(x ↦ 2x, xs))([1, 4])` gave `[]` with
 * `evaluateAsync()`, `(xs ↦ -Map(x ↦ 2x, xs))([1, 4])` did not end, and
 * `evaluate()` gave `[3, 9]` and `[-2, -8]`. The broadcast of an operator,
 * of a user function defined with `:=`, and of a function declared with a
 * `broadcastable` signature had the same defect.
 */

// A hang must fail the test, not stop the run.
const TIMEOUT = 10_000;

const double = ['Function', ['Multiply', 2, 'x'], 'x'];
const map = ['Map', double, 'xs'];
const filter = ['Filter', 'xs', ['Function', ['Greater', 'x', 1], 'x']];
const scan = ['Scan', 'xs', ['Function', ['Add', 'a', 'b'], 'a', 'b']];

// The application of `xs ↦ body` to `[1, 4]`.
function apply(body: unknown): unknown {
  return ['Apply', ['Function', body, 'xs'], ['List', 1, 4]];
}

// The elements of a collection, computed and printed, or the value printed.
function elements(x: any): string {
  return x.isCollection
    ? `[${[...x.each()].map((e: any) => e.toString()).join(',')}]`
    : x.toString();
}

describe('an asynchronous broadcast reads a lazy operand in the context of the call', () => {
  const ce = new ComputeEngine();
  ce.parse('g(y) := y + 10').evaluate();
  ce.declare('S', {
    signature: '(broadcastable<real>) -> real',
    evaluate: ce.box(['Function', ['Add', 'y', 10], 'y']),
  } as never);

  test.each([
    ['Negate of a Map', ['Negate', map], '[-2,-8]'],
    ['Add of a Map', ['Add', 1, map], '[3,9]'],
    ['Multiply of a Map', ['Multiply', 3, map], '[6,24]'],
    ['Power of a Map', ['Power', map, 2], '[4,64]'],
    ['Power with a Map exponent', ['Power', 2, map], '[4,256]'],
    ['Sqrt of a Map', ['Sqrt', map], '[1.4142135623730950488,2.8284271247461900976]'],
    ['Add of two Maps', ['Add', map, map], '[4,16]'],
    ['Add of a Filter', ['Add', 1, filter], '[5]'],
    ['Negate of a Filter', ['Negate', filter], '[-4]'],
    ['Add of a Scan', ['Add', 1, scan], '[2,6]'],
    ['a user function of a Map', ['g', map], '[12,18]'],
    ['a user function of a Filter', ['g', filter], '[14]'],
    ['a broadcastable function of a Map', ['S', map], '[12,18]'],
  ])(
    '%s',
    async (_, body, expected) => {
      const e = ce.box(apply(body) as never);
      const options = { numericApproximation: true };
      const sync = elements(e.evaluate(options).N());
      expect(sync).toBe(expected);
      expect(elements((await e.evaluateAsync(options)).N())).toBe(sync);
      expect(elements((await e.evaluateAsync()).N())).toBe(sync);
    },
    TIMEOUT
  );

  test(
    'in nested calls',
    async () => {
      // (xs ↦ (k ↦ 1 + Map(x ↦ k·x, xs))(3))([1, 4])
      const e = ce.box([
        'Apply',
        [
          'Function',
          [
            'Apply',
            [
              'Function',
              [
                'Add',
                1,
                ['Map', ['Function', ['Multiply', 'k', 'x'], 'x'], 'xs'],
              ],
              'k',
            ],
            3,
          ],
          'xs',
        ],
        ['List', 1, 4],
      ] as never);
      expect(elements(e.evaluate())).toBe('[4,13]');
      expect(elements(await e.evaluateAsync())).toBe('[4,13]');
      expect(
        elements(await e.evaluateAsync({ numericApproximation: true }))
      ).toBe('[4,13]');
    },
    TIMEOUT
  );

  test(
    'at the top level',
    async () => {
      const e = ce.box([
        'Add',
        1,
        ['Map', double, ['List', 1, 4]],
      ] as never);
      expect(elements(await e.evaluateAsync())).toBe('[3,9]');
      expect(
        elements(await e.evaluateAsync({ numericApproximation: true }))
      ).toBe('[3,9]');
    },
    TIMEOUT
  );
});
