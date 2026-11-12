# Temporary names

Status: revision 6. The design (an ordinary symbol with a reserved form
of name) is the user's decision of 2026-11-12, and the choices H1 to H5
of section 9 were APPROVED by the user on 2026-11-12. No code is
written; the implementation waits for the user's word. It is step 3 of
section 7 of `docs/plans/2026-11-11-bound-once-spec.md`, which calls it
"a fresh symbol". It does not depend on step 1 of that spec: every site
of section 7 can be changed on main.

User decision of 2026-11-12, which this revision applies: **a temporary
is an ordinary symbol with a name in a reserved form.** It replaces the
design of revisions 1 to 5 (a symbol with an identity apart from its
name), and the clause of the approved step 3 that asks for "an identity
that no parse produces, compared by identity". Section 10 lists what the
earlier design had and this one does not.

The parameter of a family of roots and the constants of integration are
not temporaries: `docs/plans/2026-11-12-arbitrary-constants-spec.md`.

Sources: the engine at `7305ef84b8e97bf25bc97dbcdaef2e6e48d81772`; the
results marked "run" were run on it. Tycho's sites and its preference are
from session `tycho-desk` (2026-11-12, Tycho main, engine 0.187.1, read
from source, nothing run).

## 1. What it is

One function that gives a name, and one reserved form of name. A
temporary is then a symbol like any other: the caller declares it,
assigns it, uses it as a parameter, a binder index, a block local, a
compile input or the name of a helper function, with the interfaces that
exist.

Today each place that needs such a name has a loop of its own, and the
loops differ in what they test: the symbols of one expression, the
definitions of the scope chain, the caller's names, a fixed list of
letters with a fallback that tests nothing. There are six in the engine
and ten families in Tycho (section 7).

## 2. The API

```ts
ce.temporaryName(hint: string,
  ...avoid: (Expression | string | ReadonlySet<string>)[]): string
```

It returns `<hint>_tmp<n>`, with `n` the smallest integer from 1 such
that the name:

- has no definition that a lookup from the current scope finds
  (`ce.lookupDefinition()`), and
- is not a name of `avoid`, and does not occur in an expression of
  `avoid`: as a symbol, free or bound, or as the operator of a call. A
  string of `avoid` is one name, not text to search. A set is a set of
  names. An array is not accepted: an array of strings is also a
  MathJSON call, and a caller with a MathJSON tree passes the set of its
  names or boxes it.

Rules:

- `hint` is a valid symbol name; another string throws. A hint is often
  a name of the user, so the function does not refuse one for its
  underscores: it removes the `_` at its start and at its end and makes
  each `__` one `_`, and uses `tmp` if nothing is left. A hint for which
  `<hint>_tmp1` is not a valid symbol throws (an emoji: a symbol cannot
  mix an emoji and letters).
- The function keeps no state and writes nothing. The same call in the
  same state gives the same name.
- An expression of `avoid` is walked as it is written, each node once
  (a shared subtree is not walked again). The walk does not enter the
  values or the bodies of the names that the expression reads.
- The caller passes in `avoid` every expression that the name will be
  put in or combined with, the bodies and the stored values that the
  computation reads, and the names it got earlier and has not
  declared yet (two calls in a row with one hint give the same name
  otherwise).
- A name that an expression uses with no definition is not seen by the
  lookup (since 0.187.0 a use declares nothing): it is excluded only when
  that expression, or the name, is in `avoid`. This matters when the hint
  is a name of the user (`s` gives `s_tmp1`, which a user can write as
  `s_{tmp1}` in another expression): the caller passes the names that
  its other expressions use.
- The form of the name is part of the contract: `<hint>_tmp<n>`, `n` a
  positive integer with no leading zero. A host can remove
  `/_tmp[1-9]\d*$/` to get the hint.
- The name is an ordinary name. A definition of it lives and ends with
  the scope it is declared in. A name used as a parameter or a binder
  index needs no `ce.declare()`; a block local has its `Declare` in the
  block, as any local (bound-once D8).

