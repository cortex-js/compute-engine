// Usage: npx tsx review-cases.mts <repo root>
// The cases found in the reviews of CE-691: two powers at 10⁹ (the error must
// cover the true error, as at commit fb5469f19), and a step of height 10⁶ at
// 1e-14 and 2e-14 from 0.3. Prints the true error, the error, and whether it
// covers the true error.
const [root] = process.argv.slice(2);
const { adaptiveQuadrature } = await import(root + '/src/compute-engine/numerics/gauss-kronrod.ts');
const e = 1e9;
const r1 = adaptiveQuadrature((x) => (x - e) ** -0.5 + 1.33e-5 * (x - e) ** -0.99, e, e + 1, { singularEndpoints: true });
const ex1 = 2 + 1.33e-5 / 0.01;
console.log('mixed', Math.abs(r1.estimate - ex1), r1.error, Math.abs(r1.estimate - ex1) <= r1.error);
for (const d of [1e-14, 2e-14]) {
  const c = 0.3;
  const r = adaptiveQuadrature((x) => 1 / Math.sqrt(c - x) + (x >= c - d ? 1e6 : 0), 0, c, { singularEndpoints: true });
  const ex = 2 * Math.sqrt(c) + 1e6 * d;
  console.log('step', d, Math.abs(r.estimate - ex), r.error, Math.abs(r.estimate - ex) <= r.error);
}
