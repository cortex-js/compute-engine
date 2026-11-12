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
import { entryOf, regionsOf, type Program, type Region } from './ir.js';

const PREFIX = "Could not compile with the profile 'ir'";

/**
 * The class of each option of `compile()` in the profile: `mapped` (read
 * by the adapter or by `compile()`), `no-op` (admitted with no effect:
 * `storage` is ignored on the JavaScript target by contract,
 * `CompilationOptions.storage`; no program of the profile has an
 * `Integrate`, which `quadrature` selects for), or `declined` (declined by
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
  storage: 'no-op',
  quadrature: 'no-op',
  functions: 'declined',
  vars: 'declined',
  operators: 'declined',
  imports: 'declined',
  preamble: 'declined',
  mode: 'declined',
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
  readonly symbolDeps?: Set<string>;
  readonly varsObjectRefs?: Set<string>;
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
    case 'mode':
      return value === undefined || value === 'strict'
        ? undefined
        : `the option \`mode\` with the value '${String(value)}'`;
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

/** Whether a region of `p` has a counted loop (a `Sum`, a `Product`, or a
 *  reduction of a list). */
function hasLoop(p: Program): boolean {
  const walk = (r: Region): boolean =>
    r.body.some((i) => i.k === 'loop' || regionsOf(i).some(walk));
  return p.functions.some((f) => walk(f.body));
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
  const refused = optionDecline(options);
  if (refused !== undefined)
    throw decline(`${refused} is not supported by the profile 'ir'`);
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
  // The public budget counts the passes of a `Loop`, which the slice does
  // not have; a `Sum` or a `Product` over the budget gives NaN, which the
  // slice does not do. Every counted loop declines (a reduction of a list
  // too), since the slice cannot tell them apart.
  if (options?.iterationBudget !== undefined && hasLoop(p))
    throw decline(
      "the option `iterationBudget` with a counted loop (a Sum, a Product or a reduction of a list) is not supported by the profile 'ir'"
    );

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

  // The entry check of `entryChecks` (docs/COMPILATION-MODEL.md, R6): a
  // `{re, im}` value for a scalar real or integer input, and a value that
  // is not an array for an input that the code reads as an array, throw a
  // `TypeError` that names the input.
  type Checked = readonly [string, number, 'array' | 'real'];
  const checked = entry.paramNames.flatMap((name, k): Checked[] => {
    const t = p.types[entry.body.params[k]];
    if (entry.lengthOf[k]) return [];
    if (t.shape.length > 0) return [[name, k, 'array'] as const];
    return t.lane === 'boolean' ? [] : [[name, k, 'real'] as const];
  });
  const check = (value: unknown, name: string, shape: 'array' | 'real') => {
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
  };
  const checks = options?.entryChecks !== false && checked.length > 0;
  const f = slice.run as (...args: unknown[]) => unknown;
  const run = literal
    ? (...args: unknown[]) => {
        if (checks)
          for (const [name, k, shape] of checked) check(args[k], name, shape);
        return f(...args.slice(0, positional));
      }
    : (vars: Record<string, unknown> = {}) => {
        if (checks)
          for (const [name, , shape] of checked) check(vars[name], name, shape);
        return f(vars);
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
    mode: 'strict',
    profile: 'ir',
    shippable: false,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
