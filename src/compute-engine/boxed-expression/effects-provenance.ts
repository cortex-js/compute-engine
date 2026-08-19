/**
 * Effects-axis PROVENANCE recording —
 * `docs/EFFECTS-MODEL.md`.
 *
 * A separate module from `effects-inference.ts` deliberately: that module is
 * the `Function`-literal construction SEAM, guarded by an importer allowlist
 * (`test/compute-engine/effects-seam.test.ts`) so no construction site can
 * bypass the effect walk. The provenance recorders here are consumed by the
 * definition-mutation sites (`updateDef`, the re-derivation cascade, the
 * typed-`let` upgrade), which have no business on that allowlist — importing
 * the recorders must not look like importing the seam.
 */

import type { EffectSet } from '../../common/type/types.js';
import type { BoxedType } from '../../common/type/boxed-type.js';
import { signatureEffects } from '../../common/type/utils.js';
import { sameEffectSetSpelling } from '../../common/type/effects.js';
import { currentBoxingEpoch, recordTypeProvenance } from './type-provenance.js';

import type { Expression, TypeProvenanceEntry } from '../global-types.js';
import type { InferenceRollbackFrame } from '../inference-rollback.js';
import type { CheckpointHost } from '../checkpoint-journal.js';

/**
 * The site that STATED a definition half's current effects contract: the
 * `cause` of its most recent `axis: 'effects'`, kind `'declared'`
 * provenance entry. `undefined` when no such entry exists — in particular
 * for a contract stated at construction, which deliberately records none
 * (the phase-1 constructor-tax rule). The shared lookup behind every
 * `EffectContractError` producer.
 */
export function latestDeclaredEffectsSite(
  def: { _typeProvenance: TypeProvenanceEntry[] | undefined } | undefined
): Expression | undefined {
  const history = def?._typeProvenance;
  if (history === undefined) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.axis === 'effects' && entry.kind === 'declared')
      return entry.cause;
  }
  return undefined;
}

/**
 * A definition half's effects-CONTRACT state, for the transition test the
 * effects-axis provenance recorders share: the annotation provenance bit
 * and the effect set the half's arrow carries. Read uniformly off the
 * half's effective type (an operator half's `signature`, a value half's
 * `type`) — the arrow is the one source of truth (`docs/EFFECTS-MODEL.md`),
 * kept in lockstep with the cached set by `_setEffects`.
 */
export interface EffectsContractState {
  declared: boolean;
  effects: EffectSet | undefined;
}

export function effectsContractStateOf(
  half:
    | { effectsDeclared: boolean; signature: BoxedType }
    | { effectsDeclared: boolean; type: BoxedType }
): EffectsContractState {
  const t = 'signature' in half ? half.signature : half.type;
  return {
    declared: half.effectsDeclared,
    effects: signatureEffects(t.type),
  };
}

/**
 * Record an `axis: 'effects'` provenance entry on `target` when the
 * contract state actually changed — the single recording rule shared by the
 * three write sites (redefinition through `updateDef`, the provisional
 * re-derivation cascade, the typed-`let` upgrade):
 *
 * - `'declared'` when the `effectsDeclared` bit moved (either direction —
 *   a contract ENDING is history too), or a stated set was replaced by a
 *   differently-spelled one;
 * - `'inferred'` when only the inferred-track spelling moved (bit false on
 *   both sides);
 * - nothing when neither moved (`_inferredDraws`-only transitions are
 *   deliberately not contract state — no consumer reads frame-participation
 *   provenance).
 */
export function recordEffectsTransition(
  ce: {
    _rollbackFrames: ReadonlyArray<InferenceRollbackFrame>;
    _inferenceTxDepth: number;
    _boxingEpoch: number;
  } & CheckpointHost,
  target: { _typeProvenance: TypeProvenanceEntry[] | undefined },
  before: EffectsContractState,
  after: EffectsContractState,
  /** The definition's effective type AFTER the write (its arrow carries the
   * specifier — no new entry shape). */
  typeAfter: BoxedType,
  cause: Expression | undefined
): void {
  const bitMoved = before.declared !== after.declared;
  const spellingMoved = !sameEffectSetSpelling(before.effects, after.effects);
  if (!bitMoved && !spellingMoved) return;
  recordTypeProvenance(ce, target, {
    type: typeAfter,
    kind: bitMoved || after.declared ? 'declared' : 'inferred',
    axis: 'effects',
    cause,
    epoch: currentBoxingEpoch(ce),
  });
}
