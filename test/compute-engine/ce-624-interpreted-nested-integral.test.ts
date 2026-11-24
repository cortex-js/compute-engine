import { ComputeEngine } from '../../src/compute-engine';

// CE-624: with `jit = 'off'` the interpreter evaluates each sample of an
// integrand. When the integrand calls a function whose body is an integral
// with no closed form, the exact evaluation of a sample is an `Integrate`
// expression, not a number. For a pure integrand, its numeric value (`.N()`)
// computes the inner integral by quadrature, and the later samples are
// evaluated once each with a numeric request. An impure integrand is not
// evaluated a second time at a point.

/** `g(y) := ∫₀¹ e^(−x²y)·cos(x) dx` has no closed form in `x`. */
function engineWithG(jit: 'auto' | 'off'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.jit = jit;
  ce.parse('g(y)\\coloneq\\int_0^1 e^{-x^2y}\\cos(x)\\,dx').evaluate();
  return ce;
}

// Each interpreted integral below takes a few seconds.
const TIMEOUT = 60_000;

describe('CE-624: an interpreted integral of a function defined by an integral', () => {
  test(
    '∫₀¹ g(y) dy has the value of the compiled route',
    () => {
      const compiled = engineWithG('auto').parse('\\int_0^1 g(y)\\,dy').N().re;
      expect(compiled).toBeCloseTo(0.7407973366376666, 12);

      const interpreted = engineWithG('off').parse('\\int_0^1 g(y)\\,dy').N();
      expect(interpreted.re).toBeCloseTo(compiled, 12);
    },
    TIMEOUT
  );

  test(
    'NIntegrate of the same integrand',
    () => {
      const ce = engineWithG('off');
      const r = ce
        .expr(['NIntegrate', ['Function', ['g', 'y'], 'y'], 0, 1])
        .N();
      expect(r.re).toBeCloseTo(0.7407973366376666, 12);
    },
    TIMEOUT
  );

  test(
    'an impure integrand runs once at each point',
    () => {
      const ce = engineWithG('off');
      const points: number[] = [];
      ce.declare('h', {
        signature: '(real) -> real',
        pure: false,
        evaluate: ([y]) => {
          points.push(y.re);
          return ce.function('g', [y]).evaluate();
        },
      });
      ce.expr(['NIntegrate', ['Function', ['h', 'y'], 'y'], 0, 1]).N();
      expect(points.length).toBeGreaterThan(0);
      expect(new Set(points).size).toBe(points.length);
    },
    TIMEOUT
  );
});
