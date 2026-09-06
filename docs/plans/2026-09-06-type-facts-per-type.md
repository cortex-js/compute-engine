# Type facts computed once per type

**Status: IMPLEMENTED (2026-09-06); P1 remains open.** Performance round of
`ROADMAP.md` entry P1 ("symbolic evaluation still slower than 0.118.2").
The execution notes below record the implemented scope. The original analysis
in §1–§3 was measured on the tree
staged on 2026-09-06 (the "forced derivations removed" round described in the
0.124.2 CHANGELOG entry).

## Summary

The engine asks the same questions about the same types over and over, and
answers each one by running the general subtype algorithm on a structural
type value. In one `solve` call, 146 type derivations lead to 4 389 subtype
queries and 1 818 type reads, and those queries cover only 1 121 distinct
(type, pattern) pairs. The proposal is to compute the facts a type has — is
it a numeric scalar, is it real, is it finite, is it a collection, is it a
tuple, is it a matrix — **once per type value**, and to make every predicate
that today issues a subtype query read those facts instead. The semantics do
not change: each fact is computed by the predicate that computes it today,
just once.

Original estimate, to be checked by end-to-end measurement: 15–20 % less time per call on the symbolic paths (solve,
simplify, integrate), which is most of the remaining 1.1–1.2× against
0.118.2, and a gain on every other path that reads types.

## 1. Where the time goes

The 2026-09-06 round removed the type derivations that were forced by
questions whose answer does not need the type (`isTuple` on every
intermediate product, the evaluate-time NaN gate, the runtime conformance
check). What is left was counted by instrumenting the unminified bundle, one
call per case after warm-up:

| Case                   | derivations | type reads | subtype queries | `matches()` calls | pattern re-parses | descriptors |
| ---------------------- | ----------: | ---------: | --------------: | ----------------: | ----------------: | ----------: |
| box `√6x + √2x`        |           2 |          7 |             101 |                28 |                20 |           4 |
| simplify `√6x + √2x`   |          19 |        155 |             881 |               269 |               122 |          40 |
| simplify `√(3+2√2)`    |           1 |          7 |              90 |                10 |                 9 |           2 |
| solve `x⁴+x²−1=0`      |         146 |      1 818 |           4 389 |               697 |               607 |         275 |
| `∫1/(x³+1)dx`          |          79 |      2 056 |           4 498 |               996 |               347 |         145 |
| `∫₁² 1/x dx`           |           4 |         18 |             241 |                46 |                63 |           3 |

"Pattern re-parses" counts `parseType` calls, all cache hits, made by
`BoxedType.matches('nan')`-style calls that pass their pattern as a string.

The derivations are few. A derivation costs 2.3–3.3 µs (micro-benchmark on
fresh `Add(x, y)`, `Power(x, 2)`, `Multiply(√6, x)` nodes) against
1.1–2.5 µs on 0.118.2, and no single line inside it dominates. The volume is
in the **questions**: 30 subtype queries per derivation, and about 12 type
reads per derivation.

### 1.1 The questions repeat

Counting queries by the identity of the two type values:

| Case      | queries | distinct (lhs, rhs) identity pairs | distinct type values | repetition |
| --------- | ------: | ---------------------------------: | -------------------: | ---------: |
| simplify  |     881 |                                175 |     49 (12 names)    |       5.0× |
| solve     |   4 389 |                              1 121 |    314 (14 names)    |       3.9× |
| integral  |   4 498 |                                594 |    156 (14 names)    |       7.6× |

Every query on a pair that was already asked is wasted work, and the pairs
are the same handful of patterns each time: `number`, `real`, `complex`,
`nan`, `infinity`, `imaginary`, `integer`, `rational`, `list`, `collection`,
`value` (the boolean primitive).

### 1.2 Who asks (solve case, 4 389 queries)

| Asker                                                    | queries | what it asks                                                          |
| -------------------------------------------------------- | ------: | --------------------------------------------------------------------- |
| `couldBeNonRealNumber` (non-strict `checkNumericArgs`)   |     621 | three queries per operand: `complex <: t`, `t <: number`, `t <: real` |
| `finiteFromType` (descriptor `facts.finite`)             |     369 | `t <: complex`, then `t <: infinity`, `t <: nan`                      |
| `staticMembership` (`isNumber` getter)                   |     286 | `t <: number`, then a disjointness proof when that is false           |
| `isTensorProductOperand` (product sort)                  |     246 | `t <: matrix`, `t <: vector` for every factor of every sorted product |
| `provablyNaNOperand` (type handlers)                     |     ~200 | `t <: complex`, `t <: nan`, `t <: infinity`                           |
| `skipBroadcastForVectorOps` (derivation)                 |     110 | `t <: matrix` per operand                                             |
| `isExtendedRealOperand`, `isImaginary` (handlers)        |     ~150 | `t <: real`, `t <: +oo \| -oo`, `t <: imaginary`                      |
| `isInfinity` / `isNaN` getters on symbols and products   |     ~120 | `matches('infinity')` + two disjointness proofs, per read             |

