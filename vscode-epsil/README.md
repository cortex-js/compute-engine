# Epsil for VS Code

Language support for [Epsil](https://epsil.dev), a programming language for
scientific computing.

```epsil
// Fibonacci

// Multi-clause function definition
fib(0) = 0
fib(1) = 1

// Type inference makes most type annotations optional
fib(n: integer) = fib(n - 1) + fib(n - 2)

// Numeric range, and pipe operators to chain operations
5..10 |> Map(_, fib) |> Sum
```

- **Syntax highlighting** for `.epsil` files, plus bracket matching, comment
  toggling and folding.
- **Live diagnostics** as you type: parse errors, lints, and the static type
  errors the engine catches when it canonicalizes a program. This is exactly
  what `epsil check` reports — nothing is evaluated, so checking a program has
  no side effects and never runs a long computation.
- **Epsil: Run File** (`epsil.runFile`) — saves the active file and runs it in
  an integrated terminal named _Epsil_. By default it runs the Epsil CLI bundled
  with the extension — the same engine build used for diagnostics, inline
  results, and debugging. Set the `epsil.cliCommand` setting to run a different
  engine (e.g. `npx @cortex-js/epsil`).
- **Debugging** — breakpoints (including conditional breakpoints and logpoints),
  stepping into function and loop bodies, a real call stack, variable
  inspection, watches, and a live debug console for `.epsil` files. Press
  <kbd>F5</kbd> on an Epsil file (no `launch.json` needed).
- **`epsil` in the integrated terminal** — the extension puts an `epsil` command
  on the PATH of integrated terminals (running the bundled CLI), so
  `epsil program.epsil` works there with no npm install. Controlled by the
  `epsil.terminal.addToPath` setting.
- **Epsil: Show Inline Results** — runs the file and shows each top-level
  statement's value at the end of its line, notebook-style, without starting a
  debug session. Cleared on edit (or with **Epsil: Clear Inline Results**).
- **Epsil: Restart Language Server** (`epsil.restartServer`) for when the server
  needs a nudge.

## Debugging

Set breakpoints in the gutter and press <kbd>F5</kbd>. The debuggee runs on a
worker thread that pauses **at every statement** — top-level statements, and the
statements inside function bodies, loop bodies and `if` branches:

- **Breakpoints** bind to statement lines anywhere, including inside a function
  or loop body — a breakpoint on a blank or continuation line snaps to the next
  statement. A loop-body breakpoint stops on every iteration.
- **Conditional breakpoints** stop only when their condition (an Epsil
  expression evaluated in the paused scope) is `True`; a condition that errors
  stops conservatively with a warning. **Logpoints** print their message —
  `{expr}` parts evaluate in the live scope — without stopping.
- **Break on error values**: enable the _Error Values_ filter in the Breakpoints
  view to pause whenever a statement evaluates to an error value (Epsil reports
  runtime problems as values, not exceptions).
- **Restart** (the restart button) relaunches the program in a fresh session
  with breakpoints preserved.
- **Step Over / Into / Out** work at statement granularity: Step Into enters a
  called function's body; Step Out runs to the caller. (A single statement that
  is one pure computation — no block statements inside — executes as one step.)
- **Variables** splits into **Locals** (the paused body's parameters and locals)
  and **Globals** (the session's own declarations), with inferred types; lists,
  tuples and dictionaries expand. Hovering a variable name shows its value.
- **Call stack** shows the nesting of the paused position, down to the top-level
  statement that started it.
- **Debug console and watches** evaluate with full Epsil semantics in the live
  paused scope — like the REPL. That also means an expression with a side effect
  (an assignment, a declaration) takes effect in the paused program; watches are
  re-evaluated on every stop, so keep them effect-free.
- **Pause** takes effect at the next statement pause point. A statement that is
  a single long-running pure computation cannot be paused — bound it up front
  with the `statementTimeLimit` launch option (ms per statement), or stop the
  session. (Note: the per-statement limit keeps counting while paused at a
  breakpoint inside that statement — avoid combining a tight limit with body
  breakpoints.)
- Parse errors stop the launch (they are already shown inline by the language
  server); the program's final value is printed to the debug console when the
  run completes.

Launch configuration (all optional beyond `program`):

```jsonc
{
  "type": "epsil",
  "request": "launch",
  "name": "Debug Epsil File",
  "program": "${file}",
  "stopOnEntry": false,
  "statementTimeLimit": 0 // ms per statement, 0 = unlimited
}
```

## Development

The extension is developed in the
[compute-engine repository](https://github.com/cortex-js/compute-engine) — see
[`vscode-epsil/DEVELOPMENT.md`](https://github.com/cortex-js/compute-engine/blob/main/vscode-epsil/DEVELOPMENT.md)
for how to build and run it from source.
