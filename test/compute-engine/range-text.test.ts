import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

// The text (`toString()`) of a `Range` with the exact step 1 is the Epsil
// range `a..b`, which Epsil reads back as the same range. Any other `Range`
// prints as a call.

const ce = new ComputeEngine();
const text = (json: MathJsonExpression) => ce.box(json).toString();

describe('the text of a range', () => {
  test('an element of a list, a tuple or a set', () => {
    expect(executeEpsil(ce, '[1..2, 1..3]').value.toString()).toBe(
      '[1..2,1..3]'
    );
    expect(executeEpsil(ce, '(1..3, 2)').value.toString()).toBe('(1..3, 2)');
    expect(executeEpsil(ce, '{1..3}').value.toString()).toBe('Set(1..3)');
  });

  test('a range of the value of a program is still listed', () => {
    expect(executeEpsil(ce, '1..3').value.toString()).toBe('[1,2,3]');
  });

  test('a range with no step or another step prints as a call', () => {
    expect(text(['List', ['Range', 1, 5]])).toBe('[Range(1, 5)]');
    expect(text(['List', ['Range', 1, 5, 2]])).toBe('[Range(1, 5, 2)]');
    expect(text(['List', ['Range', 1, 5, 1.5]])).toBe('[Range(1, 5, 1.5)]');
  });

  test('a symbolic range', () => {
    expect(text(['Range', 'x', 5, 1])).toBe('x..5');
    expect(text(['Range', 1, ['Add', 'n', -1], 1])).toBe('1..n - 1');
    expect(text(['Range', ['Multiply', 2, 'n'], ['Power', 'n', 2], 1])).toBe(
      '2n..n^2'
    );
  });

  test('an end that starts with a sign', () => {
    expect(text(['Range', -2, ['Negate', 'n'], 1])).toBe('-2..(-n)');
    expect(text(['List', ['Range', 1, 'PositiveInfinity', 1]])).toBe(
      '[1..oo]'
    );
    expect(text(['List', ['Range', 1, 'ComplexInfinity', 1]])).toBe(
      '[1..(~oo)]'
    );
  });

  test('a start that ends with an operator character', () => {
    expect(text(['Range', ['Factorial', 'n'], 50, 1])).toBe('(n!)..50');
  });

  test('a range operand of another operator is wrapped', () => {
    expect(text(['Add', ['Range', 1, 3, 1], 'x'])).toBe('x + (1..3)');
    expect(text(['Multiply', 2, ['Range', 1, 3, 1]])).toBe('2(1..3)');
    expect(text(['Power', ['Range', 1, 3, 1], 2])).toBe('(1..3)^2');
    expect(text(['Less', ['Range', 1, 3, 1], 2])).toBe('(1..3) < 2');
  });

  test('Epsil reads the text back as the same range', () => {
    for (const json of [
      ['List', ['Range', 1, 5, 1], ['Range', 'n', ['Add', 'n', 1], 1]],
      ['List', ['Range', -2, ['Negate', 'n'], 1]],
      ['List', ['Range', ['Multiply', 2, 'n'], ['Power', 'n', 2], 1]],
      ['List', ['Range', 0.5, 1.5, 1]],
      ['List', ['Range', 1, 'PositiveInfinity', 1]],
      ['List', ['Range', ['Factorial', 'n'], 50, 1]],
    ] as MathJsonExpression[]) {
      const boxed = ce.box(json);
      const result = executeEpsil(ce, boxed.toString());
      expect(result.diagnostics).toEqual([]);
      expect(result.value.json).toEqual(boxed.json);
    }
  });
});
