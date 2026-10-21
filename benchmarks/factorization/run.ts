import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { factoringCorpus, type FactoringCase } from './corpus.js';
import { stressCorpus } from './stress-corpus.js';

const { values } = parseArgs({
  options: {
    'output': { type: 'string' },
    'count': { type: 'string', default: '1200' },
    'python': { type: 'string' },
    'backends': { type: 'string', default: 'typescript' },
    'profile': { type: 'boolean', default: false },
    'timeout': { type: 'string', default: '30' },
    'repeats': { type: 'string', default: '3' },
    'corpus': { type: 'string', default: 'regular' },
    'max-degree': { type: 'string', default: '128' },
    'max-coefficient-bits': { type: 'string', default: '4096' },
  },
});
if (!values.output) throw new Error('--output must name a new run directory');
const output = resolve(values.output);
if (existsSync(output))
  throw new Error('Refusing to overwrite an existing run');
if (!['regular', 'stress'].includes(values.corpus!))
  throw new Error('Unknown corpus');
const corpus =
  values.corpus === 'stress'
    ? stressCorpus()
    : factoringCorpus(Number(values.count));
const serialized = JSON.stringify(corpus);
const hash = createHash('sha256').update(serialized).digest('hex');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'corpus.json'), serialized);
const repeats = Number(values.repeats),
  timeout = Number(values.timeout) * 1000,
  maxDegree = Number(values['max-degree']),
  maxCoefficientBits = Number(values['max-coefficient-bits']);
const backends = values.backends!.split(',');
if (
  new Set(backends).size !== backends.length ||
  backends.some((b) => !['typescript', 'sympy', 'pari'].includes(b))
)
  throw new Error('Unknown or duplicate backend');
if (
  !Number.isInteger(repeats) ||
  repeats < 1 ||
  !Number.isFinite(timeout) ||
  timeout <= 0 ||
  !Number.isSafeInteger(maxDegree) ||
  maxDegree < 1 ||
  !Number.isSafeInteger(maxCoefficientBits) ||
  maxCoefficientBits < 1
)
  throw new Error('Invalid run options');
const sourceHash = createHash('sha256');
for (const f of [
  'src/compute-engine/polynomial/exact-field.ts',
  'src/compute-engine/polynomial/finite-field.ts',
  'src/compute-engine/polynomial/small-prime.ts',
  'src/compute-engine/polynomial/factor-rational.ts',
  'src/compute-engine/polynomial/factor-work.ts',
  'benchmarks/factorization/corpus.ts',
  'benchmarks/factorization/worker.ts',
  'benchmarks/factorization/sympy_worker.py',
  'benchmarks/factorization/run.ts',
  'benchmarks/factorization/stress-corpus.ts',
])
  sourceHash.update(readFileSync(f));
writeFileSync(
  resolve(output, 'manifest.json'),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      corpusHash: hash,
      corpus: values.corpus,
      sourceHash: sourceHash.digest('hex'),
      count: corpus.length,
      repeats,
      timeout,
      backends: values.backends,
      schedule: 'seeded-case-order-rotating-backends',
      scheduleSeed: 1729,
      warmupCases: Math.min(60, corpus.length),
      rationalOptions: {
        maxDegree,
        maxCoefficientBits,
        maxOperations: 2_000_000,
        profile: values.profile,
      },
      runtime: process.version,
    },
    null,
    2
  )
);

