/**
 * The calls of a user function with a parameter name that the shader target
 * refuses, written in place in the prepare stage of a GLSL root compilation.
 *
 * GLSL reserves some names (`discard`, `filter`, `input`, `sample`), and it
 * has no way to rename a parameter. A user function with such a parameter
 * name cannot be emitted as a shader function (the `define` hook of
 * `gpu-shader-target.ts` refuses it, with `gpuCheckIdentifier()`). Its call
 * can still be compiled when its body is written at the call site with the
 * arguments in place of the parameters: the parameter names are then never
 * written. This pass does that substitution in the prepare stage, before the
 * typing pass of the GLSL fragment, so the pass types the tree that the
 * emitter writes. A call that the pass leaves as a call keeps the parameter
 * names, and the typing pass refuses them.
 *
 * The substitution is `BaseCompiler.inlinedUserFunctionCall()`, the one that
 * the emitter uses for a call whose definition it cannot emit. It is sound
 * only when the substituted body computes what the call computes, once: the
 * callee is a pure literal of one statement and not recursive, and every
 * argument is pure and is a scalar or a literal point. Otherwise the call
 * stays a call.
 *
 * The call also stays a call when an argument or the body of the callee
 * runs code that the caller supplies (`reachesCallerCodeOn()`: a `vars`
 * source that is not a plain read, a `functions` entry that is not declared
 * pure, a `compile` handler). The interpreter runs the code of each
 * argument once per call, and the code of the body once per call. The
 * substituted body can read a parameter zero times (`If(x > 0, discard,
 * 0)`), several times (`Sum(discard, k, 1, 3)`), or in a short-circuit
 * operand (`And(x > 0, discard > 1)`), and the substituted copies of two
 * calls share the one node of a symbol of the body. The binding of caller
 * code (`gpuSeparateCallerCode()`) ran before this pass, so it cannot bind
 * that code again.
 *
 * The call also stays a call when the static type of an argument is not a
 * subtype of the type that the callee declares for its parameter
 * (`argumentsHaveDeclaredTypes()`). The typing pass refuses such a call of
 * an emitted function (`magnitude(z)` with `magnitude := (u: real) ↦
 * Abs(u)` and `z: complex`), and the interpreter does not apply the
 * function, while the substituted body (`Abs(z)`) would give a value.
 * `appliedArgumentTypeMismatch()` is not used here: it asks whether the
 * types could match, and `complex` could match `real`.
 *
 * A call inside the body of a function that is emitted as a shader function
 * is not in the root, and this pass does not see it. The typing pass refuses
 * such a call.
 */

import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { boundVariableNames } from '../boxed-expression/binders.js';
import { scopeForRebuild } from '../boxed-expression/binding-sites.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from '../boxed-expression/function-literal.js';
import { isSubtype } from '../../common/type/subtype.js';
import { BaseCompiler } from './base-compiler.js';
import { reachesCallerCodeOn } from './compile-folding.js';

/**
 * Whether the static type of each argument is a subtype of the type that the
 * function literal `literal` declares for its parameter. A parameter with no
 * declared type, and a symbol whose type is open (`unknown`), are not
 * checked: the shader reads a free symbol of open type as a `float` input,
 * and a value outside the declared type is an input outside its type. Any
 * other argument of open type fails the check, so the call stays a call.
 */
function argumentsHaveDeclaredTypes(
  literal: Expression,
  args: ReadonlyArray<Expression>
): boolean {
  if (!isFunction(literal)) return false;
  return literal.ops.slice(1).every((p, i) => {
    const declared = functionLiteralParameterType(p);
    const arg = args[i];
    if (declared === undefined || arg === undefined) return true;
    const type = arg.type.type;
    return (type === 'unknown' && isSymbol(arg)) || isSubtype(type, declared);
  });
}

/**
 * `expr` with each call of a user function that has a parameter name that
 * the target refuses (`refusesParameterName` of the lowering of the user
 * functions) replaced by the substituted body of the function, when the
 * substitution is sound. The names of the substituted functions are added
 * to `target.symbolDeps`, since the generated code bakes their definitions.
 * `isOverridden` tells whether the caller supplies the code of a name (the
 * `functions` or `vars` option): such a call is the caller's code and is
 * never substituted.
 */
