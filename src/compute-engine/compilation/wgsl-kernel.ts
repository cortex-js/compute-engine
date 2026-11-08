/**
 * `WGSLTarget.compileKernel()`: a WGSL compute shader that runs one pass of
 * an Epsil `parallel for` loop (`ParallelLoop`) or of a parallel
 * comprehension (`ParallelComprehension`) in each invocation.
 *
 * The passes of a parallel loop are independent: the body changes a variable
 * of the enclosing program only with `+=`, and it does not read such a
 * variable (`docs/plans/2026-11-07-ce1093-parallel-for.md`, §3). So each
 * pass is one invocation of a compute shader, and each `+=` is an atomic
 * addition to a storage buffer. Integer atomics are commutative, so the
 * result does not depend on the order of the invocations.
 *
 * The free symbols of the expression are the inputs of the kernel, in the
 * style of `compileFieldFunction()` (`wgsl-field-function.ts`):
 *
 * - an accumulator, a symbol that the body changes with `+=`: a `read_write`
 *   storage buffer of `atomic<i32>`, either a list (`CE_List_atomic_i32`,
 *   a `len: u32` header and the elements) or one integer;
 * - a list that the body only reads: a `'storage-buffer'` hint of the
 *   `storage` option, declared and read as in `compile()`;
 * - a scalar or a point: a field of one uniform struct.
 *
 * The domain is an integer range `a..b` whose bounds are integer literals,
 * symbols with an integer value, or scalar parameters declared `integer`, so
 * that the host can count the invocations. Invocation `i` runs the pass
 * `k = a + i`, and does nothing when `k > b`.
 *
 * The kernel is compiled by the `compile()` of the WGSL target, with the
 * hooks of `CompileTarget.kernel`: the root node compiles to the statements
 * of one pass (`compilePass`), and each `AddTo` to an atomic addition
 * (`compileAddTo`). Every expression that `compile(expr, { to: 'wgsl' })`
 * declines in the body is declined here with the same diagnostic.
 *
 * What declines, each with a diagnostic that names the reason: a domain that
 * is not such a range, a step, a second clause, a guard on a comprehension,
 * an accumulator that is not a list of integers or an integer, a `+=` of a
 * non-integer amount, a `+=` to a list of lists, a read of an accumulator
 * (its value during the passes is unspecified), a pass that draws a random
 * value (the frame of each pass, `docs/RANDOMNESS-MODEL.md` §3, is not
 * derived on the GPU), a `Return` that leaves the pass, a list parameter
 * with no storage hint, and a comprehension whose element is not a real
 * scalar or a point.
 *
 * Design record: `docs/plans/2026-11-07-ce1093-parallel-for.md`, §6
 * (CE-1075).
 */

import type { Expression } from '../global-types.js';
import type {
  CompilationOptions,
  CompilationResult,
  CompileDiagnostic,
  CompileTarget,
  FieldFunctionParameter,
  KernelBinding,
  KernelOptions,
  KernelResult,
} from './types.js';
import type { GPUTargetExtension } from './gpu-target.js';
import { gpuCheckIdentifier, gpuTypeOfValue } from './gpu-target.js';
import { gpuNeedsStatements } from './gpu-statements.js';
import { gpuIsBoundName } from './gpu-at.js';
import { storageBufferDeclarations } from './gpu-storage-buffer.js';
import { WGSL_PREDECLARED } from './wgsl-predeclared.js';
import { pointComponentCount } from './wgsl-field-function.js';
import { isFunction, isNumber, isSymbol } from '../boxed-expression/type-guards.js';
import { BaseCompiler } from './base-compiler.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { numericLiteralSource } from './compiler-type-facts.js';
import { resolveStorageHints } from './storage-hints.js';
import { isLibraryOperator } from './builtin-callback.js';
import { withShadowingCallsRenamed } from './shadowing-calls.js';
import { effectsOf } from '../boxed-expression/effects-of.js';
import { computedEffectsInclude } from '../../common/type/effects.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { isNonRealNumber, resolveTypeAlias } from '../../common/type/utils.js';

/** The parts of the WGSL target that this file uses. */
export interface KernelHost {
  compile(
    expr: Expression,
    options: CompilationOptions<Expression>
  ): CompilationResult;
  createTarget(): CompileTarget<Expression>;
  withTargetExtension<T>(extension: GPUTargetExtension, fn: () => T): T;
  /** The helper declarations that the WGSL text `code` needs, including
   * the user-defined functions of the last `compile()`
   * (`GPUShaderTarget.preambleFor`). */
  preambleFor(code: string): string;
}

/**
 * The largest workgroup size: `maxComputeInvocationsPerWorkgroup`, the
 * default limit of the WebGPU specification, which every device supports.
 */
export const KERNEL_MAX_WORKGROUP_SIZE = 256;

const DEFAULT_WORKGROUP_SIZE = 64;

