// Random state and random draws in shaders, seed folding and uniform reads.

import type { Expression } from '../global-types.js';
import {
  isFunction,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { tryGetConstant } from './constant-folding.js';
import type { CompileTarget } from './types.js';
import {
  BaseCompiler,
  isProvablyCharacterOperand,
  isProvablyStringOperand,
} from './base-compiler.js';
import { foldSeed } from '../numerics/random.js';
import { smallCount } from '../boxed-expression/collection-count.js';
import {
  gpuAssertCallerCodeNotRepeated,
  gpuAssertHoistKeepsCallerOrder,
  gpuBindEveryDraw,
  gpuDrawComesAfter,
  gpuReachesCallerCode,
} from './gpu-draw-order.js';
import { isShaderVariableRead } from './compile-folding.js';
import { gpuCanPlaceStatement } from './gpu-statements.js';
import { gpuPointOrPointListUnion } from './gpu-declared-types.js';
import { gpuTupleWithoutShaderType } from './gpu-shapes.js';
import { gpuPointOrPointListRefusal } from './gpu-points.js';
import { formatGPUNumber } from './gpu-emit.js';
import type { Type } from '../../common/type/types.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';

//
// ─── Counter-based random draws (PCG3D) ─────────────────────────────────────
//
// The GPU tier of `docs/RANDOMNESS-MODEL.md`. The
// n-th draw of a frame is `hash(seed, n)` — a pure function of the seed and
// the draw index — so a shader, which has no persistent stream and cannot
// carry mutable RNG state across invocations, can still replay a frame.
//
// Three things make the tier well-defined:
//
// 1. `pcg3d` is transcribed VERBATIM from the paper (§2 of the design), pure
//    u32 arithmetic, so it is a transcription on every target rather than an
//    independent reimplementation. `pcg3dWords` in `numerics/random.ts` is
//    the reference: the shader must compute the identical integer words.
// 2. The presentation is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two scaling
//    of the top 24 bits of `w0`, never implementation-rounded float math.
//    The f64 tier is built from the SAME `w0`, so the tiers agree to within
//    2⁻²⁴ by construction.
// 3. Frames are LEXICAL (§4): the seed is folded in the shader (or on the
//    host, for a literal — see `gpuFoldSeedSource`) and each frame owns an
//    invocation-local u32 counter that every invocation starts at 0.
//

/**
 * Per-compilation state for the counter-based random draws.
 *
 * Installed eagerly by `GPUShaderTarget.createTarget()` so it survives the
 * `{ ...target }` spreads the base compiler makes while recursing — the state
 * object is shared by reference, which is what lets a `WithRandomSeed` handler
 * push a frame that the `Random` handlers nested inside its body can see.
 */
export type GPURandomState = {
  /** The stack of enclosing LEXICAL frames, innermost last. */
  frames: Array<{ seed: string; counter: string }>;

  /** How many counter variables have been allocated (names are positional). */
  counters: number;

  /** The counter shared by unframed (spatial-noise) draws, allocated lazily. */
  spatialCounter: string | undefined;

  /**
   * The shader stage being compiled, when known. `undefined` means the caller
   * did not say — the `compile()`/`compileToSource()` entry points — and the
   * historical fragment-shader assumption applies. `compileShader()` sets it,
   * which is what makes the §7 vertex-stage check possible.
   */
  stage: string | undefined;

  /**
   * Whether a HOST `WithRandomSeed` frame was active when this GPU compile
   * ran. An unframed shader draw is then the cross-domain case (§4) and fails
   * closed — never a silent live/spatial draw.
   */
  hostFrame: boolean;

  /**
   * The names the caller mapped through `vars`, when the entry point knows
   * them. A seed that resolves to one of these is the HOST-UNIFORM row of the
   * seed ABI, which is not implemented — see `gpuFoldSeedSource`.
   */
  varNames: ReadonlySet<string> | undefined;
};

export type GPURandomTarget = CompileTarget<Expression> & {
  /**
   * The identity of the compilation this target belongs to.
   *
   * The state itself lives in the module-level `GPU_RANDOM_STATES` map, never
   * on the target, so a CALLER-supplied target is not mutated (and does not
   * carry counter numbering from one compilation into the next). The token is
   * a plain enumerable property because the base compiler recurses through
   * `{ ...target }` spreads: those copy the token BY REFERENCE, which is what
   * keeps a frame pushed by `WithRandomSeed` visible to the draws nested in
   * its body.
   */
  gpuRandomRoot?: object;
};

/**
 * Per-compilation random state, keyed by the compilation's root token — or,
 * for a hand-rolled target that never went through `createTarget()`, by the
 * target itself. Never stored ON the target.
 */
const GPU_RANDOM_STATES = new WeakMap<object, GPURandomState>();

/** A fresh (empty) random state — one per compilation. */
export function newGPURandomState(): GPURandomState {
  return {
    frames: [],
    counters: 0,
    spatialCounter: undefined,
    stage: undefined,
    hostFrame: false,
    varNames: undefined,
  };
}

/**
 * Give `target` — freshly created by `createTarget()`, so ours to write to —
 * its own compilation identity and a fresh random state.
 */
export function installGPURandomState(target: GPURandomTarget): void {
  const token = {};
  target.gpuRandomRoot = token;
  GPU_RANDOM_STATES.set(token, newGPURandomState());
}

/**
 * The random state of the compilation `target` belongs to. A hand-rolled
 * target that never went through `createTarget()` gets one keyed by the target
 * object itself — enough for a single unframed draw, and without writing
 * anything to the caller's object.
 */
export function gpuRandomState(
  target: CompileTarget<Expression>
): GPURandomState {
  const key = (target as GPURandomTarget).gpuRandomRoot ?? target;
  let state = GPU_RANDOM_STATES.get(key);
  if (state === undefined) {
    state = newGPURandomState();
    GPU_RANDOM_STATES.set(key, state);
  }
  return state;
}

/**
 * Compilation-boundary hook (`CompileTarget.beginCompilation`): restart the
 * per-compilation counter NUMBERING of the compilation `target` belongs to.
 *
 * A target the engine creates is fresh for every `compile()`, so its numbering
 * starts at `_gpu_rnd_n0` on its own. A target the CALLER built once and passes
 * to two successive `compile()` calls does not — without this reset the second
 * compilation of the same expression would number its draws `n1, n2, …`,
 * breaking recompile-replay determinism on that path.
 *
 * Reset through the state, not by replacing it: the state is reached by the
 * identity token (which `{ ...target }` spreads copy by reference), and the
 * compilation CONTEXT `createTargetFor` stamped on it — shader stage, active
 * host frame, `vars` names — describes the caller, not this compilation, and
 * must survive. Frames are cleared because an unbalanced frame can only be the
 * residue of a compilation that threw.
 */
export function resetGPURandomNumbering(
  target: CompileTarget<Expression>
): void {
  const state = gpuRandomState(target);
  state.frames.length = 0;
  state.counters = 0;
  state.spatialCounter = undefined;
  // The generated-temporary numbering (`_tv1`, `_tv2`, … — the `Sum`/`Product`
  // loop accumulator) is per-compilation for exactly the same reason, and
  // restarts on the same boundary. Its collision inventory describes the
  // caller's expression, not this compilation, so it survives the reset — the
  // same split as the random state's CONTEXT above.
  BaseCompiler.resetNaming(target);
}

/**
 * Allocate the next invocation-local counter variable.
 *
 * Each frame owns one, plus one shared by the unframed spatial-noise draws.
 * The counter is a shader global (`var<private>` in WGSL): per-invocation and
 * initialized before the entry point runs, so every invocation runs each of
 * its frames from `n = 0`.
 *
 * Caveat worth knowing: GLSL and WGSL leave the evaluation ORDER of an
 * expression's operands unspecified, so which of two sibling draws in one
 * frame gets `n = 0` is not pinned by the source. The set of values drawn is,
 * and so is each draw's own determinism — but `Random() - Random()` inside one
 * frame may differ in sign between GPU drivers. The host tiers, which evaluate
 * left to right, do not have this freedom.
 */
export function allocGPURandomCounter(state: GPURandomState): string {
  return `_gpu_rnd_n${state.counters++}`;
}

/** The prefix every allocated counter name carries (scanned for by the
 * preamble assembly). */
export const GPU_RANDOM_COUNTER_PREFIX = '_gpu_rnd_n';

/** How a draw site passes its counter: GLSL takes it by `inout`, WGSL by a
 * pointer into the private address space. */
function gpuCounterArg(name: string, language: string | undefined): string {
  return language === 'wgsl' ? `&${name}` : name;
}

/** A `uvec2` (WGSL `vec2<u32>`) literal holding the two folded seed words. */
function gpuSeedWords(
  lo: number,
  hi: number,
  language: string | undefined
): string {
  const hex = (w: number) => `0x${(w >>> 0).toString(16).padStart(8, '0')}u`;
  const ctor = language === 'wgsl' ? 'vec2<u32>' : 'uvec2';
  return `${ctor}(${hex(lo)}, ${hex(hi)})`;
}

/**
 * One draw `u ∈ [0, 1)`.
 *
 * Inside a lexical frame this is `_gpu_rnd_draw(seed, n)`, which advances the
 * frame's own counter. Outside any frame it is the GLSL fragment-shader
 * spatial-noise exception (§7): a `gl_FragCoord`-derived seed through the same
 * PCG3D stream, with an invocation-local counter so repeated unframed draws
 * decorrelate instead of returning one value. Every other unframed case throws.
 */
export function gpuRandomDraw(target: CompileTarget<Expression>): string {
  const code = gpuRandomDrawCode(target);
  const mode = gpuBindEveryDraw;
  if (mode === undefined) return code;
  // A draw in a conditionally evaluated position, or where no statement can
  // be placed, stays in its expression. Every later draw could then run
  // before it: a bound draw runs ahead of the statement, and a draw that
  // stays in a statement hoisted later (the body of a loop) runs where that
  // statement is placed, also ahead of it. So any draw after such a draw
  // refuses the statement, which refuses more than needed but keeps the
  // order.
  if (mode.inline) mode.reordered = true;
  const path = [...BaseCompiler.compileParents()];
  if (mode.last !== undefined && !gpuDrawComesAfter(mode.last, path))
    mode.reordered = true;
  mode.last = path;
  if (!gpuCanPlaceStatement(target)) {
    mode.inline = true;
    return code;
  }
  // The temporary runs ahead of the statement, so the draw must not move
  // ahead of caller code written before it. The temporary holds the draw
  // only: the operands of the node (the endpoints of `Random(Interval(W,
  // 1))`) stay in the statement, and the interpreter evaluates them before
  // it draws. So an operand with caller code declines.
  const node = path[path.length - 1];
  // The operands of `Random(Interval(lo, hi))` are its endpoints, which the
  // lowering writes in the statement (`Open` and `Closed` are read through).
  const domain = node !== undefined && isFunction(node) ? node.op1 : undefined;
  const operands =
    node === undefined || !isFunction(node)
      ? []
      : isFunction(node, 'Random') && isFunction(domain, 'Interval')
        ? domain.ops.map((x) =>
            isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x
          )
        : node.ops;
  if (
    operands.some(
      (op) =>
        !isShaderVariableRead(op, target) && gpuReachesCallerCode(op, target)
    )
  )
    throw new Error(
      'Could not compile `Random`: an operand of the draw contains code ' +
        'supplied by the caller (a `vars` source, a `functions` or ' +
        '`operators` entry, or a `compile` handler), and the draw, bound to ' +
        'a temporary ahead of the statement, would run before that code.'
    );
  // The endpoints are checked above, so the temporary holds a draw with no
  // caller code (`drawOnly`).
  gpuAssertHoistKeepsCallerOrder(
    'Random',
    node === undefined ? undefined : [node],
    target,
    true
  );
  const t = BaseCompiler.tempVar(target);
  BaseCompiler.hoistStatement(
    target,
    target.language === 'wgsl'
      ? `let ${t}: f32 = ${code};`
      : `float ${t} = ${code};`
  );
  return t;
}

/** The code of one draw, `gpuRandomDraw` without the binding. */
function gpuRandomDrawCode(target: CompileTarget<Expression>): string {
  const state = gpuRandomState(target);
  const language = target.language;

  const frame = state.frames[state.frames.length - 1];
  if (frame !== undefined)
    return `_gpu_rnd_draw(${frame.seed}, ${gpuCounterArg(
      frame.counter,
      language
    )})`;

  // Unframed. The cross-domain case first (§4): the enclosing frame lives on
  // the HOST, whose mutable counter a parallel shader invocation cannot share.
  if (state.hostFrame)
    throw new Error(
      'Could not compile `Random()`: an unframed draw has no shader form while a host ' +
        '`WithRandomSeed` frame is active — a shader invocation cannot share ' +
        "the host's mutable draw counter, and fragments run in parallel. GPU " +
        'frames must be LEXICAL: move the `WithRandomSeed(seed, …)` inside the ' +
        'compiled expression.'
    );

  if (language === 'wgsl')
    throw new Error(
      'Could not compile `Random()`: an unframed draw has no WGSL form — a shader has no ' +
        'live random stream, and WGSL has no `gl_FragCoord` built-in to derive ' +
        'spatial noise from. Wrap the draw in `WithRandomSeed(seed, …)`, whose ' +
        'seed may be an invocation-varying expression.'
    );

  // `gl_FragCoord` exists only in a fragment shader. A vertex (or other) stage
  // fails at CE compile time rather than emitting code that fails later, at
  // GPU shader-compile time. An UNKNOWN stage keeps the historical
  // fragment-shader assumption of the `compile()` entry points.
  if (state.stage !== undefined && state.stage !== 'fragment')
    throw new Error(
      `Could not compile \`Random()\`: an unframed draw compiles to \`gl_FragCoord\`-derived spatial ` +
        `noise, which exists only in a fragment shader (this is a ` +
        `\`${state.stage}\` shader). Wrap the draw in ` +
        `\`WithRandomSeed(seed, …)\` to get a stage-independent stream.`
    );

  state.spatialCounter ??= allocGPURandomCounter(state);
  // A fragment's coordinate is stable across renders, so this is DETERMINISTIC
  // SPATIAL NOISE, not the live randomness an unframed draw has on the host —
  // the one documented exception to the liveness contract (§7). Both
  // coordinates are reinterpreted whole, so there is no row-aliasing bound.
  return (
    `_gpu_rnd_draw(uvec2(floatBitsToUint(gl_FragCoord.x), ` +
    `floatBitsToUint(gl_FragCoord.y)), ${state.spatialCounter})`
  );
}

/**
 * The names of the SYMBOLS in `expr` whose own static type is text — a
 * `string` or a `character`.
 *
 * Walks symbol NODES only, so a string LITERAL is never collected — a
 * `Declare(x, "number")` type annotation carries its type as a string operand
 * and is not a text VALUE. See the call site in `createTargetFor` for what the
 * set is used for.
 *
 * The walk follows the BODY of every user-defined function the expression
 * references, by name in operator position (`g(u)`) or as a value (`Map(g, …)`).
 * Those bodies are compiled against the compilation ROOT's target
 * (`userFunctions.root`), so their free symbols pass through the same
 * `mangleId` gate this set feeds — but they are not reachable from `expr`
 * itself, and a `string`-typed global referenced only inside such a body used
 * to be emitted as a bare identifier in the definition: `g(x) := If(sv < tv, x,
 * 0)` produced `float _fn_g(float x) { return ((sv < tv) ? (x) : (0.0)); }`,
 * comparing two floats where the interpreter compares text. Each name is
 * expanded at most once, so a self- or mutually recursive definition cannot
 * loop here (the GPU targets refuse recursion anyway). A MULTI-CLAUSE function
 * has no single literal and needs no walk: its emission is JavaScript-only, so
 * a shader compilation already fails closed on it.
 */
export function gpuTextSymbols(
  expr: Expression | undefined
): ReadonlySet<string> {
  const out = new Set<string>();
  const expanded = new Set<string>();
  const walkUserFunctionBody = (e: Expression, name: string): void => {
    if (expanded.has(name)) return;
    expanded.add(name);
    const engine = e.engine;
    if (engine === undefined) return;
    const literal = BaseCompiler.userFunctionLiteral(engine, name);
    // `['Function', body, ...params]`: only the body can name a free symbol.
    // A text-typed PARAMETER needs no collecting here — the emitted signature
    // must be fully typed, and `gpuTypeOfDeclaredType` has no shader type for
    // text, so such a parameter fails closed in `lowering.define`.
    if (literal !== undefined && literal.ops.length > 0) walk(literal.ops[0]);
  };
  // A node that several parents share is visited once: what a visit adds
  // depends only on the node, and a walk of every path can take a time
  // exponential in the depth of the expression.
  const visited = new Set<Expression>();
  const walk = (e: Expression): void => {
    if (visited.has(e)) return;
    visited.add(e);
    if (isSymbol(e)) {
      if (isProvablyStringOperand(e) || isProvablyCharacterOperand(e))
        out.add(e.symbol);
      else walkUserFunctionBody(e, e.symbol);
      return;
    }
    if (isFunction(e)) {
      if (typeof e.operator === 'string' && e.operator !== '')
        walkUserFunctionBody(e, e.operator);
      for (const op of e.ops) walk(op);
    }
  };
  if (expr !== undefined) walk(expr);
  return out;
}

/**
 * The refusals for a read of a symbol of `expr` as a shader input, by name,
 * in two maps that one walk builds.
 *
 * `pointOrList` holds the symbols whose type admits a point and a list of
 * points (`gpuPointOrPointListUnion`), and the symbols whose type is a
 * tuple that no shader type holds (`gpuTupleWithoutShaderType`: a nested
 * or mixed tuple, a tuple with a `complex` element, a tuple with a
 * `boolean` element that is not a boolean vector of 2 to 4 elements).
 *
 * `unsizedLists` holds the other symbols whose type admits a collection
 * that no shader declaration holds (`gpuUnsizedCollectionReason`). A
 * shader declares an input with a type whose size is fixed at compile
 * time: a scalar, a vector, a matrix or an array of a stated length. A read
 * of an input of unknown length as a value gave code that no shader could
 * declare: with `L: list<real>`, `L` compiled to the GLSL code `L` with
 * `success: true`. The caller refuses such a read, except where the shape
 * of the name has another source (a storage hint, a parameter, a caller
 * declaration).
 *
 * The walk also enters the body of each user function that `expr` calls,
 * and the value of each symbol, because the shader targets write such a
 * value in place. A body or a value is entered at most once, so a
 * recursive definition cannot loop here.
 */
export function gpuInputShapeRefusals(expr: Expression | undefined): {
  pointOrList: ReadonlyMap<string, string>;
  unsizedLists: ReadonlyMap<string, string>;
} {
  const pointOrList = new Map<string, string>();
  const unsizedLists = new Map<string, string>();
  forEachReachableSymbol(expr, (e) => {
    const name = e.symbol;
    if (pointOrList.has(name) || unsizedLists.has(name)) return;
    const type = e.type.type;
    const union = gpuPointOrPointListUnion(type);
    if (union !== undefined) {
      pointOrList.set(name, gpuPointOrPointListRefusal(name, name, e, union));
      return;
    }
    const tupleReason = gpuTupleWithoutShaderType(type);
    if (tupleReason !== undefined) {
      pointOrList.set(
        name,
        `Could not compile \`${name}\`: "${name}" has the type ` +
          `\`${e.type.toString()}\`, and ${tupleReason}. A shader can ` +
          `read a tuple of 2 to 4 real numbers (a point) as a vector, ` +
          `and a longer tuple of real numbers as an array.`
      );
      return;
    }
    const reason = gpuUnsizedCollectionReason(type);
    if (reason !== undefined)
      unsizedLists.set(
        name,
        `Could not compile \`${name}\`: "${name}" has the type ` +
          `\`${e.type.toString()}\`, ${reason}. A shader declares an input ` +
          `with a size fixed at compile time (a scalar, a vector, a matrix ` +
          `or an array of a stated length, of at least one element), so no ` +
          `shader can declare "${name}". Declare its length in its type ` +
          `(\`list<real^8>\`, \`matrix<real^3x3>\`). On the wgsl target, a ` +
          `'storage-buffer' hint also holds a list of unknown length.`
      );
  });
  return { pointOrList, unsizedLists };
}

/**
 * Why no shader declaration holds a value of type `t`, as a clause that
 * starts with "which", or `undefined` when this test does not refuse `t`.
 *
 * The type is refused when it is a collection whose length is not known at
 * compile time: a list with no dimensions or with an open dimension
 * (`list<real>`, `matrix`, which is `matrix<number^(?x?)>`), a bare `list`,
 * a set, a range, a dictionary or an abstract collection. It is also
 * refused when it is a list with a dimension of 0, because GLSL and WGSL
 * have no array of zero elements. A list type whose dimensions are all
 * stated and positive (`list<real^3>`, `matrix<real^(2x2)>`) is not
 * refused. Tuples and strings are not collections of this kind: the tuple
 * gate of `gpuInputShapeRefusals()` and the text gate of
 * `createTargetFor()` refuse them.
 *
 * A union is not refused, even when a member is a list of unknown length
 * (`real | list<real>`): the engine gives such wide unions to symbols that
 * the shader reads as scalars (an `unknown`-typed index is read with the
 * type `boolean | character | indexed_collection<any> | number | string`),
 * and refusing them declines valid programs. A record is not refused
 * either. Both are known limitations in `docs/COMPILATION-MODEL.md`.
 */
function gpuUnsizedCollectionReason(t: Type): string | undefined {
  const NO_LENGTH = 'which has no static length';
  t = resolveTypeForCompilation(t);
  if (typeof t === 'string')
    return t === 'list' ||
      t === 'range' ||
      t === 'set' ||
      t === 'dictionary' ||
      t === 'collection' ||
      t === 'indexed_collection'
      ? NO_LENGTH
      : undefined;
  if (t.kind === 'list') {
    const dims = t.dimensions;
    if (!Array.isArray(dims) || dims.length === 0 || dims.some((d) => d < 0))
      return NO_LENGTH;
    return dims.some((d) => d === 0)
      ? 'which holds no element, and a shader array holds at least one'
      : undefined;
  }
  return t.kind === 'set' ||
    t.kind === 'dictionary' ||
    t.kind === 'collection' ||
    t.kind === 'indexed_collection'
    ? NO_LENGTH
    : undefined;
}

/**
 * Call `visit` once for each symbol name node reachable from `expr`: the
 * nodes of `expr`, of the body of each user function that a node names (in
 * operator position or as a value), and of the value of each symbol, because
 * the shader targets write such a body or value in place. A body or a value
 * is entered at most once, so a recursive definition cannot loop here, and a
 * node that several parents share is visited once in each binding scope.
 *
 * A name that an enclosing form binds (a parameter of a user function or of
 * a `Function` literal, a `Block` local, an index) is not visited: it is not
 * an input. A parameter can have the name of an input and another type:
 * with the input `H: list<real^1600>` and `g(H: list<integer>, x)`, the
 * parameter `H` has no static length, and the input `H` has one.
 */
function forEachReachableSymbol(
  expr: Expression | undefined,
  visit: (e: Expression & { symbol: string }) => void
): void {
  const expanded = new Set<string>();
  const expandedValues = new Set<string>();
  const NONE: ReadonlySet<string> = new Set();
  const walkUserFunctionBody = (e: Expression, name: string): void => {
    if (expanded.has(name)) return;
    expanded.add(name);
    const engine = e.engine;
    if (engine === undefined) return;
    const literal = BaseCompiler.userFunctionLiteral(engine, name);
    if (literal !== undefined && literal.ops.length > 0) walk(literal, NONE);
  };
  const visited = new Map<Expression, Set<ReadonlySet<string>>>();
  const walk = (e: Expression, bound: ReadonlySet<string>): void => {
    const scopes = visited.get(e);
    if (scopes?.has(bound)) return;
    if (scopes === undefined) visited.set(e, new Set([bound]));
    else scopes.add(bound);
    if (isSymbol(e)) {
      if (bound.has(e.symbol)) return;
      visit(e);
      walkUserFunctionBody(e, e.symbol);
      if (!expandedValues.has(e.symbol)) {
        expandedValues.add(e.symbol);
        const value = e.engine?._getSymbolValue(e.symbol);
        if (value !== undefined) walk(value, NONE);
      }
      return;
    }
    if (isFunction(e)) {
      if (
        typeof e.operator === 'string' &&
        e.operator !== '' &&
        !bound.has(e.operator)
      )
        walkUserFunctionBody(e, e.operator);
      const names = boundVariableNames(e);
      const inner =
        names.length === 0 ? bound : new Set([...bound, ...names]);
      for (const op of e.ops) walk(op, inner);
    }
  };
  if (expr !== undefined) walk(expr, NONE);
}

/**
 * Is the `vars` source `path`, given for the symbol `name`, a plain read of
 * a shader variable (a uniform) whose value cannot change while the shader
 * runs? Then reading it twice gives the same value, and the passes may
 * share, skip or repeat its reads (`isOpaqueVarsSource`, `cse.ts`). `path`
 * is a bare identifier (`u_a`), or an identifier `root` followed by field
 * accesses and literal indexes (`ce_params.c`, `v[0]`), which only read the
 * variable `root`.
 *
 * A uniform is read-only in GLSL and WGSL. The one way for a read of `path`
 * to give a different value is a variable of the shader named `root` that
 * the shader writes: a `Block` local, an assigned symbol, a loop or binder
 * variable, or a parameter, here or in a user-function definition that the
 * code reaches. Each of these is emitted with its symbol name, so the read
 * is refused when `root` is the name of any symbol in `symbols` (see
 * {@link reachableSymbolNames}), when it is another `vars` key, or when
 * another `vars` key has the source `path` or `root`. These tests are
 * stricter than necessary, as a symbol that is only read also counts.
 */
export function gpuPlainUniformRead(
  path: string,
  root: string,
  name: string,
  vars: Readonly<Record<string, unknown>>,
  symbols: () => ReadonlySet<string>
): boolean {
  if (symbols().has(root)) return false;
  for (const key of Object.keys(vars)) {
    if (key === name) continue;
    if (key === root) return false;
    const other = vars[key];
    if (typeof other !== 'string') continue;
    const otherText = other.trim();
    if (otherText === path || otherText === root) return false;
  }
  return true;
}

/**
 * Refuse a `vars` entry whose source is a bare identifier that names a
 * variable the compiled code declares or writes (`written`, see
 * {@link reachableSymbolNames}). A source that is a read path
 * (`k.x`, `k[0]`, see `isOpaqueVarsSource()` in `cse.ts`) is refused when
 * its first identifier names such a variable, for the same reason.
 *
 * The shader emits that variable with the same name, so inside its scope the
 * identifier reads the variable, not the uniform the host meant: with
 * `vars: { a: 'k' }` and a `Block` that declares and assigns its own `k`,
 * every read of `a` gave the value of the local. The compile throws instead,
 * and the interpreter gives the answer.
 *
 * A self-mapped entry (`vars: { T: 'T' }`) is not refused: the source is the
 * symbol's own spelling, and the compiled code does not write an input (a
 * write to an input declines, `assignLValue()`). A source that names a
 * symbol the code only reads is not refused either. An entry whose key the
 * code never reads
 * (`all`) is not refused: a host can pass one `vars` map for many
 * expressions.
 */
export function gpuRefuseShadowedVarsSources(
  vars: Readonly<Record<string, unknown>>,
  written: () => ReadonlySet<string>,
  all: () => ReadonlySet<string>
): void {
  for (const key of Object.keys(vars)) {
    if (!all().has(key)) continue;
    const source = vars[key];
    if (typeof source !== 'string') continue;
    const identifier =
      /^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[0-9]+\])*\s*$/.exec(
        source
      )?.[1];
    if (identifier === undefined || identifier === key) continue;
    if (!written().has(identifier)) continue;
    throw new Error(
      `Could not compile: the \`vars\` entry for \`${key}\` reads the ` +
        `uniform \`${identifier}\`, but the compiled code declares or writes ` +
        `the symbol \`${identifier}\`, which the shader emits with the same ` +
        `name. The shader would read that variable instead of the uniform. ` +
        `Rename the uniform or the symbol.`
    );
  }
}

