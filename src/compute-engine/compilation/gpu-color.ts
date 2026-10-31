// Color operands and color-space conversion in shaders.

import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import type { CompileTarget, CompiledColorSpace } from './types.js';
import { colorSpaceIsUnsettled, colorSpaceOf } from './color-space-fact.js';
import { BaseCompiler, isProvablyTupleParticipant } from './base-compiler.js';
import { gpuVec3 } from './gpu-emit.js';
import { gpuColorSymbolReads } from './gpu-declared-types.js';
import { assertGPUScalarComponents } from './gpu-shapes.js';

/** The five typed color heads. Their operands are components in their own
 *  color space. */
export const GPU_COLOR_HEADS = new Set(['Rgb', 'Hsv', 'Hsl', 'Oklab', 'Oklch']);

/**
 * The color-space names a shader can read channels in. Each one has a helper
 * in the preamble that converts it back to OKLCh (`gpuToOklch`), so a color
 * built in one of these spaces can be consumed anywhere. `lab` is the
 * alternate spelling of `oklab` the interpreter also accepts.
 */
export const GPU_COLOR_SPACES: ReadonlySet<string> = new Set([
  'oklch',
  'oklab',
  'lab',
  'rgb',
  'hsl',
  'hsv',
]);

/**
 * The `vec3` of the three channels of an `Oklch` or `Oklab` color, wrapped in
 * the run-time channel check `_gpu_finite_color` (see
 * `GPU_FINITE_COLOR_GLSL`), which gives the `NaN` color for an infinite or
 * `NaN` channel, as the javascript target does.
 *
 * The check is left out when the three channels are finite number literals:
 * such a triple passes it in every fragment. This keeps the emission of a
 * constant color as short as it was. CE-241.3.
 */
export function gpuFiniteColorChannels(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  const channels = args.slice(0, 3);
  const code = `${gpuVec3(target)}(${channels.map((x) => compile(x)).join(', ')})`;
  const finiteLiterals = channels.every(
    (x) => isNumber(x) && x.im === 0 && Number.isFinite(x.re)
  );
  return finiteLiterals ? code : `_gpu_finite_color(${code})`;
}

/**
 * Compile an operand that sits at a COLOR position.
 *
 * A bare tuple written at a color position denotes 0-1 sRGB components on
 * every route, so `ColorMix((1, 0, 0), (0, 0, 1), 0.5)` mixes red with blue
 * exactly as the interpreter does. A color VALUE on a shader is the canonical
 * OKLCh `vec3`, so a tuple written at the call site takes the same conversion
 * `Rgb(r, g, b)` takes. Without it the shader read that tuple as an OKLCh
 * triple and computed a different color than the interpreter for the same
 * expression.
 *
 * A tuple that reaches this position any OTHER way — a tuple-typed variable,
 * or a head that answers components such as `ColorToColorspace` — is
 * DECLINED. A tuple is COMPONENTS, and the interpreter refuses one whose
 * channels it cannot read, so reading the same vector as a canonical OKLCh
 * color would answer a color no other route agrees with. Write
 * `AsRgb(components)` to read them as 0-1 sRGB, or
 * `ColorFromColorspace(components, space)` for another space.
 *
 * Only a head that CONSUMES a color reaches that decline. The heads that take
 * components in their own signature — the five `As*` conversions and
 * `ColorToColorspace` — read such an operand as 0-1 sRGB components instead,
 * through `gpuColorEntryOperand`, which is why the message can tell the
 * caller to write one of them.
 *
 * A `List` written at a color position is refused; only an operand of unknown
 * shape keeps the canonical reading. The interpreter's signatures say `tuple`
 * and it answers `incompatible-type` for a list, so a shader must not quietly
 * read as a color what the engine calls an error. A literal tuple of any
 * width other than 3 or 4 is refused for the same reason.
 *
 * An operand that is itself a color CONVERSION holds channels in the space it
 * names, not OKLCh. A shader color is a bare `vec3` with no run-time tag, so
 * the space has to be known at compile time: `colorSpaceOf` supplies it and
 * the conversion back to OKLCh is emitted here. An operand whose space is
 * UNKNOWN — a symbol, a `vars` input, a user function whose body is not
 * visible — keeps today's reading and is taken to be OKLCh, which is the
 * shader's `vec3` color contract.
 *
 * That reading is only safe for a PLAIN unknown. An operand the compiler can
 * see holds a converted color at one of the positions its value comes from,
 * without being able to say which — `Which(cond, AsRgb(x), AsHsv(y))`, whose
 * arms name two different spaces — is declined instead: reading it as OKLCh
 * would answer a different color from the interpreter for at least one of its
 * run-time values.
 */
