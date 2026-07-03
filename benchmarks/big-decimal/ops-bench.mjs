/* Primitive-operation microbenchmark for the BigDecimal arbitrary-precision
 * core. Measures the COST OF OPERATIONS — the primitive arithmetic ops whose
 * improvement propagates to every high-precision kernel — plus a few composite
 * "consumer" rows (ln/exp/cos and an Apéry ζ(3) series) that prove op-level
 * wins propagate. Companion: ops-bench.py (mpmath reference). Orchestrated by
 * run-ops.mjs, which drives one fresh process per (bundle, precision) so
 * BigDecimal.precision — a PROCESS-GLOBAL — is set exactly once per block and
 * the single-entry constant caches (ln10/π/ln2) never thrash across precisions.
 *
 *   node benchmarks/big-decimal/ops-bench.mjs <bundlePath> <prec> [budgetMs]
 *
 * Prints one JSON line: { label, version, prec, rows:[{op,unit,perOp,ns}] }.
 *
 * Discipline (see BIGNUM-COMPARISON.md "Measurement discipline"):
 *  - WARM in-process loops: V8 needs tiering-up before the hot op is native;
 *    a cold-JIT single-shot measures the interpreter, not the kernel.
 *  - Distinct, cost-bounded arguments: a pre-built pool of p-digit operands is
 *    cycled per call so every call does a full p-digit-wide op (no degenerate
 *    short-circuit, no constant-folded reuse). BigDecimal ops are pure (they
 *    allocate a fresh result), so there is no per-result cache to hit — the
 *    pool only guarantees the WORK is p-digit-sized.
 *  - Time-budget loop, median-of-N: each cell runs the budget REPEATS times and
 *    reports the median, so a GC pause or scheduler blip can't dominate.
 */

const bundlePath = process.argv[2];
const prec = Number(process.argv[3]);
const budgetMs = Number(process.argv[4] ?? 200);
const REPEATS = 5;
const POOL = 64; // power of two → mask instead of modulo in the hot loop
const MASK = POOL - 1;

const mod = await import(bundlePath);
const B = mod.BigDecimal;
const version = mod.version ?? 'unknown';
const label = process.argv[5] ?? version;

B.precision = prec; // process-global; set ONCE for this whole run

// ---- deterministic operand generation -------------------------------------
// A tiny LCG so pools are reproducible run-to-run (and identical across the two
// bundles being compared — apples-to-apples arguments).
let _s = 0x9e3779b9 ^ (prec * 2654435761);
const rnd = () => {
  _s = (_s * 1664525 + 1013904223) >>> 0;
  return _s / 0x100000000;
};
const digits = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += ((rnd() * 10) | 0).toString();
  return s;
};
// p-digit BigDecimal in [1,10): leading nonzero digit, dot, p-1 fractional.
const mkP = (p) => new B(`${1 + ((rnd() * 9) | 0)}.${digits(p - 1)}`);
// p-digit BigDecimal in [0,2): safe, representative arg for exp/cos.
const mkSmall = (p) => new B(`${(rnd() * 2).toFixed(0)}.${digits(p - 1)}`);
// p-significant-digit BigInt with a few trailing zeros → exercises the
// normalize() trailing-zero strip that the constructor runs. NOTE: this is an
// ADVERSARIAL distribution — instrumentation of 39,900 real significands from
// live kernels (zeta3, div/mul/pow/add/sub @100d) found ZERO that entered the
// strip loop (42% odd, 58% ending in 2/4/6/8). Real arithmetic doesn't
// produce trailing-zero significands, so the typical row below is the one
// that reflects workload cost; this row tracks the worst case.
const mkBig = (p) => {
  const core = ((rnd() * 9) | 0) + 1 + digits(p - 4);
  return BigInt(core + '000');
};
// p-digit BigInt with a REALISTIC last digit (never 0): the common case the
// constructor's fast-exits (odd bit-test, %10) are optimized for.
const mkBigTypical = (p) => {
  const core = ((rnd() * 9) | 0) + 1 + digits(p - 2);
  return BigInt(core + (1 + ((rnd() * 9) | 0)).toString());
};

