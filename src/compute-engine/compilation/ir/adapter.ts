/**
 * The profile `'ir'` of `compile()` (experimental): the glue between the
 * options and the result of the public `compile()` and the slice compiler
 * of this directory (`compileSlice()`), for the `javascript` target.
 *
 * Every option of `compile()` is mapped or declined by name
 * (`optionDecline()`); a `Decline` of the slice is the public decline
 * `'outside-profile'`, any other error a `'compile-error'`, and a
 * cancellation is thrown as it is. `compile()` applies `fallback` to both
 * declines, as for the `numeric-kernel` profile. See "Selecting the
 * pipeline" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult, CompileDiagnostic } from '../types.js';
import { CompileDeclineError } from '../diagnostics.js';
import { ALL_PASSES } from './passes.js';
import { Decline } from './lower-context.js';
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
  operators: 'declined',
  imports: 'declined',
  preamble: 'declined',
  broadcast: 'declined',
  strictTypes: 'declined',
} as const;

export type IrOptionName = keyof typeof IR_OPTIONS;

/** The options of `compile()`, by the names of `IR_OPTIONS`
 *  (`compile-expression.ts` imports this file, so its type is not imported
 *  here). */
type IrOptions = { readonly [K in IrOptionName]?: unknown } & {
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
    case 'broadcast':
    case 'strictTypes':
      return value === true ? `the option \`${name}\`` : undefined;
    default:
      return given(value) ? `the option \`${name}\`` : undefined;
  }
}

/** The first option of `options` that the profile does not have, as the
 *  text of its decline, or `undefined`. */
function optionDecline(options: IrOptions | undefined): string | undefined {
  if (options === undefined) return undefined;
  for (const name of Object.keys(IR_OPTIONS) as IrOptionName[]) {
    if (IR_OPTIONS[name] !== 'declined') continue;
    const text = refusal(name, options[name]);
    if (text !== undefined) return text;
  }
  return undefined;
}

function decline(message: string, extra: Partial<CompileDiagnostic> = {}) {
  return new CompileDeclineError({
    code: 'outside-profile',
    kind: 'capability',
    message: `${PREFIX}: ${message}`,
    ...extra,
  });
}

/**
 * The compilation of `expr` with the profile `'ir'`: a successful result,
 * or a throw of a `CompileDeclineError` (`'outside-profile'` for a decline,
 * `'compile-error'` for an internal error of the slice), or of a
 * cancellation.
 */
