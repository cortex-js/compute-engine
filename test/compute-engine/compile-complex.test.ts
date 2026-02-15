import { engine as ce } from '../utils';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE COMPLEX - isComplexValued', () => {
  it('real number literal is not complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box(3))).toBe(false);
  });

  it('complex number literal is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box(['Complex', 3, 2]))).toBe(true);
  });

  it('ImaginaryUnit is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.box('ImaginaryUnit'))).toBe(true);
  });

  it('untyped symbol is assumed real', () => {
    expect(BaseCompiler.isComplexValued(ce.box('x'))).toBe(false);
  });

  it('Add with one complex operand is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Add', ['Complex', 1, 2], 3])
      )
    ).toBe(true);
  });

  it('Add with all real operands is real', () => {
    expect(
      BaseCompiler.isComplexValued(ce.box(['Add', 1, 2, 3]))
    ).toBe(false);
  });

  it('Abs of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Abs', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Arg of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Arg', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Re of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Re', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Im of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Im', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Sin of complex is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Sin', ['Complex', 1, 2]])
      )
    ).toBe(true);
  });

  it('nested complex propagates', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.box(['Multiply', ['Add', 'ImaginaryUnit', 1], 3])
      )
    ).toBe(true);
  });
});

describe('COMPILE COMPLEX - literals', () => {
  it('should compile a complex number literal', () => {
    const expr = ce.box(['Complex', 3, 2]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 3, im: 2 })');
  });

  it('should compile a pure imaginary literal', () => {
    const expr = ce.box(['Complex', 0, 1]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });

  it('should compile ImaginaryUnit symbol', () => {
    const expr = ce.box('ImaginaryUnit');
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });
});

describe('COMPILE COMPLEX - _SYS helpers (execution)', () => {
  it('should execute csin', () => {
    // sin(i) = i * sinh(1) ≈ { re: 0, im: 1.1752... }
    const expr = ce.box(['Sin', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(1.1752011936438014, 10);
  });

  it('should execute csqrt', () => {
    // sqrt(-1) is real path: Math.sqrt(-1) = NaN
    const expr = ce.box(['Sqrt', -1]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeNaN();
  });

  it('should execute csqrt on complex input', () => {
    // sqrt(i) = (1+i)/sqrt(2)
    const expr = ce.box(['Sqrt', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(Math.SQRT1_2, 10);
    expect(val.im).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('should execute cexp', () => {
    // exp(i*pi) = -1 + 0i
    const expr = ce.box(['Exp', ['Complex', 0, Math.PI]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-1, 10);
    expect(val.im).toBeCloseTo(0, 10);
  });

  it('should execute cabs', () => {
    // |3+4i| = 5
    const expr = ce.box(['Abs', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(5, 10);
  });

  it('should execute carg', () => {
    // arg(1+i) = pi/4
    const expr = ce.box(['Arg', ['Complex', 1, 1]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(Math.PI / 4, 10);
  });

  it('should execute cln', () => {
    // ln(i) = i*pi/2
    const expr = ce.box(['Ln', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(Math.PI / 2, 10);
  });

  it('should execute conjugate', () => {
    const expr = ce.box(['Conjugate', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(3, 10);
    expect(val.im).toBeCloseTo(-4, 10);
  });
});

describe('COMPILE COMPLEX - inline arithmetic', () => {
  it('should add two complex numbers', () => {
    const expr = ce.box(['Add', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(4);
    expect(val.im).toBeCloseTo(6);
  });

  it('should multiply two complex numbers', () => {
    // (1+2i) * (3+4i) = -5+10i
    const expr = ce.box(['Multiply', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-5);
    expect(val.im).toBeCloseTo(10);
  });

  it('should negate a complex number', () => {
    const expr = ce.box(['Negate', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-3);
    expect(val.im).toBeCloseTo(-4);
  });

  it('should subtract complex numbers', () => {
    const expr = ce.box(['Subtract', ['Complex', 5, 3], ['Complex', 2, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(3);
    expect(val.im).toBeCloseTo(2);
  });

  it('should divide complex numbers', () => {
    // (1+2i) / (3+4i) = (11/25) + (2/25)i
    const expr = ce.box(['Divide', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(11 / 25);
    expect(val.im).toBeCloseTo(2 / 25);
  });
});

describe('COMPILE COMPLEX - real/complex promotion', () => {
  it('should add real + complex', () => {
    const expr = ce.box(['Add', 5, ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(8);
    expect(val.im).toBeCloseTo(4);
  });

  it('should multiply real * complex', () => {
    const expr = ce.box(['Multiply', 2, ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(6);
    expect(val.im).toBeCloseTo(8);
  });

  it('should handle Re of complex', () => {
    const expr = ce.box(['Re', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(3);
  });

  it('should handle Im of complex', () => {
    const expr = ce.box(['Im', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(4);
  });
});

describe('COMPILE COMPLEX - Power', () => {
  it('should compute complex power', () => {
    // (1+i)^2 = 2i
    const expr = ce.box(['Power', ['Complex', 1, 1], 2]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(2, 10);
  });
});

describe('COMPILE COMPLEX - operator path bypass', () => {
  it('should use complex multiply even when operator exists', () => {
    const expr = ce.box(['Multiply', 2, ['Complex', 1, 2]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(2);
    expect(val.im).toBeCloseTo(4);
  });
});

describe('COMPILE COMPLEX - Sum/Product loops', () => {
  it('should sum complex values in a loop', () => {
    // Sum(Complex(k, 1), k, 1, 3) = (1+i) + (2+i) + (3+i) = 6+3i
    const expr = ce.box(['Sum', ['Complex', 'k', 1], ['Tuple', 'k', 1, 3]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(6);
    expect(val.im).toBeCloseTo(3);
  });

  it('should multiply complex values in a loop', () => {
    // Product(Complex(1, 1), k, 1, 2) = (1+i)*(1+i) = 2i
    const expr = ce.box([
      'Product',
      ['Complex', 1, 1],
      ['Tuple', 'k', 1, 2],
    ]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0);
    expect(val.im).toBeCloseTo(2);
  });

  it('should handle real Sum unchanged', () => {
    // Sum(k, k, 1, 3) = 6
    const expr = ce.box(['Sum', 'k', ['Tuple', 'k', 1, 3]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(6);
  });
});

describe('COMPILE COMPLEX - integration', () => {
  it('should compile and run nested complex expression', () => {
    // (3+2i) * (1+i) + (0+1i) = (3*1-2*1) + (3*1+2*1)i + i = 1 + 5i + i = 1+6i
    const expr = ce.box([
      'Add',
      ['Multiply', ['Complex', 3, 2], ['Complex', 1, 1]],
      ['Complex', 0, 1],
    ]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(1);
    expect(val.im).toBeCloseTo(6);
  });

  it('Abs of complex sum', () => {
    // |3+4i| = 5
    const expr = ce.box(['Abs', ['Add', ['Complex', 3, 0], ['Complex', 0, 4]]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(5);
  });

  it('all-real expressions are unchanged', () => {
    // Verify no regressions: 2 * sin(pi/4) = sqrt(2)
    const expr = ce.parse('2\\sin(\\frac{\\pi}{4})');
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(Math.SQRT2);
  });

  it('should handle Euler formula: e^(i*pi) + 1 = 0', () => {
    const expr = ce.box([
      'Add',
      ['Exp', ['Complex', 0, Math.PI]],
      1,
    ]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(0, 10);
  });
});
