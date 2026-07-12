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
      N-mach    = 1
    `));

  test(`Gamma(5)`, () =>
    expect(checkJson(['Gamma', 5])).toMatchInlineSnapshot(`
      box       = ["Gamma", 5]
      eval-auto = Gamma(5)
      eval-mach = Gamma(5)
      N-auto    = 24
      N-mach    = 24
    `));
});

// REVIEW.md D6 follow-up: the two-argument numeric apply path (apply2, used by
// Power) chopped its real result to 0 below the engine tolerance, discarding
// legitimately-small values. exp/Power/ln now evaluate correctly end-to-end.
describe('NUMERIC small magnitudes (REVIEW.md D6)', () => {
  const bigCe = new ComputeEngine();
  bigCe.precision = 50;

  test('Power of a small value is not chopped to 0', () => {
    expect(bigCe.expr(['Power', 10, -100]).N().toString()).toBe('1e-100');
    expect(bigCe.expr(['Power', 2, -3]).N().toString()).toBe('0.125');
  });

  test('exp of a large-magnitude negative is not 0', () => {
    const r = bigCe.expr(['Power', 'ExponentialE', -200]).N().re;
    // e^-200 ≈ 1.3838965e-87 — nonzero, and the right order of magnitude.
    expect(r).toBeGreaterThan(1.3e-87);
    expect(r).toBeLessThan(1.4e-87);
  });

  test('ln of a tiny value evaluates (input no longer chopped to 0)', () => {
    const r = bigCe.parse('\\ln(10^{-100})').N();
    expect(r.re).toBeCloseTo(-230.2585092994, 10);
  });
});

// REVIEW.md D8: the canonicalInteger radical lookup table had two wrong
// entries — 8 → [1,8] (should be [2,2]) and 20 → [1,20] (should be [2,5]) —
// so exact √8 / √20 did not normalize, breaking structural equality.
describe('NUMERIC radical normalization (REVIEW.md D8)', () => {
  test('exact sqrt extracts perfect-square factors for 8 and 20', () => {
    expect(ce.parse('\\sqrt{8}').isSame(ce.parse('2\\sqrt{2}'))).toBe(true);
    expect(ce.parse('\\sqrt{20}').isSame(ce.parse('2\\sqrt{5}'))).toBe(true);
  });

  test('previously-correct table entries are unaffected', () => {
    expect(ce.parse('\\sqrt{12}').isSame(ce.parse('2\\sqrt{3}'))).toBe(true);
    expect(ce.parse('\\sqrt{18}').isSame(ce.parse('3\\sqrt{2}'))).toBe(true);
    expect(ce.parse('\\sqrt{16}').isSame(ce.number(4))).toBe(true);
  });
});
