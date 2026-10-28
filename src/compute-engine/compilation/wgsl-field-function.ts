/**
 * `WGSLTarget.compileFieldFunction()`: a scalar field function that a host
 * compute shader calls over a grid, with its helper functions by name and the
 * layout of one uniform struct that holds its parameters.
 *
 * The function is compiled by the `compile()` of the WGSL target, so every
 * expression that `compile(expr, { to: 'wgsl' })` declines is declined here
 * with the same diagnostic. Two compilation facts that the public options
 * cannot carry are given to it through `withTargetExtension`
 * (`gpu-target.ts`):
 *
 * - each list parameter is a `'uniform-struct'` storage symbol, so that every
 *   positional read of it calls the reader of this file, and every other
 *   reference to it declines;
 * - each scalar parameter, which `vars` maps to the struct field
 *   `<paramsVariable>.<name>`, is a host input of its declared type
 *   (`hostInputVars`). Without this the finite-operand test of the shader
 *   targets accepts only a symbol that `vars` maps to its own name, and it
 *   keeps the NaN guard (`_gpu_sin` in place of `sin`) for an operand that
 *   reads a struct field.
 *
 * Design record: `docs/plans/2026-10-27-tycho-rows-461-463-gpu-design-answers.md`,
 * section "Recommendation for 461" (ROADMAP CE-571).
 */

import type { Expression } from '../global-types.js';
import type {
  CompilationOptions,
  CompilationResult,
  CompileDiagnostic,
  CompileTarget,
  FieldFunctionOptions,
  FieldFunctionParameter,
  FieldFunctionResult,
} from './types.js';
import type { GPUTargetExtension } from './gpu-target.js';
import {
  GPU_NAN_PREAMBLE_WGSL,
  GPU_RANDOM_COUNTER_PREFIX,
  gpuAtIndexGuard,
  gpuCheckIdentifier,
  gpuReachableSymbolNames,
  gpuTypeOfValue,
} from './gpu-target.js';
import { withShadowingCallsRenamed } from './shadowing-calls.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import { WGSL_PREDECLARED } from './wgsl-predeclared.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { isValueDef } from '../boxed-expression/utils.js';
import type { BoxedValueDefinition } from '../types-definitions.js';
import { BaseCompiler } from './base-compiler.js';
import { compileDiagnosticOf } from './diagnostics.js';
import { resolveStorageHints } from './storage-hints.js';
import { formatFloat } from './constant-folding.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { isNonRealNumber, resolveTypeAlias } from '../../common/type/utils.js';

/**
 * The largest number of elements of a list parameter. 1024 elements take
 * 16 KB of the 64 KB that WebGPU guarantees for one uniform buffer binding
 * (`maxUniformBufferBindingSize`), which leaves room for the other
 * parameters.
 */
export const FIELD_FUNCTION_MAX_LIST_LENGTH = 1024;

/**
 * The largest size of the parameter struct, in bytes: the default
 * `maxUniformBufferBindingSize` of the WebGPU specification, the size of a
 * uniform buffer binding that every device supports.
 */
export const FIELD_FUNCTION_MAX_PARAMS_SIZE = 65536;

/** The parts of the WGSL target that this file uses. */
export interface FieldFunctionHost {
  compile(
    expr: Expression,
    options: CompilationOptions<Expression>
  ): CompilationResult;
  createTarget(): CompileTarget<Expression>;
  withTargetExtension<T>(extension: GPUTargetExtension, fn: () => T): T;
  /** The names of the user-defined functions that the last `compile()`
   * emitted (`GPUShaderTarget.emittedUserFunctionNames`). */
  emittedUserFunctionNames(): string[];
  /** Throw when `expr` has no value to return from a WGSL function
   * (`wgslFunctionBodyShape`); the result is given to `assertBody`. */
  bodyShape(expr: Expression): unknown;
  /** Throw when the emitted `body` of `expr` does not end with the
   * `return` of its value (`wgslAssertFunctionBody`). */
  assertBody(expr: Expression, body: string, shape: unknown): void;
}

/** A WGSL identifier that the field function can declare. */
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

function invalid(detail: string): never {
  throw new Error(`Invalid option of compileFieldFunction(): ${detail}`);
}

/** The result of a decline: `success: false` and every other field empty. */
function declined(diagnostic: CompileDiagnostic): FieldFunctionResult {
  return {
    success: false,
    diagnostic,
    function: '',
    helpers: {},
    paramsStructSource: '',
    params: [],
    paramsSize: 0,
  };
}

