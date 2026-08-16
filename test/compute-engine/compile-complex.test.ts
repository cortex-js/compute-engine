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

  // POLICY CHANGE 2026-07-30 — do NOT "restore" the old throw. `Sqrt(-1)` used
  // to be REFUSED ("no real value") at the constant-fold site, while every
  // sibling head in the same mathematical situation compiled and returned
  // `NaN` at run time (`Ln(-2)` → `Math.log(-2)`, `Arcsin(2)` →
  // `Math.asin(2)`), and while the SAME expression compiled fine when the
  // operand was a variable (`√x` at `x = -2` → `NaN`, `√a` with `a ⩴ -2` →
  // `Math.sqrt((-2))`). Fail-closed (D6) exists to prevent silently WRONG
  // output, not to prevent a non-real one: `NaN` is the correct,
  // self-describing answer for "no real value", and refusing only the
  // provable-constant case bought no safety, because the runtime-variable
  // case cannot be caught in principle — the caller must handle `NaN` either
  // way.
  it('folds Sqrt of a negative real constant to the complex value', () => {
    // No `realOnly`: the target supports complex values, and a canonical
    // `Sqrt(negative)` is typed `complex`, so the fold is the complex
    // principal value the interpreter returns — the same shape `1 + i` and
    // `Sqrt(Complex(0, 1))` already compile to.
    const expr = ce.expr(['Sqrt', -1]);
    const result = compile(expr, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.code).toBe('({ re: 0, im: 1 })');
    expect(result.run!()).toEqual({ re: 0, im: 1 });
  });

  it('folds Sqrt of a negative real constant to NaN under realOnly', () => {
    const expr = ce.expr(['Sqrt', -1]);
    const result = compile(expr, { fallback: false, realOnly: true });
    expect(result.success).toBe(true);
    expect(result.run!() as number).toBeNaN();
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
    // `constantFold: false`: this suite exercises the emitted `_SYS` helper at
    // run time. With folding on, the whole (variable-free) expression is
    // evaluated at compile time and emitted as a real literal, so the helper
    // never runs and the result is a bare number rather than `{re, im}`.
    const expr = ce.expr(['Exp', ['Complex', 0, Math.PI]]);
    const result = compile(expr, { fallback: false, constantFold: false });
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
    // `constantFold: false`: the assertion is on the shape of the EMITTED
    // code, which a compile-time fold of this variable-free product would
    // replace with a single literal.
    const result = compile(expr, { fallback: false, constantFold: false });
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
    // `constantFold: false`: sec(i) is real, so a compile-time fold of this
    // variable-free expression emits a bare number and the complex `{re, im}`
    // lowering under test is never exercised.
    const result = compile(expr, { fallback: false, constantFold: false });
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
    // `constantFold: false`: the test checks the `{re, im}` result of the
    // emitted complex arithmetic; folding this variable-free expression at
    // compile time would emit a real literal instead.
    const result = compile(expr, { fallback: false, constantFold: false });
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
    // True recursion: the emitted call references the named local. K's `z`
    // slot is wide-typed and receives the complex `x + iy`, so the call site
    // is the complex LANE of `K` — emitted as the `_fn_K$z01` specialization
    // (`userFunctionName`: parameter 2 complex) — and the recursive self-call
    // `K(n-1, z)` inside it resolves, by name, to that same specialization.
    expect(res.code).toContain('_fn_K$z01(');
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

describe('COMPILE COMPLEX - binder index named `i` (Tycho item 65)', () => {
  // A `Sum`/`Product` index named `i` used to be walked as a FREE symbol by
  // `isComplexValued` (via the `Limits` operand, which carries the bound name
  // but no value), resolve against the engine to the imaginary unit, and
  // complex-lower the SIBLING operand of any enclosing arithmetic. The
  // interpreter was correct throughout; the compiled result was NaN — or, for
  // `Sin(Sum(…)) + 2.5`, silently 2.5 with the term vanished.
  const ce2 = ce;
  const jsTarget = (
    ce2 as unknown as {
      getCompilationTarget: (l: string) => {
        compile: (
          e: unknown,
          o: unknown
        ) => { success: boolean; run: (a: unknown) => unknown };
      };
    }
  ).getCompilationTarget('javascript');

  const run = (latex: string): unknown => {
    const expr = ce2.parse(latex, { strict: false });
    const res = jsTarget.compile(expr, { realOnly: true });
    expect(res.success).toBe(true);
    return res.run({ t: 1 });
  };

  // [latex, expected value at t = 1]
  const cases: [string, number][] = [
    ['\\sum_{i=0}^{2}\\cos(it)', 1.1241554693209974],
    // Arithmetic siblings of the Sum: all four used to be NaN.
    ['\\sum_{i=0}^{2}\\cos(it)+2.5', 3.624155469320997],
    ['2.5+\\sum_{i=0}^{2}\\cos(it)', 3.624155469320997],
    ['2\\sum_{i=0}^{2}\\cos(it)', 2.248310938641995],
    // Index inside the body: masking only the `Limits` operand is not enough.
    ['\\sum_{i=0}^{2}it+1', 4],
    // Index does not even occur in the body.
    ['\\sum_{i=0}^{2}\\cos(t)+2.5', 4.120906917604419],
    ['\\prod_{i=1}^{3}(i+t)+2.5', 26.5],
    // Was SILENTLY WRONG (2.5 — the Sin term vanished), not NaN.
    ['\\sin(\\sum_{i=0}^{2}\\cos(it))+2.5', 3.4019031305828076],
    // Control rows: an index not named `i` was always correct.
    ['\\sum_{n=0}^{2}\\cos(nt)+2.5', 3.624155469320997],
    ['\\prod_{j=1}^{3}(j+t)+2.5', 26.5],
  ];

  for (const [latex, expected] of cases) {
    it(`compiles ${latex} to ${expected}`, () => {
      const compiled = run(latex);
      expect(compiled).toBeCloseTo(expected, 12);
      // The compiled result must agree with the interpreter.
      expect(
        ce2.parse(latex, { strict: false }).subs({ t: 1 }).N().re
      ).toBeCloseTo(expected, 12);
    });
  }

  it('a Sum/Product index is not complex-valued', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce2.parse('\\sum_{i=0}^{2}\\cos(it)', { strict: false })
      )
    ).toBe(false);
    expect(
      BaseCompiler.isComplexValued(
        ce2.parse('\\prod_{i=1}^{3}(i+t)', { strict: false })
      )
    ).toBe(false);
  });

  // The fix must not make real anything that genuinely IS complex.
  it('a free `i` outside any binder is still the imaginary unit', () => {
    for (const latex of ['i', '2+i', 'it', '\\sqrt{-1}', 'e^{i\\pi}'])
      expect(
        BaseCompiler.isComplexValued(ce2.parse(latex, { strict: false }))
      ).toBe(true);
  });

  it('a free `i` inside a Sum bound by another index stays complex', () => {
    expect(
      BaseCompiler.isComplexValued(
        ce2.parse('\\sum_{k=0}^{2}(k+i)', { strict: false })
      )
    ).toBe(true);
  });

  it('a lambda parameter named `i` shadows the imaginary unit', () => {
    const f = ce2.parse('i \\mapsto i^2', { strict: false });
    expect(BaseCompiler.isComplexValued(f)).toBe(false);
    const res = jsTarget.compile(ce2.box(['Apply', f, ['Add', 'x', 1]]), {
      realOnly: true,
    });
    expect(res.success).toBe(true);
    expect(res.run({ x: 2 })).toBe(9);
  });
});