/** The message for a random form that would need general collection indexing. */
export function gpuNoIndexingMessage(
  form: string,
  target: CompileTarget<Expression>
): string {
  const lang = target.language ?? 'GPU';
  return (
    `${form} is not supported on the ${lang} target: a shader expression has ` +
    `no general collection indexing. Only \`Random()\`, ` +
    `\`Random(Interval(a, b))\` and \`Random(Range(…))\` compile — the ` +
    `closed-form domains.`
  );
}

/**
 * `Random(domain)` — the closed-form domains only.
 *
 * `Interval` → `lo + u * (hi - lo)`; `Range` → `first + step * floor(u * n)`
 * over the range's NORMALIZED parameters, matching the interpreter's
 * `selectRandomElement` (`library/core.ts`) term for term. Any other domain
 * would need indexing, so it fails closed.
 */
export function gpuRandomDomainDraw(
  domain: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (isFunction(domain, 'Interval')) {
    if (domain.nops !== 2)
      throw new Error('Random(Interval(a, b)): expects two endpoints');
    // Endpoint markers are IGNORED — a float draw cannot respect an open
    // endpoint, so the draw is half-open `[lo, hi)` either way.
    const strip = (x: Expression): Expression =>
      isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x;
    const loExpr = strip(domain.op1);
    const hiExpr = strip(domain.op2);

    // Endpoints are SPLICED into the emitted expression — `lo` twice — because
    // a shader expression has no statement to evaluate them into once. Pure
    // arithmetic on uniforms is only an ALU cost, but an endpoint that
    // consumes draws would consume a different NUMBER of them than the host.
    // Fail closed.
    for (const [role, endpoint] of [
      ['lower', loExpr],
      ['upper', hiExpr],
    ] as const)
      if (!endpoint.canonical.isPure)
        throw new Error(
          `Could not compile \`Random(Interval(a, b))\`: the ${role} endpoint is not pure — a ` +
            `shader expression has no statement to evaluate it into once, so ` +
            `the endpoint is spliced (and would run) more than once per ` +
            `draw. Hoist the draw out of the endpoint.`
        );

    const lo = tryGetConstant(loExpr);
    const hi = tryGetConstant(hiExpr);
    if (lo !== undefined && hi !== undefined) {
      if (!(hi > lo))
        throw new Error(
          `Random(Interval(${lo}, ${hi})): the interval is empty or reversed ` +
            `— there is no uniform distribution to draw from.`
        );
      return `(${formatGPUNumber(lo)} + ${gpuRandomDraw(
        target
      )} * ${formatGPUNumber(hi - lo)})`;
    }
    // Symbolic endpoints (typically uniforms) stay live. `lo` is spliced
    // twice, so an endpoint with a side effect (a nested draw) would be
    // consumed twice — endpoints are expected to be uniforms or constants.
    // The engine does not see caller code (`gpuReachesCallerCode`) as an
    // effect, so it is checked here: in `lo` it would run twice, and in
    // `hi` it would run after the draw, where the interpreter evaluates both
    // endpoints before it draws. A read of one variable
    // (`isShaderVariableRead`) runs no code and is accepted.
    gpuAssertCallerCodeNotRepeated('Random', [loExpr], target);
    if (
      !isShaderVariableRead(hiExpr, target) &&
      gpuReachesCallerCode(hiExpr, target)
    )
      throw new Error(
        'Could not compile `Random(Interval(a, b))`: the upper endpoint ' +
          'contains code supplied by the caller (a `vars` source, a ' +
          '`functions` or `operators` entry, or a `compile` handler), and ' +
          'the draw would run before that code.'
      );
    const loSrc = compile(loExpr);
    const hiSrc = compile(hiExpr);
    return `((${loSrc}) + ${gpuRandomDraw(
      target
    )} * ((${hiSrc}) - (${loSrc})))`;
  }

  if (isFunction(domain, 'Range')) {
    const n = smallCount(domain);
    if (n === undefined || !Number.isFinite(n))
      throw new Error(
        'Could not compile `Random(Range(…))`: the GPU target requires a Range with constant, ' +
          'finite bounds — a symbolic or unbounded range has no known element ' +
          'count to draw from.'
      );
    if (n === 0)
      throw new Error('Random(Range(…)): the range is empty (no elements).');

    // The normalized (first, step) of the range — mirrors `range()` in
    // `library/collections.ts`: a two-operand range infers a DESCENDING step
    // when its bounds are reversed (`Range(7, 2)`).
    const ops = domain.ops;
    let first: number;
    let step: number;
    if (ops.length === 1) {
      first = 1;
      step = 1;
    } else if (ops.length === 2) {
      first = ops[0].re;
      step = ops[1].re >= ops[0].re ? 1 : -1;
    } else {
      first = ops[0].re;
      step = ops[2].re;
    }
    if (!Number.isFinite(first) || !Number.isFinite(step))
      throw new Error(
        'Random(Range(…)): the GPU target requires constant numeric bounds.'
      );

    const index = `floor(${gpuRandomDraw(target)} * ${formatGPUNumber(n)})`;
    // `first + step * index`, with the sign lifted out of the literal so a
    // descending range emits `(7.0 - 1.0 * …)` rather than `(7.0 + -1.0 * …)`.
    const sign = step < 0 ? '-' : '+';
    const magnitude = Math.abs(step);
    if (magnitude === 1) return `(${formatGPUNumber(first)} ${sign} ${index})`;
    return `(${formatGPUNumber(first)} ${sign} ${formatGPUNumber(
      magnitude
    )} * ${index})`;
  }

  throw new Error(gpuNoIndexingMessage('Random(collection)', target));
}

