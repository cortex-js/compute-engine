// Shared timing harness for the cache origin probes.
// Each probe calls `measure(name, setup, work)`: `setup()` runs outside the
// timer (for example, a new engine), `work(state)` is timed and returns a
// digest string. One warm-up, then RUNS timed runs; prints the median.
import { createHash } from 'node:crypto';

export const RUNS = Number(process.env.PROBE_RUNS ?? 5);
export const WARMUP = Number(process.env.PROBE_WARMUP ?? 1);

export async function measure<S>(
  name: string,
  setup: () => S,
  work: (s: S) => string | Promise<string>
): Promise<void> {
  const off = process.env.CE_CACHE_OFF ?? '';
  const digests = new Set<string>();
  let firstDigest = '';
  for (let k = 0; k < WARMUP; k++) {
    const s = setup();
    const d = await work(s);
    digests.add(d);
    firstDigest = d;
  }
  const times: number[] = [];
  for (let k = 0; k < RUNS; k++) {
    const s = setup();
    const t0 = performance.now();
    const d = await work(s);
    times.push(performance.now() - t0);
    digests.add(d);
    if (!firstDigest) firstDigest = d;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const hash = createHash('sha1').update(firstDigest).digest('hex').slice(0, 12);
  console.log(
    JSON.stringify({
      probe: name,
      off: off || 'none',
      medianMs: Number(median.toFixed(2)),
      timesMs: times.map((t) => Number(t.toFixed(1))),
      digest: hash,
      stableDigest: digests.size === 1,
      digestText: firstDigest.length > 400 ? firstDigest.slice(0, 400) + '…' : firstDigest,
    })
  );
}
