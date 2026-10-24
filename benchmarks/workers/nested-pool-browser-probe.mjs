// An engine inside a dedicated module worker makes its own kernel pool of
// nested module workers (ROADMAP CE-314.3, Tycho row 441 part 2), in
// Chromium, Firefox and WebKit. The page starts a module worker `outer.js`;
// that worker imports the built bundle, makes a pool of two workers on
// `kernel-worker.js` and sets `ce.workers`, then runs a batch with
// `inline: false` and a `FindFit` whose separable scan compiles. It reports
// the route of each and whether the values are those of one thread.
//
// The files come from a local HTTP server: Playwright's request routing does
// not see the script request of a worker started inside a worker in Chromium
// and Firefox (Tycho measured this on 2026-10-24).
//
// The Compute Engine does not depend on Playwright. Run with a Playwright
// installed elsewhere, after `npm run build`:
//
//   PLAYWRIGHT=/path/to/node_modules/playwright/index.mjs \
//     node benchmarks/workers/nested-pool-browser-probe.mjs [dist/esm-min]
//
// Result on 2026-10-24 (0.166.0 bundle): route `pool` and the same values
// for the batch and the fit in Chromium 156, Firefox 157 and WebKit 27.2.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, resolve } from 'node:path';
const { chromium, firefox, webkit } = await import(
  process.env.PLAYWRIGHT ?? 'playwright'
);
const DIST = resolve(process.argv[2] ?? 'dist/esm-min');
const OUTER = `
import { ComputeEngine, compile, createKernelPool } from './compute-engine.js';
const pool = createKernelPool({
  create: () => new Worker(new URL('./kernel-worker.js', import.meta.url), { type: 'module' }),
  size: 2,
});
const ce = new ComputeEngine();
ce.workers = pool;
try {
  const f = compile(ce.parse('\\\\sin(x)\\\\cos(3x) + x^2'));
  const n = 200000;
  const xs = Float64Array.from({ length: n }, (_, i) => -5 + (10 * i) / n);
  let t = performance.now();
  const onPool = await f.broadcastAsync({ x: xs }, { inline: false });
  const poolMs = performance.now() - t;
  t = performance.now();
  const inline = f.broadcast({ x: xs });
  const inlineMs = performance.now() - t;
  let same = onPool.done === n;
  for (let i = 0; same && i < n; i++) same = Object.is(onPool.out[i], inline[i]);
  const rowsX = Array.from({ length: 400 }, (_, i) => (10 * i) / 399);
  const call = ['FindFit', ['List', ...rowsX.map((x) => ['Tuple', x, 2 * Math.cos(2.2 * x + 0.5) + 0.1 * x])],
    ['Add', ['Multiply', 'a', ['Cos', ['Add', ['Multiply', 'b', 'x'], 'c']]], ['Multiply', 'd', 'x']],
    ['List', 'a', 'b', 'c', 'd'], ['List', 'x'], { dict: { global: { dict: { b: [0.3, 60], c: [0, 6.283] } } } }];
  const fit = await ce.box(call).evaluateAsync();
  const sync = new ComputeEngine().box(call).evaluate();
  postMessage({ ok: true, cores: navigator.hardwareConcurrency, batch: { route: onPool.route, same, poolMs: Math.round(poolMs), inlineMs: Math.round(inlineMs) },
    fit: { route: fit.get('route')?.string, same: String(fit.get('parameters')) === String(sync.get('parameters')) } });
} catch (e) {
  postMessage({ ok: false, error: String(e && e.stack || e) });
} finally {
  pool.dispose();
}
`;
const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/index.html')
    return res
      .writeHead(200, { 'content-type': 'text/html' })
      .end('<!doctype html><title>probe</title>');
  if (path === '/outer.js')
    return res.writeHead(200, { 'content-type': 'text/javascript' }).end(OUTER);
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) return res.writeHead(403).end();
  let body;
  try {
    body = await readFile(file);
  } catch {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'content-type': 'text/javascript' }).end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
for (const [name, type] of [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
]) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/index.html`);
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const outer = new Worker('/outer.js', { type: 'module' });
          outer.onmessage = (e) => resolve(e.data);
          outer.onerror = (e) =>
            resolve({ ok: false, error: 'outer error: ' + e.message });
          setTimeout(() => resolve({ ok: false, error: 'timeout' }), 60000);
        })
    );
    console.log(name, browser.version(), JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
server.close();
