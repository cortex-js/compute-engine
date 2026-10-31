# Plan: split `base-compiler.ts` and `gpu-target.ts` into modules

Date: 2026-10-30. Written by the session that measured the two files at
commit `cca0280f4` with uncommitted peer edits present. The user decided on
2026-10-30: do the split, and an API change is acceptable (the `BaseCompiler`
facade does not have to stay for internal callers). Later the same day the
user chose design (C) for the recursive core (section 4.3) and step 5
(`gpu-target.ts`) as the first step, because it is the simplest.

## 1. What the files are

All numbers were measured on 2026-10-30 at `cca0280f4` plus the working tree.

| Fact | `base-compiler.ts` | `gpu-target.ts` |
| --- | --- | --- |
| Lines | 52,435 | 23,599 |
| Lines on 2026-10-01 | 5,157 | not measured |
| Structure | 3,194 lines of helpers, then one class `BaseCompiler` | 358 top-level items: 233 functions, 106 constants, 1 class |
| Members of the class | 855, all `static`; `this.` appears 3 times; no subclass | `GPUShaderTarget`: 18 methods, 2,625 lines, normal instance class |
| Members used by other files | 217 distinct (javascript-target 111, gpu-target 79, python-target 77, interval-javascript-target 50, types.ts 33) | 68 exported items; importers: glsl-target, wgsl-target, wgsl-field-function, index.ts, `src/compile.ts`, `src/compute-engine.ts` |
| Private members | 629 | not applicable |
| Calls between members | 1,756 | small: the largest mutually recursive group is 3 functions, 71 lines |
| Largest mutually recursive group | 198 methods, 24,704 lines | none that matters |
| Members that call no other member | 250 methods, 8,310 lines | most of the file |
| Largest single items | `tryCompileBroadcast` 1,666; `compileExpr` 1,102; `compileBlock` 1,001; `analyzeReferences` 896; `compile` 750 | `GPU_FUNCTIONS` 2,531; shader preamble strings (Lerch, zeta, color, complex) about 3,700 together; `GPU_COMPLEX_FUNCTIONS` 690 |

`BaseCompiler` is a namespace of static functions, not an object. The four
target files call it as `BaseCompiler.x(...)`; none extends it. The name is
public API: `src/compute-engine.ts` and `src/compile.ts` export
`BaseCompiler`, and `compilation/index.ts` exports it as `compile`. The public
documentation (`src/api.md`) names one member, `BaseCompiler.isEmissionSkippable`.

The size does not cost type-check time: the whole project checks in about
0.4 s with the native compiler. The costs are: several sessions edit one file
at the same time, so staging goes hunk by hunk; an agent cannot read the file
whole; and every compilation change lands in the same file and collects every
merge conflict.

## 2. Constraints

1. **No circular file imports.** `npm run check:deps` (madge) must stay clean.
   It is clean today. The 198-method recursive core cannot be cut into several
   files as plain functions: the `compileExpr` dispatcher calls about 35 topic
   handlers, and those handlers call `compile`, `compileExpr`,
   `compileValueOperand`, `compileOp` and `isComplexValued` back. Section 4
   gives the design that removes the cycle.
2. **Behaviour does not change.** Every step is a move. The gates are: the
   type check, `check:deps`, the full test suite with unchanged snapshots, and
   a diff review that finds only moved code and import lines.
