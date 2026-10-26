# Verified finite-permutation group baseline

Implemented 2026-10-26 in the existing worktree. [Prerequisite and chapter 39 audit](BASELINE-AUDIT.md) distinguishes reusable CE infrastructure from the remaining mathematical capabilities. The library stays opt-in and is included in the initial foundation-review draft.

## Epsil surface

The installer now provides 26 experimental operations, adding fifteen to the earlier permutation/group/orbit foundation:

| Operation | Meaning |
| --- | --- |
| `PermutationCycles(p)` | Nontrivial disjoint cycles, each starting at its least point |
| `PermutationOrder(p)` | Exact bigint-backed element order, the lcm of cycle lengths |
| `PermutationPower(p, n)` | Exact signed integer power using cycle residues |
| `PermutationConjugate(p, q)` | `q^-1 * p * q` |
| `PermutationCommutator(p, q)` | `p^-1 * q^-1 * p * q` |
| `PermutationGroupGenerators(G)` | The supplied ordered generator list |
| `PermutationGroupIdentity(G)` | Validated identity in the group's action context |
| `PermutationGroupOrder(G, maxWork)` | Exact order from a verified stabilizer chain |
| `PermutationGroupContains(G, p, maxWork)` | Membership by sifting through a verified chain |
| `PermutationPointStabilizer(G, point, maxWork)` | Complete Schreier-generated stabilizer descriptor |
| `PermutationIsSubgroup(G, H, maxWork)` | Whether H is contained in G |
| `PermutationSubgroupIndex(G, H, maxWork)` | Exact index after proving containment; error otherwise |
| `PermutationGroupEqual(G, H, maxWork)` | Same subgroup, independently of descriptor order/redundancy |
| `PermutationIsNormal(G, H, maxWork)` | Containment plus invariance under conjugation by G's generators |
| `PermutationGroupIsAbelian(G, maxWork)` | Pairwise commutation of generators |

The two-group queries require the same explicit action degree. A valid permutation outside the group's declared action is a domain error, not a negative membership answer. Subgroup descriptors can be re-embedded deliberately by constructing them with the desired compatible action. Abstract isomorphism is a separate future query.

```epsil
let G = PermutationGroup([Permutation([2,1]), Permutation([1,3,2])], PermutationAction(3))
let H = PermutationGroup([Permutation([2,3,1])], PermutationAction(3))
PermutationGroupOrder(G, 5000000)          // 6
PermutationSubgroupIndex(G, H, 5000000)    // 2
PermutationIsNormal(G, H, 5000000)         // true
PermutationGroupContains(H, Permutation([2,1]), 5000000) // false
```

Run the [typed Epsil example](../../scripts/group-theory/baseline.epsil):

```sh
node node_modules/tsx/dist/cli.mjs scripts/group-theory/baseline-probe.ts
```

## Chain algorithm and certificate boundary

The [pure chain kernel](../../src/compute-engine/group-theory/permutation/stabilizer-chain.ts) builds successive point stabilizers. At each level it selects a moved point, constructs its complete orbit and right transversal, and forms all nonidentity Schreier generators `t_x*s*t_(x^s)^-1`. It removes exact duplicates and continues until the generator list is empty. Each selected moved point strictly decreases the subgroup, and the explicit level cap bounds construction.

This is deterministic full Schreier construction with deduplication. It is not an optimized incremental Schreier-Sims implementation: difficult generator sets may grow rapidly and hit the limits. It nevertheless avoids enumerating the group. The standard two-generator S20 fixture computes the exact order **2,432,902,008,176,640,000**, beyond safe machine integers, within the tested limits. This is correctness evidence, not a general performance benchmark.

A separate verifier checks the immutable candidate levels before `PermutationStabilizerChain` can publish an order:

1. The first generating set matches the input after removing identity/duplicates.
2. Each level fixes preceding bases, and its base and orbit points belong to the action.
3. Every stored representative follows a valid parent/generator edge rooted at identity, establishing reachability and membership.
4. Every generator edge stays inside the listed orbit, establishing completeness independently of the builder's queue.
5. Recomputed Schreier generators equal the next level's generating set; the final Schreier set is trivial.

