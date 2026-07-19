import type {
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import {
  isFiniteIndexedCollection,
  isNumericTuple,
  isPossiblyCollectionTyped,
} from '../collection-utils.js';
import {
  collectionElementType,
  isNonRealNumber,
} from '../../common/type/utils.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { normalizeIndexingSet } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
  isDictionary,
  isTensor,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { isWildcard } from '../boxed-expression/pattern-utils.js';
import {
  getMatchPlan,
  matchPatternReferences,
} from '../boxed-expression/match-dispatch.js';
import type {
  CompiledCase,
  Segment,
  ShapeNode,
  ElementPlan,
} from '../boxed-expression/match-dispatch.js';

import type {
  CompileTarget,
  CompilationResult,
  CompiledRunner,
  TargetSource,
} from './types.js';

/**
 * Compile-time guard around `isPossiblyCollectionTyped`. A `broadcastable<T>`
 * operand is an explicit declared type, reliable on any node. A top-typed
 * APPLICATION (`unknown`/`any`/`value` call), however, is only a genuine
 * possibly-collection signal when the node is BOUND: an UNBOUND (non-canonical,
 * non-structural) arithmetic subexpression — e.g. the `{ canonical: false }`
 * grouping-preservation path (P0-45), where binding is skipped — types
 * `unknown` merely because it was never bound, not because its collection-ness
 * is unknown. Admitting those would misroute plain scalar arithmetic through
 * `_SYS.bcast` / the fail-closed guard, so require the application to be bound.
 */
function isBoundPossiblyCollectionTyped(a: Expression): boolean {
  if (!isPossiblyCollectionTyped(a)) return false;
  const t = a.type.type;
  if (typeof t !== 'string' && t.kind === 'broadcastable') return true;
  return a.isCanonical || a.isStructural;
}

/**
 * Base compiler class containing language-agnostic compilation logic
 */
export class BaseCompiler {
  /**
   * Precedence used when compiling a folded symbol value. Higher than any
   * target's infix operator precedence, so a compound value parenthesizes
   * itself when spliced into a surrounding expression. See
   * `tryFoldKnownSymbol`.
   */
  private static readonly FOLD_OPERAND_PREC = 1000;

  /**
   * Operator heads that are word-spelled infix/prefix **keywords** in some
   * targets (Python `and` / `or` / `not`), never function calls. The alphabetic
   * op-string of these heads must NOT be treated as a function-call name — that
   * would emit `and(a, b)` (a Python SyntaxError). This is distinct from a user
   * override that intentionally maps an operator to a function name (e.g.
   * `Add: ['add', 11]` → `add(x, y)`): those heads are not in this set.
   */
  private static readonly WORD_KEYWORD_OPERATORS: ReadonlySet<string> = new Set(
    ['And', 'Or', 'Not']
  );

  /**
   * Structural / control-flow heads that `compileExpr` special-cases directly
   * (their own bespoke lowering — loops, conditionals, blocks, sequences,
   * bindings). A user operator definition's custom `compile` handler does NOT
   * override these: their compilation is not a simple operand-wise call and a
   * handler cannot express it. Every OTHER head — including operator-mapped
   * arithmetic/relational heads and function-mapped heads — IS overridable by
   * a custom handler (see the handler consult in `compileExpr`, finding A5).
   */
  private static readonly CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
    'Sequence',
    'Sum',
    'Product',
    'Function',
    'Declare',
    'Assign',
    'Return',
    'Break',
    'Continue',
    'Loop',
    'Comprehension',
    'If',
    'Which',
    'When',
    'Match',
    'Block',
  ]);

  /**
   * Operator symbols that lower to a valid *binary infix* lambda
   * (`(a, b) => a ∘ b`) when a bare operator symbol is used in value position —
   * a first-class function such as a `Reduce` combiner. Only the binary
   * arithmetic operators qualify: a unary operator (Negate/Not) would emit
   * wrong-arity or invalid source (e.g. `(a, b) => a ! b`), and a relational or
   * logical operator folds to a boolean that silently diverges from the
   * interpreter. Any operator symbol NOT in this set fails closed (D6) so the
   * engine falls back to the interpreter rather than emitting garbage behind
   * `success: true`. Keyed by symbol (not operator glyph) so it is
   * target-agnostic.
   */
  private static readonly BINARY_INFIX_VALUE_OPERATORS: ReadonlySet<string> =
    new Set(['Add', 'Subtract', 'Multiply', 'Divide']);

  /**
   * Compile `expr` as a **value operand** — a sub-expression spliced into a
   * surrounding expression. Behaves like `compile`, but on targets whose
   * multi-statement constructs are bare statement sequences
   * (`target.bareStatementBlocks`, i.e. GLSL/WGSL), it **fails closed** (D6)
   * when the operand compiled to such a block. A shader has no expression-level
   * loop/IIFE, so a loop-form `Sum`/`Product`/`Loop`/`Block` cannot be a
   * sub-expression; splicing it would emit invalid source (e.g.
   * `return _acc; + 1.0`). The offending head is named in the error, which the
   * engine-level `compile()` surfaces via `success: false` + `unsupported`.
   */
  static compileValueOperand(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    const code = BaseCompiler.compile(expr, target, prec);
    if (
      target.bareStatementBlocks &&
      typeof code === 'string' &&
      code.includes('\n')
    ) {
      const head = expr !== undefined && isFunction(expr) ? expr.operator : '?';
      throw new Error(
        `${head}: a multi-statement construct (loop-form Sum/Product, Loop, or Block) ` +
          `cannot be used as a sub-expression in "${target.language ?? 'this'}" ` +
          `— it is only valid as a top-level function body. Fail closed (D6).`
      );
    }
    return code;
  }

  /**
   * Compile an expression to target language source code
   */
  static compile(
    expr: Expression | undefined,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    if (expr === undefined) return '';
    if (!expr.isValid) {
      throw new Error(
        `Cannot compile invalid expression: "${expr.toString()}"`
      );
    }
    // Keep the compile-bound-variables context in sync for the contextless
    // analysis helpers (`isComplexValued`): every recursive compilation flows
    // through here with the innermost target, so the static always reflects
    // the names currently shadowing the engine (loop indices, lambda
    // parameters, broadcast elements).
    const prevBoundCtx = BaseCompiler._boundVarsCtx;
    BaseCompiler._boundVarsCtx = target.boundVars ?? prevBoundCtx;
    try {
      return BaseCompiler._compileInner(expr, target, prec);
    } finally {
      BaseCompiler._boundVarsCtx = prevBoundCtx;
    }
  }

  /** The innermost compile target's `boundVars`, synced by `compile()`. */
  private static _boundVarsCtx: ReadonlySet<string> | undefined;

  private static _compileInner(
    expr: Expression,
    target: CompileTarget<Expression>,
    prec = 0
  ): TargetSource {
    // Is it a symbol?
    if (isSymbol(expr)) {
      const s = expr.symbol;
      const op = target.operators?.(s);
      if (op !== undefined) {
        // A bare operator symbol used in value position (a first-class function
        // — e.g. a `Reduce` combiner or `Map` mapper). Only genuinely binary
        // arithmetic operators lower to a valid binary infix lambda; unary
        // (Negate/Not), relational, and logical operator symbols fail closed
        // (D6) so the engine falls back to the interpreter instead of emitting
        // wrong-arity, invalid, or silently-diverging source (finding: Reduce/
        // Map over-accepted any operator symbol as a combiner/mapper).
        if (!BaseCompiler.BINARY_INFIX_VALUE_OPERATORS.has(s))
          throw new Error(
            `${s}: cannot compile as a first-class function — only the binary ` +
              `arithmetic operators (Add/Subtract/Multiply/Divide) lower to a ` +
              `combiner lambda. Fail closed (D6).`
          );
        // We're compiling something like "Add"
        return `(a,b) => a ${op[0]} b`;
      }
      const resolved = target.var?.(s);
      // A bare symbol naming a user-defined function, used in value position (a
      // higher-order operand such as `Map(list, f)` / `Filter(list, f)`),
      // resolves to the shared emitted local `_fn_f` — the same definition the
      // call-site path emits — rather than a dangling `_.f`. But two kinds of
      // symbol must NOT be captured this way, or a same-named user function
      // would silently shadow them:
      //   - a **bound** name (a parameter / block local / loop index): the
      //     enclosing binding form's `var` override resolves it to the bare
      //     identifier (`resolved === s`), whereas the base resolver only ever
      //     emits `_.<s>`, a constant, or a mapped literal — so `resolved === s`
      //     uniquely identifies a bound name;
      //   - a **`vars`-mapped** key: the caller's external-input contract, which
      //     always wins (see `CompileTarget.vars`).
      const registry = target.userFunctions;
      // A name is bound when an enclosing binding form recorded it in
      // `boundVars` (lambda param, Sum/Product/Loop index, Block local,
      // comprehension var, Match capture). `resolved === s` is kept as an
      // additional signal for binding forms that resolve a bound name to its
      // own bare identifier (the common loop path) and is harmless — the base
      // resolver never returns a bare identifier for a free user-function
      // symbol (it returns `_.<s>`). The explicit `boundVars` set covers the
      // cases where a binding form resolves the name to NON-identity code
      // (an unrolled-Sum numeric literal, an interval `_IA.point(i)` wrap, a
      // Match `subject[i]` accessor), which `resolved === s` misses (A2).
      const isBoundOrMapped =
        resolved === s ||
        target.boundVars?.has(s) === true ||
        target.varsKeys?.has(s) === true;
      if (registry && !isBoundOrMapped && !registry.misses?.has(s)) {
        const userFn = BaseCompiler.ensureUserFunctionEmitted(
          expr.engine,
          s,
          target
        );
        if (userFn !== undefined) return userFn;
        // Memoize the negative lookup so a repeated free symbol doesn't re-hit
        // `lookupDefinition` on every occurrence during this compile.
        (registry.misses ??= new Set()).add(s);
      }
      if (resolved !== undefined) return resolved;
      // The target did not resolve the symbol (no `vars` mapping, constant, or
      // free-symbol plumbing). Before falling back to a bare reference — which
      // is a dangling identifier for a symbol the engine actually knows — fold
      // an assigned value / declared constant, matching `evaluate()`. This also
      // covers the direct-target `compile(expr, { target })` path, where the
      // raw target has no engine context of its own.
      const folded = BaseCompiler.tryFoldKnownSymbol(expr.engine, s, target);
      if (folded !== undefined) return folded;
      // Genuinely free symbol: emit its bare identifier. Give the target a
      // chance to mangle it or fail closed (D6) — e.g. a GLSL/WGSL reserved
      // keyword used as a variable name would emit invalid shader source.
      return target.mangleId ? target.mangleId(s) : s;
    }

    // Is it a number?
    if (isNumber(expr)) {
      if (expr.im !== 0) {
        if (!target.complex)
          throw new Error('Complex numbers are not supported by this target');
        return target.complex(expr.re, expr.im);
      }
      const code = target.number(expr.re);
      // A negative numeric literal (e.g. `-2`) has a leading unary minus, so it
      // must be parenthesized wherever a unary `Negate(...)` would be: when
      // spliced as an operand that binds tighter than unary negation. Otherwise
      // Python `Power(-2, x)` emits `-2 ** x`, which parses as `-(2 ** x)`
      // (sign-flipped). Mirror the Negate operator's own `op[1] < prec` wrap.
      if (expr.re < 0) {
        const negPrec = target.operators?.('Negate')?.[1] ?? 14;
        if (negPrec < prec) return `(${code})`;
      }
      return code;
    }

    // Is it a string?
    if (isString(expr)) {
      return target.string(expr.string);
    }

    // It must be a function expression...
    if (!isFunction(expr))
      throw new Error(`Cannot compile expression: "${expr.toString()}"`);
    return BaseCompiler.compileExpr(
      expr.engine,
      expr.operator,
      expr.ops,
      prec,
      target
    );
  }

  /**
   * Compile a function expression
   */
  static compileExpr(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    prec: number,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (h === 'Error') throw new Error('Error');

    if (h === 'Sequence') {
      if (args.length === 0) return '';
      return `(${args
        .map((arg) => BaseCompiler.compile(arg, target, prec))
        .join(', ')})`;
    }

    if (h === 'Sum' || h === 'Product') {
      // Delegate to target-specific function handler if available,
      // otherwise fall back to the generic loop compilation.
      const sumProdFn = target.functions?.(h);
      if (typeof sumProdFn === 'function') {
        return sumProdFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      }
      if (typeof sumProdFn === 'string') {
        return `${sumProdFn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      return BaseCompiler.compileLoop(h, args, target);
    }

    // A user operator definition may supply its own target-aware compile
    // handler (the public per-operator compilation extension point). It is
    // consulted HERE — before the target's built-in operator mappings, the
    // broadcast lowering, and the broadcast fail-closed guard — so an explicit
    // handler is an explicit opt-in that takes precedence over the built-in
    // lowering, even for an operator-mapped head (e.g. a custom-tolerance `GCD`
    // or a re-mapped `Add`). Structural/control-flow heads
    // (`CONTROL_FLOW_HEADS`: Sum/Product/If/Which/When/Match/Block/Function/
    // Loop/Comprehension/Sequence, …) are handled by their own bespoke lowering
    // and are NOT overridable. A handler that returns `undefined`/`null` OR an
    // empty string falls through to the default compilation (finding A5).
    if (!BaseCompiler.CONTROL_FLOW_HEADS.has(h)) {
      const customDef = engine.lookupDefinition(h);
      if (
        isOperatorDef(customDef) &&
        typeof customDef.operator.compile === 'function'
      ) {
        const custom = customDef.operator.compile(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          { language: target.language ?? 'javascript' }
        );
        if (custom !== undefined && custom !== null && custom !== '')
          return custom;
      }
    }

    // Element-wise broadcast of a `broadcastable` head (arithmetic + unary
    // math) over one or more list-valued operands, for the JavaScript target.
    // Emits a `_SYS.bcast` call wrapping the head's own scalar codegen — see
    // `tryCompileBroadcast`. Other targets have native vector types (GLSL/WGSL
    // `vec3 + vec3`) or their own broadcasting, so this is JavaScript-only.
    if (target.language === 'javascript') {
      const broadcast = BaseCompiler.tryCompileBroadcast(
        engine,
        h,
        args,
        target
      );
      if (broadcast !== null) return broadcast;
    }

    // A broadcastable head with a list/collection-typed operand that
    // `tryCompileBroadcast` did NOT handle would otherwise fall through to the
    // legacy scalar path and silently return garbage behind a `success: true`.
    // Two cases reach here:
    //   - Arithmetic (`SCALAR_ARITHMETIC_HEADS`): the built-in symbolic lowering
    //     emits element-wise-impossible JS (`[1,2,3] + x` → the *string*
    //     "1,2,31"; `list * scalar` → NaN), and a complex-valued list is
    //     declined by the broadcast closure (can't carry complex scalar
    //     codegen).
    //   - Any *other* broadcastable numeric head that is *string*-mapped to a
    //     scalar helper with no array codegen (`Arctan2` → `Math.atan2`,
    //     `Hypot` → `Math.hypot`, `Sinc` → `_SYS.sinc`): handed an array it
    //     returns `NaN`/`null`. These are not in `SCALAR_ARITHMETIC_HEADS`, so
    //     without this widened net they escape the guard entirely.
    // Fail closed (D6) with the offending head so the engine-level `compile()`
    // reports `success: false` and falls back to the interpreter (which
    // broadcasts correctly).
    //
    // Deliberately narrow, to avoid false positives on genuinely supported list
    // forms:
    //   - GLSL/WGSL/GPU targets have native vector types (`vec3 + vec3`), so the
    //     guard is scoped to `javascript` only.
    //   - Relational (`Equal`/`Less`/…) and logical (`And`/`Or`/…) heads are
    //     excluded — they return booleans and are handled by their own codegen
    //     (`compileJSEquality` fails closed on collection operands).
    //   - A user `operators` override that lowers the head to a *function call*
    //     (an identifier like `add`, not a symbolic infix `+`) takes
    //     responsibility for list operands (Issue #240) — only the built-in
    //     symbolic lowering (`+`, `*`, `_SYS.pow`) produces garbage.
    //   - A unary broadcast over a single *concrete* finite indexed collection
    //     whose head has *function* codegen (`-[1,2,3]`, `\sqrt{[1,4,9]}`) is
    //     handled below via `.map` (a string-mapped unary head has no such
    //     path, so it must fail closed).
    // The operand check is type-based (not just `isCollection`) so a symbolic
    // list *parameter* fails closed too, rather than silently emitting garbage.
    // It also matches a possibly-collection-typed operand
    // (`isPossiblyCollectionTyped`: a `broadcastable<T>` node or a top-typed
    // application). After the F1 widening, most such operands compile through
    // `_SYS.bcast` and never reach here; the residue that `tryCompileBroadcast`
    // DECLINED — the `Multiply` ≥2-arrayish carve-out, a complex-element
    // deferral, or a head with no function codegen — would otherwise fall
    // through to scalar codegen and return array garbage behind `success:true`,
    // so it must fail closed too.
    if (target.language === 'javascript') {
      const def = engine.lookupDefinition(h);
      const isBroadcastableHead =
        BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) ||
        (isOperatorDef(def) &&
          def.operator.broadcastable === true &&
          !isRelationalOperator(h) &&
          !BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h));
      if (
        isBroadcastableHead &&
        args.some(
          (a) =>
            a.isCollection ||
            a.type.matches('list') ||
            a.type.matches('indexed_collection') ||
            isBoundPossiblyCollectionTyped(a)
        )
      ) {
        const opMap = target.operators?.(h);
        const lowersToScalarInfix =
          opMap === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
        const isUnaryBroadcast =
          args.length === 1 &&
          isOperatorDef(def) &&
          def.operator.broadcastable === true &&
          typeof target.functions?.(h) === 'function' &&
          isFiniteIndexedCollection(args[0]);
        if (lowersToScalarInfix && !isUnaryBroadcast)
          throw new Error(
            `${h}: cannot compile scalar arithmetic over a list-valued operand — the JavaScript compile target has no list-arithmetic support. Fail closed (D6). Materialize the list with evaluate() and compile a scalar element function instead.`
          );
      }
    }

    // Python target: arithmetic over a collection-typed or possibly-collection
    // operand (a concrete/declared `list`/`indexed_collection`, a
    // `broadcastable<T>`, or a top-typed application such as `h(x)` — the same
    // operand predicate as the JS D6 guard above) cannot be compiled soundly.
    // Python's arithmetic operators do NOT broadcast a plain
    // `list`: `2 * [1, 2]` REPEATS (`[1, 2, 1, 2]`), `[1, 2] - 1` raises — both
    // diverge from the interpreter's element-wise result (`[2, 4]` / `[0, 1]`).
    // A NumPy array WOULD broadcast, but the compiled artifact cannot constrain
    // what the caller binds, so the outcome is binding-dependent. Unlike the JS
    // target there is no `_SYS.bcast` closure path here (Python's arithmetic
    // heads lower to infix operators, not scalar function codegen), so fail
    // closed (D6) and let the engine fall back to the interpreter, which
    // broadcasts correctly. Only infix-lowering arithmetic heads are affected;
    // element-wise math functions (`Sin` → `np.sin`) broadcast natively over a
    // NumPy array and are left untouched. Bare unknown symbols are NOT
    // possibly-collection-typed, so plain scalar plot bodies are unaffected.
    if (target.language === 'python') {
      const def = engine.lookupDefinition(h);
      const isArithmeticInfixHead =
        BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) ||
        (isOperatorDef(def) &&
          def.operator.broadcastable === true &&
          !isRelationalOperator(h) &&
          !BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h));
      const opMap = target.operators?.(h);
      const lowersToInfix =
        opMap !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
      if (
        isArithmeticInfixHead &&
        lowersToInfix &&
        args.some(
          (a) =>
            a.isCollection ||
            a.type.matches('list') ||
            a.type.matches('indexed_collection') ||
            isBoundPossiblyCollectionTyped(a)
        )
      )
        throw new Error(
          `${h}: cannot compile arithmetic over a possibly-collection-typed operand on the Python target — Python's arithmetic operators repeat/concatenate a list instead of broadcasting element-wise, diverging from the interpreter. Fail closed (D6). Materialize the operand with evaluate() and compile a scalar element function instead.`
        );
    }

    // Handle operators
    const op = target.operators?.(h);

    if (op !== undefined) {
      // Skip infix operators for complex operands — fall through to function dispatch
      const hasComplex = args.some((a) => BaseCompiler.isComplexValued(a));
      if (!hasComplex) {
        // Check if this looks like a function name rather than an operator.
        // Function names are alphanumeric identifiers, operators are symbols.
        // A word-spelled *keyword* operator (Python `and`/`or`/`not`) is
        // alphabetic but still infix/prefix — never a function call — so it is
        // excluded here (otherwise `And(a, b)` would emit `and(a, b)`).
        const isFunction =
          /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(op[0]) &&
          !BaseCompiler.WORD_KEYWORD_OPERATORS.has(h);
        // A word-spelled operator needs a separating space between the keyword
        // and its operand (`not x`, `a and b`); a symbolic one does not (`!x`,
        // `a && b`).
        const isWordOp = /^[a-zA-Z_]/.test(op[0]);

        if (isFunction) {
          // Compile as a function call (works for both scalar and collection arguments)
          return `${op[0]}(${args
            .map((arg) => BaseCompiler.compileValueOperand(arg, target))
            .join(', ')})`;
        } else {
          // Compile as an operator (only for non-collection arguments)
          if (args.every((x) => !x.isCollection)) {
            if (isRelationalOperator(h) && args.length > 2) {
              // Chain relational operators, conjoined with the target's chain
              // operator (`&&` by default; Python `and`).
              //
              // A middle operand appears in TWO comparisons (`a < m < b` →
              // `(a < m) && (m < b)`). Emitting it twice would evaluate it
              // twice — drawing `Random()` twice, say — diverging from the
              // interpreter, which evaluates each operand once. Bind each
              // non-trivial middle operand (indices 1..n-2) to a temporary so it
              // is evaluated exactly once. A symbol or number literal is safe to
              // duplicate, so it is left inline (keeps output clean, no churn).
              // Targets without `bindExpr` (GPU shaders) inline everything —
              // safe there, since their `Random` requires a deterministic seed.
              const chainOp = target.chainOp ?? '&&';
              const bindings: Array<[name: string, value: string]> = [];
              const codes = args.map((arg, i) => {
                const code = BaseCompiler.compileValueOperand(
                  arg,
                  target,
                  op[1]
                );
                const isMiddle = i >= 1 && i <= args.length - 2;
                if (
                  target.bindExpr &&
                  isMiddle &&
                  !isSymbol(arg) &&
                  !isNumber(arg)
                ) {
                  const name = BaseCompiler.tempVar();
                  bindings.push([name, code]);
                  return name;
                }
                return code;
              });
              const pairs: string[] = [];
              for (let i = 0; i < codes.length - 1; i++)
                pairs.push(`${codes[i]} ${op[0]} ${codes[i + 1]}`);
              const body = `(${pairs.join(`) ${chainOp} (`)})`;
              if (bindings.length > 0 && target.bindExpr)
                return target.bindExpr(bindings, body);
              return body;
            }

            let resultStr: string;
            if (args.length === 1) {
              // Unary operator, assume prefix. Word operators get a space.
              const operandCode = BaseCompiler.compileValueOperand(
                args[0],
                target,
                op[1]
              );
              // Insert a separating space when gluing the operator to an
              // operand that begins with the same symbol would form a different
              // token: `-` + `-3.0` must not become `--3.0` (invalid in
              // GLSL/WGSL, a decrement in C-likes/JS). This arises when a
              // negative value is spliced in (e.g. a Sum unroll substituting a
              // negative index into `Negate(i)`). A leading `(` is already safe.
              const glues =
                !isWordOp &&
                operandCode.length > 0 &&
                operandCode[0] === op[0][op[0].length - 1];
              const sep = isWordOp || glues ? ' ' : '';
              resultStr = `${op[0]}${sep}${operandCode}`;
            } else {
              // `Power` is right-associative: `a ** b ** c` parses as
              // `a ** (b ** c)`. So a *left* operand of equal precedence must
              // be parenthesized — otherwise `(a^b)^c` would emit the
              // right-associative `a ** b ** c` (wrong grouping in Python,
              // where `**` is the only right-associative arithmetic operator).
              const rightAssoc = h === 'Power';
              // `Subtract`/`Divide` are left-associative and *non*-associative:
              // `a - (b - c) ≠ (a - b) - c`. So a *right* operand of equal
              // precedence must be parenthesized — otherwise a non-canonical
              // `Divide(a, Divide(b, c))` would emit `a / b / c` (= `(a/b)/c`,
              // wrong grouping). `Add`/`Multiply` are associative, so their
              // operands need no extra parens.
              const leftAssocNonAssociative =
                h === 'Subtract' || h === 'Divide';
              resultStr = args
                .map((arg, i) => {
                  let operandPrec = op[1];
                  if (rightAssoc && i < args.length - 1)
                    operandPrec = op[1] + 1;
                  else if (leftAssocNonAssociative && i > 0)
                    operandPrec = op[1] + 1;
                  return BaseCompiler.compileValueOperand(
                    arg,
                    target,
                    operandPrec
                  );
                })
                .join(` ${op[0]} `);
            }
            return op[1] < prec ? `(${resultStr})` : resultStr;
          }
        }
      }
    }

    // Handle special constructs
    if (h === 'Function') {
      // Dispatch to target-specific handler if available (e.g. GPU throws)
      const fnFn = target.functions?.(h);
      if (typeof fnFn === 'function')
        return fnFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      // Default: JavaScript arrow function
      const params = args
        .slice(1)
        .map((x) => functionLiteralParameterName(x) || '_');
      return `((${params.join(', ')}) => ${BaseCompiler.compile(
        args[0].canonical,
        {
          ...target,
          var: (id) => (params.includes(id) ? id : target.var(id)),
          boundVars: BaseCompiler.withBoundNames(target, params),
        }
      )})`;
    }

    if (h === 'Declare') {
      const name = isSymbol(args[0]) ? args[0].symbol : '_';
      // Targets with a `declare` hook handle any initial value at the block
      // level (as a separate assignment statement — see `compileBlock`). For
      // the default path (no hook), emit a combined initializer so a
      // value-carrying `Declare(sym, type, value)` isn't dropped.
      if (target.declare) return target.declare(name);
      const value = BaseCompiler.declareValueOperand(args);
      return value === undefined
        ? `let ${name}`
        : `let ${name} = ${BaseCompiler.compile(value, target)}`;
    }
    if (h === 'Assign')
      return `${
        isSymbol(args[0]) ? args[0].symbol : '_'
      } = ${BaseCompiler.compile(args[1], target)}`;
    if (h === 'Return')
      return `return ${BaseCompiler.compile(args[0], target)}`;
    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';

    if (h === 'Loop') {
      const loopFn = target.functions?.(h);
      if (typeof loopFn === 'function')
        return loopFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      return BaseCompiler.compileForLoop(args, target);
    }

    if (h === 'Comprehension') {
      const compFn = target.functions?.(h);
      if (typeof compFn === 'function')
        return compFn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      return BaseCompiler.compileComprehension(args, target);
    }

    if (h === 'If') {
      if (args.length !== 3) throw new Error('If: wrong number of arguments');
      BaseCompiler.assertScalarCondition(args[0]);
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(
            args,
            (expr) => BaseCompiler.compileValueOperand(expr, target),
            target
          );
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      return `((${BaseCompiler.compile(
        args[0],
        target
      )}) ? (${BaseCompiler.compile(
        args[1],
        target
      )}) : (${BaseCompiler.compile(args[2], target)}))`;
    }

    if (h === 'Which') {
      if (args.length < 2 || args.length % 2 !== 0)
        throw new Error(
          'Which: expected even number of arguments (condition/value pairs)'
        );
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(
            args,
            (expr) => BaseCompiler.compileValueOperand(expr, target),
            target
          );
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      // Compile to chained ternaries
      const compilePair = (i: number): string => {
        if (i >= args.length) return 'NaN';
        const cond = args[i];
        const val = args[i + 1];
        // If condition is the symbol True, it's the default branch
        if (isSymbol(cond, 'True')) {
          return `(${BaseCompiler.compile(val, target)})`;
        }
        return `((${BaseCompiler.guardCondition(
          cond,
          target
        )}) ? (${BaseCompiler.compile(val, target)}) : ${compilePair(i + 2)})`;
      };
      return compilePair(0);
    }

    if (h === 'When') {
      if (args.length !== 2)
        throw new Error('When: expected exactly 2 arguments (expr, cond)');
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(
            args,
            (expr) => BaseCompiler.compileValueOperand(expr, target),
            target
          );
        }
        return `${fn}(${args
          .map((x) => BaseCompiler.compile(x, target))
          .join(', ')})`;
      }
      // Compile to ternary: cond ? expr : NaN
      // Special-case constant True/False conditions to avoid bare symbol refs
      if (isSymbol(args[1], 'True'))
        return `(${BaseCompiler.compile(args[0], target)})`;
      if (isSymbol(args[1], 'False')) return 'NaN';
      const val = BaseCompiler.compile(args[0], target);
      const cond = BaseCompiler.guardCondition(args[1], target);
      return `((${cond}) ? (${val}) : NaN)`;
    }

    if (h === 'Match') {
      // A target may override the whole construct (GPU emits target-specific
      // ternaries; interval/Python fail closed). Otherwise the default is the
      // JavaScript emission (chained `if`/`switch` in an arrow-IIFE).
      const fn = target.functions?.(h);
      if (typeof fn === 'function')
        return fn(
          args,
          (expr) => BaseCompiler.compileValueOperand(expr, target),
          target
        );
      return BaseCompiler.compileMatchJS(engine, args, target);
    }

    if (h === 'Block') {
      return BaseCompiler.compileBlock(args, target);
    }

    // `Typed(value, type)` is a transparent runtime ascription — it constrains
    // the static type but has no runtime effect, so it compiles to its value
    // operand on every target (the interpreter ignores it likewise). Without
    // this, a helper declared with a precise return type (e.g. `(number) ->
    // vector<11>`) wraps its body in `Typed`, and every compiled call throws
    // `Unknown operator \`Typed\`` at the dispatch below.
    if (h === 'Typed') return BaseCompiler.compile(args[0], target);

    // Handle function calls
    const fn = target.functions?.(h);
    if (!fn) {
      // `h` may be a symbol whose engine definition is a user-defined function
      // literal (`f(x) := …`, `x ↦ …`). Emit it as a named local function and
      // compile the call site as `_fn_f(arg)`. Returns undefined for a truly
      // unknown operator (no such definition) or a target that opts out.
      const userFn = BaseCompiler.tryCompileUserFunction(
        engine,
        h,
        args,
        target
      );
      if (userFn !== undefined) return userFn;
      throw new Error(`Unknown operator \`${h}\``);
    }

    if (typeof fn === 'function') {
      // Handle broadcastable operators
      const def = engine.lookupDefinition(h);
      if (
        isOperatorDef(def) &&
        def.operator.broadcastable &&
        args.length === 1 &&
        isFiniteIndexedCollection(args[0])
      ) {
        const v = BaseCompiler.tempVar();
        // Inside the map callback the element variable is the callback
        // parameter — shadow `target.var` so it compiles bare, not as a
        // `_.<name>` vars-object lookup (same pattern as the Sum/Product
        // loop index).
        const innerTarget = {
          ...target,
          var: (id: string) => (id === v ? v : target.var(id)),
          boundVars: BaseCompiler.withBoundNames(target, [v]),
        };
        return `(${BaseCompiler.compile(args[0], target)}).map((${v}) => ${fn(
          [args[0].engine.expr(v)],
          (expr) => BaseCompiler.compileValueOperand(expr, innerTarget),
          innerTarget
        )})`;
      }
      return fn(
        args,
        (expr) => BaseCompiler.compileValueOperand(expr, target),
        target
      );
    }

    // `fn` is a plain string: the target maps this head to a real-only helper
    // (e.g. JS `_SYS.erf`, Python `scipy.special.erf`). Such a helper takes a
    // real scalar; handing it a complex value silently returns garbage (compiled
    // `Erf(z)` for complex z → −1, not NaN). Fail closed (D6) with the offending
    // head. Heads that legitimately consume complex (`Real`/`Imaginary`/
    // `Argument`/`Conjugate`) are string-mapped in some targets but are exempt.
    if (
      target.language !== undefined &&
      !target.language.startsWith('interval') &&
      !BaseCompiler.COMPLEX_TRANSPARENT_HEADS.has(h) &&
      args.some((a) => BaseCompiler.isComplexValued(a))
    ) {
      throw new Error(
        `${h}: real-only target helper "${fn}" cannot represent a complex-valued argument. Fail closed (D6).`
      );
    }

    return `${fn}(${args
      .map((x) => BaseCompiler.compileValueOperand(x, target))
      .join(', ')})`;
  }

  /**
   * Function heads that consume a complex value and return a real (or complex)
   * result. These are string-mapped to a complex-aware library routine in some
   * targets (e.g. Python `Real: 'np.real'`), so — unlike a real-only helper —
   * a complex argument is expected and must NOT trip the fail-closed guard.
   */
  private static readonly COMPLEX_TRANSPARENT_HEADS: ReadonlySet<string> =
    new Set(['Real', 'Imaginary', 'Argument', 'Conjugate']);

  /**
   * Scalar arithmetic operator heads whose codegen would emit
   * element-wise-impossible scalar JS if handed a list-valued operand. Guarded
   * in `compileExpr`: such a form fails closed (D6) unless it is the supported
   * unary broadcast (e.g. `Negate([1,2,3])`), which lowers via `.map`.
   */
  private static readonly SCALAR_ARITHMETIC_HEADS: ReadonlySet<string> =
    new Set(['Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Power']);

  /**
   * Logical operator heads that are `broadcastable` but return booleans. Like
   * relational operators, they are excluded from numeric element-wise
   * broadcasting on the compile target (a boolean-list has no coverage).
   */
  private static readonly LOGICAL_BROADCAST_HEADS: ReadonlySet<string> =
    new Set([
      'And',
      'Or',
      'Not',
      'Xor',
      'Nand',
      'Nor',
      'Implies',
      'Equivalent',
    ]);

  /**
   * Element-wise broadcast of a `broadcastable` head (arithmetic + element-wise
   * math functions such as `Sin`/`Sqrt`) over one or more list-valued operands,
   * for the JavaScript target. Emits a call to the `_SYS.bcast` runtime helper
   * wrapping a scalar closure built from the head's OWN scalar codegen, so
   * complex handling and constant folding stay identical to the scalar path.
   * `_SYS.bcast` performs the shape logic at run time (shortest-length zip,
   * scalar broadcast, nested lists), matching the interpreter's
   * `broadcastOverIndexedCollections`.
   *
   * Returns `null` — deferring to the scalar / fail-closed path — when the head
   * is not broadcastable, no operand is list-valued, the head has no function
   * codegen, or any operand is complex-valued (the bare element parameters
   * below cannot carry the complex scalar codegen).
   */
  private static tryCompileBroadcast(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string | null {
    const def = engine.lookupDefinition(h);
    if (!isOperatorDef(def) || def.operator.broadcastable !== true) return null;

    // Comparison and logical heads are also `broadcastable`, but they return
    // booleans; element-wise boolean-over-list has no compile coverage and is
    // handled by the separate collection-condition guard (which fails closed).
    // Restrict broadcasting to numeric element-wise operators.
    if (isRelationalOperator(h) || BaseCompiler.LOGICAL_BROADCAST_HEADS.has(h))
      return null;

    // A user `operators` override that lowers the head to a *function call*
    // (an identifier like `add(...)`, not a symbolic infix `+`) takes
    // responsibility for list operands (Issue #240) — don't intercept it.
    const opMap = target.operators?.(h);
    if (opMap !== undefined && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]))
      return null;

    // A genuinely complex *element* type (`list<complex>`) — a `list<number>`
    // is treated as real, mirroring the scalar `isComplexValued` convention
    // (`number` matches neither `complex` nor `real`). Hoisted here so the
    // `Multiply` ≥2-possibly-collection branch below can reuse it: the real-only
    // `_SYS.mul` runtime helper cannot carry complex elements, so a complex
    // operand there must defer to the fail-closed path.
    const hasComplexElement = (a: Expression): boolean => {
      const elt = collectionElementType(a.type.type);
      if (elt === undefined) return false;
      return isNonRealNumber(elt);
    };

    // A `broadcastable<T>`-typed operand is scalar OR an indexed collection at
    // run time (the static type of arithmetic over an unknown-return call, e.g.
    // `2·h(x)` with `h: (number) -> unknown`). Routing it through `_SYS.bcast`
    // is correct for BOTH runtime outcomes: `bcast` applies the scalar closure
    // directly when no argument is an array and recurses element-wise otherwise.
    // The array-operand admission below uses `isBoundPossiblyCollectionTyped`,
    // which matches both the `broadcastable` kind AND a bound top-typed
    // application (an `unknown`/`any`/`value` call whose collection-ness is
    // unknowable); the `Multiply` ≥2-arrayish matrix-divergence carve-out uses
    // the same predicate, so any operand whose shape is unprovable — a declared
    // `broadcastable<…>` OR a top-typed application that could be a matrix at
    // run time — makes the carve-out fail closed.

    // Mirror the interpreter's `skipBroadcastForVectorOps` carve-outs
    // (`boxed-function.ts`) for the compile target, but only where element-wise
    // broadcast would produce a *different value* than the interpreter's
    // dedicated tensor/tuple handling (`mulTensors`).
    //
    // After Issue #29, `mulTensors` computes the **element-wise** (Hadamard)
    // product for two rank-1 vectors — exactly what `_SYS.bcast` produces — so
    // pure vector·vector `Multiply` may broadcast-compile. Two cases involving
    // ≥2 tensor/tuple operands still diverge from a plain broadcast and must
    // fail closed to the interpreter:
    //
    //  - a **numeric tuple** operand: `tuple·tuple` is an interpreter error (no
    //    implicit dot/cross), so keep it failing closed rather than silently
    //    Hadamard-ing it;
    //  - a **rank-≥2 tensor** (matrix): `matrix·matrix`, `matrix·vector`,
    //    `vector·matrix` **contract** via the matrix product, which `_SYS.bcast`
    //    would not reproduce.
    //
    // Two rank-1 vectors of statically-known, differing lengths are also
    // declined: the interpreter stays inert (typically NaN in a real target)
    // whereas `_SYS.bcast` zips to the shorter length — a value divergence we
    // avoid where the mismatch is provable at compile time.
    //
    // Operands are counted by TYPE as well as by materialized value: a
    // `vector<n>`/`list`-typed *symbol* is not a tensor but lowers to a JS
    // array at run time, so it participates in the ≥2-operand test and a
    // `matrix`-typed symbol fails closed like a literal matrix (compiling it
    // through `_SYS.bcast` would Hadamard where the interpreter contracts).
    // Equal- or unknown-length typed vectors still compile: for symbol
    // operands the interpreter broadcasts element-wise too.
    //
    // Single-operand cases (scalar·vector, scalar·tuple) are untouched: they
    // broadcast element-wise in both the interpreter and `_SYS.bcast` (see
    // `compile-fallback.test.ts`).
    if (h === 'Multiply') {
      const isArrayish = (a: Expression): boolean =>
        isTensor(a) ||
        isNumericTuple(a) ||
        a.type.matches('list') ||
        a.type.matches('indexed_collection') ||
        isBoundPossiblyCollectionTyped(a);
      const collection = args.filter(isArrayish);
      if (collection.length >= 2) {
        // A possibly-collection operand (a declared `broadcastable<T>` OR a
        // top-typed application such as `h(x)`) could materialize as a scalar,
        // a vector, OR a MATRIX at run time — the shape is unprovable at compile
        // time. `_SYS.bcast` would Hadamard unconditionally, diverging from the
        // interpreter's matrix contraction; instead emit the interpreter-faithful
        // `_SYS.mul`, which dispatches on runtime rank (Hadamard for equal-length
        // rank-1 vectors, matrix product for rank-≥2), so no shape silently
        // diverges. Complex operands can't route through the real-only helper —
        // defer those to the fail-closed path.
        if (collection.some(isBoundPossiblyCollectionTyped)) {
          if (
            args.some(
              (a) => BaseCompiler.isComplexValued(a) || hasComplexElement(a)
            )
          )
            return null;
          const compiledArgs = args
            .map((a) => BaseCompiler.compile(a, target))
            .join(', ');
          return `_SYS.mul(${compiledArgs})`;
        }
        const isMatrix = (a: Expression): boolean =>
          (isTensor(a) && a.shape.length >= 2) || a.type.matches('matrix');
        if (collection.some((a) => isNumericTuple(a)) || args.some(isMatrix))
          return null;
        // Statically-known mismatched rank-1 lengths: fail closed.
        const lengths = collection
          .filter((a) => isTensor(a) && a.shape.length === 1)
          .map((a) => a.shape[0]);
        if (lengths.length >= 2 && new Set(lengths).size > 1) return null;
      }
    }

    const fn = target.functions?.(h);
    if (typeof fn !== 'function') return null;

    // An operand lowers to a JS array at run time when it is a concrete
    // collection, is statically list/collection-typed (a symbolic list
    // parameter), or is possibly-collection-typed — a `broadcastable<T>` node
    // OR a top-typed application (`unknown`/`any`/`value` call such as `h(x)`),
    // both scalar OR array at run time, which `_SYS.bcast` handles either way.
    // If none is, this is ordinary scalar code — leave it be.
    const isArrayOperand = (a: Expression): boolean =>
      a.isCollection ||
      a.type.matches('list') ||
      a.type.matches('indexed_collection') ||
      isBoundPossiblyCollectionTyped(a);
    if (!args.some(isArrayOperand)) return null;

    // Complex-valued operands need complex scalar codegen, which the bare
    // element parameters below can't carry — defer (scalar / fail-closed path).
    // `hasComplexElement` (hoisted above) is the list-element complex test.
    if (
      args.some((a) => BaseCompiler.isComplexValued(a) || hasComplexElement(a))
    )
      return null;

    // Bind one element parameter per operand and build the scalar body by
    // re-invoking the head's own scalar codegen with those parameters (shadow
    // `target.var` so they compile bare, not as `_.<name>` lookups — same
    // pattern as the Sum/Product loop index).
    const params = args.map(() => BaseCompiler.tempVar());
    const innerTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => (params.includes(id) ? id : target.var(id)),
      boundVars: BaseCompiler.withBoundNames(target, params),
    };
    const scalarBody = fn(
      params.map((p) => engine.expr(p)),
      (expr) => BaseCompiler.compileValueOperand(expr, innerTarget),
      innerTarget
    );
    const compiledArgs = args
      .map((a) => BaseCompiler.compile(a, target))
      .join(', ');
    return `_SYS.bcast((${params.join(', ')}) => ${scalarBody}, ${compiledArgs})`;
  }

  /**
   * Extract the initial-value operand of a `Declare` expression, if any.
   *
   * Handles the positional forms `Declare(sym, type, value)` and a `value`
   * key in an optional trailing attributes `Dictionary`. A positional value
   * takes precedence over the dictionary's `value`. Returns `undefined` when
   * the declaration has no value (`Declare(sym)` / `Declare(sym, type)`).
   */
  private static declareValueOperand(
    ops: ReadonlyArray<Expression>
  ): Expression | undefined {
    let rest = ops.slice(1);
    let attrsValue: Expression | undefined;
    const last = rest[rest.length - 1];
    if (last !== undefined && isDictionary(last)) {
      attrsValue = last.get('value');
      rest = rest.slice(0, -1);
    }
    // rest is now the positional operands after the symbol: [type?, value?]
    return rest[1] ?? attrsValue;
  }

  /**
   * Compile a block expression
   */
  private static compileBlock(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    // Get all the Declare statements
    const locals: string[] = [];
    for (const arg of args) {
      if (isFunction(arg, 'Declare')) {
        const firstOp = arg.ops[0];
        if (isSymbol(firstOp)) locals.push(firstOp.symbol);
      }
    }

    if (args.length === 1 && locals.length === 0) {
      return BaseCompiler.compile(args[0], target);
    }

    // Infer each local's complex-ness, in statement order, so a later local
    // whose RHS reads an earlier complex local is itself recognized as
    // complex (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0` — Tycho item 58).
    // The frame is pushed while inferring AND while compiling the
    // statements, so `isComplexValued` — in every target — sees the locals
    // the emitter is about to bind. Sources, per local: an explicit
    // `complex` type on the `Declare`, a `Declare` initial value, or the
    // first `Assign` RHS.
    const complexFrame = new Map<string, boolean>();
    for (const local of locals) complexFrame.set(local, false);
    BaseCompiler._localComplex.push(complexFrame);
    try {
      for (const arg of args) {
        if (isFunction(arg, 'Declare') && isSymbol(arg.ops[0])) {
          const name = arg.ops[0].symbol;
          if (isSymbol(arg.ops[1], 'complex')) complexFrame.set(name, true);
          const value = BaseCompiler.declareValueOperand(arg.ops);
          if (value !== undefined && BaseCompiler.isComplexValued(value))
            complexFrame.set(name, true);
        } else if (
          isFunction(arg, 'Assign') &&
          isSymbol(arg.ops[0]) &&
          complexFrame.get(arg.ops[0].symbol) === false &&
          BaseCompiler.isComplexValued(arg.ops[1])
        ) {
          complexFrame.set(arg.ops[0].symbol, true);
        }
      }

      // GPU type hints for block locals.
      //
      // GPU shader scalars are always `float`/`f32`. We intentionally never
      // infer `int`/`i32` for an integer-valued local: GPU number literals are
      // always emitted with a decimal point (`3` → `3.0`, see formatGPUNumber)
      // and scalar shader arithmetic is float, so an `int`-typed declaration
      // would disagree with its own float assignment (`int r; r = 3.0;` — not
      // valid GLSL) and poison every downstream use in float math. Only a
      // complex-valued local needs a non-default hint (`vec2`/`vec2f`);
      // everything else uses the `float` default in `target.declare`.
      const typeHints: Record<string, string | undefined> = {};
      if (target.declare && target.language) {
        const vec2 = target.language === 'wgsl' ? 'vec2f' : 'vec2';
        for (const local of locals)
          if (complexFrame.get(local)) typeHints[local] = vec2;
      }

      const localTarget: CompileTarget<Expression> = {
        ...target,
        var: (id) => {
          if (locals.includes(id)) return id;
          return target.var(id);
        },
        boundVars: BaseCompiler.withBoundNames(target, locals),
      };

      const result = args
        .filter((a) => !isSymbol(a, 'Nothing'))
        .flatMap((arg) => {
          // For Declare, pass inferred type hint to the target hook
          if (
            isFunction(arg, 'Declare') &&
            isSymbol(arg.ops[0]) &&
            target.declare
          ) {
            const name = arg.ops[0].symbol;
            const decl = target.declare(name, typeHints[name]);
            // A `Declare` may carry an initial value (`Declare(sym, type, value)`
            // or a `value` key in a trailing attributes dictionary). Emit it as a
            // separate assignment statement, mirroring how a hoisted
            // `Declare`+`Assign` pair compiles. (Two statements — not a combined
            // initializer — so the declaration stays a plain `let`/`float`, which
            // is what the subsequent assignment requires.)
            const value = BaseCompiler.declareValueOperand(arg.ops);
            if (value !== undefined)
              return [
                decl,
                `${name} = ${BaseCompiler.compile(value, localTarget)}`,
              ];
            return [decl];
          }
          return [BaseCompiler.compile(arg, localTarget)];
        })
        .filter((s) => s !== '');

      if (result.length === 0) return '';

      if (target.block) return target.block(result);

      // Default: JavaScript IIFE
      result[result.length - 1] = `return ${result[result.length - 1]}`;
      return `(() => {${target.ws('\n')}${result.join(
        `;${target.ws('\n')}`
      )}${target.ws('\n')}})()`;
    } finally {
      BaseCompiler._localComplex.pop();
    }
  }

  /**
   * Compile a `Loop` expression — imperative control flow, **for effect** (no
   * value is collected). Three shapes:
   *
   * 1. **Bare infinite loop:** `Loop(body)` → `(() => { while (true) { … } })()`.
   *    The body compiles as statements (`compileLoopBody`), so `break` /
   *    `continue` / `return` terminate it. Unbounded loops are rejected on GPU
   *    targets (GLSL/WGSL).
   *
   * 2. **Counted loop:** `Loop(body, Element(i, Range(lo, hi)))` where the
   *    Range is integer-ascending with step 1 → the legacy
   *    `for (let i = lo; i <= hi; i++) { … }` shape, emitted as bare statements
   *    (no result array). The counter is a plain number; wrapping targets
   *    (interval-js) re-wrap references to `i` in the body.
   *
   * 3. **General for-each:** any other Element form (multiple clauses, a
   *    non-`Range` collection, or a stepped/descending/fractional `Range`) →
   *    nested `for (const x of …) { … }` loops whose innermost statement is the
   *    compiled body. No result array.
   *
   * Value-producing comprehensions are compiled by `compileComprehension`
   * (head `Comprehension`), not here.
   */
  private static compileForLoop(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!args[0]) throw new Error('Loop: no body');

    const body = args[0];
    const elements = args.slice(1);
    const lang = target.language ?? '';

    // ── Bare infinite loop ────────────────────────────────────────────────
    if (elements.length === 0) {
      if (lang === 'glsl' || lang === 'wgsl')
        throw new Error(
          `${lang.toUpperCase()}: an unbounded Loop(body) is not supported.`
        );
      const bodyStmts = BaseCompiler.compileLoopBody(body, target);
      return `(() => {${target.ws('\n')}while (true) {${target.ws(
        '\n'
      )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
    }

    // ── Counted loop: single integer-ascending step-1 Range ───────────────
    if (
      elements.length === 1 &&
      isFunction(elements[0], 'Element') &&
      BaseCompiler.isLegacyCompatibleRange(elements[0].ops[1])
    ) {
      const indexing = elements[0];
      const indexExpr = indexing.ops[0];
      const rangeExpr = indexing.ops[1];

      if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
      if (!isFunction(rangeExpr, 'Range'))
        throw new Error('Loop: expected Range(lo, hi)');

      const index = indexExpr.symbol;

      // Use raw numeric values for the for-loop counter (not target-wrapped).
      // This ensures `for (let i = 1; i <= 5; i++)` uses plain numbers even
      // when the target wraps values (e.g. interval-js would produce
      // `_IA.point(1)` which breaks `i++`).
      const lower = Math.floor(rangeExpr.ops[0].re);
      const upper = Math.floor(rangeExpr.ops[1].re);

      if (!Number.isFinite(lower) || !Number.isFinite(upper))
        throw new Error('Loop: bounds must be finite numbers');

      // Check if the target wraps numeric values (e.g. interval-js).
      // If so, references to the loop index in the body must be wrapped.
      const needsWrap = target.number(0) !== '0';

      const bodyTarget: CompileTarget<Expression> = {
        ...target,
        var: (id: string) =>
          id === index
            ? needsWrap
              ? target.number(0).replace('0', index)
              : index
            : target.var(id),
        boundVars: BaseCompiler.withBoundNames(target, [index]),
      };

      const bodyStmts = BaseCompiler.compileLoopBody(body, bodyTarget);

      return `(() => {${target.ws(
        '\n'
      )}for (let ${index} = ${lower}; ${index} <= ${upper}; ${index}++) {${target.ws(
        '\n'
      )}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
    }

    // ── General for-each (for effect) ─────────────────────────────────────
    if (lang === 'glsl' || lang === 'wgsl')
      throw new Error(
        `${lang.toUpperCase()}: a multi-Element or non-Range Loop is not supported.`
      );

    const inner = BaseCompiler.compileElementLoops(
      elements,
      target,
      (bodyTarget) => BaseCompiler.compileLoopBody(body, bodyTarget)
    );
    return `(() => {${target.ws('\n')}${inner}${target.ws('\n')}})()`;
  }

  /**
   * Compile a `Comprehension` expression — a value-producing comprehension.
   * `Comprehension(body, Element(x, coll1), Element(y, coll2), …)` compiles to
   * nested `for (const x of …)` loops that `result.push(body)`, returning the
   * collected array:
   *
   * ```js
   * (() => { const result = [];
   *   for (const x of [1,2]) { for (const y of [3,4]) { result.push(body); } }
   *   return result; })()
   * ```
   *
   * GLSL/WGSL have no dynamic arrays, so a comprehension is rejected there.
   */
  private static compileComprehension(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!args[0]) throw new Error('Comprehension: no body');
    if (!args[1]) throw new Error('Comprehension: no indexing set');

    const body = args[0];
    const elements = args.slice(1);

    const lang = target.language ?? '';
    if (lang === 'glsl' || lang === 'wgsl')
      throw new Error(
        `${lang.toUpperCase()}: Comprehension is not supported (no dynamic arrays). ` +
          'TODO(E3-GLSL): unroll or use a fixed-size array.'
      );

    const inner = BaseCompiler.compileElementLoops(
      elements,
      target,
      (bodyTarget) => `result.push(${BaseCompiler.compile(body, bodyTarget)});`
    );
    return `(() => { const result = []; ${inner} return result; })()`;
  }

  /**
   * Build nested `for (const name of collection) { … }` loops from a list of
   * `Element` clauses. `makeInner` produces the innermost statement given the
   * loop-variable-aware `bodyTarget`. Shared by `compileForLoop` (general
   * for-each) and `compileComprehension`.
   */
  private static compileElementLoops(
    elements: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    makeInner: (bodyTarget: CompileTarget<Expression>) => string
  ): string {
    // Validate all Element clauses and narrow their types.
    type NarrowedElement = Expression & {
      ops: ReadonlyArray<Expression>;
      op1: Expression;
      op2: Expression;
    };
    const narrowedElements: NarrowedElement[] = [];
    for (let i = 0; i < elements.length; i++) {
      const elem = elements[i];
      if (!isFunction(elem, 'Element'))
        throw new Error(
          `Loop: argument ${i + 1} must be an Element clause, got ${(elem as Expression & { operator?: string }).operator ?? '?'}`
        );
      if (!isSymbol(elem.ops[0]))
        throw new Error(
          `Loop: Element index (argument ${i + 1}) must be a symbol`
        );
      narrowedElements.push(elem as unknown as NarrowedElement);
    }

    // For wrapping targets (e.g. interval-js where `target.number(0)` is
    // `_IA.point(0)`), each loop variable must be wrapped wherever it appears
    // in the body or in an inner collection expression. Without this, code
    // like `_IA.add(x, y)` is invoked with raw numbers and produces incorrect
    // intervals.
    const loopVarSet = new Set(
      narrowedElements.map(
        (e) => (e.ops[0] as Expression & { symbol: string }).symbol
      )
    );
    const needsWrap = target.number(0) !== '0';
    // Always shadow the loop variables in the body's target: a loop variable
    // is bound to the bare emitted identifier (wrapped only for wrapping
    // targets like interval-js). Without this, a loop variable that collides
    // with a symbol the engine knows (e.g. an index named `i`, which the
    // engine resolves to the imaginary unit) would be folded to that value by
    // `target.var` instead of referencing the loop binding.
    const bodyTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) =>
        loopVarSet.has(id)
          ? needsWrap
            ? target.number(0).replace('0', id)
            : id
          : target.var(id),
      boundVars: BaseCompiler.withBoundNames(target, [...loopVarSet]),
    };

    // Build nested for-of loops from innermost to outermost. Inner collections
    // are compiled with `bodyTarget` so that references to outer loop variables
    // are wrapped consistently.
    let inner = makeInner(bodyTarget);
    for (let i = narrowedElements.length - 1; i >= 0; i--) {
      const elem = narrowedElements[i];
      const name = (elem.ops[0] as Expression & { symbol: string }).symbol;
      const collExpr = elem.ops[1];
      const collection = isFunction(collExpr, 'Range')
        ? BaseCompiler.compileRangeIterable(collExpr, bodyTarget)
        : BaseCompiler.compile(collExpr, bodyTarget);
      inner = `for (const ${name} of ${collection}) { ${inner} }`;
    }

    return inner;
  }

  /**
   * Returns `true` when the given collection expression is a `Range` whose
   * runtime semantics match the legacy imperative for-loop shape
   * `for (let i = lo; i <= hi; i++)`.
   *
   * Concretely: integer-ascending bounds and step omitted-or-1. When bounds
   * are not statically numeric we accept the Range (the historical
   * behaviour) — runtime mismatch in the descending-unknown-bounds case is
   * left as a known limitation; callers can force the iterable path by
   * supplying an explicit step.
   */
  private static isLegacyCompatibleRange(coll: Expression): boolean {
    if (!isFunction(coll, 'Range')) return false;
    if (coll.ops.length >= 3) {
      const stepExpr = coll.ops[2];
      if (!isNumber(stepExpr) || stepExpr.re !== 1) return false;
    }
    const lo = coll.ops[0];
    const hi = coll.ops[1];
    if (isNumber(lo) && !Number.isInteger(lo.re)) return false;
    if (isNumber(hi) && !Number.isInteger(hi.re)) return false;
    if (isNumber(lo) && isNumber(hi) && lo.re > hi.re) return false;
    return true;
  }

  /**
   * Compile a `Range(lo, hi)` or `Range(lo, hi, step)` expression into a JS
   * iterable expression. Mirrors the runtime semantics in
   * `library/collections.ts` Range:
   *     count    = step === 0 ? 0 : max(0, floor((hi - lo) / step) + 1)
   *     element  = lo + step * k          (0-indexed)
   * Default step is 1 when omitted. Bounds and step may be fractional.
   *
   * Only used from the comprehension path in `compileForLoop`.
   * Caller must have already verified `isFunction(rangeExpr, 'Range')`.
   */
  private static compileRangeIterable(
    rangeExpr: Expression & { ops: ReadonlyArray<Expression> },
    target: CompileTarget<Expression>
  ): string {
    const loExpr = rangeExpr.ops[0];
    const hiExpr = rangeExpr.ops[1];
    const stepExpr = rangeExpr.ops[2];

    // Fast path: all bounds (and step, if present) are numeric constants.
    if (
      isNumber(loExpr) &&
      isNumber(hiExpr) &&
      (stepExpr === undefined || isNumber(stepExpr))
    ) {
      const lo = loExpr.re;
      const hi = hiExpr.re;
      // When step is omitted, auto-direct: +1 if hi >= lo, else -1.
      // Mirrors the runtime range() helper in library/collections.ts.
      const step = stepExpr === undefined ? (hi >= lo ? 1 : -1) : stepExpr.re;
      if (step === 0) return '[]';
      const len = Math.max(0, Math.floor((hi - lo) / step) + 1);
      if (step === 1) {
        if (lo === 0) return `Array.from({length:${len}},(_,k)=>k)`;
        return `Array.from({length:${len}},(_,k)=>${lo}+k)`;
      }
      return `Array.from({length:${len}},(_,k)=>${lo}+(${step})*k)`;
    }

    // General path: compute bounds (and step) at runtime.
    const lo = BaseCompiler.compile(loExpr, target);
    const hi = BaseCompiler.compile(hiExpr, target);
    if (stepExpr === undefined) {
      // Auto-direction step at runtime: +1 if _hi >= _lo, else -1.
      return `((_lo,_hi)=>{const _st=_hi>=_lo?1:-1;return Array.from({length:Math.max(0,Math.floor((_hi-_lo)/_st)+1)},(_,k)=>_lo+_st*k);})(${lo},${hi})`;
    }
    const step = BaseCompiler.compile(stepExpr, target);
    return `((_lo,_hi,_st)=>_st===0?[]:Array.from({length:Math.max(0,Math.floor((_hi-_lo)/_st)+1)},(_,k)=>_lo+_st*k))(${lo},${hi},${step})`;
  }

  /**
   * Compile a loop body expression as statements (not wrapped in IIFE).
   * Handles Break, Continue, Return as statements, and If as if-else when
   * branches contain control flow.
   */
  private static compileLoopBody(
    expr: Expression,
    target: CompileTarget<Expression>
  ): string {
    // Nothing is a no-op in statement context
    if (isSymbol(expr, 'Nothing')) return '';
    if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

    const h = expr.operator;

    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';
    if (h === 'Return')
      return `return ${BaseCompiler.compile(expr.ops[0], target)}`;

    if (h === 'If') {
      // For the imperative `if` statement, the condition must produce a
      // boolean.  Interval targets compile comparisons to interval results
      // (e.g. `_IA.greater(...)` returns an object, not a boolean), which
      // would always be truthy.  Use scalar operators for the condition.
      const condTarget = BaseCompiler.scalarConditionTarget(target);
      const cond = BaseCompiler.compile(expr.ops[0], condTarget);
      const thenBranch = BaseCompiler.compileLoopBody(expr.ops[1], target);
      if (expr.ops.length > 2) {
        const elseBranch = BaseCompiler.compileLoopBody(expr.ops[2], target);
        if (elseBranch)
          return `if (${cond}) { ${thenBranch} } else { ${elseBranch} }`;
      }
      return `if (${cond}) { ${thenBranch} }`;
    }

    if (h === 'Block') {
      return expr.ops
        .map((s) => BaseCompiler.compileLoopBody(s, target))
        .join('; ');
    }

    return BaseCompiler.compile(expr, target);
  }

  /**
   * Create a target that compiles conditions as plain JS booleans.
   * Used inside `compileLoopBody` so that `if (cond)` gets a real boolean,
   * not an interval result object (which would always be truthy).
   *
   * Overrides comparison and logical operators to use plain JS, and
   * numeric values/variables to use raw numbers (the loop counter is
   * already a plain number).
   */
  private static scalarConditionTarget(
    target: CompileTarget<Expression>
  ): CompileTarget<Expression> {
    const SCALAR_OPS: Record<string, [string, number]> = {
      Less: ['<', 20],
      Greater: ['>', 20],
      LessEqual: ['<=', 20],
      GreaterEqual: ['>=', 20],
      Equal: ['===', 20],
      NotEqual: ['!==', 20],
      And: ['&&', 6],
      Or: ['||', 5],
      Not: ['!', 16],
    };

    // If the target doesn't wrap numbers, no override needed
    if (target.number(0) === '0') return target;

    return {
      ...target,
      number: (n: number) => String(n),
      var: (id: string) => {
        // Resolve through original target, then strip interval wrapping
        // e.g. '_IA.point(i)' → 'i', plain 'x' stays 'x'
        const resolved = target.var(id);
        if (!resolved) return undefined as any;
        const match = resolved.match(/^_IA\.point\((.+)\)$/);
        return match ? match[1] : resolved;
      },
      operators: (op: string) => SCALAR_OPS[op] ?? target.operators?.(op),
      functions: (id: string) => {
        // Comparison functions should not be used — operators handle them
        if (id in SCALAR_OPS) return undefined;
        return target.functions?.(id);
      },
    };
  }

  /**
   * Compile loop constructs (Sum/Product)
   */
  private static compileLoop(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string {
    if (!args[0]) throw new Error('Sum/Product: no body');

    // Multi-index Sum/Product (more than one indexing-set clause) is not
    // representable in this generic single-index loop. Fail closed (D6) rather
    // than silently drop the trailing clauses and emit code with a dangling
    // index variable.
    if (args.length > 2)
      throw new Error(
        `${h}: multi-index (${args.length - 1} indexing sets) is not supported by this target`
      );

    const {
      index,
      lower,
      upper,
      isFinite: _isFinite,
    } = normalizeIndexingSet(args[1]);
    const isSum = h === 'Sum';
    const op = isSum ? '+' : '*';
    const bodyIsComplex = BaseCompiler.isComplexValued(args[0]);

    if (!index) {
      // Loop over a collection
      const indexVar = BaseCompiler.tempVar();
      const acc = BaseCompiler.tempVar();
      const col = BaseCompiler.compile(args[0], target);
      if (bodyIsComplex) {
        if (isSum) {
          return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re + ${indexVar}.re, im: ${acc}.im + ${indexVar}.im }), { re: 0, im: 0 })`;
        }
        // Product
        return `${col}.reduce((${acc}, ${indexVar}) => ({ re: ${acc}.re * ${indexVar}.re - ${acc}.im * ${indexVar}.im, im: ${acc}.re * ${indexVar}.im + ${acc}.im * ${indexVar}.re }), { re: 1, im: 0 })`;
      }
      return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
        isSum ? '0' : '1'
      })`;
    }

    // Reject a collection-valued body for the indexed form (see
    // `assertScalarBigOpBody`); the `!index` collection-reduce arm above is
    // exempt.
    BaseCompiler.assertScalarBigOpBody(h, args[0]);

    const fn = BaseCompiler.compile(args[0], {
      ...target,
      var: (id) => {
        if (id === index) return index;
        return target.var(id);
      },
      boundVars: BaseCompiler.withBoundNames(target, [index]),
    });

    const acc = BaseCompiler.tempVar();

    // Iteration-budget guard (see CompileTarget.iterationBudget): a trip
    // count over the budget — including infinite or NaN bounds, for which
    // the negated comparison also fails — evaluates to NaN instead of
    // running the loop.
    const budget = target.iterationBudget;
    const guardNaN = (nan: string): string =>
      budget !== undefined
        ? `\n  if (!((${upper}) - ${index} < ${budget})) return ${nan};`
        : '';

    if (bodyIsComplex) {
      const val = BaseCompiler.tempVar();
      const guard = guardNaN('{ re: NaN, im: NaN }');
      if (isSum) {
        return `(() => {
  let ${acc} = { re: 0, im: 0 };
  let ${index} = ${lower};${guard}
  while (${index} <= ${upper}) {
    const ${val} = ${fn};
    ${acc} = { re: ${acc}.re + ${val}.re, im: ${acc}.im + ${val}.im };
    ${index}++;
  }
  return ${acc};
})()`;
      }
      // Product
      return `(() => {
  let ${acc} = { re: 1, im: 0 };
  let ${index} = ${lower};${guard}
  while (${index} <= ${upper}) {
    const ${val} = ${fn};
    ${acc} = { re: ${acc}.re * ${val}.re - ${acc}.im * ${val}.im, im: ${acc}.re * ${val}.im + ${acc}.im * ${val}.re };
    ${index}++;
  }
  return ${acc};
})()`;
    }

    return `(() => {
  let ${acc} = ${isSum ? '0' : '1'};
  let ${index} = ${lower};${guardNaN('NaN')}
  while (${index} <= ${upper}) {
    ${acc} ${op}= ${fn};
    ${index}++;
  }
  return ${acc};
})()`;
  }

  /**
   * Lexical frames of `Block` locals, innermost last, each mapping a local's
   * name to its inferred complex-ness. Pushed/popped by `compileBlock` around
   * the compilation of its statements (compilation is synchronous, so a
   * static stack is safe), and consulted by `isComplexValued` so that every
   * target's operand analysis agrees with the emitted local bindings.
   */
  private static _localComplex: Map<string, boolean>[] = [];

  /**
   * Determine at compile time whether an expression produces a complex value.
   *
   * Uses the expression's declared type (from operator signatures) when
   * available. Falls back to operand inspection for functions whose
   * return type is unknown.
   *
   * A symbol bound in the compile context (`_boundVarsCtx`, synced from
   * `target.boundVars` by `compile()` — a loop index, lambda parameter,
   * broadcast element) shadows any same-named engine symbol, so the
   * engine-value fallback below must not read through it (a loop counter
   * named `i` must not pick up the imaginary unit's value).
   */
  static isComplexValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im !== 0;

    if (isSymbol(expr)) {
      if (expr.symbol === 'ImaginaryUnit') return true;
      // A `Block` local's complex-ness is inferred from its assigned RHS
      // (`w_1 ⩴ (x+iy)² + z_0; w_2 ⩴ w_1² + z_0`: the type system defaults
      // the local to real, but the emitter binds it to a complex object —
      // the analysis must agree or later statements consume the object as a
      // number; Tycho item 58). Innermost frame containing the name decides
      // (a shadowing inner local is not poisoned by an outer complex one).
      for (let i = BaseCompiler._localComplex.length - 1; i >= 0; i--) {
        const frame = BaseCompiler._localComplex[i];
        const known = frame.get(expr.symbol);
        if (known !== undefined) return known;
      }
      const t = expr.type;
      if (!t) return false;
      if (isNonRealNumber(t.type)) return true;
      if (t.matches('real')) return false;
      // The declared type is wide (`number`, `unknown`) — but the symbol may
      // carry an assigned complex VALUE, which `tryFoldKnownSymbol` folds as
      // a complex object literal. The operand analysis must agree with the
      // fold, or the target emits structurally wrong arithmetic
      // (`number + {re, im}` → NaN at every point; Tycho item 57). Does NOT
      // apply to compile-bound variables, which shadow the engine.
      if (BaseCompiler._boundVarsCtx?.has(expr.symbol)) return false;
      const v = expr.engine._getSymbolValue(expr.symbol);
      if (v !== undefined) return BaseCompiler.isComplexValued(v);
      return false;
    }

    if (isFunction(expr)) {
      // Check the function's return type from its operator definition
      const t = expr.type;
      if (isNonRealNumber(t.type)) return true;
      if (t.matches('real')) return false;

      // Return type is unknown — fall back to checking whether any
      // operand is complex (conservative: assumes function propagates
      // complex-ness from its inputs)
      return expr.ops.some((arg) => BaseCompiler.isComplexValued(arg));
    }

    return false;
  }

  /**
   * Fail-closed guard (D6) for the INDEXED big-op form (`Sum`/`Product` with a
   * body plus an indexing set). A collection-valued body (`Σ h(i)·a(…)` where
   * `a` returns a vector — the interpreter's zip-broadcast elementwise Sum) has
   * no scalar accumulation: the emitters would produce `acc + <array>` (NaN,
   * string concatenation, or a dangling array), a silently WRONG value. Throw
   * until an element-wise accumulation arm exists; consumers can distribute the
   * element access through the big op (`At(Σ…, k)` → `Σ At(…, k)`), which
   * compiles as a scalar loop.
   *
   * Call this ONLY on the indexed form's body, never on the no-index
   * collection-reduce form (`Sum(collection)`), whose body is legitimately a
   * collection.
   */
  static assertScalarBigOpBody(kind: string, body: Expression): void {
    if (body.type.matches('list') || body.type.matches('indexed_collection'))
      throw new Error(
        `${kind}: a collection-valued body does not compile — distribute the ` +
          `element access through the ${kind} (At(${kind}(…), k) → ` +
          `${kind}(At(…, k))) or evaluate instead. Fail closed (D6).`
      );
  }

  /**
   * True if the expression provably evaluates to a boolean (`True`/`False`) —
   * a relational (`Less`, `Equal`, …) or logical (`And`/`Or`/`Not`) form, the
   * `True`/`False` symbols, or anything declared `boolean`. Used to decide
   * whether a `Which`/`When` condition needs the fail-closed guard: a provably
   * boolean condition never diverges from the interpreter, so it is emitted
   * bare.
   */
  static isBooleanValued(expr: Expression): boolean {
    if (isSymbol(expr, 'True') || isSymbol(expr, 'False')) return true;
    if (isFunction(expr)) {
      const h = expr.operator;
      if (isRelationalOperator(h) || h === 'And' || h === 'Or' || h === 'Not')
        return true;
      const t = expr.type;
      return t ? t.matches('boolean') : false;
    }
    if (isSymbol(expr)) {
      const t = expr.type;
      return t ? t.matches('boolean') : false;
    }
    return false;
  }

  /**
   * Compile a `Which`/`When` condition, wrapping it in the target's fail-closed
   * boolean guard (`target.assertBoolean`) when it is not provably boolean. The
   * interpreter throws on a non-boolean (e.g. `NaN`) condition rather than
   * silently taking the default branch; the guard makes the compiled code match
   * that contract (D6) where the target can express it. A provably boolean
   * condition — the common case — is emitted bare (no overhead, no churn).
   */
  /**
   * A branch condition (`If`/`Which`/`When`) must be a scalar boolean. A
   * collection-valued condition can never be one — the interpreter throws
   * ("Condition must evaluate to True or False") rather than silently taking a
   * branch — so fail closed (D6) at compile time. Uses the declared type (not
   * `.isCollection`, which is false for a `list<finite_number>`).
   */
  static assertScalarCondition(cond: Expression): void {
    if (cond.type.matches('collection'))
      throw new Error(
        'Cannot compile: a branch condition is a collection-valued expression, ' +
          'which is never a scalar boolean. Materialize the collection first. ' +
          'Fail closed (D6).'
      );
  }

  static guardCondition(
    cond: Expression,
    target: CompileTarget<Expression>
  ): TargetSource {
    BaseCompiler.assertScalarCondition(cond);
    const code = BaseCompiler.compile(cond, target);
    if (target.assertBoolean && !BaseCompiler.isBooleanValued(cond))
      return target.assertBoolean(code);
    return code;
  }

  /** True if the expression is provably integer-typed. */
  static isIntegerValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im === 0 && Number.isInteger(expr.re);
    const t = expr.type;
    return t ? t.matches('integer') : false;
  }

  /** True if the expression is provably non-negative (sign ≥ 0). */
  static isNonNegative(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im === 0 && expr.re >= 0;
    return expr.isNonNegative === true;
  }

  // ───────────────────────────────────────────────────────────────────────
  // `Match` compilation (Cortex structural pattern matching, Phase 4 —
  // docs/plans/2026-07-12-cortex-match-design.md §5).
  //
  // Compilation reuses the classification ladder from `match-dispatch.ts`
  // (`getMatchPlan`): tier 0/1 (constant / literal / pin-of-constant) dispatch,
  // tier 2 fixed-shape `List`/`Tuple` destructuring, and fail-closed (D6) for
  // tier 3 and anything a target cannot express. The subject is evaluated once
  // (an IIFE parameter on JS; inlined where the target has no binding form).
  //
  // Compiled-vs-interpreted seam (accepted, §4 Phase-2 note): number leaves are
  // compared with the target's native `===`/`==`, not the interpreter's
  // tolerant `isEqual` — the same float-equality seam compiled `Which` already
  // has. No-match falls through to `NaN` (matching compiled `Which`), not the
  // interpreter's `["Error", "match-no-case", …]` value.
  // ───────────────────────────────────────────────────────────────────────

  /** Above this many integer-constant tier-0 cases, a dispatch run is emitted
   * as a `switch` (JS engines jump-table dense integer switches) instead of a
   * chain of `if (s === k)` comparisons. Below it, comparisons are simpler and
   * JIT-equivalent. */
  private static readonly MATCH_SWITCH_THRESHOLD = 8;

  /** True when `cc` is an irrefutable tier-3 case — a bare wildcard (`_` or a
   * single binding `_n`) with no guard. It matches anything, so it compiles to
   * the final unconditional branch (binding the subject to the capture). */
  private static isIrrefutableCase(cc: CompiledCase): boolean {
    return (
      cc.tier === 3 &&
      !cc.hasGuard &&
      cc.rawPatterns !== undefined &&
      cc.rawPatterns.length === 1 &&
      isWildcard(cc.rawPatterns[0])
    );
  }

  /** The ordered comparison targets of a tier-0/1 case: a constant to compare
   * the subject against (`{kind:'literal'}`) or a pin to resolve (`{kind:'pin'}`).
   * Unifies tier-0 (`dispatchKeys`) and tier-1 (`tests`). */
  private static matchCaseComparisons(
    cc: CompiledCase
  ): Array<
    { kind: 'literal'; value: Expression } | { kind: 'pin'; expr: Expression }
  > {
    if (cc.tier === 0)
      return (cc.dispatchKeys ?? []).map((d) => ({
        kind: 'literal' as const,
        value: d.value,
      }));
    return cc.tests ?? [];
  }

  /** Compile one comparison constant/pin of a tier-0/1 case to target source,
   * throwing (fail closed, D6) when it cannot be represented: a pin of a runtime
   * value (only `isConstant` symbols and literals fold), or a string on a target
   * with no string type. */
  private static compileMatchConstant(
    engine: ComputeEngine,
    cmp:
      | { kind: 'literal'; value: Expression }
      | { kind: 'pin'; expr: Expression },
    allowStrings: boolean,
    target: CompileTarget<Expression>
  ): string {
    const expr = cmp.kind === 'literal' ? cmp.value : cmp.expr;
    if (isString(expr)) {
      if (!allowStrings)
        throw new Error(
          `Match: a string constant is not compilable to "${target.language ?? 'this'}" (no string type). Fail closed (D6).`
        );
      return BaseCompiler.compile(expr, target);
    }
    if (cmp.kind === 'pin') {
      // A pin folds only when its value is fixed at compile time: a literal, or
      // a symbol declared `isConstant` (`== Pi` → `Math.PI`). A pin of a runtime
      // variable (`== limit`) has no compile-time value → fail closed (D6).
      const ok =
        isNumber(expr) ||
        isString(expr) ||
        (isSymbol(expr) && engine.box(expr.symbol).isConstant);
      if (!ok)
        throw new Error(
          `Match: pin '== ${expr.toString()}' references a runtime value; not compilable. Fail closed (D6).`
        );
    }
    return BaseCompiler.compile(expr, target);
  }

  /** The OR-chain condition for a tier-0/1 case: `s === c1 || s === c2 || …`. */
  private static matchLeafCondition(
    engine: ComputeEngine,
    cc: CompiledCase,
    subject: string,
    eq: string,
    allowStrings: boolean,
    target: CompileTarget<Expression>
  ): string {
    const parts = BaseCompiler.matchCaseComparisons(cc).map(
      (cmp) =>
        `${subject} ${eq} ${BaseCompiler.compileMatchConstant(engine, cmp, allowStrings, target)}`
    );
    if (parts.length === 0) return 'false';
    return parts.length === 1 ? parts[0] : `(${parts.join(' || ')})`;
  }

  /** Compile a case body, substituting each captured name with its target
   * accessor code. Bodies with no captures compile directly (the common
   * tier-0/1 case); bodies with captures compile the shadow-correct canonical
   * body held on the case's closure, with the capture names rebound to their
   * accessors. */
  private static compileMatchBody(
    cc: CompiledCase,
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): string {
    if (cc.captureNames.length === 0)
      return BaseCompiler.compile(cc.body.canonical, target);
    if (cc.bodyClosure === undefined || !isFunction(cc.bodyClosure))
      throw new Error('Match: case body is not compilable. Fail closed (D6).');
    return BaseCompiler.compile(
      cc.bodyClosure.op1,
      BaseCompiler.matchCaptureTarget(accessors, target)
    );
  }

  /** Compile a case guard the same way as its body (captures rebound to
   * accessors), or `undefined` when the case has no guard. */
  private static compileMatchGuard(
    cc: CompiledCase,
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): string | undefined {
    if (!cc.hasGuard || cc.guard === undefined) return undefined;
    if (cc.captureNames.length === 0)
      return BaseCompiler.compile(cc.guard.canonical, target);
    if (cc.guardClosure === undefined || !isFunction(cc.guardClosure))
      throw new Error('Match: case guard is not compilable. Fail closed (D6).');
    return BaseCompiler.compile(
      cc.guardClosure.op1,
      BaseCompiler.matchCaptureTarget(accessors, target)
    );
  }

  /** A target that resolves each captured name to its accessor code (e.g.
   * `a → s[0]`), delegating everything else to the base target. */
  private static matchCaptureTarget(
    accessors: Map<string, string> | undefined,
    target: CompileTarget<Expression>
  ): CompileTarget<Expression> {
    if (accessors === undefined || accessors.size === 0) return target;
    return {
      ...target,
      var: (id) => accessors.get(id) ?? target.var(id),
      boundVars: BaseCompiler.withBoundNames(target, [...accessors.keys()]),
    };
  }

  /**
   * Compile a `["Match", subject, …cases]` to JavaScript: an arrow-IIFE that
   * binds the subject once, then a chain of `if (cond) return body;` statements
   * (tier 0/1 constant comparisons, tier 2 fixed-shape destructuring),
   * optionally a `switch` for a large integer-constant dispatch run, ending in
   * a trailing irrefutable case or `return NaN`.
   */
  static compileMatchJS(
    engine: ComputeEngine,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    const plan = getMatchPlan(engine, args);
    if (plan.errorAlt !== undefined)
      throw new Error(
        `Match: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable. Fail closed (D6).`
      );

    const s = BaseCompiler.tempVar();
    const nl = target.ws('\n');
    const stmts: string[] = [];
    let done = false;

    for (const seg of plan.segments) {
      if (done) break;
      if (seg.kind === 'dispatch' && BaseCompiler.matchSwitchable(seg)) {
        stmts.push(BaseCompiler.emitMatchSwitch(engine, seg, s, target));
        continue;
      }
      for (const cc of seg.cases) {
        if (done) break;
        if (BaseCompiler.isIrrefutableCase(cc)) {
          const acc =
            cc.captureNames.length === 1
              ? new Map([[cc.captureNames[0], s]])
              : undefined;
          stmts.push(
            `return ${BaseCompiler.compileMatchBody(cc, acc, target)};`
          );
          done = true;
          break;
        }
        stmts.push(BaseCompiler.emitMatchCaseJS(engine, cc, s, target));
      }
    }

    if (!done) stmts.push('return NaN;');

    const subjCode = BaseCompiler.compile(args[0], target);
    return `((${s}) => {${nl}${stmts.join(nl)}${nl}})(${subjCode})`;
  }

  /** Emit one non-irrefutable case as a guarded early-return `if`. */
  private static emitMatchCaseJS(
    engine: ComputeEngine,
    cc: CompiledCase,
    s: string,
    target: CompileTarget<Expression>
  ): string {
    if (cc.tier === 0 || cc.tier === 1) {
      const cond = BaseCompiler.matchLeafCondition(
        engine,
        cc,
        s,
        '===',
        true,
        target
      );
      const guard = BaseCompiler.compileMatchGuard(cc, undefined, target);
      const full = guard === undefined ? cond : `(${cond}) && (${guard})`;
      return `if (${full}) return ${BaseCompiler.compileMatchBody(cc, undefined, target)};`;
    }

    if (cc.tier === 2) {
      const conds: string[] = [];
      const accessors = new Map<string, string>();
      BaseCompiler.walkMatchShape(
        engine,
        cc.shape!,
        s,
        conds,
        accessors,
        target
      );
      const guard = BaseCompiler.compileMatchGuard(cc, accessors, target);
      if (guard !== undefined) conds.push(`(${guard})`);
      const body = BaseCompiler.compileMatchBody(cc, accessors, target);
      return `if (${conds.join(' && ')}) return ${body};`;
    }

    // Tier 3, refutable: no compiled reference implementation of the generic
    // matcher — fail closed (D6), naming the offending pattern so the caller can
    // rewrite it with destructuring or guards.
    const p = cc.rawPatterns?.[0];
    throw new Error(
      `Match: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
        `rewrite with destructuring or guards. Fail closed (D6).`
    );
  }

  /** Walk a tier-2 fixed shape, appending JS boolean conditions (arity + literal
   * / pin element checks) and populating `accessors` (capture name → element
   * access code). Compiled `List`/`Tuple` values are JS arrays, so shapes lower
   * to `Array.isArray`, `.length`, `[i]`, and `.slice`. */
  private static walkMatchShape(
    engine: ComputeEngine,
    node: ShapeNode,
    base: string,
    conds: string[],
    accessors: Map<string, string>,
    target: CompileTarget<Expression>
  ): void {
    // Dictionary shapes are a tier-2 fixed shape for the interpreter, but the
    // compiler does not implement dict destructuring (native dict values have no
    // compiled array representation). Fail closed (D6), naming the keys.
    if (node.kind === 'dict') {
      const keys = node.entries.map((e) => `'${e.key}'`).join(', ');
      throw new Error(
        `Match: dictionary pattern {${keys}} is not compilable; ` +
          `rewrite with destructuring or guards. Fail closed (D6).`
      );
    }
    conds.push(`Array.isArray(${base})`);
    const fixed = node.prefix.length + node.suffix.length;
    if (node.rest === undefined) conds.push(`${base}.length === ${fixed}`);
    else conds.push(`${base}.length >= ${fixed}`);

    node.prefix.forEach((el, i) =>
      BaseCompiler.walkMatchElement(
        engine,
        el,
        `${base}[${i}]`,
        conds,
        accessors,
        target
      )
    );
    const sLen = node.suffix.length;
    node.suffix.forEach((el, j) =>
      BaseCompiler.walkMatchElement(
        engine,
        el,
        `${base}[${base}.length - ${sLen} + ${j}]`,
        conds,
        accessors,
        target
      )
    );
    if (node.rest !== undefined && node.rest.key !== null) {
      const name = node.rest.key.replace(/^_+/, '');
      accessors.set(
        name,
        `${base}.slice(${node.prefix.length}, ${base}.length - ${sLen})`
      );
    }
  }

  /** Handle one positional element of a tier-2 shape (see `walkMatchShape`). */
  private static walkMatchElement(
    engine: ComputeEngine,
    el: ElementPlan,
    access: string,
    conds: string[],
    accessors: Map<string, string>,
    target: CompileTarget<Expression>
  ): void {
    switch (el.kind) {
      case 'ignore':
        return;
      case 'bind':
        accessors.set(el.key.replace(/^_+/, ''), access);
        return;
      case 'literal':
        conds.push(
          `${access} === ${BaseCompiler.compileMatchConstant(engine, { kind: 'literal', value: el.value }, true, target)}`
        );
        return;
      case 'pin':
        conds.push(
          `${access} === ${BaseCompiler.compileMatchConstant(engine, { kind: 'pin', expr: el.expr }, true, target)}`
        );
        return;
      case 'shape':
        BaseCompiler.walkMatchShape(
          engine,
          el.node,
          access,
          conds,
          accessors,
          target
        );
        return;
    }
  }

  /** True when a tier-0 dispatch segment qualifies for `switch` emission: every
   * case dispatches only on safe machine integers (`n:` keys) and there are at
   * least `MATCH_SWITCH_THRESHOLD` of them. */
  private static matchSwitchable(
    seg: Extract<Segment, { kind: 'dispatch' }>
  ): boolean {
    let count = 0;
    for (const cc of seg.cases) {
      for (const d of cc.dispatchKeys ?? []) {
        if (!d.key.startsWith('n:')) return false;
        count++;
      }
    }
    return count >= BaseCompiler.MATCH_SWITCH_THRESHOLD;
  }

  /** Emit an integer dispatch run as a `switch (s) { case k: … }` (no default —
   * a non-match falls through to the following statements, preserving
   * first-match order across segments). Or-alternatives share one body via
   * `case`-fallthrough; a constant already claimed by an earlier (first-match)
   * case is skipped to avoid a duplicate `case` label. */
  private static emitMatchSwitch(
    engine: ComputeEngine,
    seg: Extract<Segment, { kind: 'dispatch' }>,
    s: string,
    target: CompileTarget<Expression>
  ): string {
    const nl = target.ws('\n');
    const seen = new Set<number>();
    const parts: string[] = [];
    for (const cc of seg.cases) {
      const labels: string[] = [];
      for (const d of cc.dispatchKeys ?? []) {
        const n = Number(d.key.slice(2));
        if (seen.has(n)) continue; // first-match-wins: earlier case owns it
        seen.add(n);
        labels.push(`case ${n}:`);
      }
      if (labels.length === 0) continue; // wholly shadowed → unreachable
      parts.push(
        `${labels.join(' ')} return ${BaseCompiler.compileMatchBody(cc, undefined, target)};`
      );
    }
    return `switch (${s}) {${nl}${parts.join(nl)}${nl}}`;
  }

  /**
   * Compile a `["Match", …]` to a nested ternary via a target-provided
   * `ternary` primitive — the path GPU targets use (they have no statement-level
   * IIFE or `switch`). Only tier 0/1 constant dispatch and a trailing
   * irrefutable case compile; tier 2 destructuring and refutable tier 3 fail
   * closed (D6). The subject is compiled once and inlined into each comparison
   * (safe: compiled shader expressions are deterministic).
   */
  static compileMatchTernary(
    engine: ComputeEngine,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>,
    opts: {
      ternary: (cond: string, whenTrue: string, whenFalse: string) => string;
      eq: string;
      noMatch: string;
      allowStrings: boolean;
    }
  ): TargetSource {
    const plan = getMatchPlan(engine, args);
    if (plan.errorAlt !== undefined)
      throw new Error(
        `Match: an or-alternative binds the name '${plan.errorAlt.toString()}'; not compilable. Fail closed (D6).`
      );

    const subj = BaseCompiler.compile(args[0], target);
    const cases = plan.segments.flatMap((seg) => seg.cases);

    const build = (i: number): string => {
      if (i >= cases.length) return opts.noMatch;
      const cc = cases[i];
      if (BaseCompiler.isIrrefutableCase(cc)) {
        const acc =
          cc.captureNames.length === 1
            ? new Map([[cc.captureNames[0], subj]])
            : undefined;
        return BaseCompiler.compileMatchBody(cc, acc, target);
      }
      if (cc.tier === 0 || cc.tier === 1) {
        const cond = BaseCompiler.matchLeafCondition(
          engine,
          cc,
          subj,
          opts.eq,
          opts.allowStrings,
          target
        );
        const guard = BaseCompiler.compileMatchGuard(cc, undefined, target);
        const full = guard === undefined ? cond : `(${cond}) && (${guard})`;
        return opts.ternary(
          full,
          BaseCompiler.compileMatchBody(cc, undefined, target),
          build(i + 1)
        );
      }
      if (cc.tier === 2)
        throw new Error(
          `Match: list/tuple destructuring is not compilable to "${target.language ?? 'this'}". Fail closed (D6).`
        );
      const p = cc.rawPatterns?.[0];
      throw new Error(
        `Match: pattern '${p?.toString() ?? '?'}' is not compilable; ` +
          `rewrite with destructuring or guards. Fail closed (D6).`
      );
    };

    return build(0);
  }

  /**
   * If `id` names a symbol that is *known* to the engine — it has an assigned
   * value (`ce.assign("a", 1.5)`) or is a declared constant — return the
   * compiled target code for that value, i.e. **fold** the value into the
   * generated code the way `evaluate()` does. Returns `undefined` for a
   * genuinely free symbol (no value), so the caller falls back to its
   * free-symbol plumbing (a `vars` mapping, a `_.id` argument lookup, or a
   * declarable identifier).
   *
   * This keeps the compiled output consistent with `expr.unknowns` and
   * `evaluate()`: a symbol they treat as known (folded / dropped) is also
   * folded by `compile()`, instead of being emitted as a bare, dangling
   * reference (an undeclared GLSL identifier, or a bare JS global that throws
   * `ReferenceError` at run time).
   *
   * Callers MUST resolve any `vars` mapping for `id` **before** calling this,
   * so an explicitly `vars`-mapped symbol is never folded — the GPU/JS live
   * path relies on a mapped symbol staying a per-frame uniform / argument.
   *
   * `target` is the in-flight target: nested symbols inside the value resolve
   * through the same `vars`/constant/fold rules as the top-level expression.
   *
   * The value is compiled at a high precedence so a compound (operator) value
   * self-parenthesizes: folding `b = c + 1` into `b * x` must yield
   * `(c + 1) * x`, not `c + 1 * x`, and must stay safe when a handler splices
   * the folded string into its own expression (e.g. `Power`'s `(code * code)`).
   * An atomic value (number, symbol, function call) ignores the precedence, so
   * no redundant parentheses are added in the common assigned-number case.
   */
  static tryFoldKnownSymbol(
    engine: ComputeEngine,
    id: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const value = engine._getSymbolValue(id);
    if (value === undefined) return undefined;
    return BaseCompiler.compile(value, target, BaseCompiler.FOLD_OPERAND_PREC);
  }

  /**
   * If `id` names a symbol whose engine definition is a user-defined function
   * literal, return that `["Function", body, …params]` literal; otherwise
   * `undefined`. Covers both storage routes:
   *  - an operator definition backed by a lambda (`f(x) := …`, `x ↦ …`, or
   *    `ce.assign(name, lambda)`), where the literal is kept on the operator
   *    definition as `_lambdaLiteral`; and
   *  - a plain symbol whose assigned value is itself a `Function` literal.
   *
   * Public so compilation targets can check whether a symbol operand is
   * structurally callable (e.g. the `Reduce` combiner) before compiling it.
   */
  static userFunctionLiteral(
    engine: ComputeEngine,
    id: string
  ): (Expression & FunctionInterface) | undefined {
    const def = engine.lookupDefinition(id);
    if (def && 'operator' in def) {
      const literal = (def.operator as { _lambdaLiteral?: Expression })
        ._lambdaLiteral;
      if (literal !== undefined && isFunction(literal, 'Function'))
        return literal;
    }
    const value = engine._getSymbolValue(id);
    if (value !== undefined && isFunction(value, 'Function')) return value;
    return undefined;
  }

  /**
   * Generated local-function name for a user-defined function `id`. Prefixed to
   * avoid colliding with the vars object (`_.<name>`) and with target helpers;
   * non-identifier characters are folded to `_` so the emitted declaration is a
   * valid target identifier.
   */
  private static userFunctionName(id: string): string {
    return `_fn_${id.replace(/[^\w$]/g, '_')}`;
  }

  /**
   * If head `h` names a user-defined function (see `userFunctionLiteral`),
   * ensure its definition is emitted once into `target.userFunctions.defs` as a
   * named local function and return the call-site source `_fn_h(arg, …)`.
   * Returns `undefined` when `h` is a genuinely unknown operator (no such
   * definition — the caller then throws), or when the target opts out of user
   * functions by not providing a `userFunctions` registry.
   *
   * Recursion (including mutual recursion) is not compiled in this pass: while a
   * definition's body is being compiled its name sits in `compiling`, so a
   * (mutually) recursive reference is detected and **fails closed (D6)** with an
   * explanatory error rather than looping.
   *
   * Capture semantics: the body is compiled once, at compile time, through the
   * *same* `target` var/fold rules as the surrounding expression (only the
   * parameters are shadowed). Free symbols and constants the body references are
   * therefore snapshotted exactly like the constant-baking `tryFoldKnownSymbol`
   * performs elsewhere — a later reassignment of a captured outer symbol does
   * not affect an already-compiled function.
   */
  static tryCompileUserFunction(
    engine: ComputeEngine,
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource | undefined {
    const name = BaseCompiler.ensureUserFunctionEmitted(engine, h, target);
    if (name === undefined) return undefined;

    const callArgs = args
      .map((a) => BaseCompiler.compileValueOperand(a, target))
      .join(', ');
    return `${name}(${callArgs})`;
  }

  /**
   * If `h` names a user-defined function (see `userFunctionLiteral`) and the
   * target hosts a `userFunctions` registry, ensure its definition is emitted
   * once into `registry.defs` as a named local function (`const _fn_h = …`) and
   * return that local name — so both the call-site path
   * (`tryCompileUserFunction`) and the value-position path (a bare symbol used
   * as a higher-order operand, e.g. `Map(list, h)`) reference the *same* shared
   * local rather than inlining or emitting a dangling identifier.
   *
   * Returns `undefined` when `h` is not a user function or the target opts out
   * of user functions (no registry — GPU / raw direct targets). Recursion is
   * detected via `registry.compiling` and fails closed (D6).
   */
  static ensureUserFunctionEmitted(
    engine: ComputeEngine,
    h: string,
    target: CompileTarget<Expression>
  ): string | undefined {
    const registry = target.userFunctions;
    if (!registry) return undefined;

    const literal = BaseCompiler.userFunctionLiteral(engine, h);
    if (literal === undefined) return undefined;

    const name = BaseCompiler.userFunctionName(h);

    if (!registry.defs.has(name)) {
      if (registry.compiling.has(name))
        throw new Error(
          `Recursive user-defined function \`${h}\` cannot be compiled. Fail closed (D6).`
        );
      registry.compiling.add(name);
      try {
        const params = literal.ops
          .slice(1)
          .map((x) => functionLiteralParameterName(x) || '_');
        // Compile the body with the parameters shadowing the target's `var`
        // resolution (matching the `Function`-literal handler), so a parameter
        // compiles to its bare name rather than a folded value or `_.<name>`.
        // Compiling the body here may register nested user-function
        // dependencies first, so they are emitted before this definition.
        const body = BaseCompiler.compile(literal.ops[0].canonical, {
          ...target,
          var: (id) => (params.includes(id) ? id : target.var(id)),
          boundVars: BaseCompiler.withBoundNames(target, params),
        });
        registry.defs.set(
          name,
          `const ${name} = (${params.join(', ')}) => ${body};`
        );
      } finally {
        registry.compiling.delete(name);
      }
    }

    return name;
  }

  /**
   * Concatenate the user-defined function definitions accumulated in
   * `target.userFunctions` (see `tryCompileUserFunction`) into a preamble
   * fragment, in dependency order. Empty string when there are none.
   */
  static userFunctionsPreamble(target: CompileTarget<Expression>): string {
    const defs = target.userFunctions?.defs;
    if (!defs || defs.size === 0) return '';
    return [...defs.values()].join('\n') + '\n';
  }

  /**
   * Operator heads the compiler lowers directly in `compileExpr`, independent
   * of any target operator/function mapping (control-flow, binding, and
   * indexing-set forms). `analyzeReferences` never reports these as
   * "unsupported".
   */
  private static readonly STRUCTURAL_HEADS: ReadonlySet<string> = new Set([
    'Sequence',
    'Sum',
    'Product',
    'Function',
    'Declare',
    'Assign',
    'Return',
    'Break',
    'Continue',
    'Loop',
    'Comprehension',
    'If',
    'Which',
    'When',
    'Match',
    'Block',
    // Indexing-set wrappers consumed by Sum/Product/Loop — never compiled
    // standalone.
    'Limits',
    'Element',
  ]);

  /**
   * Analyze — without compiling, and never throwing — which external references
   * the generated code for `expr` would have on `target`:
   *
   * - `freeSymbols`: identifiers the caller must supply at run time. These are
   *   the free symbols *as codegen sees them*: symbols with no value in the
   *   engine, after descending into the values of folded (assigned / constant)
   *   symbols — so `a = b + 1` surfaces `b`, which `expr.unknowns` misses — and
   *   after excluding bound variables (lambda parameters, indices of
   *   `Sum`/`Product`/`Integrate`/`Loop`, `Block` locals). A `vars`-mapped
   *   symbol is always included: the mapping makes it an external input even
   *   when it also has an assigned value.
   *
   * - `unsupported`: operator heads with no operator/function mapping in the
   *   target and not one of the structural forms above.
   *
   * Lets a caller validate that a compiled result is self-contained
   * (`freeSymbols` covered by its inputs, `unsupported` empty) declaratively,
   * instead of executing or GPU-compiling the code to discover a dangling
   * reference or an unlowerable operator.
   */
  static analyzeReferences(
    expr: Expression,
    target: CompileTarget<Expression>,
    varsKeys?: ReadonlySet<string>
  ): { freeSymbols: string[]; unsupported: string[] } {
    const engine = expr.engine;
    const free = new Set<string>();
    const unsupported = new Set<string>();
    // Guard against a symbol whose value (transitively) references itself.
    const foldedSeen = new Set<string>();
    // Guard against a (mutually) recursive user-defined function body.
    const userFnSeen = new Set<string>();

    const union = (a: ReadonlySet<string>, more: string[]): Set<string> => {
      const s = new Set(a);
      for (const m of more) s.add(m);
      return s;
    };

    const visit = (e: Expression, bound: ReadonlySet<string>): void => {
      if (isSymbol(e)) {
        const s = e.symbol;
        if (bound.has(s)) return;
        // An operator used as a value (e.g. compiling a bare `Add`) is lowered
        // to a lambda, not a free input.
        if (target.operators?.(s) !== undefined) return;
        // A `vars`-mapped symbol is an external input the caller supplies; the
        // mapping always wins (see `CompileTarget.vars`) — checked before the
        // user-function lowering so a `vars` key that shadows a user-function
        // name stays an external input, consistent with the value-position
        // codegen in `compile`.
        if (varsKeys?.has(s)) {
          free.add(s);
          return;
        }
        // A bare symbol naming a user-defined function, used in value position
        // (a higher-order operand like `Map(list, f)`), is lowered to the
        // shared emitted local `_fn_f` — not a free input. Descend into its
        // body (parameters bound) to surface transitively referenced free
        // symbols; guard against recursion. Mirrors the value-position codegen
        // in `compile` and the head-position handling below. (A bound name is
        // already handled by the `bound.has(s)` guard above.)
        if (target.userFunctions !== undefined) {
          const symLiteral = BaseCompiler.userFunctionLiteral(engine, s);
          if (symLiteral !== undefined) {
            if (!userFnSeen.has(s)) {
              userFnSeen.add(s);
              const params = symLiteral.ops
                .slice(1)
                .map((p) => functionLiteralParameterName(p))
                .filter((name) => name !== '');
              visit(
                symLiteral.ops[0],
                params.length ? union(bound, params) : bound
              );
            }
            return;
          }
        }
        // A symbol with a value (assigned, or a constant like `Pi`) is folded
        // into the code; descend into the value to surface any transitively
        // referenced free symbols.
        const value = engine._getSymbolValue(s);
        if (value !== undefined) {
          if (!foldedSeen.has(s)) {
            foldedSeen.add(s);
            visit(value, bound);
          }
          return;
        }
        // No mapping, no value, not a constant: a genuinely free symbol.
        free.add(s);
        return;
      }

      if (!isFunction(e)) return; // numbers, strings: nothing to collect

      // Capture `ops`/`h` up front: narrowing `e` with `isFunction(e, 'X')`
      // below would otherwise strip `.ops` from `e` in the fall-through.
      const h = e.operator;
      const ops: ReadonlyArray<Expression> = e.ops;

      // A head that names a user-defined function literal is lowerable (emitted
      // as a named local function — see `tryCompileUserFunction`), not
      // unsupported. Descend into its body (parameters bound) so free symbols it
      // references transitively are surfaced; guard against recursion.
      const userLiteral =
        target.userFunctions !== undefined &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined
          ? BaseCompiler.userFunctionLiteral(engine, h)
          : undefined;

      // A head whose operator definition supplies a custom `compile` handler
      // (the public per-operator extension point) MAY be lowerable via that
      // handler even with no operator/function mapping — so it must NOT be
      // reported as unsupported (finding A4). But a handler can decline for the
      // current target language, returning `undefined`/`null`/`''` (see the
      // handler consult in `compileExpr`); assuming support unconditionally
      // would under-report `unsupported` for e.g. a JavaScript-only handler on
      // a glsl/python target. So probe the handler with the real recursive
      // compile machinery in a throwaway context: a non-empty string return
      // means it lowers this head, while `undefined`/`null`/`''`/throw means it
      // declined. Executing the handler here is safe — the compile path would
      // run the same handler on the same expression anyway. The probe only runs
      // when no other lowering applies (structural/control-flow heads are not
      // overridable and are excluded, matching the consult in `compileExpr`).
      let hasCustomCompile = false;
      if (
        !BaseCompiler.CONTROL_FLOW_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined &&
        userLiteral === undefined
      ) {
        const customCompileDef = engine.lookupDefinition(h);
        if (
          isOperatorDef(customCompileDef) &&
          typeof customCompileDef.operator.compile === 'function'
        ) {
          try {
            const probe = customCompileDef.operator.compile(
              ops,
              (e) => BaseCompiler.compileValueOperand(e, target),
              { language: target.language ?? 'javascript' }
            );
            hasCustomCompile =
              probe !== undefined && probe !== null && probe !== '';
          } catch {
            hasCustomCompile = false;
          }
        }
      }

      if (
        h !== 'Error' &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined &&
        userLiteral === undefined &&
        !hasCustomCompile
      )
        unsupported.add(h);

      if (userLiteral !== undefined) {
        if (!userFnSeen.has(h)) {
          userFnSeen.add(h);
          const params = userLiteral.ops
            .slice(1)
            .map((p) => functionLiteralParameterName(p))
            .filter((name) => name !== '');
          visit(
            userLiteral.ops[0],
            params.length ? union(bound, params) : bound
          );
        }
        // The call arguments are evaluated in the surrounding scope.
        for (const op of ops) visit(op, bound);
        return;
      }

      // Binding forms: shadow their bound variables in the body, but visit the
      // bound expressions (limits / collections) in the outer scope.
      if (h === 'Function') {
        const params = ops
          .slice(1)
          .map((p) => functionLiteralParameterName(p))
          .filter((name) => name !== '');
        visit(ops[0], params.length ? union(bound, params) : bound);
        return;
      }
      if (
        h === 'Sum' ||
        h === 'Product' ||
        h === 'Integrate' ||
        h === 'Loop' ||
        h === 'Comprehension'
      ) {
        const indices: string[] = [];
        const limitExprs: Expression[] = [];
        for (const clause of ops.slice(1)) {
          if (isFunction(clause)) {
            if (isSymbol(clause.ops[0])) indices.push(clause.ops[0].symbol);
            for (const sub of clause.ops.slice(1)) limitExprs.push(sub);
          } else {
            limitExprs.push(clause);
          }
        }
        visit(ops[0], indices.length ? union(bound, indices) : bound);
        for (const le of limitExprs) visit(le, bound);
        return;
      }
      if (h === 'Block') {
        const locals: string[] = [];
        for (const stmt of ops)
          if (isFunction(stmt, 'Declare') && isSymbol(stmt.ops[0]))
            locals.push(stmt.ops[0].symbol);
        const inner = locals.length ? union(bound, locals) : bound;
        for (const op of ops) visit(op, inner);
        return;
      }
      if (h === 'Match') {
        // The subject is evaluated in the enclosing scope.
        if (ops[0] !== undefined) visit(ops[0], bound);
        for (const c of ops.slice(1)) {
          if (!isFunction(c, 'MatchCase') || c.ops.length < 2) continue;
          const cops = c.ops;
          const pattern = cops[0];
          const guard = cops.length >= 3 ? cops[1] : undefined;
          const body = cops[cops.length - 1];
          // Captures shadow the guard/body; pin operands are external references
          // (evaluated in the enclosing scope at match time).
          const { captures, pinExprs } = matchPatternReferences(pattern);
          const inner = captures.length ? union(bound, captures) : bound;
          if (guard !== undefined) visit(guard, inner);
          visit(body, inner);
          for (const pin of pinExprs) visit(pin, bound);
        }
        return;
      }

      for (const op of ops) visit(op, bound);
    };

    visit(expr, new Set());
    return { freeSymbols: [...free], unsupported: [...unsupported] };
  }

  /**
   * Attach `freeSymbols` / `unsupported` (from `analyzeReferences`) to a
   * compilation result, returning the same object. Used by the built-in
   * targets to make every result carry its declarative reference analysis.
   */
  static withReferences<
    R extends { freeSymbols?: string[]; unsupported?: string[] },
  >(
    result: R,
    expr: Expression,
    target: CompileTarget<Expression>,
    varsKeys?: ReadonlySet<string>
  ): R {
    return Object.assign(
      result,
      BaseCompiler.analyzeReferences(expr, target, varsKeys)
    );
  }

  /**
   * Build the documented `success: false` compilation result for an expression
   * that could not be lowered to the target, with `run` set to an
   * interpreter-backed evaluator (the "fall back to interpretation" contract).
   *
   * This is the shared implementation behind both the engine-level free-function
   * `compile()` (which always falls back unless `fallback: false`) and the
   * built-in `LanguageTarget.compile()` methods (which throw by default, but
   * fall back to this shape when the caller opts in with `fallback: true`). The
   * `run` closure mirrors `evaluate()` semantics: a scalar collapses to its real
   * part, a finite indexed collection materializes to a nested JS array, and a
   * `Function` literal uses the positional `lambda` calling convention.
   *
   * `error` is preserved on the result so the caller can report *why* it could
   * not be compiled without re-throwing; `compileTarget` (when available) drives
   * the declarative `freeSymbols`/`unsupported` reference analysis. This method
   * never throws for a compile reason — the reference analysis is guarded.
   */
  static buildInterpreterFallback<T extends string>(
    expr: Expression,
    error: string,
    targetName: T,
    compileTarget: CompileTarget<Expression> | undefined,
    varsKeys: Set<string> | undefined
  ): CompilationResult<T> {
    const ce = expr.engine;

    // Materialize an interpreted result matching `evaluate()`: a scalar yields
    // its real part (the compiled-runner numeric contract), a finite indexed
    // collection becomes a nested JS array of element values.
    const interpretedRunValue = (e: Expression): number | unknown[] => {
      if (e.isCollection) return [...e.each()].map(interpretedRunValue);
      return e.re;
    };

    // Declarative reference analysis so the (success: false) result still tells
    // the caller *why* it could not be compiled without parsing `error`. Never
    // let the analysis itself break the fallback.
    let refs: { freeSymbols: string[]; unsupported: string[] } = {
      freeSymbols: [],
      unsupported: [],
    };
    try {
      if (compileTarget)
        refs = BaseCompiler.analyzeReferences(expr, compileTarget, varsKeys);
    } catch {
      /* keep the empty analysis */
    }

    // A function literal (lambda) uses the positional `lambda` calling
    // convention — `run(a, b, ...)`. The fallback must mirror that by applying
    // the function to its positional arguments via the interpreter; otherwise
    // positional arguments are silently dropped.
    if (isFunction(expr, 'Function')) {
      const lambdaRun = ((...args: number[]) =>
        ce.function('Apply', [expr, ...args.map((a) => ce.expr(a))]).evaluate()
          .re) as unknown as CompiledRunner;
      return {
        target: targetName,
        success: false,
        code: '',
        calling: 'lambda',
        run: lambdaRun,
        error,
        ...refs,
      } as CompilationResult<T>;
    }

    // Otherwise the expression uses the `expression` calling convention:
    // `run({ x, y, ... })` with a variables object.
    const fallbackRun = ((vars: Record<string, number>) => {
      ce.pushScope();
      try {
        if (vars && typeof vars === 'object') {
          for (const [k, v] of Object.entries(vars)) {
            // Declare a fresh local shadow before assigning so `popScope` fully
            // restores the previous state (a bare `assign` would mutate an
            // outer/global binding and leak the argument value engine-wide).
            ce.declare(k, 'number');
            ce.assign(k, v);
          }
        }
        return interpretedRunValue(expr.evaluate());
      } finally {
        ce.popScope();
      }
    }) as unknown as CompiledRunner;
    return {
      target: targetName,
      success: false,
      code: '',
      calling: 'expression',
      run: fallbackRun,
      error,
      ...refs,
    } as CompilationResult<T>;
  }

  /**
   * Extend a target's `boundVars` set with additional locally-bound names
   * (lambda parameters, loop indices, block locals, comprehension variables,
   * `Match` captures). Returns a set suitable for spreading into an inner
   * target alongside its `var` override, so `compile` recognizes a
   * value-position reference to the bound name as a local — not a free
   * user-function reference to capture — even when the binding form resolves
   * the name to non-identity code. See finding A2. Empty `names` returns the
   * existing set unchanged (no allocation).
   */
  static withBoundNames(
    target: CompileTarget<Expression>,
    names: ReadonlyArray<string>
  ): ReadonlySet<string> | undefined {
    const nonEmpty = names.filter((n) => n !== '' && n !== undefined);
    if (nonEmpty.length === 0) return target.boundVars;
    const s = new Set(target.boundVars);
    for (const n of nonEmpty) s.add(n);
    return s;
  }

  /**
   * Generate a temporary variable name
   */
  static tempVar(): string {
    return `_${Math.random().toString(36).substring(4)}`;
  }

  /**
   * Inline or wrap expression in IIFE based on complexity
   */
  static inlineExpression(body: string, x: string): string {
    // Check if `x` is a simple value (like a number or a simple symbol)
    const isSimple = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(x) || /^[0-9]+$/.test(x);

    if (isSimple) {
      // Inline the body if `x` is simple
      return new Function('x', `return \`${body}\`;`)(x);
    } else {
      // Generate an IIFE if `x` is a complex expression
      const t = BaseCompiler.tempVar();
      return new Function(
        'x',
        `return \`(() => { const ${t} = \${x}; return ${body.replace(
          /\\\${x}/g,
          t
        )}; })()\`;`
      )(x);
    }
  }
}
