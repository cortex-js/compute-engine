import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  ParseLatexOptions,
  SerializeLatexOptions,
} from '../latex-syntax/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  JsonSerializationOptions,
} from '../global-types.js';
import { CancellationError } from '../../common/interruptible.js';
import { isPointListCoordinateSource } from '../collection-utils.js';
import { isNumberExpression, stringValue } from '../../math-json/utils.js';
import { isFunction } from './type-guards.js';

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
 * When `source`, the bound expression that is serialized, is given, the
 * operands of its `Tuple` subexpressions are examined first, with the
 * bindings they have in `source` (see `tupleOperandSources()`). This is
 * necessary when `source` was parsed in a scope that is not the current
 * scope: `\operatorname{Tuple}(A, 0)` parsed with a `scope` option that
 * declares `A` as `list<real>` must keep the long spelling when it is
 * serialized outside that scope, where `A` is not declared.
 * `sourceJson` must be the options that made the MathJSON given to the
 * serializer from `source`: an operand is found by its MathJSON form, and a
 * compound operand has a different form with other options (with
 * `prettify`, `A - 1` is `["Subtract", "A", 1]`, not `["Add", "A", -1]`).
 *
 * An operand that is not found this way is boxed, one at a time, and the
 * loop stops at the first list. A number or string literal is not boxed: it
 * is never a list. The operands are boxed inside `ce._resolveOnly()`:
 * serialization is a read, and it must not declare a symbol or infer a type
 * in the current scope.
 */
export function latexSerializeOptions(
  ce: ComputeEngine,
  options?: Partial<SerializeLatexOptions>,
  source?: Expression,
  sourceJson?: Readonly<Partial<JsonSerializationOptions>>
): Partial<ParseLatexOptions & SerializeLatexOptions> {
  // Computed when the serializer first meets a tuple, and only once.
  let known: Map<string, boolean> | undefined;
  return {
    ...ce.latexOptions,
    ...options,
    readsAsPointList: (ops: ReadonlyArray<MathJsonExpression>) => {
      try {
        return ce._resolveOnly(() => {
          if (source !== undefined && known === undefined)
            known = tupleOperandSources(source, sourceJson);
          return ops.some((op) => {
            if (isNumberExpression(op) || stringValue(op) !== null)
              return false;
            const fromSource = known?.get(JSON.stringify(op));
            if (fromSource !== undefined) return fromSource;
            return isPointListCoordinateSource(ce.box(op));
          });
        });
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

/**
 * For each operand of a `Tuple` subexpression of `expr`, keyed by the JSON
 * text of its MathJSON form: whether the operand, bound as it is in `expr`,
 * is a list of numbers (`isPointListCoordinateSource`). Two operands with
 * the same MathJSON form can have different bindings (a function parameter
 * can hide a global symbol of the same name). Then the entry is `true` if
 * one of them is a list of numbers: the long spelling is always correct.
 *
 * Each operand has two keys: its default MathJSON form (`op.json`) and its
 * form with the options `jsonOptions`, when they are given. The serializer
 * receives the MathJSON made with `jsonOptions`, and the default form is
 * kept for a caller that serializes `op.json`.
 *
 * An expression that is not bound (neither canonical nor structural) has no
 * bindings to read, and gives an empty map.
 */
function tupleOperandSources(
  expr: Expression,
  jsonOptions?: Readonly<Partial<JsonSerializationOptions>>
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  if (!expr.isCanonical && !expr.isStructural) return result;
  const visit = (e: Expression): void => {
    if (!isFunction(e)) return;
    if (e.operator === 'Tuple') {
      for (const op of e.ops) {
        const keys = [JSON.stringify(op.json)];
        if (jsonOptions !== undefined)
          keys.push(JSON.stringify(op.toMathJson(jsonOptions)));
        const isList = isPointListCoordinateSource(op);
        for (const key of keys)
          if (result.get(key) !== true) result.set(key, isList);
      }
    }
    for (const op of e.ops) visit(op);
  };
  visit(expr);
  return result;
}