/** The WGSL struct of a list accumulator. */
export const KERNEL_ACCUMULATOR_STRUCT = 'CE_List_atomic_i32';

/** The name of the invocation id, the argument of the entry point. */
const INVOCATION = '_gpu_gid';

/** A WGSL identifier that the kernel can declare. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

function invalid(detail: string): never {
  throw new Error(`Invalid option of compileKernel(): ${detail}`);
}

/** The result of a decline: `success: false` and every other field empty. */
function declined(diagnostic: CompileDiagnostic): KernelResult {
  return {
    success: false,
    diagnostic,
    code: '',
    entryPoint: '',
    workgroupSize: 0,
    bindings: [],
    range: { lower: 0, upper: -1 },
    params: [],
    paramsSize: 0,
    paramsStructSource: '',
  };
}

/** A decline for something the kernel cannot do, with the reason. */
function unsupported(
  code: 'unsupported-parameter' | 'unsupported-result' | 'compile-error',
  reason: string,
  binding?: string
): KernelResult {
  const diagnostic: CompileDiagnostic = {
    code,
    kind: 'capability',
    message: `Could not compile with \`compileKernel()\`: ${reason}`,
  };
  if (binding !== undefined) diagnostic.binding = binding;
  return declined(diagnostic);
}

/** The error that a hook throws: the message of a decline. */
function hookError(reason: string): Error {
  return new Error(`Could not compile with \`compileKernel()\`: ${reason}`);
}

/** The name of the helper that adds to element `i` of the accumulator
 * `name`. */
function accumulatorHelperName(name: string): string {
  return `_gpu_kadd_${name}`;
}

/**
 * The helper that adds `_gpu_v` to element `_gpu_i` (1-based, as a float)
 * of the list accumulator `name`. The index rules are those of `At`: a
 * negative index counts from the end. An index that is not a position of
 * the list (0, a non-integer, NaN, an infinity, an index out of range)
 * writes nothing: the interpreter gives the error `out-of-range` for it,
 * which a shader cannot report. The guards are those of the reader of a
 * storage-buffer list (`gpu-storage-buffer.ts`): the float guard runs
 * before the integer conversion, and the integer guard catches the rounding
 * of `f32(len)` above 2^24. A `len` above the elements that the buffer holds
 * writes nothing.
 */
function accumulatorHelperSource(name: string): string {
  return `fn ${accumulatorHelperName(name)}(_gpu_i: f32, _gpu_v: f32) {
  // 1-based; negative counts from the end; any other index writes nothing.
  let _gpu_n = ${name}.len;
  let _gpu_b = f32(_gpu_n);
  if (_gpu_n > arrayLength(&${name}.data) || _gpu_isnonfinite(_gpu_i) || !(_gpu_i >= -_gpu_b && _gpu_i <= _gpu_b) || _gpu_i != floor(_gpu_i) || _gpu_i == 0.0) {
    return;
  }
  let _gpu_k = i32(_gpu_i);
  let _gpu_j = select(i32(_gpu_n) + _gpu_k, _gpu_k - 1, _gpu_k > 0);
  if (_gpu_j < 0 || u32(_gpu_j) >= _gpu_n) {
    return;
  }
  atomicAdd(&${name}.data[_gpu_j], i32(_gpu_v));
}
`;
}

/** Round `value` up to a multiple of `alignment`. */
function roundUp(alignment: number, value: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/** Indent each line of `code` by two spaces. */
function indent(code: string): string {
  return code
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** End a hoisted statement line with `;` unless it ends a statement. */
function terminated(line: string): string {
  return /[;}]\s*$/.test(line) ? line : `${line};`;
}

/** An accumulator of the kernel: a list of integers, or one integer. */
type Accumulator = {
  kind: 'list' | 'scalar';
  ceType: string;
  /** The declared length of a list accumulator, when its type gives one. */
  length?: number;
};

/**
 * The symbols that `AddTo` nodes of `expr` write (the root symbol of the
 * target, `s` in `s += e` and in `L[i] += e`), outside function literals,
 * which have their own scope. A node is visited once.
 */
function addToTargets(expr: Expression): Set<string> {
  const names = new Set<string>();
  const visited = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (!isFunction(e) || visited.has(e)) return;
    visited.add(e);
    if (e.operator === 'Function') return;
    if (e.operator === 'AddTo' && isLibraryOperator(e, 'AddTo')) {
      const t = e.ops[0];
      if (isSymbol(t)) names.add(t.symbol);
      else if (isFunction(t, 'At') && isSymbol(t.op1)) names.add(t.op1.symbol);
    }
    for (const op of e.ops) walk(op);
  };
  walk(expr);
  return names;
}

/**
 * Does `expr` hold a node with one of the operators `heads`, outside
 * function literals, which have their own scope? A node whose operator has
 * a library definition (`ParallelLoop`) counts only when that definition is
 * the one bound to the node (`isLibraryOperator()`): a user function named
 * `ParallelLoop` is not the construct. `Return` has no definition, so it is
 * recognized by its name. A node is visited once.
 */
