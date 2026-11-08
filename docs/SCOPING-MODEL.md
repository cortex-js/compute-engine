# Scoping and Binding Model

**Status:** normative internal reference.

## Symbol identity

A symbol occurrence denotes a binding, not merely a name. Comparisons,
substitution, free-symbol analysis, closure capture, and dereference must use
the binding selected by the scope chain. Raw-name fallback is a compatibility
escape hatch, not the identity model.

A type computation does not use this fallback for a parameter of a function
literal, which has a value only in a call: with `n := [1, 2]`, the type of
`n ↦ n + 1` is `(n: unknown) -> number` (`bindingInContext()`,
`boxed-expression/binders.ts`). An evaluation of a body node taken out of the
literal, outside a call, still reads the name, except for an answer that an
earlier type computation of that node cached: a node that a type handler
evaluated (`Take(L, n + 1)` when its finiteness is read) can keep the symbolic
answer.

The MathJSON of an expression writes a binding by its name, which a reader
resolves in its own scope. A symbol or a call bound to the definition of its
name in the system scope (the standard library) is written
`["Module", name]`, and a call `["Apply", ["Module", name], …]`, when the
name reads another definition where the node is read back. The name is
read first in the local scopes of the `Function` and `Block` nodes of the
serialized expression that enclose the node, innermost first, each one for
its own bindings, and then in the current scope chain. So a function
literal made at the top level and serialized in a scope that declares `Pi`
writes its library `Pi` as `["Module", "Pi"]`. In a block where `Pi` is declared and assigned `3`, the `.json` of
`π²/6` is `["Divide", ["Power", ["Module", "Pi"], 2], 6]`, which boxes in the
block to 1.6449, not to `3²/6`; and
`["Function", ["Add", ["Module", "Pi"], "Pi"], "Pi"]` keeps the qualifier
when it is serialized at the top level, because its parameter `Pi` shadows
the library constant in its body. Elsewhere, the bare name is written. The
canonical form of `["Module", name]` is the symbol bound to the system-scope
definition; in a scope that shadows the name, it is a new symbol marked as
qualified, which the parameter repair of a function literal does not rebind
to the parameter (`hidesLibraryBinding()`, `markQualifiedName()`,
`library-shadowing.ts`; the `Module` operator, `library/core.ts`). The
form of a qualified call `["Apply", ["Module", f], …]` is chosen before its
arguments are canonicalized (`qualifiedCallForm()`, `function-utils.ts`).
Where `f` is not shadowed (the lookup of a head, with the parameter
shadows, gives the library definition), it is the plain call `[f, …]`, and
every rule of the library operator applies. Where `f` is shadowed and the
library operator is an ordinary function (not lazy, not scoped, no operand
roles) and the call has no named argument, it stays
`["Apply", f, …]` with a callee symbol bound to the library definition and
the arguments canonicalized in the current scope (an argument `max` reads
the variable `max`): no rule that matches a call by its name reads it, and
the `Apply` route evaluates it from the values of its arguments, with no
symbolic simplification. Where `f` is shadowed and the library operator
holds or binds an operand (`Sum`, `If`), or the call has a named argument,
it is the error `["Error", "'qualified-call-shadowed'", f]`. A plain call
made where `f` is not shadowed keeps its binding (see "Callable
resolution"), and in a shadowing scope it is written
`["Apply", ["Module", f], …]`, which is boxed again in one of the two last
forms. A
`Declare`, an `Assign` or a `DefineFunction` of `Module` defines nothing and
evaluates to the `module-binding` error, and a block does not hoist such a
`Declare`. The head `Module` always resolves to the operator of the system
scope (`lookupApplicable()`, `function-utils.ts`), whatever a parameter, a
block local, a binder index or the host binds, so no binding changes what
a qualified name reads. LaTeX has no spelling of the
qualifier: a parse of `\pi` in such a scope reads the local.

## Callable resolution

A callable name denotes the binding selected where the call or callback was
created. It does not denote whichever unrelated declaration has that spelling
when evaluation eventually runs. This rule is the same for a direct call,
a bare callback, a function literal, and a callback in a lazy collection.

Capturing a binding does not freeze its value. Assigning a different function
to that original binding changes later calls, including reads from an existing
lazy view. Declaring another binding with the same name does not redirect them.
Parameters, block locals and iterator variables read the activation belonging
to their invocation; an unrelated invocation cannot intercept the call.

Assigning a closure to a name that its body reads as another binding does not
redirect that read. With `h = n ↦ Block(g := z ↦ 0, z ↦ g(z) + n)` and
`k = n ↦ Block(g := h(n), z ↦ g(z) + n)`, the closure that `h(1)` returns reads
the `g` of its own call of `h`, also when `k` stores it in its own `g`, so
`k(1)(0)` is 2. A mention is a recursive call only when it denotes the binding
being assigned, or when the literal has no definition of the name outside it
(`readsOtherBinding()`, `engine-declarations.ts`).

A lazy view that is assigned to a variable outside a loop or a block reads
the locals of that loop or block with their values at the assignment, not
their bindings (`bindOutlivedLocalsOfLazyValue`, `function-utils.ts`). A view
holds its callback literal unevaluated, so no closure captures the scope of
the iteration, and the scope changes before the view is read: the next
iteration writes its index, and the end of the block disposes its locals.
With `for d in [3, 6] { if d == 3 { h = Map(x => x + d, R) } }`, `h` reads
`d = 3`. A name that the call of the callback reads by its binding, and that
the view does not name, reads the same values: with `f = (x, k = d) => x * k`,
`h = Map(f, R)` in that loop gives `3, 6`. A view made at the top level gets a
record of the loop and block scopes that the variable outlives
(`recordOutlivedLazyViewContexts`, `lazy-view-context.ts`); a view made in a
function call already reads the context of that call. The record is made
while the context where the view was made is on the stack, and a later
assignment further out extends it while the frame of the earlier record is
on the stack. A view that leaves either context as the value of a block has
no record and reads `d` in the context of its reader: with
`h = do { let z = 0; Map(f, R) }` in that loop, the elements of `h` are `d`
and `2d`. The rule also applies to a base case of a sequence (`L_0 := v`)
and to a declared subscripted name (`h_1 := v`). For a `let` local this
differs from a closure, which shares the binding: with
`if true { let m = 1; h = Map(x => x + m, R); f = (x) => x + m; m = 5 }`,
the elements of `h` read `m = 1` and `f(0)` gives `5`. A view that is read
in its own scope, or that is stored in a variable of the same scope, reads
the current values. One exception: an Epsil assignment (`Assign` or
`Declare`) of a lazy collection that stays lazy stores the variables that
the collection reads, also in an inline function, with their values at that
statement. With `let d = 3`, `let t = map(x => x + d, 1..oo)` and `d = 5`,
`take(t, 2)` gives `4, 5`. A variable that holds a function is stored as
that function, which reads the later values of its own variables: with
`let f = x => x + d` and `let t = map(f, 1..oo)`, `take(t, 2)` gives
`6, 7` after `d = 5` (`src/epsil/docs/evaluation.md`). A view stored in a field of an object reads the locals
of every loop and block of the chain with their values at the store: with
`let o = {v: R}` and `for i in [1, 2] { o.v = Map(x => x + i, R) }`, `o.v`
reads `i = 2`. The name of the receiver does not tell how long the object
lives, because a variable of an inner scope can name the same object as an
outer one: with `for i in [1, 2] { let p = o; p.v = Map(x => x + i, R) }`,
the store through `p` also gives `o.v` the value `i = 2`, and no read of
`o.v` after the loop reads a discarded `i`. The cost is that a view in a
field of an object of the same block reads the locals of that block with
their values at the store, not at the read.

A call created before its function is defined is a forward reference. It
waits for a definition in its original lexical environment, not an unrelated
caller's environment. Adopting that declaration as a parameter makes it a
lexical parameter binding instead. Type inference and evaluation use the same
resolution rule, without assigning a target as a side effect of reading a type.

The result of evaluating a call whose head has no value stays symbolic for the
rest of the top-level evaluation that produced it. Evaluating that result again
in the same top-level evaluation evaluates its operands but does not resolve
its head, even when the name was assigned after the result was made: in
`Sum(Block(If(k = 2, h := z ↦ 2z), h(k)), k, 1, 3)`, the term `h(1)` keeps its
value when the final fold reads it after the assignment at `k = 2`, and the
sum is `10 + h(1)`. A later top-level evaluation resolves the head again, as
for any call: with `r = g(3).evaluate()`, then `ce.assign('g', k ↦ k²)`,
`r.evaluate()` is `9`. Each statement of an Epsil program, and each statement
of a `Block` that the host evaluates directly, is its own top-level
evaluation, so a statement that reads a value stored by an earlier statement
resolves it; the statements of a nested block (a `do` block in an assignment,
a function body, a `Sum` term) run in the evaluation of the enclosing
statement. The original, unevaluated call is never sticky, and an expression
rebuilt from a result (`subs()`) is a new call; both resolve their head as
before (`EVALUATED_UNRESOLVED_CALLS`, `boxed-expression/boxed-function.ts`;
decided in `docs/plans/2026-10-21-function-declaration-hoisting.md`, rule 1).

An `Apply` whose callee has the type `unknown` (an undeclared head, not a
`Function` or a `Block`, and without a wildcard) holds the callee as a function
value: `Apply(g(f), x)` stays as written, and once `g` is assigned
`(a, b) ↦ a + b`, it evaluates to `f + x` (the partial application `g(f)` is a
curried function). The unknowns of such a callee are not read as the
parameters of a shorthand function literal, which would make the answer change
when `g` gets a value (`isHeldCallee()` in `function-utils.ts`; user decision
2026-10-09). A callee with a known type that is not a function still uses the
shorthand: `Apply(x + 1, 2)` is `3`.

`subs()` replaces only the free occurrences of a name: a name that a binder
binds (the index of a `Sum`, a parameter of a `Function`, a local of a `Block`)
is not replaced inside that binder, so `j + Sum(j, j=1..3)` with `j` replaced
by `5` is `5 + Sum(j, j=1..3)`. The full rules are in the documentation of
`subs()` in `types-expression.ts`.

`subs()` rebuilds each call with the function the call was written with, not
with the function that its name has in the current scope. With
`h := a ↦ a·x`, take `e = h(a) + 1`, then push a scope that declares another
`h := a ↦ 100`: `e.subs({a: k})` evaluates to `k·x + 1`, not 101. A call that
the substitution value holds keeps the binding its caller gave it (a value
boxed in the inner scope calls the inner `h`). The inlining of a user function
by an integral, a derivative or a limit (`betaReduceLambda()`,
`inlineLambdaApplications()`, `boxed-expression/utils.ts`), `map()` and the
recursive `replace()` follow the same rule. A node that a `map()` callback or a
replace rule returns is a new node, and keeps the binding that the callback or
the rule gave it: a rule that rewrites `h(_x)` into `q(_x)` calls `q`. The
rebuild uses `withCallableBinding()` (`boxed-expression/binders.ts`), which
pushes a temporary scope only when the binding of the call differs from the
current definition of its name. A name that the rebuild declares
automatically goes to the enclosing scope, not to the temporary scope. The
canonical form (`.canonical`) of a raw or a structural call still binds its
name in the current scope. So a raw result (`subs(…, {canonical: false})`) or
a structural result of these operations reads the inner function when it is
made canonical or evaluated: in the example above,
`e.subs({a: k}, {canonical: false}).canonical.evaluate()` is 101.

`isSame()` and the hash compare a call by its name and its operands, not by
the function it is bound to: a call of the outer `h` and a call of the inner
`h` with the same arguments are `isSame`, and canonical `Add` can merge them
into one term. This is a known limit, accepted by user decision 2026-10-30.

Ordinary data-symbol lookup keeps the compatibility behavior below. This
callable rule changes function application, not every symbol read.

Compilation currently refuses captured held-function bindings that differ from
the ambient definition, or are no longer in scope. This remains a lowering
limitation: the interpreter now calls the captured binding, but the compiler's
name-based paths have not all been proven to preserve it.

A stored symbol value is evaluated in the environment denoted by its own free
symbols. Copying that value into the caller's scope and resolving it there can
silently capture same-named bindings and is forbidden.

Reading a symbol's VALUE during evaluation (`valueDefinitionInContext`,
`boxed-expression/binders.ts`) walks the scope chain for the innermost binding
of the name — the compatibility reading: a declaration made in a scope pushed
after the occurrence was bound, or a re-pushed saved scope, is read, and the
lazy-collection memo stamps the ambient scope for that reason — with BINDER
bindings of a binding other than the occurrence's own skipped. A binder
binding is a call frame's parameter activation (`markActivation`) or a binder
operator's variable (`markBinderVariable`): a `Sum` or `Product` index, a
comprehension or loop index, a `D` or `Integrate` variable. A same-named
parameter of the function being evaluated is not the symbol an outer
occurrence denotes, so an expression boxed outside a call frame evaluates to
the same value inside it, however many times a handler re-evaluates it.

