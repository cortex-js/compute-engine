/**
 * Tests for interval arithmetic library
 */

// The collection accessors (`interval/collections.ts`). A collection is never
// this target's RESULT — these project a run-time array of intervals back down
// to the single interval the interval-js value model holds.
import { BigDecimal } from '../../src/big-decimal';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import {
  integrate as integrateEnclosure,
  integrateClosed,
} from '../../src/compute-engine/interval/integrate';
import {
  at as atCollection,
  length as lengthOfCollection,
  component as pointComponent,
} from '../../src/compute-engine/interval/collections';
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
  powRational,
  nthRoot,
  remainder,
  exp,
  ln,
  log2,
  log10,
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
  atan2,
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
  sinc,
  fresnelS,
  fresnelC,
  gamma,
  gammaln,
  binomial,
  gcd,
  lcm,
  // Comparison
  less,
  lessEqual,
  equal,
  notEqual,
  clamp,
} from '../../src/compute-engine/interval';

// Helper to check interval results
function expectInterval(result, expectedLo, expectedHi, tolerance = 1e-10) {
  expect(result.kind).toBe('interval');
  if (result.kind === 'interval') {
    expect(result.value.lo).toBeCloseTo(expectedLo, -Math.log10(tolerance));
    expect(result.value.hi).toBeCloseTo(expectedHi, -Math.log10(tolerance));
  }
}

// Tycho item 254: an operation over a `partial` operand answers `partial`
// (clip side `'both'`, the conservative marker), never a clean `interval`.
describe('partial propagation through operations', () => {
  const clipped = sqrt({ lo: -1, hi: 4 });
  test('sqrt of a straddling interval is partial', () => {
    expect(clipped.kind).toBe('partial');
  });
  test('add, sub, mul, negate over a partial operand stay partial', () => {
    for (const r of [
      add({ lo: 1, hi: 2 }, clipped),
      sub(clipped, { lo: 1, hi: 2 }),
      mul({ lo: 2, hi: 3 }, clipped),
      negate(clipped),
    ]) {
      expect(r.kind).toBe('partial');
      if (r.kind === 'partial') expect(r.domainClipped).toBe('both');
    }
  });
  test('an operation over clean operands stays a clean interval', () => {
    expect(add({ lo: 1, hi: 2 }, sqrt({ lo: 1, hi: 4 })).kind).toBe('interval');
  });
  test('an empty or entire answer is not re-tagged', () => {
    expect(div(clipped, { lo: 0, hi: 0 }).kind).not.toBe('partial');
  });
});

