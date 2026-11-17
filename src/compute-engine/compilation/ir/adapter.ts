/**
 * The profile `'ir'` of `compile()` (experimental): the glue between the
 * options and the result of the public `compile()` and the slice compiler
 * of this directory (`compileSlice()`), for the `javascript` target.
 *
 * Every option of `compile()` is mapped or declined by name
 * (`optionDecline()`); an input with no type is the decline
 * `'untyped-input'` of the existing compiler, another `Decline` of the
 * slice the public decline `'outside-profile'`, any other error a
 * `'compile-error'`, and a cancellation is thrown as it is. `compile()`
 * applies `fallback` to every decline. See "Selecting the pipeline" in
 * `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult, CompileDiagnostic } from '../types.js';
import {
  bigintBroadcastError,
  checkEntry,
  normalizeRunResult,
  setReconstructionDigits,
  storeEntryPlan,
  type EntryPlan,
} from '../javascript-runtime.js';
import { CompileDeclineError, throwUntypedInputs } from '../diagnostics.js';
import { RUNTIME_VERSION } from '../../../common/runtime-versions.js';
import {
  isShippableCode,
  makeBroadcastAsync,
  makeWillUsePool,
  type BroadcastAsyncSpec,
} from '../../kernel-pool.js';
import { broadcastNumbers, broadcastNumbersSlice } from '../broadcast.js';
import {
  makeRunAsync,
  makeWillParallelize,
  type RunAsyncSpec,
} from '../run-async.js';
import { broadcastStrideOfType } from '../type-facts.js';
import { readsVarsObject } from '../vars-inputs.js';
import { withIntegralClosedFormBudgets } from '../interval-quadrature.js';
import { realPowerReconstructionDigits } from '../../numerics/real-power.js';
import { ALL_PASSES } from './passes.js';
import { Decline, UntypedInputs } from './lower-context.js';
import { compileSlice, type Extension, type Warning } from './index.js';
import type { JavaScriptResult } from './print-js.js';
import { argumentIndex, entryOf, type Program } from './ir.js';

const PREFIX = "Could not compile with the profile 'ir'";

/**
 * The class of each option of `compile()` in the profile: `mapped` (read
 * by the adapter or by `compile()`), `no-op` (admitted with no effect:
 * `storage` is ignored on the JavaScript target by contract,
 * `CompilationOptions.storage`), or `declined` (declined by
 * name when given, `refusal()`). `compile-expression.ts` checks that every
 * option of `CompileExpressionOptions` has a class here.
 */
export const IR_OPTIONS = {
  to: 'mapped',
  target: 'mapped',
  profile: 'mapped',
  fallback: 'mapped',
  entryChecks: 'mapped',
  iterationBudget: 'mapped',
  symbolDeps: 'mapped',
  varsObjectRefs: 'mapped',
  cse: 'mapped',
  constantFold: 'mapped',
  mode: 'mapped',
  storage: 'no-op',
  quadrature: 'mapped',
  functions: 'declined',
  vars: 'mapped',
  symbolic: 'mapped',
  inputs: 'mapped',
  operators: 'declined',
  imports: 'declined',
  preamble: 'declined',
  broadcast: 'no-op',
  strictTypes: 'declined',
} as const;

type IrOptionName = keyof typeof IR_OPTIONS;

/** The options of `compile()`, by the names of `IR_OPTIONS`
 *  (`compile-expression.ts` imports this file, so its type is not imported
 *  here). */
export type IrOptions = { readonly [K in IrOptionName]?: unknown } & {
  readonly cse?: boolean;
  readonly constantFold?: boolean;
  readonly entryChecks?: boolean;
  readonly iterationBudget?: number;
  readonly mode?: string;
  readonly symbolDeps?: Set<string>;
  readonly varsObjectRefs?: Set<string>;
  readonly vars?: Readonly<Record<string, unknown>>;
};

/** Rows and spellings that a test adds to the compilations of the profile
 *  that `f` makes (an internal error is made with a spelling that does not
 *  parse). Not an option of `compile()`.
 *  @internal */
let testExtension: Extension | undefined;

/** @internal */
export function _withIrProfileTestExtension<T>(x: Extension, f: () => T): T {
  const previous = testExtension;
  testExtension = x;
  try {
    return f();
  } finally {
    testExtension = previous;
  }
}

/** The options of `compileSlice()` that every target reads of those of
 *  `compile()`: the passes, the folds and the extension of
 *  `_withIrProfileTestExtension()`. */
