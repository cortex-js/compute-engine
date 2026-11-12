# Structured route: nested lists and matrices

**Status: design, not approved.** It extends the [collections
note](2026-11-11-structured-collections-and-lambdas.md) (parts (d) and (f)
of its section 11) toward the retirement of the existing JavaScript
emitter. Measured on the main tree at
`fa34294f8b7e6ee39886555b16f9deb27135a34d`, whose uncommitted changes of
other sessions touch no compilation file; the probes and the classification
scripts are scratch files, not in the repository.

The contract: for each admitted program the value and the shape at every
depth equal those of the existing compiler with `cse: false, constantFold:
false` (the same doubles), and the interpreter's value within the caveats;
anything else declines. No run-time test of a type or a shape
(`docs/COMPILATION-MODEL.md`, R1 to R6): where the existing emitter decides
at run time, the route decides from the types or declines.

## 1. The existing emitter and the witnesses

Probes, `strict` unless named; forms of `javascript-target.ts`, products of
`compile-linear-algebra.ts`, helpers of `javascript-runtime.ts`. `R` is the
row read of the second line.

| Form | Existing code |
| --- | --- |
| literals `[[x, 1], [2, x]]`, `[[x], [2, x]]`, `[[], []]` | the same text |
| `At(M, i)` of `list<list<real>>`, `matrix`, `matrix<2x2>` | `((_v) => (typeof _v === 'number' && Number.isNaN(_v)) ? undefined : _v)(_SYS.at(M, i))`: `undefined` out of range |
| `At(M, i, j)`, `At(At(M, i), j)` | `R`, then `(Number.isNaN((_tv1) ?? Number.NaN) ? Number.NaN : _SYS.atNumeric(_tv1, j, "real"))` |
| `First(M)`; `Length(M)`; `Length(At(M, 1))`; `Sum(At(M, 2))` | `M[0]`; `(M).length`; `R`, then `Number.isNaN(_tv1 ?? NaN) ? NaN : (_tv1).length`; `((_c) => Array.isArray(_c) ? (_c).reduce(…, 0) : _c)(R)` |
| `[[k, 2k] for k in 1..n]`; a nested comprehension | a `for` loop with `result.push([k, 2 * k])`; two loops |
| `Map(r ↦ 2r, M)`; `Map(Sin, M)` | `(M).map((_x) => _f(_x))` with `_SYS.bcast(…, 2, r)`; with `_SYS.mapFn(_fn_Sin, [1], _tv2)` |
| `ReplaceAt(M, 1, v)`; `ReplaceAt(M, i, j, x)` | `_SYS.replaceAt(M, 1, v)` (copies the outer array); `_SYS.replaceAtPath(M, i, j, x)` (copies the outer array and row `i`) |
| `M + 1`, `-M`, `x·M`, `Sin(M)`, `M / 2`, `M + N` (any nested type) | `_SYS.bcast((_tv1, _tv2) => (_tv1 + _tv2), M, 1)`; `M / 2` is `bcast(…*…, 0.5, M)`; `M + N` gives `NaN` for outer lengths that differ, `[NaN, NaN]` for rows that differ |
| `Sum(M)`; `Reduce(M, Add)` | `((_c) => Array.isArray(_c) ? _c.reduce((_a, _b) => _SYS.add(_a, _b), 0) : _c)(M)`; `_l.length === 0 ? NaN : _l.reduce(…_SYS.add…)` |
| `Max(s)`, `s: list<list<integer>>`; `Max(M)`, `M: matrix` | `s.flat(Infinity)`, then the fold; declines |
| `Determinant`, `Trace`, `Transpose`, `Inverse`, `RowReduce`, `Norm`, `Diagonal` | `_SYS.det(M)`, `_SYS.trace`, `_SYS.transpose`, `_SYS.inv`, `_SYS.rref`, `_SYS.norm`, `_SYS.diagonal` (`linearAlgebraHelper()`) |
| `MatrixPower(M, 3)`, `M^2` (`matrix`); `M^-1`; `MatrixMultiply(M, N)`, `Dot(M, v)` | `_SYS.matpow(M, 3)`; `_SYS.inv(M)`; `_SYS.matmul(M, N)` |
| `Flatten`; `Reshape(v, (2, 2))`; `Shape`; `Cross` | `(M).flat(Infinity)`; `_SYS.reshape(v, [2, 2])`; `_SYS.shape(M)`; `_SYS.cross(v, w)` |
| `IdentityMatrix(3)`, `Dimensions(M)` | declines |
| `complex` mode, cells `number`; a complex literal cell | `_SYS.cplx(_SYS.complexDet(M))`, `_SYS.cmul(M, N)`, `bcast(… _SYS.sadd …)`; `_SYS.complexDet([[({ re: 0, im: 1 }), x], [2, 1]])` |
| a helper `tw(m: list<list<real>>) = 2m` | `const _fn_tw = (m) => _SYS.bcast(…, 2, m); return _fn_tw(M);` |

