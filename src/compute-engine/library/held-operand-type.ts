/**
 * The type of a HELD operand: an operand that a `lazy` operator received
 * unbound, whose descriptor carries `unknown` where a bound operand would
 * carry a real type. The type handlers of the lazy operators (`Simplify`,
 * `HoldValues`, `Pipe`, `JacobianMatrix`, …) read the type of what they
 * hold through this module.
 */

import type { Type } from '../../common/type/types.js';
import {
  collectionElementType,
  functionResult,
  widen,
} from '../../common/type/utils.js';
import type { OperandDescriptor, TypeHandlerContext } from '../global-types.js';
import {
  deriveApplicationOf,
  describeType,
} from '../boxed-expression/operand-descriptor.js';
import { mayCarryDimensions } from '../collection-utils.js';

/**
 * The type of the held operand `d`.
 *
 * Every branch is a pure read: a symbol's own binding through
 * `lookupDefinition`, a literal's structural view, an application's derived
 * type. An operand that already carries a type (the `ce.function` route boxes
 * its arguments first) is reported as it stands.
 *
 * The operands of a held application are held too, so each one is typed by
 * this function before the application is derived. Without this, the
 * derivation read each unbound operand as `unknown`: `Simplify(Sin(r) * P)`
 * with `P: boolean` was typed `broadcastable<number>`, and its value is an
 * error.
 */
export function heldOperandType(
  context: TypeHandlerContext,
  d: OperandDescriptor | undefined
): Type {
  if (d === undefined) return 'unknown';
  if (d.type !== 'unknown') return d.type;
  const s = d.structureOf?.();
  if (s === undefined) return 'unknown';
  switch (s.kind) {
    case 'symbol': {
      const def = context.engine.lookupDefinition(s.name);
      if (def?.value !== undefined) return def.value.type.type;
      if (def?.operator !== undefined) return def.operator.signature.type;
      return 'unknown';
    }
    case 'string':
      return 'string';
    case 'number':
    case 'function-literal':
      return d.type;
    // A held tuple or list literal is typed as a stored contract: a number
    // literal component contributes its tier, never its literal type
    // (`storedComponentTypeD`); any other component is typed as a held
    // operand in its own right.
    case 'tuple':
      return {
        kind: 'tuple',
        elements: s.elements.map((e) => ({
          type: heldComponentType(context, e),
        })),
      };
    case 'list-literal': {
      const rows: Type = widen(
        ...s.elements.map((e) => heldComponentType(context, e))
      );
      if (s.shape.length === 0) return { kind: 'list', elements: rows };
      // A shape of rank r > 1 (`[[1, 2], [3, 4]]` is 2×2) puts the LEAF type
      // in `elements`: the components are rows, so descend r − 1 ranks. The
      // row type in a 2×2 shape counted the inner rank twice (a 2×2 shape
      // whose cells were `vector<integer^2>`).
      let elements: Type = rows;
      for (let k = 1; k < s.shape.length; k++)
        elements = collectionElementType(elements) ?? 'unknown';
      // The shape is written as a dimension list only when the leaf cells
      // may carry one (`mayCarryDimensions`: a cell that cannot be a list),
      // as the `List` type handler does (`shapedListTypeD`,
      // `library/collections.ts`): a held `[True, False]` is a
      // `list<boolean^2>`. Otherwise the literal is a plain list of its
      // components.
      return mayCarryDimensions(elements)
        ? { kind: 'list', elements, dimensions: [...s.shape] }
        : { kind: 'list', elements: rows };
    }
    case 'application': {
      // A child that already carries a type keeps its descriptor. Another
      // one gets its held type, and keeps its structural view, which the
      // derivation of some operators reads (the rows of a list literal).
      //
      // The children of a held BINDER (an operator whose definition is
      // `scoped`: `Sum`, `Product`, `D`, `Integrate`, `Block`, …) are not
      // typed this way. A symbol branch reads the definition that the name
      // has in the ENCLOSING scope, but a variable that the binder binds
      // (the index of a `Sum`) is a different symbol with the same name:
      // with `k: list<integer>` declared, `Simplify(Sum(k^2, Limits(k, 1,
      // 3)))` was typed `list<number>`, and its value is `14`. A descriptor
      // has no expression, so the binding-site selector cannot be run here;
      // the children of the binder stay `unknown`.
      const binder =
        s.callee === undefined &&
        context.engine.lookupDefinition(s.head)?.operator?.scoped === true;
      const children = s.children.map((c) =>
        binder || c.type !== 'unknown'
          ? c
          : {
              ...describeType(heldOperandType(context, c)),
              structureOf: c.structureOf,
            }
      );
      return deriveApplicationOf(s, children, context) ?? 'unknown';
    }
  }
}

/**
 * The type of what the held operand `d` DENOTES as a function: for a symbol
 * that names a function, the result type of that function; for any other
 * operand, its held type ({@link heldOperandType}).
 *
 * A symbol's result type can live in four places, in decreasing precision:
 * the operand's own type (a bound symbol carries its signature there, while
 * a RAW held one is still `unknown`), the value declaration, the lambda the
 * symbol holds (the only result type that a head declared as a bare
 * `function` has) and, for a symbol that a lambda assignment made CALLABLE,
 * the operator half's signature, which is where that assignment records the
 * inferred result type. A symbol that names no function is read as its
 * declared type.
 */
export function heldDenotedType(
  context: TypeHandlerContext,
  d: OperandDescriptor
): Type {
  const structure = d.structureOf?.();
  if (structure?.kind !== 'symbol') {
    const t = heldOperandType(context, d);
    return t === 'unknown' ? d.type : t;
  }
  const binding = context.engine.lookupDefinition(structure.name);
  const def = binding?.value;
  for (const t of [
    d.type,
    def?.type.type,
    def?.value?.type.type,
    binding?.operator?.signature.type,
  ]) {
    if (t === undefined) continue;
    const result = functionResult(t);
    if (result !== undefined && result !== 'any' && result !== 'unknown')
      return result;
  }
  return def?.type.type ?? d.type;
}

/** The type a component of a HELD tuple or list literal contributes to the
 * literal's stored type: a number literal's tier, otherwise the component's
 * own held-operand type. */
function heldComponentType(
  context: TypeHandlerContext,
  d: OperandDescriptor
): Type {
  const s = d.structureOf?.();
  return s?.kind === 'number' ? s.tier : heldOperandType(context, d);
}
