import { ComputeEngine } from '../../src/compute-engine';

// These tests require network access to oeis.org
// They may be slow or fail if the network is unavailable

// Skip these tests in CI environments or when network is not available
const SKIP_NETWORK_TESTS = process.env.CI === 'true' || process.env.SKIP_OEIS_TESTS === 'true';

const describeIfNetwork = SKIP_NETWORK_TESTS ? describe.skip : describe;

describeIfNetwork('OEIS Integration (SUB-12)', () => {
  // Increase timeout for network requests
  jest.setTimeout(30000);

  describe('lookupOEIS', () => {
    test('finds Fibonacci sequence by terms', async () => {
      const ce = new ComputeEngine();
      const results = await ce.lookupOEIS([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);

      expect(results.length).toBeGreaterThan(0);

      // The first result should be Fibonacci (A000045)
      const fib = results.find(r => r.id === 'A000045');
      expect(fib).toBeDefined();
      expect(fib!.name.toLowerCase()).toContain('fibonacci');
      expect(fib!.url).toBe('https://oeis.org/A000045');
    });

    test('finds triangular numbers by terms', async () => {
      const ce = new ComputeEngine();
      // Triangular numbers: 0, 1, 3, 6, 10, 15, 21, 28, 36, 45
      const results = await ce.lookupOEIS([0, 1, 3, 6, 10, 15, 21, 28, 36, 45]);

      expect(results.length).toBeGreaterThan(0);

      // A000217 is the triangular numbers sequence
      const triangular = results.find(r => r.id === 'A000217');
      expect(triangular).toBeDefined();
    });

    test('returns empty array for random terms', async () => {
      const ce = new ComputeEngine();
      // Random unlikely sequence
      const results = await ce.lookupOEIS([17, 42, 99, 123, 456, 789, 1234, 5678]);

      // May or may not find matches, but should not throw
      expect(Array.isArray(results)).toBe(true);
    });

    test('handles BoxedExpression terms', async () => {
      const ce = new ComputeEngine();
      const terms = [
        ce.number(0),
        ce.number(1),
        ce.number(1),
        ce.number(2),
        ce.number(3),
        ce.number(5),
        ce.number(8),
        ce.number(13),
      ];

      const results = await ce.lookupOEIS(terms);
      expect(results.length).toBeGreaterThan(0);
    });

    test('respects maxResults option', async () => {
      const ce = new ComputeEngine();
      // Results are limited client-side
      const results = await ce.lookupOEIS([1, 2, 3, 4, 5, 6, 7, 8], { maxResults: 2 });

      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('checkSequenceOEIS', () => {
    test('matches Fibonacci sequence to A000045', async () => {
      const ce = new ComputeEngine();
      ce.declareSequence('F', {
        base: { 0: 0, 1: 1 },
        recurrence: 'F_{n-1} + F_{n-2}',
      });

      const result = await ce.checkSequenceOEIS('F', 10);

      expect(result.terms).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
      expect(result.matches.length).toBeGreaterThan(0);

      const fib = result.matches.find(m => m.id === 'A000045');
      expect(fib).toBeDefined();
    });

    test('throws for non-existent sequence', async () => {
      const ce = new ComputeEngine();

      await expect(ce.checkSequenceOEIS('NonExistent')).rejects.toThrow(
        "'NonExistent' is not a defined sequence"
      );
    });

    test('works with LaTeX-defined sequence', async () => {
      const ce = new ComputeEngine();
      ce.parse('T_0 := 0').evaluate();
      ce.parse('T_n := T_{n-1} + n').evaluate();

      const result = await ce.checkSequenceOEIS('T', 10);

      // Triangular numbers: 0, 1, 3, 6, 10, 15, 21, 28, 36, 45
      expect(result.terms).toEqual([0, 1, 3, 6, 10, 15, 21, 28, 36, 45]);
      expect(result.matches.length).toBeGreaterThan(0);
    });
  });
});

// Tests that don't require network
describe('OEIS Integration (offline)', () => {
  test('lookupOEIS throws for non-integer terms', async () => {
    const ce = new ComputeEngine();

    await expect(ce.lookupOEIS([1.5, 2.5, 3.5])).rejects.toThrow(
      'OEIS lookup requires integer terms'
    );
  });

  test('checkSequenceOEIS throws for non-sequence', async () => {
    const ce = new ComputeEngine();

    await expect(ce.checkSequenceOEIS('x')).rejects.toThrow(
      "'x' is not a defined sequence"
    );
  });
});