/**
 * The GPU seed ABI (§7). Which fold applies is decided by WHERE the seed value
 * lives, because a shader has neither f64 nor strings and so cannot run the
 * normative `foldSeed`:
 *
 * | Seed form | Folding | Stream identity |
 * |---|---|---|
 * | compile-time constant (number or string literal, a declared constant such as `Pi`, an assigned engine value) | HOST `foldSeed`, emitted as a `uvec2` constant | **identical** to the interpreted/JS stream |
 * | a FREE symbol the shader supplies (uniform/varying, not in `vars`) | in-shader `floatBitsToUint` / `bitcast<u32>`, `seedHi = 0u` | its OWN stream — deterministic given the seed BITS |
 * | a `vars`-mapped symbol (a HOST-supplied uniform) | — | **compile error**: the host-uniform ABI row is not implemented |
 * | a COMPUTED expression | — | **compile error**: the seed is spliced per draw site |
 * | a string computed at run time | impossible in a shader | **compile error** |
 *
 * The last two rows are the once-evaluation rule. The emitted seed source is
 * spliced into EVERY draw site of the frame — a shader expression has no
 * statement to evaluate it into once — so anything but a constant or a single
 * identifier would be recomputed per draw (and, if it consumed draws, would
 * silently change the draw count). Symbol handling is therefore: a symbol that
 * resolves to a VALUE folds on the host; a symbol the caller mapped through
 * `vars` fails closed (below); any other symbol is a name the shader itself
 * must declare, and stays live as its own stream.
 *
 * A bit reinterpretation is exact, so the derived stream is bit-deterministic
 * given the seed bits; the seed's own f32 value remains subject to ordinary
 * GPU float variance. Determinism claims stop at the fold's input.
 */
