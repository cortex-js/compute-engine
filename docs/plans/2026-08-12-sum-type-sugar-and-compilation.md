# Sum-type declaration sugar and JS compilation

**Status**: in implementation · **Date**: 2026-08-12 · Executes
`docs/TYPE_SYSTEM_ROADMAP.md` §2.3 (sugar) and §3 (D11 amendment), and closes
roadmap §7 open rulings 1 and 3.

## Part A — declaration sugar (§2.3)

One statement declares the variants and the sum:

```epsil
type TrafficLight = red | green | yellow
type node = lit(num: number) | plus(op1: node, op2: node) | times(op1: node, op2: node)
type tree<T> = leaf | node(value: T, children: list<tree<T>>)
```

desugaring to the N nominal variant declarations plus one transparent
`type alias` union — exactly the pinned semantics of
`test/compute-engine/sum-types.test.ts` (§2.1 of the roadmap). The sugar adds
NO new semantics: it is a declaration bundler.

### A1. Trigger (what is sugar, what is not)

A non-`alias` `type` statement whose body is a top-level union is the sugar
when:

- **any arm is call-form** — `name(payload…)` with parentheses; or
- **all arms are bare identifiers and none currently names a type** (this
  spelling is an `Unknown type` error today, so the reading is purely
  additive — `type TrafficLight = red | green | yellow` works without
  writing `red()`).

Everything else keeps its existing meaning. In particular
`type X = A | B` over **known** types stays the opaque nominal-with-union-body
(pinned: neither member is a member of it), and `type alias X = A | B` stays
the transparent union. Mixed bare arms (some known, some unknown) without a
call-form arm keep the existing reading and its `Unknown type` error — the
registry never silently flips the meaning of working code, only of erroring
code.

### A2. Variant forms and their lowering

| Arm | Lowers to |
|---|---|
| `red` (bare) | `type red = nothing` — nullary constructor `red()` |
| `jbool(boolean)` (one positional) | `type jbool = boolean` — unary constructor |
| `lit(num: number)` (named, any count) | `type lit = tuple<num: number>` |
| `plus(op1: node, op2: node)` | `type plus = tuple<op1: node, op2: node>` |
| ≥2 positionals `pair(integer, string)` | `type pair = tuple<integer, string>` |

Then one fulfilment: `type alias NAME = arm₁ | … | armₙ` (variant names,
applied to their parameter subsets for generic sums, A4).

### A3. The sum's own name in payloads — no `type` markers needed

The engine forward-registers the sum name (the same
`typeResolver.forward()` placeholder a `type NAME` marker creates) **before**
declaring the variants, so a payload may write `node` / `tree<T>` bare. The
final alias declaration fulfils the forward reference in place. References to
*other* not-yet-declared types still need the explicit `type X` marker.

### A4. Generic sums

The sum's `<T, U>` clause distributes to each variant by **usage**: a variant
is declared with the subset of the sum's parameters that occur free in its
parsed payload (parse the payload with the clause names seeded, take
`freeTypeVariables`), and the alias body applies each variant to its subset —
`type tree<T> = leaf | node(value: T, children: list<tree<T>>)` desugars to
`type leaf = nothing`, `type node<T> = tuple<value: T, children: list<tree<T>>>`,
`type alias tree<T> = leaf | node<T>`, matching the roadmap's manual form.

### A5. Variant-name collision guard (the `Add` hazard)

Declaring a variant whose name (a) already names a type, (b) is a reserved
word, or (c) resolves to a **system-scope** (builtin) binding is a diagnostic
and the whole sum declaration is rejected **atomically** (nothing declared,
forward registration rolled back). Rationale: `type Add = tuple<…>` succeeds
today and `Add(1, 2)` still evaluates the builtin to `3` — numeric heads
bypass definition lookup entirely, so the constructor is silently
unreachable. The sugar closes that trap by refusing the collision loudly.
Variants are otherwise **global, unscoped** names (same as the manual
desugaring); namespacing variants under the sum is deferred until a
namespacing mechanism exists (needs both a type and a value namespace).

### A6. Plumbing

