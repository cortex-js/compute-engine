/**
 * Acceptance suite for the Fungrim Phase-1 runtime loader
 * (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §3 M2, §2.7, §2.8).
 *
 * Covers: load report shape, idempotence, topic/class/purpose filtering,
 * shell declarations, guard positive/negative controls (fail-closed),
 * per-engine isolation, solve/harmonization routing, the onGuardUndecided
 * debug hook, and curated before/after examples from the artifact.
 *
 * NOTE: this suite intentionally does NOT use the shared engine from
 * `test/utils` — the loader mutates the engine's rule stores and scope, so
 * each scenario gets its own engine instance.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities, FUNGRIM_CORE } from '../../src/identities';
import type { FungrimRuleData } from '../../src/identities';

// ---------------------------------------------------------------------------
// Import side effects
// ---------------------------------------------------------------------------

describe('importing the loader module', () => {
  it('has no side effects on a fresh engine', () => {
    // `loadIdentities` and `FUNGRIM_CORE` are imported above; merely
    // importing them must not register rules or declare shells anywhere.
    const ce = new ComputeEngine();
    expect(
      ce.simplificationRules.some(
        (r) =>
          typeof r === 'object' &&
          r !== null &&
          'id' in r &&
          typeof r.id === 'string' &&
          r.id.startsWith('fungrim:')
      )
    ).toBe(false);
    expect(
      ce.solveRules.some(
        (r) =>
          typeof r === 'object' &&
          r !== null &&
          'id' in r &&
          typeof r.id === 'string' &&
          r.id.startsWith('fungrim:')
      )
    ).toBe(false);
    // CarlsonRF is still a shell-only head (JacobiTheta, DedekindEta,
    // EllipticK/E, AGM and the hypergeometrics became engine built-ins
    // with the Tier-2 numeric kernels)
    expect(ce.lookupDefinition('CarlsonRF')).toBeUndefined();
    expect(ce.expr(['Gamma', ['Rational', 1, 2]]).simplify().toString()).toBe(
      'Gamma(1/2)'
    );
  });
});

// ---------------------------------------------------------------------------
// Full load: report shape, idempotence, shells, before/after examples
// ---------------------------------------------------------------------------

describe('loadIdentities (full artifact)', () => {
  let ce: ComputeEngine;
  let report: ReturnType<typeof loadIdentities>;
  let rulesBefore: number;
  let loadTimeMs: number;

  beforeAll(() => {
    ce = new ComputeEngine();
    rulesBefore = ce.simplificationRules.length;
    const t0 = Date.now();
    report = loadIdentities(ce);
    loadTimeMs = Date.now() - t0;
  });

  it('loads every simplify rule of the artifact on a fresh engine', () => {
    // Default load (solve: false) loads the simplify-target rules and skips
    // the solve-target overlay (the §2.6 root templates).
    const simplifyCount = FUNGRIM_CORE.rules.filter(
      (r) => r.target === 'simplify'
    ).length;
    expect(report.loaded).toBe(simplifyCount);
    expect(report.loaded).toBe(1440);
    // The only default-load skips are the solve templates (solve-disabled).
    expect(report.skipped.every((s) => s.reason === 'solve-disabled')).toBe(
      true
    );
    expect(report.skipped.length).toBe(
      FUNGRIM_CORE.rules.length - simplifyCount
    );
    expect(ce.simplificationRules.length).toBe(rulesBefore + report.loaded);
  });

  it('loads in a reasonable time', () => {
    // ~150ms on a dev laptop; generous CI margin
    expect(loadTimeMs).toBeLessThan(10_000);
  });

  it('reports byTarget and byPurpose consistent with the artifact manifest', () => {
    expect(report.byTarget).toEqual({
      simplify: 1440,
      solve: 0,
      harmonization: 0,
    });
    expect(report.byPurpose).toEqual({
      // 8 Digamma specific-value rules are tagged 'transform' (cost-gate
      // exempt) so they fire in simplify() — SYM P2-25.
      simplify: 1319,
      transform: 8,
      expand: 113,
    });
    expect(
      report.byPurpose.simplify +
        report.byPurpose.transform +
        report.byPurpose.expand
    ).toBe(report.loaded);
  });

  it('carries the offline compile ledger from the artifact manifest', () => {
    expect(report.compileLedger).toEqual(FUNGRIM_CORE.manifest.ledger);
    // The corpus-vs-artifact accounting: slice entries = rules + ledgered skips
    const ledgerTotal = Object.values(report.compileLedger).reduce(
      (a, b) => a + b,
      0
    );
    // Solve-target rules are a derived overlay (apply-solve-templates.ts),
    // not slice dispositions — exclude them from the corpus accounting.
    const primaryCount = FUNGRIM_CORE.rules.filter(
      (r) => r.target === 'simplify'
    ).length;
    expect(primaryCount + ledgerTotal).toBe(
      FUNGRIM_CORE.manifest.slice.entries
    );
  });

  it('declares shell heads in the current scope', () => {
    expect(report.declared).toContain('CarlsonRF');
    // The artifact declarations table is pruned of CE built-ins at compile
    // time, against a live engine (Gamma, Digamma, LambertW, … and the
    // Tier-2 kernel heads: JacobiTheta, DedekindEta, EllipticK/E, AGM,
    // Hypergeometric2F1/1F1); a full load declares exactly the pruned table
    expect(report.declared).not.toContain('Gamma');
    expect(report.declared).not.toContain('JacobiTheta');
    expect(report.declared).not.toContain('EllipticK');
    expect(report.declared).toEqual(
      Object.keys(FUNGRIM_CORE.declarations).sort()
    );
    // The Tier-2 heads are usable as built-ins, not shells
    expect(ce.lookupDefinition('JacobiTheta')).toBeDefined();
    expect(ce.lookupDefinition('DedekindEta')).toBeDefined();
  });

  it('never overwrites an already-defined name (user symbols are not shadowed)', () => {
    const ce2 = new ComputeEngine();
    // The user declared their own `JacobiTheta` before loading
    ce2.declare('JacobiTheta', 'real');
    const r = loadIdentities(ce2);
    expect(r.declared).not.toContain('JacobiTheta');
    expect(r.declared).toContain('CarlsonRF');
    // The user definition is untouched (still a plain real-valued symbol)
    expect(ce2.expr('JacobiTheta').type.toString()).toBe('real');
  });

  it('makes shell heads usable (JacobiTheta boxes validly and its value rule fires)', () => {
    const theta = ce.expr(['JacobiTheta', 3, 0, 'ImaginaryUnit']);
    expect(theta.isValid).toBe(true);
    // fungrim:1403b5 — θ₃(0, i) = Γ(1/4) / (√2 π^(3/4)). The closed form is
    // structurally larger, so simplify()'s cost gate rejects it; it remains
    // reachable via replace() (purpose 'simplify', not 'expand').
    const rs = ce.getRuleSet('standard-simplification')!;
    const closed = theta.replace(rs);
    expect(closed).not.toBeNull();
    expect(
      closed!.isEqual(
        ce.expr([
          'Divide',
          ['Gamma', ['Divide', 1, 4]],
          ['Multiply', ['Sqrt', 2], ['Power', 'Pi', ['Divide', 3, 4]]],
        ])
      )
    ).toBe(true);
  });

  it('is idempotent: a second load adds nothing', () => {
    const countBefore = ce.simplificationRules.length;
    const second = loadIdentities(ce);
    expect(second.loaded).toBe(0);
    expect(second.declared).toEqual([]);
    expect(second.skipped.length).toBe(FUNGRIM_CORE.rules.length);
    // On a second default load the simplify rules are already-loaded; the
    // solve overlay stays solve-disabled.
    expect(
      second.skipped.every(
        (s) =>
          s.reason === 'already-loaded' || s.reason === 'solve-disabled'
      )
    ).toBe(true);
    expect(ce.simplificationRules.length).toBe(countBefore);
  });

  // -- Curated before/after examples (artifact rules, docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.7) ----

  it('Gamma(1/2) → √π  [fungrim:f826a6]', () => {
    expect(
      ce.expr(['Gamma', ['Rational', 1, 2]]).simplify().isSame(
        ce.expr(['Sqrt', 'Pi'])
      )
    ).toBe(true);
  });

  it('Gamma(3/2) → √π/2  [fungrim:48ac55]', () => {
    expect(
      ce.expr(['Gamma', ['Rational', 3, 2]]).simplify().isSame(
        ce.expr(['Divide', ['Sqrt', 'Pi'], 2])
      )
    ).toBe(true);
  });

  it('Gamma(2) → 1  [fungrim:19d480]', () => {
    expect(ce.expr(['Gamma', 2]).simplify().isSame(1)).toBe(true);
  });

  it('Digamma(1) → -EulerGamma  [fungrim:ea2482]', () => {
    expect(
      ce.expr(['Digamma', 1]).simplify().isSame(ce.expr(['Negate', 'EulerGamma']))
    ).toBe(true);
  });

  it('Digamma(1/2) → -2 ln 2 - EulerGamma  [fungrim:89bed3]', () => {
    // This specific-value rule is tagged `purpose: 'transform'` so it is
    // exempt from simplify()'s cost gate (the closed form is larger than the
    // tiny Digamma(1/2) input). Assert the EXACT symbolic form via isSame —
    // no isEqual numeric fallback, which would pass whether or not the rule
    // actually fired (SYM P2-25).
    const input = ce.expr(['Digamma', ['Rational', 1, 2]]);
    const result = input.simplify();
    // The rule must have fired: the result is no longer the input.
    expect(result.isSame(input)).toBe(false);
    const expected = ce.box([
      'Add',
      ['Multiply', -2, ['Ln', 2]],
      ['Negate', 'EulerGamma'],
    ]);
    expect(result.isSame(expected)).toBe(true);
  });

  it('Arctan(1 + √2) → 3π/8  [fungrim:c6c92a]', () => {
    expect(
      ce.expr(['Arctan', ['Add', 1, ['Sqrt', 2]]]).simplify().isSame(
        ce.expr(['Divide', ['Multiply', 3, 'Pi'], 8])
      )
    ).toBe(true);
  });

  it('LambertW(e) → 1  [fungrim:c95c4f]', () => {
    expect(ce.expr(['LambertW', 'ExponentialE']).simplify().isSame(1)).toBe(
      true
    );
  });

  it('AGM(1, √2) → 2√2 π^(3/2)/Γ(1/4)² via replace() (cost-gated in simplify)  [fungrim:0d9352]', () => {
    const agm = ce.expr(['AGM', 1, ['Sqrt', 2]]);
    // The closed form is larger: simplify()'s 1.3× cost gate rejects it…
    expect(agm.simplify().isSame(agm)).toBe(true);
    // …but the loaded rule fires through replace()
    const closed = agm.replace(ce.getRuleSet('standard-simplification')!);
    expect(closed).not.toBeNull();
    expect(
      closed!.isEqual(
        ce.expr([
          'Divide',
          ['Multiply', 2, ['Sqrt', 2], ['Power', 'Pi', ['Divide', 3, 2]]],
          ['Power', ['Gamma', ['Divide', 1, 4]], 2],
        ])
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard controls (fail-closed runtime semantics, §2.2/§2.7)
// ---------------------------------------------------------------------------

describe('guard controls', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
  });

  it('positive: Sin(πk) → 0 for an integer-typed symbol  [fungrim:c62afa]', () => {
    ce.declare('k', 'integer');
    expect(
      ce.expr(['Sin', ['Multiply', 'Pi', 'k']]).simplify().isSame(0)
    ).toBe(true);
  });

  it('positive: Gamma(n+1) → n! with integer n ≥ 0 assumed  [fungrim:62c6c9]', () => {
    ce.declare('n', 'integer');
    ce.assume(ce.expr(['GreaterEqual', 'n', 0]));
    expect(
      ce.expr(['Gamma', ['Add', 'n', 1]]).simplify().isSame(
        ce.expr(['Factorial', 'n'])
      )
    ).toBe(true);
  });

  it('positive: ne guard provable on a literal — Conjugate(ζ₀(3)) → ζ₀(-3)  [fungrim:60c2ec]', () => {
    expect(
      ce.expr(['Conjugate', ['RiemannZetaZero', 3]]).simplify().isSame(
        ce.expr(['RiemannZetaZero', -3])
      )
    ).toBe(true);
  });

  it('positive: W₋₁(x·eˣ) → x for a real symbol ≤ −1  [fungrim:ed7dac]', () => {
    // The 2-arg branch form ["LambertW", x·eˣ, −1] simplifies to x only where
    // W₋₁ inverts x·eˣ, i.e. x ≤ −1 (guards: x real, x ≤ −1).
    ce.declare('w', 'real');
    ce.assume(ce.expr(['LessEqual', 'w', -1]));
    expect(
      ce
        .expr(['LambertW', ['Multiply', 'w', ['Exp', 'w']], -1])
        .simplify()
        .isSame(ce.expr('w'))
    ).toBe(true);
  });

  it('negative: W₋₁(x·eˣ) does NOT rewrite for a real symbol without the ≤ −1 guard', () => {
    ce.declare('u', 'real');
    const expr = ce.expr(['LambertW', ['Multiply', 'u', ['Exp', 'u']], -1]);
    expect(expr.simplify().operator).toBe('LambertW');
  });

  it('negative: Sin(πx) does NOT rewrite for a real (non-integer-typed) symbol', () => {
    ce.declare('x', 'real');
    const expr = ce.expr(['Sin', ['Multiply', 'Pi', 'x']]);
    expect(expr.simplify().isSame(expr)).toBe(true);
  });

  it('negative: Gamma(y+1) does NOT rewrite to a factorial for a real symbol', () => {
    ce.declare('y', 'real');
    const result = ce.expr(['Gamma', ['Add', 'y', 1]]).simplify();
    expect(result.operator).toBe('Gamma');
  });

  it('negative: ne guard undecidable for a symbolic integer — no rewrite', () => {
    // isEqual(m, 0) is undefined for a plain integer symbol, so the
    // fail-closed condition blocks the rule (fungrim:60c2ec).
    ce.declare('m', 'integer');
    const result = ce.expr(['Conjugate', ['RiemannZetaZero', 'm']]).simplify();
    expect(result.operator).toBe('Conjugate');
  });

  // SYM P3-7: every type guard (integer/rational/real/complex) requires
  // `isFinite !== false`. Fungrim's declared domains ZZ/QQ/RR/CC are FINITE,
  // so an identity guarded by them must not discharge at a ±∞ / ~∞ instance.
  // The subtlety: `(+∞).isReal === true`, so a `real` type guard would
  // fail-OPEN at infinity without the finiteness gate.
  it('negative P3-7: real-guarded rule does NOT fire at +∞  [fungrim:299209]', () => {
    // Im(e^{i·x}) → sin(x) is guarded `x : real`. A finite real fires (see
    // the positive control below); the infinite instance must be blocked.
    const inf = ce
      .box(
        [
          'Imaginary',
          ['Power', 'ExponentialE', ['Multiply', 'ImaginaryUnit', 'PositiveInfinity']],
        ],
        { canonical: false }
      )
      .simplify();
    // The finite-domain identity did NOT rewrite to sin(+∞): the head stays
    // Imaginary (fail-closed), it is not a Sin node.
    expect(inf.operator).not.toBe('Sin');
  });

  it('positive P3-7 control: the same real-guarded rule fires for a finite real  [fungrim:299209]', () => {
    ce.declare('r', 'real');
    const finite = ce
      .box([
        'Imaginary',
        ['Power', 'ExponentialE', ['Multiply', 'ImaginaryUnit', 'r']],
      ])
      .simplify();
    expect(finite.isSame(ce.expr(['Sin', 'r']))).toBe(true);
  });

  it('negative P3-7: Sin(πk) does NOT collapse to 0 when k is +∞  [fungrim:c62afa]', () => {
    // The integer type guard already excludes +∞ ((+∞).isInteger === false);
    // this locks that the finite-domain identity never yields 0 at infinity.
    const sinPiInf = ce
      .box(['Sin', ['Multiply', 'Pi', 'PositiveInfinity']], { canonical: false })
      .simplify();
    expect(sinPiInf.isSame(0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onGuardUndecided debug hook (§2.8)
// ---------------------------------------------------------------------------

describe('onGuardUndecided hook', () => {
  it('fires when a guard predicate returns undefined (and only then)', () => {
    const ce = new ComputeEngine();
    const undecided: { id: string; wildcards: string[] }[] = [];
    loadIdentities(ce, {
      onGuardUndecided: (ruleId, wildcards) =>
        undecided.push({ id: ruleId, wildcards: Object.keys(wildcards) }),
    });

    // Provable case: guard decides definitively, hook must not fire for
    // this rule
    ce.expr(['Conjugate', ['RiemannZetaZero', 3]]).simplify();
    expect(undecided.some((u) => u.id === 'fungrim:60c2ec')).toBe(false);

    // Undecidable case: `m ≠ 0` is unknown for a plain integer symbol —
    // the rule does not fire and the hook reports it, with the captured
    // wildcard substitution
    ce.declare('m', 'integer');
    ce.expr(['Conjugate', ['RiemannZetaZero', 'm']]).simplify();
    const hit = undecided.find((u) => u.id === 'fungrim:60c2ec');
    expect(hit).toBeDefined();
    expect(hit!.wildcards).toContain('_n');
  });
});

// ---------------------------------------------------------------------------
// Selection filters (§2.1)
// ---------------------------------------------------------------------------

describe('selection filters', () => {
  it('topics: loads only rules tagged with a requested topic', () => {
    const ce = new ComputeEngine();
    const report = loadIdentities(ce, { topics: ['gamma'] });
    const gammaCount = FUNGRIM_CORE.rules.filter((r) =>
      r.topics.includes('gamma')
    ).length;
    expect(report.loaded).toBe(gammaCount);
    expect(report.loaded).toBeGreaterThan(0);
    expect(
      report.skipped.filter((s) => s.reason === 'filtered-topic').length
    ).toBe(FUNGRIM_CORE.rules.length - gammaCount);
    // accounting: every rule is either loaded or skipped
    expect(report.loaded + report.skipped.length).toBe(
      FUNGRIM_CORE.rules.length
    );

    // a gamma rule fires…
    expect(
      ce.expr(['Gamma', ['Rational', 1, 2]]).simplify().isSame(
        ce.expr(['Sqrt', 'Pi'])
      )
    ).toBe(true);
    // …an atan rule was not loaded
    const atan = ce.expr(['Arctan', ['Add', 1, ['Sqrt', 2]]]);
    expect(atan.simplify().isSame(atan)).toBe(true);
  });

  it('classes: loads only the requested class', () => {
    const ce = new ComputeEngine();
    const report = loadIdentities(ce, { classes: ['identity'] });
    // Solve templates are class 'identity' too, but solve:false skips them
    // (solve-disabled) — so only the simplify-target identities load.
    const identityCount = FUNGRIM_CORE.rules.filter(
      (r) => r.class === 'identity' && r.target === 'simplify'
    ).length;
    expect(report.loaded).toBe(identityCount);
    expect(
      report.skipped.every(
        (s) =>
          s.reason === 'filtered-class' || s.reason === 'solve-disabled'
      )
    ).toBe(true);
    // a specific value is NOT loaded…
    const g = ce.expr(['Gamma', ['Rational', 1, 2]]);
    expect(g.simplify().isSame(g)).toBe(true);
    // …but an identity is
    ce.declare('k', 'integer');
    expect(
      ce.expr(['Sin', ['Multiply', 'Pi', 'k']]).simplify().isSame(0)
    ).toBe(true);
  });

  it('purposes: filters by rule purpose', () => {
    const ce = new ComputeEngine();
    const report = loadIdentities(ce, { purposes: ['expand'] });
    const expandCount = FUNGRIM_CORE.rules.filter(
      (r) => r.purpose === 'expand'
    ).length;
    expect(report.loaded).toBe(expandCount);
    expect(report.byPurpose).toEqual({
      simplify: 0,
      transform: 0,
      expand: expandCount,
    });
  });

  it('filters compose with idempotence (incremental loads)', () => {
    const ce = new ComputeEngine();
    const first = loadIdentities(ce, { topics: ['gamma'] });
    const second = loadIdentities(ce); // everything else
    // Both loads are solve:false, so only the simplify rules ever load.
    expect(first.loaded + second.loaded).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );
    expect(
      second.skipped.filter((s) => s.reason === 'already-loaded').length
    ).toBe(first.loaded);
  });
});

// ---------------------------------------------------------------------------
// Per-engine isolation
// ---------------------------------------------------------------------------

describe('per-engine isolation', () => {
  it('loading into one engine does not affect another', () => {
    const ceA = new ComputeEngine();
    const ceB = new ComputeEngine();
    const reportA = loadIdentities(ceA);
    expect(reportA.loaded).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );

    // ceB untouched: no fungrim rules, no shells, no simplification
    expect(
      ceB.simplificationRules.some(
        (r) =>
          typeof r === 'object' &&
          r !== null &&
          'id' in r &&
          typeof r.id === 'string' &&
          r.id.startsWith('fungrim:')
      )
    ).toBe(false);
    // (CarlsonRF is still shell-only; JacobiTheta is now an engine built-in)
    expect(ceB.lookupDefinition('CarlsonRF')).toBeUndefined();
    const g = ceB.expr(['Gamma', ['Rational', 1, 2]]);
    expect(g.simplify().isSame(g)).toBe(true);

    // …and ceB has its own idempotence tracking: a fresh load works fully
    const reportB = loadIdentities(ceB);
    expect(reportB.loaded).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );
  });
});

// ---------------------------------------------------------------------------
// SYM P3-8: shell declarations are scope-local (`ce.declare`), but rule
// objects live in the engine-global rule store. A load inside a pushed scope
// therefore leaves its rules alive after `popScope` while its shell heads go
// out of scope. Because the per-engine idempotence WeakMap marks those rule
// ids as already-loaded, the reload must NOT gate the shell pass on the
// already-loaded set — it re-declares the (now out-of-scope) shell heads.
// ---------------------------------------------------------------------------
describe('shell declarations survive popScope via reload (P3-8)', () => {
  it('re-declares shell heads on reload after the load scope is popped', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const first = loadIdentities(ce);
    expect(first.declared).toContain('CarlsonRF');
    expect(ce.lookupDefinition('CarlsonRF')).toBeDefined();
    expect(ce.expr(['CarlsonRF', 1, 2, 3]).isValid).toBe(true);

    // Pop the scope the shells were declared in: the shell head is gone.
    ce.popScope();
    expect(ce.lookupDefinition('CarlsonRF')).toBeUndefined();

    // Reload: the rule ids are already-loaded (loaded === 0), but the shell
    // pass runs unconditionally and re-declares the out-of-scope heads so the
    // still-registered rules remain usable.
    const second = loadIdentities(ce);
    expect(second.loaded).toBe(0);
    expect(second.declared).toContain('CarlsonRF');
    expect(ce.lookupDefinition('CarlsonRF')).toBeDefined();
    expect(ce.expr(['CarlsonRF', 1, 2, 3]).isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Solve/harmonization routing (§2.6 mechanism). The artifact ships the curated
// solve seeds (Phase 2), but harmonization routing has no shipped rules, so
// the routing plumbing is exercised with a synthetic artifact through the
// `data` option.
// ---------------------------------------------------------------------------

describe('solve routing', () => {
  const syntheticData: FungrimRuleData = {
    manifest: {
      schemaVersion: 1,
      generator: 'test',
      upstream: { name: 'test', snapshotSha256: null, translator: null },
      slice: { classes: ['identity'], guardLevels: ['none'], entries: 3 },
      counts: {
        rules: 3,
        byPurpose: { simplify: 3 },
        byClass: { identity: 3 },
        byTarget: { simplify: 1, solve: 1, harmonization: 1 },
      },
      ledger: {},
    },
    declarations: {},
    rules: [
      {
        id: 'fungrim:test-simplify',
        match: ['Sech', '_x'],
        replace: ['Divide', 1, ['Cosh', '_x']],
        guards: [],
        purpose: 'simplify',
        target: 'simplify',
        class: 'identity',
        heads: ['Sech'],
        topics: ['test'],
      },
      {
        id: 'fungrim:test-solve',
        match: ['Tanh', '_x'],
        replace: ['Arctanh', '_x'],
        guards: [],
        purpose: 'simplify',
        target: 'solve',
        class: 'identity',
        heads: ['Tanh'],
        topics: ['test'],
      },
      {
        id: 'fungrim:test-harmonization',
        match: ['Coth', '_x'],
        replace: ['Divide', 1, ['Tanh', '_x']],
        guards: [],
        purpose: 'simplify',
        target: 'harmonization',
        class: 'identity',
        heads: ['Coth'],
        topics: ['test'],
      },
    ],
  };

  const hasFungrimId = (rules: ReadonlyArray<unknown>, id: string) =>
    rules.some(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        'id' in r &&
        (r as { id?: unknown }).id === id
    );

  it('default (solve: false): solve/harmonization rules are skipped', () => {
    const ce = new ComputeEngine();
    const solveBefore = ce.solveRules.length;
    const harmonizationBefore = ce.harmonizationRules.length;
    const report = loadIdentities(ce, { data: syntheticData });

    expect(report.loaded).toBe(1);
    expect(report.byTarget).toEqual({ simplify: 1, solve: 0, harmonization: 0 });
    expect(report.skipped).toEqual([
      { id: 'fungrim:test-solve', reason: 'solve-disabled' },
      { id: 'fungrim:test-harmonization', reason: 'solve-disabled' },
    ]);
    expect(ce.solveRules.length).toBe(solveBefore);
    expect(ce.harmonizationRules.length).toBe(harmonizationBefore);
    expect(hasFungrimId(ce.simplificationRules, 'fungrim:test-simplify')).toBe(
      true
    );
  });

  it('solve: true routes templates to solveRules/harmonizationRules', () => {
    const ce = new ComputeEngine();
    const solveBefore = ce.solveRules.length;
    const harmonizationBefore = ce.harmonizationRules.length;
    const report = loadIdentities(ce, { data: syntheticData, solve: true });

    expect(report.loaded).toBe(3);
    expect(report.byTarget).toEqual({ simplify: 1, solve: 1, harmonization: 1 });
    expect(report.skipped).toEqual([]);
    expect(ce.solveRules.length).toBe(solveBefore + 1);
    expect(ce.harmonizationRules.length).toBe(harmonizationBefore + 1);
    expect(hasFungrimId(ce.solveRules, 'fungrim:test-solve')).toBe(true);
    expect(
      hasFungrimId(ce.harmonizationRules, 'fungrim:test-harmonization')
    ).toBe(true);
    // solve rules are NOT added to the simplification store
    expect(hasFungrimId(ce.simplificationRules, 'fungrim:test-solve')).toBe(
      false
    );
  });

  it('the artifact ships the curated solve templates (Phase 2)', () => {
    // The §2.6 solve seeds are derived into `:solve` rules by
    // apply-solve-templates.ts. They carry no domain guards (validateRoots is
    // the safety net) and are skipped on a default load.
    const solveRules = FUNGRIM_CORE.rules.filter((r) => r.target === 'solve');
    // 6 derived seed templates (incl. the ed7dac W₋₁ branch seed) + 4 curated
    // LambertW templates (linear-exp and exp-bare, each with a W₋₁ branch
    // companion).
    expect(solveRules.length).toBeGreaterThanOrEqual(10);
    for (const r of solveRules) {
      // Derived seed templates carry a 6-hex id; curated LambertW templates
      // (curation-overrides.json `solveTemplates`) carry a kebab-case id.
      expect(r.id).toMatch(
        /^fungrim:([0-9a-f]{6}|[a-z][a-z0-9]*(-[a-z0-9]+)+):solve$/
      );
      expect(r.guards).toEqual([]);
      // Root-template shape: match is `Add(…, __b)`, an Add of the inner
      // function term(s) and the constant offset.
      expect(Array.isArray(r.match) && (r.match as unknown[])[0]).toBe('Add');
    }
    // Default load skips them; {solve:true} routes them to ce.solveRules.
    const ceDefault = new ComputeEngine();
    expect(loadIdentities(ceDefault).byTarget.solve).toBe(0);

    const ce = new ComputeEngine();
    const report = loadIdentities(ce, { solve: true });
    expect(report.byTarget.solve).toBe(solveRules.length);
    expect(report.byTarget.harmonization).toBe(0);
  });
});

// ===========================================================================
// Phase 2 — solve-template acceptance (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md
// §2.6/§2.7). The curated seeds are derived into `:solve` rules by
// scripts/fungrim/apply-solve-templates.ts; here we verify the end-to-end
// solve() behavior with the real artifact loaded under { solve: true }.
//
// Each seed solves an equation `A(x) = c` to `x = f(c)` where the source
// identity `f(A(x)) = x` makes `f` the inverse of `A`. validateRoots checks
// every candidate against the original equation, so a root is returned only
// when it is genuinely correct.
// ===========================================================================

describe('Phase 2 — solve templates (loadIdentities { solve: true })', () => {
  function solved(eq: string, opts?: { solve: boolean }): number[] {
    const ce = new ComputeEngine();
    loadIdentities(ce, opts ?? { solve: true });
    const roots = ce.parse(eq).solve('x') as ReturnType<
      ComputeEngine['box']
    >[];
    return (roots ?? []).map((r) => r.N().re ?? NaN);
  }

  it('LambertW: x·eˣ = 3 → W(3)  [fungrim:8654a3:solve]', () => {
    const r = solved('x e^x = 3');
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(1.0499088949640398, 10); // W(3)
  });

  it('LambertW: x·eˣ = −0.1 → BOTH real roots via W₀ and W₋₁  [fungrim:ed7dac:solve]', () => {
    // For −1/e < c < 0 the equation x·eˣ = c has two real roots: the principal
    // branch W₀(c) (from fungrim:8654a3:solve) and the second branch W₋₁(c)
    // (from the ed7dac W₋₁ seed).
    const r = solved('x e^x = -0.1');
    expect(r.some((v) => Math.abs(v - -0.11183255915896297) < 1e-9)).toBe(true); // W₀(−0.1)
    expect(r.some((v) => Math.abs(v - -3.577152063957297) < 1e-9)).toBe(true); // W₋₁(−0.1)
    for (const v of r) expect(v * Math.exp(v)).toBeCloseTo(-0.1, 9);
  });

  it('LambertW: x·eˣ = −1/10 (EXACT rational RHS) → BOTH real roots via W₀ and W₋₁  [ROADMAP §F followup 2]', () => {
    // Regression for the exact-rational RHS of the product-inner LambertW shape.
    // `clearDenominators` now skips exact numeric-literal denominators, so
    // `x·eˣ + 1/10` is NOT rescaled to `10·x·eˣ + 1` and reaches the unscaled
    // product-inner template `Add(Multiply(_x, Exp(_x)), __b)` intact. Exact
    // input ⇒ exact (symbolic LambertW) roots per the exactness contract; assert
    // numerically via .N().
    const ce = new ComputeEngine();
    loadIdentities(ce, { solve: true });
    const roots = (ce.parse('x e^x = -\\frac1{10}').solve('x') ??
      []) as ReturnType<ComputeEngine['box']>[];
    // Exact symbolic roots (not floats): the operator head is LambertW.
    expect(roots.every((r) => r.operator === 'LambertW')).toBe(true);
    const r = roots.map((x) => x.N().re ?? NaN);
    expect(r.some((v) => Math.abs(v - -0.11183255915896297) < 1e-9)).toBe(true); // W₀(−1/10)
    expect(r.some((v) => Math.abs(v - -3.577152063957297) < 1e-9)).toBe(true); // W₋₁(−1/10)
    for (const v of r) expect(v * Math.exp(v)).toBeCloseTo(-0.1, 9);
  });

  it('Arctan: arctan(x) = 0.5 → tan(0.5)  [fungrim:1f026d:solve]', () => {
    const r = solved('\\arctan(x) = 0.5');
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(Math.tan(0.5), 10);
  });

  it('Tan: tan(x) = 2 → arctan(2)  [fungrim:f516e3:solve]', () => {
    const r = solved('\\tan(x) = 2');
    expect(r.some((v) => Math.abs(v - Math.atan(2)) < 1e-9)).toBe(true);
  });

  it('these equations are NOT solvable without { solve: true }', () => {
    // LambertW is the genuinely fungrim-only solve capability. (arctan/tan/
    // exp/ln solve templates are now built into base CE, so their fungrim
    // `:solve` rules are redundant — `\arctan(x) = 0.5` solves either way.)
    expect(solved('x e^x = 3', { solve: false })).toEqual([]);
  });

  it('a returned root is never wrong (validateRoots is the safety net)', () => {
    // x·eˣ = 3 has a single real root; the template must not invent extras.
    const r = solved('x e^x = 3');
    for (const v of r) expect(v * Math.exp(v)).toBeCloseTo(3, 9);
  });

  // ---------------------------------------------------------------------------
  // Scaled-coefficient generalization (benchmark T1). findUnivariateRoots runs
  // clearDenominators before rule matching, so a rational RHS `arctan(x) = 1/2`
  // is presented as `2·arctan(x) − 1 = 0`. The derived template matches the
  // scaled shape `Add(Multiply(__a, A(_x)), __b)` and inverts `A(x) = −__b/__a`.
  // ---------------------------------------------------------------------------

  it('scaled arctan (rational RHS, clearDenominators): arctan(x) = 1/2 → tan(1/2)  [T1]', () => {
    const r = solved('\\arctan x = \\frac12');
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(Math.tan(0.5), 10);
  });

  it('scaled Ln (rational RHS): ln(x) = 1/2 → √e', () => {
    const r = solved('\\ln x = \\frac12');
    expect(r.some((v) => Math.abs(v - Math.sqrt(Math.E)) < 1e-9)).toBe(true);
  });

  it('unscaled integer RHS still fires (__a = 1): tan(x) = 2 → arctan(2)', () => {
    const r = solved('\\tan x = 2');
    expect(r.some((v) => Math.abs(v - Math.atan(2)) < 1e-9)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Hand-curated LambertW solve templates (curation-overrides.json
  // `solveTemplates`; benchmark W2/W3/FR2). Not corpus-derivable — no
  // inverse-composition identity for `c·pᵐˣ + a·x + b` exists in the slice.
  // ---------------------------------------------------------------------------

  it('LambertW linear-exp: eˣ − x − 2 = 0 → both real roots via W₀ and W₋₁  [FR2, lambertw-linear-exp(-branch)]', () => {
    const r = solved('e^x - x - 2 = 0');
    // Principal branch: −2 − W₀(−e⁻²) ≈ −1.8414
    expect(r.some((v) => Math.abs(v - -1.8414056604369606) < 1e-9)).toBe(true);
    // Second real branch: −2 − W₋₁(−e⁻²) ≈ 1.1462
    expect(r.some((v) => Math.abs(v - 1.1461932206205825) < 1e-9)).toBe(true);
    for (const v of r) expect(Math.exp(v) - v - 2).toBeCloseTo(0, 8);
  });

  it('LambertW linear-exp-branch drops the NaN candidate for single-real-root shapes (W1: x·eˣ − 1 → one root)', () => {
    const r = solved('x e^x - 1 = 0');
    // Only the principal root; the W₋₁ companion argument (−1) is outside its
    // domain → NaN → validateRoots drops it (no spurious root).
    expect(r.length).toBe(1);
    expect(r[0]).toBeCloseTo(0.5671432904097838, 9);
  });

  it('LambertW exp-bare-branch: 0.8ˣ + x = 0 → second real root −W₋₁(ln 0.8)/ln 0.8', () => {
    const r = solved('0.8^x + x = 0');
    expect(r.some((v) => Math.abs(v - -10.565272633818234) < 1e-6)).toBe(true);
    for (const v of r) expect(Math.pow(0.8, v) + v).toBeCloseTo(0, 6);
  });

  it('LambertW exp-bare: eˣ + x = 0 → −W(1)  [W2, lambertw-exp-bare]', () => {
    const r = solved('e^x + x = 0');
    expect(r.some((v) => Math.abs(v - -0.5671432904097838) < 1e-9)).toBe(true);
  });

  it('LambertW exp-bare: x + 2ˣ = 0 → −W(ln2)/ln2  [W3, lambertw-exp-bare]', () => {
    const r = solved('x + 2^x = 0');
    expect(r.some((v) => Math.abs(v - -0.641185744504986) < 1e-9)).toBe(true);
  });
});

// ===========================================================================
// M5 — Curated before/after acceptance suite (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.7,
// §3 M5).
//
// Each case asserts the channel the rule actually serves (M2-documented
// behavior):
//   - simplify(): shrinking rules (purpose 'simplify', RHS within the 1.3×
//     cost gate),
//   - replace(getRuleSet('standard-simplification')): correct closed forms
//     that are structurally LARGER (Digamma(1/4), √i, Carlson values, …) —
//     rejected by simplify()'s cost gate by design,
//   - replace(ce.rules(ce.simplificationRules)): purpose-'expand' rules —
//     getRuleSet('standard-simplification') filters them out, so they are
//     reachable only through an explicitly boxed full set.
//
// Every expected output below was verified mathematically before being
// asserted (classic values: tan(π/12)=2−√3, ψ(1/4)=−γ−π/2−3ln2,
// R_F(0,1,2)=Γ(1/4)²/(4√(2π)), W(−1/e)=−1, φ(p)=p−1 for prime p, …).
// ===========================================================================

// ---------------------------------------------------------------------------
// M5 before/after — specific values, no assumptions (simplify() channel)
// ---------------------------------------------------------------------------

describe('M5 before/after: unguarded specific values via simplify()', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
  });

  const simplifiesTo = (input: unknown, expected: unknown) => {
    const result = ce.expr(input as Parameters<ComputeEngine['box']>[0]).simplify();
    const want = ce.expr(expected as Parameters<ComputeEngine['box']>[0]);
    expect(result.isSame(want) || result.isEqual(want) === true).toBe(true);
    // and specifically the *structural* target, not just numeric equality
    expect(result.isSame(want)).toBe(true);
  };

  // gamma
  it('Gamma(1) → 1  [fungrim:e68d11]', () =>
    simplifiesTo(['Gamma', 1], 1));

  // zeta / Hurwitz zeta / Stieltjes
  it('Zeta(2) → π²/6  [fungrim:a01b6e]', () =>
    simplifiesTo(['Zeta', 2], ['Divide', ['Power', 'Pi', 2], 6]));

  it('HurwitzZeta(3, 1) → ζ(3)  [fungrim:b4ed44]', () =>
    simplifiesTo(['HurwitzZeta', 3, 1], ['Zeta', 3]));

  it('HurwitzZeta(2, 1/2) → π²/2  [fungrim:868061]', () =>
    simplifiesTo(
      ['HurwitzZeta', 2, ['Rational', 1, 2]],
      ['Divide', ['Power', 'Pi', 2], 2]
    ));

  it('HurwitzZeta(0, 0) → 1/2  [fungrim:150b3e]', () =>
    simplifiesTo(['HurwitzZeta', 0, 0], ['Rational', 1, 2]));

  it('StieltjesGamma(0, 1) → EulerGamma  [fungrim:8ae153]', () =>
    simplifiesTo(['StieltjesGamma', 0, 1], 'EulerGamma'));

  // arctan specific values (none of these are simplified by the base engine)
  it('Arctan(√3) → π/3  [fungrim:706783]', () =>
    simplifiesTo(['Arctan', ['Sqrt', 3]], ['Divide', 'Pi', 3]));

  it('Arctan(√3/3) → π/6  [fungrim:3c1021]', () =>
    simplifiesTo(
      ['Arctan', ['Divide', ['Sqrt', 3], 3]],
      ['Divide', 'Pi', 6]
    ));

  it('Arctan(2 − √3) → π/12  [fungrim:7dd050]', () =>
    simplifiesTo(['Arctan', ['Subtract', 2, ['Sqrt', 3]]], ['Divide', 'Pi', 12]));

  it('Arctan(√2 − 1) → π/8  [fungrim:a9ecff]', () =>
    simplifiesTo(['Arctan', ['Add', -1, ['Sqrt', 2]]], ['Divide', 'Pi', 8]));

  it('Arctan(2 + √3) → 5π/12  [fungrim:b0049f]', () =>
    simplifiesTo(
      ['Arctan', ['Add', 2, ['Sqrt', 3]]],
      ['Divide', ['Multiply', 5, 'Pi'], 12]
    ));

  // sinc (the base engine leaves Sinc(π/2) untouched)
  it('Sinc(π/2) → 2/π  [fungrim:fdc94c]', () =>
    simplifiesTo(['Sinc', ['Divide', 'Pi', 2]], ['Divide', 2, 'Pi']));

  it('Sinc(π/6) → 3/π  [fungrim:45740a]', () =>
    simplifiesTo(['Sinc', ['Divide', 'Pi', 6]], ['Divide', 3, 'Pi']));

  // exp
  it('e^{iπ/2} → i  [fungrim:a90f35]', () =>
    simplifiesTo(
      ['Power', 'ExponentialE', ['Divide', ['Multiply', 'ImaginaryUnit', 'Pi'], 2]],
      'ImaginaryUnit'
    ));

  // lambertw
  it('LambertW(0) → 0  [fungrim:0be17d]', () =>
    simplifiesTo(['LambertW', 0], 0));

  // totient — `eval` guard (IsPrime) provable on a literal prime
  it('Totient(7) → 6 (eval guard: IsPrime(7) ⇒ True)  [fungrim:cb410e]', () =>
    simplifiesTo(['Totient', 7], 6));
});

// ---------------------------------------------------------------------------
// M5 before/after — guarded identities under assumptions (simplify() channel)
// ---------------------------------------------------------------------------

describe('M5 before/after: guarded identities via simplify()', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
    // n: positive integer (⇒ n ≥ 0, n > 0 and integer guards all decidable)
    ce.declare('n', 'integer');
    ce.assume(ce.expr(['Greater', 'n', 0]));
    // k: plain integer (type guard only)
    ce.declare('k', 'integer');
    // p: positive real (⇒ p ≥ −1 decidable)
    ce.declare('p', 'real');
    ce.assume(ce.expr(['Greater', 'p', 0]));
    // q: real > 1 (⇒ q ≥ 1/e decidable — composite bound, exercises the
    // numeric-retry path of the cmp guard closure)
    ce.declare('q', 'real');
    ce.assume(ce.expr(['Greater', 'q', 1]));
    // u: real in (0, 1/4] (⇒ the banded guards 0 < u ≤ 1/e of a172c7 both
    // decidable — the composite 1/e bound discharges numerically against the
    // stored rational upper bound)
    ce.declare('u', 'real');
    ce.assume(ce.expr(['Greater', 'u', 0]));
    ce.assume(ce.expr(['LessEqual', 'u', ['Rational', 1, 4]]));
  });

  const simplifiesTo = (input: unknown, expected: unknown) => {
    const result = ce.expr(input as Parameters<ComputeEngine['box']>[0]).simplify();
    expect(
      result.isSame(ce.expr(expected as Parameters<ComputeEngine['box']>[0]))
    ).toBe(true);
  };

  // trig, type guard only
  it('Sin(πk + π/2) → (−1)^k for integer k  [fungrim:506d0c]', () =>
    simplifiesTo(
      ['Sin', ['Add', ['Multiply', 'Pi', 'k'], ['Multiply', ['Rational', 1, 2], 'Pi']]],
      ['Power', -1, 'k']
    ));

  // factorials, type + cmp(gt 0) guards
  it('n·(n−1)! → n! for integer n > 0  [fungrim:4f20ff]', () =>
    simplifiesTo(
      ['Multiply', 'n', ['Factorial', ['Add', 'n', -1]]],
      ['Factorial', 'n']
    ));

  // factorials, type + cmp(ge 0) guards
  it('(2n)!/(n!)² → Binomial(2n, n) for integer n ≥ 0  [fungrim:0d92f6]', () =>
    simplifiesTo(
      ['Divide', ['Factorial', ['Multiply', 2, 'n']], ['Square', ['Factorial', 'n']]],
      ['Binomial', ['Multiply', 2, 'n'], 'n']
    ));

  // Lambert W₋₁ (2-arg), banded cmp guards (gt 0, le 1/e). Compiles since the
  // upstream a172c7 assumption-interval fix (the band was empty as published:
  // OpenClosedInterval(0, −1/e)); fork commit 7ab84ea.
  it('W₋₁(u·ln u) → ln u for real 0 < u ≤ 1/4  [fungrim:a172c7]', () =>
    simplifiesTo(
      ['LambertW', ['Multiply', 'u', ['Ln', 'u']], -1],
      ['Ln', 'u']
    ));

  it('W₋₁(p·ln p) stays inert without an upper bound inside (0, 1/e]', () => {
    const r = ce
      .expr(['LambertW', ['Multiply', 'p', ['Ln', 'p']], -1])
      .simplify();
    expect(r.operator).toBe('LambertW');
  });

  // digamma, recognition direction (large match → small replace)
  it('HarmonicNumber(n−1) − γ → Digamma(n) for integer n > 0  [fungrim:00c02a]', () =>
    simplifiesTo(
      ['Subtract', ['HarmonicNumber', ['Add', 'n', -1]], 'EulerGamma'],
      ['Digamma', 'n']
    ));

  // polygamma (2-arg DigammaFunction upstream, translated to the native
  // PolyGamma head since fork ce338d5 — these entries were compat-signature
  // compile skips before)
  it('PolyGamma(1, 1) → π²/6', () =>
    simplifiesTo(
      ['PolyGamma', 1, 1],
      ['Multiply', ['Rational', 1, 6], ['Square', 'Pi']]
    ));

  it('PolyGamma(1, 1/4) → π² + 8·Catalan  [fungrim:2744d4]', () =>
    simplifiesTo(
      ['PolyGamma', 1, ['Rational', 1, 4]],
      ['Add', ['Square', 'Pi'], ['Multiply', 8, 'CatalanConstant']]
    ));

  it('Digamma(2) → 1 − γ  [fungrim:ada157]', () =>
    simplifiesTo(['Digamma', 2], ['Subtract', 1, 'EulerGamma']));

  it('Digamma(−n) → ComplexInfinity for integer n ≥ 0  [fungrim:42c1f5]', () =>
    simplifiesTo(['Digamma', ['Negate', 'n']], 'ComplexInfinity'));

  // chebyshev, type guard only
  it('ChebyshevT(n, 1) → 1 for integer n  [fungrim:fc5d42]', () =>
    simplifiesTo(['ChebyshevT', 'n', 1], 1));

  it('ChebyshevU(n, 1) → n + 1 for integer n  [fungrim:e03fa4]', () =>
    simplifiesTo(['ChebyshevU', 'n', 1], ['Add', 'n', 1]));

  // totient, type + cmp guards
  it('Totient(2^n) → 2^(n−1) for integer n > 0  [fungrim:081abd]', () =>
    simplifiesTo(
      ['Totient', ['Power', 2, 'n']],
      ['Power', 2, ['Subtract', 'n', 1]]
    ));

  // fibonacci, type guard only
  it('GCD(Fibonacci(n), Fibonacci(n+1)) → 1 for integer n  [fungrim:7b0abf]', () =>
    simplifiesTo(
      ['GCD', ['Fibonacci', 'n'], ['Fibonacci', ['Add', 'n', 1]]],
      1
    ));

  // lambertw inverse compositions, type + cmp guards (real-simple slice)
  it('W(p·e^p) → p for real p > 0 (≥ −1 guard)  [fungrim:8654a3]', () =>
    simplifiesTo(['LambertW', ['Multiply', 'p', ['Exp', 'p']]], 'p'));

  it('W(q·ln q) → ln q for real q > 1 (≥ 1/e composite bound)  [fungrim:30bd5b]', () =>
    simplifiesTo(['LambertW', ['Multiply', 'q', ['Ln', 'q']]], ['Ln', 'q']));
});

// ---------------------------------------------------------------------------
// M5 before/after — growth rules via replace() (cost-gated in simplify(),
// M2-documented behavior: large closed forms are reachable only through
// expr.replace())
// ---------------------------------------------------------------------------

describe('M5 before/after: cost-gated closed forms via replace()', () => {
  let ce: ComputeEngine;
  let rs: NonNullable<ReturnType<ComputeEngine['getRuleSet']>>;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
    rs = ce.getRuleSet('standard-simplification')!;
  });

  const replacesTo = (input: unknown, expected: unknown) => {
    const result = ce
      .expr(input as Parameters<ComputeEngine['box']>[0])
      .replace(rs);
    expect(result).not.toBeNull();
    expect(
      result!.isEqual(ce.expr(expected as Parameters<ComputeEngine['box']>[0]))
    ).toBe(true);
  };

  it('Digamma(1/4) → −π/2 − γ − 3 ln 2  [fungrim:7ec4f0]', () =>
    replacesTo(
      ['Digamma', ['Rational', 1, 4]],
      [
        'Subtract',
        ['Subtract', ['Negate', ['Divide', 'Pi', 2]], 'EulerGamma'],
        ['Multiply', 3, ['Ln', 2]],
      ]
    ));

  it('Digamma(1/6) → −(√3 π)/2 − 2 ln 2 − (3/2) ln 3 − γ  [fungrim:177de7]', () =>
    replacesTo(
      ['Digamma', ['Rational', 1, 6]],
      [
        'Subtract',
        [
          'Subtract',
          [
            'Subtract',
            ['Negate', ['Divide', ['Multiply', ['Sqrt', 3], 'Pi'], 2]],
            ['Multiply', 2, ['Ln', 2]],
          ],
          ['Multiply', ['Rational', 3, 2], ['Ln', 3]],
        ],
        'EulerGamma',
      ]
    ));

  it('√i → (1/√2)(1 + i)  [fungrim:0ad836]', () =>
    replacesTo(
      ['Sqrt', 'ImaginaryUnit'],
      ['Multiply', ['Divide', 1, ['Sqrt', 2]], ['Add', 1, 'ImaginaryUnit']]
    ));

  it('Ln(i) → iπ/2  [fungrim:c331da]', () =>
    replacesTo(
      ['Ln', 'ImaginaryUnit'],
      ['Divide', ['Multiply', 'ImaginaryUnit', 'Pi'], 2]
    ));

  it('CarlsonRF(0, 1, 2) → Γ(1/4)²/(4√(2π))  [fungrim:28237a]', () =>
    replacesTo(
      ['CarlsonRF', 0, 1, 2],
      [
        'Divide',
        ['Power', ['Gamma', ['Divide', 1, 4]], 2],
        ['Multiply', 4, ['Sqrt', ['Multiply', 2, 'Pi']]],
      ]
    ));

  // W(−1/e) = −1 since (−1)·e^{−1} = −1/e. The match form drifts from the
  // canonical operand produced inside simplify()'s traversal, so this value
  // currently fires only through top-level replace().
  it('W(−1/e) → −1  [fungrim:b93d09]', () =>
    replacesTo(['LambertW', ['Negate', ['Divide', 1, 'ExponentialE']]], -1));
});

// ---------------------------------------------------------------------------
// M5 before/after — purpose 'expand' channel: filtered out of both simplify()
// AND getRuleSet('standard-simplification'); reachable only via an explicitly
// boxed full rule set
// ---------------------------------------------------------------------------

describe("M5 before/after: purpose 'expand' rules", () => {
  let ce: ComputeEngine;
  let allRules: ReturnType<ComputeEngine['rules']>;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
    ce.declare('n', 'integer');
    ce.assume(ce.expr(['Greater', 'n', 0]));
    // Box the FULL simplification store — including the 17 'expand' rules
    // that getRuleSet('standard-simplification') filters out
    allRules = ce.rules(ce.simplificationRules);
  });

  const expandsTo = (input: unknown, expected: unknown) => {
    const boxed = ce.expr(input as Parameters<ComputeEngine['box']>[0]);
    // not via simplify() …
    expect(boxed.simplify().isSame(boxed)).toBe(true);
    // … and not via the standard (expand-filtered) rule set …
    expect(boxed.replace(ce.getRuleSet('standard-simplification')!)).toBeNull();
    // … but via the full set
    const result = boxed.replace(allRules);
    expect(result).not.toBeNull();
    expect(
      result!.isSame(ce.expr(expected as Parameters<ComputeEngine['box']>[0]))
    ).toBe(true);
  };

  it('RisingFactorial(1, n) → n!  [fungrim:0feb19]', () =>
    expandsTo(['RisingFactorial', 1, 'n'], ['Factorial', 'n']));

  it('BernoulliPolynomial(n, 0) → BernoulliB(n)  [fungrim:a1d2d7]', () =>
    expandsTo(['BernoulliPolynomial', 'n', 0], ['BernoulliB', 'n']));

  it('ChebyshevU(n, −1) → (−1)^n (n + 1)  [fungrim:be9a45]', () =>
    expandsTo(
      ['ChebyshevU', 'n', -1],
      ['Multiply', ['Power', -1, 'n'], ['Add', 'n', 1]]
    ));

  it('StieltjesGamma(n, 1) → StieltjesGamma(n)  [fungrim:51206a]', () =>
    expandsTo(['StieltjesGamma', 'n', 1], ['StieltjesGamma', 'n']));
});

// ---------------------------------------------------------------------------
// Hot-head pre-screened dispatch (§2.4 fallback; M5 benchmark fix)
//
// Rules whose canonical match head is a high-traffic arithmetic operator
// (Multiply, Add, Divide, Power, …) are registered by the loader as
// pre-screened FUNCTIONAL rules with an `operators` dispatch hint, instead
// of plain pattern rules — see loader.ts. These tests pin the registration
// shape and, more importantly, that the wrapped rules behave identically to
// pattern rules through every engine channel.
// ---------------------------------------------------------------------------

describe('hot-head pre-screened dispatch', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
  });

  it('registers one entry per rule (hot-head rules are functional with an operators hint)', () => {
    const fungrim = ce.simplificationRules.filter(
      (r): r is Extract<typeof r, object> =>
        typeof r === 'object' &&
        r !== null &&
        'id' in r &&
        typeof r.id === 'string' &&
        r.id.startsWith('fungrim:')
    );
    // Default load: only simplify-target rules are registered.
    expect(fungrim.length).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );

    // fungrim:4f20ff (n·(n−1)! → n!) has a Multiply match head: functional
    // wrapper with the dispatch hint, keeping its own id and purpose
    const hot = fungrim.find((r) => r.id === 'fungrim:4f20ff')!;
    expect(hot).toBeDefined();
    expect(typeof hot.replace).toBe('function');
    expect(hot.operators).toEqual(['Multiply']);

    // fungrim:f826a6 (Gamma(1/2) → √π) is in a low-traffic bucket: still a
    // plain pattern rule (the M2 index dispatches it by head)
    const cold = fungrim.find((r) => r.id === 'fungrim:f826a6')!;
    expect(cold).toBeDefined();
    expect(typeof cold.replace).not.toBe('function');
    expect(cold.operators).toBeUndefined();
  });

  it('wrapped rules fire through simplify() (Multiply head)  [fungrim:4f20ff]', () => {
    ce.declare('n', 'integer');
    ce.assume(ce.expr(['Greater', 'n', 0]));
    expect(
      ce.expr(['Multiply', 'n', ['Factorial', ['Add', 'n', -1]]])
        .simplify()
        .isSame(ce.expr(['Factorial', 'n']))
    ).toBe(true);
  });

  it('wrapped rules fire through an explicitly boxed full rule set  [fungrim:4f20ff]', () => {
    // The subtle channel: ce.rules(ce.simplificationRules) boxes the raw
    // rule list (no purpose filtering, no engine cache) — the functional
    // wrappers must fire there too.
    const allRules = ce.rules(ce.simplificationRules);
    const result = ce
      .expr(['Multiply', 'n', ['Factorial', ['Add', 'n', -1]]])
      .replace(allRules);
    expect(result).not.toBeNull();
    expect(result!.isSame(ce.expr(['Factorial', 'n']))).toBe(true);
  });

  it('wrapped rules honor guards fail-closed and the onGuardUndecided hook', () => {
    const ce2 = new ComputeEngine();
    const undecided: { id: string; wildcards: string[] }[] = [];
    loadIdentities(ce2, {
      onGuardUndecided: (ruleId, wildcards) =>
        undecided.push({ id: ruleId, wildcards: Object.keys(wildcards) }),
    });

    // m: integer of unknown sign — the `m > 0` cmp guard of fungrim:4f20ff
    // (a wrapped Multiply-head rule) is undecided: no rewrite, hook fires
    ce2.declare('m', 'integer');
    const expr = ce2.expr(['Multiply', 'm', ['Factorial', ['Add', 'm', -1]]]);
    expect(expr.simplify().isSame(expr)).toBe(true);
    const hit = undecided.find((u) => u.id === 'fungrim:4f20ff');
    expect(hit).toBeDefined();
    expect(hit!.wildcards).toContain('_n');
  });

  it('pre-screen is conservative: hot-head rules with symbol-only requirements still fire', () => {
    // fungrim:a90f35 (e^{iπ/2} → i) has a Power match head whose only
    // discriminating features are the symbols ExponentialE/ImaginaryUnit/Pi
    expect(
      ce
        .expr([
          'Power',
          'ExponentialE',
          ['Divide', ['Multiply', 'ImaginaryUnit', 'Pi'], 2],
        ])
        .simplify()
        .isSame(ce.expr('ImaginaryUnit'))
    ).toBe(true);
  });

  it('plain arithmetic simplification is unchanged by the load', () => {
    // The M5 profiling exemplar: simplifying `2a < 4b` must produce the
    // same result with and without the artifact loaded.
    const ceBase = new ComputeEngine();
    const inputs = ['2a<4b', '\\frac{x^2-1}{x-1}', '\\sqrt{8}+\\sin(\\pi/6)'];
    for (const src of inputs) {
      expect(ce.parse(src).simplify().toString()).toBe(
        ceBase.parse(src).simplify().toString()
      );
    }
  });
});

// ===========================================================================
// Phase 3 — complex-domain guards (part-cmp / member / type:complex), per
// the Phase-3 compiler extension. Two layers:
//   1. synthetic-artifact closure-semantics tests (precise three-valued
//      behavior of each new guard kind, incl. the onGuardUndecided hook),
//   2. real-corpus theta/modular acceptance (HH membership via the Track-3
//      stored-membership fact path).
// ===========================================================================

describe('Phase 3: artifact carries complex-domain rules', () => {
  it('contains the new guard kinds and the theta/modular/hypergeometric topics', () => {
    const kinds = new Set(
      FUNGRIM_CORE.rules.flatMap((r) => r.guards.map((g) => g.k))
    );
    expect(kinds.has('part-cmp')).toBe(true);
    expect(kinds.has('member')).toBe(true);
    expect(
      FUNGRIM_CORE.rules.some((r) =>
        r.guards.some((g) => g.k === 'type' && g.t === 'complex')
      )
    ).toBe(true);

    const topics = new Set(FUNGRIM_CORE.rules.flatMap((r) => r.topics));
    for (const t of [
      'jacobi_theta',
      'dedekind_eta',
      'modular_j',
      'modular_lambda',
      'eisenstein',
      'gauss_hypergeometric',
      'confluent_hypergeometric',
    ])
      expect(topics.has(t)).toBe(true);

    // HH is declared as a shell so member guards box validly
    expect(FUNGRIM_CORE.declarations['HH']).toBeDefined();
  });
});

describe('Phase 3: guard-closure semantics (synthetic artifact)', () => {
  const syntheticData: FungrimRuleData = {
    manifest: {
      schemaVersion: 1,
      generator: 'test',
      upstream: { name: 'test', snapshotSha256: null, translator: null },
      slice: { classes: ['identity'], guardLevels: ['complex-domain'], entries: 3 },
      counts: {
        rules: 3,
        byPurpose: { simplify: 3 },
        byClass: { identity: 3 },
        byTarget: { simplify: 3 },
      },
      ledger: {},
    },
    declarations: {
      HH: { signature: 'set<complex>' },
      PartCmpF: { signature: '(complex) -> complex' },
      MemberF: { signature: '(complex) -> complex' },
      ComplexF: { signature: '(complex) -> complex' },
    },
    rules: [
      {
        id: 'fungrim:test-part-cmp',
        match: ['PartCmpF', '_z'],
        replace: 0,
        guards: [{ k: 'part-cmp', wc: '_z', part: 're', op: 'gt', bound: 0 }],
        purpose: 'simplify',
        target: 'simplify',
        class: 'identity',
        heads: ['PartCmpF'],
        topics: ['test'],
      },
      {
        id: 'fungrim:test-member',
        match: ['MemberF', '_tau'],
        replace: 0,
        guards: [{ k: 'member', wc: '_tau', set: 'HH' }],
        purpose: 'simplify',
        target: 'simplify',
        class: 'identity',
        heads: ['MemberF'],
        topics: ['test'],
      },
      {
        id: 'fungrim:test-complex',
        match: ['ComplexF', '_z'],
        replace: 0,
        guards: [{ k: 'type', wc: '_z', t: 'complex' }],
        purpose: 'simplify',
        target: 'simplify',
        class: 'identity',
        heads: ['ComplexF'],
        topics: ['test'],
      },
    ],
  };

  const load = (
    onGuardUndecided?: (id: string, wc: object) => void
  ): ComputeEngine => {
    const ce = new ComputeEngine();
    loadIdentities(ce, { data: syntheticData, onGuardUndecided });
    return ce;
  };

  it('part-cmp: literal substitutions fold numerically (three-valued)', () => {
    const ce = load();
    // Re(2 + 3i) = 2 > 0: fires
    expect(
      ce.expr(['PartCmpF', ['Complex', 2, 3]]).simplify().isSame(0)
    ).toBe(true);
    // Re(−1) = −1: definitively violated, no fire
    const neg = ce.expr(['PartCmpF', -1]);
    expect(neg.simplify().isSame(neg)).toBe(true);
  });

  it('part-cmp: symbol substitutions consult the Track-3 part-bound facts', () => {
    const ce = load();
    ce.declare('s', 'complex');
    ce.assume(ce.expr(['Greater', ['Real', 's'], 1], { canonical: false }));
    expect(ce.expr(['PartCmpF', 's']).simplify().isSame(0)).toBe(true);
    // unconstrained symbol: undecided, fail-closed
    ce.declare('v', 'complex');
    const expr = ce.expr(['PartCmpF', 'v']);
    expect(expr.simplify().isSame(expr)).toBe(true);
  });

  it('part-cmp: onGuardUndecided fires for undecided, not for refuted', () => {
    const undecided: string[] = [];
    const ce = load((id) => undecided.push(id));
    ce.declare('v', 'complex');
    ce.expr(['PartCmpF', 'v']).simplify(); // Re(v) > 0 unknown
    expect(undecided).toContain('fungrim:test-part-cmp');
    undecided.length = 0;
    ce.expr(['PartCmpF', -1]).simplify(); // Re(−1) > 0 definitively false
    expect(undecided).not.toContain('fungrim:test-part-cmp');
  });

  it('member: discharges via the stored-membership exact match, NOT via literals', () => {
    const ce = load();
    ce.declare('tau', 'complex');
    ce.assume(ce.expr(['Element', 'tau', 'HH'], { canonical: false }));
    expect(ce.expr(['MemberF', 'tau']).simplify().isSame(0)).toBe(true);
    // KEY ENCODING FACT: HH is an inert shell with NO contains handler —
    // a literal (even i, which IS in the upper half-plane) stays undecided
    const lit = ce.expr(['MemberF', 'ImaginaryUnit']);
    expect(lit.simplify().isSame(lit)).toBe(true);
  });

  it('member: onGuardUndecided fires for the inert-set literal', () => {
    const undecided: string[] = [];
    const ce = load((id) => undecided.push(id));
    ce.expr(['MemberF', 'ImaginaryUnit']).simplify();
    expect(undecided).toContain('fungrim:test-member');
  });

  it('type complex: literals and declared-complex symbols pass; unknown stays undecided', () => {
    const ce = load();
    // finite complex literal
    expect(
      ce.expr(['ComplexF', ['Complex', 1, 2]]).simplify().isSame(0)
    ).toBe(true);
    // declared complex symbol
    ce.declare('z', 'complex');
    expect(ce.expr(['ComplexF', 'z']).simplify().isSame(0)).toBe(true);
    // infinity is NOT a finite complex number
    const inf = ce.expr(['ComplexF', 'PositiveInfinity']);
    expect(inf.simplify().isSame(inf)).toBe(true);
  });

  it('type complex: real/rational/integer-declared symbols satisfy the guard (SYM P1-21)', () => {
    // The pack's RR/ZZ/QQ are finite-domain like CC, so a symbol declared
    // real/rational/integer (or a finite_ variant — all subtypes of `real`)
    // now discharges a `complex` (finite-complex) guard. Previously the
    // Element(z, ℂ) fallback stayed undecided (fail-closed), blocking the
    // 68% complex-domain slice under the most natural `declare(z,'real')`.
    for (const t of [
      'real',
      'integer',
      'rational',
      'finite_real',
      'finite_integer',
      'finite_rational',
    ]) {
      const ce = load();
      ce.declare('z', t as Parameters<ComputeEngine['declare']>[1]);
      expect(ce.expr(['ComplexF', 'z']).simplify().isSame(0)).toBe(true);
    }
  });

  it('type complex: a PROVABLY-infinite literal (±∞, complex ∞) still stays undecided', () => {
    // The real/rational/integer acceptance must not leak to genuine
    // infinities: `non_finite_number` (±∞) matches `real` in the lattice but
    // has isFinite === false, and ComplexInfinity is not finite either.
    for (const inf of ['PositiveInfinity', 'NegativeInfinity', 'ComplexInfinity']) {
      const ce = load();
      const e = ce.expr(['ComplexF', inf]);
      expect(e.simplify().isSame(e)).toBe(true);
    }
  });
});

describe('Phase 3: complex-guard rules under a real declaration (SYM P1-21)', () => {
  // A complex-guarded corpus rule (fungrim:072166, Arctan(iz) → i·Artanh(z),
  // whose only guard is a `type:complex` on the single wildcard) must fire
  // for a real/integer/rational-declared subject, exactly as it does for a
  // complex one — the pack treats RR/ZZ/QQ as finite-domain like CC.
  const fires = (decl: string): boolean => {
    const ce = new ComputeEngine();
    loadIdentities(ce);
    ce.declare('z', decl as Parameters<ComputeEngine['declare']>[1]);
    const all = ce.rules(ce.simplificationRules);
    const out = ce.expr(['Arctan', ['Multiply', 'ImaginaryUnit', 'z']]).replace(all);
    return (
      out !== null &&
      out.isSame(ce.expr(['Multiply', 'ImaginaryUnit', ['Artanh', 'z']]))
    );
  };

  it('fires for complex, real, integer and rational subjects  [fungrim:072166]', () => {
    for (const d of ['complex', 'real', 'integer', 'rational'])
      expect(fires(d)).toBe(true);
  });

  it('NO wrong result: a genuinely-non-real guard (Im(τ) > 0 / HH) still blocks a real τ', () => {
    // fungrim:42a909 (j(τ+1) → j(τ)) carries an HH member guard that
    // compiles to Im(τ) > 0. For a real τ, Im(τ) = 0, so the guard is
    // definitively violated and the rule must not fire — the complex-guard
    // relaxation above does not weaken the genuinely-complex requirement.
    const ce = new ComputeEngine();
    loadIdentities(ce);
    ce.declare('tau', 'real');
    const j = ce.expr(['ModularJ', ['Add', 'tau', 1]]);
    expect(j.simplify().isSame(j)).toBe(true);
    // …and it DOES fire once Im(τ) > 0 is known
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('tau', 'complex');
    ce2.assume(ce2.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false }));
    expect(
      ce2.expr(['ModularJ', ['Add', 'tau', 1]]).simplify().isSame(
        ce2.expr(['ModularJ', 'tau'])
      )
    ).toBe(true);
  });
});

describe('Phase 3: theta/modular acceptance (real corpus, Im(τ) > 0 assumptions)', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
    ce.declare('tau', 'complex');
    // HH (upper half-plane) guards compile to Im(τ) > 0; discharge goes
    // through the part-cmp machinery, so seed the part inequality directly.
    ce.assume(ce.expr(['Greater', ['Imaginary', 'tau'], 0], { canonical: false }));
    ce.declare('z', 'complex');
    ce.declare('m', 'integer');
  });

  it('Jacobi identity: θ₂(0,τ)⁴ + θ₄(0,τ)⁴ → θ₃(0,τ)⁴  [fungrim:1fbc09]', () => {
    expect(
      ce
        .expr([
          'Add',
          ['Power', ['JacobiTheta', 2, 0, 'tau'], 4],
          ['Power', ['JacobiTheta', 4, 0, 'tau'], 4],
        ])
        .simplify()
        .isSame(ce.expr(['Power', ['JacobiTheta', 3, 0, 'tau'], 4]))
    ).toBe(true);
  });

  it('theta periodicity: θ₄(z, 2m + τ) → θ₄(z, τ)  [fungrim:19acd8]', () => {
    expect(
      ce
        .expr(['JacobiTheta', 4, 'z', ['Add', ['Multiply', 2, 'm'], 'tau']])
        .simplify()
        .isSame(ce.expr(['JacobiTheta', 4, 'z', 'tau']))
    ).toBe(true);
  });

  it('modular j periodicity: j(τ + 1) → j(τ)  [fungrim:42a909]', () => {
    expect(
      ce.expr(['ModularJ', ['Add', 'tau', 1]]).simplify().isSame(
        ce.expr(['ModularJ', 'tau'])
      )
    ).toBe(true);
  });

  it('modular λ inversion: λ(−1/τ) → 1 − λ(τ) via replace()  [fungrim:07bf27]', () => {
    // Slightly larger RHS: cost-gated in simplify(), reachable via replace()
    const rs = ce.getRuleSet('standard-simplification')!;
    const result = ce
      .expr(['ModularLambda', ['Negate', ['Divide', 1, 'tau']]])
      .replace(rs);
    expect(result).not.toBeNull();
    expect(
      result!.isSame(ce.expr(['Subtract', 1, ['ModularLambda', 'tau']]))
    ).toBe(true);
  });

  it('definitional expansions are exiled to expand: ModularJ(τ) does not explode in simplify()', () => {
    // fungrim:664b4c (j(τ) → Dedekind-eta quotient) is a bare-generic-match
    // definitional expansion: purpose 'expand', out of simplify()'s scan
    const j = ce.expr(['ModularJ', 'tau']);
    expect(j.simplify().isSame(j)).toBe(true);
    const rule = FUNGRIM_CORE.rules.find((r) => r.id === 'fungrim:664b4c')!;
    expect(rule.purpose).toBe('expand');
  });

  it('negative controls: no rewrite without the HH assumption', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    ce2.declare('sigma', 'complex');
    const theta = ce2.expr([
      'Add',
      ['Power', ['JacobiTheta', 2, 0, 'sigma'], 4],
      ['Power', ['JacobiTheta', 4, 0, 'sigma'], 4],
    ]);
    expect(theta.simplify().isSame(theta)).toBe(true);
    const j = ce2.expr(['ModularJ', ['Add', 'sigma', 1]]);
    expect(j.simplify().isSame(j)).toBe(true);
  });

  it('part-cmp on a real corpus rule: Arg(e^z) → Im(z) for in-band literals  [fungrim:a0d93c]', () => {
    const ce2 = new ComputeEngine();
    loadIdentities(ce2);
    const allRules = ce2.rules(ce2.simplificationRules); // 'expand' purpose
    // Im(1 + i) = 1 ∈ (−π, π]: fires
    const inBand = ce2
      .expr(['Argument', ['Power', 'ExponentialE', ['Add', 1, 'ImaginaryUnit']]])
      .replace(allRules);
    expect(inBand).not.toBeNull();
    expect(inBand!.isEqual(ce2.expr(1))).toBe(true);
    // Im(4i) = 4 > π: guard definitively violated, no fire
    expect(
      ce2
        .expr([
          'Argument',
          ['Power', 'ExponentialE', ['Multiply', 4, 'ImaginaryUnit']],
        ])
        .replace(allRules)
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M5 negative controls (§2.7): the same inputs WITHOUT the required
// assumptions must NOT rewrite (fail-closed), across all guard kinds
// ---------------------------------------------------------------------------

describe('M5 negative controls: guards fail closed without assumptions', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);
  });

  const staysPut = (input: unknown) => {
    const boxed = ce.expr(input as Parameters<ComputeEngine['box']>[0]);
    expect(boxed.simplify().isSame(boxed)).toBe(true);
  };

  it('cmp(ge −1) undecided: W(r·e^r) does NOT rewrite for unbounded real r', () => {
    ce.declare('r', 'real'); // no lower bound: r ≥ −1 is unknown
    staysPut(['LambertW', ['Multiply', 'r', ['Exp', 'r']]]);
  });

  it('cmp(ge 1/e, composite bound) undecided: W(s·ln s) does NOT rewrite for unbounded real s', () => {
    ce.declare('s', 'real');
    staysPut(['LambertW', ['Multiply', 's', ['Ln', 's']]]);
  });

  it('type(integer) fails on a real symbol: ChebyshevT(x, 1) does NOT rewrite', () => {
    ce.declare('x', 'real'); // symbolic non-integer
    staysPut(['ChebyshevT', 'x', 1]);
  });

  it('type(integer) fails on a real symbol: Sin(πt + π/2) rewrites via the COMPLEX rule, not the integer rule', () => {
    // Phase 3: the integer-guarded rule fungrim:506d0c
    // (Sin(πk + π/2) → (−1)^k) must NOT fire for a real t — but the
    // complex-domain identity fungrim:bae475 (Sin(z + π/2) → Cos(z),
    // z ∈ ℂ) legitimately does, since πt is finite complex.
    ce.declare('t', 'real');
    const result = ce
      .expr([
        'Sin',
        ['Add', ['Multiply', 'Pi', 't'], ['Multiply', ['Rational', 1, 2], 'Pi']],
      ])
      .simplify();
    expect(result.isSame(ce.expr(['Cos', ['Multiply', 'Pi', 't']]))).toBe(true);
    // …and specifically NOT the integer rule's (−1)^t
    expect(JSON.stringify(result.json)).not.toContain('"Power"');
  });

  it('type guards undecided on an unknown-type symbol: Sin(u + π/2) rewrites via the built-in cofunction shift, not a guarded rule', () => {
    // u has no declared type and no assumptions. The fail-closed complex
    // guard still blocks the Fungrim rule fungrim:bae475, and the integer
    // guard blocks fungrim:506d0c (no (−1)^u — asserted below). But appearing
    // as Sin's argument forces u : number, and Sin(θ + π/2) = Cos(θ) is the
    // universal quarter-period cofunction shift (sound for every number), so
    // simplifyTrig's built-in shift legitimately fires — exactly as for the
    // real-symbol sibling above. (The type(…)-undecided fail-closed path
    // itself is covered by the ChebyshevT negative control above.)
    const result = ce
      .expr(['Sin', ['Add', 'u', ['Multiply', ['Rational', 1, 2], 'Pi']]])
      .simplify();
    expect(result.isSame(ce.expr(['Cos', 'u']))).toBe(true);
    // …and specifically NOT the integer rule's (−1)^u
    expect(JSON.stringify(result.json)).not.toContain('Power');
  });

  it('cmp(gt 0) undecided: m·(m−1)! does NOT rewrite for sign-unknown integer m', () => {
    ce.declare('m', 'integer'); // no positivity assumption
    staysPut(['Multiply', 'm', ['Factorial', ['Add', 'm', -1]]]);
  });

  it('eval guard definitively false: Totient(6) does NOT rewrite (IsPrime(6) ⇒ False)', () => {
    staysPut(['Totient', 6]);
  });

  it('eval guard undecided: Totient(j) does NOT rewrite for a symbolic integer j', () => {
    ce.declare('j', 'integer'); // IsPrime(j) is symbolic ⇒ undecided
    staysPut(['Totient', 'j']);
  });
});
