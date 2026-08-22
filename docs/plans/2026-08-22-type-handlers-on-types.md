# Design: type handlers as functions of types

**Status:** second draft, 2026-08-22. §2 is measured. §3 (Step 0) is
**executed** and its baseline recorded in §3.4. §4.3 was found to be
mis-diagnosed on execution and is rewritten; what it actually exposed is a
ruling item, §6.5. §5 is an implementation draft; §6 lists what needs a
ruling. Nothing here has been ruled except where a ruling is quoted.

## 1. What this is

An operator definition's `type` handler decides the static type of an
application. Its signature takes the operands as *expressions*:

```ts
type?: (ops: ReadonlyArray<Expression>, options: { engine; operandTypes? })
  => Type | TypeString | BoxedType | undefined;
```

That shape predates the type system — the handlers were written when the
only way to learn anything about an operand was to look at it. A survey of
the 146 handlers in `library/*.ts` finds that 116 already read nothing but
`ops[i].type`; the remaining ~30 reach past the type for facts about the
operand's *value*: finiteness, sign, integrality, literal content, and — in a
few — the operand's structure.

This document asks whether the handler signature can become a function of
**types** and what it takes. The motivation is not tidiness. Item 219
(ROADMAP "Reading a nested lazy view's type was exponential in depth") was
caused by a type handler that needed to know what type an application
*would* have given typed operands, and the only way to ask that question
today is to declare a symbol of that type in a scope — a write, which
invalidated the caches the derivation was itself filling. A handler that
takes types needs no such question asked; the probe becomes
`def.type([T0, T1])`. The 219 fix (a `scratch` exemption from cache
invalidation for declarations into a pushed-and-popped scope) stays as a
guard, but it should have no live caller.

Two further motivations surfaced while measuring, and both are recorded here
because they change what "works" means:

- Most of what the value-dependent handlers buy is not correctness of results
  but **passage through the strict argument gate at canonicalization** (§2.4).
  Whether that gate should be strict is a separate, product-level question
  that this design depends on.
- The suite pinned types by **exact string** 1451 times against 275 uses of
  `.matches()`. Any change that makes a type sounder-but-different fails
  hundreds of tests that were not guarding anything in particular (§2.5).
  Step 0 (§3) addressed that for the affected tests and set the rule for new
  ones; it was a prerequisite for every later step being measurable.

## 2. What was measured

All numbers from the worktree experiment of 2026-08-22: operands proxied at
the ONE site that invokes a handler (`BoxedFunction` type derivation,
`boxed-function.ts`, `def.type(expr.ops, …)`), full suite run with `--ci` so
no snapshot is written, box lock held. The proxy is gated on
`CE_TYPE_VALUE_BLIND` / `CE_TYPE_LITERAL` and is not for landing. The shim
diff is preserved as `scratchpad/shim.patch` of the session that ran §3
(it applies cleanly to `boxed-function.ts` as of 2c2c772e); reapply it to
re-measure any later step.

### 2.1 What handlers read

| reads | handlers (of 146) |
| --- | --- |
| nothing but `.type` | 116 |
| `isFinite` / `isNaN` / `isReal` | ~45 reads across ~20 handlers |
| sign and integrality (`isNegative`, `isNonNegative`, `isInteger`, `isRational`, `sgn`) | ~15 |
| structure (`.ops`, `.op1`, `.nops`, `.operator`, `isConstant`, `isNumber(x)`) | ~8 |
| literal content (`.string`, `.value`, `isSame`, `isLess`, `isGreater`, `.re`) | ~6 |

(Regex survey; counts approximate, shape unambiguous. A second survey on
2026-08-22, bounding each `type:` body by brace matching, confirmed the
shape and found that every `.im`/`.re` read in a type handler is on a
literal after an `isNumber()` guard — `PolyLog`, `special-functions.ts` —
i.e. a §4.1 case. The other `.im` reads in `arithmetic.ts` are in `sgn` and
`evaluate` handlers, which are out of scope.)

### 2.2 The four runs

