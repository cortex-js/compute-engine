// The application of a derivative on the GLSL target, written in place of
// the call in the prepare stage.
//
// The parse of `f'(x)` is `Apply(Derivative(f, 1), x)`. A shader has no
// function values, so the callee cannot be called. When the engine finds a
// closed form of the derivative, a function literal, the call is replaced by
// the body of that literal with the arguments in place of its parameters,
// or, when the interpreter applies the function to each element of a
// collection argument, by a `List` of such bodies (`gpuAppliedBody()`).
//
// The rewrite runs in the prepare stage, on the root (`prepareRoot()` and
// the routes of `compileFunction()` and `compileShader()`, in
// `gpu-shader-target.ts`) and on each body of a user function
// (`CompileTarget.applyDerivatives`, which `definitionBodyExpr()` and
// `inlinedUserFunctionCall()` call). So the typing pass of the GLSL fragment
// (`canCompile()`) types the tree that the emitter writes, as for any other
// node: for a list argument, the pass sees the `List` of bodies, one for each
// element, and not the body with the whole list in place of the parameter.
//
// An application that the rewrite cannot write stays as it is, and the pass
// refuses it with the reason (`gpuAppliedBody()` returns it).
//
// The same walk writes a `Sum` or a `Product` with more than one index set
// as a nest of one aggregate per index (`nestMultiIndexAggregate()`), so
// that this rewrite also reaches every route where such an aggregate can
// get to the emitter, and the pass types the nest that the emitter writes.

import type { BoxedDefinition, Expression, Scope } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { INDEXED_COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  declaredBinderNamesOf,
  scopeForRebuild,
} from '../boxed-expression/binding-sites.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { collectBinderNames } from '../boxed-expression/utils.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { isBroadcastableCollection } from '../collection-utils.js';
import { literalParamsMap } from '../library/core.js';
import {
  assertNoCurriedApplication,
  isPartialApplication,
  partialApplicationDecline,
} from './partial-application.js';
import { completedLiteralArguments } from './compile-parameter-defaults.js';
import { rangeCount } from '../numerics/range-count.js';
import { BaseCompiler } from './base-compiler.js';
import { reachesCallerCodeOn } from './compile-folding.js';
import { compiledNodeWhere } from './compile-static-type-error.js';
import { GPU_MAX_INLINE_ELEMENTS } from './gpu-functions.js';
import { gpuOperandShape } from './gpu-shapes.js';

/**
 * `expr` with each application of a derivative, `Apply(Derivative(f, …),
 * x…)`, replaced by the closed form of the derivative applied to its
 * arguments (`gpuAppliedBody()`), and with each `Sum` or `Product` of more
 * than one index set written as a nest (`nestMultiIndexAggregate()`). A
 * tree with no such node is returned unchanged.
 *
 * The rewrite keeps the value and the evaluations of the interpreter:
 *  - `gpuAppliedBody()` requires each argument to be pure. The body can
 *    read a parameter more than once; each read is the same node object,
 *    which the common-subexpression pass and the binding of caller code
 *    (`gpu-caller-binding.ts`) treat as one evaluation.
 *  - An application whose argument runs code that the caller supplies
 *    (`reachesCallerCodeOn()` on `target`: a `vars` source that is not a
 *    plain read, a `functions` entry that is not declared pure, a `compile`
 *    handler) is not rewritten. The body can read a parameter in another
 *    order than the arguments are written, or not at all, and the
 *    interpreter runs the code of each argument once, from the first to the
 *    last. The pass refuses such an application.
 *  - An application with an argument that is not valid (it holds an
 *    `Error`) or that holds a sub-expression of static type `error` is not
 *    rewritten. The closed form can leave out an argument (the derivative
 *    of `u ↦ u` is `1`), and the argument is then not in the tree that the
 *    pass checks, while the interpreter gives an error. The pass refuses
 *    the application that stays.
 *
 * The stored value of a symbol is not entered here: the pass and the
 * emitter read it in place of the symbol, and each one rewrites it with
 * this function when it reads it (`storedValue` in `glsl-fragment.ts`,
 * `tryFoldKnownSymbol()`).
 *
 * A node object at several places of the tree is rewritten once, and the
 * places keep one node object. The closed form is itself rewritten, since
 * it can hold the derivative of another function.
 */
