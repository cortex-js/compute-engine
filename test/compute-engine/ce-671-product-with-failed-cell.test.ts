import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-671: the product of a scalar and a list with a failed cell (an
// `Error` element), or of two lists, is a list whose failed cell is the
// error of the cell product (`docs/ERROR-MODEL.md` §3: a broadcast gives the
// cell to the body). The error carries the frame of the operation that ran,
// `Multiply`, as `3·Error(…)` does, and `evaluate()`, `.N()` and
// `evaluateAsync()` give the same result.
//
// Before the fix, `evaluate()` added a `Divide` frame: the cell product was
// built as `Divide(3·Error(…), 1)`, because `canonicalDivide` keeps a
// divisor of `1` when the numerator holds an error. And `.N()` kept the cell
// product unevaluated, `3·Error(…)`, where the error must bubble.

const E = ['Error', "'missing'"];
const errorWithFrame = (index: number) => [
  'Error',
  "'missing'",
  ['ErrorTrace', ['ErrorFrame', "'Multiply'", index]],
];

// An integral that `evaluate()` leaves unevaluated, and `.N()` computes.
const I = ['Integrate', ['Power', 'x', 'x'], ['Limits', 'x', 0, 1]];

describe('CE-671: A PRODUCT WITH A FAILED CELL', () => {
  const ce = new ComputeEngine();

  async function routes(json: any) {
    const expr = ce.box(json);
    return {
      evaluate: expr.evaluate().json,
      N: expr.N().json,
      async: (await expr.evaluateAsync()).json,
    };
  }

  test('the control: a scalar product with an error is the error', async () => {
    const r = await routes(['Multiply', 'y', E]);
    expect(r.evaluate).toEqual(errorWithFrame(2));
    expect(r.N).toEqual(errorWithFrame(2));
    expect(r.async).toEqual(errorWithFrame(2));
  });

  test('a scalar times a list beside an integral', async () => {
    const r = await routes(['Multiply', 'y', ['List', E, I]]);
    expect(r.evaluate[1]).toEqual(errorWithFrame(2));
    expect(r.N[1]).toEqual(errorWithFrame(2));
    expect(r.async[1]).toEqual(errorWithFrame(2));
    // The other cell is computed on each route: the product of `y` and the
    // integral, the same on the two exact routes.
    expect(r.evaluate[2][0]).toBe('Multiply');
    expect(JSON.stringify(r.evaluate[2])).toContain('y');
    expect(r.async[2]).toEqual(r.evaluate[2]);
    expect(JSON.stringify(r.N[2])).toContain('Measurement');
  });

  test('a number times a list', async () => {
    const expected = ['List', errorWithFrame(2), 6];
    const r = await routes(['Multiply', 3, ['List', E, 2]]);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.async).toEqual(expected);
  });

  test('two scalars times a list: the frame is the position in the product', async () => {
    const expected = ['List', errorWithFrame(3), ['Multiply', 2, 'y', 'z']];
    const r = await routes(['Multiply', 'y', 'z', ['List', E, 2]]);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.async).toEqual(expected);
  });

  test('a number times a matrix', async () => {
    const expected = [
      'List',
      ['List', errorWithFrame(2), 2],
      ['List', 4, 6],
    ];
    const r = await routes([
      'Multiply',
      2,
      ['List', ['List', E, 1], ['List', 2, 3]],
    ]);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.async).toEqual(expected);
  });

  test('the element-wise product of two vectors', async () => {
    const expected = ['List', errorWithFrame(2), 8];
    const r = await routes(['Multiply', ['List', E, 2], ['List', 3, 4]]);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.async).toEqual(expected);
  });
});