Each run corrects the previous model. The corrections are findings, not
noise; they are what a real implementation has to get right.

| model | failures | what it showed |
| --- | --- | --- |
| every `isX` getter and value read withheld | 345 | **over-blinded.** `isReal` / `isInteger` / `isFinite` on a *symbol* answer from its declared type, not a value. The getters are one spelling over two channels, and withholding them cut the type channel too. |
| type-backed predicates pass through; literal types on handler input | 244 | **literal types leak.** A handler result carrying `tuple<1, 2>`, `((z: 0) -> 0) & …` or `() scope -> 1` gets *stored* — as a tuple type, an overload set, an inferred signature — and becomes an over-specific contract. |
| + every `{kind:'value'}` in a handler result widened to its primitive | 423 | the naive walker rebuilt `reference` / `object` / `record` nodes (identity lost: protocol property reads came back `unknown`) and recursed a recursive record type (stack overflow). |
| + widening descends **structural** nodes only (list, tuple, union, signature, …), cycle-guarded | **75** | the residue. 23 suites, 0 crashes, 0 snapshot diffs. |

### 2.3 The residue, by cause

Of the 75 (recounted from the run log while executing §3): **53** assert a
type *string*, 9 a boolean predicate, 13 a behavior. The first draft of this
document said "10" string assertions received a more refined type; the log
says **22** (21 strictly more refined, 1 equal — a union with a duplicated
member, a shim artifact), plus one more the log could not show: a second
assertion in the same `tycho-item-188` test, masked because jest stops a
test at its first failure (`broadcastable<finite_number>` for
`broadcastable<number>`). But "strictly more refined" is not "sound", and
the dual review of the §3 conversions caught the difference: **8 of the 23**
(4 tests — three in `broadcastable-typing`, one in `tycho-item-188`) type
an operand whose cells come from an `unknown`-returning function, and
`unknown` admits NaN and ±∞. The engine deliberately types those cells
`number` (`Add(u, 1)` with `u: unknown` → `number`,
`Add(h(x), 1)` with `h: (number) -> unknown` → `broadcastable<number>`,
measured 2026-08-22); the shim's `finite_number` there is an
**over-claim**. Those 8 stayed exact. The remaining 15 are the §3
conversions. The other 31 string assertions received a *less* refined
type, or — in 2 cases — a more refined but unsound one. By cause:

- **Sign facts from a non-type channel** (~14): the inverse-trig domain
  tests (`inverse-trig-domain-type`, 11), `Ln` of a provably-positive real,
  `solve-domain`, and `±∞ · provably non-zero real`. All read `x.isPositive`
  / `x.sgn` on a *symbol*, and `BoxedSymbol.sgn` answers from the held
  value first and `getSignFromAssumptions` second (`boxed-symbol.ts:949`).
  Neither is the declared type. See §6.1 and §6.5.
- **Rational literal types do not exist** (11: `(1,2)/3` stays
  `finite_rational`, `(1..4)/2`, `(-2)^(p/q)` exponent provenance, `Abs` /
  `Mod` / `Pochhammer` literal tiers). `1/3` is lexer-rejected as a type, so
  the experiment spelled the literal as a float and lost exactness.
  Prerequisite, §4.2.
- **Closed constants: their sign and their pole-ness** (5 Fungrim rules +
  `π·i`, `e^i`, and the 2 unsound rows). `π·i` typed `finite_complex`
  instead of `imaginary` because `Multiply` could not prove `π ≠ 0`; `e^i`
  typed `finite_number` because `Power` could not see `e > 0`. Both facts
  come from the constant's held value; `finite_real` does not carry them.
  And `Tan(π/2)` typed `finite_real` — a value that is `~oo` — because
  `poleReciprocalType` (`library/type-handlers.ts:107`) tells a closed
  constant (may sit on a pole → `number`) from a generic symbol (off the
  pole set of measure zero → `finite_real`) by `x.isConstant`, a structural
  fact the shim withheld. §6.5. (The first draft filed this group under
  "imaginary-ness not type-derived"; that was wrong — see §4.3.)
