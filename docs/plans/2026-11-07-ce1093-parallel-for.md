# `parallel for`: a parallel loop and comprehension for Epsil, compiled to a WGSL compute shader

**Status:** approved by the user on 2026-11-07, with every recommendation of
§7. **Suspended on 2026-11-08:** the user dropped the WGSL target
(`docs/plans/2026-11-08-glsl-fragment-spec.md`, status line), so the
compute-shader backend of this plan is withdrawn. The construct (§2) and its
rules (§3) stay. The backend is the JavaScript worker pool (approved
2026-11-08): its design is `issues/CE-1163.md` (`runAsync()` on a
compiled result), which replaces step 2 of §8 and waits for its own
approval. On the `glsl` target a `ParallelLoop` with scalar local
accumulators inside a function body compiles as a counted loop in order
(section 2 of that spec).
**Issues:** CE-1093 (the Epsil construct) and CE-1075 (the WGSL compute
shader). Witness strength: `corpus` (Tycho showcase entry `buddhabrot`).

## 1. Problem

Tycho's `buddhabrot` step (`~/dev/tycho/src/graph-paper/onboarding/template-data.js`,
prelude function `step`) runs `n` passes. Each pass computes one orbit and adds
1 to each cell of the list `L` that the orbit crosses:

```epsil
for k in 1..n {
  … compute the orbit of sample k; for each cell c that it crosses:
  L = replaceAt(L, c, L[c] + 1)
}
```

The passes are independent, and the order of the additions has no effect on the
result. Epsil cannot state this, and the engine cannot prove it, so the step
runs on one CPU core. A compute shader written by hand (one invocation per `k`,
`atomicAdd`) ran 500,000 samples in 0.9 to 1.1 ms, against 87.5 to 91 ms for
JavaScript (CE-1075; Tycho `roadmap/BUDDHABROT_CODE_STUDY.md` § 7).

## 2. The construct

One keyword, `parallel` (reserved today and not in use,
`src/epsil/reserved-words.ts`), is put before `for` in two places.

**The statement.** The value is `nothing`, as for `for`:

```epsil
parallel for k in 1..n {
  … the locals of pass k …
  L[c] += 1          // the only kind of write to an outer variable
}
```

**The comprehension clause.** The result is a list with one element for each
element of the domain, in the order of the domain:

```epsil
[f(k) parallel for k in 1..n]
```

**`+=` (new everywhere).** Epsil has no compound assignment today
(`src/epsil/docs/declarations.md`). Outside a parallel loop, `s += e` is
`s = s + e`, and `L[i] += e` is `L[i] = L[i] + e`. Inside a parallel loop, it
adds a contribution to an accumulator (rule 2). The same spelling in both places
lets a program change a `for` into a `parallel for` by adding the keyword.

## 3. Rules (static checks of the Epsil checker)

1. **Writes.** The body can declare and change its own locals. It can change a
   variable declared outside the loop only with `+=`. Any other assignment to an
   outer variable, including `L[c] = v` and `L = replaceAt(…)`, is an error.
2. **Accumulators.** A variable that the body changes with `+=` is an
   accumulator. The body cannot read an accumulator: `L[c] += L[d]` and
   `if s > 3 { … }` are errors. This is the rule of the Dex language, and it
   makes the result the same for any order of the passes.
   **How rule 2 is enforced (decided by the user on 2026-11-07).** A
   static check cannot be sound: a pass can reach a variable through a
   called function, `parse("s")`, `symbol("big")` given to `count`, a
   library higher-order function, or host code. Two static designs (one
   that followed called functions by name, then an allow-list of calls)
   were reviewed and each had such holes; a run-time guard in the
   interpreter was reviewed next, and it had holes and false errors in the
   engine's caches, closures and analyses. So a read of an accumulator in a
   pass has an **unspecified value**, as a data race has in OpenMP. `epsil
   check` reports a read written by name in the pass. The interpreter and
   the JavaScript target give the value of the passes in order. A target
   that really runs the passes in parallel (the WGSL compute shader of
   step 2, workers later) declines a pass whose code reads an accumulator:
   its compiler sees every line it emits, so that check is sound.
3. **Accepted targets of `+=`:** a variable (`s += e`), or an element of a list
   with the index forms that `L[i] = v` accepts (`L[i] += e`).
4. **Effects.** The inferred effects of the body must be a subset of
   `{random}` (the effect labels of `src/epsil/docs/control-flow.md`). `Print`
   (`console`), `state` and the others are errors. The check uses the
   engine's effect inference, so it has the limits of that inference: a
   function that calls an unannotated parameter is inferred pure
   (`docs/EFFECTS-MODEL.md`, decision (c)), and CE-1106.
5. **Control flow.** No `break`, `continue` or `return` leaves the parallel
   loop. An inner loop of the body can use `break` and `continue`.
6. **Comprehension.** The body of a parallel comprehension writes no outer
   variable at all. Only the first clause can be `parallel`; the other clauses
   run in order inside each pass. An `if` guard is accepted (but see §6).

## 4. Meaning (the interpreter)

A `parallel for` gives the same values as the `for` loop with the same body,
with three differences:

