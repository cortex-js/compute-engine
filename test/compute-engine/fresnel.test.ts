/**
 * Tests for Fresnel integrals (FresnelS, FresnelC)
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  fresnelS,
  fresnelC,
} from '../../src/compute-engine/numerics/special-functions';

const ce = new ComputeEngine();

// Reference values computed from Cephes rational approximation (verified against DLMF)
const FRESNEL_S_REF: [number, number][] = [
  [0, 0],
  [1, 0.438259147390355],
  [2, 0.343415678363698],
  [0.5, 0.064732432859999],
];

// Region 2 values tested separately with looser precision
const FRESNEL_S_REGION2: [number, number][] = [
  [3, 0.496313],
  [5, 0.499191],
];

const FRESNEL_C_REF: [number, number][] = [
  [0, 0],
  [1, 0.779893400376823],
  [2, 0.488253406075341],
  [0.5, 0.492344225871443],
];

const FRESNEL_C_REGION2: [number, number][] = [
  [3, 0.605721],
  [5, 0.563631],
];

describe('FRESNEL - Numeric fresnelS', () => {
  test('S(0) = 0', () => {
    expect(fresnelS(0)).toBe(0);
  });

  test.each(FRESNEL_S_REF)('S(%f) matches reference', (x, expected) => {
    expect(fresnelS(x)).toBeCloseTo(expected, 12);
  });

  test.each(FRESNEL_S_REGION2)(
    'S(%f) matches reference (region 2)',
    (x, expected) => {
      expect(fresnelS(x)).toBeCloseTo(expected, 5);
    }
  );

  test('S(Infinity) = 0.5', () => {
    expect(fresnelS(Infinity)).toBe(0.5);
  });

  test('S(-Infinity) = -0.5', () => {
    expect(fresnelS(-Infinity)).toBe(-0.5);
  });

  test('S(NaN) = NaN', () => {
    expect(fresnelS(NaN)).toBeNaN();
  });

  test('odd symmetry: S(-x) = -S(x)', () => {
    for (const x of [0.3, 1, 2.5, 10, 35]) {
      expect(fresnelS(-x)).toBeCloseTo(-fresnelS(x), 14);
    }
  });

  test('large argument: S(50) ~ 0.5', () => {
    expect(fresnelS(50)).toBeCloseTo(0.5, 10);
  });
});

describe('FRESNEL - Numeric fresnelC', () => {
  test('C(0) = 0', () => {
    expect(fresnelC(0)).toBe(0);
  });

  test.each(FRESNEL_C_REF)('C(%f) matches reference', (x, expected) => {
    expect(fresnelC(x)).toBeCloseTo(expected, 11);
  });

  test.each(FRESNEL_C_REGION2)(
    'C(%f) matches reference (region 2)',
    (x, expected) => {
      expect(fresnelC(x)).toBeCloseTo(expected, 5);
    }
  );

  test('C(Infinity) = 0.5', () => {
    expect(fresnelC(Infinity)).toBe(0.5);
  });

  test('C(-Infinity) = -0.5', () => {
    expect(fresnelC(-Infinity)).toBe(-0.5);
  });

  test('C(NaN) = NaN', () => {
    expect(fresnelC(NaN)).toBeNaN();
  });

  test('odd symmetry: C(-x) = -C(x)', () => {
    for (const x of [0.3, 1, 2.5, 10, 35]) {
      expect(fresnelC(-x)).toBeCloseTo(-fresnelC(x), 14);
    }
  });

  test('large argument: C(50) ~ 0.5', () => {
    expect(fresnelC(50)).toBeCloseTo(0.5, 10);
  });
});

describe('FRESNEL - Engine evaluation', () => {
  test('FresnelS(0) = 0', () => {
    const result = ce.expr(['FresnelS', 0]).evaluate();
    expect(result.re).toBe(0);
  });

  test('FresnelC(0) = 0', () => {
    const result = ce.expr(['FresnelC', 0]).evaluate();
    expect(result.re).toBe(0);
  });

  test('FresnelS(1) matches reference', () => {
    const result = ce.expr(['FresnelS', 1]).N();
    expect(result.re).toBeCloseTo(0.438259147390355, 12);
  });

  test('FresnelC(1) matches reference', () => {
    const result = ce.expr(['FresnelC', 1]).N();
    expect(result.re).toBeCloseTo(0.779893400376823, 12);
  });
});

describe('FRESNEL - LaTeX parsing', () => {
  test('parses \\operatorname{FresnelS}(x)', () => {
    const expr = ce.parse('\\operatorname{FresnelS}(x)');
    expect(expr.operator).toBe('FresnelS');
    expect(expr.json).toEqual(['FresnelS', 'x']);
  });

  test('parses \\operatorname{FresnelC}(x)', () => {
    const expr = ce.parse('\\operatorname{FresnelC}(x)');
    expect(expr.operator).toBe('FresnelC');
    expect(expr.json).toEqual(['FresnelC', 'x']);
  });

  test('FresnelS round-trip', () => {
    const expr = ce.parse('\\operatorname{FresnelS}(x)');
    expect(expr.latex).toContain('FresnelS');
  });

  test('FresnelC round-trip', () => {
    const expr = ce.parse('\\operatorname{FresnelC}(x)');
    expect(expr.latex).toContain('FresnelC');
  });
});

describe('FRESNEL - JavaScript compilation', () => {
  test('compiles FresnelS to _SYS.fresnelS', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.fresnelS');
  });

  test('compiles FresnelC to _SYS.fresnelC', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.fresnelC');
  });

  test('compiled FresnelS(0) returns 0', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toBe(0);
  });

  test('compiled FresnelC(0) returns 0', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toBe(0);
  });

  test('compiled FresnelS(1) matches direct evaluation', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 1 })).toBeCloseTo(fresnelS(1), 14);
  });

  test('compiled FresnelC(1) matches direct evaluation', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 1 })).toBeCloseTo(fresnelC(1), 14);
  });
});

describe('FRESNEL - Interval JS compilation', () => {
  test('compiles FresnelS to _IA.fresnelS', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.fresnelS');
  });

  test('compiles FresnelC to _IA.fresnelC', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.fresnelC');
  });

  test('interval FresnelS containing 0', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const interval = result.run!({ x: { lo: -1, hi: 1 } });
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      // S(-1) < 0 and S(1) > 0, S(0) = 0
      expect(interval.value.lo).toBeLessThan(0);
      expect(interval.value.hi).toBeGreaterThan(0);
    }
  });

  test('interval FresnelC point evaluation', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const interval = result.run!({ x: { lo: 1, hi: 1 } });
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      expect(interval.value.lo).toBeCloseTo(fresnelC(1), 14);
      expect(interval.value.hi).toBeCloseTo(fresnelC(1), 14);
    }
  });
});
