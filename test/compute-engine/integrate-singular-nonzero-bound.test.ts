import { ComputeEngine } from '../../src/compute-engine';

// CE-181. A slowly integrable singularity at a bound that is not 0: the
// doubles next to the bound are about 2⁻⁵² apart, so the quadrature cannot
// bisect the corner deep enough, and `.N()` gave `3 ± 36` for
// `∫_{1/2}^1 dt/((1 − t)(−ln(1 − t))^1.1) = 10·(ln 2)^(−0.1)`. The integral is
// now computed again on the two halves of the interval, each written in the
// distance `u` to its bound, with `1 − t` computed as `u`
// (`endpointHalves`, `src/compute-engine/library/calculus.ts`).

const ce = new ComputeEngine();

// 10·(ln 2)^(−0.1)
const EXACT = 10 * Math.pow(Math.LN2, -0.1);

function measurement(json: unknown): [number, number] {
  expect(Array.isArray(json)).toBe(true);
  const [op, value, error] = json as [string, number, number];
  expect(op).toBe('Measurement');
  return [value, error];
}

function nIntegrate(body: string, lower: unknown, upper: unknown): unknown {
  return ce
    .box(['NIntegrate', ['Function', ce.parse(body).json, 't'], lower, upper])
    .evaluate().json;
}

