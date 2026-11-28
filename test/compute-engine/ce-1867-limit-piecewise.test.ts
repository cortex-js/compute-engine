/**
 * CE-1867: the limit of a function defined by cases (`Which`, `If`,
 * `Boole`) at a point on the boundary of a condition. The substitution of
 * the point gave the value of the branch that holds AT the point
 * (`If(x < 0, 1, 2)` is 2 at 0), also for the limit from the other side.
 * The limit from one side now takes the branch that holds on that side; the
 * two-sided limit is the common value of the two sides, or stays
 * unevaluated.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

function limitOf(body: unknown, point: unknown, dir?: number): string {
  const ops: unknown[] = [['Function', body, 'x'], point];
  if (dir !== undefined) ops.push(dir);
  return ce
    .box(['Limit', ...ops] as any)
    .evaluate()
    .toString();
}

const step: any = ['Which', ['Less', 'x', 0], 1, 'True', 2];

describe('CE-1867: limit of a function defined by cases', () => {
  test('the witness: a jump at the boundary of the condition', () => {
    expect(limitOf(step, 0, -1)).toBe('1');
    expect(limitOf(step, 0, 1)).toBe('2');
    expect(limitOf(['If', ['Less', 'x', 0], 1, 2], 0, -1)).toBe('1');
    expect(limitOf(['If', ['Less', 'x', 0], 1, 2], 0, 1)).toBe('2');
    // The sides differ: the two-sided limit stays unevaluated.
    expect(
      ce.box(['Limit', ['Function', step, 'x'], 0]).evaluate().operator
    ).toBe('Limit');
    expect(
      ce
        .box([
          'Limit',
          [
            'Function',
            ['If', ['Less', 'x', 1], 'x', ['Multiply', 2, 'x']],
            'x',
          ],
          1,
        ])
        .evaluate().operator
    ).toBe('Limit');
  });

  test('the two sides agree: the two-sided limit is their value', () => {
    expect(limitOf(['If', ['Less', 'x', 1], 'x', ['Power', 'x', 2]], 1)).toBe(
      '1'
    );
    // The difference is 0 at the point: its sign comes from the Laurent
    // expansion, which is positive on each side.
    expect(limitOf(['If', ['Greater', ['Power', 'x', 2], 0], 1, 2], 0)).toBe(
      '1'
    );
    // `x = 0` is false at each point near 0 but 0 itself.
    expect(limitOf(['If', ['Equal', 'x', 0], 5, ['Add', 'x', 1]], 0)).toBe('1');
  });

  test('the point is not on a boundary', () => {
    expect(limitOf(['If', ['Less', 'x', 0], 1, 2], 5)).toBe('2');
    expect(limitOf(['If', ['Less', 'x', 0], 1, 2], -3)).toBe('1');
  });

  test('a term of a larger expression, and a compound condition', () => {
    expect(limitOf(['Add', 1, ['If', ['Less', 'x', 0], 1, 2]], 0, -1)).toBe(
      '2'
    );
    expect(
      limitOf(['If', ['And', ['Less', 0, 'x'], ['Less', 'x', 1]], 1, 0], 0, 1)
    ).toBe('1');
    expect(limitOf(['If', ['Not', ['Less', 'x', 0]], 1, 0], 0, -1)).toBe('0');
  });

  test('Boole is If(c, 1, 0)', () => {
    expect(limitOf(['Add', 'x', ['Boole', ['Equal', 'x', 0]]], 0)).toBe('0');
    expect(limitOf(['Boole', ['Less', 'x', 0]], 0, -1)).toBe('1');
    expect(limitOf(['Boole', ['Less', 'x', 0]], 0, 1)).toBe('0');
  });

  test('a term in which x is bound is not a case of the limit variable', () => {
    // The `x` of the sum runs over 1..3: the sum is 6 for each outer x.
    expect(
      limitOf(
        [
          'Add',
          'x',
          ['Sum', ['If', ['Less', 'x', 0], 1, 2], ['Limits', 'x', 1, 3]],
        ],
        0,
        -1
      )
    ).toBe('6');
  });

  test('an If with no else branch, and a case in a branch that does not hold', () => {
    expect(limitOf(['If', ['Greater', 'x', 0], 'x'], 1)).toBe('1');
    expect(
      limitOf(
        ['If', ['Less', 'x', 0], ['If', ['Element', 'x', 'Integers'], 1, 2], 3],
        1
      )
    ).toBe('3');
  });

  test('a comparison of values not known to be real declines', () => {
    // Each comparison is false for x < 0, where the square roots are not
    // real, although the limit of the difference is real.
    const conditions: any[] = [
      ['Greater', ['Add', 1, ['Sqrt', 'x']], 0],
      ['Less', ['Sqrt', 'x'], ['Add', ['Sqrt', 'x'], 1]],
      ['Greater', ['Sqrt', ['Multiply', 'x', ['Subtract', 'x', 1e-7]]], -1],
    ];
    for (const [c, dir] of [
      [conditions[0], -1],
      [conditions[1], -1],
      [conditions[2], 1],
    ])
      expect(
        ce.box(['Limit', ['Function', ['If', c, 1, 2], 'x'], 0, dir]).evaluate()
          .operator
      ).toBe('Limit');
  });

  test('a case under a condition that does not read x and is false', () => {
    expect(
      limitOf(
        ['If', 'True', 'x', ['If', ['Element', 'x', 'Integers'], 1, 2]],
        0
      )
    ).toBe('0');
  });

  test('N() gives the value of the one-sided limit', () => {
    expect(
      ce
        .box(['Limit', ['Function', step, 'x'], 0, -1])
        .N()
        .toString()
    ).toBe('1');
  });
});