- **`unknown` operands narrowed to `finite_number`** (4 tests, 8
  assertions — the group above). The engine widens an `unknown` operand's
  contribution to `number`; under the shim the same applications typed
  `finite_number` cells. Which getter carries that widening today is NOT
  yet traced (the proxy leaves `isFinite` `undefined` for an `unknown`-typed
  operand, as the engine does, so the difference is elsewhere); tracing it
  is a precondition of §5.2 step 2, because whatever carries it is a
  type-channel fact the new signature must preserve.
- **A symbol bound to a function value** (2; `derivatives`). `f'(0.25)`'s
  type reads `f`'s *value*. The only genuinely dynamic dependence found.
- Shim artifacts: a union with two literals widened to one primitive without
  re-reduction (`list<finite_integer | finite_integer | string>`).

### 2.4 What the value refinements actually buy

The first run's behavior failures were not wrong answers. They were
**refusals**:

| what broke | why |
| --- | --- |
| `FactorInteger(3 + 10²¹)` → `incompatible-type: integer, finite_number` | `Power(10, 21)` could not see `21` is a non-negative integer literal, so `10²¹` typed `finite_number`, so an `(integer)` parameter refused it |
| `Mod(2^(3^20), 100)` stays symbolic instead of `52` | same |
| 25 simplify rules fail to load (1435 → 1410) | their patterns no longer type-check |
| GLSL "real-only helper cannot take a complex argument" stops failing closed | provable-complex detection gone — the one safety-direction regression |

The engine draws the strict/lenient line in two places, five lines apart in
`boxed-expression/validate.ts`:

| operators | admission at canonicalization | where a bad operand is rejected |
| --- | --- | --- |
| arithmetic, via `checkNumericArgs` | `op.type.couldMatch('number')` — **overlap** (`validate.ts:459`) | evaluation (`nonNumericOperandError`) |
| every declared signature — `FactorInteger: (integer)`, all 45 number-theory ops, the rest | `!op.type.matches(param)` → `incompatible-type` — **strict subtype** (`validate.ts:464`) | canonicalization |

