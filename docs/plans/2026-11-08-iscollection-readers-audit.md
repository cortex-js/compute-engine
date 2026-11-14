# Readers of `.isCollection` in the engine: which question each one asks

Date: 2026-11-08. Scope: `src/compute-engine/**/*.ts`, every read of `.isCollection` that is not a comment line (214 sites in 54 files). Method: each site was read with 5 to 6 lines around it, and the consumer of the answer was followed where the answer is passed on. Classes: C is capability (a collection value is present and can be walked now), K is constant value (the code needs a value with no free inputs), S is shape (the code asks what the expression promises to be), M is mixed or unclear. In the column "same answer?", the shape test is `staticShape !== undefined` or `type.matches('collection<any>')`. "Paired" in a note means that the site already ORs a type test or `isValuelessCollectionTyped` or `typeCouldBeCollection` with `isCollection`. "Y" in the last column of the change section means the result of the site would change if `isCollection` answered `true` for an unevaluated call of a collection-typed bound head; "Y (possible)" means the operand can be such a call only in less common flows, and the reader was not run to confirm it. No site was executed; the consequences are read from the code and are expected, not measured.

## Summary

1. Total 214 sites: C 137, K 4, S 59, M 14. Two of the C rows are not reads of an expression (the handler field `isCollection:` at `boxed-operator-definition.ts:2537` and `collection-utils.ts:6332`); they are listed for completeness.
2. Per directory: library 98 (C 84, K 0, S 8, M 6); boxed-expression 59 (C 38, K 0, S 18, M 3); compilation 42 (C 4, K 4, S 30, M 4); other 15 (C 11, K 0, S 3, M 1).
3. 52 sites already pair `isCollection` with a type test (S 50, C 2, K 0, M 0); the type test shows that the author wanted the shape, and the answer of the paired S sites would not change.
4. Result would change for 83 C or K sites (51 expected, 32 possible), and for 18 S or M sites.
5. Facets that depend on `isCollection` in their own definition (`isEnumerableCollection`, `isFiniteCollection`, `isEmptyCollection`, `staticShape`) and the predicate `isValuelessCollectionTyped` would change as well; their readers are not in this count.

## Table: library (98 sites)

