/**
 * The run-time support of a compiled `interval-js` function, shared by the
 * engine's own runner (`ComputeEngineIntervalFunction` in
 * `compilation/interval-javascript-target.ts`) and by the standalone interval
 * runtime (`createIntervalRuntime` in `compilation/interval-runtime.ts`), which rebuilds a
 * stored compilation result with no engine behind it. Both must convert the
 * inputs and copy the results the same way, so that a value computed from
 * stored code on a worker is the value `run()` gives on the main thread.
 *
 * This module is a leaf: it imports types only.
 */

import type { Interval } from './types.js';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** A bare `{ lo, hi }` with numeric endpoints and nothing else. */
export function isPlainInterval(value: unknown): value is Interval {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    typeof value.lo === 'number' &&
    typeof value.hi === 'number'
  );
}

export function hasIntervalBounds(
  value: unknown
): value is { lo: unknown; hi: unknown } {
  return isRecord(value) && 'lo' in value && 'hi' in value;
}

/**
 * Process an input value to interval format.
 *
 * Accepts:
 * - { lo: number, hi: number } - Direct interval
 * - { x: {...}, y: {...} } - Object with interval-valued properties
 * - number - Convert to point interval
 */
export function processInput(input: unknown): unknown {
  if (input === null || input === undefined) {
    return input;
  }

  // Already an interval
  if (hasIntervalBounds(input)) {
    return input;
  }

  // A COLLECTION input stays an array: the accessors (`_IA.at`, `_IA.length`,
  // `_IA.component`) dispatch on `Array.isArray` and read `.length`. The
  // generic record branch below would copy it into a null-prototype object
  // keyed "0", "1", … — silently losing both the length and the positional
  // access, so every collection access would answer absence.
  if (Array.isArray(input)) return input.map(processInput);

  // Object with properties - process recursively
  if (isRecord(input)) {
    // Prototype-free — see `collapseIntervalInput`: an ordinary object cannot
    // carry an own `__proto__` key, so the caller's value for a variable of
    // that name would be silently lost in this copy.
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(input)) {
      result[key] = processInput(value);
    }
    return result;
  }

  // Number - convert to point interval
  if (typeof input === 'number') {
    return { lo: input, hi: input };
  }

  return input;
}

/**
 * A copy of a run result that shares no object with the constant table.
 *
 * The constant declarations are evaluated ONCE per artifact, so a constant
 * interval is the SAME object on every call, and several routines hand an
 * operand back rather than building a new answer — `piecewise` returns the
 * arm it selected, `restrict` returns its value. A caller who writes to the
 * `lo` of a returned interval would therefore change what every later call
 * answers. Copying the result on the way out keeps the returned value the
 * caller's own, at the cost of one small object per call.
 *
 * The copy is one level deep for a kinded result (the wrapper and the
 * enclosure it carries), and elementwise for an array — the value a
 * collection-valued root answers, whether it is the result itself or the
 * value a kinded wrapper carries. A number, a string and a nested plain value
 * copy through as they are.
 *
 * The copy also gives every scalar of the result the one shape of the `run`
 * contract, at every depth of an array: a kinded `IntervalResult`, never a
 * bare `{ lo, hi }`, and `{ kind: 'empty' }` for an absent value.
 */
export function freshIntervalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(freshIntervalValue);
  if (!isRecord(value)) return value;
  // A bare enclosure `{ lo, hi }` — what the compiled code gives for a
  // constant, a bare variable or a block that returns a local — is wrapped
  // as the `{ kind: 'interval', value }` result that a computed value has. A
  // bare enclosure whose lower bound is NaN is this target's absent marker
  // (see `isAbsent` in `interval/comparison.ts`) and becomes
  // `{ kind: 'empty' }`, the value the compiled code and the interpreter
  // fallback give where there is no value.
  if (
    !('kind' in value) &&
    typeof value.lo === 'number' &&
    typeof value.hi === 'number'
  ) {
    if (Number.isNaN(value.lo)) return { kind: 'empty' };
    return { kind: 'interval', value: { lo: value.lo, hi: value.hi } };
  }
  // The absent marker can also arrive inside a kinded wrapper — an operation
  // over an absent operand answers `{ kind: 'interval', value }` whose
  // enclosure is NaN, a restriction of it a `partial` one. `isAbsent` reads
  // both as absent, and the runner gives them as `empty` too.
  if (
    (value.kind === 'interval' || value.kind === 'partial') &&
    isPlainInterval(value.value) &&
    Number.isNaN(value.value.lo)
  )
    return { kind: 'empty' };
  // The `missing` flag of an `empty` result (an absent value whose
  // interpreter value is `Missing`) is read by the comparisons inside the
  // compiled code only. The runner gives every absent value one spelling.
  if (value.kind === 'empty') return { kind: 'empty' };
  const copy: Record<string, unknown> = { ...value };
  if (isPlainInterval(copy.value)) copy.value = { ...copy.value };
  else if (Array.isArray(copy.value))
    copy.value = copy.value.map(freshIntervalValue);
  return copy;
}
