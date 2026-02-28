import { Complex } from 'complex-esm';
import { BigDecimal } from '../../big-decimal';

import type { MathJsonExpression } from '../../math-json/types';
import type { LatexString } from '../latex-syntax/types';

import { apply } from './apply';

import { canonicalAngle } from './utils';

import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Sign,
} from '../global-types';
import { asLatexString } from '../latex-syntax/utils';
import { parse as parseLatex } from '../latex-syntax/latex-syntax';
import { isNumber, isSymbol, isFunction } from './type-guards';

type ConstructibleTrigValues = [
  [numerator: number, denominator: number],
  { [operator: string]: Expression }
][];

// For each trig function, by quadrant (0..π/2, π/2..π, π..3π/2, 3π/2..2π),
// what is the corresponding identity (sign and function)
// E.g 'Sin[θ+π/2] = Cos[θ]` -> Quadrant 2, Positive sign, Cos
const TRIG_IDENTITIES: { [key: string]: [sign: number, name: string][] } = {
  Sin: [
    [+1, 'Sin'],
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
  ],
  Cos: [
    [+1, 'Cos'],
    [-1, 'Sin'],
    [-1, 'Cos'],
    [+1, 'Sin'],
  ],
  Sec: [
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
    [+1, 'Csc'],
  ],
  Csc: [
    [+1, 'Csc'],
    [+1, 'Sec'],
    [-1, 'Csc'],
    [-1, 'Sec'],
  ],
  Tan: [
    [+1, 'Tan'],
    [-1, 'Cot'],
    [+1, 'Tan'],
    [-1, 'Cot'],
  ],
  Cot: [
    [+1, 'Cot'],
    [-1, 'Tan'],
    [+1, 'Cot'],
    [-1, 'Tan'],
  ],
};

const S2: MathJsonExpression = ['Sqrt', 2];
const S3: MathJsonExpression = ['Sqrt', 3];
const S5: MathJsonExpression = ['Sqrt', 5];
const S6: MathJsonExpression = ['Sqrt', 6];
// From https://en.wikipedia.org/wiki/Trigonometric_functions
// and https://en.wikipedia.org/wiki/Exact_trigonometric_values

