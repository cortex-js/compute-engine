import * as fs from 'fs';
import { ComputeEngine } from '/Users/arno/dev/compute-engine/src/compute-engine';
import {
  polygamma,
  zeta,
  besselK,
  besselI,
  airyAi,
  airyBi,
} from '/Users/arno/dev/compute-engine/src/compute-engine/numerics/special-functions';
import { compile } from '/Users/arno/dev/compute-engine/src/compute-engine/compilation/compile-expression';

const HERE =
  '/private/tmp/claude-501/-Users-arno-dev-compute-engine/fcb60263-044a-423d-8c83-fdf73e169ca2/scratchpad/wave3';

const MACHINE: Record<string, (...a: number[]) => number> = {
  polygamma: (n, x) => polygamma(n, x),
  zeta: (s) => zeta(s),
  besselK: (n, x) => besselK(n, x),
  besselI: (n, x) => besselI(n, x),
  airyAi: (x) => airyAi(x),
  airyBi: (x) => airyBi(x),
};

const cases = JSON.parse(fs.readFileSync(`${HERE}/cases.json`, 'utf8'));
const results: Record<string, string> = {};

for (const c of cases) {
  try {
    if (c.kind === 'machine') {
      const v = MACHINE[c.fn](...c.args);
      // full-precision repr of the double
      results[c.id] = v.toPrecision(17);
    } else if (c.kind === 'ce') {
      const ce = new ComputeEngine();
      const saved = ce.precision;
      ce.precision = c.precision;
      const r = ce.box([c.head, ...c.args]).N();
      const b = (r as any).bignumRe;
      results[c.id] = b !== undefined ? b.toString() : String((r as any).re);
      ce.precision = saved;
    } else if (c.kind === 'compiled') {
      const ce = new ComputeEngine();
      const compiled = compile(ce.box([c.head, ...c.args]));
      const out = compiled?.run?.({});
      results[c.id] = typeof out === 'number' ? out.toPrecision(17) : String(out);
    }
  } catch (e) {
    results[c.id] = `ERROR: ${(e as Error).message}`;
  }
}

fs.writeFileSync(`${HERE}/results.json`, JSON.stringify(results, null, 1));
console.log(`wrote ${Object.keys(results).length} results`);