Ruled 2026-09-21 — the LEXICAL reading of a binder: a binder of the CALLER
never intercepts a read of a global inside the body of the function it calls,
whether or not the global holds a value. With `w` declared real and valueless
and `W(x) := [w·x, x]`, `[W(w)[1] for w in [1, 2, 3]]` answers `[w, 2w, 3w]`
and `Σ_{w=1}^{3} W(w)[1]` answers `6w` — exactly what the spelling
`[W(k)[1] for k in [1, 2, 3]]` answers. Reading the binder by name gave
`[1, 4, 9]` and `14`. The same decision stops a binder from capturing a stored
value's free name: with `a := n + 1`, `Σ_{n=1}^{3} a` is `3n + 3`, not `9`.
This replaces the compatibility hatch the 2026-08-21 symbol-resolution round
kept for an ordinary declaration, which a comprehension or `Sum` binder was
treated as. Two conditions bound the skip. An occurrence with NO binding still
reads the innermost binding by name, because it denotes nothing in
particular. And an occurrence whose own binding is itself a binder's variable
also reads by name: two big operators that use the same index name can be
evaluated at once (the asynchronous lane suspends one mid-loop), and the
loop's per-term assignment and the body's read must resolve the name the same
way.

Ordinary shadowing declarations deliberately keep re-pointing earlier-bound
occurrences (ruled 2026-08-22): the re-pushed-scope reading and the compile
fallback runner rely on it. A shield (`markShieldDeclaration`) intercepts for
the same reason, including a shield that sits on a binder's own variable —
which is how `D`, `Integrate`, `Limit` and `Solve` hide an assigned value of
their variable.

