# Exact-mode auto-compilation of `Map` `evaluate()` drains

Status: **RATIFIED 2026-07-31 (R1–R5 as recommended, per "execute" directive)
— IMPLEMENTED same day** (`library/map-exact-proof.ts` +
`library/map-broadcast-shape.ts` + `mapAutoCompileRunner` tier split;
adversarially reviewed, one confirmed proof/compile value-skew hole fixed —
`stillEligible()` now gates every `attemptCompile` path).
`MIN_EXACT_COMPILE_COUNT = 64` (size floor) RATIFIED 2026-07-31 — R4 makes
the tier fire at default bignum-preferred precision, so without a floor every
tiny exact broadcast drain would pay a ~1 ms compile. Attempt accounting
RATIFIED as built 2026-07-31: the proof is an ELIGIBILITY GATE that runs
BEFORE any attempt is recorded — a proof decline bumps no counter and writes
no cache record (its memo re-proves on engine mutation), and
`_mapAutoCompileStats.attempts` keeps its historical meaning "the compiler
was invoked" (this is what preserved every pre-existing `attempts === 0`
pin). If v2 (runtime-guarded codegen, R5) ever wants near-miss telemetry,
add a separate `exactProofDeclines` counter — do not overload `attempts`.
Prior art: `docs/plans/2026-07-27-map-fusion-design.md` (§3 recorded this as
the deferred "next lever"), `docs/plans/2026-07-19-map-auto-compile-design.md`
(the `.N()` float tier this design extends).

## 1. Motivation

Exact `evaluate()` drains of broadcast-shaped lazy `Map`s never compile: the
auto-compile trigger (`markedMapLambda`, `library/map-auto-compile.ts`) fires
only on lambdas carrying the `Block(N(…))` numeric marker, so the exact route
runs at the interpreted floor at every precision. Measured on the item-103
witness (`1 + Mod(Range(0,899) + 29, 900)`, machine precision, warm, tsx):

| route                      | µs/element |
| -------------------------- | ---------- |
| `evaluate()` drain (exact) | ~12        |
| `.N()` drain (compiled)    | ~1.2       |
| raw JS loop                | ~0.015     |

The 9.9× gap is the prize; note the compiled tier is itself boxing-bound
(~80× above raw JS), which bounds what any variant of this design can reach.

**Why now, without a filed consumer item** (user ruling 2026-07-31,
overriding the earlier demand-gated disposition): Tycho is an authoring
platform — the relevant input space is any document an end user can write,
not the current corpus. Their action-firing pipeline drains collections
through exact `evaluate()` per tick (`graph-paper/actions/firing.ts`), with
`FIRING_MAX_ELEMENTS = 10 000` under a 50 ms budget; the interpreted floor
serves ~4 000 elements in that budget, so the platform's advertised limits
exceed what the engine can deliver. The `RotateLeft` import lowering rescued
exactly one idiom; a natively-authored rule one token away from it lands on
the uncompiled floor. Exact integer index vectors (the item-103 shape) cannot
use `.N()` at all.

## 2. Soundness foundation

Float64 arithmetic on integers is **exact** while every operand and
intermediate stays within ±2^53. So an integer-closed body — integer sources,
integer closed operands, and only integer-preserving operators — can run the
**existing** compiled code unchanged and still satisfy the exactness
contract, provided overflow is excluded. Two ways to exclude it:

- **Static bounds (v1)**: broadcast sources are typically literal `Range`s,
  whose element bounds are known at compile time. Interval-propagate bounds
  through the body (`Add`, `Multiply`, `Mod`, `Negate`, `Abs`, `Min`, `Max`,
  `Floor`, `Ceiling`, …); if every intermediate's bound is `< 2^53`, the
  existing emission is provably exact on integers — zero runtime guards, no
  new codegen.
- **Runtime guards (v2, deferred)**: `Number.isSafeInteger` checkpoints after
  overflow-capable ops for sources with unknown bounds. Needs new emission
  and its own review; not part of this design.

Verified groundwork (2026-07-31):

- Compiled `Mod` is Euclidean-parity-correct **after** the template
  parenthesization fix (see §5 prerequisites); regression pins straddle the
  boundary where the torn emission went wrong.
- `ce.number(n)` on a safe integer re-boxes as an exact integer literal.
- `Add`/`Multiply` type handlers already narrow integer operands to
  `integer`; `Mod` does not (co-fix, §5).

## 3. Rulings requested

### R1 — Trigger: the exact tier lives in `mapAutoCompileRunner`, gated on a proof, not a marker

Extend the existing runner: an **unmarked** broadcast-shaped lambda (no
`Block(N(…))`) is eligible when the §2 static proof succeeds. Same
per-instance `WeakMap` caches, same drain-start semantics, same stats, same
per-element decline-to-interpreter fallback, same mutation/dependency
validation. No new machinery, no second cache keying. **Recommended:
adopt.**

### R2 — Eligibility is derived, never listed

