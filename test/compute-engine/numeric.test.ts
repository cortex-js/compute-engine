import { ComputeEngine } from '../../src/compute-engine';
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
      N-auto    = 24
      N-mach    = 23.999999999999996
    `));
});

// REVIEW.md D6 follow-up: the two-argument numeric apply path (apply2, used by
// Power) chopped its real result to 0 below the engine tolerance, discarding
// legitimately-small values. exp/Power/ln now evaluate correctly end-to-end.
describe('NUMERIC small magnitudes (REVIEW.md D6)', () => {
  const bigCe = new ComputeEngine();
  bigCe.precision = 50;

  test('Power of a small value is not chopped to 0', () => {
    expect(bigCe.box(['Power', 10, -100]).N().toString()).toBe('1e-100');
    expect(bigCe.box(['Power', 2, -3]).N().toString()).toBe('0.125');
  });

  test('exp of a large-magnitude negative is not 0', () => {
    const r = bigCe.box(['Power', 'ExponentialE', -200]).N().re;
    // e^-200 ≈ 1.3838965e-87 — nonzero, and the right order of magnitude.
    expect(r).toBeGreaterThan(1.3e-87);
    expect(r).toBeLessThan(1.4e-87);
  });

  test('ln of a tiny value evaluates (input no longer chopped to 0)', () => {
    const r = bigCe.parse('\\ln(10^{-100})').N();
    expect(r.re).toBeCloseTo(-230.2585092994, 10);
  });
});
