# Call-specific result types and shared helpers

A user function's declaration describes every call it accepts. A particular
call can have a more precise result. For example, a function accepting a point
or a list of points can return one point when both arguments are points,
without removing the list alternatives from its declaration.

The engine derives that result by walking the function body with descriptors
for the actual argument types. Straight-line declarations, assignments,
returns, and indexed sums/products carry those types through the body. The
walk uses operator type handlers and never evaluates a value or changes a
parameter definition. Calls that may broadcast over collection arguments,
recursive calls, rest/destructuring parameters, and unsupported control flow
keep their existing conservative result. This also applies to nested user
calls: their per-element list semantics must not be replaced by binding the
list whole. Results are cached by literal, argument types, and engine
generation, including the assumption context.

Compilation uses private function literals with narrower parameters to emit
shared helpers for supported scalar and point calls. The original definition
is unchanged. Point helpers are shared per argument representation, while
scalar helpers retain the existing broadcast-aware call boundary and
last-call memoization. JavaScript specializes scalar arguments only when the
compiler has evidence that they are scalar at runtime; a type inferred from
use alone is insufficient. Dynamic list calls retain their existing handling.
Functions that assign to their parameters use the original compile path, so
specialization cannot turn
an unannotated assignment target into an enforced type annotation.
GLSL and WGSL use the same parameter types for helper declarations and calls.

An operator compilation handler can read `context.typeOf(expr)` for facts
established by the target's local bindings. This does not change `expr.type`.
For example, a shader local assigned a scalar helper call can supply a scalar
coordinate to `PointList` even when its stored type remains
`broadcastable<number>`.

## Tycho verification

The regression file `test/compute-engine/tycho-items-275-289-call-shapes.test.ts`
covers item 289's point-or-list call, retained-local witness, signature
preservation, dynamic list inputs, argument evaluation count, and a numeric
function chain through a finite sum. Existing GPU and point-call tests cover
shared definitions, recursion refusals, and unsupported collection shapes.

Tycho's own item 289 probe was run through `resolveCECompile` with a temporary
module loader selecting this checkout. Both JavaScript and GLSL compile the
scalar witness with a shared helper, and the list call remains valid. This is
source verification; Tycho's installed package was not replaced.

A CORE code-generation audit compared the starting CE source at `7a6dd213`
with this change on the same Tycho tree: 766 records, three changed code
records, no new or resolved declines. JavaScript `_SYS.bcast(` occurrences
fell from 245 to 206; the `hyvhlz4chj` colour kernel accounts for the reduction
(58 to 19). Its JavaScript output shrank from 9,649 to 8,101 characters and its
GLSL output from 8,517 to 7,696. These counts include emitted helper bodies;
they are not frame-time measurements. Runtime dispatch remains where the
compiler has no proof of a scalar or fixed-width value. Published-package
adoption and Tycho's own tracker closure remain consumer verification steps.

## Local validation

The final checkout passes typecheck (including Epsil, type pins, dependency
cycles, and public type checks), 1,331 tests across 23 affected suites, and all
31 MCP tests with localhost access. Source/test fingerprints match before and
after the final regression run. The initial full run passed 34,874 tests and
4,254 snapshots; its 28 failures were resolved or covered by passing follow-up
runs, including the sandbox-blocked HTTP tests and the concurrent fix for
absence-arm inference. No performance timings from the contended runs are
used here.