export function compileWithIrProfile(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'javascript'> {
  const given = options?.mode ?? 'strict';
  const mode = given === 'complex' ? 'complex' : 'strict';
  const refused =
    given !== mode
      ? `the option \`mode\` with the value '${String(given)}'`
      : options?.quadrature === 'monte-carlo'
        ? "the option `quadrature` with the value 'monte-carlo'"
        : optionDecline(options);
  if (refused !== undefined)
    throw decline(`${refused} is not supported by the profile 'ir'`);
  // `vars`: a name read as the host's text (`compile()` checks that each
  // entry is a string).
  // No prototype: an entry named `__proto__` is an entry.
  const vars: Record<string, string> = Object.create(null);
  for (const [name, text] of Object.entries(options?.vars ?? {})) {
    if (typeof text !== 'string' || text.trim() === '' || /\$\d/.test(text))
      throw decline(`the vars entry of ${name} is not a source text`);
    vars[name] = text;
  }
  let slice: JavaScriptResult & { warnings: Warning[]; program: Program };
  try {
    slice = compileSlice(expr, {
      target: 'javascript',
      passes: {
        ...ALL_PASSES,
        ...(options?.cse === false ? { cse: false } : {}),
        ...(options?.constantFold === false ? { fold: false } : {}),
      },
      constantFold: options?.constantFold !== false,
      mode,
      iterationBudget: options?.iterationBudget,
      vars,
      extend: testExtension,
    });
  } catch (e) {
    if ((e as Error | undefined)?.name === 'CancellationError') throw e;
    if (e instanceof Decline)
      throw decline(e.message, {
        ...(e.head === undefined ? {} : { operator: e.head }),
        value: e.node,
      });
    const message = e instanceof Error ? e.message : String(e);
    throw new CompileDeclineError({
      code: 'compile-error',
      kind: 'capability',
      message: `${PREFIX}: internal error: ${message}`,
    });
  }
  const p = slice.program;

  const entry = entryOf(p);
  const positional = entry.positional ?? 0;
  const literal = entry.literal === true;
  const inputs = entry.paramNames.filter(
    (_, k) => k >= positional && !entry.lengthOf[k]
  );
  // Filled also when the compilation declines below
  // (`CompilationOptions.varsObjectRefs`).
  for (const name of inputs) options?.varsObjectRefs?.add(name);
  // The engine calls a compiled `Function` literal with its arguments only
  // (`implicitCompile()`): it has no object for the free names of the body.
  if (literal && inputs.length > 0)
    throw decline(
      `a Function literal that reads the free name \`${inputs[0]}\`: its code is called with its arguments only`,
      { binding: inputs[0] }
    );
  for (const f of p.functions)
    if (f.source !== undefined) options?.symbolDeps?.add(f.source);
  // A name whose engine value the code holds as a literal.
  for (const name of p.captures ?? []) options?.symbolDeps?.add(name);

  // The entry check of `entryChecks` (docs/COMPILATION-MODEL.md, R6): a
  // `{re, im}` value for a scalar real or integer input, and a value that
  // is not an array for an input that the code reads as an array, throw a
  // `TypeError` that names the input. A number for a scalar complex input
  // is lifted to `{re, im: 0}`, and a zero part of a complex input is +0
  // (the interpreter has no -0: `Ln` of `-4 - 0i` is on the upper side of
  // the cut), also with `entryChecks: false`: the code reads its parts.
  type Shape = 'array' | 'real' | 'complex';
  type Checked = readonly [string, number, Shape];
  const checked = entry.paramNames.flatMap((name, k): Checked[] => {
    const t = p.types[entry.body.params[k]];
    const i = argumentIndex(entry, k);
    if (entry.lengthOf[k]) return [];
    if (t.shape.length > 0) return [[name, i, 'array'] as const];
    if (t.lane === 'complex') return [[name, i, 'complex'] as const];
    return t.lane === 'boolean' ? [] : [[name, i, 'real'] as const];
  });
  /** The value `value` of the input `name`, lifted to `{re, im}`. */
  const check = (value: unknown, name: string, shape: Shape): unknown => {
    if (shape === 'complex') {
      const z =
        typeof value === 'number'
          ? { re: value, im: 0 }
          : (value as { re: number; im: number });
      return Object.is(z.re, -0) || Object.is(z.im, -0)
        ? { re: z.re + 0, im: z.im + 0 }
        : z;
    }
    if (shape === 'array' && !Array.isArray(value))
      throw new TypeError(
        `The input \`${name}\` is not an array: the code reads it as an array`
      );
    if (
      shape === 'real' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    )
      throw new TypeError(
        `The input \`${name}\` is not a real number: the code reads it as a real`
      );
    return value;
  };
  const checks = options?.entryChecks !== false && checked.length > 0;
  const lifted = checked.filter(([, , shape]) => shape === 'complex');
  const toCheck = checks ? checked : lifted;
  // The ABI of `mode: 'complex'` (`CompileMode`): a complex value of
  // imaginary part 0 is returned as the number, at the root only (the ABI
  // states no rule for the elements of a list).
  const project =
    mode === 'complex' && p.types[entry.body.yields[0]].shape.length === 0
      ? (v: unknown) =>
          typeof v === 'object' && v !== null && (v as { im: number }).im === 0
            ? (v as { re: number }).re
            : v
      : (v: unknown) => v;
  const f = slice.run as (...args: unknown[]) => unknown;
  const run = literal
    ? (...args: unknown[]) => {
        args = args.slice(0, argumentIndex(entry, positional));
        for (const [name, k, shape] of toCheck)
          args[k] = check(args[k], name, shape);
        return project(f(...args));
      }
    : (vars: Record<string, unknown> = {}) => {
        // A lifted value goes in a view of the inputs that the code reads,
        // each read once by name (an inherited or a non-enumerable input
        // stays readable); the host's object is not changed.
        let view = vars;
        for (const [name, , shape] of toCheck) {
          const given = vars[name];
          const v = check(given, name, shape);
          if (v === given) continue;
          if (view === vars)
            view = Object.fromEntries(inputs.map((n) => [n, vars[n]]));
          view[name] = v;
        }
        return project(f(view));
      };

  const warnings: CompileDiagnostic[] = slice.warnings.map((w) => ({
    code: w.code,
    kind: 'correctness',
    message: w.message,
  }));
  return {
    target: 'javascript',
    success: true,
    code: slice.code,
    calling: literal ? 'lambda' : 'expression',
    run: run as CompilationResult<'javascript'>['run'],
    freeSymbols: inputs,
    unsupported: [],
    // The code holds its helpers; it reads the runtime `_rt`, so it cannot
    // be stored and run elsewhere (no `runtimeVersion`).
    preamble: '',
    mode,
    profile: 'ir',
    shippable: false,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
