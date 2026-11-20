/**
 * `Reduce(L, f)` with no initial value, by a function literal, on the IR
 * compiler: the first element is the seed and the fold runs over the rest.
 * JavaScript agrees with the interpreter at lengths 0, 1 and several. Of an
 * empty list the interpreter gives no value, so the compiled code throws.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('J', 'list<integer>');
ce.declare('L', 'list<real>');

const times = ['Function', ['Multiply', 'a', 'b'], 'a', 'b'];
const minus = ['Function', ['Subtract', 'a', 'b'], 'a', 'b'];
const js = (json: unknown) =>
  compile(ce.box(json as never), { fallback: false });

describe('Reduce with no initial value, by a function literal', () => {
  // prettier-ignore
  test.each([
    ['product over Range(1, n), n = 1', ['Reduce', ['Range', 1, 'n'], times], { n: 1 }],
    ['product over Range(1, n), n = 2', ['Reduce', ['Range', 1, 'n'], times], { n: 2 }],
    ['product over Range(1, n), n = 5', ['Reduce', ['Range', 1, 'n'], times], { n: 5 }],
    ['a list of integers', ['Reduce', 'J', times], { J: [3, 4, 5, 2] }],
    ['one element', ['Reduce', 'J', minus], { J: [7] }],
    ['a list of reals', ['Reduce', 'L', minus], { L: [1.5, 0.25, 4] }],
    ['Subtract folds from the left', ['Reduce', 'J', minus], { J: [10, 3, 2] }],
  ])('%s', (_, json, point) => {
    const expected = ce
      .box(json as never)
      .subs(
        Object.fromEntries(
          Object.entries(point).map(([k, v]) => [k, ce.box((Array.isArray(v) ? ['List', ...v] : v) as never)])
        )
      )
      .evaluate().re;
    expect(js(json).run!(point as never)).toBeCloseTo(expected, 12);
  });

  test('Subtract pins the fold direction', () => {
    expect(js(['Reduce', 'J', minus]).run!({ J: [10, 3, 2] } as never)).toBe(5);
  });

  test('an empty list: the interpreter gives no value, the code throws', () => {
    expect(
      ce
        .box(['Reduce', ['List'], times] as never)
        .evaluate()
        .toString()
    ).toBe('"Nothing"');
    expect(() => js(['Reduce', 'J', times]).run!({ J: [] } as never)).toThrow(
      /out-of-range/
    );
  });
});
