# Permutation groups

Compute Engine's opt-in permutation library provides exact finite permutation
values, generator-based group descriptors, point actions, and verified group
queries. It uses the existing expression, nominal type, evaluation, deadline and
checkpoint infrastructure. It adds no default operators or package exports.

## Installation and use

Import `installGroupTheory` from
`src/compute-engine/library/group-theory.ts` and call it with a Compute Engine.
`installPermutationFoundation` names the same installer. Installation is atomic:
a conflicting name leaves the engine unchanged, and checkpoint restoration removes
definitions installed after the checkpoint.

```ts
installGroupTheory(ce, { maxChainWork: 5_000_000 });
```

The installed Epsil API uses explicit mathematical operations:

```epsil
let G = PermutationGroup(
  [Permutation([2, 1]), Permutation([2, 3, 1])],
  PermutationAction(3)
)
PermutationGroupOrder(G) // 6
PermutationGroupContains(G, Permutation([3, 2, 1])) // true
PermutationOrbit(G, 1) // [1, 2, 3]
PermutationGroupOrder(G, options: {maxWork -> 1000000})
```

[CAPABILITIES.json](CAPABILITIES.json) lists the installed operators and their
signatures. All results have declared types, including permutations, groups,
booleans, exact integers, lists of points and point/representative tuples.
Queries accept an optional integer dictionary named `options`. Bare positional
integer budgets are rejected. Omitting options uses the installer settings;
overrides may lower those ceilings, never raise them.

## Kernel and expression boundary

The six modules under `src/compute-engine/group-theory/permutation/` have no
Compute Engine imports:

| Module | Responsibility |
| --- | --- |
| `values.ts` | Immutable bijections, actions, validation, composition and inverses |
| `element-operations.ts` | Cycles, exact element orders, powers and conjugation |
| `groups.ts` | Generator descriptors and bounded breadth-first closure |
| `orbits.ts` | Point orbits, partitions and tree-based transversal witnesses |
| `stabilizer-chain.ts` | Reduced strong generators, certificates, verification and group queries |
| `query-session.ts` | Bounded reuse of completed, verified chains |

The adapter declares checked nominal constructors with `mint: false`. Operations
decode and validate their operands, including raw or forged MathJSON. Kernel
classes use private-field brands; copied prototypes are not valid kernel values.
Known input/limit errors are recognized by name and code across plugin bundles.
Cancellation and internal invariant failures propagate rather than becoming
mathematical answers. Diagnostic explanations live in
`src/epsil/error-explanations.ts`.

Boxing a descriptor validates its payload but does not enumerate its group.
Query evaluation performs the algorithms. Unresolved typed operands remain
symbolic. Serialization uses ordinary MathJSON trees; loading in another engine
does not carry a trusted certificate or bypass that engine's limits.

## Mathematical conventions

Images are positive integers. A list of length n must be a bijection of 1..n;
trailing fixed points are removed, and the identity has an empty image list.
An explicit `PermutationAction(n)` includes fixed points through n. A value
whose support exceeds n is incompatible with that action.

Products use a right action: `i^(a*b) = (i^a)^b`. Named composition preserves
operand order. Ordinary scalar multiplication is unchanged. This convention also
determines conjugation, transversal witnesses and sifting factors.

Group descriptors retain generator order and repetitions. Structural descriptor
equality is distinct from equality of generated subgroups.
`PermutationGroupEqual`, subgroup, normality and index queries require the same
explicit action. Index rejects a non-subgroup rather than inventing a value.

## Stabilizer certificates

The builder is deterministic incremental Schreier-Sims. It sifts candidate
Schreier generators through the existing suffix and retains only nonidentity
residues. A residue expands an orbit or extends the base; already represented
generators are discarded. There is no group-element enumeration or probabilistic
acceptance in this path.

A version-1 certificate contains:

- A straight-line proof whose nodes name an input generator, invert an earlier
  node, or multiply two earlier nodes.
- Ordered levels containing a base point, strong generators and their proof-node
  indices, the point orbit, parent and generator labels, and representatives.
- A terminal trivial stabilizer, expressed by exhausting the levels.

Proof indices only refer backwards, so cycles and forward references are invalid.
Representatives are justified by tree edges. Lower-level generator sets are
subsets of the preceding set and fix all preceding base points.

The verifier is independent of generator selection. It evaluates provenance in
the original input generators, checks tree reachability and orbit closure, and
checks every Schreier generator by sifting through the already verified suffix,
working upwards from the trivial tail. Finally, every original generator must
sift to identity through the complete chain. These checks prove both inclusions:
the certified group cannot omit input elements or introduce unrelated elements.

