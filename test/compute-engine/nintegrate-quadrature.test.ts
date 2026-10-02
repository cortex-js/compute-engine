import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * `NIntegrate(f, a, b)` uses the same methods, in the same order, as
 * `Integrate(f, x, a, b).N()` (user decision 2026-10-01): the oscillatory
 * quadrature on a semi-infinite interval, then the adaptive Gauss–Kronrod
 * quadrature, `NaN` for a divergent integral, and Monte Carlo only when the
 * quadrature does not converge. Before this decision `NIntegrate` always
 * sampled, and `NIntegrate(x ↦ x², 0, 1)` gave `0.333422`.
 *
 * The reference values were computed independently with mpmath at 30 digits.
 */

const ce = new ComputeEngine();

const nIntegrate = (body: unknown, a: unknown, b: unknown, engine = ce) =>
  engine.box(['NIntegrate', ['Function', body, 'x'], a, b] as any).evaluate();

/** Count the draws of the derived random sub-streams during `fn`. */
function drawsDuring(engine: ComputeEngine, fn: () => unknown): number {
  let draws = 0;
  const proto = Object.getPrototypeOf(engine) as {
    _substream: (tag: number) => () => number;
  };
  const original = proto._substream;
  proto._substream = function (this: ComputeEngine, tag: number) {
    const stream = original.call(this, tag);
    return () => {
      draws += 1;
      return stream();
    };
  };
  try {
    fn();
  } finally {
    proto._substream = original;
  }
  return draws;
}

describe('NIntegrate uses quadrature first', () => {
  test('a smooth integrand: ∫₀¹ x² dx = 1/3', () => {
    let r: any;
    const draws = drawsDuring(ce, () => {
      r = nIntegrate(['Power', 'x', 2], 0, 1);
    });
    expect(r.re).toBeCloseTo(1 / 3, 15);
    expect(r.im).toBe(0);
    // The quadrature converged: no sample was drawn.
    expect(draws).toBe(0);
  });

  test('the result is a plain number, not a Measurement', () => {
    const r = nIntegrate(['Power', 'x', 2], 0, 1);
    expect(isNumber(r)).toBe(true);
    expect(r.operator).not.toBe('Measurement');
  });

  test('an endpoint singularity: ∫₀¹ x^(−1/2) dx = 2', () => {
    const r = nIntegrate(['Power', 'x', ['Rational', -1, 2]], 0, 1);
    expect(r.re).toBeCloseTo(2, 9);
  });

  test('a semi-infinite interval: ∫₀^∞ e^(−x) dx = 1', () => {
    const r = nIntegrate(['Exp', ['Negate', 'x']], 0, 'PositiveInfinity');
    expect(r.re).toBeCloseTo(1, 12);
  });

  test('an oscillatory semi-infinite integrand: ∫₀^∞ sin(x)/x dx = π/2', () => {
    const r = nIntegrate(['Divide', ['Sin', 'x'], 'x'], 0, 'PositiveInfinity');
    expect(r.re).toBeCloseTo(Math.PI / 2, 6);
  });

  test('a divergent integral: ∫₀¹ 1/x dx is +oo', () => {
    // The pole at the bound 0 gives the sign of the divergence: `1/x` is
    // positive on `(0, 1]`.
    let r: any;
    const draws = drawsDuring(ce, () => {
      r = nIntegrate(['Divide', 1, 'x'], 0, 1);
    });
    expect(r.toString()).toBe('+oo');
    // A diagnosed divergence skips the Monte-Carlo fallback.
    expect(draws).toBe(0);
  });

  test('a divergent integral with no sign: ∫₀¹ (1/x − 1/(1 − x)) dx is NaN', () => {
    // `+∞` at the bound 0, `−∞` at the bound 1: the integral has no value.
    let r: any;
    const draws = drawsDuring(ce, () => {
      r = nIntegrate(
        ['Subtract', ['Divide', 1, 'x'], ['Divide', 1, ['Subtract', 1, 'x']]],
        0,
        1
      );
    });
    expect(r.isNaN).toBe(true);
    expect(draws).toBe(0);
  });

  test('a pole strictly inside the bounds: ∫₀² 1/(x−1)² dx = +∞', () => {
    const r = nIntegrate(['Power', ['Subtract', 'x', 1], -2], 0, 2);
    expect(r.re).toBe(Infinity);
  });

  test('a complex-valued integrand: ∫₀^π e^(ix) dx = 2i', () => {
    const r = nIntegrate(['Exp', ['Multiply', 'ImaginaryUnit', 'x']], 0, 'Pi');
    expect(r.re).toBeCloseTo(0, 12);
    expect(r.im).toBeCloseTo(2, 12);
  });

  test('an interpreted integrand: ∫₀¹ x² dx = 1/3 with jit off', () => {
    const engine = new ComputeEngine();
    engine.jit = 'off';
    let r: any;
    const draws = drawsDuring(engine, () => {
      r = nIntegrate(['Power', 'x', 2], 0, 1, engine);
    });
    expect(r.re).toBeCloseTo(1 / 3, 14);
    expect(draws).toBe(0);
  });

  test('a quadrature that does not converge falls back to sampling', () => {
    // ∫₀¹ sin(1/x)/√x dx = ∫₁^∞ sin(u)·u^(−3/2) du ≈ 0.5714732926. The
    // integrand oscillates infinitely often near 0, so the quadrature does
    // not converge. With jit off the fallback draws 1e4 samples, which keeps
    // the test cheap; the estimate has about 1e-2 relative error.
    const engine = new ComputeEngine();
    engine.jit = 'off';
    let r: any;
    const draws = drawsDuring(engine, () => {
      r = engine
        .box([
          'WithRandomSeed',
          1,
          [
            'NIntegrate',
            [
              'Function',
              ['Divide', ['Sin', ['Divide', 1, 'x']], ['Sqrt', 'x']],
              'x',
            ],
            0,
            1,
          ],
        ])
        .N();
    });
    expect(draws).toBeGreaterThan(0);
    expect(Math.abs(r.re - 0.5714732926)).toBeLessThan(0.1);
  });
});

