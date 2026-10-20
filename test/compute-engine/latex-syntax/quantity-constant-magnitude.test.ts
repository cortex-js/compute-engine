import { ComputeEngine } from '../../../src/compute-engine';

//
// A numeric constant expression juxtaposed with a unit is a quantity:
// `\pi\,\mathrm{rad}` is `π rad`. The magnitude of a quantity must be a
// real, finite value, so a constant expression whose value is complex or
// not finite stays a product with the unit (`isNumericConstant()`,
// `boxed-expression/invisible-operator.ts`).
//

const ce = new ComputeEngine();
const json = (latex: string): unknown => ce.parse(latex).json;

describe('A CONSTANT MAGNITUDE JUXTAPOSED WITH A UNIT', () => {
  test.each([
    ['\\pi\\,\\mathrm{rad}', ['Quantity', 'Pi', 'rad']],
    ['\\mathrm{m}\\,\\pi', ['Quantity', 'Pi', 'm']],
    ['\\sqrt{2}\\,\\mathrm{m}', ['Quantity', ['Sqrt', 2], 'm']],
    ['2\\pi\\,\\mathrm{rad}', ['Quantity', ['Multiply', 2, 'Pi'], 'rad']],
    ['10^{-30}\\,\\mathrm{m}', ['Quantity', ['Power', 10, -30], 'm']],
  ])('%s is a quantity', (latex, expected) => {
    expect(json(latex)).toEqual(expected);
  });

  test.each([
    ['\\sqrt{-1}\\,\\mathrm{m}', ['Multiply', ['Complex', 0, 1], 'm']],
    ['2\\sqrt{-1}\\,\\mathrm{m}', ['Multiply', ['Complex', 0, 2], 'm']],
    ['\\frac{1}{0}\\,\\mathrm{m}', ['Multiply', 'ComplexInfinity', 'm']],
    ['\\frac{0}{0}\\,\\mathrm{m}', ['Multiply', 'Indeterminate', 'm']],
  ])(
    '%s is not a quantity: the value is not real and finite',
    (latex, expected) => {
      expect(json(latex)).toEqual(expected);
    }
  );
});
