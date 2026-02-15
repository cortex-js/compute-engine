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

  test('parse degrees and arc-minutes', () => {
    check("9°30'", [
      'Add',
      ['Quantity', 9, 'deg'],
      ['Quantity', 30, 'arcmin'],
    ]);
  });

  test('parse degrees and arc-minutes with \\prime', () => {
    check('9°30\\prime', [
      'Add',
      ['Quantity', 9, 'deg'],
      ['Quantity', 30, 'arcmin'],
    ]);
  });

  test('parse full DMS notation', () => {
    check('9°30\'15"', [
      'Add',
      ['Quantity', 9, 'deg'],
      ['Quantity', 30, 'arcmin'],
      ['Quantity', 15, 'arcsec'],
    ]);
  });

  test('parse DMS with \\doubleprime', () => {
    check('9°30\\prime 15\\doubleprime', [
      'Add',
      ['Quantity', 9, 'deg'],
      ['Quantity', 30, 'arcmin'],
      ['Quantity', 15, 'arcsec'],
    ]);
  });
});
