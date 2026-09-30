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
    check('9°30\\prime 15\\doubleprime', ['Degrees', ['Rational', 2281, 240]]);
  });

  test('parse DMS seconds with two postfix \\prime tokens', () => {
    check('9°30\\prime 15\\prime\\prime', ['Degrees', ['Rational', 2281, 240]]);
  });

  test('parse DMS via \\degree trigger', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse("9\\degree 30'", { form: 'raw' });
    expect(expr.json).toEqual(['Degrees', ['Rational', 19, 2]]);
  });

  test('parse DMS with superscript arc markers', () => {
    check('9^{\\circ}30^{\\prime}15^{\\doubleprime}', [
      'Degrees',
      ['Rational', 2281, 240],
    ]);
  });

  test('parse DMS seconds with two superscript \\prime tokens', () => {
    check('9^{\\circ}30^{\\prime}15^{\\prime\\prime}', [
      'Degrees',
      ['Rational', 2281, 240],
    ]);
  });

  test('parse DMS seconds with two ASCII apostrophes', () => {
    check("9°30'15''", ['Degrees', ['Rational', 2281, 240]]);
  });

  test('`\\minute` and `\\second` are not arc markers (siunitx time units)', () => {
    // The angle stops at the degrees: the number that follows is not read
    // as minutes or seconds, whatever becomes of the command itself.
    const ce = new ComputeEngine();
    const minute = ce.parse('9\\degree 30\\minute', { form: 'raw' }).json;
    expect(minute).not.toEqual(['Degrees', ['Rational', 19, 2]]);
    expect(JSON.stringify(minute)).toContain('["Degrees",9]');
    const second = ce.parse("9°30'15\\second", { form: 'raw' }).json;
    expect(second).not.toEqual(['Degrees', ['Rational', 2281, 240]]);
    expect(JSON.stringify(second)).toContain('["Degrees",["Rational",19,2]]');
  });
});

describe('DMS Parsing: seconds with the minutes omitted', () => {
  // `9°30"` is 9 degrees and 30 seconds = 9 + 30/3600 = 1081/120 degrees.
  // The seconds marker is tested before the minute marker: `''` and
  // `\prime\prime` begin with a minute marker, and reading the first half
  // as minutes left a stray prime that made the whole angle a derivative.
  const SPELLINGS = [
    '9°30"',
    "9°30''",
    '9°30\\prime\\prime',
    '9°30\\doubleprime',
    '9^{\\circ}30^{\\prime\\prime}',
    '9^{\\circ}30^{\\doubleprime}',
    '9\\degree 30\\doubleprime',
  ];
  for (const latex of SPELLINGS) {
    test(`parse ${latex}`, () => {
      check(latex, ['Degrees', ['Rational', 1081, 120]]);
    });
  }

  test('symbolic degrees with seconds only', () => {
    check('x°30"', [
      'Add',
      ['Quantity', 'x', 'deg'],
      ['Quantity', 30, 'arcsec'],
    ]);
  });

  test('a minute marker still reads as minutes', () => {
    check("9°30'", ['Degrees', ['Rational', 19, 2]]);
    check('9°30\\prime', ['Degrees', ['Rational', 19, 2]]);
  });
});

