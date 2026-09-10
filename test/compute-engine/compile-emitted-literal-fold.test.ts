import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  foldEmittedJavaScriptCode,
  foldEmittedGPUCode,
  formatFloat,
} from '../../src/compute-engine/compilation/constant-folding';

/**
 * Literal arithmetic left in the EMITTED code, folded by the target-owned
 * emitted-code fold (`CompileTarget.foldEmittedConstant`).
 *
 * A `Sum`/`Product` with literal bounds is unrolled by substituting the index
 * at the VARIABLE level, so the expression tree is never rewritten and no
 * tree-level fold can see the literal arithmetic the substitution creates.
 * Every unrolled term therefore carried `(1 + -0.5)`, `0.025 * (1 + -0.5)` and
 * `_SYS.pow2(0.025 * (1 + -0.5))` — measured at 35.9 KB of JavaScript preamble
 * for one 20-term sum by the Tycho code-generation audit of 2026-09-08.
 *
 * The fold reads the emitted code and evaluates exactly the operations that
 * code names, in the same order and with the same rounding, so a folded
 * literal is the value the code would have computed at run time. On the shader
 * targets every step rounds to single precision, which is what makes the
 * folded literal bit-identical to the shader's own arithmetic.
 */

/** The emitted artifact, preamble included. */
function source(r: { preamble?: string; code?: string }): string {
  return (r.preamble ?? '') + (r.code ?? '');
}

/** The exoplanet shape of the audit, with a free `s` so the whole sum cannot
 * fold at the tree level and the unrolled terms are visible. */
const SUM_LATEX = '\\sum_{i=1}^{20}\\sqrt{s-(0.025(i-0.5))^2}';

/** The same sum with no free symbol: the tree-level fold owns this one. */
const CLOSED_SUM_LATEX = '\\sum_{i=1}^{20}\\sqrt{1-(0.025(i-0.5))^2}';

/** A substituted index left beside a literal: `(1 + -0.5)`, `(1.0 + -0.5)`. */
const UNFOLDED_TERM = /\(\d+(?:\.\d+)? \+ -0\.5\)/;

