/**
 * The lowering of user functions: a call of a user function is a call of
 * an IR function, which is lowered once per binding (the definition that
 * the call's head resolves to, not its name), with its parameters as its
 * only names (a capture declines). The parameter and result types come
 * from the binding's signature; the effects of the functions are their
 * least fixed point (`functionEffects()`), settled when no function is
 * being lowered.
 */

import type { Type } from '../../../common/type/types.js';
import { isSubtype } from '../../../common/type/subtype.js';
import type { Expression } from '../../global-types.js';
import { isFunction } from '../../boxed-expression/type-guards.js';
import {
  isSubType,
  typeToString,
  type IRFunction,
  type IRType,
  type Lane,
} from './ir.js';
import { functionEffects, type Effect } from './effects.js';
import {
  decline,
  type Binding,
  type Fn,
  type Lowering,
} from './lower-context.js';
import { parameterName } from './lower-lists.js';

/**
 * The IR type of an input of the engine type `t`: a real, an integer, a
 * boolean, or a list of them of stated lengths, or of a run-time length
 * (the outer list). A scalar with no declared type (`unknown`) or of type
 * `number` is a real: this pipeline reads an undeclared name as a real
 * input. `any`, a list element of type `unknown` or `any`, and an inner
 * list of run-time length have no IR type.
 */
export function inputType(
  t: Type
): { lane: Lane; shape: (number | 'run-time')[] } | undefined {
  const lane = (t: Type, element: boolean): Lane | undefined => {
    if (t === 'number' || (t === 'unknown' && !element)) return 'real';
    if (t === 'unknown' || t === 'any') return undefined;
    if (isSubtype(t, 'integer')) return 'integer';
    if (isSubtype(t, 'real')) return 'real';
    return isSubtype(t, 'boolean') ? 'boolean' : undefined;
  };
  const shape: (number | 'run-time')[] = [];
  while (typeof t === 'object' && t.kind === 'list') {
    if (t.dimensions === undefined && shape.length === 0)
      shape.push('run-time');
    else if (!t.dimensions?.every((n) => Number.isInteger(n) && n > 0))
      return undefined;
    else shape.push(...t.dimensions);
    t = t.elements;
  }
  const l = lane(t, shape.length > 0);
  return l === undefined ? undefined : { lane: l, shape };
}

/** The scalar IR type of `t`, or a decline that names `what`. */
export function scalarOf(node: Expression, t: Type, what: string): IRType {
  const ir = inputType(t);
  if (ir === undefined || ir.shape.length > 0)
    decline(node, `${what} is not a scalar (${String(t)})`);
  return { lane: ir.lane, shape: [] };
}

/** The definition that the head of the call `e` resolves to, when it is a
 *  user function with a function literal, and the literal. */
export function userBinding(e: Fn): { key: object; literal: Fn } | undefined {
  const od = e.operatorDefinition as
    { _isLambda?: boolean; _lambdaLiteral?: Expression } | undefined;
  const key = od?._isLambda ? od : (e.valueDefinition as object | undefined);
  const value = od?._isLambda
    ? od._lambdaLiteral
    : (e.valueDefinition?.value as Expression | undefined);
  if (key === undefined || !isFunction(value, 'Function')) return undefined;
  return { key, literal: value as Fn };
}

/** The parameter names of a function literal, and its signature's types. */
function signatureTypes(e: Fn, literal: Fn) {
  const od = e.operatorDefinition as
    { _isLambda?: boolean; signature?: { type: Type } } | undefined;
  const declared = od?._isLambda
    ? od.signature?.type
    : e.valueDefinition?.type.type;
  const signature =
    typeof declared === 'object' && declared.kind === 'signature'
      ? declared
      : undefined;
  const names = literal.ops.slice(1).map((p) => {
    const n = parameterName(p);
    if (n === undefined)
      decline(literal, `a parameter of ${e.operator} that is not a name`);
    return n;
  });
  const params = names.map((p, i) =>
    scalarOf(
      literal,
      signature?.args?.[i]?.type ?? 'unknown',
      `the parameter ${p} of ${e.operator}`
    )
  );
  const r = signature?.result;
  const result =
    r === undefined || r === 'unknown' || r === 'number' || r === 'any'
      ? undefined
      : scalarOf(literal, r, `the result of ${e.operator}`);
  return { names, params, result };
}

