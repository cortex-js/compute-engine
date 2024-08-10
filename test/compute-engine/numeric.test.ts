import { checkJson, engine as ce } from '../utils';

function evaluate(s: string) {
  return ce.parse(s).evaluate();
}

describe('NUMERIC', () => {
  test('Partitioning', () => {
    // Correct answer: 231139177231303975514411787649455628959060199360109972557851519105155176180318215891795874905318274163248033071850
    // expect(ce.evaluate(['Length', ['Partition', 11269]])).toMatchInlineSnapshot();
  });
});

describe('NUMERIC gamma', () => {
  test(`Gamma(1)`, () =>
    expect(checkJson(['Gamma', 1])).toMatchInlineSnapshot(`
      box       = ["Gamma", 1]
      eval-auto = Gamma(1)
      eval-mach = Gamma(1)
      N-auto    = 1
      N-mach    = 0.9999999999999998
    `));

  test(`Gamma(5)`, () =>
    expect(checkJson(['Gamma', 5])).toMatchInlineSnapshot(`
      box       = ["Gamma", 5]
      eval-auto = Gamma(5)
      eval-mach = Gamma(5)
      N-auto    = 23.9999999999999999994
      N-mach    = 23.999999999999996
    `));
});
