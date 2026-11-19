/**
 * The compilation of `compile()` for the `interval-js` target, with or
 * without the option `profile: 'ir'`: the result of the interval target from
 * the slice compiler in the interval mode (`print-interval.ts`). Anything
 * else declines with `'outside-profile'`; `compile()` then applies
 * `fallback` (the interpreter, `interval-fallback.ts`). See "The interval
 * mode" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { Type } from '../../../common/type/types.js';
import { provablyDisjoint } from '../../../common/type/subtype.js';
import { SIGNED_INFINITY_TYPE } from '../../../common/type/primitive.js';
import { withoutKindArms } from '../../../common/type/utils.js';
import {
  hasEnclosureArm,
  isEnclosureEntry,
} from '../../library/enclosure-compile.js';
import { kindEntryError } from '../javascript-runtime.js';
import { visitIntervalInputCells } from '../broadcast.js';
import type {
  BroadcastInputs,
  BroadcastOptions,
  CompilationResult,
  IntervalValue,
} from '../types.js';
import { INTERVAL_RUNTIME_VERSION } from '../../../common/runtime-versions.js';
import {
  isShippableCode,
  makeBroadcastAsync,
  makeWillUsePool,
  type BroadcastAsyncSpec,
} from '../../kernel-pool.js';
import { createIntervalRuntime } from '../interval-runtime.js';
import { readsVarsObject } from '../vars-inputs.js';
import { withIntegralClosedFormBudgets } from '../interval-quadrature.js';
import { declaredTypeText, isBooleanBindingType } from '../type-facts.js';
import { compileSlice } from './index.js';
import { entryOf } from './ir.js';
import {
  decline,
  entryInputs,
  hostReads,
  inputReport,
  optionDecline,
  runnerLowered,
  sliceError,
  sliceOptions,
  IR_OPTIONS,
  type IrOptions,
} from './adapter.js';

/** The class of each option of `compile()` on `interval-js`, as
 *  `IR_OPTIONS`: `mapped`, `no-op`, or `declined` when given
 *  (`optionDecline()`; a `mode` other than `'strict'`). An option added to
 *  `IR_OPTIONS` takes its JavaScript class here, with no type error. */
const IR_INTERVAL_OPTIONS = {
  ...IR_OPTIONS,
  entryChecks: 'no-op',
  mode: 'declined',
  quadrature: 'no-op',
} as const satisfies Record<
  keyof typeof IR_OPTIONS,
  'mapped' | 'no-op' | 'declined'
>;

/** The run-time check of the host value of an input whose type has an
 *  `enclosure` arm: `value` for `run()`, `cell` for a cell `[lo, hi]` of
 *  `broadcast()`. */
type KindEntry = {
  readonly name: string;
  readonly label: string;
  readonly value: (v: unknown) => boolean;
  readonly cell: (lo: number, hi: number) => boolean;
};

/**
 * The checks of the inputs `names` of the engine types `types` that have an
 * `enclosure` arm (`docs/plans/2026-10-26-value-kinds.md`, section 4.9.2,
 * "Compilation"). An input typed `enclosure` admits what the `entry` of the
 * kind admits: a record `{ lo, hi }` with `lo <= hi`, not the same infinity
 * twice and no `NaN`, or a finite number. A union (`number | enclosure`,
 * `enclosure | nan`) is checked by arm: a record by the `entry` of the kind,
 * a number by the numeric arms (`NaN` admitted when an arm admits `nan` or
 * `missing`, `±Infinity` when an arm admits an infinity). A cell of
 * `broadcast()` whose two bounds are the same value (`NaN` and `±Infinity`
 * included) is read as that number when the type has a numeric arm.
 */