describe('the emitted-code folder', () => {
  describe('JavaScript', () => {
    it('folds a closed literal expression', () => {
      expect(foldEmittedJavaScriptCode('(1 + -0.5)')).toBe('0.5');
      expect(foldEmittedJavaScriptCode('0.025 * (1 + -0.5)')).toBe('0.0125');
      expect(
        foldEmittedJavaScriptCode(
          '-Math.sqrt(-_SYS.pow2(0.025 * (1 + -0.5)) + 1) + 1'
        )
      ).toBe(String(-Math.sqrt(-(0.0125 * 0.0125) + 1) + 1));
    });

    it('folds the LEADING run of a multiplicative chain', () => {
      expect(foldEmittedJavaScriptCode('2 * Math.PI * _.s')).toBe(
        `${2 * Math.PI} * _.s`
      );
      // The run keeps the source's own order, so a `/` inside it is the same
      // division at the same point: `((2 * 3) / 7) * x`.
      expect(foldEmittedJavaScriptCode('2 * 3 / 7 * _.x')).toBe(
        `${(2 * 3) / 7} * _.x`
      );
    });

    it('leaves a chain whose FIRST operand is not literal', () => {
      // Folding `(2 * Math.PI * s) / 100` to `0.0628… * s` would divide before
      // multiplying, which is not the rounding the code has.
      expect(
        foldEmittedJavaScriptCode('(2 * Math.PI * _.s) / 100')
      ).toBeUndefined();
    });

    it('keeps the sign of a negative zero', () => {
      expect(foldEmittedJavaScriptCode('-1 * 0')).toBe('-0');
    });

    it('parenthesizes a negative result the code did not start negative', () => {
      expect(foldEmittedJavaScriptCode('(1 - 4)')).toBe('(-3)');
      expect(foldEmittedJavaScriptCode('2 * -3 * _.x')).toBe('(-6) * _.x');
      // Already negative-leading: nothing can glue to it that could not glue
      // to the code it replaces.
      expect(foldEmittedJavaScriptCode('-2 * 3')).toBe('-6');
    });

    it('declines an impure routine', () => {
      expect(foldEmittedJavaScriptCode('Math.random() * 2')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('2 * Math.random()')).toBeUndefined();
    });

    it('declines a free symbol, a temporary and a caller splice', () => {
      expect(foldEmittedJavaScriptCode('_.x + 1')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('_cse1 * 2')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('x * 2')).toBeUndefined();
      expect(
        foldEmittedJavaScriptCode('(_tv1 === _tv1 && 1 === 1)')
      ).toBeUndefined();
    });

    it('declines a non-finite result', () => {
      expect(foldEmittedJavaScriptCode('1 / 0')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('-1 / 0')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('0 / 0')).toBeUndefined();
    });

    it('declines code that applies nothing', () => {
      expect(foldEmittedJavaScriptCode('0.5')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('-0.5')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('Math.PI')).toBeUndefined();
    });

    it('declines where the literal would bind to what follows', () => {
      expect(foldEmittedJavaScriptCode('(1 + 2).toFixed(2)')).toBeUndefined();
      expect(foldEmittedJavaScriptCode('2 * 3 ** _.x')).toBeUndefined();
    });

    it('leaves a caller `vars` splice in place', () => {
      // The splice is spelled entirely in the folder's own grammar, but the
      // `vars` contract says a mapped symbol is a live binding: a fold that
      // would consume the splice is refused, one that merely stands next to it
      // is not.
      expect(
        foldEmittedJavaScriptCode('Math.sin(6 * Math.PI/4)', ['Math.PI/4'])
      ).toBeUndefined();
      expect(foldEmittedJavaScriptCode('2 * Math.PI * _.s', ['_.s'])).toBe(
        `${2 * Math.PI} * _.s`
      );
    });
  });

  describe('GLSL / WGSL', () => {
    it('folds with single-precision rounding at every step', () => {
      // What the shader computes for `_gpu_pow2(0.025 * (1.0 + -0.5))`.
      const half = Math.fround(Math.fround(0.025) * Math.fround(0.5));
      expect(foldEmittedGPUCode('_gpu_pow2(0.025 * (1.0 + -0.5))')).toBe(
        formatFloat(Math.fround(half * half))
      );
      expect(foldEmittedGPUCode('2.0 * 3.14159265359 * w')).toBe(
        `${formatFloat(Math.fround(2 * Math.fround(3.14159265359)))} * w`
      );
      expect(foldEmittedGPUCode('sqrt(2.0)')).toBe(
        formatFloat(Math.fround(Math.sqrt(2)))
      );
    });

    it('spells every folded literal as a float', () => {
      expect(foldEmittedGPUCode('2.0 * 3.0 * w')).toBe('6.0 * w');
      expect(foldEmittedGPUCode('(1.0 - 4.0)')).toBe('(-3.0)');
      expect(foldEmittedGPUCode('-1.0 * 0.0')).toBe('-0.0');
    });

    it('declines a bare integer literal, which marks an integer context', () => {
      // Shader float literals always carry a decimal point, so `1 + 2` is a
      // loop bound or an index — where `3.0` would not even be the same type.
      expect(foldEmittedGPUCode('1 + 2')).toBeUndefined();
    });

    it('declines a transcendental, whose shader value is the driver’s', () => {
      expect(foldEmittedGPUCode('sin(2.0)')).toBeUndefined();
      expect(foldEmittedGPUCode('exp(1.0)')).toBeUndefined();
      // A FRACTIONAL exponent is the driver's `exp2(y·log2(x))` too.
      expect(foldEmittedGPUCode('pow(2.0, 0.5)')).toBeUndefined();
      // Past the repeated-multiplication range the GPU target's own lowering
      // reaches the hardware `pow` as well, so the fold stops there.
      expect(foldEmittedGPUCode('pow(2.0, 9.0)')).toBeUndefined();
      // `0^0` is left to the hardware by the GPU target (it has no NaN
      // literal to spell the interpreter's indeterminate value with), so the
      // fold does not decide it either.
      expect(foldEmittedGPUCode('pow(0.0, 0.0)')).toBeUndefined();
    });

    it('folds an integer power, which the shader `pow` gets WRONG', () => {
      // Both shader languages define `pow(x, y)` as `exp2(y·log2(x))`, which
      // is undefined for a negative base: `pow(-1.0, 1.0)` answers NaN on most
      // drivers. The GPU target never writes `pow` for a literal integer
      // exponent for that reason; such a call only appears when a `Sum` unroll
      // substitutes its index AFTER the tree was compiled. Folding to repeated
      // multiplication is the value the target's own lowering would give.
      expect(foldEmittedGPUCode('pow(-1.0, 1.0)')).toBe('(-1.0)');
      expect(foldEmittedGPUCode('pow(-1.0, 2.0)')).toBe('1.0');
      expect(foldEmittedGPUCode('pow(-2.0, 3.0)')).toBe('(-8.0)');
      expect(foldEmittedGPUCode('pow(2.0, 3.0)')).toBe('8.0');
      expect(foldEmittedGPUCode('pow(2.0, -2.0)')).toBe('0.25');
    });

    it('declines the vector overload of a fixed-power helper', () => {
      expect(foldEmittedGPUCode('_gpu_pow2_v2(v)')).toBeUndefined();
    });

    it('declines a non-finite result', () => {
      expect(foldEmittedGPUCode('1.0 / 0.0')).toBeUndefined();
    });
  });
});