function hasHead(expr: Expression, heads: ReadonlyArray<string>): boolean {
  const visited = new Set<Expression>();
  const walk = (e: Expression): boolean => {
    if (!isFunction(e) || visited.has(e)) return false;
    visited.add(e);
    if (e.operator === 'Function') return false;
    if (
      heads.includes(e.operator) &&
      (e.operator === 'Return' || isLibraryOperator(e, e.operator))
    )
      return true;
    return e.ops.some(walk);
  };
  return walk(expr);
}

/**
 * Compile `expr` to a WGSL compute shader. See `WGSLTarget.compileKernel()`
 * for the contract.
 */
export function compileWGSLKernel(
  host: KernelHost,
  expr: Expression,
  options: KernelOptions = {}
): KernelResult {
  // The options. A wrong option is an error of the caller, thrown, as an
  // unknown `mode` or storage kind is thrown by `compile()`.
  const {
    name = 'main',
    workgroupSize = DEFAULT_WORKGROUP_SIZE,
    group = 0,
    paramsStruct = 'CEParams',
    paramsVariable = 'ce_params',
    resultVariable = 'ce_result',
    storage,
    constantFold,
  } = options;
  if (
    !Number.isInteger(workgroupSize) ||
    workgroupSize < 1 ||
    workgroupSize > KERNEL_MAX_WORKGROUP_SIZE
  )
    invalid(
      `\`workgroupSize\` must be an integer from 1 to ` +
        `${KERNEL_MAX_WORKGROUP_SIZE}, not ${String(workgroupSize)}`
    );
  if (!Number.isInteger(group) || group < 0 || group > 65535)
    invalid(`\`group\` must be an integer from 0 to 65535`);
  const declared = new Set<string>();
  for (const [option, value] of [
    ['name', name],
    ['paramsStruct', paramsStruct],
    ['paramsVariable', paramsVariable],
    ['resultVariable', resultVariable],
  ] as const) {
    // A name starts with a letter, so it never starts with `_fn_` or
    // `_gpu_`, the prefixes of the generated functions.
    if (typeof value !== 'string' || !IDENTIFIER.test(value))
      invalid(
        `\`${option}\` must be a WGSL identifier that starts with a letter, ` +
          `not ${JSON.stringify(value)}`
      );
    gpuCheckIdentifier(value, 'wgsl');
    if (WGSL_PREDECLARED.has(value))
      invalid(
        `\`${option}\` is "${value}", a predeclared function or type of ` +
          `WGSL, which a declaration of that name would hide`
      );
    // The structs of the storage buffers and of the accumulators are named
    // `CE_List_<element type>`.
    if (value.startsWith('CE_List_'))
      invalid(
        `\`${option}\` is "${value}", which starts with \`CE_List_\`, the ` +
          `prefix of the struct names that the compilation declares for its ` +
          `storage buffers`
      );
    if (declared.has(value))
      invalid(`the name "${value}" is used for two of the declared names`);
    declared.add(value);
  }

  // The expression: a `ParallelLoop` or a `ParallelComprehension` with one
  // clause over an integer range, with no step.
  const h = isFunction(expr) ? expr.operator : '';
  if (
    (h !== 'ParallelLoop' && h !== 'ParallelComprehension') ||
    !isFunction(expr) ||
    !isLibraryOperator(expr, h)
  )
    return unsupported(
      'compile-error',
      `the expression is a \`${h || expr.operator}\`, and a kernel is a ` +
        `\`parallel for\` loop (\`ParallelLoop\`) or a parallel ` +
        `comprehension (\`ParallelComprehension\`).`
    );
  const isLoop = h === 'ParallelLoop';
  if (expr.nops !== 2)
    return unsupported(
      'compile-error',
      `the ${isLoop ? 'loop' : 'comprehension'} has ${expr.nops - 1} ` +
        `clauses, and a kernel has one. Write the other clauses as loops ` +
        `in the body.`
    );
  const clause = expr.ops[1];
  if (!isFunction(clause, 'Element') || !isSymbol(clause.ops[0]))
    return unsupported(
      'compile-error',
      `the clause is \`${clause.toString()}\`, and a kernel runs one pass ` +
        `for each integer of a range (\`for k in a..b\`).`
    );
  const index = clause.ops[0].symbol;
  const domain = clause.ops[1];
  if (!isFunction(domain, 'Range') || domain.nops !== 2)
    return unsupported(
      'compile-error',
      `the domain is \`${domain.toString()}\`, and a kernel runs one pass ` +
        `for each integer of a range with no step (\`for k in a..b\`), so ` +
        `that the host can count the invocations.`
    );
  const guard = clause.ops[2];
  const hasGuard = guard !== undefined && !isSymbol(guard, 'Nothing');
  if (hasGuard && !isLoop)
    return unsupported(
      'compile-error',
      `the comprehension has the guard \`${guard.toString()}\`, so the ` +
        `number of its elements is not known before the passes run. ` +
        `Filter the list after the kernel, or put the test in the element.`
    );
  // The guard of the loop is the condition of an `if` statement, as the
  // guard of a clause of a `Loop` is on the shader targets: it must be a
  // boolean (the interpreter skips the pass for a guard that is not
  // `True`), and it cannot need statements.
  if (hasGuard && !guard.type.matches('boolean'))
    return unsupported(
      'compile-error',
      `the guard \`${guard.toString()}\` of the loop is not a boolean (it ` +
        `has the type \`${guard.type.toString()}\`), and a shader \`if\` ` +
        `tests a boolean.`
    );
  if (hasGuard && gpuNeedsStatements(guard))
    return unsupported(
      'compile-error',
      `the guard \`${guard.toString()}\` of the loop needs statements, ` +
        `which a shader \`if\` condition cannot hold.`
    );
  // The index is a `let` of the entry point, where it would hide a
  // predeclared function that the body calls (`length`).
  if (
    !IDENTIFIER.test(index) ||
    declared.has(index) ||
    WGSL_PREDECLARED.has(index)
  )
    return unsupported(
      'compile-error',
      `the index "${index}" cannot be the name of a WGSL variable of the ` +
        `kernel: it is not an identifier that starts with a letter, or it ` +
        `is the name of a declaration of the kernel or of a predeclared ` +
        `function or type of WGSL. Rename it.`
    );
  try {
    gpuCheckIdentifier(index, 'wgsl');
  } catch {
    return unsupported(
      'compile-error',
      `the index "${index}" is a reserved word of WGSL. Rename it.`
    );
  }

  // A parallel loop inside the pass declines: a kernel runs one parallel
  // loop. The check comes before the check of the random effect, which a
  // parallel loop has (it consumes an index of the enclosing random frame).
  const body = expr.ops[0];
  if (hasHead(body, ['ParallelLoop', 'ParallelComprehension']))
    return unsupported(
      'compile-error',
      `a \`parallel for\` loop or comprehension inside the pass is not ` +
        `compiled. A kernel runs one parallel loop; write the inner one as ` +
        `a \`for\` loop or a comprehension.`
    );
  // A `Return` in the pass leaves the loop, which the rules of a parallel
  // loop forbid. The check comes before the check of the random effect: the
  // effects of a body with a `Return` are not known, which reads as every
  // effect. A `Return` in a function literal of the body is that
  // function's.
  if (hasHead(body, ['Return']))
    return unsupported(
      'compile-error',
      `a \`Return\` leaves the pass. A pass of a parallel loop has no ` +
        `value; end the body with the last statement instead.`
    );
  // A pass that draws a random value declines: the interpreter gives each
  // pass its own frame (`docs/RANDOMNESS-MODEL.md` §3, "Pass frames of a
  // parallel loop"), and the shader does not derive it.
  if (computedEffectsInclude(effectsOf(body), 'random'))
    return unsupported(
      'compile-error',
      `a pass draws a random value, and the shader does not give each pass ` +
        `the random frame of the interpreter. Draw the values before the ` +
        `loop, into a list that the passes read.`
    );

  const ce = expr.engine;
  // The storage hints, validated as `compile()` validates them.
  const hints = resolveStorageHints(storage, [expr], host.createTarget(), {});
  for (const [s, kind] of hints ?? []) {
    if (declared.has(s) || s === index)
      invalid(`the storage hint names "${s}", which is a declared name`);
    // The kernel declares and reports storage buffers only: a texture
    // (`'sampler2D'`) would be read by a helper with no declaration and no
    // binding for the host.
    if (kind !== 'storage-buffer')
      invalid(
        `the storage hint of "${s}" is \`${kind}\`, and a kernel reads a ` +
          `list from a \`'storage-buffer'\` hint only`
      );
  }

  // The free symbols, found as `compile()` sees the expression: after a call
  // of a user function that shadows a library operator is given a private
  // name (`withShadowingCallsRenamed`). A symbol with a value compiles as
  // its value, as in `compile()`, so only a symbol with no value is an
  // input. The type of each input is read from its occurrence: the
  // definition bound when the expression was made, which is the local of
  // the enclosing function when the host hands over the loop of a function
  // body.
  let free: string[];
  const types = new Map<string, Expression['type']>();
  let written: Set<string>;
  try {
    [free, written] = withShadowingCallsRenamed(expr, {}, (renamed) => {
      const target = host.createTarget();
      const analysis: CompileTarget<Expression> = {
        ...target,
        userFunctions: target.userFunctions ?? {
          defs: new Map(),
          compiling: new Set(),
        },
      };
      const occurrences = new Map<string, Expression>();
      const symbols = BaseCompiler.analyzeReferences(
        renamed,
        analysis,
        undefined,
        occurrences
      ).freeSymbols;
      for (const s of symbols)
        types.set(s, (occurrences.get(s) ?? ce.symbol(s)).type);
      return [symbols, addToTargets(renamed)] as const;
    });
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return declined(compileDiagnosticOf(e));
  }

  // The inputs: an accumulator (a free symbol that a `+=` writes), a list
  // with a storage hint, a scalar or a point of the parameter struct.
  const accumulators = new Map<string, Accumulator>();
  const scalars: string[] = [];
  const points = new Map<string, number>();
  for (const s of [...free].sort()) {
    const type = types.get(s)!;
    const t = resolveTypeAlias(type.type);
    const spelled = type.toString();
    // An accumulator and a parameter are both WGSL names of the module: an
    // accumulator is a `var<storage>`, a parameter a field of the struct.
    if (!hints?.has(s)) {
      if (!IDENTIFIER.test(s))
        return unsupported(
          'unsupported-parameter',
          `"${s}" is not a WGSL identifier that starts with a letter, so it ` +
            `cannot be a variable or a field of the kernel.`,
          s
        );
      try {
        gpuCheckIdentifier(s, 'wgsl');
      } catch {
        return unsupported(
          'unsupported-parameter',
          `"${s}" is a reserved word of WGSL.`,
          s
        );
      }
      if (WGSL_PREDECLARED.has(s) || declared.has(s) || s.startsWith('CE_List_'))
        return unsupported(
          'unsupported-parameter',
          `"${s}" is the name of a predeclared function or type of WGSL, ` +
            `of a declaration of the kernel (\`name\`, \`paramsStruct\`, ` +
            `\`paramsVariable\`, \`resultVariable\`) or of a struct of the ` +
            `compilation. Rename it.`,
          s
        );
    }
    if (written.has(s)) {
      if (hints?.has(s))
        return unsupported(
          'unsupported-parameter',
          `"${s}" has a storage hint and the body adds to it with \`+=\`. ` +
            `A storage hint is for a list that the passes only read; an ` +
            `accumulator gets its own buffer.`,
          s
        );
      if (type.matches('integer')) {
        accumulators.set(s, { kind: 'scalar', ceType: spelled });
        continue;
      }
      if (
        typeof t !== 'string' &&
        t.kind === 'list' &&
        (t.dimensions === undefined ||
          t.dimensions === null ||
          t.dimensions.length === 1) &&
        type.matches('list<integer>')
      ) {
        const n = t.dimensions?.[0];
        accumulators.set(s, {
          kind: 'list',
          ceType: spelled,
          ...(n !== undefined && n > 0 ? { length: n } : {}),
        });
        continue;
      }
      return unsupported(
        'unsupported-parameter',
        `the body adds to "${s}" with \`+=\`, and "${s}" has the type ` +
          `\`${spelled}\`. The GPU adds atomically only to integers, so an ` +
          `accumulator is an \`integer\` or a \`list<integer>\`. Declare ` +
          `"${s}" with such a type.`,
        s
      );
    }
    if (hints?.has(s)) continue;
    if (typeof t !== 'string' && t.kind === 'list')
      return unsupported(
        'unsupported-parameter',
        `the passes read the list "${s}" (type \`${spelled}\`). A list that ` +
          `the passes read is a storage buffer: ` +
          `\`storage: { ${s}: { kind: 'storage-buffer', group, binding } }\`.`,
        s
      );
    if (typeof t !== 'string' && t.kind === 'tuple') {
      const n = pointComponentCount(t);
      if (n === undefined)
        return unsupported(
          'unsupported-parameter',
          `"${s}" has the type \`${spelled}\`, and only a point of 2, 3 or 4 ` +
            `real numbers can be a field of the parameter struct.`,
          s
        );
      points.set(s, n);
      continue;
    }
    if (
      type.matches('boolean') ||
      type.matches('string') ||
      type.matches('character') ||
      isNonRealNumber(type.type) ||
      !type.matches('number')
    )
      return unsupported(
        'unsupported-parameter',
        `"${s}" has the type \`${spelled}\`, and a field of the parameter ` +
          `struct is a real or integer scalar or a point.`,
        s
      );
    scalars.push(s);
  }

  // The bounds of the range: an integer literal, or an integer parameter,
  // so that the host counts the invocations from the values it writes.
  const bounds: Array<number | string> = [];
  for (const [i, b] of domain.ops.entries()) {
    const which = i === 0 ? 'lower' : 'upper';
    // An integer literal, or a symbol with an integer value (`N := 100`),
    // which the compilation writes as that value.
    if (
      (isNumber(b) || (isSymbol(b) && !free.includes(b.symbol))) &&
      Number.isInteger(b.re)
    ) {
      bounds.push(b.re);
      continue;
    }
    if (isSymbol(b) && scalars.includes(b.symbol)) {
      if (!types.get(b.symbol)!.matches('integer'))
        return unsupported(
          'unsupported-parameter',
          `the ${which} bound "${b.symbol}" of the range has the type ` +
            `\`${types.get(b.symbol)!.toString()}\`. Declare it ` +
            `\`integer\`: the host counts the invocations from its value.`,
          b.symbol
        );
      bounds.push(b.symbol);
      continue;
    }
    return unsupported(
      'compile-error',
      `the ${which} bound of the range is \`${b.toString()}\`, and a bound ` +
        `of the range of a kernel is an integer literal, a symbol with an ` +
        `integer value, or a parameter declared \`integer\`, so that the ` +
        `host counts the invocations. Assign the bound to a variable ` +
        `before the loop.`
    );
  }

  // The compilation. A parameter is read from its field of the struct. An
  // accumulator is in storage that only `compileAddTo` writes: a read of it
  // by position calls `storageRead`, which declines, and every other
  // reference to a symbol in such storage declines in `compile()`.
  const vars: Record<string, string> = {};
  for (const p of [...scalars, ...points.keys()])
    vars[p] = `${paramsVariable}.${p}`;
  for (const a of accumulators.keys()) vars[a] = a;
  const accumulatorRead = (symbol: string): never => {
    throw hookError(
      `a pass reads the accumulator "${symbol}", which the passes add to ` +
        `with \`+=\`. The passes run in parallel, so the value of an ` +
        `accumulator during the loop is not defined. Read it after the loop.`
    );
  };
  const helpersUsed = new Set<string>();
  let passes = 0;
  let resultElement: string | undefined;
  const extension: GPUTargetExtension = {
    storage: new Map(
      [...accumulators.keys()].map((a) => [a, 'uniform-struct'])
    ),
    storageRead: (symbol) => accumulatorRead(symbol),
    hostInputVars: new Set([...scalars, ...points.keys()]),
    onReturn: () => {
      throw hookError(
        `a \`Return\` leaves the pass. A pass of a parallel loop has no ` +
          `value; end the body with the last statement instead.`
      );
    },
    kernel: {
      compilePass: (args, target) => {
        // The root is the only parallel loop of the kernel: a second one
        // is a loop inside a pass (checked before the compilation too).
        if (passes++ > 0)
          throw hookError(
            `a \`parallel for\` loop or comprehension inside the pass is not ` +
              `compiled. A kernel runs one parallel loop; write the inner ` +
              `one as a \`for\` loop.`
          );
        const [passBody, passClause] = args;
        if (!isFunction(passClause) || !isFunction(passClause.ops[1]))
          throw hookError(
            `the clause \`${passClause.toString()}\` is not the clause ` +
              `that was checked before the compilation.`
          );
        const [lo, hi] = passClause.ops[1].ops;
        // A bound is an integer literal, or a symbol with an integer value,
        // written as that integer, or a parameter, read from its `f32`
        // field.
        const boundCode = (b: Expression): string => {
          if (isNumber(b)) return `${b.re}`;
          const compiled = BaseCompiler.compile(b, target);
          const value = numericLiteralSource(compiled);
          return value !== undefined && Number.isInteger(value)
            ? `${value}`
            : `i32(${compiled})`;
        };
        const lower = boundCode(lo);
        const upper = boundCode(hi);
        // The index is a shader integer, read as a float by the body, as
        // the index of a `Loop` is.
        const bodyTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? `f32(${index})` : target.var(id)),
          ...BaseCompiler.withBoundScope(target, [index]),
        };
        let inner: string;
        if (isLoop) {
          // A statement list, as the body of a `Loop`. No jump is admitted
          // at the level of the pass: a `Break` or a `Continue` there
          // declines, and a loop of the body admits its own.
          inner = BaseCompiler.compileStatementList(passBody, bodyTarget);
        } else {
          // The element of the comprehension: a real scalar or a point,
          // stored at the position of the pass.
          const element = gpuTypeOfValue(passBody, true);
          if (!['f32', 'vec2f', 'vec3f', 'vec4f'].includes(element ?? ''))
            throw hookError(
              `the element of the comprehension ` +
                (element === undefined
                  ? 'has no static WGSL type'
                  : `has the WGSL type \`${element}\``) +
                `, and the result buffer holds real scalars or points.`
            );
          resultElement = element;
          const lines = BaseCompiler.compileListStatement(
            bodyTarget,
            passBody,
            (t) => [BaseCompiler.compile(passBody, t)]
          );
          const value = lines.pop()!;
          inner = [
            ...lines.map(terminated),
            `${resultVariable}.data[${INVOCATION}.x] = ${value};`,
          ].join('\n');
        }
        // The guard of the clause that the hook receives: the tree that
        // `compile()` sees, after a call of a user function that shadows a
        // library operator got its private name.
        const passGuard = passClause.ops[2];
        if (passGuard !== undefined && !isSymbol(passGuard, 'Nothing')) {
          const test = BaseCompiler.compile(passGuard, bodyTarget);
          inner = `if (${test}) {\n${indent(inner)}\n}`;
        }
        return [
          `let ${index}: i32 = ${lower} + i32(${INVOCATION}.x);`,
          `if (${index} <= ${upper}) {`,
          indent(inner),
          '}',
        ].join('\n');
      },
      compileAddTo: (args, compile, target) => {
        const [t, v] = args;
        let symbol: string;
        let positions: ReadonlyArray<Expression>;
        if (isSymbol(t)) {
          symbol = t.symbol;
          positions = [];
        } else if (isFunction(t, 'At') && isSymbol(t.op1)) {
          symbol = t.op1.symbol;
          positions = t.ops.slice(1);
        } else
          throw hookError(
            `the target of \`+=\`, \`${t.toString()}\`, is not a variable ` +
              `or an element of a list (\`L[i]\`).`
          );
        const accumulator = accumulators.get(symbol);
        if (accumulator === undefined || gpuIsBoundName(symbol, target))
          throw hookError(
            `"${symbol}" is a local of the pass, and \`+=\` to a local is ` +
              `compiled only on the JavaScript target. An accumulator is a ` +
              `variable of the program around the loop.`
          );
        if (!v.type.matches('integer'))
          throw hookError(
            `"${symbol}" is an accumulator of integers, and the amount ` +
              `\`${v.toString()}\` of \`+=\` has the type ` +
              `\`${v.type.toString()}\`. The GPU adds atomically only to ` +
              `integers.`
          );
        if (accumulator.kind === 'scalar') {
          if (positions.length > 0)
            throw hookError(
              `"${symbol}" is an integer, and \`+=\` indexes it as a list.`
            );
          return `atomicAdd(&${symbol}, i32(${compile(v)}))`;
        }
        if (positions.length !== 1)
          throw hookError(
            `"${symbol}" is a list of integers, and \`+=\` gives ` +
              `${positions.length} positions. One position selects an ` +
              `element.`
          );
        helpersUsed.add(symbol);
        return `${accumulatorHelperName(symbol)}(${compile(positions[0])}, ${compile(v)})`;
      },
    },
  };
  let result: CompilationResult;
  try {
    result = host.withTargetExtension(extension, () =>
      host.compile(expr, { vars, storage, constantFold, fallback: false })
    );
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return declined(compileDiagnosticOf(e));
  }
  if (!result.success)
    return declined(
      result.diagnostic ??
        compileDiagnosticOf(result.error ?? 'Compilation failed')
    );
  const code = result.code;

  // Every input that the compiled code reads must be a parameter, an
  // accumulator or the storage buffer of a hint.
  for (const s of result.freeSymbols ?? [])
    if (!Object.hasOwn(vars, s) && !hints?.has(s))
      return unsupported(
        'compile-error',
        `the compiled code reads "${s}", which is not a parameter, an ` +
          `accumulator or a storage buffer of the kernel.`,
        s
      );
  // A read of an accumulator declines in `compile()`, also in the body of a
  // user-defined function, which compiles with the same hooks; this check
  // is for a reference that took another route to the statements of the
  // pass. There, the only references to an accumulator are the calls of
  // its helper (`_gpu_kadd_L(`) and the atomic addition to a scalar
  // (`&s`). The preamble is not scanned: the parameters and the comments
  // of the helpers use short names (`x`, `s`, "counts").
  for (const a of accumulators.keys())
    if (new RegExp(`(?<![\\w$.&])${a}(?![\\w$])`).test(code))
      return unsupported(
        'compile-error',
        `a pass reads the accumulator "${a}", which the passes add to with ` +
          `\`+=\`. The passes run in parallel, so the value of an ` +
          `accumulator during the loop is not defined. Read it after the ` +
          `loop.`,
        a
      );

  // The parameter struct: the scalars, then the points, each group in
  // name order, with the alignment rules of the uniform address space
  // (`compileFieldFunction()` has the same layout). A parameter that the
  // code does not read is not a field, except a bound of the range, which
  // the host reads to count the invocations.
  const used = new Set([
    ...(result.freeSymbols ?? []),
    ...bounds.filter((b): b is string => typeof b === 'string'),
  ]);
  const params: FieldFunctionParameter[] = [];
  let offset = 0;
  for (const p of scalars) {
    if (!used.has(p)) continue;
    params.push({
      name: p,
      ceType: types.get(p)!.toString(),
      wgslType: 'f32',
      offset,
      size: 4,
    });
    offset += 4;
  }
  for (const [p, n] of points) {
    if (!used.has(p)) continue;
    offset = roundUp(n === 2 ? 8 : 16, offset);
    params.push({
      name: p,
      ceType: types.get(p)!.toString(),
      wgslType: `vec${n}f`,
      offset,
      size: 4 * n,
    });
    offset += 4 * n;
  }
  const paramsSize = roundUp(16, offset);
  const paramsStructSource =
    params.length === 0
      ? ''
      : `struct ${paramsStruct} {\n${params
          .map((p) => `  ${p.name}: ${p.wgslType},\n`)
          .join('')}}\n`;

  // The bindings, in `group`: the parameters first, then the accumulators
  // in name order, then the result, each at the smallest binding that no
  // storage hint of the group takes.
  const taken = new Set<number>();
  for (const hint of Object.values(storage ?? {}))
    if (
      typeof hint === 'object' &&
      hint.kind === 'storage-buffer' &&
      hint.group === group
    )
      taken.add(hint.binding);
  const nextBinding = (): number => {
    let b = 0;
    while (taken.has(b)) b += 1;
    taken.add(b);
    return b;
  };
  const bindings: KernelBinding[] = [];
  let declarations = '';
  if (params.length > 0) {
    const binding = nextBinding();
    bindings.push({
      kind: 'parameters',
      symbol: paramsVariable,
      name: paramsVariable,
      group,
      binding,
      wgslType: paramsStruct,
      minBindingSize: paramsSize,
    });
    declarations +=
      `${paramsStructSource}@group(${group}) @binding(${binding}) ` +
      `var<uniform> ${paramsVariable}: ${paramsStruct};\n`;
  }
  let helpers = '';
  if ([...accumulators.values()].some((a) => a.kind === 'list'))
    declarations += `struct ${KERNEL_ACCUMULATOR_STRUCT} { len: u32, data: array<atomic<i32>> }\n`;
  for (const [a, accumulator] of accumulators) {
    const binding = nextBinding();
    const isList = accumulator.kind === 'list';
    const wgslType = isList ? KERNEL_ACCUMULATOR_STRUCT : 'atomic<i32>';
    bindings.push({
      kind: 'accumulator',
      symbol: a,
      name: a,
      group,
      binding,
      wgslType,
      ceType: accumulator.ceType,
      ...(isList ? { dataOffset: 4, stride: 4 } : {}),
      ...(accumulator.length !== undefined
        ? { length: accumulator.length }
        : {}),
      minBindingSize: isList ? 8 : 4,
    });
    declarations += `@group(${group}) @binding(${binding}) var<storage, read_write> ${a}: ${wgslType};\n`;
    if (helpersUsed.has(a)) helpers += accumulatorHelperSource(a);
  }
  for (const layout of result.storageBuffers ?? [])
    bindings.push({
      kind: 'list',
      symbol: layout.symbol,
      name: layout.name,
      group: layout.group,
      binding: layout.binding,
      wgslType: layout.struct,
      ceType: types.get(layout.symbol)?.toString(),
      dataOffset: layout.dataOffset,
      stride: layout.stride,
      minBindingSize: layout.minBindingSize,
    });
  if (!isLoop) {
    const element = resultElement ?? 'f32';
    const struct = `CE_List_${element}`;
    const align = element === 'f32' ? 4 : element === 'vec2f' ? 8 : 16;
    const binding = nextBinding();
    bindings.push({
      kind: 'result',
      symbol: resultVariable,
      name: resultVariable,
      group,
      binding,
      wgslType: struct,
      ceType: expr.type.toString(),
      dataOffset: align,
      stride: align,
      minBindingSize: 2 * align,
    });
    // The struct of the result is the struct of a storage-buffer list of
    // the same element, which a hint may have declared already.
    if (!(result.storageBuffers ?? []).some((l) => l.struct === struct))
      declarations += `struct ${struct} { len: u32, data: array<${element}> }\n`;
    declarations += `@group(${group}) @binding(${binding}) var<storage, read_write> ${resultVariable}: ${struct};\n`;
  }

  // The module. The declarations of the storage buffers of the hints come
  // from their layouts; the helpers that the pass and the accumulator
  // helpers call (`_gpu_isnonfinite`, the readers of the storage buffers,
  // the user-defined functions) from the preamble of the text. WGSL
  // accepts module-scope declarations in any order.
  const storageDeclarations =
    result.storageBuffers === undefined
      ? ''
      : storageBufferDeclarations(result.storageBuffers).trimStart();
  const shared = host.preambleFor(`${code}\n${helpers}`);
  const entry =
    `@compute @workgroup_size(${workgroupSize})\n` +
    `fn ${name}(@builtin(global_invocation_id) ${INVOCATION}: vec3u) {\n` +
    `${indent(code)}\n}\n`;
  const module = [storageDeclarations, declarations, shared, helpers, entry]
    .filter((part) => part !== '')
    .join('\n');

  const out: KernelResult = {
    success: true,
    code: module,
    entryPoint: name,
    workgroupSize,
    bindings,
    range: { lower: bounds[0], upper: bounds[1] },
    params,
    paramsSize,
    paramsStructSource,
  };
  if (result.warnings !== undefined) out.warnings = result.warnings;
  return out;
}
