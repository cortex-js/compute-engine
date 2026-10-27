import {
  ComputeEngine,
  factor,
  factorDetailed,
  expand,
  CancellationError,
  type FactorOptions,
} from '../../src/compute-engine';
import {
  factor as coreFactor,
  factorDetailed as coreFactorDetailed,
} from '../../src/core';

describe('Public factoring convenience and diagnostic APIs', () => {
  const g = ['AlgebraicGenerator', ['List', -2, 0, 1]] as const;

  test('retains the direct-method failure preceding a norm-limit refusal', () => {
    const r = factorDetailed('x^4-2', {
      variable: 'x',
      generator: g,
      maxNumberFieldLifts: 0,
      maxNormDegree: 0,
      profile: true,
    });
    expect(r.status).toBe('incomplete');
    if (r.status !== 'incomplete') throw Error('Expected bounded refusal');
    expect(r.reason).toBe('norm-degree-limit');
    expect(r.stage).toBe('factorization');
    expect(r.statistics?.direct?.[0].fallback).toBe('number-field-lift-limit');
    expect(r.statistics?.norms).toBe(0);
    expect('factors' in r).toBe(false);
  });

  test('exports the same helpers from the core entry point', () => {
    expect(coreFactor).toBe(factor);
    expect(coreFactorDetailed).toBe(factorDetailed);
    expect(
      coreFactorDetailed(['Add', ['Power', 'x', 2], -2], {
        variable: 'x',
        generator: g,
      }).status
    ).toBe('complete');
  });

  test('public diagnostics propagate the owning engine deadline', () => {
    const ce = new ComputeEngine();
    const p = ce.parse('x^4+5x^2+4');
    expect(() =>
      ce.withTimeLimit(0, () => factorDetailed(p, { variable: 'x' }))
    ).toThrow(CancellationError);
    expect(() =>
      ce.withTimeLimit(0, () =>
        factorDetailed(p, { variable: 'x', generator: g })
      )
    ).toThrow(CancellationError);
  });

  test('keeps the existing single-argument and strict parsing calls', () => {
    expect(factor('x^2-1').operator).toBe('Multiply');
    expect(factor('x^23', { strict: true }).json).toEqual([
      'Multiply',
      3,
      ['Power', 'x', 2],
    ]);
  });

  test('reads high-degree monomials without exhausting the conversion budget', () => {
    // A complete repeated-factor result requires reading the expanded input,
    // not just preserving the factorization already present in the request.
    const ce = new ComputeEngine();
    const p = expand(ce.expr(['Power', ['Add', ['Power', 'x', 8], 1], 12]));
    const result = factorDetailed(p, { variable: 'x', generator: g });
    expect(result.status).toBe('complete');
    if (result.status === 'complete') {
      expect(result.factors.every((f) => f.multiplicity === 12)).toBe(true);
      expect(expand(result.expression).isSame(p)).toBe(true);
    }
    const bounded = factorDetailed(p, {
      variable: 'x',
      generator: g,
      maxDegree: 64,
    });
    expect(bounded.status).toBe('incomplete');
    if (bounded.status === 'incomplete')
      expect(bounded.stage).toBe('conversion');
  });

  test.each(['sqrt(2)', ['Sqrt', 2] as const, g])(
    'matches Factor for generator %j',
    (generator) => {
      const ce = new ComputeEngine();
      const p = ce.parse('x^2-2');
      const chosen =
        typeof generator === 'string'
          ? ce.parse(generator, { strict: false })
          : ce.expr(generator);
      const result = factor(p, { variable: 'x', generator });
      expect(result.engine).toBe(ce);
      expect(
        result.isSame(ce.expr(['Factor', p, 'x', chosen]).evaluate())
      ).toBe(true);
      const detailed = factorDetailed(p, { variable: 'x', generator });
      expect(detailed.status).toBe('complete');
      expect(detailed.expression.isSame(result)).toBe(true);
    }
  );

  test('returns rational scalar content, irreducible factors and multiplicities', () => {
    const r = factorDetailed('(2x+1)^3*(x^2+1)/6', {
      variable: 'x',
      profile: true,
    });
    expect(r.status).toBe('complete');
    if (r.status !== 'complete') throw Error('Expected complete factorization');
    expect(r.coefficient.json).toEqual(['Rational', 1, 6]);
    expect(r.factors.map((f) => f.multiplicity).sort()).toEqual([1, 3]);
    expect(r.statistics?.operations).toBeGreaterThan(0);
    expect(r.statistics?.phases).toBeDefined();
    expect(
      expand(r.expression).isSame(
        expand(r.expression.engine.parse('(2x+1)^3*(x^2+1)/6'))
      )
    ).toBe(true);
  });

  test('irreducible, constant and zero results are distinguished', () => {
    const irreducible = factorDetailed('x^2+1', { variable: 'x' });
    expect(irreducible.status).toBe('complete');
    if (irreducible.status === 'complete')
      expect(irreducible.factors).toHaveLength(1);
    const constant = factorDetailed(7);
    expect(constant.status).toBe('complete');
    if (constant.status === 'complete') expect(constant.factors).toEqual([]);
    const zero = factorDetailed(0, { variable: 'x', generator: g });
    expect(zero.status).toBe('zero');
    if (zero.status === 'zero') expect(zero.factors).toEqual([]);
  });

  test('preserves exact complex coefficients and repeated factors', () => {
    const r = factorDetailed('(x^2+1)^2', { variable: 'x', generator: 'i' });
    expect(r.status).toBe('complete');
    if (r.status === 'complete') {
      expect(r.factors).toHaveLength(2);
      expect(r.factors.every((f) => f.multiplicity === 2)).toBe(true);
    }
  });

  test.each([undefined, g])(
    'reports a budget refusal without exposing partial factors (%j)',
    (generator) => {
      const options: FactorOptions = {
        variable: 'x',
        generator,
        maxOperations: 1,
      };
      const r = factorDetailed('x^4+5x^2+4', options);
      expect(r.status).toBe('incomplete');
      expect('factors' in r).toBe(false);
      expect(r.expression.operator).toBe('Factor');
      expect(factor('x^4+5x^2+4', options).operator).toBe('Factor');
    }
  );

  test('classifies unsupported input and invalid defining relations', () => {
    expect(factorDetailed('sin(x)', { variable: 'x' }).status).toBe(
      'unsupported'
    );
    expect(factorDetailed('x+y', { variable: 'x', generator: g }).status).toBe(
      'unsupported'
    );
    expect(
      factorDetailed('x^2-2', { variable: 'x', generator: 'pi' }).status
    ).toBe('unsupported');
    expect(
      factorDetailed('x^2-2', {
        variable: 'x',
        generator: ['AlgebraicGenerator', ['List', -1, 0, 1]],
      }).status
    ).toBe('invalid');
    expect(
      factorDetailed('x^3+1', { variable: 'x', maxDegree: 2 }).status
    ).toBe('incomplete');
  });

  test('rejects malformed public options before field-cache lookup', () => {
    expect(() => factor('x^2-2', { generator: g })).toThrow(/variable/);
    expect(() => factorDetailed('x', { variable: '' })).toThrow();
    expect(() => factorDetailed('x', { variable: 'x+1' })).toThrow(TypeError);
    for (const maxOperations of [-1, NaN, Infinity, 0.5])
      expect(() => factorDetailed('x', { maxOperations })).toThrow(RangeError);
  });

  test('a refused request is a bound Factor expression', () => {
    const r = factorDetailed('x^3+1', { variable: 'x', maxDegree: 2 });
    expect(r.status).toBe('incomplete');
    expect(r.expression.operator).toBe('Factor');
    expect(r.expression.isCanonical).toBe(true);
    expect(() => r.expression.add(1)).not.toThrow();
    const n = factorDetailed('x^4-2', {
      variable: 'x',
      generator: g,
      maxNormDegree: 0,
      maxNumberFieldLifts: 0,
    });
    expect(n.status).toBe('incomplete');
    expect(n.expression.isCanonical).toBe(true);
    expect(() =>
      factor('x y + x', { maxOperations: 100000 }).add(1)
    ).not.toThrow();
  });

  test('resolves bound polynomial/generator names but protects the variable', () => {
    const ce = new ComputeEngine();
    ce.assign('p', ce.parse('x^2-2'));
    ce.assign('a', ce.expr(g));
    ce.assign('x', 9);
    const result = factorDetailed(ce.symbol('p'), {
      variable: 'x',
      generator: 'a',
    });
    expect(result.status).toBe('complete');
    expect(result.expression.has('x')).toBe(true);
    expect(result.expression.engine).toBe(ce);
  });
});
