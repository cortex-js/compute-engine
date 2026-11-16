# CE answers for Tycho's macro adoption (row MG), 2026-11-15

For the session that adopts the macro kind in Tycho. The contract is
`docs/plans/2026-11-12-macro-kind-spec.md`; the user guide is "Declaring a
Macro" in `~/dev/cortexjs.io/docs/compute-engine/06-guide-augmenting.md`.
These answers were sent to Tycho sessions by message; this file is their
record.

## 1. Keep a macro by reference at a carrier site: no CE change

A declaration of the same name in an inner scope hides the macro (rule 6 of
the spec; `resolvesToMacro()` in `src/compute-engine/boxed-expression/box.ts`
reads the current scope). At a site where a carrier binds a list, point or
colour row to an array or a texture:

```ts
ce.pushScope();
ce.declare('L', 'list<real>'); // the carrier's type
const e = ce.box(rawReader); // L stays the symbol L
const result = compile(e, { symbolic: ['L', ...axes] });
ce.popScope();
```

Everywhere else `L` is still a macro and expands. Run on main (JS target),
with the macros `L = [x, 2x]` and `f = L[1] + 1`:

| Reader | Outside the scope | Inside the scope |
| --- | --- | --- |
| `L[1] + x` | `["Add","x",["At",["List","x",["Multiply",2,"x"]],1]]` | `["Add","x",["At","L",1]]` |
| `f + x` | (expands `L` too) | `["Add","x",["At","L",1],1]` |

A macro body is boxed where it is written, so the hiding also reaches `L`
inside the expansion of `f`. The compiled JS is
`_.x + _SYS.atNumeric(_.L, 1, "real")`; `run({ L: [5, 6], x: 1 })` is 6.

Not run: GLSL (the probe engine had no GLSL target registered).
Limit, from rule 4 of the spec and not run: a function body is boxed once,
when the function is defined. A function assigned outside the hiding scope
that names `L` holds the expanded list. If a carrier must bind `L` inside a
called function, define that function inside the hiding scope too.
`byReference` (element type and shader width) is not built; the existing
options for widths keep working because the name stays a name.

## 2. A parameter or an index captures the names of an expansion

This is the contract, not an accident: decision M1 and rule 2 of the spec.
Every name in a macro body resolves from the scope where the macro name is
written, and no name is renamed. `a = b + 1` as a macro, `f(b) = a`:
`f(2)` is 3 (the Desmos reading, D-310). Pinned by the tests "row 1",
"row 7" and "row 8" of `test/compute-engine/macro-kind.test.ts`.

Limit (rule 4): the capture happens where the name is written. In
`g(u) = u + a` called from `f(b) = g(1)`, the `b` of `a` resolves where `g`
was defined, not to the parameter of `f`.

## 3. Decisions and issues

- M5 stays: a macro has no parameters. tycho-3a measured that no corpus row
  calls a free-name row with an argument. D-316 is drawn by
  `ce.box("d").subs({ a: "x" })` on the expanded tree.
- CE-1343 (a selection over lists whose lengths only their values give):
  the case of a list with no dimension has a workaround with existing
  operators; the parameter typed `real | list<real>` waits for the board.
  See its "CE answer" section.
- CE-1344 (`Apply` over a scalar or a flat list on JS, interval-js and
  GLSL): FIXED in `fc5c8958bb4dd8119e137f27a32289010496ce00`. Its "CE
  answer" section has the table, what compiles and what still declines.
  - Build: the local tarball
    `/Users/arno/dev/compute-engine/_TASKS/2026-11-15-tycho-builds/cortex-js-compute-engine-0.193.0-tycho.fc5c8958b.tgz`
    (sha256 `e41d57650db4be057c16eedd61ec4a1b85eeb39384033cd800388d0bc1c84357`).
    Install it in Tycho with `npm install <that path>`. It exists on this
    machine only: use it to develop and gate here, not as a pin that CI
    installs.
  - Compile with `profile: 'ir'`. Tycho's instrument prints READY only with
    that option in its `compile()` call; the default route still runs the
    old compilers.
  - Limits: one untyped parameter, one argument, a scalar or a flat list of
    numbers. On GLSL the list length must be known at compile time, 1 to
    64 elements. Nested lists, tuples, lists of points, several parameters
    with a list and a typed parameter decline and fall back.
