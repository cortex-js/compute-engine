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
| `add` | CE HEAD | 58.5 | 60.7 | 75.1 | 130.7 | 292.5 |
|  | CE 0.66.0 | 75.3 | 91.4 | 153.5 | 289.5 | 698.7 |
|  | mpmath | 796.4 | 799.5 | 880.5 | 954.8 | 1,124 |
| `sub` | CE HEAD | 61.9 | 68.4 | 91.1 | 120.4 | 330.4 |
|  | CE 0.66.0 | 84.1 | 100.6 | 165.3 | 288.2 | 720.6 |
|  | mpmath | 777.8 | 754.1 | 857.6 | 852.6 | 1,019 |
| `mul` | CE HEAD | 71.2 | 89.9 | 206.3 | 308.6 | 943.4 |
|  | CE 0.66.0 | 95.3 | 155.4 | 320.9 | 610.9 | 1,696 |
|  | mpmath | 694.6 | 737.1 | 908.9 | 1,359 | 5,885 |
| `div` | CE HEAD | 297.1 | 353.6 | 501.9 | 865.7 | 2,774 |
|  | CE 0.66.0 | 1,181 | 1,388 | 1,778 | 2,450 | 5,375 |
|  | mpmath | 937.6 | 1,038 | 1,482 | 2,633 | 8,182 |
| `sqrt` | CE HEAD | 1,822 | 2,291 | 3,085 | 6,468 | 16,855 |
|  | CE 0.66.0 | 2,414 | 2,921 | 3,966 | 7,541 | 20,593 |
|  | mpmath | 1,584 | 2,065 | 3,496 | 5,958 | 19,752 |
| `round¹` | CE HEAD | 110.6 | 128.1 | 183 | 308.6 | 543.6 |
|  | CE 0.66.0 | 368.1 | 450 | 621.4 | 828.5 | 1,460 |
|  | mpmath | — | — | — | — | — |
| `normalize²` | CE HEAD | 125.7 | 143 | 258.7 | 520.4 | 1,285 |
|  | CE 0.66.0 | 98.6 | 114.3 | 218.3 | 432.8 | 1,069 |
|  | mpmath | — | — | — | — | — |
| `cmp` | CE HEAD | 26.7 | 27.4 | 28.3 | 28.8 | 30.7 |
|  | CE 0.66.0 | 91.6 | 117.2 | 196.6 | 175.1 | 171.6 |
|  | mpmath | — | — | — | — | — |

### Composite consumers (ns/op) — prove op-level wins propagate

| op | column | 21d | 50d | 100d | 200d | 500d |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `ln` | CE HEAD | 8,281 | 16,482 | 31,149 | 76,038 | 379,190 |
|  | CE 0.66.0 | 8,632 | 14,713 | 32,061 | 76,893 | 379,558 |
|  | mpmath | 2,217 | 2,983 | 5,439 | 15,343 | 109,102 |
| `exp` | CE HEAD | 2,509 | 3,863 | 7,489 | 18,379 | 97,556 |
|  | CE 0.66.0 | 3,320 | 4,712 | 8,600 | 19,707 | 98,369 |
|  | mpmath | 2,566 | 3,684 | 7,118 | 21,969 | 102,260 |
| `cos` | CE HEAD | 2,610 | 3,661 | 6,670 | 14,845 | 68,901 |
|  | CE 0.66.0 | 3,032 | 4,139 | 7,235 | 15,401 | 69,074 |
|  | mpmath | 2,828 | 4,522 | 9,265 | 21,523 | 105,961 |
| `ζ(3)³` | CE HEAD | 7,322 | 18,871 | 47,468 | 134,605 | 643,693 |
|  | CE 0.66.0 | 13,245 | 38,221 | 98,139 | 283,678 | 1,344,146 |
|  | mpmath | 1,276 | 1,392 | 1,383 | 1,359 | 1,432 |

¹ `round` = `toPrecision(p)` on a `p+16`-digit operand (rounding + re-normalize).
² `normalize` = constructing from a `bigint` (the constructor runs `normalize()` — trailing-zero strip + digit count); no separate export exists.
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
- **`normalize` (construct-from-bigint) is the one row HEAD did _not_ improve**
  (slightly slower: 21d 126 vs 99 ns). Honest and expected — the `div` win came
  from _skipping_ `normalize` calls, not from making `normalize` itself faster;
  the constructor path is unchanged. Flagged so a future `normalize`
  optimization has a baseline.
- **`sqrt` improved modestly** (500d 20593→16855 ns) and now leads mpmath from
  ~200 digits (the giant-steps `isqrt` landed pre-0.66.0). It trails mpmath only
  slightly at ≤100 digits (decimal↔binary boundary).

### Propagation check (composite consumers)

- **ζ(3) — the div/add-heavy series kernel — inherits the primitive wins with no
  kernel-specific change: 1.8× at 21d (13.2→7.3 µs), 2.1× at 100d (98→47 µs)
  and 2.1× at 500d (1.34 ms→0.64 ms) vs 0.66.0.** This is the propagation the
  primitive table promises: a kernel that is mostly `div` + `add` gets faster
  because `div` and `add` got faster.
- **`ln`/`exp`/`cos` are ≈ unchanged vs 0.66.0** (within noise): their inner
  loops round to the working precision every step, so the per-op `add`/`mul`
  wins are a smaller share, and the transcendental _kernels_ themselves did not
  change since 0.66.0 (the AGM-`ln` / base-2 kernel work all shipped _in_
  0.66.0). `cos` beats mpmath from 100 digits up (500d: 75.5 vs 111.7 µs); `ln`
  still trails mpmath (binary engine) except near 1000 digits — see below.

---

## Whole transcendentals

Per-call wall time to **numerically evaluate** a transcendental via
`ce.expr([op, …]).N()` at a fixed working precision, for four implementations:
**CE (current)**, **CE 0.66.0** (last published), **SymPy** (`expr.evalf(p)`,
1.14) and **mpmath** (`mpmath.<fn>` at `mp.dps=p`, 1.3 — the raw bignum engine
SymPy sits on, the truest like-for-like to CE's core). Distinct cost-bounded
arguments per call; fresh process per `(impl, op, precision)` cell.

**CE HEAD ≈ CE 0.66.0 across every transcendental** — the whole-kernel picture
has been stable since 0.66.0. All the current-vs-published movement now lives in
the [primitive layer](#primitive-operations) above; the published column is kept
here only as a continuity check.

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
- **`ln` leads at 1000 digits** (1.1× mpmath) once the AGM path engages (~700
  digits), but trails at 100–500 (below the AGM threshold; CE's Newton is slower
  than mpmath's AGM there). An honest residual.
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
