import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { FactoringCase } from './corpus.js';

/** Read-only independent journal audit; verifies coverage and exact reconstruction. */
const directory = resolve(process.argv[2]);
const corpusText = readFileSync(resolve(directory, 'corpus.json'), 'utf8');
const corpus = JSON.parse(corpusText) as FactoringCase[];
const manifest = JSON.parse(
  readFileSync(resolve(directory, 'manifest.json'), 'utf8')
);
if (
  createHash('sha256').update(corpusText).digest('hex') !== manifest.corpusHash
)
  throw new Error('Corpus fingerprint mismatch');
if (
  corpus.length !== manifest.count ||
  new Set(corpus.map((c) => c.id)).size !== corpus.length
)
  throw new Error('Corpus count or ID mismatch');
const cases = new Map(corpus.map((c) => [c.id, c]));
const rows = readFileSync(resolve(directory, 'results.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((s) => JSON.parse(s));
const seen = new Set<string>();
const backends: string[] = manifest.backends.split(',');
const summaries: Record<
  string,
  {
    count: number;
    statuses: Record<string, number>;
    families: Record<string, Record<string, number>>;
    reasons: Record<string, number>;
    medianMs?: number;
    p95Ms?: number;
    maxRssBytes?: number;
  }
> = {};
for (const row of rows) {
  const c = cases.get(row.id);
  const key = `${row.backend}:${row.repeat}:${row.id}`;
  if (
    !c ||
    !backends.includes(row.backend) ||
    !Number.isInteger(row.repeat) ||
    row.repeat < 0 ||
    row.repeat >= manifest.repeats ||
    seen.has(key)
  )
    throw new Error(`Invalid/duplicate result ${key}`);
  seen.add(key);
  if (row.family !== c.family) throw new Error('Family mismatch');
  if (row.status === 'verified') {
    const factors = row.result.factors as {
      coefficients: string[];
      multiplicity: number;
    }[];
    const signature = (fs: typeof factors) =>
      fs
        .map((f) => `${f.coefficients.join(',')}^${f.multiplicity}`)
        .sort()
        .join(';');
    if (
      signature(factors) !== signature(c.expected.factors) ||
      row.result.coefficient.numerator !== c.expected.coefficient[0] ||
      row.result.coefficient.denominator !== c.expected.coefficient[1]
    )
      throw new Error('Factor signature mismatch');
    // Deliberately do not reuse CE polynomial arithmetic for this check.
    let product = [1n];
    for (const f of factors) {
      if (!Number.isSafeInteger(f.multiplicity) || f.multiplicity < 1)
        throw new Error('Invalid multiplicity');
      const b = f.coefficients.map(BigInt);
      for (let m = 0; m < f.multiplicity; m++) {
        const next = Array<bigint>(product.length + b.length - 1).fill(0n);
        for (let i = 0; i < product.length; i++)
          for (let j = 0; j < b.length; j++) next[i + j] += product[i] * b[j];
        product = next;
      }
    }
    const n = BigInt(row.result.coefficient.numerator),
      d = BigInt(row.result.coefficient.denominator);
    if (
      d <= 0n ||
      product.length !== c.coefficients.length ||
      product.some(
        (v, i) =>
          v * n * BigInt(c.coefficients[i][1]) !==
          BigInt(c.coefficients[i][0]) * d
      )
    )
      throw new Error(`Reconstruction mismatch ${key}`);
  }
  const s = (summaries[row.backend] ??= {
    count: 0,
    statuses: {},
    families: {},
    reasons: {},
  });
  s.count++;
  s.statuses[row.status] = (s.statuses[row.status] ?? 0) + 1;
  const family = (s.families[c.family] ??= {});
  family[row.status] = (family[row.status] ?? 0) + 1;
  if (row.result?.reason)
    s.reasons[row.result.reason] = (s.reasons[row.result.reason] ?? 0) + 1;
}
for (const backend of backends) {
  const s = summaries[backend];
  if (!s || s.count !== corpus.length * manifest.repeats)
    throw new Error(`Incomplete journal for ${backend}`);
  const samples = rows
    .filter((r) => r.backend === backend && r.status === 'verified')
    .map((r) => r.solveMs)
    .sort((a, b) => a - b);
  s.medianMs = samples[Math.floor(samples.length / 2)];
  s.p95Ms = samples[Math.floor(samples.length * 0.95)];
  const rss = rows
    .filter((r) => r.backend === backend && r.rss)
    .map((r) => r.rss);
  if (rss.length) s.maxRssBytes = Math.max(...rss);
}
console.log(
  JSON.stringify(
    {
      corpusHash: manifest.corpusHash,
      sourceHash: manifest.sourceHash,
      records: seen.size,
      summaries,
    },
    null,
    2
  )
);
