/**
 * The profile `'ir'` of `compile()` for the `glsl` target (experimental):
 * the result of the `glsl` target from the slice compiler, or the
 * decline `'outside-profile'`, to which `compile()` applies `fallback`. What
 * it compiles and the fields of its result: README, "Selecting the
 * pipeline", the paragraph on GLSL.
 */

import type { Expression } from '../../global-types.js';
import type { CompilationResult, CompileDiagnostic } from '../types.js';
import { type Fn, userBinding } from './lower-context.js';
import { gpuIsReservedWord } from '../gpu-reserved.js';
import { gpuExactConstant } from '../gpu-exact-constant.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import {
  isLibraryOperator,
  isShadowedSymbol,
} from '../../library-shadowing.js';
import { CONSTANTS, OPERATORS, rowOfHead } from './operators.js';
import { compileSlice } from './index.js';
import { typeName } from './print-glsl.js';
import { expressionOf } from './print.js';
import {
  entryOf,
  loopPasses,
  regionsOf,
  useIndex,
  type IRType,
  type Region,
} from './ir.js';
import {
  addSymbolDeps,
  decline,
  inputReport,
  optionDecline,
  sliceError,
  sliceOptions,
  IR_OPTIONS,
  type IrOptions,
} from './adapter.js';

/** The class of each option of `compile()` on GLSL: that of `IR_OPTIONS`,
 *  except the rows that differ (`no-op`: a JavaScript option with no effect
 *  on GLSL; `declined` when given, `optionDecline()`). */
const IR_GLSL_OPTIONS = {
  ...IR_OPTIONS,
  entryChecks: 'no-op',
  varsObjectRefs: 'no-op',
  storage: 'mapped',
  quadrature: 'no-op',
} as const;

const TRIG_HEADS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

/** Whether an operand amplifies a trigonometric value, with a memo per
 *  node and state: linear in the nodes
 *  of a shared graph. Whether a trigonometric call is under a factor of
 *  magnitude 1000 or more on the chain of `Multiply`, `Negate`, `Add`,
 *  `Subtract`, `Abs` and numerators from `u`, or its argument has one. */
function amplifiedTrigMemo(): (u: Expression) => boolean {
  const value = (e: Expression) => gpuExactConstant(e)?.re;
  const large = (e: Expression) => {
    const c = value(e);
    return c !== undefined && Math.abs(c) >= 1000;
  };
  const small = (e: Expression | undefined) => {
    const d = e === undefined ? undefined : value(e);
    return d !== undefined && d !== 0 && Math.abs(d) <= 1e-3;
  };
  const factors = new Map<Expression, boolean>();
  const hasLargeFactor = (e: Expression): boolean => {
    if (!isFunction(e)) return false;
    let r = factors.get(e);
    if (r !== undefined) return r;
    r =
      (e.operator === 'Multiply' && e.ops.some(large)) ||
      (e.operator === 'Divide' && small(e.ops[1])) ||
      (e.operator === 'Dot' &&
        e.ops.some(
          (op) =>
            (isFunction(op, 'List') || isFunction(op, 'Tuple')) &&
            op.ops.some(large)
        )) ||
      e.ops.some(hasLargeFactor);
    factors.set(e, r);
    return r;
  };
  const memo = new Map<Expression, (boolean | undefined)[]>();
  const walk = (e: Expression, chain: boolean, amp: boolean): boolean => {
    if (!isFunction(e)) return false;
    const slots = memo.get(e) ?? [];
    memo.set(e, slots);
    const k = (chain ? 2 : 0) + (amp ? 1 : 0);
    if (slots[k] !== undefined) return slots[k]!;
    const off = (op: Expression) => walk(op, false, false);
    let r: boolean;
    if (TRIG_HEADS.has(e.operator))
      r = amp || e.ops.some(hasLargeFactor) || e.ops.some(off);
    else if (!chain) r = e.ops.some(off);
    else if (e.operator === 'Multiply')
      r = e.ops.some((op) => walk(op, true, amp || e.ops.some(large)));
    else if (e.operator === 'Divide')
      r =
        walk(e.ops[0], true, amp || small(e.ops[1])) ||
        (e.ops[1] !== undefined && off(e.ops[1]));
    else if (['Negate', 'Add', 'Subtract', 'Abs'].includes(e.operator))
      r = e.ops.some((op) => walk(op, true, amp));
    else r = e.ops.some(off);
    slots[k] = r;
    return r;
  };
  return (u) => walk(u, true, false);
}

/** The NaN of a result of type `t`: a `float` or a `vecN`. */
function nanOf(t: IRType): string | undefined {
  const name = typeName(t);
  const nan = 'uintBitsToFloat(0x7fc00000u)';
  if (name === 'float') return nan;
  return /^vec[234]$/.test(name) ? `${name}(${nan})` : undefined;
}

