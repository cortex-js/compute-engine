/**
 * Tests for interval arithmetic library
 */

import {
  // Utilities
  ok,
  point,
  containsExtremum,
  unionResults,
  isPoint,
  containsZero,
  getValue,
  // Arithmetic
  add,
  sub,
  mul,
  div,
  negate,
  // Elementary
  sqrt,
  square,
  pow,
  exp,
  ln,
  abs,
  floor,
  ceil,
  round,
  fract,
  min,
  max,
  mod,
  sign,
  // Trigonometric
  sin,
  cos,
  tan,
  cot,
  csc,
  sec,
  asin,
  acos,
  atan,
  acot,
  acsc,
  asec,
  sinh,
  cosh,
  tanh,
  coth,
  csch,
  sech,
  asinh,
  acosh,
  atanh,
  acoth,
  acsch,
  asech,
  // Comparison
  less,
  lessEqual,
  equal,
  notEqual,
} from '../../src/compute-engine/interval';

// Helper to check interval results
function expectInterval(result, expectedLo, expectedHi, tolerance = 1e-10) {
  expect(result.kind).toBe('interval');
  if (result.kind === 'interval') {
    expect(result.value.lo).toBeCloseTo(expectedLo, -Math.log10(tolerance));
    expect(result.value.hi).toBeCloseTo(expectedHi, -Math.log10(tolerance));
  }
}

function expectPartial(result, expectedLo, expectedHi, expectedClip, tolerance = 1e-10) {
  expect(result.kind).toBe('partial');
  if (result.kind === 'partial') {
    if (isFinite(expectedLo)) {
      expect(result.value.lo).toBeCloseTo(expectedLo, -Math.log10(tolerance));
    } else {
      expect(result.value.lo).toBe(expectedLo);
    }
    if (isFinite(expectedHi)) {
      expect(result.value.hi).toBeCloseTo(expectedHi, -Math.log10(tolerance));
    } else {
      expect(result.value.hi).toBe(expectedHi);
    }
    expect(result.domainClipped).toBe(expectedClip);
  }
}

describe('INTERVAL UTILITIES', () => {
  test('point creates point interval', () => {
    const p = point(5);
    expect(p.lo).toBe(5);
    expect(p.hi).toBe(5);
  });

  test('ok wraps interval in result', () => {
    const result = ok({ lo: 1, hi: 2 });
    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      expect(result.value.lo).toBe(1);
      expect(result.value.hi).toBe(2);
    }
  });

  test('isPoint detects point intervals', () => {
    expect(isPoint({ lo: 5, hi: 5 })).toBe(true);
    expect(isPoint({ lo: 5, hi: 6 })).toBe(false);
  });

  test('containsZero', () => {
    expect(containsZero({ lo: -1, hi: 1 })).toBe(true);
    expect(containsZero({ lo: 0, hi: 1 })).toBe(true);
    expect(containsZero({ lo: -1, hi: 0 })).toBe(true);
    expect(containsZero({ lo: 1, hi: 2 })).toBe(false);
    expect(containsZero({ lo: -2, hi: -1 })).toBe(false);
  });

  test('containsExtremum', () => {
    // sin has max at PI/2
    expect(containsExtremum({ lo: 1, hi: 2 }, Math.PI / 2, 2 * Math.PI)).toBe(
      true
    );
    expect(containsExtremum({ lo: 0, hi: 1 }, Math.PI / 2, 2 * Math.PI)).toBe(
      false
    );
    // Periodic: should find 5PI/2 in [7, 8]
    expect(containsExtremum({ lo: 7, hi: 8 }, Math.PI / 2, 2 * Math.PI)).toBe(
      true
    );
  });

  test('getValue extracts interval value', () => {
    const interval = { kind: 'interval', value: { lo: 1, hi: 2 } };
    const partial = { kind: 'partial', value: { lo: 0, hi: 1 }, domainClipped: 'lo' };
    const empty = { kind: 'empty' };

    expect(getValue(interval)).toEqual({ lo: 1, hi: 2 });
    expect(getValue(partial)).toEqual({ lo: 0, hi: 1 });
    expect(getValue(empty)).toBeUndefined();
  });
});