export function inlineReservedParameterCalls(
  expr: Expression,
  target: CompileTarget<Expression>,
  isOverridden: (name: string) => boolean
): Expression {
  const registry = target.userFunctions;
  const refuses = registry?.lowering?.refusesParameterName;
  if (registry === undefined || refuses === undefined) return expr;
  const engine = expr.engine;

  const refusedByName = new Map<string, boolean>();
  const hasRefusedParameter = (h: string): boolean => {
    let known = refusedByName.get(h);
    if (known === undefined) {
      const literal = isOverridden(h)
        ? undefined
        : BaseCompiler.userFunctionLiteral(engine, h);
      known =
        literal !== undefined &&
        literal.ops.slice(1).some((p) => {
          const name = functionLiteralParameterName(p);
          return name !== '' && refuses(name);
        });
      refusedByName.set(h, known);
    }
    return known;
  };
  const mentions = new WeakMap<Expression, boolean>();
  const mentionsRefusedCall = (node: Expression): boolean => {
    if (!isFunction(node)) return false;
    let known = mentions.get(node);
    if (known === undefined) {
      known =
        hasRefusedParameter(node.operator) ||
        node.ops.some((op) => mentionsRefusedCall(op));
      mentions.set(node, known);
    }
    return known;
  };
  if (!mentionsRefusedCall(expr)) return expr;

  // A node that several parents reach is rewritten once for each set of
  // names that the enclosing binders bind, so the result keeps the sharing
  // of the input and a shared graph is not walked once per path. The memo
  // is keyed by the set object: the walk makes a new set at each binder and
  // never changes a set after it makes it, so one set object always holds
  // the same names. The target with those bound names is also kept by set.
  const memo = new WeakMap<
    ReadonlySet<string>,
    {
      results: Map<Expression, Expression>;
      target: CompileTarget<Expression>;
    }
  >();
  const recordOf = (bound: ReadonlySet<string>) => {
    let record = memo.get(bound);
    if (record === undefined) {
      record = {
        results: new Map(),
        target: bound.size > 0 ? { ...target, boundVars: bound } : target,
      };
      memo.set(bound, record);
    }
    return record;
  };
  const walk = (node: Expression, bound: ReadonlySet<string>): Expression => {
    if (!isFunction(node) || !mentionsRefusedCall(node)) return node;
    // A `Function` literal is left as written: rebuilding it runs the
    // canonicalization of the literal again, which declares its parameters
    // in a new scope.
    if (node.operator === 'Function') return node;
    const record = recordOf(bound);
    const known = record.results.get(node);
    if (known !== undefined) return known;
    const binds = boundVariableNames(node);
    const within = binds.length > 0 ? new Set([...bound, ...binds]) : bound;
    const ops = node.ops.map((op) => walk(op, within));
    const h = node.operator;
    let result: Expression | undefined;
    // A call of a name that an enclosing binder binds is a call of that
    // binding, which no definition of the engine describes.
    if (
      binds.length === 0 &&
      !bound.has(h) &&
      !(registry.inlining?.has(h) ?? false) &&
      hasRefusedParameter(h)
    ) {
      // The names that the enclosing binders bind are the bound names of
      // the target, which the substitution reads to decline a body whose
      // free symbol one of them would capture.
      // A free symbol whose type is open (`unknown`) is not a scalar by its
      // static type, but the shader reads it as a `float` input, which is
      // also what an emitted definition would receive, so it is admitted
      // as an argument (`loweredSymbolType`, as in `gpu-shared-calls.ts`).
      // A call whose argument or callee body runs caller code, or whose
      // argument type cannot match its declared parameter type, stays a
      // call (see the header of this module).
      const callTarget = record.target;
      const literal = BaseCompiler.userFunctionLiteral(engine, h);
      const inlined =
        literal === undefined ||
        ops.some((a) => reachesCallerCodeOn(a, callTarget)) ||
        reachesCallerCodeOn(literal.op1, callTarget) ||
        !argumentsHaveDeclaredTypes(literal, ops)
          ? undefined
          : BaseCompiler.inlinedUserFunctionCall(
              engine,
              h,
              ops,
              callTarget,
              (a) => target.loweredSymbolType?.(a) === 'float'
            );
      if (inlined !== undefined) {
        target.symbolDeps?.add(h);
        // A call of a function with a refused parameter name in the
        // substituted body is written in place in turn. `inlining` holds
        // the functions whose body is being rewritten, so a mutually
        // recursive pair stops.
        const inlining = (registry.inlining ??= new Set<string>());
        inlining.add(h);
        try {
          result = walk(inlined, bound);
        } finally {
          inlining.delete(h);
        }
      }
    }
    if (result === undefined) {
      if (ops.every((op, i) => op === node.ops[i])) result = node;
      else {
        // A node that binds names is rebuilt onto its own scope
        // (`scopeForRebuild`), so that a binder nested in it still points
        // at that scope. When the scope cannot be reused, the node is left
        // as written, and its calls stay calls.
        const scope = scopeForRebuild(node.localScope, engine, h, ops);
        result =
          binds.length > 0 && scope === undefined
            ? node
            : engine._fn(h, ops, { scope });
      }
    }
    record.results.set(node, result);
    return result;
  };
  return walk(expr, new Set());
}