/** The text that the decline of a parameter adds about longer lists. */
const STORAGE_BUFFER_NOTE =
  'A parameter of a field function is a real or integer scalar, or a ' +
  `numeric list of known length with at most ${FIELD_FUNCTION_MAX_LIST_LENGTH} ` +
  'elements, in the uniform parameter struct. A list of numbers or points ' +
  `of unknown length, or with more than ${FIELD_FUNCTION_MAX_LIST_LENGTH} ` +
  'elements, can be read from a storage buffer instead: ' +
  "`storage: { <name>: { kind: 'storage-buffer', group, binding } }`. " +
  'A storage buffer cannot hold complex numbers, text, booleans or lists ' +
  'of lists either.';

function parameterDecline(name: string, reason: string): FieldFunctionResult {
  return declined({
    code: 'unsupported-parameter',
    kind: 'capability',
    message:
      `Could not compile with \`compileFieldFunction()\`: the parameter ` +
      `"${name}" ${reason}. ${STORAGE_BUFFER_NOTE}`,
    binding: name,
  });
}

/**
 * The name of the reader of element i of the list parameter `field` of `n`
 * elements, in the struct variable `variable`. The name gives the length,
 * the variable and the field, so it always has the same source text. The
 * length of the variable name is part of it: without it, the variable
 * `a_b` with the field `c` and the variable `a` with the field `b_c` would
 * have one name.
 */
function listReaderName(variable: string, field: string, n: number): string {
  return `_gpu_pat${n}_${variable.length}_${variable}_${field}`;
}

/**
 * The reader of element i (1-based, as a float) of a list of `n` elements
 * packed as `array<vec4f, ⌈n/4⌉>` in `<variable>.<field>`: element i is the
 * component (i − 1) mod 4 of the entry ⌊(i − 1)/4⌋. The index rules are the
 * rules of `At`, with the guard text of the other positional readers
 * (`gpuAtIndexGuard`): a negative index counts from the end, and 0, a
 * non-integer, an index out of range, NaN and ±∞ give NaN.
 *
 * The slot is computed in float space: it is an integer below 1024, so each
 * step is exact in f32, and the only integer conversions are the two array
 * indices. The reader indexes the uniform variable itself. A copy of the
 * array into a function variable is not made: a large array would exceed
 * the function-scope memory that WGSL guarantees.
 */
function listReaderSource(variable: string, field: string, n: number): string {
  const { guard, doc } = gpuAtIndexGuard(n, 'wgsl', '_gpu_i');
  const count = formatFloat(n, 'wgsl');
  return `fn ${listReaderName(variable, field, n)}(_gpu_i: f32) -> f32 {
${doc}
  if (${guard}) {
    return _gpu_nan();
  }
  let _gpu_s = select(${count} + _gpu_i, _gpu_i - 1.0, _gpu_i > 0.0);
  let _gpu_e = floor(_gpu_s / 4.0);
  return ${variable}.${field}[i32(_gpu_e)][i32(_gpu_s - 4.0 * _gpu_e)];
}
`;
}

/**
 * The top-level declarations of the WGSL text `src`, by name. A declaration
 * is a `fn`, `struct`, `var`, `const`, `override` or `alias` item, with its
 * attributes (`@group(1) @binding(0) var<storage, read> S: …;` is named
 * `S`) and the comment lines that precede it. A `fn` or `struct` item ends at the brace
 * that closes its first brace; another item ends at its `;`.
 */
export function wgslDeclarationsByName(src: string): Map<string, string> {
  const result = new Map<string, string>();
  let i = 0;
  let pending = '';
  const n = src.length;
  while (i < n) {
    // White space between items.
    while (i < n && /\s/.test(src[i])) i++;
    if (i >= n) break;
    // A comment line before a declaration is kept with it.
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end + 1;
      pending += src.slice(i, stop);
      i = stop;
      continue;
    }
    const start = i;
    let depth = 0;
    let braced = false;
    for (; i < n; i++) {
      if (src.startsWith('//', i)) {
        const end = src.indexOf('\n', i);
        i = end < 0 ? n - 1 : end;
        continue;
      }
      const ch = src[i];
      if (ch === '{') {
        depth++;
        braced = true;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && braced) {
          i++;
          break;
        }
      } else if (ch === ';' && depth === 0 && !braced) {
        i++;
        break;
      }
    }
    const item = src.slice(start, i);
    const m =
      /^(?:@\w+(?:\([^)]*\))?\s+)*(?:fn|struct|const|override|alias|var(?:<[^>]*>)?)\s+([A-Za-z_]\w*)/.exec(
        item
      );
    if (m === null)
      throw new Error(
        `Internal: compileFieldFunction() cannot read the helper text ` +
          `\`${item.slice(0, 60)}\``
      );
    result.set(m[1], `${pending}${item.trim()}\n`);
    pending = '';
  }
  return result;
}

