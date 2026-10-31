# What compiled code guarantees when the interpreter gives an error

Status: DECIDED 2026-10-31 by the user: option (b), with sub-decisions 1–5
as recommended in §6. The rule is in `AGENTS.md` ("Working rules"),
`docs/COMPILATION-MODEL.md` ("Fail closed") and `docs/ERROR-MODEL.md`.
Written by session compute-engine-69.

**The exact test of "an error that the type check sees"**: a sub-expression
is invalid (`isValid` is false), or its static type is `error`. Measured on
2026-10-31 at commit `a13a1e08d`: `"ab" + u` and `p + u` are invalid and
already declined; `ADD("ab", u)`, `Apply((x, y) ↦ x + y, "ab", u)` and
`ADD(p, u)` are valid with the static type `error` and compiled to `"ab2"`
and `3` (follow-up 8: they must now decline); `Apply(Apply(lit, "ab"), u)`
has the type `unknown`, `If(u > 1, "ab", 1) + 1` the type `integer`, and
`Sum(p, k = 1..u)` the type `number`: these are unspecified.

## 1. The rule today

`AGENTS.md` ("Working rules") and `docs/COMPILATION-MODEL.md`: a compiled
value equals the value of the interpreter, or the target declines (the host
then uses the interpreter). An error of the interpreter never becomes a
compiled value. One exception exists: when the caller leaves an input out,
the result is unspecified (`docs/ERROR-MODEL.md`, "An unsupplied variable").

To keep this rule, the compilers hold many checks that exist only for
expressions that the interpreter makes an error. Each review round of the
check for follow-up 8 (a call of a function literal with a string argument:
`Apply((x, y) ↦ x + y, "ab", u)` compiled to JavaScript `"ab2"`, the
interpreter gives `Error(incompatible-type)`) found one more shape that
still gave a value: a union argument, a call through another function, a
local variable, `Sum` of a boolean, a `Match` capture, Python `True == 1`.

## 2. The two kinds of error

- **Kind A, the expression has a type error.** Every input matches its
  type. `"ab" + u` with `u: real`; `ADD(p, u)` with `p: boolean`.
- **Kind B, an input value is outside its declared type.** `w + 1` with
  `w: real` and the host passes `"ab"`, `true`, `[1, 2]` or `{re, im}`.

## 3. The options

| | Kind B (input outside its type) | Kind A that the type check sees (`"ab" + u`) | Kind A that the type check does not see (`If(u > 1, "ab", 1) + 1`, `Sum` of a boolean) |
| --- | --- | --- | --- |
| (a) today | equal or decline | equal or decline | equal or decline |
| (b) | unspecified | **declines** (with `unsupported`) | unspecified |
| (c) | unspecified | unspecified | unspecified |

"Unspecified" means: any value, `NaN`, or a throw. A well-typed expression
with inputs inside their types keeps the full guarantee in every option.

## 4. What Tycho needs (answer of the session tycho-desk, 2026-10-31)

- Tycho declares almost every compiled input (`real`, a range such as
  `real<0..5>`, `real | signed_infinity | nan`, `list<…>`, points), and
  checks each scalar and each list before a run, but not each element of a
  list. It never passes strings, booleans, `null` or `{re, im}`. Two
  compiles do not declare their axes (the implicit predicate and the
  tri-tree condition); the engine infers `number` for them.
