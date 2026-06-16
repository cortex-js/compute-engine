// Trace-triage for Chapter 6 (Hyperbolic functions) — mirrors the benchmark's
// deterministic sample, runs each problem through the driver with trace on,
// and tallies WHY the unsolved ones fail (unimplemented predicates, failing
// conditions, dispatch gaps where no rule's skeleton even matched).
//
// Usage:
//   npx tsx scripts/rubi/triage-ch6.ts \
//     --rubi /tmp/rubi-all/corpus --chapter "6 Hyperbolic functions" \
//     --sample 100 --seed 42 [--show N]   # print N unsolved exemplars
//
// Scratch dev tool (not shipped, not a CI gate); the analog of the Ch2 driver.

import * as os from 'node:os';
import * as path from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import { loadTests } from './load-tests';
import { compileSection } from './compile';
import { RubiDriver } from '../../src/compute-engine/rubi/driver';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main() {
  const argv = process.argv;
  let rubiRules = '/tmp/rubi-all/corpus';
  let chapter = '6 Hyperbolic functions';
  let sample = 100;
  let seed = 42;
  let show = 0;
  let grep: string | null = null;
  const suite = path.join(
    os.homedir(),
    'dev/rubi/MathematicaSyntaxTestSuite-master'
  );
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--rubi': rubiRules = argv[++i]; break;
      case '--chapter': chapter = argv[++i]; break;
      case '--sample': sample = parseInt(argv[++i]); break;
      case '--seed': seed = parseInt(argv[++i]); break;
      case '--show': show = parseInt(argv[++i]); break;
      case '--grep': grep = argv[++i]; break;
    }
  }

  const { problems } = loadTests(suite, chapter);
  let slice = problems;
  if (sample > 0) {
    const rand = mulberry32(seed);
    slice = [...problems]
      .map((p) => ({ p, k: rand() }))
      .sort((a, b) => a.k - b.k)
      .slice(0, sample)
      .map((x) => x.p)
      .sort((a, b) =>
        a.file === b.file ? a.index - b.index : a.file < b.file ? -1 : 1
      );
  }
  if (grep) slice = slice.filter((p) => p.source.includes(grep!));

  const ce = new ComputeEngine();
  const { rules } = compileSection(ce, rubiRules);
  console.log(`compiled ${rules.length} rules; ${slice.length} problems\n`);

  const unimpl = new Map<string, number>();
  const condFail = new Map<string, number>();
  const ruleFail = new Map<string, number>();
  let solved = 0;
  let noAttempt = 0; // no rule's skeleton even matched (dispatch/reduction gap)
  const noAttemptEx: string[] = [];
  const unsolvedEx: { src: string; firings: number; tail: string }[] = [];

  for (const p of slice) {
    const driver = new RubiDriver(ce, rules, {
      timeLimitMs: 15_000,
      trace: true,
    });
    // reset trace per problem
    driver.stats.trace.length = 0;
    let result: any = null;
    try {
      result = driver.int(ce.expr(p.integrand as any), p.variable);
    } catch {
      /* treat as unsolved */
    }
    // structural check — an inert ∫ renders as a glyph in toString(), so a
    // string `.includes('Integrate')` would FALSE-count it as solved
    const isSolved = result !== null && !(result as any).has('Integrate');
    if (isSolved) {
      solved++;
      continue;
    }
    // unsolved — classify the trace
    const trace = driver.stats.trace;
    const firings = Object.values(driver.stats.ruleFirings).reduce(
      (a, b) => a + b,
      0
    );
    const depth0 = trace.filter((t) => t.depth === 0);
    if (depth0.length === 0 && firings === 0) {
      noAttempt++;
      if (noAttemptEx.length < 12) noAttemptEx.push(p.source.slice(0, 90));
    }
    for (const t of trace) {
      const m = /unimplemented predicate (\w+)/.exec(t.stage);
      if (m) unimpl.set(m[1], (unimpl.get(m[1]) ?? 0) + 1);
      if (t.stage.startsWith('condition: ')) {
        const c = t.stage.slice('condition: '.length).slice(0, 40);
        condFail.set(c, (condFail.get(c) ?? 0) + 1);
      }
      if (t.stage.startsWith('rule-fail: ')) {
        const c = t.stage.slice('rule-fail: '.length).slice(0, 40);
        ruleFail.set(c, (ruleFail.get(c) ?? 0) + 1);
      }
    }
    if (unsolvedEx.length < show)
      unsolvedEx.push({
        src: p.source.slice(0, 90),
        firings,
        tail: trace.slice(-4).map((t) => `${t.id}:${t.stage}`).join(' | '),
      });
  }

  const top = (m: Map<string, number>, n = 15) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);

  console.log(`SOLVED ${solved}/${slice.length}`);
  console.log(`NO RULE ATTEMPT (dispatch/reduction gap): ${noAttempt}`);
  for (const e of noAttemptEx) console.log(`   · ${e}`);
  console.log(`\nTOP UNIMPLEMENTED PREDICATES:`);
  for (const [k, v] of top(unimpl)) console.log(`   ${String(v).padStart(5)}  ${k}`);
  console.log(`\nTOP FAILING CONDITIONS (conjunct):`);
  for (const [k, v] of top(condFail)) console.log(`   ${String(v).padStart(5)}  ${k}`);
  console.log(`\nTOP RULE-FAIL MESSAGES:`);
  for (const [k, v] of top(ruleFail)) console.log(`   ${String(v).padStart(5)}  ${k}`);
  if (show > 0) {
    console.log(`\nUNSOLVED EXEMPLARS:`);
    for (const e of unsolvedEx)
      console.log(`   · ${e.src}\n       firings=${e.firings} tail: ${e.tail}`);
  }
}

main();
