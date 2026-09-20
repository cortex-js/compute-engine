# Symbol resolution across Compute Engine and Tycho

Date: 2026-09-19. This records the investigation before implementation.
For the delivered changes and validation, see
[the implementation record](../plans/2026-09-19-symbol-resolution-implementation.md).

Inspected CE main `c899b161`, the uncommitted changes in `ce-wt-ask305` at that
same base, and Tycho `0465b95a9`. Tycho's installed CE is 0.131.3. Unrelated
worktree changes were left alone. Two independent agents investigated Tycho's
type flow and the partial CE fix; the primary investigation also ran direct
source probes.

## Recommendation

Keep the worktree's **explicit-declaration precedence improvement**, but do not
ship `site / followedByGroup / afterGroup` as the final policy interface.

There are three separate jobs:

1. **Binding knowledge:** which declaration a name denotes, and its type.
2. **Notation policy:** how to read a genuinely ambiguous occurrence when
   binding knowledge is insufficient.
3. **Document semantics:** whether a row introduces a definition, and which
   names and parameters that definition binds.

CE should own consistent binding lookup and expression construction. Tycho
should own its document definitions and coefficient convention. A notation
default must not masquerade as an authoritative symbol type. An explicit
notation decision must survive deferred canonicalization.

For Tycho, fix the ordering of its existing registration pipeline before
adding more context-dependent repair rules. It already has much of the
required type infrastructure; some consumers run before it is ready.

## Measured failures

### 1. Tycho stores bodies under a different policy from later parses

For the document `f(x)=a(x+1)`:

- stored function body: `["a", ["Add", "x", 1]]`;
- `f(2).evaluate()`: `["a", 3]`;
- fresh parse after registration: `a * (x+1)` on the right-hand side.

The same happens with uppercase `A`. Both installed CE and the partial fix
produce these results. Thus installing the partial CE fix alone is insufficient.

The manager disables its coefficient policy at
[document-ce-manager.ts:4279](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:4279)
and enables it after registration at
[2093](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:2093).
Body capture canonicalizes while the policy is disabled at
[2445](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:2445).
Later parsing can be correct while the stored lambda remains wrong.

### 2. Tycho loses list interpretation across forward references

| Rows in document order | `f(2).evaluate()` |
| --- | --- |
| `f(x)=L_1+x`; `L=[1,2]` | `L_1 + 2` |
| `L=[1,2]`; `f(x)=L_1+x` | `3` |
| `L=M`; `M=[1,2]`; `f(x)=L_1+x` | `L_1 + 2` |
| `M=[1,2]`; `L=M`; `f(x)=L_1+x` | `3` |

Both CE versions exhibit this. In the failing documents, a fresh parse after
registration correctly recognizes `At(L,1)`.

The so-called head pass caches **full raw rows** through
[_rawCellProjection():1558](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:1558),
before all declarations exist. Later reboxing cannot recover the syntactic
choice erased when `L_1` became an atomic symbol. Tycho's compensating
[_resolveCollectionSubscriptSymbols():8969](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:8969)
checks `_collectionNames`, populated as values bind in document order, rather
than the already available declaration of `L` or the complete staged head set.

CE alone demonstrates the distinction: raw-parse `L_1`, declare `L:list<real>`,
then compare fresh parsing with reboxing the cached JSON. Fresh parsing gives
`At(L,1)`; reboxing gives symbol `L_1`. Reboxing also creates an inferred
declaration of the joined name, after which another fresh parse preserves
`L_1` too. Repair must avoid allowing artifacts of an earlier parse to become
evidence that the author declared a separate symbol.

### 3. A resolver type is not equivalent to a declaration

On both CE versions:

| Information supplied for `f` | Input | Result |
| --- | --- | --- |
| `ce.declare('f','list<real>')` | `f(x+1)` | Multiplication, type `list<number>` |
| Resolver returns `list<real>` | `f(x+1)` | Multiplication, type `number`; `f` inferred as `number` |
| `ce.declare('f','real')` | `f(x,y)` | `expected-function` error |
| Resolver returns `real` | `f(x,y)` | Call; `f` inferred as `function` |
| `ce.declare('f','real')` | `f()` | Type error |
| Resolver returns `real` | `f()` | Call; `f` inferred as `function` |

