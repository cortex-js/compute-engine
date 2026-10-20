import type {
  BoxedDefinition,
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isFunction, isString } from './type-guards.js';

/**
 * The `read-before-declaration` error value of a use of `name` (a read of
 * the symbol, a call of the function it holds, the collection of a `for`
 * loop) that found the binding `binding`, when the binding is a local of a
 * block that has no value yet in this run of the block. Otherwise
 * `undefined`.
 *
 * Two kinds of binding have no value yet:
 *
 * - A `let` or `const` local whose `Declare` statement has not run in this
 *   run of the block. A block creates the binding when its run starts and
 *   marks it `_uninitialized` (`createBlockLocals`, `function-utils.ts`).
 *   The error is `["Error", ["ErrorCode", "read-before-declaration",
 *   name]]`.
 * - An assignment local of a block written in the body of a function
 *   literal (`declareAssignmentLocals`, `function-utils.ts`, which marks it
 *   `_assignmentLocal`), before the first `Assign` of the run gives it its
 *   value. The error has the third operand `"assignment"`, so that the
 *   message can say that the name has no `let`. A binding that an
 *   assignment made an operator binding (`t = (x) => 2x`) has a value, and
 *   gives no error.
 *
 * `site` is the source range of the use, when the expression has one (an
 * expression of an Epsil program does). It is kept as the source range of
 * the `ErrorCode` operand of the error. When the error goes up through an
 * operator or a call, the new `Error` node keeps the same `ErrorCode`
 * operand (`withErrorFrames()`, `error-value.ts`), so the range stays
 * readable. Epsil (`executeEpsil()`) uses it to find whether the static
 * check reported the same use, at the same range.
 */
export function readBeforeDeclarationError(
  ce: ComputeEngine,
  name: string,
  binding: BoxedDefinition | undefined,
  site: [start: number, end: number] | undefined
): Expression | undefined {
  const local = binding as
    | (BoxedDefinition & {
        _uninitialized?: boolean;
        _assignmentLocal?: boolean;
      })
    | undefined;
  let parts: string[] | undefined;
  if (local?._uninitialized === true) parts = ['read-before-declaration', name];
  else if (
    local?._assignmentLocal === true &&
    'value' in local &&
    local.value.value === undefined
  )
    parts = ['read-before-declaration', name, 'assignment'];
  if (parts === undefined) return undefined;
  const code = ce.function(
    'ErrorCode',
    parts.map((part) => ce.string(part)),
    site === undefined ? undefined : { metadata: { sourceOffsets: site } }
  );
  return ce.function('Error', [code]);
}

/**
 * The source range of the use that made the `read-before-declaration`
 * error value `error` (see `readBeforeDeclarationError()`), or `undefined`
 * when `error` is not such an error or the use had no source range.
 */
export function readBeforeDeclarationSite(
  error: Expression
): [start: number, end: number] | undefined {
  if (!isFunction(error, 'Error')) return undefined;
  const code = error.ops[0];
  if (!isFunction(code, 'ErrorCode')) return undefined;
  const id = code.ops[0];
  if (!isString(id) || id.string !== 'read-before-declaration')
    return undefined;
  return code.sourceOffsets;
}
