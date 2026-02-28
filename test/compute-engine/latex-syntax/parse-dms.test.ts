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
    // DMS components are computed to decimal degrees at parse time
    check("9°30'", ['Degrees', 9.5]);
  });

  test('parse degrees and arc-minutes with \\prime', () => {
    check('9°30\\prime', ['Degrees', 9.5]);
  });

  test('parse full DMS notation', () => {
    check('9°30\'15"', ['Degrees', 9.504166666666666]);
  });

  test('parse DMS with \\doubleprime', () => {
    check('9°30\\prime 15\\doubleprime', [
      'Degrees',
      9.504166666666666,
    ]);
  });

  test('parse DMS via \\degree trigger', () => {
    // \\degree should also support DMS
    const ce = new ComputeEngine();
    const expr = ce.parse("9\\degree 30'", { form: 'raw' });
    expect(expr.json).toEqual(['Degrees', 9.5]);
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
  test('parse negative DMS', () => {
    // -9°30' means -(9°30') = -9.5° (geographic convention)
    check("-9°30'", ['Negate', ['Degrees', 9.5]]);
  });

  test('negative DMS evaluates correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("-9°30'");
    // -9.5° = -0.165806... radians
    expect(expr.N().re).toBeCloseTo(-0.165806, 5);
  });

  test('negative full DMS', () => {
    check('-45°30\'15"', [
      'Negate',
      ['Degrees', 45.50416666666667],
    ]);
  });

  test('Negate(Quantity) evaluates correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Negate', ['Quantity', 9.5, 'deg']]);
    const result = expr.evaluate();
    // Result is Quantity(-9.5, deg) — check the magnitude
    expect(result.op1.re).toBeCloseTo(-9.5, 10);
  });
});

describe('DMS Arithmetic', () => {
  test('add two DMS angles', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°0'0\" + 1°0'0\"");
    // 9° + 1° = 10° ≈ 0.174533 radians
    expect(expr.N().re).toBeCloseTo(0.174533, 5);
  });

  test('add DMS to simple degree', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("45°30' + 44°30'");
    // 45.5° + 44.5° = 90° = π/2 ≈ 1.5708 radians
    expect(expr.N().re).toBeCloseTo(Math.PI / 2, 5);
  });

  test('parse subtraction in raw form', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("10°30' - 1°15'", { form: 'raw' });
    expect(expr.json).toEqual([
      'Subtract',
      ['Degrees', 10.5],
      ['Degrees', 1.25],
    ]);
  });
});

describe('Edge Cases', () => {
  test('decimal arc-minutes', () => {
    check("9°30.5'", ['Degrees', 9.508333333333333]);
  });

  test('out of range values are mathematically valid', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°90'");
    // 9° + 90' = 9° + 1.5° = 10.5° ≈ 0.183260 radians
    expect(expr.N().re).toBeCloseTo(0.183260, 5);
  });

  test('zero components', () => {
    check("0°0'0\"", ['Degrees', 0]);
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

describe('DMS Function', () => {
  test('DMS(45) is equivalent to Degrees(45)', () => {
    const ce = new ComputeEngine();
    const dms = ce.box(['DMS', 45]);
    const deg = ce.box(['Degrees', 45]);
    expect(dms.N().re).toBeCloseTo(deg.N().re!, 10);
  });

  test('DMS(9, 30) produces 9.5 degrees in radians', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['DMS', 9, 30]);
    // 9.5° = 0.165806... radians
    expect(expr.N().re).toBeCloseTo(9.5 * Math.PI / 180, 10);
  });

  test('DMS(9, 30, 15) produces correct radians', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['DMS', 9, 30, 15]);
    // 9 + 30/60 + 15/3600 = 9.504166... degrees
    const expectedRad = (9 + 30 / 60 + 15 / 3600) * Math.PI / 180;
    expect(expr.N().re).toBeCloseTo(expectedRad, 10);
  });

  test('DMS with angularUnit=deg', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    const expr = ce.box(['DMS', 9, 30, 15]);
    // In degree mode, should return decimal degrees directly
    expect(expr.N().re).toBeCloseTo(9 + 30 / 60 + 15 / 3600, 10);
  });

  test('Negate(DMS(9, 30, 15)) works', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Negate', ['DMS', 9, 30, 15]]);
    const expectedRad = -(9 + 30 / 60 + 15 / 3600) * Math.PI / 180;
    expect(expr.N().re).toBeCloseTo(expectedRad, 10);
  });

  test('DMS serialization produces DMS notation', () => {
    const ce = new ComputeEngine();
    const expr = ce._fn('DMS', [ce.number(9), ce.number(30), ce.number(15)]);
    expect(expr.toLatex()).toBe('9°30\'15"');
  });

  test('DMS serialization with degrees only', () => {
    const ce = new ComputeEngine();
    const expr = ce._fn('DMS', [ce.number(45)]);
    expect(expr.toLatex()).toBe('45°');
  });

  test('DMS serialization with degrees and minutes', () => {
    const ce = new ComputeEngine();
    const expr = ce._fn('DMS', [ce.number(9), ce.number(30)]);
    expect(expr.toLatex()).toBe("9°30'");
  });
});