The current resolver participates in selected syntax decisions, but its type
is not consistently available to boxing, type checking and inference. This
must be fixed if the intended contract is “external type information that has
not been recorded with `declare()`.” More context alone cannot fix it.

This does not imply that every collection application is invalid. CE has
intentional collection-application semantics, including set adjunction; see
[box.ts:2330](/Users/arno/dev/compute-engine/src/compute-engine/boxed-expression/box.ts:2330).
That behavior needs separate preservation tests.

### 4. The partial context does not preserve decisions

In the worktree, install a policy for `a` that returns `value` when
`context.afterGroup === '+'` and `function` otherwise. Raw parsing of
`a(x)+1` leaves a product-compatible `InvisibleOperator`; canonicalization
turns it into a call. Canonicalization asks the callback again, now without
the token that justified the first answer.

Likewise a per-call `value` answer yields multiplication during immediate
canonical parsing, but raw parsing followed by `.canonical` yields a call.
This lifetime problem already exists on main.

The worktree documents these limitations and offers a `site:'canonicalize'`
workaround. That makes the host compensate for CE's loss of information.
[oracleHeadType():1026](/Users/arno/dev/ce-wt-ask305/src/compute-engine/boxed-expression/invisible-operator.ts:1026)
is the second consultation. Explicit product decisions are not distinguished
from still-unresolved juxtaposition.

### 5. A following `=` is not a definition context

Using the worktree's example policy, “function before `=`, value otherwise”:

| Source | Observed problem |
| --- | --- |
| `a(x)+a(x)=0` | First occurrence is multiplication, second a call |
| `(f(x))=y` | Parentheses hide the supposed definition position |
| `f(x+1)=y` | Accepted as a call despite the argument not being a formal parameter |
| `f(x)=f(x+1)` | Left uses a call, right multiplication; engine ends with `f:number` |

These are failures of that policy as a **definition recognizer**, not proof
that arbitrary occurrence-specific notation is inherently wrong. A following
token cannot tell whether the candidate occupies the entire left operand,
whether parameters are valid, or whether this row is a definition at all.
Tycho deliberately treats some later `f(x)=...` rows as equations against an
existing definition. Its first-definition/later-equation rules must remain
part of the host's document analysis.

## What already works and should be retained

Tycho is not missing a symbol table wholesale:

- Sliders are declared `real` and axes `number` before row registration
  ([4349](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:4349)).
- Function heads, arities, parameter evidence and value shapes are collected;
  signatures and value types are published with `ce.declare()`
  ([6382](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:6382),
  [6531](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:6531),
  [6571](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:6571)).
- Parameter scopes exist, with derived types or an open fallback
  ([2297](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:2297)).
- Value-type derivation recognizes lists, points, tuples and other shapes,
  while leaving insufficient evidence unknown
  ([8278](/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts:8278)).
- Compile scopes declare scalar/list/point input partitions
  ([compiled-body.ts:2220](/Users/arno/dev/tycho/src/plot-core/compiled-body.ts:2220)).
- Normal rebuilds clear raw caches and reconstruct the document scope. An
  ordinary function deletion correctly removes its function classification.

The failure is chiefly **within a registration pass**: syntax is interpreted
under incomplete facts, carried forward, then partly repaired against
registries that do not all represent the same environment.

The partial CE fix does improve precedence. On main, Tycho's global function
vouch overrides a local `f:number` or a parameter `f:any`. The worktree honors
both local declarations and produces multiplication. Retain that improvement.

However, its `isEngineGuess()` also groups an explicitly declared `unknown`
with inferred guesses. Preserve the distinction between **binding identity**
and **type completeness**: a local declaration still shadows an outer binding
even when its type is unknown. It must not acquire an outer function's type
merely because their names match.

## Proposed contract

### Binding lookup and type facts

Resolve lexical identity first. Then use explicit declared/assigned knowledge
for that binding, externally supplied facts when needed, and inferred evidence
as weaker information. Known declarations should not invoke a default handler
that can contradict them. Parser-local binders, supplied scopes, diagnostics,
subscripts, boxing and canonicalization should share this rule.

Keep `resolveSymbol` for external binding/type facts. Context can identify the
scope, use and source span if needed, but an answer is knowledge about the
resolved binding. A real `list<real>` answer must reach downstream type checking
as a list, including deferred canonicalization; it cannot be discarded after
selecting multiplication.

