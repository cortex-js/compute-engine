# Type System Model

**Status:** normative internal reference for the implemented type system.

This document records the type-system invariants that implementation code may
rely on. Public syntax and API behavior belong in `doc/08-guide-types.md`; open
work belongs in `TYPE_SYSTEM_ROADMAP.md` or an active file under `plans/`.

## Type algebra and compatibility

- Types are immutable values parsed into the `Type` AST in `src/common/type/`.
- Subtyping is a set-containment question. Compatibility is the directional
  admission relation used at call and assignment boundaries; it may admit an
  operand that is not a subtype when the operand is not provably unusable.
- `unknown` means information is not yet available. It must not be treated as
  either `any` or a proof of incompatibility. `any` is an explicit dynamic
  boundary.
- Union, intersection, negation, value types, numeric ranges, records,
  collections, arrows, and nominal references are reduced without attaching
  mutable provenance to `Type` objects.
- Absence in a numeric result normalizes to `NaN`. `Missing` remains a
  non-numeric absence value and comparisons over it use three-valued logic.

## Polymorphism

Universal variables are written in a trailing `where` clause:

```text
(T, mapping: (T) any -> U) -> U where T, U
```

The prefix `forall` spelling is not supported. A variable may have a ground
bound, and instantiation must respect variance and every occurrence of that
variable. Generic function literals, generic aliases, and parameterized
nominal types share the same variable representation and instantiation
machinery.

Transparent aliases substitute their arguments into their body. Nominal types
mint identity: structural equality with the body is not membership. A
parameterized nominal reference retains its type arguments and variance;
recursive nominal references are resolved through the global registry instead
of eager alias expansion.

## Declarations and the global registry

Type and protocol declarations are engine-global and top-level only. The Epsil
static pre-pass acts as a top-level surrogate and runs registry mutations in a
rollback frame so later statements can be checked without leaking provisional
state into real evaluation.

Within one Epsil batch, duplicate type/protocol/sum declarations and duplicate
function clauses are checked as one compilation unit. Across batches the newer
definition replaces the older one; clients that require notebook replay use
checkpoint/restore rather than depending on partially updated historical
state.

## Functions, overloads, and callbacks

An intersection of arrow types is an overload set. Resolution filters
inapplicable arms, orders applicable arms by specificity, and preserves
declaration order for ties. Trial validation occurs in an inference rollback
frame so rejected arms cannot mutate engine inference state.

Multi-clause functions use the same ordering. Concrete calls refuting every
clause are rejected statically; a call whose applicability was undecidable and
later has no matching runtime clause produces `no-matching-clause`. Arguments
are evaluated once.

Callback slots use honest arrow types. There is no `callback<S>` constructor.
Compatibility admits a callback unless it is provably unusable, while still
checking static arity, parameter direction, result compatibility, and effect
subset. Data-bearing argument positions determine generic variables; callback
positions constrain them but do not independently invent incompatible
solutions. An inline lambda may be rebuilt with contextual parameter types at
the application site; that inference is per application, not stored on the
shared literal.

## First-class type values

`type` is both the primitive type of type values and the result type of `Type`.
`TypeFrom` converts a type spelling or settled type expression into a type
value. `StringFrom` converts a type value back to its stable spelling.

- `Subtype(a, b)` compares two type values.
- `MatchesType(value, typeValue)` is the runtime membership primitive.
- `Conforms(value, protocol...)` tests protocol conformance.
- Surface `is` and type patterns lower to `MatchesType`; they do not maintain a
  second membership implementation.
- Type-value structural equality uses the ordinary `Same` tier. Type algebra
  is performed by type operators, never by evaluating arbitrary expressions as
  types.

An unannotated function literal is deliberately excluded from definitive
runtime type membership while its signature can still be inference-widened.
Such a test stays symbolic rather than returning a false negative.

## Protocols, sums, and objects

Protocols are global nominal contracts. Conformance may be conditional on type
variables. Static dispatch resolves directly when the receiver type proves a
single implementation; dynamic dispatch uses the runtime nominal tag. Compiled
code declines when a target cannot represent the required tag or dispatch.

Sum declaration sugar creates the variants and a transparent union in one
atomic registry operation. A compiled sum erases its tag only when the variant
representations are statically disjoint; otherwise JavaScript uses a tagged
representation and targets without that representation fail closed.

An object value is a `BoxedObject`; the instance itself is the mutable heap
record. Its nominal type is pinned at construction. Slots store evaluated
expressions, mutation increments the object version, and equality is identity
unless an explicit protocol supplies other semantics. Objects are references,
not structural records, and do not gain structural subtyping.

## Inference provenance and rollback

Provenance belongs to definitions, not `Type` objects. Every inference write
can record its source expression and axis. Rollback frames journal all
inference-visible state changed during a trial, including type/effect writes,
fresh-inference bookkeeping, and provisional registry changes. Frames nest;
rollback is unconditional for speculative checks and must restore both values
and invalidation metadata.

The current implementation entry points are the definition provenance journal,
the engine inference transaction helpers, and the state-event funnel described
in `EFFECTS-MODEL.md`.

## Sources of truth

- Public language and API: `doc/08-guide-types.md`
- Effects: `EFFECTS-MODEL.md`
- Collection inference: `INFERENCE_ROADMAP.md`
- Open type-system work: `TYPE_SYSTEM_ROADMAP.md` and active plans
- Historical implementation chronology: `STATUS_REPORT.md` and Git history
