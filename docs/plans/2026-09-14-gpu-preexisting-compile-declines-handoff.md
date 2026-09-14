# Resolution: six pre-existing GLSL/WGSL compile-pin failures

**Status:** resolved 2026-09-14. **Found:** 2026-09-13, while widening the
shader test coverage during the conditional statement-form work. **Not caused
by that work** — see Provenance.

## Summary

Six tests that compile to a shader target failed. They were not one bug: they
fall into three independent clusters with three different causes. In every
cluster the source behavior is intentional (each was introduced on purpose by a
2026-09-12 change, with its own tests) and the pin was stale. No source file
changed; the three test files were updated so that each pin asserts the current
emission and still keeps the invariant it was written to protect observable.

## Provenance (why these were not from the statement-form work)

Running the three suites at `f7a45759` (the commit before the statement-form
session's first commit) showed the same six failures, and they persisted at
every commit since (`0dae996a`, `cf811af7`). They were invisible during that
session because the per-round shader test subset was 18 files and none of these
three were in it; two of them do not even contain a literal `to: 'glsl'` — they
compile through a `glslCode(ce, …)` helper.

## Reproduce (now green)

```
npx jest --config ./config/jest.config.cjs -w 2 --no-watchman -- \
  test/compute-engine/type-constructors-compile.test.ts \
  test/compute-engine/at-collection-index-compile.test.ts \
  test/compute-engine/list-valued-summand-compile.test.ts
```

## Cluster A — a Tuple of points compiles to the list-of-points array form

**File:** `test/compute-engine/type-constructors-compile.test.ts` — three pins:
"REFERENCE UNFOLDING …", "TUPLE-BODY CONSTRUCTOR …", "PARAMETERIZED NOMINAL …".

**Symptom.** Each pin built a tuple whose two components are themselves
two-component values — `Tuple(n, n)` for a nominal point `n: point`, and
`Tuple(q, q)` for a structural `q: tuple<number, number>` — and asserted the
GLSL emission is `DECLINE`. All three received `vec2[2](n, n)` /
`vec2[2](q, q)` instead: the list-of-points array form.

**Decision: the pins were stale.** Commit `a1f27a9d` (2026-09-12, "implement
comprehension unrolling for shader targets") added the array form through
`gpuUniformVectorWidth` in `gpu-target.ts`, and in the same commit it flipped
the sibling pin in `compile-glsl-structures.test.ts` from "a nested tuple fails
closed rather than emit vec2(vec2, vec2)" to "a nested tuple of points of one
arity is an array of vectors". `Tuple` and `List` share one GLSL/WGSL
constructor lowering (`compileGLSLList`, "Tuple compiles identically to List"),
and `gpuOperandShape` names `Tuple` alongside `List` when it answers `'array'`
for a written list of points. So a `Tuple` of same-arity points is meant to
lower as `vecK[N]`.

**What the pins assert now.** The nominal and the structural spelling emit the
same `vec2[2](…)`, which is the admissibility-does-not-change property the
tests exist for. The invariant "a `vecN` component must be a scalar" is kept
observable on the shape that still has no lowering: a tuple that mixes a
2-vector with a scalar (`Tuple(q, x)`, and the nominal `mixed(q, x)`) declines
at both spellings, while the same mixed body compiles to a plain array on
JavaScript.

## Cluster B — a positive scalar `At` index on a written-out list reads through under `constantFold: false`

**File:** `test/compute-engine/at-collection-index-compile.test.ts` — one pin:
"the JS route specializes positive scalar indices and keeps the gather helper".

**Symptom.** `compile(at(2), { constantFold: false }).code`, with
`at(2) = At(List(10, 20, 30), 2)`, was expected to contain `?? NaN` — the
guarded direct element access the JavaScript route emits for a positive scalar
index. It returns `20`.

**Decision: the pin was stale.** The rewrite is not the target's constant fold
(the `At` lowering in `javascript-target.ts` still gates its own cell fold on
`target.constantFold !== false`). It is the fixed-width pre-pass
(`foldLiteralIndex` in `fixed-width-unroll.ts`, the index push-through landed
2026-09-12), which rewrites `At(List(…), k)` to element `k` of the list before
any target sees the node. That rewrite is STRUCTURAL, not numeric: it also
rewrites `At(List(a, b, 10), 2)` to `b`. The pre-pass was written with
`constantFold: false` compilations in view — it builds structural nodes exactly
so that a numeric fold does not happen behind the flag — and it deliberately
still performs the index read, because the shader and interval targets have no
run-time list to index and every target prefers computing the one element.

**What the pin asserts now.** A literal-list base reads through to `20` under
`constantFold: false`; a symbol base whose value is a numeric list (which the
pre-pass leaves alone) still emits the direct `?? NaN` access with no `_SYS.at`
call; a gather index still uses `_SYS.at`. The existing pins in
`compile-array-index-facts.test.ts` already use a symbol base for the same
reason.

## Cluster C — a `(unknown) -> unknown` LIST-bodied helper is substituted at its call on the shader targets

**File:** `test/compute-engine/list-valued-summand-compile.test.ts` — two pins:
"the `-> unknown` control still compiles bare `a(u)` on glsl / on wgsl".

**Symptom.** `a` is declared `(unknown) -> unknown` with the body
`List(cos t, sin t)` and compiled as `a(u)` to a shader target. `success` is
`true`, but `preamble` is `undefined`, so the pin's match for the definition
(`vec2 _fn_a(float t)` on GLSL, `fn _fn_a(t: f32) -> vec2f` on WGSL) failed.

**Decision: the pin was stale.** The shader entry in `gpu-target.ts` calls
`inlineCollectionValuedCallsAtRoot(expr, target, 'list<any>')` (landed
2026-09-12): a call of a helper whose BODY type is a list, and whose every
argument is provably scalar by its type (here `u` is declared `number`; an
open-typed argument leaves the call by reference), is replaced by the helper's
substituted body, because a shader function cannot return a run-time list and
the fixed-width unroll cannot see the list's width through a call. The emitted
code is `vec2(cos(u), sin(u))` and no definition exists. A
TUPLE-bodied helper is not substituted (its type does not match `list<any>`)
and keeps its own shared definition, with the return type synthesized from the
body: `vec2 _fn_a(float t) { return vec2(cos(t), sin(t)); }`.

**What the pins assert now.** The List-body control asserts the substituted
`vec2(…)` / `vec2f(…)` code and that no `_fn_a` appears in the preamble. A new
Tuple-body control asserts the definition the old pin described, on both
targets. The contradicted `(number) -> number` declaration still declines at
definition emission for both body kinds (probed 2026-09-14).

## Cross-cutting: the detection gap that hid these

The per-round shader test subset (18 files) missed about 34 other GLSL/WGSL-
targeting test files, including all three above. For any change to
`gpu-target.ts`, `glsl-target.ts`, `wgsl-target.ts`, or the shared compile
path, run every shader-targeting test file, or the full suite under the box
lock, rather than a narrow subset — a narrow subset is not certification of a
shader-emission change. A static file list goes stale; regenerate the wide
list from the sources instead:

```
grep -lE "'(glsl|wgsl)'|GLSLTarget|WGSLTarget|glslCode\(" \
  test/compute-engine/*.test.ts
```

## Related

The `ROADMAP.md` entry "Six GLSL/WGSL compile pins fail …" that grouped these
was removed on 2026-09-14 when all three clusters were resolved.
