import type { Expression } from '../global-types.js';
import { entrySource } from './function-purity.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { normalizeDeprecatedCompileOptions } from './deprecation-warnings.js';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { parseColor, rgbToOklch } from '@arnog/colors';
import {
  tryGetConstant,
  foldTerms,
  tryGetComplexParts,
  isOpaqueComplexOperand,
  formatFloat,
  gpuNonFiniteLiteral,
  negativeBaseRealPow,
  principalComplexPow,
} from './constant-folding.js';

import type {
  CompileMode,
  CompileTarget,
  CompiledOperators,
  CompiledFunction,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { compileDiagnosticOf } from './diagnostics.js';
import {
  BaseCompiler,
  isProvablyCharacterOperand,
  isProvablyStringOperand,
  pointHasBroadcastComponent,
  statementBodyHead,
} from './base-compiler.js';
import {
  finitePartOfType,
  isNonRealNumber,
  resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { couldMatch, isSubtype } from '../../common/type/subtype.js';
import { typeToString } from '../../common/type/serialize.js';
import type { Type } from '../../common/type/types.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { foldSeed } from '../numerics/random.js';

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
 * these cannot be emitted bare; the target fails closed (D6).
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
 * Fail closed (D6) if `id` is a reserved word in the target shader language.
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
 * Fail closed (D6) when the compiled shader body `body` places a `return`
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
        `${subject}: an early \`Return\` here has no ` +
          `${language.toUpperCase()} lowering — the emitted source would place ` +
          `a \`return\` where the language requires an expression ` +
          `(\`${line.trim()}\`). A shader function returns once, at the end of ` +
          `its body, so a \`Return\` inside a conditional — or one that IS the ` +
          `body's final value — cannot be emitted. Rewrite it as a conditional ` +
          `VALUE, or evaluate instead. Fail closed (D6).`
      );
    }
  }
}

/**
 * Fail closed (D6) when `code`, produced by an **expression-only** route, is
 * not a single expression of the target language.
 *
 * `compileToSource()` answers with a bare expression string, and each
 * `compileShader()` body statement is spliced into an assignment RHS
 * (`<variable> = <code>;`). Neither position accepts a statement, and neither
 * GLSL nor WGSL has an expression-level block or immediately-invoked function
 * to wrap one in — so a body that lowers to a statement sequence (a `Block`
 * with more than one statement, a loop-form `Sum`/`Product`/`Loop`) or to a
 * bare `return` has no honest emission here. Before this gate both routes
 * spliced the statements in verbatim, producing source no driver accepts
 * (`gl_FragColor = float s;\ns = x;\nreturn return s;;`).
 *
 * The shapes that DO reduce to an expression are untouched: a single-statement
 * `Block` already unwraps to its expression in the base compiler, so it never
 * reaches this check with a newline.
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
    `${subject}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `lowers to ${
        multiStatement ? 'a statement sequence' : 'a bare `return` statement'
      } (\`${excerpt}${multiStatement ? '…' : ''}\`). ${lang} has no ` +
      `expression-level block or immediately-invoked function to wrap ` +
      `statements in, so there is no valid emission for this position. ` +
      `Compile a statement body with compile() instead — that route emits a ` +
      `function body. Fail closed (D6).`
  );
}

/**
 * Fail closed (D6) on an expression-only GPU route whose body is STRUCTURALLY a
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
      `${subject}: this route emits a single WGSL EXPRESSION, but the body is ` +
        `an assignment. WGSL assignment is a STATEMENT (unlike GLSL, where it ` +
        `is an operator), so the emitted \`… = <target> = <value>\` is not ` +
        `valid source. Compile a statement body with compile() instead — that ` +
        `route emits a function body. Fail closed (D6).`
    );
  }
  throw new Error(
    `${subject}: this route emits a single ${lang} EXPRESSION, but the body ` +
      `is a declaration. A declaration is a STATEMENT in ${lang}, so the ` +
      `emitted \`${language === 'wgsl' ? 'var s: f32' : 'float s'}\`-shaped ` +
      `source is not valid in an expression position — and it carries no ` +
      `initializer, so the declared value would be silently DROPPED. Compile ` +
      `a statement body with compile() instead — that route emits a function ` +
      `body. Fail closed (D6).`
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

/**
 * Fail closed (D6) on a color constructor given a 4th (alpha) operand.
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
  throw new Error(
    `${head}: an alpha (4th) operand is not representable on the GPU target — ` +
      `color values are \`vec3\` (OKLCh) end to end, with no alpha channel. ` +
      `Drop the alpha operand and pass it separately (e.g. as a uniform) at ` +
      `the framebuffer boundary. Fail closed (D6).`
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
    // union such as `complex | non_finite_number` (`Artanh`, `Arcoth`,
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
      `${head}: an impure (Random) operand cannot be bound to a temporary ` +
        'at this position — a repeated draw would shift every later value ' +
        'in the shader. Fail closed (D6).'
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
 * The complex lowering of a RECIPROCAL inverse head (`Arcsec`, `Arccsc`,
 * `Arsech`, `Arcoth`), as `helper(1 / z)`.
 *
 * There is no direct `_gpu_casec`/`_gpu_cacsc`/`_gpu_casech`/`_gpu_cacoth`
 * preamble helper, so this is the complex lift of the head's OWN real lowering
 * (`acos(1/x)`, `asin(1/x)`, `acosh(1/x)`, `atanh(1/x)`). The composition is
 * the principal value — checked against `Complex.asec`/`acsc`/`asech`/`acoth`
 * at real in-domain, real out-of-domain and general complex points.
 */
function gpuReciprocalComplex(
  helper: string,
  x: Expression,
  compile: (expr: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const v2 = gpuVec2(target);
  return `${helper}(_gpu_cdiv(${v2}(1.0, 0.0), ${gpuComplexOperand(x, compile, target)}))`;
}

/**
 * Emit a NaN value valid for the target shader language.
 *
 * Neither GLSL nor WGSL has a `NaN` identifier (the base compiler's default
 * `If`/`Which`/`When` emit a bare `NaN`, which fails to compile on GPU). WGSL
 * rejects a constant `0.0 / 0.0` during const-evaluation, so it uses a NaN bit
 * pattern inline. GLSL routes through the `_gpu_nan()` preamble helper (see
 * `GPU_NAN_PREAMBLE_GLSL`): a masked (`When`/`Which` else) branch's NaN is thus
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
 * Number of vector components a value expression occupies on the GPU (2–4),
 * or `undefined` for a scalar. Structural for `Tuple`/`List` literals (the
 * parametric-body shape `(x(t), y(t))` → `vec2`), type-based for typed
 * operands (`tuple<…>`, a 1-axis `list`), and 2 for a complex value (lowered
 * as `vec2(re, im)`).
 */
function gpuComponentCount(expr: Expression | null): 2 | 3 | 4 | undefined {
  return BaseCompiler.vectorComponentCount(expr);
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
 * vector — so fail closed (D6) with a diagnostic naming the shape instead of
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
      `${ctor}: an empty tuple/list has no GPU lowering — neither GLSL nor ` +
        `WGSL has a zero-length array type. Fail closed.`
    );
  for (const arg of args) {
    if (!BaseCompiler.isNonScalarShape(arg)) continue;
    const n = BaseCompiler.aggregateComponentCount(arg);
    const shape =
      n === undefined
        ? 'a matrix/tensor value'
        : `${n} component${n === 1 ? '' : 's'} — a complex value or a ` +
          `nested tuple/list`;
    throw new Error(
      `${ctor}: a tuple/list element that is itself vector-valued ` +
        `(${shape}) has no GPU ` +
        `lowering; a ${ctor} constructor takes scalar components. Fail closed.`
    );
  }
}

/**
 * A NaN matching the SHAPE of `val`: scalar NaN for a scalar value, a
 * broadcast vector constructor (`vec2(_gpu_nan())` / `vec2f(bitcast<…>)`)
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
 * interpreter, which evaluates only the taken branch. Fail closed (D6); the
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
  const before = sink?.stmts.length ?? 0;
  const code = compiled();
  if (sink !== undefined && sink.stmts.length > before) {
    // Drop the escaped statements: the throw is recoverable (the engine-level
    // `compile()` catches it to build the interpreter fallback) and a caller
    // reusing the target must not inherit orphaned code.
    sink.stmts.length = before;
    throw new Error(
      `${head}: a conditionally-evaluated branch contains a multi-statement ` +
        `construct (a loop-form Sum/Product, or an impure operand bound to a ` +
        `hoisted temporary). Hoisting it out of the branch would run it ` +
        `unconditionally — a shader conditional is an expression, not a ` +
        `statement — which changes the result whenever the branch draws ` +
        `from the random stream. Fail closed (D6).`
    );
  }
  return code;
}

/**
 * Emit a conditional `cond ? whenTrue : whenFalse` for the target language.
 *
 * GLSL has the ternary operator; WGSL does not and uses
 * `select(false_value, true_value, condition)` instead.
 */
function gpuConditional(
  cond: string,
  whenTrue: string,
  whenFalse: string,
  target?: CompileTarget<Expression>
): string {
  if (target?.language === 'wgsl')
    return `select(${whenFalse}, ${whenTrue}, ${cond})`;
  return `((${cond}) ? (${whenTrue}) : (${whenFalse}))`;
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

/** Fail closed (D6) on a shape the element-wise selection cannot render. */
function gpuSelectionDecline(reason: string): never {
  throw new Error(`Which: ${reason} Fail closed (D6).`);
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
      const w = BaseCompiler.vectorComponentCount(op);
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
      return BaseCompiler.vectorComponentCount(op) === undefined
        ? `${fvec}(${code})`
        : code;
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
      if (masks.length !== 1) throw new Error('Not: expected one argument');
      return target.language === 'wgsl'
        ? `(!(${masks[0]}))`
        : `not(${masks[0]})`;
    }
    return h === 'And'
      ? gpuMaskAnd(masks, n, target)
      : gpuMaskOr(masks, n, target);
  }

  // A boolean-vector value used directly as the condition, or a scalar boolean
  // splat across the selection width.
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
    const w = BaseCompiler.vectorComponentCount(arm);
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
 * (`BaseCompiler.vectorComponentCount`). Anything else (an unknown-length
 * list, a matrix, a 5+-element list) has no shader vector value at all, so it
 * fails closed (D6) rather than emitting source a driver would reject.
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
    throw new Error(`${head}: ${reason} Fail closed (D6).`);
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
  if (BaseCompiler.vectorComponentCount(operand) === undefined)
    decline(
      `the operand \`${operand.toString()}\` has no static vec2–vec4 shape ` +
        `(an unknown-length list, a matrix, or a 5+-element list), so it is ` +
        `not a shader vector and the componentwise builtins do not apply to it.`
    );
  const vector = lowering.collection();
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
 * `isNonScalarShape` ("is this a scalar at all?") and `vectorComponentCount`
 * ("does it have a `vec2`–`vec4` lowering?") — so it stays in step with them
 * rather than re-deciding shape from scratch.
 *
 * A COMPLEX value reads as a scalar here, even though it lowers to a `vec2` of
 * (re, im): the complex convention is its own, carried by the complex codegen
 * (`_gpu_cmul`, `_gpu_cdiv`, …), and reading it as a 2-cell vector would make
 * every complex lowering look like a shape error. This is the same ordering
 * the fan-out and selection lowerings depend on.
 */