function kindEntries(
  names: readonly string[],
  typeOf: (name: string) => Type | undefined
): KindEntry[] {
  const entries: KindEntry[] = [];
  for (const name of names) {
    const t = typeOf(name);
    if (t === undefined || !hasEnclosureArm(t)) continue;
    const rest = withoutKindArms(t, { has: (k) => k === 'enclosure' });
    const numeric = rest !== 'never';
    const admitsNaN =
      numeric &&
      (!provablyDisjoint(rest, 'nan') || !provablyDisjoint(rest, 'missing'));
    const admitsInfinity =
      numeric && !provablyDisjoint(rest, SIGNED_INFINITY_TYPE);
    const asNumber = (v: number): boolean =>
      Number.isFinite(v) || (Number.isNaN(v) ? admitsNaN : admitsInfinity);
    entries.push({
      name,
      label: `"${name}" (type \`${declaredTypeText(t)}\`)`,
      value: (v) => (typeof v === 'number' ? asNumber(v) : isEnclosureEntry(v)),
      cell: (lo, hi) =>
        numeric && (lo === hi || (Number.isNaN(lo) && Number.isNaN(hi)))
          ? asNumber(lo)
          : isEnclosureEntry({ lo, hi }),
    });
  }
  return entries;
}

/** Throw when a value of the inputs object `vars` is refused by its
 *  check; an input not given is refused. */
function checkKindInputs(entries: readonly KindEntry[], vars: unknown): void {
  for (const entry of entries) {
    const v =
      vars !== null &&
      typeof vars === 'object' &&
      Object.prototype.hasOwnProperty.call(vars, entry.name)
        ? (vars as Record<string, unknown>)[entry.name]
        : undefined;
    if (!entry.value(v)) throw kindEntryError(entry.label);
  }
}

/** Throw when a cell of a batch is refused by its check, or when an input
 *  that has a check is not given. Called before the loop. */
function checkKindCells(
  entries: readonly KindEntry[],
  inputs: BroadcastInputs,
  options: BroadcastOptions | undefined,
  booleans: readonly string[],
  lists: readonly string[]
): void {
  const byName = new Map(entries.map((e) => [e.name, e]));
  const names = visitIntervalInputCells(
    inputs,
    options,
    (name, lo, hi) => {
      const entry = byName.get(name);
      if (entry !== undefined && !entry.cell(lo, hi))
        throw kindEntryError(entry.label);
    },
    booleans,
    // A boolean for an input of a kind type is refused, as `run()` refuses
    // it.
    (name, value) => {
      const entry = byName.get(name);
      if (entry !== undefined && !entry.value(value))
        throw kindEntryError(entry.label);
    },
    lists
  );
  for (const entry of entries)
    if (!names.includes(entry.name)) throw kindEntryError(entry.label);
}

/** The closed forms of the integrals take the antiderivative budget of the
 *  outermost compilation in progress. */
