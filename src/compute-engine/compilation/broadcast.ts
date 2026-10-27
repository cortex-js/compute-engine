/**
 * `broadcast()`: evaluate a compiled function at many points in one call.
 *
 * A compiled `javascript` or `interval-js` result exposes `run(vars)`, which
 * converts its argument object and wraps its result on every call. A plotter
 * that samples a function once per pixel column, or once per cell of an
 * implicit plot, pays that per cell. `broadcast(inputs, options)` takes the
 * inputs of every cell at once, as one `Float64Array` per free variable, and
 * writes every result into one `Float64Array`: the conversions run once per
 * batch, the compiled body once per cell. Measured 2026-10-20: 20 % faster
 * than `run()` per cell on the main thread, and the batch is what a worker
 * thread receives when the host gives the engine a pool (design:
 * `docs/plans/2026-10-20-worker-kernel-pool.md`, section 5.4).
 *
 * This module is a leaf: it imports types only. The main thread and the
 * kernel worker run the same functions, so a result computed on a worker is
 * the result the main thread would have computed.
 *
 * **Inputs.** `inputs` maps each free variable to a `Float64Array` (one entry
 * per cell for `javascript`; a `lo, hi` pair per cell for `interval-js`) or
 * to a single number, the same value for every cell (a document variable;
 * for `interval-js` it is the point interval). With `layout: 'cells'` (the
 * default) every array has the same cell count. With `layout: 'grid'` the
 * arrays are the axes of a regular grid: the cell count is the product of
 * their lengths, the cells are laid out row-major with the FIRST variable in
 * key order of `inputs` varying fastest, and nothing is expanded on the
 * caller's side.
 *
 * **Index axes** (`grid` layout only). A variable that `options.indexes`
 * names is an axis of the grid whose value is the cell's position along
 * that axis: its input is the axis length `n`, a non-negative integer, and
 * the variable takes the values `0, 1, …, n − 1` (for `interval-js`, the
 * point intervals of these values). It is the same axis as a column
 * `Float64Array.from({ length: n }, (_, j) => j)` at the same place in key
 * order, with no column to send or read (ROADMAP CE-421).
 *
 * **Shared inputs** (`javascript` only). A variable that the compiled code
 * reads as a list (the `lists` of the entry plan, from a declared list type),
 * or that `options.shared` names, is bound once for the whole batch: the code
 * reads it by index (`F_{i+1}` with `i` the per-cell variable). Its value is
 * a plain array of numbers or a `Float64Array`. It is not a column of the
 * `cells` layout and not an axis of the `grid` layout. The ordinary compiled
 * body reads plain arrays only (its `at` helper gives `NaN` for a typed
 * array), so for it a `Float64Array` is copied into a plain array once,
 * before the cell loop. The batch body of a result compiled with
 * `broadcast: true` (`CompilationOptions.broadcast`, see
 * `BroadcastBatchBody`) reads a `Float64Array` in place; without it, every
 * batch reads the copy. A plain array for any other variable throws.
 *
 * **Output.** `javascript`: `outputs` values per cell (`options.outputs`, or
 * the default the result gives: the arity of an expression whose type is a
 * tuple of two or more elements that can be numbers, an element typed
 * `unknown` included; 1 otherwise), cell `c` at
 * `[outputs·c, outputs·c + outputs)`. A value is
 * converted as `run()` reports it: a boolean is `1` or `0`, a
 * complex value with a zero imaginary part is its real part, and a cell whose
 * evaluation throws or gives any other non-number is `NaN`. With more than
 * one output per cell, an array answer gives one value per element (an
 * element past the end of the array is `NaN`), and any other answer, or a
 * throw, gives `NaN` in every slot. With one output per cell, an array answer
 * is `NaN`. `interval-js`: a
 * `lo, hi, kind` triple per cell; `kind` is one of the `INTERVAL_KIND` codes,
 * `lo`/`hi` hold the enclosure for the kinds that have one and `NaN`
 * otherwise. A cell never rejects the batch: a thrown error or malformed
 * bounds give `INTERVAL_KIND.error`. The inputs themselves are checked before
 * the loop: a length mismatch or a wrong element type throws. A free variable
 * that `inputs` does not name reads as `undefined`, as it does for `run()`,
 * and its cells are `NaN` (or `error`).
 *
 * **Parity.** For each cell, the value is the one `run()` gives for that
 * cell's inputs (`javascript`), or the encoding of the `IntervalResult` that
 * `run()` gives (`interval-js`): the same compiled body runs with the same
 * conversions. Tycho's parity tests rely on this.
 */

import type {
  BroadcastInputs,
  BroadcastOptions,
  StoredBatchBody,
} from './types.js';

export type { BroadcastInputs, BroadcastOptions } from './types.js';

/**
 * The batch body of a `javascript` result, ready to run (ROADMAP CE-410):
 * the function of a `StoredBatchBody` and its parameters.
 *
 * The ordinary body reads each input from the vars object, and reads a
 * shared list with `_SYS.atNumeric`, which tests the array, the index and
 * the element at every read. The batch body takes its inputs as arguments,
 * and reads a shared list marked `direct` with no test of the array: the
 * batch checks such a list once, before the cell loop (a `Float64Array`, or
 * a plain array whose elements are all numbers, at least `minLength` long).
 * When a check fails, the whole batch runs the ordinary body, so the values
 * are those of the ordinary body for every input.
 *
 * `checked` holds the plain arrays that passed the check, with their length
 * then, so that the slices of one batch (a worker task, a `broadcastAsync`
 * slice, a `loadBroadcastSlice` call) do not scan the same array again: an
 * array of the same length is not scanned again. An element that the host
 * changes to a value that is not a number after the check breaks the
 * declared type of the list, and the result of the cells that read it is
 * then undefined, as for any input that does not respect its declared type
 * (no exception escapes the batch: each cell catches its own).
 */