// Tycho item 62 counter-ask: `realOnly: true` was silently inert for a complex
// tuple/list COMPONENT — the top-level coercion inspects only the result
// itself, so a `{re, im}` in a component slot reached the consumer in a number
// slot.
//
// POLICY CHANGE 2026-07-30 — do NOT "restore" the throw. The original fix
// added a compile-time REFUSAL for a provably complex component on top of the
// runtime coercion. The refusal is retired: `wrapRealOnly` recurses into array
// results, so a provably complex component is projected to `NaN` in its slot,
// exactly like a component that only becomes complex when the compiled
// function is called (`(t, √t)` at `t = -4` → `[-4, NaN]`, which no static
// check can catch). Refusing only the provable case bought no safety and made
// `(1, i)` behave differently from `(1, √x)` at `x = -4`.
describe('realOnly projects complex tuple components to NaN (Tycho item 62)', () => {
  const jsTarget = () =>
    (
      ce as unknown as { getCompilationTarget: (t: string) => any }
    ).getCompilationTarget('javascript');

  test.each([
    ['(t, i t)', [0.5, NaN]],
    ['(t, 2+3i)', [0.5, NaN]],
    ['(i t, t)', [NaN, 0.5]],
  ])('%s compiles under realOnly, complex component → NaN', (src, expected) => {
    const expr = ce.parse(src as string, { strict: false });
    const r = jsTarget().compile(expr, { realOnly: true });
    expect(r.success).toBe(true);
    expect(r.run({ t: 0.5 })).toEqual(expected);
  });

  test('the same expression still compiles WITHOUT realOnly', () => {
    const r = jsTarget().compile(ce.parse('(t, i t)', { strict: false }));
    expect(r.success).toBe(true);
    expect(r.run({ t: 0.5 })).toEqual([0.5, { re: 0, im: 0.5 }]);
  });

  test.each([
    '(\\cos t, \\sin t)',
    '(t, t^2)',
    '(t, \\sqrt{t})',
    '(t, \\ln t)',
    '[1,2,3]',
  ])('real-valued %s still compiles under realOnly', (src) => {
    const r = jsTarget().compile(ce.parse(src, { strict: false }), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    const v = r.run({ t: 0.5 }) as number[];
    expect(v.every((x) => typeof x === 'number')).toBe(true);
  });

  test('a Sum-bearing point list is not a false positive', () => {
    const r = jsTarget().compile(
      ce.parse(
        '\\operatorname{PointList}(\\sum_{i=0}^{2}\\cos(it), \\sum_{i=0}^{2}\\sin(it))',
        { strict: false }
      ),
      { realOnly: true }
    );
    expect(r.success).toBe(true);
    const v = r.run({ t: 0.5 }) as number[];
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });

  // The same coercion, for values that only become complex when called.
  test('realOnly coercion recurses into array results', () => {
    const r = jsTarget().compile(ce.parse('(t, \\sqrt{t})', { strict: false }), {
      realOnly: true,
    });
    // sqrt of a negative argument is complex only at call time
    expect(r.run({ t: -4 })).toEqual([-4, NaN]);
  });
});

// A complex operand that never reaches the result must not colour the result:
// `At([i, 2], 2)` reads the real component and returns a real value. (This
// used to guard a static component check; since that check was retired
// 2026-07-30 it pins the same invariant on the runtime projection.)
describe('realOnly leaves an unused complex operand alone', () => {
  const jsTarget = () =>
    (
      ce as unknown as { getCompilationTarget: (t: string) => any }
    ).getCompilationTarget('javascript');

  test.each([
    ['\\mathrm{At}([i, 2], 2)', 2],
    ['\\mathrm{At}((t, i t), 1)', 0.5],
  ])('%s compiles under realOnly (complex operand never reaches the result)', (src, expected) => {
    const r = jsTarget().compile(ce.parse(src, { strict: false }), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.run({ t: 0.5 })).toEqual(expected);
  });

  test.each([
    ['(t, i t)', [0.5, NaN]],
    ['(t, 2+3i)', [0.5, NaN]],
  ])('%s → NaN in the complex slot — the complex component IS the result', (src, expected) => {
    const r = jsTarget().compile(ce.parse(src as string, { strict: false }), {
      realOnly: true,
    });
    expect(r.success).toBe(true);
    expect(r.run({ t: 0.5 })).toEqual(expected);
  });
});

// A complex value passed as an ARGUMENT to a scalar-bodied user function.
// Before the per-lane emission the call site's verdict was discarded at the
// user-call boundary: `b(x) := 2x` was analyzed with `x` masked real and
// emitted once, in the real lane, so `_fn_b({re, im})` computed `2 * {re, im}`
// = NaN behind `success: true`. It was filed against the `complexPromotion`
// opt-in (`b(a(t))` with `a(t) := √(t−1)`) but was never specific to it — a
// declared-complex `w` took the same path on the default route. Now each call
// site's lane pattern (`userCallComplexLanes`) selects a specialization
// (`_fn_b$z1`) whose body compiles with the parameter bound complex, and the
// real lane keeps its bare name and byte-identical body.
describe('COMPILE COMPLEX - complex ARGUMENT to a wide-typed user-function parameter (per-lane emission)', () => {
  const fresh = () => {
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.parse('a(t) := \\sqrt{t-1}').evaluate();
    e.parse('b(x) := 2x').evaluate();
    e.parse('f(x) := x').evaluate();
    e.parse('h(x, y) := xy').evaluate();
    e.parse('c(x) := b(x) + 1').evaluate();
    e.declare('w', 'complex');
    return e;
  };
  const W = { re: 1, im: 2 };

  it('ON: the ROADMAP witness |b(a(t))/2 − 1| matches the interpreter', () => {
    const e = fresh();
    const r = compile(e.parse('|b(a(t))/2 - 1|'), { complexPromotion: true });
    expect(r.success).toBe(true);
    // Interpreter: |2·√(0.3−1)/2 − 1| = |i·0.83666 − 1| = 1.30384…
    expect(r.run!({ t: 0.3 })).toBeCloseTo(1.3038404810405297, 12);
  });

  it('ON: b(a(t)) is classified complex at the call site and returns {re, im}', () => {
    const e = fresh();
    expect(BaseCompiler.isComplexValued(e.parse('a(t)'))).toBe(false); // opt-in off here
    const r = compile(e.parse('t \\mapsto b(a(t))'), { complexPromotion: true });
    expect(r.code).toContain('_fn_b$z1');
    const v = r.run!(0.3) as { re: number; im: number };
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(1.6733200530681511, 12);
  });

  it('ON: an identity body (pass-through) keeps working through the lane', () => {
    const e = fresh();
    const r = compile(e.parse('t \\mapsto f(a(t))'), { complexPromotion: true });
    const v = r.run!(0.3) as { re: number; im: number };
    expect(v.re).toBeCloseTo(0, 12);
    expect(v.im).toBeCloseTo(0.8366600265340756, 12);
  });

  it('DEFAULT path: a declared-complex argument to b(x) := 2x computes 2w', () => {
    const e = fresh();
    for (const [src, expected] of [
      ['b(w)', { re: 2, im: 4 }],
      ['b(w) + 1', { re: 3, im: 4 }],
      ['b(t + w)', { re: 6, im: 4 }], // t = 2: 2·(3 + 2i)
      ['b(b(w))', { re: 4, im: 8 }],
      ['c(w)', { re: 3, im: 4 }], // nested: the lane parameter passed on to b
      ['h(w, 2)', { re: 2, im: 4 }],
      ['h(2, w)', { re: 2, im: 4 }],
      ['h(w, w)', { re: -3, im: 4 }],
    ] as const) {
      const r = compile(e.parse(src), { fallback: false });
      expect(r.success).toBe(true);
      const v = r.run!({ w: W, t: 2 }) as { re: number; im: number };
      expect([src, v.re, v.im]).toEqual([src, expected.re, expected.im]);
    }
  });

  it('a real-valued body over a complex lane parameter stays a plain number', () => {
    const e = fresh();
    e.parse('r(x) := |x|').evaluate();
    const r = compile(e.parse('r(w) + 1'), { fallback: false });
    expect(r.run!({ w: { re: 3, im: 4 } })).toBe(6);
  });

  it('the real lane is unchanged: bare name, plain body, no specialization', () => {
    const e = fresh();
    for (const src of ['b(3)', 'b(t)', 'h(3, 4)']) {
      const r = compile(e.parse(src), { fallback: false });
      expect(r.code).not.toContain('$z');
    }
    const r = compile(e.parse('t \\mapsto b(t)'), { fallback: false });
    expect(r.code).toContain('const _fn_b = (x) => 2 * x;');
    expect(r.run!(0.3)).toBeCloseTo(0.6, 12);
  });

  it('both lanes of one function coexist in a single compilation', () => {
    const e = fresh();
    const r = compile(e.parse('t \\mapsto b(a(t)) + b(t)'), {
      complexPromotion: true,
    });
    expect(r.code).toContain('const _fn_b = (x) => 2 * x;');
    expect(r.code).toContain('const _fn_b$z1 = (x) =>');
    const v = r.run!(0.3) as { re: number; im: number };
    expect(v.re).toBeCloseTo(0.6, 12);
    expect(v.im).toBeCloseTo(1.6733200530681511, 12);
  });

  it('a recursive self-call inside the complex lane resolves to the SAME specialization', () => {
    // K's `z` slot is wide-typed. Inside `_fn_K$z01` the parameter `z` is
    // framed as a scalar complex object, so the self-call `K(n-1, z)` grants
    // the same lane and emits `_fn_K$z01` — never a real-lane `_fn_K` that
    // would receive the complex object.
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
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
    const r = compile(e.parse('t \\mapsto K(3, t + 2i)'), { fallback: false });
    expect(r.code).toContain('_fn_K$z01(');
    expect(r.code).not.toContain('_fn_K(');
    const v = r.run!(0.1) as { re: number; im: number };
    const interp = e.box(['K', 3, ['Complex', 0.1, 2]]).N();
    expect(v.re).toBeCloseTo(interp.re, 10);
    expect(v.im).toBeCloseTo(interp.im, 10);
  });

  it('an emitted definition does not see the caller Block\'s local shapes (isolated frame)', () => {
    // `u(x) := x + k` reads the GLOBAL `k`; the calling block declares its
    // own complex local `k`. Before the emitted body compiled under an
    // isolated frame, the block's `k → complex` entry leaked into `u`'s body,
    // which then lowered the plain global as `{re, im}` — `{re: null}` where
    // the interpreter answers 7.
    const { ComputeEngine } = require('../../src/compute-engine');
    const e = new ComputeEngine();
    e.declare('k', 'real');
    e.parse('u(x) := x + k').evaluate();
    const blk = e.box([
      'Block',
      ['Declare', 'k', 'complex'],
      ['Assign', 'k', ['Complex', 1, 1]],
      ['u', 2],
    ]);
    const r = compile(blk, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ k: 5 })).toBe(7);
  });
});
