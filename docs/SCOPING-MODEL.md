# Scoping and Binding Model

**Status:** normative internal reference.

## Symbol identity

A symbol occurrence denotes a binding, not merely a name. Comparisons,
substitution, free-symbol analysis, closure capture, and dereference must use
the binding selected by the scope chain. Raw-name fallback is a compatibility
escape hatch, not the identity model.

A stored symbol value is evaluated in the environment denoted by its own free
symbols. Copying that value into the caller's scope and resolving it there can
silently capture same-named bindings and is forbidden.

Reading a symbol's VALUE during evaluation (`valueDefinitionInContext`,
`boxed-expression/binders.ts`) walks the scope chain for the innermost binding
of the name — the compatibility reading: a declaration made in a scope pushed
after the occurrence was bound, or a re-pushed saved scope, is read, and the
lazy-collection memo stamps the ambient scope for that reason — with one
binding skipped: a call frame's parameter activation of a binding OTHER than
the occurrence's own. A same-named parameter of the function being evaluated
is not the symbol an outer occurrence denotes, so an expression boxed outside
a call frame evaluates to the same value inside it, however many times a
handler re-evaluates it. Ordinary shadowing declarations deliberately keep
re-pointing earlier-bound occurrences (ruled 2026-08-22): the re-pushed-scope
reading and the compile fallback runner rely on it.

## Binders

Binder operators declare their binding sites through the shared binding-site
selector. The selector identifies operand positions, bundled variables, and
shielded regions. `D`, `Integrate`, `Limit`, `Sum`, `Product`, `Solve`, lambda
parameters, comprehensions, and `HoldValues` all use this mechanism.

The governing value rule is:

> A bound variable is a pure symbol. Its type and in-scope assumptions apply,
> but an assigned value of the same name does not. Free symbols resolve their
> values normally.

Shielding is implemented by a valueless shadow binding with the original type,
not by renaming or by head-specific substitution. Binding tombstones prevent a
lookup from falling through to a shadowed outer definition.

## Rebuilding a scoped node

Any pass that rebuilds a node owning a local scope — `.subs()`, the
`rewriteWithBinders` walk, a canonical handler reshaping its operands — must
rebuild it onto THAT scope, never onto a fresh one. A fresh scope is parented
at the rebuilding site's ambient scope, so a binder nested inside the rebuilt
one keeps a `parent` pointing at the original outer scope while the rebuilt
node advertises a different one. The chain from the inner body then no longer
reaches the outer binder's index, and an index whose name collides with a
library constant resolves to the CONSTANT — `i` to the imaginary unit, `e` to
Euler's number. The failure is silent: the rebuilt expression reports
`isCanonical` and serializes identically to a directly-built one, and only the
OUTER binder's name is affected, so an index named `p` disguises a tree an
index named `i` gets wrong.

A pass that runs BEFORE any scope exists — the partial `CanonicalForm[]`
pipeline — cannot preserve a scope, so it owes the bound variables the
complementary guarantee: it must not resolve them at all. The names come from
the operator definition's binding sites (`declaredBinderNames`,
`binding-sites.ts`), the only source available to a tree that has no
`localScope` yet. Resolving them instead rewrote `Sum`'s `i` to the imaginary
unit, binding site included.

## Canonical and runtime scopes

Canonicalization may establish identities and types, but runtime evaluation
owns runtime values. A nested scope must not read a stale canonicalization-time
scope when an enclosing runtime scope has since executed `Declare` or `Assign`.
Closure capture records the bindings a body actually denotes and restores them
at invocation.

`Block` is sequential: later statements observe earlier declarations and
assignments. A consumer translating a simultaneous assignment must snapshot
all right-hand sides before committing any left-hand side.

## Simplification

The `.simplify()` method is value-blind; the `Simplify` operator evaluates its
argument before simplifying. `HoldValues` exposes value shielding explicitly.
The full simplify/operator split and recursion constraints are normative in
`SIMPLIFY.md`.

## Parse-time scope

Parsing may consult scope for symbol identity and known definitions, but a
partial or structural parse must not create durable declarations as a side
effect. Structural-tier parsing preserves written structure; semantic
canonicalization and declaration happen only at the documented funnel. Open
hardening work remains in `plans/2026-08-04-parse-scope-control-design.md`.

## Invalidation

Every binding mutation reports through the engine state-event funnel. Directly
incrementing a cache version at a write site bypasses the dependency model and
is not allowed. The effects and cache axes are described in
`EFFECTS-MODEL.md`.