export function gpuOperandShape(
  expr: Expression
): 'scalar' | 'matrix' | 'array' | 2 | 3 | 4 {
  if (BaseCompiler.isComplexValued(expr)) return 'scalar';
  if (!BaseCompiler.isNonScalarShape(expr)) return 'scalar';
  const width = BaseCompiler.vectorComponentCount(expr);
  if (width !== undefined) return width;
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
  if (GPU_AGGREGATE_CONSTRUCTOR.test(call.callee)) return true;
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
 * handed are no longer in its emission.
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
    throw new Error(`${head}: ${reason} Fail closed (D6).`);
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
    // lowering (WGSL's `Mod` → `(((a % b) + b) % b)`, `Log10` →
    // `log(a) / log(10.0)`). Aggregate-consuming lowerings have already
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
    throw new Error(`${name}: needs at least one argument`);
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
          `${head}: the shader builtin \`${name}\` takes a scalar only ` +
            `${gpuSlotNames(slots!)}, but the emitted call \`${acc}\` has a ` +
            `scalar in argument ${bad + 1}, where the overload requires the ` +
            `\`vecN\` genType; the scalar is not promoted to a vector. ` +
            `Fail closed (D6).`
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
    throw new Error(`${head}: needs at least one argument`);
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
  // what `foldNaryBuiltin` emitted.
  if (!isAggregate.some((x) => x)) return fold(codes);

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
        `${head}: the operand \`${args[i].toString()}\` lowers to a shader ` +
          `${gpuShapeName(shapes[i])} with no compile-time component list, so ` +
          `there is nothing for the reduction to fold over — a shader has no ` +
          `dynamic iteration here, and the \`${name}\` builtin is ` +
          `componentwise, not a reduction. Fail closed (D6).`
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
 * Compile a point-coordinate accessor (`PointX`/`PointY`/`PointZ`) as a GPU
 * swizzle. A single point is a `vec2`/`vec3`/`vec4`, so `.x`/`.y`/`.z` is
 * valid. A *list* of points is not a GPU value — a swizzle on it is invalid
 * shader source, so a list-of-points operand fails closed (D6) rather than
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
      `Point${comp.toUpperCase()}: a list of points has no GPU lowering ` +
        `(a point must be a single vec2/vec3/vec4): ${projected.decline}. ` +
        `Fail closed.`
    );
  }
  // A stated point arity makes an out-of-range coordinate a static error:
  // `p.z` on a `vec2` is invalid shader source. Symmetric with the list
  // route's arity decline in `compilePointListProjection`. An unparameterized
  // `tuple` states no arity and keeps the emission.
  if (pointArity !== undefined && pointArity <= idx)
    throw new Error(
      `Point${comp.toUpperCase()}: the point has arity ${pointArity} ` +
        `— no ${['first', 'second', 'third'][idx]} coordinate. ` +
        `Fail closed (D6).`
    );
  return `${compile(arg)}.${comp}`;
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
type GPUAtBase = { count: number } | { decline: string };

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
 * The static element count of an admissible `At` base — a declared
 * `vector<N>`, a parameterized `tuple<…>`, or a literal `List`/`Tuple` — or a
 * DISCRIMINATED decline reason.
 *
 * Bases whose elements are object-domain (`list<string>`) never reach here:
 * the §3.F absence gate in `BaseCompiler.compile` pre-empts them with its own
 * diagnostic, so no reason is owed for them.
 */