3. **Timing.** Peer sessions have uncommitted edits in `base-compiler.ts`,
   `gpu-target.ts`, `javascript-target.ts`, `python-target.ts` and
   `interval-javascript-target.ts` right now. A move of thousands of lines
   makes such hunks impossible to apply. Each step runs right after the
   pending compilation work is committed, in one session, while no other
   session edits `src/compute-engine/compilation/`. The session announces this
   to the peers first (the box protocol's message channel) and takes the box
   lock for the move.
4. **Public API.** The exported name `BaseCompiler` stays exported from
   `src/compute-engine.ts`, `src/compile.ts` and `compilation/index.ts`, as a
   facade that holds the members that `src/api.md` documents (today one:
   `isEmissionSkippable`) and any member a consumer is known to call. Every
   internal caller imports the function from its module instead. The user
   accepted this API change on 2026-10-30.

## 3. Steps

Each step is its own commit, with its own review. Steps 1 and 2 are
mechanical; a `mechanic` agent can do them from this recipe. Step 3 needs
the design in section 4 first. Step 5 is independent of steps 1 to 3.

### Step 1: leaves and pre-class helpers (about 11,500 lines leave the file)

Move the 250 methods that call no other member of the class, and the 3,194
lines of helpers before the class, into topic modules. The exact set is
re-derived at the time of the move (section 6). Suggested modules, named like
the existing siblings (`javascript-value-facts.ts`, `kind-lowering.ts`):

- `compiler-naming.ts`: temporaries and identifiers (`tempVar`, mangling).
- `compiler-type-facts.ts`: questions about declared and inferred types that
  need no emission (`isRealScalarAscription`, lane and component counts).
- `compiler-emission-helpers.ts`: text helpers that produce target source
  from already-compiled operands.
- `compiler-diagnostics.ts`: decline messages and their formatting.

Rewrite the internal calls with `ast-grep`: `BaseCompiler.x($$$)` becomes
`x($$$)` and the module gets an import line. Assert the match count before
`-U`. In the four target files, rewrite the same way and add the imports.
`BaseCompiler` keeps a static forwarder only for the members in constraint 4.

### Step 2: the layered part (about 16,000 lines leave the file)

The methods that are neither leaves nor in the recursive core (about 278
methods) sit in small groups with an acyclic dependency order. Move them by
topic, from the lowest layer up, so each new module imports only modules that
already exist. Candidate topics, from the method names: constant folding
helpers (`fold*`, 15 methods), declarations (`declare*`, 12), checks
(`check*`, 15), records and collections, hoisting (`hoist*`, 5), CSE glue
(`cse*`, 6), the broadcast analysis that `tryCompileBroadcast` does not need
recursively. Run `check:deps` after every module.

### Step 3: the recursive core (24,704 lines)

Design in section 4. After steps 1 and 2 the file is about 25,000 lines; after
step 3 the largest module is the dispatcher, about 2,000 lines, and the
largest topic module is the broadcast compiler, about 3,500 lines.

### Step 4: remove the class

When no internal caller uses `BaseCompiler.x`, the class body is the facade of
constraint 4. Its file keeps the name `base-compiler.ts` so the public export
paths do not change.

### Step 5: `gpu-target.ts` (independent, mechanical)

No recursion problem. Move:

- the shader preamble strings (`GPU_LERCH_PREAMBLE_GLSL`, `..._WGSL`,
  `GPU_ZETA_PREAMBLE_*`, `GPU_COLOR_PREAMBLE_WGSL`) to `gpu-preambles.ts`
  (about 3,500 lines);
- `GPU_FUNCTIONS` and `GPU_COMPLEX_FUNCTIONS` to `gpu-functions.ts` (about
  3,200 lines);
- `GPUShaderTarget` to `gpu-shader-target.ts` (2,625 lines);
- the free functions by topic: finite proof (`gpuFiniteProof` and its
  helpers), operand shape checks (`gpuCheckOperandShapes`), the `At`, `Sum`
  and `Product` lowerings, the GLSL/WGSL type mapping.

`compilation/index.ts` does `export * from './gpu-target.js'`, so
`gpu-target.ts` re-exports what the new modules export, and no importer
changes.

**Rehearsed 2026-10-30** at commit `3bb738928` in a detached worktree, with a
split script that moves whole statements by name (the script and its
configuration are in the session's scratchpad; the user decides whether they
go into `scripts/`). Result: 19 modules in an acyclic order found by the
script (gpu-emit, gpu-reserved, gpu-complex-functions, gpu-preambles,
gpu-declared-types, gpu-shapes, gpu-finite-proof, gpu-nan-safe,
gpu-draw-order, gpu-library, gpu-statements, gpu-points, gpu-color, gpu-at,
gpu-extrema, gpu-reduce, gpu-random, gpu-functions, gpu-shader-target) and a
facade `gpu-target.ts` of about 90 lines. The largest modules: gpu-preambles
5,132 lines, gpu-functions 4,064 (`GPU_FUNCTIONS` with `compileGPUAt` and
`compileGPUSumProduct`, which recurse through the table), gpu-shader-target
3,019. Type check, oxlint and madge clean; all 367 statements present once
and unchanged apart from an added `export`; 318 compile/GPU test files:
11,479 passed, 1 failed, and the one failure
(`tycho-item-216-compile-inline-point-parameter.test.ts`, interval-js) fails
the same way at `3bb738928` without the split. About 13,000 lines leave the file in the first three moves alone.

## 3b. Rehearsal of steps 1 to 3, in one move (2026-10-30)

A second script, `split-class.mjs` (same scratchpad as the gpu one), splits a
file that consists of top-level statements plus one class of static members.
It was rehearsed at commit `3bb738928` in the same worktree as the
gpu-target.ts split. What it does, and what the rehearsal found:

- **Members become free items.** A static method becomes `export function`,
  a static getter a function whose reads `Class.g` become `g()`, a static
  property that nothing assigns an `export const`. The 50 static properties
  that some member assigns (the compile mode, memos, budgets, frames) stay
  static fields, on the class `CompilerState` in `compiler-state.ts`: a
  field of an imported class can be assigned from any module, an imported
  `let` cannot. A top-level `let` assigned from another module gets the same
  treatment (none needed it after layering).
- **Hubs and the hooks record.** 29 hubs (section 4.1's 17, plus 7 that the
  layering kept moving between modules, `_compileInner`, `compileWithCse`,
  and 3 that tests replace with `jest.spyOn`: `ensureSpecializedUserCallEmitted`,
  `pruneUnreferencedVariantBases`, `hasCodeOverride`). Every call to a hub,
  from any module including the core itself, goes through `core.<hub>` of
  `compiler-core-hooks.ts`, so the record is the one seam: a test that
  replaces `core.compile` sees every call. Before the core loads, each hook
  is a stub that throws a message naming the module to import.
- **The facade loads the core.** `base-compiler.ts` imports
  `compiler-core.js` for its side effect (nothing else imports it) and
  forwards every member of the old class: a hub as an accessor pair onto
  `core`, a state field as an accessor pair onto `CompilerState`, the rest as
  `static readonly x = x`. It forwards the private members too, because 14
  of them are called by tests through `(BaseCompiler as any)` and
  `BaseCompiler['x']`. Trimming the facade to the documented members is
  step 4, after the external call sites import from the modules.
- **Layering.** 45 modules (section 4.4's list grew while assigning the 862
  members; the names are in the configuration). The script suggests a layer
  order by a minimum-feedback-arc-set heuristic over the preferred
  assignment, and then repairs the remaining upward references by moving
  items (152 items, 6,011 lines, from a hand assignment of 980 items). The
  largest modules after the move: compiler-core.ts 5,717 lines (the 29 hubs),
  compile-absence.ts 3,160, compile-user-functions.ts 2,765, compile-cse.ts
  2,394, compile-folding.ts 2,237, the facade 2,230; the median module is
  about 900 lines.
- **Checks.** Type check, oxlint and madge clean. A statement-level
  comparison finds every one of the 955 original items once; 32 differ only
  in prettier's line breaking after the move (parentheses around a
  multi-line `return`, a leading `|` of a union), which was inspected.
