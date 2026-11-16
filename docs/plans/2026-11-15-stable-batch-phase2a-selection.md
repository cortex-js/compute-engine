# Stable batch phase 2a: read-only Tycho selection and costing

Status: selection only, 2026-11-15. No phase-2 implementation, Tycho edit,
release, migration approval or production simplification is claimed. Phase 1
still has a revise disposition; its bounded revision is independent work.

## Selected path and limit

Select one path: a discrete numeric-list write to Gomoku's `P_{iecepos}`,
followed by reads through the same prepared binding. The production entry is
`DocumentCEManager.evaluate()` → `_rebindWrittenLiterals()` in
`/Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts`.

The real corpus identity is
`tests/fixtures/documents/desmos/khpocp8io0.json` in Tycho: 89 entries,
expression id `98` defines a literal list of 225 zeros; expression id `198`
defines `C_{lickaction}(x)`, which conditionally writes `P_{iecepos}`, appends
to `M_{ove}` and negates `t_{urn}`. The published source identity in the
fixture index is `https://www.desmos.com/3d/khpocp8io0`. This selection does
not treat a one-slot write as equivalent to that whole action or document.

Recommend a bounded CE-only experiment using the exact id-98 literal as the
initial slot value, then updating position 1 from 0 to 1 and back to 0,
reading the list and one indexed element through the same prepared handle.
Keep the raw fixture identity and explicit projection recipe in its manifest.
The expected values are the literal arrays and element values 0 → 1 → 0,
with identical revision, binding and static type. This is a corpus-derived
projection, not evidence that the whole corpus document executes correctly.
The synthetic seven-row `DOCUMENT` in `selective-rebind.test.ts` is a second,
independent contract control; do not label it real corpus coverage.

Reject full Gomoku registration/inliner replacement as a bounded phase 2a.
The actual document contains comprehensions, indexed/masked lists, piecewise
conditions, reductions, user functions, Desmos `with`, random AI choice and
action policy. The phase-1 arithmetic/list-literal subset cannot execute it.
Adding handlers for every construct merely to claim the 251-line method's
deletion would reverse the experiment's purpose.

## Exact current code and callers

Counts below are inclusive physical lines from TypeScript AST member start
(excludes preceding JSDoc) through member end. They are observed source spans,
not estimates of removable executable statements.

| Member | Lines | Count | Caller/evidence | Deletion status |
| --- | --- | ---: | --- | --- |
| `_rebindWrittenLiterals` | 4798–5048 | 251 | sole call at 4359 in `evaluate`; guarded by changed registration fingerprint | Retain for every nonmigrated document. Candidate for full deletion only after its complete contract is replaced. |
| `_bodyReads` | 5055–5075 | 21 | calls at 4897 and 4940, both within `_rebindWrittenLiterals` | Exclusive helper; conditional deletion with that method. |
| `selectiveRebindStats` getter | 4736–4747 | 12 | externally observed by selective-rebind tests/probes | Diagnostic API; no deletion credit without caller migration. |
| `_registrationFingerprint` | 4475–4531 | 57 | evaluate 4343/4392; selective method 4813; registration metadata | Retain; checks host settings/source/prelude and nonmigrated registration. |
| `_reuseRegistration` | 4554–4657 | 104 | evaluate 4346 | Retain; covers unchanged passes, random and overrides. |
| `_movedLiveOverrides` | 4666–4683 | 18 | reuse 4562 and selective 4885 | Shared host policy; retain. |

The exclusive `_bindReadsMemo` declaration is line 1489 and its full-registration
reset is line 8279; all reads/writes are in the selected method. Its removal
would be two additional physical lines after the whole method is replaced.
No entire shared symbol collector, `_inheritedDefinitionReads`, value-record
map, registration epoch, action baseline, or caller method is credited.
The 272-line two-method candidate is deliberately not the older inventory's
742-line reuse bucket or 3,756-line registration bucket.

The selected method also performs source/visibility/solver checks, uniqueness
checks, literal parsing, type admission, formula-to-literal policy, live
ownership checks, override replay, random draws, transitive dirty closure,
failed-reader recovery, evaluation budgets, shape preservation, registration
accounting, cache epoch publication and action-baseline updates. A prepared
slot replaces only part of these obligations. Host parsing, action semantics,
registration policy and derived renderer products remain host responsibilities.
No branch-sized deletion estimate is credited: the control flow intertwines
these duties and there is no reviewed replacement patch.

## Requirements F10–F22

All remain unpassed by this read-only work. “Not needed by projection” never
waives the original phase-2 gate; the prototype plan explicitly requires all
rows before phase 2 completes.