Products are in section 6. The helpers read the rank of a value at run time
(`matmul`, `mulTensor`, `transpose`, `diagonal` test `Array.isArray` of the
first element); the route may call them where the types settle the rank, as
it calls `_SYS.matmul` for `Dot` now. `_SYS.inv` of a singular matrix and
`_SYS.mul`/`_SYS.matmul` of dimensions that do not agree give the number
`NaN` in place of a list; an element operation on it then differs from the
interpreter (`Map(r ↦ Sum(r), Inverse(M))` throws `map is not a function`
where the interpreter gives `[]`).

**The witnesses**: the 973 compilations whose first refusal is a nested
list in the census (`docs/plans/2026-11-11-js-profile-decline-census.md`, its
JSONL logs), classified by a script over the MathJSON and the declarations.
A program counts in each form it uses (programs / real-use): literal of
lists 159 / 8; `Power` of a nested base 132 / 0 (121 in
`compile-complex-mode-list-input`); a helper with a nested argument 108 / 0
(66 in `compile-list-element-unknown-arith`); `Map`, `Reduce`, `Scan`,
`Filter`, `Count` over rows 95 / 6; a row read, `First`, `Last` 80 / 10 (54 in
`compile-absent-collection-operand`); the value only passes to a call
72 / 26; element-wise with scalars 68 / 4; a product of two arrays 59 / 0 (45
in `multiply-matrix-product`); `Sum`, `Product`, `Max`, `Min` of rows 53 / 1;
`At` with two or more indexes 53 / 0 (52 in `compile-multi-index-at`);
`Determinant` 65, `Trace` 39, `MatrixPower` 37, `Matrix` 29, `Inverse` 26,
`Norm` 25, `MatrixMultiply` 18, `RowReduce` 11, `Transpose` 7 (2 real-use in
all); `Rank` 8, `ReplaceAt` 8, `Shape` 5, slices of rows 4, `Length` 3,
`Diagonal` 3, `Flatten` 3, others 2 or fewer.

Declared types: `list<list<…>>` 304, no nested binding (literals) 290,
`tensor` of unknown rank 150, `matrix` 118, `list<matrix | vector>` 37,
`matrix<m×n>` 33, `list<list<tuple>>` 27, `tensor<U^(a×b×c)>` 19. Modes:
`strict` 777, `complex` 194, `bigint` 2; complex cells (a complex type or
literal) 129. **The types settle the shape in 568.** Not settled: a tensor
of unknown rank or a list of a union of ranks 187 (133 are `p: tensor` of
one test matrix); another binding typed `any`, `unknown`, a union, or a
function of such parameters 191 (66 are `z: any` of
`compile-list-element-unknown-arith`); `list<list<tuple>>` 27.

## 2. The type model

The core type is `list<T>` for any value type `T` but a boolean (complex in
slice 5): `list<list<real>>`, `list<list<tuple<real, real>>>`,
`list<list<list<integer>>>`. The rank is the depth of the type; no length is
in the type, as for flat lists. Engine types map by their element reading
(`docs/TYPE-SYSTEM.md`, "Lists, tensors and `broadcastable`"):

| Engine type | Core type | Facts of the admission |
| --- | --- | --- |
| `list<list<real>>`, `list<list<integer>>`, `list<list<number>>` (`strict`) | `list<list<real>>` (`integer`) | rows of any lengths; can be empty |
| `matrix`, `matrix<real>`, `matrix<U^(?×?)>` | `list<list<real>>` | rectangular, one row or more (the interpreter answers `incompatible-type` for `Determinant([])`) |
| `matrix<m×n>`, `matrix<U^(m×n)>` | `list<list<real>>` | `m` rows of `n` |
| `vector<n>`, `vector` | `list<real>` | length `n` when stated |
| `tensor<U^(a×b×c)>`; `list<matrix<…>>` | `list<list<list<real>>>` | rectangular |
| `tensor`, `tensor<U>`, a union of ranks | none | declines (R3) |

