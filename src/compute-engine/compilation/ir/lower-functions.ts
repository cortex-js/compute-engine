/**
 * The lowering of user functions: a call of a user function is a call of
 * an IR function, which is lowered once per binding (the definition that
 * the call's head resolves to, not its name), with its parameters and the
 * inputs that its body reads (`capture()`) as its only names. The
 * parameter and result types come from the binding's signature; the
 * effects of the functions are their least fixed point
 * (`functionEffects()`), computed when a function is lowered: a call of a
 * function still being lowered is effectful until then, so an effect is
 * never below the final one.
 */

import { isForwardCallReference } from '../../boxed-expression/forward-call-reference.js';
import type { Type } from '../../../common/type/types.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import { isSubtype } from '../../../common/type/subtype.js';
import type { Expression } from '../../global-types.js';
import { isFunction } from '../../boxed-expression/type-guards.js';
import {
  isSubLane,
  isSubType,
  sameShape,
  typeToString,
  type IRFunction,
  type IRType,
  type Lane,
  type V,
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
 * boolean, a complex (a scalar), or a list of reals, integers or booleans
 * of stated lengths, or of a run-time length (the outer list). A scalar
 * with no declared type (`unknown`) or of type `number` is `wide`: a real,
 * or a complex in `mode: 'complex'`. `any`, a list element of type
 * `unknown` or `any`, and an inner list of run-time length have no IR
 * type.
 */
export function inputType(
  t: Type,
  wide: 'real' | 'complex' = 'real'
): { lane: Lane; shape: (number | 'run-time')[] } | undefined {
  const lane = (t: Type, element: boolean): Lane | undefined => {
    t = present(t);
    // A complex list entry declines (below).
    if (t === 'number' || (t === 'unknown' && !element))
      return !element ? wide : wide === 'complex' ? undefined : 'real';
    if (t === 'unknown' || t === 'any') return undefined;
    if (isSubtype(t, 'integer')) return 'integer';
    if (isSubtype(t, 'real') || extendedReal(t)) return 'real';
    // A list entry of a complex list can be a number or a `{re, im}`
    // object (docs/COMPILATION-MODEL.md, the ABI): only a run-time test
    // tells them apart, so such a list declines.
    if (isSubtype(t, 'complex')) return element ? undefined : 'complex';
    return isSubtype(t, 'boolean') ? 'boolean' : undefined;
  };
  const shape: (number | 'run-time')[] = [];
  while (typeof t === 'object' && t.kind === 'list') {
    // A length of -1 is a stated rank of no stated length (`vector`).
    const free = t.dimensions === undefined || t.dimensions?.join() === '-1';
    if (free && shape.length === 0) shape.push('run-time');
    else if (!t.dimensions?.every((n) => Number.isInteger(n) && n > 0))
      return undefined;
    else shape.push(...t.dimensions);
    t = t.elements;
  }
  const l = lane(t, shape.length > 0);
  return l === undefined ? undefined : { lane: l, shape };
}

/** A union of one type and `nan` or `missing` members is that type
 *  (`missing | rational`, `integer | nan` is an integer, `nan | number`,
 *  `complex | nan`): the compiled
 *  code gives NaN where the interpreter gives `Missing` (the caveats of
 *  compiled code). */
function present(t: Type): Type {
  if (typeof t !== 'object' || t.kind !== 'union') return t;
  const rest = t.types.filter((u) => u !== 'nan' && u !== 'missing');
  return rest.length === 1 ? rest[0] : t;
}

/** `t` is a union whose every member is a real type, `nan` or an infinity
 *  (`nan | real | signed_infinity`): a double holds each of its values, so
 *  it is on the real lane, also when the finite members are integers. */
function extendedReal(t: Type): boolean {
  const member = (u: Type): boolean =>
    typeof u === 'object' && u.kind === 'union'
      ? u.types.every(member)
      : u === 'nan' || isSubtype(u, 'real') || isSubtype(u, 'infinity');
  return typeof t === 'object' && t.kind === 'union' && member(t);
}

/** The scalar IR type of `t`, or a decline that names `what`. */
export function scalarOf(node: Expression, t: Type, what: string): IRType {
  const ir = inputType(t);
  if (ir === undefined || ir.shape.length > 0)
    decline(node, `${what} is not a scalar (${engineTypeToString(t)})`);
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
  // A list of reals or integers, of a stated or a run-time length (`'run-time'`,
  // a hidden length parameter before it).
  const params = names.map((p, i) => {
    const t = signature?.args?.[i]?.type ?? 'unknown';
    const list = inputType(t);
    return list !== undefined &&
      list.shape.length === 1 &&
      (list.lane === 'real' || list.lane === 'integer')
      ? list
      : {
          lane: scalarOf(literal, t, `the parameter ${p} of ${e.operator}`)
            .lane,
          shape: [],
        };
  });
  const r = signature?.result && present(signature.result);
  // A list of reals, integers or booleans: the type of the body, whose
  // length can be a value of the body.
  const ir = r === undefined ? undefined : inputType(r);
  const list = ir?.shape.length === 1 ? ir : undefined;
  const result =
    r === undefined ||
    r === 'unknown' ||
    r === 'number' ||
    r === 'any' ||
    list !== undefined
      ? undefined
      : scalarOf(literal, r, `the result of ${e.operator}`);
  return { names, params, result, list, r };
}

/** A user function: the IR function, its parameter types and its result
 *  type (absent while its body is lowered, when it is not declared). The
 *  inputs of the compilation that its body reads are parameters after
 *  `params` (`capture()`), in the order of their first read; `called` when
 *  a call of it was made while its body is lowered. */
type UserFunction = {
  key: object;
  params: { lane: Lane; shape: readonly (number | 'run-time')[] }[];
  /** The number of parameters of `ir` for `params` (with the lengths). */
  own: number;
  result?: IRType;
  ir: IRFunction;
  inputs: Type[];
  called: boolean;
};

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
    const { names, params, result, list, r } = signatureTypes(e, literal);
    const ir: IRFunction = {
      name: `u${functions.size}_${e.operator.replace(/[^A-Za-z0-9]/g, '')}`,
      source: e.operator,
      paramNames: [],
      lengthOf: [],
      body: { params: [], body: [], yields: [] },
      results: [],
    };
    const param = (name: string, t: IRType, length = false): V => {
      const v = b.newValue(t);
      ir.body.params.push(v);
      ir.paramNames.push(name);
      ir.lengthOf.push(length);
      return v;
    };
    const values = params.map((t, i) => {
      const shape = t.shape.map((n) =>
        n === 'run-time'
          ? { v: param(names[i], { lane: 'integer', shape: [] }, true) }
          : n
      );
      return param(names[i], { lane: t.lane, shape });
    });
    const fn: UserFunction = {
      key,
      params,
      own: ir.body.params.length,
      result,
      ir,
      inputs: [],
      called: false,
    };
    functions.set(key, fn);
    pending.set(e.operator, fn);
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
        const body = list
          ? cx.value(literal.ops[0])!
          : cx.scalar(literal.ops[0]);
        const t = type(body);
        if (
          list !== undefined &&
          (cx.tuples.has(body) ||
            t.shape.length !== 1 ||
            !isSubLane(t.lane, list.lane) ||
            (list.shape[0] !== 'run-time' &&
              !sameShape(t.shape, list.shape as number[], cx.constant)))
        )
          decline(
            literal,
            `a body of ${e.operator} that is not ${engineTypeToString(r!)}`
          );
        // A real body of a complex result is converted.
        const v =
          fn.result?.lane === 'complex' && type(body).lane !== 'boolean'
            ? cx.widen(body, 'complex')
            : body;
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
    // A `Comprehension` in the body of a function being lowered reads the
    // effect of a function it calls (`flips` in `moves`).
    settled = functionEffects(cx.rows, b.functions);
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
    const args = e.ops.flatMap((op, i) => {
      const p = fn.params[i];
      const v = cx.widen(cx.value(op)!, p.lane);
      const t = type(v);
      // A list parameter of a run-time length reads the argument's length.
      const n = t.shape[0];
      const length =
        p.shape[0] !== 'run-time' || n === undefined
          ? []
          : [typeof n === 'number' ? b.constant(n, 'integer') : n.v];
      const declared = {
        lane: p.lane,
        shape: p.shape.map((m) => (m === 'run-time' ? n : m)),
      } as IRType;
      if (p.shape.length === 0 && t.shape.length > 0)
        decline(
          op,
          `a list argument of ${e.operator} (the interpreter maps the function over the list)`
        );
      if (cx.tuples.has(v) || !isSubType(t, declared, cx.constant))
        decline(
          op,
          `an argument of ${e.operator} that is not ${typeToString(declared)}`
        );
      return [...length, v];
    });
    if (fn.result === undefined)
      decline(
        e,
        `a recursive call of ${e.operator}, which has no declared result type (declare it, as (real) -> real)`
      );
    // A call of a function being lowered (recursive) passes no input: it
    // declines when the function reads one (`capture()`).
    if (pending.get(e.operator) === fn) {
      if (fn.inputs.length > 0)
        decline(
          e,
          `a recursive call of ${e.operator}, which reads the input ${fn.ir.paramNames[fn.own]} (a function on a cycle of calls reads no input)`
        );
      fn.called = true;
    }
    // The inputs that the body reads, read here (`free()`).
    const inputs = fn.inputs.map((t, j) => {
      const k = fn.own + j;
      const p = type(fn.ir.body.params[k]);
      const v = cx.widen(cx.free(e, fn.ir.paramNames[k], t), p.lane);
      if (!isSubType(type(v), p))
        decline(
          e,
          `the input ${fn.ir.paramNames[k]} that ${e.operator} reads is not ${typeToString(p)} here`
        );
      return v;
    });
    // A list result of a run-time length: its length is a result of the
    // call before it, the length of the returned list.
    const n = fn.result.shape[0];
    const outs =
      typeof n === 'object' ? [b.newValue({ lane: 'integer', shape: [] })] : [];
    const out = b.newValue(
      outs.length > 0
        ? { lane: fn.result.lane, shape: [{ v: outs[0] }] }
        : fn.result
    );
    b.emit({
      k: 'call',
      outs: [...outs, out],
      fn: fn.ir.name,
      args: [...args, ...inputs],
    });
    return out;
  };

  /** The input `name` of the engine type `t` that the body of the function
   *  being lowered reads: a parameter after its own, which each call
   *  passes. */
  const capture = (e: Expression, name: string, t: Type): V => {
    const fn = pending.get(cx.inFunction!)!;
    if (fn.called)
      decline(
        e,
        `a recursive call of ${fn.ir.source}, which reads the input ${name} (a function on a cycle of calls reads no input)`
      );
    const ir = inputType(t, cx.wide);
    if (ir === undefined || ir.shape.length > 0)
      decline(
        e,
        `the function ${fn.ir.source} reads the input ${name} of type ${engineTypeToString(t)}, which is not a scalar`
      );
    const v = b.newValue({ lane: ir.lane, shape: [] });
    fn.ir.body.params.push(v);
    fn.ir.paramNames.push(name);
    fn.ir.lengthOf.push(false);
    fn.inputs.push(t);
    cx.frames[0].names.set(name, { v, role: 'input' });
    return v;
  };

  return {
    call,
    capture,
    /** Whether `e`, which has no user binding of its own, is a recursive
     *  call of a function being lowered: its head is bound to the
     *  definition of that function, or to the placeholder of a call made
     *  before the definition (`isForwardCallReference()`) whose name
     *  resolves to it. A call bound to the library is not one; a call of
     *  that name with another binding declines. */
    recursive: (e: Fn): boolean => {
      const fn = pending.get(e.operator);
      if (fn === undefined || cx.isLibrary(e)) return false;
      if (e.valueDefinition === fn.key || e.operatorDefinition === fn.key)
        return true;
      const resolved = cx.ce.lookupDefinition(e.operator);
      if (
        e.valueDefinition !== undefined &&
        isForwardCallReference(e.valueDefinition) &&
        resolved !== undefined &&
        ('operator' in resolved
          ? resolved.operator === fn.key
          : resolved.value === fn.key)
      )
        return true;
      decline(
        e,
        `a call of ${e.operator} whose binding is not the function ${e.operator} being compiled`
      );
    },
    /** The effect of the IR function `name`: effectful while it is not
     *  lowered (a function being lowered). */
    effect: (name: string): Effect => settled.get(name) ?? 'effectful',
  };
}