// The key is the argument in radian, as (num * π / den)
const CONSTRUCTIBLE_VALUES: [
  key: [numerator: number, denominator: number],
  values: { [name: string]: MathJsonExpression | LatexString }
][] = [
  [
    [0, 1],
    {
      Sin: 0,
      Cos: 1,
      Tan: 0,
      Cot: 'ComplexInfinity',
      Sec: 1,
      Csc: 'ComplexInfinity',
    },
  ],
  [
    [1, 12],
    {
      Sin: ['Divide', ['Subtract', S6, S2], 4],
      Cos: ['Divide', ['Add', S6, S2], 4],
      Tan: ['Subtract', 2, S3],
      Cot: ['Add', 2, S3],
      Sec: ['Subtract', S6, S2],
      Csc: ['Add', S6, S2],
    },
  ],
  [
    [1, 10],
    {
      Sin: ['Divide', ['Subtract', S5, 1], 4],
      Cos: ['Divide', ['Sqrt', ['Add', 10, ['Multiply', 2, S5]]], 4],
      Tan: ['Divide', ['Sqrt', ['Subtract', 25, ['Multiply', 10, S5]]], 5],
      Cot: ['Sqrt', ['Add', 5, ['Multiply', 2, S5]]],
      Sec: ['Divide', ['Sqrt', ['Subtract', 50, ['Multiply', 10, S5]]], 5],
      Csc: ['Add', 1, S5],
    },
  ],
  [
    [1, 8],
    {
      Sin: '$\\frac{\\sqrt{2-\\sqrt2}}{2}$',
      Cos: '$\\frac{\\sqrt {2+{\\sqrt {2}}}}{2}$',
      Tan: '$\\sqrt{2} - 1$',
      Cot: '$\\sqrt{2} + 1$',
      Sec: '$\\sqrt{ 4 - 2\\sqrt{2}}$',
      Csc: '$\\sqrt{ 4 + 2\\sqrt{2}}$',
    },
  ],
  [
    [1, 6],
    {
      Sin: '$\\frac{1}{2}$',
      Cos: '$\\frac{\\sqrt{3}}{2}$',
      Tan: '$\\frac{\\sqrt{3}}{3}$',
      Cot: '$\\sqrt{3}$',
      Sec: '$\\frac{2\\sqrt{3}}{3}$',
      Csc: 2,
    },
  ],
  [
    [1, 5],
    {
      Sin: '$\\frac{\\sqrt{10- 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{1+ \\sqrt{5}} {4}$',
      Tan: '$\\sqrt{5-2\\sqrt5}$',
      Cot: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Sec: '$\\sqrt{5} - 1$',
      Csc: '$\\frac{\\sqrt{50+10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [1, 4],
    {
      Sin: ['Divide', S2, 2],
      Cos: ['Divide', S2, 2],
      Tan: 1,
      Cot: 1,
      Sec: S2,
      Csc: S2,
    },
  ],

  [
    [3, 10],
    {
      Sin: '$\\frac{1+ \\sqrt5} {4}$',
      Cos: '$\\frac{\\sqrt{10- 2\\sqrt5}} {4}$',
      Tan: '$\\frac{\\sqrt{25+10\\sqrt5}} {5}$',
      Cot: '$\\sqrt{5-2\\sqrt5}$',
      Sec: '$\\frac{\\sqrt{50+10\\sqrt5}} {5}$',
      Csc: '$\\sqrt5-1$',
    },
  ],
  [
    [1, 3],
    {
      Sin: ['Divide', S3, 2], // '$\\frac{\\sqrt{3}}{2}$'
      Cos: 'Half', // '$\\frac{1}{2}$'
      Tan: S3, // '$\\sqrt{3}$'
      Cot: ['Divide', S3, 3], // '$\\frac{\\sqrt{3}}{3}$'
      Sec: 2,
      Csc: ['Divide', ['Multiply', 2, S3], 3], // '$\\frac{2\\sqrt{3}}{3}$'
    },
  ],
  [
    [3, 8],
    {
      Sin: '$\\frac{ \\sqrt{2 + \\sqrt{2}} } {2}$',
      Cos: '$\\frac{ \\sqrt{2 - \\sqrt{2}} } {2}$',
      Tan: '$\\sqrt{2} + 1$',
      Cot: '$\\sqrt{2} - 1$',
      Sec: '$\\sqrt{ 4 + 2 \\sqrt{2} }$',
      Csc: '$\\sqrt{ 4 - 2 \\sqrt{2} }$',
    },
  ],
  [
    [2, 5],
    {
      Sin: '$\\frac{\\sqrt{10+ 2\\sqrt{5}}} {4}$',
      Cos: '$\\frac{\\sqrt{5}-1} {4}$',
      Tan: '$\\sqrt{5+2\\sqrt{5}}$',
      Cot: '$\\frac{\\sqrt{25-10\\sqrt{5}}} {5}$',
      Sec: '$1 + \\sqrt{5}$',
      Csc: '$\\frac{\\sqrt{50-10\\sqrt{5}}} {5}$',
    },
  ],
  [
    [5, 12],
    {
      Sin: '$\\frac{\\sqrt{6} + \\sqrt{2}} {4}$',
      Cos: '$\\frac{ \\sqrt{6} - \\sqrt{2}} {4}$',
      Tan: '$2+\\sqrt{3}$',
      Cot: '$2-\\sqrt{3}$',
      Sec: '$\\sqrt{6}+\\sqrt{2}$',
      Csc: '$\\sqrt{6} - \\sqrt{2}$',
    },
  ],
  [
    [1, 2],
    {
      Sin: 1,
      Cos: 0,
      Tan: 'ComplexInfinity',
      Cot: 0,
      Sec: 'ComplexInfinity',
      Csc: 1,
    },
  ],
];

function applyAngle(
  angle: Expression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: BigDecimal) => BigDecimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): Expression | undefined {
  const theta = canonicalAngle(angle)?.N();
  if (theta === undefined) return undefined;
  return apply(theta, fn, bigFn, complexFn);
}

/** Assuming x in an expression in radians, convert to current angular unit. */
export function radiansToAngle(
  x: Expression | undefined
): Expression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  const theta = x.N().re;
  if (Number.isNaN(theta)) return x;
  if (angularUnit === 'deg') return ce.number(theta * (180 / Math.PI));
  if (angularUnit === 'grad') return ce.number(theta * (200 / Math.PI));
  if (angularUnit === 'turn') return ce.number(theta / (2 * Math.PI));
  return x;
}