export interface BroadcastBatchBody {
  /** The body: one argument per entry of `params`, in order. */
  call: (...args: unknown[]) => unknown;
  params: StoredBatchBody['params'];
  checked: WeakMap<object, number>;
}

/**
 * What `broadcastNumbers` reads of a `javascript` result's entry plan (the
 * `EntryPlan` of `javascript-runtime.ts`, which imports this module, so the
 * shape is restated here instead of imported): which vars-object keys the
 * code reads as complex values and which as lists. A positional (`args`)
 * plan belongs to a lambda result, which has no `broadcast`.
 */
export type BroadcastEntryPlan =
  | { kind: 'vars'; complex: readonly string[]; lists: readonly string[] }
  | { kind: 'args' };

/**
 * The `kind` codes of an `interval-js` broadcast, one per cell at offset
 * `3·i + 2` of the output. The enclosure, when the kind has one, is at
 * `3·i` (`lo`) and `3·i + 1` (`hi`).
 *
 * - `interval`: an ordinary enclosure; a half-infinite bound is ordinary.
 * - `empty`: no value on the input (a square root of a negative interval).
 * - `entire`: every real; nothing can be said.
 * - `singularPole`: the input crosses a pole (`1/x` on an interval holding
 *   zero); no enclosure.
 * - `singularJump`: the input crosses a jump (`floor`); `lo`/`hi` hold the
 *   enclosure of the values on both sides.
 * - `partial`: part of the input is outside the domain; `lo`/`hi` enclose the
 *   values on the part inside. Which side was clipped is not reported.
 * - `boolTrue`, `boolFalse`, `boolMaybe`: a compiled comparison or logical
 *   expression, true on the whole input, false on the whole input, or
 *   undecided.
 * - `error`: the evaluation of this cell threw, or gave bounds that are not
 *   numbers or are reversed.
 */
export const INTERVAL_KIND = {
  interval: 0,
  empty: 1,
  entire: 2,
  singularPole: 3,
  singularJump: 4,
  partial: 5,
  boolTrue: 6,
  boolFalse: 7,
  boolMaybe: 8,
  error: 9,
} as const;

export type IntervalKindCode =
  (typeof INTERVAL_KIND)[keyof typeof INTERVAL_KIND];

/** The inputs read into a form the loop walks: which variables are arrays,
 * which are scalars, the cell count, and the grid strides. */
interface BroadcastShape {
  /** The per-cell and per-batch scalar variables; not the shared inputs. */
  names: string[];
  /** The array of each name, or `null` for a scalar or an index axis. */
  arrays: (Float64Array | null)[];
  /** The scalar of each name (`NaN` for an array or an index axis). */
  scalars: number[];
  /** Whether each name is an index axis of the `grid` layout (see
   * `BroadcastOptions.indexes`): its value at a cell is the cell's position
   * along the axis. Its length is in `grid`. */
  indexes: boolean[];
  count: number;
  /** `grid` layout: the number of cells one step along each array axis
   * spans (1 for the first axis), and the axis length; `null` for `cells`. */
  grid: { stride: number; length: number }[] | null;
  /** The shared inputs, as given: each is bound once on the vars object (a
   * `Float64Array` after a copy into a plain array) and is neither a column
   * nor an axis. Always empty for `interval-js`. */
  shared: { name: string; value: Float64Array | readonly number[] }[];
}

const hasOwn = (o: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key);

/**
 * The names of the shared inputs of a `javascript` batch, in key order of
 * `inputs`: each key of `inputs` that `lists` holds (the variables the
 * compiled code reads as lists, from the entry plan) or that
 * `options.shared` names. A name in `options.shared` that is not a key of
 * `inputs` throws, and so does a `shared` option that is not an array of
 * strings.
 */
export function broadcastSharedNames(
  lists: readonly string[] | undefined,
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined
): string[] {
  const named = options?.shared;
  const wanted = new Set<string>();
  if (named !== undefined) {
    if (!Array.isArray(named) || named.some((name) => typeof name !== 'string'))
      throw new TypeError(
        'broadcast: `shared` must be an array of variable names'
      );
    for (const name of named) {
      if (!hasOwn(inputs, name))
        throw new TypeError(
          `broadcast: the shared input "${name}" is not a key of the inputs`
        );
      wanted.add(name);
    }
  }
  if (lists !== undefined) for (const name of lists) wanted.add(name);
  if (wanted.size === 0) return [];
  return Object.keys(inputs).filter((name) => wanted.has(name));
}

/**
 * The names of the index axes of a batch (`options.indexes`). The option
 * must be an array of strings, each a key of `inputs` that is not a shared
 * input, and it is accepted only with the `grid` layout: otherwise it
 * throws. The values are checked by `readShape`.
 */
function broadcastIndexNames(
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  layout: string,
  sharedNames: ReadonlySet<string>
): Set<string> {
  const named = options?.indexes;
  if (named === undefined) return new Set();
  if (!Array.isArray(named) || named.some((name) => typeof name !== 'string'))
    throw new TypeError(
      'broadcast: `indexes` must be an array of variable names'
    );
  if (layout !== 'grid')
    throw new TypeError(
      'broadcast: the `indexes` option needs the `grid` layout'
    );
  for (const name of named) {
    if (!hasOwn(inputs, name))
      throw new TypeError(
        `broadcast: the index axis "${name}" is not a key of the inputs`
      );
    if (sharedNames.has(name))
      throw new TypeError(
        `broadcast: "${name}" cannot be both a shared input and an index axis`
      );
  }
  return new Set(named);
}

/**
 * The count of numbers written per cell by a `javascript` batch:
 * `options.outputs` when given, else `defaultOutputs` (the stride the
 * result infers from the type of its expression), else 1. A value that is
 * not a positive integer throws.
 */
