import { normalizeLimits } from './library/arithmetic-add';
import { asFloat } from './numerics/numeric';
import { BoxedExpression } from './public';

export function compileToJavascript(
  expr: BoxedExpression
): ((_: Record<string, number>) => number) | undefined {
  const js = compile(expr, expr.freeVars);
  try {
    return new Function('_', `return ${js}`) as () => number;
  } catch (e) {
    console.error(`${e}\n${expr.latex}\n${js}`);
  }
  return undefined;
}

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
    if (h === 'Error') {
      return 'NaN';
    }
    if (h === 'Sum') return compileLoop(expr, '+');
    if (h === 'Product') return compileLoop(expr, '*');

    if (h === 'Root') {
      const arg = expr.op1;
      if (arg === null) return '';
      const exp = expr.op2;
      if (exp === null) return `Math.sqrt(${compile(arg, freeVars, 0)})`;
      return `Math.pow(${compile(arg, freeVars)}, 1/${compile(exp, freeVars)}`;
    }
    if (h === 'Factorial') {
      const arg = expr.op1;
      if (arg === null) return '';
      return `${compile(arg, freeVars, 3)}!`;
    }
    // Is it an operator?
    const OPS: Record<string, [op: string, prec: number]> = {
      Add: ['+', 1],
      Subtract: ['-', 1],
      Multiply: ['*', 2],
      Divide: ['/', 3],
    };
    const op = OPS[h];

    if (op !== undefined) {
      const args = expr.ops;
      if (args === null) return '';
      const result: string[] = [];
      for (const arg of args) result.push(compile(arg, freeVars, op[1]));
      return op[1] < prec ? `(${result.join(op[0])})` : result.join(op[0]);
    }

    // Assume it's a JS function
    const fn =
      {
        Abs: 'Math.abs',
        Arccos: 'Math.acos',
        Arcosh: 'Math.acosh',
        Arsin: 'Math.asin',
        Arsinh: 'Math.asinh',
        Arctan: 'Math.atan',
        Artanh: 'Math.atanh',
        // Math.cbrt
        Ceiling: 'Math.ceil',
        Cos: 'Math.cos',
        Cosh: 'Math.cosh',
        Exp: 'Math.exp',
        Floor: 'Math.floor',
        // Math.hypot
        Ln: 'Math.log',
        Log: 'Math.log10',
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
        // HurwitzZeta: 'Math.hurwitzZeta',
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
      }[h] ?? h;
    const args = expr.ops;
    if (args !== null) {
      const result: string[] = [];
      for (const arg of args) result.push(compile(arg, freeVars, 0));
      return `${fn}(${result.join(', ')})`;
    }
  }

  return '';
}

function compileLoop(expr: BoxedExpression, op: '+' | '*'): string {
  const args = expr.ops;
  if (args === null) return 'NaN';
  if (!expr.op1 || !expr.op2) return 'NaN';
  const [index, lower, upper, isFinite] = normalizeLimits(expr.op2);

  const fn = compile(expr.op1, [...expr.op1.freeVars, index], 0);

  return `((_) => {
    let acc = ${op === '+' ? '0' : '1'};
    const fn = (_) => ${fn};
    for (let i = ${lower}; i < ${upper}; i++)
      acc ${op}= fn({ ..._, ${index}: i });
    return acc;
  })()`;
}
