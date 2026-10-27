import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildSync } from 'esbuild';
import { corpus, type Case, type CorpusKind } from './corpus.js';
import { verify, decodePublicFactor } from './verify.js';

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    python: { type: 'string' },
    backends: { type: 'string', default: 'typescript,pari,sympy' },
    repeats: { type: 'string', default: '3' },
    timeout: { type: 'string', default: '5' },
    profile: { type: 'boolean', default: false },
    corpus: { type: 'string', default: 'regular' },
    baseline: { type: 'string' },
  },
});
if (!values.output) throw new Error('Provide a new --output directory');
if (Number(process.versions.node.split('.')[0]) !== 26)
  throw new Error('Benchmark requires Node 26');
const output = resolve(values.output),
  backends = values.backends!.split(',');
const repeats = Number(values.repeats),
  timeout = Number(values.timeout) * 1000;
if (
  !Number.isSafeInteger(repeats) ||
  repeats < 1 ||
  !Number.isFinite(timeout) ||
  timeout <= 0 ||
  new Set(backends).size !== backends.length ||
  backends.some(
    (b) =>
      ![
        'typescript',
        'public-factor',
        'public-helper',
        'public-detailed',
        'typescript-baseline',
        'typescript-unfiltered',
        'typescript-trager',
        'typescript-hensel',
        'typescript-subsets',
        'typescript-lattice',
        'typescript-euclidean',
        'typescript-modular-gcd',
        'pari',
        'sympy',
      ].includes(b)
  )
)
  throw new Error('Invalid run configuration');
if (backends.includes('sympy') && !values.python)
  throw new Error('Provide --python for SymPy');
if (backends.includes('typescript-baseline') !== Boolean(values.baseline))
  throw new Error('Use --baseline with the typescript-baseline backend');
if (!['regular', 'challenge', 'extended'].includes(values.corpus!))
  throw new Error('Unknown corpus');
const cases = corpus(values.corpus as CorpusKind);
// Refuse malformed fixtures before spending time in any comparator.
if (new Set(cases.map((c) => c.id)).size !== cases.length)
  throw new Error('Duplicate corpus IDs');