export function broadcastStride(
  options: BroadcastOptions | undefined,
  defaultOutputs: number | undefined
): number {
  const m = options?.outputs ?? defaultOutputs ?? 1;
  if (!Number.isInteger(m) || m < 1)
    throw new TypeError(
      `broadcast: \`outputs\` must be a positive integer (got ${String(m)})`
    );
  return m;
}

/** A shared input as the compiled code reads it: a plain array. A
 * `Float64Array` is copied once; a plain array is returned as it is. */
export function plainSharedArray(
  value: Float64Array | readonly number[]
): readonly number[] {
  return value instanceof Float64Array ? Array.from(value) : value;
}

/**
 * Validate the inputs and compute the cell count. `perCell` is 1 for a
 * `javascript` input and 2 for an interval (`lo, hi` pair). `lists` is the
 * `lists` of a `javascript` entry plan: those variables are shared inputs
 * (see `broadcastSharedNames`). An interval batch takes neither the
 * `shared` nor the `outputs` option: its loop writes a `lo, hi, kind`
 * triple per cell and its compiled code reads no list.
 */
function readShape(
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  perCell: 1 | 2,
  lists?: readonly string[]
): BroadcastShape {
  if (perCell === 2) {
    for (const option of ['shared', 'outputs'] as const)
      if (options?.[option] !== undefined)
        throw new TypeError(
          `broadcast: the \`${option}\` option is not supported by an interval-js result`
        );
  }
  const sharedNames = new Set(
    perCell === 1 ? broadcastSharedNames(lists, inputs, options) : []
  );
  const layout = options?.layout ?? 'cells';
  const indexNames = broadcastIndexNames(inputs, options, layout, sharedNames);
  const names: string[] = [];
  const arrays: (Float64Array | null)[] = [];
  const scalars: number[] = [];
  const indexes: boolean[] = [];
  const shared: BroadcastShape['shared'] = [];
  for (const name of Object.keys(inputs)) {
    const v = inputs[name];
    if (indexNames.has(name)) {
      if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
        throw new TypeError(
          `broadcast: the index axis "${name}" must be given its length, a non-negative integer`
        );
      names.push(name);
      arrays.push(null);
      scalars.push(NaN);
      indexes.push(true);
      continue;
    }
    if (sharedNames.has(name)) {
      if (!(v instanceof Float64Array) && !Array.isArray(v))
        throw new TypeError(
          `broadcast: the shared input "${name}" must be an array of numbers or a Float64Array`
        );
      shared.push({ name, value: v });
      continue;
    }
    if (typeof v === 'number') {
      names.push(name);
      arrays.push(null);
      scalars.push(v);
      indexes.push(false);
    } else if (v instanceof Float64Array) {
      if (v.length % perCell !== 0)
        throw new TypeError(
          `broadcast: the array for "${name}" must hold ${perCell === 2 ? 'lo, hi pairs' : 'one value per cell'} (its length is ${v.length})`
        );
      names.push(name);
      arrays.push(v);
      scalars.push(NaN);
      indexes.push(false);
    } else if (Array.isArray(v))
      throw new TypeError(
        perCell === 2
          ? `broadcast: the input for "${name}" must be a Float64Array or a number (a plain array is not accepted)`
          : `broadcast: the input for "${name}" must be a Float64Array or a number; a plain array is accepted only for a shared input (a variable the compiled code reads as a list, or one the \`shared\` option names)`
      );
    else
      throw new TypeError(
        `broadcast: the input for "${name}" must be a Float64Array or a number`
      );
  }
  if (layout === 'grid') {
    const grid: { stride: number; length: number }[] = [];
    let stride = 1;
    arrays.forEach((a, k) => {
      if (a === null && !indexes[k]) {
        grid.push({ stride: 0, length: 1 });
        return;
      }
      const length =
        a === null ? (inputs[names[k]] as number) : a.length / perCell;
      grid.push({ stride, length });
      stride *= length;
    });
    // An index axis is given by its length alone, so the product of the
    // lengths is not bounded by memory the caller already holds: refuse a
    // count that is not an exact integer, before any output is allocated.
    if (!Number.isSafeInteger(stride))
      throw new TypeError(
        `broadcast: the grid has too many cells (${stride}); the product of the axis lengths must be a safe integer`
      );
    return { names, arrays, scalars, indexes, count: stride, grid, shared };
  }
  if (layout !== 'cells')
    throw new TypeError(`broadcast: unknown layout "${String(layout)}"`);
  let count = -1;
  names.forEach((name, k) => {
    const a = arrays[k];
    if (a === null) return;
    const n = a.length / perCell;
    if (count === -1) count = n;
    else if (n !== count)
      throw new TypeError(
        `broadcast: the array for "${name}" holds ${n} cells, the first array ${count}`
      );
  });
  // Scalars only: one cell.
  return {
    names,
    arrays,
    scalars,
    indexes,
    count: count === -1 ? 1 : count,
    grid: null,
    shared,
  };
}

/** The index into the array of axis `k` for cell `i`. */
function axisIndex(shape: BroadcastShape, k: number, i: number): number {
  if (shape.grid === null) return i;
  const { stride, length } = shape.grid[k];
  return Math.floor(i / stride) % length;
}

function outputArray(
  out: Float64Array | undefined,
  needed: number
): Float64Array {
  if (out === undefined) return new Float64Array(needed);
  if (out.length < needed)
    throw new TypeError(
      `broadcast: the output array holds ${out.length} values, ${needed} are needed`
    );
  return out;
}

