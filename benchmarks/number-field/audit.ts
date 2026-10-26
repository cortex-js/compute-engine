import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Case } from './corpus.js';
import { verify, decodePublicFactor } from './verify.js';

const directory = process.argv[2];
const manifest = JSON.parse(
  readFileSync(join(directory, 'manifest.json'), 'utf8')
);
if (
  manifest.publicBundleHash &&
  createHash('sha256')
    .update(readFileSync(join(directory, 'public-worker.mjs')))
    .digest('hex') !== manifest.publicBundleHash
)
  throw new Error('Public worker bundle fingerprint mismatch');
if (manifest.requiresCompletionMarker) {
  const completion = JSON.parse(
    readFileSync(join(directory, 'completion.json'), 'utf8')
  );
  if (completion.workersStopped !== true)
    throw new Error('Worker cleanup was not confirmed');
}
if (manifest.archivedSources)
  for (const [file, hash] of Object.entries(manifest.sourceHashes)) {
    if (
      createHash('sha256')
        .update(readFileSync(join(directory, 'sources', file)))
        .digest('hex') !== hash
    )
      throw new Error(`Source fingerprint mismatch: ${file}`);
  }
const text = readFileSync(join(directory, 'corpus.json'), 'utf8');
if (
  manifest.backends.includes('typescript-baseline') &&
  (!manifest.baselineSourceHashes?.['benchmarks/number-field/worker.ts'] ||
    !manifest.baselineSourceHashes?.[
      'src/compute-engine/polynomial/number-field.ts'
    ])
)
  throw new Error('Missing baseline source fingerprints');
for (const [file, hash] of Object.entries(manifest.baselineSourceHashes ?? {}))
  if (
    createHash('sha256')
      .update(readFileSync(join(directory, 'baseline', file)))
      .digest('hex') !== hash
  )
    throw new Error(`Baseline source fingerprint mismatch: ${file}`);
if (createHash('sha256').update(text).digest('hex') !== manifest.corpusHash)
  throw new Error('Corpus fingerprint mismatch');
const cases = JSON.parse(text) as Case[],
  byId = new Map(cases.map((c) => [c.id, c]));
if (cases.length !== manifest.count || byId.size !== cases.length)
  throw new Error('Invalid corpus count or duplicate IDs');
for (const c of cases) verify(c, c.expected);
const rows = readFileSync(join(directory, 'results.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((s) => JSON.parse(s));
const seen = new Set<string>();
for (const r of rows) {
  const key = `${r.backend}:${r.trial}:${r.id}`,
    c = byId.get(r.id);
  if (
    !c ||
    !manifest.backends.includes(r.backend) ||
    !Number.isSafeInteger(r.trial) ||
    r.trial < 0 ||
    r.trial >= manifest.repeats ||
    seen.has(key)
  )
    throw new Error(`Invalid record ${key}`);
  seen.add(key);
  if (r.status === 'verified') {
    if (
      r.result?.status !== 'complete' ||
      !Number.isFinite(r.solveMs) ||
      r.solveMs < 0
    )
      throw new Error('Invalid completed result');
    verify(c, r.result);
    if (r.backend.startsWith('public-'))
      verify(c, decodePublicFactor(c.modulus, r.expression));
    if (r.structuredExpression)
      verify(c, decodePublicFactor(c.modulus, r.structuredExpression));
  }
  if (
    r.status === 'incomplete' &&
    (r.result?.status !== 'incomplete' ||
      r.result.factors.length ||
      !r.result.reason)
  )
    throw new Error('Invalid incomplete result');
  if (r.status === 'timeout' && !r.timeout) throw new Error('Invalid timeout');
  if (r.status === 'error' && !r.error) throw new Error('Invalid error');
  if (
    !['verified', 'incomplete', 'timeout', 'error', 'mismatch'].includes(
      r.status
    )
  )
    throw new Error(`Unknown status ${r.status}`);
  if (r.result?.statistics?.phases) {
    const counted = Object.values(r.result.statistics.phases).reduce(
      (s: number, p: any) => s + p.operations,
      0
    );
    if (counted !== r.result.operations)
      throw new Error('Phase accounting mismatch');
  }
}
if (seen.size !== cases.length * manifest.repeats * manifest.backends.length)
  throw new Error('Incomplete run');
const common = new Set(
  cases
    .filter(
      (c) =>
        rows.filter((r) => r.id === c.id && r.status === 'verified').length ===
        manifest.repeats * manifest.backends.length
    )
    .map((c) => c.id)
);
console.log(
  JSON.stringify(
    {
      records: rows.length,
      cases: cases.length,
      matchedCases: common.size,
      backends: manifest.backends.map((backend: string) => {
        const rs = rows.filter((r) => r.backend === backend);
        const statuses: Record<string, number> = {},
          reasons: Record<string, number> = {},
          phases: Record<string, number> = {};
        for (const r of rs) {
          statuses[r.status] = (statuses[r.status] ?? 0) + 1;
          if (r.result?.reason)
            reasons[r.result.reason] = (reasons[r.result.reason] ?? 0) + 1;
          for (const [name, p] of Object.entries(
            r.result?.statistics?.phases ?? {}
          ))
            phases[name] = (phases[name] ?? 0) + (p as any).milliseconds;
        }
        return {
          backend,
          statuses,
          reasons,
          phases,
          matchedSolveMs: rs
            .filter((r) => common.has(r.id))
            .reduce((s, r) => s + r.solveMs, 0),
          verifiedSolveMs: rs
            .filter((r) => r.status === 'verified')
            .reduce((s, r) => s + r.solveMs, 0),
          setupMs: rs.reduce((s, r) => s + (r.setupMs ?? 0), 0),
        };
      }),
    },
    null,
    2
  )
);
if (rows.some((r) => ['error', 'mismatch'].includes(r.status)))
  process.exitCode = 1;
