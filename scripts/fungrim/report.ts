// Report writers + console summaries for the Fungrim validation harness.
// validation-report.json is deterministic (stable key order, sorted ids) so
// successive runs are diffable; elapsed times are excluded from the JSON
// payload's per-topic data for the same reason.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Stage1Report, BoxResult } from './box-check';
import type { Stage2Report } from './numeric-check';

const OUT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Bucket Stage-1 failures by their first error message (truncated). */
export function failureBuckets(
  failures: BoxResult[]
): { error: string; count: number; ids: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const f of failures) {
    const key = (f.errors?.[0] ?? '(no detail)').slice(0, 100);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(f.id);
  }
  return [...buckets.entries()]
    .map(([error, ids]) => ({ error, count: ids.length, ids: ids.sort() }))
    .sort((a, b) => b.count - a.count || a.error.localeCompare(b.error));
}

export function writeStage1Report(
  report: Stage1Report,
  corpusDir: string,
  stage2?: Stage2Report
): string {
  const file = path.join(OUT_DIR, 'validation-report.json');
  const perTopic: Record<string, unknown> = {};
  for (const topic of Object.keys(report.perTopic).sort()) {
    const t = report.perTopic[topic];
    perTopic[topic] = {
      total: t.total,
      ok: t.ok,
      passRate: Number(t.passRate.toFixed(4)),
      failures: [...t.failures].sort(),
    };
  }
  const payload = {
    generated: new Date().toISOString(),
    corpus: corpusDir,
    stage1: {
      total: report.total,
      ok: report.ok,
      boxError: report.boxError,
      unknownSymbol: report.unknownSymbol,
      timeout: report.timeout,
      passRate: Number(report.passRate.toFixed(4)),
      elapsedMs: report.elapsedMs,
      failureBuckets: failureBuckets(report.failures),
      perTopic,
      failures: report.failures
        .map((f) => ({
          id: f.id,
          topic: f.topic,
          outcome: f.outcome,
          errors: f.errors,
          ...(f.unknownHeads ? { unknownHeads: f.unknownHeads } : {}),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
    ...(stage2
      ? {
          stage2: {
            seed: stage2.seed,
            slice: stage2.slice,
            entries: stage2.entries,
            entriesWithInstances: stage2.entriesWithInstances,
            entriesSkipped: stage2.entriesSkipped,
            entriesNoAcceptedAssignment: stage2.entriesNoAcceptedAssignment,
            instances: stage2.instances,
            outcomes: stage2.outcomes,
            falseEntries: stage2.falseEntries.map((e) => e.id).sort(),
            elapsedMs: stage2.elapsedMs,
          },
        }
      : {}),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  return file;
}

export function writeNumericFailures(stage2: Stage2Report): string {
  const file = path.join(OUT_DIR, 'numeric-failures.json');
  const payload = {
    generated: new Date().toISOString(),
    seed: stage2.seed,
    slice: stage2.slice,
    falseEntryCount: stage2.falseEntries.length,
    entries: stage2.falseEntries
      .map((e) => ({
        id: e.id,
        topic: e.topic,
        class: e.class,
        guardLevel: e.guardLevel,
        instances: e.instances
          .filter((i) => i.outcome === 'False')
          .map((i) => ({ assignment: i.assignment, detail: i.detail })),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  return file;
}

export function printStage1Summary(report: Stage1Report): void {
  const pct = (x: number) => `${(100 * x).toFixed(2)}%`;
  console.log('\n=== Stage 1 — representability (box check) ===');
  console.log(
    `entries: ${report.total}  ok: ${report.ok} (${pct(report.passRate)})  ` +
      `box-error: ${report.boxError}  unknown-symbol: ${report.unknownSymbol}  ` +
      `timeout: ${report.timeout}  [${(report.elapsedMs / 1000).toFixed(1)}s]`
  );
  const worst = Object.entries(report.perTopic)
    .filter(([, t]) => t.failures.length > 0)
    .sort((a, b) => a[1].passRate - b[1].passRate)
    .slice(0, 8);
  if (worst.length > 0) {
    console.log('worst topics:');
    for (const [topic, t] of worst)
      console.log(
        `  ${topic.padEnd(24)} ${t.ok}/${t.total} (${pct(t.passRate)})  ` +
          `failing: ${t.failures.join(', ')}`
      );
    console.log('failure buckets:');
    for (const b of failureBuckets(report.failures))
      console.log(`  ${String(b.count).padStart(3)}  ${b.error}`);
  }
}

export function printStage2Summary(report: Stage2Report): void {
  console.log('\n=== Stage 2 — numeric spot checks ===');
  console.log(
    `slice: guardLevel in {${report.slice.join(', ')}}  seed: ${report.seed}`
  );
  console.log(
    `entries: ${report.entries}  with instances: ${report.entriesWithInstances}  ` +
      `no accepted assignment: ${report.entriesNoAcceptedAssignment}  ` +
      `skipped: ${JSON.stringify(report.entriesSkipped)}`
  );
  console.log(
    `instances: ${report.instances}  ` +
      `True: ${report.outcomes.True}  False: ${report.outcomes.False}  ` +
      `Unknown: ${report.outcomes.Unknown}  ` +
      `not-evaluable: ${report.outcomes['not-evaluable']}  ` +
      `[${(report.elapsedMs / 1000).toFixed(1)}s]`
  );
  if (report.falseEntries.length > 0) {
    console.log(`entries with False instances (${report.falseEntries.length}):`);
    for (const e of report.falseEntries.slice(0, 30)) {
      const first = e.instances.find((i) => i.outcome === 'False');
      console.log(
        `  ${e.id} (${e.topic}, ${e.class})  ${first?.detail?.slice(0, 110) ?? ''}`
      );
    }
    if (report.falseEntries.length > 30)
      console.log(`  ... and ${report.falseEntries.length - 30} more`);
  }
}
