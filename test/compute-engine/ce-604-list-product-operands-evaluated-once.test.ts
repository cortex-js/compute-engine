import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-604 (Tycho row 476): the `Multiply` evaluate handler evaluates
// its operands, and then the product of a scalar and a list
// (`mulTensors`, arithmetic-mul-div.ts) evaluated the list operand again. A
// list of symbolic cells is not data, so every cell was evaluated a second
// time. With cells that are integrals that cannot be done in closed form,
// each antiderivative was tried once more for nothing: in
// `\int_a^b y\,c(y, L, E)\,dy` with `c(y, D, e) := \int_{-D}^{D} n(x, y, e)\,dx`
// and `E` a list of 6, the integrand `y·c(y, L, E)` is a product of `y` and a
// list of 6 integrals.
//
// `Held` is a lazy operator whose handler counts its calls and leaves the
// expression unevaluated. A lazy operator has no evaluation memo, so each
// evaluation of a `Held` node runs the handler, as for `Integrate`.

function countingEngine(): { ce: ComputeEngine; calls: () => number } {
  const ce = new ComputeEngine();
  let calls = 0;
  ce.declare('Held', {
    signature: '(number) -> number',
    lazy: true,
    evaluate: () => {
      calls += 1;
      return undefined;
    },
  });
  return { ce, calls: () => calls };
}

describe('CE-604: the operands of a product with a list are evaluated once', () => {
  test('a symbol times a list of held cells', () => {
    const { ce, calls } = countingEngine();
    const value = ce
      .box(['Multiply', 'y', ['List', ['Held', 1], ['Held', 2], ['Held', 3]]])
      .evaluate();
    expect(value.json).toEqual([
      'List',
      ['Multiply', 'y', ['Held', 1]],
      ['Multiply', 'y', ['Held', 2]],
      ['Multiply', 'y', ['Held', 3]],
    ]);
    // Each cell is evaluated with the list operand, and once more in its
    // cell product (`multiplyCell`). It was 9 when the list was evaluated a
    // second time.
    expect(calls()).toBe(6);
  });

  test('an exact constant cell still becomes a float beside a float factor', () => {
    const { ce, calls } = countingEngine();
    const value = ce
      .box(['Multiply', 0.5, ['List', ['Held', 1], 'Pi']])
      .evaluate();
    expect(value.ops![0].json).toEqual(['Multiply', 0.5, ['Held', 1]]);
    expect(value.ops![1].isExact).toBe(false);
    expect(value.ops![1].re).toBeCloseTo(Math.PI / 2, 12);
    // It was 4.
    expect(calls()).toBe(3);
  });

  test('the integrals of the Tycho case are the same', () => {
    const ce = new ComputeEngine();
    for (const definition of [
      String.raw`d(x,r)\coloneq\max\left(0,\sqrt{x^2+r^2}-1\right)`,
      String.raw`n(x,r,e_{ps})\coloneq\frac{1}{\max\left(e_{ps},d\left(x,r\right)\right)}\begin{cases}\begin{cases}1&x<-\sqrt{1-r^2}\\0&\text{otherwise}\end{cases}&r\le1\\1&\text{otherwise}\end{cases}`,
      String.raw`c(y,D,e_{ps})\coloneq\int_{-D}^Dn\left(x,y,e_{ps}\right)dx`,
    ])
      ce.parse(definition).evaluate();
    ce.assign('E', ce.parse('[0.001, 0.2]'));
    ce.declare('L', 'real');
    const value = ce
      .parse(String.raw`\int_{0}^{1}y\cdot c\left(y,L,E\right)dy`)
      .evaluate();
    const integral = (e: number) => [
      'Integrate',
      [
        'Function',
        [
          'Block',
          [
            'Multiply',
            'y',
            [
              'Integrate',
              ['Function', ['Block', ['n', 'x', 'y', e]], 'x'],
              ['Limits', 'x', ['Negate', 'L'], 'L'],
            ],
          ],
        ],
        'y',
      ],
      ['Limits', 'y', 0, 1],
    ];
    expect(value.json).toEqual(['List', integral(0.001), integral(0.2)]);
  });
});
