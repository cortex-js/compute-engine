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

## 4. The `\operatorname{with}` clause — local bindings, not actions

`expr \operatorname{with} a = v_1, b = v_2` is a *local-binding* expression
(equivalent to JS `let*` / Scheme `let*`): it evaluates `expr` after binding
`a = v_1` and `b = v_2` in order. Later bindings can reference earlier ones.

It parses to a Block:

```mathjson
["Block",
 ["Assign", "a", v_1],
 ["Assign", "b", v_2],
 expr]
```

### Known limitation — outer-scope leakage

When a binding's symbol is already declared at an outer scope, the `Assign`
walks up the scope chain and mutates the outer binding rather than creating
a fresh local one. So `expr \operatorname{with} a = 5` is **safe only if
`a` is not already declared** at the calling scope. If `a` pre-exists,
its outer value is overwritten after the clause runs.

This limitation is shared with `\operatorname{where}` (which has the same
parser shape). The natural fix — inserting `Declare` before each `Assign`
— collides with Block's canonical-pass auto-declare and throws "already
declared" at evaluate time. Properly isolating Block-local `Declare`/`Assign`
pairs is tracked as a follow-up.

**Workaround for consumers:** rename the binding symbol to a fresh local
name before emitting the `with` clause (e.g. translate
`expr \operatorname{with} a = 5` to `expr[a := _a_local] \operatorname{with} _a_local = 5`
when `a` may pre-exist at the calling scope).

Contrast with the action-tuple translation (section 2): action tuples *do*
want to mutate the outer scope (that's the whole point), so the
snapshot-then-commit Block deliberately leans on the same leak.
