import { MathJsonIdentifier } from '../math-json/math-json-format';
import { asFloat } from './boxed-expression/numerics';
import { isRelationalOperator } from './boxed-expression/utils';
import { isCollection, isFiniteIndexableCollection } from './collection-utils';
import { normalizeIndexingSet } from './library/utils';
import {
  chop,
  factorial,
  gamma,
  gcd,
  lcm,
  gammaln,
  limit,
  monteCarloEstimate,
} from './numerics/numeric';
import { BoxedExpression } from './public';

export type CompiledType = boolean | number | string | object;

type JSSource = string;

export type CompiledOperators = Record<
  MathJsonIdentifier,
  [op: string, prec: number]
>;

export type CompiledFunctions = {
  [id: MathJsonIdentifier]:
    | string
    | ((
        args: ReadonlyArray<BoxedExpression>,
        compile: (expr: BoxedExpression) => JSSource,
        target: CompileTarget
      ) => JSSource);
};

const NATIVE_JS_OPERATORS: CompiledOperators = {
  Add: ['+', 11],
  Negate: ['-', 14], // Unary operator
  Subtract: ['-', 11],
  Multiply: ['*', 12],
  Divide: ['/', 13],
  Equal: ['===', 8],
  NotEqual: ['!==', 8],
  LessEqual: ['<=', 9],
  GreaterEqual: ['>=', 9],
  Less: ['<', 9],
  Greater: ['>', 9],
  And: ['&&', 4],
  Or: ['||', 3],
  Not: ['!', 14], // Unary operator
  // Xor: ['^', 6], // That's bitwise XOR, not logical XOR
  // Possible solution is to use `a ? !b : b` instead of `a ^ b`
};