Integer-closedness comes from **type inference** (`(integer, integer) →
integer` per the operators' own type handlers), and bounds come from
structural source inspection (literal `Range` bounds, integer literals,
closed operands with statically bounded integer values). No operator name
list anywhere. A body the proof cannot bound — unknown-magnitude sources,
non-integer-preserving heads (`Divide`, `Power`), symbolic closed operands —
falls back to the interpreter silently, exactly like today's structural
no-compile. **Recommended: adopt.**

### R3 — Result contract: exact re-boxing, element-level parity

A compiled element result is re-boxed with `ce.number` (an exact integer
literal — bit-identical to the interpreter's result, not a float that prints
alike). Parity contract: for every element, the exact tier's value
`isSame` the interpreter's; failure/decline semantics are the runner's
existing ones (return `undefined` → that element evaluates through the
interpreter). `x.evaluate().N() ≡ x.N()` is unaffected (the `.N()` rewrap
path is untouched). **Recommended: adopt.**

### R4 — Precision independence (distinct from the ruled-out bignum tier)

The exact tier is sound at **any** engine precision, including
bignum-preferred: a proven-safe integer has the same value in float64 and
Decimal. The `bignumPreferred` bail-out in `mapAutoCompileRunner` therefore
does not apply to this tier (it remains for the float `.N()` tier). This
does not touch the 2026-07-27 "no bignum tier" ruling, which was about
Decimal *float* digits the compiled code cannot reproduce — integers have no
such digits. **Recommended: adopt.**

### R5 — Out of scope (dispositions to record)

Runtime-guarded codegen for unbounded integer sources (v2, the follow-up
lever); a `bigint` overflow escape (would need its own ruling — not assumed
adjacent to anything ruled before); compiling non-integer exact bodies
(rationals, radicals — no float representation is exact); composing levels on
raw numbers across a lowered spine (the map-fusion R4 follow-up, orthogonal).
**Recommended: adopt.**

## 4. Acceptance

- **Witness**: warm 900-element exact `evaluate()` drain of the item-103
  witness ≥4× vs same-harness interpreted baseline (12 → ~1.5–2.5 µs/elt
  expected; the exact-integer re-box is marginally dearer than the float
  re-box).
- **Parity sweep**: element-identical (`isSame`, not `isEqual`) vs the
  interpreter over the witness and variants with negative offsets crossing
  the Euclidean-mod boundary, symbolic closed operands (must decline), a
  mid-drain reassignment (must recompile/fallback per existing runner
  semantics), and a bignum-precision engine (must produce identical exact
  integers).
- **Zero snapshot churn** (iteration detail only, as with map fusion).
- The proof declines: `Divide` bodies, unknown-length sources, non-literal
  `Range` bounds, any bound ≥ 2^53 (pin a `Range` crafted to overflow under
  `Multiply`).

## 5. Prerequisites (independent fixes, ALL landed 2026-07-31)

1. **`Mod`/`Remainder` template parenthesization** (JS + WGSL + Python), with
   `test/compute-engine/compile-mod-precedence.test.ts`. The exact tier
   inherits this codegen; the bug would have been an exactness violation.
2. **Same-class hardening**: the GPU/Python/JS `Divide` chain and `Negate`
   function-handler templates now parenthesize spliced operands. (The
   reachable shapes route through the precedence-aware operator tables — the
   hardening removes the latent class from the fallback handlers.)
3. **`Mod` type-handler narrowing**: `Mod(finite_integer-typed expr,
   provably-nonzero modulus) → finite_integer` (rational/real rungs
   likewise), reading operand STATIC types (the value predicates are
   type-blind on compound operands) and requiring sgn-nonzero for the
   zero-pole modulus (a possibly-zero `finite_integer` symbol stays
   `number`). Pinned in `type-handler-audit.test.ts` ("TYPE AUDIT: Mod"),
   including the witness-body chain `1 + Mod(k + 29, 900) → finite_integer`
   that R2 keys on.

## 6. Amendment R6 — symbol-valued sources (RULED 2026-07-31, post-landing)

The v1 proof read bounds only from LITERAL `Range`/`List` sources, which
missed the motivating consumer's dominant shape: a firing rule `L → f(L)`
over a document variable produces a lazy `Map` whose source is the SYMBOL
`L` (probe-verified: zero compile attempts on `L + 1`,
`1 + Mod(L + 29, 900)` over a 200-integer list). Ruling: **extend
`proveSource` to resolve a symbol source through its current value** —
recurse into the value (literal `Range`, `List` of integer literals, nested
broadcast `Map`, or a further symbol, depth-guarded), scanning `List` values
for integer element bounds. The proof outcome is marked `dynamic`, so the
existing generation-revalidated memo and the `stillEligible()` gates carry
the reactivity; the compiled body never references the source symbol (it is
not in `symbolDeps`), so the proof memo is the ONLY guard — which is exactly
what it was built for. Per-tick economics: a fresh `Map` instance per firing
tick pays a cold compile (~1 ms), a clear win from ~10² elements (the size
floor covers the low end). This closes the firing-capacity gap for
document-list state evolution, not just literal-`Range` index vectors.