Arithmetic was deliberately made permissive (ROADMAP, "permissive boxing +
eval guard", 2026-08-19). The signature path was not. So a handler that
returns `finite_number` where it could have said `finite_integer` costs
nothing *unless* the result meets a strict gate — which is what most of the
20% is compensating for.

### 2.5 Exact-string type assertions

`grep` over `test/` (before §3): **1451** assertions of the form
`expect(String(x.type)).toBe('…')` / `.type.toString()).toBe(` against
**275** `.type.matches(`. An exact pin is two-sided: it catches a type that
became too *narrow* (a soundness bug — claiming `finite_integer` for a value
that can be `3/2`, the `[6,2]/4` defect the `Divide` handler's comment
records) as well as one that became too wide. `.matches(T)` catches only the
second. So the exact form is not simply wrong — but most of the 1451 are not
guarding a tier; they pin whatever precision the engine happened to have when
the test was written, and every sound refinement anywhere makes them fail.

## 3. Step 0 — make type assertions say what they guard (EXECUTED)

Prerequisite for everything after it, because without it no later step can
be measured: a change that makes 22 types sounder-and-different reads as 22
failures, indistinguishable from 22 regressions.

### 3.1 The idiom

Three spellings, each naming its intent:

- **At least this precise** — the common case:
  `expect(t.matches('real')).toBe(true)`.
- **Exactly this tier** — keep the exact string, and say so in the test or
  block name ("branch decisions that must not move", as
  `power-negative-base-branch.test.ts` already does).
- **Sound, not over-narrow** — a bracket with both bounds:
  `expectTypeBetween(expr, { atMost: 'rational', above: 'finite_integer' })`
  (`test/utils.ts`): the type must match `atMost` and must NOT match
  `above`. On failure it throws with the offending type string, which
  `expect(bool).toBe(true)` does not show. The helper is also the right
  spelling of the first case (`{ atMost }` alone), because it rejects the
  empty type wherever it appears: `never <: T` for every `T`, so a bare
  `.matches()` accepts a derivation that collapsed to `never` or
  `vector<never^3>`.

**Three traps the conversion hit, recorded so the next one does not:**

- `number <: broadcastable<number>` is **true** (a `broadcastable<T>` is
  "a `T` or a collection of `T`"), and `vector<2> <:
  broadcastable<vector<2>>` likewise. A test whose point is "broadcastable,
  not folded to a scalar" loses that guard under a bare `.matches()`.
- A bracket with `above: 'number'` repairs the fold but still admits
  `broadcastable<finite_integer>` — and for cells that come from an
  `unknown`-returning operand, `number` IS the contract (§2.3). Those
  tests are the "exactly this tier" spelling, with the reason stated; a
  more refined type there is an over-claim, not a refinement.
- Function parameters are **contravariant**: `(unknown) -> R'` is a
  subtype of `(P) -> R` whenever `R' <: R`, so `.matches()` on a whole
  signature cannot tell a refined parameter list from the unrefined
  placeholder. Pin the parameter list exactly and bracket only the result
  (`placeholder-signature-refinement.test.ts`).

### 3.2 What NOT to do

Do not sweep-convert the remaining ~1429 to `.matches()`. A mechanical
rewrite silently discards every over-narrowing guard in the suite, and the
assertion alone does not say which ones those are.

### 3.3 What was done (2026-08-22)

1. Examined the **23** assertions in 9 files that the §2.2 final run showed
   (or, for one masked by an earlier assertion in its test, the §3.4 re-run
   showed) receiving a strictly more refined type (`broadcast-shape-lift`,
   `broadcastable-typing`, `element-max-min-clamp`, `list-broadcast-typing`,
   `list-shape-typing`, `placeholder-signature-refinement`,
   `tycho-item-165-…`, `tycho-item-188-…`, `tycho-items-212-213-…`). Every
   received type was first checked to be a strict subtype of its expected
   one (`ce.type(received).matches(expected)` true, the reverse false) —
   necessary, and, as the dual review then showed, not sufficient. Outcome:
   **15 converted** to `expectTypeBetween`, each with a one-sentence intent
   comment and, where a rational cell claim would be unsound (`Sin`, `Sqrt`
   over literal integers), an `above` bound naming it; **8 kept exact**
   (the `unknown`-input cases, §2.3) with the reason stated in place; and
   the two signature pins hybridized (parameter list exact, result
   bracketed). The union-duplicate artifact (`compile-predicate-errors`)
   was left exact: the fix belongs in the widener (`reduceType` after
   widening, §4.1), not in the test.
2. Added "Type assertions in tests" to `docs/COMMENTING-GUIDELINES.md` (the
   three spellings, the `never` caveat, the two contracts that look like
   accidental precision, the review question) and a line to its review
   checklist. The dual review of this step (Claude + Codex, 2026-08-22)
   produced the contravariance finding, the `finite_integer`-through-the-
   bracket finding, and the `never` finding; all three are applied.
3. Re-ran the §2.2 final configuration against the converted suite (§3.4).

### 3.4 Baseline

The §2.2 final shim re-executed on 2c2c772e plus the §3.3 conversions,
`--ci`, box lock held, load 3.1 at acquire:

| run | failures | suites |
| --- | --- | --- |
| §2.2 final, before §3 (a5569576) | 75 | 23 |
| same shim, after the 22 conversions (2c2c772e) | 56 | 17 |
| of which load artifacts (`integration-rules`, 2 rows, suite took 411 s at load 25–34; both PASS on a re-run of that file alone under the shim at load 6) | −2 | |
| of which the masked `tycho-item-188` pin (then kept exact on review, so it stays) | 0 | |
| the 3 `broadcastable-typing` tests whose exact pins the dual review restored (§2.3, `unknown` operands) — re-measured on those two files under the shim: exactly the 4 expected failures | +3 | |
| **baseline** | **57** | **17** |

The 57 fail for reasons §3 does not address, and a later step is measured
by whether this number shrinks, and by which rows leave it. Run logs:
`baseline.log`, `rerun-shim.log` and `rerun-shim2.log` in the §3 session's
scratchpad.

Its composition is the §2.3 list minus the 15 conversions: sign-channel (~14), rational
literals (11), closed constants (~9), symbol-with-function-value (2), the
union-duplicate artifact (1), plus the behavior and predicate rows that
depend on those same facts (the Fungrim loader counts, the D10 parameter
gate, `FactorInteger`/`Mod` refusals).

## 4. Prerequisites

Each of these is independent of the handler signature and worth landing on
its own.

### 4.1 A number literal carries its literal type

`ce.type('2')` → `2`, `<: finite_integer`, `<: real`. The literal type exists
and sits correctly in the lattice. But `ce.box(2).type` → `finite_integer`:
a boxed literal does not carry one.

Giving it one is what lets a handler read, from the *type*, every fact it
reads today from the literal's *value*: `Power(n, 2)` sees a non-negative
integer exponent, `Divide(x, 2)` sees a nonzero divisor, `At(xs, 2)` sees
which element, `toInteger(ops[1])` reads the value as `Number(litType)`,
`PolyLog(s, 1)` sees `s ≤ 1`.

Two boundaries, both measured necessary:

- **Input side:** literal types are visible to handlers.
- **Output side:** a handler *result* containing a literal type is widened to
  the narrowest classic primitive before it is stored. Otherwise
  `Tuple(1, 2)` types `tuple<1, 2>`, a multi-clause `fib` declares
  `((z: 0) -> 0) & ((o: 1) -> 1) & …`, and a constant function types
  `() -> 1`. Whether some of those are *desirable* (the `fib` clause domain
  genuinely is `0`) is an open question, §6.2 — but the default must be to
  widen, or literal types become contracts nobody wrote.
- The widening walks **structural** nodes only — `list`, `set`,
  `collection`, `indexed_collection`, `tuple`, `union`, `intersection`,
  `signature`, `map`, `dictionary` — and returns `reference`, `object`,
  `record` and `variable` nodes by identity. Some carry resolver state
  compared by `===`; a recursive record type is a cycle. After widening, a
  union must be re-reduced (`reduceType`), or two literals widened to one
  primitive leave a duplicated member (the `compile-predicate-errors` row).

Where the boundary lives is a design choice: at the handler call site (as
in the experiment), or in `BoxedNumber.type` itself with the call site
un-widening. The call site is the smaller blast radius — `BoxedNumber.type`
is read everywhere.

### 4.2 Rational literal types

`1/3` is not a type spelling today (the type lexer rejects `/`). Without it
an exact rational literal is a float at the type level, and `(1,2)/3`
cannot stay `finite_rational`, nor can `(-2)^(3/5)`'s real-ness be decided
from the exponent's parity. Needs a grammar decision (`1/3`? `3:5`?
`rational(1,3)`?) and a `{kind:'value', value: {num, den}}` or similar
node; subtype rules follow from the numeric lattice. Eleven residue rows.

