import { normalizeLimits } from './library/utils';
import {
  asFloat,
  chop,
  factorial,
  gamma,
  gcd,
  lcm,
  gammaln,
} from './numerics/numeric';
import { BoxedExpression } from './public';

export type CompiledType = boolean | number | string | object;

/** This is an extension of the Function class that allows us to pass
 * a custom scope for "global" functions. */
export class ComputeEngineFunction extends Function {
  private sys = {
    factorial: factorial,
    gamma: gamma,
    lngamma: gammaln,
    gcd: gcd,
    lcm: lcm,
    chop: chop,
  };
  constructor(body) {
    super('_SYS', '_', `return ${body}`);
    return new Proxy(this, {
      apply: (target, thisArg, argumentsList) =>
        super.apply(thisArg, [this.sys, ...argumentsList]),
      get: (target, prop) => {
        if (prop === 'toString') return () => body;
        return target[prop];
      },
    });
  }
}

export function compileToJavascript(
  expr: BoxedExpression
): ((_: Record<string, CompiledType>) => CompiledType) | undefined {
  const js = compile(expr, expr.freeVars);
  try {
    return new ComputeEngineFunction(js) as unknown as () => CompiledType;
  } catch (e) {
    console.error(`${e}\n${expr.latex}\n${js}`);
  }
  return undefined;
}

// Will throw an exception if the expression cannot be compiled
export function compile(
  expr: BoxedExpression,
  freeVars: string[] = [],
  prec = 0
): string {
  //
  // Is it a number?
  //
  const f = asFloat(expr);
  if (f !== null) return f.toString();

  //
  // Is it a symbol?
  //
  const s = expr.symbol;
  if (s !== null) {
    const result = {
      True: 'true',
      False: 'false',
      Pi: 'Math.PI',
      ExponentialE: 'Math.E',
      I: 'Math.I',
      NaN: 'Number.NaN',
      ImaginaryUnit: 'NaN',
      Half: '0.5',
      MachineEpsilon: 'Number.EPSILON',
      GoldenRatio: '((1 + Math.sqrt(5)) / 2)',
      CatalanConstant: '0.91596559417721901',
      EulerGamma: '0.57721566490153286',
    }[s];
    if (result !== undefined) return result;
    if (freeVars.includes(s)) return `_.${s}`;
    return s;
  }

  // Is it a string?
  const str = expr.string;
  if (str !== null) return JSON.stringify(str);

  // Is it a dictionary?
  const keys = expr.keys;
  if (keys !== null) {
    const result: string[] = [];
    for (const key of keys) {
      const value = expr.getKey(key);
      if (value) result.push(`${key}: ${compile(value, freeVars, 0)}`);
    }
    return `{${result.join(', ')}}`;
  }

  // Is it a function expression?
  const h = expr.head;
  if (typeof h === 'string') {
    // No need to check for 'Rational': this has been handled above
    // by `asFloat()`
    if (h === 'Negate') {
      const arg = expr.op1;
      if (arg === null) return '';
      return `-${compile(arg, freeVars, 3)}`;
    }
    if (h === 'Error') throw new Error('Error');
    if (h === 'Sum') return compileLoop(expr, '+');
    if (h === 'Product') return compileLoop(expr, '*');

    if (h === 'Root') {
      const arg = expr.op1;
      if (arg === null) throw new Error('Root: no argument');
      const exp = expr.op2;
      if (exp === null) return `Math.sqrt(${compile(arg, freeVars, 0)})`;
      return `Math.pow(${compile(arg, freeVars)}, 1/${compile(exp, freeVars)}`;
    }

    if (h === 'Factorial') {
      const arg = expr.op1;
      if (arg === null) throw new Error('Factorial: no argument');
      return `_SYS.factorial(${compile(arg, freeVars)})`;
    }

    if (h === 'Power') {
      const arg = expr.op1;
      if (arg === null) throw new Error('Power: no argument');
      const exp = asFloat(expr.op2);
      if (exp === 0.5) return `Math.sqrt(${compile(arg, freeVars)})`;
      if (exp === 1 / 3) return `Math.cbrt(${compile(arg, freeVars)})`;
      if (exp === 1) return compile(arg, freeVars);
      if (exp === -1) return `1 / ${compile(arg, freeVars)}`;
      if (exp === -0.5) return `1 / Math.sqrt(${compile(arg, freeVars)})`;
    }

    if (h === 'Square') {
      const arg = expr.op1;
      if (arg === null) throw new Error('Square: no argument');
      return `Math.pow(${compile(arg, freeVars)}, 2)`;
    }

    // Is it an operator?
    // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence
    // for operator precedence in JavaScript
    const OPS: Record<string, [op: string, prec: number]> = {
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
    const op = OPS[h];

    if (op !== undefined) {
      const args = expr.ops;
      if (args === null) return '';
      let resultStr: string;
      if (args.length === 1) {
        // Unary operator, assume prefix
        resultStr = `${op[0]}${compile(args[0], freeVars, op[1])}`;
      } else {
        resultStr = args
          .map((arg) => compile(arg, freeVars, op[1]))
          .join(` ${op[0]} `);
      }
      return op[1] < prec ? `(${resultStr})` : resultStr;
    }

    const fn = {
      Abs: 'Math.abs',
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
      Gcd: '_SYS.gcd',
      // Math.hypot
      Lcm: '_SYS.lcm',
      Ln: 'Math.log',
      Log: 'Math.log10',
      LogGamma: '_SYS.lngamma',
      Lb: 'Math.log2',
      Max: 'Math.max',
      Min: 'Math.min',
      Power: 'Math.pow',
      Random: 'Math.random',
      Round: 'Math.round',
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
    }[h];
    if (!fn) throw new Error(`Unknown function ${h}`);
    const args = expr.ops;
    if (args !== null) {
      const result: string[] = [];
      for (const arg of args) result.push(compile(arg, freeVars));
      return `${fn}(${result.join(', ')})`;
    }
  }

  return '';
}

function compileLoop(expr: BoxedExpression, op: '+' | '*'): string {
  const args = expr.ops;
  if (args === null) throw new Error('Sum: no arguments');
  if (!expr.op1 || !expr.op2) throw new Error('Sum: no limits');

  const [index, lower, upper, isFinite] = normalizeLimits(expr.op2);

  // @todo: if !isFinite, add tests for convergence to the generated code

  const fn = compile(expr.op1, [...expr.op1.freeVars, index], 0);

  return `(() => {
  let acc = ${op === '+' ? '0' : '1'};
  const fn = (_) => ${fn};
  for (let i = ${lower}; i <= ${upper}; i++)
    acc ${op}= fn({ ..._, ${index}: i });
  return acc;
})()`;
}