- **Accumulators.** Each pass adds its contributions. The final value is the
  value before the loop plus all the contributions, in some order. With exact
  numbers (integers, rationals) the result does not depend on the order. With
  machine floating-point numbers, it can differ in rounding.
- **Random numbers.** Today `Map` and comprehension bodies draw in iteration
  order from one frame (`docs/RANDOMNESS-MODEL.md` §5). In a parallel loop, each
  pass draws from its own frame. Inside a `WithRandomSeed` frame, the loop
  consumes exactly 1 index `b` of the enclosing frame, and pass `k` (its
  position in the domain, from 1) gets a frame whose seed is derived from the
  enclosing seed, `b` and `k` by a fixed function. That function is added to
  §3 of the randomness model, with test vectors. Then the values do not depend
  on how the passes are distributed. Outside a frame, draws are live, as today.
  This holds for the direct draws of a pass (`s += random()`). The draws of
  a lazy view that draws inside a pass (`[random() for j in 1..2]`) are
  unspecified (decided by the user on 2026-11-07): the interpreter caches
  a view per instance (randomness model §6), and two designs that gave
  each pass its own cache had holes in other caches of the engine.
- **Evaluation order is not specified.** The interpreter runs the passes in
  order, and a later version can split them over workers.

## 5. MathJSON and LaTeX

- `parallel for x in xs { b }` → `["ParallelLoop", b, ["Element", "x", "xs"]]`
  (the sequential form is `["Loop", b, ["Element", …]]`, `src/epsil/parser.ts`).
- `[e parallel for x in xs …]` → `["ParallelComprehension", e, …clauses]`.
- `t += e` → `["AddTo", t, e]`, where `t` is a symbol or an `At` form.

The three names are not in use in `src/`. A separate head, not an option on
`Loop`, makes each handler of `Loop` that does not know the new rules fail
closed. The LaTeX form of each head is chosen in the implementation and has a
round-trip test.

## 6. Targets

