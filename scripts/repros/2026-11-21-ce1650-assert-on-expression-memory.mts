/**
 * CE-1650: a failing `node:assert` comparison whose actual value is a boxed
 * expression walks the whole engine. Run it with a heap cap, so that a
 * failing case cannot exhaust the machine:
 *
 *   timeout -k 5 40 node --max-old-space-size=768 --import tsx \
 *     scripts/repros/2026-11-21-ce1650-assert-on-expression-memory.mts <mode>
 *
 * Modes: `inspect` (the size of `util.inspect` per depth), `equal`
 * (`assert.equal` with no message) and `deep` (`assert.deepStrictEqual`;
 * on 8ddfe3fee it does not finish within 40 s). Expected after the fix: each
 * mode finishes at once, with a small message, and the RSS stays near its
 * starting value.
 */
import assert from 'node:assert';
import { inspect } from 'node:util';
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('A', 'real');
const expr = ce.box(['Add', 'A', 'x']);
const rss = () => Math.round(process.memoryUsage().rss / 1e6) + ' MB';
const mode = process.argv[2] ?? 'inspect';
const start = Date.now();

if (mode === 'inspect') {
  for (const depth of [1, 2, 3, 4, 5]) {
    const text = inspect(expr, {
      customInspect: false,
      depth,
      maxArrayLength: Infinity,
      getters: true,
      showHidden: false,
    });
    console.log(`depth ${depth}: ${text.length} chars, rss ${rss()}`);
  }
} else {
  try {
    if (mode === 'deep') assert.deepStrictEqual(expr, undefined);
    else assert.equal(expr, undefined);
  } catch (error) {
    console.log(`${mode}: message of ${String(error).length} chars`);
  }
}
console.log(`${mode}: ${Date.now() - start} ms, rss ${rss()}`);