| file:line | class | what the answer decides | would staticShape or the type give the same answer? | note |
|---|---|---|---|---|
| collections.ts:768 | C | `canEnumerate` of Set/List builders: operand present or unresolved | no: false means "decide by the facet" | then reads `isEnumerableCollection` (false for a valueless symbol), paired with `typeCouldBeCollection`. Change: inert `g(x)` goes from a definite "cannot enumerate" to "undecided" |
| collections.ts:1030 | C | error attribution: operand is not a collection, so a wrong-kind error | no: explicitly about the value | false is followed by type tests that decide error or inert. Change: the diagnostic path is skipped for an inert `g(x)` |
| collections.ts:1178 | C | refuse a collection without positions at an indexed slot | partly | true means a value with known kind. Change: (possible) a set-typed application would be refused at once |
| collections.ts:1192 | C | operand is a value without positions (set, dictionary) | partly | same. Change: (possible) same |
| collections.ts:3734 | C | lazy source rule: evaluate the source first when `false` | no | `mapSource` (Map/Filter views). Change: `Map(f, g(x))` source is no longer evaluated first |
| collections.ts:3753 | C | the evaluated source is accepted only if a collection | no | evaluated form of an eager source. Change: an inert evaluated `g(x)` is accepted as a resolved source |
| collections.ts:3780 | C | lazy source rule for lazy views | no | `eagerViewSource`. Change: the user-function application is held, not resolved |
| collections.ts:3784 | C | an operand application that is not a collection stops eager resolution | no | same function. Change: such an operand no longer stops eager resolution |
| collections.ts:3809 | C | finiteness of a view source: evaluate it if not yet a collection | no | `finitenessOfSource`. Change: skips the evaluation step |
| collections.ts:3991 | C | a function operand that is not a collection makes the operands not eagerly finite | no | `eagerOperandsAreFinite`. Change: same |
| collections.ts:9950 | C | `At` index needs the count (negative or mask entry) | no: walks the index | guarded again by `isWalkableFiniteCollection` |
| collections.ts:9982 | C | `At`/`Take` operand: collection present, so validate kind and index | no: absent operand falls to the error branches | false means "unresolved or scalar". Change: an inert `g(x)` is treated as a present collection and validated as such |
| collections.ts:10282 | C | an empty row `[]` | no: needs finite and count 0 | three facet tests |
| collections.ts:10465 | C | element of a point list is a collection, so absence marker | n/a: element of a value | elements from `each()` |
| collections.ts:10805 | C | element of an evaluated list is a collection (row) | n/a | elements from `each()` |
| collections.ts:10931 | C | an inert `PointList` is not yet a collection | n/a | operator is the library `PointList`, not a user function |
| collections.ts:11502 | C | `Join` `isEnumerable`: operand is a scalar datum | yes for the shape half | paired with `typeCouldBeCollection`, so a collection-typed application already counts |
| collections.ts:12210 | C | `Length`: a non-collection gets the wrong-kind or inert answer, else count | no | `count` of an unevaluated call is undefined. Change: inert `Length(g(x))` goes to the count branch |
| collections.ts:12526 | C | operand makes `Zip`-like handler decline | yes for the shape half | OR-ed with `isUnresolvedCollectionOperand` |
| collections.ts:16303 | C | splice a callback result that is a collection | no: walks the result | `mapped.each()`. Change: an inert callback result `g(x)` is walked (gives nothing) |
| collections.ts:17862 | C | `At` index is a finite collection | no | guarded by `isWalkableFiniteCollection` |
| collections.ts:22180 | C | `ListFrom`: operand is a collection or a scalar datum | no: comment says a collection-typed non-collection stays inert (user decision 2026-08-11) | `false` is the "unresolved" signal. Change: an inert `g(x)` is walked instead of staying inert |
| collections.ts:22285 | C | same, for the second builder | no | same. Change:  |
| collections.ts:22339 | C | same, for the third builder | no | same. Change:  |
| collections.ts:22392 | C | `Dictionary` from a collection: decline when not a collection | no | then walks. Change: an inert `g(x)` is walked |
| collections.ts:23366 | C | `FlatMap` result is a collection to splice | no | `mapped.each()`. Change: an inert result is walked |
| collections.ts:24602 | C | `Dedup`: the evaluated source is kept only when a collection | no | `value.isCollection ? value : source`. Change: an inert evaluated `g(x)` is accepted |
| collections.ts:25389 | C | callback walk: operand must be a walkable finite collection | no | second test `isWalkableFiniteCollection` |
| collections.ts:27424 | C | evaluate a function operand of a span first unless it is a collection | no: lazy source rule | type test only excludes `range`. Change: a collection-typed application that may be a range is no longer evaluated first |
| collections.ts:27440 | C | span operand: not a collection means no span | no | `smallCount(op)` follows. Change: (minor): `undefined` becomes `null` for an inert operand |
| control-structures.ts:1904 | C | restriction carrier is a collection value | no | `held` value read next. Change: (possible) `If(c, g(x))` is treated as a collection restriction |
| control-structures.ts:3647 | C | mask condition walk | no | guarded by `isWalkableFiniteCollection` |
| control-structures.ts:3683 | C | ordered carrier prefix of the value | no | value `ev` is an evaluated result. Change: (possible) inert `ev` |
| control-structures.ts:3689 | C | walk the carrier | no | guarded by `isWalkableFiniteCollection` |
| control-structures.ts:3692 | C | carrier finite: hold the restriction | no | needs `isFiniteCollection === true` |
| control-structures.ts:7291 | C | comprehension domain must be a resolved collection | no | "not a collection" leaves the comprehension unresolved. Change: an inert domain `g(x)` is taken as resolved |
| control-structures.ts:7605 | C | same, in the async/second form | no | same. Change:  |
| control-structures.ts:8027 | C | error attribution: domain is an embedded error, not a collection | no | looks for an `Error` inside the domain |
| control-structures.ts:8035 | C | domain not a collection means unresolved domain | no | `state.unresolvedDomain`. Change: a loop over an inert `g(x)` would iterate zero times instead of staying unresolved |
| linear-algebra.ts:235 | C | shape of a matrix operand: walk it for rows | no | then reads `isIndexedCollection`, `isFiniteCollection`. Change: (possible) an inert `g(x)` matrix reaches the facet reads |
| linear-algebra.ts:257 | C | row of an evaluated matrix is a collection | n/a | rows from `each()` |
| linear-algebra.ts:356 | C | operand is a number, not a collection | yes | `isSubtype(type, 'number')` already excludes a collection |
| linear-algebra.ts:2007 | C | operand is a numeric collection | partly | ANDed with a type test; a value-level fact. Change: (possible)  |
| linear-algebra.ts:2806 | C | operand is a collection without positions | no | needs `isIndexedCollection === false` |
| linear-algebra.ts:4245 | S | row is flat: no element is a collection | yes: `type.matches('collection<any>')` | elements of a literal `List`, unevaluated. Change: (S site): an element `g(x)` typed as a list would make the row not flat |
| linear-algebra.ts:4350 | S | same, widths of the two rows | yes | same. Change: (S site): same |
| linear-algebra.ts:5522 | C | norm component is a wrong-kind collection | partly: a shape question for an element | elements of a literal vector. Change: (possible) an element `g(x)` would be reported as a wrong-kind component |
| linear-algebra.ts:5674 | C | a magnitude is still a collection, so the norm is undecided | no | magnitudes are evaluated. Change: (possible) inert `Abs(g(x))` |
| linear-algebra.ts:5851 | M | cell is a scalar or a row | partly | elements of a literal. Change: (possible)  |
| linear-algebra.ts:5853 | M | all cells are rows | partly | same. Change: (possible)  |
| arithmetic.ts:2574 | S | operand is a non-tuple collection | yes | paired (comment: read as the type, not only as the capability) |
| arithmetic.ts:14722 | S | `Sum(body)` with no bounds: body is a collection, so reducer form | yes in principle | decision at canonicalization on `body.canonical`. Change: (S site): `Sum(g(x))` would keep the reducer form |
| arithmetic.ts:14763 | C | restricted value is a collection | no | value of a restriction after evaluation. Change: (possible)  |
| arithmetic.ts:14784 | C | `Sum(L)` reducer: fold when the operand is a collection | no | comment: a collection that declines to iterate would fold to 0 silently. Change: an inert `Sum(g(x))` enters the reducer and folds to 0 |
| arithmetic.ts:15033 | C | same, asynchronous form | no | same. Change:  |
| arithmetic.ts:16365 | C | extremum item is a scalar | no | else the collection branch walks. Change: an inert `g(x)` goes to the collection branch |
| arithmetic.ts:16489 | C | extremum: fold a finite enumerable collection | no | `Max(Map(…), 5)` comment. Change: same |
| arithmetic.ts:16881 | C | keep a collection that could not be folded | no | in the pruning loop. Change: an inert `g(x)` is no longer compared |
| arithmetic.ts:17336 | C | `GCD`/`LCM` operand expands into its elements | no | expansion walks it. Change: an inert `g(x)` is expanded to nothing |
| arithmetic.ts:17759 | C | kind value present: add arrays | no | evaluated operands. Change: (possible)  |
| arithmetic.ts:17956 | C | same, for the product | no | same. Change: (possible)  |
| sets.ts:419 | M | operand of a set operation is a value member or a collection | partly | falls through to `x.isCollection === true`. Change: (possible)  |
| sets.ts:1737 | C | membership test: operand is a collection, else decide by its type | no: comment says `false` also covers an unassigned declared collection | type test follows for the `false` case. Change: an inert `g(x)` is treated as a present set |
| sets.ts:1816 | S | `Union`: wrap a non-collection operand in a `Set` | yes | paired |
| sets.ts:1904 | S | `Intersection`: empty operand decides | yes | paired with `isValuelessCollectionTyped` |
| sets.ts:1908 | C | `Intersection`: every operand must be a collection to evaluate | no | then walks the smallest finite one. Change: an inert `g(x)` operand is accepted |
| sets.ts:2049 | C | `SetMinus` membership: a collection excludes its members | no | `val.contains(x)`. Change: an inert `g(x)` is asked `contains` |
| sets.ts:2187 | C | exclusion of members by a collection | no | `membershipKleene`. Change:  |
| sets.ts:2748 | C | `SetMinus` removes a finite number of elements | no | needs `isFiniteCollection === true` |
| sets.ts:2935 | S | value is a collection value | yes | paired with `typesOverlap` |
| sets.ts:2954 | C | `SetMinus` excludes by membership | no | `memberOf(val, elem)`. Change:  |
| relational-operator.ts:2268 | S | operand counts as collection-ish for broadcast of a comparison | yes | paired (three disjuncts, comment on lockstep) |
| relational-operator.ts:2319 | C | a pair of collections has an undecided element pair | no | walks elements. Change: (possible)  |
| relational-operator.ts:2362 | C | at least two collection operands | no | `absentCollectionComparison`. Change: (possible)  |
| relational-operator.ts:2366 | C | same, per pair | no | same. Change: (possible)  |
| relational-operator.ts:2406 | M | some operand is a present collection beside an unresolved one | partly | `unresolved` already covers the shape. Change: an application `g(x)` would count as the present collection |
| relational-operator.ts:2502 | C | both operands are collections for a whole-collection compare | no | error from a failed cell otherwise. Change: (possible)  |
| utils.ts:4415 | C | infer `collection` for an unknown symbol body | n/a | body is a symbol, not an application |
| utils.ts:4439 | M | `Sum`/`Product` body is a collection: use the reducer | partly | `valueCanStopBeingCollection` is a type fact. Change: (possible)  |
| utils.ts:5101 | C | reducer body is a collection: evaluate and reduce | no: comment says `isCollection` is false before evaluation (Tycho item 121) | choice between the reducer and the indexed form. Change: `Reduce(g(x), …)` leaves the indexed form |
| utils.ts:5118 | C | numeric value is a walkable finite collection | no | guarded by `isWalkableFiniteCollection` |
| utils.ts:5124 | C | evaluated body is a collection: fold | no | guard by `isWalkableFiniteCollection` after. Change: (possible)  |
| statistics.ts:253 | C | bins argument is a collection of edges | no | walks it. Change: (possible)  |
| statistics.ts:2055 | C | a non-finite data collection cannot be flattened | no | `isFiniteCollection !== true` with it. Change: an inert `g(x)` is classed as undecidable data |
| statistics.ts:2139 | C | a datum is not a real constant if it is a collection | yes | `unknowns.length > 0` already excludes `g(x)` |
| statistics.ts:2556 | C | a data collection that cannot be walked | no | guarded by `isWalkableFiniteCollection` |
| core.ts:3186 | C | character set operand is a walkable collection | no | guarded by `isWalkableFiniteCollection` |
| core.ts:3422 | C | random domain is a resolved collection, else symbolic | no | comment: unassigned symbol or error stays symbolic. Change: an inert `g(x)` domain is read as resolved |
| core.ts:11273 | C | `String` of a collection of characters | no | guarded |
| core.ts:11353 | C | join a collection into a string | no | guarded |
| complex.ts:810 | C | ground enumeration operand is not a collection | no | operand is a ground number |
| complex.ts:928 | C | same | no | same |
| complex.ts:933 | C | same, second operand | no | same |
| combinatorics.ts:801 | C | candidate element is a tuple-like collection | no | a membership candidate, not an operand |
| combinatorics.ts:866 | C | same | no | same |
| calculus.ts:6100 | C | walk an evaluated value into numbers | no | result of `N()`. Change: (possible) inert result |
| calculus.ts:7518 | M | each function entry is a scalar, not a nested collection | partly | runtime gate that the static type cannot refute. Change: (possible) an entry `g(x)` typed as a list would be refused |
| measurement-arithmetic.ts:1195 | C | operand cannot supply elements, so decline | no | `elements(i)` is the walk. Change: (possible)  |