The rank is enough for the verifier and the emitter: no operation of the
core reads a length. Rectangularity and dimensions are needed by the
admission for four decisions: whether a `Multiply` or a `Power` is a matrix
product (section 6); whether two nested operands of an element-wise
operation have equal lengths at every depth; whether the sum of the rows is
a list (rows of one length; `[]` sums to the number `0`); whether a matrix
function can have no value (section 4). They are facts of the engine type,
held per level as `lengthKey()` holds a length source now. A host value
outside its type (a ragged value for a `matrix` input) is outside the
contract ("the host supplies every input with a value of its declared
type"). `number` cells are `real` in `strict` (the existing code reads
`_SYS.atNumeric(_tv1, j, "number")`), complex in `complex` (slice 5).

## 3. The admission

`FragmentListType.element` (`fragment.ts`) is a real, an integer or a point;
the GLSL route (`glsl-fragment.ts`) and the JavaScript route share it. A
list type is read in 9 functions of `fragment.ts` (`makeWalker` 27 reads,
`walkAt`, `walkList`, `walkElement`, `walkDeclare`, `walkAssign`,
`walkBlock`, `sameType`, `fragmentTypeToString`), 11 of `glsl-fragment.ts`,
and 39 of `javascript-fragment-target.ts` (a grep of `kind === 'list'`,
`.element`, `element.kind`, `FragmentListType`, `representation ===
'array'` and the two predicates below): the types of bindings, helpers and
results 14 (`structuredListType`, `structuredParameterType`,
`structuredRepresentation`, `structuredDefinition`, `structuredInput`,
`resolveHelper`, `hostBindings`, …); locals 5 (`structuredLocalType`,
`markEmptyTupleLists`, …); rules of heads 15 (`atRule`, `lengthRule`,
`listLiteralRule`, `comprehensionRule`, `replaceAtRule`, `collectionRule`,
`functionOperandRule`, `elementwiseRule`, `foldRule`, `loopRule`, …); shared
predicates 5 (`listElementType`, `collectionElement`,
`withoutListOperands`, `lengthKey`, `integerFromListLength`).

**Options.** (a) `FragmentListType.element` becomes `FragmentElementType |
FragmentListType`, and a definition admits a nested list only with a flag
(`nestedLists: true`, the structured definition only). (b) A value kind
(`{kind: 'nested'}`) that only the JavaScript definition makes: no shared
reader changes, but every list rule is written twice. (c) A side table of
core types in the JavaScript target: two type systems for one node.
**Recommended: (a).** The GLSL definition never makes a nested list
(`glslFragmentTypeOf`, and `walkList`, which refuses an element that is
neither a number nor a point, are unchanged); the TypeScript errors of the
wider union list every site that narrows on the element, and the two casts
(`a.type.element as FragmentValueType` in `makeWalker`, `facts[0].type as
FragmentElementType` in `walkList`) get an explicit test.

**A default refusal**, so that no existing rule admits a nested list by
accident (a list of tuples reached the verifier through `ReplaceAt` that
way):

1. `listElementType()` and `collectionElement()` keep their positive lists
   (a real, an integer, a point): a rule that calls them refuses.
2. A closed list `NESTED_OPERAND_HEADS`, empty at first, and one wrapper on
   every rule of `LIST_OPERAND_HEADS` that refuses an operand with a list
   element unless its head is in that list, as `withoutListOperands()`
   refuses a list for the other heads. Each slice adds its heads.
3. `valueType()` (`javascript-structured-lower.ts`) maps a nested type only
   for an element it knows; it fails now for every element but a number
   and a point.
4. The emitter of `at` (`javascript-structured-emit.ts`) writes
   `_SYS.atNumeric` for every element that is not a tuple: it gets a branch
   per element kind and a failure for another.
5. A table test: every head of `LIST_OPERAND_HEADS` with a nested operand
   declines, until its slice admits it.