- Tycho builds its user warnings from compile declines ("This expression
  uses `a`, which is not defined"). Some compiles keep the structural form,
  which has no validity check, so the decline is Tycho's only type check.
  Under (c), an expression with a type error draws nothing and shows no
  warning.
- A throw is safe for Tycho (its wrappers give `NaN`). A meaningless number
  of the right shape is not.
- Tycho asks to keep: (1) a decline, with `unsupported`, for an expression
  whose canonical form is invalid; (2) the names of the refused inputs in
  the refusal, if an `unknown` input is refused; (3) the current meaning of
  `NaN` and `±Infinity` in an input declared `real | signed_infinity | nan`.

Request (1) is option (b). Option (c) breaks it.

## 5. The checks concerned

A read-only survey of `src/compute-engine/compilation/` found about 40
mechanisms. It read 17 files function by function and the other files by
their headers and keyword matches, so it can miss some.

- **Kind B, removable under (b) and (c): 14.** Most of the entry machinery
  of `run()` (`checkEntry` and the refusals of a non-number at a scalar, a
  string at a list, a non-string at a text binding, value kinds, about 600
  lines with the plans that store them), the same checks in `broadcast()`
  and the interval runner, `callResultGuard` (125 lines) and the
  `Array.isArray` wrappers at calls with untyped arguments. Each has a small
  cost on every call (a `typeof` per binding).
- **Kind A, removable under (c), and under (b) only for the errors the type
  check cannot see: 12.** For example `refuseBuiltinFoldOfNonNumbers`
  (`Reduce(L, Add, 0)` over booleans), `refuseNestedData` (`Mean` of nested
  lists), the branch-condition guard `_SYS.cond`, the use-before-assign and
  effect-contract checks (about 250 lines), and the pending check of
  follow-up 8.
- **Unsupplied input (the existing exception): 2**, about 800 lines
  (`unsuppliedComparisonGuard`, `collectionReadInputs`).
- **Must stay in every option: 9**, because they protect well-typed
  expressions too: string and aggregate comparisons, complex lanes,
  `Missing`/`Nothing` values, a declared `broadcastable<T>` parameter, the
  dispatch of a multi-clause function, a vector-valued `Sum` body, domain
  guards (`StringRepeat("a", -1)`).

The removal is a separate project in steps, each with its tests; this
decision only sets the rule.

## 6. Sub-decisions

1. **`NaN` or `±Infinity` in an input declared `real`.** `real` holds only
   finite values (`docs/ERROR-MODEL.md`), so under the input contract such a
   run is unspecified. Reported by tycho-desk on 2026-10-31 as approved by
   the user in that session: the result is unspecified; the `javascript`
   target behaves as if the input were declared
   `real | signed_infinity | nan`, and the documentation says so; the GPU
   targets can assume a finite value and give another result (`a - a` is
   `0`, `a/a` is `1`, `|k|` is dropped for `k` in `real<0..5>`). Tycho will
   test each document value with `Number.isFinite` before a GPU frame (Tycho
   ROADMAP row II). The meaning of `NaN` and `±Infinity` in an input
   declared `real | signed_infinity | nan` does not change.
2. **An input typed `unknown`** (no declaration, nothing to infer).
   Recommended: compile it as today; values outside what the code reads are
   unspecified. Do not refuse it now: Tycho needs about a day to read the
   names from a refusal, and the engine infers `number` for most axes.
3. **`any + any`** (`declaredTopGuard`): is `any` a promise that the value
   matches what the code reads? Recommended: yes (kind B), so the guard can
   go.
4. **A typed array for a `list` input**, and a string for a bare
   `indexed_collection`: these are valid values today (kind D). Recommended:
   keep as they are.
5. **A value outside a declared range** (`x: real<0..5>` given `7`).
   Recommended: the same rule as sub-decision 1, unspecified; the
   `javascript` target computes with the value as for `real`, and a GPU
   target can use the range (for example drop `|x|`). Tycho's slider ranges
   keep each value inside its range, so this does not change Tycho; Tycho
   asked that the contract states it.

## 7. Recommendation

Option (b), with the input contract and sub-decisions 1–5 as recommended.
Follow-up 8 then needs only one check: decline when a sub-expression has the
static type `error` (the engine already computes that type for a call whose
arguments the body refuses); the shapes that the reviews found are
unspecified. `AGENTS.md`, `docs/COMPILATION-MODEL.md` and
`docs/ERROR-MODEL.md` get the new rule.

If nothing is decided, rule (a) stays: follow-up 8 stays the narrow
allow-list (with one more review round), and about five older defects of
compiled operators (`Sum`/`Product` of a non-number, `Add` of a union
operand, Python `==` between a boolean and a number, a `Match` capture, an
unmatched `Match` that gives `null`) are required fixes.