const poolA = Array.from({ length: POOL }, () => mkP(prec));
const poolB = Array.from({ length: POOL }, () => mkP(prec));
const poolC = Array.from({ length: POOL }, () => mkSmall(prec));
// operands with prec+16 significant digits so toPrecision(prec) really rounds.
const poolRound = Array.from({ length: POOL }, () => mkP(prec + 16));
const poolBig = Array.from({ length: POOL }, () => mkBig(prec));
const poolBigTyp = Array.from({ length: POOL }, () => mkBigTypical(prec));

// ---- Apéry ζ(3) series kernel (a div/mul-heavy CONSUMER) -------------------
// ζ(3) = 5/2 · Σ_{n≥1} (-1)^(n-1) / (n³ · C(2n,n)); term ~ /64 per step →
// ~0.55·prec terms for prec digits. Recomputed in full each call (no memo).
function zeta3() {
  const half = new B('0.5');
  let sum = new B(0);
  let binom = 1n; // C(2n,n)
  const terms = Math.ceil(prec * 0.6) + 4;
  for (let n = 1; n <= terms; n++) {
    binom = (binom * BigInt(2 * n) * BigInt(2 * n - 1)) / (BigInt(n) * BigInt(n));
    const denom = new B(BigInt(n * n * n) * binom);
    const t = B.ONE.div(denom);
    sum = (n & 1) === 1 ? sum.add(t) : sum.sub(t);
  }
  return sum.mul(half).mul(new B(5)); // 5/2 · Σ
}

// ---- op table -------------------------------------------------------------
// Each is a closure taking the call counter `i` (already masked) and doing ONE
// unit of work. Kept branch-free and allocation-free apart from the op result.
const OPS = {
  add: (i) => poolA[i].add(poolB[i]),
  sub: (i) => poolA[i].sub(poolB[i]),
  mul: (i) => poolA[i].mul(poolB[i]),
  div: (i) => poolA[i].div(poolB[i]),
  sqrt: (i) => poolA[i].sqrt(),
  round: (i) => poolRound[i].toPrecision(prec), // rounding + re-normalize
  normalize: (i) => new B(poolBigTyp[i]), // constructor → normalize(), realistic last digit
  normalize_tz: (i) => new B(poolBig[i]), // ADVERSARIAL: trailing-zero strip loop
  cmp: (i) => poolA[i].cmp(poolA[(i + 1) & MASK]),
  // composites (CONSUMERS, not targets):
  ln: (i) => poolA[i].ln(),
  exp: (i) => poolC[i].exp(),
  cos: (i) => poolC[i].cos(),
  zeta3: () => zeta3(),
};

// ---- one time-budget measurement, ns/op -----------------------------------
function once(fn) {
  // warm: let V8 tier the closure + kernel up to native before timing.
  for (let i = 0; i < 50; i++) fn(i & MASK);
  const lim = BigInt(budgetMs) * 1_000_000n;
  let n = 0;
  let el = 0n;
  const t0 = process.hrtime.bigint();
  do {
    fn(n & MASK);
    n++;
    if ((n & 31) === 0) el = process.hrtime.bigint() - t0;
  } while (el < lim);
  const total = Number(process.hrtime.bigint() - t0);
  return total / n; // ns/op
}
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];

const rows = [];
for (const [op, fn] of Object.entries(OPS)) {
  let ns = NaN;
  try {
    const samples = [];
    for (let r = 0; r < REPEATS; r++) samples.push(once(fn));
    ns = median(samples);
  } catch (e) {
    ns = NaN;
  }
  rows.push({ op, unit: 'ns/op', ns, perOp: Number.isFinite(ns) ? +ns.toFixed(1) : null });
}

console.log(JSON.stringify({ label, version, prec, rows }));
