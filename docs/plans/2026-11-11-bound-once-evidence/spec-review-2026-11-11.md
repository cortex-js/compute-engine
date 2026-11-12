# Review of the bound-once spec (2026-11-11)

Two reviewers read `docs/plans/2026-11-11-bound-once-spec.md` at
`6d8023136`: a Claude subagent (17 findings) and Codex (7 findings). Merged:
18 findings — 1 critical, 7 high, 7 medium, 3 low or nit; 6 found by both.

1. [CRITICAL] [Both] §2 rules 1 and 4, §5 — A parameter, a binder variable
   and a block local find their value by a walk of the CURRENT context to the
   activation of their scope (`bindingInContext()`: `callerBinding()`,
   `sweptHomeOf()`, `activationBindingOf()`). The prototype keeps it. So rule
   1 ("the current scope plays no part") and rule 4 ("unchanged") contradict
   each other, and §5 promises to delete what rule 4 needs. Recursion needs an
   activation lookup too.
2. [HIGH] [Claude] §2 rule 4, §4 — Closures are not decided: in
   `add := a ↦ (x ↦ x + a)`, `g = add(2)`, `g(3)`, the `a` of the inner body
   reads a frame that was popped. Today: frame retention
   (`retainCallFrameOfResult`, `retainScope`). `issue-489` and `ce-473` are
   this case.
3. [HIGH] [Both] §4, §9 M1 — `ce.withValues()` finds and declares definitions
   from the CURRENT scope (`withValuesFn()`), so it can write a definition
   that a held expression does not read; it refuses a value outside the
   declared type, which the old fallback avoided with a shadow of the
   run-time type; a declaration at each call moves the type cache key.
4. [HIGH] [Claude] §9 M1 — The list of hidden names that replaces the value
   shield is a new mechanism by name that no rule states: what it hides, its
   extent, its cache key, its nesting with `withValues`, and its behavior
   across an `await` (the stack is per engine and synchronous).
5. [HIGH] [Claude] §2 rule 5, §8 D2 — `popScope()` disposes the definitions of
   the popped scope, marks them dead, and `ce._debugBindings` throws on a
   read. Rule 5 needs them alive. `InspectableScope.dispose()` is undecided.
6. [HIGH] [Both] §2 rule 6 — The compile options have no shape and no
   precedence: an `inputs` name that holds a value (inlined or input?),
   `symbolic` without a type, a given type against a declared type, a unit
   requirement, a bound occurrence of the same name, `unknown`/`any`, a
   union; what `byReference` promises (aliasing, in-place writes, the width)
   and how it relates to `storage`, `vars`; the types that the constant fold
   and the fallback use.
7. [HIGH] [Both] §7 step 1 — No acceptance criteria: the nine rows as tests,
   the disposition of each failing test, the full and nightly suites, a time
   threshold on a quiet machine, Tycho's audit, the completed M1 list.
8. [HIGH] [Both] §4 Caches, §5 — The home chain is not fixed: `ambient-chain.ts`
   re-parents scoped nodes (the ruling of 2026-09-15, `docs/SCOPING-MODEL.md`),
   so a resolution from the home scope can change with no declaration. The
   ruling is reversed by rule 1 but not listed; the memos that resolve through
   it are not listed. `_typeCacheGeneration()` is not only the type version
   (a key per call frame, the shield key), and a parameter declared in a frame
   does not move it: the argument for dropping `ResolutionToken` must be made
   per kind of occurrence.
9. [MEDIUM] [Codex] §2 rules 1 and 2 — The prototype pins a symbol to the
   definition it had at boxing. Rule 2 says a later declaration in the home
   scope is read: an occurrence boxed in a child scope that resolved to an
   ancestor's definition must read a later declaration of the name in that
   child. No example covers it. `docs/SCOPING-MODEL.md`, "Callable
   resolution", says an existing call keeps its selected binding: superseded
   or kept?
10. [MEDIUM] [Claude] Header — "the parts of rules 5 and 7 that follow" are not
    written: `sameBinding()`, `readBinding()`, the getters, the collection
    protocol; two occurrences of one name with different homes inside an
    operation are different bindings.
11. [MEDIUM] [Claude] §4 binder case — Which heads are binders (`Function`,
    `Block`, `Map` with a literal, `Integrate`, `D`, `Assign`); whether the
    re-boxing rebinds an occurrence that resolved to an outer definition; an
    inner binder of the same variable; `subs()` and `replace()`.
12. [MEDIUM] [Claude] §4 M1 — The site list has two entries; about 25 files
    push scopes. "Solve, the integrals and the limits do not fail" can mean
    that they now read the outer binding silently. "Pass the type to the
    operation" has no mechanism.
13. [MEDIUM] [Claude] §2 rule 3, §7 — What a stored body needs beyond rule 2,
    and how it behaves between step 1 and step 2 (the registry of waiting
    definitions).
14. [MEDIUM] [Claude] — Asynchronous evaluation: `withValues` is synchronous,
    the hidden names are per engine.
15. [MEDIUM] [Claude] §4 — The type of a parameter occurrence inside a call
    (its declaration, or its activation) and the frame keys of the type cache.
16. [LOW] [Claude] §3 row 8 — `1 + Module(Pi)` is probably the print form of
    `π + 1` in a scope that declares `Pi`; serialization still reads the
    current scope and the spec does not say so.
17. [LOW] [Claude] §5, §8 — "before approval" wording; §3 notation does not map
    to API calls (row 7).
18. [NIT] [Claude] §4 — "(Tycho, item 4)" names no document.