## 4. The operations

The core kinds stay; the verifier checks the types at every depth
(`fitsType()` is already recursive; `isElementType()` admits a list type).

- **`list`** of lists: each operand fits the element type; rows of different
  lengths are allowed (`[[x], [2, x]]`). The engine types a ragged literal
  `list<vector<1> | vector<2>>`; the admission reads it as
  `list<list<real>>` when each member is a list of numbers of rank 1.
- **`at`** with a list result: the absent value of a row in the JavaScript
  policy is `undefined`, written as the existing row read. `At(M, i, j)` is
  two `at`; the inner one writes `_SYS.atNumeric(r, j, "real")`, which gives
  `NaN` for an absent row, as the existing guard does (`_SYS.at` answers
  `NaN` for a value that is not an array). `length` of a row read writes the
  existing guard, a test of the absent value as R3 allows, not of a shape.
  A function of lists, an element-wise operation, a fold or a `build` over a
  row read declines unless the index is in range by the type (a literal
  within `m` of a `matrix<m×n>`): the existing code tests `Array.isArray`
  (`Sum`) or throws (`map`) there.
- **`build`** whose body yields a list: comprehensions and `Map` that make
  rows, element-wise arithmetic at depth 2 (a `build` in a `build`). A scalar
  operand is evaluated once, before the outer `build`, as `_SYS.bcast`
  evaluates its arguments.
- **`replace-at`** with a list element. `ReplaceAt(M, i, j, x)` is
  `replace-at(M, i, replace-at(at(M, i), j, x))`: it copies the outer array
  and row `i`, as `_SYS.replaceAtPath` does; an index out of range throws on
  both (`listPosition()`; `(undefined).slice()`).
- **Folds of rows.** `Sum(M)`, `Product(M)` of a `matrix`: a loop of
  element-wise `build`s from the integer `0` (`1`), in the order of
  `reduce`, so the first step computes `0 + x`, as `_SYS.add(0, row)` does.
  `Max` and `Min` of a nested list: `flatten`, then the fold, where the
  existing compiler compiles it.
- **`collection`**, new names; one kind, as now (`verifyCollection()` gets
  a rule per name). Each is `pure`; each list result is a new array whose
  rows are new (`matinv`, `matpow`, `rref`, `matmul`, `transpose` build or
  copy each row).

| Name | Operands → result | JavaScript | Aborts | No value for |
| --- | --- | --- | --- | --- |
| `determinant`, `trace` | rank 2 → real | `_SYS.det`, `_SYS.trace` | | |
| `transpose`, `row-reduce` | rank 2 → rank 2 | `_SYS.transpose`, `_SYS.rref` | | |
| `inverse` | rank 2 → rank 2 | `_SYS.inv` | `error` (not square) | a singular matrix |
| `matrix-power` | rank 2, integer → rank 2 | `_SYS.matpow` | `error` (not square, exponent ≠ 1) | a singular matrix, negative exponent; an exponent beyond the limit |
| `matrix-product` | ranks 1 or 2, one of rank 2 → the rank of the product | `_SYS.mul` (`Multiply`, `Power`) | | dimensions that do not agree |
| `matrix-multiply` | the same | `_SYS.matmul` (`MatrixMultiply`, `Dot`) | | the same |
| `norm` (extended), `flatten` | any rank → real; rank ≥ 2 → `list<real>` | `_SYS.norm`; `.flat(Infinity)` | | |
| `diagonal` | rank 2 → rank 1; rank 1 → rank 2 | `_SYS.diagonal` | | |

**A value that can have no value** (the result of `inverse`, of
`matrix-power` with an exponent that is not a literal of 0 or more, of
`matrix-product` and `matrix-multiply` whose dimensions the types do not
prove to agree) is the absent value of the target, `NaN` in JavaScript. The
lowering marks the operation with this fact, from the dimensions of the
admission; the verifier admits such a value only as the operand of a yield
of the root or of a function body, of a function of this table, or of an
`at`. Of the 81 uses of `Inverse`, `MatrixPower` and `MatrixMultiply` in the
witnesses, 69 are the result of the program and 12 an operand of `Trace`,
`Determinant` or `Transpose`: none is lost. `M·v + w` with
`matrix<real^(2x2)>` and `vector<real^2>` is admitted (the existing code is
`((_tv3) => [(_tv3[0] + w[0]), (_tv3[1] + w[1])])(_SYS.mul(M, v))`).