/** The value `run()` reports for a compiled body's answer, as a number. */
function numberOf(r: unknown): number {
  if (typeof r === 'number') return r;
  if (typeof r === 'boolean') return r ? 1 : 0;
  if (
    typeof r === 'object' &&
    r !== null &&
    typeof (r as { re?: unknown }).re === 'number' &&
    (r as { im?: unknown }).im === 0
  )
    return (r as { re: number }).re;
  return NaN;
}

/**
 * Evaluate a compiled `javascript` body over a batch.
 *
 * `call` runs the body on a vars object without the per-call checks of
 * `run()` (the raw call of `ComputeEngineFunction`). `entry` is the entry
 * plan `run()` applies, used here to lift a real given to a complex-declared
 * symbol: such a symbol reads a `{ re, im }` object that the loop reuses. A
 * symbol the plan reads as a list is a shared input, bound once for the
 * batch. `defaultOutputs` is the count of values per cell when
 * `options.outputs` is absent (the `broadcastOutputs` of the result).
 * `batch` is the batch body of the result, when it has one.
 */
export function broadcastNumbers(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  inputs: BroadcastInputs,
  options?: BroadcastOptions,
  defaultOutputs?: number,
  batch?: BroadcastBatchBody
): Float64Array {
  const shape = readShape(inputs, options, 1, listsOf(entry));
  const stride = broadcastStride(options, defaultOutputs);
  const out = outputArray(options?.out, stride * shape.count);
  broadcastNumbersRange(
    call,
    entry,
    shape,
    out,
    0,
    shape.count,
    stride,
    undefined,
    undefined,
    batch
  );
  return out;
}

/** The variables an entry plan reads as lists: the shared inputs. */
function listsOf(
  entry: BroadcastEntryPlan | undefined
): readonly string[] | undefined {
  return entry?.kind === 'vars' ? entry.lists : undefined;
}

/**
 * A slice of a batch: the cells `from` (included) to `to` (excluded) of the
 * batch `inputs` describe, and a wall-clock deadline (`Date.now()` time)
 * after which the loop stops. A worker thread runs one slice per task, and
 * `broadcastAsync` runs one slice between two yields to the event loop.
 */
export interface BroadcastSlice {
  from: number;
  to: number;
  /** `Date.now()` time after which the loop stops; checked every 1024 cells. */
  deadline?: number;
  /** Returns true when the loop must stop: a kernel worker reads the cancel
   * flag of its task here. Checked every 64 cells, the first one included. */
  stop?: () => boolean;
  /** When given, the loop adds 1 to `count` for each cell whose evaluation
   * threw. The values of such a cell are `NaN` (an `interval-js` cell is
   * an error enclosure), as for a cell whose value is not a number, so this
   * count is the only way to tell the two apart. */
  failures?: { count: number };
}

/** Cells between two deadline checks. A multiple of `STOP_CHECK_EVERY`
 * (`cellLoopFor` checks both between blocks of `STOP_CHECK_EVERY` cells). */
const DEADLINE_CHECK_EVERY = 1024;

/** Cells between two `stop` checks: a call and a read of shared memory are
 * cheaper than a read of the clock. */
const STOP_CHECK_EVERY = 64;

/**
 * Validate `inputs` and return the cell count of the batch, without
 * evaluating anything. `perCell` is 1 for `javascript`, 2 for `interval-js`.
 * `lists` is the `lists` of a `javascript` entry plan: those variables are
 * shared inputs, which do not count.
 */
export function broadcastCellCount(
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  perCell: 1 | 2,
  lists?: readonly string[]
): number {
  return readShape(inputs, options, perCell, lists).count;
}

/**
 * The slice form of `broadcastNumbers`: evaluate the cells `[from, to)` of
 * the batch `inputs` describe and write them at the START of `out` (cell
 * `from` at index 0, `outputs` values per cell). Returns the number of cells
 * written: `to - from`, or fewer when `deadline` passed or `stop` returned
 * true first. This is the
 * loop a worker thread runs for one task. A caller that runs several slices
 * of one batch passes its `Float64Array` shared inputs already copied into
 * plain arrays (`plainSharedArray`), so that the copy is made once per batch
 * instead of once per slice, except those that the batch body reads in place
 * (`sharedInputsReadInPlace`).
 */
export function broadcastNumbersSlice(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  out: Float64Array,
  slice: BroadcastSlice,
  defaultOutputs?: number,
  batch?: BroadcastBatchBody
): number {
  const shape = readShape(inputs, options, 1, listsOf(entry));
  return broadcastNumbersRange(
    call,
    entry,
    shape,
    out,
    slice.from,
    slice.to,
    broadcastStride(options, defaultOutputs),
    slice.deadline,
    slice.stop,
    batch,
    slice.failures
  );
}

/**
 * The names of the shared inputs that the batch body with the parameters
 * `params` reads in place and only in place (marked `direct`, and read by no
 * other parameter). A caller that runs several slices of one batch (a kernel
 * worker, `broadcastAsync`) passes these as they are given, and copies only
 * the other `Float64Array` shared inputs into plain arrays.
 */
export function sharedInputsReadInPlace(
  params: StoredBatchBody['params'] | undefined
): Set<string> {
  const names = new Set<string>();
  // A stored result is plain data that a host can change: anything but an
  // array of parameters reads nothing in place.
  if (!Array.isArray(params)) return names;
  for (const p of params) if (p?.direct === true) names.add(p.name);
  for (const p of params) if (p?.direct !== true) names.delete(p?.name);
  return names;
}

/**
 * The input arrays that the cell loop reads, with a copy of each array that
 * shares its memory with `out` (the same `buffer`). The loop writes the
 * values of cell `c` at `[m·c, m·c + m)`, with `m` the count of values per
 * cell (`outputs`, or 3 for `interval-js`), and that range can start before
 * the place where a later cell reads its input: with more than one value per
 * cell, with an interval batch (a `lo, hi` pair read and three values written
 * per cell), with a `grid` axis (read again for each row), or with a slice
 * (written at the start of `out`). Without the copy, a later cell would read
 * a value that an earlier cell wrote. The copy costs one pass over the array,
 * and is made only when the caller gives an input that shares the buffer of
 * the output, which is rare. An array that does not share it is returned as
 * it is.
 */
