/**
 * The profile `'ir'` of `compile()` for the `interval-js` target
 * (experimental): the result of the existing interval target from the slice
 * compiler in the interval mode (`print-interval.ts`). Anything else
 * declines with `'outside-profile'`; `compile()` then applies `fallback`
 * (the existing interval target). See "The interval mode" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult, IntervalValue } from '../types.js';
import { INTERVAL_RUNTIME_VERSION } from '../../../common/runtime-versions.js';
import {
  isShippableCode,
  makeBroadcastAsync,
  makeWillUsePool,
  type BroadcastAsyncSpec,
} from '../../kernel-pool.js';
import { createIntervalRuntime } from '../interval-runtime.js';
import { readsVarsObject } from '../vars-inputs.js';
import { resetIntervalClosedFormBudgets } from '../interval-quadrature.js';
import { isBooleanBindingType } from '../compiler-type-facts.js';
import { compileSlice } from './index.js';
import { entryOf } from './ir.js';
import {
  decline,
  entryInputs,
  optionDecline,
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

export function compileWithIrProfileInterval(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'interval-js', IntervalValue> {
  // A fresh antiderivative budget for the closed forms of the integrals.
  resetIntervalClosedFormBudgets();
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
    // the existing target (`declaredBooleanNames()`).
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
    const once = s.preambleOnce;
    const perCall = s.preamblePerCall;
    const shippable = isShippableCode(`${once}\n${perCall ?? ''}\n${s.code}`);
    const result: CompilationResult<'interval-js', IntervalValue> = {
      target: 'interval-js',
      success: true,
      runtimeVersion: INTERVAL_RUNTIME_VERSION,
      code: s.code,
      ...(once === ''
        ? {}
        : {
            preamble: perCall === undefined ? once : `${once}\n${perCall}`,
            preambleOnce: once,
          }),
      ...(perCall === undefined ? {} : { preamblePerCall: perCall }),
      calling: s.calling,
      ...(booleans.length > 0 ? { booleanInputs: booleans } : {}),
      ...(lists.length > 0 ? { listInputs: lists } : {}),
      run: s.run as CompilationResult<'interval-js', IntervalValue>['run'],
      profile: 'ir',
    };
    if (literal) return result;
    // The batch members, built by `createIntervalRuntime()` over the stored
    // result at their first call, so each cell is the value of `run()`.
    const runtime = createIntervalRuntime();
    let batch: ReturnType<typeof runtime.loadBroadcast> | undefined;
    let slice: ReturnType<typeof runtime.loadBroadcastSlice> | undefined;
    result.broadcast = (cells, o) =>
      (batch ??= runtime.loadBroadcast(result))(cells, o);
    const engine = expr.engine;
    const spec: BroadcastAsyncSpec = {
      kind: 'interval-js',
      stored: result,
      shippable,
      iterationLimit: () => engine.iterationLimit,
      lists,
      booleans,
      slice: (cells, o, out, range) =>
        (slice ??= runtime.loadBroadcastSlice(result))(cells, o, out, range),
      workers: () => engine.workers,
    };
    result.broadcastAsync = makeBroadcastAsync(spec);
    result.shippable = shippable;
    result.willUsePool = makeWillUsePool(spec);
    return result;
  } catch (e) {
    throw sliceError(e);
  }
}
