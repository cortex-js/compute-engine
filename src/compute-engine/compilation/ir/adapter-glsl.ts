/**
 * The profile `'ir'` of `compile()` for the `glsl` target (experimental):
 * the result of the existing GLSL target from the slice compiler, for a
 * scalar or list result (real, integer or boolean; a point is a `vec2`) of
 * inputs that are scalars or lists of a stated length (`vec3`,
 * `float[6]`), and the warning `float32-unsafe-argument`. `code` is a GLSL
 * expression, or statements that end in `return …;`, in which an input is
 * its bare name or its `vars` text; `preamble` holds the helpers
 * (`_gpu_ir_…`) and the user functions (`_fn_ir_…`). Anything else
 * declines with `'outside-profile'`; `compile()` then applies `fallback`
 * (the existing GLSL target). See "Selecting the pipeline" in `README.md`.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult, CompileDiagnostic } from '../types.js';
import type { Fn } from './lower-context.js';
import { userBinding } from './lower-functions.js';
import { analyzeReferences, freeSymbolTypes } from '../compile-references.js';
import { gpuIsReservedWord } from '../gpu-reserved.js';
import { isAmplifiedTrig } from '../gpu-exact-trig.js';
import { isFunction, isSymbol } from '../../boxed-expression/type-guards.js';
import { ALL_PASSES } from './passes.js';
import { compileSlice } from './index.js';
import { typeName } from './print-glsl.js';
import {
  entryOf,
  regionsOf,
  useIndex,
  type Program,
  type Region,
} from './ir.js';
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

/** An upper bound of the passes of every loop (`Loop`, `Sum`, `Product`,
 *  a reduction) of one evaluation of the program, at compile time: a
 *  constant count is itself, a run-time count is `budget` (the count of a
 *  `Sum` or a `Product`, which the lowering tests against it), multiplied
 *  down the nesting and through the calls (both arms of an `if` are
 *  added). GLSL counts no pass at run time. */
function loopPasses(p: Program, budget: number): number {
  const def = useIndex(p).def;
  const memo = new Map<Region, number>();
  const passes = (r: Region): number => {
    const known = memo.get(r);
    if (known !== undefined) return known;
    const total = r.body.reduce((n, i) => {
      const inner =
        i.k === 'call'
          ? passes(p.functions.find((f) => f.name === i.fn)!.body)
          : regionsOf(i).reduce((m, x) => m + passes(x), 0);
      if (i.k !== 'loop') return n + inner;
      const [lo, hi] = [i.lo, i.hi].map((v) => def.get(v));
      const count =
        lo?.k === 'const' && hi?.k === 'const'
          ? Math.max(0, Number(hi.value.value) - Number(lo.value.value) + 1)
          : budget;
      return n + (count === 0 ? 0 : count * (1 + inner));
    }, 0);
    memo.set(r, total);
    return total;
  };
  return passes(entryOf(p).body);
}

/** The warning `float32-unsafe-argument` of the existing target, once per
 *  operand of a `Mod` or a `Fract` in which a constant of magnitude 1000
 *  or more amplifies a trigonometric value (`isAmplifiedTrig()`), in `expr`
 *  and in the bodies of the user functions it calls, each node visited
 *  once. There is no exact sine hash: such an operand always warns, also a
 *  closed one (which the lowering folds unless `constantFold` is false). */
function float32Warnings(expr: Expression): CompileDiagnostic[] {
  const found = new Map<string, CompileDiagnostic>();
  const seen = new Set<object>();
  const walk = (e: Expression): void => {
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    const u = e.ops[0];
    if ((e.operator === 'Mod' || e.operator === 'Fract') && isAmplifiedTrig(u))
      found.set(u.toString(), {
        code: 'float32-unsafe-argument',
        kind: 'correctness',
        value: u.toString(),
        message: `The operand of \`${e.operator}\` amplifies a trigonometric value by a constant of magnitude 1000 or more, so its float32 value on glsl can have no relation to the exact value (a sine hash such as \`fract(43758.5·sin(12.9898·x))\`). The profile 'ir' has no exact form.`,
      });
    e.ops.forEach(walk);
    const user = userBinding(e as Fn);
    if (user !== undefined && !seen.has(user.key)) {
      seen.add(user.key);
      walk(user.literal.ops[0]);
    }
  };
  walk(expr);
  return [...found.values()];
}

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
    // The existing target's cap (`GLSL_DEFAULT_PASS_BUDGET`, which is not
    // imported: a cycle of modules): a `Sum` or a `Product` of more passes
    // is NaN (the lowering's test), and a program whose loops can run more
    // passes in all declines (`loopPasses()`).
    const budget = options?.iterationBudget ?? 10_000;
    const s = compileSlice(expr, {
      target: 'glsl',
      bareInputs: vars,
      passes: {
        ...ALL_PASSES,
        ...(options?.cse === false ? { cse: false } : {}),
        ...(options?.constantFold === false ? { fold: false } : {}),
      },
      constantFold: options?.constantFold !== false,
      iterationBudget: budget,
      extend: irTestExtension(),
    });
    const p = s.program;
    const entry = entryOf(p);
    if (entry.literal === true)
      throw decline('a Function literal on glsl', { operator: 'Function' });
    if (!(loopPasses(p, budget) <= budget))
      throw decline(
        `loops that can run more passes than the iterationBudget (${budget}) on glsl`
      );
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
      // A list input of 2 to 4 elements is a vector, of another stated
      // length an array (`float[6]`); a run-time length is refused by the
      // profile's check already.
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
    const warnings = float32Warnings(expr);
    return {
      target: 'glsl',
      success: true,
      code,
      ...(preamble === '' ? {} : { preamble }),
      ...(warnings.length === 0 ? {} : { warnings }),
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