export const sliceOptions = (options: IrOptions | undefined) => ({
  passes: {
    ...ALL_PASSES,
    cse: options?.cse !== false,
    fold: options?.constantFold !== false,
  },
  constantFold: options?.constantFold !== false,
  extend: testExtension,
});

/** Whether `x` is an option given with content: an object with a key, an
 *  array with an element, a string that is not blank, a function. */
function given(x: unknown): boolean {
  if (x === undefined || x === null) return false;
  if (typeof x === 'string') return x.trim() !== '';
  if (typeof x === 'function') return true;
  if (Array.isArray(x)) return x.length > 0;
  return typeof x === 'object' && Object.keys(x).length > 0;
}

/** The text of the decline of the option `name` of the class `declined`
 *  with the value `value`, or `undefined` when the value is admitted. */
function refusal(name: IrOptionName, value: unknown): string | undefined {
  switch (name) {
    case 'strictTypes':
    case 'broadcast':
      return value === true ? `the option \`${name}\`` : undefined;
    case 'mode':
      return value !== undefined && value !== 'strict'
        ? `the option \`mode\` with the value '${String(value)}'`
        : undefined;
    default:
      return given(value) ? `the option \`${name}\`` : undefined;
  }
}

/** The decline of the first option of `options` that the profile does not
 *  have on the target `where` (`''` or ` on <target>`), by the classes of
 *  `table`. */
export function optionDecline(
  options: IrOptions | undefined,
  table: Readonly<Record<IrOptionName, string>>,
  where: string
): void {
  if (options === undefined) return;
  for (const name of Object.keys(table) as IrOptionName[]) {
    if (table[name] !== 'declined') continue;
    const text = refusal(name, options[name]);
    if (text !== undefined)
      throw decline(`${text} is not supported by the profile 'ir'${where}`);
  }
}

export function decline(
  message: string,
  extra: Partial<CompileDiagnostic> = {}
) {
  return new CompileDeclineError({
    code: 'outside-profile',
    kind: 'capability',
    message: `${PREFIX}: ${message}`,
    ...extra,
  });
}

/** The user functions compiled in `p` and the names whose engine value the
 *  code holds as a literal (`CompilationOptions.symbolDeps`). */
export function addSymbolDeps(p: Program, deps: Set<string> | undefined) {
  for (const f of p.functions) if (f.source !== undefined) deps?.add(f.source);
  for (const name of p.captures ?? []) deps?.add(name);
}

/** The inputs of the inputs object of the entry of `p` (the parameters
 *  after the positional ones, at the indices that `keep` keeps), added to
 *  `varsObjectRefs` also when the compilation declines here; then the
 *  symbol deps (`addSymbolDeps()`). */
export function entryInputs(
  p: Program,
  options: IrOptions | undefined,
  keep: (k: number) => boolean = () => true
): string[] {
  const entry = entryOf(p);
  const positional = entry.positional ?? 0;
  const inputs = entry.paramNames.filter((_, k) => k >= positional && keep(k));
  for (const name of inputs) options?.varsObjectRefs?.add(name);
  // The engine calls a compiled `Function` literal with its arguments only
  // (`implicitCompile()`): it has no object for the free names of the body.
  if (entry.literal === true && inputs.length > 0)
    throw decline(
      `a Function literal that reads the free name \`${inputs[0]}\`: its code is called with its arguments only`,
      { binding: inputs[0] }
    );
  addSymbolDeps(p, options?.symbolDeps);
  return inputs;
}

/** The error of `compile()` for the error `e` of the slice or the adapter:
 *  a cancellation or a decline of `compile()` as it is, an input with no
 *  type thrown as the existing compiler refuses it (`'untyped-input'`), a
 *  `Decline` as `'outside-profile'`, any other error as `'compile-error'`. */
export function sliceError(e: unknown): unknown {
  if ((e as Error | undefined)?.name === 'CancellationError') return e;
  if (e instanceof CompileDeclineError) return e;
  if (e instanceof UntypedInputs) throwUntypedInputs(e.names);
  if (e instanceof Decline)
    return decline(e.message, {
      ...(e.head === undefined ? {} : { operator: e.head }),
      value: e.node,
    });
  // A stack overflow of a walk of the pipeline: a program too deep for it.
  if (e instanceof RangeError && /call stack/.test(e.message))
    return decline('an expression too deep to compile');
  const message = e instanceof Error ? e.message : String(e);
  return new CompileDeclineError({
    code: 'compile-error',
    kind: 'capability',
    message: `${PREFIX}: internal error: ${message}`,
  });
}

