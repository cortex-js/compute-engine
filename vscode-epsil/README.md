# Epsil for VS Code

Language support for [Epsil](https://epsil.dev), a programming language for
scientific computing.

Epsil is a statically typed, functional language with a small core and a
powerful standard library. It is designed for scientific computing, with
built-in support for units, symbolic computation, LaTeX islands and code
generation to JavaScript, Python (NumPy), and GLSL. Type inference makes most
type annotations optional. Effects are tracked in the type system, so pure
functions can be reasoned about and optimized, while functions with side effects
are clearly marked.

## Multi-clause function definitions, numeric ranges, and chained operations

```epsil
// Fibonacci
fib(0) = 0
fib(1) = 1
fib(n) = fib(n - 1) + fib(n - 2)

5..10 |> fib |> sum // -> 55
```

## Data Modelling with the Type System

```epsil
type json = number | string | boolean | missing | list<json> | dictionary<json>

let doc: json = {"tags" -> ["math", "computing"]}
let bad: json = x |-> x  // rejected before it runs
```

## Protocols and Objects

```epsil
protocol Shape {
  area: (self: Self) -> real
}

type Circle = object{radius: number} is Shape {
  function area(self: Circle) -> number { Pi * self.radius^2 }
}

const c = Circle(radius: 1/2)
print(c.area())  // -> 0.7853981633974483
```

## Symbolic Computation

```epsil
simplify(sin(x)^2 + cos(x)^2)  // -> 1

solve(x^2 - 2, x) |> N()  // -> [1.4142135623730951, -1.4142135623730951]
```

## VSCode Integration

- **Syntax highlighting** for `.epsil` files, plus bracket matching, comment
  toggling and folding.
- **Live diagnostics** as you type: parse errors, lints, and static type errors.
  This is exactly what `epsil check` reports — nothing is evaluated, so checking
  a program has no side effects and never runs a long computation.
- **Hover** over a name to see what it is: for a library function or constant,
  its signature (or type and value) and description — the same entry
  `epsil doc <name>` prints; for a name your file declares, the declaration as
  you wrote it, and for a top-level function the effects the engine inferred for
  it (`pure`, `console`, `random`, …, the same report `epsil check --effects`
  prints). Hovering a word inside a string or a comment shows nothing, so prose
  is never mistaken for code.
- **Navigation and rename** — Go to Definition, Find All References, occurrence
  highlighting, an Outline (with breadcrumbs and _Go to Symbol_), and Rename
  Symbol (<kbd>F2</kbd>).
- **Epsil: Show Representation** (the `{}` button in the editor title bar) —
  opens a read-only pane beside your file showing what the engine makes of it:
  the **MathJSON** it parses to, its **canonical form**, or the program as
  compiled by one of the engine's code-generation targets — **JavaScript**,
  **Python** (NumPy), or **GLSL**.
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