A reduced generating set need not equal the complete Schreier set, or even the
original top-level generators. A valid alternative generating set can therefore
be verified without changing the certificate contract.

Only construction followed by verification creates a `PermutationStabilizerChain`.
Its order is the exact bigint product of orbit lengths. Sifting returns membership,
a residue, and factors satisfying `g = residue * factors[0] * ... * factors[last]`.
Point stabilizers use the same reduced construction with the requested point first
in the base. A certificate is currently a host-side diagnostic object, not a
portable public import format.

## Resource and lifecycle contract

All algorithms are synchronous and invoke the engine deadline check during
bounded work. Exhaustion raises an error; it never means nonmembership, a smaller
order, or a partial list.

| Query | Option fields | Default ceilings |
| --- | --- | --- |
| Chain queries | `maxWork`, `maxLevels`, `maxOrbitPoints`, `maxStoredImages`, `maxProofSteps` | 50,000,000; 256; 100,000; 1,000,000; 100,000 |
| Closure | `maxElements`, `maxProducts`, `maxImageWork`, `maxStoredImages` | 10,000; 100,000; 5,000,000; 1,000,000 |
| Orbits | `maxPoints`, `maxEdges` | 100,000; 1,000,000 |
| Transversals | Orbit fields plus `maxProducts`, `maxImageWork`, `maxStoredImages` | 100,000 products; 5,000,000 image work; 1,000,000 stored images |

Installer field names distinguish algorithms: `maxChainWork`,
`maxChainLevels`, `maxChainOrbitPoints`, `maxChainStoredImages`,
`maxChainProofSteps`; `maxClosureElements`, `maxClosureProducts`,
`maxClosureImageWork`, `maxClosureStoredImages`; `maxOrbitPoints`,
`maxOrbitEdges`; and `maxTransversalProducts`, `maxTransversalImageWork`,
`maxTransversalStoredImages`. All may be lowered. Value reception also enforces
`maxDegree` (100,000), `maxGenerators` (1,024), and
`maxGeneratorImages` (1,000,000). Closure requires at least one element slot.

Chain work includes construction, provenance evaluation and verification.
Storage charging is cumulative: discarded intermediate retained data still counts,
so a limit is a predictable allocation bound rather than a live-heap estimate.
Proof length and orbit point counts have separate bounds. These are resource
ceilings, not promises that every group of a given degree can be processed.

Each installer owns its query session. It retains at most eight completed chains
and one million charged image entries; large keys are not cached. Keys include
certificate version, the exact normalized ordered generators, action and all
resource settings. Hits still validate input and check cancellation. Membership
reserves the logical construction cost even on a hit, so cache warmth does not
change success under a declared work/storage budget. No mutable module-global
mathematical cache is used.

## Integration and extension

The current representation is compatible with CE's checked nominal constructors.
It continues to use named noncommutative operations until the engine supports an
ordered product through value-kind arithmetic. Decoded-payload caching belongs
to the shared expression layer rather than a separate group-specific identity
system. No new general-purpose method-selection protocol is introduced here.

Finite multiplication tables, exact matrix groups, homomorphisms, quotients and
polycyclic coordinates are outside this module's current scope. Future adapters
must preserve these same typed-signature, resource and validation contracts.
Quotient values should carry their projection and distinguish a homomorphism
from a lift that is merely a section.

## Validation

Run `node scripts/group-theory/run.mjs test`, `typecheck`, or `smoke`.
The smoke test bundles minified production ESM targeting ES2022 and transports an
exact order query through a fresh Node worker. The runner records the runtime and
uses that executable for child tools. Development validation uses Node 26; it is
not a new package or contributor requirement. The upstream supported runtime range
and CI matrix remain authoritative.

Tests compare small-group chains and stabilizers with exhaustive closure, cover
A16, M24 and cube face turns with known exact orders, reject tampered certificates,
and exercise symbolic evaluation, raw MathJSON, deadlines, checkpoint restoration
and cache budgets. Correctness tests use deterministic mathematical assertions,
not wall-clock thresholds.

## References

These are mathematical and architectural references, not dependencies or source
code incorporated into the implementation:

- [GAP reference, permutation groups and stabilizer chains (chapter 43)](https://gap-system.github.io/gap/doc/ref/chap43.html).
- [SymPy, incremental Schreier-Sims and straight-line descriptions](https://docs.sympy.org/latest/modules/combinatorics/perm_groups.html#sympy.combinatorics.perm_groups.PermutationGroup.schreier_sims_incremental).
- [ATLAS, M24 order and degree-24 permutation data](https://brauer.maths.qmul.ac.uk/Atlas/spor/M24/).

The algorithms are implemented in TypeScript for CE's own value and evaluation
model. There is no GAP parser, linked library, interpreter or executable dependency.