function gpuAtBaseShape(base: Expression | null): GPUAtBase {
  if (base === null) return { decline: 'it has no base operand' };
  const t = gpuType(base);

  if (isSymbol(base, 'Missing') || t === 'missing')
    return {
      decline:
        'the base is the absence marker `Missing`, which has no shader ' +
        'value to index into',
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
    return e.im === 0 && Number.isInteger(e.re) ? 'int' : 'other-literal';
  // Every OTHER literal is likewise an entry that selects no element — a
  // string, a nested collection, the absence marker. Classifying them 'dyn'
  // handed them the demand-gated dynamic-gather text, which describes a
  // runtime-valued integer they are not: D2 requires a literal non-integer to
  // carry its own reason.
  if (
    isString(e) ||
    isSymbol(e, 'Missing') ||
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
 * fail-closed (D6) decline, which names the shape that has no lowering.
 */
function compileGPUAt(
  args: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>
): string {
  // Annotated (rather than inferred) so a `decline(…)` call narrows what
  // follows it — the `gpuCheckOperandShapes` convention.
  const decline: (reason: string) => never = (reason) => {
    throw new Error(`At: ${reason}. Fail closed (D6).`);
  };

  if (args.length < 2) decline('it has no index operand');
  if (args.length > 2)
    decline(
      `a multi-index access (${args.length - 1} indices) walks a nested ` +
        `collection, and only a one-dimensional base has a shader value shape`
    );

  const base = args[0];
  const index = args[1];

  const shape = gpuAtBaseShape(base);
  if ('decline' in shape) decline(shape.decline);
  const n = shape.count;

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
  // operand, so neither may be impure.
  if (isSymbol(index, 'Missing') || isSubtype(it, 'missing')) {
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
  // the NaN spelling.
  if (isNumber(index)) {
    const j = gpuAtSlot(index.re, n);
    if (j === null) {
      // The fold emits neither operand (the index is a literal, so pure).
      requirePureFold('base');
      return gpuNaN(target);
    }
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

  // Dynamic index: one call, so the base and the index are each evaluated
  // exactly once. The guard inside the helper is what makes both languages'
  // out-of-bounds rules unreachable. A caller-declared INTEGER index is
  // converted at the call site — the guard runs entirely in float space.
  const isWGSL = target.language === 'wgsl';
  const idx = compile(index);
  return `_gpu_at${n}(${compile(base)}, ${
    framedIndex === undefined ? idx : `${isWGSL ? 'f32' : 'float'}(${idx})`
  })`;
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
  const b = formatFloat(n, lang);
  const guard = `!(i >= -${b} && i <= ${b}) || i != floor(i) || i == 0.0`;
  const doc =
    `  // 1-based; negative counts from the end; anything else → NaN.\n` +
    `  // The guard runs entirely in float space: it rejects NaN, ±∞, huge\n` +
    `  // finite values, non-integers and 0 BEFORE the int cast (undefined\n` +
    `  // outside int range), and makes both languages' out-of-bounds rules\n` +
    `  // (GLSL UB / WGSL indeterminate) unreachable.`;
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
  const widths = new Set<number>();
  const re = /(?<![\w$])_gpu_at(\d+)\s*\(/g;
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
  expr: Expression,
  compile: (e: Expression) => string,
  target?: CompileTarget<Expression>
): string {
  const c = tryGetConstant(expr);
  if (c !== undefined && Number.isInteger(c)) return c.toString();
  const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
  return `${intCast}(${compile(expr)})`;
}

/** Maximum range for inline unrolling of Sum/Product loops in GPU targets. */
const GPU_UNROLL_LIMIT = 100;

/**
 * Fail closed (D6) on a Sum/Product bound that is statically non-finite (a
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
    `${kind}: the ${which} bound \`${expr.toString()}\` is not a finite ` +
      `number — an infinite or NaN bound has no terminating loop. ` +
      `Fail closed (D6).`
  );
}

/**
 * Maximum absolute exponent for inlining an integer `Power` as repeated
 * multiplication (`x*x*x`), for a *simple* base only (symbol or number, so the
 * base subexpression can be safely repeated). Larger exponents — or any
 * compound base — route through the `_gpu_powi` preamble helper instead, which
 * evaluates the base once and keeps the sign correct for a negative base.
 */
const GPU_POWI_INLINE_LIMIT = 4;

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
    throw new Error('Binomial: need two arguments');
  const kConst = tryGetConstant(k);
  if (kConst === undefined || !Number.isInteger(kConst) || kConst < 0)
    throw new Error(
      `Binomial: only a literal non-negative integer second operand ` +
        `compiles — anything else is inert in the interpreter. ` +
        `Fail closed (D6).`
    );
  if (kConst > GPU_BINOMIAL_UNROLL_LIMIT)
    throw new Error(
      `Binomial: a second operand above ${GPU_BINOMIAL_UNROLL_LIMIT} would ` +
        `unroll to ${kConst} factors. Fail closed (D6).`
    );
  if (BaseCompiler.isComplexValued(n))
    throw new Error(
      `Binomial: a complex first operand has no GPU lowering. ` +
        `Fail closed (D6).`
    );
  // A statically non-finite first operand: the interpreter returns NaN for
  // BOTH `Binomial(∞, 0)` (probed — the `k = 0 → 1` fold below does NOT hold
  // there) and `Binomial(∞, k)`. Check before the `k` special cases so neither
  // fold can emit a diverging value. Only a STATICALLY provable non-finite
  // operand declines: a runtime ±∞ reaching a finite-typed binding still
  // unrolls (the documented static-assert class), as no runtime finite guard
  // is emitted — that would change every pure emission.
  if (
    (isNumber(n) && !Number.isFinite(n.re)) ||
    n.type.matches('infinity') ||
    n.type.matches('nan')
  )
    throw new Error(
      `Binomial: a statically non-finite first operand evaluates to NaN in ` +
        `the interpreter, not a falling factorial. Fail closed (D6).`
    );
  if (kConst === 0) {
    // `Binomial(x, 0)` is 1 — but the interpreter still EVALUATES the first
    // operand (probed: `Binomial(Random(), 0)` consumes exactly one draw).
    // Folding the operand away would skip the draw and shift every later
    // value in the shader, and there is no sink for a discarded temporary
    // here, so an impure operand declines instead.
    if (n.isPure === false)
      throw new Error(
        `Binomial: a second operand of 0 discards the first, but an impure ` +
          `(Random) first operand is still drawn by the interpreter. ` +
          `Fail closed (D6).`
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
  if (!args[0]) throw new Error(`${kind}: no body`);
  if (!args[1]) throw new Error(`${kind}: no indexing set`);

  // Reject a collection-valued body for the indexed form (see
  // `BaseCompiler.assertScalarBigOpBody`): scalar accumulation over arrays
  // would silently produce a wrong value. Reached only for the indexed form
  // (the `!args[1]` guard above rules out the reduce form).
  BaseCompiler.assertScalarBigOpBody(kind, args[0]);

  if (BaseCompiler.isComplexValued(args[0]))
    throw new Error(
      `${kind}: complex-valued body not supported in GPU targets`
    );

  // Multi-index Sum/Product (more than one indexing set) would drop the
  // trailing clauses. Fail closed (D6) rather than emit code with a dangling
  // index.
  if (args.length > 2)
    throw new Error(
      `${kind}: multi-index (${args.length - 1} indexing sets) is not supported in GPU targets`
    );

  const limitsExpr = args[1];
  if (!isFunction(limitsExpr, 'Limits'))
    throw new Error(`${kind}: expected Limits indexing set`);

  const limitsOps = limitsExpr.ops;
  const index = isSymbol(limitsOps[0]) ? limitsOps[0].symbol : '_';
  assertFiniteGPUBound(kind, limitsOps[1], 'lower');
  assertFiniteGPUBound(kind, limitsOps[2], 'upper');
  // A bound mentioning a compile-bound name (a user function's parameter, an
  // enclosing binder's index) is NOT a compile-time constant — see
  // `BaseCompiler.bigOpBoundConstant`. Reading one folded
  // `F(i) = Σ_{m=1..i} m` to `float _fn_F(float i) { return 0.0; }`.
  const lowerNum = BaseCompiler.bigOpBoundConstant(limitsOps[1]);
  const upperNum = BaseCompiler.bigOpBoundConstant(limitsOps[2]);

  const isSum = kind === 'Sum';
  const op = isSum ? '+' : '*';
  const identity = isSum ? '0.0' : '1.0';
  const isWGSL = target.language === 'wgsl';
  const bothConstant = lowerNum !== undefined && upperNum !== undefined;

  if (bothConstant && lowerNum > upperNum) return identity;

  // Unroll small constant ranges — pure inline expression
  if (bothConstant && upperNum - lowerNum + 1 <= GPU_UNROLL_LIMIT) {
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
      const termSink = { stmts: [] as string[], boundVars: termBoundVars };
      const innerTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => (id === index ? kStr : target.var(id)),
        boundVars: termBoundVars,
        hoist: BaseCompiler.canHoist(target) ? termSink : undefined,
      };
      const code = BaseCompiler.compile(args[0], innerTarget);
      if (termSink.stmts.length === 0) {
        terms.push(`(${code})`);
        continue;
      }
      // The sink is non-empty only when `canHoist(target)` held above.
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
  const bodySink = { stmts: [] as string[], boundVars: bodyBoundVars };
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
  const body = BaseCompiler.compile(args[0], bodyTarget);

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
  // type (`bool`, a vector) is no loop bound at all and fails closed (D6).
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
      `${kind}: the ${which} bound \`${bound.toString()}\` is declared ` +
        `"${declared.spelling}" by the caller, which is not ` +
        `a scalar number — a loop bound must be one. Fail closed (D6).`
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

  const loop = [
    `${accDecl} = ${identity};`,
    `for (${indexDecl} = ${lowerStr}; ${index} <= ${upperStr}; ${index}++) {`,
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
    const parts = args.map(
      (a) => tryGetComplexParts(a, compile, target.language)!
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
        (isNumber(op) && op.re === 0 && op.im !== 0)
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
    if (x === null) throw new Error('Negate: no argument');
    const c = tryGetConstant(x);
    if (c !== undefined) return formatFloat(-c, target.language);
    if (isNumber(x) && x.im !== 0) {
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
  Abs: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `length(${compile(args[0])})`;
    if (BaseCompiler.isNonNegative(args[0])) return compile(args[0]);
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
  Ceil: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `ceil(${compile(args[0])})`;
  },
  Clamp: 'clamp',
  Cos: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_ccos(${compile(args[0])})`;
    return `cos(${compile(args[0])})`;
  },
  // CE's `Degrees` converts degrees→radians (Degrees(180) = π), which is
  // GLSL's `radians()`. GLSL's `degrees()` is the inverse (rad→deg).
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
  First: (args, compile) => `${compile(args[0])}.x`,
  Second: (args, compile) => `${compile(args[0])}.y`,
  Third: (args, compile) => `${compile(args[0])}.z`,
  // Point-coordinate accessors. On the GPU a point is a `vec2`/`vec3`/`vec4`,
  // so a single point maps to the same swizzle as First/Second/Third. A list of
  // points is not a GPU value: emitting a swizzle on it produces invalid shader
  // source, so a list-of-points operand fails closed (D6) rather than compiling
  // to garbage behind `success: true`.
  PointX: (args, compile, target) =>
    compilePointSwizzle(args[0], 'x', compile, target),
  PointY: (args, compile, target) =>
    compilePointSwizzle(args[0], 'y', compile, target),
  PointZ: (args, compile, target) =>
    compilePointSwizzle(args[0], 'z', compile, target),
  Floor: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
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
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    // The condition is evaluated unconditionally, so it may hoist; the two arms
    // are selected and must not (see `compileGPUConditionalArm`).
    return gpuConditional(
      compile(args[0]),
      compileGPUConditionalArm('If', () => compile(args[1]), target),
      compileGPUConditionalArm('If', () => compile(args[2]), target),
      target
    );
  },
  When: (args, compile, target) => {
    if (args.length !== 2)
      throw new Error('When: expected exactly 2 arguments (expr, cond)');
    // `When` is deliberately NOT a selection form (elementwise-Which design
    // §5): its condition must be a scalar boolean. A provably collection-valued
    // condition would otherwise emit garbage (`(vec2(True, False)) ? …`).
    BaseCompiler.assertScalarCondition(args[1]);
    if (isSymbol(args[1], 'True')) return `(${compile(args[0])})`;
    // The masked branch's NaN must match the value's SHAPE (a tuple-valued
    // body compiles to a vecN) — see `gpuNaNFor` (Tycho item 49).
    if (isSymbol(args[1], 'False')) return gpuNaNFor(args[0], target);
    return gpuConditional(
      compile(args[1]),
      compileGPUConditionalArm('When', () => compile(args[0]), target),
      gpuNaNFor(args[0], target),
      target
    );
  },
  Which: (args, compile, target) => {
    if (args.length < 2 || args.length % 2 !== 0)
      throw new Error('Which: expected condition/value pairs');
    // The fall-through NaN must match the branch values' shape (see
    // `gpuNaNFor`); every branch of a well-typed `Which` shares one shape,
    // so the first determinable value decides.
    const shapeRef =
      args.filter((_, i) => i % 2 === 1).find((v) => gpuComponentCount(v)) ??
      null;
    const build = (i: number): string => {
      if (i >= args.length) return gpuNaNFor(shapeRef, target);
      const cond = args[i];
      const val = args[i + 1];
      // Only the FIRST condition is evaluated unconditionally. Every value, and
      // every LATER condition, sits behind a branch and must not hoist out of
      // it. (`build(i + 2)` needs no wrapper of its own: it guards its own
      // pieces on the next turn of the recursion.)
      const armed = (f: () => string): string =>
        i === 0 ? f() : compileGPUConditionalArm('Which', f, target);
      // `True` marks the default branch.
      if (isSymbol(cond, 'True')) return `(${armed(() => compile(val))})`;
      return gpuConditional(
        armed(() => compile(cond)),
        compileGPUConditionalArm('Which', () => compile(val), target),
        build(i + 2),
        target
      );
    };
    return build(0);
  },
  // Epsil `Match`: tier-0/1 constant dispatch as a nested `select`/ternary with
  // `==` comparisons, the subject inlined into each comparison (safe for a PURE
  // subject; an impure one is bound to a hoisted temporary instead — see
  // `BaseCompiler.compileMatchTernary`). Tier-2 destructuring, refutable
  // tier-3, and string constants (no string type) fail closed (D6).
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
    if (base === null) throw new Error('Power: no argument');
    if (
      BaseCompiler.isComplexValued(base) ||
      BaseCompiler.isComplexValued(exp)
    ) {
      if (isSymbol(base, 'ExponentialE')) return `_gpu_cexp(${compile(exp)})`;
      const v2 = gpuVec2(target);
      const bCode = BaseCompiler.isComplexValued(base)
        ? compile(base)
        : `${v2}(${compile(base)}, 0.0)`;
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
    if (eConst === 0.5) return `sqrt(${compile(base)})`;
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
        pos = `(${Array(absN).fill(code).join(' * ')})`;
      } else {
        // Compound or large: route through the helper so the base subexpression
        // is evaluated once (not duplicated) and the sign stays correct. The
        // exponent stays a scalar in the `vecN` overloads too.
        pos = `_gpu_powi${powWidth ?? ''}(${compile(base)}, ${formatGPUNumber(absN)})`;
      }
      // `float / vecN` is a componentwise division in both languages, so the
      // reciprocal of a vector power needs no widening either.
      return n < 0 ? `(1.0 / ${pos})` : pos;
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
    // GLSL/WGSL `round()` rounds half to even (implementation-defined ties);
    // the interpreter rounds half away from zero (Round(-2.5) = -3).
    // Reconstruct half-away as `sign(x)·floor(|x| + 0.5)`.
    // `halfAway` splices its operand TWICE, so the operand goes through
    // `gpuOperandOnce`: an impure (Random-family) operand is bound to a
    // hoisted temporary instead of re-drawn, a pure one compiles directly
    // (byte-identical).
    const halfAway = (c: string): string =>
      `(sign(${c}) * floor(abs(${c}) + 0.5))`;
    if (args.length < 2) {
      if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
      return halfAway(gpuOperandOnce('Round', args[0], compile, target));
    }
    // The SECOND operand is a precision: `Round(x, n)` rounds to `n` DECIMAL
    // places (the Desmos/spreadsheet form the signature `(number, integer?)`
    // declares) — `Round(x·10ⁿ)/10ⁿ`, which is what the interpreter and the
    // JavaScript and interval targets all compute. Both operands are required;
    // dropping the precision would silently round to an integer.
    //
    // The factor must be a compile-time constant. A shader `pow(10.0, n)` for
    // a RUNTIME `n` is spec-defined as `exp2(n·log2(10.0))`, which is not
    // exactly a power of ten — it moves the very tie boundary the rounding it
    // scales for depends on — and neither language has an integer `pow` to
    // fall back on. A non-constant precision therefore fails closed (D6), as
    // it already does on the interval target.
    const n = tryGetConstant(args[1]);
    if (n === undefined || !Number.isInteger(n))
      throw new Error(
        `Round: rounding to \`n\` decimal places compiles on the ` +
          `${target.language ?? 'GPU'} target only for a compile-time ` +
          `INTEGER precision — the factor 10ⁿ has to be folded, because a ` +
          `shader \`pow(10.0, n)\` is \`exp2(n·log2(10.0))\` and is not ` +
          `exactly a power of ten. Fail closed (D6).`
      );
    // 10ⁿ and its reciprocal must both be representable as a shader float
    // (f32 normals stop at ~3.4e38 / ~1.2e-38); past that the emitted literal
    // is an infinity and the whole expression collapses to 0 or NaN.
    if (Math.abs(n) > 37)
      throw new Error(
        `Round: the rounding factor 10^${n} is outside the shader float ` +
          `range. Fail closed (D6).`
      );
    // An integer-valued operand is unchanged by rounding to a NON-NEGATIVE
    // number of decimal places (it is not, for a negative `n`, which rounds
    // to tens, hundreds, …).
    if (n >= 0 && BaseCompiler.isIntegerValued(args[0]))
      return compile(args[0]);
    const factor = formatFloat(Math.pow(10, n), target.language);
    // The SCALED operand is what `halfAway` splices twice — bind the operand
    // itself once, then build the scaled string from it.
    const c0 = gpuOperandOnce('Round', args[0], compile, target);
    return `(${halfAway(`(${c0} * ${factor})`)} / ${factor})`;
  },
  Sign: 'sign',
  Sin: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0]))
      return `_gpu_csin(${compile(args[0])})`;
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
    return `tan(${compile(args[0])})`;
  },
  Truncate: (args, compile) => {
    if (BaseCompiler.isIntegerValued(args[0])) return compile(args[0]);
    return `trunc(${compile(args[0])})`;
  },

  // Complex-specific functions
  Real: (args, compile) => {
    if (BaseCompiler.isComplexValued(args[0])) return `(${compile(args[0])}).x`;
    return compile(args[0]);
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
      return `atan(${code}.y, ${code}.x)`;
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
      return `${v2}(${code}.x, -${code}.y)`;
    }
    return compile(args[0]);
  },

  Remainder: ([a, b], compile, target) => {
    if (a === null || b === null)
      throw new Error('Remainder: missing argument');
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
          'Remainder: an impure (Random) operand cannot be bound to a ' +
            'temporary at this position — a repeated draw would shift every ' +
            'later value in the shader. Fail closed (D6).'
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
      return `(${ta} - ${tb} * round(${ta} / ${tb}))`;
    }
    // `compile()` emits sub-expressions without outer parentheses, and
    // `*`/`/` bind tighter than `+` — wrap before splicing.
    const ca = `(${compile(a)})`;
    const cb = `(${compile(b)})`;
    return `(${ca} - ${cb} * round(${ca} / ${cb}))`;
  },

  // Reciprocal trigonometric functions (no GPU built-ins)
  Cot: ([x], compile, target) => {
    if (x === null) throw new Error('Cot: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      // The operand is spliced TWICE below, so an IMPURE one must first be
      // bound to a hoisted temporary — compiling it once is not enough, since
      // `_gpu_rnd_draw` advances its counter on every evaluation of the
      // spliced text (see the real branch and `Remainder`).
      if (x.isPure === false) {
        if (!BaseCompiler.canHoist(target))
          throw new Error(
            'Cot: an impure (Random) complex operand cannot be bound to a ' +
              'temporary at this position — a repeated draw would shift ' +
              'every later value in the shader. Fail closed (D6).'
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
          'Cot: an impure (Random) operand cannot be bound to a temporary ' +
            'at this position — a repeated draw would shift every later ' +
            'value in the shader. Fail closed (D6).'
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
    if (x === null) throw new Error('Csc: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csin(${compile(x)}))`;
    }
    return `(1.0 / sin(${compile(x)}))`;
  },
  Sec: ([x], compile, target) => {
    if (x === null) throw new Error('Sec: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_ccos(${compile(x)}))`;
    }
    return `(1.0 / cos(${compile(x)}))`;
  },

  // Inverse trigonometric (reciprocal)
  Arccot: ([x], compile) => {
    if (x === null) throw new Error('Arccot: no argument');
    // `atan(1/x)` returns the wrong branch for x < 0. `π/2 - atan(x)` is
    // branch-free and matches the interpreter's (0, π) range for all real x.
    return `(1.5707963267948966 - atan(${compile(x)}))`;
  },
  Arccsc: ([x], compile, target) => {
    if (x === null) throw new Error('Arccsc: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arccsc', [x])
    )
      return gpuReciprocalComplex('_gpu_casin', x, compile, target);
    return `asin(1.0 / (${compile(x)}))`;
  },
  Arcsec: ([x], compile, target) => {
    if (x === null) throw new Error('Arcsec: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcsec', [x])
    )
      return gpuReciprocalComplex('_gpu_cacos', x, compile, target);
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
    if (x === null) throw new Error('Coth: no argument');
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
    if (x === null) throw new Error('Csch: no argument');
    if (BaseCompiler.isComplexValued(x)) {
      const v2 = gpuVec2(target);
      return `_gpu_cdiv(${v2}(1.0, 0.0), _gpu_csinh(${compile(x)}))`;
    }
    return `(1.0 / sinh(${compile(x)}))`;
  },
  Sech: ([x], compile, target) => {
    if (x === null) throw new Error('Sech: no argument');
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
    if (x === null) throw new Error('Arcoth: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arcoth', [x])
    )
      return gpuReciprocalComplex('_gpu_catanh', x, compile, target);
    return `atanh(1.0 / (${compile(x)}))`;
  },
  Arcsch: ([x], compile) => {
    if (x === null) throw new Error('Arcsch: no argument');
    return `asinh(1.0 / (${compile(x)}))`;
  },
  Arsech: ([x], compile, target) => {
    if (x === null) throw new Error('Arsech: no argument');
    if (
      BaseCompiler.isComplexValued(x) ||
      gpuResultIsComplexValued('Arsech', [x])
    )
      return gpuReciprocalComplex('_gpu_cacosh', x, compile, target);
    return `acosh(1.0 / (${compile(x)}))`;
  },

  // Trigonometric (additional)
  Arctan2: (args, compile) => {
    if (args.length < 2) throw new Error('Arctan2: need two arguments');
    return `atan(${compile(args[0])}, ${compile(args[1])})`;
  },
  Hypot: ([x, y], compile) => {
    if (x === null || y === null) throw new Error('Hypot: need two arguments');
    return `length(vec2(${compile(x)}, ${compile(y)}))`;
  },
  Haversine: ([x], compile) => {
    if (x === null) throw new Error('Haversine: no argument');
    return `((1.0 - cos(${compile(x)})) * 0.5)`;
  },
  InverseHaversine: ([x], compile) => {
    if (x === null) throw new Error('InverseHaversine: no argument');
    return `(2.0 * asin(sqrt(${compile(x)})))`;
  },

  // Special functions
  Gamma: (args, compile, target) => {
    const x = args[0];
    if (!x) throw new Error('Gamma: no argument');
    // The TWO-operand form is the upper incomplete gamma
    // `Γ(s, z) = ∫_z^∞ tˢ⁻¹e⁻ᵗ dt` (the signature is `(number, number?)`) — a
    // different function from `Γ(z)`, not a variant of it: `Γ(5, 2)` is
    // 22.736…, `Γ(5)` is 24. `_gpu_gamma` is the COMPLETE Γ, so consuming
    // only the first operand reported success on a shader computing the wrong
    // value. There is no shader builtin for the incomplete form and no
    // preamble helper for it, so it fails closed (D6).
    if (args.length > 1)
      throw new Error(
        `Gamma: the two-operand form is the upper incomplete gamma Γ(s, z), ` +
          `which has no ${target.language ?? 'GPU'} lowering ` +
          `(\`_gpu_gamma\` is the COMPLETE Γ). Fail closed (D6).`
      );
    return `_gpu_gamma(${compile(x)})`;
  },
  GammaLn: ([x], compile) => {
    if (x === null) throw new Error('GammaLn: no argument');
    return `_gpu_gammaln(${compile(x)})`;
  },
  Factorial: ([x], compile) => {
    if (x === null) throw new Error('Factorial: no argument');
    return `_gpu_gamma(${compile(x)} + 1.0)`;
  },
  Beta: ([a, b], compile, target) => {
    if (a === null || b === null) throw new Error('Beta: need two arguments');
    // Each operand is spliced twice — an impure one is bound to a hoisted
    // temporary (see `gpuOperandOnce`).
    const ca = gpuOperandOnce('Beta', a, compile, target);
    const cb = gpuOperandOnce('Beta', b, compile, target);
    return `(_gpu_gamma(${ca}) * _gpu_gamma(${cb}) / _gpu_gamma(${ca} + ${cb}))`;
  },
  Erf: ([x], compile) => {
    if (x === null) throw new Error('Erf: no argument');
    return `_gpu_erf(${compile(x)})`;
  },
  Binomial: gpuBinomial,
  // `Choose(n, k)` is the binomial coefficient — same lowering (the two heads
  // share `evaluateBinomial` in the interpreter, so they must agree here too).
  Choose: gpuBinomial,
  Erfc: ([x], compile) => {
    if (x === null) throw new Error('Erfc: no argument');
    return `(1.0 - _gpu_erf(${compile(x)}))`;
  },
  ErfInv: ([x], compile) => {
    if (x === null) throw new Error('ErfInv: no argument');
    return `_gpu_erfinv(${compile(x)})`;
  },
  Heaviside: ([x], compile) => {
    if (x === null) throw new Error('Heaviside: no argument');
    return `_gpu_heaviside(${compile(x)})`;
  },
  Sinc: ([x], compile) => {
    if (x === null) throw new Error('Sinc: no argument');
    return `_gpu_sinc(${compile(x)})`;
  },
  FresnelC: ([x], compile) => {
    if (x === null) throw new Error('FresnelC: no argument');
    return `_gpu_fresnelC(${compile(x)})`;
  },
  FresnelS: ([x], compile) => {
    if (x === null) throw new Error('FresnelS: no argument');
    return `_gpu_fresnelS(${compile(x)})`;
  },
  BesselJ: ([n, x], compile, target) => {
    if (n === null || x === null)
      throw new Error('BesselJ: need two arguments');
    const intCast = target?.language === 'wgsl' ? 'i32' : 'int';
    return `_gpu_besselJ(${intCast}(${compile(n)}), ${compile(x)})`;
  },

  // Additional math functions
  Lb: 'log2',
  Log: (args, compile, target) => {
    if (args.length === 0) throw new Error('Log: no argument');
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
    return `(log(${compile(args[0])}) / log(${compile(args[1])}))`;
  },
  Log10: ([x], compile) => {
    if (x === null) throw new Error('Log10: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Lg: ([x], compile) => {
    if (x === null) throw new Error('Lg: no argument');
    return `(log(${compile(x)}) * 0.4342944819032518)`;
  },
  Square: ([x], compile) => {
    if (x === null) throw new Error('Square: no argument');
    if (isSymbol(x) || isNumber(x)) {
      const arg = compile(x);
      return `(${arg} * ${arg})`;
    }
    // Compound base: `pow(x, 2.0)` is NaN for x < 0 on a real GPU (log2 of a
    // negative). Route through the sign-preserving helper, which also evaluates
    // the base subexpression once instead of duplicating it. A `vecN` base
    // takes the componentwise overload of that helper (`_gpu_powi3`); the
    // scalar one is declared with `float`/`f32` parameters and has no vector
    // reading.
    const width = gpuOperandShape(x);
    return `_gpu_powi${typeof width === 'number' ? width : ''}(${compile(x)}, 2.0)`;
  },
  Root: ([x, n], compile, target) => {
    if (x === null) throw new Error('Root: no argument');
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
    return `pow(${compile(x)}, 1.0 / ${compile(n)})`;
  },

  // Color functions (pure-math, GPU-compilable)
  ColorMix: (args, compile) => {
    if (args.length < 2) throw new Error('ColorMix: need two colors');
    const c1 = compile(args[0]);
    const c2 = compile(args[1]);
    const ratio = args.length >= 3 ? compile(args[2]) : '0.5';
    return `_gpu_color_mix(${c1}, ${c2}, ${ratio})`;
  },
  ColorContrast: ([bg, fg], compile) => {
    if (bg === null || fg === null)
      throw new Error('ColorContrast: need two colors');
    return `_gpu_apca(${compile(bg)}, ${compile(fg)})`;
  },
  ContrastingColor: (args, compile, target) => {
    if (args.length === 0) throw new Error('ContrastingColor: no argument');
    const bg = compile(args[0]);
    // WGSL has no ternary operator: the selection must be spelled `select`.
    // GLSL keeps the EXACT `?:` text it has always emitted (pinned).
    // `select` evaluates BOTH arms eagerly, unlike `?:` — sound here because
    // every operand of this head is pure (an impure one declines below, and in
    // the 1-argument form both arms are literal `vec3` constants).
    const pick = (cond: string, whenTrue: string, whenFalse: string): string =>
      target?.language === 'wgsl'
        ? `select(${whenFalse}, ${whenTrue}, ${cond})`
        : `(${cond} ? ${whenTrue} : ${whenFalse})`;
    if (args.length >= 3) {
      // Each of the three operands is spliced TWICE by the comparison below.
      // A color operand is `vec3`-shaped, so there is no scalar (or `vec2`)
      // temporary to bind it to — an impure (Random-family) operand would be
      // re-drawn, and `_gpu_rnd_draw` advances a runtime counter, so the two
      // splices compare DIFFERENT colors and every later draw in the shader
      // shifts. No safe reading — decline (the `gpuOperandOnce` rule for a
      // non-scalar operand).
      if (args.slice(0, 3).some((a) => a.isPure === false))
        throw new Error(
          `ContrastingColor: an impure (Random) operand cannot be bound to a ` +
            `temporary at this position — a repeated draw would shift every ` +
            `later value in the shader. Fail closed (D6).`
        );
      const fg1 = compile(args[1]);
      const fg2 = compile(args[2]);
      return pick(
        `abs(_gpu_apca(${bg}, ${fg1})) >= abs(_gpu_apca(${bg}, ${fg2}))`,
        fg1,
        fg2
      );
    }
    // Default: pick black or white in OKLCh. Black is vec3(0); white is L=1
    // achromatic — vec3(1.0, 0.0, 0.0). Heuristic from the JS path: low-luma
    // backgrounds get white text and vice versa.
    const isWGSL = target?.language === 'wgsl';
    const v3 = isWGSL ? 'vec3f' : 'vec3';
    const black = `${v3}(0.0)`;
    const white = `${v3}(1.0, 0.0, 0.0)`;
    return pick(`(_gpu_apca(${bg}, ${black}) > 50.0)`, black, white);
  },
  ColorToColorspace: ([color, space], compile) => {
    if (color === null || space === null)
      throw new Error('ColorToColorspace: need color and space');
    // The input color is canonical OKLCh; route to the requested space.
    // The space arg must be a string literal so we can pick the helper
    // at compile time (no runtime branching in shader code).
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorToColorspace: space must be a string literal');
    const c = compile(color);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklch_to_oklab(${c})`;
      case 'rgb':
        return `_gpu_oklch_to_srgb(${c})`;
      case 'hsl':
        return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${c}))`;
      case 'hsv':
        return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${c}))`;
      default:
        throw new Error(
          `ColorToColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
  },
  ColorFromColorspace: ([components, space], compile) => {
    if (components === null || space === null)
      throw new Error('ColorFromColorspace: need components and space');
    // Components are in the named space; build a canonical OKLCh value.
    const spaceName = readStringLiteral(space);
    if (spaceName === null)
      throw new Error('ColorFromColorspace: space must be a string literal');
    // A 4-component tuple carries alpha. Same fail-closed policy as the typed
    // color heads: the `_gpu_*` chain is `vec3` end to end, so a `vec4` here
    // would either not type-check or silently drop the alpha downstream.
    if (
      isFunction(components) &&
      (components.operator === 'Tuple' || components.operator === 'List')
    )
      assertNoGPUAlpha('ColorFromColorspace', components.ops);
    const c = compile(components);
    switch (spaceName) {
      case 'oklch':
        return c;
      case 'oklab':
      case 'lab':
        return `_gpu_oklab_to_oklch(${c})`;
      case 'rgb':
        return `_gpu_srgb_to_oklch(${c})`;
      case 'hsl':
        return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${c}))`;
      case 'hsv':
        return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${c}))`;
      default:
        throw new Error(
          `ColorFromColorspace: unsupported space "${spaceName}" on GPU target`
        );
    }
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
    if (s === null) throw new Error('Color: no argument');
    const str = readStringLiteral(s);
    if (str === null)
      throw new Error('Color: argument must be a string literal on GPU target');
    const packed = parseColor(str);
    if (packed === 0 && str.trim().toLowerCase() !== 'transparent')
      throw new Error(`Color: invalid color string "${str}"`);
    // `parseColor()` returns 0xrrggbbaa. Only the RGB is lowered below, so a
    // literal carrying a non-opaque alpha would silently become opaque.
    // Decline instead, matching `assertNoGPUAlpha`.
    if ((packed & 0xff) !== 0xff)
      throw new Error(
        `Color: the color string "${str}" carries an alpha channel, which is ` +
          `not representable on the GPU target — color values are \`vec3\` ` +
          `(OKLCh) end to end, with no alpha channel. Use a fully opaque ` +
          `color and pass the alpha separately (e.g. as a uniform) at the ` +
          `framebuffer boundary. Fail closed (D6).`
      );
    const r = (packed >>> 24) & 0xff;
    const g = (packed >>> 16) & 0xff;
    const b = (packed >>> 8) & 0xff;
    const oklch = rgbToOklch({ r, g, b });
    return `${gpuVec3(target)}(${formatFloat(oklch.L)}, ${formatFloat(oklch.C)}, ${formatFloat(oklch.H)})`;
  },

  Rgb: (args, compile, target) => {
    if (args.length < 3) throw new Error('Rgb: need 3 components');
    assertNoGPUAlpha('Rgb', args);
    const v3 = gpuVec3(target);
    // Channels are 0-1 sRGB — no scaling needed.
    return `_gpu_srgb_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Hsv: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsv: need 3 components');
    assertNoGPUAlpha('Hsv', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsv_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Hsl: (args, compile, target) => {
    if (args.length < 3) throw new Error('Hsl: need 3 components');
    assertNoGPUAlpha('Hsl', args);
    const v3 = gpuVec3(target);
    return `_gpu_srgb_to_oklch(_gpu_hsl_to_rgb(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})))`;
  },

  Oklab: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklab: need 3 components');
    assertNoGPUAlpha('Oklab', args);
    const v3 = gpuVec3(target);
    return `_gpu_oklab_to_oklch(${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])}))`;
  },

  Oklch: (args, compile, target) => {
    if (args.length < 3) throw new Error('Oklch: need 3 components');
    assertNoGPUAlpha('Oklch', args);
    // Already in canonical form — no conversion needed.
    const v3 = gpuVec3(target);
    return `${v3}(${compile(args[0])}, ${compile(args[1])}, ${compile(args[2])})`;
  },

  // ---------------------------------------------------------------------------
  // As* operators. AsOklch is identity (canonical). The other As* return
  // components in the named space, equivalent to ColorToColorspace(c, 'x').
  // ---------------------------------------------------------------------------

  AsOklch: ([c], compile) => {
    if (c === null) throw new Error('AsOklch: no argument');
    return compile(c);
  },

  AsOklab: ([c], compile) => {
    if (c === null) throw new Error('AsOklab: no argument');
    return `_gpu_oklch_to_oklab(${compile(c)})`;
  },

  AsRgb: ([c], compile) => {
    if (c === null) throw new Error('AsRgb: no argument');
    return `_gpu_oklch_to_srgb(${compile(c)})`;
  },

  AsHsv: ([c], compile) => {
    if (c === null) throw new Error('AsHsv: no argument');
    return `_gpu_rgb_to_hsv(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  AsHsl: ([c], compile) => {
    if (c === null) throw new Error('AsHsl: no argument');
    return `_gpu_rgb_to_hsl(_gpu_oklch_to_srgb(${compile(c)}))`;
  },

  // Fractal functions
  Mandelbrot: ([c, maxIter], compile, target) => {
    if (c === null || maxIter === null)
      throw new Error('Mandelbrot: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_mandelbrot(${compile(c)}, ${iterCode})`;
  },
  Julia: ([z, c, maxIter], compile, target) => {
    if (z === null || c === null || maxIter === null)
      throw new Error('Julia: missing arguments');
    const iterCode = compileIntArg(maxIter, compile, target);
    return `_fractal_julia(${compile(z)}, ${compile(c)}, ${iterCode})`;
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
  // and fail closed (D6) for arity ≥ 5 or a norm-type argument rather than
  // reporting success on invalid shader source.
  Norm: (args, compile, target) => {
    if (args.length > 1)
      throw new Error(
        `Norm: only the default L2 norm compiles on the ` +
          `${target.language ?? 'GPU'} target. Fail closed (D6).`
      );
    const arg = args[0];
    if (isFunction(arg, 'Tuple') || isFunction(arg, 'List')) {
      // A broadcasting component means one norm per zipped element — not a
      // scalar. Fail closed (D6).
      if (pointHasBroadcastComponent(arg))
        throw new Error(
          'Norm: cannot compile a point with a broadcasting component. ' +
            'Fail closed (D6).'
        );
      const n = arg.nops;
      if (n === 0 || n > 4)
        throw new Error(
          `Norm: the ${target.language ?? 'GPU'} 'length()' builtin only ` +
            `accepts 2-4 component vectors (got ${n}). Fail closed (D6).`
        );
      if (n === 1) return `abs(${compile(arg.op1)})`;
      return `length(${compile(arg)})`;
    }
    // Non-literal operand (e.g. a vec-typed symbol): `length()` applies.
    return `length(${compile(arg)})`;
  },
  Length: (_args, _compile, target) => {
    throw new Error(
      `Length (collection element count) is not supported on the ` +
        `${target.language ?? 'GPU'} target: the '${target.language ?? 'GPU'}' ` +
        `'length()' builtin is the Euclidean norm (CE 'Norm'), not a count. ` +
        `Fail closed (D6).`
    );
  },
  Normalize: 'normalize',
  Reflect: 'reflect',
  Refract: 'refract',

  // Sum/Product — unrolled or for-loop
  Sum: (args, compile, target) =>
    compileGPUSumProduct('Sum', args, compile, target),
  Product: (args, compile, target) =>
    compileGPUSumProduct('Product', args, compile, target),

  // Range — inline constant array literal (bounds must be compile-time constants)
  Range: (args, _compile, target) => {
    if (args.length < 2 || args.length > 3) {
      throw new Error(
        'Range: GPU compile expects 2 or 3 arguments (lo, hi, step?)'
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
        'Range: GPU compile requires constant numeric bounds' +
          ' (non-constant ranges must be materialized at JS host then uploaded as a uniform)'
      );
    }
    if (step === 0) throw new Error('Range: step cannot be zero');
    const count = Math.max(0, Math.floor((hi - lo) / step) + 1);
    if (count === 0) {
      throw new Error(
        'Range: empty range (lo > hi for positive step, or lo < hi for negative step)'
      );
    }
    if (count > GPU_MAX_INLINE_ELEMENTS) {
      throw new Error(
        `Range: GPU compile inlines ranges up to ${GPU_MAX_INLINE_ELEMENTS} elements (got ${count})`
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
    if (!args[0]) throw new Error('Loop: no body');
    if (!args[1]) throw new Error('Loop: no indexing set');

    const indexing = args[1];
    if (!isFunction(indexing, 'Element'))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');

    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (!isFunction(rangeExpr, 'Range'))
      throw new Error('Loop: expected Range(lo, hi)');

    const index = indexExpr.symbol;
    // The loop index is declared and referenced bare — reject a reserved name.
    gpuCheckIdentifier(index, target.language);
    const lower = Math.floor(rangeExpr.ops[0].re);
    const upper = Math.floor(rangeExpr.ops[1].re);

    if (!Number.isFinite(lower) || !Number.isFinite(upper))
      throw new Error('Loop: bounds must be finite numbers');

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
    return `for (${indexDecl} = ${lower}; ${index} <= ${upper}; ${index}++) {\n  ${bodyCode};\n}`;
  },

  // Statistical functions

  /**
   * GCD of two scalar arguments.
   *
   * Uses a preamble helper `_gpu_gcd` (Euclidean algorithm via `mod`).
   * Only two-argument form is supported in GPU targets.
   */
  GCD: (args, compile) => {
    if (args.length < 2) throw new Error('GCD: need at least two arguments');
    if (args.length > 2)
      throw new Error('GCD: GPU target supports only two-argument GCD');
    const a = args[0];
    const b = args[1];
    if (a === null || b === null) throw new Error('GCD: missing argument');
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
        'Variance: GPU target requires a List argument or at least 2 scalar arguments'
      );
    }
    const n = elems.length;
    if (n < 2) throw new Error('Variance: need at least 2 elements');
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
        'Median: GPU target requires a List argument or at least 1 scalar argument'
      );
    }
    const n = elems.length;
    if (n === 0) throw new Error('Median: empty list');
    if (n > 8) {
      throw new Error(
        `Median: GPU target supports up to 8 elements via inline sorting network (got ${n}). ` +
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
   */
  Random: (args, compile, target) => {
    if (args.length === 0) return gpuRandomDraw(target);
    if (args.length === 1) return gpuRandomDomainDraw(args[0], compile, target);
    throw new Error(
      'Random: expects at most one operand, the DOMAIN to draw from ' +
        '(`Random()`, `Random(Interval(a, b))`, `Random(Range(…))`). The ' +
        'seed argument was removed by the Random family redesign — seed with ' +
        '`WithRandomSeed(seed, body)`.'
    );
  },

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
        'WithRandomSeed(seed, body): expects exactly two operands'
      );
    const state = gpuRandomState(target);
    // The seed is folded ONCE per frame, before the body is compiled.
    const seed = gpuFoldSeedSource(args[0], compile, target);
    const counter = allocGPURandomCounter(state);
    state.frames.push({ seed, counter });
    try {
      return compile(args[1]);
    } finally {
      state.frames.pop();
    }
  },

  // The multi-draw members of the family need general collection indexing (or
  // a mutable permutation buffer), which a shader expression has no way to
  // express. Fail closed (D6) with the reason rather than let them fall
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

  // Function (lambda) — not supported in GPU
  Function: () => {
    throw new Error(
      'Anonymous functions (Function) are not supported in GPU targets'
    );
  },
};

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
      'Random(): an unframed draw cannot be compiled to a shader while a host ' +
        '`WithRandomSeed` frame is active — a shader invocation cannot share ' +
        "the host's mutable draw counter, and fragments run in parallel. GPU " +
        'frames must be LEXICAL: move the `WithRandomSeed(seed, …)` inside the ' +
        'compiled expression. Fail closed (D6).'
    );

  if (language === 'wgsl')
    throw new Error(
      'Random(): an unframed draw cannot be compiled to WGSL — a shader has no ' +
        'live random stream, and WGSL has no `gl_FragCoord` built-in to derive ' +
        'spatial noise from. Wrap the draw in `WithRandomSeed(seed, …)`, whose ' +
        'seed may be an invocation-varying expression. Fail closed (D6).'
    );

  // `gl_FragCoord` exists only in a fragment shader. A vertex (or other) stage
  // fails at CE compile time rather than emitting code that fails later, at
  // GPU shader-compile time. An UNKNOWN stage keeps the historical
  // fragment-shader assumption of the `compile()` entry points.
  if (state.stage !== undefined && state.stage !== 'fragment')
    throw new Error(
      `Random(): an unframed draw compiles to \`gl_FragCoord\`-derived spatial ` +
        `noise, which exists only in a fragment shader (this is a ` +
        `\`${state.stage}\` shader). Wrap the draw in ` +
        `\`WithRandomSeed(seed, …)\` to get a stage-independent stream. ` +
        `Fail closed (D6).`
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
    `closed-form domains. Fail closed (D6).`
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
    // Fail closed (D6).
    for (const [role, endpoint] of [
      ['lower', loExpr],
      ['upper', hiExpr],
    ] as const)
      if (!endpoint.canonical.isPure)
        throw new Error(
          `Random(Interval(a, b)): the ${role} endpoint is not pure — a ` +
            `shader expression has no statement to evaluate it into once, so ` +
            `the endpoint is spliced (and would run) more than once per ` +
            `draw. Hoist the draw out of the endpoint. Fail closed (D6).`
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
    const n = domain.count;
    if (n === undefined || !Number.isFinite(n))
      throw new Error(
        'Random(Range(…)): the GPU target requires a Range with constant, ' +
          'finite bounds — a symbolic or unbounded range has no known element ' +
          'count to draw from. Fail closed (D6).'
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
      'WithRandomSeed(seed, …): a string seed that is not a compile-time ' +
        'literal cannot be folded in a shader — GLSL and WGSL have no ' +
        'strings. Use a literal string, a numeric seed, or fold the seed on ' +
        'the host. Fail closed (D6).'
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
      'WithRandomSeed(seed, …): the seed expression is not pure — the folded ' +
        'seed is spliced at EVERY draw site of the frame, so it would be ' +
        'evaluated once per draw. Use a compile-time constant or a single ' +
        'shader-supplied symbol. Fail closed (D6).'
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
      'WithRandomSeed(seed, …): a COMPUTED seed expression cannot be ' +
        'compiled to a shader — the folded seed is spliced at every draw ' +
        'site of the frame, so it would be recomputed per draw. Use a ' +
        'compile-time constant seed (host-identical stream) or a single ' +
        'shader-supplied symbol (its own stream). Fail closed (D6).'
    );

  const mapped = target.var(symbol);
  if (mapped !== undefined) {
    if (gpuRandomState(target).varNames?.has(symbol))
      throw new Error(
        `WithRandomSeed(${symbol}, …): a seed supplied through \`vars\` ` +
          `(\`${symbol}\` → \`${mapped}\`) is the HOST-UNIFORM row of the ` +
          `seed ABI, which is not implemented: the host folds an f64 seed ` +
          `with \`foldSeed\` into TWO words, while a shader can only ` +
          `reinterpret the f32 bits it receives (\`seedHi = 0u\`), so the ` +
          `shader would silently draw a DIFFERENT stream than the host. Use ` +
          `either a compile-time literal seed — the host-identical stream — ` +
          `or an explicitly invocation-varying seed symbol that is NOT in ` +
          `\`vars\`, which owns its own stream. Fail closed (D6).`
      );
    throw new Error(
      `WithRandomSeed(${symbol}, …): the seed resolves to the shader ` +
        `constant \`${mapped}\`, which the seed ABI cannot fold. Use a ` +
        `compile-time numeric or string seed. Fail closed (D6).`
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
  if (z <= 0.0 && z == floor(z) && z > -3.0e38) return _gpu_inf();
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
  // infinity, which is +Infinity (pole-encoding ruling 2026-08-28). WGSL has
  // no helper for it, so the +Infinity bit pattern is spelled inline, as
  // non-finite constants are everywhere else in this target. The lower
  // bound keeps -Infinity out of the guard (it is not a pole). (No
  // backticks in this comment: it lives inside a TypeScript template
  // literal, which one would terminate.)
  if (z <= 0.0 && z == floor(z) && z > -3.0e38) { return bitcast<f32>(0x7f800000u); }
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
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
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
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
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
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
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
      1.04314589657571990585e-7, 4.60680728515232032307e-10,
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
 * wrap the final color in `_gpu_oklch_to_srgb()` at the boundary.
 *
 * Hue is in degrees throughout (matching the boxed-expression convention);
 * HSL/HSV saturation, lightness and value are in 0-1.
 * `_gpu_color_mix` interpolates directly in OKLCh — no sRGB pinch — and
 * special-cases achromatic endpoints (C ≈ 0) so e.g. mixing red with white
 * preserves red's hue rather than drifting through arbitrary hues.
 *
 * WGSL targets must adapt syntax (vec3f, atan2→atan2, etc.).
 */
export const GPU_COLOR_PREAMBLE_GLSL = `
float _gpu_srgb_to_linear(float c) {
  if (c <= 0.04045) return c / 12.92;
  return pow((c + 0.055) / 1.055, 2.4);
}

float _gpu_linear_to_srgb(float c) {
  if (c <= 0.0031308) return 12.92 * c;
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 _gpu_srgb_to_oklab(vec3 rgb) {
  float r = _gpu_srgb_to_linear(rgb.x);
  float g = _gpu_srgb_to_linear(rgb.y);
  float b = _gpu_srgb_to_linear(rgb.z);
  float l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  float m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  float s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
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
  return clamp(vec3(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), 0.0, 1.0);
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

vec3 _gpu_hsl_to_rgb(vec3 hsl) {
  float h = hsl.x;
  float s = hsl.y;
  float l = hsl.z;
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

vec3 _gpu_rgb_to_hsl(vec3 rgb) {
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
  float h = hsv.x;
  float s = hsv.y;
  float v = hsv.z;
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

vec3 _gpu_rgb_to_hsv(vec3 rgb) {
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

float _gpu_apca(vec3 lch_bg, vec3 lch_fg) {
  vec3 bg = _gpu_oklch_to_srgb(lch_bg);
  vec3 fg = _gpu_oklch_to_srgb(lch_fg);
  float bgR = _gpu_srgb_to_linear(bg.x);
  float bgG = _gpu_srgb_to_linear(bg.y);
  float bgB = _gpu_srgb_to_linear(bg.z);
  float fgR = _gpu_srgb_to_linear(fg.x);
  float fgG = _gpu_srgb_to_linear(fg.y);
  float fgB = _gpu_srgb_to_linear(fg.z);
  float bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  float fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  float bgC = pow(bgY, 0.56);
  float fgC = pow(fgY, 0.57);
  float contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

/**
 * GPU color space conversion preamble (WGSL syntax).
 *
 * Same convention as the GLSL preamble: canonical color value is `vec3f`
 * OKLCh `(L, C, H_deg)`. Shaders writing to a sRGB framebuffer must wrap
 * their final color in `_gpu_oklch_to_srgb()`.
 */
export const GPU_COLOR_PREAMBLE_WGSL = `
fn _gpu_srgb_to_linear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn _gpu_linear_to_srgb(c: f32) -> f32 {
  if (c <= 0.0031308) { return 12.92 * c; }
  return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

fn _gpu_srgb_to_oklab(rgb: vec3f) -> vec3f {
  let r = _gpu_srgb_to_linear(rgb.x);
  let g = _gpu_srgb_to_linear(rgb.y);
  let b = _gpu_srgb_to_linear(rgb.z);
  let l_ = pow(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 1.0 / 3.0);
  let m_ = pow(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 1.0 / 3.0);
  let s_ = pow(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b, 1.0 / 3.0);
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
  return clamp(vec3f(_gpu_linear_to_srgb(r), _gpu_linear_to_srgb(g), _gpu_linear_to_srgb(b)), vec3f(0.0), vec3f(1.0));
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

fn _gpu_hsl_to_rgb(hsl: vec3f) -> vec3f {
  let h = hsl.x;
  let s = hsl.y;
  let l = hsl.z;
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

fn _gpu_rgb_to_hsl(rgb: vec3f) -> vec3f {
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
  let h = hsv.x;
  let s = hsv.y;
  let v = hsv.z;
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

fn _gpu_rgb_to_hsv(rgb: vec3f) -> vec3f {
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

fn _gpu_apca(lch_bg: vec3f, lch_fg: vec3f) -> f32 {
  let bg = _gpu_oklch_to_srgb(lch_bg);
  let fg = _gpu_oklch_to_srgb(lch_fg);
  let bgR = _gpu_srgb_to_linear(bg.x);
  let bgG = _gpu_srgb_to_linear(bg.y);
  let bgB = _gpu_srgb_to_linear(bg.z);
  let fgR = _gpu_srgb_to_linear(fg.x);
  let fgG = _gpu_srgb_to_linear(fg.y);
  let fgB = _gpu_srgb_to_linear(fg.z);
  let bgY = 0.2126729 * bgR + 0.7151522 * bgG + 0.0721750 * bgB;
  let fgY = 0.2126729 * fgR + 0.7151522 * fgG + 0.0721750 * fgB;
  let bgC = pow(bgY, 0.56);
  let fgC = pow(fgY, 0.57);
  let contrast = (bgC - fgC) * 1.14;
  return contrast * 100.0;
}
`;

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
  _gpu_cpow: {
    deps: ['_gpu_cexp', '_gpu_cmul', '_gpu_cln'],
    glsl: `vec2 _gpu_cpow(vec2 z, vec2 w) {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
}`,
    wgsl: `fn _gpu_cpow(z: vec2f, w: vec2f) -> vec2f {
  return _gpu_cexp(_gpu_cmul(w, _gpu_cln(z)));
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
  _gpu_casin: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casin(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 s = _gpu_csqrt(vec2(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  vec2 l = _gpu_cln(iz + s);
  return vec2(l.y, -l.x);
}`,
    wgsl: `fn _gpu_casin(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let s = _gpu_csqrt(vec2f(1.0 - z.x * z.x + z.y * z.y, -2.0 * z.x * z.y));
  let l = _gpu_cln(iz + s);
  return vec2f(l.y, -l.x);
}`,
  },
  _gpu_cacos: {
    deps: ['_gpu_casin'],
    glsl: `vec2 _gpu_cacos(vec2 z) {
  vec2 s = _gpu_casin(z);
  return vec2(1.5707963268 - s.x, -s.y);
}`,
    wgsl: `fn _gpu_cacos(z: vec2f) -> vec2f {
  let s = _gpu_casin(z);
  return vec2f(1.5707963268 - s.x, -s.y);
}`,
  },
  _gpu_catan: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catan(vec2 z) {
  vec2 iz = vec2(-z.y, z.x);
  vec2 a = _gpu_cln(vec2(1.0 - iz.x, -iz.y));
  vec2 b = _gpu_cln(vec2(1.0 + iz.x, iz.y));
  vec2 d = vec2(a.x - b.x, a.y - b.y);
  return vec2(-0.5 * d.y, 0.5 * d.x);
}`,
    wgsl: `fn _gpu_catan(z: vec2f) -> vec2f {
  let iz = vec2f(-z.y, z.x);
  let a = _gpu_cln(vec2f(1.0 - iz.x, -iz.y));
  let b = _gpu_cln(vec2f(1.0 + iz.x, iz.y));
  let d = vec2f(a.x - b.x, a.y - b.y);
  return vec2f(-0.5 * d.y, 0.5 * d.x);
}`,
  },
  _gpu_casinh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_casinh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_casinh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(1.0 + z2.x, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_cacosh: {
    deps: ['_gpu_csqrt', '_gpu_cln'],
    glsl: `vec2 _gpu_cacosh(vec2 z) {
  vec2 z2 = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  vec2 s = _gpu_csqrt(vec2(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
    wgsl: `fn _gpu_cacosh(z: vec2f) -> vec2f {
  let z2 = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y);
  let s = _gpu_csqrt(vec2f(z2.x - 1.0, z2.y));
  return _gpu_cln(z + s);
}`,
  },
  _gpu_catanh: {
    deps: ['_gpu_cln'],
    glsl: `vec2 _gpu_catanh(vec2 z) {
  vec2 a = _gpu_cln(vec2(1.0 + z.x, z.y));
  vec2 b = _gpu_cln(vec2(1.0 - z.x, -z.y));
  return vec2(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
}`,
    wgsl: `fn _gpu_catanh(z: vec2f) -> vec2f {
  let a = _gpu_cln(vec2f(1.0 + z.x, z.y));
  let b = _gpu_cln(vec2f(1.0 - z.x, -z.y));
  return vec2f(0.5 * (a.x - b.x), 0.5 * (a.y - b.y));
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
 * Sign-preserving integer power (GLSL syntax). GLSL `pow(x, n)` is
 * `exp2(n·log2(x))`, undefined for a negative base — it returns `+8` for
 * `pow(-2.0, 3.0)` (wrong sign) and NaN for even powers of a negative. Compute
 * the magnitude from `abs(x)` and restore the sign for odd exponents. `n` is a
 * non-negative integer value; matches JS `Math.pow` for integer exponents
 * (including `0^0 = 1`).
 */
export const GPU_POWI_PREAMBLE_GLSL = `
float _gpu_powi(float x, float n) {
  if (n == 0.0) return 1.0;
  float r = pow(abs(x), n);
  if (x < 0.0 && mod(n, 2.0) == 1.0) return -r;
  return r;
}
`;

/**
 * Sign-preserving integer power (WGSL syntax). See GPU_POWI_PREAMBLE_GLSL.
 */
export const GPU_POWI_PREAMBLE_WGSL = `
fn _gpu_powi(x: f32, n: f32) -> f32 {
  if (n == 0.0) { return 1.0; }
  let r = pow(abs(x), n);
  if (x < 0.0 && (n % 2.0) == 1.0) { return -r; }
  return r;
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
 * a SCALAR (it is a compile-time integer literal at every call site), so both
 * `if` conditions remain the scalar `bool` a shader requires.
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
  let r = pow(abs(x), ${v}(n));
  if ((n % 2.0) == 1.0) { return sign(x) * r; }
  return r;
}
`;
  return `
${v} _gpu_powi${n}(${v} x, float n) {
  if (n == 0.0) return ${v}(1.0);
  ${v} r = pow(abs(x), ${v}(n));
  if (mod(n, 2.0) == 1.0) return sign(x) * r;
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
 * MAKE the value from a bit pattern — which is what the masked-branch NaN
 * already does (`gpuNaN`). A `NaN` / `±∞` constant therefore routes through the
 * same `gpuNonFiniteLiteral` symbols instead of failing the compilation, which
 * is why this formatter needs to know the language.
 */
export function formatGPUNumber(n: number, language?: string): string {
  if (!Number.isFinite(n)) return gpuNonFiniteLiteral(n, language);
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
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
 * Static component count of a declared aggregate type, if it has one — and
 * only when every component fits a `vecN` slot (`gpuIsVectorComponentType`),
 * so a heterogeneous or non-numeric aggregate answers `undefined` and its
 * caller fails closed (D6).
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

/** The synthesized signature of an emitted user-function definition. */
type GPUUserFunctionSignature = {
  /** Formal parameter names, for diagnostics. */
  names: ReadonlyArray<string>;
  /** Shader type of each parameter, in order. */
  params: ReadonlyArray<string>;
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
      // A shader value has ONE static shape (`float` or `vec2`), decided by
      // type analysis — the strict discipline IS this target's model, and the
      // only mode it offers (`CompileMode`). A requested `'complex'`/`'auto'`
      // is the `unsupported-mode` decline.
      supportedModes: GPU_SUPPORTED_MODES,
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
      // A shader has no expression-level loop or IIFE, so the multi-statement
      // block forms (loop-form Sum/Product, Loop, Block) are only valid at
      // statement position. Flag it so the base compiler fails closed (D6)
      // rather than splice a bare block into a sub-expression. Gated to the pure
      // GPU languages by language id.
      bareStatementBlocks:
        this.languageId === 'glsl' || this.languageId === 'wgsl',
      // A free symbol emitted as a bare identifier must not be a reserved word
      // of the shader language, or the generated shader fails to compile. Fail
      // closed (D6) with a clear diagnostic naming the offending identifier.
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
      // to the vector operand. Fails closed (D6) on anything with no static
      // vector shape.
      broadcastUnary: (head, operand, lowering) =>
        compileGPUBroadcastUnary(head, operand, lowering),
      // The same defect class on every emission that does NOT go through the
      // fan-out hook (the generic function-codegen and string-helper paths):
      // a collection, matrix or array operand reaching a lowering the shader
      // type system cannot give it to. Fails closed (D6) instead of emitting
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
      // position fails closed (D6) rather than emitting one.
      //
      // GLSL and WGSL have no string type, no character type and no text
      // storage class: there is nothing a quoted literal could be. Declining
      // in this hook covers every position because all string values pass
      // through it.
      string: (str) => {
        throw new Error(
          `A string literal (${JSON.stringify(str)}) is not supported on the ` +
            `${this.languageId} target: the shader languages have no text ` +
            `type — no string, no character, no grapheme-cluster indexing — ` +
            `so there is no value a quoted literal could lower to. ` +
            `Fail closed (D6).`
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
        // there is no `return None` analog either. Fail closed (D6). A Loop in
        // a non-final position is fine (it stays a bare statement).
        if (/^\s*(for|while)\b/.test(stmts[last]))
          throw new Error(
            `${this.languageId.toUpperCase()}: a Loop (or other statement-form ` +
              `construct) cannot be the final statement of a block — a shader ` +
              `block must evaluate to a typed value.`
          );
        stmts[last] = `return ${stmts[last]}`;
        return stmts.join(';\n') + ';';
      },
      // Per-compilation naming state for generated temporaries (the loop
      // accumulator of `compileGPUSumProduct`). Numbered per compilation like
      // the random counters below, and reset alongside them at each
      // compilation boundary (`resetGPURandomNumbering`).
      naming: { counter: 0, usedNames: new Set<string>() },
      ...options,
    };
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
            `The symbol \`${id}\` is text-typed, which is not supported on ` +
              `the ${this.languageId} target: the shader languages have no ` +
              `text type — no string, no character, no grapheme-cluster ` +
              `indexing — so it would be emitted as a bare identifier and ` +
              `declared as a numeric uniform. Fail closed (D6).`
          );
        return inner ? inner(id) : id;
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
  protected userFunctionDefs(): string {
    const defs = this.currentUserFunctions?.defs;
    if (!defs || defs.size === 0) return '';
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

        define: ({ id, name, params, body, literal, target }) => {
          // The generated name is emitted bare; a shader reserved word here
          // would be source no driver accepts (D6).
          gpuCheckIdentifier(name, language);
          // The formal parameters are spliced verbatim into the signature and
          // referenced bare in the body, so they need the same check — the
          // convention the loop indices of `Sum`/`Product`/`Loop` follow.
          // `f(discard) := discard + 1` would otherwise emit
          // `float _fn_f(float discard)` behind a reported success.
          for (const p of params) gpuCheckIdentifier(p, language);

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
          const paramTypes = params.map((p, i) => {
            const declared = BaseCompiler.userFunctionParamType(engine, id, i);
            const own = paramSymbols[i]?.type?.type;
            const t =
              declared === undefined || declared === 'unknown' ? own : declared;
            const shader = gpuTypeOfDeclaredType(t, isWGSL);
            if (shader === undefined)
              throw new Error(
                `${id}: parameter "${p}" has no static ${language.toUpperCase()} ` +
                  `type — only scalars, booleans, complex values and 2–4 ` +
                  `component vectors have one, and a shader function ` +
                  `signature must be fully typed. Declare a narrower ` +
                  `signature for "${id}". Fail closed (D6).`
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
              : (gpuDeclaredComponentCount(t ?? 'unknown') ?? 0);
            complexFrame.set(p, complex);
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
                  `${id}: the return value has no static ` +
                    `${language.toUpperCase()} type — only scalars, booleans, ` +
                    `complex values and 2–4 component vectors have one. Fail ` +
                    `closed (D6).`
                );
              return {
                ret,
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
                code: BaseCompiler.compileFunctionBody(body, {
                  ...target,
                  onReturn: (value) => {
                    const t =
                      value === undefined
                        ? undefined
                        : gpuTypeOfValue(value, isWGSL);
                    if (t === ret) return;
                    throw new Error(
                      `${id}: a \`Return\` in this body yields ` +
                        (t === undefined
                          ? `a value with no static ${language.toUpperCase()} type`
                          : `a "${t}" value`) +
                        `, but "${id}" is declared to return "${ret}" (the ` +
                        `shape of the body's own final value). ` +
                        `${language.toUpperCase()} has no implicit conversion ` +
                        `between them, and a shader function has a single ` +
                        `return type. Make every \`Return\` — and the body's ` +
                        `final value — the same shape. Fail closed (D6).`
                    );
                  },
                }),
              };
            },
            true
          );

          // …and every `Return` that survived that check must also be in a
          // position the language can express. Run on the EMITTED body, after
          // the shape gate above (whose message is the more specific one).
          gpuAssertReturnPlacement(id, code, language);

          signatures.set(name, { names: params, params: paramTypes, ret });
          return declareFn(
            name,
            ret,
            params.map((p, i): [string, string] => [p, paramTypes[i]]),
            code
          );
        },

        call: ({ id, name, args, target }) => {
          const sig = signatures.get(name);
          // `define` always runs before the first `call`
          // (`ensureUserFunctionEmitted`), so this cannot be reached.
          if (sig === undefined)
            throw new Error(`Internal: no synthesized signature for "${id}"`);
          if (args.length !== sig.params.length)
            throw new Error(
              `${id}: called with ${args.length} argument(s) but declared ` +
                `with ${sig.params.length} — a ${language.toUpperCase()} call ` +
                `must match its declaration exactly (there are no optional or ` +
                `variadic parameters). Fail closed (D6).`
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
                `${id}: argument ${i + 1} \`${arg.toString()}\` is declared ` +
                  `"${badDecl.spelling}" by the caller — a type with no ` +
                  `static ${language.toUpperCase()} value shape here (only ` +
                  `scalars, booleans and 2–4 component vectors have one), so ` +
                  `it cannot be matched against parameter "${sig.names[i]}" ` +
                  `(declared "${sig.params[i]}"). Fail closed (D6).`
              );
            // A collection argument beyond the static vec2–vec4 shapes: the
            // JS target answers this with the `_SYS.bcastFn` runtime
            // broadcast dispatch, which a shader has no analog for. Scalar
            // applying it silently would compute a different value.
            if (t === undefined)
              throw new Error(
                `${id}: argument ${i + 1} is a collection with no static ` +
                  `${language.toUpperCase()} shape (only 2–4 component ` +
                  `vectors have one), and a shader has no runtime broadcast ` +
                  `dispatch to apply "${id}" element-wise. Fail closed (D6).`
              );
            if (t !== sig.params[i])
              throw new Error(
                // The argument is named as well as numbered: the mismatch is
                // often between a `compileFunction` parameter the CALLER
                // declared and a callee signature it never saw, and the
                // position alone does not point at either.
                `${id}: argument ${i + 1} \`${arg.toString()}\` lowers to "${t}" but parameter ` +
                  `"${sig.names[i]}" is declared "${sig.params[i]}" — ` +
                  `${language.toUpperCase()} has no implicit conversion ` +
                  `between them. Declare a matching signature for "${id}". ` +
                  `Fail closed (D6).`
              );
            return BaseCompiler.compileValueOperand(arg, target);
          });
          return `${name}(${code.join(', ')})`;
        },

        value: ({ id }) => {
          throw new Error(
            `${id}: a user-defined function cannot be used as a VALUE on ` +
              `target '${language}' — the shader languages have no function ` +
              `values (no higher-order operands, no function pointers). Call ` +
              `it instead. Fail closed (D6).`
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
    try {
      return this.compileOrThrow(expr, options);
    } catch (e) {
      // Default: throw. With `fallback: true`, return the documented
      // `success: false` shape with an interpreter-backed `run`.
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
    options: CompilationOptions<Expression> = {}
  ): CompilationResult {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
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
      constantFold: options.constantFold,
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
        if (vars && Object.hasOwn(vars, id)) return vars[id] as string;
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
    if (vars) gpuRandomState(target).varNames = new Set(Object.keys(vars));

    // A statement position: the emitted `code` is a function body, so a
    // loop-form `Sum`/`Product` nested anywhere inside may hoist its loop ahead
    // of the value (Tycho item 110). With nothing hoisted this is byte-identical
    // to a plain `compile()`.
    const code = BaseCompiler.compileFunctionBody(expr, target);
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
    const userDefs = this.userFunctionDefs();
    if (userDefs) code = `${code}\n${userDefs}`;
    let preamble = '';
    preamble += buildComplexPreamble(code, this.languageId);
    // Only GLSL emits `_gpu_nan()` / `_gpu_inf()` (WGSL uses an inline bit
    // pattern); both helpers are built the same way, from the ES 3.00
    // `intBitsToFloat` this target already assumes.
    //
    // The `_gpu_at*` positional-access helpers call `_gpu_nan()` from their
    // BODIES, which these scans never see — they read the EMITTED code, never
    // a helper body — so an `At` lowering FORCES the GLSL NaN helper: a
    // compilation whose code contains only `_gpu_at3(…)` must still get it.
    // WGSL has no `_gpu_nan` at all, so only GLSL is forced.
    const isWGSL = this.languageId === 'wgsl';
    const atWidths = gpuAtHelperWidths(code);
    if (code.includes('_gpu_nan') || (!isWGSL && atWidths.length > 0))
      preamble += GPU_NAN_PREAMBLE_GLSL;
    // `_gpu_gamma` calls `_gpu_inf()` from its BODY at a pole (the float
    // projection of the interpreter's undirected infinity — pole-encoding
    // ruling 2026-08-28), so it forces the GLSL Infinity helper for the same
    // reason `_gpu_at*` forces the NaN helper: these scans read the EMITTED
    // code and never a helper body.
    if (
      code.includes('_gpu_inf') ||
      (!isWGSL && code.includes('_gpu_gamma'))
    )
      preamble += GPU_INF_PREAMBLE_GLSL;
    // AFTER the NaN branches, and that ORDER is load-bearing: GLSL requires a
    // declaration before its use, and these bodies call `_gpu_nan()`. The
    // order test in `at-gpu-compile.test.ts` is the tripwire.
    for (const w of atWidths) preamble += gpuAtPreamble(w, isWGSL);
    // The scalar `_gpu_powi` and its per-width `vecN` overloads
    // (`_gpu_powi2`–`_gpu_powi4`) are declared independently: a compilation
    // that only powers a vector needs the vector form alone.
    for (const form of gpuPowiHelperForms(code))
      preamble +=
        form === 'scalar'
          ? isWGSL
            ? GPU_POWI_PREAMBLE_WGSL
            : GPU_POWI_PREAMBLE_GLSL
          : gpuPowiVecPreamble(form, isWGSL);
    if (code.includes('_gpu_gamma'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GAMMA_PREAMBLE_WGSL
          : GPU_GAMMA_PREAMBLE_GLSL;
    if (code.includes('_gpu_erf'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_ERF_PREAMBLE_WGSL
          : GPU_ERF_PREAMBLE_GLSL;
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
    if (code.includes('_gpu_besselJ'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_BESSELJ_PREAMBLE_WGSL
          : GPU_BESSELJ_PREAMBLE_GLSL;
    if (code.includes('_fractal_')) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_FRACTAL_PREAMBLE_WGSL
          : GPU_FRACTAL_PREAMBLE_GLSL;
    }
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
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_PCG3D_PREAMBLE_WGSL
          : GPU_PCG3D_PREAMBLE_GLSL;
    }
    if (code.includes('_gpu_gcd'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_GCD_PREAMBLE_WGSL
          : GPU_GCD_PREAMBLE_GLSL;
    if (code.includes('_gpu_median_'))
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_MEDIAN_PREAMBLE_WGSL
          : GPU_MEDIAN_PREAMBLE_GLSL;
    if (
      code.includes('_gpu_srgb_to') ||
      code.includes('_gpu_oklab') ||
      code.includes('_gpu_oklch') ||
      code.includes('_gpu_color_mix') ||
      code.includes('_gpu_apca')
    ) {
      preamble +=
        this.languageId === 'wgsl'
          ? GPU_COLOR_PREAMBLE_WGSL
          : GPU_COLOR_PREAMBLE_GLSL;
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
          `Shader declaration "${d.name}" is declared more than once (as an ` +
            `input and as a uniform): two storage classes cannot share one ` +
            `name, and a body referencing it names neither unambiguously. ` +
            `Rename one of them. Fail closed (D6).`
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