function expectPartial(
  result,
  expectedLo,
  expectedHi,
  expectedClip,
  tolerance = 1e-10
) {
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
    const partial = {
      kind: 'partial',
      value: { lo: 0, hi: 1 },
      domainClipped: 'lo',
    };
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
    expectInterval(
      div({ lo: -2, hi: -1 }, { lo: 3, hi: 4 }),
      -2 / 3,
      -0.25,
      1e-6
    );
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
    if (result.kind === 'singular') {
      expect(result.continuity).toBe('right');
      expect(result.at).toBe(2);
    }
  });

  test('ceil - no boundary crossing', () => {
    expectInterval(ceil({ lo: 1.2, hi: 1.8 }), 2, 2);
  });

  test('ceil - crosses integer boundary', () => {
    const result = ceil({ lo: 1.5, hi: 2.5 });
    expect(result.kind).toBe('singular');
    if (result.kind === 'singular') {
      expect(result.continuity).toBe('left');
      expect(result.at).toBe(2);
    }
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
    if (result.kind === 'singular') {
      // sign has no one-sided continuity at 0
      expect(result.continuity).toBeUndefined();
    }
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
    if (result.kind === 'singular') {
      expect(result.continuity).toBe('right');
    }
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

  // REVIEW.md E16: with a negative modulus the interval result must enclose the
  // compiled scalar `Mod` (floored, sign-of-divisor convention: `((a%b)+b)%b`),
  // which is negative for `b < 0`. The old `[0, |b|)` result did not.
  test('mod - negative modulus encloses the floored scalar (E16)', () => {
    const floored = (a: number, b: number) => ((a % b) + b) % b;
    // 5 mod -3 = -1, 7 mod -4 = -1, -1 mod -3 = -1
    expectInterval(
      mod({ lo: 5, hi: 5 }, { lo: -3, hi: -3 }),
      floored(5, -3),
      floored(5, -3)
    );
    expectInterval(
      mod({ lo: 7, hi: 7 }, { lo: -4, hi: -4 }),
      floored(7, -4),
      floored(7, -4)
    );
    expectInterval(
      mod({ lo: -1, hi: -1 }, { lo: -3, hi: -3 }),
      floored(-1, -3),
      floored(-1, -3)
    );
    // Positive modulus is unchanged (Euclidean == floored for b > 0).
    expectInterval(
      mod({ lo: 5, hi: 5 }, { lo: 3, hi: 3 }),
      floored(5, 3),
      floored(5, 3)
    );
  });

  test('round - no boundary crossing', () => {
    expectInterval(round({ lo: 1.1, hi: 1.4 }), 1, 1);
  });

  test('round - crosses half-integer boundary', () => {
    const result = round({ lo: 1.3, hi: 1.7 });
    expect(result.kind).toBe('singular');
    if (result.kind === 'singular') {
      expect(result.continuity).toBe('right');
      expect(result.at).toBe(1.5);
    }
  });

  test('fract - no boundary crossing', () => {
    expectInterval(fract({ lo: 1.2, hi: 1.8 }), 0.2, 0.8, 1e-6);
  });

  test('fract - crosses integer boundary', () => {
    const result = fract({ lo: 1.8, hi: 2.2 });
    expect(result.kind).toBe('singular');
    if (result.kind === 'singular') {
      expect(result.continuity).toBe('right');
      expect(result.at).toBe(2);
    }
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
    expectInterval(
      asin({ lo: -0.5, hi: 0.5 }),
      Math.asin(-0.5),
      Math.asin(0.5),
      1e-6
    );
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
    expectInterval(
      atan({ lo: -100, hi: 100 }),
      Math.atan(-100),
      Math.atan(100),
      1e-6
    );
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
    // Continuous (0, π) convention: acot(x) = π/2 − atan(x), decreasing.
    // acot(2) = π/2 − atan(2) ≈ 0.4636, acot(1) = π/4.
    expectInterval(
      acot({ lo: 1, hi: 2 }),
      Math.PI / 2 - Math.atan(2),
      Math.PI / 4,
      1e-6
    );
  });

  // acot uses the continuous (0, π) convention that matches the interpreter
  // (Arccot(-2) = 2.678, Arccot(0) = π/2). It is therefore continuous through 0
  // — NOT singular — so an interval straddling 0 yields a valid interval.
  test('acot - continuous through zero (0, π) convention', () => {
    // acot([-1, 1]) = [acot(1), acot(-1)] = [π/4, 3π/4], containing acot(0)=π/2.
    const result = acot({ lo: -1, hi: 1 });
    expectInterval(result, Math.PI / 4, (3 * Math.PI) / 4, 1e-6);
  });

  test('acot - negative argument uses (0, π) range', () => {
    // acot(-2) ≈ 2.678, NOT the atan(1/x) branch value −0.4636.
    expectInterval(
      acot({ lo: -2, hi: -2 }),
      2.677945044588987,
      2.677945044588987,
      1e-9
    );
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
    expectInterval(acosh({ lo: 1, hi: 3 }), Math.acosh(1), Math.acosh(3), 1e-6);
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

// REVIEW.md E8–E12: conservative-enclosure fixes for the interval library.
describe('INTERVAL ENCLOSURE REGRESSIONS (REVIEW.md E8–E12)', () => {
  // E9: 0 · ∞ must follow the interval convention 0·±∞ = 0, not propagate NaN.
  test('E9: mul with a zero endpoint and an infinite endpoint', () => {
    const r = mul({ lo: 0, hi: 1 }, { lo: 1, hi: Infinity });
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') {
      expect(r.value.lo).toBe(0); // was NaN
      expect(r.value.hi).toBe(Infinity);
    }
    // x·ln(x) shape on [0,1]: [0,1] · [-∞, 0] should stay finite-lo
    const r2 = mul({ lo: 0, hi: 1 }, { lo: -Infinity, hi: 0 });
    expect(r2.kind).toBe('interval');
    if (r2.kind === 'interval') expect(Number.isNaN(r2.value.lo)).toBe(false);
  });

  // E12: clamp is min(max(x,lo),hi), never empty for out-of-range x.
  test('E12: clamp of an out-of-range interval maps onto the bound', () => {
    expectInterval(
      clamp({ lo: 5, hi: 6 }, { lo: 0, hi: 0 }, { lo: 2, hi: 3 }),
      2,
      3
    );
    expectInterval(
      clamp({ lo: 1, hi: 4 }, { lo: 0, hi: 0 }, { lo: 2, hi: 3 }),
      1,
      3
    );
    // Entirely below the lower bound clamps up.
    expectInterval(
      clamp({ lo: -5, hi: -4 }, { lo: 0, hi: 0 }, { lo: 2, hi: 3 }),
      0,
      0
    );
  });

  // E11: binomial/gcd/lcm enumerate the integer grid (corners miss interior
  // extrema of these non-monotone functions).
  test('E11: binomial encloses the central coefficient', () => {
    // C(10, k) for k ∈ [0,10] peaks at C(10,5) = 252 (corners are both 1).
    expectInterval(binomial({ lo: 10, hi: 10 }, { lo: 0, hi: 10 }), 1, 252, 1);
  });

  test('E11: gcd encloses coprime interior points', () => {
    // gcd(6, k) for k ∈ [0,9] reaches 1 (e.g. gcd(6,5)); corners missed it.
    expectInterval(gcd({ lo: 6, hi: 6 }, { lo: 0, hi: 9 }), 1, 6, 1);
  });

  test('E11: lcm encloses interior maxima', () => {
    // lcm(2, k) for k ∈ [1,6] reaches 10 (lcm(2,5)); corners gave max 6.
    expectInterval(lcm({ lo: 2, hi: 2 }, { lo: 1, hi: 6 }), 2, 10, 1);
  });

  // E8: gamma is not monotone on a negative strip; the interior extremum must
  // be in the enclosure.
  test('E8: gamma on [-0.9,-0.1] encloses the local extremum gamma(-0.5)', () => {
    const r = gamma({ lo: -0.9, hi: -0.1 });
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') {
      // gamma(-0.5) ≈ -3.5449 must be within [lo, hi].
      expect(r.value.lo).toBeLessThanOrEqual(-3.5449);
      expect(r.value.hi).toBeGreaterThanOrEqual(-3.5449);
    }
  });

  // E10: sinc/fresnel must stay conservative past their tabulated extrema.
  test('E10: sinc on [38,40] encloses the true local maximum', () => {
    const r = sinc({ lo: 38, hi: 40 });
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') {
      // True max ≈ sin(39.27)/39.27 ≈ 0.02546.
      expect(r.value.hi).toBeGreaterThanOrEqual(0.02546);
      expect(r.value.lo).toBeLessThanOrEqual(-0.02546);
    }
  });

  test('E10: fresnelS past the table is a conservative band around 0.5', () => {
    const r = fresnelS({ lo: 6.5, hi: 7 });
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') {
      // True S on [6.5,7] stays within ~[0.49, 0.54]; the band must enclose it.
      expect(r.value.lo).toBeLessThanOrEqual(0.49);
      expect(r.value.hi).toBeGreaterThanOrEqual(0.54);
    }
  });
});

