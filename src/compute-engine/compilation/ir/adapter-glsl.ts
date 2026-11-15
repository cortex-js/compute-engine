/**
 * The profile `'ir'` of `compile()` for the `glsl` target (experimental):
 * the result of the existing GLSL target from the slice compiler, for a
 * scalar result (real, integer or boolean) of scalar inputs. `code` is a
 * GLSL expression, or statements that end in `return …;`, in which an
 * input is its bare name; `preamble` holds the helpers (`_gpu_ir_…`) and
 * the user functions (`_fn_ir_…`). Anything else declines with
 * `'outside-profile'`; `compile()` then applies `fallback` (the existing
 * GLSL target). See "Selecting the pipeline" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult } from '../types.js';
import { analyzeReferences, freeSymbolTypes } from '../compile-references.js';
import { gpuIsReservedWord } from '../gpu-reserved.js';
import { isSymbol } from '../../boxed-expression/type-guards.js';
import { ALL_PASSES } from './passes.js';
import { compileSlice } from './index.js';
import { entryOf, regionsOf, type Region } from './ir.js';
import {
  addSymbolDeps,
  decline,
  irTestExtension,
  optionDecline,
  sliceError,
  type IR_OPTIONS,
  type IrOptions,
} from './adapter.js';

/** The class of each option of `compile()` on GLSL, as `IR_OPTIONS`
 *  (whose check against `compile()`'s options makes this one complete):
 *  `mapped`, `no-op` (a JavaScript option with no effect on GLSL), or
 *  `declined` when given (`optionDecline()`). */
const IR_GLSL_OPTIONS = {
  to: 'mapped',
  target: 'mapped',
  profile: 'mapped',
  fallback: 'mapped',
  entryChecks: 'no-op',
  iterationBudget: 'mapped',
  symbolDeps: 'mapped',
  varsObjectRefs: 'no-op',
  cse: 'mapped',
  constantFold: 'mapped',
  mode: 'declined',
  storage: 'declined',
  quadrature: 'no-op',
  functions: 'declined',
  vars: 'declined',
  symbolic: 'mapped',
  inputs: 'mapped',
  operators: 'declined',
  imports: 'declined',
  preamble: 'declined',
  broadcast: 'declined',
  strictTypes: 'declined',
} as const satisfies Record<
  keyof typeof IR_OPTIONS,
  'mapped' | 'no-op' | 'declined'
>;

/** Whether `r` holds a `Loop`, whose passes GLSL does not count. */
const hasLoop = (r: Region): boolean =>
  r.body.some(
    (i) => (i.k === 'loop' && i.passes === true) || regionsOf(i).some(hasLoop)
  );

export function compileWithIrProfileGlsl(
  expr: Expression,
  options: IrOptions | undefined
): CompilationResult<'glsl'> {
  try {
    const refused =
      (options as { callerLocals?: unknown } | undefined)?.callerLocals !==
      undefined
        ? 'the option `callerLocals`'
        : optionDecline(options, IR_GLSL_OPTIONS);
    if (refused !== undefined)
      throw decline(`${refused} is not supported by the profile 'ir' on glsl`);
    const s = compileSlice(expr, {
      target: 'glsl',
      bareInputs: true,
      passes: {
        ...ALL_PASSES,
        ...(options?.cse === false ? { cse: false } : {}),
        ...(options?.constantFold === false ? { fold: false } : {}),
      },
      constantFold: options?.constantFold !== false,
      iterationBudget: options?.iterationBudget,
      extend: irTestExtension(),
    });
    const p = s.program;
    const entry = entryOf(p);
    if (entry.literal === true)
      throw decline('a Function literal on glsl', { operator: 'Function' });
    if (entry.tuple === true || entry.results[0].shape.length > 0)
      throw decline('a list or tuple result on glsl');
    if (
      options?.iterationBudget !== undefined &&
      p.functions.some((f) => hasLoop(f.body))
    )
      throw decline('the option `iterationBudget` with a Loop on glsl', {
        operator: 'Loop',
      });
    const preamble = [...s.printed.helpers, ...s.printed.functions].join('\n');
    const statements = s.printed.body.map((line) => line.slice(2));
    const single = /^return (.*);$/s.exec(statements[0]);
    const code =
      statements.length === 1 && single !== null
        ? single[1]
        : statements.join('\n');
    const inputs = entry.paramNames;
    const lowered: Record<string, string> = {};
    entry.body.params.forEach((v, k) => {
      const name = inputs[k];
      if (p.types[v].shape.length > 0)
        throw decline(`the list input \`${name}\` on glsl`, { binding: name });
      // A plain identifier that is no GLSL word, no name of the printer
      // (`v<n>`, `v<n>_i`, a helper or a function) and no function called.
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
        /__|^(gl_|webgl_|_webgl_|_gpu_|_fn_)|^v\d/.test(name) ||
        gpuIsReservedWord(name, 'glsl') ||
        new RegExp(`\\b${name}\\s*\\(`).test(`${code}\n${preamble}`)
      )
        throw decline(`the input name \`${name}\` on glsl`, { binding: name });
      lowered[name] = p.types[v].lane === 'boolean' ? 'bool' : 'float';
    });
    addSymbolDeps(p, options?.symbolDeps);
    // The engine type and the provenance as the existing target reports
    // them; `lowered` is the type that the code reads.
    const target = expr.engine._getCompilationTarget('glsl')!.createTarget({
      loweredSymbolType: (x) => (isSymbol(x) ? lowered[x.symbol] : undefined),
    });
    const occurrences = new Map<string, Expression>();
    analyzeReferences(expr, target, undefined, occurrences);
    return {
      target: 'glsl',
      success: true,
      code,
      ...(preamble === '' ? {} : { preamble }),
      freeSymbols: [...inputs],
      freeSymbolTypes: freeSymbolTypes(expr, target, inputs, occurrences),
      unsupported: [],
      mode: 'strict',
      profile: 'ir',
    };
  } catch (e) {
    throw sliceError(e);
  }
}
