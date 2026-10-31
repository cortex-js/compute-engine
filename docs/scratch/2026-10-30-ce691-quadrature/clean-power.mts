// Usage: npx tsx clean-power.mts <repo root> > out.tsv
// Corners whose shells decrease as a power of their index, with no feature:
// u^(−1)·(−ln u)^(−q), u the distance to the endpoint c, on an interval of
// width L at the lower or the upper side, q in {1.1, 1.5, 2, 3, 4}, L in
// {0.25, 1e-3}. The integral is (−ln L)^(1−q)/(q − 1). Columns: c, q, L,
// side, true error, error, 1 when covered, 1 when extrapolated, 1 when
// converged.
const [root] = process.argv.slice(2);
const { adaptiveQuadrature } = await import(root + '/src/compute-engine/numerics/gauss-kronrod.ts');
const rows: string[] = [];
for (const c of [0, 0.3, 0.7, 1, 3.7, 1000.5, 1e6])
  for (const q of [1.1, 1.5, 2, 3, 4])
    for (const L of [0.25, 1e-3])
      for (const side of ['lo', 'hi']) {
        const [a, b] = side === 'lo' ? [c, c + L] : [c - L, c];
        const u = (x: number) => (side === 'lo' ? x - c : c - x);
        const f = (x: number) => 1 / (u(x) * (-Math.log(u(x))) ** q);
        const exact = (-Math.log(L)) ** (1 - q) / (q - 1);
        const r = adaptiveQuadrature(f, a, b, { singularEndpoints: true });
        const err = Math.abs(r.estimate - exact);
        rows.push([c, q, L, side, err.toExponential(2), r.error.toExponential(2), err <= r.error ? 1 : 0, r.extrapolated ? 1 : 0, r.converged ? 1 : 0].join('\t'));
      }
console.log(rows.join('\n'));
