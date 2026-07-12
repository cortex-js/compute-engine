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
    check("9°30'", ['Degrees', ['Rational', 19, 2]]);
  });

  test('parse degrees and arc-minutes with \\prime', () => {
    check('9°30\\prime', ['Degrees', ['Rational', 19, 2]]);
  });

  test('parse full DMS notation', () => {
    check('9°30\'15"', ['Degrees', ['Rational', 2281, 240]]);
  });

  test('parse DMS with \\doubleprime', () => {
    check('9°30\\prime 15\\doubleprime', [
      'Degrees',
      ['Rational', 2281, 240],
    ]);
  });

  test('parse DMS via \\degree trigger', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9\\degree 30'", { form: 'raw' });
    expect(expr.json).toEqual(['Degrees', ['Rational', 19, 2]]);
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
    check("-9°30'", ['Negate', ['Degrees', ['Rational', 19, 2]]]);
  });

  test('negative DMS evaluates correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("-9°30'");
    expect(expr.simplify().latex).toBe('\\frac{-19\\pi}{360}');
  });

  test('negative full DMS', () => {
    check('-45°30\'15"', [
      'Negate',
      ['Degrees', ['Rational', 10921, 240]],
    ]);
  });

  test('Negate(Quantity) evaluates correctly', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Negate', ['Quantity', 9.5, 'deg']]);
    const result = expr.evaluate();
    expect(result.latex).toBe('-9.5\\,\\mathrm{deg}');
  });
});

describe('DMS Arithmetic', () => {
  test('add two DMS angles', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°0'0\" + 1°0'0\"");
    expect(expr.simplify().latex).toBe('\\frac{\\pi}{18}');
  });

  test('add DMS to simple degree', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("45°30' + 44°30'");
    expect(expr.simplify().latex).toBe('\\frac{\\pi}{2}');
  });

  test('parse subtraction in raw form', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("10°30' - 1°15'", { form: 'raw' });
    expect(expr.json).toEqual([
      'Subtract',
      ['Degrees', ['Rational', 21, 2]],
      ['Degrees', ['Rational', 5, 4]],
    ]);
  });
});

describe('Edge Cases', () => {
  test('decimal arc-minutes', () => {
    check("9°30.5'", ['Degrees', ['Rational', 1141, 120]]);
  });

  test('out of range values are mathematically valid', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9°90'");
    expect(expr.simplify().latex).toBe('\\frac{7\\pi}{120}');
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
    const dms = ce.expr(['DMS', 45]).simplify();
    const deg = ce.expr(['Degrees', 45]).simplify();
    expect(dms.isSame(deg)).toBe(true);
  });

  test('DMS(9, 30) canonicalizes to radians', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['DMS', 9, 30]);
    expect(expr.simplify().latex).toBe('\\frac{19\\pi}{360}');
  });

  test('DMS(9, 30, 15) canonicalizes to radians', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['DMS', 9, 30, 15]);
    expect(expr.simplify().latex).toBe('\\frac{2\\,281\\pi}{43\\,200}');
  });

  test('DMS with angularUnit=deg', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    const expr = ce.expr(['DMS', 9, 30, 15]);
    expect(expr.evaluate().latex).toBe('\\frac{2\\,281}{240}');
  });

  test('Negate(DMS(9, 30, 15)) works', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Negate', ['DMS', 9, 30, 15]]);
    expect(expr.simplify().latex).toBe('\\frac{-2\\,281\\pi}{43\\,200}');
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
