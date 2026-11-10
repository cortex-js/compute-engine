# Structured representation: `Break`

**Status: design for the first change after step 7, first part, of the
[JavaScript compiler plan](2026-11-09-js-compiler-status-and-plan.md). The
user approved the work on 2026-11-10; the choices marked "choice" were made
by the agent and can be reversed.**

`Break` blocks 10 of the 23 prelude functions that the `numeric-kernel`
profile declines (the census in the plan). This note adds it to the
structured representation of
[step 6](2026-11-10-structured-ir-loops-and-lists.md).

## The witnesses

All are in Tycho's showcase preludes (`template-data.js`,
`showcase-othello.js`), so each is a `corpus` witness.

```
// B, M, J: the escape test of a fractal
for k in 1..128 { s = a^2 + b^2; if s > 65536 { break }; n = n + 1; … }

// hasmove, choosecell, step: a write, then the exit
for k in 1..64 { …; if count > 0 { found = true; break } }

// choosecell: the exit two branches deep
if count > 0 { n = n + 1; if n == rank { cell = k; break } }

// ray: one branch continues, the other always exits
if v == -p { n = n + 1 } else { if v == p { found = n }; break }
col = col + dx
```

In each one `Break` has no value, it is the last statement of a branch of an
`If` statement, and it leaves the innermost loop. After the loop, each local
has the value it had at the `Break`.

## The operation

**`exit`** (choice): a second way to end a region. Its operands are the
value, at that point, of each carried value of the loop it leaves, in the
order of the results of the loop. The result `i` of a loop is then the value
`i` of the last yield of its body, the operand `i` of the `exit` that ended
it, or the initial value when the range has no element. An `exit` defines no
value and has no effect.

A region is **closed** when its last operation is an `exit`, or an `if`
whose two branches are closed. Every other region is **open** and ends in a
yield, as today.

- An `if` with one closed branch takes its results from the open branch
  only. The closed branch yields nothing.
- An `if` with two closed branches has no result and is the last operation
  of its region.
- An `exit` leaves the innermost loop. Between the `exit` and the body of
  that loop there are only branches of `if` operations: no region of a
  `build`, of an `and` or `or`, and no branch of an `if` that is a value.
- The body of a loop is open: a loop whose body always exits declines.

Each value keeps one definition: the `exit` passes values to the results of
the loop exactly as a yield does, so no local is a variable in the
representation.

**The alternative, not taken:** no new operation. The lowering carries a
boolean "stopped", each `if` that holds a `Break` gives it as one more
result, and the statements after such an `if` go under `if not stopped`. The
loop then needs a condition to continue. The representation stays without
early exits, which makes every analysis simpler, but the emitter must find
the pattern again to write a `break` statement, or the compiled code tests a
flag at each pass. JavaScript, GLSL, WGSL and Python all have `break`, so
the `exit` operation maps to each of them directly. The same operation with
the function body as its target is a later `Return`.

## What each part does

| Part | Change |
| --- | --- |
| Admission (`javascript-fragment-target.ts`) | `Break` with no operand is admitted as the last statement of a branch of an `If` statement, or of a block that is such a branch, inside a `Loop`. Declined: a `Break` that is a direct statement of the loop body, a statement after an `If` whose two branches always exit, a `Break` in a value. Each is `crafted`: no witness has it. |
| Lowering | A branch that ends in `Break` ends in `exit` with the current value of each carried local. The results of the `if` come from the open branch. |
| Verifier (core) | The rules above: place, target loop, count, order, type and representation of the operands against the results of the loop; no operation after an `exit`; open and closed regions. |
| Emitter | `name = value; … break;` with the order rule that the yield of a loop body already has (each value is read before a carried variable is assigned). An `if` with a closed branch assigns its results in the open branch only. |
| Update in place | An operand of an `exit` is a use, as an operand of the yield of the loop body is. After an `exit` the only later uses of a value are those of the results of the loop. |
| Execution analysis | A loop that holds an `exit` is not a candidate for parallel iterations: the number of passes depends on the earlier passes. The answer names the `exit`. `pure`, `shippable` and `canAbort` do not change. |

## Checks

- For each witness above, and for `B`, `M`'s loop without its `Power(s, d/2)`,
  `ray`, `hasmove` and `choosecell`: the values equal the existing compiler's
  exactly, on inputs that exit at the first pass, at a middle pass, at the
  last pass and never, and on a range with no pass.
- A loop inside a loop: the `exit` leaves the inner loop only.
- A list carried by a loop with an `exit`: the update in place stays correct
  (the host's array is not written, and the result is the list at the exit).
- The iteration budget counts the passes that ran.
- The verifier refuses each malformed form with its own test.
- The prelude census is run again; the plan records the new count.