/** Round `value` up to a multiple of `alignment`. */
function roundUp(alignment: number, value: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * Run `fn` (the compilation of a field function) with the value of each
 * coordinate and parameter in `names` whose type was INFERRED from its value
 * hidden, with the facts that the value gives, and restore the definitions
 * exactly after.
 *
 * `withVarsValuesHidden()` (`vars-inputs.ts`) hides the value of a `vars`
 * symbol with a DECLARED type only. A symbol whose type was inferred from its
 * value (`ce.assign('a', 5)`, no declaration) keeps its value and its type
 * `finite_integer`, so the compilation reads facts that the value gives: the
 * sign of 5 lets `|a|` compile to `ce_params.a`, which gives -5 when the
 * host writes -5. A field function reads such a symbol from the buffer, so
 * the facts must not reach the compilation.
 *
 * While `fn` runs, each such definition has no value, and its type is the
 * type that the value gives with no fact about the value: `real` for a real
 * number, `list<real^n>` for a list of n real numbers. Any other value keeps
 * its type (a complex value then declines as a parameter). The type stays
 * marked as inferred, so the finite-operand test of the shader targets does
 * not take it as a promise of the host. The definition is restored from a
 * snapshot of all its fields (`_checkpointSnapshot`), so that a type that a
 * use narrows during the compilation does not outlive it. A `value-write`
 * and a `type-write` event are reported after the restore, so that nothing
 * cached during the compilation is served after it.
 */
function withInferredValuesHidden<T>(
  ce: Expression['engine'],
  names: Iterable<string>,
  fn: () => T
): T {
  const hidden: Array<{
    def: BoxedValueDefinition;
    snapshot: unknown;
  }> = [];
  try {
    for (const name of names) {
      const def = ce.lookupDefinition(name);
      if (!isValueDef(def)) continue;
      const v = def.value;
      if (v.isConstant || !v.inferredType) continue;
      const stored = v.storedValue;
      if (stored === undefined || stored.operator === 'Function') continue;
      const t = resolveTypeAlias(stored.type.type);
      const n =
        typeof t !== 'string' && t.kind === 'list' && t.dimensions?.length === 1
          ? t.dimensions[0]
          : undefined;
      const type = stored.type.matches('real')
        ? 'real'
        : n !== undefined && n > 0 && stored.type.matches('list<real>')
          ? `list<real^${n}>`
          : stored.type.type;
      hidden.push({ def: v, snapshot: v._checkpointSnapshot() });
      v.value = undefined;
      v.type = ce.type(type);
    }
    return fn();
  } finally {
    for (const { def, snapshot } of hidden.reverse())
      def._restoreCheckpointSnapshot(snapshot);
    if (hidden.length > 0) {
      ce._noteStateEvent({
        kind: 'value-write',
        ephemeral: false,
        callable: false,
      });
      ce._noteStateEvent({
        kind: 'type-write',
        callableBefore: false,
        callableAfter: false,
      });
    }
  }
}

/**
 * The parameter names and the local names (`let`, `var`, a loop variable)
 * that the WGSL function declaration `source` declares.
 */
function declaredNames(source: string): Set<string> {
  const names = new Set<string>();
  const signature = /^\s*(?:\/\/[^\n]*\n\s*)*fn\s+\w+\s*\(([^)]*)\)/.exec(
    source
  );
  for (const m of (signature?.[1] ?? '').matchAll(/([A-Za-z_]\w*)\s*:/g))
    names.add(m[1]);
  for (const m of source.matchAll(/\b(?:let|var)\s+([A-Za-z_]\w*)/g))
    names.add(m[1]);
  return names;
}

/**
 * The targets of the `Assign` statements in `expr` that are symbols. A
 * function literal is not entered: its body is a separate scope.
 */
function assignedSymbols(expr: Expression): Set<string> {
  const out = new Set<string>();
  // An expression is a graph that can share a node between many parents, so
  // a node is visited once (as `analyzeReferences()` does): a walk of the
  // tree that it unfolds to can take an exponential time.
  const visited = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (!isFunction(e) || visited.has(e)) return;
    visited.add(e);
    if (e.operator === 'Function') return;
    if (e.operator === 'Assign' && isSymbol(e.ops[0])) out.add(e.ops[0].symbol);
    for (const op of e.ops) walk(op);
  };
  walk(expr);
  return out;
}

