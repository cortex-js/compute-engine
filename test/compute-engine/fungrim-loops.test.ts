/**
 * Loop-prevention & adversarial tests for the Fungrim Phase-1 loader
 * (FUNGRIM-PLAN-5-LOADER.md §2.5, milestone M4).
 *
 * The §2.5 loop-prevention design has four layers, outermost first:
 *
 *   1. One direction per undirected equality in the artifact (compile-time
 *      dedup) — tested here via a fixture corpus containing an equality and
 *      its swap, plus a standing inverse-pair invariant scan over the real
 *      artifact.
 *   2. Strict-decrease orientation + tie exile to `'expand'` — the
 *      simplify-active set is cost-monotone by construction. Verified by the
 *      invariant scan: any self-inverse rule (e.g. the GCD/LCM commutativity
 *      identities) must carry purpose `'expand'`, which keeps it out of
 *      `simplify()`'s scan.
 *   3. M3 purpose semantics — `'expand'` rules never enter `simplify()`.
 *   4. Engine backstops — `simplify()`'s seen-expression repeat check, the
 *      conflicting-rule bailout in `simplifyNonCommutativeFunction`, and the
 *      MAX_SIMPLIFY_STEPS guard turn residual cycles into termination. Tested
 *      here by deliberate sabotage (pushing BOTH orientations of identities).
 *
 * ITERATION / TIME BUDGETS (documented per M4 acceptance):
 *
 * - Per-expression wall-clock budget: 2000 ms (PER_EXPR_BUDGET_MS). Generous:
 *   the observed worst case on a dev laptop is ~650 ms, and that is the very
 *   first simplify() call on a freshly loaded engine (it amortizes the boxed
 *   rule-set build for all 558 rules); steady-state worst case is < 200 ms.
 * - Internal step budget: `simplify()` hard-stops at MAX_SIMPLIFY_STEPS
 *   (1000, `src/compute-engine/boxed-expression/simplify.ts`) and emits a
 *   console.warn when it trips. Every simplify() in this suite runs under a
 *   console.warn spy and asserts the guard NEVER trips — i.e. all
 *   simplifications complete well below the iteration limit, they don't just
 *   get rescued by it.
 * - Whole-set soak: full 558-rule artifact, all SIMPLIFY_CORPUS expressions
 *   (~150, including the unloaded baseline pass) + the instantiated match
 *   side of all 239 identity-class rules. Total suite runtime is well under
 *   2 minutes (~30 s on a dev laptop), so the soak always runs the FULL set —
 *   no sampling/env-var gating is needed.
 *
 * NOTE: this suite does NOT use the shared engine from `test/utils` — the
 * loader and the sabotage rules mutate engine state, so each scenario gets
 * its own engine instance.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities, FUNGRIM_CORE } from '../../src/identities';
import { SIMPLIFY_CORPUS_FLAT } from './rule-dispatch-corpus';

import { compileEntries } from '../../scripts/fungrim/compile-rules';
import type { Entry, Declarations } from '../../scripts/fungrim/load';

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

/** Per-expression wall-clock budget for a simplify(simplify(x)) round trip. */
const PER_EXPR_BUDGET_MS = 2000;

/** The message prefix of simplify()'s MAX_SIMPLIFY_STEPS (1000) guard. */
const STEP_LIMIT_WARNING = /Simplification exceeded \d+ steps/;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type MathJSON = unknown;

/** All wildcard symbols (`_…`) appearing in a MathJSON tree. */
function collectWildcards(x: MathJSON, out = new Set<string>()): Set<string> {
  if (typeof x === 'string' && x.startsWith('_')) out.add(x);
  else if (Array.isArray(x)) for (const y of x) collectWildcards(y, out);
  return out;
}

