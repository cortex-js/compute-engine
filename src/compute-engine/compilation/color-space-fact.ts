import type { Expression } from '../global-types.js';
import { isFunction, isString } from '../boxed-expression/type-guards.js';
import { functionLiteralBody } from '../boxed-expression/function-literal.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
import type { CompiledColorSpace } from './types.js';

/**
 * The color space of the CHANNELS the compiled value of `expr` holds, when the
 * compiler can see it, and `undefined` when it cannot.
 *
 * A color value carries its space at run time on the JavaScript target
 * (`CompiledColor`), so this fact is only an optimization there — it says when
 * a conversion to OKLCh can be skipped. On the SHADER targets there is no run
 * time tag at all: a color is a bare `vec3` read as OKLCh, so this fact is the
 * only thing that can tell the shader that an operand holds sRGB or HSV
 * channels instead, and a named space other than `oklch` has to be converted
 * statically before the operand is consumed.
 *
 * The rules, in one place:
 *
 * - Every color CONSTRUCTOR (`Rgb`, `Hsv`, `Hsl`, `Oklab`, `Oklch`) and every
 *   operator that PRODUCES a color (`Color`, `Colormap`, `ColorFromColorspace`,
 *   `ColorMix`, `ContrastingColor`) answers `oklch`: they take components in
 *   their own space but the value they build is canonical.
 * - `AsRgb`, `AsHsv`, `AsHsl`, `AsOklab` and `AsOklch` answer the space they
 *   name.
 * - `ColorToColorspace(c, "<literal>")` answers the literal space (`lab` is
 *   the `oklab` spelling the interpreter also accepts). With a non-literal
 *   space operand the fact is unknown. This head answers COMPONENTS, not a
 *   color value: on the JavaScript target its compiled value is a bare array
 *   of channels, and only a shader, where a color IS a bare vector of
 *   channels, can read that value at a color position. So a JavaScript caller
 *   that needs "is this a color value?" must ask the TYPE
 *   (`isColorValued`), not this fact.
 * - `Which` and `If` answer the space their value ARMS agree on, and
 *   `undefined` when the arms disagree or any arm is unknown. Without this a
 *   selection between two converted colors read as OKLCh on a shader.
 * - A symbol, a `vars` input, and the result of a user function whose body is
 *   not visible answer `undefined`. A caller may bind any color to such a
 *   position, and on a shader that value is read as OKLCh, which is the `vec3`
 *   contract.
 * - A user function WITH a visible body answers the body's fact, so
 *   `f(x) := AsRgb(x)` used at a color position is seen as sRGB.
 *
 * A color STRING deliberately has no fact. On the JavaScript target a string
 * stays a string until a helper parses it, and on a shader a string literal is
 * already lowered to an OKLCh `vec3` constant, which is what an unknown fact
 * assumes.
 */
export function colorSpaceOf(
  expr: Expression,
  depth = 0
): CompiledColorSpace | undefined {
  // A body that reaches back into itself would not terminate. The bound is
  // generous: a color operand nested past it is treated as unknown, which is
  // the conservative answer everywhere this fact is read.
  if (depth > 16) return undefined;
  if (!isFunction(expr)) return undefined;
  const head = expr.operator;
  if (OKLCH_VALUED_HEADS.has(head)) return 'oklch';
  const named = CONVERSION_SPACE[head];
  if (named !== undefined) return named;
  if (head === 'ColorToColorspace') {
    const space = expr.ops[1];
    if (space === undefined || !isString(space)) return undefined;
    const name = space.string?.toLowerCase();
    if (name === 'lab') return 'oklab';
    return name !== undefined && COLOR_SPACE_NAMES.has(name)
      ? (name as CompiledColorSpace)
      : undefined;
  }
  // Every remaining shape carries its value at one or more INNER positions —
  // a block's last statement, an ascription's value, the arms of a selection,
  // a visible function body. The fact is the one those positions agree on: a
  // single position forwards its own answer, and a selection whose arms
  // disagree, or any of whose arms is unknown, has no fact at all.
  const positions = colorValuePositions(expr);
  let common: CompiledColorSpace | undefined;
  for (const p of positions) {
    const space = colorSpaceOf(p, depth + 1);
    if (space === undefined) return undefined;
    if (common === undefined) common = space;
    else if (common !== space) return undefined;
  }
  return common;
}

/**
 * The color space of `expr` cannot be settled at compile time, AND at least
 * one position its value can come from visibly holds channels in a named
 * space other than OKLCh.
 *
 * A shader target must decline such an operand. A color is a bare `vec3`
 * there, an unknown space is read as OKLCh, and that reading is right for a
 * plain unknown — a symbol or a `vars` uniform, which the shader's color
 * contract says is already canonical. It is WRONG for a selection such as
 * `Which(cond, AsRgb(x), AsHsv(y))`, where the compiler can see that one arm
 * at least holds channels in a named space and cannot say which arm the value
 * comes from.
 */
export function colorSpaceIsUnsettled(expr: Expression): boolean {
  if (colorSpaceOf(expr) !== undefined) return false;
  return hasNamedSpaceSource(expr, 0);
}

/** Does any position `expr`'s value can come from hold channels in a named
 * space other than OKLCh? The walk stops at the same depth `colorSpaceOf`
 * does, and an unbounded shape answers `false` — the conservative answer,
 * which keeps the OKLCh reading rather than declining. */
