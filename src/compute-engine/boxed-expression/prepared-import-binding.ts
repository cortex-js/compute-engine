import { ConstantAssignmentError } from '../constant-assignment-error.js';
import type { BoxedDefinition, Scope } from '../global-types.js';

type WriteAdmission = 'none' | 'value';

const writeAdmissions = new WeakMap<object, WriteAdmission>();

function sealPreparedImport(
  binding: object,
  admission: WriteAdmission = 'none'
): void {
  writeAdmissions.set(binding, admission);
}

/** Seal the namespace and each binding. Only admitted value slots stay writable. */
export function sealPreparedNamespace(
  scope: Scope,
  admitsValueWrite?: (name: string, binding: BoxedDefinition) => boolean
): void {
  sealPreparedImport(scope);
  for (const [name, binding] of scope.bindings) {
    const admission = admitsValueWrite?.(name, binding) ? 'value' : 'none';
    sealPreparedImport(binding, admission);
    if ('value' in binding) sealPreparedImport(binding.value, admission);
  }
}

/**
 * True for a binding, or the value definition of one, that
 * `sealPreparedNamespace()` sealed with no value write admitted: its value
 * cannot change.
 */
export function isSealedImportValue(binding: object | undefined): boolean {
  return binding !== undefined && writeAdmissions.get(binding) === 'none';
}

/**
 * True for a scope that `sealPreparedNamespace()` sealed: no name can be
 * declared in it.
 */
export function isSealedPreparedNamespace(scope: Scope): boolean {
  return writeAdmissions.get(scope) === 'none';
}

/**
 * The sealed value definitions whose value `withAdmittedValueWrites()`
 * lets a write change, or `undefined`.
 */
let admittedValueWrites: ReadonlySet<object> | undefined;

/**
 * Run `fn` with a value write admitted on each sealed value definition of
 * `defs`: the interpreter fallback of a compilation gives an `inputs` name
 * that is a Document row its value for one run, and puts the row's value
 * back before it returns (`withBindingValuesFn()`). The evaluation between
 * the two runs with no write admitted (`withoutAdmittedValueWrites()`). A
 * definition write stays refused. Re-entrant: an inner window keeps the
 * outer one.
 */
export function withAdmittedValueWrites<T>(
  defs: ReadonlySet<object>,
  fn: () => T
): T {
  if (defs.size === 0) return fn();
  const saved = admittedValueWrites;
  admittedValueWrites =
    saved === undefined ? defs : new Set([...saved, ...defs]);
  try {
    return fn();
  } finally {
    admittedValueWrites = saved;
  }
}

/** Run `fn` with no value write on a sealed definition admitted. */
export function withoutAdmittedValueWrites<T>(fn: () => T): T {
  const saved = admittedValueWrites;
  if (saved === undefined) return fn();
  admittedValueWrites = undefined;
  try {
    return fn();
  } finally {
    admittedValueWrites = saved;
  }
}

export function assertWritableImport(
  name: string,
  binding: object | undefined,
  write: 'value' | 'definition' = 'value'
): void {
  if (binding === undefined) return;
  const admission = writeAdmissions.get(binding);
  if (
    admission === 'none' &&
    write === 'value' &&
    admittedValueWrites?.has(binding)
  )
    return;
  if (admission === 'none' || (admission === 'value' && write === 'definition'))
    throw new ConstantAssignmentError(name);
}