// WP-2.17: align the interval runtime with the interpreter's real conventions
// for odd roots / rational powers of negative bases and for Mod on a negative
// divisor multiple.
describe('INTERVAL RUNTIME ALIGNMENT (WP-2.17)', () => {
  // nthRoot: an ODD degree over a negative base is real (Root(-8, 3) = -2), and
  // the odd root is monotone increasing over all reals.
  test('nthRoot - odd degree, negative point', () => {
    expectInterval(nthRoot({ lo: -8, hi: -8 }, 3), -2, -2, 1e-9);
    expectInterval(nthRoot({ lo: -32, hi: -32 }, 5), -2, -2, 1e-9);
  });

  test('nthRoot - odd degree, interval straddling zero (monotone increasing)', () => {
    expectInterval(nthRoot({ lo: -8, hi: 27 }, 3), -2, 3, 1e-9);
  });

  test('nthRoot - odd degree, positive interval matches pow', () => {
    expectInterval(nthRoot({ lo: 8, hi: 27 }, 3), 2, 3, 1e-9);
  });

  // An EVEN degree over a negative base has no real value.
  test('nthRoot - even degree of negative base is empty', () => {
    expect(nthRoot({ lo: -9, hi: -4 }, 4).kind).toBe('empty');
    // Straddling zero → partial (real only on the non-negative part).
    expect(nthRoot({ lo: -4, hi: 16 }, 4).kind).toBe('partial');
  });

  // powRational: q odd ⇒ real for negative bases too.
  test('powRational - even numerator (|x|^(p/q), min 0 at origin)', () => {
    // (-8)^(2/3) = 4
    expectInterval(powRational({ lo: -8, hi: -8 }, 2, 3), 4, 4, 1e-9);
    // straddling zero: even numerator ⇒ minimum 0 at x=0, max at an endpoint
    expectInterval(powRational({ lo: -8, hi: 1 }, 2, 3), 0, 4, 1e-9);
  });

  test('powRational - odd numerator (sign-preserving, monotone increasing)', () => {
    // (-32)^(3/5) = -8
    expectInterval(powRational({ lo: -32, hi: -32 }, 3, 5), -8, -8, 1e-9);
    expectInterval(powRational({ lo: -32, hi: 32 }, 3, 5), -8, 8, 1e-9);
  });

  test('powRational - even denominator of negative base has no real value', () => {
    // e.g. x^(3/2) is complex for x < 0
    expect(powRational({ lo: -4, hi: -1 }, 3, 2).kind).toBe('empty');
  });

  // Mod: a point exactly on a period multiple of a NEGATIVE divisor is a
  // well-defined value (0, floored/sign-of-divisor), not a `singular` jump.
  test('mod - point at a multiple of a negative divisor is 0, not singular', () => {
    expectInterval(mod({ lo: 6, hi: 6 }, { lo: -3, hi: -3 }), 0, 0);
    expectInterval(mod({ lo: 0, hi: 0 }, { lo: -3, hi: -3 }), 0, 0);
    // And a point at a multiple of a positive divisor stays 0 as well.
    expectInterval(mod({ lo: 6, hi: 6 }, { lo: 3, hi: 3 }), 0, 0);
  });

  // remainder composes div/round/mul/sub; the round() fix (half-away point
  // rule) must flow through. remainder(7, 4) = 7 - 4·round(1.75) = 7 - 8 = -1.
  test('remainder - IEEE, uses half-away round', () => {
    expectInterval(remainder({ lo: 7, hi: 7 }, { lo: 4, hi: 4 }), -1, -1, 1e-9);
    expectInterval(remainder({ lo: 5, hi: 5 }, { lo: 3, hi: 3 }), -1, -1, 1e-9);
  });
});