These conditions establish successive full point stabilizers by Schreier's lemma. Order is the exact product of orbit lengths. `verifyPermutationChain()` accepts host certificates containing validated permutation values and returns false for an inconsistent certificate; malformed values and resource exhaustion remain errors. It does not trust imported JSON, a claimed order, or a merely nominal chain tag. An arbitrary reduced BSGS is not accepted by this verifier because the certificate format requires the complete deduplicated Schreier sets.

The verified chain's host `sift()` returns membership, residual, and transversal factors in multiplication order, satisfying `g = residual * factors[0] * ... * factors[last]`. A zero-support residual proves membership only because the chain has already been verified. These factors are not yet a flattened word in the original user generators; the chain retains the tree and successive-generator evidence needed for future word certificates.

Point-stabilizer construction uses the complete orbit and Schreier lemma directly. The abelian test needs only generator commutation. Subgroup containment tests each candidate generator by verified membership. Index/equality additionally compute H's verified order. Normality checks conjugated H-generators against H after establishing containment; finiteness turns each inclusion into equality. No blanket scalar multiplication/equality override or implicit closure fallback is installed.

## Bounds, validation and state

| Resource | Contract |
| --- | --- |
| `maxWork` | Required safe integer 0..50,000,000 |
| Chain levels | Default/hard maximum 256; installer may lower `maxChainLevels` |
| Total constructed orbit points | Default/hard maximum 100,000; installer may lower `maxChainOrbitPoints` |
| Charged image storage | Default/hard maximum 1,000,000; installer may lower `maxChainStoredImages` |
| Generators per level | Existing maximum 1,024 and generator-image allowance; the same receiver settings apply to generated levels |
| Individual orbit edges | Existing hard maximum 1,000,000, in addition to shared work limits |
| Element exponent | Exact bigint with at most 16,384 binary digits in its absolute value |

Work counts kernel checkpoints plus explicit normalized image widths for multiplication, inversion, and keys. It is a deterministic logical allowance, not an instruction count or elapsed-time promise. Construction and verification share one ledger. Membership and two-group queries pass their remaining work/image/orbit allowances through nested chain builds and sifts; each nested call does not receive a fresh full budget.

The storage allowance is conservative cumulative accounting: retained generators, representative tables, temporary inverse tables and verification data can be charged across phases, even when references are reused or old temporaries have become unreachable. It is neither peak-memory measurement nor a total process-memory ceiling. A temporary product is additionally bounded by degree and charged image work. Parser, boxed-expression, and existing caller-owned data have separate costs. Level limits concern chain construction; sifting an existing chain is bounded by its work allowance.

Exhaustion produces a `PermutationChainLimitError` (or a nested orbit limit) and a CE error, never false, zero order, or a partial verified object. Codes cover chain work, storage, levels, total orbit points, and generated-set count/image growth. Invalid limits are input errors. Failed internal verification throws `PermutationChainInvariantError`, distinct from invalid caller data and cancellation. Cancellation propagates through nested loops.

Element powers validate integrality before using CE's bigint conversion helper, which can otherwise round nonintegers. `strict: false`, raw/structural MathJSON and forged heads cannot bypass concrete checks. Queries remain inert during boxing, printing, hashing and serialization. No derived chain cache or trusted certificate deserializer is installed; fresh-engine reload reconstructs and verifies from the descriptor. Installation and ordinary saved descriptors/results obey checkpoint lifetimes.

## Validation and remaining work

The eight foundation suites pass **202 tests**, including 43 new kernel/integration tests. New evidence includes:

- Known orders for C4, V4, D8, A4, S4, and intransitive/trivial examples; every generating pair on three points compared with complete closure.
- All 120 permutations on five points checked against an S4 subgroup, including 96 negative results and exact reconstruction from every sift result.
- S20 exact order and fresh-engine exact-number transport; every S4 point stabilizer checked against exhaustive fixed-point subgroups.
- False/incomplete chain certificates, budget boundaries including verification, generator growth limits, cancellation, malformed values, symbolic input, typed Epsil and checkpoints.

No GAP differential runner, browser/worker tests, or general performance evaluation was executed. General group homomorphisms, arbitrary subgroup cosets, original-generator words, reduced-chain optimization, named families, blocks/primitivity, backtracking, matrix-group domains, and advanced recognition remain open. The [chapter 43 plan](GAP-43-ROADMAP.md) and [baseline audit](BASELINE-AUDIT.md) track these without claiming chapter-wide completion or readiness for the base-capability PR.
