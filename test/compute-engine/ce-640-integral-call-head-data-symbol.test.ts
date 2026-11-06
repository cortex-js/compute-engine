import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// ROADMAP CE-640: a call in an integrand whose head is defined as a data symbol
// after the call was boxed. Boxing the integrand again, as the exact route of
// `Integrate` does, gives the `expected-function` error. The numeric route
// sampled the call instead: no sample was a number, so `N()` kept the integral
// unevaluated while `evaluate()` reported the error. `N()` now reports the error
// that `evaluate()` reports. An invalid integrand for which `evaluate()` reports
// no error, because the call is in a branch that is not reached, keeps the value
// of the numeric route.

type Route = 'parse' | 'box';

const PARSED: Record<string, string> = {
  call: '\\int_0^1 g(x)\\,dx',
  sum: '\\int_0^1 (g(x)+1)\\,dx',
  product: '\\int_0^1 x g(x)\\,dx',
  'free coefficient': '\\int_0^1 a g(x)\\,dx',
};

const BOXED: Record<string, unknown> = {
  call: ['Integrate', ['g', 'x'], ['Limits', 'x', 0, 1]],
  sum: ['Integrate', ['Add', ['g', 'x'], 1], ['Limits', 'x', 0, 1]],
  product: ['Integrate', ['Multiply', 'x', ['g', 'x']], ['Limits', 'x', 0, 1]],
  'free coefficient': [
    'Integrate',
    ['Multiply', 'a', ['g', 'x']],
    ['Limits', 'x', 0, 1],
  ],
};

function integral(ce: ComputeEngine, route: Route, name: string): Expression {
  return route === 'parse'
    ? ce.parse(PARSED[name])
    : ce.box(BOXED[name] as Parameters<ComputeEngine['box']>[0]);
}

function defineAsData(ce: ComputeEngine): void {
  ce.declare('g', 'real');
  ce.assign('g', 5);
}

function errorCode(e: Expression): unknown {
  const json = e.json as unknown[];
  expect(json[0]).toBe('Error');
  return json[1];
}

const EXPECTED_FUNCTION = ['ErrorCode', "'expected-function'", "'g'", "'real'"];

describe('CE-640: a call head defined later as a data symbol', () => {
  for (const route of ['parse', 'box'] as const) {
    for (const name of Object.keys(PARSED)) {
      test(`N() reports the error of evaluate(): ${name} (${route} route)`, () => {
        const ce = new ComputeEngine();
        const I = integral(ce, route, name);
        defineAsData(ce);
        const exact = I.evaluate();
        expect(errorCode(exact)).toEqual(EXPECTED_FUNCTION);
        expect(I.N().json).toEqual(exact.json);
      });
    }

    test(`a head declared with no value reports the same error (${route} route)`, () => {
      const ce = new ComputeEngine();
      const I = integral(ce, route, 'call');
      ce.declare('g', 'real');
      expect(errorCode(I.evaluate())).toEqual(EXPECTED_FUNCTION);
      expect(errorCode(I.N())).toEqual(EXPECTED_FUNCTION);
    });
  }

  test('several limits report the same error', () => {
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['Function', ['g', 'x'], 'x', 'y'],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 1],
    ]);
    defineAsData(ce);
    expect(errorCode(I.evaluate())).toEqual(EXPECTED_FUNCTION);
    expect(I.N().json).toEqual(I.evaluate().json);
  });

  test('a branch that the samples reach reports the error', () => {
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['If', ['Greater', 'x', 0.5], ['g', 'x'], 1],
      ['Limits', 'x', 0, 1],
    ]);
    defineAsData(ce);
    expect(errorCode(I.evaluate())).toEqual(EXPECTED_FUNCTION);
    expect(errorCode(I.N())).toEqual(EXPECTED_FUNCTION);
  });

  test('a branch that no sample reaches keeps the value', () => {
    // `x > 2` is false over the bounds, so the call is never evaluated.
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['If', ['Greater', 'x', 2], ['g', 'x'], 1],
      ['Limits', 'x', 0, 1],
    ]);
    defineAsData(ce);
    expect(I.evaluate().json).toEqual(1);
    expect(I.N().re).toBeCloseTo(1, 12);
  });

  test('a branch that no sample reaches keeps the numeric value with no closed form', () => {
    // `x^x` has no antiderivative here, so the exact route keeps the integral
    // unevaluated, and the quadrature gives the value of the integrand that
    // the samples read: the integral of `x^x` over `[0, 1]`.
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['If', ['Greater', 'x', 2], ['g', 'x'], ['Power', 'x', 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    defineAsData(ce);
    expect(I.evaluate().operator).toBe('Integrate');
    expect(I.N().re).toBeCloseTo(0.7834305107, 8);
  });

  for (const route of ['parse', 'box'] as const) {
    test(`a head defined as a function is integrated (${route} route)`, () => {
      const ce = new ComputeEngine();
      const I = integral(ce, route, 'call');
      ce.parse('g(t) \\coloneq t').evaluate();
      expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
      expect(I.N().re).toBeCloseTo(0.5, 12);
    });

    test(`a head with no definition stays unevaluated (${route} route)`, () => {
      const ce = new ComputeEngine();
      const I = integral(ce, route, 'call');
      expect(I.evaluate().operator).toBe('Integrate');
      expect(I.N().operator).toBe('Integrate');
    });

    test(`a data symbol of an inner scope does not hide the function of the outer scope (${route} route)`, () => {
      // The call keeps the binding of the scope it was written in.
      const ce = new ComputeEngine();
      const I = integral(ce, route, 'call');
      ce.parse('g(t) \\coloneq t').evaluate();
      ce.pushScope();
      defineAsData(ce);
      expect(I.evaluate().json).toEqual(['Rational', 1, 2]);
      expect(I.N().re).toBeCloseTo(0.5, 12);
      ce.popScope();
    });
  }

  test('a caller symbol named as the variable, of a type that is not a number, does not matter', () => {
    // The variable is bound by `Integrate`, so the type of the caller's `x`
    // does not make the integrand invalid.
    for (const type of ['string', 'boolean']) {
      const ce = new ComputeEngine();
      const I = ce.parse('\\int_0^1 (x+1)\\,dx');
      ce.declare('x', type);
      expect(I.evaluate().json).toEqual(['Rational', 3, 2]);
      expect(I.N().re).toBeCloseTo(1.5, 12);
    }
  });
});
