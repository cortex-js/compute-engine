# Program source sites

CE-1255.2 defines a query over one prepared Epsil Program and its original
source. It returns authored name sites and summarizes the Program bindings
each direct statement reads, defines or writes. Querying the result executes
no statement. Rebuilding from edited source yields a new result.

The initial consumers are Tycho's prelude admission and diagnostics. The
existing [Program spec](2026-11-12-program-operator-spec.md) defines the
lexical resolution and initialization rules. The query exposes the
decisions made during preparation. It does not introduce a second way to
resolve a name.

## Source sites and targets

- Report the written spelling, half-open UTF-16 name-token range, syntactic
  role, enclosing direct statement and resolved target of each authored
  occurrence. Preserve verbatim delimiters and library aliases at the source
  site. A named argument label and a type use can be navigation sites without
  contributing a value read. Generated symbols and punctuation operators do
  not have authored name sites.
- Include reads, written call heads, declaration targets, parameters and
  pattern binders, assignment targets and compound assignment targets.
  A compound assignment contributes both a read and a write to the same
  binding. Declaration targets contribute definitions.
- Within one result, occurrences of the same binding share an identity.
  Distinguish Program declarations, local bindings, resolved external or
  library bindings, and unresolved names. Shadowed bindings remain distinct.
  Identities are scoped to one preparation. Exposing mutable definition
  objects or preserving identities across edits is outside this contract.
- A direct read that precedes a declaration can refer to that Program binding
  and still be diagnosed as a read before initialization. A deferred function
  body or default retains its own lexical context and is identified as
  deferred. Target, access role and initialization availability are separate
  facts.

## Direct statement summary

In source order, summarize the Program bindings each direct statement reads,
defines and writes, retaining their contributing sites. Deduplicate within
each role by binding identity. A call contributes a read of its head. A
function definition has authored body and default reads, which are marked
deferred, even when defining the function executes neither. Tycho can use
that distinction in its admission policy for calls through helper functions.

This is a summary of authored code. A macro that expands to a call on an
external input can add executable dependencies with no authored tokens.
Simplification can remove both authored operands of a division. Derive
compiled inputs, call targets and effects from the prepared executable
representation. A source summary cannot determine that set.

In particular, a compiled statement that writes a Program binding and then
calls a function that reads it must pass the live slot to that function.
The slot is identified by the prepared binding. Until the compiler can
share it, use the interpreter for the whole statement. The typed loop
prototype returned 4 instead of 8 when a callee read the entry value for
three successive writes. See `/private/tmp/ce-statement-slots.XOTxHE/REPORT.md`.

## Reuse and migration

Reuse the source-span and binder machinery in `src/epsil/occurrences.ts`
and the binder selector used by static diagnostics. Join source sites to
Program resolution before canonicalization can erase or merge authored
occurrences. Raw occurrence groups alone do not identify external
definitions or capture all the Program's binding decisions. In particular,
they currently report a compound target as read only and miss a top-level
binding referenced by a deferred function defined before that binding.

Collect resolution decisions on demand as part of preparation. An observation
belongs to the preparation pass that accepted it. The gasket probe saw 34
authored sites with multiple candidate definitions, including four writes
whose last observed target was discarded. The existing Function retry
savepoint distinguishes erased operands of a rejected pass from those of
the accepted pass. It cannot distinguish the two successful preparations
of a recursive clause. The Program retains one literal, and installation
can prepare another with different parameter binding objects. Give the
statement's site inventory an explicit owner. Keep this inventory out of
ordinary boxing.

The installer receives the statement's canonical literal and can resolve a
source-offset-preserving copy again under the installation environment. Keep
the statement's authored sites attached to its own accepted literal. A trial
that reused that literal for installation changed a fresh recursive function
from `string` to `unknown`, even though it still returned the same string.
An executable dependency query can inspect the installed body separately.

Tycho's prelude walker covers about 497 physical lines including comments,
frame types, admission logic and compiled-local rewriting. Its two read-only
consumers are admission classification and let-fix selection. The same walk
also rewrites top-level bindings during per-statement compilation. Count
only host code actually removed by adopting the query. Reserved plot names,
transitive admission policy, diagnostic presentation and the runner's
current rewriting remain host responsibilities in this delivery. The
Graph Paper LaTeX walker and Document row preparation are separate consumers.

## Checks before adoption

Compare the query and Tycho's actual admission walker on the retained
Apollonian gasket, forward and mutually recursive functions, function defaults
reading a Program constant, destructuring with a wildcard, compound writes,
and a parameter shadowing the library `sum` binder. Preserve exactly one
source site for the written name after an astral character. Include the
following checks where current source-only analysis is insufficient.

- In `function get1(k) { s1 * k }` followed by `let s1 = 3` and
  `get1(2)`, the deferred site refers to the Program's `s1`; the result
  is 6. A direct use before that declaration has a read-before-initialization
  diagnostic.
- In `function g(k) scope { t = k + 1; t }` followed by `let t = 0` and
  `[g(1),t]`, the inner assignment targets the same Program `t`.
  The interpreter yields `[2,2]`. The query exposes that write as deferred.
- Two preparations of the same input name under an outer real binding and
  an inner string binding resolve to different external bindings. Source
  spelling alone cannot distinguish them.
- A macro expansion can create an executable input without an authored
  occurrence. Conversely, with `v1` declared real, `v1 / v1` retains two
  authored reads even when its executable result is the constant 1.

The private feasibility harness and outputs are in
`/private/tmp/ce-program-sites.tk4zmU`. They exercise existing machinery
and quantify the gaps. The public API spelling and production migration
remain open until the implementation demonstrates those checks.
