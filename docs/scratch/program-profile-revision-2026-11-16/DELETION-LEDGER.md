# Final revision deletion ledger

The source delta against accepted commit `4cb2e040ba01` is **26 additions and
23 deletions**, all production code/physical lines across three files. Tests,
snapshots and public API/type declarations are unchanged. No previously retired
binding/checker mechanism returns; the prior 947-code-line retirement inventory
remains removed. A stale explanatory comment naming an old helper is not a
remaining implementation.

| Revision owner | Production + | Production − |
| --- | ---: | ---: |
| M1 shared sequence policy, constant/default and read-before guards | 18 | 18 |
| M2 initializer evidence's existing callable classification guard | 2 | 1 |
| M4 diagnostic-flow allocation guards | 6 | 4 |
| Total | 26 | 23 |

The cumulative ledger is recomputed against the original `ffff1d44fc566` source,
using the frozen accepted source plus this exact patch. Unrelated IR changes in
main are excluded. This matters for `core.ts`: its current-main preimage differs
from the accepted measurement preimage, although the same patch applies to both.
All unchanged production hashes are checked. The previously reviewed neutral
fragments are confined to unchanged files and receive the same credit; no new
relocation credit is taken.

| Cumulative charged production owner | Added | Deleted | Net |
| --- | ---: | ---: | ---: |
| M1 shared sequence canonicalization | 286 | 528 | −242 |
| M2 stable variables and assignment contracts | 189 | 53 | +136 |
| M3 evaluator continuation, cancellation and reporting | 196 | 132 | +64 |
| M4 checker and pure flow | 247 | 745 | −498 |
| M5 adapters and parsed-container consumers | 143 | 166 | −23 |
| Total | **1,061** | **1,624** | **−563** |

Raw cumulative production is +1,313/−3,374 physical lines and +1,140/−1,726
AST-code physical lines. Neutral retained code remains +79/−102. Cumulative
counts are baseline-to-final differences, not the sum of successive patches:
most revision lines replace code already added by the accepted implementation.

`revision-ledger.mjs` reproduces `revision-ledger.json`, including every source
hash and per-file count. Instruments are separate: 14 new JavaScript/Python
files, 622 physical additions/zero deletions at capture (368 JavaScript AST-code
lines; Python is reported as 247 physical lines, not an invented AST-code
count). Measurement JSON files are data, separately counted by files/bytes in
the JSON ledger. Reports and the benchmark README are documentation. No test or
snapshot line is charged as production deletion. No new public-type, runtime,
diagnostic or compilation-coverage change is intended by this revision.