- **Tests that the move changes**, kept as a patch beside the scripts:
  four tests spy on `BaseCompiler.compile`, `ensureSpecializedUserCallEmitted`,
  `hasCodeOverride` or `pruneUnreferencedVariantBases` and now spy on
  `core`, because jest replaces an accessor's getter and never reaches the
  callers (`item-279-range-gather-reduction`, `ce-564-inline-invalid-substitution`,
  `compile-invariant-prefix`, `compile-lane-agreement`); `effects-seam` lists
  the importers of the function-literal builder and now names
  `compile-locals.ts` instead of `base-compiler.ts`. With those edits the
  full suite in the worktree, with both splits applied, gives 73,069 tests
  passed, 4,280 snapshots unchanged and one failure, the pre-existing
  `tycho-item-216` one.
- **Two scripts, three hazards found.** A parameter named like a hub
  (`compile`) was first read as a reference to it; the import filter first
  counted a shadowing parameter as a use of an import; and a cleanup glob
  deleted the tracked `compile-expression.ts` in the worktree (restored from
  HEAD). The scripts now resolve identifiers against locals and refuse to
  write over a tracked file.

## 4. Design for the recursive core

### 4.1 The cycle

Greedy removal of the most-called members shows that the 198-method group
becomes acyclic when 17 members are taken out (3,711 lines together). The
members that matter, with the number of core members that call each:

