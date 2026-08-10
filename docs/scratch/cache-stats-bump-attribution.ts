// Attribute ce._anyVersion bumps by call site over the Epsil JSON-parser
// workload (workload C of the cache-stats round). Patches the engine's
// `_anyVersion` accessor to sample the caller frame on every increment.
import { readFileSync } from 'node:fs';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

const buckets = new Map<string, number>();
let total = 0;

const proto = ComputeEngine.prototype as any;
const desc = Object.getOwnPropertyDescriptor(proto, '_anyVersion')!;
Object.defineProperty(proto, '_anyVersion', {
  get: desc.get,
  set(v: number) {
    total += 1;
    const stack = new Error().stack ?? '';
    // Frame 0: Error, 1: this setter; 2: the bump site.
    const frame = stack.split('\n')[2] ?? '<unknown>';
    const m = frame.match(/([\w-]+\.ts):(\d+)/);
    const key = m ? `${m[1]}:${m[2]}` : frame.trim();
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
    desc.set!.call(this, v);
  },
});

const ce = new ComputeEngine();
const src = readFileSync(
  '/Users/arno/dev/compute-engine/vscode-epsil/examples/demo.epsil',
  'utf8'
);
for (let r = 0; r < 20; r++) executeEpsil(ce, src);

console.log(`total generation bumps: ${total}`);
for (const [k, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1]))
  console.log(
    `${String(n).padStart(8)}  ${((100 * n) / total).toFixed(1).padStart(5)}%  ${k}`
  );