const NATIVE_JS_FUNCTIONS: CompiledFunctions = {
  Abs: 'Math.abs',
  Add: (args, compile) => {
    if (args.length === 1) return compile(args[0]);
    // if (args.length > 2) {

    // }
    // const maxLength = Math.max(...args.map((x) => length(x) ?? 1));
    return `(${args.map((x) => compile(x)).join(' + ')})`;
  },
  Arccos: 'Math.acos',
  Arcosh: 'Math.acosh',
  Arsin: 'Math.asin',
  Arsinh: 'Math.asinh',
  Arctan: 'Math.atan',
  Artanh: 'Math.atanh',
  // Math.cbrt
  Ceiling: 'Math.ceil',
  Chop: '_SYS.chop',
  Cos: 'Math.cos',
  Cosh: 'Math.cosh',
  Exp: 'Math.exp',
  Floor: 'Math.floor',
  Gamma: '_SYS.gamma',
  GCD: '_SYS.gcd',
  // Math.hypot
  Integrate: (args, compile, target) => compileIntegrate(args, compile, target),
  LCM: '_SYS.lcm',
  Limit: (args, compile) =>
    `_SYS.limit(${compile(args[0])}, ${compile(args[1])})`,
  Ln: 'Math.log',
  List: (args, compile) => `[${args.map((x) => compile(x)).join(', ')}]`,
  Log: (args, compile) => {
    if (args.length === 1) return `Math.log(${compile(args[0])})`;
    return `(Math.log(${compile(args[0])}) / Math.log(${compile(args[1])}))`;
  },
  LogGamma: '_SYS.lngamma',
  Lb: 'Math.log2',
  Max: 'Math.max',
  Min: 'Math.min',
  Power: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Power: no argument');
    const exp = asFloat(args[1]);
    if (exp === 0.5) return `Math.sqrt(${compile(arg)})`;
    if (exp === 1 / 3) return `Math.cbrt(${compile(arg)})`;
    if (exp === 1) return compile(arg);
    if (exp === -1) return `1 / (${compile(arg)})`;
    if (exp === -0.5) return `1 / Math.sqrt(${compile(arg)})`;
    return `Math.pow(${compile(arg)}, ${compile(args[1])})`;
  },
  Range: (args, compile) => {
    // args could either be missing, or not a number
    if (args.length === 0) return '[]';
    if (args.length === 1)
      return `Array.from({length: ${compile(args[0])}}, (_, i) => i)`;

    let start = compile(args[0]);
    let stop = compile(args[1]);
    const step = args[2] ? compile(args[2]) : '1';
    if (start === null) throw new Error('Range: no start');
    if (stop === null) {
      stop = start;
      start = '1';
    }
    if (step === '0') throw new Error('Range: step cannot be zero');
    if (parseFloat(step) === 1.0) {
      const fStop = parseFloat(stop);
      const fStart = parseFloat(start);

      if (fStop !== null && fStart !== null) {
        if (fStop - fStart < 50) {
          return `[${Array.from(
            { length: fStop - fStart + 1 },
            (_, i) => fStart + i
          ).join(', ')}]`;
        }
        return `Array.from({length: ${fStop - fStart + 1} 
        }, (_, i) => ${start} + i)`;
      }

      return `Array.from({length: ${stop} - ${start} + 1
      }, (_, i) => ${start} + i)`;
    }
    return `Array.from({length: Math.floor((${stop} - ${start}) / ${step}) + 1}, (_, i) => ${start} + i * ${step})`;
  },
  Root: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Root: no argument');
    const exp = args[1];
    if (exp === null) return `Math.sqrt(${compile(arg)})`;
    return `Math.pow(${compile(arg)}, 1 / (${compile(exp)}))`;
  },
  Random: 'Math.random',
  Round: 'Math.round',
  Square: (args, compile) => {
    const arg = args[0];
    if (arg === null) throw new Error('Square: no argument');
    return `Math.pow(${compile(arg)}, 2)`;
  },
  Sgn: 'Math.sign',
  Sin: 'Math.sin',
  Sinh: 'Math.sinh',
  Sqrt: 'Math.sqrt',
  Tan: 'Math.tan',
  Tanh: 'Math.tanh',
  // Factorial: 'factorial',    // TODO: implement

  // Hallucinated by Copilot, but interesting ideas...
  // Cot: 'Math.cot',
  // Sec: 'Math.sec',
  // Csc: 'Math.csc',
  // ArcCot: 'Math.acot',
  // ArcSec: 'Math.asec',
  // ArcCsc: 'Math.acsc',
  // Coth: 'Math.coth',
  // Sech: 'Math.sech',
  // Csch: 'Math.csch',
  // ArcCoth: 'Math.acoth',
  // ArcSech: 'Math.asech',
  // ArcCsch: 'Math.acsch',
  // Root: 'Math.root',
  // Gamma: 'Math.gamma',
  // Erf: 'Math.erf',
  // Erfc: 'Math.erfc',
  // Erfi: 'Math.erfi',
  // Zeta: 'Math.zeta',
  // PolyGamma: 'Math.polygamma',
  // HurwitzZeta: 'Math.hurwitzZeta', $$\zeta (s,a)=\sum _{n=0}^{\infty }{\frac {1}{(n+a)^{s}}}$$
  // DirichletEta: 'Math.dirichletEta',
  // Beta: 'Math.beta',
  // Binomial: 'Math.binomial',
  // Mod: 'Math.mod',
  // Quotient: 'Math.quotient',
  // GCD: 'Math.gcd',
  // LCM: 'Math.lcm',
  // Divisors: 'Math.divisors',
  // PrimeQ: 'Math.isPrime',
  // PrimePi: 'Math.primePi',
  // Prime: 'Math.prime',
  // NextPrime: 'Math.nextPrime',
  // PreviousPrime: 'Math.prevPrime',
  // PrimePowerQ: 'Math.isPrimePower',
  // PrimePowerPi: 'Math.primePowerPi',
  // PrimePower: 'Math.primePower',
  // NextPrimePower: 'Math.nextPrimePower',
  // PreviousPrimePower: 'Math.prevPrimePower',
  // PrimeFactors: 'Math.primeFactors',
  // DivisorSigma: 'Math.divisorSigma',
  // DivisorSigma0: 'Math.divisorSigma0',
  // DivisorSigma1: 'Math.divisorSigma1',
  // DivisorSigma2: 'Math.divisorSigma2',
  // DivisorSigma3: 'Math.divisorSigma3',
  // DivisorSigma4: 'Math.divisorSigma4',
  // DivisorCount: 'Math.divisorCount',
  // DivisorSum: 'Math.divisorSum',
  // MoebiusMu: 'Math.moebiusMu',
  // LiouvilleLambda: 'Math.liouvilleLambda',
  // CarmichaelLambda: 'Math.carmichaelLambda',
  // EulerPhi: 'Math.eulerPhi',
  // EulerPsi: 'Math.eulerPsi',
  // EulerGamma: 'Math.eulerGamma',
  // HarmonicNumber: 'Math.harmonicNumber',
  // BernoulliB: 'Math.bernoulliB',
  // StirlingS1: 'Math.stirlingS1',
  // StirlingS2: 'Math.stirlingS2',
  // BellB: 'Math.bellB',
  // BellNumber: 'Math.bellNumber',
  // LahS: 'Math.lahS',
  // LahL: 'Math.lahL',
  // RiemannR: 'Math.riemannR',
  // RiemannZeta: 'Math.riemannZeta',
  // RiemannXi: 'Math.riemannXi',
  // RiemannH: 'Math.riemannH',
  // RiemannZ: 'Math.riemannZ',
  // RiemannS: 'Math.riemannS',
  // RiemannXiZero: 'Math.riemannXiZero',
  // RiemannZetaZero: 'Math.riemannZetaZero',
  // RiemannHZero: 'Math.riemannHZero',
  // RiemannSZero: 'Math.riemannSZero',
  // RiemannPrimeCount: 'Math.riemannPrimeCount',
  // RiemannRLog: 'Math.riemannRLog',
  // RiemannRLogDerivative: 'Math.riemannRLogDerivative',
  // RiemannRLogZero: 'Math.riemannRLogZero',
  // RiemannRLogZeroDerivative: 'Math.riemannRLogZeroDerivative',
  // RiemannRZero: 'Math.riemannRZero',
  // RiemannRDerivative: 'Math.riemannRDerivative',
  // RiemannXiZeroDerivative: 'Math.riemannXiZeroDerivative',
  // RiemannZetaZeroDerivative: 'Math.riemannZetaZeroDerivative',
  // RiemannHZeroDerivative: 'Math.riemannHZeroDerivative',
  // RiemannSZeroDerivative: 'Math.riemannSZeroDerivative',
  // RiemannSZeroDerivative2: 'Math.riemannSZeroDerivative2',
  // RiemannSZeroDerivative3: 'Math.riemannSZeroDerivative3',
  // RiemannSZeroDerivative4: 'Math.riemannSZeroDerivative4',
  // RiemannSZeroDerivative5: 'Math.riemannSZeroDerivative5',
  // RiemannSZeroDerivative6: 'Math.riemannSZeroDerivative6',
};