A pass that substitutes a binder's current index value into a finished term —
the leak repair of a big-operator fold (`evaluateBigOpTerm`), the
capture-by-value of a comprehension element (`comprehensionStream`) — follows
the same rule: it reaches only the occurrences that DENOTE the index
(`substituteBinderValues`, `library/utils.ts`). Substituting by name captured
the globals a stored value refers to.

The COMPILED route honours the same rule: a folded symbol value is emitted
once as a preamble local outside every emitted function
(`bindsFoldedValue`/`ensureFoldedValueEmitted`, `compilation/base-compiler.ts`)
rather than inline where a parameter or an index could rebind its names, and a
value still written inline — a leaf, an impure value — compiles against the
preamble owner when the position would capture one of its names
(`inlineFoldTarget`). The reference analysis descends into such a value the
same way, so a name the value reads is reported in `freeSymbols`. Two shapes
still read a local of the same name — a compiled top-level lambda,
whose preamble has to sit inside the lambda body, and the shader targets,
which have no place for an untyped value binding. Both are recorded in
`ROADMAP.md`.

A node that owns a local scope — a comprehension, a sum, a block — pushes that
scope again on every evaluation. Its parent link is the scope it was
canonicalized in, so a declaration made later in a scope pushed on top of that
one (a child scope that shadows `n` with a value) would not be on the chain.
Ruled 2026-09-15: a directly evaluated expression reads the environment it is
evaluated in, so the re-pushed scope is chained onto the ambient scope for the
life of the frame — only when the ambient chain descends from the scope's own
parent, so an unrelated chain captures nothing, and never onto the scope
itself (`ambientChainParent`, `boxed-expression/ambient-chain.ts`). A call
frame is never chained: a stored function value is a closure and evaluates in
its own environment, as the rule above states. The collection memos resolve a
scoped instance's dependencies through the same chain (`withAmbientChain`).