Use the existing scope/transaction machinery to retain those facts with the
expression's semantic environment. Do not mutate global declarations from
speculative callback invocations or use a name-only global cache. A bare JSON
tree exported to another engine still requires its binding environment to be
provided there; JSON serialization alone cannot preserve every symbol type.

`undefined` means no external fact. `unknown` means missing type information.
`value` expresses the known non-function category in CE's type system. Do not
use `unknown` as an undocumented synonym for a scalar or as a durable proof
that a binding is not callable. Existing host uses of these types need an
explicit migration when the ambiguity rule is changed.

### Occurrence interpretation

Prefer a separate optional hook for unresolved application-shaped notation,
illustratively `resolveApplication(context) -> 'apply' | 'multiply' | undefined`.
It runs after binding facts, and cannot override a known declaration. This is
not a second competing type resolver: it returns an operation, not a type.

If retaining one callback is preferable, use discriminated questions and
answers that distinguish a binding fact from a notation decision. Do not keep
overloading `{type:'value'}` to mean both.

Useful context consists of the head and source span, parsed arguments and
delimiter kind, and structural position in the enclosing expression. If a
host needs relation position, expose the enclosing operator, operand index,
and whether this occurrence occupies that entire operand. Normalize spelling
through the grammar; do not make hosts decode `':'`, `'<}>'`, sized
delimiters, or spacing macros. These are proposed capabilities, not a final
public type declaration.

The host's definition-header analysis should normally make the occurrence
hook unnecessary for the defining head: declare that head before interpreting
the body. A bare call/product decision cannot establish parameter scope or
recursion by itself.

Preserve explicit choices as ordinary `Multiply`/application syntax, or as a
serializable decision on a retained ambiguity node. Raw and structural forms
can preserve authored layout without losing that decision. Only unresolved
or explicitly provisional candidates should be eligible for later inference.
Direct `ce.box(InvisibleOperator(...))` remains a route with no source context;
it may use known types and a structural default, without inventing a parse
phase or following token. Existing forward-reference re-derivation can remain
for provisional expressions; changing a document's declarations should trigger
re-resolution/reparsing of dependent source, not secretly reverse an explicit
per-call policy during ordinary `.canonical` access.

### Heuristics

Centralize the type-to-operation decision and invoke defaults only after it.
The same rules must cover lowercase/uppercase heads, scalar and collection
arguments, argument arity, powers, factorials and indexing suffixes.

Today `f(f+1)` multiplies but `F(F+1)` calls because uppercase commits earlier.
Likewise undeclared `f(x)[1]` becomes `f * At(x,1)`, while known-function `f`
produces `At(f(x),1)`. Preserve enough syntax to make these decisions together.
Keep predicate inference in its relevant logical context; a blanket uppercase
rule should not bypass a host's numeric notation policy.

For ordinary Tycho numeric plotting:

| Evidence | Reading of `f(x+1)` |
| --- | --- |
| `f` is a function | Application |
| `f` is a scalar | Multiplication |
| `f` is a numeric list | Multiplication/broadcast according to arithmetic rules |
| No usable fact about a plain identifier | Tycho's coefficient default |

Parentheses alone are not evidence that the head is a list. Index notation,
function-return types and stored definitions supply that information. CE can
retain its general-mathematics default for unresolved names; Tycho need not
change that default globally.

## Implementation order

1. **Pin the actual failures.** Add regression tests from these probes. Tests
   must compare registered bodies, fresh parsing, evaluation and compiled
   behavior, not just a standalone parser tree.
2. **Extract CE precedence work.** Keep explicit declarations ahead of the
   callback, audit local/unknown binding shadowing, and centralize the rule.
   Do not make adoption depend on publishing `afterGroup`.
3. **Repair Tycho registration in a bounded change.** Harvest definition
   headers and retain body source without accepting early raw bodies as final.
   Publish all names and directly known scalar/list/function kinds. Enable
   coefficient policy for body interpretation after that point. Parse bodies
   under parameter scopes and the completed environment. Rebuild dependent
   bodies when additional type evidence arrives. Preserve current duplicate,
   recursive-clause and later-equation semantics.
