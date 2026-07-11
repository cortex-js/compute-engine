import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tests for `ce.interpret()` — the async, OEIS-backed v4 of the `Interpret`
 * ladder. The network is always mocked: no test may depend on a live OEIS.
 */

const ce = new ComputeEngine();

const originalFetch = global.fetch;

/** An OEIS API `results[]` entry (only the fields the parser reads). */
type OEISResult = {
  number: number;
  name: string;
  data: string;
  formula?: string[];
};

/** Install a `fetch` mock returning the given OEIS results. */
function mockOEIS(results: OEISResult[]): void {
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ results }),
  })) as unknown as typeof fetch;
}

/** Install a `fetch` mock that rejects (simulating being offline). */
function mockOffline(): void {
  global.fetch = (async () => {
    throw new Error('network unavailable');
  }) as unknown as typeof fetch;
}

/** Install a `fetch` mock returning an HTTP error. */
function mockHttpError(status = 500): void {
  global.fetch = (async () => ({
    ok: false,
    status,
    json: async () => ({}),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe('ce.interpret — OEIS-backed proposals', () => {
  test('parses a closed-form formula line (triangular numbers)', async () => {
    // A000217. First formula line is unrelated; the closed form is later, and
    // written as an equality chain.
    mockOEIS([
      {
        number: 217,
        name: 'Triangular numbers',
        data: '0,1,3,6,10,15,21,28,36,45',
        formula: [
          'G.f.: x/(1-x)^3.',
          'a(n) = binomial(n+1,2) = n*(n+1)/2. - _A. Contributor_, 2020',
        ],
      },
    ]);

    const expr = ce.parse('1 + 3 + 6 + 10 + \\cdots + n');
    const { expression, candidates } = await ce.interpret(expr);

    // The sync-recognized form is returned regardless of the lookup.
    expect(expression).toBeDefined();

    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.id).toBe('A000217');
    expect(c.name).toBe('Triangular numbers');
    expect(c.url).toBe('https://oeis.org/A000217');
    expect(c.formula).toContain('a(n)');
    // Verified closed form (in OEIS's own a(n) indexing): binomial(n+1,2).
    expect(c.expression.subs({ n: 1 }).evaluate().re).toBe(1);
    expect(c.expression.subs({ n: 4 }).evaluate().re).toBe(10);
  });

  test('parses a power formula (Mersenne 2^n - 1)', async () => {
    mockOEIS([
      {
        number: 225,
        name: 'a(n) = 2^n - 1',
        data: '0,1,3,7,15,31,63',
        formula: ['a(n) = 2^n - 1.'],
      },
    ]);

    const { candidates } = await ce.interpret(
      ce.parse('1 + 3 + 7 + 15 + \\cdots + n')
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('A000225');
    expect(candidates[0].expression.subs({ n: 5 }).evaluate().re).toBe(31);
  });

  test('aligns the index offset by search (squares starting at n=2)', async () => {
    // Samples 4,9,16,25 are n^2 for n = 2,3,4,5 — offset 2, found by search.
    mockOEIS([
      {
        number: 290,
        name: 'The squares',
        data: '0,1,4,9,16,25,36',
        formula: ['a(n) = n^2.'],
      },
    ]);

    const { candidates } = await ce.interpret(
      ce.parse('4 + 9 + 16 + 25 + \\cdots + n')
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('A000290');
  });

  test('rejects a formula that does not reproduce the samples', async () => {
    // Claimed formula n^2, but the samples are triangular numbers — no offset
    // in the window makes n^2 reproduce 1,3,6,10, so no candidate survives.
    mockOEIS([
      {
        number: 999999,
        name: 'Bogus',
        data: '1,3,6,10',
        formula: ['a(n) = n^2.'],
      },
    ]);

    const { candidates } = await ce.interpret(
      ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
    );

    expect(candidates).toHaveLength(0);
  });

  test('drops self-referential / non-arithmetic formulas (Fibonacci)', async () => {
    // Recurrence line mentions a(...) (self-reference); Binet line has symbols
    // (phi, psi) that do not map to `n` — both are dropped.
    mockOEIS([
      {
        number: 45,
        name: 'Fibonacci numbers',
        data: '1,1,2,3,5,8,13',
        formula: [
          'a(n) = a(n-1) + a(n-2).',
          'a(n) = (phi^n - psi^n)/sqrt(5), where phi = (1+sqrt(5))/2.',
        ],
      },
    ]);

    const { candidates } = await ce.interpret(
      ce.parse('2 + 3 + 5 + 8 + \\cdots + n')
    );

    expect(candidates).toHaveLength(0);
  });

  test('resolves gracefully (no rejection) when offline', async () => {
    mockOffline();

    const expr = ce.parse('1 + 2 + 3 + 4 + \\cdots + n');
    const result = await ce.interpret(expr);

    // The sync-recognized expression is still present.
    expect(result.expression).toBeDefined();
    expect(result.candidates).toHaveLength(0);
  });

  test('resolves gracefully on an HTTP error', async () => {
    mockHttpError(503);

    const { candidates } = await ce.interpret(
      ce.parse('1 + 2 + 3 + 4 + \\cdots + n')
    );

    expect(candidates).toHaveLength(0);
  });

  test('sync recognition still fires when OEIS is unavailable', async () => {
    mockOffline();

    // Arithmetic progression 1,2,3,4,…,n is recognized offline as a Sum.
    const result = await ce.interpret(ce.parse('1 + 2 + 3 + 4 + \\cdots + n'));

    expect(result.expression.operator).toBe('Sum');
    expect(result.candidates).toHaveLength(0);
  });

  test('does not look up when there are too few samples', async () => {
    let called = false;
    global.fetch = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }) as unknown as typeof fetch;

    // Only two samples — below the OEIS-meaningful threshold.
    const { candidates } = await ce.interpret(ce.parse('1 + 2 + \\cdots + n'));

    expect(called).toBe(false);
    expect(candidates).toHaveLength(0);
  });

  test('does not look up when there is no continuation', async () => {
    let called = false;
    global.fetch = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ results: [] }) };
    }) as unknown as typeof fetch;

    const { expression, candidates } = await ce.interpret(ce.parse('x + 1'));

    expect(called).toBe(false);
    expect(candidates).toHaveLength(0);
    // Inert input is returned unchanged (structurally).
    expect(expression.isSame(ce.parse('x + 1'))).toBe(true);
  });

  test('deduplicates candidates by OEIS id and returns attribution', async () => {
    mockOEIS([
      {
        number: 217,
        name: 'Triangular numbers',
        data: '0,1,3,6,10,15',
        formula: ['a(n) = n*(n+1)/2.'],
      },
      {
        number: 217,
        name: 'Triangular numbers (dup)',
        data: '0,1,3,6,10,15',
        formula: ['a(n) = binomial(n+1,2).'],
      },
    ]);

    const { candidates } = await ce.interpret(
      ce.parse('1 + 3 + 6 + 10 + \\cdots + n')
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe('A000217');
    expect(candidates[0].url).toBe('https://oeis.org/A000217');
  });
});