| Member | Callers in the core | Lines |
| --- | --- | --- |
| `compile` (entry: constant fold, CSE, then `compileExpr`) | 59 | 750 |
| `isComplexValued` | 53 | 117 |
| `compileValueOperand` | 28 | 34 |
| `compileOp` | 11 | 15 |
| `compileExpr` (the dispatcher over about 35 handlers) | 8 | 1,102 |
| `elementComplexness`, `constantFoldValue`, `compileLoopBody`, `shaderSelectionStatement`, `noteLocalComplex`, and 7 more small ones | 4 to 8 each | 15 to 346 |

So the shape is: a small set of **hub functions** that every handler calls,
and a **dispatcher** that calls every handler. The handlers (about 180
methods, 21,000 lines) group by topic: broadcast (`tryCompileBroadcast`,
`compileBroadcastUnary`, 1,800 lines), user functions and calls
(`tryCompileUserFunction`, `tryCompileLocalFunctionCall`,
`emitUserFunctionCall`, `ensureUserFunctionEmitted`, `ensureSpecialized...`,
about 2,500 lines), blocks and statements (`compileBlock`,
`compileStatementList`, `classifyLocalReads`, about 1,600), conditionals
(`compileExprWhen`, `compileExprIf`, `compileExprWhich`, `guardCondition`,
`compileExactCondition`, about 1,000), pattern matching (`compileMatchJS`,
`emitMatchSwitch`, `walkMatchShape`, about 600), loops and comprehensions
(`compileLoop`, `compileForLoop`, `compileComprehension`, `compileRangeIterable`,
loop-invariant hoisting, about 1,200), function literals and captured bodies
(`compileExprFunctionLiteral`, `emitFunctionLiteralDefinition`, about 1,000),
operators and inner symbols (`compileExprOperator`, `compileInnerSymbol`,
about 1,000), references and the interpreter fallback (`analyzeReferences`,
`buildInterpreterFallback`, about 1,350), complex-value analysis
(`_isComplexValuedFunction`, `promotesRadicalToComplex`,
`branchComplexCoercion`, about 800).

### 4.2 Three ways to remove the cycle

A handler module must call the hubs, and the dispatcher must call the
handlers. One of the two directions cannot be an import.

**(A) Pass the hubs as a parameter.** Every handler takes a `Core` record
(`{ compile, compileExpr, compileValueOperand, compileOp, isComplexValued,
... }`) as its first argument; the dispatcher builds the record once and
passes it down. The repo already does this at one boundary: a
`CompiledFunction` in the target function tables receives
`compile: OperandCompiler<Expr>` as its second argument
(`compilation/types.ts`, `CompiledFunction`). Cost: about 180 signatures and
all their internal calls change (the 1,756 calls between members are the
upper bound), and each handler gains a parameter it threads through. Explicit
and testable in isolation.

**(B) Put the hubs on the `target` object.** `CompileTarget` already carries
target-supplied callbacks (`cseBind`, `selection`, `broadcastUnary`,
`checkOperandShapes`). A `core` field would make the record reachable from
every handler without a signature change. Cost: `CompileTarget` is a public
interface that the targets implement and consumers may build; the hubs are
not target behaviour, so the field is an internal detail on a public type,
and every handler would read the hubs through a cast.

**(C) A late-bound hooks module.** A new module `compiler-core-hooks.ts`
imports only types and exports one mutable record,
`export const core: CoreHooks = {} as CoreHooks`, with the 17 hub
signatures. The dispatcher module `compiler-core.ts` defines the hubs, fills
the record at module load (`Object.assign(core, { compile, compileExpr, ...
})`), and imports every handler module. Handler modules import `core` from
the hooks module and call `core.compileExpr(...)`. No file cycle: the hooks
module imports nothing that imports it. Cost: the hub record is a
module-level singleton, and a test that imports a handler module alone, with
nothing having loaded `compiler-core.ts`, calls an empty record. That cannot
happen through the public entry points, because `base-compiler.ts` imports
`compiler-core.ts`; the hooks module guards it anyway with a getter that
throws a clear message when a hub is missing.