### 4.3 Imaginary-ness was never the problem (CORRECTED)

The first draft proposed converting "value-based `x.im !== 0` idioms" in
`arithmetic.ts` to `x.type.matches('imaginary')` as an independently
landable first instance of the migration. On execution (2026-08-22) that
turned out to be mis-diagnosed, and no code change was made:

- The cited sites (`arithmetic.ts:1053`, `:1089`, `:1216`, `:1288`) are in
  `evaluate` handlers, each guarded by `isNumber(x)` — they compute with a
  literal's value, which is what an evaluate handler is for.
- The `Multiply`, `Divide` and `Power` **type** handlers already test
  imaginary-ness by type (`x.type.matches('imaginary')`,
  `arithmetic.ts:877`, `:2160`, `:2483`). No type handler reads `.im` on a
  non-literal.
- Re-running the shim on the D10 constants directly: `i/2`, `i^3`, `ln(−1)`
  type correctly under it. Only `π·i` (`finite_complex` for `imaginary`)
  and `e^i` (`finite_number` for `finite_complex`) lose, and the fact they
  lose is `Pi.sgn` / `e.isPositive` — the **sign** of a real constant, read
  from its held value (`BoxedSymbol.sgn`, `boxed-symbol.ts:949`). The type
  `finite_real` does not say "positive".

