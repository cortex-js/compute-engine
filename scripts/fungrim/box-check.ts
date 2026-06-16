// Stage 1 — representability check (docs/fungrim/FUNGRIM-PLAN-1-TRANSLATOR.md §5).
//
// For every corpus entry: declare its variables (typed from assumptions),
// then ce.expr(formula).canonical and ce.expr(assumptions).canonical. An entry
// is `ok` iff neither throws nor contains an ["Error", ...] subexpression.
// Outcomes:
//   ok             — boxes cleanly
//   unknown-symbol — entry references a head with no definition anywhere
//                    (not CE-known, not shell-declared, not an indexed-family
//                    head) — a translator/declaration-table gap
//   box-error      — exception or Error subexpression in the canonical form

import type { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

import { Entry, Corpus, withEntryScope, createEngine } from './load';

export type BoxOutcome = 'ok' | 'box-error' | 'unknown-symbol' | 'timeout';

/** An entry slower than this is classified `timeout` (post-hoc: boxing is
 * synchronous, so a pathological entry is detected after the fact). */
const ENTRY_TIMEOUT_MS = 5000;

export type BoxResult = {
  id: string;
  topic: string;
  outcome: BoxOutcome;
  /** error codes / messages, present when outcome != ok */
  errors?: string[];
  /** heads with no definition anywhere, when outcome == unknown-symbol */
  unknownHeads?: string[];
};

/** Collect a compact description of every Error subexpression. */
function collectErrors(expr: BoxedExpression, out: string[]): void {
  if (expr.operator === 'Error') {
    out.push(JSON.stringify(expr.json).slice(0, 200));
    return;
  }
  if (isFunction(expr)) for (const op of expr.ops) collectErrors(op, out);
}

/**
 * Compute the set of heads that have a definition: CE built-ins (checked
 * against the engine with shells already declared, so shell heads resolve
 * too).
 */
export function computeKnownHeads(
  ce: ComputeEngine,
  entries: Entry[]
): Set<string> {
  const heads = new Set<string>();
  for (const e of entries) for (const h of e.heads) heads.add(h);
  const known = new Set<string>();
  for (const h of heads) {
    try {
      if (ce.lookupDefinition(h) !== undefined) known.add(h);
    } catch {
      /* invalid symbol name — not known */
    }
  }
  return known;
}

export function boxCheckEntry(
  ce: ComputeEngine,
  e: Entry,
  knownHeads: Set<string>
): BoxResult {
  const familyHeads = new Set(e.indexedFamilies ?? []);
  const unknownHeads = e.heads.filter(
    (h) => !knownHeads.has(h) && !familyHeads.has(h)
  );
  return withEntryScope(ce, e, () => {
    const errors: string[] = [];
    try {
      collectErrors(ce.expr(e.formula as any).canonical, errors);
      if (e.assumptions != null)
        collectErrors(ce.expr(e.assumptions as any).canonical, errors);
    } catch (err: any) {
      errors.push(`THROW: ${String(err?.message ?? err).slice(0, 200)}`);
    }
    if (errors.length === 0) return { id: e.id, topic: e.topic, outcome: 'ok' };
    if (unknownHeads.length > 0)
      return {
        id: e.id,
        topic: e.topic,
        outcome: 'unknown-symbol',
        errors,
        unknownHeads,
      };
    return { id: e.id, topic: e.topic, outcome: 'box-error', errors };
  });
}

export type Stage1Report = {
  total: number;
  ok: number;
  boxError: number;
  unknownSymbol: number;
  timeout: number;
  passRate: number;
  elapsedMs: number;
  perTopic: Record<
    string,
    { total: number; ok: number; passRate: number; failures: string[] }
  >;
  failures: BoxResult[];
};

/**
 * Stage 1 over every entry accepted by `filter`. A fresh engine is created
 * per topic (avoids any cross-topic declaration/cache interference); each
 * entry additionally gets its own variable scope (`withEntryScope`) and its
 * own try/catch so one crash cannot kill the run.
 */
export function runStage1(
  corpus: Corpus,
  filter: (e: Entry) => boolean
): Stage1Report {
  const t0 = Date.now();
  // Known-head set is declaration-driven and identical across the per-topic
  // engines: compute it once.
  const knownHeads = computeKnownHeads(
    createEngine(corpus.declarations),
    corpus.entries
  );

  // Group by topic, preserving the deterministic global order within topics
  const byTopic = new Map<string, Entry[]>();
  for (const e of corpus.entries) {
    if (!filter(e)) continue;
    if (!byTopic.has(e.topic)) byTopic.set(e.topic, []);
    byTopic.get(e.topic)!.push(e);
  }

  const perTopic: Stage1Report['perTopic'] = {};
  const failures: BoxResult[] = [];
  let ok = 0;
  let boxError = 0;
  let unknownSymbol = 0;
  let timeout = 0;
  let total = 0;

  for (const [topic, entries] of byTopic) {
    const ce = createEngine(corpus.declarations);
    perTopic[topic] = { total: 0, ok: 0, passRate: 1, failures: [] };
    for (const e of entries) {
      total++;
      perTopic[topic].total++;
      const t1 = Date.now();
      let r: BoxResult;
      try {
        r = boxCheckEntry(ce, e, knownHeads);
      } catch (err: any) {
        r = {
          id: e.id,
          topic,
          outcome: 'box-error',
          errors: [`HARNESS THROW: ${String(err?.message ?? err).slice(0, 200)}`],
        };
      }
      if (Date.now() - t1 > ENTRY_TIMEOUT_MS) {
        r = {
          id: e.id,
          topic,
          outcome: 'timeout',
          errors: [`took ${Date.now() - t1}ms (> ${ENTRY_TIMEOUT_MS}ms)`],
        };
      }
      if (r.outcome === 'ok') {
        ok++;
        perTopic[topic].ok++;
      } else {
        if (r.outcome === 'box-error') boxError++;
        else if (r.outcome === 'timeout') timeout++;
        else unknownSymbol++;
        perTopic[topic].failures.push(e.id);
        failures.push(r);
      }
    }
    perTopic[topic].passRate =
      perTopic[topic].total === 0
        ? 1
        : perTopic[topic].ok / perTopic[topic].total;
  }

  return {
    total,
    ok,
    boxError,
    unknownSymbol,
    timeout,
    passRate: total === 0 ? 1 : ok / total,
    elapsedMs: Date.now() - t0,
    perTopic,
    failures,
  };
}