Examples (the form of name is run; the function is not written):

| Program | Result |
|---|---|
| `ce.temporaryName('t')` in a new engine | `t_tmp1` |
| `ce.temporaryName('t', ce.box(['Add', 't_tmp1', 'x']))` | `t_tmp2` |
| `ce.declare('t_tmp1', 'real')`, then `ce.temporaryName('t')` | `t_tmp2` |
| `a = ce.temporaryName('p')`; `ce.temporaryName('p', a)` | `p_tmp1`, `p_tmp2` |
| `ce.temporaryName('_x')`, `ce.temporaryName('a__b')` | `x_tmp1`, `a_b_tmp1` |
| `ce.temporaryName('a b')` | throws |

## 3. The reserved form

A name that ends with `_tmp` and a positive integer is reserved for
`ce.temporaryName()`. The guides say so. The engine does not enforce it:
a host must be able to declare such a name, and a test at each input
would be a handler for a case that no document reaches.

Known limitation (witness: `crafted`): a user who writes a reserved name
(`t_{tmp1}` in LaTeX parses to `t_tmp1`: run) while a temporary of that
name is declared in a scope that the user's expression reads gets that
temporary. The same holds for a temporary that is held in a stored
value, or in an expression boxed in a scope that the current scope does
not see, when the caller did not pass it in `avoid` (run: after a pop of
the scope that declared `s_tmp1`, an expression that reads a value
holding it has no `s_tmp1` for `has()` or for the lookup). `freshSymbol()`
has the same case today with `s`. Both are one line each of the
limitations of `docs/SCOPING-MODEL.md`.

**Why this form** (all run, for `t_tmp12`, `Gamma_tmp1` and a helper
`h…_tmp1`): it is a valid symbol today; it can be declared, simplified,
used as the parameter of a `Function` and as the index of a `Sum`; it
compiles as an input and as a helper function to JavaScript,
`interval-js`, GLSL and Python (`_.t_tmp12`, `_fn_hGamma_tmp1`); its
MathJSON and its LaTeX (`t_{tmp12}`, `\Gamma_{tmp1}`) parse back to the
same name. The same holds for a hint with a subscript, a Greek name and
a hint that ends with digits (`y_r_tmp1` is `{y_{r}}_{tmp1}`,
`theta_tmp1` is `\theta_{tmp1}`, `x_1_tmp1` is `{x_1}_{tmp1}`; each
parses back and compiles to GLSL as an input and as a helper: run). So no validation, no emitter and no serializer changes.

## 4. What a caller must know

- **The lifetime is the caller's.** The name is free again when its
  definition is gone and no expression in `avoid` holds it. An expression
  that still holds an old temporary and is not in `avoid` can meet a new
  temporary of the same name. Each occurrence keeps the definition of the
  scope it was boxed in (bound-once rule 1), but everything that works by
  name takes the two for one: `subs()`, `has()`, `ce.rebind()`, a boxing
  from MathJSON, and the argument bag of a compilation. The rule of
  section 2 for `avoid` is the protection, and the limitation of section
  3 is what it does not cover.
- **Compiled code.** The name is the identifier, as for any symbol, and
  the key of the argument bag. Two compilations of one document give the
  same code when the host is in the same state at both: the same
  definitions in the scopes it reads, the same expressions. A temporary
  that stays declared in a scope that a later computation reads moves
  the numbers of that computation: a host that wants the same names
  declares its temporaries in a scope that it pops. The name
  does not depend on a counter of the engine or of the process.
- **Messages** show the name, which holds the hint. The engine does not
  know that a name is a temporary, so it does not shorten it; a caller
  that wants the hint alone removes the suffix (section 2).
- **Text.** `.json` and `.latex` print the name. Boxing the MathJSON
  gives the same symbol. Parsing the LaTeX gives the same symbol when the
  hint itself parses back to itself (run for `t`, `Gamma`, `theta`,
  `y_r`, `x_1`); a hint written with a Greek letter does not (`α` prints
  `\alpha` and parses to `alpha`, found by a reviewer), as that name
  alone does not. `toString()` is for display. Nothing differs between
  two runs.

