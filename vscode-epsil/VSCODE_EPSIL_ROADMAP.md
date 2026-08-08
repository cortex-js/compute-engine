# VSCode Epsil Extension — Debugging Roadmap

Status of this document: planning. v1 of the extension (grammar, LSP
diagnostics, run command) shipped 2026-08-07; this roadmap covers what comes
next: **variable inspection, breakpoints, and step-by-step debugging**.

## The architectural constraint that shapes everything

Epsil does not execute itself. `executeEpsil` (`src/epsil/execute-epsil.ts`)
parses source to MathJSON, then runs each **top-level statement** through
`ce.box(stmt).evaluate()`. Everything inside a statement — `while`/`for`
(lowered to the engine's `Loop` primitive), function calls, blocks — evaluates
atomically inside the engine's recursive evaluator. So the only "step points"
that exist today, for free, are the gaps between top-level statements.

Three enabling facts (verified 2026-08-07):

- **Source positions exist end-to-end at statement granularity.** The parser
  attaches `sourceOffsets` to every MathJSON node (`src/epsil/parser.ts`), and
  `BoxedExpression` can carry them as metadata
  (`abstract-boxed-expression.ts`). Diagnostics already use them. Whether they
  survive canonicalization on sub-statement nodes is the subject of the audit
  below.
- **Async evaluation exists.** `evaluateAsync` is on `BoxedExpression`, and
  control-structure operators already have `evaluateAsync` handlers threading
  an `AbortSignal` (`library/control-structures.ts`). That is the natural
  artery for a pause/step hook, since a DAP debuggee must suspend mid-run
  while VSCode queries variables.
- **Scope enumeration is available.** The engine's `contextStack` /
  `lexicalScope.bindings` can enumerate declared symbols and their values —
  the basis of the Variables pane.

**Hard constraint**: the LSP server must **never** call `executeEpsil` (it
would run user code and leak scope state — a load-bearing v1 decision). All
debugging lives in a separate debug-adapter process, never in the diagnostics
server. DAP's adapter/debuggee split aligns with this naturally.

## Tier 0 — Inline result decorations (no engine changes)

Cheapest big win, and a stepping stone to Tier 1. Since Epsil is "errors are
values, last statement is the output" and `executeEpsil` was designed for
notebook cell-chains, per-statement evaluated values shown as end-of-line
decorations (notebook/Quokka-style), plus a "run to here" CodeLens, deliver
most of what people use a debugger for — *seeing values* — with zero engine
changes and no DAP machinery.

- Driver: a statement-loop runner (parse → evaluate statement-by-statement,
  reporting each statement's value + `sourceOffsets`). The same driver later
  powers the Tier 1 debuggee.
- Runs in a separate on-demand process (not the LSP server — see constraint
  above).

## Tier 1 — Statement-level debugger (no engine changes) — SHIPPED 2026-08-07

Implemented in `src/debug-adapter.ts` (bundled to `dist/debug-adapter.js`,
declared in `contributes.debuggers` with `runtime: node` — DAP over stdio, no
descriptor factory needed). A `DebugConfigurationProvider` in `extension.ts`
makes F5 work on an `.epsil` file with no `launch.json`. Launch options:
`program`, `stopOnEntry`, `statementTimeLimit` (ms per statement, the only
guard against a statement that never returns — pause acts at statement
boundaries). Parse errors stop the launch. Hover evaluation is restricted to
bare identifiers (answered from scope bindings, no evaluation); debug
console/watches run full `executeEpsil` semantics in the live scope.
Verified end-to-end by DAP stdio harnesses (scratchpad `dap-smoke*.mjs`,
session-local): breakpoint bind/reject, stop/step/continue, variables with
types + child expansion, REPL evaluate, hover, stopOnEntry, parse-error
launch, time-limited infinite loop.

The original scope, all delivered:

- **DAP adapter** in `vscode-epsil/` using `@vscode/debugadapter`, with a
  `"type": "epsil"` launch config and a `DebugAdapterDescriptorFactory`.
  Bundle the engine into it the same way the LSP server already does
  (esbuild, ~5 MB, known-fine).
- **Debuggee loop**: reimplement `executeEpsil`'s statement loop under adapter
  control — before each statement, map its `sourceOffsets` to a line, check
  breakpoints, pause if hit. "Step over" = run one statement. Run the
  debuggee in a child process so a runaway statement can be paused/killed
  (`withTimeLimit` + `AbortSignal` help here).
- **Variables pane**: enumerate the current scope's bindings after each
  statement; render values via `serializeEpsil`; expand
  lists/dictionaries/tuples through DAP `variablesReference` children.
- **Debug console / watches**: evaluate expressions against the live session
  scope — the CLI's `session.evaluate` machinery already does exactly this
  for the REPL.

Limitations, honestly stated: breakpoints bind only to top-level statement
lines; no stepping *into* a loop body, a function body, or intermediate
iterations — a `while` loop runs to completion as one "step."

## Tier 2 — Real stepping (engine cooperation, ~1–2 weeks)

To break inside loops and step into user functions, the engine's evaluator
needs a debug hook:

1. **An `onStatement` async callback** threaded through `evaluateAsync`
   options, invoked at statement granularity inside `Block` evaluation, per
   `Loop` iteration, and on user-function application. The `signal` plumbing
   shows the pattern; the hook awaits a promise the adapter resolves on
   continue/step. Needs an async variant of `executeEpsil`. The hook check
   must be free when no debugger is attached — evaluator hot-path placement
   has shown 3–13× perf sensitivity in this codebase.
2. **Source-offset survival through canonicalization**, at least for Block
   operands, loop bodies, and Declare/Assign — so paused positions map back
   to lines. Expression-level breakpoints are much harder and out of scope.
   See the audit below.
3. **Call stack**: map the engine's context stack (function applications push
   scopes) to DAP stack frames, with per-frame scoped variables.
4. **Watch evaluation while paused** is subtle: async eval holds its scope
   across the await, and concurrent async evaluation on one engine is
   deliberately unsupported. The safe design is to evaluate watches
   synchronously *inside* the hook callback (while the main evaluation is
   parked at the await) — the paused scope is then correctly current — and
   guard against watches that declare/assign.

## Tier 3 — Polish (only on demand)

- Conditional breakpoints (evaluate the condition in the paused scope).
- "Exception" breakpoints: errors are *values* in Epsil, so "break on throw"
  becomes "break when an `["Error", …]` value is constructed" — an engine
  hook at error boxing.
- Hit counts, logpoints.

## Recommended sequence

1. ~~**Source-offsets audit**~~ — DONE 2026-08-07 (findings below).
2. ~~**Tier 1**~~ — SHIPPED 2026-08-07 (see above). Tier 0 (inline result
   decorations) remains open; it can reuse the adapter's statement loop.
3. **Tier 2** only if stepping into loops/functions proves a real demand.

## Audit: `sourceOffsets` survival through boxing/canonicalization

Performed 2026-08-07, empirically (tsx probes over `parseEpsil` →
`ce.box(…, { form })` on multi-statement programs with loops and function
definitions).

### Findings

**Raw AST (parser output): complete and precise.** Every node — program
root, each top-level statement, sub-expressions down to symbols — carries
`sourceOffsets`. `hasMetaData()` (`src/math-json/utils.ts`) recognizes
`sourceOffsets` as metadata, so object-literal boxing extracts it.

**`form: 'raw'` and `form: 'structural'` boxing: fully preserved**, on the
root and on operands.

**`form: 'canonical'`: offsets are lost on essentially every Tier 2 anchor
point.** Observed on the canonical tree of a representative program:

| Node | Offsets |
| --- | --- |
| `Block` root, `Block` statement operands | lost (all of them) |
| `Declare`, `Assign`, `Loop`, `DefineFunction`, `Add` statements | lost |
| Loop-body statements (`If`/`Break` lowering, `Assign`) | lost |
| Symbols (e.g. the declared name in `Declare`) | **kept** |
| Handler-less operator boxed directly (undeclared `g(1,2)`) | **kept** — but lost once nested inside a `Block` |

### The two drop sites (both in `boxed-expression/box.ts`)

1. **Custom-`canonical`-handler returns.** In `applyOperatorDefinition`,
   every path that constructs a `BoxedFunction` directly passes `metadata`
   through — but when an operator's custom `canonical` handler returns a
   result, that result is returned as-is and the caller's `metadata` (which
   holds the offsets) is never re-attached. Affects `Add`, `Declare`,
   `Assign`, `Loop`, `Block`, … — effectively every statement-shaped
   operator has a handler.
