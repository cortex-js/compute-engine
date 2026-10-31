// Usage: npx tsx cancel.mts <repo root> [rows]
// ∫ dt/√(cos t − cos b) over [b/2, b] (singular at the upper bound) and the
// same integral mirrored to [−b, −b/2] (singular at the lower bound), for 40
// values of b from 0.05 to about 3. Next to b, `cos t − cos b` cancels in
// doubles, and the integrand is +∞ at some doubles next to the bound (GitHub
// issue #494). Prints the count of cases with a finite error and with an
// error that covers the true error; with a second argument, one row per case.
const root = process.argv[2];
const { adaptiveQuadrature } = await import(
  root + '/src/compute-engine/numerics/gauss-kronrod.ts'
);
// The reference value: `t = b − u²` removes the singularity, and
// `cos(b − u²) − cos b = 2·sin(b − u²/2)·sin(u²/2)` has no cancellation.
const ref = (b: number, a: number) =>
  adaptiveQuadrature(
    (u: number) =>
      (2 * u) / Math.sqrt(2 * Math.sin(b - (u * u) / 2) * Math.sin((u * u) / 2)),
    0,
    Math.sqrt(b - a),
    { rtol: 1e-14 }
  ).estimate;
let n = 0,
  finite = 0,
  covered = 0;
const rows: string[] = [];
for (let i = 0; i < 40; i++) {
  const b = 0.05 + 0.075 * i;
  const a = b * 0.5;
  for (const lowerEnd of [false, true]) {
    const exact = ref(b, a);
    const f = (t: number) => 1 / Math.sqrt(Math.cos(t) - Math.cos(b));
    const r = lowerEnd
      ? adaptiveQuadrature(f, -b, -a, { singularEndpoints: true })
      : adaptiveQuadrature(f, a, b, { singularEndpoints: true });
    const err = Math.abs(r.estimate - exact);
    n++;
    if (Number.isFinite(r.error)) finite++;
    if (err <= r.error) covered++;
    rows.push(
      `${b.toFixed(3)} ${lowerEnd ? 'lo' : 'hi'} err=${err.toExponential(1)} bar=${(r.error ?? Infinity).toExponential(1)}`
    );
  }
}
console.log(`cases ${n} finite bar ${finite} covered ${covered}`);
if (process.argv[3]) console.log(rows.join('\n'));
