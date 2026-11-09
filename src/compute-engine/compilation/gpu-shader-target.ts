// The GPUShaderTarget class: the compile target of the GLSL shader language.

import type { Expression } from '../global-types.js';
import { entrySource } from './function-purity.js';
import {
  cseRecordingRules,
  isCallerMapped,
  isOpaqueVarsSource,
} from './cse.js';
import { CompilerState } from './compiler-state.js';
import { withVarsValuesHidden } from './vars-inputs.js';
import { throwIfCallerCancellation } from '../../common/interruptible.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import {
  GPU_EXACT_TRIG_PREAMBLE_GLSL,
  gpuExactTrigReport,
} from './gpu-exact-trig.js';
import { foldEmittedGPUCode, callerSpliceSources } from './constant-folding.js';
import type {
  CompileTarget,
  CompiledOperators,
  CompiledFunctions,
  LanguageTarget,
  CompilationOptions,
  CompilationResult,
} from './types.js';
import { CompileDeclineError, compileDiagnosticOf } from './diagnostics.js';
import { resolveStorageHints } from './storage-hints.js';
import { lowerParallelHeads, sumAssignedNames } from './parallel-lowering.js';
import {
  fragmentErrorDiagnostic,
  fragmentRefusalDiagnostic,
  typeFragment,
} from './fragment.js';
import type {
  CanCompileResult,
  FragmentAnnotation,
  FragmentDeclaredInput,
  FragmentTargetFields,
} from './fragment.js';
import { assertAdmitted, unsettledShapeIn } from './compile-admission.js';
import { reachesCallerCodeOn } from './compile-folding.js';
import {
  glslFragmentDefinition,
  glslFragmentTypeOfSpelling,
  glslRepresentationOfValue,
  shaderFunctionBody,
} from './glsl-fragment.js';
import type { GlslRepresentation } from './glsl-fragment.js';
import { strictTypesError } from './compile-expression.js';
import { resolveCompileMode } from './compile-lanes.js';
import { BaseCompiler, explicitBroadcastPointNorm } from './base-compiler.js';
import {
  isNonRealNumber,
  resolveTypeForCompiledLanes as resolveTypeForCompilation,
} from '../../common/type/utils.js';
import { isSubtype } from '../../common/type/subtype.js';
import { rewriteAngularUnit } from './angular-unit.js';
import { inlineSharedUserFunctionCalls } from './gpu-shared-calls.js';
import { GPU_MAX_WRITTEN_NODES, gpuWrittenSize } from './gpu-written-size.js';
import { withShadowingCallsRenamed } from './shadowing-calls.js';
import {
  overriddenCompilationHeads,
  unrollFixedWidthCollections,
} from './fixed-width-unroll.js';
import {
  inlinePointCalls,
  inlinePointValues,
  reachableSymbolNames,
} from './point-value-inlining.js';
import {
  GPU_CONSTANTS,
  GPU_OPERATORS,
  conditionalGPUSinks,
  formatGPUNumber,
  gpuNaN,
  gpuType,
  gpuVec2,
} from './gpu-emit.js';
import {
  GPU_FUNCTIONS,
  GPU_MAX_INLINE_ELEMENTS,
  compileGPUBroadcastUnary,
  GPU_PASS_COUNTER,
} from './gpu-functions.js';
import {
  gpuCertainValueType,
  gpuCheckOperandShapes,
  gpuIsRealOnlyLowering,
  gpuLoweredSymbolTypeHook,
} from './gpu-shapes.js';
import type { GPUShapeRules, GPUShapeRulesTarget } from './gpu-shapes.js';
import {
  GPU_RANDOM_COUNTER_PREFIX,
  gpuPlainUniformRead,
  gpuInputShapeRefusals,
  gpuRandomState,
  gpuRefuseShadowedVarsSources,
  gpuTextSymbols,
  installGPURandomState,
  resetGPURandomNumbering,
} from './gpu-random.js';
import type { GPURandomTarget } from './gpu-random.js';
import {
  GPU_SUPPORTED_MODES,
  gpuAssignedName,
  gpuAssignmentConverts,
  gpuComponentCountOfShaderType,
  gpuDeclaredBodyTarget,
  gpuDeclaredComponentCount,
  gpuDeclaredIsIntegerScalar,
  gpuDeclaredShapeFrame,
  gpuDeclaredTypeOf,
  gpuNormalizeShaderType,
  gpuPointOrPointListUnion,
  gpuReadsPointOrPointListSymbol,
  gpuShaderAssignmentTarget,
  gpuSpellValueType,
  gpuTypeOfDeclaredType,
  gpuTypeOfValue,
} from './gpu-declared-types.js';
import type {
  GPUShaderDeclaration,
  GPUUserFunctionSignature,
} from './gpu-declared-types.js';
import { gpuColorOperand } from './gpu-color.js';
import {
  compileGPUConditionalArm,
  compileGPUSelection,
  gpuAssertExpressionBody,
  gpuAssertExpressionOnly,
  gpuAssertReturnPlacement,
  gpuCanPlaceStatement,
} from './gpu-statements.js';
import {
  gpuAssertBindingKeepsDrawOrder,
  gpuAssertHoistKeepsCallerOrder,
  gpuRecompileWithBoundDraws,
  gpuRecordBoundDraws,
} from './gpu-draw-order.js';
import {
  GLSL_STAGE_BUILTINS,
  GLSL_STAGE_BUILTIN_OUTPUTS,
  GLSL_STAGE_BUILTIN_TYPES,
  gpuCheckIdentifier,
} from './gpu-reserved.js';
import {
  gpuAtHelperWidths,
  gpuAtPointHelperShapes,
  gpuAtPointPreamble,
  gpuAtPreamble,
  gpuRefuseStorageReference,
  gpuTexAtHelperWidths,
  gpuTexAtPreamble,
} from './gpu-at.js';
import { gpuPointCallsOverBudget, gpuPointDeclaration } from './gpu-points.js';
import {
  gpuDefinitionParameterFacts,
  gpuRecordCallSiteFacts,
} from './gpu-finite-proof.js';
import { buildComplexPreamble } from './gpu-complex-functions.js';
import {
  GPU_BESSELJ_PREAMBLE_GLSL,
  GPU_COLOR_LIBRARY_GLSL,
  GPU_ERF_PREAMBLE_GLSL,
  GPU_FRACTAL_PREAMBLE_GLSL,
  GPU_FRESNELC_PREAMBLE_GLSL,
  GPU_FRESNELS_PREAMBLE_GLSL,
  GPU_GAMMA_PREAMBLE_GLSL,
  GPU_GCD_PREAMBLE_GLSL,
  GPU_HEAVISIDE_PREAMBLE_GLSL,
  GPU_INF_PREAMBLE_GLSL,
  GPU_LERCH_PREAMBLE_GLSL,
  GPU_MEDIAN_PREAMBLE_GLSL,
  GPU_NAN_PREAMBLE_GLSL,
  GPU_PCG3D_PREAMBLE_GLSL,
  GPU_PI_TRIG_PREAMBLE_GLSL,
  GPU_POLEVL_PREAMBLE_GLSL,
  GPU_POLYGAMMA_PREAMBLE_GLSL,
  GPU_POWI_PREAMBLE_GLSL,
  GPU_ROUND_PREAMBLE_GLSL,
  GPU_SINC_PREAMBLE_GLSL,
  GPU_ZETA_PREAMBLE_GLSL,
} from './gpu-preambles.js';
import { gpuFixedPowerPreamble } from './gpu-reduce.js';
import {
  gpuLibrarySubset,
  gpuPowiHelperForms,
  gpuPowiVecPreamble,
} from './gpu-library.js';
import {
  GPU_FLOOR_MOD_PREAMBLE_GLSL,
  GPU_NAN_SAFE_PREAMBLE_GLSL,
} from './gpu-nan-safe.js';

/**
 * The result of the prepare stage of a root compilation
 * (`GPUShaderTarget.prepareRoot()`): the tree that the emit stage walks, and
 * the state that the emit stage needs to write it.
 *
 * The emit stage (`GPUShaderTarget.emitPreparedRoot()`) reads this tree
 * without a change. A later typing pass reads the same tree between the two
 * stages, so no rewrite may run between the prepare stage and the emit stage:
 * a rewrite there would give a tree that the pass did not type.
 */
interface GpuPreparedRoot {
  /** The tree after every rewrite of the prepare stage. */
  readonly expr: Expression;
  /** The compile target of the root, made for `expr` by the prepare stage. */
  readonly target: CompileTarget<Expression>;
  /**
   * The options of the common-subexpression pass. The prepare stage checks
   * the written size with the rules of the pass under these options, and the
   * emit stage opens the session of the pass with the same options.
   */
  readonly cseOptions: {
    readonly isOverriddenOperator: (name: string) => boolean;
    readonly isStringVar: (name: string) => boolean;
    readonly isVarsKey: (name: string) => boolean;
  };
}

/**
 * The default pass cap of a GLSL evaluation (`CompilationOptions.iterationBudget`
 * on the `glsl` target): the number of passes that the loops of one
 * evaluation of the emitted code can run together before its value is NaN.
 * It covers every GLSL aggregate of the corpus of 2026-11-08. Two nested
 * sums of 10,000 passes each would be 1e8 passes per fragment, which can make
 * the browser lose the WebGL context.
 */
export const GLSL_DEFAULT_PASS_BUDGET = 10_000;

/** The preprocessor name that guards the declaration of the pass counter in
 *  the preamble. */
const GPU_PASS_COUNTER_GUARD = '_GPU_PASSES_DECLARED';

/** The largest pass cap of a GLSL evaluation. The counter is an `int`
 *  (at most `2^31 - 1`), and `++counter > cap` must not overflow it. A loop
 *  breaks when the counter passes the cap, and each later entry of a loop
 *  adds one more before it breaks, so the counter can go far past the cap.
 *  A cap of `2^30` leaves `2^30 - 1` such entries before an overflow. */
const GLSL_MAX_PASS_BUDGET = 2 ** 30;

/**
 * The pass cap of a GLSL evaluation from the `iterationBudget` option, or
 * `undefined` for no cap. No option gives the default cap. `Infinity` gives
 * no cap, as on the JavaScript target, where no count of passes exceeds it.
 * A finite value is floored and kept at most `2^30`. `NaN`, a value of
 * at most 0 and a value that is not a number are refused with an error, as
 * the check of the options of `compile()` refuses them for every target
 * (`assertCompilationOptionsContract()`); this test covers a caller of the
 * target that does not go through that check.
 */
function glslPassBudget(option: unknown): number | undefined {
  if (option === undefined) return GLSL_DEFAULT_PASS_BUDGET;
  if (option === Infinity) return undefined;
  if (typeof option !== 'number' || !(option > 0))
    throw new Error(
      `Invalid compilation option "iterationBudget": expected a positive ` +
        `number, or \`Infinity\` for no cap`
    );
  return Math.min(Math.floor(option), GLSL_MAX_PASS_BUDGET);
}

