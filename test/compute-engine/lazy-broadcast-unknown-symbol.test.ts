import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 42 (2026-07-18): a lazy broadcast over a declared-`unknown`
 * symbol holding a >100-element collection built a silently NON-canonical
 * `Map` — the lazy-op canonical handler hard-rejected the `unknown`-typed
 * source (`checkType(…, 'collection')`), `boxFunction` fell back to a
 * non-canonical expression, and the first arithmetic composition
 * (`mod(L,N)/N`) tripped the `Not canonical` assert in `div`.
 *
 * Also covered here: the two hazards found while fixing it —
 * - the lazy `.N()` wrapper emits `["N", body]`, which a user symbol `N`
 *   (ubiquitous in the Desmos corpus: `N = 85`) used to shadow into an
 *   `incompatible-type` application; operator-position binding now defers a
 *   provably-non-applicable value def to the outer builtin
 *   (`lookupApplicable`);
 * - `Map` over an `unknown`-typed source shed indexed-ness (type, `at`,
 *   display preview), making the lazy result non-consumable.
 */

function engineWithCorpusRow(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('N', { type: 'number' });
  ce.assign('N', 85);
  ce.declare('L', { type: 'unknown' });
  ce.assign('L', ce.parse('\\left[0...101\\right]').evaluate());
  return ce;
}

describe('lazy broadcast over a declared-unknown symbol (Tycho item 42)', () => {
  test('the filed repro no longer throws `Not canonical`', () => {
    const ce = engineWithCorpusRow();
    const r = ce
      .parse('\\frac{\\operatorname{mod}\\left(L,N\\right)}{N}')
      .evaluate();
    expect(r.isCanonical).toBe(true);
    // Consumable lazy result with correct values: element 92 is L=91,
    // mod(91, 85)/85 = 6/85.
    expect(r.count).toBe(102);
    expect(r.at(92)?.evaluate().json).toEqual(['Rational', 6, 85]);
  });

  test('Map over an unknown-typed symbol source is canonical and indexed', () => {
    const ce = engineWithCorpusRow();
    const m = ce.box(['Map', 'L', ['Function', ['Mod', '_1', 'N'], '_1']]);
    expect(m.isCanonical).toBe(true);
    expect(m.type.matches('indexed_collection')).toBe(true);
    expect(m.at(92)?.evaluate().json).toBe(6); // mod(91, 85)
  });

  test('the full corpus row (both tuple components) evaluates', () => {
    const ce = engineWithCorpusRow();
    const P = ce
      .parse(
        '\\left(\\frac{\\operatorname{mod}\\left(L,N\\right)}{N}, \\frac{\\operatorname{floor}\\left(\\frac{L}{N}\\right)}{N}\\right)'
      )
      .evaluate();
    expect(P.isValid).toBe(true);
    expect(P.operator).toBe('Tuple');
    // Second component at L=91: floor(91/85)/85 = 1/85.
    expect(P.op2.at(92)?.evaluate().json).toEqual(['Rational', 1, 85]);
  });

  test('x.N() ≡ x.evaluate().N() on the lazy divide (item-39 contract)', () => {
    const ce = engineWithCorpusRow();
    const expr = ce.parse('\\frac{\\operatorname{mod}\\left(L,N\\right)}{N}');
    const direct = ce
      .parse('\\frac{\\operatorname{mod}\\left(L,N\\right)}{N}')
      .N();
    const late = expr.evaluate().N();
    expect(direct.at(92)?.re).toBeCloseTo(6 / 85, 12);
    expect(late.at(92)?.re).toBeCloseTo(6 / 85, 12);
  });

  test('below the lazy threshold the eager path is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('N', { type: 'number' });
    ce.assign('N', 85);
    ce.declare('L', { type: 'unknown' });
    ce.assign('L', ce.parse('\\left[0...99\\right]').evaluate());
    const r = ce.parse('\\frac{\\operatorname{mod}(L,N)}{N}').evaluate();
    expect(r.operator).toBe('List');
    expect(r.count).toBe(100);
    expect(r.at(92)?.json).toEqual(['Rational', 6, 85]);
  });

  test('an indeterminate-typed symbol holding a SCALAR still rejects as a collection operand', () => {
    // Fail-open admission is value-aware: `x` declared `unknown` but bound
    // to `5` is provably not a collection — `Any(x)` must not canonicalize
    // and silently quantify over an empty element stream (→ False).
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'unknown' });
    ce.assign('x', 5);
    const anyx = ce.box(['Any', 'x']);
    expect(anyx.isCanonical).toBe(false);
    expect(anyx.evaluate().symbol).not.toBe('False');
    // An unresolved symbol (no value) stays fail-open (canonical, inert).
    ce.declare('u', { type: 'unknown' });
    expect(
      ce.box(['Map', 'u', ['Function', ['Add', '_1', 1], '_1']]).isCanonical
    ).toBe(true);
  });

  test('materialize preview head follows the SOURCE value (List vs Set)', () => {
    // `Filter` answers `at` by sequential scan even over a Set source — the
    // preview head must come from the source's value-aware indexed-ness,
    // not from an `at(1)` probe.
    const ce = new ComputeEngine();
    ce.declare('S', { type: 'unknown' });
    ce.assign('S', ce.box(['Set', 3, 1, 2]).evaluate());
    ce.declare('L', { type: 'unknown' });
    ce.assign('L', ce.parse('\\left[0...101\\right]').evaluate());
    const overSet = ce
      .box(['Filter', 'S', ['Function', ['Greater', '_1', 1], '_1']])
      .evaluate();
    expect(overSet.toString().startsWith('Set(')).toBe(true);
    const overList = ce
      .box(['Filter', 'L', ['Function', ['Greater', '_1', 99], '_1']])
      .evaluate();
    expect(overList.toString().startsWith('[')).toBe(true);
  });

  test('a user symbol `N` does not shadow the internal N operator wrap', () => {
    const ce = engineWithCorpusRow();
    // Operator position resolves the builtin (N = 85 is not applicable) …
    expect(ce.box(['N', ['Divide', 1, 3]]).evaluate().isValid).toBe(true);
    expect(ce.box(['N', ['Divide', 1, 3]]).evaluate().re).toBeCloseTo(
      1 / 3,
      10
    );
    // … while value position still resolves the user symbol.
    expect(ce.parse('N+1').evaluate().json).toBe(86);
  });
});
