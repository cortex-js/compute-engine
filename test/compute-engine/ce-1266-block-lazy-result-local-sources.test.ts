import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// An element-wise operation on a collection of more than 100 elements is a
// lazy `Map` over its operands. When the operands are locals of a block, the
// value of the block names the values of the locals, not the locals: a local
// has no value after its block.

const N = 120;
const range = (n = N) => ['Range', 1, n];
const local = (name: string, value: unknown = range()) => [
  'Declare',
  name,
  { str: 'unknown' },
  value,
];

function run(...statements: unknown[]): Expression {
  return new ComputeEngine().box(['Block', ...statements] as never).evaluate();
}

/** The elements of a collection, as numbers. */
function elements(value: Expression): number[] {
  return [...value.each()].map((x) => x.evaluate().re);
}

const doubles = (n = N) => Array.from({ length: n }, (_, i) => 2 * (i + 1));

describe('CE-1266: a lazy result of a block names the values of its locals', () => {
  test.each([100, 101, N])('the sum of two locals of %i elements', (n) => {
    const value = run(local('x', range(n)), local('y', range(n)), [
      'Add',
      'x',
      'y',
    ]);
    expect(elements(value)).toEqual(doubles(n));
    expect(value.has('x')).toBe(false);
    expect(value.has('y')).toBe(false);
  });

  test('the result over the limit is the lazy Map over the two ranges', () => {
    expect(run(local('x'), local('y'), ['Add', 'x', 'y']).json).toEqual([
      'Map',
      ['Function', ['Block', ['Add', '_1', '_2']], '_1', '_2'],
      ['Range', 1, N],
      ['Range', 1, N],
    ]);
  });

  test('a list local and a scalar local', () => {
    const value = run(local('k', 3), local('x'), ['Add', 'x', 'k']);
    expect(elements(value).slice(0, 3)).toEqual([4, 5, 6]);
    expect(elements(value)).toHaveLength(N);
  });

  test.each([
    ['a product of a sum', ['Multiply', ['Add', 'x', 'y'], 2], 4],
    ['a power of a sum', ['Power', ['Add', 'x', 'y'], 2], 4],
  ])('a lazy collection whose source is lazy: %s', (_name, last, first) => {
    const value = run(local('x'), local('y'), last);
    expect(value.has('x')).toBe(false);
    expect(value.has('y')).toBe(false);
    expect(elements(value)).toHaveLength(N);
    expect(elements(value)[0]).toBe(first);
  });

  test('the last value of a local that was assigned again', () => {
    const value = run(local('x'), ['Assign', 'x', ['Range', 201, 320]], [
      'Add',
      'x',
      1,
    ]);
    expect(elements(value).slice(0, 2)).toEqual([202, 203]);
  });

  test('a local of an enclosing block read in a nested block', () => {
    const value = run(local('x'), ['Block', local('y'), ['Add', 'x', 'y']]);
    expect(elements(value)).toEqual(doubles());
  });

  test('the value of a nested block stored in a local of the outer block', () => {
    const inner = ['Block', local('x'), local('y'), ['Add', 'x', 'y']];
    expect(run(local('z', inner), ['Length', 'z']).re).toBe(N);
  });

  test('the asynchronous route', async () => {
    const value = await new ComputeEngine()
      .box(['Block', local('x'), local('y'), ['Add', 'x', 'y']] as never)
      .evaluateAsync();
    expect(elements(value)).toEqual(doubles());
  });

  test('a global source keeps its name', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(range() as never).evaluate());
    const value = ce
      .box(['Block', local('x'), ['Add', 'x', 'g']] as never)
      .evaluate();
    expect(value.has('g')).toBe(true);
    expect(value.has('x')).toBe(false);
    expect(elements(value)).toEqual(doubles());
  });

  // The function reads the global `x`. The block that calls it has a local
  // with the same name, which is another binding: the result keeps the
  // global.
  test('a global read by a function that the block calls, with a local of the same name', () => {
    const ce = new ComputeEngine();
    ce.box(local('x') as never).evaluate();
    ce.box([
      'Declare',
      'g',
      { str: 'function' },
      ['Function', ['Block', ['Add', 'x', 1]]],
    ] as never).evaluate();
    const value = ce
      .box(['Block', local('x', ['Range', 201, 320]), ['g']] as never)
      .evaluate();
    expect(elements(value).slice(0, 2)).toEqual([2, 3]);
    expect(elements(value)).toHaveLength(N);
  });

  // The call `f(1)` has a local of 121 elements and returns the value of
  // `f(0)`, a sum over the local of that call, which has 120 elements.
  test('a Return from a nested block of a recursive function', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Block',
            local('x', ['Range', 1, ['Add', N, 'n']]),
            [
              'If',
              ['Equal', 'n', 0],
              ['Return', ['Add', 'x', 1]],
              ['f', ['Subtract', 'n', 1]],
            ],
          ],
        ],
        'n',
      ] as never)
    );
    const value = ce.box(['f', 1]).evaluate();
    expect(elements(value)).toHaveLength(N);
    expect(elements(value).slice(0, 2)).toEqual([2, 3]);
  });

  test('a callback that reads a scalar local keeps the name', () => {
    const value = run(local('k', 3), local('x'), [
      'Map',
      ['Function', ['Add', 'a', 'k'], 'a'],
      'x',
    ]);
    expect(value.has('k')).toBe(true);
    expect(elements(value).slice(0, 2)).toEqual([4, 5]);
  });
});
