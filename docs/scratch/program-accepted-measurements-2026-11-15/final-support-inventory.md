# Separate measurement support inventory

Main-only support artifacts are not production additions/deletions. Whole-file added/deleted sizes are reported against the fixed baseline; generated FINAL output files are excluded to avoid recursive self-counting. Raw logs/data are separate from instrument source. Binary archives have bytes but no physical/AST line claim. Only JS/TS instrument code receives the AST metric; Python/shell and data have physical counts only.

| Category | Files | Binary | Bytes added/deleted | Text physical added/deleted | JS/TS AST code added/deleted |
| --- | ---: | ---: | ---: | ---: | ---: |
| Measurement reports | 35 | 0 | 295682/0 | 4394/0 | 0/0 |
| Measurement raw data/logs | 507 | 185 | 37533239/0 | 293887/0 | 0/0 |
| Measurement instrument source | 40 | 0 | 213164/0 | 2039/0 | 1153/0 |

Candidate tests, editor fixtures, snapshots and user-facing documentation remain separate categories in deletion-ledger-final.json. This support inventory is additive only for main-only artifacts not present in that candidate capture; duplicate paths are explicitly excluded. External cortex documentation is outside this inventory and remains the coordinator’s separate report.

Stable artifact hashes: true. Production credit:0.
