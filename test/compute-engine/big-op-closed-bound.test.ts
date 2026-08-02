import { ComputeEngine } from '../../src/compute-engine';

/**
 * A big operator's bounds are consumed as machine numbers in several places
 * (`classifyBigopDomain`, `normalizeIndexingSet`, the compiler's loop
 * lowering). Those read `.re` on the bound AS WRITTEN, which is `NaN` for an
 * unevaluated function expression — so `Σ_{j=1}^{Length(P)} P[j]` used to stay
 * inert even though `Length(P)` alone evaluates (Tycho item 125).
 *
 * A CLOSED bound (no free symbols) is now evaluated before the domain is
 * classified. A genuinely FREE bound still keeps the operator symbolic: that
 * guard is what stops `Sum(k, [k, 1, n])` from being read as if `n` were the
 * default iteration window.
 */

describe('big operator with a closed (evaluable) bound', () => {
  test('Length(⟨bound list⟩) as an upper bound — all three spellings', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.parse('\\left[1,2,3\\right]'));
    ce.assign('C', ce.parse('\\left[1,2,3,4\\right]'));

    // `length(P)` — the function spelling.
    expect(
      ce
        .parse('\\sum_{j=1}^{\\operatorname{length}(P)}P\\left[j\\right]')
        .evaluate().re
    ).toEqual(6);

    // `count(C)` — a synonym; parses to the same `Length` node.
    expect(
      ce
        .parse('\\sum_{i=1}^{\\operatorname{count}(C)}C\\left[i\\right]')
        .evaluate().re
    ).toEqual(10);

    // `C.length` — the dot spelling, inside a compound bound. Also a `Length`
    // node, so it is the same fix, not a separate one.
    expect(
      ce
        .parse(
          '\\sum_{i=0}^{C.\\operatorname{length} - 1}C\\left[i+1\\right]'
        )
        .evaluate().re
    ).toEqual(10);
  });

  test('.N() agrees with evaluate()', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.parse('\\left[1,2,3\\right]'));
    expect(
      ce.parse('\\sum_{j=1}^{\\operatorname{length}(P)}P\\left[j\\right]').N().re
    ).toEqual(6);
  });

  test('Product too, not just Sum', () => {
    const ce = new ComputeEngine();
    ce.assign('C', ce.parse('\\left[1,2,3,4\\right]'));
    expect(
      ce
        .parse('\\prod_{i=1}^{\\operatorname{length}(C)}C\\left[i\\right]')
        .evaluate().re
    ).toEqual(24);
  });

  test('the bound is read when the operator RUNS, not when it is parsed', () => {
    const ce = new ComputeEngine();
    ce.assign('P', ce.parse('\\left[1,2,3\\right]'));
    const sum = ce.parse(
      '\\sum_{j=1}^{\\operatorname{length}(P)}P\\left[j\\right]'
    );
    expect(sum.evaluate().re).toEqual(6);

    // Growing `P` must change the answer: folding the bound at
    // canonicalization would have baked the old length.
    ce.assign('P', ce.parse('\\left[1,2,3,4,5\\right]'));
    expect(sum.evaluate().re).toEqual(15);
  });

  test('GUARD: a genuinely free bound keeps the operator symbolic', () => {
    const ce = new ComputeEngine();
    // Not 50015001 (the default iteration window read as `n`).
    expect(ce.parse('\\sum_{k=1}^{n}k').evaluate().toString()).toEqual(
      'sum_(k=1)^(n)(k)'
    );
    // A closed bound over an UNASSIGNED list is equally symbolic: `Length(Q)`
    // has no value either.
    expect(
      ce
        .parse('\\sum_{j=1}^{\\operatorname{length}(Q)}j')
        .evaluate()
        .toString()
    ).toContain('Length(Q)');
  });

  test('GUARD: an IMPURE closed bound stays symbolic', () => {
    const ce = new ComputeEngine();
    // Closed (no free symbols) but effectful. Classification and normalization
    // each consult the bound, so evaluating it would draw more than once and
    // could iterate a different trip count than it classified against.
    const sum = ce.box([
      'Sum',
      1,
      ['Limits', 'j', 1, ['RandomInteger', 1, 10]],
    ]);
    expect(sum.evaluate().toString()).toContain('RandomInteger');
  });

  test('GUARD: literal and infinite bounds are unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{k=1}^{10}k').evaluate().re).toEqual(55);
    expect(
      ce.parse('\\sum_{k=1}^{\\infty}\\frac{1}{k^2}').evaluate().toString()
    ).toEqual('pi^2 / 6');
  });
});
