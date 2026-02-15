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

describe('Prime Disambiguation', () => {
  test('prime after non-degree is derivative', () => {
    check("f'", ['Prime', 'f']);
  });

  test('prime in function call is derivative', () => {
    check("f'(x)", ['D', ['f', 'x'], 'x']);
  });

  test('degree followed by separate function with prime', () => {
    // 9° followed by f'(x) - they should be separate
    const ce = new ComputeEngine();
    const expr = ce.parse('9° f\'(x)');
    // Should parse as multiplication or sequence, not as DMS
    expect(expr.json).not.toContain('arcmin');
  });
});

describe('Negative Angles', () => {
  test('parse negative DMS with parentheses', () => {
    check("(-9)°30'", [
      'Add',
      ['Quantity', ['Delimiter', ['Negate', 9]], 'deg'],
      ['Quantity', 30, 'arcmin'],
    ]);
  });

  test('negative DMS evaluates correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("(-9)°30'");
    // (-9)° + 30' = -9° + 0.5° = -8.5°
    expect(expr.N().json).toEqual(['Quantity', -8.5, 'deg']);
  });

  test('negative full DMS', () => {
    check('(-45)°30\'15"', [
      'Add',
      ['Quantity', ['Delimiter', ['Negate', 45]], 'deg'],
      ['Quantity', 30, 'arcmin'],
      ['Quantity', 15, 'arcsec'],
    ]);
  });
});

describe('DMS Arithmetic', () => {
  test('add two DMS angles', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°0'0\" + 1°0'0\"");
    // 9° + 1° = 10°
    expect(expr.N().json).toEqual(['Quantity', 10, 'deg']);
  });

  test('add DMS to simple degree', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("45°30' + 44°30'");
    // 45.5° + 44.5° = 90°
    expect(expr.N().json).toEqual(['Quantity', 90, 'deg']);
  });

  test('parse subtraction in raw form', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("10°30' - 1°15'", { form: 'raw' });
    // Should parse as Add with Negate
    expect(expr.json).toEqual([
      'Add',
      ['Add', ['Quantity', 10, 'deg'], ['Quantity', 30, 'arcmin']],
      ['Negate', ['Add', ['Quantity', 1, 'deg'], ['Quantity', 15, 'arcmin']]],
    ]);
  });
});

describe('Edge Cases', () => {
  test('decimal arc-minutes', () => {
    check("9°30.5'", [
      'Add',
      ['Quantity', 9, 'deg'],
      ['Quantity', 30.5, 'arcmin'],
    ]);
  });

  test('out of range values are mathematically valid', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°90'");
    // 9° + 90' = 9° + 1.5° = 10.5°
    expect(expr.N().json).toEqual(['Quantity', 10.5, 'deg']);
  });

  test('zero components', () => {
    check("0°0'0\"", [
      'Add',
      ['Quantity', 0, 'deg'],
      ['Quantity', 0, 'arcmin'],
      ['Quantity', 0, 'arcsec'],
    ]);
  });

  test('minutes only (no degree symbol) is derivative', () => {
    check("30'", ['Prime', 30]);
  });

  test('explicit arcmin unit', () => {
    check('30\\,\\mathrm{arcmin}', [
      'InvisibleOperator',
      30,
      ['__unit__', 'arcmin'],
    ]);
  });

  test('explicit arcsec unit', () => {
    check('15\\,\\mathrm{arcsec}', [
      'InvisibleOperator',
      15,
      ['__unit__', 'arcsec'],
    ]);
  });
});