| Target | `parallel for` | parallel comprehension |
|---|---|---|
| Interpreter | Passes in order; rules of §4 | Same |
| JavaScript compile | A sequential loop with the frames of §4 | Same |
| WGSL | `WGSLTarget.compileKernel()` (below) | Same function; each invocation writes its own element |
| Worker pool | Not in this spec. A later item, only when a measurement shows the need (Tycho's workers study, § 8 of the code study, is in progress) | Same |

**`WGSLTarget.compileKernel(loop, options)`** takes a `ParallelLoop` or
`ParallelComprehension` expression. The host declares each free variable of the
expression, in the style of `compileFieldFunction()` (`wgsl-field-function.ts`):

- an accumulator: its element type and length → a `read_write` storage buffer;
- a list that the body only reads → a `read` storage buffer;
- a scalar or a point → a field of one uniform struct.

The result is the WGSL text with an `@compute` entry point, the workgroup
size, the table of bindings (group, binding, kind, type, length), and the
number of invocations as a function of the range bounds. Invocation `i` runs
pass `k = a + i` and does nothing when `k > b`. The host makes the buffers,
dispatches and reads back. The statements before and after the loop in the
witness (`let L = H`, `L[90001] = r + n`) stay in the host program.

**What declines on WGSL in the first version**, with a diagnostic that names
the reason:

- a domain that is not an integer range `a..b`;
- an accumulator whose element type is not `integer`: WGSL has `atomic<T>`
  only for `i32` and `u32`. A `real` accumulator needs partial sums for each
  workgroup or a compare-and-swap loop. That is a later item, done for a
  witness. (The witness declares `H: list<number>`. It holds counts, so Tycho
  declares it `list<integer>`.)
- a parallel comprehension with an `if` guard (the length of the result is
  not known before the run);
- a pass whose code, including the user functions it calls, reads an
  accumulator (§3: the interpreter gives such a read an unspecified value;
  a parallel run must not give one);
- everything in the body that `compile(…, { to: 'wgsl' })` declines in a block
  today.

A decline falls back to the interpreter or to the JavaScript target, as for
every other compilation.

## 7. Decisions in this spec (each one with its alternative)

| Question | Recommendation | Alternative, and what it costs |
|---|---|---|
| `parallel map`, `parallelSum`, … | **No.** A `map` whose callback has no effect already has an order-free meaning, so an engine can parallelize it with no new syntax. When a program must request parallel evaluation, `[f(x) parallel for x in xs]` says it. | Parallel copies of library functions (Mathematica `ParallelMap`, Maple `Threads:-Map`): each function needs a second name and a second set of tests. `parallel map(f, xs)` as a prefix: a keyword in front of a call, which has no meaning for most functions (`parallel sort(xs)`). Both can be added later without breaking a program. This spec does not run a plain `map` in parallel: that needs a rule that decides when it is worth it (the domain is finite and materialized, the callback has no effect, a worker pool exists, and the work is large enough), which is a separate item. |
| Comprehensions | **Yes**, as the clause `parallel for` inside the brackets. | The prefix `parallel [f(x) for x in xs]`: the phrase is then different from the statement, and a comprehension with two clauses cannot say which clause is parallel. |
| A parallel pipe `\|\|>` | **No.** A pipe stage is any function; a parallel meaning exists only for the element-wise map of a lambda stage, so `xs \|\|> sort` has none. `\|\|>` and `\|>` differ by one character, and `\|\|` is the logical OR (`a \|\| b \|> f` is documented in `control-flow.md`). | A pipeline with a heavy element-wise stage is written as a parallel comprehension. `\|\|>` can be added later, when a witness needs it. |
| `+=` outside a parallel loop | **Yes**, as `s = s + e`. | `+=` only inside `parallel for`: an operator that exists in one place only. |
| Accumulator operators | **`+=` only.** | `min`/`max`/`*` accumulators (WGSL has `atomicMin`/`atomicMax` for integers): added for a witness. |
| Effects in the body | **`random` only.** | Accept `console` (`Print`) in the interpreter: the output order is then not specified, and WGSL must decline it. |
| Declared accumulators (Chapel `with (+ reduce s)`) | **No.** `+=` already shows the operator and the variable. | A header clause is more explicit for the reader, and longer. |

If a decision is not made, nothing is built: CE-1093 and CE-1075 stay in
`needs-design`, and the witness runs on one core.

## 8. Steps and definition of done

1. **Language and interpreter:** the parser, `+=`, the three heads, the rules
   of §3 with an error code each (`src/epsil/error-explanations.ts`), the
   frames of §4 (`docs/RANDOMNESS-MODEL.md` §3 and §5 with vectors), the
   JavaScript target, the Epsil pages (`control-flow.md`, `syntax.md`,
   `declarations.md`; `parallel` leaves the reserved list in `epsil.md`), and
   `docs/EPSIL-LANGUAGE-MODEL.md`. Tests: each rule, an error for each check,
   the same accumulator values as the `for` form of the witness, random values
   that do not depend on the domain split.
2. **WGSL:** `compileKernel()`, integer accumulators, comprehensions, the
   declines of §6. Tests: the emitted text, the bindings, each decline. Done
   when the witness step, with `L[c] += 1` and `H: list<integer>`, compiles,
   and the Tycho probe `scripts/repros/2026-11-07-buddhabrot-webgpu-probe.mjs`
   gives the same counts as the interpreter on 5,000 samples, up to the
   `f32` escapes that CE-1075 records (2.9 % median difference per cell).
3. **Public pages:** the Epsil and compile guides in
   `~/dev/cortexjs.io/docs/compute-engine/`, and a CHANGELOG entry.

## Appendix: what other languages do

Rows marked † were checked on the web on 2026-11-07; the others come from
general knowledge and were not checked.

| Language | Form | What the body can do with shared state |
|---|---|---|
| Fortran 2023 † | `do concurrent (i=1:n) reduce(+:s)` | Only `s = s op expr`; each pass starts from the identity; the results are combined at the end |
| Chapel | `forall i in 1..n with (+ reduce s)`; `+ reduce A` | Only the declared reduction |
| OpenMP | `parallel for reduction(+:s)`; array sections since 4.5; `atomic` | Declared reductions or explicit atomics |
| MATLAB | `parfor`; `accumarray` | Each variable is classified (sliced, reduction, temporary, broadcast); others are refused |
| Dex † | `for` with `runAccum` and `y += x.i` | An accumulator has no read |
| Taichi † | The outermost `for` of a kernel; `s[None] += x[i]` | `+=` is a reduction; no `break` in a parallel loop |
| Futhark † | `hist` (older name `reduce_by_index`) | A function only; the operator must be associative and commutative |
| NumPy, JAX | `np.add.at`, `np.bincount`; `x.at[i].add(v)` | Functions only |
| Haskell | `accumArray`; Accelerate `permute` | Functions only |
| Mathematica | `ParallelSum`, `ParallelTable`, `ParallelMap`, `ParallelDo`; `SetSharedVariable` | Parallel copies of the sequential functions; shared variables are slow and can race |
| Maple | `Threads:-Add`, `Threads:-Map`, `Threads:-Seq` | Parallel copies of the sequential functions |
| Julia | `Threads.@threads for`, `@distributed (+) for` | Not checked: a race gives a wrong value |

What this spec takes from them: a write to shared state is one associative,
commutative operation, and the body cannot read the value (Fortran, Chapel,
MATLAB, Dex); a fixed, small set of operators; no `break` (Taichi); the loop
form, because a histogram function (Futhark `hist`, `np.bincount`) needs the
flat list of indices first, and the witness gives a different number of cells
for each sample.

Sources: [Intel Fortran `DO CONCURRENT`](https://www.intel.com/content/www/us/en/docs/fortran-compiler/developer-guide-reference/2025-2/do-concurrent.html),
[Futhark histograms](https://www.futhark-lang.org/examples/histograms.fut),
[Dex, arXiv 2110.07493](https://www.arxiv.org/pdf/2110.07493),
[Tour of WGSL, atomic types](https://google.github.io/tour-of-wgsl/types/atomics/atomic-types),
[Taichi performance](https://docs.taichi-lang.org/docs/master/performance).