Four things stand out.

1. **No memory per type.** `finiteFromType(real<0..1>)` runs the subtype
   algorithm three times, and runs it again for the next descriptor built on
   the same type object. A range type is a fresh object per derivation
   (`attachInterval`), but it is read about ten times before it is dropped.
2. **Predicate getters recompute.** `BoxedSymbol.isInfinity` and
   `BoxedFunction.isInfinity` run `matches('infinity')` and a
   `provablyDisjoint` on every read. `Terms` in `add2` reads them for every
   term of every sum it builds.
3. **Patterns are strings.** `x.type.matches('collection<any>')` resolves the
   string through `parseType` (a cache hit, but a `isValidType` walk plus a
   `Map` lookup) on every call. 607 such resolutions per `solve`.
4. **The product sort asks the shape question of every factor on every
   sort.** `sortProductOperands` is called from `termsAsExpression`,
   `canonicalMultiply` and the expand paths, and each call runs two `matches`
   per factor.

The subtype algorithm itself is not slow — about 0.05–0.1 µs per primitive
query after the fast paths added on 2026-09-06 — but 4 400 of them, plus the
600 pattern resolutions and the getter recomputations, are roughly 15–20 % of
a 2.8 ms `solve` call.

## 2. What the questions have in common

Every asker above reduces to a small fixed set of facts about one type:

| Fact                 | Values           | Today computed by                                             |
| -------------------- | ---------------- | ------------------------------------------------------------- |
| `numericScalar`      | boolean          | `isNumericScalarType` (2026-09-06)                            |
| `integer`, `rational`, `real`, `imaginary`, `complex` | boolean each | `isSubtype(t, tier)`                     |
| `belowNumber`        | boolean          | `isSubtype(t, 'number')`                                      |
| `couldBeNumber`      | boolean          | `!provablyDisjoint(t, 'number')`                              |
| `finite`             | three-valued     | `finiteFromType`                                              |
| `nan`, `infinity`    | boolean each     | `isSubtype(t, 'nan')`, `isSubtype(t, 'infinity')`             |
| `extendedReal`       | boolean          | `isExtendedRealOperand`                                       |
| `couldBeNonReal`     | boolean          | `couldBeNonRealNumber`                                        |
| `collection`         | three-valued     | `collectionFromType`                                          |
| `indexed`            | three-valued     | `indexedFromType`                                             |
| `tupleShaped`        | boolean          | `isTupleShapedType`                                           |
| `matrix`, `vector`   | boolean each     | `matches(MATRIX_TYPE)`, `matches(VECTOR_TYPE)`                |
| `containsMissing`    | boolean          | `typeContainsMissing`                                         |
| `unknownOrAny`       | boolean          | `t === 'unknown' \|\| t === 'any'`                            |
| `interval`           | `Interval` or none | `intervalOfType`                                            |

All of these are **functions of the type value alone** (§4 covers the one
exception, references). A type value is immutable: parsed types are
deep-frozen, interned composites are frozen, and the synthesized ranges are
built once and never mutated. So a fact computed for a type object is valid
for the lifetime of that object.

## 3. Design

### 3.1 The fact record

One object per type value, built lazily, holding the facts of §2 as fields
(a bitmask for the booleans, a byte for each three-valued fact, the interval
by reference). Each field is filled on first read by calling the predicate
that computes it today — `finiteFromType`, `isSubtype`, `provablyDisjoint`,
`isTupleShapedType`, and so on — so the answer is by construction the answer
the predicate gives now.

```ts
interface TypeFacts {
  readonly type: Type;
  // Filled on demand; a bit in `known` says the field is valid.
  numericScalar: boolean;
  tier: number;         // bitmask: integer | rational | real | imaginary | complex | number
  finite: Tri;
  nan: boolean; infinity: boolean;
  collection: Tri; indexed: Tri;
  tupleShaped: boolean; matrix: boolean; vector: boolean;
  containsMissing: boolean;
  interval: Interval | undefined;
}
function factsOf(t: Type): TypeFacts;
```

### 3.2 Lookup

