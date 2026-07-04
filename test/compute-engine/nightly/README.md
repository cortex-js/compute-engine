# Nightly regression suites

These are the review harnesses that found the Wave 1–4 findings, adopted as
**opt-in** jest suites so they live on as regression sentinels. They are the
broad, slow grids that are wasteful to run on every commit but valuable to run
nightly.

## How to run

Every suite is gated on the `CE_NIGHTLY` environment variable:

```ts
const NIGHTLY = process.env.CE_NIGHTLY === '1';
const describeNightly = NIGHTLY ? describe : describe.skip;
```

- **Default sweep** (no env var): all suites report as *skipped* in well under a
  second — zero cost on the normal test run, no jest-config changes.
- **Nightly run**:

  ```bash
  npm run test:nightly
  # ⇔ CE_NIGHTLY=1 jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/nightly/
  ```

  Run a single suite by appending its path, e.g.

  ```bash
  CE_NIGHTLY=1 npx jest --config ./config/jest.config.cjs --reporters default -- test/compute-engine/nightly/mpmath-kernels.test.ts
  ```

**Total nightly runtime ≈ 6 s** (target < 10 min). All suites are green except a
handful of `test.skip` / allowlisted cells, each carrying a comment naming the
documented finding it tracks (see the per-suite notes below and the
`docs/reviews/2026-07-archive/*-findings.md` files).

## Suites

| File | Covers | Cases | ~time |
|---|---|---|---|
| `exactness-grid.test.ts` | operator × exact/inexact/special argument classes: exact-real args stay exact/symbolic (not FLOAT), finite N/evaluate consistency, and D2 float-arg numericization | ~105 tests / ~1.8 k cells | ~1.5 s |
| `type-soundness-grid.test.ts` | full `evaluate().type ⊑ static .type` grid (incl. Gamma/Factorial/Floor/Ceil/Round/Sign of complex/non-integer, which the committed `type-soundness.test.ts` excludes) | ~50 tests / ~5.4 k checks | ~1 s |
| `mpmath-kernels.test.ts` | special-function values vs **static** mpmath references (≤4 ulp machine for the Wave-3 kernels; ≥13 sig-digit relative for other machine kernels; ≤2 ulp@precision for bignum) | 169 cases | ~1 s |
| `roundtrip-battery.test.ts` | `ce.expr(x.json).isSame(x)` for numeric (radical literals, complex bignums, big integers, repetends) and structural forms, plus high-precision `.N()` round-trips | 43 tests | ~0.5 s |
| `comparison-matrix.test.ts` | `isSame` is an equivalence relation; `isSame`/`is`/`isEqual` symmetry; `order()` is a reflexive, antisymmetric, transitive, **total** order (incl. NaN rank) | 9 tests | ~0.7 s |
| `assume-verify-matrix.test.ts` | the assume→verify identity `assume(P) ∈ {ok,tautology} ⇒ verify(P) = true` over a broad predicate battery (extends the 11-case core in `verify.test.ts`) | 27 tests | ~0.8 s |
| `js-parity-fuzz.test.ts` | compiled-JS vs interpreter `.N()` over ~140 expressions × their point sets (~2.4 k points); compared where the interpreter is finite-real (the real target's domain) | 164 tests | ~1.1 s |

The **Python-target** parity is a separate, venv-gated suite,
`test/compute-engine/compile-python-parity.test.ts` (not nightly-gated — it skips
when the venv is absent). This nightly JS fuzz needs no external toolchain.

## mpmath reference fixture

`mpmath-kernels.test.ts` reads a **static** JSON fixture,
`fixtures/kernel-refs.json`, so the nightly run never invokes Python. Regenerate
it (only when adding/changing kernel cases) with the repo venv:

```bash
./venv/bin/python3 test/compute-engine/nightly/fixtures/gen_kernel_refs.py
```

Each fixture case is `{ id, head, args, kind, precision?, ref }`; `ref` is 55
significant mpmath digits computed at `mp.dps = 60`. For `kind: "machine"` the
reference is evaluated at `mpf(double)` (so it lands on the same double the
interpreter sees); for `kind: "bignum"` every non-integer argument is encoded
`{ "num": "<decimal>" }` and the reference uses `mpf("<decimal>")`.

## Known allowlisted / skipped cells

Each allowlist entry in the suites names the finding it tracks. Notably:

- **exactness** — `Factorial(non-integer)` → float (EX-07e); `Mod`/`Remainder`
  of exact radicals/rationals → float (EX-07d); ±∞ into integer-domain
  combinatorial/number-theory functions throws an uncaught `RangeError`
  (**EX-15**, still open — see the final report).
- **type-soundness** — `Round(i)`/`Sign(i)`/… result types; the non-finite
  finiteness-over-claim tail (Hypot/Real/LCM/Gamma-pole/…) of the SYM P0-12/P0-15
  class is recorded rather than asserted (only *finite*-result soundness is
  enforced).
- **mpmath-kernels** — `zeta(−0.5)` ~4.11 ulp (known open); bignum `Arccos` near
  1 loses ~8 digits to endpoint cancellation (**new finding**, `test.skip`).
- **js-parity** — `pow-2-3` (rational power of a negative base, real branch,
  CO-P0-2 residual); `sum-negate-i` (negative-index `Negate` summand emits
  invalid JS, P2-1).
