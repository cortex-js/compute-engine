# Epsil import system

**Status:** DRAFT — selected design decisions accepted; remaining proposals
are identified below. Not implemented.
**Date:** 2026-09-05
**Scope:** source modules, explicit exports, selective and bulk imports.

## 1. Proposal at a glance

Keep the proposed source-first syntax:

```epsil
from "./geometry.epsil" import circleArea, circumference
from "./geometry.epsil" import circleArea as area
from "./geometry.epsil" import all
```

One source file is one module. A module declares its public interface with
`export`; everything else is private. `all` means all explicitly exported
names, not every binding in the file or its dependencies. Imports introduce
read-only bindings and never silently replace another binding in the same
scope. Modules initialize once per execution session, in dependency order.

Agreed direction: explicit exports; immutable exports only; staged delivery;
module-owned free symbols; reset-to-reload; explicit relative `.epsil` paths
initially. Namespace imports are desirable but deferred. Leave room for future
dynamic imports and additional specifier forms, including URLs and implicit
names. Static top-level placement and rejecting cycles remain recommendations
for the first version. Type and protocol imports require identity and registry
work before they can ship safely.

Section 11 records the accepted decisions and remaining questions. Detailed
rules not covered by an accepted decision remain proposals. Section 6.1
records the accepted initialization restrictions; their checking and runtime
enforcement still need implementation design.

## 2. Lessons from other languages

| Language | Relevant behavior | Lesson proposed for Epsil |
| --- | --- | --- |
| Python | `from … import …` supports aliases. Wildcard imports use `__all__`, or otherwise names not starting with `_`. Named imports bind references to values. | Keep the readable syntax and aliases; make the public interface explicit instead of deriving it from spelling. |
| JavaScript modules | Static imports and explicit exports describe dependencies; named imports link to exported bindings. Namespace imports offer qualified access. | Separate discovering/linking dependencies from executing code. Do not treat an import as textual inclusion. |
| Julia | Modules separate namespaces. Bulk imports can make names ambiguous; explicit imports also control unqualified method extension. | Diagnose collisions and specify whether importing a function grants extension rights. |
| Go | Imports use string paths and can rename the package locally. Direct and indirect import cycles are forbidden. | Separate the source identifier from the local name; reject cycles initially to avoid partially initialized modules. |