## Binders

A binder operator declares its binding sites with the `bound` and `clause`
roles of the `operands` handler of its definition (`OperandRole`,
`types-definitions.ts`). A `bound` operand is a symbol that is a bound
variable: the variables of `D`, the expansion variable of `Series`. A `clause`
operand is an indexing set whose index is a bound variable (`Limits`,
`Element`, a tuple, a symbol): the clauses of `Sum`, `Product`, `Integrate`,
`Loop`, `Comprehension`, the quantifiers and `NDSolveFunction`. A run of
consecutive `clause` operands is read with the flat spelling of `Sum`
(`Sum(body, k, 1, n)` binds `k`, not `n`). `operandRoleSites()`
(`binding-sites.ts`) finds the site of each such operand: its path, the leaves
of a destructuring pattern (`Element(Tuple(p, q), pairs)`), its type, and
whether it is clause-local. An operator with such a role has its own scope, as
with `scoped: true`; `scoped: true` alone gives a scope with no syntactic bound
variable (`Block`). The engine finds that an operator is a binder when the
operator is declared: it calls the `operands` handler with zero to three
placeholder operands. `D`, `Integrate`, `Limit`, `Sum`, `Product`, `Solve`,
lambda parameters, comprehensions, and `HoldValues` all shield their variable
by the rule below.