describe('INTERVAL COLLECTIONS', () => {
  // The absence marker of the interval-js target: a whole-NaN BARE interval
  // (the target's `isAbsent` reads `.lo` directly, so it must not be wrapped
  // in an IntervalResult).
  function expectAbsent(result) {
    expect('kind' in result).toBe(false);
    expect(Number.isNaN(result.lo)).toBe(true);
    expect(Number.isNaN(result.hi)).toBe(true);
  }

  const L = [point(10), point(20), point(30)];

  describe('at', () => {
    test('point index is 1-based', () => {
      expectInterval(atCollection(L, point(1)), 10, 10);
      expectInterval(atCollection(L, point(2)), 20, 20);
      expectInterval(atCollection(L, point(3)), 30, 30);
    });

    test('negative index counts from the end', () => {
      expectInterval(atCollection(L, point(-1)), 30, 30);
      expectInterval(atCollection(L, point(-3)), 10, 10);
    });

    test('index 0 selects nothing', () => {
      expectAbsent(atCollection(L, point(0)));
    });

    test('out-of-range index selects nothing', () => {
      expectAbsent(atCollection(L, point(4)));
      expectAbsent(atCollection(L, point(-4)));
      expectAbsent(atCollection(L, point(1e9)));
    });

    test('non-integer point index selects nothing', () => {
      // The index interval [2.5, 2.5] straddles no integer.
      expectAbsent(atCollection(L, point(2.5)));
    });

    test('wide index hulls the elements it spans', () => {
      expectInterval(atCollection(L, { lo: 1, hi: 2 }), 10, 20);
      expectInterval(atCollection(L, { lo: 1, hi: 3 }), 10, 30);
      // A fractional span still selects the integers inside it.
      expectInterval(atCollection(L, { lo: 1.5, hi: 3.5 }), 20, 30);
    });

    test('wide index partly out of range is partial', () => {
      expectPartial(atCollection(L, { lo: 2, hi: 9 }), 20, 30, 'both');
      expectPartial(atCollection(L, { lo: 0, hi: 2 }), 10, 20, 'both');
    });

    test('a huge index interval stays bounded and returns the whole hull', () => {
      // The scan is clipped to [-n, n], so an unbounded index costs O(n), not
      // O(index width): this must return promptly, not hang.
      const started = Date.now();
      const result = atCollection(L, { lo: -1e15, hi: 1e15 });
      expect(Date.now() - started).toBeLessThan(1000);
      expectPartial(result, 10, 30, 'both');
      expectPartial(
        atCollection(L, { lo: -Infinity, hi: Infinity }),
        10,
        30,
        'both'
      );
    });

    test('non-array base selects nothing', () => {
      expectAbsent(atCollection(point(5), point(1)));
      expectAbsent(atCollection(undefined, point(1)));
      expectAbsent(atCollection({ x: 1 }, point(1)));
    });

    test('raw number elements read as point intervals', () => {
      expectInterval(atCollection([10, 20, 30], point(2)), 20, 20);
      expectInterval(atCollection([10, 20, 30], { lo: 1, hi: 3 }), 10, 30);
    });

    test('IntervalResult elements are used as they stand', () => {
      const coll = [ok({ lo: 0, hi: 1 }), { kind: 'empty' }, ok(point(5))];
      expectInterval(atCollection(coll, point(1)), 0, 1);
      expect(atCollection(coll, point(2)).kind).toBe('empty');
      // `empty` contributes nothing to a hull (`unionResults`).
      expectInterval(atCollection(coll, { lo: 1, hi: 2 }), 0, 1);
    });

    test('an empty/entire/singular index propagates', () => {
      expect(atCollection(L, { kind: 'empty' }).kind).toBe('empty');
      expect(atCollection(L, { kind: 'entire' }).kind).toBe('entire');
      expect(atCollection(L, { kind: 'singular' }).kind).toBe('singular');
    });

    test('a NaN index (the absence marker) selects nothing', () => {
      expectAbsent(atCollection(L, { lo: NaN, hi: NaN }));
    });

    test('a nested-array element cannot be hulled', () => {
      // A list of points: the selected element is itself a collection, which
      // has no single interval band.
      const points = [
        [point(1), point(2)],
        [point(3), point(4)],
      ];
      expect(atCollection(points, point(1)).kind).toBe('entire');
    });

    test('empty collection selects nothing', () => {
      expectAbsent(atCollection([], point(1)));
      expectAbsent(atCollection([], { lo: -5, hi: 5 }));
    });
  });

  describe('length', () => {
    test('element count as a point interval', () => {
      expectInterval(lengthOfCollection(L), 3, 3);
      expectInterval(lengthOfCollection([]), 0, 0);
    });

    test('non-array has no length', () => {
      expectAbsent(lengthOfCollection(point(5)));
      expectAbsent(lengthOfCollection('abc'));
      expectAbsent(lengthOfCollection(undefined));
    });
  });

  describe('component', () => {
    test('0-based coordinate of a point', () => {
      expectInterval(pointComponent([point(1), point(2)], 0), 1, 1);
      expectInterval(pointComponent([point(1), point(2)], 1), 2, 2);
      expectInterval(pointComponent([1, 2, 3], 2), 3, 3);
    });

    test('coordinate past the end selects nothing', () => {
      expectAbsent(pointComponent([point(1), point(2)], 2));
      expectAbsent(pointComponent([point(1), point(2)], -1));
    });

    test('non-array operand selects nothing', () => {
      expectAbsent(pointComponent(point(5), 0));
      expectAbsent(pointComponent(undefined, 0));
    });

    test('a collection coordinate cannot be bounded', () => {
      expect(pointComponent([[point(1), point(2)]], 0).kind).toBe('entire');
    });
  });
});