### 4.3 Recommendation

**(C)**, with the hook set decided by measurement at move time, not by this
document. Reasons: the diff is a move plus a one-token rewrite of the hub
calls (`BaseCompiler.compileExpr(` becomes `core.compileExpr(`), which
`ast-grep` does and the type check proves; no public type changes; and the
handler signatures stay as they are, so the four targets' 217 call sites
change only in the import.

(A) is the alternative when the user prefers explicit parameters to a
singleton. It is the same move with a larger, still mechanical, rewrite.
(B) is not recommended: it changes a public interface for an internal need.

Saying no to this design means step 3 does not happen and the file stays at
about 25,000 lines after steps 1 and 2.

### 4.4 Module layout after step 3

```
compilation/
  compiler-core-hooks.ts      the CoreHooks record (types + the singleton)
  compiler-core.ts            compile, compileExpr, compileValueOperand, compileOp,
                              isComplexValued and the other hubs; registers them;
                              imports every handler module below
  compile-broadcast.ts        tryCompileBroadcast, compileBroadcastUnary, ...
  compile-user-functions.ts   user and local function calls, specialization, emission
  compile-blocks.ts           compileBlock, compileStatementList, classifyLocalReads
  compile-conditionals.ts     When, If, Which, guards, exact conditions
  compile-match.ts            pattern matching
  compile-loops.ts            loops, comprehensions, ranges, invariant hoisting
  compile-function-literals.ts
  compile-operators.ts        compileExprOperator, compileInnerSymbol
  compile-references.ts       analyzeReferences, buildInterpreterFallback
  compile-complexness.ts      complex-value analysis
  base-compiler.ts            the public facade (constraint 4)
```

Handler modules import `compiler-core-hooks.ts`, `types.ts` and the step 1
and 2 modules. Only `compiler-core.ts` imports the handler modules. madge
confirms the order.

## 5. Gates for every step

1. Type check: `./node_modules/@typescript/native/bin/tsc -p tsconfig.json --noEmit`.
2. `npm run check:deps` (zero cycles).
3. The full test suite, as `BUILD.md` prescribes, with no snapshot change.
   A changed snapshot means the move changed behaviour: find the cause, do
   not update the snapshot.
4. Lint and format (`BUILD.md`), since Prettier reflows moved code.
5. Review: the dual review per `~/.claude/SHARED-BOX-PROTOCOL.md` §5.2. The
   reviewer checks that every hunk is a move or an import, that no function
   body changed, and that no exported name was lost (knip can list unused
   exports afterwards).
6. The comments move with their code. A comment that names
   `BaseCompiler.x` is rewritten to name the function in its new module.
   About 470 code comments still name old ROADMAP headings; this plan does not
   touch them.

## 6. How the numbers were measured (to re-derive the sets at move time)

A script read `base-compiler.ts`, took every line at two-space indent that
declares a method of the class, assigned each method the lines up to the next
method, and built the call graph from the `BaseCompiler.<name>` tokens in
each body. Tarjan's algorithm gave the strongly connected components; the
largest is the recursive core. Leaves are methods whose body names no other
member. The hub set came from removing the most-called member of the largest
remaining component until no component had more than one member. The same
measurement on `gpu-target.ts` used the top-level `function` declarations
and bare `name(` tokens. Re-run the measurement at move time, because the
file changes daily.

## 7. Open decisions

- Design for step 3: (C), decided by the user 2026-10-30.
- Which members, besides `isEmissionSkippable`, the public facade keeps.
  Recommended: the members that `src/api.md` names, plus any that Tycho
  calls (ask tycho-desk before step 1).
- Order: step 5 (`gpu-target.ts`) first, decided by the user 2026-10-30; it
  does not touch `base-compiler.ts`, so it is its own commit.
