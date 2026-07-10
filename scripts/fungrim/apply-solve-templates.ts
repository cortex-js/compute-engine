// Solve-template post-step for the Fungrim artifact
// (docs/fungrim/FUNGRIM-PLAN-5-LOADER.md §2.6 — Phase 2 "activate solve
// templates").
//
// This step runs AFTER `compile-rules.ts` and operates on the checked-in
// artifact (`src/compute-engine/fungrim/fungrim-core-data.json`) rather than
// re-deriving the whole slice. It reads the curated `solveSeeds` from
// `curation-overrides.json`, finds each seed's emitted simplify rule, and
// derives a `UNIVARIATE_ROOTS`-style root template from it:
//
//   A corpus identity of the shape `f(A(x)) = x` (compiled simplify rule
//   `match = f(A(_w))`, `replace = _w`) is a LEFT inverse — `f` undoes `A`.
//   So `A(x) = c` solves to `x = f(c)` (apply `f` to both sides). Normalized
//   to the solve convention (`E(_x) = 0`, `__a` the scale that
//   `clearDenominators` may introduce, `__b` the constant offset):
//
//       match:  ['Add', ['Multiply', '__a', A(_x)], '__b']
//       replace: f(Negate(Divide(__b, __a)))
//
// The derivation is sound for ANY such identity (it is just function
// application); if `A` is not injective the template merely finds fewer
// roots — never a wrong one — and `solve()`'s `validateRoots` checks every
// candidate against the original equation. The upstream domain guards are
// intentionally dropped (the loader attaches the no-capture filter and
// `useVariations` for `target: 'solve'` rules at load time).
//
// Run as a POST-STEP after compile-rules.ts:
//   npx tsx scripts/fungrim/apply-solve-templates.ts
// Verify (CI; no write) that the artifact's solve rules are up to date:
//   npx tsx scripts/fungrim/apply-solve-templates.ts --check
//
// Idempotent: existing `:solve` rules are stripped and re-derived each run.
//
// WHY A SEPARATE STEP (not folded into compile-rules.ts)? The checked-in
// artifact is a hand-managed surgical overlay (the curated solve seeds are
// appended to the existing simplify rules) so that activating solve does not
// force a full slice recompile against the current engine — which would also
// resync unrelated drift (e.g. CarlsonRC recognition rules that fire at
// runtime but trip the known-flaky shell self-test). Decoupling keeps the
// solve change focused; the simplify rules remain whatever compile-rules.ts
// last emitted. See FUNGRIM-PLAN-5-LOADER.md §2.6.

import * as fs from 'node:fs';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';

import type { CompiledFungrimRule, MathJSON } from './compile-rules';

type Artifact = {
  manifest: {
    counts: {
      rules: number;
      byPurpose: Record<string, number>;
      byClass: Record<string, number>;
      byTarget: Record<string, number>;
    };
    [k: string]: unknown;
  };
  declarations: Record<string, unknown>;
  rules: CompiledFungrimRule[];
};

type SolveSeeds = Record<string, { target: 'solve'; note: string }>;

/** A hand-curated solve template that is NOT corpus-derivable (no
 *  inverse-composition identity exists in the Fungrim slice). Emitted verbatim
 *  as a `target: 'solve'` artifact rule and self-tested against its `tests`
 *  array (each test solves `equation = 0` for `x` and requires a returned root
 *  ≈ `root`). */
type SolveTemplateSpec = {
  id: string;
  match: MathJSON;
  replace: MathJSON;
  heads: string[];
  topics: string[];
  note: string;
  tests: { equation: MathJSON; root: number }[];
};

// ---------------------------------------------------------------------------
// MathJSON tree utilities
// ---------------------------------------------------------------------------

function collectWildcards(x: MathJSON, out = new Set<string>()): Set<string> {
  if (typeof x === 'string' && x.startsWith('_')) out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectWildcards(y, out);
  return out;
}

