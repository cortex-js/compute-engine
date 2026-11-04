# Scalar arithmetic profile handoff

1. Four files are staged in main at `049107fb4`: benchmark driver, observation
   JSON, benchmark README and evaluation-cache architecture. No engine source
   changed. ROADMAP remains 148 entries (zero added or removed). The authored
   script and documents landed byte-for-byte. The final JSON provenance refresh and baseline symbolic-write clarification
   have also landed.
2. No measurements or checks remain active. The final write window acquired in exec session 8513. Its lock is being
   released after landing; no measurement or lock request remains pending.
3. Validation passed: full source and production mathematical matrices at both
   commits; three quiet timing processes/tree/representation; six accepted
   original-production CPU/allocation profiles; two shared-memo ablations;
   current and baseline cache counts; known-wrong arithmetic and unknown-selector
   rejection controls; oxlint, docs, dependency checks; exact indexed-tree
   typecheck (`/tmp/scalar-index-types.log`). Production build types and consumer
   smokes passed, with HTTP CLI smokes rerun on host after sandbox EPERM.
   Dual review plus fix-delta review passed. A narrowly scoped third review was
   justified by adding bundle entry selection after loader artifacts appeared;
   its metadata findings were fixed. Docs/data need no dual review. Logs are
   `/tmp/scalar-*`; summaries and accepted observations are staged.
4. No engine test rerun was needed: runtime inputs are unchanged. No commit is
   authorized. Final data/document updates do not change typecheck inputs. All temporary
   worktrees are being removed after preserving this handoff. Keep this file
   unstaged until the user commits, then delete it.
5. Continuation: the authorized scalar profile and architecture update are complete. Report the measured production results and priority of
   scalar allocation/dispatch and first-visit memo bookkeeping over cache-stamp
   unification. Do not implement a runtime recovery or reopen postponed steps.