**The JavaScript policy** supplies `array` at every rank, the absent values
(`undefined` for a row, `NaN` for a matrix result), the helper names, the
`error` aborts and the guard of `length` of a row read.

## 5. Aliasing and in-place updates

Rows are shared by a row read; by `take`, `drop`, `reverse`, `join`, the
rotations and the spread (a new outer array that holds the rows of the
operand, as the existing `slice`, `reverse` and `[...(M), ...(N)]`); by
`replace-at`, which copies the outer array only (`_SYS.replaceAt` uses
`listCopy`); and by `list`, `append` and `replace-at`, which place an operand
array as a row. The functions of section 4 make new arrays at every depth. A
result can be an input (`If(x > 0, M, I2)` returns `M`): results are
read-only.

`inPlaceUpdates()` (`structured-in-place.ts`) stays sound; uniqueness is a
fact of the outer array. An `at` is never unique (`default: return false`),
so a row is written in place only when it is the result of a `build`,
`list`, `replace-at` or `append` of the same invocation; placing a value as
a row is a use outside the safe list of rule 3, so a later update of that
value copies; an outer update in place changes a slot, not a row read
earlier. `ReplaceAt(M, i, ReplaceAt(At(M, i), j, v))` copies row `i` and
writes the outer slot in place when `M` is unique. `collection` stays a safe
earlier use: no name of section 4 gives back an operand array
(`_SYS.transpose` returns a rank-1 operand itself; `transpose` reads rank 2
only).

## 6. The product rule

From the types only. The rank of an operand is known for a scalar, a
`vector`, a `list<real>` (1), a `matrix` or a literal of rows (2). A
`list<list<…>>` has rank 2 but can be ragged: the interpreter multiplies a
ragged list element by element and a rectangular one as a matrix
(`compileMatrixProduct()`, `compile-linear-algebra.ts`;
`matrixProductShape()`). The existing compiler and the interpreter gave the
same values on each probe:

| Operands | Existing code | Route |
| --- | --- | --- |
| `matrix<2x2>`·`matrix<2x2>`, `matrix`·`matrix`, `matrix<2x3>`·`matrix<3x2>` | `_SYS.mul(M, N)` | `matrix-product`; no value possible only with a dimension `?` |
| `matrix<2x2>`·`vector<2>`; `vector<2>`·`matrix<2x2>`; `matrix`·`list<real>` | `_SYS.mul(M, v)` (`[3,7]`); `_SYS.mul(v, M)` (`[4,6]`) | `matrix-product` |
| `x`·`matrix`, `x`·`list<list<real>>` | `_SYS.bcast(…*…, M, x)` | element-wise `build` |
| `vector<3>`·`vector<3>` | `[(v[0] * w[0]), (v[1] * w[1]), (v[2] * w[2])]` | element-wise |
| `list<list<real>>`·`list<list<real>>`, `M·M`, `list<list<real>>`·`list<real>`; `tensor`·`tensor` | `(_SYS.matrixProductShape(M, N) ?? (_SYS.bcast(…)))`: `[[7,10],[15,22]]` for `M·M` at `[[1,2],[3,4]]`, `[[1,4],[9]]` at `[[1,2],[3]]` | **declines** (a run-time choice) |
| `matrix<2x2>`·`matrix<3x3>` | declines (type `error`) | declines |
| `M^2`, `MatrixPower(M, n)` of a `matrix`; of a `list<list<real>>` | `_SYS.matpow(M, 2)`; `(_SYS.matrixPowerShape(M, 2) ?? (_SYS.bcast(…)))` | `matrix-power`; declines |
| `M^-1` | `_SYS.inv(M)` | `inverse` |

In the `complex` mode with `number` cells the existing code is `_SYS.cmul`:
slice 5. Two matrices beside a list of points decline on both
(`compileMatrixProduct()`).

## 7. What stays declined