export function gpuApplyDerivatives(
  expr: Expression,
  target: CompileTarget<Expression>
): Expression {
  const ce = expr.engine;
  // Whether a subtree holds an `Apply` node or a multi-index aggregate, by
  // node.
  const holds = new Map<Expression, boolean>();
  const holdsRewrite = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    let known = holds.get(node);
    if (known === undefined) {
      known =
        node.operator === 'Apply' ||
        isMultiIndexAggregate(node) ||
        node.ops.some(holdsRewrite);
      holds.set(node, known);
    }
    return known;
  };
  const done = new Map<Expression, Expression>();
  const walk = (node: Expression): Expression => {
    if (!holdsRewrite(node) || !isFunction(node)) return node;
    const known = done.get(node);
    if (known !== undefined) return known;
    const ops = node.ops.map(walk);
    let result: Expression = ops.every((op, i) => op === node.ops[i])
      ? node
      : ce._fn(node.operator, ops, {
          scope: scopeForRebuild(node.localScope, ce, node.operator, ops),
        });
    if (
      isFunction(result, 'Apply') &&
      isFunction(result.op1, 'Derivative') &&
      !result.ops
        .slice(1)
        .some(
          (x) =>
            !x.isValid ||
            compiledNodeWhere(x, target, (n) => n.type.type === 'error') !==
              undefined ||
            reachesCallerCodeOn(x, target)
        )
    ) {
      const body = gpuAppliedBody(result.ops, target.language ?? 'glsl');
      if (typeof body !== 'string') result = walk(body);
    }
    result = nestMultiIndexAggregate(result);
    done.set(node, result);
    return result;
  };
  return walk(expr);
}

/** A `Sum` or a `Product` with more than one index set. */
function isMultiIndexAggregate(node: Expression): boolean {
  return (
    (isFunction(node, 'Sum') || isFunction(node, 'Product')) && node.nops > 2
  );
}

/**
 * `Sum(body, L1, L2, …)` written as the nest `Sum(Sum(body, L2, …), L1)`,
 * the first index outermost, and the inner aggregate nested again when it
 * has more than one index set (the same for `Product`). Any other node is
 * returned unchanged.
 *
 * The shader code has one loop (or one unrolled series of terms) for each
 * aggregate node, and the emitter compiles one index set for each. The
 * interpreter also visits the terms with the first index outermost, and the
 * bounds of an inner index set can read an outer index. So the nest has the
 * value of the interpreter, and the body and each bound are evaluated as
 * many times as in the interpreter.
 *
 * The outer node keeps the scope of the original node, which binds every
 * index (`scopeForRebuild()`). The inner node gets a scope of its own, a
 * child of that scope, that binds the indexes of its index sets to the same
 * definitions, as the canonical form of a `Sum` binds its indexes in its
 * own scope (`canonicalBigop()`). The body and the bounds are not rebuilt:
 * their symbols keep their definitions.
 */
function nestMultiIndexAggregate(node: Expression): Expression {
  if (!isMultiIndexAggregate(node) || !isFunction(node)) return node;
  const ce = node.engine;
  const outer = node.localScope;
  const [body, first, ...rest] = node.ops;
  const innerOps = [body, ...rest];
  let scope: Scope | undefined;
  if (outer !== undefined) {
    const bindings = new Map<string, BoxedDefinition>();
    let complete = true;
    for (const name of declaredBinderNamesOf(ce, node.operator, innerOps)) {
      const def = outer.bindings.get(name);
      if (def === undefined) complete = false;
      else bindings.set(name, def);
    }
    // A canonical aggregate binds each of its indexes in its own scope. If
    // one is missing, the inner node gets no scope, as `scopeForRebuild()`
    // gives none for a scope that does not bind every declared index.
    if (complete)
      scope = {
        parent: outer,
        bindings,
        binderNames: new Set(bindings.keys()),
      };
  }
  const inner = nestMultiIndexAggregate(
    ce._fn(node.operator, innerOps, { scope })
  );
  return ce._fn(node.operator, [inner, first], { scope: outer });
}

/**
 * The body of the callee of `Apply(callee, args…)` with the arguments
 * substituted for its parameters, or the reason why there is none.
 *
 * Two callees have a function literal. A `Function` literal is its own
 * literal. A `Derivative(f, n)` or a `Derivative(f, k₁, …, kₙ)` has the
 * closed form of the derivative when the engine can differentiate `f`, and
 * the interval target reads the same closed form
 * (`BaseCompiler.appliedDerivativeLiteral`). That closed form is
 * already rewritten for the engine's angular unit. It is not used when the
 * body of `f` is large or the order is high (`prefersJetDerivative`,
 * jet-derivative.ts), because the closed form then grows past a useful size.
 * A derivative with no closed form of a useful size, or any other callee, has
 * no literal, and the application is declined.
 *
 * The substitution is sound only under these conditions:
 *  - the literal takes exactly one argument per parameter, and each
 *    parameter is a plain name (not a rest parameter and not a
 *    destructuring pattern). The interpreter curries an under-applied call
 *    and rejects an over-applied one. Partial applications and calls of
 *    their results decline on every compile target;
 *  - the body is a single statement;
 *  - every argument is pure. The body can read a parameter more than once,
 *    and the substitution then repeats the argument, while the interpreter
 *    evaluates it once;
 *  - no binder in the body rebinds a parameter or binds a symbol of an
 *    argument. This condition is stricter than the substitution needs:
 *    `subs` replaces only the free occurrences of a parameter, and renames
 *    an inner binder that would capture a symbol of an argument, except in
 *    the cases that `subsIfCaptureFree()`
 *    (`boxed-expression/subs-capture-mode.ts`) lists.
 *
 * When the parameters of the literal are scalar and an argument is a
 * collection, the interpreter applies the function to each element, not to
 * the whole collection. The substitution then follows the same rule
 * (`gpuMappedAppliedBody`).
 *
 * An argument that is bound whole must match the declared type of its
 * parameter (`BaseCompiler.appliedArgumentTypeMismatch`), or the
 * application is declined.
 */