The roles are consumed in a fixed order when an application of a binder is
canonicalized (`canonicalizeBinder()`, `box.ts`). The roles are read on the
operands as written. The engine creates the scope of the operator and
declares in it the variable of each `bound` operand and the index of the first
`clause` operand; the canonical handler declares the index of each later clause
just before it canonicalizes that clause, so that an earlier clause does not
see it. Then the engine canonicalizes each `statement` operand as a branch, in
that scope (an assignment of a bound variable there writes the bound
variable), and reads a bare `N` or `D` at a `value` operand of a lazy operator
as a variable (`applyOperatorDefinition()`). Then the `canonical` handler runs.
After the handler, the roles are read again on the operands of its result, and
each site, and each occurrence of the same name in the scope of the site, is
bound to the binding of the operator (`bindBindingSites()`).

The governing value rule is:

> A bound variable is a pure symbol. Its type and in-scope assumptions apply,
> but an assigned value of the same name does not. Free symbols resolve their
> values normally.

Some forms do not write their variable: `Limit(expr, point)`,
`NLimit(expr, point)`, `NIntegrate(expr, a, b)`, `ND(expr, point)`,
`Integrate(expr, Limits(Nothing, a, b))` (from `\int_a^b expr` with no `dx`),
`D(expr)` and `Series(expr)`. The variable is found from the symbols written in
`expr`, assigned or not: a constant (`Pi`), a library symbol, a function name,
a symbol bound inside `expr`, and a symbol whose declared type, or the type of
whose value, cannot hold a number (a list, a string, a boolean, a function) are
not candidates. The variable is a bound variable that hides the assigned
value: after `x := 4`, `\int_0^1 \sqrt{x}` is 2/3, and `D(x^3)` is `3x^2`.
When nothing is assigned, the candidates are the unknowns of `expr`.

Boxing before or after an assignment gives the same result only when one of
these is true for each assigned symbol of `expr`:

- the assigned value is a number;
- the symbol was declared, before boxing, with a type that cannot hold a
  number (`list<integer>`, `string`, `function`).

In other cases the two orders can differ. A symbol with no declared type has
an unknown type at boxing, so it is a candidate: boxed before
`L := [1, 2, 3]`, `Integrate(Sum(L)·t, Limits(0, 1))` takes `L` as its
variable; boxed after, it takes `t`.

The variable of a definite limit of `Integrate` that names no variable is
bound in the integrand, as a written variable is: it is not an unknown of the
integral (`implicitIntegralVariables()` in `binding-sites.ts`). So in
`\int_0^1\int_0^1 xy`, the inner integral binds `x` and the outer one takes
`y`.

- `Limit`, `NLimit`, `NIntegrate` and `ND` take the first candidate in sorted
  order (code-unit order: `y` for `y·z`, `a` for `a·x`).
- `Integrate` gives each limit that names no variable the next candidate in
  sorted order, when no limit names a variable. A candidate that no limit takes
  stays a free symbol.
- `D` and `Series` take the single candidate, or `x` when there are several
  candidates and one of them is `x`. With several candidates and no `x`, there
  is no variable and the expression stays unevaluated.

The implementation is `implicitVariableCandidates()` and
`defaultImplicitVariable()` in `src/compute-engine/boxed-expression/utils.ts`.

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
unit, binding site included. Such a pass must also not call a helper that
canonicalizes by default: `flatten()` (`boxed-expression/flatten.ts`) has a
third parameter `canonicalize` that is `true` unless the caller passes
`false`, and a canonicalization there resolves the bound names against the
ambient scope in the same way.

