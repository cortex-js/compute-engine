// Stage 2 — numeric spot checks (docs/fungrim/FUNGRIM-PLAN-1-TRANSLATOR.md §5), behind
// `--numeric`. A TypeScript port of the *strategy* of pygrim's Expr.test()
// + Brain.some_values():
//
//  - per-variable exact value pools selected from the Element domain of the
//    entry's assumptions (sample.ts),
//  - seeded randomized assignments, filtered by evaluating the substituted
//    assumptions — anything other than a definitive `True` SKIPS the
//    assignment (never a failure; CE may legitimately not be able to decide),
//  - at most MAX_INSTANCES accepted assignments per entry,
//  - both sides of `Equal` chains N()'d at 30-digit precision and compared
//    with relative tolerance 1e-10; inequalities checked numerically;
//    everything else evaluated to a symbolic True/False,
//  - per-instance outcome: True / False / Unknown / not-evaluable.
//
// Runs with `compat: false` shells (see load.ts): the Stage-1 compatibility
// widenings shadow built-in numeric evaluators, which would turn evaluable
// entries into not-evaluable ones. Entries that need the widenings simply
// come out `not-evaluable` here.
//
// Evaluation is interruptible (ROADMAP item 2): each N()/evaluate() is
// bounded by ce.timeLimit and throws CancellationError when exceeded, so
// representation entries (series/integral/product/limit) and
// Derivative-containing formulas run like any others. The former external
// stall watchdog, FUNGRIM_SKIP_IDS denylist, and structural skips for those
// classes have been retired.

import type { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  sym,
} from '../../src/compute-engine/boxed-expression/type-guards';

import {
  Entry,
  Corpus,
  createEngine,
  shellOnlyNames,
  withEntryScope,
  variableDomains,
} from './load';
import { generateAssignments, hashString, Assignment, Json } from './sample';

export type InstanceOutcome = 'True' | 'False' | 'Unknown' | 'not-evaluable';

const REL_TOL = 1e-10;
// Tolerance for sides computed by approximation: Monte Carlo quadrature
// (error ~3e-4 at 10⁷ samples), Richardson limit extraction, and infinite
// series truncated at MAX_ITERATION (tail ~1e-4 for Σ1/n²). Comparing
// those at REL_TOL produces false "False" outcomes.
const APPROX_REL_TOL = 2e-3;
const PRECISION = 30;
const MAX_INSTANCES = 5;
const MAX_CANDIDATES = 24;
const ENTRY_BUDGET_MS = 5000;
// Per-evaluation deadline (ce.timeLimit). Evaluation is interruptible
// (ROADMAP item 2): a slow N() throws CancellationError, recorded as
// not-evaluable, instead of stalling the harness. This replaced the
// external stall watchdog, the FUNGRIM_SKIP_IDS hang denylist, and the
// structural representation/derivative skips.
const EVAL_TIME_LIMIT_MS = 1000;

export type Instance = {
  assignment: Assignment;
  outcome: InstanceOutcome;
  /** numeric detail for False/Unknown outcomes (sides or relation values) */
  detail?: string;
};

export type EntryNumericResult = {
  id: string;
  topic: string;
  class: string;
  guardLevel: string;
  /** entry-level shortcut reasons (no instances were attempted) */
  skipped?: 'shell-head' | 'directed-infinity' | 'box-error' | 'timeout';
  instances: Instance[];
  elapsedMs: number;
};

type Complex = { re: number; im: number };

function numericValue(x: BoxedExpression): Complex | null {
  const v = x.N();
  if (!isNumber(v)) return null;
  const re = v.re;
  const im = v.im;
  if (typeof re !== 'number' || typeof im !== 'number') return null;
  if (Number.isNaN(re) || Number.isNaN(im)) return null;
  return { re, im };
}

function absC(z: Complex): number {
  return Math.hypot(z.re, z.im);
}

/** |a-b| <= tol * max(|a|, |b|, 1) */
function approxEqual(a: Complex, b: Complex, tol = REL_TOL): boolean {
  const d = Math.hypot(a.re - b.re, a.im - b.im);
  return d <= tol * Math.max(absC(a), absC(b), 1);
}

/**
 * Does this formula instance involve an *approximating* numeric operation —
 * quadrature, numeric limit extraction, or an infinite series truncated at
 * MAX_ITERATION? Their results carry approximation error far above REL_TOL.
 */
function isApproximateInstance(formula: unknown): boolean {
  const s = JSON.stringify(formula);
  if (/"(Limit|NLimit|Integrate|NIntegrate)"/.test(s)) return true;
  return (
    /"(Sum|Product)"/.test(s) &&
    /"(PositiveInfinity|NegativeInfinity)"/.test(s)
  );
}