export function compileWithIrProfileInterval(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'interval-js', IntervalValue> {
  return withIntegralClosedFormBudgets(() => compileInterval(expr, options));
}

function compileInterval(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'interval-js', IntervalValue> {
  try {
    optionDecline(options, IR_INTERVAL_OPTIONS, ' on interval-js');
    // `vars`: a read of the inputs object only. The mode evaluates both
    // arms of an undecided condition, where another text would run where
    // the interpreter does not run it.
    const vars: Record<string, string> = Object.create(null);
    for (const [name, text] of Object.entries(options?.vars ?? {})) {
      if (typeof text !== 'string' || !readsVarsObject(text))
        throw decline(
          `the vars entry of ${name}, which is not a read of the inputs object, on interval-js`,
          { binding: name }
        );
      vars[name] = text;
    }
    const s = compileSlice(expr, {
      target: 'javascript',
      mode: 'interval',
      ...sliceOptions(options),
      iterationBudget: options?.iterationBudget,
      vars,
    });
    const p = s.program;
    const entry = entryOf(p);
    const positional = entry.positional ?? 0;
    const literal = entry.literal === true;
    const inputs = entryInputs(p, options);
    // A scalar boolean input; a list of booleans is a list input.
    const booleans = inputs.filter((_, k) => {
      const t = p.types[entry.body.params[k + positional]];
      return t.lane === 'boolean' && t.shape.length === 0;
    });
    // A name of `vars` is a read of the inputs object, not an entry
    // parameter: it is a boolean input when it is declared boolean, as in
    // the interpreter fallback (`declaredBooleanNames()`,
    // `interval-fallback.ts`).
    for (const name of expr.unknowns)
      if (
        name in vars &&
        !booleans.includes(name) &&
        isBooleanBindingType(expr.engine.symbol(name).type?.type)
      )
        booleans.push(name);
    // The inputs of a list or tuple type: the shared inputs of a batch.
    const lists = [
      ...new Set(
        inputs.filter(
          (_, k) => p.types[entry.body.params[k + positional]].shape.length > 0
        )
      ),
    ];
    // The inputs and the names of `vars` that the code reads, also through
    // a call (`inputReport()`).
    const reads = hostReads(p, Object.keys(vars));
    const report = inputReport(
      p,
      [...inputs, ...reads.keys()],
      runnerLowered(p, reads, true)
    );
    const once = s.preambleOnce;
    const perCall = s.preamblePerCall;
    // A program that reads or makes an enclosure (`lower-enclosure.ts`): the
    // checks of its inputs of the kind are functions of this host, so the
    // result is not shippable, the pool is not used, and a stored copy
    // cannot be loaded (`valueKinds`); `run()` and the batches apply the
    // checks before they load a copy without `valueKinds`.
    const kinds = p.valueKinds;
    const entries =
      kinds === undefined
        ? []
        : kindEntries(
            [...inputs, ...reads.keys()],
            (name) => p.inputs?.get(name)?.type
          );
    const shippable =
      kinds === undefined &&
      isShippableCode(`${once}\n${perCall ?? ''}\n${s.code}`);
    const result: CompilationResult<'interval-js', IntervalValue> = {
      target: 'interval-js',
      success: true,
      runtimeVersion: INTERVAL_RUNTIME_VERSION,
      code: s.code,
      // `preamble` is the two, also when one is empty: the reset of the
      // count of `Loop` passes is per call with no value computed once.
      ...(once === '' && perCall === undefined
        ? {}
        : {
            preamble: [once, perCall ?? ''].filter((t) => t !== '').join('\n'),
            preambleOnce: once,
          }),
      ...(perCall === undefined ? {} : { preamblePerCall: perCall }),
      calling: s.calling,
      ...(kinds !== undefined ? { valueKinds: [...kinds] } : {}),
      ...(booleans.length > 0 ? { booleanInputs: booleans } : {}),
      ...(lists.length > 0 ? { listInputs: lists } : {}),
      run: (entries.length === 0
        ? s.run
        : (vars: unknown) => {
            checkKindInputs(entries, vars);
            return s.run(vars);
          }) as CompilationResult<'interval-js', IntervalValue>['run'],
      freeSymbols: report.freeSymbols,
      freeSymbolTypes: report.freeSymbolTypes,
      unsupported: [],
      mode: 'strict',
      profile: 'ir',
    };
    if (literal) return result;
    // The batch members, built by `createIntervalRuntime()` over the stored
    // result at their first call, so each cell is the value of `run()`.
    const runtime = createIntervalRuntime();
    let batch: ReturnType<typeof runtime.loadBroadcast> | undefined;
    let slice: ReturnType<typeof runtime.loadBroadcastSlice> | undefined;
    const stored = { ...result, valueKinds: undefined };
    const check = (cells: BroadcastInputs, o?: BroadcastOptions) => {
      if (entries.length > 0)
        checkKindCells(entries, cells, o, booleans, lists);
    };
    result.broadcast = (cells, o) => {
      check(cells, o);
      return (batch ??= runtime.loadBroadcast(stored))(cells, o);
    };
    const engine = expr.engine;
    const spec: BroadcastAsyncSpec = {
      kind: 'interval-js',
      stored: result,
      shippable,
      iterationLimit: () => engine.iterationLimit,
      lists,
      booleans,
      slice: (cells, o, out, range) =>
        (slice ??= runtime.loadBroadcastSlice(stored))(cells, o, out, range),
      workers: () => engine.workers,
    };
    const broadcastAsync = makeBroadcastAsync(spec);
    // A cell that a check refuses rejects the promise before any slice runs.
    result.broadcastAsync =
      entries.length === 0
        ? broadcastAsync
        : async (cells, o) => {
            check(cells, o);
            return broadcastAsync(cells, o);
          };
    result.shippable = shippable;
    result.willUsePool =
      kinds === undefined ? makeWillUsePool(spec) : () => false;
    return result;
  } catch (e) {
    throw sliceError(e);
  }
}
