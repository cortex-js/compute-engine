// Usage: npx tsx sweep-zero.mts <repo root> > out.tsv
// Corners at the endpoint 0 whose shells the Levin u-transform or the model
// of `shellTail()` reads: g(x) = 1/(x·ln²x) and 1/(x·(−ln x)³) on [0, ½], and
// x^(−1/2)·(−ln x) on [0, 1], plus a step (height A/d on [0, d], area A) or a
// bump (height 4A/d, width d/4, centered at d, area A), d = 10^−k. Columns:
// g, kind, A, d, true error, reported error, 1 when the error covers the true
// error, 1 when the result is extrapolated.
const root = process.argv[2];
const { adaptiveQuadrature } = await import(root + '/src/compute-engine/numerics/gauss-kronrod.ts');
const gs: [string, (x: number) => number, number, number][] = [
  ['1/(x ln^2 x)', (x) => 1 / (x * Math.log(x) ** 2), 0.5, 1 / Math.log(2)],
  ['1/(x (-ln x)^3)', (x) => 1 / (x * (-Math.log(x)) ** 3), 0.5, 1 / (2 * Math.log(2) ** 2)],
  ['x^-1/2 (-ln x)', (x) => -Math.log(x) / Math.sqrt(x), 1, 4],
];
const rows: string[] = [];
for (const [name, g, b, value] of gs)
  for (const kind of ['step', 'bump'])
    for (const A of [1e-6, 1e-9, 1e-12])
      for (const k of [3, 5, 8, 12, 20, 40, 80, 150, 300]) {
        const d = 10 ** -k;
        const f = kind === 'step'
          ? (x: number) => g(x) + (x <= d ? A / d : 0)
          : (x: number) => g(x) + (Math.abs(x - d) < d / 8 ? (4 * A) / d : 0);
        const r = adaptiveQuadrature(f, 0, b, { singularEndpoints: true });
        const err = Math.abs(r.estimate - (value + A));
        rows.push([name, kind, A, d.toExponential(0), err.toExponential(2), (r.error ?? Infinity).toExponential(2), err <= r.error ? 1 : 0, r.extrapolated ? 1 : 0].join('\t'));
      }
console.log(rows.join('\n'));