/** Substitute wildcard symbols by MathJSON fragments. */
function substituteWildcards(
  x: MathJSON,
  sub: Readonly<Record<string, MathJSON>>
): MathJSON {
  if (typeof x === 'string' && x in sub) return sub[x];
  if (Array.isArray(x)) return x.map((y) => substituteWildcards(y, sub));
  return x;
}

/** Wildcard types implied by a rule's compiled guards (default `'complex'`). */
function wildcardTypes(rule: {
  guards: ReadonlyArray<{ k: string; wc?: string; t?: string }>;
}): Record<string, string> {
  const types: Record<string, string> = {};
  for (const g of rule.guards)
    if (g.k === 'type' && g.wc !== undefined && types[g.wc] === undefined)
      types[g.wc] = g.t!;
  return types;
}

/**
 * Run `fn` with a console.warn spy and assert the MAX_SIMPLIFY_STEPS guard
 * never trips (i.e. every simplification stayed below the iteration limit).
 */
function withStepLimitSentinel<T>(fn: () => T): T {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = fn();
    const tripped = warn.mock.calls.filter((args) =>
      STEP_LIMIT_WARNING.test(args.map(String).join(' '))
    );
    expect(tripped).toEqual([]);
    return result;
  } finally {
    warn.mockRestore();
  }
}

/**
 * simplify(simplify(x)): assert termination within the time budget, a stable
 * (idempotent) endpoint, and return the result + elapsed time.
 */
