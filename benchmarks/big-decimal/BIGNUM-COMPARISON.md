# BigDecimal — high-precision numeric evaluation vs SymPy / mpmath

_Internal engineering comparison (2026-06-13). Honest, both wins and gaps — this
is **not** the customer-facing positioning doc (`benchmarks/REPORT-marketing.md`),
which only shows differentiating cases. The point here is to locate where the
arbitrary-precision core stands against the reference implementation and to
confirm the remaining work (→ [ROADMAP](../../ROADMAP.md) item 17)._

## What is measured

Per-call wall time to **numerically evaluate** a transcendental at a fixed
working precision, for four implementations:

- **CE (current)** — `ce.box([op, …]).N()` at `ce.precision = p`, current build.
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

_Tables refreshed 2026-06-13 after the `ln10`/`Exp`-direct fixes (below), via the
fresh-process-per-cell method (one `(impl, op, prec)` per process, no
cross-precision cache thrash). Both CE builds and 0.59.0 are minified bundles._

## Per-call time at 1000 digits (ms, lower is faster)

| Function | CE (current) | CE 0.59.0 | SymPy | mpmath |
| --- | ---: | ---: | ---: | ---: |
| `ln`   | 1.90 | 20.9  | 1.17 | 1.01 |
| `exp`  | 2.50 | 64.9  | 0.47 | 0.44 |
| `sin`  | 0.38 |  1.3  | 0.54 | 0.45 |
| `cos`  | 0.39 |  1.3  | 0.55 | 0.49 |
| `tan`  | 0.39 |  1.3  | 0.57 | 0.48 |
| `atan` | 0.40 |  1.7  | 0.75 | 0.61 |
| `asin` | 1.41 |  6.8  | 0.95 | 0.81 |
| `sqrt` | 0.13 |  0.1  | 0.15 | 0.05 |

## CE speedup vs SymPy (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 4.7× | 0.6× | 0.6× |
| `exp`  | 0.6× | 0.2× | 0.2× |
| `sin`  | 8.8× | 2.3× | 1.4× |
| `cos`  | 8.8× | 2.4× | 1.4× |
| `tan`  | 8.9× | 2.2× | 1.5× |
| `atan` | 25.4× | 3.8× | 1.9× |
| `asin` | 9.4× | 1.4× | 0.7× |
| `sqrt` | 12.9× | 2.9× | 1.1× |

## CE speedup vs mpmath, the raw engine (`>1` = CE faster)

| Function | 100 digits | 500 digits | 1000 digits |
| --- | ---: | ---: | ---: |
| `ln`   | 0.2× | 0.2× | 0.5× |
| `exp`  | 0.2× | 0.2× | 0.2× |
| `sin`  | 1.0× | 1.2× | 1.2× |
| `cos`  | 1.0× | 1.2× | 1.3× |
| `tan`  | 1.2× | 1.2× | 1.2× |
| `atan` | 1.2× | 1.7× | 1.5× |
| `asin` | 1.1× | 0.8× | 0.6× |
| `sqrt` | 0.6× | 0.5× | 0.4× |

**Capability:** at 3000 digits, 0.59.0 returns `NaN` for `sin`/`cos`/`tan` and
`π` (the hardcoded π table ran out); CE current and mpmath both compute the
correct value. (SymPy/mpmath never had that ceiling.)

## Reading the results

- **At low precision (≤100 digits) CE wins broadly vs SymPy** (5–28×): SymPy's
  per-call Python/sympify overhead dominates there. Against raw mpmath the gap
  closes — that overhead is SymPy's, not the bignum engine's.
- **`sin`/`cos`/`tan`/`atan`: CE leads or ties** even against raw mpmath at every
  precision (the base-2 kernel + √p argument-reduction pays off). `atan` is the
  strongest (1.2–1.7× vs mpmath).
- **`exp` still trails at the `.N()` level (~5× mpmath, 0.2×) — but it is NOT
  the kernel.** `fpexp` is ~0.65ms (≈ mpmath 0.44ms) and `NumericValue.exp`
  ~0.69ms; the remaining ~1.8ms of `Exp(x).N()` (2.50ms) is CE `Power`/`.N()`
  dispatch overhead (→ 17.13), not the bignum math. It is already ~26× faster
  than 0.59.0 after the two fixes below.
- **`ln` trails slightly at 500–1000 digits** (~0.6× of mpmath): CE's AGM only
  engages above ~1250 digits, so 500–1000-digit `ln` still uses giant_steps
  Newton while mpmath is already on AGM.
- **`sqrt` trails mpmath** (~0.4–0.6×): CE kept its Heron `fpsqrt` (the base-2
  port left the division-per-iteration); mpmath uses a division-free `1/√x`
  Newton (`isqrt_fast`) with precision doubling. `asin` inherits this (it is
  `atan(x/√(1−x²))`), explaining its high-precision dip.

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
  `E.pow(x) = exp(x·ln(E))` — recomputing `ln(e)≈1`. **✅ Fixed** in
  `boxed-expression/arithmetic-power.ts`: the `Power(E, x)` numeric path now
  calls `exp(x)` directly for real exponents (complex keeps the `pow` path).
  Combined with the `ln10` fix, **`Exp(rational).N()` 6.95 → 2.74ms** at 1000
  digits. The residual ~2.7ms is the CE `Power`-dispatch + argument-evaluation
  machinery (general `.N()` overhead, shared with other operators), not the
  bignum kernel (`fpexp` ≈ 0.65ms).

## Future work (revised by the root-cause investigation → ROADMAP item 17)

1. **Tune the AGM `ln` threshold / faster AGM** — close the 500–1000-digit `ln`
   gap (mpmath benefits from AGM earlier than CE's 1250-digit crossover).
2. **Division-free `isqrt_fast` for `sqrt`** — revisit the "leave `fpsqrt`
   as-is" decision; the comparison shows mpmath's reciprocal-sqrt Newton is
   ~2× faster, and it would lift `asin` too.
3. **r-step / rectangular splitting in `fpexp`** — a real but small kernel win
   (~3× on the kernel, but the kernel is already <10% of `exp(.N())` time, so
   low user-facing impact). Lowest priority.
4. **Trim CE `Power`/`.N()` dispatch overhead** — the residual ~2ms on
   `Exp(...).N()` is generic boxed-evaluation machinery, not the bignum core.

## Reproduce

The tables use **one fresh process per `(impl, op, precision)` cell**. This
avoids the cross-precision thrash of the single-entry constant caches
(`ln10`/`fppi`/`ln2`), which inflates a multi-precision run done in one process
(`exp`/`ln` especially).

```bash
CUR=dist/compute-engine.min.esm.js   # run `npm run build` first
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