/** Replace every occurrence of the symbol/wildcard `from` with `to`. */
function substituteSymbol(x: MathJSON, from: string, to: MathJSON): MathJSON {
  if (x === from) return to;
  if (Array.isArray(x)) return x.map((y) => substituteSymbol(y, from, to));
  return x;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export type SolveTemplate = {
  /** Raw `['Add', ['Multiply', '__a', A(_x)], '__b']`. */
  match: MathJSON;
  /** Raw `f(Negate(Divide(__b, __a)))`. */
  replace: MathJSON;
  /** The inner `A(_x)` (in the solve `_x` convention) — used by the self-test. */
  innerA: MathJSON;
};

/** Derive a root template from a compiled inverse-composition simplify rule
 *  (`f(A(_w)) → _w`). Returns `{error}` when the rule is not of that shape. */
export function deriveSolveTemplate(
  rule: CompiledFungrimRule
): SolveTemplate | { error: string } {
  const m = rule.match;
  const rep = rule.replace;
  if (typeof rep !== 'string' || !rep.startsWith('_'))
    return { error: 'replace is not a bare wildcard' };
  if (!Array.isArray(m) || m.length < 2)
    return { error: 'match is not a function expression' };
  const unknown = rep;
  // The topmost node `[head, arg1, …]` must contain the unknown in exactly
  // one argument slot (the inner expression `A`).
  const slots: number[] = [];
  for (let i = 1; i < m.length; i++)
    if (collectWildcards(m[i]).has(unknown)) slots.push(i);
  if (slots.length !== 1)
    return { error: `unknown appears in ${slots.length} argument slots` };
  const slot = slots[0];
  const A = m[slot];
  if (A === unknown)
    return { error: 'inner argument is the bare unknown (degenerate f(x)=x)' };
  // `A` must reference no wildcard other than the unknown (no free parameter).
  const others = [...collectWildcards(A)].filter((w) => w !== unknown);
  if (others.length > 0)
    return { error: `inner argument has extra wildcards: ${others.join(', ')}` };

  const innerA = substituteSymbol(A, unknown, '_x');
  // Solve `A(x) = c` after `findUnivariateRoots` runs `clearDenominators`,
  // which can scale the equation to `__a·A(x) + __b = 0` (e.g. a rational RHS
  // `A(x) − 1/2` becomes `2·A(x) − 1`). Match the scaled shape with a leading
  // coefficient wildcard and invert both the scale and the offset:
  // `A(x) = −__b/__a`, so `x = f(−__b/__a)`. `useVariations` (attached by the
  // loader for solve rules) covers the degenerate `__a = 1` / missing-`__b`
  // cases (unscaled `A(x) = c`).
  //
  // EXCEPTION: when `A` is itself a product (`Multiply(_x, …)`, e.g. the
  // LambertW seed `x·eˣ`), canonicalizing `Multiply(__a, A(_x))` FLATTENS the
  // two products into one commutative `Multiply(__a, _x, …)`, and the matcher
  // cannot synthesize an EMPTY `__a` among the flattened factors (it fires only
  // when `__a` is explicitly present, i.e. the already-scaled case). That
  // regresses the unscaled integer-RHS case (`x·eˣ = 3`). For product inners we
  // therefore keep the unscaled shape `Add(A(_x), __b)` (no leading scale
  // wildcard).
  //
  // This no longer costs the rational-RHS case: `clearDenominators` (solve.ts)
  // now skips exact numeric-literal denominators, so a rational RHS like
  // `x·eˣ = −1/10` is NOT rescaled to `10·x·eˣ + 1` and reaches the templates
  // as `Add(Multiply(_x, Exp(_x)), 1/10)`, matching this unscaled product-inner
  // shape (the `__b` wildcard + `useVariations` absorbs the rational offset).
  const isProduct = Array.isArray(innerA) && innerA[0] === 'Multiply';
  const negOffset: MathJSON = isProduct
    ? ['Negate', '__b']
    : ['Negate', ['Divide', '__b', '__a']];
  const outer = (m as MathJSON[]).map((part, i) =>
    i === slot ? negOffset : part
  );
  return {
    match: isProduct
      ? ['Add', innerA, '__b']
      : ['Add', ['Multiply', '__a', innerA], '__b'],
    replace: substituteSymbol(outer, unknown, '_x'),
    innerA,
  };
}

// ---------------------------------------------------------------------------
// End-to-end self-test
// ---------------------------------------------------------------------------

/** Probe values for the solve self-test (positive bias: many inner functions
 *  — `Ln`, `Sqrt` — are real only for positive arguments). The negative
 *  probes exercise templates that only validate for x0 < −1, e.g. the W₋₁
 *  branch seed ed7dac (`A(x0) = x0·e^{x0} ∈ (−1/e, 0)` where W₋₁ inverts);
 *  probes whose image is non-real for a given seed are skipped structurally. */
const SOLVE_SELFTEST_PROBES = [0.5, 1.5, 2.5, 0.7, 3.25, -2, -1.5, -3.25];

/** The no-capture filter (mirrors `solve.ts`'s `filter` and the loader copy):
 *  no wildcard other than `_x` may capture `_x`. */
function noCaptureFilter(sub: Record<string, { has(s: string): boolean }>): boolean {
  for (const [k, v] of Object.entries(sub))
    if (k !== '_x' && k !== 'x' && v.has('_x')) return false;
  return true;
}

/** Push the template (in isolation) to a stock engine's `solveRules` and
 *  solve a concrete instance `A(x) = A(x0)`; succeeds when a returned,
 *  `validateRoots`-approved root equals the chosen probe `x0`. */
export function selfTestSolveTemplate(
  match: MathJSON,
  replace: MathJSON,
  innerA: MathJSON
): { ok: true } | { ok: false; detail: string } {
  const ce = new ComputeEngine();
  const template = {
    match,
    replace,
    condition: noCaptureFilter,
    useVariations: true,
  };
  // Isolate the template: only it (plus solve's non-rule machinery) may
  // produce a root, so a success proves THIS template fires.
  ce.solveRules = [template as never];

  // Pass 1 — float probes: solve `A(x) = A(x0)` (float RHS, no
  // clearDenominators scaling) for a concrete probe `x0`. Exercises the
  // `__a = 1` degenerate (unscaled) shape.
  let floatOk = false;
  for (const x0 of SOLVE_SELFTEST_PROBES) {
    const c = ce.expr(substituteSymbol(innerA, '_x', x0) as never).N();
    const cre = (c as unknown as { re?: number }).re;
    const cim = (c as unknown as { im?: number }).im ?? 0;
    if (typeof cre !== 'number' || !Number.isFinite(cre) || Math.abs(cim) > 1e-12)
      continue; // probe lands outside the real domain of A
    const eq = ce.expr([
      'Subtract',
      substituteSymbol(innerA, '_x', 'x'),
      c.json,
    ] as never);
    let roots: unknown;
    try {
      roots = (eq as unknown as { solve(v: string): unknown }).solve('x');
    } catch {
      continue;
    }
    if (!Array.isArray(roots) || roots.length === 0) continue;
    for (const r of roots) {
      const rv = (r as { N(): { re?: number } }).N().re;
      if (
        typeof rv === 'number' &&
        Number.isFinite(rv) &&
        Math.abs(rv - x0) < 1e-6 * (1 + Math.abs(x0))
      ) {
        floatOk = true;
        break;
      }
    }
    if (floatOk) break;
  }
  if (!floatOk)
    return { ok: false, detail: 'no float probe yielded a validating root ≈ x0' };

  // Pass 2 — rational RHS: solve `A(x) − 1/2 = 0` with an EXACT rational RHS.
  // `findUnivariateRoots` runs `clearDenominators`, which now SKIPS exact
  // numeric-literal denominators, so the equation is NOT rescaled and reaches
  // the templates as `Add(A(_x), −1/2)`; the `__b` wildcard + `useVariations`
  // (covering `__a = 1` for the scale-generalized templates) absorbs the
  // rational offset. This pass runs for BOTH scale-generalized and product-inner
  // templates — the product-inner shape (`x·eˣ = −1/10`) is now reachable
  // because rational RHSs are no longer flattened away. Skip — do not fail —
  // when `A(x) = 1/2` has no real solution (`f(1/2)` non-real/non-finite): the
  // probe simply cannot exercise the path for that inner function.
  const half: MathJSON = ['Rational', 1, 2];
  // `f(1/2)` analog: the root the template should produce, via the replace
  // template with `__b = −1/2`, `__a = 1` (so `−__b/__a = 1/2`).
  const rootAnalog = ce
    .expr(
      substituteSymbol(
        substituteSymbol(replace, '__b', ['Rational', -1, 2]),
        '__a',
        1
      ) as never
    )
    .N();
  const rre = (rootAnalog as unknown as { re?: number }).re;
  const rim = (rootAnalog as unknown as { im?: number }).im ?? 0;
  if (typeof rre !== 'number' || !Number.isFinite(rre) || Math.abs(rim) > 1e-9)
    return { ok: true }; // `A(x) = 1/2` has no real root — skip this pass

  const eqR = ce.expr([
    'Subtract',
    substituteSymbol(innerA, '_x', 'x'),
    half,
  ] as never);
  let rootsR: unknown;
  try {
    rootsR = (eqR as unknown as { solve(v: string): unknown }).solve('x');
  } catch (err) {
    return { ok: false, detail: `rational RHS pass threw: ${String(err)}` };
  }
  if (Array.isArray(rootsR)) {
    for (const r of rootsR) {
      // Accept when the returned root numerically satisfies `A(r) = 1/2`.
      const av = ce
        .expr(substituteSymbol(innerA, '_x', (r as { json: MathJSON }).json) as never)
        .N();
      const are = (av as unknown as { re?: number }).re;
      const aim = (av as unknown as { im?: number }).im ?? 0;
      if (
        typeof are === 'number' &&
        Number.isFinite(are) &&
        Math.abs(aim) < 1e-9 &&
        Math.abs(are - 0.5) < 1e-6
      )
        return { ok: true };
    }
  }
  return {
    ok: false,
    detail: 'clearDenominators (rational RHS) pass yielded no validating root',
  };
}

/** Self-test a hand-curated (non-derived) solve template: push it in isolation
 *  to a stock engine's `solveRules` and solve each `tests[i].equation = 0` for
 *  `x`, requiring some returned root ≈ `tests[i].root` (1e-6 relative). A
 *  failure is a hard error (the template list is hand-vetted, same policy as
 *  the derived seeds). */
export function selfTestCuratedSolveTemplate(
  match: MathJSON,
  replace: MathJSON,
  tests: { equation: MathJSON; root: number }[]
): { ok: true } | { ok: false; detail: string } {
  const ce = new ComputeEngine();
  const template = {
    match,
    replace,
    condition: noCaptureFilter,
    useVariations: true,
  };
  ce.solveRules = [template as never];
  for (const t of tests) {
    let roots: unknown;
    try {
      roots = (ce.expr(t.equation as never) as unknown as {
        solve(v: string): unknown;
      }).solve('x');
    } catch (err) {
      return {
        ok: false,
        detail: `equation ${JSON.stringify(t.equation)} threw: ${String(err)}`,
      };
    }
    if (!Array.isArray(roots) || roots.length === 0)
      return { ok: false, detail: `no root for ${JSON.stringify(t.equation)}` };
    const hit = roots.some((r) => {
      const rv = (r as { N(): { re?: number } }).N().re;
      return (
        typeof rv === 'number' &&
        Number.isFinite(rv) &&
        Math.abs(rv - t.root) < 1e-6 * (1 + Math.abs(t.root))
      );
    });
    if (!hit)
      return {
        ok: false,
        detail:
          `no returned root ≈ ${t.root} for ${JSON.stringify(t.equation)} ` +
          `(got ${JSON.stringify(roots.map((r) => (r as { N(): { re?: number } }).N().re))})`,
      };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Build the solve rules from the artifact's own simplify rules
// ---------------------------------------------------------------------------

export type SolveCandidate = { id: string; head: string; curated: boolean };

export type ApplyResult = {
  /** The artifact rules WITHOUT any `:solve` rules (existing ones stripped). */
  baseRules: CompiledFungrimRule[];
  /** Derived solve rules, sorted by id. */
  solveRules: CompiledFungrimRule[];
  /** Curated seeds whose simplify rule was not present (e.g. compat-gated). */
  unavailable: string[];
  /** Inverse-composition mining audit over the artifact's identity rules. */
  candidates: SolveCandidate[];
};

/** Derive the curated solve rules from `artifact.rules`. Throws if a curated
 *  seed's simplify rule is present but does not derive/self-test (the seed
 *  list is hand-vetted — a failure is a bug to fix, not silently skip). */
export function buildSolveRules(
  artifact: Artifact,
  solveSeeds: SolveSeeds,
  solveTemplates: SolveTemplateSpec[] = []
): ApplyResult {
  const ce = new ComputeEngine();
  const baseRules = artifact.rules.filter((r) => r.target !== 'solve');
  const byId = new Map(baseRules.map((r) => [r.id, r]));

  // Mining audit over the artifact's identity rules.
  const candidates: SolveCandidate[] = [];
  for (const r of baseRules) {
    if (r.class !== 'identity') continue;
    if ('error' in deriveSolveTemplate(r)) continue;
    const id = r.id.replace(/^fungrim:/, '');
    candidates.push({
      id,
      head: Array.isArray(r.match) ? String((r.match as MathJSON[])[0]) : 'symbol',
      curated: id in solveSeeds,
    });
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));

  const unavailable: string[] = [];
  const solveRules: CompiledFungrimRule[] = [];
  for (const seedId of Object.keys(solveSeeds).sort()) {
    const base = byId.get('fungrim:' + seedId);
    if (base === undefined) {
      // The seed's simplify rule is not in the artifact (e.g. the
      // compat-signature-gated 2-arg LambertW branch ed7dac). Reported,
      // not an error.
      unavailable.push(seedId);
      continue;
    }
    const derived = deriveSolveTemplate(base);
    if ('error' in derived)
      throw new Error(`solve seed ${seedId}: ${derived.error}`);

    // Canonicalize match/replace (so the stored artifact aligns with the
    // loader's canonical re-boxing).
    let match: MathJSON;
    let replace: MathJSON;
    ce.pushScope();
    try {
      for (const wc of ['_x', '__a', '__b'])
        try {
          ce.declare(wc, 'complex');
        } catch {
          /* tolerate */
        }
      const mc = ce.expr(derived.match as never);
      const rc = ce.expr(derived.replace as never);
      if (!mc.isValid || !rc.isValid)
        throw new Error(
          `solve seed ${seedId}: invalid canonical ${mc.isValid ? 'replace' : 'match'}`
        );
      match = mc.json;
      replace = rc.json;
    } finally {
      ce.popScope();
    }

    const tested = selfTestSolveTemplate(match, replace, derived.innerA);
    if (!tested.ok)
      throw new Error(`solve seed ${seedId}: self-test failed — ${tested.detail}`);

    solveRules.push({
      id: 'fungrim:' + seedId + ':solve',
      match,
      replace,
      guards: [],
      purpose: 'simplify',
      target: 'solve',
      class: base.class,
      heads: base.heads,
      topics: base.topics,
    });
  }

  // Hand-curated (non-corpus-derivable) solve templates — e.g. the LambertW
  // inverse-composition roots that have no inverse identity in the Fungrim
  // slice. Emitted verbatim (canonicalized to align with the loader's
  // re-boxing) and self-tested against their `tests` array; a failing template
  // is a hard error (same policy as the derived seeds).
  for (const spec of solveTemplates) {
    let match: MathJSON;
    let replace: MathJSON;
    ce.pushScope();
    try {
      const wcs = new Set<string>();
      collectWildcards(spec.match, wcs);
      collectWildcards(spec.replace, wcs);
      for (const wc of wcs)
        try {
          ce.declare(wc, 'complex');
        } catch {
          /* tolerate */
        }
      const mc = ce.expr(spec.match as never);
      const rc = ce.expr(spec.replace as never);
      if (!mc.isValid || !rc.isValid)
        throw new Error(
          `solve template ${spec.id}: invalid canonical ${mc.isValid ? 'replace' : 'match'}`
        );
      match = mc.json;
      replace = rc.json;
    } finally {
      ce.popScope();
    }

    const tested = selfTestCuratedSolveTemplate(match, replace, spec.tests);
    if (!tested.ok)
      throw new Error(
        `solve template ${spec.id}: self-test failed — ${tested.detail}`
      );

    solveRules.push({
      id: 'fungrim:' + spec.id + ':solve',
      match,
      replace,
      guards: [],
      purpose: 'simplify',
      target: 'solve',
      class: 'identity',
      heads: spec.heads,
      topics: spec.topics,
    });
  }

  solveRules.sort((a, b) => a.id.localeCompare(b.id));
  return { baseRules, solveRules, unavailable, candidates };
}

function countBy<T>(xs: ReadonlyArray<T>, key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Re-emit the artifact JSON with the same one-rule-per-line layout
 *  `emitArtifact` (compile-rules.ts) produces, so a write is a minimal diff. */
function emitArtifact(artifact: Artifact): string {
  const lines: string[] = ['{'];
  lines.push(`"manifest": ${JSON.stringify(artifact.manifest, undefined, 2)},`);
  lines.push('"declarations": {');
  lines.push(
    Object.entries(artifact.declarations)
      .map(([name, rec]) => `${JSON.stringify(name)}: ${JSON.stringify(rec)}`)
      .join(',\n')
  );
  lines.push('},');
  lines.push('"rules": [');
  lines.push(artifact.rules.map((r) => JSON.stringify(r)).join(',\n'));
  lines.push(']');
  lines.push('}');
  return lines.join('\n') + '\n';
}

function main(): void {
  const check = process.argv.includes('--check');
  const scriptDir = path.dirname(path.resolve(process.argv[1]));
  const rootDir = path.resolve(scriptDir, '../..');
  const artifactPath = path.join(
    rootDir,
    'src/compute-engine/fungrim/fungrim-core-data.json'
  );
  const overridesPath = path.join(scriptDir, 'curation-overrides.json');

  const artifact: Artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8')) as {
    solveSeeds?: SolveSeeds;
    solveTemplates?: SolveTemplateSpec[];
  };
  const solveSeeds = overrides.solveSeeds ?? {};
  const solveTemplates = overrides.solveTemplates ?? [];

  const existing = artifact.rules
    .filter((r) => r.target === 'solve')
    .map((r) => r.id)
    .sort();

  const { baseRules, solveRules, unavailable, candidates } = buildSolveRules(
    artifact,
    solveSeeds,
    solveTemplates
  );

  const rules = [...baseRules, ...solveRules].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  // Honest counts recomputed from the final rule set.
  artifact.rules = rules;
  artifact.manifest.counts = {
    ...artifact.manifest.counts,
    rules: rules.length,
    byPurpose: countBy(rules, (r) => r.purpose),
    byClass: countBy(rules, (r) => r.class),
    byTarget: countBy(rules, (r) => r.target),
  };

  const emitted = solveRules.map((r) => r.id);

  // --check: fail if the artifact's solve rules are not exactly the derived
  // set (CI gate; no write).
  if (check) {
    const drift =
      JSON.stringify(existing) !== JSON.stringify([...emitted].sort());
    // Field-level drift: re-serialize the on-disk solve rules vs derived.
    const onDisk = JSON.parse(fs.readFileSync(artifactPath, 'utf8')) as Artifact;
    const onDiskSolve = onDisk.rules.filter((r) => r.target === 'solve');
    const derivedById = new Map(solveRules.map((r) => [r.id, r]));
    const fieldDrift = onDiskSolve.some(
      (r) => JSON.stringify(r) !== JSON.stringify(derivedById.get(r.id))
    );
    if (drift || fieldDrift) {
      console.error(
        'Solve-template drift: the artifact’s solve rules are out of date.\n' +
          `  on-disk: ${existing.join(', ') || '(none)'}\n` +
          `  derived: ${emitted.join(', ') || '(none)'}\n` +
          'Regenerate with: npx tsx scripts/fungrim/apply-solve-templates.ts'
      );
      process.exit(1);
    }
    console.log(
      `OK — ${emitted.length} solve template(s) up to date ` +
        `(${unavailable.length} seed unavailable, ${candidates.length} mining candidates).`
    );
    return;
  }

  fs.writeFileSync(artifactPath, emitArtifact(artifact));

  console.log('Fungrim solve-template post-step');
  console.log(`  base rules:        ${baseRules.length}`);
  console.log(`  solve templates:   ${solveRules.length} emitted`);
  for (const r of solveRules) console.log(`    + ${r.id}`);
  if (unavailable.length > 0)
    console.log(`  seeds unavailable: ${unavailable.join(', ')}`);
  const newCandidates = candidates.filter((c) => !c.curated);
  console.log(
    `  mining audit:      ${candidates.length} inverse-composition ` +
      `candidate(s), ${newCandidates.length} not curated`
  );
  for (const c of newCandidates)
    console.log(`      · ${c.id} (${c.head})`);
  console.log(`  artifact total:    ${rules.length} rules`);
  console.log(`  artifact: ${path.relative(rootDir, artifactPath)}`);
}

// Run only as a script (not when imported by tests — no `import.meta` here:
// the jest transform compiles this module to CJS).
if (
  process.argv[1] !== undefined &&
  /apply-solve-templates\.(ts|js|mjs|cjs)$/.test(process.argv[1])
) {
  main();
  // Refresh the derived user-facing reference (doc/98-reference-fungrim-
  // identities.md) so it never goes stale relative to the artifact this step
  // just finalized. Skipped on --check (CI gate; no write). Loaded via a
  // dynamic import inside this script-only guard so gen-reference-doc's
  // `import.meta` never reaches the CJS/jest path (this module is imported by
  // tests, which must stay free of import.meta).
  if (!process.argv.includes('--check')) {
    void import('./gen-reference-doc')
      .then((m) => m.generateReferenceDoc())
      .catch((err) =>
        // Best-effort: the artifact is already written; a doc-refresh failure
        // is a warning, not a reason to fail the regen.
        console.error(
          '  (warning) reference doc refresh failed:',
          err?.message ?? err
        )
      );
  }
}
