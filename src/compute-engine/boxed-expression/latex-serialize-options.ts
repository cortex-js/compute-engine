import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  ParseLatexOptions,
  SerializeLatexOptions,
} from '../latex-syntax/types.js';
import type { IComputeEngine as ComputeEngine } from '../global-types.js';
import { CancellationError } from '../../common/interruptible.js';
import { isPointListCoordinateSource } from '../collection-utils.js';
import { isNumberExpression, stringValue } from '../../math-json/utils.js';

/**
 * The options the engine passes to the LaTeX serializer: the engine-wide
 * `ce.latexOptions`, then the per-call `options`, and the
 * `readsAsPointList` function.
 *
 * `readsAsPointList` tells the `Tuple` serializer to use the spelling
 * `\operatorname{Tuple}(…)`, which always parses back as a `Tuple`, instead
 * of the parenthesized list `(a, b, …)`. The parser reads a parenthesized list
 * as a list of points (`PointList`) when an operand is a finite list of
 * numbers and every other operand is a number or has no known type
 * (`isPointListReading`, applied by the `Delimiter` canonical handler in
 * `library/core.ts`). For example, `Tuple(A, B)`, with `A` and `B` declared
 * `list<real>`, is spelled `\operatorname{Tuple}(A,B)`.
 *
 * This function returns `true` when ANY operand is a list of numbers
 * (`isPointListCoordinateSource`), and does not check the other operands. The
 * parser checks them in the scope where the tuple is, and that scope can be
 * different from the scope current here: a function parameter can hide a
 * global symbol of the same name. The longer spelling is always correct, so
 * it is used whenever a list of numbers is present.
 *
 * The operands are boxed one at a time, and the loop stops at the first list.
 * A number or string literal is not boxed: it is never a list. The operands
 * are boxed inside `ce._resolveOnly()`: serialization is a read, and it must
 * not declare a symbol or infer a type in the current scope.
 */
export function latexSerializeOptions(
  ce: ComputeEngine,
  options?: Partial<SerializeLatexOptions>
): Partial<ParseLatexOptions & SerializeLatexOptions> {
  return {
    ...ce.latexOptions,
    ...options,
    readsAsPointList: (ops: ReadonlyArray<MathJsonExpression>) => {
      try {
        return ce._resolveOnly(() =>
          ops.some(
            (op) =>
              !isNumberExpression(op) &&
              stringValue(op) === null &&
              isPointListCoordinateSource(ce.box(op))
          )
        );
      } catch (e) {
        // A time limit set by the caller must expire. Any other failure to
        // box an operand returns `undefined`: the serializer then uses its
        // test on the MathJSON alone.
        if (e instanceof CancellationError) throw e;
        return undefined;
      }
    },
  };
}