/** A user function: the IR function, its parameter types and its result
 *  type (absent while its body is lowered, when it is not declared). */
type UserFunction = { name: string; params: IRType[]; result?: IRType };

export function functionLowering(cx: Lowering) {
  const { b, type } = cx;
  const functions = new Map<object, UserFunction>();
  /** The functions being lowered, by the name of their head: a call of
   *  that name in the body is the recursive call (its node can be bound
   *  before the definition is). */
  const pending = new Map<string, UserFunction>();
  let settled = new Map<string, Effect>();

  /** The IR function of the user function of `key`, lowered once. */
  const define = (e: Fn, key: object, literal: Fn): UserFunction => {
    const { names, params, result } = signatureTypes(e, literal);
    const fn: UserFunction = {
      name: `u${functions.size}_${e.operator.replace(/[^A-Za-z0-9]/g, '')}`,
      params,
      result,
    };
    functions.set(key, fn);
    pending.set(e.operator, fn);
    const values = params.map((t) => b.newValue(t));
    const ir: IRFunction = {
      name: fn.name,
      paramNames: names,
      lengthOf: names.map(() => false),
      body: { params: values, body: [], yields: [] },
      results: [],
    };
    const own = names.map((p, i): [string, Binding] => [
      p,
      { v: values[i], role: 'index' },
    ]);
    const outer = cx.frames.splice(0, cx.frames.length, {
      names: new Map(own),
      loop: false,
    });
    const caller = cx.inFunction;
    cx.inFunction = e.operator;
    try {
      b.define(ir, () => {
        const v = cx.scalar(literal.ops[0]);
        if (fn.result !== undefined && !isSubType(type(v), fn.result))
          decline(
            literal,
            `a body of ${e.operator} that is not ${typeToString(fn.result)}`
          );
        return [v];
      });
    } finally {
      cx.frames.splice(0, cx.frames.length, ...outer);
      cx.inFunction = caller;
    }
    fn.result ??= type(ir.body.yields[0]);
    ir.results.push(fn.result);
    pending.delete(e.operator);
    if (pending.size === 0) settled = functionEffects(cx.rows, b.functions);
    return fn;
  };

  /** A call of the user function that the head of `e` resolves to, or of
   *  the function of that name being lowered. */
  const call = (e: Fn, binding?: { key: object; literal: Fn }): number => {
    const fn = binding
      ? (functions.get(binding.key) ?? define(e, binding.key, binding.literal))
      : pending.get(e.operator)!;
    if (e.nops !== fn.params.length)
      decline(e, `${e.operator} with ${e.nops} arguments`);
    const args = e.ops.map((op, i) => {
      const v = cx.value(op)!;
      if (type(v).shape.length > 0)
        decline(
          op,
          `a list argument of ${e.operator} (the interpreter maps the function over the list)`
        );
      if (!isSubType(type(v), fn.params[i]))
        decline(
          op,
          `an argument of ${e.operator} that is not ${typeToString(fn.params[i])}`
        );
      return v;
    });
    if (fn.result === undefined)
      decline(
        e,
        `a recursive call of ${e.operator}, which has no declared result type (declare it, as (real) -> real)`
      );
    const out = b.newValue(fn.result);
    b.emit({ k: 'call', outs: [out], fn: fn.name, args });
    return out;
  };

  return {
    call,
    /** Whether `e` is a recursive call of a function being lowered. */
    recursive: (e: Fn) => pending.has(e.operator),
    /** The effect of the IR function `name`: effectful while it is not
     *  settled (a function being lowered). */
    effect: (name: string): Effect => settled.get(name) ?? 'effectful',
  };
}