## 5. What the engine does not do

No new kind of symbol; no table; no rule of order, hash or digest; no
change of `ce.rebind()` or of the sites that box an expression again
from its MathJSON; no pass that names the inputs of a compilation; no
change of the interpreted fallback, which reads the values of the
argument bag with `ce.withValues()` as for any input; no restriction on
where the name is used.

## 6. Why not `__temporary__12`, and why not `t#12`

- A name that begins with `_` is a wildcard of the pattern matcher:
  `["Add", "x", 1]` matches `["Add", "__temporary__12", 1]` with
  `__temporary__12` bound to `x` (run). `_tmp12` does the same. The GLSL
  target emits `__temporary__12` as it is, and an identifier with `__` is
  reserved in WebGL; for a helper it writes `_fn_h_temporary_12`, with
  the `__` made `_` (run), so two names can meet.
- `t#12` is refused as a symbol: `ce.declare('t#12', …)` throws in strict
  mode and outside it; the JavaScript target emits code that does not
  parse and the GLSL target emits `t#1 + x` (run). It would need a change
  of the validation and of each emitter.

## 7. The test cases: the places that invent names today

### In the engine

| # | Site | Today | With `ce.temporaryName()` |
|---|---|---|---|
| E1 | `freshSymbol(f, avoid)`, `symbolic/series.ts:2104`; 6 calls in `series.ts`, `residue.ts`, `contour-integrate.ts`, `contour-definite-integrate.ts` | the first of `s, u, w, q, z, tau, xi` not in `f`; then `_seriesT` with no test (and `_seriesT` is a wildcard) | `ce.temporaryName('s', f, avoid)`. The function and its fallback go. The callers are unchanged: the two contour callers declare the name in a pushed scope, the four others only substitute, so one that calls itself again passes the expression that holds its earlier name (the residue code does) |
| E2 | `freshParameters()`, `integrationConstants()` | `t`, `c_1`, … | the indexed constants of the other spec |
| E3 | `renameBoundVariables()`, `function-utils.ts:7669` | `x_1`, `x_2`, … against the names in use; the name is in a result that the user reads (`G(x)` is `x_1 ↦ x + x_1`: run) | **stays.** `x_tmp1` in a printed result is no gain |
| E4 | `_ce_iterate_accumulator`, `compilation/javascript-target.ts:13833` | a fixed name (a wildcard) declared in a pushed scope for a type probe | `ce.temporaryName('accumulator', fn)`. The push, the declaration and the pop stay |
| E5 | `privateNameFor()`, `compilation/shadowing-calls.ts:259` | `GammaUser`, `GammaUser2`, …, `GammaCopy…`, 64 tries each, against the names in use, the caller's names and `ce.lookupDefinition()` | `ce.temporaryName(fn.name, usedNames, taken)`: `usedNames` is the set that the site has (the names of the expression, of the bodies it reaches and of the caller), `taken` the private names given so far. One test stays: a caller's `operators` function can answer for any name, so a name that it answers for is added to `taken` and the call is made again, 64 times at most, then the compilation runs on the expression as it is, as today. The two suffixes go; the scratch scopes, the placeholders and the record of `symbolDeps` stay. The emitted name changes: `_fn_GammaUser` becomes `_fn_Gamma_tmp1` |
| E6 | `freshSymbolName(prefix, used)`, `symbolic/solver-utils.ts:16`; 11 calls in `differential-equations.ts`, `recurrences.ts`, `interpret.ts` | `prefix`, `prefix_1`, … against the symbols of the equation | `ce.temporaryName(prefix, equation)` for the ten callers whose name does not reach the result (to show for each, acceptance item 6). `freshIndex()` of `interpret.ts:131` makes the index of a `Sum` that the user reads (`k`, `j`, `i`, then `k_1`): it stays, as E3 |
| E7 | found by a reviewer, not read by the author: `freshYSymbol` (`rubi/rubi-utils.ts:5846`), `_shadowed<n>` (`boxed-expression/simplify.ts:2038`), `freshNames` (`nonlinear-fit.ts:642`), and the bound names of `compile-locals.ts:957`, `pool-loop.ts:673`, `library/complex.ts:496` | a loop each | **not in this change.** A later change reads each one |