/**
 * The compilation of `expr` with the profile `'ir'`: a successful result,
 * or a throw of a `CompileDeclineError` (`'outside-profile'` for a decline,
 * `'compile-error'` for an internal error of the slice), or of a
 * cancellation. The closed forms of its integrals take the antiderivative
 * budget of the outermost compilation in progress.
 */
export function compileWithIrProfile(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'javascript'> {
  return withIntegralClosedFormBudgets(() => compileIr(expr, options));
}

function compileIr(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'javascript'> {
  // `compile()` refuses a mode other than these three.
  const mode = (options?.mode ?? 'strict') as 'strict' | 'complex' | 'bigint';
  const refused =
    mode === 'bigint' && Object.keys(options?.vars ?? {}).length > 0
      ? "the option `vars` in the mode 'bigint'"
      : options?.quadrature === 'monte-carlo'
        ? "the option `quadrature` with the value 'monte-carlo'"
        : undefined;
  if (refused !== undefined)
    throw decline(`${refused} is not supported by the profile 'ir'`);
  optionDecline(options, IR_OPTIONS, '');
  // `vars`: a name read as the host's text (`compile()` checks that each
  // entry is a string).
  // No prototype: an entry named `__proto__` is an entry.
  const vars: Record<string, string> = Object.create(null);
  for (const [name, text] of Object.entries(options?.vars ?? {})) {
    if (typeof text !== 'string' || text.trim() === '' || /\$#?\d/.test(text))
      throw decline(`the vars entry of ${name} is not a source text`);
    vars[name] = text;
  }
  // The code reads the exponent of a negative base to the digits of the
  // engine when it is compiled: in the folds and the constants computed
  // while compiling, in each call of `run()`, and in a loaded copy
  // (`load()`), so that the three agree.
  const reconstructionDigits = realPowerReconstructionDigits(
    expr.engine.precision
  );
  const inDigits = <T>(g: () => T): T => {
    const previous = setReconstructionDigits(reconstructionDigits);
    try {
      return g();
    } finally {
      setReconstructionDigits(previous);
    }
  };
  let slice: JavaScriptResult & { warnings: Warning[]; program: Program };
  try {
    slice = inDigits(() =>
      compileSlice(expr, {
        target: 'javascript',
        ...sliceOptions(options),
        mode,
        iterationBudget: options?.iterationBudget,
        vars,
      })
    );
  } catch (e) {
    throw sliceError(e);
  }
  const p = slice.program;

  const entry = entryOf(p);
  const literal = entry.literal === true;
  const inputs = entryInputs(p, options, (k) => !entry.lengthOf[k]);

  // The entry plan of a loader of stored code (`checkEntry()` of
  // `javascript-runtime.ts`), which `run()` applies too (README, "Selecting
  // the pipeline", `entryChecks` and "Stored code"). In the bigint mode, with
  // `entryChecks`, an integer input that is not a `bigint` or a safe integer
  // throws, and the `number` cells of a list of integers are converted
  // (`bigints`, `bigintLists`); the code converts a scalar (`JS_BIGINT.read`).
  type Key = string | number;
  const plan = {
    kind: literal ? 'args' : 'vars',
    real: [] as Key[],
    complex: [] as Key[],
    lists: [] as Key[],
    strings: new Map<Key, string>(),
    // The scalar boolean inputs (also in `real`), which `broadcast()` reads
    // as columns, as `varsEntryPlan()` of the existing compiler.
    booleans: [] as Key[],
    bigints: [] as Key[],
    bigintLists: [] as Key[],
  };
  const bigint = mode === 'bigint';
  const checks = options?.entryChecks !== false;
  // The list inputs that a batch shares between its cells, also with the
  // checks off (`plan.lists` is what the check reads).
  const shared: Key[] = [];
  entry.paramNames.forEach((name, k) => {
    const t = p.types[entry.body.params[k]];
    const i = argumentIndex(entry, k);
    const key = literal ? i : name;
    if (entry.lengthOf[k]) return;
    if (t.shape.length > 0) {
      shared.push(key);
      if (!checks) return;
      plan.lists.push(key);
      plan.strings.set(key, literal ? `argument ${i + 1}` : `"${name}"`);
      if (bigint && t.lane === 'integer') plan.bigintLists.push(key);
    } else if (t.lane === 'complex') plan.complex.push(key);
    else if (bigint && t.lane === 'integer') {
      if (checks) plan.bigints.push(key);
    } else if (checks) {
      plan.real.push(key);
      if (t.lane === 'boolean' && !literal) plan.booleans.push(key);
    }
  });
  const entryPlan = plan as EntryPlan;
  const batchPlan = { ...plan, lists: shared } as EntryPlan;
  const f = slice.run as (...args: unknown[]) => unknown;
  // The construction of `load()`: the entry plan, then the result
  // convention of every stored kernel (`normalizeRunResult()`). A call
  // with no input to check skips the check.
  const unchecked =
    plan.real.length +
      plan.complex.length +
      plan.lists.length +
      plan.bigints.length ===
    0;
  const run = literal
    ? (...args: unknown[]) =>
        inDigits(() =>
          normalizeRunResult(
            f(...(unchecked ? args : checkEntry(entryPlan, args)))
          )
        )
    : unchecked
      ? (vars: unknown) => inDigits(() => normalizeRunResult(f(vars)))
      : (vars: unknown) =>
          inDigits(() =>
            normalizeRunResult(f(checkEntry(entryPlan, [vars])[0]))
          );

  const warnings: CompileDiagnostic[] = slice.warnings.map((w) => ({
    code: w.code,
    kind: 'correctness',
    message: w.message,
  }));
  // A name of `vars` is read as the host's text, which a worker has only
  // when it reads the inputs object (`CompileTarget.hostNames` of the
  // existing compiler).
  const code = [slice.preambleOnce, slice.code].join('\n');
  const shippable =
    Object.values(vars).every(readsVarsObject) && isShippableCode(code);
  const once = slice.preambleOnce;
  const result: CompilationResult<'javascript'> = {
    target: 'javascript',
    success: true,
    runtimeVersion: RUNTIME_VERSION,
    // A lambda loads from `code` alone, as one of the existing compiler: its
    // `code` evaluates the definitions and gives the function, and
    // `callCode` is the function without them (`StoredJavaScript.callCode`).
    code:
      literal && once !== ''
        ? `(() => {\n${once}\nreturn ${slice.code};\n})()`
        : slice.code,
    ...(literal && once !== '' ? { callCode: slice.code } : {}),
    // The helpers and the user functions, which read no input: a loader
    // evaluates them once (`StoredJavaScript.preambleOnce`).
    preamble: once,
    ...(once === '' ? {} : { preambleOnce: once }),
    reconstructionDigits,
    calling: literal ? 'lambda' : 'expression',
    entryPlan: storeEntryPlan(entryPlan),
    run: run as CompilationResult<'javascript'>['run'],
    freeSymbols: inputs,
    unsupported: [],
    mode,
    profile: 'ir',
    shippable,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  if (literal) return result;

  // The batch and asynchronous members of an expression (README, "Batches
  // and `runAsync()`"), over the raw call `f`: the batch applies the entry
  // plan and reads the value itself. A batch runs in one reconstruction-digit
  // frame, as a loader runs each call.
  const outputs = entry.tuple ? 1 : broadcastStrideOfType(expr.type.type);
  if (outputs > 1) result.broadcastOutputs = outputs;
  const inFrame = <T>(g: () => T): T => {
    if (bigint) throw bigintBroadcastError();
    const previous = setReconstructionDigits(result.reconstructionDigits);
    try {
      return g();
    } finally {
      setReconstructionDigits(previous);
    }
  };
  result.broadcast = (inputs, opts) =>
    inFrame(() =>
      broadcastNumbers(f, batchPlan, inputs, opts, result.broadcastOutputs)
    );
  const engine = expr.engine;
  const asyncSpec: BroadcastAsyncSpec = {
    kind: 'javascript',
    stored: result,
    lists: shared as string[],
    booleans: plan.booleans as string[],
    shippable,
    iterationLimit: () => engine.iterationLimit,
    slice: (inputs, opts, out, cells) =>
      inFrame(() =>
        broadcastNumbersSlice(
          f,
          batchPlan,
          inputs,
          opts,
          out,
          cells,
          result.broadcastOutputs
        )
      ),
    workers: () => engine.workers,
  };
  result.broadcastAsync = bigint
    ? () => Promise.reject(bigintBroadcastError())
    : makeBroadcastAsync(asyncSpec);
  result.willUsePool = bigint ? () => false : makeWillUsePool(asyncSpec);
  // `sys`, `check`, `finish` and `error` are read only with an asynchronous
  // copy, which the profile does not make.
  const runAsyncSpec: RunAsyncSpec = {
    result,
    sys: undefined,
    check: (args) => args,
    finish: (value) => value,
    error: (_, error) => error,
    digits: result.reconstructionDigits,
    run: run as (inputs: unknown) => unknown,
    workers: () => engine.workers,
    iterationLimit: () => engine.iterationLimit,
  };
  result.runAsync = makeRunAsync(runAsyncSpec);
  result.willParallelize = makeWillParallelize(runAsyncSpec);
  return result;
}
