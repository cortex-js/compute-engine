import { ComputeEngine } from '../../src/compute-engine';
import * as mathJsonUtils from '../../src/math-json/utils';

/**
 * A flat operator chain (`1x+2x+…+Nx`, `a\cdot b\cdot …`) is parsed
 * iteratively, one operator at a time, and each step hands the accumulated
 * chain back to the infix parser. Two per-step costs used to be proportional
 * to the chain length so far, which made the raw parse of a long sum
 * quadratic (a 12 000-term sum took ~1.7 s, ~20× a 3 000-term one):
 *
 * 1. `expandContinuationAdd` re-walked EVERY accumulated operand looking for
 *    an ellipsis, calling `symbol()` on each — so the number of `symbol()`
 *    calls during the parse of an N-term sum was ~N²/2 (501 500 at N=1 000,
 *    2 003 000 at N=2 000). It is now memoized per chain: ~3N calls.
 * 2. `foldAssociativeOperator` copied the whole operand array at every
 *    operator (N−1 calls per chain). `parser.appendAssociativeOperand` now
 *    extends the chain the parser itself built (`parser.ownedChain`) in
 *    place, so the copy happens once per chain.
 *
 * Both are deterministic call counts on module exports the parser actually
 * calls through, so they are asserted directly. Per the wall-clock doctrine
 * (ROADMAP "Test assertions on wall-clock time"), no elapsed time is
 * asserted.
 */
describe('flat operator chains parse in linear work', () => {
  function countCalls(
    fn: 'symbol' | 'foldAssociativeOperator',
    latex: string
  ): number {
    const spy = jest.spyOn(mathJsonUtils, fn);
    try {
      const ce = new ComputeEngine();
      ce.parse(latex, { form: 'raw' });
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  const sum = (n: number) =>
    Array.from({ length: n }, (_, i) => `${i + 1}x`).join('+');
  const product = (n: number) =>
    Array.from({ length: n }, (_, i) => `${i + 1}`).join('\\cdot ');

  test('sum: the ellipsis check does not re-walk the accumulated chain', () => {
    const N = 1000;
    const small = countCalls('symbol', sum(N));
    const large = countCalls('symbol', sum(2 * N));
    // Linear: `large ≈ 2 × small`. Quadratic (the regression): ≈ 4 ×. The
    // lower bound proves the spy is intercepting the parser's calls at all.
    expect(small).toBeGreaterThan(N);
    expect(large).toBeLessThan(3 * small);
  });

  test.each([
    ['sum', sum],
    ['product', product],
  ])('%s: the operand array is not copied at every operator', (_, gen) => {
    const N = 1000;
    // Exactly one copy, when the chain is first formed; appends after that.
    // The regressed parser copied at every one of the N−1 operators. (An
    // exact count, not just an upper bound, so a spy that stopped
    // intercepting the parser's calls would fail loudly rather than pass on
    // a count of 0.)
    expect(countCalls('foldAssociativeOperator', gen(N))).toBe(1);
  });

  test('a sum of products: nested chains do not reset the outer chain', () => {
    // Each `+` parses its right operand with a nested `parseExpression`, and
    // that nested parse builds (and owns) its own `\cdot` chain. The outer
    // `+` loop must still recognize its accumulated `Add` as its own chain
    // afterwards — otherwise every `+` copies again and the sum is quadratic.
    const N = 1000;
    const latex = Array.from({ length: N }, (_, i) => `${i + 1}\\cdot x`).join(
      '+'
    );
    // Exactly one copy for the outer `Add`, plus one per inner two-factor
    // product (each `k\\cdot x` starts its own chain).
    expect(countCalls('foldAssociativeOperator', latex)).toBe(N + 1);
    const ce = new ComputeEngine();
    const expr = ce.parse(latex, { form: 'raw' });
    expect(expr.operator).toBe('Add');
    expect(expr.nops).toBe(N);
  });

  test('a nested chain stays a nested operand of the outer chain', () => {
    // The inner group is built by a nested parse (its own chain); the outer
    // chain must take it as ONE operand, in place, without disturbing it.
    const ce = new ComputeEngine();
    expect(ce.parse('a+(b+c)+d', { form: 'raw' }).json).toEqual([
      'Add',
      'a',
      ['Delimiter', ['Add', 'b', 'c']],
      'd',
    ]);
    expect(
      ce.parse('a\\cdot(b\\cdot c)\\cdot d', { form: 'raw' }).json
    ).toEqual(['Multiply', 'a', ['Delimiter', ['Multiply', 'b', 'c']], 'd']);
  });

  test('a long flat sum still parses to one flat Add', () => {
    const ce = new ComputeEngine();
    const N = 5000;
    const expr = ce.parse(sum(N), { form: 'raw' });
    expect(expr.operator).toBe('Add');
    expect(expr.nops).toBe(N);
  });

  test('a long sum with an ellipsis still expands its Subtract groupings', () => {
    // The memo that makes long chains linear must not change what an
    // ellipsis-carrying chain parses to: `Subtract` groupings become explicit
    // `Negate` terms so the notational samples reach `Interpret` intact.
    const ce = new ComputeEngine();
    const expr = ce.parse('1-2+3-\\dots+99', { form: 'raw' });
    expect(expr.json).toEqual([
      'Add',
      1,
      ['Negate', 2],
      3,
      ['Negate', 'ContinuationPlaceholder'],
      99,
    ]);
  });
});