- **Primitive names** (strings): a fixed `Map<PrimitiveType, TypeFacts>`
  with about 30 entries, filled at module load or on first use.
- **Composite objects**: a `WeakMap<object, TypeFacts>`. No eviction is
  needed; the record dies with the type object.
- **Interning of ranges and value types (optional, second step):**
  `internType` today interns only flat composites without literal cargo. A
  range (`real<0..1>`) or a value type (`3`) is built afresh by every
  derivation and every literal, so equal ranges are distinct objects with
  distinct fact records. Extending the intern table to ranges and value
  types (key: their spelling; they are already closed types) would let
  equal ranges share one record across nodes. Measure the hit rate before
  doing this: the WeakMap alone already collapses the ~10 reads per object.

### 3.3 References (nominal types and aliases)

A `reference` type carries its definition inline (`def` on the
`TypeReference` object), and an applied alias is expanded eagerly when the
type is built, so the facts of a reference object are a function of that
object as long as `def` is not rewritten in place. **To verify during Phase
1:** whether redeclaring a `type alias` mutates existing reference objects or
builds new ones. If it mutates, facts for `kind: 'reference'` types are not
memoized (they fall through to the predicates), which costs nothing today
because references are rare on the hot paths measured here.

Type variables and polymorphic signatures are excluded the same way: a type
that is not ground has no facts, and `factsOf` returns a record whose reads
delegate to the predicates.

### 3.4 Consumers

Each predicate in §2 keeps its signature and becomes a read of the record:

| Today                                        | After                                    |
| -------------------------------------------- | ---------------------------------------- |
| `finiteFromType(t)`                          | `factsOf(t).finite`                      |
| `provablyNaNOperand(d)`                      | reads `nan`, `infinity`, `finite` bits   |
| `isExtendedRealOperand(d)`                   | `extendedReal` bit                       |
| `isTensorProductOperand(x)`                  | `matrix \|\| vector` bits of `x.type.type` |
| `skipBroadcastForVectorOps` matrix scan      | `matrix` bit                             |
| `couldBeNonRealNumber(t)`                    | one bit                                  |
| `staticMembership(t, 'number')`              | `belowNumber` / `couldBeNumber` bits     |
| `typeContainsMissing(t)`                     | `containsMissing` bit                    |
| `isTupleShapedType(t)`                       | `tupleShaped` bit                        |
| `BoxedSymbol/BoxedFunction.isInfinity/isNaN/isNumber` | bits of the node's type, after the value check |
| `x.type.matches('nan')` and other string patterns | module constants (`NAN_TYPE`), or a per-string cache inside `matches` |

`staticMembership` against an arbitrary target, and `isSubtype` /
`provablyDisjoint` in general, stay as they are: the facts cover the fixed
questions, not the general relation.

### 3.5 Subtype pair memo (measure before building)

A memo keyed by the identity pair (lhs object, rhs object) would serve the
3.9–7.6× repetition of §1.1 directly and cover the callers §3.4 does not
name. It is second in line because the facts already remove most of the
repeated pairs, and a pair memo has a subtle key: a string primitive is
identity-stable, but a fresh range object on either side is a new key. Take
it only if a count after Phase 1 still shows a high repetition ratio.

## 4. Exactness

The round must not change a single answer. Two guards:

1. **Differential assertion mode.** Behind the existing `COUNT_STATS`-style
   debug flag, every fact read also runs the original predicate and asserts
   equality. Run the full suite once in that mode; it exercises every type
   the suite constructs.
2. **The full suite and the snapshot count**, as for every round of P1.

Facts are computed by the predicates they replace, so a divergence can only
come from a stale record — a type object mutated after its facts were read.
The assertion mode is what catches that, and §3.3 names the one candidate.

## 5. Phases

1. **Fact record + consumers + pattern constants** (one round, measurable):
   `common/type/facts.ts`, the §3.4 table, constants for the string patterns
   on the hot paths, the assertion mode. Expected: the subtype-query count
   per `solve` drops from 4 389 to well under 1 000; 10–15 % per call.
2. **Expression getters on facts**: `isNumber`, `isNaN`, `isInfinity`,
   `isFinite` on `BoxedSymbol` and `BoxedFunction` read the bits after their
   value check. Expected: the `Terms` / `toNumericValue` recomputation
   disappears; a few percent.
3. **Interning of ranges and value types** and, if the count still says so,
   the **pair memo** (§3.2, §3.5).
