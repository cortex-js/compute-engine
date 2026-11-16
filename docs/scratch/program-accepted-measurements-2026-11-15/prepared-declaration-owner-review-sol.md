# Sol review: prepared declaration ownership

Independent read-only design review; no edits or tests. Final fix validation is
reported separately.

The bounded correction fits the existing declaration owner: reuse prepared
write identities, initialize the prepared binding, and explicitly signal
successful declaration. A stored Error can be admitted, so result.operator is
not a sound rollback signal. Committed dependent repairs must also be retained.

Review found a specific tuple rollback risk: after a successful prepared tuple
declaration, replacing only one target elsewhere and failing a replay must keep
every current incumbent. Copying boxing-time rollback metadata for an
undisplaced leaf could revert its successful value. Save each current leaf,
using boxing-time prior metadata only for an own, still-uninitialized hoist.

P7 does not require an already canonical initializer to acquire the latest
incumbent as its home on every replay. D8 fixes its declaration contract at
boxing, and withOuterNames gives that initializer its original prior-binding
home. This captures a mutable binding identity, not an immutable value snapshot.
Fresh Program boxing still uses the current caller bindings. Requiring identical
fresh-parse behavior from the same prepared object across changed contracts
would require a separate scope decision. No initializer walker or prepared-type
bridge is authorized by this review.