A rank that the type does not state (`tensor`, 150; `list<matrix<…> |
vector<…>>`, 37). A product or a power of a `list<list<…>>` (48): the host
declares `matrix`. The sum of the rows of a `list<list<…>>` (21: ragged rows
give `NaN`, `[]` the number `0`). A function of lists or an element-wise
operation over a row read whose index is not in range by the type (27). Two
nested element-wise operands whose lengths are not equal by construction at
every depth (`M + N` of two `list<list<real>>` inputs; `matrix<2x2> +
matrix<2x2>` is admitted), or of different ranks (`[[1,2],[3,4]] + [10,20]`
is `[[11,12],[23,24]]`). A value that can have no value, used by an element
operation. `Shape`, `Rank`, `Dimensions`, `Reshape` (the existing code
measures the first elements at run time); `IdentityMatrix` and `Max(M)` of a
`matrix` (the existing compiler declines); a tuple of lists; `bigint`.

## 8. Implementation order

Each slice is one change, reviewed and committed alone, with differential
tests against the existing compiler (`Object.is` and the length at every
depth, the inputs unchanged after the call, a second call) and the
interpreter; one test per decline of section 7; the table test of section 3;
verifier cases at depth 2 and 3; the shadow measure
(`CE_JS_PROFILE_SHADOW=1`) on the files of the census for the slice; a run
of `scripts/js-profile-fuzz.ts`. Its comparison (`sameValue()`) is already
recursive. It needs the inputs `R: list<list<real>>` (rows of different
lengths, `[]`, `[[]]`), `M: matrix<real^(2x2)>` and `N: matrix` (2×3 values;
a ragged or empty value is outside the type and counted apart), parameters
of these types, a generator of nested programs per slice, and its check of
the inputs after the call extended to nested arrays.

Estimates: programs of the 973 whose nested forms are all in the slices so
far, whose types settle the shape, and that the rules above admit. A program
can still decline for a refusal that the nested one hid.

1. **The value kind and reads**: the types of section 2 (inputs, parameters,
   locals, helper parameters and results, `list<list<tuple>>`), literals of
   rows, `Matrix(…)`, row reads, `At` with several indexes, `First`, `Last`,
   `Length`, `Count`, `If`/`Which` of nested values, `Take`, `Drop`,
   `Reverse`, `Join` and rotations of rows; the default refusal. **96** (26
   real-use; `compile-multi-index-at` 28,
   `tycho-row-425-index-of-broadcastable-call` 26).
2. **Element-wise and functions over rows**: `build`s at depth 2,
   comprehensions and `Map` that make rows, `Map`/`Filter`/`Count`/`Reduce`/
   `Scan` with a row parameter, folds of the rows of a `matrix`, `Max`/`Min`
   by `flatten`, `ReplaceAt` of a row and with two indexes, a `Loop` over
   rows. **+56** (152).
3. **Matrix functions**: the names of section 4 and the rule of a value
   that can have no value. **+112** (264).
4. **Products by type** (section 6). **+22** (286).
5. **Complex cells and the `complex` mode**: `list<complex>` at every depth
   (slice 6 of the collections note, not implemented) and the complex
   helpers. **+157** (443).

The other 530 decline by section 7: tensor and union types 187, other
bindings typed `any`/`unknown` 191, products of `list<list<…>>` 48, row
reads 27, `list<list<tuple>>` 27 (admitted by slice 1's types; their other
refusals are not measured), sums of rows 21, other forms 29. The census
estimated 390 to 630 for this item.

## 9. Open choices

1. **The annotation.** Recommended: (a), a recursive element with a
   definition flag. Alternatives: (b) a kind of the JavaScript route only;
   (c) a side table.
2. **Dimensions in the core type.** Recommended: rank only; rectangularity
   and dimensions are facts of the admission. Alternative: a shape in the
   list type, which a GLSL policy (`matN`, arrays of compile-time length)
   will need; added with that policy.
3. **A value that can have no value.** Recommended: admitted only where
   section 4 says (no witness lost). Alternatives: decline `Inverse` and a
   `MatrixPower` of a negative or variable exponent everywhere (26 + part of
   37); or carry the absent value with a guard in each consumer.
4. **`matrix-product` and `matrix-multiply`.** Recommended: two names
   (`_SYS.mul` gives `NaN` for a mismatch, `_SYS.matmul` a list of `NaN` for
   a matrix·vector mismatch). Alternative: one name, and `MatrixMultiply` and
   `Dot` decline unless the dimensions agree by type.
