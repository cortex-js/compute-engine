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

  it('Argument of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Argument', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Real of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Real', ['Complex', 3, 4]])
      )
    ).toBe(false);
  });

  it('Imaginary of complex is real', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce.expr(['Imaginary', ['Complex', 3, 4]])
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

  it('fails closed on Sqrt of a negative real constant', () => {
    // sqrt(-1) has no real value. Per the fail-closed policy (D6), a real
    // target refuses to fold it to a literal `NaN`: with `fallback: false` the
    // compile throws; with the default fallback it reports `success: false`.
    const expr = ce.expr(['Sqrt', -1]);
    expect(() => compile(expr, { fallback: false })).toThrow(/no real value/);
    expect(compile(expr).success).toBe(false);
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
    const expr = ce.expr(['Argument', ['Complex', 1, 1]]);
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
    // Use non-Gaussian-integer (inexact) complex literals: since D12-A,
    // exact complex operands fold to a single literal at canonicalization,
    // which would leave no 3-operand multiply to compile.
    const expr = ce.expr([
      'Multiply',
      ['Complex', 1.5, 1],
      ['Complex', 2, 1.5],
      ['Complex', 1, -1.5],
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

  it('should handle Real of complex', () => {
    const expr = ce.expr(['Real', ['Complex', 3, 4]]);
    const result = compile(expr, { fallback: false });
    expect(result.run!()).toBeCloseTo(3);
  });

  it('should handle Imaginary of complex', () => {
    const expr = ce.expr(['Imaginary', ['Complex', 3, 4]]);
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

// Tycho items 57/58/59 — the complex-compile emission class from the
// c062d54000 Julia-set session. All three shapes share the reference value
// of the depth-2 iteration |((x+iy)²+z₀)²+z₀|−4 at (0.3, 0.4) with
// z₀ = −0.524−0.566i.
describe('COMPILE COMPLEX - assigned/local typing and CSE (Tycho items 57-59)', () => {
  const REF = -3.6699834359551025;
  const Z0 = '-.524-.566\\imaginaryI';
  const CLOSED = '\\vert((x+\\imaginaryI y)^2+z_0)^2+z_0\\vert-4';

  it('item 57: an ASSIGNED complex symbol compiles complex without a declare', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.assign('z_0', e.parse(Z0).evaluate());
    const res = compile(e.parse(CLOSED), { fallback: false });
    expect(res.run!({ x: 0.3, y: 0.4 })).toBeCloseTo(REF, 12);
  });

  it('item 57: a declared-unknown assigned complex symbol compiles complex', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('z_0', 'unknown');
    e.assign('z_0', e.parse(Z0).evaluate());
    const res = compile(e.parse(CLOSED), { fallback: false });
    expect(res.run!({ x: 0.3, y: 0.4 })).toBeCloseTo(REF, 12);
  });

  it('item 58: a coloneq chain of complex locals compiles complex end-to-end', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.assign('z_0', e.parse(Z0).evaluate());
    const res = compile(
      e.parse(
        'w_{1}\\coloneq(x+\\imaginaryI y)^{2}+z_0; w_{2}\\coloneq w_{1}^{2}+z_0; \\vert w_{2}\\vert-4'
      ),
      { fallback: false }
    );
    expect(res.run!({ x: 0.3, y: 0.4 })).toBeCloseTo(REF, 12);
  });

  it('item 58: a real local chain is unaffected', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    const res = compile(e.parse('a\\coloneq x+1; a^2'), { fallback: false });
    expect(res.run!({ x: 2 })).toBe(9);
  });

  it('item 59: nested complex Add binds compound operands once (linear code size)', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.assign('z_0', e.parse(Z0).evaluate());
    let body = '(x+\\imaginaryI y)';
    for (let i = 0; i < 10; i++) body = `(${body}^{2}+z_0)`;
    const res = compile(e.parse(`\\vert${body}\\vert-4`), {
      fallback: false,
    });
    // Was ~360 KB (each Add spliced its compound operand twice — doubling
    // per nesting level); with once-binding the emission is O(tree size).
    expect(res.code!.length).toBeLessThan(10_000);
    // Interpreter parity at a sample point.
    const interp = e
      .parse(`\\vert${body}\\vert-4`)
      .subs({ x: 0.3, y: 0.4 })
      .N().re;
    expect(res.run!({ x: 0.3, y: 0.4 })).toBeCloseTo(interp, 10);
  });

  it('item 59: a simple complex Add keeps the direct object-literal emission', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('w', 'complex');
    const res = compile(e.expr(['Add', 'w', 2]), { fallback: false });
    // Symbol + number operands need no binding: no IIFE wrapper.
    expect(res.code).not.toContain('=>');
  });
});

describe('COMPILE COMPLEX - literal square fast path and recursive lambdas', () => {
  it('a literal square of a complex base inlines the multiply (no cpow)', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    const res = compile(e.parse('(x+\\imaginaryI y)^2'), { fallback: false });
    // Polar-form cpow is both ~10× slower per call and rounds differently
    // from the interpreter's multiply.
    expect(res.code).not.toContain('cpow');
    const v = res.run!({ x: 0.3, y: 0.4 }) as { re: number; im: number };
    expect(v.re).toBeCloseTo(-0.07, 12); // (0.3+0.4i)² = -0.07+0.24i
    expect(v.im).toBeCloseTo(0.24, 12);
  });

  it('literal integer powers 3–8 inline a square-and-multiply chain', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    for (let k = 3; k <= 8; k++) {
      const res = compile(e.parse(`(x+\\imaginaryI y)^{${k}}`), {
        fallback: false,
      });
      expect(res.code).not.toContain('cpow');
      const v = res.run!({ x: 0.318, y: 0.417 }) as { re: number; im: number };
      const interp = e.box(['Power', ['Complex', 0.318, 0.417], k]).N();
      // The interpreter goes through transcendental pow for k ≥ 3, so the
      // multiply chain agrees to ~1 ulp, not digit-for-digit.
      expect(v.re).toBeCloseTo(interp.re, 12);
      expect(v.im).toBeCloseTo(interp.im, 12);
    }
  });

  it('a literal 9th power still routes through cpow (chain capped at 8)', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    const res = compile(e.parse('(x+\\imaginaryI y)^9'), { fallback: false });
    expect(res.code).toContain('cpow');
  });

  it('box-then-assign recursive lambda compiles regardless of function name', () => {
    // Pre-fix, a literal canonicalized BEFORE ce.assign left its self-call
    // bound to a stale auto-declaration; names with no shell pre-declaration
    // typed the application `any` (top) and the Add collection guard
    // fail-closed. `M2` is such a name (`K`, a shell-declared letter, masked
    // the bug). ce.assign now re-ties the recursion knot. Also exercises the
    // signature-string sugar in the compile pipeline.
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.assign(
      'M2',
      e.box([
        'Function',
        [
          'Which',
          ['LessEqual', 'n', 0],
          'z',
          'True',
          [
            'Add',
            ['Power', ['M2', ['Subtract', 'n', 1], 'z'], 3],
            ['Complex', 0.35, 0.4],
          ],
        ],
        "'(n: integer, z: number) -> complex'",
      ])
    );
    const res = compile(
      e.box(['M2', 5, ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']]]),
      { fallback: false }
    );
    const v = res.run!({ x: 0.13, y: 0.21 }) as { re: number; im: number };
    const interp = e.box(['M2', 5, ['Complex', 0.13, 0.21]]).N();
    expect(v.re).toBeCloseTo(interp.re, 12);
    expect(v.im).toBeCloseTo(interp.im, 12);
  });

  it('a recursive complex lambda (iterated Julia map, typed return) compiles with digit parity', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    // K(n, z) = n ≤ 0 ? z : K(n-1, z)² + (0.35+0.4i). The `complex` return
    // ascription pins the self-call scalar — without it the application types
    // `broadcastable<number>` and the complex-element bcast deferral fails
    // the compile closed (documented consumer requirement in the design doc).
    e.assign(
      'K',
      e.box([
        'Function',
        [
          'Typed',
          [
            'Which',
            ['LessEqual', 'n', 0],
            'z',
            'True',
            [
              'Add',
              ['Power', ['K', ['Subtract', 'n', 1], 'z'], 2],
              ['Complex', 0.35, 0.4],
            ],
          ],
          { str: 'complex' },
        ],
        ['Typed', 'n', { str: 'integer' }],
        'z',
      ])
    );
    const res = compile(
      e.box(['K', 10, ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']]]),
      { fallback: false }
    );
    // True recursion: the emitted call references the named local.
    expect(res.code).toContain('_fn_K(');
    const v = res.run!({ x: 0.13, y: 0.21 }) as { re: number; im: number };
    const interp = e.box(['K', 10, ['Complex', 0.13, 0.21]]).N();
    expect(v.re).toBeCloseTo(interp.re, 12);
    expect(v.im).toBeCloseTo(interp.im, 12);
  });
});

describe('COMPILE COMPLEX - real/complex convention coercion (Tycho item 60)', () => {
  // A constant base-case `Which` arm inside a complex-ascribed recursive
  // function used to compile to a plain real value while the recursion's
  // calling convention expects `{ re, im }` slots — NaN at EVERY point,
  // including points that never leave the base arm (`M(0, z) = 0` is the
  // canonical Desmos base-case shape). Arms provably real are now coerced to
  // the complex convention; wide-typed pass-through arms stay bare.

  it('a constant base-case arm in a complex recursion compiles correctly', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('M', { type: '(number, complex) -> complex' });
    e.assign(
      'M',
      e.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 0],
          0,
          'True',
          ['Subtract', ['Square', ['M', ['Subtract', 'n', 1], 'z']], 'z'],
        ],
        'n',
        'z',
      ])
    );
    // |M(10, x+iy-2)| - 4, realOnly — the item-60 minimal repro.
    const res = compile(
      e.box([
        'Subtract',
        [
          'Abs',
          [
            'M',
            10,
            [
              'Subtract',
              ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']],
              2,
            ],
          ],
        ],
        4,
      ]),
      { realOnly: true, fallback: false }
    );
    expect(res.success).toBe(true);
    // (2,0): seed = 0, M(10, 0) = 0 entirely through the base clause.
    expect(res.run!({ x: 2, y: 0 })).toBe(-4);
    // Off the base clause: digit parity with the interpreter.
    expect(res.run!({ x: 1.9, y: 0.1 })).toBeCloseTo(-3.845387494413912, 12);
    expect(res.run!({ x: 2.2, y: 0.3 })).toBeCloseTo(-3.704870928610795, 12);
  });

  it('a non-zero constant arm and a real literal seed argument coerce too', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('P', { type: '(number, complex) -> complex' });
    e.assign(
      'P',
      e.box([
        'Function',
        [
          'Which',
          ['Equal', 'n', 0],
          1,
          'True',
          ['Subtract', ['Square', ['P', ['Subtract', 'n', 1], 'z']], 'z'],
        ],
        'n',
        'z',
      ])
    );
    // `Complex(0, 0)` canonicalizes back to the real literal 0: the call-site
    // argument to the complex parameter is coerced to `{ re, im }`.
    const res = compile(e.box(['Abs', ['P', 3, ['Complex', 0, 0]]]), {
      realOnly: true,
      fallback: false,
    });
    expect(res.run!({})).toBe(1);
  });

  it('an all-real body under a complex return ascription is coerced by Typed', () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('Q', { type: '(number, complex) -> complex' });
    e.assign(
      'Q',
      e.box(['Function', ['Which', ['Equal', 'n', 0], 3, 'True', 5], 'n', 'z'])
    );
    const res = compile(e.box(['Abs', ['Q', 0, ['Complex', 1, 1]]]), {
      realOnly: true,
      fallback: false,
    });
    expect(res.run!({})).toBe(3);
  });

  it('If with mixed real/complex arms produces one convention', () => {
    const res = compile(
      ce.box(['Abs', ['If', ['Less', 'x', 0], 0, ['Complex', 3, 4]]]),
      { realOnly: true, fallback: false }
    );
    expect(res.run!({ x: -1 })).toBe(0);
    expect(res.run!({ x: 1 })).toBe(5);
  });

  it('When with a complex arm keeps the masked branch in the complex convention', () => {
    const res = compile(
      ce.box([
        'Abs',
        ['When', ['Multiply', ['Complex', 0, 1], 'x'], ['Less', 'x', 0]],
      ]),
      { realOnly: true, fallback: false }
    );
    expect(res.run!({ x: -2 })).toBe(2);
    expect(res.run!({ x: 2 })).toBeNaN();
  });

  it('a wide-typed pass-through arm is NOT wrapped (carries the object bare)', () => {
    // K's z slot is declared `number` (wide): the base arm `z` must stay
    // bare — at run time it holds the complex object, and wrapping it would
    // nest it. Guards the refinement over the naive "coerce every non-complex
    // arm" rule.
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.assign(
      'K2',
      e.box([
        'Function',
        [
          'Typed',
          [
            'Which',
            ['LessEqual', 'n', 0],
            'z',
            'True',
            [
              'Add',
              ['Power', ['K2', ['Subtract', 'n', 1], 'z'], 2],
              ['Complex', 0.35, 0.4],
            ],
          ],
          { str: 'complex' },
        ],
        ['Typed', 'n', { str: 'integer' }],
        'z',
      ])
    );
    const res = compile(
      e.box(['K2', 6, ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']]]),
      { fallback: false }
    );
    const v = res.run!({ x: 0.13, y: 0.21 }) as { re: number; im: number };
    const interp = e.box(['K2', 6, ['Complex', 0.13, 0.21]]).N();
    expect(v.re).toBeCloseTo(interp.re, 12);
    expect(v.im).toBeCloseTo(interp.im, 12);
  });
});
