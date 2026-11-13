/**
 * The `callerLocals` option of the GLSL target: names that are locals of
 * the code that calls the compiled expression, passed to each emitted
 * shader function that reads them.
 *
 * The code of a compilation runs inside a function of the host
 * (`float userFn(float x, float y) { … }`), so a name of `callerLocals` is a
 * parameter or a local of that function. An emitted user function
 * (`_fn_g`) is a function of the file, where such a name is not visible. So
 * a function that reads a name of `callerLocals`, directly or through a
 * function it calls, takes it as a trailing parameter, after its own
 * parameters and after the extra parameters of an invariant-prefix variant,
 * in the sorted order of the names:
 *
 *   g(u) := u + x, callerLocals ['x']
 *   float _fn_g(float u, float _in_x) { return u + _in_x; }   // preamble
 *   _fn_g(1.0, x)                                             // code
 *
 * The parameter list depends only on the function and the option: two
 * compilations with the same option write the same text for the same
 * function. The parameter has a name of its own (`_in_x`), chosen among the
 * names that the definition and the functions it reaches do not use, so a
 * function whose own parameter is spelled like the name (`h(x) := g(x) * y`)
 * still receives the input.
 *
 * A call in the code of the compilation passes the text of the name in that
 * code: its `vars` source when there is one, else its name. Under a binder of
 * the same name (`\sum_{x=1}^{3} (x + g(x))`), the `x` of `g` is still the
 * input (the binder does not reach into the body of `g`), and a loop of the
 * shader may declare a variable `x` there. The call then passes a temporary
 * that holds the input, declared at the start of the code. A call inside an
 * emitted function passes that function's own parameter.
 *
 * The parameters are recorded while the body of a definition compiles: the
 * `var` hook of the compilation root, which every free read of a definition
 * body reaches, answers the parameter for a name of `callerLocals` and
 * records the read in the definition that is compiling (a stack, since a
 * definition that a body calls is compiled while that body compiles), and a
 * call appends the parameters of its callee, resolved in the same way. GLSL
 * has no recursion, so a callee is complete before its caller's signature is
 * written.
 */

import type { Expression, IComputeEngine } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { CompileDeclineError } from './diagnostics.js';
import { BaseCompiler } from './base-compiler.js';
import { reachableSymbolNames } from './point-value-inlining.js';

type Registry = NonNullable<CompileTarget<Expression>['userFunctions']>;

/** A definition whose body is compiling. */
interface DefinitionFrame {
  /** The emitted name of the definition (`_fn_g`). */
  readonly name: string;
  /** The names of `callerLocals` that the body reads, directly or through a
   * call. */
  readonly reads: Set<string>;
  /** The parameter name of each name of `callerLocals` in this definition. */
  readonly parameters: ReadonlyMap<string, string>;
}

/** The state of the option for one compilation. */
interface CallerLocalsState {
  readonly names: ReadonlySet<string>;
  /** The text of a name in the code of the compilation (the root). */
  readonly rootText: (name: string) => string;
  /** The shader type of a read of a name. */
  readonly typeOf: (name: string) => string | undefined;
  /** The bound names of the root target: a call under a bound-name set
   * other than this one is under a binder. */
  readonly rootBound: ReadonlySet<string> | undefined;
  /** A fresh temporary of the root. */
  readonly temporary: () => string;
  readonly frames: DefinitionFrame[];
  /** The names of `callerLocals` that each emitted definition takes, in
   * order, by emitted name. */
  readonly byDefinition: Map<string, ReadonlyArray<string>>;
  /** The temporaries of the root that hold a name, by name. */
  readonly rootAliases: Map<
    string,
    { name: string; type: string; text: string }
  >;
  readonly types: Map<string, string | undefined>;
}

const states = new WeakMap<Registry, CallerLocalsState>();

/** The code of the decline of a caller local with no shader value type
 * that a shader function reads. */
export const CALLER_LOCAL_TYPE_CODE = 'caller-local-type';

/** The code of the decline of a caller local that a call passes, whose
 * `vars` source is not a read of a variable. */
export const CALLER_LOCAL_SOURCE_CODE = 'caller-local-source';

