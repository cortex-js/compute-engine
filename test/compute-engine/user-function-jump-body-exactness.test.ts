import { ComputeEngine } from '../../src/compute-engine';

// `.N()` promises a correct result (ARCHITECTURE.md, "What `.N()`
// promises"): a function whose result jumps at a point uses the exact value
// of an exact operand, so `Floor((25! − 1)/24!).N()` is 24 where the float
// of the operand is 25. A user function whose body applies such a function
// received its arguments approximated, on every route (a literal held as a
// value, a one-step definition, `Apply`), and `f((25! − 1)/24!).N()` for
// `f := x ↦ Floor(x)` was 25. The parameter is still bound to the
// approximation, and the activation records the written argument when it
// is pure and ground (`exact-argument-source.ts`, `exactArgumentSources` in
// `function-utils.ts`); the handler of the jump re-reads it exactly only
// when the float is near the jump (`exactRealValueOf`). Nothing is
// evaluated twice, and nothing is evaluated exactly far from a jump.

const Q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];

describe('a user function with a jump body under .N()', () => {
  test('a literal held as a value', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    expect(ce.box(['f', Q]).N().toString()).toBe('24');
    expect(ce.box(['f', Q]).evaluate().toString()).toBe('24');
    // A float argument stays a float.
    expect(ce.box(['f', 1.7]).N().toString()).toBe('1');
    // Through an exact global.
    ce.assign('y', ce.box(Q).evaluate());
    expect(ce.box(['f', 'y']).N().toString()).toBe('24');
  });

  test('a one-step definition and a declared function', () => {
    const ce = new ComputeEngine();
    ce.parse('k(x) := \\lfloor x \\rfloor').evaluate();
    expect(ce.box(['k', Q]).N().toString()).toBe('24');
    ce.declare('h', {
      type: '(real) -> real',
      value: ce.box(['Function', ['Floor', 'x'], 'x']),
    });
    expect(ce.box(['h', Q]).N().toString()).toBe('24');
  });

  test('a bare function as a value, and a call through another function', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box('Floor'));
    expect(ce.box(['g', Q]).N().toString()).toBe('24');
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    ce.assign('f2', ce.box(['Function', ['Add', ['f', 'x'], 1], 'x']));
    expect(ce.box(['f2', Q]).N().toString()).toBe('25');
  });

  test('Apply of a literal and of a name', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    expect(ce.box(['Apply', 'f', Q]).N().toString()).toBe('24');
    expect(
      ce
        .box(['Apply', ['Function', ['Floor', 'x'], 'x'], Q])
        .N()
        .toString()
    ).toBe('24');
  });

  test('the asynchronous routes', async () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    ce.parse('k(x) := \\lfloor x \\rfloor').evaluate();
    const n = { numericApproximation: true } as const;
    expect((await ce.box(['f', Q]).evaluateAsync(n)).toString()).toBe('24');
    expect((await ce.box(['k', Q]).evaluateAsync(n)).toString()).toBe('24');
    expect((await ce.box(['Apply', 'f', Q]).evaluateAsync(n)).toString()).toBe(
      '24'
    );
  });

  test('an argument with an effect is evaluated once', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
    ce.assign('n', 0);
    ce.box(['f', ['Assign', 'n', ['Add', 'n', 1]]]).N();
    expect(ce.box('n').evaluate().json).toBe(1);
  });

  // The exact value of the sum is a rational with thousands of digits:
  // evaluating it exactly takes about 30 s (measured 2026-10-20 on an M5),
  // while the numeric route takes about 0.1 s locally and up to 4 s on a
  // loaded continuous-integration runner. A limit of 15 s separates the two
  // routes on any of these machines; a limit of 2 s failed on the Node 26
  // runner. The jest timeout is set above the limit, so a regression fails on
  // the assertion and not on the default 5 s jest timeout. The time is checked
  // only in a `CE_PERF=1` run (CODING-STYLEGUIDE.md): in a full suite on the
  // shared machine this test once took 44 s (2026-10-30) and 155 ms when run
  // alone. The value check above does not depend on time.
  test(
    'an argument far from a jump is not evaluated exactly',
    () => {
      const ce = new ComputeEngine();
      ce.assign('f', ce.box(['Function', ['Floor', 'x'], 'x']));
      const sum = ['Sum', ['Divide', 1, 'k'], ['Tuple', 'k', 1, 10000]];
      const start = Date.now();
      const viaFunction = ce.box(['f', sum]).N().toString();
      const elapsed = Date.now() - start;
      expect(viaFunction).toBe(ce.box(['Floor', sum]).N().toString());
      if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(15_000);
    },
    20_000
  );

  test('a body with no jump is unchanged', () => {
    const ce = new ComputeEngine();
    ce.assign('s', ce.box(['Function', ['Sin', 'x'], 'x']));
    expect(ce.box(['s', 2]).N().toString()).toBe(
      ce.box(['Sin', 2]).N().toString()
    );
  });

  test('a Map over a bare jump function auto-compiles with exact inputs served by the interpreter', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.assign('g', ce.box('Floor'));
    const list = ['List', ...Array(70).fill(Q)];
    const values = new Set<string>();
    const mapped = ce.box(['Map', ['Function', ['g', 'x'], 'x'], list]).N();
    for (const x of (mapped as any).each()) values.add(x.toString());
    expect([...values]).toEqual(['24']);
  });
});