export function evalTrig(
  name: string,
  op: Expression | undefined
): Expression | undefined {
  if (!op) return undefined;
  const ce = op.engine;

  switch (name) {
    case 'Arccos':
      return radiansToAngle(
        apply(
          op,
          Math.acos,
          (x) => x.acos(),
          (x) => x.acos()
        )
      );
    case 'Arccot':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.atan2(1, x),
          (x) => BigDecimal.atan2(BigDecimal.ONE, x),
          (x) => x.inverse().atan()
        )
      );
    case 'Arccsc':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.asin(1 / x),
          (x) => BigDecimal.ONE.div(x).asin(),
          (x) => x.inverse().asin()
        )
      );
    case 'Arcosh':
      return radiansToAngle(
        apply(
          op,
          Math.acosh,
          // acosh(x) = ln(x + sqrt(x^2 - 1))
          (x) => x.add(x.mul(x).sub(BigDecimal.ONE).sqrt()).ln(),
          (x) => x.acosh()
        )
      );
    case 'Arcoth':
      // ln[(1 + x) /(x − 1)] /2
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log((1 + x) / (x - 1)) / 2,
          (x) => BigDecimal.ONE.add(x).div(x.sub(BigDecimal.ONE)).ln().div(BigDecimal.TWO),
          (x) => ce.complex(1).add(x).div(x.sub(1)).log().div(2)
        )
      );

    case 'Arcsch':
      // ln[1/x + √(1/x2 + 1)],
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log(1 / x + Math.sqrt(1 / (x * x) + 1)),
          (x) =>
            BigDecimal.ONE
              .div(x.mul(x))
              .add(BigDecimal.ONE)
              .sqrt()
              .add(BigDecimal.ONE.div(x))
              .ln(),
          (x) => x.mul(x).inverse().add(1).sqrt().add(x.inverse()).log()
        )
      );

    case 'Arcsec':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.acos(1 / x),
          (x) => BigDecimal.ONE.div(x).acos(),
          (x) => x.inverse().acos()
        )
      );

    case 'Arcsin':
      return radiansToAngle(
        apply(
          op,
          Math.asin,
          (x) => x.asin(),
          (x) => x.asin()
        )
      );

    case 'Arsech':
      return radiansToAngle(
        apply(
          op,
          (x) => Math.log((1 + Math.sqrt(1 - x * x)) / x),
          // arsech(x) = ln((1 + sqrt(1 - x^2)) / x)
          (x) => BigDecimal.ONE.sub(x.mul(x)).sqrt().add(BigDecimal.ONE).div(x).ln(),
          (x) => ce.complex(1).sub(x.mul(x)).add(1).div(x).log()
        )
      );

    case 'Arsinh':
      return radiansToAngle(
        apply(
          op,
          Math.asinh,
          // asinh(x) = ln(x + sqrt(x^2 + 1))
          (x) => x.add(x.mul(x).add(BigDecimal.ONE).sqrt()).ln(),
          (x) => x.asinh()
        )
      );

    case 'Arctan':
      return radiansToAngle(
        apply(
          op,
          Math.atan,
          (x) => x.atan(),
          (x) => x.atan()
        )
      );

    case 'Artanh':
      return radiansToAngle(
        apply(
          op,
          Math.atanh,
          // atanh(x) = 0.5 * ln((1+x)/(1-x))
          (x) => BigDecimal.ONE.add(x).div(BigDecimal.ONE.sub(x)).ln().div(BigDecimal.TWO),
          (x) => x.atanh()
        )
      );

    case 'Cos':
      return applyAngle(
        op,
        Math.cos,
        (x) => ce.chop(x.cos()),
        (x) => x.cos()
      );

    case 'Cosh':
      return applyAngle(
        op,
        Math.cosh,
        (x) => x.cosh(),
        (x) => x.cosh()
      );

    case 'Cot':
      return applyAngle(
        op,
        (x) => 1 / Math.tan(x),
        (x) => BigDecimal.ONE.div(x.tan()),
        (x) => x.tan().inverse()
      );
    case 'Coth':
      return applyAngle(
        op,
        (x) => 1 / Math.tanh(x),
        (x) => BigDecimal.ONE.div(x.tanh()),
        (x) => x.tanh().inverse()
      );
    case 'Csc':
      return applyAngle(
        op,
        (x) => 1 / Math.sin(x),
        (x) => BigDecimal.ONE.div(x.sin()),
        (x) => x.sin().inverse()
      );
    case 'Csch':
      return applyAngle(
        op,
        (x) => 1 / Math.sinh(x),
        (x) => BigDecimal.ONE.div(x.sinh()),
        (x) => x.sinh().inverse()
      );
    case 'Sec':
      return applyAngle(
        op,
        (x) => 1 / Math.cos(x),
        (x) => BigDecimal.ONE.div(x.cos()),
        (x) => x.cos().inverse()
      );
    case 'Sech':
      return applyAngle(
        op,
        (x) => 1 / Math.cosh(x),
        (x) => BigDecimal.ONE.div(x.cosh()),
        (x) => x.cosh().inverse()
      );
    case 'Sin':
      return applyAngle(
        op,
        Math.sin,
        (x) => ce.chop(x.sin()),
        (x) => x.sin()
      );
    case 'Sinh':
      return applyAngle(
        op,
        Math.sinh,
        (x) => x.sinh(),
        (x) => x.sinh()
      );
    case 'Tan': {
      const result = applyAngle(
        op,
        (x) => {
          const y = Math.tan(x);
          if (y > 1e6 || y < -1e6) return ce.ComplexInfinity;
          return y;
        },

        (x) => {
          const y = x.tan();
          if (y.gt(1e6) || y.lt(-1e6)) return ce.ComplexInfinity;
          return y;
        },
        (x) => x.tan()
      );

      return result;
    }
    case 'Tanh':
      return applyAngle(
        op,
        Math.tanh,
        (x) => x.tanh(),
        (x) => x.tanh()
      );
  }
  return undefined;
}

