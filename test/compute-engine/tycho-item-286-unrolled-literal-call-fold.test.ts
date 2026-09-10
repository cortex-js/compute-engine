import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  foldEmittedGPUCode,
  foldEmittedJavaScriptCode,
  formatFloat,
} from '../../src/compute-engine/compilation/constant-folding';

/**
 * A `Sum` or `Product` over a small constant range is unrolled by substituting
 * the index at the emitted-CODE level, so the folds that run on the expression
 * TREE never see the literal the index became: `\sum_k (-1)^k x` compiled to
 * one `_SYS.pow(-1, k)` call per term, with the exponent already a literal in
 * the emitted text.
 *
 * On the shader targets that was a wrong VALUE, not only a cost. GLSL and WGSL
 * define `pow(x, y)` as `exp2(y·log2(x))`, which is undefined for a negative
 * base — `pow(-1.0, 1.0)` answers NaN on most drivers — and the GPU target
 * therefore never writes `pow` for a literal integer exponent: it writes
 * repeated multiplication or the sign-preserving `_gpu_powi` helper. Only the
 * unroll could put such a call in the emitted code.
 *
 * The emitted-code fold (`CompileTarget.foldEmittedConstant`) now evaluates
 * those calls, and the identity-operand fold turns the `-1` factors they leave
 * into a negation.
 */