function unaliasedInputs(
  arrays: (Float64Array | null)[],
  out: Float64Array
): (Float64Array | null)[] {
  if (!arrays.some((a) => a !== null && a.buffer === out.buffer)) return arrays;
  return arrays.map((a) =>
    a !== null && a.buffer === out.buffer ? a.slice() : a
  );
}

/**
 * The cell loop of `broadcastNumbersRange`, written for one compiled body
 * and one shape of inputs. Its arguments: the vars object, the input arrays
 * (`null` for a scalar), the complex slot of each name (`null` for a real),
 * the output, the cells `[from, to)`, the deadline, the stop function and
 * the grid strides (`BroadcastShape.grid`). For a batch body, the vars
 * object is unused, and `args` holds the argument of each parameter that does
 * not change from cell to cell (see `batchArguments`). `failures` counts
 * the cells whose evaluation threw (`BroadcastSlice.failures`).
 * Returns the number of cells written.
 */
type CellLoop = (
  vars: Record<string, unknown>,
  arrays: (Float64Array | null)[],
  slots: ({ re: number; im: number } | null)[],
  out: Float64Array,
  from: number,
  to: number,
  deadline: number | undefined,
  stop: (() => boolean) | undefined,
  grid: BroadcastShape['grid'],
  args: unknown[] | undefined,
  failures: { count: number } | undefined
) => number;

/** The cell loops made so far, by compiled body, then by the key that
 * `cellLoopFor` builds from the shape. A body that is no longer used releases
 * its loops. */
const cellLoops = new WeakMap<object, Map<string, CellLoop>>();

/** Set to false when the host refuses `new Function` (a content security
 * policy): every batch then runs the generic loop. */
let cellLoopsAvailable = true;

/** A number in the source of each cell loop, so that no two loops have the
 * same source. */
let cellLoopSerial = 0;

/** The most values per cell for which the cell loop writes each value with
 * its own statement; a larger count is written by a loop. */
const UNROLLED_OUTPUTS = 32;

/**
 * A cell loop for the compiled body `call` and this shape of inputs, or
 * `undefined` when the host refuses `new Function`.
 *
 * The generic loop of `broadcastNumbersRange` is one function shared by
 * every compiled body, so V8 sees many targets at its `call(vars)` site and
 * does not inline the body: each cell pays a call, a new array for a tuple
 * result, and a store of each input by a key that changes. A loop made here
 * from its own source text has its own type feedback in V8: the call site
 * has one target, the body is inlined, and the array of a tuple result,
 * read and converted inside the same `try` block, is removed by V8's escape
 * analysis. The source differs for each loop (`cellLoopSerial`) because V8
 * shares the type feedback of two `new Function` results with the same
 * source. The input stores use a constant key, and the deadline and `stop`
 * checks run between blocks of `STOP_CHECK_EVERY` cells, outside the inner
 * loop (with the checks in the inner loop, even when both are `undefined`, a
 * cheap kernel took about 1.5 times as long). A kernel that computes two sines and returns a tuple of
 * two numbers took 5.8 ms for 250 000 cells in the generic loop and 3.4 ms in
 * its own loop, against 2.85 ms for the same arithmetic written in
 * JavaScript (measured 2026-10-24, ROADMAP CE-410).
 *
 * The values written are the values of the generic loop: each value is
 * converted by `numberOf`, an element past the end of an array answer is
 * `NaN`, any other answer with more than one output per cell is `NaN` in
 * every slot, and a cell that throws is `NaN` in every slot. One difference
 * is not observable from compiled code: the conversion runs inside the
 * `try` block, so a conversion that throws (a getter of an answer object)
 * gives `NaN` where the generic loop would throw. The deadline and `stop`
 * are checked before the same cells as in the generic loop, because
 * `DEADLINE_CHECK_EVERY` is a multiple of `STOP_CHECK_EVERY`.
 *
 * With `params`, the parameters of a batch body (`BroadcastBatchBody`), the
 * loop calls `call` with one argument per parameter instead of a vars
 * object: the value of the cell for a real input given as an array, read
 * from the array in the call itself, and otherwise the argument from `args`
 * that the batch computed before the loop (a scalar, the reused complex slot
 * of a complex input, a shared input, or `undefined`).
 */