function isInverseTrigFunc(name: string): boolean {
  if (name.startsWith('Ar') && inverseTrigFuncName(name)) return true;
  return false;
}

function inverseTrigFuncName(name: string): string | undefined {
  return {
    Sin: 'Arcsin',
    Cos: 'Arccos',
    Tan: 'Arctan',
    Sec: 'Arcsec',
    Csc: ' Arccsc',
    Sinh: 'Arsinh',
    Cosh: 'Arcosh',
    Tanh: 'Artanh',
    Sech: 'Arsech',
    Csch: 'Arcsch',
    Arcosh: 'Cosh',
    Arccos: 'Cos',
    Arccsc: 'Csc',
    Arcsch: 'Csch',
    // '??': 'Cot',
    // '??': 'Coth',
    Arcsec: 'Sec',
    Arcsin: 'Sin',
    Arsinh: 'Sinh',
    Arctan: 'Tan',
    Artanh: 'Tanh',
  }[name];
}

export function processInverseFunction(
  ce: ComputeEngine,
  xs: ReadonlyArray<Expression>
): Expression | undefined {
  if (xs.length !== 1 || !xs[0].isValid) return undefined;
  const expr = xs[0];
  if (isFunction(expr, 'InverseFunction')) return expr.op1.canonical;

  if (!isSymbol(expr)) return undefined;
  const name = expr.symbol;

  const newHead = inverseTrigFuncName(name);
  return newHead ? ce.symbol(newHead) : undefined;
}

function trigFuncParity(name: string): number {
  // Cos and Sec are even functions, the others are odd
  return name !== 'Cos' && name !== 'Sec' ? -1 : 1;
}

function constructibleValuesInverse(
  ce: ComputeEngine,
  operator: string,
  x: Expression | undefined,
  specialValues: ConstructibleTrigValues
): undefined | Expression {
  if (!x) return undefined;
  let x_N = x.N().re;
  if (Number.isNaN(x_N)) return undefined;
  // operator is arcFn, and inv_operator is Fn
  const inv_operator = inverseTrigFuncName(operator);

  //
  // Create the cache of special values of the operator function by inverting
  // specialValues of inv_operator function
  //
  type ConstructibleTrigValuesInverse = [
    [match_arg: Expression, match_arg_N: number],
    angle: [numerator: number, denominator: number]
  ][];
  const specialInverseValues = ce._cache<ConstructibleTrigValuesInverse>(
    'constructible-inverse-trigonometric-values-' + operator,
    () => {
      const cache: ConstructibleTrigValuesInverse = [];
      for (const [[n, d], value] of specialValues) {
        const r = value[inv_operator!];
        if (r === undefined) continue;
        const rn = r.N().re;
        if (Number.isNaN(rn)) continue;
        cache.push([
          [r, rn],
          [n, d],
        ]);
      }
      return cache;
    },

    (cache: ConstructibleTrigValuesInverse) => {
      for (const [[match_arg, _match_arg_N], [_n, _d]] of cache) {
        match_arg.reset();
      }
      return cache;
    }
  );

  // Odd-even identities

  let quadrant = 0;
  if (x_N < 0) {
    quadrant = trigFuncParity(inv_operator!) == -1 ? -1 : 1;
    // shift x to quadrant 0 to match the key in specialInverseValues
    x_N = -x_N;
    x = x.neg();
  }

  for (const [[_match_arg, match_arg_N], [n, d]] of specialInverseValues) {
    if (ce.chop(x_N - match_arg_N) === 0) {
      // there is an implicit Pi in the numerator
      let theta = ce.Pi.mul(n).div(d);
      if (quadrant == -1) theta = theta.neg();
      else if (quadrant == 1) theta = ce.Pi.sub(theta);

      return theta.evaluate();
    }
  }
  return undefined;
}

