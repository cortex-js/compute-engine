import { ComputeEngine } from '../../src/compute-engine';

export const ce = new ComputeEngine();

describe.skip('NUMERIC', () => {
  test('Numeric integration', () => {
    // Stretching precision loss. Actual value: 0.210803
    expect(
      ce.evaluate(
        ce.parse(
          `\\int_0^1 \\sech^2 (10(x − 0.2)) + \\sech^4 (100(x − 0.4)) + \\sech^6 (1000(x − 0.6)) dx`
        )
      )
    ).toMatchInlineSnapshot();

    // Correct value: 0.34740017265
    expect(
      ce.evaluate(ce.parse(`\\int_0^8 \\sin(x + e^x) dx`))
    ).toMatchInlineSnapshot();

    // Correct value: 0.09865170447836520611965824976485985650416962079238449145 10919068308266804822906098396240645824
    expect(
      ce.evaluate(ce.parse(`\\int_0^8 (e^x - \\floor(e^x)\\sin(x+e^x) dx`))
    ).toMatchInlineSnapshot();
  });

  test('Solving', () => {
    // Sols -200.000000075 and 0.000000075
    // From https://en.wikipedia.org/wiki/Loss_of_significance
    expect(
      ce.solve(ce.parse(`x^2 + 200x - 0.000015 = 0`), ['x'])
    ).toMatchInlineSnapshot();
  });

  test('Partitioning', () => {
    // Correct answer: 231139177231303975514411787649455628959060199360109972557851519105155176180318215891795874905318274163248033071850
    // expect(ce.evaluate(['Length', ['Partition', 11269]])).toMatchInlineSnapshot();
  });
});
