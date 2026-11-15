/**
 * The profile `'ir'` of `compile()` for the `glsl` target (experimental):
 * the result of the existing GLSL target from the slice compiler, for a
 * scalar or list result (real, integer or boolean; a point is a `vec2`) of
 * inputs that are scalars or lists of 2 to 4 elements. `code` is a GLSL
 * expression, or statements that end in `return …;`, in which an input is
 * its bare name or its `vars` text; `preamble` holds the helpers
 * (`_gpu_ir_…`) and the user functions (`_fn_ir_…`). Anything else
 * declines with `'outside-profile'`; `compile()` then applies `fallback`
 * (the existing GLSL target). See "Selecting the pipeline" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult } from '../types.js';
import { analyzeReferences, freeSymbolTypes } from '../compile-references.js';
import { gpuIsReservedWord } from '../gpu-reserved.js';
import { isSymbol } from '../../boxed-expression/type-guards.js';
import { ALL_PASSES } from './passes.js';
import { compileSlice } from './index.js';
import { typeName } from './print-glsl.js';
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
  vars: 'mapped',
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
    // `vars`: an input spelled as the host's text, a name or a member or
    // element of one (`u_x`, `u.x`, `u[0]`), which reads a uniform and calls
    // nothing, each name of it no GLSL word; a name with a value in the
    // engine declines. (`compile()` refuses a text that is not a string.)
    const vars: Record<string, string> = Object.create(null);
    for (const [name, text] of Object.entries(options?.vars ?? {}) as [
      string,
      string,
    ][]) {
      const binding = expr.engine.lookupDefinition(name);
      if (
        !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*|\[\d+\])*$/.test(text) ||
        text
          .match(/[A-Za-z_]\w*/g)!
          .some(
            (id) =>
              /__|^(gl_|webgl_|_webgl_)/.test(id) ||
              gpuIsReservedWord(id, 'glsl')
          ) ||
        (binding !== undefined &&
          'value' in binding &&
          binding.value.value !== undefined)
      )
        throw decline(`the vars entry of ${name} on glsl`, { binding: name });
      vars[name] = text;
    }
    const s = compileSlice(expr, {
      target: 'glsl',
      bareInputs: vars,
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
      // A list input of 2 to 4 elements is a vector (`At` on a uniform
      // array is batch G3).
      const n = p.types[v].shape[0];
      if (n !== undefined && !(typeof n === 'number' && n >= 2 && n <= 4))
        throw decline(`the list input \`${name}\` on glsl`, { binding: name });
      // A plain identifier (the name of the text of `vars`) that is no GLSL
      // word, no name of the printer (`v<n>`, `v<n>_i`, a helper or a
      // function) and no function called.
      const id = /^[^.[]*/.exec(vars[name] ?? name)![0];
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id) ||
        /__|^(gl_|webgl_|_webgl_|_gpu_|_fn_)|^v\d/.test(id) ||
        gpuIsReservedWord(id, 'glsl') ||
        new RegExp(`\\b${id}\\s*\\(`).test(`${code}\n${preamble}`)
      )
        throw decline(`the input name \`${id}\` on glsl`, { binding: name });
      lowered[name] = typeName(p.types[v]);
    });
    addSymbolDeps(p, options?.symbolDeps);
    // The engine type and the provenance as the existing target reports
    // them; `lowered` is the type that the code reads.
    const target = expr.engine._getCompilationTarget('glsl')!.createTarget({
      loweredSymbolType: (x) => (isSymbol(x) ? lowered[x.symbol] : undefined),
    });
    const occurrences = new Map<string, Expression>();
    analyzeReferences(expr, target, new Set(Object.keys(vars)), occurrences);
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