export function trigSign(operator: string, x: Expression): Sign | undefined {
  const [q, pos] = quadrant(x);
  if (q === undefined) return undefined;
  if (pos !== undefined) {
    if ((operator === 'Sin' || operator === 'Tan') && (pos === 0 || pos === 2))
      return 'zero';
    if ((operator === 'Cos' || operator === 'Cot') && (pos === 1 || pos === 3))
      return 'zero';
  }
  return {
    Sin: ['positive', 'positive', 'negative', 'negative'],
    Cos: ['positive', 'negative', 'negative', 'positive'],
    Sec: ['positive', 'negative', 'negative', 'positive'],
    Csc: ['positive', 'positive', 'negative', 'negative'],
    Tan: ['positive', 'negative', 'positive', 'negative'],
    Cot: ['positive', 'negative', 'positive', 'negative'],
  }[operator]?.[q] as Sign;
}

export function isConstructible(x: string | Expression): boolean {
  return ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot'].includes(
    typeof x === 'string' ? x : x.operator
  );
}

export function constructibleValues(
  operator: string,
  x: Expression | undefined
): undefined | Expression {
  if (!x || !isConstructible(operator)) return undefined;
  const ce = x.engine;

  x = x.N();
  // If the argument has an imaginary part, it's not a constructible value
  if (x.im !== 0) return undefined;

  let theta = x.re;
  if (Number.isNaN(theta)) return undefined;

  //
  // Create the cache of special values
  //
  const specialValues = ce._cache<ConstructibleTrigValues>(
    'constructible-trigonometric-values',
    () => {
      return CONSTRUCTIBLE_VALUES.map(([val, results]) => [
        val,
        Object.fromEntries(
          Object.entries(results).map(([op, r]) => [
            op,
            (asLatexString(r)
              ? ce.expr(parseLatex(asLatexString(r)!) ?? r)
              : ce.expr(r)
            ).simplify(),
          ])
        ),
      ]);
    },

    (cache: ConstructibleTrigValues) => {
      for (const [_k, v] of cache) {
        for (const v2 of Object.values(v)) v2.reset();
      }
      return cache;
    }
  );

  if (isInverseTrigFunc(operator))
    return constructibleValuesInverse(ce, operator, x, specialValues);

  const angularUnit = ce.angularUnit;
  if (angularUnit !== 'rad') {
    if (angularUnit === 'deg') theta *= Math.PI / 180;
    if (angularUnit === 'grad') theta *= Math.PI / 200;
    if (angularUnit === 'turn') theta *= 2 * Math.PI;
  }

  // Odd-even identities
  const identitySign = trigFuncParity(operator) == -1 ? Math.sign(theta) : +1;

  theta = Math.abs(theta % (2 * Math.PI));

  const quadrant = Math.floor((theta * 2) / Math.PI); // 0..3

  theta = theta % (Math.PI / 2); // 0..π/2

  // Adjusting for the position in the quadrant
  let sign: number;
  [sign, operator] = TRIG_IDENTITIES[operator]?.[quadrant] ?? [1, operator];

  for (const [[n, d], value] of specialValues) {
    const r = value[operator];
    if (r && Math.abs(theta - (Math.PI * n) / d) <= 1e-12) {
      if (isSymbol(r, 'ComplexInfinity')) return r;
      return identitySign * sign < 0 ? r.neg() : r;
    }
  }
  return undefined;
}

// Return the quadrant of the angle (1..4) and the position on the
// circle 0...4 corresponding to 0, π/2, π, 3π/2, 2π.
function quadrant(theta: Expression): [number | undefined, number | undefined] {
  // theta = theta.N();
  if (!theta.isValid || !isNumber(theta)) return [undefined, undefined];
  if (theta.im !== 0) return [undefined, undefined];

  // Normalize the angle to the range [0, 2π)
  const t = theta.re;
  if (isNaN(t)) return [undefined, undefined];
  const normalizedTheta = ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  if (Math.abs(normalizedTheta) < 1e-12) return [1, 0];
  if (Math.abs(normalizedTheta - Math.PI / 2) < 1e-12) return [2, 1];
  if (Math.abs(normalizedTheta - Math.PI) < 1e-12) return [3, 2];
  if (Math.abs(normalizedTheta - (3 * Math.PI) / 2) < 1e-12) return [4, 3];

  // Use Math.floor to determine the quadrant
  return [Math.floor(normalizedTheta / (Math.PI / 2)) + 1, undefined];
}