/**
 * Compile `expr` to a WGSL field function. See
 * `WGSLTarget.compileFieldFunction()` for the contract.
 */
export function compileWGSLFieldFunction(
  host: FieldFunctionHost,
  expr: Expression,
  options: FieldFunctionOptions
): FieldFunctionResult {
  // The options. A wrong option is an error of the caller, thrown, as an
  // unknown `mode` or storage kind is thrown by `compile()`.
  const {
    name,
    coordinates,
    paramsStruct = 'CEParams',
    paramsVariable = 'ce_params',
    storage,
    constantFold,
  } = options;
  const identifiers: Array<[string, unknown]> = [
    ['name', name],
    ['paramsStruct', paramsStruct],
    ['paramsVariable', paramsVariable],
  ];
  if (!Array.isArray(coordinates))
    invalid('`coordinates` must be an array of symbol names');
  coordinates.forEach((c, k) => identifiers.push([`coordinates[${k}]`, c]));
  const declared = new Set<string>();
  for (const [option, value] of identifiers) {
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
    // The structs of the storage buffers are named `CE_List_<element type>`,
    // and a WGSL module cannot declare a struct and another declaration
    // with one name (`gpuStorageBufferOperand()` in `gpu-target.ts`).
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
  // The storage hints, validated as `compile()` validates them. A hint that
  // names a coordinate is refused: a coordinate is a function argument. A
  // hint that names one of the declared names is refused: the host declares
  // the storage under the name of the symbol.
  const coordinateSet = new Set(coordinates);
  const vars: Record<string, string> = {};
  for (const c of coordinates) vars[c] = c;
  const hints = resolveStorageHints(storage, [expr], host.createTarget(), {
    vars,
  });
  for (const h of hints?.keys() ?? []) {
    if (coordinateSet.has(h))
      invalid(`the storage hint names the coordinate "${h}"`);
    if (declared.has(h))
      invalid(`the storage hint names "${h}", which is a declared name`);
  }

  const ce = expr.engine;
  // The body must have a value to return (the check of
  // `WGSLTarget.compileFunction()`).
  let bodyShape: unknown;
  try {
    bodyShape = host.bodyShape(expr);
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return declined(compileDiagnosticOf(e));
  }

  // The parameters, found as `compile()` sees the expression: after a call
  // of a user function that shadows a library operator (a user `Gamma`) is
  // given a private name (`withShadowingCallsRenamed`), so that the free
  // symbols of its body are found.
  //
  // A symbol with a value is a parameter too, unless it is a constant (`Pi`,
  // or a symbol declared constant), or its value is a function: a value
  // that the host changes must be a buffer write, not new WGSL text. Its
  // value in the engine is not read: `vars` hides it (`withVarsValuesHidden`
  // and `withInferredValuesHidden`). The candidates are given to the
  // reference analysis as `vars` keys, and the analysis reports only the
  // occurrences that no binding of the expression covers: with `a := 5` and
  // `h(a) := a + 1`, the `a` of `a + h(x)` is a parameter, and the parameter
  // `a` of `h` stays the parameter of `h`.
  const discovery = withShadowingCallsRenamed(expr, { vars }, (renamed) => {
    const reachable = gpuReachableSymbolNames(renamed, vars);
    const valued: string[] = [];
    for (const s of reachable.all) {
      if (coordinateSet.has(s) || hints?.has(s)) continue;
      const def = ce.lookupDefinition(s);
      if (!isValueDef(def) || def.value.isConstant) continue;
      const value = def.value.value;
      if (value === undefined || isFunction(value, 'Function')) continue;
      if (value.type.matches('function')) continue;
      valued.push(s);
    }
    const target = host.createTarget();
    const analysis: CompileTarget<Expression> = {
      ...target,
      userFunctions: target.userFunctions ?? {
        defs: new Map(),
        compiling: new Set(),
      },
    };
    const occurrences = new Map<string, Expression>();
    const free = BaseCompiler.analyzeReferences(
      renamed,
      analysis,
      new Set([...coordinates, ...valued]),
      occurrences
    ).freeSymbols;
    // The type of each free symbol is read from its occurrence in the
    // expression: the definition bound when the expression was made, which
    // can differ from the definition of the name in the current scope. A
    // symbol that occurs only in the body of a user function has the type
    // of its definition in the current scope, which is the scope the
    // compilation reads that body in.
    const types = new Map(
      free.map((s) => [s, (occurrences.get(s) ?? ce.symbol(s)).type])
    );
    // The coordinates that a user-defined function reads without taking
    // them as parameters. A user-defined function is declared at module
    // scope, where the coordinates do not exist. Each reachable user-defined
    // function is analyzed on its own: the reference analysis of its literal
    // binds its own parameters and the variables of its inner scopes (a
    // `Sum` index). The analysis target has no user-function registry, so
    // the analysis does not follow the functions that the body calls: it
    // would read their bodies with the parameters of the caller bound
    // (`h(x) := g(x)` would hide the free `x` of `g(t) := t + x`). The walk
    // below reaches each called function instead.
    const captures: Array<[string, string]> = [];
    const seen = new Set<string>();
    const visitName = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      let literal: Expression | undefined;
      try {
        literal = BaseCompiler.userFunctionLiteral(ce, id);
      } catch {
        literal = undefined;
      }
      if (literal === undefined) return;
      for (const s of BaseCompiler.analyzeReferences(
        literal,
        target,
        coordinateSet
      ).freeSymbols)
        if (coordinateSet.has(s)) captures.push([id, s]);
      visit(literal);
    };
    // Each node is visited once: a node can have many parents
    // (`assignedSymbols`).
    const visitedNodes = new Set<Expression>();
    const visit = (e: Expression): void => {
      if (visitedNodes.has(e)) return;
      visitedNodes.add(e);
      if (isSymbol(e)) visitName(e.symbol);
      else if (isFunction(e)) {
        visitName(e.operator);
        for (const op of e.ops) visit(op);
      }
    };
    visit(renamed);
    return { free, types, assigned: assignedSymbols(renamed), captures };
  });

  // A body that assigns a coordinate or a parameter declines: a field
  // function cannot write its inputs. A local is declared first
  // (`Declare(s, "real")`), and then it is not a free symbol.
  for (const s of discovery.assigned)
    if (coordinateSet.has(s) || (discovery.free.includes(s) && !hints?.has(s)))
      return declined({
        code: 'unsupported-parameter',
        kind: 'capability',
        message:
          `Could not compile with \`compileFieldFunction()\`: the body assigns ` +
          `"${s}", which is ${coordinateSet.has(s) ? 'a coordinate' : 'a parameter'} ` +
          `of the field function, and a field function cannot write its ` +
          `inputs. Declare a local first (\`Declare(${s}, "real")\`), or ` +
          `assign another name.`,
        binding: s,
      });

  // A user-defined function that reads a coordinate it does not take as a
  // parameter (`h(t) := t + x` called as `h(y)`) declines: its declaration
  // is outside the field function, where the coordinate does not exist.
  const capture = discovery.captures[0];
  if (capture !== undefined) {
    const [fn, c] = capture;
    return declined({
      code: 'unsupported-parameter',
      kind: 'capability',
      message:
        `Could not compile with \`compileFieldFunction()\`: the user-defined ` +
        `function "${fn}" reads the coordinate "${c}", which it does not take ` +
        `as a parameter. A coordinate is an argument of the field function, ` +
        `and a user-defined function is declared outside it. Pass "${c}" to ` +
        `the function as an argument.`,
      binding: c,
    });
  }

  // The parameters: each free symbol that is not a coordinate and has no
  // storage hint. A list parameter must be known now, to place it in
  // storage before the compilation.
  const scalars: string[] = [];
  const lists = new Map<string, { n: number; ceType: string }>();
  for (const p of [...discovery.free].sort()) {
    if (coordinateSet.has(p) || hints?.has(p)) continue;
    if (!IDENTIFIER.test(p))
      return parameterDecline(
        p,
        'is not a WGSL identifier, so it cannot be a field of the parameter struct'
      );
    try {
      gpuCheckIdentifier(p, 'wgsl');
    } catch {
      return parameterDecline(p, `is a reserved word of WGSL`);
    }
    const type = discovery.types.get(p)!;
    const t = resolveTypeAlias(type.type);
    if (typeof t !== 'string' && t.kind === 'list') {
      const spelled = type.toString();
      const dims = t.dimensions;
      if (dims === null || dims === undefined || dims.length !== 1)
        return parameterDecline(
          p,
          `has the type \`${spelled}\`, a list with no known length or with ` +
            `more than one axis`
        );
      const n = dims[0];
      if (n < 1)
        return parameterDecline(
          p,
          `has the type \`${spelled}\`, a list with no known length or with ` +
            `no element`
        );
      if (n > FIELD_FUNCTION_MAX_LIST_LENGTH)
        return parameterDecline(
          p,
          `is a list of ${n} elements, more than the limit of ` +
            `${FIELD_FUNCTION_MAX_LIST_LENGTH} of the parameter struct`
        );
      if (!type.matches('list<real>') && !type.matches('list<number>'))
        return parameterDecline(
          p,
          `has the type \`${spelled}\`, and only a list of real numbers can be ` +
            `a field of the parameter struct`
        );
      if (isNonRealNumber(t.elements))
        return parameterDecline(
          p,
          `has the type \`${spelled}\`, a list of complex numbers`
        );
      lists.set(p, { n, ceType: spelled });
      continue;
    }
    if (type.matches('boolean')) return parameterDecline(p, 'is a boolean');
    if (type.matches('string') || type.matches('character'))
      return parameterDecline(p, 'is text');
    if (typeof t !== 'string' && isNonRealNumber(t))
      return parameterDecline(p, 'is a complex number');
    if (isNonRealNumber(type.type))
      return parameterDecline(p, 'is a complex number');
    scalars.push(p);
  }

  // The compilation. A parameter is read from its field of the struct.
  for (const p of [...scalars, ...lists.keys()])
    vars[p] = `${paramsVariable}.${p}`;
  const readers = new Map<string, string>();
  const extension: GPUTargetExtension = {
    storage: new Map([...lists.keys()].map((p) => [p, 'uniform-struct'])),
    storageRead: (symbol, n, index) => {
      // The length of the read is the length of the type of the operand
      // that the compilation sees. It must be the length of the field.
      const field = lists.get(symbol);
      if (field === undefined || field.n !== n)
        throw new Error(
          `Could not compile with \`compileFieldFunction()\`: the list ` +
            `parameter "${symbol}" is read as a list of ${n} elements, but ` +
            `its field in the parameter struct has ` +
            `${field?.n ?? 'no'} elements.`
        );
      const reader = listReaderName(paramsVariable, symbol, n);
      if (!readers.has(reader))
        readers.set(reader, listReaderSource(paramsVariable, symbol, n));
      return `${reader}(${index})`;
    },
    hostInputVars: new Set(scalars),
    // Each `Return` of the body leaves the field function, which returns
    // `f32`. The check runs while the local frames of the body are active
    // (`CompileTarget.onReturn`), so a `Return` of a block local reads the
    // type of that local. The body of a user-defined function has its own
    // check, against its own return type.
    onReturn: (value) => {
      const t = value === undefined ? undefined : gpuTypeOfValue(value, true);
      if (t === 'f32') return;
      throw new Error(
        `Could not compile with \`compileFieldFunction()\`: a \`Return\` in ` +
          `the body yields ` +
          (t === undefined
            ? 'a value with no static WGSL type'
            : `a \`${t}\` value`) +
          `, and a field function returns a real scalar (\`f32\`).`
      );
    },
  };
  let result: CompilationResult;
  let userNames: string[];
  let resultType: string | undefined;
  try {
    // One bracket for the compilation and the check of the result type:
    // the value of each coordinate and each parameter (the keys of `vars`),
    // and the facts that it gives, are hidden in both. A declared symbol is
    // hidden by `withVarsValuesHidden()`, which `compile()` also calls (it
    // then finds nothing more to hide), and an inferred one by
    // `withInferredValuesHidden()`. Without the outer bracket, `compile()`
    // restores a declared value before the type check, and `√a` with
    // `a := -5` compiles to `sqrt(ce_params.a)` and then reads as complex.
    result = withVarsValuesHidden(expr, vars, () =>
      withInferredValuesHidden(ce, Object.keys(vars), () => {
        const compiled = host.withTargetExtension(extension, () =>
          host.compile(expr, {
            vars,
            storage,
            constantFold,
            fallback: false,
          })
        );
        resultType = gpuTypeOfValue(expr, true);
        return compiled;
      })
    );
    userNames = host.emittedUserFunctionNames();
    if (result.success) host.assertBody(expr, result.code, bodyShape);
  } catch (e) {
    throwIfCallerCancellation(e, ce._deadlineFrame);
    return declined(compileDiagnosticOf(e));
  }
  if (!result.success)
    return declined(
      result.diagnostic ??
        compileDiagnosticOf(result.error ?? 'Compilation failed')
    );

  // The result must be a real scalar: the function returns `f32`. Asked
  // after the compilation, so that an expression that `compile()` declines
  // gets the diagnostic of `compile()`.
  if (resultType !== 'f32')
    return declined({
      code: 'unsupported-result',
      kind: 'capability',
      message:
        `Could not compile with \`compileFieldFunction()\`: the value of the ` +
        `expression ` +
        (resultType === undefined
          ? 'has no static WGSL type'
          : `has the WGSL type \`${resultType}\``) +
        `, and a field function returns a real scalar (\`f32\`).`,
    });

  // Every input that the compiled code reads must be a coordinate, a
  // storage binding of a hint, or a field of the struct. A name that
  // reaches the code by another route (a free symbol that the search above
  // did not find) would be an identifier that the module does not declare.
  for (const s of result.freeSymbols ?? [])
    if (!coordinateSet.has(s) && !hints?.has(s) && !Object.hasOwn(vars, s))
      return declined({
        code: 'compile-error',
        kind: 'capability',
        message:
          `Could not compile with \`compileFieldFunction()\`: the compiled ` +
          `code reads "${s}", which is not a coordinate, a parameter or a ` +
          `storage binding of the field function.`,
        binding: s,
      });

  // The WGSL type of each input, as the compilation read it. A coordinate
  // and a scalar parameter must be `f32`.
  const lowered = (s: string) => result.freeSymbolTypes?.[s]?.lowered;
  for (const c of coordinates) {
    const l = lowered(c);
    if (l !== undefined && l !== 'f32')
      return declined({
        code: 'unsupported-parameter',
        kind: 'capability',
        message:
          `Could not compile with \`compileFieldFunction()\`: the coordinate ` +
          `"${c}" is read as \`${l}\`, and a coordinate is an \`f32\` argument.`,
        binding: c,
      });
  }
  for (const p of scalars) {
    const l = lowered(p);
    if (l !== undefined && l !== 'f32')
      return parameterDecline(p, `is read as \`${l}\``);
  }

  // The parameter struct. The scalars come first and the lists after them,
  // each group in name order, so that the layout does not depend on the
  // order of the terms of the expression. The offsets follow the layout
  // rules of the WGSL specification ("Alignment and Size", "Structure
  // Member Layout"): an `f32` has alignment 4 and size 4; `array<vec4f, k>`
  // has alignment 16 and size 16k, and its stride of 16 bytes satisfies the
  // rule of the uniform address space that an array stride is a multiple of
  // 16. A parameter that the compilation does not read (folded away) is not
  // a field.
  const used = new Set(result.freeSymbols ?? []);
  const params: FieldFunctionParameter[] = [];
  let offset = 0;
  for (const p of scalars) {
    if (!used.has(p)) continue;
    params.push({
      name: p,
      ceType: discovery.types.get(p)!.toString(),
      wgslType: 'f32',
      offset,
      size: 4,
    });
    offset += 4;
  }
  for (const [p, { n, ceType }] of lists) {
    if (!used.has(p)) continue;
    const k = Math.ceil(n / 4);
    offset = roundUp(16, offset);
    params.push({
      name: p,
      ceType,
      wgslType: `array<vec4f, ${k}>`,
      offset,
      size: 16 * k,
      length: n,
    });
    offset += 16 * k;
  }
  const paramsSize = roundUp(16, offset);
  // WebGPU guarantees a uniform buffer binding of 65,536 bytes
  // (`maxUniformBufferBindingSize`, default limit of the WebGPU
  // specification; the compatibility mode guarantees 16,384). A larger
  // struct may not bind on a device that has only the default limits.
  if (paramsSize > FIELD_FUNCTION_MAX_PARAMS_SIZE)
    return declined({
      code: 'unsupported-parameter',
      kind: 'capability',
      message:
        `Could not compile with \`compileFieldFunction()\`: the parameter ` +
        `struct takes ${paramsSize} bytes, more than the ` +
        `${FIELD_FUNCTION_MAX_PARAMS_SIZE} bytes of a uniform buffer binding ` +
        `that WebGPU guarantees (\`maxUniformBufferBindingSize\`). Read the ` +
        `largest lists from storage buffers instead: ` +
        `\`storage: { <name>: { kind: 'storage-buffer', group, binding } }\`.`,
    });
  const paramsStructSource =
    params.length === 0
      ? ''
      : `struct ${paramsStruct} {\n${params
          .map((p) => `  ${p.name}: ${p.wgslType},\n`)
          .join('')}}\n`;

  // The user-defined functions are renamed after the field function, so
  // that the user functions of two field functions do not have one name.
  // The names to rename are the names that the compilation emitted (its
  // registry), not a pattern: a function whose name has no ASCII letter
  // (`α`) is emitted as `_fn` or `_fn_2`. An emitted name `<p><rest>`, with
  // the prefix `<p>` (`_fn`), becomes `<p>_<k>_<name><rest>`, with k the
  // length of `name`: `_fn_h` of the field `gyroid` is `_fn_6_gyroid_h`, and
  // `_fn` is `_fn_6_gyroid`. Without the length, the field `my` with the
  // function `field_h` and the field `my_field` with the function `h` would
  // both give `_fn_my_field_h`. A struct field read (`ce_params._fn_x`) is
  // not renamed: the dot before it excludes it.
  const renames = new Map<string, string>();
  for (const u of userNames) {
    const m = /^(_[A-Za-z]+)(.*)$/.exec(u);
    if (m === null)
      return declined(
        compileDiagnosticOf(
          `Internal: compileFieldFunction() cannot rename the function "${u}"`
        )
      );
    renames.set(u, `${m[1]}_${name.length}_${name}${m[2]}`);
  }
  const renamePattern =
    renames.size === 0
      ? undefined
      : new RegExp(
          `(?<![\\w$.])(${[...renames.keys()]
            .sort((a, b) => b.length - a.length)
            .join('|')})(?![\\w$])`,
          'g'
        );
  const rename = (s: string): string =>
    renamePattern === undefined
      ? s
      : s.replace(renamePattern, (u) => renames.get(u) ?? u);

  const helpers: Record<string, string> = {};
  for (const [helper, source] of wgslDeclarationsByName(
    rename(result.preamble ?? '')
  ))
    helpers[helper] = source;
  // The declarations of the preamble that are not user-defined functions
  // (the names of the registry) are the shared library helpers that
  // `preambleFor` (`gpu-target.ts`) adds: `_gpu_sin`, `_fractal_mandelbrot`,
  // and the others. Each is a constant text or a text built from its name,
  // so a name always has the same source.
  const userHelpers = new Set(renames.values());

  // A user-defined function that declares a name equal to `paramsVariable`
  // (a parameter `p` when `paramsVariable` is `'p'`) hides the struct from
  // its body, and declines.
  const code = rename(result.code);
  for (const u of userHelpers) {
    const source = helpers[u];
    if (source === undefined) continue;
    if (declaredNames(source).has(paramsVariable))
      return declined({
        code: 'unsupported-parameter',
        kind: 'capability',
        message:
          `Could not compile with \`compileFieldFunction()\`: a user-defined ` +
          `function that the expression calls declares "${paramsVariable}", ` +
          `the name of the parameter struct variable, which hides the struct ` +
          `in its body. Choose another \`paramsVariable\`.`,
        binding: paramsVariable,
      });
  }
  if (declaredNames(`fn _f() {\n${code}\n}`).has(paramsVariable))
    return declined({
      code: 'unsupported-parameter',
      kind: 'capability',
      message:
        `Could not compile with \`compileFieldFunction()\`: the body declares ` +
        `"${paramsVariable}", the name of the parameter struct variable. ` +
        `Choose another \`paramsVariable\`.`,
      binding: paramsVariable,
    });

  // The counter of a `WithRandomSeed` frame is a private variable that WGSL
  // sets to 0 once per invocation, before the entry point runs. A host calls
  // a field function many times in one invocation (at several grid points,
  // or at x ± h for a gradient), and two field functions of one module share
  // a counter of the same name. Each call therefore sets its counters to 0
  // first, so that a call draws the values that one evaluation of the
  // expression draws.
  const counters = Object.keys(helpers).filter((h) =>
    new RegExp(`^${GPU_RANDOM_COUNTER_PREFIX}\\d+$`).test(h)
  );
  const statements = [
    ...counters.map((c) => `${c} = 0u;`),
    ...(code.includes('\n') ? code.split('\n') : [`return ${code};`]),
  ];
  const args = coordinates.map((c) => `${c}: f32`).join(', ');
  const body = statements.map((l) => `  ${l}`).join('\n');
  const fn = `fn ${name}(${args}) -> f32 {\n${body}\n}\n`;
  for (const [reader, source] of readers) helpers[reader] = source;
  if (readers.size > 0 && helpers._gpu_nan === undefined)
    helpers._gpu_nan = `${GPU_NAN_PREAMBLE_WGSL.trim()}\n`;

  const out: FieldFunctionResult = {
    success: true,
    function: fn,
    helpers,
    paramsStructSource,
    params,
    paramsSize,
  };
  if (result.warnings !== undefined) out.warnings = result.warnings;
  if (result.storageBuffers !== undefined)
    out.storageBuffers = result.storageBuffers;
  return out;
}