export function gpuFoldSeedSource(
  seedExpr: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const language = target.language;

  if (isString(seedExpr)) {
    const [lo, hi] = foldSeed(seedExpr.string);
    return gpuSeedWords(lo, hi, language);
  }
  if (seedExpr.type.matches('string'))
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: a string seed that is not a compile-time ' +
        'literal cannot be folded in a shader — GLSL and WGSL have no ' +
        'strings. Use a literal string, a numeric seed, or fold the seed on ' +
        'the host.'
    );

  // `WithRandomSeed` is `lazy`, so the held seed arrives UNBOUND on the box
  // and parse routes: canonicalize before asking it anything. (`.canonical` is
  // value-safe — it binds structure without substituting assigned values.)
  const seed = seedExpr.canonical;

  // The seed source is spliced at every draw site, so a seed with a side
  // effect — a nested draw above all — would run once per draw. Fail closed
  // (D6) rather than silently consume extra draws.
  if (!seed.isPure)
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: the seed expression is not pure — the folded ' +
        'seed is spliced at EVERY draw site of the frame, so it would be ' +
        'evaluated once per draw. Use a compile-time constant or a single ' +
        'shader-supplied symbol.'
    );

  // A compile-time constant — a literal, a declared constant such as `Pi`, or
  // an assigned engine value — folds on the HOST with the normative
  // `foldSeed`, so the shader draws the SAME integer stream as the interpreter
  // and the JS target. Read off the EXPRESSION, never off the emitted source:
  // `Pi` emits the truncated `3.14159265359`, which folds to a different f64
  // than `Math.PI`.
  const value = tryGetConstant(seed) ?? tryGetConstant(seed.N());
  if (value !== undefined) {
    const [lo, hi] = foldSeed(value);
    return gpuSeedWords(lo, hi, language);
  }

  const symbol = isSymbol(seed) ? seed.symbol : undefined;
  if (symbol === undefined)
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: a COMPUTED seed expression has no shader form — the folded seed is spliced at every draw ' +
        'site of the frame, so it would be recomputed per draw. Use a ' +
        'compile-time constant seed (host-identical stream) or a single ' +
        'shader-supplied symbol (its own stream).'
    );

  const mapped = target.var(symbol);
  if (mapped !== undefined) {
    if (gpuRandomState(target).varNames?.has(symbol))
      throw new Error(
        `Could not compile \`WithRandomSeed(${symbol}, …)\`: a seed supplied through \`vars\` ` +
          `(\`${symbol}\` → \`${mapped}\`) is the HOST-UNIFORM row of the ` +
          `seed ABI, which is not implemented: the host folds an f64 seed ` +
          `with \`foldSeed\` into TWO words, while a shader can only ` +
          `reinterpret the f32 bits it receives (\`seedHi = 0u\`), so the ` +
          `shader would silently draw a DIFFERENT stream than the host. Use ` +
          `either a compile-time literal seed — the host-identical stream — ` +
          `or an explicitly invocation-varying seed symbol that is NOT in ` +
          `\`vars\`, which owns its own stream.`
      );
    throw new Error(
      `Could not compile \`WithRandomSeed(${symbol}, …)\`: the seed resolves to the shader ` +
        `constant \`${mapped}\`, which the seed ABI cannot fold. Use a ` +
        `compile-time numeric or string seed.`
    );
  }

  // A free symbol: the shader supplies its value (a uniform or varying the
  // caller declares), so there is no host counterpart to agree with and the
  // frame derives its OWN stream from the seed's BITS.
  const src = compile(seed).trim();
  return language === 'wgsl'
    ? `vec2<u32>(bitcast<u32>(${src}), 0u)`
    : `uvec2(floatBitsToUint(${src}), 0u)`;
}
