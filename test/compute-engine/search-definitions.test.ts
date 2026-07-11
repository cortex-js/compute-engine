import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';

const ce = engine;

function ids(query: string, options?: { limit?: number }): string[] {
  return ce.searchDefinitions(query, options).map((r) => r.id);
}

describe('searchDefinitions', () => {
  test('identifier match: gcd → GCD (function) first', () => {
    const results = ce.searchDefinitions('gcd');
    expect(results[0]).toEqual({ id: 'GCD', kind: 'function' });
  });

  test('trigger match: \\lfloor → includes Floor', () => {
    expect(ids('\\lfloor')).toContain('Floor');
  });

  test('trigger match: \\binom → includes Binomial', () => {
    expect(ids('\\binom')).toContain('Binomial');
  });

  test('trigger match: \\gcd → includes GCD', () => {
    expect(ids('\\gcd')).toContain('GCD');
  });

  test('description match: "absolute value" → includes Abs', () => {
    expect(ids('absolute value')).toContain('Abs');
  });

  test('honest negative: no match → []', () => {
    expect(ce.searchDefinitions('xyzzy-no-such-thing')).toEqual([]);
  });

  test('empty / whitespace-only query → []', () => {
    expect(ce.searchDefinitions('')).toEqual([]);
    expect(ce.searchDefinitions('   ')).toEqual([]);
  });

  test('inert registered head reports kind: opaque', () => {
    // Verify the premise rather than hardcoding an assumption.
    expect(ce.operatorInfo('To')?.canEvaluate).toBe(false);
    const result = ce.searchDefinitions('To').find((r) => r.id === 'To');
    expect(result).toEqual({ id: 'To', kind: 'opaque' });
  });

  test('constant: golden → GoldenRatio (constant)', () => {
    const result = ce
      .searchDefinitions('golden')
      .find((r) => r.id === 'GoldenRatio');
    expect(result).toEqual({ id: 'GoldenRatio', kind: 'constant' });
  });

  test('limit is respected (default ≤ 10)', () => {
    expect(ce.searchDefinitions('a').length).toBeLessThanOrEqual(10);
    expect(ce.searchDefinitions('a', { limit: 3 }).length).toBeLessThanOrEqual(
      3
    );
    // Clamped to [1, 100].
    expect(ce.searchDefinitions('a', { limit: 0 }).length).toBe(1);
    expect(
      ce.searchDefinitions('a', { limit: 1000 }).length
    ).toBeLessThanOrEqual(100);
  });

  test('user-declared symbol is findable', () => {
    const fresh = new ComputeEngine();
    fresh.declare('myWidget', 'real');
    const result = fresh
      .searchDefinitions('mywidget')
      .find((r) => r.id === 'myWidget');
    expect(result).toEqual({ id: 'myWidget', kind: 'variable' });
  });

  test('deterministic: two calls return identical arrays', () => {
    const a = ce.searchDefinitions('log');
    const b = ce.searchDefinitions('log');
    expect(a).toEqual(b);
  });

  test('graceful degradation with a minimal injected latexSyntax', () => {
    const minimal = new ComputeEngine({
      latexSyntax: { parse: () => null, serialize: () => '' },
    });
    // Does not crash, still finds name matches (trigger axis empty).
    expect(minimal.searchDefinitions('gcd')[0]).toEqual({
      id: 'GCD',
      kind: 'function',
    });
    // Trigger-only query yields nothing useful, but must not throw.
    expect(() => minimal.searchDefinitions('\\binom')).not.toThrow();
  });
});
