import { ComputeEngine } from '../../src/compute-engine';

// A list literal with an element that may evaluate to `Nothing` is evaluated
// before the broadcast, so that the broadcast walks the elements the list
// keeps. For a jump operator under `.N()` (`Floor`, `Round`, `Mod`, …) that
// evaluation is exact (`erasingLiteralOptions`,
// `boxed-expression/boxed-function.ts`): the handler of each cell then uses
// the exact value of its operand near a jump, as it does for a list without
// an erasing element (`.N()` promises a correct result, see
// `ARCHITECTURE.md`, "What `.N()` promises").

// The exact `q = (25! − 1)/24!`: its 21-digit float is `25.0`, its floor 24.
const q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('c', false);
  return ce;
}

describe('a jump operator over a list literal with an erased element', () => {
  test('Floor uses the exact survivors under .N(), as without the erasure', () => {
    const ce = engine();
    expect(
      ce
        .box(['Floor', ['List', q]])
        .N()
        .toString()
    ).toBe('[24]');
    expect(
      ce
        .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], q]])
        .N()
        .toString()
    ).toBe('[24]');
    // The erasure still happens: one element, not two.
    expect(
      ce
        .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], q]])
        .evaluate()
        .toString()
    ).toBe('[24]');
  });

  test('Mod uses the exact survivors under .N()', () => {
    const ce = engine();
    expect(
      ce
        .box(['Mod', ['List', q], 1])
        .N()
        .toString()
    ).toBe('[1]');
    expect(
      ce
        .box(['Mod', ['List', ['If', 'c', 1, 'Nothing'], q], 1])
        .N()
        .toString()
    ).toBe('[1]');
  });

  test('a kept element is still kept', () => {
    const ce = engine();
    ce.assign('c', true);
    expect(
      ce
        .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], q]])
        .N()
        .toString()
    ).toBe('[1,24]');
  });

  test('an operator that does not jump keeps the approximated survivors', () => {
    const ce = engine();
    const v = ce.box(['Add', ['List', ['If', 'c', 1, 'Nothing'], q], 1]).N();
    expect(v.toString()).toBe('[26]');
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
    expect(
      ce
        .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], 1], third])
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
      .box(['Floor', ['List', ['If', 'c', 1, 'Nothing'], q]])
      .evaluateAsync({ numericApproximation: true });
    expect(v.toString()).toBe('[24]');
    const m = await ce
      .box(['Mod', ['List', ['If', 'c', 1, 'Nothing'], q], 1])
      .evaluateAsync({ numericApproximation: true });
    expect(m.toString()).toBe('[1]');
    const step = await ce
      .box(['Floor', ['List', 1], ['Rational', 1, 3]])
      .evaluateAsync({ numericApproximation: true });
    expect(step.toString()).toBe('[1]');
  });
});
