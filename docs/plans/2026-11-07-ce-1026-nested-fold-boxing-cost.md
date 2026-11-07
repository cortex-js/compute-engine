# The cost of boxing eight nested folds (CE-1026): measurements

Session `cebatch-1026`, 2026-11-07, at commit
`f32d05973df64885c7e0e4d4f0ea6545a968c688`. No source change was made.

## The program

```js
ce.box(['Function', RSK_ROW_INSERTION, '_raw']);
```

`RSK_ROW_INSERTION` is in `test/compute-engine/fixtures/rsk-row-insertion.ts`
(GitHub issue #487: 8 `Fold`s, 4 deep). Each time below is the fastest of 12
or 15 boxings, each on a new engine, load average about 2.7 to 3.8.

## 1. The size of the regression depends on how it is measured

| Build                                   | 0.156.0 | Now                     | Ratio |
| --------------------------------------- | ------- | ----------------------- | ----- |
| Published bundles (`dist/esm-min`)      | 25.2 ms | 43.7 ms (0.182.0)       | 1.7   |
| Source under `tsx` (worktree at a tag)  | 52.0 ms | 65.2 ms (`f32d05973`)   | 1.25  |

The issue gave 30 ms and 71 ms (2.4). That compared two different builds:
the 0.156.0 time is close to the bundle time (median 30.7 ms), and the 71 ms
is close to the source under `tsx` (median 73 ms). Under `tsx`, the helper `__name` that esbuild adds to every named
inner function takes about 8% of the time; the bundle does not have it.

## 2. The advances of the type version explain about 20% of the time

One boxing computes 1,677 types for new nodes and 1,862 types again because
the key of the type cache moved; 1,807 of these give the same type. The key
moves 80 times: 72 times by the deferred `inference-settled` event and 8 times
by a widening inference. Each narrowing is made by the validation of an
argument (`validateArguments`, from `canonicalJoin` 39 times and from
`validateAgainstDeclaration` 18 times) on the accumulator of the new literal
of a fold pass.

With every `inference-settled` advance removed (a test only; this is not
sound), the boxing took 53.7 ms instead of 67.8 ms (source under `tsx`). So
even a perfect fix of the recomputations leaves most of the time: it is the
passes of the fold refinement themselves (`fixpointLiteral` and the admission
passes, about 60% of the time in a CPU profile), and the cost of each type
computation (`boundCallType`, `functionLiteralSignatureType`,
`validateArguments`).

## 3. A narrower rule by creation order does not help

A rule that is sound without a record of reads: a node made BEFORE the
binding that a narrowing changed cannot have read that binding (a node binds
its names when it is canonicalized), so its cached type stays valid. A
temporary measurement (a creation counter on expressions and value
definitions, and the smallest such counter of the bindings narrowed between
two keys) showed that this rule could skip 280 of the 1,807 recomputations
that give the same type. The other 1,527 are of nodes made after the binding:
the nodes of the literal of the current pass. Of the 1,582 recomputations
that the rule must keep, 55 give a different type. Expected gain: about 3%.

## 4. Options

- (a) Close the issue and keep the cost. The published bundle takes 44 ms
  against 25 ms on 0.156.0. After 0.156.0 (2026-10-17), the fold
  refinement got the type fixes of #454, #511 and #514 and the records of
  #462 and #487. The passes of the refinement are most of the time (§2);
  which of these changes added the 19 ms is not measured (a bisection over
  the bundles would tell). Nothing changes for users.
- (b) One advance of the type version per fold step (`asComputation()`): the
  issue measured about 9% faster. A type read in the step after a narrowing
  keeps the wider type, which is sound but less precise; the changed types
  over the test suite are not measured.
- (c) A record of every read of a scope binding, so that a type is computed
  again only when a binding it read changed (`Scope.bindings` as a map class
  whose `get` and `has` record). This is the design that CE-535 stopped
  (`docs/plans/2026-11-06-ce-535-531-binding-keyed-memos.md` §7). Its cost on
  the hottest code is not measured, and its gain here is at most the 20% of
  §2.

Recommendation: (a). The two other options give at most 9% and 20%, and each
needs a design that the user has not approved. If nothing is decided, the
issue stays open and no session works on it.
