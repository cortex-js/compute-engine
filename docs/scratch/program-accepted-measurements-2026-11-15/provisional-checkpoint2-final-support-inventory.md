# Separate measurement support inventory

Main-only support artifacts are not production additions/deletions. Whole-file added/deleted sizes are reported against the fixed baseline; generated FINAL output files are excluded to avoid recursive self-counting. Raw logs/data are separate from instrument source. Binary archives have bytes but no physical/AST line claim. Only JS/TS instrument code receives the AST metric; Python/shell and data have physical counts only.

| Category | Files | Binary | Bytes added/deleted | Text physical added/deleted | JS/TS AST code added/deleted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Measurement reports | 21 | 0 | 222245/0 | 3520/0 | 0/0 |
| Measurement raw data/logs | 168 | 40 | 8283412/0 | 135941/0 | 0/0 |
| Measurement instrument source | 25 | 0 | 148270/0 | 1397/0 | 1081/0 |

Candidate tests, editor fixtures, snapshots and user-facing documentation remain separate categories in deletion-ledger-final.json. This support inventory is additive only for main-only artifacts not present in that candidate capture; duplicate paths are explicitly excluded. External cortex documentation is outside this inventory and remains the coordinator’s separate report.

Stable artifact hashes: true. Production credit:0.
