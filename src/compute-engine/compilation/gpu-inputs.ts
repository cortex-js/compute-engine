// The shader inputs: the text symbols of an expression, the refusals of a
// symbol that no shader declaration holds, and the `vars` entries that read
// a uniform.

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import {
  BaseCompiler,
  isProvablyCharacterOperand,
  isProvablyStringOperand,
} from './base-compiler.js';
import { gpuPointOrPointListUnion } from './gpu-declared-types.js';
import { gpuTupleWithoutShaderType } from './gpu-shapes.js';
import { gpuPointOrPointListRefusal } from './gpu-points.js';
import type { Type } from '../../common/type/types.js';
import { resolveTypeForCompiledLanes as resolveTypeForCompilation } from '../../common/type/utils.js';

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
          `(\`list<real^8>\`, \`matrix<real^3x3>\`).`
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
 * refused when it is a list with a dimension of 0, because GLSL
 * has no array of zero elements. A list type whose dimensions are all
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
      const inner = names.length === 0 ? bound : new Set([...bound, ...names]);
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
 * A uniform is read-only in GLSL. The one way for a read of `path`
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
