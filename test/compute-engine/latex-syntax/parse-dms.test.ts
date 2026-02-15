import { ComputeEngine } from '../../../src/compute-engine';
import type { SerializeLatexOptions } from '../../../src/compute-engine';
import type { MathJsonExpression as Expression } from '../../../src/math-json/types';

function check(latex: string, expected: Expression): void {
  const ce = new ComputeEngine();
  const expr = ce.parse(latex, { form: 'raw' });
  expect(expr.json).toEqual(expected);
}

describe('DMS Serialization Configuration', () => {
  test('SerializeLatexOptions accepts dmsFormat', () => {
    const ce = new ComputeEngine();
    const options: SerializeLatexOptions = { dmsFormat: true };
    // Type check passes
    expect(options.dmsFormat).toBe(true);
  });

  test('SerializeLatexOptions accepts angleNormalization', () => {
    const ce = new ComputeEngine();
    const options: SerializeLatexOptions = {
      angleNormalization: '-180...180',
    };
    expect(options.angleNormalization).toBe('-180...180');
  });
});

describe('DMS Parsing', () => {
  test('parse simple degrees unchanged', () => {
    check('9°', ['Degrees', 9]);
  });
});
