import { ComputeEngine } from '../../src/compute-engine';

// The statistics of the memoization caches are reachable from a host through
// the engine member `ce._cacheStats`. A host that uses the published package
// cannot read a module export of `src/common/cache-stats.ts`, and a browser
// has no `CE_CACHE_STATS` environment variable, so the member is the only
// way for it to turn the recording on and read the counters.
describe('THE _cacheStats ENGINE MEMBER', () => {
  afterEach(() => {
    new ComputeEngine()._cacheStats.enabled = false;
  });

  test('recording is off by default and records nothing', () => {
    const ce = new ComputeEngine();
    expect(ce._cacheStats.enabled).toBe(false);
    ce._cacheStats.reset();
    const expr = ce.parse('\\sin(x)^2 + x^3');
    void expr.type;
    void expr.type;
    expr.evaluate();
    const { caches } = ce._cacheStats.snapshot();
    expect(Object.values(caches.type).every((n) => n === 0)).toBe(true);
  });

  test('enabled = true records the reads of the type cache', () => {
    const ce = new ComputeEngine();
    ce._cacheStats.reset();
    ce._cacheStats.enabled = true;
    expect(ce._cacheStats.enabled).toBe(true);
    const expr = ce.parse('\\sin(x)^2 + x^3');
    void expr.type;
    void expr.type;
    expr.evaluate();
    ce._cacheStats.enabled = false;
    const { caches } = ce._cacheStats.snapshot();
    const reads = Object.values(caches.type).reduce((a, b) => a + b, 0);
    expect(reads).toBeGreaterThan(0);
    expect(ce._cacheStats.report()).toMatch(/^.*type: \d+ reads/m);

    // Recording stopped: the counters do not move.
    const before = ce._cacheStats.snapshot();
    void ce.parse('y^2 + 1').evaluate().type;
    expect(ce._cacheStats.snapshot()).toEqual(before);
  });

  test('reset() sets every counter to zero', () => {
    const ce = new ComputeEngine();
    ce._cacheStats.enabled = true;
    ce.parse('\\cos(t) + t').evaluate();
    ce._cacheStats.enabled = false;
    ce._cacheStats.reset();
    const { caches, bumps, scopePops } = ce._cacheStats.snapshot();
    for (const counters of Object.values(caches))
      expect(Object.values(counters).every((n) => n === 0)).toBe(true);
    expect(Object.values(bumps).every((n) => n === 0)).toBe(true);
    expect(Object.values(scopePops).every((n) => n === 0)).toBe(true);
  });

  test('the counters are process-global: every engine returns the same object', () => {
    expect(new ComputeEngine()._cacheStats).toBe(
      new ComputeEngine()._cacheStats
    );
  });
});