describe('an integral with a logarithmic singularity at a nonzero bound', () => {
  test('the value of the textbook integral is correct, with a small error', () => {
    const [value, error] = measurement(
      ce.parse('\\int_{1/2}^{1} \\frac{dt}{(1-t)(-\\ln(1-t))^{1.1}}').N().json
    );
    expect(error).toBeLessThan(1e-3);
    expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
  });

  test('NIntegrate gives the same value', () => {
    const value = nIntegrate(
      '\\frac{1}{(1-t)(-\\ln(1-t))^{1.1}}',
      ['Rational', 1, 2],
      1
    ) as number;
    expect(Math.abs(value - EXACT)).toBeLessThan(1e-3);
  });

  test('reversed bounds give the negated value', () => {
    const [value, error] = measurement(
      ce.parse('\\int_{1}^{1/2} \\frac{dt}{(1-t)(-\\ln(1-t))^{1.1}}').N().json
    );
    expect(error).toBeLessThan(1e-3);
    expect(Math.abs(value + EXACT)).toBeLessThan(2 * error);
  });

  test('a singular bound at 3 gives the same value', () => {
    const [value, error] = measurement(
      ce.parse('\\int_{5/2}^{3} \\frac{dt}{(3-t)(-\\ln(3-t))^{1.1}}').N().json
    );
    expect(error).toBeLessThan(1e-3);
    expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
  });

  test('a lower singular bound at 1 gives the same value', () => {
    const [value, error] = measurement(
      ce.parse('\\int_{1}^{3/2} \\frac{dt}{(t-1)(-\\ln(t-1))^{1.1}}').N().json
    );
    expect(error).toBeLessThan(1e-3);
    expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
  });

  test('a complex integrand gives the value in its imaginary part', () => {
    const r = ce
      .parse('\\int_{1/2}^{1} \\frac{i}{(1-t)(-\\ln(1-t))^{1.1}}dt')
      .N();
    expect(Math.abs(r.im - EXACT)).toBeLessThan(1e-3);
    expect(Math.abs(r.re)).toBeLessThan(1e-3);
  });

  test('the divergent integral is +∞ on both routes', () => {
    expect(
      ce.parse('\\int_{1/2}^{1} \\frac{-1}{(1-t)\\ln(1-t)}dt').N().json
    ).toEqual('PositiveInfinity');
    expect(
      nIntegrate('\\frac{-1}{(1-t)\\ln(1-t)}', ['Rational', 1, 2], 1)
    ).toEqual('PositiveInfinity');
  });

  test('a false divergence of a half keeps the first result', () => {
    // ∫_{1/2}^1 dt/((1 − t)(−ln(1 − t))^1.001) = 1000·(ln 2)^(−0.001) ≈
    // 1000.37 converges. A half of the interval is divergent for the
    // divergence test, and nothing confirms it: the result is the first one,
    // with its wide error, not `NaN`.
    const exact = 1000 * Math.pow(Math.LN2, -0.001);
    const [value, error] = measurement(
      ce.parse('\\int_{1/2}^{1} \\frac{dt}{(1-t)(-\\ln(1-t))^{1.001}}').N().json
    );
    expect(Math.abs(value - exact)).toBeLessThan(error);
    const n = nIntegrate(
      '\\frac{1}{(1-t)(-\\ln(1-t))^{1.001}}',
      ['Rational', 1, 2],
      1
    );
    expect(Number.isFinite(n as number)).toBe(true);
  });

  test('a complex bound integrates over the real part, as before', () => {
    // The quadrature integrates over the real parts of the bounds.
    const body = '\\frac{1}{(1-t)(-\\ln(1-t))^{1.1}}';
    const value = nIntegrate(
      body,
      ['Add', ['Rational', 1, 2], 'ImaginaryUnit'],
      1
    ) as number;
    expect(value).toBeCloseTo(
      nIntegrate(body, ['Rational', 1, 2], 1) as number,
      9
    );
  });

  test('an integrand that does not compile is split too', () => {
    // An operator with only a JavaScript `evaluate` handler does not compile.
    const engine = new ComputeEngine();
    engine.declare('SlowLog', {
      signature: '(number) -> number',
      evaluate: ([x], { engine }) =>
        x.isNumberLiteral
          ? engine.number(1 / (x.re * Math.pow(-Math.log(x.re), 1.1)))
          : undefined,
    });
    const [value, error] = measurement(
      engine.parse('\\int_{1/2}^{1} \\operatorname{SlowLog}(1-t)\\,dt').N()
        .json
    );
    expect(error).toBeLessThan(1e-2);
    expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
  });

  test('the halves use the parameter of the literal, whatever its name', () => {
    // `i` names the imaginary unit outside the literal. The halves declare
    // no symbol in the scope of the caller.
    const engine = new ComputeEngine();
    const body = (v: string) => [
      'Divide',
      1,
      [
        'Multiply',
        ['Subtract', 1, v],
        ['Power', ['Negate', ['Ln', ['Subtract', 1, v]]], 1.1],
      ],
    ];
    for (const v of ['i', 'w']) {
      const value = engine
        .box(['NIntegrate', ['Function', body(v), v], ['Rational', 1, 2], 1])
        .evaluate().json as number;
      expect(Math.abs(value - EXACT)).toBeLessThan(1e-3);
    }
    expect(engine.lookupDefinition('w')).toBeUndefined();
  });

  test('a call of a user function keeps its binding in the halves', () => {
    const engine = new ComputeEngine();
    engine.declare('g', {
      type: 'function',
      value: [
        'Function',
        ['Divide', 1, ['Multiply', 'x', ['Power', ['Negate', ['Ln', 'x']], 1.1]]],
        'x',
      ],
    });
    const integral = engine.parse('\\int_{1/2}^{1} g(1-t)\\,dt');
    // Another `g` in the scope of the evaluation is not the `g` of the
    // integrand.
    engine.pushScope();
    try {
      engine.declare('g', { type: 'function', value: ['Function', 1, 'x'] });
      const [value, error] = measurement(integral.N().json);
      expect(error).toBeLessThan(1e-3);
      expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
    } finally {
      engine.popScope();
    }
  });

  test('a singularity at 0 keeps its value', () => {
    const [value, error] = measurement(
      ce.parse('\\int_0^{1/2} \\frac{dt}{t(-\\ln t)^{1.1}}').N().json
    );
    expect(error).toBeLessThan(1e-3);
    expect(Math.abs(value - EXACT)).toBeLessThan(2 * error);
  });
});
