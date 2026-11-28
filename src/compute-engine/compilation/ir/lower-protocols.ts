/**
 * The dispatch of a protocol method at compile time (README, "Records";
 * CE-1652, step 4): a call whose head is the dispatcher of a protocol
 * member and whose first operand is a record of a named type `T` calls the
 * one implementation that the interpreter selects for every value of `T`,
 * lowered as a user function (`lower-functions.ts`). Every other call
 * declines. No run-time test of a type is emitted
 * (`docs/COMPILATION-MODEL.md`, "Shapes are settled at compile time").
 */

import type { TypeReference } from '../../../common/type/types.js';
import { isSubtype } from '../../../common/type/subtype.js';
import { typesOverlap } from '../../../common/type/reduce.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import { isFunction, isSymbol } from '../../boxed-expression/type-guards.js';
import { canonicalFunctionLiteral } from '../../function-utils.js';
import type { ConformanceRecord } from '../../types-engine.js';
import type { Expression, IComputeEngine } from '../../global-types.js';
import {
  implementationLiteralAt,
  isProtocolDispatcher,
  protocolCallArguments,
  protocolDispatchCandidates,
  protocolRequirementAt,
} from '../../engine-protocols.js';
import { decline, isUntyped, type Fn, type Lowering } from './lower-context.js';
import { laneProves } from './lower-records.js';
import { typeToString, type V } from './ir.js';

