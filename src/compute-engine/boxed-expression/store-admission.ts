import type { BoxedType } from '../../common/type/boxed-type.js';
import type { Type } from '../../common/type/types.js';
import type {
  BoxedValueDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { storeAdmission } from './effects-inference.js';

/**
 * The stored values that a store admitted on overlap only
 * (`storeAdmission()` in `effects-inference.ts` gave `'overlap'`). A read of
 * a symbol tests its evaluated value against the declared type only when the
 * stored value is in this set, so the read of a value that fits its declared
 * type costs one lookup. The set holds the value expression, not the
 * definition: a checkpoint restore or a call frame that brings back a stored
 * value brings back its test too. When the same expression is also stored
 * into a symbol whose declared type it fits, the read of that symbol runs the
 * test too, and the test passes.
 */
const OVERLAP_ADMITTED = new WeakSet<Expression>();

/** Record that `value` was stored on overlap only (see `OVERLAP_ADMITTED`). */
export function noteOverlapAdmitted(value: Expression): void {
  OVERLAP_ADMITTED.add(value);
}

/** Whether `value` was stored on overlap only (see `OVERLAP_ADMITTED`). */
export function isOverlapAdmitted(value: Expression): boolean {
  return OVERLAP_ADMITTED.has(value);
}

/**
 * Whether a read of a symbol whose definition is `def` and whose stored
 * value is `value` tests the evaluated value against the declared type
 * (`BoxedSymbol._testedRead()`): `value` was stored on overlap only, and
 * `def` has a declared type that is not `unknown`. A type inferred from an
 * assigned value is not a declared type, so the read of such a symbol is not
 * tested, also when the stored value object was admitted on overlap into
 * another symbol.
 */
export function isTestedAtRead(
  def: BoxedValueDefinition | undefined,
  value: Expression | undefined
): boolean {
  return (
    value !== undefined &&
    def !== undefined &&
    isOverlapAdmitted(value) &&
    !def.inferredType &&
    !def.type.isUnknown
  );
}

/**
 * The last verdict of `overlapReadError()` for an evaluated value, keyed by
 * that value expression. A read of a symbol whose stored value is memoized
 * (`BoxedSymbol._dereferenceMemoized()`) gives the same result object until
 * a state change, so the verdict is computed once for that object. Only the
 * verdict of a value with no symbol (a literal, or a collection of literals)
 * is kept: it depends only on the value and on the declared type, so an
 * entry is used when the declared type is the same type object. The verdict
 * of a value that holds a symbol also depends on the type of that symbol and
 * on the facts in force, and some of their changes (a type written on a
 * definition, a fact hidden for a computation) do not advance the world
 * version of the engine (`ce._worldVersion`), so such a verdict is computed
 * at each read. The world version is still part of the key, so an entry
 * also expires at each change that advances it.
 */
const READ_VERDICTS = new WeakMap<
  Expression,
  {
    readonly worldVersion: number;
    readonly declared: Type;
    readonly error: Expression | undefined;
  }
>();

/**
 * The value of a read of a symbol whose stored value was admitted on overlap
 * only (`storeAdmission()` gave `'overlap'`), when the evaluated value
 * `result` is not a value of the declared type `declared`: an
 * `incompatible-type` error expression, as for a call argument that is not
 * of its parameter type when it is bound. `undefined` when `result` is
 * admitted: it fits the declared type, or it is still symbolic and its type
 * overlaps the declared type.
 */
export function overlapReadError(
  ce: ComputeEngine,
  result: Expression,
  declared: BoxedType
): Expression | undefined {
  if (!result.isValid) return undefined;
  const worldVersion = ce._worldVersion;
  const cached = READ_VERDICTS.get(result);
  if (
    cached !== undefined &&
    cached.worldVersion === worldVersion &&
    cached.declared === declared.type
  )
    return cached.error;
  const error =
    storeAdmission(ce, result, declared, false) === 'refuse'
      ? ce.typeError(declared.type, result.type, result)
      : undefined;
  if (result.symbols.length === 0)
    READ_VERDICTS.set(result, {
      worldVersion,
      declared: declared.type,
      error,
    });
  return error;
}
