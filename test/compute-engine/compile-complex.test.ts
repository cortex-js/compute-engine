import { engine as ce } from '../utils';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('COMPILE COMPLEX - isComplexValued', () => {
  it('real number literal is not complex', () => {
    expect(BaseCompiler.isComplexValued(ce.expr(3))).toBe(false);
  });

  it('complex number literal is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.expr(['Complex', 3, 2]))).toBe(true);
  });

  it('ImaginaryUnit is complex', () => {
    expect(BaseCompiler.isComplexValued(ce.expr('ImaginaryUnit'))).toBe(true);
  });

  it('untyped symbol is assumed real', () => {
    expect(BaseCompiler.isComplexValued(ce.expr('x'))).toBe(false);
  });

  it('Add with one complex operand is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Add', ['Complex', 1, 2], 3])
      )
    ).toBe(true);
  });

  it('Add with all real operands is real', () => {
    expect(
      BaseCompiler.isComplexValued(ce.expr(['Add', 1, 2, 3]))
    ).toBe(false);
  });

  it('Abs of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Abs', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Arg of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Arg', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Re of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Re', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Im of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Im', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Sin of complex is complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Sin', ['Complex', 1, 2]])
      )
    ).toBe(true);
  });

  it('nested complex propagates', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Multiply', ['Add', 'ImaginaryUnit', 1], 3])
      )
    ).toBe(true);
  });
});

describe('COMPILE COMPLEX - literals', () => {
  it('should compile a complex number literal', () => {
    const expr = ce.expr(['Complex', 3, 2]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 3, im: 2 })');
  });

  it('should compile a pure imaginary literal', () => {
    const expr = ce.expr(['Complex', 0, 1]);
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });

  it('should compile ImaginaryUnit symbol', () => {
    const expr = ce.expr('ImaginaryUnit');
    const result = compile(expr, { fallback: false });
    expect(result.code).toBe('({ re: 0, im: 1 })');
  });
});