4. **Lean derivation for the arithmetic heads** (separate design): the other
   half of the per-node cost is the derivation protocol — a descriptor and a
   facts object per operand, a `Map` per application, six closures per call,
   the missing-absorption and broadcast scans over the operands whatever the
   head. With per-type facts in place, a handler for `Add` / `Multiply` /
   `Power` over numeric scalar operands can read the bits of the operand
   types directly, and the generic path is reserved for operands that are
   collections, tuples, or of unknown type.

Each phase is a `git worktree` round with the full suite, the six-probe
timing (`ROADMAP.md` P1 lists the protocol), and the instrumented counts of
§1 before and after.

## 6. Risks and open points

- **Alias redeclaration** (§3.3): decide by reading `engine-declarations.ts`
  before Phase 1; exclude references from the memo if in doubt.
- **`never` and `unknown` / `any`**: `never` is below every type and
  disjoint from every type at once; the record stores what the predicates
  answer (`belowNumber: true`, `couldBeNumber: false`) and consumers that
  distinguish the two cases keep doing so (`nonNumericOperandError` is the
  precedent, fixed in review on 2026-09-06).
- **Memory**: one small record per live type object; a `WeakMap` keyed by
  the object. The 4 096-entry intern table clears wholesale when full, which
  is fine for facts (they are recomputed on the next read).
- **Where the facts module lives**: `src/common/type/`, below
  `boxed-expression`, so the descriptor code and the library handlers can
  read it without a new dependency edge; the circular-dependency budget is
  zero and `npm run check:deps` gates the round.


## 7. Execution: boxed results and lazy facts

The user approved a required `BoxedType` result for
`OperatorTypeHandlerOnTypes` on 2026-09-06. `undefined` still declines so
signature fallback and marker handling keep their existing meaning. Built-in
handlers now use `BoxedType.forResult(raw, context.engine._typeResolver)`;
custom handlers can return `context.engine.type(...)`. The application
boundary retains numeric-value widening, missing absorption, broadcasting,
and the type-size limit. When those transforms leave a result unchanged,
its boxed object survives into the expression cache. An immutable normalized
box carries its normalization proof in a private slot. Each result-cache entry
also keeps its own expected type identity, so a JavaScript caller replacing
and renormalizing a box cannot corrupt an earlier entry. Private slots keep
these read caches usable even when callers freeze the `BoxedType` itself.

`BoxedType.facts` exposes shared lazy type evidence. Primitive names use a
small map; composite identities use a weak map. Only deeply immutable,
ground types cache answers. Mutable host ASTs, accessor-bearing objects,
custom prototypes, references (including references nested in containers),
variables, and polymorphic signatures keep live predicate reads. Alias
redefinition does mutate reference definitions, so these exclusions are
required, not hypothetical.

Engine-created numeric ranges are frozen and registered by their scalar-only
constructor. The brand avoids a reflective immutability walk on each fresh
range without trusting mutable caller objects. Numeric value types use a bounded
4 096-entry table, with SameValueZero keys (shared NaN, normalized negative
zero). This shares literal type identities while preserving singleton and
rational/enclosure precision. A separate 4 096-entry table shares equal numeric
ranges, including repeated rational and radical enclosures and sign ranges.
Its key retains every stored field, including openness, absent bounds versus
explicit infinities, and signed zero. Eviction changes identity only; existing
frozen types and their facts remain valid. Newly widened immutable
results are frozen before their normalized boxes are cached. Resolver-scoped
box caches keep user type names tied to the correct engine.

Consumers include numeric argument validation, arithmetic handler helpers,
number/infinity membership, operand finiteness and collection facts, tuple
shape tests, product ordering, and application missing/broadcast checks.
Synthetic descriptors now compute facts lazily as well. Real descriptors allocate
their expression-backed facts only on first use, and keep a private descriptor
reference instead of allocating a type-reader closure. Expression-derived
sign, held-value, and assumption evidence stays in the descriptor cascade;
it is never stored in a global type-only fact record.

The fact cache stays below the compute-engine layer. Interval memoization
lives in `numerics/interval-arithmetic.ts`, which can depend on the common
immutability proof without a dependency cycle. It caches only independent,
immutable types and never reuses a recursive alias read with a traversal
context. Cached intervals are frozen; arithmetic computes fresh result
intervals before changing their endpoints.

### Validation and measurement

`CE_TYPE_FACTS_ASSERT=1` reruns the original predicates on both first
computations and cached reads and asserts equality. Derived facts can reuse
component facts; numeric ranges share their primitive-tier proofs, matching
the numeric/primitive arm of `isSubtype` exactly. The full suite runs in that mode. New regressions cover
unknown/bottom types, mutable ASTs and aliases, shallow freezes, inherited
mutable fields, resolver separation/redefinition, and literal-result
normalization.