### In Tycho

Tycho's answer of 2026-11-12: with this design every remaining generator
"replaces its name loop and its `isTaken`/`lookupDefinition` test with
one call, and nothing else changes".

| # | Generator (Tycho file) | Role | With `ce.temporaryName()` |
|---|---|---|---|
| T1, T10 | `ceArg_<n>`, `ceIdx_<n>` (`document-ce-manager.ts`) | a parameter and a binder index that Tycho builds | one call each, until the macro kind (step 4) removes the code. One generator serves both: the two prefixes exist so that the two loops cannot meet |
| T2 | `<name>_with<k>` (`block-local-rename.ts`) | a block local | one call, until CE-1229 removes the pass |
| T3 | `TychoCertificate<n>` (`plot/ce-compile.ts`) | a helper assigned in the scope that Tycho pushes for the walk and pops after it, and called by name in MathJSON trees; a counter of the module that never starts again | one call. The walk keeps its strings. The name no longer depends on what was compiled before, so the codegen audit stops normalizing it |
| T4 | `TychoColor<n>` (`style-expressions.ts`) | a helper for a colour whose body is a `Block`, emitted in GLSL | one call. `_fn_TychoColor_tmp1` has no `__` |
| T5, T8 | `<name>_gpBound<k>` (`compiled-body.ts`), `<name>Local<i>` (`prelude-runner.ts`) | binder variables and block locals | one call each. Tycho's pattern that removes `_gpBound\d*` from a warning becomes `_tmp\d+` |
| T9 | `_solverColRow<k>` and `_solverCol<n>` (`solver-solve.ts`) | compile inputs; the variables of the engine's fit call | one call each; the name is the key of the argument bag |
| T6, T7 | `TychoEntryFoldArg_<i>`, `tychoDeferredGate<i>c<j>` | fixed spellings with no collision test | stay, or one call |

The pushed scope and the declarations at T9 and T7 go with the option
`inputs` of step 1 of the bound-once spec, not with this.

The bound names (T1, T2, T5, T8, T10) still need a name under the
bound-once rule: Tycho builds a binder around a body that exists, and a
binder binds the occurrences of its variable by name (bound-once C7), so
a name of the body with the same spelling would be captured. T1, T10 and
T2 end with the macro kind and CE-1229; T5 and T8 are not planned to
end.

## 8. What changes for a user

1. The helper of a user function that shadows a library operator is
   emitted as `_fn_Gamma_tmp1`, not `_fn_GammaUser`: a line of
   `CHANGELOG.md`, `[Unreleased]`, "Breaking changes". The corpus records
   of emitted code that hold such a helper change; the count is reported
   before the change lands.
2. New: `ce.temporaryName()`, and the reserved form, in
   `~/dev/cortexjs.io/docs/compute-engine/04-guide-symbols.md`.

## 9. Choices (approved by the user, 2026-11-12)

- **H1. The form `<hint>_tmp<n>`.** It needs no change of the engine
  (section 3). Alternatives: `__temporary__12` and `t#12`, section 6.
