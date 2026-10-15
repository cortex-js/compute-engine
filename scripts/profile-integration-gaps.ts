import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ComputeEngine } from '../src/compute-engine/index.js';
import { loadIntegrationRules } from '../src/integration-rules.js';
import {
  compileRule,
  compileRuleDocs,
  type CompileResult,
} from '../src/compute-engine/rubi/compile.js';
import RULES from '../src/compute-engine/rubi/rubi-rules-data.json';
import type { RubiRuleDoc } from '../src/compute-engine/rubi/types.js';
import { RubiDriver } from '../src/compute-engine/rubi/driver.js';
import { isFunction } from '../src/compute-engine/boxed-expression/type-guards.js';
import type { ExpressionInput } from '../src/compute-engine/global-types.js';

// Run with `npx tsx scripts/profile-integration-gaps.ts [--rules]`.
// Loading and evaluation are separate measurements; no timing is a test assertion.
if (process.argv.includes('--compile-comparison')) {
  // A fresh engine in the same process still benefits from earlier JIT work.
  // Separate processes keep that warmup out of the alternating comparison.
  for (let sample = 0; sample < 3; sample++)
    for (const cached of sample % 2 ? [true, false] : [false, true]) {
      const output = execFileSync(
        process.execPath,
        [
          ...process.execArgv,
          fileURLToPath(import.meta.url),
          cached ? '--compile-cached' : '--compile-uncached',
        ],
        { encoding: 'utf8' }
      );
      console.log(JSON.stringify({ sample, ...JSON.parse(output) }));
    }
  process.exit(0);
}
if (
  process.argv.includes('--compile-cached') ||
  process.argv.includes('--compile-uncached')
) {
  const cached = process.argv.includes('--compile-cached');
  const docs = RULES as unknown as RubiRuleDoc[];
  const engine = new ComputeEngine();
  const start = performance.now();
  let count = 0,
    skipped = 0;
  if (cached) {
    const result = compileRuleDocs(engine, docs);
    count = result.rules.length;
    skipped = result.skipped.length;
  } else {
    // Match the original compiler's retained output, not a count-only loop
    // which can discard patterns and has different allocation/GC behavior.
    const compiled: CompileResult = { rules: [], skipped: [] };
    let priority = 0;
    for (const doc of docs)
      for (const rule of doc.rules) {
        const result = compileRule(
          engine,
          rule,
          `${doc.file}#${rule.index}`,
          priority++
        );
        if (result.rule) compiled.rules.push(result.rule);
        else
          compiled.skipped.push({
            id: `${doc.file}#${rule.index}`,
            reason: result.reason!,
          });
      }
    count = compiled.rules.length;
    skipped = compiled.skipped.length;
  }
  console.log(
    JSON.stringify({
      cached,
      ms: performance.now() - start,
      count,
      skipped,
      node: process.version,
    })
  );
  process.exit(0);
}
const ce = new ComputeEngine();
if (process.argv.includes('--rubi-guards')) {
  const { ComputeEngine: FullEngine } =
    await import('../src/compute-engine.js');
  const ce = new FullEngine();
  const compiled = compileRuleDocs(ce, RULES as unknown as RubiRuleDoc[]);
  const driver = new RubiDriver(ce, compiled.rules, { timeLimitMs: 60_000 });
  ce._integrationProvider = (f, variable) => {
    while (
      isFunction(f) &&
      ['Function', 'Block', 'Delimiter'].includes(f.operator)
    )
      f = f.op1;
    const result = driver.int(f, variable);
    return result?.has('Integrate') ? null : result;
  };
  for (const latex of [
    '\\frac{\\tanh(x)^2}{a+b\\tanh(x)}',
    '\\frac{(e+f x)^3\\sinh(c+d x)^3}{a+b\\sinh(c+d x)}',
  ]) {
    const start = performance.now();
    const result = driver.int(ce.parse(latex), 'x');
    console.log(
      JSON.stringify({
        latex,
        ms: performance.now() - start,
        closed: result !== null && !result.has('Integrate'),
        steps: driver.stats.steps,
        hangs: driver.stats.hangs,
      })
    );
  }
  process.exit(0);
}
const rules = process.argv.includes('--rules');
if (rules) {
  let start = performance.now();
  const report = loadIntegrationRules(ce);
  console.log(
    JSON.stringify({ phase: 'load', ms: performance.now() - start, ...report })
  );
  start = performance.now();
  loadIntegrationRules(ce);
  console.log(
    JSON.stringify({ phase: 'reload', ms: performance.now() - start })
  );
}
const cases: [string, ExpressionInput, ExpressionInput, ExpressionInput][] = [
  ['absolute-periodic', ['Abs', ['Sin', 'x']], 0, ['Multiply', 2, 'Pi']],
  ['sign-periodic', ['Sign', ['Sin', 'x']], 0, ['Multiply', 2, 'Pi']],
  ['million-periods', ['Fract', 'x'], 0, ['Rational', 2000001, 2]],
  ['reciprocal-fract', ['Fract', ['Divide', 1, 'x']], 0, 1],
  ['reciprocal-floor', ['Floor', ['Divide', 1, 'x']], 0, 1],
  [
    'beta-half',
    ['Divide', 1, ['Sqrt', ['Multiply', 'x', ['Subtract', 1, 'x']]]],
    0,
    1,
  ],
  ['endpoint-log', ['Ln', 'x'], 0, 1],
  ['erf', ['Erf', 'x'], 0, 1],
  ['bessel', ['BesselJ', 1, 'x'], 0, 1],
  ['digamma', ['PolyGamma', 0, 'x'], 1, 3],
  ['nested-exp', ['Exp', ['Add', 'x', ['Exp', 'x']]], 0, 1],
  [
    'zeta-moment',
    ['Divide', 'x', ['Subtract', ['Exp', 'x'], 1]],
    0,
    'PositiveInfinity',
  ],
];
console.log(JSON.stringify({ node: process.version, rules }));
for (const [id, body, lower, upper] of cases) {
  const start = performance.now();
  try {
    const result = ce.withTimeLimit(30_000, () =>
      ce.box(['Integrate', body, ['Limits', 'x', lower, upper]]).evaluate()
    );
    console.log(
      JSON.stringify({ id, ms: performance.now() - start, result: result.json })
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        id,
        ms: performance.now() - start,
        error: String(error),
      })
    );
  }
}