describe('an unrolled Sum leaves no literal arithmetic', () => {
  it('JavaScript: no substituted index survives, and the value is unchanged', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(SUM_LATEX);
    const r = compile(expr, { to: 'javascript', fallback: false });
    const js = source(r);
    expect(js).not.toMatch(UNFOLDED_TERM);
    expect(js).not.toMatch(/_SYS\.pow2\(/);
    expect(r.run!({ s: 1 })).toBe(expr.subs({ s: 1 }).N().re);
  });

  it('JavaScript: the closed form of the same sum agrees with `.N()`', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(CLOSED_SUM_LATEX);
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(source(r)).not.toMatch(UNFOLDED_TERM);
    expect(r.run!()).toBe(expr.N().re);
  });

  it('GLSL: no substituted index survives', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse(SUM_LATEX), { to: 'glsl', fallback: false });
    const glsl = source(r);
    expect(glsl).not.toMatch(UNFOLDED_TERM);
    expect(glsl).not.toMatch(/_gpu_pow2\(/);
    // The first term, computed the way the shader would compute it.
    const half = Math.fround(Math.fround(0.025) * Math.fround(0.5));
    expect(glsl).toContain(`-${formatFloat(Math.fround(half * half))} + s`);
  });

  it('WGSL: no substituted index survives', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse(SUM_LATEX), { to: 'wgsl', fallback: false });
    expect(source(r)).not.toMatch(UNFOLDED_TERM);
  });

  it('folds the literal arguments of a user-function call', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('(x, y) \\mapsto x^2 + y'));
    const r = compile(ce.parse('\\sum_{i=1}^{3} f(0.1 i, s)'), {
      to: 'javascript',
      fallback: false,
    });
    const js = source(r);
    expect(js).not.toMatch(/0\.1 \* [123]/);
    expect(js).toContain(String(0.1 * 3));
  });
});

describe('the emitted fold declines where it must', () => {
  it('leaves the body of a loop-form Sum, whose index is a variable', () => {
    // The bound is symbolic, so the body is emitted ONCE with the index as a
    // real identifier. The folder reads an identifier it does not know and
    // stops — the arithmetic around it has to stay.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sum_{i=1}^{n}(0.025(i-0.5))');
    expect(
      source(compile(expr, { to: 'javascript', fallback: false }))
    ).toMatch(/0\.025 \* \(i \+ -0\.5\)/);
    expect(source(compile(expr, { to: 'glsl', fallback: false }))).toMatch(
      /0\.025 \* \(float\(i\) \+ -0\.5\)/
    );
  });

  it('is off under `constantFold: false`', () => {
    // The code-generation suites inspect the structural lowering of a
    // constant, which this fold would erase.
    const ce = new ComputeEngine();
    const expr = ce.parse(SUM_LATEX);
    expect(
      source(
        compile(expr, {
          to: 'javascript',
          fallback: false,
          constantFold: false,
        })
      )
    ).toMatch(/_SYS\.pow2\(0\.025 \* \(1 \+ -0\.5\)\)/);
    expect(
      source(
        compile(expr, { to: 'glsl', fallback: false, constantFold: false })
      )
    ).toMatch(/_gpu_pow2\(0\.025 \* \(1\.0 \+ -0\.5\)\)/);
  });

  it('keeps a caller `vars` splice out of the fold', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sin(6u)'), {
      to: 'javascript',
      fallback: false,
      vars: { u: 'Math.PI/4' },
    });
    expect(source(r)).toContain('Math.PI/4');
  });
});
