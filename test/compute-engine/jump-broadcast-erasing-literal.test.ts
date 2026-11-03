import { ComputeEngine } from '../../src/compute-engine';

// A jump operator under `.N()` (`Floor`, `Round`, `Mod`, …) broadcast over a
// list literal uses the exact value of each operand near a jump, as it does
// for a scalar operand (`.N()` promises a correct result, see
// `ARCHITECTURE.md`, "What `.N()` promises").

// The exact `q = (25! − 1)/24!`: its 21-digit float is `25.0`, its floor 24.
const q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('c', false);
  return ce;
}

describe('a jump operator over a list literal', () => {
  test('Floor uses the exact elements under .N()', () => {
    const ce = engine();
    expect(
      ce
        .box(['Floor', ['List', q]])
        .N()
        .toString()
    ).toBe('[24]');
  });

  test('Mod uses the exact elements under .N()', () => {
    const ce = engine();
    expect(
      ce
        .box(['Mod', ['List', q], 1])
        .N()
        .toString()
    ).toBe('[1]');
  });

  test('an element computed by a condition is kept', () => {
    const ce = engine();
    ce.assign('c', true);
    expect(
      ce
        .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], q]])
        .N()
        .toString()
    ).toBe('[1,24]');
  });

  test('an exact scalar step or modulus stays exact in the cells', () => {
    const ce = engine();
    const third = ['Rational', 1, 3];
    // The step reaches each cell exact, as it does for the scalar call:
    // `Floor([1], 1/3).N()` was `[0.999…]` where `Floor(1, 1/3).N()` is `1`.
    expect(ce.box(['Floor', 1, third]).N().toString()).toBe('1');
    expect(
      ce
        .box(['Floor', ['List', 1], third])
        .N()
        .toString()
    ).toBe('[1]');
    expect(ce.box(['Mod', 1, third]).N().toString()).toBe('0');
    expect(
      ce
        .box(['Mod', ['List', 1], third])
        .N()
        .toString()
    ).toBe('[0]');
  });

  test('the asynchronous route agrees', async () => {
    const ce = engine();
    const v = await ce
      .box(['Floor', ['List', q]])
      .evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('[24]');
    const m = await ce
      .box(['Mod', ['List', q], 1])
      .evaluateAsync({ numericApproximation: true });
    expect(m.toString()).toBe('[1]');
    const step = await ce
      .box(['Floor', ['List', 1], ['Rational', 1, 3]])
      .evaluateAsync({ numericApproximation: true });
    expect(step.toString()).toBe('[1]');
  });
});