describe('INTERVAL INTEGRATE — closed-form guard', () => {
  // `1/t²` as an interval extension, via the library's own `div`/`square`.
  const f = (t: { lo: number; hi: number }) => div(point(1), square(t));

  test('a closed form over an interior pole is withheld: the guard answers `singular`', () => {
    // The (wrong) closed form −2 for ∫₋₁¹ dt/t² — what differencing `−1/t` at
    // the bounds gives. The scan over [−1, 1] meets the pole and hands the
    // integral to the enclosure, which reports it.
    const r = integrateClosed(() => point(-2), f, point(-1), point(1));
    expect(r).toEqual({ kind: 'singular' });
  });

  test('a clean closed form is returned as is', () => {
    // ∫₁² dt/t² = 1/2: the scan over [1, 2] is clean, so the closed value
    // passes through untouched (a zero-width point).
    const r = integrateClosed(() => point(0.5), f, point(1), point(2));
    expect(r).toEqual({ lo: 0.5, hi: 0.5 });
    const enclosure = integrateEnclosure(f, point(1), point(2));
    expect(enclosure.kind).toBe('interval');
    if (enclosure.kind === 'interval') {
      expect(enclosure.value.lo).toBeLessThanOrEqual(0.5);
      expect(enclosure.value.hi).toBeGreaterThanOrEqual(0.5);
    }
  });

  test('an infinite bound has no range to scan: the closed form stands', () => {
    const r = integrateClosed(() => point(1), f, point(1), {
      lo: Infinity,
      hi: Infinity,
    });
    expect(r).toEqual({ lo: 1, hi: 1 });
  });
});

