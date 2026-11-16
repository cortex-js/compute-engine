# Independent Sol parsed-container consumer audit

Read-only census, 2026-11-15; no edits, tests or Git commands in Tycho.

The three authorized Tycho changes cover the AST consumers in the requested
scope: prelude-runner topStatementsOf accepts Program and legacy Block;
cortex-analysis updates topLevelStatements and structural heads; the notebook
evaluator's recursive function-definition collector accepts Program. The Cortex
cell editor consumes parser diagnostics only. Remaining plot-core Block checks
handle lexical bodies, LaTeX/math expressions or explicitly constructed compiler
Blocks, rather than Epsil parser roots.

CE occurrences, static diagnostics, execute, CLI and debugger paths recognize
Program roots. Remaining editor Block checks handle nested body hooks and
breakpoints. No further missed parsed-root integration was found. This census
does not replace execution, source/debug, cancellation or Tycho workload tests.
