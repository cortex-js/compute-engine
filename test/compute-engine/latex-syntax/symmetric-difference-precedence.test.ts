import { ComputeEngine } from '../../../src/compute-engine';
import type { MathJsonExpression } from '../../../src/math-json/types';

// `\triangle` binds as tightly as `\cup` and `\cap`, not as loosely as `=`.

describe('SYMMETRIC DIFFERENCE PRECEDENCE', () => {
  test('a relation takes the symmetric difference as its operand', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('a \\triangle b = c', { canonical: false }).json).toEqual([
      'Equal',
      ['SymmetricDifference', 'a', 'b'],
      'c',
    ]);
    expect(ce.parse('a \\triangle b = c').json).toEqual([
      'Equal',
      ['SymmetricDifference', 'a', 'b'],
      'c',
    ]);
    expect(ce.parse('a = b \\triangle c').json).toEqual([
      'Equal',
      'a',
      ['SymmetricDifference', 'b', 'c'],
    ]);
    expect(ce.parse('a \\triangle b \\subset c').json).toEqual([
      'Subset',
      ['SymmetricDifference', 'a', 'b'],
      'c',
    ]);
  });

  test('a set identity parses as an equation', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('A \\triangle B = (A \\setminus B) \\cup (B \\setminus A)').json
    ).toEqual([
      'Equal',
      ['SymmetricDifference', 'A', 'B'],
      ['Union', ['SetMinus', 'A', 'B'], ['SetMinus', 'B', 'A']],
    ]);
  });

  const roundTrips: MathJsonExpression[] = [
    ['Equal', ['SymmetricDifference', 'a', 'b'], 'c'],
    ['SymmetricDifference', 'a', ['Union', 'b', 'c']],
    ['Union', 'a', ['SymmetricDifference', 'b', 'c']],
    ['SymmetricDifference', ['SetMinus', 'a', 'b'], 'c'],
  ];
  for (const expr of roundTrips) {
    test(`${JSON.stringify(expr)} reads back`, () => {
      const ce = new ComputeEngine();
      const boxed = ce.box(expr);
      expect(ce.parse(boxed.latex).json).toEqual(boxed.json);
    });
  }
});