| Fixture | Current missing CE behavior | Selected projection / full path | Named future validation |
| --- | --- | --- | --- |
| F10 | Runtime callable slots with type/effect admission | Not needed / must establish if action/function values use them | Existing closure observes compatible reassignment; rejected write preserves old callable. |
| F11 | Per-invocation mutable closure frames | Not needed / closure-dependent rows must be audited | Two invocations retain distinct mutable captures. |
| F12 | Explicit fact-context simplification | Not needed / retain ambient-independent prepared semantics | Positive fact simplifies only under its context; static real remains real. |
| F13 | Settled whole-list versus scalar mapping | Indexed reader needs whole-list semantics; full document needs interprocedural mapping | `m(L)=L_1+L`, `[3,4]→[6,7]`; scalar parameter maps separately. |
| F14 | Transactional overload candidates | Not needed for literal/index subset / required when admitting overloads | Failed trial leaves no constraints on successful candidate. |
| F15 | Signed recursion, unresolved recursion refusal | Not needed / audit document call graph first | Typed recursive pair; explicit unannotated diagnostic. |
| F16 | Program ordering and sibling diagnostics | Not needed / action runner is not automatically Program | Forward function/direct value and invalid-sibling fixtures from approved Program spec. |
| F17 | Compile prepared mutable slots as explicit transitive inputs | Read projection can defer compile; real plot integration cannot | `f(t)=a*t`: one artifact, a=2/4,t=3→6/12; never fold current a. |
| F18 | Mismatched compile-input declaration refusal | With F17 | Different input type declines and preserves original revision. |
| F19 | Builder-local macros and capture/hiding/cycles | Not needed / full document policy/normalization stays | Both declaration orders plus existing macro capture/cycle witnesses. |
| F20 | Existing binders with stable captured types | Not needed / comprehensions and `with` make this essential | Existing binder-capture witnesses; no automatic change to lexical CE ruling. |
| F21 | Conservative initializer inference and widening | Explicit `list<integer>` avoids it / inferred row policy still needed | Empty-list/type-changing write must rebuild explicitly; no initializer execution for static literal types. |
| F22 | Whole document plus prelude revision replacement | Required before host pilot; slot-only projection does not pass it | Edit prelude, rebuild including transfer/reinit, preserve old-handle behavior. |

Additional selected-path slices beyond the current phase-1 ledger:

1. **Numeric-list input and read admission:** audit 225-element literal writes,
   fixed `list<integer>` type, same binding on repeated writes, failure atomicity;
   add position-preserving `At` using existing CE semantics rather than a new
   general collection evaluator. Validate index 1 and out-of-range behavior,
   unchanged types and no production bind/retype tracking after preparation.
2. **Runtime value definitions:** distinguish a live formula read from a value
   initializer stored once. The current host recomputes readers in assignment
   order. Validate direct/indirect/transitive function reader controls from
   selective-rebind tests, with unrelated values stable. Prefer fresh evaluation
   of revision-owned formulas for the bounded experiment; do not recreate the
   host dirty graph in CE merely to save these lines.
3. **Host/revision seam (only a later authorized pilot):** source-to-slot mapping,
   explicit declarations and ownership, new revision for nonvalue edits, old
   handle retention, compile invalidation/inputs, prelude and value transfer.
   Validate complete selected-rebind cases, action click witness and F22 before
   any deletion. A whole-method replacement also needs random-once, moved-live
   overrides, failed-reader and timeout/error recovery controls.

These are proposed requirements of this experiment, not newly diagnosed CE
production defects and not promises that a supported production API exists.

## Combined cost, including coexistence

Observed existing phase-1 report baseline: **1,298 added tracked code lines,
zero removed**, excluding JSON/docs; 357 are experimental engine lines. The
ledger's 640 counts a smaller implementation/verification boundary, so it must
not be substituted for the report's combined total. The bounded revision adds
net 525 tracked code lines, making the current combined baseline **1,823**.
Its seven-line site JSON, evidence, documentation and temporary instruments
remain separate. No CE production machinery is currently removable.

The following are deliberately broad planning intervals, physical code lines,
not measurements or acceptance budgets. New code includes imports/types/error
handling; generated JSON and this document are excluded and must be reported
separately if later produced.

| Future scope | CE production/experimental additions | Host integration additions | Fixtures/tests/instruments | Credited deletions | Net additional coexistence |
| --- | ---: | ---: | ---: | ---: | ---: |
| Bounded numeric-list + indexed-read projection | 80–180 | 0 (CE-only adapter counted next column) | 120–240 | 0 | +200–420 |
| Complete selected method replacement, including readers, revision/compile seam and full host obligations | 350–800 | 180–400 | 300–600 | at most 274, conditional | +556–1,526 at optimistic full deletion; +830–1,800 while coexisting |

The full replacement estimate is incremental from phase 1, includes the
projection work, and excludes general F10–F22 implementation outside this
path. It is not an estimate for full phase 2. The optimistic deletion ceiling
is 251+21+2 lines; retaining compatibility stats and surrounding policy can
lower it. Relative to the revised combined phase-1 baseline, the bounded
projection would therefore leave **+2,023–2,243 lines, zero production deletion**;
the full selected-method replacement would leave **+2,379–3,349** even with
all 274 conditional deletions. Uncertainty is high because no host patch was
written or validated. No lower-level CE binder/cache removals are credited.

