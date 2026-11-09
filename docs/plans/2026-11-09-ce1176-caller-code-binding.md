# CE-1176 option (a): caller code bound to locals on the GLSL target

**Status:** proposed 2026-11-09, waits for the user's approval. Issue
`issues/CE-1176.md`. It changes a documented contract
(`docs/COMPILATION-MODEL.md`, "Code that the caller supplies is held to the
interpreter's order"), so no code is written before the approval.

## The problem

Code that the caller supplies to a GLSL compilation (a `vars` entry whose
source is not a plain read, such as `nextValue()`; a `functions` entry that is
not known to be pure; an `operators` entry; a `compile` handler) can count its
calls or draw a number. Today the emitter writes it inline and declines a form
that would run it twice or ahead of earlier code. That decision depends on the
code the emitter writes (whether a statement is hoisted), which the fragment
pass cannot see. So `canCompile()` says yes and `compile()` declines for 9
expressions of the tests (`W + Max(V)`, `If(c, Max(V), 0)`, …). The checks
are about 400 lines (`gpu-draw-order.ts`, `operandsWrittenTwice()` of
`glsl-fragment.ts`, the call sites).

No GLSL record of Tycho's corpus has caller code (measured 2026-11-09 on
3,661 GLSL records: no `functions`, no `operators`, every `vars` entry a plain
read). All witnesses are `crafted`.

## The proposal

The prepare stage rewrites the tree before the pass types it. Each evaluation
of caller code becomes a local of its own, assigned in a statement before the
statement that uses it, in the order of the interpreter:

| Today | Proposed |
|---|---|
| `W + 1` → `nextValue() + 1.0` | `float _c1 = nextValue();` then `return _c1 + 1.0;` |
| `W + Max(V)` → declines | `float _c1 = nextValue(); vec3 _c2 = vec3(nextValue());` then the sum |
| `If(c, F(x), 0)` → `c ? myFn(x) : 0.0` | `if (c) { float _c1 = myFn(x); _t = _c1; } else { _t = 0.0; }` |
| `Cot(W)` → refused by the pass | `float _c1 = nextValue();` then `cos(_c1) / sin(_c1)` |

Then the emitter has no caller code to protect, and the order checks and
`operandsWrittenTwice()` go.

## Choices the issue does not settle, with the recommended answer

1. **Every expression with caller code becomes statements**, also the ones
   that compile today (`W + 1`). The `code` of such a result is a statement
   list ending in `return`, as for a loop-form `Sum` today. Recommended: yes;
   binding only where a hoist happens is the decision the pass cannot make.
2. **The same node at two places** (`W + W`, two reads of a `vars` key): one
   local per occurrence, as the interpreter evaluates each occurrence.
   Recommended: per occurrence (the rewrite makes a new local symbol for each).
3. **A lazy position** (an arm of `If` or `Which`, a condition after the
   first): the locals are assigned at the start of the branch, which takes the
   statement form. The right operand of `And` and `Or`, and a `Coalesce`
   fallback: rewritten to `If` first (`And(a, b)` is `If(a, b, False)` on the
   two-valued booleans of the fragment). Recommended: as written.
4. **A loop body** (`Sum`, `Product`, `Loop`) and a function literal body:
   the locals are assigned at the start of each iteration, in the body.
   Recommended: as written; a form the block machinery cannot write is refused
   by the pass, so `canCompile()` and `compile()` still agree.
5. **Caller code reached through a symbol value or a user function body**
   (`a := W + 1`, `g(x) := F(x) + 1`): the body of a user function that the
   emitter writes as a GLSL function gets the same rewrite, and a call of it
   counts as one evaluation of caller code at the call site. A symbol value
   is written in place, so its caller code is bound where it is read.
   Recommended: as written. The simpler alternative refuses these forms in the
   pass (new declines for `crafted` programs only).
6. **A route that skips the pass** (a GLSL target object passed as `target`):
   no rewrite and, after the checks go, no protection. Recommended: accepted,
   as for the other step 5 removals; the route is outside the GLSL contract.

## If this is not approved

The checks stay, `canCompile()` and `compile()` keep disagreeing on the 9
crafted expressions (listed in `docs/COMPILATION-MODEL.md`, known
limitations), and `gpu-draw-order.ts` keeps about 350 lines. Option (b) of the
issue (a copy of the hoisting rule in the pass) is not recommended.

## Measure and checks of the implementation

The GLSL test files (the tests of caller code change their expected code),
`npm run test:glsl` with 0 disagreements, the whole-corpus audit with 0
changed records (the corpus has no caller code), and the removed lines.
Size M.
