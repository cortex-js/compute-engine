# BigDecimal — high-precision numeric evaluation vs SymPy / mpmath

_Internal engineering comparison (2026-06-15). Honest, both wins and gaps — this
is **not** the customer-facing positioning doc (`benchmarks/REPORT-marketing.md`),
which only shows differentiating cases. The point here is to locate where the
arbitrary-precision core stands against the reference implementation and to
confirm the remaining work (→ [ROADMAP](../../ROADMAP.md) item 17)._

## What is measured

Per-call wall time to **numerically evaluate** a transcendental at a fixed
working precision, for four implementations:

- **CE (current)** — `ce.expr([op, …]).N()` at `ce.precision = p`, current build.
- **CE 0.59.0** — same, the last published release (the kernel before this
  release's base-2 / `giant_steps` / AGM / Chudnovsky work).
- **SymPy** — `expr.evalf(p)` (SymPy 1.14, what a SymPy user runs).
- **mpmath** — `mpmath.<fn>` at `mp.dps = p` (mpmath 1.3, the raw bignum engine
  SymPy sits on — the truest like-for-like to CE's bignum core).

Method: a time-budget loop with **distinct, cost-bounded arguments** each call,
so per-expression caches never hit and the numbers are robust to load. Arguments
are integers (`ln`, `atan`, `sqrt`) or `(c+1)/(c+3)` ratios reduced to a
high-precision float before the call (so no implementation can exploit
rationality). Reproduce: see the bottom of this file.

_Tables refreshed 2026-06-15 after the giant-steps `isqrt` (17.11), the lowered
AGM `ln` threshold (17.10), and the `e^x` redundant-`ln` fix (17.13), via the
fresh-process-per-cell method (one `(impl, op, prec)` per process, no
cross-precision cache thrash). Both CE builds and 0.59.0 are minified bundles._

## Per-call time at 1000 digits (ms, lower is faster)

| Function | CE (current) | CE 0.59.0 | SymPy | mpmath |
| --- | ---: | ---: | ---: | ---: |
| `ln`   | 0.94 | 20.2  | 1.17 | 1.03 |
| `exp`  | 0.52 | 65.0  | 0.47 | 0.44 |
| `sin`  | 0.38 |  1.3  | 0.54 | 0.45 |
| `cos`  | 0.38 |  1.3  | 0.54 | 0.49 |
| `tan`  | 0.39 |  1.3  | 0.57 | 0.48 |
| `atan` | 0.40 |  1.7  | 0.75 | 0.61 |
| `asin` | 1.34 |  6.1  | 0.93 | 0.79 |
| `sqrt` | 0.10 |  0.14 | 0.15 | 0.05 |

## CE speedup vs SymPy (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 4.9× | 0.6× | 1.2× |
| `exp`  | 1.8× | 1.1× | 0.9× |
| `sin`  | 8.8× | 2.3× | 1.4× |
| `cos`  | 8.8× | 2.3× | 1.4× |
| `tan`  | 8.3× | 2.1× | 1.5× |
| `atan` | 24× | 3.8× | 1.9× |
| `asin` | 9.4× | 1.5× | 0.7× |
| `sqrt` | 13× | 3.2× | 1.5× |

## CE speedup vs mpmath, the raw engine (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 0.2× | 0.3× | 1.1× |
| `exp`  | 0.7× | 1.0× | 0.8× |
| `sin`  | 1.0× | 1.2× | 1.2× |
| `cos`  | 1.0× | 1.2× | 1.3× |
| `tan`  | 1.0× | 1.1× | 1.2× |
| `atan` | 1.2× | 1.7× | 1.5× |
| `asin` | 1.1× | 0.8× | 0.6× |
| `sqrt` | 0.7× | 0.5× | 0.5× |

**Capability:** at 3000 digits, 0.59.0 returns `NaN` for `sin`/`cos`/`tan` and
`π` (the hardcoded π table ran out); CE current and mpmath both compute the
correct value. (SymPy/mpmath never had that ceiling.)

## Reading the results

- **At low precision (≤100 digits) CE wins broadly vs SymPy** (roughly 2–24×,
  op-dependent): SymPy's per-call Python/sympify overhead dominates there.
  Against raw mpmath the gap closes — that overhead is SymPy's, not the bignum
  engine's.
- **`sin`/`cos`/`tan`/`atan`: CE leads or ties** even against raw mpmath at every
  precision (the base-2 kernel + √p argument-reduction pays off). `atan` is the
  strongest (1.2–1.7× vs mpmath).
- **`exp` now ties mpmath** (0.8–1.0× at 500–1000 digits, was ~0.2×): `Exp(x).N()`
  at 1000 digits went 2.50 → **0.52ms** (now ≈ the bare `fpexp` kernel, 0.44ms
  for mpmath). The culprit was a *redundant* `ln(e)` — `Exp(x)` canonicalizes to
  `Power(E, x)`, and `.N()` numericized the `E` base to `e` before the `e^x`
  shortcut, so `e^x` ran as `exp(x·ln(e))`, recomputing `ln(e) ≈ 1` each call
  (17.13; root-cause note below). ~124× faster than 0.59.0.
- **`ln` now leads at 1000 digits** (1.1× mpmath, 1.2× SymPy; was 0.5×): the AGM
  path now engages from ~700 digits (down from ~1250 once the giant-steps `isqrt`
  made AGM's inner-loop sqrt cheaper — 17.10/17.11). End-to-end `ln` at 1000
  digits 1.90 → **0.94ms**. It still trails at **500 digits** (0.3× mpmath): that
  is below the AGM threshold (Newton is faster than CE's *own* AGM there), and
  CE's Newton is slower than mpmath's AGM — an honest residual.
- **`sqrt` kernel is ~2× faster but the end-to-end `.N()` still trails mpmath**
  (~0.5×): the giant-steps `isqrt` (17.11) cut the kernel from ~0.063 to ~0.033ms
  at 1000 digits, but the kernel is a small slice of `Sqrt(x).N()` (0.10ms) — the
  decimal↔binary boundary conversion and boxing dominate, and mpmath stays in
  binary. `asin` (= `atan(x/√(1−x²))`) is still the weakest at high precision
  (0.6× at 1000 digits); its cost is the `atan` + reduction, not the sqrt.

## Root-cause note on `exp` (2026-06-13)

The tables above already include the two fixes described here. Investigating the
`exp` gap (intended as ROADMAP 17.9 "rectangular splitting")
**disproved that hypothesis**: the bignum kernel is fine, the cost was in higher
layers. Measured at 1000 digits (warm, single precision):

- `fpexp` kernel: **0.65ms** (≈ mpmath 0.44ms). Rectangular splitting would
  shave the kernel only and is **not** the fix. (An r-step argument reduction
  would cut the kernel to ~0.18ms, but that is <10% of the `.N()` time.)
- `BigDecimal.pow(base, non-int)` = 9.6ms — but that decomposes to
  `exp(x·ln base)`, i.e. `ln` (~2.7ms) + `exp` (~0.65ms) ≈ 3.4ms expected. The
  extra ~6ms was **`ln10` cache thrash**: `ln()` and `exp()` reduce at slightly
  different working precisions, and `ln10Fixed` keyed its single cache entry by
  *exact* bits, so the two evicted each other and recomputed `ln(10)` (a full
  Newton) on every call. **Fixed** (`ln10Fixed` now uses the same
  compute-high/downshift-low caching as `fppi`/`ln2`): `pow` 9.6 → **4.1ms**,
  `Exp(rational).N()` 6.95 → **~3.4–4.3ms**.
- `Exp(x)` canonicalizes to `Power(E, x)`, whose numeric path computed
  `E.pow(x) = exp(x·ln(E))` — recomputing `ln(e)≈1`. The first fix here (2026-06-13)
  special-cased the *symbolic* `E` base, but `.N()` numericizes the base to `e`
  *before* `pow()` runs, so the shortcut was bypassed and the redundant `ln`
  survived (it had merely been masked by the `ln10` fix dropping the cost).
  **✅ Fully fixed (2026-06-14, 17.13)**: the numericized base is the interned
  cached `E.N()`, so an O(1) reference check detects it and calls `exp(x)`
  directly (gated to bignum). **`Exp(x).N()` → 0.45ms** at 1000 digits, ≈ the
  bare `fpexp` kernel — the documented "generic dispatch overhead" hypothesis was
  wrong; profiling (`exp=1, ln=1, pow=1` per call) pinned it to the `ln`.

## Future work (→ ROADMAP item 17)

The three gaps this doc previously flagged all landed 2026-06-14/15:

1. ~~**Tune the AGM `ln` threshold / faster AGM**~~ — ✅ **17.10.** Lowered the
   AGM crossover 1250 → ~700 digits (enabled by 17.11's faster sqrt); `ln` now
   leads mpmath at 1000 digits. Residual: 500-digit `ln` still trails.
2. ~~**Division-free `isqrt_fast` for `sqrt`**~~ — ✅ **17.11.** A recursive
   giant-steps `isqrt` (not mpmath's reciprocal form); kernel ~2× faster,
   byte-identical. End-to-end `sqrt`/`asin` still trail mpmath (conversion/`atan`
   bound, not the kernel).
3. ~~**Trim CE `Power`/`.N()` dispatch overhead**~~ — ✅ **17.13** (the cause was
   a redundant `ln(e)`, not dispatch — see the root-cause note above).
4. **r-step / rectangular splitting in `fpexp`** — a real but small kernel win
   (~3× on the kernel, but the kernel is already <10% of `exp(.N())` time, so
   low user-facing impact). **Still open**, lowest priority.

## Reproduce

The tables use **one fresh process per `(impl, op, precision)` cell**. This
avoids the cross-precision thrash of the single-entry constant caches
(`ln10`/`fppi`/`ln2`), which inflates a multi-precision run done in one process
(`exp`/`ln` especially).

```bash
CUR=dist/compute-engine.min.esm.js   # run `npm run build production` first
OLD=benchmarks/.competitors/ce-0.59.0/dist/compute-engine.min.esm.js  # see benchmarks/README.md
source venv/bin/activate             # SymPy + mpmath
for op in ln exp sin cos tan atan asin sqrt; do for p in 100 500 1000; do
  printf '%s %s  ce=%s 059=%s sympy=%s mpmath=%s\n' "$op" "$p" \
    "$(node benchmarks/big-decimal/cell.mjs "$PWD/$CUR" $op $p)" \
    "$(node benchmarks/big-decimal/cell.mjs "$PWD/$OLD" $op $p)" \
    "$(python benchmarks/big-decimal/cell.py sympy $op $p)" \
    "$(python benchmarks/big-decimal/cell.py mpmath $op $p)"
done; done
```

`cell.mjs`/`cell.py` each print one number (ms/call). Tables are
`0.59.0`/`SymPy`/`mpmath` ÷ CE. Absolute ms are machine/load-dependent — the
**ratios** are the stable, reportable figures. (`bignum-compare.{mjs,py}` runs a
whole table in one process — quicker, but its `exp`/`ln` cells are inflated by
the cache thrash above; prefer `cell.*` for accurate numbers.)
