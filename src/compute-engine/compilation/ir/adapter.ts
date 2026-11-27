/**
 * The profile `'ir'` of `compile()` (experimental): the glue between the
 * options and the result of the public `compile()` and the slice compiler
 * of this directory (`compileSlice()`), for the `javascript` target.
 *
 * Every option of `compile()` is mapped or declined by name
 * (`optionDecline()`); an input with no type is the decline
 * `'untyped-input'`, another `Decline` of the
 * slice the public decline of the code of its reason (`'unsettled-shape'`,
 * `'static-type-error'`, …) or `'outside-profile'`, any other error a
 * `'compile-error'`, and a cancellation is thrown as it is. `compile()`
 * applies `fallback` to every decline. See "Selecting the pipeline" in
 * `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { Type } from '../../../common/type/types.js';
import type {
  CompilationResult,
  CompileDiagnostic,
  FreeSymbolType,
} from '../types.js';
import { isTupleShapedType } from '../../collection-utils.js';
import {
  bigintBroadcastError,
  checkEntry,
  normalizeRunResult,
  rowsBroadcastError,
  setReconstructionDigits,
  storeEntryPlan,
  stringBroadcastError,
  twoStageRunner,
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
  type RunState,
} from '../run-async.js';
import { broadcastStrideOfType, declaredTypeText } from '../type-facts.js';
import { readsVarsObject } from '../vars-inputs.js';
import { withIntegralClosedFormBudgets } from '../interval-quadrature.js';
import { realPowerReconstructionDigits } from '../../numerics/real-power.js';
import { ALL_PASSES } from './passes.js';
import { Decline, UntypedInputs } from './lower-context.js';
import { compileSlice, type Extension, type Warning } from './index.js';
import {
  arrayNote,
  readAssigned,
  runtimeOf,
  writeAssigned,
  type JavaScriptResult,
} from './print-js.js';
import { arrayEntryCheck } from './lower-arrays.js';
import type { Outline } from './outline.js';
import {
  argumentIndex,
  entryOf,
  regionsOf,
  scalarType,
  type Assigned,
  type IRType,
  type Lane,
  type Program,
  type Region,
} from './ir.js';

const PREFIX = 'Could not compile';

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
  vars: 'mapped',
  symbolic: 'mapped',
  inputs: 'mapped',
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
 *  `table`: `'unsupported-mode'` for a `mode` (a mode that the target does
 *  not offer), `'outside-profile'` for another option. */
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
      throw decline(
        `${text} is not supported by the compiler${where}`,
        name === 'mode' ? { code: 'unsupported-mode', kind: 'capability' } : {}
      );
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

/** The names of `vars` (of the keys `keys`) whose text the code of `p`
 *  holds (`hostVarOp()`), in a function too, each with the lane it is read
 *  on. */
export function hostReads(
  p: Program,
  keys: readonly string[]
): Map<string, Lane> {
  const reads = new Map<string, Lane>();
  const walk = (r: Region): void =>
    r.body.forEach((i) => {
      const m = i.k === 'op' ? /^host(\d+)\.(\w+)$/.exec(i.op) : null;
      if (m !== null) reads.set(keys[Number(m[1])], m[2] as Lane);
      regionsOf(i).forEach(walk);
    });
  p.functions.forEach((f) => walk(f.body));
  return reads;
}

/**
 * The report of the inputs of `p`, by one rule on every target.
 * `freeSymbols` holds the names in `read` (the inputs of the entry and the
 * names of `vars` that the code reads), in the order the lowering first
 * reads them (`Program.inputs`). A name whose engine value or definition
 * the code holds as a literal is not read: it is a dependency of the code
 * (`symbolDeps`, from `Program.captures`), and it would be added here if
 * the pipeline recorded a name that it folds and that the host must still
 * give; it records none. `freeSymbolTypes` has an entry for each name: its
 * declared type when its binding declares one (`provenance: 'declared'`),
 * else the type that the lowering gave the input (`'inferred'`), spelled
 * as a declaration (`declaredTypeText()`), and `lowered(name, type)`, the
 * type that the code reads it as.
 */