function cellLoopFor(
  call: (...args: never[]) => unknown,
  shape: BroadcastShape,
  slots: ({ re: number; im: number } | null)[],
  stride: number,
  params?: StoredBatchBody['params']
): CellLoop | undefined {
  if (!cellLoopsAvailable) return undefined;
  // What the source depends on: the stride, the layout, for each name its
  // spelling and whether it is a scalar, a real array or a complex array,
  // and the parameters of a batch body.
  // An index axis is `x` (real) or `y` (complex): its value is the
  // index into the axis, with no array read.
  const kinds = shape.names.map((_, k) =>
    shape.indexes[k]
      ? slots[k] !== null
        ? 'y'
        : 'x'
      : shape.arrays[k] === null
        ? 's'
        : slots[k] !== null
          ? 'c'
          : 'a'
  );
  const grid = shape.grid;
  const key = JSON.stringify([
    stride,
    grid !== null,
    shape.names,
    kinds,
    params ?? null,
  ]);
  let byKey = cellLoops.get(call);
  const known = byKey?.get(key);
  if (known !== undefined) return known;
  const setup: string[] = [];
  const reads: string[] = [];
  // The index into the array of axis `k` (see `axisIndex`).
  const indexOf = (k: number): string =>
    grid === null ? 'i' : `Math.floor(i / t${k}) % n${k}`;
  // The value of name `k` at cell `i`: the index itself for an index
  // axis, else the element of its array.
  const valueOf = (k: number): string =>
    kinds[k] === 'x' || kinds[k] === 'y'
      ? `(${indexOf(k)})`
      : `a${k}[${indexOf(k)}]`;
  shape.names.forEach((name, k) => {
    if (kinds[k] === 's') return;
    if (kinds[k] === 'a' || kinds[k] === 'c')
      setup.push(`const a${k} = arrays[${k}];`);
    if (kinds[k] === 'c' || kinds[k] === 'y')
      setup.push(`const s${k} = slots[${k}];`);
    if (grid !== null)
      setup.push(`const t${k} = grid[${k}].stride, n${k} = grid[${k}].length;`);
    if (kinds[k] === 'c' || kinds[k] === 'y')
      reads.push(`s${k}.re = ${valueOf(k)};`);
    else if (params === undefined)
      reads.push(`vars[${JSON.stringify(name)}] = ${valueOf(k)};`);
  });
  // The call: with the vars object, or with one argument per parameter of
  // a batch body.
  let callCode = 'call(vars)';
  if (params !== undefined) {
    const argCodes = params.map((p, j) => {
      const k = p.direct === true ? -1 : shape.names.indexOf(p.name);
      if (k >= 0 && (kinds[k] === 'a' || kinds[k] === 'x')) return valueOf(k);
      setup.push(`const d${j} = args[${j}];`);
      return `d${j}`;
    });
    callCode = `call(${argCodes.join(', ')})`;
  }
  const nanSlots =
    stride <= UNROLLED_OUTPUTS
      ? Array.from({ length: stride }, (_, k) => `out[o + ${k}] = NaN;`).join(
          ' '
        )
      : `out.fill(NaN, o, o + ${stride});`;
  let write: string;
  if (stride === 1) write = 'out[o] = typeof r === "number" ? r : numberOf(r);';
  else {
    const each: string[] = [];
    if (stride <= UNROLLED_OUTPUTS) {
      for (let k = 0; k < stride; k++)
        each.push(
          `const e${k} = r[${k}]; out[o + ${k}] = typeof e${k} === "number" ? e${k} : numberOf(e${k});`
        );
    } else
      each.push(
        `for (let k = 0; k < ${stride}; k++) { const e = r[k]; out[o + k] = typeof e === "number" ? e : numberOf(e); }`
      );
    // An index past the end of the array reads `undefined`, which
    // `numberOf` converts to `NaN`.
    write = `if (Array.isArray(r)) { ${each.join(' ')} } else { ${nanSlots} }`;
  }
  const source = `"use strict";
// broadcast cell loop ${cellLoopSerial++}
return function (vars, arrays, slots, out, from, to, deadline, stop, grid, args, failures) {
  ${setup.join('\n  ')}
  for (let start = from; start < to; start += ${STOP_CHECK_EVERY}) {
    if (deadline !== undefined && (start - from) % ${DEADLINE_CHECK_EVERY} === 0 && Date.now() > deadline) return start - from;
    if (stop !== undefined && stop()) return start - from;
    const end = start + ${STOP_CHECK_EVERY} < to ? start + ${STOP_CHECK_EVERY} : to;
    for (let i = start; i < end; i++) {
      ${reads.join('\n      ')}
      const o = ${stride} * (i - from);
      try {
        const r = ${callCode};
        ${write}
      } catch {
        ${nanSlots}
        if (failures !== undefined) failures.count++;
      }
    }
  }
  return to - from;
};`;
  let loop: CellLoop;
  try {
    loop = new Function('call', 'numberOf', source)(call, numberOf) as CellLoop;
  } catch {
    cellLoopsAvailable = false;
    return undefined;
  }
  if (byKey === undefined) {
    byKey = new Map();
    cellLoops.set(call, byKey);
  }
  byKey.set(key, loop);
  return loop;
}

/**
 * Whether the shared input `value` can be read with no per-read test of the
 * array by a batch body: a `Float64Array`, or a plain array whose elements
 * are all numbers, of at least `minLength` elements. A plain array that
 * passed is recorded in `checked` with its length, and is not scanned again
 * while its length is the same (see `BroadcastBatchBody`).
 */
function checkedSharedList(
  value: Float64Array | readonly number[],
  minLength: number,
  checked: WeakMap<object, number>
): boolean {
  if (value instanceof Float64Array) return value.length >= minLength;
  if (!Array.isArray(value) || value.length < minLength) return false;
  if (checked.get(value) === value.length) return true;
  for (let k = 0; k < value.length; k++)
    if (typeof value[k] !== 'number') return false;
  checked.set(value, value.length);
  return true;
}

/**
 * The arguments of the batch body `batch` for this batch, in the order of
 * its parameters, or `undefined` when a shared input that it reads directly
 * fails the per-batch check (`checkedSharedList`) or is not a shared input
 * of the batch: the batch then runs the ordinary body.
 *
 * A parameter that is not `direct` receives what the ordinary body reads on
 * the vars object for its name: the complex slot of a complex input, the
 * number of a scalar input (for a real input given as an array, the cell
 * loop reads the cell's value instead), the plain array of a shared input,
 * or `undefined` when the inputs do not name it. A `direct` parameter
 * receives the shared input as given, except a `Float64Array` that shares
 * its memory with `out`: the loop writes `out` while later cells read the
 * input, so that input is copied first, as the ordinary body copies it.
 */