const RELATIONS = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'NotEqual',
]);

/** Numerically check one substituted formula instance. */
function checkInstance(expr: BoxedExpression): {
  outcome: InstanceOutcome;
  detail?: string;
} {
  const op = expr.operator;
  const tol = isApproximateInstance(expr.json) ? APPROX_REL_TOL : REL_TOL;

  if (op === 'Equal' && isFunction(expr) && expr.ops.length >= 2) {
    const vals: (Complex | null)[] = expr.ops.map((o) => {
      try {
        return numericValue(o);
      } catch {
        return null;
      }
    });
    if (vals.some((v) => v === null))
      return { outcome: 'not-evaluable', detail: 'side not numeric' };
    if (vals.some((v) => !Number.isFinite(v!.re) || !Number.isFinite(v!.im)))
      return { outcome: 'Unknown', detail: 'non-finite side' };
    for (let i = 0; i + 1 < vals.length; i++) {
      if (!approxEqual(vals[i]!, vals[i + 1]!, tol)) {
        const fmt = (z: Complex) => `${z.re}${z.im ? `+${z.im}i` : ''}`;
        return {
          outcome: 'False',
          detail: `sides differ: ${vals.map((v) => fmt(v!)).join(' vs ')}`,
        };
      }
    }
    return { outcome: 'True' };
  }

  if (RELATIONS.has(op) && isFunction(expr) && expr.ops.length >= 2) {
    const vals: (Complex | null)[] = expr.ops.map((o) => {
      try {
        return numericValue(o);
      } catch {
        return null;
      }
    });
    if (vals.some((v) => v === null))
      return { outcome: 'not-evaluable', detail: 'side not numeric' };
    // Relations other than NotEqual require (numerically) real operands
    if (
      op !== 'NotEqual' &&
      vals.some((v) => Math.abs(v!.im) > REL_TOL * Math.max(absC(v!), 1))
    )
      return { outcome: 'Unknown', detail: 'complex operand in order relation' };
    // chain semantics: every consecutive pair must satisfy the relation
    for (let i = 0; i + 1 < vals.length; i++) {
      const a = vals[i]!;
      const b = vals[i + 1]!;
      const scale = Math.max(absC(a), absC(b), 1);
      const closeTo = approxEqual(a, b);
      let r: InstanceOutcome;
      switch (op) {
        case 'NotEqual':
          r = closeTo ? 'False' : 'True';
          break;
        case 'Less':
          r = closeTo ? 'Unknown' : a.re < b.re ? 'True' : 'False';
          break;
        case 'Greater':
          r = closeTo ? 'Unknown' : a.re > b.re ? 'True' : 'False';
          break;
        case 'LessEqual':
          r = closeTo || a.re <= b.re + REL_TOL * scale ? 'True' : 'False';
          break;
        case 'GreaterEqual':
          r = closeTo || a.re >= b.re - REL_TOL * scale ? 'True' : 'False';
          break;
        default:
          r = 'Unknown';
      }
      if (r !== 'True')
        return {
          outcome: r,
          detail: `${op}(${a.re}, ${b.re})`,
        };
    }
    return { outcome: 'True' };
  }

  // Logical / membership / everything else: symbolic evaluation
  try {
    const v = expr.evaluate();
    if (sym(v) === 'True') return { outcome: 'True' };
    if (sym(v) === 'False')
      return { outcome: 'False', detail: `evaluates to False` };
    return { outcome: 'not-evaluable', detail: `evaluates to non-boolean` };
  } catch (err: any) {
    return {
      outcome: 'not-evaluable',
      detail: `THROW: ${String(err?.message ?? err).slice(0, 120)}`,
    };
  }
}

function hasErrorExpr(e: BoxedExpression): boolean {
  if (e.operator === 'Error') return true;
  if (isFunction(e)) return e.ops.some(hasErrorExpr);
  return false;
}