So the closed-constant residue is a *sign-channel* question, the same one
assumptions raise (§6.1), plus a *closedness* question the pole handlers
raise (§6.5). There is nothing in this group that a one-line idiom swap
lands.

## 5. The signature change — implementation draft

### 5.1 Target shape

```ts
type?: (
  argTypes: ReadonlyArray<Type>,
  context: {
    engine: ComputeEngine;
    /** The operands, for the handlers that need STRUCTURE (a mapping
     *  literal's parameters and body, a tuple's arity, whether an operand
     *  is a closed constant). Reading a VALUE fact through this channel is
     *  what the migration removes; a handler that does so is not
     *  types-only and must say why (§5.2 step 4). */
    ops: ReadonlyArray<Expression>;
    /** Sign facts that are not in the type: the engine's answer for
     *  `ops[i].sgn` — held value, then assumptions. Present only if §6.1
     *  rules for option (b); absent under (a) or (c). */
    sign?: (i: number) => Sign | undefined;
  }
) => Type | TypeString | BoxedType | undefined;
```

`argTypes[i]` is `ops[i].type` with literal types visible (§4.1), and with
the existing `operandTypes` override (the `missing`-stripped type for a
`propagate`/`handle` operator's absent operand, `boxed-function.ts`
"strip-before-validate") already folded in — the call site computes that
array today and hands it alongside `ops`; under the new shape it *is* the
argument.

### 5.2 Migration, in the order that keeps the suite green

0. **Land §3 (done) and §4.1.** Nothing about handlers changes; the suite
   gains intent and literals gain types. §4.1's widener is the experiment's
   `widenValueTypes` with `reduceType` applied to any union it rebuilt.

1. **Add the new shape beside the old one.** `TypeHandler = OldShape |
   NewShape`, distinguished by a definition flag (`typeHandlerKind:
   'types'`) rather than by arity sniffing. The call site in
   `boxed-function.ts` builds `argTypes` once and dispatches. Default stays
   the old shape so nothing moves until a handler opts in.

2. **Flip the 116 type-only handlers mechanically.** They read
   `ops[i].type` and nothing else; the rewrite is `ops[i].type.type` →
   `argTypes[i]` and `ops[i].type` (a `BoxedType`) → `ce.type(argTypes[i])`
   or, better, the `Type`-level helpers (`isSubtype`, `widen`, …) the
   handler was unwrapping to anyway. A handler has *proven* it is type-only
   when the experiment's proxy — rerun per handler, not per suite — produces
   byte-identical results: the `CE_TYPE_VALUE_BLIND` shim is the
   instrument, and the §3.4 baseline must not grow by one.

