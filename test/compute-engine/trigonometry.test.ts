import { engine } from '../utils';

describe('TRIGONOMETRY constructible values', () => {
  for (const h of ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot']) {
    for (const [n, d] of [
      [0, 1],
      [1, 12],
      [1, 10],
      [1, 8],
      [1, 6],
      [1, 5],
      [1, 4],
      [1, 3],
      [3, 8],
      [2, 5],
      [5, 12],
      [1, 2],
    ]) {
      for (const p of [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]) {
        const theta = (Math.PI * n) / d + (Math.PI / 2) * p;
        let v =
          h === 'Cos'
            ? Math.cos(theta)
            : h === 'Sin'
            ? Math.sin(theta)
            : h === 'Tan'
            ? Math.tan(theta)
            : h === 'Sec'
            ? 1 / Math.cos(theta)
            : h === 'Csc'
            ? 1 / Math.sin(theta)
            : h === 'Cot'
            ? 1 / Math.tan(theta)
            : NaN;

        const arg = [
          'Add',
          ['Multiply', p, 'Half', 'Pi'],
          ['Multiply', 'Pi', ['Rational', n, d]],
        ];

        const f1 = engine.box([h, arg]).N();
        let f = f1.asFloat ?? f1.decimalValue!.toNumber();

        if (Math.abs(f) > 1000000) f = +Infinity;
        if (Math.abs(v) > 1000000) v = +Infinity;

        test(`${h}(${engine.box(arg).simplify().latex})`, () =>
          expect(f).toBeCloseTo(v, 10));
      }
    }
  }
});
