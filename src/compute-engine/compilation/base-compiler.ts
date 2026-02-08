import type {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
} from '../global-types';
import { isOperatorDef } from '../boxed-expression/utils';
import { isFiniteIndexedCollection } from '../collection-utils';
import { isRelationalOperator } from '../latex-syntax/utils';
import { normalizeIndexingSet } from '../library/utils';

import type { CompileTarget, TargetSource } from './types';

/**
 * Base compiler class containing language-agnostic compilation logic
 */
export class BaseCompiler {
  /**
   * Compile an expression to target language source code
   */
  static compile(
    expr: BoxedExpression | undefined,
    target: CompileTarget,
    prec = 0
  ): TargetSource {
    if (expr === undefined) return '';
    if (!expr.isValid) {
      throw new Error(
        `Cannot compile invalid expression: "${expr.toString()}"`
      );
    }

    // Is it a symbol?
    const s = expr.symbol;
    if (s !== null) {
      const op = target.operators?.(s);
      if (op !== undefined) {
        // We're compiling something like "Add"
        return `(a,b) => a ${op[0]} b`;
      }
      return target.var?.(s) ?? s;
    }

    // Is it a number?
    if (expr.isNumberLiteral) {
      if (expr.im !== 0) throw new Error('Complex numbers are not supported');
      return target.number(expr.re);
    }

    // Is it a string?
    const str = expr.string;
    if (str !== null) return target.string(str);

    // It must be a function expression...
    return BaseCompiler.compileExpr(
      expr.engine,
      expr.operator,
      expr.ops!,
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
    args: ReadonlyArray<BoxedExpression>,
    prec: number,
    target: CompileTarget
  ): TargetSource {
    if (h === 'Error') throw new Error('Error');

    if (h === 'Sequence') {
      if (args.length === 0) return '';
      return `(${args.map((arg) => BaseCompiler.compile(arg, target, prec)).join(', ')})`;
    }

    if (h === 'Sum' || h === 'Product') {
      return BaseCompiler.compileLoop(h, args, target);
    }

    // Handle operators
    const op = target.operators?.(h);

    if (op !== undefined) {
      // Check if this looks like a function name rather than an operator
      // Function names are alphanumeric identifiers, operators are symbols
      const isFunction = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(op[0]);

      if (isFunction) {
        // Compile as a function call (works for both scalar and collection arguments)
        if (args === null) return `${op[0]}()`;
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

          if (args === null) return '';
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

    // Handle special constructs
    if (h === 'Function') {
      // Anonymous function
      const params = args.slice(1).map((x) => x.symbol);
      return `((${params.join(', ')}) => ${BaseCompiler.compile(
        args[0].canonical,
        {
          ...target,
          var: (id) => (params.includes(id) ? id : target.var(id)),
        }
      )})`;
    }

    if (h === 'Declare') return `let ${args[0].symbol}`;
    if (h === 'Assign')
      return `${args[0].symbol} = ${BaseCompiler.compile(args[1], target)}`;
    if (h === 'Return')
      return `return ${BaseCompiler.compile(args[0], target)}`;

    if (h === 'If') {
      if (args.length !== 3) throw new Error('If: wrong number of arguments');
      const fn = target.functions?.(h);
      if (fn) {
        if (typeof fn === 'function') {
          return fn(args, (expr) => BaseCompiler.compile(expr, target), target);
        }
        if (args === null) return `${fn}()`;
        return `${fn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
      }
      return `((${BaseCompiler.compile(args[0], target)}) ? (${BaseCompiler.compile(
        args[1],
        target
      )}) : (${BaseCompiler.compile(args[2], target)}))`;
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

    if (args === null) return `${fn}()`;
    return `${fn}(${args.map((x) => BaseCompiler.compile(x, target)).join(', ')})`;
  }

  /**
   * Compile a block expression
   */
  private static compileBlock(
    args: ReadonlyArray<BoxedExpression>,
    target: CompileTarget
  ): TargetSource {
    // Get all the Declare statements
    const locals: string[] = [];
    for (const arg of args) {
      if (arg.operator === 'Declare') locals.push(arg.ops![0].symbol!);
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
   * Compile loop constructs (Sum/Product)
   */
  private static compileLoop(
    h: string,
    args: ReadonlyArray<BoxedExpression>,
    target: CompileTarget
  ): string {
    if (args === null) throw new Error('Sum/Product: no arguments');
    if (!args[0]) throw new Error('Sum/Product: no body');

    const {
      index,
      lower,
      upper,
      isFinite: _isFinite,
    } = normalizeIndexingSet(args[1]);
    const op = h === 'Sum' ? '+' : '*';

    if (!index) {
      // Loop over a collection
      const indexVar = BaseCompiler.tempVar();
      const acc = BaseCompiler.tempVar();
      const col = BaseCompiler.compile(args[0], target);
      return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
        op === '+' ? '0' : '1'
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

    return `(() => {
  let ${acc} = ${op === '+' ? '0' : '1'};
  let ${index} = ${lower};
  while (${index} <= ${upper}) {
    ${acc} ${op}= ${fn};
    ${index}++;
  }
  return ${acc};
})()`;
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