export function gpuColorOperand(
  head: string,
  color: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  if (isFunction(color, 'List'))
    throw new Error(
      `Could not compile \`${head}\`: a list is not a color — a color operand must be a color, a ` +
        `color string or a tuple of 3 or 4 components.`
    );
  if (!isFunction(color) || color.operator !== 'Tuple') {
    if (isProvablyTupleParticipant(color))
      throw new Error(
        `Could not compile \`${head}\`: this operator takes a COLOR, and a tuple is color ` +
          `COMPONENTS, not a color. Build a color from the components ` +
          `first — \`AsRgb((r, g, b))\` reads them as 0-1 sRGB, and ` +
          `\`ColorFromColorspace(components, space)\` reads them in any ` +
          `named space.`
      );
    if (colorSpaceIsUnsettled(color))
      throw new Error(
        `Could not compile \`${head}\`: cannot settle the color space of the operand at compile ` +
          `time — it holds a converted color at one of the positions its ` +
          `value comes from, and a shader color is a bare vector with no ` +
          `run-time tag, so the channels cannot be converted back to OKLCh.`
      );
    // A free symbol read here is a colour: the emitted code reads it as a
    // `vec3`, whatever its engine type says (see `gpuColorSymbolReads`).
    if (isSymbol(color) && target?.loweredSymbolType !== undefined)
      gpuColorSymbolReads.get(target.loweredSymbolType)?.add(color.symbol);
    return gpuToOklch(compile(color), colorSpaceOf(color));
  }
  const ops = color.ops;
  if (ops.length < 3 || ops.length > 4)
    throw new Error(
      `Could not compile \`${head}\`: a tuple of ${ops.length} components is not a color — a color ` +
        `tuple has 3 components, or 4 with the fourth read as alpha.`
    );
  assertNoGPUAlpha(head, ops);
  // The `vec3` constructor below is built here rather than by the `Tuple`
  // lowering, so the shape gate that lowering applies has to be applied here
  // too: a vector-valued component emitted `vec3(1.0, vec2(0.0, 1.0), 0.0)`,
  // which no driver accepts.
  assertGPUScalarComponents(ops.slice(0, 3), gpuVec3(target));
  return `_gpu_srgb_to_oklch(${gpuVec3(target)}(${ops
    .slice(0, 3)
    .map((op) => compile(op))
    .join(', ')}))`;
}

/**
 * Compile the operand of an ENTRY function — one of the five `As*`
 * conversions, or `ColorToColorspace` — which takes components as well as a
 * color.
 *
 * These heads are the way a caller turns components into a color, so a tuple
 * at their operand is legitimate input whichever way it arrives. A tuple
 * written literally is read as 0-1 sRGB by `gpuColorOperand`, and a tuple
 * that arrives through a variable, or from a head that answers components
 * such as `ColorToColorspace`, is read the same way here: its compiled value
 * is a `vec3` of the three channels, and `_gpu_srgb_to_oklch` makes the
 * canonical color of them.
 *
 * sRGB is the reading even when `colorSpaceOf` names another space for those
 * channels. The interpreter reads EVERY tuple at a color position as 0-1 sRGB
 * components — `AsRgb(ColorToColorspace(c, "hsv"))` answers the hue,
 * saturation and value read as red, green and blue — so any other reading
 * would answer a color no other route agrees with. A caller who means the
 * channels in the space they were computed in writes
 * `ColorFromColorspace(components, space)`, which builds a color in that
 * space.
 *
 * A 4th channel is alpha, which a shader color cannot carry, so a tuple whose
 * width is known to be 4 is declined with the same message a 4-operand color
 * constructor gets. A width the type does not state is read as the `vec3` it
 * must be: the shader compiler refuses the call outright if the value turns
 * out to be another vector, so no wrong color can come of it.
 *
 * Every other color head CONSUMES a color and declines the same operand
 * (`gpuColorOperand`).
 */
export function gpuColorEntryOperand(
  head: string,
  color: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  const literalTuple = isFunction(color) && color.operator === 'Tuple';
  if (!literalTuple && isProvablyTupleParticipant(color)) {
    const width = BaseCompiler.aggregateComponentCount(color);
    if (width === 4) refuseGPUAlpha(head);
    if (width !== undefined && width !== 3)
      throw new Error(
        `Could not compile \`${head}\`: a tuple of ${width} components is not a color — color ` +
          `components are 3 channels, or 4 with the fourth read as alpha.`
      );
    return `_gpu_srgb_to_oklch(${compile(color)})`;
  }
  return gpuColorOperand(head, color, compile, target);
}

/**
 * Convert compiled color code from the space `colorSpaceOf` proved for it back
 * to the canonical OKLCh `vec3` a shader color operand must be.
 *
 * Every conversion here already exists in the shader preamble, so no nesting
 * has to be declined for want of a reverse helper. An unknown space is read as
 * OKLCh — the `vec3` contract of a color that reaches the shader through a
 * symbol or a uniform.
 */
function gpuToOklch(
  code: string,
  space: CompiledColorSpace | undefined
): string {
  switch (space) {
    case 'rgb':
      return `_gpu_srgb_to_oklch(${code})`;
    case 'oklab':
      return `_gpu_oklab_to_oklch(${code})`;
    case 'hsl':
      return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${code}))`;
    case 'hsv':
      return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${code}))`;
    default:
      return code;
  }
}

/**
 * Fail closed on a color constructor given a 4th (alpha) operand.
 *
 * The whole `_gpu_*` color chain — `srgb_to_oklch`, `oklch_to_srgb`,
 * `hsl_to_rgb`, `hsv_to_rgb`, `oklab_to_oklch`, … — is `vec3` end to end, and
 * alpha is orthogonal to color-space conversion, so there is no vec4 form to
 * lower to. Emitting the 3-component value would silently DROP the alpha the
 * JavaScript target preserves, so decline instead and let the caller pass
 * alpha separately.
 */
export function assertNoGPUAlpha(
  head: string,
  args: ReadonlyArray<Expression>
): void {
  if (args.length <= 3) return;
  refuseGPUAlpha(head);
}

/** The decline of an alpha channel a shader color cannot carry, shared by the
 *  color constructors and by a 4-wide components tuple
 *  (`gpuColorEntryOperand`). */
function refuseGPUAlpha(head: string): never {
  throw new Error(
    `Could not compile \`${head}\`: an alpha (4th) operand is not representable on the GPU target — ` +
      `color values are \`vec3\` (OKLCh) end to end, with no alpha channel. ` +
      `Drop the alpha operand and pass it separately (e.g. as a uniform) at ` +
      `the framebuffer boundary.`
  );
}