function hasNamedSpaceSource(expr: Expression, depth: number): boolean {
  if (depth > 16) return false;
  return colorValuePositions(expr).some((p) => {
    const space = colorSpaceOf(p, depth + 1);
    if (space !== undefined) return space !== 'oklch';
    return hasNamedSpaceSource(p, depth + 1);
  });
}

/**
 * The inner positions the VALUE of `expr` comes from, when its head is one
 * that forwards a value rather than building one.
 *
 * - A function literal wraps its body in a scoped `Block`, whose value is its
 *   LAST statement.
 * - A return-type ascription wraps the value it ascribes. The normalized
 *   spelling of a function-literal return type is `Typed` (see
 *   `boxed-expression/function-literal.ts`); `Annotated` is the general
 *   annotation wrapper. Both carry the value as their FIRST operand.
 * - `Which` pairs each condition with the value it selects, so the value arms
 *   are the operands at ODD positions; `If(condition, then, else)` selects
 *   between its second and third operands. An `If` with no `else` arm, and a
 *   `Which` with an odd operand count (a malformed call), have no arms here:
 *   the value may be an absence marker, which has no color space.
 * - Anything else forwards the body of the user function it applies, when the
 *   engine holds one.
 */
function colorValuePositions(expr: Expression): ReadonlyArray<Expression> {
  if (!isFunction(expr)) return [];
  const head = expr.operator;
  if (head === 'Block') {
    const last = expr.ops[expr.ops.length - 1];
    return last === undefined ? [] : [last];
  }
  if (head === 'Annotated' || head === 'Typed') {
    const value = expr.ops[0];
    return value === undefined ? [] : [value];
  }
  if (head === 'Which') {
    const ops = expr.ops;
    if (ops.length === 0 || ops.length % 2 !== 0) return [];
    return ops.filter((_, i) => i % 2 === 1);
  }
  if (head === 'If') {
    const ops = expr.ops;
    return ops.length >= 3 ? [ops[1], ops[2]] : [];
  }
  const body = visibleFunctionBody(expr);
  return body === undefined ? [] : [body];
}

/**
 * Is the compiled value of `expr` on the JavaScript target a color VALUE — a
 * `CompiledColor` object, or a (possibly nested) collection of them?
 *
 * The question is answered by the TYPE, not by the head: every expression
 * whose type is a color, at every nesting depth, has the color representation
 * whatever operator built it, and an expression typed otherwise does not.
 * `broadcastable<T>` admits a scalar `T` and a list of `T`, and each wrapper
 * only ADDS shapes, so one test at the deepest spelling answers every
 * shallower one. The sibling constant `NESTED_COLOR_BROADCAST_TYPE`
 * (`javascript-target.ts`) has the same shape for the same reason — it gates
 * the OPERAND of a conversion, this gates the VALUE of an expression.
 *
 * `ColorFromColorspace` is the one head the type cannot speak for. It is
 * declared `-> tuple` and evaluates to an sRGB components tuple, while its
 * lowering on this target answers a color value — the route divergence its
 * own description states (`library/colors.ts`).
 */
export function isColorValued(expr: Expression): boolean {
  if (isFunction(expr, 'ColorFromColorspace')) return true;
  return expr.type.matches(
    'broadcastable<broadcastable<broadcastable<broadcastable<color>>>>'
  );
}

/** The heads whose compiled value is a color in the canonical OKLCh space. */
const OKLCH_VALUED_HEADS: ReadonlySet<string> = new Set([
  'Rgb',
  'Hsv',
  'Hsl',
  'Oklab',
  'Oklch',
  'Color',
  'Colormap',
  'ColorFromColorspace',
  'ColorMix',
  'ContrastingColor',
]);

/** The heads whose compiled value is channels in the space they name. */
const CONVERSION_SPACE: Readonly<Record<string, CompiledColorSpace>> = {
  AsRgb: 'rgb',
  AsHsv: 'hsv',
  AsHsl: 'hsl',
  AsOklab: 'oklab',
  AsOklch: 'oklch',
};

const COLOR_SPACE_NAMES: ReadonlySet<string> = new Set([
  'oklch',
  'rgb',
  'hsv',
  'hsl',
  'oklab',
]);

/**
 * The body of the user function `expr` applies, when the engine holds one.
 *
 * A user function is held either as an OPERATOR definition carrying its lambda
 * (`_lambdaLiteral`, the shape `f(x) := …` and `ce.assign('f', lambda)`
 * install) or as a VALUE definition whose value is the `Function` literal. A
 * head with neither — every built-in operator — has no visible body.
 *
 * A MULTI-CLAUSE function is not read: its clauses can answer different color
 * spaces and the lambda slot does not hold their common shape, so the fact
 * stays unknown, which is the conservative answer everywhere it is used.
 *
 * The body is read WITHOUT substituting the arguments: the color space of a
 * body is a property of its shape, not of the values passed in.
 */
function visibleFunctionBody(expr: Expression): Expression | undefined {
  const def = expr.engine.lookupDefinition(expr.operator);
  if (def === undefined) return undefined;
  if ('operator' in def) {
    const op = def.operator as {
      _lambdaLiteral?: Expression;
      _isMultiClause?: boolean;
    };
    if (op._isMultiClause === true) return undefined;
    const literal = op._lambdaLiteral;
    return literal === undefined ? undefined : functionLiteralBody(literal);
  }
  if (!isValueDef(def)) return undefined;
  const held = def.value.value;
  return held === undefined ? undefined : functionLiteralBody(held);
}