/** Is `e` one of the declines of the `callerLocals` option? */
export function isCallerLocalsDecline(e: CompileDeclineError): boolean {
  return (
    e.diagnostic.code === CALLER_LOCAL_TYPE_CODE ||
    e.diagnostic.code === CALLER_LOCAL_SOURCE_CODE
  );
}

/**
 * Install the option `names` on the compilation whose registry is on `root`
 * (`root.userFunctions.root === root`). With no name, nothing is installed
 * and every compilation writes the text it writes without the option.
 *
 * `rootText` gives the text of a name in the code of the compilation, and
 * `typeOf` the shader type of a read of it. The `var` hook of `root` is
 * wrapped: a read of a name of `names` while a definition body compiles is
 * the parameter of that definition.
 */
export function installCallerLocals(
  root: CompileTarget<Expression>,
  names: ReadonlyArray<string> | undefined,
  engine: IComputeEngine,
  hooks: {
    rootText: (name: string) => string;
    typeOf: (name: string) => string | undefined;
    rootBound: ReadonlySet<string> | undefined;
  }
): void {
  const registry = root.userFunctions;
  if (registry === undefined || names === undefined || names.length === 0)
    return;
  const state: CallerLocalsState = {
    names: new Set(names),
    rootText: hooks.rootText,
    typeOf: hooks.typeOf,
    rootBound: hooks.rootBound,
    temporary: () => BaseCompiler.tempVar(root),
    frames: [],
    byDefinition: new Map(),
    rootAliases: new Map(),
    types: new Map(),
  };
  states.set(registry, state);
  const inner = root.var;
  root.var = (id) => {
    const frame = state.frames[state.frames.length - 1];
    if (frame === undefined || !state.names.has(id)) return inner(id);
    // A name the target resolves to a constant (`ImaginaryUnit`), and a
    // name with a value that no `vars` entry maps (its value is written in
    // the code), is not an input.
    const resolved = inner(id);
    const mapped = root.varsKeys?.has(id) === true;
    if (resolved !== undefined && !mapped) return resolved;
    if (resolved === undefined && engine._getSymbolValue(id) !== undefined)
      return undefined;
    frame.reads.add(id);
    return frame.parameters.get(id)!;
  };
}

/**
 * Begin the definition `name` of the user function whose `Function`
 * literal is `literal`, with the formal parameters `params`. Returns the
 * function that ends it, or `undefined` when the option is not installed.
 *
 * The name of the parameter of each name of `callerLocals` is chosen here,
 * from the definition alone: `_in_` and the name, with a numeric suffix when
 * the literal, the definitions it reaches or its parameters use that name.
 */
export function beginCallerLocalsDefinition(
  registry: Registry,
  name: string,
  literal: Expression,
  params: ReadonlyArray<string>
): (() => void) | undefined {
  const state = states.get(registry);
  if (state === undefined) return undefined;
  const taken = new Set<string>([
    ...reachableSymbolNames(literal).all,
    ...params,
  ]);
  const parameters = new Map<string, string>();
  for (const local of [...state.names].sort()) {
    const base = callerLocalParameterBase(local);
    let candidate = base;
    for (let k = 2; taken.has(candidate); k++) candidate = `${base}_${k}`;
    taken.add(candidate);
    parameters.set(local, candidate);
  }
  const frame: DefinitionFrame = { name, reads: new Set(), parameters };
  state.frames.push(frame);
  return () => {
    const at = state.frames.lastIndexOf(frame);
    if (at >= 0) state.frames.splice(at, 1);
  };
}

/**
 * The trailing parameters of the definition `name`, whose body has just
 * compiled (between `beginCallerLocalsDefinition()` and the function it
 * returned): one `[parameter, type]` pair for each name of `callerLocals`
 * that the body reads, in the sorted order of the names. Recorded for the
 * calls of `name`. A name with no shader value type declines.
 */
export function callerLocalsParameters(
  registry: Registry,
  name: string,
  id: string
): Array<[name: string, type: string]> {
  const state = states.get(registry);
  if (state === undefined) return [];
  const frame = state.frames[state.frames.length - 1];
  if (frame === undefined || frame.name !== name) return [];
  const locals = [...frame.reads].sort();
  const result = locals.map((local): [string, string] => [
    frame.parameters.get(local)!,
    callerLocalType(state, local, id),
  ]);
  state.byDefinition.set(name, locals);
  return result;
}

