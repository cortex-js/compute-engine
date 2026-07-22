import { ComputeEngine } from '../../src/compute-engine';

/**
 * Standard-library declaration health.
 *
 * `library.ts` catches a failed definition construction, reports it with
 * `console.error`, and moves on — so a standard-library entry whose signature
 * does not parse silently drops that operator from the table. Nothing failed
 * the build, no test went red, and the first person to notice was a consumer
 * reading stderr (Tycho ledger item 83, which reported exactly this shape:
 * `Unknown type "distribution"` repeated on every engine construction).
 *
 * These tests make that class loud on our side instead.
 */
describe('STANDARD LIBRARY DECLARATIONS', () => {
  test('constructing an engine logs nothing', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      new ComputeEngine();
      expect(spy.mock.calls.map((c) => String(c[0]))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  // `distribution` is a *structural alias* declared in the ComputeEngine
  // constructor before the libraries bootstrap, so the statistics and
  // distribution signatures that reference it resolve. A regression that
  // reorders those two steps would drop `Mean`/`Variance`/`PDF`/`CDF`/
  // `Quantile` from the table entirely rather than merely mistyping them.
  test('the `distribution` alias resolves in the signatures that use it', () => {
    const ce = new ComputeEngine();
    for (const op of [
      'Mean',
      'Variance',
      'StandardDeviation',
      'PDF',
      'CDF',
      'Quantile',
    ]) {
      const def = ce.lookupDefinition(op);
      expect(def?.operator?.signature.toString()).toContain('distribution');
    }
  });

  test('the distribution family evaluates', () => {
    const ce = new ComputeEngine();
    const normal = ['NormalDistribution', 0, 1];
    // A distribution constructor is a VALUE, not a computation: it stays in
    // its applied form and carries an `expression<…>` type. (Read as a defect
    // in the ledger filing — pinned here so the intent is unambiguous.)
    expect(ce.box(normal).evaluate().toString()).toEqual(
      'NormalDistribution(0, 1)'
    );
    expect(ce.box(normal).type.toString()).toEqual(
      'expression<NormalDistribution>'
    );

    expect(ce.box(['PDF', normal, 0]).evaluate().N().re).toBeCloseTo(
      0.3989422804014327,
      12
    );
    expect(ce.box(['CDF', normal, 0]).evaluate().re).toEqual(0.5);
    expect(ce.box(['Quantile', normal, 0.975]).evaluate().N().re).toBeCloseTo(
      1.959963984540054,
      9
    );
    expect(ce.box(['Mean', ['NormalDistribution', 3, 2]]).evaluate().re).toEqual(
      3
    );
    expect(
      ce.box(['Variance', ['NormalDistribution', 3, 2]]).evaluate().re
    ).toEqual(4);
    expect(
      ce.box(['StandardDeviation', ['NormalDistribution', 3, 2]]).evaluate().re
    ).toEqual(2);
  });

  // An alias is engine-scoped, so a signature mentioning one only re-parses
  // when the engine's type resolver is supplied. `ce.type()` supplies it; the
  // bare `parseType` export does not, and throws
  // `Failed to parse type … Unknown type "distribution"`. That is the message
  // item 83 quoted, so pin which route is expected to work.
  test('an alias-bearing signature round-trips through ce.type()', () => {
    const ce = new ComputeEngine();
    const sig = ce.lookupDefinition('Mean')!.operator!.signature.toString();
    expect(sig).toContain('distribution');
    expect(ce.type(sig).toString()).toEqual(sig);
  });
});