describe('Prime Disambiguation', () => {
  test('prime after non-degree is derivative', () => {
    check("f'", ['Prime', 'f']);
  });

  test('prime in function call is derivative', () => {
    check("f'(x)", ['Apply', ['Derivative', 'f', 1], 'x']);
  });

  test('degree followed by separate function with prime', () => {
    // 9° followed by f'(x) - they should be separate
    const ce = new ComputeEngine();
    const expr = ce.parse("9° f'(x)");
    // Should parse as multiplication or sequence, not as DMS
    expect(JSON.stringify(expr.json)).not.toContain('arcmin');
  });

  test('a derivative after a DMS angle is not read as arc-seconds', () => {
    // The seconds marker is tested before the minute marker, and `''` is a
    // seconds marker: it must still bind to `f`, not to the angle. Every
    // marker check runs only after a NUMBER has been read, so `f` ends the
    // angle and restores the position.
    check("9°30' f''(x)", [
      'InvisibleOperator',
      ['Degrees', ['Rational', 19, 2]],
      ['Apply', ['Derivative', 'f', 2], 'x'],
    ]);
    check("9° f''(x)", [
      'InvisibleOperator',
      ['Degrees', 9],
      ['Apply', ['Derivative', 'f', 2], 'x'],
    ]);
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
    expect(expr.simplify().latex).toBe('-\\frac{19\\pi}{360}');
  });

  test('negative full DMS', () => {
    check('-45°30\'15"', ['Negate', ['Degrees', ['Rational', 10921, 240]]]);
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
    const expr = ce.parse('9°0\'0" + 1°0\'0"');
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
    check('0°0\'0"', ['Degrees', 0]);
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

describe('Decimal Components', () => {
  test('decimal arc-seconds stay exact', () => {
    // (3600·9 + 60·30 + 15.5)/3600 = 34215.5/3600 = 68431/7200
    check('9°30\'15.5"', ['Degrees', ['Rational', 68431, 7200]]);
  });

  test('decimal arc-seconds evaluate exactly', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('9°30\'15.5"');
    const expected = ce.expr(['Divide', ['Multiply', 68431, 'Pi'], 1296000]);
    expect(expr.simplify().isSame(expected.simplify())).toBe(true);
  });

  test('dirty decimal arc-minutes recover the exact decimal', () => {
    // 60·30.000001 is not exactly representable in binary; the
    // scaled-rational recovery still lands on the intended
    // 9.500000016666...° = 570000001/60000000
    check("9°30.000001'", ['Degrees', ['Rational', 570000001, 60000000]]);
  });

  test('unrecoverable decimals fall back to float degrees, not NaN', () => {
    const ce = new ComputeEngine();
    // 15.123456789" needs a 10^9 scale factor, beyond exact recovery
    const expr = ce.parse('9°30\'15.123456789"');
    expect(expr.N().re).toBeCloseTo(
      ((9 + 30 / 60 + 15.123456789 / 3600) * Math.PI) / 180,
      12
    );
  });

  test('DMS() with decimal seconds stays exact', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['DMS', 9, 30, 15.5]);
    const expected = ce.expr(['Divide', ['Multiply', 68431, 'Pi'], 1296000]);
    expect(expr.simplify().isSame(expected.simplify())).toBe(true);
  });

  test('DMS() with unrecoverable decimals is not NaN', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['DMS', 9, 30, 15.123456789]);
    expect(expr.N().re).toBeCloseTo(
      ((9 + 30 / 60 + 15.123456789 / 3600) * Math.PI) / 180,
      12
    );
  });

  test('exact result agrees with numeric evaluation', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('9°30\'15"');
    expect(expr.N().re).toBeCloseTo(
      ((9 + 30 / 60 + 15 / 3600) * Math.PI) / 180,
      12
    );
  });
});

describe('Bignum Degrees', () => {
  test('Degrees of an integer beyond 2^53 stays exact', () => {
    const ce = new ComputeEngine();
    // 2^53 + 1 = 9007199254740993 is divisible by 3:
    // (2^53+1)/180 = 3002399751580331/60. Truncation through `.re` would
    // silently produce a *wrong* exact result (2251799813685248/45).
    const expr = ce.function('Degrees', [
      ce.number(BigInt('9007199254740993')),
    ]);
    const expected = ce.expr([
      'Divide',
      ['Multiply', 3002399751580331, 'Pi'],
      60,
    ]);
    expect(expr.isSame(expected)).toBe(true);
  });

  test('Degrees of a bignum rational stays exact', () => {
    const ce = new ComputeEngine();
    const arg = ce.number([BigInt('123456789012345678901'), BigInt(7)]);
    const expr = ce.function('Degrees', [arg]);
    const expected = ce
      .number([BigInt('123456789012345678901'), BigInt(1260)])
      .mul(ce.Pi);
    expect(expr.isSame(expected)).toBe(true);
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
    expect(expr.simplify().latex).toBe('-\\frac{2\\,281\\pi}{43\\,200}');
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