/**
 * The entry of the user function `id` in the fragment annotation, under the
 * registry key `key` of its definition (`f`, or `f#bind…` for a variant that
 * reads a list input by name). A definition under another key (a
 * specialization by the types of its arguments, `f_complex`, or an
 * invariant-prefix variant) has no entry: its parameter types are those of
 * the specialization, which the `define` hook reads as before.
 */
function gpuAnnotationEntry(
  annotation: FragmentAnnotation<GlslRepresentation> | undefined,
  id: string,
  key: string | undefined
): FragmentAnnotation<GlslRepresentation>['functions'] extends Map<
  string,
  infer E
>
  ? E | undefined
  : never {
  if (annotation === undefined) return undefined;
  return annotation.functions.get(key ?? id);
}

/**
 * The GLSL value of the type `type` that is NaN in each component, for the
 * value of an evaluation that runs more passes than its cap. A boolean has no
 * NaN: its value is then `false`.
 */
function gpuPassCapValue(type: string): string {
  if (type === 'bool') return 'false';
  const nan = '_gpu_nan()';
  if (type === 'float') return nan;
  const array = /^(float|vec[234])\[(\d+)\]$/.exec(type);
  if (array !== null) {
    const element = array[1] === 'float' ? nan : `${array[1]}(${nan})`;
    return `${type}(${Array(Number(array[2])).fill(element).join(', ')})`;
  }
  return `${type}(${nan})`;
}

/** The message of the decline for user-defined functions whose code would
 * have more than `GPU_MAX_WRITTEN_NODES` nodes. */
function userFunctionsTooLarge(language: string): string {
  return (
    `Could not compile: the ${language.toUpperCase()} code of ` +
    `the user-defined functions that the expression calls would ` +
    `have more than ${GPU_MAX_WRITTEN_NODES.toLocaleString('en-US')} ` +
    `nodes. A subexpression that several paths reach is written once ` +
    `for each path when the shader cannot compute it once: the paths ` +
    `go through different branches of an \`If\`, the subexpression ` +
    `reads a \`vars\` source that is not a variable or a field of a ` +
    `variable (\`u.c\`), it is not pure, or the \`cse\` option is ` +
    `false. A call that is written in place of its definition is ` +
    `written in full at each call site.`
  );
}

/**
 * Run `f` while each node whose operator has a `compile` handler of the
 * caller (`isCallerMapped()` with no `functions` entry) counts as a node
 * whose code that handler wrote (`CompilerState._callerLowered`). The
 * search for a value with no settled shape (`unsettledShapeIn()`) then
 * reads such a node as `compile()` reads it after the handler wrote its
 * code: one value of its static type, not a conditional.
 */
function withHandlerNodesLowered<T>(f: () => T): T {
  const handlerOnly = { isOverriddenOperator: () => false };
  class HandlerNodes extends Map<Expression, boolean> {
    override get(node: Expression): boolean | undefined {
      if (!this.has(node)) this.set(node, isCallerMapped(node, handlerOnly));
      return super.get(node);
    }
  }
  const outer = CompilerState._callerLowered;
  CompilerState._callerLowered = new HandlerNodes();
  try {
    return f();
  } finally {
    CompilerState._callerLowered = outer;
  }
}

