# Scoping and Binding Model

**Status:** normative internal reference.

## Symbol identity

A symbol occurrence denotes a binding, not merely a name. Comparisons,
substitution, free-symbol analysis, closure capture, and dereference must use
the binding selected by the scope chain. Raw-name fallback is a compatibility
escape hatch, not the identity model.

A canonical call denotes its definition (`operatorDefinition`, or the value
definition of a head bound to a variable, such as a function made with
`DefineFunction`), not its name. A library rule (a canonical fold, a
simplification rule, a derivative table, a compiled lowering) is a fact
about the library operator, so it applies to a node only when the node is
bound to that operator. A test of `node.operator` against a name is a
pre-filter. The decision is `isLibraryOperator(node, name)`: the node's
operator definition is the definition of the name in the system scope (one
map read), or an extension or a copy of it that keeps the library handlers.
Two nodes are calls of the same operator when `sameOperator(a, b)`: the same
name and the same definition. Because the node's binding was selected where
the node was bound, the answer holds in every scope: a library call made
before a declaration of a user `Sqrt` stays a library call, and a call bound
to the user `Sqrt` is not a library call after the scope of the declaration
ends. The scope-based guard `shadowsLibraryName(ce, name)` answers for the
current scope, so it is used only before the node exists, and for a node
that has no definition (a non-canonical node), where `isLibraryOperator()`
uses it as its answer. A name that a caller-supplied library defines (the
constructor's `libraries` option) is not a library operator for these rules,
unless the caller passes `customLibrary: false`, as a compilation target
does to read the custom definition's own lowering (`library-shadowing.ts`).

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
`library-shadowing.ts`; the `Module` operator, `library/core.ts`). A
qualified call `["Apply", ["Module", f], …]` is the plain call `[f, …]`
bound to the library definition of `f`, in every scope, and every rule of
the library operator applies to it. It is boxed before its arguments are
canonicalized, so a lazy operator receives its operands as written and a
binder (`Sum`) binds its own variable. Where `f` is not shadowed (the
lookup of a head, with the parameter shadows, gives the library
definition), the call is boxed by the normal route. Where `f` is shadowed
(`shadowsQualifiedName()`, `function-utils.ts`), it is boxed by
`ce._libraryCall()`: while the call is boxed, the engine holds its head
(`ce._qualifiedHead`), the lookup of the head and the binding of each node
of the name read the library definition, and the name tests of that boxing
see no shadow. The boxing of each operand clears the head first, so the
arguments are canonicalized in the current scope: an argument `max` reads
the variable `max`, and a call `Not(false)` of a user function `Not` inside
`std::Not(…)` stays a call of the user function. The canonical steps that
compare an operand with the call compare definitions, not names (see
"Symbol identity" above), so the fold `Not(Not(x)) = x` does not apply to
that operand. A call bound to the library keeps its binding (see "Callable
resolution"), and in a scope that shadows `f` it is written
`["Apply", ["Module", f], …]`, which boxes again to the same call. The
canonical form of its structural form is the library call again, also in
such a scope (`isLibraryCall()`, `library-shadowing.ts`); the canonical form
of every other structural call binds its name in the current scope (see
"Callable resolution"). A
`Declare`, an `Assign` or a `DefineFunction` of `Module` defines nothing and
evaluates to the `module-binding` error, and a block does not hoist such a
`Declare`. The head `Module` always resolves to the operator of the system
scope (`lookupApplicable()`, `function-utils.ts`), whatever a parameter, a
block local, a binder index or the host binds, so no binding changes what
a qualified name reads. LaTeX has no spelling of the
qualifier: a parse of `\pi` in such a scope reads the local.

### Free names

Boxing declares no name (`TYPE-SYSTEM.md`, "The type of a name with no
explicit type"). A name that has no definition when it is boxed is a **free
name**: a canonical symbol with no definition (`isFreeName()`,
`type-guards.ts`; `binding-unit.ts`). Its `valueDefinition` and
`operatorDefinition` are `undefined`, and `ce.lookupDefinition(name)` is
`undefined` until the name is declared. It keeps its name and its **home
scope**: the first scope up the chain that existed before the boxing and is
not `noAutoDeclare` (`freeNameHomeScope()`). The home scope also skips the
scope of a binder when the name is boxed in that scope after the binder was
canonicalized (by a `subs()` during its evaluation). The free name of the
body of a function literal has its home scope in the scope that the literal
is written in.

**Resolution.** An expression resolves each name from the scope it was
boxed in, its home scope, for its type and for its value; the current scope
plays no part (`homeChainBinding()`, `boxed-expression/binders.ts`). For a
type read, an evaluation, a compilation and a comparison, the definition of a
free name is found when the read happens, on the chain of its home scope, and
the answer is cached until a definition of that name changes. So a
declaration made later in the home scope, or in one of its ancestors, is
read, and a declaration in a scope that is not on that chain is never read:
`a = ce.parse('x + 1'); ce.assign('x', 3); a.evaluate()` is `4`, and with the
assignment made in a pushed scope it is `x + 1`. `ce.rebind(expr)` gives the
expression bound in the current scope, and is the only way to make an
expression read another scope. The resolution skips the variables of
binders, because a free name was not inside a binder when it was boxed, and
it skips a library operator for a name that the expression reads as a
variable (`N` in `N + 1`). With no definition, a free name stays symbolic.
A name of the body of a function literal that has no definition is a free
name of the scope that the literal is written in: the boxing declares no copy
of it in the scope of the body, and it does not read the variable of a binder
or a parameter of a call that has its name. An occurrence that has a
definition keeps it: with `n: real`, the value of `n + 1` boxed at the top is
not changed by a declaration of `n` in a pushed scope. A scope that was popped keeps its definitions, and an
expression boxed in it reads them.

**Identity.** Two occurrences are the same binding (`sameBinding()`,
`compare.ts`) when both resolve to the same definition. When neither
resolves, they are the same binding when both are free names with the same
home scope and name. A free name is never the variable of a binder.

The setters `value` and `type` of a free name are host writes: they declare
the name in its home scope, as `ce.assign()` and `ce.declare()` do
(`ce.box('w').value = 3` declares `w`).

## Macros

A macro (`ce.declare(name, { macro: body })`, `boxed-expression/macro.ts`)
is a value definition that keeps a raw MathJSON body (`macro`), with no
value and the type `unknown`. It is expanded in place: where boxing turns a
name of the input into a canonical, partial or structural symbol
(`macroAt()`, `box.ts`), a name that resolves to a macro is replaced by the
body, boxed there with the options of the occurrence. The name resolves as
`ce.symbol()` resolves it, so a parameter of the function literal being
canonicalized, an index, a block local and a declaration of a pushed scope
come first and hide the macro. The body is boxed by the same rule, so a
macro that it names is expanded too; a macro met again while its body is
boxed is `Error('macro-cycle', name)`. The root of the body takes the
`sourceOffsets` of the name.

Nothing is expanded while an evaluation is in progress on the engine
(`anyMacroDeclared()`, `macro.ts`): an operation environment is in place
(`evaluate()`, `N()`, `simplify()`, `compile()`, a slice of
`evaluateAsync()`, `replace()` and the other operations), or the run driver
of an Epsil program evaluates a statement. There a name that resolves to a
macro is the plain symbol of that name, with no value and the type
`unknown`, at every site, so library code that boxes names during an
evaluation never expands a macro of the same name. A host callback that
calls `ce.parse()` or `ce.box()` during an evaluation gets no expansion
either.

- Not an occurrence: the raw form, a symbol made by `ce.symbol()` (an engine
  algorithm's working variable), the head of a call, and a position that
  takes a name. A binder's variable is declared in its scope before the
  operands are canonicalized, so it resolves to the variable; the target of
  `Assign` and `Declare` is kept as a name by their handlers.
- A held operand (`Hold`) keeps the name, unbound. `ReleaseHold` makes it
  canonical during an evaluation, so it stays the name; so does a name in
  the replacement of a rule, made canonical when the rule is applied.
  `BoxedSymbol.canonical` expands a raw macro name made canonical outside an
  evaluation. A symbol bound before the macro was declared (a free name) is
  canonical, so it is not boxed again and reads the name, which has no value.
- The structural form makes no scope for a binder, so the names that a
  structural binder binds are found from the binding sites of its operator
  definition (`declaredBinderNamesOf()`), and for a `Block` from its
  top-level `Declare` and `DefineFunction` statements; a macro of such a name
  is not expanded below the binder.
- The parse oracle answers the type `any` for a macro, which is neither
  `unknown` nor a function, so LaTeX `A(x+1)` is a product.
- `ce.assign()`, an evaluated `Assign` and `ce.withValues()` on a macro
  throw. A host changes a macro by declaring it again in a new scope and
  boxing its readers again.

- A lazy operator receives its operands raw, and its handler can read a
  bare symbol by its shape (`D` reads it as a function name, `Integrate` as
  a constant integrand), and it can make an operand canonical only when the
  call is evaluated (`Solve`, `FindRoot`), where nothing is expanded. So each
  macro name in the raw operands of a lazy call, at any depth, is replaced
  by the raw body, itself expanded the same way, before the handler runs
  (`expandMacroOperands()`, `box.ts`, also for the entries of
  `Dictionary`); the operands stay raw, and the handler sees what it sees
  for the program with the body written in place of the name. The walk is
  the raw and structural rebuild of `ce.rebind()` (`unboundRebuilder()`),
  with an explicit stack and the same records of hidden names as the
  structural form; a rebuilt node keeps its metadata, and a node of the
  caller is never changed. Not replaced: an operand whose role is `opaque`
  or `held`, in the call or in a lazy call inside it (the operand of
  `Hold`), and a name that stays a name: a symbol operand with the role
  `bound` or `clause`, a name at an operand that takes a name
  (`isNameOperand()`, `macro.ts`: the signature names the type `symbol` at
  that position, or its table lists the operand, as for the unknowns of
  `Solve` and the variable of `Limit(f, To(x, a))`, and of `Limit(f, x, a)`
  when `f` is not a `Function` literal and holds `x`), and a name that the call, or a binder, a `Block` or a lazy call
  inside it, binds or takes as a name. A name that stays a name is replaced
  by a fresh raw symbol of the name that `BoxedSymbol.canonical` does not
  expand (`_keptName`), so the handler can make the operand canonical, put
  it in a new node or substitute in it, and the name stays a name.
- At an operand that takes a name, the names are the operand when it is a
  symbol, each symbol element of a `List` there, and the first operand of a
  `Tuple`, a `Pair`, an `Element` or a `To` there or in that list; a start
  value, a domain or a point is an ordinary occurrence. Such a name hides the macro in every
  operand of the call, as the variable of a binder does. In the structural
  form a lazy call and a binder push a record of their
  operands, and the names are found only when a name below resolves to a
  macro (`HiddenBinders`, `box.ts`).
- A raw body is expanded while its macro is in the cycle set, so a cycle
  through a lazy operand is `macro-cycle` at the same depth as elsewhere.
- Each engine counts its macros (`ce._macroCount`) and keeps their names
  (`ce._macroNames`); an engine with none skips every macro test, and a
  symbol whose name is not a macro name is skipped before any lookup. Raw
  boxing counts the raw nodes that can hold a macro name that it makes or
  takes as they are (`ce._macroSuspects`), so the raw operands of a lazy
  call whose boxing counted none are not walked, and a node that a walk
  found to hold none is not walked again (`boxRawOperands()`, `macroFree`).

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

A lazy collection that is stored in a variable (a `Map` or a `Filter` of an
endless range, a lazy comprehension) is a closure: it reads a parameter, a
binder variable or a block local through the activation it was made in, and
a global when an element is computed ("Lazy view context lifetime" below).
A variable that is an operand of the collection (`xs` in `Filter(xs, p)`)
gives the value it holds at the assignment, so `xs = filter(xs, c => c > 2)`
filters the collection that `xs` held before. Each iteration of a loop has
its own activation, so with
`for d in [3, 6] { if d == 3 { h = map(x => x + d, R) } }`, `h` reads
`d = 3`. With `let d = 3`, `let t = map(x => x + d, 1..oo)` and `d = 5`,
`take(t, 2)` gives `[6, 7]`. A program that needs the elements at a
statement lists them there: `listFrom(take(map(x => x + d, 1..oo), 2))` is
`[4, 5]` after `d = 5`. A finite lazy collection that reads a variable is
listed when it is assigned (`listedAssignedValue()`, `library/core.ts`):
with `let k = 3`, `let t = map(x => x + k, 1..4)` and `k = 10`, `t` is
`[4, 5, 6, 7]`.

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

`isSame()` compares a call by its name, its operands and the function its
head is bound to, as it compares a symbol occurrence (`sameCallHead()`,
`boxed-expression/compare.ts`): a call of the outer `h` and a call of the
inner `h` with the same arguments are not `isSame`, so canonical `Add` keeps
them as two terms. The head is compared as `sameBinding()` compares a symbol:
the same definition or a call-frame activation of it, a parameter of an
enclosing binder at the same position (`f` in `Function(f(x), f)`), or two user
constants with the same value. Two calls that are each a call of the library
operator of their name (`isLibraryOperator()`, `library-shadowing.ts`) are
`isSame`: two engines, and a call made before and one made after an extension
of the library definition that keeps its handlers. A name that a caller
library (the constructor's `libraries` option) defines is not a library
operator here. Two raw calls compare by name; a raw call and a bound call are
not `isSame`. `sameSyntactic()` does not read the binding of a head: the cycle
and progress checks of `simplify()` compare forms that were boxed again by
name. The hash reads only the name, so two calls that are not `isSame` can
have the same hash.

The matcher reads a pattern head that is a library name as the library
function: `match()` makes the pattern structural in the current scope, so the
binding of the pattern head is not read, and a call of a user function `Sqrt`
does not match `Sqrt(_x)`. A pattern head that is not a library name matches by
name. The flag `commutativeMatch` of a library name is read from the
system-scope definition. A repeated wildcard compares its two captures with
symbols by name and call heads by binding (`sameNamesAndCallHeads()`,
`compare.ts`): `Tuple(L, U)` does not match `Tuple(_x, _x)` when `L` and `U`
call different functions, and the parameter `x` of the `Function` of an
`Integrate` and the `x` of its `Limits`, which have different definitions,
still match one `_x`. The structural form of a call keeps the binding of the call, also
when it is read after the scope of the binding ends. (CE-1109.4,
`docs/plans/2026-11-07-ce1109-4-match-and-same-spec.md`; this replaces the
limit that the user accepted on 2026-10-30, by which calls of the same name
were `isSame`.)

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
`boxed-expression/binders.ts`) reads the definition that the occurrence
resolves to from its home scope ("Free names" above). A parameter of a
function literal, a binder variable (`markBinderVariable`: a `Sum` or
`Product` index, a comprehension or loop index, a `D` or `Integrate`
variable) and a block local have their value in an activation, found on the
links from the current lexical scope ("Activations" below). A same-named
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
treated as. Two conditions bound the skip. An occurrence with NO binding that
is not a free name (a raw symbol) still reads the innermost binding
by name, because it denotes nothing in particular; a free name skips the
binder bindings ("Free names" above). An occurrence whose own binding is a
binder's variable reads that definition, with the value of the activation of
the evaluation in progress: two big operators that use the same index name
can be evaluated at once (the asynchronous lane suspends one mid-loop), and
each reads its own iteration.

A declaration in a pushed scope does not re-point an occurrence that was
bound earlier; `ce.rebind(expr)` does. `D`, `Integrate`, `Limit` and `Solve`
hide an assigned value of their variable with a value shield (see "Binders"
below).

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

A node that owns a local scope — a comprehension, a sum, a block — pushes an
activation of that scope on every evaluation ("Activations" below). Its names
resolve from the scopes they were boxed in: a declaration made in a scope
pushed on top of the scope of the node (a child scope that shadows `n` with a
value) is not read.

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

Shielding hides the value of the definition of the variable for the extent
of the evaluation (`withValueShield()`, `boxed-expression/utils.ts`;
`boxed-expression/hidden-values.ts`): a read of the value finds none, the type
and the assumptions are kept, and nothing is written on the definition, so a
shield can run inside a type derivation.

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

Canonicalization establishes identities and types; evaluation owns values.
The definition of a parameter, a binder variable and a block local is the one
that the boxing made (the static definition); an evaluation writes and reads
its value in an activation and makes no definition.

### Block locals

A local of a block is made only by a `Declare` (in Epsil, `let`), and a
`Declare` is allowed only at the top level of a block or of a function body.
The name means the local in the whole block.

- `Block(Declare(c, 5), 2c)` is `10`.
- `Assign(c, v)` writes the `c` that is in scope and never makes one. In a
  block, a function body, a binder body, a branch or a loop body, an `Assign`
  to a name that no scope declares is the error
  `assignment-to-undeclared-variable`: `Block(c := 5, 2c)` with no `c` in
  scope. With a global `c`, the same block gives `10` and the global `c` is
  `5`. Outside every block (`ce.assign('c', 5)`, an `Assign` evaluated at the
  host level), an `Assign` declares the variable in the current scope.
- A `Declare` below a statement (in a branch of an `If`, a loop body) is the
  error `declaration-below-statement`.
- Two declarations of one name in one block are the error
  `variable-redeclaration`; a function statement (`DefineFunction`) of a
  block declares its name too.
- A read before the declaration has run is the error
  `read-before-declaration`. The initial value of a `Declare` is computed with
  the outer name: with a global `z = 9`, `Block(Declare(z, z + 1), z)` is
  `10`.
- An assignment in a value operand to a name that is not declared
  (`Sum(Assign(s, s + i), Limits(i, 1, 3))`) is the error
  `assignment-in-operand`.
- The type of a local is the type its `Declare` gives, or the type of its
  initial value as the boxing types it; `unknown` when nothing is known.

A local that holds a function, whether it is declared with a function
literal, assigned one, or made by a function statement, is a variable: its
definition is a value definition with the declared type (`function` when the
`Declare` gives none), and its value in the activation of the run is a
function value. No signature is derived for it from its body, and a call of
it is typed from its declared type. A call with a list argument takes the
list whole when the parameter type of the function value is a collection,
and maps the call over the list otherwise: `(t: list) ↦ Count(t)` applied to
`[1, 2]` is `2`, `(t) ↦ 2t` gives `[2, 4]`, and `(a) ↦ h(a)`, with `h` a
local, maps the call (nothing is derived for `a` from `h`).

### Activations

Every evaluation of a function literal, of a binder and of a block makes an
activation: the values of its locals for that evaluation, with a link to the
activation in which the literal, the binder or the block was itself
evaluated (`scopeActivation()`, `holdBodyLocals()`,
`boxed-expression/ambient-chain.ts`, `function-utils.ts`). A parameter, a
binder variable and a block local are read by following these links from the
activation of the evaluation in progress (`activationRecordOf()`); there is
no search of the stack of evaluations in progress. A binder that iterates (a
loop, `Sum`, `Product`, a comprehension) makes one activation per iteration
(`renewIterationActivation()`).

A function value keeps the activation it was made in. With
`add(a) := x ↦ x + a`, `g := add(2)` and `h := add(10)`, `g(1)` is `3` and
`h(1)` is `11`. A closure made in an iteration keeps that iteration:
`for d in [3, 6] { if d == 3 { h = (x => x + d) } }; h(1)` is `4`. A call of
a hold function with a `bind` parameter substitutes each held argument, as
the caller boxed it, into the body: `mySum(k^2, k, 3)` is `14`.

`Block` is sequential: later statements observe earlier declarations and
assignments. A consumer translating a simultaneous assignment must snapshot
all right-hand sides before committing any left-hand side.

A free symbol that a `Block` does not declare is not declared by the boxing:
it is a free name of the scope that the expression is written in. After
`ce.box(['Block', ['Add', 'f', 1]])`, the `f` of the block and a later
`ce.box('f')` are `isSame`, and after `f := 5` the block gives `6`. A host can
box a `Block` first and then make it the body of a function literal: an
occurrence of the name of a parameter is then that parameter
(`ce.function('Function', [ce.box(['Block', ['Add', 'x', 1]]), ce.box('x')])`
applied to `3` is `4`). A function literal behaves the same way:
canonicalization wraps its body in a `Block`, and a free symbol of the body is
a free name of the scope that the literal is written in. So the `f` of
`ce.box(['Function', ['Block', 'f'], 'x'])` and a later `ce.box('f')` are
`isSame`, and the literal applied to `3` reads the value of `f`.

Two literals made by two routes are `isSame`: on an engine where `f` is not
declared, `ce.box(['D', ['Function', ['Block', 'f'], 'x'], 'x'])` and a later
`ce.parse('\\frac{\\mathrm{d}f}{\\mathrm{d}x}')` are `isSame`, and both
evaluate to `0`, also after `f := 5`.

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

A lazy collection (a `Map` or a `Filter` of an endless range, a lazy
comprehension) keeps the activation it was made in, as a function value
does: the lexical scope of the evaluation that made it, when that scope's
chain holds an activation (`boxed-expression/lazy-view-context.ts`). Each
read of the collection (an element, its count, its finiteness) runs with
that activation as the lexical scope, so a parameter, a binder variable or a
block local is read there, and a global is read when the element is
computed. A collection that reads no such name keeps no activation. A
collection made outside every activation is read in the context of its
reader, which resolves the same names.

A node of a function body is evaluated by every call of the function, so a
collection that is that node itself is copied before it takes the
activation of a call. A rebuild of a collection by the end of a call (the
substitution of the parameter values) carries its activation. A held
collection that a call returns without evaluating it takes the activation
of the call (`adoptHeldLazyViews`, `function-utils.ts`).

An assignment that stores a lazy collection replaces each operand that is a
variable with the value it holds then (`withOperandValues`,
`library/core.ts`): `xs = filter(xs, p)` filters the collection that `xs`
held before the statement.

## Temporary names

`ce.temporaryName(hint, ...avoid)` returns `<hint>_tmp<n>`, with `n` the
smallest integer from 1 for which the name has no definition from the
current scope and does not occur in `avoid`. A temporary is an ordinary
symbol: the caller declares it in a scope it pushes, or uses it as a
parameter or a binder index, and its definition ends with that scope. The
form `<name>_tmp<n>` is reserved for this method; the engine does not
enforce it.

### Known limitations

- (crafted) A user expression that writes a reserved name (`t_{tmp1}` parses
  to `t_tmp1`) while a temporary of that name is declared in a scope that the
  expression reads gets that temporary.
- (crafted) A temporary held in a stored value, or in an expression boxed in
  a scope that the current scope does not see, is not seen by
  `ce.temporaryName()` when the caller does not pass it in `avoid`: after a
  pop of the scope that declared `s_tmp1`, the next call gives `s_tmp1`
  again, and an expression that holds both reads them as one name.