/** The compiled JavaScript source of `expr`, preamble included. */
function source(ce: ComputeEngine, latex: string): string {
  const r = compile(ce.parse(latex), { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  return `${r.preamble ?? ''}\n${String(r.code)}`;
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

describe('an unrolled Sum leaves no literal-only call behind', () => {
  it('JavaScript: `(-1)^k` folds to a negation, not a `_SYS.pow` call', () => {
    const ce = engine();
    const code = source(ce, '\\sum_{k=1}^{3}(-1)^{k}x');
    expect(code).not.toContain('_SYS.pow');
    expect(code).toContain('-_.x');
  });

  it('GLSL: `(-1)^k` folds away, so no `pow` of a negative base survives', () => {
    const ce = engine();
    const r = compile(ce.parse('\\sum_{k=1}^{3}(-1)^{k}x'), {
      to: 'glsl',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const code = `${r.preamble ?? ''}\n${String(r.code)}`;
    expect(code).not.toContain('pow(-1.0');
    // The three terms carry the folded exponents: `-1.0`, `1.0`, `-1.0`.
    expect(code).toContain('(-1.0)');
    expect(code).toContain('1.0');
  });

  it('JavaScript: a complex square root of a literal folds to its value', () => {
    const ce = engine();
    const code = source(ce, '\\sum_{k=1}^{2}\\sqrt{k-3}\\,x');
    expect(code).not.toContain('_SYS.csqrt');
    // `√(−2) = i√2` and `√(−1) = i`, both pure imaginary.
    expect(code).toContain(`im: ${Math.sqrt(2)}`);
    expect(code).toContain('im: 1');
  });

  it('JavaScript: a fixed integer power of a literal index folds', () => {
    const ce = engine();
    const code = source(ce, '\\sum_{k=1}^{4}k^{4}x');
    expect(code).not.toContain('_SYS.pow4');
    expect(code).toContain('16');
    expect(code).toContain('81');
    expect(code).toContain('256');
  });
});

describe('the compiled value still agrees with the interpreter', () => {
  const SAMPLES = [2, -3, 0, -0, 0.5, 1e300, NaN];

  it.each([
    '\\sum_{k=1}^{3}(-1)^{k}x',
    '\\sum_{k=1}^{4}k^{4}x',
    '\\sum_{k=1}^{3}\\frac{(-1)^{k}x}{3}',
    '\\sum_{k=1}^{3}(-1)^{k}(-1)^{k}x',
    '\\sum_{k=1}^{3}k!\\,x',
    '\\sum_{k=1}^{3}\\Gamma(k)x',
  ])('%s', (latex) => {
    const ce = engine();
    const expr = ce.parse(latex);
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    for (const x of SAMPLES) {
      const got = r.run!({ x }) as number;
      const want = expr.subs({ x: ce.number(x) }).N();
      if (Number.isNaN(want.re)) expect(got).toBeNaN();
      else expect(got).toBeCloseTo(want.re, 10);
    }
  });

  it('a complex-valued unrolled Sum keeps both components', () => {
    const ce = engine();
    const expr = ce.parse('\\sum_{k=1}^{2}\\sqrt{k-3}\\,x');
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    for (const x of [2, -3, 0.5]) {
      const got = r.run!({ x }) as { re: number; im: number };
      const want = expr.subs({ x: ce.number(x) }).N();
      expect(got.re).toBeCloseTo(want.re, 10);
      expect(got.im).toBeCloseTo(want.im, 10);
    }
    // An absent value reaches the kernel as NaN and both components stay NaN,
    // which is what the interpreter answers for the whole Sum.
    const nan = r.run!({ x: NaN }) as { re: number; im: number };
    expect(nan.re).toBeNaN();
    expect(nan.im).toBeNaN();
  });
});

describe('the folds the unroll relies on', () => {
  it('folds `_SYS.pow` on two literals and leaves `0^0` alone', () => {
    expect(foldEmittedJavaScriptCode('_SYS.pow(-1, 1)')).toBe('(-1)');
    expect(foldEmittedJavaScriptCode('_SYS.pow(-1, 2)')).toBe('1');
    expect(foldEmittedJavaScriptCode('_SYS.pow(2, 0.5)')).toBe(
      String(Math.SQRT2)
    );
    // `_SYS.pow` carries the interpreter's `0^0 = NaN` convention; a NaN has
    // no literal the fold may write, so the call is left to run time.
    expect(foldEmittedJavaScriptCode('_SYS.pow(0, 0)')).toBeUndefined();
    expect(foldEmittedJavaScriptCode('_SYS.pow(_.x, 2)')).toBeUndefined();
  });

  it('folds the fixed-power helpers', () => {
    expect(foldEmittedJavaScriptCode('_SYS.pow4(3)')).toBe('81');
    expect(foldEmittedJavaScriptCode('_SYS.pow5(2)')).toBe('32');
  });

  it('folds the factorial and gamma helpers, and declines at a pole', () => {
    expect(foldEmittedJavaScriptCode('_SYS.factorial(5)')).toBe('120');
    // `x!` off the integers is `Γ(x+1)`, so `(−1/2)! = √π`.
    expect(foldEmittedJavaScriptCode('_SYS.factorial(-0.5)')).toBe(
      String(Math.sqrt(Math.PI))
    );
    expect(foldEmittedJavaScriptCode('_SYS.gamma(5)')).toBe('24');
    // Γ has a pole at every non-positive integer, and a negative integer is a
    // pole of `Γ(x+1)`. Both spell it `Infinity`, which has no literal the
    // fold may write, so the call is left to run time.
    expect(foldEmittedJavaScriptCode('_SYS.gamma(0)')).toBeUndefined();
    expect(foldEmittedJavaScriptCode('_SYS.factorial(-2)')).toBeUndefined();
  });

  it('folds a complex routine on a literal complex argument', () => {
    expect(foldEmittedJavaScriptCode('_SYS.csqrt(({ re: (-2), im: 0 }))')).toBe(
      `({ re: 0, im: ${Math.sqrt(2)} })`
    );
    // A real argument stands for the same value with a zero imaginary part.
    expect(foldEmittedJavaScriptCode('_SYS.csqrt(4)')).toBe(
      '({ re: 2, im: 0 })'
    );
    // A live binding, a routine with a hand-written runtime body, and a call
    // standing beside something else all decline.
    expect(
      foldEmittedJavaScriptCode('_SYS.csqrt(({ re: _.x, im: 0 }))')
    ).toBeUndefined();
    expect(
      foldEmittedJavaScriptCode('_SYS.csign(({ re: 2, im: 0 }))')
    ).toBeUndefined();
    expect(
      foldEmittedJavaScriptCode('_SYS.csqrt(4) + _SYS.csqrt(4)')
    ).toBeUndefined();
  });

  it('GLSL: an integer power folds to the value `Math.pow` gives', () => {
    for (const [base, n] of [
      [-1, 1],
      [-1, 2],
      [-2, 3],
      [2, 3],
      [1.5, 4],
      [2, -2],
    ] as const) {
      const folded = foldEmittedGPUCode(
        `pow(${formatFloat(base)}, ${formatFloat(n)})`
      );
      expect(folded).toBeDefined();
      // The fold spells a negative literal with parentheses, so read the
      // number back rather than comparing text.
      expect(Number(folded!.replace(/[()]/g, ''))).toBeCloseTo(
        Math.pow(base, n),
        6
      );
    }
  });
});

describe('a run-time integer exponent over a possibly negative base takes the sign-preserving helper on the shader targets', () => {
  // GLSL and WGSL leave `pow(x, y)` undefined for a negative `x`, so
  // `(-1)^n` with a run-time `n` answered NaN on most drivers where the
  // interpreter answers `±1`. The exponent's TYPE is the gate: `_gpu_powi`
  // computes `pow(abs(x), n)` and negates for an odd `n`, which is right only
  // for an integer `n`; a real exponent keeps `pow`, since a negative base
  // under a fractional power is NaN over the reals as well.
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('p', 'real');
  ce.declare('V', 'vector<3>');
  const gpu = (tex: string, to: 'glsl' | 'wgsl'): string => {
    const r = compile(ce.parse(tex), { to, fallback: false } as any);
    expect(r?.success).toBe(true);
    return r!.code!;
  };
  test.each(['glsl', 'wgsl'] as const)(
    '%s: integer-typed exponents route through _gpu_powi',
    (to) => {
      expect(gpu('(-1)^{n}x', to)).toBe('x * _gpu_powi(-1.0, n)');
      expect(gpu('x^{n}', to)).toBe('_gpu_powi(x, n)');
      expect(gpu('V^{n}', to)).toBe('_gpu_powi3(V, n)');
      expect(gpu('\\sum_{k=1}^{n}(-1)^{k}x', to)).toContain(
        to === 'glsl' ? '_gpu_powi(-1.0, float(k))' : '_gpu_powi(-1.0, f32(k))'
      );
      // A real exponent and a literal fractional one keep `pow`.
      expect(gpu('x^{p}', to)).toBe('pow(x, p)');
      expect(gpu('x^{2.5}', to)).toBe('pow(x, 2.5)');
    }
  );

  // An `integer`-typed exponent may be NEGATIVE, and the two languages
  // disagree on the remainder of a negative operand: GLSL `mod` is floored
  // (`mod(-3.0, 2.0)` is 1.0) while WGSL `%` is truncated (`-3.0 % 2.0` is
  // -1.0). Testing the parity of `abs(n)` makes the odd branch fire in both,
  // so `_gpu_powi(-2.0, -3.0)` is -0.125 on either language.
  test.each(['glsl', 'wgsl'] as const)(
    '%s: the helper tests the parity of abs(n), so a negative odd exponent keeps the sign',
    (to) => {
      const r = compile(ce.parse('x^{n}'), { to, fallback: false } as any);
      expect(r?.success).toBe(true);
      const preamble = String(r!.preamble ?? '');
      expect(preamble).toContain(
        to === 'glsl' ? 'mod(abs(n), 2.0) == 1.0' : '(abs(n) % 2.0) == 1.0'
      );
      // The vector overloads carry the same parity test.
      const v = compile(ce.parse('V^{n}'), { to, fallback: false } as any);
      expect(v?.success).toBe(true);
      expect(String(v!.preamble ?? '')).toContain(
        to === 'glsl' ? 'mod(abs(n), 2.0) == 1.0' : '(abs(n) % 2.0) == 1.0'
      );
      // The emitted call itself is unchanged by the parity fix.
      expect(r!.code).toBe('_gpu_powi(x, n)');
    }
  );

  it('folds `_gpu_powi` only at the exponents the helper turns into products', () => {
    // The helper unrolls n of 0, 2, 3 and 4 into products, and n = 1 returns
    // the operand itself.
    expect(foldEmittedGPUCode('_gpu_powi(-1.0, 3.0)')).toBe('(-1.0)');
    expect(foldEmittedGPUCode('_gpu_powi(-1.0, 1.0)')).toBe('(-1.0)');
    expect(foldEmittedGPUCode('_gpu_powi(-1.0, 2.0)')).toBe('1.0');
    expect(foldEmittedGPUCode('_gpu_powi(2.0, 4.0)')).toBe('16.0');
    expect(foldEmittedGPUCode('_gpu_powi(3.0, 0.0)')).toBe('1.0');
    // Past n = 4, and at every negative exponent, the helper reaches the
    // hardware `pow`, whose value this compiler may not predict.
    expect(foldEmittedGPUCode('_gpu_powi(2.0, 5.0)')).toBeUndefined();
    expect(foldEmittedGPUCode('_gpu_powi(2.0, -2.0)')).toBeUndefined();
    expect(foldEmittedGPUCode('_gpu_powi(-2.0, -3.0)')).toBeUndefined();
  });
});