function batchArguments(
  batch: BroadcastBatchBody,
  shape: BroadcastShape,
  complexSlots: ({ re: number; im: number } | null)[],
  out: Float64Array,
  plainOf: (s: BroadcastShape['shared'][number]) => readonly number[]
): unknown[] | undefined {
  const args: unknown[] = [];
  for (const p of batch.params) {
    const shared = shape.shared.find((s) => s.name === p.name);
    if (p.direct === true) {
      if (
        shared === undefined ||
        !checkedSharedList(shared.value, p.minLength ?? 0, batch.checked)
      )
        return undefined;
      const v = shared.value;
      args.push(
        v instanceof Float64Array && v.buffer === out.buffer ? v.slice() : v
      );
      continue;
    }
    if (shared !== undefined) {
      args.push(plainOf(shared));
      continue;
    }
    const k = shape.names.indexOf(p.name);
    args.push(k < 0 ? undefined : (complexSlots[k] ?? shape.scalars[k]));
  }
  return args;
}

function broadcastNumbersRange(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  shape: BroadcastShape,
  out: Float64Array,
  from: number,
  to: number,
  stride: number,
  deadline?: number,
  stop?: () => boolean,
  batch?: BroadcastBatchBody,
  failures?: { count: number }
): number {
  if (out.length < stride * (to - from))
    throw new TypeError(
      `broadcast: the output array holds ${out.length} values, ${stride * (to - from)} are needed`
    );
  const complexNames =
    entry?.kind === 'vars' ? new Set(entry.complex) : new Set<string>();
  // The `{ re, im }` slot that each complex input reads, reused from cell to
  // cell; `null` for a real input.
  const complexSlots: ({ re: number; im: number } | null)[] = shape.names.map(
    (name, k) =>
      complexNames.has(name) ? { re: shape.scalars[k], im: 0 } : null
  );
  const arrays = unaliasedInputs(shape.arrays, out);
  // The plain array of each shared input, made at most once per call.
  const plain = new Map<string, readonly number[]>();
  const plainOf = (s: BroadcastShape['shared'][number]): readonly number[] => {
    let p = plain.get(s.name);
    if (p === undefined) {
      p = plainSharedArray(s.value);
      plain.set(s.name, p);
    }
    return p;
  };
  if (batch !== undefined) {
    const args = batchArguments(batch, shape, complexSlots, out, plainOf);
    const loop =
      args === undefined
        ? undefined
        : cellLoopFor(batch.call, shape, complexSlots, stride, batch.params);
    if (loop !== undefined)
      return loop(
        Object.create(null),
        arrays,
        complexSlots,
        out,
        from,
        to,
        deadline,
        stop,
        shape.grid,
        args,
        failures
      );
  }
  // The vars object has no prototype, so that a free variable that `inputs`
  // does not name (`toString`, `constructor`) reads as `undefined`, and a key
  // `__proto__` is an own property. It is built as an ordinary object whose
  // prototype is then removed: `Object.create(null)` gives V8 an object in
  // dictionary mode, where each `_.x` read of the compiled body is a hash
  // lookup (about 2 ns per cell, measured 2026-10-24, ROADMAP CE-410), and an
  // ordinary object keeps its fast properties when its prototype is set to
  // `null`.
  const vars: Record<string, unknown> = Object.setPrototypeOf({}, null);
  // The shared inputs are bound once; the cell loop below never writes them.
  for (const s of shape.shared) vars[s.name] = plainOf(s);
  shape.names.forEach((name, k) => {
    vars[name] = complexSlots[k] ?? shape.scalars[k];
  });
  const loop = cellLoopFor(call, shape, complexSlots, stride);
  if (loop !== undefined)
    return loop(
      vars,
      arrays,
      complexSlots,
      out,
      from,
      to,
      deadline,
      stop,
      shape.grid,
      undefined,
      failures
    );
  for (let i = from; i < to; i++) {
    // Checked at the first cell too, so that a slice that starts after the
    // deadline (one queued behind another) computes nothing.
    if (
      deadline !== undefined &&
      (i - from) % DEADLINE_CHECK_EVERY === 0 &&
      Date.now() > deadline
    )
      return i - from;
    if (stop !== undefined && (i - from) % STOP_CHECK_EVERY === 0 && stop())
      return i - from;
    for (let k = 0; k < shape.names.length; k++) {
      const a = arrays[k];
      if (a === null && !shape.indexes[k]) continue;
      const v = a === null ? axisIndex(shape, k, i) : a[axisIndex(shape, k, i)];
      const slot = complexSlots[k];
      if (slot !== null) slot.re = v;
      else vars[shape.names[k]] = v;
    }
    if (stride === 1) {
      try {
        out[i - from] = numberOf(call(vars));
      } catch {
        out[i - from] = NaN;
        if (failures !== undefined) failures.count++;
      }
      continue;
    }
    const o = stride * (i - from);
    let r: unknown;
    try {
      r = call(vars);
    } catch {
      r = undefined;
      if (failures !== undefined) failures.count++;
    }
    if (Array.isArray(r)) {
      for (let k = 0; k < stride; k++)
        out[o + k] = k < r.length ? numberOf(r[k]) : NaN;
    } else out.fill(NaN, o, o + stride);
  }
  return to - from;
}

interface Bounds {
  lo: number;
  hi: number;
}

function isBounds(v: unknown): v is Bounds {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Bounds).lo === 'number' &&
    typeof (v as Bounds).hi === 'number'
  );
}

/**
 * Write one cell's `IntervalResult` (or the raw answer of a compiled interval
 * body) at offset `o` of `out`, as the `INTERVAL_KIND` encoding describes.
 * Mirrors the wrapping `run()` applies (`freshIntervalValue` in the interval
 * target): a bare enclosure is an `interval`, and an enclosure whose lower
 * bound is NaN is the target's absent marker, reported as `empty`.
 */
