import { ComputeEngine } from '../../src/compute-engine';

// The type of a symbol that holds a formula is computed from its value at
// each read. In a chain of symbols that each hold the previous one
// (`A1 := A0`, `A2 := A1`, ...), the type of the last symbol must read the
// type of each symbol of the chain once: with several reads at each level,
// the work is multiplied at each level, and nine symbols did not finish in
// 60 seconds.

/** An engine with `A0 := sin(x)` and `A_i := A_{i-1}` for `i` in `1..n`. */
function engineWithChain(n: number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('A0', ce.expr(['Sin', 'x']));
  for (let i = 1; i <= n; i++) ce.assign(`A${i}`, ce.symbol(`A${i - 1}`));
  return ce;
}

/** The number of type computations with the assumptions hidden (one for
 * each read of the type of a symbol that holds a formula) that `fn` makes. */
function typeComputations(ce: ComputeEngine, fn: () => void): number {
  const spy = jest.spyOn(ce, '_withoutFacts');
  try {
    fn();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe('A chain of symbols that each hold the previous one', () => {
  test('the type of the last symbol reads each symbol once', () => {
    // The counts are measured on engines of their own: an engine keeps
    // nothing of these reads, but the chains have different lengths.
    const counts = [3, 6].map((n) => {
      const ce = engineWithChain(n);
      return typeComputations(ce, () => ce.symbol(`A${n}`).type);
    });
    // One more read for each symbol of the chain. With several reads at each
    // level, the count for four symbols was 4682.
    expect(counts[1] - counts[0]).toBeLessThanOrEqual(3);
  });

  test('a long chain has the type and the value of its first symbol', () => {
    const ce = engineWithChain(40);
    expect(ce.symbol('A40').type.toString()).toBe(
      ce.symbol('A1').type.toString()
    );
    expect(ce.expr(['Multiply', 2, 'A40']).evaluate().json).toEqual([
      'Multiply',
      2,
      ['Sin', 'x'],
    ]);
  });
});
