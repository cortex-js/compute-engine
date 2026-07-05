# Phase 4 — Semantics & Execution

_From "parses to MathJSON" to "runs in a Tycho notebook cell". This phase
has the most open design; the items below are scoped, but each design
decision should be ratified before its implementation starts (update this
doc as decisions land). Depends on Phase 2; Phase 3 can proceed in
parallel._

## 1. Execution model

- `executeCortex(ce, source, options?) → { value, diagnostics }` (working
  name; final API with Phase 5): parse → canonicalize per top-level
  statement → evaluate sequentially in a scope. Symbolic-by-default: a top
  -level expression evaluates like `ce.parse(latex).evaluate()` does —
  exactness contract included (`ln(2)` stays symbolic). Numeric
  approximation is explicit (`N(expr)`), not a language mode.
- "Errors are values" (`docs/principles.md`): runtime problems flow as
  MathJSON `["Error", …]` values, printed distinctively; only *parse*
  problems use the diagnostics channel.
- Interruptibility: long evaluations must respect the engine's existing
  deadline mechanism — a notebook cell needs a stop button.

## 2. Declarations, assignment, scoping (language-review §2.2)

- v0: implicit declaration on first assignment (engine `ce.assign`
  semantics); `x: real = 5` declares with type (via the Phase 2 held
  annotation → `ce.declare`).
- Scope mapping: one scope per program (= notebook cell chain); Tycho
  decides cell-to-scope topology (likely: notebook = engine scope, cells
  share it, re-run replaces bindings). Blocks and function bodies push
  lexical scopes (`ce.pushScope`).
- Out of v0: `let`/`const`, compound assignment, destructuring.

## 3. Function definitions (language-review §2.3)

- Primary form: `f(x) = expr` → `["Assign", "f", ["Function", expr, "x"]]`
  (mathematical style; engine already canonicalizes function literals with
  closure capture — reuse, don't reinvent). Typed params
  `f(x: real) = expr` via the type subparser.
- Anonymous form: decide between `(x) -> expr` (conflicts with
  KeyValuePair — needs the dictionary/`->` context split) or a keyword
  (`fn`?). **Open.**

## 4. Control flow (language-review §2.4)

- `if cond { … } else { … }` as an expression → `["If", cond, then, else]`.
  Braces here are *blocks* (keyword-introduced only — the Phase 2 `{…}`
  collection grammar is unaffected). Block value = last expression
  (`["Do", …]` → engine `Do` semantics).
- One loop for v0: leaning `while cond { … }` → `["Loop", body, cond]`-
  shaped mapping (exact MathJSON per engine's `Loop`/control operators),
  plus collection iteration via library functions (`Map`, `Filter`,
  `Reduce`) rather than a `for` statement. **Open — validate against
  actual notebook use cases before building.**
- `return`/`break`/`continue`: out of v0 (expression-oriented style
  doesn't need them yet; words stay reserved).

## 5. Pragma security review

`#env` / `#navigator` read host state at *parse* time — in an embedded
notebook that is an information leak from the host environment into
documents. Gate both behind an opt-in parse option (default **off** in
`executeCortex`), keep `#line`/`#column`/`#url`/`#filename`/`#date`/`#time`
(benign), and re-review `#error`'s `FatalParsingError` (a cell should get a
diagnostic, not an exception escaping to the host).

## 6. Tycho notebook integration (coordinate with Tycho repo)

CE deliverables: the `executeCortex` API; diagnostics with offsets +
fix-its (editor squiggles); `sourceOffsets` on results (click-to-source);
injected-`parseLatex` wiring documented for hosts. Tycho deliverables
(tracked there, per the consumer-docs convention): cell UX, scope topology
choice, display of values/errors, CodeMirror/Monaco grammar (can derive
from `highlight-js-mode.js` once the grammar stabilizes).

## Definition of done (v0 semantics)

- A notebook-shaped integration test: multi-statement program with
  declarations, a typed function definition, an `if`, a `$…$` island, and
  symbolic + numeric results — executed via `executeCortex` against a real
  engine, snapshot-locked.
- Pragma gating tests (env/navigator off by default).
