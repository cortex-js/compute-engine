# Combinatorics

An optional library of combinatorial statistics. It is not in the default
library; load it into an engine:

```ts
import { ComputeEngine } from '@cortex-js/compute-engine';
import { loadCombinatorics } from '@cortex-js/compute-engine/combinatorics';

const ce = new ComputeEngine();
const report = loadCombinatorics(ce, { areas: ['permutations'] });
ce.expr(['MajorIndex', ['List', 3, 1, 2]]).evaluate(); // 1
```

Loading is synchronous and idempotent per engine and area. `areas` is a list of
`'permutations'` and `'partitions'`; all areas load when it is omitted. The
report names the heads declared, the type names declared, and any head skipped
with its reason (a head the engine already defines is left alone). Importing the
entry declares nothing.

## Elements are lists

An element is the engine's own value, so statistics compose with the collections
the core already has:

- a **permutation** is its one-line list, a bijection of 1..n, as
  `Permutations(Range(1, n))` yields it;
- an **integer partition** is the list of its parts, positive and
  non-increasing, as `IntegerPartitions(n)` yields it.

```ts
ce.expr(['ListFrom', ['Map', 'MajorIndex', ['Permutations', ['Range', 1, 3]]]]).evaluate();
// [0, 2, 1, 2, 1, 3]
```

A statistic declares its domain as a type over `list<integer>`: `permutation`
and `integer_partition`, declared as aliases. A type cannot say "bijection" or
"non-increasing", so the handler checks that. A call on a list that is not in the
domain (`MajorIndex([1, 1])`, `LargestPart([1, 2])`) stays unevaluated, and so
does one whose operand is not known yet. A list of non-integers is a type error.

A group-theory `Permutation([2, 3, 1])` is accepted too, and read by its images,
when `loadGroupTheory` ran first on the engine (a signature can only name a type
that exists). Group theory drops trailing fixed points, so a statistic that
depends on the degree sees the shortened list.

## Heads

The heads of an area are the rows of its source table
(`src/compute-engine/combinatorics/sources/permutations.ts`, `partitions.ts`);
for example `MajorIndex(p)` (permutations, the sum of the descent positions,
[St000004](https://www.findstat.org/St000004)) and `LargestPart(λ)` (partitions,
the largest part, [St000147](https://www.findstat.org/St000147)). The permutation
area holds about 350 statistics and the partition area about 195; several are
one statistic under different names (`DistinctParts`, `Corners` and
`ConjugateDistinctParts` are all St000159). A head whose name the engine already
declares, such as `PermutationOrder` in group theory, is not declared here.

Each head is defined by an Epsil function literal in its row (for example
`p => Sum(Filter(1..(Length(p) - 1), i => p[i] > p[i + 1]))`), which is the
meaning. The text is not part of the runtime: `scripts/combinatorics/generate.ts`
compiles each row into `compiled.ts` (MathJSON, with the head and FindStat
identifier), which is all the loader reads besides the optional kernels in
`kernels.ts`. A kernel is a TypeScript version of the definition: where there is
one, a test holds the two equal on every element up to n = 5 (nightly: 6, and
permutations up to 7 and partitions up to 25 in the sweep). The heads are not
library operators, so `compile()` declines them.

## FindStat

A statistic is identified with a [FindStat](https://www.findstat.org) statistic
when its value equals FindStat's on every object tried; the identifier is
optional, and a row without one is held to its example rows alone.
`data/combinatorics/` holds the match records, FindStat's values for those
objects up to size 6 (5 for the statistics that take seconds to evaluate on a
partition of 6), and the example rows. FindStat's values are mathematical facts,
credited to FindStat; see `data/combinatorics/README.md` and
`data/combinatorics/findstat/README.md`.

`npx tsx scripts/combinatorics/generate.ts` writes the generated files and
`--check` (a CI step, seconds) fails when they are stale or the rows are invalid.
`--values` also evaluates every head on every fixture object and fails on a
difference with FindStat (about half an hour). The standard test run takes
permutations up to 4 and partitions up to 5 (fewer for the slowest statistics),
and `CE_NIGHTLY=1` all of them.