export function gpuAppliedBody(
  args: ReadonlyArray<Expression>,
  language: string
): Expression | string {
  // Diagnose currying before inspecting the literal's parameters.
  try {
    assertNoCurriedApplication(args);
  } catch (e) {
    return (e as Error).message.replace(/^Could not compile `Apply`: /, '');
  }
  if (isPartialApplication(args)) return partialApplicationDecline();
  const [callee, ...written] = args;
  if (callee === undefined) return 'missing function';
  let actuals: ReadonlyArray<Expression> = written;
  const literal = isFunction(callee, 'Derivative')
    ? BaseCompiler.appliedDerivativeLiteral(args)
    : callee;
  if (!isFunction(literal, 'Function')) {
    if (isFunction(callee, 'Derivative'))
      return (
        `${BaseCompiler.appliedDerivativeDeclineReason(args)}, and ` +
        `target '${language}' has no numerical derivative.`
      );
    return (
      `only a function literal or the derivative of a function compiles as ` +
      `the callee on target '${language}'.`
    );
  }
  // A call that leaves out parameters with a default value is completed with
  // the default operands, as operands written at this call site
  // (`completedLiteralArguments`): a shader function has no default
  // parameters.
  const completed = completedLiteralArguments(literal, actuals);
  if (completed !== undefined) actuals = completed;
  const params = literal.ops.slice(1);
  if (params.length !== actuals.length)
    return (
      `the function takes ${params.length} parameter(s) but ` +
      `${actuals.length} argument(s) are supplied.`
    );
  const substitution: Record<string, Expression> = {};
  for (const [i, p] of params.entries()) {
    const name = isRestParameter(p) ? '' : functionLiteralParameterName(p);
    if (!name) return 'a parameter of the function is not a plain name.';
    substitution[name] = actuals[i];
  }
  const inner = literal.ops[0];
  const body =
    isFunction(inner, 'Block') && inner.nops === 1 ? inner.op1 : inner;
  if (isFunction(body, 'Block'))
    return 'the body of the function has more than one statement.';
  if (!actuals.every((a) => a.isPure === true))
    return 'an argument has an effect, which the substitution would repeat.';
  const binders = collectBinderNames(body);
  for (const [name, arg] of Object.entries(substitution)) {
    if (binders.has(name))
      return `the body of the function rebinds \`${name}\`.`;
    for (const s of arg.symbols)
      if (binders.has(s))
        return `the body of the function binds \`${s}\`, which an argument reads.`;
  }
  if (literalParamsMap(literal.type.type) && actuals.some(gpuMapsOverArgument))
    return gpuMappedAppliedBody(
      literal,
      body,
      Object.keys(substitution),
      actuals,
      language
    );
  const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
    literal,
    actuals,
    false
  );
  if (mismatch !== undefined) return mismatch;
  return body.subs(substitution);
}

/**
 * The application of a function literal with scalar parameters to arguments
 * of which at least one is a collection, written element by element:
 * `Apply(u ↦ body, [a, b])` becomes `[body[u := a], body[u := b]]`, or the
 * reason why it cannot be written.
 *
 * The interpreter applies such a function to each element of the collection
 * arguments (`applyLiteralMapped` in `library/core.ts`). It zips the
 * collection arguments, and it gives each cell the same value of an argument
 * that is not a collection (a scalar, a point or a string). Substituting the
 * whole collection for the parameter is wrong: a body that does not read
 * the parameter (`u ↦ 7`) gives one number instead of one number per
 * element, and a body with an operation that does not apply element by
 * element gives a different value.
 *
 * Each collection argument must have a length known at compile time
 * (`gpuMappedArgumentElements`), and all of them must have the same length.
 * The interpreter gives an `incompatible-dimensions` error for different
 * lengths, and a shader has no form of that error, so the application is
 * declined. A cell whose element is itself a collection maps again, as in
 * the interpreter, so a nested list gives a nested result. The shape of the
 * result is decided when the `List` is compiled.
 *
 * `names` are the parameter names of the literal, in order. The checks of
 * `gpuAppliedBody` (purity, binders) apply to the whole arguments, so they
 * also apply to their elements.
 */