/**
 * The interior-pole check examines the function that the quadrature
 * integrates. The compiled integrand reads the value of an assigned symbol,
 * so the check substitutes those values too: with `q := 1`, the pole of
 * `(y − q)⁻²` is at `y = 1`. Before, the check saw a denominator with a
 * second free symbol, gave no verdict, and the quadrature fell back to
 * unseeded sampling (`NIntegrate` gave `13931349`, then `36076471`).
 */
describe('The interior-pole check reads the values of assigned symbols', () => {
  const engine = new ComputeEngine();
  engine.assign('q', 1);
  const body = ['Power', ['Subtract', 'y', 'q'], -2];

  test('NIntegrate(y ↦ (y − q)⁻², 0, 2) with q := 1 is +∞', () => {
    let r: any;
    const draws = drawsDuring(engine, () => {
      r = engine
        .box(['NIntegrate', ['Function', body, 'y'], 0, 2] as any)
        .evaluate();
    });
    expect(r.re).toBe(Infinity);
    expect(draws).toBe(0);
  });

  test('Integrate((y − q)⁻², y, 0, 2).N() with q := 1 is +∞', () => {
    let r: any;
    const draws = drawsDuring(engine, () => {
      r = engine.box(['Integrate', body, ['Limits', 'y', 0, 2]] as any).N();
    });
    expect(r.re).toBe(Infinity);
    expect(draws).toBe(0);
  });

  test('Integrate((y − q)⁻², y, 0, 2).evaluate() with q := 1 is +∞', () => {
    // Before, the antiderivative was differenced across the pole: `-2`.
    const r = engine
      .box(['Integrate', body, ['Limits', 'y', 0, 2]] as any)
      .evaluate();
    expect(r.re).toBe(Infinity);
  });

  test('the iterated form with q := 1 is +∞', () => {
    const r = engine
      .box([
        'Integrate',
        body,
        ['Limits', 'y', 0, 2],
        ['Limits', 'x', 0, 2],
      ] as any)
      .N();
    expect(r.re).toBe(Infinity);
  });

  test('a new value of q moves the pole', () => {
    const local = new ComputeEngine();
    local.assign('q', 3);
    // ∫₀² (y − 3)⁻² dy = 1/(3 − 2) − 1/3 = 2/3: the pole is outside.
    const r = local
      .box(['NIntegrate', ['Function', body, 'y'], 0, 2] as any)
      .evaluate();
    expect(r.re).toBeCloseTo(2 / 3, 12);
  });

  test('a symbol with no value is not substituted', () => {
    // As before: no verdict from the pole check, `NaN` from `NIntegrate`,
    // and `Integrate(…).N()` stays inert.
    const w = ['Power', ['Subtract', 'y', 'w'], -2];
    const n = engine
      .box(['NIntegrate', ['Function', w, 'y'], 0, 2] as any)
      .evaluate();
    expect(n.isNaN).toBe(true);
    const i = engine.box(['Integrate', w, ['Limits', 'y', 0, 2]] as any).N();
    expect(i.operator).toBe('Integrate');
  });
});

/**
 * A function given by its name. Before, the compiled integrand returned the
 * function itself instead of its value, so every sample was `NaN`
 * (`NIntegrate(Sin, 0, 2)` was `NaN`), and the interior-pole check did not
 * run.
 */
describe('NIntegrate of a function given by its name', () => {
  const named = (name: string, a: number, b: number, engine = ce) =>
    engine.box(['NIntegrate', name, a, b] as any).evaluate();

  test('NIntegrate(Sin, 0, 2) = 1 − cos 2', () => {
    expect(named('Sin', 0, 2).re).toBeCloseTo(1 - Math.cos(2), 12);
  });

  test('NIntegrate(Tan, 0, 1.5) = −ln cos 1.5 (no pole inside)', () => {
    expect(named('Tan', 0, 1.5).re).toBeCloseTo(-Math.log(Math.cos(1.5)), 10);
  });

  test('NIntegrate(Tan, 0, 3) is NaN: tan changes sign at π/2', () => {
    let r: any;
    const draws = drawsDuring(ce, () => {
      r = named('Tan', 0, 3);
    });
    expect(r.isNaN).toBe(true);
    expect(draws).toBe(0);
  });

  test('NIntegrate(Sec, 0, 2) is NaN: sec changes sign at π/2', () => {
    expect(named('Sec', 0, 2).isNaN).toBe(true);
  });

  test('a user function with a one-sign pole: g := x ↦ 1/x²', () => {
    const engine = new ComputeEngine();
    engine.declare('g', 'function');
    engine.assign('g', engine.parse('x \\mapsto 1/x^2'));
    expect(named('g', -1, 2, engine).re).toBe(Infinity);
    // ∫₁² x⁻² dx = 1/2: no pole inside.
    expect(named('g', 1, 2, engine).re).toBeCloseTo(0.5, 12);
  });

  test('a declared operator with a one-sign pole: h(x) = 1/x²', () => {
    const engine = new ComputeEngine();
    engine.declare('h', {
      signature: '(real) -> real',
      evaluate: engine.parse('x \\mapsto 1/x^2'),
    } as any);
    expect(named('h', -1, 2, engine).re).toBe(Infinity);
  });
});
