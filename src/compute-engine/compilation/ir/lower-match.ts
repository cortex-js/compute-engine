/**
 * The lowering of `N`, `MatchesType` and `Match` (README, "Match, x is T
 * and N"; CE-1652, step 1). No run-time test of a type is emitted: a type
 * test is decided from the static type of its subject, and a `Tuple`
 * pattern from the shape of the subject.
 */

import type { Expression, IComputeEngine } from '../../global-types.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import { buildCaseClosure } from '../../boxed-expression/match-dispatch.js';
import { isSubtype } from '../../../common/type/subtype.js';
import { typesOverlap } from '../../../common/type/reduce.js';
import { typeToString } from '../../../common/type/serialize.js';
import { isPolytype, settleTypeText } from '../../library/type-value-utils.js';
import {
  decline,
  isUntyped,
  STATIC_TYPE_ERROR,
  userBinding,
  type Fn,
  type Lowering,
} from './lower-context.js';
import {
  isSubLane,
  scalarType,
  typeToString as irTypeToString,
  type IRType,
  type V,
} from './ir.js';
import type { Type, TypeReference } from '../../../common/type/types.js';

/** The engine type of the values of the IR type `t` of a parameter that
 *  holds the type of its argument (`Lowering.heldParams`): a record of a
 *  named tuple type that is not parameterized, by that type; a scalar of
 *  the lane `string`, `color`, `boolean`, `integer`, `real` or `nothing`,
 *  by that type. A number on such a lane has a static type that proves it
 *  (`held()`). Otherwise `undefined`. */
function engineTypeOf(e: Expression, t: IRType): Type | undefined {
  if (t.lane === 'record') {
    if (t.nominal === undefined) return undefined;
    const ce = e.engine as unknown as IComputeEngine;
    const r = ce._typeResolver.resolve(t.nominal) as TypeReference | undefined;
    return r === undefined || (r.typeParams?.length ?? 0) > 0 ? undefined : r;
  }
  if (t.shape.length > 0) return undefined;
  return ['string', 'color', 'boolean', 'integer', 'real', 'nothing'].includes(
    t.lane
  )
    ? (t.lane as Type)
    : undefined;
}

/** The fewest digits of `N(x, p)` whose value the double of `x` gives
 *  within the agreement of the targets (`N(1/3, 15)` is
 *  `0.333333333333333`, 1e-15 from the double). */
const DOUBLE_DIGITS = 15;

/** A case of a `Match` that the compiler reads: a constant (a string or a
 *  real number), `_`, or a `Tuple` of names (`undefined` for `_`). */
type Arm =
  | {
      kind: 'constant';
      value: string | number;
      literal: Expression;
      body: Expression;
    }
  | { kind: 'default'; body: Expression }
  | { kind: 'tuple'; names: (string | undefined)[]; body: Expression };

/** `e` is, or holds, a `Match`, or a call of a user function whose body
 *  holds one (at any depth of calls). The engine types a `Match` by those
 *  of its case bodies that are literals, and a call of a function whose
 *  inferred result is `unknown` as `nothing` (CE-1731): the static type of
 *  such a node, and of a result inferred from it, is not the type of its
 *  value. */
export function typedByMatch(
  e: Expression,
  seen: Set<Expression> = new Set()
): boolean {
  // Each node once: a shared graph is not walked as a tree.
  if (seen.has(e)) return false;
  seen.add(e);
  // A name: the body of the literal of a user function passed by name
  // (`Map(f, L)`), or the stored value of a name, which can be a formula
  // that holds a `Match`.
  if (isSymbol(e)) {
    const od = e.operatorDefinition as
      { _isLambda?: boolean; _lambdaLiteral?: Expression } | undefined;
    const v = od?._isLambda ? od._lambdaLiteral : e.valueDefinition?.value;
    if (v === undefined) return false;
    return typedByMatch(isFunction(v, 'Function') ? v.ops[0] : v, seen);
  }
  if (!isFunction(e)) return false;
  if (e.operator === 'Match') return true;
  const user = userBinding(e as Fn);
  if (user !== undefined && typedByMatch(user.literal.ops[0], seen))
    return true;
  return e.ops.some((op) => typedByMatch(op, seen));
}

/** The reads of a record that `MatchesType` of a field needs: the `named`
 *  and `at` of `recordLowering()` (`lower-records.ts`). Declared here, not
 *  imported, because `lower-records.ts` imports this module. */
type RecordReads = {
  named(e: Fn, r: V, name: string | undefined): V;
  at(e: Expression, r: V, i: V): V;
};