3. **The ~25 value-fact handlers, one at a time.** For each, the fact comes
   from one of four sources, and the source decides the rewrite:
   - the literal's value → the literal type (§4.1; most of them —
     `Power`'s exponent, `Divide`'s divisor, `At`'s index, `PolyLog`'s
     `s ≤ 1`, `Mod`'s modulus);
   - the literal's exactness (`isExact`, rational vs float) → §4.2;
   - a sign fact on a non-literal (constant's value or an assumption) →
     §6.1's ruling, via `context.sign` or a refined type;
   - a bound symbol's function value (`Derivative`) → §6.3's ruling.
   Each is its own small diff, because these are where the engine's
   deliberately surprising typing lives, and a batch rewrite that changed
   which facts they see would pass the suite while shifting snapshot types
   — the green-suite-wrong-answer shape of the `~oo` retyping incident.

4. **The structural handlers** (`Map`/`Zip` element derivation reading a
   mapping literal's parameters and body; `Tuple` arity; `Block`'s last
   statement; `poleReciprocalType`'s closed-constant test — §6.5) keep
   reading `context.ops`, and each says in a comment which structural fact
   it reads and why the type does not carry it. The count is ~8, not ~5
   (the closedness reads were filed under "value" in the first survey).

5. **Retire the `scratch` exemption's caller.**
   `probeBareMappingElementType` (`library/collections.ts`) today pushes a
   scope, registers it as scratch, declares one stand-in symbol per
   referenced parameter at its source's element type, boxes the body's
   operator applied to the stand-ins, and reads `.type`. Under the new
   shape it becomes `def.type(elementTypes, { engine, ops: standInOps })` —
   no scope, no declaration, no invalidation concern; the stand-in
   expressions are still needed only for a structural handler, and a
   mapping body whose operator is structural can keep declining. The
   `BARE_MAPPING_ELEMENT_TYPE` memo keyed on
   `(operator, parameter positions, element types)` stays — it is what
   makes repeated reads cheap — but its `cachedValue` generation duty
   shrinks to object-dependency tracking. `PIPE_IMPLICIT_MAP_TYPE`
   (`library/core.ts:493`) is the next candidate.

6. **Remove the old shape** once no `library/*.ts` handler uses it; user
   definitions (`ce.declare` with a `type` function) get one release of
   both shapes and a deprecation note in `MIGRATIONS.md`.

### 5.3 What each step is measured by

- Step 2: the suite is byte-identical in outcome (after §3, "identical"
  means identical, not "green"), and the per-handler shim run shows no
  change for that handler.
- Step 3, per handler: the §3.4 baseline does not grow; the handler's own
  tests say which §3.1 spelling they use; any row that *leaves* the
  baseline is listed in the diff description with its cause group.
- Step 5: `_anyVersion` drift across repeated `.type` reads of a nested
  `Map` view is 0 *with the exemption disabled* — the item-219 pin
  (`tycho-item-219-nested-map-view-type-cost.test.ts`) run against a tree
  where `axisMaskOf`'s `scratch` branch is a no-op.

## 6. Open questions — need rulings

### 6.1 Sign facts that are not in the type

`ce.assume(x > 0)` narrows what a handler can say about `sqrt(x)` or
`Csc(x)`, and a held value narrows what it can say about `π·i` or `e^i`
(§4.3). Both reach handlers through the same getters (`x.isPositive`,
`x.sgn`), which `BoxedSymbol` answers from the value first and the
assumption store second. Options:

- (a) Sign refines the *type*. Either new lattice members
  (`positive_real`, `nonzero_real`, …) or a refinement facet on the
  declaration that `argTypes[i]` carries. Then handlers stay types-only.
  Largest change; cleanest result; and it is the only option under which
  a *constant's* sign (`π > 0`) is a type fact — `Pi`'s declared type would
  become `positive_real`.
- (b) Handlers keep a `context.sign(i)` channel (§5.1). Smallest change;
  the handler signature stays impure in one documented way; the
  item-219-style probe must then synthesize a sign for a stand-in (or
  pass `undefined`, losing the refinement in probes only).
- (c) Static typing ignores sign facts from outside the type; `sqrt(x)`
  types `finite_complex` under `x > 0`, `π·i` types `finite_complex`, and
  only evaluation benefits. ~14 tests change meaning, and 5 Fungrim rules
  need their `(complex)` parameters relaxed or the strict gate (§6.4)
  relaxed.

### 6.2 Where literal types may survive widening

A multi-clause definition `fib(0) = 0, fib(1) = 1, fib(n) = …` genuinely has
an arm whose domain is the literal `0`. Today it declares `(integer)`; the
experiment showed it *would* declare `((z: 0) -> 0) & ((o: 1) -> 1) & …` if
results were not widened. Is that a more honest overload set, or an
over-specific one? The default in §4.1 is to widen; this asks whether any
site should opt out.

### 6.3 A symbol's assigned value in static typing

`f := (t) ↦ (t, t², t³)`; `f'(0.25)` types `tuple<number, number, number>`
today because the `Derivative` handler reads `f`'s value. A types-only
handler reads `f`'s *signature*, which says `-> tuple` only if the
assignment refined it. The experiment found exactly two tests depending on
this. Options: (a) assignment-time signature refinement carries the tuple
result (it may already; verify); (b) accept the loss; (c) keep a
`context.ops` read for `Derivative` and document it as structural.

### 6.4 The strict gate

Independent of this design but deciding how much it matters: should the
declared-signature path admit by `couldMatch` and reject at evaluation,
as arithmetic already does? If yes, a handler returning `finite_number`
where `finite_integer` was possible costs nothing anywhere, and §5.3's
"byte-identical" bar can relax to "no new refusals". If no, every
refinement in §2.4 is load-bearing and §4.1 is mandatory before any handler
flips. This is a product decision: an error that surfaces at parse/box time
today would surface at evaluation instead.

### 6.5 Closedness and the generic-point convention

The engine types `Tan(r)` as `finite_real` for a symbolic real `r` — the
pole set has measure zero, so a generic point is off it — but `Tan(π/2)` as
`number`, because a *closed* constant expression can sit exactly on a pole
(`Tan(π/2) = ~oo`). `poleReciprocalType` makes that distinction with
`x.isConstant` (no free variables) and `isNumber(x)` (a literal, which can
only reach the pole at 0). Both operands type `finite_real`; the type does
not say which one is a generic point. The shim withheld `isConstant` and
produced `finite_real` for `Tan(π/2)` — a more refined type that is
**unsound**, the one direction §3's brackets exist to catch.

This is a structural fact, not a value fact, so it is admissible through
`context.ops` under §5.1 — but it is worth a ruling because it is the
generic-point convention itself showing up in the type system. Options:
(a) keep it as a documented `context.ops` read (the default; one function,
`poleReciprocalType`, shared by `Tan`/`Sec`/`Csc`/`Cot`/`Coth`/`Csch` —
`gammaPoleType` reads integrality and sign instead, which is §4.1 on a
literal and §6.1 otherwise); (b) give closed constant expressions a
type-level marker so `argTypes[i]` can say "closed" — which is option (a)
of §6.1 by another name.

## 7. Non-goals

- Changing `BoxedNumber.type` for consumers. A literal's *public* type stays
  `finite_integer` unless §6.2 rules otherwise; the literal type is a
  handler-input convenience in this design.
- Touching the `sgn` handlers. Same survey applies; separate document. (The
  `.im` reads in `Ceil`/`Floor`/`Truncate` are in their `sgn` handlers.)
- Removing the `scratch` exemption. It stays as a guard (tested in
  `state-events.test.ts`); the goal is that nothing needs it.
- Converting the remaining ~1429 exact-string type pins. §3's rule applies
  to new ones and to any that a later step makes fail; a sweep is what §3.2
  forbids.

## 8. Provenance

- Experiment worktree and shim: session CE-POC, 2026-08-22; ROADMAP entry
  "Type handlers as functions of TYPES, not expressions — measured
  2026-08-22". The shim is reproduced as `shim.patch` in the §3 session's
  scratchpad and summarized in §2 (a `Proxy` over each operand at the
  `def.type(…)` call site; value getters withheld on non-literals, literal
  types synthesized from a literal's value, results widened through
  structural nodes only).
- Step 0 execution and the §4.3 correction: session of 2026-08-22 (this
  draft); the run log is `baseline.log` in that session's scratchpad.
- Item 219 and the `scratch` exemption: ROADMAP "Reading a nested lazy view's
  type was exponential in depth"; `engine-configuration-lifecycle.ts`,
  `axisMaskOf`'s `declare` case; `probeBareMappingElementType`,
  `library/collections.ts`.
- Strict/lenient gate: `boxed-expression/validate.ts:459` (`couldMatch`) and
  `:464` (`matches`); ROADMAP "permissive boxing + eval guard" (2026-08-19).
- Pre-canonicalization validation phase (the broader question this design
  is one answer to): ROADMAP "A pre-canonicalization validation phase".