export function protocolLowering(cx: Lowering) {
  const { type } = cx;
  /** The implementation of each member on each edge, as a function
   *  literal made canonical once, and the key of its lowered functions. */
  const literals = new Map<
    ConformanceRecord,
    Map<string, { key: object; literal: Fn; implementation: true }>
  >();

  /** A call `e` of the dispatcher of a protocol member: the call of the
   *  implementation that the interpreter selects, with every argument that
   *  the implementation takes, and the binding of that implementation
   *  (`functionLowering().call()`). `undefined` when the head of `e` is not
   *  a dispatcher. */
  const dispatch = (
    e: Fn
  ):
    | {
        call: Fn;
        binding: { key: object; literal: Fn; implementation: true };
        values: V[];
      }
    | undefined => {
    if (
      e.operatorDefinition === undefined ||
      !isProtocolDispatcher({ operator: e.operatorDefinition } as never)
    )
      return undefined;
    const ce = e.engine as unknown as IComputeEngine;
    const member = e.operator;
    const what = `the protocol method ${member}`;
    const receiver = e.ops[0];
    if (receiver === undefined) decline(e, `${what} with no argument`);
    // The interpreter selects the implementation by the type of the value
    // of the receiver at run time. The type of a record is settled here:
    // the named tuple type of its constructor.
    const self = cx.value(receiver)!;
    const t = type(self);
    if (t.lane !== 'record')
      decline(
        receiver,
        `${what} on a value that is not a record (${typeToString(t)}): the implementation is selected at run time`
      );
    if (t.nominal === undefined)
      decline(receiver, `${what} on a record of no named type`);
    const T = ce._typeResolver.resolve(t.nominal) as TypeReference | undefined;
    if (T === undefined)
      decline(receiver, `${what} on a record of the unknown type ${t.nominal}`);
    // A value of a parameterized type has a type of its arguments at run
    // time (`Box(1)` is a `Box<integer>`), which the record does not hold.
    if ((T.typeParams?.length ?? 0) > 0)
      decline(
        receiver,
        `${what} on a record of the parameterized type ${t.nominal} (the type of its arguments selects the implementation at run time)`
      );
    // The edges that can serve a value of `T`: the interpreter selects the
    // most specific edge whose target holds the type of the value, a
    // subtype of `T`. With exactly one edge that overlaps `T`, whose target
    // holds `T`, that edge is the one selected for every value of `T`.
    const candidates = (protocolDispatchCandidates(ce, member) ?? []).filter(
      (c) => typesOverlap(c.widest, T)
    );
    if (candidates.length === 0)
      decline(
        e,
        `${what}: no implementation applies to a value of type ${T.name}`
      );
    if (candidates.length > 1)
      decline(
        e,
        `${what} on a value of type ${T.name}, which ${candidates.length} implementations can serve (${candidates.map((c) => `${c.record.name}(${c.edge.targetKey})`).join(', ')}): the interpreter decides between them at run time, by the type of the value`
      );
    const c = candidates[0];
    if (c.conditional)
      decline(e, `${what} implemented by a conditional conformance`);
    if (c.host) decline(e, `${what} implemented by a function of the host`);
    if (!isSubtype(T, c.target))
      decline(
        e,
        `${what} on a value of type ${T.name}, which the implementation for ${engineTypeToString(c.target)} serves for some values only`
      );
    // The arguments, with the defaults that the call leaves out.
    const filled = protocolCallArguments(ce, c.record, member, e.ops);
    if (typeof filled === 'string') decline(e, `${what}: ${filled}`);
    const { args, defaults } = filled;
    // The implementation, `Self` replaced by the target of the edge, made
    // canonical as the interpreter makes it canonical to apply it.
    let byMember = literals.get(c.edge);
    if (byMember === undefined) literals.set(c.edge, (byMember = new Map()));
    let binding = byMember.get(member);
    if (binding === undefined) {
      const raw = implementationLiteralAt(ce, c.edge, member);
      const literal = raw === null ? undefined : canonicalFunctionLiteral(raw);
      if (!isFunction(literal, 'Function'))
        decline(e, `${what}: an implementation that is not a function literal`);
      // Its result is the one its body declares, at `Self` = the target
      // (`signatureTypes()`): the interpreter checks the value against it.
      binding = { key: {}, literal: literal as Fn, implementation: true };
      byMember.set(member, binding);
    }
    // The interpreter checks each argument against the requirement: the
    // static type of each must prove it, or, of no stated type or `any` (a
    // parameter that holds the type of its argument), its lane. Each
    // argument is lowered once, in order, the receiver first.
    const requirement = protocolRequirementAt(ce, c.record, member, c.target);
    if (requirement === null) decline(e, `${what}: no requirement`);
    const params = [
      ...(requirement.args ?? []),
      ...(requirement.optArgs ?? []),
    ];
    const own = binding.literal.type.type;
    const declared =
      typeof own === 'object' && own.kind === 'signature'
        ? [...(own.args ?? []), ...(own.optArgs ?? [])]
        : [];
    // Whether every name of `x`, operator names included, holds the
    // definition of the system scope (a literal, `True`, `Pi`, `[]`): such
    // a value reads no name of the program, so it can be inlined.
    const system = ce.contextStack[0]?.lexicalScope.bindings;
    const libraryOnly = (x: Expression): boolean => {
      if (isSymbol(x)) {
        const d = system?.get(x.symbol);
        return (
          d !== undefined &&
          (('value' in d && d.value === x.valueDefinition) ||
            ('operator' in d && d.operator === x.operatorDefinition))
        );
      }
      if (isFunction(x)) {
        const d = system?.get(x.operator);
        return (
          d !== undefined &&
          'operator' in d &&
          d.operator === x.operatorDefinition &&
          x.ops.every(libraryOnly)
        );
      }
      return true;
    };
    const values = args.map((op, i) => {
      if (i === 0) return self;
      // A function value at a parameter of no stated type or of type
      // `any`, which the implementation passes on (`held()` of
      // `lower-functions.ts`; CE-1911).
      // The argument must have the type of the requirement, which the
      // interpreter checks it against.
      const p0 = declared[i]?.type;
      const required = params[i]?.type;
      if (
        defaults[i] === undefined &&
        (p0 === undefined || isUntyped(p0)) &&
        (required === undefined || isSubtype(op.type.type, required))
      ) {
        const fv = cx.engineArgument(op);
        if (fv !== undefined) return fv;
      }
      // A symbol default is read when the call is evaluated, in the scope
      // of the protocol: its value is a capture (`symbolDeps`), as for a
      // free name with a value (`captured()` of `lower.ts`), so a host
      // recompiles when it changes. One with no value would be read here
      // as a name of the call site, which a local could hide.
      const boxed = defaults[i];
      // A default computed from a name would be inlined with its value at
      // compile time, and no capture would record the name: decline it.
      // Epsil admits only a literal or one name (captured below); a host
      // that declares a protocol through the API can give any expression.
      if (boxed !== undefined && !isSymbol(boxed) && !libraryOnly(boxed))
        decline(
          op,
          `the default of ${what} reads a name of the program: a default is a literal or one name`
        );
      const library = isSymbol(boxed) ? system?.get(boxed.symbol) : undefined;
      const captured =
        isSymbol(boxed) &&
        (library === undefined ||
          !('value' in library) ||
          library.value !== boxed.valueDefinition)
          ? boxed.symbol
          : undefined;
      // The value of a captured name is inlined: it must read no name of
      // the program (`True`, the value of a constant `flag`, compiles; a
      // name with no value, which evaluates to itself, or a value that
      // holds such a name, would be read as a name of the call site).
      if (captured !== undefined && !libraryOnly(op))
        decline(
          op,
          `the default ${captured} of ${what}, whose value reads a name of the program or has no value`
        );
      const v = cx.value(op)!;
      const d = params[i]?.type;
      if (
        d !== undefined &&
        !isSubtype(op.type.type, d) &&
        !(isUntyped(op.type.type) && laneProves(type(v), cx.tuples.has(v), d))
      )
        decline(
          op,
          `an argument of ${what} of type ${engineTypeToString(op.type.type)}, which does not prove ${engineTypeToString(d)}`
        );
      // The interpreter binds a list whole: at a parameter of the
      // implementation that is not a list, a user function would map over
      // it.
      const p = declared[i]?.type;
      if (
        type(v).shape.length > 0 &&
        cx.tuples.get(v) !== 0 &&
        !(typeof p === 'object' && p.kind === 'list')
      )
        decline(
          op,
          `a list argument of ${what} at a parameter of type ${p === undefined ? 'unknown' : engineTypeToString(p)} (the interpreter binds the list whole)`
        );
      if (captured !== undefined) cx.b.captures.add(captured);
      return v;
    });
    return { call: ce._fn(member, args) as Fn, binding, values };
  };

  return { dispatch };
}
