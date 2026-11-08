# CE-1091: the type cache keeps a type computed during the computation of another function

Status: the board must choose an option (`issues/CE-1091.md`). Measured on
2026-11-08 at `d8e2c256ebb2dc21fe69f339ae7d223fd30bfc5f`.

## The defect

```
f, g declared (unknown) -> unknown, m: integer
g := n ↦ If(n = 0, 2, f(n − 1))
f := n ↦ If(n = 0, "a", g(n − 1))
g(m)      type number          (HEAD)
g(1)      value "a"
```

Each order of assignment (fg, gf) and of first read (f(m), g(m)) was
measured. At HEAD, the order gf gives `g(m)` the type `number` in both read
orders. `Tuple(g(m), f(m))` in the order gf is
`tuple<number | string, number>` at HEAD. Without the declarations, every
order gives `unknown`, which is correct.

## The cause

1. `unknownCallMayBeRecursive()` (`declared-parameter-result.ts`) reads a call
   of a name as a recursive call, and `untypedArm()`
   (`library/control-structures.ts`) leaves it out of the join of an `If`,
   when the result type of that name is being computed: its assignment is in
   flight (`whileDefining()`), its signature derivation is on the stack, or
   the type of its function literal is in flight.
2. The type of the body of `g` is computed while the result type of `f` is
   computed: inside the assignment of `f` (after the value write, when
   `setSymbolValue()` reads the type of the value), or inside the signature
   derivation of `f` at a later read. `f(n − 1)` is left out, and the body
   of `g` is typed `integer`.
3. That type is noted as stack-dependent (`noteStackDependentAnswer()`), and
   `BoxedFunction.type` keeps it under `_typeCacheFallbackGeneration()`.
   That key moves only with the `any` axis. No state event happens between
   the end of the assignment (or of the read) and the next read, so the next
   read is served `integer`.
4. The signature memo of `g` (`_deriveSignatureOnce()`,
   `boxed-value-definition.ts`) is keyed on the type of the literal by
   content, so it follows the cached body type.

The same mechanism gives a correct type for a self-recursive function: the
own call is left out while the function's own result type is computed, and
the result is its base case (`r := n ↦ If(n = 0, 1, r(n − 1))` is
`-> integer`). The cache cannot tell whether a stack-dependent type depends on
the own computation of the function (correct to keep) or on the computation
of another function (outdated after it ends).

## What was tried

The worktree `/tmp/wt-cebatch-1091` holds attempt 2; its patch is
`/tmp/cebatch-1091/attempt2.patch` (313 lines). Both are temporary.

- Attempt 1: a module epoch that every stack-dependent answer advances when
  the outermost cached computation ends (`runWhenIdle()`), mixed into the
  fallback key. All orders were correct, and the full suite had no new
  failure. Review: each top-level read of a call of a self-recursive function
  typed its body again (1000 reads of `fact(m).type`: 47 ms at HEAD, 340 ms).
- Attempt 2: the epoch advances only for an answer of another computation (a
  derivation frame above the owner's frame, or an assignment in flight). The
  self-recursive cost went back to HEAD (46.5 ms). Review found two high
  defects: for the pair, every top-level read still retires the types, so
  they are never cached (1000 reads of one `g(m)` node: 0.2 ms at HEAD,
  170 ms); and a sibling read inside one top-level computation is still
  served the outdated body type: `Tuple(f(m), g(m))` in the order fg is
  `tuple<integer | string, number>`, where HEAD gives the correct
  `tuple<integer | string, integer | string>`.
- Prototype of option (b) below: a call whose computation is not the
  innermost one is a value of any type. The pair is `unknown` in every order,
  but 9 tests fail: a self-recursive function is no longer typed by its base
  case (`ce-836-…test.ts`, "a recursive function is still typed by its base
  case"; `ce-479-…test.ts`). An assignment in flight cannot tell the call in
  the own body from the call in the body of another function.

## Options

(a) Retire precisely: record, for each stack-dependent type, the frames
(assignment or derivation) it depends on, and retire it when the first of
them ends, not when the outermost computation ends. Sound and precise for
the pair. Cost: a dependency record per cached cell, in the hottest code of
the engine (`BoxedFunction.type`, `cachedValue()`); size L; the cost of
repeated reads of the pair must be measured again.

(b) Lose precision for mutual recursion: leave a call out of a join only
when it is the own recursion of the function whose result type is computed
by the innermost computation. Needs a way for the assignment of `f` to tell
the body of `f` from the body of `g` (for example, the literal being typed
is pushed with the frame). Mutual pairs become `unknown`, also in the cases
that are precise today (`recursive-function-result-type.test.ts`, "a
mutually recursive pair is covered by the hypothesis": `list<number>`
becomes `unknown`), and a compiled program that calls such a pair can
decline. Size M. This changes the documented typing of mutual recursion
(`docs/TYPE-SYSTEM.md`, the precision loss of a mutual recursion).

(c) Record a known limitation and close: the witness is `crafted` (a
declared mutual pair with result types of different kinds, assigned in one
order). `docs/TYPE-SYSTEM.md` would state that the type of a call of one
function of a declared mutually recursive pair can leave out the values that
come from the base case of the other function, with this pair as the
example.

Recommendation: (c), because the witness is crafted and each sound fix costs
either precision for every mutual pair (b) or a dependency record in the
hottest cache of the engine (a). If a `corpus` or `plausible` witness
appears, (a).
