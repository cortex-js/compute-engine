/* Time high-precision numeric evaluation of transcendentals on a Compute Engine
 * bundle. Companion to bignum-compare.py (SymPy / mpmath). Used to build
 * BIGNUM-COMPARISON.md.
 *
 *   node benchmarks/big-decimal/bignum-compare.mjs <bundlePath> <label> [budgetMs]
 *
 * Time-budget method with ever-incrementing distinct arguments, so .N()'s
 * per-expression cache never hits and the measurement is robust to load.
 * Prints one JSON line: { label, rows:[{op,prec,perCallMs}], capability }. */

const bundlePath = process.argv[2];
const label = process.argv[3] ?? bundlePath;
const budgetMs = Number(process.argv[4] ?? 600);
const { ComputeEngine } = await import(bundlePath);

const PRECS = [100, 500, 1000];
const OPS = {
  ln: (c) => ['Ln', c + 2],
  exp: (c) => ['Exp', ['Divide', c + 1, c + 3]],
  sin: (c) => ['Sin', ['Divide', c + 1, c + 3]],
  cos: (c) => ['Cos', ['Divide', c + 1, c + 3]],
  tan: (c) => ['Tan', ['Divide', c + 1, c + 3]],
  atan: (c) => ['Arctan', c + 2],
  asin: (c) => ['Arcsin', ['Divide', c + 1, c + 3]],
  sqrt: (c) => ['Sqrt', c + 2],
};

function timeOp(ce, build, prec) {
  ce.precision = prec;
  let c = 0;
  for (; c < 3; c++) ce.expr(build(c)).N(); // warmup
  const lim = BigInt(budgetMs) * 1_000_000n;
  let calls = 0;
  const t0 = process.hrtime.bigint();
  let el = 0n;
  do {
    ce.expr(build(c++)).N();
    calls++;
    if ((calls & 7) === 0) el = process.hrtime.bigint() - t0;
  } while (el < lim);
  return Number(process.hrtime.bigint() - t0) / calls / 1e6;
}

const ce = new ComputeEngine();
const rows = [];
for (const [op, build] of Object.entries(OPS))
  for (const prec of PRECS) {
    let ms = NaN;
    try {
      ms = timeOp(ce, build, prec);
    } catch {
      ms = NaN;
    }
    rows.push({ op, prec, perCallMs: ms });
  }

// Capability: sin(1) at 3000 digits — pre-Chudnovsky CE caps out past ~2350.
let capability = 'error';
try {
  ce.precision = 3000;
  const s = ce.expr(['Sin', 1]).N().toString();
  capability = s.includes('NaN') ? 'NaN' : s.slice(0, 12);
} catch {
  capability = 'throw';
}

console.log(JSON.stringify({ label, rows, capability }));
