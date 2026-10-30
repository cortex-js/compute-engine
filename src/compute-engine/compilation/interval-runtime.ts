/**
 * The standalone runtime for compiled `interval-js` code: rebuild the function
 * of a stored `interval-js` compilation result with no engine behind it, on a
 * page, in a worker or on a server, and run it or broadcast it over a batch.
 * The counterpart of `createJavaScriptRuntime` (`javascript-runtime.ts`) for
 * the interval target; exported from `@cortex-js/compute-engine/interval`. It
 * lives under `compilation/` because `interval/` must not import from
 * `compilation/` (the layering rules of `.oxlintrc.json`), and the broadcast
 * loop is a compilation module.
 *
 * A stored result is plain data: `code`, the optional `preambleOnce` (the
 * constant and condition-variable declarations, evaluated once) and
 * `preamblePerCall` (the definitions evaluated on every call), and the
 * `runtimeVersion` of the interval library the code was compiled against.
 * `load()` refuses a result whose version is not this runtime's, because the
 * code names `_IA` helpers by name and a helper can change between releases.
 */

import {
  IntervalArithmetic,
  INTERVAL_RUNTIME_VERSION,
} from '../interval/index.js';
import { processInput, freshIntervalValue } from '../interval/run-support.js';
import {
  broadcastIntervals,
  broadcastIntervalsSlice,
  type BroadcastSlice,
} from './broadcast.js';
import type {
  BroadcastInputs,
  BroadcastOptions,
  IntervalValue,
} from './types.js';

/** The fields of an `interval-js` compilation result that the runtime reads. */
export interface StoredIntervalJavaScript {
  runtimeVersion?: string;
  code: string;
  /** The whole preamble, when the result does not split it. */
  preamble?: string;
  preambleOnce?: string;
  preamblePerCall?: string;
  /** The value kind types whose compile contracts the code reads or makes
   * (`CompilationResult.valueKinds`). Code with one cannot be loaded. */
  valueKinds?: string[];
  /** The free variables declared `boolean`
   * (`CompilationResult.booleanInputs`). */
  booleanInputs?: string[];
}

export interface IntervalRuntime {
  /** The version of the interval library this runtime binds as `_IA`. */
  readonly runtimeVersion: string;
  /**
   * Rebuild the function of a stored result. The returned function takes a
   * vars object of `{ lo, hi }` enclosures (a number is a point interval) and
   * gives the `IntervalValue` that the result's own `run()` gives: inputs are
   * converted the same way, the answer is copied so that it shares nothing
   * with the hoisted constants, and an error inside the code answers
   * `{ kind: 'entire' }`.
   */
  load: (stored: StoredIntervalJavaScript) => (vars: unknown) => IntervalValue;
  /**
   * Rebuild the function of a stored result as a batch evaluator: the
   * `broadcast()` of the result (`compilation/broadcast.ts`), with the same
   * inputs, layouts and `lo, hi, kind` output.
   */
  loadBroadcast: (
    stored: StoredIntervalJavaScript
  ) => (inputs: BroadcastInputs, options?: BroadcastOptions) => Float64Array;
  /**
   * The slice form of `loadBroadcast`: evaluate the cells of `slice` and
   * write them at the start of `out`, three values each, returning the count
   * written (`broadcastIntervalsSlice`). The loop a kernel worker runs for
   * one task.
   */
  loadBroadcastSlice: (
    stored: StoredIntervalJavaScript
  ) => (
    inputs: BroadcastInputs,
    options: BroadcastOptions | undefined,
    out: Float64Array,
    slice: BroadcastSlice
  ) => number;
}

/** Build the raw callable of a stored result: the once-only declarations
 * evaluated now, the per-call definitions and the body on every call. */
function rawCallOf(
  stored: StoredIntervalJavaScript
): (vars: unknown) => unknown {
  // The run-time checks of the host values of the inputs of a value kind
  // (the enclosure) are functions of the host that compiled the code, and
  // stored code does not carry them: it would run with no check.
  const kinds = stored.valueKinds;
  if (kinds !== undefined && kinds.length > 0)
    throw new Error(
      `The stored code was compiled with the compile contract of the value kind type ${kinds.map((k) => `'${k}'`).join(', ')}, whose run-time checks are functions of the host that compiled it: it cannot be loaded. Run it with the \`run()\` of the compilation result.`
    );
  if (stored.runtimeVersion === undefined)
    throw new Error(
      'The stored interval code has no runtimeVersion: it cannot be matched to this runtime'
    );
  if (stored.runtimeVersion !== INTERVAL_RUNTIME_VERSION)
    throw new Error(
      `The interval code was compiled for runtime ${stored.runtimeVersion}, this is runtime ${INTERVAL_RUNTIME_VERSION}`
    );
  const split =
    stored.preambleOnce !== undefined || stored.preamblePerCall !== undefined;
  const once = split ? (stored.preambleOnce ?? '') : '';
  const perCall = split
    ? (stored.preamblePerCall ?? '')
    : (stored.preamble ?? '');
  const stage = new Function(
    '_IA',
    `${once}\nreturn function (_) { ${perCall}${perCall ? ';' : ''} return ${stored.code}; };`
  ) as (ia: typeof IntervalArithmetic) => (vars: unknown) => unknown;
  return stage(IntervalArithmetic);
}

/** The `booleanInputs` of a stored result, when it is an array of names
 * (stored data is plain data that a host can change). */
function storedBooleanInputs(
  stored: StoredIntervalJavaScript
): string[] | undefined {
  const b: unknown = stored.booleanInputs;
  return Array.isArray(b) && b.every((n) => typeof n === 'string')
    ? (b as string[])
    : undefined;
}

export function createIntervalRuntime(): IntervalRuntime {
  return {
    runtimeVersion: INTERVAL_RUNTIME_VERSION,
    load: (stored) => {
      const raw = rawCallOf(stored);
      return (vars: unknown): IntervalValue => {
        try {
          return freshIntervalValue(raw(processInput(vars))) as IntervalValue;
        } catch (e) {
          // The same rule as the runner of the engine
          // (`ComputeEngineIntervalFunction`): a `ReferenceError` (the code
          // names something that is not defined, for example a helper that
          // reads a variable from outside its own body) is a defect of the
          // code and is thrown; any other error answers "cannot bound this"
          // rather than an exception.
          if (e instanceof ReferenceError) throw e;
          return { kind: 'entire' };
        }
      };
    },
    // The variables declared `boolean` travel with the stored result
    // (`CompilationResult.booleanInputs`): for them an empty array is an
    // empty column, as in the `broadcast()` of the result.
    loadBroadcast: (stored) => {
      const raw = rawCallOf(stored);
      const booleans = storedBooleanInputs(stored);
      return (inputs, options) =>
        broadcastIntervals(raw, inputs, options, booleans);
    },
    loadBroadcastSlice: (stored) => {
      const raw = rawCallOf(stored);
      const booleans = storedBooleanInputs(stored);
      return (inputs, options, out, slice) =>
        broadcastIntervalsSlice(raw, inputs, options, out, slice, booleans);
    },
  };
}
