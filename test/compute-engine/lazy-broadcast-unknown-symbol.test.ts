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

describe('bare assign to a builtin operator shadows instead of mutating (2026-07-27 ruling)', () => {
  // The hole in the item-42 fix: `lookupApplicable` defers to the OUTER
  // builtin, but a bare `ce.assign('N', …)` — no prior declare — used to
  // mutate that builtin in place in the system scope, destroying it
  // engine-wide (`assign('N', 5)` made every lazy >100-element `.N()` drain
  // all-NaN; `assign('Sin', 30)` broke `Sin(0)`). Ruling: a value assigned
  // over a SYSTEM-scope operator def declares a shadow in the current scope
  // (same path as assigning to an undeclared symbol); user-defined operators
  // keep the in-place value-conversion.

  test('bare assign(N) keeps the lazy >100-element .N() drain numeric', () => {
    const ce = new ComputeEngine(); // default precision: auto-compile must not mask
    ce.assign('N', 5);
    const r = ce.box(['Sin', ['Range', 1, 200]]).N();
    expect(r.at(1)?.re).toBeCloseTo(Math.sin(1), 10);
    expect(r.at(200)?.re).toBeCloseTo(Math.sin(200), 10);
    // Value position resolves the shadow …
    expect(ce.box('N').evaluate().json).toBe(5);
    // … and the parse route agrees (route parity).
    expect(ce.parse('N+1').evaluate().json).toBe(6);
  });

  test('bare assign(Sin) leaves the builtin intact on box and parse routes', () => {
    const ce = new ComputeEngine();
    ce.assign('Sin', 30);
    expect(ce.box(['Sin', 0]).evaluate().json).toBe(0);
    expect(ce.parse('\\sin(\\frac{\\pi}{2})').evaluate().json).toBe(1);
    expect(ce.box('Sin').evaluate().json).toBe(30);
  });

  test('re-assign updates the shadow, not the builtin', () => {
    const ce = new ComputeEngine();
    ce.assign('Sin', 30);
    ce.assign('Sin', 40);
    expect(ce.box('Sin').evaluate().json).toBe(40);
    expect(ce.box(['Sin', 0]).evaluate().json).toBe(0);
  });

  test('a scoped bare assign is undone by popScope', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.assign('Cos', 7);
    expect(ce.box('Cos').evaluate().json).toBe(7);
    ce.popScope();
    expect(ce.box('Cos').evaluate().symbol).toBe('Cos');
    expect(ce.box(['Cos', 0]).evaluate().json).toBe(1);
  });

  test('assigning a function over a builtin shadows the operator def', () => {
    const ce = new ComputeEngine();
    ce.assign('Sin', (_args, { engine }) => engine.number(99));
    // New boxings apply the shadow (it IS applicable, unlike a value shadow) …
    expect(ce.box(['Sin', 0]).evaluate().json).toBe(99);
    // … without touching the system def: a fresh engine is unaffected.
    const ce2 = new ComputeEngine();
    expect(ce2.box(['Sin', 0]).evaluate().json).toBe(0);
  });

  test('bare assign and declare-then-assign now agree', () => {
    const bare = new ComputeEngine();
    bare.assign('N', 85);
    const declared = new ComputeEngine();
    declared.declare('N', { type: 'number' });
    declared.assign('N', 85);
    for (const ce of [bare, declared]) {
      expect(ce.box(['N', ['Divide', 1, 3]]).evaluate().re).toBeCloseTo(
        1 / 3,
        10
      );
      expect(ce.parse('N+1').evaluate().json).toBe(86);
    }
  });
});