5. **`Length` of a row read.** Recommended: the existing guard. Alternative:
   decline (6 witnesses).
6. **The sum of the rows.** Recommended: a loop of `build`s. Alternative: a
   `collection` name written as the existing `reduce` with `_SYS.add`.
7. **A ragged literal.** Recommended: `list<list<real>>`. Alternative:
   decline (15 witnesses have a ragged or mixed literal).

**For the user (a public contract).** When the profile replaces the existing
emitter, a `Multiply` or a `Power` of a value typed `list<list<…>>` or
`tensor` stops compiling (it falls back to the interpreter, which decides by
the value), where the existing compiler decides at run time with
`_SYS.matrixProductShape`: 48 + 110 witnesses, none real-use. The remedy is
a `matrix` declaration. The slices decline these forms now, as R3 states.
Decided by the user on 2026-11-11: when a more precise declared type
resolves a case, the declaration is the answer. These forms decline, and
the remedy is documented with an example.

**Not determined.** The gain once the nested refusal is gone (the estimates
count nested forms only); whether `[[]]` is a valid `matrix` value; why the
`list<list<tuple>>` witnesses of `ce-712-2-review-round2` would decline next
(their helper has an `unknown` parameter); counts over the whole suite.

## Result of slice 1

**Admitted** (the `strict` mode): inputs, parameters, locals, helper
parameters and helper results of the types `list<list<real>>`,
`list<list<integer>>`, `list<list<number>>`, `matrix`, `matrix<m×n>`,
`list<list<tuple<real, real>>>` and rank 3; literals of rows, ragged too
(`list<list<real>>`); row reads, `At(M, i, j)`, a chained `At`, `Length` of
each level; `First`, `Last`, `Count`, `Rest`, `Take`, `Drop`, `Reverse`,
`RotateLeft`, `RotateRight`, `Join`, `ListJoin` of rows; comprehensions of
rows (nested ones too); `ReplaceAt` of a row and of an element of a row;
an `If` of nested values. The core type holds the rank only
(`ListType.element` is a `ListType` at each level); the annotation has the
recursive element with the flag `nestedLists`, which only the JavaScript
structured definition sets (`fragment.ts`: `valueFacts`, `bind`, `walkAt`
and `walkElement` refuse a nested type without it; the GLSL tests pass
unchanged). The default refusal is `withoutNestedOperands()` on every rule
of `LIST_OPERAND_HEADS`, with `NESTED_OPERAND_HEADS` the heads above; the
table test is in `compile-javascript-structured-nested.test.ts`.

**Where the implementation differs from this note.**

- A row read is used only as the base of an `At`, the operand of `Length`
  (a direct read, not an `If` of reads: the existing emitter writes
  `.length` with no guard there, and throws for an absent row), an element
  of a list literal, the body of a comprehension, the list of
  `ReplaceAt(R, j, x)`, the row of `ReplaceAt(M, i, r)` (a swap of two
  rows, `ReplaceAt(ReplaceAt(M, 1, M[2]), 2, M[1])`, whose result shares the
  rows of `M`; an update of an element of a swapped row copies that row), a
  branch of an `If`, the value of a `Block` or a `Typed`, and the value of
  the program (`refuseAbsentRowUses()`). A local,
  an argument and the value of a helper body decline.
- `ReplaceAt` with two indexes is in this slice (section 8 put it in
  slice 2). It declines, as the existing compiler does, when the engine type
  does not settle a list at each level (`list<vector<2> | vector<integer^1>>`,
  `assertWrittenLevelsAreLists()`); more than two indexes decline.
- An `At` of rows whose element has an engine type that is not a number, a
  list or a tuple (`At([[]], k, -1)`, `At([[1, 1, -1]], 2)`: the type
  `missing`) declines: the existing emitter gives `undefined` where the
  route gives `NaN`, or declines.
- A program that reads a captured list (a constant of the program) and has
  a node of a nested type declines: a row is placed as it is, and the copy
  of a result that is not unique (`rootYieldsUnique()`) is shallow, so
  `[CL, CL]` would give the caller the array of the constant. The existing
  compiler gives `[_val_CL, _val_CL]`, the hoisted array itself (the class of
  CE-1222). A captured list of lists is not a constant and declines
  (`unsupported binding`).
