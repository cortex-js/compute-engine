import type {
  Expression,
  IComputeEngine,
  SequenceDefinition,
  SequenceStatus,
  SequenceInfo,
  OEISSequenceInfo,
  OEISOptions,
} from './global-types.js';

import { isValueDef } from './boxed-expression/utils.js';
import { isExpression } from './boxed-expression/type-guards.js';

import {
  createSequenceHandler,
  validateSequenceDefinition,
  getSequenceStatus as getSequenceStatusImpl,
  getSequenceInfo as getSequenceInfoImpl,
  listSequences as listSequencesImpl,
  isSequence as isSequenceImpl,
  clearSequenceCache as clearSequenceCacheImpl,
  getSequenceCache as getSequenceCacheImpl,
  generateSequenceTerms as generateSequenceTermsImpl,
} from './sequence.js';

import {
  lookupSequence as lookupSequenceImpl,
  checkSequence as checkSequenceImpl,
} from './oeis.js';

export function declareSequence(
  ce: IComputeEngine,
  name: string,
  def: SequenceDefinition
): IComputeEngine {
  // Validate basic requirements (without parsing)
  if (!def.base || Object.keys(def.base).length === 0) {
    throw new Error(`Sequence "${name}" requires at least one base case`);
  }
  if (!def.recurrence) {
    throw new Error(`Sequence "${name}" requires a recurrence relation`);
  }

  // Each base value must be a number or a boxed expression, and the
  // constraints a LaTeX string or a boxed expression. Both go into the
  // sources that the memo stamp snapshots (`takeMemoStamp()` in
  // `sequence.ts`), and the snapshot reads the engine of each source
  // (`expr.engine.context`), so a raw string or a plain object (which the
  // TypeScript types forbid, but a JavaScript caller can pass) would fail
  // deep inside the memo code with a `TypeError` on the first read of a
  // term. The checks run before the placeholder declaration below, so a
  // refused definition does not reserve the name: the caller can correct
  // the definition and declare it again.
  for (const [k, v] of Object.entries(def.base)) {
    if (typeof v !== 'number' && !isExpression(v))
      throw new Error(
        `Invalid base case for "${name}": the value at index ${k} must be a number or an expression`
      );
  }
  if (
    def.constraints !== undefined &&
    typeof def.constraints !== 'string' &&
    !isExpression(def.constraints)
  )
    throw new Error(
      `Invalid constraints for "${name}": the value must be a LaTeX string or an expression`
    );

  // Declare the symbol first with a placeholder handler
  // This ensures the symbol exists when we parse the recurrence
  ce.declare(name, {
    subscriptEvaluate: () => undefined,
  });

  // Now validate and create the actual handler
  const validation = validateSequenceDefinition(ce, name, def);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Create the full subscriptEvaluate handler
  const handler = createSequenceHandler(ce, name, def);

  // Update the symbol's subscriptEvaluate handler
  // We need to access the internal definition to update it
  const boxedDef = ce.lookupDefinition(name);
  if (boxedDef && isValueDef(boxedDef)) {
    boxedDef.value.subscriptEvaluate = handler;
  }

  return ce;
}

export function getSequenceStatus(
  ce: IComputeEngine,
  name: string
): SequenceStatus {
  return getSequenceStatusImpl(ce, name);
}

export function getSequence(
  ce: IComputeEngine,
  name: string
): SequenceInfo | undefined {
  return getSequenceInfoImpl(ce, name);
}

export function listSequences(ce: IComputeEngine): string[] {
  return listSequencesImpl(ce);
}

export function isSequence(ce: IComputeEngine, name: string): boolean {
  return isSequenceImpl(ce, name);
}

export function clearSequenceCache(ce: IComputeEngine, name?: string): void {
  clearSequenceCacheImpl(ce, name);
}

export function getSequenceCache(
  ce: IComputeEngine,
  name: string
): Map<number | string, Expression> | undefined {
  return getSequenceCacheImpl(ce, name);
}

export function getSequenceTerms(
  ce: IComputeEngine,
  name: string,
  start: number,
  end: number,
  step?: number
): Expression[] | undefined {
  return generateSequenceTermsImpl(ce, name, start, end, step);
}

export function lookupOEIS(
  ce: IComputeEngine,
  terms: (number | Expression)[],
  options?: OEISOptions
): Promise<OEISSequenceInfo[]> {
  return lookupSequenceImpl(ce, terms, options);
}

export function checkSequenceOEIS(
  ce: IComputeEngine,
  name: string,
  count?: number,
  options?: OEISOptions
): Promise<{ matches: OEISSequenceInfo[]; terms: number[] }> {
  return checkSequenceImpl(ce, name, count, options);
}