describe('COMPILE COMPLEX - _SYS helpers (execution)', () => {
  it('should execute csin', () => {
    // sin(i) = i * sinh(1) ≈ { re: 0, im: 1.1752... }
    const expr = ce.expr(['Sin', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(1.1752011936438014, 10);
  });

  it('should execute csqrt', () => {
    // sqrt(-1) is real path: Math.sqrt(-1) = NaN
    const expr = ce.expr(['Sqrt', -1]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeNaN();
  });

  it('should execute csqrt on complex input', () => {
    // sqrt(i) = (1+i)/sqrt(2)
    const expr = ce.expr(['Sqrt', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(Math.SQRT1_2, 10);
    expect(val.im).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it('should execute cexp', () => {
    // exp(i*pi) = -1 + 0i
    const expr = ce.expr(['Exp', ['Complex', 0, Math.PI]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-1, 10);
    expect(val.im).toBeCloseTo(0, 10);
  });

  it('should execute cabs', () => {
    // |3+4i| = 5
    const expr = ce.expr(['Abs', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(5, 10);
  });

  it('should execute carg', () => {
    // arg(1+i) = pi/4
    const expr = ce.expr(['Arg', ['Complex', 1, 1]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(Math.PI / 4, 10);
  });

  it('should execute cln', () => {
    // ln(i) = i*pi/2
    const expr = ce.expr(['Ln', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(Math.PI / 2, 10);
  });

  it('should execute conjugate', () => {
    const expr = ce.expr(['Conjugate', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(3, 10);
    expect(val.im).toBeCloseTo(-4, 10);
  });
});

describe('COMPILE COMPLEX - inline arithmetic', () => {
  it('should add two complex numbers', () => {
    const expr = ce.expr(['Add', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(4);
    expect(val.im).toBeCloseTo(6);
  });

  it('should multiply two complex numbers', () => {
    // (1+2i) * (3+4i) = -5+10i
    const expr = ce.expr(['Multiply', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-5);
    expect(val.im).toBeCloseTo(10);
  });

  it('should multiply 3 complex numbers in single IIFE', () => {
    // (1+i) * (2+i) * (1-i) = (1+i)(2+i) = (2-1)+(1+2)i = 1+3i
    // then (1+3i)(1-i) = (1+3)+(3-1)i = 4+2i
    const expr = ce.expr([
      'Multiply',
      ['Complex', 1, 1],
      ['Complex', 2, 1],
      ['Complex', 1, -1],
    ]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(4);
    expect(val.im).toBeCloseTo(2);
  });

  it('should generate flat code for 3-operand multiply', () => {
    const expr = ce.expr([
      'Multiply',
      ['Complex', 1, 1],
      ['Complex', 2, 1],
      ['Complex', 1, -1],
    ]);
    const result = compile(expr, { fallback: false });
    // Should be a single IIFE, not nested
    const iifes = result.code.match(/\(\(\) =>/g);
    expect(iifes?.length).toBe(1);
  });

  it('should negate a complex number', () => {
    const expr = ce.expr(['Negate', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(-3);
    expect(val.im).toBeCloseTo(-4);
  });

  it('should subtract complex numbers', () => {
    const expr = ce.expr(['Subtract', ['Complex', 5, 3], ['Complex', 2, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(3);
    expect(val.im).toBeCloseTo(2);
  });

  it('should divide complex numbers', () => {
    // (1+2i) / (3+4i) = (11/25) + (2/25)i
    const expr = ce.expr(['Divide', ['Complex', 1, 2], ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(11 / 25);
    expect(val.im).toBeCloseTo(2 / 25);
  });
});

describe('COMPILE COMPLEX - real/complex promotion', () => {
  it('should add real + complex', () => {
    const expr = ce.expr(['Add', 5, ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(8);
    expect(val.im).toBeCloseTo(4);
  });

  it('should multiply real * complex', () => {
    const expr = ce.expr(['Multiply', 2, ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(6);
    expect(val.im).toBeCloseTo(8);
  });

  it('should handle Re of complex', () => {
    const expr = ce.expr(['Re', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(3);
  });

  it('should handle Im of complex', () => {
    const expr = ce.expr(['Im', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(4);
  });
});

describe('COMPILE COMPLEX - Power', () => {
  it('should compute complex power', () => {
    // (1+i)^2 = 2i
    const expr = ce.expr(['Power', ['Complex', 1, 1], 2]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 10);
    expect(val.im).toBeCloseTo(2, 10);
  });
});

describe('COMPILE COMPLEX - operator path bypass', () => {
  it('should use complex multiply even when operator exists', () => {
    const expr = ce.expr(['Multiply', 2, ['Complex', 1, 2]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(2);
    expect(val.im).toBeCloseTo(4);
  });
});

describe('COMPILE COMPLEX - Sum/Product loops', () => {
  it('should sum complex values in a loop', () => {
    // Sum(Complex(k, 1), k, 1, 3) = (1+i) + (2+i) + (3+i) = 6+3i
    const expr = ce.expr(['Sum', ['Complex', 'k', 1], ['Tuple', 'k', 1, 3]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(6);
    expect(val.im).toBeCloseTo(3);
  });

  it('should multiply complex values in a loop', () => {
    // Product(Complex(1, 1), k, 1, 2) = (1+i)*(1+i) = 2i
    const expr = ce.expr([
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
    const expr = ce.expr(['Sum', 'k', ['Tuple', 'k', 1, 3]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(6);
  });
});

describe('COMPILE COMPLEX - reciprocal trig functions', () => {
  it('should compute complex cot', () => {
    // cot(i) = -i * coth(1)
    const expr = ce.expr(['Cot', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 5);
    expect(val.im).toBeCloseTo(-1 / Math.tanh(1), 5);
  });

  it('should compute complex sec', () => {
    const expr = ce.expr(['Sec', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    // sec(i) = 1/cos(i) = 1/cosh(1)
    expect(val.re).toBeCloseTo(1 / Math.cosh(1), 5);
    expect(val.im).toBeCloseTo(0, 5);
  });

  it('should compute complex csc', () => {
    // csc(i) = 1/sin(i) = 1/(i*sinh(1)) = -i/sinh(1)
    const expr = ce.expr(['Csc', ['Complex', 0, 1]]);
    const result = compile(expr, { fallback: false });
    const val = result.run!() as { re: number; im: number };
    expect(val.re).toBeCloseTo(0, 5);
    expect(val.im).toBeCloseTo(-1 / Math.sinh(1), 5);
  });

  it('real cot unchanged', () => {
    const expr = ce.expr(['Cot', 1]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(Math.cos(1) / Math.sin(1));
  });

  it('real sec unchanged', () => {
    const expr = ce.expr(['Sec', 1]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(1 / Math.cos(1));
  });

  it('real csc unchanged', () => {
    const expr = ce.expr(['Csc', 1]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(1 / Math.sin(1));
  });
});

describe('COMPILE COMPLEX - integration', () => {
  it('should compile and run nested complex expression', () => {
    // (3+2i) * (1+i) + (0+1i) = (3*1-2*1) + (3*1+2*1)i + i = 1 + 5i + i = 1+6i
    const expr = ce.expr([
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
    const expr = ce.expr(['Abs', ['Add', ['Complex', 3, 0], ['Complex', 0, 4]]]);
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
    const expr = ce.expr([
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

describe('COMPILE COMPLEX - runtime variables', () => {
  it('should compile with complex-typed variable', () => {
    ce.declare('z', 'complex');
    const expr = ce.expr(['Add', 'z', 1]);
    const result = compile(expr, { fallback: false });
    // z is complex-typed, so Add should use complex path
    const val = result.run!({ z: { re: 3, im: 4 } }) as {
      re: number;
      im: number;
    };
    expect(val.re).toBeCloseTo(4);
    expect(val.im).toBeCloseTo(4);
    ce.forget('z');
  });

  it('should compile Sin of complex variable', () => {
    ce.declare('w', 'complex');
    const expr = ce.expr(['Sin', 'w']);
    const result = compile(expr, { fallback: false });
    // Should use _SYS.csin since w is complex
    expect(result.code).toContain('_SYS.csin');
    ce.forget('w');
  });

  it('should compile Abs of complex variable', () => {
    ce.declare('u', 'complex');
    const expr = ce.expr(['Abs', 'u']);
    const result = compile(expr, { fallback: false });
    // Should use _SYS.cabs
    expect(result.code).toContain('_SYS.cabs');
    const val = result.run!({ u: { re: 3, im: 4 } });
    expect(val).toBeCloseTo(5);
    ce.forget('u');
  });

  it('untyped variable stays real', () => {
    const expr = ce.expr(['Sin', 'x']);
    const result = compile(expr, { fallback: false });
    expect(result.code).toContain('Math.sin');
    expect(result.code).not.toContain('_SYS.csin');
  });
});
