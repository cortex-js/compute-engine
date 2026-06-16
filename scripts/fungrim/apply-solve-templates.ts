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
//   to the solve convention (`E(_x) = 0`, `__b` the constant offset):
//
//       match:  ['Add', A(_x), '__b']      replace: f(Negate(__b))
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
  /** Raw `['Add', A(_x), '__b']`. */
  match: MathJSON;
  /** Raw `f(Negate(__b))`. */
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
  const outer = (m as MathJSON[]).map((part, i) =>
    i === slot ? ['Negate', '__b'] : part
  );
  return {
    match: ['Add', innerA, '__b'],
    replace: substituteSymbol(outer, unknown, '_x'),
    innerA,
  };
}

// ---------------------------------------------------------------------------
// End-to-end self-test
// ---------------------------------------------------------------------------

/** Probe values for the solve self-test (positive bias: many inner functions
 *  — `Ln`, `Sqrt` — are real only for positive arguments). */
const SOLVE_SELFTEST_PROBES = [0.5, 1.5, 2.5, 0.7, 3.25];

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
    // Isolate the template: only it (plus solve's non-rule machinery) may
    // produce the root, so a success proves THIS template fires.
    ce.solveRules = [template as never];
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
      )
        return { ok: true };
    }
  }
  return { ok: false, detail: 'no probe yielded a validating root ≈ x0' };
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
  solveSeeds: SolveSeeds
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
      for (const wc of ['_x', '__b'])
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
  };
  const solveSeeds = overrides.solveSeeds ?? {};

  const existing = artifact.rules
    .filter((r) => r.target === 'solve')
    .map((r) => r.id)
    .sort();

  const { baseRules, solveRules, unavailable, candidates } = buildSolveRules(
    artifact,
    solveSeeds
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
