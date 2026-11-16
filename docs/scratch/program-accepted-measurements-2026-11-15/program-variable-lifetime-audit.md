# Program marker reader audit

Static source audit of every `rg -n _blockLocal src/compute-engine` occurrence (35 matches before this audit; declarations, writes and snapshots included). The marker continues to identify a declaration subject to common Block-style static admission. `_programVariable` distinguishes caller lifetime. Keeping `_blockLocal` true avoids changing the common type/admission predicates into parallel Program variants.

| Reader | Responsibility / disposition |
|---|---|
| binders.ts readsActivation, readsActivationHalf, isBlockLocalBinding | Activation/lifetime. Existing Program exclusions retained. |
| ambient-chain.ts scopeActivationTemplate | Activation/lifetime. Existing exclusion retained. |
| effects-inference.ts valueSignatureOf, storedFunctionLiteral | Activation vs persistent value. Added exclusions at both readers; persistent values use existing ordinary value reader. |
| function-utils.ts holdBodyLocals | Call-frame activation. Exclude Program variables. |
| function-utils.ts renameBoundVariables renamed-local flag | A renamed actual Block local retains its activation; do not copy that marker from a Program variable. Excluded. |
| function-literal.ts mark/calculate captures (two readers) | Caller capture/lifetime. Exclude Program variables from the Block-local exemption so existing global capture/re-resolution machinery applies. |
| lazy-view-context.ts noteOwnNames | Names owned by a scoped activation. Exclude caller Program variables. |
| core.ts functionLocalOf | Nested Block function target vs global clause target. Exclude Program variables so later Program function statements reuse existing global clause machinery. |
| core.ts withOuterNames, joinAssignmentEvidence, markConstantLocal, localAssignmentMismatch, declareOne | Shared declaration/initialization/admission. Retain marker. Program lifetime differences are handled by the existing Program initializer and runtime declaration branches. |
| operand-descriptor.ts structure.local; collection-utils.ts isTopTypedBlockLocal; canonical-utils.ts isFreeSymbol; boxed-function.ts unknown local-call shape | Static declaration classification, not activation ownership. Retain marker: an uninitialized Program declaration is not an undeclared mathematical symbol, nor evidence for a particular collection shape. |
| function-utils.ts free placeholder collector; engine-declarations.ts readsOtherBinding | Declared binding versus auto-created placeholder identity. Retain marker; Program variables are authored declarations. |
| control-structures.ts / boxed-value-definition.ts / type declarations | Producers, declarations and restoration. No reader change. |

`BoxedValueDefinition._snapshot()` already includes `_programVariable` immediately after `_blockLocal`; `_restore()` restores it immediately after `_blockLocal` (implemented with the field originally). No new registry or restoration service.

Choice: retain common declaration marker plus lifetime exclusions. Setting `_blockLocal=false` would require adding Program alternatives to the shared declaration/admission and non-mathematical-symbol classifiers as well as preserving the existing outside-activation Declare origin case. It would not eliminate the independent `_declaredByStatement` lifetime distinction. The current change adds exclusions only where existing activation/capture ownership requires them.

Source probes after audit: mutable caller capture reads2 after write; a later Program redeclaration changes retained closure's caller read2→3; loop closures retain distinct iteration values1,2. Focused runtime/rollback suites and aggregate validation remain the validation owners described in the task.