- Epsil `parseTypeStatement` detects the trigger, parses the arms, and emits
  ONE statement node — `["DeclareSumType", name, attrs?, ["Tuple", variantName,
  payloadTypeText?]…]` (exact encoding mirrors `DeclareType` conventions;
  `typeParams` in the attributes dictionary). One node per statement is a
  parser invariant (a nested `Block` would fail the top-level check), which
  is why the desugaring happens engine-side.
- A `DeclareSumType` operator definition in `library/core.ts` mirroring
  `DeclareType` (`lazy`, `scope` effect, canonical **and** evaluate both
  declare, idempotent, top-level only).
- Engine-side `declareSumTypeStatement`: collision guard → forward-register →
  declare variants (recording `sumOf: <sumName>` on each variant's
  declaration record, and the variant list on the sum's record — the compile
  tier reads these) → declare the alias (fulfils the forward ref) → on any
  failure, roll back atomically.
- `serialize-epsil.ts` gets a `DeclareSumType` handler printing the sugar
  form back (round-trip).

## Part B — compiling sums (§3, the D11 amendment)

**Reframed rule (amends D11): the tag is erased iff it is statically
discharged.** Products discharge their tag at type-check time (erase, as
today); a sum's tag is runtime data when `match` branches on it (reify —
unless the variants are representation-disjoint, where the JS value IS the
tag).

Scope: **sugar-declared sums only** (they carry the `sumOf`/variant records;
a hand-assembled union of nominals has no sum identity to key the policy on
and keeps today's behavior: erased constructors, constructor-pattern `match`
fails closed).

### B1. Representation policy, per sum

At compile time, resolve each variant's **erased JS representation** via
`resolveTypeForCompilation`: `null`(nothing) / boolean / number / string /
array (tuple/list payloads) / object. Two variants collide when their
representations overlap (two `nothing` variants, two tuple variants, a
`number` and an `integer` variant, …).

- **All pairwise disjoint** (`type json = jnull | jbool(boolean) | jnum(number)
  | jstr(string) | jarr(list<json>)`): constructors keep the **D11 erasure**;
  `match` constructor patterns lower to representation tests
  (`typeof s === 'boolean'`, `Array.isArray(s)`, `s === null`).
- **Otherwise** (`plus`/`times` — same tuple shape): every constructor of
  that sum's variants compiles to a tagged object literal
  `{ _tag: 'plus', _ops: [a, b] }` (`{_tag: 'red'}` for nullary), and `match`
  constructor patterns lower to `s._tag === 'plus'` tests with payload
  captures reading `_ops[i]`.

The policy is per-sum and consistent within a compilation unit, so a value
constructed and matched in the same unit (including recursive compiled
functions — the `ev` example) always agrees with itself.

### B2. Targets and boundaries

- JS target only. Python / GPU / interval targets **fail closed** on sum
  constructor patterns and on tagged constructor emissions (the existing D6
  posture).
- The engine⇄compiled boundary does not marshal tagged values in v1: a
  compiled unit whose **result** type is a tagged (non-disjoint) sum declines
  compilation (fail closed) rather than leaking `{_tag}` objects into boxed
  land. Disjoint-sum results are ordinary erased values and flow as today.
- Field access (`v.op1`) on a *tagged* variant value inside compiled code:
  supported if the existing accessor path can be routed through the `_ops`
  indexing cheaply; otherwise fail closed with a clear diagnostic (v1).

### B3. Match plumbing

`Match` is a control-flow head with a bespoke lowering (`compileMatchJS` →
`emitMatchCaseJS`): add a constructor-pattern tier that recognizes a pattern
head naming a sugar-sum variant, classified via the scrutinee's static type
when available, else via the pattern head's own `sumOf` record. Everything
else about the ladder (tier 0–2, switch optimization, fail-closed tier 3)
stays.

## Acceptance

- Every existing `sum-types.test.ts` assertion passes with the program
  rewritten in sugar form (plus the desugared originals staying green).
- The sugar round-trips through `serialize-epsil`.
- Collision guard: `type Add = plus(op1: number, op2: number) | …` rejected;
  `type X = red | green` twice → idempotent redeclaration semantics
  consistent with `DeclareType`.
- Compile: the roadmap's `ev` AST example compiles on JS and agrees with the
  interpreter; a disjoint `json`-like sum compiles with **no** tags (assert
  on emitted code); Python/GPU fail closed; `type-constructors-compile.test.ts`
  (D11 erasure pins) passes unchanged.