describe('INTERVAL ARITHMETIC OPERATIONS', () => {
  test('addition', () => {
    expectInterval(add({ lo: 1, hi: 2 }, { lo: 3, hi: 4 }), 4, 6);
    expectInterval(add({ lo: -1, hi: 1 }, { lo: -1, hi: 1 }), -2, 2);
  });

  test('subtraction', () => {
    expectInterval(sub({ lo: 1, hi: 2 }, { lo: 3, hi: 4 }), -3, -1);
    expectInterval(sub({ lo: 3, hi: 4 }, { lo: 1, hi: 2 }), 1, 3);
  });

  test('negation', () => {
    expectInterval(negate({ lo: 1, hi: 2 }), -2, -1);
    expectInterval(negate({ lo: -2, hi: 3 }), -3, 2);
  });

  test('multiplication', () => {
    expectInterval(mul({ lo: 1, hi: 2 }, { lo: 3, hi: 4 }), 3, 8);
    expectInterval(mul({ lo: -1, hi: 2 }, { lo: 3, hi: 4 }), -4, 8);
    expectInterval(mul({ lo: -2, hi: -1 }, { lo: 3, hi: 4 }), -8, -3);
    expectInterval(mul({ lo: -1, hi: 1 }, { lo: -1, hi: 1 }), -1, 1);
  });

  test('division - safe', () => {
    expectInterval(div({ lo: 1, hi: 2 }, { lo: 3, hi: 4 }), 0.25, 2 / 3, 1e-6);
    expectInterval(div({ lo: -2, hi: -1 }, { lo: 3, hi: 4 }), -2 / 3, -0.25, 1e-6);
  });

  test('division - singular (contains zero)', () => {
    const result = div({ lo: 1, hi: 2 }, { lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('division - by zero interval', () => {
    const result = div({ lo: 1, hi: 2 }, { lo: 0, hi: 0 });
    expect(result.kind).toBe('empty');
  });

  test('division - touches zero at lower bound', () => {
    const result = div({ lo: 1, hi: 2 }, { lo: 0, hi: 1 });
    expect(result.kind).toBe('partial');
    if (result.kind === 'partial') {
      expect(result.value.lo).toBe(1);
      expect(result.value.hi).toBe(Infinity);
      expect(result.domainClipped).toBe('hi');
    }
  });
});

describe('INTERVAL ELEMENTARY FUNCTIONS', () => {
  test('sqrt - positive interval', () => {
    expectInterval(sqrt({ lo: 4, hi: 9 }), 2, 3);
  });

  test('sqrt - includes zero', () => {
    const result = sqrt({ lo: -1, hi: 4 });
    expectPartial(result, 0, 2, 'lo');
  });

  test('sqrt - entirely negative', () => {
    const result = sqrt({ lo: -4, hi: -1 });
    expect(result.kind).toBe('empty');
  });

  test('square - positive', () => {
    expectInterval(square({ lo: 2, hi: 3 }), 4, 9);
  });

  test('square - negative', () => {
    expectInterval(square({ lo: -3, hi: -2 }), 4, 9);
  });

  test('square - contains zero', () => {
    expectInterval(square({ lo: -2, hi: 3 }), 0, 9);
  });

  test('exp', () => {
    expectInterval(exp({ lo: 0, hi: 1 }), 1, Math.E, 1e-6);
  });

  test('ln - positive', () => {
    expectInterval(ln({ lo: 1, hi: Math.E }), 0, 1, 1e-6);
  });

  test('ln - includes zero', () => {
    const result = ln({ lo: -1, hi: Math.E });
    expectPartial(result, -Infinity, 1, 'lo', 1e-6);
  });

  test('ln - entirely negative', () => {
    const result = ln({ lo: -2, hi: -1 });
    expect(result.kind).toBe('empty');
  });

  test('abs - positive', () => {
    expectInterval(abs({ lo: 2, hi: 3 }), 2, 3);
  });

  test('abs - negative', () => {
    expectInterval(abs({ lo: -3, hi: -2 }), 2, 3);
  });

  test('abs - contains zero', () => {
    expectInterval(abs({ lo: -2, hi: 3 }), 0, 3);
  });

  test('floor - no boundary crossing', () => {
    expectInterval(floor({ lo: 1.2, hi: 1.8 }), 1, 1);
  });

  test('floor - crosses integer boundary', () => {
    const result = floor({ lo: 1.5, hi: 2.5 });
    expect(result.kind).toBe('singular');
  });

  test('ceil - no boundary crossing', () => {
    expectInterval(ceil({ lo: 1.2, hi: 1.8 }), 2, 2);
  });

  test('ceil - crosses integer boundary', () => {
    const result = ceil({ lo: 1.5, hi: 2.5 });
    expect(result.kind).toBe('singular');
  });

  test('min', () => {
    expectInterval(min({ lo: 1, hi: 3 }, { lo: 2, hi: 4 }), 1, 3);
  });

  test('max', () => {
    expectInterval(max({ lo: 1, hi: 3 }, { lo: 2, hi: 4 }), 2, 4);
  });

  test('sign - positive', () => {
    expectInterval(sign({ lo: 1, hi: 2 }), 1, 1);
  });

  test('sign - negative', () => {
    expectInterval(sign({ lo: -2, hi: -1 }), -1, -1);
  });

  test('sign - contains zero', () => {
    const result = sign({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('pow - positive integer', () => {
    expectInterval(pow({ lo: 2, hi: 3 }, 2), 4, 9);
  });

  test('pow - negative integer with no zero', () => {
    expectInterval(pow({ lo: 2, hi: 4 }, -1), 0.25, 0.5);
  });

  test('pow - negative integer with zero', () => {
    const result = pow({ lo: -1, hi: 1 }, -2);
    expect(result.kind).toBe('singular');
  });

  test('mod - singular (divisor contains zero)', () => {
    const result = mod({ lo: 5, hi: 7 }, { lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('mod - wide interval crosses period', () => {
    const result = mod({ lo: 0, hi: 10 }, { lo: 3, hi: 3 });
    expect(result.kind).toBe('singular');
  });

  test('mod - narrow interval no crossing', () => {
    expectInterval(mod({ lo: 1, hi: 2 }, { lo: 3, hi: 3 }), 1, 2);
  });

  test('mod - negative dividend, positive modulus, no crossing', () => {
    // -5 mod 3 = 1, -4 mod 3 = 2 (Euclidean convention)
    expectInterval(mod({ lo: -5, hi: -4 }, { lo: 3, hi: 3 }), 1, 2);
  });

  test('mod - negative dividend, crosses period boundary', () => {
    // -4 mod 3 = 2, -2 mod 3 = 1 — crosses boundary at -3
    const result = mod({ lo: -4, hi: -2 }, { lo: 3, hi: 3 });
    expect(result.kind).toBe('singular');
  });

  test('round - no boundary crossing', () => {
    expectInterval(round({ lo: 1.1, hi: 1.4 }), 1, 1);
  });

  test('round - crosses half-integer boundary', () => {
    const result = round({ lo: 1.3, hi: 1.7 });
    expect(result.kind).toBe('singular');
  });

  test('fract - no boundary crossing', () => {
    expectInterval(fract({ lo: 1.2, hi: 1.8 }), 0.2, 0.8, 1e-6);
  });

  test('fract - crosses integer boundary', () => {
    const result = fract({ lo: 1.8, hi: 2.2 });
    expect(result.kind).toBe('singular');
  });

  test('fract - negative, no crossing', () => {
    // fract(-1.7) = -1.7 - floor(-1.7) = -1.7 - (-2) = 0.3
    // fract(-1.3) = -1.3 - floor(-1.3) = -1.3 - (-2) = 0.7
    expectInterval(fract({ lo: -1.7, hi: -1.3 }), 0.3, 0.7, 1e-6);
  });
});

describe('INTERVAL TRIGONOMETRIC FUNCTIONS', () => {
  test('sin - small interval', () => {
    const result = sin({ lo: 0, hi: 0.1 });
    expectInterval(result, 0, Math.sin(0.1), 1e-6);
  });

  test('sin - wide interval includes max', () => {
    const result = sin({ lo: 0, hi: Math.PI });
    expectInterval(result, 0, 1, 1e-6);
  });

  test('sin - full period', () => {
    const result = sin({ lo: 0, hi: 2 * Math.PI + 0.1 });
    expectInterval(result, -1, 1);
  });

  test('cos - small interval', () => {
    const result = cos({ lo: 0, hi: 0.1 });
    expectInterval(result, Math.cos(0.1), 1, 1e-6);
  });

  test('cos - includes minimum', () => {
    const result = cos({ lo: Math.PI - 0.1, hi: Math.PI + 0.1 });
    expectInterval(result, -1, Math.cos(Math.PI - 0.1), 1e-6);
  });

  test('tan - safe interval', () => {
    const result = tan({ lo: -0.5, hi: 0.5 });
    expectInterval(result, Math.tan(-0.5), Math.tan(0.5), 1e-6);
  });

  test('tan - contains singularity', () => {
    const result = tan({ lo: 1.5, hi: 1.6 }); // Contains PI/2 ~ 1.571
    expect(result.kind).toBe('singular');
  });

  test('asin - within domain', () => {
    expectInterval(asin({ lo: -0.5, hi: 0.5 }), Math.asin(-0.5), Math.asin(0.5), 1e-6);
  });

  test('asin - exceeds domain', () => {
    const result = asin({ lo: 0.5, hi: 1.5 });
    expect(result.kind).toBe('partial');
    if (result.kind === 'partial') {
      expect(result.domainClipped).toBe('hi');
    }
  });

  test('acos - within domain', () => {
    // acos is decreasing, so bounds are swapped
    expectInterval(acos({ lo: 0, hi: 1 }), 0, Math.PI / 2, 1e-6);
  });

  test('atan - unbounded input', () => {
    expectInterval(atan({ lo: -100, hi: 100 }), Math.atan(-100), Math.atan(100), 1e-6);
  });

  test('sinh', () => {
    expectInterval(sinh({ lo: -1, hi: 1 }), Math.sinh(-1), Math.sinh(1), 1e-6);
  });

  test('cosh - positive', () => {
    expectInterval(cosh({ lo: 1, hi: 2 }), Math.cosh(1), Math.cosh(2), 1e-6);
  });

  test('cosh - contains zero', () => {
    // cosh has minimum at 0
    expectInterval(cosh({ lo: -1, hi: 1 }), 1, Math.cosh(1), 1e-6);
  });

  test('tanh', () => {
    expectInterval(tanh({ lo: -1, hi: 1 }), Math.tanh(-1), Math.tanh(1), 1e-6);
  });

  // Reciprocal trigonometric functions
  test('cot - safe interval', () => {
    // cot(x) = cos(x)/sin(x), safe away from n*pi
    const result = cot({ lo: 0.5, hi: 1.0 });
    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      const cotLo = Math.min(1 / Math.tan(0.5), 1 / Math.tan(1.0));
      const cotHi = Math.max(1 / Math.tan(0.5), 1 / Math.tan(1.0));
      expect(result.value.lo).toBeCloseTo(cotLo, 5);
      expect(result.value.hi).toBeCloseTo(cotHi, 5);
    }
  });

  test('cot - contains singularity at pi', () => {
    const result = cot({ lo: 3.0, hi: 3.3 }); // Contains pi ~ 3.14159
    expect(result.kind).toBe('singular');
  });

  test('csc - safe interval', () => {
    const result = csc({ lo: 0.5, hi: 1.0 });
    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      const cscLo = Math.min(1 / Math.sin(0.5), 1 / Math.sin(1.0));
      const cscHi = Math.max(1 / Math.sin(0.5), 1 / Math.sin(1.0));
      expect(result.value.lo).toBeCloseTo(cscLo, 5);
      expect(result.value.hi).toBeCloseTo(cscHi, 5);
    }
  });

  test('csc - contains singularity at pi', () => {
    const result = csc({ lo: 3.0, hi: 3.3 }); // Contains pi
    expect(result.kind).toBe('singular');
  });

  test('sec - safe interval', () => {
    const result = sec({ lo: 0.1, hi: 0.5 });
    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      const secLo = Math.min(1 / Math.cos(0.1), 1 / Math.cos(0.5));
      const secHi = Math.max(1 / Math.cos(0.1), 1 / Math.cos(0.5));
      expect(result.value.lo).toBeCloseTo(secLo, 5);
      expect(result.value.hi).toBeCloseTo(secHi, 5);
    }
  });

  test('sec - contains singularity at pi/2', () => {
    const result = sec({ lo: 1.5, hi: 1.7 }); // Contains pi/2 ~ 1.5708
    expect(result.kind).toBe('singular');
  });

  // Inverse reciprocal trigonometric functions
  test('acot - safe interval (positive)', () => {
    const result = acot({ lo: 1, hi: 2 });
    expect(result.kind).toBe('interval');
  });

  test('acot - singular at zero', () => {
    const result = acot({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('acsc - safe interval', () => {
    const result = acsc({ lo: 1, hi: 2 });
    expect(result.kind).not.toBe('empty');
  });

  test('acsc - singular at zero', () => {
    const result = acsc({ lo: -0.5, hi: 0.5 });
    expect(result.kind).toBe('singular');
  });

  test('asec - safe interval', () => {
    const result = asec({ lo: 1, hi: 2 });
    expect(result.kind).not.toBe('empty');
  });

  test('asec - singular at zero', () => {
    const result = asec({ lo: -0.5, hi: 0.5 });
    expect(result.kind).toBe('singular');
  });

  // Reciprocal hyperbolic functions
  test('coth - safe positive interval', () => {
    const result = coth({ lo: 1, hi: 2 });
    expect(result.kind).toBe('interval');
  });

  test('coth - singular at zero', () => {
    const result = coth({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('csch - safe positive interval', () => {
    const result = csch({ lo: 1, hi: 2 });
    expect(result.kind).toBe('interval');
  });

  test('csch - singular at zero', () => {
    const result = csch({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('sech - always valid (cosh >= 1)', () => {
    const result = sech({ lo: -1, hi: 1 });
    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      // sech is bounded (0, 1], max at x=0
      expect(result.value.hi).toBeCloseTo(1, 5);
    }
  });

  // Inverse hyperbolic functions
  test('asinh - monotonically increasing', () => {
    expectInterval(
      asinh({ lo: -1, hi: 1 }),
      Math.asinh(-1),
      Math.asinh(1),
      1e-6
    );
  });

  test('acosh - within domain', () => {
    expectInterval(
      acosh({ lo: 1, hi: 3 }),
      Math.acosh(1),
      Math.acosh(3),
      1e-6
    );
  });

  test('acosh - partially outside domain', () => {
    const result = acosh({ lo: 0, hi: 3 });
    expect(result.kind).toBe('partial');
  });

  test('atanh - within domain', () => {
    expectInterval(
      atanh({ lo: -0.5, hi: 0.5 }),
      Math.atanh(-0.5),
      Math.atanh(0.5),
      1e-6
    );
  });

  test('atanh - outside domain', () => {
    const result = atanh({ lo: 2, hi: 3 });
    expect(result.kind).toBe('empty');
  });

  // Inverse reciprocal hyperbolic functions
  test('acoth - safe interval (|x| > 1)', () => {
    const result = acoth({ lo: 2, hi: 3 });
    expect(result.kind).not.toBe('empty');
    expect(result.kind).not.toBe('singular');
  });

  test('acoth - singular at zero', () => {
    const result = acoth({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('acsch - safe interval', () => {
    const result = acsch({ lo: 1, hi: 2 });
    expect(result.kind).toBe('interval');
  });

  test('acsch - singular at zero', () => {
    const result = acsch({ lo: -1, hi: 1 });
    expect(result.kind).toBe('singular');
  });

  test('asech - safe interval (0 < x <= 1)', () => {
    const result = asech({ lo: 0.5, hi: 1 });
    expect(result.kind).not.toBe('empty');
  });

  test('asech - singular at zero', () => {
    const result = asech({ lo: -0.5, hi: 0.5 });
    expect(result.kind).toBe('singular');
  });
});

describe('INTERVAL COMPARISONS', () => {
  test('less - definitely true', () => {
    expect(less({ lo: 1, hi: 2 }, { lo: 3, hi: 4 })).toBe('true');
  });

  test('less - definitely false', () => {
    expect(less({ lo: 3, hi: 4 }, { lo: 1, hi: 2 })).toBe('false');
  });

  test('less - maybe (overlapping)', () => {
    expect(less({ lo: 1, hi: 3 }, { lo: 2, hi: 4 })).toBe('maybe');
  });

  test('lessEqual', () => {
    expect(lessEqual({ lo: 1, hi: 2 }, { lo: 2, hi: 3 })).toBe('true');
    expect(lessEqual({ lo: 3, hi: 4 }, { lo: 1, hi: 2 })).toBe('false');
    expect(lessEqual({ lo: 1, hi: 3 }, { lo: 2, hi: 4 })).toBe('maybe');
  });

  test('equal - point intervals', () => {
    expect(equal({ lo: 2, hi: 2 }, { lo: 2, hi: 2 })).toBe('true');
    expect(equal({ lo: 2, hi: 2 }, { lo: 3, hi: 3 })).toBe('false');
  });

  test('equal - non-overlapping', () => {
    expect(equal({ lo: 1, hi: 2 }, { lo: 3, hi: 4 })).toBe('false');
  });

  test('equal - overlapping', () => {
    expect(equal({ lo: 1, hi: 3 }, { lo: 2, hi: 4 })).toBe('maybe');
  });

  test('notEqual', () => {
    expect(notEqual({ lo: 1, hi: 2 }, { lo: 3, hi: 4 })).toBe('true');
    expect(notEqual({ lo: 2, hi: 2 }, { lo: 2, hi: 2 })).toBe('false');
  });
});

describe('INTERVAL RESULT UNION', () => {
  test('union with empty', () => {
    const a = { kind: 'interval', value: { lo: 1, hi: 2 } };
    const b = { kind: 'empty' };

    expect(unionResults(a, b)).toEqual(a);
    expect(unionResults(b, a)).toEqual(a);
  });

  test('union two intervals', () => {
    const a = { kind: 'interval', value: { lo: 1, hi: 2 } };
    const b = { kind: 'interval', value: { lo: 3, hi: 4 } };
    const result = unionResults(a, b);

    expect(result.kind).toBe('interval');
    if (result.kind === 'interval') {
      expect(result.value.lo).toBe(1);
      expect(result.value.hi).toBe(4);
    }
  });

  test('union with singular', () => {
    const a = { kind: 'interval', value: { lo: 1, hi: 2 } };
    const b = { kind: 'singular' };

    expect(unionResults(a, b).kind).toBe('singular');
  });

  test('union with entire', () => {
    const a = { kind: 'interval', value: { lo: 1, hi: 2 } };
    const b = { kind: 'entire' };

    expect(unionResults(a, b).kind).toBe('entire');
  });
});

describe('INTERVAL SINGULARITY DETECTION', () => {
  test('sin(x)/x at zero', () => {
    // Division by interval containing zero should be singular
    const sinResult = sin({ lo: -0.1, hi: 0.1 });
    const xInterval = { lo: -0.1, hi: 0.1 };

    const sinValue = getValue(sinResult);
    if (sinValue) {
      const result = div(sinValue, xInterval);
      expect(result.kind).toBe('singular');
    }
  });

  test('1/x at zero', () => {
    const result = div({ lo: 1, hi: 1 }, { lo: -0.1, hi: 0.1 });
    expect(result.kind).toBe('singular');
  });

  test('tan near PI/2', () => {
    const result = tan({ lo: 1.5, hi: 1.65 }); // Contains PI/2
    expect(result.kind).toBe('singular');
  });

  test('sqrt of negative', () => {
    const result = sqrt({ lo: -2, hi: -1 });
    expect(result.kind).toBe('empty');
  });

  test('ln at zero boundary', () => {
    const result = ln({ lo: 0, hi: 1 });
    expect(result.kind).toBe('partial');
    if (result.kind === 'partial') {
      expect(result.value.lo).toBe(-Infinity);
      expect(result.domainClipped).toBe('lo');
    }
  });
});