## Table: boxed-expression (59 sites)

| file:line | class | what the answer decides | would staticShape or the type give the same answer? | note |
|---|---|---|---|---|
| apply-site.ts:164 | C | only a kind value or a collection can hold a kind value | no | values are evaluated |
| compare.ts:862 | C | NaN leaf check of two same collections | no | walks |
| compare.ts:872 | C | compare two collections element by element | no | "ordered when indexed, membership otherwise". Change: (possible) an inert `g(x)` pair is walked |
| compare.ts:1820 | C | constant pair is not a collection | yes | `unknowns.length > 0` excludes `g(x)` |
| boxed-operator-definition.ts:1605 | S | broadcast lift of the NaN policy | yes | paired |
| boxed-operator-definition.ts:2537 | C | N/A: tests whether the operator definition has an `isCollection` handler field, not an expression read | n/a | listed for completeness |
| operand-descriptor.ts:716 | S | descriptor says an operand is a collection | yes | paired with `collectionFromType` |
| type-guards.ts:533 | C | type guard `isCollection(expr)` narrowing to `CollectionInterface` | no | every caller of the guard is a further reader (not counted here). Change: all callers of the guard change with the getter |
| listed-element.ts:694 | C | kind-open operand without positions is enumerable | no | also reads `isEnumerableCollection`, `isIndexedCollection` |
| abstract-boxed-expression.ts:1616 | C | default `staticShape` answers only for a collection value | no | definition of a facet |
| abstract-boxed-expression.ts:1636 | C | default `isEmptyCollection` | no | definition of a facet. Change: facet changes for an application with shape-true |
| abstract-boxed-expression.ts:1643 | C | default `isFiniteCollection` | no | definition of a facet. Change: same |
| abstract-boxed-expression.ts:1655 | C | default `isEnumerableCollection` equals `isCollection` | no | the capability to walk. Change: becomes `true` for an unevaluated call, which is the lazy source signal |
| arithmetic-mul-div.ts:4186 | S | factor is a number and not a collection | yes | `type.matches('number')` already excludes it |
| validate.ts:208 | S | operand may be a collection (inference gate) | yes | paired |
| validate.ts:1965 | S | absent scalar beside no collection operand | yes | paired |
| validate.ts:2156 | C | settled absentable value must be a collection | no | then reads a type. Change: (possible)  |
| solve-domain.ts:292 | C | last spec is a usable domain | no | domain is enumerated or filtered. Change: an inert `g(x)` domain is accepted |
| solve-domain.ts:676 | M | equation is a collection: type error | partly: an error message about the shape | excludes literal heads and strings. Change: (possible) a list-typed application equation gets the error |
| solve-domain.ts:737 | C | `Element` domain is enumerable | no | domain is walked. Change:  |
| solve-domain.ts:1293 | C | domain is usable (the comment says an unbound symbol is not) | no | same. Change:  |
| rules.ts:243 | M | rule condition `collection` | unclear: a user rule predicate can mean either | public predicate in rules. Change: (possible)  |
| eager-source-values.ts:329 | C | keep an evaluated source value only if a collection | no | `value` is an evaluation result. Change: (possible)  |
| boxed-function.ts:1027 | C | memo walk of operands of a lazy view | no | operands that are collections |
| boxed-function.ts:6014 | C | keep a collection result | no | post-evaluation canonical decision. Change: (possible)  |
| boxed-function.ts:6793 | C | handler call `def.isCollection?.(this)`: the definition of `BoxedFunction.isCollection` | no | the one place where a shape could be added |
| boxed-function.ts:6807 | C | handler call: instance opted out of being a collection | no | opt-out flag of `If`, `Which` |
| boxed-function.ts:7293 | C | `staticShape` of a function: collection facets first | no | definition of a facet |
| boxed-function.ts:7490 | C | `isEmptyCollection` facet | no | definition of a facet. Change: facet changes |
| boxed-function.ts:7499 | C | `isFiniteCollection` facet | no | definition of a facet. Change: facet changes |
| boxed-function.ts:7962 | C | dev assertion after `canEnumerate` said true | no | evaluated result |
| boxed-function.ts:8356 | C | error attribution: source is a collection without positions | no | `errorValue(op, …)`. Change: (possible) a set-typed application is reported at once |
| boxed-function.ts:9570 | S | broadcastable head with a collection operand: skip the domain row | yes | paired |
| boxed-function.ts:9631 | S | same, second site | yes | paired |
| boxed-function.ts:11108 | S | same, third site | yes | paired |
| boxed-function.ts:11160 | S | same, fourth site | yes | paired |
| boxed-function.ts:13210 | C | a restriction operand is lifted when it is a collection | no | `restrictionParts`. Change: `If(c, g(x))` operand is lifted |
| boxed-function.ts:13488 | C | forwarding getter of a broadcast view | no | pass-through, no decision |
| boxed-function.ts:13524 | C | operand is a collection of decided unindexed kind | no | `holdsUnindexedCollection`. Change: (possible)  |
| boxed-function.ts:13933 | M | an operand is a collection or a tuple, so restriction guards thread | partly: shape of the operand | not paired here. Change: `g(x)` typed as a list would thread |
| boxed-function.ts:13941 | S | restricted value is a scalar | yes | paired |
| boxed-function.ts:13999 | S | restricted value is a collection or point | yes | paired |
| boxed-function.ts:22072 | C | lazy source rule: a held eager source is resolved when not a collection | no | `isHeldEagerSource`. Change: `g(x)` is not held for evaluation |
| boxed-function.ts:22083 | C | the value of a symbol is not a collection (refused later) | no | `x.value`, a value |
| boxed-function.ts:22313 | C | a collection without positions at a positional slot is a source | no | `collectionSourceSlot`. Change: (possible)  |
| boxed-function.ts:22382 | C | evaluated source is a set at an indexed slot: type error | no | evaluated value |
| boxed-function.ts:22389 | C | evaluated source is a collection: replace the operand | no | evaluated value. Change: (possible)  |
| boxed-function.ts:23343 | S | operand is a collection or collection-typed | yes | paired |
| kind-dispatch.ts:548 | C | bounded elements of a kind value operand | no | needs finite and count |
| boxed-symbol.ts:2689 | C | symbol is a collection when its value is one | no | definition of the symbol getter. Change: (possible) a symbol assigned an unevaluated collection-typed call |
| boxed-symbol.ts:2768 | C | `staticShape` of a symbol: collection facets first | no | definition of a facet |
| broadcast-lift-type.ts:612 | C | forwarding getter of a view | no | pass-through |
| broadcast-lift-type.ts:1676 | S | two collection-ish operands: whole-collection compare | yes | paired |
| broadcast-lift-type.ts:1687 | S | single collection join | yes | paired |
| broadcast-lift-type.ts:2090 | S | numeric union operand is not a collection | yes | type is a union of numeric scalars |
| broadcast-lift-type.ts:2410 | C | forwarding getter of a point view | no | pass-through |
| broadcast-lift-type.ts:2531 | S | two collection views at the type level | yes | paired |
| simplify.ts:1528 | S | broadcastable head with a collection operand: no simplification | yes | paired |
| simplify.ts:1592 | S | same, second site | yes | paired |