export abstract class GPUShaderTarget implements LanguageTarget<Expression> {
  /** Language identifier (e.g., 'glsl') */
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
   * operands. The GLSL target overrides it (`GLSL_SHAPE_RULES`).
   *
   * The default is strict, so a further subclass that forgets to override it
   * fails closed rather than open: only the third slot of `mix` (the blend
   * factor) and of `refract` (the index) admits a scalar, and only the
   * matrix arithmetic without unary matrix negation is admitted.
   *
   * `mandatoryScalarSlots` and `vectorOnlySlots` are OBLIGATIONS, so their
   * fail-closed default is the larger set: more obligations is stricter,
   * where more permissions is laxer. `refract`'s third argument is the one
   * mandatory scalar slot, and the vector-only table lists the geometric
   * builtins that a shader language can declare over vectors only.
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
    const v2 = 'vec2';
    const rules = this.getShapeRules();
    const target: GPURandomTarget & GPUShapeRulesTarget = {
      language: this.languageId,
      isRealOnlyLowering: gpuIsRealOnlyLowering,
      // A shader value has ONE static shape (`float` or `vec2`), decided by
      // type analysis — the strict discipline IS this target's model, and the
      // only mode it offers (`CompileMode`). A requested `'complex'` is the
      // `unsupported-mode` decline.
      supportedModes: GPU_SUPPORTED_MODES,
      // The shader type of each free symbol, for
      // `CompilationResult.freeSymbolTypes`. See `gpuLoweredSymbolTypeHook`.
      loweredSymbolType: gpuLoweredSymbolTypeHook(),
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
        const type = gpuTypeOfValue(expr, current);
        if (type === undefined) return false;
        BaseCompiler.hoistStatement(current, `${type} ${name} = ${code};`);
        return true;
      },
      // A shader has no expression-level loop or IIFE, so the multi-statement
      // block forms (loop-form Sum/Product, Loop, Block) are only valid at
      // statement position. Flag it so the base compiler hoists them where a
      // statement sink is available and fails closed elsewhere, rather
      // than splice a bare block into a sub-expression. Gated to the pure GPU
      // languages by language id.
      bareStatementBlocks: this.languageId === 'glsl',
      recompileStatement: gpuRecompileWithBoundDraws,
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
      valueBlock: (valueNode, stmts, valueCode, current, block) => {
        if (
          !BaseCompiler.canHoist(current) ||
          conditionalGPUSinks.has(current.hoist!)
        )
          return undefined;
        // The block runs ahead of the statement as one compound statement,
        // so a draw in it must not come before a draw written before it.
        const draws =
          block !== undefined && BaseCompiler.foldValueImpure(block);
        if (draws) gpuAssertBindingKeepsDrawOrder('Block', [block], current);
        gpuAssertHoistKeepsCallerOrder(
          'Block',
          block === undefined ? undefined : [block],
          current
        );
        const type = gpuTypeOfValue(valueNode, current);
        if (type === undefined) return undefined;
        const tv = BaseCompiler.tempVar(current);
        const body = BaseCompiler.joinShaderStatements([
          ...stmts,
          `${tv} = ${valueCode}`,
        ])
          .split('\n')
          .map((line) => `  ${line}`)
          .join('\n');
        BaseCompiler.hoistStatement(current, `${type} ${tv};`, `{\n${body}\n}`);
        if (draws) gpuRecordBoundDraws([block], current);
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
      broadcastUnary: (head, operand, lowering, unaryTarget) =>
        compileGPUBroadcastUnary(head, operand, lowering, unaryTarget),
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
      // GLSL has no string type, no character type and no text
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
        const type = typeHint ?? 'float';
        return `${type} ${name}`;
      },
      block: (stmts) => {
        if (stmts.length === 0) return '';
        const last = stmts.length - 1;
        // A statement-form construct as the block's LAST element — a `Loop`
        // emits a `for (…) { … }` statement — has no value to return.
        // Return-prefixing it would produce `return for (…) { … }` (invalid
        // GLSL), and a shader block must evaluate to a typed value, so
        // there is no `return None` analog either. Fail closed. A Loop in
        // a non-final position is fine (it stays a bare statement).
        if (/^\s*(for|while)\b/.test(stmts[last]))
          throw new Error(
            `Could not compile \`${this.languageId.toUpperCase()}\`: a Loop (or other statement-form ` +
              `construct) cannot be the final statement of a block — a shader ` +
              `block must evaluate to a typed value.`
          );
        // A last statement that is an assignment is returned as it is in
        // GLSL, where an assignment is an expression (`return s = x;`).
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
    // The body of each user-defined function is a shader function of its
    // own, with its own common-subexpression pass, or is substituted at a
    // call site, where no pass reads it. The size limit of the root
    // (`compileOrThrow`) applies to each body too, with the rules of the
    // pass that compiles it (`cseRecordingRules()`, `cse.ts`): no node
    // is shared in a substituted body, or when the pass is off (the `cse`
    // option is false, or the `compileShader()` route). A body substituted
    // at several call sites is written at each of them, so the limit
    // applies to the sum of the substituted bodies of one compilation too.
    let substituted = 0;
    target.checkDefinitionBody = (body, bodyTarget, shared) => {
      const cse = bodyTarget.cse;
      const rules = {
        ...cseRecordingRules(body, {
          ...cse?.harvestOptions,
          admitPureUserFunctions: true,
        }),
        share: shared && cse?.enabled === true,
      };
      const size = gpuWrittenSize(body, rules);
      if (!shared) substituted += size;
      if (size > GPU_MAX_WRITTEN_NODES || substituted > GPU_MAX_WRITTEN_NODES)
        throw new Error(userFunctionsTooLarge(this.languageId));
    };
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
    // A symbol whose type admits a point and a list of points has no shader
    // type: a point is a vector and a list of points is an array. The shader
    // can use such a symbol only when it computes the value of the symbol
    // (an assigned value, which `var` and `mangleId` do not see). A read of
    // the symbol as an input fails closed: through `var` when the caller's
    // `vars` maps it (the host would declare it, with a type that the
    // compilation cannot decide), and through `mangleId` when it is emitted
    // as a bare identifier. As for the text gate above, the gate is keyed by
    // the name, so a binder of the same name is also refused, which is a
    // decline and never a wrong value. The same gate refuses a symbol whose
    // type is a tuple that no shader type holds: `T` of type
    // `tuple<tuple<real, real>, tuple<real, real>>` was emitted as a bare
    // `T`, `First(T)` as `T.x`, and a local copy as `vec2 Q; Q = T;`.
    const { pointOrList, unsizedLists } = gpuInputShapeRefusals(expr);
    if (pointOrList.size > 0) {
      const innerVar = target.var;
      const innerMangle = target.mangleId;
      target.var = (id) => {
        const resolved = innerVar(id);
        const refusal = pointOrList.get(id);
        if (
          resolved !== undefined &&
          refusal !== undefined &&
          target.varsKeys?.has(id) === true
        )
          throw new Error(refusal);
        return resolved;
      };
      target.mangleId = (id) => {
        const refusal = pointOrList.get(id);
        if (refusal !== undefined) throw new Error(refusal);
        return innerMangle ? innerMangle(id) : id;
      };
    }
    // A symbol whose type is a collection with no static length
    // (`list<real>`, `matrix`, `set<real>`) or a list with no element has no
    // shader declaration, so a read of it as an input fails closed, through
    // the same two hooks as the gate above. The read is allowed when the
    // shape of the name has another source: a storage hint
    // (the positional read of a sampler or a storage buffer, which the
    // storage gate above restricts), or a local shape frame (a parameter, a
    // `Block` local, or a name that the caller declared with a shader type,
    // whose declaration decides its shape).
    if (unsizedLists.size > 0) {
      const innerVar = target.var;
      const innerMangle = target.mangleId;
      const refuse = (id: string): void => {
        const refusal = unsizedLists.get(id);
        if (
          refusal !== undefined &&
          target.storage?.has(id) !== true &&
          BaseCompiler.localShapeFrameOf(id) === undefined
        )
          throw new Error(refusal);
      };
      target.var = (id) => {
        const resolved = innerVar(id);
        if (resolved !== undefined && target.varsKeys?.has(id) === true)
          refuse(id);
        return resolved;
      };
      target.mangleId = (id) => {
        refuse(id);
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
   * The fragment annotation of the current compilation (`typeFragment()`),
   * which the `define` hook of the user functions reads for the signature of
   * a function. Set and cleared by the routes that run the pass, within one
   * call, as `currentUserFunctions` is.
   */
  private currentAnnotation?: FragmentAnnotation<GlslRepresentation>;

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
    const signatures = new Map<string, GPUUserFunctionSignature>();
    const declareFn = (
      name: string,
      ret: string,
      params: ReadonlyArray<[name: string, type: string]>,
      body: string
    ) => this.declareGPUFunction(name, ret, params, body);

    // A call of a function whose parameters are all scalar, with a LIST of 2
    // to 4 real numbers at one or more of its scalar parameters. The
    // interpreter applies the function to each element of the list (the
    // call broadcasts), so `f([a, b])` with `f(q) := Mod(q, 1) - 0.5` is
    // `[f(a), f(b)]`. The JavaScript target does the same with a static
    // map (`_SYS.mapFn`). Here the list is a `vecN`, and the definition of
    // `f` has a `float` parameter, which a `vecN` does not convert to. The
    // call is emitted through a wrapper that applies the definition to each
    // component and builds the `vecN` of the results:
    //
    //   vec2 _fn_f_each2(vec2 a0) {
    //     return vec2(_fn_f(a0.x), _fn_f(a0.y));
    //   }
    //
    // The wrapper evaluates its list argument once, and holds every other
    // argument whole, as the interpreter does with a scalar beside a list.
    // All the lists must have the same width. The definition must return a
    // `float`: the elements of the result are then the components of the
    // `vecN`. A point (a tuple) and a complex value are not lists
    // (`isShaderVectorListArg`), so they keep the strict shape check of the
    // call below. Returns `undefined` when the call is not of this form.
    const elementwiseCall = (
      id: string,
      name: string,
      sig: GPUUserFunctionSignature,
      args: ReadonlyArray<Expression>,
      target: CompileTarget<Expression>
    ): string | undefined => {
      if (args.length === 0 || sig.ret !== 'float') return undefined;
      const engine = args[0].engine;
      if (!BaseCompiler.userFunctionParamsAreScalar(engine, id))
        return undefined;
      let width: number | undefined;
      let vecType: string | undefined;
      const mapped = args.map((arg, i) => {
        // A colour or complex parameter converts its argument at the call
        // (`gpuColorOperand`, the `vec2(x, 0.0)` lift), which the wrapper
        // does not do.
        if (sig.complex[i] || sig.colors[i]) return undefined;
        const t = gpuTypeOfValue(arg, target);
        if (t === sig.params[i]) return false;
        if (
          sig.params[i] !== 'float' ||
          t === undefined ||
          !/^vec[234]$/.test(t) ||
          !BaseCompiler.isShaderVectorListArg(arg)
        )
          return undefined;
        const n = gpuComponentCountOfShaderType(t);
        if (BaseCompiler.aggregateComponentCount(arg) !== n) return undefined;
        if (width !== undefined && width !== n) return undefined;
        width = n;
        vecType = t;
        return true;
      });
      if (
        width === undefined ||
        vecType === undefined ||
        mapped.some((m) => m === undefined)
      )
        return undefined;
      const registry = target.userFunctions;
      if (registry === undefined) return undefined;
      const mask = mapped.map((m) => (m ? '1' : '0')).join('');
      // The name comes from the allocator of the user functions, under a key
      // that no user function has (`#` is not in a function id). A name
      // built by hand could be the name of a user function such as
      // `f_each2_1`, or of a variable of the expression.
      const wrapper = BaseCompiler.registryHelperName(
        registry,
        `${id}#each${width}_${mask}`
      );
      if (!registry.defs.has(wrapper)) {
        const params = args.map((_, i): [string, string] => [
          `a${i}`,
          mapped[i] ? vecType! : sig.params[i],
        ]);
        const components = ['x', 'y', 'z', 'w'].slice(0, width);
        const body = `${vecType}(${components
          .map(
            (c) =>
              `${name}(${args
                .map((_, i) => (mapped[i] ? `a${i}.${c}` : `a${i}`))
                .join(', ')})`
          )
          .join(', ')})`;
        registry.defs.set(wrapper, declareFn(wrapper, vecType, params, body));
      }
      return `${wrapper}(${args
        .map((arg) => BaseCompiler.compileValueOperand(arg, target))
        .join(', ')})`;
    };

    return {
      defs: new Map<string, string>(),
      compiling: new Set<string>(),
      lowering: {
        // GLSL forbids recursion outright.
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
          key,
          params,
          body: storedBody,
          literal,
          target,
          parameterTypes,
          parameterPositions,
          extraParams,
        }) => {
          // The point values and the point-valued calls of the body written
          // in place, for this compilation only. The fragment pass prepares
          // the body that it types with the same function. The nodes of
          // this body are new, and the pass did not type them: the body
          // that the pass typed is `FragmentAnnotation.functions.get(key)`.
          // The two bodies can differ: the stored body of the definition
          // has a call of a tuple-valued function already replaced by its
          // body, where the pass typed the call. So the emitter does not
          // check that the two are the same.
          const body = shaderFunctionBody(storedBody, target, params);
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
          // The entry of the function in the fragment annotation of this
          // compilation: its signature (the type of each parameter and of
          // the result) and its scope, where the pass bound the parameters.
          // The signature then comes from the annotation, so that the
          // emitted declaration is the one that the pass checked each call
          // against: a parameter with no declared type has the type of its
          // argument (the spec, decision 11), not a `float`. A definition
          // that the annotation does not hold (no annotation, or a variant
          // that the pass did not type under this key) keeps the reading of
          // the declared signature below.
          const entry = gpuAnnotationEntry(this.currentAnnotation, id, key);
          const signature =
            entry !== undefined &&
            entry.type.kind === 'function' &&
            entry.type.parameters.length === params.length
              ? entry.type
              : undefined;
          const paramTypes = params.map((p, i) => {
            const fragmentType = signature?.parameters[i].type;
            const facts = entry?.scope.bindings.get(p);
            const annotated =
              fragmentType === undefined
                ? undefined
                : facts !== undefined && 'representation' in facts
                  ? facts.representation
                  : glslRepresentationOfValue(fragmentType);
            // A parameter with no representation in the annotation keeps the
            // reading of the declared signature below, which records the
            // frames of the parameter. They are recorded once.
            if (fragmentType !== undefined && annotated !== undefined) {
              const t = fragmentType;
              const complex = t.kind === 'complex';
              const color = t.kind === 'color';
              colors.push(color);
              complexParams.push(complex);
              complexFrame.set(p, complex);
              // A list parameter is a list of 2 to 4 reals, a `vecN` (the
              // spec, decision 18).
              const n = complex
                ? 2
                : color
                  ? 3
                  : t.kind === 'point'
                    ? t.size
                    : t.kind === 'list'
                      ? (t.count ?? 0)
                      : 0;
              vectorFrame.set(
                p,
                t.kind === 'boolean'
                  ? BaseCompiler.LOCAL_BOOLEAN
                  : n >= 2
                    ? n
                    : BaseCompiler.LOCAL_SCALAR
              );
              return annotated;
            }
            const declared =
              parameterTypes?.[i] ??
              BaseCompiler.userFunctionParamType(engine, id, i);
            const own = paramSymbols[i]?.type?.type;
            const t =
              declared === undefined || declared === 'unknown' ? own : declared;
            const shader = gpuTypeOfDeclaredType(t);
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
                const shader = gpuTypeOfValue(x.expr);
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
          // The scalar parameters that are finite for certain, because every
          // call of the function passes a finite value there, or because the
          // host declared them with a range: the body then calls the
          // built-in `sin`, `min`, … of them, not the NaN-safe helper
          // (`gpuProvablyFinite`).
          const parameterFacts = gpuDefinitionParameterFacts(
            id,
            params,
            paramTypes,
            body,
            target,
            parameterPositions
          );
          const { ret, code } = BaseCompiler.withLocalShapeFrame(
            complexFrame,
            vectorFrame,
            () => {
              const ret =
                signature !== undefined
                  ? (glslRepresentationOfValue(signature.result) ??
                    gpuTypeOfValue(body))
                  : gpuTypeOfValue(body);
              const pointOrList =
                ret === undefined
                  ? gpuReadsPointOrPointListSymbol(body)
                  : undefined;
              if (pointOrList !== undefined && isSymbol(pointOrList))
                throw new Error(
                  `Could not compile \`${id}\`: the return value reads ` +
                    `"${pointOrList.symbol}", which has the type ` +
                    `\`${pointOrList.type.toString()}\`. That type admits ` +
                    `a point and a list of points, so the return value has ` +
                    `no static ${language.toUpperCase()} type. Declare ` +
                    `"${pointOrList.symbol}" as a point ` +
                    `(\`${gpuPointDeclaration(
                      pointOrList.symbol,
                      gpuPointOrPointListUnion(pointOrList.type.type)?.arity
                    )}\`).`
                );
              if (ret === undefined)
                throw new Error(
                  `Could not compile \`${id}\`: the return value has no static ` +
                    `${language.toUpperCase()} type — only scalars, booleans, ` +
                    `colors, complex values and 2–4 component vectors have one.`
                );
              // Every `Return` in the body must yield the shape the
              // signature just synthesized: a shader function has ONE return
              // type and GLSL does not convert between a scalar, a
              // `bool` and a `vecN`. Checked AT the emission, not by a
              // pre-walk, because the shape of a `Return`'s value is only
              // knowable while the emitter's local frames are pushed — a
              // `Return(z)` naming a `vec2` block-local reads as a scalar
              // once `compileBlock` has popped its frame, which is exactly
              // how `float _fn_a(float t) { … return z; }` went out behind
              // `success: true`.
              const bodyTarget: CompileTarget<Expression> &
                FragmentTargetFields<GlslRepresentation> = {
                ...target,
                gpuParameterFacts: parameterFacts,
                // The scope of the function in the annotation, where the
                // pass typed the nodes of the body.
                fragmentScope: entry?.scope,
                onReturn: (value) => {
                  const t =
                    value === undefined
                      ? undefined
                      : gpuTypeOfValue(value, bodyTarget);
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
              };
              const code = BaseCompiler.compileFunctionBody(body, bodyTarget);
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
          if (held === undefined) {
            const each = elementwiseCall(id, name, sig, args, target);
            if (each !== undefined) return each;
          }
          const code = args.map((arg, i) => {
            const t = gpuTypeOfValue(arg, target);
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
            // JS target answers this with the static map `_SYS.mapFn`,
            // which a shader has no analog for. Scalar
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
            // `vec2` and GLSL does not convert a scalar to a vector
            // implicitly. Lift the argument to `vec2(x, 0.0)`, as the
            // JavaScript target wraps it in `{ re: x, im: 0 }`. Only a
            // floating-point scalar is lifted: a `bool` is not a number.
            if (sig.complex[i] && t === 'float' && t !== sig.params[i])
              return `${gpuVec2()}(${BaseCompiler.compileValueOperand(
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
   * fresh target of its own. `params`/`ret` are already GLSL types
   * (`float`, `vec2`).
   */
  protected declareGPUFunction(
    name: string,
    returnType: string,
    params: ReadonlyArray<[name: string, type: string]>,
    body: string
  ): string {
    const signature = `${returnType} ${name}(${params
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
   * The complete declared TYPE is carried (element × width, the GLSL
   * spelling normalized), not just a width: `ivec2` and `bvec2` are two
   * components each and GLSL does not convert them to `vec2`. A spelling with
   * no static value type here (a matrix, an array, a struct, a `#define`
   * alias) is recorded as such and fails closed if it reaches a user-function
   * call. Complex-ness is deliberately NOT framed: a `vec2` parameter may be a
   * point or a complex number, the caller's type does not say which, and the
   * existing inference already answers `vec2` either way.
   *
   * The parameters are also BOUND (`gpuDeclaredBodyTarget`), so a same-named
   * engine symbol cannot fold over the parameter the signature declares.
   */
  /**
   * Type `expr`, a prepared body of `compileFunction()` or a prepared
   * statement of `compileShader()`, with the GLSL fragment, the names that
   * the caller declares bound in the root scope. A body outside the fragment
   * declines with the diagnostic of `canCompile()`. A declared name whose
   * spelling has no fragment type (`ivec2`, a matrix, an array) is refused
   * where the body reads it.
   *
   * Returns the annotation; the caller emits the body under it
   * (`withAnnotation()`).
   */
  private typeDeclaredBody(
    expr: Expression,
    target: CompileTarget<Expression>,
    declarations: ReadonlyArray<{ name: string; type: string }>,
    route: string,
    options: { userFunctions?: boolean } = {}
  ): FragmentAnnotation<GlslRepresentation> {
    const inputs: FragmentDeclaredInput[] = declarations.map((d) => ({
      name: d.name,
      type: glslFragmentTypeOfSpelling(d.type),
      declared: d.type.trim(),
    }));
    // A name declared with a GLSL vector type takes a number in `Add` and
    // `Subtract` (`pointNumberSumRefused()`).
    const definition = glslFragmentDefinition(target, {
      declaredVectors: new Set(
        inputs.filter((d) => d.type?.kind === 'point').map((d) => d.name)
      ),
    });
    const annotation = typeFragment(
      expr,
      options.userFunctions === false
        ? { ...definition, functionOf: () => undefined }
        : definition,
      { inputs }
    );
    if (annotation.refusal !== undefined) {
      const diagnostic = fragmentRefusalDiagnostic(annotation.refusal);
      throw new CompileDeclineError({
        ...diagnostic,
        message: `Could not compile ${route}: ${diagnostic.message}`,
      });
    }
    return annotation;
  }

  /**
   * Run `fn` with `annotation` as the annotation of the current compilation
   * (`currentAnnotation`), which the `define` hook of the user functions
   * reads.
   */
  private withAnnotation<T>(
    annotation: FragmentAnnotation<GlslRepresentation>,
    fn: () => T
  ): T {
    const outer = this.currentAnnotation;
    this.currentAnnotation = annotation;
    try {
      return fn();
    } finally {
      this.currentAnnotation = outer;
    }
  }

  protected compileDeclaredFunctionBody(
    expr: Expression,
    parameters: ReadonlyArray<[name: string, type: string]>,
    options?: { constantFold?: boolean }
  ): string {
    // The engine's angular unit, in radian-based code, as `compile()` does
    // at its entry.
    expr = rewriteAngularUnit(expr);
    const declarations = parameters.map(([name, type]) => ({ name, type }));
    const bodyTarget = this.createTargetFor(expr, undefined, {
      constantFold: options?.constantFold,
    });
    // A declared parameter that the body does not read is not in the names
    // of the expression, so a temporary could take its name (`_tv1`) and
    // the declaration would conflict with the parameter.
    const naming = BaseCompiler.namingContext(bodyTarget);
    for (const [name] of parameters) naming.usedNames.add(name);
    const target = gpuDeclaredBodyTarget(bodyTarget, declarations);
    BaseCompiler.beginRootPreprocessing(expr, target);
    // A point value is written in place of its symbol, as in `compile()`
    // (`inlinePointValues`). The declared parameters are bound, so they are
    // not replaced.
    const prepared = inlinePointValues(
      inlinePointCalls(
        expr,
        target,
        {
          scalarNames: new Set<string>(),
          localNames: new Set(declarations.map((d) => d.name)),
        },
        gpuPointCallsOverBudget
      ),
      target,
      new Set([
        ...declarations.map((d) => d.name),
        ...reachableSymbolNames(expr).written,
      ])
    );
    // The body is in the fragment, with the declared parameters as its
    // inputs, before any code is written.
    const annotation = this.typeDeclaredBody(
      prepared,
      target,
      declarations,
      '`compileFunction()`'
    );
    // The target itself, not a copy, carries the scope: the preprocessing
    // above recorded its state for this object.
    Object.assign(target, {
      fragmentScope: annotation.scope,
    } satisfies FragmentTargetFields<GlslRepresentation>);
    const body = this.withAnnotation(annotation, () =>
      BaseCompiler.withLocalShapeFrame(
        new Map(),
        gpuDeclaredShapeFrame(declarations),
        () =>
          // A function body is a statement position: a nested loop-form
          // `Sum`/`Product` hoists its loop ahead of the `return` (Tycho item
          // 110).
          BaseCompiler.compileFunctionBody(prepared, target)
      )
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
    // A `vars` entry is not given to the calls of a user function here, as
    // the JavaScript target does (`BaseCompiler.withVarsMappedUserFunctionHeads`).
    // On a shader a `vars` entry names a uniform or an input, which cannot be
    // called: `vars: { g: 'u_g' }` would compile `g(x)` to `u_g(x)`, which is
    // not valid shader source. A call of `g` compiles the engine definition of
    // `g` (`_fn_g`) instead. A caller that has a shader function to call
    // names it in the `functions` option.
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
      // declared type (`withVarsValuesHidden`). A call of a user function
      // that shadows a library operator is compiled under a private name
      // (`withShadowingCallsRenamed`).
      return withVarsValuesHidden(expr, options.vars, () =>
        withShadowingCallsRenamed(expr, options, (renamed) =>
          this.compileOrThrow(renamed, options, storage)
        )
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

  /**
   * Whether `compile()` gives code for `expr` with `options`, by the fragment
   * of the target: the prepare stage (`prepareRoot()`) and the typing pass
   * (`typeFragment()` with `glslFragmentDefinition()`). It writes no code.
   *
   * It never throws. An error of an option (an unknown storage kind, a mode
   * that the target does not offer), and a decline of the prepare stage (the
   * written size of the code), give `ok: false` with the code
   * `outside-fragment` and the message of the error.
   */
  canCompile(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): CanCompileResult {
    try {
      return this.preparedAndTypedForCheck(
        expr,
        options,
        ({ prepared, annotation, handlerCode }) => {
          if (annotation.refusal !== undefined)
            return {
              ok: false as const,
              diagnostic: fragmentRefusalDiagnostic(annotation.refusal),
            };
          // `compile()` declines a value with no settled shape (rule R3:
          // a block with an assignment as an operand, a local assigned
          // values of two shapes), found by `unsettledShapeIn()` on the
          // prepared tree before the code is written, and a sub-expression
          // of static type `error`, also in a branch that the code drops
          // and that the pass does not type. The same search here gives the
          // same answer. A `functions` or `vars` entry does not change it.
          // When a `compile` handler of the caller writes the code of a
          // node, `compile()` searches again after the code is written, and
          // reads that node as one value of its static type
          // (`CompilerState._callerLowered`). Here the search reads each
          // node whose operator has such a handler in the same way, as if
          // the handler writes its code (`withHandlerNodesLowered()`). A
          // handler that gives no code for a node leaves the stock code,
          // and `compile()` then does not read that node as one value: it
          // does not give the decline of reason 'handler-value' for it.
          // This search cannot tell such a node from another, so it gives
          // no decline of that reason: `canCompile()` can then accept an
          // expression that `compile()` declines, but it does not refuse
          // one that `compile()` compiles.
          const unsettled = handlerCode
            ? withHandlerNodesLowered(() => {
                const found = unsettledShapeIn(
                  prepared.expr,
                  prepared.target,
                  true
                );
                return found?.reason === 'handler-value' ? undefined : found;
              })
            : unsettledShapeIn(prepared.expr, prepared.target, true);
          if (unsettled !== undefined)
            assertAdmitted(prepared.expr, prepared.target, unsettled);
          // `compile()` declines when the code of a user-defined function
          // that it writes would be too large (`checkDefinitionBody` in
          // `createTargetFor()`). It measures the body of a definition,
          // before the point calls and values are written in place, with
          // the nodes that its common-subexpression pass can bind shared
          // when the `cse` option is not false, and a body written in place
          // of a call with no node shared. The pass records that tree and
          // that setting for each function (`sizeCheck`), and the same
          // measure is made here. A function with no record is not measured
          // by `compile()` either. The sum of the bodies written in place of
          // their calls is not checked here.
          for (const { sizeCheck } of annotation.functions.values()) {
            if (sizeCheck === undefined) continue;
            const body = sizeCheck.body;
            const rules = {
              ...cseRecordingRules(body, {
                ...prepared.cseOptions,
                admitPureUserFunctions: true,
              }),
              share: sizeCheck.shared && options.cse !== false,
            };
            if (gpuWrittenSize(body, rules) > GPU_MAX_WRITTEN_NODES)
              throw new Error(userFunctionsTooLarge(this.languageId));
          }
          if (options.strictTypes !== true) return { ok: true as const };
          // With `strictTypes`, `compile()` declines when a free symbol has
          // an inferred type: the same check, on the free symbols that the
          // reference analysis of `emitPreparedRoot()` reports for the
          // prepared tree.
          const references = BaseCompiler.withReferences(
            {} as Pick<CompilationResult, 'success' | 'freeSymbolTypes'>,
            prepared.expr,
            prepared.target,
            options.vars ? new Set(Object.keys(options.vars)) : undefined
          );
          const error = strictTypesError(references.freeSymbolTypes);
          if (error === undefined) return { ok: true as const };
          return {
            ok: false as const,
            diagnostic: {
              ...fragmentErrorDiagnostic(new Error(error.message)),
              binding: error.names[0],
            },
          };
        }
      );
    } catch (e) {
      return { ok: false, diagnostic: fragmentErrorDiagnostic(e) };
    }
  }

  /**
   * The steps of `canCompile()` before its own checks: the `storage` hints,
   * the wrappers of `compile()` (a `vars`-mapped symbol is read as the
   * valueless input of its declared type, and a call of a user function that
   * shadows a library operator has a private name), the prepare stage and
   * the typing pass. `check` reads the result inside the wrappers.
   */
  private preparedAndTypedForCheck<T>(
    expr: Expression,
    options: CompilationOptions<Expression>,
    check: (typed: ReturnType<GPUShaderTarget['prepareAndType']>) => T
  ): T {
    const storage =
      options.storage === undefined
        ? undefined
        : resolveStorageHints(options.storage, [expr], this.createTarget(), {
            vars: options.vars,
            functions: options.functions,
          });
    return withVarsValuesHidden(expr, options.vars, () =>
      withShadowingCallsRenamed(expr, options, (renamed) =>
        check(this.prepareAndType(renamed, options, storage))
      )
    );
  }

  /**
   * For tests only, not public API: the annotation of the typing pass that
   * `canCompile()` runs for `expr` with `options` (the same preparation and
   * the same pass), with the fact of each node that the pass typed. The
   * checks of `canCompile()` after the pass (the shape search, the size of
   * the user functions, `strictTypes`) do not run. It throws where
   * `canCompile()` answers `ok: false` for an error.
   */
  _fragmentAnnotationForTest(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): FragmentAnnotation<GlslRepresentation> {
    return this.preparedAndTypedForCheck(
      expr,
      options,
      ({ annotation }) => annotation
    );
  }

  /**
   * Compile the root expression in two stages: the prepare stage
   * (`prepareRoot()`) rewrites the tree and checks its written size, and the
   * emit stage (`emitPreparedRoot()`) writes the code of the prepared tree.
   * No rewrite may run between the two stages: a later typing pass reads the
   * prepared tree between them, and the emit stage must write the tree that
   * the pass typed.
   */
  private compileOrThrow(
    expr: Expression,
    options: CompilationOptions<Expression> = {},
    storage?: CompileTarget<Expression>['storage']
  ): CompilationResult {
    const { prepared, annotation } = this.prepareAndType(
      expr,
      options,
      storage
    );
    // The fragment is the contract of the target: an expression outside it
    // declines before any code is written, with the diagnostic of
    // `canCompile()`.
    if (annotation.refusal !== undefined)
      throw new CompileDeclineError(
        fragmentRefusalDiagnostic(annotation.refusal)
      );
    return this.emitPreparedRoot(prepared, options, annotation);
  }

  /**
   * The prepare stage (`prepareRoot()`) and the typing pass on the prepared
   * tree. `canCompile()` and `compile()` both call it, so the pass types the
   * tree that the emit stage writes, and it runs once per compilation.
   */
  private prepareAndType(
    expr: Expression,
    options: CompilationOptions<Expression>,
    storage: CompileTarget<Expression>['storage'] | undefined
  ): {
    prepared: GpuPreparedRoot;
    annotation: FragmentAnnotation<GlslRepresentation>;
    /** Whether the prepared tree reaches an operator with a `compile`
     *  handler of the caller (`reachesCallerCodeOn()` with no `functions`
     *  entry and no `vars` entry). Computed only when the pass accepts the
     *  tree. */
    handlerCode: boolean;
  } {
    // An `iterationBudget` that is not a cap is refused before the tree is
    // prepared, so that `canCompile()` and `compile()` both refuse it.
    glslPassBudget(options.iterationBudget);
    const prepared = this.prepareRoot(expr, options, storage);
    // A mode that the target does not offer is refused, as
    // `BaseCompiler.compile` refuses it when it emits.
    resolveCompileMode(prepared.target);
    // The pass asks which operands hold code that the caller supplies
    // (`reachesCallerCodeOn()`), which reads the predicates of the caller's
    // options from the session of the common-subexpression pass. The emit
    // stage opens that session; the pass runs before it, so it reads the
    // same predicates from a session with no sharing, removed after.
    const target = prepared.target;
    const outerCse = target.cse;
    target.cse ??= {
      enabled: false,
      harvestOptions: { ...prepared.cseOptions },
      instances: [],
    };
    let annotation: FragmentAnnotation<GlslRepresentation>;
    let handlerCode = false;
    try {
      annotation = typeFragment(
        prepared.expr,
        glslFragmentDefinition(target, {
          functions: options.functions,
          vars: options.vars,
          // Read on the tree as the program wrote it, before the prepare
          // stage lowers each `+=` to an `Assign`.
          sumAssigned: sumAssignedNames(expr),
        })
      );
      if (annotation.refusal === undefined) {
        // The same test, with the `functions` and `vars` entries left
        // out: only a `compile` handler remains.
        target.cse = {
          enabled: false,
          harvestOptions: {
            ...prepared.cseOptions,
            isOverriddenOperator: () => false,
            isStringVar: () => false,
          },
          instances: [],
        };
        handlerCode = reachesCallerCodeOn(prepared.expr, target);
      }
    } finally {
      target.cse = outerCse;
    }
    return { prepared, annotation, handlerCode };
  }

  /**
   * The prepare stage of a root compilation. It puts `expr` in the radian
   * convention, unrolls the collections of fixed width, makes the compile
   * target of the root, writes point values and the bodies of some user
   * functions in place of their calls, unrolls again, and refuses a tree
   * whose code would be too large (`gpuWrittenSize()`). It writes no code.
   *
   * The rewrites run in this order: `rewriteAngularUnit()`,
   * `unrollFixedWidthCollections()`, `inlinePointCalls()`,
   * `inlinePointValues()`, `BaseCompiler.inlineCollectionValuedCallsAtRoot()`,
   * `inlineSharedUserFunctionCalls()`, `unrollFixedWidthCollections()`.
   *
   * The stage throws for an expression that the target cannot compile. A
   * caller that wants to know only whether the expression compiles can call
   * this stage without the emit stage.
   */
  private prepareRoot(
    expr: Expression,
    options: CompilationOptions<Expression>,
    storage: CompileTarget<Expression>['storage'] | undefined
  ): GpuPreparedRoot {
    // Reproduce the engine's `angularUnit` semantics in radian-based code.
    expr = rewriteAngularUnit(expr);
    // A `parallel for` runs its passes in order on the shader, as a counted
    // loop, and `s += e` is `s = s + e` (`lowerParallelHeads()`): the GLSL
    // fragment admits both with scalar accumulators.
    expr = lowerParallelHeads(expr);
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
    // A string `vars` entry is caller source unless it is the spelling this
    // target emits for the symbol anyway, its bare name, or a bare identifier
    // that reads a uniform no variable of the shader can shadow and write
    // (`isOpaqueVarsSource`, `gpuPlainUniformRead`). The symbol names are
    // collected once, on the first question, from the expression before the
    // passes below change it: they inline user-function bodies, whose names
    // the walk already reaches.
    let symbolNames: ReturnType<typeof reachableSymbolNames> | undefined;
    const rootForNames = expr;
    const reachable = (): ReturnType<typeof reachableSymbolNames> =>
      (symbolNames ??= reachableSymbolNames(rootForNames, options.vars));
    const reachableNames = (): ReadonlySet<string> => reachable().all;
    if (options.vars !== undefined)
      gpuRefuseShadowedVarsSources(
        options.vars,
        () => reachable().written,
        reachableNames
      );
    const opaqueVar = (name: string): boolean =>
      isOpaqueVarsSource(
        options.vars?.[name],
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : undefined,
        (path, root) =>
          gpuPlainUniformRead(
            path,
            root,
            name,
            options.vars ?? {},
            reachableNames
          )
      );
    expr = unrollFixedWidthCollections(expr, {
      skipHeads: unrollSkipHeads,
      iterationBudget: options.iterationBudget,
      readsLiveSource: opaqueVar,
      // A shader has no loop lowering for a comprehension; a small one over
      // literal domains is written out as a fixed-size array literal
      // (`CompileTarget.unrollComprehensions`).
      unrollComprehensions: true,
    });
    const { functions: userFunctions, vars } = options;
    const allFunctions = this.getFunctions();
    const constants = this.getConstants();

    const v2 = 'vec2';
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
    //
    // A pure user-function call that several shader functions would repeat
    // with the same arguments (`B` and `H` both calling `F(x, y)`) is
    // substituted here as well, with the bodies it reaches, so the common
    // subexpressions below compute it once per invocation instead of once in
    // each function (`gpu-shared-calls.ts`, ROADMAP CE-525).
    // A symbol whose type admits a point and a list of points is replaced
    // by its point value where the shader computes the value anyway, so the
    // compilation reads the type of a tuple (`inlinePointValues`).
    BaseCompiler.beginRootPreprocessing(expr, target);
    expr = inlinePointValues(
      inlinePointCalls(expr, target, undefined, gpuPointCallsOverBudget),
      target,
      reachable().written
    );
    expr = unrollFixedWidthCollections(
      inlineSharedUserFunctionCalls(
        BaseCompiler.inlineCollectionValuedCallsAtRoot(
          expr,
          target,
          'list<any>'
        ),
        target,
        {
          isOverridden: (name) =>
            (userFunctions !== undefined &&
              Object.hasOwn(userFunctions, name)) ||
            (vars !== undefined && Object.hasOwn(vars, name)),
        }
      ),
      {
        skipHeads: unrollSkipHeads,
        iterationBudget: options.iterationBudget,
        readsLiveSource: opaqueVar,
        unrollComprehensions: true,
        explicitPointNorm: (point) => {
          const explicit = explicitBroadcastPointNorm(point, target);
          return typeof explicit === 'string' ? undefined : explicit;
        },
      }
    );
    if (vars) gpuRandomState(target).varNames = new Set(Object.keys(vars));

    const cseOptions = {
      isOverriddenOperator: (name: string) =>
        userFunctions !== undefined && Object.hasOwn(userFunctions, name),
      isStringVar: opaqueVar,
      isVarsKey: (name: string) =>
        vars !== undefined && Object.hasOwn(vars, name),
    };
    // The code for a node that several paths reach is written once for each
    // path, unless the common-subexpression pass binds the node. A deep
    // graph that the pass cannot bind gives code that grows exponentially
    // with the depth (ROADMAP CE-584), so it is refused here, before it is
    // written (`gpuWrittenSize`, `gpu-written-size.ts`).
    // The check uses the rules of the pass (`cseRecordingRules()`,
    // `cse.ts`) with the options of the session that the emit stage opens,
    // and runs before the session opens: the harvest of the pass can itself
    // take a time exponential in the depth of such a graph.
    const writtenSize = gpuWrittenSize(expr, {
      ...cseRecordingRules(expr, {
        ...cseOptions,
        admitPureUserFunctions: true,
      }),
      share: options.cse !== false,
    });
    if (writtenSize > GPU_MAX_WRITTEN_NODES)
      throw new Error(
        `Could not compile: the ${this.languageId.toUpperCase()} code for ` +
          `this expression would have more than ` +
          `${GPU_MAX_WRITTEN_NODES.toLocaleString('en-US')} nodes. A ` +
          `subexpression that several paths reach is written once for each ` +
          `path when the shader cannot compute it once: the paths go ` +
          `through different branches of an \`If\`, the subexpression reads ` +
          `a \`vars\` source that is not a variable or a field of a ` +
          `variable (\`u.c\`), it is not pure, or the \`cse\` option is ` +
          `false.`
      );
    return { expr, target, cseOptions };
  }

  /**
   * The emit stage of a root compilation: it writes the code of the tree
   * that `prepareRoot()` returned, with its preamble, its warnings and its
   * references. It changes no node of the tree. The common-subexpression
   * pass of this stage binds a node to a temporary, and the node keeps its
   * place in the tree.
   */
  private emitPreparedRoot(
    prepared: GpuPreparedRoot,
    options: CompilationOptions<Expression>,
    annotation: FragmentAnnotation<GlslRepresentation>
  ): CompilationResult {
    const outer = this.currentAnnotation;
    this.currentAnnotation = annotation;
    try {
      return this.emitAnnotatedRoot(prepared, options, annotation);
    } finally {
      this.currentAnnotation = outer;
    }
  }

  private emitAnnotatedRoot(
    prepared: GpuPreparedRoot,
    options: CompilationOptions<Expression>,
    annotation: FragmentAnnotation<GlslRepresentation>
  ): CompilationResult {
    const { expr, target, cseOptions } = prepared;
    const { vars } = options;
    // The emitter reads the annotation in the root scope, and each loop that
    // it writes counts its passes against the cap of the evaluation (the
    // spec, decision 4). The target is the one of this compilation, made by
    // the prepare stage, and every target that the emitter derives from it
    // is a copy that keeps these fields.
    // With no cap (`iterationBudget: Infinity`), no loop counts its passes.
    const budget = glslPassBudget(options.iterationBudget);
    Object.assign(target, {
      fragmentScope: annotation.scope,
      fragmentPassBudget: budget,
    } satisfies FragmentTargetFields<GlslRepresentation>);
    // A statement position: the emitted `code` is a function body, so a
    // loop-form `Sum`/`Product` nested anywhere inside may hoist its loop ahead
    // of the value (Tycho item 110). With nothing hoisted this is byte-identical
    // to a plain `compile()`.
    BaseCompiler.openCseSession(expr, target, {
      enabled: options.cse,
      ...cseOptions,
    });
    // The names that the compiled code writes, which the NaN guard proof
    // does not read by their declared type, and the parameters of the
    // emitted definitions that every call of the shader passes a finite
    // value (`gpuRecordCallSiteFacts`).
    gpuRecordCallSiteFacts(expr, target);
    let code = BaseCompiler.compileCseRoot(expr, target, 0, () =>
      BaseCompiler.compileFunctionBody(expr, target)
    );
    // The pass cap: when a loop of the root or of a user function that it
    // calls counts its passes, the root sets the counter to zero, computes
    // its value, and gives NaN when the loops ran more passes than the cap.
    // The counter is a global of the shader, declared in the preamble.
    const defs = [...(this.currentUserFunctions?.defs.values() ?? [])];
    if (
      budget !== undefined &&
      [code, ...defs].some((c) => c.includes(GPU_PASS_COUNTER))
    )
      code = this.withPassCap(
        code,
        annotation.scope.facts.get(expr),
        budget,
        target
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
    // The operands of an exact sine hash and the range in which its value is
    // exact (`gpuAmplifiedTrigMod`).
    // A sine hash with no exact form compiles to the usual float32 code and
    // is reported in `warnings` (`gpuAmplifiedTrigMod`). Only what the final
    // code and preamble still hold is reported.
    const report = gpuExactTrigReport(target, `${code}\n${preamble ?? ''}`);
    if (report.bounds.length > 0) result.float32Bounds = report.bounds;
    if (report.warnings.length > 0) result.warnings = report.warnings;

    BaseCompiler.withReferences(
      result,
      expr,
      target,
      vars ? new Set(Object.keys(vars)) : undefined
    );
    return result;
  }

  /**
   * The helper-function preamble required by `code` — every `_gpu_*` (and
   * complex/fractal) helper the emission references, in dependency order.
   * Used by `compileOrThrow` (which returns it as `CompilationResult.preamble`
   * for the caller to splice) and by `compileShader` (which splices it into
   * the emitted shader ahead of `main()`, since that route returns a complete
   * shader with no separate preamble channel).
   */
  /**
   * The root code `code` with the pass cap: the counter set to zero first,
   * the value held in a temporary, and NaN in its place when the counter is
   * over `budget`. `facts` are the facts of the root in the annotation, which
   * give the shader type of the temporary.
   */
  private withPassCap(
    code: string,
    facts: ReturnType<
      FragmentAnnotation<GlslRepresentation>['scope']['facts']['get']
    >,
    budget: number,
    target: CompileTarget<Expression>
  ): string {
    const type =
      facts !== undefined && 'representation' in facts
        ? facts.representation
        : undefined;
    if (
      type === undefined ||
      type === 'int' ||
      type === 'uint' ||
      type === 'sampler2D'
    )
      throw new Error(
        `Could not compile: the value of the expression has no ` +
          `${this.languageId.toUpperCase()} type that the pass cap can hold.`
      );
    const lines = code.split('\n');
    const last = lines.pop()!;
    const value =
      lines.length === 0 ? code : /^return (.*);$/s.exec(last.trim())?.[1];
    if (value === undefined)
      throw new Error(
        `Could not compile: the code of the expression does not end with ` +
          `its value, so the pass cap cannot test it.`
      );
    const result = BaseCompiler.tempVar(target);
    return [
      `${GPU_PASS_COUNTER} = 0;`,
      ...lines,
      `${type} ${result} = ${value};`,
      `return ${GPU_PASS_COUNTER} > ${budget} ? ${gpuPassCapValue(type)} : ${result};`,
    ].join('\n');
  }

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
    // The counter of the pass cap, a global of the shader, set to zero by
    // the root at the start of each evaluation. It is declared before the
    // user functions, whose loops count their passes too.
    // A guard declares it once in a shader that joins the preambles of two
    // compiled expressions.
    if (code.includes(GPU_PASS_COUNTER))
      preamble +=
        `#ifndef ${GPU_PASS_COUNTER_GUARD}\n` +
        `#define ${GPU_PASS_COUNTER_GUARD}\n` +
        `int ${GPU_PASS_COUNTER} = 0;\n` +
        `#endif\n`;
    // A complex helper can call `_gpu_inf()` from its body (`_gpu_casech` at
    // z = 0). GLSL requires a declaration before its use, so the GLSL
    // Infinity helper then goes BEFORE the complex helpers.
    const complexPreamble = buildComplexPreamble(code);
    const complexUsesInf = complexPreamble.includes('_gpu_inf(');
    if (complexUsesInf) preamble += GPU_INF_PREAMBLE_GLSL;
    preamble += complexPreamble;
    // NaN and +∞ are spelled `_gpu_nan()` / `_gpu_inf()`. Both helpers are
    // built from the ES 3.00 `intBitsToFloat` this target
    // already assumes, and must be declared before their first use, so they
    // are emitted here, ahead of every helper that calls them.
    //
    // The `_gpu_at*` positional-access helpers call `_gpu_nan()` from their
    // BODIES, which these scans never see — they read the EMITTED code, never
    // a helper body — so an `At` lowering FORCES the GLSL NaN helper: a
    // compilation whose code contains only `_gpu_at3(…)` must still get it.
    const atWidths = gpuAtHelperWidths(code);
    const atPointShapes = gpuAtPointHelperShapes(code);
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
    // `_gpu_digamma`, `_gpu_trigamma` and `_gpu_polygamma` call `_gpu_nan()`
    // and `_gpu_inf()` from their bodies (at -inf and at a pole).
    const usesPolygamma = /_gpu_(di|tri|poly)gamma\(/.test(code);
    if (
      code.includes('_gpu_nan') ||
      atWidths.length > 0 ||
      atPointShapes.length > 0 ||
      texAtWidths.length > 0 ||
      usesZeta ||
      usesLerch ||
      usesPolygamma
    )
      preamble += GPU_NAN_PREAMBLE_GLSL;
    // `_gpu_gamma` calls `_gpu_inf()` from its BODY at a pole (the float
    // projection of the interpreter's undirected infinity — pole-encoding
    // ruling 2026-08-28), so it forces the GLSL Infinity helper for the same
    // reason `_gpu_at*` forces the NaN helper: these scans read the EMITTED
    // code and never a helper body. The zeta helpers call `_gpu_inf()` at
    // their own pole the same way, and `_gpu_lerch_phi` at its own pole (a
    // non-positive integer a with s > 0). So do the hyperbolic functions of
    // `iπu` (`_gpu_ipi_csch` and the others) and `_gpu_tanpi` at a pole.
    if (
      !complexUsesInf &&
      (code.includes('_gpu_inf') ||
        code.includes('_gpu_gamma') ||
        /_gpu_ipi_\w+\(/.test(code) ||
        code.includes('_gpu_tanpi') ||
        usesZeta ||
        usesLerch ||
        usesPolygamma)
    )
      preamble += GPU_INF_PREAMBLE_GLSL;
    // AFTER the NaN branches, and that ORDER is load-bearing: GLSL requires a
    // declaration before its use, and these bodies call `_gpu_nan()`. The
    // order test in `at-gpu-compile.test.ts` is the tripwire.
    for (const w of atWidths) preamble += gpuAtPreamble(w);
    for (const [m, n] of atPointShapes) preamble += gpuAtPointPreamble(m, n);
    // The texture helpers call `_gpu_nan()` too, so the same order rule
    // applies. GLSL declares one per length.
    for (const w of texAtWidths) preamble += gpuTexAtPreamble(w);
    // The scalar `_gpu_powi` and its per-width `vecN` overloads
    // (`_gpu_powi2`–`_gpu_powi4`) are declared independently: a compilation
    // that only powers a vector needs the vector form alone.
    preamble += gpuFixedPowerPreamble(code);
    for (const form of gpuPowiHelperForms(code))
      preamble +=
        form === 'scalar' ? GPU_POWI_PREAMBLE_GLSL : gpuPowiVecPreamble(form);
    preamble += gpuLibrarySubset(code, GPU_FLOOR_MOD_PREAMBLE_GLSL);
    preamble += gpuLibrarySubset(code, GPU_NAN_SAFE_PREAMBLE_GLSL);
    // Every library goes through `gpuLibrarySubset`, which keeps only the
    // definitions this compilation names and the ones those call. A shader
    // preamble is compiled by the driver once per program, so an unused
    // definition costs first-draw time on every program that carries it.
    preamble += gpuLibrarySubset(code, GPU_ROUND_PREAMBLE_GLSL);
    preamble += gpuLibrarySubset(code, GPU_PI_TRIG_PREAMBLE_GLSL);
    // The exact sine hash (`gpu-exact-trig.ts`).
    preamble += gpuLibrarySubset(code, GPU_EXACT_TRIG_PREAMBLE_GLSL);
    // `_gpu_zeta` calls `_gpu_gamma` from its own body for the s < 0
    // functional-equation branch, and every other zeta entry point
    // (`_gpu_hurwitz_zeta`, `_gpu_zeta_generalized`) can reach `_gpu_zeta`
    // — the same "scan reads emitted code, not helper bodies" gap
    // `_gpu_gamma`'s `_gpu_inf()` call has above, so force Γ's preamble in
    // whenever any zeta (or, transitively through it, Lerch) helper is
    // needed.
    preamble += gpuLibrarySubset(
      usesZeta || usesLerch ? `${code} _gpu_gamma(` : code,
      GPU_GAMMA_PREAMBLE_GLSL
    );
    // AFTER the NaN and Infinity helpers, which the three bodies call.
    preamble += gpuLibrarySubset(code, GPU_POLYGAMMA_PREAMBLE_GLSL);
    // `_gpu_lerch_phi` calls `_gpu_zeta_pow` and `_gpu_hurwitz_zeta` from
    // its own body without naming them in the emitted code (only
    // `_gpu_lerch_phi` itself appears there), the same gap as above — force
    // both names in so the subset scan pulls their definitions in too.
    preamble += gpuLibrarySubset(
      usesLerch ? `${code} _gpu_zeta_pow( _gpu_hurwitz_zeta(` : code,
      GPU_ZETA_PREAMBLE_GLSL
    );
    // AFTER the zeta preamble: `_gpu_lerch_phi` calls `_gpu_zeta_pow` and
    // `_gpu_hurwitz_zeta`, and GLSL requires their declaration first.
    preamble += gpuLibrarySubset(code, GPU_LERCH_PREAMBLE_GLSL);
    preamble += gpuLibrarySubset(code, GPU_ERF_PREAMBLE_GLSL);
    if (code.includes('_gpu_heaviside'))
      preamble += GPU_HEAVISIDE_PREAMBLE_GLSL;
    if (code.includes('_gpu_sinc')) preamble += GPU_SINC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnel')) preamble += GPU_POLEVL_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelC')) preamble += GPU_FRESNELC_PREAMBLE_GLSL;
    if (code.includes('_gpu_fresnelS')) preamble += GPU_FRESNELS_PREAMBLE_GLSL;
    preamble += gpuLibrarySubset(code, GPU_BESSELJ_PREAMBLE_GLSL);
    // A Mandelbrot row carried the Julia iteration and a Julia row carried the
    // Mandelbrot one before the per-function pass.
    preamble += gpuLibrarySubset(code, GPU_FRACTAL_PREAMBLE_GLSL);
    if (code.includes('_gpu_rnd_draw')) {
      // One invocation-local u32 counter per frame (plus one shared by the
      // unframed spatial-noise draws). A shader global is per-invocation and initialized before the entry point runs, so
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
      preamble += '\n' + counters.map((n) => `uint ${n} = 0u;\n`).join('');
      preamble += gpuLibrarySubset(code, GPU_PCG3D_PREAMBLE_GLSL);
    }
    // A shader that calls only `_gpu_gcd` does not carry `_gpu_lcm`; one
    // that calls `_gpu_lcm` also gets `_gpu_gcd`, which its body calls.
    preamble += gpuLibrarySubset(code, GPU_GCD_PREAMBLE_GLSL);
    preamble += gpuLibrarySubset(code, GPU_MEDIAN_PREAMBLE_GLSL);
    // The colour library and the sRGB round trip that calls three of its
    // functions are subset together, so a row that converts one colour space
    // no longer carries the other twelve conversions.
    preamble += gpuLibrarySubset(code, GPU_COLOR_LIBRARY_GLSL);
    if (!userDefs) return preamble;
    return preamble ? `${preamble}\n${userDefs}` : userDefs;
  }

  compileToSource(
    expr: Expression,
    options: CompilationOptions<Expression> = {}
  ): string {
    // The engine's angular unit, in radian-based code, as `compile()` does
    // at its entry: in degree mode `sin(x)` is the sine of `x` degrees.
    expr = rewriteAngularUnit(expr);
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
    // The single-line statement the emitted-source scan below cannot see: a
    // root `Declare` emits a bare declaration (dropping its
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
    const sourceTarget = this.createTargetFor(expr, undefined, {
      userFunctions: undefined,
      constantFold: options.constantFold,
    });
    // A point value is written in place of its symbol, as in `compile()`
    // (`inlinePointValues`).
    const inlined = inlinePointValues(
      expr,
      sourceTarget,
      reachableSymbolNames(expr).written
    );
    // This route has no common-subexpression pass, so a node that several
    // paths reach is written once for each path. A point value written in
    // place of its symbol can hold a deep shared graph, so the size is
    // checked after the substitution, with the limit of `compile()`.
    if (
      inlined !== expr &&
      gpuWrittenSize(inlined, {
        ...cseRecordingRules(inlined),
        share: false,
      }) > GPU_MAX_WRITTEN_NODES
    )
      throw new Error(
        `Could not compile \`compileToSource()\`: the ` +
          `${this.languageId.toUpperCase()} code would have more than ` +
          `${GPU_MAX_WRITTEN_NODES.toLocaleString('en-US')} nodes. A ` +
          `subexpression that several paths reach is written once for each ` +
          `path on this route, which has no common-subexpression pass. ` +
          `Use \`compile()\`, or assign the subexpression to a variable of ` +
          `its own (\`Block\`).`
      );
    // The expression is in the fragment before any code is written. This
    // route has no definition channel, so a call of a user function is
    // outside it.
    const annotation = this.typeDeclaredBody(
      inlined,
      sourceTarget,
      [],
      '`compileToSource()`',
      { userFunctions: false }
    );
    Object.assign(sourceTarget, {
      fragmentScope: annotation.scope,
    } satisfies FragmentTargetFields<GlslRepresentation>);
    const code = this.withAnnotation(annotation, () =>
      BaseCompiler.compile(inlined, sourceTarget)
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
   * folded over the declaration (each declaration's `ref` supplies the
   * identifier to emit).
   *
   * `stageNames` are the other names of the shader that the body can read
   * bare: the `out` variables of a GLSL shader. A free symbol of the body
   * that is not a declaration and not one of these names is refused.
   *
   * `outputs` are the names that a body statement can assign, in the spelling
   * of the emitted source, with their declared types. A GLSL body can also assign the built-in outputs of its stage
   * (`GLSL_STAGE_BUILTIN_OUTPUTS`). A statement whose target is not one of
   * these names, or components of one of them, is refused, and so is a
   * statement whose value has a type that the target does not accept
   * (`gpuAssignmentConverts`). A compute shader has no outputs, so every
   * statement of its body is refused. `desktopGLSLVersion` is the version
   * number of a desktop GLSL shader, which converts integers to floats.
   */
  protected compileShaderBody(
    body: ReadonlyArray<{ variable: string; expression: Expression }>,
    stage: string,
    declarations: ReadonlyArray<GPUShaderDeclaration> = [],
    constantFold?: boolean,
    stageNames: ReadonlyArray<string> = [],
    outputs: ReadonlyArray<{ name: string; type: string }> = [],
    desktopGLSLVersion?: number
  ): Array<{ variable: string; code: string; stmts: string[] }> {
    // The target of each statement is copied as text to the left of
    // `<variable> = <code>;`. A target that names nothing, or a value of
    // another type, gives a shader that fails only when the GPU compiles it,
    // so both are refused here.
    if (stage === 'compute' && body.length > 0)
      throw new Error(
        `Could not compile the body statement "${body[0].variable}" of ` +
          `\`compileShader()\`: a compute shader from \`compileShader()\` ` +
          `cannot write a result. It has no outputs and no storage buffer, ` +
          `so the statement would assign a name that the shader does not ` +
          `declare. To compute values on the GPU, use \`compile()\`.`
      );
    const assignable = [
      ...outputs,
      ...(GLSL_STAGE_BUILTIN_OUTPUTS[stage] ?? []),
    ];
    const targetTypes = body.map((assignment) => {
      const target = gpuShaderAssignmentTarget(assignment.variable, assignable);
      if ('error' in target)
        throw new Error(
          `Could not compile the body statement "${assignment.variable}" ` +
            `of \`compileShader()\`: ${target.error}`
        );
      return target;
    });
    // Put each body expression in the radian convention, as `compileOrThrow`
    // does for a single expression: under a non-radian `angularUnit` the
    // trigonometric calls would otherwise read their argument as radians
    // (CE-282).
    body = body.map((assignment) => ({
      ...assignment,
      expression: rewriteAngularUnit(assignment.expression),
    }));
    // The body statements compile with no common-subexpression pass, so a
    // node that several paths reach is written once for each path, and the
    // code of a deep graph grows exponentially with its depth. The size
    // limit of `compileOrThrow` applies to the whole body, with every node
    // counted once for each path (`gpuWrittenSize`, `gpu-written-size.ts`).
    let bodySize = 0;
    for (const assignment of body)
      bodySize += gpuWrittenSize(assignment.expression, {
        ...cseRecordingRules(assignment.expression),
        share: false,
      });
    if (bodySize > GPU_MAX_WRITTEN_NODES)
      throw new Error(
        `Could not compile \`compileShader()\`: the ` +
          `${this.languageId.toUpperCase()} code of the body statements ` +
          `would have more than ` +
          `${GPU_MAX_WRITTEN_NODES.toLocaleString('en-US')} nodes. A ` +
          `subexpression that several paths reach is written once for each ` +
          `path in a body statement. Assign the subexpression to a variable ` +
          `of its own (\`Block\`).`
      );
    // One name, two declarations (an input AND a uniform) is a redeclaration
    // GLSL does not accept. Fail closed naming the collision (D6).
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
    // A GLSL body reads its outputs and the built-in variables of its stage
    // bare, as it reads its inputs and uniforms, so they are framed with
    // their types too. Without them, `Sin(gl_FragCoord)` read the `vec4` as
    // a float and emitted `_gpu_sin(gl_FragCoord)`. A built-in integer, such
    // as `gl_VertexID`, is then read through a float conversion, as an
    // integer input is (`gpuDeclaredBodyTarget`). They are not inputs or
    // uniforms, so the read-only check below does not apply to them.
    const framed: GPUShaderDeclaration[] = [...declarations];
    for (const d of [
      ...outputs,
      ...Object.entries(GLSL_STAGE_BUILTIN_TYPES[stage] ?? {}).map(
        ([name, type]) => ({ name, type })
      ),
    ])
      if (!seen.has(d.name)) {
        seen.add(d.name);
        framed.push({ name: d.name, type: d.type });
      }
    // ONE naming context for the whole body too, seeded from EVERY statement:
    // the counter must stay distinct across statements (same reason as the
    // random counters), and a `_tv`-named symbol in any statement is a
    // collision for all of them. The caller-supplied assignment TARGETS are
    // seeded as source text as well: a hoisted loop declares its accumulator
    // ahead of the assignment, so a shader output spelled `_tv1` would
    // otherwise be shadowed and left unwritten (`_tv1 = _tv1`).
    const rawTarget = this.createTargetFor(body[0]?.expression, stage, {
      constantFold,
      naming: BaseCompiler.newNamingContext(
        body.map((a) => a.expression),
        body.map((a) => a.variable)
      ),
    });
    // The names that reach the raw target's `var()` with no answer while the
    // statements compile. A bound name (a parameter, a temporary, a loop
    // index) is answered by an inner scope before it gets here, and a
    // declaration by `gpuDeclaredBodyTarget`. Such a name is either folded (a
    // symbol with a value) or written bare. The recorder is on the raw target
    // itself, not on a copy: the body of a user function compiles on a copy
    // of this object (the registry root), so its names get here too. The
    // free-symbol check below refuses only a name that is also in this set:
    // an operand that the emitter drops (`x^0` is `1.0`) is not compiled, so
    // its symbols never get here.
    const unanswered = new Set<string>();
    let recording = false;
    const rawVar = rawTarget.var.bind(rawTarget);
    rawTarget.var = (id) => {
      const ref = rawVar(id);
      if (recording && ref === undefined) unanswered.add(id);
      return ref;
    };
    const target = gpuDeclaredBodyTarget(rawTarget, framed);
    // The names that the shader declares (its inputs, uniforms and outputs,
    // the built-in variables of a GLSL stage, and the names of the stage).
    // A body that reads one of them reads the declaration. So a point value
    // that mentions one is not written in place of its symbol, and a callee
    // body whose free symbol is one of them is not inlined: the declaration
    // would capture the name, which the stored value or body reads as the
    // engine symbol.
    const shaderNames = new Set([...framed.map((d) => d.name), ...stageNames]);
    // The body expressions after the point values and the point calls are
    // written in place, by statement. The type and width checks of each
    // statement and the reference analysis below read these expressions,
    // because the code is compiled from them.
    const inlined: Expression[] = [];
    // The size of the body statements after the substitution. The check
    // above reads the statements as written, and a point value written in
    // place of its symbol can hold a deep shared graph: with `constantFold:
    // false`, no other limit reads the value (`assertFoldableSize()` in
    // `base-compiler.ts` measures a value that is folded as a literal).
    let inlinedSize = 0;
    // Each assignment is a statement position of its own, so a loop-form
    // `Sum`/`Product` inside it hoists its loop into `stmts`, which the shader
    // assembly emits ahead of the assignment (Tycho item 110). The whole body
    // compiles under the shader's declared shapes: the declarations are in
    // scope for every statement.
    recording = true;
    const statements = BaseCompiler.withLocalShapeFrame(
      new Map(),
      gpuDeclaredShapeFrame(framed),
      () =>
        body.map((assignment, i) => {
          // Same single-line holes as `compileToSource()`: `code` lands on the
          // right of `${variable} = …;`, where a declaration is not an
          // expression. Checked on the
          // body, before it is compiled.
          gpuAssertExpressionBody(
            `compileShader() body statement "${assignment.variable}"`,
            assignment.expression,
            this.languageId
          );
          // A declared input or uniform is read-only (a GLSL `uniform` or
          // `in` variable), so `x = x + 1.0;` is not valid source. The
          // test is on the expression and is conservative: an assignment to a
          // block local that has the same name as a declaration also
          // declines.
          const written = gpuAssignedName(
            assignment.expression,
            new Set(declarations.map((d) => d.name))
          );
          if (written !== undefined)
            throw new Error(
              `Could not compile the body statement "${assignment.variable}" of ` +
                `\`compileShader()\`: it assigns "${written}", a declared ` +
                `input or uniform of the shader, which is read-only in ` +
                `${this.languageId.toUpperCase()}. Assign a local copy of it ` +
                `instead (\`Block(y ≔ ${written}; y ≔ y + 1; y)\`).`
            );
          // A point value is written in place of its symbol, as in
          // `compile()` (`inlinePointValues`).
          BaseCompiler.beginRootPreprocessing(assignment.expression, target);
          const expression = inlinePointValues(
            inlinePointCalls(
              assignment.expression,
              target,
              { scalarNames: new Set<string>(), localNames: shaderNames },
              gpuPointCallsOverBudget
            ),
            target,
            new Set([
              ...shaderNames,
              ...reachableSymbolNames(assignment.expression).written,
            ])
          );
          inlined[i] = expression;
          // The statement is in the fragment, with the declarations of the
          // shader as its inputs, before its code is written.
          const annotation = this.typeDeclaredBody(
            expression,
            target,
            framed,
            `the body statement "${assignment.variable}" of \`compileShader()\``
          );
          inlinedSize += gpuWrittenSize(expression, {
            ...cseRecordingRules(expression),
            share: false,
          });
          if (inlinedSize > GPU_MAX_WRITTEN_NODES)
            throw new Error(
              `Could not compile \`compileShader()\`: the ` +
                `${this.languageId.toUpperCase()} code of the body ` +
                `statements would have more than ` +
                `${GPU_MAX_WRITTEN_NODES.toLocaleString('en-US')} nodes. A ` +
                `subexpression that several paths reach is written once for ` +
                `each path in a body statement. Assign the subexpression to ` +
                `a variable of its own (\`Block\`).`
            );
          // The one target of the body carries the scope of the statement
          // that it compiles.
          Object.assign(target, {
            fragmentScope: annotation.scope,
          } satisfies FragmentTargetFields<GlslRepresentation>);
          const compiled = this.withAnnotation(annotation, () =>
            BaseCompiler.compileStatementBody(expression, target)
          );
          const { stmts } = compiled;
          let { code } = compiled;
          // `stmts` are hoisted STATEMENTS and the assembly emits them ahead of
          // the assignment, so they are legal. `code` is not: it lands on the
          // right of `${variable} = …;`, an expression position (D6).
          gpuAssertExpressionOnly(
            `compileShader() body statement "${assignment.variable}"`,
            code,
            this.languageId
          );
          // The value must have the type of the target. The test is made only
          // when both types are known: the type of the value only when it is
          // certain (`gpuCertainValueType`), so that a valid shader is never
          // refused, and the type of the target only when it is a scalar or
          // a vector type.
          const to = targetTypes[i].type;
          // A statement whose value is an integer scalar name (an input, a
          // uniform or a built-in such as `gl_VertexID`) assigned to an
          // integer target is written with the integer itself: the float
          // conversion that reads such a name in float arithmetic
          // (`gpuDeclaredBodyTarget`) would give a float, which the target
          // does not accept. Its type is then the integer type of the name.
          const value = expression;
          const integerName = isSymbol(value)
            ? framed.find((d) => d.name === value.symbol)
            : undefined;
          const integerType =
            integerName === undefined
              ? undefined
              : gpuNormalizeShaderType(integerName.type);
          const keepsInteger =
            to !== undefined &&
            to.element !== 'f' &&
            integerType !== undefined &&
            gpuDeclaredIsIntegerScalar(integerType);
          const from = keepsInteger ? integerType : gpuCertainValueType(value);
          // When the type of the value is not certain, the number of its
          // components can still be known: the width that the emitter gives
          // a vector expression (`aggregateComponentCount`), such as 3 for
          // `2·uv` with `vec3 uv`. A value of another width than the target
          // is refused, because nothing would assign the other components.
          const width =
            from === undefined
              ? BaseCompiler.aggregateComponentCount(value)
              : undefined;
          const subject = (valueType: string) =>
            `Could not compile the body statement "${assignment.variable}" ` +
            `of \`compileShader()\`: the value ${valueType}, and the target ` +
            `"${assignment.variable}" has the type ` +
            `\`${gpuSpellValueType(to!)}\`.`;
          const noConversion =
            `${this.languageId.toUpperCase()} does not convert the one to ` +
            `the other in an assignment. Give the value the type of the ` +
            `target, or declare the output with the type of the value.`;
          if (
            to !== undefined &&
            width !== undefined &&
            width > 0 &&
            width !== to.width
          )
            throw new Error(
              `${subject(`has ${width} components`)} ${noConversion}`
            );
          if (
            keepsInteger &&
            gpuAssignmentConverts(integerType!, to!, desktopGLSLVersion)
          )
            code = integerName!.name;
          else if (
            to !== undefined &&
            from !== undefined &&
            (!('element' in from) ||
              !gpuAssignmentConverts(from, to, desktopGLSLVersion))
          ) {
            const valueType = `has the type \`${
              'element' in from ? gpuSpellValueType(from) : from.spelling
            }\``;
            // Every scalar that the shader computes is a float, so an
            // integer output can receive only an integer name or an integer
            // vector input or uniform.
            if ('element' in from && from.element === 'f' && to.element !== 'f')
              throw new Error(
                `${subject(valueType)} \`compileShader()\` computes float ` +
                  `values, and cannot assign an integer output. Declare the ` +
                  `output with a float type ` +
                  `(\`${gpuSpellValueType({ element: 'f', width: to.width })}\`).`
              );
            throw new Error(`${subject(valueType)} ${noConversion}`);
          }
          return { variable: assignment.variable, code, stmts };
        })
    );
    recording = false;
    // A free symbol of the body is emitted as a bare identifier. This route returns a
    // complete shader, so only the shader's own inputs and uniforms, and the
    // names the stage itself declares (`stageNames`), are in scope there. Any
    // other free symbol names nothing, and the shader fails when the GPU
    // compiles it. A symbol with a value in the engine, a library constant
    // (`Pi`), a bound variable (a `Sum` index, a function-literal parameter,
    // a `Block` local) and a user function are not free symbols. A GLSL
    // built-in variable of the stage (`GLSL_STAGE_BUILTINS`) is in scope too;
    // another `gl_` name (a typing error, or a built-in of another stage) is
    // not. The check
    // runs after the statements compile, so that an error in the form of a
    // statement is reported first.
    const inScope = new Set([
      ...declarations.map((d) => d.name),
      ...stageNames,
    ]);
    // The declared names are passed as external inputs: the body reads a
    // declaration, not the engine value or the user function of the same
    // name, so the analysis must not go into that value or function body.
    const undeclared = new Set<string>();
    for (const expression of inlined)
      for (const name of BaseCompiler.analyzeReferences(
        expression,
        target,
        inScope
      ).freeSymbols)
        if (
          !inScope.has(name) &&
          !(
            this.languageId === 'glsl' &&
            GLSL_STAGE_BUILTINS[stage]?.has(name) === true
          ) &&
          unanswered.has(name)
        )
          undeclared.add(name);
    if (undeclared.size > 0)
      throw new Error(
        `Could not compile \`compileShader()\`: the body reads ` +
          `${[...undeclared].map((n) => `"${n}"`).join(', ')}, which no ` +
          `input or uniform of the shader declares. The emitted ` +
          `${this.languageId.toUpperCase()} would read an undeclared name. ` +
          `Declare each name as an input or a uniform, or assign it a value.`
      );
    return statements;
  }
}