2. **The already-boxed → `.canonical` path.** A scoped/lazy operator
   (`Block`, `Loop`) boxes its operands with `form: 'raw'` (offsets intact
   on the raw node), then its handler canonicalizes each via `.canonical` —
   and the canonical result does not inherit the source node's
   `sourceOffsets`. Verified directly: `structural-box → .canonical` yields
   `NONE`. This is why even a handler-less `g(a, 2)` loses its offsets
   inside a `Block`.

### Consequences per tier

- **Tier 0 / Tier 1: unblocked today, no fix needed.** The debuggee driver
  iterates the *raw* parsed statements (exactly as `executeEpsil` does for
  its diagnostics) and boxes each separately — it holds the statement's
  offsets before boxing, so breakpoint/line mapping never depends on the
  canonical tree.
- **Tier 2: propagation FIXED 2026-08-07** (see "The propagation fix"
  below). The engine-side `onStatement` hook will fire on canonical nodes
  (Block operands, loop-body statements), which now carry offsets.

### The propagation fix — IMPLEMENTED 2026-08-07

`withSourceOffsets()` in `boxed-expression/box.ts` stamps a canonical result
with the caller's `metadata.sourceOffsets`, applied at the drop sites: the
custom-`canonical`-handler returns in `applyOperatorDefinition` (both the
lazy and non-lazy paths) and the numeric fast-path constructors in
`makeNumericFunction` (`canonicalAdd`, `canonicalPower`, …). The
`.canonical` getter in `boxed-function.ts` now threads
`{ sourceOffsets }` metadata into its `engine.function` call (mirroring what
`get structural` always did — `latex` is deliberately not threaded: the
canonical form is a different expression).

