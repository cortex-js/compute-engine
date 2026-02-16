import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isOperatorDef } from '../boxed-expression/utils';
import { isFiniteIndexedCollection } from '../collection-utils';
import { isRelationalOperator } from '../latex-syntax/utils';
import { normalizeIndexingSet } from '../library/utils';
import {
  isSymbol,
  isNumber,
  isString,
  isFunction,
} from '../boxed-expression/type-guards';

import type { CompileTarget, TargetSource } from './types';

/**
 * Base compiler class containing language-agnostic compilation logic
 */
export class BaseCompiler {
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
      return target.var?.(s) ?? s;
    }

    // Is it a number?
    if (isNumber(expr)) {
      if (expr.im !== 0) {
        if (!target.complex)
          throw new Error('Complex numbers are not supported by this target');
        return target.complex(expr.re, expr.im);
      }
      return target.number(expr.re);
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
      return `(${args.map((arg) => BaseCompiler.compile(arg, target, prec)).join(', ')})`;
    }

    if (h === 'Sum' || h === 'Product') {
      // Delegate to target-specific function handler if available,
      // otherwise fall back to the generic loop compilation.
      const sumProdFn = target.functions?.(h);
      if (typeof sumProdFn === 'function') {
        return sumProdFn(
          args,
          (expr) => BaseCompiler.compile(expr, target),
          target
        );
      }
      if (typeof sumProdFn === 'string') {
        return `${sumProdFn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
      }
      return BaseCompiler.compileLoop(h, args, target);
    }

    // Handle operators
    const op = target.operators?.(h);

    if (op !== undefined) {
      // Skip infix operators for complex operands — fall through to function dispatch
      const hasComplex = args.some((a) => BaseCompiler.isComplexValued(a));
      if (!hasComplex) {
        // Check if this looks like a function name rather than an operator
        // Function names are alphanumeric identifiers, operators are symbols
        const isFunction = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(op[0]);

        if (isFunction) {
          // Compile as a function call (works for both scalar and collection arguments)
          return `${op[0]}(${args.map((arg) => BaseCompiler.compile(arg, target)).join(', ')})`;
        } else {
          // Compile as an operator (only for non-collection arguments)
          if (args.every((x) => !x.isCollection)) {
            if (isRelationalOperator(h) && args.length > 2) {
              // Chain relational operators
              const result: string[] = [];
              for (let i = 0; i < args.length - 1; i++) {
                result.push(
                  BaseCompiler.compileExpr(
                    engine,
                    h,
                    [args[i], args[i + 1]],
                    op[1],
                    target
                  )
                );
              }
              return `(${result.join(') && (')})`;
            }

            let resultStr: string;
            if (args.length === 1) {
              // Unary operator, assume prefix
              resultStr = `${op[0]}${BaseCompiler.compile(args[0], target, op[1])}`;
            } else {
              resultStr = args
                .map((arg) => BaseCompiler.compile(arg, target, op[1]))
                .join(` ${op[0]} `);
            }
            return op[1] < prec ? `(${resultStr})` : resultStr;
          }
        }
      }
    }

    // Handle special constructs
    if (h === 'Function') {
      // Anonymous function
      const params = args.slice(1).map((x) => (isSymbol(x) ? x.symbol : '_'));
      return `((${params.join(', ')}) => ${BaseCompiler.compile(
        args[0].canonical,
        {
          ...target,
          var: (id) => (params.includes(id) ? id : target.var(id)),
        }
      )})`;
    }

    if (h === 'Declare')
      return `let ${isSymbol(args[0]) ? args[0].symbol : '_'}`;
    if (h === 'Assign')
      return `${isSymbol(args[0]) ? args[0].symbol : '_'} = ${BaseCompiler.compile(args[1], target)}`;
    if (h === 'Return')
      return `return ${BaseCompiler.compile(args[0], target)}`;
    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';

    if (h === 'Loop') return BaseCompiler.compileForLoop(args, target);

    if (h === 'If') {
      if (args.length !== 3) throw new Error('If: wrong number of arguments');
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(args, (expr) => BaseCompiler.compile(expr, target), target);
        }
        return `${fn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
      }
      return `((${BaseCompiler.compile(args[0], target)}) ? (${BaseCompiler.compile(
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
          return fn(args, (expr) => BaseCompiler.compile(expr, target), target);
        }
        return `${fn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
      }
      // Compile to chained ternaries
      const compilePair = (i: number): string => {
        if (i >= args.length) return 'NaN';
        const cond = args[i];
        const val = args[i + 1];
        // If condition is the symbol True, it's the default branch
        if (isSymbol(cond) && cond.symbol === 'True') {
          return `(${BaseCompiler.compile(val, target)})`;
        }
        return `((${BaseCompiler.compile(cond, target)}) ? (${BaseCompiler.compile(val, target)}) : ${compilePair(i + 2)})`;
      };
      return compilePair(0);
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
        return `(${BaseCompiler.compile(args[0], target)}).map((${v}) => ${fn(
          [args[0].engine.box(v)],
          (expr) => BaseCompiler.compile(expr, target),
          target
        )})`;
      }
      return fn(args, (expr) => BaseCompiler.compile(expr, target), target);
    }

    return `${fn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
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
      if (arg.operator === 'Declare' && isFunction(arg)) {
        const firstOp = arg.ops[0];
        if (isSymbol(firstOp)) locals.push(firstOp.symbol);
      }
    }

    if (args.length === 1 && locals.length === 0) {
      return BaseCompiler.compile(args[0], target);
    }

    const result = args.map((arg) =>
      BaseCompiler.compile(arg, {
        ...target,
        var: (id) => {
          if (locals.includes(id)) return id;
          return target.var(id);
        },
      })
    );

    // Add a return statement to the last expression
    result[result.length - 1] = `return ${result[result.length - 1]}`;
    return `(() => {${target.ws('\n')}${result.join(
      `;${target.ws('\n')}`
    )}${target.ws('\n')}})()`;
  }

  /**
   * Compile a Loop expression with Element(index, Range(lo, hi)) indexing.
   * Generates: (() => { for (let i = lo; i <= hi; i++) { body } })()
   */
  private static compileForLoop(
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): TargetSource {
    if (!args[0]) throw new Error('Loop: no body');
    if (!args[1]) throw new Error('Loop: no indexing set');

    const indexing = args[1];
    if (indexing.operator !== 'Element' || !isFunction(indexing))
      throw new Error('Loop: expected Element(index, Range(lo, hi))');

    const indexExpr = indexing.ops[0];
    const rangeExpr = indexing.ops[1];

    if (!isSymbol(indexExpr)) throw new Error('Loop: index must be a symbol');
    if (rangeExpr.operator !== 'Range' || !isFunction(rangeExpr))
      throw new Error('Loop: expected Range(lo, hi)');

    const index = indexExpr.symbol;
    const lower = BaseCompiler.compile(rangeExpr.ops[0], target);
    const upper = BaseCompiler.compile(rangeExpr.ops[1], target);

    const bodyTarget: CompileTarget<Expression> = {
      ...target,
      var: (id: string) => (id === index ? index : target.var(id)),
    };

    const bodyStmts = BaseCompiler.compileLoopBody(args[0], bodyTarget);

    return `(() => {${target.ws('\n')}for (let ${index} = ${lower}; ${index} <= ${upper}; ${index}++) {${target.ws('\n')}${bodyStmts}${target.ws('\n')}}${target.ws('\n')}})()`;
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
    if (isSymbol(expr) && expr.symbol === 'Nothing') return '';
    if (!isFunction(expr)) return BaseCompiler.compile(expr, target);

    const h = expr.operator;

    if (h === 'Break') return 'break';
    if (h === 'Continue') return 'continue';
    if (h === 'Return')
      return `return ${BaseCompiler.compile(expr.ops[0], target)}`;

    if (h === 'If') {
      const cond = BaseCompiler.compile(expr.ops[0], target);
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
   * Compile loop constructs (Sum/Product)
   */
  private static compileLoop(
    h: string,
    args: ReadonlyArray<Expression>,
    target: CompileTarget<Expression>
  ): string {
    if (!args[0]) throw new Error('Sum/Product: no body');

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

    if (bodyIsComplex) {
      const val = BaseCompiler.tempVar();
      if (isSum) {
        return `(() => {
  let ${acc} = { re: 0, im: 0 };
  let ${index} = ${lower};
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
  let ${index} = ${lower};
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
  let ${index} = ${lower};
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
   * Rules:
   * - Numbers: complex if im !== 0
   * - Symbols: ImaginaryUnit is complex; others use expr.isReal
   *   (undefined is treated as real -- assume-real policy)
   * - Functions: Abs, Arg, Re, Im always return real.
   *   All others: complex if any operand is complex.
   */
  static isComplexValued(expr: Expression): boolean {
    if (isNumber(expr)) return expr.im !== 0;

    if (isSymbol(expr)) {
      if (expr.symbol === 'ImaginaryUnit') return true;
      // A symbol is complex-valued if its type is a subtype of complex
      // but NOT a subtype of real (e.g., 'complex', 'imaginary',
      // 'finite_complex'). Symbols typed as 'number' or 'real' (or its
      // subtypes like 'finite_real', 'integer') are treated as real.
      const t = expr.type;
      if (!t) return false;
      return t.matches('complex') && !t.matches('real');
    }

    if (isFunction(expr)) {
      const op = expr.operator;
      // These functions always return real regardless of input
      if (op === 'Abs' || op === 'Arg' || op === 'Re' || op === 'Im')
        return false;
      // For all other functions, complex if any operand is complex
      return expr.ops.some((arg) => BaseCompiler.isComplexValued(arg));
    }

    return false;
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
        `return \`(() => { const ${t} = \${x}; return ${body.replace(/\\\${x}/g, t)}; })()\`;`
      )(x);
    }
  }
}
