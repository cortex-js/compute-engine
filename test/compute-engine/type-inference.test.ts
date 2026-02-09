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
    const expr = ce.box(['Arctan2', 1, 2]);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Arctan2 of number args → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('y', { type: 'number' });
    localCe.declare('x', { type: 'number' });
    const expr = localCe.box(['Arctan2', 'y', 'x']);
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
    const expr = localCe.box(['Fract', 'x']);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Fract of number → finite_number', () => {
    const localCe = new ComputeEngine();
    localCe.declare('z', { type: 'number' });
    const expr = localCe.box(['Fract', 'z']);
    expect(expr.type.toString()).toBe('finite_number');
  });
});

describe('TYPE INFERENCE FOR STATISTICS FUNCTIONS', () => {
  it('Mean returns finite_real', () => {
    const expr = ce.box(['Mean', ['List', 1, 2, 3]]);
    expect(expr.type.toString()).toBe('finite_real');
  });

  it('Erf returns finite_real', () => {
    const expr = ce.box(['Erf', 1]);
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
    expect(ce.box(['Factorial', 5]).type.toString()).toBe('finite_integer');
  });

  it('Factorial2 returns finite_integer', () => {
    expect(ce.box(['Factorial2', 5]).type.toString()).toBe('finite_integer');
  });

  it('Sign returns finite_integer', () => {
    expect(ce.box(['Sign', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Ceil of finite returns finite_integer', () => {
    expect(ce.box(['Ceil', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Floor of finite returns finite_integer', () => {
    expect(ce.box(['Floor', 3.14]).type.toString()).toBe('finite_integer');
  });

  it('Arctan of real → finite_real', () => {
    const localCe = new ComputeEngine();
    localCe.declare('x', { type: 'real' });
    expect(localCe.box(['Arctan', 'x']).type.toString()).toBe('finite_real');
  });
});

describe('TYPE INFERENCE FOR COMPLEX FUNCTIONS', () => {
  it('Real returns finite_real', () => {
    expect(ce.box(['Real', 3]).type.toString()).toBe('finite_real');
  });

  it('Imaginary returns finite_real', () => {
    expect(ce.box(['Imaginary', 3]).type.toString()).toBe('finite_real');
  });

  it('Argument returns finite_real', () => {
    expect(ce.box(['Argument', 3]).type.toString()).toBe('finite_real');
  });
});

describe('TYPE INFERENCE FOR NUMBER THEORY FUNCTIONS', () => {
  it('Totient returns finite_integer', () => {
    expect(ce.box(['Totient', 12]).type.toString()).toBe('finite_integer');
  });

  it('Sigma0 returns finite_integer', () => {
    expect(ce.box(['Sigma0', 12]).type.toString()).toBe('finite_integer');
  });

  it('Sigma1 returns finite_integer', () => {
    expect(ce.box(['Sigma1', 12]).type.toString()).toBe('finite_integer');
  });

  it('SigmaMinus1 returns finite_rational', () => {
    expect(ce.box(['SigmaMinus1', 12]).type.toString()).toBe('finite_rational');
  });

  it('Eulerian returns finite_integer', () => {
    expect(ce.box(['Eulerian', 4, 1]).type.toString()).toBe('finite_integer');
  });

  it('Stirling returns finite_integer', () => {
    expect(ce.box(['Stirling', 4, 2]).type.toString()).toBe('finite_integer');
  });

  it('NPartition returns finite_integer', () => {
    expect(ce.box(['NPartition', 5]).type.toString()).toBe('finite_integer');
  });
});

describe('TYPE INFERENCE FOR COMBINATORICS FUNCTIONS', () => {
  it('Choose returns finite_integer', () => {
    expect(ce.box(['Choose', 5, 2]).type.toString()).toBe('finite_integer');
  });

  it('Fibonacci returns finite_integer', () => {
    expect(ce.box(['Fibonacci', 10]).type.toString()).toBe('finite_integer');
  });

  it('Binomial returns finite_integer', () => {
    expect(ce.box(['Binomial', 5, 2]).type.toString()).toBe('finite_integer');
  });

  it('Multinomial returns finite_integer', () => {
    expect(ce.box(['Multinomial', 2, 3]).type.toString()).toBe('finite_integer');
  });

  it('Subfactorial returns finite_integer', () => {
    expect(ce.box(['Subfactorial', 4]).type.toString()).toBe('finite_integer');
  });

  it('BellNumber returns finite_integer', () => {
    expect(ce.box(['BellNumber', 4]).type.toString()).toBe('finite_integer');
  });
});

describe('SIGNATURE-BASED FALLBACK TYPE NARROWING', () => {
  it('Mod(integer, integer) narrows to integer', () => {
    const expr = ce.box(['Mod', 7, 3]);
    expect(expr.type.matches('integer')).toBe(true);
  });

  it('Remainder(integer, integer) narrows to integer', () => {
    const expr = ce.box(['Remainder', 7, 3]);
    expect(expr.type.matches('integer')).toBe(true);
  });
});

describe('TYPE INFERENCE FOR ROUNDING AND DIVISOR FUNCTIONS', () => {
  it('Truncate returns finite_integer for finite input', () => {
    expect(ce.box(['Truncate', 3.7]).type.toString()).toBe('finite_integer');
  });

  it('GCD returns finite_integer', () => {
    expect(ce.box(['GCD', 12, 8]).type.toString()).toBe('finite_integer');
  });

  it('LCM returns finite_integer', () => {
    expect(ce.box(['LCM', 4, 6]).type.toString()).toBe('finite_integer');
  });
});