for (const c of cases) verify(c, c.expected);
mkdirSync(output); // Never overwrite or append to another run.
const json = JSON.stringify(cases);
writeFileSync(join(output, 'corpus.json'), json);
const publicRun = backends.some((b) => b.startsWith('public-'));
const sources = [
  'src/compute-engine/polynomial',
  'benchmarks/number-field',
].flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => /\.(ts|py)$/.test(f))
    .sort()
    .map((f) => join(dir, f))
);
const sourceContents = new Map(sources.map((f) => [f, readFileSync(f)]));
// Public entry points depend on the expression engine, not only the kernels.
// Freeze their complete source dependency tree before starting any worker.
if (publicRun) {
  for (const file of readdirSync('src', {
    recursive: true,
    encoding: 'utf8',
  })) {
    if (!/\.(ts|js|json)$/.test(file)) continue;
    const path = join('src', file);
    sourceContents.set(path, readFileSync(path));
  }
}
const sourceHashes = Object.fromEntries(
  [...sourceContents].map(([f, bytes]) => [
    f.replaceAll('\\', '/'),
    createHash('sha256').update(bytes).digest('hex'),
  ])
);
// Copy and verify the preceding run's frozen worker and arithmetic, not just
// its options. This isolates shared-arithmetic changes in a matched comparison.
const baselineSourceHashes: Record<string, string> = {};
if (values.baseline) {
  const root = resolve(values.baseline);
  const previous = JSON.parse(
    readFileSync(join(root, 'manifest.json'), 'utf8')
  );
  const completion = JSON.parse(
    readFileSync(join(root, 'completion.json'), 'utf8')
  );
  const corpusHash = createHash('sha256').update(json).digest('hex');
  if (
    !completion.workersStopped ||
    !previous.frozenWorkers ||
    previous.corpusHash !== corpusHash ||
    previous.runtime !== process.version ||
    createHash('sha256')
      .update(readFileSync(join(root, 'corpus.json')))
      .digest('hex') !== corpusHash
  )
    throw new Error('Baseline runtime, corpus, or completion mismatch');
  for (const [file, hash] of Object.entries(previous.sourceHashes)) {
    if (
      !/^(src\/compute-engine\/polynomial|benchmarks\/number-field)\/[\w.-]+\.(ts|py)$/.test(
        file
      )
    )
      throw new Error('Invalid baseline source path');
    const bytes = readFileSync(join(root, 'sources', file));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw new Error(`Baseline fingerprint mismatch: ${file}`);
    baselineSourceHashes[file] = hash as string;
    const target = join(output, 'baseline', file);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, bytes);
  }
  if (
    !baselineSourceHashes['benchmarks/number-field/worker.ts'] ||
    !baselineSourceHashes['src/compute-engine/polynomial/number-field.ts']
  )
    throw new Error('Incomplete baseline source manifest');
}
for (const [f, bytes] of sourceContents) {
  const target = join(output, 'sources', f);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, bytes);
}
const strategies: Record<string, object> = {
  'typescript-euclidean': {
    numberFieldStrategy: 'trager',
    gcdStrategy: 'euclidean',
    normStrategy: 'bareiss',
  },
  'typescript-modular-gcd': {
    numberFieldStrategy: 'trager',
    gcdStrategy: 'auto',
    normStrategy: 'bareiss',
  },
  'typescript-trager': { numberFieldStrategy: 'trager' },
  'typescript-hensel': { numberFieldStrategy: 'hensel' },
  'typescript-subsets': { numberFieldRecombination: 'subsets' },
  'typescript-lattice': { numberFieldRecombination: 'lattice' },
  'typescript-unfiltered': { numberFieldRecovery: 'unfiltered' },
};
let publicBundleHash: string | undefined;
if (publicRun) {
  const bundle = join(output, 'public-worker.mjs');
  buildSync({
    entryPoints: [
      join(output, 'sources/benchmarks/number-field/public-worker.ts'),
    ],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
  publicBundleHash = createHash('sha256')
    .update(readFileSync(bundle))
    .digest('hex');
}
const manifest = {
  publicBundleHash,
  runtime: process.version,
  createdAt: new Date().toISOString(),
  corpus: values.corpus,
  count: cases.length,
  repeats,
  timeout,
  backends,
  sourceHashes,
  baselineSourceHashes,
  archivedSources: true,
  frozenWorkers: true,
  requiresCompletionMarker: true,
  strategies,
  corpusHash: createHash('sha256').update(json).digest('hex'),
  profile: values.profile,
  options: { maxOperations: 5_000_000, maxNormDegree: 128 },
  publicOptions: publicRun
    ? {
        maxOperations: 20_000_000,
        maxNormDegree: 128,
        note: 'All public routes use their defaults; kernel options above do not apply.',
      }
    : undefined,
  warmupCases: 3,
  scheduleSeed: 1729,
};
writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
type Reply = Record<string, any>;
function stopWorker(child: ChildProcessWithoutNullStreams | undefined): void {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  // Windows venv launchers can spawn the real interpreter as a child. Stop
  // that owned process tree so a timed-out solve cannot contaminate later trials.
  if (process.platform === 'win32' && child.pid) {
    const stopped = spawnSync(
      join(process.env.SystemRoot ?? 'C:/Windows', 'System32/taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'],
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 10_000,
      }
    );
    if (stopped.error || stopped.status !== 0)
      throw new Error(
        `Cannot stop benchmark worker tree ${child.pid}: ${stopped.error ?? stopped.stderr}. Stop this run; do not compare timings with leftover workers.`
      );
  } else if (!child.kill('SIGKILL'))
    throw new Error(`Cannot stop benchmark worker ${child.pid}`);
}
class Worker {
  child?: ChildProcessWithoutNullStreams;
  pending?: (r: Reply) => void;
  constructor(readonly backend: string) {}
  async request(c?: Case): Promise<Reply> {
    if (!this.child) {
      const args =
        this.backend === 'sympy'
          ? [
              '-u',
              join(output, 'sources/benchmarks/number-field/sympy_worker.py'),
            ]
          : [
              '--import',
              'tsx',
              join(
                output,
                this.backend === 'typescript-baseline' ? 'baseline' : 'sources',
                'benchmarks/number-field/worker.ts'
              ),
              this.backend,
            ];
      if (this.backend.startsWith('public-'))
        args.splice(
          0,
          args.length,
          join(output, 'public-worker.mjs'),
          this.backend
        );
      const child = spawn(
        this.backend === 'sympy' ? values.python! : process.execPath,
        args,
        { windowsHide: true }
      );
      this.child = child;
      const ready = this.wait(60_000);
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (this.child !== child) return;
        try {
          this.pending?.(JSON.parse(line));
        } catch {
          appendFileSync(
            join(output, `${this.backend}.stdout.log`),
            line + '\n'
          );
        }
      });
      child.stderr.on('data', (s) =>
        appendFileSync(join(output, `${this.backend}.stderr.log`), s)
      );
      child.on('error', (e) => {
        if (this.child === child) {
          this.pending?.({ error: String(e) });
          this.child = undefined;
        }
      });
      child.on('exit', (code) => {
        if (this.child === child) {
          this.pending?.({ error: `exit ${code}` });
          this.child = undefined;
        }
      });
      const r = await ready;
      appendFileSync(
        join(output, 'initializations.jsonl'),
        JSON.stringify({ backend: this.backend, ...r }) + '\n'
      );
      if (!r.ready)
        throw new Error(`${this.backend} unavailable: ${JSON.stringify(r)}`);
    }
    if (!c) return { ready: true };
    const reply = this.wait(timeout);
    this.child!.stdin.write(
      JSON.stringify({
        id: c.id,
        modulus: c.modulus,
        coefficients: c.coefficients,
        options: { ...manifest.options, ...strategies[this.backend] },
        profile: values.profile,
      }) + '\n'
    );
    return reply;
  }
  wait(ms: number): Promise<Reply> {
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        const child = this.child;
        try {
          stopWorker(child);
          this.child = undefined;
          this.pending?.({ timeout: true });
        } catch (error) {
          this.pending = undefined;
          rejectReply(error);
        }
      }, ms);
      this.pending = (r) => {
        clearTimeout(timer);
        this.pending = undefined;
        resolveReply(r);
      };
    });
  }
}
const workers = backends.map((b) => new Worker(b));
process.once('SIGINT', () => {
  for (const w of workers) stopWorker(w.child);
  process.exit(130);
});
try {
  for (const w of workers) await w.request();
  for (const c of cases.slice(0, manifest.warmupCases))
    for (const w of workers) await w.request(c);
  let seed = manifest.scheduleSeed;
  for (let trial = 0; trial < repeats; trial++) {
    const order = [...cases];
    for (let i = order.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const [i, c] of order.entries()) {
      for (let k = 0; k < workers.length; k++) {
        const w = workers[(i + trial + k) % workers.length],
          r = await w.request(c);
        let status = r.timeout
          ? 'timeout'
          : r.error
            ? 'error'
            : r.result?.status;
        if (r.id !== undefined && r.id !== c.id)
          throw new Error('Worker response ID mismatch');
        if (status === 'complete') {
          try {
            verify(c, r.result);
            if (w.backend.startsWith('public-'))
              verify(c, decodePublicFactor(c.modulus, r.expression));
            if (r.structuredExpression)
              verify(c, decodePublicFactor(c.modulus, r.structuredExpression));
            status = 'verified';
          } catch (e) {
            status = 'mismatch';
            r.verificationError = String(e);
          }
        }
        appendFileSync(
          join(output, 'results.jsonl'),
          JSON.stringify({
            ...r,
            id: c.id,
            family: c.family,
            backend: w.backend,
            trial,
            status,
          }) + '\n'
        );
      }
      if ((i + 1) % 8 === 0)
        console.log(`trial ${trial + 1}: ${i + 1}/${cases.length}`);
    }
  }
} finally {
  const failures: unknown[] = [];
  for (const w of workers) {
    try {
      stopWorker(w.child);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, 'Benchmark worker cleanup failed');
}
writeFileSync(
  join(output, 'completion.json'),
  JSON.stringify({
    workersStopped: true,
    completedAt: new Date().toISOString(),
  })
);
console.log(
  `Finished ${cases.length * repeats * backends.length} records; run audit.ts to verify the full journal.`
);