Hazards handled:

- **Shared/interned nodes.** Only a `BoxedFunction` lacking its own offsets
  is stamped — number/symbol/string results may be interned singletons
  (`ce.One` for `x/x`, library symbols) and are never written to. A result
  already carrying offsets (a pass-through operand with its own sub-span)
  keeps the more precise span. Residual accepted risk: a handler serving a
  *cached function expression* gets stamped once with its first consumer's
  span — positions are advisory metadata, never read by structural
  semantics.
- **Hot path.** The stamp is two property reads when no offsets are present
  (LaTeX and programmatic construction pay nothing).
- **Snapshots.** Default JSON serialization already drops `sourceOffsets`
  unless explicitly requested (`serialize.ts`), so no snapshot churn.

Verified (probes + `test/compute-engine/source-offsets.test.ts`): Block
operands, Loop nodes, the user's loop-body block and each statement inside
it, function-literal body statements, `Declare`/`Assign`/`Add` statement
roots — all carry their spans after canonical boxing, on both the direct-box
and `.canonical` routes. Synthesized lowering nodes (`If`/`Break` from
`while`) have no source counterpart and correctly carry none. `ce.One`
stays unstamped; LaTeX-parsed and programmatically built expressions are
unchanged.

With this landed, Tier 2's remaining work is the evaluator hook (the
`onStatement` callback + async execution path + call-stack surfacing).
