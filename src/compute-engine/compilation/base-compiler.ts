import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import { isOperatorDef } from '../boxed-expression/utils.js';
import { isFiniteIndexedCollection } from '../collection-utils.js';
import { isRelationalOperator } from '../latex-syntax/utils.js';
import { normalizeIndexingSet } from '../library/utils.js';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';

import type { CompileTarget, TargetSource } from './types.js';

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

    // Is it a symbol?
    if (isSymbol(expr)) {
      const s = expr.symbol;
      const op = target.operators?.(s);
      if (op !== undefined) {
        // We're compiling something like "Add"
        return `(a,b) => a ${op[0]} b`;
      }
      const resolved = target.var?.(s);
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

    // Scalar arithmetic over a list-valued operand has no committed coverage on
    // the JavaScript target: the built-in lowering emits element-wise-impossible
    // scalar JS and silently returns garbage (`[1,2,3] + x` → the *string*
    // "1,2,31"; `list * scalar` → NaN). Fail closed (D6) with the offending head
    // so the engine-level `compile()` reports `success: false` and falls back to
    // the interpreter (which broadcasts correctly), rather than returning a
    // wrong result behind a `success: true`.
    //
    // Deliberately narrow, to avoid false positives on genuinely supported list
    // forms:
    //   - GLSL/WGSL/GPU targets have native vector types (`vec3 + vec3`), so the
    //     guard is scoped to `javascript` only.
    //   - A user `operators` override that lowers the head to a *function call*
    //     (an identifier like `add`, not a symbolic infix `+`) takes
    //     responsibility for list operands (Issue #240) — only the built-in
    //     symbolic lowering (`+`, `*`, `_SYS.pow`) produces garbage.
    //   - Broadcasting a unary operator/function over a single finite indexed
    //     collection (`-[1,2,3]`, `\sqrt{[1,4,9]}`, `\sin([x, 2x])`) is handled
    //     below via `.map` and is supported.
    // Materialize the list with `evaluate()` and compile a scalar element
    // function for anything else.
    if (
      target.language === 'javascript' &&
      BaseCompiler.SCALAR_ARITHMETIC_HEADS.has(h) &&
      args.some((a) => a.isCollection)
    ) {
      const opMap = target.operators?.(h);
      const lowersToScalarInfix =
        opMap === undefined || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(opMap[0]);
      const def = engine.lookupDefinition(h);
      const isUnaryBroadcast =
        args.length === 1 &&
        isOperatorDef(def) &&
        def.operator.broadcastable === true &&
        isFiniteIndexedCollection(args[0]);
      if (lowersToScalarInfix && !isUnaryBroadcast)
        throw new Error(
          `${h}: cannot compile scalar arithmetic over a list-valued operand — the JavaScript compile target has no list-arithmetic support. Fail closed (D6). Materialize the list with evaluate() and compile a scalar element function instead.`
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
      const params = args.slice(1).map((x) => (isSymbol(x) ? x.symbol : '_'));
      return `((${params.join(', ')}) => ${BaseCompiler.compile(
        args[0].canonical,
        {
          ...target,
          var: (id) => (params.includes(id) ? id : target.var(id)),
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

    if (h === 'Block') {
      return BaseCompiler.compileBlock(args, target);
    }

    // Handle function calls
    const fn = target.functions?.(h);
    if (!fn) throw new Error(`Unknown operator \`${h}\``);

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

    // Infer GPU type hints for block locals.
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
      const isWGSL = target.language === 'wgsl';
      const vec2 = isWGSL ? 'vec2f' : 'vec2';
      for (const local of locals) {
        for (const arg of args) {
          // Honor an explicit complex type on the `Declare` itself.
          if (
            isFunction(arg, 'Declare') &&
            isSymbol(arg.ops[0], local) &&
            isSymbol(arg.ops[1], 'complex')
          ) {
            typeHints[local] = vec2;
            break;
          }
          // Otherwise infer from the assigned value (complex ⇒ vec2;
          // all real/integer scalars fall through to the float default).
          if (isFunction(arg, 'Assign') && isSymbol(arg.ops[0], local)) {
            if (BaseCompiler.isComplexValued(arg.ops[1]))
              typeHints[local] = vec2;
            break;
          }
        }
      }
    }

    const localTarget: CompileTarget<Expression> = {
      ...target,
      var: (id) => {
        if (locals.includes(id)) return id;
        return target.var(id);
      },
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

    const fn = BaseCompiler.compile(args[0], {
      ...target,
      var: (id) => {
        if (id === index) return index;
        return target.var(id);
      },
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
   * Determine at compile time whether an expression produces a complex value.
   *
   * Uses the expression's declared type (from operator signatures) when
   * available. Falls back to operand inspection for functions whose
   * return type is unknown.
   */
  static isComplexValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im !== 0;

    if (isSymbol(expr)) {
      if (expr.symbol === 'ImaginaryUnit') return true;
      const t = expr.type;
      if (!t) return false;
      return t.matches('complex') && !t.matches('real');
    }

    if (isFunction(expr)) {
      // Check the function's return type from its operator definition
      const t = expr.type;
      if (t.matches('complex') && !t.matches('real')) return true;
      if (t.matches('real')) return false;

      // Return type is unknown — fall back to checking whether any
      // operand is complex (conservative: assumes function propagates
      // complex-ness from its inputs)
      return expr.ops.some((arg) => BaseCompiler.isComplexValued(arg));
    }

    return false;
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
  static guardCondition(
    cond: Expression,
    target: CompileTarget<Expression>
  ): TargetSource {
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
        // mapping wins over folding.
        if (varsKeys?.has(s)) {
          free.add(s);
          return;
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
      if (
        h !== 'Error' &&
        !BaseCompiler.STRUCTURAL_HEADS.has(h) &&
        target.functions?.(h) === undefined &&
        target.operators?.(h) === undefined
      )
        unsupported.add(h);

      // Binding forms: shadow their bound variables in the body, but visit the
      // bound expressions (limits / collections) in the outer scope.
      if (h === 'Function') {
        const params = ops
          .slice(1)
          .filter((p) => isSymbol(p))
          .map((p) => (p as Expression & { symbol: string }).symbol);
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
