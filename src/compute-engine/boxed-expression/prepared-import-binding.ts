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

export function assertWritableImport(
  name: string,
  binding: object | undefined,
  write: 'value' | 'definition' = 'value'
): void {
  if (binding === undefined) return;
  const admission = writeAdmissions.get(binding);
  if (admission === 'none' || (admission === 'value' && write === 'definition'))
    throw new ConstantAssignmentError(name);
}