/**
 * Record that the definition `name` (a wrapper of the definition `callee`
 * that the GLSL target writes itself, such as an element-wise wrapper)
 * takes the trailing parameters of `callee`. Returns those parameters, with
 * the names they have in the wrapper (chosen among `taken`), and the
 * arguments that the wrapper passes to `callee`.
 */
export function wrapperCallerLocals(
  registry: Registry,
  name: string,
  callee: string,
  id: string,
  taken: ReadonlyArray<string>
): Array<[name: string, type: string]> {
  const state = states.get(registry);
  const locals = state?.byDefinition.get(callee);
  if (state === undefined || locals === undefined || locals.length === 0)
    return [];
  const used = new Set(taken);
  const params = locals.map((local): [string, string] => {
    const base = callerLocalParameterBase(local);
    let candidate = base;
    for (let k = 2; used.has(candidate); k++) candidate = `${base}_${k}`;
    used.add(candidate);
    return [candidate, callerLocalType(state, local, id)];
  });
  state.byDefinition.set(name, locals);
  return params;
}

/**
 * The arguments that a call of the definition `callee` at `target` passes
 * for its trailing parameters, in order: in a definition body, the
 * parameter of that definition (recorded as a read of it); in the code of
 * the compilation, the text of the name there, or the temporary that holds
 * it when a binder of the same name encloses the call.
 */
export function callerLocalsArguments(
  registry: Registry,
  callee: string,
  target: CompileTarget<Expression>
): string[] {
  const state = states.get(registry);
  const locals = state?.byDefinition.get(callee);
  if (state === undefined || locals === undefined) return [];
  const frame = state.frames[state.frames.length - 1];
  return locals.map((local) => {
    if (frame !== undefined) {
      frame.reads.add(local);
      return frame.parameters.get(local)!;
    }
    const bound = target.boundVars;
    if (bound === state.rootBound || bound?.has(local) !== true)
      return state.rootText(local);
    // A binder of the same name encloses the call. The binder does not reach
    // into the callee, which reads the input, but the code at the call may
    // declare a variable of that name (the index of a loop). A temporary
    // declared at the start of the code holds the input.
    let alias = state.rootAliases.get(local);
    if (alias === undefined) {
      alias = {
        name: state.temporary(),
        type: callerLocalType(state, local, callee),
        text: state.rootText(local),
      };
      state.rootAliases.set(local, alias);
    }
    return alias.name;
  });
}

/**
 * The code `code` of the compilation (an expression, or statements that end
 * with a `return`), with the declarations of the temporaries that hold a
 * name of `callerLocals` (`callerLocalsArguments()`) at its start.
 */
export function withCallerLocalAliases(
  registry: Registry | undefined,
  code: string
): string {
  const state = registry === undefined ? undefined : states.get(registry);
  if (state === undefined || state.rootAliases.size === 0) return code;
  const declarations = [...state.rootAliases.values()].map(
    (a) => `${a.type} ${a.name} = ${a.text};`
  );
  const statements =
    code.includes('\n') || /^\s*return\b/.test(code) ? code : `return ${code};`;
  return [...declarations, statements].join('\n');
}

/** `_in_` and the name, spelled as a shader identifier (no `__`). */
function callerLocalParameterBase(local: string): string {
  return `_in_${local}`
    .replace(/[^\w]/g, '_')
    .replace(/_+/g, '_')
    .replace(/_+$/, '');
}

function callerLocalType(
  state: CallerLocalsState,
  local: string,
  id: string
): string {
  let type = state.types.get(local);
  if (!state.types.has(local)) {
    type = state.typeOf(local);
    state.types.set(local, type);
  }
  if (type === undefined)
    throw new CompileDeclineError({
      code: CALLER_LOCAL_TYPE_CODE,
      kind: 'capability',
      binding: local,
      message:
        `Could not compile \`${id}\`: it reads the caller local "${local}" ` +
        `(the \`callerLocals\` option), which has no GLSL value type, so ` +
        `the shader function cannot take it as a parameter. Only scalars, ` +
        `booleans, complex values and 2–4 component vectors have one.`,
    });
  return type;
}