## Table: compilation (42 sites)

| file:line | class | what the answer decides | would staticShape or the type give the same answer? | note |
|---|---|---|---|---|
| compiler-type-facts.ts:1457 | S | Tuple/PointList component broadcasts (is an array) | yes, `indexed_collection<any>` is already ORed | paired |
| compiler-type-facts.ts:1466 | S | List element is a collection to broadcast | yes | paired |
| compiler-type-facts.ts:1520 | S | explicit norm form: component is an array or a scalar number | yes | paired |
| compile-folding.ts:1272 | K | read the elements of a value at compile time to fold it | no: the fold needs a value without free inputs, not a promise | `foldableCollectionElements` then calls `each()`. Change: `g(x)` over an input is walked at compile time (seen in the 2026-11-08 experiment) |
| compile-user-functions.ts:915 | S | argument is a collection other than a tuple (listing rules) | yes | paired |
| compile-user-functions.ts:1006 | S | decline: tuple argument holds a collection component | yes | paired |
| interval-javascript-target.ts:865 | C | decline an infinite numeric-list operand | n/a: needs finiteness of a value | `isFiniteCollection` is also gated by `isCollection` |
| interval-javascript-target.ts:867 | S | operand is a scalar number | yes: the `number` type test already excludes a collection | number type is exclusive of collection |
| interval-javascript-target.ts:1800 | S | decline a collection operand of an interval kernel (error message) | yes | paired |
| interval-javascript-target.ts:2147 | S | all point components have an interval reading and are scalars | yes: `!type.matches('collection<any>')` would be the right test | unpaired; a collection-typed application passes today. Change: (S site): a component `g(x)` typed as a list would stop passing, which is more correct |
| interval-javascript-target.ts:4289 | S | operand is a collection reduce operand | yes | paired |
| interval-javascript-target.ts:6483 | S | decline `Which` with a collection-valued condition | yes | paired (comment: only PROVABLE collection-ness) |
| interval-javascript-target.ts:7247 | C | walk an interpreted result into a JS value | n/a: walks elements | the value is a result of evaluation, so an unevaluated application is unlikely |
| python-target.ts:4955 | S | complex-lowering: array path or scalar path | yes | paired |
| python-target.ts:5059 | S | same, for a function factory | yes | paired |
| python-target.ts:5161 | M | argument may bind by element at a parameter read | yes for the shape half | already pairs with `couldBeCollectionParticipant`, so it wanted the shape |
| python-target.ts:6304 | S | `gammaln` array or scalar path | yes | paired |
| compile-complexness.ts:310 | S | element is read as an array element (complexness) | yes | paired (list, indexed, bound-possibly) |
| compile-complexness.ts:965 | S | Sum/Product over a collection: fold lane | yes | paired |
| compile-declarations.ts:620 | S | index of `At` is a gather | yes | paired |
| javascript-target.ts:1835 | S | operand is collection-ish, so use broadcast lowering | yes | paired (also possibly-collection) |
| javascript-target.ts:2009 | S | selection condition is collection-ish | yes | paired |
| javascript-target.ts:2180 | S | operand admits a run-time broadcast | yes | paired |
| javascript-target.ts:3672 | C | decline an infinite point-list source | n/a: finiteness of a value | `isFiniteCollection` is undefined for an unevaluated call either way |
| javascript-target.ts:4459 | S | colour operand may be a list | yes | paired |
| javascript-target.ts:7640 | S | Norm point component broadcasts | yes | paired (indexed_collection) |
| javascript-target.ts:15995 | S | decline: operand collection but not indexed | yes | paired |
| javascript-target.ts:16231 | S | GCD/LCM: decline non-indexed collection | yes | paired |
| compiler-names.ts:97 | S | index is a gather index | yes | paired |
| gpu-reduce.ts:290 | K | empty literal collection gives the identity | no: needs count 0 of a value | the type can give count 0 only for an exact zero-length type |
| compiler-core.ts:1833 | M | array operand has a positional lowering | partly: `isArrayOperand` is the shape, `!isCollection` means kind not yet known | second clause reads the capability to tell unknown kind from a known set. Change: (possible) `isIndexedCollection` of an unevaluated call decides |
| compiler-core.ts:2263 | S | operand is seen element-wise by the closure | yes | paired (list, indexed, bound-possibly) |
| compile-expr-handlers.ts:570 | S | JS: refuse scalar arithmetic over a list operand | yes | paired (and 4 more shape tests) |
| compile-expr-handlers.ts:673 | S | JS: error message names a list-valued operand | yes | paired |
| compile-expr-handlers.ts:734 | S | Python/other infix guard | yes | paired |
| compile-references.ts:1646 | C | render an interpreted run value cell by cell | n/a: walks elements | value is a result of evaluation |
| gpu-extrema.ts:358 | K | operand is an empty literal collection, skip it | no: needs a value with count 0 | as `gpu-reduce.ts:290` |
| gpu-extrema.ts:455 | K | same, for a head with several operands | no | as above |
| compile-operators.ts:488 | M | lower a comparison as an infix operator, only when no operand is a collection | partly: wants the shape, but also needs the unresolved case to keep run-time dispatch | unpaired here; the nearby flags (`relationalOverCollection`) carry the other cases. Change: compiled comparison over `q(L)` loses its run-time dispatch (seen in the 2026-11-08 experiment) |
| compile-real-analysis.ts:61 | S | operand is an array operand | yes | paired (list, indexed, gated, bound-possibly) |
| compile-real-analysis.ts:168 | M | `Max`/`Min` admit only non-collection real operands | yes: a real-assumed operand cannot have a collection type | `realAssumed` already excludes a collection type |
| compile-broadcast.ts:423 | S | operand compiles to an array (provable) | partly: the later branches use type tests only for symbols and broadcastable heads | `a.isCollection` is the only test for an application of a user function. Change: (S site): an application of a user function typed as a collection becomes a provable array, so `_SYS.bcast` is emitted instead of run-time dispatch |