function gpuMappedAppliedBody(
  literal: Expression,
  body: Expression,
  names: ReadonlyArray<string>,
  actuals: ReadonlyArray<Expression>,
  language: string
): Expression | string {
  let width: number | undefined;
  const columns: Array<ReadonlyArray<Expression> | undefined> = [];
  for (const actual of actuals) {
    if (!gpuMapsOverArgument(actual)) {
      columns.push(undefined);
      continue;
    }
    const elements = gpuMappedArgumentElements(actual);
    if (elements === undefined)
      return (
        `the function applies to each element of the argument ` +
        `\`${actual.toString()}\`, but target '${language}' cannot ` +
        `write out its elements: its length is not known at compile time, ` +
        `or it has more than ${GPU_MAX_INLINE_ELEMENTS} elements.`
      );
    if (width !== undefined && elements.length !== width)
      return (
        `the function applies to each element of collection arguments of ` +
        `different lengths (${width} and ${elements.length}).`
      );
    width = elements.length;
    columns.push(elements);
  }
  const cells: Expression[] = [];
  for (let k = 0; k < (width ?? 0); k++) {
    const row = actuals.map((actual, i) => columns[i]?.[k] ?? actual);
    if (
      row.some((e, i) => columns[i] !== undefined && gpuMapsOverArgument(e))
    ) {
      const cell = gpuAppliedBody([literal, ...row], language);
      if (typeof cell === 'string') return cell;
      cells.push(cell);
    } else {
      const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
        literal,
        row,
        false
      );
      if (mismatch !== undefined) return mismatch;
      const substitution: Record<string, Expression> = {};
      for (const [i, name] of names.entries()) substitution[name] = row[i];
      cells.push(body.subs(substitution));
    }
  }
  return literal.engine.function('List', cells);
}

/**
 * Does a function literal with scalar parameters apply to each element of
 * the argument `arg`, not to `arg` as a whole?
 *
 * The interpreter evaluates the argument first and then asks whether the
 * value is an indexed collection that is not a tuple (a point) and not a
 * string (`applyLiteralMaps` in `library/core.ts`). Compiled code reads the
 * argument before it is evaluated, so the static type gives the answer
 * instead, as in the type handler of `Apply` (`applyLiteralMapType`):
 * `[a, b] + c` has the type `vector<2>` and is a list when evaluated, and a
 * symbol declared `list<real^2>` holds a list when the shader runs.
 */
function gpuMapsOverArgument(arg: Expression): boolean {
  if (isBroadcastableCollection(arg)) return true;
  const t = resolveTypeAlias(arg.type.type);
  return (
    isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, 'string') &&
    !(typeof t === 'object' && t.kind === 'tuple')
  );
}

/**
 * The elements of a collection argument that `gpuMappedAppliedBody` writes
 * out, or `undefined` when the length is not known at compile time.
 *
 * A literal `List` gives its operands. A `Range` with number-literal bounds
 * gives its values, as the `Range` entry of the function table does. Another
 * expression that the shader holds as a `vec2`, `vec3` or `vec4`
 * (`gpuOperandShape`) gives its components, read with `At`. Any other
 * collection (a shader array, a matrix, a list of unknown length) gives
 * `undefined`. A list with more elements than a shader array constructor
 * takes (`GPU_MAX_INLINE_ELEMENTS`) also gives `undefined`.
 */
function gpuMappedArgumentElements(
  arg: Expression
): ReadonlyArray<Expression> | undefined {
  const ce = arg.engine;
  if (isFunction(arg, 'List'))
    return arg.nops <= GPU_MAX_INLINE_ELEMENTS ? arg.ops : undefined;
  if (isFunction(arg, 'Range') && (arg.nops === 2 || arg.nops === 3)) {
    const lo = arg.ops[0].re;
    const hi = arg.ops[1].re;
    const step = arg.nops === 3 ? arg.ops[2].re : 1;
    if (![lo, hi, step].every(Number.isFinite) || step === 0) return undefined;
    const count = rangeCount(lo, hi, step);
    if (count > GPU_MAX_INLINE_ELEMENTS) return undefined;
    return Array.from({ length: count }, (_, k) => ce.number(lo + k * step));
  }
  const shape = gpuOperandShape(arg);
  if (typeof shape !== 'number') return undefined;
  return Array.from({ length: shape }, (_, k) =>
    ce.function('At', [arg, ce.number(k + 1)])
  );
}
