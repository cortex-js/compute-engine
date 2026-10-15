import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// The quotient shortcut of `Numerator`, `Denominator` and `NumeratorDenominator`
// applies to a one-operand call only. A call with more operands keeps them, so a
// handler that takes options (an extension of the head) still sees them.
describe('Numerator, Denominator and NumeratorDenominator keep extra operands', () => {
  test.each([
    [
      ['Numerator', ['Divide', 'a', 'b'], 'x'],
      ['Numerator', ['Divide', 'a', 'b'], 'x'],
    ],
    [
      ['Denominator', ['Divide', 'a', 'b'], 'x'],
      ['Denominator', ['Divide', 'a', 'b'], 'x'],
    ],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
      ['NumeratorDenominator', ['Divide', 'a', 'b'], 'x'],
    ],
  ])('%j stays a call', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
  });

  test.each([
    [['Numerator', ['Divide', 'a', 'b']], 'a'],
    [['Denominator', ['Divide', 'a', 'b']], 'b'],
    [
      ['NumeratorDenominator', ['Divide', 'a', 'b']],
      ['Tuple', 'a', 'b'],
    ],
  ])('%j still takes the shortcut', (input, expected) => {
    expect(ce.box(input as any).json).toEqual(expected);
  });
});
