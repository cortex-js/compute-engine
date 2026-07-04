/**
 * Sweep a JSON array of LaTeX strings through ce.parse() and record the
 * outcome of each as JSONL.
 *
 *   npx tsx parse-sweep.ts fragments.json [start] [end] [out.jsonl]
 *
 * A string is `clean` when the parse is valid and the MathJSON contains no
 * "Error" subexpression. Run in chunks under `timeout` if you suspect a
 * hang; the [start]/[end] arguments let you bisect (end-exclusive; an
 * existing output file is appended to when start > 0).
 */
import { ComputeEngine } from '../../../src/compute-engine';
import * as fs from 'fs';

const inputs: string[] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const start = parseInt(process.argv[3] ?? '0');
const end = parseInt(process.argv[4] ?? String(inputs.length));
const outPath = process.argv[5] ?? 'parse-results.jsonl';

const ce = new ComputeEngine();
const out = fs.openSync(outPath, start === 0 ? 'w' : 'a');

for (let i = start; i < end; i++) {
  const latex = inputs[i];
  const rec: Record<string, unknown> = { i, latex };
  try {
    const expr = ce.parse(latex);
    const json = JSON.stringify(expr.json);
    const hasError = json.includes('"Error"');
    rec.status = hasError ? 'error' : expr.isValid ? 'clean' : 'invalid';
    if (hasError) {
      rec.errCode = json.match(/\["Error"[^\]]*?"([^"]*?)"/)?.[1] ?? null;
      rec.json = json.length < 400 ? json : json.slice(0, 400);
    }
  } catch (err) {
    rec.status = 'throw';
    rec.err = String(err instanceof Error ? err.message : err).slice(0, 200);
  }
  fs.writeSync(out, JSON.stringify(rec) + '\n');
}
fs.closeSync(out);

const results = fs
  .readFileSync(outPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l).status);
const counts: Record<string, number> = {};
for (const s of results) counts[s] = (counts[s] ?? 0) + 1;
console.log(counts);