describe('OUTWARD ROUNDING', () => {
  // The library answers an ENCLOSURE: the interval it returns contains the
  // true range of the function over its operands. A double operation rounds
  // to nearest, so an endpoint that is not the true value is moved one ulp
  // (or more) outward, while an endpoint an operation can PROVE exact stays
  // bit-identical — see `interval/rounding.ts`.

  /** The exact value of a double, as a decimal. `new BigDecimal(x)` reads the
   *  SHORTEST decimal that round-trips to `x`, which is the wrong number
   *  here; `toFixed(40)` writes the value itself. */
  const exactly = (x: number): BigDecimal => new BigDecimal(x.toFixed(40));

  test('an inexact sum encloses the real value it cannot represent', () => {
    // Neither 0.1 nor 0.2 is a double, and their sum is not the double
    // nearest 0.3 either. The enclosure has to contain the REAL 0.3, which
    // is strictly between the two doubles the endpoints hold — a comparison
    // no double arithmetic can make, so it is made in decimal.
    const r = getValue(add(point(0.1), point(0.2)))!;
    const truth = new BigDecimal('0.3');
    expect(exactly(r.lo).lt(truth)).toBe(true);
    expect(exactly(r.hi).gt(truth)).toBe(true);
  });

  test('an exact operation stays a point', () => {
    // Each of these is a real number a double holds, reached with no
    // rounding at all. Widening any of them would make a `floor` over the
    // result answer a spurious discontinuity.
    expect(getValue(add(point(1), point(2)))).toEqual({ lo: 3, hi: 3 });
    expect(getValue(sub(point(1), point(0.5)))).toEqual({ lo: 0.5, hi: 0.5 });
    expect(getValue(mul(point(2), point(0.5)))).toEqual({ lo: 1, hi: 1 });
    expect(getValue(sqrt(point(4)))).toEqual({ lo: 2, hi: 2 });
    expect(getValue(div(point(49), point(49)))).toEqual({ lo: 1, hi: 1 });
    expect(getValue(square(point(3)))).toEqual({ lo: 9, hi: 9 });
    expect(getValue(pow(point(-1), 3))).toEqual({ lo: -1, hi: -1 });
  });

  test('scaling an enclosure by a power of two adds nothing of its own', () => {
    // `π`'s enclosure is the pair of doubles either side of the real π.
    // Multiplying by 2 is exact in binary, so the answer is that pair
    // scaled — no third ulp.
    const enclosureOfPi = { lo: nextDown(Math.PI), hi: nextUp(Math.PI) };
    expect(getValue(mul(point(2), enclosureOfPi))).toEqual({
      lo: 2 * nextDown(Math.PI),
      hi: 2 * nextUp(Math.PI),
    });
    // The same multiplication over the POINT `Math.PI` is exact as well, so
    // it answers a point — the widening comes from the operand, never from
    // an operation that rounded nothing.
    expect(getValue(mul(point(2), point(Math.PI)))).toEqual({
      lo: 2 * Math.PI,
      hi: 2 * Math.PI,
    });
  });

  test('an inexact product moves one ulp outward on each side', () => {
    const r = getValue(mul(point(0.1), point(Math.PI)))!;
    const p = 0.1 * Math.PI;
    expect(r).toEqual({ lo: nextDown(p), hi: nextUp(p) });
  });

  test('an odd function through the origin keeps the exact point 0', () => {
    // The outward step of a zero endpoint is a subnormal of the opposite
    // sign, so a sign test on a cell that touches the origin would read an
    // enclosure straddling zero.
    expect(getValue(sin(point(0)))).toEqual({ lo: 0, hi: 0 });
    expect(getValue(tan(point(0)))).toEqual({ lo: 0, hi: 0 });
    expect(getValue(atan(point(0)))).toEqual({ lo: 0, hi: 0 });
    expect(getValue(sinh(point(0)))).toEqual({ lo: 0, hi: 0 });
  });

  test('a transcendental of an irrational argument is widened', () => {
    const r = getValue(exp(point(1)))!;
    expect(r.lo).toBe(nextDown(Math.E));
    expect(r.hi).toBe(nextUp(Math.E));
    // Euler's number to 40 digits: the enclosure contains it, the double
    // `Math.E` alone does not say whether it is above or below.
    const e = new BigDecimal('2.718281828459045235360287471352662497757');
    expect(exactly(r.lo).lt(e)).toBe(true);
    expect(exactly(r.hi).gt(e)).toBe(true);
  });

  test('a jump enclosure a routine writes down is stepped outward too', () => {
    // `atan2` spells its branch-cut hull from the double `Math.PI`, which is
    // BELOW the real π that `atan2(0, x)` attains for a negative `x`. The
    // enclosure has to reach past it on both sides, or a box on the cut
    // excludes the very value the function takes there.
    const j = atan2({ lo: -1, hi: 1 }, { lo: -2, hi: -1 });
    expect(j.kind).toBe('singular');
    const v = getValue(j)!;
    expect(v.hi).toBeGreaterThan(Math.PI);
    expect(v.lo).toBeLessThan(-Math.PI);
    // π to 40 digits: the enclosure contains the real π, which the double
    // `Math.PI` does not reach.
    const pi = new BigDecimal('3.141592653589793238462643383279502884197');
    expect(exactly(v.hi).gt(pi)).toBe(true);
    expect(exactly(v.lo).lt(pi.neg())).toBe(true);
  });

  test('an endpoint that OVERFLOWED steps back to a finite bound', () => {
    // `MAX_VALUE · 2` is a real number above `Number.MAX_VALUE`, and the
    // product answers `Infinity` for it. `[∞, ∞]` encloses nothing, so the
    // lower endpoint — the one facing INTO the interval — steps back to the
    // largest double.
    expect(getValue(mul(point(Number.MAX_VALUE), point(2)))).toEqual({
      lo: Number.MAX_VALUE,
      hi: Infinity,
    });
    expect(getValue(mul(point(-Number.MAX_VALUE), point(2)))).toEqual({
      lo: -Infinity,
      hi: -Number.MAX_VALUE,
    });
    // An operand that is ALREADY infinite is a genuinely unbounded range, not
    // an overflow, and is left alone.
    expect(getValue(mul(point(Infinity), point(2)))).toEqual({
      lo: Infinity,
      hi: Infinity,
    });
  });

  test('a quotient whose finite bound overflows is a partial, not a point at infinity', () => {
    // `exp(-1000)` underflows to 0 and its enclosure is `[0, 5e-324]`, so the
    // quotient's lower bound `1 / 5e-324` overflows. The divisor reaches 0,
    // so the quotient really is unbounded above — a `partial` with an
    // infinite upper bound and a finite lower one is the sound reading.
    const e = exp(point(-1000));
    expect(getValue(e)).toEqual({ lo: 0, hi: Number.MIN_VALUE });
    const q = div(point(1), e);
    expect(q.kind).toBe('partial');
    expect(getValue(q)).toEqual({ lo: Number.MAX_VALUE, hi: Infinity });
  });

  test('a root the exact product chain reproduces stays the point it is', () => {
    // Each endpoint of a root is VALIDATED against the operand: it is moved
    // outward until the enclosure of its integer power is on the right side of
    // the operand endpoint. An exact root passes that test where it stands, so
    // it stays the point it is — `Math.pow` is not even the right double for
    // some of these (`Math.pow(64, 1/3)` is 3.9999999999999996), and the
    // three-ulp band the routine used to answer was centred on that.
    expect(getValue(nthRoot({ lo: 4, hi: 4 }, 2))).toEqual({ lo: 2, hi: 2 });
    expect(getValue(nthRoot({ lo: 64, hi: 64 }, 3))).toEqual({ lo: 4, hi: 4 });
    expect(getValue(nthRoot({ lo: 1000, hi: 1000 }, 3))).toEqual({
      lo: 10,
      hi: 10,
    });
    expect(getValue(nthRoot({ lo: -32, hi: -32 }, 5))).toEqual({
      lo: -2,
      hi: -2,
    });
    // `powRational` inherits the proof through the root it is built from.
    expect(getValue(powRational({ lo: 8, hi: 8 }, 1, 3))).toEqual({
      lo: 2,
      hi: 2,
    });
    expect(getValue(powRational({ lo: 4, hi: 4 }, 1, 2))).toEqual({
      lo: 2,
      hi: 2,
    });
    // The exact lower bound 0 keeps a later `sqrt` from reporting a
    // domain-clipped `partial` over a radicand that only touches the axis.
    const r = getValue(nthRoot({ lo: 0, hi: 8 }, 3))!;
    expect(r.lo).toBe(0);
    expect(sqrt(nthRoot({ lo: 0, hi: 8 }, 3)).kind).toBe('interval');
    // An irrational root moves as far as the validation needs and no further:
    // one ulp on each side here, where the three-ulp step used to move three.
    const two = getValue(nthRoot({ lo: 2, hi: 2 }, 2))!;
    expect(two.lo).toBe(nextDown(Math.SQRT2));
    expect(two.hi).toBe(Math.SQRT2);
    expect(exactly(two.lo).lt(new BigDecimal('1.414213562373095048801688724')))
      .toBe(true);
    expect(exactly(two.hi).gt(new BigDecimal('1.414213562373095048801688724')))
      .toBe(true);
  });

  test('a root of a large operand encloses the value the rounded degree missed', () => {
    // The exponent `1/n` is a rounded double, and `x^(e+δ) = x^e·(1 + δ·ln x)`,
    // so the error of `Math.pow(x, 1/n)` grows with `|ln x|`: at 10³⁰⁰ its cube
    // root is 65 ulps below the true one, which no three-ulp band reaches. The
    // validation scales the operand by an exact power of two first, so the
    // guess it validates is within an ulp whatever the magnitude.
    //
    // Every double at this magnitude is a whole number, so the enclosure is
    // checked by cubing its endpoints in exact integer arithmetic: the cube of
    // the lower one must be at or below the operand and the cube of the upper
    // one at or above it.
    const operand = BigInt(1e300);
    const r = getValue(nthRoot(point(1e300), 3))!;
    expect(BigInt(r.lo) ** 3n <= operand).toBe(true);
    expect(BigInt(r.hi) ** 3n >= operand).toBe(true);
    expect(r.hi - r.lo).toBeLessThan(4 * (nextUp(r.hi) - r.hi));
    // The three-ulp band around `Math.pow` lies entirely below the root: even
    // its upper end cubes to less than the operand.
    let oldHi = Math.pow(1e300, 1 / 3);
    for (let i = 0; i < 3; i++) oldHi = nextUp(oldHi);
    expect(BigInt(oldHi) ** 3n < operand).toBe(true);
    // The smallest subnormal is 2⁻¹⁰⁷⁴, whose cube root is the exact 2⁻³⁵⁸.
    // `Math.pow` answers a double 62 ulps above it.
    expect(getValue(nthRoot(point(Number.MIN_VALUE), 3))).toEqual({
      lo: 2 ** -358,
      hi: 2 ** -358,
    });
    expect(Math.pow(Number.MIN_VALUE, 1 / 3)).not.toBe(2 ** -358);
  });

  test('a rational power is the root then the integer power, so an exact one is a point', () => {
    // `x^(p/q)` is built as `(x^(1/q))^p`. Computing it as
    // `Math.pow(x, p/q)` instead has to round the exponent to a double, and
    // `x^(e+δ) = x^e·(1 + δ·ln x)`, so that form is not even exact where the
    // answer is an integer: `Math.pow(27, 2/3)` is 8.999999999999998. The
    // root of an exact power is exact and the integer power of an exact root
    // is exact, so the composition answers the point.
    expect(getValue(powRational(point(8), 2, 3))).toEqual({ lo: 4, hi: 4 });
    expect(getValue(powRational(point(27), 2, 3))).toEqual({ lo: 9, hi: 9 });
    expect(getValue(powRational(point(4), 3, 2))).toEqual({ lo: 8, hi: 8 });
    // The real-root convention of an odd denominator holds for a negative
    // base: `(−8)^(2/3) = 4`.
    expect(getValue(powRational(point(-8), 2, 3))).toEqual({ lo: 4, hi: 4 });
    // A negative numerator is the reciprocal of the positive power, and the
    // division of 1 by 4 is exact.
    expect(getValue(powRational(point(8), -2, 3))).toEqual({
      lo: 0.25,
      hi: 0.25,
    });
  });

  test('a rational power with no exact value encloses what the rounded exponent missed', () => {
    // 62^(4/3) to 40 digits. `Math.pow(62, 4/3)` is more than three ulps
    // below it, so the three-ulp band this routine used to answer did not
    // contain the true value at all. The root-then-power composition widens
    // the root's enclosure by the factor the exponent 4 amplifies its error
    // by, and contains it.
    const truth = new BigDecimal('245.3892798001851396940412056992044185827');
    let oldHi = Math.pow(62, 4 / 3);
    for (let i = 0; i < 3; i++) oldHi = nextUp(oldHi);
    expect(exactly(oldHi).lt(truth)).toBe(true);
    const r = getValue(powRational(point(62), 4, 3))!;
    expect(exactly(r.lo).lt(truth)).toBe(true);
    expect(exactly(r.hi).gt(truth)).toBe(true);

    // A numerator of 1 raises the root to the power 1, which changes nothing:
    // the answer is the root's own enclosure of the cube root of 2, here to 40
    // digits. The validated root is two ulps wide, so a bound of four ulps
    // fails on any answer that goes back to a fixed step.
    const cbrt2 = new BigDecimal('1.259921049894873164767210607278228350570');
    const c = getValue(powRational(point(2), 1, 3))!;
    expect(exactly(c.lo).lt(cbrt2)).toBe(true);
    expect(exactly(c.hi).gt(cbrt2)).toBe(true);
    expect(c).toEqual(getValue(nthRoot(point(2), 3)));
    expect(c.hi - c.lo).toBeLessThan(4 * (nextUp(c.hi) - c.hi));
  });

  test('a logarithm of 1, and of an exact power of its base, is exact', () => {
    expect(getValue(ln(point(1)))).toEqual({ lo: 0, hi: 0 });
    expect(getValue(log2(point(8)))).toEqual({ lo: 3, hi: 3 });
    expect(getValue(log10(point(100)))).toEqual({ lo: 2, hi: 2 });
    // A widened `ln(1)` is `[-5e-324, 5e-324]`, whose square root is a
    // domain-clipped `partial`.
    const r = sqrt(ln(point(1)));
    expect(r.kind).toBe('interval');
    expect(getValue(r)).toEqual({ lo: 0, hi: 0 });
    // A logarithm with no closed double value is still widened.
    const l2 = getValue(ln(point(2)))!;
    expect(l2.lo).toBe(nextDown(Math.LN2));
    expect(l2.hi).toBe(nextUp(Math.LN2));
  });

  test('a modulo whose sign correction rounds encloses the value it missed', () => {
    // `-1e-20 % 1` is `-1e-20`, and `-1e-20 + 1` rounds UP to exactly 1, so
    // the plain `((a % b) + b) % b` finished with `1 % 1` and answered the
    // point 0 — a miss of a whole period that no ulp step covers.
    const r = getValue(mod(point(-1e-20), point(1)))!;
    const truth = new BigDecimal(1).sub(exactly(1e-20));
    expect(exactly(r.lo).lt(truth)).toBe(true);
    expect(exactly(r.hi).gt(truth)).toBe(true);
    // An integer modulo is still the exact integer point.
    expect(getValue(mod(point(7), point(3)))).toEqual({ lo: 1, hi: 1 });
  });

  test('a routine built from other routines takes ONE outward step', () => {
    // `sech(0)` is `1 / cosh(0)` = 1 exactly. Composing the EXPORTED `div`
    // and `cosh` stepped that answer twice before `sech`'s own export stepped
    // it a third time, and the exact 1 was lost.
    expect(getValue(sech(point(0)))).toEqual({ lo: 1, hi: 1 });
    // `acsc(2)` is `asin(1/2)` = π/6: one exact division and one arc sine, so
    // one step on each side and no more.
    const r = getValue(acsc(point(2)))!;
    expect(r.lo).toBe(nextDown(Math.asin(0.5)));
    expect(r.hi).toBe(nextUp(Math.asin(0.5)));
  });
});