Sources: [Python import statements](https://docs.python.org/3/reference/simple_stmts.html#the-import-statement),
[ECMAScript modules](https://tc39.es/ecma262/multipage/ecmascript-language-scripts-and-modules.html#sec-modules),
[Julia modules](https://docs.julialang.org/en/v1/manual/modules/), and
[Go import declarations](https://go.dev/ref/spec#Import_declarations).
The Epsil recommendations are design judgments, not claims of equivalence to
these languages.

The central tradeoff is convenience versus a predictable interface. An
implicit-public model makes a small script immediately importable, but adding
a helper can change its consumers. Explicit exports cost one declaration and
make `import all` substantially easier to reason about. Adding an export can
still break a wildcard consumer through a name conflict; selective imports
remain the recommended library style.

## 3. Syntax

```text
import-statement ::= "from" module-path "import" import-selection
import-selection ::= import-list | "(" import-list [","] ")" | "all"
import-list      ::= import-item ("," import-item)*
import-item      ::= name ["as" name]
export-statement ::= "export" export-selection
export-selection ::= export-list | "(" export-list [","] ")"
export-list      ::= export-item ("," export-item)*
export-item      ::= name ["as" name]
module-path      ::= non-interpolated single-line string literal
```

`name` uses Epsil's ordinary symbol syntax, including verbatim names and
existing identifier normalization. It is not an arbitrary expression. In an
import item the first name is the public name and the second is its local
alias. In an export item the first name is local and the second is public.

```epsil
from "./geometry.epsil" import (
  circleArea as area,
  circumference,
)
```

Parentheses permit newlines and a trailing comma. Unparenthesized lists end
at the normal statement boundary and have no trailing comma. Comments and
whitespace otherwise follow existing Epsil rules.

`from`, `import`, `export`, `as`, and `all` should be contextual keywords:
claimed in these grammatical positions, ordinary names elsewhere. The parser
recognizes an import at statement-leading `from` followed by a string, and an
export at statement-leading `export` followed by a name or list. Existing
uses such as `from = 2` remain assignments. Ambiguous uses can use verbatim
names. The exact lookahead needs parser tests before finalizing this choice.

Bare `all` anywhere in an import selection is reserved for bulk import:
`all, foo`, `all as m`, and `(all)` are rejected. To import an export literally
named `all`, write its verbatim form:

```epsil
from "./predicates.epsil" import `all` as every
```

There is no `*` synonym, empty import list, default export, declaration-prefix
`export const`, or `export all` in this draft. One way to write an export
keeps the initial grammar small.

## 4. Module boundaries and exports

```epsil
// geometry.epsil
export circleArea, circumference

const tau = 2pi
const circleArea = (r) => pi * r^2
const circumference = (r) => tau * r
```

```epsil
// main.epsil
from "./geometry.epsil" import circleArea as area
area(3)
// Expected: 9pi, under normal exact evaluation
```

Each imported file has a private lexical environment containing its own
declarations and imports, with the standard library as its parent. It does
not inherit the importing file's or notebook's variables, assumptions, types,
or user function definitions. Its functions retain their defining environment
when called by a consumer. Importing does not paste declarations into the
consumer or evaluate function bodies in the consumer's environment.

An export list may appear anywhere at top level and refer to declarations
later in the file. It is interface metadata, not an executable statement, and
does not alter the file's last-expression value. Multiple export statements
combine; duplicate public names are errors even if they name the same binding.
A missing local export target is an error before initialization.

First-version export targets are initialized `const` bindings and named
function definitions. Exporting a function makes its definition read-only
after module initialization. Mutable `let` bindings, uninitialized symbols,
and names introduced only by bare assignment cannot be exported. Section 6.1
proposes restricting persistent private state as well, while allowing local
scratch bindings during computation. Exporting a function does not imply that
calling it is pure; its normal effects still matter.

Explicitly imported immutable bindings may be explicitly re-exported:

```epsil
from "./geometry.epsil" import circleArea
export circleArea as area
```

Re-exporting preserves the original binding identity. Ordinary imports are
never automatically re-exported. Built-ins are not implicit export targets;
use an explicit local `const` alias to expose one. A file with no export list
exports nothing; `import all` then binds nothing but still initializes it.

Source privacy is an interface boundary, not a security sandbox. Imported
code runs with the capabilities the host grants its execution session.

## 5. Bindings, conflicts, and symbolic expressions

An import binds exactly the requested names. It does not also introduce the
filename as a name. Named import of a non-exported name is an error, even if
that name exists privately in the source.

Imported names are read-only references to export identities, not textual
substitutions. Aliasing changes the consumer's spelling, not the function's
parameters, behavior, effects, or identity. The immutable-export restriction
avoids choosing between mutable live bindings and value snapshots in v1.

Assignment to an imported name follows Epsil's read-only-binding error
behavior. Defining new clauses or methods on an imported function is also
forbidden; importing grants use, not permission to modify its definition.

Conflicts are checked after expanding all imports and before any module in
the new dependency graph executes:

- Two imports introducing the same local name are an error, including two
  imports of the same binding. Use a single import or different aliases.
- A local declaration and an import with the same name are an error,
  regardless of their textual order.
- Bulk imports never skip conflicts or overwrite earlier names. They have
  the same binding behavior as an explicit list of the module's exports.
- An import can shadow an outer standard-library binding, just as an Epsil
  declaration can. A nested local declaration can shadow an imported name.

For example, importing `sin` must prevent the lowercase-library resolution
pass from rewriting that binding's uses to `Sin`. Export-name lookup is exact
after normal identifier normalization: importing `Sin` does not implicitly
request a module's `sin`, and importing `foo` does not create `Foo`.

Epsil's symbolic behavior needs an additional invariant: a consumer's
`let x = 10` must not accidentally capture a module's private symbolic `x`.
The agreed direction is to preserve module identity on unresolved symbolic
names, as on declared bindings. Passing a symbolic argument deliberately into
an exported function preserves the argument's original identity.

How module-owned symbols print, round-trip through MathJSON, interact with
verbatim raw symbols, and participate in substitution remains a design gate.
It is not sufficient to prefix function names and leave symbolic bodies
unqualified. This part must be settled before claiming module isolation works
for general symbolic libraries.

## 6. Placement and loading

Imports are static declarations, permitted only in an initial top-level import
section. Blank lines, comments, existing source directives, and export lists
may be interspersed; ordinary executable statements end the section. Imports
inside a function, conditional, loop, or block are errors. Exports are also
top-level only. These restrictions allow the dependency interface to be known
before evaluation without hoisting imports across visible side effects.

The loader performs these conceptual steps:

1. Discover sources and their import/export declarations without executing
   Epsil code. Resolve the complete reachable dependency graph.
2. Link interfaces, expand `all`, and validate imports, exports, duplicate
   bindings, and cycles. Then complete semantic analysis with the linked names
   available. Any static failure prevents execution of this new graph.
3. Initialize dependencies before dependents, traversing each file's imports
   in source order. Initialize a shared dependency once at its first visit.
4. Evaluate each module's ordinary statements in source order in its private
   environment. Publish its exports only after successful initialization.
5. Install the entry program's imports and execute its ordinary statements
   using its existing execution-scope behavior.

A direct or indirect cycle is a link error, reported with the complete cycle
of source paths. There are no observable partially initialized exports.
Supporting mutually recursive modules later would require a separate design;
recursion within a single module retains normal Epsil behavior.

Under the revised proposal in section 6.1, initialization may compute constants
but cannot perform I/O or leave persistent mutable state. Importing only one
name still initializes the module and all its dependencies. The module's final
expression is not its export object or a value yielded by the import. An
import has no user-visible result and should not echo a dependency's final
expression in a REPL.

Resolution and linking failures are diagnostics at the import site, with
notes into the dependency where applicable. Initialization stops on the first
top-level statement whose result is an Epsil error value, including the final
statement. The host receives that error and its source/import chain through
the normal result channel, not an uncaught host exception. This deliberately
makes an error-valued initializer a failed module, even if authored explicitly;
a function returning an error later is an ordinary exported function.

A failed module publishes no exports and its dependents do not execute.
Already completed dependencies remain initialized. Discard the failed module's
unpublished environment. Failed initialization is cached for the session as
well, so repeated imports have a stable result and do not repeat failed work.
Resetting the session permits a new attempt. The initialization restrictions
prevent Epsil-level external side effects; they do not promise to roll back
host source acquisition or resource consumption.

### 6.1. Restricted initialization and persistent state

**Clarified scope:** restrictions concern code executed while loading a module.
Exported functions may have any normal Epsil effects when called. The earlier
recommendation to allow arbitrary initialization effects is superseded.

**Accepted policy:** initialization computes an
immutable module environment. Allow deterministic computation and temporary
local mutation; prohibit external effects and persistent mutable state created
during loading. These are two separate restrictions: banning import-time I/O
alone would still permit a shared counter initialized to zero.

| During initialization | Proposed rule |
| --- | --- |
| Declare constants, symbolic expressions, and functions | Allowed; defining an effectful function does not call it. |
| Precompute an immutable lookup table or numerical constant | Allowed, within evaluation budgets and the session's fixed numerical configuration. |
| Use a loop and local accumulator inside a computation | Allowed when writes are confined and only an immutable result escapes. |
| Print, access files/network, read the clock/environment, or draw from ambient randomness/entropy | Rejected, including through a helper or dependency initializer. |
| Modify caller bindings, assumptions, or existing engine registries | Rejected; the host establishes module identities separately. |
| Create a persistent mutable module binding or a closure retaining mutable state | Rejected. |
| Call a factory after importing it | Ordinary execution: state and effects are permitted by its normal contract. |

For example, initialization can compute an immutable result using temporary
mutable bindings:

```epsil
export sumOfSquares

const sumOfSquares = do {
  let total = 0
  for k in 1..100 {
    total = total + k^2
  }
  total
}
```

The accumulator belongs to the computation and does not escape. The module
retains only its result. Conversely, this proposed module would be rejected:

```epsil
export next
let n = 0                        // Persistent mutable module state
function next() scope -> integer {
  n = n + 1
  n
}
```

The issue is the lifetime of `n`, not the permission for a function to have a
`scope` effect. Move construction of the state into an explicitly called
factory:

```epsil
export makeCounter

function makeCounter() {
  let n = 0
  function next() scope { n = n + 1; n }
  next
}
```

Consumers decide when to call `makeCounter()` and whether to share the returned
closure. The function and closure keep their normal effects. Importing the
factory creates no counter. Calling it during module initialization and saving
the result as `const counter = makeCounter()` would still be rejected: `const`
protects the binding, but the closure retains changing state. This rule applies
to private helpers as well as exports, and to mutable objects/resource handles
if those become available. It does not forbid an exported function from
creating state, retaining caller-supplied state in a returned closure, or
performing I/O when called after initialization.

Canonical identity still prevents duplicate initialization of the same module
within a session. It cannot promise a process-wide singleton across engines,
workers, dependency versions, or genuinely distinct source identities. Avoiding
implicit persistent state makes this boundary less surprising. It does not
make nominal types, module-owned symbols, or function identities interchangeable
across separate module instances, nor authorize arbitrary re-initialization.

An alternative is to enforce only initialization without external effects and
allow explicitly documented per-instance mutable globals. That permits module
caches and shared counters, but makes their instance lifetime part of the API.
The stronger no-persistent-mutable-state rule is accepted for the first
version; allowing module caches or shared state later needs an explicit design.
Ordinary runtime allocation by a called factory remains available immediately.

#### Checking the initialization boundary

Analyze the code actually executed to construct the module, including helpers
and dependency initializers, separately from the bodies of functions merely
defined or returned. An initializer invoking an exported effectful function
must satisfy the same restrictions as a direct effectful call. Unknown call
effects (`any`) cannot establish compliance; diagnose them conservatively
unless a checked contract proves the call admissible. Defining or exporting
such a function is allowed.

The [effects model](../EFFECTS-MODEL.md) already distinguishes confined local
writes from escaping `scope` writes, but its function-local rules do not yet
constitute an initialization checker. Establishing a module's declarations is
permitted construction; mutation of pre-existing state is not. A retained-state
analysis is also needed to reject a closure counter hidden behind `const`.
For a conservative first implementation, persistent module value bindings must
be `const`, module function definitions become immutable when initialized, and
retained captures must be proven immutable. Temporary `let` bindings are allowed
inside computations whose mutable bindings do not escape. Captured `let`
bindings may be rejected even if a more elaborate analysis could prove they
are never written later; no implicit freezing or copying is proposed.

Reads of non-local bindings are not an effect label in today's model, so an
empty effect set alone does not prove deterministic initialization. Initializer
inputs must resolve to immutable module/dependency bindings, built-ins, symbolic
inputs with module identity, and the fixed execution configuration, without
reading mutable caller state. Retain dependency tracking and effect contracts
through imports. For future type/protocol support, registration of a module's
own declarations is loader work; conformance visibility must be reconciled
with this restriction before that stage ships.

Reject statically identifiable violations before any initializer runs. Execution
must also enforce capability restrictions at host-call boundaries, including
opaque host functions, before a forbidden operation occurs; checked declarations
must not become a way to bypass the restriction. This enforcement belongs to
the initialization context and ends before ordinary consumer execution.
Loops and allocations still consume time and memory, so cancellation and
resource limits apply even to admissible computation.

Host resolution and source acquisition are separate from executing the loaded
Epsil code: local imports require source reads, and future URL imports may
require a host fetch. This permits the host to obtain a declared dependency;
it does not grant the module initializer arbitrary filesystem or network access.
No new `pure` keyword or module annotation is needed for the proposed default.

## 7. Paths, identity, and hosts

The string is a **module specifier**. The host resolves it to a canonical
module identity and loads its source; the parser never reads files or fetches
resources. A static import's specifier cannot contain interpolation or be
computed at runtime. Future dynamic imports may take computed specifiers
(section 12) without weakening static import syntax.

The initial portable file profile accepts explicit relative paths beginning
with `./` or `../`, ending in `.epsil`, resolved relative to the importing
source's canonical location. There is no implicit extension, directory index,
working-directory search, or package search. Path strings follow host path
case rules, not identifier normalization. Canonical identity must collapse
equivalent paths, including symlinks in a filesystem host.

The original `from "path" import foo` shape remains the grammar; under this
first profile, a concrete file is written `"./path.epsil"`. Bare names such as
`"statistics"`, `std:` identifiers, absolute paths, and network URLs are
reserved for a separately specified resolver profile. They produce an
unsupported-specifier diagnostic initially, rather than guessing a location.

The same canonical source identifies one module per execution session. Two
engines do not share evaluated module instances or boxed values. Source and
interface caches may be shared only where doing so cannot share runtime state.
A session freezes a module's loaded source; changing the file does not silently
replace its exports. Reloading requires a fresh session in v1.

A CLI file uses its file location as the entry base. REPL, stdin, `--eval`, and
unsaved notebook programs need a host-provided base location; without one,
relative imports report a missing-base diagnostic. A CLI may document a
working-directory base for these entry modes, captured when the session starts.
That policy never changes how dependencies resolve their own relative paths.

An editor may read and analyze dependencies for completion and diagnostics but
must not execute them. Browser hosts can supply virtual sources with stable
identities; the language does not itself grant filesystem or network access.
Loading and evaluation must both respect the host's cancellation and resource
budgets. Async loading should be introduced through a separate preparation or
async execution API, preserving the current synchronous `executeEpsil()` API
for programs and hosts that do not need it. Exact API names are not specified
here.

## 8. REPL and notebook behavior

Each input/cell has its own initial import section. Repeating an import in a
later input is idempotent when its local name still refers to the same export
identity. A duplicate within one input remains an error.

A later input importing a different export under an occupied session name is
an error. To switch, use an alias or reset the session. The draft also proposes
that a later `let` or `const` cannot replace an imported binding implicitly;
this is stricter than ordinary cross-input redeclaration and needs agreement.
Nested local shadowing remains legal.

Rerunning a cell does not reload its dependencies. Removing an import line
does not by itself remove a binding left by an earlier execution, consistent
with a persistent session; a notebook promising clean replay must reset and
rebuild the session. Snapshot/restore must preserve module instances, their
source versions, and binding identities, or reject such snapshots explicitly.

Executing a file as the CLI entry program keeps normal Epsil top-level
execution behavior. Importing that file elsewhere creates a private module
instance; shared source text does not make those two execution modes share
state. There is no main-entry guard syntax in this proposal. Libraries should
keep command-line work in a separate entry file.

## 9. Types and protocols: target contract and prerequisite

Epsil currently makes named types and protocols engine-global. Private value
scopes alone therefore cannot provide module isolation. The intended contract
is:

- Type and protocol identity is owned by a module, not just a bare name.
  Two modules declaring `point` create distinct nominal types.
- Importing a nominal type under an alias exposes its type and constructor
  under that alias without constructing a new nominal type. Type aliases
  preserve their existing structural/alias semantics.
- Exporting a sum type does not implicitly export every variant name;
  constructors intended for direct use are listed explicitly. Their type
  identities and exhaustiveness metadata remain attached to the parent type.
- Importing a protocol does not implicitly import all its operation names;
  these are separate explicit exports. Linking preserves their association
  with the protocol, including when names are aliased.
- A private type may occur in an exported function's signature or result;
  consumers can use the value without gaining the private type's source name.
  Diagnostics and tooling must still be able to describe its provenance.

Protocol conformance also changes shared dispatch behavior. Proposed ownership
rule: a module may introduce a conformance only when it owns the nominal type
or the protocol. Importing both does not grant permission to change a foreign
pair. This is a new restriction for modules, not a description of today's
interactive conformance rules. Cross-module duplicate conformances must fail
during linking, not depend on load order.

Until these contracts are implemented, an initial values/functions milestone
must diagnose user type declarations, protocol declarations, and conformance
declarations anywhere in loaded modules. It must also reject re-exports of
unsupported declaration kinds. It must not quietly put private declarations
into today's global registries. Existing built-in types remain usable.

## 10. Implementation implications and acceptance examples

Current integration points:

- [`parse-epsil.ts`](../../src/epsil/parse-epsil.ts) and
  [`parser.ts`](../../src/epsil/parser.ts): retain import/export declarations
  and source locations without loading code. Discover interfaces before
  parsing dependent type annotations that need imported type names.
- [`execute-epsil.ts`](../../src/epsil/execute-epsil.ts): introduce a module
  preparation/linking boundary before boxing and ordinary execution; preserve
  current entry-program behavior.
- [`resolve-library-names.ts`](../../src/epsil/resolve-library-names.ts),
  occurrence tracking, and static diagnostics: recognize imports as binders
  before resolving standard-library spellings, including expansion of `all`.
- Serialization and compilation: preserve aliases, defining environments,
  effects, and module-owned identities. Raw parsing/serialization must round-
  trip import syntax without reading the referenced source. The exact AST
  representation remains open; imports must not become ordinary eager calls
  to a function named `Import`.
- CLI, REPL, notebook, MCP, and language server: supply source identities and
  resolver capabilities, surface dependency diagnostics, and share the same
  resolution rules. Formatting alone must never load dependencies.

Relevant existing contracts are documented in
[declarations](../../src/epsil/docs/declarations.md),
[evaluation](../../src/epsil/docs/evaluation.md),
[naming](../../src/epsil/docs/naming.md),
[protocols](../../src/epsil/docs/protocols.md), and
[source code](../../src/epsil/docs/source-code.md).

Minimum acceptance cases for an implementation:

| Case | Expected behavior |
| --- | --- |
| Named import and alias | Only selected local names appear; calls retain the defining module's scope. |
| Missing/private export | Link diagnostic at the requested name; no new graph execution. |
| `import all` | Only explicit public names bind; no inherited built-ins or private helpers. |
| Conflict after `all` expansion | Error before initialization, with both declaration locations. |
| Import named `sin` | Calls use the imported function, not the standard library alias. |
| Assign/define a clause on an import | Read-only-binding error; original definition unchanged. |
| Initializer computes a constant with a local accumulator | Allowed when only the immutable result escapes. |
| Module retains a mutable counter, directly or inside a `const` closure | Rejected under the accepted persistent-state restriction. |
| Consumer calls an imported counter factory | Allowed; each call creates explicitly owned state and preserves closure effects. |
| Initializer calls an effectful helper or imported function | Rejected before forbidden effects occur, just like a direct effectful call. |
| Diamond dependency or equivalent paths | Shared module initializes exactly once per session. |
| Import cycle | Link error shows the cycle; no module in the new graph runs. |
| Initializer attempts console output or a network request | Rejected; the forbidden operation never occurs. |
| Initializer fails during admissible computation | No exports published; repeat import reports cached failure until reset. |
| Consumer defines a module helper's name | Exported function still uses its own helper. |
| Consumer defines a module symbolic name | No accidental capture; explicit symbolic arguments retain caller identity. |
| File changes during a session | Existing instance remains; fresh session sees changed source. |
| Same import in later REPL input | Reuses instance and local binding; duplicate in one input errors. |
| Missing base or unsupported path form | Clear resolver diagnostic; no fallback search. |
| Interpolated path or nested import | Syntax/placement diagnostic without source loading. |
| User type/protocol in initial restricted milestone | Explicit unsupported-feature diagnostic, no global registration. |
| Future type aliases from two modules | Distinct nominal origins remain distinct; two aliases of one origin agree. |

No runtime implementation or executable test changes are part of this draft.

## 11. Decision record and remaining questions

Accepted in the 2026-09-05 discussion:

1. **Explicit exports.** `all` selects the explicit public interface.
2. **Defer namespace imports.** They are desirable; a candidate spelling is
   `from "./geometry.epsil" import all as geometry`. Namespace values, member
   calls, and qualified type names need a contract before this ships.
3. **Immutable exports only.** Export immutability does not promise pure
   function calls. Mutable export bindings are outside the agreed design.
4. **Staged delivery.** Values/functions first with explicit rejections for
   unsupported type/protocol declarations, followed by registry identity work.
5. **Module-owned free symbols.** Their ownership is settled; printing,
   MathJSON persistence, raw/verbatim symbols, substitution, and assumptions
   still need representation decisions. Isolation is required in stage one.
6. **Reset-to-reload.** Repeated imports reuse the existing instance; a reset
   starts a new session with new instances. Dynamic importing later must not
   silently become a reload operation.
7. **Explicit `.epsil` paths initially.** Retain a resolver boundary for future
   URLs, implicit names, and other specifier profiles.
8. **Restricted initialization.** Loading may compute an immutable module
   environment using temporary local mutation. It may not perform external
   effects or retain persistent mutable state, including state hidden inside
   closures. Exported functions keep their normal effects when called;
   consumers explicitly create state through factories. Future dynamic imports
   follow the same restrictions, with host source acquisition treated separately.

Still open:

- Implementation of initialization checks: confined mutation, retained captures,
  transitive call analysis, and enforcement at host capability boundaries.
- Detailed syntax (including export-list-only versus declaration-prefix
  exports), placement, collision rules, and the initial no-cycle policy.
- Whether a later interactive declaration can replace an imported binding;
  reset-to-reload alone does not decide binding replacement rules.
- Symbol/closure representation, AST shape, preparation APIs, and the proposed
  type/protocol ownership and conformance contracts.

## 12. Future dynamic imports

Dynamic import is deferred but should influence the loader boundary now. It
would be an expression available in a function or conditional, accepting a
specifier computed at runtime and returning a module namespace value. It must
not inject an unknown set of lexical names into the current scope. The syntax
and return protocol are open; `import(specifier)` is a candidate, not syntax
accepted by this draft. A future local binding can hold the returned namespace
and access its exported members once loading succeeds.

Proposed compatibility requirements:

- Use the same resolver, canonical identities, export rules, and session
  instance cache as static imports. Static-then-dynamic and dynamic-then-static
  loading of one identity return access to the same module instance. A computed path
  does not grant access to additional specifier forms or host capabilities.
- Resolve relative specifiers against the source containing the dynamic import
  expression, including when its enclosing function is called from elsewhere.
- Initialize on first executed request, not when the expression is parsed or
  the enclosing function is defined. A branch that does not execute causes no
  dynamic load. Dependency initialization order within that request still
  follows the static rules.
- Share an in-progress load across concurrent independent requests so
  initialization occurs once. Detect a request waiting on its own initialization, directly or
  indirectly, as a dynamic cycle instead of deadlocking. New reachable static
  dependencies are linked and checked before their initialization begins.
- Keep reset-to-reload and failed-initialization caching. Dynamic import does
  not mean a fresh instance or retry. Only successfully initialized namespaces
  become observable. Discard failed unpublished environments; host source
  acquisition and resource consumption are not rolled back.
- Preserve function effects and module-owned symbols on namespace member
  access just as selective static imports do. Private members stay inaccessible.

Dynamic imports must apply the same initialization and persistent-state
restrictions as static imports; they are not an escape hatch for an effectful
initializer. This means an unknown target need not automatically mean arbitrary
initializer effects if every target must pass the same checks. Resolver
activity and asynchronous execution still require a separate effect contract:
a function executing a dynamic import cannot be classified as pure merely
because the requested module might already be cached. That contract must not
depend on cache warmth. Dynamic imports executed by an initializer should be
rejected in the initial extension unless a future design explicitly permits
them within its loading and dependency-discovery boundary.

Before shipping, decide how asynchronous source acquisition composes with
Epsil evaluation: suspension, a task/future value, or another explicit async
model. Also specify cancellation of shared loads, error-value delivery, and
typing a namespace whose export shape is not statically known. No promise,
`await`, namespace type, or language effect label is introduced by this draft.
These questions are why dynamic imports should reuse a separable loader but
remain outside the initial syntax and runtime milestone.

Other deferred features: side-effect-only syntax, nested module declarations,
wildcard exclusions, wildcard re-exports, dependency version syntax, and
cross-language JavaScript/Python imports. Conditional loading is a use case for
the future dynamic expression, not for conditional static declarations.