## Table: other (15 sites)

| file:line | class | what the answer decides | would staticShape or the type give the same answer? | note |
|---|---|---|---|---|
| collection-utils.ts:261 | S | inner callback result cannot be walked | yes | paired |
| collection-utils.ts:303 | C | operand view waits for a callback | no | recursion over collection operands |
| collection-utils.ts:871 | C | search enters an application that is a collection but not walkable | no | `searchEnters`. Change: (possible) a user-function call typed as a collection is entered by the FlatMap search |
| collection-utils.ts:884 | C | descend into collection operands to find a `FlatMap` | no | `holdsFlatMapView`. Change: (possible)  |
| collection-utils.ts:1150 | C | source is enumerable: evaluated form is a collection | no | the comment: for attribution, `xs.evaluate().isCollection`. Change: an inert evaluated `g(x)` is judged enumerable |
| collection-utils.ts:1286 | C | `Join`-like `isEnumerable`: operand is a scalar datum | yes for the shape half | paired with `typeCouldBeCollection` |
| collection-utils.ts:1600 | C | operand is possibly a collection (after the valueless test) | no | `isValuelessCollectionTyped(x)` precedes. Change: an application changes from valueless to non-valueless |
| collection-utils.ts:3735 | S | selection arm may be a collection | yes | paired |
| collection-utils.ts:3779 | M | definition of `isValuelessCollectionTyped`: not a value yet and collection-shaped | yes for the shape half, no for the other half | used by many readers that are not counted here. Change: an unevaluated collection-typed call stops being valueless, so every caller of this predicate changes |
| collection-utils.ts:5657 | C | operand takes part in a zip | no | `zipParticipates`. Change: an inert `g(x)` takes part in a zip |
| collection-utils.ts:5680 | C | collection operand without positions (set, dictionary) | partly | comment: unevaluated eager producer is not refused, broadcasts when evaluated. Change: (possible) a set-typed call is refused |
| collection-utils.ts:6332 | C | N/A: copies the `isCollection` handler field of a definition, not an expression read | n/a | listed for completeness |
| function-utils.ts:11096 | C | an argument is a collection value, so mark the frame | no | arguments are evaluated. Change: (possible)  |
| symbolic/simplify-rules.ts:885 | C | operand is not a collection | yes | `type.matches('number')` follows |
| symbolic/trig-rewrite.ts:542 | S | node is a collection operator: reduce operands, keep operator | partly | canonical node, not a value. Change: (possible)  |

