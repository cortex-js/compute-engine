import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

describe('TYPE INFERENCE THROUGH EXPRESSIONS', () => {
  it('should infer type of integer arithmetic', () => {
    expect(ce.parse('3 + 4').type.toString()).toBe('finite_integer');
  });

  it('should infer type of rational arithmetic', () => {
    expect(ce.parse('3/4').type.toString()).toBe('finite_rational');
  });

  it('should infer type of real arithmetic', () => {
    expect(ce.parse('3 + \\pi').type.toString()).toBe('finite_real');
  });

  it('should infer type of Sqrt', () => {
    // sqrt(2) should be finite_real (real input, not negative)
    expect(ce.parse('\\sqrt{2}').type.toString()).toBe('finite_real');
  });

  it('should infer type of integer product', () => {
    expect(ce.parse('3 \\times 4').type.toString()).toBe('finite_integer');
  });
});

describe('TYPE WIDENING THROUGH COMPOSITION', () => {
  it('Add(integer, integer) → finite_integer', () => {
    expect(ce.parse('3 + 4').type.toString()).toBe('finite_integer');
  });

  it('Add(integer, rational) widens', () => {
    const expr = ce.parse('3 + \\frac{1}{2}');
    expect(expr.type.matches('rational')).toBe(true);
  });

  it('Add(integer, real) widens to real', () => {
    const expr = ce.parse('3 + 3.14');
    expect(expr.type.matches('real')).toBe(true);
  });

  it('Multiply(integer, integer) → finite_integer', () => {
    expect(ce.parse('3 \\times 5').type.toString()).toBe('finite_integer');
  });

  it('Multiply(integer, real) → finite_real', () => {
    const expr = ce.parse('3 \\times 3.14');
    expect(expr.type.matches('real')).toBe(true);
  });
});

describe('TYPE INFERENCE FOR TRIG FUNCTIONS', () => {
  it('Sin of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    const expr = localCe.parse('\\sin(x)');
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Sin of number → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('z', { type: 'number' });
    const expr = localCe.parse('\\sin(z)');
    expect(expr.type.toString()).toBe('finite_number');
  });

  it('Cos of integer literal → finite_real', () => {
    expect(ce.parse('\\cos(3)').type.toString()).toBe('finite_real');
  });

  it('Arctan returns finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    expect(localCe.parse('\\arctan(x)').type.toString()).toBe('finite_real');
  });

  it('Arctan2 of real args → finite_real', () => {
    const expr = ce.expr(['Arctan2', 1, 2]);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Arctan2 of number args → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('y', { type: 'number' });
    localCe.declare('x', { type: 'number' });
    const expr = localCe.expr(['Arctan2', 'y', 'x']);
    expect(expr.type.toString()).toBe('finite_number');
  });
});

describe('TYPE INFERENCE FOR SPECIAL FUNCTIONS', () => {
  it('Gamma of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    const expr = localCe.parse('\\Gamma(x)');
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Floor returns integer', () => {
    expect(ce.parse('\\lfloor 3.5 \\rfloor').type.matches('integer')).toBe(
      true
    );
  });

  it('Fract of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    const expr = localCe.expr(['Fract', 'x']);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Fract of number → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('z', { type: 'number' });
    const expr = localCe.expr(['Fract', 'z']);
    expect(expr.type.toString()).toBe('finite_number');
  });
});

describe('TYPE INFERENCE FOR STATISTICS FUNCTIONS', () => {
  it('Mean returns finite_real', () => {
    const expr = ce.expr(['Mean', ['List', 1, 2, 3]]);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Erf returns finite_real', () => {
    const expr = ce.expr(['Erf', 1]);
    expect(expr.type.toString()).toBe('finite_real');
  });
});

describe('TYPE INFERENCE FOR LOG FUNCTIONS', () => {
  it('Ln of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    const expr = localCe.parse('\\ln(x)');
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Ln of number → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('z', { type: 'number' });
    const expr = localCe.parse('\\ln(z)');
    expect(expr.type.toString()).toBe('finite_number');
  });
});

