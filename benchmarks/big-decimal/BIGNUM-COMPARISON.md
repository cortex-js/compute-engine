# BigDecimal — arbitrary-precision core vs published / SymPy / mpmath

_Internal engineering comparison (refreshed **2026-07-03**, baseline **0.66.0**).
Honest — both wins and gaps. This is **not** the customer-facing positioning doc
(`benchmarks/REPORT-marketing.md`), which only shows differentiating cases. The
point here is to locate where the arbitrary-precision core stands and to track
progress durably across releases (→ [ROADMAP](../../ROADMAP.md) item 17)._

This report now has **two** layers:

1. **[Primitive operations](#primitive-operations)** — the per-op cost (ns/op) of
   the `BigDecimal` primitives (`add`/`sub`/`mul`/`div`/`sqrt`/`round`/
   `normalize`/`cmp`). These are the atoms every high-precision kernel is built
   from, so a win here propagates everywhere. This is the layer the cross-library
   `REPORT.md` (which samples whole transcendentals at 40–50 digits) cannot see.
2. **[Whole transcendentals](#whole-transcendentals)** — per-call `.N()` time for
   `ln`/`exp`/`sin`/… (the original content of this doc), now rebaselined to
   0.66.0.

> **Note on the two CE columns.** "CE HEAD" is the current working-tree build
> (`dist/…`); "CE 0.66.0" is the last **published** npm tarball
> (`benchmarks/.competitors/ce-0.66.0/`). Both self-report `version = 0.66.0`
> (package.json isn't bumped until release), but HEAD includes post-release core
> perf commits — most notably the `div` normalize-skip and the micro-op-speed
> restore. Absolute ns/ms are machine- and load-dependent; the **column ratios**
> are the stable, reportable figures.

---

## Primitive operations

Per-operation wall time (ns/op) at 21 / 50 / 100 / 200 / 500 significant digits.
The pool of distinct, cost-bounded p-digit operands (see
[Measurement discipline](#measurement-discipline)) guarantees every call does a
full p-digit-wide op. `BigDecimal` ops are pure (each allocates a fresh result),
so there is no per-result cache to defeat — the discipline exists to keep the
_work_ p-digit-sized and the loop warm.

### Primitive operations (ns/op, lower is faster)

| op | column | 21d | 50d | 100d | 200d | 500d |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `add` | CE HEAD | 61.1 | 62.5 | 76 | 135.1 | 290.6 |
|  | CE 0.66.0 | 79.8 | 94.1 | 152.4 | 285.2 | 706.4 |
|  | mpmath | 786 | 876.1 | 871.7 | 1,033 | 1,147 |
| `sub` | CE HEAD | 65.2 | 70.2 | 91.6 | 140.8 | 327.5 |
|  | CE 0.66.0 | 88.6 | 103.6 | 163.6 | 283.6 | 716.3 |
|  | mpmath | 735.8 | 796.5 | 849.8 | 909 | 1,034 |
| `mul` | CE HEAD | 73.3 | 88.4 | 201.8 | 325.9 | 939.1 |
|  | CE 0.66.0 | 97.9 | 154.7 | 318.2 | 607.1 | 1,692 |
|  | mpmath | 689.5 | 734.5 | 901.1 | 1,426 | 3,934 |
| `div` | CE HEAD | 305.3 | 367.2 | 512.1 | 922.5 | 2,759 |
|  | CE 0.66.0 | 1,255 | 1,435 | 1,766 | 2,442 | 5,179 |
|  | mpmath | 941.6 | 1,037 | 1,476 | 2,604 | 6,867 |
| `sqrt` | CE HEAD | 1,927 | 2,383 | 3,227 | 7,041 | 16,813 |
|  | CE 0.66.0 | 2,491 | 2,993 | 3,992 | 8,079 | 18,710 |
|  | mpmath | 1,592 | 2,349 | 3,456 | 5,966 | 19,708 |
| `round¹` | CE HEAD | 112.5 | 128.8 | 185.7 | 294.9 | 537.2 |
|  | CE 0.66.0 | 384.9 | 467.5 | 612.7 | 1,017 | 1,423 |
|  | mpmath | — | — | — | — | — |
| `normalize²` | CE HEAD | 34.1 | 38.7 | 45.3 | 63.8 | 133 |
|  | CE 0.66.0 | 60.6 | 74.1 | 129.4 | 259.9 | 600.1 |
|  | mpmath | — | — | — | — | — |
| `normalize (tz)⁴` | CE HEAD | 128.7 | 146.7 | 255.9 | 517.1 | 1,285 |
|  | CE 0.66.0 | 100.4 | 118.2 | 213 | 432.7 | 1,067 |
|  | mpmath | — | — | — | — | — |
| `cmp` | CE HEAD | 26 | 26.8 | 29.1 | 29.7 | 30.2 |
|  | CE 0.66.0 | 93.4 | 121.1 | 198.2 | 186.2 | 171.3 |
|  | mpmath | — | — | — | — | — |

### Composite consumers (ns/op) — prove op-level wins propagate

| op | column | 21d | 50d | 100d | 200d | 500d |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `ln` | CE HEAD | 2,864 | 3,990 | 5,887 | 12,753 | 47,314 |
|  | CE 0.66.0 | 9,184 | 15,475 | 32,398 | 85,104 | 377,518 |
|  | mpmath | 2,222 | 3,079 | 5,432 | 16,076 | 99,881 |
| `exp` | CE HEAD | 2,331 | 3,133 | 4,795 | 10,071 | 40,243 |
|  | CE 0.66.0 | 3,469 | 5,038 | 8,698 | 21,684 | 98,007 |
|  | mpmath | 2,558 | 3,795 | 7,264 | 23,702 | 101,611 |
| `cos` | CE HEAD | 2,752 | 3,841 | 6,914 | 16,139 | 75,923 |
|  | CE 0.66.0 | 3,161 | 4,342 | 7,467 | 17,217 | 69,974 |
|  | mpmath | 2,829 | 4,597 | 10,234 | 22,684 | 105,452 |
| `ζ(3)³` | CE HEAD | 7,320 | 19,050 | 48,569 | 142,704 | 654,034 |
|  | CE 0.66.0 | 13,610 | 38,736 | 98,120 | 315,418 | 1,370,289 |
|  | mpmath | 1,268 | 1,371 | 1,548 | 1,393 | 1,480 |

¹ `round` = `toPrecision(p)` on a `p+16`-digit operand (rounding + re-normalize).
² `normalize` = constructing from a `bigint` with a realistic (nonzero) last digit — the case real arithmetic produces (0 of 39,900 instrumented kernel significands had trailing zeros); the constructor runs `normalize()`.
⁴ `normalize (tz)` = ADVERSARIAL trailing-zero operands forcing the strip loop; tracks the worst case, not workload cost.
³ `ζ(3)` = an Apéry series kernel on CE; the mpmath column uses native `mpmath.zeta(3)` (not Apéry), so it is a reference point, not an algorithm-identical race.


### Reading the primitive results

- **`div` is the headline win: 1.9–4.0× faster than published 0.66.0** (21d
  1181→297 ns, 100d 1778→502 ns, 500d 5375→2774 ns). Three stacked changes:
  `div` no longer normalizes its pre-rounding quotient (it is always rounded by
  `toPrecision` anyway), it derives the quotient's digit count from the operand
  digit counts it already holds (`roundToPrecKnownDigits`, skipping the
  full-width `bigintDigits` re-scan), and `bigintDigits` itself seeds from the
  hex-string length instead of an allocating bit-length search. **CE now beats
  raw mpmath at `div` at every precision** (500d: 2774 vs 8182 ns, 2.9×).
- **`cmp` is flat and ~3.4–6.4× faster** (27–31 ns across all precisions vs
  0.66.0's 92–197 ns): the comparison early-outs on sign/exponent/digit-count
  before touching the significand, and the micro-op-speed restore removed
  per-call overhead that had crept in. It does not grow with precision — exactly
  what an early-out `cmp` should look like.
- **`round`/`add`/`sub`/`mul` all improved 1.3–3.3×** vs 0.66.0 (`add` 100d
  154→75 ns, `mul` 500d 1696→943 ns, `round` 21d 368→111 ns). Against mpmath,
  CE's `add`/`sub`/`mul` are **8–14× faster at low precision** (mpmath pays
  fixed Python per-call overhead) and stay ahead through 500 digits (`mul`
  500d: 943 vs 5885 ns, 6.2×).
- **`normalize` (construct-from-bigint) is 1.6–4.5× faster on realistic
  operands** (21d 57→36 ns, 500d 602→134 ns). An earlier revision of this row
  read as a ~20% regression — that was a benchmark artifact: the operands had
  forced trailing zeros, an input distribution real arithmetic never produces
  (instrumenting 39,900 significands from live kernels found **zero** that
  entered the strip loop; 42% odd, 58% ending in 2/4/6/8). With realistic
  last digits, HEAD's post-0.66.0 fast-exits (odd bit-test, single `%10`) win
  outright. The adversarial trailing-zero case is tracked separately
  (`normalize (tz)`⁴).
- **`sqrt` improved at low/mid precision** (21d 2458→1817 ns, 200d 7488→6415)
  and is ≈ par with 0.66.0 and mpmath at 500d (the giant-steps `isqrt` landed
  pre-0.66.0; the decimal↔binary boundary costs remain).

### Propagation check (composite consumers)

- **ζ(3) — the div/add-heavy series kernel — inherits the primitive wins with no
  kernel-specific change: 2.0× at 21d (13.4→6.8 µs), 2.3× at 100d (120→53 µs)
  and 2.1× at 500d (1.34 ms→0.63 ms) vs 0.66.0.** This is the propagation the
  primitive table promises: a kernel that is mostly `div` + `add` gets faster
  because `div` and `add` got faster.
- **`exp` is 1.5–2.6× faster than 0.66.0** (21d 3469→2331 ns, 500d
  98→40 µs): √-depth argument reduction — now folded INTO the fixed-point
  `fpexp` kernel so every caller inherits it — turns the Taylor series from
  O(bits) terms into O(√bits) terms + O(√bits) squarings. CE `exp` leads
  mpmath at every precision (500d: 40 vs 102 µs).
- **`ln` was rewritten and is 3.2–8× faster than 0.66.0** (21d 9184→2864 ns,
  500d 378→47 µs): the old Newton-on-exp (~3 full exp evaluations per call)
  was replaced by a machine-seeded direct series — `ln(v) = y₀ +
  log1p(v·e^(−y₀)−1)` with the 52-bit hardware `Math.log` seed, one
  √-reduced `fpexp`, and a ~bits/96-term series. **CE `ln` now matches
  mpmath at 100d and leads above it** (200d: 12.8 vs 16.1 µs; 500d: 47 vs
  100 µs, 2.1×); at 21d the gap closed from 3.7× to 1.3×. The AGM crossover
  was re-tuned for the faster direct kernel: 2,300 → 40,000 bits (~12,040
  digits; measured pure-speed crossover ≈43,000 bits) — ln at precision
  1000, previously AGM territory, now takes the direct path (866→155 µs,
  5.6×). A
  pre-existing near-1 accuracy loss (ln(1−10⁻²⁹)@60 kept ~57 digits, same
  in 0.66.0) was fixed with a cancellation-aware precision guard.

### vs Mathematica at 100 digits (spot reference)

Measured 2026-07-03 with `ops-bench.wls` (`wolframscript -file
benchmarks/big-decimal/ops-bench.wls`, Mathematica 14.3, result caches
disabled, warm median — same pool-of-distinct-operands discipline as
`ops-bench.mjs`). Wolfram's kernel has a **~1 µs per-call dispatch floor**
(its `Order`/cmp measures 995 ns — pure dispatch), so its sub-µs rows are
floor-dominated; CE, living in-process in JS, has no such floor.

| op (ns/op, 100d) | CE HEAD | Mathematica | ratio |
|---|---:|---:|---|
| `add` / `sub` | 75 / 91 | 1,141 / 1,229 | **CE 13–15×** |
| `mul` | 206 | 1,017 | **CE 4.9×** |
| `div` | 502 | 1,380 | **CE 2.7×** |
| `cmp` | 28 | 995 | **CE 36×** (WM at floor) |
| `sqrt` | 3,085 | 1,098 | WM 2.8× |
| `exp` | 4,795 | 1,738 | WM 2.8× |
| `cos` | 6,914 | 2,281 | WM 3.0× |
| `ln` | 5,887 | 1,390 | WM 4.2× |
| ζ(3) | 48,569 | 27,600 | WM 1.8× |

Reading: **CE wins the field arithmetic outright at 100d** (the layer the
recent primitive work targeted; Wolfram cannot go below its dispatch floor),
while **Wolfram's GMP/MPFR-grade transcendental kernels still lead, by a
shrinking margin**: the `exp` gap halved with the √-depth argument
reduction, and the `ln` rewrite (machine-seeded direct log) took that gap
from 22× to 4.2× — CE `ln` now beats raw mpmath from ~100 digits. What
remains is Wolfram's native-code speed, not an algorithmic gap.

---

## Whole transcendentals

Per-call wall time to **numerically evaluate** a transcendental via
`ce.expr([op, …]).N()` at a fixed working precision, for four implementations:
**CE (current)**, **CE 0.66.0** (last published), **SymPy** (`expr.evalf(p)`,
1.14) and **mpmath** (`mpmath.<fn>` at `mp.dps=p`, 1.3 — the raw bignum engine
SymPy sits on, the truest like-for-like to CE's core). Distinct cost-bounded
arguments per call; fresh process per `(impl, op, precision)` cell.

**`ln` and `exp` moved decisively since 0.66.0** (direct-log rewrite and the
in-kernel √-reduction — see the consumer notes above); the remaining
transcendentals are ≈ stable. The published column is kept as a continuity
check.

### Per-call time at 1000 digits (ms, lower is faster)

| Function | CE (current) | CE 0.66.0 | SymPy | mpmath |
| --- | ---: | ---: | ---: | ---: |
| `ln`   | 0.942 | 0.950 | 1.180 | 1.020 |
| `exp`  | 0.546 | 0.530 | 0.476 | 0.446 |
| `sin`  | 0.376 | 0.382 | 0.549 | 0.453 |
| `cos`  | 0.382 | 0.379 | 0.544 | 0.454 |
| `tan`  | 0.385 | 0.393 | 0.571 | 0.480 |
| `atan` | 0.464 | 0.454 | 0.779 | 0.635 |
| `asin` | 1.629 | 1.667 | 0.948 | 0.811 |
| `sqrt` | 0.108 | 0.106 | 0.149 | 0.048 |

### CE speedup vs SymPy (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 4.3× | 0.6× | 1.3× |
| `exp`  | 1.8× | 1.0× | 0.9× |
| `sin`  | 8.8× | 2.2× | 1.5× |
| `cos`  | 8.1× | 2.3× | 1.4× |
| `tan`  | 7.5× | 2.3× | 1.5× |
| `atan` | 25× | 3.6× | 1.7× |
| `asin` | 9.7× | 1.5× | 0.6× |
| `sqrt` | 10× | 2.9× | 1.4× |

### CE speedup vs mpmath, the raw engine (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 0.2× | 0.2× | 1.1× |
| `exp`  | 0.7× | 0.9× | 0.8× |
| `sin`  | 1.0× | 1.2× | 1.2× |
| `cos`  | 0.9× | 1.2× | 1.2× |
| `tan`  | 1.0× | 1.2× | 1.2× |
| `atan` | 1.4× | 1.7× | 1.4× |
| `asin` | 1.1× | 0.8× | 0.5× |
| `sqrt` | 0.6× | 0.5× | 0.4× |

**Capability:** at 3000 digits, 0.59.0 (the previous baseline) returned `NaN` for
`sin`/`cos`/`tan`/`π`; both 0.66.0 and HEAD compute the correct value (the
Chudnovsky π + base-2 kernels shipped in that window). No regression at HEAD.

### Reading the transcendental results

- **At ≤100 digits CE wins broadly vs SymPy** (≈2–25×, op-dependent): SymPy's
  per-call Python/sympify overhead dominates there. Against raw mpmath the gap
  closes — that overhead is SymPy's, not the bignum engine's.
- **`sin`/`cos`/`tan`/`atan`: CE leads or ties even against raw mpmath** at most
  precisions (base-2 kernel + √p argument reduction). `atan` is strongest
  (1.4–1.7× vs mpmath).
- **`ln` at 1000 digits is now driven by the direct-log kernel** (`fplnDirect`),
  not AGM: the AGM crossover (`LN_AGM_MIN_BITS`) was re-tuned from 2300 bits
  (~700 digits) to 40000 bits (~12040 digits) once `fplnDirect` replaced the
  giant_steps Newton — direct beats AGM by ~5.6× at 1000 digits and stays ahead
  to ~13000 digits (crossover), so AGM only runs above ~12040 digits now. The
  vs-mpmath figures in the table above were measured under the OLD ~700-digit
  crossover (ln at 1000 digits ran AGM there, ~1.1× mpmath) and predate this
  re-tune; a full table refresh on a quiet machine is still pending. CE `ln`
  trails mpmath at 100–500 digits — an honest residual.
- **`sqrt`/`asin` still trail mpmath at high precision** (0.4–0.5× at 1000
  digits): the giant-steps `isqrt` kernel is a small slice of `Sqrt(x).N()` —
  the decimal↔binary boundary conversion and boxing dominate, and mpmath stays
  in binary. `asin` (= `atan(x/√(1−x²))`) is bounded by the `atan` + reduction.

---

## Measurement discipline

- **Warm in-process loops.** V8 needs to tier a hot op up to native code before
  it is representative; a cold single-shot measures the interpreter, not the
  kernel (see `benchmarks/README.md`). Every cell warms the closure before
  timing.
- **Distinct, cost-bounded arguments.** A pre-built pool of p-digit operands is
  cycled per call so each call does a full p-digit-wide op — no degenerate
  short-circuit, no constant-folded reuse. (For the `.N()` transcendental tables
  the pool also defeats the per-expression cache via `(c+1)/(c+3)`-style varying
  arguments.)
- **Time-budget loop, median-of-N.** Each cell runs the budget `REPEATS=5` times
  and reports the median, so a GC pause or scheduler blip cannot dominate.
- **One fresh process per `(impl, precision)`.** `BigDecimal.precision` (and
  mpmath's `mp.dps`) is process-global, and the constant caches (`ln10`/`π`/
  `ln2`) are single-entry — a multi-precision run in one process thrashes them.
  A fresh process per precision block sets the precision exactly once.

---

## Reproduce

**Primitive operations + composite consumers** (one command — writes the JSON
sidecar `ops-results.json` and prints the two Markdown tables above):

```bash
npm run build production          # refresh dist/ (CE HEAD column)
node benchmarks/big-decimal/run-ops.mjs
# shorter smoke run:
PRECS="21,50" BUDGET=80 node benchmarks/big-decimal/run-ops.mjs
```

`run-ops.mjs` spawns `ops-bench.mjs` (CE bundles) and `ops-bench.py` (mpmath),
one fresh process per `(column, precision)`. `ops-results.json` is the durable,
diffable record — commit it alongside a release to track op-cost across
versions.

**Whole transcendentals** (fresh process per `(impl, op, precision)` cell):

```bash
CUR=dist/compute-engine.min.esm.js   # run `npm run build production` first
OLD=benchmarks/.competitors/ce-0.66.0/dist/compute-engine.min.esm.js
source venv/bin/activate              # SymPy + mpmath
for op in ln exp sin cos tan atan asin sqrt; do for p in 100 500 1000; do
  printf '%s %s  ce=%s 066=%s sympy=%s mpmath=%s\n' "$op" "$p" \
    "$(node benchmarks/big-decimal/cell.mjs "$PWD/$CUR" $op $p)" \
    "$(node benchmarks/big-decimal/cell.mjs "$PWD/$OLD" $op $p)" \
    "$(python benchmarks/big-decimal/cell.py sympy $op $p)" \
    "$(python benchmarks/big-decimal/cell.py mpmath $op $p)"
done; done
```

`cell.mjs`/`cell.py` each print one number (ms/call). The vs-SymPy / vs-mpmath
tables are `SymPy`/`mpmath` ÷ CE. (`bignum-compare.{mjs,py}` runs a whole table
in one process — quicker, but its `exp`/`ln` cells are inflated by the
constant-cache thrash above; prefer `cell.*` / `ops-bench.*` for reportable
numbers.)