export function matchLowering(cx: Lowering, records: RecordReads) {
  const { b } = cx;

  /** `e` reads a name that the walk binds as a local of a block or a
   *  capture of a case: its type is the type of its value, which can be a
   *  `Match` (CE-1731). An input, a parameter, a loop index and a free name
   *  have a declared type, or the type of a value known at compile time. */
  const readsLocal = (
    e: Expression,
    seen: Set<Expression> = new Set()
  ): boolean => {
    // Each node once: a shared graph is not walked as a tree.
    if (seen.has(e)) return false;
    seen.add(e);
    if (isSymbol(e)) {
      for (let i = cx.frames.length - 1; i >= 0; i--) {
        const binding = cx.frames[i].names.get(e.symbol);
        if (binding !== undefined)
          return binding.role !== 'input' && binding.role !== 'index';
      }
      return false;
    }
    return isFunction(e) && e.ops.some((op) => readsLocal(op, seen));
  };

  /** `f` run in the innermost local scope of the walk (`Lowering.scopes`),
   *  or `scope` when given. */
  const inScope = <T>(e: Expression, f: () => T, scope = cx.scopes.at(-1)) =>
    scope === undefined ? f() : e.engine._inScope(scope, f);

  /** `N(x)` or `N(x, p)`: the value of `x` when it is a number, a string or
   *  a boolean. `p`, when given, is a literal of at least
   *  `DOUBLE_DIGITS`: the interpreter rounds to `p` digits. */
  const numeric = (e: Fn, want: boolean): V | undefined => {
    if (e.nops < 1 || e.nops > 2)
      decline(e, 'N of other than one or two operands');
    const [x, p] = e.ops;
    if (
      p !== undefined &&
      !(isNumber(p) && Number.isInteger(p.re) && p.re >= DOUBLE_DIGITS)
    )
      decline(
        e,
        `N of a precision that is not a literal integer of at least ${DOUBLE_DIGITS} digits`
      );
    const t = x.type.type;
    const number = isSubtype(t, 'number');
    if (number || isSubtype(t, 'string') || isSubtype(t, 'boolean')) {
      // The interpreter rounds to `p` digits: the enclosure of the exact
      // value need not hold that number, and a bigint is not a machine
      // number.
      if (number && cx.interval)
        decline(e, 'N of a number in the interval mode');
      if (cx.bigint) decline(e, 'N in the bigint mode');
      return cx.value(x, want);
    }
    // A list or a tuple of reals, whose `N` is the list of the `N` of its
    // elements (README, "Match, x is T and N"); and a value of no stated
    // type or of type `any` (a parameter that holds the type of its
    // argument, `held()` of `lower-functions.ts`) by its IR type: a real,
    // an integer, a string, a boolean, a colour (whose `N` is itself), or
    // a list or a tuple of reals (CE-1652, step 4b).
    const list =
      typeof t === 'object' &&
      ((t.kind === 'list' && isSubtype(t.elements, 'real')) ||
        (t.kind === 'tuple' &&
          t.elements.every((u) => isSubtype(u.type, 'real'))));
    if (!list && !isUntyped(t))
      decline(
        e,
        `N of a value of type ${typeToString(t)} (only a number, a string, a boolean, or a list or a tuple of real numbers)`
      );
    if (cx.interval)
      decline(e, 'N of a list or of a value of type any in the interval mode');
    if (cx.bigint) decline(e, 'N in the bigint mode');
    const v = cx.value(x, true)!;
    const vt = cx.type(v);
    const reals = vt.lane === 'real' || vt.lane === 'integer';
    const ok =
      vt.shape.length === 0
        ? !cx.tuples.has(v) &&
          (reals || ['string', 'boolean', 'color'].includes(vt.lane))
        : vt.shape.length === 1 && reals && (cx.tuples.get(v) ?? 0) === 0;
    if (!ok)
      decline(
        e,
        `N of a value of type ${typeToString(t)}, here ${irTypeToString(vt, cx.tuples.get(v) ?? -1)} (only a number, a string, a boolean, a colour, or a list or a tuple of real numbers)`
      );
    return v;
  };

  /** `MatchesType(x, T)` (`x is T`): `True` when the static type of `x` is
   *  a subtype of `T`, `False` when the two types do not overlap; the
   *  subject is lowered only for its effect. When the static type does not
   *  decide, or cannot be trusted (CE-1731), a subject that is a field of
   *  a record (`Field`, `At`) is decided by the lane of the field: a value
   *  of the lane `nothing`, `string`, `boolean` or `color` is of that
   *  engine type, settled by the operand of the record's constructor.
   *  Otherwise it declines: no run-time test of a type is emitted. */
  const matchesType = (e: Fn): V => {
    // The node is lowered again in each function lowered for other types:
    // its entry in `typeTests` is that lowering's.
    cx.typeTests.delete(e);
    const [x, t] = e.ops;
    const text =
      e.nops === 2 && isFunction(t, 'TypeFrom') && isString(t.ops[0])
        ? t.ops[0].string
        : undefined;
    if (text === undefined)
      decline(e, 'MatchesType of a type that is not a literal');
    const settled = settleTypeText(e.engine, text);
    if ('error' in settled || isPolytype(settled.type))
      decline(e, 'MatchesType of an invalid or a quantified type');
    // The subject is held raw: its type is the type of its canonical form
    // in the scope of the walk.
    const subject = inScope(e, () => x.canonical);
    const s = subject.type.type;
    if (s === 'error')
      decline(
        e,
        'MatchesType of a subject of the static type error',
        STATIC_TYPE_ERROR
      );
    const decide = (t: Type) =>
      isSubtype(t, settled.type)
        ? true
        : !typesOverlap(t, settled.type)
          ? false
          : undefined;
    const untrusted = typedByMatch(subject)
      ? 'MatchesType of a subject whose static type comes from a Match (CE-1731)'
      : readsLocal(subject)
        ? 'MatchesType of a subject that reads a local, whose type can come from a Match (CE-1731)'
        : undefined;
    const verdict = untrusted === undefined ? decide(s) : undefined;
    if (verdict !== undefined) {
      if (subject.isPure !== true) cx.value(subject, false);
      return b.constant(verdict, 'boolean');
    }
    // A parameter of no stated type or of type `any` that holds the IR
    // type of its argument (`held()` of `lower-functions.ts`): in the
    // function lowered for that type, the type of its value is the engine
    // type of that IR type (CE-1652, step 4b).
    if (isSymbol(subject) && isUntyped(s)) {
      const p = cx.value(subject)!;
      const held = cx.heldParams.has(p)
        ? engineTypeOf(e, cx.type(p))
        : undefined;
      const known = held === undefined ? undefined : decide(held);
      if (known !== undefined) {
        cx.typeTests.set(e, known);
        return b.constant(known, 'boolean');
      }
    }
    // The lane of a field of a record, which the passes remove when nothing
    // else reads it. The record is lowered once, and the field read from it.
    const read =
      (isFunction(subject, 'Field') || isFunction(subject, 'At')) &&
      subject.nops === 2 &&
      cx.isLibrary(subject)
        ? subject
        : undefined;
    const r = read === undefined ? undefined : cx.value(read.ops[0])!;
    const v =
      read === undefined || r === undefined || cx.type(r).lane !== 'record'
        ? undefined
        : read.operator === 'Field'
          ? records.named(
              read,
              r,
              isString(read.ops[1]) ? read.ops[1].string : undefined
            )
          : records.at(read, r, cx.value(read.ops[1])!);
    const lane = v === undefined ? undefined : cx.type(v);
    const known =
      lane !== undefined &&
      lane.shape.length === 0 &&
      ['nothing', 'string', 'boolean', 'color'].includes(lane.lane)
        ? decide(lane.lane as Type)
        : undefined;
    if (known === undefined)
      decline(
        e,
        untrusted ??
          `MatchesType of a value of type ${typeToString(s)}, which neither proves nor excludes ${settled.canonicalText}`
      );
    return b.constant(known, 'boolean');
  };

  /** The case `c` of a `Match`, or a decline for a case that the compiler
   *  does not read. */
  const arm = (c: Expression): Arm => {
    if (!isFunction(c, 'MatchCase') || c.nops < 2 || c.nops > 3)
      decline(c, 'a case of a Match that is not a MatchCase');
    if (c.nops === 3) decline(c, 'a case of a Match with a guard');
    const [p, body] = c.ops;
    if (isSymbol(p, '_')) return { kind: 'default', body };
    if (isString(p))
      return { kind: 'constant', value: p.string, literal: p, body };
    if (isNumber(p) && p.im === 0 && Number.isFinite(p.re))
      return { kind: 'constant', value: p.re, literal: p, body };
    if (isFunction(p, 'Tuple')) {
      const names = p.ops.map((q) =>
        isSymbol(q) && /^_[^_]/.test(q.symbol)
          ? q.symbol.slice(1)
          : isSymbol(q, '_')
            ? undefined
            : null
      );
      const named = names.filter((n) => typeof n === 'string');
      if (!names.includes(null) && new Set(named).size === named.length)
        return { kind: 'tuple', names: names as (string | undefined)[], body };
    }
    decline(
      c,
      'a pattern of a Match that is not a string, a real number, _ or a Tuple of distinct names'
    );
  };

  /** The body of the case `body`, with each name of `names` bound to the
   *  value at its position in `values`. The body is held raw: it is the
   *  body of the function literal of the case (`buildCaseClosure()`), made
   *  in the scope of the walk, and lowered in the scope of that literal. */
  const caseBody = (
    e: Fn,
    body: Expression,
    names: (string | undefined)[],
    values: V[],
    want: boolean
  ): V | undefined => {
    const bound = names.filter((n): n is string => n !== undefined);
    const closure = inScope(e, () => buildCaseClosure(e.engine, body, bound));
    if (!isFunction(closure, 'Function'))
      decline(e, 'a case of a Match whose body is not valid');
    return cx.withFrame(false, (frame) => {
      names.forEach((n, k) => {
        if (n === undefined) return;
        const v = values[k];
        frame.names.set(n, { v, lane: cx.type(v).lane, role: 'constant' });
      });
      const scope = closure.localScope;
      if (scope !== undefined) cx.scopes.push(scope);
      try {
        return cx.value(closure.ops[0], want);
      } finally {
        if (scope !== undefined) cx.scopes.pop();
      }
    });
  };

  /** `Match(subject, case…)`: the subject is evaluated once. A case of a
   *  constant is a clause of a `Which` on the subject (decided at compile
   *  time when the subject is a constant or of another kind); a `Tuple`
   *  pattern is selected by the shape of the subject and binds its names
   *  to the elements; `_` takes every value. A `Match` with no case that
   *  takes every value declines. */
  const match = (e: Fn, want: boolean): V | undefined => {
    const arms = e.ops.slice(1).map(arm);
    const s = cx.value(e.ops[0])!;
    const t = cx.type(s);
    const point = cx.tuples.get(s) === 0 && t.shape.length === 1;
    // A string of a known value (`Lowering.known()`; CE-1652, step 4c) is
    // decided as a constant.
    const text = cx.known(s);
    if (text !== undefined) cx.readKnown(s);
    const known = text ?? b.constants.get(s);
    // Each case that can be taken: its condition (`undefined` when it takes
    // every value that reaches it) and its body. The cases after one that
    // takes every value are not read.
    const live: [V | undefined, () => V | undefined][] = [];
    for (const a of arms) {
      let test: V | undefined;
      if (a.kind === 'tuple') {
        if (t.shape.length > 0 && !point)
          decline(e, 'a Tuple pattern of a Match on a list');
        // A value of a named tuple type is not taken by a `Tuple` pattern
        // (the interpreter's); a record of a `Tuple` or a `List` literal of
        // several lanes is not told apart here.
        if (t.lane === 'record' && t.names === undefined)
          decline(e, 'a Tuple pattern of a Match on a record with no names');
        if (!point || t.shape[0] !== a.names.length) continue;
        const values = a.names.map((_, k) =>
          b.op('elem', [s, b.constant(k, 'integer')], scalarType(t.lane))
        );
        live.push([
          undefined,
          () => caseBody(e, a.body, a.names, values, want),
        ]);
        break;
      }
      if (a.kind === 'constant') {
        const text = typeof a.value === 'string';
        if (t.shape.length > 0) continue;
        if (text ? t.lane !== 'string' : !isSubLane(t.lane, 'real')) {
          if (t.lane === 'complex')
            decline(e, 'a number pattern of a Match on a complex value');
          continue;
        }
        // A constant subject is decided here; a `bigint` constant (the
        // `bigint` mode) is compared by `Equal`, as a number pattern is not
        // one.
        test =
          known !== undefined && typeof known !== 'bigint'
            ? b.constant(known === a.value, 'boolean')
            : cx.apply(e, 'Equal', [s, cx.value(a.literal)!]);
        const decided = b.constants.get(test);
        if (decided === false) continue;
        if (decided === true) test = undefined;
      }
      live.push([test, () => caseBody(e, a.body, [], [], want)]);
      if (test === undefined) break;
    }
    if (live.length === 0 || live[live.length - 1][0] !== undefined)
      decline(e, 'a Match with no case that takes every value (_)');
    const chain = (i: number): V | undefined => {
      const [test, body] = live[i];
      if (test === undefined) return body();
      return cx.branch(e, test, body, () => chain(i + 1), want);
    };
    return chain(0);
  };

  return { numeric, matchesType, match };
}
