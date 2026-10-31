// Usage: npx tsx sweep.mts <repo root> > out.tsv
// 900 integrals: a pole (c − x)^(−1/2) at the upper bound c of [c − 0.3, c]
// plus a step or a bump of height J at the distance d from c. Columns: c,
// kind, J, d, true error, reported error, 1 when the error covers the true
// error, 1 when the result is extrapolated.

const root = process.argv[2];
const { adaptiveQuadrature } = await import(root + '/src/compute-engine/numerics/gauss-kronrod.ts');
// Pole (c − x)^(−1/2) at the upper endpoint c of [c − 0.3, c], plus a feature at distance d from c:
// a step of height J (area J·d), or a bump of height J and width d/4 centered at c − d (area J·d/4).
const rows: string[] = [];
for (const c of [0.3, 0.7, 1, 3.7, 1000.5])
  for (const kind of ['step', 'bump'])
    for (const J of (process.env.SWEEP_HEIGHTS ?? "1,1e-2,1e-4").split(",").map(Number))
      for (let i = 0; i < 30; i++) {
        const d = 10 ** (-3 - (8 * i) / 29);
        const s = c - d, a = c - 0.3;
        const f = kind === 'step'
          ? (x: number) => (x < s ? 0 : J) + 1 / Math.sqrt(c - x)
          : (x: number) => (Math.abs(x - s) < d / 8 ? J : 0) + 1 / Math.sqrt(c - x);
        const exact = 2 * Math.sqrt(0.3) + (kind === 'step' ? J * d : J * d / 4);
        const r = adaptiveQuadrature(f, a, c, { singularEndpoints: true });
        const err = Math.abs(r.estimate - exact);
        rows.push([c, kind, J, d.toExponential(2), err.toExponential(2), (r.error ?? Infinity).toExponential(2), err <= r.error ? 1 : 0, r.extrapolated ? 1 : 0].join('\t'));
      }
console.log(rows.join('\n'));
