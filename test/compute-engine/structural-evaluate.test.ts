import { ComputeEngine } from '../../src/compute-engine';

/**
 * `evaluate()` (and `.N()`) return a CANONICAL value: an expression that is
 * not canonical must evaluate to the same value as its canonical form.
 *
 * This used to be silently violated by binders (`Sum`, `Product`, …): the
 * binder machinery — declaring the index in the operator's local scope, and
 * normalizing the indexing set to `Limits` — is a canonicalization step, so a
 * structural tree evaluated in place summed an UNBOUND index
 * (`Σ_{n=1}^{3} n → 9` instead of `6`, plus a stray `console.assert` failure),
 * and a non-canonical tree evaluated to itself.
 *
 * Both the box route and the parse route are probed: they reach the engine
 * through different code paths (repo convention — see
 * `find-fit.test.ts`).
 */

describe('structural/non-canonical evaluate() agrees with canonical', () => {
  test('Sum — box route', () => {
    const ce = new ComputeEngine();
    const json = ['Sum', 'n', ['Tuple', 'n', 1, 3]];

    const structural = ce.box(json, { structural: true });
    expect(structural.isStructural).toBe(true);
    expect(structural.evaluate().re).toEqual(6);
    expect(structural.N().re).toEqual(6);

    const raw = ce.box(json, { canonical: false });
    expect(raw.isCanonical).toBe(false);
    expect(raw.evaluate().re).toEqual(6);
    expect(raw.N().re).toEqual(6);

    expect(ce.box(json).evaluate().re).toEqual(6);
  });

  test('Sum — parse route', () => {
    const ce = new ComputeEngine();
    const latex = '\\sum_{n=1}^{3} n';

    const structural = ce.parse(latex, { structural: true });
    expect(structural.isStructural).toBe(true);
    expect(structural.evaluate().re).toEqual(6);
    expect(structural.N().re).toEqual(6);

    const raw = ce.parse(latex, { canonical: false });
    expect(raw.isCanonical).toBe(false);
    expect(raw.evaluate().re).toEqual(6);
    expect(raw.N().re).toEqual(6);

    expect(ce.parse(latex).evaluate().re).toEqual(6);
  });

  test('Product — box route', () => {
    const ce = new ComputeEngine();
    const json = ['Product', 'n', ['Tuple', 'n', 1, 3]];

    const structural = ce.box(json, { structural: true });
    expect(structural.isStructural).toBe(true);
    expect(structural.evaluate().re).toEqual(6);
    expect(structural.N().re).toEqual(6);

    const raw = ce.box(json, { canonical: false });
    expect(raw.isCanonical).toBe(false);
    expect(raw.evaluate().re).toEqual(6);
    expect(raw.N().re).toEqual(6);

    expect(ce.box(json).evaluate().re).toEqual(6);
  });

  test('Product — parse route', () => {
    const ce = new ComputeEngine();
    const latex = '\\prod_{n=1}^{3} n';

    const structural = ce.parse(latex, { structural: true });
    expect(structural.isStructural).toBe(true);
    expect(structural.evaluate().re).toEqual(6);
    expect(structural.N().re).toEqual(6);

    const raw = ce.parse(latex, { canonical: false });
    expect(raw.isCanonical).toBe(false);
    expect(raw.evaluate().re).toEqual(6);
    expect(raw.N().re).toEqual(6);

    expect(ce.parse(latex).evaluate().re).toEqual(6);
  });

  test('the index still shadows a global value on every route', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 100);
    const latex = '\\sum_{k=1}^{3} k';
    expect(ce.parse(latex, { structural: true }).evaluate().re).toEqual(6);
    expect(ce.parse(latex, { canonical: false }).evaluate().re).toEqual(6);
    // The binder does not leak: `k` outside the sum is unchanged.
    expect(ce.box('k').evaluate().re).toEqual(100);
  });

  test('evaluating a binder structurally does not assert', () => {
    const ce = new ComputeEngine();
    const assert = jest.spyOn(console, 'assert').mockImplementation(() => {});
    try {
      ce.box(['Sum', 'n', ['Tuple', 'n', 1, 3]], {
        structural: true,
      }).evaluate();
      const failed = assert.mock.calls.filter((call) => !call[0]);
      expect(failed).toEqual([]);
    } finally {
      assert.mockRestore();
    }
  });

  test('async evaluation agrees too', async () => {
    const ce = new ComputeEngine();
    const structural = ce.box(['Sum', 'n', ['Tuple', 'n', 1, 3]], {
      structural: true,
    });
    expect((await structural.evaluateAsync()).re).toEqual(6);

    const raw = ce.parse('\\sum_{n=1}^{3} n', { canonical: false });
    expect((await raw.evaluateAsync()).re).toEqual(6);
  });

  test('non-binder structural expressions are unaffected', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 1, 2], { structural: true }).evaluate().re).toEqual(3);
    expect(
      ce.box(['Subtract', 5, 2], { structural: true }).evaluate().re
    ).toEqual(3);
    // Evaluating does not mutate the receiver: it stays structural.
    const structural = ce.parse('2x - (a+b)', { structural: true });
    structural.evaluate();
    expect(structural.isStructural).toBe(true);
    expect(structural.json).toEqual([
      'Subtract',
      ['InvisibleOperator', 2, 'x'],
      ['Delimiter', ['Add', 'a', 'b']],
    ]);
  });
});
