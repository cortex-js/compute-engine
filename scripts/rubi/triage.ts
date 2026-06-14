// Per-problem triage for the Rubi driver: run one (or more) test-suite
// problems with rule tracing on and dump the rule chain, result, and the
// expected antiderivative — for comparing against Rubi's intended chain.
//
// Usage:
//   npx tsx scripts/rubi/triage.ts "<file>#<index>" ["<file>#<index>" ...]
//   npx tsx scripts/rubi/triage.ts --grep "(a + b*x)^(1/3)/x,"
//
// File keys are relative to the test-suite root, e.g.
//   "1 Algebraic functions/1.1 Binomial products/1.1.1 Linear/1.1.1.2 (a+b x)^m (c+d x)^n.m#381"
// Rules dir defaults to the chapter-1 binomial corpus.

import * as os from 'node:os';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';

import { loadTests } from './load-tests';
import { compileSection } from './compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';

const argv = process.argv.slice(2);
const keys: string[] = [];
let grep: string | null = null;
let rulesDir = path.join(
  process.cwd(),
  'data/rubi/corpus/1 Algebraic functions'
);
let suite =
  process.env.RUBI_TESTS ??
  path.join(os.homedir(), 'dev/rubi/MathematicaSyntaxTestSuite-master');
let traceLimit = 80;

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--grep') grep = argv[++i];
  else if (argv[i] === '--rules') rulesDir = argv[++i];
  else if (argv[i] === '--suite') suite = argv[++i];
  else if (argv[i] === '--trace-limit') traceLimit = Number(argv[++i]);
  else keys.push(argv[i]);
}

const { problems } = loadTests(
  suite,
  '1 Algebraic functions/1.1 Binomial products'
);

const selected = problems.filter((p) => {
  if (grep !== null) return p.source.includes(grep);
  return keys.some((k) => {
    const hash = k.lastIndexOf('#');
    return p.file === k.slice(0, hash) && p.index === Number(k.slice(hash + 1));
  });
});

if (selected.length === 0) {
  console.error('no problems matched');
  process.exit(1);
}

const ce = new ComputeEngine();
const t0 = Date.now();
const { rules, skipped } = compileSection(ce, rulesDir);
console.log(
  `compiled ${rules.length} rules (${skipped.length} skips) in ${Date.now() - t0}ms\n`
);

for (const p of selected) {
  console.log('='.repeat(78));
  console.log(`${p.file}#${p.index}`);
  console.log(`source: ${p.source.replace(/\s+/g, ' ').slice(0, 240)}`);
  const driver = new RubiDriver(ce, rules, {
    timeLimitMs: 10_000,
    trace: true,
  });
  const f = ce.box(p.integrand as any);
  console.log(`integrand: ${f.toString()}`);
  const t = Date.now();
  let result: ReturnType<typeof driver.int> = null;
  let err: string | null = null;
  try {
    result = driver.int(f, p.variable);
  } catch (e: any) {
    err = e.message;
  }
  console.log(`elapsed: ${Date.now() - t}ms`);
  if (err !== null) console.log(`ERROR: ${err}`);
  console.log(`result: ${result === null ? '(unsolved)' : result.toString()}`);
  const firings = Object.entries(driver.stats.ruleFirings);
  console.log(`rule firings: ${firings.map(([k, v]) => `${k}×${v}`).join(' ')}`);
  console.log(`trace (last ${traceLimit} of ${driver.stats.trace.length}):`);
  for (const t of driver.stats.trace.slice(-traceLimit))
    console.log(`  ${'  '.repeat(t.depth)}${t.id} ${t.stage}`);
}