`benchmarks/type-derivation.mjs` compares separately built revisions in one
process, rotating their order over seven rounds after warm-up. It includes
the six P1 probes plus numeric, ranged-product and list-type controls, and
reports result differences as well as timings. Hold the shared-box lock and
verify active CPU consumers before accepting measurements. Instrumented
counts are measured separately from elapsed time.

### Validation results

- `npm run typecheck`: passed, including the handler return-type pins,
  public-surface checks, and zero circular dependencies.
- `CE_TYPE_FACTS_ASSERT=1 node node_modules/jest/bin/jest.js --config
  ./config/jest.config.cjs --watchman=false --reporters summary`: passed on
  the main tree, including loopback MCP tests outside the filesystem sandbox.
  708 suites and 33 018 tests passed; 10 suites and 859 tests were skipped,
  with one todo. All 4 237 snapshots passed. Source/test fingerprints matched
  before and after. Jest reported a worker teardown warning after the tests;
  the command exited successfully.
- `npm run build development`, `npm run test:nodenext`, and the native
  TypeScript check of `test/public-ts-declarations/main.ts`: passed in the
  isolated checkout containing the same source.
- Two independent in-session reviewers passed the final changes. Findings
  fixed include inherited mutable type fields, synthetic descriptor facts,
  frozen interval identity powers, frozen boxed metadata, and result-cache
  identity validation. An external Claude review was unavailable because
  automatic approval review rejected external sharing of repository code.

### Measured outcome

Two runs against the 0.124.2 source, with identical standalone minified ESM
build settings, Node 22.13.1, and the CPU lock held. Loads before/after were
2.8/3.2 and 3.0/2.9 (one-minute average, eight cores). Each variant warmed up
for 1 000 calls; seven rounds of 100 samples rotated the execution order.
The second run reversed baseline/current order. All result fingerprints match.
Raw medians, per-round values, controls, and instrumented counts are in
[`2026-09-06-type-facts-results.json`](./2026-09-06-type-facts-results.json).

| Probe | Baseline µs (second run) | Current µs (second run) | Reduction across both runs |
| --- | ---: | ---: | ---: |
| Box `√6x + √2x` | 25.54 | 24.33 | 5–8% |
| Simplify `√6x + √2x` | 181.17 | 156.54 | 14–16% |
| Simplify `√(3+2√2)` | 52.79 | 51.00 | 3–4% |
| Solve `x⁴+x²−1=0` | 1 865.67 | 1 736.88 | 7% |
| `∫1/(x³+1)dx` | 1 972.38 | 1 788.42 | 9% |
| `∫₁² 1/x dx` | 93.87 | 70.67 | 25% |
| Numeric `√2.N()` control | 3.58 | 3.25 | 8–9% |
| Ranged product type | 3.33 | 1.79 | 44–46% |
| Type of 100 tuples in a list | 22.75 | 22.54 | 1–4% |

These are warm, focused probes, not a claim about all symbolic workloads.
The original 15–20% estimate was not met uniformly. In particular, the
historical gap to 0.118.2 has not been remeasured with this harness, so P1 is
still open. Before equal range types were shared, solving remained 1–6%
slower despite fewer subtype queries; allocation and identity reuse mattered
in addition to caching predicates.

Instrumented counts were taken separately from timing, after five warm-up
calls. Simplification drops from 871 to 26 subtype queries, solving from
4 243 to 333, and integration from 4 491 to 392. Descriptor counts remain
40, 269, and 145 respectively. Thus the next allocation target is the
per-application derivation protocol; the current gain does not come from
eliminating those descriptors.

### Subsequent experiments

Next, measure a scalar arithmetic dispatch path before a general subtype-pair
cache, descriptor pool, or more global memoization. A separate experiment may
withhold computed arithmetic endpoints while retaining literal types, sign facts,
numeric tiers, collection shape, and pole/NaN possibilities. A demand-driven
split must avoid computing the detailed result first and then stripping its
ranges; it must also keep coarse and refined cache states distinct so query
order cannot change public type precision. No precision reduction is part of
this implementation.

An ablation during this round skipped `foldIntervalsOfTypes` and Power's
`refinePow`, before the final range-sharing optimization. It improved the
then-current solve probe by about 6–10%, but changed the ranged-product
control from `real<8..15>` to `real`. It did not disable all interval work,
and its gain must not be added to the final measured gain above. This is
evidence for a future demand-driven refinement experiment, not a reason to
remove range precision by default.