## Readers that would change under a shape-valued isCollection

Class C and K sites whose result changes. The consequence is the expected one.

### library (55)

- library/collections.ts:768 (C): inert `g(x)` goes from a definite "cannot enumerate" to "undecided"
- library/collections.ts:1030 (C): the diagnostic path is skipped for an inert `g(x)`
- library/collections.ts:1178 (C): possible: a set-typed application would be refused at once
- library/collections.ts:1192 (C): possible: same
- library/collections.ts:3734 (C): `Map(f, g(x))` source is no longer evaluated first
- library/collections.ts:3753 (C): an inert evaluated `g(x)` is accepted as a resolved source
- library/collections.ts:3780 (C): the user-function application is held, not resolved
- library/collections.ts:3784 (C): such an operand no longer stops eager resolution
- library/collections.ts:3809 (C): skips the evaluation step
- library/collections.ts:3991 (C): same
- library/collections.ts:9982 (C): an inert `g(x)` is treated as a present collection and validated as such
- library/collections.ts:12210 (C): inert `Length(g(x))` goes to the count branch
- library/collections.ts:16303 (C): an inert callback result `g(x)` is walked (gives nothing)
- library/collections.ts:22180 (C): an inert `g(x)` is walked instead of staying inert
- library/collections.ts:22285 (C): 
- library/collections.ts:22339 (C): 
- library/collections.ts:22392 (C): an inert `g(x)` is walked
- library/collections.ts:23366 (C): an inert result is walked
- library/collections.ts:24602 (C): an inert evaluated `g(x)` is accepted
- library/collections.ts:27424 (C): a collection-typed application that may be a range is no longer evaluated first
- library/collections.ts:27440 (C): (minor): `undefined` becomes `null` for an inert operand
- library/control-structures.ts:1904 (C): possible: `If(c, g(x))` is treated as a collection restriction
- library/control-structures.ts:3683 (C): possible: inert `ev`
- library/control-structures.ts:7291 (C): an inert domain `g(x)` is taken as resolved
- library/control-structures.ts:7605 (C): 
- library/control-structures.ts:8035 (C): a loop over an inert `g(x)` would iterate zero times instead of staying unresolved
- library/linear-algebra.ts:235 (C): possible: an inert `g(x)` matrix reaches the facet reads
- library/linear-algebra.ts:2007 (C): possible: 
- library/linear-algebra.ts:5522 (C): possible: an element `g(x)` would be reported as a wrong-kind component
- library/linear-algebra.ts:5674 (C): possible: inert `Abs(g(x))`
- library/arithmetic.ts:14763 (C): possible: 
- library/arithmetic.ts:14784 (C): an inert `Sum(g(x))` enters the reducer and folds to 0
- library/arithmetic.ts:15033 (C): 
- library/arithmetic.ts:16365 (C): an inert `g(x)` goes to the collection branch
- library/arithmetic.ts:16489 (C): same
- library/arithmetic.ts:16881 (C): an inert `g(x)` is no longer compared
- library/arithmetic.ts:17336 (C): an inert `g(x)` is expanded to nothing
- library/arithmetic.ts:17759 (C): possible: 
- library/arithmetic.ts:17956 (C): possible: 
- library/sets.ts:1737 (C): an inert `g(x)` is treated as a present set
- library/sets.ts:1908 (C): an inert `g(x)` operand is accepted
- library/sets.ts:2049 (C): an inert `g(x)` is asked `contains`
- library/sets.ts:2187 (C): 
- library/sets.ts:2954 (C): 
- library/relational-operator.ts:2319 (C): possible: 
- library/relational-operator.ts:2362 (C): possible: 
- library/relational-operator.ts:2366 (C): possible: 
- library/relational-operator.ts:2502 (C): possible: 
- library/utils.ts:5101 (C): `Reduce(g(x), …)` leaves the indexed form
- library/utils.ts:5124 (C): possible: 
- library/statistics.ts:253 (C): possible: 
- library/statistics.ts:2055 (C): an inert `g(x)` is classed as undecidable data
- library/core.ts:3422 (C): an inert `g(x)` domain is read as resolved
- library/calculus.ts:6100 (C): possible: inert result
- library/measurement-arithmetic.ts:1195 (C): possible: 