4. **Make type propagation order-independent.** Resolve value aliases and
   function result evidence through a dependency worklist; leave unsupported
   cycles unknown rather than guessing from document order. Use disposable
   inference scopes and the existing rollback facilities. Distinguish this
   type dependency order from Tycho's deliberate first-definition ordering.
5. **Make CE external facts and notation decisions reliable.** Implement the
   contracts above; preserve per-call decisions, unify heuristic paths, and
   ensure actual resolver types reach inference. Adopt the final policy from
   Tycho's engine profiles and remove the corresponding repair walkers only
   once their cases pass through the shared mechanism.

A shared, immutable symbol environment per document revision is the target;
this does not require persisting type objects in document storage or writing
a complete new parser. Initially, reparsing retained body source after the
declaration pass is safer than extending the growing family of partial AST
repair walkers. Cache resolved parses against the relevant binding/type and
policy revision, not LaTeX text alone. A syntax-only cache is reusable only if
it actually preserves all unresolved distinctions.

Implementation constraints in Tycho:

- `ce.declare()` cannot repeatedly replace the same name in the same scope.
  Build candidate types in an analysis environment and materialize a fresh
  final scope, or use a supported refinement mechanism with a clear lifetime.
  Preserve bare `function` for evidence-free signatures: declaring an
  `(unknown) -> unknown` signature currently fixes the return as unknown
  instead of allowing assignment-time inference.
- Retain the authored row and its scoped prefixes. The current header reader
  preserves local `Block` definitions before the right-hand side; simply
  splitting at `=` and reparsing only the apparent RHS would lose them.
- Preserve existing exclusions for action-controlled and live collection
  widths. An environment revision describes declarations and type facts; it
  must not freeze slider values or a dynamic list length. Recursive functions
  can have known identity and arity while their result shape remains unknown.

## Acceptance cases

- All four ordinary readings above; invalid scalar calls with zero/multiple
  arguments; existing set/collection application semantics.
- Direct declaration versus external resolver fact, including result type,
  validity and compiler behavior, not only JSON equality.
- Immediate canonical parse, raw/structural then canonical, per-call versus
  engine-wide hooks, and JSON reboxing with the same environment.
- Whole definition heads, nested relations, redundant grouping, invalid
  parameter lists, `:=` and custom dictionary spellings.
- Forward function calls, list references and aliases in either row order;
  list-returning `f(x)[1]`; explicit joined names such as `L_1` alongside `L`.
- Parameter shadowing, binder-local names, recursive self-use, and edits
  changing a symbol between scalar/list/function or removing it.
- No premature declarations or inference leakage from header discovery;
  no semantic dependence on abandoned speculative callback calls.

## Verification and artifacts

Runnable observational probes (they print current behavior, not pass/fail
assertions for the proposed design):

- [CE probe](2026-09-19-symbol-resolution-probe.mjs)
- [Tycho integration probe](2026-09-19-tycho-symbol-resolution-probe.mjs)

From the CE repository:

```sh
node --import tsx docs/scratch/2026-09-19-symbol-resolution-probe.mjs
node --import tsx docs/scratch/2026-09-19-symbol-resolution-probe.mjs ../ce-wt-ask305
node --import tsx docs/scratch/2026-09-19-tycho-symbol-resolution-probe.mjs ../tycho
node --import tsx docs/scratch/2026-09-19-tycho-symbol-resolution-probe.mjs ../tycho ../ce-wt-ask305/src/compute-engine.ts
```

All four completed. Existing focused suites also pass:

- CE main: juxtaposition, parsing, subscript declared-name precedence —
  **3 suites, 190 tests, 131 snapshots**.
- Partial fix: juxtaposition and parsing — **2 suites, 174 tests, 131 snapshots**.

These passing suites do not establish the missing contracts. The additional
probes demonstrate gaps outside their assertions. No full Tycho build, browser
suite, compiled-result validation, or performance benchmark was run for this
recommendation. No production source, dependencies, or existing partial-fix
files were changed.

Two lower-priority observations: the worktree's group cache avoids repeating
the same scan but nested distinct groups still have overlapping scans; a
single delimiter index would be needed for a linear worst-case bound. Also,
Tycho's additive `seedDocumentFunctionHeads()` can keep a deleted name vouched,
but no current production call sites were found; this is an API lifecycle
cleanup, not a demonstrated active UI failure.
