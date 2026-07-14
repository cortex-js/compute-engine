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

  test('keyword synonym: average → Mean (function) first', () => {
    // "average" appears in neither the id nor (originally) any description;
    // the curated keyword surfaces it, and an exact keyword ranks first.
    expect(ce.searchDefinitions('average')[0]).toEqual({
      id: 'Mean',
      kind: 'function',
    });
  });

  test('keyword synonym: antiderivative → includes Integrate', () => {
    expect(ids('antiderivative')).toContain('Integrate');
  });

  test('keyword synonym: choose → includes Binomial', () => {
    expect(ids('choose')).toContain('Binomial');
  });

  test('keyword synonym is case-insensitive: NCR → includes Binomial', () => {
    expect(ids('NCR')).toContain('Binomial');
  });

  test('exact keyword outranks an id-substring match', () => {
    // `Abs` carries the exact keyword "magnitude" (tier 2); `QuantityMagnitude`
    // only contains "magnitude" as an id substring (tier 3). The exact keyword
    // must win.
    const results = ids('magnitude');
    expect(results).toContain('Abs');
    expect(results).toContain('QuantityMagnitude');
    expect(results.indexOf('Abs')).toBeLessThan(
      results.indexOf('QuantityMagnitude')
    );
  });

  test('user-declared keywords are findable', () => {
    const fresh = new ComputeEngine();
    fresh.declare('gizmo', { type: 'real', keywords: ['doohickey'] });
    const result = fresh
      .searchDefinitions('doohickey')
      .find((r) => r.id === 'gizmo');
    expect(result).toEqual({ id: 'gizmo', kind: 'variable' });
  });

  // Regression block for the definition-description fill-in (searchable
  // descriptions + a few curated keywords). The `inverse cosine` case guards
  // the P0 fix: `Sec`'s description used to say "inverse of cosine" (secant is
  // the *reciprocal*), so the query returned `Sec`.
  test('P0: "inverse cosine" → Arccos first, not Sec', () => {
    const results = ids('inverse cosine');
    expect(results[0]).toBe('Arccos');
    expect(results[0]).not.toBe('Sec');
  });

  test('"sine" → Sin first', () => {
    expect(ids('sine')[0]).toBe('Sin');
  });

  test('"hyperbolic sine" → Sinh first', () => {
    expect(ids('hyperbolic sine')[0]).toBe('Sinh');
  });

  test('"summation" → includes Sum', () => {
    expect(ids('summation')).toContain('Sum');
  });

  test('"integral" → Integrate first', () => {
    expect(ids('integral')[0]).toBe('Integrate');
  });

  test('"piecewise" → Which first', () => {
    expect(ids('piecewise')[0]).toBe('Which');
  });

  test('"there exists" → includes Exists', () => {
    expect(ids('there exists')).toContain('Exists');
  });

  test('"nth root" → includes Root', () => {
    expect(ids('nth root')).toContain('Root');
  });

  // Keyword-bag (OR) semantics: agents pass several concepts in one query;
  // any-token matching with match-count ranking must surface each concept.
  test('OR semantics: keyword-bag query matches each concept', () => {
    // Under the old every-token (AND) gate this returned [].
    const results = ids('Mod floor Div digits');
    expect(results).toContain('Mod');
    expect(results).toContain('Floor');
  });

  test('OR semantics: unmatched tokens do not suppress results', () => {
    const results = ids('gcd xyzzy-no-such-thing');
    expect(results).toContain('GCD');
  });

  test('match-count ranking: multi-word concept still wins over single-token noise', () => {
    // Sinh matches both "hyperbolic" and "sine"; Sin matches only "sine".
    const results = ids('hyperbolic sine');
    expect(results.indexOf('Sinh')).toBeLessThan(results.indexOf('Sin'));
  });

  test('array query: elements are OR-ed alternatives', () => {
    const results = ce
      .searchDefinitions(['gcd', 'least common multiple'])
      .map((r) => r.id);
    expect(results).toContain('GCD');
    expect(results).toContain('LCM');
  });

  test('array query: empty array and blank elements → []', () => {
    expect(ce.searchDefinitions([])).toEqual([]);
    expect(ce.searchDefinitions(['', '   '])).toEqual([]);
  });

  test('array query: single-element array behaves like the string form', () => {
    expect(ce.searchDefinitions(['inverse cosine'])).toEqual(
      ce.searchDefinitions('inverse cosine')
    );
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