export type CompileTarget = {
  operators?: (op: MathJsonIdentifier) => [op: string, prec: number];
  functions?: (
    id: MathJsonIdentifier
  ) => string | ((...args: CompiledType[]) => string);
  var: (id: MathJsonIdentifier) => string | undefined;
  string: (str: string) => string;
  number: (n: number) => string;
  ws: (s?: string) => string; // White space
  indent: number;
  // @todo: add context or return compile as an array of statements
  // and let the caller decide how to wrap it in an IIFE.
  // The expression being compiled will be used:
  // - as the value of a variable declaration (LexicalDeclaration)
  // - as the body of a function (FunctionDeclaration)
  // context?: 'LexicalDeclaration' | 'ExpressionStatement' | 'ReturnStatement';
};

/** This is an extension of the Function class that allows us to pass
 * a custom scope for "global" functions. */
export class ComputeEngineFunction extends Function {
  private sys = {
    chop: chop,
    factorial: factorial,
    gamma: gamma,
    gcd: gcd,
    integrate: (f, a, b) => monteCarloEstimate(f, a, b, 10e6),
    lcm: lcm,
    lngamma: gammaln,
    limit: limit,
  };
  constructor(body: string) {
    super('_SYS', '_', `return ${body}`);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.sys, ...argumentsList]),
      get: (target, prop) => {
        // Expose the `toString` method so that the JavaScript source can be
        // inspected
        if (prop === 'toString') return (): string => body;
        return target[prop];
      },
    });
  }
}

export function compileToTarget(
  expr: BoxedExpression,
  target: CompileTarget
): ((_: Record<string, CompiledType>) => CompiledType) | undefined {
  const js = compile(expr, target);
  // try {
  return new ComputeEngineFunction(js) as unknown as () => CompiledType;
  // } catch (e) {
  //   console.error(`${e}\n${expr.latex}\n${js}`);
  // }
  // return undefined;
}