export function numericCheckEntry(
  ce: ComputeEngine,
  e: Entry,
  shellNames: Set<string>,
  seed: number
): EntryNumericResult {
  const t0 = Date.now();
  const base: EntryNumericResult = {
    id: e.id,
    topic: e.topic,
    class: e.class,
    guardLevel: e.guardLevel,
    instances: [],
    elapsedMs: 0,
  };

  // c·∞ passthrough evaluates to NaN by design — excluded (SPIKE §5)
  if (e.directedInfinity) {
    base.skipped = 'directed-infinity';
    base.elapsedMs = Date.now() - t0;
    return base;
  }
  // Shell heads have no numeric kernel: nothing can evaluate
  if (e.heads.some((h) => shellNames.has(h))) {
    base.skipped = 'shell-head';
    base.elapsedMs = Date.now() - t0;
    return base;
  }

  return withEntryScope(ce, e, () => {
    let formula: BoxedExpression;
    let assumptions: BoxedExpression | null = null;
    try {
      formula = ce.expr(e.formula as any).canonical;
      if (e.assumptions != null)
        assumptions = ce.expr(e.assumptions as any).canonical;
      // Without the Stage-1 compat widenings some entries don't box here
      if (hasErrorExpr(formula) || (assumptions && hasErrorExpr(assumptions))) {
        base.skipped = 'box-error';
        base.elapsedMs = Date.now() - t0;
        return base;
      }
    } catch {
      base.skipped = 'box-error';
      base.elapsedMs = Date.now() - t0;
      return base;
    }

    const domains = variableDomains(e);
    const candidates = generateAssignments(
      e.variables,
      domains as Record<string, Json>,
      (seed ^ hashString(e.id)) >>> 0,
      MAX_CANDIDATES
    );

    for (const assignment of candidates) {
      if (base.instances.length >= MAX_INSTANCES) break;
      if (Date.now() - t0 > ENTRY_BUDGET_MS) {
        if (base.instances.length === 0) base.skipped = 'timeout';
        break;
      }
      try {
        const sub: Record<string, BoxedExpression> = {};
        for (const [k, v] of Object.entries(assignment))
          sub[k] = ce.expr(v as any);

        // Assumption filter: only a definitive True accepts the assignment
        if (assumptions) {
          const a = assumptions.subs(sub).evaluate();
          if (sym(a) !== 'True') continue;
        }

        const inst = formula.subs(sub);
        const { outcome, detail } = checkInstance(inst);
        base.instances.push({ assignment, outcome, detail });
      } catch (err: any) {
        base.instances.push({
          assignment,
          outcome: 'not-evaluable',
          detail: `THROW: ${String(err?.message ?? err).slice(0, 120)}`,
        });
      }
    }
    base.elapsedMs = Date.now() - t0;
    return base;
  });
}

export type Stage2Report = {
  seed: number;
  slice: string[];
  entries: number;
  entriesWithInstances: number;
  entriesSkipped: Record<string, number>;
  entriesNoAcceptedAssignment: number;
  instances: number;
  outcomes: Record<InstanceOutcome, number>;
  /** entries with at least one False instance */
  falseEntries: EntryNumericResult[];
  elapsedMs: number;
};

export function runStage2(
  corpus: Corpus,
  filter: (e: Entry) => boolean,
  seed: number,
  onProgress?: (done: number, total: number) => void
): Stage2Report {
  const t0 = Date.now();
  const slice = ['none', 'real-simple'];
  // Only true shells (no engine definition) are not-evaluable by
  // construction; heads with built-in kernels are checked numerically.
  const shellNames = shellOnlyNames(corpus.declarations);
  const entries = corpus.entries.filter(
    (e) => slice.includes(e.guardLevel) && filter(e)
  );

  const ce = createEngine(corpus.declarations, { compat: false });
  ce.precision = PRECISION;
  ce.timeLimit = EVAL_TIME_LIMIT_MS;

  const report: Stage2Report = {
    seed,
    slice,
    entries: entries.length,
    entriesWithInstances: 0,
    entriesSkipped: {},
    entriesNoAcceptedAssignment: 0,
    instances: 0,
    outcomes: { True: 0, False: 0, Unknown: 0, 'not-evaluable': 0 },
    falseEntries: [],
    elapsedMs: 0,
  };

  const trace = !!process.env.FUNGRIM_TRACE;

  let done = 0;
  for (const e of entries) {
    if (trace) console.error(`entry: ${e.id} (${e.topic})`);
    let r: EntryNumericResult;
    try {
      r = numericCheckEntry(ce, e, shellNames, seed);
    } catch (err: any) {
      r = {
        id: e.id,
        topic: e.topic,
        class: e.class,
        guardLevel: e.guardLevel,
        skipped: 'box-error',
        instances: [],
        elapsedMs: 0,
      };
    }
    if (r.skipped)
      report.entriesSkipped[r.skipped] =
        (report.entriesSkipped[r.skipped] ?? 0) + 1;
    else if (r.instances.length === 0) report.entriesNoAcceptedAssignment++;
    else report.entriesWithInstances++;
    for (const inst of r.instances) {
      report.instances++;
      report.outcomes[inst.outcome]++;
    }
    if (r.instances.some((i) => i.outcome === 'False'))
      report.falseEntries.push(r);
    done++;
    if (onProgress && done % 100 === 0) onProgress(done, entries.length);
  }

  report.elapsedMs = Date.now() - t0;
  return report;
}