The shadowed-parameter frames (`_pushShadowedParameters()`) are a dynamic
stack, not part of a scope. While a function literal or a `Block` is
canonicalized, any boxing that runs in another scope (for example the
derivation of a stored function's signature, started by a `.type` read) sees
the names of the construct being canonicalized: a local `b` of the block
captured the free `b` of the called function, and the derived signature was
wrong. Such a computation runs inside `ce._withoutShadowedParameters()`. The
parent of the root scope is `undefined`, so a walk up the scope chain must
stop there.

## Canonical and runtime scopes

Canonicalization may establish identities and types, but runtime evaluation
owns runtime values. A nested scope must not read a stale canonicalization-time
scope when an enclosing runtime scope has since executed `Declare` or `Assign`.
Closure capture records the bindings a body actually denotes and restores them
at invocation.

`Block` is sequential: later statements observe earlier declarations and
assignments. A consumer translating a simultaneous assignment must snapshot
all right-hand sides before committing any left-hand side.

A free symbol that a `Block` does not declare is declared in the scope of the
`Block` when the `Block` is boxed outside a function literal: after
`ce.box(['Block', ['Add', 'f', 1]])`, the `f` of the block and a later
`ce.box('f')` are not `isSame`, but evaluation reads the same value (after
`f := 5` the block gives `6`). A host can box a `Block` first and then make it
the body of a function literal, and that declaration then becomes the binding
of a parameter of the same name. A function literal behaves the same way:
canonicalization wraps its body in a `Block`, and a free symbol that no
statement types (a bare `f`, a tuple, an equation) is declared in the scope
of that `Block`. So `ce.box(['Function', ['Block', 'f'], 'x'])` and a later
`ce.box('f')` are not `isSame`, although evaluation reads the same value.

A derivative of such a literal shows the same difference. On an engine where
`f` is not declared, `ce.box(['D', ['Function', ['Block', 'f'], 'x'], 'x'])`
and a later `ce.parse('\\frac{\\mathrm{d}f}{\\mathrm{d}x}')` have the same
`.json` but are not `isSame`, because the parse binds a global `f`. Their values
are the same: both are `0`, also after `f := 5`. They are `isSame` when `f` is
declared before the literal is boxed (by `ce.declare()`, by `ce.box('f')`, or by
a parse that runs first). A host that compares expressions from the two routes
compares their `.json`.

This limit stays by a user decision (2026-11-05), because each fix that was
tried costs more than the `isSame` result is worth:

- Declaring the free name outside the literal changes what other code
  relies on: effect records, rollback frames, the new derivation of
  `g(t) := 2a(t)` when `a` is defined later, and `CountIf` callbacks that must
  not declare `q`.
- Keeping the declaration and making `isSame` compare it as the outer binding
  requires boxing a literal that a host builds
  (`ce.function('Function', [block, x])`) again from its MathJSON, so that the
  change does not reach other expressions that share the `Block`. That reads
  every name in the current scope, which can change a value: with `y := 7`
  declared in a pushed scope, `['Block', ['Tuple', 'f', 'y', 'x']]` boxed there,
  the scope popped, and the literal then built and applied to `3`, the result
  is `(f, 7, 3)` today and was `(f, y, 3)` with that fix.

`test/compute-engine/ce-107-function-literal-free-name-is-same.test.ts` holds
this behavior.

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

## Lazy view context lifetime

A callback view records the evaluation stack through its innermost call frame,
the creation context, and the enclosing call frames its lexical chain reaches.
Nested block and loop scopes record binding identities, values and write
versions at creation. Creating the record does not clone scope definitions.
If those scopes are still live and unchanged, reads use the live stack;
otherwise the record builds and caches copies chained onto the call frame.
An enumeration chooses once at its first pull, so later pulls use the same
context even after the creating call returns. A closure instead shares mutable
block locals and observes subsequent writes.

Call frames are shared rather than copied. Before a call pops, a reachability
walk retains frames read by views in its result, including views reachable
through closure bodies, scope bindings and dictionaries. It visits each node
and scope once and stops below the call. Evaluating a function literal also
retains scopes reached by that closure: a closure can escape through assignment
rather than the returned result. This conservative rule retains a frame even
when the closure is immediately consumed. Retention marks are weak; they do
not keep otherwise unreachable frames alive.

A retained call frame is neither disposed nor tombstoned on pop. A retained
node scope can still dispose definitions but must not tombstone them. Retention
therefore also affects type-contribution and assumption readers of the disposed
flag, definition write versions, and the dead-binding debug check.

Rebuilding a view carries its record, including through returned closures and
parameter substitution. Adopting an unevaluated view held in a shared function
body requires a new node so invocations cannot overwrite one another's record.
Top-level views normally use their reader's context; an outward assignment can
record the loop and block scopes it leaves, as described in "Callable resolution".

The reachability walk cannot observe values stored privately by host code.
Such an escape does not retain its call frame. Disposed definitions keep their
values, but a later symbol evaluation can trigger the dead-binding debug check;
a name lookup alone does not run that check. Host escapes are therefore not
evidence that the managed reachability walk retained a frame.