### boxed-expression (20)

- boxed-expression/compare.ts:872 (C): possible: an inert `g(x)` pair is walked
- boxed-expression/type-guards.ts:533 (C): all callers of the guard change with the getter
- boxed-expression/abstract-boxed-expression.ts:1636 (C): facet changes for an application with shape-true
- boxed-expression/abstract-boxed-expression.ts:1643 (C): same
- boxed-expression/abstract-boxed-expression.ts:1655 (C): becomes `true` for an unevaluated call, which is the lazy source signal
- boxed-expression/validate.ts:2156 (C): possible: 
- boxed-expression/solve-domain.ts:292 (C): an inert `g(x)` domain is accepted
- boxed-expression/solve-domain.ts:737 (C): 
- boxed-expression/solve-domain.ts:1293 (C): 
- boxed-expression/eager-source-values.ts:329 (C): possible: 
- boxed-expression/boxed-function.ts:6014 (C): possible: 
- boxed-expression/boxed-function.ts:7490 (C): facet changes
- boxed-expression/boxed-function.ts:7499 (C): facet changes
- boxed-expression/boxed-function.ts:8356 (C): possible: a set-typed application is reported at once
- boxed-expression/boxed-function.ts:13210 (C): `If(c, g(x))` operand is lifted
- boxed-expression/boxed-function.ts:13524 (C): possible: 
- boxed-expression/boxed-function.ts:22072 (C): `g(x)` is not held for evaluation
- boxed-expression/boxed-function.ts:22313 (C): possible: 
- boxed-expression/boxed-function.ts:22389 (C): possible: 
- boxed-expression/boxed-symbol.ts:2689 (C): possible: a symbol assigned an unevaluated collection-typed call

### compilation (1)

- compilation/compile-folding.ts:1272 (K): `g(x)` over an input is walked at compile time (seen in the 2026-11-08 experiment)

### other (7)

- collection-utils.ts:871 (C): possible: a user-function call typed as a collection is entered by the FlatMap search
- collection-utils.ts:884 (C): possible: 
- collection-utils.ts:1150 (C): an inert evaluated `g(x)` is judged enumerable
- collection-utils.ts:1600 (C): an application changes from valueless to non-valueless
- collection-utils.ts:5657 (C): an inert `g(x)` takes part in a zip
- collection-utils.ts:5680 (C): possible: a set-typed call is refused
- function-utils.ts:11096 (C): possible: 