Recommendation: accept the narrow corpus-derived projection as a selection
candidate only if its measurements answer a useful list-write question after
phase 1 is revised. Do not start a complete replacement on a simplification
claim: the observed candidate has a small deletion ceiling and substantial
retained obligations. The alternative is to stop this path and select a larger
consumer boundary in a separately authorized costing exercise.

## Provenance and checks

Read source directly; no Tycho git command was run. Instructions read:
CE box specifics, shared-box protocol, Tycho root AGENTS/architecture/box
specifics, graph AGENTS, plot-core AGENTS, graph-paper README selected sections,
and Tycho CE durable-rules/live-workarounds/decided-items sections. The existing
deletion inventory was read as historical context and rechecked against current
members. Counts use TypeScript `createSourceFile` / `isMethodDeclaration`,
`getStart` and `end`; JSDoc is excluded. `rg -n` checks the named methods and
exclusive memo across Tycho `src`; `sed -n` reads the spans above and the
selective-rebind test. A Node JSON read counts the corpus entries and selects
ids 98/198 without evaluating them. SHA-256 uses Node `crypto.createHash` over
raw file bytes. Reproduce by running those read-only commands from CE, using
absolute Tycho paths; no checkout identity is inferred from a package label.

SHA-256 pins at selection time:

| File | SHA-256 |
| --- | --- |
| CE prototype plan | `13d0b04dcd6eb2b3711d9714d2b7f5f3b2773c00ca99bde9a00b8e0df5d6aabc` |
| CE phase1 report | `7b3fc21e1678e03b3bbc1572772c61ad412f146c1b8c5bee52c506314b19550b` |
| CE phase1 ledger | `c9ebd3c219e8d4dbe32ee9199ba532802d6edc64f525cc569e39aef6dbedf60e` |
| CE experimental stable-batch.ts | `1e4014a52cba5fcad5f063111c01fc299dc0d59d412b14d626b9f6af8a0fef4e` |
| Tycho document-ce-manager.ts | `ef9b166a701c944952487f9ec995574658a7dd4ad14d55fecadff0b7e16fef90` |
| Tycho selective-rebind.test.ts | `270952a51f58b31d2a9e3def14fa5a4131e30d5ca1b47144079cefe48e43f18d` |
| Tycho desmos/khpocp8io0.json | `aa408f2b8311e71647184619b66609e015d2c3a57bb149e98f403a301725563f` |
| Recovery deletion inventory | `7d0aed862ebd4d301b7850656d2c3eb6f45ba44c9eb55966d405dfdbe078f660` |

Only this CE Markdown report was written. No implementation, corpus execution,
timing, allocation, retention, build, typecheck, core/full tests, review or
staging ran: the assignment is read-only selection/costing and the proposed
behavior is not implemented. Named future validations above are not passes.
No worktree or additional agent was used; either would add cost to this bounded
document-only analysis. No generated API documentation input changed.

Read-only reproduction commands used for source/count provenance (run in CE):

```sh
rg -n '_rebindWrittenLiterals|_bodyReads\(|_bindReadsMemo|selectiveRebindStats' /Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts
sed -n '4730,5115p' /Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts
sed -n '4325,4375p' /Users/arno/dev/tycho/src/graph-paper/graph/document-ce-manager.ts
sed -n '1,130p' /Users/arno/dev/tycho/tests/node/graph-paper/selective-rebind.test.ts
rg -n 'it\(' /Users/arno/dev/tycho/tests/node/graph-paper/selective-rebind.test.ts
node - <<'JS'
const ts = require('typescript'), fs = require('fs'), crypto = require('crypto');
const root = '/Users/arno/dev/tycho/';
const manager = root + 'src/graph-paper/graph/document-ce-manager.ts';
const source = ts.createSourceFile(manager, fs.readFileSync(manager, 'utf8'), 99, true);
function walk(node) {
  if ((ts.isMethodDeclaration(node) || ts.isGetAccessor(node)) &&
      ['_rebindWrittenLiterals', '_bodyReads', 'selectiveRebindStats',
       '_registrationFingerprint', '_reuseRegistration', '_movedLiveOverrides']
        .includes(node.name.getText(source))) {
    const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const last = source.getLineAndCharacterOfPosition(node.end).line + 1;
    console.log(node.name.getText(source), first, last, last - first + 1);
  }
  ts.forEachChild(node, walk);
}
walk(source);
const fixture = root + 'tests/fixtures/documents/desmos/khpocp8io0.json';
const rows = JSON.parse(fs.readFileSync(fixture)).expressions.list;
console.log('rows', rows.length, rows.filter(x => ['98', '198'].includes(x.id)));
for (const path of [manager, fixture,
  root + 'tests/node/graph-paper/selective-rebind.test.ts',
  'docs/plans/2026-11-15-stable-batch-prototype-plan.md',
  'docs/plans/2026-11-15-stable-batch-phase1-report.md',
  'docs/plans/2026-11-15-stable-batch-phase1-ledger.md',
  'src/compute-engine/experimental/stable-batch.ts',
  '/Users/arno/dev/compute-engine-recovery/2026-11-15-tycho-deletion-inventory-ce-0.192.0.md'])
  console.log(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'), path);
JS
```