/**
 * The printed lines of a program whose loops can run more passes in all
 * than the budget (`budget()`: a run-time count as the budget, multiplied
 * down the nesting), with one counter of
 * every pass, `_gpu_ir_passes`: a
 * pass past the budget leaves its loop, and the result is NaN. Each `Sum`
 * or `Product` is also limited by its own count. Unchanged when the bound
 * is within the budget. A result that is not a number or a point declines.
 */
function counted(
  printed: { body: string[]; functions: string[] },
  result: IRType,
  budget: () => number | undefined
): { body: string[]; functions: string[] } {
  const b = budget();
  if (b === undefined) return printed;
  const nan = nanOf(result);
  if (nan === undefined)
    throw decline(
      `a ${typeName(result)} result of a program whose loops can run more passes than the iterationBudget (${b}) on glsl`
    );
  const pass = (lines: string[]) =>
    lines.flatMap((line) => {
      const loop = /^(\s*)for \(int \w+_i = /.exec(line);
      return loop === null
        ? [line]
        : [line, `${loop[1]}  if (++_gpu_ir_passes > ${b}) break;`];
    });
  const lines = pass(printed.body);
  const last = /^ {2}return (.*);$/s.exec(lines[lines.length - 1]);
  if (last === null) throw new Error('slice GLSL printer: no return');
  return {
    body: [
      '  _gpu_ir_passes = 0;',
      ...lines.slice(0, -1),
      `  ${typeName(result)} _gpu_ir_result = ${last[1]};`,
      `  return _gpu_ir_passes > ${b} ? ${nan} : _gpu_ir_result;`,
    ],
    functions: [
      // Guarded: a host that joins two
      // counted programs in one shader declares it once.
      '#ifndef _GPU_IR_PASSES_DECLARED',
      '#define _GPU_IR_PASSES_DECLARED',
      'int _gpu_ir_passes = 0;',
      '#endif',
      ...printed.functions.map((f) => pass(f.split('\n')).join('\n')),
    ],
  };
}

/** The warning `float32-unsafe-argument`, once per
 *  operand of a `Mod` or a `Fract` that `amplifiedTrigMemo()` flags, in
 *  `expr` and in the bodies of the user functions it calls, each node once;
 *  not in a `Mod` or a `Fract` that is closed as a whole when `fold`, which
 *  the lowering computes in doubles (README, "Selecting the pipeline"). */
function float32Warnings(expr: Expression, fold: boolean): CompileDiagnostic[] {
  const found = new Map<string, CompileDiagnostic>();
  const seen = new Set<object>();
  const memo = new Map<Expression, boolean>();
  const isAmplifiedTrig = amplifiedTrigMemo();
  const closed = (x: Expression): boolean => {
    const known = memo.get(x);
    if (known !== undefined) return known;
    const c =
      isNumber(x) ||
      (isSymbol(x) &&
        CONSTANTS.has(x.symbol) &&
        !isShadowedSymbol(x as never)) ||
      (isFunction(x) &&
        userBinding(x as Fn) === undefined &&
        isLibraryOperator(x as never, x.operator) &&
        (rowOfHead(OPERATORS, x.operator)?.effect ?? 'effectful') !==
          'effectful' &&
        x.ops.every(closed));
    memo.set(x, c);
    return c;
  };
  const walk = (e: Expression): void => {
    if (!isFunction(e) || seen.has(e)) return;
    seen.add(e);
    const u = e.ops[0];
    if (
      (e.operator === 'Mod' || e.operator === 'Fract') &&
      isAmplifiedTrig(u) &&
      !(fold && closed(e))
    )
      found.set(u.toString(), {
        code: 'float32-unsafe-argument',
        kind: 'correctness',
        value: u.toString(),
        message: `The operand of \`${e.operator}\` amplifies a trigonometric value by a constant of magnitude 1000 or more, so its float32 value on glsl can have no relation to the exact value (a sine hash such as \`fract(43758.5·sin(12.9898·x))\`). The compiler does not give an exact form of such an operand.`,
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
    // `callerLocals` has no effect: a user function takes every input that
    // its body reads as a parameter, which each call passes (`capture()`).
    optionDecline(options, IR_GLSL_OPTIONS, ' on glsl');
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
    // `storage`: a list input in a `sampler2D` (the one kind, which
    // `compile()` has checked, as it has checked that each name is free).
    const storage = Object.keys(options?.storage ?? {});
    const both = storage.find((name) => Object.hasOwn(vars, name));
    if (both !== undefined)
      throw decline(`the vars entry of ${both} in storage on glsl`, {
        binding: both,
      });
    // The default cap of the passes on GLSL: a `Sum` or a `Product` of more passes
    // is NaN (the lowering's test), and a program whose loops of constant
    // counts can run more passes in all declines (`loopPasses()`, with a
    // run-time count as one pass).
    const budget = options?.iterationBudget ?? 10_000;
    const s = compileSlice(expr, {
      target: 'glsl',
      bareInputs: vars,
      storage,
      ...sliceOptions(options),
      iterationBudget: budget,
      // `'bigint'` declines in `compileSlice()` (JavaScript only).
      mode: options?.mode as 'strict' | 'complex' | 'bigint' | undefined,
    });
    const p = s.program;
    const entry = entryOf(p);
    if (entry.literal === true)
      throw decline('a Function literal on glsl', { operator: 'Function' });
    // A function takes an input that its body reads as a parameter: GLSL
    // copies an array argument at each call, so only a point (`vecN`) or a
    // sampler is lifted.
    for (const f of p.functions)
      f.body.params.slice(f.lifted ?? Infinity).forEach((v, k) => {
        const n = p.types[v].shape[0];
        if (p.types[v].storage === undefined && typeof n === 'number' && n > 4)
          throw decline(
            `the function ${f.source} reads the input ${f.paramNames[f.lifted! + k]}, a list of ${n} elements, which glsl would copy at each call`
          );
      });
    // The rule of `At` with a constant index (README, "Selecting the
    // pipeline"), after the passes, in every function, each region once.
    // `def` is also read by the result check below.
    const def = useIndex(p).def;
    const walk = (r: Region): void =>
      r.body.forEach((i) => {
        regionsOf(i).forEach(walk);
        if (i.k !== 'op' || i.op !== 'at') return;
        const [list, index] = i.args;
        const k = def.get(index);
        const n = p.types[list].shape[0];
        if (k?.k !== 'const' || typeof n !== 'number') return;
        const x = Number(k.value.value);
        if (!Number.isInteger(x) || x === 0 || Math.abs(x) > n)
          throw decline(
            `the index ${x} of At is outside the ${n} elements of its list on glsl`,
            { operator: 'At' }
          );
      });
    p.functions.forEach((f) => walk(f.body));
    // A colour result in another space than OKLCh (`asoklab`, `asrgb`,
    // which `admits()` allows only as the result of the entry) must be the
    // result position of the expression itself (the root, or the last
    // operand of a root `Block`), so that a host reads the space from the
    // expression: a local that holds `AsOklab(c)` and is the result
    // declines, as does an `If` or a `Which` of such arms.
    let last = expr;
    while (isFunction(last, 'Block') && last.nops > 0) last = last.ops.at(-1)!;
    const at = isFunction(last) ? last.operator : '';
    const yielded = def.get(entry.body.yields[0]);
    if (
      yielded?.k === 'op' &&
      ['asoklab', 'asrgb'].includes(yielded.op) &&
      yielded.op !== { AsOklab: 'asoklab', AsRgb: 'asrgb' }[at]
    )
      throw decline(
        'a colour in OKLab or sRGB that is not the result position of the expression on glsl (an AsOklab or an AsRgb there)'
      );
    if (!(loopPasses(p, 1, def) <= budget))
      throw decline(
        `loops that can run more passes than the iterationBudget (${budget}) on glsl`
      );
    const { body, functions } = counted(s.printed, entry.results[0], () =>
      loopPasses(p, budget, def) <= budget ? undefined : budget
    );
    const preamble = [...s.printed.helpers, ...functions].join('\n');
    const code =
      expressionOf(body) ?? body.map((line) => line.slice(2)).join('\n');
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
      // A list in storage: its array type (`float[5]`).
      lowered[name] = typeName({ ...p.types[v], storage: undefined });
    });
    addSymbolDeps(p, options?.symbolDeps);
    // A name of `vars` is an entry parameter (`bareInputs`); `lowered` is
    // the GLSL type of the parameter, which the host binds the uniform as.
    const report = inputReport(p, inputs, (name) => lowered[name]);
    const warnings = float32Warnings(expr, options?.constantFold !== false);
    return {
      target: 'glsl',
      success: true,
      code,
      ...(preamble === '' ? {} : { preamble }),
      ...(warnings.length === 0 ? {} : { warnings }),
      freeSymbols: report.freeSymbols,
      freeSymbolTypes: report.freeSymbolTypes,
      unsupported: [],
      mode: options?.mode === 'complex' ? 'complex' : 'strict',
      profile: 'ir',
    };
  } catch (e) {
    throw sliceError(e);
  }
}
