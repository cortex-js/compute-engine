import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// `NIntegrate(f, a, b)` runs the same methods in the same order as a
// single-limit `Integrate(…).N()`: the quadrature first, Monte Carlo only as
// the fallback (`integrateRealPart()`, `library/calculus.ts`). So the
// compile-time constant fold prices it like a single-limit `Integrate`
// (`foldCostEstimate`, `FOLD_QUADRATURE_EVALS`). Before, the estimate
// declined every `NIntegrate`, which has no structural lowering, so a
// constant `NIntegrate` did not compile at all.
//

function compiled(ce: ComputeEngine, expr: any) {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return compile(ce.box(expr)) as any;
  } finally {
    warn.mockRestore();
  }
}

describe('a constant NIntegrate folds', () => {
  test('a function literal integrand', () => {
    const ce = new ComputeEngine();
    const f = compiled(ce, [
      'Add',
      'y',
      ['NIntegrate', ['Function', 'x', 'x'], 0, 1],
    ]);
    expect(f.success).toBe(true);
    expect(f.code).not.toContain('NIntegrate');
    expect(f.run({ y: 1 })).toBeCloseTo(1.5, 12);
  });
});

describe('the price of NIntegrate includes its integrand', () => {
  test('the body of a user function given by its name is priced', () => {
    // `h(u)` is itself an integral: integrating it is an iterated
    // quadrature, which the estimate declines, as for a nested `Integrate`.
    // The name `h` is one syntax node: without the body of `h` in the
    // price, the fold would run the iterated quadrature at compile time.
    const ce = new ComputeEngine();
    ce.assign(
      'h',
      ce.parse('u \\mapsto \\mathrm{NIntegrate}(x \\mapsto x u, 0, 1)')
    );
    const f = compiled(ce, ['Add', 'y', ['NIntegrate', 'h', 0, 1]]);
    expect(f.success).toBe(false);
  });

  test('a nested NIntegrate compiles to an iterated quadrature', () => {
    const ce = new ComputeEngine();
    const f = compiled(ce, [
      'Add',
      'y',
      [
        'NIntegrate',
        [
          'Function',
          ['NIntegrate', ['Function', ['Multiply', 'x', 'u'], 'x'], 0, 1],
          'u',
        ],
        0,
        1,
      ],
    ]);
    // ∫₀¹ ∫₀¹ x·u dx du = 1/4, the interpreter's value.
    expect(f.success).toBe(true);
    expect(f.run({ y: 1 })).toBeCloseTo(1.25, 12);
  });
});
