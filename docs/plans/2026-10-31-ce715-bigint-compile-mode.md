# CE-715: a `bigint` compile mode on the JavaScript target (spec)

Status: APPROVED by the user 2026-10-31, trade-offs T1 to T7 as recommended,
with one amendment: a non-finite value is returned as a `number` (`NaN`,
`Infinity`), not thrown (T1, §3.4). Revision 3 (2026-10-31) applies the two
rounds of the dual review
(`docs/scratch/2026-10-31-ce715-bigint-compile-mode_SPEC_REVIEW.md`, 18 and
14 findings) with the recommended options; §7 lists the choices made there,
so the user can reverse them. Revision 4 (2026-10-31, user decisions during
step 2): refined types for `Length`/`Count`, arithmetic and user calls
(§3.1.3); `Piecewise` and four control shapes decline (CE-715.8); and the
pole analysis is replaced by a documented rule (§3.4: a `number` result has
no defined relation to the interpreter's value). Step 1 is committed
(`8c94c065f`). Written for GitHub
issue #503 (RFC by `enumeratio`, 2026-10-30). The reply to the issue is
deferred until the implementation is done. Facts below were read in the tree
at commit `cda9d54e3`; the interpreter values and types were measured with
tsx scripts on 2026-10-31.

## 1. The question

Compiled JavaScript computes with doubles. An integer value past `2^53 − 1`
(`Number.MAX_SAFE_INTEGER`) is rounded, so a compiled counting function
(binomial sums, ballot numbers, Dyck-path unranking) is wrong there, and
`Mod`, `Remainder`, `GCD` and `LCM` throw a `RangeError` for such an operand
(`integerOperand` in `compilation/javascript-runtime.ts`;
`docs/COMPILATION-MODEL.md`, "Integer operations beyond the safe integer
range"). The interpreter is exact at any magnitude. The issue's author
subclasses `JavaScriptTarget` to emit `BigInt` code for integer-typed
expressions, measured 200 to 3,400 times faster than the interpreter, and asks
for four hooks that the subclass needs:

1. a target hook for the type-guard predicates (`Number.isInteger(…)`,
   `typeof … === 'number'`), which are `false` for a `bigint`;
2. a way to see `Divide(x, 2)`, which canonicalization has already made
   `Multiply(Rational(1, 2), x)`;
3. the `Range`/`Fold` loop counter sent through `target.number`, since the
   loop counts with a double (`for (let i = 0; i < n; i++) a + i * s`,
   `javascript-target.ts` near `_SYS.rangeCount`);
4. a supported way to replace the `_SYS` runtime helpers (`binomial`,
   `floorMod`, `gcd`, `at`, `atNumeric`, `creal`).

Three ways to answer: the four hooks, a separate target (`javascript-bigint`,
like `interval-js`), or a compile mode (`'bigint'` next to `'strict'`,
`'complex'`, `'auto'`).

## 2. The proposal: a compile mode, not a target and not hooks

**What varies is one lane, not the language.** The `interval-js` target is a
separate target because every value has another shape (a pair) and every
operator has another lowering: 7,153 lines plus its own runtime, sharing
almost no emitter with `javascript-target.ts` (17,232 lines). A bigint lane
changes the integer literal emission, the arithmetic on the integer lane, a
set of integer helpers, the type guards, the loop counters, the index
conversion of the collection helpers, and the value types at the boundary
(§3.5). Conditionals and folding stay as they are; CSE and the string
heads change where §3.2 to §3.4 say so. A separate target would copy the
JavaScript target or subclass it and reach into the same places the issue
reaches into.

**The mode machinery has the right shape.** `CompileMode` is declared per
target (`supportedModes`, `compilation/types.ts`), the result records the
effective mode, and the `complex` mode is the precedent: it selects a lane
for wide bindings. A `bigint` mode is the same kind of decision: which
representation a lane uses.

**The hooks become internal consequences** of the mode (table in §3.8), so no
new public extension point is needed, and the subclass in the issue becomes
`compile(expr, { mode: 'bigint' })`.

## 3. The rule

### 3.1 The lane is chosen by the refined static type, and the heads are listed

In the `bigint` mode **every numeric node is on the bigint lane or the
compilation declines**. The exceptions off the lane are: a rational constant
as the operand of a comparison (§3.3) and boolean nodes. A node is on the
lane (its value at run time is a JavaScript `bigint`)
when **both** hold:

- its **refined type** (§3.1.3) is a subtype of
  `integer | nan | infinity | signed_infinity`, that is, every finite member
  is an integer; and
- its head is on the allow-list of §3.1.1, or it is an integer literal, or a
  binding typed a subtype of `integer`, or a user call (§3.1.2).

A node that is integer-typed but whose head is not on the list **declines**
(§3.3): many integer-typed heads have a lowering that returns a double
(`DigitSum`, `IntegerDigits`, `StringLength`, `RandomInteger`, `Dimension`,
`IndexOf`, …), and a double inside a `bigint` expression is a run-time
`TypeError`, which is not a decline. Each head added later is a sub-item of
CE-715 (CE-715.3), prioritized by how often it occurs.

The inputs that the mode accepts are the bindings whose declared or inferred
type is a subtype of `integer`, and `list<integer>` (and nested lists of it).
A binding whose type admits a non-finite member (`integer | infinity`)
declines in the first version (CE-715.4).

Why the type and not the literal: canonicalization makes `n(n+1)/2`, with
`n: integer`, into `Multiply(Rational(1, 2), n, Add(n, 1))`, whose type is
`rational`. Probed types with `n`, `m` declared `integer`:

| Input                            | Type (engine)                       | On the bigint lane                                 |
| -------------------------------- | ----------------------------------- | -------------------------------------------------- |
| `Binom(2n, n) − Binom(2n, n+1)`  | `integer`                           | yes, exact `bbinomial`                             |
| `Mod(n, 7)`, `GCD(n, m)`, `−n`   | `integer`                           | yes                                                |
| `Mod(n, m)`                      | `nan \| real`, refined `integer \| nan` | yes; `NaN` at `m = 0` (§3.4)                   |
| `Abs(n!)`                        | `real<0..> \| signed_infinity`, refined `integer<0..> \| infinity` | yes            |
| `Sum(i², i = 1..n)`, `Prod(i)`   | `integer`                           | yes, counter is bigint                             |
| `Floor(n/3)`                     | `integer`                           | yes, floor division §3.2                           |
| `Floor(2^(−n))`                  | `integer`                           | yes, rounding of a reciprocal §3.2                 |
| `Floor(Sqrt(n))`                 | `integer \| nan \| signed_infinity` | yes, `bisqrt` §3.2                                 |
| `n!`                             | `infinity \| integer`               | yes, `Infinity` at `n < 0` §3.4                    |
| `n(n+1)/2`                       | `rational`                          | only under an integer-forcing parent §3.2          |
| `2^n`                            | `rational`                          | same                                               |
| `n^m`                            | `infinity \| nan \| real`           | declines unless `m` is typed `integer<0..>`        |
| `Factorial2(n)`                  | `infinity \| rational` (`(−5)!! = 1/3`) | declines unless `n` is typed `integer<0..>`    |
| `Mod(n/2, 7)`                    | `real`                              | declines (`Mod` takes `real`; the interpreter gives `3/2` at `n = 3`) |
| `Binom(2n, n) / (n + 1)`         | `infinity \| nan \| real`           | declines (a `Divide` whose type is `real`)         |
| `Sqrt(n)` outside a rounding head | `complex`                          | declines §3.3                                      |
| `DigitSum(n)`                    | `integer`                           | declines: head not on the list (CE-715.3)          |

#### 3.1.1 The allow-list

Each head on the lane has one of three lowerings: (a) a bigint lowering,
(b) a number lowering whose value is a safe integer, wrapped in `BigInt(…)`,
or (c) a lowering that converts a bigint index or count to a number after an
exact check.

| Head                                                   | Lowering                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `Add`, `Subtract`, `Negate`, `Multiply`                | (a) `+ − *` on `bigint`                                                 |
| `Power` with an exponent typed `integer<0..>`          | (a) `bpow` with the size limit of §3.9; a negative or unsigned exponent only under a rounding parent (§3.2) |
| `Power(−1, k)`: a literal base `−1`, any exponent on the lane | (a) `±1n` by the parity of `k` (`k % 2n === 0n ? 1n : -1n`); exact for a negative `k` too (user decision 2026-10-31: the loop index is typed `integer`, so `(−1)^k` in an alternating sum needs this row) |
| `Abs`, `Min`, `Max`, `Sign`                            | (a) `babs`, `bmin`, `bmax`, `bsign` (`Sign` gives `−1n`, `0n`, `1n`)   |
| `Mod`, `Remainder`, `GCD`, `LCM`                       | (a) `bfloorMod`, `bremainder`, `bgcd`, `blcm` (values in §3.6)          |
| `Factorial`, `Binomial`, `Fibonacci`                   | (a) `bfactorial`, `bbinomial`, `bfibonacci` (values in §3.6, size limit §3.9) |
| `Factorial2` of an operand typed `integer<0..>`        | (a) `bfactorial2`; any other operand type declines (`(−5)!! = 1/3`)     |
| `Floor`, `Ceil`, `Round`, `Truncate`                   | (a) over the shapes of §3.2 only                                        |
| `Sum`, `Product` with `Limits` on the lane             | (a) loop with a `bigint` counter (§3.7)                                 |
| `Fold`, `Reduce` over a `Range` or a `list<integer>`   | (a) same, with a lane callback                                          |
| `Range` with lane bounds and step                      | (a) array of `bigint`; the `4294967295` length limit stays              |
| `List`, `Map` over a lane list with a lane callback    | (a) array of `bigint`; a pole in a cell makes the whole result a `number` (§3.4) |
| `If` with an else branch, `Which` with a final `True` clause | (a) branches on the lane; the test is a boolean node (§3.3). `Piecewise`, an `If` with no else, a `Which` with no final `True`, a chained comparison and a `Block` of more than one statement decline (CE-715.8, user decision 2026-10-31) |
| `Typed(…, T)` with `T` a subtype of `integer`          | (a) the ascription (§3.2)                                               |
| `Length`, `Count`                                      | (b) `BigInt(<number lowering>)`                                         |
| `Boole`                                                | (b) `BigInt(<boolean>)`                                                 |
| `At`, `First`, `Last` with a lane index                | (c) `bindex(i, length)`: `Number(i)` when `−length ≤ i ≤ length` and `i ≠ 0`; otherwise, and for an empty list, the read is a pole carrying `NaN` (§3.4); the engine already types `At(L, n)` as `integer \| nan` |
| `Take`, `Drop` with a lane count                       | (c) `bcount(c, length)`: the count clamped to `[−length, length]` exactly, then `Number(c)`; the semantics of `takeDropSlice` (`Take(L, 0)` is empty, an oversized count is clipped) |
| `ReplaceAt` with a lane position                       | (c) `bindex`; out of range throws as the number lowering throws today   |
| A user function call (§3.1.2)                          | (a) when the parameter lanes match                                      |
| Boolean consumers of a lane operand                    | comparisons (§3.3); `IsPrime` through `isPrimeBigint` (`numerics/primes.ts`; the number `isPrime` tests `Number.isInteger` and is `false` for `17n`); every other boolean head with a lane operand declines (CE-715.3) |

Every other head with a lane-typed result, and every other head that
consumes a lane operand, declines (CE-715.3).

#### 3.1.2 User functions

The lane of a parameter is its declared type, or the specialized type that
`compile-user-specialization.ts` gives it. A parameter typed a subtype of
`integer` is on the lane; a parameter typed `number`, `real` or `complex` is
not. A call whose argument lane differs from the parameter lane **declines**:
`f: (number) -> number` with the body `x² + 1`, called `f(n)` with
`n: integer`, declines (a `Number(n)` conversion would lose precision
silently; a `bigint` in a double body is a `TypeError`). A function literal
without types takes the lane of its argument through specialization. An
emitted definition (a recursive function, for example) compiles under the
mode with the parameter lanes of its signature.

A call node is on the lane when the declared or inferred result type of the
function passes the test of §3.1. The engine types `f(n)` as `number` for
`f := x ↦ x!` (measured 2026-10-31), so the lane analysis uses the refined
type of the body analyzed with integer parameters, `infinity | integer`
(§3.1.3). An emitted definition has **no catch and no lift**: a
`NonFiniteValue` thrown in its body propagates to the catch of the compiled
entry (§3.4), so `f(n) + 1` and `f(n) > 5` both compile, and both give
`Infinity` at `n = −1`. A function declared
`-> integer` is an integer promise for its body (§3.2): the interpreter
checks the declared result as it checks `Typed` (measured: `g(−1)` with
`g: (integer) -> integer := x ↦ x!` is an `incompatible-type` error).

#### 3.1.3 Refined types

The engine's type handlers give a few lane heads a type wider than their
value with lane operands. The lane analysis uses a **compiler-local refined
type** for them, which never admits a value the engine's type excludes:

| Node with lane operands                      | Engine type                     | Refined type                                  |
| -------------------------------------------- | ------------------------------- | --------------------------------------------- |
| `Abs(t)`                                     | `real<0..> \| signed_infinity`  | `integer<0..>`, plus `infinity` when `t` has a non-finite member |
| `Mod(t, u)`, `Remainder(t, u)`               | `nan \| real`                   | `integer \| nan`; `integer` when `u` is a non-zero literal |
| `Power(t, u)` with `u` typed `integer<0..>`  | `infinity \| nan \| real`       | `integer`, plus `nan` when `t` and `u` can both be `0` |
| `Factorial2(t)` with `t` typed `integer<0..>`| `infinity \| rational`          | `integer`                                     |
| `Length(L)`, `Count(L)`                      | `integer \| signed_infinity`    | `integer<0..>` (the array of a list input is finite) |
| `Add`, `Subtract`, `Negate`, `Multiply`, `Min`, `Max` (at least one operand), `If`, `Which`, `Fold`, `Reduce`, with every operand on the lane | `number`, `real \| signed_infinity`, … (for example `f(n) + 1`, `Max(n, n!)`, `Length(L) + n`) | `integer`, plus the non-finite members of the operands |
| A user call `f(t)` (§3.1.2)                   | `number` for `f := x ↦ x!`      | the refined type of the body, analyzed with the parameter lanes |
| `Sum`, `Product` with every term on the lane  | `number` for `Sum(k!, k = 0..n)`, `nan \| real` for `Sum(Mod(n, k), k = 1..n)` | `integer`, plus the non-finite members of the body (user decision 2026-10-31) |

A refinement applies only when the engine's type is not already on the lane:
a narrower engine type is kept (`n^2` stays `integer<0..>`). Every other node
keeps the engine's type. A refinement is a rule of this mode only; the
engine's type handlers do not change. The `Length`/`Count`, arithmetic and
user-call rows were added by user decision 2026-10-31: the engine gives
these nodes a type off the lane, so §5 listed as compiling cases that the
rule as first written would have declined.

### 3.2 A non-integer subtree under an integer-forcing parent

A subtree whose type is not an integer type (`rational`, `real`, `complex`)
has no `bigint` value. It compiles on the bigint lane only when **both**
hold:

- its parent is **integer-forcing**. Two kinds, with different lowerings:
  - a **rounding parent**: `Floor`, `Ceil`, `Round`, `Truncate`;
  - an **integer promise**: an ascription `Typed(…, T)` with `T` a subtype
    of `integer`; the body of a user function declared `-> integer`; an
    argument at a parameter whose declared type, read from the signature,
    is a subtype of `integer` (`Fibonacci` is `(integer) -> integer`).
    `Mod` (`(real, real) -> real`), `Binomial` (`complex | infinity`),
    `Range` (`number` bounds), `GCD` (`any*`) and a `Sum` limit are **not**
    integer promises: `Mod(n/2, 7)` is `3/2` at `n = 3` and
    `Sum(i, i = 1..n/2)` is `3` at `n = 5` in the interpreter. A rational
    `Range`/`Sum` bound declines in the first version (CE-715.2); the
    interpreter takes the floor of the count there, and the exact count with
    a rational bound needs rational arithmetic.
- it has one of these shapes:
  - `Multiply(Rational(p, q), t₁, …)` with every `tᵢ` on the bigint lane:
    the quotient `p·t₁·… / q`;
  - `Divide(a, b)` with `a`, `b` on the bigint lane: the quotient `a / b`;
  - `Power(a, e)` with `a`, `e` on the bigint lane and `e` not typed
    `integer<0..>`: the quotient `1 / a^(−e)` for `e < 0`, `a^e` otherwise
    (one helper, `bpowRational`, gives the pair);
  - `Sqrt(t)` with `t` on the bigint lane (engine type `complex`), under a
    rounding parent only: the integer square root `k = bisqrt(t)` (Newton's
    method on `bigint`), rounded by the parent: `Floor` and `Truncate` give
    `k`; `Ceil` gives `k + 1` when `k² < t`; `Round` gives `k + 1` when
    `t > k² + k`. A negative `t` carries `NaN` (§3.4; the interpreter gives
    an `incompatible-type` error there, which the double mode projects to
    `NaN`).

The quotient is lowered by the parent: under `Floor`, `bfloorDiv`; under
`Ceil`, `bceilDiv`; under `Round`, `broundDiv` (half away from zero:
`Round(5/2) = 3`, `Round(−5/2) = −3`, measured); under `Truncate`,
`btruncDiv` (toward zero, with the zero test of §3.6; the native `/` is not
emitted). Under an integer promise it is a **checked exact division**: a
non-zero remainder throws a `RangeError` that names the operation and the
operands. That throw is allowed by the fail-closed contract
(`docs/COMPILATION-MODEL.md`, "Fail closed"): the value is outside the
promised type, and the interpreter reports a type error too. A zero divisor
is a pole (§3.4, §3.6).

Any other non-integer subtree, and any shape above outside an integer-forcing
parent, declines. The lowering of such a subtree depends on its parent, so
**it is not a CSE candidate**: `Floor(n/2) + Ceil(n/2)` at odd `n` needs two
quotients (`compile-cse.ts` skips a node marked parent-lowered). This rule
removes hook 2 of the issue: the target does not need to see `Divide`.

### 3.3 Mixed lanes, comparisons and strings

The issue's subclass throws at run time when a double meets a bigint. The
compiler knows the types, so the mode declines at compile time instead: a
`real`, `number` or `complex` binding read by the expression; a numeric head
whose refined type is not an integer type (`Sqrt`, `Sin`, `Ln`, `Divide`
typed `real`, `n^m` with an unsigned exponent) outside the shapes of §3.2; a
list whose element type is not integer; an integer-typed head that is not on the allow-list (§3.1.1); a user call
whose lanes differ (§3.1.2); a real (non-rational) constant anywhere. The
decline has its **own diagnostic code**, `'bigint-lane'`, of kind
`'capability'`, naming the node and its type. It is not `'lane-mismatch'`:
that code means a complex-shaped value reached a real binding, and
`compileWithAutoEscalation` retries in `complex` mode on it. A `bigint-lane`
decline never starts that retry. A declined compilation runs on the
interpreter, as every decline does.

**Comparisons.** `Less`, `Greater`, `LessEqual`, `GreaterEqual`, `Equal` and
`NotEqual` compile when both operands are on the lane (`<`, `>`, `<=`, `>=`,
`===`, `!==` on `bigint`). When one operand is a **rational constant** `p/q`
(the other on the lane), the comparison is done **exactly on the lane**:
`n < p/q` is emitted as `q·n < p` with `bigint` `p` and `q`, `q > 0` after
normalization, and `Equal`/`NotEqual` with a non-integer `p/q` fold to
`false`/`true`. A double is not exact for such a constant: `n ≥ (3·2^53 +
1)/2` at `n = 3·2^52` is `false` in the interpreter and would be `true`
against the rounded double, and `Equal(n, (2^53 + 1)/2^53)` at `n = 1` is
`False` but `1n == 1` would be `true`. A real constant (`10^20·π`) and any
other non-lane operand decline. A `Length` or `Count` is a lane value (§3.1.1
(b)), so it needs no special case.

**Strings.** Every string head with a lane operand declines in the first
version (CE-715.3), `String` too. The interpreter prints a large integer in
exponent form (measured 2026-10-31: `String(n^2)` at `n = 10^15` is
`"1e+30"`, `String(1000003·n)` is `"1000003e+15"`), and the JavaScript
`String(10n ** 30n)` prints all the digits; the other string lowerings call
`Number.prototype` methods or `JSON.stringify`, which throws on a `bigint`.
Found in the review of step 2; the first text of this rule said `String`
compiles.
A `boolean` result (`IsPrime`, a comparison) is a `boolean`.

### 3.4 Values with no `bigint` representation (trade-off T1, decided 2026-10-31)

An integer-lane type may hold `nan`, `infinity` or `signed_infinity`
members from a pole: `n!` is `infinity | integer`, `Mod(n, m)` is
`integer | nan` (refined, §3.1.3). A `bigint` cannot hold them. The result of
the compiled function is therefore `bigint | boolean | number`.

**The rule.** A `bigint` or `boolean` result is always the value of
`evaluate()`. A `number` result (`NaN` or `Infinity`) means that a
sub-expression had no finite value: it has **no defined relation** to the
value of `evaluate()`, which can be a finite integer, a boolean, another
non-finite value or an error. A host that needs the value evaluates the
expression with the interpreter. This is an exception, for the `bigint`
mode only, to the rule that compiled values agree with the interpreter for
well-typed inputs (AGENTS.md; `docs/COMPILATION-MODEL.md`, "Fail closed").

Examples at `n = −1`, `m = 0`:

| Expression        | `evaluate()`         | Compiled                        |
| ----------------- | -------------------- | ------------------------------- |
| `n!`              | `~oo`                | `Infinity`                      |
| `−\|n!\|`         | `−oo`                | `Infinity`                      |
| `n! > 5`          | `False`              | `Infinity` (not a boolean)      |
| `g(n!)`, `g := x ↦ 1` | `1`              | `Infinity`                      |
| `Mod(n, m)`       | `Indeterminate`      | `NaN`                           |
| `Mod(n!, 7)`      | `incompatible-type` error | `Infinity`                 |
| `Map(Range(−1, 1), k ↦ k!)` | `[~oo, 1, 1]` | `Infinity` (the whole list)  |

**The mechanism.** On the lane every value is a `bigint`, and the operators
and helpers stay `bigint`-only. A helper at a pole throws an internal
`NonFiniteValue` that carries a `number`: `Infinity` for a `~oo`
(`bfactorial` of a negative, a zero divisor with a non-zero dividend, `0` to
a negative power), `NaN` for an `Indeterminate` (`bfloorMod(a, 0n)`, `0/0`,
`0^0`, `bisqrt` of a negative, an out-of-range `bindex`). These are the
projections that the double mode uses (`docs/COMPILATION-MODEL.md`,
"Divergences of the `Infinity` projection"). One `try`/`catch` around the
body of the compiled entry, and around the body of a closure returned to the
host, catches it and returns the `number`. The catch is part of the
generated code, so every runner (`run`, the function-literal runner, code
rebuilt by `load()`) has it (§3.5). An emitted internal definition (a
recursive function) has no catch: the throw goes up to the catch of the
entry. There is no catch per list cell: a pole in any cell makes the whole
result a `number`.

**What the compiler does not do.** It does not test where a pole can occur:
there is no pole-capable test, no rule on the ancestors of a pole, no
decline for a pole under a comparison, a `Multiply` or in a loop body, and
no exclusion from common-subexpression elimination for a node that can be a
pole. A throw ends the whole computation, so no operator ever receives a
non-finite value, and a finite result is never computed from one.

**Why.** The rule of revision 3 (a pole compiles only where every ancestor
keeps it in the interpreter) needed an ancestor rule, three pole bits (one
for the sign that `Abs` gives), a catch per list cell, result-only lists, a
fixpoint for recursive functions and a range analysis of loop indices; the
review of step 2 found 14 defects in the first version, most of them in this
analysis, and it declined common counting sums (`Sum(k!, k = 0..n)`, whose
index type `integer` does not show that `k ≥ 0`). The user chose the
documented rule on 2026-10-31, consistent with R5 of
`docs/plans/2026-10-31-static-shape-compilation.md`.

**The two `RangeError` cases.** A checked exact division with a remainder
under an integer promise (§3.2), and the size limit of §3.9, throw a
`RangeError` to the caller: there the value is outside the declared type, or
beyond what the mode computes, not a pole. When a body holds both a pole and
one of these (`n! + Binomial(10^9, …)`), whichever is evaluated first
decides whether the result is a `number` or a `RangeError`; both mean "no
value". Common-subexpression elimination changes the order of evaluation (a
shared subexpression is computed before the root code), so the `cse` option
can change which of the two the host receives; it never changes a `bigint`
or `boolean` result. The native `RangeError` of a BigInt division by `0n` never reaches
the caller: every helper tests its divisor (§3.6).

**A `Map` callback runs on every element.** The interpreter's `Map` is a
lazy view, so a consumer that reads only its length does not call the
callback; the compiled `Map` builds the array. With
`hf: (integer) -> integer := x ↦ x/2`, `Length(Map(hf, L))` at `L = [1, 2]`
is `2` in the interpreter, and the compiled code throws the `RangeError` of
the checked exact division at `hf(1)`. A pole in the callback body gives a
`number` the same way. Both are "no value" cases of this section (found in
the review of step 2).

### 3.5 The boundary (trade-offs T2, T3)

- **Inputs.** A binding on the lane accepts a `bigint` as it is and lifts a
  safe-integer `number` with `BigInt(x)` (T3a). The lift is **emitted in the
  generated code** (`typeof x === 'number' ? BigInt(x) : x`, one `typeof`
  per binding per call), so it applies in every runner and also when
  `entryChecks` is `false`. The entry check, when on, refuses a `number`
  that is not a safe integer and any value that is neither a `number` nor a
  `bigint` with a `TypeError` that names the binding; with the checks off, a
  non-integer `number` fails in the native `BigInt(x)`, and an unsupplied
  input gives an unspecified result (`docs/ERROR-MODEL.md`, "An unsupplied
  variable"). A `list<integer>` binding is an array of `bigint`, or of
  safe-integer `number`s lifted cell by cell **only when the entry check is
  on** (a walk of the input; with the checks off the host passes `bigint`
  cells, as the doc comment of `entryChecks` will say). A closure returned
  to the host has the same lift on its parameters and the same catch.
- **Results.** A result on the bigint lane is a `bigint` for every integer
  value, never a `number` when it is small (T2a): a finite value never
  changes representation with its size. A non-finite value is a `number`
  (§3.4). A list result is an array of `bigint`, or of `bigint | number`
  when its element type has a non-finite member. A `boolean` result is a
  `boolean`.
- **Public types.** `CompiledValue` and the runner variable types in
  `compilation/types.ts` gain `bigint` (they hold `number` today, so a
  TypeScript host would need a cast). `normalizeRunResult` and
  `normalizeSharedArray` get a `typeof x === 'bigint'` fast branch, so a
  `bigint` cell does not take the slow route of the fallback branch. Adding
  `'bigint'` to the `CompileMode` union breaks a custom target with an
  exhaustive `switch` on it; the CHANGELOG lists both changes.
- **The other runners.** `broadcast()` and `broadcastAsync()` **refuse** in
  the `bigint` mode with a diagnostic that names the mode, the way
  `kindBroadcastError` refuses today: they call `rawCall` and write
  `Float64Array` outputs, which cannot hold a `bigint` (CE-715.5 for a
  bigint output form). The stored artifact **records the effective mode**
  (a `mode` field next to `StoredEntryPlan`, independent of the entry
  checks), and the stored batch loaders `loadBroadcast`,
  `loadBroadcastSlice` and `loadBroadcastAsync` of `javascript-runtime.ts`
  refuse on it before any worker dispatch. Code rebuilt by
  `createJavaScriptRuntime().load()` reproduces `run()` because the lift
  and the catch are in the emitted code; the runtime gains the helpers of
  §3.6 with a `runtimeVersion` bump, and `StoredEntryPlan` records the lane
  of each binding for the entry check. `ComputeEngineFunctionLiteral` and a
  closure returned by the code carry the same emitted wrapper.
- **Python** is unchanged. Its integers are exact already (`Mod` passes
  past `2^53`), but its `Rational` lowering is a float; making it exact is
  CE-715.7.

### 3.6 The runtime helpers and their values at zero and at a pole

A bigint helper set in `javascript-runtime.ts`, used only in this mode. The
interpreter values below were measured on 2026-10-31; each row is a test.

| Helper            | Case                         | Interpreter        | Compiled                       |
| ----------------- | ---------------------------- | ------------------ | ------------------------------ |
| `bfloorDiv(a, b)` | `b = 0`, `a ≠ 0`             | `~oo`              | carries `Infinity`             |
|                   | `a = b = 0`                  | `Indeterminate`    | carries `NaN`                  |
|                   | `−7, 2`                      | `−4`               | `−4n`                          |
| `bceilDiv`        | `−7, 2`                      | `−3`               | `−3n`; zero divisor as above   |
| `broundDiv`       | `5, 2` / `−5, 2` / `7, 2`    | `3` / `−3` / `4`   | half away from zero            |
| `btruncDiv`       | `−7, 2`                      | `−3`               | `−3n`; zero divisor as above   |
| exact division    | remainder `≠ 0`              | type error         | throws `RangeError` (§3.2)     |
| `bfloorMod(a, b)` | `b = 0`                      | `Indeterminate`    | carries `NaN`                  |
|                   | `−7, 3`                      | `2`                | `2n` (sign of the divisor)     |
| `bremainder`      | `b = 0` / `−7, 3` / `25, 15` / `7, 2` | `Indeterminate` / `−1` / `−5` / `−1` | carries `NaN` / `−1n` / `−5n` / `−1n`: `a − b·q`, with `q` the quotient `a/b` rounded to the nearest integer and a tie rounded toward +∞, as the interpreter does (measured 2026-10-31; the first text of this row said "sign of the dividend", which gives `10` for `25, 15`) |
| `bpow(a, e)`      | `0, 0`                       | `Indeterminate`    | carries `NaN`                  |
|                   | `−2, 3`                      | `−8`               | `−8n`                          |
|                   | `1, 10^7` / `−1, 10^7`       | `1` / `−1`         | `1n` / `−1n` (no size limit for `\|a\| ≤ 1`) |
|                   | result past the size limit   | stays symbolic     | throws `RangeError` (§3.9)     |
| `bpowRational`    | `0, −k` under a rounding parent | `~oo`           | carries `Infinity`             |
|                   | `2, −3` under `Floor`/`Ceil` | `0` / `1`          | `0n` / `1n`                    |
| `bgcd`            | `0, 0` / `0, 5` / `−4, 6`    | `0` / `5` / `2`    | same, non-negative             |
| `blcm`            | `0, 5`                       | `0`                | `0n`                           |
| `bfactorial(n)`   | `n < 0` / `0`                | `~oo` / `1`        | carries `Infinity` / `1n`      |
| `bfactorial2(n)`  | `0` / `7`                    | `1` / `105`        | `1n` / `105n` (a negative operand is excluded by the type, §3.1.1) |
| `bbinomial(n, k)` | `−1, 2` / `5, −1` / `5, 7`   | `1` / `0` / `0`    | same (the generalized binomial for a negative `n`) |
| `bfibonacci(n)`   | `−3` / `0`                   | `2` / `0`          | same (negafibonacci); size limit §3.9 |
| `bisqrt(t)`       | `17` / `−4`                  | `4` / type error   | `4n` / carries `NaN`           |
| `Ceil(Sqrt(t))`   | `17` / `16`                  | `5` / `4`          | `5n` / `4n`                    |
| `Round(Sqrt(t))`  | `17` / `20` / `16`           | `4` / `4` / `4`    | `4n` / `4n` / `4n` (`20 ≤ 4² + 4`) |
| `bsign`           | `−5` / `0`                   | `−1` / `0`         | `−1n` / `0n`                   |
| `bindex(i, len)`  | `0`, or beyond `±len`, or `len = 0` | absence marker (`NaN` in the double mode) | carries `NaN` (§3.4) |
| `bcount(c, len)`  | `0` / `len + 5` / `−(len + 5)` | as `Take`/`Drop` today | `0` / `len` / `−len`, then `Number` |

Every helper tests a zero divisor itself, so the native `RangeError` of
`0n` never escapes. The predicate `isIntegerValue(x)`
(`typeof x === 'bigint' || Number.isInteger(x)`) is what the type guards
emit in this mode. Hook 4 of the issue is covered: the helper set is chosen
by the mode, with no `_SYS` replacement API.

### 3.7 Modes, loops and folding

- **The mode predicates.** `'bigint'` is added to `CompileMode` and to
  `supportedModes` of the `javascript` target
  (`['strict', 'complex', 'auto', 'bigint']`). Inside the compiler the mode
  is **the strict discipline plus the integer lane**: `CompilerState._mode`
  stays `'strict'` and a new latch `CompilerState._integerLane:
  'double' | 'bigint'` carries the lane, so `strictLanes()` stays `true`
  (its binding-boundary lane-mismatch check stays on), `complexDiscipline()`
  stays `false`, no promotion happens, and the about 35 existing
  `_mode ===` sites need no change. `compileWithAutoEscalation` is not
  affected: the default stays `'auto'` (it is in `supportedModes`), and a
  requested `'bigint'` runs one attempt with no retry. The result reports
  `mode: 'bigint'`, `promoted: false`. The other targets do not change; a
  requested `'bigint'` there is the existing `unsupported-mode` decline. The
  doc comment of `CompilationOptions.mode` names the fourth mode, for
  JavaScript only.
- **No `auto` escalation in the first version (T6, CE-715.6).**
  Strict-to-complex is a compile-time retry on a lane mismatch.
  Strict-to-bigint would react to a run-time value past `2^53`, which means
  a thrown `RangeError`, a recompilation and a rerun of the call. That is
  another mechanism.
- **Loops.** `Range`, `Sum`, `Product` and `Fold` over a range whose bounds
  are on the bigint lane count with a `bigint` index
  (`for (let i = 0n; i < n; i++)`), and `_SYS.rangeCount` gets a bigint
  variant. The array-length limit of `Range` (`4294967295`) stays, tested on
  the bigint count. The loops have no iteration limit and no size limit on
  their accumulator, as the double loops have none today (§3.9). Hook 3 of
  the issue is covered by this, not by `target.number`.
- **Constant folding.** A folded integer-lane subtree emits a `bigint`
  literal (`123n`) from the exact value of `evaluate()`; the "beyond the
  safe integer range" rule of folding becomes simpler here, since no
  rounding happens. A fold whose value is not an integer declines (§3.2),
  never becomes a double. A hoisted `bigint` literal is a CSE candidate as
  any literal is; a parent-lowered quotient is not (§3.2).

### 3.8 The four hooks of the issue

| Hook | In the mode                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------- |
| 1    | The JavaScript target emits every guard through one function that reads the lane (`isIntegerValue`). Not public. |
| 2    | Not needed: §3.2 lowers the `Rational` factor exactly under an integer-forcing parent.              |
| 3    | The loops count in `bigint` when the bounds are on that lane (§3.7).                               |
| 4    | The helper set is chosen by the mode (§3.6). No `_SYS` replacement API.                             |

### 3.9 A size limit on the helpers

A host-supplied `bigint` can ask for `2n ** e` with `e = 10⁹`,
`bfactorial(10n ** 7n)`, `bfibonacci(10n ** 9n)` (about 694 million bits) or
`bbinomial(10n ** 9n, 5n · 10n ** 8n)`: minutes of work, gigabytes of
memory, then the engine's "Maximum BigInt size exceeded". The interpreter
has a cap for the same reason: above `MAX_EXACT_COMBINATORICS_DIGITS =
1_000_000` decimal digits (`library/combinatorics.ts`, mirrored by
`MAX_EXACT_POW_DIGITS`) it returns the expression unevaluated (measured:
`Fibonacci(10^9)`, `2^(10^7)` and `(10^6)!` stay symbolic). The mode uses
**the same cap**: `bpow`, `bpowRational`, `bfactorial`, `bfactorial2`,
`bbinomial` and `bfibonacci` estimate the decimal digits of their result
before computing it (`e · log10|a|` for a power, no limit for `|a| ≤ 1`;
Stirling's formula for a factorial; the interpreter's
`estimatedBinomialDigits` for a binomial; `|n| · log10 φ` for a Fibonacci
number) and throw a `RangeError` that names the operation past the cap. The
interpreter's answer there is the unevaluated expression and the compiled
code's is a `RangeError`: both are "no value", and the divergence is
documented next to the "beyond the safe integer range" rule. The loops and
the `*` operator are **not** guarded (`Product(k, k = 1..n)` computes `n!`
with no limit, as the double loop runs with no limit today); a host that
compiles untrusted expressions bounds its inputs, as it must today.

## 4. Trade-offs decided by the user (2026-10-31)

- **T1. Non-integer value in an integer-lane type** (`n!` at `n = −1`).
  DECIDED (user amendment): return the non-finite value as a `number`, so
  the result type is `bigint | number` and a `number` result is never finite
  (§3.4). Refined 2026-10-31 (user decision during step 2): a `number`
  result has no defined relation to the interpreter's value, and the
  compiler does no pole analysis. The options were (a) throw a `RangeError` at run time, (b) decline
  when the type has a `nan`/`infinity` member, which would decline `n!`.
- **T2. Result value.** (a) `bigint` for every integer value, approved; only
  a non-finite value is a `number` (T1). (b) `number` when the value is safe,
  `bigint` otherwise: the host must test every result.
- **T3. Input value.** (a) `bigint`, or a safe-integer `number` lifted,
  approved. (b) `bigint` only: a host that holds plain integers converts.
- **T4. Rational subtree under an integer-forcing parent.** (a) The shapes
  of §3.2 with the parent's rounding or a checked exact division, approved.
  (b) Decline every rational subtree: `n(n+1)/2`, `Floor(n/3)` and `2^n`
  decline until the host rewrites them.
- **T5. The name.** `bigint` names what the host receives, approved. `exact`
  would promise rationals too, which this does not give.
- **T6. Escalation.** None in the first version, approved (CE-715.6).
- **T7. Who implements.** In house against this spec, in steps (§5),
  approved; the author is told the spec is the contract.

## 5. Steps

1. **Mode plumbing.** `CompileMode` gains `'bigint'`; `supportedModes` of
   the JavaScript target; the `_integerLane` latch next to `_mode`
   (§3.7); result `mode`; the stored `mode` field (§3.5); the `bigint-lane`
   diagnostic code (§3.3); `unsupported-mode` on the other targets. Tests: a
   requested `bigint` on `interval-js` declines; `strictLanes()` is `true`
   in the mode; the `auto` default is unchanged. (`types.ts`,
   `compiler-mode.ts`, `compiler-state.ts`, `diagnostics.ts`,
   `javascript-target.ts`.)
2. **Lane analysis.** `bigintLane(type)` (the subtype test of §3.1), the
   refined types (§3.1.3), the allow-list (§3.1.1), the parameter-lane and
   call rules (§3.1.2), the mixed-lane decline (§3.3), the integer-forcing
   parents and the four shapes (§3.2), and the CSE exclusion of a
   parent-lowered node. No pole analysis (§3.4, user decision 2026-10-31).
   (`compile-declarations.ts`, `compile-operators.ts`,
   `compile-real-analysis.ts` for the rounding heads, `compile-cse.ts`,
   `compile-user-calls.ts`.)
3. **Emission.** Integer literals as `123n` on the lane; arithmetic and
   comparisons, with the exact rational comparison (§3.3); the guards
   through `isIntegerValue`; the helper set of §3.6 with the zero tests and
   the size limit of §3.9; `isPrimeBigint`; the loop counters; the index and
   count conversions of the collection heads. (`javascript-target.ts`, `javascript-runtime.ts` with a
   `runtimeVersion` bump, `compile-loops.ts`.)
4. **Boundary** (§3.4, §3.5): the `NonFiniteValue` class, the emitted
   wrapper (lift and catch) on the entry and on returned closures, the
   entry check, `StoredEntryPlan`, the refusal of `broadcast`,
   `broadcastAsync`, `loadBroadcast`, `loadBroadcastSlice` and
   `loadBroadcastAsync`, `CompiledValue` and the normalizer fast branches.
5. **Folding** (§3.7): `constant-folding.ts`, `compile-folded-values.ts`.
6. **Docs and tests.** `docs/COMPILATION-MODEL.md`: rename "Complex modes"
   to "Compile modes" and add the `bigint` section; add a paragraph to
   "Integer operations beyond the safe integer range" (exactness, the size
   limit and its divergence); the `mode` and `entryChecks` doc comments in
   `types.ts`; CHANGELOG (the mode, the `CompiledValue` and `CompileMode`
   type changes). Tests, each compared with `evaluate()`: one per row of
   the tables in §3.1, §3.1.3 and §3.6; the Catalan form and
   `Mod(2^60 + 1, 10) = 7` past `2^53`; a `Sum` to `n = 10⁶` with a bigint
   counter; `Floor(n/2) + Ceil(n/2)` at odd `n`; `Floor(2^(−n))` at `n = 3`;
   `Floor(Sqrt(n))`, `Ceil(Sqrt(n))`, `Round(Sqrt(n))` at squares, at `17`
   and `20`, and past `2^53`; `At(L, k)` in range, at `0` and past the
   length (a `NaN` result); `Take(L, 0)`; `Length(L) + n`; `n > 1/2`,
   `n ≥ (3·2^53 + 1)/2` at `n = 3·2^52`, `Equal(n, (2^53 + 1)/2^53)` at
   `n = 1`; `IsPrime(n)` at `17`; the decline of `String(n)`; `1^(10^7)`; the
   declines of §3.1 to §3.3 (`DigitSum(n)`, `Mod(n/2, 7)`, `n^m`,
   `Factorial2(n)` with `n: integer`, `f(n)` with `f: (number) -> number`,
   a real constant); counting sums that compile (`Sum(k!, k = 0..n)`,
   `Sum(Floor(n/k), k = 1..n)`, the derangement sum with `(n − k)!`); the
   `number` results of §3.4, each a `number` (not compared with the
   interpreter's value): `n!` at `−1`, `−|n!|`, `n! > 5`, `0·n!`,
   `n! − m!`, `Sum(k!, k = −1..n)`, `Mod(n, m)` at `m = 0`,
   `Map(Range(−1, n), k ↦ k!)` (the whole result), and a finite or boolean
   result next to them that equals `evaluate()` (`If(n < 0, 0, n!)` at
   `n = −1` is `0n`); the entry lift and refusals, with `entryChecks` on and
   off; a returned closure; `run` versus `load()` parity on the same cases;
   the refusal of the five batch routes, also on stored code; the size limit
   on each guarded helper (`Fibonacci(10^9)` is a `RangeError` at once).
7. **ROADMAP.** The sub-items CE-715.2 to .8 (§6) stay open after the mode
   lands; the entry itself is deleted.
8. **Reply to #503** with the mode and the version (deferred by the user).

Steps 1 to 5 are one ROADMAP item (CE-715) done in order; each step leaves
the suite green. Size: an estimate, not measured, is one to two weeks of
work, most of it in steps 2 and 3.

## 6. Deferred shapes (each a sub-item of CE-715, with a priority)

Priorities: how often the shape occurs in the issue's domain (counting
functions) and in a host that compiles user expressions.

- **CE-715.1** Removed 2026-10-31: the finer pole-keeping rule has no use
  since the pole analysis was replaced by the rule of §3.4.
- **CE-715.2** (medium) A rational `Range`/`Sum`/`Product` bound (§3.2).
  Example: `Sum(i, i = 1..n/2)` declines; the interpreter gives `3` at
  `n = 5`.
- **CE-715.3** (high) Integer-typed heads not on the allow-list, boolean
  heads other than the comparisons and `IsPrime`, and every string head,
  `String` included (§3.1.1, §3.3; `String` needs a helper that prints as
  the interpreter does, `"1e+30"`). Examples: `DigitSum(n)`,
  `IntegerDigits(n)`, `IndexOf(L, n)`, `IsEven(n)`, `String(n)`.
- **CE-715.4** (low) A binding whose type admits a non-finite member
  (`integer | infinity`) as a lane input (§3.1).
- **CE-715.5** (medium) A `bigint` output form for `broadcast()`,
  `broadcastAsync()` and the stored batch loaders (§3.5).
- **CE-715.6** (low) Escalation to `bigint` on a run-time value past `2^53`
  (§3.7, T6).
- **CE-715.7** (low) The Python target's `Rational` lowering as an exact
  `fractions.Fraction` (§3.5).
- **CE-715.8** (medium) `Piecewise`, a chained comparison, a `Block` of more
  than one statement, an `If` with no else and a `Which` with no final `True`
  decline in the first version (§3.1.1, user decision 2026-10-31).

## 7. Choices made in revisions 2 and 3 (reversible)

Each was a design choice in the review; the recommended option was taken.

- **Poles** (replaced by user decision 2026-10-31, after the review of
  step 2): no pole analysis; a `number` result has no defined relation to
  the interpreter's value (§3.4). The rule of revisions 2 and 3 (a pole
  compiles only where every ancestor keeps it; a catch per list cell and
  result-only lists) is removed. Alternative: keep that analysis and add a
  range analysis of loop indices so that `Sum(k!, k = 0..n)` compiles.
- **A list with a pole in a cell** (user decision 2026-10-31): the whole
  result is a `number`. Alternative: a catch per cell, which keeps
  `[Infinity, 1n, 1n]` but needs result-only lists and CSE exclusions.
- **`broadcast()` in the mode** (round 1, finding 6): refuse with a
  diagnostic, on every batch route including the stored loaders (round 2).
  Alternative: a `bigint` output form now (CE-715.5).
- **The size limit** (round 1, finding 12; round 2): the interpreter's own
  cap of `1_000_000` decimal digits, a `RangeError`, on the six helpers that
  can produce a large value; loops unguarded. Alternatives: a smaller cap
  (`2^20` bits, revision 2), or carry `Infinity`, which would make a
  `number` result stand for a finite value and break the rule of §3.4, or
  guard the loop accumulators at a cost per iteration.
- **A rational constant in a comparison** (round 2): exact comparison on
  the lane (`q·n < p`). Alternative: decline every comparison with a
  constant that is not an integer.
- **Refined types** (round 2): compiler-local refinements for `Abs`, `Mod`,
  `Remainder`, `Power` and `Factorial2` (§3.1.3). Alternative: change the
  engine's type handlers, which is a change to the interpreter's types for
  every consumer.