export function inputReport(
  p: Program,
  read: Iterable<string>,
  lowered: (name: string, type: Type) => string
): { freeSymbols: string[]; freeSymbolTypes: Record<string, FreeSymbolType> } {
  const names = new Set(read);
  const order = [...(p.inputs?.keys() ?? [])].filter((n) => names.has(n));
  const freeSymbols = [...new Set([...order, ...names])];
  const freeSymbolTypes: Record<string, FreeSymbolType> = {};
  for (const name of freeSymbols) {
    const input = p.inputs?.get(name);
    const type = input?.type ?? 'unknown';
    // Defined, not assigned: a name `__proto__` is an own entry.
    Object.defineProperty(freeSymbolTypes, name, {
      value: {
        type: declaredTypeText(type),
        lowered: lowered(name, type),
        provenance: input?.declared === true ? 'declared' : 'inferred',
      },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { freeSymbols, freeSymbolTypes };
}

/** `t` is, or holds, a record whose fields include `re` and `im`. */
function complexLike(t: IRType): boolean {
  return (
    t.lane === 'record' &&
    ((t.names?.includes('re') === true && t.names.includes('im')) ||
      (t.fields ?? []).some(complexLike))
  );
}

/** The error of a batch of code that reads or writes an array of the
 *  engine (`lower-arrays.ts`): a batch shares no array of the engine. */
function arrayBroadcastError(): Error {
  return new TypeError(
    'Code that reads or writes an array of the engine cannot be broadcast: call `run()` for each value.'
  );
}

/** A batch reads and writes numeric values only (README, "Records"). */
function recordBroadcastError(): Error {
  return new TypeError(
    'Code whose input or result is a record cannot be broadcast. Call `run()` for each value.'
  );
}

/** The `lowered` of the report on JavaScript and interval-js: the value
 *  convention of the runner (`FreeSymbolType.lowered`) for the IR type of
 *  the entry parameter of the name, or the lane of its `vars` read
 *  (`reads`): `number` (`interval` on interval-js), `boolean`, `complex`,
 *  `color`, `string`, `point` for a plain tuple, `record` for a named
 *  tuple, and `array` for a list. */
export function runnerLowered(
  p: Program,
  reads: ReadonlyMap<string, Lane>,
  interval: boolean
): (name: string, type: Type) => string {
  const entry = entryOf(p);
  return (name, type) => {
    const k = entry.paramNames.findIndex(
      (n, j) => n === name && !entry.lengthOf[j]
    );
    // A tuple read part by part.
    if (entry.partOf?.[k] !== undefined) return 'point';
    const t =
      k >= 0
        ? p.types[entry.body.params[k]]
        : scalarType(reads.get(name) ?? 'real');
    if (t.shape.length > 0) return isTupleShapedType(type) ? 'point' : 'array';
    // The engine's array (`lower-arrays.ts`), not the array of a list.
    if (t.lane === 'array') return 'mutable-array';
    if (t.lane === 'real' || t.lane === 'integer')
      return interval ? 'interval' : 'number';
    return t.lane;
  };
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
 *  type as `'untyped-input'`, a
 *  `Decline` with the code of its reason (`'unsettled-shape'`, …) or
 *  `'outside-profile'`, any other error as `'compile-error'`. */
export function sliceError(e: unknown): unknown {
  if ((e as Error | undefined)?.name === 'CancellationError') return e;
  if (e instanceof CompileDeclineError) return e;
  if (e instanceof UntypedInputs) throwUntypedInputs(e.names);
  if (e instanceof Decline)
    return decline(e.message, {
      ...(e.reason === undefined
        ? {}
        : { code: e.reason.code, kind: e.reason.kind ?? 'capability' }),
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
 * The `run()` of a function literal that assigns the variables `assigns`
 * of the engine (`Program.assigns`): each call reads their values in the
 * engine (`readAssigned()`), gives them to the code after the `arity`
 * arguments, and writes the values that the code returns after the value
 * of the body back to the engine (`writeAssigned()`), as a call of the
 * interpreter does. A call that throws writes nothing more: the engine
 * keeps what the code wrote before each call of a function of the host
 * and what such a function assigned. A variable that holds no value of its
 * lane (no value, a complex number for a `number`) throws a `TypeError`
 * before the call.
 */
function assigningRun(
  expr: Expression,
  assigns: readonly Assigned[],
  arity: number,
  stagedAssignments: boolean,
  call: (args: unknown[]) => unknown,
  inDigits: <T>(g: () => T) => T
): (...args: unknown[]) => unknown {
  const ce = expr.engine;
  return (...args: unknown[]) =>
    inDigits(() => {
      const given = Array.from({ length: arity }, (_, k) => args[k]);
      const r = call([
        ...given,
        ...assigns.map((x) => readAssigned(ce, x)),
      ]) as unknown[];
      // A name that the code only reads is not written back.
      if (!stagedAssignments)
        assigns.forEach((x, k) => {
          if (!x.read) writeAssigned(ce, x, r[k + 1]);
        });
      return normalizeRunResult(r[0]);
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
    throw decline(`${refused} is not supported by the compiler`);
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
  let slice: JavaScriptResult & {
    warnings: Warning[];
    program: Program;
    pool?: Outline;
    parallelLoopFallbacks?: CompilationResult<'javascript'>['parallelLoopFallbacks'];
  };
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
  // A record of fields named `re` and `im` would be read as a complex
  // number by the result convention (`normalizeRunResult()`).
  if (entry.results.some(complexLike))
    throw decline(
      'a record of fields named re and im as the result, which the result convention reads as a complex number'
    );
  const literal = entry.literal === true;
  const positional = argumentIndex(entry, entry.positional ?? 0);
  const arity = positional - (p.assigns?.length ?? 0);
  // The names whose value is an array, which `run()` gives the code from
  // the engine at each call (`ArrayUse.names`): not inputs of the host.
  const arrays = p.arrays;
  const arrayNames = new Set((arrays?.names ?? []).map((x) => x.name));
  // A tuple read part by part is one input, at its first part.
  const inputs = entryInputs(
    p,
    options,
    (k) =>
      !entry.lengthOf[k] &&
      (entry.partOf?.[k] ?? 0) === 0 &&
      !arrayNames.has(entry.paramNames[k])
  );

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
    // as columns.
    booleans: [] as Key[],
    bigints: [] as Key[],
    bigintLists: [] as Key[],
    // An array parameter or input: the engine's array of its cells
    // (`arrayEntryCheck()`). The stored plan of code that uses an array
    // (`arrays: true` below) is not loaded.
    kinds: new Map<Key, { label: string; check: (x: unknown) => boolean }>(),
  };
  const bigint = mode === 'bigint';
  const checks = options?.entryChecks !== false;
  // The list inputs that a batch shares between its cells, also with the
  // checks off (`plan.lists` is what the check reads).
  const shared: Key[] = [];
  // A string input, or a string result: no batch (a batch is of numbers).
  let strings = entry.results.some((t) => t.lane === 'string');
  // A list of rows of different lengths as the result: no batch either;
  // nor a record input or result (README, "Records").
  const rows = entry.results.some((t) => t.lane === 'rows' && !t.resultRecord);
  let records = entry.results.some(
    (t) => t.lane === 'record' || t.resultRecord
  );
  entry.paramNames.forEach((name, k) => {
    const t = p.types[entry.body.params[k]];
    const i = argumentIndex(entry, k);
    const key = literal ? i : name;
    if (entry.lengthOf[k]) return;
    if (t.lane === 'record') {
      records = true;
      return;
    }
    if (t.lane === 'array') {
      // An assigned variable is checked by its read (`readAssigned()`).
      if (
        (literal && i >= arity && i < positional) ||
        ((!literal || i >= positional) && arrayNames.has(name))
      )
        return;
      const label = literal ? `argument ${i + 1}` : `"${name}"`;
      plan.kinds.set(key, {
        label,
        check: arrayEntryCheck(expr.engine, t.array!, label),
      });
      return;
    }
    // A tuple read part by part (`partOf`) is an array input, checked once,
    // at its first part; a string part is checked by its read (`text.in`).
    const part = entry.partOf?.[k];
    if (part !== undefined) {
      if (t.lane === 'string') strings = true;
      if (part > 0) return;
      shared.push(key);
      if (!checks) return;
      plan.lists.push(key);
      plan.strings.set(key, `"${name}"`);
      return;
    }
    // A list of rows whose lengths can differ is a list input too.
    if (t.shape.length > 0 || t.lane === 'rows') {
      shared.push(key);
      if (t.lane === 'string') strings = true;
      if (!checks) return;
      plan.lists.push(key);
      plan.strings.set(key, literal ? `argument ${i + 1}` : `"${name}"`);
      if (bigint && t.lane === 'integer') plan.bigintLists.push(key);
    } else if (t.lane === 'complex') plan.complex.push(key);
    // A string is checked by its read (`text.in`).
    else if (t.lane === 'string') strings = true;
    else if (bigint && t.lane === 'integer') {
      if (checks) plan.bigints.push(key);
    } else if (checks) {
      plan.real.push(key);
      if (t.lane === 'boolean' && !literal) plan.booleans.push(key);
    }
  });
  const entryPlan = plan as EntryPlan;
  const batchPlan = { ...plan, lists: shared } as EntryPlan;
  // The construction of `load()`: the entry plan, then the result
  // convention of every stored kernel (`normalizeRunResult()`). A call
  // with no input to check skips the check.
  const unchecked =
    plan.real.length +
      plan.complex.length +
      plan.lists.length +
      plan.bigints.length +
      plan.kinds.size ===
    0;
  const raw = slice.run as (...args: unknown[]) => unknown;
  // The arrays of the program (`ArrayUse`): the array that each name holds
  // now, read from its definition at each call and checked as an input of
  // its cells, given to the code in the inputs object; and, for a unit that
  // stores, the store epoch and the state event when the call returns or
  // throws (`arrayNote()`; before each call of the host, `hostCaller()`).
  const note = arrays?.stores === true ? arrayNote(expr.engine) : undefined;
  const named = (arrays?.names ?? []).map((x) => ({
    ...x,
    check: arrayEntryCheck(expr.engine, x.cells, `The variable "${x.name}"`),
  }));
  const f: (...args: unknown[]) => unknown =
    arrays === undefined
      ? raw
      : (...args) => {
          try {
            if (named.length === 0) return raw(...args);
            const given: Record<string, unknown> = {};
            for (const x of named) {
              const v = x.definition.value;
              x.check(v);
              given[x.name] = v;
            }
            if (literal) {
              return raw(...args.slice(0, positional), given);
            }
            const vars = args[0];
            return raw(
              typeof vars === 'object' && vars !== null
                ? { ...vars, ...given }
                : given
            );
          } finally {
            note?.();
          }
        };
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
  const assigns = p.assigns ?? [];

  const warnings: CompileDiagnostic[] = slice.warnings.map((w) => ({
    code: w.code,
    kind: 'correctness',
    message: w.message,
  }));
  // A name of `vars` is read as the host's text, which a worker has only
  // when it reads the inputs object. Code of a string input or result has
  // no batch, on a worker or not.
  const code = [slice.preambleOnce, slice.code].join('\n');
  // A worker has no engine to write the assigned variables to, nor to call
  // the functions of the host in.
  const hostCalls = [...new Set((p.hosts ?? []).map((h) => h.name))];
  const shippable =
    assigns.length === 0 &&
    hostCalls.length === 0 &&
    arrays === undefined &&
    !strings &&
    !rows &&
    !records &&
    Object.values(vars).every(readsVarsObject) &&
    isShippableCode(code);
  const once = slice.preambleOnce;
  const reads = hostReads(p, Object.keys(vars));
  const report = inputReport(
    p,
    [...inputs, ...reads.keys()],
    runnerLowered(p, reads, false)
  );
  const result: CompilationResult<'javascript'> = {
    target: 'javascript',
    success: true,
    runtimeVersion: RUNTIME_VERSION,
    // A lambda loads from `code` alone: its
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
    // Code that reads or writes an array of the engine (a parameter, a
    // name, a reference, a construction), whatever `entryChecks` is: the
    // loaders refuse it (`restoreEntryPlan()`).
    entryPlan: {
      ...storeEntryPlan(entryPlan),
      ...(arrays !== undefined ? { arrays: true as const } : {}),
    },
    run: (assigns.length > 0
      ? assigningRun(
          expr,
          assigns,
          arity,
          p.stagedAssignments === true,
          (args) => f(...(unchecked ? args : checkEntry(entryPlan, args))),
          inDigits
        )
      : run) as CompilationResult<'javascript'>['run'],
    freeSymbols: report.freeSymbols,
    freeSymbolTypes: report.freeSymbolTypes,
    ...(assigns.some((x) => !x.read)
      ? { assigns: assigns.filter((x) => !x.read).map((x) => x.name) }
      : {}),
    ...(hostCalls.length > 0 ? { hostCalls } : {}),
    // With the names that the code reads again after a call of the host.
    ...(arrays !== undefined
      ? {
          arrays: [
            ...arrayNames,
            ...assigns.filter((x) => x.read).map((x) => x.name),
          ],
        }
      : {}),
    unsupported: [],
    mode,
    ...(strings ? { strings } : {}),
    ...(rows ? { rows } : {}),
    profile: 'ir',
    shippable,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(slice.parallelLoopFallbacks === undefined
      ? {}
      : { parallelLoopFallbacks: slice.parallelLoopFallbacks }),
  };
  if (literal) return result;

  // The batch and asynchronous members of an expression (README, "Batches
  // and `runAsync()`"), over the raw call `f`: the batch applies the entry
  // plan and reads the value itself. A batch runs in one reconstruction-digit
  // frame, as a loader runs each call.
  const outputs = entry.tuple ? 1 : broadcastStrideOfType(expr.type.type);
  if (outputs > 1) result.broadcastOutputs = outputs;
  const inFrame = <T>(g: () => T): T => {
    if (arrays !== undefined) throw arrayBroadcastError();
    if (bigint) throw bigintBroadcastError();
    if (strings) throw stringBroadcastError();
    if (rows) throw rowsBroadcastError();
    if (records) throw recordBroadcastError();
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
  result.broadcastAsync =
    arrays !== undefined
      ? () => Promise.reject(arrayBroadcastError())
      : bigint
        ? () => Promise.reject(bigintBroadcastError())
        : strings
          ? () => Promise.reject(stringBroadcastError())
          : rows
            ? () => Promise.reject(rowsBroadcastError())
            : records
              ? () => Promise.reject(recordBroadcastError())
              : makeBroadcastAsync(asyncSpec);
  result.willUsePool =
    bigint || strings || rows || records || arrays !== undefined
      ? () => false
      : makeWillUsePool(asyncSpec);
  // The pool loops (`outline()`): each worker program as a stored lambda,
  // which a worker loads, and as a function over the engine's runtime, for
  // a sub-range that the calling thread runs again. The asynchronous text
  // is built over the same once-only definitions at the first call.
  const pool = slice.pool;
  const asyncCode = slice.asyncCode;
  const runAsyncSpec: RunAsyncSpec = {
    run: run as (inputs: unknown) => unknown,
    loops: (pool?.loops ?? []).map(({ loop, printed, workPerPass }) => {
      const own = printed.preambleOnce;
      return {
        workPerPass,
        ...(loop.k === 'region' ? { comprehension: true } : {}),
        stored: {
          runtimeVersion: RUNTIME_VERSION,
          code:
            own !== ''
              ? `(() => {\n${own}\nreturn ${printed.code};\n})()`
              : printed.code,
          ...(own !== '' ? { callCode: printed.code, preambleOnce: own } : {}),
          preamble: own,
          calling: 'lambda',
          reconstructionDigits,
        },
        run: printed.run as (...args: unknown[]) => unknown,
      };
    }),
    ...(asyncCode === undefined
      ? {}
      : {
          body: () =>
            inDigits(
              () =>
                twoStageRunner(
                  runtimeOf(engine as never),
                  once,
                  ['_', '_run'],
                  asyncCode
                ) as (vars: unknown, state: RunState) => Promise<unknown>
            ),
        }),
    check: unchecked
      ? (vars) => vars
      : (vars) => checkEntry(entryPlan, [vars])[0],
    finish: normalizeRunResult,
    digits: reconstructionDigits,
    engine,
  };
  result.runAsync = makeRunAsync(runAsyncSpec);
  result.willParallelize = makeWillParallelize(runAsyncSpec);
  return result;
}