### Class S and M sites whose result would change

- compilation/interval-javascript-target.ts:2147 (S): (S site): a component `g(x)` typed as a list would stop passing, which is more correct
- compilation/compiler-core.ts:1833 (M): possible: `isIndexedCollection` of an unevaluated call decides
- compilation/compile-operators.ts:488 (M): compiled comparison over `q(L)` loses its run-time dispatch (seen in the 2026-11-08 experiment)
- compilation/compile-broadcast.ts:423 (S): (S site): an application of a user function typed as a collection becomes a provable array, so `_SYS.bcast` is emitted instead of run-time dispatch
- library/linear-algebra.ts:4245 (S): (S site): an element `g(x)` typed as a list would make the row not flat
- library/linear-algebra.ts:4350 (S): (S site): same
- library/linear-algebra.ts:5851 (M): possible: 
- library/linear-algebra.ts:5853 (M): possible: 
- library/arithmetic.ts:14722 (S): (S site): `Sum(g(x))` would keep the reducer form
- library/sets.ts:419 (M): possible: 
- library/relational-operator.ts:2406 (M): an application `g(x)` would count as the present collection
- library/utils.ts:4439 (M): possible: 
- library/calculus.ts:7518 (M): possible: an entry `g(x)` typed as a list would be refused
- boxed-expression/solve-domain.ts:676 (M): possible: a list-typed application equation gets the error
- boxed-expression/rules.ts:243 (M): possible: 
- boxed-expression/boxed-function.ts:13933 (M): `g(x)` typed as a list would thread
- collection-utils.ts:3779 (M): an unevaluated collection-typed call stops being valueless, so every caller of this predicate changes
- symbolic/trig-rewrite.ts:542 (S): possible: 

### Predicates and facets that would change with the getter

- `isEnumerableCollection` (`abstract-boxed-expression.ts:1655`) returns `this.isCollection`; it would answer `true` for an unevaluated call. The lazy operators read it as "the source is already walkable".
- `isFiniteCollection`, `isEmptyCollection` and `staticShape` (abstract and function classes) return `undefined` when `isCollection` is `false`; they would start to answer from `count`.
- `isValuelessCollectionTyped` (`collection-utils.ts:3779`) is `!isCollection && type.matches(collection shape)`; an unevaluated collection-typed call would stop being "valueless". Its callers are not counted here.
- The type guard `isCollection(expr)` (`type-guards.ts:533`) narrows to `CollectionInterface` for every caller.
- Not read: no site was left unread. The sites marked "possible" were not run; the claim there is from the code only.

## Counts

Sites: 214. C 137, K 4, S 59, M 14. Paired with a type test: 52. Result changes: C or K 83, S or M 18. Not an expression read (listed for completeness): 2.

## Follow-up 2026-11-14: what each unpaired shape reader reads now

Line numbers are those of 2026-11-14. Each row is the class S row with no paired type test, or a class M row whose note says that the code wants the shape.

- linear-algebra.ts:4410 (S, was 4245): `Dot`'s flat row reads `x.staticShape === undefined` for each element.
- linear-algebra.ts:4515 (S, was 4350): the width of a flat row reads `x.staticShape === undefined`.
- arithmetic.ts:15502 (S, was 14722): no change. The reducer form that this site keeps is folded only by the evaluate handler (`rest.length === 0 && first?.isCollection`), which needs a collection value present now. With the shape here, `Sum(Join(src(1), [4]))` stays unevaluated (it was 10), and `Sum(Filter(…))` runs its callback twice per element. Reading the shape needs both sites changed together, which is more than one line.
- arithmetic-mul-div.ts:4186 (S): no change. `x.type.matches('number')` in the same test already reads the type, and a `number` type excludes a collection.
- broadcast-lift-type.ts:2090 (S): no change. The test reads the type first and returns `false` unless the type is a numeric scalar or a union of numeric scalars. The view has no `staticShape`.
- interval-javascript-target.ts:874 (S, was 867): no change. `op.type.matches('number')` in the same test already reads the type.
- interval-javascript-target.ts:2154 (S, was 2147): a point component reads `op.staticShape === undefined`.
- compile-broadcast.ts:423 (S): `compilesToArray` reads `a.staticShape !== undefined`.
- symbolic/trig-rewrite.ts:542 (S): no change. This site is a capability reader, and the audit was wrong. It asks whether the node is a collection value or constructor. `staticShape` also matches broadcast arithmetic, so `TrigReduce(sin(x) cos(x) [1, 2])` would no longer be reduced.
- compile-operators.ts:486 (M, was 488): no change. The infix admission serves every target, and GLSL and WGSL read a `vec2`/`vec3` operand as an atomic infix operand. With the shape here, `If(p = q, 1, 2)` over two points stops compiling on GLSL, and swizzles and vector-factor precedence change (5 test files). Reading the shape needs a per-target rule, which is more than one line.
- boxed-function.ts:14340 (M, was 13933): restriction guards thread when an operand has `x.staticShape !== undefined` or is a tuple.
- python-target.ts:5150 (M, was 5161): no change. It already pairs `isCollection` with `couldBeCollectionParticipant`, a type test.
- solve-domain.ts:686 (M, was 676): no change. This site is a capability reader, and the audit was wrong. It guards against a collection value that the solver would walk and find no root in. `Solve(g(x), x)` with `g := t ↦ [t, 2t]` evaluates to `[0]` today. Reading the shape would turn that result into an `incompatible-type` error.
