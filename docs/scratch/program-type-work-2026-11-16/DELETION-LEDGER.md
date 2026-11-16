# Type-demand revision deletion ledger

Against committed guard revision `050a14088`, five production files change:
**27 physical additions / 19 deletions; 26 AST-code additions / 19 deletions**.
The extra physical line is the effects-query comment. Tests and snapshots have
zero additions/deletions. Instruments and measurement data receive no production
credit. This revision adds seven net code lines; the combined consolidation still
removes 556 net production code lines.

| Delta owner | Code + | Code − | Physical +/− |
| --- | ---: | ---: | ---: |
| M1 existing application typing and four guarded helper inputs | 20 | 19 | 20/19 |
| M2 existing literal signature's current-effects projection | 6 | 0 | 7/0 |
| Total | **26** | **19** | **27/19** |

These are supporting changes in the existing owners, not a second declaration,
assignment or checker algorithm. No retired mechanism or control returns; the
947-code-line named retirement inventory remains removed.

| Cumulative charged production owner | Added | Deleted | Net |
| --- | ---: | ---: | ---: |
| M1 shared sequence and required typing support | 306 | 547 | −241 |
| M2 stable variables, assignment contracts and literal signature support | 195 | 53 | +142 |
| M3 evaluator continuation, cancellation and reporting | 196 | 132 | +64 |
| M4 checker and pure flow | 247 | 745 | −498 |
| M5 adapters and parsed-container consumers | 143 | 166 | −23 |
| Total | **1,087** | **1,643** | **−556** |

The cumulative source is the original `ffff1d44fc566` baseline through the frozen
Program and guard changes plus this exact five-file patch. Unrelated peer IR,
collection and numeric changes are excluded. Raw cumulative production is
+1,340/−3,393 physical lines and +1,166/−1,745 AST-code physical lines. Previously
reviewed neutral retained code remains +79/−102, confined to unchanged files;
no new relocation credit is claimed.

`revision-ledger.mjs` reproduces the integer counts, source hashes and per-file
records in `revision-ledger.json`. Its separate instrument inventory reports
JavaScript AST-code and Python physical counts without pretending they are the
same metric. JSON measurement data is counted separately by files and bytes;
reports and benchmark README changes are documentation. All actual instrument
additions remain charged as instruments, including diagnostic source injection,
which never enters a production build used for timing.
