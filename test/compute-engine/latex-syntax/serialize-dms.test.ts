import { normalizeAngle, degreesToDMS } from '../../../src/compute-engine/latex-syntax/serialize-dms';
import { ComputeEngine } from '../../../src/compute-engine';

describe('Degrees Function Serialization', () => {
  const ce = new ComputeEngine();

  test('serialize Degrees with normalization', () => {
    // Use ce._fn() to bypass canonicalization which converts Degrees to radians
    const expr = ce._fn('Degrees', [ce.number(370)]);
    const latex = expr.toLatex({ angleNormalization: '0...360' });
    expect(latex).toBe('10°');
  });

  test('serialize Degrees with DMS format', () => {
    const expr = ce._fn('Degrees', [ce.number(9.5)]);
    const latex = expr.toLatex({ dmsFormat: true });
    expect(latex).toBe("9°30'");
  });

  test('serialize negative Degrees with DMS', () => {
    const expr = ce._fn('Degrees', [ce.number(-45.5)]);
    const latex = expr.toLatex({ dmsFormat: true });
    expect(latex).toBe("-45°30'");
  });
});

describe('DMS Serialization Integration', () => {
  const ce = new ComputeEngine();

  test('serialize Quantity with dmsFormat', () => {
    const expr = ce.box(['Quantity', 9.5, 'deg']);
    const latex = expr.toLatex({ dmsFormat: true });
    expect(latex).toBe("9°30'");
  });

  test('serialize full DMS', () => {
    const expr = ce.box(['Quantity', 9.504166666666666, 'deg']);
    const latex = expr.toLatex({ dmsFormat: true });
    expect(latex).toBe('9°30\'15"');
  });

  test('serialize without dmsFormat uses decimal', () => {
    const expr = ce.box(['Quantity', 9.5, 'deg']);
    const latex = expr.toLatex({ dmsFormat: false });
    // Without dmsFormat, uses default unit serialization
    expect(latex).toBe('9.5\\,\\mathrm{deg}');
  });

  test('serialize with angle normalization', () => {
    const expr = ce.box(['Quantity', 370, 'deg']);
    const latex = expr.toLatex({ angleNormalization: '0...360' });
    expect(latex).toBe('10°');
  });

  test('combine DMS format with normalization', () => {
    const expr = ce.box(['Quantity', 370, 'deg']);
    const latex = expr.toLatex({
      dmsFormat: true,
      angleNormalization: '0...360',
    });
    expect(latex).toBe("10°0'0\"");
  });
});

describe('Angle Normalization', () => {
  test('none: no normalization', () => {
    expect(normalizeAngle(370, 'none')).toBe(370);
    expect(normalizeAngle(-45, 'none')).toBe(-45);
  });

  test('0...360: normalize to [0, 360)', () => {
    expect(normalizeAngle(370, '0...360')).toBeCloseTo(10, 10);
    expect(normalizeAngle(-45, '0...360')).toBeCloseTo(315, 10);
    expect(normalizeAngle(720, '0...360')).toBeCloseTo(0, 10);
  });

  test('-180...180: normalize to [-180, 180]', () => {
    expect(normalizeAngle(190, '-180...180')).toBeCloseTo(-170, 10);
    expect(normalizeAngle(-190, '-180...180')).toBeCloseTo(170, 10);
    expect(normalizeAngle(370, '-180...180')).toBeCloseTo(10, 10);
  });
});

describe('DMS Formatting', () => {
  test('whole degrees only', () => {
    expect(degreesToDMS(9)).toEqual({ deg: 9, min: 0, sec: 0 });
  });

  test('degrees and minutes', () => {
    expect(degreesToDMS(9.5)).toEqual({ deg: 9, min: 30, sec: 0 });
  });

  test('full DMS', () => {
    const result = degreesToDMS(9.504166666666666);
    expect(result.deg).toBe(9);
    expect(result.min).toBe(30);
    expect(result.sec).toBeCloseTo(15, 1);
  });

  test('negative degrees', () => {
    const result = degreesToDMS(-9.5);
    expect(result.deg).toBe(-9);
    expect(result.min).toBe(-30);
    expect(result.sec).toBe(0);
  });

  test('rounds seconds to avoid floating point noise', () => {
    const result = degreesToDMS(9.504166666666);
    expect(result.sec).toBeCloseTo(15, 2);
  });
});

describe('Round-Trip Parsing and Serialization', () => {
  const ce = new ComputeEngine();

  test('parse and serialize DMS maintains value', () => {
    const input = "9°30'15\"";
    const expr = ce.parse(input);

    // Evaluate to get a single Quantity, then serialize with DMS format
    const evaluated = expr.N();
    const serialized = evaluated.toLatex({ dmsFormat: true });

    // Should serialize to same or equivalent DMS
    const reparsed = ce.parse(serialized);
    const reparsedEvaluated = reparsed.N();

    // Compare the numeric values (should be approximately equal)
    expect(evaluated.json).toEqual(['Quantity', { num: '9.504166666666666' }, 'deg']);
    expect(reparsedEvaluated.json).toEqual(['Quantity', { num: '9.504166666666666' }, 'deg']);
  });

  test('parse decimal degrees, serialize as DMS', () => {
    // Use Quantity to preserve the degree unit (parsing 9.5° converts to radians)
    const expr = ce.box(['Quantity', 9.5, 'deg']);
    const latex = expr.toLatex({ dmsFormat: true });
    expect(latex).toBe("9°30'");
  });

  test('parse DMS, serialize as decimal', () => {
    const expr = ce.parse("9°30'");

    // Evaluate to get a single Quantity
    const evaluated = expr.N();
    const latex = evaluated.toLatex({ dmsFormat: false });

    // Should use decimal degrees
    expect(latex).toBe('9.5\\,\\mathrm{deg}');
  });

  test('normalization preserves mathematical value modulo period', () => {
    // Use Quantity to preserve the degree unit
    const expr = ce.box(['Quantity', 370, 'deg']);
    const normalized = expr.toLatex({ angleNormalization: '0...360' });
    expect(normalized).toBe('10°');

    // 370° and 10° differ by exactly 360°
    const diff = 370 - 10;
    expect(diff).toBe(360);
  });
});