type Message = Record<string, any>;
class Runner {
  child?: ChildProcessWithoutNullStreams;
  pending?: {
    resolve: (v: Message) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(readonly backend: string) {}
  async start(): Promise<Message> {
    const args =
      this.backend === 'sympy'
        ? ['-u', 'benchmarks/factorization/sympy_worker.py']
        : [
            '--import',
            'tsx',
            'benchmarks/factorization/worker.ts',
            this.backend,
          ];
    if (this.backend === 'sympy' && !values.python)
      throw new Error('--python is required for SymPy');
    const child = spawn(
      this.backend === 'sympy' ? values.python! : process.execPath,
      args,
      { windowsHide: true }
    );
    this.child = child;
    child.stderr.on('data', (s) =>
      appendFileSync(resolve(output, `${this.backend}.stderr.log`), s)
    );
    createInterface({ input: child.stdout }).on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (this.child === child) this.finish(message);
      } catch {
        appendFileSync(
          resolve(output, `${this.backend}.stdout.log`),
          `${line}\n`
        );
      }
    });
    child.on('error', (e) => {
      if (this.child === child) this.finish({ error: String(e) });
    });
    child.on('exit', (code) => {
      if (this.child === child) {
        this.finish({ error: `worker exit ${code}` });
        this.child = undefined;
      }
    });
    return this.wait(120_000);
  }
  finish(message: Message): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve(message);
    this.pending = undefined;
  }
  wait(ms: number): Promise<Message> {
    return new Promise((resolveMessage) => {
      this.pending = {
        resolve: resolveMessage,
        timer: setTimeout(() => {
          const c = this.child;
          this.child = undefined;
          c?.kill();
          this.finish({ timeout: true });
        }, ms),
      };
    });
  }
  async run(c: FactoringCase): Promise<Message> {
    if (!this.child) {
      const ready = await this.start();
      appendFileSync(
        resolve(output, 'initializations.jsonl'),
        JSON.stringify({ backend: this.backend, ...ready }) + '\n'
      );
      if (!ready.ready) return { error: 'backend unavailable', setup: ready };
    }
    const result = this.wait(timeout);
    this.child!.stdin.write(
      JSON.stringify({
        ...c,
        maxDegree,
        maxCoefficientBits,
        profile: values.profile,
      }) + '\n'
    );
    return result;
  }
}
const signature = (fs: { coefficients: string[]; multiplicity: number }[]) =>
  fs
    .map((f) => `${f.coefficients.join(',')}^${f.multiplicity}`)
    .sort()
    .join(';');
const summaries: Message[] = [];
const active: { runner: Runner; rows: Message[] }[] = [];
for (const backend of backends) {
  const runner = new Runner(backend);
  const setup = await runner.start();
  appendFileSync(
    resolve(output, 'initializations.jsonl'),
    JSON.stringify({ backend, ...setup }) + '\n'
  );
  if (!setup.ready) {
    summaries.push({ backend, status: 'unavailable', setup });
    runner.child?.kill();
    continue;
  }
  active.push({ runner, rows: [] });
}
try {
  // Workers are persistent but only one solve is in flight. Interleaving and
  // rotating backend order reduce drift from temperature, JIT and machine load.
  for (const c of corpus.slice(0, 60))
    for (const { runner } of active) await runner.run(c);
  let state = 1729;
  for (let repeat = 0; repeat < repeats; repeat++) {
    const order = corpus.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < order.length; i++) {
      const c = corpus[order[i]];
      for (let k = 0; k < active.length; k++) {
        const { runner, rows } = active[(i + repeat + k) % active.length];
        const backend = runner.backend,
          r = await runner.run(c);
        let status = r.timeout
          ? 'timeout'
          : r.error
            ? 'error'
            : (r.result?.status ?? 'unverified');
        if (status === 'complete') {
          const got = r.result;
          status =
            got.coefficient.numerator === c.expected.coefficient[0] &&
            got.coefficient.denominator === c.expected.coefficient[1] &&
            signature(got.factors) === signature(c.expected.factors)
              ? 'verified'
              : 'mismatch';
        }
        const record = {
          ...r,
          id: c.id,
          family: c.family,
          backend,
          repeat,
          status,
        };
        appendFileSync(
          resolve(output, 'results.jsonl'),
          JSON.stringify(record) + '\n'
        );
        rows.push(record);
      }
      if ((i + 1) % 100 === 0)
        console.log(
          `trial ${repeat + 1}: ${i + 1}/${corpus.length} (${active.length} backends)`
        );
    }
  }
} finally {
  for (const { runner } of active) runner.child?.kill();
}
for (const { runner, rows } of active) {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const timings = rows
    .filter((r) => r.status === 'verified')
    .map((r) => Number(r.solveMs))
    .sort((a, b) => a - b);
  summaries.push({
    backend: runner.backend,
    counts,
    medianVerifiedMs: timings[Math.floor(timings.length / 2)],
    p95VerifiedMs: timings[Math.floor(timings.length * 0.95)],
    totalSolveMs: rows.reduce((s, r) => s + Number(r.solveMs ?? 0), 0),
  });
  writeFileSync(
    resolve(output, 'summary.json'),
    JSON.stringify(summaries, null, 2)
  );
}
console.log(JSON.stringify(summaries, null, 2));
writeFileSync(
  resolve(output, 'summary.json'),
  JSON.stringify(summaries, null, 2)
);
if (
  summaries.some(
    (r) => r.counts?.mismatch || r.counts?.error || r.status === 'unavailable'
  )
)
  process.exitCode = 1;
