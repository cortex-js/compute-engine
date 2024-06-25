import { asFloat } from '../../src/compute-engine/boxed-expression/numerics';
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
        let jsValue =
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

        // const arg = engine
        //   .box([
        //     'Add',
        //     ['Multiply', p, 'Half', 'Pi'],
        //     ['Multiply', 'Pi', ['Rational', n, d]],
        //   ])
        //   .simplify();
        const arg = engine
          .box([
            'Multiply',
            'Pi',
            ['Add', ['Rational', p, 2], ['Rational', n, d]],
          ])
          .simplify();

        // Use evaluate to get the exact value (using N() directly could bypass
        // the constructible value logic)
        const fExact = engine.box([h, arg]).evaluate();

        // Reduce the exact value to a number
        const fNumeric = fExact.N();

        // The numeric and exact values should be the same

        test(`${h}(${arg.latex}) exact = numeric`, () =>
          expect(fNumeric.isEqual(fExact)).toBeTruthy());

        if (fNumeric.symbol === 'ComplexInfinity') {
          test(`${h}(${arg.latex})`, () =>
            expect(Math.abs(jsValue) > 1e6).toBeTruthy());
        } else {
          let f = asFloat(fNumeric) ?? NaN;

          if (Math.abs(f) > 1000000) f = +Infinity;
          if (Math.abs(jsValue) > 1000000) jsValue = +Infinity;
          test(`${h}(${arg.latex})`, () =>
            expect(Math.abs(f - jsValue)).toBeCloseTo(0, 10));
        }
      }
    }
  }
});

describe('TRIGONOMETRY other values', () => {
  test(`arccos`, () =>
    expect(engine.parse('\\cos^{-1}(0.1)').N()).toMatchInlineSnapshot(
      `1.470628905633336822885798512187058123529908727457923369096448441117505529492241947660079548311554079`
    ));
});
