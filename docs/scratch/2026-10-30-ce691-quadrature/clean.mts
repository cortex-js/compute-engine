// Usage: npx tsx clean.mts <repo root> > out.tsv
// 420 singular integrands with no feature: (u)^(−p)·h(u), u the distance to
// the endpoint c (0, 0.3, 0.7, 1, 3.7, 1000.5, 10⁶), p in {0.1, 0.5, 0.75,
// 0.9, 0.99}, six smooth or logarithmic factors h, singular at the lower or
// the upper bound of an interval of width 0.25. Columns: c, p, h, side,
// estimate, error, 1 when extrapolated, 1 when converged.
const [root] = process.argv.slice(2);
const { adaptiveQuadrature } = await import(root + '/src/compute-engine/numerics/gauss-kronrod.ts');
const rows: string[] = [];
for (const c of [0, 0.3, 0.7, 1, 3.7, 1000.5, 1e6])
  for (const p of [0.1, 0.5, 0.75, 0.9, 0.99])
    for (const [hname, h] of [
      ['1', (_u: number) => 1],
      ['ln', (u: number) => -Math.log(u)],
      ['1+100u', (u: number) => 1 + 100 * u],
      ['e^u', (u: number) => Math.exp(u)],
      ['cos(3u)', (u: number) => Math.cos(3 * u)],
      ['1/(1+u^2)', (u: number) => 1 / (1 + u * u)],
    ] as [string, (u: number) => number][])
      for (const side of ['lo', 'hi']) {
        const L = 0.25;
        const [a, b] = side === 'lo' ? [c, c + L] : [c - L, c];
        const u = (x: number) => (side === 'lo' ? x - c : c - x);
        const f = (x: number) => u(x) ** -p * h(u(x));
        const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
        rows.push([c, p, hname, side, r.estimate, r.error, r.extrapolated ? 1 : 0, r.converged ? 1 : 0].join('\t'));
      }
console.log(rows.join('\n'));
