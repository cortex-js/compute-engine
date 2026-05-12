# Actions and Deterministic Randomness in Compute Engine

## 1. Block is sequential

`Block(stmt1, stmt2, ...)` evaluates each statement in order. Later statements
observe side effects from earlier ones — `Assign`, `Declare`, etc.

```mathjson
["Block",
 ["Assign", "a", 1],
 ["Assign", "b", ["Add", "a", 1]],   // sees a = 1; b becomes 2
 "b"]
```

This matches the imperative semantics of most programming languages (`let`/`const`
in JS, `:=` in Pascal). Consumers translating *declarative*, *simultaneous*
action notations (such as Desmos's action tuples) must use the rewrite below.

## 2. Snapshot-then-commit recipe for simultaneous tuples

Desmos: `(a → 1, b → a + 1)`  — `b` reads the **pre-action** `a`.

Equivalent MathJSON:

```mathjson
["Block",
 ["Assign", "_t_a", 1],
 ["Assign", "_t_b", ["Add", "a", 1]],
 ["Assign", "a", "_t_a"],
 ["Assign", "b", "_t_b"]]
```

Why two passes: bind every RHS to a fresh temp first (RHSs still see pre-action
state), then commit temps to LHS symbols. Order of the commit pass does not
matter because no temp depends on another temp.

Equivalent compact form: substitute every LHS-mentioned symbol in subsequent
RHSs with a fresh alias bound to the pre-state value before the Block runs:

```mathjson
["Block",
 ["Assign", "_pre_a", "a"],       // snapshot
 ["Assign", "a", 1],               // free to assign now
 ["Assign", "b", ["Add", "_pre_a", 1]]]
```

## 3. Deterministic randomness

`Random()` returns a non-deterministic float in `[0, 1)` (host PRNG, e.g.
`Math.random` on JS).

`Random(seed)` where `seed` is a real number returns a deterministic float in
`[0, 1)` derived from `seed`. The hash matches the GLSL hash used by the GPU
compile target so that the same seed produces a similar (not bit-identical)
value on JS and GLSL:

  `fract(sin(seed * 12.9898) * 43758.5453)`

Caveats:
  - JS uses fp64 by default; GLSL fragment shaders use fp32. JS↔GLSL parity is
    approximate (within fp32 precision near the seed; can diverge for large
    seeds or near sin's roots).
  - `Math.sin` is not bit-portable across JS engines (ECMAScript permits
    implementation-defined precision).
  - Within a single host, the same seed always yields the same value — that's
    the guarantee.

For integer bounds, `Random(n: integer)` returns an integer in `[0, n)` and
`Random(m: integer, n: integer)` returns an integer in `[m, n)`. These are
non-deterministic — to seed an integer draw, scale a seeded float yourself:
`Floor(Add(m, Multiply(Random(seed), Subtract(n, m))))`.

`Shuffle(L, seed?)` and `Sample(L, k, seed?)` accept an optional seed that
makes the reordering deterministic. Internally, the seed advances per element
via an additive Weyl-sequence increment (golden-ratio fractional part) so
element-to-element draws are decorrelated.

## 4. The `\operatorname{where}` clause — local bindings

`expr \operatorname{where} a \coloneq v_1, b \coloneq v_2` is a
*local-binding* expression (equivalent to JS `let*` / Scheme `let*`): it
evaluates `expr` after binding `a = v_1`, `b = v_2` in order. Later
bindings can reference earlier ones.

It parses to a Block of the form:

```mathjson
["Block",
 ["Declare", "a"], ["Assign", "a", v_1],
 ["Declare", "b"], ["Assign", "b", v_2],
 expr]
```

The explicit `Declare` before each `Assign` is what isolates the binding to
the Block's local scope: without it, `Assign` would walk up the scope chain
and mutate a pre-existing outer binding. Inside the clause, the bindings
shadow any outer symbol of the same name; once the clause finishes, the
outer scope is unchanged.

```latex
% Outer a = 100.
a \operatorname{where} a \coloneq 5                   % evaluates to 5; outer a still 100
a + b \operatorname{where} a \coloneq 2, b \coloneq 3 % evaluates to 5
b \operatorname{where} a \coloneq 5, b \coloneq a + 1 % evaluates to 6 (b sees a = 5)
```

Contrast with the action-tuple translation (section 2): action tuples *do*
want to mutate the outer scope (that's the whole point), and the
snapshot-then-commit Block deliberately omits the `Declare` so the final
pass overwrites the outer bindings.

> **Desmos's `\operatorname{with}` clause.** CE does not ship a built-in
> parser for Desmos's `with` keyword (which lowers to the same `Block`
> shape). Consumers that need it should register it as a custom dictionary
> entry — see the "Desmos-Specific Syntax — Prefer Custom LaTeX
> Dictionary" section in `COMPUTE_ENGINE.md` for the worked example.

### Implementation note

This relies on `Declare`'s evaluator being idempotent with respect to
inferred-only bindings: when a Block's canonical pass auto-declares a
symbol that an inner `Assign` references, the subsequent explicit
`Declare` upgrades the inferred placeholder to an explicit local binding
rather than throwing "already declared in this scope". See
`src/compute-engine/library/core.ts` (`Declare`'s `evaluate` handler) for
the upgrade rule.