- `Matrix(…)` and `Which` of nested values are not in this slice.
- The conversion of a list of rows of integers to rows of reals
  (`integer-rows-to-real-rows`) covers rank 2. A list of integers of rank 3
  is not read as a list of reals anywhere (`passesStructuredList()`): a
  second write of a local, an argument and the branches of an `If` decline
  with a message that names both types, and a local declared with rank 3
  declines with a message that names the rank-2 types it admits.

**The cost of an update of a row in a loop** (since the copy before a loop,
`docs/plans/2026-11-10-structured-ir-loops-and-lists.md`, "Result: the
copy before a loop and the rows in place"). A loop that updates one element
of a row writes the row and the outer array in place when the list owns its
rows: `let S = M; for k in 1..n { S = replaceAt(S, 1, 1, S[1][1] + k) }` is
`let _tv2 = M?.map((_r) => _r?.slice());` before the loop and
`_tv2 = _SYS.replaceAtInPlace(_tv2, 1, _SYS.replaceAtInPlace(row, 1, …))`
in it; a local made from a literal or a comprehension of new rows needs no
copy. A loop in the body of another loop gets a copy of one level only, so
it still copies the row on each pass, as does a pass that places a row of
the list or of an input in the list (a row swap, `S = replaceAt(S, 2,
S[1])`). The existing compiler copies once before the loop
(`_SYS.ownedCopyLevels(_.M, 2)`, then `_SYS.replaceAtPathInPlace`) only when
the pass reads no row of the local: for the loop above, which reads
`S[1][1]`, it copies the outer array and the row on every pass
(`_SYS.replaceAtPath`). The values are the same.

**Measures** (the witness replay and the shadow measure at `5d5060724`,
before and after the slice, with the last three declines above not yet
added: they can only lower the counts after; the census and the fuzz runs
on `5fc85eda6` with the slice).

- Witness replay, 239 test files that mention a matrix, a tensor,
  `list<list`, `Determinant`, `Transpose` or a nested literal with a
  compilation: 6,672 compilations that the existing compiler compiles; the
  profile admits 2,194 before and 2,259 after. Of the 737 that declined
  before with a nested cause, 51 are admitted after, 381 still decline with
  a nested cause (the most frequent: a `tensor` input 114, an argument of
  a list of lists to a scalar parameter 21, `Product` of rows 17, `Multiply`
  of a list of lists 14 + 14 + 8, `Sum` of rows 11) and 305 decline with
  another cause (the most frequent: a parameter typed `any` 66, a
  `list<number>` input in the `complex` mode 29, a `list<unknown>` input 24,
  `Norm` with 2 operands 17, row reads as operands of `Filter`, `Reduce`,
  `Map`, `Scan`, `Count` 6 + 4 + 4 + 4 + 3).
  The 2 failures (`call-head-lexical-binding.test.ts`) are the same before
  and after.
- Shadow measure (`CE_JS_PROFILE_SHADOW=1`, 100 files: the 67 files with a
  witness, then others of the list): of 3,848 compilations that the
  existing compiler compiles, the profile admits 641 before and 706 after;
  2 failures before and after.
- Prelude census: 29 of 40 functions before and after (fish-swarm and
  turing-patterns left out). No prelude function reads a list of lists;
  the 11 that decline do so on a `Loop` over `ParallelDomain` or over a
  helper result, a `Block` with `Rgb`, `Rgb`, a parameter typed `real`
  read as a list (`apollonian-gasket`: `tangent`, `seen`, `admitted`), a
  missing explicit initialized local (`fourth`), a non-integer `Loop`
  bound (`koch`), an `If` condition that is not boolean (`play`), and a
  `Floor` of an exact constant (`galtoncounts`).
- `scripts/js-profile-fuzz.ts` with the nested generators (`genRows()`,
  `genRowReal()`; the inputs `R`, `MA`, `M2` and the parameters `RP`, `MP`):
  seeds 201 and 202 (10,000 programs each), 203 (`--random`, 5,000) and
  204 (`--host`, 5,000): 0 failures, 0 differences of value or of shape
  between the profile and the existing compiler. The disagreements with
  the interpreter are scalar (`Fract(π·10^30)`, CE-1221; `Mod` and `Floor`
  near an integer, the class of CE-1203), none of a list of lists.
