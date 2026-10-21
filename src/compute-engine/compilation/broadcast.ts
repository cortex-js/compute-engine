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
 * **Shared inputs** (`javascript` only). A variable that the compiled code
 * reads as a list (the `lists` of the entry plan, from a declared list type),
 * or that `options.shared` names, is bound once for the whole batch: the code
 * reads it by index (`F_{i+1}` with `i` the per-cell variable). Its value is
 * a plain array of numbers or a `Float64Array`. It is not a column of the
 * `cells` layout and not an axis of the `grid` layout. The compiled code reads
 * plain arrays only (its `at` helper gives `NaN` for a typed array), so a
 * `Float64Array` is copied into a plain array once, before the cell loop. A
 * plain array for any other variable throws.
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

import type { BroadcastInputs, BroadcastOptions } from './types.js';

export type { BroadcastInputs, BroadcastOptions } from './types.js';

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
  /** The array of each name, or `null` for a scalar. */
  arrays: (Float64Array | null)[];
  /** The scalar of each name (`NaN` for an array). */
  scalars: number[];
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
  const names: string[] = [];
  const arrays: (Float64Array | null)[] = [];
  const scalars: number[] = [];
  const shared: BroadcastShape['shared'] = [];
  for (const name of Object.keys(inputs)) {
    const v = inputs[name];
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
    } else if (v instanceof Float64Array) {
      if (v.length % perCell !== 0)
        throw new TypeError(
          `broadcast: the array for "${name}" must hold ${perCell === 2 ? 'lo, hi pairs' : 'one value per cell'} (its length is ${v.length})`
        );
      names.push(name);
      arrays.push(v);
      scalars.push(NaN);
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
  const layout = options?.layout ?? 'cells';
  if (layout === 'grid') {
    const grid: { stride: number; length: number }[] = [];
    let stride = 1;
    for (const a of arrays) {
      if (a === null) {
        grid.push({ stride: 0, length: 1 });
        continue;
      }
      const length = a.length / perCell;
      grid.push({ stride, length });
      stride *= length;
    }
    return { names, arrays, scalars, count: stride, grid, shared };
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
 */
export function broadcastNumbers(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  inputs: BroadcastInputs,
  options?: BroadcastOptions,
  defaultOutputs?: number
): Float64Array {
  const shape = readShape(inputs, options, 1, listsOf(entry));
  const stride = broadcastStride(options, defaultOutputs);
  const out = outputArray(options?.out, stride * shape.count);
  broadcastNumbersRange(call, entry, shape, out, 0, shape.count, stride);
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
}

/** Cells between two deadline checks. */
const DEADLINE_CHECK_EVERY = 1024;

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
 * written: `to - from`, or fewer when `deadline` passed first. This is the
 * loop a worker thread runs for one task. A caller that runs several slices
 * of one batch passes its `Float64Array` shared inputs already copied into
 * plain arrays (`plainSharedArray`), so that the copy is made once per batch
 * instead of once per slice.
 */
export function broadcastNumbersSlice(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  out: Float64Array,
  slice: BroadcastSlice,
  defaultOutputs?: number
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
    slice.deadline
  );
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

function broadcastNumbersRange(
  call: (vars: Record<string, unknown>) => unknown,
  entry: BroadcastEntryPlan | undefined,
  shape: BroadcastShape,
  out: Float64Array,
  from: number,
  to: number,
  stride: number,
  deadline?: number
): number {
  if (out.length < stride * (to - from))
    throw new TypeError(
      `broadcast: the output array holds ${out.length} values, ${stride * (to - from)} are needed`
    );
  const vars: Record<string, unknown> = Object.create(null);
  // The shared inputs are bound once; the cell loop below never writes them.
  for (const { name, value } of shape.shared)
    vars[name] = plainSharedArray(value);
  const complexSlots: ({ re: number; im: number } | null)[] = [];
  const complexNames =
    entry?.kind === 'vars' ? new Set(entry.complex) : new Set<string>();
  shape.names.forEach((name, k) => {
    if (complexNames.has(name)) {
      const slot = { re: shape.scalars[k], im: 0 };
      complexSlots.push(slot);
      vars[name] = slot;
    } else {
      complexSlots.push(null);
      vars[name] = shape.scalars[k];
    }
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
    for (let k = 0; k < shape.names.length; k++) {
      const a = arrays[k];
      if (a === null) continue;
      const v = a[axisIndex(shape, k, i)];
      const slot = complexSlots[k];
      if (slot !== null) slot.re = v;
      else vars[shape.names[k]] = v;
    }
    if (stride === 1) {
      try {
        out[i - from] = numberOf(call(vars));
      } catch {
        out[i - from] = NaN;
      }
      continue;
    }
    const o = stride * (i - from);
    let r: unknown;
    try {
      r = call(vars);
    } catch {
      r = undefined;
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
    slice.deadline
  );
}

function broadcastIntervalsRange(
  call: (vars: Record<string, Bounds>) => unknown,
  shape: BroadcastShape,
  out: Float64Array,
  from: number,
  to: number,
  deadline?: number
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
    for (let k = 0; k < shape.names.length; k++) {
      const a = arrays[k];
      if (a === null) continue;
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
    }
  }
  return to - from;
}