export function encodeIntervalResult(
  r: unknown,
  out: Float64Array,
  o: number
): void {
  out[o] = NaN;
  out[o + 1] = NaN;
  if (typeof r === 'string') {
    out[o + 2] =
      r === 'true'
        ? INTERVAL_KIND.boolTrue
        : r === 'false'
          ? INTERVAL_KIND.boolFalse
          : r === 'maybe'
            ? INTERVAL_KIND.boolMaybe
            : INTERVAL_KIND.error;
    return;
  }
  if (typeof r === 'boolean') {
    out[o + 2] = r ? INTERVAL_KIND.boolTrue : INTERVAL_KIND.boolFalse;
    return;
  }
  if (typeof r !== 'object' || r === null) {
    out[o + 2] = INTERVAL_KIND.error;
    return;
  }
  const rec = r as { kind?: unknown; value?: unknown };
  const writeBounds = (b: Bounds, kind: IntervalKindCode): void => {
    if (Number.isNaN(b.lo)) {
      out[o + 2] = INTERVAL_KIND.empty;
      return;
    }
    if (Number.isNaN(b.hi) || b.lo > b.hi) {
      out[o + 2] = INTERVAL_KIND.error;
      return;
    }
    out[o] = b.lo;
    out[o + 1] = b.hi;
    out[o + 2] = kind;
  };
  if (!('kind' in rec)) {
    if (isBounds(rec)) writeBounds(rec, INTERVAL_KIND.interval);
    else out[o + 2] = INTERVAL_KIND.error;
    return;
  }
  switch (rec.kind) {
    case 'interval':
      if (isBounds(rec.value)) writeBounds(rec.value, INTERVAL_KIND.interval);
      else out[o + 2] = INTERVAL_KIND.error;
      return;
    case 'partial':
      if (isBounds(rec.value)) writeBounds(rec.value, INTERVAL_KIND.partial);
      else out[o + 2] = INTERVAL_KIND.error;
      return;
    case 'singular': {
      // The absent-marker rule of `writeBounds` (a NaN lower bound is
      // `empty`) is what `run()` applies to `interval` and `partial` only; a
      // singular result with no usable enclosure stays singular, as a pole.
      const v = rec.value;
      if (
        isBounds(v) &&
        !Number.isNaN(v.lo) &&
        !Number.isNaN(v.hi) &&
        v.lo <= v.hi
      )
        writeBounds(v, INTERVAL_KIND.singularJump);
      else out[o + 2] = INTERVAL_KIND.singularPole;
      return;
    }
    case 'empty':
      out[o + 2] = INTERVAL_KIND.empty;
      return;
    case 'entire':
      out[o + 2] = INTERVAL_KIND.entire;
      return;
    default:
      out[o + 2] = INTERVAL_KIND.error;
  }
}

/**
 * Evaluate a compiled `interval-js` body over a batch. `call` runs the body
 * on a vars object of `{ lo, hi }` enclosures (the raw call of
 * `ComputeEngineIntervalFunction`); the loop reuses one enclosure object per
 * variable and copies each answer out before the next cell overwrites it.
 */
export function broadcastIntervals(
  call: (vars: Record<string, Bounds>) => unknown,
  inputs: BroadcastInputs,
  options?: BroadcastOptions
): Float64Array {
  const shape = readShape(inputs, options, 2);
  const out = outputArray(options?.out, 3 * shape.count);
  broadcastIntervalsRange(call, shape, out, 0, shape.count);
  return out;
}

/** The slice form of `broadcastIntervals`; see `broadcastNumbersSlice`. The
 * slice's cells are written at the start of `out`, three values each. */
export function broadcastIntervalsSlice(
  call: (vars: Record<string, Bounds>) => unknown,
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  out: Float64Array,
  slice: BroadcastSlice
): number {
  const shape = readShape(inputs, options, 2);
  return broadcastIntervalsRange(
    call,
    shape,
    out,
    slice.from,
    slice.to,
    slice.deadline,
    slice.stop,
    slice.failures
  );
}

function broadcastIntervalsRange(
  call: (vars: Record<string, Bounds>) => unknown,
  shape: BroadcastShape,
  out: Float64Array,
  from: number,
  to: number,
  deadline?: number,
  stop?: () => boolean,
  failures?: { count: number }
): number {
  if (out.length < 3 * (to - from))
    throw new TypeError(
      `broadcast: the output array holds ${out.length} values, ${3 * (to - from)} are needed`
    );
  const vars: Record<string, Bounds> = Object.create(null);
  const slots: Bounds[] = shape.names.map((name, k) => {
    const s = shape.scalars[k];
    const slot = { lo: s, hi: s };
    vars[name] = slot;
    return slot;
  });
  const arrays = unaliasedInputs(shape.arrays, out);
  for (let i = from; i < to; i++) {
    // Checked at the first cell too, so that a slice that starts after the
    // deadline (one queued behind another) computes nothing.
    if (
      deadline !== undefined &&
      (i - from) % DEADLINE_CHECK_EVERY === 0 &&
      Date.now() > deadline
    )
      return i - from;
    if (stop !== undefined && (i - from) % STOP_CHECK_EVERY === 0 && stop())
      return i - from;
    for (let k = 0; k < shape.names.length; k++) {
      const a = arrays[k];
      if (a === null) {
        if (!shape.indexes[k]) continue;
        const j = axisIndex(shape, k, i);
        slots[k].lo = j;
        slots[k].hi = j;
        continue;
      }
      const j = 2 * axisIndex(shape, k, i);
      slots[k].lo = a[j];
      slots[k].hi = a[j + 1];
    }
    const o = 3 * (i - from);
    try {
      encodeIntervalResult(call(vars), out, o);
    } catch {
      out[o] = NaN;
      out[o + 1] = NaN;
      out[o + 2] = INTERVAL_KIND.error;
      if (failures !== undefined) failures.count++;
    }
  }
  return to - from;
}
