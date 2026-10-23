import type {
  Expression,
  OperandDescriptor,
  TypeHandlerContext,
} from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import {
  deriveApplicationOf,
  describe,
  describeCallee,
  describeType,
  type DescriptorMemo,
} from './operand-descriptor.js';
import { functionLiteralBoundNames } from './function-literal.js';
import { isFunction, isSymbol } from './type-guards.js';

/**
 * For each body and each set of parameter names (sorted and joined), whether
 * the body holds a list literal with a cell that is a bare symbol of that
 * name. This reads only the structure of the body, which does not change,
 * so the answer is kept for the life of the body. A body is keyed with its
 * parameter names, since a shared or interned body can belong to two
 * literals with different parameters.
 */
const HAS_PARAMETER_CELL = new WeakMap<Expression, Map<string, boolean>>();

/**
 * The result type that the signature of a function literal states, given
 * `body`, the expression whose type is the result (the body of the
 * literal, or the last statement under a full-signature marker), `params`,
 * the parameter operands of the literal, and `bodyType`, the type of
 * `body`.
 *
 * The type of a list literal reads a bare symbol of type `unknown` as a
 * number cell: with a free `x`, `[x]` is a `vector<1>` (the fold of
 * `classifyCellD`, `library/collections.ts`). The type of each expression of
 * the body keeps this reading, and the compiler depends on it. A signature
 * is a statement about every call, and a parameter of type `unknown` can
 * receive any value: with `g := x ↦ [x]`, the call `g(Set(1, 2))` gives
 * `[Set(1, 2)]`, which a `vector<1>` does not hold. So, for the signature,
 * a cell of a list literal that is such a parameter is a cell of unknown
 * type: `x ↦ [x]` has the result `list` (the same set as `list<unknown>`),
 * with no length and no number elements, and `x ↦ [[x]]` has the result
 * `list<list>`. A parameter that a use narrowed (`x ↦ [x, x + 1]`, where the
 * use in `Add` types `x` as a number) and an annotated parameter
 * (`(x: real) ↦ [x]`) are not of type `unknown`, and keep their cells.
 *
 * Only the expressions of `body` that contain such a cell are typed again,
 * from the types of their operands, with their type handlers. Every other
 * expression keeps its own type. A part of the body that cannot be typed
 * again in this way is typed `unknown`: an operator with its own scope
 * (`Sum`, `Loop`), an assignment or a declaration, and a statement of a
 * `Block` before the last one (it can give its value to a local variable
 * that the last statement reads, or return it). A nested function literal
 * and a `Typed` expression are not read: each has a type of its own. A
 * call of a user function is typed from its operands as the expression is:
 * with `f(x) := (-x, x)`, the body `f([a, a])` of `h(a) := f([a, a])` is
 * typed with `[a, a]` a `list<unknown>`, and the call maps `f` over the
 * list, so `h` has the result `list<tuple<number, number>>`.
 *
 * `context` derives the type of an application from the descriptors of its
 * operands. Returns `bodyType` when the body has no such cell.
 */
export function deriveSignatureResultType(
  body: Expression,
  params: ReadonlyArray<Expression>,
  bodyType: Type,
  context: TypeHandlerContext
): Type {
  const names = new Set(functionLiteralBoundNames(params));
  if (names.size === 0) return bodyType;

  // Whether `e` holds a list literal with a cell for which `isCell` is true,
  // with one entry in `seen` per node, for a body that shares a node between
  // several places.
  const holdsCell = (
    e: Expression,
    isCell: (op: Expression) => boolean,
    seen: Map<Expression, boolean>
  ): boolean => {
    if (!isFunction(e) || e.operator === 'Function' || e.operator === 'Typed')
      return false;
    let result = seen.get(e);
    if (result !== undefined) return result;
    result = e.ops.some(
      (op) =>
        (e.operator === 'List' && isCell(op)) || holdsCell(op, isCell, seen)
    );
    seen.set(e, result);
    return result;
  };
  const isParameter = (op: Expression): boolean =>
    isSymbol(op) && names.has(op.symbol);
  const key = [...names].sort().join(',');
  let byNames = HAS_PARAMETER_CELL.get(body);
  if (byNames === undefined) {
    byNames = new Map();
    HAS_PARAMETER_CELL.set(body, byNames);
  }
  let found = byNames.get(key);
  if (found === undefined) {
    found = holdsCell(body, isParameter, new Map());
    byNames.set(key, found);
  }
  if (!found) return bodyType;

  // The type of a parameter changes when a use narrows it, so this test is
  // made at each read: a parameter that a use typed as a number
  // (`n` in `n - 1`) is a number cell, and the body keeps its type.
  const isUnknownParameter = (op: Expression): boolean =>
    isParameter(op) && op.type.type === 'unknown';
  const seen = new Map<Expression, boolean>();
  const hasCell = (e: Expression): boolean =>
    holdsCell(e, isUnknownParameter, seen);
  if (!hasCell(body)) return bodyType;

  const memo: DescriptorMemo = new Map();
  const walked = new Map<Expression, OperandDescriptor>();
  const unknown = describeType('unknown');

  const walk = (e: Expression): OperandDescriptor => {
    if (!hasCell(e)) return describe(e, undefined, memo);
    const known = walked.get(e);
    if (known !== undefined) return known;
    let result: OperandDescriptor;
    if (isFunction(e, 'List')) {
      // A parameter cell of type `unknown` is described by its type alone,
      // with no structure: the list's type then reads it as a cell of
      // unknown type, not as a number.
      const elements = e.ops.map((op) =>
        isUnknownParameter(op) ? unknown : walk(op)
      );
      const t = deriveApplicationOf({ head: 'List' }, elements, context);
      const shape = describe(e, undefined, memo).structureOf?.();
      result = {
        ...describeType(t ?? 'unknown'),
        ...(shape?.kind === 'list-literal'
          ? {
              structureOf: () => ({
                kind: 'list-literal' as const,
                shape: shape.shape,
                elements,
              }),
            }
          : {}),
      };
    } else if (isFunction(e, 'Block')) {
      const statements = e.ops;
      result =
        statements.length === 0 ||
        statements.slice(0, -1).some((op) => hasCell(op))
          ? unknown
          : walk(statements[statements.length - 1]);
    } else if (
      !isFunction(e) ||
      e.operatorDefinition?.scoped ||
      ['Assign', 'Declare', 'Return', 'Loop', 'Break', 'Continue'].includes(
        e.operator
      )
    ) {
      result = unknown;
    } else {
      const operands = e.ops.map(walk);
      const t = deriveApplicationOf(
        { head: e.operator, callee: describeCallee(e) },
        operands,
        context
      );
      result = describeType(t ?? 'unknown');
    }
    walked.set(e, result);
    return result;
  };

  return walk(body).type;
}