describe('TYPE INFERENCE FOR ARITHMETIC FUNCTIONS', () => {
  it('Factorial returns finite_integer', () => {
    expect(ce.expr(['Factorial', 5]).type.toString()).toBe('finite_integer');
  });

  it('Factorial2 returns finite_integer', () => {
    expect(ce.expr(['Factorial2', 5]).type.toString()).toBe('finite_integer');
  });

  it('Sign returns finite_integer', () => {
    expect(ce.expr(['Sign', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Ceil of finite returns finite_integer', () => {
    expect(ce.expr(['Ceil', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Floor of finite returns finite_integer', () => {
    expect(ce.expr(['Floor', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Arctan of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    expect(localCe.expr(['Arctan', 'x']).type.toString()).toBe('finite_real');
  });

  // REVIEW.md B12: `!exp.isFinite` was true for a symbolic exponent (whose
  // isFinite is `undefined`), so any symbolic exponent was classified
  // `non_finite_number`. The `finite_real` branch also over-claimed for a
  // possibly-negative base with a non-integer exponent.
  it('Power with a symbolic exponent is not non_finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    // 2^x: a positive base raised to a real exponent is finite real.
    expect(localCe.expr(['Power', 2, 'x']).type.toString()).toBe('finite_real');
  });

  it('Power of integers stays finite_integer', () => {
    expect(ce.expr(['Power', 2, 3]).type.toString()).toBe('finite_integer');
  });

  it('Power of a possibly-negative base with non-integer exponent is finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('a', { type: 'real' }); // sign unknown → may be negative
    // a^0.3 may be complex, so it must not claim finite_real.
    expect(localCe.expr(['Power', 'a', 0.3]).type.toString()).toBe(
      'finite_number'
    );
  });

  it('Power with an infinite operand is non_finite_number', () => {
    expect(ce.expr(['Power', 'PositiveInfinity', 2]).type.toString()).toBe(
      'non_finite_number'
    );
  });
});

describe('TYPE INFERENCE FOR COMPLEX FUNCTIONS', () => {
  it('Real returns finite_real', () => {
    expect(ce.expr(['Real', 3]).type.toString()).toBe('finite_real');
  });

  it('Imaginary returns finite_real', () => {
    expect(ce.expr(['Imaginary', 3]).type.toString()).toBe('finite_real');
  });

  it('Argument returns finite_real', () => {
    expect(ce.expr(['Argument', 3]).type.toString()).toBe('finite_real');
  });
});

describe('TYPE INFERENCE FOR NUMBER THEORY FUNCTIONS', () => {
  it('Totient returns finite_integer', () => {
    expect(ce.expr(['Totient', 12]).type.toString()).toBe('finite_integer');
  });

  it('Sigma0 returns finite_integer', () => {
    expect(ce.expr(['Sigma0', 12]).type.toString()).toBe('finite_integer');
  });

  it('Sigma1 returns finite_integer', () => {
    expect(ce.expr(['Sigma1', 12]).type.toString()).toBe('finite_integer');
  });

  it('SigmaMinus1 returns finite_rational', () => {
    expect(ce.expr(['SigmaMinus1', 12]).type.toString()).toBe('finite_rational');
  });

  it('Eulerian returns finite_integer', () => {
    expect(ce.expr(['Eulerian', 4, 1]).type.toString()).toBe('finite_integer');
  });

  it('Stirling returns finite_integer', () => {
    expect(ce.expr(['Stirling', 4, 2]).type.toString()).toBe('finite_integer');
  });

  it('NPartition returns finite_integer', () => {
    expect(ce.expr(['NPartition', 5]).type.toString()).toBe('finite_integer');
  });
});

describe('TYPE INFERENCE FOR COMBINATORICS FUNCTIONS', () => {
  it('Choose returns finite_integer', () => {
    expect(ce.expr(['Choose', 5, 2]).type.toString()).toBe('finite_integer');
  });

  it('Fibonacci returns finite_integer', () => {
    expect(ce.expr(['Fibonacci', 10]).type.toString()).toBe('finite_integer');
  });

  it('Binomial returns finite_integer', () => {
    expect(ce.expr(['Binomial', 5, 2]).type.toString()).toBe('finite_integer');
  });

  it('Multinomial returns finite_integer', () => {
    expect(ce.expr(['Multinomial', 2, 3]).type.toString()).toBe('finite_integer');
  });

  it('Subfactorial returns finite_integer', () => {
    expect(ce.expr(['Subfactorial', 4]).type.toString()).toBe('finite_integer');
  });

  it('BellNumber returns finite_integer', () => {
    expect(ce.expr(['BellNumber', 4]).type.toString()).toBe('finite_integer');
  });
});

describe('TYPE INFERENCE FOR REAL × IMAGINARY ARITHMETIC (D10 shim retirement)', () => {
  // Multiply/Divide/Power/Ln are complex-aware for real × pure-imaginary
  // operands, so complex-valued constants infer a type ⊂ `complex` instead
  // of the complex-unaware `finite_number`. This retired the
  // `signatureHasComplexParam` skip in box.ts.
  //
  // Lattice note: `imaginary` is a *pure* imaginary number, disjoint from
  // the real chain (`imaginary ∩ real = nothing`), so 0 — which is real —
  // is NOT an `imaginary` value. `imaginary` is only claimed when the
  // result is provably non-zero.

  it('√2·i is imaginary', () => {
    const e = ce.box(['Multiply', 'ImaginaryUnit', ['Sqrt', 2]]);
    expect(e.type.toString()).toBe('imaginary');
    expect(e.type.matches('complex')).toBe(true);
  });

  it('π·i is imaginary', () => {
    expect(ce.box(['Multiply', 'Pi', 'ImaginaryUnit']).type.toString()).toBe(
      'imaginary'
    );
  });

  it('i·i is ⊂ real (even number of imaginary factors)', () => {
    const e = ce.box(['Multiply', 'ImaginaryUnit', 'ImaginaryUnit']);
    expect(e.type.toString()).toBe('finite_real');
    expect(e.type.matches('real')).toBe(true);
  });

  it('i·i·i is imaginary (odd number of imaginary factors)', () => {
    expect(
      ce
        .box(['Multiply', 'ImaginaryUnit', 'ImaginaryUnit', 'ImaginaryUnit'])
        .type.toString()
    ).toBe('imaginary');
  });

  it('x·i with a possibly-zero real x is finite_complex, not imaginary', () => {
    // x may be 0, and 0 is real, not pure imaginary.
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    expect(
      localCe.box(['Multiply', 'x', 'ImaginaryUnit']).type.toString()
    ).toBe('finite_complex');
  });

  it('3·i·x with an unconstrained x stays finite_number (no unsound narrowing)', () => {
    const localCe = new ComputeEngine();
    expect(
      localCe.box(['Multiply', 3, 'ImaginaryUnit', 'x']).type.toString()
    ).toBe('finite_number');
  });

  it('√2·(1+i) is finite_complex (product of finite complex factors)', () => {
    expect(
      ce
        .box(['Multiply', ['Complex', 1, 1], ['Sqrt', 2]])
        .type.matches('finite_complex')
    ).toBe(true);
  });

  it('i/2 and 2/i are imaginary', () => {
    expect(ce.box(['Divide', 'ImaginaryUnit', 2]).type.toString()).toBe(
      'imaginary'
    );
    expect(ce.box(['Divide', 2, 'ImaginaryUnit']).type.toString()).toBe(
      'imaginary'
    );
  });

  it('0/i is not imaginary (it is 0, which is real)', () => {
    expect(
      ce.box(['Divide', 0, 'ImaginaryUnit']).type.matches('imaginary')
    ).toBe(false);
  });

  it('i^2 is ⊂ real, i^3 is imaginary', () => {
    expect(ce.box(['Power', 'ImaginaryUnit', 2]).type.toString()).toBe(
      'finite_real'
    );
    expect(ce.box(['Power', 'ImaginaryUnit', 3]).type.toString()).toBe(
      'imaginary'
    );
  });

  it('e^i is finite_complex', () => {
    expect(ce.box(['Exp', 'ImaginaryUnit']).type.toString()).toBe(
      'finite_complex'
    );
  });

  it('ln(−1) is finite_complex; ln(0) is non_finite_number (provable −∞ pole)', () => {
    expect(ce.box(['Ln', -1]).type.toString()).toBe('finite_complex');
    // SYM P2-23 option b: `ln(0) = −∞` is *provably* ±∞, so the log type
    // handler claims `non_finite_number` (see the non-finite typing
    // convention in ARCHITECTURE.md).
    expect(ce.box(['Ln', 0]).type.toString()).toBe('non_finite_number');
  });
});

describe('SIGNATURE-BASED FALLBACK TYPE NARROWING', () => {
  it('Mod(integer, integer) narrows to integer', () => {
    const expr = ce.expr(['Mod', 7, 3]);
    expect(expr.type.matches('integer')).toBe(true);
  });

  it('Remainder(integer, integer) narrows to integer', () => {
    const expr = ce.expr(['Remainder', 7, 3]);
    expect(expr.type.matches('integer')).toBe(true);
  });
});

describe('TYPE INFERENCE FOR ROUNDING AND DIVISOR FUNCTIONS', () => {
  it('Truncate returns finite_integer for finite input', () => {
    expect(ce.expr(['Truncate', 3.7]).type.toString()).toBe('finite_integer');
  });

  it('GCD returns finite_integer', () => {
    expect(ce.expr(['GCD', 12, 8]).type.toString()).toBe('finite_integer');
  });

  it('LCM returns finite_integer', () => {
    expect(ce.expr(['LCM', 4, 6]).type.toString()).toBe('finite_integer');
  });
});