export function compileToJavascript(
  expr: BoxedExpression
): ((_: Record<string, CompiledType>) => CompiledType) | undefined {
  const unknowns = expr.unknowns;
  return compileToTarget(expr, {
    operators: (op) => NATIVE_JS_OPERATORS[op],
    functions: (id) => NATIVE_JS_FUNCTIONS[id],
    var: (id) => {
      const result = {
        Pi: 'Math.PI',
        ExponentialE: 'Math.E',
        NaN: 'Number.NaN',
        ImaginaryUnit: 'Number.NaN',
        Half: '0.5',
        MachineEpsilon: 'Number.EPSILON',
        GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
        CatalanConstant: '0.91596559417721901',
        EulerGamma: '0.57721566490153286',
      }[id];
      if (result !== undefined) return result;
      if (unknowns.includes(id)) return `_.${id}`;
      return undefined;
    },
    string: (str) => JSON.stringify(str),
    number: (n) => n.toString(),
    indent: 0,
    ws: (s?: string) => s ?? '',
  });
}

function compileExpr(
  h: string,
  args: ReadonlyArray<BoxedExpression>,
  prec: number,
  target: CompileTarget
): JSSource {
  // No need to check for 'Rational': this has been handled as a number

  if (h === 'Error') throw new Error('Error');

  if (h === 'Sequence') {
    if (args.length === 0) return '';
    return `(${args.map((arg) => compile(arg, target, prec)).join(', ')})`;
  }

  // if (h === 'Negate') {
  //   const arg = args[0];
  //   if (arg === null) return '';
  //   return `-${compile(arg, target, 3)}`;
  // }

  if (h === 'Sum' || h === 'Product') return compileLoop(h, args, target);

  //
  // Is it an operator?
  //
  // Check that none of the arguments are collections
  // If they are, we'll treat it as a function call
  //

  if (args.every((x) => !isCollection(x))) {
    // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence
    // for operator precedence in JavaScript
    const op = target.operators?.(h);

    if (isRelationalOperator(h) && args.length > 2 && op) {
      // JavaScript relational operators only take two arguments
      // We need to chain them
      const result: string[] = [];
      for (let i = 0; i < args.length - 1; i++)
        result.push(compileExpr(h, [args[i], args[i + 1]], op[1], target));

      return `(${result.join(') && (')})`;
    }

    if (op !== undefined) {
      if (args === null) return '';
      let resultStr: string;
      if (args.length === 1) {
        // Unary operator, assume prefix
        resultStr = `${op[0]}${compile(args[0], target, op[1])}`;
      } else {
        resultStr = args
          .map((arg) => compile(arg, target, op[1]))
          .join(` ${op[0]} `);
      }
      return op[1] < prec ? `(${resultStr})` : resultStr;
    }
  }

  if (h === 'Function') {
    // Anonymous function
    const params = args.slice(1).map((x) => x.symbol);
    return `((${params.join(', ')}) => ${compile(args[0].canonical, {
      ...target,
      var: (id) => (params.includes(id) ? id : target.var(id)),
    })})`;
  }

  if (h === 'Declare') return `let ${args[0].symbol}`;
  if (h === 'Assign') return `${args[0].symbol} = ${compile(args[1], target)}`;
  // @todo: that's incorrect: return should return from the function, not the block
  if (h === 'Return') return `return ${compile(args[0], target)}`;
  if (h === 'If') {
    if (args.length !== 3) throw new Error('If: wrong number of arguments');
    return `((${compile(args[0], target)}) ? (${compile(
      args[1],
      target
    )}) : (${compile(args[2], target)}))`;
  }

  if (h === 'Block') {
    // Get all the Declare statements
    const locals: string[] = [];
    for (const arg of args) {
      if (arg.head === 'Declare') locals.push(arg.ops![0].symbol!);
    }

    if (args.length === 1 && locals.length === 0)
      return compile(args[0], target);

    const result = args.map((arg) =>
      compile(arg, {
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

  const fn = target.functions?.(h);
  if (!fn) throw new Error(`Unknown function ${h}`);
  if (typeof fn === 'function') {
    if (args.length === 1 && isFiniteIndexableCollection(args[0])) {
      const v = rndVar();
      return `(${compile(args[0], target)}).map((${v}) => ${fn(
        args[0].engine.box(v),
        (expr) => compile(expr, target)
      )})`;
    }
    return fn(args, (expr) => compile(expr, target), target);
  }

  if (args === null) return `${fn}()`;

  if (args.length === 1 && isFiniteIndexableCollection(args[0])) {
    const v = rndVar();
    return `(${compile(args[0], target)}).map((${v}) => ${fn}(${compile(
      args[0].engine.box(v),
      target
    )}))`;
  }

  return `${fn}(${args.map((x) => compile(x, target)).join(', ')})`;
}

// Will throw an exception if the expression cannot be compiled
export function compile(
  expr: BoxedExpression | undefined,
  target: CompileTarget,
  prec = 0
): JSSource {
  if (expr === undefined) return '';
  if (!expr.isValid) throw new Error('Invalid expression');

  //
  // Is it a number?
  //
  const f = asFloat(expr);
  if (f !== null) return target.number(f);

  //
  // Is it a symbol?
  //
  const s = expr.symbol;
  if (s !== null) return target.var?.(s) ?? s;

  // Is it a string?
  const str = expr.string;
  if (str !== null) return target.string(s!);

  // Is it a dictionary?
  const keys = expr.keys;
  if (keys !== null) {
    const result: string[] = [];
    for (const key of keys) {
      const value = expr.getKey(key);
      if (value) result.push(`${key}: ${compile(value, target, 0)}`);
    }
    return `{${result.join(', ')}}`;
  }

  // Is it a function expression?
  const h = expr.head;
  if (typeof h === 'string') return compileExpr(h, expr.ops!, prec, target);

  return '';
}

function compileLoop(
  h: string,
  args: ReadonlyArray<BoxedExpression>,
  target: CompileTarget
): string {
  if (args === null) throw new Error('Sum/Product: no arguments');
  if (!args[0]) throw new Error('Sum/Product: no body');
  // if (!args[1]) throw new Error('Sum/Product: no limits');

  const [index, lower, upper, isFinite] = normalizeIndexingSet(args[1]);

  const op = h === 'Sum' ? '+' : '*';

  if (!index) {
    // Loop over a collection
    const indexVar = rndVar();
    const acc = rndVar();
    const col = compile(args[0], target);
    return `${col}.reduce((${acc}, ${indexVar}) => ${acc} ${op} ${indexVar}, ${
      op === '+' ? '0' : '1'
    })`;
    //         return `(() => {
    //   let _acc = ${op === '+' ? '0' : '1'};
    //   for (const _x of ${col}) _acc ${op}= _x;
    //   return _acc;
    // })()`;
  }

  // @todo: if !isFinite, add tests for convergence to the generated code

  const fn = compile(args[0], {
    ...target,
    var: (id) => {
      if (id === index) return index;
      return target.var(id);
    },
  });

  // @todo: don't always need to wrap in an IIFE
  const indexVar = rndVar();
  const acc = rndVar();

  return `(() => {
  let ${acc} = ${op === '+' ? '0' : '1'};
  let ${index} = ${lower};
  const _fn = () => ${fn};
  while (${indexVar} <= ${upper}) {
    ${acc} ${op}= _fn();
    ${indexVar}++;
  }
  return ${acc};
})()`;
}

function iife(statements: string[], target: CompileTarget): string {
  if (statements.length === 0) return '';
  if (statements.length === 1) return statements[0];

  const last = statements.length - 1;
  statements[last] = `return ${statements[last]}`;

  return (() => {
    'foo';
    return 'bar';
  })();

  // return `(() => ${statements.join(`;${target.ws('\n')}`)}()`;
}

function rndVar(): string {
  // Return a random variable name made up of a single underscore
  // followed by some digits and letters
  return `_${Math.random().toString(36).substring(2)}`;
}

function compileIntegrate(args, _, target: CompileTarget): string {
  const [index, lower, upper] = normalizeIndexingSet(args[1]);
  const f = compile(args[0], {
    ...target,
    var: (id) => (id === index ? id : target.var(id)),
  });

  return `_SYS.integrate((${index}) => (${f}), ${lower}, ${upper})`;
}
