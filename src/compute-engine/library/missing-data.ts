import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isAbsentValue } from '../boxed-expression/type-guards.js';
import {
  collectionElementType,
  resolveTypeForCompilation as resolveType,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { enumerationDeclinedAfterWalk } from './collections.js';

/**
 * Can no element of this collection possibly be an ABSENT datum (a `Missing`
 * symbol or a `NaN` number)?
 *
 * Decided from the collection's static element type: `real` and its subtypes
 * (`integer`, `finite_integer`, …) contain neither — `nan` is a subtype of
 * `number` but NOT of `real`, and `missing` is a subtype of neither. A
 * collection typed `list<number>`, `list<integer> | missing`, or one whose
 * element type is unknown fails the test and is walked as before.
 *
 * The guarantee is only as good as the DECLARED type: a function annotated
 * `-> real` whose body evaluates to `0/0` puts a `NaN` into a `list<real>`,
 * and this test would skip the walk that would have found it. No wrong VALUE
 * is known to follow — a `NaN` element still propagates through the numeric
 * kernels to a `NaN` result, and `Max`/`Min` absorb it explicitly — so the
 * skip trades an exact gate verdict for one that leans on the type being
 * honest, and degrades to the same answer by a different route when it is not.
 */
function cannotContainAbsentValue(collection: Expression): boolean {
  const elt = collectionElementType(resolveType(collection.type.type));
  return elt !== undefined && isSubtype(elt, 'real');
}

/**
 * The absent-datum / empty-input gate shared by the 15 data-consuming
 * aggregates (`Mean`, `Variance`, …, `Max`, `Min`, `Mode`) — §3.C of the
 * missing-value typing design
 * (`docs/TYPE-SYSTEM.md`, revision 6).
 *
 * A data-consuming aggregate over data that contains an ABSENT datum — a
 * `Missing` symbol or a `NaN` number, whether a direct scalar operand or an
 * element flattened from a finite collection operand — is itself absent. So is
 * an aggregate over EMPTY input (no data at all). In a numeric result cell,
 * absence is normalized to `NaN` (I6 absorption): there is no `| missing` arm,
 * so the gate returns `NaN`, never the `Missing` symbol.
 *
 * Returns `ce.NaN` when the gate fires (absent datum or empty input),
 * otherwise `undefined` (the handler proceeds with its ordinary computation).
 *
 * A NON-finite collection operand (a symbolic-length range) is UNDECIDABLE
 * here: the gate returns `undefined` so the operator's own handler decides (it
 * typically stays symbolic). So is a finite operand whose enumeration DECLINES
 * — it reports a size but cannot produce the elements, like `Linspace(a, 1, 3)`
 * with a symbolic endpoint. Only a genuinely EMPTY input is judged empty.
 */
export function aggregateAbsence(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  let sawData = false;
  let undecidable = false;
  // Collections the walk below can skip because their element type proves
  // there is no absent datum to find. They still bear on the EMPTY-input half
  // of the gate, so they are held back and consulted only if nothing else
  // supplied data.
  const unwalked: Expression[] = [];
  for (const op of ops) {
    if (op.isCollection) {
      if (op.isFiniteCollection !== true) {
        // Can't flatten a non-finite collection: don't force `NaN`, but do not
        // claim the input is empty either.
        undecidable = true;
        continue;
      }
      // Walking is how this gate finds an absent element, and it is not free:
      // enumerating a lazy `Map`/`Filter` runs its element callback once per
      // element, and the aggregate's own handler then walks the same
      // collection again to compute its result. Since the language has
      // mutation, that doubled run is observable — `Max(Map(f, xs))` ran `f`
      // twice per element. Skip the walk whenever the element type rules an
      // absent element out; the aggregate's own pass is then the only one.
      if (cannotContainAbsentValue(op)) {
        unwalked.push(op);
        continue;
      }
      let walked = 0;
      for (const el of op.each()) {
        walked += 1;
        sawData = true;
        if (isAbsentValue(el)) return ce.NaN;
      }
      // A walk that produced nothing does NOT mean the input is empty. A
      // collection can report a definite size yet DECLINE to enumerate —
      // `Linspace(a, 1, 3)` has three elements, but with a symbolic endpoint
      // none of them has a computable value, so `each()` yields nothing.
      // Reading that as empty fired the gate and answered `Max(Linspace(a, 1,
      // 3))` = `NaN`, a wrong VALUE: three elements exist and their maximum is
      // simply not yet known. Treat it as UNDECIDABLE so the gate passes and
      // the operator's own handler keeps the operand symbolic — which is what
      // `Sum(Linspace(a, 1, 3))` and `Max(Range(a, 3))` already did. A
      // genuinely empty collection (a `Filter` with no matches) reports
      // `isEmptyCollection === true`, is not "declined", and still gives NaN.
      if (enumerationDeclinedAfterWalk(op, walked)) undecidable = true;
    } else {
      sawData = true;
      if (isAbsentValue(op)) return ce.NaN;
    }
  }
  // A skipped collection still bears on the EMPTY-input half of the gate, and
  // its emptiness cannot be read cheaply: `Filter.isEmpty` enumerates its
  // source up to the first match, which runs a lazy predicate callback that
  // the aggregate's own walk is about to run again — the very duplication the
  // skip above exists to avoid. So when nothing else supplied data the gate
  // DECLINES rather than probe, and the aggregate decides: it walks the data
  // anyway and knows how many elements it saw. `Max`/`Min` answer `NaN` for a
  // walk that produced no data (`evaluateMinMax`), and the statistics kernels
  // fold an empty data set to `NaN` on their own.
  if (!sawData && !undecidable && unwalked.length > 0) undecidable = true;
  // Empty input ⇒ NaN — but only when every operand was decidably finite (an
  // undecidable operand may yet contribute data the handler can reach).
  if (!sawData && !undecidable) return ce.NaN;
  return undefined;
}