function simplifyStable(expr: ReturnType<ComputeEngine['box']>): {
  result: ReturnType<ComputeEngine['box']>;
  stable: boolean;
  elapsedMs: number;
} {
  const t0 = Date.now();
  const s1 = expr.simplify();
  const s2 = s1.simplify();
  return { result: s1, stable: s2.isSame(s1), elapsedMs: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// 1. Artifact inverse-pair invariant (standing test, §2.5 layer 1)
// ---------------------------------------------------------------------------
//
// Scan the real checked-in artifact: no two rules r₁, r₂ may satisfy
// r₁.match ≍ r₂.replace ∧ r₁.replace ≍ r₂.match, where ≍ compares the
// CANONICALLY BOXED forms after jointly normalizing wildcard names.
//
// Implementation: each side is boxed canonically (in a child scope where the
// rule's wildcards carry their guard-implied types — the same boxing the
// runtime loader performs), serialized to JSON, and the (match, replace)
// pair is keyed with wildcards renamed by order of first appearance. Two
// canonical expressions are `isSame` iff their canonical JSON is identical,
// so string keys implement the ≍ comparison exactly, in O(n).

describe('artifact inverse-pair invariant', () => {
  // Separator that cannot appear in JSON.stringify output
  const SEP = '\x00';

  let directedKeys: Map<string, string>; // forward key → rule id
  let reverseKeyOf: Map<string, string>; // rule id → reverse key
  let trivialRules: string[]; // match ≍ replace (no-op rules)
  let selfInverse: string[]; // match ≍ swap(replace) (commutativity-style)

  beforeAll(() => {
    const ce = new ComputeEngine();
    // Declare the artifact's shell heads so every side boxes validly
    // (rule-free engine: we only need boxing, not the loaded rules).
    for (const [name, decl] of Object.entries(FUNGRIM_CORE.declarations)) {
      try {
        ce.declare(name, decl.signature);
      } catch {
        /* built-in — never widen */
      }
    }

    const boxSide = (side: MathJSON, types: Record<string, string>): string => {
      ce.pushScope();
      try {
        for (const w of collectWildcards(side)) {
          try {
            ce.declare(w, types[w] ?? 'complex');
          } catch {
            /* tolerate */
          }
        }
        const b = ce.box(side as never);
        expect(b.isValid).toBe(true);
        return JSON.stringify(b.json);
      } finally {
        ce.popScope();
      }
    };

    /** Join two canonical sides, renaming wildcards jointly by order of
     *  first appearance — so `f(_a,_b) → g(_b)` and `f(_x,_y) → g(_y)` get
     *  the same key, while `f(_a,_b) → g(_a)` does not. */
    const jointKey = (a: string, b: string): [key: string, halves: string[]] => {
      const renames = new Map<string, string>();
      const key = (a + SEP + b).replace(
        /"(_{1,3}[^"\\]*)"/g,
        (_m, name: string) => {
          if (!renames.has(name)) renames.set(name, `"_w${renames.size + 1}"`);
          return renames.get(name)!;
        }
      );
      return [key, key.split(SEP)];
    };

    directedKeys = new Map();
    reverseKeyOf = new Map();
    trivialRules = [];
    selfInverse = [];

    for (const r of FUNGRIM_CORE.rules) {
      const types = wildcardTypes(r);
      const m = boxSide(r.match, types);
      const p = boxSide(r.replace, types);

      const [fwd, fwdHalves] = jointKey(m, p);
      const [rev] = jointKey(p, m);

      // Trivial no-op rule: match ≍ replace under the joint renaming
      if (fwdHalves[0] === fwdHalves[1]) trivialRules.push(r.id);
      // Self-inverse rule: applying it twice restores the input
      else if (fwd === rev) selfInverse.push(r.id);

      directedKeys.set(fwd, r.id);
      reverseKeyOf.set(r.id, rev);
    }
  }, 120_000);

  it('boxes and keys every artifact rule', () => {
    expect(reverseKeyOf.size).toBe(FUNGRIM_CORE.rules.length);
    // 1435 simplify rules + 10 solve templates (apply-solve-templates.ts:
    // 6 derived from seeds — incl. the ed7dac W₋₁ branch seed — + 4 curated
    // LambertW templates: linear-exp and exp-bare, each with a W₋₁ branch
    // companion). 2026-07-10: +9/−1 simplify rules from the set-builder
    // re-encoding (Filter/Map replaces the literal-Set fiction; entries
    // whose LHS previously fell to lhs-not-value-form now compile, and
    // b7174d moved to an undischargeable guard level). 2026-08-05: −5 from
    // the imaginary-unit unification (2eb54a √-1, 31b0df i², 67c262 1/i,
    // 8be138 i³, e0425a i⁴ are now native canonicalization folds, so each
    // rule became a no-op and no longer self-tests). Finite-by-default
    // numeric flip: −1 (310f36, `z^0 → 1` guarded `_z: complex`). The bare
    // name `complex` now denotes the FINITE complex numbers, so a base of
    // that type can no longer be an infinity and native canonicalization
    // folds `z^0` to `1` on its own. The compiler therefore skips the entry
    // as `wildcard-loss` — the canonical match pattern has no `_z` left in
    // it — which is what the artifact records. Phase F `Sign` flip: −1
    // (09c107, `Sign(i) → i`, the complex sign convention) — its match
    // side is a boxing error under the declared extended-real carrier,
    // ledgered as a `box-error` disposition in the manifest.
    expect(FUNGRIM_CORE.rules.length).toBe(1443);
    expect(FUNGRIM_CORE.rules.filter((r) => r.target === 'solve').length).toBe(
      10
    );
  });

  it('no two rules are exact duplicates (directed)', () => {
    // The forward-key map would have collapsed duplicates
    expect(directedKeys.size).toBe(FUNGRIM_CORE.rules.length);
  });

  it('no two rules r₁, r₂ form an inverse pair (match₁ ≍ replace₂ ∧ replace₁ ≍ match₂)', () => {
    const pairs: [string, string][] = [];
    for (const r of FUNGRIM_CORE.rules) {
      const hit = directedKeys.get(reverseKeyOf.get(r.id)!);
      if (hit !== undefined && hit !== r.id) pairs.push([r.id, hit]);
    }
    expect(pairs).toEqual([]);
  });

  it('no rule is a trivial no-op (match ≍ replace)', () => {
    expect(trivialRules).toEqual([]);
  });

  it('self-inverse rules are exiled to expand (never in the simplify scan)', () => {
    // A rule that is its own inverse (commutativity-style, e.g.
    // GCD(a,b) → GCD(b,a)) would ping-pong with itself if it entered
    // simplify()'s scan. §2.5 layer 2/3: such rules must carry
    // purpose 'expand' (reachable only via replace()).
    const byId = new Map(FUNGRIM_CORE.rules.map((r) => [r.id, r]));
    for (const id of selfInverse)
      expect(`${id}:${byId.get(id)!.purpose}`).toBe(`${id}:expand`);

    // The known population: the GCD and LCM argument-swap identities
    // (Phase 1) plus the Phase-3 complex-domain symmetry/swap identities
    // (Carlson R symmetries, theta-style argument swaps, …) — all of them
    // 'expand' per the assertion above, so none enters simplify()'s scan.
    expect(selfInverse.sort()).toEqual([
      'fungrim:0e0393',
      'fungrim:14b96c',
      'fungrim:1e8061',
      'fungrim:258fc7',
      'fungrim:59fab1',
      'fungrim:655a2b',
      'fungrim:b478a1',
      'fungrim:cc2ebb',
      'fungrim:f29729',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Compile-time dedup of an equality and its swap (§2.5 layer 1)
// ---------------------------------------------------------------------------

describe('compile-time dedup (fixture corpus: an equality and its swap)', () => {
  const FIXTURE_DECLS: Declarations = {
    generator: 'fixture',
    declarations: {
      FooF: { signature: '(complex) -> complex' },
      BarG: { signature: '(complex) -> complex' },
    },
    existing: {},
  };

  function entry(id: string, formula: unknown, variables: string[]): Entry {
    return {
      id,
      formula,
      variables,
      assumptions: null,
      class: 'identity',
      subclass: null,
      heads: [],
      guardLevel: 'none',
      flavor: null,
      references: null,
      topics: ['fixture'],
      topic: 'fixture',
    } as Entry;
  }

  it('emits exactly one rule and ledgers the swap as duplicate-undirected', () => {
    const equality = ['FooF', 'x'];
    const other = ['BarG', ['BarG', 'x']];
    const result = compileEntries(
      [
        // The equality…
        entry('dup001', ['Equal', equality, other], ['x']),
        // …and its exact swap (same sides, opposite order)
        entry('dup002', ['Equal', other, equality], ['x']),
      ],
      FIXTURE_DECLS
    );

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe('fungrim:dup001');
    expect(result.skips).toEqual([
      {
        id: 'dup002',
        reason: 'duplicate-undirected',
        detail: 'same equality as dup001',
      },
    ]);

    // Both entries orient the same way (toward the cheaper FooF side), so
    // A→B and B→A can never coexist in the emitted set.
    expect(result.rules[0].replace).toEqual(['FooF', '_x']);
  }, 30_000);

  it('dedups the swap even with renamed variables', () => {
    const result = compileEntries(
      [
        entry('dup003', ['Equal', ['FooF', 'x'], ['BarG', ['BarG', 'x']]], ['x']),
        entry('dup004', ['Equal', ['BarG', ['BarG', 'y']], ['FooF', 'y']], ['y']),
      ],
      FIXTURE_DECLS
    );
    expect(result.rules).toHaveLength(1);
    expect(result.skips).toEqual([
      {
        id: 'dup004',
        reason: 'duplicate-undirected',
        detail: 'same equality as dup003',
      },
    ]);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 3. Runtime sabotage (§2.5 layer 4: engine backstops)
// ---------------------------------------------------------------------------
//
// Deliberately defeat layers 1–3 by pushing BOTH orientations of identities
// onto an engine with the full artifact loaded, then simplify() expressions
// matching both directions. The engine backstops (seen-expression repeat
// check, conflicting-rule bailout, step guard) must turn the cycle into
// termination with a stable result.

describe('runtime sabotage: both orientations pushed', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    loadIdentities(ce);

    ce.simplificationRules.push(
      // BOTH orientations of corpus identity fungrim:62c6c9
      // (Gamma(n+1) = n!) — the forward direction is also already loaded
      // from the artifact, with its guards.
      {
        match: ['Gamma', ['Add', '_n', 1]],
        replace: ['Factorial', '_n'],
        id: 'sabotage:62c6c9-fwd',
      },
      {
        match: ['Factorial', '_n'],
        replace: ['Gamma', ['Add', '_n', 1]],
        id: 'sabotage:62c6c9-rev',
      },
      // BOTH orientations of a synthetic double-angle pair
      // sin(2x) ↔ 2 sin(x) cos(x)
      {
        match: ['Sin', ['Multiply', 2, '_x']],
        replace: ['Multiply', 2, ['Sin', '_x'], ['Cos', '_x']],
        id: 'sabotage:double-angle-fwd',
      },
      {
        match: ['Multiply', 2, ['Sin', '_x'], ['Cos', '_x']],
        replace: ['Sin', ['Multiply', 2, '_x']],
        id: 'sabotage:double-angle-rev',
      },
    );

    ce.declare('k', 'integer');
    ce.assume(ce.box(['GreaterEqual', 'k', 0]));
  });

  // Expressions matching both orientations of the sabotage pairs
  const SEEDS: [name: string, expr: MathJSON][] = [
    ['Gamma(k+1)', ['Gamma', ['Add', 'k', 1]]],
    ['Factorial(k)', ['Factorial', 'k']],
    ['Factorial(4)', ['Factorial', 4]],
    ['Gamma(5)', ['Gamma', 5]],
    ['sin(2x)', ['Sin', ['Multiply', 2, 'x']]],
    ['2 sin(x) cos(x)', ['Multiply', 2, ['Sin', 'x'], ['Cos', 'x']]],
    // a composite seed nesting both saboteurs
    [
      'sin(2x) + Gamma(k+1)',
      ['Add', ['Sin', ['Multiply', 2, 'x']], ['Gamma', ['Add', 'k', 1]]],
    ],
  ];

  for (const [name, json] of SEEDS) {
    it(`terminates with a stable result on ${name}`, () => {
      withStepLimitSentinel(() => {
        const { stable, elapsedMs } = simplifyStable(ce.box(json as never));
        expect(stable).toBe(true);
        expect(elapsedMs).toBeLessThan(PER_EXPR_BUDGET_MS);
      });
    }, 15_000);
  }

  it('the sabotaged engine still simplifies unrelated expressions correctly', () => {
    withStepLimitSentinel(() => {
      expect(
        ce.box(['Gamma', ['Rational', 1, 2]]).simplify().isSame(
          ce.box(['Sqrt', 'Pi'])
        )
      ).toBe(true);
      expect(ce.parse('\\frac{3}{4}+2').simplify().isSame(
        ce.box(['Rational', 11, 4])
      )).toBe(true);
    });
  }, 15_000);
});

// ---------------------------------------------------------------------------
// 4. Whole-set soak (§2.5 adversarial test plan)
// ---------------------------------------------------------------------------
//
// Full 558-rule artifact loaded; simplify() over (a) the rule-dispatch
// corpus (with an unloaded-engine idempotence BASELINE, so only fungrim-
// CAUSED idempotence regressions fail) and (b) the instantiated match side
// of every identity-class rule (wildcards instantiated with fresh typed
// symbols — the symbolic seeding approach of compile-rules.ts' selfTest).
//
// Total observed runtime ~10 s on a dev laptop — the FULL set always runs
// (no sampling needed; see the budget note at the top of the file).

describe('whole-set soak', () => {
  let ce: ComputeEngine;

  beforeAll(() => {
    ce = new ComputeEngine();
    const report = loadIdentities(ce);
    // Default load (solve:false) registers the simplify-target rules only.
    expect(report.loaded).toBe(
      FUNGRIM_CORE.rules.filter((r) => r.target === 'simplify').length
    );
  });

  it('(a) corpus: no throw, per-expression budget, fungrim-caused idempotence diffs only', () => {
    // Baseline: which corpus entries are non-idempotent WITHOUT fungrim?
    // (Known CE behavior may already be non-idempotent for some inputs; only
    // differences caused by the fungrim rules are failures.)
    const baseline = new ComputeEngine();
    const baselineNonIdempotent = new Set<string>();
    withStepLimitSentinel(() => {
      for (const src of SIMPLIFY_CORPUS_FLAT) {
        const { stable } = simplifyStable(baseline.parse(src));
        if (!stable) baselineNonIdempotent.add(src);
      }
    });

    // Loaded engine: every expression must complete within budget, and any
    // non-idempotent input must already be non-idempotent in the baseline.
    const overBudget: [string, number][] = [];
    const fungrimCausedNonIdempotent: string[] = [];
    withStepLimitSentinel(() => {
      for (const src of SIMPLIFY_CORPUS_FLAT) {
        const { stable, elapsedMs } = simplifyStable(ce.parse(src));
        if (elapsedMs >= PER_EXPR_BUDGET_MS) overBudget.push([src, elapsedMs]);
        if (!stable && !baselineNonIdempotent.has(src))
          fungrimCausedNonIdempotent.push(src);
      }
    });

    expect(overBudget).toEqual([]);
    expect(fungrimCausedNonIdempotent).toEqual([]);

    // Baseline finding (currently none): document any pre-existing
    // non-idempotent corpus inputs here if CE behavior changes.
    expect([...baselineNonIdempotent]).toEqual([]);
  }, 300_000);

  it('(b) instantiated match side of every identity-class rule: no throw, within budget, stable', () => {
    // simplify-target only: solve templates are loaded into ce.solveRules
    // (never the simplify scan), so simplify-stability of their match side is
    // out of scope here (they are self-tested by apply-solve-templates.ts).
    const identityRules = FUNGRIM_CORE.rules.filter(
      (r) => r.class === 'identity' && r.target === 'simplify'
    );
    // One fewer since the finite-by-default numeric flip: 310f36
    // (`z^0 → 1` guarded `_z: complex`) is no longer emitted, because a
    // `complex`-typed base is now finite and native canonicalization folds
    // the match side to `1` on its own. See the rule-count test above.
    expect(identityRules.length).toBe(1089);

    const overBudget: [string, number][] = [];
    const unstable: string[] = [];
    const failures: [string, string][] = [];

    withStepLimitSentinel(() => {
      for (const r of identityRules) {
        const types = wildcardTypes(r);
        // Fresh typed symbols per rule, in a child scope (the symbolic
        // seeding approach of compile-rules.ts' selfTest): _n → soak_w0 with
        // the guard-implied type, etc.
        ce.pushScope();
        try {
          const sub: Record<string, MathJSON> = {};
          let i = 0;
          for (const w of collectWildcards(r.match)) {
            const name = `soak_w${i++}`;
            ce.declare(name, types[w] ?? 'complex');
            sub[w] = name;
          }
          const inst = ce.box(substituteWildcards(r.match, sub) as never);
          const { stable, elapsedMs } = simplifyStable(inst);
          if (elapsedMs >= PER_EXPR_BUDGET_MS) overBudget.push([r.id, elapsedMs]);
          if (!stable) unstable.push(r.id);
        } catch (err) {
          failures.push([r.id, String((err as Error)?.message ?? err)]);
        } finally {
          ce.popScope();
        }
      }
    });

    expect(failures).toEqual([]);
    expect(overBudget).toEqual([]);
    expect(unstable).toEqual([]);
  }, 300_000);
});
