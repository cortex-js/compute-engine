import type { Expression, RoundingTies } from '../global-types.js';
import { entrySource } from './function-purity.js';
import { isCallerMapped } from './cse.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import {
  clearGPUCounters,
  gpuIntegerFact,
  recordGPUCounter,
} from './gpu-value-facts.js';
import {
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
} from '../../common/type/primitive.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { rgbToOklch } from '@arnog/colors';
import { parseColorString } from '../library/colors.js';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  isOpaqueComplexOperand,
  formatFloat,
  gpuNonFiniteLiteral,
  negativeBaseRealPow,
  principalComplexPow,
  foldEmittedGPUCode,
  callerSpliceSources,
} from './constant-folding.js';

import type {
  CompileMode,
  CompileTarget,
  CompiledColorSpace,
  CompiledOperators,
  CompiledFunction,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
  StorageKind,
} from './types.js';
import { compileDiagnosticOf, compileSubject } from './diagnostics.js';
import { colorSpaceIsUnsettled, colorSpaceOf } from './color-space-fact.js';
import { resolveStorageHints } from './storage-hints.js';
import {
  BaseCompiler,
  explicitBroadcastPointNorm,
  isProvablyCharacterOperand,
  isProvablyStringOperand,
  isProvablyTupleParticipant,
  pointHasBroadcastComponent,
  statementBodyHead,
} from './base-compiler.js';
import type { LoopInvariantBinding } from './base-compiler.js';
import {
  signatureEffects,
  finitePartOfType,
  isNonRealNumber,
  resolveTypeAlias,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import {
  collectBinderNames,
  isOperatorDef,
  isValueDef,
} from '../boxed-expression/utils.js';
import {
  functionLiteralParameterName,
  isRestParameter,
} from '../boxed-expression/function-literal.js';
import { isBroadcastableCollection } from '../collection-utils.js';
import { literalParamsMap } from '../library/core.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { rewriteAngularUnit } from './angular-unit.js';
import {
  overriddenCompilationHeads,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import { foldSeed } from '../numerics/random.js';
import { rangeCount } from '../numerics/range-count.js';
import { smallCount } from '../boxed-expression/collection-count.js';

/**
 * GPU shader operators shared by GLSL and WGSL.
 *
 * Both languages use identical C-style operators for arithmetic,
 * comparison, and logical operations.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
export const GPU_OPERATORS: CompiledOperators = {
  __proto__: null as never,
  Add: ['+', 11],
  Negate: ['-', 14],
  Subtract: ['-', 11], // Subtract canonicalizes to Add+Negate; kept as fallback
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['==', 8],
  NotEqual: ['!=', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14],
};

/**
 * GLSL reserved keywords (ES 3.x + desktop) and reserved-for-future-use words.
 * A user variable carrying one of these names cannot be emitted as a bare
 * identifier — the shader would fail to compile — so the target fails closed
 * (D6) rather than silently emit invalid source. Includes type/qualifier
 * keywords, control-flow keywords, and common built-in function names that a
 * bare reference would shadow/collide with (`texture`, `sample`, …).
 */
/**
 * The most elements a shader target inlines into a fixed-size array
 * constructor (`float[n](…)` / `array<f32, n>(…)`).
 *
 * Shared by the `Range` handler, which materializes a constant range as such
 * a literal, and by `CompileTarget.maxInlineElements`, which bounds
 * constant-collection FOLDING. The two must agree: a fold cap below this
 * would refuse a constant collection that the `Range` handler compiles
 * happily, and one above it would emit an array the handler considers too
 * large. Unlike the JavaScript default, this is a capability limit rather
 * than a source-size preference — a dynamic collection has no shader
 * lowering at all, so for a constant one the literal is the only emission
 * that can compile.
 */
const GPU_MAX_INLINE_ELEMENTS = 256;

const GLSL_RESERVED: ReadonlySet<string> = new Set([
  // storage/parameter qualifiers
  'attribute',
  'const',
  'uniform',
  'varying',
  'buffer',
  'shared',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'patch',
  'sample',
  'in',
  'out',
  'inout',
  'precision',
  'invariant',
  'precise',
  'subroutine',
  // precision qualifiers and the aggregate keyword
  'lowp',
  'mediump',
  'highp',
  'struct',
  // control flow
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'discard',
  'return',
  // scalar/vector/matrix types
  'void',
  'bool',
  'int',
  'uint',
  'float',
  'double',
  'vec2',
  'vec3',
  'vec4',
  'dvec2',
  'dvec3',
  'dvec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'dmat2',
  'dmat3',
  'dmat4',
  // opaque/sampler types
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DArray',
  'sampler2DShadow',
  'samplerCubeShadow',
  'isampler2D',
  'usampler2D',
  'atomic_uint',
  'image2D',
  // literals
  'true',
  'false',
  // reserved-for-future-use / common built-ins that a bare var would collide with
  'filter',
  'texture',
  'asm',
  'class',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'packed',
  'goto',
  'inline',
  'noinline',
  'public',
  'static',
  'extern',
  'external',
  'interface',
  'long',
  'short',
  'half',
  'fixed',
  'unsigned',
  'superp',
  'input',
  'output',
  'hvec2',
  'hvec3',
  'hvec4',
  'fvec2',
  'fvec3',
  'fvec4',
  'sizeof',
  'cast',
  'namespace',
  'using',
]);

/**
 * WGSL reserved words + keywords. As with GLSL, a user variable matching one of
 * these cannot be emitted bare; the target fails closed.
 */
const WGSL_RESERVED: ReadonlySet<string> = new Set([
  // keywords
  'alias',
  'break',
  'case',
  'const',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'diagnostic',
  'discard',
  'else',
  'enable',
  'false',
  'fn',
  'for',
  'if',
  'let',
  'loop',
  'override',
  'requires',
  'return',
  'struct',
  'switch',
  'true',
  'var',
  'while',
  // types / type-generators
  'bool',
  'f16',
  'f32',
  'i32',
  'u32',
  'vec2',
  'vec3',
  'vec4',
  'vec2f',
  'vec3f',
  'vec4f',
  'vec2i',
  'vec3i',
  'vec4i',
  'vec2u',
  'vec3u',
  'vec4u',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'array',
  'atomic',
  'ptr',
  'sampler',
  'sampler_comparison',
  'texture_1d',
  'texture_2d',
  'texture_2d_array',
  'texture_3d',
  'texture_cube',
  'texture_cube_array',
  'texture_multisampled_2d',
  // address spaces / builtins that a bare var would collide with
  'function',
  'private',
  'workgroup',
  'uniform',
  'storage',
  'read',
  'write',
  'read_write',
  'texture',
  'sample',
  'filter',
  // reserved words (subset of the WGSL reserved list)
  'as',
  'async',
  'attribute',
  'auto',
  'binding',
  'cast',
  'compile',
  'do',
  'enum',
  'extern',
  'external',
  'inline',
  'instance',
  'interface',
  'match',
  'namespace',
  'new',
  'null',
  'of',
  'operator',
  'public',
  'reference',
  'self',
  'set',
  'shared',
  'static',
  'super',
  'template',
  'this',
  'typedef',
  'union',
  'unless',
  'using',
  'virtual',
  'where',
]);

/** The reserved-word set for a GPU shader language, or an empty set. */
function gpuReservedWords(language?: string): ReadonlySet<string> {
  if (language === 'wgsl') return WGSL_RESERVED;
  if (language === 'glsl') return GLSL_RESERVED;
  return new Set();
}

/**
 * Fail closed if `id` is a reserved word in the target shader language.
 * A user variable / loop index carrying a reserved name would emit source that
 * fails to compile on the GPU — surface a clear diagnostic instead. Returns the
 * identifier unchanged when it is safe.
 */
function gpuCheckIdentifier(id: string, language?: string): string {
  if (gpuReservedWords(language).has(id))
    throw new Error(
      `"${id}" is a reserved word in ${language ?? 'this shader language'} and cannot be used as a variable name. Rename it before compiling to a GPU target (fail closed, D6).`
    );
  return id;
}

/**
 * Fail closed when the compiled shader body `body` places a `return`
 * anywhere but at the start of a statement.
 *
 * `Return` is emitted by the base compiler as the bare statement `return <v>`,
 * which is correct only where a statement is expected. Three positions in a
 * shader body are NOT that, and each emitted source no driver accepts behind
 * `success: true`:
 *
 * - the block's VALUE (its last statement), which the caller return-prefixes —
 *   `return return s;`;
 * - a conditional ARM, which both languages lower to an EXPRESSION (a `?:`
 *   ternary in GLSL, `select(…)` in WGSL) — `((0.0 < t) ? (return t) : …)`;
 * - a branch of a conditional nested in a loop body, for the same reason.
 *
 * Lowering an early return properly means restructuring the body into a result
 * flag and guarded statements, which is a feature, not a gate — so this refuses
 * the shapes it cannot emit and lets the interpreter evaluate them. The one
 * shape that IS valid, an early `Return` as a plain statement of the body, is
 * untouched: its `return` starts its line.
 *
 * `singleLine` bodies are EXPRESSIONS — the caller wraps them in
 * `return <body>;` — so a `return` anywhere in them is misplaced, including at
 * offset 0.
 *
 * A token scan, deliberately: it reads the source that is actually about to be
 * emitted, so it covers every shape (including ones no probe enumerated)
 * rather than mirroring the emitter's position rules. `return` is a reserved
 * word in both languages (`gpuCheckIdentifier`), so `\breturn\b` cannot match a
 * user identifier.
 */
function gpuAssertReturnPlacement(
  subject: string,
  body: string,
  language: string
): void {
  if (!/\breturn\b/.test(body)) return;
  const lines = body.split('\n');
  const singleLine = lines.length === 1;
  for (const line of lines) {
    const start = line.length - line.trimStart().length;
    for (const m of line.matchAll(/\breturn\b/g)) {
      if (!singleLine && m.index === start) continue;
      throw new Error(
        `Could not compile ${compileSubject(subject)}: an early \`Return\` here has no ` +
          `${language.toUpperCase()} lowering — the emitted source would place ` +
          `a \`return\` where the language requires an expression ` +
          `(\`${line.trim()}\`). A shader function returns once, at the end of ` +
          `its body, so a \`Return\` inside a conditional — or one that IS the ` +
          `body's final value — cannot be emitted. Rewrite it as a conditional ` +
          `VALUE, or evaluate instead.`
      );
    }
  }
}

/**
 * Fail closed when `code`, produced by an **expression-only** route, is
 * not a single expression of the target language.
 *
 * `compileToSource()` answers with a bare expression string, and each
 * `compileShader()` body statement is spliced into an assignment RHS
 * (`<variable> = <code>;`). Neither position accepts a statement, and neither
 * GLSL nor WGSL has an expression-level block or immediately-invoked function
 * to wrap one in — so a body that lowers to a statement sequence (a `Block`
 * that returns early, a loop-form `Sum`/`Product`/`Loop` with no sink to hoist
 * into) or to a bare `return` has no honest emission here. Before this gate
 * both routes spliced the statements in verbatim, producing source no driver
 * accepts (`gl_FragColor = float s;\ns = x;\nreturn return s;;`).
 *
 * The shapes that DO reduce to an expression are untouched: a single-statement
 * `Block` already unwraps to its expression in the base compiler, so it never
 * reaches this check with a newline. On the `compileShader()` route, whose
 * body statements carry a hoist sink, a multi-statement `Block` whose value is
 * an expression and a loop-form `Sum` hoist their statements ahead of the
 * assignment and answer a temporary, so they never reach this check either.
 *
 * A token scan on the source about to be emitted, deliberately — the same
 * technique (and the same two signals) as `gpuAssertReturnPlacement` and
 * `BaseCompiler.compileValueOperand`'s `bareStatementBlocks` gate: a multi-line
 * emission is a statement sequence on these targets, and `return` is a reserved
 * word (`gpuCheckIdentifier`) so it cannot match a user identifier.
 *
 * The statement-capable route is `compile()`, which emits a function body — it
 * is what the message points at.
 */
function gpuAssertExpressionOnly(
  subject: string,
  code: string,
  language: string
): void {
  const multiStatement = code.includes('\n');
  if (!multiStatement && !/\breturn\b/.test(code)) return;
  const lang = language.toUpperCase();
  const excerpt = (multiStatement ? code.split('\n')[0] : code).trim();
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `lowers to ${
        multiStatement ? 'a statement sequence' : 'a bare `return` statement'
      } (\`${excerpt}${multiStatement ? '…' : ''}\`). ${lang} has no ` +
      `expression-level block or immediately-invoked function to wrap ` +
      `statements in, so there is no valid emission for this position. ` +
      `Compile a statement body with compile() instead — that route emits a ` +
      `function body.`
  );
}

/**
 * Fail closed on an expression-only GPU route whose body is STRUCTURALLY a
 * statement — an assignment (WGSL only) or a declaration (both languages).
 *
 * `gpuAssertExpressionOnly` scans the emitted source for the two signals a
 * statement leaves there — a newline and a `return` token — but these two
 * shapes leave neither. Both are single-line emissions:
 *
 * - `Assign(s, x)` emits `s = x` on both targets. The languages then diverge.
 *   In GLSL assignment is an OPERATOR, so `fragColor = s = x;` is valid source
 *   and the emission is honest. In WGSL assignment is a STATEMENT, so the same
 *   emission produces `output.fragColor = s = input.x;` — source no WGSL
 *   compiler accepts, behind a reported success.
 * - A root `Declare(s, 'number', x)` emits `float s` / `var s: f32` on BOTH
 *   targets — a declaration is a statement in both languages, and the emission
 *   silently DROPS the initializer `x` as well. Only the bare-`Declare` root
 *   shape reaches here; wrapped in a multi-statement `Block` the declaration is
 *   followed by more lines, which the emitted-source scan already declines.
 *
 * Structural, on the body BEFORE it is compiled (`statementBodyHead`),
 * deliberately: the emitted `=` is not distinguishable by a token scan from the
 * `=` of `==`/`<=`/`>=`/`!=` without re-deriving the emitter's precedence
 * rules, so there is no textual check that cannot false-positive on a
 * comparison.
 *
 * As everywhere in this class, the statement-capable route is `compile()`.
 */
export function gpuAssertExpressionBody(
  subject: string,
  expr: Expression,
  language: string
): void {
  const head = statementBodyHead(expr);
  if (head === undefined) return;
  const lang = language.toUpperCase();
  // GLSL assignment is an operator, so only WGSL declines an assignment body.
  if (head === 'Assign') {
    if (language !== 'wgsl') return;
    throw new Error(
      `Could not compile ${compileSubject(subject)}: this route emits a single WGSL EXPRESSION, but the body is ` +
        `an assignment. WGSL assignment is a STATEMENT (unlike GLSL, where it ` +
        `is an operator), so the emitted \`… = <target> = <value>\` is not ` +
        `valid source. Compile a statement body with compile() instead — that ` +
        `route emits a function body.`
    );
  }
  throw new Error(
    `Could not compile ${compileSubject(subject)}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `is a declaration. A declaration is a STATEMENT in ${lang}, so the ` +
      `emitted \`${language === 'wgsl' ? 'var s: f32' : 'float s'}\`-shaped ` +
      `source is not valid in an expression position — and it carries no ` +
      `initializer, so the declared value would be silently DROPPED. Compile ` +
      `a statement body with compile() instead — that route emits a function ` +
      `body.`
  );
}

/** Return the vec2 constructor name for the target language. */
function gpuVec2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec2f' : 'vec2';
}

/**
 * The principal complex power of two real constants, as a shader `vec2(re, im)`
 * literal — the fold for a `Power`/`Root` node whose TYPE is complex (a
 * negative base whose reduced-rational exponent has an even denominator).
 *
 * `Complex.pow` is the routine `_gpu_cpow`'s host-side counterpart and the
 * interpreter both use, so the folded constant is the value the uncompiled
 * expression produces (down to shader float precision).
 */
function gpuComplexPowLiteral(
  base: number,
  exp: number,
  target?: CompileTarget<Expression>
): string {
  const r = principalComplexPow(base, exp);
  return `${gpuVec2(target)}(${formatFloat(r.re, target?.language)}, ${formatFloat(
    r.im,
    target?.language
  )})`;
}

/** Return the vec3 constructor name for the target language. */
function gpuVec3(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'vec3f' : 'vec3';
}

/** A direct sRGB constructor can skip its perceptual-space round trip: the
 * conversions keep extended sRGB channels and do no gamut mapping, so the
 * round trip of a finite triple is the identity (`_gpu_srgb_roundtrip`).
 * Compile the child normally first so alpha, operand-shape, and caller-mapping
 * checks still govern its lowering. */
function gpuRgbBoundary(
  color: Expression,
  code: string,
  target: CompileTarget<Expression>
): string {
  if (
    isFunction(color) &&
    ['Rgb', 'Hsv', 'Hsl', 'Tuple'].includes(color.operator) &&
    !isCallerMapped(color, target.cse?.harvestOptions) &&
    !target.foldExcludedOps?.has(color.operator)
  ) {
    const prefix = '_gpu_srgb_to_oklch(';
    if (code.startsWith(prefix) && code.endsWith(')'))
      return `_gpu_srgb_roundtrip(${code.slice(prefix.length, -1)})`;
  }
  return `_gpu_oklch_to_srgb(${code})`;
}

/** The five typed color heads. Their operands are components in their own
 *  color space. */
const GPU_COLOR_HEADS = new Set(['Rgb', 'Hsv', 'Hsl', 'Oklab', 'Oklch']);

/**
 * The color-space names a shader can read channels in. Each one has a helper
 * in the preamble that converts it back to OKLCh (`gpuToOklch`), so a color
 * built in one of these spaces can be consumed anywhere. `lab` is the
 * alternate spelling of `oklab` the interpreter also accepts.
 */
const GPU_COLOR_SPACES: ReadonlySet<string> = new Set([
  'oklch',
  'oklab',
  'lab',
  'rgb',
  'hsl',
  'hsv',
]);

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
function gpuColorOperand(
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
function gpuColorEntryOperand(
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
function assertNoGPUAlpha(head: string, args: ReadonlyArray<Expression>): void {
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

/**
 * Whether applying `head` to `args` produces a complex value — the SAME signal
 * `BaseCompiler.isComplexValued` reports to the ENCLOSING expression for this
 * node.
 *
 * A handler that picks its real-vs-complex lowering from the ARGUMENT alone can
 * disagree with its own parent. With `a := -2`, `Sqrt(a)` is typed `complex`
 * (the type handler reads the assigned value's sign) while the operand `a` is
 * typed `integer`: the parent emits the `vec2(re, im)` convention around a
 * scalar `sqrt(-2.0)`, and shader scalar-broadcast makes that a silent
 * `vec2(NaN, NaN)` rather than a compile error.
 *
 * The node is rebuilt STRUCTURALLY (bound, not canonicalized) so its head and
 * operands are the ones being lowered, and its type is therefore the type the
 * parent read. A wide result type (`number`, as `Power`/`Root`/`Arcsin` have)
 * is NOT complex — those project to NaN, matching their real lowering.
 *
 * THREE SITES MUST STAY IN AGREEMENT, because they answer the same question
 * for the same node and a disagreement is a silent value-shape mismatch (a
 * `vec2`/`{re, im}` consumer reading a scalar, or the reverse):
 * `BaseCompiler.isComplexValued` (base-compiler.ts) is what a PARENT consults,
 * `resultIsComplexValued` (javascript-target.ts) is the JavaScript emitters'
 * copy, and this function is the GPU emitters' copy. Change one, change all
 * three.
 */
function gpuResultIsComplexValued(
  head: string,
  args: ReadonlyArray<Expression>
): boolean {
  const engine = args[0]?.engine;
  if (engine === undefined) return false;
  try {
    const t = engine.function(head, [...args], { form: 'structural' }).type;
    // The infinite and NaN branches are dropped first, exactly as the two
    // sites named above do: a head whose value can blow up at a pole claims a
    // union such as `complex | +oo | -oo` (`Artanh`, `Arcoth`,
    // `Arsech`, `Ln`, `Log`), and only its FINITE part decides the lane.
    // Asking `isNonRealNumber` of the whole union answers false and takes the
    // scalar lane while the parent takes the complex one.
    return isNonRealNumber(finitePartOfType(t.type));
  } catch {
    return false;
  }
}

/**
 * An operand as `vec2(re, im)` source, lifting a real-emitted operand to
 * `vec2(x, 0.0)`. The `_gpu_c…` helpers take a `vec2`; handing one a scalar is
 * not valid shader source.
 */
function gpuComplexOperand(
  x: Expression,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (BaseCompiler.isComplexValued(x)) return compile(x);
  return `${gpuVec2(target)}(${compile(x)}, 0.0)`;
}

/**
 * Compile an operand the caller will splice MORE THAN ONCE into its emitted
 * source. A pure operand compiles directly (byte-identical to `compile(x)`
 * for the common case); an IMPURE one (the Random family — `_gpu_rnd_draw`
 * advances a runtime counter, so a repeated splice re-draws and shifts every
 * later value in the shader) is bound to a hoisted temporary, or the head
 * declines where no statement sink is available. `complex` selects a
 * `vec2`/`vec2f` temporary (a complex operand has no scalar shape, so the
 * scalar-shape gate is skipped there — `canHoist` is the applicable gate).
 */
function gpuOperandOnce(
  head: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  complex = false
): string {
  if (x.isPure !== false) return compile(x);
  if (
    !BaseCompiler.canHoist(target) ||
    (!complex && gpuOperandShape(x) !== 'scalar')
  )
    throw new Error(
      `Could not compile \`${head}\`: an impure (Random) operand cannot be bound to a temporary ` +
        'at this position — a repeated draw would shift every later value ' +
        'in the shader.'
    );
  const t = BaseCompiler.tempVar(target);
  const type = complex
    ? gpuVec2(target)
    : target.language === 'wgsl'
      ? 'f32'
      : 'float';
  const decl =
    target.language === 'wgsl' ? `var ${t}: ${type}` : `${type} ${t}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
  return t;
}

/**
 * Compile an operand whose code IS the whole lowering of its parent head — an
 * IDENTITY passthrough, such as `Floor` of an integer-valued operand, `Abs` of
 * a non-negative one, or `Real` of a real one.
 *
 * The shared compiler splices the emission of a function head into its parent
 * WITHOUT parentheses of its own, because a head normally emits a CALL, and a
 * call binds tighter than every infix operator. An identity lowering breaks
 * that assumption: it hands the parent the OPERAND's code, so when the operand
 * is itself an infix expression the parent's operator captures only its last
 * term. `3·⌊n + 1⌋` over an integer `n` emitted `3.0 * n + 1.0`, which is
 * `3n + 1` — a wrong value behind a reported success.
 *
 * The operand is therefore parenthesized whenever its head has an infix
 * spelling on this target. A symbol, a number literal or a call is a primary
 * already and stays bare, so those emissions are unchanged.
 */
function gpuIdentityPassthrough(
  x: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression> | undefined
): string {
  return gpuParenthesizeIdentity(x, compile(x), target);
}

/**
 * The already-compiled form of `gpuIdentityPassthrough`, for a caller that
 * must compile its operand exactly once for its own reasons (a `Random`
 * operand redraws on a second `compile()`) and so cannot hand the operand
 * over. Same rule: parenthesize `code` when the head of `x` has an infix
 * spelling on this target.
 */
function gpuParenthesizeIdentity(
  x: Expression,
  code: string,
  target: CompileTarget<Expression> | undefined
): string {
  if (!isFunction(x)) return code;
  const op = target?.operators?.(x.operator) ?? GPU_OPERATORS[x.operator];
  return op === undefined ? code : `(${code})`;
}

/**
 * The complex lowering of a RECIPROCAL inverse head (`Arcsec`, `Arccsc`,
 * `Arsech`, `Arcoth`): a call of its preamble helper (`_gpu_casec`,
 * `_gpu_cacsc`, `_gpu_casech`, `_gpu_cacoth`), whose operand is lifted to a
 * `vec2` when it is real. The helpers do not compute `w = 1/z` and then the
 * function of `w`: near a branch point (`z = ±1`) the rounding of `1/z` is
 * amplified (with `asin(1/z)`, `arcsec(1 + 10⁻⁴i)` had a relative error of
 * `5·10⁻⁵` in f32). See the comment above `_gpu_cinvpm`.
 */
function gpuReciprocalComplex(
  helper: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  return `${helper}(${gpuComplexOperand(x, compile, target)})`;
}

/**
 * Emit a NaN value valid for the target shader language.
 *
 * Neither GLSL nor WGSL has a `NaN` identifier (the base compiler's default
 * `If`/`Which`/`When` emit a bare `NaN`, which fails to compile on GPU). WGSL
 * rejects a NaN or an infinity produced by any constant expression, `0.0 / 0.0`
 * and a bitcast of a constant bit pattern alike. Both targets therefore route
 * through the `_gpu_nan()` preamble helper (see `GPU_NAN_PREAMBLE_GLSL` and
 * `GPU_NAN_PREAMBLE_WGSL`): a masked (`When`/`Which` else) branch's NaN is thus
 * centralized in one overridable symbol, so a host can redefine what a masked
 * branch produces without touching the generated code.
 *
 * The spelling itself lives in `gpuNonFiniteLiteral` (`constant-folding.ts`),
 * shared with the non-finite LITERAL path (`formatGPUNumber`/`formatFloat`) so
 * a `NaN` constant and a masked branch produce the same symbol.
 */
function gpuNaN(target?: CompileTarget<Expression>): string {
  return gpuNonFiniteLiteral(NaN, target?.language);
}

/**
 * Are the ELEMENTS of a fixed-length aggregate shader floats?
 *
 * `BaseCompiler.vectorComponentCount` reads a width off the OUTER dimension of
 * a 1-axis `list` type (or a tuple's slot count) and says nothing about what
 * the elements are. On a shader target that is only half the question: a
 * `vecN` holds N single floats, so a 3-element list of complex values is three
 * `vec2` cells and a 3-element list of 2-element lists is a 3×2 block — neither
 * has a `vec3` reading, or any shader value shape at all. Without this check
 * the width flowed on and a symbol typed `list<complex^3>` emitted `sin(c)`,
 * `c + c` and `length(c)`, and one typed `list<boolean^3>` emitted
 * `max(max(b.x, b.y), b.z)` — source no shader compiler accepts, behind a
 * reported success. (The `At` lowering asks the same question of its base in
 * `gpuAtNonScalarElement`; this is that guard on the shape reading itself, so
 * every consumer of a width gets it.)
 *
 * Answers `true` — leaving the width alone — for the three shapes whose
 * elements this type reading does not decide:
 *
 *  - a `List`/`Tuple` LITERAL, whose components are checked where the
 *    constructor is emitted (`assertGPUScalarComponents`) and whose operands
 *    routinely carry no element type of their own (a parametric body
 *    `(x(t), y(t))`);
 *  - a COMPLEX value, which is `vec2(re, im)` by the complex convention rather
 *    than a two-element collection;
 *  - a `Block` local, whose boxed type is `unknown` and whose width was
 *    inferred from the value bound to it — components that are already shader
 *    floats.
 *
 * A CALLER-declared name (a `compileFunction` parameter, a `compileShader`
 * `in`/`uniform`) is the one framed case that must still be asked: the frame
 * stores only a WIDTH, so `bvec3`, `ivec3` and `uvec3` are entered as a plain
 * 3 and are indistinguishable there from a `vec3`. The declared SPELLING is
 * the only place their element kind survives, so it is read back here
 * (`gpuDeclaredTypeOf`) — the same question `gpuAtFramedBaseElements` asks of
 * an indexed base.
 *
 * An element declines only when it is PROVABLY not a shader float, which is
 * the same standard the `At` index gate in this file already applies to its
 * own operand. The WIDE types — `unknown`, `any`, `value`, `expression` — are
 * admitted, by the unknown-as-numeric-parameter rule: a component whose type
 * is merely unresolved is a float here, and rejecting it would decline shapes
 * that have always compiled. `value` is the one that matters in practice: a
 * `PointList` component that is itself a computed expression types `value`,
 * and reading that as a non-float declined `Dot` over a point list — a shape
 * with a correct `dot(vec2(…))` lowering.
 *
 * A COMPLEX element is rejected even though it could match `number`: it
 * occupies a `vec2` of (re, im) by the complex convention, so a list of them
 * is not a vector of float cells.
 */
function gpuElementIsShaderFloat(t: Type): boolean {
  // A nominal type or alias answers layout questions as its DEFINITION —
  // compilation is type erasure. Without this a `list<meters^3>` over a
  // nominal `meters = real` was rejected: a nominal type deliberately does not
  // subtype its definition, so `couldMatch` answers `false` for it and the
  // list lost the `vec3` reading it has always had.
  t = resolveTypeForCompilation(t);
  // Complex is asked FIRST, because it satisfies `couldMatch(_, 'number')`
  // while being a two-cell `vec2` of (re, im) here rather than a float.
  //
  // The infinite branches are dropped before that question is put. A head such
  // as `Ln`, `Log`, `Artanh`, `Arcoth` or `Arsech` returns `complex | +oo |
  // -oo`, and `isNonRealNumber` of that whole union answers `false` — the
  // infinite members are not subtypes of `complex`, so the union is not one
  // either. Execution then reached `couldMatch`, which answers `true` because
  // the `complex` member alone overlaps `number`, and a genuinely
  // complex-valued element was admitted into a vector of float cells. That is
  // the same fail-open this gate exists to close, reached through a computed
  // union instead of a written `complex`. `finitePartOfType` reduces the union
  // to `complex`, of which `isNonRealNumber` answers `true`.
  if (isNonRealNumber(finitePartOfType(t))) return false;
  return couldMatch(t, 'number');
}

/**
 * See `gpuElementIsShaderFloat` for the element test this applies.
 */
function gpuHasShaderScalarElements(expr: Expression): boolean {
  // A written list or tuple is a vector only when its elements are scalars:
  // a list of points lowers as an ARRAY of vectors (`gpuUniformVectorWidth`),
  // which no `vecN` consumer may read as a vector of its element count.
  if (isFunction(expr, 'List') || isFunction(expr, 'Tuple'))
    return expr.ops.every((op) => !BaseCompiler.isNonScalarShape(op));
  if (BaseCompiler.isComplexValued(expr)) return true;
  if (
    isSymbol(expr) &&
    BaseCompiler.localShapeFrameOf(expr.symbol) !== undefined
  ) {
    const declared = gpuDeclaredTypeOf(expr);
    // No declared type alongside the frame entry is the `Block`-local case:
    // the width came from a bound value whose components are shader floats.
    return declared?.value === undefined || declared.value.element === 'f';
  }
  const t = gpuType(expr);
  if (typeof t === 'string') return true;
  // Reached only with a `tuple` or 1-axis `list` type — the two type shapes
  // `aggregateComponentCount` reads a width from once the sources above are
  // excluded.
  //
  // Asked directly rather than through `gpuDeclaredComponentCount`, whose
  // element test (`gpuIsVectorComponentType`) answers "does this LOWER to the
  // shader scalar", a stricter question than the one owed here. That test
  // rejects every wide type but `unknown` and `any`, so routing through it
  // declined a `value`-typed component — the type a computed `PointList`
  // component carries.
  if (t.kind === 'tuple')
    return t.elements.every((e) => gpuElementIsShaderFloat(e.type));
  if (t.kind === 'list' && t.dimensions?.length === 1)
    return gpuElementIsShaderFloat(t.elements);
  // Every other shape fails CLOSED, which is also what the previous reading
  // (`gpuDeclaredComponentCount(t) !== undefined`) answered for it. Today the
  // only caller has already established a component width, and the two type
  // shapes above are the only ones a width is read from, so nothing reaches
  // this line. Answering `true` here would make a multi-axis list or a
  // tensor-typed element pass for a shader float the moment that stops being
  // so — the fail-open this gate exists to prevent.
  return false;
}

/**
 * Number of vector components a value expression occupies on the GPU (2–4),
 * or `undefined` for a scalar. Structural for `Tuple`/`List` literals (the
 * parametric-body shape `(x(t), y(t))` → `vec2`), type-based for typed
 * operands (`tuple<…>`, a 1-axis `list`), and 2 for a complex value (lowered
 * as `vec2(re, im)`).
 *
 * THE width reading of this target: a type-sourced width whose elements are
 * not shader floats has no `vecN` lowering and answers `undefined` here
 * (`gpuHasShaderScalarElements`), so every consumer treats it as the
 * shapeless value it is instead of emitting `vecN` source for it.
 */
function gpuComponentCount(expr: Expression | null): 2 | 3 | 4 | undefined {
  const n = BaseCompiler.vectorComponentCount(expr);
  if (n === undefined) return undefined;
  return gpuHasShaderScalarElements(expr!) ? n : undefined;
}

/**
 * The component count every element of a `List` literal shares when EVERY
 * element is a vector value of one width between 2 and 4 — a list of points
 * of the same arity, which lowers as a fixed-size array of `vecK`
 * (`vec3[N](…)` / `array<vec3f, N>(…)`) — or `undefined` when the elements
 * are scalars, of mixed widths, or not vectors at all.
 */
export function gpuUniformVectorWidth(
  args: ReadonlyArray<Expression>
): number | undefined {
  if (args.length === 0) return undefined;
  let width: number | undefined;
  for (const arg of args) {
    if (!BaseCompiler.isNonScalarShape(arg)) return undefined;
    const n = BaseCompiler.aggregateComponentCount(arg);
    if (n === undefined || n < 2 || n > 4) return undefined;
    if (width !== undefined && n !== width) return undefined;
    width = n;
  }
  return width;
}

/**
 * Guard the `vecN(…)` lowering of a `Tuple`/`List` literal: every element must
 * be a SCALAR, so the constructor's argument count is its component count.
 *
 * A vector-valued element (a complex component — lowered as `vec2(re, im)` —
 * or a nested tuple) contributes 2+ components, so `(t, i·t)` would emit
 * `vec2(t, vec2(0.0, t))`: three components into a two-component constructor,
 * which a driver rejects with "constructor: too many arguments". Neither is
 * there a correct flattening — a tuple whose element is complex is not a GPU
 * vector — so fail closed with a diagnostic naming the shape instead of
 * emitting shader source that cannot compile.
 *
 * The check is on AGGREGATE-ness, not on having a `vecN` lowering: a 1- or
 * 5-element list element (`(⟦1⟧, 2)` → `vec2(float[1](1.0), 2.0)`) is just as
 * invalid, and asking `gpuComponentCount` — which reports `undefined` for
 * those widths — would wave them through. It is on being provably NON-SCALAR,
 * not on having a component count: a `Matrix` element has no single count, but
 * `(mat2(…), 1)` → `vec2(mat2(…), 1.0)` is exactly as unacceptable to a driver.
 *
 * Also rejects the EMPTY constructor: an empty tuple/list would lower to
 * `float[0]()` / `array<f32, 0>()`, and neither language has a zero-length
 * array type.
 */
export function assertGPUScalarComponents(
  args: ReadonlyArray<Expression>,
  ctor: string
): void {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${ctor}\`: an empty tuple/list has no GPU lowering — neither GLSL nor ` +
        `WGSL has a zero-length array type.`
    );
  for (const [i, arg] of args.entries()) {
    if (!BaseCompiler.isNonScalarShape(arg)) continue;
    const n = BaseCompiler.aggregateComponentCount(arg);
    const shape =
      n === undefined
        ? 'a matrix/tensor value'
        : `${n} component${n === 1 ? '' : 's'} — a complex value or a ` +
          `nested tuple/list`;
    throw new Error(
      `Could not compile \`${ctor}\`: element ${i + 1} (\`${arg.toString()}\`) is itself ` +
        `vector-valued (${shape}) and has no GPU ` +
        `lowering; a ${ctor} constructor takes scalar components.`
    );
  }
}

/**
 * A NaN matching the SHAPE of `val`: scalar NaN for a scalar value, a
 * broadcast vector constructor (`vec2(_gpu_nan())` / `vec2f(_gpu_nan())`)
 * for a vector-valued one. GLSL has no implicit float→vecN conversion in a
 * ternary, so a masked (`When`/`Which` else) branch whose value is a tuple
 * body (a restricted parametric `(x(t), y(t))`) must emit a NaN of the same
 * component count or the driver rejects the shader (Tycho item 49). WGSL's
 * `select` likewise requires both operands to share one type.
 */
function gpuNaNFor(
  val: Expression | null,
  target?: CompileTarget<Expression>
): string {
  const n = gpuComponentCount(val);
  if (n === undefined) return gpuNaN(target);
  const ctor = target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
  return `${ctor}(${gpuNaN(target)})`;
}

// A conditional arm may use its sink to detect forbidden statement emission,
// but optional array-index specialization must not add such statements.
const conditionalGPUSinks = new WeakSet<object>();

// Sinks whose NEXT conditional-arm compile is a CAPTURE by the statement form
// of a conditional (`compileGPUStatementSelection`): the arm's statements are
// wanted, and land inside the arm's own branch, so the guard of
// `compileGPUConditionalArm` is skipped once and re-armed for any ternary arm
// nested inside.
const statementCaptureSinks = new WeakSet<object>();

/**
 * Does compiling `e` on a shader target need STATEMENTS — a loop-form
 * `Sum`/`Product`, a `Block` or a `Loop` used as a value — which a ternary
 * arm cannot hold? A structural test over the subtree: a `Sum` whose bounds
 * let it unroll needs none and then takes the statement form of a
 * conditional (`compileGPUStatementSelection`) for nothing more than an
 * assignment, which is still correct. Exported for its test only.
 */
export function gpuNeedsStatements(e: Expression): boolean {
  // A boxed expression is a DAG: a node reached twice is visited once, or
  // a tower of shared operands unfolds exponentially.
  const seen = new Set<Expression>();
  const walk = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    // A symbol with a value is inlined by the shader targets: its value is
    // read as if written in place. (A name an enclosing binder rebinds is
    // read the same way; the worst case is a statement form taken for an
    // arm that needed none, which is still correct.)
    if (isSymbol(x)) {
      const value = x.engine._getSymbolValue(x.symbol);
      return value !== undefined && walk(value);
    }
    if (!isFunction(x)) return false;
    const h = x.operator;
    // Every `Sum`/`Product` is read as needing statements: a loop form
    // certainly does, and an unrolled one may still hoist a loop-invariant
    // declaration for a term that does not depend on the index. An impure
    // operand a lowering binds to a temporary is not read here: a selection
    // with an effect never takes the statement form (see
    // `compileGPUStatementSelection`).
    if (h === 'Sum' || h === 'Product' || h === 'Block' || h === 'Loop')
      return true;
    return x.ops.some(walk);
  };
  return walk(e);
}

/**
 * Does the declared signature of `name` — an operator, or a symbol whose
 * value is a function — carry an effect that writes a binding: `scope` (a
 * write to an enclosing binding), `state` (a store), or `any` (unknown)?
 * The engine refuses to assign a function literal that writes outside
 * itself under a signature without the label, so the declared signature is
 * the record of what a call may write.
 */
function gpuSignatureWrites(node: Expression, name: string): boolean {
  const def = node.engine.lookupDefinition(name);
  const types: (Type | undefined)[] = [];
  if (isOperatorDef(def)) types.push(def.operator.signature?.type);
  else if (isValueDef(def))
    types.push(def.value.type?.type, def.value.value?.type?.type);
  return types.some((t) => {
    // `signatureEffects` is the engine's one reader of a signature's
    // effects: it also reads an overload set (an intersection of
    // signatures) and an extracted element (a union with `missing`).
    const effects = signatureEffects(t);
    return (
      effects === 'any' ||
      effects?.includes('scope') === true ||
      effects?.includes('state') === true
    );
  });
}

/**
 * Does `node` write a binding anywhere outside the nodes in `inside` (and
 * their subtrees)? A write is an `Assign`, a `Declare` or an `Assume` at any
 * depth, or a call of a function whose signature declares a write effect
 * (`gpuSignatureWrites`, the head of an application or a function-valued
 * symbol operand), or a symbol whose inlined value is impure. A node pure
 * through every inlined value (`foldValueImpure`) writes nothing; a `Block`
 * is read by `BaseCompiler.hasObservableEffect`, so its writes to its own
 * locals do not count.
 */
function gpuWritesOutside(
  node: Expression,
  inside: ReadonlySet<Expression>
): boolean {
  if (inside.has(node)) return false;
  // A symbol's inlined value may hold anything; an impure one is refused
  // as a possible write (`foldValueImpure` looks through the value).
  if (isSymbol(node))
    return (
      gpuSignatureWrites(node, node.symbol) ||
      BaseCompiler.foldValueImpure(node)
    );
  if (!isFunction(node) || !BaseCompiler.foldValueImpure(node)) return false;
  if (node.operator === 'Block') return BaseCompiler.hasObservableEffect(node);
  const op = node.operator;
  if (op === 'Assign' || op === 'Declare' || op === 'Assume') return true;
  if (node.ops.some((x) => gpuWritesOutside(x, inside))) return true;
  return gpuSignatureWrites(node, op);
}

/**
 * A `Which` (clauses in `Which` shape) as a STATEMENT — `if … else if … else`
 * storing the selected value in a temporary declared ahead of it — for a
 * selection whose arm, or condition past the first, needs statements a
 * ternary cannot hold (`gpuNeedsStatements`): the loop of a loop-form `Sum`
 * then runs INSIDE its branch, only when that branch is selected, which is
 * what the interpreter does and what the ternary form could not express
 * (`compileGPUConditionalArm` refuses to hoist the loop ahead of the
 * ternary, where it would run unconditionally). The Tycho code-generation
 * audit document `yac5cxfjm1` declined 14 records on this shape:
 * `f(x, N) := Which(1 ≤ N, Σ_{n=1}^{⌊N⌋} cos(…)/√N_m, True, 0)`.
 *
 * Each clause is compiled with its hoisted statements CAPTURED and placed in
 * its own branch, ahead of the assignment; a later condition's statements
 * sit in the `else` of the clause before it, so they run only when that
 * clause was not taken. The temporary needs one static shader type shared
 * by every arm. `undefined` — the ternary form then applies, and declines
 * as before — when the position has no statement sink, when the sink is a
 * ternary arm of an enclosing conditional (the guard of
 * `compileGPUConditionalArm`), when the arms have no one static type, and
 * when running the selection ahead of its statement position could be
 * observed (the gate below).
 */
function compileGPUStatementSelection(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression, i: number) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (!BaseCompiler.canHoist(target) || conditionalGPUSinks.has(target.hoist!))
    return undefined;
  // Hoisted as one statement, the selection runs ahead of the whole
  // expression at its statement position (`hoist.unit`), so a sibling
  // written BEFORE the selection runs after it. Two things could observe
  // that order, and the gate refuses both: an effect inside the selection
  // — a draw would shift the random stream past a sibling's draw — and a
  // sibling that WRITES a binding, since the selection could read that
  // binding before the write, directly, through a symbol whose value is
  // inlined, or inside a function it calls. Where a read hides is not
  // examined; the writes are: an assignment anywhere in the unit outside
  // the selection's own clauses, and a call of a function whose signature
  // declares a write (`gpuWritesOutside`). The engine's effect labels are
  // not read on the unit as a whole: they mark a block's write to its own
  // local `scope` too, and such a block is no hazard. The unit is unknown
  // at a sink no statement position recorded; the gate then refuses too. Every
  // refusal keeps the ternary form, which declines the hoisting arm as it
  // did before (`ROADMAP.md`, "A statement hoisted on a shader target runs
  // ahead of an operand written before it"). `hasObservableEffect` reads a
  // block by the values it assigns to its own locals, so a block arm that
  // declares and assigns its own locals is not an effect.
  const unit = target.hoist!.unit;
  if (unit === undefined) return undefined;
  // A statement that is itself the store of its right side — `q := If(…)`,
  // `Declare(q, real, If(…))` — stores after that side is evaluated, so
  // only the evaluated side is examined for writes.
  const evaluated = isFunction(unit, 'Assign')
    ? unit.ops[1]
    : isFunction(unit, 'Declare')
      ? BaseCompiler.declareValueOperand(unit.ops)
      : unit;
  if (evaluated === undefined) return undefined;
  if (args.some(BaseCompiler.hasObservableEffect)) return undefined;
  if (gpuWritesOutside(evaluated, new Set(args))) return undefined;
  const isWGSL = target.language === 'wgsl';
  const arms = args.filter((_, i) => i % 2 === 1);
  // In a complex selection the caller lifts each real scalar arm to a `vec2`
  // (`gpuSelectionArm`), so such an arm has the complex type here.
  const complex = gpuSelectionIsComplex(arms);
  const types = arms.map((a) =>
    complex && gpuOperandShape(a) === 'scalar'
      ? gpuVecType(2, isWGSL)
      : gpuTypeOfValue(a, isWGSL)
  );
  if (types.some((t) => t === undefined) || new Set(types).size !== 1)
    return undefined;
  const type = types[0]!;
  // A position no clause selects is the codomain's NaN; a temporary of an
  // integer or boolean type has none, so such a selection needs a `True`
  // default clause to take this form.
  if (
    !/^(float|vec[234]|f32|vec[234]f)$/.test(type) &&
    !isSymbol(args[args.length - 2], 'True')
  )
    return undefined;
  const sink = target.hoist!;
  // `lazy`: the clause is a lazily-evaluated operand of the selection (an
  // arm, a condition past the first), which the operand compiler hands to
  // `compileGPUConditionalArm`; the guard is skipped once for it. The first
  // condition is evaluated unconditionally and carries no guard.
  const capture = (
    f: () => string,
    lazy: boolean
  ): { code: string; stmts: string[] } => {
    const before = sink.stmts.length;
    if (lazy) statementCaptureSinks.add(sink);
    let code: string;
    try {
      code = f();
    } finally {
      statementCaptureSinks.delete(sink);
    }
    const stmts = sink.stmts
      .splice(before)
      .map((stmt) => stmt.replace(/;\s*$/, ''));
    return { code, stmts };
  };
  // A captured statement may span lines (a loop with its body); it stays
  // one element, indented line by line, so the terminator test below reads
  // its END, as the sink's own joiner does.
  const indent = (stmts: ReadonlyArray<string>): string[] =>
    stmts.map((stmt) => `  ${stmt.replace(/\n/g, '\n  ')}`);
  const terminated = (stmt: string): string =>
    /[;{}]\s*$/.test(stmt) ? stmt : `${stmt};`;
  const tv = BaseCompiler.tempVar(target);
  const shapeRef = arms.find((v) => gpuComponentCount(v)) ?? null;
  const noClause = complex
    ? `${gpuVec2(target)}(${gpuNaN(target)})`
    : gpuNaNFor(shapeRef, target);
  const build = (i: number): string[] => {
    if (i >= args.length) return [`${tv} = ${noClause}`];
    const cond = args[i];
    const val = args[i + 1];
    // `True` marks the default branch.
    if (isSymbol(cond, 'True')) {
      const arm = capture(() => compile(val, i + 1), true);
      return [...arm.stmts, `${tv} = ${arm.code}`];
    }
    // The condition first, as the ternary form compiles it: the first
    // condition is not lazy, so a subexpression it shares with the arm is
    // bound ahead of the selection and the arm reads the binding, where
    // the arm compiled first would emit the subexpression in full — for a
    // shared operand tower, once per occurrence.
    const c = capture(() => compile(cond, i), i > 0);
    const arm = capture(() => compile(val, i + 1), true);
    const armLines = [...arm.stmts, `${tv} = ${arm.code}`];
    return [
      ...c.stmts,
      `if (${c.code}) {`,
      ...indent(armLines),
      `} else {`,
      ...indent(build(i + 2)),
      `}`,
    ];
  };
  const lines = build(0);
  BaseCompiler.hoistStatement(
    target,
    isWGSL ? `var ${tv}: ${type};` : `${type} ${tv};`,
    lines.map(terminated).join('\n')
  );
  return tv;
}

/**
 * Can a statement be placed at the current position on a shader target? A
 * statement sink must exist (`canHoist`) and must not be a
 * conditionally-evaluated arm of a conditional (`conditionalGPUSinks`),
 * out of which a statement would run unconditionally. The captured branch
 * of a conditional's statement form has a sink that is not marked
 * conditional, so it answers yes.
 */
function gpuCanPlaceStatement(target: CompileTarget<Expression>): boolean {
  return (
    BaseCompiler.canHoist(target) && !conditionalGPUSinks.has(target.hoist!)
  );
}

/**
 * Does `e` — a conditional arm, or a later `Which` condition — repeat a
 * subexpression that a ternary would emit more than once? A boxed
 * expression is a DAG: a function node reached by two or more paths within
 * `e` is written once per path in a ternary arm, which has no statement
 * position to bind it, so a deeply shared node grows the emitted text
 * super-linearly. The statement form gives the arm a statement position
 * where the common-subexpression pass binds such a node once. A leaf (a
 * symbol or a number) is never worth binding; sharing only BETWEEN `e` and
 * something outside it is bound by that outer position already, so the walk
 * is seeded fresh for each arm and counts only sharing within `e`.
 */
function gpuArmSharesWork(e: Expression): boolean {
  // A function node reached a second time is shared work. A symbol's value
  // is followed on the current path only (`expanding`), removed on the way
  // out, so a value cycle `a := b; b := a` terminates while two separate
  // references to one symbol still meet at its value's root in `seen`.
  const seen = new Set<Expression>();
  const expanding = new Set<string>();
  let shared = false;
  const walk = (x: Expression): void => {
    if (shared) return;
    // A symbol with a value is inlined by the shader targets, its value read
    // in place (as `gpuNeedsStatements` also reads it): two references inline
    // it twice, and sharing inside one inlined value repeats the same way.
    // Walking into the value lets the function-node check below see both. A
    // valueless symbol — a plot variable — is a leaf worth nothing.
    if (isSymbol(x)) {
      const name = x.symbol;
      if (expanding.has(name)) return;
      const value = x.engine._getSymbolValue(name);
      if (value === undefined) return;
      expanding.add(name);
      walk(value);
      expanding.delete(name);
      return;
    }
    if (!isFunction(x)) return;
    if (seen.has(x)) {
      shared = true;
      return;
    }
    seen.add(x);
    for (const op of x.ops) walk(op);
  };
  walk(e);
  return shared;
}

/**
 * Compile a **conditionally-evaluated** operand of a GPU conditional — an
 * `If`/`When`/`Which`/`Match` arm, or a `Which` condition past the first —
 * with hoisting forbidden.
 *
 * GLSL's `?:` short-circuits: an arm runs only when it is selected. A lowering
 * that hoists statements (the loop form of `Sum`/`Product`, Tycho item 110)
 * would move that work OUT of the conditional, where it runs unconditionally.
 * That is not merely a cost: `_gpu_rnd_draw(seed, inout uint n)` advances a
 * RUNTIME counter, so a loop stranded ahead of a ternary it never feeds shifts
 * the value of every later draw in the shader — a silent disagreement with the
 * interpreter, which evaluates only the taken branch. Fail closed; the
 * caller falls back to interpretation, exactly as it did before hoisting
 * existed.
 *
 * (WGSL's `select` is a function, so both operands ARE evaluated there — but
 * the emission is shared and the counter-ordering hazard is the same, so the
 * guard is not language-gated.)
 */
function compileGPUConditionalArm(
  head: string,
  compiled: () => string,
  target: CompileTarget<Expression>
): string {
  const sink = BaseCompiler.canHoist(target) ? target.hoist : undefined;
  if (sink !== undefined && statementCaptureSinks.has(sink)) {
    statementCaptureSinks.delete(sink);
    return compiled();
  }
  const before = sink?.stmts.length ?? 0;
  const alreadyConditional =
    sink !== undefined && conditionalGPUSinks.has(sink);
  if (sink !== undefined) conditionalGPUSinks.add(sink);
  let code: string;
  try {
    code = compiled();
  } finally {
    if (sink !== undefined && !alreadyConditional)
      conditionalGPUSinks.delete(sink);
  }
  if (sink !== undefined && sink.stmts.length > before) {
    // Drop the escaped statements: the throw is recoverable (the engine-level
    // `compile()` catches it to build the interpreter fallback) and a caller
    // reusing the target must not inherit orphaned code.
    sink.stmts.length = before;
    throw new Error(
      `Could not compile \`${head}\`: a conditionally-evaluated branch contains a multi-statement ` +
        `construct (a loop-form Sum/Product, or an impure operand bound to a ` +
        `hoisted temporary). Hoisting it out of the branch would run it ` +
        `unconditionally — a shader conditional is an expression, not a ` +
        `statement — which changes the result whenever the branch draws ` +
        `from the random stream.`
    );
  }
  return code;
}

/**
 * Emit a conditional `cond ? whenTrue : whenFalse` for the target language.
 *
 * GLSL has the ternary operator; WGSL does not and uses
 * `select(false_value, true_value, condition)` instead.
 *
 * A conditional that chooses between one and zero is the boolean itself: both
 * languages convert a `bool` to a float with the scalar constructor
 * (`float(b)` in GLSL, `f32(b)` in WGSL), and both specify that conversion as
 * `true → 1.0` and `false → 0.0`. The cast needs no branch.
 */
function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string,
  target?: CompileTarget<Expression>
): string {
  const isWGSL = target?.language === 'wgsl';
  if (whenTrue === '1.0' && whenFalse === '0.0')
    return `${isWGSL ? 'f32' : 'float'}(${cond})`;
  if (isWGSL) return `select(${whenFalse}, ${whenTrue}, ${cond})`;
  return `((${cond}) ? (${whenTrue}) : (${whenFalse}))`;
}

/**
 * The two-argument arc tangent of the target language.
 *
 * GLSL overloads `atan` on arity (`atan(y_over_x)` and `atan(y, x)`); WGSL
 * declares the two-argument form under its own name, `atan2`, and has no
 * two-argument `atan` at all, so the GLSL spelling is a compile error there.
 */
function gpuAtan2(target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? 'atan2' : 'atan';
}

/** Componentwise comparison builtins (GLSL) / operators (WGSL). */
const GPU_COMPARE_GLSL: Readonly<Record<string, string>> = {
  Less: 'lessThan',
  LessEqual: 'lessThanEqual',
  Greater: 'greaterThan',
  GreaterEqual: 'greaterThanEqual',
  Equal: 'equal',
  NotEqual: 'notEqual',
};
const GPU_COMPARE_WGSL: Readonly<Record<string, string>> = {
  Less: '<',
  LessEqual: '<=',
  Greater: '>',
  GreaterEqual: '>=',
  Equal: '==',
  NotEqual: '!=',
};

/** The boolean-vector (`bvecN` / `vecN<bool>`) type name for the target. */
function gpuBVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}<bool>` : `bvec${n}`;
}

/** The float-vector (`vecN` / `vecNf`) type name for the target. */
function gpuFVec(n: number, target?: CompileTarget<Expression>): string {
  return target?.language === 'wgsl' ? `vec${n}f` : `vec${n}`;
}

/**
 * The type a shader **representation** question about `expr` is answered from:
 * a `type alias` / nominal `type` reference unfolds to its definition, because
 * compilation is type erasure (nominal-types design §4.6 step 1). Identity for
 * every other type.
 */
function gpuType(expr: Expression): Type {
  return resolveTypeForCompilation(expr.type.type);
}

/** True when `expr` is a `Tuple` literal or is tuple-typed. */
function gpuIsTupleShaped(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple')) return true;
  const t = gpuType(expr);
  return typeof t !== 'string' && t.kind === 'tuple';
}

/** Fail closed on a shape the element-wise selection cannot render. */
/**
 * Fail closed when a value arm of a selection is a WRITTEN list or
 * tuple that lowers to a shader ARRAY — a list of points (`vec2[2](…)`) or
 * a list of five or more scalars: GLSL's ternary and WGSL's `select` take
 * scalars and vectors, and neither language selects between arrays. Only
 * the written shapes are judged here, before any arm is compiled; every
 * other arm keeps the selection lowering's own, more specific gates.
 */
function gpuAssertSelectableArms(
  head: string,
  values: ReadonlyArray<Expression | null | undefined>
): void {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (!isFunction(value, 'List') && !isFunction(value, 'Tuple')) continue;
    if (gpuOperandShape(value) !== 'array') continue;
    throw new Error(
      `Could not compile \`${head}\`: the value \`${value.toString()}\` lowers to a shader ARRAY, ` +
        `and a selection (a GLSL ternary, a WGSL \`select\`) chooses between ` +
        `scalars or vectors only.`
    );
  }
}

function gpuSelectionDecline(reason: string): never {
  throw new Error(`Could not compile \`Which\`: ${reason}`);
}

/**
 * True when a value arm of a selection (`If`, `Which`, the statement form of
 * both) is complex. A complex value lowers to a `vec2` of (re, im) and a real
 * value to a `float`, and neither a GLSL ternary nor a WGSL `select` accepts
 * a `vec2` arm beside a `float` arm. The real arms are then lifted to
 * `vec2(v, 0.0)` (`gpuSelectionArm`), so every arm has the type of the
 * complex selection.
 */
function gpuSelectionIsComplex(
  values: ReadonlyArray<Expression | null | undefined>
): boolean {
  return values.some(
    (v) => v !== null && v !== undefined && BaseCompiler.isComplexValued(v)
  );
}

/**
 * The code of one value arm of a selection. In a complex selection
 * (`gpuSelectionIsComplex`) a real scalar arm is lifted to `vec2(v, 0.0)`;
 * an arm that is not a scalar (a point, a list), or a scalar whose type
 * cannot be a number (a boolean: `vec2f(true, 0.0)` is not valid WGSL), has
 * no complex form, and the selection fails closed.
 */
function gpuSelectionArm(
  head: string,
  value: Expression,
  code: string,
  complex: boolean,
  target: CompileTarget<Expression>
): string {
  if (!complex || BaseCompiler.isComplexValued(value)) return code;
  // An arm whose type is not known (an undeclared uniform `z`) is read as a
  // float, as it is in a selection with no complex arm, and is lifted. An
  // arm whose type cannot be a number (`True`, a comparison) is not.
  const scalar = gpuOperandShape(value) === 'scalar';
  if (!scalar || !couldMatch(value.type.type, 'number'))
    throw new Error(
      `Could not compile \`${head}\`: the value \`${value.toString()}\` is not a ` +
        `${scalar ? 'number' : 'scalar'}, and another value of the ` +
        `selection is complex.`
    );
  return `${gpuVec2(target)}(${code}, 0.0)`;
}

/**
 * Width (2–4) of a `Which` CONDITION lowered element-wise on a GPU target, or
 * `undefined` when the condition is a plain shader scalar. Throws (D6) for a
 * non-scalar condition with no static `vec2`–`vec4` shape — the case that used
 * to emit garbage such as `u_L == 3.0` behind `success: true`.
 */
function gpuSelectionConditionWidth(c: Expression): 2 | 3 | 4 | undefined {
  // `True` marks the default clause; `False` is a scalar (never-taken) mask.
  if (isSymbol(c, 'True') || isSymbol(c, 'False')) return undefined;

  if (isFunction(c, 'List')) {
    for (const cell of c.ops) {
      // A cell that is provably a SCALAR boolean lowers as its own scalar
      // condition inside the `bvecN`/`vecN<bool>` constructor — a literal
      // `True`/`False`, or a scalar comparison such as `x < 0`. Anything
      // else declines: the interpreter selects only when every cell
      // evaluates to a boolean, and a non-scalar cell has no single slot.
      if (isSymbol(cell, 'True') || isSymbol(cell, 'False')) continue;
      if (
        BaseCompiler.isBooleanValued(cell) &&
        !BaseCompiler.isComplexValued(cell) &&
        !BaseCompiler.isNonScalarShape(cell)
      )
        continue;
      gpuSelectionDecline(
        `a literal list condition needs provably boolean scalar cells ` +
          `(\`True\`/\`False\` or a scalar comparison); the cell ` +
          `\`${cell.toString()}\` is not one, and the interpreter only ` +
          `selects when every cell evaluates to a boolean.`
      );
    }
    const n = c.nops;
    if (n < 2 || n > 4)
      gpuSelectionDecline(
        `a ${n}-element list condition has no GPU vector lowering (only ` +
          `vec2–vec4 are shader values).`
      );
    return n as 2 | 3 | 4;
  }

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      // A complex value is ALSO lowered as a `vec2`, so it must be recognized
      // BEFORE the width or it masquerades as a 2-cell collection.
      if (BaseCompiler.isComplexValued(op))
        gpuSelectionDecline(
          `a complex-valued operand (\`${op.toString()}\`) in an element-wise ` +
            `condition is lowered as a \`vec2\` of (re, im), which has no cell ` +
            `meaning in a selection.`
        );
      if (gpuIsTupleShaped(op))
        gpuSelectionDecline(
          `a tuple operand (\`${op.toString()}\`) in an element-wise condition ` +
            `has no element-wise reading — the interpreter binds a tuple ` +
            `atomically.`
        );
      const w = gpuComponentCount(op);
      if (w === undefined) {
        if (BaseCompiler.isNonScalarShape(op))
          gpuSelectionDecline(
            `the condition operand \`${op.toString()}\` is not a shader scalar ` +
              `and has no static vec2–vec4 shape (an unknown-length list, a ` +
              `matrix, or a 5+-element list).`
          );
        continue;
      }
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise condition mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    if (width === undefined) return undefined;
    if ((h === 'Equal' || h === 'NotEqual') && ops.length > 2)
      gpuSelectionDecline(
        `an n-ary \`${h}\` over a collection operand has no faithful ` +
          `element-wise lowering — the interpreter's n-ary form switches shape ` +
          `on how many operands are collections at run time, so no pairwise ` +
          `conjunction matches it.`
      );
    if (GPU_COMPARE_GLSL[h] === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    return width;
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    let width: 2 | 3 | 4 | undefined = undefined;
    for (const op of ops) {
      const w = gpuSelectionConditionWidth(op);
      if (w === undefined) continue;
      if (width !== undefined && width !== w)
        gpuSelectionDecline(
          `an element-wise \`${h}\` mixes vec${width} and vec${w} operands.`
        );
      width = w;
    }
    return width;
  }

  // A complex-valued condition is a scalar-side value (its `vec2` is (re, im),
  // not two cells): left exactly as it is today.
  if (BaseCompiler.isComplexValued(c)) return undefined;
  // The RAW width, not `gpuComponentCount`: a mask is a `bvecN` / `vec<bool>`,
  // whose cells are booleans, so the shader-float element test that reading
  // applies would reject the very shape this slot exists for. The elements are
  // checked here instead, against `boolean` rather than against a float.
  const w = BaseCompiler.vectorComponentCount(c);
  if (w !== undefined) {
    // A value used DIRECTLY as a boolean-vector condition (e.g. a `vars`-mapped
    // `bvec` uniform). Anything else with a vector shape is a numeric vector,
    // which is not a condition.
    if (!c.type.matches('indexed_collection<boolean>'))
      gpuSelectionDecline(
        `the condition \`${c.toString()}\` is a collection of ` +
          `\`${c.type.toString()}\`, not of booleans.`
      );
    return w;
  }
  if (BaseCompiler.isNonScalarShape(c))
    gpuSelectionDecline(
      `the condition \`${c.toString()}\` is not a shader scalar and has no ` +
        `static vec2–vec4 shape.`
    );
  return undefined;
}

/** Conjoin boolean-vector masks componentwise. */
function gpuMaskAnd(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' & ')})`;
  // GLSL has no componentwise `&&`: convert to 0/1 floats, multiply, and let
  // the `bvecN` constructor read nonzero back as `true`.
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' * ')})`;
}

/** Disjoin boolean-vector masks componentwise. */
function gpuMaskOr(
  masks: ReadonlyArray<string>,
  n: 2 | 3 | 4,
  target: CompileTarget<Expression>
): string {
  if (masks.length === 1) return masks[0];
  if (target.language === 'wgsl') return `(${masks.join(' | ')})`;
  const f = gpuFVec(n, target);
  return `${gpuBVec(n, target)}(${masks.map((m) => `${f}(${m})`).join(' + ')})`;
}

/**
 * Emit a `bvecN` / `vecN<bool>` mask for one `Which` condition.
 *
 * Boolean vectors — NOT float masks: a float `mix(a, b, t)` computes
 * `a·(1−t) + b·t`, so a NaN in the unselected operand poisons the result
 * (`mix(NaN, x, 1.0)` is NaN). The `genBType` `mix` / WGSL `select` overloads
 * are true per-component SELECTION and are therefore NaN-safe.
 */
function gpuSelectionMask(
  c: Expression,
  n: 2 | 3 | 4,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const bvec = gpuBVec(n, target);
  const fvec = gpuFVec(n, target);

  if (isSymbol(c, 'True')) return `${bvec}(true)`;
  if (isSymbol(c, 'False')) return `${bvec}(false)`;

  if (isFunction(c, 'List'))
    return `${bvec}(${c.ops
      .map((x) =>
        isSymbol(x, 'True')
          ? 'true'
          : isSymbol(x, 'False')
            ? 'false'
            : // A provably-boolean scalar cell (validated by
              // `gpuSelectionConditionWidth`) compiles as its own scalar
              // condition inside the constructor: `bvec2((x < 0.0), true)`.
              compile(x)
      )
      .join(', ')})`;

  const h = c.operator;
  const ops: ReadonlyArray<Expression> = isFunction(c) ? c.ops : [];
  if (isRelationalOperator(h)) {
    // `isRelationalOperator` covers the FULL inequality set (`Precedes`,
    // `Approx`, `Tilde`, …), not just the six componentwise comparators. A
    // scalar-operand relation skips the width pass's compare-form check, so
    // guard again at the emission site — indexing past the map would splice
    // the literal string `undefined` into the shader source.
    const cmp =
      target.language === 'wgsl' ? GPU_COMPARE_WGSL[h] : GPU_COMPARE_GLSL[h];
    if (cmp === undefined)
      gpuSelectionDecline(
        `the relation \`${h}\` has no componentwise shader form.`
      );
    const operand = (op: Expression, once: boolean): string => {
      const code = once ? gpuOperandOnce(h, op, compile, target) : compile(op);
      return gpuComponentCount(op) === undefined ? `${fvec}(${code})` : code;
    };
    // A chained ordering `a < m < b` conjoins the successive pairwise masks,
    // splicing each MIDDLE operand (indices 1..n-2) into two of them. An
    // IMPURE (Random-family) operand must still be drawn exactly once —
    // `_gpu_rnd_draw` advances a runtime counter, so a repeated splice draws a
    // DIFFERENT value there AND shifts every later draw in the shader. Bind
    // those to a hoisted temporary (or decline where there is no statement
    // sink). Pure operands are safe to duplicate and stay inline.
    //
    // A hoisted temporary runs BEFORE the mask expression, so binding only the
    // middles would draw a middle ahead of an impure ENDPOINT left inline —
    // reversing the interpreter's argument order. Once a middle is bound, route
    // EVERY impure operand through `gpuOperandOnce`, in argument order (the
    // hoisted statements are emitted in that order).
    const impureMiddle = ops.some(
      (op, i) => i >= 1 && i <= ops.length - 2 && op.isPure === false
    );
    const codes = ops.map((op) =>
      operand(op, impureMiddle && op.isPure === false)
    );
    const masks: string[] = [];
    for (let i = 0; i < codes.length - 1; i++) {
      masks.push(
        target.language === 'wgsl'
          ? `((${codes[i]}) ${cmp} (${codes[i + 1]}))`
          : `${cmp}(${codes[i]}, ${codes[i + 1]})`
      );
    }
    return gpuMaskAnd(masks, n, target);
  }

  if (h === 'And' || h === 'Or' || h === 'Not') {
    const masks = ops.map((op) => gpuSelectionMask(op, n, compile, target));
    if (h === 'Not') {
      if (masks.length !== 1)
        throw new Error('Could not compile `Not`: expected one argument');
      return target.language === 'wgsl'
        ? `(!(${masks[0]}))`
        : `not(${masks[0]})`;
    }
    return h === 'And'
      ? gpuMaskAnd(masks, n, target)
      : gpuMaskOr(masks, n, target);
  }

  // A boolean-vector value used directly as the condition, or a scalar boolean
  // splat across the selection width. The RAW width again, for the reason
  // `gpuSelectionConditionWidth` states: this slot holds a `bvecN`, and that
  // width has already been admitted there as a collection of booleans.
  if (
    !BaseCompiler.isComplexValued(c) &&
    BaseCompiler.vectorComponentCount(c) !== undefined
  )
    return compile(c);
  return `${bvec}(${compile(c)})`;
}

/**
 * Lower a `Which`/`If` whose condition may be an indexed collection to the GPU
 * ELEMENT-WISE selection form (`np.select` semantics — R1–R4 of
 * `docs/BROADCAST-MODEL.md`). Clauses arrive in
 * `Which` shape (condition, arm, condition, arm, …); the base compiler
 * normalizes `If(c, t, f)` to `[c, t, True, f]`.
 *
 * Only STATICALLY SHAPED conditions lower: every non-scalar condition must have
 * a `vec2`–`vec4` shape, and all of them the same one. Each condition becomes a
 * boolean vector (`bvecN` / `vecN<bool>`), and the clauses are folded
 * right-to-left with GLSL `mix` / WGSL `select` — first match wins (R1), with
 * `vecN(NaN)` as the no-match value (R4). Returns `null` when every condition is
 * provably scalar, so the ordinary scalar `Which`/`If` emission is untouched;
 * throws (D6) on any shape the shader languages cannot render.
 *
 * Documented divergences from the interpreter (a shader cannot throw —
 * CO-P2-24, the same reason the `absence` capability at `createTarget` declares
 * no `isAbsent`):
 *
 * - R2: a shader evaluates EVERY condition and EVERY arm. This goes BEYOND
 *   what R2 licenses (R2 promises an arm is evaluated only if selection
 *   reaches it; it only permits computing unselected CELLS of a selected
 *   arm) — a genuine GPU-specific divergence, accepted because the domain is
 *   pure and total: no arm can throw, no draw count is observable, so only
 *   the cells selection keeps are visible in the result.
 * - R4′: an absent (NaN) condition cell follows IEEE comparison semantics
 *   rather than the interpreter's consumed error cell: the orderings and
 *   `equal` answer `false` (the position falls through to LATER clauses),
 *   but `notEqual` answers `true` for a NaN cell (the clause SELECTS it) and
 *   `Not` inverts. Absence is not detectable here — `isnan`, and under
 *   aggressive fast-math even the NaN-comparison results themselves, are
 *   unreliable (the same limitation that omits `absence.isAbsent`).
 * - A non-boolean condition VALUE at run time cannot throw; only statically
 *   visible non-boolean conditions are declined here.
 */
function compileGPUSelection(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | null {
  let n: 2 | 3 | 4 | undefined = undefined;
  for (let i = 0; i < args.length; i += 2) {
    const w = gpuSelectionConditionWidth(args[i]);
    if (w === undefined) continue;
    if (n !== undefined && n !== w)
      gpuSelectionDecline(
        `the conditions of an element-wise selection mix vec${n} and vec${w}.`
      );
    n = w;
  }
  // Every condition is a scalar: leave the ordinary emission alone.
  if (n === undefined) return null;

  const width = n;
  const fvec = gpuFVec(width, target);

  const armCode = (arm: Expression): string => {
    if (BaseCompiler.isComplexValued(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a complex-valued arm ` +
          `(\`${arm.toString()}\`) — a compiled complex value is a \`vec2\` of ` +
          `(re, im), which has no cell convention inside a selection.`
      );
    if (gpuIsTupleShaped(arm))
      gpuSelectionDecline(
        `an element-wise selection cannot have a tuple arm ` +
          `(\`${arm.toString()}\`) — a lifted point would be a list of points, ` +
          `which is not a GPU value.`
      );
    // A boolean arm has no GPU rendering: the selection's value operands are
    // one numeric vector type, and a `bvecN` (or a scalar `true`/`false`,
    // which is not even a float) spliced into `mix`/`select` is invalid
    // shader source. (The JS target returns boolean cells; a GPU consumer
    // should spell the mask numerically — 1 and 0 arms.)
    if (
      isSymbol(arm, 'True') ||
      isSymbol(arm, 'False') ||
      arm.type.matches('boolean') ||
      arm.type.matches('indexed_collection<boolean>')
    )
      gpuSelectionDecline(
        `an element-wise selection cannot have a boolean-valued arm ` +
          `(\`${arm.toString()}\`) — a GPU selection produces one numeric ` +
          `vector, and there is no boolean-cell convention. Use numeric arms ` +
          `(e.g. 1 and 0) instead.`
      );
    const w = gpuComponentCount(arm);
    if (w === width) return compile(arm);
    if (w === undefined && !BaseCompiler.isNonScalarShape(arm))
      return `${fvec}(${compile(arm)})`;
    gpuSelectionDecline(
      `the arm \`${arm.toString()}\` does not fit the vec${width} shape of the ` +
        `element-wise conditions (the interpreter answers ` +
        `\`incompatible-dimensions\`).`
    );
  };

  // First match wins: fold the clauses from LAST to FIRST over the no-match
  // vector, so an earlier clause's mask overrides a later one.
  let acc = `${fvec}(${gpuNaN(target)})`;
  for (let i = args.length - 2; i >= 0; i -= 2) {
    const code = armCode(args[i + 1]);
    // A `True` condition is the default clause: everything built for the later
    // (now unreachable) clauses is replaced.
    if (isSymbol(args[i], 'True')) {
      acc = code;
      continue;
    }
    const mask = gpuSelectionMask(args[i], width, compile, target);
    acc =
      target.language === 'wgsl'
        ? `select(${acc}, ${code}, ${mask})`
        : `mix(${acc}, ${code}, ${mask})`;
  }
  return acc;
}

/**
 * Lower a `broadcastable` unary head applied to a collection operand
 * (`Sin([1,2,3,4])`, `-[1,2,3,4]`) on a shader target — WITHOUT fanning out.
 *
 * GLSL and WGSL builtins and operators are already componentwise on a vector
 * (`sin(vec4)` is a `vec4`, `-vec4` is a `vec4`), so the faithful lowering is
 * the head's OWN scalar form applied directly to the vector operand. There is
 * no element loop, no callback and no temporary — the base compiler's former
 * default emitted a JavaScript `.map((v) => …)` arrow here, which no shader
 * compiler accepts.
 *
 * Gated on the operand having a static `vec2`–`vec4` shape — the same
 * activation gate as the element-wise selection lowering
 * (`gpuComponentCount`). Anything else (an unknown-length list, a matrix, a
 * 5+-element list, or a fixed-length list whose elements are not shader
 * floats) has no shader vector value at all, so it fails closed rather
 * than emitting source a driver would reject.
 *
 * The EMITTED lowering is then checked for componentwise safety: most scalar
 * lowerings are built from genType-polymorphic pieces (`sin(v)`, `-v`,
 * `1.0 / sin(v)`, `log(v) / log(10.0)`) and stay valid verbatim on a `vecN`,
 * but three constructs do not — see `gpuIsComponentwise`.
 */
function compileGPUBroadcastUnary(
  head: string,
  operand: Expression,
  lowering: {
    collection: () => string;
    element: (code: string) => string;
  }
): string {
  const decline = (reason: string): never => {
    throw new Error(`Could not compile \`${head}\`: ${reason}`);
  };
  // A complex value is ALSO lowered as a `vec2` (of re, im), so it must be
  // recognized BEFORE the width or it masquerades as a 2-cell collection —
  // the same ordering the selection lowering depends on.
  if (BaseCompiler.isComplexValued(operand))
    decline(
      `a complex-valued operand (\`${operand.toString()}\`) is lowered as a ` +
        `\`vec2\` of (re, im), which has no element-wise reading — a ` +
        `componentwise shader builtin would treat its real and imaginary ` +
        `parts as two independent elements.`
    );
  if (gpuComponentCount(operand) === undefined)
    decline(
      `the operand \`${operand.toString()}\` has no static vec2–vec4 shape ` +
        `(an unknown-length list, a matrix, or a 5+-element list), so it is ` +
        `not a shader vector and the componentwise builtins do not apply to it.`
    );
  const vector = lowering.collection();
  // The scalar lowering of `Square` reads the shape of its operand to choose
  // between `_gpu_pow2` and the `vecN` overload `_gpu_pow2_vN`. Here its
  // operand is a placeholder for the vector code, which has no shape, so the
  // scalar helper is chosen and the check below declines it. A `vecN`
  // operand is lowered here as `Power(c, 2)` lowers it: a bare name is
  // multiplied by itself (`*` is componentwise), and any other code goes
  // through the `vecN` overload, which evaluates it once.
  if (head === 'Square')
    return /^[A-Za-z_]\w*$/.test(vector)
      ? `(${vector} * ${vector})`
      : gpuFixedPower(vector, 2, gpuOperandShape(operand));
  const code = lowering.element(vector);
  const unsafe = gpuIsComponentwise(code, vector);
  if (unsafe !== undefined)
    decline(
      `the scalar shader lowering \`${code}\` is not componentwise — ` +
        `${unsafe} A shader has no element loop, so a non-componentwise ` +
        `lowering cannot be broadcast over a \`vecN\` at all.`
    );
  return code;
}

/**
 * Why an emitted scalar lowering canNOT be reused verbatim on a `vecN`, or
 * `undefined` when it can.
 *
 * The shader builtins (`sin`, `sqrt`, `abs`, …) and the arithmetic operators
 * are genType-polymorphic, including the mixed scalar/vector forms
 * (`1.0 / vec3`, `vec3 / log(10.0)`), so the overwhelming majority of the
 * scalar lowerings are already componentwise. The exceptions are recognized
 * from the SHAPE OF THE EMITTED SOURCE — not from a list of operator names,
 * which would go stale the moment a lowering changed:
 *
 *  - a `_gpu_…` PREAMBLE HELPER (`_gpu_sinc`, `_gpu_gamma`, `_gpu_heaviside`,
 *    `_gpu_fresnelC`, `_gpu_powi`, …). Every helper reachable from a SCALAR
 *    element lowering is declared with scalar `float`/`f32` parameters, so
 *    `_gpu_sinc` of a `vec3` is source no driver accepts. The `_gpu_` prefix
 *    IS the property being tested. (A few helpers ARE aggregate-aware — the
 *    complex arithmetic and the colour converters take `vec2`/`vec3`, and the
 *    integer power has a per-width overload family, `_gpu_powi2`–`_gpu_powi4`
 *    — which is why the generic gate `gpuCheckOperandShapes` consults the
 *    emitted DECLARATION, `gpuHelperIsScalarOnly`, before reusing this
 *    verdict.)
 *  - a COMPARISON or a TERNARY (`Argument(x)` → `((x >= 0.0) ? 0.0 : π)`):
 *    GLSL has no `vecN >= float`, and both languages require a scalar `bool`
 *    condition, so there is no componentwise reading of either.
 *  - a lowering that DROPS the operand (`Imaginary(x)` → `0.0` for a real
 *    `x`): the result is a scalar where the caller is owed a `vecN`, which is
 *    a silent SHAPE error rather than a driver error.
 *
 * The last two are only decidable when the caller can name the operand's own
 * compiled source (`vector`) — i.e. on the fan-out route, where the WHOLE
 * emission derives from the element lowering. A caller with no such handle
 * (the generic gate, which sees a lowering over several independently
 * compiled operands) passes none, and gets the helper verdict alone: there,
 * a comparison may perfectly well be over an unrelated scalar operand
 * (`ContrastingColor` → `(_gpu_apca(…) > 50.0) ? … : …`).
 */
function gpuIsComponentwise(code: string, vector?: string): string | undefined {
  const helper = /_gpu_[A-Za-z0-9_]+\s*\(/.exec(code);
  if (helper !== null)
    return (
      `it calls the preamble helper \`${helper[0].slice(0, -1).trim()}\`, ` +
      `which is declared with scalar float/f32 parameters.`
    );
  if (vector === undefined) return undefined;
  if (/\?|[<>]=?|[=!]=/.test(code))
    return (
      `it branches on a comparison, which a shader requires to be a scalar ` +
      `bool.`
    );
  if (!code.includes(vector))
    return `it does not use the operand at all, so its result is a scalar.`;
  return undefined;
}

/**
 * The SHADER shape an operand lowers to: a scalar, a `vecN` (reported as its
 * width), a `matN`, or an array (`float[N]` / `array<f32, N>`).
 *
 * Derived from the shape helpers the rest of the GPU analysis already uses —
 * `isNonScalarShape` ("is this a scalar at all?") and `gpuComponentCount`
 * ("does it have a `vec2`–`vec4` lowering?") — so it stays in step with them
 * rather than re-deciding shape from scratch, plus `gpuIsCollectionShaped` for
 * the collection type spellings `isNonScalarShape` does not recognize.
 *
 * A fixed-length list whose ELEMENTS are not shader floats (`list<complex^3>`,
 * a list of lists) has no `vecN` reading and no other shader value shape
 * either, so it lands on `'array'` here and every arithmetic and builtin gate
 * declines it — the fail-closed answer for a shape the language cannot hold.
 *
 * A COMPLEX value reads as a scalar here, even though it lowers to a `vec2` of
 * (re, im): the complex convention is its own, carried by the complex codegen
 * (`_gpu_cmul`, `_gpu_cdiv`, …), and reading it as a 2-cell vector would make
 * every complex lowering look like a shape error. This is the same ordering
 * the fan-out and selection lowerings depend on.
 */
/**
 * `u` when the real expression `x` is `π·u` with a scalar `u`
 * (`BaseCompiler.piMultiple`): the shader lowers `sin(πu)`, `cos(πu)`,
 * `tan(πu)` and `e^{iπu}` with the angle in half-turns (`_gpu_cossinpi`).
 * A vector `u` keeps the componentwise built-in.
 */
function gpuPiMultiple(x: Expression | null): Expression | undefined {
  if (x === null) return undefined;
  const u = BaseCompiler.piMultiple(x);
  return u !== undefined && gpuOperandShape(u) === 'scalar' ? u : undefined;
}

export function gpuOperandShape(
  expr: Expression
): 'scalar' | 'matrix' | 'array' | 2 | 3 | 4 {
  if (BaseCompiler.isComplexValued(expr)) return 'scalar';
  if (!BaseCompiler.isNonScalarShape(expr) && !gpuIsCollectionShaped(expr))
    return 'scalar';
  const width = gpuComponentCount(expr);
  if (width !== undefined) return width;
  // A written list of points is emitted as an ARRAY of vectors
  // (`gpuUniformVectorWidth`), never as a matrix, whatever its type's
  // dimensions say: the shape must agree with the emission, or a scalar
  // times a nested list would pass the matrix reading and emit
  // `x * vec2[2](…)`, which no shader accepts.
  if (
    (isFunction(expr, 'List') || isFunction(expr, 'Tuple')) &&
    gpuUniformVectorWidth(expr.ops) !== undefined
  )
    return 'array';
  if (isFunction(expr, 'Matrix')) return 'matrix';
  const t = gpuType(expr);
  if (
    typeof t !== 'string' &&
    t.kind === 'list' &&
    (t.dimensions?.length ?? 0) >= 2
  )
    return 'matrix';
  // A non-scalar with no `vecN` and no matrix reading: a 1-element or
  // 5+-element list, or a list of unknown length — a shader ARRAY.
  return 'array';
}

/**
 * Whether `expr` is COLLECTION-SHAPED by its declared type, whatever spelling
 * that type uses and whether or not a static element count can be read off it.
 *
 * `isNonScalarShape` recognizes only the `list` type CONSTRUCTOR, so an
 * operand declared with a sibling spelling read back as a shader SCALAR and
 * every shape gate stepped aside for it: `Sin(L)` for `L: collection<number>`
 * emitted `sin(L)`, source that is valid only if the host happens to bind `L`
 * to a `vecN` uniform — a shape the compiler asserts but cannot see. The
 * spellings that slipped through are the other collection kinds
 * (`collection<T>`, `indexed_collection<T>`, `set<T>`, `dictionary`) and the
 * BARE names `list` and `collection`, which the type representation carries as
 * primitive strings rather than as a `list` node.
 *
 * The question is asked against the absence-admitting top `collection<any>`,
 * not the bare name `collection`: a bare collection name is the values-only
 * synonym of its `<unknown>` form, so `list<any>` and `list<integer|missing>`
 * would not match it.
 *
 * A `string` is excluded. It matches `collection` in the lattice — its
 * elements are its grapheme clusters — but this target has no strings at all,
 * so a string operand keeps the "provably not a number" diagnostic naming its
 * type, which is the diagnostic it has always received.
 */
function gpuIsCollectionShaped(expr: Expression): boolean {
  const t = gpuType(expr);
  return isSubtype(t, COLLECTION_SHAPE_TYPE) && !isSubtype(t, 'string');
}

/** How `gpuCheckOperandShapes` names a shape in a diagnostic. */
function gpuShapeName(shape: ReturnType<typeof gpuOperandShape>): string {
  return typeof shape === 'number' ? `vec${shape}` : shape;
}

/**
 * The `vecN` width a two-operand lowering must emit, or `undefined` when it
 * stays scalar.
 *
 * Answers a width only for the shapes the shader arithmetic really does
 * broadcast: one `vecN` beside a scalar, or two `vecN` of the SAME width.
 * Different widths, a `matN` and an array all answer `undefined`, so the
 * lowering emits its plain form and `gpuCheckOperandShapes` reports the fault
 * with the diagnostic it owns — a lowering that guessed a width here would
 * turn a clean decline into invalid source.
 *
 * A missing operand (an under-applied head) also answers `undefined`.
 */
function gpuBinaryVectorWidth(
  a: Expression | null | undefined,
  b: Expression | null | undefined
): 2 | 3 | 4 | undefined {
  if (a === null || a === undefined || b === null || b === undefined)
    return undefined;
  const sa = gpuOperandShape(a);
  const sb = gpuOperandShape(b);
  if (typeof sa === 'number')
    return sb === 'scalar' || sb === sa ? sa : undefined;
  if (typeof sb === 'number') return sa === 'scalar' ? sb : undefined;
  return undefined;
}

/**
 * An operand's source, widened to a `vecN` constructor when the slot it stands
 * in is a vector one and the operand itself lowers to a scalar.
 *
 * The genType builtins (`pow`, `atan`, `mod`, …) are declared over ONE type
 * for all their arguments; neither GLSL nor WGSL promotes a scalar argument to
 * the vector of its neighbours, so the promotion has to be written out.
 * `vec3(y)` is the broadcast constructor of both languages — every component
 * takes the same value.
 *
 * `width` of `undefined` (a scalar lowering) and an operand that is already
 * that `vecN` both compile unchanged, so the emission is byte-identical to the
 * scalar-only one wherever no widening is due.
 *
 * `compile` runs exactly once on either branch: an operand may hoist a
 * temporary or advance the random-draw counter, so compiling it twice would
 * change the shader, not merely lengthen it.
 */
function gpuWidenToVector(
  expr: Expression,
  width: 2 | 3 | 4 | undefined,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  if (width === undefined || gpuOperandShape(expr) !== 'scalar')
    return compile(expr);
  return `${gpuFVec(width, target)}(${compile(expr)})`;
}

/**
 * The `[rows, cols]` of a matrix-shaped operand, or `undefined` when they are
 * not statically known. The kind alone is not enough for the operator gate:
 * `mat2 + mat3` and `mat2 * vec3` are as invalid as `vec2 + vec3`, so the
 * dimensions must be read — structurally for a `Matrix` literal, from the
 * declared list dimensions otherwise (an unknown extent is reported as a
 * negative count there, and answers `undefined` here).
 */
function gpuMatrixDims(
  expr: Expression
): readonly [rows: number, cols: number] | undefined {
  if (isFunction(expr, 'Matrix')) {
    const body = expr.ops[0];
    if (!isFunction(body) || body.nops === 0) return undefined;
    const rows = body.ops;
    const cols = isFunction(rows[0]) ? rows[0].nops : 0;
    if (cols > 0 && rows.every((r) => isFunction(r) && r.nops === cols))
      return [rows.length, cols];
    return undefined;
  }
  const t = gpuType(expr);
  if (typeof t !== 'string' && t.kind === 'list') {
    const dims = t.dimensions;
    if (dims?.length === 2 && dims[0] > 0 && dims[1] > 0)
      return [dims[0], dims[1]];
  }
  return undefined;
}

/**
 * A WGSL type TEMPLATE — the type keyword and its opening angle bracket
 * (`array<`, `vec3<`, `mat2x2<`, `atomic<`, `ptr<`). GLSL has no such
 * spelling, so one pattern serves both languages.
 *
 * Sticky, and used only with `lastIndex` set immediately before each test, so
 * it carries no state between calls.
 */
const GPU_TYPE_TEMPLATE =
  /(?:array|[iub]?vec[234]|mat[234]x[234]|atomic|ptr)\s*</y;

/**
 * The callee and top-level argument count of `code` when the WHOLE emission is
 * a single call. `undefined` for an infix/compound emission (`a + b`,
 * `(c ? a : b)`, `log(a) / log(10.0)`), which is what tells the gate below
 * that no single builtin signature governs the operand shapes.
 *
 * The argument count is what distinguishes a lowering that passes its operands
 * THROUGH (`_gpu_powi(x, n)`, one argument per operand) from one that
 * DESTRUCTURES a collection operand into scalars (`Median([1,5,3,2,4])` →
 * `_gpu_median_5(1.0, 5.0, 3.0, 2.0, 4.0)`, five arguments for one operand) —
 * a reduction the shape gate must leave alone.
 *
 * `operands` are those arguments' own sources, which is what lets a reduction
 * read the components back out of an aggregate CONSTRUCTOR
 * (`gpuScalarComponents`).
 */
function gpuTopLevelCall(
  code: string
): { callee: string; argCount: number; operands: string[] } | undefined {
  const s = code.trim();
  // `sin`, `_gpu_powi`, `vec3f`, `mat2x2f`, `float[5]`, `array<f32, 5>`
  const m = /^([A-Za-z_]\w*(?:\s*<[^<>()]*>)?(?:\s*\[\d+\])?)\s*\(/.exec(s);
  if (m === null) return undefined;
  let depth = 0;
  let start = m[0].length;
  const operands: string[] = [];
  for (let i = m[0].length - 1; i < s.length; i++) {
    // A WGSL type template carries a COMMA of its own: an `array<f32, 5>(…)`
    // argument used to split into `array<f32` and `5>(…)`, so the argument
    // count came out one too high and every check keyed to it (the one-for-one
    // tests in `gpuCheckOperandShapes`) silently stepped aside — which let an
    // array operand of a scalar-only helper through as invalid source. Skip
    // past the matching `>`. Anchored on the type KEYWORD at a token start, so
    // a `<` that is a less-than inside a comparison operand is untouched.
    if (i === 0 || !/[\w$]/.test(s[i - 1])) {
      GPU_TYPE_TEMPLATE.lastIndex = i;
      if (GPU_TYPE_TEMPLATE.test(s)) {
        let angle = 1;
        let j = GPU_TYPE_TEMPLATE.lastIndex;
        for (; j < s.length && angle > 0; j++) {
          if (s[j] === '<') angle++;
          else if (s[j] === '>') angle--;
        }
        if (angle > 0) return undefined;
        i = j - 1;
        continue;
      }
    }
    if (s[i] === '(') {
      if (++depth === 1) start = i + 1;
    } else if (s[i] === ',' && depth === 1) {
      operands.push(s.slice(start, i).trim());
      start = i + 1;
    } else if (s[i] === ')' && --depth === 0) {
      if (i !== s.length - 1) return undefined;
      const last = s.slice(start, i).trim();
      // `f()` has no arguments; `f(a)` has one, even when `a` is empty text.
      if (last !== '' || operands.length > 0) operands.push(last);
      return { callee: m[1].trim(), argCount: operands.length, operands };
    }
  }
  return undefined;
}

/**
 * An aggregate CONSTRUCTOR of either shader language (`vec3`, `bvec2`,
 * `mat2x2f`, `float[5]`, `array<f32, 5>`). Such a lowering BUILDS a shape from
 * its operands instead of acting on them, so the componentwise gate does not
 * apply to it; the constructors have their own guards
 * (`assertGPUScalarComponents`, `gpuValueHasVectorComponents`). The spellings
 * of the two languages are disjoint, so one predicate serves both.
 */
const GPU_AGGREGATE_CONSTRUCTOR =
  /^(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

/** The callee of an array-of-vectors constructor: `vec3[12]` (GLSL) or
 * `array<vec3f, 12>` (WGSL) — the lowering of a written list of points. */
const GPU_VECTOR_ARRAY_CONSTRUCTOR = /^(?:[iub]?vec[234]\s*\[|array\s*<\s*vec)/;

/**
 * `GPU_AGGREGATE_CONSTRUCTOR` unanchored: does an aggregate constructor appear
 * ANYWHERE in this source? Used to tell a scalar component apart from a nested
 * aggregate one when a reduction reads an operand's components back out.
 */
const GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE =
  /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32|int|i32|uint|u32|bool)\s*\[)/;

/**
 * Is the preamble helper `name` declared with SCALAR parameters only?
 *
 * Read off the declaration the target itself emits for it, rather than
 * assumed: most helpers are scalar (`float _gpu_powi(float x, float n)`), but
 * the complex arithmetic takes `vec2` and the colour converters take `vec3`,
 * and handing those an aggregate is exactly what they are for.
 *
 * A helper with no declaration in the preamble answers `false` (permissive) —
 * the gate then leaves the call alone rather than declining a lowering it
 * cannot see.
 */
function gpuHelperIsScalarOnly(name: string, preamble: string): boolean {
  // GLSL: `float _gpu_powi(float x, float n) {`
  // WGSL: `fn _gpu_powi(x: f32, n: f32) -> f32 {`
  // Anchored to a declaration (a return type or `fn` at the head of a line) so
  // a CALL of the same helper inside another body cannot be read as one.
  const decl = new RegExp(
    `(?:^|\\n)[^\\S\\n]*(?:fn[^\\S\\n]+|[A-Za-z_]\\w*(?:\\[\\d+\\])?[^\\S\\n]+)` +
      `${name}[^\\S\\n]*\\(([^)]*)\\)`
  ).exec(preamble);
  if (decl === null) return false;
  return !/[iub]?vec[234]|mat[234]|array\s*<|\[\s*\d+\s*\]/.test(decl[1]);
}

/**
 * The shader builtins that REDUCE an aggregate argument to a scalar result —
 * a fact of both languages' specifications, in the same way the entries of
 * `GPUShapeRules` are, not a list of CE heads. `dot`, `length` and `distance`
 * are declared over the genType and return `float`/`f32`; `determinant` takes
 * a `matN` and returns one scalar; `any` and `all` reduce a `bvecN` to a
 * `bool`. Both languages spell all six the same way, so one table serves both.
 *
 * An aggregate CONSTRUCTOR standing inside one of these calls is consumed by
 * it: what reaches the enclosing slot is the scalar the call returns, not the
 * vector the constructor built.
 */
const GPU_SCALAR_REDUCING_BUILTINS = [
  'dot',
  'length',
  'distance',
  'determinant',
  'any',
  'all',
] as const;

/**
 * `code` with every scalar-reducing builtin call (`GPU_SCALAR_REDUCING_BUILTINS`)
 * replaced by a scalar literal — `dot(vec3(x, y, z), vec3(1.0, 2.0, 3.0)) + 1.0`
 * becomes `0.0 + 1.0`.
 *
 * Used before scanning a slot for an aggregate value. A constructor consumed
 * by `dot`, for example, does not make the enclosing slot aggregate-valued.
 * Replacing the outermost reduction also removes constructors nested inside it.
 */
function gpuWithoutScalarReductions(code: string): string {
  const head = new RegExp(
    `\\b(?:${GPU_SCALAR_REDUCING_BUILTINS.join('|')})\\s*\\(`,
    'g'
  );
  let out = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = head.exec(code)) !== null) {
    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        end = i;
        break;
      }
    }
    // Unbalanced (a source shape this scanner does not understand): leave the
    // remainder as it stands rather than guess at where the call ends.
    if (end < 0) break;
    out += code.slice(cursor, m.index) + '0.0';
    cursor = end + 1;
    head.lastIndex = cursor;
  }
  return out + code.slice(cursor);
}

/**
 * A VECTOR constructor in `code` with another aggregate constructor STANDING IN
 * one of its slots — `length(vec2(vec3(…), vec3(…)))`, `length(vec2(float[1](3.0),
 * 4.0))` — or `undefined` when there is none.
 *
 * Such a lowering RESHAPES its operands (it packs them into a vector) instead
 * of acting on them componentwise, so it is only correct for the scalar
 * operands it was written for: `Hypot(x, y)` → `length(vec2(x, y))` is
 * `√(x²+y²)` for scalars, but `vec2(vec3, vec3)` is not source a driver
 * accepts, and the element-wise hypotenuse it was asked for is not what it
 * would mean. Only `vecN(` heads are scanned — a `matN(` constructor takes
 * `vecN` columns BY DESIGN, and the aggregate constructors are exempt from the
 * gate entirely (they build a shape rather than consume one).
 *
 * What stands in a slot is judged after the scalar-reducing calls are removed
 * (`gpuWithoutScalarReductions`): `dot(vec2(dot(vec3(…), vec3(…)), 0.0),
 * vec2(…))` — a 2-D inner product one of whose components is a 3-D one —
 * packs a `float` and a `float` into its `vec2`, which is exactly what a
 * `vec2` has room for. Every `vecN(` in the source is still visited, so an
 * aggregate genuinely standing in a slot INSIDE a reduction
 * (`dot(vec2(vec3(…), 0.0), …)`) is still caught by that constructor's own
 * turn in the loop.
 */
function gpuReshapesOperands(code: string): string | undefined {
  const ctor = /\b([iub]?vec[234][fhiu]?)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = ctor.exec(code)) !== null) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) {
        const inner = gpuWithoutScalarReductions(
          code.slice(m.index + m[0].length, i)
        );
        const nested =
          /\b(?:[iub]?vec[234]|mat[234]|array\s*<|(?:float|f32)\s*\[)/.exec(
            inner
          );
        if (nested !== null)
          return (
            `it packs its operands into a \`${m[1]}\` constructor, which ` +
            `has no room for the aggregate \`${nested[0].trim()}\` value ` +
            `standing in each slot.`
          );
        break;
      }
    }
  }
  return undefined;
}

/**
 * Does this emission APPLY nothing — a bare identifier (possibly swizzled or
 * indexed) or a bare numeric literal?
 *
 * Such a lowering passes ONE operand through (`Real(m)` → `m`, a
 * `WithRandomSeed` body) or answers a constant (`Imaginary(x)` → `0.0`)
 * instead of combining its operands with a componentwise builtin, so the
 * shapes of the operands it did NOT use constrain it in no way. Read off the
 * source rather than from a list of heads: anything with a call or an operator
 * in it is a genuine compound emission and is judged as one.
 */
function gpuIsAtomicEmission(code: string): boolean {
  const s = code.trim();
  return (
    /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])*$/.test(s) ||
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)
  );
}

/**
 * Per-language shape rules for `gpuCheckOperandShapes`. GLSL and WGSL agree on
 * the broad strokes — the builtins and the arithmetic operators are
 * genType-polymorphic — but not on where a SCALAR may stand in for a `vecN`,
 * so each target supplies its own table (see `GPUShaderTarget.getShapeRules`).
 */
export type GPUShapeRules = {
  /**
   * Shader builtins that accept a scalar where their other genType arguments
   * are a `vecN`, and — crucially — WHERE. The scalar-tailed overloads
   * constrain the POSITION as well as the presence: GLSL declares
   * `mod(genType, float)` (scalar only LAST), `step(float, genType)` (scalar
   * only FIRST), `mix(genType, genType, float)` and `refract(genType, genType,
   * float)` (scalar only third), `clamp(genType, float, float)` (scalars in
   * slots 2–3). So the value is the set of 0-based argument positions at which
   * a scalar may stand; a scalar anywhere else is as invalid as one in a
   * builtin with no such overload at all.
   *
   * A builtin ABSENT from the map requires MATCHING genTypes throughout, so
   * `atan(vec3, float)` and `pow(float, vec3)` are not valid source in either
   * language.
   *
   * These are shader BUILTIN names — a fact of each language's specification,
   * not a list of CE heads — so tabulating them is what keeps the two
   * languages' genuinely different overload sets apart.
   */
  readonly scalarGenTypeSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a scalar — an OBLIGATION,
   * where `scalarGenTypeSlots` records a PERMISSION.
   *
   * The distinction is the overload SET, not the presence of a scalar-tailed
   * signature. `mix` is declared BOTH `mix(genType, genType, float)` AND
   * `mix(genType, genType, genType)`, so its third argument MAY be a scalar;
   * `refract` is declared ONLY `refract(genType I, genType N, float eta)`
   * (GLSL ES 3.00 §8.4 / GLSL 4.60 §8.5 / WGSL §17.5, `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`), so its third argument MUST be one. Every other
   * builtin in `scalarGenTypeSlots` — `min`, `max`, `clamp`, `step`,
   * `smoothstep`, `mod` — has a matched all-genType overload alongside its
   * scalar-tailed one, so none of them belongs here.
   *
   * Check this independently of `scalarGenTypeSlots`, including when no
   * operand is a scalar: `refract(vec3, vec3, vec3)` has no overload at all,
   * but the permission table is only consulted once a scalar is present, so an
   * all-vector call must be declined.
   */
  readonly mandatoryScalarSlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Shader builtins with an argument that is ALWAYS a `vecN` — the mirror of
   * `mandatoryScalarSlots`, and the other obligation an ALL-SCALAR call can
   * fail.
   *
   * GLSL declares its geometric functions over the genType, which INCLUDES
   * `float`: `refract(float, float, float)`, `dot(float, float)` and
   * `normalize(float)` are all valid GLSL (§8.4 / §8.5 — "genType" is
   * `float`, `vec2`, `vec3`, `vec4`). WGSL does not: `refract(e1: vecN<T>,
   * e2: vecN<T>, e3: T)`, `dot(e1: vecN<T>, e2: vecN<T>)`,
   * `faceForward(e1: vecN<T>, e2: vecN<T>, e3: vecN<T>)`,
   * `normalize(e: vecN<T>)` and `reflect(e1: vecN<T>, e2: vecN<T>)` (§17.5)
   * have no all-scalar form at all, so `refract(1.0, 2.0, 0.5)` — perfectly
   * good GLSL — is source no WebGPU driver accepts. `cross` is narrower still
   * and vector-only in BOTH languages (`vec3` only). `length` and `distance`
   * are declared over both a scalar and a `vecN` in either language and are
   * therefore absent.
   *
   * The all-scalar case is exactly the one the rest of the gate never sees: it
   * returns early on operands that are all scalars, which is why this check
   * runs first.
   */
  readonly vectorOnlySlots: ReadonlyMap<string, ReadonlySet<number>>;
  /**
   * Does the arithmetic operator `sym` accept a `matN` operand? `allMatrix` is
   * true when EVERY operand is a matrix (`mat2 * mat2`, `mat2 + mat2`) and
   * false when a scalar is mixed in (`mat2 * 2.0`). Admissibility of the
   * KIND pairing only — the dimension constraints (same size under the
   * componentwise operators, agreeing sizes under `*`) are language-shared
   * facts checked by the gate itself.
   */
  matrixArithmetic(sym: string, allMatrix: boolean): boolean;
  /**
   * Does the language define unary negation on a `matN`? GLSL does — its
   * unary operators "operate on integer or floating-point values (including
   * vectors and matrices)" (GLSL 4.60 §5.9) — but WGSL's negation (§8.7,
   * "Unary arithmetic expressions") is declared over scalars and `vecN` only,
   * so `-mat2x2f(…)` is not valid WGSL source.
   */
  readonly matrixNegate: boolean;
};

/**
 * The GPU targets' extension of `CompileTarget`: the language's own shape
 * rules, carried on the target so a LOWERING — not just the generic gate —
 * can judge the calls it generates against the same table
 * (`foldNaryBuiltin`). Written once by `createTarget()`; a hand-rolled target
 * that never went through it simply has none, and those lowerings then fall
 * back on the generic gate alone.
 */
type GPUShapeRulesTarget = CompileTarget<Expression> & {
  gpuShapeRules?: GPUShapeRules;
};

/** The shape rules `target` was created with, if any. */
function gpuShapeRules(
  target: CompileTarget<Expression> | undefined
): GPUShapeRules | undefined {
  return (target as GPUShapeRulesTarget | undefined)?.gpuShapeRules;
}

/**
 * Lowerings that CONSUME their aggregate operands — destructuring a collection
 * into scalars and combining those — rather than handing the aggregate to a
 * componentwise builtin. The `Max`/`Min` reduction (`compileGPUExtremum`),
 * `Median`'s sorting network and `Variance`'s inline mean/deviation sum are
 * the three. The original operand shapes are absent from the final emission,
 * so judging the emission against them would decline a
 * perfectly good reduction.
 *
 * The capability is declared at the handler's own definition site
 * (`markAggregateConsuming`) — never a table of CE head names kept elsewhere,
 * and never inferred from the shape of the emitted source. This prevents an
 * ordinary compound lowering such as WGSL's `Mod` from being mistaken for an
 * aggregate-consuming one.
 *
 * The value is a PREDICATE over the operands, not a flag, because a handler
 * that destructures a LITERAL collection still passes scalar operands straight
 * through in its other form: `Variance([1,2,3,4,5])` consumes an aggregate,
 * `Variance(v, w)` does not, and only the first should step the gate aside.
 */
const GPU_AGGREGATE_CONSUMING = new WeakMap<
  object,
  (args: ReadonlyArray<Expression>) => boolean
>();

/**
 * Is the operand of a `Norm` call a point literal with a broadcasting
 * component? The `Norm` lowering compiles such a point as its explicit norm
 * (`explicitBroadcastPointNorm`), so it consumes the point operand.
 */
function isBroadcastPointNormOperand(args: ReadonlyArray<Expression>): boolean {
  const arg = args[0];
  return (
    args.length === 1 &&
    arg !== undefined &&
    (isFunction(arg, 'Tuple') || isFunction(arg, 'PointList')) &&
    pointHasBroadcastComponent(arg)
  );
}

/**
 * Declare `fn` an aggregate-consuming lowering for the calls `when` accepts
 * (every call, by default) — see `GPU_AGGREGATE_CONSUMING`.
 */
function markAggregateConsuming<T extends CompiledFunction<Expression>>(
  fn: T,
  when: (args: ReadonlyArray<Expression>) => boolean = () => true
): T {
  if (typeof fn === 'function') GPU_AGGREGATE_CONSUMING.set(fn, when);
  return fn;
}

/**
 * `Median` and `Variance` destructure a SINGLE `List` operand into its
 * elements; given N scalar arguments instead they use them one for one, and
 * the gate must go on judging that form.
 */
const gpuDestructuresListOperand = (args: ReadonlyArray<Expression>): boolean =>
  args.length === 1 && isFunction(args[0], 'List');

/**
 * Is this the COLLECTION (reduce) form of `Sum`/`Product` — one operand, no
 * indexing set? That form destructures its operand into scalar components; the
 * indexed form (body plus `Limits`) does not.
 */
const gpuIsCollectionReduceForm = (args: ReadonlyArray<Expression>): boolean =>
  args.length === 1;

/** `{1}` → "in argument 2"; `{1, 2}` → "in arguments 2 and 3". */
function gpuSlotNames(slots: ReadonlySet<number>): string {
  const ns = [...slots].sort((a, b) => a - b).map((n) => `${n + 1}`);
  if (ns.length === 0) return 'nowhere';
  if (ns.length === 1) return `in argument ${ns[0]}`;
  return `in arguments ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/**
 * Does this emitted argument source read as a `vecN` VALUE?
 *
 * Source-level, and deliberately conservative. Once a lowering has folded
 * several operands into NESTED calls (`ElementMax(a, b, c)` →
 * `max(max(a, b), c)`) the CE operand positions no longer line up with the
 * emitted argument positions, so the call tree is all there is to judge. A
 * vector is recognized as an aggregate CONSTRUCTOR, or as a genType-polymorphic
 * builtin call (one carrying scalar-slot rules) over a vector. Everything else
 * — including a bare identifier declared `vector<3>` — reads as a scalar, so an
 * argument list with no recognizable vector is left alone rather than judged on
 * a guess. (The one-for-one case is judged on the CE operand shapes instead,
 * which ARE exact; see `gpuCheckOperandShapes`.)
 */
function gpuSourceIsVector(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): boolean {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return false;
  // An ARRAY of vectors — `vec2[2](…)`, `array<vec2f, 2>(…)`, the lowering
  // of a written list of points — is not a vector value, though its callee
  // starts like one.
  if (GPU_AGGREGATE_CONSTRUCTOR.test(call.callee))
    return !GPU_VECTOR_ARRAY_CONSTRUCTOR.test(call.callee);
  if (!slots.has(call.callee)) return false;
  return call.operands.some((o) => gpuSourceIsVector(o, slots));
}

/**
 * The width of the float vector an emitted argument source CONSTRUCTS, or
 * `undefined` when it constructs none.
 *
 * A lowering may widen a scalar operand ITSELF, writing out the broadcast
 * constructor neither shader language supplies for a genType builtin: `Power`
 * over a `vecN` base and a scalar exponent emits `pow(v, vec3(y))`. The CE
 * operand is still a scalar there, so `gpuCheckOperandShapes` reads the
 * emitted argument to see the shape that actually reaches the call.
 *
 * Deliberately narrow — only a top-level `vecN` / `vecNf` constructor is read.
 * Everything else answers `undefined`, and the gate then keeps the shape the
 * CE operand gives it, so a source this cannot read never weakens a check.
 */
function gpuConstructedVectorWidth(
  code: string | undefined
): 2 | 3 | 4 | undefined {
  if (code === undefined) return undefined;
  const call = gpuTopLevelCall(code);
  if (call === undefined) return undefined;
  const m = /^vec([234])f?$/.exec(call.callee);
  return m === null ? undefined : (Number(m[1]) as 2 | 3 | 4);
}

/**
 * A scalar argument standing where the emitted builtin's overload requires the
 * `vecN` genType, anywhere in the emitted call TREE — or `undefined` when there
 * is none.
 *
 * The counterpart of the one-for-one positional check in
 * `gpuCheckOperandShapes`, for a lowering that does NOT pass its operands
 * through: `ElementMax([1,2,3], [4,5,6], 2)` folds to
 * `max(max(vec3(…), vec3(…)), 2.0)` — valid GLSL — while
 * `ElementMax(2, [1,2,3], [4,5,6])` folds to `max(max(2.0, vec3(…)), vec3(…))`,
 * whose INNER call puts the scalar first, where GLSL's `max(genType, float)`
 * has no overload.
 */
function gpuMisplacedScalarArgument(
  code: string,
  slots: ReadonlyMap<string, ReadonlySet<number>>
): string | undefined {
  const call = gpuTopLevelCall(code);
  if (call === undefined) return undefined;
  const allowed = slots.get(call.callee);
  if (allowed !== undefined) {
    const isVector = call.operands.map((o) => gpuSourceIsVector(o, slots));
    if (isVector.some((v) => v)) {
      const bad = isVector.findIndex((v, i) => !v && !allowed.has(i));
      if (bad >= 0)
        return (
          `the shader builtin \`${call.callee}\` takes a scalar only ` +
          `${gpuSlotNames(allowed)}, but the emitted call \`${code.trim()}\` ` +
          `has a scalar in argument ${bad + 1}, where the overload requires ` +
          `the \`vecN\` genType; the scalar is not promoted to a vector.`
        );
    }
  }
  for (const o of call.operands) {
    const why = gpuMisplacedScalarArgument(o, slots);
    if (why !== undefined) return why;
  }
  return undefined;
}

/**
 * The heads this target lowers with a real-only FUNCTION codegen, beyond the
 * heads that are real-only on every target
 * (`BaseCompiler.REAL_ONLY_BY_DEFINITION`). The shader lowering reads the
 * operand as a `float` and has no complex form for it.
 *
 * A complex value lowers to a `vec2` of (re, im). Given one, these lowerings
 * emit either a call no shader compiler accepts (`_gpu_gamma(vec2(x, y))`:
 * the helper takes a `float`) or a componentwise builtin that computes a
 * different value than the interpreter (`asinh(1.0 / vec2(x, y))` for
 * `Arcsch`, `(1 - cos(vec2(x, y))) / 2` for `Haversine`), behind
 * `success: true`. Several of these heads have a complex lowering on another
 * target: the JavaScript target lowers `Arccot`, `Arcsch` and
 * `InverseHaversine` with a complex form (`_SYS.cacot`, …), and the Python
 * target lowers `Gamma`, `Factorial` and `Erf` with `scipy.special`
 * routines that take a complex argument. `Root` is not listed: a complex
 * radicand lowers through `_gpu_cpow` (see the `Root` lowering). `Variance`
 * has a complex value in the interpreter and on the Python target, but the
 * shader lowering sums `float` values. `Mean` and `StandardDeviation` are not
 * listed: the shader targets have no lowering for them, so they fail closed
 * for every operand.
 */
const GPU_REAL_ONLY_LOWERINGS: ReadonlySet<string> = new Set([
  'Variance',
  'Hypot',
  'Arctan2',
  'Haversine',
  'GammaLn',
  'Beta',
  'Erf',
  'Erfc',
  'ErfInv',
  'Heaviside',
  'Sinc',
  'FresnelC',
  'FresnelS',
  'BesselJ',
  'Arccot',
  'Arcsch',
  'InverseHaversine',
  'Gamma',
  'Factorial',
  'Zeta',
  'HurwitzZeta',
  'LerchPhi',
  'PolyLog',
]);

/** `CompileTarget.isRealOnlyLowering` of the shader targets. The base
 * compiler fails a complex operand of a real-only lowering closed: the
 * shader targets have no run-time realness guard. */
function gpuIsRealOnlyLowering(
  head: string,
  lowering: CompiledFunction<Expression> | undefined
): boolean {
  return (
    BaseCompiler.REAL_ONLY_BY_DEFINITION.has(head) ||
    GPU_REAL_ONLY_LOWERINGS.has(head) ||
    BaseCompiler.stringHelperIsRealOnly(head, lowering)
  );
}

/**
 * Reject a non-scalar operand when the emitted shader cannot accept its shape.
 *
 * The counterpart of `compileGPUBroadcastUnary` for every emission that does
 * not go through the fan-out hook: the generic function-codegen and
 * string-mapped-helper paths, which the base compiler splices directly. Reject
 * mixed generic types, arrays nested in vector constructors, and matrices
 * passed to scalar builtins before reporting success.
 *
 * Decisions are derived from the operands' shapes (`gpuOperandShape`) and
 * from the shape of the emitted source (`gpuTopLevelCall`,
 * `gpuIsComponentwise`), never from a list of head names: a head that changes
 * its lowering is re-judged on the new source. The one exception is DECLARED
 * rather than inferred — a lowering that consumes its aggregate operands
 * (`GPU_AGGREGATE_CONSUMING`) steps the gate aside, because the shapes it was
 * handed are no longer in its emission. A complex operand reads as a scalar
 * here, so no shape test can tell that a real-only lowering received one: the
 * base compiler refuses that case before the lowering runs
 * (`gpuIsRealOnlyLowering`, read through `BaseCompiler.isRealOnlyLowering`).
 */
function gpuCheckOperandShapes(
  head: string,
  args: ReadonlyArray<Expression>,
  code: string,
  rules: GPUShapeRules,
  preambleFor: (code: string) => string,
  lowering?: CompiledFunction<Expression>
): void {
  const shapes = args.map(gpuOperandShape);

  // A lowering that destructured its aggregate operands (`Max`/`Min`, whose
  // reduction folds every collection down to one scalar) has an emission the
  // operand shapes no longer describe. It says so explicitly, at its own
  // definition site; nothing about the shape of its emitted source is read as
  // that claim.
  if (typeof lowering === 'function') {
    const consumes = GPU_AGGREGATE_CONSUMING.get(lowering);
    if (consumes?.(args) === true) return;
  }

  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it: the positional check below reads a rule the preceding
  // `decline` has already ruled out as absent.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`Could not compile \`${head}\`: ${reason}`);
  };

  // A slot with no SCALAR overload at all — the mirror of
  // `mandatoryScalarSlots`, and the only fault an ALL-SCALAR call can have.
  // WGSL declares `refract(e1: vecN<T>, e2: vecN<T>, e3: T)` and no all-scalar
  // form, where GLSL's genType includes `float`, so `Refract(1, 2, 0.5)`
  // emitted `refract(1.0, 2.0, 0.5)` — good GLSL, and source no WebGPU driver
  // accepts. Positional, so it needs the lowering to pass its operands through
  // one for one; and only SCALARS are judged here, because a `matN` or array
  // in such a slot gets a more specific verdict from the branches below.
  const topCall = gpuTopLevelCall(code);
  const declineVectorOnly = (): void => {
    if (topCall === undefined || topCall.argCount !== args.length) return;
    const vectorOnly = rules.vectorOnlySlots.get(topCall.callee);
    if (vectorOnly === undefined) return;
    const bad = shapes.findIndex((s, i) => vectorOnly.has(i) && s === 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${topCall.callee}\` is declared over the ` +
          `\`vecN\` genType ${gpuSlotNames(vectorOnly)} in this language — it ` +
          `has no scalar overload there — but argument ${bad + 1} lowers to a ` +
          `scalar; the scalar is not promoted to a vector.`
      );
  };

  // Nothing but scalars: the overwhelmingly common case, left untouched apart
  // from the vector-only obligations, which are exactly the rule that a call
  // with no non-scalar operand anywhere can still break.
  if (shapes.every((s) => s === 'scalar')) {
    declineVectorOnly();
    return;
  }

  const widths = new Set(
    shapes.filter((s): s is 2 | 3 | 4 => typeof s === 'number')
  );
  const declineWidths = (): void => {
    if (widths.size > 1)
      decline(
        `its operands lower to shader vectors of different widths ` +
          `(${[...widths].map((w) => `vec${w}`).join(', ')}); the ` +
          `componentwise builtins and operators require ONE genType.`
      );
  };
  const hasMatrix = shapes.includes('matrix');
  const hasArray = shapes.includes('array');
  const call = topCall;

  if (call === undefined) {
    // Not a single call: an infix operator emission or a compound lowering
    // lowering (WGSL's `Mod` → `(((a % b) - b * floor((a % b) / b)) % b)`,
    // `Log10` → `log(a) / log(10.0)`). Aggregate-consuming lowerings have already
    // returned above through an explicit capability. Other compound lowerings
    // still need array, matrix, and vector-width checks.
    const sym = GPU_OPERATORS[head]?.[0];
    if (sym === undefined || !/^[-+*/]$/.test(sym)) {
      // An emission that COMBINES nothing constrains nothing: a lowering that
      // passes ONE operand through (`Real(m)` → `m`, `WithRandomSeed(m, s)` →
      // the body) or answers a constant (`Imaginary(x)` → `0.0`) says nothing
      // about the shapes of the operands it did not use, and judging it
      // against all of them is a false decline.
      if (gpuIsAtomicEmission(code)) return;
      // No ONE signature governs a compound emission, but its pieces are the
      // same genType-polymorphic builtins and operators, which require ONE
      // genType across the whole expression and have no `matN` or array
      // reading at all. (A scalar mixed with same-width vectors stays
      // admissible: the arithmetic operators broadcast it in both languages,
      // and a compound lowering is built from those.)
      if (hasArray || hasMatrix)
        decline(
          `the compound shader lowering \`${code}\` is built from the ` +
            `genType-polymorphic builtins and operators, which have no ` +
            `${hasMatrix ? '`matN`' : 'array'} reading, so the operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) have no lowering.`
        );
      declineWidths();
      const packs = gpuReshapesOperands(code);
      if (packs !== undefined)
        decline(
          `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
            `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${packs}`
        );
      return;
    }
    if (hasArray)
      decline(
        `an operand lowers to a shader ARRAY (\`float[N]\` / ` +
          `\`array<f32, N>\`), which has no arithmetic operators — only ` +
          `scalars, \`vecN\` and \`matN\` values do.`
      );
    if (!hasMatrix) {
      declineWidths();
      // A scalar mixed with (same-width) vectors is valid in BOTH languages
      // under every arithmetic operator: GLSL 4.60 §5.9 ("one operand is a
      // scalar, and the other is a vector or matrix"), WGSL §8.7 ("Binary
      // arithmetic expressions with mixed scalar and vector operands", which
      // lists `+ - * / %` in both orders).
      return;
    }

    // A matrix operand enters infix arithmetic only through its NATIVE shader
    // form: the square `matN` (N = 2–4) the `Matrix` lowering emits, or — for
    // an N×1 column `Matrix` literal — the `vecN` it flattens to
    // (`compileGPUMatrix`). Everything else (non-square, 5+ rows, unknown
    // dimensions) lowers to nested arrays, which have no operators. And the
    // DIMENSIONS matter, not just the kind: `mat2 + mat3` and `mat2 * vec3`
    // are as invalid as `vec2 + vec3`.
    const eff: Array<number | 'scalar' | { mat: number }> = [];
    for (let i = 0; i < shapes.length; i++) {
      const s = shapes[i];
      if (s !== 'matrix') {
        eff.push(s as number | 'scalar');
        continue;
      }
      const dims = gpuMatrixDims(args[i]);
      if (
        dims !== undefined &&
        dims[1] === 1 &&
        dims[0] >= 2 &&
        dims[0] <= 4 &&
        isFunction(args[i], 'Matrix')
      ) {
        eff.push(dims[0]);
        continue;
      }
      if (
        dims === undefined ||
        dims[0] !== dims[1] ||
        dims[0] < 2 ||
        dims[0] > 4
      )
        decline(
          `its operand \`${args[i].toString()}\` lowers to a matrix with no ` +
            `native square \`matN\` (N = 2–4) shader type` +
            (dims !== undefined
              ? ` (its dimensions are ${dims[0]}×${dims[1]})`
              : ` (its dimensions are not statically known)`) +
            `, so the shader operator \`${sym}\` has no overload for it.`
        );
      eff.push({ mat: dims[0] });
    }
    const effName = (e: number | 'scalar' | { mat: number }): string =>
      typeof e === 'number' ? `vec${e}` : e === 'scalar' ? e : `mat${e.mat}`;
    const shapeList = `(${eff.map(effName).join(', ')})`;
    // The single size every non-scalar operand must share: with only SQUARE
    // native matrices, the componentwise same-genType rule, the matrix
    // same-dimensions rule and the `*` inner-dimension rule (`matCxR * vecC`,
    // `vecR * matCxR`, `matKxR * matCxK`) all collapse to one size.
    const sizes = new Set<number>(
      eff.flatMap((e) =>
        e === 'scalar' ? [] : [typeof e === 'number' ? e : e.mat]
      )
    );
    if (!eff.some((e) => typeof e === 'object')) {
      // Every matrix was an N×1 column literal: plain vector arithmetic.
      if (sizes.size > 1)
        decline(
          `its operands lower to shader vectors of different widths ` +
            `${shapeList}; the componentwise operators require ONE genType.`
        );
      return;
    }
    if (args.length === 1) {
      // Unary negation of a matrix — the one arity where the two languages
      // split on the KIND itself (see `GPUShapeRules.matrixNegate`).
      if (!rules.matrixNegate)
        decline(
          `the shader unary \`-\` is declared over scalars and \`vecN\` ` +
            `only in this language; it has no overload for the ` +
            `${effName(eff[0])} operand.`
        );
      return;
    }
    if (sym !== '*') {
      if (eff.some((e) => typeof e === 'number'))
        decline(
          `a \`matN\` and a \`vecN\` operand combine only under \`*\` ` +
            `(matrix-vector product), not \`${sym}\`.`
        );
      if (
        !rules.matrixArithmetic(
          sym,
          eff.every((e) => typeof e === 'object')
        )
      )
        decline(
          `the shader operator \`${sym}\` has no overload for the operand ` +
            `shapes ${shapeList}.`
        );
      if (sizes.size > 1)
        decline(
          `the componentwise \`${sym}\` requires matrices of the SAME ` +
            `dimensions, but the operand shapes are ${shapeList}.`
        );
      return;
    }
    // `*`: matrix-scalar scaling and the linear-algebraic products. The inner
    // dimensions must agree; with square `matN` types that is ONE size across
    // every non-scalar operand.
    if (sizes.size > 1)
      decline(
        `under \`*\` the matrix and vector dimensions must agree ` +
          `(\`matCxR * vecC\`, \`matKxR * matCxK\`), but the operand shapes ` +
          `${shapeList} do not.`
      );
    return;
  }

  const { callee, argCount } = call;

  // An aggregate constructor BUILDS a shape from its operands (`List`,
  // `Tuple`, `Matrix`); its own guards own that check.
  if (GPU_AGGREGATE_CONSTRUCTOR.test(callee)) return;

  // A preamble helper. The aggregate-aware ones (complex arithmetic, colour
  // conversion) own their operand shapes, so the gate steps aside; a
  // scalar-only one cannot take an aggregate — unless the lowering DESTRUCTURED
  // the collection into one scalar argument per element (`Median` →
  // `_gpu_median_5(…)`), which the argument count reveals.
  if (callee.startsWith('_gpu_')) {
    if (argCount !== args.length) return;
    // `${callee}(` — a synthetic CALL SITE, not the bare name. Every
    // `preambleFor` scan that generates a helper on demand (the `_gpu_atN`
    // positional accessors, the `_gpu_powiN` integer powers) is anchored on a
    // call parenthesis, so that a user symbol which merely SPELLS a helper
    // name cannot make the target declare one. A bare name reaches none of
    // those scans, and the gate would then judge a generated helper against
    // an empty preamble.
    if (!gpuHelperIsScalarOnly(callee, preambleFor(`${callee}(`))) return;
    const why = gpuIsComponentwise(code);
    if (why !== undefined)
      decline(
        `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
          `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${why}`
      );
    return;
  }

  if (hasMatrix || hasArray)
    decline(
      `the shader builtin \`${callee}\` is declared over scalar and \`vecN\` ` +
        `genTypes; it has no ${hasMatrix ? '`matN`' : 'array'} overload, so ` +
        `the operand shapes (${shapes.map(gpuShapeName).join(', ')}) have no ` +
        `lowering.`
    );
  declineWidths();
  const reshapes = gpuReshapesOperands(code);
  if (reshapes !== undefined)
    decline(
      `the shader lowering \`${code}\` cannot take the non-scalar operand ` +
        `shapes (${shapes.map(gpuShapeName).join(', ')}) — ${reshapes}`
    );
  // The shapes as they REACH the emitted call. A lowering is allowed to widen
  // a scalar operand itself, by writing out the broadcast constructor neither
  // language supplies (`Power` over a `vecN` base and a scalar exponent emits
  // `pow(v, vec3(y))`); the CE operand stays a scalar, but the argument that
  // stands in the call is a vector, so the mixed-genType checks below would
  // otherwise decline valid source. Only an UPGRADE is taken from the emitted
  // argument, and only where the lowering passes its operands through one for
  // one — a source that constructs no vector keeps its CE shape, so nothing
  // here can weaken a check.
  const emitted = shapes.map((s, i) => {
    if (s !== 'scalar' || argCount !== args.length) return s;
    return gpuConstructedVectorWidth(call.operands[i]) ?? s;
  });
  if (widths.size === 1 && emitted.includes('scalar')) {
    const slots = rules.scalarGenTypeSlots.get(callee);
    if (slots === undefined)
      decline(
        `the shader builtin \`${callee}\` requires MATCHING genType ` +
          `arguments, but it is applied to a vec${[...widths][0]} operand and ` +
          `a scalar one; the scalar is not promoted to a vector.`
      );
    // The overload says WHERE a scalar may stand, not merely that one may:
    // `mod(genType, float)` admits it only LAST, `step(float, genType)` only
    // FIRST, `mix(genType, genType, float)` only third. When the lowering
    // passes its operands through ONE FOR ONE the CE operand shapes give the
    // positions exactly — including for an operand with no constructor in its
    // source (a symbol declared `vector<3>`).
    if (argCount === args.length) {
      const bad = emitted.findIndex((s, i) => s === 'scalar' && !slots.has(i));
      if (bad >= 0)
        decline(
          `the shader builtin \`${callee}\` takes a scalar only ` +
            `${gpuSlotNames(slots)}, but here the scalar stands in argument ` +
            `${bad + 1}, where the overload requires the vec${
              [...widths][0]
            } genType; the scalar is not promoted to a vector.`
        );
    }
    // A lowering that does NOT pass its operands through (the variadic
    // `min`/`max` fold) is judged on the emitted call TREE, where each nested
    // call has its own argument positions.
    const misplaced = gpuMisplacedScalarArgument(
      code,
      rules.scalarGenTypeSlots
    );
    if (misplaced !== undefined) decline(misplaced);
  }
  // The OBLIGATIONS, last: a slot that must be scalar is violated by a `vecN`
  // standing in it, so — unlike everything above — this check does not depend
  // on a scalar being present anywhere, and is the only one an all-vector call
  // can fail. `refract(vec3, vec3, vec3)` is not a signature either language
  // declares, but the permission table above is consulted only once
  // `shapes.includes('scalar')`.
  // Positional, so it needs the lowering to pass its operands through one for
  // one; and reported after the permission verdict, which names the more
  // specific fault when a scalar is ALSO misplaced.
  const mandatory = rules.mandatoryScalarSlots.get(callee);
  if (mandatory !== undefined && argCount === args.length) {
    const bad = shapes.findIndex((s, i) => mandatory.has(i) && s !== 'scalar');
    if (bad >= 0)
      decline(
        `the shader builtin \`${callee}\` requires a SCALAR ` +
          `${gpuSlotNames(mandatory)} — that argument is not ` +
          `genType-polymorphic, so there is no overload with a ` +
          `${gpuShapeName(shapes[bad])} standing there — but argument ` +
          `${bad + 1} lowers to a ${gpuShapeName(shapes[bad])}.`
      );
  }
  // And the mirror obligation, for a scalar the checks above left standing (a
  // builtin whose permission table admits a scalar in a slot the language
  // nonetheless declares `vecN`). Defensive: with today's tables every mixed
  // scalar/`vecN` call already declines above, and the ALL-SCALAR calls — the
  // ones this rule exists for — returned before reaching here.
  declineVectorOnly();
}

/**
 * Fold a variadic application of a 2-argument shader builtin (`min`/`max`)
 * into a left-nested tree of 2-argument calls: `max(max(a, b), c)`. GLSL and
 * WGSL do not accept a 3+-argument `min`/`max`, so emitting `max(a, b, c)`
 * would be invalid shader source.
 *
 * Each GENERATED call is validated as it is produced, against the ORIGINAL
 * operand shapes (`gpuOperandShape`) rather than against the emitted source:
 * once the fold has nested the calls, the CE operand positions no longer line
 * up with the emitted argument positions, and the generic gate's source-level
 * reconstruction (`gpuSourceIsVector`) cannot see a vector in a BARE
 * IDENTIFIER at all — so `ElementMax(2, v, w)` over two declared `vector<3>`
 * symbols emitted `max(max(2.0, v), w)`, which no GLSL driver accepts, behind
 * `success: true`. The accumulator's shape is exact by construction: it is a
 * vector as soon as any operand folded into it is one.
 *
 * With TWO operands the emission passes them through ONE FOR ONE, so the
 * generic gate already judges it on the same exact shapes (and phrases the
 * diagnostic in its own positional terms); only the nested calls of a longer
 * fold need the shapes carried in here.
 */
function foldNaryBuiltin(
  name: string,
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  rules: GPUShapeRules | undefined
): string {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${name}\`: needs at least one argument`
    );
  if (args.length === 1) return compile(args[0]);
  const shapes = args.map(gpuOperandShape);
  const slots = rules?.scalarGenTypeSlots.get(name);
  // A builtin the language gives no scalar/genType overload AT ALL is judged
  // exactly by the generic gate already (it compares the CE operand shapes, not
  // the source, to reach its `requires MATCHING genType` verdict), so the fold
  // leaves that case — and the one-for-one two-operand case — to it.
  const check = slots !== undefined && args.length > 2;
  let acc = `${name}(${compile(args[0])}, ${compile(args[1])})`;
  let accShape = shapes[0];
  for (let i = 1; i < args.length; i++) {
    if (i > 1) acc = `${name}(${acc}, ${compile(args[i])})`;
    if (check) {
      const pair = [accShape, shapes[i]];
      const bad = pair.findIndex(
        (s, k) => s === 'scalar' && !slots!.has(k) && pair[1 - k] !== 'scalar'
      );
      if (bad >= 0)
        throw new Error(
          `Could not compile \`${head}\`: the shader builtin \`${name}\` takes a scalar only ` +
            `${gpuSlotNames(slots!)}, but the emitted call \`${acc}\` has a ` +
            `scalar in argument ${bad + 1}, where the overload requires the ` +
            `\`vecN\` genType; the scalar is not promoted to a vector.`
        );
    }
    // The accumulator is a vector as soon as any operand folded into it is.
    if (accShape === 'scalar') accShape = shapes[i];
  }
  return acc;
}

/**
 * The SCALAR component sources of a NON-SCALAR operand, or `undefined` when it
 * has none — what a shader reduction needs in order to consume a collection.
 *
 * Two routes, both derived from the emitted source and from the shape helpers
 * the rest of this file already uses, never from a list of head names:
 *
 *  - the operand lowers to an aggregate CONSTRUCTOR (`vec3(1.0, 2.0, 3.0)`,
 *    `float[5](…)`, `array<f32, 5>(…)`) — a `List`/`Tuple`/`Range` literal, and
 *    any other head that builds one. Its top-level arguments ARE the
 *    components. (`assertGPUScalarComponents` already guarantees a vector
 *    constructor's arguments are scalars; an argument that is itself an
 *    aggregate — a `matN`'s `vecN` columns — is refused here rather than folded
 *    into nonsense.)
 *  - the operand has a static `vec2`–`vec4` shape but no constructor to read (a
 *    declared `vector<3>` symbol, an expression over one): reduce over its
 *    swizzles. That repeats the operand's source once per component, so it is
 *    used verbatim only for a BARE identifier; anything compound is bound to a
 *    hoisted temporary first, and where there is no statement sink (inside a
 *    conditional arm — see `compileGPUConditionalArm`) there is no safe reading
 *    and this declines. Repeating a compound source is not merely slow:
 *    `_gpu_rnd_draw` advances a runtime counter, so a repeated draw shifts
 *    every later value in the shader.
 *
 * A matrix, or an array of unknown/runtime length, has no compile-time
 * component list at all, and a shader has no dynamic iteration to fall back on.
 */
function gpuScalarComponents(
  expr: Expression,
  code: string,
  target: CompileTarget<Expression>
): string[] | undefined {
  const call = gpuTopLevelCall(code);
  if (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)) {
    if (call.operands.some((o) => GPU_AGGREGATE_CONSTRUCTOR_ANYWHERE.test(o)))
      return undefined;
    return call.operands.length > 0 ? call.operands : undefined;
  }
  const width = gpuOperandShape(expr);
  if (typeof width !== 'number') return undefined;
  const comps = ['x', 'y', 'z', 'w'].slice(0, width);
  if (/^[A-Za-z_]\w*$/.test(code)) return comps.map((c) => `${code}.${c}`);
  if (!BaseCompiler.canHoist(target)) return undefined;
  const tv = BaseCompiler.tempVar(target);
  const type = target.language === 'wgsl' ? `vec${width}f` : `vec${width}`;
  const decl =
    target.language === 'wgsl' ? `var ${tv}: ${type}` : `${type} ${tv}`;
  BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
  return comps.map((c) => `${tv}.${c}`);
}

/**
 * Compile `Max`/`Min` as scalar reductions. Shader `max`/`min` builtins are
 * componentwise, so collection operands must first be expanded into their
 * statically known scalar components. Each operand is compiled once, empty
 * collections contribute no components, and an all-empty reduction yields
 * NaN. `markAggregateConsuming` tells the generic shape gate that the original
 * aggregate shapes are absent from the emitted expression.
 */
function compileGPUExtremum(
  name: 'max' | 'min',
  head: string,
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (args.length === 0)
    throw new Error(
      `Could not compile \`${head}\`: needs at least one argument`
    );
  const shapes = args.map(gpuOperandShape);
  // An EMPTY collection contributes nothing to the fold. Recognized BEFORE the
  // operand is compiled: `[]` lowers to `float[0]()` / `array<f32, 0>()`, which
  // `assertGPUScalarComponents` refuses outright, so compiling it first would
  // decline the whole reduction.
  const isEmpty = args.map((a) => a.isCollection && a.count === 0);
  // Each operand is compiled EXACTLY ONCE: a second `compile()` of the same
  // operand would re-advance the `_gpu_rnd_draw` counter.
  const codes = args.map((a, i) => (isEmpty[i] ? '' : compile(a)));
  // Non-scalar by the shape analysis, OR by the emitted source: a `Range` types
  // only as `indexed_collection` (no `list` dimensions), which
  // `gpuOperandShape` reads as a scalar, but it lowers to an array
  // CONSTRUCTOR — and a constructor is exactly what a reduction can consume.
  const isAggregate = codes.map((c, i) => {
    if (isEmpty[i]) return true;
    if (shapes[i] !== 'scalar') return true;
    const call = gpuTopLevelCall(c);
    return call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee);
  });
  const fold = (parts: ReadonlyArray<string>): string => {
    let acc = parts[0];
    for (let i = 1; i < parts.length; i++) acc = `${name}(${acc}, ${parts[i]})`;
    return acc;
  };
  // Every operand a scalar: the componentwise variadic fold, byte-identical to
  // what `foldNaryBuiltin` emitted. With ONE operand the fold emits no call at
  // all — the lowering is the operand's own code — so it is parenthesized on
  // the identity-passthrough rule (see `gpuParenthesizeIdentity`): `2·max(x +
  // 1)` emitted `2.0 * x + 1.0`, which is `2x + 1`.
  if (!isAggregate.some((x) => x))
    return codes.length === 1
      ? gpuParenthesizeIdentity(args[0], codes[0], target)
      : fold(codes);

  const parts: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (isEmpty[i]) continue;
    if (!isAggregate[i]) {
      parts.push(codes[i]);
      continue;
    }
    const comps = gpuScalarComponents(args[i], codes[i], target);
    if (comps === undefined)
      throw new Error(
        `Could not compile \`${head}\`: the operand \`${args[i].toString()}\` lowers to a shader ` +
          `${gpuShapeName(shapes[i])} with no compile-time component list, so ` +
          `there is nothing for the reduction to fold over — a shader has no ` +
          `dynamic iteration here, and the \`${name}\` builtin is ` +
          `componentwise, not a reduction.`
      );
    parts.push(...comps);
  }
  // Nothing left to fold — every operand was an empty collection. The
  // interpreter and the JavaScript target both answer NaN here (an empty
  // reduction has no extremum), and the shader NaN is reachable for a literal.
  if (parts.length === 0) return `(${gpuNaN(target)})`;
  return `(${fold(parts)})`;
}

/**
 * True when a `PointList` component is a *source* — a zip participant rather
 * than a per-point scalar slot: an `indexed_collection` type that is neither a
 * tuple nor a union. THE shared source predicate on the compile route, the same
 * one the JavaScript zip lowering uses. Kept local (not imported) for the
 * module-init reordering hazard.
 *
 * DELIBERATE DIVERGENCE from the `PointList` TYPE handler's `isListType`
 * (`library/collections.ts`): that predicate reads a bare `tuple` and a union
 * whose members all match `indexed_collection` (`list<number> |
 * tuple<number, number>`) as sources. Narrowing it there is
 * interpreter-visible, so the compile route narrows on its own: both shapes are
 * declined here (their per-point value is not statically known), matching the
 * spec's Shared-predicate table.
 */
function isPointListSource(e: Expression): boolean {
  const t = gpuType(e);
  // `'tuple'` (the bare, unparameterized name) is a plain string, not a
  // `{ kind: 'tuple' }` node — both spellings are a single point.
  if (t === 'tuple') return false;
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'union'))
    return false;
  return e.type.matches('indexed_collection<any>');
}

/**
 * Project one coordinate of a symbolic `PointList` as a `vecN`. Shader targets
 * cannot represent a runtime-length point list as an expression, but a
 * projection with a statically known width is an ordinary vector.
 *
 * Returns the emitted code or a specific decline reason. Every admissibility
 * condition must hold:
 * - the coordinate index is within the point arity (`PointZ` on a 2-arity
 *   `PointList` stays declined);
 * - at least one component is a source, and EVERY source has a statically
 *   known vec-emittable length 2–4 (a literal `List`, or a declared
 *   `vector<N>`); an unknown length would be asserting a shape we do not know;
 * - every non-source slot is provably scalar numeric (`vecW(<aggregate>)` is
 *   invalid or wrong);
 * - every NON-SELECTED component is pure — projection never evaluates them,
 *   and discarding an effectful operand (`Random()`) would break the
 *   evaluate-once contract.
 *
 * The emitted width is the shortest source length (statically evaluated
 * shortest-zip); a longer source is swizzle-truncated (`(v).xy`), a scalar slot
 * broadcasts as `vecW(slot)` (`vecWf` on WGSL).
 */
function compilePointListProjection(
  arg: Expression,
  k: number,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string | { decline: string } {
  if (!isFunction(arg, 'PointList'))
    return {
      decline:
        `the operand is not a symbolic \`PointList\` application, and only ` +
        `that shape has a statically known point count`,
    };
  const ops = arg.ops;
  if (k >= ops.length)
    return {
      decline:
        `the points have arity ${ops.length}, so there is no coordinate ` +
        `${k + 1}`,
    };

  let width: number | undefined = undefined;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (isPointListSource(op)) {
      const n = BaseCompiler.aggregateComponentCount(op);
      // Unknown length, or a length with no `vecN`: decline.
      if (n === undefined)
        return {
          decline:
            `source component ${i + 1} (type \`${op.type.toString()}\`) has ` +
            `no statically known length, and a shader vector must have one`,
        };
      if (n < 2 || n > 4)
        return {
          decline:
            `source component ${i + 1} has ${n} elements, and a shader ` +
            `vector holds 2 to 4`,
        };
      width = width === undefined ? n : Math.min(width, n);
    } else if (!isSubtype(gpuType(op), 'number')) {
      // A non-source slot must be provably scalar numeric.
      return {
        decline:
          `component ${i + 1} (type \`${op.type.toString()}\`) is neither a ` +
          `list source nor a provably scalar numeric slot, so it has no ` +
          `\`vecN\` broadcast`,
      };
    }
  }
  if (width === undefined)
    return {
      decline: 'no component is a list source, so this is not a point LIST',
    };

  // Every discarded component must be pure: the projection never evaluates it.
  for (let i = 0; i < ops.length; i++)
    if (i !== k && !ops[i].isPure)
      return {
        decline:
          `component ${i + 1} is impure, and the projection would discard it ` +
          `unevaluated`,
      };

  const slot = ops[k];
  if (!isPointListSource(slot)) {
    const ctor = target.language === 'wgsl' ? `vec${width}f` : `vec${width}`;
    return `${ctor}(${compile(slot)})`;
  }
  const n = BaseCompiler.aggregateComponentCount(slot)!;
  const code = compile(slot);
  if (n === width) return code;
  // Swizzle-truncate to the shortest source. A bare identifier takes the
  // suffix directly (`v.xy`), which keeps the emission ATOMIC for the shape
  // gate; anything else is parenthesized and is judged as the compound
  // emission it is.
  const sw = 'xyzw'.slice(0, width);
  return gpuIsAtomicEmission(code) ? `${code}.${sw}` : `(${code}).${sw}`;
}

/**
 * Compile `Last` as a GPU swizzle. Unlike `First`/`Second`/`Third`, whose
 * component is fixed, the component of `Last` depends on the width of the
 * operand, so the width must be known statically: a `tuple` of 2 to 4 scalar
 * numbers, or a list of 2 to 4 scalar numbers (the two spellings that lower
 * to a `vec2`/`vec3`/`vec4`). The last component of a `vecN` is `.y`, `.z`
 * or `.w`.
 *
 * An absent operand (`Missing`, `Undefined`) compiles to the SCALAR NaN of
 * the target and has no static width. Every component of an absent value is
 * NaN, so its last component is that NaN, as `First` of an absent operand is
 * (see `gpuSwizzle`). Any other operand has no GPU lowering: a longer list
 * compiles to an array, not a vector, and has no swizzle.
 */
function compileGpuLast(
  arg: Expression,
  compile: (e: Expression) => string
): string {
  const code = compile(arg).trim();
  if (code === gpuNonFiniteLiteral(NaN)) return code;
  const t = gpuType(arg);
  const width =
    typeof t !== 'string'
      ? t.kind === 'tuple'
        ? t.elements.every((el) => isSubtype(el.type, 'number'))
          ? t.elements.length
          : undefined
        : t.kind === 'list' &&
            t.dimensions?.length === 1 &&
            t.elements !== undefined &&
            isSubtype(t.elements, 'number')
          ? t.dimensions[0]
          : undefined
      : undefined;
  if (width !== undefined && width >= 2 && width <= 4)
    return gpuSwizzle(code, 'xyzw'[width - 1]);
  throw new Error(
    'Could not compile `Last`: the operand must be a point or a list of 2 to 4 ' +
      'numbers of known length (a `vec2`/`vec3`/`vec4`).'
  );
}

/**
 * Compile a point-coordinate accessor (`PointX`/`PointY`/`PointZ`) as a GPU
 * swizzle. A single point is a `vec2`/`vec3`/`vec4`, so `.x`/`.y`/`.z` is
 * valid. A *list* of points is not a GPU value — a swizzle on it is invalid
 * shader source, so a list-of-points operand fails closed rather than
 * silently emitting garbage; the one exception is a symbolic `PointList`
 * application, whose coordinate IS a `vecN` (`compilePointListProjection`). A
 * tuple type also matches `indexed_collection`, so the single-point case is
 * checked first.
 */
function compilePointSwizzle(
  arg: Expression,
  comp: 'x' | 'y' | 'z',
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const t = gpuType(arg);
  const idx = comp === 'x' ? 0 : comp === 'y' ? 1 : 2;
  // The two spellings of a SINGLE point, each stating its own arity: a tuple,
  // and the flat numeric list a data import produces. `[3, 4]` lowers to
  // `vec2(3.0, 4.0)` here — a genuine `vecN`, so `.x` is a valid swizzle on it
  // — and the interpreter likewise reads such a list as one point rather than
  // a list of points (`PointX([3,4])` is `3`). Treating every indexed
  // collection as a point LIST declined it, so the flat spelling could not
  // reach a shader while the tuple spelling compiled.
  //
  // Width is bounded at 4 and the elements must be scalar numbers: a longer or
  // nested list is an array or a matrix, which has no swizzle.
  const pointArity =
    typeof t !== 'string'
      ? t.kind === 'tuple'
        ? t.elements.length
        : t.kind === 'list' &&
            t.dimensions?.length === 1 &&
            t.dimensions[0] >= 2 &&
            t.dimensions[0] <= 4 &&
            t.elements !== undefined &&
            isSubtype(t.elements, 'number')
          ? t.dimensions[0]
          : undefined
      : undefined;

  if (pointArity === undefined && arg.type.matches('indexed_collection<any>')) {
    const projected = compilePointListProjection(arg, idx, compile, target);
    if (typeof projected === 'string') return projected;
    throw new Error(
      `Could not compile \`Point${comp.toUpperCase()}\`: a list of points has no GPU lowering ` +
        `(a point must be a single vec2/vec3/vec4): ${projected.decline}.`
    );
  }
  // A stated point arity makes an out-of-range coordinate a static error:
  // `p.z` on a `vec2` is invalid shader source. Symmetric with the list
  // route's arity decline in `compilePointListProjection`. An unparameterized
  // `tuple` states no arity and keeps the emission.
  if (pointArity !== undefined && pointArity <= idx)
    throw new Error(
      `Could not compile \`Point${comp.toUpperCase()}\`: the point has arity ${pointArity} ` +
        `— no ${['first', 'second', 'third'][idx]} coordinate.`
    );
  return gpuSwizzle(compile(arg), comp);
}

/**
 * Append the swizzle `sw` to the emission `code` so that it selects from the
 * WHOLE value. A postfix swizzle binds tighter than every infix and prefix
 * operator, so a single primary — an identifier, a literal, or ONE function
 * call whose parentheses close at the end (`vec2(x, y)`) — takes the suffix
 * directly, and anything else is parenthesized first. Splicing the suffix
 * onto an infix emission bound it to the LAST term alone:
 * `PointX((x, y) + (1, 2))` emitted `vec2(x, y) + vec2(1.0, 2.0).x`, legal
 * shader source (a float broadcasts into a `vec2`) that computes
 * `(x + 1, y + 1)` behind `success: true` (Tycho item 242).
 */
function gpuSwizzle(code: string, sw: string): string {
  const s = code.trim();
  // An absent operand (`Missing`, `Undefined`) compiles to the SCALAR NaN of
  // the target (`_gpu_nan()`, on both targets). A scalar has no components:
  // WGSL rejects `.x` on an `f32`, and GLSL before 4.20 rejects it on a
  // `float`. Every coordinate of an absent point is NaN, so one component of
  // that NaN is the NaN itself, and several components are a vector of it.
  // `vecN(x)` is a splat in both languages (WGSL infers the element type).
  if (s === gpuNonFiniteLiteral(NaN)) {
    if (sw.length === 1) return s;
    return `vec${sw.length}(${s})`;
  }
  if (gpuIsAtomicEmission(s)) return `${s}.${sw}`;
  const call = /^[A-Za-z_]\w*\(/.exec(s);
  if (call !== null && s.endsWith(')')) {
    // One call is a primary only when the parenthesis opened by its name is
    // the one closed by the final character: `f(a) + g(b)` also starts with
    // a call and ends with `)`.
    let depth = 0;
    let single = true;
    for (let i = call[0].length - 1; i < s.length; i++) {
      if (s[i] === '(') depth += 1;
      else if (s[i] === ')') {
        depth -= 1;
        if (depth === 0 && i !== s.length - 1) {
          single = false;
          break;
        }
      }
    }
    if (single) return `${s}.${sw}`;
  }
  return `(${s}).${sw}`;
}

// ---------------------------------------------------------------------------
// `At` — positional access on a shader target.
//
// CE's `At` is 1-based, counts a negative index from the end, and yields the
// position-preserving absence marker for `0`, an out-of-range index or a
// non-integer one; a non-numeric index leaves `At` unevaluated (no value at
// all). The NUMERIC-TARGET PROJECTION of both outcomes is `NaN` (`_SYS.at`,
// the parity oracle), and the shader lowering targets that projection — never
// the raw interpreter output.
//
// Admissible only against a base whose element COUNT is static and whose
// elements are provably scalar numeric: a shader value has a shape, and a
// runtime-length list has none. Every other shape returns a specific reason.
//
// Point-list bases are handled by coordinate projection instead. `At(PL, k)`
// has type `missing | tuple`, so the object-domain absence gate intercepts it
// before this target function can run.
// ---------------------------------------------------------------------------

/** The static element count of an `At` base, or why it has no shader shape. */
type GPUAtBase =
  | {
      count: number;
      /**
       * Set when the base is a free symbol the caller's `storage` hint places
       * in shader storage of this kind: the read then lowers to a fetch from
       * that storage rather than to a subscript of a shader value.
       */
      storage?: StorageKind;
    }
  | { decline: string };

/**
 * Is every element of `base` provably a SCALAR NUMERIC value? Returns the
 * decline reason when not.
 *
 * Structural for a literal `List`/`Tuple` (the element expressions are right
 * there), type-based otherwise. A non-numeric element has no `float` reading,
 * and an aggregate one (a complex value, a nested tuple) is not a component of
 * the `vecN`/`float[N]` the base lowers to — indexing either would emit source
 * a driver rejects.
 *
 * The type-based readings ask `gpuIsVectorComponentType`, the same predicate
 * `gpuDeclaredComponentCount` uses, NOT "is it a number?": `complex` is a
 * number and lowers to a `vec2`, so a `tuple<complex, complex, complex>` base
 * emitted `tc.x` — a driver-rejected component of a component — behind a
 * reported success.
 */
function gpuAtNonScalarElement(base: Expression): string | undefined {
  if (isFunction(base, 'List') || isFunction(base, 'Tuple')) {
    const ops = base.ops!;
    for (let i = 0; i < ops.length; i++) {
      if (BaseCompiler.isNonScalarShape(ops[i]))
        return (
          `element ${i + 1} of the base is itself an aggregate ` +
          `(type \`${ops[i].type.toString()}\`), so it is not one component ` +
          `of a shader vector`
        );
      if (!isSubtype(gpuType(ops[i]), 'number'))
        return (
          `element ${i + 1} of the base (type \`${ops[i].type.toString()}\`) ` +
          `is not provably scalar numeric, and a shader value has no other ` +
          `element domain here`
        );
    }
    return undefined;
  }
  const t = gpuType(base);
  if (typeof t !== 'string') {
    if (t.kind === 'tuple') {
      for (let i = 0; i < t.elements.length; i++)
        if (!gpuIsVectorComponentType(t.elements[i].type))
          return (
            `slot ${i + 1} of the base tuple (type ` +
            `\`${typeToString(t.elements[i].type)}\`) is not a REAL scalar — ` +
            `a shader vector's components are single floats, and a shader ` +
            `value has no other element domain here`
          );
      return undefined;
    }
    if (t.kind === 'list') {
      if (!gpuIsVectorComponentType(t.elements))
        return (
          `the base's element type \`${typeToString(t.elements)}\` is not a ` +
          `REAL scalar — a shader vector's components are single floats, and ` +
          `a shader value has no other element domain here`
        );
      return undefined;
    }
  }
  return (
    `the base (type \`${base.type.toString()}\`) states no element type, so ` +
    `its elements are not provably scalar numeric`
  );
}

/**
 * The GPU DECLARATION FRAME's reading of the elements of a base whose
 * component count that frame supplied: `undefined` when they are shader
 * floats, the decline reason when they are not, and `'unframed'` when no frame
 * decides the name — in which case the boxed type is the only reading there
 * is (`gpuAtNonScalarElement`).
 *
 * A `compileShader` input and a `compileFunction` parameter are undeclared
 * ENGINE symbols: nothing but the caller's declaration carries their shader
 * type (`gpuTypeOfValue` asks the frame FIRST for exactly this reason), and
 * `aggregateComponentCount` already reads their WIDTH off the frame. Judging
 * their elements by the boxed type instead declined every such base — the
 * census witness's own shape.
 */
function gpuAtFramedBaseElements(
  base: Expression
): string | undefined | 'unframed' {
  if (!isSymbol(base)) return 'unframed';
  if (BaseCompiler.localShapeFrameOf(base.symbol) === undefined)
    return 'unframed';
  const declared = gpuDeclaredTypeOf(base);
  // A `Block` local's width was inferred from the value bound to it, whose
  // components are already shader floats; only a CALLER-declared spelling can
  // name a non-float component type (`ivec3`, `bvec2`).
  if (declared?.value !== undefined && declared.value.element !== 'f')
    return (
      `the base is declared "${declared.spelling}" by the caller, whose ` +
      `components are not floats — a positional shader access reads one ` +
      `float component, and neither language converts between the component ` +
      `types`
    );
  return undefined;
}

/**
 * How the GPU DECLARATION FRAME reads a scalar index: `undefined` when it is
 * (or passes for) a shader float, `{ cast: true }` when it is an INTEGER that
 * must be converted before it reaches the helper's `float` parameter, and a
 * decline reason when it is no index at all.
 *
 * The same blind spot as `gpuAtFramedBaseElements`, on the other operand: a
 * caller-declared name's boxed type is `unknown`, which the
 * unknown-as-numeric-parameter rule reads as a float — so a `bool` or `i32`
 * shader input sailed into `_gpu_atN(v, i)` as a shader type error behind a
 * reported success.
 */
function gpuAtFramedIndex(
  index: Expression
): { decline: string } | { cast: true } | undefined {
  const declared = gpuDeclaredTypeOf(index);
  if (declared === undefined) {
    // A name framed `bool` by a synthesized user-function signature carries
    // its boolean-ness nowhere else either (`BaseCompiler.LOCAL_BOOLEAN`).
    if (isSymbol(index) && BaseCompiler.isLocalBoolean(index.symbol))
      return {
        decline:
          'the index is a shader `bool`, and a positional access indexes by ' +
          'a number — neither language converts a boolean to one',
      };
    // A name whose WIDTH lives in the shape frame and nowhere else: a `Block`
    // local bound to a vector, or a parameter of a SYNTHESIZED user-function
    // signature (only a caller-declared frame registers a type alongside the
    // width). Its boxed type is `unknown`, which the
    // unknown-as-numeric-parameter rule reads as a float — so an
    // aggregate-valued one sailed into `_gpu_atN(v, p)` as a shader type error
    // behind a reported success, the same fail-open the `bool` channel closes.
    if (isSymbol(index) && BaseCompiler.localShapeFrameOf(index.symbol)) {
      const width = BaseCompiler.aggregateComponentCount(index);
      if (width !== undefined)
        return {
          decline:
            `the index is the local name "${index.symbol}", which holds an ` +
            `aggregate of ${width} components, not a scalar number — a ` +
            `positional shader access indexes by a float, and neither ` +
            `language converts an aggregate to one`,
        };
    }
    return undefined;
  }
  const v = declared.value;
  if (v === undefined || v.width > 1 || v.element === 'b')
    return {
      decline:
        `the index is declared "${declared.spelling}" by the caller, which ` +
        `is not a scalar number — a positional shader access indexes by a ` +
        `float, and neither language converts to one implicitly`,
    };
  // An integer-declared scalar is already referenced through a float
  // conversion (`gpuDeclaredBodyTarget`), so it passes for a float here; the
  // `cast` arm is kept for any future declared spelling that binds bare.
  return v.element === 'f' || gpuDeclaredIsIntegerScalar(v)
    ? undefined
    : { cast: true };
}

/**
 * The static element count of a sampler-backed `At` base (a free symbol the
 * caller's `storage` hint places in a texture), or a DISCRIMINATED decline
 * reason naming the storage kind — a consumer that picks a fallback lane by
 * reading decline reasons must be able to tell a texture that could not be
 * read from an array that could not.
 *
 * Only the LENGTH is needed from the type, and it must be static: the
 * generated helper bounds the index by the list's declared length, which is
 * what makes an out-of-range fetch unreachable (design ruling, section 3 of
 * the plan). An open-length list would need the bound to come from the
 * texture's own dimensions instead — a different guard, admitting a partly
 * filled last row — and is declined rather than guessed at.
 *
 * The type question is a LATTICE one ("is this a fixed-length list of
 * numbers?"), so a TRANSPARENT alias is unfolded to the list it names and a
 * NOMINAL reference is left folded (and so declines as "not a list"):
 * `resolveTypeAlias`, never `resolveTypeForCompilation`, which erases both
 * because compilation asks about layout, not admissibility.
 *
 * Unlike the value-shape reading, a ONE-element list is admissible here:
 * there is no `vec1`, but a one-texel texture reads like any other.
 */
function gpuStorageAtBaseShape(
  base: Expression & { symbol: string },
  kind: StorageKind
): GPUAtBase {
  const name = base.symbol;
  const hinted = `the base "${name}" is ${kind}-backed (storage hint)`;
  // A name the current shape frame binds — a caller-declared parameter or
  // shader input, a `Block` local, a lambda parameter — is not the free
  // symbol the hint was validated against: a declared name's shape comes from
  // its declaration, and a texture is not a shape this target's declaration
  // frame reads. Declined rather than read through the frame.
  if (BaseCompiler.localShapeFrameOf(name) !== undefined)
    return {
      decline:
        `${hinted}, but here "${name}" is a declared or local name whose ` +
        `shape comes from its declaration, not from the engine type the ` +
        `hint applies to — a sampler-backed name must be a free symbol of ` +
        `the expression`,
    };
  const t = resolveTypeAlias(base.type.type);
  const spelled = base.type.toString();
  if (typeof t === 'string' || t.kind !== 'list')
    return {
      decline:
        `${hinted}, which requires a one-dimensional fixed-length list of ` +
        `numbers, but its type is \`${spelled}\``,
    };
  const dims = t.dimensions ?? [];
  // Belt over suspenders, like the multi-axis arm of `gpuAtBaseShape`: a
  // multi-axis base makes `At` answer a COLLECTION element, which the §3.F
  // object-domain-absence gate intercepts ahead of any target function table.
  // Kept because that gate's typing is not this entry's to depend on.
  if (dims.length > 1)
    return {
      decline:
        `${hinted}, which requires a ONE-dimensional list laid out in the ` +
        `texture, but its type \`${spelled}\` is ${dims.length}-dimensional`,
    };
  // An unsized list has no `dimensions`; a NEGATIVE extent is the type
  // builder's encoding of an UNKNOWN one (`list<number^?>` →
  // `dimensions: [-1]`), the same reading the value-shape arm takes.
  const n = dims[0] ?? -1;
  if (n < 0)
    return {
      decline:
        `${hinted}, but its type \`${spelled}\` states no static length, and ` +
        `the texture read bounds the index by the list's declared length`,
    };
  if (n === 0)
    return {
      decline: `${hinted}, but its type \`${spelled}\` is an empty list, which has no element to read`,
    };
  const bad = gpuAtNonScalarElement(base);
  if (bad !== undefined) return { decline: `${hinted}, and ${bad}` };
  return { count: n, storage: kind };
}

/**
 * The static element count of an admissible `At` base — a declared
 * `vector<N>`, a parameterized `tuple<…>`, or a literal `List`/`Tuple` — or a
 * DISCRIMINATED decline reason.
 *
 * Bases whose elements are object-domain (`list<string>`) never reach here:
 * the §3.F absence gate in `BaseCompiler.compile` pre-empts them with its own
 * diagnostic, so no reason is owed for them.
 */
function gpuAtBaseShape(
  base: Expression | null,
  target: CompileTarget<Expression>
): GPUAtBase {
  if (base === null) return { decline: 'it has no base operand' };

  // A base the caller's `storage` hint places in shader storage: the values
  // are not a shader VALUE at all, so none of the value-shape questions below
  // apply to it — its admissibility is decided from the engine type alone.
  if (isSymbol(base)) {
    const kind = target.storage?.get(base.symbol);
    if (kind !== undefined) return gpuStorageAtBaseShape(base, kind);
  }

  const t = gpuType(base);

  // Both symbols that name an absent datum are read alike (user ruling of
  // 2026-09-22); `isAbsentScalarSymbol` (`boxed-expression/validate.ts`)
  // tests the same two names.
  if (
    isSymbol(base, 'Missing') ||
    isSymbol(base, 'Undefined') ||
    t === 'missing'
  )
    return {
      decline:
        'the base is the absence marker (`Missing` or `Undefined`), which ' +
        'has no shader value to index into',
    };

  // A complex value lowers to `vec2(re, im)` — a NUMBER in the shader's
  // complex convention, not an indexable collection. Asked only of a
  // NON-literal base: `isComplexValued` reads a literal `List` with a complex
  // ELEMENT as complex-valued, and that shape's honest fault is the element
  // one (reported below), not "the base is a complex number".
  if (
    !isFunction(base, 'List') &&
    !isFunction(base, 'Tuple') &&
    BaseCompiler.isComplexValued(base)
  )
    return {
      decline:
        'the base is a complex value (lowered as `vec2(re, im)` by the ' +
        'complex convention), not an indexable collection',
    };

  if (
    isFunction(base, 'Dictionary') ||
    (typeof t !== 'string' &&
      // A dictionary literal synthesizes the narrower `record{…}` (its keys
      // are statically known), so both kinds land here.
      (t.kind === 'dictionary' || t.kind === 'record'))
  )
    return {
      decline:
        `the base is a dictionary (type \`${base.type.toString()}\`) and a ` +
        `shader has no keyed lookup — only positional access into a value ` +
        `of static shape`,
    };

  if (t === 'tuple')
    return {
      decline:
        'the base is an unparameterized `tuple`, which states no arity, so ' +
        'there is no static element count to index against',
    };

  const n = BaseCompiler.aggregateComponentCount(base);
  if (n === undefined) {
    // A CALLER-DECLARED name whose spelling this target's declaration frame
    // does not parse. `gpuDeclaredShapeFrame` enters such a name as
    // `LOCAL_UNSHAPED`, and a frame entry OVERRIDES the boxed type, so the
    // count is gone even when the engine type states one — a `float[1600]`
    // parameter over a symbol typed `list<number^1600>` arrives here with the
    // length written twice and readable neither time.
    //
    // Reported separately because the honest cause is the DECLARATION, not
    // the type: saying "no statically known length" of a type that states
    // 1600 is false, and it collided with the message the genuinely unsized
    // `list<number>` below is owed. The two declines must stay
    // distinguishable — a consumer that falls back to another lane reads
    // them to tell an open type from an unparsed declaration.
    // The symbol's OWN name, never `declared.ref`: `ref` is the identifier the
    // emitted source references the name by, which for a WGSL shader input is
    // a field of the entry point's `input` struct (`input.S`, set by
    // `compileShaderBody`'s caller). A diagnostic must name what the caller
    // WROTE, so that the name in the message is the one they can search their
    // declaration list for.
    if (isSymbol(base)) {
      const declared = gpuDeclaredTypeOf(base);
      if (declared !== undefined && declared.value === undefined)
        return {
          decline:
            `the base is the caller-declared name "${base.symbol}", whose ` +
            `declared shader type \`${declared.spelling}\` is not one this ` +
            `target reads — it parses the scalar spellings and the ` +
            `two-to-four component vector spellings of both languages ` +
            `(\`vec3\`, \`ivec3\`, \`vec3f\`, \`vec3<f32>\`), and no array, ` +
            `matrix or struct type. The declaration decides the shape of a ` +
            `declared name, so no static element count reaches the analysis ` +
            `(the engine type \`${base.type.toString()}\` is not consulted ` +
            `for a declared name)`,
        };
    }
    if (typeof t !== 'string' && t.kind === 'list') {
      // Belt over suspenders: no spelling reaches this arm today. A multi-axis
      // base makes `At` answer a COLLECTION element (`missing | vector<3>`),
      // which the §3.F object-domain-absence gate intercepts ahead of any
      // target function table — the same pre-emption the header describes for
      // `list<string>`. Kept because the gate's typing is not this entry's to
      // depend on.
      if ((t.dimensions?.length ?? 0) >= 2)
        return {
          decline:
            `the base (type \`${base.type.toString()}\`) is multi-axis; only ` +
            `a one-dimensional base has a positional shader lowering`,
        };
      return {
        decline:
          `the base (type \`${base.type.toString()}\`) has no statically ` +
          `known length, and a shader value must have one`,
      };
    }
    return {
      decline:
        `the base (type \`${base.type.toString()}\`) is not a statically ` +
        `counted collection`,
    };
  }
  // A NEGATIVE count is the type builder's encoding of an UNKNOWN extent
  // (`list<number^?>` → `dimensions: [-1]`), not a width: without this the
  // count flowed on and emitted `_gpu_at-1(…)`, a call to a helper no
  // preamble generates. Same reading as the unsized `list` above.
  if (n < 0)
    return {
      decline:
        `the base (type \`${base.type.toString()}\`) has no statically ` +
        `known length, and a shader value must have one`,
    };
  if (n === 0)
    return {
      decline:
        'the base is empty, and neither shader language has a zero-length ' +
        'value type',
    };
  if (n === 1)
    return {
      decline:
        'the base has 1 element: there is no `vec1`, and a 1-element ' +
        'aggregate has no shader value shape of its own',
    };

  // The elements. A name whose COUNT came from the GPU declaration frame is
  // judged against the shape the CALLER declared — its boxed type states no
  // element type at all.
  const framed = gpuAtFramedBaseElements(base);
  if (framed !== 'unframed')
    return framed === undefined ? { count: n } : { decline: framed };

  const bad = gpuAtNonScalarElement(base);
  if (bad !== undefined) return { decline: bad };
  return { count: n };
}

/**
 * The 0-based slot a 1-based CE index `i` selects in a base of `n` elements,
 * or `null` when it selects nothing — `0`, out of range, or not an integer.
 * `null` is the absence marker, which projects to the target's NaN spelling.
 */
function gpuAtSlot(i: number, n: number): number | null {
  if (!Number.isInteger(i) || i === 0) return null;
  const j = i > 0 ? i - 1 : n + i;
  return j >= 0 && j < n ? j : null;
}

/**
 * The emitted source for element `j` (0-based) of an admissible base of `n`
 * elements.
 *
 * A literal base folds to the element's own compiled source (`At([10,20,30],
 * 2)` → `20.0`, not `vec3(…).y`) — zero runtime cost. Otherwise a base of
 * width 2–4 is a `vecN` and takes a component swizzle; a wider one is a
 * `float[N]` / `array<f32, N>` and takes a direct subscript. The
 * atomic-emission rule (the sibling point-list as-built note) keeps a bare
 * identifier unparenthesized so the emission stays atomic for the operand-
 * shape gate; anything else is parenthesized and judged as the compound it is.
 */
function gpuAtElement(
  base: Expression,
  j: number,
  n: number,
  compile: (e: Expression) => string
): string {
  if (isFunction(base, 'List') || isFunction(base, 'Tuple'))
    return compile(base.ops![j]);
  const code = compile(base);
  const access = n <= 4 ? `.${'xyzw'[j]}` : `[${j}]`;
  return gpuIsAtomicEmission(code) ? `${code}${access}` : `(${code})${access}`;
}

/**
 * Does `gpuAtGather` fold `slots` to a SINGLE swizzle of the base? Stated once
 * so the emission and the reference count below cannot drift apart.
 */
function gpuAtIsSwizzleGather(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number
): boolean {
  const isLiteral = isFunction(base, 'List') || isFunction(base, 'Tuple');
  return !isLiteral && n <= 4 && slots.every((s) => s !== null);
}

/**
 * How many times the emission `gpuAtGather` will actually CHOOSE references
 * the base source — one for a swizzle however many components it selects, one
 * per in-range slot for a constructor.
 *
 * Counting the non-null slots instead described a constructor that a
 * swizzling gather never emits, and so declined `At(impure, [1, 3])`, whose
 * emission evaluates its base exactly once.
 */
function gpuAtBaseRefs(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number
): number {
  if (gpuAtIsSwizzleGather(base, slots, n)) return 1;
  return slots.filter((s) => s !== null).length;
}

/**
 * The `vecK` gather of `slots` (0-based positions, `null` = out of range) out
 * of `base`. All-in-range over a `vecN` base folds to a single swizzle
 * (`v.xz`) — one reference to the base; anything else is a constructor whose
 * slots are the folded components (`vec2(v.x, _gpu_nan())`).
 */
function gpuAtGather(
  base: Expression,
  slots: ReadonlyArray<number | null>,
  n: number,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (gpuAtIsSwizzleGather(base, slots, n)) {
    const code = compile(base);
    const sw = slots.map((s) => 'xyzw'[s!]).join('');
    return gpuIsAtomicEmission(code) ? `${code}.${sw}` : `(${code}).${sw}`;
  }
  const ctor =
    target.language === 'wgsl' ? `vec${slots.length}f` : `vec${slots.length}`;
  const parts = slots.map((s) =>
    s === null ? gpuNaN(target) : gpuAtElement(base, s, n, compile)
  );
  return `${ctor}(${parts.join(', ')})`;
}

/**
 * How a literal index-list entry classifies. The tiers are decided from the
 * ENTRIES, not from the list's type: a literal integer gather folds at compile
 * time, a literal boolean mask is statically a gather, and a runtime-valued
 * mask has no static result length at all (design ruling 2).
 */
type GPUAtEntry = 'int' | 'bool' | 'other-literal' | 'dyn-bool' | 'dyn';

function gpuAtEntryKind(e: Expression): GPUAtEntry {
  if (isSymbol(e, 'True') || isSymbol(e, 'False')) return 'bool';
  if (isNumber(e))
    return !e.isComplex && Number.isInteger(e.re) ? 'int' : 'other-literal';
  // Every OTHER literal is likewise an entry that selects no element — a
  // string, a nested collection, the absence marker. Classifying them 'dyn'
  // handed them the demand-gated dynamic-gather text, which describes a
  // runtime-valued integer they are not: D2 requires a literal non-integer to
  // carry its own reason.
  if (
    isString(e) ||
    isSymbol(e, 'Missing') ||
    isSymbol(e, 'Undefined') ||
    isFunction(e, 'List') ||
    isFunction(e, 'Tuple') ||
    isFunction(e, 'Dictionary')
  )
    return 'other-literal';
  if (isSubtype(gpuType(e), 'boolean')) return 'dyn-bool';
  return 'dyn';
}

/**
 * `At` on a shader target. Returns the emitted source or throws the
 * fail-closed decline, which names the shape that has no lowering.
 */
function compileGPUAt(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it — the `gpuCheckOperandShapes` convention.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`Could not compile \`At\`: ${reason}.`);
  };

  if (args.length < 2) decline('it has no index operand');
  if (args.length > 2)
    decline(
      `a multi-index access (${args.length - 1} indices) walks a nested ` +
        `collection, and only a one-dimensional base has a shader value shape`
    );

  const base = args[0];
  const index = args[1];

  const shape = gpuAtBaseShape(base, target);
  if ('decline' in shape) decline(shape.decline);
  const n = shape.count;
  const isWGSL = target.language === 'wgsl';
  // The storage kind of a sampler-backed base (`storage` compile option).
  // Such a base has no shader VALUE, so every tier reads it through the
  // texel-fetch helper: the dynamic index as one guarded call, a static index
  // as the same call with a literal index (the coordinate is computed at run
  // time from the texture's width, so nothing folds to a constant), and a
  // gather or mask as a vector constructor of one call per selected slot —
  // where the array form folds to subscripts and swizzles.
  const storage = shape.storage;
  // The emitted source of the sampler-backed base, computed once on first
  // use (a gather reads it once per slot) and never on a path that folds
  // the access to NaN without emitting the base.
  let texAtSource: string | undefined;
  const texAtCall = (floatIndex: string): string => {
    texAtSource ??= gpuStorageOperandSource(
      base as Expression & { symbol: string },
      compile
    );
    const src = texAtSource;
    if (!isWGSL) return `_gpu_texat${n}(${src}, ${floatIndex})`;
    // A WGSL texture cannot be passed to a helper the way a GLSL sampler
    // can, so the helper is generated per BINDING: it names the module-scope
    // texture in its body, and carries the binding identifier and the list
    // length in its own name (`_gpu_texat_S_1600`), which is what the
    // preamble scan reads back (`gpuTexAtBindings`). A binding is a plain
    // identifier; a `vars` mapping to anything else has no helper name.
    if (!/^[A-Za-z_]\w*$/.test(src))
      decline(
        `the base "${(base as Expression & { symbol: string }).symbol}" is ` +
          `${storage}-backed (storage hint) and maps to \`${src}\`, which is ` +
          `not a plain identifier; a WGSL texture is a module-scope binding ` +
          `and the texel-read helper names it directly`
      );
    return `_gpu_texat_${src}_${n}(${floatIndex})`;
  };

  // Evaluate-once. A shader language does not specify the evaluation ORDER of
  // a call's arguments, so two impure operands could commute between drivers.
  if (!base.isPure && !index.isPure)
    decline(
      'both the base and the index are impure, and neither shader language ' +
        'specifies the order in which a call evaluates its arguments'
    );
  // An emission that DISCARDS the base entirely (an all-out-of-range gather)
  // or references the base source MORE THAN ONCE (a mixed gather constructor)
  // needs the base to be pure.
  const literalOps =
    isFunction(base, 'List') || isFunction(base, 'Tuple')
      ? base.ops!
      : undefined;
  const isLiteralBase = literalOps !== undefined;
  const requirePureBase = (why: string): void => {
    if (!base.isPure) decline(why);
  };
  // A LITERAL base folds PER ELEMENT — the selected element is emitted, the
  // siblings are dropped — so the purity question is per element too. Asking
  // it of the whole literal over-declined `At([Random(), 1, 2], 1)`, whose
  // emission evaluates the draw exactly once, which is what the source says.
  // An element the emission omits must be pure (a dropped draw shifts the
  // shader's random stream), and an impure one may not be selected twice (that
  // would evaluate it twice, where the source has one element).
  const requireLiteralBaseElements = (
    selected: ReadonlyArray<number>,
    what: 'access' | 'gather'
  ): void => {
    const ops = literalOps!;
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].isPure) continue;
      const refs = selected.filter((s) => s === i).length;
      if (refs === 0)
        decline(
          `element ${i + 1} of the literal base is impure and the ${what} ` +
            `does not select it, so folding would discard it unevaluated`
        );
      if (refs > 1)
        decline(
          `element ${i + 1} of the literal base is impure and the ${what} ` +
            `selects it ${refs} times, which would evaluate it more than once`
        );
    }
  };
  // A fold to the NaN spelling omits an operand from the OUTPUT ENTIRELY, so
  // it must not omit an impure one: the dropped draw never happens, which
  // shifts the shader's random stream (the `gpuConditionalOperand` rationale).
  const requirePureFold = (what: 'base' | 'index'): void => {
    if ((what === 'base' ? base : index).isPure) return;
    decline(
      `the access folds to the NaN spelling, which would DISCARD the impure ` +
        `${what} unevaluated`
    );
  };

  // ---- Collection index: the gather / mask tiers (design § D2) ------------
  if (isFunction(index, 'List')) {
    const entries = index.ops!;
    const kinds = entries.map(gpuAtEntryKind);

    const bad = kinds.indexOf('other-literal');
    if (bad >= 0)
      decline(
        `entry ${bad + 1} of the index list ` +
          `(\`${entries[bad].toString()}\`) is a literal that is not an ` +
          `integer, so it selects no element and the list is not an index ` +
          `gather at all`
      );

    const set = new Set(kinds);
    const numeric = set.has('int') || set.has('dyn');
    const boolean = set.has('bool') || set.has('dyn-bool');
    if (numeric && boolean)
      decline(
        'the index list mixes integer entries with boolean ones, so it is ' +
          'neither a gather nor a mask'
      );
    if (set.has('dyn-bool'))
      decline(
        'the index is a boolean mask with runtime-valued entries: its ' +
          'result LENGTH depends on how many of them are true at run time, ' +
          'so it has no static shader value shape. This shape has no shader ' +
          'lowering at all — it is not a missing tier'
      );

    // Resolve the selected 0-based slots. A literal mask is statically a
    // gather (its length must EQUAL the base's, as the interpreter requires);
    // a literal integer list gathers position-preservingly.
    let slots: (number | null)[];
    if (set.has('bool')) {
      if (entries.length !== n)
        decline(
          `the index is a boolean mask of length ${entries.length}, but the ` +
            `base has ${n} elements — a mask's length must equal the ` +
            `collection's`
        );
      slots = [];
      entries.forEach((e, i) => {
        if (isSymbol(e, 'True')) slots.push(i);
      });
    } else if (set.has('dyn')) {
      // The count is of the RUNTIME-VALUED entries, not of the list: a mixed
      // `[1, k]` has one, and reporting the list's length described a shape
      // the caller did not write.
      const dyn = kinds.filter((k) => k === 'dyn').length;
      decline(
        `the index list has ${dyn} runtime-valued integer ` +
          `${dyn === 1 ? 'entry' : 'entries'}; a static-count DYNAMIC gather ` +
          `is not lowered in this version (no witness requested it yet) — the ` +
          `helpers it needs are the same ones the scalar form already emits`
      );
      slots = [];
    } else {
      slots = entries.map((e) => gpuAtSlot((e as any).re as number, n));
    }

    const w = slots.length;
    if (w === 0)
      decline(
        'the index selects 0 elements, and neither shader language has a ' +
          'zero-length value type'
      );
    if (w === 1)
      decline(
        'the index selects exactly 1 element, which CE types as a 1-element ' +
          'LIST (pinned: `At(L, [2])` → `[20]`), and no shader value has ' +
          'that shape — there is no `vec1`'
      );
    if (w > 4)
      decline(
        `the index selects ${w} elements, so the RESULT would be a ` +
          `\`vec${w}\`, and a shader vector holds 2 to 4`
      );

    // A sampler-backed base: one guarded texel read per selected slot (the
    // base is a symbol, so pure; an out-of-range slot is the NaN spelling,
    // as in the array form). The helper takes the 1-based index.
    if (storage !== undefined) {
      const ctor = isWGSL ? `vec${w}f` : `vec${w}`;
      const parts = slots.map((slot) =>
        slot === null
          ? gpuNaN(target)
          : texAtCall(formatFloat(slot + 1, target.language))
      );
      return `${ctor}(${parts.join(', ')})`;
    }
    if (isLiteralBase)
      requireLiteralBaseElements(
        slots.filter((s): s is number => s !== null),
        'gather'
      );
    else {
      // Judged on the emission `gpuAtGather` will actually take: a swizzle
      // references the base once whatever it selects, a constructor once per
      // in-range slot — and an ALL-out-of-range gather not at all.
      const refs = gpuAtBaseRefs(base, slots, n);
      if (refs === 0)
        requirePureBase(
          'the gather selects no element of the base, so its emission would ' +
            'DISCARD the impure base unevaluated'
        );
      else if (refs > 1)
        requirePureBase(
          'the gather emits a constructor that references the impure base ' +
            'more than once, which would evaluate it more than once'
        );
    }

    return gpuAtGather(base, slots, n, compile, target);
  }

  // ---- Scalar index (design § D1) ----------------------------------------
  const it = gpuType(index);

  // The absence marker itself: the interpreter has no value to index with, and
  // the numeric projection of "no value" is NaN. The fold emits neither
  // operand, so neither may be impure. Both symbols that name an absent datum
  // are read alike (user ruling of 2026-09-22).
  if (
    isSymbol(index, 'Missing') ||
    isSymbol(index, 'Undefined') ||
    isSubtype(it, 'missing')
  ) {
    requirePureFold('base');
    requirePureFold('index');
    return gpuNaN(target);
  }

  // A string KEY. Only a dictionary base takes one (and that base has already
  // declined above), so on a positional base it is the wrong index domain
  // outright — named separately from the type-based decline below, which
  // covers a symbol merely DECLARED `string`.
  if (isString(index))
    decline(
      'the index is a string key, and only a dictionary base takes one — a ' +
        'positional shader access indexes by number'
    );

  if (BaseCompiler.isComplexValued(index))
    decline(
      'the index is a complex value, which lowers to a `vec2(re, im)`; the ' +
        'interpreter reads its real part, and a shader has no such reading ' +
        'of a vector in an index position'
    );

  // A CALLER-DECLARED name, whose declared shader type is the only reading of
  // it there is — asked ahead of the type-based readings below, which see the
  // undeclared engine symbol's type.
  const framedIndex = gpuAtFramedIndex(index);
  if (framedIndex !== undefined && 'decline' in framedIndex)
    decline(framedIndex.decline);

  // A literal real index resolves against N at compile time — zero runtime
  // cost, and `0` / out of range / non-integer / non-finite fold straight to
  // the NaN spelling. Over a texture an in-range index cannot fold to a
  // constant texel coordinate, because the texture width is not known at
  // compile time (it is read at run time inside the helper): its texel form
  // is the guarded read with the literal index.
  if (isNumber(index)) {
    const j = gpuAtSlot(index.re, n);
    if (j === null) {
      // The fold emits neither operand (the index is a literal, so pure).
      requirePureFold('base');
      return gpuNaN(target);
    }
    if (storage !== undefined)
      return texAtCall(formatFloat(index.re, target.language));
    if (isLiteralBase) requireLiteralBaseElements([j], 'access');
    return gpuAtElement(base, j, n, compile);
  }

  // A collection-typed index that is NOT a literal list: there is no tier for
  // it (its entries are not readable at compile time). A STRING is excluded:
  // it matches `collection` in the lattice (its elements are its grapheme
  // clusters) but this target has no strings at all, so the honest diagnostic
  // is the "provably not a number" one below, which names the type — the
  // diagnostic a string index has always received.
  if (isSubtype(it, COLLECTION_SHAPE_TYPE) && !isSubtype(it, 'string')) {
    const k = BaseCompiler.aggregateComponentCount(index);
    // A NEGATIVE count is the type builder's encoding of an UNKNOWN extent
    // (`list<number^?>` → `dimensions: [-1]`), not a width — the same reading
    // the base side already takes. Without this it flowed on as a count and
    // described "a collection of -1 runtime-valued entries" in a
    // demand-gated text, when the shape is the PERMANENT no-static-count
    // decline (design § D4).
    if (k === undefined || k < 0)
      decline(
        `the index is a collection (type \`${index.type.toString()}\`) with ` +
          `no statically known length, so there is no static count to emit ` +
          `a result shape against`
      );
    decline(
      `the index is a collection of ${k} runtime-valued entries; a ` +
        `static-count DYNAMIC gather is not lowered in this version (no ` +
        `witness requested it yet)`
    );
  }

  // `unknown`/`value`-typed parameters are numeric on this target (the
  // compile model's unknown-as-numeric-parameter rule — the witness's loop
  // variable routinely types as a wide union). Only a PROVABLY non-numeric
  // index declines, and it names the type.
  if (!couldMatch(it, 'number'))
    decline(
      `the index (type \`${index.type.toString()}\`) is provably not a ` +
        `number, so it selects no element and \`At\` has no value to project`
    );

  // A proven positive, in-range integer needs neither a guard nor a float
  // conversion. Textures retain their storage helper. WGSL array values are
  // copied to a local reference before dynamic indexing, as in gpuAtPreamble.
  const fact = gpuIntegerFact(
    index,
    target,
    (op) =>
      !target.foldExcludedOps?.has(op) &&
      target.operators?.(op) === GPU_OPERATORS[op] &&
      target.functions?.(op) === GPU_FUNCTIONS[op]
  );
  if (
    storage === undefined &&
    fact &&
    fact.min >= 1 &&
    fact.max <= n &&
    (target.language !== 'wgsl' ||
      n <= 4 ||
      (BaseCompiler.canHoist(target) &&
        !conditionalGPUSinks.has(target.hoist!)))
  ) {
    let code = compile(base);
    if (target.language === 'wgsl' && n > 4) {
      const name = BaseCompiler.tempVar(target);
      BaseCompiler.hoistStatement(target, `var ${name} = ${code};`);
      code = name;
    }
    return `${gpuIsAtomicEmission(code) ? code : `(${code})`}[${fact.code} - 1]`;
  }

  // Dynamic index: one call, so the base and the index are each evaluated
  // exactly once. The guard inside the helper is what makes both languages'
  // out-of-bounds rules unreachable. A caller-declared INTEGER index is
  // converted at the call site — the guard runs entirely in float space.
  const idx = compile(index);
  const floatIdx =
    framedIndex === undefined ? idx : `${isWGSL ? 'f32' : 'float'}(${idx})`;
  if (storage === undefined || !isSymbol(base))
    return `_gpu_at${n}(${compile(base)}, ${floatIdx})`;

  // A sampler-backed base: the same call shape and the same index contract,
  // through the texel-fetch helper (`texAtCall`: per length on GLSL, per
  // binding on WGSL).
  return texAtCall(floatIdx);
}

/**
 * The name of the sampler-backed symbol whose read is being emitted, while
 * `gpuStorageOperandSource` compiles it, else `undefined`.
 *
 * A sampler-backed symbol has no shader value, so every reference to it
 * outside a positional read must fail closed — and the gate that refuses it
 * (`gpuRefuseStorageReference`, installed on the target's `var` and
 * `mangleId` hooks by `createTargetFor`) sees only an identifier, not where
 * it is being emitted. This is how the ONE legitimate emission announces
 * itself. Module state is safe here for the reason `currentUserFunctions` is:
 * GPU compilation is synchronous and non-reentrant, and the window is a
 * single `compile(base)` of a bare symbol, closed in a `finally`.
 */
let gpuOpenStorageOperand: string | undefined;

/**
 * The emitted source of the sampler-backed symbol `base` as the operand of a
 * texel read: its ordinary free-symbol emission — the `vars` mapping when the
 * caller gave one, else the bare identifier after the reserved-word check —
 * with the storage-reference gate stood aside for exactly this emission.
 */
function gpuStorageOperandSource(
  base: Expression & { symbol: string },
  compile: (e: Expression) => string
): string {
  const saved = gpuOpenStorageOperand;
  gpuOpenStorageOperand = base.symbol;
  try {
    return compile(base);
  } finally {
    gpuOpenStorageOperand = saved;
  }
}

/**
 * Fail closed when the free symbol `id` is one the caller's `storage`
 * hint places in shader storage and it is being referenced anywhere but as
 * the operand of a positional read. A texture has no shader value of its own:
 * as an operand of arithmetic, a reduction, a user-function argument, an
 * assignment target or a bare value it would emit an identifier the shader
 * cannot use as a value, behind a reported success. The reason names the
 * storage kind, so a consumer reading decline reasons can tell it apart.
 */
function gpuRefuseStorageReference(
  id: string,
  storage: ReadonlyMap<string, StorageKind>,
  language: string
): void {
  const kind = storage.get(id);
  if (kind === undefined || gpuOpenStorageOperand === id) return;
  throw new Error(
    `Could not compile \`${id}\`: the symbol is ${kind}-backed (compile option ` +
      `\`storage: { ${id}: '${kind}' }\`), and a texture has no shader value ` +
      `of its own on the ${language} target: it can be read only through a ` +
      `positional access (\`At(${id}, i)\`). Here it is referenced as a whole ` +
      `— as an operand, in a reduction, or as a bare value — which has no ` +
      `lowering.`
  );
}

/**
 * The `_gpu_atN` positional-access helper preamble, in the language of
 * `isWGSL`. Generated per N on demand (`preambleFor` scans the emitted code
 * for `_gpu_at(\d+)`), so a `vector<7>` base gets a `_gpu_at7` over a
 * `float[7]` with the same body shape as the `vecN` forms.
 *
 * The guard runs ENTIRELY IN FLOAT SPACE and is the load-bearing part: `int()`
 * is undefined outside the int range, so nothing may be cast before the range
 * test, and the negated compound (`!(i >= -N && i <= N)`) swallows `NaN` and
 * `±∞` — which `floor` alone would not.
 */
function gpuAtPreamble(n: number, isWGSL: boolean): string {
  const lang = isWGSL ? 'wgsl' : 'glsl';
  const nan = gpuNonFiniteLiteral(NaN, lang);
  const { guard, doc } = gpuAtIndexGuard(n, lang);
  if (isWGSL) {
    // A value-typed `array` PARAMETER is not reliably indexable by a runtime
    // expression (the restriction WGSL has never applied to a `vecN`), so the
    // array forms copy to a local `var` — a reference — first. A vector form
    // indexes its parameter directly.
    const param = n <= 4 ? `v: vec${n}f` : `v: array<f32, ${n}>`;
    const copy = n <= 4 ? '' : '  var a = v;\n';
    const src = n <= 4 ? 'v' : 'a';
    return `
fn _gpu_at${n}(${param}, i: f32) -> f32 {
${doc}
  if (${guard}) {
    return ${nan};
  }
  let k = i32(i);
${copy}  return ${src}[select(${n} + k, k - 1, k > 0)];
}
`;
  }
  const param = n <= 4 ? `vec${n} v` : `float v[${n}]`;
  return `
float _gpu_at${n}(${param}, float i) {
${doc}
  if (${guard})
    return ${nan};
  int k = int(i);
  return v[(k > 0) ? k - 1 : ${n} + k];
}
`;
}

/**
 * The index guard every positional-access helper opens with, over a base of
 * `n` elements, plus the comment that documents it. Written ONCE and shared
 * by the array helper (`gpuAtPreamble`) and the texture helper
 * (`gpuTexAtPreamble`): the two storage kinds are interchangeable only while
 * they answer every index identically, so the guard text has one source.
 *
 * The guard runs ENTIRELY IN FLOAT SPACE and is the load-bearing part: `int()`
 * is undefined outside the int range, so nothing may be cast before the range
 * test, and the negated compound (`!(i >= -N && i <= N)`) swallows `NaN` and
 * `±∞` — which `floor` alone would not.
 */
function gpuAtIndexGuard(
  n: number,
  lang: 'glsl' | 'wgsl',
  i = 'i'
): { guard: string; doc: string } {
  const b = formatFloat(n, lang);
  return {
    guard: `!(${i} >= -${b} && ${i} <= ${b}) || ${i} != floor(${i}) || ${i} == 0.0`,
    doc:
      `  // 1-based; negative counts from the end; anything else → NaN.\n` +
      `  // The guard runs entirely in float space: it rejects NaN, ±∞, huge\n` +
      `  // finite values, non-integers and 0 BEFORE the int cast (undefined\n` +
      `  // outside int range), and makes both languages' out-of-bounds rules\n` +
      `  // (GLSL UB / WGSL indeterminate) unreachable.`,
  };
}

/**
 * The `_gpu_texatN` positional-access helper for a SAMPLER-BACKED list of N
 * elements, GLSL (the WGSL form is `gpuTexAtPreambleWGSL`, generated per
 * binding). Generated per N on demand like `_gpu_atN`, and named apart from
 * it so one shader can carry both lowerings for different lists.
 *
 * The storage contract it reads (plan section 3): a single-channel 32-bit
 * float texture, one value per texel, holding the list ROW-MAJOR from texel
 * (0, 0) in a texture of any width, with at least N texels. The read is a
 * bare `texelFetch` — integer coordinates, mip level 0, no filtering, no
 * normalization — which is core in GLSL ES 3.00 / WebGL 2.
 *
 * Two different numbers meet here and must not be confused. N, the list's
 * LENGTH, is baked into the name and the guard: it bounds the index, and it
 * is what makes an out-of-range fetch unreachable — PROVIDED the texture
 * holds at least N texels, a host precondition the shader cannot check. The
 * texture's WIDTH is read at run time (`textureSize`) and only unflattens the
 * 0-based slot into a coordinate; it is deliberately not baked in, so the
 * host may pick any width and resize the texture without recompiling.
 */
function gpuTexAtPreamble(n: number): string {
  const nan = gpuNonFiniteLiteral(NaN, 'glsl');
  const { guard, doc } = gpuAtIndexGuard(n, 'glsl');
  return `
float _gpu_texat${n}(sampler2D v, float i) {
${doc}
  if (${guard})
    return ${nan};
  int k = int(i);
  k = (k > 0) ? k - 1 : ${n} + k;
  // Row-major in a texture of run-time width; the host guarantees at least
  // ${n} texels, so the coordinate is in range whenever the guard passed.
  int w = textureSize(v, 0).x;
  return texelFetch(v, ivec2(k % w, k / w), 0).r;
}
`;
}

/**
 * The widths of the `_gpu_atN` helpers `code` calls — ascending and
 * deduplicated, so a helper used many times is declared once. Read off the
 * EMITTED source rather than kept in a per-compilation table, like every other
 * `preambleFor` scan.
 *
 * Anchored on a CALL SITE with a name boundary on both ends: a bare
 * `/_gpu_at(\d+)/` matched a user symbol spelled `_gpu_at5`, and the
 * "helper" it then generated redeclared that name.
 */
function gpuAtHelperWidths(code: string): number[] {
  return gpuHelperWidths(code, /(?<![\w$])_gpu_at(\d+)\s*\(/g);
}

/**
 * The `_gpu_texat_<binding>_<N>` positional-access helper for a
 * SAMPLER-BACKED list of N elements on WGSL, generated per BINDING: a WGSL
 * texture cannot be an ordinary function parameter the way a GLSL sampler or
 * an array can, so the helper names the module-scope texture `binding`
 * directly (the host declares it, `var S: texture_2d<f32>`). The read is a
 * `textureLoad` with integer coordinates and mip level 0 — no sampler — and
 * the width comes from `textureDimensions`, at run time, exactly as the GLSL
 * form reads it from `textureSize`. Same storage contract, same guard text
 * (`gpuAtIndexGuard`), same index contract.
 */
function gpuTexAtPreambleWGSL(binding: string, n: number): string {
  const nan = gpuNonFiniteLiteral(NaN, 'wgsl');
  // The parameter and the locals carry the reserved `_gpu_` prefix: the
  // binding is any plain identifier the caller chose, and one named `i`,
  // `k` or `w` would otherwise be shadowed by the helper's own names, so
  // the texture reads would name the parameter instead of the texture.
  const { guard, doc } = gpuAtIndexGuard(n, 'wgsl', '_gpu_i');
  return `
fn _gpu_texat_${binding}_${n}(_gpu_i: f32) -> f32 {
${doc}
  if (${guard}) {
    return ${nan};
  }
  var _gpu_k = i32(_gpu_i);
  _gpu_k = select(${n} + _gpu_k, _gpu_k - 1, _gpu_k > 0);
  // Row-major in a texture of run-time width; the host guarantees at least
  // ${n} texels, so the coordinate is in range whenever the guard passed.
  let _gpu_w = i32(textureDimensions(${binding}, 0).x);
  return textureLoad(${binding}, vec2i(_gpu_k % _gpu_w, _gpu_k / _gpu_w), 0).r;
}
`;
}

/**
 * The widths of the `_gpu_texatN` texture helpers `code` calls, read the
 * same way. The digits follow `_gpu_texat` directly, so the WGSL helper
 * generated per BINDING (`_gpu_texat_S_1600`, an underscore after the prefix)
 * shares the prefix without ever matching this scan.
 */
function gpuTexAtHelperWidths(code: string): number[] {
  return gpuHelperWidths(code, /(?<![\w$])_gpu_texat(\d+)\s*\(/g);
}

/**
 * The (binding, length) pairs of the WGSL `_gpu_texat_<binding>_<N>` helpers
 * `code` calls, in first-use order and deduplicated. Both are read off the
 * helper's NAME: the preamble is built from the emitted code alone, like
 * every other helper scan, and a name is the only channel it has. The
 * binding is a plain identifier (the lowering refuses any other), and the
 * length is the digits before the call's parenthesis, so the lazy binding
 * match stops exactly there — `_gpu_texat_u_board_2_1600(` is the binding
 * `u_board_2` of length 1600.
 */
function gpuTexAtBindings(code: string): [binding: string, n: number][] {
  const seen = new Set<string>();
  const result: [string, number][] = [];
  const re = /(?<![\w$])_gpu_texat_([A-Za-z_]\w*?)_(\d+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const key = `${m[1]}_${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push([m[1], Number(m[2])]);
  }
  return result;
}

function gpuHelperWidths(code: string, re: RegExp): number[] {
  const widths = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) widths.add(Number(m[1]));
  return [...widths].sort((a, b) => a - b);
}

/**
 * Extract a lowercase string literal from a boxed expression, or `null`
 * if it isn't a string literal. Operators that need to switch on a
 * colorspace name at compile time use this to peek at the argument.
 */
function readStringLiteral(expr: Expression): string | null {
  if (!isString(expr)) return null;
  return expr.string?.toLowerCase() ?? null;
}

/** Compile an expression as a GPU integer argument.
 *  Integer constants emit as plain literals (`200`); other expressions
 *  are wrapped in a cast (`int(...)` or `i32(...)`). */
function compileIntArg(
  head: string,
  expr: Expression,
  compile: (e: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const c = tryGetConstant(expr);
  if (c !== undefined && Number.isInteger(c)) return c.toString();
  // A complex value is a `vec2`, and `int(vec2(x, y))` is not a scalar: no
  // shader compiler accepts it where an `int` is expected (for example the
  // iteration count of `_fractal_mandelbrot`).
  if (BaseCompiler.isComplexValued(expr))
    throw new Error(
      `Could not compile \`${head}\`: the integer operand \`${expr.toString()}\` is complex, and a shader ` +
        `has no conversion from a complex value to an integer.`
    );
  const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
  return `${intCast}(${compile(expr)})`;
}

/** Maximum range for inline unrolling of Sum/Product loops in GPU targets. */
const GPU_UNROLL_LIMIT = 100;

/**
 * Fail closed on a Sum/Product bound that is statically non-finite (a
 * `±∞`/`NaN` literal, or an expression typed `infinity` or `nan`), so
 * `compile()` reports failure and the caller falls back to the interpreter.
 * `for (int i = 1; i <= _gpu_inf(); i++)` has no terminating condition (and is
 * a shader type error besides), so such a bound must never be emitted. Mirrors
 * `assertFiniteBound` in the JavaScript target.
 */
function assertFiniteGPUBound(
  kind: 'Sum' | 'Product',
  expr: Expression,
  which: 'lower' | 'upper'
): void {
  const nonFinite =
    (isNumber(expr) && !Number.isFinite(expr.re)) ||
    expr.type.matches('infinity') ||
    expr.type.matches('nan');
  if (!nonFinite) return;
  throw new Error(
    `Could not compile \`${kind}\`: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop.`
  );
}

/**
 * Maximum absolute exponent for inlining an integer `Power` as repeated
 * multiplication (`x*x*x`), for a *simple* base only (symbol or number, so the
 * base subexpression can be safely repeated). Larger exponents — or any
 * compound base — route through the `_gpu_powi` preamble helper instead, which
 * evaluates the base once and keeps the sign correct for a negative base.
 *
 * Eight multiplications of a variable are cheaper than the helper call the
 * exponent would otherwise reach, and the helper has no unrolled arm past 4:
 * it falls back to `pow(abs(x), n)` with a sign correction, which is a
 * transcendental pair on the hardware where the unroll is plain multiplies.
 */
const GPU_POWI_INLINE_LIMIT = 8;

/** Keep small constant powers branch-free while evaluating the base once.
 * Invalid aggregate shapes retain the general helper and its shape diagnostic. */
function gpuFixedPower(
  code: string,
  exponent: number,
  shape: ReturnType<typeof gpuOperandShape>
): string {
  const width = typeof shape === 'number' ? shape : undefined;
  if (
    (shape === 'scalar' || width !== undefined) &&
    exponent >= 2 &&
    exponent <= 4
  )
    return `_gpu_pow${exponent}${width === undefined ? '' : `_v${width}`}(${code})`;
  return `_gpu_powi${width ?? ''}(${code}, ${formatGPUNumber(exponent)})`;
}

/** Emit only the scalar/vector specializations actually called by the source. */
function gpuFixedPowerPreamble(code: string, isWGSL: boolean): string {
  const names = new Set<string>();
  const calls = /(?<![\w$])(_gpu_pow([234])(?:_v([234]))?)\s*\(/g;
  let result = '';
  for (const match of code.matchAll(calls)) {
    const name = match[1];
    if (names.has(name)) continue;
    names.add(name);
    const type = match[3]
      ? gpuVecType(Number(match[3]), isWGSL)
      : isWGSL
        ? 'f32'
        : 'float';
    const body =
      match[2] === '2'
        ? 'return x * x;'
        : match[2] === '3'
          ? 'return x * x * x;'
          : `${isWGSL ? 'let' : type} s = x * x; return s * s;`;
    result += isWGSL
      ? `\nfn ${name}(x: ${type}) -> ${type} { ${body} }\n`
      : `\n${type} ${name}(${type} x) { ${body} }\n`;
  }
  return result;
}

/**
 * Largest literal `k` for which `Binomial(n, k)`/`Choose(n, k)` unrolls to its
 * explicit falling-factorial product on a GPU target. Every unit of `k` adds
 * one factor — and one splice of the compiled first operand — so keep the
 * unroll short. (The interpreter's own symbolic expansion cap,
 * `SYMBOLIC_EXPANSION_CAP` in `library/combinatorics.ts`, is larger; a shader
 * expression has no statement sink for a long product, so this cap is
 * tighter and a larger `k` fails closed.)
 */
const GPU_BINOMIAL_UNROLL_LIMIT = 8;

/**
 * `Binomial(n, k)` / `Choose(n, k)` for a literal non-negative integer `k`,
 * as the GENERALIZED binomial coefficient — the falling factorial
 * `n(n-1)…(n-k+1) / k!`. This is the same closed form the interpreter expands
 * to for a symbolic first operand (`Binomial(x, 2)` → `(x·(x-1))/2`), and it
 * agrees with the interpreter's numeric answers for a real or negative `n`
 * too (`Binomial(5.5, 2)` = 12.375, `Binomial(-1, 2)` = 1) — unlike the JS
 * target's `_SYS.binomial`, a Pascal-triangle table that is integer-only.
 *
 * Anything else declines (D6): a non-literal, negative or non-integer `k` is
 * inert in the interpreter, and a complex-valued `n` has no `vec2` lowering
 * here (the interpreter stays symbolic for it as well).
 */
const gpuBinomial: CompiledFunction<Expression> = ([n, k], compile, target) => {
  if (n === null || n === undefined || k === null || k === undefined)
    throw new Error('Could not compile `Binomial`: need two arguments');
  const kConst = tryGetConstant(k);
  if (kConst === undefined || !Number.isInteger(kConst) || kConst < 0)
    throw new Error(
      `Could not compile \`Binomial\`: only a literal non-negative integer second operand ` +
        `compiles — anything else is inert in the interpreter.`
    );
  if (kConst > GPU_BINOMIAL_UNROLL_LIMIT)
    throw new Error(
      `Could not compile \`Binomial\`: a second operand above ${GPU_BINOMIAL_UNROLL_LIMIT} would ` +
        `unroll to ${kConst} factors.`
    );
  if (BaseCompiler.isComplexValued(n))
    throw new Error(
      `Could not compile \`Binomial\`: a complex first operand has no GPU lowering.`
    );
  // A statically non-finite first operand declines. The interpreter answers
  // every infinite point from its own limit table — `C(±∞, 0) = 1`,
  // `C(+∞, k) = +∞`, `C(−∞, k) = (−1)^k·∞`, `C(~oo, k) = ~oo` — and NaN for a
  // NaN operand. The shader unroll cannot reproduce two of those: `~oo` has
  // no float spelling, and the `k = 0 → 1` fold below would emit `1.0` where
  // a NaN operand must propagate. Check before the `k` special cases so
  // neither fold can emit a value the interpreter does not give. Only a
  // STATICALLY provable non-finite
  // operand declines: a runtime ±∞ reaching a finite-typed binding still
  // unrolls (the documented static-assert class), as no runtime finite guard
  // is emitted — that would change every pure emission.
  if (
    (isNumber(n) && !Number.isFinite(n.re)) ||
    n.type.matches('infinity') ||
    n.type.matches('nan')
  )
    throw new Error(
      `Could not compile \`Binomial\`: a statically non-finite first operand evaluates to NaN in ` +
        `the interpreter, not a falling factorial.`
    );
  if (kConst === 0) {
    // `Binomial(x, 0)` is 1 — but the interpreter still EVALUATES the first
    // operand (probed: `Binomial(Random(), 0)` consumes exactly one draw).
    // Folding the operand away would skip the draw and shift every later
    // value in the shader, and there is no sink for a discarded temporary
    // here, so an impure operand declines instead.
    if (n.isPure === false)
      throw new Error(
        `Could not compile \`Binomial\`: a second operand of 0 discards the first, but an impure ` +
          `(Random) first operand is still drawn by the interpreter.`
      );
    return formatFloat(1, target.language);
  }
  if (kConst === 1) return compile(n);
  // The operand is spliced `k` times — bind an impure (Random-family) one to
  // a hoisted temporary; a pure one compiles directly (byte-identical).
  const c = gpuOperandOnce('Binomial', n, compile, target);
  const factors = [`(${c})`];
  for (let i = 1; i < kConst; i++)
    factors.push(`((${c}) - ${formatFloat(i, target.language)})`);
  let fact = 1;
  for (let i = 2; i <= kConst; i++) fact *= i;
  return `((${factors.join(' * ')}) / ${formatFloat(fact, target.language)})`;
};

/**
 * The base of a SQUARE — the `b` of `b²`, written either as `Power(b, 2)` or
 * as `Square(b)` — or `undefined` when the expression is not a square.
 */
function gpuSquaredBase(expr: Expression): Expression | undefined {
  if (isFunction(expr, 'Square') && expr.ops.length === 1) return expr.ops[0];
  if (
    isFunction(expr, 'Power') &&
    expr.ops.length === 2 &&
    tryGetConstant(expr.ops[1]) === 2
  )
    return expr.ops[0];
  return undefined;
}

/**
 * Compile the COLLECTION (reduce) form of `Sum`/`Product` — no indexing set,
 * the operand itself is the collection (`Sum([3, 4, 5])`, `Sum(v)` for a
 * `vector<3>`). This is what `.total` and a bare list product canonicalize to,
 * and the JavaScript target has lowered it since Tycho item 237; on a shader
 * target the fold is the same one `Max`/`Min` already perform, over the same
 * statically known scalar components (`gpuScalarComponents`).
 *
 * A shader has no dynamic iteration, so everything without a compile-time
 * component list fails closed: an unknown-length list, a matrix, and a
 * fixed-length list whose elements are not shader floats. So does a
 * statically SCALAR operand — the interpreter answers `Sum(x) = x` for one,
 * but a value that is not a collection at all reaching a reduction is a shape
 * the caller did not mean, and the JavaScript target declines it too.
 *
 * The empty collection is the identity (`Sum([]) = 0`, `Product([]) = 1`),
 * matching the interpreter. It is recognized BEFORE the operand is compiled:
 * `[]` lowers to `float[0]()` / `array<f32, 0>()`, which
 * `assertGPUScalarComponents` refuses outright, so compiling it first would
 * decline the whole reduction — the same ordering `compileGPUExtremum` uses.
 */
function compileGPUCollectionReduce(
  kind: 'Sum' | 'Product',
  operand: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const identity = kind === 'Sum' ? '0.0' : '1.0';
  const op = kind === 'Sum' ? ' + ' : ' * ';
  if (operand.isCollection && operand.count === 0) return identity;

  // Summing the components of a SQUARED vector is that vector's dot product
  // with itself: `v.x² + v.y²` is `dot(v, v)`, one builtin in both languages
  // where the component fold writes the square out and then reads each
  // component back out of it. Only a PURE base takes this route, because the
  // emission names the vector twice — a repeated draw from an impure one
  // would shift every later value in the shader — and the width is bounded at
  // 2–4 because WGSL declares `dot` over `vecN` alone.
  //
  // The rewrite reads the square STRUCTURALLY and then compiles the base
  // alone, so it is valid only while the square head still means the builtin
  // one. A caller that supplies its own `Square`/`Power` through `functions`,
  // or excludes that head from folding, keeps the ordinary component fold,
  // which calls the caller's implementation.
  const squared = kind === 'Sum' ? gpuSquaredBase(operand) : undefined;
  const squaredWidth =
    squared === undefined ? undefined : gpuOperandShape(squared);
  if (
    squared !== undefined &&
    squared.isPure &&
    typeof squaredWidth === 'number' &&
    !BaseCompiler.isComplexValued(operand) &&
    !isCallerMapped(operand, target.cse?.harvestOptions) &&
    !target.foldExcludedOps?.has(operand.operator)
  ) {
    let v = compile(squared);
    // A bare identifier is free to name twice. Anything else is bound to a
    // hoisted `vecN` temporary where there is a statement sink, so the vector
    // is built once; with no sink the pure source is written twice, which is
    // what the operand-once convention does everywhere else in this target.
    if (!gpuIsAtomicEmission(v) && BaseCompiler.canHoist(target)) {
      const tv = BaseCompiler.tempVar(target);
      const type =
        target.language === 'wgsl'
          ? `vec${squaredWidth}f`
          : `vec${squaredWidth}`;
      const decl =
        target.language === 'wgsl' ? `var ${tv}: ${type}` : `${type} ${tv}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${v};`);
      v = tv;
    }
    return `dot(${v}, ${v})`;
  }

  const shape = gpuOperandShape(operand);
  const code = compile(operand);
  // Non-scalar by the shape analysis, OR by the emitted source: a `Range`
  // types only as `indexed_collection` (no `list` dimensions), which
  // `gpuOperandShape` reads as a scalar, but it lowers to an array
  // CONSTRUCTOR — and a constructor is exactly what a reduction can consume.
  // (The same reading `compileGPUExtremum` takes of its operands.)
  //
  // A COMPLEX value is excluded from that second reading, and the exclusion is
  // load-bearing: it lowers to `vec2(re, im)`, which matches the aggregate
  // constructor pattern while being a single NUMBER in the complex convention,
  // not a two-cell collection. Without this, `Sum(i)` folded the real and
  // imaginary parts into `(0.0 + 1.0)` and answered a real `1.0` where the
  // interpreter answers `i` — a silent disagreement, not a decline. (The
  // `Max`/`Min` reduction never saw this: a real-only guard rejects a complex
  // operand of those heads before the lowering runs.)
  const call = gpuTopLevelCall(code);
  const isAggregate =
    !BaseCompiler.isComplexValued(operand) &&
    (shape !== 'scalar' ||
      (call !== undefined && GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)));
  if (!isAggregate)
    throw new Error(
      `Could not compile \`${kind}\`: the operand \`${operand.toString()}\` is not a collection ` +
        `(type \`${operand.type.toString()}\`), so there is nothing to ` +
        `reduce over — this is the collection form of ${kind}, which takes ` +
        `no indexing set.`
    );

  const comps = gpuScalarComponents(operand, code, target);
  if (comps === undefined)
    throw new Error(
      `Could not compile \`${kind}\`: the operand \`${operand.toString()}\` lowers to a shader ` +
        `${gpuShapeName(shape)} with no compile-time component list, so ` +
        `there is nothing for the reduction to fold over — a shader has no ` +
        `dynamic iteration here.`
    );
  // Each component is parenthesized, and so is the fold as a whole. A
  // component is a constructor ARGUMENT compiled at its own precedence, so its
  // source can be bare infix arithmetic (`float[2](x + 1.0, y)`), and the
  // result is spliced into whatever context the caller has. Joining the raw
  // texts let a neighbouring operator bind into a component: `Sum([x + 1])`
  // returned a bare `x + 1.0`, so `2·Sum([x + 1])` emitted `2.0 * x + 1.0` —
  // `2x + 1` where the interpreter computes `2(x + 1)`. A `Product` fold
  // reassociates the same way from the inside (`(a + b) * c` written as
  // `a + b * c`).
  //
  // `gpuScalarComponents` never answers an EMPTY list (a zero-argument
  // constructor answers `undefined` there), and the empty collection already
  // returned the identity above, so one component is the smallest fold.
  return `(${comps.map((c) => `(${c})`).join(op)})`;
}

/** Opaque source or effects in the body may change a compiler-owned counter. */
function gpuCounterIsStable(
  expr: Expression,
  index: string,
  target: CompileTarget<Expression>,
  depth = 0
): boolean {
  if (depth > 64) return false;
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) {
    if (expr.symbol === index) return true;
    const ref = target.var(expr.symbol);
    return (
      !target.varsKeys?.has(expr.symbol) &&
      (ref === undefined || gpuIsAtomicEmission(ref))
    );
  }
  if (
    !isFunction(expr) ||
    !expr.isPure ||
    isCallerMapped(expr) ||
    target.foldExcludedOps?.has(expr.operator)
  )
    return false;
  const fn = GPU_FUNCTIONS[expr.operator];
  const op = GPU_OPERATORS[expr.operator];
  if (
    (fn === undefined && op === undefined) ||
    target.functions?.(expr.operator) !== fn ||
    (op !== undefined && target.operators?.(expr.operator) !== op)
  )
    return false;
  return expr.ops.every((x) => gpuCounterIsStable(x, index, target, depth + 1));
}

/**
 * Fold a bound only when its literal has the same exact value in binary32
 * and in host arithmetic. Keep the counter and its final increment in i32
 * range; other values retain the existing shader floor/conversion path.
 */
function gpuBoundConstant(
  expr: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  const literal = BaseCompiler.bigOpBoundConstant(expr);
  if (literal !== undefined) return literal;
  const value = BaseCompiler.foldedRealNumber(expr, target);
  if (
    value === undefined ||
    !Number.isFinite(value) ||
    Math.fround(value) !== value
  )
    return undefined;
  const bound = Math.floor(value);
  return bound >= -(2 ** 31) && bound < 2 ** 31 - 1 ? bound : undefined;
}

/**
 * Is this compiled loop bound already ONE READ at run time, so that binding it
 * to a local would cost a line and save nothing?
 *
 * True for a numeric literal, a bare identifier, and any nesting of the
 * CONVERSION and ROUNDING spellings around one of those — `K`, `int(K)`,
 * `i32(K)`, `int(floor(K))`. Those are the spellings `boundCode` produces for
 * a caller-declared parameter or a bare symbolic bound; each is a register
 * read plus at most a conversion, which every driver folds.
 *
 * False as soon as the bound holds an operator, a second argument, or any
 * other call (`int(floor(K + -1.0))`, `int(floor(_fn_g(x)))`): the loop
 * condition would otherwise re-evaluate the whole expression on every
 * iteration.
 */
const GPU_BOUND_ONE_READ_CALLS = new Set([
  'int',
  'i32',
  'u32',
  'uint',
  'float',
  'f32',
  'floor',
]);

function gpuBoundIsOneRead(code: string): boolean {
  const s = code.trim();
  if (/^-?\d+(?:\.\d*)?$/.test(s)) return true;
  if (/^[A-Za-z_]\w*$/.test(s)) return true;
  const call = /^([A-Za-z_]\w*)\((.*)\)$/.exec(s);
  if (call === null || !GPU_BOUND_ONE_READ_CALLS.has(call[1])) return false;
  // The matched parentheses must be the call's OWN: without this check
  // `int(a) + int(b)` would read as a call whose argument is `a) + int(b`.
  const inner = call[2];
  let depth = 0;
  for (const ch of inner) {
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      if (depth === 0) return false;
      depth -= 1;
    }
  }
  return depth === 0 && gpuBoundIsOneRead(inner);
}

/**
 * The declaration of one loop-invariant binding
 * (`BaseCompiler.hoistLoopInvariants`) in the shader language.
 *
 * The type is read from the NODE the binding was compiled from, not guessed
 * from its code. `gpuTypeOfValue` answers `undefined` for a value with no
 * static shader shape; such a class is refused before a binding is minted (the
 * `accept` predicate the callers pass), so it never reaches here — the
 * fallback keeps the scalar spelling rather than emit nothing.
 */
function gpuInvariantDeclaration(
  name: string,
  code: string,
  node: Expression,
  isWGSL: boolean
): string {
  const type = gpuTypeOfValue(node, isWGSL) ?? (isWGSL ? 'f32' : 'float');
  return isWGSL
    ? `let ${name}: ${type} = ${code};`
    : `${type} ${name} = ${code};`;
}

/**
 * Compile a Sum or Product expression for GPU targets.
 *
 * Two compilation strategies:
 * - **Unrolled** (constant bounds, range ≤ GPU_UNROLL_LIMIT): pure inline
 *   expression with no statements, usable as a subexpression.
 * - **For-loop** (large or symbolic bounds): multi-line statement block
 *   ending with `return <acc>`, suitable for `compileFunction`.
 *
 * Complex-valued bodies are not supported (would require vec2 accumulation
 * with complex preamble helpers) and throw at compile time.
 */
function compileGPUSumProduct(
  kind: 'Sum' | 'Product',
  args: ReadonlyArray<Expression>,
  _compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (!args[0]) throw new Error(`Could not compile \`${kind}\`: no body`);
  // No indexing set: the operand IS the collection to reduce
  // (`Sum([3, 4, 5])`), not a body indexed by one.
  if (!args[1])
    return compileGPUCollectionReduce(kind, args[0], _compile, target);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): scalar accumulation over arrays
  // would silently produce a wrong value. Reached only for the indexed form
  // (the `!args[1]` guard above returns for the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  if (BaseCompiler.isComplexValued(args[0]))
    throw new Error(
      `Could not compile \`${kind}\`: complex-valued body not supported in GPU targets`
    );

  // Multi-index Sum/Product (more than one indexing set) would drop the
  // trailing clauses. Fail closed rather than emit code with a dangling
  // index.
  if (args.length > 2)
    throw new Error(
      `Could not compile \`${kind}\`: multi-index (${args.length - 1} indexing sets) is not supported in GPU targets`
    );

  const limitsExpr = args[1];
  if (!isFunction(limitsExpr, 'Limits'))
    throw new Error(
      `Could not compile \`${kind}\`: expected Limits indexing set`
    );

  const limitsOps = limitsExpr.ops;
  const index = isSymbol(limitsOps[0]) ? limitsOps[0].symbol : '_';
  assertFiniteGPUBound(kind, limitsOps[1], 'lower');
  assertFiniteGPUBound(kind, limitsOps[2], 'upper');
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`. Reading one folded
  // `F(i) = Σ_{m=1..i} m` to `float _fn_F(float i) { return 0.0; }`.
  const lowerNum = gpuBoundConstant(limitsOps[1], target);
  const upperNum = gpuBoundConstant(limitsOps[2], target);

  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0.0' : '1.0';
  const isWGSL = target.language === 'wgsl';
  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  if (bothConstant && lowerNum > upperNum) return identity;

  const canProveCounter = gpuCounterIsStable(args[0], index, target);

  // Unroll small constant ranges — pure inline expression
  if (bothConstant && upperNum - lowerNum + 1 <= GPU_UNROLL_LIMIT) {
    const emitTerms = (
      invariants: ReadonlyArray<LoopInvariantBinding>
    ): string => {
      // A subexpression the terms all share because it mentions no index is
      // declared once, ahead of them. Every unrolled term runs, so the local is
      // evaluated exactly when the terms are.
      for (const [name, code, node] of invariants)
        BaseCompiler.hoistStatement(
          target,
          gpuInvariantDeclaration(name, code, node, isWGSL)
        );
      const terms: string[] = [];
      // Statements a term hoists (a nested loop-form Sum with a symbolic bound)
      // are drained into the ENCLOSING sink: the index is substituted as a
      // literal in `var` below, so nothing a term emits refers to the bound name,
      // and the statements are valid where the unrolled expression itself is.
      // Without an enclosing sink they have nowhere to go, and the term falls
      // back to the legacy multi-line block — which `compileValueOperand` then
      // rejects, as before (fail closed, D6).
      //
      // A term that hoists is drained IMMEDIATELY and its remaining value bound
      // to a temporary, which is what enters the combined expression. Collecting
      // every term's statements first and draining them at the end reordered the
      // unroll — term1-loop, term2-loop, term1-rest, term2-rest — and
      // `_gpu_rnd_draw` advances a runtime counter, so a draw in term2's loop
      // would move ahead of a draw in term1's remainder and every later value in
      // the shader would shift.
      for (let k = lowerNum; k <= upperNum; k++) {
        const kStr = formatGPUNumber(k);
        const termBoundVars = BaseCompiler.withBoundNames(target, [index]);
        const termSink = {
          stmts: [] as string[],
          boundVars: termBoundVars,
          unit: args[0],
        };
        const innerTarget: CompileTarget<Expression> = {
          ...target,
          var: (id) => (id === index ? kStr : target.var(id)),
          boundVars: termBoundVars,
          hoist: BaseCompiler.canHoist(target) ? termSink : undefined,
        };
        if (canProveCounter)
          recordGPUCounter(innerTarget, index, k, k, String(k));
        let code: string;
        try {
          // Each term must leave a value after any nested loops are hoisted.
          code = BaseCompiler.compileValueOperand(args[0], innerTarget);
        } finally {
          clearGPUCounters(innerTarget);
        }
        if (termSink.stmts.length === 0) {
          terms.push(`(${code})`);
          continue;
        }
        // The sink is non-empty only when `canHoist(target)` held above.
        //
        // A term whose value is already a bare name — a block term stores its
        // value in a temporary the hoisted statements declare (`valueBlock`)
        // — is read through that name; binding it again would only copy it.
        if (/^[A-Za-z_$][\w$]*$/.test(code)) {
          BaseCompiler.hoistStatement(target, ...termSink.stmts);
          terms.push(`(${code})`);
          continue;
        }
        const tv = BaseCompiler.tempVar(target);
        const scalar = isWGSL ? 'f32' : 'float';
        const decl = isWGSL ? `var ${tv}: ${scalar}` : `${scalar} ${tv}`;
        BaseCompiler.hoistStatement(
          target,
          ...termSink.stmts,
          `${decl} = ${code};`
        );
        terms.push(`(${tv})`);
      }
      return `(${terms.join(` ${op} `)})`;
    };
    // The bindings are STATEMENTS, so they can only be emitted where the
    // enclosing position accepts hoisted statements. Without a sink the
    // unrolled expression stands alone and every term keeps its own copy of
    // the shared subexpression, exactly as before.
    if (!BaseCompiler.canHoist(target)) return emitTerms([]);
    return BaseCompiler.hoistLoopInvariants(
      args[0],
      [index],
      target,
      emitTerms,
      (node) => gpuTypeOfValue(node, isWGSL) !== undefined
    ).result;
  }

  // For-loop form. A shader has no expression-level loop, so this emits
  // STATEMENTS. When the enclosing position accepts hoisted statements (Tycho
  // item 110) they go to the sink and the loop's accumulator is returned as an
  // ordinary expression — so `1 + \sum…` and `0.03\sum…` compose. Otherwise the
  // legacy bare block is returned, valid only as a top-level function body.
  const acc = BaseCompiler.tempVar(target);
  const floatType = isWGSL ? 'f32' : 'float';
  const intType = isWGSL ? 'i32' : 'int';

  // The body binds `index`, so it gets its OWN sink: a statement it hoists
  // belongs inside this loop (a nested Sum), not ahead of it.
  const bodyBoundVars = BaseCompiler.withBoundNames(target, [index]);
  const bodySink = {
    stmts: [] as string[],
    boundVars: bodyBoundVars,
    unit: args[0],
  };
  const bodyTarget: CompileTarget<Expression> = {
    ...target,
    var: (id) =>
      id === index
        ? isWGSL
          ? `f32(${index})`
          : `float(${index})`
        : target.var(id),
    boundVars: bodyBoundVars,
    hoist: bodySink,
  };
  if (canProveCounter && bothConstant)
    recordGPUCounter(bodyTarget, index, lowerNum, upperNum, index);
  // A subexpression of the body that mentions the index nowhere has the same
  // value in every iteration, so it is computed ONCE, in a local declared
  // ahead of the loop, and the body reads that local. Without this the body's
  // own temporaries are all declared INSIDE the loop and re-evaluated per
  // iteration — the Tycho code-generation audit of 2026-09-08 measured a
  // heat-map body whose fifteen locals were index-free to the last one.
  //
  // Unlike the JavaScript and interval targets this needs no empty-range
  // exit. Those guard against an error a binding raises when the loop body
  // never ran; shader arithmetic raises nothing (a division by zero answers an
  // infinity, an out-of-domain call a NaN), so evaluating an invariant whose
  // loop turns out to run zero times computes a value nobody reads.
  const { bindings: invariants, result: body } =
    BaseCompiler.hoistLoopInvariants(
      args[0],
      [index],
      target,
      () => {
        try {
          if (target.cse?.enabled) {
            BaseCompiler.openCseSession(
              args[0],
              bodyTarget,
              target.cse.harvestOptions
            );
            return BaseCompiler.compileCseRoot(args[0], bodyTarget, 0, () =>
              BaseCompiler.compileValueOperand(args[0], bodyTarget)
            );
          }
          return BaseCompiler.compileValueOperand(args[0], bodyTarget);
        } finally {
          clearGPUCounters(bodyTarget);
        }
      },
      (node) => gpuTypeOfValue(node, isWGSL) !== undefined
    );

  // Compiled BEFORE the loop statements are pushed, so anything the bounds
  // themselves hoist lands ahead of the loop that consumes them.
  //
  // The counter is declared as an integer, but a non-literal bound normally
  // compiles to a FLOAT expression (shader scalar math is float, and a
  // constant-folded `Length(L)` is spelled `3.0`). Neither GLSL ES nor WGSL
  // promotes int to float, so `int j = K; j <= K + -1.0` is a driver-side
  // type error that rejects the whole shader behind `success: true` (Tycho
  // item 191). Convert such a bound to the counter's type in the header —
  // `int(floor(x))` / `i32(floor(x))` — flooring first so a non-integer bound
  // reads the way the JavaScript target's `Math.floor(bound)` and the
  // constant arm's `Math.floor` (`BaseCompiler.bigOpBoundConstant`) do
  // (`int(x)` alone truncates toward zero, disagreeing for a negative bound).
  //
  // The exception is a bound that is ALREADY a shader integer: a name the
  // caller declared `int`/`i32` (a `compileFunction` parameter, a shader
  // uniform). Ordinary references to it go through a float conversion
  // (`gpuDeclaredBodyTarget`), which the header does not want — `floor()`
  // takes only a float, and `int(floor(float(K)))` is a needless round trip
  // — so such a bound is used bare (a `uint`/`u32` is converted with
  // `int(K)`/`i32(K)`, no flooring needed). A declared bound with any other
  // type (`bool`, a vector) is no loop bound at all and fails closed.
  const boundCode = (bound: Expression, which: 'lower' | 'upper'): string => {
    const declared = gpuDeclaredTypeOf(bound);
    const value = declared?.value;
    if (
      declared === undefined ||
      (value !== undefined && value.width === 1 && value.element === 'f')
    ) {
      const code = BaseCompiler.compile(bound, target);
      return isWGSL ? `i32(floor(${code}))` : `int(floor(${code}))`;
    }
    // `var()` binds an integer-declared scalar to `float(K)`; the header wants
    // the integer itself, so it reads the raw slot.
    if (value !== undefined && value.width === 1 && value.element === 'i')
      return declared.ref;
    if (value !== undefined && value.width === 1 && value.element === 'u')
      return isWGSL ? `i32(${declared.ref})` : `int(${declared.ref})`;
    throw new Error(
      `Could not compile \`${kind}\`: the ${which} bound \`${bound.toString()}\` is declared ` +
        `"${declared.spelling}" by the caller, which is not ` +
        `a scalar number — a loop bound must be one.`
    );
  };
  const lowerStr =
    lowerNum !== undefined
      ? String(lowerNum)
      : boundCode(limitsOps[1], 'lower');
  const upperStr =
    upperNum !== undefined
      ? String(upperNum)
      : boundCode(limitsOps[2], 'upper');

  // The loop index is declared and referenced bare — reject a reserved name
  // (fail closed, D6) rather than emit a shader that fails to compile.
  gpuCheckIdentifier(index, target.language);
  const accDecl = isWGSL ? `var ${acc}: ${floatType}` : `${floatType} ${acc}`;
  const indexDecl = isWGSL ? `var ${index}: ${intType}` : `${intType} ${index}`;

  // A COMPUTED upper bound is bound to a local first. Both languages evaluate
  // the loop condition on every iteration, so leaving the expression there
  // recomputes it once per step — `n <= int(floor(K + -1.0))` runs the
  // addition and the `floor` as many times as the loop runs. A bound that is
  // already ONE READ (a literal, a bare name, a conversion around one of
  // those) is left in place: a local would only add a line and hide which
  // name the header tests.
  const boundVar =
    upperNum === undefined && !gpuBoundIsOneRead(upperStr)
      ? BaseCompiler.tempVar(target)
      : '';
  const boundDecl =
    boundVar === ''
      ? []
      : [
          isWGSL
            ? `let ${boundVar}: ${intType} = ${upperStr};`
            : `${intType} ${boundVar} = ${upperStr};`,
        ];
  const upperRef = boundVar === '' ? upperStr : boundVar;

  const loop = [
    ...boundDecl,
    ...invariants.map(([name, code, node]) =>
      gpuInvariantDeclaration(name, code, node, isWGSL)
    ),
    `${accDecl} = ${identity};`,
    `for (${indexDecl} = ${lowerStr}; ${index} <= ${upperRef}; ${index}++) {`,
    ...bodySink.stmts.map((s) =>
      s
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n')
    ),
    `  ${acc} ${op}= ${body};`,
    `}`,
  ];

  if (BaseCompiler.canHoist(target)) {
    BaseCompiler.hoistStatement(target, loop.join('\n'));
    return acc;
  }
  return [...loop, `return ${acc};`].join('\n');
}

/**
 * Compile one operand of the `Multiply` lowering so that it binds as a single
 * factor next to a ` * `.
 *
 * The `compile` callback a `CompiledFunction` handler is handed carries no
 * precedence context — it compiles every sub-expression at precedence 0 — and
 * `foldTerms` then joins the resulting strings with a bare ` * `. A factor
 * whose own emission is a looser infix form was therefore spliced raw:
 * `Multiply(Add(t, 1), Tuple(x, 0))` emitted `t + 1.0 * vec2(x, 0.0)`, which
 * the shader reads as `t + (1.0 * vec2(x, 0.0))` — the float broadcast into
 * the vector, the wrong geometry, behind `success: true`.
 *
 * Compiling the operand at the binding power of `*` instead makes the shared
 * compiler add the parentheses itself, by the same `op[1] < prec` rule the
 * infix path applies to its own operands. Everything else about the call
 * matches the callback the handler was given: with no operand index, that
 * callback is exactly `BaseCompiler.compileValueOperand(expr, target)`, and
 * the `target` a handler receives is the one the callback closes over (an
 * element-wise broadcast hands the handler the same `innerTarget` its callback
 * uses), so no CSE or binding bookkeeping is skipped by calling it directly.
 */
function gpuMultiplicativeFactor(
  operand: Expression,
  target: CompileTarget<Expression>
): string {
  return BaseCompiler.compileValueOperand(
    operand,
    target,
    GPU_OPERATORS.Multiply[1]
  );
}

/**
 * GPU shader functions shared by GLSL and WGSL.
 *
 * Both languages share identical built-in math functions. Language-specific
 * functions (inversesqrt naming, mod, vector constructors) are provided
 * by subclass overrides.
 *
 * Complex numbers are represented as vec2(re, im). Functions that can
 * operate on complex values check `BaseCompiler.isComplexValued()` and
 * dispatch to `_gpu_c*` helper functions from the complex preamble.
 */
// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
export const GPU_FUNCTIONS: CompiledFunctions<Expression> = {
  __proto__: null as never,
  // Variadic arithmetic (for function-call form, e.g., with vectors)
  Add: (args, compile, target) => {
    if (args.length === 0) return '0.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => compile(x)),
        '0.0',
        '+',
        target.language
      );
    }
    // Opaque complex operand — fall back to promote-and-add. Tested BEFORE
    // decomposing: `tryGetComplexParts` compiles each operand it decomposes,
    // and the whole decomposition is discarded here, so testing after would
    // compile every other operand TWICE. For an impure (Random-family) operand
    // that is an extra draw, and the discarded compile's hoisted statement
    // stays in the shader as an orphan feeding nothing.
    if (args.some((a) => isOpaqueComplexOperand(a))) {
      const v2 = gpuVec2(target);
      return args
        .map((a) => {
          const code = compile(a);
          return BaseCompiler.isComplexValued(a) ? code : `${v2}(${code}, 0.0)`;
        })
        .join(' + ');
    }
    // Every operand decomposes — collect re and im parts, fold each
    const parts = args.map((a) =>
      tryGetComplexParts(a, compile, target.language)!
    );
    const reParts: string[] = [];
    const imParts: string[] = [];
    for (const p of parts) {
      if (p.re !== null) reParts.push(p.re);
      if (p.im !== null) imParts.push(p.im);
    }
    const reSum = foldTerms(reParts, '0.0', '+', target.language);
    const imSum = foldTerms(imParts, '0.0', '+', target.language);
    return `${gpuVec2(target)}(${reSum}, ${imSum})`;
  },
  Multiply: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const anyComplex = args.some((a) => BaseCompiler.isComplexValued(a));
    if (!anyComplex) {
      return foldTerms(
        args.map((x) => gpuMultiplicativeFactor(x, target)),
        '1.0',
        '*',
        target.language
      );
    }
    // Special case: scalars * imaginary_factor → vec2(0.0, product)
    // Recognizes both ImaginaryUnit symbol and Complex(0, k) literals
    const iIndex = args.findIndex(
      (op) =>
        isSymbol(op, 'ImaginaryUnit') ||
        (isNumber(op) && op.re === 0 && op.isComplex)
    );
    if (iIndex >= 0) {
      const iFactor = args[iIndex];
      const iScale = isSymbol(iFactor, 'ImaginaryUnit')
        ? 1
        : (iFactor as any).im;
      const realFactors = args.filter((_, i) => i !== iIndex);
      const v2 = gpuVec2(target);
      if (realFactors.length === 0)
        return `${v2}(0.0, ${formatFloat(iScale, target.language)})`;
      const factors = realFactors.map((f) =>
        gpuMultiplicativeFactor(f, target)
      );
      if (iScale !== 1) factors.unshift(formatFloat(iScale, target.language));
      const imCode = foldTerms(factors, '1.0', '*', target.language);
      return `${v2}(0.0, ${imCode})`;
    }
    // General complex multiply: separate real scalars and complex operands
    const realCodes: string[] = [];
    const complexCodes: string[] = [];
    for (const a of args) {
      if (BaseCompiler.isComplexValued(a)) complexCodes.push(compile(a));
      else realCodes.push(gpuMultiplicativeFactor(a, target));
    }
    const scalarCode = foldTerms(realCodes, '1.0', '*', target.language);
    // Pairwise reduce complex operands
    let result = complexCodes[0];
    for (let i = 1; i < complexCodes.length; i++) {
      result = `_gpu_cmul(${result}, ${complexCodes[i]})`;
    }
    // Apply scalar factor
    if (scalarCode !== '1.0') result = `(${scalarCode} * ${result})`;
    return result;
  },
  // No Subtract function handler — Subtract canonicalizes to Add+Negate.
  // The operator entry in GPU_OPERATORS handles any edge cases.
  Divide: (args, compile, target) => {
    if (args.length === 0) return '1.0';
    if (args.length === 1) return compile(args[0]);
    const ac = BaseCompiler.isComplexValued(args[0]);
    const bc = args.length >= 2 && BaseCompiler.isComplexValued(args[1]);
    if (!ac && !bc) {
      if (args.length === 2) {
        const a = tryGetConstant(args[0]);
        const b = tryGetConstant(args[1]);
        if (a !== undefined && b !== undefined && b !== 0)
          return formatFloat(a / b, target.language);
        if (b === 1) return compile(args[0]);
        // `compile()` emits sub-expressions without outer parentheses — wrap
        // before splicing next to `/`.
        return `(${compile(args[0])}) / (${compile(args[1])})`;
      }
      let result = `(${compile(args[0])})`;
      for (let i = 1; i < args.length; i++)
        result = `${result} / (${compile(args[i])})`;
      return result;
    }
    // Complex division
    if (ac && bc) return `_gpu_cdiv(${compile(args[0])}, ${compile(args[1])})`;
    if (ac && !bc) return `((${compile(args[0])}) / (${compile(args[1])}))`;
    const v2 = gpuVec2(target);
    return `_gpu_cdiv(${v2}(${compile(args[0])}, 0.0), ${compile(args[1])})`;
  },
  Negate: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Negate`: no argument');
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c, target.language);
    if (isNumber(x) && x.isComplex) {
      return `${gpuVec2(target)}(${formatFloat(
        -x.re,
        target.language
      )}, ${formatFloat(-x.im, target.language)})`;
    }
    if (isSymbol(x, 'ImaginaryUnit')) return `${gpuVec2(target)}(0.0, -1.0)`;
    return `(-(${compile(x)}))`;
  },

  // Standard math functions with complex dispatch
  // Note: `Abs` of a fixed-arity point never reaches this handler — the
  // shared compiler rewrites `Abs(Tuple)` → `Norm` (base-compiler.ts) so the
  // point compiles through the `Norm` codegen below (Tycho item 74).
  Abs: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `length(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `abs(${compile(args[0])})`;
  },
  Arccos: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacos(${compile(args[0])})`;
    // Real operand, complex RESULT (`Arccos(2)`, or a real symbol of unknown
    // magnitude): outside `[−1, 1]` the value is complex, so the node is typed
    // `complex` and the parent emits the `vec2` convention — a scalar
    // `acos` there is broadcast against a `vec2` and yields garbage. See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Arccos', args))
      return `_gpu_cacos(${gpuComplexOperand(args[0], compile, target)})`;
    return `acos(${compile(args[0])})`;
  },
  Arcsin: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casin(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcsin', args))
      return `_gpu_casin(${gpuComplexOperand(args[0], compile, target)})`;
    return `asin(${compile(args[0])})`;
  },
  Arctan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catan(${compile(args[0])})`;
    return `atan(${compile(args[0])})`;
  },
  // Positional access. The lowering CONSUMES its aggregate base — it indexes
  // INTO it — so the operand shapes it was handed are no longer in the
  // emission (a `vec3` base becomes a scalar `v.y`, a `float[7]` base a
  // `_gpu_at7(…)` call), and it declares that with `markAggregateConsuming`
  // rather than letting the gate infer it. See `compileGPUAt`.
  At: markAggregateConsuming((args, compile, target) =>
    compileGPUAt(args, compile, target)
  ),
  Ceil: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('ceil', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `ceil(${compile(args[0])})`;
  },
  // The native `clamp` keeps the operand-shape rules the shape gate knows
  // (`clamp(genType, float, float)`). CE defines `Clamp(x, lo, hi)` as
  // `min(max(x, lo), hi)`, which is `hi` when `lo > hi`, and its type handler
  // claims that range (`extremumRangeType`). WGSL defines `clamp` as that
  // same `min(max())`; GLSL leaves the result undefined when `lo > hi`
  // (common drivers compute `min(max())`), so for such bounds a GLSL result
  // may disagree with the claimed type.
  Clamp: 'clamp',
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccos(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0]);
    if (u !== undefined) return `_gpu_cospi(${compile(u)})`;
    return `cos(${compile(args[0])})`;
  },
  // In radian mode CE's `Degrees` converts degrees→radians (Degrees(180) =
  // π), which is GLSL's `radians()`. GLSL's `degrees()` is the inverse
  // (rad→deg). In the other angular units `rewriteAngularUnit` replaces the
  // `Degrees` node before codegen, so this lowering is not reached.
  Degrees: 'radians',
  Exp: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cexp(${compile(args[0])})`;
    return `exp(${compile(args[0])})`;
  },
  Exp2: 'exp2',
  // Component access — assumes the argument compiles to a vec2/vec3/vec4
  // (the common case for 2D/3D points). For 5+-element tuples that compile
  // to `float[N]` arrays, swizzle access is invalid GLSL and the shader
  // will fail to compile; that's an edge case `First`/`Second`/`Third`
  // aren't designed for. Vec swizzles are identical between GLSL and WGSL.
  First: (args, compile) => gpuSwizzle(compile(args[0]), 'x'),
  Second: (args, compile) => gpuSwizzle(compile(args[0]), 'y'),
  Third: (args, compile) => gpuSwizzle(compile(args[0]), 'z'),
  Last: (args, compile) => compileGpuLast(args[0], compile),
  // Point-coordinate accessors. On the GPU a point is a `vec2`/`vec3`/`vec4`,
  // so a single point maps to the same swizzle as First/Second/Third. A list of
  // points is not a GPU value: emitting a swizzle on it produces invalid shader
  // source, so a list-of-points operand fails closed rather than compiling
  // to garbage behind `success: true`.
  PointX: (args, compile, target) =>
    compilePointSwizzle(args[0], 'x', compile, target),
  PointY: (args, compile, target) =>
    compilePointSwizzle(args[0], 'y', compile, target),
  PointZ: (args, compile, target) =>
    compilePointSwizzle(args[0], 'z', compile, target),
  Floor: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('floor', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `floor(${compile(args[0])})`;
  },
  Fract: 'fract',
  Ln: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cln(${compile(args[0])})`;
    // PROVABLY negative real operand, complex result (`a := -2` → `Ln(a)` is
    // `complex`): the parent emits the `vec2` convention. An operand of
    // merely UNKNOWN sign keeps the scalar `log` (pinned; the
    // `isComplexValued` Sqrt/Ln/Log carve-out makes the parent agree). See
    // `gpuResultIsComplexValued`.
    if (args[0]?.isNegative === true && gpuResultIsComplexValued('Ln', args))
      return `_gpu_cln(${gpuComplexOperand(args[0], compile, target)})`;
    return `log(${compile(args[0])})`;
  },
  Log2: 'log2',
  // GLSL/WGSL `min`/`max` are strictly 2-argument builtins; a variadic
  // `max(a, b, c)` is invalid shader source. Fold 3+ arguments into a nest of
  // 2-argument calls: `max(max(a, b), c)`. A COLLECTION operand makes these a
  // reduction rather than a componentwise fold — see `compileGPUExtremum`.
  // `markAggregateConsuming`: the reduction DESTRUCTURES its collection
  // operands, so the generic shape gate must not judge the emission against
  // operand shapes the emission no longer contains (`GPU_AGGREGATE_CONSUMING`).
  Max: markAggregateConsuming((args, compile, target) =>
    compileGPUExtremum('max', 'Max', args, compile, target)
  ),
  Min: markAggregateConsuming((args, compile, target) =>
    compileGPUExtremum('min', 'Min', args, compile, target)
  ),
  // Element-wise max/min — genuinely COMPONENTWISE, unlike `Max`/`Min` above,
  // so the native fold is the right lowering for a `vecN` operand too. Both
  // require at least two operands (a lone collection is a `Max`/`Min`, and CE
  // rejects `ElementMax([1,2,3])` as missing an argument), so the reduction
  // case does not arise. (`Clamp` is mapped to the native `clamp` above.)
  ElementMax: (args, compile, target) =>
    foldNaryBuiltin('max', 'ElementMax', args, compile, gpuShapeRules(target)),
  ElementMin: (args, compile, target) =>
    foldNaryBuiltin('min', 'ElementMin', args, compile, gpuShapeRules(target)),
  Mix: 'mix',
  // Control-flow forms — the base compiler's default emits a JS ternary and a
  // bare `NaN`, neither of which is valid GPU code (WGSL has no `?:`, and no
  // shader language has a `NaN` identifier). Emit `select(...)` for WGSL and a
  // language-appropriate NaN.
  //
  // DIVERGENCE (documented, CO-P2-24): a shader cannot throw. Where the
  // interpreter throws on a non-boolean/NaN `Which`/`When` condition, the GPU
  // target instead falls through to the documented fail-closed value (the else
  // branch / NaN) — the JS target aligns via a runtime throw, which is not
  // expressible here.
  If: (args, compile, target) => {
    if (args.length !== 3)
      throw new Error('Could not compile `If`: wrong number of arguments');
    gpuAssertSelectableArms('If', [args[1], args[2]]);
    // With one complex arm, a real arm is lifted to `vec2(v, 0.0)`.
    const complex = gpuSelectionIsComplex([args[1], args[2]]);
    const arm = (i: 1 | 2): string =>
      gpuSelectionArm('If', args[i], compile(args[i], i), complex, target);
    // An arm that needs statements, or that repeats a subexpression a
    // ternary would expand once per occurrence, takes the statement form;
    // the clause list is in `Which` shape, so its position 3 is the `If`
    // node's operand 2.
    if (
      gpuNeedsStatements(args[1]) ||
      gpuNeedsStatements(args[2]) ||
      (gpuCanPlaceStatement(target) &&
        (gpuArmSharesWork(args[1]) || gpuArmSharesWork(args[2])))
    ) {
      const statement = compileGPUStatementSelection(
        [args[0], args[1], args[0].engine.True, args[2]],
        (e, i) =>
          i === 1 || i === 3
            ? gpuSelectionArm(
                'If',
                e,
                compile(e, i === 3 ? 2 : i),
                complex,
                target
              )
            : compile(e, i),
        target
      );
      if (statement !== undefined) return statement;
    }
    // The condition is evaluated unconditionally, so it may hoist; the two arms
    // are selected and must not (see `compileGPUConditionalArm`). Operand
    // indices preserve their CSE regions, allowing reuse of outer bindings.
    return gpuConditional(
      compile(args[0], 0),
      compileGPUConditionalArm('If', () => arm(1), target),
      compileGPUConditionalArm('If', () => arm(2), target),
      target
    );
  },
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `When`: expected exactly 2 arguments (expr, cond)'
      );
    // `When` is deliberately NOT a selection form (elementwise-Which design
    // §5): its condition must be a scalar boolean. A provably collection-valued
    // condition would otherwise emit garbage (`(vec2(True, False)) ? …`).
    BaseCompiler.assertScalarCondition(args[1]);
    if (isSymbol(args[1], 'True')) return `(${compile(args[0], 0)})`;
    // The masked branch's NaN must match the value's SHAPE (a tuple-valued
    // body compiles to a vecN) — see `gpuNaNFor` (Tycho item 49).
    if (isSymbol(args[1], 'False')) return gpuNaNFor(args[0], target);
    // A value that needs statements takes the statement form; the clause
    // list is in `Which` shape (condition, value), the `When` operands the
    // other way round.
    if (
      gpuNeedsStatements(args[0]) ||
      (gpuCanPlaceStatement(target) && gpuArmSharesWork(args[0]))
    ) {
      const statement = compileGPUStatementSelection(
        [args[1], args[0]],
        (e, i) => compile(e, i === 0 ? 1 : 0),
        target
      );
      if (statement !== undefined) return statement;
    }
    return gpuConditional(
      compile(args[1], 1),
      compileGPUConditionalArm('When', () => compile(args[0], 0), target),
      gpuNaNFor(args[0], target),
      target
    );
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error(
        'Could not compile `Which`: expected condition/value pairs'
      );
    gpuAssertSelectableArms(
      'Which',
      args.filter((_, i) => i % 2 === 1)
    );
    // With one complex value, a real value is lifted to `vec2(v, 0.0)`, and
    // the fall-through NaN is a `vec2` too.
    const complex = gpuSelectionIsComplex(args.filter((_, i) => i % 2 === 1));
    const value = (i: number): string =>
      gpuSelectionArm('Which', args[i], compile(args[i], i), complex, target);
    // An arm, or a condition past the first, that needs statements takes the
    // statement form (`compileGPUStatementSelection`); the ternary chain
    // below cannot hold them.
    const canPlace = gpuCanPlaceStatement(target);
    if (
      args.some(
        (a, i) =>
          i > 0 && (gpuNeedsStatements(a) || (canPlace && gpuArmSharesWork(a)))
      )
    ) {
      const statement = compileGPUStatementSelection(
        args,
        (e, i) =>
          i % 2 === 1
            ? gpuSelectionArm('Which', e, compile(e, i), complex, target)
            : compile(e, i),
        target
      );
      if (statement !== undefined) return statement;
    }
    // The fall-through NaN must match the branch values' shape (see
    // `gpuNaNFor`); every branch of a well-typed `Which` shares one shape,
    // so the first determinable value decides.
    const shapeRef =
      args.filter((_, i) => i % 2 === 1).find((v) => gpuComponentCount(v)) ??
      null;
    const build = (i: number): string => {
      if (i >= args.length)
        return complex
          ? `${gpuVec2(target)}(${gpuNaN(target)})`
          : gpuNaNFor(shapeRef, target);
      const cond = args[i];
      // Only the FIRST condition is evaluated unconditionally. Every value, and
      // every LATER condition, sits behind a branch and must not hoist out of
      // it. (`build(i + 2)` needs no wrapper of its own: it guards its own
      // pieces on the next turn of the recursion.)
      const armed = (f: () => string): string =>
        i === 0 ? f() : compileGPUConditionalArm('Which', f, target);
      // `True` marks the default branch.
      if (isSymbol(cond, 'True')) return `(${armed(() => value(i + 1))})`;
      // CONSECUTIVE clauses that answer the same value collapse into one
      // clause whose condition is their disjunction: `c1 ? v : (c2 ? v : e)`
      // is `(c1 || c2) ? v : e`. Both languages short-circuit `||`, so a
      // later condition is still evaluated only when every earlier one is
      // false — the evaluation order and count of the nested form, kept
      // exactly. The clauses must be PURE: merging writes the value once
      // where the nested form wrote it twice, so an impure value would lose
      // one of two distinct draws from the shader's random stream, and a pure
      // condition is required for the same conservative reason.
      let last = i;
      while (
        last + 3 < args.length &&
        !isSymbol(args[last + 2], 'True') &&
        args[i + 1].isPure &&
        args[last + 2].isPure &&
        args[last + 3].isPure &&
        args[last + 3].isSame(args[i + 1])
      )
        last += 2;
      const first = armed(() => compile(cond, i));
      const merged: string[] = [];
      for (let k = i + 2; k <= last; k += 2)
        merged.push(
          compileGPUConditionalArm('Which', () => compile(args[k], k), target)
        );
      const condCode =
        merged.length === 0
          ? first
          : [first, ...merged].map((c) => `(${c})`).join(' || ');
      return gpuConditional(
        condCode,
        compileGPUConditionalArm('Which', () => value(i + 1), target),
        build(last + 2),
        target
      );
    };
    return build(0);
  },
  // Epsil `Match`: tier-0/1 constant dispatch as a nested `select`/ternary with
  // `==` comparisons, the subject inlined into each comparison (safe for a PURE
  // subject; an impure one is bound to a hoisted temporary instead — see
  // `BaseCompiler.compileMatchTernary`). Tier-2 destructuring, refutable
  // tier-3, and string constants (no string type) fail closed.
  // `compileMatchTernary` compiles the pieces itself, so the no-hoist guard is
  // handed to it (`arm`) and applied PER PIECE — each case body, each case
  // guard, and each condition past the first — the way the `If`/`Which`
  // lowerings do. The SUBJECT stays outside it: it is compiled first and
  // evaluated unconditionally, so a loop-form `Sum` there is safe to hoist.
  Match: (args, _compile, target) =>
    BaseCompiler.compileMatchTernary(args[0]!.engine, args, target, {
      ternary: (c, t, e) => gpuConditional(c, t, e, target),
      eq: '==',
      noMatch: gpuNaN(target),
      allowStrings: false,
      arm: (f) => compileGPUConditionalArm('Match', f, target),
    }),
  Power: (args, compile, target) => {
    const base = args[0];
    const exp = args[1];
    if (base === null)
      throw new Error('Could not compile `Power`: no argument');
    // A base that may be negative under an exponent that may be a float:
    // the interpreter gives the real root when the rational recovered from
    // the exponent has an odd denominator (`BaseCompiler.negativeBaseFloatPower`).
    // A constant exponent is decided now. A variable one cannot be decided
    // in the shader (the recovery reads the exponent to 15 to 17 digits,
    // and a shader holds an f32), and keeps the lowering below: `pow`, with
    // no value for a negative base, as before.
    const negativeBase = BaseCompiler.negativeBaseFloatPower(args);
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) {
        // `e^{a + iπu}` with real scalar `a` and `u`: the angle in
        // half-turns, reduced exactly (`_gpu_cossinpi`), so `e^{iπx}` at
        // `x = 1` is `−1` and `e^{x + iπ}` is `−e^x`.
        const split = exp !== null ? BaseCompiler.eulerPiSplit(exp) : undefined;
        if (
          split !== undefined &&
          gpuOperandShape(split.u) === 'scalar' &&
          (split.a === undefined || gpuOperandShape(split.a) === 'scalar')
        )
          return split.a === undefined
            ? `_gpu_cossinpi(${compile(split.u)})`
            : `(exp(${compile(split.a)}) * _gpu_cossinpi(${compile(split.u)}))`;
        return `_gpu_cexp(${compile(exp)})`;
      }
      const v2 = gpuVec2(target);
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
      if (typeof negativeBase === 'object')
        return `_gpu_cpowrr(${bCode}, ${formatFloat(negativeBase.value, target.language)}, ${negativeBase.oddNumerator ? '-1.0' : '1.0'})`;
      const eCode = BaseCompiler.isComplexValued(exp)
        ? compile(exp)
        : `${v2}(${compile(exp)}, 0.0)`;
      return `_gpu_cpow(${bCode}, ${eCode})`;
    }
    const bConst = tryGetConstant(base);
    const eConst = tryGetConstant(exp);
    if (bConst !== undefined && eConst !== undefined) {
      const r = Math.pow(bConst, eConst);
      // `Math.pow` (like the shader `pow`) is NaN for every negative base with
      // a non-integer exponent, which is narrower than CE's branch convention.
      // The node's type selects which value to fold:
      // - An EVEN reduced-rational denominator is the complex branch and the
      //   node is typed `complex`, so the enclosing emission is the
      //   `vec2(re, im)` convention. Fold the principal complex value; a
      //   scalar NaN there would be silently scalar-broadcast into a
      //   `vec2(NaN, NaN)` (valid shader source, wrong value).
      // - An ODD denominator has a real root (`(−8)^(2/3) = 4`) that `pow`
      //   misses; the node stays `number` and folds to that real value.
      // - An unprovable branch keeps the shader NaN fold: it is exactly what
      //   this head's OWN `pow` lowering yields once the base is a runtime
      //   variable (`pow(x, 0.3)` at `x = -2`), so refusing only the
      //   provable-constant case buys no safety.
      if (Number.isNaN(r)) {
        if (gpuResultIsComplexValued('Power', args))
          return gpuComplexPowLiteral(bConst, eConst, target);
        const real = negativeBaseRealPow(bConst, exp, eConst);
        if (real !== undefined) return formatFloat(real, target.language);
      }
      return formatFloat(r, target.language);
    }
    const realPower =
      BaseCompiler.realPowerExponent(args) ??
      (typeof negativeBase === 'object' ? negativeBase : undefined);
    if (realPower !== undefined) {
      const code = gpuOperandOnce('Power', base, compile, target);
      const width = gpuBinaryVectorWidth(base, exp);
      const shape = (n: number): string =>
        width === undefined
          ? formatFloat(n, target.language)
          : `${gpuFVec(width, target)}(${formatFloat(n, target.language)})`;
      const magnitude = `pow(abs(${code}), ${shape(realPower.value)})`;
      if (!realPower.oddNumerator) return magnitude;
      const negative =
        target.language === 'wgsl' || width === undefined
          ? `${code} < ${shape(0)}`
          : `lessThan(${code}, ${shape(0)})`;
      const sign =
        target.language === 'wgsl'
          ? `select(${shape(1)}, ${shape(-1)}, ${negative})`
          : width === undefined
            ? `(${negative} ? -1.0 : 1.0)`
            : `mix(${shape(1)}, ${shape(-1)}, ${negative})`;
      return `(${sign} * ${magnitude})`;
    }
    // Real-emitted operands but a complex RESULT type (a negative base on the
    // even-denominator branch, e.g. `a^{0.3}` with `a ⩴ -2`). The enclosing
    // emission is `vec2(re, im)`; a scalar `pow` here would scalar-broadcast
    // into a silent `vec2(NaN, NaN)`. See `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Power', args))
      return `_gpu_cpow(${gpuComplexOperand(base, compile, target)}, ${gpuComplexOperand(exp, compile, target)})`;
    // The width of the `vecN` this power lowers to, when one of the two
    // operands is a shader vector. Every piece of the lowering below is
    // componentwise in both languages (`pow`, `sqrt`, `*`, `/` all take the
    // genType), so the vector case needs only two adjustments: a piece that
    // would emit a bare scalar has to be widened to the same `vecN`, and the
    // scalar-declared `_gpu_powi` helper has to be swapped for its `vecN`
    // overload. A width MISMATCH between the two operands is left to the
    // operand-shape gate, which declines it with a width diagnostic.
    const powWidth = gpuBinaryVectorWidth(base, exp);
    if (eConst === 0) {
      // `x⁰` is ONE for every component, so the emission must have the shape
      // of the base. The bare literal is correct only for a scalar base; a
      // `vecN` takes the broadcast constructor.
      const zeroShape = gpuOperandShape(base);
      if (zeroShape === 'scalar') return '1.0';
      if (typeof zeroShape === 'number')
        return `${gpuFVec(zeroShape, target)}(1.0)`;
      // A `matN` or an ARRAY base has no constructor this lowering can use,
      // and a bare `1.0` there is a silent scalar where the caller is owed an
      // aggregate — which the operand-shape gate cannot catch, because it
      // reads a lone literal as an emission that combines nothing
      // (`gpuIsAtomicEmission`) and steps aside. Route through the scalar
      // helper, whose declaration makes the gate decline with the shape
      // diagnostic it owns.
      return `_gpu_powi(${compile(base)}, 0.0)`;
    }
    if (eConst === 1) return compile(base);
    if (
      isSymbol(base, 'ExponentialE') &&
      gpuOperandShape(exp) === 'scalar' &&
      compile(base) === '2.71828182846'
    )
      return `exp(${compile(exp)})`;
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
    // Base two is the hardware's own exponential: both languages declare
    // `exp2` over the genType, and `pow(2.0, y)` is itself specified as
    // `exp2(y * log2(2.0))`, so this drops a logarithm the compiler would
    // otherwise have to fold.
    //
    // A SCALAR exponent only: the base is consumed, so the emitted call has
    // one argument where the head has two operands, and the operand-shape
    // gate reads the two against each other. A `vecN` exponent beside the
    // scalar base would be judged a genType mismatch and decline, where the
    // `pow` form below widens the base into the vector itself.
    if (bConst === 2 && gpuOperandShape(exp) === 'scalar')
      return `exp2(${compile(exp)})`;
    // Literal integer exponent: emit sign-preserving code. GLSL/WGSL `pow(x, y)`
    // is spec-defined as `exp2(y·log2(x))` and is undefined for a negative base
    // even when `y` is an integer-valued literal — on a real GPU `pow(-2.0, 3.0)`
    // returns `+8`, flipping the sign of odd powers (and `pow(-2.0, 2.0)` is NaN,
    // since `log2` of a negative is NaN). Emit repeated multiplication (small
    // exponents, simple base) or the sign-preserving `_gpu_powi` helper instead.
    if (eConst !== undefined && Number.isInteger(eConst)) {
      const n = eConst;
      const absN = Math.abs(n);
      let pos: string;
      if (absN === 1) {
        pos = `(${compile(base)})`;
      } else if (
        (isSymbol(base) || isNumber(base)) &&
        absN <= GPU_POWI_INLINE_LIMIT
      ) {
        // Simple base (no side effects, cheap to repeat) with a small exponent:
        // unroll to repeated multiplication — exact and free of any `pow` call.
        // A `vecN` base needs no widening here: `*` is componentwise.
        const code = compile(base);
        pos = /^[A-Za-z_]\w*$|^-?[0-9]+(?:\.[0-9]*)?$/.test(code)
          ? `(${Array(absN).fill(code).join(' * ')})`
          : gpuFixedPower(code, absN, gpuOperandShape(base));
      } else {
        // Compound or large: route through the helper so the base subexpression
        // is evaluated once (not duplicated) and the sign stays correct. The
        // exponent stays a scalar in the `vecN` overloads too.
        pos = gpuFixedPower(compile(base), absN, gpuOperandShape(base));
      }
      // `float / vecN` is a componentwise division in both languages, so the
      // reciprocal of a vector power needs no widening either.
      return n < 0 ? `(1.0 / ${pos})` : pos;
    }
    // A run-time exponent that is integer by TYPE (a `Sum` index, an
    // integer-declared parameter) over a base that may be negative: `pow` is
    // undefined for a negative base whatever the exponent's value, so
    // `(-1)^n` and `x^k` answered NaN on most drivers where the interpreter
    // answers `±x`. The sign-preserving helper computes `pow(abs(x), n)` and
    // negates for an odd `n`, which is right ONLY because `n` is an integer:
    // the gate is the exponent's type, never the sign of the base alone — a
    // fractional exponent over a negative base is NaN over the reals and
    // keeps the plain `pow` below. A provably non-negative base keeps `pow`
    // too, since it has no sign to preserve. The exponent stays a scalar in
    // the `vecN` overloads of the helper.
    if (
      BaseCompiler.isIntegerValued(exp) &&
      !BaseCompiler.isNonNegative(base) &&
      gpuOperandShape(exp) === 'scalar'
    ) {
      const shape = gpuOperandShape(base);
      const width = typeof shape === 'number' ? shape : undefined;
      if (shape === 'scalar' || width !== undefined)
        return `_gpu_powi${width ?? ''}(${compile(base)}, ${compile(exp)})`;
    }
    // DIVERGENCE (documented, CO-P2-24): a literal `0^0` folds to NaN at
    // canonicalization and then fails closed here (no GPU NaN literal); `x^0`
    // folds to 1. A *runtime* dynamic `0^0` reaches `pow(0.0, 0.0)`, which is
    // undefined in GLSL/WGSL and cannot be made to yield NaN (no NaN literal),
    // so it is left to the hardware — the JS target aligns this via `_SYS.pow`.
    // A genuinely fractional exponent (e.g. `x^2.5`) stays `pow`: it is
    // mathematically undefined for a negative base over the reals too.
    //
    // `pow` is declared over ONE genType, so a scalar standing beside a `vecN`
    // is written as an explicit constructor: neither language promotes it.
    return `pow(${gpuWidenToVector(base, powWidth, compile, target)}, ${gpuWidenToVector(exp, powWidth, compile, target)})`;
  },
  Radians: 'radians',
  Round: (args, compile, target) => {
    // A value halfway between two integers is rounded with the rule of
    // `ce.roundingTies` at compile time, as the interpreter does
    // (`gpuRoundToInteger()`). A SCALAR operand goes through a preamble
    // helper, which writes the operand once. A `vecN` operand uses an inline
    // form that is componentwise; it splices its operand more than once, so
    // it goes through `gpuOperandOnce`: an impure (Random-family) operand is
    // bound to a hoisted temporary instead of re-drawn, a pure one compiles
    // directly.
    const isScalar = gpuOperandShape(args[0]) === 'scalar';
    const ties = args[0].engine.roundingTies;
    const roundTie = (c: string): string =>
      gpuRoundToInteger(c, ties, isScalar, target.language === 'wgsl');
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0]))
        return gpuIdentityPassthrough(args[0], compile, target);
      return roundTie(
        isScalar
          ? compile(args[0])
          : gpuOperandOnce('Round', args[0], compile, target)
      );
    }
    // `Round(x, step)`: the multiple of the step nearest to `x`
    // (`gpuRoundToStep()`), with the tie of the quotient rounded with the
    // same rule.
    return gpuRoundToStep(
      (q, scalar) =>
        gpuRoundToInteger(q, ties, scalar, target.language === 'wgsl'),
      args[0],
      args[1]!,
      compile,
      target,
      0.5
    );
  },
  Sign: 'sign',
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csin(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0]);
    if (u !== undefined) return `_gpu_sinpi(${compile(u)})`;
    return `sin(${compile(args[0])})`;
  },
  Smoothstep: 'smoothstep',
  Sqrt: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csqrt(${compile(args[0])})`;
    const c = tryGetConstant(args[0]);
    if (c !== undefined) {
      // A NEGATIVE constant has no real square root, and a canonical
      // `Sqrt(negative)` is typed `complex` — so the enclosing emission is the
      // vec2(re, im) complex codegen, and the folded constant must agree with
      // it. Fold the complex principal value (the interpreter's answer, and the
      // JS target's `complexSqrtLiteral`), never a scalar NaN, which the
      // surrounding complex arithmetic would consume as a real.
      if (c < 0)
        return `${gpuVec2(target)}(0.0, ${formatFloat(
          Math.sqrt(-c),
          target.language
        )})`;
      return formatFloat(Math.sqrt(c), target.language);
    }
    // The operand is real-emitted but PROVABLY negative (a symbol with an
    // assigned negative value: `a := -2`), so the result is complex. The
    // enclosing emission is the `vec2(re, im)` convention, and shader
    // scalar-broadcast would silently turn a `sqrt(-2.0)` NaN into
    // `vec2(NaN, NaN)`. An operand of merely UNKNOWN sign keeps the scalar
    // `sqrt` (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the
    // parent agree). See `gpuResultIsComplexValued`.
    if (args[0]?.isNegative === true && gpuResultIsComplexValued('Sqrt', args))
      return `_gpu_csqrt(${gpuComplexOperand(args[0], compile, target)})`;
    return `sqrt(${compile(args[0])})`;
  },
  Step: 'step',
  Tan: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctan(${compile(args[0])})`;
    const u = gpuPiMultiple(args[0]);
    if (u !== undefined) return `_gpu_tanpi(${compile(u)})`;
    return `tan(${compile(args[0])})`;
  },
  Truncate: (args, compile, target) => {
    if (args.length > 1 && args[1] !== null)
      return gpuRoundToStep('trunc', args[0], args[1], compile, target);
    if (BaseCompiler.isIntegerValued(args[0]))
      return gpuIdentityPassthrough(args[0], compile, target);
    return `trunc(${compile(args[0])})`;
  },

  // Complex-specific functions
  Real: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).x`;
    return gpuIdentityPassthrough(args[0], compile, target);
  },
  Imaginary: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).y`;
    return '0.0';
  },
  Argument: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      // The `vec2` operand is spliced TWICE (`.y` and `.x`) — bind an impure
      // (Random-family) one to a hoisted `vec2` temporary; a pure one compiles
      // directly (byte-identical).
      const code = gpuOperandOnce('Argument', args[0], compile, target, true);
      // An operand that lowers to a `vec2` CONSTRUCTOR carries its two
      // components in the source already, so the vector is read back apart
      // instead of being built twice: `atan(vec2(a, b).y, vec2(a, b).x)`
      // becomes `atan(b, a)`. The constructor's arguments are the components
      // in order, so no swizzle is needed.
      const built = gpuTopLevelCall(code);
      if (
        built !== undefined &&
        /^vec2f?$/.test(built.callee) &&
        built.operands.length === 2
      )
        return `${gpuAtan2(target)}(${built.operands[1]}, ${built.operands[0]})`;
      // `gpuSwizzle`, not a bare `${code}.y`: a postfix swizzle binds tighter
      // than every infix operator, so an operand that lowered to an infix
      // expression — the promote-and-add form of a complex `Add`, which joins
      // its operands with ` + ` — would take the suffix on its LAST term
      // alone.
      return `${gpuAtan2(target)}(${gpuSwizzle(code, 'y')}, ${gpuSwizzle(code, 'x')})`;
    }
    // A real value's argument is 0 (x ≥ 0) or π (x < 0). Use the
    // target-appropriate conditional: WGSL has no `?:`, so this becomes
    // `select(3.14159265359, 0.0, x >= 0.0)`.
    return gpuConditional(
      `${compile(args[0])} >= 0.0`,
      '0.0',
      '3.14159265359',
      target
    );
  },
  Conjugate: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0])) {
      const v2 = gpuVec2(target);
      // Spliced TWICE (`.x` and `.y`) — see `Argument`.
      const code = gpuOperandOnce('Conjugate', args[0], compile, target, true);
      // `gpuSwizzle` for the same reason as `Argument` above: a bare
      // `${code}.x` binds the suffix to the last term of an infix emission.
      return `${v2}(${gpuSwizzle(code, 'x')}, -${gpuSwizzle(code, 'y')})`;
    }
    return gpuIdentityPassthrough(args[0], compile, target);
  },

  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Remainder`: missing argument');
    // The interpreter rounds the quotient with a tie toward `+∞`
    // (JavaScript `Math.round`: `Remainder(5, 2)` is `-1`), whatever the
    // tie rule of `Round`. The shader `round()` rounds a tie to even (WGSL)
    // or as the implementation chooses (GLSL), so it is not used.
    const remainderQuotient = (q: string): string =>
      gpuRoundToInteger(
        q,
        'toward-positive-infinity',
        gpuOperandShape(a) === 'scalar' && gpuOperandShape(b) === 'scalar',
        target.language === 'wgsl'
      );
    // An IMPURE operand (the Random family) must be evaluated exactly once:
    // both operands are spliced twice, and `_gpu_rnd_draw` advances a runtime
    // counter, so a repeated draw returns a different value AND shifts every
    // later draw in the shader. Bind scalars to hoisted temporaries; where
    // there is no statement sink (a conditional arm), or the operand is not
    // a scalar, there is no safe reading — decline.
    if (a.isPure === false || b.isPure === false) {
      if (
        !BaseCompiler.canHoist(target) ||
        gpuOperandShape(a) !== 'scalar' ||
        gpuOperandShape(b) !== 'scalar'
      )
        throw new Error(
          'Could not compile `Remainder`: an impure (Random) operand cannot be bound to a ' +
            'temporary at this position — a repeated draw would shift every ' +
            'later value in the shader.'
        );
      const ta = BaseCompiler.tempVar(target);
      const tb = BaseCompiler.tempVar(target);
      const decl = (n: string) =>
        target.language === 'wgsl' ? `var ${n}: f32` : `float ${n}`;
      BaseCompiler.hoistStatement(
        target,
        `${decl(ta)} = ${compile(a)};`,
        `${decl(tb)} = ${compile(b)};`
      );
      return `(${ta} - ${tb} * ${remainderQuotient(`${ta} / ${tb}`)})`;
    }
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * ${remainderQuotient(`${ca} / ${cb}`)})`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Cot`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      // The operand is spliced TWICE below, so an IMPURE one must first be
      // bound to a hoisted temporary — compiling it once is not enough, since
      // `_gpu_rnd_draw` advances its counter on every evaluation of the
      // spliced text (see the real branch and `Remainder`).
      if (x.isPure === false) {
        if (!BaseCompiler.canHoist(target))
          throw new Error(
            'Could not compile `Cot`: an impure (Random) complex operand cannot be bound to a ' +
              'temporary at this position — a repeated draw would shift ' +
              'every later value in the shader.'
          );
        const t = BaseCompiler.tempVar(target);
        const decl =
          target.language === 'wgsl'
            ? `var ${t}: ${gpuVec2(target)}`
            : `${gpuVec2(target)} ${t}`;
        BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
        return `_gpu_cdiv(_gpu_ccos(${t}), _gpu_csin(${t}))`;
      }
      // Compile the operand ONCE: two `compile()` calls would allocate two
      // distinct `_gpu_rnd` sites for an impure operand.
      const z = compile(x);
      return `_gpu_cdiv(_gpu_ccos(${z}), _gpu_csin(${z}))`;
    }
    // An IMPURE operand (Random) is spliced twice below, and `_gpu_rnd_draw`
    // advances a runtime counter — bind it to a hoisted temporary, or decline
    // where there is no statement sink (see `Remainder`).
    if (x.isPure === false) {
      if (!BaseCompiler.canHoist(target) || gpuOperandShape(x) !== 'scalar')
        throw new Error(
          'Could not compile `Cot`: an impure (Random) operand cannot be bound to a temporary ' +
            'at this position — a repeated draw would shift every later ' +
            'value in the shader.'
        );
      const t = BaseCompiler.tempVar(target);
      const decl = target.language === 'wgsl' ? `var ${t}: f32` : `float ${t}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${compile(x)};`);
      return `(cos(${t}) / sin(${t}))`;
    }
    const arg = compile(x);
    return `(cos(${arg}) / sin(${arg}))`;
  },
  Csc: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csc`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csin(${compile(x)}))`;
    }
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Sec`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccos(${compile(x)}))`;
    }
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arccot`: no argument');
    // `atan(1/x)` returns the wrong branch for x < 0. `π/2 - atan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(1.5707963267948966 - atan(${compile(x)}))`;
  },
  Arccsc: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arccsc`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arccsc', [x])
    )
      return gpuReciprocalComplex('_gpu_cacsc', x, compile, target);
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arcsec`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcsec', [x])
    )
      return gpuReciprocalComplex('_gpu_casec', x, compile, target);
    return `acos(1.0 / (${compile(x)}))`;
  },

  // Hyperbolic functions with complex dispatch
  Sinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csinh(${compile(args[0])})`;
    return `sinh(${compile(args[0])})`;
  },
  Cosh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccosh(${compile(args[0])})`;
    return `cosh(${compile(args[0])})`;
  },
  Tanh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ctanh(${compile(args[0])})`;
    return `tanh(${compile(args[0])})`;
  },

  // Reciprocal hyperbolic functions
  Coth: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Coth`: no argument');
    // Both branches splice the operand twice — an impure one is bound to a
    // hoisted temporary (see `gpuOperandOnce` and the `Cot` handler).
    if (BaseCompiler.isComplexValued(x)) {
      const z = gpuOperandOnce('Coth', x, compile, target, true);
      return `_gpu_cdiv(_gpu_ccosh(${z}), _gpu_csinh(${z}))`;
    }
    const arg = gpuOperandOnce('Coth', x, compile, target);
    return `(cosh(${arg}) / sinh(${arg}))`;
  },
  Csch: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Csch`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csinh(${compile(x)}))`;
    }
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Sech`: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccosh(${compile(x)}))`;
    }
    return `(1.0 / cosh(${compile(x)}))`;
  },

  // Inverse hyperbolic functions with complex dispatch
  Arcosh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_cacosh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Arcosh', args))
      return `_gpu_cacosh(${gpuComplexOperand(args[0], compile, target)})`;
    return `acosh(${compile(args[0])})`;
  },
  Arsinh: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_casinh(${compile(args[0])})`;
    return `asinh(${compile(args[0])})`;
  },
  Artanh: (args, compile, target) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_catanh(${compile(args[0])})`;
    if (gpuResultIsComplexValued('Artanh', args))
      return `_gpu_catanh(${gpuComplexOperand(args[0], compile, target)})`;
    return `atanh(${compile(args[0])})`;
  },

  // Inverse hyperbolic (reciprocal)
  Arcoth: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arcoth`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcoth', [x])
    )
      return gpuReciprocalComplex('_gpu_cacoth', x, compile, target);
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Arcsch`: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile, target) => {
    if (x === null) throw new Error('Could not compile `Arsech`: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arsech', [x])
    )
      return gpuReciprocalComplex('_gpu_casech', x, compile, target);
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile, target) => {
    if (args.length < 2)
      throw new Error('Could not compile `Arctan2`: need two arguments');
    return `${gpuAtan2(target)}(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null)
      throw new Error('Could not compile `Hypot`: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Haversine`: no argument');
    return `((1.0 - cos(${compile(x)})) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `InverseHaversine`: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: (args, compile, target) => {
    const x = args[0];
    if (!x) throw new Error('Could not compile `Gamma`: no argument');
    // The TWO-operand form is the upper incomplete gamma
    // `Γ(s, z) = ∫_z^∞ tˢ⁻¹e⁻ᵗ dt` (the signature is `(number, number?)`) — a
    // different function from `Γ(z)`, not a variant of it: `Γ(5, 2)` is
    // 22.736…, `Γ(5)` is 24. `_gpu_gamma` is the COMPLETE Γ, so consuming
    // only the first operand reported success on a shader computing the wrong
    // value. There is no shader builtin for the incomplete form and no
    // preamble helper for it, so it fails closed.
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Gamma\`: the two-operand form is the upper incomplete gamma Γ(s, z), ` +
          `which has no ${target.language ?? 'GPU'} lowering ` +
          `(\`_gpu_gamma\` is the COMPLETE Γ).`
      );
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `GammaLn`: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Factorial`: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Could not compile `Beta`: need two arguments');
    // Each operand is spliced twice — an impure one is bound to a hoisted
    // temporary (see `gpuOperandOnce`).
    const ca = gpuOperandOnce('Beta', a, compile, target);
    const cb = gpuOperandOnce('Beta', b, compile, target);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Erf`: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  // The two-argument form is Wolfram's generalized `Zeta[s, a]`: the Hurwitz
  // zeta for a > 0, but real |k + a|^(−s) terms and no pole for a ≤ 0, as the
  // interpreter's `evaluateGeneralizedZeta` computes it — so it lowers to
  // `_gpu_zeta_generalized`, not to `_gpu_hurwitz_zeta`. `_gpu_zeta` is the
  // one-argument Riemann ζ only.
  Zeta: (args, compile) => {
    if (args.length === 1) return `_gpu_zeta(${compile(args[0])})`;
    if (args.length === 2)
      return `_gpu_zeta_generalized(${compile(args[0])}, ${compile(args[1])})`;
    throw new Error('Could not compile `Zeta`: it takes one or two operands');
  },
  // The three-operand form `HurwitzZeta(s, a, n)` is a derivative the
  // interpreter leaves symbolic, so it declines here.
  HurwitzZeta: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `HurwitzZeta`: only the two-operand form `HurwitzZeta(s, a)` compiles'
      );
    return `_gpu_hurwitz_zeta(${compile(args[0])}, ${compile(args[1])})`;
  },
  // Real-only (`GPU_REAL_ONLY_LOWERINGS`): `_gpu_lerch_phi` takes real
  // operands and is NaN where Φ is complex (real z > 1 with s not a
  // non-positive integer, or a < 0 with a non-integer s), and where none of
  // its methods can vouch for the value — see `GPU_LERCH_PREAMBLE_GLSL`.
  LerchPhi: (args, compile) => {
    if (args.length !== 3)
      throw new Error(
        'Could not compile `LerchPhi`: it takes exactly three operands'
      );
    return `_gpu_lerch_phi(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },
  // Real-only (`GPU_REAL_ONLY_LOWERINGS`): `_gpu_poly_log` answers the
  // orders 1, 0, −1 and −2 … −12 in closed form and every other order as
  // z · Φ(z, s, 1), and below z = −1 with a negative non-integer order,
  // where Φ declines, by Jonquière's inversion formula. It is NaN on the
  // cut z > 1 (a complex value) and where both decline.
  PolyLog: (args, compile) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `PolyLog`: it takes exactly two operands'
      );
    return `_gpu_poly_log(${compile(args[0])}, ${compile(args[1])})`;
  },
  Binomial: gpuBinomial,
  // `Choose(n, k)` is the binomial coefficient — same lowering (the two heads
  // share `evaluateBinomial` in the interpreter, so they must agree here too).
  Choose: gpuBinomial,
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Erfc`: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `ErfInv`: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },
  Heaviside: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `Heaviside`: no argument');
    return `_gpu_heaviside(${compile(x)})`;
  },
  Sinc: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Sinc`: no argument');
    return `_gpu_sinc(${compile(x)})`;
  },
  FresnelC: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `FresnelC`: no argument');
    return `_gpu_fresnelC(${compile(x)})`;
  },
  FresnelS: ([x], compile) => {
    if (x === null)
      throw new Error('Could not compile `FresnelS`: no argument');
    return `_gpu_fresnelS(${compile(x)})`;
  },
  BesselJ: ([n, x], compile, target) => {
    if (n === null || x === null)
      throw new Error('Could not compile `BesselJ`: need two arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_gpu_besselJ(${intCast}(${compile(n)}), ${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile, target) => {
    if (args.length === 0)
      throw new Error('Could not compile `Log`: no argument');
    // Complex either because an operand is, or because the RESULT is complex
    // from a PROVABLY negative argument (`a := -2` makes `Log(a)`
    // `complex`). Either way the enclosing emission is the `vec2`
    // convention. An operand of merely UNKNOWN sign keeps the scalar kernel
    // (pinned; the `isComplexValued` Sqrt/Ln/Log carve-out makes the parent
    // agree). See `gpuResultIsComplexValued`.
    if (
      args.some((a) => BaseCompiler.isComplexValued(a)) ||
      (args.some((a) => a.isNegative === true) &&
        gpuResultIsComplexValued('Log', args))
    ) {
      const num = `_gpu_cln(${gpuComplexOperand(args[0], compile, target)})`;
      // `ln(x) / ln(b)`: the base may itself be complex, or real-but-negative
      // (whose own `ln` is complex). Base 10 divides by a real, so it stays a
      // componentwise scalar multiply.
      if (args.length === 1) return `(${num} * 0.4342944819032518)`;
      return `_gpu_cdiv(${num}, _gpu_cln(${gpuComplexOperand(args[1], compile, target)}))`;
    }
    if (args.length === 1) return `(log(${compile(args[0])}) / log(10.0))`;
    // Base 2 has a shader builtin, exact at the powers of two like the
    // interpreter's fold (`Log(8, 2)` is `3`); `log(x) / log(2.0)` is not
    // (Tycho item 240). Shaders have no `log10`, so base 10 keeps the
    // quotient.
    if (BaseCompiler.fixedLogBase(args) === 2)
      return `log2(${compile(args[0])})`;
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Log10`: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Lg`: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Could not compile `Square`: no argument');
    if (isSymbol(x) || isNumber(x)) {
      const arg = compile(x);
      if (/^[A-Za-z_]\w*$|^-?[0-9]+(?:\.[0-9]*)?$/.test(arg))
        return `(${arg} * ${arg})`;
      const width = gpuOperandShape(x);
      return gpuFixedPower(arg, 2, width);
    }
    // Compound base: `pow(x, 2.0)` is NaN for x < 0 on a real GPU (log2 of a
    // negative). Route through the sign-preserving helper, which also evaluates
    // the base subexpression once instead of duplicating it. A `vecN` base
    // takes the componentwise overload of that helper (`_gpu_powi3`); the
    // scalar one is declared with `float`/`f32` parameters and has no vector
    // reading.
    const width = gpuOperandShape(x);
    return gpuFixedPower(compile(x), 2, width);
  },
  Root: ([x, n], compile, target) => {
    if (x === null) throw new Error('Could not compile `Root`: no argument');
    // A COMPLEX radicand is a `vec2`, which the real lowerings below would
    // read componentwise. It takes the principal root through `_gpu_cpow`,
    // with the one exception the interpreter and the JavaScript `_SYS.croot`
    // make: a radicand whose imaginary part is exactly zero, under an odd
    // integer degree, has the REAL root (`Root(-8, 3)` is `-2`, not the
    // principal `1 + 1.732i`). The radicand is complex-shaped but may be real
    // when the code runs, so the test is emitted. A complex DEGREE has no
    // shader lowering.
    if (
      BaseCompiler.isComplexValued(x) ||
      (n != null && BaseCompiler.isComplexValued(n))
    ) {
      if (n != null && BaseCompiler.isComplexValued(n))
        throw new Error(
          'Could not compile `Root`: a complex degree has no shader lowering.'
        );
      const v2 = gpuVec2(target);
      const z = gpuOperandOnce('Root', x, compile, target, true);
      if (n == null) return `_gpu_csqrt(${z})`;
      const degreeConst = tryGetConstant(n);
      if (degreeConst !== undefined) {
        const inverse = formatFloat(1 / degreeConst, target.language);
        const principal = `_gpu_cpow(${z}, ${v2}(${inverse}, 0.0))`;
        if (!Number.isInteger(degreeConst) || degreeConst % 2 === 0)
          return principal;
        return gpuConditional(
          `(${z}).y == 0.0`,
          `${v2}(sign((${z}).x) * pow(abs((${z}).x), ${inverse}), 0.0)`,
          principal,
          target
        );
      }
      const d = gpuOperandOnce('Root', n, compile, target);
      const odd =
        target.language === 'wgsl'
          ? `abs(${d}) % 2.0 == 1.0`
          : `mod(abs(${d}), 2.0) == 1.0`;
      return gpuConditional(
        `(${z}).y == 0.0 && fract(${d}) == 0.0 && ${odd}`,
        `${v2}(sign((${z}).x) * pow(abs((${z}).x), 1.0 / (${d})), 0.0)`,
        `_gpu_cpow(${z}, ${v2}(1.0 / (${d}), 0.0))`,
        target
      );
    }
    if (n === null || n === undefined) return `sqrt(${compile(x)})`;
    const nConst = tryGetConstant(n);
    if (nConst === 2) return `sqrt(${compile(x)})`;
    const xConst = tryGetConstant(x);
    if (xConst !== undefined && nConst !== undefined) {
      const r = Math.pow(xConst, 1 / nConst);
      // For a negative base, the node's type selects which value to fold. An odd
      // integer degree has a real root (interpreter convention, e.g.
      // Root(-8, 3) = -2) and stays `number`. An EVEN degree is the complex
      // branch: the node is typed `complex`, so the enclosing emission is
      // `vec2(re, im)` and the
      // fold must be the principal complex value — a scalar NaN there would be
      // silently scalar-broadcast into `vec2(NaN, NaN)`. (A canonical even root
      // of a negative already folds to an exact complex literal before
      // compile: `√-4` → `2i`.)
      if (Number.isNaN(r)) {
        if (Number.isInteger(nConst) && nConst % 2 !== 0 && xConst < 0)
          return formatFloat(-Math.pow(-xConst, 1 / nConst), target.language);
        if (gpuResultIsComplexValued('Root', [x, n]))
          return gpuComplexPowLiteral(xConst, 1 / nConst, target);
      }
      return formatFloat(r, target.language);
    }
    // Real-emitted operands but a complex RESULT type (an even degree over a
    // negative base, e.g. `\sqrt[4]{a}` with `a ⩴ -2`). See
    // `gpuResultIsComplexValued`.
    if (gpuResultIsComplexValued('Root', [x, n]))
      return `_gpu_cpow(${gpuComplexOperand(x, compile, target)}, ${gpuVec2(target)}(1.0 / (${compile(n)}), 0.0))`;
    // Odd integer degree: GPU has no `cbrt`, and `pow` is NaN for a negative
    // base. Emit the sign-corrected form `sign(x)·|x|^(1/n)`.
    if (nConst !== undefined && Number.isInteger(nConst) && nConst % 2 !== 0) {
      // The operand is spliced TWICE — bind an impure (Random-family) one to a
      // hoisted temporary; a pure one compiles directly (byte-identical).
      const c = gpuOperandOnce('Root', x, compile, target);
      return `(sign(${c}) * pow(abs(${c}), ${formatFloat(
        1 / nConst,
        target.language
      )}))`;
    }
    // The degree is parenthesized unless it is a single name or number:
    // `Root(x, u + 1)` is `pow(x, 1.0 / (u + 1.0))`, not `pow(x, 1.0 / u + 1.0)`.
    const degree = compile(n);
    return `pow(${compile(x)}, 1.0 / ${
      /^[\w.]+$/.test(degree) ? degree : `(${degree})`
    })`;
  },

  // Color functions (pure-math, GPU-compilable)
  // `GamutMap(c, gamut?)` answers the mapped color in sRGB channels, as the
  // interpreter answers an `Rgb` head, and `colorSpaceOf` reports `rgb` for it,
  // so a consumer converts the channels back to OKLCh (`gpuColorOperand`). For
  // "display-p3" the channels are extended sRGB: a color inside the
  // Display-P3 gamut but outside the sRGB gamut has a channel outside [0, 1].
  // The gamut must be a string literal, because a shader has no run-time
  // string; an unknown gamut answers `expected-value` in the interpreter, and
  // fails closed here.
  GamutMap: (args, compile, target) => {
    if (args.length === 0)
      throw new Error('Could not compile `GamutMap`: no argument');
    const c = gpuColorOperand('GamutMap', args[0], compile, target);
    const gamut = args.length >= 2 && args[1] !== null ? args[1] : undefined;
    let name = 'srgb';
    if (gamut !== undefined) {
      const literal = readStringLiteral(gamut);
      if (literal === null)
        throw new Error(
          'Could not compile `GamutMap`: the gamut must be a string literal on a shader target'
        );
      name = literal;
    }
    if (name === 'srgb') return `_gpu_gamut_map_oklch(${c})`;
    if (name === 'display-p3') return `_gpu_gamut_map_oklch_p3(${c})`;
    throw new Error(
      `Could not compile \`GamutMap\`: unknown gamut "${name}" — the gamut is "srgb" or ` +
        `"display-p3".`
    );
  },
  ColorMix: (args, compile, target) => {
    if (args.length < 2)
      throw new Error('Could not compile `ColorMix`: need two colors');
    const c1 = gpuColorOperand('ColorMix', args[0], compile, target);
    const c2 = gpuColorOperand('ColorMix', args[1], compile, target);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile, target) => {
    if (bg === null || fg === null)
      throw new Error('Could not compile `ColorContrast`: need two colors');
    return `_gpu_apca(${gpuColorOperand(
      'ColorContrast',
      bg,
      compile,
      target
    )}, ${gpuColorOperand('ColorContrast', fg, compile, target)})`;
  },
  ContrastingColor: (args, compile, target) => {
    if (args.length === 0)
      throw new Error('Could not compile `ContrastingColor`: no argument');
    // WGSL has no ternary operator: the selection must be spelled `select`.
    // GLSL keeps the EXACT `?:` text it has always emitted (pinned).
    // `select` evaluates BOTH arms eagerly, unlike `?:` — sound here because
    // every operand of this head is pure (an impure one declines below).
    const pick = (cond: string, whenTrue: string, whenFalse: string): string =>
      target?.language === 'wgsl'
        ? `select(${whenFalse}, ${whenTrue}, ${cond})`
        : `(${cond} ? ${whenTrue} : ${whenFalse})`;
    // Every operand is spliced TWICE by the comparison below (the background
    // in both arms of the comparison, each foreground in its arm and in the
    // result). A color operand is `vec3`-shaped, so there is no scalar (or
    // `vec2`) temporary to bind it to — an impure (Random-family) operand
    // would be re-drawn, and `_gpu_rnd_draw` advances a runtime counter, so
    // the two splices compare DIFFERENT colors and every later draw in the
    // shader shifts. No safe reading — decline (the `gpuOperandOnce` rule for
    // a non-scalar operand).
    if (args.slice(0, 3).some((a) => a.isPure === false))
      throw new Error(
        `Could not compile \`ContrastingColor\`: an impure (Random) operand cannot be bound to a ` +
          `temporary at this position — a repeated draw would shift every ` +
          `later value in the shader.`
      );
    // Every color operand is spliced twice, and `select` evaluates both arms,
    // so an operand written inline runs its `_gpu_srgb_to_oklch` conversion up
    // to four times per fragment. Bind each converted operand to a `vec3`
    // local once where the target has a statement sink.
    //
    // Only an operand that VARIES is bound. An operand with no unknowns is
    // the same value in every fragment, so the repeated splice costs nothing
    // measurable and the shorter inline form is kept. A bare name is already
    // a single evaluation, and where there is no statement sink the code is
    // spliced as before.
    const bindColor = (x: Expression, code: string): string => {
      if (target === undefined || x.unknowns.length === 0) return code;
      if (/^[A-Za-z_]\w*$/.test(code)) return code;
      if (!BaseCompiler.canHoist(target)) return code;
      const t = BaseCompiler.tempVar(target);
      const type = gpuVec3(target);
      const decl =
        target.language === 'wgsl' ? `var ${t}: ${type}` : `${type} ${t}`;
      BaseCompiler.hoistStatement(target, `${decl} = ${code};`);
      return t;
    };
    const bg = bindColor(
      args[0],
      gpuColorOperand('ContrastingColor', args[0], compile, target)
    );
    // The comparison is the one the interpreter makes through the
    // `contrastingColor()` routine of `@arnog/colors`: the candidate with the
    // larger ABSOLUTE APCA contrast wins, and the candidate is the FIRST
    // argument of the contrast. That order matters — APCA is not symmetric,
    // and the reversed order picked the other candidate for some
    // backgrounds.
    if (args.length >= 3) {
      const fg1 = bindColor(
        args[1],
        gpuColorOperand('ContrastingColor', args[1], compile, target)
      );
      const fg2 = bindColor(
        args[2],
        gpuColorOperand('ContrastingColor', args[2], compile, target)
      );
      return pick(
        `abs(_gpu_apca(${fg1}, ${bg})) >= abs(_gpu_apca(${fg2}, ${bg}))`,
        fg1,
        fg2
      );
    }
    // Default: choose between white and black in OKLCh. Black is vec3(0);
    // white is L=1 achromatic — vec3(1.0, 0.0, 0.0).
    const isWGSL = target?.language === 'wgsl';
    const v3 = isWGSL ? 'vec3f' : 'vec3';
    const black = `${v3}(0.0)`;
    const white = `${v3}(1.0, 0.0, 0.0)`;
    return pick(
      `abs(_gpu_apca(${white}, ${bg})) >= abs(_gpu_apca(${black}, ${bg}))`,
      white,
      black
    );
  },
  ColorToColorspace: ([color, space], compile, target) => {
    if (color === null || space === null)
      throw new Error(
        'Could not compile `ColorToColorspace`: need color and space'
      );
    // The input color is canonical OKLCh; route to the requested space.
    // The space arg must be a string literal so we can pick the helper
    // at compile time (no runtime branching in shader code).
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error(
        'Could not compile `ColorToColorspace`: space must be a string literal'
      );
    const c = gpuColorEntryOperand('ColorToColorspace', color, compile, target);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklch_to_oklab(${c})`;
      case 'rgb':
        return gpuRgbBoundary(color, c, target);
      case 'hsl':
        return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${c}))`;
      case 'hsv':
        return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${c}))`;
      default:
        throw new Error(
          `Could not compile \`ColorToColorspace\`: unsupported space "${spaceName}" on GPU target`
        );
    }
  },
  ColorFromColorspace: ([components, space], compile, target) => {
    if (components === null || space === null)
      throw new Error(
        'Could not compile `ColorFromColorspace`: need components and space'
      );
    // Components are in the named space, and the color this builds keeps them
    // there. The space operand must be a string literal so that the space is
    // a compile-time fact (`colorSpaceOf`): a shader color is a bare vector
    // with no run-time tag, and shader code carries no runtime branching.
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error(
        'Could not compile `ColorFromColorspace`: space must be a string literal'
      );
    // A 4-component tuple carries alpha. Same fail-closed policy as the typed
    // color heads: the `_gpu_*` chain is `vec3` end to end, so a `vec4` here
    // would either not type-check or silently drop the alpha downstream.
    const typedHead =
      isFunction(components) && GPU_COLOR_HEADS.has(components.operator)
        ? components
        : null;
    // A `List` is refused here, not read as components: the interpreter's
    // signature is `(color | tuple, string)` and it answers
    // `incompatible-type` for a list, so a shader must not quietly accept
    // what the engine calls an error.
    if (isFunction(components) && components.operator === 'List')
      throw new Error(
        `Could not compile \`ColorFromColorspace\`: a list is not a color component vector — the ` +
          `operand must be a tuple or a color.`
      );
    if (typedHead) assertNoGPUAlpha('ColorFromColorspace', typedHead.ops);
    else if (isFunction(components) && components.operator === 'Tuple')
      assertNoGPUAlpha('ColorFromColorspace', components.ops);
    // This operand is read as raw COMPONENTS in the named space — that is how
    // the interpreter reads a typed color head here. The head's own lowering
    // turns it into a canonical OKLCh color value instead, so compiling it
    // the ordinary way applied the space conversion a second time and
    // `ColorFromColorspace(Rgb(1, 0, 0), 'rgb')` answered a color that was
    // not red.
    // The `vec3` constructor is built here rather than by the head's own
    // lowering, so the shape gate that lowering applies has to be applied
    // here too: a vector-valued component emitted
    // `vec3(1.0, vec2(0.0, 1.0), 0.0)`, which no driver accepts.
    if (typedHead)
      assertGPUScalarComponents(typedHead.ops.slice(0, 3), gpuVec3(target));
    const c = typedHead
      ? `${gpuVec3(target)}(${typedHead.ops
          .slice(0, 3)
          .map((op) => compile(op))
          .join(', ')})`
      : compile(components);
    // The value is the channels themselves, in the space they were given in.
    // That is the color this operator builds — the interpreter answers the
    // color head of the named space — and `colorSpaceOf` reports the space,
    // so a consumer converts the channels back to OKLCh where it reads them
    // (`gpuColorOperand`), exactly as it does for an `As*` conversion. The
    // space name is still checked here, so a space no shader helper covers
    // fails closed at the operator rather than at its consumer.
    if (!GPU_COLOR_SPACES.has(spaceName))
      throw new Error(
        `Could not compile \`ColorFromColorspace\`: unsupported space "${spaceName}" on GPU target`
      );
    return c;
  },

  // ---------------------------------------------------------------------------
  // Color literals. Each typed head compiles to a canonical OKLCh vec3.
  // An alpha (4th) argument is DECLINED (`assertNoGPUAlpha`) — GPU color
  // values are vec3 only, so there is nowhere to carry it. Pass alpha as a
  // separate uniform if it's needed at the framebuffer boundary.
  // ---------------------------------------------------------------------------

  Color: ([s], _compile, target) => {
    // Compile-time CSS-color-string parsing. Runtime parsing is impractical
    // in shader code, so the string must be a literal at compile time.
    if (s === null) throw new Error('Could not compile `Color`: no argument');
    const str = readStringLiteral(s);
    if (str === null)
      throw new Error(
        'Could not compile `Color`: argument must be a string literal on GPU target'
      );
    // The predicate is the interpreter's own (`parseColorString`,
    // `library/colors.ts`), so a string is a color on every route or on none
    // of them. Reading the parser's zero sentinel as "not a color" here made
    // `Color("#gg0000")` compile to opaque black — a wrong value behind a
    // reported success — while refusing the genuinely transparent spellings
    // `#00000000` and `rgba(0, 0, 0, 0)`.
    const packed = parseColorString(str);
    if (packed === null)
      throw new Error(
        `Could not compile \`Color\`: invalid color string "${str}"`
      );
    // The packing is 0xrrggbbaa. Only the RGB is lowered below, so a literal
    // carrying a non-opaque alpha would silently become opaque. Decline
    // instead, matching `assertNoGPUAlpha`.
    if ((packed & 0xff) !== 0xff)
      throw new Error(
        `Could not compile \`Color\`: the color string "${str}" carries an alpha channel, which is ` +
          `not representable on the GPU target — color values are \`vec3\` ` +
          `(OKLCh) end to end, with no alpha channel. Use a fully opaque ` +
          `color and pass the alpha separately (e.g. as a uniform) at the ` +
          `framebuffer boundary.`
      );
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b });
    return `${gpuVec3(target)}(${formatFloat(oklch.L)}, ${formatFloat(oklch.C)}, ${formatFloat(oklch.H)})`;
  },

  Rgb: (args, compile, target) => {
    if (args.length < 3)
      throw new Error('Could not compile `Rgb`: need 3 components');
    assertNoGPUAlpha('Rgb', args);
    const v3 = gpuVec3(target);
    // Channels are 0-1 sRGB — no scaling needed.
    return `_gpu_srgb_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Hsv: (args, compile, target) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsv`: need 3 components');
    assertNoGPUAlpha('Hsv', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Hsl: (args, compile, target) => {
    if (args.length < 3)
      throw new Error('Could not compile `Hsl`: need 3 components');
    assertNoGPUAlpha('Hsl', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Oklab: (args, compile, target) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklab`: need 3 components');
    assertNoGPUAlpha('Oklab', args);
    const v3 = gpuVec3(target);
    return `_gpu_oklab_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Oklch: (args, compile, target) => {
    if (args.length < 3)
      throw new Error('Could not compile `Oklch`: need 3 components');
    assertNoGPUAlpha('Oklch', args);
    // Already in canonical form — no conversion needed.
    const v3 = gpuVec3(target);
    return `${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },

  // ---------------------------------------------------------------------------
  // As* operators. AsOklch is identity (canonical). The other As* return
  // components in the named space, equivalent to ColorToColorspace(c, 'x').
  // ---------------------------------------------------------------------------

  AsOklch: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsOklch`: no argument');
    // Identity for a color value — it is already in the canonical form. A
    // tuple at this position is sRGB components and still has to be
    // converted.
    return gpuParenthesizeIdentity(
      c,
      gpuColorEntryOperand('AsOklch', c, compile, target),
      target
    );
  },

  AsOklab: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsOklab`: no argument');
    return `_gpu_oklch_to_oklab(${gpuColorEntryOperand(
      'AsOklab',
      c,
      compile,
      target
    )})`;
  },

  AsRgb: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsRgb`: no argument');
    return gpuRgbBoundary(
      c,
      gpuColorEntryOperand('AsRgb', c, compile, target),
      target
    );
  },

  AsHsv: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsHsv`: no argument');
    return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${gpuColorEntryOperand(
      'AsHsv',
      c,
      compile,
      target
    )}))`;
  },

  AsHsl: ([c], compile, target) => {
    if (c === null) throw new Error('Could not compile `AsHsl`: no argument');
    return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${gpuColorEntryOperand(
      'AsHsl',
      c,
      compile,
      target
    )}))`;
  },

  // Fractal functions
  Mandelbrot: ([c, maxIter], compile, target) => {
    if (c === null || maxIter === null)
      throw new Error('Could not compile `Mandelbrot`: missing arguments');
    const iterCode = compileIntArg('Mandelbrot', maxIter, compile, target);
    return `_fractal_mandelbrot(${gpuComplexOperand(c, compile, target)}, ${iterCode})`;
  },
  Julia: ([z, c, maxIter], compile, target) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Could not compile `Julia`: missing arguments');
    const iterCode = compileIntArg('Julia', maxIter, compile, target);
    return `_fractal_julia(${gpuComplexOperand(z, compile, target)}, ${gpuComplexOperand(c, compile, target)}, ${iterCode})`;
  },

  // Vector/Matrix operations
  Cross: 'cross',
  Distance: 'distance',
  Dot: 'dot',
  // The GLSL/WGSL `length()` builtin is the Euclidean NORM of a vector, which
  // is CE `Norm` — NOT CE `Length` (element count; fails closed below).
  // `length()` only accepts scalars and vec2/3/4: a fixed-arity point or list
  // literal outside that range compiles to an ARRAY constructor
  // (`float[5](...)`), which `length()` rejects — so emit `abs` for arity 1
  // and fail closed for arity ≥ 5 or a norm-type argument rather than
  // reporting success on invalid shader source.
  //
  // `markAggregateConsuming` for a point with a broadcasting component only:
  // that form compiles the explicit norm, whose own nodes pass the shape
  // gates, and the emission no longer contains the point operand, which has
  // no shader shape of its own (it reads as an array).
  Norm: markAggregateConsuming((args, compile, target) => {
    if (args.length > 1)
      throw new Error(
        `Could not compile \`Norm\`: only the default L2 norm compiles on the ` +
          `${target.language ?? 'GPU'} target.`
      );
    const arg = args[0];
    // A point with a broadcasting component is one point per element of its
    // list components, so its norm is one number per element, as on the
    // JavaScript target. It compiles as the explicit
    // `Sqrt(Square(c1) + … + Square(cn))`, which the shader target lowers
    // element-wise to the same vector as the norm written by hand. This
    // requires that the list components have one length that the static
    // types give (`explicitBroadcastPointNorm`): a shader vector has a
    // static width, and the run-time zip of a `PointList` to its shortest
    // list has no shader form. Other cases fail closed.
    if (
      (isFunction(arg, 'Tuple') || isFunction(arg, 'PointList')) &&
      pointHasBroadcastComponent(arg)
    ) {
      const explicit = explicitBroadcastPointNorm(arg, target);
      if (typeof explicit === 'string')
        throw new Error(
          `Could not compile \`Norm\`: a point with a broadcasting component, and ${explicit}.`
        );
      return compile(explicit);
    }
    if (isFunction(arg, 'Tuple') || isFunction(arg, 'List')) {
      // A broadcasting component of a `List` is not a matrix row: it means
      // one norm per zipped element, not a scalar. Fail closed.
      if (pointHasBroadcastComponent(arg))
        throw new Error(
          'Could not compile `Norm`: a point with a broadcasting component.'
        );
      const n = arg.nops;
      if (n === 0 || n > 4)
        throw new Error(
          `Could not compile \`Norm\`: the ${target.language ?? 'GPU'} 'length()' builtin only ` +
            `accepts 2-4 component vectors (got ${n}).`
        );
      // A complex entry lowers to a `vec2` of (re, im), and an array of
      // them is not a `length()` operand. The 2-norm is the length of the
      // vector of the entries' moduli: `length(z)` for a complex entry, the
      // value itself for a real one (only its square is used).
      if (arg.ops.some((x) => BaseCompiler.isComplexValued(x))) {
        const moduli = arg.ops.map((x) => {
          if (BaseCompiler.isComplexValued(x)) return `length(${compile(x)})`;
          // A real entry must be a scalar: a point beside a complex entry
          // would put a `vec2` inside the vector of moduli.
          if (gpuOperandShape(x) !== 'scalar')
            throw new Error(
              `Could not compile \`Norm\`: the entry \`${x.toString()}\` is not a scalar, so it ` +
                `has no modulus beside a complex entry.`
            );
          return compile(x);
        });
        if (n === 1) return moduli[0];
        return `length(${gpuFVec(n, target)}(${moduli.join(', ')}))`;
      }
      if (n === 1) return `abs(${compile(arg.op1)})`;
      return `length(${compile(arg)})`;
    }
    // Non-literal operand (e.g. a vec-typed symbol): `length()` applies.
    return `length(${compile(arg)})`;
  }, isBroadcastPointNormOperand),
  Length: (_args, _compile, target) => {
    throw new Error(
      `Could not compile \`Length\`: the collection element count is not supported on the ` +
        `${target.language ?? 'GPU'} target: the '${target.language ?? 'GPU'}' ` +
        `'length()' builtin is the Euclidean norm (CE 'Norm'), not a count.`
    );
  },
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Sum/Product — unrolled or for-loop (indexed form), or a fold over the
  // operand's components (collection form).
  //
  // `markAggregateConsuming` for the COLLECTION form only: there the reduction
  // DESTRUCTURES its operand into scalars, so the emission carries none of the
  // operand's `vecN`/array shape and must not be judged against it. The
  // indexed form's operands (a scalar body and a `Limits`) stay gated.
  Sum: markAggregateConsuming(
    (args, compile, target) =>
      compileGPUSumProduct('Sum', args, compile, target),
    gpuIsCollectionReduceForm
  ),
  Product: markAggregateConsuming(
    (args, compile, target) =>
      compileGPUSumProduct('Product', args, compile, target),
    gpuIsCollectionReduceForm
  ),

  // Range — inline constant array literal (bounds must be compile-time constants)
  Range: (args, _compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(
        'Could not compile `Range`: GPU compile expects 2 or 3 arguments (lo, hi, step?)'
      );
    }
    const lo = args[0].re;
    const hi = args[1].re;
    const step = args.length === 3 ? args[2].re : 1;
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      !Number.isFinite(step)
    ) {
      throw new Error(
        'Could not compile `Range`: GPU compile requires constant numeric bounds' +
          ' (non-constant ranges must be materialized at JS host then uploaded as a uniform)'
      );
    }
    if (step === 0)
      throw new Error('Could not compile `Range`: step cannot be zero');
    const count = rangeCount(lo, hi, step);
    if (count === 0) {
      throw new Error(
        'Could not compile `Range`: empty range (lo > hi for positive step, or lo < hi for negative step)'
      );
    }
    if (count > GPU_MAX_INLINE_ELEMENTS) {
      throw new Error(
        `Could not compile \`Range\`: GPU compile inlines ranges up to ${GPU_MAX_INLINE_ELEMENTS} elements (got ${count})`
      );
    }
    const values: number[] = [];
    for (let i = 0; i < count; i++) values.push(lo + i * step);
    const isWGSL = target.language === 'wgsl';
    const arrayType = isWGSL ? `array<f32, ${count}>` : `float[${count}]`;
    return `${arrayType}(${values
      .map((v) => formatGPUNumber(v, target.language))
      .join(', ')})`;
  },

  // Loop — GPU for-loop (no IIFE, no let)
  Loop: (args, _compile, target) => {
    if (!args[0]) throw new Error('Could not compile `Loop`: no body');
    if (!args[1]) throw new Error('Could not compile `Loop`: no indexing set');

    const indexing = args[1];
    if (!isFunction(indexing, 'Element'))
      throw new Error(
        'Could not compile `Loop`: expected Element(index, Range(lo, hi))'
      );

    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr))
      throw new Error('Could not compile `Loop`: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range'))
      throw new Error('Could not compile `Loop`: expected Range(lo, hi)');

    const index = indexExpr.symbol;
    // The loop index is declared and referenced bare — reject a reserved name.
    gpuCheckIdentifier(index, target.language);
    const lower = Math.floor(rangeExpr.ops[0].re);
    const upper = Math.floor(rangeExpr.ops[1].re);

    if (!Number.isFinite(lower) || !Number.isFinite(upper))
      throw new Error(
        'Could not compile `Loop`: bounds must be finite numbers'
      );

    const isWGSL = target.language === 'wgsl';
    const intType = isWGSL ? 'i32' : 'int';

    // The counter is declared as an integer (for `i++`), but shader scalar math
    // is float. Consume the index as a float (`float(i)` / `f32(i)`) so it is
    // type-consistent wherever the body uses it in float arithmetic — mirroring
    // the Sum/Product for-loop path.
    const indexAsFloat = isWGSL ? `f32(${index})` : `float(${index})`;
    // The body is a STATEMENT LIST, not a value: compiled for a value, a
    // multi-statement body emitted `return <last statement>` inside the loop
    // — returning from the shader on the first iteration. It is also the
    // position where a destructuring assign (`(a, b) := (b, a + b)`) lowers.
    const bodyCode = BaseCompiler.compileStatementList(args[0], {
      ...target,
      var: (id) => (id === index ? indexAsFloat : target.var(id)),
      // The counter shadows any same-named engine symbol (an index named `i`
      // must not resolve to the imaginary unit in the operand analysis).
      boundVars: BaseCompiler.withBoundNames(target, [index]),
    });

    const indexDecl = isWGSL
      ? `var ${index}: ${intType}`
      : `${intType} ${index}`;
    // Every line of the body arrives terminated by the statement-list
    // joiner (`compileStatementList`), so the body is only indented here.
    const body = bodyCode
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n');
    return `for (${indexDecl} = ${lower}; ${index} <= ${upper}; ${index}++) {\n${body}\n}`;
  },

  // Statistical functions

  /**
   * GCD of two scalar arguments.
   *
   * Uses a preamble helper `_gpu_gcd` (Euclidean algorithm via `mod`).
   * Only two-argument form is supported in GPU targets.
   */
  GCD: (args, compile) => {
    if (args.length < 2)
      throw new Error('Could not compile `GCD`: need at least two arguments');
    if (args.length > 2)
      throw new Error(
        'Could not compile `GCD`: GPU target supports only two-argument GCD'
      );
    const a = args[0];
    const b = args[1];
    if (a === null || b === null)
      throw new Error('Could not compile `GCD`: missing argument');
    return `_gpu_gcd(${compile(a)}, ${compile(b)})`;
  },

  /**
   * Variance of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * Generates fully inline code: computes mean then sum of squared deviations,
   * divided by (N-1) for sample variance (matches JS `_SYS.variance`).
   *
   * `markAggregateConsuming`: with a single `List` operand the elements are
   * DESTRUCTURED into scalars, so the emission contains no aggregate at all
   * and must not be judged against the operand's `array`/`vecN` shape. The
   * N-scalar-argument form passes its operands through and stays gated.
   */
  Variance: markAggregateConsuming((args, compile, target) => {
    // Normalise: if single List arg, use its elements; else use args directly.
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 2) {
      elems = args;
    } else {
      throw new Error(
        'Could not compile `Variance`: GPU target requires a List argument or at least 2 scalar arguments'
      );
    }
    const n = elems.length;
    if (n < 2)
      throw new Error('Could not compile `Variance`: need at least 2 elements');
    // Every element is spliced 2 + 2·N times (once per mean term, plus twice
    // per squared deviation), so an IMPURE (Random-family) element was drawn
    // once per splice — `Variance(Random(), Random())` consumed TWELVE draws
    // where the interpreter draws two. Bind impure elements to a hoisted
    // temporary each; pure elements compile directly (byte-identical).
    const compiled = elems.map((e) =>
      gpuOperandOnce('Variance', e, compile, target)
    );
    // mean = (v0 + v1 + ... + vN-1) / N
    const sum = compiled.join(' + ');
    const mean = `((${sum}) / ${formatGPUNumber(n)})`;
    // sum of squared deviations: (v0 - mean)^2 + ...
    const sqDiffs = compiled
      .map((c) => `(${c} - ${mean}) * (${c} - ${mean})`)
      .join(' + ');
    // sample variance: sum / (N - 1)
    return `((${sqDiffs}) / ${formatGPUNumber(n - 1)})`;
  }, gpuDestructuresListOperand),

  /**
   * Median of a compile-time-known list.
   *
   * Accepts either a single `List(...)` argument or N scalar arguments.
   * For N ≤ 8: generates a fully unrolled inline sorting network followed by
   * a middle-element pick. For larger N, throws (too large to inline cleanly).
   *
   * The sorting network uses the "odd-even merge sort" comparator pattern
   * inlined as `min`/`max` calls — no GPU statements required.
   *
   * `markAggregateConsuming`: a single `List` operand is DESTRUCTURED into one
   * scalar per element (`_gpu_median_5(1.0, 5.0, …)`), so the emission carries
   * none of the operand's aggregate shape. The N-scalar-argument form passes
   * its operands through and stays gated.
   */
  Median: markAggregateConsuming((args, compile) => {
    // Normalise to element list
    let elems: ReadonlyArray<Expression>;
    if (args.length === 1 && isFunction(args[0], 'List')) {
      elems = args[0].ops;
    } else if (args.length >= 1) {
      elems = args;
    } else {
      throw new Error(
        'Could not compile `Median`: GPU target requires a List argument or at least 1 scalar argument'
      );
    }
    const n = elems.length;
    if (n === 0) throw new Error('Could not compile `Median`: empty list');
    if (n > 8) {
      throw new Error(
        `Could not compile \`Median\`: GPU target supports up to 8 elements via inline sorting network (got ${n}). ` +
          'For larger lists, compute on the CPU and pass the result as a uniform.'
      );
    }

    // Compile each element. We'll refer to them by variable names v0..vN-1.
    // Build a sequence of min/max comparators that sort the array in place.
    // Then return the middle element (or average of two middles for even N).
    const compiled = elems.map((e) => compile(e));

    // For N=1, median is the single element
    if (n === 1) return compiled[0];

    // Build a small inline sort using a Batcher odd-even sort network.
    // We represent the "array" as a mutable JS array of code strings.
    // Each "comparator" sorts a pair: (v[i], v[j]) → min then max.
    // We inline this as: new_i = min(a, b); new_j = max(a, b)
    // But since GLSL/WGSL have no statements in expressions, we encode
    // the full sorted sequence using nested min/max only when possible.
    //
    // Strategy: generate all comparator pairs for sorting network (as a list),
    // then materialise the sorted array as named sub-expressions via let-binding.
    // Since GPU compile() returns strings (not blocks), we use a different
    // approach: produce a comma-expression–style sequence using _gpu_median helper.
    //
    // Simpler approach that avoids preamble: for each position from 0..n-1,
    // compute the k-th order statistic inline using the formula:
    //   kth_element(k, v[]) = sum over all subsets S of size k+1 of (-1)^...
    // This is exponential. Instead use the "min of maxes" approach:
    //   sorted[k] = (k+1)-th smallest = min over all (k+1)-subsets of max(subset)
    // This is O(n choose k+1) — too expensive for n=8.
    //
    // Cleanest solution: call `_gpu_median_N` preamble function.
    // We emit a per-size preamble (GPU_MEDIAN_PREAMBLE_N_GLSL / WGSL)
    // and return a call to `_gpu_median_N(v0, v1, ..., vN-1)`.
    return `_gpu_median_${n}(${compiled.join(', ')})`;
  }, gpuDestructuresListOperand),

  /**
   * One draw from the counter-based PCG3D stream — the GPU tier of the
   * random family redesign
   * (`docs/RANDOMNESS-MODEL.md` §2, §4, §7).
   *
   * Every form returns a GLSL `float` (WGSL `f32`), so it composes with the
   * surrounding float arithmetic without a cast. The domain forms return an
   * integer-valued float (the result of `floor`) for a `Range`, matching the
   * convention `Floor` and the other ostensibly integer-returning operators
   * of this target use.
   *
   * | Form | GLSL | WGSL |
   * |---|---|---|
   * | `Random()` inside `WithRandomSeed` | `hash(seed, n)` | `hash(seed, n)` |
   * | `Random(Interval/Range)` inside a frame | arithmetic on the draw | same |
   * | `Random()` unframed | fragment stage: spatial noise; any other stage **throws** | **throws** |
   * | `Random(collection)` | **throws** — no general indexing | **throws** |
   *
   * The presented value is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two
   * conversion of the top 24 bits of the same `w0` the f64 tier is built
   * from, so the two tiers agree to within 2⁻²⁴ by construction rather than
   * by tuning. See `gpuRandomDraw`.
   *
   * `markAggregateConsuming` for the one-operand form: the DOMAIN is a
   * collection (an `Interval` is `set<real>`, a `Range` is `range`), and
   * `gpuRandomDomainDraw` DESTRUCTURES it into scalar endpoints — the draw
   * arithmetic contains the endpoints, never the collection. Without the
   * declaration the generic shape gate judges the emission against an array
   * operand shape that the emission does not contain. A domain this head
   * cannot destructure still fails closed, through the head's own diagnostic.
   */
  Random: markAggregateConsuming(
    (args, compile, target) => {
      if (args.length === 0) return gpuRandomDraw(target);
      if (args.length === 1)
        return gpuRandomDomainDraw(args[0], compile, target);
      throw new Error(
        'Could not compile `Random`: expects at most one operand, the DOMAIN to draw from ' +
          '(`Random()`, `Random(Interval(a, b))`, `Random(Range(…))`). The ' +
          'seed argument was removed by the Random family redesign — seed ' +
          'with `WithRandomSeed(seed, body)`.'
      );
    },
    (args) => args.length === 1
  ),

  /**
   * A LEXICALLY scoped random-seed frame (§4 "The GPU boundary is genuinely
   * one-domain"). A shader invocation cannot share the host's mutable draw
   * counter, and fragments run in parallel, so a GPU frame lives entirely
   * inside the shader: the seed is folded (see `gpuFoldSeedSource` for the
   * seed ABI) and the frame gets its own invocation-local u32 counter, which
   * every invocation starts at 0.
   *
   * `WithRandomSeed` returns its body's value, so the emission is the body's
   * code — the frame exists only as the counter the enclosed draws consume.
   * Nested frames each allocate their own counter, so an inner frame cannot
   * perturb its parent's subsequent draws (the §2 per-frame-counter rule).
   */
  WithRandomSeed: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error(
        'Could not compile `WithRandomSeed(seed, body)`: expects exactly two operands'
      );
    const state = gpuRandomState(target);
    // The seed is folded ONCE per frame, before the body is compiled.
    const seed = gpuFoldSeedSource(args[0], compile, target);
    const counter = allocGPURandomCounter(state);
    state.frames.push({ seed, counter });
    try {
      return gpuIdentityPassthrough(args[1], compile, target);
    } finally {
      state.frames.pop();
    }
  },

  // The multi-draw members of the family need general collection indexing (or
  // a mutable permutation buffer), which a shader expression has no way to
  // express. Fail closed with the reason rather than let them fall
  // through to a bare `Unknown operator`.
  RandomChoice: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomChoice(domain, k)', target));
  },
  RandomSample: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomSample(xs, k)', target));
  },
  RandomShuffle: (_args, _compile, target) => {
    throw new Error(gpuNoIndexingMessage('RandomShuffle(xs)', target));
  },

  // `Apply(callee, args…)`: the parse of `f'(x)` is
  // `Apply(Derivative(f, 1), x)`. A shader has no function values, so the
  // callee cannot be emitted as a lambda. Instead, the arguments are
  // substituted into the body of the callee's function literal, and the
  // substituted body is compiled (`gpuAppliedBody`).
  Apply: (args, compile, target) => {
    const body = gpuAppliedBody(args, target);
    if (typeof body === 'string')
      throw new Error(`Could not compile \`Apply\`: ${body}`);
    return compile(body);
  },

  // Function (lambda) — not supported in GPU
  Function: () => {
    throw new Error(
      'Anonymous functions (Function) are not supported in GPU targets'
    );
  },
};

/**
 * The body of the callee of `Apply(callee, args…)` with the arguments
 * substituted for its parameters, or the reason why there is none.
 *
 * Two callees have a function literal. A `Function` literal is its own
 * literal. A `Derivative(f, n)` or a `Derivative(f, k₁, …, kₙ)` has the
 * closed form of the derivative when the engine can differentiate `f`, and
 * the interval target reads the same closed form
 * (`BaseCompiler.appliedDerivativeLiteral`). That closed form is
 * already rewritten for the engine's angular unit. It is not used when the
 * body of `f` is large or the order is high (`prefersJetDerivative`,
 * jet-derivative.ts), because the closed form then grows past a useful size.
 * A derivative with no closed form of a useful size, or any other callee, has
 * no literal, and the application is declined.
 *
 * The substitution is sound only under these conditions:
 *  - the literal takes exactly one argument per parameter, and each
 *    parameter is a plain name (not a rest parameter and not a
 *    destructuring pattern). The interpreter curries an under-applied call
 *    and rejects an over-applied one, and a shader can do neither;
 *  - the body is a single statement;
 *  - every argument is pure. The body can read a parameter more than once,
 *    and the substitution then repeats the argument, while the interpreter
 *    evaluates it once;
 *  - no binder in the body rebinds a parameter or captures a symbol of an
 *    argument, because `subs` is not capture-avoiding.
 *
 * When the parameters of the literal are scalar and an argument is a
 * collection, the interpreter applies the function to each element, not to
 * the whole collection. The substitution then follows the same rule
 * (`gpuMappedAppliedBody`).
 *
 * An argument that is bound whole must match the declared type of its
 * parameter (`BaseCompiler.appliedArgumentTypeMismatch`), or the
 * application is declined.
 */
function gpuAppliedBody(
  args: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Expression | string {
  const [callee, ...actuals] = args;
  if (callee === undefined) return 'missing function';
  const literal = isFunction(callee, 'Derivative')
    ? BaseCompiler.appliedDerivativeLiteral(args)
    : callee;
  if (!isFunction(literal, 'Function')) {
    if (isFunction(callee, 'Derivative'))
      return (
        `${BaseCompiler.appliedDerivativeDeclineReason(args)}, and ` +
        `target '${target.language}' has no numerical derivative.`
      );
    return (
      `only a function literal or the derivative of a function compiles as ` +
      `the callee on target '${target.language}'.`
    );
  }
  const params = literal.ops.slice(1);
  if (params.length !== actuals.length)
    return (
      `the function takes ${params.length} parameter(s) but ` +
      `${actuals.length} argument(s) are supplied.`
    );
  const substitution: Record<string, Expression> = {};
  for (const [i, p] of params.entries()) {
    const name = isRestParameter(p) ? '' : functionLiteralParameterName(p);
    if (!name) return 'a parameter of the function is not a plain name.';
    substitution[name] = actuals[i];
  }
  const inner = literal.ops[0];
  const body =
    isFunction(inner, 'Block') && inner.nops === 1 ? inner.op1 : inner;
  if (isFunction(body, 'Block'))
    return 'the body of the function has more than one statement.';
  if (!actuals.every((a) => a.isPure === true))
    return 'an argument has an effect, which the substitution would repeat.';
  const binders = collectBinderNames(body);
  for (const [name, arg] of Object.entries(substitution)) {
    if (binders.has(name))
      return `the body of the function rebinds \`${name}\`.`;
    for (const s of arg.symbols)
      if (binders.has(s))
        return `the body of the function binds \`${s}\`, which an argument reads.`;
  }
  if (literalParamsMap(literal.type.type) && actuals.some(gpuMapsOverArgument))
    return gpuMappedAppliedBody(
      literal,
      body,
      Object.keys(substitution),
      actuals,
      target
    );
  const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
    literal,
    actuals,
    false
  );
  if (mismatch !== undefined) return mismatch;
  return body.subs(substitution);
}

/**
 * The application of a function literal with scalar parameters to arguments
 * of which at least one is a collection, written element by element:
 * `Apply(u ↦ body, [a, b])` becomes `[body[u := a], body[u := b]]`, or the
 * reason why it cannot be written.
 *
 * The interpreter applies such a function to each element of the collection
 * arguments (`applyLiteralMapped` in `library/core.ts`). It zips the
 * collection arguments, and it gives each cell the same value of an argument
 * that is not a collection (a scalar, a point or a string). Substituting the
 * whole collection for the parameter is wrong: a body that does not read
 * the parameter (`u ↦ 7`) gives one number instead of one number per
 * element, and a body with an operation that does not apply element by
 * element gives a different value.
 *
 * Each collection argument must have a length known at compile time
 * (`gpuMappedArgumentElements`), and all of them must have the same length.
 * The interpreter gives an `incompatible-dimensions` error for different
 * lengths, and a shader has no form of that error, so the application is
 * declined. A cell whose element is itself a collection maps again, as in
 * the interpreter, so a nested list gives a nested result. The shape of the
 * result is decided when the `List` is compiled.
 *
 * `names` are the parameter names of the literal, in order. The checks of
 * `gpuAppliedBody` (purity, binders) apply to the whole arguments, so they
 * also apply to their elements.
 */
function gpuMappedAppliedBody(
  literal: Expression,
  body: Expression,
  names: ReadonlyArray<string>,
  actuals: ReadonlyArray<Expression>,
  target: CompileTarget<Expression>
): Expression | string {
  let width: number | undefined;
  const columns: Array<ReadonlyArray<Expression> | undefined> = [];
  for (const actual of actuals) {
    if (!gpuMapsOverArgument(actual)) {
      columns.push(undefined);
      continue;
    }
    const elements = gpuMappedArgumentElements(actual);
    if (elements === undefined)
      return (
        `the function applies to each element of the argument ` +
        `\`${actual.toString()}\`, but target '${target.language}' cannot ` +
        `write out its elements: its length is not known at compile time, ` +
        `or it has more than ${GPU_MAX_INLINE_ELEMENTS} elements.`
      );
    if (width !== undefined && elements.length !== width)
      return (
        `the function applies to each element of collection arguments of ` +
        `different lengths (${width} and ${elements.length}).`
      );
    width = elements.length;
    columns.push(elements);
  }
  const cells: Expression[] = [];
  for (let k = 0; k < (width ?? 0); k++) {
    const row = actuals.map((actual, i) => columns[i]?.[k] ?? actual);
    if (
      row.some((e, i) => columns[i] !== undefined && gpuMapsOverArgument(e))
    ) {
      const cell = gpuAppliedBody([literal, ...row], target);
      if (typeof cell === 'string') return cell;
      cells.push(cell);
    } else {
      const mismatch = BaseCompiler.appliedArgumentTypeMismatch(
        literal,
        row,
        false
      );
      if (mismatch !== undefined) return mismatch;
      const substitution: Record<string, Expression> = {};
      for (const [i, name] of names.entries()) substitution[name] = row[i];
      cells.push(body.subs(substitution));
    }
  }
  return literal.engine.function('List', cells);
}

/**
 * Does a function literal with scalar parameters apply to each element of
 * the argument `arg`, not to `arg` as a whole?
 *
 * The interpreter evaluates the argument first and then asks whether the
 * value is an indexed collection that is not a tuple (a point) and not a
 * string (`applyLiteralMaps` in `library/core.ts`). Compiled code reads the
 * argument before it is evaluated, so the static type gives the answer
 * instead, as in the type handler of `Apply` (`applyLiteralMapType`):
 * `[a, b] + c` has the type `vector<2>` and is a list when evaluated, and a
 * symbol declared `list<real^2>` holds a list when the shader runs.
 */
function gpuMapsOverArgument(arg: Expression): boolean {
  if (isBroadcastableCollection(arg)) return true;
  const t = resolveTypeAlias(arg.type.type);
  return (
    isSubtype(t, INDEXED_COLLECTION_SHAPE_TYPE) &&
    !isSubtype(t, 'string') &&
    !(typeof t === 'object' && t.kind === 'tuple')
  );
}

/**
 * The elements of a collection argument that `gpuMappedAppliedBody` writes
 * out, or `undefined` when the length is not known at compile time.
 *
 * A literal `List` gives its operands. A `Range` with number-literal bounds
 * gives its values, as the `Range` entry of the function table does. Another
 * expression that the shader holds as a `vec2`, `vec3` or `vec4`
 * (`gpuOperandShape`) gives its components, read with `At`. Any other
 * collection (a shader array, a matrix, a list of unknown length) gives
 * `undefined`. A list with more elements than a shader array constructor
 * takes (`GPU_MAX_INLINE_ELEMENTS`) also gives `undefined`.
 */
function gpuMappedArgumentElements(
  arg: Expression
): ReadonlyArray<Expression> | undefined {
  const ce = arg.engine;
  if (isFunction(arg, 'List'))
    return arg.nops <= GPU_MAX_INLINE_ELEMENTS ? arg.ops : undefined;
  if (isFunction(arg, 'Range') && (arg.nops === 2 || arg.nops === 3)) {
    const lo = arg.ops[0].re;
    const hi = arg.ops[1].re;
    const step = arg.nops === 3 ? arg.ops[2].re : 1;
    if (![lo, hi, step].every(Number.isFinite) || step === 0) return undefined;
    const count = rangeCount(lo, hi, step);
    if (count > GPU_MAX_INLINE_ELEMENTS) return undefined;
    return Array.from({ length: count }, (_, k) => ce.number(lo + k * step));
  }
  const shape = gpuOperandShape(arg);
  if (typeof shape !== 'number') return undefined;
  return Array.from({ length: shape }, (_, k) =>
    ce.function('At', [arg, ce.number(k + 1)])
  );
}

//
// ─── Counter-based random draws (PCG3D) ─────────────────────────────────────
//
// The GPU tier of `docs/RANDOMNESS-MODEL.md`. The
// n-th draw of a frame is `hash(seed, n)` — a pure function of the seed and
// the draw index — so a shader, which has no persistent stream and cannot
// carry mutable RNG state across invocations, can still replay a frame.
//
// Three things make the tier well-defined:
//
// 1. `pcg3d` is transcribed VERBATIM from the paper (§2 of the design), pure
//    u32 arithmetic, so it is a transcription on every target rather than an
//    independent reimplementation. `pcg3dWords` in `numerics/random.ts` is
//    the reference: the shader must compute the identical integer words.
// 2. The presentation is `(w0 >> 8) * 2⁻²⁴` — an EXACT power-of-two scaling
//    of the top 24 bits of `w0`, never implementation-rounded float math.
//    The f64 tier is built from the SAME `w0`, so the tiers agree to within
//    2⁻²⁴ by construction.
// 3. Frames are LEXICAL (§4): the seed is folded in the shader (or on the
//    host, for a literal — see `gpuFoldSeedSource`) and each frame owns an
//    invocation-local u32 counter that every invocation starts at 0.
//

/**
 * Per-compilation state for the counter-based random draws.
 *
 * Installed eagerly by `GPUShaderTarget.createTarget()` so it survives the
 * `{ ...target }` spreads the base compiler makes while recursing — the state
 * object is shared by reference, which is what lets a `WithRandomSeed` handler
 * push a frame that the `Random` handlers nested inside its body can see.
 */
export type GPURandomState = {
  /** The stack of enclosing LEXICAL frames, innermost last. */
  frames: Array<{ seed: string; counter: string }>;

  /** How many counter variables have been allocated (names are positional). */
  counters: number;

  /** The counter shared by unframed (spatial-noise) draws, allocated lazily. */
  spatialCounter: string | undefined;

  /**
   * The shader stage being compiled, when known. `undefined` means the caller
   * did not say — the `compile()`/`compileToSource()` entry points — and the
   * historical fragment-shader assumption applies. `compileShader()` sets it,
   * which is what makes the §7 vertex-stage check possible.
   */
  stage: string | undefined;

  /**
   * Whether a HOST `WithRandomSeed` frame was active when this GPU compile
   * ran. An unframed shader draw is then the cross-domain case (§4) and fails
   * closed — never a silent live/spatial draw.
   */
  hostFrame: boolean;

  /**
   * The names the caller mapped through `vars`, when the entry point knows
   * them. A seed that resolves to one of these is the HOST-UNIFORM row of the
   * seed ABI, which is not implemented — see `gpuFoldSeedSource`.
   */
  varNames: ReadonlySet<string> | undefined;
};

type GPURandomTarget = CompileTarget<Expression> & {
  /**
   * The identity of the compilation this target belongs to.
   *
   * The state itself lives in the module-level `GPU_RANDOM_STATES` map, never
   * on the target, so a CALLER-supplied target is not mutated (and does not
   * carry counter numbering from one compilation into the next). The token is
   * a plain enumerable property because the base compiler recurses through
   * `{ ...target }` spreads: those copy the token BY REFERENCE, which is what
   * keeps a frame pushed by `WithRandomSeed` visible to the draws nested in
   * its body.
   */
  gpuRandomRoot?: object;
};

/**
 * Per-compilation random state, keyed by the compilation's root token — or,
 * for a hand-rolled target that never went through `createTarget()`, by the
 * target itself. Never stored ON the target.
 */
const GPU_RANDOM_STATES = new WeakMap<object, GPURandomState>();

/** A fresh (empty) random state — one per compilation. */
export function newGPURandomState(): GPURandomState {
  return {
    frames: [],
    counters: 0,
    spatialCounter: undefined,
    stage: undefined,
    hostFrame: false,
    varNames: undefined,
  };
}

/**
 * Give `target` — freshly created by `createTarget()`, so ours to write to —
 * its own compilation identity and a fresh random state.
 */
function installGPURandomState(target: GPURandomTarget): void {
  const token = {};
  target.gpuRandomRoot = token;
  GPU_RANDOM_STATES.set(token, newGPURandomState());
}

/**
 * The random state of the compilation `target` belongs to. A hand-rolled
 * target that never went through `createTarget()` gets one keyed by the target
 * object itself — enough for a single unframed draw, and without writing
 * anything to the caller's object.
 */
export function gpuRandomState(
  target: CompileTarget<Expression>
): GPURandomState {
  const key = (target as GPURandomTarget).gpuRandomRoot ?? target;
  let state = GPU_RANDOM_STATES.get(key);
  if (state === undefined) {
    state = newGPURandomState();
    GPU_RANDOM_STATES.set(key, state);
  }
  return state;
}

/**
 * Compilation-boundary hook (`CompileTarget.beginCompilation`): restart the
 * per-compilation counter NUMBERING of the compilation `target` belongs to.
 *
 * A target the engine creates is fresh for every `compile()`, so its numbering
 * starts at `_gpu_rnd_n0` on its own. A target the CALLER built once and passes
 * to two successive `compile()` calls does not — without this reset the second
 * compilation of the same expression would number its draws `n1, n2, …`,
 * breaking recompile-replay determinism on that path.
 *
 * Reset through the state, not by replacing it: the state is reached by the
 * identity token (which `{ ...target }` spreads copy by reference), and the
 * compilation CONTEXT `createTargetFor` stamped on it — shader stage, active
 * host frame, `vars` names — describes the caller, not this compilation, and
 * must survive. Frames are cleared because an unbalanced frame can only be the
 * residue of a compilation that threw.
 */
function resetGPURandomNumbering(target: CompileTarget<Expression>): void {
  const state = gpuRandomState(target);
  state.frames.length = 0;
  state.counters = 0;
  state.spatialCounter = undefined;
  // The generated-temporary numbering (`_tv1`, `_tv2`, … — the `Sum`/`Product`
  // loop accumulator) is per-compilation for exactly the same reason, and
  // restarts on the same boundary. Its collision inventory describes the
  // caller's expression, not this compilation, so it survives the reset — the
  // same split as the random state's CONTEXT above.
  BaseCompiler.resetNaming(target);
}

/**
 * Allocate the next invocation-local counter variable.
 *
 * Each frame owns one, plus one shared by the unframed spatial-noise draws.
 * The counter is a shader global (`var<private>` in WGSL): per-invocation and
 * initialized before the entry point runs, so every invocation runs each of
 * its frames from `n = 0`.
 *
 * Caveat worth knowing: GLSL and WGSL leave the evaluation ORDER of an
 * expression's operands unspecified, so which of two sibling draws in one
 * frame gets `n = 0` is not pinned by the source. The set of values drawn is,
 * and so is each draw's own determinism — but `Random() - Random()` inside one
 * frame may differ in sign between GPU drivers. The host tiers, which evaluate
 * left to right, do not have this freedom.
 */
function allocGPURandomCounter(state: GPURandomState): string {
  return `_gpu_rnd_n${state.counters++}`;
}

/** The prefix every allocated counter name carries (scanned for by the
 * preamble assembly). */
const GPU_RANDOM_COUNTER_PREFIX = '_gpu_rnd_n';

/** How a draw site passes its counter: GLSL takes it by `inout`, WGSL by a
 * pointer into the private address space. */
function gpuCounterArg(name: string, language: string | undefined): string {
  return language === 'wgsl' ? `&${name}` : name;
}

/** A `uvec2` (WGSL `vec2<u32>`) literal holding the two folded seed words. */
function gpuSeedWords(
  lo: number,
  hi: number,
  language: string | undefined
): string {
  const hex = (w: number) => `0x${(w >>> 0).toString(16).padStart(8, '0')}u`;
  const ctor = language === 'wgsl' ? 'vec2<u32>' : 'uvec2';
  return `${ctor}(${hex(lo)}, ${hex(hi)})`;
}

/**
 * One draw `u ∈ [0, 1)`.
 *
 * Inside a lexical frame this is `_gpu_rnd_draw(seed, n)`, which advances the
 * frame's own counter. Outside any frame it is the GLSL fragment-shader
 * spatial-noise exception (§7): a `gl_FragCoord`-derived seed through the same
 * PCG3D stream, with an invocation-local counter so repeated unframed draws
 * decorrelate instead of returning one value. Every other unframed case throws.
 */
function gpuRandomDraw(target: CompileTarget<Expression>): string {
  const state = gpuRandomState(target);
  const language = target.language;

  const frame = state.frames[state.frames.length - 1];
  if (frame !== undefined)
    return `_gpu_rnd_draw(${frame.seed}, ${gpuCounterArg(
      frame.counter,
      language
    )})`;

  // Unframed. The cross-domain case first (§4): the enclosing frame lives on
  // the HOST, whose mutable counter a parallel shader invocation cannot share.
  if (state.hostFrame)
    throw new Error(
      'Could not compile `Random()`: an unframed draw has no shader form while a host ' +
        '`WithRandomSeed` frame is active — a shader invocation cannot share ' +
        "the host's mutable draw counter, and fragments run in parallel. GPU " +
        'frames must be LEXICAL: move the `WithRandomSeed(seed, …)` inside the ' +
        'compiled expression.'
    );

  if (language === 'wgsl')
    throw new Error(
      'Could not compile `Random()`: an unframed draw has no WGSL form — a shader has no ' +
        'live random stream, and WGSL has no `gl_FragCoord` built-in to derive ' +
        'spatial noise from. Wrap the draw in `WithRandomSeed(seed, …)`, whose ' +
        'seed may be an invocation-varying expression.'
    );

  // `gl_FragCoord` exists only in a fragment shader. A vertex (or other) stage
  // fails at CE compile time rather than emitting code that fails later, at
  // GPU shader-compile time. An UNKNOWN stage keeps the historical
  // fragment-shader assumption of the `compile()` entry points.
  if (state.stage !== undefined && state.stage !== 'fragment')
    throw new Error(
      `Could not compile \`Random()\`: an unframed draw compiles to \`gl_FragCoord\`-derived spatial ` +
        `noise, which exists only in a fragment shader (this is a ` +
        `\`${state.stage}\` shader). Wrap the draw in ` +
        `\`WithRandomSeed(seed, …)\` to get a stage-independent stream.`
    );

  state.spatialCounter ??= allocGPURandomCounter(state);
  // A fragment's coordinate is stable across renders, so this is DETERMINISTIC
  // SPATIAL NOISE, not the live randomness an unframed draw has on the host —
  // the one documented exception to the liveness contract (§7). Both
  // coordinates are reinterpreted whole, so there is no row-aliasing bound.
  return (
    `_gpu_rnd_draw(uvec2(floatBitsToUint(gl_FragCoord.x), ` +
    `floatBitsToUint(gl_FragCoord.y)), ${state.spatialCounter})`
  );
}

/**
 * The names of the SYMBOLS in `expr` whose own static type is text — a
 * `string` or a `character`.
 *
 * Walks symbol NODES only, so a string LITERAL is never collected — a
 * `Declare(x, "number")` type annotation carries its type as a string operand
 * and is not a text VALUE. See the call site in `createTargetFor` for what the
 * set is used for.
 *
 * The walk follows the BODY of every user-defined function the expression
 * references, by name in operator position (`g(u)`) or as a value (`Map(g, …)`).
 * Those bodies are compiled against the compilation ROOT's target
 * (`userFunctions.root`), so their free symbols pass through the same
 * `mangleId` gate this set feeds — but they are not reachable from `expr`
 * itself, and a `string`-typed global referenced only inside such a body used
 * to be emitted as a bare identifier in the definition: `g(x) := If(sv < tv, x,
 * 0)` produced `float _fn_g(float x) { return ((sv < tv) ? (x) : (0.0)); }`,
 * comparing two floats where the interpreter compares text. Each name is
 * expanded at most once, so a self- or mutually recursive definition cannot
 * loop here (the GPU targets refuse recursion anyway). A MULTI-CLAUSE function
 * has no single literal and needs no walk: its emission is JavaScript-only, so
 * a shader compilation already fails closed on it.
 */
function gpuTextSymbols(expr: Expression | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  const expanded = new Set<string>();
  const walkUserFunctionBody = (e: Expression, name: string): void => {
    if (expanded.has(name)) return;
    expanded.add(name);
    const engine = e.engine;
    if (engine === undefined) return;
    const literal = BaseCompiler.userFunctionLiteral(engine, name);
    // `['Function', body, ...params]`: only the body can name a free symbol.
    // A text-typed PARAMETER needs no collecting here — the emitted signature
    // must be fully typed, and `gpuTypeOfDeclaredType` has no shader type for
    // text, so such a parameter fails closed in `lowering.define`.
    if (literal !== undefined && literal.ops.length > 0) walk(literal.ops[0]);
  };
  const walk = (e: Expression): void => {
    if (isSymbol(e)) {
      if (isProvablyStringOperand(e) || isProvablyCharacterOperand(e))
        out.add(e.symbol);
      else walkUserFunctionBody(e, e.symbol);
      return;
    }
    if (isFunction(e)) {
      if (typeof e.operator === 'string' && e.operator !== '')
        walkUserFunctionBody(e, e.operator);
      for (const op of e.ops) walk(op);
    }
  };
  if (expr !== undefined) walk(expr);
  return out;
}

/** The message for a random form that would need general collection indexing. */
function gpuNoIndexingMessage(
  form: string,
  target: CompileTarget<Expression>
): string {
  const lang = target.language ?? 'GPU';
  return (
    `${form} is not supported on the ${lang} target: a shader expression has ` +
    `no general collection indexing. Only \`Random()\`, ` +
    `\`Random(Interval(a, b))\` and \`Random(Range(…))\` compile — the ` +
    `closed-form domains.`
  );
}

/**
 * `Random(domain)` — the closed-form domains only.
 *
 * `Interval` → `lo + u * (hi - lo)`; `Range` → `first + step * floor(u * n)`
 * over the range's NORMALIZED parameters, matching the interpreter's
 * `selectRandomElement` (`library/core.ts`) term for term. Any other domain
 * would need indexing, so it fails closed.
 */
function gpuRandomDomainDraw(
  domain: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  if (isFunction(domain, 'Interval')) {
    if (domain.nops !== 2)
      throw new Error('Random(Interval(a, b)): expects two endpoints');
    // Endpoint markers are IGNORED — a float draw cannot respect an open
    // endpoint, so the draw is half-open `[lo, hi)` either way.
    const strip = (x: Expression): Expression =>
      isFunction(x, 'Open') || isFunction(x, 'Closed') ? x.op1 : x;
    const loExpr = strip(domain.op1);
    const hiExpr = strip(domain.op2);

    // Endpoints are SPLICED into the emitted expression — `lo` twice — because
    // a shader expression has no statement to evaluate them into once. Pure
    // arithmetic on uniforms is only an ALU cost, but an endpoint that
    // consumes draws would consume a different NUMBER of them than the host.
    // Fail closed.
    for (const [role, endpoint] of [
      ['lower', loExpr],
      ['upper', hiExpr],
    ] as const)
      if (!endpoint.canonical.isPure)
        throw new Error(
          `Could not compile \`Random(Interval(a, b))\`: the ${role} endpoint is not pure — a ` +
            `shader expression has no statement to evaluate it into once, so ` +
            `the endpoint is spliced (and would run) more than once per ` +
            `draw. Hoist the draw out of the endpoint.`
        );

    const lo = tryGetConstant(loExpr);
    const hi = tryGetConstant(hiExpr);
    if (lo !== undefined && hi !== undefined) {
      if (!(hi > lo))
        throw new Error(
          `Random(Interval(${lo}, ${hi})): the interval is empty or reversed ` +
            `— there is no uniform distribution to draw from.`
        );
      return `(${formatGPUNumber(lo)} + ${gpuRandomDraw(
        target
      )} * ${formatGPUNumber(hi - lo)})`;
    }
    // Symbolic endpoints (typically uniforms) stay live. `lo` is spliced
    // twice, so an endpoint with a side effect (a nested draw) would be
    // consumed twice — endpoints are expected to be uniforms or constants.
    const loSrc = compile(loExpr);
    const hiSrc = compile(hiExpr);
    return `((${loSrc}) + ${gpuRandomDraw(
      target
    )} * ((${hiSrc}) - (${loSrc})))`;
  }

  if (isFunction(domain, 'Range')) {
    const n = smallCount(domain);
    if (n === undefined || !Number.isFinite(n))
      throw new Error(
        'Could not compile `Random(Range(…))`: the GPU target requires a Range with constant, ' +
          'finite bounds — a symbolic or unbounded range has no known element ' +
          'count to draw from.'
      );
    if (n === 0)
      throw new Error('Random(Range(…)): the range is empty (no elements).');

    // The normalized (first, step) of the range — mirrors `range()` in
    // `library/collections.ts`: a two-operand range infers a DESCENDING step
    // when its bounds are reversed (`Range(7, 2)`).
    const ops = domain.ops;
    let first: number;
    let step: number;
    if (ops.length === 1) {
      first = 1;
      step = 1;
    } else if (ops.length === 2) {
      first = ops[0].re;
      step = ops[1].re >= ops[0].re ? 1 : -1;
    } else {
      first = ops[0].re;
      step = ops[2].re;
    }
    if (!Number.isFinite(first) || !Number.isFinite(step))
      throw new Error(
        'Random(Range(…)): the GPU target requires constant numeric bounds.'
      );

    const index = `floor(${gpuRandomDraw(target)} * ${formatGPUNumber(n)})`;
    // `first + step * index`, with the sign lifted out of the literal so a
    // descending range emits `(7.0 - 1.0 * …)` rather than `(7.0 + -1.0 * …)`.
    const sign = step < 0 ? '-' : '+';
    const magnitude = Math.abs(step);
    if (magnitude === 1) return `(${formatGPUNumber(first)} ${sign} ${index})`;
    return `(${formatGPUNumber(first)} ${sign} ${formatGPUNumber(
      magnitude
    )} * ${index})`;
  }

  throw new Error(gpuNoIndexingMessage('Random(collection)', target));
}

/**
 * The GPU seed ABI (§7). Which fold applies is decided by WHERE the seed value
 * lives, because a shader has neither f64 nor strings and so cannot run the
 * normative `foldSeed`:
 *
 * | Seed form | Folding | Stream identity |
 * |---|---|---|
 * | compile-time constant (number or string literal, a declared constant such as `Pi`, an assigned engine value) | HOST `foldSeed`, emitted as a `uvec2` constant | **identical** to the interpreted/JS stream |
 * | a FREE symbol the shader supplies (uniform/varying, not in `vars`) | in-shader `floatBitsToUint` / `bitcast<u32>`, `seedHi = 0u` | its OWN stream — deterministic given the seed BITS |
 * | a `vars`-mapped symbol (a HOST-supplied uniform) | — | **compile error**: the host-uniform ABI row is not implemented |
 * | a COMPUTED expression | — | **compile error**: the seed is spliced per draw site |
 * | a string computed at run time | impossible in a shader | **compile error** |
 *
 * The last two rows are the once-evaluation rule. The emitted seed source is
 * spliced into EVERY draw site of the frame — a shader expression has no
 * statement to evaluate it into once — so anything but a constant or a single
 * identifier would be recomputed per draw (and, if it consumed draws, would
 * silently change the draw count). Symbol handling is therefore: a symbol that
 * resolves to a VALUE folds on the host; a symbol the caller mapped through
 * `vars` fails closed (below); any other symbol is a name the shader itself
 * must declare, and stays live as its own stream.
 *
 * A bit reinterpretation is exact, so the derived stream is bit-deterministic
 * given the seed bits; the seed's own f32 value remains subject to ordinary
 * GPU float variance. Determinism claims stop at the fold's input.
 */
function gpuFoldSeedSource(
  seedExpr: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string {
  const language = target.language;

  if (isString(seedExpr)) {
    const [lo, hi] = foldSeed(seedExpr.string);
    return gpuSeedWords(lo, hi, language);
  }
  if (seedExpr.type.matches('string'))
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: a string seed that is not a compile-time ' +
        'literal cannot be folded in a shader — GLSL and WGSL have no ' +
        'strings. Use a literal string, a numeric seed, or fold the seed on ' +
        'the host.'
    );

  // `WithRandomSeed` is `lazy`, so the held seed arrives UNBOUND on the box
  // and parse routes: canonicalize before asking it anything. (`.canonical` is
  // value-safe — it binds structure without substituting assigned values.)
  const seed = seedExpr.canonical;

  // The seed source is spliced at every draw site, so a seed with a side
  // effect — a nested draw above all — would run once per draw. Fail closed
  // (D6) rather than silently consume extra draws.
  if (!seed.isPure)
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: the seed expression is not pure — the folded ' +
        'seed is spliced at EVERY draw site of the frame, so it would be ' +
        'evaluated once per draw. Use a compile-time constant or a single ' +
        'shader-supplied symbol.'
    );

  // A compile-time constant — a literal, a declared constant such as `Pi`, or
  // an assigned engine value — folds on the HOST with the normative
  // `foldSeed`, so the shader draws the SAME integer stream as the interpreter
  // and the JS target. Read off the EXPRESSION, never off the emitted source:
  // `Pi` emits the truncated `3.14159265359`, which folds to a different f64
  // than `Math.PI`.
  const value = tryGetConstant(seed) ?? tryGetConstant(seed.N());
  if (value !== undefined) {
    const [lo, hi] = foldSeed(value);
    return gpuSeedWords(lo, hi, language);
  }

  const symbol = isSymbol(seed) ? seed.symbol : undefined;
  if (symbol === undefined)
    throw new Error(
      'Could not compile `WithRandomSeed(seed, …)`: a COMPUTED seed expression has no shader form — the folded seed is spliced at every draw ' +
        'site of the frame, so it would be recomputed per draw. Use a ' +
        'compile-time constant seed (host-identical stream) or a single ' +
        'shader-supplied symbol (its own stream).'
    );

  const mapped = target.var(symbol);
  if (mapped !== undefined) {
    if (gpuRandomState(target).varNames?.has(symbol))
      throw new Error(
        `Could not compile \`WithRandomSeed(${symbol}, …)\`: a seed supplied through \`vars\` ` +
          `(\`${symbol}\` → \`${mapped}\`) is the HOST-UNIFORM row of the ` +
          `seed ABI, which is not implemented: the host folds an f64 seed ` +
          `with \`foldSeed\` into TWO words, while a shader can only ` +
          `reinterpret the f32 bits it receives (\`seedHi = 0u\`), so the ` +
          `shader would silently draw a DIFFERENT stream than the host. Use ` +
          `either a compile-time literal seed — the host-identical stream — ` +
          `or an explicitly invocation-varying seed symbol that is NOT in ` +
          `\`vars\`, which owns its own stream.`
      );
    throw new Error(
      `Could not compile \`WithRandomSeed(${symbol}, …)\`: the seed resolves to the shader ` +
        `constant \`${mapped}\`, which the seed ABI cannot fold. Use a ` +
        `compile-time numeric or string seed.`
    );
  }

  // A free symbol: the shader supplies its value (a uniform or varying the
  // caller declares), so there is no host counterpart to agree with and the
  // frame derives its OWN stream from the seed's BITS.
  const src = compile(seed).trim();
  return language === 'wgsl'
    ? `vec2<u32>(bitcast<u32>(${src}), 0u)`
    : `uvec2(floatBitsToUint(${src}), 0u)`;
}

/**
 * Compile a Matrix expression to GPU-native types when possible.
 *
 * Handles two optimizations:
 * - Column vectors (Nx1): flatten to vecN instead of nested single-element arrays
 * - Square matrices (NxN, N=2,3,4): use native matN types with column-major transposition
 *
 * Falls back to compiling the nested List structure for other shapes.
 */
export function compileGPUMatrix(
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  vecFn: (n: number) => string,
  matFn: (n: number) => string,
  arrayFn: (n: number) => string
): string {
  const body = args[0];
  if (!isFunction(body)) return compile(body);

  const rows = body.ops;
  if (rows.length === 0) return compile(body);

  const numRows = rows.length;
  const firstRow = rows[0];
  const numCols = isFunction(firstRow) ? firstRow.nops : 0;

  // Column vector (Nx1): flatten to vecN or array<f32, N>
  if (numCols === 1 && rows.every((row) => isFunction(row) && row.nops === 1)) {
    const elements = rows.map((row) =>
      compile(isFunction(row) ? row.ops[0] : row)
    );
    if (numRows >= 2 && numRows <= 4)
      return `${vecFn(numRows)}(${elements.join(', ')})`;
    return `${arrayFn(numRows)}(${elements.join(', ')})`;
  }

  // Square matrix NxN (N=2,3,4): use native matrix type
  // GPU matrices are column-major, our Matrix is row-major → transpose
  if (
    numRows === numCols &&
    numRows >= 2 &&
    numRows <= 4 &&
    rows.every((row) => isFunction(row) && row.nops === numCols)
  ) {
    const cols: string[] = [];
    for (let c = 0; c < numCols; c++) {
      const colElements = rows.map((row) =>
        compile(isFunction(row) ? row.ops[c] : row)
      );
      cols.push(`${vecFn(numRows)}(${colElements.join(', ')})`);
    }
    return `${matFn(numRows)}(${cols.join(', ')})`;
  }

  // Default: compile the nested list structure as-is
  return compile(body);
}

/**
 * GPU gamma function using Lanczos approximation (g=7, n=9 coefficients).
 *
 * Uses reflection formula for z < 0.5 (with inlined, non-recursive Lanczos)
 * and Lanczos for z >= 0.5. `_gpu_gammaln` is the Stirling asymptotic
 * expansion of ln(Gamma(z)), valid for z > 0. GLSL syntax.
 */
export const GPU_GAMMA_PREAMBLE_GLSL = `
float _gpu_gamma(float z) {
  const float PI = 3.14159265358979;
  // Gamma has a pole at every non-positive integer, and the reflection
  // formula below cannot see it: sin(PI * z) is not exactly 0 there in
  // floating point, so Gamma(-2.0) came back as a large finite number. The
  // interpreter answers the undirected infinity at a pole; its float
  // projection is Infinity (pole-encoding ruling 2026-08-28 — the magnitude
  // survives, the missing direction does not). The lower bound keeps
  // -Infinity out of the guard: it satisfies z == floor(z) but is not a
  // pole, and Gamma(-Infinity) is NaN in the interpreter's numeric lane.
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) return _gpu_inf();
  float w = z;
  if (z < 0.5) w = 1.0 - z;
  w -= 1.0;
  float x = 0.99999999999980993;
  x += 676.5203681218851 / (w + 1.0);
  x += -1259.1392167224028 / (w + 2.0);
  x += 771.32342877765313 / (w + 3.0);
  x += -176.61502916214059 / (w + 4.0);
  x += 12.507343278686905 / (w + 5.0);
  x += -0.13857109526572012 / (w + 6.0);
  x += 9.9843695780195716e-6 / (w + 7.0);
  x += 1.5056327351493116e-7 / (w + 8.0);
  float t = w + 7.5;
  float g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) return PI / (sin(PI * z) * g);
  return g;
}

float _gpu_gammaln(float z) {
  float z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU Gamma function preamble (WGSL syntax). WGSL has no implicit GLSL-style
 * `float`/braceless-`if` syntax, so a `_WGSL` variant is required (the GLSL
 * preamble does not compile as WGSL).
 */
export const GPU_GAMMA_PREAMBLE_WGSL = `
fn _gpu_gamma(z: f32) -> f32 {
  let PI = 3.14159265358979;
  // See the GLSL preamble: a non-positive integer is a pole the reflection
  // formula misses; the pole answers the float projection of the undirected
  // infinity, which is +Infinity (pole-encoding ruling 2026-08-28), from the
  // WGSL _gpu_inf() helper (GPU_INF_PREAMBLE_WGSL). The lower
  // bound keeps -Infinity out of the guard (it is not a pole). (No
  // backticks in this comment: it lives inside a TypeScript template
  // literal, which one would terminate.)
  if (z <= 0.0 && z == floor(z) && z >= -3.4028234663852886e38) { return _gpu_inf(); }
  var w = z;
  if (z < 0.5) { w = 1.0 - z; }
  w = w - 1.0;
  var x = 0.99999999999980993;
  x = x + 676.5203681218851 / (w + 1.0);
  x = x + -1259.1392167224028 / (w + 2.0);
  x = x + 771.32342877765313 / (w + 3.0);
  x = x + -176.61502916214059 / (w + 4.0);
  x = x + 12.507343278686905 / (w + 5.0);
  x = x + -0.13857109526572012 / (w + 6.0);
  x = x + 9.9843695780195716e-6 / (w + 7.0);
  x = x + 1.5056327351493116e-7 / (w + 8.0);
  let t = w + 7.5;
  let g = sqrt(2.0 * PI) * pow(t, w + 0.5) * exp(-t) * x;
  if (z < 0.5) { return PI / (sin(PI * z) * g); }
  return g;
}

fn _gpu_gammaln(z: f32) -> f32 {
  let z3 = z * z * z;
  return z * log(z) - z - 0.5 * log(z)
    + 0.5 * log(2.0 * 3.14159265358979)
    + 1.0 / (12.0 * z)
    - 1.0 / (360.0 * z3)
    + 1.0 / (1260.0 * z3 * z * z);
}
`;

/**
 * GPU Hurwitz/Riemann/generalized zeta, real-valued (f32) — ported from
 * `hurwitzEMComplex` and `hurwitzZetaComplex` in
 * `numerics/numeric-complex.ts`, at im = 0 throughout, with the value
 * conventions of the JavaScript helpers `hurwitzZeta` and `zetaGeneralized`
 * (`numerics/special-functions.ts`). GLSL syntax.
 *
 * - `_gpu_zeta_pow(x, e)` is x^e with a real value: `pow` is undefined for
 *   x < 0 in GLSL and WGSL, so a negative x with an integer e is |x|^e with
 *   the sign (−1)^e, and a negative x with a non-integer e (a complex
 *   value) answers NaN.
 * - `_gpu_hurwitz_zeta_em` is the raw Euler-Maclaurin sum; `_gpu_zeta` and
 *   `_gpu_hurwitz_zeta` add the functional-equation / base-point dispatch
 *   that avoids its cancellation at s < 1/2.
 * - `_gpu_zeta` reflects only for s < 0 and returns NaN below s = −24.5,
 *   where the Lanczos `_gpu_gamma(1 − s)` used to overflow. The reflection
 *   takes 2^s π^(s−1) Γ(1 − s) = 2 Γ(1 − s)/(2π)^(1−s) from the Lanczos
 *   `_gpu_gamma` for 1 − s < 8, and from Stirling's series
 *   (`_gpu_zeta_gamma_2pi`) from 1 − s = 8 on: the pow arguments of the
 *   Lanczos form grow to about 126 at s = −24, and in an f32 model whose
 *   log2 is 2.5 ulp off (a worse GPU than the one measured) ζ(s) was up to
 *   3.3e−5 off near s = −22; with Stirling's series that model is within
 *   4.7e−6 for s <= −7.
 * - `_gpu_riemann_zeta(s, sm1)` is ζ(s) with sm1 = s − 1 given by the
 *   caller. The reflection needs ζ(1 − s) next to its pole when s is near
 *   0, and the rounded 1 − s leaves the pole term a relative error of about
 *   6e−8/|s| (at s = −1e−8, 1 − s rounds to 1, and IEEE f32 arithmetic
 *   gave an infinite result); the exact distance −s is passed instead.
 *   The Taylor series in `_gpu_zeta_near_one` passes the exact distance
 *   the same way. The reflection's sin(πs/2) is reduced by the nearest
 *   integer to s/2 first, since next to an even s the product π·s/2 kept
 *   only an absolute accuracy (up to 0.5 relative error in an f32
 *   simulation at s = −8 ± 1e−6; on an Apple GPU, ζ(−4.0000005) was
 *   −5.7e−9 instead of −3.807e−9). Simulated in f32 against mpmath at the
 *   f32-rounded s, at distances 1e−7 to 0.3 from 0, 1 and each negative
 *   integer down to −12: `_gpu_zeta` is within 5.6e−6 relative (next to
 *   s = 0) and 2.4e−6 elsewhere.
 * - `_gpu_hurwitz_zeta(s, a)` is the pole (+∞) at s = 1 and at a
 *   non-positive integer a with s > 0, 1/2 − a at s = 0, and NaN at a < 0
 *   with a non-integer s, where the true value is complex. For a > 0 it
 *   uses the Euler-Maclaurin sum only where its terms do not cancel: for
 *   s >= 1, for 1/2 <= s < 1 with a >= 1, and for s < 1/2 with
 *   a >= 4·max(12, ⌈|s|⌉ + 6) (as `hurwitzZetaComplex` does). Elsewhere
 *   (`_gpu_zeta_shifted`, for s >= −24.5) it moves a to the base point
 *   b = a − ⌈a⌉ + 1 in (0, 1], subtracts the terms (b + j)^(−s) passed
 *   over, and takes ζ(s, b) from Hurwitz's formula, the Fourier series in
 *   b, for s <= −3 (`_gpu_zeta_fourier`, 64 terms that fall like k^(s−1)),
 *   from Hermite's integral for −3 < s < 1 (`_gpu_zeta_hermite`), or, for
 *   b < 2^−10, from b^(−s) + ζ(s, 1 + b) with the Taylor series in b. The
 *   Euler-Maclaurin sum had cancelled there: ζ(1/2, 0.3) = 0.011 was
 *   2.3e−5 off on the GPU, ζ(−23, 1/4) = −2.2e−4 answered 0.016, and 795
 *   (GLSL) and 817 (WGSL) of the 18361 points below were more than 1.5e−5
 *   off, all without a NaN. Each of the three methods returns an error
 *   estimate (in units of the f32 rounding error, the rounding of each pow,
 *   exp, log and sine argument, and the cancellation between the terms),
 *   and `_gpu_zeta_shifted` answers NaN
 *   when the estimate exceeds 3e−5 of the value: next to a zero of
 *   ζ(s, a), where the value is small against the terms. Measured on an
 *   Apple M5 Max GPU (WebGL2 through ANGLE Metal, and WebGPU; the two agree
 *   within 5.5e−6) against mpmath at the f32-rounded operands, on 18361
 *   points (317 values of s from −24.5 to 12: the integers, the
 *   half-integers, the points 1e−6, 1e−4 and 1e−2 from each integer from
 *   −24 to 1, and 80 random values; 58 values of a from 0.01 to 30): every
 *   value that is not NaN is within 1e−5 relative (worst 8.1e−6), and 432
 *   are NaN, 387 of them where a half-ulp change of s or a alone moves the
 *   value by more than 1e−5. The f32 model of this text
 *   (`test/compute-engine/gpu-lerch-f32-model.ts`) gives the same counts
 *   and the same NaN (worst 6.6e−6); with its log2 2.5 ulp off, 17 values
 *   with a > 16 and s < −21 are up to 1.7e−5 off (the pow of the
 *   passed-over terms has an argument near 100).
 * - `_gpu_zeta_generalized(s, a)` is Wolfram's `Zeta[s, a]`: the terms with
 *   k + a < 0 are |k + a|^(−s), the (k + a) = 0 term is dropped, so it is
 *   real for every real s and a and its only pole is s = 1.
 *
 * Both base-point walks cost one term per unit of |a|, so a < −10⁶ answers
 * NaN instead of looping for that long. For a > 0, `_gpu_zeta_shifted`
 * costs at most 123 passed-over terms (a < 124) plus 64 Fourier terms, or
 * at most 17 Hermite panels of 8 nodes (136 nodes, each with an exp, two
 * logs, an atan and a sine), or the Taylor series of `_gpu_zeta_near_one`
 * (up to 100 terms, a few for b < 2^−10).
 */
export const GPU_ZETA_PREAMBLE_GLSL = `
float _gpu_zeta_pow(float x, float e) {
  if (x >= 0.0) return pow(x, e);
  if (e != floor(e)) return _gpu_nan();
  float r = pow(-x, e);
  if (mod(abs(e), 2.0) == 1.0) return -r;
  return r;
}

float _gpu_hurwitz_zeta_em(float s, float a, float sm1) {
  int n = int(ceil(15.0 - a));
  if (n < 0) n = 0;
  float sum = 0.0;
  float z = a;
  for (int k = 0; k < n; k++) {
    sum += _gpu_zeta_pow(z, -s);
    z += 1.0;
  }
  // Tail: closed-form integral + half-term (DLMF 25.11.9). The integral
  // term is the pole at s = 1: it uses sm1 = s - 1 as the caller knows it.
  sum += pow(z, -sm1) / sm1 + 0.5 * pow(z, -s);
  // Bernoulli correction series, same ten B_2j as BERNOULLI_2K
  // (special-functions.ts); u carries the term divided by B_2j.
  float b[10] = float[10](
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  float u = (s / 2.0) * pow(z, -(s + 1.0));
  float prevAbs = 3.0e38;
  for (int j = 1; j <= 10; j++) {
    float term = u * b[j - 1];
    if (abs(term) >= prevAbs) break;
    sum += term;
    prevAbs = abs(term);
    float m = float(2 * j);
    u = u * (s + m - 1.0) * (s + m) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  return sum;
}

// Gamma(x) / (2 pi)^x for x >= 1, as vec2(value, error estimate in units of
// the f32 rounding error 6e-8). Stirling's series after a shift to y >= 8:
// (y/(2 pi e))^y sqrt(2 pi/y) e^corr, divided by x (x+1) ... (y-1) and
// multiplied by (2 pi)^(y-x). Neither Gamma(x) nor (2 pi)^x is formed (they
// overflow f32 near x = 35 and x = 48), and the largest pow argument is
// about y log2(y/(2 pi e)), 15 at x = 25.5, where the Lanczos _gpu_gamma
// calls pow with an argument of about 126.
vec2 _gpu_zeta_gamma_2pi(float x) {
  const float PI = 3.14159265358979;
  float p = 1.0;
  float y = x;
  for (int k = 0; k < 8; k++) {
    if (y >= 8.0) break;
    p *= y;
    y += 1.0;
  }
  float y2 = y * y;
  float corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * y2)) / y2) / y;
  float base = y / 17.079468445347132; // y / (2 pi e)
  float v = pow(base, y) * sqrt(2.0 * PI / y) * (exp(corr) / p) *
    pow(2.0 * PI, y - x);
  return vec2(v, abs(v) * (12.0 + abs(y * log2(base)) + y));
}

// zeta(s), with sm1 = s - 1 passed by a caller that knows it more exactly
// than s - 1.0 can recover it from a rounded s.
float _gpu_riemann_zeta(float s, float sm1) {
  const float PI = 3.14159265358979;
  if (sm1 == 0.0) return _gpu_inf(); // pole
  if (s == 0.0) return -0.5;
  if (s < 0.0) {
    if (s == floor(s) && mod(s, 2.0) == 0.0) return 0.0; // trivial zero
    if (s < -24.5) return _gpu_nan(); // f32 _gpu_gamma(1 - s) overflows
    // sin(PI s/2) = (-1)^n sin(PI (s/2 - n)): s/2 - n is exact, so the
    // sine keeps its relative accuracy next to an even s.
    float hs = s / 2.0;
    float n = floor(hs + 0.5);
    float sinHalfPiS = sin(PI * (hs - n));
    if (mod(n, 2.0) != 0.0) sinHalfPiS = -sinHalfPiS;
    // 1 - s is rounded, but its distance to the pole, -s, is exact.
    float oneMinusS = 1.0 - s;
    // 2^s pi^(s-1) Gamma(1-s) = 2 Gamma(1-s)/(2 pi)^(1-s). From 1 - s = 8
    // on, from Stirling's series: with the Lanczos Gamma, zeta(s) was up to
    // 3.3e-5 off near s = -22 in an f32 model whose log2 is 2.5 ulp off.
    if (oneMinusS >= 8.0)
      return 2.0 * _gpu_zeta_gamma_2pi(oneMinusS).x * sinHalfPiS *
        _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
    return pow(2.0, s) * pow(PI, s - 1.0) * sinHalfPiS *
      _gpu_gamma(oneMinusS) * _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
  }
  return _gpu_hurwitz_zeta_em(s, 1.0, sm1);
}

float _gpu_zeta(float s) {
  return _gpu_riemann_zeta(s, s - 1.0);
}

// zeta(s, 1+h) = sum C(-s,k) h^k zeta(s+k), |h| < 1 — no cancellation,
// since each zeta(s+k) reflects to Re >= 0. See zetaNearOneComplex. The
// stop tolerance is near the f32 epsilon (1.2e-7), and 100 terms reach it
// for every s >= -24.5 (below that _gpu_zeta is NaN).
float _gpu_zeta_near_one(float s, float h) {
  float sum = _gpu_zeta(s);
  float c = 1.0;
  float hk = 1.0;
  float largest = abs(sum);
  int small = 0;
  for (int k = 1; k < 100; k++) {
    hk *= h;
    if (hk == 0.0) break;
    // f = 1 - k - s is exact when s is near 1 - k, and s + k - 1 = -f is
    // then the exact distance from s + k to the pole of zeta.
    float f = float(1 - k) - s;
    if (f == 0.0) return sum + c * hk * (-1.0 / float(k));
    c = c * f / float(k);
    float term = c * hk * _gpu_riemann_zeta(s + float(k), -f);
    sum += term;
    float size = abs(term);
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      if (++small == 2) break;
    } else small = 0;
  }
  return sum;
}

// 1 - e^(-y) for y >= 0, without the cancellation of 1.0 - exp(-y) at a
// small y (a Taylor polynomial below y = 0.25).
float _gpu_zeta_em1(float y) {
  if (y < 0.25) {
    float r = 1.0 - y / 7.0;
    r = 1.0 - y / 6.0 * r;
    r = 1.0 - y / 5.0 * r;
    r = 1.0 - y / 4.0 * r;
    r = 1.0 - y / 3.0 * r;
    r = 1.0 - y / 2.0 * r;
    return y * r;
  }
  return 1.0 - exp(-y);
}

// zeta(s, b) for 0 < b <= 1 and s < 1 by Hermite's integral (DLMF
// 25.11.29): b^(-s)/2 + b^(1-s)/(s-1) plus
// 2 int_0^inf sin(s atan(t/b)) (b^2 + t^2)^(-s/2) / (e^(2 pi t) - 1) dt.
// The two closed terms are one product, b^(-s) (s - 1 + 2b) / (2 (s - 1)):
// 2b - 1 is exact for b >= 1/4, so the factor s + (2b - 1) has a single
// rounding, relative to itself, where the two terms cancel (at s = 1/2,
// b = 0.3 they are 0.91 and -1.10 and the value is 0.011). The integrand is formed
// in one exp, so that a large -s does not overflow before e^(-2 pi t)
// applies. 8-point Gauss-Legendre panels, b/2 wide from t = 0 and doubling
// up to 1 wide (the integrand varies on the scale b next to t = 0, and has
// poles at t = +-i), until the panel mean is below 1e-9 of the largest one
// past the peak of the envelope at t = -s/(2 pi). Returns vec2(value, error
// estimate in units of the f32 rounding error 6e-8): the rounding of the
// closed product and, for each node, of its exp argument, of the log of
// b^2 + t^2 (times s/2), and of the sine argument s atan(t/b). vec2(0,
// 3e38) when 40 panels do not reach the stopping test (b >= 2^-10 takes
// at most 17 on s from -3 to 1).
vec2 _gpu_zeta_hermite(float s, float b) {
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  float k = pow(b, -s) / (2.0 * (s - 1.0));
  // max() keeps a fast-math compiler from reassociating the sum into
  // (s + 2b) - 1, which loses s next to s = 0 (6.7% off at s = -1e-6,
  // b = 1/2 on an Apple GPU, where 2b - 1 = 0).
  float c = s + max(2.0 * b - 1.0, -1.0);
  float closed = k * c;
  float err = abs(k) * (abs(c) + (b < 0.25 ? 1.0 : 0.0)) +
    abs(closed) * (4.0 + abs(s * log2(b)));
  float b2 = b * b;
  float tPeak = max(0.0, -s / (2.0 * PI));
  float sum = 0.0;
  float largest = 0.0;
  float x = 0.0;
  bool done = false;
  for (int p = 0; p < 40; p++) {
    float w = x == 0.0 ? 0.5 * b : min(x, 1.0);
    float cc = x + 0.5 * w;
    float r = 0.5 * w;
    float size = 0.0;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float t = cc + (j == 0 ? -r : r) * gx[i];
        float y = 2.0 * PI * t;
        float lr = log(b2 + t * t);
        float ex = -0.5 * s * lr - y - log(_gpu_zeta_em1(y));
        float th = s * atan(t / b);
        float q = r * gw[i] * exp(ex);
        float f = q * sin(th);
        sum += f;
        size += abs(f);
        err += 2.0 * (abs(f) * (6.0 + abs(ex) + 0.5 * abs(s) * (2.0 + abs(lr))) +
          q * abs(th));
      }
    }
    x += w;
    float mean = size / w;
    largest = max(largest, mean);
    if (x > tPeak && x >= 1.0 && mean <= 1e-9 * largest) {
      done = true;
      break;
    }
  }
  if (!done) return vec2(0.0, 3.0e38);
  float v = closed + 2.0 * sum;
  return vec2(v, err + 2.0 * abs(v));
}

// zeta(s, b) for s <= -3 and 0 < b <= 1 by Hurwitz's formula, the Fourier
// series in the base point:
// 2 Gamma(1-s)/(2 pi)^(1-s) sum_k sin(2 pi k b + pi s/2) / k^(1-s). Its
// terms fall like k^(s-1) and do not cancel; 64 of them leave a tail below
// 64^s/(-s) of the prefactor, 1.3e-6 at s = -3. The sine argument is
// reduced exactly: pi (2 frac(k b) + (s/2 mod 2)), minus its nearest
// integer n, with the sign (-1)^n. Returns vec2(value, error estimate in
// units of 6e-8): the pow roundings, the rounding of the argument (about
// 20 k units of each term's size), the tail and the prefactor.
vec2 _gpu_zeta_fourier(float s, float b) {
  const float PI = 3.14159265358979;
  vec2 g = _gpu_zeta_gamma_2pi(1.0 - s);
  float hs = s / 2.0;
  float ps = hs - 2.0 * floor(hs / 2.0);
  float sum = 0.0;
  float err = 0.0;
  for (int k = 1; k <= 64; k++) {
    float fk = float(k);
    float kb = fk * b;
    float ph = 2.0 * (kb - floor(kb)) + ps;
    float n = floor(ph + 0.5);
    float sn = sin(PI * (ph - n));
    if (mod(n, 2.0) != 0.0) sn = -sn;
    float pk = pow(fk, s - 1.0);
    float t = sn * pk;
    sum += t;
    err += abs(t) * (4.0 + abs((s - 1.0) * log2(fk))) + pk * (fk * 20.0);
  }
  float tail = pow(64.0, s) / (-s);
  return vec2(2.0 * g.x * sum,
    2.0 * g.x * (err + tail / 6.0e-8 + 2.0 * abs(sum)) + 2.0 * g.y * abs(sum));
}

// zeta(s, a) for a > 0 and -24.5 <= s < 1 from the base point b = a - m in
// (0, 1]: zeta(s, a) = zeta(s, b) - sum_{j<m} (b + j)^(-s). zeta(s, b) is
// the Fourier series for s <= -3, the Taylor series in b for b < 2^-10
// (zeta(s, b) = b^(-s) + zeta(s, 1 + b), where Hermite's integral would
// need more panels), and Hermite's integral otherwise. NaN when the error
// estimate exceeds 3e-5 of the value (next to a zero of zeta(s, a)).
float _gpu_zeta_shifted(float s, float a) {
  float m = ceil(a) - 1.0;
  float b = a - m;
  vec2 r;
  if (s <= -3.0) r = _gpu_zeta_fourier(s, b);
  else if (b < 0.0009765625) {
    float t = pow(b, -s);
    float zn = _gpu_zeta_near_one(s, b);
    r = vec2(zn + t, 64.0 * abs(zn) + abs(t) * (3.0 + abs(s * log2(b))));
  } else r = _gpu_zeta_hermite(s, b);
  float z = r.x;
  float err = r.y;
  // m <= 123: the caller keeps a below 4 * edge <= 124.
  for (int j = 0; j < 128; j++) {
    if (float(j) >= m) break;
    float br = b + float(j);
    float t = pow(br, -s);
    z -= t;
    err += abs(t) * (3.0 + float(j) + abs(s * log2(br)));
  }
  err += abs(z) * (m + 2.0);
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) return _gpu_nan();
  return z;
}

float _gpu_hurwitz_zeta(float s, float a) {
  if (s == 1.0) return _gpu_inf(); // pole, every base point a
  if (s == 0.0) return 0.5 - a;
  if (a == 1.0) return _gpu_zeta(s);
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return _gpu_inf(); // (a+k) = 0 term diverges
  if (a < 0.0 && s != floor(s)) return _gpu_nan(); // complex value
  if (a < -1.0e6) return _gpu_nan();
  float edge = max(12.0, ceil(abs(s)) + 6.0);
  // Where the Euler-Maclaurin terms cancel: s < 1/2 short of a = 4 * edge,
  // and 1/2 <= s < 1 below a = 1 (the zeros of zeta(s, a) there).
  if (a > 0.0 && s >= -24.5 && s < 1.0 && (s < 0.5 ? a < 4.0 * edge : a < 1.0))
    return _gpu_zeta_shifted(s, a);
  if (s >= 0.0 || a >= 4.0 * edge) return _gpu_hurwitz_zeta_em(s, a, s - 1.0);
  // Shift a to 1+h (|h| <= 3/4) and expand in Taylor series — see
  // hurwitzZetaComplex's doc comment for why EM alone cancels here.
  float m = floor(a - 0.5);
  float h = a - m - 1.0;
  if (abs(h) > 0.75) return _gpu_hurwitz_zeta_em(s, a, s - 1.0);
  float z = _gpu_zeta_near_one(s, h);
  int steps = int(abs(m));
  for (int j = 0; j < steps; j++) {
    float br = m > 0.0 ? h + 1.0 + float(j) : a + float(j);
    if (br == 0.0) continue;
    float t = _gpu_zeta_pow(br, -s);
    z = m > 0.0 ? z - t : z + t;
  }
  return z;
}

float _gpu_zeta_generalized(float s, float a) {
  if (s == 1.0) return _gpu_inf(); // pole, every base point a
  if (a > 0.0) return _gpu_hurwitz_zeta(s, a);
  if (a == 0.0) return _gpu_zeta(s);
  if (a < -1.0e6) return _gpu_nan();
  int n = int(ceil(-a));
  float sum = 0.0;
  for (int k = 0; k < n; k++) sum += pow(-(a + float(k)), -s);
  float cur = a + float(n);
  if (cur == 0.0) cur = 1.0; // drop the (k + a) = 0 term
  return sum + _gpu_hurwitz_zeta(s, cur);
}
`;

/**
 * GPU Hurwitz/Riemann/generalized zeta functions (WGSL syntax). See
 * `GPU_ZETA_PREAMBLE_GLSL`; WGSL has no implicit GLSL-style `float`/
 * braceless-`if` syntax, so a separate variant is required. The pole and NaN
 * come from the WGSL `_gpu_inf()` / `_gpu_nan()` helpers
 * (`GPU_NAN_PREAMBLE_WGSL`).
 */
export const GPU_ZETA_PREAMBLE_WGSL = `
fn _gpu_zeta_pow(x: f32, e: f32) -> f32 {
  if (x >= 0.0) { return pow(x, e); }
  if (e != floor(e)) { return _gpu_nan(); }
  let r = pow(-x, e);
  if ((abs(e) % 2.0) == 1.0) { return -r; }
  return r;
}

fn _gpu_hurwitz_zeta_em(s: f32, a: f32, sm1: f32) -> f32 {
  var n: i32 = i32(ceil(15.0 - a));
  if (n < 0) { n = 0; }
  var sum: f32 = 0.0;
  var z: f32 = a;
  for (var k: i32 = 0; k < n; k = k + 1) {
    sum = sum + _gpu_zeta_pow(z, -s);
    z = z + 1.0;
  }
  // The integral term is the pole at s = 1: it uses sm1 = s - 1 as the
  // caller knows it.
  sum = sum + pow(z, -sm1) / sm1 + 0.5 * pow(z, -s);
  let b = array<f32, 10>(
    1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0, 5.0 / 66.0,
    -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0, 43867.0 / 798.0,
    -174611.0 / 330.0
  );
  var u: f32 = (s / 2.0) * pow(z, -(s + 1.0));
  var prevAbs: f32 = 3.0e38;
  for (var j: i32 = 1; j <= 10; j = j + 1) {
    let term = u * b[j - 1];
    if (abs(term) >= prevAbs) { break; }
    sum = sum + term;
    prevAbs = abs(term);
    let m = f32(2 * j);
    u = u * (s + m - 1.0) * (s + m) / ((m + 1.0) * (m + 2.0) * z * z);
  }
  return sum;
}

// Gamma(x) / (2 pi)^x for x >= 1, with an error estimate, from Stirling's
// series — see GLSL's _gpu_zeta_gamma_2pi.
fn _gpu_zeta_gamma_2pi(x: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  var p: f32 = 1.0;
  var y: f32 = x;
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (y >= 8.0) { break; }
    p = p * y;
    y = y + 1.0;
  }
  let y2 = y * y;
  let corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * y2)) / y2) / y;
  let base = y / 17.079468445347132; // y / (2 pi e)
  let v = pow(base, y) * sqrt(2.0 * PI / y) * (exp(corr) / p) *
    pow(2.0 * PI, y - x);
  return vec2<f32>(v, abs(v) * (12.0 + abs(y * log2(base)) + y));
}

// zeta(s), with sm1 = s - 1 — see GLSL's _gpu_riemann_zeta.
fn _gpu_riemann_zeta(s: f32, sm1: f32) -> f32 {
  let PI = 3.14159265358979;
  if (sm1 == 0.0) { return _gpu_inf(); } // pole
  if (s == 0.0) { return -0.5; }
  if (s < 0.0) {
    if (s == floor(s) && (s % 2.0) == 0.0) { return 0.0; } // trivial zero
    if (s < -24.5) { return _gpu_nan(); } // f32 gamma overflows
    // sin(PI s/2) = (-1)^n sin(PI (s/2 - n)), with s/2 - n exact.
    let hs = s / 2.0;
    let n = floor(hs + 0.5);
    var sinHalfPiS = sin(PI * (hs - n));
    if ((n % 2.0) != 0.0) { sinHalfPiS = -sinHalfPiS; }
    // 1 - s is rounded, but its distance to the pole, -s, is exact.
    let oneMinusS = 1.0 - s;
    // 2 Gamma(1-s)/(2 pi)^(1-s) from Stirling's series from 1 - s = 8 on.
    if (oneMinusS >= 8.0) {
      return 2.0 * _gpu_zeta_gamma_2pi(oneMinusS).x * sinHalfPiS *
        _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
    }
    return pow(2.0, s) * pow(PI, s - 1.0) * sinHalfPiS *
      _gpu_gamma(oneMinusS) * _gpu_hurwitz_zeta_em(oneMinusS, 1.0, -s);
  }
  return _gpu_hurwitz_zeta_em(s, 1.0, sm1);
}

fn _gpu_zeta(s: f32) -> f32 {
  return _gpu_riemann_zeta(s, s - 1.0);
}

// zeta(s, 1+h) = sum C(-s,k) h^k zeta(s+k) — see GLSL's _gpu_zeta_near_one.
fn _gpu_zeta_near_one(s: f32, h: f32) -> f32 {
  var sum = _gpu_zeta(s);
  var c = 1.0;
  var hk = 1.0;
  var largest = abs(sum);
  var small = 0;
  for (var k = 1; k < 100; k = k + 1) {
    hk = hk * h;
    if (hk == 0.0) { break; }
    // f = 1 - k - s, exact when s is near 1 - k (see the GLSL version).
    let f = f32(1 - k) - s;
    if (f == 0.0) { return sum + c * hk * (-1.0 / f32(k)); }
    c = c * f / f32(k);
    let term = c * hk * _gpu_riemann_zeta(s + f32(k), -f);
    sum = sum + term;
    let size = abs(term);
    largest = max(largest, size);
    if (size <= 1e-7 * largest) {
      small = small + 1;
      if (small == 2) { break; }
    } else { small = 0; }
  }
  return sum;
}

// 1 - e^(-y) for y >= 0 — see GLSL's _gpu_zeta_em1.
fn _gpu_zeta_em1(y: f32) -> f32 {
  if (y < 0.25) {
    var r = 1.0 - y / 7.0;
    r = 1.0 - y / 6.0 * r;
    r = 1.0 - y / 5.0 * r;
    r = 1.0 - y / 4.0 * r;
    r = 1.0 - y / 3.0 * r;
    r = 1.0 - y / 2.0 * r;
    return y * r;
  }
  return 1.0 - exp(-y);
}

// zeta(s, b) for 0 < b <= 1 and s < 1 by Hermite's integral, as
// vec2(value, error estimate) — see GLSL's _gpu_zeta_hermite.
fn _gpu_zeta_hermite(s: f32, b: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  let k = pow(b, -s) / (2.0 * (s - 1.0));
  // max() blocks a fast-math reassociation — see the GLSL version.
  let c = s + max(2.0 * b - 1.0, -1.0);
  let closed = k * c;
  var lowB: f32 = 0.0;
  if (b < 0.25) { lowB = 1.0; }
  var err = abs(k) * (abs(c) + lowB) + abs(closed) * (4.0 + abs(s * log2(b)));
  let b2 = b * b;
  let tPeak = max(0.0, -s / (2.0 * PI));
  var sum: f32 = 0.0;
  var largest: f32 = 0.0;
  var x: f32 = 0.0;
  var done = false;
  for (var p: i32 = 0; p < 40; p = p + 1) {
    var w: f32 = min(x, 1.0);
    if (x == 0.0) { w = 0.5 * b; }
    let cc = x + 0.5 * w;
    let r = 0.5 * w;
    var size: f32 = 0.0;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        var d = r;
        if (j == 0) { d = -r; }
        let t = cc + d * gx[i];
        let y = 2.0 * PI * t;
        let lr = log(b2 + t * t);
        let ex = -0.5 * s * lr - y - log(_gpu_zeta_em1(y));
        let th = s * atan(t / b);
        let q = r * gw[i] * exp(ex);
        let f = q * sin(th);
        sum = sum + f;
        size = size + abs(f);
        err = err + 2.0 * (abs(f) * (6.0 + abs(ex) + 0.5 * abs(s) * (2.0 + abs(lr))) +
          q * abs(th));
      }
    }
    x = x + w;
    let mean = size / w;
    largest = max(largest, mean);
    if (x > tPeak && x >= 1.0 && mean <= 1e-9 * largest) {
      done = true;
      break;
    }
  }
  if (!done) { return vec2<f32>(0.0, 3.0e38); }
  let v = closed + 2.0 * sum;
  return vec2<f32>(v, err + 2.0 * abs(v));
}

// zeta(s, b) for s <= -3 and 0 < b <= 1 by Hurwitz's formula, as
// vec2(value, error estimate) — see GLSL's _gpu_zeta_fourier.
fn _gpu_zeta_fourier(s: f32, b: f32) -> vec2<f32> {
  let PI = 3.14159265358979;
  let g = _gpu_zeta_gamma_2pi(1.0 - s);
  let hs = s / 2.0;
  let ps = hs - 2.0 * floor(hs / 2.0);
  var sum: f32 = 0.0;
  var err: f32 = 0.0;
  for (var k: i32 = 1; k <= 64; k = k + 1) {
    let fk = f32(k);
    let kb = fk * b;
    let ph = 2.0 * (kb - floor(kb)) + ps;
    let n = floor(ph + 0.5);
    var sn = sin(PI * (ph - n));
    if ((n % 2.0) != 0.0) { sn = -sn; }
    let pk = pow(fk, s - 1.0);
    let t = sn * pk;
    sum = sum + t;
    err = err + abs(t) * (4.0 + abs((s - 1.0) * log2(fk))) + pk * (fk * 20.0);
  }
  let tail = pow(64.0, s) / (-s);
  return vec2<f32>(2.0 * g.x * sum,
    2.0 * g.x * (err + tail / 6.0e-8 + 2.0 * abs(sum)) + 2.0 * g.y * abs(sum));
}

// zeta(s, a) for a > 0 and -24.5 <= s < 1 from the base point b = a - m
// in (0, 1] — see GLSL's _gpu_zeta_shifted.
fn _gpu_zeta_shifted(s: f32, a: f32) -> f32 {
  let m = ceil(a) - 1.0;
  let b = a - m;
  var r: vec2<f32>;
  if (s <= -3.0) {
    r = _gpu_zeta_fourier(s, b);
  } else if (b < 0.0009765625) {
    let t = pow(b, -s);
    let zn = _gpu_zeta_near_one(s, b);
    r = vec2<f32>(zn + t, 64.0 * abs(zn) + abs(t) * (3.0 + abs(s * log2(b))));
  } else {
    r = _gpu_zeta_hermite(s, b);
  }
  var z = r.x;
  var err = r.y;
  // m <= 123: the caller keeps a below 4 * edge <= 124.
  for (var j: i32 = 0; j < 128; j = j + 1) {
    if (f32(j) >= m) { break; }
    let br = b + f32(j);
    let t = pow(br, -s);
    z = z - t;
    err = err + abs(t) * (3.0 + f32(j) + abs(s * log2(br)));
  }
  err = err + abs(z) * (m + 2.0);
  if (!(6.0e-8 * err <= 3.0e-5 * abs(z))) { return _gpu_nan(); }
  return z;
}

fn _gpu_hurwitz_zeta(s: f32, a: f32) -> f32 {
  if (s == 1.0) { return _gpu_inf(); } // pole, every base point a
  if (s == 0.0) { return 0.5 - a; }
  if (a == 1.0) { return _gpu_zeta(s); }
  let aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) { return _gpu_inf(); } // (a+k) = 0 diverges
  if (a < 0.0 && s != floor(s)) { return _gpu_nan(); } // complex value
  if (a < -1.0e6) { return _gpu_nan(); }
  let edge = max(12.0, ceil(abs(s)) + 6.0);
  // Where the Euler-Maclaurin terms cancel — see the GLSL version.
  var shifted = false;
  if (s < 0.5) { shifted = a < 4.0 * edge; } else { shifted = a < 1.0; }
  if (a > 0.0 && s >= -24.5 && s < 1.0 && shifted) { return _gpu_zeta_shifted(s, a); }
  if (s >= 0.0 || a >= 4.0 * edge) { return _gpu_hurwitz_zeta_em(s, a, s - 1.0); }
  // Shift a to 1+h (|h| <= 3/4) and expand in Taylor series — see
  // hurwitzZetaComplex's doc comment for why EM alone cancels here.
  let m = floor(a - 0.5);
  let h = a - m - 1.0;
  if (abs(h) > 0.75) { return _gpu_hurwitz_zeta_em(s, a, s - 1.0); }
  var z = _gpu_zeta_near_one(s, h);
  let steps = i32(abs(m));
  for (var j = 0; j < steps; j = j + 1) {
    var br: f32;
    if (m > 0.0) { br = h + 1.0 + f32(j); } else { br = a + f32(j); }
    if (br == 0.0) { continue; }
    let t = _gpu_zeta_pow(br, -s);
    if (m > 0.0) { z = z - t; } else { z = z + t; }
  }
  return z;
}

fn _gpu_zeta_generalized(s: f32, a: f32) -> f32 {
  if (s == 1.0) { return _gpu_inf(); } // pole, every base point a
  if (a > 0.0) { return _gpu_hurwitz_zeta(s, a); }
  if (a == 0.0) { return _gpu_zeta(s); }
  if (a < -1.0e6) { return _gpu_nan(); }
  let n = i32(ceil(-a));
  var sum: f32 = 0.0;
  for (var k: i32 = 0; k < n; k = k + 1) { sum = sum + pow(-(a + f32(k)), -s); }
  var cur = a + f32(n);
  if (cur == 0.0) { cur = 1.0; } // drop the (k + a) = 0 term
  return sum + _gpu_hurwitz_zeta(s, cur);
}
`;

/**
 * GPU Lerch transcendent Φ(z,s,a) = Σ zᵏ(k+a)^(−s) and polylogarithm
 * Liₛ(z) = z·Φ(z,s,1), for real operands, real-valued (f32). GLSL syntax.
 *
 * `_gpu_lerch_phi` answers NaN where the value is complex: a real z > 1 is on
 * the branch cut (unless s is a non-positive integer, where Φ is a rational
 * function of z and has no cut), and a < 0 with a non-integer s has complex
 * terms. It also answers NaN where no method below can vouch for its value.
 * The helpers behind it return vec2(value, 1), or vec2(0, 0) to decline, so
 * that the dispatcher (`_gpu_lerch_core`) can try the next method: a NaN
 * test (isnan, or x != x) is not reliable under the drivers' fast-math.
 *
 * The methods, in the order `_gpu_lerch_core` tries them:
 * - z = 1 is the Hurwitz zeta ζ(s,a); z = 0 keeps only the k = 0 term;
 *   s = 0 is 1/(1 − z).
 * - A non-positive integer s = −n, n <= `LERCH_MAX_N`:
 *   `_gpu_lerch_rational`, the rational function Φ(z,−n,a) = P_n(z)/(1−z)^(n+1),
 *   for every z and every a, summed in u = z/(1 − z) and v = 1/(1 − z) (both
 *   at most 1 in size below z = −1), where the old closed forms for s = −1
 *   and −2 cancelled (2.9e−5 at Φ(−95.07, −2, 1.098)).
 * - `_gpu_lerch_series`, the direct sum, for real |z| < 1 (and for z < 0
 *   with s < 0, where the Euler transform is not valid). The terms with
 *   a + k <= 0 are summed first, without a convergence test, since they need
 *   not decrease. After them the sum stops when three consecutive terms each
 *   shrink and bound the tail below 1e−7 of the sum: the bound is
 *   |term|·ρ/(1−ρ), where ρ, the larger of the current term ratio and |z|,
 *   bounds every later ratio. It declines when 4096 terms past the prefix
 *   do not reach that (|z| above about 0.995 for s near 0, closer to 1 when
 *   s is larger), or when its error estimate exceeds 3e−5 of the sum: the
 *   terms weighted by the roundings of zᵏ and of pow(a + k, −s), whose GPU
 *   error grows with |s·log2(a + k)|. (A cap of 100 on the ratio of the
 *   largest term to the sum let 5.6e−4 through at Φ(−0.645, −10, 8.99).)
 *   It also declines when |sum|·(1 − |z|) < 2^24 · 1.2e−38: a GPU flushes a
 *   term below the smallest normal f32 (1.2e−38) to zero, and the flushed
 *   tail, at most 1.2e−38/(1 − |z|), must stay below 2^−24 of the sum
 *   (0.72% was lost at Φ(0.5, 12, 1000) ≈ 1.98e−36 without this test).
 * - `_gpu_lerch_euler`, the van Wijngaarden Euler transform (Numerical
 *   Recipes' `eulsum`), for −1 <= z < 0 and s > 0: direct summation there is
 *   only conditionally convergent and stalls approaching the rim. The terms
 *   with a + k <= 0 are summed first, as in the series. It stops when three
 *   consecutive increments are below 1e−7 of the sum, and declines when the
 *   `LERCH_EULER_TERMS` budget runs out first (GLSL/WGSL arrays need a
 *   compile-time size) or when the sum is below 1/100 of its largest term.
 *   It also declines when the transformed sum is below 2^24 · 1.2e−38, so
 *   that the terms the stopping rule reads (down to 1e−7 of the sum) are
 *   normal f32 values that a GPU does not flush to zero.
 * - `_gpu_lerch_integral`, for s > 0 below z = −1 and where the series or
 *   the transform declines: Φ = (1/Γ(s)) ∫₀^∞ t^(s−1) e^(−at) / (1 − z e^(−t)) dt,
 *   whose integrand is positive for every z < 1. For a non-integer s < 0
 *   (`_gpu_lerch_negative`, below z = −1, at z = −1 and where the series
 *   declines) the same integral after n = ⌈−s⌉ integrations by parts, with
 *   Φ(z e^(−t), −n, a) in the integrand; that integrand changes sign for
 *   z < 0 and the error estimate measures the cancellation. 8-point
 *   Gauss-Legendre panels that follow the step of the integrand at
 *   t = ln|z|, so the whole f32 range (|z| up to 3.4e38) takes at most 22
 *   of the 28 panels allowed.
 * - `_gpu_lerch_hermite`, where the integral declines for s <= 0, and for
 *   z > 1 with an integer s where the rational form declines: the
 *   Hermite-type representation (mpmath's), with the upper incomplete gamma
 *   at the complex argument −a·log z computed in f32 (series, continued
 *   fraction, or the closed form for an integer s) and an integral of at
 *   most 16 panels. Its terms cancel as |z| grows.
 * - PolyLog below z = −1 with a negative non-integer order, where those
 *   decline: Jonquière's inversion formula (`_gpu_poly_log_inversion`).
 * - Last, for z < 0 and −30 <= s <= −3, where every method above declines
 *   (in `_gpu_lerch_phi` and `_gpu_poly_log`, so that no value they answer
 *   changes): the sum over the Fourier modes of the base point
 *   (`_gpu_lerch_modes`, the form of `lerchModesComplex` in
 *   `numerics/lerch-phi.ts`). With b = a moved into (0, 1] and L = ln|z|,
 *   Φ(z,s,b) = 2Γ(1−s)e^(−bL) Σ_{m odd} (L² + π²m²)^((s−1)/2)
 *   cos(π(bm + (s−1)(1/2 + atan(L/(πm))/π))). The terms fall like m^(s−1)
 *   and do not cancel, where the Hermite form's terms cancel next to and
 *   below z = −1: Φ(−1, −6.5, 1.3) = 0.10992 was NaN. For PolyLog the
 *   factor z of Liₛ(z) = z·Φ(z,s,1) goes into the exponent of the scale,
 *   so that Liₛ(z) does not pass through Φ, which falls below the smallest
 *   normal f32 before Liₛ(z) does.
 *
 * The integral, rational, Hermite, inversion and mode methods and the
 * series decline when their own error estimate exceeds 3e−5 of the
 * value. The inversion and the modes also decline when the value, or a
 * factor that multiplies it (z^(−m), z^m, the shifted sum), is not a
 * finite normal f32: a GPU flushes a value below 1.18e−38 to 0, and a
 * value past 3.4e38 is inf, and the test passed 0 and inf whatever the
 * estimate. Their estimates count each value that a GPU can flush as a
 * loss of 1.18e−38, and they test err <= 500·|value| (500 = 3e−5 / 6e−8),
 * since 6e−8·err and 3e−5·|value| both flush to 0 for a value below about
 * 4e−34. For PolyLog below z = −1, a Φ(z,s,1) below 3.9e−34 from the
 * other methods goes to the inversion and the modes for the same reason.
 * The
 * estimate adds, in units of the f32 rounding error, the error of each exp
 * and pow call (on a GPU it grows with the size of the argument: pow(b, e)
 * is within about 6e−8·(2 + |e·log2 b|) relative) and the cancellation
 * between the terms.
 *
 * Cost of one call, in loop iterations: the series up to 4096 terms (plus
 * one per unit of −a for a < 0); the transform up to 64 terms; the
 * rational form up to 16 rows of at most 18 coefficients; the integral up
 * to 224 integrand values, each with a Horner sum of n + 1 <= 17 terms;
 * the Hermite form up to 199 continued-fraction steps and 128 integrand
 * values; the inversion 20 terms and an inner series of up to 199 terms (or
 * the integral and Hermite form again); the Fourier modes up to 128 modes
 * and up to 100 shift terms. The dispatcher tries at most three of these
 * per call, and the modes after them: the worst case, near z = 1 with
 * s < 0, is the 4096 series terms, then the integral, then the Hermite form
 * (about 4700 iterations plus the Horner sums); below z = −1 at most about
 * 1100, and 230 more for the modes.
 *
 * Accuracy, measured on an Apple M5 Max GPU (WebGL2 through ANGLE Metal, and
 * WebGPU; the two agree within 2.6e−6 relative) against mpmath's lerchphi
 * and polylog at the f32-rounded operands, on 4130 random real points (z
 * from −1e6 to 1, and up to 1e3 for an integer s <= −3; s from −12 to 12
 * with integers, half-integers and near-integers; a from 0.05 to 50, and
 * negative a with an integer s), and on 63 points with |z| from 1e8 to 3e38
 * against 40-digit quadrature: every value that is not NaN is within 1.5e−5
 * relative (worst 1.34e−5, from the Hermite form next to z = 1; every other
 * method within 8.5e−6). A true value below the smallest normal f32
 * (1.2e−38) comes back as 0 or a wrong subnormal: GPUs flush subnormals to
 * zero. A value above it does not lose terms to the flush: the series and
 * the Euler transform decline when a term they need can be below 1.2e−38
 * (see above), and the integral sums nodes without the factor a^(−s) (and,
 * below z = −1, with e^S) and applies that factor once at the end. An f32
 * model whose log2 is 2.5 ulp off (a worse GPU than the one measured) puts
 * some values at up to 2.4e−5: the error grows with the size of the pow and
 * exp arguments, |s·log2 a| for a large |s|.
 *
 * The Fourier modes, measured the same way on 900 points with z <= −0.3
 * and s from −16 to −3 (600 of LerchPhi at z = −1, below it with |z| up to
 * 1e6, and between −1 and −0.3; 300 of PolyLog below z = −1, half with s
 * within 1 of −12), where the other methods left 234 values NaN: 40 are
 * NaN now, and every value is within 1.4e−5 (worst 1.38e−5 for PolyLog,
 * 8.5e−6 for LerchPhi). On 1500 further random points over the whole domain
 * above (z from −1e6 to 1e3, s from −12 to 12, a from 0.05 to 50 and
 * negative a with an integer s), 1469 answer instead of 1388, all within
 * 1.05e−5, and the 1388 values answered before are bit-identical.
 *
 * Far below z = −1, on the same GPU against the CPU kernels (which agree
 * with mpmath at 100 digits within 8e−13 on a sample of 350), on 4000
 * PolyLog points (z from −1e38 to −1 with a log-uniform size, s from −30
 * to −3) and 2000 LerchPhi points (the same z and s, a from 0.1 to 10):
 * 3485 PolyLog values and 960 LerchPhi values answer. Before the
 * finite-normal tests and the stopping rule of Liₛ(1/z) in the inversion
 * (see `_gpu_poly_log_inversion`), 3792 and 1141 answered, of which 786
 * and 170 were more than 1.5e−5 off: 0 for Li_{−24.8}(−1.1e35) = −3.7e−25,
 * +inf for Φ(−7.6e6, −20.44, 5.78) = 1.02e7, 9.6 times too large for
 * Li_{−28.97}(−8.7e8). Every value whose true value is a normal f32 is now
 * within 2.1e−5: 16 PolyLog values (the inversion with s below −20 and |z|
 * above 1e20, and the modes) and 2 LerchPhi values (the modes) are between
 * 1.5e−5 and 2.04e−5, where the error estimates are just below 3e−5. 15
 * LerchPhi values whose true value is below 1.18e−38 come back as 0 or a
 * wrong subnormal, as above. On 3000 points each over the domain above
 * (z from −1e6 to 1, s from −12 to 12, a from 0.05 to 50), the LerchPhi
 * values are bit-identical to those before these changes; 92 PolyLog
 * values of the modes moved by at most 2e−6 relative (the factor z is now
 * in the exponent); one LerchPhi and one PolyLog value of the modes, off
 * by the same amount before, are 1.85e−5 and 1.7e−5 off.
 */
const LERCH_EULER_TERMS = 64;
/** The largest n for which the Lerch helpers build the rational function
 * Φ(w, −n, a) (their coefficient arrays hold n + 2 entries). */
const LERCH_MAX_N = 16;
export const GPU_LERCH_PREAMBLE_GLSL = `
vec2 _gpu_lerch_series(float z, float s, float a) {
  int n0 = a < 0.0 ? int(ceil(-a)) : 0;
  float az = abs(z);
  float sum = 0.0;
  float zk = 1.0;
  float prev = 3.0e38;
  // For the error estimate: the terms weighted by the roundings of z^k (k
  // of them), their moduli, and the range of |a + k| (pow(b, -s) is within
  // about 6e-8 (2 + |s log2 b|) relative on a GPU).
  float err = 0.0;
  float sizes = 0.0;
  float bmin = 3.0e38;
  float bmax = 0.0;
  int settled = 0;
  for (int k = 0; k < n0 + 4096; k++) {
    float b = a + float(k);
    float t = (b != 0.0) ? zk * _gpu_zeta_pow(b, -s) : 0.0;
    sum += t;
    float size = abs(t);
    err += size * (2.0 + float(k));
    sizes += size;
    if (b != 0.0) {
      bmin = min(bmin, abs(b));
      bmax = max(bmax, abs(b));
    }
    if (b > 0.0) {
      float rho = max(size / prev, az);
      if (size == 0.0 ||
          (size < prev && rho < 1.0 &&
           size * rho / (1.0 - rho) <= 1e-7 * abs(sum))) {
        settled++;
        if (settled == 3) {
          float lb = max(abs(log2(bmin)), abs(log2(bmax)));
          float bound = 6.0e-8 * (err + sizes * (2.0 + abs(s * lb)));
          if (!(bound <= 3.0e-5 * abs(sum))) return vec2(0.0);
          // A GPU flushes a term below the smallest normal f32 (1.2e-38) to
          // zero. The flushed tail is at most 1.2e-38 / (1 - |z|): decline
          // unless that is below 2^-24 of the sum. (Not rho: after a flushed
          // term, prev can be 0 and rho 0/0.)
          if (abs(sum) * (1.0 - az) < 1.9721523e-31) return vec2(0.0);
          return vec2(sum, 1.0);
        }
      } else {
        settled = 0;
      }
      prev = size;
    }
    zk *= z;
  }
  return vec2(0.0);
}

vec2 _gpu_lerch_euler(float z, float s, float a) {
  int n0 = a <= 0.0 ? int(floor(-a)) + 1 : 0;
  float head = 0.0;
  float zn = 1.0;
  float largest = 0.0;
  for (int k = 0; k < n0; k++) {
    float b = a + float(k);
    float t = (b != 0.0) ? zn * _gpu_zeta_pow(b, -s) : 0.0;
    head += t;
    largest = max(largest, abs(t));
    zn *= z;
  }
  float b0 = a + float(n0);
  float w[${LERCH_EULER_TERMS + 1}];
  int nterm = 0;
  float sum = 0.0;
  float zPow = 1.0;
  int settled = 0;
  for (int k = 0; k < ${LERCH_EULER_TERMS}; k++) {
    float cur = zPow * pow(b0 + float(k), -s);
    float inc;
    if (k == 0) {
      nterm = 1;
      w[1] = cur;
      inc = 0.5 * cur;
    } else {
      float tmp = w[1];
      w[1] = cur;
      for (int j = 1; j <= nterm - 1; j++) {
        float dum = w[j + 1];
        w[j + 1] = 0.5 * (w[j] + tmp);
        tmp = dum;
      }
      if (nterm >= ${LERCH_EULER_TERMS}) return vec2(0.0);
      w[nterm + 1] = 0.5 * (w[nterm] + tmp);
      if (abs(w[nterm + 1]) <= abs(w[nterm])) {
        nterm++;
        inc = 0.5 * w[nterm];
      } else {
        inc = w[nterm + 1];
      }
    }
    sum += inc;
    zPow *= z;
    if (k > 4 && abs(inc) <= 1e-7 * abs(sum)) {
      settled++;
      if (settled == 3) {
        // A GPU flushes a term below the smallest normal f32 (1.2e-38) to
        // zero: decline unless the terms the stopping rule reads, down to
        // 1e-7 of the sum, are normal.
        if (abs(sum) < 1.9721523e-31) return vec2(0.0);
        float tail = zn * sum;
        float res = head + tail;
        if (max(largest, abs(tail)) > 100.0 * abs(res)) return vec2(0.0);
        return vec2(res, 1.0);
      }
    } else {
      settled = 0;
    }
  }
  return vec2(0.0);
}

// 1 - e^(-t) for t >= 0, by its Taylor series below 1/4, where
// 1.0 - exp(-t) would cancel.
float _gpu_lerch_em(float t) {
  if (t < 0.25)
    return t * (1.0 - t / 2.0 * (1.0 - t / 3.0 * (1.0 - t / 4.0 *
      (1.0 - t / 5.0 * (1.0 - t / 6.0 * (1.0 - t / 7.0))))));
  return 1.0 - exp(-t);
}

// ln Gamma(s) for s > 0: shift the argument to x >= 8 (ln Gamma(s) =
// ln Gamma(x) - ln(s (s+1) ... (x-1))), then the Stirling series. Within
// about 1e-6 absolute. _gpu_gamma is not used here: its Lanczos sum
// cancels in f32 near s = 0.
float _gpu_lerch_lgamma(float s) {
  float p = 1.0;
  float x = s;
  for (int k = 0; k < 8; k++) {
    if (x >= 8.0) break;
    p *= x;
    x += 1.0;
  }
  float x2 = x * x;
  float corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * x2)) / x2) / x;
  return (x - 0.5) * log(x) - x + (0.91893853320467274 + corr) - log(p);
}

// 1 / (1 - z e^(-t)) for t >= 0 and z < 1, without cancellation: for
// 0 < z < 1 the denominator is (1 - z) + z (1 - e^(-t)), two terms >= 0.
float _gpu_lerch_g(float z, float t) {
  if (z < 0.0) return 1.0 / (1.0 - z * exp(-t));
  return 1.0 / ((1.0 - z) + z * _gpu_lerch_em(t));
}

// One step of the polynomials P_m(w) = (1 - w)^(m+1) Phi(w, -m, a), in
// place: P_(m+1)(w) = (1 - w)(a P_m + w P_m') + (m + 1) w P_m, that is
// p'_k = (a + k) p_k + (m + 2 - a - k) p_(k-1), from P_0 = 1. It follows from
// Phi(w, -m-1, a) = (a + w d/dw) Phi(w, -m, a). Updated from the top so
// each entry still reads the previous row's values. c holds
// LERCH_MAX_N + 2 entries.
void _gpu_lerch_pstep(inout float c[${LERCH_MAX_N + 2}], float a, int m) {
  for (int k = m + 1; k >= 0; k--) {
    float hi = k <= m ? (a + float(k)) * c[k] : 0.0;
    float lo = k >= 1 ? (float(m + 2) - a - float(k)) * c[k - 1] : 0.0;
    c[k] = hi + lo;
  }
}

// Phi(w, -n, a) = v sum_k p_k u^k v^(n-k), v = 1/(1 - w), u = w v, from
// the coefficients of P_n: returns vec2(the sum without its factor v, the
// sum of the moduli of its terms), by Horner in u with the powers of v
// carried along. For w < -1, |u| and |v| are at most 1, so nothing
// overflows. The caller applies the factor v, or folds it into an
// exponent (see _gpu_lerch_integral).
vec2 _gpu_lerch_poly(float c[${LERCH_MAX_N + 2}], int n, float u, float v) {
  float au = abs(u);
  float av = abs(v);
  float r = c[n];
  float ra = abs(c[n]);
  float vp = v;
  float avp = av;
  for (int k = n - 1; k >= 0; k--) {
    r = r * u + c[k] * vp;
    ra = ra * au + abs(c[k]) * avp;
    vp *= v;
    avp *= av;
  }
  return vec2(r, ra);
}

// Phi(z, -n, a) for an integer 0 <= n <= LERCH_MAX_N: a rational function
// of z, for every real z != 1 and every a (the (k + a) = 0 term is 0^n = 0,
// dropped as the series drops it). It has no branch cut, so it holds for
// z > 1 too. Returns vec2(value, 1), or vec2(0, 0) when the terms cancel so
// far that the error estimate exceeds 3e-5 of the value (next to a zero of
// Phi); the caller then tries its other methods.
vec2 _gpu_lerch_rational(float z, int n, float a) {
  const float EPS = 6.0e-8;
  float c[${LERCH_MAX_N + 2}];
  for (int i = 0; i < ${LERCH_MAX_N + 2}; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  float v = 1.0 / (1.0 - z);
  vec2 q = _gpu_lerch_poly(c, n, z * v, v);
  if (!(EPS * (float(n + 4) * q.y) <= 3.0e-5 * abs(q.x))) return vec2(0.0);
  return vec2(q.x * v, 1.0);
}

// Phi(z,s,a) for real z < 1 (z != 0) and a > 0, from
//   Phi(z,s,a) = 1/Gamma(s) Int_0^inf t^(s-1) e^(-a t) / (1 - z e^(-t)) dt
// for s > 0, whose integrand is positive, so the sum has no cancellation at
// any z. For s <= 0 (not an integer) it integrates by parts n = ceil(-s)
// times first:
//   Phi(z,s,a) = 1/Gamma(s+n) Int_0^inf t^(s+n-1) e^(-a t) R_n(z e^(-t)) dt,
// R_n(w) = Phi(w, -n, a): the n-th derivative in t of
// e^(-a t)/(1 - z e^(-t)) is (-1)^n e^(-a t) R_n(z e^(-t)), and the n signs
// (-1) of the parts cancel it. That integrand is positive for 0 < z < 1
// and changes sign for z < 0, where the error estimate measures the
// cancellation. A negative a (s > 0 is then an integer) is first shifted to
// a + n0 in (0, 1] by Phi(a) = sum_{k<n0} z^k (a+k)^(-s) + z^n0 Phi(a+n0).
// With tau = a t the integral is a^(-(s+n)) times an integral against the
// density tau^(s+n-1) e^(-tau) / Gamma(s+n). Its pieces: [0, e0] in closed
// form from the first two Taylor terms of the integrand's smooth factor,
// R_n(z) and -R_(n+1)(z); [e0, lam] (lam = min(1, 1/a)) in panels of width
// <= 3 in ln t, which resolves the t^(s+n-1) singularity and, for z near 1,
// the pole at t = ln z < 0; then panels in t up to where 1/(1 - z e^(-t))
// has reached 1 (t = ln(-z) + 17 for z < 0) and the density is negligible
// (tau = s + n + 30; for a > 1 and z < 0 the integrand decays like
// e^(-(a-1) t) before that). A linear panel starting at x is at most 2x
// wide (the singularity at t = 0), at most 8/a wide (e^(-a t)), and at most
// max(4/(1 + n/4), 0.6 |x - L|) wide, L = ln|z|: the poles of the integrand
// sit at t = L +- i pi (of order n + 1), so a panel far from the step at L
// may be a fixed fraction of its distance to it, and next to it the panels
// narrow as n grows. So the panel count does not grow with |z|: in
// measurements the whole f32 range (|z| up to 3.4e38) takes at most 22
// panels. Below z = -1 the factor 1/(1 - z e^(-t)) is carried as its log,
// -softplus(L - t), inside the exponent of the density: the factor runs from
// about 1/|z| to 1 and the density e^(-a t) down past e^(-88), so each alone
// can fall under the smallest normal f32, which a GPU flushes to zero (the
// value at z = -3e38 was 3% off), where their product does not. Every panel
// is an 8-point Gauss-Legendre rule, at most 28 panels (224 integrand
// values, each a Horner sum of n + 1 terms); past that it declines.
// Returns vec2(value, 1) or vec2(0, 0) where it cannot vouch for the value:
// the error estimate adds, in units of the f32 rounding error EPS, the
// errors of the shifted terms, of each node (its exp argument, and the
// moduli of the terms of R_n), of the closed-form head, of ln Gamma(s+n)
// and of a^(-(s+n)), and declines above 3e-5 of the value.
vec2 _gpu_lerch_integral(float z, float s, float a) {
  const float EPS = 6.0e-8;
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  int n = s > 0.0 ? 0 : int(ceil(-s));
  float sn = s + float(n);
  int n0 = a < 0.0 ? int(ceil(-a)) : 0;
  float head = 0.0;
  float zk = 1.0;
  float err = 0.0;
  for (int k = 0; k < n0; k++) {
    float bk = a + float(k);
    float t = zk * _gpu_zeta_pow(bk, -s);
    head += t;
    err += abs(t) * (2.0 + float(k) + abs(s * log2(abs(bk))));
    zk *= z;
  }
  a += float(n0);
  float c[${LERCH_MAX_N + 2}];
  for (int i = 0; i < ${LERCH_MAX_N + 2}; i++) c[i] = 0.0;
  c[0] = 1.0;
  for (int m = 0; m < n; m++) _gpu_lerch_pstep(c, a, m);
  float lg = _gpu_lerch_lgamma(sn);
  float lam = min(1.0, 1.0 / a);
  float delta = z > 0.0 ? -log(z) : PI;
  float e0 = 1e-3 * min(lam, delta);
  float la = log(a);
  float tau0 = a * e0;
  float L = z < 0.0 ? log(-z) : log(z);
  bool big = z < -1.0;
  // With the factor in the exponent, every node also carries e^S,
  // S = min(a, 1) L, the size of the largest nodes (about |z|^(-min(a,1))),
  // so that the nodes of a value near the smallest normal f32 do not flush
  // to zero one by one; the sum is divided by e^S at the end, inside one
  // exp (at z = -1e35 a value of 6e-37 was 0.4% off without it).
  float S = big ? min(a, 1.0) * L : 0.0;
  float lG0 = 0.0;
  float v0h = 1.0 / (1.0 - z);
  float u0 = z * v0h;
  if (big) {
    lG0 = -(L + log(1.0 + exp(-L)));
    v0h = exp(lG0);
    u0 = -exp(L + lG0);
  }
  vec2 f0 = _gpu_lerch_poly(c, n, u0, v0h);
  float c1[${LERCH_MAX_N + 2}] = c;
  _gpu_lerch_pstep(c1, a, n);
  vec2 f1 = _gpu_lerch_poly(c1, n + 1, u0, v0h);
  float p0 = big ? exp(sn * log(tau0) - lg + lG0 + S) : exp(sn * log(tau0) - lg) * v0h;
  float d1 = -f1.x / a;
  float sum = p0 * (f0.x / sn + d1 * tau0 / (sn + 1.0));
  // The head's error: the rounding of Phi(z, -n, a) and Phi(z, -n-1, a),
  // bounded by the moduli of their terms, and the exp that gives p0.
  float ferr = abs(p0) * ((f0.y / sn + f1.y / a * tau0 / (sn + 1.0)) * float(n + 5)) +
    abs(sum) * (abs(sn * log(tau0)) + abs(lg) + abs(L));
  float v0 = log(e0);
  float v1 = log(lam);
  float nlog = max(1.0, ceil((v1 - v0) / 3.0));
  float hv = (v1 - v0) / nlog;
  float TG = max(L, 0.0) + 17.0;
  float tw = (sn + 30.0) / a;
  float tEnd = tw;
  if (z < 0.0) tEnd = max(tw, a > 1.0 ? min(TG, (sn + 30.0) / (a - 1.0)) : TG);
  float hW = 8.0 / a;
  float x = lam;
  for (int p = 0; p < 28; p++) {
    bool logPanel = float(p) < nlog;
    if (!logPanel && x >= tEnd) break;
    float w = logPanel ? hv :
      min(min(2.0 * x, hW), max(4.0 / (1.0 + 0.25 * float(n)), 0.6 * abs(x - L)));
    float cc = logPanel ? v0 + (float(p) + 0.5) * hv : x + 0.5 * w;
    float r = 0.5 * w;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float u = cc + (j == 0 ? -r : r) * gx[i];
        float t = logPanel ? exp(u) : u;
        float tau = a * t;
        float e = logPanel ? sn * (u + la) : (sn - 1.0) * log(tau);
        float vn;
        float un;
        float lG = 0.0;
        if (big) {
          float xs = L - t;
          lG = -(max(xs, 0.0) + log(1.0 + exp(-abs(xs))));
          vn = exp(lG);
          un = -exp(xs + lG);
        } else {
          vn = _gpu_lerch_g(z, t);
          un = z * exp(-t) * vn;
        }
        vec2 pv = _gpu_lerch_poly(c, n, un, vn);
        float ex = e - tau - lg;
        float q = r * gw[i] * ((logPanel ? 1.0 : a) * (big ? exp(ex + lG + S) : exp(ex) * vn));
        sum += q * pv.x;
        ferr += q * (abs(pv.x) * ((abs(e) + tau) + (abs(lG) + abs(L))) +
          pv.y * (float(n + 3) + t));
      }
    }
    if (!logPanel) x += w;
  }
  if (x < tEnd) return vec2(0.0); // the panel budget ran out
  float scaled = big ? (sum < 0.0 ? -1.0 : 1.0) * exp(log(abs(sum)) - (S + sn * la))
                     : pow(a, -sn) * sum;
  float tail = zk * scaled;
  float res = head + tail;
  float rel = ferr / abs(sum) + (8.0 + abs(lg)) +
    ((float(n0) + 2.0) + (abs(sn * log2(a)) + S));
  float bound = EPS * (err + abs(tail) * rel);
  if (!(bound <= 3.0e-5 * abs(res))) return vec2(0.0);
  return vec2(res, 1.0);
}

// The three ways _gpu_lerch_hermite computes h = e^x x^(-sig) Gamma(sig, x)
// at a complex x = (x.x, x.y), sig >= 1. Each returns vec4(Re h, Im h,
// err, ok), with err an estimate of the absolute error of h in units of
// the f32 rounding error.
//
// An integer sig = n + 1: Gamma(n+1, x) = n! e^(-x) sum_{k<=n} x^k / k!,
// so h = (1/x) sum_{j<=n} n!/(n-j)! x^(-j), summed from the inside out.
vec4 _gpu_lerch_h_integer(float sig, vec2 x) {
  int n = int(sig) - 1;
  float d = x.x * x.x + x.y * x.y;
  float ir = x.x / d;
  float ii = -x.y / d;
  float ix = sqrt(ir * ir + ii * ii);
  float rr = 1.0;
  float ri = 0.0;
  float ra = 1.0; // the same sum over the moduli
  for (int j = 1; j <= n; j++) {
    float tr = ir * rr - ii * ri;
    float ti = ir * ri + ii * rr;
    rr = 1.0 + float(j) * tr;
    ri = float(j) * ti;
    ra = 1.0 + float(j) * ix * ra;
  }
  return vec4(rr * ir - ri * ii, rr * ii + ri * ir, (float(n) + 3.0) * ra * ix, 1.0);
}

// |x| < sig: h = e^x x^(-sig) Gamma(sig) - sum_k x^k / (sig (sig+1) ... (sig+k)),
// whose terms decrease from the first. (The continued fraction loses
// digits in f32 there: 8% at sig = 12.9, x = -0.01 - 3.14i.)
vec4 _gpu_lerch_h_series(float sig, vec2 x) {
  float tr = 1.0 / sig;
  float ti = 0.0;
  float sr = tr;
  float si = 0.0;
  float sa = tr;
  int k = 1;
  for (k = 1; k < 100; k++) {
    float f = sig + float(k);
    float nr = (tr * x.x - ti * x.y) / f;
    ti = (tr * x.y + ti * x.x) / f;
    tr = nr;
    sr += tr;
    si += ti;
    float ta = abs(tr) + abs(ti);
    sa += ta;
    if (ta < 1e-8 * (abs(sr) + abs(si))) break;
  }
  float er = x.x - sig * log(sqrt(x.x * x.x + x.y * x.y)) + _gpu_lerch_lgamma(sig);
  // arg x. At z = -1, x.x is -0.0, and the two-argument atan of Apple's
  // GPU (ANGLE Metal and WebGPU) then answers the wrong branch, so the
  // imaginary axis is taken explicitly.
  float arg = x.x == 0.0 ? (x.y < 0.0 ? -1.5707963267949 : 1.5707963267949) : atan(x.y, x.x);
  float ei = x.y - sig * arg;
  float m = exp(er);
  return vec4(m * cos(ei) - sr, m * sin(ei) - si,
    m * (24.0 + abs(er) + abs(ei)) + (float(k) + 3.0) * sa, 1.0);
}

// |x| >= sig: Legendre's continued fraction for h, by the modified Lentz
// method, at most 200 steps.
vec4 _gpu_lerch_h_cf(float sig, vec2 x) {
  const float FPMIN = 1e-30;
  float br = x.x - sig + 1.0;
  float bi = x.y;
  float cr = 1e30;
  float ci = 0.0;
  float dd = br * br + bi * bi;
  float dr = br / dd;
  float di = -bi / dd;
  float hr = dr;
  float hi = di;
  for (int i = 1; i < 200; i++) {
    float an = -float(i) * (float(i) - sig);
    br += 2.0;
    dr = an * dr + br;
    di = an * di + bi;
    if (abs(dr) + abs(di) < FPMIN) dr = FPMIN;
    float cc = cr * cr + ci * ci;
    cr = br + an * cr / cc;
    ci = bi - an * ci / cc;
    if (abs(cr) + abs(ci) < FPMIN) cr = FPMIN;
    dd = dr * dr + di * di;
    dr = dr / dd;
    di = -di / dd;
    float er = dr * cr - di * ci;
    float ei = dr * ci + di * cr;
    float nr = hr * er - hi * ei;
    hi = hr * ei + hi * er;
    hr = nr;
    if (abs(er - 1.0) + abs(ei) < 1e-7)
      return vec4(hr, hi, 35.0 * sqrt(hr * hr + hi * hi), 1.0);
  }
  return vec4(0.0);
}

// Phi(z,s,a) for real z != 0, 1 and s <= 0, from the Hermite-type
// representation (valid for a > 0):
//   Phi(z,s,a) = 1/(2 a^s) + a^(1-s) h - 2 Int_0^inf
//     sin(t log z - s arctan(t/a)) / ((a^2+t^2)^(s/2) (e^(2 pi t) - 1)) dt,
// with h = e^x x^(s-1) Gamma(1-s, x) at x = -a log z. (The middle term is
// z^(-a) (-log z)^(s-1) Gamma(1-s, -a log z): e^x = z^(-a) and
// x^(1-s) = a^(1-s) (-log z)^(1-s) for a real a > 0.) For z < 0,
// log z = ln|z| + i pi; the three terms are then complex and their sum is
// real, so only the real parts are summed, and the integrand's real part
// is sin(t ln|z| - s arctan(t/a)) cosh(pi t) / (e^(2 pi t) - 1). First a is
// shifted to b = a + m >= 1, which keeps |Im x| = pi b >= pi and the
// integrand's branch points at t = +-ib clear of the real axis. The
// integral is an 8-point Gauss-Legendre rule on at most 16 panels up to
// where e^(-pi t) (b^2+t^2)^(-s/2) is negligible, each panel at most 1.5
// wide (poles at t = +-i) and at most 4/|ln|z|| wide (the oscillation);
// past 16 panels it declines. Returns vec2(value, 1) or vec2(0, 0) where
// the error estimate (the pow and exp arguments, h's own error, and the
// cancellation between the terms) exceeds 3e-5 of the value.
vec2 _gpu_lerch_hermite(float z, float s, float a) {
  const float EPS = 6.0e-8;
  const float PI = 3.14159265358979;
  const float gx[4] = float[4](0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  const float gw[4] = float[4](0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  if (s < -30.0) return vec2(0.0);
  int m = a < 1.0 ? int(ceil(1.0 - a)) : 0;
  float head = 0.0;
  float zk = 1.0;
  float err = 0.0;
  for (int k = 0; k < m; k++) {
    float bk = a + float(k);
    if (bk != 0.0) {
      float t = zk * _gpu_zeta_pow(bk, -s);
      head += t;
      err += abs(t) * (2.0 + float(k) + abs(s * log2(abs(bk))));
    }
    zk *= z;
  }
  float b = a + float(m);
  float L = log(abs(z));
  float sig = 1.0 - s;
  vec2 x = vec2(-b * L, z < 0.0 ? -b * PI : 0.0);
  vec4 h;
  if (sig == floor(sig)) h = _gpu_lerch_h_integer(sig, x);
  else if (sqrt(x.x * x.x + x.y * x.y) < sig) h = _gpu_lerch_h_series(sig, x);
  else h = _gpu_lerch_h_cf(sig, x);
  if (h.w < 0.5) return vec2(0.0);
  float t1 = 0.5 * pow(b, -s);
  float bs = pow(b, sig);
  float t2 = bs * h.x;
  // |h| up to a factor sqrt(2), without squaring: near z = 1 an integer
  // order gives an h near 1e25, whose square overflows f32.
  float t2abs = bs * (abs(h.x) + abs(h.y));
  float q3 = max(-s, 0.0);
  float t3end = (21.0 + q3 * log(1.0 + (q3 + 7.0) / b)) / PI;
  float n3 = ceil(t3end / min(1.5, 4.0 / max(abs(L), 1e-3)));
  if (n3 > 16.0) return vec2(0.0);
  float h3 = t3end / n3;
  float t3 = 0.0;
  float a3 = 0.0;
  float b2 = b * b;
  for (int p = 0; p < 16; p++) {
    if (float(p) >= n3) break;
    float c = (float(p) + 0.5) * h3;
    float r = 0.5 * h3;
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 2; j++) {
        float t = c + (j == 0 ? -r : r) * gx[i];
        float y = 2.0 * PI * t;
        float q = exp(-y);
        float omq = _gpu_lerch_em(y);
        float K = z < 0.0 ? exp(-PI * t) * (1.0 + q) / (2.0 * omq) : q / omq;
        float f = sin(t * L - s * atan(t / b)) *
          exp(-0.5 * s * log(b2 + t * t)) * K;
        float wf = r * gw[i] * f;
        t3 += wf;
        a3 += abs(wf) * ((6.0 + 10.0 * t) +
          (abs(s) * (2.0 + 0.5 * log2(b2 + t * t)) + abs(t * L)));
      }
    }
  }
  t3 = -2.0 * t3;
  a3 = 2.0 * a3;
  float phi = t1 + t2 + t3;
  float res = head + zk * phi;
  float e1 = t1 * (2.0 + abs(s * log2(b)));
  float e2 = t2abs * (2.0 + abs(sig * log2(b))) + bs * h.z;
  float ephi = (e1 + e2) + (a3 + 3.0 * (t1 + t2abs + abs(t3)));
  float bound = EPS * (err + abs(zk) * (ephi + (float(m) + 2.0) * abs(phi)) + abs(res));
  if (!(bound <= 3.0e-5 * abs(res))) return vec2(0.0);
  return vec2(res, 1.0);
}

// Phi(z,s,a) for s <= 0: the integral after n integrations by parts (a
// non-integer s >= -LERCH_MAX_N with a > 0), and where it declines the
// Hermite form.
vec2 _gpu_lerch_negative(float z, float s, float a) {
  if (s != floor(s) && a > 0.0 && s >= -${LERCH_MAX_N}.0) {
    vec2 r = _gpu_lerch_integral(z, s, a);
    if (r.y > 0.5) return r;
  }
  return _gpu_lerch_hermite(z, s, a);
}

// Phi(z,s,a) as vec2(value, 1), or vec2(0, 0) where the value is complex
// or no method can vouch for it. The cases, in order: z = 1 is the Hurwitz
// zeta; z = 0 keeps only the k = 0 term; s = 0 is 1/(1 - z); a
// non-positive integer s >= -LERCH_MAX_N is the rational function of
// _gpu_lerch_rational, for every z, where it does not decline; a
// non-positive integer a with s > 0 is the pole (+inf); a < 0 with a
// non-integer s is complex; z > 1 is on the branch cut unless s is a
// non-positive integer, where Phi has no cut (the Hermite form). Past
// z = -1 and at z = -1: the positive integral for s > 0, and for s <= 0
// _gpu_lerch_negative. Inside the unit interval: the Euler transform
// (z < 0, s > 0) or the direct series, and where those decline the
// integral (s > 0) or _gpu_lerch_negative (s <= 0).
vec2 _gpu_lerch_core(float z, float s, float a) {
  if (z == 1.0) return vec2(_gpu_hurwitz_zeta(s, a), 1.0);
  if (z == 0.0) return vec2(_gpu_zeta_pow(a, -s), 1.0); // only the k = 0 term survives
  if (s == 0.0) return vec2(1.0 / (1.0 - z), 1.0);
  if (s < 0.0 && s == floor(s) && s >= -${LERCH_MAX_N}.0) {
    vec2 q = _gpu_lerch_rational(z, int(-s), a);
    if (q.y > 0.5) return q;
  }
  bool aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) return vec2(_gpu_inf(), 1.0); // (k+a) = 0 diverges, z != 0
  if (a < 0.0 && s != floor(s)) return vec2(0.0); // complex value
  if (a < -1.0e6) return vec2(0.0); // one term per unit of -a
  if (z > 1.0) {
    if (s > 0.0 || s != floor(s)) return vec2(0.0); // on the branch cut
    return _gpu_lerch_hermite(z, s, a);
  }
  if (z < -1.0) return s > 0.0 ? _gpu_lerch_integral(z, s, a) : _gpu_lerch_negative(z, s, a);
  if (z < 0.0 && s > 0.0) {
    vec2 e = _gpu_lerch_euler(z, s, a);
    return e.y > 0.5 ? e : _gpu_lerch_integral(z, s, a);
  }
  if (z == -1.0) return _gpu_lerch_negative(z, s, a); // s < 0: the series diverges
  vec2 r = _gpu_lerch_series(z, s, a);
  if (r.y > 0.5) return r;
  return s > 0.0 ? _gpu_lerch_integral(z, s, a) : _gpu_lerch_negative(z, s, a);
}

// Phi(z, s, a) for z < 0, -30 <= s <= -3 and |a| < 100, from the Fourier
// modes of the base point b = a moved into (0, 1] (the form of
// lerchModesComplex, numerics/lerch-phi.ts, for a real z < 0):
//   Phi(z, s, b) = 2 Gamma(1-s) e^(-b L) sum_{m = 1, 3, 5, ...}
//     (L^2 + pi^2 m^2)^((s-1)/2) cos(pi (b m + (s-1) (1/2 + atan(L/(pi m))/pi))),
// L = ln|z|: the modes n and 1 - n of the sum over all integers n, paired.
// The terms fall like m^(s-1) and do not cancel the way the Hermite form's
// terms do below z = -1. The sum stops when the bound m (pi m)^(s-1)/(2|s|)
// on the modes left out, taken against the first one, is below 1e-9, and
// after 128 modes at most (ln|z| near 7 at s = -4). The phase is kept in
// units of pi and reduced to [-1/2, 1/2] before the cosine; b m and
// (s-1)/2 are reduced modulo 2 exactly. The modes are summed relative to
// the first one, and the factor 2 Gamma(1-s) e^(-bL) (L^2 + pi^2)^((s-1)/2)
// is one exp. a <= 0 adds the terms z^j (a+j)^(-s) before b; a > 1 uses
// Phi(z,s,a) = z^(-m) (Phi(z,s,b) - sum_{j<m} z^j (b+j)^(-s)). With c = 1
// (only with a = 1) the value is z Phi(z, s, 1) = Li_s(z): the factor
// z = -e^L goes into the exponent of the scale, so that Li_s(z) does not
// pass through Phi, which falls below the smallest normal f32 (1.18e-38)
// before Li_s(z) does. Returns vec2(value, 1), or vec2(0, 0) when the error
// estimate (the roundings of the exp and log arguments and of the phase,
// the modes left out, ln Gamma and the shift, in units of 6e-8) exceeds
// 3e-5 of the value, when the value is not a finite normal f32, or when
// z^(-m), the shifted sum or z^m is not: a GPU flushes a value below
// 1.18e-38 to 0, and a value past 3.4e38 is inf. The test is
// rerr <= 500 |res| (500 = 3e-5 / 6e-8): EPS rerr and 3e-5 |res| themselves
// fall below 1.18e-38 when |res| is below about 4e-34.
vec2 _gpu_lerch_modes(float z, float s, float a, float c) {
  const float EPS = 6.0e-8;
  const float FLUSH = 2.0e-31; // 1.18e-38 / EPS
  const float PI = 3.14159265358979;
  if (s < -30.0 || abs(a) >= 100.0) return vec2(0.0);
  float b = a;
  float pre = 0.0;
  float post = 0.0;
  if (a <= 0.0) {
    pre = floor(-a) + 1.0;
    b = a + pre;
  } else if (a > 1.0) {
    post = ceil(a) - 1.0;
    b = a - post;
  }
  float head = 0.0;
  float herr = 0.0;
  float zk = 1.0;
  for (int j = 0; j < 128; j++) {
    if (float(j) >= pre) break;
    float bj = a + float(j);
    if (bj != 0.0) {
      float t = zk * _gpu_zeta_pow(bj, -s);
      head += t;
      herr += abs(t) * (3.0 + float(j) + abs(s * log2(abs(bj))));
    }
    zk *= z;
  }
  float L = log(-z);
  float sm1 = s - 1.0;
  float hs = 0.5 * sm1;
  float ps = hs - 2.0 * floor(0.5 * hs); // (s-1)/2 modulo 2
  float L2 = L * L;
  float lr1 = log(L2 + PI * PI);
  float sum = 0.0;
  float err = 0.0;
  float tail = 0.0;
  for (int n = 1; n <= 128; n++) {
    float m = float(2 * n - 1);
    float x = PI * m;
    float lr = log(L2 + x * x);
    float at = atan(L / x) / PI;
    float bm = b * m;
    float P = (bm - 2.0 * floor(0.5 * bm)) + ps + sm1 * at;
    float k = floor(P + 0.5);
    float cs = cos(PI * (P - k));
    if (mod(k, 2.0) != 0.0) cs = -cs;
    float ex = hs * (lr - lr1);
    float mag = exp(ex);
    float t = mag * cs;
    sum += t;
    err += abs(t) * (4.0 + abs(ex)) +
      mag * (abs(hs) * (abs(lr) + abs(lr1)) + PI * (abs(P) + abs(sm1) * abs(at) + b * m));
    tail = mag * m / (-2.0 * s);
    if (tail <= 1e-9) break;
  }
  float lg = _gpu_lerch_lgamma(1.0 - s);
  float scale = 2.0 * exp(lg + hs * lr1 - (b - c) * L);
  float phib = scale * sum;
  if (!(scale < 3.4e38 && abs(phib) < 3.4e38)) return vec2(0.0);
  float eb = scale * (err + tail / EPS + 4.0 * abs(sum)) +
    abs(phib) * (abs(lg) + abs(hs * lr1) + abs((b - c) * L) + 12.0);
  // A GPU flushes a scale or Phi(z, s, b) below 1.18e-38 to 0: count the
  // loss (FLUSH = 1.18e-38 in units of EPS) rather than decline, since
  // next to the terms that a > 1 subtracts it can be negligible.
  if (scale < 1.18e-38 || abs(phib) < 1.18e-38) eb += FLUSH * (1.0 + abs(sum));
  if (c > 0.5) phib = -phib; // z = -e^L
  float res;
  float rerr;
  if (post > 0.0) {
    float acc = phib;
    float aerr = eb;
    float zj = 1.0;
    for (int j = 0; j < 128; j++) {
      if (float(j) >= post) break;
      float bj = b + float(j);
      float t = zj * pow(bj, -s);
      acc -= t;
      aerr += abs(t) * (3.0 + float(j) + abs(s * log2(bj)));
      zj *= z;
    }
    float zinv = pow(-z, -post);
    if (!(zinv >= 1.18e-38 && zinv < 3.4e38 && abs(acc) >= 1.18e-38 && abs(acc) < 3.4e38))
      return vec2(0.0);
    float sg = mod(post, 2.0) == 0.0 ? 1.0 : -1.0;
    res = sg * zinv * acc;
    rerr = zinv * (aerr + abs(acc) * (post + 2.0)) + abs(res) * abs(post * log2(-z));
  } else {
    if (!(abs(zk) >= 1.18e-38 && abs(zk) < 3.4e38)) return vec2(0.0);
    res = head + zk * phib;
    rerr = herr + abs(zk) * (eb + abs(phib) * (pre + 2.0));
  }
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) || !(rerr <= 500.0 * abs(res)))
    return vec2(0.0);
  return vec2(res, 1.0);
}

// Where every method of _gpu_lerch_core declines, z < 0 with s <= -3 tries
// the Fourier modes last, so that the values the other methods answer do
// not change.
float _gpu_lerch_phi(float z, float s, float a) {
  vec2 r = _gpu_lerch_core(z, s, a);
  if (r.y > 0.5) return r.x;
  if (z < 0.0 && s <= -3.0 && !(a < 0.0 && s != floor(s))) {
    r = _gpu_lerch_modes(z, s, a, 0.0);
    if (r.y > 0.5) return r.x;
  }
  return _gpu_nan();
}

// Li_s(z) for z < -1 and a real s < 0 that is not an integer, by
// Jonquiere's inversion formula (DLMF 25.12.13 with the Hurwitz zeta form):
//   Li_s(z) = Re[(2 pi)^s e^(i pi s/2) / Gamma(s) zeta(1 - s, A)]
//             - cos(pi s) Li_s(1/z),   A = 1/2 - i ln(-z) / (2 pi).
// zeta(1 - s, A) (1 - s > 1) is summed by Euler-Maclaurin: 12 terms, the
// tail integral, the half term and up to 8 Bernoulli corrections, in
// complex f32. 1/Gamma(s) = sin(pi s) Gamma(1 - s) / pi, with sin(pi s)
// taken from the distance of s to its nearest integer. Returns
// vec2(value, 1), or vec2(0, 0) when Li_s(1/z) declines, when the value is
// not a finite normal f32, or when the error estimate exceeds 3e-5 of the
// value. The estimate counts, for each value that a GPU can flush to 0
// (below 1.18e-38), the loss of 1.18e-38 (FLUSH, in units of EPS): the
// terms of zeta(1 - s, A), of which |A|^(s-1) falls below 1.18e-38 near
// z = -1e38 when s is near -30, and the terms of Li_s(1/z).
vec2 _gpu_poly_log_inversion(float s, float z) {
  const float EPS = 6.0e-8;
  const float FLUSH = 2.0e-31; // 1.18e-38 / EPS
  const float PI = 3.14159265358979;
  const float B[8] = float[8](1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0,
    5.0 / 66.0, -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0);
  float ai = -log(-z) / (2.0 * PI);
  float sig = 1.0 - s;
  float zr = 0.0;
  float zi = 0.0;
  float zerr = 0.0;
  for (int k = 0; k < 12; k++) {
    float wr = 0.5 + float(k);
    float lnw = 0.5 * log(wr * wr + ai * ai);
    float ph = -sig * atan(ai, wr);
    float m = exp(-sig * lnw);
    zr += m * cos(ph);
    zi += m * sin(ph);
    zerr += m * (4.0 + abs(sig * lnw) + abs(ph));
  }
  float wr = 12.5;
  float lnw = 0.5 * log(wr * wr + ai * ai);
  float th = atan(ai, wr);
  // w^(1 - sig) / (sig - 1), with 1 - sig = s taken from s itself: near
  // s = 0, (1 - s) - 1 would keep only a few digits of s.
  float m1 = exp(s * lnw) / -s;
  float p1 = s * th;
  zr += m1 * cos(p1);
  zi += m1 * sin(p1);
  zerr += abs(m1) * (4.0 + abs(s * lnw) + abs(p1));
  // w^(-sig) / 2
  float m0 = exp(-sig * lnw);
  float p0 = -sig * th;
  zr += 0.5 * m0 * cos(p0);
  zi += 0.5 * m0 * sin(p0);
  zerr += 0.5 * m0 * (4.0 + abs(sig * lnw) + abs(p0));
  // Bernoulli terms B_2j (sig)_(2j-1) / (2j)! w^(-sig-2j+1): u starts at
  // (sig/2) w^(-sig-1) and gains (sig+2j-1)(sig+2j) / ((2j+1)(2j+2) w^2).
  float mu1 = exp((-sig - 1.0) * lnw);
  float pu1 = (-sig - 1.0) * th;
  float ur = sig / 2.0 * mu1 * cos(pu1);
  float ui = sig / 2.0 * mu1 * sin(pu1);
  float w2r = wr * wr - ai * ai;
  float w2i = 2.0 * wr * ai;
  float w2d = w2r * w2r + w2i * w2i;
  float iw2r = w2r / w2d;
  float iw2i = -w2i / w2d;
  float prev = 3.0e38;
  for (int j = 1; j <= 8; j++) {
    float tr = ur * B[j - 1];
    float ti = ui * B[j - 1];
    float ta = abs(tr) + abs(ti);
    if (ta >= prev) break;
    zr += tr;
    zi += ti;
    zerr += ta * (10.0 + abs(sig * lnw));
    prev = ta;
    float mm = float(2 * j);
    float c = (sig + mm - 1.0) * (sig + mm) / ((mm + 1.0) * (mm + 2.0));
    float nr = c * (ur * iw2r - ui * iw2i);
    ui = c * (ur * iw2i + ui * iw2r);
    ur = nr;
  }
  zerr += 44.0 * FLUSH; // at most 22 terms in each of zr and zi
  float n = floor(s + 0.5);
  float d = s - n;
  float sgn = mod(n, 2.0) == 0.0 ? 1.0 : -1.0;
  float lg1 = _gpu_lerch_lgamma(sig);
  float fm = sgn * sin(PI * d) * exp(s * log(2.0 * PI) + lg1) / PI;
  float fre = fm * cos(0.5 * PI * s);
  float fim = fm * sin(0.5 * PI * s);
  float first = fre * zr - fim * zi;
  float firstErr = abs(fm) * zerr +
    abs(fm) * sqrt(zr * zr + zi * zi) * (30.0 + abs(lg1) + abs(s * 2.7));
  // Li_s(1/z): for |1/z| <= 1/2 its own series sum_k (1/z)^k k^(-s), with
  // an error estimate, stopped when the tail after the term t is below
  // t rho/(1-rho) <= 1e-8 of the sum, rho = |1/z| ((k+1)/k)^(-s): the ratio
  // of the next term to t, which bounds every later ratio because it
  // decreases with k for s < 0. (The ratio |1/z| alone does not bound it:
  // the second term is 2^(-s) |1/z| times the first, 0.6 of it at
  // z = -8.7e8, s = -29, where the sum stopped after one term and the value
  // was 9.6 times too large.) Closer to the rim _gpu_lerch_negative (the
  // integral, then the Hermite form) at 1/z.
  float iz = 1.0 / z;
  float li = 0.0;
  float lierr = 0.0;
  if (iz >= -0.5) {
    float wk = 1.0;
    float prev = 3.0e38;
    bool done = false;
    for (int k = 1; k < 200; k++) {
      wk *= iz;
      float t = wk * pow(float(k), -s);
      li += t;
      float size = abs(t);
      lierr += size * (2.0 + float(k) + abs(s * log2(float(k)))) + FLUSH;
      float rho = -iz * pow(float(k + 1) / float(k), -s);
      if (size < prev && rho < 1.0 && size * rho / (1.0 - rho) <= 1e-8 * abs(li)) {
        done = true;
        break;
      }
      prev = size;
    }
    if (!done) return vec2(0.0);
  } else {
    vec2 inner = _gpu_lerch_negative(iz, s, 1.0);
    if (inner.y < 0.5) return vec2(0.0);
    li = iz * inner.x;
    lierr = 500.0 * abs(li); // the inner value is within 3e-5 = 500 EPS
  }
  float res = first - sgn * cos(PI * d) * li;
  // In units of EPS; the test is bound <= (3e-5 / EPS) |res|, since
  // EPS bound and 3e-5 |res| fall below 1.18e-38 for a small |res|.
  float bound = ((firstErr + 4.0 * abs(first)) + (lierr + 2.0 * abs(li))) + 4.0 * FLUSH;
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) || !(bound <= 500.0 * abs(res)))
    return vec2(0.0);
  return vec2(res, 1.0);
}

// PolyLog(s, z). The integer orders the interpreter answers in closed form
// come first, so the shader agrees with it there: z = 0 is 0; the orders 1,
// 0 and -1 are -ln(1 - z), z/(1 - z) and z/(1 - z)^2, with a pole (+inf)
// at z = 1; an order -n, 2 <= n <= 12, is the Eulerian closed form
// z * sum_k A(n,k) z^k / (1 - z)^(n+1), which for |z| > 1 is summed in
// u = z/(1 - z) and v = 1/(1 - z) (|u|, |v| <= 1 for z < -1) so that it does
// not overflow. Every other order uses Li_s(z) = z * Phi(z, s, 1), and where
// that declines below z = -1 with a negative non-integer order, Jonquiere's
// inversion formula (_gpu_poly_log_inversion). NaN on the cut z > 1 (except
// the orders above) and where both decline.
float _gpu_poly_log(float s, float z) {
  if (z == 0.0) return 0.0;
  if (s == 1.0) {
    if (z == 1.0) return _gpu_inf();
    return z < 1.0 ? -log(1.0 - z) : _gpu_nan();
  }
  if (s == 0.0) {
    if (z == 1.0) return _gpu_inf();
    return z / (1.0 - z);
  }
  if (s == -1.0) {
    if (z == 1.0) return _gpu_inf();
    return z / ((1.0 - z) * (1.0 - z));
  }
  if (s <= -2.0 && s >= -12.0 && s == floor(s) && z != 1.0) {
    int n = int(-s);
    // Row n of the Eulerian numbers, built in place from row 0 = [1]:
    // A(m,k) = (k+1) A(m-1,k) + (m-k) A(m-1,k-1), updated from the top so
    // each entry still reads the previous row's values.
    float row[13];
    row[0] = 1.0;
    for (int i = 1; i < 13; i++) row[i] = 0.0;
    for (int m = 1; m <= n; m++) {
      for (int k = m - 1; k >= 1; k--)
        row[k] = float(k + 1) * row[k] + float(m - k) * row[k - 1];
    }
    if (abs(z) > 1.0) {
      // sum_k A(n,k) u^(k+1) v^(n-k) = u v sum_k A(n,k) u^k v^(n-1-k)
      float v = 1.0 / (1.0 - z);
      float u = z * v;
      float r = row[n - 1];
      float vp = v;
      for (int k = n - 2; k >= 0; k--) {
        r = r * u + row[k] * vp;
        vp *= v;
      }
      return u * v * r;
    }
    float p = 0.0;
    for (int k = n - 1; k >= 0; k--) p = p * z + row[k];
    float den = 1.0;
    for (int i = 0; i <= n; i++) den *= 1.0 - z;
    return z * p / den;
  }
  // Below z = -1, Phi(z, s, 1) = Li_s(z)/z falls below the smallest normal
  // f32 before Li_s(z) does, and the 3e-5 test of the methods behind
  // _gpu_lerch_core falls below it (a GPU flushes both sides to 0) when
  // |Phi| < 1.18e-38 / 3e-5 = 3.9e-34: the inversion and the modes (with the
  // factor z in the exponent) answer there instead.
  vec2 r = _gpu_lerch_core(z, s, 1.0);
  if (r.y > 0.5 && (z >= -1.0 || (abs(r.x) >= 3.9e-34 && abs(z * r.x) < 3.4e38)))
    return z * r.x;
  if (z < -1.0 && s < 0.0 && s != floor(s)) {
    vec2 v = _gpu_poly_log_inversion(s, z);
    if (v.y > 0.5) return v.x;
  }
  if (z < 0.0 && s <= -3.0) {
    r = _gpu_lerch_modes(z, s, 1.0, 1.0);
    if (r.y > 0.5) return r.x;
  }
  return _gpu_nan();
}
`;

/**
 * GPU Lerch transcendent and polylogarithm (WGSL syntax). See
 * `GPU_LERCH_PREAMBLE_GLSL` for the methods and their accuracy; the WGSL
 * text follows the GLSL one statement by statement. The Euler-transform
 * table is a fixed-size `array<f32, N>`, and the pole and NaN come from the
 * WGSL `_gpu_inf()` / `_gpu_nan()` helpers (`GPU_NAN_PREAMBLE_WGSL`).
 */
export const GPU_LERCH_PREAMBLE_WGSL = `
fn _gpu_lerch_series(z: f32, s: f32, a: f32) -> vec2<f32> {
  var n0: i32 = 0;
  if (a < 0.0) { n0 = i32(ceil(-a)); }
  let az = abs(z);
  var sum: f32 = 0.0;
  var zk: f32 = 1.0;
  var prev: f32 = 3.0e38;
  // The error estimate: see the GLSL preamble.
  var err: f32 = 0.0;
  var sizes: f32 = 0.0;
  var bmin: f32 = 3.0e38;
  var bmax: f32 = 0.0;
  var settled: i32 = 0;
  for (var k: i32 = 0; k < n0 + 4096; k = k + 1) {
    let b = a + f32(k);
    var t: f32 = 0.0;
    if (b != 0.0) { t = zk * _gpu_zeta_pow(b, -s); }
    sum = sum + t;
    let size = abs(t);
    err = err + size * (2.0 + f32(k));
    sizes = sizes + size;
    if (b != 0.0) {
      bmin = min(bmin, abs(b));
      bmax = max(bmax, abs(b));
    }
    if (b > 0.0) {
      let rho = max(size / prev, az);
      if (size == 0.0 ||
          (size < prev && rho < 1.0 &&
           size * rho / (1.0 - rho) <= 1e-7 * abs(sum))) {
        settled = settled + 1;
        if (settled == 3) {
          let lb = max(abs(log2(bmin)), abs(log2(bmax)));
          let bound = 6.0e-8 * (err + sizes * (2.0 + abs(s * lb)));
          if (!(bound <= 3.0e-5 * abs(sum))) { return vec2<f32>(0.0); }
          if (abs(sum) * (1.0 - az) < 1.9721523e-31) { return vec2<f32>(0.0); }
          return vec2<f32>(sum, 1.0);
        }
      } else {
        settled = 0;
      }
      prev = size;
    }
    zk = zk * z;
  }
  return vec2<f32>(0.0);
}

fn _gpu_lerch_euler(z: f32, s: f32, a: f32) -> vec2<f32> {
  var n0: i32 = 0;
  if (a <= 0.0) { n0 = i32(floor(-a)) + 1; }
  var head: f32 = 0.0;
  var zn: f32 = 1.0;
  var largest: f32 = 0.0;
  for (var k: i32 = 0; k < n0; k = k + 1) {
    let b = a + f32(k);
    var t: f32 = 0.0;
    if (b != 0.0) { t = zn * _gpu_zeta_pow(b, -s); }
    head = head + t;
    largest = max(largest, abs(t));
    zn = zn * z;
  }
  let b0 = a + f32(n0);
  var w: array<f32, ${LERCH_EULER_TERMS + 1}>;
  var nterm: i32 = 0;
  var sum: f32 = 0.0;
  var zPow: f32 = 1.0;
  var settled: i32 = 0;
  for (var k: i32 = 0; k < ${LERCH_EULER_TERMS}; k = k + 1) {
    let cur = zPow * pow(b0 + f32(k), -s);
    var inc: f32;
    if (k == 0) {
      nterm = 1;
      w[1] = cur;
      inc = 0.5 * cur;
    } else {
      var tmp = w[1];
      w[1] = cur;
      for (var j: i32 = 1; j <= nterm - 1; j = j + 1) {
        let dum = w[j + 1];
        w[j + 1] = 0.5 * (w[j] + tmp);
        tmp = dum;
      }
      if (nterm >= ${LERCH_EULER_TERMS}) { return vec2<f32>(0.0); }
      w[nterm + 1] = 0.5 * (w[nterm] + tmp);
      if (abs(w[nterm + 1]) <= abs(w[nterm])) {
        nterm = nterm + 1;
        inc = 0.5 * w[nterm];
      } else {
        inc = w[nterm + 1];
      }
    }
    sum = sum + inc;
    zPow = zPow * z;
    if (k > 4 && abs(inc) <= 1e-7 * abs(sum)) {
      settled = settled + 1;
      if (settled == 3) {
        if (abs(sum) < 1.9721523e-31) { return vec2<f32>(0.0); }
        let tail = zn * sum;
        let res = head + tail;
        if (max(largest, abs(tail)) > 100.0 * abs(res)) { return vec2<f32>(0.0); }
        return vec2<f32>(res, 1.0);
      }
    } else {
      settled = 0;
    }
  }
  return vec2<f32>(0.0);
}

// 1 - e^(-t), t >= 0: see the GLSL preamble.
fn _gpu_lerch_em(t: f32) -> f32 {
  if (t < 0.25) {
    return t * (1.0 - t / 2.0 * (1.0 - t / 3.0 * (1.0 - t / 4.0 *
      (1.0 - t / 5.0 * (1.0 - t / 6.0 * (1.0 - t / 7.0))))));
  }
  return 1.0 - exp(-t);
}

// ln Gamma(s) for s > 0: see the GLSL preamble.
fn _gpu_lerch_lgamma(s: f32) -> f32 {
  var p: f32 = 1.0;
  var x: f32 = s;
  for (var k: i32 = 0; k < 8; k = k + 1) {
    if (x >= 8.0) { break; }
    p = p * x;
    x = x + 1.0;
  }
  let x2 = x * x;
  let corr = (1.0 / 12.0 - (1.0 / 360.0 - 1.0 / (1260.0 * x2)) / x2) / x;
  return (x - 0.5) * log(x) - x + (0.91893853320467274 + corr) - log(p);
}

fn _gpu_lerch_g(z: f32, t: f32) -> f32 {
  if (z < 0.0) { return 1.0 / (1.0 - z * exp(-t)); }
  return 1.0 / ((1.0 - z) + z * _gpu_lerch_em(t));
}

// One step of the polynomials P_m of Phi(w, -m, a): see the GLSL preamble.
fn _gpu_lerch_pstep(c: ptr<function, array<f32, ${LERCH_MAX_N + 2}>>, a: f32, m: i32) {
  for (var k: i32 = m + 1; k >= 0; k = k - 1) {
    var hi: f32 = 0.0;
    var lo: f32 = 0.0;
    if (k <= m) { hi = (a + f32(k)) * (*c)[k]; }
    if (k >= 1) { lo = (f32(m + 2) - a - f32(k)) * (*c)[k - 1]; }
    (*c)[k] = hi + lo;
  }
}

// Phi(w, -n, a) without its factor v, and the sum of the moduli of its
// terms: see the GLSL preamble.
fn _gpu_lerch_poly(c: ptr<function, array<f32, ${LERCH_MAX_N + 2}>>, n: i32, u: f32, v: f32) -> vec2<f32> {
  let au = abs(u);
  let av = abs(v);
  var r = (*c)[n];
  var ra = abs((*c)[n]);
  var vp = v;
  var avp = av;
  for (var k: i32 = n - 1; k >= 0; k = k - 1) {
    r = r * u + (*c)[k] * vp;
    ra = ra * au + abs((*c)[k]) * avp;
    vp = vp * v;
    avp = avp * av;
  }
  return vec2<f32>(r, ra);
}

// Phi(z, -n, a) for an integer n, in closed form: see the GLSL preamble.
fn _gpu_lerch_rational(z: f32, n: i32, a: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  var c: array<f32, ${LERCH_MAX_N + 2}>;
  c[0] = 1.0;
  for (var m: i32 = 0; m < n; m = m + 1) { _gpu_lerch_pstep(&c, a, m); }
  let v = 1.0 / (1.0 - z);
  let q = _gpu_lerch_poly(&c, n, z * v, v);
  if (!(EPS * (f32(n + 4) * q.y) <= 3.0e-5 * abs(q.x))) { return vec2<f32>(0.0); }
  return vec2<f32>(q.x * v, 1.0);
}

// Phi(z,s,a) for z < 1 by the integral (after n integrations by parts for
// s <= 0): see the GLSL preamble.
fn _gpu_lerch_integral(z: f32, s: f32, a0: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  var n: i32 = 0;
  if (s <= 0.0) { n = i32(ceil(-s)); }
  let sn = s + f32(n);
  var n0: i32 = 0;
  if (a0 < 0.0) { n0 = i32(ceil(-a0)); }
  var head: f32 = 0.0;
  var zk: f32 = 1.0;
  var err: f32 = 0.0;
  for (var k: i32 = 0; k < n0; k = k + 1) {
    let bk = a0 + f32(k);
    let t = zk * _gpu_zeta_pow(bk, -s);
    head = head + t;
    err = err + abs(t) * (2.0 + f32(k) + abs(s * log2(abs(bk))));
    zk = zk * z;
  }
  let a = a0 + f32(n0);
  var c: array<f32, ${LERCH_MAX_N + 2}>;
  c[0] = 1.0;
  for (var m: i32 = 0; m < n; m = m + 1) { _gpu_lerch_pstep(&c, a, m); }
  let lg = _gpu_lerch_lgamma(sn);
  let lam = min(1.0, 1.0 / a);
  var delta = PI;
  if (z > 0.0) { delta = -log(z); }
  let e0 = 1e-3 * min(lam, delta);
  let la = log(a);
  let tau0 = a * e0;
  var L: f32;
  if (z < 0.0) { L = log(-z); } else { L = log(z); }
  let big = z < -1.0;
  // The shift S: see the GLSL preamble.
  var S: f32 = 0.0;
  if (big) { S = min(a, 1.0) * L; }
  var lG0: f32 = 0.0;
  var v0h = 1.0 / (1.0 - z);
  var u0 = z * v0h;
  if (big) {
    lG0 = -(L + log(1.0 + exp(-L)));
    v0h = exp(lG0);
    u0 = -exp(L + lG0);
  }
  let f0 = _gpu_lerch_poly(&c, n, u0, v0h);
  var c1 = c;
  _gpu_lerch_pstep(&c1, a, n);
  let f1 = _gpu_lerch_poly(&c1, n + 1, u0, v0h);
  var p0: f32;
  if (big) { p0 = exp(sn * log(tau0) - lg + lG0 + S); } else { p0 = exp(sn * log(tau0) - lg) * v0h; }
  let d1 = -f1.x / a;
  var sum = p0 * (f0.x / sn + d1 * tau0 / (sn + 1.0));
  var ferr = abs(p0) * ((f0.y / sn + f1.y / a * tau0 / (sn + 1.0)) * f32(n + 5)) +
    abs(sum) * (abs(sn * log(tau0)) + abs(lg) + abs(L));
  let v0 = log(e0);
  let v1 = log(lam);
  let nlog = max(1.0, ceil((v1 - v0) / 3.0));
  let hv = (v1 - v0) / nlog;
  let TG = max(L, 0.0) + 17.0;
  let tw = (sn + 30.0) / a;
  var tEnd = tw;
  if (z < 0.0) {
    if (a > 1.0) { tEnd = max(tw, min(TG, (sn + 30.0) / (a - 1.0))); } else { tEnd = max(tw, TG); }
  }
  let hW = 8.0 / a;
  var x = lam;
  for (var p: i32 = 0; p < 28; p = p + 1) {
    let logPanel = f32(p) < nlog;
    if (!logPanel && x >= tEnd) { break; }
    var w: f32;
    var cc: f32;
    if (logPanel) {
      w = hv;
      cc = v0 + (f32(p) + 0.5) * hv;
    } else {
      w = min(min(2.0 * x, hW), max(4.0 / (1.0 + 0.25 * f32(n)), 0.6 * abs(x - L)));
      cc = x + 0.5 * w;
    }
    let r = 0.5 * w;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        let u = cc + select(r, -r, j == 0) * gx[i];
        var t = u;
        var e: f32;
        var scale: f32 = a;
        if (logPanel) {
          t = exp(u);
          e = sn * (u + la);
          scale = 1.0;
        } else {
          e = (sn - 1.0) * log(a * t);
        }
        let tau = a * t;
        var vn: f32;
        var un: f32;
        var lG: f32 = 0.0;
        if (big) {
          let xs = L - t;
          lG = -(max(xs, 0.0) + log(1.0 + exp(-abs(xs))));
          vn = exp(lG);
          un = -exp(xs + lG);
        } else {
          vn = _gpu_lerch_g(z, t);
          un = z * exp(-t) * vn;
        }
        let pv = _gpu_lerch_poly(&c, n, un, vn);
        let ex = e - tau - lg;
        var f: f32;
        if (big) { f = exp(ex + lG + S); } else { f = exp(ex) * vn; }
        let q = r * gw[i] * (scale * f);
        sum = sum + q * pv.x;
        ferr = ferr + q * (abs(pv.x) * ((abs(e) + tau) + (abs(lG) + abs(L))) +
          pv.y * (f32(n + 3) + t));
      }
    }
    if (!logPanel) { x = x + w; }
  }
  if (x < tEnd) { return vec2<f32>(0.0); } // the panel budget ran out
  var scaled: f32;
  if (big) {
    scaled = select(1.0, -1.0, sum < 0.0) * exp(log(abs(sum)) - (S + sn * la));
  } else {
    scaled = pow(a, -sn) * sum;
  }
  let tail = zk * scaled;
  let res = head + tail;
  let rel = ferr / abs(sum) + (8.0 + abs(lg)) +
    ((f32(n0) + 2.0) + (abs(sn * log2(a)) + S));
  let bound = EPS * (err + abs(tail) * rel);
  if (!(bound <= 3.0e-5 * abs(res))) { return vec2<f32>(0.0); }
  return vec2<f32>(res, 1.0);
}

// h = e^x x^(-sig) Gamma(sig, x), integer sig: see the GLSL preamble.
fn _gpu_lerch_h_integer(sig: f32, x: vec2<f32>) -> vec4<f32> {
  let n = i32(sig) - 1;
  let d = x.x * x.x + x.y * x.y;
  let ir = x.x / d;
  let ii = -x.y / d;
  let ix = sqrt(ir * ir + ii * ii);
  var rr: f32 = 1.0;
  var ri: f32 = 0.0;
  var ra: f32 = 1.0;
  for (var j: i32 = 1; j <= n; j = j + 1) {
    let tr = ir * rr - ii * ri;
    let ti = ir * ri + ii * rr;
    rr = 1.0 + f32(j) * tr;
    ri = f32(j) * ti;
    ra = 1.0 + f32(j) * ix * ra;
  }
  return vec4<f32>(rr * ir - ri * ii, rr * ii + ri * ir, (f32(n) + 3.0) * ra * ix, 1.0);
}

// h for |x| < sig, by the series: see the GLSL preamble.
fn _gpu_lerch_h_series(sig: f32, x: vec2<f32>) -> vec4<f32> {
  var tr: f32 = 1.0 / sig;
  var ti: f32 = 0.0;
  var sr: f32 = tr;
  var si: f32 = 0.0;
  var sa: f32 = tr;
  var k: i32 = 1;
  for (k = 1; k < 100; k = k + 1) {
    let f = sig + f32(k);
    let nr = (tr * x.x - ti * x.y) / f;
    ti = (tr * x.y + ti * x.x) / f;
    tr = nr;
    sr = sr + tr;
    si = si + ti;
    let ta = abs(tr) + abs(ti);
    sa = sa + ta;
    if (ta < 1e-8 * (abs(sr) + abs(si))) { break; }
  }
  let er = x.x - sig * log(sqrt(x.x * x.x + x.y * x.y)) + _gpu_lerch_lgamma(sig);
  // arg x, with the imaginary axis taken explicitly (see the GLSL preamble:
  // atan2 of Apple's GPU answers the wrong branch at x.x = -0.0).
  var arg = atan2(x.y, x.x);
  if (x.x == 0.0) { arg = select(1.5707963267949, -1.5707963267949, x.y < 0.0); }
  let ei = x.y - sig * arg;
  let m = exp(er);
  return vec4<f32>(m * cos(ei) - sr, m * sin(ei) - si,
    m * (24.0 + abs(er) + abs(ei)) + (f32(k) + 3.0) * sa, 1.0);
}

// h for |x| >= sig, by the continued fraction: see the GLSL preamble.
fn _gpu_lerch_h_cf(sig: f32, x: vec2<f32>) -> vec4<f32> {
  let FPMIN = 1e-30;
  var br = x.x - sig + 1.0;
  let bi = x.y;
  var cr: f32 = 1e30;
  var ci: f32 = 0.0;
  var dd = br * br + bi * bi;
  var dr = br / dd;
  var di = -bi / dd;
  var hr = dr;
  var hi = di;
  for (var i: i32 = 1; i < 200; i = i + 1) {
    let an = -f32(i) * (f32(i) - sig);
    br = br + 2.0;
    dr = an * dr + br;
    di = an * di + bi;
    if (abs(dr) + abs(di) < FPMIN) { dr = FPMIN; }
    let cc = cr * cr + ci * ci;
    cr = br + an * cr / cc;
    ci = bi - an * ci / cc;
    if (abs(cr) + abs(ci) < FPMIN) { cr = FPMIN; }
    dd = dr * dr + di * di;
    dr = dr / dd;
    di = -di / dd;
    let er = dr * cr - di * ci;
    let ei = dr * ci + di * cr;
    let nr = hr * er - hi * ei;
    hi = hr * ei + hi * er;
    hr = nr;
    if (abs(er - 1.0) + abs(ei) < 1e-7) {
      return vec4<f32>(hr, hi, 35.0 * sqrt(hr * hr + hi * hi), 1.0);
    }
  }
  return vec4<f32>(0.0);
}

// Phi(z,s,a) for s <= 0 by the Hermite-type representation: see the GLSL
// preamble.
fn _gpu_lerch_hermite(z: f32, s: f32, a: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let PI = 3.14159265358979;
  let gx = array<f32, 4>(0.1834346424956498, 0.5255324099163290,
    0.7966664774136267, 0.9602898564975363);
  let gw = array<f32, 4>(0.3626837833783620, 0.3137066458778873,
    0.2223810344533745, 0.1012285362903763);
  if (s < -30.0) { return vec2<f32>(0.0); }
  var m: i32 = 0;
  if (a < 1.0) { m = i32(ceil(1.0 - a)); }
  var head: f32 = 0.0;
  var zk: f32 = 1.0;
  var err: f32 = 0.0;
  for (var k: i32 = 0; k < m; k = k + 1) {
    let bk = a + f32(k);
    if (bk != 0.0) {
      let t = zk * _gpu_zeta_pow(bk, -s);
      head = head + t;
      err = err + abs(t) * (2.0 + f32(k) + abs(s * log2(abs(bk))));
    }
    zk = zk * z;
  }
  let b = a + f32(m);
  let L = log(abs(z));
  let sig = 1.0 - s;
  var xi: f32 = 0.0;
  if (z < 0.0) { xi = -b * PI; }
  let x = vec2<f32>(-b * L, xi);
  var h: vec4<f32>;
  if (sig == floor(sig)) {
    h = _gpu_lerch_h_integer(sig, x);
  } else if (sqrt(x.x * x.x + x.y * x.y) < sig) {
    h = _gpu_lerch_h_series(sig, x);
  } else {
    h = _gpu_lerch_h_cf(sig, x);
  }
  if (h.w < 0.5) { return vec2<f32>(0.0); }
  let t1 = 0.5 * pow(b, -s);
  let bs = pow(b, sig);
  let t2 = bs * h.x;
  let t2abs = bs * (abs(h.x) + abs(h.y)); // no square: see the GLSL preamble
  let q3 = max(-s, 0.0);
  let t3end = (21.0 + q3 * log(1.0 + (q3 + 7.0) / b)) / PI;
  let n3 = ceil(t3end / min(1.5, 4.0 / max(abs(L), 1e-3)));
  if (n3 > 16.0) { return vec2<f32>(0.0); }
  let h3 = t3end / n3;
  var t3: f32 = 0.0;
  var a3: f32 = 0.0;
  let b2 = b * b;
  for (var p: i32 = 0; p < 16; p = p + 1) {
    if (f32(p) >= n3) { break; }
    let c = (f32(p) + 0.5) * h3;
    let r = 0.5 * h3;
    for (var i: i32 = 0; i < 4; i = i + 1) {
      for (var j: i32 = 0; j < 2; j = j + 1) {
        let t = c + select(r, -r, j == 0) * gx[i];
        let y = 2.0 * PI * t;
        let q = exp(-y);
        let omq = _gpu_lerch_em(y);
        var K = q / omq;
        if (z < 0.0) { K = exp(-PI * t) * (1.0 + q) / (2.0 * omq); }
        let f = sin(t * L - s * atan(t / b)) *
          exp(-0.5 * s * log(b2 + t * t)) * K;
        let wf = r * gw[i] * f;
        t3 = t3 + wf;
        a3 = a3 + abs(wf) * ((6.0 + 10.0 * t) +
          (abs(s) * (2.0 + 0.5 * log2(b2 + t * t)) + abs(t * L)));
      }
    }
  }
  t3 = -2.0 * t3;
  a3 = 2.0 * a3;
  let phi = t1 + t2 + t3;
  let res = head + zk * phi;
  let e1 = t1 * (2.0 + abs(s * log2(b)));
  let e2 = t2abs * (2.0 + abs(sig * log2(b))) + bs * h.z;
  let ephi = (e1 + e2) + (a3 + 3.0 * (t1 + t2abs + abs(t3)));
  let bound = EPS * (err + abs(zk) * (ephi + (f32(m) + 2.0) * abs(phi)) + abs(res));
  if (!(bound <= 3.0e-5 * abs(res))) { return vec2<f32>(0.0); }
  return vec2<f32>(res, 1.0);
}

// Phi(z,s,a) for s <= 0: the integral after n integrations by parts, then
// the Hermite form (see the GLSL preamble).
fn _gpu_lerch_negative(z: f32, s: f32, a: f32) -> vec2<f32> {
  if (s != floor(s) && a > 0.0 && s >= -${LERCH_MAX_N}.0) {
    let r = _gpu_lerch_integral(z, s, a);
    if (r.y > 0.5) { return r; }
  }
  return _gpu_lerch_hermite(z, s, a);
}

// Phi(z,s,a) as vec2(value, 1), or vec2(0, 0): see the GLSL preamble.
fn _gpu_lerch_core(z: f32, s: f32, a: f32) -> vec2<f32> {
  if (z == 1.0) { return vec2<f32>(_gpu_hurwitz_zeta(s, a), 1.0); }
  if (z == 0.0) { return vec2<f32>(_gpu_zeta_pow(a, -s), 1.0); }
  if (s == 0.0) { return vec2<f32>(1.0 / (1.0 - z), 1.0); }
  if (s < 0.0 && s == floor(s) && s >= -${LERCH_MAX_N}.0) {
    let q = _gpu_lerch_rational(z, i32(-s), a);
    if (q.y > 0.5) { return q; }
  }
  let aNonposInt = a <= 0.0 && a == floor(a);
  if (aNonposInt && s > 0.0) { return vec2<f32>(_gpu_inf(), 1.0); }
  if (a < 0.0 && s != floor(s)) { return vec2<f32>(0.0); }
  if (a < -1.0e6) { return vec2<f32>(0.0); }
  if (z > 1.0) {
    if (s > 0.0 || s != floor(s)) { return vec2<f32>(0.0); }
    return _gpu_lerch_hermite(z, s, a);
  }
  if (z < -1.0) {
    if (s > 0.0) { return _gpu_lerch_integral(z, s, a); }
    return _gpu_lerch_negative(z, s, a);
  }
  if (z < 0.0 && s > 0.0) {
    let e = _gpu_lerch_euler(z, s, a);
    if (e.y > 0.5) { return e; }
    return _gpu_lerch_integral(z, s, a);
  }
  if (z == -1.0) { return _gpu_lerch_negative(z, s, a); }
  let r = _gpu_lerch_series(z, s, a);
  if (r.y > 0.5) { return r; }
  if (s > 0.0) { return _gpu_lerch_integral(z, s, a); }
  return _gpu_lerch_negative(z, s, a);
}

// Phi(z, s, a) for z < 0 and -30 <= s <= -3 from the Fourier modes of the
// base point: see the GLSL preamble.
fn _gpu_lerch_modes(z: f32, s: f32, a: f32, c: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let FLUSH = 2.0e-31; // 1.18e-38 / EPS
  let PI = 3.14159265358979;
  if (s < -30.0 || abs(a) >= 100.0) { return vec2<f32>(0.0); }
  var b = a;
  var pre: f32 = 0.0;
  var post: f32 = 0.0;
  if (a <= 0.0) {
    pre = floor(-a) + 1.0;
    b = a + pre;
  } else if (a > 1.0) {
    post = ceil(a) - 1.0;
    b = a - post;
  }
  var head: f32 = 0.0;
  var herr: f32 = 0.0;
  var zk: f32 = 1.0;
  for (var j: i32 = 0; j < 128; j = j + 1) {
    if (f32(j) >= pre) { break; }
    let bj = a + f32(j);
    if (bj != 0.0) {
      let t = zk * _gpu_zeta_pow(bj, -s);
      head = head + t;
      herr = herr + abs(t) * (3.0 + f32(j) + abs(s * log2(abs(bj))));
    }
    zk = zk * z;
  }
  let L = log(-z);
  let sm1 = s - 1.0;
  let hs = 0.5 * sm1;
  let ps = hs - 2.0 * floor(0.5 * hs); // (s-1)/2 modulo 2
  let L2 = L * L;
  let lr1 = log(L2 + PI * PI);
  var sum: f32 = 0.0;
  var err: f32 = 0.0;
  var tail: f32 = 0.0;
  for (var n: i32 = 1; n <= 128; n = n + 1) {
    let m = f32(2 * n - 1);
    let x = PI * m;
    let lr = log(L2 + x * x);
    let at = atan(L / x) / PI;
    let bm = b * m;
    let P = (bm - 2.0 * floor(0.5 * bm)) + ps + sm1 * at;
    let k = floor(P + 0.5);
    var cs = cos(PI * (P - k));
    if ((k % 2.0) != 0.0) { cs = -cs; }
    let ex = hs * (lr - lr1);
    let mag = exp(ex);
    let t = mag * cs;
    sum = sum + t;
    err = err + abs(t) * (4.0 + abs(ex)) +
      mag * (abs(hs) * (abs(lr) + abs(lr1)) + PI * (abs(P) + abs(sm1) * abs(at) + b * m));
    tail = mag * m / (-2.0 * s);
    if (tail <= 1e-9) { break; }
  }
  let lg = _gpu_lerch_lgamma(1.0 - s);
  let scale = 2.0 * exp(lg + hs * lr1 - (b - c) * L);
  var phib = scale * sum;
  if (!(scale < 3.4e38 && abs(phib) < 3.4e38)) { return vec2<f32>(0.0); }
  var eb = scale * (err + tail / EPS + 4.0 * abs(sum)) +
    abs(phib) * (abs(lg) + abs(hs * lr1) + abs((b - c) * L) + 12.0);
  if (scale < 1.18e-38 || abs(phib) < 1.18e-38) { eb = eb + FLUSH * (1.0 + abs(sum)); }
  if (c > 0.5) { phib = -phib; } // z = -e^L
  var res: f32;
  var rerr: f32;
  if (post > 0.0) {
    var acc = phib;
    var aerr = eb;
    var zj: f32 = 1.0;
    for (var j: i32 = 0; j < 128; j = j + 1) {
      if (f32(j) >= post) { break; }
      let bj = b + f32(j);
      let t = zj * pow(bj, -s);
      acc = acc - t;
      aerr = aerr + abs(t) * (3.0 + f32(j) + abs(s * log2(bj)));
      zj = zj * z;
    }
    let zinv = pow(-z, -post);
    if (!(zinv >= 1.18e-38 && zinv < 3.4e38 && abs(acc) >= 1.18e-38 && abs(acc) < 3.4e38)) {
      return vec2<f32>(0.0);
    }
    var sg: f32 = -1.0;
    if ((post % 2.0) == 0.0) { sg = 1.0; }
    res = sg * zinv * acc;
    rerr = zinv * (aerr + abs(acc) * (post + 2.0)) + abs(res) * abs(post * log2(-z));
  } else {
    if (!(abs(zk) >= 1.18e-38 && abs(zk) < 3.4e38)) { return vec2<f32>(0.0); }
    res = head + zk * phib;
    rerr = herr + abs(zk) * (eb + abs(phib) * (pre + 2.0));
  }
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) || !(rerr <= 500.0 * abs(res))) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(res, 1.0);
}

// The Fourier modes last, where every other method declines — see the GLSL
// preamble.
fn _gpu_lerch_phi(z: f32, s: f32, a: f32) -> f32 {
  let r = _gpu_lerch_core(z, s, a);
  if (r.y > 0.5) { return r.x; }
  if (z < 0.0 && s <= -3.0 && !(a < 0.0 && s != floor(s))) {
    let q = _gpu_lerch_modes(z, s, a, 0.0);
    if (q.y > 0.5) { return q.x; }
  }
  return _gpu_nan();
}

// Li_s(z) for z < -1 and a negative non-integer s, by Jonquiere's
// inversion formula: see the GLSL preamble.
fn _gpu_poly_log_inversion(s: f32, z: f32) -> vec2<f32> {
  let EPS = 6.0e-8;
  let FLUSH = 2.0e-31; // 1.18e-38 / EPS
  let PI = 3.14159265358979;
  let B = array<f32, 8>(1.0 / 6.0, -1.0 / 30.0, 1.0 / 42.0, -1.0 / 30.0,
    5.0 / 66.0, -691.0 / 2730.0, 7.0 / 6.0, -3617.0 / 510.0);
  let ai = -log(-z) / (2.0 * PI);
  let sig = 1.0 - s;
  var zr: f32 = 0.0;
  var zi: f32 = 0.0;
  var zerr: f32 = 0.0;
  for (var k: i32 = 0; k < 12; k = k + 1) {
    let wk = 0.5 + f32(k);
    let lnwk = 0.5 * log(wk * wk + ai * ai);
    let ph = -sig * atan2(ai, wk);
    let m = exp(-sig * lnwk);
    zr = zr + m * cos(ph);
    zi = zi + m * sin(ph);
    zerr = zerr + m * (4.0 + abs(sig * lnwk) + abs(ph));
  }
  let wr = 12.5;
  let lnw = 0.5 * log(wr * wr + ai * ai);
  let th = atan2(ai, wr);
  // w^(1 - sig) / (sig - 1), from s itself (see the GLSL preamble).
  let m1 = exp(s * lnw) / -s;
  let p1 = s * th;
  zr = zr + m1 * cos(p1);
  zi = zi + m1 * sin(p1);
  zerr = zerr + abs(m1) * (4.0 + abs(s * lnw) + abs(p1));
  let m0 = exp(-sig * lnw);
  let p0 = -sig * th;
  zr = zr + 0.5 * m0 * cos(p0);
  zi = zi + 0.5 * m0 * sin(p0);
  zerr = zerr + 0.5 * m0 * (4.0 + abs(sig * lnw) + abs(p0));
  let mu1 = exp((-sig - 1.0) * lnw);
  let pu1 = (-sig - 1.0) * th;
  var ur = sig / 2.0 * mu1 * cos(pu1);
  var ui = sig / 2.0 * mu1 * sin(pu1);
  let w2r = wr * wr - ai * ai;
  let w2i = 2.0 * wr * ai;
  let w2d = w2r * w2r + w2i * w2i;
  let iw2r = w2r / w2d;
  let iw2i = -w2i / w2d;
  var prev: f32 = 3.0e38;
  for (var j: i32 = 1; j <= 8; j = j + 1) {
    let tr = ur * B[j - 1];
    let ti = ui * B[j - 1];
    let ta = abs(tr) + abs(ti);
    if (ta >= prev) { break; }
    zr = zr + tr;
    zi = zi + ti;
    zerr = zerr + ta * (10.0 + abs(sig * lnw));
    prev = ta;
    let mm = f32(2 * j);
    let c = (sig + mm - 1.0) * (sig + mm) / ((mm + 1.0) * (mm + 2.0));
    let nr = c * (ur * iw2r - ui * iw2i);
    ui = c * (ur * iw2i + ui * iw2r);
    ur = nr;
  }
  zerr = zerr + 44.0 * FLUSH; // at most 22 terms in each of zr and zi
  let n = floor(s + 0.5);
  let d = s - n;
  let sgn = select(-1.0, 1.0, n % 2.0 == 0.0);
  let lg1 = _gpu_lerch_lgamma(sig);
  let fm = sgn * sin(PI * d) * exp(s * log(2.0 * PI) + lg1) / PI;
  let fre = fm * cos(0.5 * PI * s);
  let fim = fm * sin(0.5 * PI * s);
  let first = fre * zr - fim * zi;
  let firstErr = abs(fm) * zerr +
    abs(fm) * sqrt(zr * zr + zi * zi) * (30.0 + abs(lg1) + abs(s * 2.7));
  let iz = 1.0 / z;
  var li: f32 = 0.0;
  var lierr: f32 = 0.0;
  if (iz >= -0.5) {
    var wk: f32 = 1.0;
    var prevT: f32 = 3.0e38;
    var done = false;
    for (var k: i32 = 1; k < 200; k = k + 1) {
      wk = wk * iz;
      let t = wk * pow(f32(k), -s);
      li = li + t;
      let size = abs(t);
      lierr = lierr + size * (2.0 + f32(k) + abs(s * log2(f32(k)))) + FLUSH;
      let rho = -iz * pow(f32(k + 1) / f32(k), -s);
      if (size < prevT && rho < 1.0 && size * rho / (1.0 - rho) <= 1e-8 * abs(li)) {
        done = true;
        break;
      }
      prevT = size;
    }
    if (!done) { return vec2<f32>(0.0); }
  } else {
    let inner = _gpu_lerch_negative(iz, s, 1.0);
    if (inner.y < 0.5) { return vec2<f32>(0.0); }
    li = iz * inner.x;
    lierr = 500.0 * abs(li);
  }
  let res = first - sgn * cos(PI * d) * li;
  let bound = ((firstErr + 4.0 * abs(first)) + (lierr + 2.0 * abs(li))) + 4.0 * FLUSH;
  if (!(abs(res) >= 1.18e-38 && abs(res) < 3.4e38) || !(bound <= 500.0 * abs(res))) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(res, 1.0);
}

// PolyLog(s, z): see _gpu_poly_log in GPU_LERCH_PREAMBLE_GLSL for the
// cases (closed forms for the orders 1, 0, -1 and -2 ... -12, then
// z * Phi(z, s, 1), then the inversion formula).
fn _gpu_poly_log(s: f32, z: f32) -> f32 {
  if (z == 0.0) { return 0.0; }
  if (s == 1.0) {
    if (z == 1.0) { return _gpu_inf(); }
    if (z < 1.0) { return -log(1.0 - z); }
    return _gpu_nan();
  }
  if (s == 0.0) {
    if (z == 1.0) { return _gpu_inf(); }
    return z / (1.0 - z);
  }
  if (s == -1.0) {
    if (z == 1.0) { return _gpu_inf(); }
    return z / ((1.0 - z) * (1.0 - z));
  }
  if (s <= -2.0 && s >= -12.0 && s == floor(s) && z != 1.0) {
    let n = i32(-s);
    var row: array<f32, 13>;
    row[0] = 1.0;
    for (var i: i32 = 1; i < 13; i = i + 1) { row[i] = 0.0; }
    for (var m: i32 = 1; m <= n; m = m + 1) {
      for (var k: i32 = m - 1; k >= 1; k = k - 1) {
        row[k] = f32(k + 1) * row[k] + f32(m - k) * row[k - 1];
      }
    }
    if (abs(z) > 1.0) {
      let v = 1.0 / (1.0 - z);
      let u = z * v;
      var r = row[n - 1];
      var vp = v;
      for (var k: i32 = n - 2; k >= 0; k = k - 1) {
        r = r * u + row[k] * vp;
        vp = vp * v;
      }
      return u * v * r;
    }
    var p: f32 = 0.0;
    for (var k: i32 = n - 1; k >= 0; k = k - 1) { p = p * z + row[k]; }
    var den: f32 = 1.0;
    for (var i: i32 = 0; i <= n; i = i + 1) { den = den * (1.0 - z); }
    return z * p / den;
  }
  // Below z = -1 a small Phi(z, s, 1) is left to the inversion and the
  // modes: see the GLSL preamble.
  let r = _gpu_lerch_core(z, s, 1.0);
  if (r.y > 0.5 && (z >= -1.0 || (abs(r.x) >= 3.9e-34 && abs(z * r.x) < 3.4e38))) {
    return z * r.x;
  }
  if (z < -1.0 && s < 0.0 && s != floor(s)) {
    let v = _gpu_poly_log_inversion(s, z);
    if (v.y > 0.5) { return v.x; }
  }
  if (z < 0.0 && s <= -3.0) {
    let q = _gpu_lerch_modes(z, s, 1.0, 1.0);
    if (q.y > 0.5) { return q.x; }
  }
  return _gpu_nan();
}
`;

/**
 * GPU error function using Abramowitz & Stegun approximation.
 * Maximum error: |epsilon(x)| <= 1.5e-7. GLSL syntax.
 */
export const GPU_ERF_PREAMBLE_GLSL = `
float _gpu_erf(float x) {
  float ax = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * ax);
  float y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  float result = 1.0 - y * exp(-ax * ax);
  return x < 0.0 ? -result : result;
}

float _gpu_erfinv(float x) {
  float pi = 3.14159265358979;
  float x2 = x * x;
  float x3 = x * x2;
  float x5 = x3 * x2;
  float x7 = x5 * x2;
  float x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU error function preamble (WGSL syntax). See GPU_GAMMA_PREAMBLE_WGSL.
 */
export const GPU_ERF_PREAMBLE_WGSL = `
fn _gpu_erf(x: f32) -> f32 {
  let ax = abs(x);
  let t = 1.0 / (1.0 + 0.3275911 * ax);
  let y = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  let result = 1.0 - y * exp(-ax * ax);
  if (x < 0.0) { return -result; }
  return result;
}

fn _gpu_erfinv(x: f32) -> f32 {
  let pi = 3.14159265358979;
  let x2 = x * x;
  let x3 = x * x2;
  let x5 = x3 * x2;
  let x7 = x5 * x2;
  let x9 = x7 * x2;
  return sqrt(pi) * 0.5 * (x + (pi / 12.0) * x3 + (7.0 * pi * pi / 480.0) * x5 + (127.0 * pi * pi * pi / 40320.0) * x7 + (4369.0 * pi * pi * pi * pi / 5806080.0) * x9);
}
`;

/**
 * GPU Heaviside step function preamble (GLSL syntax).
 * Returns 0 for x<0, 0.5 at x=0, 1 for x>0.
 *
 * A NaN argument falls through both comparisons (they are false for NaN), so
 * the final arm adds `0.0 * x`: for the values that reach it — `0`, `-0.0`
 * and NaN — the product is `0` or NaN, so the arm answers `0.5` exactly for
 * a zero and propagates NaN for NaN (Contract B `propagate`, ratified
 * 2026-08-27). The infinities never reach the arm (the comparisons catch
 * them), so the `0·∞` indeterminate case cannot arise here. `isnan` is
 * deliberately not used — it is unreliable under fast-math (see the absence
 * capability note on the target) — and the same fast-math caveat applies to
 * this arithmetic carrier: a driver that folds `0.0 * x` to `0.0` degrades
 * NaN back to `0.5`, which is best-effort by design on shader targets.
 */
export const GPU_HEAVISIDE_PREAMBLE_GLSL = `
float _gpu_heaviside(float x) {
  if (x < 0.0) return 0.0;
  if (x > 0.0) return 1.0;
  return 0.5 + 0.0 * x;
}
`;

/**
 * GPU Heaviside step function preamble (WGSL syntax).
 * Same NaN-propagating final arm as the GLSL preamble above.
 */
export const GPU_HEAVISIDE_PREAMBLE_WGSL = `
fn _gpu_heaviside(x: f32) -> f32 {
  if (x < 0.0) { return 0.0; }
  if (x > 0.0) { return 1.0; }
  return 0.5 + 0.0 * x;
}
`;

/**
 * GPU sinc function preamble (GLSL syntax).
 * sinc(x) = sin(x)/x, sinc(0) = 1.
 */
export const GPU_SINC_PREAMBLE_GLSL = `
float _gpu_sinc(float x) {
  if (abs(x) < 1e-10) return 1.0;
  return sin(x) / x;
}
`;

/**
 * GPU sinc function preamble (WGSL syntax).
 */
export const GPU_SINC_PREAMBLE_WGSL = `
fn _gpu_sinc(x: f32) -> f32 {
  if (abs(x) < 1e-10) { return 1.0; }
  return sin(x) / x;
}
`;

/**
 * GPU Horner polynomial evaluation helper (GLSL syntax).
 * Shared by FresnelC and FresnelS preambles.
 */
export const GPU_POLEVL_PREAMBLE_GLSL = `
float _gpu_polevl(float x, float c[12], int n) {
  float ans = c[0];
  for (int i = 1; i < n; i++) ans = ans * x + c[i];
  return ans;
}
`;

/**
 * GPU Horner polynomial evaluation helper (WGSL syntax).
 */
export const GPU_POLEVL_PREAMBLE_WGSL = `
fn _gpu_polevl(x: f32, c: array<f32, 12>, n: i32) -> f32 {
  var ans = c[0];
  for (var i: i32 = 1; i < n; i++) { ans = ans * x + c[i]; }
  return ans;
}
`;

/**
 * GPU Fresnel cosine integral preamble (GLSL syntax).
 *
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions:
 * |x|<1.6, 1.6<=|x|<36, |x|>=36.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_GLSL = `
float _gpu_fresnelC(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float cn[6] = float[6](
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1
    );
    float cd[7] = float[7](
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel cosine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELC_PREAMBLE_WGSL = `
fn _gpu_fresnelC(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var cn = array<f32, 12>(
      -4.98843114573573548651e-8, 9.50428062829859605134e-6,
      -6.45191435683965050962e-4, 1.88843319396703850064e-2,
      -2.05525900955013891793e-1, 9.99999999999999998822e-1,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var cd = array<f32, 12>(
      3.99982968972495980367e-12, 9.15439215774657478799e-10,
      1.25001862479598821474e-7, 1.22262789024179030997e-5,
      8.68029542941784300606e-4, 4.12142090722199792936e-2, 1.0,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * _gpu_polevl(t, cn, 6) / _gpu_polevl(t, cd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 + (f * s - g * c) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (GLSL syntax).
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt.
 * Uses rational Chebyshev approximation (Cephes/scipy) with three regions.
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_GLSL = `
float _gpu_fresnelS(float x_in) {
  float sgn = x_in < 0.0 ? -1.0 : 1.0;
  float x = abs(x_in);

  if (x < 1.6) {
    float x2 = x * x;
    float t = x2 * x2;
    float sn[6] = float[6](
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11
    );
    float sd[7] = float[7](
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    float x2 = x * x;
    float t = 3.14159265358979 * x2;
    float u = 1.0 / (t * t);
    float fn[10] = float[10](
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20
    );
    float fd[11] = float[11](
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20
    );
    float gn[11] = float[11](
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22
    );
    float gd[12] = float[12](
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    float f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    float g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    float z = 1.5707963267948966 * x2;
    float c = cos(z);
    float s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Fresnel sine integral preamble (WGSL syntax).
 * Requires _gpu_polevl preamble.
 */
export const GPU_FRESNELS_PREAMBLE_WGSL = `
fn _gpu_fresnelS(x_in: f32) -> f32 {
  let sgn: f32 = select(1.0, -1.0, x_in < 0.0);
  let x = abs(x_in);

  if (x < 1.6) {
    let x2 = x * x;
    let t = x2 * x2;
    var sn = array<f32, 12>(
      -2.99181919401019853726e3, 7.08840045257738576863e5,
      -6.29741486205862506537e7, 2.54890880573376359104e9,
      -4.42979518059697779103e10, 3.18016297876567817986e11,
      0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    );
    var sd = array<f32, 12>(
      1.0, 2.81376268889994315696e2, 4.55847810806532581675e4,
      5.1734388877009640073e6, 4.19320245898111231129e8, 2.2441179564534092094e10,
      6.07366389490084914091e11,
      0.0, 0.0, 0.0, 0.0, 0.0
    );
    return sgn * x * x2 * _gpu_polevl(t, sn, 6) / _gpu_polevl(t, sd, 7);
  }

  if (x < 36.0) {
    let x2 = x * x;
    let t = 3.14159265358979 * x2;
    let u = 1.0 / (t * t);
    var fn = array<f32, 12>(
      4.21543555043677546506e-1, 1.43407919780758885261e-1,
      1.15220955073585758835e-2, 3.450179397825740279e-4,
      4.63613749287867322088e-6, 3.05568983790257605827e-8,
      1.02304514164907233465e-10, 1.72010743268161828879e-13,
      1.34283276233062758925e-16, 3.76329711269987889006e-20,
      0.0, 0.0
    );
    var fd = array<f32, 12>(
      1.0, 7.51586398353378947175e-1,
      1.16888925859191382142e-1, 6.44051526508858611005e-3,
      1.55934409164153020873e-4, 1.8462756734893054587e-6,
      1.12699224763999035261e-8, 3.60140029589371370404e-11,
      5.8875453362157841001e-14, 4.52001434074129701496e-17,
      1.25443237090011264384e-20, 0.0
    );
    var gn = array<f32, 12>(
      5.04442073643383265887e-1, 1.97102833525523411709e-1,
      1.87648584092575249293e-2, 6.84079380915393090172e-4,
      1.15138826111884280931e-5, 9.82852443688422223854e-8,
      4.45344415861750144738e-10, 1.08268041139020870318e-12,
      1.37555460633261799868e-15, 8.36354435630677421531e-19,
      1.86958710162783235106e-22, 0.0
    );
    var gd = array<f32, 12>(
      1.0, 1.47495759925128324529,
      3.37748989120019970451e-1, 2.53603741420338795122e-2,
      8.14679107184306179049e-4, 1.27545075667729118702e-5,
      1.04314589657571990585e-7, 4.60680728146520428211e-10,
      1.10273215066240270757e-12, 1.38796531259578871258e-15,
      8.39158816283118707363e-19, 1.86958710162783236342e-22
    );
    let f = 1.0 - u * _gpu_polevl(u, fn, 10) / _gpu_polevl(u, fd, 11);
    let g = (1.0 / t) * _gpu_polevl(u, gn, 11) / _gpu_polevl(u, gd, 12);
    let z = 1.5707963267948966 * x2;
    let c = cos(z);
    let s = sin(z);
    return sgn * (0.5 - (f * c + g * s) / (3.14159265358979 * x));
  }

  return sgn * 0.5;
}
`;

/**
 * GPU Bessel J function preamble (GLSL syntax).
 *
 * J_n(x) for integer order n. Uses three algorithms:
 * - Power series for small x (x < 5+n)
 * - Hankel asymptotic for large x (x > 25+n^2/2)
 * - Miller's backward recurrence for intermediate x
 */
export const GPU_BESSELJ_PREAMBLE_GLSL = `
float _gpu_factorial(int n) {
  float f = 1.0;
  for (int i = 2; i <= n; i++) f *= float(i);
  return f;
}

float _gpu_besselJ_series(int n, float x) {
  float halfX = x / 2.0;
  float negQ = -(x * x) / 4.0;
  float term = 1.0;
  for (int i = 1; i <= n; i++) term /= float(i);
  float s = term;
  for (int k = 1; k <= 60; k++) {
    term *= negQ / (float(k) * float(n + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) break;
  }
  return s * pow(halfX, float(n));
}

float _gpu_besselJ_asymptotic(int n, float x) {
  float mu = 4.0 * float(n) * float(n);
  float P = 1.0;
  float Q = 0.0;
  float ak = 1.0;
  float e8x = 8.0 * x;
  for (int k = 1; k <= 12; k++) {
    float twokm1 = float(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    float denom = _gpu_factorial(k) * pow(e8x, float(k));
    float contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) Q += contrib;
      else Q -= contrib;
    } else {
      if ((k / 2) % 2 == 1) P -= contrib;
      else P += contrib;
    }
    if (abs(contrib) < 1e-7) break;
  }
  float chi = x - (float(n) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

float _gpu_besselJ(int n, float x) {
  if (x == 0.0) return n == 0 ? 1.0 : 0.0;
  float sgn = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) sgn = -1.0;
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) sgn *= -1.0;
  }
  if (x > 25.0 + float(n * n) / 2.0) return sgn * _gpu_besselJ_asymptotic(n, x);
  if (x < 5.0 + float(n)) return sgn * _gpu_besselJ_series(n, x);
  int M = max(n + 20, int(ceil(x)) + 30);
  if (M > 200) return sgn * _gpu_besselJ_series(n, x);
  float vals[201];
  float jp1 = 0.0;
  float jk = 1.0;
  vals[M] = jk;
  for (int k = M; k >= 1; k--) {
    float jm1 = (2.0 * float(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  float norm = vals[0];
  for (int k = 2; k <= M; k += 2) norm += 2.0 * vals[k];
  return sgn * vals[n] / norm;
}
`;

/**
 * GPU Bessel J function preamble (WGSL syntax).
 */
export const GPU_BESSELJ_PREAMBLE_WGSL = `
fn _gpu_factorial(n: i32) -> f32 {
  var f: f32 = 1.0;
  for (var i: i32 = 2; i <= n; i++) { f *= f32(i); }
  return f;
}

fn _gpu_besselJ_series(n_in: i32, x: f32) -> f32 {
  let halfX = x / 2.0;
  let negQ = -(x * x) / 4.0;
  var term: f32 = 1.0;
  for (var i: i32 = 1; i <= n_in; i++) { term /= f32(i); }
  var s = term;
  for (var k: i32 = 1; k <= 60; k++) {
    term *= negQ / (f32(k) * f32(n_in + k));
    s += term;
    if (abs(term) < abs(s) * 1e-7) { break; }
  }
  return s * pow(halfX, f32(n_in));
}

fn _gpu_besselJ_asymptotic(n_in: i32, x: f32) -> f32 {
  let mu = 4.0 * f32(n_in) * f32(n_in);
  var P: f32 = 1.0;
  var Q: f32 = 0.0;
  var ak: f32 = 1.0;
  let e8x = 8.0 * x;
  for (var k: i32 = 1; k <= 12; k++) {
    let twokm1 = f32(2 * k - 1);
    ak *= mu - twokm1 * twokm1;
    let denom = _gpu_factorial(k) * pow(e8x, f32(k));
    let contrib = ak / denom;
    if (k == 1 || k == 3 || k == 5 || k == 7 || k == 9 || k == 11) {
      if (((k - 1) / 2) % 2 == 0) { Q += contrib; }
      else { Q -= contrib; }
    } else {
      if ((k / 2) % 2 == 1) { P -= contrib; }
      else { P += contrib; }
    }
    if (abs(contrib) < 1e-7) { break; }
  }
  let chi = x - (f32(n_in) / 2.0 + 0.25) * 3.14159265358979;
  return sqrt(2.0 / (3.14159265358979 * x)) * (P * cos(chi) - Q * sin(chi));
}

fn _gpu_besselJ(n_in: i32, x_in: f32) -> f32 {
  var n = n_in;
  var x = x_in;
  if (x == 0.0) { return select(0.0, 1.0, n == 0); }
  var sgn: f32 = 1.0;
  if (n < 0) {
    n = -n;
    if (n % 2 != 0) { sgn = -1.0; }
  }
  if (x < 0.0) {
    x = -x;
    if (n % 2 != 0) { sgn *= -1.0; }
  }
  if (x > 25.0 + f32(n * n) / 2.0) { return sgn * _gpu_besselJ_asymptotic(n, x); }
  if (x < 5.0 + f32(n)) { return sgn * _gpu_besselJ_series(n, x); }
  var M = max(n + 20, i32(ceil(x)) + 30);
  if (M > 200) { return sgn * _gpu_besselJ_series(n, x); }
  var vals: array<f32, 201>;
  var jp1: f32 = 0.0;
  var jk: f32 = 1.0;
  vals[M] = jk;
  for (var k: i32 = M; k >= 1; k--) {
    let jm1 = (2.0 * f32(k) / x) * jk - jp1;
    jp1 = jk;
    jk = jm1;
    vals[k - 1] = jk;
  }
  var norm = vals[0];
  for (var k2: i32 = 2; k2 <= M; k2 += 2) { norm += 2.0 * vals[k2]; }
  return sgn * vals[n] / norm;
}
`;

/**
 * Fractal preamble (GLSL syntax).
 *
 * Smooth escape-time iteration for Mandelbrot and Julia sets.
 * Both functions return a normalized float in [0, 1] with smooth coloring
 * (log2(log2(|z|²)) formula) to avoid banding.
 */
export const GPU_FRACTAL_PREAMBLE_GLSL = `
float _fractal_mandelbrot(vec2 c, int maxIter) {
  vec2 z = vec2(0.0, 0.0);
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}

float _fractal_julia(vec2 z, vec2 c, int maxIter) {
  for (int i = 0; i < maxIter; i++) {
    z = vec2(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0)
      return clamp((float(i) - log2(log2(dot(z, z))) + 4.0) / float(maxIter), 0.0, 1.0);
  }
  return 1.0;
}
`;

/**
 * Fractal preamble (WGSL syntax).
 */
export const GPU_FRACTAL_PREAMBLE_WGSL = `
fn _fractal_mandelbrot(c: vec2f, maxIter: i32) -> f32 {
  var z = vec2f(0.0, 0.0);
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}

fn _fractal_julia(z_in: vec2f, c: vec2f, maxIter: i32) -> f32 {
  var z = z_in;
  for (var i: i32 = 0; i < maxIter; i++) {
    z = vec2f(z.x*z.x - z.y*z.y + c.x, 2.0*z.x*z.y + c.y);
    if (dot(z, z) > 4.0) {
      return clamp((f32(i) - log2(log2(dot(z, z))) + 4.0) / f32(maxIter), 0.0, 1.0);
    }
  }
  return 1.0;
}
`;

// ─── Statistical preambles ────────────────────────────────────────────────────

/**
 * GPU GCD preamble (GLSL syntax).
 * Tolerant floating Euclidean algorithm: terminates when the remainder falls
 * below `ε · max(|a|, |b|)` (ε = 1e-6, the f32 float-GCD tolerance) rather than
 * exact zero, so it handles non-integer reals (e.g. Desmos-style
 * `gcd(θ², θ+a)`) as well as integer-valued inputs.
 *
 * Integer inputs within the f32 exact-integer range (< 2^24) take a plain
 * Euclid path with no tolerance — mirrors the JS realGcd so integer inputs
 * never regress (e.g. `_gpu_gcd(4000000.0, 2.0) == 2.0`). The final
 * scale-mismatch guard keeps the result <= min(|a|, |b|).
 */
export const GPU_GCD_PREAMBLE_GLSL = `
float _gpu_gcd(float a, float b) {
  a = abs(a); b = abs(b);
  if (a == 0.0) return b;
  if (b == 0.0) return a;
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (int i = 0; i < 64; i++) {
      if (b == 0.0) break;
      float t = mod(a, b);
      a = b;
      b = t;
    }
    return a;
  }
  float mn = min(a, b);
  float tol = 1e-6 * max(a, b);
  for (int i = 0; i < 64; i++) {
    if (b <= tol) break;
    float t = mod(a, b);
    a = b;
    b = t;
  }
  return a > mn ? mn : a;
}
`;

/**
 * GPU GCD preamble (WGSL syntax). See GPU_GCD_PREAMBLE_GLSL for the
 * algorithm notes (integer fast path, tolerance, scale-mismatch guard).
 */
export const GPU_GCD_PREAMBLE_WGSL = `
fn _gpu_gcd(a_in: f32, b_in: f32) -> f32 {
  var a = abs(a_in); var b = abs(b_in);
  if (a == 0.0) { return b; }
  if (b == 0.0) { return a; }
  if (floor(a) == a && floor(b) == b && a < 16777216.0 && b < 16777216.0) {
    for (var i: i32 = 0; i < 64; i++) {
      if (b == 0.0) { break; }
      let t = a % b;
      a = b;
      b = t;
    }
    return a;
  }
  let mn = min(a, b);
  let tol = 1e-6 * max(a, b);
  for (var i: i32 = 0; i < 64; i++) {
    if (b <= tol) { break; }
    let t = a % b;
    a = b;
    b = t;
  }
  if (a > mn) { return mn; }
  return a;
}
`;

/**
 * GPU Random preamble (GLSL syntax) — PCG3D.
 *
 * `_gpu_pcg3d` is transcribed VERBATIM from Jarzynski & Olano, *Hash Functions
 * for GPU Rendering*, JCGT 2020, §6 — the same listing `pcg3d()` in
 * `numerics/random.ts` transcribes. Pure u32 arithmetic (exact on ES 3.00+),
 * so the shader computes the identical integer words as the host for identical
 * inputs; changing a constant or the operation order is a BREAKING change to
 * the seed→stream mapping, pinned by `test/compute-engine/random-vectors.test.ts`.
 *
 * The cross-multiply-adds are SEQUENTIAL — `v.y += v.z*v.x` reads the `v.x`
 * just updated.
 *
 * `_gpu_rnd_draw` presents `w0` as `(w0 >> 8) * 2⁻²⁴`: the top 24 bits scaled
 * by an exact power of two, never implementation-rounded float math. It
 * advances the caller's invocation-local counter, taken by `inout`, so
 * repeated draws in one frame decorrelate.
 */
export const GPU_PCG3D_PREAMBLE_GLSL = `
uvec3 _gpu_pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v ^= v >> 16u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
float _gpu_rnd_draw(uvec2 seed, inout uint n) {
  uvec3 w = _gpu_pcg3d(uvec3(seed.x, seed.y, n));
  n = n + 1u;
  return float(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Random preamble (WGSL syntax) — PCG3D. See
 * `GPU_PCG3D_PREAMBLE_GLSL` for the algorithm notes; this is the same
 * transcription with WGSL's `var<private>` counters passed by pointer.
 */
export const GPU_PCG3D_PREAMBLE_WGSL = `
fn _gpu_pcg3d(v_in: vec3<u32>) -> vec3<u32> {
  var v = v_in * 1664525u + 1013904223u;
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  v = v ^ (v >> vec3<u32>(16u));
  v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
  return v;
}
fn _gpu_rnd_draw(seed: vec2<u32>, n: ptr<private, u32>) -> f32 {
  let w = _gpu_pcg3d(vec3<u32>(seed.x, seed.y, *n));
  *n = *n + 1u;
  return f32(w.x >> 8u) * (1.0 / 16777216.0);
}
`;

/**
 * GPU Median preamble (GLSL syntax).
 *
 * One function per supported list size (2..8) using sorting networks
 * encoded entirely as min/max calls (e.g. the 9-comparator Bose-Nelson
 * network for N=5, where v2 holds the median).
 */
export const GPU_MEDIAN_PREAMBLE_GLSL = `
float _gpu_median_2(float a, float b) {
  return (a + b) * 0.5;
}
float _gpu_median_3(float a, float b, float c) {
  return max(min(a, b), min(max(a, b), c));
}
float _gpu_median_4(float a, float b, float c, float d) {
  float lo = max(min(a, b), min(c, d));
  float hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
float _gpu_median_5(float a, float b, float c, float d, float e) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
float _gpu_median_6(float a, float b, float c, float d, float e, float f) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
float _gpu_median_7(float a, float b, float c, float d, float e, float f, float g) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
float _gpu_median_8(float a, float b, float c, float d, float e, float f, float g, float h) {
  float t; float v0=a,v1=b,v2=c,v3=d,v4=e,v5=f,v6=g,v7=h;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

/**
 * GPU Median preamble (WGSL syntax).
 *
 * Same sorting-network logic as the GLSL version with WGSL syntax.
 */
export const GPU_MEDIAN_PREAMBLE_WGSL = `
fn _gpu_median_2(a: f32, b: f32) -> f32 {
  return (a + b) * 0.5;
}
fn _gpu_median_3(a: f32, b: f32, c: f32) -> f32 {
  return max(min(a, b), min(max(a, b), c));
}
fn _gpu_median_4(a: f32, b: f32, c: f32, d: f32) -> f32 {
  let lo = max(min(a, b), min(c, d));
  let hi = min(max(a, b), max(c, d));
  return (lo + hi) * 0.5;
}
fn _gpu_median_5(a: f32, b: f32, c: f32, d: f32, e: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v0,v3); v3=max(v0,v3); v0=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v4); v4=max(v1,v4); v1=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  return v2;
}
fn _gpu_median_6(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v2 + v3) * 0.5;
}
fn _gpu_median_7(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return v3;
}
fn _gpu_median_8(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32, g: f32, h: f32) -> f32 {
  var v0=a; var v1=b; var v2=c; var v3=d; var v4=e; var v5=f; var v6=g; var v7=h; var t: f32;
  t=min(v0,v1); v1=max(v0,v1); v0=t;
  t=min(v2,v3); v3=max(v2,v3); v2=t;
  t=min(v4,v5); v5=max(v4,v5); v4=t;
  t=min(v6,v7); v7=max(v6,v7); v6=t;
  t=min(v0,v2); v2=max(v0,v2); v0=t;
  t=min(v1,v3); v3=max(v1,v3); v1=t;
  t=min(v4,v6); v6=max(v4,v6); v4=t;
  t=min(v5,v7); v7=max(v5,v7); v5=t;
  t=min(v0,v4); v4=max(v0,v4); v0=t;
  t=min(v1,v5); v5=max(v1,v5); v1=t;
  t=min(v2,v6); v6=max(v2,v6); v2=t;
  t=min(v3,v7); v7=max(v3,v7); v3=t;
  t=min(v1,v2); v2=max(v1,v2); v1=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  t=min(v5,v6); v6=max(v5,v6); v5=t;
  t=min(v3,v5); v5=max(v3,v5); v3=t;
  t=min(v2,v4); v4=max(v2,v4); v2=t;
  t=min(v3,v4); v4=max(v3,v4); v3=t;
  return (v3 + v4) * 0.5;
}
`;

// ─── Color preamble ────────────────────────────────────────────────────────────

/**
 * GPU color space conversion preamble (GLSL syntax).
 *
 * Canonical color value: vec3 OKLCh `(L, C, H_deg)` — same convention as the
 * interpreted/JS-runtime layer. Shaders that write to a sRGB framebuffer must
 * wrap the final color in `_gpu_gamut_map_oklch()` at the boundary: it maps
 * the color into the sRGB gamut with the CSS Color 4 gamut mapping (below),
 * as the interpreter does at output. `_gpu_oklch_to_srgb()` does no mapping
 * and answers extended sRGB channels, which the canvas would clip one by one,
 * changing the hue of a color outside the gamut.
 *
 * Hue is in degrees throughout (matching the boxed-expression convention);
 * HSL/HSV saturation, lightness and value are in 0-1.
 *
 * The channels follow the rule of the interpreter and of the JavaScript
 * runtime (`readColorChannels`, `numerics/color-conversion.ts`):
 *
 * - sRGB channels are EXTENDED sRGB. A channel below 0 or above 1 is a color
 *   outside the sRGB gamut, and no conversion helper clamps it or maps it
 *   into the gamut: only the output does (`_gpu_gamut_map_oklch`, and the
 *   conversions to HSV and HSL). The transfer functions
 *   (`_gpu_srgb_to_linear`, `_gpu_linear_to_srgb`) are sign-extended,
 *   `sign(c)·f(|c|)`, as for extended sRGB in CSS Color 4, and the cube
 *   roots in `_gpu_srgb_to_oklab` are sign-extended too, because `pow` is
 *   undefined for a negative base. So a conversion to OKLab and back returns
 *   the same extended channels.
 * - `_gpu_hsv_to_rgb` and `_gpu_hsl_to_rgb` reduce the hue modulo 360 and
 *   clamp the saturation, the value and the lightness into `[0, 1]`: HSV and
 *   HSL describe only the sRGB gamut. `clamp` also reads an infinite channel
 *   as its bound, `+inf` as 1 and `-inf` as 0. An infinite hue has no
 *   reduction: it becomes `NaN`, and so does the whole triple (next item).
 * - `_gpu_rgb_to_hsv` and `_gpu_rgb_to_hsl` first map the color into the
 *   sRGB gamut (`_gpu_gamut_map_srgb`), because HSV and HSL cannot hold an
 *   extended color.
 * - `_gpu_gamut_map_oklch` is the CSS Color 4 gamut mapping of the
 *   interpreter (`gamutMapOklch`, `numerics/color-conversion.ts`), step for
 *   step: a triple with a `NaN` or an infinite channel is the `NaN` triple
 *   (this test comes first, so that an infinite lightness is not read as
 *   white); a lightness of 1 or more is white and 0 or less is black; a
 *   negative chroma is the positive chroma at the hue plus 180; a color
 *   inside the gamut (each channel within 1e-6 of `[0, 1]`) is its own
 *   channels, clamped; otherwise the chroma is searched in `[0, C]` at
 *   constant lightness and hue, and the search stops at the first chroma
 *   whose clamped color is within ΔE_OK 0.02 of it (and within 0.0001 of that
 *   bound), or when the interval is narrower than 0.0001. The loop has the
 *   constant bound 24, which a shader requires; 24 halvings bring a chroma
 *   below 1000 under 0.0001, so the bound does not stop the search first for
 *   any chroma a color has. `_gpu_gamut_map_oklch_p3` does the same in the
 *   Display-P3 gamut and answers the result in extended sRGB channels. The
 *   Display-P3 matrices are those of `LINEAR_SRGB_TO_LINEAR_P3` and
 *   `LINEAR_P3_TO_LINEAR_SRGB` in that module, rounded to 10 decimals.
 *   `_gpu_in_srgb_gamut` tests that each channel is in `[0, 1]`, within 1e-6,
 *   so it is also the test of Display-P3 coordinates.
 * - `_gpu_gamut_map_srgb` maps an extended sRGB color: a color inside the
 *   gamut is its own channels, clamped, and any other finite color goes
 *   through OKLCh and `_gpu_gamut_map_oklch`, as `gamutMapSrgb` does.
 * - An infinite sRGB channel or OKLab/OKLCh channel is not clamped: the
 *   arithmetic of the conversion makes it `NaN` (`inf - inf`), the NaN color
 *   of the interpreter's `incompatible-type` error.
 * - A `NaN` channel gives the `NaN` triple, as the interpreter refuses a
 *   `NaN` channel. GLSL and WGSL do not specify `min`, `max` or `clamp` of
 *   `NaN`, nor `sign(NaN)`, so a clamp or a sign step can change a `NaN`
 *   into a finite number. Each helper that clamps, takes a sign or compares
 *   (the HSV and HSL conversions, the sign-extended transfer functions and
 *   cube roots, `_gpu_apca_luma` and `_gpu_apca`) therefore first tests its
 *   input with a self-comparison (`x != x`, true only for `NaN`) and returns
 *   `NaN` channels. The `NaN` it returns is the sum of the tested values,
 *   which is `NaN` because one of them is, so the helpers do not depend on
 *   `_gpu_nan()`. This is best effort, as every `NaN` test on a shader is: a
 *   driver that assumes no `NaN` occurs (fast-math in GLSL, and WGSL, whose
 *   implementations may assume finite values) can fold the test to false.
 *
 * `_gpu_color_mix` interpolates directly in OKLCh — no sRGB pinch — and
 * special-cases achromatic endpoints (C ≈ 0) so e.g. mixing red with white
 * preserves red's hue rather than drifting through arbitrary hues.
 *
 * `_gpu_apca` is the APCA contrast the interpreter's `ColorContrast` answers,
 * component for component: the simple 2.4-power luminance the APCA method
 * asks for (NOT the piecewise sRGB transfer), sign-extended for an extended
 * sRGB channel as the interpreter's is, the black-level soft clamp, the
 * separate light-on-dark and dark-on-light exponents, the low-contrast clip
 * and its offset. The value is the APCA Lc divided by 100, so black text on
 * white is about 1.06 and white on black about -1.08. An earlier
 * approximation dropped every correction and multiplied by 100 instead, so
 * the same expression answered about -114 on a shader and about -1.08 in the
 * interpreter.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c != c) return c;
  float a = abs(c);
  if (a <= 0.04045) return c / 12.92;
  return sign(c) * pow((a + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c != c) return c;
  float a = abs(c);
  if (a <= 0.0031308) return 12.92 * c;
  return sign(c) * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float lc = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  float mc = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  float sc = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  if (lc != lc || mc != mc || sc != sc) return vec3(lc + mc + sc);
  float l_ = sign(lc) * pow(abs(lc), 1.0 / 3.0);
  float m_ = sign(mc) * pow(abs(mc), 1.0 / 3.0);
  float s_ = sign(sc) * pow(abs(sc), 1.0 / 3.0);
  return vec3(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

vec3 _gpu_oklab_to_srgb(vec3 lab) {
  float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  float r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  float g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  float b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b));
}

vec3 _gpu_oklab_to_oklch(vec3 lab) {
  float C = length(lab.yz);
  float H = atan(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) H += 360.0;
  return vec3(lab.x, C, H);
}

vec3 _gpu_oklch_to_oklab(vec3 lch) {
  float h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

vec3 _gpu_srgb_to_oklch(vec3 rgb) {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

vec3 _gpu_oklch_to_srgb(vec3 lch) {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

bool _gpu_in_srgb_gamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(-1e-6))) && all(lessThanEqual(rgb, vec3(1.000001)));
}

vec3 _gpu_srgb_to_p3(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  return vec3(
    _gpu_linear_to_srgb(0.8224619687 * r + 0.1775380313 * g),
    _gpu_linear_to_srgb(0.0331941989 * r + 0.9668058011 * g),
    _gpu_linear_to_srgb(0.0170826307 * r + 0.0723974407 * g + 0.9105199286 * b)
  );
}

vec3 _gpu_p3_to_srgb(vec3 p3) {
  float r = _gpu_srgb_to_linear(p3.x);
  float g = _gpu_srgb_to_linear(p3.y);
  float b = _gpu_srgb_to_linear(p3.z);
  return vec3(
    _gpu_linear_to_srgb(1.2249401763 * r - 0.2249401763 * g),
    _gpu_linear_to_srgb(-0.0420569547 * r + 1.0420569547 * g),
    _gpu_linear_to_srgb(-0.0196375546 * r - 0.0786360456 * g + 1.0982736 * b)
  );
}

vec3 _gpu_oklch_to_gamut(vec3 lch, bool p3) {
  vec3 rgb = _gpu_oklch_to_srgb(lch);
  if (p3) return _gpu_srgb_to_p3(rgb);
  return rgb;
}

float _gpu_gamut_delta_e(vec3 c, vec3 lch, bool p3) {
  vec3 a = _gpu_srgb_to_oklab(p3 ? _gpu_p3_to_srgb(c) : c);
  vec3 b = _gpu_oklch_to_oklab(lch);
  float dL = a.x - b.x;
  float da = a.y - b.y;
  float db = a.z - b.z;
  return sqrt(dL * dL + da * da + db * db);
}

vec3 _gpu_gamut_map_oklch_in(vec3 lch, bool p3) {
  float L = lch.x;
  float C = lch.y;
  float H = lch.z;
  if (L != L || C != C || H != H) return vec3(L + C + H);
  if (!(abs(L) <= 3.4028234663852886e38 && abs(C) <= 3.4028234663852886e38 && abs(H) <= 3.4028234663852886e38))
    return vec3(intBitsToFloat(0x7FC00000));
  if (L >= 1.0) return vec3(1.0);
  if (L <= 0.0) return vec3(0.0);
  if (C < 0.0) {
    C = -C;
    H = H + 180.0;
  }
  vec3 origin = _gpu_oklch_to_gamut(vec3(L, C, H), p3);
  vec3 clipped = clamp(origin, 0.0, 1.0);
  if (_gpu_in_srgb_gamut(origin)) return clipped;
  if (_gpu_gamut_delta_e(clipped, vec3(L, C, H), p3) < 0.02) return clipped;
  float lo = 0.0;
  float hi = C;
  bool loInGamut = true;
  for (int i = 0; i < 24; i++) {
    if (hi - lo <= 0.0001) break;
    float chroma = (lo + hi) / 2.0;
    vec3 current = _gpu_oklch_to_gamut(vec3(L, chroma, H), p3);
    if (loInGamut && _gpu_in_srgb_gamut(current)) {
      lo = chroma;
    } else {
      clipped = clamp(current, 0.0, 1.0);
      float e = _gpu_gamut_delta_e(clipped, vec3(L, chroma, H), p3);
      if (e < 0.02) {
        if (0.02 - e < 0.0001) return clipped;
        loInGamut = false;
        lo = chroma;
      } else {
        hi = chroma;
      }
    }
  }
  return clipped;
}

vec3 _gpu_gamut_map_oklch(vec3 lch) {
  return _gpu_gamut_map_oklch_in(lch, false);
}

vec3 _gpu_gamut_map_oklch_p3(vec3 lch) {
  return _gpu_p3_to_srgb(_gpu_gamut_map_oklch_in(lch, true));
}

vec3 _gpu_gamut_map_srgb(vec3 rgb) {
  if (rgb.x != rgb.x || rgb.y != rgb.y || rgb.z != rgb.z)
    return vec3(rgb.x + rgb.y + rgb.z);
  if (_gpu_in_srgb_gamut(rgb)) return clamp(rgb, 0.0, 1.0);
  if (!(abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38))
    return clamp(rgb, 0.0, 1.0);
  return _gpu_gamut_map_oklch(_gpu_srgb_to_oklch(rgb));
}

vec3 _gpu_hsl_to_rgb(vec3 hsl) {
  float h = mod(hsl.x, 360.0);
  if (h != h || hsl.y != hsl.y || hsl.z != hsl.z) return vec3(h + hsl.y + hsl.z);
  float s = clamp(hsl.y, 0.0, 1.0);
  float l = clamp(hsl.z, 0.0, 1.0);
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = l - c / 2.0;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsl(vec3 rgb_in) {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z)
    return vec3(rgb_in.x + rgb_in.y + rgb_in.z);
  vec3 rgb = _gpu_gamut_map_srgb(rgb_in);
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float l = (maxc + minc) / 2.0;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0));
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, l);
}

vec3 _gpu_hsv_to_rgb(vec3 hsv) {
  float h = mod(hsv.x, 360.0);
  if (h != h || hsv.y != hsv.y || hsv.z != hsv.z) return vec3(h + hsv.y + hsv.z);
  float s = clamp(hsv.y, 0.0, 1.0);
  float v = clamp(hsv.z, 0.0, 1.0);
  float c = v * s;
  float h6 = h / 60.0;
  float x = c * (1.0 - abs(mod(h6, 2.0) - 1.0));
  float r = 0.0;
  float g = 0.0;
  float b = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  float m = v - c;
  return vec3(r + m, g + m, b + m);
}

vec3 _gpu_rgb_to_hsv(vec3 rgb_in) {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z)
    return vec3(rgb_in.x + rgb_in.y + rgb_in.z);
  vec3 rgb = _gpu_gamut_map_srgb(rgb_in);
  float maxc = max(max(rgb.x, rgb.y), rgb.z);
  float minc = min(min(rgb.x, rgb.y), rgb.z);
  float v = maxc;
  float d = maxc - minc;
  if (d < 1e-6) return vec3(0.0, 0.0, v);
  float s = (maxc < 1e-6) ? 0.0 : d / maxc;
  float h;
  if (maxc == rgb.x)      h = mod((rgb.y - rgb.z) / d, 6.0);
  else if (maxc == rgb.y) h = (rgb.z - rgb.x) / d + 2.0;
  else                    h = (rgb.x - rgb.y) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, s, v);
}

vec3 _gpu_color_mix(vec3 lch1, vec3 lch2, float t) {
  float L = mix(lch1.x, lch2.x, t);
  float C = mix(lch1.y, lch2.y, t);
  bool a1 = lch1.y < 1e-6;
  bool a2 = lch2.y < 1e-6;
  float H;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    float dh = lch2.z - lch1.z;
    if (dh > 180.0) dh -= 360.0;
    if (dh < -180.0) dh += 360.0;
    H = lch1.z + dh * t;
    if (H < 0.0) H += 360.0;
    if (H >= 360.0) H -= 360.0;
  }
  return vec3(L, C, H);
}

float _gpu_apca_luma(vec3 srgb) {
  if (srgb.x != srgb.x || srgb.y != srgb.y || srgb.z != srgb.z)
    return srgb.x + srgb.y + srgb.z;
  float Y = 0.2126729 * sign(srgb.x) * pow(abs(srgb.x), 2.4)
          + 0.7151522 * sign(srgb.y) * pow(abs(srgb.y), 2.4)
          + 0.0721750 * sign(srgb.z) * pow(abs(srgb.z), 2.4);
  return Y >= 0.022 ? Y : Y + pow(0.022 - Y, 1.414);
}

float _gpu_apca(vec3 lch_bg, vec3 lch_fg) {
  float Ybg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_bg));
  float Yfg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_fg));
  if (Ybg != Ybg || Yfg != Yfg) return Ybg + Yfg;
  float C = 0.0;
  if (abs(Ybg - Yfg) >= 0.0005) {
    if (Ybg > Yfg) C = (pow(Ybg, 0.56) - pow(Yfg, 0.57)) * 1.14;
    else           C = (pow(Ybg, 0.65) - pow(Yfg, 0.62)) * 1.14;
  }
  if (abs(C) < 0.1) return 0.0;
  return C > 0.0 ? C - 0.027 : C + 0.027;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 *
 * Same convention as the GLSL preamble: canonical color value is `vec3f`
 * OKLCh `(L, C, H_deg)`. Shaders writing to a sRGB framebuffer must wrap
 * their final color in `_gpu_gamut_map_oklch()`.
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c != c) { return c; }
  let a = abs(c);
  if (a <= 0.04045) { return c / 12.92; }
  return sign(c) * pow((a + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c != c) { return c; }
  let a = abs(c);
  if (a <= 0.0031308) { return 12.92 * c; }
  return sign(c) * (1.055 * pow(a, 1.0 / 2.4) - 0.055);
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let lc = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  let mc = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  let sc = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  if (lc != lc || mc != mc || sc != sc) { return vec3f(lc + mc + sc); }
  let l_ = sign(lc) * pow(abs(lc), 1.0 / 3.0);
  let m_ = sign(mc) * pow(abs(mc), 1.0 / 3.0);
  let s_ = sign(sc) * pow(abs(sc), 1.0 / 3.0);
  return vec3f(
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  );
}

fn _gpu_oklab_to_srgb(lab: vec3f) -> vec3f {
  let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  let s_ = lab.x - 0.0894841775 * lab.y - 1.291485548 * lab.z;
  let l = l_ * l_ * l_;
  let m = m_ * m_ * m_;
  let s = s_ * s_ * s_;
  let r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b));
}

fn _gpu_oklab_to_oklch(lab: vec3f) -> vec3f {
  let C = length(lab.yz);
  var H = atan2(lab.z, lab.y) * (180.0 / 3.14159265359);
  if (H < 0.0) { H = H + 360.0; }
  return vec3f(lab.x, C, H);
}

fn _gpu_oklch_to_oklab(lch: vec3f) -> vec3f {
  let h_rad = lch.z * (3.14159265359 / 180.0);
  return vec3f(lch.x, lch.y * cos(h_rad), lch.y * sin(h_rad));
}

fn _gpu_srgb_to_oklch(rgb: vec3f) -> vec3f {
  return _gpu_oklab_to_oklch(_gpu_srgb_to_oklab(rgb));
}

fn _gpu_oklch_to_srgb(lch: vec3f) -> vec3f {
  return _gpu_oklab_to_srgb(_gpu_oklch_to_oklab(lch));
}

fn _gpu_in_srgb_gamut(rgb: vec3f) -> bool {
  return all(rgb >= vec3f(-1e-6)) && all(rgb <= vec3f(1.000001));
}

fn _gpu_srgb_to_p3(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  return vec3f(
    _gpu_linear_to_srgb(0.8224619687 * r + 0.1775380313 * g),
    _gpu_linear_to_srgb(0.0331941989 * r + 0.9668058011 * g),
    _gpu_linear_to_srgb(0.0170826307 * r + 0.0723974407 * g + 0.9105199286 * b)
  );
}

fn _gpu_p3_to_srgb(p3: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(p3.x);
  let g = _gpu_srgb_to_linear(p3.y);
  let b = _gpu_srgb_to_linear(p3.z);
  return vec3f(
    _gpu_linear_to_srgb(1.2249401763 * r - 0.2249401763 * g),
    _gpu_linear_to_srgb(-0.0420569547 * r + 1.0420569547 * g),
    _gpu_linear_to_srgb(-0.0196375546 * r - 0.0786360456 * g + 1.0982736 * b)
  );
}

fn _gpu_oklch_to_gamut(lch: vec3f, p3: bool) -> vec3f {
  let rgb = _gpu_oklch_to_srgb(lch);
  if (p3) { return _gpu_srgb_to_p3(rgb); }
  return rgb;
}

fn _gpu_gamut_delta_e(c: vec3f, lch: vec3f, p3: bool) -> f32 {
  let a = _gpu_srgb_to_oklab(select(c, _gpu_p3_to_srgb(c), p3));
  let b = _gpu_oklch_to_oklab(lch);
  let dL = a.x - b.x;
  let da = a.y - b.y;
  let db = a.z - b.z;
  return sqrt(dL * dL + da * da + db * db);
}

fn _gpu_gamut_map_oklch_in(lch: vec3f, p3: bool) -> vec3f {
  let L = lch.x;
  var C = lch.y;
  var H = lch.z;
  if (L != L || C != C || H != H) { return vec3f(L + C + H); }
  if (!(abs(L) <= 3.4028234663852886e38 && abs(C) <= 3.4028234663852886e38 && abs(H) <= 3.4028234663852886e38)) {
    return vec3f(_gpu_nan());
  }
  if (L >= 1.0) { return vec3f(1.0); }
  if (L <= 0.0) { return vec3f(0.0); }
  if (C < 0.0) {
    C = -C;
    H = H + 180.0;
  }
  let origin = _gpu_oklch_to_gamut(vec3f(L, C, H), p3);
  var clipped = clamp(origin, vec3f(0.0), vec3f(1.0));
  if (_gpu_in_srgb_gamut(origin)) { return clipped; }
  if (_gpu_gamut_delta_e(clipped, vec3f(L, C, H), p3) < 0.02) { return clipped; }
  var lo: f32 = 0.0;
  var hi: f32 = C;
  var loInGamut = true;
  for (var i: i32 = 0; i < 24; i = i + 1) {
    if (hi - lo <= 0.0001) { break; }
    let chroma = (lo + hi) / 2.0;
    let current = _gpu_oklch_to_gamut(vec3f(L, chroma, H), p3);
    if (loInGamut && _gpu_in_srgb_gamut(current)) {
      lo = chroma;
    } else {
      clipped = clamp(current, vec3f(0.0), vec3f(1.0));
      let e = _gpu_gamut_delta_e(clipped, vec3f(L, chroma, H), p3);
      if (e < 0.02) {
        if (0.02 - e < 0.0001) { return clipped; }
        loInGamut = false;
        lo = chroma;
      } else {
        hi = chroma;
      }
    }
  }
  return clipped;
}

fn _gpu_gamut_map_oklch(lch: vec3f) -> vec3f {
  return _gpu_gamut_map_oklch_in(lch, false);
}

fn _gpu_gamut_map_oklch_p3(lch: vec3f) -> vec3f {
  return _gpu_p3_to_srgb(_gpu_gamut_map_oklch_in(lch, true));
}

fn _gpu_gamut_map_srgb(rgb: vec3f) -> vec3f {
  if (rgb.x != rgb.x || rgb.y != rgb.y || rgb.z != rgb.z) {
    return vec3f(rgb.x + rgb.y + rgb.z);
  }
  if (_gpu_in_srgb_gamut(rgb)) { return clamp(rgb, vec3f(0.0), vec3f(1.0)); }
  if (!(abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38)) {
    return clamp(rgb, vec3f(0.0), vec3f(1.0));
  }
  return _gpu_gamut_map_oklch(_gpu_srgb_to_oklch(rgb));
}

fn _gpu_hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x - 360.0 * floor(hsl.x / 360.0);
  if (h != h || hsl.y != hsl.y || hsl.z != hsl.z) { return vec3f(h + hsl.y + hsl.z); }
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);
  let c = (1.0 - abs(2.0 * l - 1.0)) * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = l - c / 2.0;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsl(rgb_in: vec3f) -> vec3f {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z) {
    return vec3f(rgb_in.x + rgb_in.y + rgb_in.z);
  }
  let rgb = _gpu_gamut_map_srgb(rgb_in);
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let l = (maxc + minc) / 2.0;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, l); }
  let s = d / (1.0 - abs(2.0 * l - 1.0));
  var h: f32;
  if (maxc == rgb.x) {
    let v = (rgb.y - rgb.z) / d;
    h = v - 6.0 * floor(v / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, l);
}

fn _gpu_hsv_to_rgb(hsv: vec3f) -> vec3f {
  let h = hsv.x - 360.0 * floor(hsv.x / 360.0);
  if (h != h || hsv.y != hsv.y || hsv.z != hsv.z) { return vec3f(h + hsv.y + hsv.z); }
  let s = clamp(hsv.y, 0.0, 1.0);
  let v = clamp(hsv.z, 0.0, 1.0);
  let c = v * s;
  let h6 = h / 60.0;
  let x = c * (1.0 - abs((h6 - 2.0 * floor(h6 / 2.0)) - 1.0));
  var r: f32 = 0.0;
  var g: f32 = 0.0;
  var b: f32 = 0.0;
  if (h6 < 1.0)      { r = c; g = x; b = 0.0; }
  else if (h6 < 2.0) { r = x; g = c; b = 0.0; }
  else if (h6 < 3.0) { r = 0.0; g = c; b = x; }
  else if (h6 < 4.0) { r = 0.0; g = x; b = c; }
  else if (h6 < 5.0) { r = x; g = 0.0; b = c; }
  else               { r = c; g = 0.0; b = x; }
  let m = v - c;
  return vec3f(r + m, g + m, b + m);
}

fn _gpu_rgb_to_hsv(rgb_in: vec3f) -> vec3f {
  if (rgb_in.x != rgb_in.x || rgb_in.y != rgb_in.y || rgb_in.z != rgb_in.z) {
    return vec3f(rgb_in.x + rgb_in.y + rgb_in.z);
  }
  let rgb = _gpu_gamut_map_srgb(rgb_in);
  let maxc = max(max(rgb.x, rgb.y), rgb.z);
  let minc = min(min(rgb.x, rgb.y), rgb.z);
  let v = maxc;
  let d = maxc - minc;
  if (d < 1e-6) { return vec3f(0.0, 0.0, v); }
  var s: f32 = 0.0;
  if (maxc >= 1e-6) { s = d / maxc; }
  var h: f32;
  if (maxc == rgb.x) {
    let q = (rgb.y - rgb.z) / d;
    h = q - 6.0 * floor(q / 6.0);
  } else if (maxc == rgb.y) {
    h = (rgb.z - rgb.x) / d + 2.0;
  } else {
    h = (rgb.x - rgb.y) / d + 4.0;
  }
  h = h * 60.0;
  if (h < 0.0) { h = h + 360.0; }
  return vec3f(h, s, v);
}

fn _gpu_color_mix(lch1: vec3f, lch2: vec3f, t: f32) -> vec3f {
  let L = mix(lch1.x, lch2.x, t);
  let C = mix(lch1.y, lch2.y, t);
  let a1 = lch1.y < 1e-6;
  let a2 = lch2.y < 1e-6;
  var H: f32;
  if (a1 && a2) {
    H = lch1.z;
  } else if (a1) {
    H = lch2.z;
  } else if (a2) {
    H = lch1.z;
  } else {
    var dh = lch2.z - lch1.z;
    if (dh > 180.0) { dh = dh - 360.0; }
    if (dh < -180.0) { dh = dh + 360.0; }
    H = lch1.z + dh * t;
    if (H < 0.0) { H = H + 360.0; }
    if (H >= 360.0) { H = H - 360.0; }
  }
  return vec3f(L, C, H);
}

fn _gpu_apca_luma(srgb: vec3f) -> f32 {
  if (srgb.x != srgb.x || srgb.y != srgb.y || srgb.z != srgb.z) {
    return srgb.x + srgb.y + srgb.z;
  }
  let Y = 0.2126729 * sign(srgb.x) * pow(abs(srgb.x), 2.4)
        + 0.7151522 * sign(srgb.y) * pow(abs(srgb.y), 2.4)
        + 0.0721750 * sign(srgb.z) * pow(abs(srgb.z), 2.4);
  return select(Y + pow(0.022 - Y, 1.414), Y, Y >= 0.022);
}

fn _gpu_apca(lch_bg: vec3f, lch_fg: vec3f) -> f32 {
  let Ybg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_bg));
  let Yfg = _gpu_apca_luma(_gpu_oklch_to_srgb(lch_fg));
  if (Ybg != Ybg || Yfg != Yfg) { return Ybg + Yfg; }
  var C = 0.0;
  if (abs(Ybg - Yfg) >= 0.0005) {
    if (Ybg > Yfg) {
      C = (pow(Ybg, 0.56) - pow(Yfg, 0.57)) * 1.14;
    } else {
      C = (pow(Ybg, 0.65) - pow(Yfg, 0.62)) * 1.14;
    }
  }
  if (abs(C) < 0.1) { return 0.0; }
  return select(C + 0.027, C - 0.027, C > 0.0);
}
`;

/**
 * The sRGB round trip (GLSL syntax): an sRGB triple converted to OKLCh and
 * back, which the `AsRgb(Rgb(…))`, `AsRgb(Hsv(…))` and `AsRgb(Hsl(…))`
 * lowerings emit (`gpuRgbBoundary`).
 *
 * The conversions keep extended sRGB channels (a channel below 0 or above 1
 * is a color outside the sRGB gamut, and the canvas clamps it at output), and
 * they do no gamut mapping. So for a finite triple the round trip is the
 * identity, and the helper returns the triple without the two conversions.
 * A triple with an infinite or `NaN` channel goes through the conversions,
 * which answer `NaN` channels: an infinite sRGB channel is not a color, as on
 * the interpreter (`readColorChannels`). An infinite channel becomes `NaN` in
 * the arithmetic of the conversion (`inf - inf`), and the conversions test
 * for a `NaN` channel before each sign step and return `NaN` channels, so a
 * `NaN` channel stays `NaN` (best effort, as the colour preamble comment
 * says). The test is against `3.4028234663852886e38`, the largest finite 32-bit
 * float, because WGSL has no `isinf`: every finite channel passes it, and
 * only an infinite one (or `NaN`) fails.
 *
 * It stands apart from the colour preamble above only because it is a later
 * addition to the same library; it calls two of that library's functions,
 * so it is appended to it (`GPU_COLOR_LIBRARY_GLSL`) and the per-function
 * inclusion pass pulls in whatever it needs.
 */
const GPU_SRGB_ROUNDTRIP_GLSL = `
vec3 _gpu_srgb_roundtrip(vec3 rgb) {
  if (abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38) return rgb;
  return _gpu_oklch_to_srgb(_gpu_srgb_to_oklch(rgb));
}
`;

/** The sRGB round trip (WGSL syntax). See `GPU_SRGB_ROUNDTRIP_GLSL`. */
const GPU_SRGB_ROUNDTRIP_WGSL = `
fn _gpu_srgb_roundtrip(rgb: vec3f) -> vec3f {
  if (abs(rgb.x) <= 3.4028234663852886e38 && abs(rgb.y) <= 3.4028234663852886e38 && abs(rgb.z) <= 3.4028234663852886e38) { return rgb; }
  return _gpu_oklch_to_srgb(_gpu_srgb_to_oklch(rgb));
}
`;

/** The whole colour library, round trip included, in one dependency order. */
const GPU_COLOR_LIBRARY_GLSL =
  GPU_COLOR_PREAMBLE_GLSL + GPU_SRGB_ROUNDTRIP_GLSL;
const GPU_COLOR_LIBRARY_WGSL =
  GPU_COLOR_PREAMBLE_WGSL + GPU_SRGB_ROUNDTRIP_WGSL;

/**
 * Per-function complex arithmetic definitions with dependency metadata.
 *
 * Each entry maps a helper function name to its GLSL source, WGSL source,
 * and the list of other helper functions it calls. The preamble builder
 * uses this to emit only the functions actually referenced by compiled code,
 * in topological (dependency) order.
 *
 * Addition, subtraction, negation, and scalar multiplication use native
 * vec2 operators and do not need helper functions.
 */
interface ComplexFunctionDef {
  glsl: string;
  wgsl: string;
  deps: string[];
}

// Null-prototype: this table is indexed by an OPERATOR or SYMBOL NAME, and a
// name is arbitrary user text. A plain object literal inherits
// `Object.prototype`, so a name such as `toString`, `constructor` or
// `valueOf` reads the inherited member instead of missing — and because that
// value is a truthy function, the caller treats the symbol as though the
// target defined it. That made `Add(toString, 1)` refuse to compile as a
// bogus "built-in operator with no fixed arity" instead of compiling
// `toString` as an ordinary free symbol.
const GPU_COMPLEX_FUNCTIONS: Record<string, ComplexFunctionDef> = {
  __proto__: null as never,
  _gpu_cmul: {
    deps: [],
    glsl: `vec2 _gpu_cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
    wgsl: `fn _gpu_cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}`,
  },
  _gpu_cdiv: {
    deps: [],
    glsl: `vec2 _gpu_cdiv(vec2 a, vec2 b) {
  float d = b.x * b.x + b.y * b.y;
  return vec2((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
    wgsl: `fn _gpu_cdiv(a: vec2f, b: vec2f) -> vec2f {
  let d = b.x * b.x + b.y * b.y;
  return vec2f((a.x * b.x + a.y * b.y) / d, (a.y * b.x - a.x * b.y) / d);
}`,
  },
  _gpu_cexp: {
    deps: [],
    glsl: `vec2 _gpu_cexp(vec2 z) {
  float e = exp(z.x);
  return vec2(e * cos(z.y), e * sin(z.y));
}`,
    wgsl: `fn _gpu_cexp(z: vec2f) -> vec2f {
  let e = exp(z.x);
  return vec2f(e * cos(z.y), e * sin(z.y));
}`,
  },
  _gpu_cln: {
    deps: [],
    glsl: `vec2 _gpu_cln(vec2 z) {
  return vec2(log(length(z)), atan(z.y, z.x));
}`,
    wgsl: `fn _gpu_cln(z: vec2f) -> vec2f {
  return vec2f(log(length(z)), atan2(z.y, z.x));
}`,
  },
  // `z^w` is `exp(w · ln z)`. At `z = 0`, `ln z` is `(−∞, 0)`, and the
  // product with `w` has the imaginary part `w.x · 0 + w.y · (−∞)`, which is
  // NaN even when `w.y` is 0 (`0 · −∞`). The interpreter answers 0 for
  // `0^w` when the real part of `w` is positive (`Root(0, n)` for a positive
  // degree `n`, `0^(1/2 + i)`), so that case is answered first. For any
  // other `w`, the interpreter has no finite value, and the formula answers
  // NaN.
  _gpu_cpow: {
    deps: ['_gpu_cexp', '_gpu_cmul', '_gpu_cln'],
    glsl: `vec2 _gpu_cpow(vec2 z, vec2 w) {
  if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) return vec2(0.0);
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
    wgsl: `fn _gpu_cpow(z: vec2f, w: vec2f) -> vec2f {
  if (z.x == 0.0 && z.y == 0.0 && w.x > 0.0) { return vec2f(0.0); }
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
  },
  // `z^e` for a real exponent `e` whose recovered rational has an odd
  // denominator, decided when the shader is generated
  // (`BaseCompiler.negativeBaseFloatPower`): a negative real `z` has the real
  // root `s·|z|^e` (`s` is `−1.0` for an odd numerator), as in the
  // interpreter, and any other `z` the principal value.
  _gpu_cpowrr: {
    deps: ['_gpu_cpow'],
    glsl: `vec2 _gpu_cpowrr(vec2 z, float e, float s) {
  if (z.y == 0.0 && z.x < 0.0) return vec2(s * pow(-z.x, e), 0.0);
  return _gpu_cpow(z, vec2(e, 0.0));
}`,
    wgsl: `fn _gpu_cpowrr(z: vec2f, e: f32, s: f32) -> vec2f {
  if (z.y == 0.0 && z.x < 0.0) { return vec2f(s * pow(-z.x, e), 0.0); }
  return _gpu_cpow(z, vec2f(e, 0.0));
}`,
  },
  _gpu_csqrt: {
    deps: [],
    glsl: `vec2 _gpu_csqrt(vec2 z) {
  float r = length(z);
  float theta = atan(z.y, z.x);
  return sqrt(r) * vec2(cos(theta * 0.5), sin(theta * 0.5));
}`,
    wgsl: `fn _gpu_csqrt(z: vec2f) -> vec2f {
  let r = length(z);
  let theta = atan2(z.y, z.x);
  return sqrt(r) * vec2f(cos(theta * 0.5), sin(theta * 0.5));
}`,
  },
  _gpu_csin: {
    deps: [],
    glsl: `vec2 _gpu_csin(vec2 z) {
  return vec2(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_csin(z: vec2f) -> vec2f {
  return vec2f(sin(z.x) * cosh(z.y), cos(z.x) * sinh(z.y));
}`,
  },
  _gpu_ccos: {
    deps: [],
    glsl: `vec2 _gpu_ccos(vec2 z) {
  return vec2(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
    wgsl: `fn _gpu_ccos(z: vec2f) -> vec2f {
  return vec2f(cos(z.x) * cosh(z.y), -sin(z.x) * sinh(z.y));
}`,
  },
  _gpu_ctan: {
    deps: ['_gpu_cdiv', '_gpu_csin', '_gpu_ccos'],
    glsl: `vec2 _gpu_ctan(vec2 z) {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
    wgsl: `fn _gpu_ctan(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csin(z), _gpu_ccos(z));
}`,
  },
  _gpu_csinh: {
    deps: [],
    glsl: `vec2 _gpu_csinh(vec2 z) {
  return vec2(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_csinh(z: vec2f) -> vec2f {
  return vec2f(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}`,
  },
  _gpu_ccosh: {
    deps: [],
    glsl: `vec2 _gpu_ccosh(vec2 z) {
  return vec2(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
    wgsl: `fn _gpu_ccosh(z: vec2f) -> vec2f {
  return vec2f(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}`,
  },
  _gpu_ctanh: {
    deps: ['_gpu_cdiv', '_gpu_csinh', '_gpu_ccosh'],
    glsl: `vec2 _gpu_ctanh(vec2 z) {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
    wgsl: `fn _gpu_ctanh(z: vec2f) -> vec2f {
  return _gpu_cdiv(_gpu_csinh(z), _gpu_ccosh(z));
}`,
  },
  //
  // Inverse trigonometric and inverse hyperbolic functions of a complex value
  //
  // These kernels use the formulas of W. Kahan, "Branch Cuts for Complex
  // Elementary Functions, or Much Ado About Nothing's Sign Bit" (1987), as
  // the interpreter and the JavaScript target do (`complexAsin()` and the
  // others in `numerics/numeric-complex.ts`). The textbook logarithm
  // formulas (`asin z = −i·ln(iz + √(1 − z²))`) cancel on one side of the
  // plane and overflow when `z²` leaves the f32 range (about 3.4·10³⁸): in
  // f32 they gave `asin(1000)` a real part of 1.66 instead of π/2, and
  // `asin(10⁴)` a real part of π. The formulas below take a product of two
  // square roots in place of `√(1 − z²)`, so there is no cancellation, and
  // no overflow below `|z| ≈ 10³⁷`. Above that, a function uses its value at
  // `z/16`, whose logarithmic part differs by `ln 16` (2.7725887…).
  //
  // A shader cannot rely on the sign of a zero (WGSL does not keep it), so
  // the side of a branch cut is not read from a zero part. Each kernel
  // passes a third argument `s` (+1 or −1), the sign that a zero part
  // takes, and the kernels pick the same side as the interpreter:
  // - `asin`, `acos`, `atanh` on the real axis: the side below the axis for
  //   `x > 1`, the side above it for `x < −1` (`asin 2` is
  //   `π/2 − 1.317i`).
  // - `acosh` on the real axis (`x < 1`): the side above the axis
  //   (`acosh(−2)` is `1.317 + πi`).
  // - `asinh` on the imaginary axis: the side right of the axis for
  //   `y > 1`, left of it for `y < −1` (`asinh 2i` is `1.317 + (π/2)i`).
  // - `atan` on the imaginary axis: the side right of the axis for
  //   `y > 1`, left of it for `y < −1` (`atan 2i` is `π/2 + 0.549i`,
  //   `atan(−2i)` is `−π/2 − 0.549i`).
  //
  // `_gpu_chypot` is `√(x² + y²)` without an overflow of `x²`;
  // `_gpu_clog1p` is `ln(1 + x)` for `x ≥ 0`, accurate for a small `x`
  // (neither language has `log1p`, see below); `_gpu_casinhr` is `asinh` of a real
  // value, accurate for a small and a large value (a driver's `asinh` can
  // be the formula `ln(x + √(x² + 1))`, which loses a small value and
  // overflows for a large one); `_gpu_czsign` is the sign of `y`, with `s`
  // as the sign of a zero; `_gpu_csqrts` is the principal square root, with
  // `s` as the sign of a zero imaginary part (`√(−4 − 0i)` is `−2i`).
  //
  _gpu_chypot: {
    deps: [],
    glsl: `float _gpu_chypot(float x, float y) {
  float ax = abs(x);
  float ay = abs(y);
  float m = max(ax, ay);
  if (m == 0.0) return 0.0;
  float n = min(ax, ay) / m;
  return m * sqrt(1.0 + n * n);
}`,
    wgsl: `fn _gpu_chypot(x: f32, y: f32) -> f32 {
  let ax = abs(x);
  let ay = abs(y);
  let m = max(ax, ay);
  if (m == 0.0) { return 0.0; }
  let n = min(ax, ay) / m;
  return m * sqrt(1.0 + n * n);
}`,
  },
  // `ln(1 + x)` for `x ≥ 0` (every caller passes a non-negative value).
  // For `x < 0.5` it is `2·atanh(s)` with `s = x/(2 + x)`, from the series
  // `2s·(1 + s²/3 + s⁴/5 + … + s¹⁰/11)`: `s ≤ 0.2`, so the first omitted
  // term is below `0.04⁶/13 ≈ 3·10⁻¹⁰` of the value. The built-in `log` is
  // not used there: GLSL.std.450 and WGSL allow it an ABSOLUTE error of 2⁻²¹
  // on [0.5, 2], a relative error of 0.5% for `ln(1 + 10⁻⁴)`, and the
  // classic `log(u)·x/(u − 1)` correction depends on `(1 + x) − 1` not being
  // folded to `x` by a fast-math compiler. For `x ≥ 0.5`, `ln(1 + x) ≥ 0.4`
  // and `log` is accurate enough.
  _gpu_clog1p: {
    deps: [],
    glsl: `float _gpu_clog1p(float x) {
  if (x >= 0.5) return log(1.0 + x);
  float s = x / (2.0 + x);
  float t = s * s;
  return 2.0 * s * (1.0 + t * (0.3333333333333333 + t * (0.2 + t * (0.14285714285714285 + t * (0.1111111111111111 + t * 0.09090909090909091)))));
}`,
    wgsl: `fn _gpu_clog1p(x: f32) -> f32 {
  if (x >= 0.5) { return log(1.0 + x); }
  let s = x / (2.0 + x);
  let t = s * s;
  return 2.0 * s * (1.0 + t * (0.3333333333333333 + t * (0.2 + t * (0.14285714285714285 + t * (0.1111111111111111 + t * 0.09090909090909091)))));
}`,
  },
  _gpu_casinhr: {
    deps: ['_gpu_clog1p'],
    glsl: `float _gpu_casinhr(float v) {
  float a = abs(v);
  float r = a > 1.0e9 ? log(a) + 0.6931471805599453 : _gpu_clog1p(a + a * a / (1.0 + sqrt(1.0 + a * a)));
  return v < 0.0 ? -r : r;
}`,
    wgsl: `fn _gpu_casinhr(v: f32) -> f32 {
  let a = abs(v);
  let r = select(_gpu_clog1p(a + a * a / (1.0 + sqrt(1.0 + a * a))), log(a) + 0.6931471805599453, a > 1.0e9);
  return select(r, -r, v < 0.0);
}`,
  },
  _gpu_czsign: {
    deps: [],
    glsl: `float _gpu_czsign(float y, float s) {
  return (y < 0.0 || (y == 0.0 && s < 0.0)) ? -1.0 : 1.0;
}`,
    wgsl: `fn _gpu_czsign(y: f32, s: f32) -> f32 {
  return select(1.0, -1.0, y < 0.0 || (y == 0.0 && s < 0.0));
}`,
  },
  _gpu_csqrts: {
    deps: ['_gpu_chypot', '_gpu_czsign'],
    glsl: `vec2 _gpu_csqrts(float x, float y, float s) {
  if (x == 0.0 && y == 0.0) return vec2(0.0);
  float h = _gpu_chypot(x, y);
  if (x >= 0.0) {
    float t = sqrt(0.5 * x + 0.5 * h);
    return vec2(t, y / (2.0 * t));
  }
  float t = sqrt(0.5 * h - 0.5 * x);
  return vec2(abs(y) / (2.0 * t), _gpu_czsign(y, s) * t);
}`,
    wgsl: `fn _gpu_csqrts(x: f32, y: f32, s: f32) -> vec2f {
  if (x == 0.0 && y == 0.0) { return vec2f(0.0); }
  let h = _gpu_chypot(x, y);
  if (x >= 0.0) {
    let t = sqrt(0.5 * x + 0.5 * h);
    return vec2f(t, y / (2.0 * t));
  }
  let t = sqrt(0.5 * h - 0.5 * x);
  return vec2f(abs(y) / (2.0 * t), _gpu_czsign(y, s) * t);
}`,
  },
  // `asin(x + iy)`, with `s` the sign of a zero `y`.
  // Re: atan2(x, Re(√(1 − z)·√(1 + z))).
  // Im: asinh(Im(conj(√(1 − z))·√(1 + z))).
  _gpu_casin_core: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_casin_core(float x0, float y0, float s) {
  float x = x0;
  float y = y0;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  vec2 a = _gpu_csqrts(1.0 - x, -y, -s);
  vec2 b = _gpu_csqrts(1.0 + x, y, s);
  float im = _gpu_casinhr(a.x * b.y - a.y * b.x);
  return vec2(atan(x, a.x * b.x - a.y * b.y), im < 0.0 ? im - k : im + k);
}`,
    wgsl: `fn _gpu_casin_core(x0: f32, y0: f32, s: f32) -> vec2f {
  var x = x0;
  var y = y0;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let a = _gpu_csqrts(1.0 - x, -y, -s);
  let b = _gpu_csqrts(1.0 + x, y, s);
  let im = _gpu_casinhr(a.x * b.y - a.y * b.x);
  return vec2f(atan2(x, a.x * b.x - a.y * b.y), select(im + k, im - k, im < 0.0));
}`,
  },
  _gpu_casin: {
    deps: ['_gpu_casin_core'],
    glsl: `vec2 _gpu_casin(vec2 z) {
  return _gpu_casin_core(z.x, z.y, z.x > 0.0 ? -1.0 : 1.0);
}`,
    wgsl: `fn _gpu_casin(z: vec2f) -> vec2f {
  return _gpu_casin_core(z.x, z.y, select(1.0, -1.0, z.x > 0.0));
}`,
  },
  // Re: 2·atan2(Re √(1 − z), Re √(1 + z)).
  // Im: asinh(Im(conj(√(1 + z))·√(1 − z))).
  _gpu_cacos: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_cacos(vec2 z) {
  float x = z.x;
  float y = z.y;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  float s = z.x > 0.0 ? -1.0 : 1.0;
  vec2 a = _gpu_csqrts(1.0 - x, -y, -s);
  vec2 b = _gpu_csqrts(1.0 + x, y, s);
  float im = _gpu_casinhr(b.x * a.y - b.y * a.x);
  return vec2(2.0 * atan(a.x, b.x), im < 0.0 ? im - k : im + k);
}`,
    wgsl: `fn _gpu_cacos(z: vec2f) -> vec2f {
  var x = z.x;
  var y = z.y;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let s = select(1.0, -1.0, z.x > 0.0);
  let a = _gpu_csqrts(1.0 - x, -y, -s);
  let b = _gpu_csqrts(1.0 + x, y, s);
  let im = _gpu_casinhr(b.x * a.y - b.y * a.x);
  return vec2f(2.0 * atan2(a.x, b.x), select(im + k, im - k, im < 0.0));
}`,
  },
  // `atanh(x + iy)`, with `s` the sign of a zero `y`.
  // Re: ¼·ln(1 + 4|x|/|1 − |x| − iy|²), with the sign of x.
  // Im: ½·atan2(2y, (1 − x)(1 + x) − y²).
  // For |z| > 10¹⁸, where |z|² could overflow, the value is 1/z to a
  // relative error of about 1/|z|²: the real part is x/|z|², the imaginary
  // part ½·atan2(2y/|z|², −1), and |z|/4 (`h4`) is used in place of |z|.
  // When |1 − z|² is below 10⁻³⁰ (z very close to ±1), the real part is the
  // difference of two logarithms, which has no cancellation there.
  _gpu_catanh_core: {
    deps: ['_gpu_chypot', '_gpu_clog1p', '_gpu_czsign'],
    glsl: `vec2 _gpu_catanh_core(float x, float y, float s) {
  if (_gpu_chypot(x, y) > 1.0e18) {
    float h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    float q = y / 8.0 / h4 / h4;
    return vec2(x / 16.0 / h4 / h4, q == 0.0 ? _gpu_czsign(y, s) * 1.5707963267948966 : 0.5 * atan(q, -1.0));
  }
  float ax = abs(x);
  float u = 1.0 - ax;
  float d = u * u + y * y;
  float re = d < 1.0e-30 ? 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))) : 0.25 * _gpu_clog1p(4.0 * ax / d);
  float m = u * (1.0 + ax) - y * y;
  float im = 2.0 * y == 0.0 ? (m < 0.0 ? _gpu_czsign(y, s) * 1.5707963267948966 : 0.0) : 0.5 * atan(2.0 * y, m);
  return vec2(x < 0.0 ? -re : re, im);
}`,
    wgsl: `fn _gpu_catanh_core(x: f32, y: f32, s: f32) -> vec2f {
  if (_gpu_chypot(x, y) > 1.0e18) {
    let h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    let q = y / 8.0 / h4 / h4;
    return vec2f(x / 16.0 / h4 / h4, select(0.5 * atan2(q, -1.0), _gpu_czsign(y, s) * 1.5707963267948966, q == 0.0));
  }
  let ax = abs(x);
  let u = 1.0 - ax;
  let d = u * u + y * y;
  let re = select(0.25 * _gpu_clog1p(4.0 * ax / d), 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))), d < 1.0e-30);
  let m = u * (1.0 + ax) - y * y;
  let im = select(0.5 * atan2(2.0 * y, m), select(0.0, _gpu_czsign(y, s) * 1.5707963267948966, m < 0.0), 2.0 * y == 0.0);
  return vec2f(select(re, -re, x < 0.0), im);
}`,
  },
  _gpu_catanh: {
    deps: ['_gpu_catanh_core'],
    glsl: `vec2 _gpu_catanh(vec2 z) {
  return _gpu_catanh_core(z.x, z.y, z.x > 0.0 ? -1.0 : 1.0);
}`,
    wgsl: `fn _gpu_catanh(z: vec2f) -> vec2f {
  return _gpu_catanh_core(z.x, z.y, select(1.0, -1.0, z.x > 0.0));
}`,
  },
  // atan z = −i·atanh(iz), with iz = −y + ix. A zero x takes the sign of y:
  // the side right of the imaginary axis for y > 1, left of it for y < −1
  // (`atan(−2i)` is `−π/2 − 0.549i`, so atan is odd on the cut). At the
  // poles ±i the interpreter gives the unsigned infinity `~oo`, which a
  // `vec2` holds as `(∞, ∞)`, as the JavaScript target does (`complexPole()`
  // in `javascript-target.ts`).
  _gpu_catan: {
    deps: ['_gpu_catanh_core', '_gpu_inf'],
    glsl: `vec2 _gpu_catan(vec2 z) {
  if (z.x == 0.0 && abs(z.y) == 1.0) return vec2(_gpu_inf(), _gpu_inf());
  vec2 r = _gpu_catanh_core(-z.y, z.x, z.y < 0.0 ? -1.0 : 1.0);
  return vec2(r.y, -r.x);
}`,
    wgsl: `fn _gpu_catan(z: vec2f) -> vec2f {
  if (z.x == 0.0 && abs(z.y) == 1.0) { return vec2f(_gpu_inf(), _gpu_inf()); }
  let r = _gpu_catanh_core(-z.y, z.x, select(1.0, -1.0, z.y < 0.0));
  return vec2f(r.y, -r.x);
}`,
  },
  // asinh z = −i·asin(iz), with iz = −y + ix. A zero x takes the sign of y:
  // the side right of the imaginary axis for y > 1, left of it for y < −1.
  _gpu_casinh: {
    deps: ['_gpu_casin_core'],
    glsl: `vec2 _gpu_casinh(vec2 z) {
  vec2 r = _gpu_casin_core(-z.y, z.x, z.y < 0.0 ? -1.0 : 1.0);
  return vec2(r.y, -r.x);
}`,
    wgsl: `fn _gpu_casinh(z: vec2f) -> vec2f {
  let r = _gpu_casin_core(-z.y, z.x, select(1.0, -1.0, z.y < 0.0));
  return vec2f(r.y, -r.x);
}`,
  },
  // Re: asinh(Re(conj(√(z − 1))·√(z + 1))).
  // Im: 2·atan2(Im √(z − 1), Re √(z + 1)).
  // A zero y takes the sign +1: the side above the real axis.
  _gpu_cacosh: {
    deps: ['_gpu_csqrts', '_gpu_casinhr'],
    glsl: `vec2 _gpu_cacosh(vec2 z) {
  float x = z.x;
  float y = z.y;
  float k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  vec2 a = _gpu_csqrts(x - 1.0, y, 1.0);
  vec2 b = _gpu_csqrts(x + 1.0, y, 1.0);
  return vec2(_gpu_casinhr(a.x * b.x + a.y * b.y) + k, 2.0 * atan(a.y, b.x));
}`,
    wgsl: `fn _gpu_cacosh(z: vec2f) -> vec2f {
  var x = z.x;
  var y = z.y;
  var k = 0.0;
  if (max(abs(x), abs(y)) > 1.0e37) {
    x = x * 0.0625;
    y = y * 0.0625;
    k = 2.772588722239781;
  }
  let a = _gpu_csqrts(x - 1.0, y, 1.0);
  let b = _gpu_csqrts(x + 1.0, y, 1.0);
  return vec2f(_gpu_casinhr(a.x * b.x + a.y * b.y) + k, 2.0 * atan2(a.y, b.x));
}`,
  },
  // `1/z` by Smith's method: the quotient is formed from the ratio of the
  // smaller part to the larger, so `|z|²` is never computed and does not
  // overflow for |z| above 1.8·10¹⁹ (`_gpu_cdiv` forms `|z|²`). The inverse
  // reciprocal functions (`_gpu_cacsc`, `_gpu_casec`, `_gpu_casech`) use it.
  _gpu_cinv: {
    deps: [],
    glsl: `vec2 _gpu_cinv(vec2 z) {
  if (abs(z.x) >= abs(z.y)) {
    float r = z.y / z.x;
    float d = z.x + z.y * r;
    return vec2(1.0 / d, -r / d);
  }
  float r = z.x / z.y;
  float d = z.x * r + z.y;
  return vec2(r / d, -1.0 / d);
}`,
    wgsl: `fn _gpu_cinv(z: vec2f) -> vec2f {
  if (abs(z.x) >= abs(z.y)) {
    let r = z.y / z.x;
    let d = z.x + z.y * r;
    return vec2f(1.0 / d, -r / d);
  }
  let r = z.x / z.y;
  let d = z.x * r + z.y;
  return vec2f(r / d, -1.0 / d);
}`,
  },
  //
  // The inverse reciprocal functions: arccsc z = asin(1/z),
  // arcsec z = acos(1/z), arsech z = acosh(1/z), arcoth z = atanh(1/z).
  //
  // They use the formulas of `asin`, `acos`, `acosh` and `atanh` above, but
  // they do not compute `w = 1/z` and then `1 ± w`: near a branch point
  // (`z = ±1`), `1 ± w` cancels and the rounding of `1/z` is amplified. For
  // `|z| ≤ 2`, `1 ± w` is computed as `(z ± 1)·(1/z)`, where `z ± 1` is
  // exact or nearly so; for `|z| > 2`, `|w| < 1/2` and `1 ± w` does not
  // cancel. This is the method of the interpreter (`complexAcsc()` and the
  // others in `numerics/numeric-complex.ts`). `arcoth` is computed from `z`
  // directly, as `½·ln((z + 1)/(z − 1))`.
  //
  // The side of each branch cut is the interpreter's: for a real `z`, the
  // side the function of `w` takes for the real `w = 1/z` (`arccsc 0.5` is
  // `asin 2`, `π/2 − 1.317i`; `arsech(−0.5)` is `1.317 + πi`; `arcoth 0.5`
  // is `0.549 − (π/2)i`, `arcoth(−0.5)` is `−0.549 + (π/2)i`). For a
  // non-real `z`, a part of `1 ± w` that rounds to zero takes the sign of
  // that part of `w`, whose imaginary part has the sign of `−Im z`.
  //
  // For `|z| < 10⁻¹⁸`, `1/z` can overflow (above 3.4·10³⁸ for a subnormal
  // `|z|`), and `arccsc`, `arcsec` and `arsech` use the first term of their
  // expansion at `w = 1/z = ∞`, whose relative error is about `|z|²`. With
  // `l = ln(2/|z|)` and `s` the sign of a zero imaginary part of `w` (see
  // below): `arccsc z = atan2(x, |y|) + s·l·i`,
  // `arcsec z = atan2(|y|, x) − s·l·i`, and
  // `arsech z = l − arg(z)·i`, with `π` in place of `−π` on the negative
  // real axis. `arsech 0` is `+∞`, as in the interpreter.
  // `_gpu_cln2z(z)` is `l`; `z` is scaled by 2⁶⁴ (exactly) before the
  // logarithm so that a subnormal `|z|` keeps its digits.
  _gpu_cln2z: {
    deps: ['_gpu_chypot'],
    glsl: `float _gpu_cln2z(vec2 z) {
  return 45.054566736396445 - log(_gpu_chypot(z.x * 18446744073709551616.0, z.y * 18446744073709551616.0));
}`,
    wgsl: `fn _gpu_cln2z(z: vec2f) -> f32 {
  return 45.054566736396445 - log(_gpu_chypot(z.x * 18446744073709551616.0, z.y * 18446744073709551616.0));
}`,
  },
  // `_gpu_cinvpm(z, t)` is `1 + t/z`, for `t` = ±1.
  _gpu_cinvpm: {
    deps: ['_gpu_cinv', '_gpu_chypot'],
    glsl: `vec2 _gpu_cinvpm(vec2 z, float t) {
  vec2 w = _gpu_cinv(z);
  if (_gpu_chypot(z.x, z.y) > 2.0) return vec2(1.0 + t * w.x, t * w.y);
  float nx = z.x + t;
  return vec2(nx * w.x - z.y * w.y, nx * w.y + z.y * w.x);
}`,
    wgsl: `fn _gpu_cinvpm(z: vec2f, t: f32) -> vec2f {
  let w = _gpu_cinv(z);
  if (_gpu_chypot(z.x, z.y) > 2.0) { return vec2f(1.0 + t * w.x, t * w.y); }
  let nx = z.x + t;
  return vec2f(nx * w.x - z.y * w.y, nx * w.y + z.y * w.x);
}`,
  },
  // asin(w): Re atan2(Re w, Re(√(1 − w)·√(1 + w))),
  // Im asinh(Im(conj(√(1 − w))·√(1 + w))). `s` is the sign of a zero
  // imaginary part of `w`.
  _gpu_cacsc: {
    deps: [
      '_gpu_cinv',
      '_gpu_cinvpm',
      '_gpu_csqrts',
      '_gpu_casinhr',
      '_gpu_cln2z',
    ],
    glsl: `vec2 _gpu_cacsc(vec2 z) {
  float s = z.y == 0.0 ? (z.x > 0.0 ? -1.0 : 1.0) : (z.y > 0.0 ? -1.0 : 1.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) return vec2(atan(z.x, abs(z.y)), s * _gpu_cln2z(z));
  vec2 w = _gpu_cinv(z);
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(p.x, p.y, -s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(atan(w.x, a.x * b.x - a.y * b.y), _gpu_casinhr(a.x * b.y - a.y * b.x));
}`,
    wgsl: `fn _gpu_cacsc(z: vec2f) -> vec2f {
  let s = select(select(1.0, -1.0, z.y > 0.0), select(1.0, -1.0, z.x > 0.0), z.y == 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) { return vec2f(atan2(z.x, abs(z.y)), s * _gpu_cln2z(z)); }
  let w = _gpu_cinv(z);
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(p.x, p.y, -s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(atan2(w.x, a.x * b.x - a.y * b.y), _gpu_casinhr(a.x * b.y - a.y * b.x));
}`,
  },
  // acos(w): Re 2·atan2(Re √(1 − w), Re √(1 + w)),
  // Im asinh(Im(conj(√(1 + w))·√(1 − w))).
  _gpu_casec: {
    deps: ['_gpu_cinvpm', '_gpu_csqrts', '_gpu_casinhr', '_gpu_cln2z'],
    glsl: `vec2 _gpu_casec(vec2 z) {
  float s = z.y == 0.0 ? (z.x > 0.0 ? -1.0 : 1.0) : (z.y > 0.0 ? -1.0 : 1.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) return vec2(atan(abs(z.y), z.x), -s * _gpu_cln2z(z));
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(p.x, p.y, -s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(2.0 * atan(a.x, b.x), _gpu_casinhr(b.x * a.y - b.y * a.x));
}`,
    wgsl: `fn _gpu_casec(z: vec2f) -> vec2f {
  let s = select(select(1.0, -1.0, z.y > 0.0), select(1.0, -1.0, z.x > 0.0), z.y == 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18 && (z.x != 0.0 || z.y != 0.0)) { return vec2f(atan2(abs(z.y), z.x), -s * _gpu_cln2z(z)); }
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(p.x, p.y, -s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(2.0 * atan2(a.x, b.x), _gpu_casinhr(b.x * a.y - b.y * a.x));
}`,
  },
  // acosh(w): Re asinh(Re(conj(√(w − 1))·√(w + 1))),
  // Im 2·atan2(Im √(w − 1), Re √(w + 1)). For a real z, a zero imaginary
  // part takes the sign +1: the side above the cut.
  _gpu_casech: {
    // `_gpu_inf` is not a complex helper: `preambleFor()` adds it, before
    // the complex helpers on GLSL, when a complex helper calls it.
    deps: [
      '_gpu_cinvpm',
      '_gpu_csqrts',
      '_gpu_casinhr',
      '_gpu_cln2z',
      '_gpu_inf',
    ],
    glsl: `vec2 _gpu_casech(vec2 z) {
  if (z.x == 0.0 && z.y == 0.0) return vec2(_gpu_inf(), 0.0);
  if (_gpu_chypot(z.x, z.y) < 1.0e-18) return vec2(_gpu_cln2z(z), z.y == 0.0 && z.x < 0.0 ? 3.141592653589793 : -atan(z.y, z.x));
  float s = z.y > 0.0 ? -1.0 : 1.0;
  vec2 p = _gpu_cinvpm(z, -1.0);
  vec2 q = _gpu_cinvpm(z, 1.0);
  vec2 a = _gpu_csqrts(-p.x, -p.y, s);
  vec2 b = _gpu_csqrts(q.x, q.y, s);
  return vec2(_gpu_casinhr(a.x * b.x + a.y * b.y), 2.0 * atan(a.y, b.x));
}`,
    wgsl: `fn _gpu_casech(z: vec2f) -> vec2f {
  if (z.x == 0.0 && z.y == 0.0) { return vec2f(_gpu_inf(), 0.0); }
  if (_gpu_chypot(z.x, z.y) < 1.0e-18) { return vec2f(_gpu_cln2z(z), select(-atan2(z.y, z.x), 3.141592653589793, z.y == 0.0 && z.x < 0.0)); }
  let s = select(1.0, -1.0, z.y > 0.0);
  let p = _gpu_cinvpm(z, -1.0);
  let q = _gpu_cinvpm(z, 1.0);
  let a = _gpu_csqrts(-p.x, -p.y, s);
  let b = _gpu_csqrts(q.x, q.y, s);
  return vec2f(_gpu_casinhr(a.x * b.x + a.y * b.y), 2.0 * atan2(a.y, b.x));
}`,
  },
  // arcoth z = ½·ln((z + 1)/(z − 1)). Re: ¼·ln(1 + 4|x|/|1 − |x| − iy|²),
  // with the sign of x, as in `_gpu_catanh_core`. Im: ½·atan2(−2y,
  // x² + y² − 1); for a real z in (−1, 1), −π/2 when z > 0 and π/2
  // otherwise. For |z| > 10¹⁸ the value is 1/z to a relative error of about
  // 1/|z|², with |z|/4 (`h4`) in place of |z|.
  _gpu_cacoth: {
    deps: ['_gpu_chypot', '_gpu_clog1p'],
    glsl: `vec2 _gpu_cacoth(vec2 z) {
  float x = z.x;
  float y = z.y;
  if (_gpu_chypot(x, y) > 1.0e18) {
    float h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    return vec2(x / 16.0 / h4 / h4, -y / 16.0 / h4 / h4);
  }
  float ax = abs(x);
  float u = 1.0 - ax;
  float d = u * u + y * y;
  float re = d < 1.0e-30 ? 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))) : 0.25 * _gpu_clog1p(4.0 * ax / d);
  float m = (ax - 1.0) * (ax + 1.0) + y * y;
  float im = 2.0 * y == 0.0 ? (m < 0.0 ? (x > 0.0 ? -1.5707963267948966 : 1.5707963267948966) : 0.0) : 0.5 * atan(-2.0 * y, m);
  return vec2(x < 0.0 ? -re : re, im);
}`,
    wgsl: `fn _gpu_cacoth(z: vec2f) -> vec2f {
  let x = z.x;
  let y = z.y;
  if (_gpu_chypot(x, y) > 1.0e18) {
    let h4 = _gpu_chypot(0.25 * x, 0.25 * y);
    return vec2f(x / 16.0 / h4 / h4, -y / 16.0 / h4 / h4);
  }
  let ax = abs(x);
  let u = 1.0 - ax;
  let d = u * u + y * y;
  let re = select(0.25 * _gpu_clog1p(4.0 * ax / d), 0.5 * (log(_gpu_chypot(1.0 + ax, y)) - log(_gpu_chypot(u, y))), d < 1.0e-30);
  let m = (ax - 1.0) * (ax + 1.0) + y * y;
  let im = select(0.5 * atan2(-2.0 * y, m), select(0.0, select(1.5707963267948966, -1.5707963267948966, x > 0.0), m < 0.0), 2.0 * y == 0.0);
  return vec2f(select(re, -re, x < 0.0), im);
}`,
  },
};

/**
 * Build a minimal complex preamble containing only the helper functions
 * actually referenced by `code`, plus their transitive dependencies,
 * emitted in topological (dependency-first) order.
 */
function buildComplexPreamble(code: string, language: string): string {
  // 1. Find all _gpu_c* calls in the compiled code
  const needed = new Set<string>();
  for (const name of Object.keys(GPU_COMPLEX_FUNCTIONS)) {
    if (code.includes(name)) needed.add(name);
  }
  if (needed.size === 0) return '';

  // 2. Resolve transitive dependencies
  const resolved = new Set<string>();
  function resolve(name: string): void {
    if (resolved.has(name)) return;
    const def = GPU_COMPLEX_FUNCTIONS[name];
    if (!def) return;
    for (const dep of def.deps) resolve(dep);
    resolved.add(name);
  }
  for (const name of needed) resolve(name);

  // 3. `resolved` is already in topological order (deps before dependents)
  const lang = language === 'wgsl' ? 'wgsl' : 'glsl';
  const parts: string[] = [];
  for (const name of resolved) {
    parts.push(GPU_COMPLEX_FUNCTIONS[name][lang]);
  }
  return '\n' + parts.join('\n\n') + '\n';
}

/** One helper function definition, cut out of a multi-function library. */
interface GpuLibraryDefinition {
  /** The declared function name, e.g. `_gpu_hsv_to_rgb`. */
  name: string;
  /** Its whole source, comments above it included, with no final newline. */
  source: string;
  /**
   * The blank lines that separate this definition from the one before it, kept
   * verbatim so that a subset containing EVERY definition reproduces the
   * library string byte for byte.
   */
  lead: string;
  /** Matches this definition's name as a whole word. */
  reference: RegExp;
  /**
   * The indices of the definitions this one CALLS. Computed once, when the
   * library is split, because it is a property of the library text and never
   * of the compilation asking for a subset.
   */
  calls: number[];
}

/**
 * The split of each library string, kept so a library is parsed once per
 * process rather than once per compilation. The key is the library text
 * itself, which is a module constant and never changes.
 */
const GPU_LIBRARY_DEFINITIONS = new Map<string, GpuLibraryDefinition[]>();

/**
 * The head of a top-level function definition, anchored at column 0 — `fn
 * _gpu_x(` in WGSL, `vec3 _gpu_x(` or `float _gpu_x(` in GLSL. Every
 * definition in these library strings starts in column 0 and everything
 * inside a body is indented, so the anchor is what tells a declaration apart
 * from a local variable of the same shape.
 */
const GPU_LIBRARY_DEFINITION_HEAD =
  /^(?:fn[^\S\n]+([A-Za-z_]\w*)|[A-Za-z_]\w*(?:\[\d+\])?[^\S\n]+([A-Za-z_]\w*))[^\S\n]*\(/;

/** Cut a multi-function library string into its individual definitions. */
function gpuLibraryDefinitions(library: string): GpuLibraryDefinition[] {
  const cached = GPU_LIBRARY_DEFINITIONS.get(library);
  if (cached !== undefined) return cached;
  const defs: GpuLibraryDefinition[] = [];
  let lines: string[] = [];
  let lead = '';
  let name: string | undefined;
  let depth = 0;
  for (const line of library.split('\n')) {
    // A blank line between two definitions belongs to neither; it is kept as
    // the next definition's separator.
    if (lines.length === 0 && line.trim() === '') {
      lead += '\n';
      continue;
    }
    lines.push(line);
    // A line comment can hold a brace, and one of these libraries does hold a
    // comment with braces in it, so the depth count reads the code only.
    const code = line.replace(/\/\/.*$/, '');
    if (name === undefined) {
      const head = GPU_LIBRARY_DEFINITION_HEAD.exec(code);
      if (head !== null) name = head[1] ?? head[2];
    }
    for (const c of code) {
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
    }
    if (name !== undefined && depth === 0 && code.includes('}')) {
      defs.push({
        name,
        source: lines.join('\n'),
        lead,
        reference: new RegExp(`(?<![\\w$])${name}(?![\\w$])`),
        calls: [],
      });
      lines = [];
      lead = '';
      name = undefined;
    }
  }
  // A definition can only call one declared BEFORE it: both languages require
  // a declaration to precede its use, so a library string is written in
  // dependency order and the search is over the earlier entries alone.
  for (let i = 0; i < defs.length; i++)
    for (let j = 0; j < i; j++)
      if (defs[j].reference.test(defs[i].source)) defs[i].calls.push(j);
  GPU_LIBRARY_DEFINITIONS.set(library, defs);
  return defs;
}

/**
 * The definitions of `library` that `code` actually needs — the ones it names,
 * plus everything those call, in the library's own order.
 *
 * A shader preamble is compiled by the driver with the shader, once per
 * program, so an unused definition is paid for on every first draw. Before
 * this pass a single `hsv` conversion carried all fourteen colour-space
 * functions (6.1 KB), and a Mandelbrot row carried the Julia iteration.
 * (Measured by the Tycho code-generation audit of 2026-09-08.)
 *
 * The pass runs BACKWARD because a library's source order is already its
 * dependency order: both languages require a function to be declared before
 * it is called, so a definition can only be called by a LATER one. One
 * backward sweep therefore closes the set, and emitting the survivors in
 * source order keeps the declaration-before-use property.
 */
export function gpuLibrarySubset(code: string, library: string): string {
  const defs = gpuLibraryDefinitions(library);
  const keep: boolean[] = defs.map((d) => d.reference.test(code));
  for (let i = defs.length - 1; i >= 0; i--)
    if (keep[i]) for (const j of defs[i].calls) keep[j] = true;
  let preamble = '';
  for (const d of defs.filter((_d, i) => keep[i]))
    preamble += `${preamble === '' ? d.lead || '\n' : d.lead}${d.source}\n`;
  return preamble;
}

/**
 * GLSL NaN helper preamble. Centralizes the masked/else-branch NaN (`When` /
 * `Which` fall-through) into a single overridable symbol.
 *
 * GLSL has no `NaN` literal. The target assumes GLSL ES 3.00 (`#version
 * 300 es`), where `intBitsToFloat(0x7FC00000)` yields a guaranteed NaN bit
 * pattern. Routing every masked NaN through one helper lets a host redefine
 * what a masked branch produces (e.g. a sentinel value) without touching the
 * generated code. The current body is pinned by `compile-glsl.test.ts`.
 */
const GPU_NAN_PREAMBLE_GLSL = `
float _gpu_nan() {
  return intBitsToFloat(0x7FC00000);
}
`;

/**
 * GLSL infinity helper preamble — the `+∞` counterpart of
 * `GPU_NAN_PREAMBLE_GLSL`, structured identically so a host can redefine it in
 * the same way.
 *
 * `intBitsToFloat(0x7F800000)` is the IEEE-754 `+∞` bit pattern (same
 * GLSL ES 3.00 builtin the NaN helper uses, so no extra version requirement).
 * Deliberately NOT `1.0 / 0.0`: fast-math is licensed to fold a division by a
 * constant zero, and this project has already been bitten by ANGLE→Metal
 * fast-math. A bit pattern is not foldable.
 */
const GPU_INF_PREAMBLE_GLSL = `
float _gpu_inf() {
  return intBitsToFloat(0x7F800000);
}
`;

/**
 * WGSL NaN and +∞ helpers, the WGSL counterparts of `GPU_NAN_PREAMBLE_GLSL`
 * and `GPU_INF_PREAMBLE_GLSL`, with the same names so that emitted code and
 * helper bodies spell a non-finite value the same way on both targets.
 *
 * WGSL has no NaN or infinity literal, and it cannot build one from a
 * constant: a const-expression that evaluates to NaN or an infinity is a
 * shader-creation error, so the inline constant `bitcast<f32>(0x7fc00000u)`
 * and `0.0 / 0.0` are both rejected (Chrome's WGSL compiler reports "value nan cannot be
 * represented as 'f32'"). A `let` is not a const-expression, so the bitcast
 * of a `let` holding the bit pattern is evaluated at run time and gives the
 * value. Measured in Chrome 153 on an Apple M5 GPU: the helpers compile and
 * read back as NaN and +∞. WGSL declarations are order-independent, so
 * `preambleFor` adds these after scanning the whole preamble.
 */
const GPU_NAN_PREAMBLE_WGSL = `
fn _gpu_nan() -> f32 {
  let bits = 0x7fc00000u;
  return bitcast<f32>(bits);
}
`;

const GPU_INF_PREAMBLE_WGSL = `
fn _gpu_inf() -> f32 {
  let bits = 0x7f800000u;
  return bitcast<f32>(bits);
}
`;

/**
 * Sign-preserving integer power (GLSL syntax). GLSL `pow(x, n)` is
 * `exp2(n·log2(x))`, undefined for a negative base — it returns `+8` for
 * `pow(-2.0, 3.0)` (wrong sign) and NaN for even powers of a negative. Compute
 * the magnitude from `abs(x)` and restore the sign for odd exponents. `n` is an
 * integer value of EITHER sign (a run-time exponent declared `integer` can be
 * negative); matches JS `Math.pow` for integer exponents (including
 * `0^0 = 1`). The parity test is taken on `abs(n)` because the two languages
 * disagree on the remainder of a negative operand: GLSL `mod` is floored
 * (`mod(-3.0, 2.0)` is 1.0) while WGSL `%` is truncated (`-3.0 % 2.0` is
 * -1.0), so a bare `n` would miss the odd branch on WGSL and answer `+0.125`
 * for `_gpu_powi(-2.0, -3.0)` where -0.125 is right.
 */
export const GPU_POWI_PREAMBLE_GLSL = `
float _gpu_powi(float x, float n) {
  if (n == 0.0) return 1.0;
  if (n == 2.0) return x * x;
  if (n == 3.0) return x * x * x;
  if (n == 4.0) { float s = x * x; return s * s; }
  float r = pow(abs(x), n);
  if (x < 0.0 && mod(abs(n), 2.0) == 1.0) return -r;
  return r;
}
`;

/**
 * Sign-preserving integer power (WGSL syntax). See GPU_POWI_PREAMBLE_GLSL.
 */
export const GPU_POWI_PREAMBLE_WGSL = `
fn _gpu_powi(x: f32, n: f32) -> f32 {
  if (n == 0.0) { return 1.0; }
  if (n == 2.0) { return x * x; }
  if (n == 3.0) { return x * x * x; }
  if (n == 4.0) { let s = x * x; return s * s; }
  let r = pow(abs(x), n);
  if (x < 0.0 && (abs(n) % 2.0) == 1.0) { return -r; }
  return r;
}
`;

/**
 * `cos(πu)` and `sin(πu)` (GLSL syntax), with the angle `u` in half-turns
 * reduced exactly before the multiplication by π, as `cosSinPi()`
 * (`numerics/numeric-complex.ts`) does: `u` is written `t + q/2` with
 * `|t| ≤ 1/4`, both steps exact in floating point, so the value at an
 * integer or a half-integer `u` has an exact zero part. `sin(πx)` at `x = 2`
 * is `0`, where `sin(3.14159274 * 2.0)` is not. A zero part is `+0.0`
 * (`1/sin(πx)` at `x = 1` is `+∞`). `_gpu_cossinpi(u)` is also `e^{iπu}` as
 * a `vec2`. See `BaseCompiler.piMultiple`.
 */
const GPU_PI_TRIG_PREAMBLE_GLSL = `
vec2 _gpu_cossinpi(float u) {
  float r = u - 2.0 * floor(u / 2.0 + 0.5);
  float q = floor(2.0 * r + 0.5);
  float t = r - q / 2.0;
  float c = cos(3.141592653589793 * t);
  float s = sin(3.141592653589793 * t);
  float k = q + 4.0 - 4.0 * floor((q + 4.0) / 4.0);
  vec2 v = vec2(s, -c);
  if (k == 0.0) v = vec2(c, s);
  if (k == 1.0) v = vec2(-s, c);
  if (k == 2.0) v = vec2(-c, -s);
  return vec2(v.x == 0.0 ? 0.0 : v.x, v.y == 0.0 ? 0.0 : v.y);
}
float _gpu_sinpi(float u) {
  return _gpu_cossinpi(u).y;
}
float _gpu_cospi(float u) {
  return _gpu_cossinpi(u).x;
}
float _gpu_tanpi(float u) {
  vec2 cs = _gpu_cossinpi(u);
  return cs.y == 0.0 ? 0.0 : cs.y / cs.x;
}
`;

/** `cos(πu)` and `sin(πu)` (WGSL syntax). See `GPU_PI_TRIG_PREAMBLE_GLSL`. */
const GPU_PI_TRIG_PREAMBLE_WGSL = `
fn _gpu_cossinpi(u: f32) -> vec2f {
  let r = u - 2.0 * floor(u / 2.0 + 0.5);
  let q = floor(2.0 * r + 0.5);
  let t = r - q / 2.0;
  let c = cos(3.141592653589793 * t);
  let s = sin(3.141592653589793 * t);
  let k = q + 4.0 - 4.0 * floor((q + 4.0) / 4.0);
  var v = vec2f(s, -c);
  if (k == 0.0) { v = vec2f(c, s); }
  if (k == 1.0) { v = vec2f(-s, c); }
  if (k == 2.0) { v = vec2f(-c, -s); }
  return vec2f(select(v.x, 0.0, v.x == 0.0), select(v.y, 0.0, v.y == 0.0));
}
fn _gpu_sinpi(u: f32) -> f32 {
  return _gpu_cossinpi(u).y;
}
fn _gpu_cospi(u: f32) -> f32 {
  return _gpu_cossinpi(u).x;
}
fn _gpu_tanpi(u: f32) -> f32 {
  let cs = _gpu_cossinpi(u);
  return select(cs.y / cs.x, 0.0, cs.y == 0.0);
}
`;

/**
 * The shader code of the step form `Floor(x, step)`, `Ceil(x, step)` or
 * `Truncate(x, step)`: `round(q) * k` with `k = |step|` and `q = x / k`,
 * where `round` is `floor`, `ceil` or `trunc`, and `q` is taken to the
 * nearest integer when it is within 4 ulps (of `f32`) of it: the float of a
 * decimal step is not the decimal, and `0.3 / 0.1` is not `3` (the
 * JavaScript runtime's `_SYS.floorStep` does the same).
 *
 * A scalar operand goes through the `_gpu_step_quotient` preamble helper
 * (`GPU_ROUND_PREAMBLE_GLSL`), which writes it once. A `vecN` operand uses
 * the same computation inline, made of componentwise functions only: there
 * `step(d, t)` is `1` when the distance `d` to the nearest integer is at
 * most the tolerance `t`, and `mix` then takes that integer. The inline form
 * splices the operand more than once, so an impure operand (a draw from the
 * `Random` family) is bound to a hoisted temporary (`gpuOperandOnce`), and
 * so is an impure step, which both forms splice twice.
 *
 * A constant step is folded. A constant zero step fails closed: the result
 * is `NaN`, and neither language has a `NaN` literal.
 */
function gpuRoundToStep(
  round: string | ((q: string, isScalar: boolean) => string),
  x: Expression,
  step: Expression,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>,
  unit: 1 | 0.5 = 1
): string {
  const name = typeof round === 'string' ? round : 'Round';
  const apply = (q: string, isScalar: boolean) =>
    typeof round === 'string' ? `${round}(${q})` : round(q, isScalar);
  const c = tryGetConstant(step);
  if (c !== undefined && (c === 0 || !Number.isFinite(c)))
    throw new Error(
      `Could not compile \`${name}\` with a step of ${c}: the result is NaN, ` +
        `and the ${target.language ?? 'GPU'} target has no NaN literal.`
    );
  const k =
    c !== undefined
      ? formatFloat(Math.abs(c), target.language)
      : `abs(${gpuOperandOnce(name, step, compile, target)})`;
  // `unit` is the distance between two jumps of the quotient: 1 for
  // `Floor`, `Ceil` and `Truncate`, 0.5 for `Round`, whose quotient is
  // taken to the nearest half-integer (`_gpu_half_step_quotient`). The
  // tolerance is relative to the quotient only, so a non-zero quotient is
  // never taken to be `0`. A non-zero quotient that underflows to `0` (with
  // a finite step) keeps the sign of `x` as the smallest normal float
  // (`Ceil(1e-30, 1e30)` is `1e30`), and when the quotient overflows (with
  // a non-zero step), `x` is the nearest float to the multiple
  // (`_gpu_step_fix`). A zero step gives `NaN`. The operand is spliced more
  // than once, so an impure one is bound to a hoisted temporary
  // (`gpuOperandOnce`).
  if (gpuOperandShape(x) === 'scalar') {
    const xc = gpuOperandOnce(name, x, compile, target);
    const helper =
      unit === 1 ? '_gpu_step_quotient' : '_gpu_half_step_quotient';
    const m = `${apply(`${helper}(${xc}, ${k})`, true)} * ${k}`;
    return `_gpu_step_fix(${m}, ${xc}, ${k})`;
  }
  const width = gpuOperandShape(x);
  if (typeof width !== 'number')
    throw new Error(
      `Could not compile \`${name}\` with a step: the operand is not a ` +
        `scalar or a vector.`
    );
  // A `vecN` operand: the same computation, componentwise. A choice between
  // two vectors is a SELECTION (`select` in WGSL, `mix` with a boolean
  // vector in GLSL), never the arithmetic `mix(a, b, t)`, which gives `NaN`
  // when the other branch is infinite. Both sides of a comparison are
  // vectors: WGSL has no comparison of a vector with a scalar.
  const isWGSL = target.language === 'wgsl';
  const vt = gpuVecType(width, isWGSL);
  const choose = (
    a: string,
    b: string,
    l: string,
    op: '<=' | '>' | '==',
    r: string
  ): string => {
    if (isWGSL) return `select(${a}, ${b}, ${l} ${op} ${r})`;
    const fn = { '<=': 'lessThanEqual', '>': 'greaterThan', '==': 'equal' }[op];
    return `mix(${a}, ${b}, ${fn}(${l}, ${r}))`;
  };
  // The operand, the step and the quotients are bound to temporaries when
  // the position has a statement before it (`BaseCompiler.canHoist`), so
  // that each is written once; otherwise they are spliced.
  const hoist = BaseCompiler.canHoist(target);
  const bind = (value: string, type: string): string => {
    if (!hoist || /^[A-Za-z_]\w*$/.test(value)) return value;
    const t = BaseCompiler.tempVar(target);
    BaseCompiler.hoistStatement(
      target,
      isWGSL ? `var ${t}: ${type} = ${value};` : `${type} ${t} = ${value};`
    );
    return t;
  };
  const xv = bind(gpuOperandOnce(name, x, compile, target), vt);
  const kv = c !== undefined ? k : bind(k, gpuScalarType(isWGSL));
  const q0 = bind(`(${xv} / ${kv})`, vt);
  // The smallest normal float of the sign of `x`, for a quotient that
  // underflows: `0` for an infinite step, whose quotient is truly `0`.
  const tiny =
    c !== undefined
      ? '1.17549435e-38'
      : isWGSL
        ? `select(0.0, 1.17549435e-38, ${kv} < 3.4e38)`
        : `(${kv} < 3.4e38 ? 1.17549435e-38 : 0.0)`;
  const q = bind(
    choose(q0, `(sign(${xv}) * ${tiny})`, q0, '==', `${vt}(0.0)`),
    vt
  );
  const r = unit === 1 ? `round(${q})` : `(round(${q} * 2.0) * 0.5)`;
  const snapped = bind(
    choose(q, r, `abs(${q} - ${r})`, '<=', `4.8e-7 * abs(${q})`),
    vt
  );
  const m = `(${apply(snapped, false)} * ${kv})`;
  // A zero step makes `abs(q0)·0` `NaN`, which is not `> 3.4e38`: the
  // result stays `NaN`.
  const big = c !== undefined ? `abs(${q0})` : `(abs(${q0}) * sign(${kv}))`;
  // Parenthesized: the outer call does not take the operands of the
  // rounding head one for one, and the operand-shape check
  // (`gpuCheckOperandShapes()`) reads an emission that starts with a call
  // as such a call.
  return `(${choose(m, xv, big, '>', `${vt}(3.4e38)`)})`;
}

/**
 * The shader code that rounds `c` to an integer, with a value halfway between
 * two integers rounded with the rule `ties` (see `RoundingTies`).
 *
 * Neither language's own `round()` can be used for a rule other than
 * `to-even`: both round a tie to the EVEN neighbour (GLSL leaves the choice
 * to the implementation; its `roundEven()` is defined to round to even).
 *
 * A SCALAR operand (`isScalar`) goes through a preamble helper
 * (`GPU_ROUND_PREAMBLE_GLSL`), which writes the operand once. A `vecN`
 * operand uses an inline form made of componentwise functions only. In that
 * form, `ceil(0.5 + 0.5 * sign(d - 0.5))` is `1` when `d ≥ 0.5` and `0`
 * otherwise, and `floor(…)` of the same value is `1` only when `d > 0.5`.
 *
 * The forms do not add `0.5` to the operand: in `f32`, `x + 0.5` is rounded
 * when `|x| ≥ 2²³`, and `floor(8388609.0 + 0.5)` is `8388610.0`. The
 * distance `d` to the floor of the magnitude is exact.
 */
function gpuRoundToInteger(
  c: string,
  ties: RoundingTies,
  isScalar: boolean,
  isWGSL: boolean
): string {
  if (ties === 'to-even') return isWGSL ? `round(${c})` : `roundEven(${c})`;
  if (isScalar) {
    const helper = {
      'away-from-zero': '_gpu_round',
      'toward-zero': '_gpu_round_tz',
      'toward-positive-infinity': '_gpu_round_up',
      'toward-negative-infinity': '_gpu_round_down',
    }[ties];
    return `${helper}(${c})`;
  }
  const atLeastHalf = (d: string) => `ceil(0.5 + 0.5 * sign(${d} - 0.5))`;
  const overHalf = (d: string) => `floor(0.5 + 0.5 * sign(${d} - 0.5))`;
  // The operand can be an infix expression (`v + w`): it is put in
  // parentheses where it is an operand of `-`.
  const x = /^[\w.]+$/.test(c) ? c : `(${c})`;
  const m = `floor(abs(${c}))`;
  switch (ties) {
    case 'away-from-zero':
      return `(sign(${c}) * (${m} + ${atLeastHalf(`abs(${c}) - ${m}`)}))`;
    case 'toward-zero':
      return `(sign(${c}) * (${m} + ${overHalf(`abs(${c}) - ${m}`)}))`;
    case 'toward-positive-infinity':
      return `(floor(${c}) + ${atLeastHalf(`${x} - floor(${c})`)})`;
    case 'toward-negative-infinity':
      return `(ceil(${c}) - ${atLeastHalf(`ceil(${c}) - ${x}`)})`;
  }
}

/**
 * The rounding helpers of `Round` for a scalar operand (GLSL syntax), one
 * for each tie rule other than `to-even` (see `gpuRoundToInteger()`):
 * `_gpu_round` rounds a tie away from zero (`Round(-2.5)` is -3,
 * `Round(2.5)` is 3), `_gpu_round_tz` toward zero, `_gpu_round_up` toward
 * `+∞` and `_gpu_round_down` toward `−∞`. `_gpu_step_quotient` and
 * `_gpu_half_step_quotient` are the quotients of the step forms, and
 * `_gpu_step_fix` their result when the quotient overflows
 * (`gpuRoundToStep()`). `gpuLibrarySubset()` keeps
 * only the helpers that a compilation calls.
 *
 * `step(0.5, d)` is `1` when `d ≥ 0.5`, and `1 - step(d, 0.5)` is `1` when
 * `d > 0.5`; it is added to `m` as one term, because `m + 1.0` is rounded
 * when `m ≥ 2²⁴`. The distance `d` to the floor (or the ceiling) is exact for a
 * magnitude, and for the other two helpers it can only be rounded UP to
 * `0.5`, from a value that must round the same way.
 */
const GPU_ROUND_PREAMBLE_GLSL = `
float _gpu_round(float x) {
  float a = abs(x);
  float m = floor(a);
  return sign(x) * (m + step(0.5, a - m));
}
float _gpu_round_tz(float x) {
  float a = abs(x);
  float m = floor(a);
  return sign(x) * (m + (1.0 - step(a - m, 0.5)));
}
float _gpu_round_up(float x) {
  float m = floor(x);
  return m + step(0.5, x - m);
}
float _gpu_round_down(float x) {
  float m = ceil(x);
  return m - step(0.5, m - x);
}
float _gpu_step_quotient(float x, float k) {
  float q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) return sign(x) * 1.17549435e-38;
  float r = round(q);
  return abs(q - r) <= 4.8e-7 * abs(q) ? r : q;
}
float _gpu_half_step_quotient(float x, float k) {
  float q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) return sign(x) * 1.17549435e-38;
  float r = round(q * 2.0) * 0.5;
  return abs(q - r) <= 4.8e-7 * abs(q) ? r : q;
}
float _gpu_step_fix(float m, float x, float k) {
  return k != 0.0 && abs(x / k) > 3.4e38 ? x : m;
}
`;

/** The rounding helpers of `Round` (WGSL syntax). See
 * `GPU_ROUND_PREAMBLE_GLSL`. */
const GPU_ROUND_PREAMBLE_WGSL = `
fn _gpu_round(x: f32) -> f32 {
  let a = abs(x);
  let m = floor(a);
  return sign(x) * (m + step(0.5, a - m));
}
fn _gpu_round_tz(x: f32) -> f32 {
  let a = abs(x);
  let m = floor(a);
  return sign(x) * (m + (1.0 - step(a - m, 0.5)));
}
fn _gpu_round_up(x: f32) -> f32 {
  let m = floor(x);
  return m + step(0.5, x - m);
}
fn _gpu_round_down(x: f32) -> f32 {
  let m = ceil(x);
  return m - step(0.5, m - x);
}
fn _gpu_step_quotient(x: f32, k: f32) -> f32 {
  let q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) { return sign(x) * 1.17549435e-38; }
  let r = round(q);
  return select(q, r, abs(q - r) <= 4.8e-7 * abs(q));
}
fn _gpu_half_step_quotient(x: f32, k: f32) -> f32 {
  let q = x / k;
  if (q == 0.0 && x != 0.0 && k < 3.4e38) { return sign(x) * 1.17549435e-38; }
  let r = round(q * 2.0) * 0.5;
  return select(q, r, abs(q - r) <= 4.8e-7 * abs(q));
}
fn _gpu_step_fix(m: f32, x: f32, k: f32) -> f32 {
  return select(m, x, k != 0.0 && abs(x / k) > 3.4e38);
}
`;

/**
 * The sign-preserving integer power over a `vecN` base, componentwise: the
 * `_gpu_powiN` overload family (`_gpu_powi2`, `_gpu_powi3`, `_gpu_powi4`).
 *
 * The scalar `_gpu_powi` is declared with `float`/`f32` parameters, so a
 * vector base has no lowering through it and the operand-shape gate declines
 * the call. The widened bodies are the same computation over the genType:
 * `pow` and `abs` are componentwise in both languages, and the exponent stays
 * a SCALAR at every call site (the operand-shape gate declines a vector
 * exponent), so both `if` conditions remain the scalar `bool` a shader
 * requires. As in the scalar helper, `n` may be NEGATIVE and the parity test
 * is taken on `abs(n)`: GLSL `mod` is floored and WGSL `%` is truncated, so a
 * bare `n` would miss the odd branch on WGSL.
 *
 * The per-component sign is restored with `sign(x) * r` rather than the scalar
 * body's `-r`, because a vector has no single sign to branch on. The two
 * agree: for an odd exponent `sign(x)·|x|ⁿ` is `+r` where `x > 0`, `-r` where
 * `x < 0`, and `0` where `x == 0` — which is `pow(0, n)` for every `n > 0`.
 *
 * The name carries the width because WGSL has no function overloading; GLSL
 * would accept one name for all four declarations, but one spelling serves
 * both languages.
 */
function gpuPowiVecPreamble(n: number, isWGSL: boolean): string {
  const v = gpuVecType(n, isWGSL);
  if (isWGSL)
    return `
fn _gpu_powi${n}(x: ${v}, n: f32) -> ${v} {
  if (n == 0.0) { return ${v}(1.0); }
  if (n == 2.0) { return x * x; }
  if (n == 3.0) { return x * x * x; }
  if (n == 4.0) { let s = x * x; return s * s; }
  let r = pow(abs(x), ${v}(n));
  if ((abs(n) % 2.0) == 1.0) { return sign(x) * r; }
  return r;
}
`;
  return `
${v} _gpu_powi${n}(${v} x, float n) {
  if (n == 0.0) return ${v}(1.0);
  if (n == 2.0) return x * x;
  if (n == 3.0) return x * x * x;
  if (n == 4.0) { ${v} s = x * x; return s * s; }
  ${v} r = pow(abs(x), ${v}(n));
  if (mod(abs(n), 2.0) == 1.0) return sign(x) * r;
  return r;
}
`;
}

/**
 * The `_gpu_powi` overloads `code` calls: `'scalar'` for the `float`/`f32`
 * form, and the widths of the `_gpu_powiN` vector forms — deduplicated, so a
 * helper used many times is declared once. Read off the EMITTED source rather
 * than kept in a per-compilation table, like every other `preambleFor` scan.
 *
 * Anchored on a CALL SITE with a name boundary on both ends, the way
 * `gpuAtHelperWidths` is and for the same reason: a user symbol that merely
 * SPELLS a helper name (`_gpu_powi3` as a free variable) must not make the
 * target emit a declaration that then collides with it. The trailing boundary
 * is load-bearing too — without it a plain `/_gpu_powi\s*\(/` test also
 * matches `_gpu_powi3(`, and a compilation that uses only the vector form
 * would get the scalar declaration it never calls.
 *
 * A caller holding only a helper NAME (the operand-shape gate, asking what
 * declaration the helper has) spells a synthetic call site, `${name}(`.
 */
function gpuPowiHelperForms(code: string): Array<'scalar' | number> {
  const scalar = /(?<![\w$])_gpu_powi\s*\(/.test(code);
  const widths = new Set<number>();
  const re = /(?<![\w$])_gpu_powi([234])\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) widths.add(Number(m[1]));
  return [
    ...(scalar ? (['scalar'] as const) : []),
    ...[...widths].sort((a, b) => a - b),
  ];
}

/**
 * Constants shared by both GLSL and WGSL.
 *
 * Null-prototype so a lookup answers only for a key the table actually
 * declares. A plain object literal inherits `Object.prototype`, so indexing it
 * with an ordinary symbol named `toString`, `constructor` or `valueOf` returns
 * an inherited function rather than `undefined` — which the reference analysis
 * would read as "the target inlines this" and drop a genuine input from
 * `freeSymbols`.
 */
const GPU_CONSTANTS: Record<string, string> = {
  __proto__: null as never,
  // The boolean literals are constants, not free symbols. Both shader
  // languages spell them lowercase, so without these a bare `True` was
  // emitted verbatim — an undeclared identifier that makes the shader fail to
  // compile, behind a `success: true` result — and was also reported in
  // `freeSymbols` as an input the caller must supply.
  True: 'true',
  False: 'false',
  Pi: '3.14159265359',
  ExponentialE: '2.71828182846',
  GoldenRatio: '1.61803398875',
  CatalanConstant: '0.91596559417',
  EulerGamma: '0.57721566490',
};

/**
 * Format a number as a GPU float literal.
 *
 * Both GLSL and WGSL require float literals to have a decimal point.
 *
 * A NON-FINITE value has no literal spelling in either language, but both can
 * MAKE the value from a bit pattern, in the `_gpu_nan()` / `_gpu_inf()`
 * preamble helpers — which is what the masked-branch NaN already does
 * (`gpuNaN`). A `NaN` / `±∞` constant therefore routes through the
 * same `gpuNonFiniteLiteral` symbols instead of failing the compilation, which
 * is why this formatter needs to know the language.
 *
 * One spelling for the whole compiler: this is `formatFloat`, which the
 * emitted-code constant fold prints its shader literals with. The two must not
 * drift, or one constant would reach the shader in two spellings depending on
 * which stage produced it.
 */
export function formatGPUNumber(n: number, language?: string): string {
  return formatFloat(n, language);
}

// ---------------------------------------------------------------------------
// User-defined function emission.
//
// GPU targets use the shared `userFunctions` registry with a lowering hook for
// shader-specific requirements: static parameter and return types, a
// statement-position body, declaration-before-use ordering, and recursion
// rejection.
// ---------------------------------------------------------------------------

/** The shader scalar type. Always float: see `gpuTypeOfDeclaredType`. */
function gpuScalarType(isWGSL: boolean): string {
  return isWGSL ? 'f32' : 'float';
}

/** The `vecN` type of the language (`vec2` / `vec2f`). */
function gpuVecType(n: number, isWGSL: boolean): string {
  return isWGSL ? `vec${n}f` : `vec${n}`;
}

/**
 * A caller-declared shader name: its declared type, plus the identifier the
 * emitted body must REFERENCE it by when that is not the bare name.
 *
 * `ref` exists for the WGSL shader inputs, which are FIELDS of the entry
 * point's `input: VertexInput` struct — a body referencing a bare `v` names
 * nothing at all. Uniforms (both languages) and the GLSL `in` varyings are
 * bare globals and leave it unset.
 */
export type GPUShaderDeclaration = {
  name: string;
  type: string;
  ref?: string;
};

/**
 * The ELEMENT kind of a shader value type — float, signed integer, unsigned
 * integer, boolean — the axis a component count cannot express.
 */
type GPUElementKind = 'f' | 'i' | 'u' | 'b';

/**
 * A shader value type normalized into ONE comparison space: an element kind ×
 * a component count (`1` for a scalar).
 *
 * Both languages' spellings collapse into it — `vec2`, `vec2f` and `vec2<f32>`
 * are all `{f, 2}`; `bvec3` and `vec3<bool>` are both `{b, 3}` — which is what
 * lets a caller's GLSL-flavored declaration on the WGSL route (`toWGSLType`
 * maps it) be compared against a WGSL-spelled synthesized parameter.
 *
 * The element axis is load-bearing: `vec2<bool>`, `vec2<i32>` and `vec2<f32>`
 * are all two components, and neither language converts between them — a
 * width-only frame reported all three as `vec2f` and let a `vec2<bool>`
 * argument "match" a `vec2<f32>` parameter.
 */
type GPUValueType = { element: GPUElementKind; width: number };

/** A caller-declared name's type, as written and as normalized. */
type GPUDeclaredType = {
  /** The spelling the caller wrote, for diagnostics. */
  spelling: string;
  /**
   * The normalized type, or `undefined` when the spelling names no static
   * shader VALUE type here (a matrix, an array, a struct, a `#define` alias).
   * Such a name classifies as nothing — in particular not as a float — and
   * fails closed when it reaches a user-function call boundary.
   */
  value?: GPUValueType;
  /**
   * The identifier the emitted source references the name by — its own name,
   * or a WGSL input's field of the entry point's `input` struct. This is the
   * RAW slot, before the float conversion `gpuDeclaredBodyTarget` wraps around
   * an integer-declared scalar (see `gpuDeclaredIsIntegerScalar`), for the
   * few positions that consume the integer itself (a loop bound).
   */
  ref: string;
};

/**
 * Is `v` a caller-declared scalar INTEGER (`int`/`i32`/`uint`/`u32`)?
 *
 * Shader scalar math on these targets is float: every number literal is
 * emitted with a decimal point (`formatGPUNumber`) and no synthesized
 * user-function parameter is ever an integer (`gpuTypeOfDeclaredType`). Neither
 * GLSL ES nor WGSL promotes an integer to a float, so an integer-declared
 * name reaching float arithmetic bare (`float f(int K) { return K + 1.0; }`)
 * is a driver-side type error behind a reported success. Such a name is
 * therefore converted where it is referenced (`gpuDeclaredBodyTarget` binds it
 * to `float(K)` / `f32(K)`), and every reading of it downstream is a float
 * (`gpuTypeOfValue`, `gpuAtFramedIndex`).
 *
 * The conversion is LOSSY above 2^24 (≈16.7M): a shader float has a 24-bit
 * significand, so an integer uniform carrying a larger count or identifier
 * reads rounded in float arithmetic. Loop bounds and plot parameters never
 * approach that; it is a known limit of the float lowering, not a defect to
 * rediscover.
 */
function gpuDeclaredIsIntegerScalar(v: GPUValueType | undefined): boolean {
  return (
    v !== undefined && v.width === 1 && (v.element === 'i' || v.element === 'u')
  );
}

/**
 * Normalize a shader type SPELLING of EITHER language, or `undefined` for one
 * that names no scalar/vector value type here.
 *
 * Both languages' spellings are accepted whatever the target: `compileFunction`
 * takes GLSL-flavored names on the WGSL route too (`toWGSLType` maps them).
 */
function gpuNormalizeShaderType(type: string): GPUValueType | undefined {
  const t = type.trim();
  // Every float width collapses to the ONE float element: the emission has a
  // single float precision, so `double`/`f16`/`f64` are the same value type
  // here as `float`/`f32`.
  if (/^(float|double|half|f16|f32|f64)$/.test(t))
    return { element: 'f', width: 1 };
  if (/^(int|i32)$/.test(t)) return { element: 'i', width: 1 };
  if (/^(uint|u32)$/.test(t)) return { element: 'u', width: 1 };
  // Both languages spell it `bool`.
  if (t === 'bool') return { element: 'b', width: 1 };
  // GLSL: `vecN` (float), plus the `ivecN`/`uvecN`/`bvecN` element prefixes.
  const glsl = /^([ibu]?)vec([234])$/.exec(t);
  if (glsl)
    return {
      element: (glsl[1] || 'f') as GPUElementKind,
      width: Number(glsl[2]),
    };
  // WGSL: the `vecNf`/`vecNh`/`vecNi`/`vecNu` aliases…
  const alias = /^vec([234])([fhiu])$/.exec(t);
  if (alias)
    return {
      element: (alias[2] === 'h' ? 'f' : alias[2]) as GPUElementKind,
      width: Number(alias[1]),
    };
  // …and the explicit `vecN<T>` form, whose element is a scalar spelling.
  const wgsl = /^vec([234])<\s*([a-z0-9]+)\s*>$/.exec(t);
  if (wgsl) {
    const element = gpuNormalizeShaderType(wgsl[2]);
    if (element === undefined || element.width !== 1) return undefined;
    return { element: element.element, width: Number(wgsl[1]) };
  }
  return undefined;
}

/** The target language's spelling of a normalized shader value type. */
function gpuSpellValueType(t: GPUValueType, isWGSL: boolean): string {
  if (t.width === 1) {
    if (t.element === 'b') return 'bool';
    if (t.element === 'i') return isWGSL ? 'i32' : 'int';
    if (t.element === 'u') return isWGSL ? 'u32' : 'uint';
    return gpuScalarType(isWGSL);
  }
  if (t.element === 'f') return gpuVecType(t.width, isWGSL);
  if (!isWGSL) return `${t.element}vec${t.width}`;
  return `vec${t.width}<${
    t.element === 'b' ? 'bool' : t.element === 'i' ? 'i32' : 'u32'
  }>`;
}

/**
 * The declared TYPES of the names in a local shape frame, keyed by the frame
 * itself — the GPU-local companion channel of `BaseCompiler`'s shape frames.
 *
 * A shape frame records a WIDTH (plus the scalar/boolean sentinels), which
 * cannot express an element type: `ivec2` and `vec2` are both "2 components",
 * and a shader converts between them no more than between `vec2` and `float`.
 * This channel carries the complete normalized type, so `gpuTypeOfValue`
 * answers with the type the caller actually declared.
 *
 * Keyed by the FRAME rather than kept as a stack of its own so that
 * `withLocalShapeFrame`'s lifetime, isolation and innermost-wins shadowing all
 * apply to it unchanged (see `BaseCompiler.localShapeFrameOf`).
 */
const gpuDeclaredTypes = new WeakMap<
  ReadonlyMap<string, number>,
  Map<string, GPUDeclaredType>
>();

/**
 * The local shape frame for a set of caller-declared shader declarations — a
 * `compileFunction` parameter list, or a shader's `in`/`uniform` declarations
 * — with their complete declared types registered alongside it.
 *
 * Those declarations ARE the shader types of those names in the source about
 * to be emitted, and nothing else carries them, so they must be framed for the
 * shape analysis to agree with the emission (see `compileDeclaredFunctionBody`).
 * A spelling with no static value type here is entered as `LOCAL_UNSHAPED`:
 * shape-wise that is what an unframed name already answered, but the entry
 * records that the name is declared, so a call site fails closed on it rather
 * than taking it for a float.
 */
function gpuDeclaredShapeFrame(
  declarations: ReadonlyArray<GPUShaderDeclaration>
): Map<string, number> {
  const frame = new Map<string, number>();
  const types = new Map<string, GPUDeclaredType>();
  for (const { name, type, ref } of declarations) {
    const value = gpuNormalizeShaderType(type);
    types.set(name, { spelling: type.trim(), value, ref: ref ?? name });
    frame.set(
      name,
      value === undefined
        ? BaseCompiler.LOCAL_UNSHAPED
        : value.width >= 2
          ? value.width
          : value.element === 'b'
            ? BaseCompiler.LOCAL_BOOLEAN
            : BaseCompiler.LOCAL_SCALAR
    );
  }
  gpuDeclaredTypes.set(frame, types);
  return frame;
}

/**
 * The caller-declared type of the name `expr`, when the shape frame that
 * decides its shape carries one.
 */
function gpuDeclaredTypeOf(expr: Expression): GPUDeclaredType | undefined {
  if (!isSymbol(expr)) return undefined;
  const frame = BaseCompiler.localShapeFrameOf(expr.symbol);
  if (frame === undefined) return undefined;
  return gpuDeclaredTypes.get(frame)?.get(expr.symbol);
}

/**
 * `target`, with the caller-declared names BOUND: each resolves to the
 * identifier the emitted source references it by — its own name, or a WGSL
 * input's field of the entry point's `input` struct — and joins `boundVars`.
 *
 * Framing the declared SHAPES is only half the job: without the binding the
 * declared name is still a free engine symbol, so a same-named assigned value
 * or user-function literal folds over the declaration the emitter is about to
 * write, and the analysis then describes a parameter the emission ignores.
 * `boundVars` carries the binding for the resolutions that are NOT the bare
 * identifier (finding A2) — `input.v` would otherwise read as a free
 * user-function reference.
 */
function gpuDeclaredBodyTarget(
  target: CompileTarget<Expression>,
  declarations: ReadonlyArray<GPUShaderDeclaration>
): CompileTarget<Expression> {
  if (declarations.length === 0) return target;
  const isWGSL = target.language === 'wgsl';
  // An integer-declared scalar is referenced through a float conversion; see
  // `gpuDeclaredIsIntegerScalar` for why. Positions that need the raw integer
  // read `GPUDeclaredType.ref` instead of `var()`.
  const refs = new Map(
    declarations.map((d) => {
      const ref = d.ref ?? d.name;
      return [
        d.name,
        gpuDeclaredIsIntegerScalar(gpuNormalizeShaderType(d.type))
          ? `${isWGSL ? 'f32' : 'float'}(${ref})`
          : ref,
      ];
    })
  );
  return {
    ...target,
    var: (id) => refs.get(id) ?? target.var(id),
    boundVars: BaseCompiler.withBoundNames(target, [...refs.keys()]),
  };
}

/**
 * Is `t` a component a shader `vecN` can hold? A `vecN` is N REAL floats: a
 * boolean, a string, a complex value (itself a `vec2`) and a nested aggregate
 * all have a lowering of their own that does not fit a component slot.
 *
 * Without this, a `tuple<boolean, boolean>` declared `vec2f` and emitted
 * `vec2f(true, false)` — source no driver accepts, behind a reported success.
 */
function gpuIsVectorComponentType(t: Type): boolean {
  // Exactly the types `gpuTypeOfDeclaredType` lowers to the shader SCALAR —
  // including the untyped (`unknown`) case, which is a float by that same
  // convention. The language is irrelevant to the predicate, so it asks in
  // GLSL spelling.
  return gpuTypeOfDeclaredType(t, false) === gpuScalarType(false);
}

/**
 * The component count a SHADER TYPE spelling denotes — `vec2`/`vec3`/`vec4`
 * and the WGSL `vec2f`/`vec3<f32>` spellings — or `1` for a scalar and
 * `bool`. The inverse reading of `gpuTypeOfValue`, for a value whose shader
 * type is already known.
 */
function gpuComponentCountOfShaderType(shader: string): number {
  const m = /^vec([234])/.exec(shader);
  return m === null ? 1 : Number(m[1]);
}

/**
 * Static component count of a declared aggregate type, if it has one — and
 * only when every component fits a `vecN` slot (`gpuIsVectorComponentType`),
 * so a heterogeneous or non-numeric aggregate answers `undefined` and its
 * caller fails closed.
 */
function gpuDeclaredComponentCount(t: Type): number | undefined {
  // A `type alias` / nominal `type` reference answers layout questions as its
  // definition (§4.6 step 1).
  t = resolveTypeForCompilation(t);
  if (typeof t === 'string') return undefined;
  if (t.kind === 'tuple')
    return t.elements.every((e) => gpuIsVectorComponentType(e.type))
      ? t.elements.length
      : undefined;
  if (t.kind === 'list' && t.dimensions?.length === 1)
    return gpuIsVectorComponentType(t.elements) ? t.dimensions[0] : undefined;
  return undefined;
}

/**
 * The shader type a value of DECLARED type `t` lowers to, or `undefined` when
 * it has no single static shader type (a matrix/tensor, an unsized or
 * over-wide list, a function value).
 *
 * No declared type — the common `x ↦ …` case, whose parameters type as
 * `unknown` — is a shader scalar. Deliberately never `int`/`i32`: GPU number
 * literals are always emitted with a decimal point (`formatGPUNumber`) and
 * scalar shader arithmetic is float, so an integer-typed parameter would
 * disagree with its own call sites and poison every downstream use in float
 * math. This is the same rule `compileBlock` applies to block locals.
 */
function gpuTypeOfDeclaredType(
  t: Type | undefined,
  isWGSL: boolean
): string | undefined {
  if (t === undefined || t === 'unknown' || t === 'any')
    return gpuScalarType(isWGSL);
  // A `type alias` / nominal `type` reference lowers to its DEFINITION's
  // shader type: compilation is type erasure (§4.6 step 1). Covers both a
  // nominal-typed value and a nominal declared parameter type.
  t = resolveTypeForCompilation(t);
  if (isSubtype(t, 'color')) return gpuVecType(3, isWGSL);
  // Complex lowers to `vec2(re, im)` — the target's existing convention.
  if (isNonRealNumber(t)) return gpuVecType(2, isWGSL);
  if (isSubtype(t, 'boolean')) return 'bool';
  if (isSubtype(t, 'number')) return gpuScalarType(isWGSL);
  const n = gpuDeclaredComponentCount(t);
  if (n !== undefined && n >= 2 && n <= 4) return gpuVecType(n, isWGSL);
  return undefined;
}

/**
 * The shader type the VALUE `expr` lowers to, or `undefined` when it has no
 * single static shader type.
 *
 * The value-side mirror of `gpuTypeOfDeclaredType`, built on the same
 * shape/complex-ness inference `compileBlock` uses for block locals — so a
 * function's return type and its call sites' argument types are decided by one
 * analysis. Widths outside 2–4 answer `undefined`: the list compilers lower
 * those to an array constructor, which is not a value a shader function
 * parameter or return slot accepts here.
 */
function gpuTypeOfValue(expr: Expression, isWGSL: boolean): string | undefined {
  // A name whose shader type the CALLER declared (a `compileFunction`
  // parameter, a shader input/uniform). Asked FIRST and answered in full:
  // nothing else carries that type — `expr.type` for such a name is the
  // undeclared engine symbol's `unknown`, i.e. a float — and the shape frame
  // alone carries a width, which cannot tell `ivec2`/`bvec2` from `vec2`. A
  // declared spelling with no static value type here answers `undefined`: it
  // is not a float, and its call sites fail closed naming it.
  const declared = gpuDeclaredTypeOf(expr);
  if (declared !== undefined) {
    // An integer-declared scalar is referenced through a float conversion
    // (`gpuDeclaredBodyTarget`), so what a call site or return slot receives
    // IS a float.
    if (gpuDeclaredIsIntegerScalar(declared.value))
      return gpuScalarType(isWGSL);
    return declared.value && gpuSpellValueType(declared.value, isWGSL);
  }
  // A name framed `bool` by a synthesized user-function signature.
  if (isSymbol(expr) && BaseCompiler.isLocalBoolean(expr.symbol)) return 'bool';
  if (
    (!isSymbol(expr) || !BaseCompiler.localShapeFrameOf(expr.symbol)) &&
    (isSubtype(gpuType(expr), 'color') || colorSpaceOf(expr) !== undefined)
  )
    // A visible color constructor or conversion emits three channels even
    // when its cached type still permits broadcasting through a local.
    return gpuVecType(3, isWGSL);
  if (BaseCompiler.isComplexValued(expr)) return gpuVecType(2, isWGSL);
  const n = BaseCompiler.aggregateComponentCount(expr);
  if (n !== undefined) {
    if (n < 2 || n > 4) return undefined;
    // Width alone is not enough: every component must also fit a `vecN` slot,
    // or the emission is `vec2f(true, false)` — see `gpuIsVectorComponentType`.
    return gpuValueHasVectorComponents(expr)
      ? gpuVecType(n, isWGSL)
      : undefined;
  }
  if (BaseCompiler.isNonScalarShape(expr)) return undefined;
  if (expr.type.matches('boolean')) return 'bool';
  return gpuScalarType(isWGSL);
}

/**
 * Do the components of the AGGREGATE value `expr` each fit a `vecN` slot?
 *
 * The value-side mirror of the component check `gpuDeclaredComponentCount`
 * performs: structural for a `Tuple`/`List` literal (whose element types the
 * declared type may not carry), type-based otherwise. A width that came from a
 * local shape frame was validated when the frame was built, so an expression
 * with no aggregate type of its own answers `true`.
 */
function gpuValueHasVectorComponents(expr: Expression): boolean {
  if (isFunction(expr, 'Tuple') || isFunction(expr, 'List'))
    return expr.ops.every((op) => gpuIsVectorComponentType(gpuType(op)));
  const t = gpuType(expr);
  if (typeof t !== 'string' && (t.kind === 'tuple' || t.kind === 'list'))
    return gpuDeclaredComponentCount(t) !== undefined;
  return true;
}

/**
 * The names of the symbols read as a COLOUR operand during a compilation,
 * keyed by the `loweredSymbolType` hook of the target that compiled it.
 *
 * A symbol used as a colour operand (`a` in `ColorMix(a, b, 0.5)`) has the
 * engine type `color | string | tuple`, from which no shader type follows,
 * but the emitted code reads it as a `vec3` of colour channels. Only the
 * emission knows this, so `gpuColorOperand` records the name here while it
 * compiles, and the hook reads it back when the result reports its free
 * symbols. The key is the hook function because it is the one value every
 * copy of the target (`{ ...target }`, made for nested compilations)
 * shares with the target that reports the result.
 */
const gpuColorSymbolReads = new WeakMap<object, Set<string>>();

/**
 * A new `CompileTarget.loweredSymbolType` hook for one shader target: the
 * shader type the emitted code reads the free symbol `symbol` as — the type
 * of the uniform the host must declare. A symbol read as a colour operand is
 * a `vec3`; otherwise the type is read from the same analysis that types the
 * parameters and return values of emitted functions (`gpuTypeOfValue`),
 * then a matrix (`mat2`, `mat3x2f`) or an array (`float[5]`,
 * `array<f32, 5>`). `undefined` when none of these apply.
 */
function gpuLoweredSymbolTypeHook(
  isWGSL: boolean
): (symbol: Expression) => string | undefined {
  const colorReads = new Set<string>();
  const hook = (symbol: Expression): string | undefined => {
    if (isSymbol(symbol) && colorReads.has(symbol.symbol))
      return gpuVecType(3, isWGSL);
    const shape = gpuOperandShape(symbol);
    if (shape === 'matrix') {
      const dims = gpuMatrixDims(symbol);
      if (dims === undefined) return undefined;
      const [rows, cols] = dims;
      if (isWGSL) return `mat${cols}x${rows}f`;
      return rows === cols ? `mat${cols}` : `mat${cols}x${rows}`;
    }
    if (shape === 'array') {
      const t = gpuType(symbol);
      const n =
        typeof t !== 'string' && t.kind === 'list' && t.dimensions?.length === 1
          ? t.dimensions[0]
          : undefined;
      if (n === undefined || !(n > 0)) return undefined;
      return isWGSL ? `array<f32, ${n}>` : `float[${n}]`;
    }
    return gpuTypeOfValue(symbol, isWGSL);
  };
  gpuColorSymbolReads.set(hook, colorReads);
  return hook;
}

/** The synthesized signature of an emitted user-function definition. */
type GPUUserFunctionSignature = {
  /** Formal parameter names, for diagnostics. */
  names: ReadonlyArray<string>;
  /** Shader type of each parameter, in order. */
  params: ReadonlyArray<string>;
  /** Color parameters receive canonical OKLCh channels. */
  colors: ReadonlyArray<boolean>;
  /**
   * Complex parameters hold a `vec2(re, im)`. A real argument is lifted to
   * `vec2(x, 0.0)` at the call. The shader type alone cannot tell this: a
   * 2-component vector parameter is also a `vec2`, and a scalar passed to
   * one must still be refused.
   */
  complex: ReadonlyArray<boolean>;
  /** Shader return type. */
  ret: string;
};

/**
 * Abstract base class for GPU shader compilation targets.
 *
 * Provides shared operators, math functions, constants, and number formatting
 * for both GLSL and WGSL. Subclasses implement language-specific details:
 * function naming differences, vector constructors, function declaration
 * syntax, and shader structure.
 */
/**
 * The compile modes the shader targets offer (`CompileMode`): `'strict'`
 * only. See `createTarget`.
 */
const GPU_SUPPORTED_MODES: readonly CompileMode[] = ['strict'];

export abstract class GPUShaderTarget implements LanguageTarget<Expression> {
  /** Language identifier (e.g., 'glsl', 'wgsl') */
  protected abstract readonly languageId: string;

  /**
   * Return language-specific function overrides.
   *
   * These are merged on top of the shared GPU_FUNCTIONS, allowing
   * subclasses to override specific entries (e.g., `Inversesqrt`, `Mod`, `List`).
   */
  protected abstract getLanguageSpecificFunctions(): CompiledFunctions<Expression>;

  /**
   * Create a complete function declaration in the target language.
   */
  abstract compileFunction(
    expr: Expression,
    functionName: string,
    returnType: string,
    parameters: Array<[name: string, type: string]>,
    options?: { constantFold?: boolean }
  ): string;

  /**
   * Create a complete shader program in the target language.
   */
  abstract compileShader(options: Record<string, unknown>): string;

  getOperators(): CompiledOperators {
    return GPU_OPERATORS;
  }

  /**
   * Memo for the merged function table, keyed on the IDENTITY of the
   * language-specific table (a subclass that swaps its table gets a fresh
   * merge). Both sources are module constants, so the merge is invariant —
   * but it is not free: `GPU_FUNCTIONS` holds exactly V8's
   * `kMaxFastProperties` (128) entries, so merging the 5 language-specific
   * entries on top normalizes the result to DICTIONARY mode, ~22KB of
   * transient garbage per call. `compile()` calls this twice (once directly,
   * once via `createTarget`), which is ~45KB per compilation.
   */
  private _functionsMemo?: {
    languageSpecific: CompiledFunctions<Expression>;
    merged: CompiledFunctions<Expression>;
  };

  getFunctions(): CompiledFunctions<Expression> {
    const languageSpecific = this.getLanguageSpecificFunctions();
    if (this._functionsMemo?.languageSpecific !== languageSpecific) {
      this._functionsMemo = {
        languageSpecific,
        // `Object.assign` onto a null-prototype target, not a spread: a spread
        // rebuilds an ordinary object, so the merged table would inherit
        // `Object.prototype` and answer for a head named `toString` even
        // though both source tables are null-prototype.
        merged: Object.assign(
          Object.create(null),
          GPU_FUNCTIONS,
          languageSpecific
        ),
      };
    }
    return this._functionsMemo.merged;
  }

  getConstants(): Record<string, string> {
    return GPU_CONSTANTS;
  }

  /**
   * Where this shader language admits a SCALAR among otherwise-`vecN`
   * operands — the one place GLSL and WGSL genuinely differ, so each target
   * overrides it (`GLSL_SHAPE_RULES`, `WGSL_SHAPE_RULES`).
   *
   * The default is the INTERSECTION of the two, so a further subclass that
   * forgets to override it fails closed rather than open: only the builtins
   * whose scalar argument is admitted in BOTH languages (`mix`'s blend
   * factor, `refract`'s index) — and, within those, only the SLOT both
   * languages declare scalar (the third) — and only the matrix arithmetic both
   * define (no unary matrix negation: GLSL has it, WGSL does not).
   *
   * `mandatoryScalarSlots` and `vectorOnlySlots` are OBLIGATIONS, so their
   * fail-closed default is the UNION rather than the intersection — more
   * obligations is stricter, where more permissions is laxer. Both languages
   * oblige `refract`'s third argument and nothing else, so the two coincide
   * for `mandatoryScalarSlots`; the vector-only table is WGSL's plus `cross`,
   * which both languages declare over `vec3` alone.
   */
  protected getShapeRules(): GPUShapeRules {
    return {
      scalarGenTypeSlots: new Map([
        ['mix', new Set([2])],
        ['refract', new Set([2])],
      ]),
      mandatoryScalarSlots: new Map([['refract', new Set([2])]]),
      vectorOnlySlots: new Map([
        ['cross', new Set([0, 1])],
        ['dot', new Set([0, 1])],
        ['faceForward', new Set([0, 1, 2])],
        ['normalize', new Set([0])],
        ['reflect', new Set([0, 1])],
        ['refract', new Set([0, 1])],
      ]),
      matrixArithmetic: (sym, allMatrix) =>
        sym === '*' || (allMatrix && (sym === '+' || sym === '-')),
      matrixNegate: false,
    };
  }

  createTarget(
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const functions = this.getFunctions();
    const constants = this.getConstants();
    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    const rules = this.getShapeRules();
    const target: GPURandomTarget & GPUShapeRulesTarget = {
      language: this.languageId,
      isRealOnlyLowering: gpuIsRealOnlyLowering,
      // A shader value has ONE static shape (`float` or `vec2`), decided by
      // type analysis — the strict discipline IS this target's model, and the
      // only mode it offers (`CompileMode`). A requested `'complex'`/`'auto'`
      // is the `unsupported-mode` decline.
      supportedModes: GPU_SUPPORTED_MODES,
      // The shader type of each free symbol, for
      // `CompilationResult.freeSymbolTypes`. See `gpuLoweredSymbolTypeHook`.
      loweredSymbolType: gpuLoweredSymbolTypeHook(this.languageId === 'wgsl'),
      // Constant-collection folding inlines up to the SAME limit this
      // target's `Range` handler already inlines to. On a shader target a
      // dynamic collection has no lowering at all, so for a constant one the
      // inline literal is the only emission that can compile — the number is
      // a capability limit, not the source-size trade-off the default 50
      // describes. One limit governs both paths, so the fold cannot refuse a
      // collection the `Range` handler would have accepted.
      maxInlineElements: GPU_MAX_INLINE_ELEMENTS,
      // Carried on the target so a LOWERING can validate the calls it
      // generates against the same table the generic gate uses — the variadic
      // `min`/`max` fold, whose nested calls no longer line up with the CE
      // operand positions (`foldNaryBuiltin`).
      gpuShapeRules: rules,
      // Restart the random-counter numbering at each compilation boundary, so
      // a target the CALLER reuses across two `compile()` calls emits the same
      // source both times (§7). Target-specific: only the GPU languages number
      // anything per compilation.
      beginCompilation: resetGPURandomNumbering,
      // Bind an index-free scalar subexpression of a `Sum`/`Product` body once
      // ahead of the loop instead of recomputing it per iteration (see
      // `CompileTarget`). A shader runs its loop per fragment, so the cost of
      // an invariant `floor`, `sin` or `dot` inside one is paid millions of
      // times per frame.
      hoistScalarInvariants: true,
      // A shader has no loop lowering for a comprehension; a small one over
      // literal domains is written out as a fixed-size array literal, in a
      // definition body or an inlined body as at the entry
      // (`CompileTarget.unrollComprehensions`).
      unrollComprehensions: true,
      // Only a function-LITERAL callee compiles here: the `Apply` entry of
      // the function table substitutes the arguments into the literal's body
      // (`gpuAppliedBody`). The reference analysis must stop at any other
      // application rather than walk into a callee this target never
      // compiles (`CompileTarget.appliesFunctionLiteralsOnly`).
      appliesFunctionLiteralsOnly: true,
      assignmentValue: (value, code, current) =>
        isSubtype(gpuType(value), 'color')
          ? gpuColorOperand(
              'Assign',
              value,
              (v) =>
                v === value
                  ? code
                  : BaseCompiler.compileValueOperand(v, current),
              current
            )
          : code,
      // A common-subexpression declaration can be placed here when there is
      // a statement sink that is not a conditionally-evaluated arm
      // (`gpuCanPlaceStatement`). In the captured branch of a conditional's
      // statement form the sink is present and not marked conditional, so a
      // shared subexpression of that arm is bound there rather than emitted
      // once per occurrence.
      cseCanMaterialize: gpuCanPlaceStatement,
      cseMaterialize: (expr, name, code, current) => {
        if (!gpuCanPlaceStatement(current)) return false;
        const type = gpuTypeOfValue(expr, current.language === 'wgsl');
        if (type === undefined) return false;
        BaseCompiler.hoistStatement(
          current,
          current.language === 'wgsl'
            ? `let ${name}: ${type} = ${code};`
            : `${type} ${name} = ${code};`
        );
        return true;
      },
      // A shader has no expression-level loop or IIFE, so the multi-statement
      // block forms (loop-form Sum/Product, Loop, Block) are only valid at
      // statement position. Flag it so the base compiler hoists them where a
      // statement sink is available and fails closed elsewhere, rather
      // than splice a bare block into a sub-expression. Gated to the pure GPU
      // languages by language id.
      bareStatementBlocks:
        this.languageId === 'glsl' || this.languageId === 'wgsl',
      // A multi-statement `Block` used as a VALUE — a `with` clause as the
      // term of a `Sum`, or as an operand of an addition — becomes one
      // compound statement in the enclosing sink: the block's locals are
      // declared inside `{ … }`, so each unrolled term of a `Sum` gets its own
      // `a` and two `with a = …` clauses can share a function body, and the
      // value is stored in a temporary declared ahead of the braces (the
      // temporary must outlive them). The temporary needs a static shader
      // type; a value with none declines, as does a conditional arm (moving
      // the statements out of the arm would run them unconditionally — see
      // `compileGPUConditionalArm`), and the operand position then fails
      // closed as before.
      // A lazily-evaluated operand — the right side of `&&`/`||`, a
      // `Coalesce` fallback — is compiled under the same guard as a
      // conditional arm: a statement hoisted out of it would run
      // unconditionally, ahead of the operand that decides whether it runs.
      lazyOperand: (head, compiled, current) =>
        compileGPUConditionalArm(head, compiled, current),
      valueBlock: (valueNode, stmts, valueCode, current) => {
        if (
          !BaseCompiler.canHoist(current) ||
          conditionalGPUSinks.has(current.hoist!)
        )
          return undefined;
        const isWGSL = current.language === 'wgsl';
        const type = gpuTypeOfValue(valueNode, isWGSL);
        if (type === undefined) return undefined;
        const tv = BaseCompiler.tempVar(current);
        const body = BaseCompiler.joinShaderStatements([
          ...stmts,
          `${tv} = ${valueCode}`,
        ])
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        BaseCompiler.hoistStatement(
          current,
          isWGSL ? `var ${tv}: ${type};` : `${type} ${tv};`,
          `{\n${body}\n}`
        );
        return tv;
      },
      // A free symbol emitted as a bare identifier must not be a reserved word
      // of the shader language, or the generated shader fails to compile. Fail
      // closed with a clear diagnostic naming the offending identifier.
      mangleId: (id) => gpuCheckIdentifier(id, this.languageId),
      // A `Which`/`If` with a statically-shaped (vec2–vec4) collection
      // condition selects ELEMENT-WISE: lower it to boolean-vector masks
      // combined with `mix`/`select`. Returns `null` — leaving the scalar
      // emission below byte-identical — when every condition is a scalar.
      selection: (args, compile, selTarget) =>
        compileGPUSelection(args, compile, selTarget),
      // A `broadcastable` unary head over a statically shaped (vec2–vec4)
      // collection needs NO fan-out: the shader builtins and operators are
      // already componentwise on a vector, so the scalar form applies directly
      // to the vector operand. Fails closed on anything with no static
      // vector shape.
      broadcastUnary: (head, operand, lowering) =>
        compileGPUBroadcastUnary(head, operand, lowering),
      // The same defect class on every emission that does NOT go through the
      // fan-out hook (the generic function-codegen and string-helper paths):
      // a collection, matrix or array operand reaching a lowering the shader
      // type system cannot give it to. Fails closed instead of emitting
      // source no driver accepts.
      checkOperandShapes: (h, opArgs, emitted) =>
        gpuCheckOperandShapes(
          h,
          opArgs,
          emitted,
          rules,
          (c) => this.preambleFor(c),
          // The head's own lowering, so a DECLARED aggregate-consuming one
          // (`Max`/`Min`) can step the gate aside — see
          // `GPU_AGGREGATE_CONSUMING`.
          functions[h]
        ),
      operators: (op) => GPU_OPERATORS[op],
      functions: (id) => functions[id],
      constant: (id) =>
        id === 'ImaginaryUnit' ? `${v2}(0.0, 1.0)` : constants[id],
      var: (id) => {
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` (rather than a bare `id`) lets BaseCompiler
        // fold an assigned value / declared constant — including on the
        // direct-target `compile(expr, { target })` path, which uses this raw
        // target — and fall back to a bare (declarable) identifier only for a
        // genuinely free symbol.
        return undefined;
      },
      // Text has no shader representation, so a string literal in any
      // position fails closed rather than emitting one.
      //
      // GLSL and WGSL have no string type, no character type and no text
      // storage class: there is nothing a quoted literal could be. Declining
      // in this hook covers every position because all string values pass
      // through it.
      string: (str) => {
        throw new Error(
          `Could not compile the string literal ${JSON.stringify(str)}: it is not supported on the ` +
            `${this.languageId} target: the shader languages have no text ` +
            `type — no string, no character, no grapheme-cluster indexing — ` +
            `so there is no value a quoted literal could lower to.`
        );
      },
      // Bound to the language so a NON-FINITE literal (`NaN`, `±∞`,
      // `ComplexInfinity`) reaches the right `gpuNonFiniteLiteral` spelling
      // rather than the GLSL default.
      number: (n) => formatGPUNumber(n, this.languageId),
      complex: (re, im) =>
        `${v2}(${formatGPUNumber(re, this.languageId)}, ${formatGPUNumber(
          im,
          this.languageId
        )})`,
      // Absence capability (§3.F): a shader can MAKE `NaN` (propagation is free
      // — IEEE hardware is the gate), but `isnan` is not reliable under
      // fast-math, so `isAbsent`/`coalesce` are DELIBERATELY omitted and no
      // object axis is declared. Discharge (`IsMissing`/`Coalesce`) and Kleene
      // `Equal` over possibly-absent operands are therefore a compile error on
      // this target — fail closed (§3.F). Propagation still works natively.
      absence: {
        numeric: {
          make: () =>
            gpuNaN({ language: this.languageId } as CompileTarget<Expression>),
        },
      },
      indent: 0,
      ws: (s?: string) => s ?? '',
      preamble: '',
      declare: (name, typeHint) => {
        const type = typeHint ?? (this.languageId === 'wgsl' ? 'f32' : 'float');
        return this.languageId === 'wgsl'
          ? `var ${name}: ${type}`
          : `${type} ${name}`;
      },
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A statement-form construct as the block's LAST element — a `Loop`
        // emits a `for (…) { … }` statement — has no value to return.
        // Return-prefixing it would produce `return for (…) { … }` (invalid
        // GLSL/WGSL), and a shader block must evaluate to a typed value, so
        // there is no `return None` analog either. Fail closed. A Loop in
        // a non-final position is fine (it stays a bare statement).
        if (/^\s*(for|while)\b/.test(stmts[last]))
          throw new Error(
            `Could not compile \`${this.languageId.toUpperCase()}\`: a Loop (or other statement-form ` +
              `construct) cannot be the final statement of a block — a shader ` +
              `block must evaluate to a typed value.`
          );
        stmts[last] = `return ${stmts[last]}`;
        // A statement a list member hoisted (a loop, a compound block) is
        // already terminated; the joiner adds `;` only where one is missing.
        return BaseCompiler.joinShaderStatements(stmts);
      },
      // Per-compilation naming state for generated temporaries (the loop
      // accumulator of `compileGPUSumProduct`). Numbered per compilation like
      // the random counters below, and reset alongside them at each
      // compilation boundary (`resetGPURandomNumbering`).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
    // Fold the literal arithmetic the EMISSION creates, which the tree-level
    // fold cannot see: an unrolled `Sum` substitutes its index at the variable
    // level, so every term carries `(1.0 + -0.5)` and `_gpu_pow2(0.025 * (1.0
    // + -0.5))`. Every step of the fold rounds to single, so the folded
    // literal is the value the shader computes (`foldEmittedGPUCode`).
    // Installed after the spread so a caller's `constantFold: false` — which
    // promises the structural lowering of every constant, and which the
    // code-generation tests rely on — turns this fold off as well.
    if (
      target.constantFold !== false &&
      target.foldEmittedConstant === undefined
    ) {
      const splices = callerSpliceSources(target.varsKeys, target.var);
      target.foldEmittedConstant = (_expr, code) =>
        foldEmittedGPUCode(code, splices);
    }
    // Per-compilation random state (§7 of the Random family redesign),
    // installed EAGERLY: the base compiler recurses through `{ ...target }`
    // spreads, which copy the identity token by reference, so a
    // `WithRandomSeed` frame pushed here is visible to the `Random` draws
    // nested in its body. The state itself is held off the target.
    installGPURandomState(target);
    return target;
  }

  /**
   * A target for compiling `expr`, with the random-draw context (§7) stamped
   * on it: the shader stage when the caller knows it, and whether a HOST
   * `WithRandomSeed` frame is active — the cross-domain case an unframed
   * shader draw must fail closed on.
   */
  protected createTargetFor(
    expr: Expression | undefined,
    stage?: string,
    options: Partial<CompileTarget<Expression>> = {}
  ): CompileTarget<Expression> {
    const target = this.createTarget(options);
    // A TEXT-TYPED SYMBOL is the same target limitation as the string literal
    // the `string` hook refuses, one step later: a `string`- or
    // `character`-typed free symbol emits a bare identifier, which the caller
    // then declares as a `float` uniform — `Less(sv, tv)` over two
    // `string`-typed symbols came out as `sv < tv`, comparing two numbers
    // where the interpreter compares text, behind a reported `success: true`.
    //
    // Consulted from `mangleId`, which is the one hook EVERY free-symbol
    // emission passes through (`BaseCompiler.compileExpr`) and which no
    // caller of `createTargetFor` overrides. The offending names are collected
    // once per compiled root by walking SYMBOL nodes only — never a string
    // LITERAL, so a type annotation carried as a string operand
    // (`Declare(x, "number")`) is not mistaken for a text value.
    //
    // The gate is NAME-KEYED, not occurrence-keyed: `mangleId` receives only an
    // identifier, so once a name is used text-typed ANYWHERE in the compiled
    // root (including inside a user-function body the walk follows) every
    // occurrence of that name is refused — a loop index that happens to share
    // its name with a `string`-typed symbol is refused too. That is a
    // deliberate over-refusal in the fail-closed direction (D6): the compiler
    // declines and the interpreter answers, which is never a wrong value.
    const textSymbols = gpuTextSymbols(expr);
    if (textSymbols.size > 0) {
      const inner = target.mangleId;
      target.mangleId = (id) => {
        if (textSymbols.has(id))
          throw new Error(
            `Could not compile \`${id}\`: the symbol is text-typed, which is not supported on ` +
              `the ${this.languageId} target: the shader languages have no ` +
              `text type — no string, no character, no grapheme-cluster ` +
              `indexing — so it would be emitted as a bare identifier and ` +
              `declared as a numeric uniform.`
          );
        return inner ? inner(id) : id;
      };
    }
    // A sampler-backed symbol (`storage` hint) may be emitted ONLY as the
    // operand of a positional read (`gpuStorageOperandSource`); every other
    // reference fails closed. Both hooks are gated because a free symbol
    // reaches exactly one of them: `var` when the caller's `vars` maps it,
    // `mangleId` when it is emitted as a bare identifier.
    const storage = target.storage;
    if (storage !== undefined && storage.size > 0) {
      const innerVar = target.var;
      const innerMangle = target.mangleId;
      const language = this.languageId;
      target.var = (id) => {
        gpuRefuseStorageReference(id, storage, language);
        return innerVar(id);
      };
      target.mangleId = (id) => {
        gpuRefuseStorageReference(id, storage, language);
        return innerMangle ? innerMangle(id) : id;
      };
    }
    const state = gpuRandomState(target);
    state.stage = stage;
    state.hostFrame = expr?.engine?._randomFrame !== undefined;
    // Seed the generated-temporary collision inventory from the expression,
    // unless the caller supplied a context of its own (a root that knows more
    // than one expression, or the caller's `vars` source).
    if (options.naming === undefined)
      target.naming = BaseCompiler.newNamingContext(expr, [target.preamble]);
    // User-defined function support is opt-in per target (see
    // `CompileTarget.userFunctions`), and opting in is only sound where the
    // emitted DEFINITIONS have a delivery channel. Every route that reaches
    // `createTargetFor` has one (`preambleFor` — the expression, shader, AND
    // `compileFunction` routes, so helpers referenced only inside a
    // definition body are declared too); a caller that has
    // none opts out by passing `userFunctions: undefined` explicitly, which
    // restores the historic `Unknown operator` throw. The raw `createTarget()`
    // route (direct custom targets, the interpreter fallback) never gets a
    // registry at all.
    this.currentUserFunctions = undefined;
    if (!('userFunctions' in options)) {
      const registry = this.newUserFunctions()!;
      // The compilation root: every definition body is compiled against THIS
      // target, never against whichever nested target requested the emission
      // (see `CompileTarget.userFunctions.root`).
      registry.root = target;
      target.userFunctions = registry;
      this.currentUserFunctions = registry;
    }
    return target;
  }

  /**
   * The user-defined function registry of the compilation currently in
   * flight, i.e. the one the most recent `createTargetFor` created.
   *
   * This is how the emitted definitions reach `preambleFor` — the single
   * channel that delivers the `_gpu_*` helpers today — which is called with
   * the emitted code but not with the target that produced it. Safe as
   * instance state because GPU compilation is synchronous and non-reentrant:
   * every route creates its target, compiles, and reads the definitions back
   * within one call, before any other route can run.
   */
  private currentUserFunctions?: CompileTarget<Expression>['userFunctions'];

  /**
   * The user-defined function definitions emitted during the current
   * compilation, in dependency order (a callee precedes its caller — which is
   * also what GLSL's declaration-before-use rule requires), or `''`.
   */
  protected userFunctionDefs(rootCode: string): string {
    const registry = this.currentUserFunctions;
    const defs = registry?.defs;
    if (!registry || !defs || defs.size === 0) return '';
    // A base definition every call of which was rewritten to an
    // invariant-prefix variant is dead text: dropped here, where the
    // definitions are read back (`BaseCompiler.pruneUnreferencedVariantBases`).
    BaseCompiler.pruneUnreferencedVariantBases(registry, rootCode);
    if (defs.size === 0) return '';
    return [...defs.values()].join('\n\n') + '\n';
  }

  /**
   * A fresh user-defined function registry for one compilation, with the
   * shader-language lowering hooks installed (§9.1).
   *
   * The synthesized signatures live in this closure, so `call` can check a
   * call site's argument shapes against the declaration `define` wrote, and
   * both die with the registry.
   */
  private newUserFunctions(): CompileTarget<Expression>['userFunctions'] {
    const language = this.languageId;
    const isWGSL = language === 'wgsl';
    const signatures = new Map<string, GPUUserFunctionSignature>();
    const declareFn = (
      name: string,
      ret: string,
      params: ReadonlyArray<[name: string, type: string]>,
      body: string
    ) => this.declareGPUFunction(name, ret, params, body);

    return {
      defs: new Map<string, string>(),
      compiling: new Set<string>(),
      lowering: {
        // GLSL and WGSL both forbid recursion outright.
        noRecursion: true,

        // `define` below synthesizes the return type with `gpuTypeOfValue` on
        // the body, which reads the body's DECLARED (ascribed) type — so a
        // scalar declaration contradicted by a collection-constructing body
        // fails closed in the shared emission path instead of emitting a
        // `float` declaration around a `vecN` return (wave 3).
        staticReturnType: true,

        define: ({
          id,
          name,
          params,
          body,
          literal,
          target,
          parameterTypes,
          extraParams,
        }) => {
          // The generated name is emitted bare; a shader reserved word here
          // would be source no driver accepts (D6).
          gpuCheckIdentifier(name, language);
          // The formal parameters are spliced verbatim into the signature and
          // referenced bare in the body, so they need the same check — the
          // convention the loop indices of `Sum`/`Product`/`Loop` follow.
          // `f(discard) := discard + 1` would otherwise emit
          // `float _fn_f(float discard)` behind a reported success.
          for (const p of params) gpuCheckIdentifier(p, language);
          const extras = extraParams ?? [];
          for (const x of extras) gpuCheckIdentifier(x.name, language);

          // PARAMETER TYPES. The declared signature is authoritative — a
          // parameter symbol's own type does not carry it (`f: (complex) ->
          // complex` leaves `z` typed `number`) — with the parameter symbol's
          // type as the fallback for an undeclared/`unknown` slot.
          const engine = literal.engine;
          const paramSymbols = isFunction(literal)
            ? literal.ops.slice(1)
            : ([] as ReadonlyArray<Expression>);
          const complexFrame = new Map<string, boolean>();
          const vectorFrame = new Map<string, number>();
          const colors: boolean[] = [];
          const complexParams: boolean[] = [];
          const paramTypes = params.map((p, i) => {
            const declared =
              parameterTypes?.[i] ??
              BaseCompiler.userFunctionParamType(engine, id, i);
            const own = paramSymbols[i]?.type?.type;
            const t =
              declared === undefined || declared === 'unknown' ? own : declared;
            const shader = gpuTypeOfDeclaredType(t, isWGSL);
            colors.push(
              t !== undefined &&
                isSubtype(resolveTypeForCompilation(t), 'color')
            );
            if (shader === undefined)
              throw new Error(
                `Could not compile \`${id}\`: parameter "${p}" has no static ${language.toUpperCase()} ` +
                  `type — only scalars, booleans, colors, complex values and 2–4 ` +
                  `component vectors have one, and a shader function ` +
                  `signature must be fully typed. Declare a narrower ` +
                  `signature for "${id}".`
              );
            // Record the parameter's inferred shape so the body analysis
            // agrees with the declaration just synthesized (and so a
            // parameter is never resolved against a same-named engine
            // symbol). Scalars use the `LOCAL_SCALAR` sentinel, booleans the
            // `LOCAL_BOOLEAN` one — a `(boolean) -> …` parameter is `bool` in
            // the emitted signature, so the body must classify it `bool` too
            // (a body that RETURNS it would otherwise synthesize a `float`
            // return type for a `bool` value).
            const complex = t !== undefined && isNonRealNumber(t);
            const n = complex
              ? 2
              : colors[i]
                ? 3
                : (gpuDeclaredComponentCount(t ?? 'unknown') ?? 0);
            complexFrame.set(p, complex);
            complexParams.push(complex);
            vectorFrame.set(
              p,
              shader === 'bool'
                ? BaseCompiler.LOCAL_BOOLEAN
                : n >= 2
                  ? n
                  : BaseCompiler.LOCAL_SCALAR
            );
            return shader;
          });

          // EXTRA PARAMETERS of an invariant-prefix variant: each holds a
          // body subexpression's value, so its shader type is that
          // subexpression's, read under the parameter shapes just recorded
          // (the frame is installed for the read, as it is for the body
          // below). The parameter is then recorded in the same frames, so a
          // body reading it through its code override is typed as it
          // types the subexpression.
          const extraTypes = BaseCompiler.withLocalShapeFrame(
            complexFrame,
            vectorFrame,
            () =>
              extras.map((x) => {
                const shader = gpuTypeOfValue(x.expr, isWGSL);
                if (shader === undefined)
                  throw new Error(
                    `Could not compile \`${id}\`: the hoisted value \`${x.expr.toString()}\` has ` +
                      `no static ${language.toUpperCase()} type, so no ` +
                      `variant of "${id}" takes it as a parameter.`
                  );
                return {
                  shader,
                  complex: BaseCompiler.isComplexValued(x.expr),
                };
              }),
            true
          );
          extras.forEach((x, i) => {
            const { shader, complex } = extraTypes[i];
            const n = complex ? 2 : gpuComponentCountOfShaderType(shader);
            complexFrame.set(x.name, complex);
            vectorFrame.set(
              x.name,
              shader === 'bool'
                ? BaseCompiler.LOCAL_BOOLEAN
                : n >= 2
                  ? n
                  : BaseCompiler.LOCAL_SCALAR
            );
          });

          // RETURN TYPE and BODY, both under the parameter shape frame — and
          // under that frame ONLY (`isolate`): an emitted definition is a
          // module-level function, so when this emission was triggered from
          // inside ANOTHER definition's body, that caller's parameter shapes
          // must not reach here (they would give a same-named global the
          // caller's width). A shader function body is a STATEMENT position: a
          // loop-form `Sum`/`Product` inside it hoists its loop ahead of the
          // `return`.
          const { ret, code } = BaseCompiler.withLocalShapeFrame(
            complexFrame,
            vectorFrame,
            () => {
              const ret = gpuTypeOfValue(body, isWGSL);
              if (ret === undefined)
                throw new Error(
                  `Could not compile \`${id}\`: the return value has no static ` +
                    `${language.toUpperCase()} type — only scalars, booleans, ` +
                    `colors, complex values and 2–4 component vectors have one.`
                );
              // Every `Return` in the body must yield the shape the
              // signature just synthesized: a shader function has ONE return
              // type and neither language converts between a scalar, a
              // `bool` and a `vecN`. Checked AT the emission, not by a
              // pre-walk, because the shape of a `Return`'s value is only
              // knowable while the emitter's local frames are pushed — a
              // `Return(z)` naming a `vec2` block-local reads as a scalar
              // once `compileBlock` has popped its frame, which is exactly
              // how `float _fn_a(float t) { … return z; }` went out behind
              // `success: true`.
              const code = BaseCompiler.compileFunctionBody(body, {
                ...target,
                onReturn: (value) => {
                  const t =
                    value === undefined
                      ? undefined
                      : gpuTypeOfValue(value, isWGSL);
                  if (t === ret) return;
                  throw new Error(
                    `Could not compile \`${id}\`: a \`Return\` in this body yields ` +
                      (t === undefined
                        ? `a value with no static ${language.toUpperCase()} type`
                        : `a "${t}" value`) +
                      `, but "${id}" is declared to return "${ret}" (the ` +
                      `shape of the body's own final value). ` +
                      `${language.toUpperCase()} has no implicit conversion ` +
                      `between them, and a shader function has a single ` +
                      `return type. Make every \`Return\` — and the body's ` +
                      `final value — the same shape.`
                  );
                },
              });
              // The lane of the value, read by the call sites
              // (`BaseCompiler.userCallLane`): a `vec2` return type is also
              // the type of a two-component point, so the return type alone
              // does not say whether the value is complex. Recorded after
              // the body compiled, as on the JavaScript definition route, so
              // that a recursive call read as real while the body compiled is
              // checked against the lane of the value.
              BaseCompiler.recordUserFunctionLane(target, id, name, body);
              return { ret, code };
            },
            true
          );

          // …and every `Return` that survived that check must also be in a
          // position the language can express. Run on the EMITTED body, after
          // the shape gate above (whose message is the more specific one).
          gpuAssertReturnPlacement(id, code, language);

          const allNames = [...params, ...extras.map((x) => x.name)];
          const allTypes = [...paramTypes, ...extraTypes.map((x) => x.shader)];
          // An extra parameter is never a colour SLOT: a colour-typed formal
          // parameter has its argument converted at the call site
          // (`gpuColorOperand`), because the argument is written by the
          // caller in whatever spelling a colour admits. A held value is the
          // callee's own subexpression, compiled once as the body would have
          // compiled it inline, so the body reads exactly the representation
          // it produced.
          signatures.set(name, {
            names: allNames,
            params: allTypes,
            colors: [...colors, ...extras.map(() => false)],
            complex: [...complexParams, ...extraTypes.map((x) => x.complex)],
            ret,
          });
          return declareFn(
            name,
            ret,
            allNames.map((p, i): [string, string] => [p, allTypes[i]]),
            code
          );
        },

        call: ({ id, name, args: ordinary, target, held }) => {
          const sig = signatures.get(name);
          // `define` always runs before the first `call`
          // (`ensureUserFunctionEmitted`), so this cannot be reached.
          if (sig === undefined)
            throw new Error(`Internal: no synthesized signature for "${id}"`);
          // The held values of an invariant-prefix variant follow the
          // ordinary arguments and are checked exactly like them.
          const args = held === undefined ? ordinary : [...ordinary, ...held];
          if (args.length !== sig.params.length)
            throw new Error(
              `Could not compile \`${id}\`: called with ${args.length} argument(s) but declared ` +
                `with ${sig.params.length} — a ${language.toUpperCase()} call ` +
                `must match its declaration exactly (there are no optional or ` +
                `variadic parameters).`
            );
          const code = args.map((arg, i) => {
            const t = gpuTypeOfValue(arg, isWGSL);
            // A name the CALLER declared with a spelling this analysis has no
            // value type for (a matrix, an array, a struct, an alias). It is
            // NOT a float — classifying it as one is how a `mat4` uniform
            // reached a synthesized `float` parameter behind a reported
            // success — and the declared spelling is the only thing that
            // points at the fix, so it is named.
            const badDecl =
              t === undefined ? gpuDeclaredTypeOf(arg) : undefined;
            if (badDecl !== undefined)
              throw new Error(
                `Could not compile \`${id}\`: argument ${i + 1} \`${arg.toString()}\` is declared ` +
                  `"${badDecl.spelling}" by the caller — a type with no ` +
                  `static ${language.toUpperCase()} value shape here (only ` +
                  `scalars, booleans and 2–4 component vectors have one), so ` +
                  `it cannot be matched against parameter "${sig.names[i]}" ` +
                  `(declared "${sig.params[i]}").`
              );
            // A collection argument beyond the static vec2–vec4 shapes: the
            // JS target answers this with the `_SYS.bcastFn` runtime
            // broadcast dispatch, which a shader has no analog for. Scalar
            // applying it silently would compute a different value.
            if (t === undefined)
              throw new Error(
                `Could not compile \`${id}\`: argument ${i + 1} is a collection with no static ` +
                  `${language.toUpperCase()} shape (only 2–4 component ` +
                  `vectors have one), and a shader has no runtime broadcast ` +
                  `dispatch to apply "${id}" element-wise.`
              );
            // A real argument to a complex parameter. A real number is a
            // complex number, so the call is valid, but the parameter is a
            // `vec2` and neither language converts a scalar to a vector
            // implicitly. Lift the argument to `vec2(x, 0.0)`, as the
            // JavaScript target wraps it in `{ re: x, im: 0 }`. Only a
            // floating-point scalar is lifted: WGSL has no `vec2f(i32, f32)`
            // constructor, and a `bool` is not a number.
            if (
              sig.complex[i] &&
              t === (isWGSL ? 'f32' : 'float') &&
              t !== sig.params[i]
            )
              return `${gpuVec2(target)}(${BaseCompiler.compileValueOperand(
                arg,
                target
              )}, 0.0)`;
            if (t !== sig.params[i])
              throw new Error(
                // The argument is named as well as numbered: the mismatch is
                // often between a `compileFunction` parameter the CALLER
                // declared and a callee signature it never saw, and the
                // position alone does not point at either.
                `Could not compile \`${id}\`: argument ${i + 1} \`${arg.toString()}\` lowers to "${t}" but parameter ` +
                  `"${sig.names[i]}" is declared "${sig.params[i]}" — ` +
                  `${language.toUpperCase()} has no implicit conversion ` +
                  `between them. Declare a matching signature for "${id}".`
              );
            return sig.colors[i]
              ? gpuColorOperand(
                  id,
                  arg,
                  (value) => BaseCompiler.compileValueOperand(value, target),
                  target
                )
              : BaseCompiler.compileValueOperand(arg, target);
          });
          return `${name}(${code.join(', ')})`;
        },

        value: ({ id }) => {
          throw new Error(
            `Could not compile \`${id}\`: a user-defined function cannot be used as a VALUE on ` +
              `target '${language}' — the shader languages have no function ` +
              `values (no higher-order operands, no function pointers). Call ` +
              `it instead.`
          );
        },
      },
    };
  }

  /**
   * Assemble a function declaration in the target language from an
   * ALREADY-COMPILED body.
   *
   * The declaration-syntax half of `compileFunction`, split out because the
   * user-function emission must compile the body itself (parameters shadowed,
   * shapes framed, same registry and naming context) rather than against a
   * fresh target of its own. `params`/`ret` are already language-specific
   * types (`float`/`vec2` vs `f32`/`vec2f`).
   */
  protected declareGPUFunction(
    name: string,
    returnType: string,
    params: ReadonlyArray<[name: string, type: string]>,
    body: string
  ): string {
    const signature =
      this.languageId === 'wgsl'
        ? `fn ${name}(${params
            .map(([n, t]) => `${n}: ${t}`)
            .join(', ')}) -> ${returnType}`
        : `${returnType} ${name}(${params
            .map(([n, t]) => `${t} ${n}`)
            .join(', ')})`;
    // A multi-line body already carries its own `return` on the last line (the
    // block convention, and what `compileFunctionBody` emits once anything
    // hoisted); a single-line one is an expression.
    if (body.includes('\n')) {
      const indented = body
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n');
      return `${signature} {\n${indented}\n}`;
    }
    return `${signature} {\n  return ${body};\n}`;
  }

  /**
   * Compile the body of a `compileFunction` declaration with the CALLER's
   * parameter list visible to the shape analysis.
   *
   * The `[name, type]` pairs a `compileFunction` caller supplies ARE the
   * shader types of those names in the source about to be emitted — nothing
   * else carries them (a bare `v` is an undeclared engine symbol, which the
   * analysis reads as a scalar). Without the frame the analysis and the
   * emitted signature can disagree: `compileFunction(h(v), …, [['v','vec2']])`
   * against an undeclared `h` synthesized `float _fn_h(float w)` and passed
   * the `vec2 v` into it behind a reported success. Framing the declared
   * shapes lets the existing call-site check see the mismatch and fail closed
   * (D6).
   *
   * The complete declared TYPE is carried (element × width, both languages'
   * spellings normalized), not just a width: `ivec2` and `bvec2` are two
   * components each and convert to `vec2` in neither language. A spelling with
   * no static value type here (a matrix, an array, a struct, a `#define`
   * alias) is recorded as such and fails closed if it reaches a user-function
   * call. Complex-ness is deliberately NOT framed: a `vec2` parameter may be a
   * point or a complex number, the caller's type does not say which, and the
   * existing inference already answers `vec2` either way.
   *
   * The parameters are also BOUND (`gpuDeclaredBodyTarget`), so a same-named
   * engine symbol cannot fold over the parameter the signature declares.
   */
  protected compileDeclaredFunctionBody(
    expr: Expression,
    parameters: ReadonlyArray<[name: string, type: string]>,
    options?: { constantFold?: boolean }
  ): string {
    const declarations = parameters.map(([name, type]) => ({ name, type }));
    const target = gpuDeclaredBodyTarget(
      this.createTargetFor(expr, undefined, {
        constantFold: options?.constantFold,
      }),
      declarations
    );
    const body = BaseCompiler.withLocalShapeFrame(
      new Map(),
      gpuDeclaredShapeFrame(declarations),
      () =>
        // A function body is a statement position: a nested loop-form
        // `Sum`/`Product` hoists its loop ahead of the `return` (Tycho item
        // 110).
        BaseCompiler.compileFunctionBody(expr, target)
    );
    // The caller's declared return type is not this analysis's to check, but
    // the PLACEMENT of an emitted `return` is: a `Return` in a conditional arm,
    // or in the body's value position (which `compileFunction` return-prefixes),
    // is source no driver accepts (D6).
    gpuAssertReturnPlacement('this function body', body, this.languageId);
    return body;
  }

  compile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    // See the note in `javascript-target.ts`: the target-level route bypasses
    // the standalone `compile()` export, where these deprecations were warned
    // about and where the `complexPromotion` alias is resolved, so each target
    // entry warns and normalizes for itself. This target declares `['strict']`
    // only, so the alias is NOT mapped onto `mode: 'complex'` (that would turn
    // a compile that used to succeed into an `unsupported-mode` decline); it
    // is merely cleared, which matches the documented "ignored on the shader
    // targets" behaviour. Once-per-process per key.
    options = normalizeDeprecatedCompileOptions(
      options,
      GPU_SUPPORTED_MODES.includes('complex')
    ).options;
    // The `storage` hints, validated OUTSIDE the fallback `try`: an unknown
    // storage kind, or a hint naming something that is not a free symbol of
    // `expr`, is an option-contract error (the same class as an unknown
    // `mode`), never a decline the interpreter fallback may swallow. Guarded
    // so the analysis target is built only when there is something to
    // validate.
    const storage =
      options.storage === undefined
        ? undefined
        : resolveStorageHints(options.storage, [expr], this.createTarget(), {
            vars: options.vars,
            functions: options.functions,
          });
    try {
      // A `vars`-mapped symbol is compiled as the valueless input of its
      // declared type (`withVarsValuesHidden`).
      return withVarsValuesHidden(expr, options.vars, () =>
        this.compileOrThrow(expr, options, storage)
      );
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
      // A cancellation that is not a timeout (an abort, an iteration or
      // recursion limit), or a timeout of an expired enclosing span, belongs
      // to the caller: it is thrown again, not changed into a fallback
      // (docs/TIMEOUT-MODEL.md §2).
      throwIfCallerCancellation(e, expr.engine._deadlineFrame);
      if (options.fallback !== true) throw e;
      const error = (e as Error).message;
      console.warn(
        `Compilation fallback for "${expr.operator}" (target: ${this.languageId}): ${error}`
      );
      return BaseCompiler.buildInterpreterFallback(
        expr,
        error,
        this.languageId,
        this.createTarget(),
        options.vars ? new Set(Object.keys(options.vars)) : undefined,
        compileDiagnosticOf(e, error)
      );
    }
  }

  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {},
    storage?: CompileTarget<Expression>['storage']
  ): CompilationResult {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    // Turn a collection whose WIDTH is known at compile time into straight-line
    // scalar code, so this target sees the shape the interpreter computes
    // rather than a runtime array (`fixed-width-unroll.ts`). A head the caller
    // overrode is withheld from the pass: the caller's implementation replaces
    // the emission and receives the node's own operands, which an unroll would
    // change. This target reads no `operators` option.
    const unrollSkipHeads = overriddenCompilationHeads(
      undefined,
      options.functions
    );
    expr = unrollFixedWidthCollections(expr, {
      skipHeads: unrollSkipHeads,
      iterationBudget: options.iterationBudget,
      readsLiveSource: (name) => typeof options.vars?.[name] === 'string',
      // A shader has no loop lowering for a comprehension; a small one over
      // literal domains is written out as a fixed-size array literal
      // (`CompileTarget.unrollComprehensions`).
      unrollComprehensions: true,
    });
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const v2 = this.languageId === 'wgsl' ? 'vec2f' : 'vec2';
    const target = this.createTargetFor(expr, undefined, {
      // Constant-folder contract (`BaseCompiler.tryConstantFold`): a
      // `vars`-mapped symbol is a live runtime input (a uniform) and a
      // caller-overridden function must run the caller's implementation, so
      // subtrees mentioning either are never folded.
      varsKeys: vars ? new Set(Object.keys(vars)) : undefined,
      foldExcludedOps: userFunctions
        ? new Set(Object.keys(userFunctions))
        : undefined,
      // See `CompileTarget.unrollSkipHeads`: the same answer the entry above
      // used, for the definition bodies this entry never sees.
      unrollSkipHeads,
      constantFold: options.constantFold,
      // The validated `storage` hints (`compile()` resolved them), read by
      // the `At` lowering and by the reference gate `createTargetFor`
      // installs. Stamped per call like `constantFold`.
      storage,
      // The caller's requested compile mode; validated against
      // `supportedModes` (strict only here) by `BaseCompiler.compile`.
      mode: options.mode,
      functions: (id) => {
        // `Object.hasOwn`, not `in`: `in` walks the prototype chain, and this
        // table comes from the CALLER, so we cannot give it a null prototype.
        if (userFunctions && Object.hasOwn(userFunctions, id)) {
          // `entrySource` unwraps the `{ source, pure? }` descriptor form as
          // well as the bare spellings. Without it a descriptor matches
          // neither branch below and falls through to the built-in table,
          // silently discarding the caller's implementation. The `pure` half
          // of a descriptor has no meaning here: this target emits no early
          // exit that could skip a call.
          const fn = entrySource(userFunctions[id]);
          if (typeof fn === 'string') return fn;
          if (typeof fn === 'function') return fn.name || id;
        }
        return allFunctions[id];
      },
      constant: (id) =>
        id === 'ImaginaryUnit' ? `${v2}(0.0, 1.0)` : constants[id],
      var: (id) => {
        // Own-property test — see the `vars` lookup in `javascript-target.ts`:
        // `in` finds `Object.prototype` members on a caller-supplied map.
        // A mapping to a bare identifier is checked like a free symbol's own
        // name (`mangleId`): `{ in: 'in' }` would emit the reserved word `in`,
        // which no driver accepts. Other mappings (`u.a`, `v[0]`) are
        // caller source and are spliced in unchanged.
        if (vars && Object.hasOwn(vars, id)) {
          const source = vars[id] as string;
          if (typeof source === 'string' && /^[A-Za-z_]\w*$/.test(source))
            gpuCheckIdentifier(source, this.languageId);
          return source;
        }
        if (id === 'ImaginaryUnit') return `${v2}(0.0, 1.0)`;
        if (id in constants) return constants[id];
        // Returning `undefined` lets BaseCompiler fold an assigned value /
        // declared constant the way evaluate() does — otherwise a symbol
        // omitted from `expr.unknowns` (because the engine considers it known)
        // would be emitted as a bare, undeclared identifier, i.e. a shader
        // that fails to compile on the GPU. A genuinely free symbol has no
        // value and falls back to the bare (vars-mappable, unknowns-listed)
        // identifier.
        return undefined;
      },
      // Root compilation boundary: fresh, deterministic numbering for the
      // generated temporaries, seeded with the expression's own symbols and any
      // `_tv`/`_cse` token in the source the caller splices in.
      naming: BaseCompiler.newNamingContext(expr, [
        options.preamble,
        ...(vars ? Object.values(vars) : []),
      ]),
    });
    // The `vars` names, for the seed ABI check (§7): a seed that resolves to a
    // HOST-supplied uniform is the deferred ABI row, and must fail loudly
    // rather than silently draw a different stream than the host.
    // A helper whose value is a LIST has no by-reference lowering here (a
    // shader function cannot return a run-time list), and the fixed-width
    // unroll cannot see the list's width through the call. Substituting the
    // helper's body at the root call site exposes the list, as the interval
    // entry does at its root and the definition route does inside an emitted
    // body. Only a LIST-bodied helper is substituted: a point-valued helper
    // has its own shared `vecN` definition. The registry the substitution
    // consults exists only now, so this second pass follows the target's
    // creation. The text-typed-symbol gate the target carries already
    // followed every user-function body reachable from the root, so it
    // needs no second reading. A `vars` splice that the substituted body
    // repeats (a parameter read twice) is evaluated twice in the shader,
    // which is the same value each time: shader source has no side effects.
    // This pass also writes the norm of a point with a list component as its
    // explicit form (`explicitBroadcastPointNorm`), before the common
    // subexpressions are read, so the two share them.
    expr = unrollFixedWidthCollections(
      BaseCompiler.inlineCollectionValuedCallsAtRoot(expr, target, 'list<any>'),
      {
        skipHeads: unrollSkipHeads,
        iterationBudget: options.iterationBudget,
        readsLiveSource: (name) => typeof options.vars?.[name] === 'string',
        unrollComprehensions: true,
        explicitPointNorm: (point) => {
          const explicit = explicitBroadcastPointNorm(point, target);
          return typeof explicit === 'string' ? undefined : explicit;
        },
      }
    );
    if (vars) gpuRandomState(target).varNames = new Set(Object.keys(vars));

    // A statement position: the emitted `code` is a function body, so a
    // loop-form `Sum`/`Product` nested anywhere inside may hoist its loop ahead
    // of the value (Tycho item 110). With nothing hoisted this is byte-identical
    // to a plain `compile()`.
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      isOverriddenOperator: (name) =>
        userFunctions !== undefined && Object.hasOwn(userFunctions, name),
      isStringVar: (name) =>
        vars !== undefined && typeof vars[name] === 'string',
      isVarsKey: (name) => vars !== undefined && Object.hasOwn(vars, name),
    });
    const code = BaseCompiler.compileCseRoot(expr, target, 0, () =>
      BaseCompiler.compileFunctionBody(expr, target)
    );
    // `code` is spliced into a shader function body by the caller, so the same
    // placement rule applies here as inside an emitted definition (D6).
    gpuAssertReturnPlacement('this expression', code, this.languageId);
    const result: CompilationResult = {
      target: this.languageId,
      success: true,
      code,
    };
    const preamble = this.preambleFor(code);
    if (preamble) result.preamble = preamble;

    return BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
  }

  /**
   * The helper-function preamble required by `code` — every `_gpu_*` (and
   * complex/fractal) helper the emission references, in dependency order.
   * Used by `compileOrThrow` (which returns it as `CompilationResult.preamble`
   * for the caller to splice) and by `compileShader` (which splices it into
   * the emitted shader ahead of `main()`, since that route returns a complete
   * shader with no separate preamble channel).
   */
  protected preambleFor(code: string): string {
    // The user-defined function definitions this compilation emitted travel to
    // the consumer on the SAME channel as the `_gpu_*` helpers — the returned
    // preamble — so every route that delivers helpers delivers definitions
    // too, with no second channel to wire up. They are folded into `code`
    // first so the helper scans below see what the DEFINITION BODIES
    // reference (a `_gpu_powi` used only inside `f` is still a helper the
    // shader must declare), and appended AFTER the helpers so a definition
    // that calls one is declared second (GLSL: declaration before use).
    const userDefs = this.userFunctionDefs(code);
    if (userDefs) code = `${code}\n${userDefs}`;
    let preamble = '';
    const isWGSL = this.languageId === 'wgsl';
    // A complex helper can call `_gpu_inf()` from its body (`_gpu_casech` at
    // z = 0). GLSL requires a declaration before its use, so the GLSL
    // Infinity helper then goes BEFORE the complex helpers.
    const complexPreamble = buildComplexPreamble(code, this.languageId);
    const complexUsesInf = !isWGSL && complexPreamble.includes('_gpu_inf(');
    if (complexUsesInf) preamble += GPU_INF_PREAMBLE_GLSL;
    preamble += complexPreamble;
    // Both targets spell NaN and +∞ as `_gpu_nan()` / `_gpu_inf()`. On GLSL
    // both helpers are built from the ES 3.00 `intBitsToFloat` this target
    // already assumes, and must be declared before their first use, so they
    // are emitted here, ahead of every helper that calls them.
    //
    // The `_gpu_at*` positional-access helpers call `_gpu_nan()` from their
    // BODIES, which these scans never see — they read the EMITTED code, never
    // a helper body — so an `At` lowering FORCES the GLSL NaN helper: a
    // compilation whose code contains only `_gpu_at3(…)` must still get it.
    // WGSL declarations are order-independent, so the WGSL helpers are added
    // at the end instead, from a scan of the finished preamble (see there).
    const atWidths = gpuAtHelperWidths(code);
    const texAtWidths = gpuTexAtHelperWidths(code);
    // The zeta helpers call `_gpu_nan()` from their bodies too (a complex
    // value, or an f32 overflow), so they force the GLSL NaN helper as well.
    const usesZeta = /_gpu_(hurwitz_)?zeta/.test(code);
    // `_gpu_lerch_phi` calls both `_gpu_nan()` (a complex value, or a value
    // no method can vouch for) and `_gpu_hurwitz_zeta` (z = 1) from its own
    // body, the same gap `usesZeta` closes for the zeta helpers.
    // `_gpu_poly_log` calls the Lerch helpers without naming them in the
    // emitted code either (only `_gpu_poly_log` itself appears there), so it
    // shares this flag.
    const usesLerch = /_gpu_(lerch|poly_log)/.test(code);
    if (
      !isWGSL &&
      (code.includes('_gpu_nan') ||
        atWidths.length > 0 ||
        texAtWidths.length > 0 ||
        usesZeta ||
        usesLerch)
    )
      preamble += GPU_NAN_PREAMBLE_GLSL;
    // `_gpu_gamma` calls `_gpu_inf()` from its BODY at a pole (the float
    // projection of the interpreter's undirected infinity — pole-encoding
    // ruling 2026-08-28), so it forces the GLSL Infinity helper for the same
    // reason `_gpu_at*` forces the NaN helper: these scans read the EMITTED
    // code and never a helper body. The zeta helpers call `_gpu_inf()` at
    // their own pole the same way, and `_gpu_lerch_phi` at its own pole (a
    // non-positive integer a with s > 0).
    if (
      !isWGSL &&
      !complexUsesInf &&
      (code.includes('_gpu_inf') ||
        code.includes('_gpu_gamma') ||
        usesZeta ||
        usesLerch)
    )
      preamble += GPU_INF_PREAMBLE_GLSL;
    // AFTER the NaN branches, and that ORDER is load-bearing: GLSL requires a
    // declaration before its use, and these bodies call `_gpu_nan()`. The
    // order test in `at-gpu-compile.test.ts` is the tripwire.
    for (const w of atWidths) preamble += gpuAtPreamble(w, isWGSL);
    // The texture helpers call `_gpu_nan()` too, so the same order rule
    // applies. GLSL declares one per length; WGSL one per binding.
    for (const w of texAtWidths) preamble += gpuTexAtPreamble(w);
    if (isWGSL)
      for (const [binding, w] of gpuTexAtBindings(code))
        preamble += gpuTexAtPreambleWGSL(binding, w);
    // The scalar `_gpu_powi` and its per-width `vecN` overloads
    // (`_gpu_powi2`–`_gpu_powi4`) are declared independently: a compilation
    // that only powers a vector needs the vector form alone.
    preamble += gpuFixedPowerPreamble(code, isWGSL);
    for (const form of gpuPowiHelperForms(code))
      preamble +=
        form === 'scalar'
          ? isWGSL
            ? GPU_POWI_PREAMBLE_WGSL
            : GPU_POWI_PREAMBLE_GLSL
          : gpuPowiVecPreamble(form, isWGSL);
    // Every library goes through `gpuLibrarySubset`, which keeps only the
    // definitions this compilation names and the ones those call. A shader
    // preamble is compiled by the driver once per program, so an unused
    // definition costs first-draw time on every program that carries it.
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_ROUND_PREAMBLE_WGSL : GPU_ROUND_PREAMBLE_GLSL
    );
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_PI_TRIG_PREAMBLE_WGSL : GPU_PI_TRIG_PREAMBLE_GLSL
    );
    // `_gpu_zeta` calls `_gpu_gamma` from its own body for the s < 0
    // functional-equation branch, and every other zeta entry point
    // (`_gpu_hurwitz_zeta`, `_gpu_zeta_generalized`) can reach `_gpu_zeta`
    // — the same "scan reads emitted code, not helper bodies" gap
    // `_gpu_gamma`'s `_gpu_inf()` call has above, so force Γ's preamble in
    // whenever any zeta (or, transitively through it, Lerch) helper is
    // needed.
    preamble += gpuLibrarySubset(
      usesZeta || usesLerch ? `${code} _gpu_gamma(` : code,
      isWGSL ? GPU_GAMMA_PREAMBLE_WGSL : GPU_GAMMA_PREAMBLE_GLSL
    );
    // `_gpu_lerch_phi` calls `_gpu_zeta_pow` and `_gpu_hurwitz_zeta` from
    // its own body without naming them in the emitted code (only
    // `_gpu_lerch_phi` itself appears there), the same gap as above — force
    // both names in so the subset scan pulls their definitions in too.
    preamble += gpuLibrarySubset(
      usesLerch ? `${code} _gpu_zeta_pow( _gpu_hurwitz_zeta(` : code,
      isWGSL ? GPU_ZETA_PREAMBLE_WGSL : GPU_ZETA_PREAMBLE_GLSL
    );
    // AFTER the zeta preamble: `_gpu_lerch_phi` calls `_gpu_zeta_pow` and
    // `_gpu_hurwitz_zeta`, and GLSL requires their declaration first.
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_LERCH_PREAMBLE_WGSL : GPU_LERCH_PREAMBLE_GLSL
    );
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_ERF_PREAMBLE_WGSL : GPU_ERF_PREAMBLE_GLSL
    );
    if (code.includes('_gpu_heaviside'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_HEAVISIDE_PREAMBLE_WGSL
          : GPU_HEAVISIDE_PREAMBLE_GLSL;
    if (code.includes('_gpu_sinc'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_SINC_PREAMBLE_WGSL
          : GPU_SINC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnel'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_POLEVL_PREAMBLE_WGSL
          : GPU_POLEVL_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelC'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELC_PREAMBLE_WGSL
          : GPU_FRESNELC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelS'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRESNELS_PREAMBLE_WGSL
          : GPU_FRESNELS_PREAMBLE_GLSL;
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_BESSELJ_PREAMBLE_WGSL : GPU_BESSELJ_PREAMBLE_GLSL
    );
    // A Mandelbrot row carried the Julia iteration and a Julia row carried the
    // Mandelbrot one before the per-function pass.
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_FRACTAL_PREAMBLE_WGSL : GPU_FRACTAL_PREAMBLE_GLSL
    );
    if (code.includes('_gpu_rnd_draw')) {
      // One invocation-local u32 counter per frame (plus one shared by the
      // unframed spatial-noise draws). A shader global / WGSL `var<private>`
      // is per-invocation and initialized before the entry point runs, so
      // every invocation runs each of its frames from `n = 0`.
      const counters = [
        ...new Set(
          code.match(new RegExp(`${GPU_RANDOM_COUNTER_PREFIX}\\d+`, 'g')) ?? []
        ),
      ].sort(
        (a, b) =>
          Number(a.slice(GPU_RANDOM_COUNTER_PREFIX.length)) -
          Number(b.slice(GPU_RANDOM_COUNTER_PREFIX.length))
      );
      preamble +=
        '\n' +
        counters
          .map((n) =>
            this.languageId === 'wgsl'
              ? `var<private> ${n}: u32 = 0u;\n`
              : `uint ${n} = 0u;\n`
          )
          .join('');
      preamble += gpuLibrarySubset(
        code,
        isWGSL ? GPU_PCG3D_PREAMBLE_WGSL : GPU_PCG3D_PREAMBLE_GLSL
      );
    }
    if (code.includes('_gpu_gcd'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GCD_PREAMBLE_WGSL
          : GPU_GCD_PREAMBLE_GLSL;
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_MEDIAN_PREAMBLE_WGSL : GPU_MEDIAN_PREAMBLE_GLSL
    );
    // The colour library and the sRGB round trip that calls three of its
    // functions are subset together, so a row that converts one colour space
    // no longer carries the other twelve conversions.
    preamble += gpuLibrarySubset(
      code,
      isWGSL ? GPU_COLOR_LIBRARY_WGSL : GPU_COLOR_LIBRARY_GLSL
    );
    // WGSL: the NaN and +∞ helpers go in when the emitted code, a user
    // definition or ANY helper body included above calls them. Reading the
    // finished preamble covers every helper that calls them from its body
    // (the zeta, Lerch, Gamma, positional-access and colour helpers), with no
    // per-helper forcing list to keep in step.
    if (isWGSL) {
      const all = `${preamble}\n${code}`;
      if (/(?<![\w$])_gpu_inf\(/.test(all))
        preamble = GPU_INF_PREAMBLE_WGSL + preamble;
      if (/(?<![\w$])_gpu_nan\(/.test(all))
        preamble = GPU_NAN_PREAMBLE_WGSL + preamble;
    }
    if (!userDefs) return preamble;
    return preamble ? `${preamble}\n${userDefs}` : userDefs;
  }

  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    // This route answers with a bare EXPRESSION string and has no preamble
    // channel — neither for the `_gpu_*` helpers nor for a user-function
    // definition, and a function declaration is not an expression. Opt out of
    // the registry explicitly, so a user-function head keeps failing closed
    // here instead of compiling to a call whose definition is dropped.
    //
    // Deliberately NOT `compileFunctionBody`: this is not a statement position,
    // so there is nowhere to put a hoisted loop (Tycho item 110). With no sink
    // installed, a loop-form `Sum` falls back to the legacy block exactly as it
    // did before hoisting existed — which is a statement sequence, so the gate
    // below declines it rather than handing back statements as an "expression".
    // The single-line statements the emitted-source scan below cannot see: on
    // WGSL an assignment body emits `s = x`, which is a statement there, and on
    // BOTH targets a root `Declare` emits a bare declaration (dropping its
    // initializer). Checked structurally, before the body is compiled (D6).
    gpuAssertExpressionBody('compileToSource()', expr, this.languageId);
    // A sampler-backed read needs its helper declared, and this route has no
    // preamble channel — the same reason it opts out of user functions. An
    // ignored hint would be the silent failure the option's validation
    // exists to prevent, so it is refused outright.
    if (
      options.storage !== undefined &&
      Object.keys(options.storage).length > 0
    )
      throw new Error(
        'compileToSource() does not support the `storage` option: a ' +
          'sampler-backed read needs a helper declaration, and this route ' +
          'returns a bare expression with no preamble channel. Use ' +
          '`compile()`, whose result carries the preamble.'
      );
    const code = BaseCompiler.compile(
      expr,
      this.createTargetFor(expr, undefined, {
        userFunctions: undefined,
        constantFold: options.constantFold,
      })
    );
    // The contract of this route is an EXPRESSION. A body that lowers to
    // statements has no emission here (D6) — this route throws, as it already
    // does for a user-function head with no definition channel.
    gpuAssertExpressionOnly('compileToSource()', code, this.languageId);
    return code;
  }

  /**
   * Compile the statements of a shader body, for a KNOWN stage.
   *
   * ONE target — and therefore ONE random state — for the WHOLE body. The
   * random counters are numbered per compilation and `preambleFor` declares
   * each allocated name once over the JOINED emission, so compiling each
   * statement against a fresh target would restart the numbering and let two
   * independent frames in different statements ALIAS one counter (the second
   * frame's first draw would then be `hash(seed, 1)`).
   *
   * The stage is what makes the §7 check possible: an unframed `Random()`
   * lowers to `gl_FragCoord`-derived spatial noise, which exists only in a
   * fragment shader, so a non-fragment stage throws at CE compile time rather
   * than emitting code that fails later at GPU shader-compile time. It is a
   * property of the SHADER, not of the statement.
   *
   * `declarations` are the shader's own typed names — its `in`/varying inputs
   * and its uniforms. They are the exact analog of a `compileFunction`
   * parameter list (see `compileDeclaredFunctionBody`) and are both framed and
   * BOUND the same way: without the frame a `uniform vec2 v` fed to an
   * undeclared user function classified as a scalar, agreed with the
   * synthesized `float` parameter, and passed a `vec2` into a `float` slot
   * behind a reported success; without the binding a same-named engine symbol
   * folded over the declaration, and a WGSL input — a FIELD of the entry
   * point's `input` struct — emitted a bare identifier that names nothing
   * (each declaration's `ref` supplies the identifier to emit).
   */
  protected compileShaderBody(
    body: ReadonlyArray<{ variable: string; expression: Expression }>,
    stage: string,
    declarations: ReadonlyArray<GPUShaderDeclaration> = [],
    constantFold?: boolean
  ): Array<{ variable: string; code: string; stmts: string[] }> {
    // One name, two declarations (an input AND a uniform) is a redeclaration
    // neither language accepts — and on WGSL the two do not even resolve to
    // the same identifier (`input.v` vs the global `v`), so there is no
    // reading of the body to pick. Fail closed naming the collision (D6).
    const seen = new Set<string>();
    for (const d of declarations) {
      if (seen.has(d.name))
        throw new Error(
          `Could not compile: the shader declaration \`${d.name}\` is declared more than once (as an ` +
            `input and as a uniform): two storage classes cannot share one ` +
            `name, and a body referencing it names neither unambiguously. ` +
            `Rename one of them.`
        );
      seen.add(d.name);
    }
    // ONE naming context for the whole body too, seeded from EVERY statement:
    // the counter must stay distinct across statements (same reason as the
    // random counters), and a `_tv`-named symbol in any statement is a
    // collision for all of them. The caller-supplied assignment TARGETS are
    // seeded as source text as well: a hoisted loop declares its accumulator
    // ahead of the assignment, so a shader output spelled `_tv1` would
    // otherwise be shadowed and left unwritten (`_tv1 = _tv1`).
    const target = gpuDeclaredBodyTarget(
      this.createTargetFor(body[0]?.expression, stage, {
        constantFold,
        naming: BaseCompiler.newNamingContext(
          body.map((a) => a.expression),
          body.map((a) => a.variable)
        ),
      }),
      declarations
    );
    // Each assignment is a statement position of its own, so a loop-form
    // `Sum`/`Product` inside it hoists its loop into `stmts`, which the shader
    // assembly emits ahead of the assignment (Tycho item 110). The whole body
    // compiles under the shader's declared shapes: the declarations are in
    // scope for every statement.
    return BaseCompiler.withLocalShapeFrame(
      new Map(),
      gpuDeclaredShapeFrame(declarations),
      () =>
        body.map((assignment) => {
          // Same single-line holes as `compileToSource()`: `code` lands on the
          // right of `${variable} = …;`, where neither a WGSL assignment nor a
          // declaration (either language) is an expression. Checked on the
          // body, before it is compiled.
          gpuAssertExpressionBody(
            `compileShader() body statement "${assignment.variable}"`,
            assignment.expression,
            this.languageId
          );
          const { stmts, code } = BaseCompiler.compileStatementBody(
            assignment.expression,
            target
          );
          // `stmts` are hoisted STATEMENTS and the assembly emits them ahead of
          // the assignment, so they are legal. `code` is not: it lands on the
          // right of `${variable} = …;`, an expression position (D6).
          gpuAssertExpressionOnly(
            `compileShader() body statement "${assignment.variable}"`,
            code,
            this.languageId
          );
          return { variable: assignment.variable, code, stmts };
        })
    );
  }
}