- **H2. The smallest free number, with no state.** Tycho agrees
  (2026-11-12): it caches a GLSL program by its source text, so a name
  that moves between runs would compile a new program at each rebuild,
  and every Tycho site can pass what `avoid` needs. Alternative: a
  counter of the engine that never gives a number twice.
  It can never give a name that a forgotten expression still holds. But
  the name then depends on everything the engine did before, so the code
  that the engine itself emits for E5 would differ between two runs, and
  the comparisons of emitted code (the corpus, Tycho's audit) would need
  a pass that renames the temporaries. Recommended: the smallest free
  number, with the rule of section 2 for `avoid`.
- **H3. The reserved form is not enforced** (section 3). Alternative:
  the LaTeX parser refuses a name of that form. It is a test in the
  parser for a `crafted` case, and a host would still be able to box
  one.
- **H4. One function that gives a name**, and no function that also
  declares. Alternative: `ce.temporaryVariable(hint, type)` that declares
  in the current scope and returns the symbol. It saves one line at the
  sites that declare, and half of the sites do not declare (a parameter,
  an index, an input given with `inputs`).
- **H5. E3 stays**, and E4 changes its name only. Alternative: leave E4
  as it is, since its fixed name in its own scope has not failed.

## 10. What the earlier design had and this one does not

- **An identity apart from the name.** Two temporaries are different
  because their names differ, and the names differ because of section 2.
- **A lifetime that ends when no expression holds the symbol.** The
  caller's scope and the rule for `avoid` take its place (section 4).
- **A temporary that is absent from `unknowns` and `symbols`.** It is
  there, as `_seriesT` is today.
- **Names of compiled code that depend on the expression alone.** They
  depend on the state of the host too (section 4).
- **Text input that cannot name a temporary.** The known limitation of
  section 3.

## 11. Acceptance

1. The five rows of the table of section 2.
2. For `n = ce.temporaryName('t')`, declared `real`: `ce.box(n).json`
   boxes to the same symbol; `ce.parse(ce.symbol(n).latex)` is the same
   symbol; a compilation to JavaScript, `interval-js`, GLSL and Python
   reads the input under the name `n`; `Function(n + 1, n)` applied to
   `2` is `3`; `["Add", "x", 1]` does not match `["Add", n, 1]`.
3. The items of 2 for the hints `y_r`, `theta` and `x_1`.
   `ce.temporaryName('s', new Set(['s_tmp1']))` and
   `ce.temporaryName('s', 's_tmp1')` are `s_tmp2`; an array in `avoid`
   throws. With `s_tmp1` used in an expression that is not in `avoid`
   and not declared, the result is `s_tmp1`.
4. A helper assigned under `ce.temporaryName('Gamma')` is emitted once
   by the JavaScript and the GLSL targets, under a name with no `__`.
5. Two engines, the second after other work whose scopes were popped,
   give the same names and the same emitted code for one document. With
   a temporary left declared in the global scope, the next name of that
   hint has the next number.
8. A call with an expression whose subtrees are shared to a depth of 40
   returns at once.
6. For each of E1, E4, E5, E6: its loop is deleted (for E5, all but the
   test of the `operators` function) and its tests pass, with the changed
   helper name of E5 stated in each changed expectation. For E1 and each
   changed caller of E6, a test shows that the result holds no name of
   the reserved form. For E5: two user functions of one name from two
   scopes get two private names; a body that holds `Gamma_tmp1` gives
   `Gamma_tmp2`; an `operators` function that answers for `Gamma_tmp1`
   does not get that name, and one that answers for every name leaves
   the expression as it is, as today. The source has no `_seriesT`, no
   `_ce_iterate_accumulator` and no `privateNameFor`.
7. `docs/SCOPING-MODEL.md` has the line of the known limitation, and
   the guide has the reserved form.

## 12. The reviews

Revision 6 was reviewed by two reviewers on 2026-11-12 (11 and 6
findings, 3 of them on the same point) and by Tycho, and changed for
them: what `avoid` accepts and how it is walked; a used name with no
definition; the hint is cleaned and not refused; the call of E5 (the
names of the bodies, the names given so far, the `operators` function);
`freshIndex()` stays; E7 is a later change; the condition of the same
names between two runs; the second known limitation; what parses back.
The revised text was not reviewed again.

## 13. Not known

- The WGSL target: its compilation failed in the probe for every form of
  name, an ordinary one not tried. To check that the cause is not the
  name.
- Whether Epsil lets a program write a name of the reserved form, and
  whether it should.
- The count of corpus records that E5 changes.
