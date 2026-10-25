import type {
  EvaluateOptions,
  Expression,
  OperandDescriptor,
} from '../global-types.js';
import { isFunction, isSymbol } from './type-guards.js';

/**
 * Whether the expression `expr`, an element of a `List` literal,
 * may evaluate to `Nothing`. A list erases such an element:
 * `[If(c, "a", Nothing)]` is `[]` when `c` is false. The number of
 * operands of the literal then does not prove the length of its value. The
 * type of `expr` cannot tell: `nothing` is the bottom type, so the type of
 * `If(c, "a", Nothing)` is `string`.
 *
 * Recognized: an element typed `nothing`, and an `If` or a `Which` with a
 * branch that may evaluate to `Nothing`. A call of a function whose body
 * returns `Nothing` on some branch is not recognized.
 *
 * {@link mayEvaluateToNothingD} applies the same rule to an operand
 * descriptor.
 */
export function mayEvaluateToNothing(expr: Expression): boolean {
  if (expr.type.type === 'nothing') return true;
  if (!isFunction(expr)) return false;
  if (expr.operator !== 'If' && expr.operator !== 'Which') return false;
  return expr.ops.some(mayEvaluateToNothing);
}

/** The rule of {@link mayEvaluateToNothing}, read from an operand
 * descriptor (the operand of a type handler). */
export function mayEvaluateToNothingD(d: OperandDescriptor): boolean {
  if (d.type === 'nothing') return true;
  const s = d.structureOf?.();
  if (s?.kind !== 'application') return false;
  if (s.head !== 'If' && s.head !== 'Which') return false;
  return s.children.some(mayEvaluateToNothingD);
}

/**
 * Whether `xs` is a `List` literal with an element that may
 * evaluate to `Nothing` ({@link mayEvaluateToNothing}).
 *
 * A broadcast walks the operands of a list literal and evaluates each one in
 * its own cell, so the list never erases an element that evaluates to
 * `Nothing`: with `c` false, `Sin([If(c, 1, Nothing), 2])` was
 * `[Sin(Nothing), Sin(2)]`. A broadcast evaluates such a list first, and
 * walks the elements of its value: `[Sin(2)]`.
 */
export function literalMayEraseElement(xs: Expression): boolean {
  if (!isFunction(xs, 'List')) return false;
  // The scan reads the type of every element, and a collection handler asks
  // this question on every call: a loop of `at(1)` … `at(n)` over a literal
  // scanned n elements n times. The answer is kept per literal. The types of
  // the elements can change only with a semantic change of the engine (a
  // declaration, an assignment), so the answer is valid while the engine's
  // `_semanticVersion` is the same.
  const generation = xs.engine._semanticVersion;
  const memo = erasureMemo.get(xs);
  if (memo !== undefined && memo.generation === generation) return memo.value;
  // Written-out data (number literals, failed cells, and lists or tuples of
  // them: `_isLiteralData()`) has no element typed `nothing`, and that test
  // is kept on the node. The scan reads the type of each element, which
  // costs about 10 µs for a `Tuple` of two numbers whose type is not known
  // yet: about 200 ms for a list of 20,000 points.
  const value = xs._isLiteralData() ? false : xs.ops.some(mayEvaluateToNothing);
  erasureMemo.set(xs, { generation, value });
  return value;
}

/**
 * The `List` literal `xs` with its erasure resolved: each element
 * that may evaluate to `Nothing` ({@link mayEvaluateToNothing}) is evaluated
 * exactly and dropped when its value is `Nothing`, and every other element
 * is kept as it is written. The answer is `undefined` when an element still
 * may evaluate to `Nothing` after its evaluation (a condition with no value
 * yet).
 *
 * This is the literal that a consumer which approximates what it reads can
 * walk: the elements it keeps are the elements of the value of `xs`, and each
 * one is evaluated by the consumer, as the elements of a literal with no
 * such element are. An exact evaluation of the whole literal evaluated every
 * element exactly first, which can cost much more than the approximation:
 * the 2 600-digit rational of `Sum(1/k, k, 1, 6000)` takes seconds. An
 * element kept as written also keeps its exact value for the functions that
 * jump at a point (`Floor`, `Mod`), which read the exact value of their
 * operand under `.N()`.
 *
 * The elements that may erase are evaluated before the elements that come
 * before them, and an undecided answer makes the caller evaluate the whole
 * literal again. So the caller must use this function only for a literal
 * that is transitively pure (`isTransitivelyPure`): an element with a side
 * effect would otherwise run out of order, or twice.
 *
 * `options` are the options of the evaluation of each element that may
 * erase (exact: `numericApproximation` is not read from them).
 */
export function literalWithErasureResolved(
  xs: Expression,
  options?: Partial<EvaluateOptions>
): Expression | undefined {
  if (!isFunction(xs, 'List')) return undefined;
  const kept: Expression[] = [];
  for (const x of xs.ops) {
    if (!mayEvaluateToNothing(x)) {
      kept.push(x);
      continue;
    }
    const value = x.evaluate({ ...options, numericApproximation: false });
    if (isSymbol(value, 'Nothing')) continue;
    if (mayEvaluateToNothing(value)) return undefined;
    kept.push(value);
  }
  return xs.engine._fn(xs.operator, kept);
}

/**
 * Async mirror of {@link literalWithErasureResolved}: each element that may
 * erase is evaluated with `evaluateAsync`, so that a condition which needs
 * an operator with only an `evaluateAsync` handler gets its value. The same
 * purity requirement applies.
 */
export async function literalWithErasureResolvedAsync(
  xs: Expression,
  options?: Partial<EvaluateOptions>
): Promise<Expression | undefined> {
  if (!isFunction(xs, 'List')) return undefined;
  const kept: Expression[] = [];
  for (const x of xs.ops) {
    if (!mayEvaluateToNothing(x)) {
      kept.push(x);
      continue;
    }
    // The spread already copies the captured registry (`_effects`) and the
    // context stack; `_effects` is named again only so that the source-text
    // audit in `effects-registry.test.ts`, which reads the object literal,
    // finds it.
    const value = await x.evaluateAsync({
      ...options,
      numericApproximation: false,
      _effects: options?._effects,
    });
    if (isSymbol(value, 'Nothing')) continue;
    if (mayEvaluateToNothing(value)) return undefined;
    kept.push(value);
  }
  return xs.engine._fn(xs.operator, kept);
}

/** The answers of {@link literalMayEraseElement}, with the engine's
 * `_semanticVersion` at the time each answer was computed. */
const erasureMemo = new WeakMap<
  Expression,
  { generation: number; value: boolean }
>();
